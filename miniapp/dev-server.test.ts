// Ловим регрессию белого экрана: исходные модули нельзя отправлять в API-прокси.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer as createHttpServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer, type ProxyOptions } from 'vite';
import config from './vite.config';

test('development server serves shared frontend modules and proxies only API routes', async () => {
  const backend = createHttpServer((req, res) => {
    if (req.url === '/api/health') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ service: 'test-api' }));
    } else {
      res.statusCode = 404;
      res.end('API does not serve frontend source files');
    }
  });
  await new Promise<void>((resolve) => backend.listen(0, '127.0.0.1', resolve));
  const address = backend.address();
  assert.ok(address && typeof address === 'object');
  const cacheDir = await mkdtemp(path.join(tmpdir(), 'opora-vite-test-'));
  const proxy = Object.fromEntries(
    Object.entries(config.server?.proxy || {}).map(([key, options]) => [
      key,
      {
        ...(typeof options === 'object' ? options : {}),
        target: `http://127.0.0.1:${address.port}`,
      } as ProxyOptions,
    ]),
  );
  // This regression needs Vite's TS/JSON loaders and the actual proxy config, not React prebundling.
  const server = await createServer({
    ...config,
    plugins: [],
    configFile: false,
    root: __dirname,
    cacheDir,
    logLevel: 'silent',
    optimizeDeps: { noDiscovery: true, include: [] },
    server: {
      ...config.server,
      host: '127.0.0.1',
      port: 0,
      proxy,
      preTransformRequests: false,
      watch: null,
    },
  });
  try {
    await server.listen();
    const origin = server.resolvedUrls?.local[0];
    assert.ok(origin);
    for (const resource of [
      'src/business/domain.ts',
      'api-server/business-model.ts',
      'api-server/funding-catalog/official-funding.snapshot.json?import',
    ]) {
      const response = await fetch(new URL(resource, origin));
      assert.equal(response.status, 200, resource);
      assert.match(response.headers.get('content-type') || '', /javascript/, resource);
      assert.match(await response.text(), /export /, resource);
    }
    const health = await fetch(new URL('api/health', origin));
    assert.deepEqual(await health.json(), { service: 'test-api' });
  } finally {
    await server.close();
    await new Promise<void>((resolve, reject) =>
      backend.close((error) => (error ? reject(error) : resolve())),
    );
    const resolvedCache = path.resolve(cacheDir);
    assert.equal(path.dirname(resolvedCache), path.resolve(tmpdir()));
    assert.ok(path.basename(resolvedCache).startsWith('opora-vite-test-'));
    await rm(resolvedCache, { recursive: true, force: true });
  }
});
