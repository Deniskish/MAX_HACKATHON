import test from 'node:test';
import assert from 'node:assert/strict';
import { matchFundingOpportunity } from './matching';
import { emptyFundingNeed, type FundingOpportunity } from './types';
import { officialFundingCatalog } from './official-catalog';
import { normalizeBudgetCard } from './live';
import { withBudgetFacts } from './budget-facts';
import { explicitEligibilityFacts } from './eligibility-facts';

const now = new Date('2026-09-28T12:00:00Z');
const company = { applicantType: 'legal_entity' as const, okved: '62.01' };
const need = { ...emptyFundingNeed, purpose: 'разработка продукта' };
const o: FundingOpportunity = { ...officialFundingCatalog[0], id: 'synthetic-base-selection', status: 'active',
  applicantTypes: ['legal_entity'], okvedPrefixes: ['62'], purposes: ['разработка продукта'], sectors: [],
  regions: 'all', companyTypes: [], requirements: [], manualConditions: [], manualEligibilityConditions: [],
  amountMin: null, amountMax: null, deadline: null, projectBudgetMin: null, cofinancingPercent: null };
const match = (patch: Partial<FundingOpportunity> = {}, profile = company, fundingNeed = need) =>
  matchFundingOpportunity(profile, fundingNeed, { ...o, ...patch }, { now });

test('personal MVP excludes applicant / explicit primary OKVED contradictions, not refinements', () => {
  for (const patch of [{ applicantTypes: ['individual_entrepreneur'] }, { okvedPrefixes: ['01'] }] as Partial<FundingOpportunity>[]) {
    const result = match(patch); assert.equal(result.status, 'not_eligible'); assert.equal(result.personalEligibility?.candidate, false);
  }
  const confirmed = match(); assert.equal(confirmed.personalEligibility?.candidate, true); assert.equal(confirmed.personalEligibility?.confirmed, true);
  for (const patch of [
    { regions: ['Москва'] }, { sectors: ['Промышленность'] }, { companyTypes: ['ИП'] },
    { okvedPrefixes: [] }, { manualEligibilityConditions: ['Проверить условия оператора'] },
    { purposes: ['экспорт'] }, { amountMin: 5000 }, { projectBudgetMin: 1000000 }, { cofinancingPercent: 20 },
    { requirements: [{ field: 'isSme', operator: 'eq', value: 'yes', required: true, label: 'Статус МСП' }] },
  ] as Partial<FundingOpportunity>[]) {
    const result = match(patch, company, { ...need, amount: 100 });
    assert.equal(result.personalEligibility?.candidate, true, JSON.stringify(patch));
    assert.equal(result.personalEligibility?.confirmed, false, JSON.stringify(patch));
    assert.ok(result.unknownRequirements.length || result.missingRequirements.length || !result.purposeFit || result.amountFit === 'no');
  }
  const regionMismatch = match({ regions: ['Татарстан'] }, { ...company, region: 'Москва' } as typeof company);
  assert.equal(regionMismatch.status, 'not_eligible'); // Full assessment retains the actual contradiction.
  assert.equal(regionMismatch.personalEligibility?.candidate, true);
});
test('unknown OKVED and manual conditions are pending, closed/upcoming never become candidates', () => {
  for (const patch of [{ okvedPrefixes: [] }, { manualConditions: ['Проверить исключения'] }, { status: 'unknown' }, { status: undefined }] as Partial<FundingOpportunity>[]) {
    const result = match(patch); assert.equal(result.status, 'need_more_data');
    assert.equal(result.personalEligibility?.candidate, true); assert.equal(result.personalEligibility?.confirmed, false);
  }
  for (const patch of [{ status: 'closed' }, { status: 'upcoming' }, { deadline: '2026-09-01' }, { imported: { provider: 'budget', startsAt: '2026-10-01', endsAt: '2026-12-31' } }] as Partial<FundingOpportunity>[]) {
    assert.equal(match(patch).personalEligibility?.candidate, false);
  }
});
test('pre-incorporation projects use only explicitly published non-company applicant categories', () => {
  const project = { applicantType: 'project' as const, industry: 'IT', stage: 'idea' };
  for (const type of ['project', 'individual', 'team'] as const) {
    const result = matchFundingOpportunity(project, emptyFundingNeed, { ...o, applicantTypes: [type], okvedPrefixes: [] }, { now });
    assert.equal(result.personalEligibility?.candidate, true);
    assert.ok(result.fulfilledRequirements.some(r => r.field === 'applicantType'));
    assert.equal(result.personalEligibility?.confirmed, false); // All goals do not confirm a specific purpose.
  }
  for (const types of [[], ['legal_entity'], ['individual_entrepreneur']] as FundingOpportunity['applicantTypes'][]) {
    assert.equal(matchFundingOpportunity(project, need, { ...o, applicantTypes: types }, { now }).personalEligibility?.candidate, false);
  }
  assert.equal(matchFundingOpportunity(project, need, { ...o, applicantTypes: ['project'], status: 'closed' }, { now }).personalEligibility?.candidate, false);
});
test('Budget records with known recipients remain pending without structured OKVED; detail evidence refines them', () => {
  const budget = normalizeBudgetCard({ competitionId: '11111111-1111-1111-1111-111111111111', title: 'Тестовый отбор', pppItemName: 'Оператор',
    startDate: '2026-01-01', endDate: '2026-12-31', isActive: true, isNotActive: false, selectionRecipients: [2], maxAmountForPersonInfo: '', competitionType: 0 }, now);
  const pending = matchFundingOpportunity(company, emptyFundingNeed, budget, { now });
  assert.equal(pending.personalEligibility?.candidate, true); assert.equal(pending.personalEligibility?.confirmed, false);
  const text = 'Получателями могут быть юридические лица.\nОсновной ОКВЭД: 62, 63.11';
  const enriched = withBudgetFacts({ ...budget, imported: { ...budget.imported!, detail: { text, complete: true,
    checkedAt: now.toISOString(), version: 'detail', startsAt: '2026-01-01', endsAt: '2026-12-31', accepting: true, geography: ['Российская Федерация'] } } });
  assert.deepEqual(enriched.okvedPrefixes, ['62', '63.11']);
  assert.equal(matchFundingOpportunity(company, need, enriched, { now }).personalEligibility?.candidate, true);
  assert.equal(matchFundingOpportunity({ ...company, okved: '01.11' }, need, enriched, { now }).personalEligibility?.candidate, false);
  assert.equal(withBudgetFacts({ ...enriched, imported: { ...enriched.imported!, detail: { ...enriched.imported!.detail!, accepting: false } } }).status, 'unknown');
});
test('recipient and OKVED extraction never guesses negated conditions, ranges or project permission', () => {
  const facts = explicitEligibilityFacts('Участниками являются физические лица.\nПолучателями могут быть юридические лица и индивидуальные предприниматели.\nОсновной ОКВЭД: 62.01, 63');
  assert.deepEqual(facts.applicantTypes, ['individual', 'legal_entity', 'individual_entrepreneur']);
  assert.deepEqual(facts.okvedPrefixes, ['62.01', '63']);
  assert.deepEqual(explicitEligibilityFacts('Участниками являются физические лица, которые в случае победы создают юридическое лицо.').applicantTypes, ['individual']);
  for (const text of ['Проекты юридических лиц.', 'ОКВЭД 10–33', 'За исключением ОКВЭД 47', 'Не допускаются юридические лица.', 'Дополнительный ОКВЭД: 62.01', 'Например, основной ОКВЭД: 62.01', 'О программе по коду ОКВЭД: 62']) {
    const result = explicitEligibilityFacts(text);
    assert.deepEqual(result.applicantTypes, []); assert.deepEqual(result.okvedPrefixes, [], text);
  }
});
