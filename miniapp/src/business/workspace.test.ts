import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadWorkspace, saveWorkspace, removeBusiness, businessAddedNotice, type Workspace, applicationStatus, filterFunding, calendarICS, fundingEvents, projectAsProfile, personalFunding, trackedFunding } from './workspace';
import { officialFundingCatalog } from '../../api-server/funding-catalog/official-catalog';
import { matchFundingOpportunity } from '../../api-server/funding-catalog/matching';
import { normalizeFundingPurpose, programmePurposeCategories } from '../../api-server/funding-catalog/purposes';
import { emptyFundingNeed, type FundingOpportunity, type FundingProfile } from '../../api-server/funding-catalog/types';
import { OfficialDetails, ProjectOnboarding } from './OfficialExperience';
import { inspectDocumentText, emptyProfile, type Application } from './domain';
const ids = officialFundingCatalog.map((o) => o.id);
test('personal selection separates base candidates from complete confirmation', async (t) => {
  // Isolated programme facts keep eligibility tests independent of the live official snapshot.
  const opportunity: FundingOpportunity = {
    id: 'personal-selection-test', title: 'Тестовая мера', kind: 'grant',
    providerName: 'Тестовый оператор', providerType: 'fund', description: 'Тестовая мера для производства',
    amountMin: 100, amountMax: 1000, rateMin: null, rateMax: null, termMonthsMin: null, termMonthsMax: null,
    regions: ['Москва'], purposes: ['покупка оборудования'], sectors: ['Промышленность'],
    okvedPrefixes: ['28'], companyTypes: [], applicantTypes: ['legal_entity'], status: 'active',
    requirements: [], manualConditions: [], manualEligibilityConditions: [], requiredDocuments: [],
    deadline: null, difficulty: 'low', preparationDays: null,
    source: { name: 'Тестовый источник', url: null, type: 'demo', updatedAt: '2026-09-28' }, version: 'test-1',
  };
  const profile: FundingProfile = { region: 'Москва', applicantType: 'legal_entity', okved: '28.41', industry: 'Промышленность' };
  const need = { ...emptyFundingNeed, purpose: 'покупка оборудования', amount: 500 };
  const options = { now: new Date('2026-09-28T12:00:00Z') };
  const eligible = matchFundingOpportunity(profile, need, opportunity, options);
  const almost = matchFundingOpportunity(profile, { ...need, amount: 1500 }, opportunity, options);
  const secondaryUnknown = matchFundingOpportunity(profile, need, { ...opportunity, requirements: [
    { field: 'revenue', operator: 'gte', value: 1000000, required: true, label: 'Годовая выручка от 1 млн ₽' },
  ] }, options);

  await t.test('no profile means no personal selection even for confirmed matches', () => {
    assert.equal(eligible.personalEligibility?.confirmed, true);
    assert.deepEqual(personalFunding([eligible, almost, secondaryUnknown], false), { candidates: [], confirmed: [], pending: [] });
  });
  await t.test('eligible with confirmed core criteria enters candidates and confirmed', () => {
    assert.equal(eligible.status, 'eligible');
    assert.deepEqual(eligible.personalEligibility, { confirmed: true, candidate: true, reasons: [] });
    assert.deepEqual(personalFunding([eligible], true), { candidates: [eligible], confirmed: [eligible], pending: [] });
  });
  await t.test('partial amount coverage enters candidates and pending, not confirmed', () => {
    assert.equal(almost.status, 'almost_eligible');
    assert.equal(almost.amountFit, 'partial');
    assert.equal(almost.personalEligibility?.confirmed, false);
    assert.equal(almost.personalEligibility?.candidate, true);
    assert.deepEqual(personalFunding([almost], true), { candidates: [almost], confirmed: [], pending: [almost] });
  });
  await t.test('unknown secondary data keeps the candidate without full confirmation', () => {
    assert.equal(secondaryUnknown.status, 'need_more_data');
    assert.deepEqual(secondaryUnknown.unknownRequirements.map(r => r.field), ['revenue']);
    assert.equal(secondaryUnknown.personalEligibility?.confirmed, false);
    assert.equal(secondaryUnknown.personalEligibility?.candidate, true);
    assert.deepEqual(personalFunding([secondaryUnknown], true), { candidates: [secondaryUnknown], confirmed: [], pending: [secondaryUnknown] });
  });

  const unknownCases: { name: string; field: string; profile?: FundingProfile; opportunity?: FundingOpportunity }[] = [
    { name: 'profile region', field: 'region', profile: { ...profile, region: undefined } },
    { name: 'programme territory', field: 'region', opportunity: { ...opportunity, regions: [] } },
    // No companyType fallback: the applicant category must actually be unknown.
    { name: 'profile applicant type', field: 'applicantType', profile: { ...profile, applicantType: undefined } },
    { name: 'programme applicant types', field: 'applicantType', opportunity: { ...opportunity, applicantTypes: [] } },
    { name: 'required OKVED', field: 'okved', profile: { ...profile, okved: undefined } },
    { name: 'required industry', field: 'industry', profile: { ...profile, industry: undefined } },
  ];
  for (const scenario of unknownCases) await t.test(`unknown ${scenario.name} remains pending without becoming confirmed`, () => {
    const match = matchFundingOpportunity(scenario.profile ?? profile, need, scenario.opportunity ?? opportunity, options);
    assert.equal(match.status, 'need_more_data');
    assert.equal(match.personalEligibility?.confirmed, false);
    assert.ok(match.personalEligibility!.reasons.length > 0);
    assert.ok(match.unknownRequirements.some(r => r.field === scenario.field && r.required));
    // Unknown facts remain visible separately from the confirmed positive control.
    assert.deepEqual(personalFunding([eligible, match], true), { candidates: [eligible, match], confirmed: [eligible], pending: [match] });
  });

  const excluded = [
    matchFundingOpportunity({ ...profile, okved: '01.11' }, need, opportunity, options),
    matchFundingOpportunity(profile, need, { ...opportunity, status: 'closed' }, options),
    matchFundingOpportunity(profile, need, { ...opportunity, status: 'upcoming' }, options),
  ];
  await t.test('ineligible, expired and upcoming measures are excluded from a mixed personal list', () => {
    assert.deepEqual(excluded.map(m => m.status), ['not_eligible', 'expired', 'upcoming']);
    assert.ok(excluded.every(m => m.personalEligibility?.confirmed === false));
    assert.deepEqual(personalFunding([eligible, almost, secondaryUnknown, ...excluded], true), {
      candidates: [eligible, almost, secondaryUnknown], confirmed: [eligible], pending: [almost, secondaryUnknown],
    });
  });
});
test('personal calendar is the union of bookmarks and applications, without other catalogue deadlines', () => {
  const app = { programId: ids[1] } as Application;
  assert.deepEqual(trackedFunding(officialFundingCatalog, [ids[0], ids[0], 'unknown'], [app]).map((o) => o.id), ids.slice(0, 2));
  assert.deepEqual(trackedFunding(officialFundingCatalog, [], []), []);
});
test('guest programme details show public terms without pretending to assess a missing profile', () => {
  const match = matchFundingOpportunity({}, emptyFundingNeed, officialFundingCatalog[0]);
  const html = renderToStaticMarkup(React.createElement(OfficialDetails, { match, personalized: false, onAsk: () => {} }));
  assert.match(html, /общие условия/); assert.doesNotMatch(html, /Почему подходит|Что не соответствует|Объяснить с помощью AI/);
});
const memory = () => { const map = new Map<string, string>(); return { get length() { return map.size; }, key: (index: number) => [...map.keys()][index] ?? null, removeItem: (k: string) => { map.delete(k); }, getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v); } }; };


test('live programme bookmarks and drafts survive an absent catalogue cache', () => {
  const storage = memory(), id = 'budget-5f564f52-ac51-4496-9db7-bd7b282f7b64';
  storage.setItem('opora.workspace', JSON.stringify({ version: 2, data: {
    saved: [id], applications: [{ id: 'draft', programId: id, project: 'Производство', budget: '400000', documents: {} }],
  } }));
  const restored = loadWorkspace(storage, ids);
  assert.deepEqual(restored.saved, [id]); assert.equal(restored.applications[0].programId, id);
});

test('official web programme bookmarks and drafts survive catalogue loading and reload', () => {
  const storage = memory(), id = 'web-1234567890abcdef12345678';
  storage.setItem('opora.workspace', JSON.stringify({ version: 2, data: {
    saved: [id, 'web-invalid'], applications: [{ id: 'draft-web', programId: id, project: 'Оборудование', budget: '400000', documents: {} }],
  } }));
  const restored = loadWorkspace(storage, ids);
  assert.deepEqual(restored.saved, [id]); assert.equal(restored.applications[0].programId, id);
  saveWorkspace(storage, restored);
  assert.deepEqual(loadWorkspace(storage, ids), restored);
});
test('versioned workspace migrates bookmarks and drops synthetic profiles/unknown program drafts', () => {
  const storage = memory(); storage.setItem('opora.saved.v1', JSON.stringify([ids[0], ids[0], 'removed-program']));
  storage.setItem('opora.profile.v1', JSON.stringify({ inn: '9900000031', name: 'Учебная компания', goals: [] }));
  const data = loadWorkspace(storage, ids); assert.equal(data.profile, null); assert.deepEqual(data.saved, [ids[0]]);
  data.fundingNeed = { ...emptyFundingNeed, purpose: 'Продажи, продвижение и экспорт' }; saveWorkspace(storage, data);
  assert.deepEqual(loadWorkspace(storage, ids), data);
  storage.setItem('opora.workspace', '{broken'); assert.doesNotThrow(() => loadWorkspace(storage, ids));
});
test('malformed localStorage cannot turn objects into profile facts or mark documents ready', () => {
  const storage = memory();
  storage.setItem('opora.workspace', JSON.stringify({ version: 2, data: {
    profile: { inn: '7707083893', name: 'Сохранённый профиль', goals: [], region: { value: 'Москва' } },
    applications: [{ id: 'a', programId: ids[0], project: 'Описание', budget: '', documents: { 'Бизнес-план': {} }, reviewConfirmed: 'yes', generatedDraft: {} }],
  } }));
  const data = loadWorkspace(storage, ids);
  assert.equal(data.profile, null); assert.deepEqual(data.applications[0].documents, {});
  assert.equal(data.applications[0].reviewConfirmed, false); assert.equal(data.applications[0].generatedDraft, undefined);
});
test('funding search, kind/status filter and saved filter use real opportunity IDs', () => {
  assert.equal(filterFunding(officialFundingCatalog, 'зонтичное', 'guarantee', 'active').length, 1);
  assert.equal(filterFunding(officialFundingCatalog, '', '', '', [ids[0]])[0].id, ids[0]);
  assert.ok(filterFunding(officialFundingCatalog, '', '', 'closed').every((o) => o.status === 'closed'));
});
test('application flow derives draft/collecting/ready and unchecking a document revokes readiness', () => {
  const o = officialFundingCatalog[0];
  const app: Application = { id: 'test', programId: o.id, createdAt: '', project: '', budget: '', documents: {} };
  assert.equal(applicationStatus(app, o), 'draft'); app.project = 'Описание'; assert.equal(applicationStatus(app, o), 'collecting_documents');
  app.documents = Object.fromEntries(o.requiredDocuments.map((d) => [d, 'ready'])); app.reviewConfirmed = true; app.budget = '100000';
  assert.equal(applicationStatus(app, o), 'ready_for_review'); app.documents[o.requiredDocuments[0]] = '';
  assert.equal(applicationStatus(app, o), 'collecting_documents');
  assert.match(inspectDocumentText('Бизнес-план', 'Коротко').notice, /не проверяет достоверность/);
});
test('calendar includes only published dates, escapes and folds ICS text with exclusive end date', () => {
  const calendar = calendarICS(officialFundingCatalog, new Date('2026-09-22T12:00:00Z'));
  assert.equal((calendar.match(/BEGIN:VEVENT/g) ?? []).length, officialFundingCatalog.filter((o) => o.deadline).length);
  assert.match(calendar, /DTSTART;VALUE=DATE:20240828/); assert.match(calendar, /DTEND;VALUE=DATE:20240829/);
  assert.doesNotMatch(calendar, /null|Invalid Date|demo/i);
  for (const line of calendar.split('\r\n')) assert.ok(new TextEncoder().encode(line).length <= 75);
});
test('notifications report actual closed bookmarks and snapshot updates only on observation', () => {
  const closed = officialFundingCatalog.find((o) => o.status === 'closed')!;
  const events = fundingEvents(officialFundingCatalog, [closed.id, ids[0]], { [ids[0]]: 'older' }, []);
  assert.ok(events.some((e) => e.opportunityId === closed.id)); assert.ok(events.some((e) => e.id.startsWith('updated:')));
  assert.equal(fundingEvents(officialFundingCatalog, [], Object.fromEntries(officialFundingCatalog.map((o) => [o.id, o.version])), []).length, 0);
});
test('official details show source/date, unknown criteria and next actions; project onboarding requires no INN', () => {
  const match = matchFundingOpportunity({}, { ...emptyFundingNeed, purpose: 'покупка оборудования' }, officialFundingCatalog[0]);
  const html = renderToStaticMarkup(React.createElement(OfficialDetails, { match, onAsk() {} }));
  for (const label of ['Следующие действия', match.opportunity.source.name, '22 сентября 2026']) assert.ok(html.includes(label));
  assert.ok(!html.includes('Открыть официальный источник'));
  for (const [label, checks] of [['Почему подходит', match.fulfilledRequirements], ['Что нужно уточнить', match.unknownRequirements], ['Что не соответствует', match.missingRequirements]] as const) {
    assert.equal(html.includes(`<h3>${label}</h3>`), checks.length > 0);
    for (const check of checks) assert.ok(html.includes(check.label));
  }
  assert.doesNotMatch(html, /Учебные данные|кредит одобрен/i);
  const project = { name: 'Проект', region: 'Москва', industry: 'Технологии', stage: 'idea' as const, teamSize: null, fundingNeed: null, fundingPurpose: '', hasLegalEntity: false as const };
  assert.equal(projectAsProfile(project).inn, '');
  const form = renderToStaticMarkup(React.createElement(ProjectOnboarding, { initial: project, onSave() {}, onCancel() {} }));
  assert.ok(form.includes('Сохранить проект')); assert.doesNotMatch(form, /placeholder="10 или 12 цифр"/);
});

const deletionWorkspace = (): Workspace => ({
  profile: { ...emptyProfile, inn: '7707083893', name: 'Прежняя компания', region: 'Москва', goals: ['экспорт'] },
  projectProfile: { name: 'Прежний проект', region: 'Москва', industry: 'Мебель', stage: 'mvp', hasLegalEntity: false, teamSize: 3, fundingNeed: 1000000, fundingPurpose: 'оборудование' },
  fundingNeed: { ...emptyFundingNeed, purpose: 'Продажи, продвижение и экспорт', amount: 1000000, ownFunds: 500000 }, saved: [ids[0]],
  applications: [{ id: 'preserved', programId: ids[0], project: 'Описание прежней компании', budget: '1000000', createdAt: '2026-09-26', documents: { 'Смета': 'Исходный текст' }, documentFiles: { 'Смета': 'budget.pdf' }, generatedDraft: 'Сохранённый черновик', reviewConfirmed: true }],
});
test('business deletion clears profiles and AI context, preserves every draft field and bookmark, and survives reload', () => {
  const storage = memory(), original = deletionWorkspace(); saveWorkspace(storage, original);
  for (const key of ['opora.profile.v1', 'opora.funding-need.v1.7707083893', 'opora.funding-need.v1.', 'opora.ai.history.v2', 'opora.ai.workspace.v1']) storage.setItem(key, 'old data');
  storage.setItem('unrelated.setting', 'keep');
  const removed = removeBusiness(storage, original);
  assert.equal(removed.profile, null); assert.equal(removed.projectProfile, null); assert.deepEqual(removed.fundingNeed, emptyFundingNeed);
  assert.deepEqual(removed.applications, original.applications); assert.deepEqual(removed.saved, original.saved); assert.deepEqual(removed.detachedApplicationIds, ['preserved']);
  assert.equal(original.profile?.name, 'Прежняя компания');
  for (const key of ['opora.profile.v1', 'opora.funding-need.v1.7707083893', 'opora.funding-need.v1.', 'opora.ai.history.v2', 'opora.ai.workspace.v1']) assert.equal(storage.getItem(key), null);
  assert.equal(storage.getItem('unrelated.setting'), 'keep'); assert.deepEqual(loadWorkspace(storage, ids), removed);
});
test('project deletion cannot resurrect a legacy company after reload', () => {
  const storage = memory(), original = { ...deletionWorkspace(), profile: null };
  storage.setItem('opora.profile.v1', JSON.stringify(deletionWorkspace().profile)); saveWorkspace(storage, original);
  removeBusiness(storage, original); const reloaded = loadWorkspace(storage, ids);
  assert.equal(reloaded.profile, null); assert.equal(reloaded.projectProfile, null); assert.deepEqual(reloaded.applications, original.applications);
});
test('adding a business after deletion starts clean and keeps prior drafts detached', () => {
  const storage = memory(); const removed = removeBusiness(storage, deletionWorkspace());
  saveWorkspace(storage, { ...removed, profile: { ...emptyProfile, inn: '7707083893', name: 'Новый бизнес', goals: [] } });
  const reloaded = loadWorkspace(storage, ids); assert.equal(reloaded.profile?.name, 'Новый бизнес'); assert.deepEqual(reloaded.profile?.goals, []);
  assert.deepEqual(reloaded.fundingNeed, emptyFundingNeed); assert.equal(reloaded.projectProfile, null); assert.deepEqual(reloaded.detachedApplicationIds, ['preserved']);
});
test('storage failure restores deletion inputs and reports failure', () => {
  const storage = memory(), original = deletionWorkspace(); saveWorkspace(storage, original); storage.setItem('opora.ai.history.v2', 'original chat');
  const before = storage.getItem('opora.workspace');
  assert.throws(() => removeBusiness({ ...storage, setItem(key, value) {
    if (key === 'opora.workspace' && JSON.parse(value).data.profile === null) throw new Error('quota');
    storage.setItem(key, value);
  } }, original), /quota/);
  assert.equal(storage.getItem('opora.workspace'), before); assert.equal(storage.getItem('opora.ai.history.v2'), 'original chat');
});

test('company-added notice persists its read state and disappears with the business', () => {
  const storage = memory(), original = { ...deletionWorkspace(), businessNotice: businessAddedNotice() };
  saveWorkspace(storage, original);
  assert.match(loadWorkspace(storage, ids).businessNotice!.title, /Поздравляем/);
  assert.equal(loadWorkspace(storage, ids).businessNotice!.readAt, null);
  original.businessNotice.readAt = Date.now(); saveWorkspace(storage, original);
  assert.equal(loadWorkspace(storage, ids).businessNotice!.readAt, original.businessNotice.readAt);
  removeBusiness(storage, original); assert.equal(loadWorkspace(storage, ids).businessNotice, null);
});

test('legacy workspace migrates the task while preserving profile goals and optional refinements', () => {
  const storage = memory();
  const legacy = deletionWorkspace();
  legacy.profile!.goals = ['сельхозтехника'];
  legacy.fundingNeed = { ...emptyFundingNeed, purpose: 'сельхозтехника', amount: null, ownFunds: 250000, preferredTermMonths: 36, needsCollateralSupport: true };
  saveWorkspace(storage, legacy);
  const restored = loadWorkspace(storage, ids);
  assert.deepEqual(restored.fundingNeed, { ...legacy.fundingNeed, purpose: normalizeFundingPurpose('сельхозтехника') });
  assert.deepEqual(restored.profile!.goals, ['сельхозтехника']);
  saveWorkspace(storage, restored);
  assert.deepEqual(loadWorkspace(storage, ids), restored);
  const project = { ...legacy.projectProfile!, fundingPurpose: emptyFundingNeed.purpose };
  assert.deepEqual(projectAsProfile(project).goals, []);
});
test('all purposes admits only company-relevant pending candidates without confusing them with confirmed matches', () => {
  const profile = { region: 'Москва', applicantType: 'legal_entity' as const, industry: 'Промышленность', okved: '28.41' };
  const o: FundingOpportunity = { ...officialFundingCatalog[0], amountMin: null, amountMax: null,
    manualConditions: [], manualEligibilityConditions: [], projectBudgetMin: null, cofinancingPercent: null,
    purposes: ['покупка оборудования'], okvedPrefixes: ['28'], deadline: null, status: 'active' };
  const confirmed = matchFundingOpportunity(profile, { ...emptyFundingNeed, purpose: 'Оборудование и модернизация' }, o);
  const pending = matchFundingOpportunity(profile, emptyFundingNeed, { ...o, purposes: [] });
  const closed = matchFundingOpportunity(profile, emptyFundingNeed, { ...o, status: 'closed' });
  const otherRegion = matchFundingOpportunity(profile, emptyFundingNeed, { ...o, regions: ['Республика Татарстан'] });
  assert.equal(confirmed.status, 'eligible');
  assert.equal(pending.status, 'need_more_data');
  assert.equal(pending.purposeFit, false);
  assert.equal(pending.personalEligibility?.confirmed, false);
  assert.deepEqual(personalFunding([confirmed, pending, closed, otherRegion], true), {
    candidates: [confirmed, pending, otherRegion], confirmed: [confirmed], pending: [pending, otherRegion],
  });
  assert.deepEqual(programmePurposeCategories(o.purposes), ['Оборудование и модернизация']);
});
