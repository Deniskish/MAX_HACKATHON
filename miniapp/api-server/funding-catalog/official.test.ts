import test from 'node:test';
import assert from 'node:assert/strict';
import { officialFundingCatalog, validateOfficialCatalog, fundingCatalogStatus } from './official-catalog';
import { matchFundingOpportunity } from './matching';
import { buildFundingStrategy } from './strategy';
import { emptyFundingNeed, type FundingOpportunity } from './types';
import { preparePrivateRequest, privateCompletion } from '../privacy';
const need = { ...emptyFundingNeed, purpose: 'разработка продукта', amount: 10000000 };
const start = officialFundingCatalog.find((o) => o.id === 'fasie-start-1')!;
const active = { ...start, status: 'active', manualConditions: [], requiredDocuments: [], amountMax: 5000000 } as FundingOpportunity;
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
  assert.equal(matchFundingOpportunity({ applicantType: 'project' }, { ...need, amount: 1000000 }, active).status, 'eligible');
  assert.equal(matchFundingOpportunity({ applicantType: 'project' }, need, { ...active, applicantTypes: ['legal_entity'] }).status, 'not_eligible');
  assert.equal(matchFundingOpportunity({}, need, active).status, 'need_more_data');
  assert.equal(matchFundingOpportunity({ applicantType: 'project' }, need, { ...active, manualConditions: ['Подтвердить научную новизну'] }).status, 'need_more_data');
});
test('agriculture uses OKVED and does not assume that all farmers are a separate legal form', () => {
  const agro = { ...officialFundingCatalog.find((o) => o.id === 'agrostart-tatarstan-2024')!, status: 'active', deadline: null, manualConditions: [], requiredDocuments: [], amountMax: 3000000 } as FundingOpportunity;
  const agriculturalNeed = { ...emptyFundingNeed, purpose: 'сельхозтехника', amount: 1000000 };
  assert.equal(matchFundingOpportunity({ companyType: 'ИП', region: 'Республика Татарстан', okved: '01.11' }, agriculturalNeed, agro).status, 'eligible');
  assert.equal(matchFundingOpportunity({ companyType: 'ООО', region: 'Республика Татарстан', okved: '62.01' }, agriculturalNeed, agro).status, 'not_eligible');
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
