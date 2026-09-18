// Бот открывает мини-приложение и по команде показывает учебное уведомление.
import { Bot, Keyboard } from '@maxhub/max-bot-api';
import { config } from 'dotenv';
import path from 'node:path';
config({ path: path.resolve(process.cwd(), '../.env') });
config();
const token = process.env.BOT_TOKEN;
const url = process.env.MINIAPP_URL;
if (!token) throw new Error('Задайте BOT_TOKEN в .env');
if (!url || !url.startsWith('https://'))
  throw new Error('Задайте публичный HTTPS-адрес MINIAPP_URL в .env');
const bot = new Bot(token, { clientOptions: { baseUrl: 'https://platform-api2.max.ru' } });
const welcome =
  'Опора — ваш помощник по государственной поддержке бизнеса.\n\nУкажите ИНН, заполните профиль и получите до пяти приоритетных возможностей с объяснениями и планом подготовки.\n\nКоманда /demo показывает пример уведомления для учебного профиля.\n\nЭто прототип: программы учебные, реестры и фоновый мониторинг пока не подключены. Профиль сохраняется в браузере мини-приложения.';
const botName = process.env.MAX_BOT_USERNAME?.replace(/^@/, '');
const launchUrl = botName ? `https://max.ru/${encodeURIComponent(botName)}?startapp` : url;
const keyboard = Keyboard.inlineKeyboard([[Keyboard.button.link('Открыть Опору', launchUrl)]]);
bot.on('bot_started', async (ctx) => {
  await ctx.reply(welcome, { attachments: [keyboard] });
});
bot.on('message_created', async (ctx) => {
  const text = ctx.message?.body.text?.trim() || '';
  if (text === '/demo') {
    try {
      const response = await fetch(
        new URL('/api/demo-notification', process.env.OPORA_API_URL || 'http://localhost:3002'),
        { signal: AbortSignal.timeout(5000), redirect: 'error' },
      );
      if (!response.ok) throw new Error('unavailable');
      const data = (await response.json()) as { programId?: unknown; text?: unknown };
      if (
        typeof data.programId !== 'string' ||
        !/^[a-z-]{1,50}$/.test(data.programId) ||
        typeof data.text !== 'string' ||
        data.text.length > 3500
      )
        throw new Error('invalid');
      const direct = new URL(url);
      direct.searchParams.set('program', data.programId);
      const destination = botName
        ? `https://max.ru/${encodeURIComponent(botName)}?startapp=${encodeURIComponent(data.programId)}`
        : direct.toString();
      await ctx.reply(data.text, {
        attachments: [
          Keyboard.inlineKeyboard([[Keyboard.button.link('Посмотреть условия', destination)]]),
        ],
      });
    } catch {
      await ctx.reply(
        'Учебное уведомление сейчас недоступно. Проверьте API Опоры или откройте предпросмотр в мини-приложении.',
        { attachments: [keyboard] },
      );
    }
    return;
  }
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
