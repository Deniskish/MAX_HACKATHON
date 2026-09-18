// Обновляем анализ после смены профиля; отменённый запрос не должен перезаписать новый.
import { useEffect, useRef, useState } from 'react';
import { type Profile, type Application } from './domain';
import {
  analysisContext,
  requestBusinessAnalysis,
  type BusinessAnalysis,
} from './business-analysis';

export function useBusinessAnalysis(profile: Profile | null, apps: Application[]) {
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<(BusinessAnalysis & { fingerprint: string }) | null>(null);
  const [loading, setLoading] = useState(false);
  const appsRef = useRef(apps);
  appsRef.current = apps;
  const fingerprint = profile ? JSON.stringify(analysisContext(profile, apps)) : '';
  useEffect(() => {
    if (!profile) {
      setResult(null);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setResult(null);
    // Ждём окончания правок профиля; каждый ввод цифры в бюджет не запускает анализ.
    const timer = setTimeout(() => {
      const currentApps = appsRef.current;
      const requestFingerprint = JSON.stringify(analysisContext(profile, currentApps));
      void requestBusinessAnalysis(
        profile,
        currentApps,
        AbortSignal.any([controller.signal, AbortSignal.timeout(45000)]),
      )
        .then((response) => {
          if (!controller.signal.aborted)
            setResult({ ...response, fingerprint: requestFingerprint });
        })
        .catch(() => {
          if (!controller.signal.aborted)
            setResult({
              mode: 'local',
              text: 'Анализ не завершён. Повторите запрос.',
              fingerprint: requestFingerprint,
            });
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 600);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [profile, revision]);
  return {
    result,
    loading,
    stale: !!result && result.fingerprint !== fingerprint,
    refresh: () => setRevision((n) => n + 1),
  };
}
