import { detectSensitiveText, PrivacyError } from '../privacy';
import { parseFundingNeed, parseFundingProfile } from '../funding-catalog/input';
import { aiTasks, type AIRequest, type AITask } from './types';
import { officialFundingCatalog } from '../funding-catalog/official-catalog';

export function object(value: unknown): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PrivacyError('INVALID_INPUT');
  return value as Record<string, any>;
}
function text(value: unknown, limit: number, required = false): string {
  if (value === undefined && !required) return '';
  if (typeof value !== 'string' || value.length > limit || (required && !value.trim())) throw new PrivacyError('INVALID_INPUT');
  return value.normalize('NFKC').replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, '').trim();
}
// v2 сохраняет смысл разрешённого пользователем текста. Это минимизация данных,
// а не обещание распознать любые персональные данные в произвольном документе.
export function prepareAIContext(input: unknown) {
  const raw = object(input), ctx = object(raw.context);
  if (!aiTasks.includes(raw.task)) throw new PrivacyError('INVALID_INPUT');
  const identifiers = ctx.identifiers === undefined ? {} : object(ctx.identifiers);
  const privateValues = Object.entries(identifiers).filter(([key]) => ['name', 'inn', 'ogrn', 'fullName', 'email', 'phone', 'address', 'passport', 'snils', 'bankAccount'].includes(key))
    .map(([, value]) => text(value, 500)).filter((v) => v.length >= 3).sort((a, b) => b.length - a.length);
  const redact = (value: string) => {
    let clean = value.normalize('NFKC');
    for (const secret of privateValues) clean = clean.split(secret).join('[РЕКВИЗИТЫ СКРЫТЫ]');
    return detectSensitiveText(clean).replace(/⟦PRIVATE_[^⟧]*⟧/gu, '[СКРЫТО]');
  };
  let profile, need;
  try {
    profile = parseFundingProfile(ctx.profile ?? {});
    for (const key of ['region', 'industry'] as const) if (profile[key]) profile[key] = redact(profile[key]!);
    if (profile.goals) profile.goals = profile.goals.map(redact);
    need = ctx.need?.purpose ? parseFundingNeed(ctx.need) : undefined;
  } catch { throw new PrivacyError('INVALID_FUNDING_NEED'); }
  const programId = ctx.programId;
  if (programId !== undefined && !officialFundingCatalog.some((p) => p.id === programId)) throw new PrivacyError('INVALID_PROGRAM');
  if (raw.history !== undefined && (!Array.isArray(raw.history) || raw.history.length > 20)) throw new PrivacyError('INVALID_INPUT');
  const history = (raw.history ?? []).slice(-8).map((m: unknown) => {
    const item = object(m);
    if (!['user', 'assistant'].includes(item.role)) throw new PrivacyError('INVALID_INPUT');
    return { role: item.role as 'user' | 'assistant', text: redact(text(item.text, 12000, true)).slice(0, 3000) };
  });
  if (ctx.documents !== undefined && (!Array.isArray(ctx.documents) || ctx.documents.length > 8)) throw new PrivacyError('INVALID_INPUT');
  let characters = 0; const ids = new Set<string>();
  const documents = (ctx.documents ?? []).map((d: unknown, index: number) => {
    const item = object(d);
    const id = text(item.id, 60, true);
    if (ids.has(id) || !/^[\w-]+$/.test(id) || !Array.isArray(item.pages) || !item.pages.length || item.pages.length > 40) throw new PrivacyError('INVALID_INPUT');
    ids.add(id);
    const pageNumbers = new Set<number>();
    return { id, name: `Документ ${index + 1}`, pages: item.pages.map((p: unknown) => {
      const page = object(p);
      if (!Number.isInteger(page.page) || page.page < 1 || page.page > 1000 || pageNumbers.has(page.page)) throw new PrivacyError('INVALID_INPUT');
      pageNumbers.add(page.page);
      const content = text(page.text, 40000); characters += content.length;
      if (characters > 60000) throw new PrivacyError('FIELD_TOO_LONG');
      return { page: page.page, text: redact(content) };
    }) };
  });
  if (ctx.budget != null && (typeof ctx.budget !== 'number' || !Number.isSafeInteger(ctx.budget) || ctx.budget < 0 || ctx.budget > 1e15)) throw new PrivacyError('INVALID_INPUT');
  let workspace: AIRequest['context']['workspace'];
  if (ctx.workspace !== undefined) {
    const value = object(ctx.workspace);
    if (!Array.isArray(value.savedIds) || value.savedIds.length > 50 || !Array.isArray(value.applications) || value.applications.length > 30) throw new PrivacyError('INVALID_INPUT');
    const program = (id: unknown) => {
      const entry = officialFundingCatalog.find((o) => o.id === id);
      if (!entry) throw new PrivacyError('INVALID_PROGRAM');
      return entry;
    };
    workspace = { savedIds: [...new Set<string>(value.savedIds.map((id: unknown) => program(id).id))], applications: value.applications.map((a: unknown) => {
      const item = object(a), entry = program(item.programId);
      if (item.budget != null && (typeof item.budget !== 'number' || !Number.isSafeInteger(item.budget) || item.budget < 0 || item.budget > 1e15)) throw new PrivacyError('INVALID_INPUT');
      return { programId: entry.id, project: redact(text(item.project, 2000)), budget: item.budget ?? null,
        preparedDocuments: Array.isArray(item.preparedDocuments) ? entry.requiredDocuments.filter((d) => item.preparedDocuments.includes(d)) : [],
        hasDraft: item.hasDraft === true, reviewConfirmed: item.reviewConfirmed === true };
    }) };
  }
  const request: AIRequest = {
    task: raw.task as AITask, question: redact(text(raw.question, 2000, true)), history,
    context: { profile, need, programId, page: text(ctx.page, 40), project: redact(text(ctx.project, 10000)),
      budget: ctx.budget ?? null, draft: redact(text(ctx.draft, 18000)), draftKind: text(ctx.draftKind, 100),
      preparedDocuments: Array.isArray(ctx.preparedDocuments) ? ctx.preparedDocuments.slice(0, 30).map((v: unknown) => redact(text(v, 160))) : [], documents, workspace },
  };
  return { request, redact };
}
