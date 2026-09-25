const path = require('node:path');
module.exports = { apps: [{
  name: 'opora-frontend',
  cwd: path.join(__dirname, 'miniapp'),
  script: path.join(__dirname, 'miniapp/scripts/serve.cjs'),
  env: { NODE_ENV: 'production', HOST: '127.0.0.1', PORT: '3000' },
  wait_ready: true,
  listen_timeout: 10000,
  kill_timeout: 6000,
}] };
