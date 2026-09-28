import { fundingFields, type FundingNeed, type FundingProfile } from './types';

import { normalizeFundingPurpose } from './purposes';

export class FundingInputError extends Error {
  constructor(message = 'Проверьте профиль и потребность в финансировании.') { super(message); }
}
export const fundingRecord = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new FundingInputError();
  return value as Record<string, unknown>;
};
function optionalNumber(value: unknown, min: number, max: number): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max)
    throw new FundingInputError(`Числовые значения должны быть целыми числами от ${min} до ${max}.`);
  return value;
}
export function parseFundingNeed(input: unknown): FundingNeed {
  const value = fundingRecord(input);
  const purpose = typeof value.purpose === 'string' ? normalizeFundingPurpose(value.purpose) : undefined;
  if (!purpose) throw new FundingInputError('Выберите цель финансирования или «Все цели». Остальные поля необязательны.');
  if (value.needsCollateralSupport !== undefined && value.needsCollateralSupport !== null
    && typeof value.needsCollateralSupport !== 'boolean') throw new FundingInputError();
  return {
    purpose, amount: optionalNumber(value.amount, 1, 1e15),
    ownFunds: optionalNumber(value.ownFunds, 0, 1e15),
    preferredTermMonths: optionalNumber(value.preferredTermMonths, 1, 600),
    needsCollateralSupport: value.needsCollateralSupport as boolean | null | undefined ?? null,
  };
}
// Явный allowlist исключает реквизиты и любое присланное клиентом решение о пригодности.
export function toFundingProfile(input: FundingProfile): FundingProfile {
  return { ...Object.fromEntries(fundingFields.map((field) => [field, input[field]])), applicantType: input.applicantType, companyStatus: input.companyStatus, industry: input.industry, stage: input.stage };
}
export function parseFundingProfile(input: unknown): FundingProfile {
  const value = fundingRecord(input);
  const profile: FundingProfile = {};
  for (const field of fundingFields) {
    const item = value[field];
    if (item === undefined || item === null) continue;
    if (field === 'ageMonths' || field === 'employees' || field === 'revenue') {
      profile[field] = optionalNumber(item, 0, field === 'revenue' ? 1e15 : field === 'employees' ? 1e7 : 3000);
    } else if (field === 'goals') {
      if (!Array.isArray(item) || item.length > 20 || item.some((s) => typeof s !== 'string' || s.length > 120))
        throw new FundingInputError();
      profile.goals = item;
    } else {
      if (typeof item !== 'string' || item.length > 120) throw new FundingInputError();
      if (field === 'isSme') {
        if (!['yes', 'no', 'unknown'].includes(item)) throw new FundingInputError();
        profile.isSme = item as FundingProfile['isSme'];
      } else if (field === 'companyType') {
        if (!['', 'ООО', 'АО', 'ИП', 'КФХ', 'другое'].includes(item)) throw new FundingInputError();
        profile.companyType = item as FundingProfile['companyType'];
      } else {
        if (field === 'okved' && item !== '' && !/^\d{2}(\.\d{1,2}){0,2}$/.test(item)) throw new FundingInputError();
        profile[field] = item.trim();
      }
    }
  }
  if (value.applicantType !== undefined) {
    if (!['legal_entity', 'individual_entrepreneur', 'individual', 'team', 'project'].includes(String(value.applicantType))) throw new FundingInputError();
    profile.applicantType = value.applicantType as FundingProfile['applicantType'];
  }
  for (const field of ['companyStatus', 'industry', 'stage'] as const) {
    if (value[field] !== undefined && value[field] !== null) {
      if (typeof value[field] !== 'string' || value[field].length > 120) throw new FundingInputError();
      profile[field] = value[field];
    }
  }
  return profile;
}
