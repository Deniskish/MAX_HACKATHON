import { useEffect, useState } from 'react';
import { officialFundingCatalog } from '../../api-server/funding-catalog/official-catalog';
import type { FundingOpportunity } from '../../api-server/funding-catalog/types';
const key = 'opora.live-catalog.v1';
function valid(value: unknown): value is FundingOpportunity[] {
  return Array.isArray(value) && value.length <= 50000 && value.every((o) => o && typeof o.id === 'string'
    && typeof o.title === 'string' && typeof o.providerName === 'string' && typeof o.version === 'string'
    && typeof o.description === 'string' && Array.isArray(o.purposes) && Array.isArray(o.requirements)
    && Array.isArray(o.requiredDocuments) && Array.isArray(o.sectors) && Array.isArray(o.okvedPrefixes)
    && Array.isArray(o.companyTypes) && (o.regions === 'all' || Array.isArray(o.regions)) && o.source?.type === 'official'
    && typeof o.source.url === 'string' && /^https:\/\//.test(o.source.url));
}
export function cachedCatalog() {
  try { const data = JSON.parse(localStorage.getItem(key) ?? 'null'); if (valid(data)) return data; } catch { /* Offline first launch. */ }
  return officialFundingCatalog;
}
export function useLiveCatalog() {
  const [catalog, setCatalog] = useState(cachedCatalog);
  const [status, setStatus] = useState<{ checkedAt: string | null; error: string | null } | null>(null);
  useEffect(() => {
    const controller = new AbortController(); let etag = '', busy = false;
    const refresh = async () => {
      if (busy || document.hidden) return;
      busy = true;
      // MAX may use an older Android WebView without AbortSignal.any/timeout.
      const request = new AbortController();
      const cancel = () => request.abort();
      controller.signal.addEventListener('abort', cancel, { once: true });
      if (controller.signal.aborted) cancel();
      const timer = setTimeout(cancel, 20000);
      try {
        const signal = request.signal;
        const response = await fetch('/api/funding/catalog', { headers: etag ? { 'If-None-Match': etag } : {}, signal });
        if (response.ok) {
          const data = await response.json();
          if (valid(data.opportunities) && !controller.signal.aborted) {
            setCatalog(data.opportunities); etag = response.headers.get('ETag') ?? '';
            try { localStorage.setItem(key, JSON.stringify(data.opportunities)); } catch { /* Low storage: keep the current session. */ }
          }
        }
        const health = await fetch('/api/funding/live-status', { signal });
        if (health.ok && !controller.signal.aborted) setStatus(await health.json());
      } catch { /* Keep the last successfully received catalogue. */ }
      finally { clearTimeout(timer); controller.signal.removeEventListener('abort', cancel); busy = false; }
    };
    void refresh(); const timer = setInterval(() => void refresh(), 60000);
    document.addEventListener('visibilitychange', refresh); window.addEventListener('online', refresh);
    return () => { controller.abort(); clearInterval(timer); document.removeEventListener('visibilitychange', refresh); window.removeEventListener('online', refresh); };
  }, []);
  return { catalog, status };
}
