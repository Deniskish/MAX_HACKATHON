import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { getAIActivity, subscribeAIActivity } from './ai-activity';
import { aiErrorMessage, requestAI, type AIRequest, type AIResult } from './ai-client';
import { analysisDigest, reusableAnalysis, validPersonalization } from './workspace-analysis-cache';

const cacheKey = 'opora.ai.workspace.v1';
type AnalysisState = { fingerprint: string; status: 'loading' | 'ready' | 'unavailable'; data?: AIResult; at?: number; error?: string; refreshing?: boolean };
export function useBusinessAnalysis(context: AIRequest['context'] | null, sourceVersion: string, paused = false) {
  const fingerprint = JSON.stringify({ version: 1, context, sourceVersion });
  const [state, setState] = useState<AnalysisState>({ fingerprint: '', status: 'loading' });
  const currentState = useRef(state);
  const publish = (next: AnalysisState) => { currentState.current = next; setState(next); };
  const [retry, setRetry] = useState(0);
  const completedRetry = useRef(0);
  const failedAttempt = useRef('');
  const interactive = useSyncExternalStore(subscribeAIActivity, getAIActivity, () => 0);
  useEffect(() => {
    // An interactive conversation must not wait behind this tab's background job.
    // Effect cleanup cancels the HTTP request and the provider generation upstream.
    if (!context) {
      failedAttempt.current = '';
      completedRetry.current = retry;
      if (currentState.current.fingerprint) publish({ fingerprint: '', status: 'loading' });
      return;
    }
    if (paused || interactive > 0) return;
    const attempt = `${fingerprint}:${retry}`;
    // Navigation must not repeat a failed request or discard the visible failure.
    // Changed business facts or an explicit retry start a new attempt.
    if (failedAttempt.current === attempt) return;
    const controller = new AbortController();
    const unsubscribe = subscribeAIActivity(() => { if (getAIActivity() > 0) controller.abort(); });
    const timer = setTimeout(() => {
      void (async () => {
        let previous = currentState.current.fingerprint === fingerprint && reusableAnalysis(currentState.current)
          ? { data: currentState.current.data!, at: currentState.current.at! } : undefined;
        const loading = () => publish({ fingerprint, status: previous ? 'ready' : 'loading', ...previous, refreshing: true });
        const failed = (error: unknown) => {
          failedAttempt.current = attempt;
          // Never carry recommendations across changed facts/catalogue or beyond their expiry.
          if (!reusableAnalysis(previous)) previous = undefined;
          publish({ fingerprint, status: previous ? 'ready' : 'unavailable', ...previous, error: aiErrorMessage(error) });
        };
        loading();
        try {
          const digest = await analysisDigest(fingerprint);
          controller.signal.throwIfAborted();
          try {
            const saved = digest ? JSON.parse(localStorage.getItem(cacheKey) ?? 'null') : null;
            if (saved?.digest === digest && reusableAnalysis(saved) && (!previous || saved.at > previous.at)) {
              previous = { data: saved.data, at: saved.at };
            }
          } catch { /* Storage is optional. */ }
          if (previous && retry === completedRetry.current) {
            publish({ fingerprint, status: 'ready', ...previous }); return;
          }
          loading();
          controller.signal.throwIfAborted();
          const data = await requestAI({ task: 'workspace', question: 'Проанализируй бизнес и адаптируй все разделы приложения под его ситуацию: главную, каталог поддержки, заявки, календарь и помощника. Учитывай текущие цели и подготовку заявок.', context }, controller.signal);
          if (controller.signal.aborted) return;
          if (data.mode !== 'llm' || !validPersonalization(data.personalization)) {
            failed(data.providerFailure ?? 'INVALID_RESPONSE'); return;
          }
          completedRetry.current = retry;
          const at = Date.now(); publish({ fingerprint, status: 'ready', data, at });
          try { if (digest) localStorage.setItem(cacheKey, JSON.stringify({ digest, data, at })); } catch { /* Keep the analysis in memory. */ }
        } catch (error) { if (!controller.signal.aborted) failed(error); }
      })();
    }, 1800);
    return () => { clearTimeout(timer); unsubscribe(); controller.abort(); };
  }, [fingerprint, retry, paused, interactive]);
  return { status: context ? state.fingerprint === fingerprint ? state.status : 'loading' : 'guest' as const,
    data: state.fingerprint === fingerprint ? state.data : undefined,
    at: state.fingerprint === fingerprint ? state.at : undefined,
    error: state.fingerprint === fingerprint ? state.error : undefined,
    refreshing: state.fingerprint === fingerprint && !!state.refreshing,
    refresh: () => setRetry((n) => n + 1) };
}
export type BusinessAnalysis = ReturnType<typeof useBusinessAnalysis>;
