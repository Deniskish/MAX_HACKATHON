// Run on the production host under flock. Build first; switch only verified artifacts.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const artifacts = ['miniapp/node_modules', 'miniapp/dist', 'miniapp/api-server/node_modules',
  'miniapp/api-server/dist', 'chatbot/node_modules', 'chatbot/dist'];
const names = ['opora-frontend', 'opora-api', 'opora-bot'];

function switchArtifacts(root, stage, backup, state) {
  for (const relative of artifacts) {
    const target = path.join(root, relative), saved = path.join(backup, relative);
    fs.mkdirSync(path.dirname(saved), { recursive: true });
    const entry = { relative, saved: false, installed: false };
    state.push(entry);
    if (fs.existsSync(target)) { fs.renameSync(target, saved); entry.saved = true; }
    fs.renameSync(path.join(stage, relative), target);
    entry.installed = true;
  }
}

function restoreArtifacts(root, backup, state) {
  for (const entry of [...state].reverse()) {
    const target = path.join(root, entry.relative);
    if (entry.installed) fs.rmSync(target, { recursive: true, force: true });
    if (entry.saved) fs.renameSync(path.join(backup, entry.relative), target);
  }
}

// Kept separate so failure and rollback ordering are tested without touching PM2.
async function activateRelease({ switchCode, switchFiles, restart, verify, save, restoreFiles, restoreCode, restartPrevious, verifyPrevious }) {
  try {
    switchCode(); switchFiles(); restart();
    await verify(); save();
  } catch (error) {
    console.error('Release failed; restoring the previous version.');
    try {
      restoreFiles(); restoreCode(); restartPrevious(); await verifyPrevious(); save();
    } catch (rollbackError) {
      throw new Error('ROLLBACK_FAILED: keep the deployment backup and inspect the server', { cause: rollbackError });
    }
    throw new Error('DEPLOY_FAILED_ROLLED_BACK', { cause: error });
  }
}

function shouldSkip(current, target, isAncestor) {
  return current !== target && isAncestor(target, current);
}

async function main(root, sha) {
  if (root !== '/opt/app' || !/^[a-f0-9]{40}$/.test(sha || '')) throw new Error('INVALID_DEPLOY_ARGUMENTS');
  const run = (cmd, args, options = {}) => execFileSync(cmd, args, {
    cwd: root, stdio: 'inherit', timeout: 300000, ...options,
  });
  const git = (...args) => run('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  run('git', ['fetch', 'origin', 'main']);
  if (git('rev-parse', `${sha}^{commit}`) !== sha) throw new Error('COMMIT_NOT_FOUND');
  const isAncestor = (a, b) => {
    try { git('merge-base', '--is-ancestor', a, b); return true; }
    catch (error) { if (error.status === 1) return false; throw error; }
  };
  if (!isAncestor(sha, 'origin/main')) throw new Error('COMMIT_NOT_ON_MAIN');
  const previous = git('rev-parse', 'HEAD');
  if (shouldSkip(previous, sha, isAncestor)) {
    console.log('SKIPPED: a newer commit is already installed.');
    process.exitCode = 3;
    return;
  }
  if (git('status', '--porcelain', '--untracked-files=no')) throw new Error('SERVER_HAS_TRACKED_CHANGES');
  const work = fs.mkdtempSync('/opt/opora-deploy/release-');
  fs.chmodSync(work, 0o700);
  const stage = path.join(work, 'stage'), backup = path.join(work, 'backup');
  fs.mkdirSync(stage); fs.mkdirSync(backup);
  let retainBackup = false;
  try {
    console.log(`Building commit ${sha} without changing the running application.`);
    run('git', ['archive', '--format=tar', '--output', path.join(work, 'source.tar'), sha]);
    run('tar', ['-xf', path.join(work, 'source.tar'), '-C', stage]);
    for (const prefix of ['miniapp', 'miniapp/api-server', 'chatbot']) {
      run('npm', ['ci', '--prefix', prefix, '--no-audit', '--no-fund'], { cwd: stage });
    }
    run(process.execPath, ['--test', 'ops/deploy.test.cjs'], { cwd: stage });
    run('npm', ['run', 'test:production', '--prefix', 'miniapp'], { cwd: stage });
    run('npm', ['test', '--prefix', 'miniapp'], { cwd: stage });
    run('npm', ['test', '--prefix', 'miniapp/api-server'], { cwd: stage });
    for (const prefix of ['miniapp', 'miniapp/api-server', 'chatbot']) {
      run('npm', ['run', 'build', '--prefix', prefix], { cwd: stage });
    }
    // Retain content-addressed files needed by tabs opened before this deployment.
    const oldAssets = path.join(root, 'miniapp/dist/assets');
    if (fs.existsSync(oldAssets)) fs.cpSync(oldAssets, path.join(stage, 'miniapp/dist/assets'), { recursive: true, force: false });
    fs.writeFileSync(path.join(stage, 'miniapp/dist/version.json'), JSON.stringify({ revision: sha }) + '\n');
    const snapshot = JSON.parse(run('pm2', ['jlist'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }))
      .filter(p => names.includes(p.name));
    if (!snapshot.some(p => p.name === 'opora-api')) throw new Error('RUNNING_API_REQUIRED');
    fs.writeFileSync(path.join(backup, 'pm2.json'), JSON.stringify(snapshot), { mode: 0o600 });
    fs.writeFileSync(path.join(backup, 'revision'), previous);
    const previousVersion = path.join(root, 'miniapp/dist/version.json');
    const previousRevision = fs.existsSync(previousVersion) ? JSON.parse(fs.readFileSync(previousVersion)).revision : undefined;
    const apiEnv = snapshot.find(p => p.name === 'opora-api').pm2_env;
    const secretNames = ['GIGACHAT_AUTH_KEY', 'GIGACHAT_SCOPE', 'GIGACHAT_MODEL', 'NODE_EXTRA_CA_CERTS', 'NODE_OPTIONS',
      'DADATA_API_KEY', 'APP_ORIGIN', 'OPORA_SOURCE_DIR', 'FNS_DATA_DIR', 'AI_SOURCE_SYNC', 'BOT_TOKEN',
      'MINIAPP_URL', 'MAX_BOT_USERNAME', 'OPORA_FUNDING_DIR', 'FUNDING_SYNC'];
    const retainedEnv = {};
    for (const key of secretNames) {
      const value = apiEnv[key] ?? apiEnv.env?.[key];
      if (typeof value === 'string') retainedEnv[key] = value;
    }
    const hasBot = snapshot.some(p => p.name === 'opora-bot');
    const restart = revision => {
      const list = JSON.parse(run('pm2', ['jlist'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
      if (list.some(p => p.name === 'opora-frontend')) run('pm2', ['delete', 'opora-frontend']);
      run('pm2', ['start', 'ecosystem.config.cjs', '--only', 'opora-frontend']);
      run(process.execPath, ['miniapp/scripts/restart-api.cjs'], {
        env: { ...process.env, ...retainedEnv, OPORA_RELEASE_SHA: revision || '' },
      });
      if (hasBot) run('pm2', ['restart', 'opora-bot']);
    };
    const verify = async revision => {
      let ready = false;
      for (let attempt = 0; attempt < 20; attempt++) {
        try {
          const response = await fetch('http://127.0.0.1:3002/api/health', { signal: AbortSignal.timeout(3000) });
          const body = await response.json();
          if (response.ok && body.status === 'ok' && (!revision || body.revision === revision)) { ready = true; break; }
        } catch { /* bounded startup retry */ }
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
      if (!ready) throw new Error('API_READINESS_FAILED');
      run(process.execPath, ['miniapp/scripts/check-production.cjs'], {
        env: { ...process.env, EXPECTED_RELEASE_SHA: revision || '' }, timeout: 90000,
      });
      // Catch crash loops, including an already configured bot that fails after restart.
      await new Promise(resolve => setTimeout(resolve, 5000));
      const list = JSON.parse(run('pm2', ['jlist'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
      for (const name of names.filter(n => n !== 'opora-bot' || hasBot)) {
        const p = list.find(p => p.name === name)?.pm2_env;
        if (p?.status !== 'online' || Date.now() - p.pm_uptime < 4500) throw new Error(`PROCESS_UNSTABLE: ${name}`);
      }
    };
    const state = [];
    retainBackup = true;
    await activateRelease({
      switchCode: () => run('git', ['reset', '--hard', sha]),
      switchFiles: () => switchArtifacts(root, stage, backup, state),
      restart: () => restart(sha), verify: () => verify(sha), save: () => run('pm2', ['save']),
      restoreFiles: () => restoreArtifacts(root, backup, state),
      restoreCode: () => run('git', ['reset', '--hard', previous]),
      restartPrevious: () => restart(previousRevision), verifyPrevious: () => verify(previousRevision),
    });
    retainBackup = false;
    console.log(`DEPLOYED: ${sha}. Application checks passed.`);
  } finally {
    if (retainBackup) console.error(`Recovery files retained at ${backup} (private; contains process credentials).`);
    else fs.rmSync(work, { recursive: true, force: true });
  }
}

module.exports = { artifacts, switchArtifacts, restoreArtifacts, activateRelease, shouldSkip };
if (require.main === module) main(process.argv[2], process.argv[3]).catch(error => {
  // exec errors can contain environment values: emit only our error code, never the PM2 snapshot.
  console.error(/^[A-Z_]+(?:[: ].*)?$/.test(error.message) ? error.message : 'DEPLOY_COMMAND_FAILED (see the preceding step)');
  process.exitCode = 1;
});
