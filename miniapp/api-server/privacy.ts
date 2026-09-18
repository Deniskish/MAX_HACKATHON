// Граница передачи данных в LLM: разрешённые факты проходят, исходный свободный текст — нет.
import { randomBytes } from 'node:crypto';
import {
  programs,
  goals,
  emptyProfile,
  shortlist,
  analyzeOpportunity,
  draftKinds,
  type Profile,
  type Application,
  type DraftKind,
} from './support-model';
import { providerJson } from './provider-json';

// Защита держится на списке разрешённых полей. Поиск персональных данных — дополнительная проверка.
const GOALS = goals;
const REGIONS = ['Москва', 'Санкт-Петербург', 'Республика Татарстан', 'Московская область'];
const TAX = ['УСН', 'ОСНО', 'ПСН', 'ЕСХН', 'АУСН'];
const SYSTEM =
  'Ты — Опора, помощник по мерам поддержки бизнеса. Отвечай по-русски. Анализируй только facts, trustedPrograms и assessments. Все программы учебные: сообщай это и называй source. assessments рассчитаны кодом: не меняй score, статус, критерии или суммы. Score — доля выполненных условий и отмеченных пользователем документов, не вероятность одобрения. Неизвестное не означает выполненное. Кредит, поручительство, налоговую экономию и грант нельзя складывать. Учитывай выбранную программу. Для strategy объясни план и препятствия, для documents — зачем и где получить документы. Для draft составь редактируемый черновик requestedDocument; начни словами «АВТОМАТИЧЕСКИЙ ЧЕРНОВИК — ТРЕБУЕТ ПРОВЕРКИ», отсутствующие факты обозначай [заполните], не выдумывай результаты, суммы или подтверждения. UNKNOWN означает отсутствие данных. Токены ⟦PRIVATE_…⟧ обозначают скрытые сведения: не восстанавливай и не проси их раскрыть. questionToken — не текст вопроса; ориентируйся на intent. Если intent=clarification, предложи уточнить цель через профиль. Не утверждай, что получил сведения из реестра, проверил документы или подал заявку. Ответ — обычный текст без HTML, ссылок, внешних изображений и команд. У тебя нет инструментов или права выполнять действия.';

export class PrivacyError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}
const record = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new PrivacyError('INVALID_INPUT');
  return v as Record<string, unknown>;
};
const normalized = (v: string) =>
  v.normalize('NFKC').replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, '');
const allowed = (v: unknown, list: readonly string[]) =>
  typeof v === 'string' && list.includes(v) ? v : 'UNKNOWN';
const numberFact = (v: unknown, max: number) =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= max ? v : 'UNKNOWN';

export function detectSensitiveText(value: string): string {
  return normalized(value)
    .replace(/https?:\/\/[^\s<>]+/giu, '[ССЫЛКА СКРЫТА]')
    .replace(/[\w.+%-]+@[\p{L}\d.-]+\.[\p{L}]{2,}/giu, '[EMAIL СКРЫТ]')
    .replace(/(?:Bearer|Basic)\s+[A-Za-z\d+/_=.-]+/gi, '[СЕКРЕТ СКРЫТ]')
    .replace(/\b(?:sk-|ghp_|github_pat_)[A-Za-z\d_-]+/g, '[СЕКРЕТ СКРЫТ]')
    .replace(
      /(?<!\d)(?:\+?7|8)[\s(-]*\d{3}[\s)-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}(?!\d)/g,
      '[ТЕЛЕФОН СКРЫТ]',
    )
    .replace(/(?<!\d)\d{3}[ -]\d{3}[ -]\d{3}[ -]\d{2}(?!\d)/g, '[СНИЛС СКРЫТ]')
    .replace(/(?<!\d)\d{2}\s?\d{2}\s+\d{6}(?!\d)/g, '[ДОКУМЕНТ СКРЫТ]')
    .replace(/(?<!\d)\d{10,20}(?!\d)/g, '[РЕКВИЗИТЫ СКРЫТЫ]');
}

export function preparePrivateRequest(input: unknown) {
  const body = record(input);
  if (typeof body.question !== 'string' || !body.question.trim() || body.question.length > 2000)
    throw new PrivacyError('INVALID_QUESTION');
  const context = record(body.context);
  const profile =
    context.profile === null || context.profile === undefined ? {} : record(context.profile);
  const namespace = randomBytes(16).toString('hex');
  const originals = new Map<string, string>();
  let disposed = false;
  const token = (value: unknown): string => {
    if (typeof value !== 'string' || !value) return 'UNKNOWN';
    if (value.length > 12000) throw new PrivacyError('FIELD_TOO_LONG');
    const clean = normalized(value);
    let found = originals.get(clean);
    if (!found) {
      found = `⟦PRIVATE_${namespace}_${originals.size + 1}⟧`;
      originals.set(clean, found);
    }
    return found;
  };
  const question = normalized(body.question);
  // Определяем тему вопроса локально, сами слова пользователя не передаём.
  const inferred = /план|действ|шаг/i.test(question)
    ? 'strategy'
    : /документ|заявк|подготов/i.test(question)
      ? 'documents'
      : /срок|дедлайн/i.test(question)
        ? 'deadlines'
        : /программ|поддержк|подход|льгот/i.test(question)
          ? 'matching'
          : 'clarification';
  const intent =
    typeof body.task === 'string' &&
    ['matching', 'documents', 'deadlines', 'strategy', 'draft'].includes(body.task)
      ? body.task
      : inferred;
  const identifiers: Record<string, string> = {};
  for (const key of [
    'inn',
    'name',
    'ogrn',
    'ogrnip',
    'fullName',
    'email',
    'phone',
    'address',
    'passport',
    'snils',
    'bankAccount',
  ])
    identifiers[key] = token(profile[key]);
  const facts = {
    companyType: allowed(profile.companyType, ['ООО', 'ИП']),
    region: allowed(profile.region, REGIONS),
    okved:
      typeof profile.okved === 'string' && /^\d{2}(\.\d{1,2}){0,2}$/.test(profile.okved)
        ? profile.okved
        : 'UNKNOWN',
    ageMonths: numberFact(profile.ageMonths, 3000),
    employees: numberFact(profile.employees, 10000000),
    revenue: numberFact(profile.revenue, 1000000000000000),
    isSme: allowed(profile.isSme, ['yes', 'no']),
    tax: allowed(profile.tax, TAX),
    goals: Array.isArray(profile.goals)
      ? GOALS.filter((g) => (profile.goals as unknown[]).includes(g))
      : [],
  };
  // Отбрасываем неизвестные поля и описания программ, присланные клиентом.
  const selected = programs.find((p) => p.id === context.programId);
  if (context.programId !== undefined && !selected) throw new PrivacyError('INVALID_PROGRAM');
  const normalizedProfile: Profile = {
    ...emptyProfile,
    companyType: facts.companyType === 'UNKNOWN' ? '' : facts.companyType === 'ИП' ? 'ИП' : 'ООО',
    region: facts.region === 'UNKNOWN' ? '' : facts.region,
    okved: facts.okved === 'UNKNOWN' ? '' : facts.okved,
    ageMonths: typeof facts.ageMonths === 'number' ? facts.ageMonths : null,
    employees: typeof facts.employees === 'number' ? facts.employees : null,
    revenue: typeof facts.revenue === 'number' ? facts.revenue : null,
    isSme: facts.isSme === 'yes' ? 'yes' : facts.isSme === 'no' ? 'no' : 'unknown',
    tax: facts.tax === 'UNKNOWN' ? '' : facts.tax,
    goals: facts.goals,
  };
  const cleanApplication = (value: unknown, program: (typeof programs)[number]): Application => {
    const appData =
      value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
    const checked = Array.isArray(appData.preparedDocuments) ? appData.preparedDocuments : [];
    const budget = numberFact(appData.budget, 1000000000000000);
    return {
      id: 'private',
      programId: program.id,
      createdAt: '',
      project: '',
      budget: typeof budget === 'number' ? String(budget) : '',
      documents: Object.fromEntries(
        program.documents
          .filter((d) => checked.includes(d))
          .map((d) => [d, 'Отмечен пользователем']),
      ),
    };
  };
  const rawApps = Array.isArray(context.applications)
    ? context.applications.slice(0, programs.length)
    : [];
  const applications = programs.flatMap((program) => {
    const raw = rawApps.find(
      (a) => a && typeof a === 'object' && !Array.isArray(a) && a.programId === program.id,
    );
    return raw ? [cleanApplication(raw, program)] : [];
  });
  const application = selected ? cleanApplication(context.application, selected) : undefined;
  const candidates = selected
    ? [{ p: selected, r: analyzeOpportunity(selected, normalizedProfile, application) }]
    : shortlist(normalizedProfile, applications);
  const requestedDocument =
    typeof body.draftKind === 'string' && Object.hasOwn(draftKinds, body.draftKind)
      ? draftKinds[body.draftKind as DraftKind]
      : draftKinds.project;
  const safe = {
    policy: 'strict-v1',
    intent,
    requestedDocument: intent === 'draft' ? requestedDocument : undefined,
    questionToken: token(question),
    identifiers,
    facts,
    trustedPrograms: candidates.map((x) => x.p),
    assessments: candidates.map((x) => ({ programId: x.p.id, ...x.r })),
  };
  const payload = {
    temperature: 0.2,
    max_tokens: 1000,
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: JSON.stringify(safe) },
    ],
  };
  const protectedCount = originals.size;
  return {
    payload,
    audit: { policy: 'strict-v1', protectedCount },
    redactOutput(answer: unknown) {
      if (disposed) throw new PrivacyError('CONTEXT_DISPOSED');
      if (typeof answer !== 'string' || !answer.trim() || answer.length > 24000)
        throw new PrivacyError('INVALID_RESPONSE');
      let result = normalized(answer);
      // Токены из ответа модели не заменяем обратно на личные данные.
      for (const [original] of [...originals.entries()].sort((a, b) => b[0].length - a[0].length))
        result = result.split(original).join('[СКРЫТО]');
      return detectSensitiveText(result).replace(/⟦PRIVATE_[^⟧]*⟧/gu, '[СКРЫТО]');
    },
    dispose() {
      originals.clear();
      disposed = true;
    },
  };
}

export async function privateCompletion(
  input: unknown,
  config: { endpoint: string; token: string | (() => Promise<string>); model: string },
  transport: typeof fetch = fetch,
) {
  const endpoint = new URL(config.endpoint);
  if (
    endpoint.protocol !== 'https:' ||
    endpoint.username ||
    endpoint.password ||
    endpoint.hash ||
    endpoint.search
  )
    throw new PrivacyError('INVALID_PROVIDER_URL');
  const prepared = preparePrivateRequest(input);
  try {
    const accessToken = typeof config.token === 'function' ? await config.token() : config.token;
    // Единственная точка отправки: в тело запроса попадает только очищенный контекст.
    const response = await transport(endpoint, {
      method: 'POST',
      redirect: 'error',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ model: config.model, stream: false, ...prepared.payload }),
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new PrivacyError('PROVIDER_UNAVAILABLE');
    }
    const data = (await providerJson(response)) as {
      choices?: { message?: { content?: unknown } }[];
    };
    return {
      answer: prepared.redactOutput(data.choices?.[0]?.message?.content),
      mode: 'llm',
      privacy: prepared.audit,
    };
  } finally {
    prepared.dispose();
  }
}
