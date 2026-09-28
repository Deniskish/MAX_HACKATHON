import { demoFundingCatalog } from '../../api-server/tests/fixtures/demo-catalog';
import { demoProfile } from '../../api-server/tests/fixtures/profiles';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FundingExperience, FundingOpportunityCard, FundingResults } from './FundingExperience';
import { fundingFingerprint, requestFunding, restoreFundingNeed } from './funding';
import { normalizeFundingPurpose, fundingTaskLabel, fundingPurposes } from '../../api-server/funding-catalog/purposes';
import { emptyFundingNeed } from '../../api-server/funding-catalog/types';
import { FundingCatalogService } from '../../api-server/funding-catalog/service';

const service = new FundingCatalogService(() => new Date('2026-09-22T12:00:00Z'), { getCatalog: () => structuredClone(demoFundingCatalog) });
const need = { ...emptyFundingNeed, purpose: 'Оборудование и модернизация', amount: 10000000,
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
  assert.deepEqual(restoreFundingNeed('{"purpose":"экспорт"}'), { ...emptyFundingNeed, purpose: 'Продажи, продвижение и экспорт' });
});
test('list cards show essential facts, while conditions are reserved for the detail screen', () => {
  const match = result.matches.find((m) => m.opportunity.id === 'demo-sme-loan')!;
  const html = renderToStaticMarkup(createElement(FundingOpportunityCard, { match }));
  for (const text of ['Учебные данные', match.opportunity.title, match.opportunity.providerName,
    'Ставка:', 'Срок:']) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /<details|Соответствие:|Документы:|версия /);
  assert.doesNotMatch(html, /кредит одобрен|банк точно выдаст|вы получите кредит/i);
});
test('rendered guarantee and strategy do not represent support limits as cash or promise compatibility', () => {
  const match = result.matches.find((m) => m.opportunity.id === 'demo-guarantee')!;
  const html = renderToStaticMarkup(createElement(FundingOpportunityCard, { match }));
  assert.match(html, /Это не выдача денег/);
  const strategy = renderToStaticMarkup(createElement(FundingResults, { result }));
  // Guidance is no longer rendered as interface help; the underlying constraint remains.
  assert.ok(result.strategy.notices.some(notice => notice.includes('Совместимость инструментов необходимо проверить по условиям конкретных программ')));
  assert.doesNotMatch(strategy, /совместимость подтверждена|финансирование гарантировано/i);
  assert.match(strategy, /Сопутствующая поддержка/);
  assert.match(strategy, /Учебные данные/);
});

test('funding form defaults to all purposes and keeps optional refinements in a closed disclosure', () => {
  const html = renderToStaticMarkup(createElement(FundingExperience, { onApply() {} }));
  assert.match(html, /<option value="Все цели" selected="">Все цели<\/option>/);
  assert.match(html, /<details class="info-disclosure funding-refinements">/);
  assert.doesNotMatch(html, /<details[^>]*\bopen/);
  for (const label of ['Уточняющие параметры', 'Желаемый срок, месяцев', 'Собственные средства, ₽', 'Нужна помощь с обеспечением / залогом?'])
    assert.ok(html.includes(label));
  assert.equal(fundingPurposes.length, 8);
  assert.equal(fundingTaskLabel(emptyFundingNeed), 'Все цели · сумма не указана');
  assert.equal(fundingTaskLabel({ ...emptyFundingNeed, amount: 5000000 }).replace(/\u00a0/g, ' '), 'Все цели · 5 000 000 ₽');
  assert.equal(fundingTaskLabel({ ...emptyFundingNeed, purpose: 'сельхозтехника' }), 'Оборудование и модернизация · сумма не указана');
});
test('legacy saved purpose migrates without losing optional financing values', () => {
  const old = { ...emptyFundingNeed, purpose: 'сельхозтехника', amount: null, ownFunds: 0, preferredTermMonths: 36, needsCollateralSupport: false };
  assert.deepEqual(restoreFundingNeed(JSON.stringify(old)), { ...old, purpose: normalizeFundingPurpose(old.purpose) });
});
