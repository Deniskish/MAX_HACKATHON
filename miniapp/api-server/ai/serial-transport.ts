import { untilAborted } from '../funding-catalog/abort';
import { AsyncLocalStorage } from 'node:async_hooks';

const priority = new AsyncLocalStorage<'interactive' | 'background'>();
export function withAIPriority<T>(value: 'interactive' | 'background', run: () => T): T {
  return priority.run(value, run);
}

// Personal GigaChat accounts allow one in-flight generation. Share the queue
// between chat, workspace analysis, embeddings and background recommendations.
export function serialTransport(transport: typeof fetch): typeof fetch {
  let busy = false, foregroundStreak = 0;
  type Waiting = { background: boolean; start: () => void };
  const queue: Waiting[] = [];
  const drain = () => {
    if (busy || !queue.length) return;
    const foreground = queue.findIndex(item => !item.background);
    const background = queue.findIndex(item => item.background);
    // Interactive work jumps queued background work; every fourth slot remains
    // available to background jobs so notifications cannot starve indefinitely.
    const index = background >= 0 && foregroundStreak >= 3 ? background : foreground >= 0 ? foreground : 0;
    const [item] = queue.splice(index, 1);
    foregroundStreak = item.background ? 0 : foregroundStreak + 1;
    busy = true; item.start();
  };
  return async (url, init) => {
    const signal = init?.signal;
    signal?.throwIfAborted();
    await new Promise<void>((resolve, reject) => {
      const abort = () => {
        const index = queue.indexOf(item);
        if (index >= 0) queue.splice(index, 1);
        reject(signal?.reason);
      };
      const item: Waiting = { background: priority.getStore() === 'background', start: () => {
        signal?.removeEventListener('abort', abort); resolve();
      } };
      signal?.addEventListener('abort', abort, { once: true });
      queue.push(item); drain();
    });
    try {
      signal?.throwIfAborted();
      const response = signal ? await untilAborted(transport(url, init), signal) : await transport(url, init);
      // A fetch resolves at headers, before generation/body delivery is complete.
      // Buffer a bounded non-streaming response before releasing the provider slot.
      const reader = response.body?.getReader();
      if (!reader) return response;
      const chunks: Uint8Array[] = []; let size = 0;
      try {
        while (true) {
          const next = signal ? await untilAborted(reader.read(), signal) : await reader.read();
          if (next.done) break;
          size += next.value.byteLength;
          if (size > 2_000_000) throw new Error('RESPONSE_TOO_LARGE');
          chunks.push(next.value);
        }
      } finally { void reader.cancel().catch(() => {}); reader.releaseLock(); }
      return new Response(Buffer.concat(chunks), { status: response.status, statusText: response.statusText, headers: response.headers });
    } finally { busy = false; drain(); }
  };
}
