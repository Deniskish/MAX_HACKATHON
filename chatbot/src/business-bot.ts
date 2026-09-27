import { Bot } from '@maxhub/max-bot-api';
import { config } from 'dotenv';
import path from 'node:path';
import { writeFileSync, renameSync } from 'node:fs';
import { createHandler } from './transport';
import { OporaAPI } from './api-client';
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
bot.api.getUpdates = async (...args) => {
  const result = await getUpdates(...args);
  const file = process.env.OPORA_BOT_HEALTH_FILE;
  if (file) {
    const temp = `${file}.${process.pid}.tmp`;
    writeFileSync(temp, JSON.stringify({ pid: process.pid, revision: process.env.OPORA_RELEASE_SHA, polledAt: Date.now() }), { mode: 0o600 });
    renameSync(temp, file);
  }
  return result;
};
async function start() {
  const identity = await bot.api.getMyInfo();
  await new OporaAPI(process.env.BOT_API_URL || 'http://127.0.0.1:3002', token!, String(identity.user_id))
    .request('GET', '/api/bot/workspace');
  await bot.start();
}
start().catch(() => {
  console.error('Не удалось запустить бота MAX. Проверьте токен и соединение.');
  process.exitCode = 1;
});
