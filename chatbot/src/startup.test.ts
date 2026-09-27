import test from 'node:test';
import assert from 'node:assert/strict';
import { waitForAPI } from './startup';
import { APIError, type BotAPI } from './api-client';

test('bot waits for API restart but does not retry rejected credentials', async () => {
  let calls = 0, pauses = 0;
  const api = { async request() { if (++calls < 3) throw new TypeError('fetch failed'); return {}; } } as BotAPI;
  await waitForAPI(api, async () => { pauses++; });
  assert.equal(calls, 3); assert.equal(pauses, 2);
  calls = 0;
  const denied = { async request() { calls++; throw new APIError(401, 'BOT_AUTH_REQUIRED'); } } as BotAPI;
  await assert.rejects(waitForAPI(denied, async () => {}), { status: 401 });
  assert.equal(calls, 1);
});

test('API startup retry has a fixed limit', async () => {
  let calls = 0;
  const api = { async request() { calls++; throw new APIError(503, 'API_UNAVAILABLE'); } } as BotAPI;
  await assert.rejects(waitForAPI(api, async () => {}), { status: 503 });
  assert.equal(calls, 15);
});
