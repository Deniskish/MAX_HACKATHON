import test from 'node:test';
import assert from 'node:assert/strict';
import { OporaAPI } from './api-client';

test('bot API permits HTTPS, loopback and only the explicit Docker HTTP origin', () => {
  for (const base of ['https://business-opora.ru', 'https://example.org:8443',
    'http://localhost:3002', 'http://127.0.0.1:3002', 'http://[::1]:3002', 'http://api:3002', 'http://api:3002/']) {
    assert.doesNotThrow(() => new OporaAPI(base, 'test-token', '123'), base);
  }
  for (const base of ['http://example.org', 'http://192.168.1.2:3002', 'http://10.0.0.1:3002',
    'http://api', 'http://api:80', 'http://api:3003', 'http://api.example.org:3002', 'http://api.:3002',
    'http://api:3002@evil.example', 'http://localhost.evil.example:3002', 'ftp://api:3002',
    'https://user:password@example.org', 'http://api:3002?token=x', 'http://api:3002#fragment', 'not a URL']) {
    assert.throws(() => new OporaAPI(base, 'test-token', '123'), undefined, base);
  }
});

test('Docker API calls retain signatures and reject redirects and invalid routes', async () => {
  let calls = 0;
  const http = (async (url, options) => {
    calls++;
    assert.equal(String(url), 'http://api:3002/api/health');
    assert.equal(options?.redirect, 'error');
    const headers = new Headers(options?.headers);
    assert.equal(headers.get('X-Opora-Bot-User'), '123');
    assert.match(headers.get('X-Opora-Bot-Signature')!, /^[a-f0-9]{64}$/);
    return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
  }) as typeof fetch;
  const api = new OporaAPI('http://api:3002', 'test-token', '123', http);
  assert.deepEqual(await api.request('GET', '/api/health'), { status: 'ok' });
  await assert.rejects(api.request('GET', 'https://elsewhere.example/api/health'), /INVALID_API_ROUTE/);
  await assert.rejects(api.request('GET', '/api/../health'), /INVALID_API_ROUTE/);
  assert.equal(calls, 1);
});
