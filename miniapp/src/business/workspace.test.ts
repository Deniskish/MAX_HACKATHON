import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadWorkspace, saveWorkspace, removeBusiness, businessAddedNotice, type Workspace, applicationStatus, filterFunding, calendarICS, fundingEvents, projectAsProfile, personalFunding, trackedFunding } from './workspace';
import { officialFundingCatalog } from '../../api-server/funding-catalog/official-catalog';
import { matchFundingOpportunity } from '../../api-server/funding-catalog/matching';
import { emptyFundingNeed } from '../../api-server/funding-catalog/types';
import { OfficialDetails, ProjectOnboarding } from './OfficialExperience';
import { inspectDocumentText, emptyProfile, type Application } from './domain';
const ids = officialFundingCatalog.map((o) => o.id);
test('personal selection hides ineligible and closed measures and never counts unknown conditions as confirmed', () => {
  const base = matchFundingOpportunity({}, emptyFundingNeed, officialFundingCatalog[0]);
  const matches = (['eligible', 'almost_eligible', 'need_more_data', 'not_eligible', 'expired', 'upcoming'] as const).map((status) => ({ ...base, status }));
  assert.equal(personalFunding(matches, false).candidates.length, 0);
  const selection = personalFunding(matches, true);
  assert.deepEqual(selection.candidates.map((m) => m.status), ['eligible', 'almost_eligible', 'need_more_data']);
  assert.equal(selection.confirmed.length, 1); assert.equal(selection.pending.length, 2);
  const projectMatches = officialFundingCatalog.map((o) => matchFundingOpportunity({ applicantType: 'project' }, emptyFundingNeed, o));
  assert.ok(personalFunding(projectMatches, true).candidates.every((m) => m.status !== 'not_eligible'));
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
test('versioned workspace migrates bookmarks and drops synthetic profiles/unknown program drafts', () => {
  const storage = memory(); storage.setItem('opora.saved.v1', JSON.stringify([ids[0], ids[0], 'removed-program']));
  storage.setItem('opora.profile.v1', JSON.stringify({ inn: '9900000031', name: 'Учебная компания', goals: [] }));
  const data = loadWorkspace(storage, ids); assert.equal(data.profile, null); assert.deepEqual(data.saved, [ids[0]]);
  data.fundingNeed = { ...emptyFundingNeed, purpose: 'экспорт' }; saveWorkspace(storage, data);
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
  app.documents = Object.fromEntries(o.requiredDocuments.map((d) => [d, 'ready'])); app.reviewConfirmed = true;
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
  const events = fundingEvents(officialFundingCatalog, [closed.id], { [ids[0]]: 'older' }, []);
  assert.ok(events.some((e) => e.opportunityId === closed.id)); assert.ok(events.some((e) => e.id.startsWith('updated:')));
  assert.equal(fundingEvents(officialFundingCatalog, [], Object.fromEntries(officialFundingCatalog.map((o) => [o.id, o.version])), []).length, 0);
});
test('official details show source/date, unknown criteria and next actions; project onboarding requires no INN', () => {
  const match = matchFundingOpportunity({}, { ...emptyFundingNeed, purpose: 'покупка оборудования' }, officialFundingCatalog[0]);
  const html = renderToStaticMarkup(React.createElement(OfficialDetails, { match, onAsk() {} }));
  for (const label of ['Следующие действия', 'Открыть официальный источник', '2026-09-22']) assert.ok(html.includes(label));
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
  fundingNeed: { ...emptyFundingNeed, purpose: 'экспорт', amount: 1000000, ownFunds: 500000 }, saved: [ids[0]],
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
