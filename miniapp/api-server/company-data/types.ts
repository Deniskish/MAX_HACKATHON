import type { Profile } from '../support-model';

export type CompanyDataMode = 'demo' | 'official' | 'aggregator';
export type CompanySource = {
  id: string;
  name: string;
  url: string | null;
  updatedAt: string;
  mode: CompanyDataMode;
};
export type FieldProvenance = {
  sourceId: string;
  source: string;
  sourceUrl: string | null;
  updatedAt: string;
  mode: CompanyDataMode | 'manual';
  kind: 'source' | 'derived' | 'manual';
  derivedFrom?: string[];
  computedAt?: string;
  period?: number;
};
export type CompanyData = {
  inn: string;
  ogrn: string | null;
  name: string | null;
  companyType: 'ООО' | 'АО' | 'ИП' | 'КФХ' | 'другое' | null;
  region: string | null;
  registrationDate: string | null;
  ageMonths: number | null;
  okvedMain: string | null;
  // null — неизвестно; [] — источник явно сообщил об отсутствии дополнительных кодов.
  okvedAdditional: string[] | null;
  employees: number | null;
  revenue: number | null;
  taxRegime: string | null;
  status?: string | null;
  income?: number | null;
  expenses?: number | null;
  employeesPeriod?: number | null;
  reportingPeriod?: number | null;
  smeRegistryUpdatedAt?: string | null;
  isSme: boolean | null;
  smeCategory: 'micro' | 'small' | 'medium' | null;
  source: string;
  sourceUrl: string | null;
  updatedAt: string;
};
export type CompanyField = Exclude<keyof CompanyData, 'source' | 'sourceUrl' | 'updatedAt'>;
export type CompanyRecord = {
  company: CompanyData;
  sources: CompanySource[];
  provenance: Partial<Record<CompanyField, FieldProvenance>>;
};
// null означает отсутствие записи, а не ошибку или недоступность источника.
export type CompanyDataResult = CompanyRecord | null;
export interface CompanyDataProvider {
  readonly mode: CompanyDataMode;
  getCompanyByInn(inn: string): Promise<CompanyDataResult>;
}
export type CompanyResponse = CompanyRecord & {
  mode: CompanyDataMode;
  entityType: 'ЮЛ' | 'ИП';
  profile: Profile;
};

export class ProviderNotConfiguredError extends Error {
  constructor() { super('COMPANY_PROVIDER_NOT_CONFIGURED'); }
}
