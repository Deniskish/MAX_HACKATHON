import test from 'node:test';
import assert from 'node:assert/strict';
import { serialTransport } from './serial-transport';

test('provider slot stays locked until the response body finishes', async () => {
  let calls = 0, close!: () => void;
  const transport = serialTransport((async () => {
    calls++;
    if (calls === 1) return new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode('{"ok":true}'));
      close = () => controller.close();
    } }));
    return Response.json({ ok: true });
  }) as typeof fetch);
  const first = transport('https://example.test'), second = transport('https://example.test');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1);
  close();
  assert.deepEqual(await (await first).json(), { ok: true });
  assert.deepEqual(await (await second).json(), { ok: true });
  assert.equal(calls, 2);
});

test('cancelled queued request never calls the provider or unlocks an active generation', async () => {
  let calls = 0, unblock!: () => void;
  const transport = serialTransport((async () => {
    if (++calls === 1) await new Promise<void>(resolve => { unblock = resolve; });
    return Response.json({ ok: true });
  }) as typeof fetch);
  const first = transport('https://example.test');
  const controller = new AbortController();
  const cancelled = transport('https://example.test', { signal: controller.signal });
  const rejection = assert.rejects(cancelled, { name: 'AbortError' });
  controller.abort(); await rejection;
  const third = transport('https://example.test');
  await new Promise(resolve => setImmediate(resolve)); assert.equal(calls, 1);
  unblock(); await Promise.all([first, third]); assert.equal(calls, 2);
});

test('failure and oversized responses release the queue; HTTP error remains readable', async () => {
  let calls = 0;
  const transport = serialTransport((async () => {
    if (++calls === 1) throw Error('network');
    if (calls === 2) return new Response('x'.repeat(2_000_001));
    return Response.json({ code: 8 }, { status: 429 });
  }) as typeof fetch);
  await assert.rejects(transport('https://example.test'), /network/);
  await assert.rejects(transport('https://example.test'), /RESPONSE_TOO_LARGE/);
  const response = await transport('https://example.test');
  assert.equal(response.status, 429); assert.deepEqual(await response.json(), { code: 8 });
});
