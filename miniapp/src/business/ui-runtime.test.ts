import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { useSystemTheme } from '../theme';
import { ThemedImage } from './ThemedImage';
import { aiErrorMessage, requestAI, type AIRequest } from './ai-client';
import { getAIActivity, subscribeAIActivity } from './ai-activity';
import { analysisDigest, analysisMaxAge, reusableAnalysis } from './workspace-analysis-cache';
import { AIResultView } from './AIExperience';
import { AccountPanel } from './AccountPanel';
import { SupportNotificationSettings } from './SupportNotifications';
import { AdaptiveInsight } from './AdaptiveInsight';
import { DetailSteps, preparationProgress, PreparationRequirements } from './VisualWidgets';
import { InfoDisclosureRow } from './InfoDisclosureRow';
import { AppNavigation, navigationTab } from './AppChrome';
import { DemoSubmission } from './VerificationDemo';

const request: AIRequest = { task: 'intake', question: 'Мастерская мебели', context: {} };
const answer = { mode: 'llm', answer: 'Ответ', actions: [], citations: [], matches: [], findings: [], scenarios: [], followups: [], tools: [] };

test('service diagnostics stay out of settings and analysis while recovery actions remain available', () => {
  const error = 'PRIVATE_PROVIDER_DIAGNOSTIC HTTP 500';
  const noop = () => {};
  const account = renderToStaticMarkup(createElement(AccountPanel, { state: {
    account: null, error, available: true, loading: false, refresh: async () => {},
    save: async () => { throw new Error(error); }, remove: async () => { throw new Error(error); },
  }, onRestore: noop, onSave: noop, hasCompany: false }));
  assert.doesNotMatch(account, /PRIVATE_PROVIDER|HTTP 500|role="alert"/);
  assert.match(account, /Повторить вход/);
  const notifications = renderToStaticMarkup(createElement(SupportNotificationSettings, { notifications: {
    enabled: true, bot: false, aiConfigured: false, items: [], available: true, busy: false, error,
    monitor: {lastRun: null, lastError: error}, subscribe: async () => false, read: async () => {},
  } }));
  assert.doesNotMatch(notifications, /PRIVATE_PROVIDER|HTTP 500|недоступ|role="alert"/);
  assert.match(notifications, /type="checkbox"/);
  const analysis = renderToStaticMarkup(createElement(AdaptiveInsight, { section: 'profile', onAction: noop,
    analysis: { status: 'unavailable', error, refresh: noop } as Parameters<typeof AdaptiveInsight>[0]['analysis'] }));
  assert.doesNotMatch(analysis, /PRIVATE_PROVIDER|HTTP 500|role="alert"/);
  assert.match(analysis, /Повторить анализ/);
});

test('a cached provider failure cannot reappear as an AI answer or successful analysis', () => {
  const result = { ...answer, mode: 'local' as const, answer: 'PRIVATE_PROVIDER_DIAGNOSTIC',
    notice: 'PRIVATE_PROVIDER_DIAGNOSTIC', providerFailure: 'PROVIDER_UNAVAILABLE' as const };
  assert.equal(renderToStaticMarkup(createElement(AIResultView, { result })), '');
});

test('unsaved submission offers retry without claiming acceptance or exposing the storage failure', () => {
  const html = renderToStaticMarkup(createElement(DemoSubmission, {
    demo: { state: { enabled: true, signedIn: true, inn: '7707083893', role: 'director', receipts: [] },
      error: 'PRIVATE_STORAGE_DIAGNOSTIC', update: () => false, reset: () => false, submit: () => false,
    } as Parameters<typeof DemoSubmission>[0]['demo'],
    company: { inn: '7707083893', name: 'Компания' } as Parameters<typeof DemoSubmission>[0]['company'],
    applicationId: 'test', title: 'Программа', ready: true, onVerify: () => {},
  }));
  assert.doesNotMatch(html, /PRIVATE_STORAGE|Заявка принята|role="alert"/);
  assert.match(html, /Повторить отправку/);
});

test('theme and themed artwork can render in Node without a browser or image loader', () => {
  function Theme() { return createElement('span', null, useSystemTheme()); }
  assert.equal(renderToStaticMarkup(createElement(Theme)), '<span>dark</span>');
  assert.match(renderToStaticMarkup(createElement(ThemedImage, { src: '/assets/glass/ring.png', alt: '' })), /dark-ring-480/);
});

test('AI rejects malformed payloads before message rendering', async (t) => {
  for (const data of [null, {}, { ...answer, findings: undefined }, { ...answer, findings: [null] },
    { ...answer, citations: [{ id: 'x', title: {}, text: 'x' }] }, { ...answer, proposedProfile: { region: {} } },
    { ...answer, scenarios: [{ label: 'x', need: {}, matches: [null] }] }, { ...answer, followups: [{}] }]) {
    const mock = t.mock.method(globalThis, 'fetch', async () => Response.json(data));
    await assert.rejects(requestAI(request, new AbortController().signal), /некорректный ответ/);
    mock.mock.restore();
  }
});

test('AI preserves readable provider errors and recovers on the next request', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => ++calls === 1
    ? Response.json({ error: 'Помощник занят. Повторите через минуту.' }, { status: 429 }) : Response.json(answer));
  await assert.rejects(requestAI(request, new AbortController().signal), /Помощник занят/);
  assert.deepEqual(await requestAI(request, new AbortController().signal), answer);
});

test('non-JSON responses and machine error codes become readable UI errors', async (t) => {
  const mock = t.mock.method(globalThis, 'fetch', async () => new Response('<html>broken</html>'));
  await assert.rejects(requestAI(request, new AbortController().signal), /некорректный ответ/);
  mock.mock.restore();
  assert.match(aiErrorMessage('PROVIDER_UNAVAILABLE'), /временно недоступен/);
  assert.match(aiErrorMessage('PROVIDER_CONTENT_BLOCKED'), /отклонил запрос/);
  assert.match(aiErrorMessage('PROVIDER_RATE_LIMITED'), /через минуту/);
  assert.match(aiErrorMessage('PROVIDER_HTTP_503'), /временно недоступен/);
  assert.match(aiErrorMessage('GIGACHAT_AUTH_FAILED'), /временно недоступен/);
});

test('workspace cache rejects expired, future, local and incomplete results', () => {
  const now = Date.now();
  const data = { ...answer, personalization: { summary: 'План', priorities: [], sections: Object.fromEntries(
    ['home', 'programs', 'applications', 'calendar', 'assistant'].map(page => [page, { title: 'Проверить условия', text: 'Уточните цель', action: 'funding' }])) } };
  assert.equal(reusableAnalysis({ data, at: now }, now), true);
  for (const at of [now + 1, now - analysisMaxAge, NaN, Infinity, 'today', undefined]) {
    assert.equal(reusableAnalysis({ data, at }, now), false);
  }
  for (const invalid of [{ ...data, mode: 'local' }, { ...data, citations: undefined },
    { ...data, personalization: { ...data.personalization, sections: {} } }, { ...data, personalization: { ...data.personalization, summary: '' } }]) {
    assert.equal(reusableAnalysis({ data: invalid, at: now }, now), false);
  }
});

test('unavailable Web Crypto disables only persistent caching', async (t) => {
  t.mock.method(crypto.subtle, 'digest', async () => { throw new Error('Web Crypto unavailable'); });
  assert.equal(await analysisDigest('business fingerprint'), undefined);
});

test('AI deadline ends a stalled request and caller cancellation remains distinguishable', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.mock.method(globalThis, 'fetch', (_url: unknown, init: RequestInit) => new Promise((_resolve, reject) => {
    init.signal!.addEventListener('abort', () => reject(init.signal!.reason), { once: true });
  }));
  const pending = requestAI(request, new AbortController().signal);
  const timedOut = assert.rejects(pending, (error: Error) => {
    assert.equal(error.name, 'TimeoutError'); assert.match(aiErrorMessage(error), /Время ожидания/); return true;
  });
  t.mock.timers.tick(70000);
  await timedOut;
  const controller = new AbortController();
  const stopped = requestAI(request, controller.signal);
  controller.abort();
  await assert.rejects(stopped, { name: 'AbortError' });
});

test('every interactive task pauses background work and releases activity after success, failure and cancellation', async (t) => {
  let observed = 0;
  const unsubscribe = subscribeAIActivity(() => { observed = getAIActivity(); });
  t.mock.method(globalThis, 'fetch', async () => {
    assert.equal(observed, 1);
    return Response.json(answer);
  });
  for (const task of ['chat', 'intake', 'search', 'analysis', 'strategy', 'review', 'draft', 'changes'] as const) {
    await requestAI({ ...request, task }, new AbortController().signal);
    assert.equal(getAIActivity(), 0);
  }
  unsubscribe();
});

// UI progress must describe saved facts, never the selected/next step.

const emptyDraftProgress = { documents: {}, project: '', budget: '' };
function completedSteps(app: typeof emptyDraftProgress, documents: string[]) {
  const html = renderToStaticMarkup(createElement(DetailSteps, preparationProgress(app, documents)));
  assert.doesNotMatch(html, /class="current"|<i>/);
  return [...html.matchAll(/data-completed="(true|false)"/g)].map((match) => match[1] === 'true');
}
test('an empty draft has no completed steps, including an unpublished document list', () => {
  assert.deepEqual(completedSteps(emptyDraftProgress, []), [false, false, false]);
  assert.deepEqual(completedSteps(emptyDraftProgress, ['Смета']), [false, false, false]);
});
test('only an actual project description completes the project step', () => {
  assert.deepEqual(completedSteps({ ...emptyDraftProgress, project: '   ' }, []), [false, false, false]);
  assert.deepEqual(completedSteps({ ...emptyDraftProgress, project: 'Оборудование мастерской' }, []), [false, true, false]);
});
test('only a valid positive ruble budget completes the budget step', () => {
  for (const budget of ['', ' ', '0', '-1', 'NaN', 'Infinity', '1e999', '0.5']) {
    assert.deepEqual(completedSteps({ ...emptyDraftProgress, budget }, []), [false, false, false]);
  }
  assert.deepEqual(completedSteps({ ...emptyDraftProgress, budget: '150000' }, []), [false, false, true]);
});
test('documents complete only after every published item is marked, and undo clears completion', () => {
  const documents = ['Смета', 'Заявление'];
  assert.deepEqual(completedSteps({ ...emptyDraftProgress, documents: { Смета: 'Готово' } }, documents), [false, false, false]);
  assert.deepEqual(completedSteps({ ...emptyDraftProgress, documents: { Смета: 'Готово', Заявление: 'Готово' } }, documents), [true, false, false]);
  assert.deepEqual(completedSteps({ ...emptyDraftProgress, documents: { Смета: '', Заявление: 'Готово' } }, documents), [false, false, false]);
  assert.deepEqual(completedSteps({ ...emptyDraftProgress, documents: { Смета: 'Готово' } }, []), [false, false, false]);
});
test('missing preparation documents render no empty list and keep the official source', () => {
  const source = 'https://example.org/official';
  const empty = renderToStaticMarkup(createElement(PreparationRequirements, { documents: [], source }));
  assert.doesNotMatch(empty, /<ul|plain-list/);
  assert.match(empty, /Что нужно подготовить/); assert.ok(empty.includes(source));
  const filled = renderToStaticMarkup(createElement(PreparationRequirements, { documents: ['Смета'], source }));
  assert.match(filled, /<ul class="plain-list"><li>Смета<\/li><\/ul>/);
});
test('settings and verification are auxiliary screens, never implicitly My Business', () => {
  assert.equal(navigationTab('settings'), null); assert.equal(navigationTab('verification'), null);
  for (const active of ['overview', 'programs', 'applications', 'profile'] as const) {
    assert.equal(navigationTab(active), active);
    const html = renderToStaticMarkup(createElement(AppNavigation, { active, onNavigate() {} }));
    assert.equal((html.match(/aria-current="page"/g) ?? []).length, 1);
    assert.match(html, /Поддержка/);
  }
  const settings = renderToStaticMarkup(createElement(AppNavigation, { active: 'settings', onNavigate() {} }));
  assert.doesNotMatch(settings, /aria-current="page"|home-nav-indicator/);
});
test('shared disclosure row provides native summary and button semantics without changing its label', () => {
  const summary = renderToStaticMarkup(createElement(InfoDisclosureRow, { as: 'summary', label: 'Реквизиты компании', icon: 'building' }));
  assert.match(summary, /<summary class="info-disclosure-row"/);
  assert.match(summary, /Реквизиты компании/); assert.equal((summary.match(/<svg/g) ?? []).length, 2);
  const button = renderToStaticMarkup(createElement(InfoDisclosureRow, { label: 'Условия программы', onClick() {}, expanded: false, controls: 'conditions' }));
  assert.match(button, /type="button"/); assert.match(button, /aria-expanded="false"/); assert.match(button, /aria-controls="conditions"/);
});
