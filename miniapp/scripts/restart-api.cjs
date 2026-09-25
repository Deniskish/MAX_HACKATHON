// Replace legacy shell launchers while retaining application credentials and TLS settings.
const { execFileSync } = require('node:child_process');
const path = require('node:path');
function restartApi(run = execFileSync, access = require('node:fs').accessSync) {
const processes = JSON.parse(run('pm2', ['jlist'], { encoding: 'utf8' }));
const previous = processes.find((process) => process.name === 'opora-api')?.pm2_env;
const env = { ...process.env, NODE_ENV: 'production' };
const names = ['GIGACHAT_AUTH_KEY', 'GIGACHAT_SCOPE', 'GIGACHAT_MODEL', 'NODE_EXTRA_CA_CERTS', 'NODE_OPTIONS', 'DADATA_API_KEY', 'APP_ORIGIN', 'OPORA_SOURCE_DIR', 'FNS_DATA_DIR', 'AI_SOURCE_SYNC'];
for (const name of names) {
  const value = previous?.[name] ?? previous?.env?.[name];
  if (typeof value === 'string') env[name] = value;
}
env.PORT = '3002';
const cwd = path.resolve(__dirname, '../api-server');
access(path.join(cwd, 'dist/server.js'));
if (previous) run('pm2', ['delete', 'opora-api'], { stdio: 'inherit' });
run('pm2', ['start', path.join(cwd, 'dist/server.js'), '--name', 'opora-api', '--cwd', cwd, '--interpreter', process.execPath], { env, stdio: 'inherit' });
}
module.exports = { restartApi };
if (require.main === module) restartApi();
