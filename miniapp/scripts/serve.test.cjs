const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { createApp } = require('./serve.cjs');

test('production serves compressed builds, caches safely and preserves API requests', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'opora-static-'));
  const html = '<html><script src="/assets/app-a1b2c3d4.js"></script></html>';
  const script = 'const message = "support";\n'.repeat(300);
  await fs.mkdir(path.join(root, 'assets'));
  await fs.writeFile(path.join(root, 'index.html'), html);
  await fs.writeFile(path.join(root, 'version.json'), JSON.stringify({ revision: 'test-release' }));
  await fs.writeFile(path.join(root, 'assets/app-a1b2c3d4.js'), script);
  await fs.writeFile(path.join(root, 'assets/orb.png'), 'image');
  await fs.writeFile(path.join(root, 'assets/orb-a1b2c3d4.webp'), 'old-image');
  await fs.writeFile(path.join(root, 'assets/orb-e5f6a7b8.webp'), 'new-image');
  const backend = http.createServer((req, res) => {
    let body = '';
    req.on('data', (data) => { body += data; });
    req.on('end', () => {
      res.writeHead(req.url === '/api/missing' ? 404 : 200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ url: req.url, method: req.method, body, type: req.headers['content-type'] }));
    });
  });
  await new Promise((resolve) => backend.listen(0, '127.0.0.1', resolve));
  const app = createApp({ root, api: `http://127.0.0.1:${backend.address().port}` });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const route of ['/', '/profile']) {
      const response = await fetch(origin + route);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'no-cache');
      assert.equal(await response.text(), html);
    }
    const response = await fetch(origin + '/assets/app-a1b2c3d4.js', { headers: { 'Accept-Encoding': 'gzip' } });
    const version = await fetch(origin + '/version.json');
    assert.equal(version.headers.get('cache-control'), 'no-store');
    assert.equal((await version.json()).revision, 'test-release');
    assert.equal(response.headers.get('content-encoding'), 'gzip');
    assert.match(response.headers.get('content-type'), /javascript/);
    assert.match(response.headers.get('cache-control'), /immutable/);
    assert.equal(await response.text(), script);
    const image = await fetch(origin + '/assets/orb.png');
    assert.doesNotMatch(image.headers.get('cache-control'), /immutable/);
    assert.equal(image.headers.get('cache-control'), 'public, max-age=3600');
    // Content-versioned images can stay cached; replacing art uses a new URL.
    const oldArt = await fetch(origin + '/assets/orb-a1b2c3d4.webp');
    assert.equal(oldArt.headers.get('cache-control'), 'public, max-age=31536000, immutable');
    assert.match(oldArt.headers.get('content-type'), /image\/webp/);
    assert.equal(await oldArt.text(), 'old-image');
    const newArt = await fetch(origin + '/assets/orb-e5f6a7b8.webp');
    assert.equal(await newArt.text(), 'new-image');
    assert.equal((await fetch(origin + '/assets/orb-a1b2c3d4.webp', {
      headers: { 'If-None-Match': oldArt.headers.get('etag'), 'Cache-Control': 'max-age=0' },
    })).status, 304);
    assert.equal((await fetch(origin + '/assets/missing-a1b2c3d4.webp')).status, 404);
    assert.equal((await fetch(origin + '/assets/app-a1b2c3d4.js', { method: 'HEAD' })).status, 200);
    for (const route of ['/assets/missing.js', '/src/main.tsx', '/@vite/client', '/node_modules/private', '/.env', '/api-server/server.ts']) {
      assert.equal((await fetch(origin + route)).status, 404, route);
    }
    const body = JSON.stringify({ text: 'Тестовый запрос', amount: 400000 });
    const proxy = await fetch(origin + '/api/ai/assist?mode=chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    assert.deepEqual(await proxy.json(), { url: '/api/ai/assist?mode=chat', method: 'POST', body, type: 'application/json' });
    assert.equal((await fetch(origin + '/api/missing')).status, 404);
    await new Promise((resolve) => backend.close(resolve));
    const unavailable = await fetch(origin + '/api/health');
    assert.equal(unavailable.status, 502);
    assert.equal((await unavailable.json()).code, 'UPSTREAM_UNAVAILABLE');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (backend.listening) await new Promise((resolve) => backend.close(resolve));
    const target = path.resolve(root);
    assert.equal(path.dirname(target), path.resolve(os.tmpdir()));
    assert.ok(path.basename(target).startsWith('opora-static-'));
    await fs.rm(target, { recursive: true, force: true });
  }
});
