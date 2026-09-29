import { createHmac, randomUUID } from 'node:crypto';

export interface BotAPI { request<T = any>(method: string, route: string, body?: unknown): Promise<T> }
export class APIError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}
export class OporaAPI implements BotAPI {
  constructor(private readonly base: string, private readonly token: string, private readonly user: string,
    private readonly http: typeof fetch = fetch) {
    const url = new URL(base);
    const localHTTP = url.protocol === 'http:' && (['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
      || url.hostname === 'api' && url.port === '3002');
    if (url.protocol !== 'https:' && !localHTTP)
      throw new Error('BOT_API_URL must use HTTPS, loopback or Docker service http://api:3002');
    if (url.username || url.password || url.search || url.hash || !/^[1-9]\d{0,15}$/.test(user)) throw new Error('INVALID_BOT_API_CONFIG');
  }
  async request<T>(method: string, route: string, body?: unknown): Promise<T> {
    if (!route.startsWith('/api/') || route.includes('..')) throw new Error('INVALID_API_ROUTE');
    const timestamp = String(Date.now()), nonce = randomUUID(), data = JSON.stringify(body ?? {});
    const key = createHmac('sha256', this.token).update('opora-bot-api-v1').digest();
    const signature = createHmac('sha256', key).update([method, route, this.user, timestamp, nonce, data].join('\n')).digest('hex');
    const response = await this.http(new URL(route, this.base), {
      method, redirect: 'error', signal: AbortSignal.timeout(route === '/api/ai/assist' ? 75000 : 25000),
      headers: { 'Content-Type': 'application/json', 'X-Opora-Bot-User': this.user, 'X-Opora-Bot-Time': timestamp,
        'X-Opora-Bot-Nonce': nonce, 'X-Opora-Bot-Signature': signature },
      ...(body === undefined ? {} : { body: data }),
    });
    if (!response.ok) {
      const detail = await response.json().catch(() => ({})) as { code?: string };
      throw new APIError(response.status, detail.code ?? 'API_UNAVAILABLE');
    }
    return await response.json() as T;
  }
}
