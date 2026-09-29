// Run against a freshly built Vite preview. Requires Playwright Chromium/WebKit.
// OPORA_UI_URL=http://localhost:3021 node scripts/business-ui.check.cjs
const { chromium, webkit } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const url = process.env.OPORA_UI_URL || 'http://localhost:3021';
const output = process.env.OPORA_UI_OUTPUT || '/tmp/opora-business-ui';
fs.mkdirSync(output, { recursive: true });
const programId = JSON.parse(fs.readFileSync(path.join(__dirname, '../api-server/funding-catalog/official-funding.snapshot.json')))[0].id;
const need = { purpose: '', amount: null, ownFunds: null, preferredTermMonths: null, needsCollateralSupport: null };
const draft = { id: 'retained-draft', programId, project: 'Описание прежней компании', budget: '1500000', createdAt: '2026-09-26', documents: { 'Смета': 'Исходный текст сметы' }, documentFiles: { 'Смета': 'budget.pdf' }, generatedDraft: 'Прежний черновик', reviewConfirmed: true };
const seed = { version: 2, data: { profile: { inn: '7707083893', name: 'mock', region: 'Москва', okved: '62.01', goals: [], companyType: 'ООО', applicantType: 'legal_entity' }, projectProfile: null, fundingNeed: { ...need, purpose: 'экспорт', amount: 1500000 }, saved: [programId], applications: [draft] } };
const answer = { mode: 'llm', answer: 'Проверьте параметры бизнеса и цель поддержки.', actions: [], citations: [], matches: [], findings: [], scenarios: [], followups: [], tools: [] };
const results = [];
async function workspace(page) { return page.evaluate(() => JSON.parse(localStorage.getItem('opora.workspace')).data); }
async function navigate(page, tab) {
  await page.locator('.home-nav button').nth(tab).click();
  await page.waitForFunction(() => !document.querySelector('.tab-snapshot'));
}
async function noOverflow(page) {
  const bad = await page.locator('.app-shell > .app-content, dialog[open] .project-dialog, .page-ai-composer').evaluateAll(es => es.filter(e => e.scrollWidth > e.clientWidth + 1).map(e => e.className));
  assert.deepEqual(bad, []);
}
async function composer(page, title) {
  const disclosure = page.locator('.page-ai-composer').filter({ has: page.getByRole('heading', { name: title, exact: true, includeHidden: true }) });
  await disclosure.locator(':scope > summary').click();
  const metrics = await disclosure.evaluate(e => {
    const r = e.getBoundingClientRect(), panel = e.querySelector('.ai-panel');
    const children = [e.querySelector('.widget-heading'), e.querySelector('textarea'), panel.querySelector(':scope > .context-help'), panel.querySelector(':scope > .primary')];
    return { outerBorder: getComputedStyle(e).borderTopWidth, shadow: getComputedStyle(e).boxShadow, padding: parseFloat(getComputedStyle(e).paddingLeft), border: getComputedStyle(panel).borderWidth, background: getComputedStyle(panel).backgroundColor,
      children: children.map(n => ({ left: n.getBoundingClientRect().left - r.left, right: r.right - n.getBoundingClientRect().right })),
      bottom: r.bottom - children[3].getBoundingClientRect().bottom,
      gap: children[3].getBoundingClientRect().top - children[2].getBoundingClientRect().bottom };
  });
  assert.equal(metrics.outerBorder, '0px'); assert.equal(metrics.shadow, 'none'); assert.ok(metrics.padding >= 18); assert.equal(metrics.border, '0px'); assert.equal(metrics.background, 'rgba(0, 0, 0, 0)');
  for (const child of metrics.children) assert.ok(child.left >= 18 && child.right >= 18, JSON.stringify(metrics));
  assert.ok(metrics.bottom >= 18 && metrics.gap >= 16);
  const field = disclosure.getByRole('textbox', { name: 'Задача для помощника' });
  await field.fill('Поддержка для мастерской'); await field.focus();
  const viewport = page.viewportSize();
  if (viewport.width < 500) { await page.setViewportSize({ width: viewport.width, height: 360 }); await noOverflow(page); await page.setViewportSize(viewport); }
  await disclosure.locator(':scope > summary').click(); assert.equal(await disclosure.getAttribute('open'), null);
  await disclosure.locator(':scope > summary').click(); assert.equal(await field.inputValue(), 'Поддержка для мастерской');
  return disclosure;
}
(async () => {
  for (const engine of ['chromium', 'webkit']) {
    const browser = await (engine === 'chromium' ? chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) }) : webkit.launch({ headless: true }));
    try {
      for (const theme of ['dark', 'light']) for (const [width, height] of [[320, 568], [390, 844], [430, 932], [1440, 1000]]) {
        const label = `${engine}-${theme}-${width}`;
        const page = await browser.newPage({ viewport: { width, height }, colorScheme: theme, isMobile: width < 500, hasTouch: width < 500 });
        const errors = [], requests = [];
        page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
        await page.addInitScript(data => {
          if (sessionStorage.getItem('business-test-seeded')) return;
          localStorage.setItem('opora.workspace', JSON.stringify(data)); localStorage.setItem('opora.profile.v1', JSON.stringify(data.data.profile));
          localStorage.setItem('opora.ai.history.v2', JSON.stringify([{ role: 'user', text: 'Старая компания' }]));
          sessionStorage.setItem('business-test-seeded', 'yes');
        }, seed);
        await page.route('https://st.max.ru/**', r => r.fulfill({ contentType: 'application/javascript', body: '' }));
        await page.route('**/api/**', r => {
          if (r.request().url().endsWith('/ai/assist')) { const data = r.request().postDataJSON(); requests.push(data); return r.fulfill({ json: { ...answer, mode: data.task === 'workspace' ? 'local' : 'llm' } }); }
          return r.fulfill({ json: r.request().url().includes('updates') ? { updates: [] } : { status: 'ready', configured: true } });
        });
        await page.goto(url); await page.locator('.app-shell').waitFor();
        await navigate(page, 3);
        const padding = await page.locator('.app-shell > .app-content').evaluate(e => parseFloat(getComputedStyle(e).paddingLeft)); assert.ok(padding >= 16 && padding <= 20);
        await composer(page, 'План развития'); await noOverflow(page);
        await page.screenshot({ path: `${output}/${label}-profile.png` });
        await navigate(page, 1); assert.doesNotMatch(await page.locator('.catalog-glass-context').innerText(), /mock/);
        await composer(page, 'Умный поиск'); await noOverflow(page);
        await page.screenshot({ path: `${output}/${label}-search-ai.png` });
        const search = page.getByRole('textbox', { name: 'Поиск мер поддержки' }), box = page.locator('.search-box');
        const before = await box.boundingBox(); if (width < 500) await search.tap(); else await search.click();
        assert.equal((await box.boundingBox()).height, before.height);
        assert.equal(await page.locator('.search-box .opora-input-body').evaluate(e => getComputedStyle(e).boxShadow), 'none');
        await search.fill('Несуществующий запрос 783498');
        await page.getByText('Здесь пока нет программ', { exact: true }).waitFor();
        assert.match(await page.locator('.page-programs .empty-state').innerText(), /Измените цель, сумму/);
        await page.getByRole('button', { name: 'Посмотреть все меры', exact: true }).click(); assert.ok(await page.locator('.funding-card').count());
        await navigate(page, 3); const beforeCancel = await workspace(page);
        await page.getByRole('button', { name: 'Удалить бизнес', exact: true }).click();
        const confirmation = page.getByRole('dialog', { name: 'Удалить бизнес?', exact: true });
        await confirmation.getByRole('button', { name: 'Отмена', exact: true }).click(); assert.deepEqual(await workspace(page), beforeCancel);
        await page.getByRole('button', { name: 'Удалить бизнес', exact: true }).click(); await noOverflow(page);
        await confirmation.getByRole('button', { name: 'Удалить', exact: true }).click();
        await page.locator('.guest-hub').waitFor(); const cleared = await workspace(page);
        assert.equal(cleared.profile, null); assert.equal(cleared.projectProfile, null); assert.deepEqual(cleared.fundingNeed, need);
        assert.deepEqual(cleared.applications, [draft]); assert.deepEqual(cleared.saved, [programId]); assert.deepEqual(cleared.detachedApplicationIds, [draft.id]);
        assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('opora.ai.history.v2') || '[]')), []);
        await page.reload(); await page.locator('.app-shell').waitFor();
        await navigate(page, 3); await page.locator('.guest-hub').waitFor(); assert.equal((await workspace(page)).profile, null);
        await navigate(page, 1); await page.locator('.catalog-guest-context').waitFor(); assert.ok(await page.locator('.funding-card').count());
        await navigate(page, 2); await page.locator('.application-row').waitFor(); await noOverflow(page); await page.getByRole('button', { name: /Продолжить/ }).click();
        await page.getByRole('heading', { name: 'Сохранённый черновик', exact: true }).waitFor(); await page.getByRole('dialog').getByRole('button', { name: 'Закрыть', exact: true }).click();
        await navigate(page, 3); await page.getByRole('button', { name: 'Добавить бизнес', exact: false }).click();
        await page.getByRole('button', { name: 'У меня пока нет компании', exact: true }).click();
        await page.getByRole('textbox', { name: 'Название проекта', exact: true }).fill('Новая мастерская');
        await page.getByRole('textbox', { name: 'Регион', exact: true }).fill('Казань');
        await page.getByRole('textbox', { name: 'Отрасль / направление', exact: true }).fill('Мебель');
        await page.getByRole('button', { name: 'Сохранить проект', exact: true }).click(); await navigate(page, 3);
        assert.equal((await workspace(page)).projectProfile.name, 'Новая мастерская'); assert.deepEqual((await workspace(page)).fundingNeed, need);
        const newPlan = await composer(page, 'План развития'); await newPlan.getByRole('button', { name: 'Разобрать с AI', exact: true }).click();
        await newPlan.getByText(answer.answer, { exact: true }).waitFor();
        const request = requests.filter(r => r.task === 'analysis').at(-1); assert.deepEqual(request.context.workspace.applications, []); assert.equal(request.context.identifiers.name, 'Новая мастерская');
        await page.getByRole('button', { name: 'Удалить бизнес', exact: true }).click(); await confirmation.getByRole('button', { name: 'Удалить', exact: true }).click();
        await page.locator('.guest-hub').waitFor(); assert.equal((await workspace(page)).projectProfile, null); assert.deepEqual((await workspace(page)).applications, [draft]);
        await noOverflow(page); assert.deepEqual(errors, []);
        results.push({ engine, theme, width, height, status: 'PASS', consoleErrors: errors }); console.log(label, 'PASS'); await page.close();
      }
    } finally { await browser.close(); }
  }
  fs.writeFileSync(`${output}/report.json`, JSON.stringify(results, null, 2));
})().catch(error => { fs.writeFileSync(`${output}/report.json`, JSON.stringify({ results, error: error.stack }, null, 2)); console.error(error); process.exitCode = 1; });
