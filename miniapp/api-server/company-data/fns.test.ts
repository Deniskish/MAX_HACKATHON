import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, chmod, readdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createFNSParser, type FNSRow, type Dataset } from './fns-parser';
import { importFNS, officialFNSUrl, downloadFNS } from './sync';
import { OfficialCompanyDataService } from './official-providers';
import { providerStatus } from './fns-index';
import { registryXML, ipXML, smeXML, employeesXML, financialsXML, registryZipBase64 } from '../tests/fixtures/fns';
const sourceUrl = 'https://www.nalog.gov.ru/rn77/service/egrip2/';
function parse(dataset: Dataset, xml: string, period?: number) {
  const rows: FNSRow[] = []; const parser = createFNSParser(dataset, '2026-09-01', (row) => rows.push(row), period);
  for (let i = 0; i < xml.length; i += 31) parser.write(xml.slice(i, i + 31));
  parser.close(); return rows;
}
test('FNS registry selects actual registration data and reported OKVED, discards founder/address PII', () => {
  const [row] = parse('registry', registryXML);
  assert.equal(row.data.name, 'Synthetic company'); assert.equal(row.data.companyType, 'ООО');
  assert.equal(row.data.okvedMain, '62.02'); assert.equal(row.data.region, 'Москва');
  assert.equal(row.data.registrationDate, '2024-07-22'); assert.doesNotMatch(JSON.stringify(row), /PRIVATE/);
  const [ip] = parse('registry', ipXML); assert.equal(ip.data.companyType, 'ИП'); assert.equal(ip.data.name, null); assert.equal(ip.inn.length, 12);
});
test('SME categories, employees and financial income are parsed without inventing revenue/period', () => {
  assert.deepEqual(parse('sme', smeXML).map((r) => r.data.smeCategory), ['micro', 'small']);
  assert.equal(parse('employees', employeesXML, 2025)[0].data.employees, 12);
  assert.equal(parse('employees', employeesXML)[0].data.employeesPeriod, null);
  const financial = parse('financials', financialsXML, 2025)[0];
  assert.equal(financial.data.income, 18000000); assert.equal(financial.data.expenses, 12000000);
  assert.equal(financial.data.revenue, undefined); assert.equal(financial.period, 2025);
});
test('XML rejects DTD/entities, malformed XML and invalid INNs', () => {
  assert.throws(() => parse('registry', '<!DOCTYPE EGRUL [<!ENTITY x SYSTEM "file:///etc/passwd">]><EGRUL/>'), /DOCTYPE/);
  assert.throws(() => parse('registry', '<EGRUL>'));
  assert.equal(parse('registry', registryXML.replace('9900000031', '9900000032')).length, 0);
});
test('atomic SQLite lookup composes provenance, missing record is 404 result and incomplete SME never means false', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'opora-index-'));
  try {
    const service = new OfficialCompanyDataService(dir);
    await assert.rejects(service.getCompanyByInn('9900000031'), /NOT_CONFIGURED/);
    assert.equal(providerStatus(dir).fnsRegistry, 'missing');
    for (const [dataset, xml] of [['registry', registryXML], ['sme', smeXML], ['employees', employeesXML], ['financials', financialsXML]] as [Dataset, string][]) {
      const file = path.join(dir, `${dataset}.xml`); await writeFile(file, xml);
      await importFNS({ dataset, file, dir, sourceUrl, updatedAt: '2026-09-01', period: 2025 });
      if (dataset === 'registry') assert.equal((await service.getCompanyByInn('9900000031'))?.profile.isSme, 'unknown');
    }
    const company = await service.getCompanyByInn('9900000031'); assert.ok(company);
    assert.equal(company.mode, 'official'); assert.equal(company.profile.employees, 12); assert.equal(company.profile.revenue, null);
    assert.equal(company.profile.provenance?.employees?.period, 2025); assert.equal(company.company.income, 18000000);
    assert.equal(await service.getCompanyByInn('7707083893'), null);
    const bad = path.join(dir, 'bad.xml'); await writeFile(bad, registryXML + '<broken>');
    await assert.rejects(importFNS({ dataset: 'registry', file: bad, dir, sourceUrl, updatedAt: '2026-09-02', replace: true }));
    assert.ok(await service.getCompanyByInn('9900000031')); assert.equal(providerStatus(dir).datasets.length, 4);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('FNS downloader rejects unofficial origins and redirected origins, checks HTTP status', async () => {
  for (const url of ['https://nalog.ru.attacker.test/data', 'http://nalog.ru/data', 'https://user:password@nalog.ru/data']) assert.throws(() => officialFNSUrl(url));
  await assert.rejects(downloadFNS('https://file.nalog.ru/data', '/unused', (async () => new Response('', { status: 302, headers: { Location: 'https://attacker.test/data' } })) as typeof fetch), /OFFICIAL/);
  await assert.rejects(downloadFNS('https://file.nalog.ru/data', '/unused', (async () => new Response('', { status: 503 })) as typeof fetch), /503/);
});
test('ZIP importer decodes Windows-1251 and produces a self-contained read-only SQLite index', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'opora-zip-'));
  try {
    const file = path.join(dir, 'registry.zip'); await writeFile(file, Buffer.from(registryZipBase64, 'base64'));
    const metadata = await importFNS({ dataset: 'registry', file, dir, sourceUrl, updatedAt: '2026-09-01' });
    assert.equal(metadata.records, 1); assert.match(metadata.sha256, /^[a-f0-9]{64}$/);
    assert.ok(!(await readdir(dir)).some((name) => /-wal$|-shm$/.test(name)));
    await chmod(path.join(dir, 'fns.sqlite'), 0o444); await chmod(dir, 0o555);
    const result = await new OfficialCompanyDataService(dir).getCompanyByInn('9900000031');
    assert.equal(result?.company.name, 'Синтетическая компания');
    assert.equal(result?.profile.applicantType, 'legal_entity');
  } finally { await chmod(dir, 0o755); await rm(dir, { recursive: true, force: true }); }
});
