// MAX launch and help; no personal notifications without verified user binding.
import { Bot, Keyboard } from '@maxhub/max-bot-api';
import { config } from 'dotenv';
import path from 'node:path';
config({ path: path.resolve(process.cwd(), '../.env') });
config();
config({ path: path.resolve(process.cwd(), '../.env.bot'), override: true, quiet: true });
const token = process.env.BOT_TOKEN;
const url = process.env.MINIAPP_URL;
if (!token) throw new Error('Задайте BOT_TOKEN в .env');
if (!url || !url.startsWith('https://'))
  throw new Error('Задайте публичный HTTPS-адрес MINIAPP_URL в .env');
const bot = new Bot(token, { clientOptions: { baseUrl: 'https://platform-api2.max.ru' } });
const welcome =
  'Опора — поддержка и финансирование бизнеса по официальным источникам.\n\nДобавьте бизнес или проект, укажите цель и сравните варианты. В разделе «Мой бизнес» можно включить уведомления о новых мерах — они придут сюда, даже если приложение закрыто.\n\n/start — открыть Опору\n/help — помощь\n\nДля уведомлений на сервере сохраняются параметры подбора. Документы и черновики остаются на вашем устройстве. Заявки автоматически не подаются.';
const botName = process.env.MAX_BOT_USERNAME?.replace(/^@/, '');
const launchUrl = botName ? `https://max.ru/${encodeURIComponent(botName)}?startapp` : url;
const keyboard = Keyboard.inlineKeyboard([[Keyboard.button.link('Открыть Опору', launchUrl)]]);
bot.on('bot_started', async (ctx) => {
  await ctx.reply(welcome, { attachments: [keyboard] });
});
bot.on('message_created', async (ctx) => {
  const text = ctx.message?.body.text?.trim() || '';
  await ctx.reply(
    /^\d{10}(\d{2})?$/.test(text)
      ? 'Введите этот ИНН в профиле мини-приложения. Данные компании здесь не проверяются и не сохраняются.'
      : welcome,
    { attachments: [keyboard] },
  );
});
bot.catch(() => console.error('MAX update failed'));
bot.start().catch(() => {
  console.error('Не удалось запустить бота MAX. Проверьте токен и соединение.');
  process.exitCode = 1;
});
