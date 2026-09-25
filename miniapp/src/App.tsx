import { useState, type FormEvent } from 'react';
import BusinessApp from './business/BusinessApp';
import { ActionButton, BusinessInput } from './business/MaxControls';
import { BrandWordmark } from './business/AppChrome';

// Демонстрационный экран доступа, не серверная авторизация API.
// Доступ хранится только в памяти: при новом открытии нужен пароль.
export default function App() {
  const [unlocked, setUnlocked] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  function unlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password !== '20042004') {
      setError('Неверный пароль. Попробуйте ещё раз.');
      return;
    }
    setPassword('');
    setUnlocked(true);
  }

  if (unlocked) return <BusinessApp />;

  return (
    <main className="access-screen">
      <BrandWordmark className="access-wordmark" />
      <section className="widget access-card" aria-labelledby="access-title">
        <img className="access-symbol" src="/assets/orb.png" width={80} height={80} alt="" draggable={false} />
        <span className="eyebrow">ПОДДЕРЖКА ВАШЕГО БИЗНЕСА</span>
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
              aria-invalid={Boolean(error)}
              aria-describedby={error ? 'access-error' : undefined}
              onChange={(event) => { setPassword(event.target.value); setError(''); }}
            />
          </label>
          {error && <p className="error" id="access-error" role="alert">{error}</p>}
          <ActionButton className="primary" type="submit">Войти</ActionButton>
        </form>
      </section>
    </main>
  );
}
