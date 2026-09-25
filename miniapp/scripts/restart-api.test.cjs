const test = require('node:test');
const assert = require('node:assert/strict');
const { restartApi } = require('./restart-api.cjs');
test('replace a shell launcher with compiled API and preserve TLS/provider settings', () => {
  const calls = [];
  let verified = false;
  restartApi((file, args, options) => {
    assert.equal(file, 'pm2');
    calls.push(args[0]);
    if (args[0] === 'jlist') return JSON.stringify([{ name: 'opora-api', pm2_env: { pm_exec_path: '/bin/bash', GIGACHAT_AUTH_KEY: 'test-key', NODE_EXTRA_CA_CERTS: '/certs/ca.pem', OPORA_SOURCE_DIR: '/sources' } }]);
    assert.equal(verified, true);
    if (args[0] === 'start') {
      assert.match(args[1], /dist[/\\]server\.js$/);
      assert.equal(options.env.GIGACHAT_AUTH_KEY, 'test-key');
      assert.equal(options.env.NODE_EXTRA_CA_CERTS, '/certs/ca.pem');
      assert.equal(options.env.OPORA_SOURCE_DIR, '/sources');
      assert.equal(options.env.PORT, '3002');
      assert.ok(!args.join(' ').includes('test-key'));
    }
  }, () => { verified = true; });
  assert.deepEqual(calls, ['jlist', 'delete', 'start']);
});
test('missing build never stops the running API', () => {
  const calls = [];
  assert.throws(() => restartApi((_file, args) => { calls.push(args[0]); return '[{"name":"opora-api","pm2_env":{}}]'; }, () => { throw new Error('missing build'); }), /missing build/);
  assert.deepEqual(calls, ['jlist']);
});
