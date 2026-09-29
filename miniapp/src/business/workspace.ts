import { emptyProfile, type Profile, type Application } from './domain';
import type { FundingNeed, FundingOpportunity, FundingMatch, ProjectProfile } from '../../api-server/funding-catalog/types';
import { isAllFundingPurposes, normalizeFundingPurpose } from '../../api-server/funding-catalog/purposes';
import { emptyFundingNeed } from '../../api-server/funding-catalog/types';
import { restoreFundingNeed } from './funding';
import { parseFundingProfile } from '../../api-server/funding-catalog/input';
import { applicationReadiness } from './application-readiness';
export type BusinessNotice = { id: string; title: string; createdAt: number; readAt: number | null };
export type Workspace = { profile: Profile | null; projectProfile: ProjectProfile | null; fundingNeed: FundingNeed; saved: string[]; applications: Application[]; detachedApplicationIds?: string[]; businessNotice?: BusinessNotice | null };
export function businessAddedNotice(project = false): BusinessNotice {
  return { id: crypto.randomUUID(), title: project ? 'Поздравляем, вы добавили проект!' : 'Поздравляем, вы добавили компанию!', createdAt: Date.now(), readAt: null };
}
export const workspaceKey = 'opora.workspace';
const blank = (): Workspace => ({ profile: null, projectProfile: null, fundingNeed: { ...emptyFundingNeed }, saved: [], applications: [] });
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const stringMap = (value: unknown) => record(value) ? Object.fromEntries(Object.entries(value).filter(([, v]) => typeof v === 'string')) as Record<string, string> : {};
const nullableNumber = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
export function restoreDocumentTexts(value: unknown): NonNullable<Application['documentTexts']> {
  if (!record(value)) return {};
  let remaining = 60000;
  const result: NonNullable<Application['documentTexts']> = {};
  for (const [name, item] of Object.entries(value).slice(0, 30)) {
    if (!record(item) || typeof item.id !== 'string' || typeof item.name !== 'string' || !Array.isArray(item.pages) || item.pages.length > 200) continue;
    if (!item.pages.every(p => record(p) && Number.isSafeInteger(p.page) && Number(p.page) > 0 && typeof p.text === 'string')) continue;
    const size = item.pages.reduce((n, p) => n + p.text.length, 0);
    if (size > remaining) continue;
    remaining -= size; result[name] = { id: item.id, name: item.name, pages: item.pages.map(p => ({ page: p.page, text: p.text })) };
  }
  return result;
}
export function loadWorkspace(storage: Pick<Storage, 'getItem'>, ids: string[]): Workspace {
  const known = (id: unknown): id is string => typeof id === 'string' && (ids.includes(id) || /^budget-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id) || /^web-[a-f0-9]{24}$/.test(id));
  const read = (key: string) => { try { return JSON.parse(storage.getItem(key) ?? 'null'); } catch { return null; } };
  const current = read(workspaceKey);
  const oldProfile = read('opora.profile.v1');
  const raw = current?.version === 2 ? current.data : { profile: oldProfile, saved: read('opora.saved.v1'), applications: read('opora.apps.v1'),
    fundingNeed: read(`opora.funding-need.v1.${oldProfile?.inn ?? ''}`) };
  const result = blank();
  if (!raw || typeof raw !== 'object') return result;
  const notice = raw.businessNotice;
  if (notice === null) result.businessNotice = null;
  else if (notice && typeof notice.id === 'string' && typeof notice.title === 'string' && notice.title.length <= 150
    && Number.isFinite(notice.createdAt) && (notice.readAt === null || Number.isFinite(notice.readAt))) result.businessNotice = notice;
  const p = raw.profile;
  if (p && typeof p.inn === 'string' && typeof p.name === 'string' && Array.isArray(p.goals)
    && !/учебн|демо/i.test(p.name) && !Object.values(p.provenance ?? {}).some((x) => (x as { mode?: string })?.mode === 'demo')) {
    try {
      const provenance = record(p.provenance) ? Object.fromEntries(Object.entries(p.provenance).filter(([, v]) => record(v)
        && ['sourceId', 'source', 'updatedAt'].every((key) => typeof v[key] === 'string')
        && (v.sourceUrl === null || typeof v.sourceUrl === 'string') && ['official', 'aggregator', 'manual'].includes(String(v.mode))
        && ['source', 'derived', 'manual'].includes(String(v.kind)))) : undefined;
      result.profile = { ...emptyProfile, ...parseFundingProfile(p), inn: p.inn, name: p.name, provenance: provenance as Profile['provenance'] };
    } catch { /* Malformed stored values must not crash React or become matching facts. */ }
  }
  const project = raw.projectProfile;
  if (project?.hasLegalEntity === false && typeof project.name === 'string' && typeof project.region === 'string'
    && typeof project.industry === 'string' && ['idea', 'prototype', 'mvp', 'revenue'].includes(project.stage)) result.projectProfile = {
      name: project.name, region: project.region, industry: project.industry, stage: project.stage, hasLegalEntity: false,
      teamSize: nullableNumber(project.teamSize), fundingNeed: nullableNumber(project.fundingNeed), fundingPurpose: typeof project.fundingPurpose === 'string' ? normalizeFundingPurpose(project.fundingPurpose) ?? project.fundingPurpose : emptyFundingNeed.purpose,
    };
  result.fundingNeed = restoreFundingNeed(JSON.stringify(raw.fundingNeed));
  if (Array.isArray(raw.saved)) result.saved = [...new Set(raw.saved.filter(known))] as string[];
  if (Array.isArray(raw.applications)) result.applications = raw.applications.filter((a: Application) => a && known(a.programId) && typeof a.id === 'string'
    && typeof a.project === 'string' && typeof a.budget === 'string' && record(a.documents)).map((a: Application) => ({
      id: a.id, programId: a.programId, project: a.project, budget: a.budget, createdAt: typeof a.createdAt === 'string' ? a.createdAt : '',
      documents: stringMap(a.documents), documentFiles: stringMap(a.documentFiles), reviewConfirmed: a.reviewConfirmed === true,
      ...(a.documentTexts ? { documentTexts: restoreDocumentTexts(a.documentTexts) } : {}),
      ...(typeof a.generatedDraft === 'string' ? { generatedDraft: a.generatedDraft } : {}),
      ...(typeof a.draftOrigin === 'string' ? { draftOrigin: a.draftOrigin } : {}),
    }));
  if (Array.isArray(raw.detachedApplicationIds)) result.detachedApplicationIds = result.applications
    .filter((app) => raw.detachedApplicationIds.includes(app.id)).map((app) => app.id);
  return result;
}
export function saveWorkspace(storage: Pick<Storage, 'setItem'>, data: Workspace) { storage.setItem(workspaceKey, JSON.stringify({ version: 2, data })); }

/** Preserve drafts, but do not use them as facts about a newly added business. */
export function removeBusiness(storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>, workspace: Workspace): Workspace {
  const next: Workspace = { ...workspace, profile: null, projectProfile: null, fundingNeed: { ...emptyFundingNeed },
    detachedApplicationIds: workspace.applications.map((app) => app.id) };
  if (workspace.businessNotice !== undefined) next.businessNotice = null;
  const keys = new Set(['opora.profile.v1', 'opora.ai.history.v2', 'opora.ai.workspace.v1']);
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key?.startsWith('opora.funding-need.v1.')) keys.add(key);
  }
  const previous = new Map([...keys, workspaceKey].map((key) => [key, storage.getItem(key)]));
  try {
    keys.forEach((key) => storage.removeItem(key));
    saveWorkspace(storage, next);
  } catch (error) {
    previous.forEach((value, key) => {
      try { if (value === null) storage.removeItem(key); else storage.setItem(key, value); } catch { /* Report unavailable storage to the caller. */ }
    });
    throw error;
  }
  return next;
}
export function projectAsProfile(project: ProjectProfile): Profile & Pick<ProjectProfile, 'stage'> {
  return { ...emptyProfile, name: project.name, region: project.region, applicantType: 'project', industry: project.industry, stage: project.stage, goals: project.fundingPurpose && !isAllFundingPurposes(project.fundingPurpose) ? [project.fundingPurpose] : [] };
}
export function applicationStatus(app: Application, opportunity: FundingOpportunity) {
  if (applicationReadiness(app, opportunity).ready) return 'ready_for_review';
  return app.project.trim() || Object.values(app.documents).some(Boolean) ? 'collecting_documents' : 'draft';
}
export const applicationLabels = { draft: 'Черновик', collecting_documents: 'Сбор документов', ready_for_review: 'Комплект готов к проверке перед подачей' };
// Не смешиваем подтверждённое соответствие с вариантами, для которых не хватает данных.
export function personalFunding(matches: FundingMatch[], hasProfile: boolean) {
  if (!hasProfile) return { candidates: [], confirmed: [], pending: [] };
  const candidates = matches.filter((m) => (m.personalEligibility?.candidate ?? m.personalEligibility?.confirmed) === true && !['expired', 'upcoming'].includes(m.status) && m.opportunity.status !== 'closed' && m.opportunity.status !== 'upcoming');
  const confirmed = candidates.filter(m => m.status === 'eligible' && m.personalEligibility?.confirmed === true);
  return { candidates, confirmed, pending: candidates.filter(m => !confirmed.includes(m)) };
}
export function trackedFunding(catalog: FundingOpportunity[], saved: string[], apps: Application[]) {
  const ids = new Set([...saved, ...apps.map((a) => a.programId)]);
  return catalog.filter((o) => ids.has(o.id));
}
export function filterFunding(catalog: FundingOpportunity[], query: string, kind: string, status: string, saved?: string[]) {
  return catalog.filter((o) => (!kind || o.kind === kind) && (!status || o.status === status) && (!saved || saved.includes(o.id))
    && `${o.title} ${o.description} ${o.providerName} ${o.purposes.join(' ')}`.toLocaleLowerCase('ru-RU').includes(query.trim().toLocaleLowerCase('ru-RU')));
}
export { calendarICS } from '../../api-server/funding-catalog/calendar';
export type FundingEvent = { id: string; opportunityId: string; text: string };
export function fundingEvents(catalog: FundingOpportunity[], saved: string[], previous: Record<string, string>, _matches: FundingMatch[], now = new Date()): FundingEvent[] {
  const events: FundingEvent[] = [];
  for (const o of catalog) {
    const days = o.deadline ? (new Date(`${o.deadline}T23:59:59+03:00`).getTime() - now.getTime()) / 86400000 : null;
    if (saved.includes(o.id) && o.status === 'closed') events.push({ id: `closed:${o.id}:${o.version}`, opportunityId: o.id, text: `Прием завершен: ${o.title}` });
    if (saved.includes(o.id) && days !== null && days >= 0 && days <= 14) events.push({ id: `deadline:${o.id}:${o.deadline}`, opportunityId: o.id, text: `Приближается срок: ${o.title} — ${o.deadline}` });
    if (saved.includes(o.id) && previous[o.id] && previous[o.id] !== o.version) events.push({ id: `updated:${o.id}:${o.version}`, opportunityId: o.id, text: `Обновлены условия: ${o.title}` });
  }
  return events;
}
