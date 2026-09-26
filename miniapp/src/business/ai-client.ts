import type { AIRequest, AIResult, AIMessage } from '../../api-server/ai/types';
import { beginAIActivity } from './ai-activity';
export type { AIRequest, AIResult, AIMessage, AIDocument } from '../../api-server/ai/types';

const invalidResponse = 'Помощник вернул некорректный ответ. Попробуйте ещё раз.';
const unavailable = 'GigaChat временно недоступен. Попробуйте ещё раз позже.';
const errorLabels: Record<string, string> = {
  INVALID_RESPONSE: invalidResponse, TRUNCATED_RESPONSE: invalidResponse, NO_FUNCTION_CALL: invalidResponse,
  PROVIDER_UNAVAILABLE: unavailable, AI_UNAVAILABLE: unavailable, GIGACHAT_AUTH_FAILED: unavailable,
  PROVIDER_TIMEOUT: 'Анализ занял слишком много времени. Повторите запрос — ваши данные сохранены.',
  PROVIDER_RATE_LIMITED: 'Слишком много запросов. Повторите через минуту.',
  RATE_LIMITED: 'Слишком много запросов. Повторите через минуту.',
  PROVIDER_CONTENT_BLOCKED: 'GigaChat не смог обработать этот вопрос. Попробуйте изменить формулировку.',
  blacklist: 'GigaChat не смог обработать этот вопрос. Попробуйте изменить формулировку.',
};
export function aiErrorMessage(error: unknown): string {
  if (error instanceof Error && error.name === 'TimeoutError') return 'Время ожидания ответа истекло. Попробуйте ещё раз.';
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  if (/^PROVIDER_HTTP_\d{3}$/.test(message)) return message === 'PROVIDER_HTTP_429' ? errorLabels.RATE_LIMITED : unavailable;
  return errorLabels[message] ?? (message || unavailable);
}
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const textFields = (value: unknown, required: string[], optional: string[] = []) => record(value)
  && required.every((key) => typeof value[key] === 'string')
  && optional.every((key) => value[key] == null || typeof value[key] === 'string');
const facts = (value: unknown) => record(value) && Object.values(value).every((item) => item == null || ['string', 'number', 'boolean'].includes(typeof item));
function renderableResult(data: unknown): data is AIResult {
  return record(data) && ['llm', 'local'].includes(String(data.mode)) && typeof data.answer === 'string'
    && ['notice', 'draft', 'providerFailure'].every((key) => data[key] == null || typeof data[key] === 'string')
    && ['proposedNeed', 'proposedProfile'].every((key) => data[key] == null || facts(data[key]))
    && Array.isArray(data.actions) && data.actions.every((item) => textFields(item, ['type', 'label'], ['programId']))
    && Array.isArray(data.citations) && data.citations.every((item) => textFields(item, ['id', 'title', 'text'], ['url', 'checkedAt']) && (item.page == null || typeof item.page === 'number'))
    && Array.isArray(data.findings) && data.findings.every((item) => textFields(item, ['title', 'detail', 'severity'], ['quote', 'evidenceId']))
    && Array.isArray(data.followups) && data.followups.every((item) => typeof item === 'string')
    && Array.isArray(data.matches) && data.matches.every((item) => textFields(item, ['id', 'title', 'status']))
    && Array.isArray(data.scenarios) && data.scenarios.every((item) => record(item) && typeof item.label === 'string'
      && facts(item.need) && Array.isArray(item.matches) && item.matches.every((match) => textFields(match, ['id', 'title', 'status'])));
}

export async function requestAI(request: AIRequest, signal: AbortSignal): Promise<AIResult> {
  signal.throwIfAborted();
  const endActivity = request.task === 'workspace' ? () => {} : beginAIActivity();
  const controller = new AbortController();
  const cancel = () => controller.abort(signal.reason);
  signal.addEventListener('abort', cancel, { once: true });
  if (signal.aborted) cancel();
  // Own the full request/body deadline; older WebViews need no AbortSignal.any/timeout.
  const timer = setTimeout(() => controller.abort(new DOMException('AI request timed out', 'TimeoutError')), 70000);
  try {
    let response: Response;
    try {
      response = await fetch('/api/ai/assist', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request), signal: controller.signal });
    } catch (error) {
      if (controller.signal.aborted) throw controller.signal.reason;
      throw new Error('Не удалось связаться с помощником. Проверьте соединение и повторите запрос.');
    }
    let data: unknown;
    try { data = await response.json(); }
    catch {
      if (controller.signal.aborted) throw controller.signal.reason;
      throw new Error(response.ok ? invalidResponse : response.status === 429 ? errorLabels.RATE_LIMITED : unavailable);
    }
    if (controller.signal.aborted) throw controller.signal.reason;
    if (!response.ok) throw new Error(aiErrorMessage(record(data) && typeof data.error === 'string' ? data.error
      : response.status === 429 ? 'RATE_LIMITED' : record(data) && typeof data.code === 'string' ? data.code : 'PROVIDER_UNAVAILABLE'));
    if (!renderableResult(data)) throw new Error(invalidResponse);
    return data;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', cancel);
    endActivity();
  }
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
