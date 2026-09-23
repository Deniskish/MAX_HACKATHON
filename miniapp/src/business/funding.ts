import type { FundingNeed, FundingProfile, FundingResponse } from '../../api-server/funding-catalog/types';
import { emptyFundingNeed } from '../../api-server/funding-catalog/types';
import { parseFundingNeed, toFundingProfile } from '../../api-server/funding-catalog/input';

export function restoreFundingNeed(saved: string | null): FundingNeed {
  try { return parseFundingNeed(JSON.parse(saved ?? 'null')); }
  catch { return { ...emptyFundingNeed }; }
}
export const fundingFingerprint = (profile: FundingProfile, need: FundingNeed) =>
  JSON.stringify({ profile: toFundingProfile(profile), need });

export async function requestFunding(profile: FundingProfile, need: FundingNeed, signal: AbortSignal,
  transport: typeof fetch = fetch): Promise<FundingResponse> {
  const response = await transport('/api/funding/match', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profile: toFundingProfile(profile), need: parseFundingNeed(need) }), signal,
  });
  if (!response.ok) throw new Error(response.status === 400
    ? 'Проверьте цель и числовые значения потребности.' : 'Подбор временно недоступен. Попробуйте ещё раз.');
  const data = await response.json() as FundingResponse;
  if (!['official', 'demo'].includes(data.mode) || !Array.isArray(data.matches) || !Array.isArray(data.strategy?.options) ||
    data.mode === 'official' && data.matches.some((m) => m.opportunity?.source?.type !== 'official'))
    throw new Error('Сервер вернул некорректный результат подбора.');
  signal.throwIfAborted();
  return data;
}
