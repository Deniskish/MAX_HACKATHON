import { APIError, type BotAPI } from './api-client';

// API and bot are restarted together. A refused connection during API startup
// is temporary; an invalid signature or configuration must still fail closed.
export async function waitForAPI(api: BotAPI, pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))) {
  for (let attempt = 0; ; attempt++) {
    try { await api.request('GET', '/api/bot/workspace'); return; }
    catch (error) {
      if (attempt >= 14 || error instanceof APIError && error.status < 500 && error.status !== 429) throw error;
      await pause(2000);
    }
  }
}
