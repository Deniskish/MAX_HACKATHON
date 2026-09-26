import { untilAborted } from '../funding-catalog/abort';

// Personal GigaChat accounts allow one in-flight generation. Share the queue
// between chat, workspace analysis, embeddings and background recommendations.
export function serialTransport(transport: typeof fetch): typeof fetch {
  let tail = Promise.resolve();
  return async (url, init) => {
    const previous = tail;
    let release!: () => void;
    const finished = new Promise<void>(resolve => { release = resolve; });
    tail = previous.then(() => finished);
    const signal = init?.signal;
    try {
      if (signal) await untilAborted(previous, signal);
      else await previous;
      signal?.throwIfAborted();
      const response = await transport(url, init);
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
      } finally { await reader.cancel(); reader.releaseLock(); }
      return new Response(Buffer.concat(chunks), { status: response.status, statusText: response.statusText, headers: response.headers });
    } finally { release(); }
  };
}
