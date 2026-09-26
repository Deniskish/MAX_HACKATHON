import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { useSystemTheme } from '../theme';
import { ThemedImage } from './ThemedImage';
import { aiErrorMessage, requestAI, type AIRequest } from './ai-client';
import { getAIActivity, subscribeAIActivity } from './ai-activity';

const request: AIRequest = { task: 'intake', question: 'Мастерская мебели', context: {} };
const answer = { mode: 'llm', answer: 'Ответ', actions: [], citations: [], matches: [], findings: [], scenarios: [], followups: [], tools: [] };

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
  assert.match(aiErrorMessage('PROVIDER_CONTENT_BLOCKED'), /формулировку/);
  assert.match(aiErrorMessage('PROVIDER_RATE_LIMITED'), /через минуту/);
  assert.match(aiErrorMessage('PROVIDER_HTTP_503'), /временно недоступен/);
  assert.match(aiErrorMessage('GIGACHAT_AUTH_FAILED'), /временно недоступен/);
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
