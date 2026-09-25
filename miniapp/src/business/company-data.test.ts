import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyProfile } from './domain';
import { editCompanyProfile, mergeCompanyProfile, requestCompanyData } from './company-data';
import { DemoCompanyDataProvider } from '../../api-server/tests/fixtures/demo-provider';
import { CompanyDataService } from '../../api-server/company-data/service';

const service = new CompanyDataService(new DemoCompanyDataProvider());

test('autofill preserves goals and unknown manual fields, and retains provenance after persistence', async () => {
  const data = await service.getCompanyByInn('990000000041');
  assert.ok(data);
  const current = { ...emptyProfile, inn: data.company.inn, tax: 'ПСН', goals: ['Разработка продукта'] };
  const merged = mergeCompanyProfile(current, data);
  assert.equal(merged.name, data.company.name);
  assert.equal(merged.employees, 0);
  assert.equal(merged.revenue, null);
  assert.equal(merged.isSme, 'unknown');
  assert.equal(merged.tax, 'ПСН');
  assert.deepEqual(merged.goals, current.goals);
  assert.deepEqual(JSON.parse(JSON.stringify(merged)).provenance, merged.provenance);
  const edited = editCompanyProfile(merged, { ...merged, name: 'Моё название' });
  assert.equal(edited.provenance?.name?.kind, 'manual');
  assert.equal(edited.provenance?.employees?.kind, 'source');
  assert.equal(edited.name, 'Моё название');
});
test('changing INN clears facts of the previous company and ignores an old response', async () => {
  const data = await service.getCompanyByInn('9900000031');
  assert.ok(data);
  const previous = mergeCompanyProfile({ ...emptyProfile, inn: data.company.inn }, data);
  const next = editCompanyProfile(previous, { ...previous, inn: '9900000017' });
  assert.equal(next.companyType, '');
  assert.equal(next.name, '');
  assert.equal(next.revenue, null);
  assert.equal(next.provenance?.name, undefined);
  assert.equal(next.provenance?.inn?.kind, 'manual');
  assert.strictEqual(mergeCompanyProfile(next, data), next);
});
test('refresh removes fields absent in the new snapshot without erasing manual values', async () => {
  const data = await service.getCompanyByInn('9900000031');
  assert.ok(data);
  const previous = mergeCompanyProfile({ ...emptyProfile, inn: data.company.inn }, data);
  const edited = editCompanyProfile(previous, { ...previous, revenue: 1234 });
  const updated = structuredClone(data);
  updated.profile.revenue = null;
  updated.profile.employees = null;
  delete updated.profile.provenance?.revenue;
  delete updated.profile.provenance?.employees;
  const refreshed = mergeCompanyProfile(edited, updated);
  assert.equal(refreshed.revenue, 1234);
  assert.equal(refreshed.provenance?.revenue?.kind, 'manual');
  assert.equal(refreshed.employees, null);
  assert.equal(refreshed.provenance?.employees, undefined);
});
test('company lookup calls only company API and propagates cancellation and errors', async () => {
  const data = await service.getCompanyByInn('9900000017');
  assert.ok(data);
  const controller = new AbortController();
  const result = await requestCompanyData(data.company.inn, controller.signal, (async (url, init) => {
    assert.equal(url, '/api/company/9900000017');
    assert.strictEqual(init?.signal, controller.signal);
    assert.equal(init?.cache, 'no-store');
    return new Response(JSON.stringify(data));
  }) as typeof fetch);
  assert.deepEqual(result, data);
  for (const [status, message] of [[400, /Проверьте ИНН/], [404, /не найдена/], [503, /недоступен/]] as const)
    await assert.rejects(requestCompanyData(data.company.inn, controller.signal,
      (async () => new Response('{}', { status })) as typeof fetch), message);
  await assert.rejects(requestCompanyData(data.company.inn, controller.signal,
    (async () => new Response(JSON.stringify({ code: 'FNS_NOT_CONFIGURED' }), { status: 503 })) as typeof fetch), /Автозаполнение пока не подключено/);
  await assert.rejects(requestCompanyData(data.company.inn, controller.signal,
    (async () => new Response('Too many requests', { status: 429 })) as typeof fetch), /Попробуйте через минуту/);
  for (const body of [{}, { ...data, mode: 'pretend' }, { ...data, company: { inn: 'other' } }])
    await assert.rejects(requestCompanyData(data.company.inn, controller.signal,
      (async () => new Response(JSON.stringify(body))) as typeof fetch), /некорректный/);
  controller.abort();
  await assert.rejects(requestCompanyData(data.company.inn, controller.signal, (async (_url, init) => {
    init?.signal?.throwIfAborted();
    throw new Error('unexpected');
  }) as typeof fetch));
});
