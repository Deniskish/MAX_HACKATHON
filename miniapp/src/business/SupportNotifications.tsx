import { useEffect, useRef, useState } from 'react';
import type { FundingNeed, FundingProfile } from '../../api-server/funding-catalog/types';
import { ActionButton } from './MaxControls';
import { ContextHelp } from './ContextHelp';
import { maxInitData } from './max-auth';
type Notice = { id: string; programId: string; title: string; reason: string; source: string; createdAt: number; readAt: number | null; delivery: string };
type State = { enabled: boolean; bot: boolean; aiConfigured: boolean; items: Notice[]; monitor?: { lastRun: string | null; lastError: string | null } };
export function useSupportNotifications(profile: FundingProfile | null, need: FundingNeed) {
  const [state, setState] = useState<State>({ enabled: false, bot: false, aiConfigured: true, items: [] });
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const current = useRef({ profile, need }); current.current = { profile, need };
  const revision = useRef(0);
  const mutations = useRef<Promise<unknown>>(Promise.resolve());
  function mutate<T>(run: () => Promise<T>): Promise<T> {
    const next = mutations.current.then(run, run); mutations.current = next.catch(() => {}); return next;
  }
  const fingerprint = JSON.stringify({ profile, need });
  const [available, setAvailable] = useState(!!maxInitData());
  useEffect(() => {
    const ready = () => setAvailable(!!maxInitData());
    ready(); window.addEventListener('opora:max-ready', ready);
    return () => window.removeEventListener('opora:max-ready', ready);
  }, []);
  const request = async (path = '', method = 'GET', body?: unknown) => {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000);
    try {
    const response = await fetch('/api/notifications' + path, { method,
      headers: { 'X-Max-Init-Data': maxInitData(), 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined, signal: controller.signal });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Не удалось обновить уведомления.');
    return data;
    } finally { clearTimeout(timer); }
  };
  useEffect(() => {
    if (!available) return;
    let cancelled = false, running = false;
    const refresh = async (syncProfile = false) => {
      if (running || document.hidden) return;
      running = true;
      const version = revision.current;
      try {
        let data: State = await request();
        if (cancelled || version !== revision.current) return;
        if (syncProfile && data.enabled) {
          await mutate(async () => {
            if (cancelled || version !== revision.current) return;
            if (current.current.profile) await request('/subscription', 'PUT', { ...current.current, bot: data.bot });
            // A new device has no local profile yet. Only explicit removal may unsubscribe it.
          });
          data = await request();
        }
        if (!cancelled && version === revision.current) { setState(data); setError(''); }
      } catch (e) { if (!cancelled) setError(e instanceof Error ? e.message : 'Нет связи с сервером.'); }
      finally { running = false; }
    };
    void refresh(true); const timer = setInterval(() => void refresh(), 60000);
    const onVisible = () => void refresh(); document.addEventListener('visibilitychange', onVisible);
    return () => { cancelled = true; clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [available, fingerprint]);
  const subscribe = async (enabled: boolean, bot: boolean) => {
    revision.current++;
    setBusy(true); setError('');
    try {
      await mutate(() => request('/subscription', enabled ? 'PUT' : 'DELETE', enabled ? { ...current.current, bot } : undefined));
      setState(await request());
      return true;
    } catch (e) { setError(e instanceof Error ? e.message : 'Не удалось сохранить.'); return false; }
    finally { setBusy(false); }
  };
  const read = async (id: string) => {
    try { await request('/read', 'POST', { id }); setState((s) => ({ ...s, items: s.items.map((n) => n.id === id ? { ...n, readAt: Date.now() } : n) })); }
    catch { /* Remains unread until the server confirms. */ }
  };
  return { ...state, available, busy, error, subscribe, read };
}
export function SupportNotificationSettings({ notifications: n }: { notifications: ReturnType<typeof useSupportNotifications> }) {
  return <section className="profile-panel support-notification-settings">
    <h3>Новые меры поддержки</h3>
    <p>{n.enabled ? 'Следим за мерами для вашего бизнеса.' : 'Сообщим, когда найдём подходящую возможность.'}</p>
    {n.available ? <>
      <label className="notification-toggle"><span>Уведомления в приложении</span><input type="checkbox" checked={n.enabled} disabled={n.busy} onChange={(e) => void n.subscribe(e.target.checked, e.target.checked && n.bot)} /></label>
      <label className="notification-toggle"><span>Сообщения от бота MAX</span><input type="checkbox" checked={n.bot} disabled={n.busy || !n.enabled} onChange={(e) => void n.subscribe(true, e.target.checked)} /></label>
      {!n.aiConfigured && <p role="status">AI-проверка временно недоступна. Подписка сохранится.</p>}
      {n.aiConfigured && n.monitor?.lastError && <p role="status">Проверка или доставка задерживается. Повторим автоматически.</p>}
      {n.error && <p className="error" role="alert">{n.error}</p>}
    </> : <p>Откройте «Опору» в MAX, чтобы подключить уведомления.</p>}
    <ContextHelp title="Как это работает"><p>Проверяем официальный каталог каждые 15 минут. AI сравнивает новые меры с регионом, деятельностью и целями бизнеса. Подтверждение всех условий и решение по заявке остаются у оператора.</p><p>Для фоновой проверки на сервере сохраняются параметры подбора и ваш ID в MAX. ИНН, название компании и документы не отправляются. Отключение уведомлений удаляет подписку и её историю.</p><p>Бот сможет написать, если вы начали с ним диалог и не заблокировали его. Повторите вход в приложение, если MAX просит обновить авторизацию.</p></ContextHelp>
  </section>;
}
export function SupportNotificationList({ notifications: n, onOpen }: { notifications: ReturnType<typeof useSupportNotifications>; onOpen: (id: string) => void }) {
  return <>{n.items.map((item) => <article className="ai-proposal" key={item.id}>
    <span className="tag">{item.readAt ? 'Мера поддержки' : 'Новое для вашего бизнеса'}</span><h3>{item.title}</h3>
    <p>{item.reason}</p><ActionButton className="secondary" onClick={() => { void n.read(item.id); onOpen(item.programId); }}>Посмотреть меру</ActionButton>
    {item.delivery === 'failed' && <small>Сообщение в MAX не доставлено. Проверьте, доступен ли бот.</small>}
  </article>)}</>;
}
