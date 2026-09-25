import test from 'node:test';
import assert from 'node:assert/strict';
import { DaDataCompanyProvider, mapDaDataCompany } from './dadata';
import { CompanyDataService } from './service';
import { companyDataRouter } from './router';
import express from 'express';

const inn = '2126000147';
const record = () => ({ inn, ogrn: '1022100967756', type: 'LEGAL', name: { short_with_opf: 'АО «Проверка»' },
  opf: { code: '12267', short: 'НАО' }, state: { status: 'ACTIVE', actuality_date: Date.UTC(2026, 0, 1), registration_date: Date.UTC(2010, 0, 1) },
  address: { data: { region_with_type: 'Чувашская Республика' } }, okved: '10.82.2',
  employee_count: null, finance: { income: 5000000, revenue: null, year: 2025 }, documents: null });
const fetcher = (data: unknown) => (async () => new Response(JSON.stringify({ suggestions: [{ data }] }))) as typeof fetch;

test('DaData maps public fields without turning missing values into facts or income into revenue', async () => {
  const result = await new CompanyDataService(new DaDataCompanyProvider('test-token', fetcher(record()))).getCompanyByInn(inn);
  assert.ok(result); assert.equal(result.mode, 'aggregator'); assert.equal(result.profile.companyType, 'АО');
  assert.equal(result.profile.okved, '10.82.2'); assert.equal(result.profile.isSme, 'unknown');
  assert.equal(result.profile.employees, null); assert.equal(result.profile.revenue, null); assert.equal(result.profile.tax, '');
  assert.equal(result.company.income, 5000000); assert.equal(result.provenance.income?.period, 2025);
  assert.equal(result.profile.provenance?.ageMonths?.kind, 'derived'); assert.ok(result.profile.ageMonths! > 0);
  assert.equal(result.sources[0].mode, 'aggregator'); assert.equal(result.profile.provenance?.name?.sourceId, 'dadata-company');
  assert.equal(result.provenance.employees, undefined); assert.equal(result.provenance.isSme, undefined);
});
test('DaData uses explicit SME data, finance period and IP form, without guessing employee period', () => {
  const data = { ...record(), inn: '990000000041', type: 'INDIVIDUAL', employee_count: 0,
    documents: { smb: { category: 'MICRO' } }, finance: { revenue: 120, income: 150, year: 2025, tax_system: 'USN' } };
  const result = mapDaDataCompany(data, data.inn);
  assert.equal(result.company.companyType, 'ИП'); assert.equal(result.company.isSme, true);
  assert.equal(result.company.smeCategory, 'micro'); assert.equal(result.company.revenue, 120);
  assert.equal(result.company.employees, 0); assert.equal(result.company.employeesPeriod, null);
  assert.equal(result.provenance.employees?.period, undefined); assert.equal(result.company.taxRegime, 'УСН');
});
test('DaData sends the key only to its API, deduplicates requests and isolates cached results', async () => {
  let calls = 0;
  const provider = new DaDataCompanyProvider('test-token', (async (url, init) => {
    calls++; assert.equal(url, 'https://suggestions.dadata.ru/suggestions/api/4_1/rs/findById/party');
    assert.equal((init?.headers as Record<string, string>).Authorization, 'Token test-token');
    assert.equal(init?.redirect, 'error'); assert.deepEqual(JSON.parse(init?.body as string), { query: inn, branch_type: 'MAIN', count: 1 });
    return new Response(JSON.stringify({ suggestions: [{ data: record() }] }));
  }) as typeof fetch);
  assert.equal(provider.status().state, 'not_checked');
  const [one, two] = await Promise.all([provider.getCompanyByInn(inn), provider.getCompanyByInn(inn)]);
  one!.company.name = 'changed'; assert.notEqual(two!.company.name, 'changed');
  assert.notEqual((await provider.getCompanyByInn(inn))!.company.name, 'changed'); assert.equal(calls, 1);
  assert.equal(provider.status().state, 'ready'); assert.doesNotMatch(JSON.stringify(provider.status()), /test-token/);
  await assert.rejects(provider.getCompanyByInn('123'), /INVALID_INN/); assert.equal(calls, 1);
});
test('DaData rejects another company and malformed payloads, but empty results mean not found', async () => {
  const mismatch = new CompanyDataService(new DaDataCompanyProvider('test-token', fetcher({ ...record(), inn: '7707083893' })));
  await assert.rejects(mismatch.getCompanyByInn(inn), /INVALID_COMPANY_PROVIDER_RESULT/);
  const empty = new DaDataCompanyProvider('test-token', (async () => new Response('{"suggestions":[]}')) as typeof fetch);
  assert.equal(await empty.getCompanyByInn(inn), null);
  for (const body of [{}, { suggestions: [null] }]) {
    const bad = new DaDataCompanyProvider('test-token', (async () => new Response(JSON.stringify(body))) as typeof fetch);
    await assert.rejects(bad.getCompanyByInn(inn), /INVALID_COMPANY_PROVIDER_RESULT/);
  }
});
test('DaData HTTP failures stay distinguishable and never expose upstream errors or keys', async () => {
  for (const [status, expected, code] of [[403, 503, 'COMPANY_ACCESS_DENIED'], [402, 503, 'COMPANY_QUOTA_EXCEEDED'], [429, 429, 'COMPANY_RATE_LIMITED'], [500, 502, 'FNS_UNAVAILABLE']] as const) {
    const provider = new DaDataCompanyProvider('private-key', (async () => new Response('private-upstream-message', { status })) as typeof fetch);
    const app = express(); app.use('/company', companyDataRouter(new CompanyDataService(provider)));
    const server = app.listen(0, '127.0.0.1'); await new Promise<void>(r => server.once('listening', r));
    const address = server.address(); assert.ok(address && typeof address === 'object');
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/company/${inn}`);
      assert.equal(response.status, expected); const body = await response.text();
      assert.equal(JSON.parse(body).code, code); assert.doesNotMatch(body, /private-key|private-upstream-message/);
    } finally { await new Promise<void>(r => { server.close(() => r()); server.closeAllConnections(); }); }
  }
});
