import { emptyProfile, type Profile, type ProfileValues } from './domain';
import type { CompanyResponse, FieldProvenance } from '../../api-server/company-data/types';

const manualOrigin = (): FieldProvenance => ({
  sourceId: 'user', source: 'Ручной ввод', sourceUrl: null,
  updatedAt: new Date().toISOString(), mode: 'manual', kind: 'manual',
});

// Смена ИНН начинает профиль другой компании; прежние факты не должны остаться под новым ИНН.
export function editCompanyProfile(previous: Profile, next: Profile): Profile {
  if (previous.inn !== next.inn)
    return { ...emptyProfile, inn: next.inn, goals: next.goals,
      provenance: { inn: manualOrigin(), goals: previous.provenance?.goals ?? manualOrigin() } };
  const provenance = { ...previous.provenance };
  for (const field of Object.keys(emptyProfile) as (keyof ProfileValues)[])
    if (previous[field] !== next[field]) provenance[field] = manualOrigin();
  return { ...next, provenance };
}

export function mergeCompanyProfile(current: Profile, response: CompanyResponse): Profile {
  if (current.inn !== response.company.inn) return current;
  const next = { ...current, provenance: { ...current.provenance } };
  for (const field of Object.keys(emptyProfile) as (keyof ProfileValues)[]) {
    if (field === 'goals') continue;
    const origin = response.profile.provenance?.[field];
    const value = response.profile[field];
    if (origin && value !== null && value !== '' && value !== 'unknown') {
      Object.assign(next, { [field]: value });
      next.provenance[field] = origin;
    } else if (current.provenance?.[field] && current.provenance[field]?.kind !== 'manual') {
      // При обновлении снимка удаляем исчезнувшие сведения источника, сохраняя ручной ввод.
      Object.assign(next, { [field]: emptyProfile[field] });
      delete next.provenance[field];
    }
  }
  return next;
}

export async function requestCompanyData(
  inn: string, signal: AbortSignal, transport: typeof fetch = fetch,
): Promise<CompanyResponse> {
  const response = await transport(`/api/company/${encodeURIComponent(inn)}`, { signal, cache: 'no-store' });
  if (!response.ok) {
    if (response.status === 400) throw new Error('Проверьте ИНН и его контрольную сумму.');
    if (response.status === 404) throw new Error('Компания не найдена в подключённом источнике. Заполните сведения вручную.');
    throw new Error('Источник данных недоступен. Можно заполнить сведения вручную.');
  }
  const data = await response.json() as CompanyResponse;
  if (!['demo', 'official'].includes(data.mode) || data.company?.inn !== inn ||
      data.profile?.inn !== inn || !data.profile.provenance || !Array.isArray(data.sources))
    throw new Error('Источник вернул некорректный ответ. Заполните сведения вручную.');
  return data;
}
