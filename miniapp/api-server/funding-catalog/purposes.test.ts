import test from 'node:test';
import assert from 'node:assert/strict';
import { demoFundingCatalog } from '../tests/fixtures/demo-catalog';
import { emptyFundingNeed, type FundingOpportunity, type FundingProfile } from './types';
import { allFundingPurposes, fundingPurposeFit, normalizeFundingPurpose, programmePurposeCategories } from './purposes';
import { parseFundingNeed } from './input';
import { matchFundingOpportunity } from './matching';

const profile: FundingProfile = { region: 'Москва', applicantType: 'legal_entity', companyType: 'ООО',
  industry: 'Технологии', okved: '62.01', isSme: 'yes', ageMonths: 24, employees: 12 };
const grant = demoFundingCatalog.find(o => o.id === 'demo-tech-grant')!;
const now = new Date('2026-09-28T12:00:00Z');
const match = (o = grant, p = profile, purpose = allFundingPurposes as string) =>
  matchFundingOpportunity(p, { ...emptyFundingNeed, purpose }, o, { now });

test('all purposes is the default and old empty selection migrates without inventing optional values', () => {
  assert.equal(emptyFundingNeed.purpose, 'Все цели');
  assert.deepEqual(parseFundingNeed({ purpose: '' }), emptyFundingNeed);
  assert.deepEqual(parseFundingNeed({ purpose: 'Все цели' }), emptyFundingNeed);
});
test('all nine legacy programme purposes map deterministically, with multiple categories and unknowns preserved', () => {
  const pairs = [
    ['покупка оборудования', 'Оборудование и модернизация'], ['сельхозтехника', 'Оборудование и модернизация'],
    ['запуск производства', 'Запуск или развитие бизнеса'], ['масштабирование', 'Запуск или развитие бизнеса'],
    ['оборотные средства', 'Оборотные расходы'], ['разработка продукта', 'Разработка продукта / технологии'],
    ['найм сотрудников', 'Персонал и обучение'], ['экспорт', 'Продажи, продвижение и экспорт'],
    ['аренда / недвижимость', 'Помещения и инфраструктура'],
  ];
  for (const [old, category] of pairs) {
    assert.equal(normalizeFundingPurpose(old), category);
    assert.equal(parseFundingNeed({ purpose: old }).purpose, category);
    assert.equal(fundingPurposeFit(category, [old]), 'match');
  }
  const original = ['сельхозтехника', 'покупка оборудования', 'экспорт', 'Неизвестное назначение'];
  assert.deepEqual(programmePurposeCategories(original), ['Оборудование и модернизация', 'Продажи, продвижение и экспорт']);
  assert.equal(original[0], 'сельхозтехника');
  assert.equal(fundingPurposeFit('Оборотные расходы', original), 'unknown');
  assert.equal(fundingPurposeFit('Оборотные расходы', ['экспорт']), 'mismatch');
});
test('all purposes permits different and unpublished purposes as pending, never as a confirmed purpose match', () => {
  for (const purposes of [['экспорт'], ['покупка оборудования'], []]) {
    const result = match({ ...grant, purposes });
    assert.equal(result.status, 'need_more_data');
    assert.equal(result.purposeFit, false);
    assert.equal(result.personalEligibility?.candidate, true);
    assert.equal(result.personalEligibility?.confirmed, false);
    assert.deepEqual(result.unknownRequirements, []); // Company criteria are known; only purpose remains unconfirmed.
  }
});
test('a concrete category matches mapped programme facts and rejects a different known purpose', () => {
  const result = match(grant, profile, 'Разработка продукта / технологии');
  assert.equal(result.status, 'eligible');
  assert.equal(result.purposeFit, true);
  assert.equal(result.personalEligibility?.confirmed, true);
  assert.equal(match(grant, profile, 'Оборотные расходы').status, 'not_eligible');
  assert.equal(match({ ...grant, purposes: [] }, profile, 'Оборотные расходы').personalEligibility?.candidate, true);
});
test('all purposes hides only base contradictions and unavailable intakes from personal candidates', () => {
  for (const [o, p] of [
    [grant, { ...profile, applicantType: 'project' }],
    [grant, { ...profile, okved: '01.11' }],
    [{ ...grant, status: 'closed' }, profile],
    [{ ...grant, status: 'upcoming' }, profile],
  ] as [FundingOpportunity, FundingProfile][]) {
    assert.equal(match(o, p).personalEligibility?.candidate, false);
  }
  for (const [o, p] of [
    [{ ...grant, regions: ['Республика Татарстан'] }, profile],
    [{ ...grant, regions: [] }, profile],
    [grant, { ...profile, companyType: 'АО' }],
    [grant, { ...profile, okved: undefined }],
    [grant, { ...profile, industry: 'Сельское хозяйство' }],
    [grant, { ...profile, industry: undefined }],
    [{ ...grant, applicantTypes: [], companyTypes: [] }, profile],
    [{ ...grant, imported: { provider: 'budget', startsAt: '', endsAt: '' }, sectors: [], okvedPrefixes: [] }, profile],
  ] as [FundingOpportunity, FundingProfile][]) {
    const result = match(o, p);
    assert.equal(result.personalEligibility?.candidate, true);
    assert.equal(result.personalEligibility?.confirmed, false);
  }
});
test('empty financing is valid; refinements affect only published financial conditions', () => {
  const need = { ...emptyFundingNeed, purpose: 'Разработка продукта / технологии' };
  assert.equal(matchFundingOpportunity(profile, need, grant, { now }).status, 'eligible');
  const loan = { ...grant, kind: 'loan' as const, termMonthsMin: 6, termMonthsMax: 36 };
  assert.equal(matchFundingOpportunity(profile, { ...need, preferredTermMonths: 3 }, loan, { now }).termFit, 'no');
  assert.equal(matchFundingOpportunity(profile, { ...need, preferredTermMonths: 3 }, grant, { now }).status, 'eligible');
  const cofunded = { ...grant, cofinancingPercent: 20 };
  const insufficientFacts = matchFundingOpportunity(profile, { ...need, amount: 1000000 }, cofunded, { now });
  assert.equal(insufficientFacts.status, 'need_more_data');
  assert.ok(insufficientFacts.unknownRequirements.some(r => r.field === 'revenue'));
  assert.equal(matchFundingOpportunity(profile, { ...need, amount: 1000000, ownFunds: 250000 }, cofunded, { now }).status, 'eligible');
  const guarantee = { ...grant, kind: 'guarantee' as const };
  const baseline = matchFundingOpportunity(profile, need, guarantee, { now });
  const collateral = matchFundingOpportunity(profile, { ...need, needsCollateralSupport: true }, guarantee, { now });
  assert.ok(collateral.relevance > baseline.relevance);
  assert.equal(collateral.score, baseline.score);
});
