import { CompanyDataService } from './service';
import { datasetMetadata, fnsDataDir, lookupRow, openIndex } from './fns-index';
import type { Dataset } from './fns-parser';
import { ProviderNotConfiguredError, type CompanyData, type CompanyDataProvider, type CompanyDataResult, type CompanyField } from './types';

const names: Record<Dataset, string> = { registry: 'ФНС / ЕГРЮЛ и ЕГРИП', sme: 'ФНС / реестр МСП', employees: 'ФНС / среднесписочная численность', financials: 'ФНС / доходы и расходы' };
export class FNSRegistrySnapshotProvider implements CompanyDataProvider {
  readonly mode = 'official' as const;
  constructor(protected readonly dir = fnsDataDir()) {}
  async getCompanyByInn(inn: string): Promise<CompanyDataResult> {
    const db = openIndex(this.dir);
    try {
      const metadata = datasetMetadata(db, 'registry');
      if (!metadata) throw new ProviderNotConfiguredError();
      const row = lookupRow(db, 'registry', inn);
      if (!row) return null;
      const company: CompanyData = { inn, ogrn: null, name: null, companyType: null, region: null,
        registrationDate: null, ageMonths: null, okvedMain: null, okvedAdditional: null,
        employees: null, revenue: null, taxRegime: null, isSme: null, smeCategory: null,
        status: null, income: null, expenses: null, reportingPeriod: null, employeesPeriod: null, smeRegistryUpdatedAt: null,
        ...row.data, source: names.registry, sourceUrl: metadata.sourceUrl, updatedAt: row.updatedAt };
      const result: NonNullable<CompanyDataResult> = { company, sources: [], provenance: {} };
      for (const dataset of ['registry', 'sme', 'employees', 'financials'] as const) {
        const entry = lookupRow(db, dataset, inn), meta = datasetMetadata(db, dataset);
        if (!entry || !meta) continue;
        const source = { id: `fns-${dataset}`, name: names[dataset], url: meta.sourceUrl, updatedAt: entry.updatedAt, mode: 'official' as const };
        result.sources.push(source);
        for (const [key, value] of Object.entries(entry.data)) {
          if (value === null || value === undefined) continue;
          Object.assign(company, { [key]: value });
          result.provenance[key as CompanyField] = { sourceId: source.id, source: source.name, sourceUrl: source.url,
            updatedAt: source.updatedAt, mode: 'official', kind: 'source', ...(entry.period ? { period: entry.period } : {}) };
        }
      }
      return result;
    } finally { db.close(); }
  }
}
// These providers expose supplemental records; absence is unknown, never a negative SME assertion.
class FNSSupplementProvider {
  constructor(private dataset: Dataset, private dir = fnsDataDir()) {}
  async getByInn(inn: string) { const db = openIndex(this.dir); try { return lookupRow(db, this.dataset, inn); } finally { db.close(); } }
}
export class SMERegistrySnapshotProvider extends FNSSupplementProvider { constructor(dir?: string) { super('sme', dir); } }
export class FNSRevenueProvider extends FNSSupplementProvider { constructor(dir?: string) { super('financials', dir); } }
export class FNSEmployeesProvider extends FNSSupplementProvider { constructor(dir?: string) { super('employees', dir); } }
export class OfficialCompanyDataService extends CompanyDataService { constructor(dir?: string) { super(new FNSRegistrySnapshotProvider(dir)); } }
// Direct network integration requires official subscription/access attributes and a documented transport.
// No undocumented endpoint is called. Imported files use the same registry provider.
export class FNSIntegrationProvider implements CompanyDataProvider {
  readonly mode = 'official' as const;
  async getCompanyByInn(_inn: string): Promise<CompanyDataResult> { throw new ProviderNotConfiguredError(); }
}
export class FNSOpenDataProvider extends FNSRegistrySnapshotProvider {}
// Backwards-compatible name; SME alone cannot assert a complete registered-company profile.
export class SMERegistryProvider extends FNSIntegrationProvider {}
