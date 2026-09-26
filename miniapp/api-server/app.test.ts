import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp, type AIClient } from './app';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { PrivacyError } from './privacy';
import type { AIResult } from './ai/types';
async function server(giga: AIClient | null, run: (url: string) => Promise<void>) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'opora-api-'));
  const server = createApp({ giga, env: {}, fnsDir: dir }).listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address(); assert.ok(address && typeof address === 'object');
  try { await run(`http://127.0.0.1:${address.port}`); }
  finally { await new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections(); }); await rm(dir, { recursive: true, force: true }); }
}
test('health, provider/catalog/AI status and missing real FNS dataset stay honest', async () => server(null, async (url) => {
  for (const endpoint of ['/api/health', '/api/providers/status', '/api/funding/status', '/api/funding/catalog', '/api/ai/status']) assert.equal((await fetch(url + endpoint)).status, 200);
  const providers = await (await fetch(url + '/api/providers/status')).json() as any;
  assert.equal(providers.company.fnsRegistry, 'missing'); assert.equal(providers.ai.gigachat, 'not_configured');
  assert.equal((await fetch(url + '/api/company/7707083893')).status, 503);
  assert.equal((await fetch(url + '/api/company/invalid')).status, 400);
  assert.equal((await fetch(url + '/api/demo-notification')).status, 404);
  const response = await fetch(url + '/api/assistant', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: 'Что подходит?', context: {} }) });
  assert.equal(response.status, 503); assert.ok((await response.json() as any).code);
}));

test('direct API catalogue is compressed even when ingress bypasses the frontend', async () => server(null, async (url) => {
  const response = await fetch(url + '/api/funding/catalog', { headers: { 'Accept-Encoding': 'gzip' } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-encoding'), 'gzip');
  assert.ok((await response.json() as any).opportunities.length > 0);
}));
test('configured AI becomes ready only after a successful request', async () => server({ async complete() { return { answer: 'Проверьте условия.', mode: 'llm' }; } }, async (url) => {
  const first = await (await fetch(url + '/api/ai/status')).json() as any;
  assert.equal(first.configured, true); assert.equal(first.checked, false); assert.notEqual(first.status, 'ready');
  assert.equal((await fetch(url + '/api/assistant', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: 'Сроки', context: {} }) })).status, 200);
  assert.equal((await (await fetch(url + '/api/ai/status')).json() as any).status, 'ready');
}));

test('v2 reports a refused request separately from an outage and recovers on success', async () => {
  let attempt = 0;
  const reply: AIResult = { mode: 'llm', answer: 'Ответ', followups: [], citations: [], actions: [], findings: [], matches: [], scenarios: [], tools: [] };
  await server({ async complete() { return reply; }, async assist() {
    attempt++;
    if (attempt === 1) return { ...reply, mode: 'local', providerFailure: 'PROVIDER_CONTENT_BLOCKED' };
    if (attempt === 2) throw new DOMException('PRIVATE_DATA', 'TimeoutError');
    if (attempt === 3) throw new PrivacyError('PROVIDER_RATE_LIMITED');
    return reply;
  } }, async url => {
    for (const [code, reason, status] of [['PROVIDER_CONTENT_BLOCKED', 'request_rejected', 'limited'], ['PROVIDER_TIMEOUT', 'timeout', 'unavailable'], ['PROVIDER_RATE_LIMITED', 'rate_limit', 'unavailable'], [null, null, 'ready']]) {
      const response = await fetch(url + '/api/ai/assist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ task: 'chat', question: 'Вопрос', context: {} }) });
      const body = await response.json();
      assert.doesNotMatch(JSON.stringify(body), /PRIVATE_DATA/);
      if (response.status === 502) assert.equal(body.code, code);
      const health = await (await fetch(url + '/api/ai/status')).json() as any;
      assert.equal(health.reason, reason); assert.equal(health.status, status);
      if (code) { assert.equal(health.lastFailure.code, code); assert.equal(health.lastFailure.task, 'chat'); }
      else assert.ok(health.lastSuccess);
    }
  });
});
test('AI timeout and unexpected errors never leak details; invalid JSON and size limit use unified errors', async () => server({ async complete() { throw new DOMException('PRIVATE_PROVIDER_MESSAGE', 'TimeoutError'); } }, async (url) => {
  const response = await fetch(url + '/api/assistant', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: 'Сроки', context: {} }) });
  assert.equal(response.status, 502); assert.doesNotMatch(await response.text(), /PRIVATE_PROVIDER_MESSAGE/);
  const status = await (await fetch(url + '/api/ai/status')).json() as any;
  assert.equal(status.status, 'unavailable'); assert.equal(status.reason, 'timeout');
  for (const body of ['{', JSON.stringify({ question: 'x'.repeat(60000) })]) {
    const response = await fetch(url + '/api/assistant', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    assert.equal(response.status, 400); assert.equal((await response.json() as any).code, 'INVALID_INPUT');
  }
}));
test('TLS failures provide safe certificate diagnostics without disabling verification', async () => server({ async complete() {
  throw new Error('PRIVATE_TLS_MESSAGE', { cause: { code: 'SELF_SIGNED_CERT_IN_CHAIN', details: 'PRIVATE_CHAIN' } });
} }, async (url) => {
  const response = await fetch(url + '/api/assistant', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: 'Сроки', context: {} }) });
  assert.equal(response.status, 502);
  const text = await response.text(); assert.match(text, /AI_TLS_ERROR/); assert.match(text, /NODE_EXTRA_CA_CERTS/); assert.doesNotMatch(text, /PRIVATE_/);
  assert.equal((await (await fetch(url + '/api/ai/status')).json() as any).reason, 'tls');
}));
