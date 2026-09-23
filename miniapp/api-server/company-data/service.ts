import { emptyProfile, type Profile, type ProfileValues } from '../support-model';
import { innEntityType } from './inn';
import type { CompanyDataProvider, CompanyRecord, CompanyResponse, CompanyField } from './types';

// Полные календарные месяцы; некорректную или будущую дату не превращаем в возраст 0.
export function ageInMonths(date: string, now: Date): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const registered = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(registered.getTime()) || registered.toISOString().slice(0, 10) !== date || registered > now)
    return null;
  return (now.getUTCFullYear() - registered.getUTCFullYear()) * 12
    + now.getUTCMonth() - registered.getUTCMonth()
    - (now.getUTCDate() < registered.getUTCDate() ? 1 : 0);
}

export function companyDataToProfile({ company, provenance }: CompanyRecord): Profile {
  const profile: Profile = {
    ...emptyProfile,
    goals: [],
    inn: company.inn,
    name: company.name ?? '',
    companyType: company.companyType ?? '',
    region: company.region ?? '',
    okved: company.okvedMain ?? '',
    ageMonths: company.ageMonths,
    employees: company.employees,
    revenue: company.revenue,
    tax: company.taxRegime ?? '',
    isSme: company.isSme === null ? 'unknown' : company.isSme ? 'yes' : 'no',
    provenance: {},
    companyStatus: company.status ?? null,
    applicantType: innEntityType(company.inn) === 'ИП' ? 'individual_entrepreneur' : 'legal_entity',
  };
  const fields: Partial<Record<keyof ProfileValues | 'companyStatus', CompanyField>> = {
    inn: 'inn', name: 'name', companyType: 'companyType', region: 'region',
    okved: 'okvedMain', ageMonths: 'ageMonths', employees: 'employees',
    revenue: 'revenue', tax: 'taxRegime', isSme: 'isSme', companyStatus: 'status',
  };
  for (const [target, field] of Object.entries(fields)) {
    if (company[field] !== null && provenance[field])
      profile.provenance![target as keyof ProfileValues] = { ...provenance[field]!, derivedFrom: provenance[field]!.derivedFrom ?? [field] };
  }
  if (provenance.inn) profile.provenance!.applicantType = { ...provenance.inn, kind: 'derived', derivedFrom: ['inn'] };
  return profile;
}

export class CompanyDataService {
  constructor(private readonly provider: CompanyDataProvider, private readonly now = () => new Date()) {}

  async getCompanyByInn(inn: string): Promise<CompanyResponse | null> {
    const entityType = innEntityType(inn);
    const result = await this.provider.getCompanyByInn(inn);
    if (!result) return null;
    // Не допускаем случайной выдачи профиля другой компании или demo под видом official.
    if (result.company.inn !== inn || !result.sources.length ||
        result.sources.some((source) => source.mode !== this.provider.mode))
      throw new Error('INVALID_COMPANY_PROVIDER_RESULT');
    const record = structuredClone(result);
    for (const [field, value] of Object.entries(record.company)) {
      if (value === null || ['source', 'sourceUrl', 'updatedAt'].includes(field)) continue;
      const origin = record.provenance[field as CompanyField];
      if (!origin || origin.mode !== this.provider.mode ||
          !record.sources.some((source) => source.id === origin.sourceId))
        throw new Error('MISSING_COMPANY_PROVENANCE');
    }
    const now = this.now();
    if (record.company.ageMonths === null && record.company.registrationDate) {
      record.company.ageMonths = ageInMonths(record.company.registrationDate, now);
      if (record.company.ageMonths !== null)
        record.provenance.ageMonths = {
          ...record.provenance.registrationDate!, kind: 'derived',
          derivedFrom: ['registrationDate'], computedAt: now.toISOString(),
        };
    }
    return { ...record, mode: this.provider.mode, entityType, profile: companyDataToProfile(record) };
  }
}
