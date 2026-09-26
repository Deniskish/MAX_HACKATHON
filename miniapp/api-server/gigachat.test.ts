// Имитируем провайдера: проверяем авторизацию, обновление токена и повтор после 401.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGigaChatClient, GIGACHAT_OAUTH_URL, GIGACHAT_CHAT_URL } from './gigachat';

const config = {
  authKey: 'base64-authorization-key',
  scope: 'GIGACHAT_API_PERS',
  model: 'GigaChat',
};
const input = {
  question: 'Какая поддержка доступна Иванову?',
  context: { profile: { inn: '123456789012', name: 'Иванов', region: 'Москва' } },
};
const answer = () =>
  new Response(JSON.stringify({ choices: [{ message: { content: 'Учебная программа.' } }] }));

test('temporary gateway failures retry once with identical input; refusals and rate limits never retry', async () => {
  for (const status of [502, 503, 504, 429, 403, 200]) {
    const bodies: string[] = [];
    const client = createGigaChatClient(config, async (url, init) => {
      if (String(url) === GIGACHAT_OAUTH_URL) return Response.json({ access_token: 't', expires_at: Date.now() + 1800000 });
      if (String(url).endsWith('/embeddings')) return new Response('', { status: 400 });
      bodies.push(String(init?.body));
      if (bodies.length > 1) return answer();
      return status === 200 ? Response.json({ choices: [{ finish_reason: 'blacklist', message: { content: 'Отказ' } }] }) : new Response('', { status });
    });
    const result = await client.assist({ task: 'analysis', question: 'Следующий шаг', context: {} });
    assert.equal(bodies.length, [502, 503, 504].includes(status) ? 2 : 1);
    if (bodies.length === 2) { assert.equal(bodies[0], bodies[1]); assert.equal(result.mode, 'llm'); }
    else assert.equal(result.mode, 'local');
    if (status === 200) assert.equal(result.providerFailure, 'PROVIDER_CONTENT_BLOCKED');
  }
});
test('native OAuth headers + form, bearer generation, protected body and shared concurrent token refresh', async () => {
  let oauth = 0,
    chat = 0;
  const transport = (async (url, init) => {
    assert.equal(init?.redirect, 'error');
    const headers = new Headers(init?.headers);
    if (String(url) === GIGACHAT_OAUTH_URL) {
      oauth++;
      assert.equal(init?.body, 'scope=GIGACHAT_API_PERS');
      assert.equal(headers.get('Authorization'), `Basic ${config.authKey}`);
      assert.equal(headers.get('Content-Type'), 'application/x-www-form-urlencoded');
      assert.match(
        headers.get('RqUID') || '',
        /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/,
      );
      return new Response(
        JSON.stringify({ access_token: 'access-1', expires_at: Date.now() + 1800000 }),
      );
    }
    assert.equal(String(url), GIGACHAT_CHAT_URL);
    chat++;
    assert.equal(headers.get('Authorization'), 'Bearer access-1');
    const body = String(init?.body);
    assert.ok(!body.includes('Иванов'));
    assert.ok(!body.includes('123456789012'));
    assert.ok(!body.includes(config.authKey));
    assert.equal(JSON.parse(body).model, 'GigaChat');
    return answer();
  }) as typeof fetch;
  const client = createGigaChatClient(config, transport);
  const results = await Promise.all([
    client.complete(input),
    client.complete(input),
    client.complete(input),
  ]);
  assert.equal(oauth, 1);
  assert.equal(chat, 3);
  assert.ok(results.every((r) => r.provider === 'gigachat' && r.privacy.policy === 'strict-v1'));
});
test('token refreshes before expires_at', async () => {
  let time = 1000000,
    oauth = 0;
  const transport = (async (url) =>
    String(url) === GIGACHAT_OAUTH_URL
      ? new Response(JSON.stringify({ access_token: `t${++oauth}`, expires_at: time + 1800000 }))
      : answer()) as typeof fetch;
  const client = createGigaChatClient(config, transport, () => time);
  await client.complete(input);
  time += 1750000;
  await client.complete(input);
  assert.equal(oauth, 2);
});
test('401 refreshes once and retries identical sanitized request', async () => {
  let oauth = 0;
  const bodies: string[] = [];
  const transport = (async (url, init) => {
    if (String(url) === GIGACHAT_OAUTH_URL)
      return new Response(
        JSON.stringify({ access_token: `t${++oauth}`, expires_at: Date.now() + 1800000 }),
      );
    bodies.push(String(init?.body));
    return bodies.length === 1 ? new Response('', { status: 401 }) : answer();
  }) as typeof fetch;
  await createGigaChatClient(config, transport).complete(input);
  assert.equal(oauth, 2);
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0], bodies[1]);
});
test('second 401 stops; no infinite retries or raw error response', async () => {
  let chats = 0;
  const transport = (async (url) => {
    if (String(url) === GIGACHAT_OAUTH_URL)
      return new Response(
        JSON.stringify({ access_token: 'token', expires_at: Date.now() + 1800000 }),
      );
    chats++;
    return new Response('secret-provider-details', { status: 401 });
  }) as typeof fetch;
  await assert.rejects(
    createGigaChatClient(config, transport).complete(input),
    /PROVIDER_UNAVAILABLE/,
  );
  assert.equal(chats, 2);
});
test('invalid request is rejected before OAuth and unsupported config fails', async () => {
  let calls = 0;
  const transport = (async () => {
    calls++;
    return answer();
  }) as typeof fetch;
  await assert.rejects(
    createGigaChatClient(config, transport).complete({ question: '', context: {} }),
  );
  assert.equal(calls, 0);
  assert.throws(
    () => createGigaChatClient({ ...config, scope: 'user-controlled-url' }),
    /INVALID_GIGACHAT_CONFIG/,
  );
});
test('failed or malformed OAuth never calls chat and is not cached', async () => {
  for (const result of [
    () => new Response('secret', { status: 401 }),
    () => new Response('{}'),
    () => new Response(JSON.stringify({ access_token: 't', expires_at: Date.now() - 1 })),
    () => new Response('x'.repeat(16001)),
  ]) {
    let calls = 0;
    const transport = (async (url) => {
      assert.equal(String(url), GIGACHAT_OAUTH_URL);
      calls++;
      return result();
    }) as typeof fetch;
    const client = createGigaChatClient(config, transport);
    await assert.rejects(client.complete(input));
    await assert.rejects(client.complete(input));
    assert.equal(calls, 2);
  }
});
