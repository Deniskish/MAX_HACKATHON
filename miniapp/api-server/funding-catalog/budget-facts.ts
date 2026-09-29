import { explicitEligibilityFacts } from './eligibility-facts';
import type { FundingKind, FundingOpportunity } from './types';

type KindEvidence = NonNullable<FundingOpportunity['imported']>['kindEvidence'];
/** Only explicit statements of the instrument in official details, never a title or operator. */
export function budgetKindEvidence(fields: Record<string, string>): KindEvidence {
  const found: NonNullable<KindEvidence>[] = [];
  const kinds: [FundingKind, RegExp][] = [
    ['grant', /^(?:грант(?:ы)?\s+(?:предоставля|выда)|предоставление\s+грант|вид поддержки\s*:\s*грант)/i],
    ['subsidy', /^(?:субсиди[яи]\s+предоставля|предоставление\s+субсиди|вид поддержки\s*:\s*субсиди)/i],
    ['preferential_loan', /^(?:льготны[йе]\s+кредит[ы]?\s+предоставля|вид поддержки\s*:\s*льготный кредит)/i],
    ['loan', /^(?:займ[ы]?\s+предоставля|за[её]м\s+предоставля|вид поддержки\s*:\s*за[её]м)/i],
    ['guarantee', /^(?:поручительств[оа]\s+предоставля|вид поддержки\s*:\s*поручительство)/i],
  ];
  for (const [field, text] of Object.entries(fields)) {
    for (const quote of text.split(/[.!?\n]+/).map(s => s.trim()).filter(Boolean)) {
      if (/не\s+(?:предоставля|выда|осуществля)/i.test(quote)) continue;
      for (const [kind, pattern] of kinds) if (pattern.test(quote)) {
        // "Grant in the form of a subsidy" requires explicit disambiguation.
        if (kind === 'subsidy' && /грант/i.test(quote)) continue;
        found.push({ kind, quote, field });
      }
    }
  }
  // Ambiguous descriptions require operator confirmation, not a guessed precedence.
  return new Set(found.map(item => item.kind)).size === 1 ? found[0] : undefined;
}

/** Migrate old server/browser caches as well as newly enriched records. */
export function withBudgetFacts(o: FundingOpportunity): FundingOpportunity {
  if (o.imported?.provider !== 'budget') return o;
  const detail = o.imported.detail;
  // A fresh detail without proof invalidates an older classification.
  const evidence = detail ? detail.kindEvidence : o.imported.kindEvidence;
  const geography = detail?.geography.map(s => s.trim()).filter(Boolean);
  const regions = geography
    ? geography.some(s => /^(?:Российская Федерация|вся Россия|все регионы России)$/i.test(s)) ? 'all' : geography
    : o.imported.factsVersion === 1 ? o.regions : [];
  const eligibility = detail?.eligibilityFacts ?? (detail ? explicitEligibilityFacts(detail.text) : undefined);
  return { ...o, kind: evidence?.kind ?? 'unknown', regions,
    status: o.status === 'active' && detail?.accepting === false ? 'unknown' : o.status,
    applicantTypes: eligibility?.applicantTypes.length ? eligibility.applicantTypes : o.applicantTypes,
    okvedPrefixes: eligibility?.okvedPrefixes ?? [],
    imported: { ...o.imported, factsVersion: 1, kindEvidence: evidence } };
}
