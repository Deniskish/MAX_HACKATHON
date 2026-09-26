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
