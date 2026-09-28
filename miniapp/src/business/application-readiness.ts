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
    "unknown",
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
  const documentsKnown = total > 0;
  const documentsComplete = documentsKnown && prepared === total;
  const budgetComplete = budgetValid || (!budgetRequired && !app.budget.trim());
  const readyForReview = project && budgetComplete && documentsComplete && app.reviewConfirmed === true;
  const canProceedToOperator = project && budgetComplete && app.reviewConfirmed === true
    && (documentsComplete || !documentsKnown);
  return {
    project,
    total,
    prepared,
    documentsKnown,
    documentsComplete,
    readyForReview,
    canProceedToOperator,
    // Existing progress/status consumers retain strict document readiness.
    documents: documentsComplete,
    budgetRequired,
    budgetValid,
    budgetComplete,
    ready: readyForReview,
  };
}
