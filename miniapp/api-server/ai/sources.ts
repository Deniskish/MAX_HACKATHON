import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { parseHTML } from 'linkedom';
import { officialFundingCatalog } from '../funding-catalog/official-catalog';
import type { AIEvidence } from './types';

export type SourcePage = { id: string; url: string; title: string; text: string; hash: string; fetchedAt: string; opportunityId?: string };
export type SourceUpdate = { id: string; url: string; title: string; detectedAt: string; opportunityId?: string; kind: 'changed' | 'discovered' };
type Snapshot = { pages: SourcePage[]; updates: SourceUpdate[]; checkedAt: string | null; errors: number };
const hosts = ['frprf.ru', 'corpmsp.ru', 'fasie.ru', 'agro.tatarstan.ru', 'exportcenter.ru'];
export function trustedSource(url: string): boolean {
  try { const u = new URL(url); return u.protocol === 'https:' && !u.username && !u.password && !u.port && hosts.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`)); }
  catch { return false; }
}
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
export function extractSource(html: string, url: string) {
  const { document } = parseHTML(html);
  const title = document.querySelector('h1')?.textContent?.trim() || document.title || new URL(url).hostname;
  document.querySelectorAll('script,style,noscript,svg,nav,header,footer,form,iframe').forEach((e: { remove(): void }) => e.remove());
  const main = document.querySelector('main,article,[role="main"]') ?? document.body;
  const text = (main?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 50000);
  const links = [...document.querySelectorAll('a[href]')].flatMap((a) => {
    try {
      const target = new URL(a.getAttribute('href')!, url); target.hash = ''; target.search = '';
      const label = a.textContent ?? '';
      return trustedSource(target.href) && /займ|заём|грант|субсид|поддержк|программ/i.test(label) && !/\.(pdf|docx?|xlsx?|zip|png|jpe?g)$/i.test(target.pathname) ? [target.href] : [];
    } catch { return []; }
  });
  return { title: title.slice(0, 200), text, links: [...new Set(links)].slice(0, 4) };
}
async function fetchPage(url: string, transport: typeof fetch, signal: AbortSignal): Promise<{ html: string; url: string }> {
  for (let n = 0; n < 4; n++) {
    if (!trustedSource(url)) throw new Error('UNTRUSTED_SOURCE');
    const response = await transport(url, { redirect: 'manual', signal, headers: { Accept: 'text/html', 'User-Agent': 'OporaSourceMonitor/1.0' } });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location'); await response.body?.cancel();
      if (!location) throw new Error('INVALID_REDIRECT'); url = new URL(location, url).href; continue;
    }
    if (!response.ok || !response.headers.get('content-type')?.includes('text/html')) { await response.body?.cancel(); throw new Error('SOURCE_UNAVAILABLE'); }
    if (Number(response.headers.get('content-length')) > 2000000) { await response.body?.cancel(); throw new Error('SOURCE_TOO_LARGE'); }
    const reader = response.body?.getReader(); if (!reader) throw new Error('EMPTY_SOURCE');
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > 2000000) throw new Error('SOURCE_TOO_LARGE'); chunks.push(part.value); }
    } finally { await reader.cancel(); }
    return { html: Buffer.concat(chunks).toString('utf8'), url };
  }
  throw new Error('TOO_MANY_REDIRECTS');
}
export class SourceStore {
  private snapshot: Snapshot = { pages: [], updates: [], checkedAt: null, errors: 0 };
  private ready?: Promise<void>;
  private pending?: Promise<Snapshot>;
  constructor(private directory = process.env.OPORA_SOURCE_DIR || path.resolve(process.cwd(), 'source-data')) {}
  async load() {
    this.ready ??= (async () => {
      try {
        const data = JSON.parse(await readFile(path.join(this.directory, 'sources.json'), 'utf8')) as Snapshot;
        if (Array.isArray(data.pages) && Array.isArray(data.updates) && data.pages.length <= 24 && data.updates.length <= 50
          && data.pages.every((p) => p && trustedSource(p.url) && typeof p.text === 'string' && p.text.length <= 50000
            && ['id', 'title', 'hash', 'fetchedAt'].every((key) => typeof p[key as keyof SourcePage] === 'string'))
          && data.updates.every((u) => u && trustedSource(u.url) && typeof u.id === 'string' && typeof u.title === 'string'
            && typeof u.detectedAt === 'string' && ['changed', 'discovered'].includes(u.kind))) this.snapshot = data;
      } catch { /* Empty cache is valid on first launch. */ }
    })(); await this.ready;
  }
  async evidence(): Promise<AIEvidence[]> {
    await this.load();
    return this.snapshot.pages.flatMap((p) => {
      const result: AIEvidence[] = [];
      for (let i = 0; i < Math.min(p.text.length, 20000); i += 1800) result.push({ id: `source:${p.id}:${i / 1800}`, title: p.title,
        url: p.url, checkedAt: p.fetchedAt.slice(0, 10), opportunityId: p.opportunityId,
        text: `Текст сайта получен ${p.fetchedAt}. Структурированные условия требуют сверки при расхождении.\n${p.text.slice(i, i + 2000)}` });
      return result;
    });
  }
  async status() { await this.load(); return { checkedAt: this.snapshot.checkedAt, pages: this.snapshot.pages.length, errors: this.snapshot.errors, updates: this.snapshot.updates }; }
  async sync(transport: typeof fetch = fetch): Promise<Snapshot> {
    if (this.pending) return this.pending;
    this.pending = this.scan(transport).finally(() => { this.pending = undefined; }); return this.pending;
  }
  private async scan(transport: typeof fetch): Promise<Snapshot> {
    await this.load(); const checkedAt = new Date().toISOString();
    const pages = new Map(this.snapshot.pages.map((p) => [p.url, p]));
    const updates = [...this.snapshot.updates]; let errors = 0;
    const queue = officialFundingCatalog.map((p) => ({ url: p.source.url!, opportunityId: p.id, seed: true }));
    // Из официальных страниц пополняем поисковую базу. Новые страницы не становятся
    // формальными программами для расчёта без отдельной проверки их условий.
    const visited = new Set<string>();
    for (let i = 0; i < queue.length && visited.size < 20; i++) {
      const target = queue[i]; if (visited.has(target.url)) continue; visited.add(target.url);
      try {
        const fetched = await fetchPage(target.url, transport, AbortSignal.timeout(12000));
        const parsed = extractSource(fetched.html, fetched.url);
        if (parsed.text.length < 180) throw new Error('EMPTY_SOURCE');
        const previous = pages.get(target.url), digest = hash(parsed.text), id = hash(target.url).slice(0, 16);
        const page: SourcePage = { id, url: target.url, title: parsed.title, text: parsed.text, hash: digest, fetchedAt: checkedAt, opportunityId: target.opportunityId || undefined };
        pages.set(target.url, page);
        if ((previous && previous.hash !== digest) || (!previous && !target.seed)) updates.unshift({ id: `${id}:${digest.slice(0, 12)}`,
          title: parsed.title, url: target.url, detectedAt: checkedAt, opportunityId: page.opportunityId, kind: previous ? 'changed' : 'discovered' });
        if (target.seed) for (const url of parsed.links) if (!queue.some((p) => p.url === url) && queue.length < 20) queue.push({ url, opportunityId: '', seed: false });
      } catch { errors++; }
    }
    this.snapshot = { pages: [...pages.values()].slice(0, 24), updates: [...new Map(updates.map((u) => [u.id, u])).values()].slice(0, 50), checkedAt, errors };
    await mkdir(this.directory, { recursive: true });
    const temporary = path.join(this.directory, 'sources.tmp.json');
    await writeFile(temporary, JSON.stringify(this.snapshot), 'utf8'); await rename(temporary, path.join(this.directory, 'sources.json'));
    return this.snapshot;
  }
}
export function startSourceMonitor(store: SourceStore) {
  const run = () => void store.sync().catch(() => console.warn('Не удалось обновить кэш официальных источников.'));
  const first = setTimeout(run, 15000); first.unref();
  const interval = setInterval(run, 6 * 60 * 60 * 1000); interval.unref();
  return () => { clearTimeout(first); clearInterval(interval); };
}
