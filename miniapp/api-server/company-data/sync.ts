import { createReadStream, createWriteStream, promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { pipeline } from 'node:stream/promises';
import { Readable, Transform } from 'node:stream';
import yauzl from 'yauzl';
import iconv from 'iconv-lite';
import { config } from 'dotenv';
import { createFNSParser, fnsDate, type Dataset } from './fns-parser';
import { fnsDataDir, openIndex, type DatasetMetadata } from './fns-index';

export function officialFNSUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash ||
    !['nalog.gov.ru', 'nalog.ru'].some((h) => url.hostname === h || url.hostname.endsWith(`.${h}`)))
    throw new Error('ONLY_OFFICIAL_FNS_HTTPS_URL_ALLOWED');
  return url;
}
export async function downloadFNS(url: string, file: string, transport: typeof fetch = fetch) {
  let target = officialFNSUrl(url);
  for (let redirects = 0; redirects < 5; redirects++) {
    const response = await transport(target, { redirect: 'manual', signal: AbortSignal.timeout(300000) });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      target = officialFNSUrl(new URL(response.headers.get('location') || '', target).href); continue;
    }
    if (!response.ok || !response.body) throw new Error(`FNS_DOWNLOAD_HTTP_${response.status}`);
    let bytes = 0;
    await pipeline(Readable.fromWeb(response.body as never), new Transform({ transform(chunk, _encoding, next) {
      bytes += chunk.length; next(bytes > 2 * 1024 ** 3 ? new Error('DOWNLOAD_LIMIT_2GB_USE_LOCAL_FILE') : null, chunk);
    } }), createWriteStream(file, { flags: 'wx', mode: 0o600 }));
    return;
  }
  throw new Error('TOO_MANY_REDIRECTS');
}
async function consumeXML(stream: Readable, dataset: Dataset, updatedAt: string, emit: Parameters<typeof createFNSParser>[2], period?: number) {
  const parser = createFNSParser(dataset, updatedAt, emit, period);
  let decoder: ReturnType<typeof iconv.getDecoder> | undefined, prefix = Buffer.alloc(0), size = 0;
  for await (const chunk of stream) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > 4 * 1024 ** 3) throw new Error('XML_SIZE_LIMIT');
    if (!decoder) {
      prefix = Buffer.concat([prefix, bytes]);
      if (prefix.length < 256) continue;
      const encoding = /encoding=["']([^"']+)/i.exec(prefix.subarray(0, 256).toString('ascii'))?.[1] ?? 'utf-8';
      if (!['utf-8', 'UTF-8', 'windows-1251', 'WINDOWS-1251'].includes(encoding)) throw new Error('UNSUPPORTED_XML_ENCODING');
      decoder = iconv.getDecoder(encoding); parser.write(decoder.write(prefix)); prefix = Buffer.alloc(0);
    } else parser.write(decoder.write(bytes));
  }
  if (!decoder) { decoder = iconv.getDecoder(/windows-1251/i.test(prefix.toString('ascii')) ? 'windows-1251' : 'utf-8'); parser.write(decoder.write(prefix)); }
  parser.write(decoder.end() ?? '');
  return parser.close();
}
async function consumeZip(file: string, consume: (stream: Readable) => Promise<void>) {
  const zip = await new Promise<yauzl.ZipFile>((resolve, reject) => yauzl.open(file, { lazyEntries: true, autoClose: false }, (error, zip) => error ? reject(error) : resolve(zip!)));
  let expanded = 0, entries = 0;
  try {
    await new Promise<void>((resolve, reject) => {
      zip.on('error', reject); zip.on('end', resolve);
      zip.on('entry', (entry: yauzl.Entry) => {
        entries++; expanded += entry.uncompressedSize;
        if (entries > 10000 || expanded > 20 * 1024 ** 3 || entry.fileName.split(/[\\/]/).includes('..') || path.isAbsolute(entry.fileName) || entry.isEncrypted()) {
          reject(new Error('UNSAFE_OR_OVERSIZED_ARCHIVE')); return;
        }
        if (!/\.xml$/i.test(entry.fileName)) { zip.readEntry(); return; }
        zip.openReadStream(entry, (error, stream) => {
          if (error || !stream) { reject(error ?? new Error('INVALID_ZIP_ENTRY')); return; }
          consume(stream).then(() => zip.readEntry(), reject);
        });
      });
      zip.readEntry();
    });
  } finally { zip.close(); }
}
export type SyncOptions = { dataset: Dataset; file: string; sourceUrl: string; updatedAt: string; dir?: string; replace?: boolean; period?: number };
export async function importFNS(options: SyncOptions) {
  officialFNSUrl(options.sourceUrl);
  if (!fnsDate(options.updatedAt) || !['registry', 'sme', 'employees', 'financials'].includes(options.dataset)) throw new Error('INVALID_SYNC_OPTIONS');
  if (options.period !== undefined && (!Number.isInteger(options.period) || options.period < 2000 || options.period > new Date().getUTCFullYear())) throw new Error('INVALID_REPORTING_PERIOD');
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(options.file)) hash.update(chunk);
  const db = openIndex(options.dir ?? fnsDataDir(), true);
  let records = 0, skipped = 0;
  try {
    db.exec('BEGIN IMMEDIATE');
    if (options.replace) {
      if (options.dataset === 'registry') db.exec('DELETE FROM companies');
      else db.prepare('DELETE FROM supplements WHERE dataset = ?').run(options.dataset);
    }
    const upsert = options.dataset === 'registry'
      ? db.prepare('INSERT INTO companies VALUES (?, ?, ?) ON CONFLICT(inn) DO UPDATE SET updated_at=excluded.updated_at, data_json=excluded.data_json WHERE excluded.updated_at >= companies.updated_at')
      : db.prepare('INSERT INTO supplements VALUES (?, ?, ?, ?) ON CONFLICT(dataset,inn) DO UPDATE SET updated_at=excluded.updated_at, data_json=excluded.data_json WHERE excluded.updated_at >= supplements.updated_at');
    const consume = async (stream: Readable) => {
      const result = await consumeXML(stream, options.dataset, options.updatedAt, (row) => {
        const args = [row.inn, row.updatedAt, JSON.stringify(row)];
        if (options.dataset !== 'registry') args.unshift(options.dataset);
        upsert.run(...args);
      }, options.period);
      records += result.count; skipped += result.skipped;
    };
    const signature = Buffer.alloc(4); const handle = await fs.open(options.file, 'r');
    try { await handle.read(signature, 0, 4, 0); } finally { await handle.close(); }
    if (signature.subarray(0, 2).toString() === 'PK') await consumeZip(options.file, consume);
    else await consume(createReadStream(options.file));
    if (!records) throw new Error('NO_SUPPORTED_FNS_RECORDS');
    const metadata: DatasetMetadata = { dataset: options.dataset, sourceUrl: options.sourceUrl, updatedAt: options.updatedAt,
      importedAt: new Date().toISOString(), sha256: hash.digest('hex'), records, skipped, file: path.basename(options.file), period: options.period ?? null };
    db.prepare('INSERT INTO datasets VALUES (?, ?) ON CONFLICT(dataset) DO UPDATE SET metadata_json=excluded.metadata_json').run(options.dataset, JSON.stringify(metadata));
    db.exec('COMMIT');
    return metadata;
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  finally { db.close(); }
}
export async function runSync(args: string[]) {
  const flags = new Map<string, string>();
  for (let i = 0; i < args.length; i++) { if (args[i] === '--replace') flags.set('replace', 'yes'); else if (args[i].startsWith('--')) flags.set(args[i].slice(2), args[++i]); else throw new Error('INVALID_ARGUMENT'); }
  if (!flags.has('dataset') || !flags.has('source-url') || !flags.has('updated-at') || (!flags.has('file') && !flags.has('url')))
    throw new Error('Usage: sync:fns --dataset registry|sme|employees|financials --file /official/file.xml|zip (or --url https://file.nalog.ru/...) --source-url https://...nalog... --updated-at YYYY-MM-DD [--dir /data] [--replace]');
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'opora-fns-'));
  try {
    const file = flags.get('file') ?? path.join(temp, 'download');
    if (!flags.has('file')) await downloadFNS(flags.get('url')!, file);
    const result = await importFNS({ dataset: flags.get('dataset') as Dataset, sourceUrl: flags.get('source-url')!, updatedAt: flags.get('updated-at')!, file,
      period: flags.has('period') ? Number(flags.get('period')) : undefined, dir: flags.get('dir'), replace: flags.has('replace') });
    console.log(JSON.stringify(result, null, 2));
  } finally { await fs.rm(temp, { recursive: true, force: true }); }
}
if (require.main === module) {
  config({ path: path.resolve(__dirname, __dirname.includes(`${path.sep}dist${path.sep}`) ? '../../../../.env' : '../../../.env'), quiet: true });
  config({ quiet: true });
  runSync(process.argv.slice(2)).catch((error) => { console.error(error instanceof Error ? error.message.replace(/https?:\/\/\S+/g, '[URL]') : 'FNS_SYNC_FAILED'); process.exitCode = 1; });
}
