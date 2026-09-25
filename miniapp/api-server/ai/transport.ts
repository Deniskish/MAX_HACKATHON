import { providerJson } from '../provider-json';
import { PrivacyError } from '../privacy';
import { answerFunction, reviewFunction, workspaceFunction, assistantSystem, planFunction, type AIModel } from './service';

function reviewValue(value: any) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.answer !== 'string' || !value.answer.trim()
    || !Array.isArray(value.findings) || !Array.isArray(value.evidenceIds) || !Array.isArray(value.followups)
    || !value.evidenceIds.every((id: unknown) => typeof id === 'string') || !value.followups.every((q: unknown) => typeof q === 'string')
    || !value.findings.every((f: any) => f && typeof f.title === 'string' && typeof f.detail === 'string' && ['warning', 'check'].includes(f.severity))) throw new PrivacyError('INVALID_RESPONSE');
  return value;
}
function reviewJSON(content: unknown) {
  if (typeof content !== 'string') throw new PrivacyError('INVALID_RESPONSE');
  let value: unknown;
  try { value = JSON.parse(content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')); }
  catch { throw new PrivacyError('INVALID_RESPONSE'); }
  return reviewValue(value);
}

export function createAIModel(endpoint: string, model: string, token: () => Promise<string>, transport: typeof fetch): AIModel {
  return async (stage, input, signal) => {
    const workspace = stage === 'answer' && (input as any)?.request?.task === 'workspace';
    const chat = stage === 'answer' && (input as any)?.request?.task === 'chat';
    const review = stage === 'answer' && (input as any)?.request?.task === 'review';
    const fn = stage === 'plan' ? planFunction : workspace ? workspaceFunction : review ? reviewFunction : answerFunction;
    const accessToken = await token();
    signal.throwIfAborted();
    const request = async (jsonReview = false) => {
      const response = await transport(endpoint, {
        method: 'POST', redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]),
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ model, stream: false, temperature: 0.1, max_tokens: stage === 'plan' ? 1600 : 4000,
          messages: [{ role: 'system', content: chat
            ? assistantSystem.split('Для task=workspace')[0] + '\nСейчас обычный диалог. Верни только текст ответа пользователю, без JSON, описания инструментов и служебных полей.'
            : review ? assistantSystem.split('Для task=workspace')[0] + '\n' + reviewFunction.description
              + (jsonReview ? '\nВерни только JSON, соответствующий этой схеме: ' + JSON.stringify(reviewFunction.parameters) : '')
              : assistantSystem }, { role: 'user', content: JSON.stringify(input) }],
          ...(chat || jsonReview ? {} : { functions: [fn], function_call: { name: fn.name } }) }),
      });
      if (!response.ok) { await response.body?.cancel(); throw new PrivacyError(response.status === 429 ? 'PROVIDER_RATE_LIMITED' : `PROVIDER_HTTP_${response.status}`); }
      return await providerJson(response, 120000) as any;
    };
    const data = await request();
    const choice = data.choices?.[0], message = choice?.message;
    if (choice?.finish_reason === 'length') throw new PrivacyError('TRUNCATED_RESPONSE');
    // Conversational answers are text; document reviews and edits keep their strict structured contract.
    if (chat) {
      if (typeof message?.content !== 'string' || !message.content.trim()) throw new PrivacyError('INVALID_RESPONSE');
      return { value: { answer: message.content.trim(), evidenceIds: [], followups: [], findings: [] },
        tokens: typeof data.usage?.total_tokens === 'number' ? data.usage.total_tokens : 0 };
    }
    if (review && message?.function_call?.name !== fn.name) {
      // Some model versions return JSON in content instead of the requested function.
      try { return { value: reviewJSON(message?.content), tokens: data.usage?.total_tokens ?? 0 }; }
      catch { /* One bounded format retry; plain prose is never labelled a completed structured review. */ }
      signal.throwIfAborted();
      const retried = await request(true), next = retried.choices?.[0];
      if (next?.finish_reason === 'length') throw new PrivacyError('TRUNCATED_RESPONSE');
      return { value: reviewJSON(next?.message?.content), tokens: (data.usage?.total_tokens ?? 0) + (retried.usage?.total_tokens ?? 0), calls: 2 };
    }
    if (message?.function_call?.name !== fn.name) throw new PrivacyError('NO_FUNCTION_CALL');
    let value = message.function_call.arguments;
    if (typeof value === 'string') { try { value = JSON.parse(value); } catch { throw new PrivacyError('INVALID_RESPONSE'); } }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PrivacyError('INVALID_RESPONSE');
    if (review) value = reviewValue(value);
    if (workspace) {
      if (!Array.isArray(value.sections)) throw new PrivacyError('INVALID_RESPONSE');
      const sections = Object.fromEntries(value.sections.filter((s: any) => s && typeof s.page === 'string').map((s: any) => [s.page, { title: s.title, text: s.text, action: s.action }]));
      value = { answer: value.summary, evidenceIds: value.evidenceIds, followups: [], findings: [], personalization: { summary: value.summary, sections, priorities: value.priorities } };
    }
    return { value, tokens: typeof data.usage?.total_tokens === 'number' ? data.usage.total_tokens : 0 };
  };
}
