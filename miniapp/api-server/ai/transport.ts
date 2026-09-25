import { providerJson } from '../provider-json';
import { PrivacyError } from '../privacy';
import { answerFunction, draftFunction, reviewFunction, workspaceFunction, assistantSystem, planFunction, type AIModel } from './service';

function validateShape(value: any, schema: any): any {
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PrivacyError('INVALID_RESPONSE');
    for (const key of schema.required ?? []) if (value[key] == null) throw new PrivacyError('INVALID_RESPONSE');
    for (const [key, field] of Object.entries(schema.properties ?? {})) if (value[key] != null) validateShape(value[key], field);
  } else if (schema.type === 'array') {
    if (!Array.isArray(value)) throw new PrivacyError('INVALID_RESPONSE');
    for (const item of value) validateShape(item, schema.items);
  } else if (typeof value !== schema.type || schema.enum && !schema.enum.includes(value)) throw new PrivacyError('INVALID_RESPONSE');
  return value;
}
function parseStructured(value: unknown, schema: unknown, workspace = false) {
  if (typeof value === 'string') {
    try { value = JSON.parse(value.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')); }
    catch { throw new PrivacyError('INVALID_RESPONSE'); }
  }
  // Older prompts asked for the application envelope instead of function arguments.
  // Accept that equivalent representation, then validate every required field.
  if (workspace && value && typeof value === 'object' && !Array.isArray(value)) {
    let data = value as any;
    if (!('summary' in data) && data.personalization && typeof data.personalization === 'object') {
      data = { ...data.personalization, evidenceIds: data.personalization.evidenceIds ?? data.evidenceIds };
    }
    if (Array.isArray(data.sections)) {
      const pages = data.sections.map((s: any) => s?.page);
      if (new Set(pages).size !== pages.length) throw new PrivacyError('INVALID_RESPONSE');
      data = { ...data, sections: Object.fromEntries(data.sections.map((s: any) => [s?.page, s])) };
    }
    value = data;
  }
  return validateShape(value, schema);
}
export function createAIModel(endpoint: string, model: string, token: () => Promise<string>, transport: typeof fetch): AIModel {
  return async (stage, input, signal) => {
    const task = (input as any)?.request?.task;
    const workspace = stage === 'answer' && task === 'workspace';
    const conversational = stage === 'answer' && ['chat', 'intake', 'search', 'analysis', 'strategy', 'changes'].includes(task);
    const review = stage === 'answer' && task === 'review', draft = stage === 'answer' && task === 'draft';
    const fn = stage === 'plan' ? planFunction : workspace ? workspaceFunction : review ? reviewFunction : draft ? draftFunction : answerFunction;
    const accessToken = await token();
    const system = workspace ? assistantSystem : assistantSystem.split('Для task=workspace')[0];
    const request = async (jsonOnly = false) => {
      signal.throwIfAborted();
      const response = await transport(endpoint, {
        method: 'POST', redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]),
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ model, stream: false, temperature: 0.1, max_tokens: stage === 'plan' ? 1600 : 4000,
          messages: [{ role: 'system', content: system + (conversational
            ? '\nВерни только текст ответа пользователю, без JSON, описания инструментов и служебных полей.'
            : '\n' + fn.description + (jsonOnly ? '\nВерни только JSON по схеме: ' + JSON.stringify(fn.parameters) : '')) },
            { role: 'user', content: JSON.stringify(input) }],
          ...(conversational || jsonOnly ? {} : { functions: [fn], function_call: { name: fn.name } }) }),
      });
      if (!response.ok) { await response.body?.cancel(); throw new PrivacyError(response.status === 429 ? 'PROVIDER_RATE_LIMITED' : `PROVIDER_HTTP_${response.status}`); }
      const data = await providerJson(response, 120000) as any;
      // A provider refusal is not an answer or malformed JSON, and must not be retried.
      if (data.choices?.[0]?.finish_reason === 'blacklist') throw new PrivacyError('PROVIDER_CONTENT_BLOCKED');
      return data;
    };
    const data = await request();
    const choice = data.choices?.[0], message = choice?.message;
    if (choice?.finish_reason === 'length') throw new PrivacyError('TRUNCATED_RESPONSE');
    let tokens = typeof data.usage?.total_tokens === 'number' ? data.usage.total_tokens : 0, calls = 1;
    if (conversational) {
      if (typeof message?.content !== 'string' || !message.content.trim()) throw new PrivacyError('INVALID_RESPONSE');
      return { value: { answer: message.content.trim(), evidenceIds: [], followups: [], findings: [] }, tokens, calls };
    }
    let value;
    try { value = parseStructured(message?.function_call?.name === fn.name ? message.function_call.arguments : message?.content, fn.parameters, workspace); }
    catch {
      // One bounded retry for the required JSON shape; never label unstructured prose as a review or draft.
      signal.throwIfAborted();
      const retried = await request(true), next = retried.choices?.[0];
      calls++; tokens += typeof retried.usage?.total_tokens === 'number' ? retried.usage.total_tokens : 0;
      if (next?.finish_reason === 'length') throw new PrivacyError('TRUNCATED_RESPONSE');
      value = parseStructured(next?.message?.content, fn.parameters, workspace);
    }
    if (workspace) {
      const sections = value.sections;
      value = { answer: value.summary, evidenceIds: value.evidenceIds, followups: [], findings: [], personalization: { summary: value.summary, sections, priorities: value.priorities } };
    }
    if (draft) value = { ...value, findings: [], followups: [] };
    return { value, tokens, calls };
  };
}
