// Read-only runtime diagnostics: no messages, updates, secrets or user data printed.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const root = '/opt/app';
const processes = JSON.parse(execFileSync('pm2', ['jlist'], { encoding: 'utf8' }));
if (!process.env.OPORA_BOT_DIAG_CHILD) {
  const api = processes.find(p => p.name === 'opora-api')?.pm2_env;
  const runtime = { ...process.env, OPORA_BOT_DIAG_CHILD: '1' };
  for (const key of ['NODE_EXTRA_CA_CERTS', 'NODE_OPTIONS']) {
    const value = api?.[key] ?? api?.env?.[key];
    if (typeof value === 'string') runtime[key] = value;
  }
  console.log('TLS configuration:', JSON.stringify({ extraCerts: !!runtime.NODE_EXTRA_CA_CERTS, relativeCertPath: runtime.NODE_EXTRA_CA_CERTS ? !path.isAbsolute(runtime.NODE_EXTRA_CA_CERTS) : false }));
  const child = require('node:child_process').spawnSync(process.execPath, [__filename], { cwd: path.join(root, 'chatbot'), env: runtime, stdio: 'inherit', timeout: 60000 });
  process.exit(child.status ?? 1);
}
console.log('Processes:', JSON.stringify(processes.filter(p => /^opora-/.test(p.name)).map(p => ({ name: p.name, status: p.pm2_env.status, pid: p.pid, restarts: p.pm2_env.restart_time }))));
try {
  const h = JSON.parse(fs.readFileSync('/opt/opora-deploy/bot-health.json', 'utf8'));
  console.log('Bot health:', JSON.stringify({ pid: h.pid, revision: h.revision, polledAt: h.polledAt }));
} catch { console.log('Bot health: absent'); }
const log = path.join(os.homedir(), '.pm2/logs/opora-bot-error.log');
if (fs.existsSync(log)) {
  const text = fs.readFileSync(log, 'utf8').slice(-50000);
  const markers = ['Не удалось запустить', 'Unhandled error while polling', 'Failed to fetch bot info', 'BOT_AUTH_REQUIRED', 'API_UNAVAILABLE', 'ECONNREFUSED', 'ENOTFOUND', 'fetch failed', 'unauthorized', 'forbidden', 'not.found', 'invalid', 'timeout'];
  console.log('Bot log categories:', JSON.stringify(markers.filter(v => text.includes(v))));
  console.log('Bot log codes:', JSON.stringify([...new Set([...text.matchAll(/(?:code|status):\s*['"]?([a-z_.]{2,40}|\d{3})/g)].map(m => m[1]))]));
}
const env = {};
for (const name of ['opora-api', 'opora-bot']) {
  const p = processes.find(p => p.name === name)?.pm2_env;
  for (const key of ['BOT_TOKEN', 'BOT_API_URL']) if (p?.[key] || p?.env?.[key]) env[key] = p[key] || p.env[key];
}
const dotenv = require(path.join(root, 'miniapp/api-server/node_modules/dotenv'));
dotenv.config({ path: path.join(root, '.env'), processEnv: env, quiet: true });
dotenv.config({ path: path.join(root, 'chatbot/.env'), processEnv: env, quiet: true });
dotenv.config({ path: path.join(root, '.env.bot'), processEnv: env, override: true, quiet: true });
(async () => {
  if (!env.BOT_TOKEN) throw Error('TOKEN_ABSENT');
  let user;
  for (const route of ['/me', '/subscriptions']) {
    const res = await fetch('https://platform-api2.max.ru' + route, { headers: { Authorization: env.BOT_TOKEN }, signal: AbortSignal.timeout(15000), redirect: 'error' });
    const body = await res.json();
    console.log('MAX endpoint:', JSON.stringify({ route, status: res.status, code: /^[a-z_.]{1,40}$/.test(body.code || '') ? body.code : undefined, subscriptions: Array.isArray(body.subscriptions) ? body.subscriptions.length : undefined }));
    if (route === '/me' && res.ok) user = body.user_id;
  }
  if (user) {
    const { OporaAPI } = require(path.join(root, 'chatbot/dist/api-client'));
    await new OporaAPI(env.BOT_API_URL || 'http://127.0.0.1:3002', env.BOT_TOKEN, String(user)).request('GET', '/api/bot/workspace');
    console.log('Signed bot API: success');
  }
})().catch(error => {
  const code = v => /^[A-Z_]{1,50}$/.test(v || '') ? v : undefined;
  console.log('Diagnostic failure:', JSON.stringify({ type: error.name, status: error.status, code: code(error.code), cause: code(error.cause?.code), causes: error.cause?.errors?.map(e => code(e.code)), messageCategory: ['fetch failed','Invalid character in header content','bad port'].find(v => error.message?.includes(v)) }));
  process.exitCode = 1;
});
