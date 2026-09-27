import { createHash } from 'node:crypto';
import type { FundingOpportunity } from './types';
const normalize = (s: string) => s.toLowerCase().replace(/ё/g, 'е').replace(/[^а-яa-z0-9]/g, '');
// Exact normalized facts only: similarly named regional schemes must not be merged.
export function measureKey(o: FundingOpportunity) {
  return createHash('sha256').update(JSON.stringify([normalize(o.title), normalize(o.providerName), o.kind,
    o.regions === 'all' ? 'all' : o.regions.map(normalize).sort(), o.deadline])).digest('hex');
}
export function mergeCatalog(entries: FundingOpportunity[]) {
  const byId = new Map<string, FundingOpportunity>();
  for (const o of entries) byId.set(o.id, o);
  const keys = new Set<string>();
  return [...byId.values()].filter(o => { const key = measureKey(o); if (keys.has(key)) return false; keys.add(key); return true; });
}
export function currentImported(o: FundingOpportunity, now: number, budgetCheckedAt?: string | null) {
  const data = o.imported;
  if (!data || data.verification === 'pending') return false;
  const checked = Date.parse(data.checkedAt ?? (data.provider === 'budget' ? budgetCheckedAt ?? '' : ''));
  return Number.isFinite(checked) && checked <= now + 60000 && now - checked < 3600000;
}
