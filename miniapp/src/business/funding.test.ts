import { demoFundingCatalog } from '../../api-server/tests/fixtures/demo-catalog';
import { demoProfile } from '../../api-server/tests/fixtures/profiles';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FundingOpportunityCard, FundingResults } from './FundingExperience';
import { fundingFingerprint, requestFunding, restoreFundingNeed } from './funding';
import { emptyFundingNeed } from '../../api-server/funding-catalog/types';
import { FundingCatalogService } from '../../api-server/funding-catalog/service';

const service = new FundingCatalogService(() => new Date('2026-09-22T12:00:00Z'), { getCatalog: () => structuredClone(demoFundingCatalog) });
const need = { ...emptyFundingNeed, purpose: 'покупка оборудования', amount: 10000000,
  preferredTermMonths: 60, needsCollateralSupport: true };
const result = service.match({ profile: demoProfile, need });

test('funding request sends business facts and need, without identifiers, provenance or LLM calls', async () => {
  const profile = { ...demoProfile, name: 'PRIVATE_NAME', inn: 'PRIVATE_INN', email: 'PRIVATE_EMAIL',
    provenance: { name: { source: 'PRIVATE_SOURCE' } } };
  let calls = 0;
  const response = await requestFunding(profile, need, new AbortController().signal,
    (async (url, init) => {
      calls++;
      assert.equal(url, '/api/funding/match');
      const wire = String(init?.body);
      for (const secret of ['PRIVATE_NAME', 'PRIVATE_INN', 'PRIVATE_EMAIL', 'PRIVATE_SOURCE']) assert.ok(!wire.includes(secret));
      const data = JSON.parse(wire);
      assert.deepEqual(data.need, need);
      assert.equal(data.profile.okved, demoProfile.okved);
      return new Response(JSON.stringify(result));
    }) as typeof fetch);
  assert.equal(calls, 1); assert.deepEqual(response, result);
});
test('invalid and failed API responses cannot appear as a successful strategy', async () => {
  for (const response of [new Response('{}', { status: 400 }), new Response('{}', { status: 503 }),
    new Response('{}'), new Response(JSON.stringify({ ...result, mode: 'official' }))]) {
    await assert.rejects(requestFunding(demoProfile, need, new AbortController().signal,
      (async () => response) as typeof fetch));
  }
});
test('aborted funding response cannot return stale results', async () => {
  const controller = new AbortController();
  await assert.rejects(requestFunding(demoProfile, need, controller.signal, (async () => {
    controller.abort();
    return new Response(JSON.stringify(result));
  }) as typeof fetch));
});
test('fingerprints invalidate results after business facts or need changes', () => {
  const original = fundingFingerprint(demoProfile, need);
  assert.notEqual(fundingFingerprint({ ...demoProfile, region: 'Другой регион' }, need), original);
  assert.notEqual(fundingFingerprint(demoProfile, { ...need, amount: 1000 }), original);
  const renamed = { ...demoProfile, name: 'Other name' };
  assert.equal(fundingFingerprint(renamed, need), original);
});
test('saved need survives reload; corrupted or invalid saved data defaults safely', () => {
  assert.deepEqual(restoreFundingNeed(JSON.stringify(need)), need);
  for (const saved of [null, '{broken', '[]', '{}', '{"purpose":"SECRET"}', '{"purpose":"покупка оборудования","amount":-1}'])
    assert.deepEqual(restoreFundingNeed(saved), emptyFundingNeed);
  assert.deepEqual(restoreFundingNeed('{"purpose":"экспорт"}'), { ...emptyFundingNeed, purpose: 'экспорт' });
});
test('rendered cards show demo source, catalog facts, explanation, missing documents and next actions', () => {
  const match = result.matches.find((m) => m.opportunity.id === 'demo-sme-loan')!;
  const html = renderToStaticMarkup(createElement(FundingOpportunityCard, { match }));
  for (const text of ['Учебные данные', match.opportunity.title, match.opportunity.providerName,
    'Ставка:', 'Срок:', 'Условия и соответствие', 'Документы:', 'Подготовить:', match.opportunity.source.name]) assert.ok(html.includes(text), text);
  assert.match(html, /Окончательное решение принимает кредитор/);
  assert.doesNotMatch(html, /кредит одобрен|банк точно выдаст|вы получите кредит/i);
  assert.match(html, /не вероятность одобрения/);
});
test('rendered guarantee and strategy do not represent support limits as cash or promise compatibility', () => {
  const match = result.matches.find((m) => m.opportunity.id === 'demo-guarantee')!;
  const html = renderToStaticMarkup(createElement(FundingOpportunityCard, { match }));
  assert.match(html, /Это не выдача денег/);
  const strategy = renderToStaticMarkup(createElement(FundingResults, { result }));
  assert.match(strategy, /Совместимость инструментов необходимо проверить по условиям конкретных программ/);
  assert.match(strategy, /Сопутствующая поддержка/);
  assert.match(strategy, /Учебные данные/);
});
