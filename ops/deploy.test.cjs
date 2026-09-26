const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { artifacts, switchArtifacts, restoreArtifacts, activateRelease, shouldSkip } = require('./deploy.cjs');

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
