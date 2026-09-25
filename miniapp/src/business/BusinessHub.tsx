import { ActionButton } from './MaxControls';
import { Icon } from './Icon';
import type { Profile } from './domain';
import type { WorkspaceInsight } from '../../api-server/ai/types';

export function BusinessHub({ profile, project, confirmed, pending, applications, saved, purpose, onAdd, onEdit, onSupport, onNeed, onAssistant, onCalendar, onApplications, onSaved, insight, onInsight }: {
  profile: Profile | null; project: boolean; confirmed: number; pending: number; applications: number; saved: number; purpose: string;
  onAdd: () => void; onEdit: () => void; onSupport: () => void; onNeed: () => void;
  onAssistant: () => void; onCalendar: () => void; onApplications: () => void; onSaved: () => void;
  insight?: WorkspaceInsight; onInsight: (action: WorkspaceInsight['action']) => void;
}) {
  if (!profile) return <div className="business-hub guest-hub">
    <section className="hub-welcome">
      <img src="/assets/briefcase.png" alt="" width={160} height={160} />
      <span className="hub-eyebrow">МОЙ БИЗНЕС</span>
      <h2>Поддержка под<br />ваши задачи</h2>
      <p>Сейчас вам доступен весь каталог. Добавьте компанию или проект, чтобы видеть возможности с учётом вашей ситуации.</p>
      <ActionButton className="primary" onClick={onAdd}>Добавить бизнес <Icon name="arrow" /></ActionButton>
      <button className="hub-browse" onClick={onSupport}>Продолжить просмотр каталога</button>
    </section>
    <section className="hub-benefits" aria-label="После добавления бизнеса">
      <h3>После добавления бизнеса</h3>
      <div><Icon name="compass" /><span><b>Персональная поддержка</b><small>Регион, деятельность, параметры бизнеса и цель</small></span></div>
      <div><Icon name="spark" /><span><b>AI-помощник</b><small>Разбор вашей ситуации и помощь с документами</small></span></div>
      <div><Icon name="calendar" /><span><b>Заявки и календарь</b><small>Черновики, комплект документов и важные сроки</small></span></div>
    </section>
  </div>;
  return <div className="business-hub">
    <section className="hub-identity">
      <span className="hub-eyebrow">{project ? 'ВАШ ПРОЕКТ' : 'ВАШ БИЗНЕС'}</span>
      <div className="hub-identity-title"><h2>{profile.name}</h2><button aria-label="Редактировать профиль" onClick={onEdit}><Icon name="edit" /></button></div>
      <p>{profile.region}{project ? ' · Без юридического лица' : profile.okved ? ` · ОКВЭД ${profile.okved}` : ''}</p>
      <span className="hub-personal"><i />Подбор по вашему профилю</span>
    </section>
    <div className="hub-stats">
      <button onClick={onSupport}><b>{confirmed}</b><span>Подходит<br />по правилам</span></button>
      <button onClick={onApplications}><b>{applications}</b><span>Ваши<br />заявки</span></button>
      <button onClick={onSaved}><b>{saved}</b><span>Сохранённые<br />программы</span></button>
    </div>
    <section className="hub-services" aria-label="Инструменты бизнеса">
      <button onClick={onAssistant}><span className="hub-service-icon"><Icon name="spark" /></span><span><b>AI-помощник</b><small>Знает ваш профиль и текущую цель</small></span><Icon name="chevron" size={17} /></button>
      <button onClick={onCalendar}><span className="hub-service-icon"><Icon name="calendar" /></span><span><b>Календарь</b><small>Сроки сохранённых программ и заявок</small></span><Icon name="chevron" size={17} /></button>
    </section>
    <button className="hub-next" onClick={insight ? () => onInsight(insight.action) : !purpose ? onNeed : applications ? onApplications : onSupport}>
      <span className="hub-eyebrow">{insight ? 'СЛЕДУЮЩИЙ ШАГ · AI' : 'СЛЕДУЮЩИЙ ШАГ · ПО ПРАВИЛАМ'}</span>
      <b>{insight?.title ?? (!purpose ? 'Расскажите, на что нужны средства' : applications ? 'Продолжить подготовку заявки' : 'Посмотреть персональную подборку')}</b>
      <span>{insight?.text ?? (purpose || 'Цель и сумма помогут точнее сравнить программы.')}</span><Icon name="arrow" />
    </button>
    {!confirmed && <p className="hub-hint">{pending ? `Для ${pending} программ нужно уточнить условия или сведения о бизнесе. Это ещё не подтверждение соответствия.` : 'Пока нет программ, соответствующих вашему профилю. Можно посмотреть весь каталог или уточнить сведения.'}</p>}
    <button className="hub-need-link" onClick={onNeed}><Icon name="compass" size={18} />{purpose ? 'Изменить цель и сумму' : 'Настроить подбор'}<Icon name="chevron" size={15} /></button>
  </div>;
}
