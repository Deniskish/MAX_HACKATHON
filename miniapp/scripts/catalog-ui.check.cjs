// Regression checks against the production Vite preview. Playwright is an external test tool.
// NODE_PATH=<playwright-install>/node_modules OPORA_TEST_PASSWORD=... node miniapp/scripts/catalog-ui.check.cjs
// Optional: OPORA_UI_URL, OPORA_UI_OUTPUT, CHROMIUM_EXECUTABLE, OPORA_UI_QUICK=1.
const { chromium, webkit } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const url = process.env.OPORA_UI_URL || 'http://127.0.0.1:3021';
const password = process.env.OPORA_TEST_PASSWORD;
const output = process.env.OPORA_UI_OUTPUT || '/tmp/opora-catalog-ui';
fs.mkdirSync(output, { recursive: true });
const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, '../api-server/funding-catalog/official-funding.snapshot.json')));
const region = catalog.flatMap(o => o.regions === 'all' ? [] : o.regions)[0];
assert.ok(region, 'An official region is needed for this regression scenario');
const draft = { id: 'retained-draft', programId: catalog[0].id, project: 'Сохранённое описание', budget: '100000', createdAt: '2026-09-26', documents: {}, documentFiles: {} };
const seed = { version: 2, data: { profile: null, projectProfile: null, fundingNeed: { purpose: '', amount: null, ownFunds: null, preferredTermMonths: null, needsCollateralSupport: null }, saved: [catalog[0].id], applications: [draft] } };
const results = [];
async function activate(page, locator) {
  if (page.viewportSize().width < 500) await locator.tap(); else await locator.click();
}
async function navigate(page, index) {
  await activate(page, page.locator('.home-nav').getByRole('button', { name: ['Главная', 'Поддержка', 'Заявки', 'Мой бизнес'][index], exact: true }));
  await page.waitForFunction(() => !document.querySelector('.tab-snapshot'));
  await checkNavigation(page);
}
async function checkNavigation(page) {
  const nav = page.locator('.home-nav');
  const names = await nav.getByRole('button').allTextContents();
  assert.deepEqual(names, names.includes('Поддержка') ? ['Главная', 'Поддержка', 'Заявки', 'Мой бизнес'] : ['Главная', 'Заявки', 'Мой бизнес']);
  const current = nav.locator('[aria-current=page]');
  assert.equal(await current.count(), 1);
  // Wait for the existing transform transition before comparing geometry.
  await page.waitForTimeout(280);
  const selected = await current.boundingBox(), indicator = await nav.locator('.home-nav-indicator').boundingBox();
  assert.ok(Math.abs(selected.x - indicator.x) < 1.5, JSON.stringify({ selected, indicator }));
  assert.ok(Math.abs(selected.width - indicator.width) < 1.5);
}
async function login(page, suffix = '') {
  await page.goto(url + suffix);
  await unlock(page);
}
async function unlock(page) {
  if (await page.locator('#access-password').count()) {
    assert.ok(password, 'Set OPORA_TEST_PASSWORD for the local access screen');
    await page.locator('#access-password').fill(password);
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
  }
  await page.locator('.home-dashboard').waitFor();
}
async function stored(page, key = 'opora.workspace') { return page.evaluate(key => JSON.parse(localStorage.getItem(key)), key); }
async function noOverflow(page) {
  assert.deepEqual(await page.locator('.app-shell > .app-content, .home-scroll, dialog[open], .catalog-tools-body').evaluateAll(nodes =>
    nodes.filter(e => e.scrollWidth > e.clientWidth + 1).map(e => e.className)), []);
}
async function filters(page) {
  if (await page.locator('.catalog-tools').getAttribute('open') === null) await page.locator('.catalog-tools > summary').click();
}
async function status(page, label) {
  await activate(page, page.locator('.catalog-status-trigger'));
  const dialog = page.getByRole('dialog', { name: 'Статус программы', exact: true });
  await activate(page, dialog.getByRole('option', { name: label, exact: true }));
  await dialog.waitFor({ state: 'hidden' });
}
async function count(page, expected) {
  assert.equal(await page.locator('.catalog-results-header > span').innerText(), `${expected} программ`);
  assert.equal(await page.locator('.funding-card').count(), Math.min(expected, 30));
}
async function setup(page) {
  await page.addInitScript(seed => {
    if (!sessionStorage.getItem('catalog-test-seeded')) {
      localStorage.setItem('opora.workspace', JSON.stringify(seed));
      sessionStorage.setItem('catalog-test-seeded', 'yes');
    }
  }, seed);
  await page.route('https://st.max.ru/**', r => r.fulfill({ contentType: 'application/javascript', body: '' }));
  await page.route('**/api/**', r => {
    const endpoint = new URL(r.request().url()).pathname;
    const json = endpoint === '/api/funding/catalog' ? { opportunities: catalog }
      : endpoint.endsWith('/updates') ? { updates: [] }
      : endpoint === '/api/ai/assist' ? { mode: 'local', answer: '', actions: [], citations: [], matches: [], findings: [], scenarios: [], followups: [], tools: [] }
      : { status: 'unconfigured', configured: false };
    return r.fulfill({ json });
  });
}
(async () => {
  for (const engine of process.env.OPORA_UI_ENGINE ? [process.env.OPORA_UI_ENGINE] : process.env.OPORA_UI_QUICK ? ['chromium'] : ['chromium', 'webkit']) {
    const browser = await (engine === 'chromium' ? chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) }) : webkit.launch({ headless: true }));
    try {
      for (const theme of process.env.OPORA_UI_QUICK ? ['dark'] : ['dark', 'light']) {
        for (const [width, height] of process.env.OPORA_UI_NARROW ? [[320, 568]] : process.env.OPORA_UI_QUICK ? [[390, 844]] : [[320, 568], [390, 844], [430, 932], [1440, 1000]]) {
          const label = `${engine}-${theme}-${width}`;
          const page = await browser.newPage({ viewport: { width, height }, colorScheme: theme, isMobile: width < 500, hasTouch: width < 500 });
          const errors = [];
          page.on('pageerror', e => errors.push(e.message));
          page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
          try {
            await setup(page); await login(page);
            assert.equal(await page.getByRole('heading', { name: 'С чего начать', exact: true }).count(), 1);
            assert.equal(await page.getByRole('heading', { name: 'О нас', exact: true }).count(), 1);
            assert.equal(await page.locator('.home-hero, .home-action-support, .home-action-business').count(), 3);
            await page.getByRole('heading', { name: 'О нас', exact: true }).scrollIntoViewIfNeeded();
            await noOverflow(page);
            assert.ok(await page.locator('.home-about p').evaluate(e => e.getBoundingClientRect().height / parseFloat(getComputedStyle(e).lineHeight) <= 3.1));
            await page.screenshot({ path: `${output}/${label}-home.png` });
            await page.getByRole('button', { name: 'У меня пока нет компании', exact: true }).click();
            await page.getByRole('dialog', { name: 'Проект без компании', exact: true }).getByRole('button', { name: 'Отмена', exact: true }).click();
            assert.equal(await page.locator('.home-nav .nav-programs').count(), 0);
            await navigate(page, 2); await navigate(page, 3); await navigate(page, 0);
            const buttons = page.locator('.home-nav button');
            // Safari uses Option+Tab to include all controls when full keyboard access is off.
            const tabKey = engine === 'webkit' ? 'Alt+Tab' : 'Tab';
            await buttons.first().focus(); await page.keyboard.press(tabKey);
            assert.equal(await buttons.nth(1).evaluate(e => e === document.activeElement && e.matches(':focus-visible')), true);
            await page.keyboard.press(tabKey); assert.equal(await buttons.nth(2).evaluate(e => e === document.activeElement), true);
            await page.locator('.home-action-support').click();
            await page.locator('.page-profile').waitFor();
            assert.equal(await page.locator('.catalog, .catalog-tools, .funding-card, .catalog-access-note').count(), 0);
            await page.getByRole('button', { name: 'Добавить бизнес', exact: true }).click();
            await page.getByRole('button', { name: 'Добавить компанию по ИНН', exact: true }).click();
            const company = page.getByRole('dialog', { name: 'Профиль бизнеса', exact: true });
            await company.getByRole('textbox', { name: 'ИНН', exact: true }).fill('7707083893');
            await company.getByRole('button', { name: 'Заполнить вручную', exact: true }).click();
            await company.getByRole('textbox', { name: 'Название', exact: true }).fill('Мастерская');
            await company.getByRole('combobox', { name: 'Регион', exact: true }).fill('Москва');
            await company.getByRole('textbox', { name: 'Основной ОКВЭД', exact: true }).fill('62.01');
            await company.getByRole('button', { name: 'Сохранить бизнес', exact: true }).click();
            await company.waitFor({ state: 'hidden' });
            await navigate(page, 1);
            assert.equal(await page.locator('.support-introduction').count(), 0);
            assert.equal(await page.locator('.catalog-scope-tabs').getAttribute('data-scope'), 'personal');
            assert.ok(await page.locator('.funding-card').count() < catalog.length);
            await page.getByRole('button', { name: 'Все меры', exact: true }).click();
            await count(page, catalog.filter(o => o.status !== 'closed').length);
            await filters(page);
            await activate(page, page.getByRole('checkbox', { name: 'Грант', exact: true }));
            await activate(page, page.getByRole('checkbox', { name: 'Льготный кредит', exact: true }));
            await page.locator('.catalog-region select').selectOption(region);
            await status(page, 'Приём открыт');
            const expected = catalog.filter(o => ['grant', 'preferential_loan'].includes(o.kind) && o.status === 'active'
              && (o.regions === 'all' || o.regions.includes(region)));
            assert.ok(expected.length); await count(page, expected.length);
            const preferences = await stored(page, 'opora.catalog-filters.v1');
            if (width < 500) assert.equal(await page.locator('.catalog-kind-option').evaluateAll(nodes => nodes.some(node => node.matches(':has(input:focus-visible)'))), false);
            assert.equal(preferences.region, region); assert.equal(preferences.kinds.length, 2); assert.equal(preferences.status, 'active');
            const before = await stored(page);
            await noOverflow(page); await page.screenshot({ path: `${output}/${label}-filters.png` });
            await page.getByRole('button', { name: `Показать программы · ${expected.length}`, exact: true }).click();
            await page.locator('.funding-card').first().getByRole('button', { name: 'Подробнее', exact: true }).click();
            await page.locator('dialog[open] .modal-close').click();
            assert.deepEqual(await stored(page, 'opora.catalog-filters.v1'), preferences);
            await count(page, expected.length);
            await navigate(page, 0); await navigate(page, 1);
            await count(page, expected.length);
            assert.deepEqual(await stored(page, 'opora.catalog-filters.v1'), preferences);
            await page.reload(); await unlock(page); await navigate(page, 1); await filters(page);
            assert.equal(await page.locator('.catalog-region select').inputValue(), region);
            assert.equal(await page.getByRole('checkbox', { name: 'Грант', exact: true }).isChecked(), true);
            assert.equal(await page.getByRole('checkbox', { name: 'Льготный кредит', exact: true }).isChecked(), true);
            await count(page, expected.length);
            await status(page, 'Приём завершён');
            await count(page, catalog.filter(o => ['grant', 'preferential_loan'].includes(o.kind) && o.status === 'closed'
              && (o.regions === 'all' || o.regions.includes(region))).length);
            await page.locator('.catalog-region select').selectOption('all');
            await count(page, catalog.filter(o => ['grant', 'preferential_loan'].includes(o.kind) && o.status === 'closed' && o.regions === 'all').length);
            await page.locator('.catalog-region select').selectOption(region);
            const normalFilters = await stored(page, 'opora.catalog-filters.v1');
            assert.deepEqual(await stored(page), before);
            await login(page, '?catalogDemo=admin'); await navigate(page, 1);
            assert.match(await page.locator('.catalog-demo-notice').innerText(), /Демо-режим · admin/);
            assert.equal(new URL(page.url()).searchParams.has('catalogDemo'), false);
            assert.deepEqual(await page.evaluate(() => JSON.parse(sessionStorage.getItem('opora.catalog-demo.v1'))), { mode: 'demo', profile: 'admin' });
            await count(page, catalog.length);
            await filters(page);
            await activate(page, page.getByRole('checkbox', { name: 'Грант', exact: true }));
            await activate(page, page.getByRole('checkbox', { name: 'Льготный кредит', exact: true }));
            await count(page, catalog.filter(o => ['grant', 'preferential_loan'].includes(o.kind)).length);
            await page.reload(); await unlock(page); await navigate(page, 1);
            await count(page, catalog.length);
            assert.deepEqual(await stored(page, 'opora.catalog-filters.v1'), normalFilters);
            await page.getByRole('button', { name: 'Выйти из деморежима', exact: true }).click();
            assert.deepEqual(await stored(page, 'opora.catalog-filters.v1'), normalFilters);
            assert.deepEqual(await stored(page), before);
            await noOverflow(page);
            // A fresh, empty workspace exercises the existing project flow and its persistence.
            await page.evaluate(seed => { localStorage.setItem('opora.workspace', JSON.stringify(seed)); localStorage.removeItem('opora.catalog-filters.v1'); }, seed);
            await login(page);
            assert.equal(await page.locator('.home-nav .nav-programs').count(), 0);
            await page.getByRole('button', { name: 'У меня пока нет компании', exact: true }).click();
            const project = page.getByRole('dialog', { name: 'Проект без компании', exact: true });
            await project.getByRole('textbox', { name: 'Название проекта', exact: true }).fill('Мастерская проекта');
            await project.getByRole('textbox', { name: 'Регион', exact: true }).fill(region);
            await project.getByRole('textbox', { name: 'Отрасль / направление', exact: true }).fill('Разработка');
            await project.getByRole('button', { name: 'Сохранить проект', exact: true }).click();
            await project.waitFor({ state: 'hidden' }); await navigate(page, 1);
            assert.equal(await page.locator('.catalog-tools').count(), 1);
            assert.equal(await page.locator('.support-introduction').count(), 0);
            const withProject = await stored(page);
            assert.equal(withProject.data.profile, null); assert.equal(withProject.data.projectProfile.hasLegalEntity, false);
            assert.equal(withProject.data.projectProfile.name, 'Мастерская проекта');
            assert.deepEqual(withProject.data.saved, seed.data.saved); assert.equal(withProject.data.applications[0].id, draft.id);
            await page.reload(); await unlock(page); await navigate(page, 1);
            assert.equal(await page.locator('.catalog-tools').count(), 1);
            await page.emulateMedia({ reducedMotion: 'reduce' });
            await page.getByRole('button', { name: 'Все меры', exact: true }).click();
            assert.equal(await page.locator('.catalog-scope-indicator').evaluate(e => getComputedStyle(e).transitionDuration), '0s');
            await filters(page); await page.locator('.catalog-status-trigger').focus(); await page.keyboard.press('Enter');
            const statusSheet = page.getByRole('dialog', { name: 'Статус программы', exact: true });
            await statusSheet.waitFor(); assert.equal(await statusSheet.evaluate(e => e.getAnimations().length), 0);
            await page.keyboard.press('ArrowDown'); assert.equal(await statusSheet.locator(':focus-visible').count(), 1);
            await page.keyboard.press('Escape'); await statusSheet.waitFor({ state: 'hidden' });
            assert.equal(await page.locator('.catalog-status-trigger').evaluate(e => e === document.activeElement), true);
            await navigate(page, 3);
            await page.locator('.app-topbar').getByRole('button', { name: /Настройки/ }).click();
            await page.getByRole('button', { name: 'Удалить бизнес', exact: true }).click();
            await page.getByRole('dialog', { name: 'Удалить бизнес?', exact: true }).getByRole('button', { name: 'Удалить', exact: true }).click();
            assert.equal(await page.locator('.home-nav .nav-programs').count(), 0);
            await checkNavigation(page); await navigate(page, 2); await navigate(page, 3);
            await page.reload(); await unlock(page);
            assert.equal(await page.locator('.home-nav .nav-programs').count(), 0);
            const removed = await stored(page);
            assert.equal(removed.data.profile, null); assert.equal(removed.data.projectProfile, null);
            assert.deepEqual(removed.data.saved, seed.data.saved); assert.equal(removed.data.applications[0].id, draft.id);
            await login(page, '?catalogDemo=admin'); await navigate(page, 1); await count(page, catalog.length);
            await page.reload(); await unlock(page); await navigate(page, 1); await count(page, catalog.length);
            assert.equal(new URL(page.url()).searchParams.has('catalogDemo'), false);
            assert.deepEqual(await stored(page), removed);
            await page.getByRole('button', { name: 'Выйти из деморежима', exact: true }).click();
            await page.locator('.page-profile').waitFor();
            assert.equal(await page.locator('.home-nav .nav-programs').count(), 0);
            assert.equal(await page.evaluate(() => sessionStorage.getItem('opora.catalog-demo.v1')), null);
            await checkNavigation(page); await noOverflow(page); assert.deepEqual(errors, []);
            results.push({ engine, theme, width, height, status: 'PASS', consoleErrors: errors });
            console.log(label, 'PASS');
          } catch (error) {
            await page.screenshot({ path: `${output}/${label}-failure.png` });
            throw new Error(`${label}: ${error.stack}`);
          } finally { await page.close(); }
        }
      }
    } finally { await browser.close(); }
  }
  fs.writeFileSync(`${output}/report.json`, JSON.stringify(results, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
