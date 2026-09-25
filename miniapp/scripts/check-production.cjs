const assert = require('node:assert/strict');
(async () => {
  const origin = process.env.FRONTEND_URL || 'http://127.0.0.1:3000';
  const index = await fetch(origin, { signal: AbortSignal.timeout(10000) });
  assert.equal(index.status, 200, 'Frontend must respond');
  const html = await index.text();
  assert.doesNotMatch(html, /\/@vite\/|\/@react-refresh|\/src\/main\.tsx/, 'Development server must not be public');
  const asset = html.match(/src="(\/assets\/[^"\s]+\.js)"/)?.[1];
  assert.ok(asset, 'Built entry script must be present');
  const script = await fetch(new URL(asset, origin), { headers: { 'Accept-Encoding': 'gzip' }, signal: AbortSignal.timeout(10000) });
  assert.equal(script.status, 200);
  assert.equal(script.headers.get('content-encoding'), 'gzip', 'JS must be compressed');
  assert.match(script.headers.get('cache-control') || '', /immutable/);
  await script.arrayBuffer();
  const health = await fetch(new URL('/api/health', origin), { signal: AbortSignal.timeout(10000) });
  assert.equal(health.status, 200);
  assert.equal((await health.json()).status, 'ok');
  console.log('PASS production entry, gzip, asset cache and API proxy');
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
