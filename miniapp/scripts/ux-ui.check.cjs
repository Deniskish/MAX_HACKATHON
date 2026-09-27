// Production-preview regressions for the iPhone/MAX UX fixes. Uses external Playwright.
// NODE_PATH=<playwright>/node_modules OPORA_TEST_PASSWORD=... node miniapp/scripts/ux-ui.check.cjs
const { chromium, webkit } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const url = process.env.OPORA_UI_URL || 'http://127.0.0.1:3021';
const out = process.env.OPORA_UI_OUTPUT || '/tmp/opora-iphone-ui';
fs.mkdirSync(out, { recursive: true });
const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, '../api-server/funding-catalog/official-funding.snapshot.json')));
const withDocs = catalog.find(o => o.requiredDocuments.length > 1 && o.status === 'active');
const withoutDocs = catalog.find(o => !o.requiredDocuments.length && o.status === 'active');
assert.ok(withDocs && withoutDocs);
const workspace = { version: 2, data: { profile: { inn: '7707083893', name: 'Мастерская', region: 'Москва', okved: '62.01', goals: [], companyType: 'ООО', applicantType: 'legal_entity' }, projectProfile: null,
  fundingNeed: { purpose: '', amount: null, ownFunds: null, preferredTermMonths: null, needsCollateralSupport: null }, saved: [],
  applications: [{ id: 'empty-draft', programId: withDocs.id, project: '', budget: '', createdAt: '2026-09-27', documents: {}, documentFiles: {} }] } };
const answer = { mode: 'llm', answer: 'Проверьте условия программы и подготовьте документы.', actions: [], citations: [{ id: 'official', title: withDocs.source.name, text: withDocs.description, url: withDocs.source.url }], matches: [], findings: [{ title: 'Документы', detail: 'Сверьте перечень в официальном объявлении.', severity: 'info' }], scenarios: [], followups: [], tools: [] };
const results = [];
async function activate(page, target) { if (page.viewportSize().width < 500) await target.tap(); else await target.click(); }
async function unlock(page) {
  if (await page.locator('#access-password').count()) {
    assert.ok(process.env.OPORA_TEST_PASSWORD); await page.locator('#access-password').fill(process.env.OPORA_TEST_PASSWORD);
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
  }
  await page.locator('.app-shell').waitFor();
}
async function load(page, program) { await page.goto(url + (program ? `?program=${program}` : '')); await unlock(page); }
async function nav(page, index) {
  await activate(page, page.locator('.home-nav button').nth(index));
  await page.waitForFunction(() => !document.querySelector('.tab-snapshot'));
}
async function noOverflow(page) {
  assert.deepEqual(await page.locator('.app-content, dialog[open] .modal, dialog[open] .project-dialog, .assistant-messages, .verification-sign-in').evaluateAll(nodes => nodes.filter(e => e.scrollWidth > e.clientWidth + 1).map(e => e.className)), []);
}
async function steps(page, expected) {
  assert.deepEqual(await page.locator('.preparation-options > button').evaluateAll(nodes => nodes.map(e => e.dataset.completed === 'true')), expected);
  for (let i = 0; i < 3; i++) {
    const indicator = page.locator('.preparation-options .step-radio').nth(i);
    assert.equal(await indicator.locator('svg').count(), Number(expected[i]));
    if (!expected[i]) assert.equal(await indicator.evaluate(e => getComputedStyle(e).backgroundColor), 'rgba(0, 0, 0, 0)');
  }
}
(async () => {
  for (const engine of process.env.OPORA_UI_ENGINE ? [process.env.OPORA_UI_ENGINE] : process.env.OPORA_UI_QUICK ? ['chromium'] : ['chromium', 'webkit']) {
    const browser = await (engine === 'chromium' ? chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) }) : webkit.launch({ headless: true }));
    try {
      for (const theme of process.env.OPORA_UI_QUICK ? ['dark'] : ['dark', 'light']) for (const [width, height] of process.env.OPORA_UI_QUICK ? [[390, 844]] : [[320, 568], [390, 844], [430, 932], [1440, 1000]]) {
        const name = `${engine}-${theme}-${width}`;
        const page = await browser.newPage({ viewport: { width, height }, colorScheme: theme, isMobile: width < 500, hasTouch: width < 500 });
        const errors = [];
        page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
        try {
          await page.addInitScript(data => { if (!sessionStorage.getItem('ux-seeded')) { localStorage.setItem('opora.workspace', JSON.stringify(data)); sessionStorage.setItem('ux-seeded', 'true'); } }, workspace);
          await page.route('https://st.max.ru/**', r => r.fulfill({ contentType: 'application/javascript', body: '' }));
          await page.route('**/api/**', r => {
            const endpoint = new URL(r.request().url()).pathname;
            return r.fulfill({ json: endpoint === '/api/funding/catalog' ? { opportunities: catalog } : endpoint.endsWith('/updates') ? { updates: [] }
              : endpoint === '/api/ai/assist' ? { ...answer, ...(r.request().postDataJSON().task === 'workspace' ? { mode: 'local' } : {}) } : { configured: true, status: 'ready' } });
          });
          await load(page, withoutDocs.id);
          let dialog = page.locator('dialog.opportunity-dialog[open]'); await dialog.waitFor();
          assert.equal(await dialog.locator('.plain-list').count(), 0);
          assert.equal(await dialog.getByRole('heading', { name: 'Что нужно подготовить', exact: true }).count(), 1);
          assert.equal(await dialog.getByRole('link', { name: 'объявлении отбора', exact: true }).count(), 1);
          const close = dialog.getByRole('button', { name: 'Закрыть', exact: true });
          assert.equal(await close.evaluate(e => e === document.activeElement || e.matches(':focus-visible') || e.matches(':active')), false);
          assert.equal(await close.evaluate(e => getComputedStyle(e).boxShadow), 'none');
          assert.equal(await dialog.locator('.modal').evaluate(e => e === document.activeElement), true);
          await page.screenshot({ path: `${out}/${name}-requirements.png` });
          await page.keyboard.press(engine === 'webkit' ? 'Alt+Tab' : 'Tab'); await close.focus();
          assert.equal(await close.evaluate(e => e.matches(':focus-visible')), true);
          await page.keyboard.press('Enter'); await dialog.waitFor({ state: 'hidden' });
          await load(page, withDocs.id); dialog = page.locator('dialog.opportunity-dialog[open]'); await dialog.waitFor();
          await steps(page, [false, false, false]);
          await activate(page, page.locator('.preparation-options > button').nth(1)); await steps(page, [false, false, false]);
          await page.locator('#application-project').fill('Оборудование для мастерской'); await steps(page, [false, true, false]);
          await page.locator('#application-project').fill('');
          await page.locator('#application-budget').fill('150000'); await steps(page, [false, false, true]);
          await page.locator('#application-budget').fill('0'); await steps(page, [false, false, false]);
          const documents = page.locator('.personal-checklist .checklist-title > input');
          assert.equal(await documents.count(), withDocs.requiredDocuments.length);
          await documents.first().check(); await steps(page, [false, false, false]);
          for (let i = 1; i < await documents.count(); i++) await documents.nth(i).check();
          await steps(page, [true, false, false]); await documents.first().uncheck(); await steps(page, [false, false, false]);
          const review = page.locator('.application-review');
          await review.scrollIntoViewIfNeeded();
          const alignment = await review.evaluate(e => ({ offset: e.querySelector('input').getBoundingClientRect().top - e.getBoundingClientRect().top, height: e.getBoundingClientRect().height }));
          assert.ok(alignment.offset >= 10 && alignment.offset <= 14); assert.ok(alignment.height >= 44);
          await noOverflow(page); await page.screenshot({ path: `${out}/${name}-review.png` });
          const help = dialog.locator('.personal-checklist .info-disclosure-row').first();
          await activate(page, help); assert.equal(await help.evaluate(e => e.parentElement.open), true);
          assert.equal(await help.evaluate(e => getComputedStyle(e).borderTopWidth), '1px');
          await activate(page, help); assert.equal(await help.evaluate(e => e.parentElement.open), false);
          const conditions = dialog.locator('.application-conditions > summary'); await activate(page, conditions);
          await dialog.getByRole('button', { name: 'Объяснить с AI', exact: true }).click();
          const explanation = page.locator('.assistant-explanation'); await explanation.waitFor();
          await page.getByRole('article', { name: 'Опора AI', exact: true }).getByText(answer.answer, { exact: false }).waitFor();
          const outer = await explanation.locator('.assistant-messages').evaluate(e => parseFloat(getComputedStyle(e).paddingLeft));
          const inner = await explanation.locator('.message.assistant').last().evaluate(e => parseFloat(getComputedStyle(e).paddingLeft));
          assert.ok(outer >= 16 && outer <= 20); assert.ok(inner >= 16 && inner <= 20);
          await noOverflow(page); await page.screenshot({ path: `${out}/${name}-ai.png` });
          await page.locator('.assistant-back').click();
          for (let tab = 0; tab < 4; tab++) {
            await nav(page, tab);
            const active = await page.locator('.home-nav [aria-current=page]').innerText();
            await page.locator(tab === 0 ? '.home-topbar .home-notifications' : '.app-topbar .home-notifications').click();
            await page.locator('.page-settings').waitFor();
            assert.equal(await page.locator('.home-nav [aria-current=page]').innerText(), active);
            assert.equal(await page.getByRole('radio').count(), 3);
            await page.locator('.app-back').click();
            assert.equal(await page.locator('.home-nav [aria-current=page]').innerText(), active);
            assert.equal(await page.locator('.page-settings').count(), 0);
          }
          await nav(page, 2); await page.locator('.app-topbar .home-notifications').click();
          await page.getByRole('button', { name: 'Войти через Госуслуги', exact: true }).click();
          const signIn = page.locator('.verification-sign-in'); await signIn.waitFor();
          assert.equal(await page.locator('.home-nav [aria-current=page]').innerText(), 'Заявки');
          const padding = await signIn.evaluate(e => parseFloat(getComputedStyle(e).paddingLeft)); assert.ok(padding >= 16 && padding <= 20);
          const next = signIn.getByRole('button', { name: 'Продолжить', exact: true }), cancel = signIn.getByRole('button', { name: 'Отмена', exact: true });
          assert.equal(await next.isDisabled(), true); assert.match(await cancel.getAttribute('class'), /secondary/);
          assert.ok((await cancel.boundingBox()).height >= 44);
          await signIn.getByRole('checkbox').check(); assert.equal(await next.isEnabled(), true);
          await signIn.getByRole('checkbox').uncheck(); await noOverflow(page);
          await page.screenshot({ path: `${out}/${name}-verification.png` });
          await activate(page, cancel); await page.locator('.page-settings').waitFor();
          assert.equal(await page.locator('.home-nav [aria-current=page]').innerText(), 'Заявки');
          await page.screenshot({ path: `${out}/${name}-settings.png` });
          await page.locator('.app-back').click(); assert.equal(await page.locator('.page-applications').count(), 1);
          await nav(page, 3); await page.getByRole('button', { name: 'Редактировать профиль', exact: true }).click();
          const form = page.getByRole('dialog', { name: 'Профиль бизнеса', exact: true }); await form.waitFor();
          const row = form.getByText('Дополнительные параметры', { exact: true }).locator('..');
          assert.match(await row.getAttribute('class'), /info-disclosure-row/);
          assert.equal(await row.evaluate(e => getComputedStyle(e).borderTopWidth), '1px');
          await page.emulateMedia({ reducedMotion: 'reduce' });
          assert.equal(await row.locator('svg').last().evaluate(e => getComputedStyle(e).transitionDuration), '0s');
          await row.focus(); await page.keyboard.press('Enter'); assert.equal(await row.evaluate(e => e.parentElement.open), true);
          assert.equal(await row.evaluate(e => e.matches(':focus-visible')), true);
          await page.screenshot({ path: `${out}/${name}-disclosure.png` });
          await noOverflow(page); assert.deepEqual(errors, []);
          results.push({ engine, theme, width, height, status: 'PASS', consoleErrors: errors }); console.log(name, 'PASS');
          fs.writeFileSync(`${out}/report.json`, JSON.stringify(results, null, 2));
        } catch (error) { await page.screenshot({ path: `${out}/${name}-failure.png` }); throw new Error(`${name}: ${error.stack}`); }
        finally { await page.close(); }
      }
    } finally { await browser.close(); }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
