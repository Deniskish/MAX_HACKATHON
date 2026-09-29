import type { AITask } from './types';

export const conversationalTasks = new Set<AITask>(['chat', 'intake', 'search', 'analysis', 'strategy', 'changes']);
const leadingEmoji = /^(?:\p{Extended_Pictographic}[\uFE0F\u200D\p{Emoji_Modifier}\p{Extended_Pictographic}]*\s*)+/u;
function paragraphEmoji(text: string) {
  if (/неизвест|не подтверж|уточн|проверь|огранич|недоступ|не выполн|риск|не подход/i.test(text)) return '⚠️';
  if (/следующ|шаг|начните|перейдите/i.test(text)) return '➡️';
  if (/документ|заявк|черновик/i.test(text)) return '📄';
  if (/сумм|бюджет|финанс|рубл/i.test(text)) return '💰';
  if (/подходит|соответствует|подтверждено|подтверждён/i.test(text)) return '✅';
  return '💡';
}
/** Presentation only: never run this over drafts, document text or evidence. */
export function conversationalAnswer(task: AITask, answer: string): string {
  if (!conversationalTasks.has(task)) return answer;
  const plain = answer.replace(/^[ \t]*```(?:[a-z\d_-]+)?[ \t]*$/gm, '')
    .replace(/<\/?[a-z][^>]*>/gi, '')
    .replace(/!?(\[([^\]]+)\])\((https?:\/\/[^\s)]+)\)/g, '$2 ($3)')
    .replace(/^\s{0,3}(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s*)/gm, '')
    .replace(/\*\*|__/g, '')
    .replace(/(^|[\s(])[*_]([^\n*_]+)[*_](?=$|[\s.,!?;:)])/gm, '$1$2')
    .replace(/`{1,3}([^`\n]+)`{1,3}/g, '$1');
  const paragraphs = plain.split(/\n+/).map(p => p.trim()).filter(Boolean);
  // Preserve every sentence; combine overflow rather than truncating the response.
  const grouped = paragraphs.length > 5 ? [...paragraphs.slice(0, 4), paragraphs.slice(4).join(' ')] : paragraphs;
  return grouped.map(p => {
    const existing = p.match(leadingEmoji)?.[0].trim();
    const text = p.replace(leadingEmoji, '').trim();
    // Keep one existing emoji (including its variation selector), not a row of icons.
    const emoji = existing?.match(/^\p{Extended_Pictographic}\uFE0F?/u)?.[0] ?? paragraphEmoji(text);
    return text ? `${emoji} ${text}` : '';
  }).filter(Boolean).join('\n\n');
}
