// Production-build journeys with controlled APIs: no real messages or submissions.
const { chromium, webkit } = require("playwright"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path");
const url = process.env.OPORA_UI_URL || "http://127.0.0.1:3021",
  out = process.env.OPORA_UI_OUTPUT || path.resolve("test-results/ux");
fs.mkdirSync(out, { recursive: true });
const catalog = JSON.parse(
  fs.readFileSync(
    path.join(
      __dirname,
      "../api-server/funding-catalog/official-funding.snapshot.json",
    ),
  ),
);
const withDocs = catalog.find((o) => o.id === "frp-development"),
  withoutDocs = catalog.find((o) => o.id === "msp-umbrella");
const workspace = {
  version: 2,
  data: {
    profile: {
      inn: "7707083893",
      name: "Мастерская",
      region: "Москва",
      okved: "28.99",
      goals: [],
      companyType: "ООО",
      applicantType: "legal_entity",
      isSme: "yes",
      ageMonths: 60,
    },
    projectProfile: null,
    fundingNeed: {
      purpose: "покупка оборудования",
      amount: null,
      ownFunds: null,
      preferredTermMonths: null,
      needsCollateralSupport: null,
    },
    saved: [],
    applications: [
      {
        id: "draft",
        programId: withDocs.id,
        project: "",
        budget: "",
        createdAt: "2026-09-27",
        documents: {},
        documentFiles: {},
      },
      {
        id: "unknown-list",
        programId: withoutDocs.id,
        project: "Гарантия для проекта",
        budget: "",
        createdAt: "2026-09-27",
        documents: {},
        reviewConfirmed: true,
      },
    ],
  },
};
const answer = {
    mode: "llm",
    answer: "Проверьте условия программы и подготовьте документы.",
    actions: [],
    citations: [],
    matches: [],
    findings: [],
    scenarios: [],
    followups: [],
    tools: [],
  },
  results = [];
async function load(page, id) {
  await page.goto(url + (id ? `?program=${id}` : ""));
  if (await page.locator("#access-password").count()) {
    assert.ok(process.env.OPORA_TEST_PASSWORD);
    await page
      .locator("#access-password")
      .fill(process.env.OPORA_TEST_PASSWORD);
    await page.getByRole("button", { name: "Войти", exact: true }).click();
  }
  await page.locator(".app-shell").waitFor();
}
async function nav(page, index) {
  await page.locator(".home-nav button").nth(index).click();
  const destination = ["overview", "programs", "applications", "profile"][index];
  await page.waitForFunction(
    (destination) =>
      document.querySelector(`.app-shell.page-${destination}`) &&
      !document.querySelector(".tab-snapshot"),
    destination,
  );
}
async function waitForScroll(page, expected) {
  try {
    // Require the original position across frames, rather than sampling once.
    await page.waitForFunction(async (expected) => {
      for (let frame = 0; frame < 3; frame++) {
        await new Promise(requestAnimationFrame);
        const content = document.querySelector(".app-shell > .app-content");
        if (!content || Math.abs(content.scrollTop - expected) >= 2) return false;
      }
      return true;
    }, expected);
  } catch (error) {
    const actual = await page
      .locator(".app-shell > .app-content")
      .evaluate((e) => ({
        top: e.scrollTop,
        max: e.scrollHeight - e.clientHeight,
      }));
    throw new Error(
      `Catalogue scroll: expected ${expected}, actual ${JSON.stringify(actual)}`,
      { cause: error },
    );
  }
}
async function tab(page, name) {
  await page.getByRole("tab", { name: new RegExp(name) }).click();
}
async function close(page) {
  await page
    .locator("dialog[open]")
    .getByRole("button", { name: "Закрыть", exact: true })
    .click();
}
async function snapshot(page, name) {
  assert.deepEqual(
    await page
      .locator(
        ".app-topbar, .home-topbar, .app-content, dialog[open] .modal, dialog[open] .project-dialog, .assistant-messages",
      )
      .evaluateAll((nodes) =>
        nodes
          .filter((e) => e.scrollWidth > e.clientWidth + 1)
          .map((e) => e.className),
      ),
    [],
  );
  await page.screenshot({ path: path.join(out, name + ".png") });
}
(async () => {
  for (const engine of process.env.OPORA_UI_ENGINE
    ? [process.env.OPORA_UI_ENGINE]
    : process.env.OPORA_UI_QUICK
      ? ["chromium"]
      : ["chromium", "webkit"]) {
    const browser = await (engine === "chromium"
      ? chromium.launch({
          headless: true,
          ...(process.env.CHROMIUM_EXECUTABLE
            ? { executablePath: process.env.CHROMIUM_EXECUTABLE }
            : {}),
        })
      : webkit.launch({ headless: true }));
    try {
      for (const theme of process.env.OPORA_UI_THEME
        ? [process.env.OPORA_UI_THEME]
        : process.env.OPORA_UI_QUICK ? ["dark"] : ["dark", "light"])
        for (const [width, height] of process.env.OPORA_UI_QUICK
          ? [[390, 844]]
          : [
              [320, 568],
              [390, 844],
              [430, 932],
              [1440, 1000],
            ]) {
          const name = `${engine}-${theme}-${width}`,
            page = await browser.newPage({
              viewport: { width, height },
              colorScheme: theme,
              isMobile: width < 500,
              hasTouch: width < 500,
            }),
            errors = [],
            requests = [];
          let failAI = false;
          page.setDefaultTimeout(12000);
          page.on("pageerror", (e) => errors.push(e.message));
          try {
            await page.addInitScript((data) => {
              if (!sessionStorage.getItem("ux-seeded")) {
                localStorage.setItem("opora.workspace", JSON.stringify(data));
                sessionStorage.setItem("ux-seeded", "true");
              }
            }, workspace);
            await page.route("https://st.max.ru/**", (r) =>
              r.fulfill({ contentType: "application/javascript", body: "" }),
            );
            await page.route("**/api/**", (r) => {
              const endpoint = new URL(r.request().url()).pathname;
              if (endpoint.startsWith("/api/company/")) {
                const profile = workspace.data.profile;
                return r.fulfill({
                  json: {
                    mode: "aggregator",
                    company: { inn: profile.inn },
                    sources: [],
                    profile: {
                      ...profile,
                      provenance: Object.fromEntries(
                        ["inn", "name", "region", "okved", "companyType"].map(
                          (key) => [
                            key,
                            {
                              kind: "source",
                              mode: "aggregator",
                              sourceId: "fixture",
                              source: "Данные реестра",
                              sourceUrl: "https://egrul.nalog.ru",
                              updatedAt: "2026-09-27",
                            },
                          ],
                        ),
                      ),
                    },
                  },
                });
              }
              if (endpoint === "/api/ai/assist") {
                const body = r.request().postDataJSON();
                requests.push(body);
                return r.fulfill({
                  json:
                    body.task === "workspace" || failAI
                      ? {
                          ...answer,
                          mode: "local",
                          providerFailure: "PROVIDER_UNAVAILABLE",
                        }
                      : answer,
                });
              }
              return r.fulfill({
                json:
                  endpoint === "/api/funding/catalog"
                    ? { opportunities: catalog }
                    : endpoint.endsWith("/updates")
                      ? { updates: [] }
                      : endpoint === "/api/funding/match"
                        ? {
                            matches: [],
                            strategy: { summary: "", options: [] },
                            mode: "official",
                          }
                        : { configured: true, status: "ready" },
              });
            });
            // Unknown checklist remains incomplete even with a historical confirmation.
            await load(page, withoutDocs.id);
            await tab(page, "Проверка");
            assert.equal(
              await page
                .getByRole("button", { name: "К подаче", exact: true })
                .isDisabled(),
              true,
            );
            await page
              .getByText("Уточните перечень документов у оператора", {
                exact: true,
              })
              .waitFor();
            await snapshot(page, name + "-unknown-list");
            await close(page);
            await load(page, withDocs.id);
            await tab(page, "Проект");
            await page
              .locator("#application-project")
              .fill("Оборудование для мастерской");
            await page.locator("#application-budget").fill("150000");
            await tab(page, "Документы");
            const checks = page.locator(
              ".personal-checklist .checklist-title > input",
            );
            for (let i = 0; i < (await checks.count()); i++)
              await checks.nth(i).check();
            await page.locator(".personal-checklist summary").first().click();
            const label = `Проверка текста документа: ${withDocs.requiredDocuments[0]}`,
              text = "Материалы: 100000 рублей. Оборудование: 50000 рублей.";
            await page
              .getByRole("textbox", { name: label, exact: true })
              .fill(text);
            await close(page);
            await nav(page, 2);
            await page
              .getByRole("button", { name: /Продолжить/ })
              .first()
              .click();
            await tab(page, "Документы");
            await page.locator(".personal-checklist summary").first().click();
            assert.equal(
              await page
                .getByRole("textbox", { name: label, exact: true })
                .inputValue(),
              text,
            );
            await tab(page, "Проверка");
            await page.locator(".application-review input").check();
            assert.equal(
              await page
                .getByRole("button", { name: "К подаче", exact: true })
                .isEnabled(),
              true,
            );
            await snapshot(page, name + "-review");
            await tab(page, "Проект");
            await page.locator("#application-budget").fill("");
            await tab(page, "Проверка");
            assert.equal(
              await page.locator(".application-review input").isChecked(),
              false,
            );
            await page.locator(".application-review input").check();
            assert.equal(
              await page
                .getByRole("button", { name: "К подаче", exact: true })
                .isDisabled(),
              true,
            );
            await tab(page, "Проект");
            await page.locator("#application-budget").fill("150000");
            await tab(page, "Проверка");
            await page.locator(".application-review input").check();
            // Contextual review sends the actual saved text; back restores the draft and stage.
            await page
              .getByRole("button", { name: "Проверить с AI", exact: true })
              .click();
            await page
              .getByRole("article", { name: "Опора AI", exact: true })
              .last()
              .getByText(answer.answer, { exact: false })
              .waitFor();
            const review = requests.findLast((r) => r.task === "review");
            assert.equal(review.context.programId, withDocs.id);
            assert.ok(
              review.context.documents[0].pages[0].text.includes("100000"),
            );
            await snapshot(page, name + "-chat");
            await page.locator(".assistant-back").click();
            assert.equal(
              await page
                .getByRole("tab", { name: /Проверка/ })
                .getAttribute("aria-selected"),
              "true",
            );
            await page
              .getByRole("button", { name: "К подаче", exact: true })
              .click();
            assert.equal(
              await page
                .getByRole("link", {
                  name: "Перейти к оператору ↗",
                  exact: true,
                })
                .getAttribute("href"),
              withDocs.source.url,
            );
            assert.equal(await page.getByText(/Заявка принята/).count(), 0);
            await snapshot(page, name + "-submission");
            await close(page);
            // Rule-based results survive AI outage; filters and scroll survive navigation.
            await nav(page, 1);
            assert.ok((await page.locator(".funding-card").count()) > 0);
            await page
              .getByRole("button", { name: "Все меры", exact: true })
              .click();
            await page
              .getByRole("textbox", { name: "Поиск мер поддержки" })
              .fill("ФРП");
            // A focused search field schedules its own scroll in Linux/WebKit.
            // Finish editing before setting the position we intend to preserve.
            await page
              .getByRole("textbox", { name: "Поиск мер поддержки" })
              .blur();
            const scroll = await page
              .locator(".app-shell > .app-content")
              .evaluate(async (e) => {
                await new Promise(requestAnimationFrame);
                await new Promise(requestAnimationFrame);
                const target = Math.min(300, e.scrollHeight - e.clientHeight);
                e.scrollTo({ top: target, behavior: "instant" });
                return target;
              });
            assert.ok(
              scroll > 0,
              "Catalogue must be scrolled for the return check",
            );
            await waitForScroll(page, scroll);
            await nav(page, 3);
            await nav(page, 1);
            assert.equal(
              await page
                .getByRole("textbox", { name: "Поиск мер поддержки" })
                .inputValue(),
              "ФРП",
            );
            assert.equal(
              await page
                .getByRole("button", { name: "Все меры", exact: true })
                .getAttribute("aria-pressed"),
              "true",
            );
            await waitForScroll(page, scroll);
            // The same position must survive when tab animations are disabled.
            await page.emulateMedia({ reducedMotion: "reduce" });
            await nav(page, 3);
            await nav(page, 1);
            await waitForScroll(page, scroll);
            await page.emulateMedia({ reducedMotion: "no-preference" });
            await snapshot(page, name + "-catalogue");
            assert.equal(
              await page
                .getByText(
                  /Сравниваем меры с данными бизнеса|Открыть весь каталог ·/,
                )
                .count(),
              0,
            );
            // Cancelling a task edit leaves the previous task intact; submitting uses the same catalogue.
            await page.locator(".catalog-task").click();
            await page
              .getByLabel("Цель", { exact: true })
              .selectOption({ index: 1 });
            await close(page);
            assert.match(
              await page.locator(".catalog-task").innerText(),
              /покупка оборудования/,
            );
            await page.locator(".catalog-task").click();
            await page
              .getByRole("button", { name: "Найти варианты", exact: true })
              .click();
            await page.locator(".page-programs").waitFor();
            await page.waitForFunction(
              () => !document.querySelector("dialog[open]"),
            );
            assert.equal(
              await page
                .getByRole("button", { name: "Для вас", exact: true })
                .getAttribute("aria-pressed"),
              "true",
            );
            for (let i = 0; i < 4; i++) {
              await nav(page, i);
              const active = await page
                .locator(".home-nav [aria-current=page]")
                .innerText();
              await page
                .getByRole("button", { name: "Настройки", exact: true })
                .click();
              assert.equal(await page.getByRole("radio").count(), 3);
              assert.equal(
                await page
                  .getByRole("button", { name: /^Уведомления/ })
                  .count(),
                0,
              );
              assert.equal(
                await page.locator(".home-nav [aria-current=page]").innerText(),
                active,
              );
              await page.locator(".app-back").click();
              assert.equal(
                await page.locator(".home-nav [aria-current=page]").innerText(),
                active,
              );
            }
            await page
              .getByRole("button", { name: "Настройки", exact: true })
              .click();
            await snapshot(page, name + "-settings");
            await page.goBack();
            await page.locator(".page-profile").waitFor();
            await page.evaluate(() => {
              window.WebApp = {
                ...window.WebApp,
                BackButton: {
                  show() {},
                  hide() {},
                  onClick(fn) {
                    window.__testMaxBack = fn;
                  },
                  offClick(fn) {
                    if (window.__testMaxBack === fn)
                      window.__testMaxBack = null;
                  },
                },
              };
              window.dispatchEvent(new Event("opora:max-ready"));
            });
            await page
              .getByRole("button", { name: "Настройки", exact: true })
              .click();
            await page.evaluate(() => window.__testMaxBack());
            await page.locator(".page-profile").waitFor();
            await page
              .getByRole("button", {
                name: "Данные и рекомендации",
                exact: true,
              })
              .click();
            await snapshot(page, name + "-business-details");
            await page
              .getByRole("tab", { name: "Данные", exact: true })
              .click();
            await snapshot(page, name + "-company-data");
            await page.locator(".app-back").click();
            assert.equal(
              await page
                .getByRole("button", {
                  name: "Войти через Госуслуги",
                  exact: true,
                })
                .count(),
              0,
            );
            assert.equal(await page.getByRole("button", { name: /^Уведомления/ }).count(), 0);
            await nav(page, 0);
            await page.locator(".home-opportunities").click();
            failAI = true;
            await page
              .getByRole("textbox", { name: "Сообщение помощнику" })
              .fill("Какая помощь доступна?");
            await page
              .getByRole("button", { name: "Отправить сообщение" })
              .click();
            await page
              .getByRole("button", { name: "Повторить запрос" })
              .waitFor();
            assert.equal(
              await page.getByText("PROVIDER_UNAVAILABLE").count(),
              0,
            );
            failAI = false;
            await page
              .getByRole("button", { name: "Повторить запрос" })
              .click();
            await page
              .getByRole("article", { name: "Опора AI" })
              .last()
              .getByText(answer.answer, { exact: false })
              .waitFor();
            // Persisted text survives a full reload, then can be removed explicitly.
            await load(page, withDocs.id);
            await tab(page, "Документы");
            await page.locator(".personal-checklist summary").first().click();
            assert.equal(
              await page
                .getByRole("textbox", { name: label, exact: true })
                .inputValue(),
              text,
            );
            await page
              .getByRole("button", {
                name: "Удалить текст и файл",
                exact: true,
              })
              .click();
            await close(page);
            await load(page, withDocs.id);
            await tab(page, "Документы");
            await page.locator(".personal-checklist summary").first().click();
            assert.equal(
              await page
                .getByRole("textbox", { name: label, exact: true })
                .inputValue(),
              "",
            );
            await close(page);
            // Public programme has one clear CTA; INN autofill returns to that programme.
            await page.evaluate(() => {
              const value = JSON.parse(localStorage.getItem("opora.workspace"));
              value.data.profile = null;
              value.data.applications = [];
              localStorage.setItem("opora.workspace", JSON.stringify(value));
            });
            await load(page, withoutDocs.id);
            assert.equal(
              await page
                .getByRole("button", {
                  name: "Добавить бизнес и проверить",
                  exact: true,
                })
                .count(),
              1,
            );
            await page
              .getByRole("button", {
                name: "Добавить бизнес и проверить",
                exact: true,
              })
              .click();
            await page
              .getByRole("button", {
                name: "Добавить компанию по ИНН",
                exact: true,
              })
              .click();
            await page
              .getByPlaceholder("10 или 12 цифр")
              .fill(workspace.data.profile.inn);
            await page
              .getByRole("button", { name: "Загрузить по ИНН", exact: true })
              .click();
            await page.getByText("Загружено по ИНН", { exact: true }).waitFor();
            await snapshot(page, name + "-autofill");
            await page
              .getByRole("button", { name: "Сохранить бизнес", exact: true })
              .click();
            await page
              .locator("dialog.opportunity-dialog[open]")
              .getByRole("heading", { name: withoutDocs.title, exact: true })
              .waitFor();
            await close(page);
            let notificationState = { enabled: true, bot: false, aiConfigured: true, items: [] };
            const subscriptionCalls = [];
            await page.route("**/api/notifications**", r => {
              const method = r.request().method();
              if (method === "PUT") {
                const body = r.request().postDataJSON();
                subscriptionCalls.push({ method, bot: body.bot });
                notificationState = { ...notificationState, enabled: true, bot: body.bot };
              }
              if (method === "DELETE") {
                subscriptionCalls.push({ method });
                notificationState = { ...notificationState, enabled: false, bot: false };
              }
              return r.fulfill({ json: notificationState });
            });
            // Controlled launch data is intercepted locally; no message is sent to MAX.
            await page.evaluate(() => {
              window.WebApp = { ...window.WebApp, initData: "test-launch" };
              window.dispatchEvent(new Event("opora:max-ready"));
            });
            await page.getByRole("button", { name: "Настройки", exact: true }).click();
            const delivery = page.getByRole("checkbox", { name: "Сообщать о новых мерах поддержки" });
            await delivery.waitFor();
            assert.equal(await page.getByRole("checkbox").count(), 1);
            await delivery.click();
            await page.waitForFunction(() => document.querySelector('.notification-toggle input')?.checked && !document.querySelector('.notification-toggle input')?.disabled);
            await delivery.click();
            await page.waitForFunction(() => !document.querySelector('.notification-toggle input')?.checked && !document.querySelector('.notification-toggle input')?.disabled);
            assert.ok(subscriptionCalls.some(call => call.method === "PUT" && call.bot === true));
            assert.ok(subscriptionCalls.some(call => call.method === "DELETE"));
            assert.equal(await page.getByRole("button", { name: /^Уведомления/ }).count(), 0);
            await snapshot(page, name + "-max-delivery");
            assert.deepEqual(errors, []);
            results.push({
              engine,
              theme,
              width,
              height,
              status: "PASS",
              checks: 21,
            });
            console.log(name, "PASS");
            fs.writeFileSync(
              path.join(out, "report.json"),
              JSON.stringify(results, null, 2),
            );
          } catch (error) {
            await page.screenshot({
              path: path.join(out, name + "-failure.png"),
            });
            throw new Error(`${name}: ${error.stack}`);
          } finally {
            await page.close();
          }
        }
    } finally {
      await browser.close();
    }
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
