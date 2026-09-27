import { Keyboard, type Context } from '@maxhub/max-bot-api';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { OporaAPI } from './api-client';
import { Conversation, type Reply } from './conversation';

export function splitText(text: string, size = 3000): string[] {
  const chunks: string[] = [];
  while (text.length > size) {
    const lastBreak = text.lastIndexOf('\n', size);
    let end = lastBreak > size / 2 ? lastBreak : size;
    if (/[\uD800-\uDBFF]/.test(text[end - 1])) end--;
    chunks.push(text.slice(0, end)); text = text.slice(end).trimStart();
  }
  if (text) chunks.push(text);
  return chunks;
}
export async function deliver(ctx: Context, user: number, result: Reply) {
  const keyboard = Keyboard.inlineKeyboard(result.buttons.map(row => row.map(b => b.url
    ? Keyboard.button.link(b.text, b.url) : Keyboard.button.callback(b.text, b.action!))));
  const chunks = splitText(result.text);
  for (let i = 0; i < chunks.length; i++) await ctx.api.sendMessageToUser(user, chunks[i], i === chunks.length - 1 ? { attachments: [keyboard] } : {});
  if (result.file) {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'opora-bot-'));
    try {
      const file = path.join(dir, 'opora-draft.txt');
      await writeFile(file, result.file.text, { mode: 0o600 });
      const uploaded = await ctx.api.uploadFile({ source: file, timeout: 30000 });
      await ctx.api.sendMessageToUser(user, 'Черновик проекта', { attachments: [uploaded.toJson()] });
    } finally { await rm(dir, { recursive: true, force: true }); }
  }
}
export function createHandler(token: string, apiUrl: string, appUrl: string) {
  const queues = new Map<number, { tail: Promise<void>; count: number }>();
  return async (ctx: Context) => {
    const user = ctx.user?.user_id;
    if (!user || !Number.isSafeInteger(user) || user <= 0 || ctx.user?.is_bot) return;
    // Never expose account details in groups or accept callbacks forwarded there.
    if (ctx.message && ctx.message.recipient.chat_type !== 'dialog') return;
    if (ctx.callback) await ctx.answerOnCallback({}).catch(() => {});
    const current = queues.get(user);
    if ((current?.count ?? 0) >= 3 || (!current && queues.size >= 100)) {
      await ctx.api.sendMessageToUser(user, 'Предыдущее действие ещё выполняется. Подождите немного.'); return;
    }
    const entry = current ?? { tail: Promise.resolve(), count: 0 };
    entry.count++; queues.set(user, entry);
    const run = entry.tail.catch(() => {}).then(async () => {
      const input = ctx.callback ? { id: 'callback:' + ctx.callback.callback_id, action: ctx.callback.payload || 'menu' }
        : ctx.message ? { id: 'message:' + ctx.message.body.mid, text: ctx.message.body.text || '' }
        : { id: 'start:' + ctx.update.timestamp, text: '/start' };
      const typing = () => { if (ctx.chatId) void ctx.sendAction('typing_on').catch(() => {}); };
      typing(); const interval = setInterval(typing, 12000);
      try {
        const result = await new Conversation(new OporaAPI(apiUrl, token, String(user)), appUrl).handle(input);
        if (result) await deliver(ctx, user, result);
      } catch {
        console.error('Bot conversation incomplete');
        await ctx.api.sendMessageToUser(user, 'Действие пока не завершено. Повторите сообщение или откройте /start.');
      } finally { clearInterval(interval); }
    });
    entry.tail = run;
    try { await run; } finally { if (--entry.count === 0) queues.delete(user); }
  };
}
