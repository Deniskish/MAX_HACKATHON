import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import { catalogHash } from './live';
import { officialFundingCatalog } from './official-catalog';
import { fundingSources, sourceForRegion, sourceUrl, type FundingSource } from './source-registry';
import { readProgrammePage, type ProgrammePage } from './web-page';
import { verifiedOpportunity, type ExtractOpportunity } from './extraction';
import type { FundingOpportunity } from './types';
type PageState = { hash: string; checkedAt: string; outcome: 'verified' | 'not_measure' | 'pending'; error: string | null };
type SourceState = { queue: string[]; cursor: number; pages: Record<string, PageState>; entries: FundingOpportunity[];
  attemptedAt: string | null; checkedAt: string | null; error: string | null; failures: number };
export const diagnosticCode = (e: unknown) => e instanceof Error && /^[A-Z][A-Z_]+(?:_\d{3})?$/.test(e.message) ? e.message
  : e instanceof Error && ['AbortError','TimeoutError'].includes(e.name) ? 'SOURCE_TIMEOUT' : 'SOURCE_CONNECTION_FAILED';
export class OfficialWebCatalog {
  private states = new Map<string, SourceState>();
  private running = new Map<string, Promise<void>>();
  private interests = new Map<string, number>();
  private unsupported = new Map<string, number>();
  constructor(private directory: string, private extract?: ExtractOpportunity, readonly sources = fundingSources,
    private read: (url: string, source: FundingSource) => Promise<ProgrammePage> = readProgrammePage) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    try { const data = JSON.parse(readFileSync(path.join(directory, 'interests.json'), 'utf8'));
      for (const [r, at] of Object.entries(data.regions ?? {})) if (typeof at === 'number') this.interests.set(r, at);
      for (const [r, at] of Object.entries(data.unsupported ?? {})) if (typeof at === 'number') this.unsupported.set(r, at);
    } catch { /* First run. */ }
    for (const source of sources) {
      const seeds = [...source.seeds, ...officialFundingCatalog.flatMap(o => o.source.url && sourceUrl(o.source.url, source) ? [o.source.url] : [])];
      let state: SourceState = { queue: [...new Set(seeds)], cursor: 0, pages: {}, entries: [], attemptedAt: null, checkedAt: null, error: null, failures: 0 };
      try { const saved = JSON.parse(readFileSync(this.file(source.id), 'utf8'));
        if (Array.isArray(saved.entries) && Array.isArray(saved.queue) && saved.pages && Number.isInteger(saved.cursor)) {
          // Revalidate cached evidence as well: malformed or untrusted entries never become live measures.
          saved.entries = saved.entries.filter((o: FundingOpportunity) => o?.imported?.provider === source.id && ['verified', 'pending'].includes(o.imported.verification ?? '')
            && o.source?.url && sourceUrl(o.source.url, source) && typeof o.title === 'string' && Array.isArray(o.requirements)
            && typeof o.imported.detail?.text === 'string' && o.imported.evidence && Object.values(o.imported.evidence).every(q => typeof q === 'string' && (!q || o.imported!.detail!.text.includes(q))));
          state = { ...state, ...saved, queue: [...new Set([...seeds, ...saved.queue.filter((u: unknown) => typeof u === 'string' && sourceUrl(u, source))])].slice(0, 200) };
        }
      } catch { /* A source never affects another source's cache. */ }
      this.states.set(source.id, state);
    }
  }
  private file(id: string) { return path.join(this.directory, `${id}.json`); }
  private write(file: string, data: unknown) { writeFileSync(file + '.tmp', JSON.stringify(data), { mode: 0o600 }); renameSync(file + '.tmp', file); }
  private save(source: FundingSource) { this.write(this.file(source.id), this.states.get(source.id)); }
  registerInterest(region: string) {
    if (typeof region !== 'string' || region.length < 2 || region.length > 100 || !/^[а-яёa-z\s.,()—-]+$/i.test(region)) return;
    const matched = sourceForRegion(region, this.sources), now = Date.now();
    if (matched.length) matched.forEach(s => this.interests.set(s.region!, now));
    else if (this.unsupported.size < 100) this.unsupported.set(region, now);
    // Store only regional demand, never a company, user ID or profile.
    this.write(path.join(this.directory, 'interests.json'), { regions: Object.fromEntries(this.interests), unsupported: Object.fromEntries(this.unsupported) });
  }
  private active(s: FundingSource) { return !s.region || Date.now() - (this.interests.get(s.region) ?? 0) < 30 * 86400000; }
  status() { return { sources: this.sources.map(s => { const state = this.states.get(s.id)!;
    return { id: s.id, name: s.name, region: s.region ?? null, enabled: this.active(s), syncing: this.running.has(s.id),
      attemptedAt: state.attemptedAt, checkedAt: state.checkedAt, error: state.error, failures: state.failures,
      discovered: state.queue.length, imported: state.entries.length, pending: Object.values(state.pages).filter(p => p.outcome === 'pending').length,
      rejected: Object.values(state.pages).filter(p => p.outcome === 'not_measure').length,
      problems: Object.entries(state.pages).filter(([, p]) => p.error).map(([url, p]) => ({ url, code: p.error })).slice(0, 30) }; }),
    unsupportedRegions: [...this.unsupported].filter(([, at]) => Date.now() - at < 30 * 86400000).map(([r]) => r) }; }
  getCatalog(): FundingOpportunity[] { return [...this.states.values()].flatMap(s => s.entries).map(o => {
    const ends = Date.parse(o.imported!.endsAt), starts = Date.parse(o.imported!.startsAt);
    const status = ends < Date.now() ? 'closed' : starts > Date.now() ? 'upcoming'
      : o.imported!.verification !== 'verified' ? 'unknown' : o.imported!.detail?.accepting ? 'active' : o.status;
    return { ...o, status };
  }); }
  syncSource(id: string): Promise<void> {
    const existing = this.running.get(id); if (existing) return existing;
    const source = this.sources.find(s => s.id === id); if (!source || !this.active(source)) return Promise.resolve();
    const work = this.scan(source).finally(() => this.running.delete(id)); this.running.set(id, work); return work;
  }
  async sync() { await Promise.allSettled(this.sources.filter(s => this.active(s)).map(s => this.syncSource(s.id))); }
  start() {
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (const [index, source] of this.sources.entries()) {
      const run = () => void this.syncSource(source.id).catch(() => console.error(JSON.stringify({ event: 'funding_source', source: source.id, code: 'SOURCE_STORAGE_FAILED' })));
      timers.push(setTimeout(run, 5000 + index * 1500), setInterval(run, 15 * 60000));
    }
    timers.forEach(t => t.unref()); return () => timers.forEach(t => clearTimeout(t));
  }
  private async scan(source: FundingSource) {
    const state = this.states.get(source.id)!; state.attemptedAt = new Date().toISOString(); state.error = null;
    let fetched = 0, extracted = 0;
    const attempted = new Set<string>();
    try {
      for (let n = 0; n < 8 && attempted.size < state.queue.length; n++) {
        state.cursor %= state.queue.length; const url = state.queue[state.cursor++];
        if (attempted.has(url)) break; attempted.add(url);
        try {
          const page = await this.read(url, source); fetched++;
          for (const link of page.links) if (sourceUrl(link, source) && !state.queue.includes(link) && state.queue.length < 200) state.queue.push(link);
          const key = page.url, digest = catalogHash(page.text), previous = state.pages[key];
          const old = state.entries.find(o => o.source.url === key);
          const at = new Date().toISOString();
          if (previous?.hash === digest && previous.outcome !== 'pending') {
            previous.checkedAt = at; previous.error = null;
            if (old?.imported) { old.imported.checkedAt = at; old.imported.detail!.checkedAt = at; old.source.verifiedAt = at.slice(0, 10); }
            continue;
          }
          if (old?.imported) old.imported.verification = 'pending';
          state.pages[key] = { hash: digest, checkedAt: at, outcome: 'pending', error: null };
          if (source.seeds.some(s => sourceUrl(s, source) === key)) { state.pages[key].outcome = 'not_measure'; continue; }
          if (!this.extract) { state.pages[key].error = 'EXTRACTION_NOT_CONFIGURED'; continue; }
          if (extracted >= 3) { state.cursor--; break; } extracted++;
          try {
            const item = verifiedOpportunity(await this.extract(page, source), page, source);
            if (!item) { state.pages[key].outcome = 'not_measure'; continue; }
            const seed = officialFundingCatalog.find(o => o.source.url && sourceUrl(o.source.url, source) === key);
            item.id = old?.id ?? seed?.id ?? item.id;
            item.imported!.firstSeenAt = old?.imported?.firstSeenAt ?? at;
            state.entries = [...state.entries.filter(o => o.id !== item.id && o.source.url !== key), item];
            state.pages[key].outcome = 'verified';
          } catch (error) { state.pages[key].error = diagnosticCode(error); state.error = diagnosticCode(error); }
        } catch (error) { state.error = diagnosticCode(error); }
      }
      if (fetched) state.checkedAt = new Date().toISOString();
      state.failures = state.error ? state.failures + 1 : 0; this.save(source);
      if (state.error) console.error(JSON.stringify({ event: 'funding_source', source: source.id, code: state.error }));
    } catch (error) { state.error = diagnosticCode(error); state.failures++; throw error; }
  }
  async enrich(id: string) {
    const item = this.getCatalog().find(o => o.id === id); if (!item?.imported) return undefined;
    if (Date.now() - Date.parse(item.imported.checkedAt ?? '') < 3600000 && item.imported.verification === 'verified') return item;
    // Only a regular verified import can renew freshness, never an old cached response.
    return item;
  }
}
