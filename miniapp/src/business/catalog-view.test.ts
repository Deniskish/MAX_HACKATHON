import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { officialFundingCatalog as catalog } from '../../api-server/funding-catalog/official-catalog';
import { emptyFundingNeed, type ProjectProfile } from '../../api-server/funding-catalog/types';
import { matchFundingOpportunity } from '../../api-server/funding-catalog/matching';
import { emptyProfile } from './domain';
import { personalFunding, loadWorkspace, saveWorkspace, removeBusiness } from './workspace';
import { catalogFiltersKey, catalogRegions, defaultCatalogFilters, hasSupportProfile, loadCatalogFilters, saveCatalogFilters, selectCatalog } from './catalog-view';
import { isCatalogDemo, loadCatalogDemo, saveCatalogDemo, catalogDemoKey } from './catalog-demo';
import { HomePage } from './HomePage';
import { AppNavigation } from './AppChrome';
import { SupportIntroduction } from './SupportIntroduction';

// The existing Node harness transpiles JSX in classic mode outside Vite.
Object.assign(globalThis, { React });

const company = { ...emptyProfile, inn: '7707083893', name: 'Мастерская', region: 'Москва', okved: '62.01' };
const project: ProjectProfile = { name: 'Мастерская', region: 'Москва', industry: 'Разработка', stage: 'idea', hasLegalEntity: false, teamSize: null, fundingNeed: null, fundingPurpose: '' };
const ids = (items: typeof catalog) => items.map((o) => o.id).sort();
const context = { hasProfile: true, demo: false, personalIds: [] as string[], saved: [] as string[] };
const all = { ...defaultCatalogFilters(), scope: 'all' as const };
function storage() {
  const data = new Map<string, string>();
  return { get length() { return data.size; }, key: (index: number) => [...data.keys()][index] ?? null,
    removeItem: (key: string) => { data.delete(key); }, getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
}

test('empty or incomplete users cannot browse any catalogue scope', () => {
  assert.equal(hasSupportProfile(null, null), false);
  assert.equal(hasSupportProfile(emptyProfile, { ...project, industry: ' ' }), false);
  for (const scope of ['personal', 'all', 'saved'] as const) {
    assert.deepEqual(selectCatalog(catalog, { ...all, scope }, { ...context, hasProfile: false, personalIds: ids(catalog), saved: ids(catalog) }), []);
  }
  const html = renderToStaticMarkup(React.createElement(SupportIntroduction, { onBusiness() {}, onProject() {} }));
  assert.match(html, /Добавить бизнес по ИНН/); assert.match(html, /У меня пока нет компании/);
});

test('a saved company unlocks support and survives reload', () => {
  const s = storage();
  saveWorkspace(s, { profile: company, projectProfile: null, fundingNeed: emptyFundingNeed, saved: [], applications: [] });
  const restored = loadWorkspace(s, ids(catalog));
  assert.equal(hasSupportProfile(restored.profile, restored.projectProfile), true);
  assert.ok(selectCatalog(catalog, all, context).length > 0);
});

test('a project without a legal entity unlocks support using the existing workspace', () => {
  const s = storage();
  saveWorkspace(s, { profile: null, projectProfile: project, fundingNeed: emptyFundingNeed, saved: [], applications: [] });
  const restored = loadWorkspace(s, ids(catalog));
  assert.equal(restored.profile, null);
  assert.deepEqual(restored.projectProfile, project);
  assert.equal(hasSupportProfile(restored.profile, restored.projectProfile), true);
});

test('explicit admin preview sees every official measure without altering facts or matching', () => {
  const before = JSON.stringify(catalog);
  const s = storage();
  const state = loadCatalogDemo(s, '?catalogDemo=admin');
  assert.equal(isCatalogDemo(state), true);
  for (const search of ['', '?admin=true', '?catalogDemo=other', '?name=admin']) assert.equal(isCatalogDemo(loadCatalogDemo(s, search)), false);
  assert.deepEqual(ids(selectCatalog(catalog, defaultCatalogFilters(), { ...context, hasProfile: false, demo: isCatalogDemo(state) })), ids(catalog));
  assert.equal(JSON.stringify(catalog), before);
});

test('an ordinary company, even named admin, keeps its personal matching constraints', () => {
  assert.equal(hasSupportProfile({ ...company, name: 'admin' }, null), true);
  const matches = catalog.map((o) => matchFundingOpportunity({ region: 'Москва', applicantType: 'project' }, emptyFundingNeed, o));
  const candidates = personalFunding(matches, true).candidates.map((m) => m.opportunity.id);
  const result = selectCatalog(catalog, defaultCatalogFilters(), { ...context, personalIds: candidates });
  assert.ok(result.length < catalog.length);
  assert.ok(result.every((o) => candidates.includes(o.id) && o.status !== 'closed'));
});

test('grant and preferential loan multi-select is a union, not an intersection', () => {
  const result = selectCatalog(catalog, { ...all, kinds: ['grant', 'preferential_loan'] }, context);
  const expected = catalog.filter((o) => ['grant', 'preferential_loan'].includes(o.kind) && o.status !== 'closed');
  assert.deepEqual(ids(result), ids(expected));
  // Archived grants remain testable without inventing an active catalogue entry.
  const demoResult = selectCatalog(catalog, { ...all, kinds: ['grant', 'preferential_loan'] }, { ...context, demo: true });
  assert.ok(demoResult.some((o) => o.kind === 'grant')); assert.ok(demoResult.some((o) => o.kind === 'preferential_loan'));
});

test('regions come exclusively from catalogue facts and include nationwide measures', () => {
  const regions = catalogRegions(catalog);
  assert.deepEqual(new Set(regions), new Set(catalog.flatMap((o) => o.regions === 'all' ? [] : o.regions)));
  for (const region of [...regions, 'all']) {
    assert.deepEqual(ids(selectCatalog(catalog, { ...all, region }, context)), ids(catalog.filter((o) => o.status !== 'closed'
      && (o.regions === 'all' || region !== 'all' && o.regions.includes(region)))));
  }
});

test('closed programmes require an explicit status in the main list; saved entries remain available', () => {
  assert.ok(selectCatalog(catalog, all, context).every((o) => o.status !== 'closed'));
  for (const status of ['active', 'closed', 'upcoming', 'unknown'] as const) {
    assert.deepEqual(ids(selectCatalog(catalog, { ...all, status }, context)), ids(catalog.filter((o) => (o.status ?? 'unknown') === status)));
  }
  assert.deepEqual(ids(selectCatalog(catalog, { ...all, scope: 'saved' }, { ...context, saved: ids(catalog) })), ids(catalog));
});

test('persisting filters leaves workspace, bookmarks and drafts intact and restores every selection', () => {
  const s = storage();
  s.setItem('opora.workspace', JSON.stringify({ saved: [catalog[0].id], applications: [{ id: 'draft' }], projectProfile: project }));
  const workspace = s.getItem('opora.workspace');
  const filters = { ...all, region: catalogRegions(catalog)[0], kinds: ['grant', 'preferential_loan'] as const, status: 'active' as const };
  saveCatalogFilters(s, { ...filters, kinds: [...filters.kinds] });
  assert.deepEqual(loadCatalogFilters(s), filters);
  assert.equal(s.getItem('opora.workspace'), workspace);
});

test('malformed or unavailable filter storage falls back safely', () => {
  const s = storage(); s.setItem(catalogFiltersKey, '{');
  assert.deepEqual(loadCatalogFilters(s), defaultCatalogFilters());
  s.setItem(catalogFiltersKey, JSON.stringify({ region: {}, kinds: ['grant', 'grant', 'invented', '__proto__'], status: 'invalid', scope: 'invalid' }));
  assert.deepEqual(loadCatalogFilters(s), { ...defaultCatalogFilters(), kinds: ['grant'] });
  assert.deepEqual(loadCatalogFilters({ getItem() { throw Error('blocked'); } }), defaultCatalogFilters());
});

test('home adds short introductions while preserving hero, primary actions and navigation', () => {
  const props = { onFindSupport() {}, onAddBusiness() {}, onStartBusiness() {}, onAddProject() {}, onAssistant() {}, onSettings() {}, onApplications() {}, onBusiness() {},
    onAIAction() {}, personalized: false, supportReady: false, hasNotifications: false,
    analysis: { status: 'unavailable' as const, data: undefined, at: undefined, error: undefined, refresh() {} } };
  const html = renderToStaticMarkup(React.createElement(HomePage, props));
  for (const text of ['С чего начать', 'О нас', 'Добавить бизнес по ИНН', 'У меня пока нет компании', 'home-hero', 'home-action-support', 'home-action-business', 'home-nav']) assert.ok(html.includes(text), text);
  const ready = renderToStaticMarkup(React.createElement(HomePage, { ...props, supportReady: true, personalized: true }));
  assert.ok(!ready.includes('С чего начать')); assert.ok(ready.includes('О нас'));
});

function navigation(companyProfile: typeof company | null, projectProfile: ProjectProfile | null, active: 'overview' | 'applications' | 'profile' = 'overview') {
  return renderToStaticMarkup(React.createElement(AppNavigation, { active, onNavigate() {}, supportAvailable: hasSupportProfile(companyProfile, projectProfile) }));
}
test('empty user has three navigation tabs and no support button', () => {
  const html = navigation(null, null);
  assert.doesNotMatch(html, /Поддержка|nav-programs/);
  assert.match(html, /data-count="3"/);
  assert.equal((html.match(/<button/g) ?? []).length, 3);
});
test('adding a company makes support visible in its original position', () => {
  const html = navigation(company, null);
  assert.match(html, /data-count="4"/);
  assert.ok(html.indexOf('Главная') < html.indexOf('Поддержка'));
  assert.ok(html.indexOf('Поддержка') < html.indexOf('Заявки'));
});
test('adding a project makes support visible without a company', () => {
  assert.match(navigation(null, project), /nav-programs/);
});
test('deleting either profile hides support and preserves bookmarks and drafts', () => {
  for (const workspace of [
    { profile: company, projectProfile: null }, { profile: null, projectProfile: project },
  ]) {
    const cleared = removeBusiness(storage(), { ...workspace, fundingNeed: emptyFundingNeed, saved: [catalog[0].id], applications: [] });
    assert.doesNotMatch(navigation(cleared.profile, cleared.projectProfile), /Поддержка/);
    assert.deepEqual(cleared.saved, [catalog[0].id]);
  }
});
test('active navigation index follows visible tabs, retaining keyboard buttons', () => {
  for (const [profile, appIndex, profileIndex] of [[null, 1, 2], [company, 2, 3]] as const) {
    assert.match(navigation(profile, null, 'applications'), new RegExp(`data-active="${appIndex}"`));
    const html = navigation(profile, null, 'profile');
    assert.match(html, new RegExp(`data-active="${profileIndex}"`));
    assert.match(html, /class="nav-profile" aria-current="page"/);
    assert.doesNotMatch(html, /tabindex="-1"|disabled/);
  }
});
test('explicit demo state survives reload without a query or a legal company and clears on exit', () => {
  const s = storage(); s.setItem('opora.workspace', 'unchanged');
  const state = loadCatalogDemo(s, '?catalogDemo=admin');
  assert.deepEqual(state, { mode: 'demo', profile: 'admin' });
  saveCatalogDemo(s, state);
  assert.deepEqual(loadCatalogDemo(s), state);
  const html = renderToStaticMarkup(React.createElement(AppNavigation, { active: 'programs', onNavigate() {}, supportAvailable: isCatalogDemo(loadCatalogDemo(s)) }));
  assert.match(html, /nav-programs/);
  assert.equal(s.getItem('opora.workspace'), 'unchanged');
  saveCatalogDemo(s, null);
  assert.equal(loadCatalogDemo(s), null);
  assert.equal(s.getItem(catalogDemoKey), null);
});
test('malformed demo state and ordinary profile names cannot enable admin', () => {
  const s = storage();
  for (const value of ['{', '{"name":"admin"}', '{"mode":"admin","profile":"admin"}', '{"mode":"demo","profile":"company"}']) {
    s.setItem(catalogDemoKey, value); assert.equal(loadCatalogDemo(s), null);
  }
  assert.equal(loadCatalogDemo({ getItem() { throw Error('blocked'); } }), null);
});
