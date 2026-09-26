import type { FundingKind, FundingOpportunity, OpportunityState, ProjectProfile } from '../../api-server/funding-catalog/types';
import { fundingKindLabels } from '../../api-server/funding-catalog/presentation';
import { validInn, type Profile } from './domain';

export type CatalogFilters = { region: string; kinds: FundingKind[]; status: OpportunityState | ''; scope: 'personal' | 'all' | 'saved' };
export const catalogFiltersKey = 'opora.catalog-filters.v1';
export const defaultCatalogFilters = (): CatalogFilters => ({ region: '', kinds: [], status: '', scope: 'personal' });

export function hasSupportProfile(company: Profile | null, project: ProjectProfile | null) {
  return !!(company && validInn(company.inn) && company.name.trim() && company.region.trim())
    || !!(project && project.hasLegalEntity === false && project.name.trim() && project.region.trim() && project.industry.trim()
      && ['idea', 'prototype', 'mvp', 'revenue'].includes(project.stage));
}

export function loadCatalogFilters(storage: Pick<Storage, 'getItem'>): CatalogFilters {
  const fallback = defaultCatalogFilters();
  try {
    const raw = JSON.parse(storage.getItem(catalogFiltersKey) ?? 'null');
    if (!raw || typeof raw !== 'object') return fallback;
    return {
      region: typeof raw.region === 'string' && raw.region.length <= 200 ? raw.region : '',
      kinds: Array.isArray(raw.kinds) ? [...new Set(raw.kinds.filter((kind: unknown): kind is FundingKind =>
        typeof kind === 'string' && Object.prototype.hasOwnProperty.call(fundingKindLabels, kind)))] as FundingKind[] : [],
      status: ['active', 'closed', 'upcoming', 'unknown'].includes(raw.status) ? raw.status : '',
      scope: ['personal', 'all', 'saved'].includes(raw.scope) ? raw.scope : 'personal',
    };
  } catch { return fallback; }
}
export function saveCatalogFilters(storage: Pick<Storage, 'setItem'>, filters: CatalogFilters) {
  storage.setItem(catalogFiltersKey, JSON.stringify(filters));
}

export function catalogRegions(catalog: FundingOpportunity[]) {
  return [...new Set(catalog.flatMap((o) => o.regions === 'all' ? [] : o.regions))].sort((a, b) => a.localeCompare(b, 'ru'));
}

/** Presentation only: does not change matching scores, eligibility, catalogue facts or drafts. */
export function selectCatalog(catalog: FundingOpportunity[], filters: CatalogFilters, context: {
  hasProfile: boolean; demo: boolean; personalIds: string[]; saved: string[];
}) {
  if (!context.hasProfile && !context.demo) return [];
  const personal = new Set(context.personalIds), saved = new Set(context.saved);
  return catalog.filter((o) =>
    (filters.scope !== 'saved' || saved.has(o.id))
    && (context.demo || filters.scope !== 'personal' || personal.has(o.id))
    && (!filters.kinds.length || filters.kinds.includes(o.kind))
    && (!filters.region || o.regions === 'all' || filters.region !== 'all' && o.regions.includes(filters.region))
    && (filters.status ? (o.status ?? 'unknown') === filters.status : context.demo || filters.scope === 'saved' || o.status !== 'closed'));
}
