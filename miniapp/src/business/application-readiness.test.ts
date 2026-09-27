import { test } from "node:test";
import assert from "node:assert/strict";
import { applicationReadiness } from "./application-readiness";
import {
  applicationStatus,
  loadWorkspace,
  saveWorkspace,
  restoreDocumentTexts,
} from "./workspace";
import { officialFundingCatalog } from "../../api-server/funding-catalog/official-catalog";
import { preparationProgress } from "./VisualWidgets";
import { draftText, emptyProfile, type Application } from "./domain";
import { matchFundingOpportunity } from "../../api-server/funding-catalog/matching";
import { emptyFundingNeed } from "../../api-server/funding-catalog/types";

test("known list, budget requirement and review determine both progress and readiness across monetary and nonmonetary aid", () => {
  for (const kind of [
    "grant",
    "subsidy",
    "preferential_loan",
    "commercial_loan",
    "loan",
    "guarantee",
    "lease",
    "tax",
    "property",
    "service",
    "investment",
  ] as const)
    for (const docs of [[], ["Смета"]])
      for (const project of ["", " ", "Описание"])
        for (const budget of [
          "",
          "0",
          "-1",
          "100000",
          "1.5",
          "NaN",
          "1000000000000001",
        ])
          for (const marked of [false, true])
            for (const reviewed of [false, true]) {
              const opportunity = {
                ...officialFundingCatalog[0],
                kind,
                requiredDocuments: docs,
              };
              const app: Application = {
                id: "a",
                programId: opportunity.id,
                createdAt: "",
                project,
                budget,
                documents: marked ? { Смета: "Готов" } : {},
                reviewConfirmed: reviewed,
              };
              const progress = preparationProgress(app, docs, kind),
                state = applicationReadiness(app, opportunity);
              const expected =
                !!project.trim() &&
                docs.length > 0 &&
                marked &&
                reviewed &&
                (budget === "100000" ||
                  (![
                    "grant",
                    "subsidy",
                    "preferential_loan",
                    "commercial_loan",
                    "loan",
                    "lease",
                    "investment",
                  ].includes(kind) &&
                    budget === ""));
              assert.equal(
                state.ready,
                expected,
                JSON.stringify({
                  kind,
                  docs,
                  project,
                  budget,
                  marked,
                  reviewed,
                }),
              );
              assert.equal(
                applicationStatus(app, opportunity) === "ready_for_review",
                expected,
              );
              assert.equal(
                expected,
                progress.total > 0 &&
                  progress.prepared === progress.total &&
                  progress.hasProject &&
                  progress.hasBudget &&
                  reviewed,
              );
            }
});
test("regressions: umbrella with no list and development with no budget never become ready", () => {
  for (const id of ["msp-umbrella", "frp-development"]) {
    const opportunity = officialFundingCatalog.find((o) => o.id === id)!;
    assert.ok(opportunity);
    const app: Application = {
      id,
      programId: id,
      createdAt: "",
      project: "Проект",
      budget: "",
      documents: Object.fromEntries(
        opportunity.requiredDocuments.map((d) => [d, "готов"]),
      ),
      reviewConfirmed: true,
    };
    assert.notEqual(applicationStatus(app, opportunity), "ready_for_review");
  }
});
test("document pages survive saving and reload, malformed stored content is rejected", () => {
  const doc = {
    id: "doc-1",
    name: "Смета",
    pages: [{ page: 2, text: "Материалы 100 000 рублей" }],
  };
  const values = new Map<string, string>();
  const storage = {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => {
      values.set(k, v);
    },
  };
  const id = officialFundingCatalog[0].id;
  saveWorkspace(storage, {
    profile: null,
    projectProfile: null,
    fundingNeed: emptyFundingNeed,
    saved: [],
    applications: [
      {
        id: "a",
        programId: id,
        project: "Проект",
        budget: "100000",
        documents: {},
        createdAt: "",
        documentTexts: { Смета: doc },
      },
    ],
  });
  assert.deepEqual(loadWorkspace(storage, [id]).applications[0].documentTexts, {
    Смета: doc,
  });
  assert.deepEqual(
    restoreDocumentTexts({
      bad: { id: "x", name: "x", pages: [{ page: "2", text: 42 }] },
    }),
    {},
  );
});
test("package export uses catalogue checks and includes the saved texts, without claiming submission", () => {
  const o = officialFundingCatalog[0],
    p = o;
  const match = matchFundingOpportunity({}, emptyFundingNeed, o);
  const text = draftText(
    {
      id: "a",
      programId: o.id,
      createdAt: "",
      project: "Проект",
      budget: "",
      documents: {},
      generatedDraft: "Черновик обоснования",
      documentTexts: {
        Смета: {
          id: "doc",
          name: "Смета",
          pages: [{ page: 1, text: "Материал: 500 рублей" }],
        },
      },
    },
    p,
    emptyProfile,
    match,
  );
  for (const check of [
    ...match.fulfilledRequirements,
    ...match.unknownRequirements,
    ...match.missingRequirements,
  ])
    assert.ok(text.includes(check.label));
  assert.match(text, /Черновик обоснования/);
  assert.match(text, /Материал: 500 рублей/);
  assert.match(text, /НЕ ОТПРАВЛЕН/);
});
