import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import { NotificationStore, NotificationWorker, notificationRouter, verifyMaxUser, notificationCandidate, maxSender } from './notifications';
import { normalizeBudgetCard, type LiveCatalog } from './live';
import { emptyFundingNeed } from './types';
import { createOpportunityAssessor } from './notification-ai';
import { untilAborted } from './abort';

const now = Date.now(), token = 'test-bot-token';
const profile = { region: 'Москва', companyType: 'ООО' as const, isSme: 'yes' as const, industry: 'Производство', goals: ['запуск производства'] };
function signed(user = 123, issued = Math.floor(now / 1000)) {
  const params = new URLSearchParams({ auth_date: String(issued), user: JSON.stringify({ id: user, first_name: 'Тест' }), query_id: 'test' });
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  const check = [...params].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join('\n');
  params.set('hash', createHmac('sha256', secret).update(check).digest('hex')); return params.toString();
}
const opportunity = () => {
  const o = normalizeBudgetCard({ competitionId: '5f564f52-ac51-4496-9db7-bd7b282f7b64', title: 'Поддержка производства субъектами МСП', pppItemName: 'Организатор',
    startDate: new Date(now - 86400000).toISOString(), endDate: new Date(now + 86400000).toISOString(), isActive: true, isNotActive: false,
    selectionRecipients: [2], maxAmountForPersonInfo: '300 000,00 ₽', competitionType: 0 });
  o.imported!.detail = { text: 'Поддержка производства в Москве для субъектов МСП', complete: true, version: 'source-v1',
    checkedAt: new Date(now).toISOString(), startsAt: o.imported!.startsAt, endsAt: o.imported!.endsAt, accepting: true, geography: ['Москва'] }; return o;
};
function catalog(o = opportunity()) { return { getCatalog: () => [o], enrich: async () => o, status: () => ({ checkedAt: new Date(now).toISOString() }) } as unknown as LiveCatalog; }
test('MAX signature rejects tampering, duplicate fields, wrong token, stale and future auth', () => {
  assert.equal(verifyMaxUser(signed(), token, now), '123');
  for (const raw of [signed() + '&user=%7B%22id%22%3A999%7D', signed().replace('query_id=test', 'query_id=evil'), signed(123, Math.floor(now / 1000) - 90000), signed(123, Math.floor(now / 1000) + 120)]) assert.throws(() => verifyMaxUser(raw, token, now));
  assert.throws(() => verifyMaxUser(signed(), 'wrong', now));
});
test('subscription API uses signed identity, strips identifiers, isolates reads and deletes', async () => {
  const store = new NotificationStore(':memory:'); const app = express(); app.use(express.json()); app.use(notificationRouter(store, token, true));
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>((resolve) => server.once('listening', resolve));
  const url = `http://127.0.0.1:${(server.address() as any).port}`;
  try {
    assert.equal((await fetch(url)).status, 401);
    const headers = { 'X-Max-Init-Data': signed(), 'Content-Type': 'application/json' };
    const saved = await fetch(url + '/subscription', { method: 'PUT', headers, body: JSON.stringify({ user_id: '999', profile: { ...profile, inn: 'PRIVATE-INN', name: 'PRIVATE-NAME' }, need: emptyFundingNeed, bot: true }) });
    assert.equal(saved.status, 200); assert.ok(store.get('123')); assert.equal(store.get('999'), undefined); assert.doesNotMatch(store.get('123')!.profile, /PRIVATE/);
    assert.deepEqual((await (await fetch(url, { headers: { 'X-Max-Init-Data': signed(999) } })).json() as any).items, []);
    assert.equal((await fetch(url + '/subscription', { method: 'DELETE', headers })).status, 200); assert.equal(store.get('123'), undefined);
  } finally { await new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections(); }); store.db.close(); }
});
test('background worker creates in-app notice and sends MAX without a browser; repeat scan does not duplicate', async () => {
  const store = new NotificationStore(':memory:'); store.subscribe('123', profile, emptyFundingNeed, true);
  let calls = 0, sent = 0;
  const worker = new NotificationWorker(store, catalog(), async () => { calls++; return { relevant: true, reason: 'Для производства', quotes: ['Поддержка производства'] }; }, async () => { sent++; });
  try { await worker.tick(now); await worker.tick(now + 60000); assert.equal(calls, 1); assert.equal(sent, 1); assert.equal(store.list('123').length, 1); }
  finally { store.db.close(); }
});
test('in-app only opt-in never sends MAX; no AI means no invented recommendations', async () => {
  const store = new NotificationStore(':memory:'); store.subscribe('123', profile, emptyFundingNeed, false); let sent = 0;
  try {
    await new NotificationWorker(store, catalog(), undefined, async () => { sent++; }).tick(now); assert.equal(store.list('123').length, 0);
    await new NotificationWorker(store, catalog(), async () => ({ relevant: true, reason: 'Совпадает отрасль', quotes: [] }), async () => { sent++; }).tick(now + 1);
    assert.equal(store.list('123').length, 1); assert.equal(sent, 0);
  } finally { store.db.close(); }
});
test('temporary MAX failure retries from durable outbox, successful delivery is not sent again', async () => {
  const store = new NotificationStore(':memory:'); store.subscribe('123', profile, emptyFundingNeed, true); let sent = 0;
  const assess = async () => ({ relevant: true, reason: 'Есть связь с производством', quotes: [] });
  try {
    await new NotificationWorker(store, catalog(), assess, async () => { sent++; throw new Error('MAX_HTTP_503'); }).tick(now);
    assert.equal((store.list('123')[0] as any).delivery, 'pending');
    const restarted = new NotificationWorker(store, catalog(), assess, async () => { sent++; });
    await restarted.tick(now + 59000); assert.equal(sent, 1);
    await restarted.tick(now + 61000); await restarted.tick(now + 120000);
    assert.equal(sent, 2); assert.equal((store.list('123')[0] as any).delivery, 'sent');
  } finally { store.db.close(); }
});
test('unsubscribe and changed business invalidate in-flight AI; permanent MAX failure stops retries', async () => {
  const store = new NotificationStore(':memory:'); store.subscribe('123', profile, emptyFundingNeed, true); let sent = 0;
  try {
    await new NotificationWorker(store, catalog(), async () => { store.remove('123'); return { relevant: true, reason: 'test', quotes: [] }; }, async () => { sent++; }).tick(now);
    assert.equal(sent, 0); assert.equal(store.list('123').length, 0);
    store.subscribe('123', profile, emptyFundingNeed, true);
    await new NotificationWorker(store, catalog(), async () => ({ relevant: true, reason: 'test', quotes: [] }), async () => { sent++; throw new Error('MAX_HTTP_403'); }).tick(now + 1);
    assert.equal((store.list('123')[0] as any).delivery, 'failed');
    await new NotificationWorker(store, catalog(), undefined, async () => { sent++; }).tick(now + 90000); assert.equal(sent, 1);
  } finally { store.db.close(); }
});
test('closed, wrong applicant and unknown dates are excluded before AI', () => {
  const o = opportunity(); assert.ok(notificationCandidate(profile, emptyFundingNeed, o, now));
  assert.equal(notificationCandidate(profile, emptyFundingNeed, { ...o, status: 'closed' }, now), false);
  assert.equal(notificationCandidate({ ...profile, companyType: 'ИП' }, emptyFundingNeed, o, now), false);
  assert.equal(notificationCandidate(profile, emptyFundingNeed, { ...o, imported: { ...o.imported!, endsAt: '' } }, now), false);
});
test('AI evidence validation rejects fabricated quotes and malformed/provider-failure output', async () => {
  const o = opportunity(); let value: unknown = { relevant: true, reason: 'Поддержка производства', quotes: ['Поддержка производства в Москве'] };
  const assess = createOpportunityAssessor('https://model.test', 'test', async () => 'token', async () => Response.json({ choices: [{ message: { content: JSON.stringify(value) } }] }));
  assert.equal((await assess(profile, emptyFundingNeed, o)).relevant, true);
  value = { relevant: true, reason: 'Придумано', quotes: ['Гарантированное одобрение 100%'] };
  assert.equal((await assess(profile, emptyFundingNeed, o)).relevant, false);
  value = 'invalid'; await assert.rejects(assess(profile, emptyFundingNeed, o));
});
test('MAX sender uses Authorization header and a programme link, checks actual acknowledgement', async () => {
  let calls = 0;
  const send = maxSender('private-token', 'https://business-opora.ru', async (url, init) => {
    calls++; assert.equal(new URL(String(url)).searchParams.get('user_id'), '123'); assert.doesNotMatch(String(url), /private-token/);
    assert.equal(new Headers(init?.headers).get('Authorization'), 'private-token'); const body = JSON.parse(String(init?.body));
    assert.equal(body.notify, true); assert.match(body.attachments[0].payload.buttons[0][0].url, /program=budget-/);
    return Response.json({ message: { body: { mid: 'sent-1' } } });
  });
  await send('123', 'Появилась мера поддержки', opportunity().id); assert.equal(calls, 1);
});

test('file-backed queue survives closing and reopening SQLite', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'opora-notices-'));
  let store = new NotificationStore(path.join(dir, 'notifications.sqlite'));
  try {
    store.subscribe('123', profile, emptyFundingNeed, true);
    await new NotificationWorker(store, catalog(), async () => ({ relevant: true, reason: 'Производство', quotes: [] })).tick(now);
    store.db.close(); store = new NotificationStore(path.join(dir, 'notifications.sqlite'));
    let sent = 0;
    await new NotificationWorker(store, catalog(), undefined, async () => { sent++; }).tick(now + 1000);
    await new NotificationWorker(store, catalog(), undefined, async () => { sent++; }).tick(now + 2000);
    assert.equal(sent, 1); assert.equal((store.list('123')[0] as any).delivery, 'sent');
  } finally { store.db.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('changed company hides previous notices, cancels delivery and rejects in-flight analysis', async () => {
  const store = new NotificationStore(':memory:');
  const changed = { ...profile, region: 'Томская область' };
  try {
    store.subscribe('123', profile, emptyFundingNeed, true);
    await new NotificationWorker(store, catalog(), async () => ({ relevant: true, reason: 'Москва', quotes: [] })).tick(now);
    assert.equal(store.list('123').length, 1);
    store.subscribe('123', changed, emptyFundingNeed, true);
    assert.equal(store.list('123').length, 0);
    assert.equal((store.db.prepare('SELECT bot_state FROM notifications').get() as any).bot_state, 'cancelled');
    assert.equal(notificationCandidate(changed, emptyFundingNeed, opportunity(), now), false);
    store.remove('123'); store.subscribe('123', profile, emptyFundingNeed, true);
    await new NotificationWorker(store, catalog(), async () => {
      store.subscribe('123', changed, emptyFundingNeed, true);
      return { relevant: true, reason: 'Старый профиль', quotes: [] };
    }).tick(now + 1000);
    assert.equal(store.db.prepare('SELECT id FROM notifications').get(), undefined);
  } finally { store.db.close(); }
});

test('database lease prevents concurrent workers from assessing or sending twice', async () => {
  const store = new NotificationStore(':memory:'); store.subscribe('123', profile, emptyFundingNeed, true);
  let release!: () => void, started!: () => void, sent = 0, calls = 0;
  const entered = new Promise<void>(r => { started = r; });
  const gate = new Promise<void>(r => { release = r; });
  const assess = async () => { calls++; started(); await gate; return { relevant: true, reason: 'Производство', quotes: [] }; };
  try {
    const first = new NotificationWorker(store, catalog(), assess, async () => { sent++; }).tick(now);
    await entered;
    await new NotificationWorker(store, catalog(), assess, async () => { sent++; }).tick(now + 1);
    release(); await first; assert.equal(calls, 1); assert.equal(sent, 1);
  } finally { release(); store.db.close(); }
});

test('MAX bot link includes startapp and shared requests stop blocking an aborted caller', async () => {
  const send = maxSender('token', 'https://business-opora.ru', async (_url, init) => {
    const link = new URL(JSON.parse(String(init?.body)).attachments[0].payload.buttons[0][0].url);
    assert.equal(link.origin + link.pathname, 'https://max.ru/opora_bot');
    assert.equal(link.searchParams.get('startapp'), opportunity().id);
    return Response.json({ message: { body: { mid: 'ok' } } });
  }, '@opora_bot');
  await send('123', 'test', opportunity().id);
  const controller = new AbortController();
  const waiting = untilAborted(new Promise(() => {}), controller.signal); controller.abort();
  await assert.rejects(waiting, { name: 'AbortError' });
});
