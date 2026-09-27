import { useEffect, useRef, useState } from 'react';
import { ActionButton } from './MaxControls';

import { Icon } from './Icon';
import type { Profile } from './domain';
import { demoConfirmed, demoKey, demoSubmit, emptyDemo, readDemo, type VerificationDemo } from './verification-demo';

export function useVerificationDemo() {
  const [state, setState] = useState(() => readDemo(localStorage));
  const current = useRef(state); current.current = state;
  const [error, setError] = useState('');
  function update(next: VerificationDemo) {
    try { localStorage.setItem(demoKey, JSON.stringify(next)); current.current = next; setState(next); setError(''); return true; }
    catch { setError('Не удалось сохранить тестовый сценарий на устройстве.'); return false; }
  }
  return { state, error, update, reset: () => update({ ...emptyDemo, receipts: [] }),
    submit: (input: Parameters<typeof demoSubmit>[1]) => update(demoSubmit(current.current, input)) };
}
export type DemoController = ReturnType<typeof useVerificationDemo>;

export function CompanyVerificationCard({ demo, inn, onOpen }: { demo: DemoController; inn: string; onOpen: () => void }) {
  const confirmed = demoConfirmed(demo.state, inn);
  return <section className={`company-verification-card${confirmed ? ' is-confirmed' : ''}`} aria-label="Подтверждение компании через Госуслуги">
    <div className="company-verification-heading">
      <span className="company-verification-mark"><img src="/brand/gosuslugi.svg" width={36} height={36} alt="Госуслуги" /></span>
      <div><h3>{confirmed ? 'Компания подтверждена' : 'Подтвердите компанию'}</h3><p>{confirmed ? 'Через Госуслуги' : 'Через Госуслуги — для подачи заявок'}</p></div>
      {confirmed && <span className="company-verification-check"><Icon name="check" size={20} /></span>}
    </div>
    {confirmed ? <button className="text-button" onClick={demo.reset}>Отключить Госуслуги</button>
      : <ActionButton className="primary" onClick={onOpen}>Подтвердить через Госуслуги<Icon name="arrow" size={18} /></ActionButton>}
  </section>;
}

export function VerificationPage({ demo, company, onAdd, onDone }: { demo: DemoController; company: Profile | null; onAdd: () => void; onDone: () => void }) {
  const [consent, setConsent] = useState(false), [role, setRole] = useState('director');
  const confirmed = demoConfirmed(demo.state, company?.inn);
  if (!demo.state.enabled) return <section className="profile-panel"><h2>Вход не выполнен</h2><ActionButton onClick={onDone}>В мой бизнес</ActionButton></section>;
  return <section className="verification-page">
    <ol className="verification-steps" aria-label="Этапы проверки">
      {['Вход', 'Компания', 'Готово'].map((text, i) => <li key={text} aria-current={(confirmed ? 2 : demo.state.signedIn ? 1 : 0) === i ? 'step' : undefined}><span>{i + 1}</span>{text}</li>)}
    </ol>
    {!demo.state.signedIn ? <section className="profile-panel verification-sign-in">
      <Icon name="building" size={34} /><h2>Вход через Госуслуги</h2>
      <p>Разрешите доступ к профилю и сведениям об организациях.</p>
      <label className="checklist-title verification-consent"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} />Разрешить доступ</label>
      <div className="verification-actions"><ActionButton className="primary" disabled={!consent} onClick={() => demo.update({ ...demo.state, signedIn: true })}>Продолжить</ActionButton>
      <ActionButton className="secondary" onClick={onDone}>Отмена</ActionButton></div>
    </section> : !company ? <section className="profile-panel"><h2>Выберите компанию</h2><p>Загрузите её по ИНН, затем подтвердите полномочия.</p><ActionButton className="primary" onClick={onAdd}>Добавить компанию по ИНН</ActionButton></section>
      : !confirmed ? <section className="profile-panel">
        <h2>Подтверждение компании</h2><p>{company.name}<br />ИНН {company.inn}</p>
        <label className="field">Ваша роль<select value={role} onChange={e => setRole(e.target.value)}><option value="director">Руководитель</option><option value="representative">Представитель с полномочиями</option><option value="none">Нет полномочий</option></select></label>
        <ActionButton className="primary" disabled={role === 'none'} onClick={() => {
          if (role === 'none') return;
          demo.update({ ...demo.state, inn: company.inn, role: role as 'director' | 'representative' });
        }}>Подтвердить компанию</ActionButton>
      </section> : <section className="profile-panel"><Icon name="check" size={34} /><h2>Компания подтверждена</h2><p>{company.name}</p><p>Подготовьте комплект документов и перейдите к подаче.</p><ActionButton className="primary" onClick={onDone}>Продолжить</ActionButton></section>}
  </section>;
}

export function DemoSubmission({ demo, company, applicationId, title, ready, onVerify }: { demo: DemoController; company: Profile; applicationId: string; title: string; ready: boolean; onVerify: () => void }) {
  const [consent, setConsent] = useState(false), [error, setError] = useState('');
  useEffect(() => { setConsent(false); setError(''); }, [applicationId, company.inn]);
  const receipt = demo.state.receipts.find(r => r.applicationId === applicationId && r.inn === company.inn);
  return <section className="profile-panel demo-submission"><h3>Подача заявки</h3>
    {receipt ? <div role="status"><b>Заявка принята</b><p>{receipt.id} · {new Date(receipt.createdAt).toLocaleString('ru-RU')}</p><p>Статус сохранён в разделе «Заявки».</p></div>
      : !demoConfirmed(demo.state, company.inn) ? <><p>Для подачи нужны вход и подтверждение компании.</p><ActionButton className="secondary" onClick={onVerify}>Подтвердить полномочия</ActionButton></>
      : <><p>{ready ? 'Комплект готов к отправке.' : 'Заполните описание, отметьте документы и подтвердите проверку комплекта выше.'}</p>
        <label className="checklist-title"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} />Подтверждаю отправку заявки</label>
        <ActionButton className="primary" disabled={!ready || !consent} onClick={() => {
          try { if (demo.submit({ applicationId, inn: company.inn, title, ready })) setError(''); } catch (e) { setError((e as Error).message); }
        }}>{error || demo.error ? 'Повторить отправку' : 'Отправить заявку'}</ActionButton></>}
  </section>;
}
