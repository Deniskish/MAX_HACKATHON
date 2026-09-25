import { ThemedImage } from './business/ThemedImage';
import { useState, type FormEvent } from 'react';
import { ActionButton, BusinessInput } from './business/MaxControls';
import { BrandWordmark } from './business/AppChrome';

type Workspace = typeof import('./business/BusinessApp')['default'];
let workspaceRequest: Promise<Workspace> | undefined;
function loadWorkspace() {
  return workspaceRequest ??= import('./business/BusinessApp')
    .then((module) => module.default)
    .catch((error: unknown) => { workspaceRequest = undefined; throw error; });
}

// Демонстрационный экран доступа, не серверная авторизация API.
// Доступ хранится только в памяти: при новом открытии нужен пароль.
export default function App() {
  const [WorkspaceApp, setWorkspaceApp] = useState<Workspace | null>(null);
  const [opening, setOpening] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  async function unlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (opening) return;
    if (password !== '20042004') {
      setError('Неверный пароль. Попробуйте ещё раз.');
      return;
    }
    setOpening(true);
    setLoadFailed(false);
    setError('');
    try {
      const component = await loadWorkspace();
      setPassword('');
      setWorkspaceApp(() => component);
    } catch {
      setLoadFailed(true);
      setError('Не удалось загрузить приложение. Проверьте интернет и обновите страницу.');
    } finally {
      setOpening(false);
    }
  }

  if (WorkspaceApp) return <WorkspaceApp />;

  return (
    <main className="access-screen">
      <BrandWordmark className="access-wordmark" />
      <section className="widget access-card" aria-labelledby="access-title">
        <ThemedImage className="access-symbol" src="/assets/orb.png" width={80} height={80} alt="" draggable={false} />
        <h1 id="access-title">Добро пожаловать<br />в Опору</h1>
        <p>Введите пароль, чтобы войти в рабочее пространство.</p>
        <form onSubmit={unlock}>
          <label className="field" htmlFor="access-password">Пароль
            <BusinessInput
              id="access-password"
              type="password"
              autoComplete="current-password"
              inputMode="numeric"
              placeholder="Введите пароль"
              required
              value={password}
              onFocus={() => { void loadWorkspace().catch(() => {}); }}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? 'access-error' : undefined}
              onChange={(event) => { setPassword(event.target.value); setError(''); }}
            />
          </label>
          {error && <p className="error" id="access-error" role="alert">{error}</p>}
          <ActionButton className="primary" type="submit" disabled={opening} aria-busy={opening}>
            {opening ? 'Открываем…' : 'Войти'}
          </ActionButton>
          {loadFailed && <ActionButton className="secondary" onClick={() => window.location.reload()}>
            Обновить страницу
          </ActionButton>}
        </form>
      </section>
    </main>
  );
}
