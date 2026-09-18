// Проверяем запрос анализа, локальный ответ при сбое и отмену устаревших запросов.
import test from 'node:test';
import assert from 'node:assert/strict';
import { requestBusinessAnalysis, analysisContext } from './business-analysis';
import { demoProfile, type Application } from './domain';
const apps: Application[] = [
  {
    id: 'x',
    programId: 'equipment',
    createdAt: '',
    documents: { 'Подтверждение статуса МСП': 'secret-filename.pdf' },
    project: 'PRIVATE_PROJECT',
    budget: '1700000',
    generatedDraft: 'PRIVATE_DRAFT',
    documentFiles: { doc: 'PRIVATE_FILE' },
  },
];
test('business analysis sends only required application facts and marks an actual model response', async () => {
  let wire = '';
  const transport = (async (_url, init) => {
    wire = String(init?.body);
    return new Response(JSON.stringify({ mode: 'llm', answer: 'Обоснование выбранной программы' }));
  }) as typeof fetch;
  const result = await requestBusinessAnalysis(
    demoProfile,
    apps,
    new AbortController().signal,
    transport,
  );
  assert.equal(result.mode, 'llm');
  assert.equal(result.text, 'Обоснование выбранной программы');
  for (const text of ['PRIVATE_PROJECT', 'PRIVATE_DRAFT', 'PRIVATE_FILE', 'secret-filename.pdf'])
    assert.ok(!wire.includes(text));
  assert.equal(analysisContext(demoProfile, apps).applications[0].budget, 1700000);
});
test('provider failure and malformed answers produce explicitly local analysis', async () => {
  for (const response of [
    new Response('', { status: 503 }),
    new Response(JSON.stringify({ mode: 'llm', answer: '' })),
    new Response(JSON.stringify({ mode: 'local', answer: 'Pretend AI' })),
  ]) {
    const result = await requestBusinessAnalysis(
      demoProfile,
      apps,
      new AbortController().signal,
      (async () => response) as typeof fetch,
    );
    assert.equal(result.mode, 'local');
    assert.ok(result.text.length > 0);
    assert.notEqual(result.text, 'Pretend AI');
  }
});
test('cancelled analysis cannot return a stale fallback', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    requestBusinessAnalysis(demoProfile, apps, controller.signal, (async () => {
      throw new Error('aborted');
    }) as typeof fetch),
  );
});
