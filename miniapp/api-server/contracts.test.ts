import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { createApp } from './app';
const root = path.resolve(__dirname, '../..');
const spec = parse(readFileSync(path.join(root, 'openapi.yaml'), 'utf8'));
const checks = parse(readFileSync(path.join(root, 'DATA-API.yaml'), 'utf8'));
test('OpenAPI and DATA-API checks correspond to public runtime responses', async () => {
  assert.match(spec.openapi, /^3\./); assert.equal(checks.schemaVersion, '1.0'); assert.equal(checks.checks.length, 6);
  const server = createApp({ giga: null, env: {} }).listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address(); assert.ok(address && typeof address === 'object');
  try {
    for (const check of checks.checks) {
      assert.ok(spec.paths[check.path]?.[check.method.toLowerCase()]);
      const response = await fetch(`http://127.0.0.1:${address.port}${check.path}`, { method: check.method,
        headers: check.request?.headers, body: check.request?.body ? JSON.stringify(check.request.body) : undefined });
      assert.ok(check.expected.statusCodes.includes(response.status));
      const body = await response.json(); for (const field of check.expected.requiredFields) assert.ok(Object.hasOwn(body as object, field), `${check.path}: ${field}`);
    }
  } finally { await new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections(); }); }
});
test('production modules never import synthetic fixtures and frontend controls do not use empty handlers', () => {
  function visit(dir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', 'dist', 'tests', '.git'].includes(entry.name)) continue;
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (/\.[cm]?[jt]sx?$/.test(file) && !file.endsWith('.test.ts')) {
        const content = readFileSync(file, 'utf8');
        assert.doesNotMatch(content, /(?:from|import|require)\s*\(?\s*['"][^'"]*(?:tests\/fixtures|demo-provider|demo-catalog|trusted-programs\.json)/, file);
        assert.doesNotMatch(content, /on(?:Click|Submit)=\{\(\)\s*=>\s*\{\s*\}\}|href=['"]javascript:|href=['"]#['"]\s*\/>/, file);
      }
    }
  }
  visit(path.join(root, 'miniapp')); visit(path.join(root, 'chatbot'));
});
