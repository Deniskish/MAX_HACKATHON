import { useEffect, useState } from 'react';
import { requestAI, type AIRequest, type AIResult } from './ai-client';
import { workspaceActions, workspacePages, type AIPersonalization } from '../../api-server/ai/types';

const cacheKey = 'opora.ai.workspace.v1';
export function validPersonalization(value: unknown): value is AIPersonalization {
  const data = value as AIPersonalization | null;
  return !!data && typeof data.summary === 'string' && data.summary.length <= 700 && !!data.sections
    && workspacePages.every((p) => { const s = data.sections[p]; return s && typeof s.title === 'string' && s.title.length <= 60
      && typeof s.text === 'string' && s.text.length <= 300 && workspaceActions.includes(s.action); })
    && Array.isArray(data.priorities) && data.priorities.length <= 6
    && data.priorities.every((p) => p && typeof p.programId === 'string' && typeof p.reason === 'string' && p.reason.length <= 300);
}
export function useBusinessAnalysis(context: AIRequest['context'] | null, sourceVersion: string) {
  const fingerprint = JSON.stringify({ version: 1, context, sourceVersion });
  const [state, setState] = useState<{ fingerprint: string; status: 'loading' | 'ready' | 'unavailable'; data?: AIResult; at?: number }>({ fingerprint: '', status: 'loading' });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!context) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void (async () => {
        setState({ fingerprint, status: 'loading' });
        try {
          const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(fingerprint)))].map((n) => n.toString(16).padStart(2, '0')).join('');
          try {
            const saved = JSON.parse(localStorage.getItem(cacheKey) ?? 'null');
            if (!retry && saved?.digest === digest && Date.now() - saved.at < 4 * 60 * 60 * 1000 && saved.data?.mode === 'llm' && validPersonalization(saved.data.personalization)) {
              if (!controller.signal.aborted) setState({ fingerprint, status: 'ready', data: saved.data, at: saved.at });
              return;
            }
          } catch { /* Storage is optional. */ }
          controller.signal.throwIfAborted();
          const data = await requestAI({ task: 'workspace', question: 'Проанализируй бизнес и адаптируй все разделы приложения под его ситуацию: главную, каталог поддержки, заявки, календарь и помощника. Учитывай текущие цели и подготовку заявок. Верни personalization.', context }, AbortSignal.any([controller.signal, AbortSignal.timeout(70000)]));
          if (controller.signal.aborted) return;
          if (data.mode !== 'llm' || !validPersonalization(data.personalization)) { setState({ fingerprint, status: 'unavailable' }); return; }
          const at = Date.now(); setState({ fingerprint, status: 'ready', data, at });
          try { localStorage.setItem(cacheKey, JSON.stringify({ digest, data, at })); } catch { /* Keep the analysis in memory. */ }
        } catch { if (!controller.signal.aborted) setState({ fingerprint, status: 'unavailable' }); }
      })();
    }, 1800);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [fingerprint, retry]);
  return { status: context ? state.fingerprint === fingerprint ? state.status : 'loading' : 'guest' as const,
    data: state.fingerprint === fingerprint ? state.data : undefined,
    at: state.fingerprint === fingerprint ? state.at : undefined,
    refresh: () => setRetry((n) => n + 1) };
}
export type BusinessAnalysis = ReturnType<typeof useBusinessAnalysis>;
