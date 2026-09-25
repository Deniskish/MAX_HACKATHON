import { innEntityType } from './inn';
import type { CompanyData, CompanyDataProvider, CompanyDataResult, CompanyField, CompanyRecord } from './types';

const endpoint = 'https://suggestions.dadata.ru/suggestions/api/4_1/rs/findById/party';
const sourceUrl = 'https://dadata.ru/api/find-party/';
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : null;
const amount = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
function date(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const result = new Date(value);
  return Number.isFinite(result.getTime()) ? result.toISOString().slice(0, 10) : null;
}
export class CompanyProviderError extends Error {
  constructor(readonly code: 'COMPANY_ACCESS_DENIED' | 'COMPANY_QUOTA_EXCEEDED' | 'COMPANY_RATE_LIMITED') { super(code); }
}

export function mapDaDataCompany(raw: unknown, inn: string, now = new Date()): CompanyRecord {
  const data = object(raw), name = object(data.name), state = object(data.state), finance = object(data.finance);
  const address = object(object(data.address).data), smb = object(object(data.documents).smb), opf = object(data.opf);
  if (data.inn !== inn || !['LEGAL', 'INDIVIDUAL'].includes(String(data.type)) ||
      (inn.length === 10) !== (data.type === 'LEGAL')) throw new Error('INVALID_COMPANY_PROVIDER_RESULT');
  const category = { MICRO: 'micro', SMALL: 'small', MEDIUM: 'medium' }[String(smb.category)] as CompanyData['smeCategory'] | undefined;
  const companyType: CompanyData['companyType'] = data.type === 'INDIVIDUAL' ? 'ИП'
    : opf.code === '12300' || opf.short === 'ООО' ? 'ООО'
    : ['12247', '12267'].includes(String(opf.code)) || ['АО', 'ПАО', 'НАО', 'ОАО', 'ЗАО'].includes(String(opf.short)) ? 'АО'
    : opf.code === '15300' || opf.short === 'КФХ' ? 'КФХ' : text(opf.short) ? 'другое' : null;
  const year = amount(finance.year);
  const reportingPeriod = year !== null && year >= 2000 && year <= now.getUTCFullYear() ? year : null;
  const source = { id: 'dadata-company', name: 'DaData · сведения о компании', url: sourceUrl,
    updatedAt: date(state.actuality_date) ?? now.toISOString().slice(0, 10), mode: 'aggregator' as const };
  const company: CompanyData = {
    inn, ogrn: text(data.ogrn), name: text(name.short_with_opf) ?? text(name.full_with_opf), companyType,
    region: address.region_type === 'г' ? text(address.region) : text(address.region_with_type) ?? text(address.region),
    registrationDate: date(state.registration_date), ageMonths: null, okvedMain: text(data.okved),
    okvedAdditional: Array.isArray(data.okveds) ? data.okveds.filter((v) => object(v).main === false && object(v).type === '2014').map((v) => text(object(v).code)).filter((v): v is string => !!v) : null,
    employees: amount(data.employee_count), employeesPeriod: null,
    revenue: amount(finance.revenue), income: amount(finance.income), expenses: amount(finance.expense), reportingPeriod,
    taxRegime: ({ AUSN: 'АУСН', ESHN: 'ЕСХН', SRP: 'СРП', USN: 'УСН' } as Record<string, string>)[String(finance.tax_system)] ?? null,
    isSme: category ? true : null, smeCategory: category ?? null, smeRegistryUpdatedAt: null,
    status: ({ ACTIVE: 'active', LIQUIDATING: 'liquidating', LIQUIDATED: 'liquidated', BANKRUPT: 'bankrupt', REORGANIZING: 'reorganizing' } as Record<string, string>)[String(state.status)] ?? null,
    source: source.name, sourceUrl, updatedAt: source.updatedAt,
  };
  if (!company.name || !company.ogrn) throw new Error('INVALID_COMPANY_PROVIDER_RESULT');
  const result: CompanyRecord = { company, sources: [source], provenance: {} };
  for (const [key, value] of Object.entries(company)) {
    if (value === null || ['source', 'sourceUrl', 'updatedAt'].includes(key)) continue;
    result.provenance[key as CompanyField] = { sourceId: source.id, source: source.name, sourceUrl,
      updatedAt: source.updatedAt, mode: 'aggregator', kind: 'source',
      ...(['revenue', 'income', 'expenses'].includes(key) && reportingPeriod ? { period: reportingPeriod } : {}) };
  }
  return result;
}

export class DaDataCompanyProvider implements CompanyDataProvider {
  readonly mode = 'aggregator' as const;
  private cache = new Map<string, { expires: number; value: CompanyDataResult }>();
  private pending = new Map<string, Promise<CompanyDataResult>>();
  private health: { state: string; lastSuccess: string | null } = { state: 'not_checked', lastSuccess: null };
  constructor(private readonly key: string, private readonly transport: typeof fetch = fetch) {}
  status() { return { configured: Boolean(this.key), ...this.health }; }
  async getCompanyByInn(inn: string): Promise<CompanyDataResult> {
    innEntityType(inn);
    const cached = this.cache.get(inn);
    if (cached && cached.expires > Date.now()) return structuredClone(cached.value);
    let promise = this.pending.get(inn);
    if (!promise) {
      promise = this.lookup(inn).finally(() => this.pending.delete(inn));
      this.pending.set(inn, promise);
    }
    return structuredClone(await promise);
  }
  private async lookup(inn: string): Promise<CompanyDataResult> {
    try {
      const response = await this.transport(endpoint, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
        headers: { Authorization: `Token ${this.key}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ query: inn, branch_type: 'MAIN', count: 1 }) });
      if ([401, 403].includes(response.status)) throw new CompanyProviderError('COMPANY_ACCESS_DENIED');
      if (response.status === 402) throw new CompanyProviderError('COMPANY_QUOTA_EXCEEDED');
      if (response.status === 429) throw new CompanyProviderError('COMPANY_RATE_LIMITED');
      if (!response.ok) throw new Error('COMPANY_PROVIDER_UNAVAILABLE');
      const body = object(await response.json());
      if (!Array.isArray(body.suggestions)) throw new Error('INVALID_COMPANY_PROVIDER_RESULT');
      const value = body.suggestions.length ? mapDaDataCompany(object(body.suggestions[0]).data, inn) : null;
      this.health = { state: 'ready', lastSuccess: new Date().toISOString() };
      if (this.cache.size >= 1000) this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(inn, { value, expires: Date.now() + (value ? 15 * 60000 : 60000) });
      return value;
    } catch (error) {
      this.health.state = error instanceof CompanyProviderError ? error.code : 'unavailable';
      throw error;
    }
  }
}
