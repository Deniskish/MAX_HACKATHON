import { providerJson } from '../provider-json';
import { PrivacyError } from '../privacy';
import { answerFunction, assistantSystem, planFunction, type AIModel } from './service';

export function createAIModel(endpoint: string, model: string, token: () => Promise<string>, transport: typeof fetch): AIModel {
  return async (stage, input, signal) => {
    const fn = stage === 'plan' ? planFunction : answerFunction;
    const accessToken = await token();
    signal.throwIfAborted();
    const response = await transport(endpoint, {
      method: 'POST', redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ model, stream: false, temperature: 0.1, max_tokens: stage === 'plan' ? 1600 : 4000,
        messages: [{ role: 'system', content: assistantSystem }, { role: 'user', content: JSON.stringify(input) }],
        functions: [fn], function_call: { name: fn.name } }),
    });
    if (!response.ok) { await response.body?.cancel(); throw new PrivacyError(response.status === 429 ? 'PROVIDER_RATE_LIMITED' : 'PROVIDER_UNAVAILABLE'); }
    const data = await providerJson(response, 120000) as any;
    const choice = data.choices?.[0], message = choice?.message;
    if (choice?.finish_reason === 'length') throw new PrivacyError('TRUNCATED_RESPONSE');
    if (message?.function_call?.name !== fn.name) throw new PrivacyError('INVALID_RESPONSE');
    let value = message.function_call.arguments;
    if (typeof value === 'string') { try { value = JSON.parse(value); } catch { throw new PrivacyError('INVALID_RESPONSE'); } }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PrivacyError('INVALID_RESPONSE');
    return { value, tokens: typeof data.usage?.total_tokens === 'number' ? data.usage.total_tokens : 0 };
  };
}
