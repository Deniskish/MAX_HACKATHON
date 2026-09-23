import type { CompanyData, CompanyDataProvider, CompanyDataResult, CompanyField, CompanySource } from '../../company-data/types';

const source: CompanySource = {
  id: 'opora-demo-v1',
  name: 'Учебный набор «Опора» — вымышленные данные, не ФНС',
  url: null,
  updatedAt: '2026-09-22T00:00:00Z',
  mode: 'demo',
};
const base = {
  ogrn: null, name: null, companyType: null, region: null,
  registrationDate: null, ageMonths: null, okvedMain: null, okvedAdditional: null,
  employees: null, revenue: null, taxRegime: null, isSme: null, smeCategory: null,
  source: source.name, sourceUrl: source.url, updatedAt: source.updatedAt,
};
// Синтетические ИНН с контрольными цифрами — ключи fixtures, не утверждение о регистрации.
// Эти данные никогда не извлекались из реестров, в том числе при совпадении ИНН.
const fixtures: CompanyData[] = [
  { ...base, inn: '9900000017', name: 'ООО «Учебная мастерская» · демо', companyType: 'ООО',
    region: 'Москва', registrationDate: '2021-03-15', okvedMain: '31.01',
    okvedAdditional: ['47.59'], employees: 18, revenue: 24000000, taxRegime: 'УСН',
    isSme: true, smeCategory: 'small' },
  { ...base, inn: '990000000041', name: 'ИП «Учебный предприниматель» · демо', companyType: 'ИП',
    region: 'Санкт-Петербург', okvedMain: '74.10', employees: 0 },
  { ...base, inn: '9900000024', name: 'КФХ «Учебное поле» · демо', companyType: 'КФХ',
    region: 'Республика Татарстан', registrationDate: '2020-05-20', okvedMain: '01.11',
    okvedAdditional: ['01.13'], employees: 8, taxRegime: 'ЕСХН', isSme: true,
    smeCategory: 'micro' },
  { ...base, inn: '9900000031', name: 'ООО «Учебная технология» · демо', companyType: 'ООО',
    region: 'Москва', registrationDate: '2024-07-22', okvedMain: '62.01',
    okvedAdditional: ['72.19'], employees: 12, revenue: 18000000, taxRegime: 'УСН',
    isSme: true, smeCategory: 'micro' },
];

export class DemoCompanyDataProvider implements CompanyDataProvider {
  readonly mode = 'demo' as const;
  async getCompanyByInn(inn: string): Promise<CompanyDataResult> {
    const fixture = fixtures.find((item) => item.inn === inn);
    if (!fixture) return null;
    const company = structuredClone(fixture);
    const provenance = Object.fromEntries(
      (Object.keys(company) as (keyof CompanyData)[])
        .filter((field): field is CompanyField =>
          !['source', 'sourceUrl', 'updatedAt'].includes(field) && company[field] !== null)
        .map((field) => [field, {
          sourceId: source.id, source: source.name, sourceUrl: source.url,
          updatedAt: source.updatedAt, mode: source.mode, kind: 'source' as const,
        }]),
    );
    return { company, sources: [{ ...source }], provenance };
  }
}
