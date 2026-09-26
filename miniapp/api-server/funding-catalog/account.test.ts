import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import express from 'express';
import { accountRouter } from '../account';
import { NotificationStore } from './notifications';
import { emptyFundingNeed } from './types';
const token = 'account-test';
function auth(id: number) {
  const p = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id }) });
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  p.set('hash', createHmac('sha256', secret).update([...p].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n')).digest('hex'));
  return { 'X-Max-Init-Data': p.toString(), 'Content-Type': 'application/json' };
}
test('MAX account persists company, rejects forged authority, isolates tenants and atomically removes subscriptions', async () => {
  const store = new NotificationStore(':memory:'), app = express(); app.use(express.json()); app.use(accountRouter(store, token));
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(r => server.once('listening', r));
  const url = `http://127.0.0.1:${(server.address() as any).port}`;
  const call = (path = '', method = 'GET', body?: unknown, id = 100) => fetch(url + path, { method, headers: auth(id), body: body ? JSON.stringify(body) : undefined });
  try {
    assert.equal((await fetch(url)).status, 401);
    const account = await (await call()).json() as any; assert.ok(account.id); assert.equal(account.revision, 0);
    const company = { inn: '7707083893', name: 'Проверка', region: 'Москва', okved: '10.82', industry: 'Производство', isSme: 'unknown', authority: 'verified', esiaVerified: true };
    const saved = await (await call('/company', 'PUT', { revision: 0, company })).json() as any;
    assert.equal(saved.company.inn, company.inn); assert.equal(saved.company.authority, undefined); assert.equal(saved.company.esiaVerified, undefined);
    assert.equal(saved.authority, 'unverified'); assert.equal(saved.canSubmitApplications, false);
    assert.equal((await (await call()).json() as any).company.name, company.name);
    assert.equal((await (await call('', 'GET', undefined, 200)).json() as any).company, null);
    assert.equal((await call('/company', 'PUT', { revision: 0, company })).status, 409);
    assert.equal((await call('/verification/esia', 'POST', {})).status, 503);
    store.subscribe('100', { region: 'Москва', industry: 'Производство' }, emptyFundingNeed, true);
    const removed = await (await call('/company', 'DELETE')).json() as any;
    assert.equal(removed.id, account.id); assert.equal(removed.company, null); assert.equal(removed.revision, 2); assert.equal(store.get('100'), undefined);
    assert.equal((await call('/company', 'PUT', { revision: 2, company: { ...company, inn: '123' } })).status, 400);
  } finally { await new Promise<void>(r => { server.close(() => r()); server.closeAllConnections(); }); store.db.close(); }
});
