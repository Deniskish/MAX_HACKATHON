import type { Profile } from '../business-model';

export type FundingKind = 'grant' | 'subsidy' | 'preferential_loan' | 'commercial_loan' | 'loan'
  | 'guarantee' | 'lease' | 'tax' | 'property' | 'service' | 'investment' | 'unknown';
export const fundingFields = ['region', 'okved', 'ageMonths', 'employees', 'revenue',
  'isSme', 'companyType', 'tax', 'goals'] as const;
export type FundingField = typeof fundingFields[number] | 'applicantType' | 'companyStatus' | 'industry' | 'stage';
// ИНН, название и персональные данные не нужны для расчёта.
// TODO: ProjectProfileProvider для будущего сценария без зарегистрированной компании.
export type FundingProfile = Partial<Pick<Profile, typeof fundingFields[number]>> & { applicantType?: ApplicantType; companyStatus?: string | null; industry?: string; stage?: string };
export type ApplicantType = 'legal_entity' | 'individual_entrepreneur' | 'individual' | 'team' | 'project';
export type ProjectProfile = { name: string; region: string; industry: string; stage: 'idea' | 'prototype' | 'mvp' | 'revenue'; teamSize: number | null; fundingNeed: number | null; fundingPurpose: string; hasLegalEntity: false };
export type OpportunityState = 'active' | 'closed' | 'upcoming' | 'unknown';
export type FundingRequirement = {
  field: FundingField;
  operator: 'eq' | 'neq' | 'gte' | 'lte' | 'prefix' | 'includes';
  value: string | number | boolean | string[];
  required: boolean;
  label: string;
};
export type FundingOpportunity = {
  id: string;
  title: string;
  kind: FundingKind;
  providerName: string;
  providerType: 'government' | 'development_institution' | 'bank' | 'fund' | 'regional' | 'private';
  description: string;
  amountMin: number | null;
  amountMax: number | null;
  rateMin: number | null;
  rateMax: number | null;
  termMonthsMin: number | null;
  termMonthsMax: number | null;
  regions: string[] | 'all';
  purposes: string[];
  sectors: string[];
  okvedPrefixes: string[];
  companyTypes: string[];
  applicantTypes?: ApplicantType[];
  status?: OpportunityState;
  manualConditions?: string[];
  /** Subset of manualConditions that prevents personal selection until verified. */
  manualEligibilityConditions?: string[];
  projectBudgetMin?: number | null;
  cofinancingPercent?: number | null;
  requirements: FundingRequirement[];
  requiredDocuments: string[];
  deadline: string | null;
  difficulty: 'low' | 'medium' | 'high';
  preparationDays: number | null;
  source: { name: string; url: string | null; type: 'demo' | 'official'; updatedAt: string; verifiedAt?: string };
  version: string;
  imported?: { provider: string; startsAt: string; endsAt: string; firstSeenAt?: string;
    checkedAt?: string; factsVersion?: 1; kindEvidence?: { kind: FundingKind; quote: string; field: string }; ongoing?: boolean; verification?: 'verified' | 'pending'; evidence?: Record<string, string>;
    detail?: { text: string; complete: boolean; version: string; checkedAt: string; startsAt: string; endsAt: string; accepting: boolean; geography: string[]; kindEvidence?: { kind: FundingKind; quote: string; field: string } } };
};
export const fundingPurposes = ['покупка оборудования', 'оборотные средства', 'разработка продукта',
  'найм сотрудников', 'экспорт', 'аренда / недвижимость', 'сельхозтехника',
  'запуск производства', 'масштабирование'] as const;
export type FundingNeed = {
  purpose: string;
  amount: number | null;
  ownFunds: number | null;
  preferredTermMonths: number | null;
  needsCollateralSupport: boolean | null;
};
export const emptyFundingNeed: FundingNeed = {
  purpose: '', amount: null, ownFunds: null, preferredTermMonths: null, needsCollateralSupport: null,
};
export type RequirementCheck = FundingRequirement & { status: 'fulfilled' | 'missing' | 'unknown' };
export type FundingStatus = 'eligible' | 'almost_eligible' | 'need_more_data' | 'not_eligible' | 'expired' | 'upcoming';
export type FundingMatch = {
  opportunity: FundingOpportunity;
  status: FundingStatus;
  /** Core eligibility is separate from missing secondary preparation data. */
  personalEligibility?: { confirmed: boolean; reasons: string[] };
  score: number;
  // Приоритет отдельно от score: обеспечение не улучшает соответствие требованиям.
  relevance: number;
  fulfilledRequirements: RequirementCheck[];
  missingRequirements: RequirementCheck[];
  unknownRequirements: RequirementCheck[];
  missingDocuments: string[];
  purposeFit: boolean;
  amountFit: 'full' | 'partial' | 'unknown' | 'no';
  termFit: 'yes' | 'partial' | 'unknown' | 'no';
  explanation: string;
  nextActions: string[];
};
export type FundingStrategy = {
  summary: string;
  options: { opportunityId: string; role: 'financing' | 'support'; text: string }[];
  notices: string[];
  nextActions: string[];
};
export type FundingResponse = {
  mode: 'demo' | 'official';
  need: FundingNeed;
  matches: FundingMatch[];
  strategy: FundingStrategy;
};
