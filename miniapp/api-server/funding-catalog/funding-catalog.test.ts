import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { CompanyDataService } from '../company-data/service';
import { DemoCompanyDataProvider } from '../tests/fixtures/demo-provider';
import { demoFundingCatalog } from '../tests/fixtures/demo-catalog';
import { evaluateFundingRequirement, matchFundingOpportunity, rankFundingMatches } from './matching';
import { buildFundingStrategy } from './strategy';
import { FundingCatalogService } from './service';
import { parseFundingNeed, parseFundingProfile } from './input';
import { fundingCatalogRouter } from './router';
import { emptyFundingNeed, type FundingOpportunity, type FundingProfile, type FundingRequirement } from './types';
import { legacyFundingPurposes, normalizeFundingPurpose } from './purposes';
import { amountLabel, compatibilityNotice, fundingStatusLabels, isLoan, rateLabel } from './presentation';

const now = new Date('2026-09-22T12:00:00Z');
const options = { now };
const companies = new CompanyDataService(new DemoCompanyDataProvider(), () => now);
const service = new FundingCatalogService(() => now, { getCatalog: () => structuredClone(demoFundingCatalog) });
const opportunity = (id: string) => demoFundingCatalog.find((o) => o.id === id)!;
const techNeed = { ...emptyFundingNeed, purpose: 'разработка продукта', amount: 1000000 };
const grant = opportunity('demo-tech-grant');
// The registry fixture supplies OKVED; the declared industry is a separate eligibility fact.
const techProfile = async () => ({ ...(await companies.getCompanyByInn('9900000031'))!.profile, industry: 'Технологии' });

test('catalog has 14 distinct demo opportunities, all ten kinds, valid numeric ranges and sources', () => {
  assert.equal(demoFundingCatalog.length, 14);
  assert.equal(new Set(demoFundingCatalog.map((o) => o.id)).size, 14);
  assert.equal(new Set(demoFundingCatalog.map((o) => o.kind)).size, 10);
  for (const o of demoFundingCatalog) {
    assert.equal(o.source.type, 'demo');
    assert.equal(o.source.url, null);
    assert.match(o.providerName, /Учебн|демонстрация/);
    assert.ok(o.purposes.every((p) => legacyFundingPurposes.some((value) => value === p)));
    assert.ok(o.version && o.source.updatedAt);
    for (const [min, max] of [[o.amountMin, o.amountMax], [o.rateMin, o.rateMax], [o.termMonthsMin, o.termMonthsMax]]) {
      if (min !== null) assert.ok(Number.isFinite(min) && min >= 0);
      if (max !== null) assert.ok(Number.isFinite(max) && max >= 0);
      if (min !== null && max !== null) assert.ok(min <= max);
    }
  }
});
test('demo IT company receives technology grant and young technology support', async () => {
  const profile = await techProfile();
  for (const o of [grant, opportunity('demo-young-tech')]) {
    const pending = matchFundingOpportunity(profile, techNeed, o, options);
    assert.equal(pending.status, 'eligible');
    assert.ok(pending.missingDocuments.length > 0);
    const ready = matchFundingOpportunity(profile, techNeed, o, { now, preparedDocuments: o.requiredDocuments });
    assert.equal(ready.status, 'eligible');
    assert.equal(ready.score, 100);
  }
  const result = service.match({ profile, need: techNeed });
  assert.ok(result.strategy.options.some((o) => o.opportunityId === grant.id));
});
test('demo KFH receives agricultural opportunities, while an IT company cannot qualify', async () => {
  const farm = { ...(await companies.getCompanyByInn('9900000024'))!.profile, industry: 'Сельское хозяйство' };
  const need = { ...emptyFundingNeed, purpose: 'сельхозтехника', amount: 3000000 };
  const agro = opportunity('demo-agro');
  const ready = { now, preparedDocuments: agro.requiredDocuments };
  assert.equal(matchFundingOpportunity(farm, need, agro, ready).status, 'eligible');
  const result = service.match({ profile: farm, need });
  assert.ok(result.strategy.options.some((o) => o.opportunityId === agro.id));
  const rejected = matchFundingOpportunity(await techProfile(), need, agro, ready);
  assert.equal(rejected.status, 'not_eligible');
  assert.ok(rejected.missingRequirements.some((r) => r.field === 'okved'));
});
test('unknown required profile value never passes or becomes an explicit failure', async () => {
  const profile = { ...await techProfile(), ageMonths: null };
  const result = matchFundingOpportunity(profile, techNeed, grant, options);
  assert.equal(result.status, 'need_more_data');
  assert.ok(result.unknownRequirements.some((r) => r.field === 'ageMonths'));
  assert.ok(!result.fulfilledRequirements.some((r) => r.field === 'ageMonths'));
  assert.ok(result.score < 100);
  assert.equal(matchFundingOpportunity({}, techNeed, grant, options).status, 'need_more_data');
});
test('10 million need and 5 million cap is partial coverage with preparation status', async () => {
  const result = matchFundingOpportunity(await techProfile(), { ...techNeed, amount: 10000000 }, grant,
    { now, preparedDocuments: grant.requiredDocuments });
  assert.equal(result.amountFit, 'partial');
  assert.equal(result.status, 'almost_eligible');
  assert.match(result.explanation, /только часть/);
});
test('amount boundaries, explicit zero, missing caps and own funds are not conflated', async () => {
  const p = await techProfile();
  assert.equal(matchFundingOpportunity(p, { ...techNeed, amount: 5000000 }, grant, options).amountFit, 'full');
  assert.equal(matchFundingOpportunity(p, { ...techNeed, amount: 299999 }, grant, options).amountFit, 'no');
  assert.equal(matchFundingOpportunity(p, { ...techNeed, amount: null }, grant, options).amountFit, 'unknown');
  const noCap = matchFundingOpportunity(p, techNeed, { ...grant, amountMax: null }, options);
  assert.equal(noCap.amountFit, 'unknown');
  assert.equal(noCap.status, 'need_more_data');
  assert.equal(matchFundingOpportunity(p, { ...techNeed, amount: 10000000, ownFunds: 9000000 }, grant, options).amountFit, 'partial');
});
test('required mismatch is not eligible and overrides unknown facts and missing documents', async () => {
  const result = matchFundingOpportunity({ ...await techProfile(), isSme: 'no', ageMonths: null }, techNeed, grant, options);
  assert.equal(result.status, 'not_eligible');
  assert.ok(result.missingRequirements.some((r) => r.field === 'isSme'));
  assert.ok(result.unknownRequirements.some((r) => r.field === 'ageMonths'));
});
test('region and legal form restrictions are mandatory OR-lists', async () => {
  const p = await techProfile();
  const restricted = { ...grant, regions: ['Москва', 'Санкт-Петербург'], companyTypes: ['ООО', 'ИП'] };
  assert.equal(matchFundingOpportunity(p, techNeed, restricted, options).missingRequirements.length, 0);
  assert.equal(matchFundingOpportunity({ ...p, region: 'Другой регион' }, techNeed, restricted, options).status, 'not_eligible');
  assert.equal(matchFundingOpportunity({ ...p, companyType: 'КФХ' }, techNeed, restricted, options).status, 'not_eligible');
  assert.equal(matchFundingOpportunity({ ...p, region: '' }, techNeed, restricted, options).status, 'need_more_data');
});
test('purpose mismatch is not eligible even when company criteria pass', async () => {
  assert.equal(matchFundingOpportunity(await techProfile(), { ...techNeed, purpose: 'сельхозтехника' }, grant, options).status, 'not_eligible');
});
test('deadline expires at end of Moscow day and takes precedence over all other statuses', async () => {
  const o = { ...grant, deadline: '2026-09-22' };
  assert.notEqual(matchFundingOpportunity(await techProfile(), techNeed, o, { now: new Date('2026-09-22T20:59:59Z') }).status, 'expired');
  assert.equal(matchFundingOpportunity({}, techNeed, o, { now: new Date('2026-09-22T21:00:00Z') }).status, 'expired');
  assert.notEqual(matchFundingOpportunity({}, techNeed, { ...o, deadline: null }, { now: new Date('2035-01-01') }).status, 'expired');
});
test('all requirement operators work, OKVED prefix respects boundaries, unknown neq does not pass', () => {
  const check = (profile: FundingProfile, field: FundingRequirement['field'], operator: FundingRequirement['operator'], value: FundingRequirement['value']) =>
    evaluateFundingRequirement(profile, { field, operator, value, required: true, label: 'Критерий' }).status;
  assert.equal(check({ tax: 'УСН' }, 'tax', 'eq', 'УСН'), 'fulfilled');
  assert.equal(check({ tax: 'УСН' }, 'tax', 'neq', 'ОСНО'), 'fulfilled');
  assert.equal(check({ tax: '' }, 'tax', 'neq', 'ОСНО'), 'unknown');
  assert.equal(check({ ageMonths: 12 }, 'ageMonths', 'gte', 12), 'fulfilled');
  assert.equal(check({ employees: 0 }, 'employees', 'lte', 10), 'fulfilled');
  assert.equal(check({ revenue: 1000000 }, 'revenue', 'gte', 2000000), 'missing');
  assert.equal(check({ okved: '62.01' }, 'okved', 'prefix', '62'), 'fulfilled');
  assert.equal(check({ okved: '620.1' }, 'okved', 'prefix', '62'), 'missing');
  assert.equal(check({ goals: ['Разработка продукта'] }, 'goals', 'includes', 'Разработка продукта'), 'fulfilled');
  assert.equal(check({ goals: [] }, 'goals', 'includes', 'Разработка продукта'), 'unknown');
  assert.equal(check({ isSme: 'yes' }, 'isSme', 'eq', true), 'fulfilled');
  assert.equal(check({ isSme: 'unknown' }, 'isSme', 'neq', true), 'unknown');
});
test('optional unknown criterion is not a mandatory blocker, explicit unmet optional condition needs preparation', async () => {
  const extra: FundingRequirement = { field: 'revenue', operator: 'gte', value: 1000000, label: 'Желательная выручка', required: false };
  const o = { ...grant, requirements: [...grant.requirements, extra], requiredDocuments: [] };
  assert.equal(matchFundingOpportunity({ ...await techProfile(), revenue: null }, techNeed, o, options).status, 'eligible');
  assert.equal(matchFundingOpportunity({ ...await techProfile(), revenue: 0 }, techNeed, o, options).status, 'almost_eligible');
});
test('documents are separate from criteria and only named documents count', async () => {
  const pending = matchFundingOpportunity(await techProfile(), techNeed, grant, { now, preparedDocuments: ['attacker-document'] });
  assert.equal(pending.status, 'eligible');
  const prepared = matchFundingOpportunity(await techProfile(), techNeed, grant, { now, preparedDocuments: grant.requiredDocuments });
  assert.equal(prepared.status, pending.status);
  assert.equal(prepared.score, pending.score);
  assert.deepEqual(pending.missingDocuments, grant.requiredDocuments);
});
test('term fit handles minimum, maximum, partial and unknown; grants do not require a repayment term', async () => {
  const p = await techProfile(), loan = { ...opportunity('demo-sme-loan'), okvedPrefixes: ['62'] }; // Fully known synthetic eligibility isolates term fit.
  for (const [months, fit, status] of [[6, 'no', 'not_eligible'], [12, 'yes', 'eligible'], [60, 'yes', 'eligible'], [72, 'partial', 'almost_eligible']] as const) {
    const match = matchFundingOpportunity(p, { ...techNeed, preferredTermMonths: months }, loan,
      { now, preparedDocuments: loan.requiredDocuments });
    assert.equal(match.termFit, fit); assert.equal(match.status, status);
    assert.deepEqual(match.unknownRequirements, [], `Only repayment term should affect status at ${months} months`);
  }
  assert.equal(matchFundingOpportunity(p, techNeed, loan, options).termFit, 'unknown');
  assert.equal(matchFundingOpportunity(p, { ...techNeed, preferredTermMonths: 60 }, { ...loan, termMonthsMax: null }, options).status, 'need_more_data');
  assert.equal(matchFundingOpportunity(p, { ...techNeed, preferredTermMonths: 60 }, grant, { now, preparedDocuments: grant.requiredDocuments }).status, 'eligible');
});
test('loan statuses and explanation never promise approval and preserve lender decision', async () => {
  for (const o of demoFundingCatalog.filter((o) => isLoan(o.kind))) {
    const match = matchFundingOpportunity(await techProfile(), techNeed, { ...o, okvedPrefixes: ['62'] }, { now, preparedDocuments: o.requiredDocuments });
    assert.equal(match.status, 'eligible');
    assert.deepEqual(match.unknownRequirements, []);
    assert.equal(match.personalEligibility?.confirmed, true);
    assert.doesNotMatch(match.explanation + fundingStatusLabels[match.status], /одобрен|банк точно выдаст|вы получите кредит/i);
    assert.match(match.explanation, /Окончательное решение принимает кредитор/);
  }
});
test('collateral request raises guarantee relevance and rank without inflating eligibility score', async () => {
  const p = await techProfile(), guarantee = opportunity('demo-guarantee'), loan = opportunity('demo-sme-loan');
  const no = matchFundingOpportunity(p, { ...techNeed, needsCollateralSupport: false }, guarantee, options);
  const yes = matchFundingOpportunity(p, { ...techNeed, needsCollateralSupport: true }, guarantee, options);
  assert.equal(yes.score, no.score);
  assert.ok(yes.relevance > no.relevance);
  assert.equal(rankFundingMatches([matchFundingOpportunity(p, techNeed, loan, options), yes])[0].opportunity.id, guarantee.id);
  assert.equal(yes.amountFit, 'unknown');
  assert.match(yes.explanation, /не является выдачей денег/);
});
test('tax, property, guarantee and service never claim full monetary coverage', async () => {
  for (const kind of ['tax', 'property', 'guarantee', 'service']) {
    const o = demoFundingCatalog.find((item) => item.kind === kind)!;
    const match = matchFundingOpportunity(await techProfile(), { ...techNeed, purpose: o.purposes[0] }, o, options);
    assert.equal(match.amountFit, 'unknown');
    assert.match(amountLabel(o), /не выдача денег|выплата не предусмотрена|без денежной выплаты/);
  }
  assert.equal(rateLabel(opportunity('demo-equipment-lease')), 'Удорожание: не указана');
});
test('strategy uses catalog facts, excludes blockers and never adds up separate instrument limits', async () => {
  const need = { ...techNeed, purpose: 'покупка оборудования', amount: 10000000, preferredTermMonths: 60, needsCollateralSupport: true };
  const response = service.match({ profile: await techProfile(), need });
  assert.ok(response.strategy.notices.includes(compatibilityNotice));
  assert.ok(response.strategy.options.some((o) => o.opportunityId === 'demo-guarantee' && o.role === 'support'));
  assert.ok(!response.strategy.options.some((o) => o.opportunityId === 'demo-agro'));
  for (const option of response.strategy.options) {
    const o = opportunity(option.opportunityId);
    assert.ok(option.text.includes(o.title));
    assert.ok(option.text.includes(amountLabel(o)));
  }
  assert.equal('totalAmount' in response.strategy, false);
  assert.match(JSON.stringify(response.strategy), /не гарантированное финансирование/);
});
test('matching is deterministic and pure, and core accepts a profile without INN', async () => {
  const profile = parseFundingProfile(await techProfile());
  assert.equal('inn' in profile, false);
  const before = JSON.stringify({ profile, techNeed, grant });
  const match = matchFundingOpportunity(profile, techNeed, grant, options);
  assert.equal(match.status, 'eligible');
  assert.deepEqual(match.unknownRequirements, []);
  assert.equal(match.personalEligibility?.confirmed, true);
  assert.deepEqual(match, matchFundingOpportunity(profile, techNeed, grant, options));
  assert.equal(JSON.stringify({ profile, techNeed, grant }), before);
  const advice = matchFundingOpportunity(profile, { ...emptyFundingNeed, purpose: 'масштабирование' }, { ...opportunity('demo-advice'), okvedPrefixes: ['62'] }, options);
  assert.equal(advice.status, 'eligible');
  assert.deepEqual(advice.unknownRequirements, []);
});
test('purpose alone is valid; all optional need fields are null and no profile is required by core', () => {
  const need = parseFundingNeed({ purpose: 'покупка оборудования' });
  assert.deepEqual(need, { ...emptyFundingNeed, purpose: normalizeFundingPurpose('покупка оборудования') });
  assert.equal(parseFundingNeed({ purpose: 'покупка оборудования', ownFunds: 0, needsCollateralSupport: false }).ownFunds, 0);
  const result = service.match({ profile: {}, need });
  assert.equal(result.mode, 'demo');
  assert.equal(result.matches.length, 14);
});
test('malformed numeric inputs, unknown purposes and spoofed profile values are rejected', () => {
  for (const patch of [{ amount: -1 }, { amount: 0 }, { amount: NaN }, { amount: Infinity }, { amount: '1000' },
    { ownFunds: -1 }, { preferredTermMonths: 1.5 }, { preferredTermMonths: 601 }, { needsCollateralSupport: 'yes' }, { purpose: 'SECRET' }])
    assert.throws(() => parseFundingNeed({ purpose: 'покупка оборудования', ...patch }));
  for (const input of [null, [], {}]) assert.throws(() => parseFundingNeed(input));
  for (const profile of [[], null, { isSme: true }, { companyType: 'SECRET' }, { ageMonths: -1 }, { employees: '12' }, { goals: 'bad' }])
    assert.throws(() => parseFundingProfile(profile));
});
test('service ignores forged matches/catalog and never returns identity or arbitrary private fields', async () => {
  const result = service.match({ profile: { ...await techProfile(), inn: 'PRIVATE_INN', name: 'PRIVATE_NAME', address: 'PRIVATE_ADDRESS' },
    need: techNeed, matches: [{ status: 'eligible' }], opportunities: [{ title: 'FORGED_TITLE' }] });
  for (const secret of ['PRIVATE_INN', 'PRIVATE_NAME', 'PRIVATE_ADDRESS', 'FORGED_TITLE']) assert.ok(!JSON.stringify(result).includes(secret));
  const catalog = service.getCatalog(); catalog[0].amountMax = 1;
  assert.equal(service.getCatalog()[0].amountMax, 5000000);
});
test('strategy has no invented financing when all opportunities are blocked or expired', async () => {
  const match = matchFundingOpportunity(await techProfile(), techNeed, { ...grant, deadline: '2020-01-01' }, options);
  const strategy = buildFundingStrategy({}, techNeed, [match]);
  assert.deepEqual(strategy.options, []);
  assert.match(strategy.notices.join(' '), /не найдены/);
});
test('HTTP catalog and matching work without external providers; invalid input returns 400', async () => {
  const app = express(); app.use(express.json()); app.use('/api/funding', fundingCatalogRouter(service));
  const calendarFixtures = service.getCatalog().map((o, index) => ({ ...o, deadline: index < 2 ? '2030-12-31' : null }));
  app.use('/calendar-test', fundingCatalogRouter(new FundingCatalogService(() => new Date(), { getCatalog: () => calendarFixtures })));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address(); assert.ok(address && typeof address === 'object');
  const url = `http://127.0.0.1:${address.port}/api/funding`;
  try {
    const catalog = await fetch(url + '/catalog'); assert.equal(catalog.status, 200);
    assert.equal(catalog.headers.get('cache-control'), 'no-store');
    const body = await catalog.json() as { opportunities: FundingOpportunity[] };
    assert.equal(body.opportunities.length, 14);
    const calendarUrl = `http://127.0.0.1:${address.port}/calendar-test`;
    const dated = calendarFixtures.filter((o) => o.deadline);
    assert.ok(dated.length >= 2);
    const personalCalendar = await fetch(calendarUrl + '/calendar.ics?ids=' + encodeURIComponent(dated[0].id));
    assert.equal(personalCalendar.status, 200);
    const calendarText = await personalCalendar.text();
    assert.ok(calendarText.includes(`UID:${dated[0].id}@opora`));
    assert.ok(!calendarText.includes(`UID:${dated[1].id}@opora`));
    assert.equal((await fetch(url + '/calendar.ics?ids=missing-id')).status, 400);
    assert.equal((await fetch(url + '/calendar.ics?ids=a&ids=b')).status, 400);
    for (const [data, status] of [[{ profile: await techProfile(), need: techNeed }, 200],
      [{ profile: {}, need: { purpose: 'масштабирование' } }, 200],
      [{ profile: {}, need: { purpose: '' } }, 200], [{ profile: [], need: techNeed }, 400]] as const) {
      const response = await fetch(url + '/match', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      assert.equal(response.status, status);
    }
  } finally {
    await new Promise<void>((resolve, reject) => { server.close((error) => error ? reject(error) : resolve()); server.closeAllConnections(); });
  }
});
