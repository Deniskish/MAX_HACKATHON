// Run from api-server. Only response structure is logged, never content or credentials.
import { config } from 'dotenv';
import { createGigaChatClient, GIGACHAT_CHAT_URL } from '../gigachat';
config({ path: '../../.env', quiet: true });
config({ quiet: true });
const known = new Set(['summary', 'answer', 'personalization', 'evidenceIds', 'sections', 'priorities', 'page', 'title', 'text', 'action', 'programId', 'reason', 'home', 'programs', 'applications', 'calendar', 'assistant']);
function shape(value: any, depth = 0): any {
  if (depth > 5) return typeof value;
  if (Array.isArray(value)) return { type: 'array', length: value.length, items: value.slice(0, 5).map((item) => shape(item, depth + 1)) };
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => known.has(key)).map(([key, item]) => [key, shape(item, depth + 1)]));
  return typeof value === 'string' ? { type: 'string', length: value.length } : value === null ? 'null' : typeof value;
}
async function main() {
  if (!process.env.GIGACHAT_AUTH_KEY) throw new Error('DIAGNOSTIC_KEY_NOT_CONFIGURED');
  const transport: typeof fetch = async (url, init) => {
    const response = await fetch(url, init);
    if (String(url) === GIGACHAT_CHAT_URL) {
      const data: any = await response.clone().json();
      const choice = data.choices?.[0], message = choice?.message;
      let value = message?.function_call?.arguments ?? message?.content;
      let json = typeof value === 'object';
      try { if (typeof value === 'string') { value = JSON.parse(value.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')); json = true; } } catch { /* Report structure only. */ }
      console.log('AI response shape:', JSON.stringify({ status: response.status, finish: ['stop', 'length', 'function_call', 'blacklist'].includes(choice?.finish_reason) ? choice.finish_reason : 'other', functionCall: message?.function_call?.name === 'adapt_workspace', json, shape: shape(value) }));
    }
    return response;
  };
  const client = createGigaChatClient({ authKey: process.env.GIGACHAT_AUTH_KEY, scope: process.env.GIGACHAT_SCOPE || 'GIGACHAT_API_PERS', model: process.env.GIGACHAT_MODEL || 'GigaChat-2-Pro' }, transport);
  const result = await client.assist({ task: 'workspace', question: 'Проанализируй имеющиеся сведения и адаптируй все пять разделов. Не придумывай параметры бизнеса: если данных мало, предложи уточнения.', context: { profile: {}, workspace: { savedIds: [], applications: [] } } });
  console.log('AI diagnostic:', JSON.stringify({ mode: result.mode, failure: result.providerFailure }));
}
main().catch(() => { console.error('AI_DIAGNOSTIC_FAILED'); process.exitCode = 1; });
