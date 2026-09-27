import { parseHTML } from 'linkedom';
import { sourceUrl, type FundingSource } from './source-registry';
export type ProgrammePage = { url: string; title: string; text: string; links: string[] };
export async function readProgrammePage(url: string, source: FundingSource, transport: typeof fetch = fetch): Promise<ProgrammePage> {
  const signal = AbortSignal.timeout(15000);
  for (let hop = 0; hop < 4; hop++) {
    if (!sourceUrl(url, source)) throw new Error('SOURCE_UNTRUSTED_URL');
    const response = await transport(url, { redirect: 'manual', signal, headers: { Accept: 'text/html', 'User-Agent': 'OporaFundingMonitor/1.0' } });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location'); await response.body?.cancel();
      if (!location) throw new Error('SOURCE_REDIRECT'); url = new URL(location, url).href; continue;
    }
    if (!response.ok) { await response.body?.cancel(); throw new Error(`SOURCE_HTTP_${response.status}`); }
    if (!response.headers.get('content-type')?.includes('text/html')) { await response.body?.cancel(); throw new Error('SOURCE_CONTENT_TYPE'); }
    const reader = response.body?.getReader(); if (!reader) throw new Error('SOURCE_EMPTY');
    const chunks: Uint8Array[] = []; let size = 0;
    try { while (true) { const part = await reader.read(); if (part.done) break; size += part.value.length;
      if (size > 2_000_000) throw new Error('SOURCE_TOO_LARGE'); chunks.push(part.value); }
    } finally { await reader.cancel(); reader.releaseLock(); }
    const { document } = parseHTML(new TextDecoder(/charset=windows-1251/i.test(response.headers.get('content-type') ?? '') ? 'windows-1251' : 'utf-8').decode(Buffer.concat(chunks)));
    const title = (document.querySelector('h1')?.textContent || document.title || '').replace(/\s+/g, ' ').trim().slice(0, 250);
    // Discover only public programme sections, never arbitrary linked hosts.
    const links = [...document.querySelectorAll('a[href]')].flatMap(a => {
      try { const next = sourceUrl(new URL(a.getAttribute('href')!, url).href, source);
        return next && /займ|заём|грант|субсид|поддержк|программ|финанс|поручительств|лизинг/i.test(a.textContent ?? '') ? [next] : [];
      } catch { return []; }
    });
    document.querySelectorAll('script,style,noscript,svg,nav,header,footer,form,iframe').forEach((e: { remove(): void }) => e.remove());
    const main = document.querySelector('main,article,[role="main"],.content-main,.page-content') ?? document.body;
    const text = (main?.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (text.length < 180 || /captcha|доступ ограничен|проверка браузера/i.test(title)) throw new Error('SOURCE_EMPTY');
    // Keep a bounded complete page; a truncated conditions page cannot be verified.
    if (text.length > 60000) throw new Error('SOURCE_TEXT_TOO_LARGE');
    return { url: sourceUrl(url, source)!, title, text, links: [...new Set(links)].slice(0, 60) };
  }
  throw new Error('SOURCE_REDIRECT_LIMIT');
}
