import { useEffect, useRef, useState } from 'react';
import type { Profile } from './domain';
import { maxInitData } from './max-auth';
import { ActionButton } from './MaxControls';

type Account = { id: string; company: Profile | null; revision: number; identity: 'max'; authority: 'unverified'; esia: 'not_configured'; canSubmitApplications: false };
export function useAccount() {
  const [account, setAccount] = useState<Account | null>(null), [error, setError] = useState('');
  const [available, setAvailable] = useState(!!maxInitData()), [loading, setLoading] = useState(false);
  const generation = useRef(0);
  const mutation = useRef(false);
  const request = async (path = '', method = 'GET', body?: unknown): Promise<Account> => {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000);
    try {
    const response = await fetch('/api/account' + path, { method, headers: { 'X-Max-Init-Data': maxInitData(), 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined, signal: controller.signal });
    const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Нет связи с аккаунтом.'); return data;
    } finally { clearTimeout(timer); }
  };
  const refresh = async () => {
    if (!maxInitData() || mutation.current) return;
    const version = ++generation.current; setAvailable(true); setLoading(true);
    try { const next = await request(); if (version === generation.current) { setAccount(next); setError(''); } }
    catch (e) { if (version === generation.current) setError(e instanceof Error ? e.message : 'Нет связи с аккаунтом.'); }
    finally { if (version === generation.current) setLoading(false); }
  };
  useEffect(() => { void refresh(); const ready = () => void refresh(); window.addEventListener('opora:max-ready', ready); return () => { generation.current++; window.removeEventListener('opora:max-ready', ready); }; }, []);
  const update = async (method: string, company?: Profile) => {
    if (mutation.current) throw new Error('Дождитесь сохранения профиля.');
    mutation.current = true; generation.current++; setLoading(true);
    try {
      const next = await request('/company', method, company ? { company, revision: account?.revision } : undefined);
      setAccount(next); setError(''); return next;
    } catch (error) { setError(error instanceof Error ? error.message : 'ACCOUNT_UPDATE_FAILED'); throw error; }
    finally { mutation.current = false; setLoading(false); }
  };
  return { account, error, available, loading, refresh,
    save: (company: Profile) => update('PUT', company),
    remove: () => update('DELETE') };
}
export function AccountPanel({ state, onRestore, onSave, hasCompany }: { state: ReturnType<typeof useAccount>; onRestore: (profile: Profile) => void; onSave: () => void; hasCompany: boolean }) {
  return <section className="profile-panel account-panel">
    <h3>{state.account ? 'Аккаунт MAX' : state.available ? 'Подключение аккаунта' : 'Гостевой режим'}</h3>
    <p>{state.account ? 'Вход подтверждён через MAX.' : state.available ? state.loading ? 'Проверяем данные входа.' : 'Вход через MAX' : 'Профиль хранится на этом устройстве. Для аккаунта откройте «Опору» через MAX.'}</p>
    {state.error && !state.account && <ActionButton className="secondary" disabled={state.loading} onClick={() => void state.refresh()}>Повторить вход</ActionButton>}
    {state.account && hasCompany && !state.account.company && <ActionButton className="secondary" disabled={state.loading} onClick={onSave}>{state.error ? 'Повторить сохранение' : 'Сохранить компанию в аккаунте'}</ActionButton>}
    {state.account?.company && !hasCompany && <ActionButton className="secondary" onClick={() => onRestore(state.account!.company!)}>Загрузить компанию из аккаунта</ActionButton>}
  </section>;
}
