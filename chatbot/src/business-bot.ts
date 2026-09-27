import { Bot } from '@maxhub/max-bot-api';
import { config } from 'dotenv';
import path from 'node:path';
import { writeFileSync, renameSync } from 'node:fs';
import { createHandler } from './transport';
import { OporaAPI } from './api-client';
import { waitForAPI } from './startup';
config({ path: path.resolve(process.cwd(), '../.env'), quiet: true });
config({ quiet: true });
config({ path: path.resolve(process.cwd(), '../.env.bot'), override: true, quiet: true });
const token = process.env.BOT_TOKEN;
const url = process.env.MINIAPP_URL;
if (!token) throw new Error('Задайте BOT_TOKEN в .env');
if (!url || !url.startsWith('https://'))
  throw new Error('Задайте публичный HTTPS-адрес MINIAPP_URL в .env');
const bot = new Bot(token, { clientOptions: { baseUrl: 'https://platform-api2.max.ru' } });
const handle = createHandler(token, process.env.BOT_API_URL || 'http://127.0.0.1:3002', url);
bot.on('bot_started', handle);
bot.on('message_created', handle);
bot.on('message_callback', handle);
bot.on('bot_stopped', async ctx => {
  const user = ctx.user?.user_id;
  if (user && Number.isSafeInteger(user) && user > 0)
    await new OporaAPI(process.env.BOT_API_URL || 'http://127.0.0.1:3002', token, String(user))
      .request('DELETE', '/api/notifications/subscription');
});
bot.catch(() => console.error('MAX update failed'));
// A running process alone does not prove MAX updates reach it. Publish readiness
// only after the shared API accepts our signature and MAX returns an update batch.
const getUpdates = bot.api.getUpdates.bind(bot.api);
function health(data: Record<string, unknown>) {
  const file = process.env.OPORA_BOT_HEALTH_FILE;
  if (!file) return;
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify({ pid: process.pid, revision: process.env.OPORA_RELEASE_SHA, ...data }), { mode: 0o600 });
  renameSync(temp, file);
}
bot.api.getUpdates = async (...args) => {
  const result = await getUpdates(...args);
  health({ phase: 'polling', polledAt: Date.now() });
  return result;
};
let phase = 'max_identity';
async function start() {
  health({ phase });
  const identity = await bot.api.getMyInfo();
  phase = 'shared_api'; health({ phase });
  await waitForAPI(new OporaAPI(process.env.BOT_API_URL || 'http://127.0.0.1:3002', token!, String(identity.user_id)));
  phase = 'max_polling'; health({ phase });
  await bot.start();
}
start().catch(error => {
  const code = error.cause?.code || error.code;
  const diagnostic = { phase: 'failed', failedAt: phase, code: /^[A-Z_]{1,50}$/.test(code || '') ? code : 'STARTUP_FAILED', status: Number.isInteger(error.status) ? error.status : undefined };
  try { health(diagnostic); } catch { /* report to stderr if health storage fails */ }
  console.error('Bot startup:', JSON.stringify(diagnostic));
  console.error('Не удалось запустить бота MAX. Проверьте токен и соединение.');
  process.exit(1);
});
