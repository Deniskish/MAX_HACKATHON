import { createHash } from 'node:crypto';
import { providerJson } from '../provider-json';
import type { AIEvidence } from './types';
export const EMBEDDINGS_URL = 'https://api.giga.chat/v1/embeddings';
export function cosine(a: number[], b: number[]) {
  if (a.length !== b.length || !a.length) return 0;
  const norm = Math.sqrt(a.reduce((n, x) => n + x * x, 0) * b.reduce((n, x) => n + x * x, 0));
  return norm ? a.reduce((n, x, i) => n + x * b[i], 0) / norm : 0;
}
export type SemanticSearch = (query: string, evidence: AIEvidence[], signal: AbortSignal) => Promise<AIEvidence[]>;
export function createSemanticSearch(token: () => Promise<string>, transport: typeof fetch, model = 'Embeddings'): SemanticSearch {
  // В памяти кэшируется только общедоступный корпус; пользовательские запросы не кэшируются.
  const cache = new Map<string, number[]>();
  async function embed(input: string[], signal: AbortSignal) {
    const accessToken = await token(); signal.throwIfAborted();
    const response = await transport(EMBEDDINGS_URL, { method: 'POST', redirect: 'error',
      signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]), headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ model, input }) });
    if (!response.ok) { await response.body?.cancel(); throw new Error('EMBEDDINGS_UNAVAILABLE'); }
    const data = await providerJson(response, 2000000) as any;
    if (!Array.isArray(data.data) || data.data.length !== input.length) throw new Error('INVALID_EMBEDDINGS');
    const ordered = [...data.data].sort((a, b) => a.index - b.index);
    if (ordered.some((d, i) => d.index !== i || !Array.isArray(d.embedding) || !d.embedding.length || d.embedding.length > 8192 || d.embedding.some((v: unknown) => typeof v !== 'number' || !Number.isFinite(v)))) throw new Error('INVALID_EMBEDDINGS');
    return ordered.map((d) => d.embedding as number[]);
  }
  return async (query, evidence, signal) => {
    const items = evidence.slice(0, 80).map((e) => ({ e, text: `${e.title}\n${e.text}`.slice(0, 2400), key: createHash('sha256').update(`${e.title}\n${e.text}`).digest('hex') }));
    const missing = items.filter((i) => !cache.has(i.key));
    for (let i = 0; i < missing.length; i += 16) {
      const batch = missing.slice(i, i + 16), vectors = await embed(batch.map((x) => x.text), signal);
      batch.forEach((x, index) => cache.set(x.key, vectors[index]));
    }
    while (cache.size > 256) cache.delete(cache.keys().next().value!);
    const [vector] = await embed([query.slice(0, 2000)], signal);
    return items.map((i) => ({ e: i.e, score: cosine(vector, cache.get(i.key)!) })).sort((a, b) => b.score - a.score).slice(0, 12).map((i) => i.e);
  };
}
