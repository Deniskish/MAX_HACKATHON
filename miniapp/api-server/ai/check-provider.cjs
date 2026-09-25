// Match the running API's TLS/provider settings without printing its environment.
const { execFileSync, spawnSync } = require('node:child_process');
const path = require('node:path');
const processes = JSON.parse(execFileSync('pm2', ['jlist'], { encoding: 'utf8' }));
const api = processes.find((process) => process.name === 'opora-api')?.pm2_env;
if (!api) throw new Error('API_PROCESS_NOT_FOUND');
console.log('AI runtime:', JSON.stringify({ script: api.pm_exec_path, cwd: api.pm_cwd, interpreter: api.exec_interpreter, extraCA: Boolean(api.NODE_EXTRA_CA_CERTS), nodeOptions: Boolean(api.NODE_OPTIONS) }));
const env = { ...process.env };
for (const name of ['GIGACHAT_AUTH_KEY', 'GIGACHAT_SCOPE', 'GIGACHAT_MODEL', 'NODE_EXTRA_CA_CERTS', 'NODE_OPTIONS']) {
  if (typeof api[name] === 'string') env[name] = api[name];
}
const result = spawnSync(process.execPath, ['--import', 'tsx', path.join(__dirname, 'check-provider.ts')], { cwd: path.resolve(__dirname, '..'), env, stdio: 'inherit' });
process.exitCode = result.status ?? 1;
