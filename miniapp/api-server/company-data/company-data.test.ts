import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { validInn, innEntityType } from './inn';
import { DemoCompanyDataProvider } from './demo-provider';
import { CompanyDataService, ageInMonths, companyDataToProfile } from './service';
import { companyDataRouter } from './router';
import { FNSOpenDataProvider, SMERegistryProvider } from './official-providers';
import type { CompanyDataProvider, CompanyResponse } from './types';
import { privateCompletion } from '../privacy';

const now = () => new Date('2026-09-22T12:00:00Z');
const provider = new DemoCompanyDataProvider();
const service = new CompanyDataService(provider, now);

test('valid 10/12 digit INNs have legal-entity/individual lookup types', () => {
  for (const inn of ['7707083893', '9900000017', '9900000024', '9900000031']) {
    assert.equal(validInn(inn), true);
    assert.equal(innEntityType(inn), 'ЮЛ');
  }
  for (const inn of ['500100732259', '990000000041']) {
    assert.equal(validInn(inn), true);
    assert.equal(innEntityType(inn), 'ИП');
  }
});
test('bad INNs are rejected before calling the provider', async () => {
  let calls = 0;
  const s = new CompanyDataService({ mode: 'demo', async getCompanyByInn() { calls++; return null; } });
  for (const inn of ['', '0000000000', '000000000000', '9900000018', '990000000042',
    '990000000031', '123', '12345678901', 'abcdefghij', ' 9900000017', '９９００００００１７']) {
    assert.equal(validInn(inn), false, inn);
    await assert.rejects(s.getCompanyByInn(inn), /INVALID_INN/);
  }
  assert.equal(calls, 0);
});
test('four educational profiles have field provenance and no FNS source attribution', async () => {
  for (const [inn, type] of [['9900000017', 'ООО'], ['990000000041', 'ИП'], ['9900000024', 'КФХ'], ['9900000031', 'ООО']]) {
    const result = await service.getCompanyByInn(inn);
    assert.ok(result);
    assert.equal(result.mode, 'demo');
    assert.equal(result.profile.companyType, type);
    assert.match(result.company.name!, /демо/);
    assert.match(result.company.source, /вымышленные данные, не ФНС/);
    assert.equal(result.company.sourceUrl, null);
    for (const [key, value] of Object.entries(result.profile)) {
      if (['provenance', 'goals'].includes(key) || value === '' || value === null || value === 'unknown') continue;
      assert.equal(result.profile.provenance![key as keyof typeof result.profile.provenance]?.mode, 'demo', key);
    }
  }
});
test('absent record returns null, not a substituted demo company', async () => {
  assert.equal(await service.getCompanyByInn('7707083893'), null);
  assert.equal(await service.getCompanyByInn('500100732259'), null);
});
test('missing fields stay unknown, while explicit zero and false survive mapping', async () => {
  const result = await service.getCompanyByInn('990000000041');
  assert.ok(result);
  for (const field of ['ogrn', 'registrationDate', 'ageMonths', 'revenue', 'taxRegime', 'isSme', 'smeCategory', 'okvedAdditional'] as const)
    assert.equal(result.company[field], null, field);
  assert.equal(result.profile.revenue, null);
  assert.equal(result.profile.ageMonths, null);
  assert.equal(result.profile.tax, '');
  assert.equal(result.profile.isSme, 'unknown');
  assert.equal(result.profile.employees, 0);
  assert.deepEqual(result.profile.goals, []);
  assert.equal(result.profile.provenance?.revenue, undefined);
  const emptyType = companyDataToProfile({ ...result,
    company: { ...result.company, companyType: null, name: null, region: null, okvedMain: null, isSme: false, revenue: 0 } });
  assert.equal(emptyType.companyType, '');
  assert.equal(emptyType.name, '');
  assert.equal(emptyType.region, '');
  assert.equal(emptyType.okved, '');
  assert.equal(emptyType.isSme, 'no');
  assert.equal(emptyType.revenue, 0);
});
test('CompanyData maps to existing Profile with explicit derived age provenance', async () => {
  const result = await service.getCompanyByInn('9900000031');
  assert.ok(result);
  assert.equal(result.profile.okved, '62.01');
  assert.equal(result.profile.tax, 'УСН');
  assert.equal(result.profile.ageMonths, 26);
  assert.equal(result.profile.isSme, 'yes');
  assert.equal(result.profile.provenance?.ageMonths?.kind, 'derived');
  assert.deepEqual(result.profile.provenance?.ageMonths?.derivedFrom, ['registrationDate']);
  assert.equal(result.profile.provenance?.ageMonths?.computedAt, now().toISOString());
  assert.deepEqual(result.profile.provenance?.okved?.derivedFrom, ['okvedMain']);
  assert.equal(ageInMonths('2024-07-23', now()), 25);
  assert.equal(ageInMonths('2026-09-22', now()), 0);
  for (const date of ['2026-09-23', '2026-02-30', 'invalid']) assert.equal(ageInMonths(date, now()), null);
});
test('returned fixtures are isolated; each field can retain its own source', async () => {
  const record = await provider.getCompanyByInn('9900000017');
  assert.ok(record);
  record.company.name = 'Changed';
  const fresh = await provider.getCompanyByInn('9900000017');
  assert.notEqual(fresh?.company.name, 'Changed');
  record.sources.push({ ...record.sources[0], id: 'second', name: 'Second dataset' });
  record.provenance.isSme = { ...record.provenance.isSme!, sourceId: 'second', source: 'Second dataset' };
  const combined = await new CompanyDataService({ mode: 'demo', async getCompanyByInn() { return record; } }).getCompanyByInn(record.company.inn);
  assert.equal(combined?.profile.provenance?.isSme?.sourceId, 'second');
  assert.equal(combined?.profile.provenance?.name?.sourceId, 'opora-demo-v1');
});
test('official providers fail explicitly and invalid provenance fails closed', async () => {
  for (const p of [new FNSOpenDataProvider(), new SMERegistryProvider()])
    await assert.rejects(new CompanyDataService(p).getCompanyByInn('9900000017'), /NOT_CONFIGURED/);
  const record = await provider.getCompanyByInn('9900000017');
  assert.ok(record);
  await assert.rejects(new CompanyDataService({ mode: 'official', async getCompanyByInn() { return record; } }).getCompanyByInn(record.company.inn), /INVALID_COMPANY_PROVIDER_RESULT/);
  await assert.rejects(new CompanyDataService({ mode: 'demo', async getCompanyByInn() { return record; } }).getCompanyByInn('9900000031'), /INVALID_COMPANY_PROVIDER_RESULT/);
  delete record.provenance.name;
  await assert.rejects(new CompanyDataService({ mode: 'demo', async getCompanyByInn() { return record; } }).getCompanyByInn(record.company.inn), /MISSING_COMPANY_PROVENANCE/);
});

async function listen(p?: CompanyDataProvider) {
  const app = express();
  app.use('/api/company', p ? companyDataRouter(new CompanyDataService(p, now)) : companyDataRouter());
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return { url: `http://127.0.0.1:${address.port}/api/company/`, close: () => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  }) };
}

test('GET /api/company/:inn returns 200, 400, 404 and disables caching', async () => {
  const app = await listen();
  try {
    for (const inn of ['9900000017', '990000000041']) {
      const response = await fetch(app.url + inn);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      const body = await response.json() as CompanyResponse;
      assert.equal(body.company.inn, inn);
      assert.equal(body.mode, 'demo');
      assert.ok(body.sources.length);
      assert.equal(body.profile.inn, inn);
    }
    for (const [inn, status] of [['bad', 400], ['9900000018', 400], ['7707083893', 404]] as const)
      assert.equal((await fetch(app.url + inn)).status, status);
  } finally { await app.close(); }
});
test('unconfigured and failed sources never turn into 404 or demo success', async () => {
  for (const [p, status] of [
    [new FNSOpenDataProvider(), 503],
    [{ mode: 'official', async getCompanyByInn() { throw new Error('SECRET_PROVIDER_ERROR'); } }, 502],
  ] as [CompanyDataProvider, number][]) {
    const app = await listen(p);
    try {
      const response = await fetch(app.url + '9900000017');
      assert.equal(response.status, status);
      assert.ok(!(await response.text()).includes('SECRET_PROVIDER_ERROR'));
    } finally { await app.close(); }
  }
});
test('GigaChat wire payload excludes company identifiers, raw source data and provenance', async () => {
  const data = await service.getCompanyByInn('9900000024');
  assert.ok(data);
  let wire = '';
  await privateCompletion({ question: 'Поддержка', context: {
    profile: { ...data.profile, ogrn: '1234567890123', email: 'private@example.test' },
    company: data.company, sources: data.sources, provenance: data.provenance,
  } }, { endpoint: 'https://example.test/completions', token: 'test', model: 'test' },
  (async (_url, init) => {
    wire = String(init?.body);
    return new Response(JSON.stringify({ choices: [{ message: { content: 'Проверьте условия.' } }] }));
  }) as typeof fetch);
  for (const secret of [data.company.inn, data.company.name!, data.company.source, 'opora-demo-v1', '1234567890123', 'private@example.test'])
    assert.ok(!wire.includes(secret), secret);
  assert.ok(wire.includes('КФХ'));
});
