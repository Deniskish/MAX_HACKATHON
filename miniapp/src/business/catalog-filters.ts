import type { FundingOpportunity } from '../../api-server/funding-catalog/types';
import { normalizeRegion } from '../../api-server/funding-catalog/source-registry';

export function catalogRegions(catalog: FundingOpportunity[]) {
  const regions = new Map<string, string>();
  for (const o of catalog) if (o.regions !== 'all') {
    for (const name of o.regions) {
      const key = normalizeRegion(name);
      if (key && !regions.has(key)) regions.set(key, name);
    }
  }
  return [...regions].sort((a, b) => a[1].localeCompare(b[1], 'ru'));
}

export function matchesCatalogRegion(o: FundingOpportunity, region: string) {
  if (!region) return true;
  if (region === 'all') return o.regions === 'all';
  // A nationwide measure also operates in a selected region.
  return o.regions === 'all' || o.regions.some(name => normalizeRegion(name) === region);
}
