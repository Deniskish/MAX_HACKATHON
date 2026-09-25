import type { AIRequest, AIResult, AIMessage } from '../../api-server/ai/types';
export type { AIRequest, AIResult, AIMessage, AIDocument } from '../../api-server/ai/types';

export async function requestAI(request: AIRequest, signal: AbortSignal): Promise<AIResult> {
  const response = await fetch('/api/ai/assist', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request), signal });
  const data = await response.json();
  if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Не удалось выполнить AI-запрос.');
  if (!['llm', 'local'].includes(data.mode) || typeof data.answer !== 'string' || !Array.isArray(data.actions)
    || !Array.isArray(data.citations) || !Array.isArray(data.matches)) throw new Error('Помощник вернул некорректный ответ. Повторите запрос.');
  return data;
}
const historyKey = 'opora.ai.history.v2';
export function readAIHistory(): AIMessage[] {
  try {
    const data = JSON.parse(localStorage.getItem(historyKey) ?? '[]');
    return Array.isArray(data) ? data.filter((m) => m && ['user', 'assistant'].includes(m.role) && typeof m.text === 'string' && m.text.length <= 12000).slice(-30) : [];
  } catch { return []; }
}
export function saveAIHistory(messages: AIMessage[]) {
  try { localStorage.setItem(historyKey, JSON.stringify(messages.slice(-30).map(({ role, text }) => ({ role, text })))); return true; }
  catch { return false; }
}
