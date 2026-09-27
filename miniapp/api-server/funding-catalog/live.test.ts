import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BudgetSource, LiveCatalog, normalizeBudgetCard, type BudgetCard } from './live';
import { matchFundingOpportunity } from './matching';
import { emptyFundingNeed } from './types';
import { withAICatalog } from './ai-runtime';
import { prepareAIContext } from '../ai/context';
import { contextualCatalog } from '../ai/service';

export const card = (override: Partial<BudgetCard> = {}): BudgetCard => ({ competitionId: '5f564f52-ac51-4496-9db7-bd7b282f7b64',
  title: 'Субсидия субъектам малого и среднего предпринимательства на производство', pppItemName: 'Официальный организатор',
  startDate: new Date(Date.now() - 86400000).toISOString(), endDate: new Date(Date.now() + 86400000 * 10).toISOString(),
  isActive: true, isNotActive: false, selectionRecipients: [2, 3], maxAmountForPersonInfo: '300 000,00 ₽', competitionType: 0, ...override });
test('official import preserves title, per-person cap and source; unknown restrictions never mean eligible', () => {
  const row = card(), o = normalizeBudgetCard(row);
  assert.equal(o.title, row.title); assert.equal(o.amountMax, 300000); assert.equal(o.status, 'active');
  assert.equal(o.source.url, `https://promote.budget.gov.ru/public/minfin/selection/view/${row.competitionId}?competitionType=0`);
  assert.deepEqual(o.regions, []); assert.deepEqual(o.purposes, []);
  const result = matchFundingOpportunity({ companyType: 'ООО', isSme: 'yes', region: 'Москва' }, { ...emptyFundingNeed, purpose: 'запуск производства' }, o);
  assert.equal(result.status, 'need_more_data'); assert.ok(result.unknownRequirements.length);
  assert.equal(normalizeBudgetCard(card({ maxAmountForPersonInfo: 'в размере произведенных затрат' })).amountMax, null);
});
test('expired, upcoming, withdrawn and invalid-date selections cannot be presented as open', () => {
  assert.equal(normalizeBudgetCard(card({ endDate: '2020-01-01T00:00:00Z' })).status, 'closed');
  assert.equal(normalizeBudgetCard(card({ startDate: '2099-01-01T00:00:00Z', endDate: '2099-02-01T00:00:00Z' })).status, 'upcoming');
  assert.equal(normalizeBudgetCard(card({ isNotActive: true })).status, 'closed');
  assert.equal(normalizeBudgetCard(card({ endDate: 'bad' })).status, 'unknown');
  assert.throws(() => normalizeBudgetCard(card({ competitionId: '../private' })));
});
test('pagination is bounded and rejects a changed provider schema', async () => {
  let body: any;
  const source = new BudgetSource(async (_url, init) => { body = JSON.parse(String(init?.body));
    return Response.json({ item1: { currentPage: 2, totalPages: 4, totalEntries: 400, items: [card()] } }); });
  assert.equal((await source.page(2)).rows.length, 1); assert.equal(body.entryCount, 100); assert.equal(body.currentPage, 2);
  await assert.rejects(new BudgetSource(async () => Response.json({ items: [] })).page(1), /SCHEMA/);
});

test('source recovers after a transient 500 and stops after one retry on a persistent outage', async () => {
  let calls = 0;
  const source = new BudgetSource(async () => ++calls === 1 ? new Response('', { status: 500 })
    : Response.json({ item1: { currentPage: 1, totalPages: 1, totalEntries: 1, items: [card()] } }));
  assert.equal((await source.page(1)).rows.length, 1); assert.equal(calls, 2);
  calls = 0;
  await assert.rejects(new BudgetSource(async () => { calls++; return new Response('', { status: 503 }); }).page(1), /BUDGET_HTTP_503/);
  assert.equal(calls, 2);
});

test('source never retries restrictions or invalid JSON, and abort interrupts the retry delay', async () => {
  for (const status of [403, 429, 200]) {
    let calls = 0;
    await assert.rejects(new BudgetSource(async () => { calls++; return new Response('invalid', { status }); }).page(1));
    assert.equal(calls, 1);
  }
  const controller = new AbortController(); let calls = 0;
  const request = new BudgetSource(async () => { calls++; controller.abort(); return new Response('', { status: 500 }); }).page(1, controller.signal);
  await assert.rejects(request, { name: 'AbortError' }); assert.equal(calls, 1);
});

test('partial sync persists good pages without losing old programmes or marking a full refresh', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'opora-partial-'));
  let stage = 0;
  const old = card(); const added = card({ competitionId: '6f564f52-ac51-4496-9db7-bd7b282f7b64' });
  class Source extends BudgetSource { async page(currentPage: number) {
    if (stage === 0) return { rows: [old], totalPages: 1, total: 1 };
    if (currentPage === 1) return { rows: [added], totalPages: 2, total: 2 };
    if (stage === 1) throw new Error('BUDGET_HTTP_500');
    if (stage === 2) return { rows: [card({ title: 'Must not be saved' }), card({ competitionId: 'invalid' })], totalPages: 2, total: 2 };
    return { rows: [old], totalPages: 2, total: 2 };
  } }
  try {
    const catalog = new LiveCatalog(dir, new Source()); await catalog.sync(1);
    const checkedAt = catalog.status().checkedAt;
    for (stage = 1; stage <= 2; stage++) {
      await catalog.sync(2);
      const saved = new LiveCatalog(dir);
      assert.equal(saved.status().checkedAt, checkedAt);
      assert.equal(saved.status().imported, 2); assert.equal(saved.status().refreshedPages, 1);
      assert.equal(saved.status().failedPage, 2);
      assert.equal(saved.status().errorCode, stage === 1 ? 'BUDGET_HTTP_500' : 'BUDGET_SCHEMA_CHANGED');
      assert.equal(saved.getCatalog().find(o => o.id === `budget-${old.competitionId}`)?.title, old.title);
    }
    await catalog.sync(2);
    assert.equal(catalog.status().error, null); assert.equal(catalog.status().errorCode, null);
    assert.equal(catalog.status().failedPage, null); assert.equal(catalog.status().refreshedPages, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('sync survives restarts; unchanged records keep versions; failed page keeps the previous complete snapshot', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'opora-live-'));
  let broken = false; const row = card();
  class Source extends BudgetSource { async page(currentPage: number) {
    if (broken) throw new Error('offline'); return { rows: [row], totalPages: 1, total: 1 };
  } }
  try {
    const catalog = new LiveCatalog(dir, new Source()); await catalog.sync(1);
    assert.equal(catalog.status().imported, 1); const version = catalog.getCatalog().at(-1)!.version;
    await catalog.sync(1); assert.equal(catalog.getCatalog().at(-1)!.version, version);
    const previous = catalog.status().checkedAt; broken = true; await catalog.sync(1);
    assert.equal(catalog.status().error, 'source_unavailable'); assert.equal(catalog.status().checkedAt, previous);
    assert.equal(new LiveCatalog(dir).getCatalog().at(-1)!.version, version);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('AI catalogue is scoped to the request and accepts live programme IDs without leaking between requests', async () => {
  const o = normalizeBudgetCard(card()); const request = { task: 'chat', question: 'Какие условия?', context: { programId: o.id } };
  assert.throws(() => prepareAIContext(request));
  await Promise.all([withAICatalog([o], async () => { await Promise.resolve(); assert.equal(prepareAIContext(request).request.context.programId, o.id); }),
    withAICatalog([], async () => { await Promise.resolve(); assert.throws(() => prepareAIContext(request)); })]);
});

test('vague AI question uses business purpose and never pads the shortlist with unrelated live records', () => {
  const production = normalizeBudgetCard(card({ title: 'Субсидия на развитие производства' }));
  const unrelated = { ...production, id: 'budget-6f564f52-ac51-4496-9db7-bd7b282f7b64', title: 'Субсидия театральным организациям' };
  withAICatalog([unrelated, production], () => {
    const request = prepareAIContext({ task: 'chat', question: 'Что мне подходит?', context: { profile: {}, need: { ...emptyFundingNeed, purpose: 'запуск производства' } } }).request;
    assert.deepEqual(contextualCatalog(request).map(o => o.id), [production.id]);
    assert.deepEqual(contextualCatalog({ ...request, context: { profile: {} } }), []);
    assert.ok(contextualCatalog({ ...request, context: { programId: unrelated.id, profile: {} } }).some(o => o.id === unrelated.id));
  });
});

test('automatic workspace instructions never select measures from coincidental title words', () => {
  const unrelated = normalizeBudgetCard(card({ title: 'Запрос предложений на субсидию театральным организациям' }));
  const production = { ...unrelated, id: 'budget-6f564f52-ac51-4496-9db7-bd7b282f7b64', title: 'Развитие производства' };
  withAICatalog([unrelated, production], () => {
    const request = prepareAIContext({ task: 'workspace', question: 'Проанализируй сведения, предложи уточнения и адаптируй разделы.', context: { profile: {}, workspace: { savedIds: [], applications: [] } } }).request;
    assert.deepEqual(contextualCatalog(request), []);
    assert.deepEqual(contextualCatalog({ ...request, context: { ...request.context, profile: { industry: 'Производство мебели' } } }).map(o => o.id), [production.id]);
    assert.deepEqual(contextualCatalog({ ...request, context: { ...request.context, workspace: { savedIds: [unrelated.id], applications: [] } } }).map(o => o.id), [unrelated.id]);
  });
});
