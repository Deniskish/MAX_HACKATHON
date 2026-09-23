import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Dataset, FNSRow } from './fns-parser';
import { ProviderNotConfiguredError } from './types';
export const fnsDataDir = () => path.resolve(process.env.FNS_DATA_DIR || path.join(__dirname, __dirname.includes(`${path.sep}dist${path.sep}`) ? '../../../../fns-data' : '../../../fns-data'));
export const indexPath = (dir = fnsDataDir()) => path.join(dir, 'fns.sqlite');
export type DatasetMetadata = { dataset: Dataset; sourceUrl: string; updatedAt: string; importedAt: string; sha256: string; records: number; skipped: number; file: string; period: number | null };
export function openIndex(dir: string, writable = false) {
  if (!writable && !existsSync(indexPath(dir))) throw new ProviderNotConfiguredError();
  if (writable) mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(indexPath(dir), { readOnly: !writable });
  db.exec('PRAGMA busy_timeout=5000');
  // Rollback journal keeps the committed index self-contained for a read-only Docker mount.
  // BEGIN IMMEDIATE in the importer still publishes each dataset atomically.
  if (writable) db.exec(`PRAGMA journal_mode=DELETE;
    CREATE TABLE IF NOT EXISTS companies (inn TEXT PRIMARY KEY, updated_at TEXT NOT NULL, data_json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS supplements (dataset TEXT NOT NULL, inn TEXT NOT NULL, updated_at TEXT NOT NULL, data_json TEXT NOT NULL, PRIMARY KEY(dataset,inn));
    CREATE TABLE IF NOT EXISTS datasets (dataset TEXT PRIMARY KEY, metadata_json TEXT NOT NULL);`);
  return db;
}
export function lookupRow(db: DatabaseSync, dataset: Dataset, inn: string): FNSRow | null {
  const row = (dataset === 'registry' ? db.prepare('SELECT data_json FROM companies WHERE inn = ?').get(inn)
    : db.prepare('SELECT data_json FROM supplements WHERE dataset = ? AND inn = ?').get(dataset, inn)) as { data_json: string } | undefined;
  return row ? JSON.parse(row.data_json) : null;
}
export function datasetMetadata(db: DatabaseSync, dataset: Dataset): DatasetMetadata | null {
  const row = db.prepare('SELECT metadata_json FROM datasets WHERE dataset = ?').get(dataset) as { metadata_json: string } | undefined;
  return row ? JSON.parse(row.metadata_json) : null;
}
export function providerStatus(dir = fnsDataDir()) {
  const result = { fnsRegistry: 'missing', smeRegistry: 'missing', employees: 'missing', financials: 'missing', lastSync: null as string | null,
    datasets: [] as DatasetMetadata[] };
  if (!existsSync(indexPath(dir))) return result;
  let db: DatabaseSync | undefined;
  try {
    db = openIndex(dir);
    for (const [dataset, key] of [['registry', 'fnsRegistry'], ['sme', 'smeRegistry'], ['employees', 'employees'], ['financials', 'financials']] as const) {
      const metadata = datasetMetadata(db, dataset);
      if (metadata) { result[key] = 'ready'; result.datasets.push(metadata); }
    }
    result.lastSync = result.datasets.map((d) => d.importedAt).sort().at(-1) ?? null;
  } catch { result.fnsRegistry = result.smeRegistry = result.employees = result.financials = 'error'; }
  finally { db?.close(); }
  return result;
}
