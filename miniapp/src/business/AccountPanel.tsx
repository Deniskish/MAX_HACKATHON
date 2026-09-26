import { useEffect, useRef, useState } from 'react';
import type { Profile } from './domain';
import { maxInitData } from './max-auth';
import { ContextHelp } from './ContextHelp';
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
    } finally { mutation.current = false; setLoading(false); }
  };
  return { account, error, available, loading, refresh,
    save: (company: Profile) => update('PUT', company),
    remove: () => update('DELETE') };
}
export function AccountPanel({ state, onRestore, onSave, hasCompany, presentation = false, esiaSignedIn = false }: { state: ReturnType<typeof useAccount>; onRestore: (profile: Profile) => void; onSave: () => void; hasCompany: boolean; presentation?: boolean; esiaSignedIn?: boolean }) {
  return <section className="profile-panel account-panel">
    <h3>{state.account ? 'Аккаунт MAX' : esiaSignedIn ? 'Аккаунт' : state.available ? 'Подключение аккаунта' : 'Гостевой режим'}</h3>
    <p>{state.account ? 'Вход подтверждён через MAX.' : esiaSignedIn ? 'Вход через Госуслуги.' : state.available ? 'Проверяем данные входа.' : 'Профиль хранится на этом устройстве. Для аккаунта откройте «Опору» через MAX.'}</p>
    {state.error && <p className="error" role="alert">{state.error}</p>}
    {state.error && <button className="secondary" onClick={() => void state.refresh()}>Повторить вход</button>}
    {state.account && hasCompany && !state.account.company && <button className="secondary" disabled={state.loading} onClick={onSave}>Сохранить компанию в аккаунте</button>}
    {state.account?.company && !hasCompany && <button className="secondary" onClick={() => onRestore(state.account!.company!)}>Загрузить компанию из аккаунта</button>}
    <ContextHelp title="Полномочия и подача заявок">
      <p>Вход через MAX подтверждает аккаунт пользователя. ИНН загружает открытые сведения о компании и не подтверждает, что вы её руководитель или представитель.</p>
      <p>{presentation ? 'Для подачи подтвердите полномочия выбранной компании и подготовьте комплект документов.' : 'Подбор поддержки и подготовка черновиков доступны. Подача проходит на сайте оператора программы.'}</p>
    </ContextHelp>
  </section>;
}
