import type { Application } from "./domain";
import type { FundingOpportunity } from "../../api-server/funding-catalog/types";

export function applicationReadiness(
  app: Pick<
    Application,
    "project" | "budget" | "documents" | "reviewConfirmed"
  >,
  opportunity: Pick<FundingOpportunity, "kind" | "requiredDocuments">,
) {
  const budgetRequired = [
    "grant",
    "subsidy",
    "preferential_loan",
    "commercial_loan",
    "loan",
    "lease",
    "investment",
  ].includes(opportunity.kind);
  const budget = Number(app.budget);
  const budgetValid =
    !!app.budget.trim() &&
    Number.isSafeInteger(budget) &&
    budget > 0 &&
    budget <= 1e15;
  const project = !!app.project.trim();
  const total = opportunity.requiredDocuments.length;
  const prepared = opportunity.requiredDocuments.filter(
    (name) => !!app.documents[name],
  ).length;
  const documents = total > 0 && prepared === total;
  const budgetComplete = budgetValid || (!budgetRequired && !app.budget.trim());
  return {
    project,
    total,
    prepared,
    documents,
    budgetRequired,
    budgetValid,
    budgetComplete,
    ready:
      project && documents && budgetComplete && app.reviewConfirmed === true,
  };
}
