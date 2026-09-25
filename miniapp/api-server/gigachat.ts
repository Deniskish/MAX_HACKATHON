// OAuth и вызов GigaChat. Данные перед отправкой всегда проходят шлюз приватности.
import { randomUUID } from 'node:crypto';
import { privateCompletion, PrivacyError } from './privacy';
import { providerJson } from './provider-json';
import { createAIModel } from './ai/transport';
import { runAssistant } from './ai/service';
import type { AIEvidence } from './ai/types';
import { createSemanticSearch, EMBEDDINGS_URL } from './ai/embeddings';

export const GIGACHAT_OAUTH_URL = 'https://ngw.devices.sberbank.ru:9443/api/v2/oauth';
export const GIGACHAT_CHAT_URL = 'https://api.giga.chat/v1/chat/completions';
export const GIGACHAT_SCOPES = [
  'GIGACHAT_API_PERS',
  'GIGACHAT_API_B2B',
  'GIGACHAT_API_CORP',
] as const;
export type GigaChatConfig = { authKey: string; scope: string; model: string };

// Параллельные запросы одного клиента ждут общего обновления токена.
export function createGigaChatClient(
  config: GigaChatConfig,
  transport: typeof fetch = fetch,
  now = Date.now,
) {
  if (
    !config.authKey.trim() ||
    /\s/.test(config.authKey) ||
    !GIGACHAT_SCOPES.some((s) => s === config.scope) ||
    !/^GigaChat[\w.-]*$/.test(config.model)
  )
    throw new PrivacyError('INVALID_GIGACHAT_CONFIG');
  let cached: { token: string; expiresAt: number } | undefined;
  let pending: Promise<string> | undefined;
  async function getToken(): Promise<string> {
    if (cached && cached.expiresAt > now() + 60000) return cached.token;
    if (pending) return pending;
    pending = (async () => {
      const response = await transport(GIGACHAT_OAUTH_URL, {
        method: 'POST',
        redirect: 'error',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
          RqUID: randomUUID(),
          Authorization: `Basic ${config.authKey}`,
        },
        body: new URLSearchParams({ scope: config.scope }).toString(),
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new PrivacyError('GIGACHAT_AUTH_FAILED');
      }
      const value = (await providerJson(response, 16000)) as {
        access_token?: unknown;
        expires_at?: unknown;
      };
      if (
        typeof value?.access_token !== 'string' ||
        !value.access_token ||
        value.access_token.length > 12000 ||
        /\s/.test(value.access_token) ||
        typeof value.expires_at !== 'number' ||
        !Number.isFinite(value.expires_at) ||
        value.expires_at <= now() + 60000
      )
        throw new PrivacyError('GIGACHAT_AUTH_FAILED');
      cached = { token: value.access_token, expiresAt: value.expires_at };
      return cached.token;
    })();
    try {
      return await pending;
    } finally {
      pending = undefined;
    }
  }
  const authorizedTransport: typeof fetch = async (url, init) => {
    if (![GIGACHAT_CHAT_URL, EMBEDDINGS_URL].includes(String(url))) throw new PrivacyError('INVALID_PROVIDER_URL');
    const response = await transport(url, init);
    if (response.status !== 401) return response;
    await response.body?.cancel();
    // Не сбрасываем новый токен, если другой запрос уже успел его обновить.
    const headers = new Headers(init?.headers);
    if (cached && headers.get('Authorization') === `Bearer ${cached.token}`) cached = undefined;
    headers.set('Authorization', `Bearer ${await getToken()}`);
    return transport(url, { ...init, headers }); // One retry only, with the same protected body.
  };
  const semantic = createSemanticSearch(getToken, authorizedTransport);
  return {
    async assist(input: unknown, evidence: AIEvidence[] = [], signal?: AbortSignal) {
      return runAssistant(input, createAIModel(GIGACHAT_CHAT_URL, config.model, getToken, authorizedTransport), evidence, signal, semantic);
    },
    async complete(input: unknown) {
      // Проверяем и обезличиваем данные до авторизации у провайдера.
      const result = await privateCompletion(
        input,
        { endpoint: GIGACHAT_CHAT_URL, token: getToken, model: config.model },
        authorizedTransport,
      );
      return { ...result, provider: 'gigachat' as const };
    },
  };
}
