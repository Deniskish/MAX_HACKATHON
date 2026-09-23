import snapshot from './official-funding.snapshot.json';
import type { FundingOpportunity } from './types';

const operators = ['frprf.ru', 'corpmsp.ru', 'fasie.ru', 'agro.tatarstan.ru', 'exportcenter.ru'];
export function validateOfficialCatalog(input: unknown): FundingOpportunity[] {
  if (!Array.isArray(input) || !input.length) throw new Error('EMPTY_OFFICIAL_CATALOG');
  const ids = new Set<string>();
  for (const item of input) {
    if (!item || typeof item.id !== 'string' || ids.has(item.id) || !item.title || !item.providerName
      || item.source?.type !== 'official' || !item.source.url || !item.source.verifiedAt
      || !/^\d{4}-\d{2}-\d{2}$/.test(item.source.verifiedAt) || !Number.isFinite(Date.parse(item.source.verifiedAt)))
      throw new Error('INVALID_OFFICIAL_SOURCE');
    const url = new URL(item.source.url);
    if (url.protocol !== 'https:' || url.username || url.password ||
      !operators.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`)))
      throw new Error('UNTRUSTED_OFFICIAL_SOURCE');
    if (!['active', 'closed', 'upcoming', 'unknown'].includes(item.status)
      || !Array.isArray(item.applicantTypes) || !item.applicantTypes.length
      || !Array.isArray(item.requirements) || !Array.isArray(item.manualConditions)
      || !Array.isArray(item.requiredDocuments) || !Array.isArray(item.purposes)) throw new Error('INVALID_OPPORTUNITY');
    for (const field of ['amountMin', 'amountMax', 'rateMin', 'rateMax', 'termMonthsMin', 'termMonthsMax'])
      if (item[field] !== null && (typeof item[field] !== 'number' || !Number.isFinite(item[field]) || item[field] < 0)) throw new Error('INVALID_FUNDING_VALUE');
    if (item.deadline !== null && (!/^\d{4}-\d{2}-\d{2}$/.test(item.deadline) || !Number.isFinite(Date.parse(item.deadline)))) throw new Error('INVALID_DEADLINE');
    ids.add(item.id);
  }
  return structuredClone(input);
}
export const officialFundingCatalog = validateOfficialCatalog(snapshot);
export interface FundingProvider { getCatalog(): FundingOpportunity[] }
export class OfficialSnapshotProvider implements FundingProvider {
  getCatalog() { return structuredClone(officialFundingCatalog); }
}
export function fundingCatalogStatus(catalog = officialFundingCatalog) {
  return {
    total: catalog.length,
    ...Object.fromEntries(['active', 'closed', 'upcoming', 'unknown'].map((status) => [status, catalog.filter((o) => o.status === status).length])),
    snapshotVersion: '2026-09-22.1', verifiedAt: '2026-09-22',
    sources: [...new Set(catalog.map((o) => o.source.url))],
  };
}
