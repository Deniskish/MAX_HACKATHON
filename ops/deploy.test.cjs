const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { artifacts, switchArtifacts, restoreArtifacts, activateRelease, shouldSkip, restartBot, botReady } = require('./deploy.cjs');

test('deployment creates a missing bot and replaces stale entrypoints; rollback removes a newly introduced bot', () => {
  for (const existing of [false, true]) {
    const calls = [];
    const run = (cmd, args, options) => { calls.push({ cmd, args, options }); return JSON.stringify(existing ? [{ name: 'opora-bot' }] : []); };
    restartBot(run, '/opt/app', true, { BOT_TOKEN: 'test' });
    assert.equal(calls.some(c => c.args[0] === 'delete'), existing);
    const start = calls.find(c => c.args[0] === 'start');
    assert.equal(start.args[1], path.join('/opt/app', 'chatbot/dist/bot.js'));
    assert.equal(start.args[start.args.indexOf('--cwd') + 1], path.join('/opt/app', 'chatbot'));
    assert.equal(start.options.env.BOT_TOKEN, 'test');
    calls.length = 0;
    restartBot(run, '/opt/app', false, {});
    assert.equal(calls.some(c => c.args[0] === 'start'), false);
  }
});

test('bot readiness requires the current process, revision and a recent successful MAX poll', () => {
  const processes = [{ name: 'opora-bot', pid: 42, pm2_env: { status: 'online' } }];
  const health = { pid: 42, revision: 'new', polledAt: 1000 };
  assert.equal(botReady(processes, health, 'new', 2000), true);
  assert.equal(botReady([], health, 'new', 2000), false);
  assert.equal(botReady(processes, { ...health, pid: 41 }, 'new', 2000), false);
  assert.equal(botReady(processes, health, 'other', 2000), false);
  assert.equal(botReady(processes, health, 'new', 100000), false);
  assert.equal(botReady(processes, undefined, 'new', 2000), false);
});

test('older queued commits never replace a newer release; reruns of the same commit are allowed', () => {
  assert.equal(shouldSkip('new', 'old', (a, b) => a === 'old' && b === 'new'), true);
  assert.equal(shouldSkip('same', 'same', () => true), false);
  assert.equal(shouldSkip('old', 'new', () => false), false);
});

for (const failure of ['none', 'switchCode', 'switchFiles', 'restart', 'verify', 'save']) {
  test(`deployment transaction: ${failure}`, async () => {
    const calls = [], hooks = {};
    let failedOnce = false;
    for (const name of ['switchCode', 'switchFiles', 'restart', 'verify', 'save', 'restoreFiles', 'restoreCode', 'restartPrevious', 'verifyPrevious']) {
      hooks[name] = () => { calls.push(name); if (name === failure && !failedOnce) { failedOnce = true; throw new Error('injected'); } };
    }
    if (failure === 'none') {
      await activateRelease(hooks);
      assert.deepEqual(calls, ['switchCode', 'switchFiles', 'restart', 'verify', 'save']);
    } else {
      await assert.rejects(activateRelease(hooks), /DEPLOY_FAILED_ROLLED_BACK/);
      assert.deepEqual(calls.slice(-5), ['restoreFiles', 'restoreCode', 'restartPrevious', 'verifyPrevious', 'save']);
    }
  });
}

test('rollback failure is explicit, never reported as a successful deployment', async () => {
  const noop = () => {};
  await assert.rejects(activateRelease({ switchCode: noop, switchFiles: noop, restart: () => { throw Error('start'); },
    restoreFiles: () => { throw Error('disk'); } }), /ROLLBACK_FAILED/);
});

for (const partial of [false, true]) {
  test(`artifact rollback preserves original files and user data (partial=${partial})`, () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'opora-deploy-test-'));
    const root = path.join(temp, 'app'), stage = path.join(temp, 'stage'), backup = path.join(temp, 'backup'), state = [];
    try {
      for (const relative of artifacts) {
        for (const [base, value] of [[root, 'old'], [stage, 'new']]) {
          if (partial && base === stage && relative === artifacts[2]) continue;
          fs.mkdirSync(path.join(base, relative), { recursive: true });
          fs.writeFileSync(path.join(base, relative, 'file'), value);
        }
      }
      fs.mkdirSync(path.join(root, 'miniapp/api-server/source-data'), { recursive: true });
      const database = path.join(root, 'miniapp/api-server/source-data/accounts.sqlite');
      fs.writeFileSync(database, 'do not touch');
      fs.writeFileSync(path.join(root, '.env'), 'private');
      if (partial) assert.throws(() => switchArtifacts(root, stage, backup, state));
      else { switchArtifacts(root, stage, backup, state); assert.equal(fs.readFileSync(path.join(root, artifacts[0], 'file'), 'utf8'), 'new'); }
      restoreArtifacts(root, backup, state);
      for (const relative of artifacts) assert.equal(fs.readFileSync(path.join(root, relative, 'file'), 'utf8'), 'old');
      assert.equal(fs.readFileSync(database, 'utf8'), 'do not touch');
      assert.equal(fs.readFileSync(path.join(root, '.env'), 'utf8'), 'private');
    } finally { fs.rmSync(temp, { recursive: true, force: true }); }
  });
}
