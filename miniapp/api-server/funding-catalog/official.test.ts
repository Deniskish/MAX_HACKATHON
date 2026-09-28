import test from 'node:test';
import assert from 'node:assert/strict';
import { officialFundingCatalog, validateOfficialCatalog, fundingCatalogStatus } from './official-catalog';
import { matchFundingOpportunity } from './matching';
import { buildFundingStrategy } from './strategy';
import { emptyFundingNeed, type FundingOpportunity } from './types';
import { preparePrivateRequest, privateCompletion } from '../privacy';
const need = { ...emptyFundingNeed, purpose: 'разработка продукта', amount: 10000000 };
const start = officialFundingCatalog.find((o) => o.id === 'fasie-start-1')!;
// Synthetic active variant isolates applicant/amount rules from the real closed competition and manual review.
const active: FundingOpportunity = { ...start, status: 'active', manualConditions: [], manualEligibilityConditions: [], requiredDocuments: [], amountMax: 5000000 };
test('official snapshot validates six real sources and rejects missing URL/date and synthetic records', () => {
  assert.ok(officialFundingCatalog.length >= 6);
  for (const patch of [{ url: null }, { verifiedAt: undefined }, { type: 'demo' }, { url: 'https://commercial.invalid/fund' }])
    assert.throws(() => validateOfficialCatalog([{ ...start, source: { ...start.source, ...patch } }]));
  assert.equal(fundingCatalogStatus().total, officialFundingCatalog.length);
});
test('closed, upcoming and unconfirmed acceptance are never eligible now', () => {
  const profile = { applicantType: 'project' as const };
  assert.equal(matchFundingOpportunity(profile, need, start).status, 'expired');
  assert.equal(matchFundingOpportunity(profile, need, { ...active, status: 'upcoming' }).status, 'upcoming');
  assert.equal(matchFundingOpportunity(profile, need, { ...active, status: 'unknown' }).status, 'need_more_data');
  assert.equal(matchFundingOpportunity(profile, need, active).amountFit, 'partial');
});
test('project without INN matches only explicitly permitted applicant types and unknown never passes', () => {
  const profile = { applicantType: 'project' as const, industry: 'Технологии' };
  const projectNeed = { ...need, amount: 1000000 };
  assert.equal('inn' in profile, false);
  const match = matchFundingOpportunity(profile, projectNeed, active);
  assert.equal(match.status, 'eligible');
  assert.deepEqual(match.unknownRequirements, []);
  assert.equal(match.personalEligibility?.confirmed, true);
  const rejected = matchFundingOpportunity(profile, projectNeed, { ...active, applicantTypes: ['legal_entity'] });
  assert.equal(rejected.status, 'not_eligible');
  assert.deepEqual(rejected.missingRequirements.map(r => r.field), ['applicantType']);
  const unknownApplicant = matchFundingOpportunity({ industry: profile.industry }, projectNeed, active);
  assert.equal(unknownApplicant.status, 'need_more_data');
  assert.deepEqual(unknownApplicant.unknownRequirements.map(r => r.field), ['applicantType']);
  assert.equal(unknownApplicant.personalEligibility?.confirmed, false);
  const unknownIndustry = matchFundingOpportunity({ applicantType: profile.applicantType }, projectNeed, active);
  assert.equal(unknownIndustry.status, 'need_more_data');
  assert.deepEqual(unknownIndustry.unknownRequirements.map(r => r.field), ['industry']);
  assert.equal(unknownIndustry.personalEligibility?.confirmed, false);
  const manual = matchFundingOpportunity(profile, projectNeed, { ...active,
    manualConditions: ['Подтвердить научную новизну'], manualEligibilityConditions: ['Подтвердить научную новизну'] });
  assert.equal(manual.status, 'need_more_data');
  assert.equal(manual.personalEligibility?.confirmed, false);
});
test('agriculture uses OKVED and does not assume that all farmers are a separate legal form', () => {
  const agro: FundingOpportunity = { ...officialFundingCatalog.find((o) => o.id === 'agrostart-tatarstan-2024')!, status: 'active', deadline: null,
    manualConditions: [], manualEligibilityConditions: [], requiredDocuments: [], amountMax: 3000000 };
  const agriculturalNeed = { ...emptyFundingNeed, purpose: 'сельхозтехника', amount: 1000000 };
  for (const companyType of ['ИП', 'ООО'] as const) {
    const profile = { companyType, region: 'Республика Татарстан', okved: '01.11', industry: 'Сельское хозяйство' };
    const match = matchFundingOpportunity(profile, agriculturalNeed, agro);
    assert.equal(match.status, 'eligible');
    assert.deepEqual(match.unknownRequirements, []);
    assert.equal(match.personalEligibility?.confirmed, true);
    const rejected = matchFundingOpportunity({ ...profile, okved: '62.01' }, agriculturalNeed, agro);
    assert.equal(rejected.status, 'not_eligible');
    assert.deepEqual(rejected.unknownRequirements, []);
    assert.deepEqual(rejected.missingRequirements.map(r => r.field), ['okved']);
  }
});
test('guarantee is support, cannot cover cash need; strategy excludes unavailable instruments', () => {
  const guarantee = officialFundingCatalog.find((o) => o.kind === 'guarantee')!;
  const n = { ...need, needsCollateralSupport: true };
  const match = matchFundingOpportunity({ companyType: 'ООО', isSme: 'yes' }, n, guarantee);
  assert.equal(match.amountFit, 'unknown'); assert.match(match.explanation, /не является выдачей денег/);
  assert.ok(match.relevance > match.score);
  const strategy = buildFundingStrategy({}, need, [matchFundingOpportunity({ applicantType: 'project' }, need, start)]);
  assert.equal(strategy.options.length, 0); assert.match(strategy.notices.join(' '), /Совместимость инструментов необходимо проверить/);
});
test('official AI context is recalculated on server; no profile identity, forged facts or client eligibility', () => {
  const prepared = preparePrivateRequest({ question: 'Сравни PRIVATE_QUESTION', task: 'compare', context: {
    profile: { name: 'PRIVATE_NAME', inn: '9900000031', companyType: 'ООО', isSme: 'yes' },
    need, programId: start.id, assessments: [{ status: 'approved', rate: 0.001 }],
  } });
  const wire = JSON.stringify(prepared.payload);
  assert.doesNotMatch(wire, /PRIVATE_QUESTION|PRIVATE_NAME|9900000031|approved|0\.001/);
  const safe = JSON.parse(prepared.payload.messages[1].content);
  assert.equal(safe.trustedPrograms[0].source.type, 'official'); assert.equal(safe.assessments[0].status, 'expired');
  prepared.dispose();
});
test('AI card links come from the trusted server context, never from model-generated IDs', async () => {
  const response = await privateCompletion({ question: 'Какие документы?', context: { profile: {}, programId: start.id, need } },
    { endpoint: 'https://api.giga.chat/v1/chat/completions', token: 'test-only', model: 'GigaChat-2-Pro' },
    (async () => Response.json({ choices: [{ message: { content: 'Проверьте условия. fabricated-program-id' } }] })) as typeof fetch);
  assert.deepEqual(response.opportunityIds, [start.id]);
});
