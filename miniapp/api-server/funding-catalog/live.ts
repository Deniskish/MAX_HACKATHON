import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { officialFundingCatalog, type FundingProvider } from './official-catalog';
import type { ApplicantType, FundingOpportunity } from './types';
import { providerJson } from '../provider-json';
import { budgetTransport } from './budget-transport';

const origin = 'https://promote.budget.gov.ru';
const guid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export const catalogHash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24);
export type BudgetCard = { competitionId: string; title: string; pppItemName: string; startDate: string; endDate: string;
  isActive: boolean; isNotActive: boolean; selectionRecipients: number[]; maxAmountForPersonInfo: string; competitionType: number };
export function normalizeBudgetCard(row: BudgetCard, now = new Date()): FundingOpportunity {
  if (!row || !guid.test(row.competitionId) || typeof row.title !== 'string' || !row.title.trim()
    || typeof row.pppItemName !== 'string' || !Array.isArray(row.selectionRecipients)) throw new Error('BUDGET_SCHEMA_CHANGED');
  const end = Date.parse(row.endDate), start = Date.parse(row.startDate);
  const recipients: Record<number, ApplicantType> = { 1: 'individual', 2: 'legal_entity', 3: 'individual_entrepreneur' };
  const amount = typeof row.maxAmountForPersonInfo === 'string' && /^\s*(?:до\s*)?[\d\s\u00a0\u202f]+,\d{2}\s*₽\s*$/.test(row.maxAmountForPersonInfo)
    ? Number(row.maxAmountForPersonInfo.replace(/[^\d,]/g, '').replace(',', '.')) : null;
  const facts = { title: row.title, provider: row.pppItemName, start: row.startDate, end: row.endDate,
    recipients: row.selectionRecipients, amount, active: row.isActive, withdrawn: row.isNotActive };
  return { id: `budget-${row.competitionId}`, title: row.title, providerName: row.pppItemName,
    kind: 'subsidy', providerType: 'government', description: row.title, amountMin: null, amountMax: amount,
    rateMin: null, rateMax: null, termMonthsMin: null, termMonthsMax: null,
    // An absent region/purpose is unknown, never proof of nationwide eligibility.
    regions: [], purposes: [], sectors: [], okvedPrefixes: [], companyTypes: [],
    applicantTypes: row.selectionRecipients.map((x) => recipients[x]).filter(Boolean),
    status: row.isNotActive || Number.isFinite(end) && end < now.getTime() ? 'closed'
      : start > now.getTime() ? 'upcoming' : row.isActive === true && start <= now.getTime() && end >= now.getTime() ? 'active' : 'unknown',
    manualConditions: ['Уточнить территорию, отрасль и полный перечень требований в объявлении отбора.'],
    requirements: [], requiredDocuments: [], deadline: Number.isFinite(end) ? new Date(end).toISOString().slice(0, 10) : null,
    difficulty: 'medium', preparationDays: null,
    source: { type: 'official', name: 'Минфин России · Электронный бюджет',
      url: `${origin}/public/minfin/selection/view/${row.competitionId}?competitionType=0`,
      updatedAt: now.toISOString().slice(0, 10), verifiedAt: now.toISOString().slice(0, 10) },
    version: catalogHash(facts), imported: { provider: 'budget', startsAt: row.startDate, endsAt: row.endDate } };
}
export class BudgetSource {
  constructor(private transport: typeof fetch = budgetTransport) {}
  private async json(route: string, body?: unknown, signal?: AbortSignal) {
    const response = await this.transport(origin + route, { method: body ? 'POST' : 'GET', redirect: 'error',
      headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.any([AbortSignal.timeout(20000), ...(signal ? [signal] : [])]) });
    if (!response.ok) { await response.body?.cancel(); throw new Error(`BUDGET_HTTP_${response.status}`); }
    return await providerJson(response, 2_000_000) as any;
  }
  async page(currentPage: number) {
    const data = await this.json('/m-data/api/v1/activity/public-view/list-activity-card', {
      currentPage, entryCount: 100, recipientCategory: [], recipientSelectionWayId: [], minActivityAmountForPerson: null,
      maxActivityAmountForPerson: null, coFinancing: [], activityYear: [], subsidyTypeId: [], budgetType: [], activityCategory: [],
      directionId: [], okvedId: [], textTerms: [], realizationPlace: [], pppCode: [], activityType: [], maxAmountType: [],
      distributionType: [], sortDirection: 0, sortMember: 'Default', isSelection: true, geography: [], tags: [],
      selectionLicenseRequired: [], accreditationRequired: [], selectionType: 1, soOktmos: [] });
    if (!Array.isArray(data?.item1?.items) || !Number.isInteger(data.item1.totalPages) || data.item1.currentPage !== currentPage
      || data.item1.items.length > 100 || !Number.isInteger(data.item1.totalEntries)) throw new Error('BUDGET_SCHEMA_CHANGED');
    return { rows: data.item1.items as BudgetCard[], totalPages: data.item1.totalPages as number, total: data.item1.totalEntries as number };
  }
  async details(id: string) {
    const deadline = AbortSignal.timeout(45000);
    const json = (route: string) => this.json(route, undefined, deadline);
    const competition = id.replace(/^budget-/, '');
    if (!guid.test(competition)) throw new Error('INVALID_ID');
    const version = await json(`/public/api/v1/minfin-elastic/competition?competitionId=${competition}`);
    if (typeof version !== 'string' || !guid.test(version)) throw new Error('BUDGET_DETAIL_UNAVAILABLE');
    const base = `/m-data/api/v1/selection/public-view`;
    const basic = await json(`${base}/view-basic/${competition}?selectionId=${version}`);
    const competitionStatus = await json(`${base}/competition/${competition}?versionId=${version}`);
    const activityVersion = await json(`/public/api/v1/minfin-elastic/competition/general-entity?competitionId=${competition}`);
    if (typeof activityVersion !== 'string' || !guid.test(activityVersion)) throw new Error('BUDGET_SCHEMA_CHANGED');
    const activityLink = await json(`/m-data/api/v1/activity/public-view/${activityVersion}/view-link-info`);
    if (!guid.test(activityLink?.activityId)) throw new Error('BUDGET_SCHEMA_CHANGED');
    const activity = await json(`/m-data/api/v1/activity/public-view/${activityLink.activityId}/view?versionId=${activityVersion}`);
    const requirements = await json(`/m-data/api/v1/activity/public-view/${activityLink.activityId}/activity-view-requirements?versionId=${activityVersion}`);
    if (!basic?.selectionName || !activity?.title || !Array.isArray(activity.geography) || !Array.isArray(requirements)) throw new Error('BUDGET_SCHEMA_CHANGED');
    // Only public programme facts; organizer contacts and applicant data are excluded.
    const strip = (s: unknown) => typeof s === 'string' ? s.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim() : '';
    const text = [basic.selectionName, activity.title, `Территория действия: ${activity.geography.join('; ')}`,
      activity.description, activity.whoCanApply, activity.whatCanBeUsedFor, activity.npaTarget, activity.criteriaForEvaluation,
      activity.maxAmountOfSubsidy, activity.expectedResult, ...requirements.map((r: any) => r.userItemName || r.itemName)].map(strip).filter(Boolean).join('\n');
    return { text: text.slice(0, 48000), complete: text.length <= 48000 && !!activity.whoCanApply,
      version: `${version}:${activityVersion}`, checkedAt: new Date().toISOString(),
      geography: activity.geography.filter((g: unknown): g is string => typeof g === 'string'),
      accepting: competitionStatus?.selectionAcceptingApplicationInfo?.canCreateApplication === true,
      startsAt: basic.beginDateCompetition as string, endsAt: basic.endDateCompetition as string };
  }
}
type CatalogState = { entries: FundingOpportunity[]; checkedAt: string | null; total: number; cursor: number; error: string | null };
export class LiveCatalog implements FundingProvider {
  private state: CatalogState = { entries: [], checkedAt: null, total: 0, cursor: 11, error: null };
  private syncing = false;
  private pendingDetails = new Map<string, Promise<FundingOpportunity | undefined>>();
  constructor(private directory: string, private source = new BudgetSource()) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    try { const state = JSON.parse(readFileSync(path.join(directory, 'catalog.json'), 'utf8'));
      if (Array.isArray(state.entries) && state.entries.every((o: FundingOpportunity) => o.id?.startsWith('budget-') && o.source?.url?.startsWith(origin + '/'))) this.state = state;
    } catch { /* First start or unreadable cache: keep bundled official catalogue. */ }
  }
  getCatalog() {
    const now = Date.now();
    return [...officialFundingCatalog, ...this.state.entries.map((o) => o.imported?.endsAt && Date.parse(o.imported.endsAt) < now
      ? { ...o, status: 'closed' as const } : o)];
  }
  status() { return { checkedAt: this.state.checkedAt, imported: this.state.entries.length, totalAtSource: this.state.total,
    nextPage: this.state.cursor, error: this.state.error, syncing: this.syncing, intervalMinutes: 15 }; }
  private save() {
    const file = path.join(this.directory, 'catalog.json');
    writeFileSync(file + '.tmp', JSON.stringify(this.state), { mode: 0o600 }); renameSync(file + '.tmp', file);
  }
  async sync(pages = 10) {
    if (this.syncing) return;
    this.syncing = true;
    try {
      const entries = new Map(this.state.entries.map((o) => [o.id, o]));
      let cursor = this.state.cursor, total = this.state.total;
      // Refresh the first pages (the portal puts current selections first), then walk the remaining catalogue.
      // Cursor persists across restarts; each pass is bounded and failures retain the last good snapshot.
      const requested = new Set([...Array.from({ length: pages }, (_, i) => i + 1), this.state.cursor]);
      let mainTail = pages;
      for (const page of requested) {
        const result = await this.source.page(page);
        total = result.total;
        for (const row of result.rows) {
          if (row.competitionType !== 0) continue;
          const item = normalizeBudgetCard(row);
          const previous = entries.get(item.id);
          if (item.status !== 'closed' || previous) entries.set(item.id, { ...item,
            source: previous?.version === item.version ? previous.source : item.source,
            imported: { ...item.imported!, firstSeenAt: previous?.imported?.firstSeenAt ?? new Date().toISOString(),
              detail: previous?.version === item.version ? previous.imported?.detail : undefined } });
        }
        // Continue through the current-selection block when it grows beyond the first 1,000 cards.
        if (page === mainTail && page < Math.min(50, result.totalPages) && result.rows.some((row) => row.competitionType === 0 && normalizeBudgetCard(row).status === 'active')) {
          mainTail++; requested.add(mainTail);
        }
        if (page === this.state.cursor) cursor = page >= result.totalPages ? pages + 1 : page + 1;
        if (page >= result.totalPages) break;
        await new Promise((resolve) => setTimeout(resolve, 350));
      }
      this.state.entries = [...entries.values()]; this.state.cursor = cursor; this.state.total = total;
      this.state.checkedAt = new Date().toISOString(); this.state.error = null; this.save();
    } catch { this.state.error = 'source_unavailable'; this.save(); }
    finally { this.syncing = false; }
  }
  enrich(id: string) {
    const pending = this.pendingDetails.get(id);
    if (pending) return pending;
    const request = this.loadDetails(id).finally(() => this.pendingDetails.delete(id));
    this.pendingDetails.set(id, request); return request;
  }
  private async loadDetails(id: string) {
    const entry = this.state.entries.find((o) => o.id === id);
    if (!entry?.imported) return entry;
    if (entry.imported.detail && Date.now() - Date.parse(entry.imported.detail.checkedAt) < 3600000) return entry;
    const version = entry.version;
    const detail = await this.source.details(id);
    // A concurrent import may have changed this selection; do not attach an old response to it.
    const current = this.state.entries.find((o) => o.id === id);
    if (current?.imported && current.version === version) {
      current.imported.detail = detail; current.imported.startsAt = detail.startsAt; current.imported.endsAt = detail.endsAt; this.save();
    }
    return current;
  }
}
