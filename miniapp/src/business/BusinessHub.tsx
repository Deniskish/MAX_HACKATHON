import { ActionButton } from './MaxControls';
import { Icon } from './Icon';
import { GlassArt } from './GlassArt';
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
      <GlassArt shape="tiles" size={150} className="hub-welcome-art" />
      <h2>Поддержка под<br />ваши задачи</h2>
      <p>Добавьте бизнес для персонального подбора поддержки.</p>
      <ActionButton className="primary" onClick={onAdd}>Добавить бизнес <Icon name="arrow" /></ActionButton>
      <button className="hub-browse" onClick={onSupport}>Смотреть каталог</button>
    </section>
    <section className="hub-benefits" aria-label="После добавления бизнеса">
      <h3>После добавления бизнеса</h3>
      <div><Icon name="compass" /><span><b>Персональный подбор</b></span></div>
      <div><Icon name="spark" /><span><b>AI-помощник</b></span></div>
      <div><Icon name="calendar" /><span><b>Заявки и календарь</b></span></div>
    </section>
  </div>;
  return <div className="business-hub">
    <section className="hub-identity">
      <div className="hub-identity-mark"><GlassArt shape="tiles" size={76} /></div>
      <div className="hub-identity-title"><h2>{profile.name}</h2><button aria-label="Редактировать профиль" onClick={onEdit}><Icon name="edit" /></button></div>
      <p>{profile.region}{project ? ' · Без юридического лица' : profile.okved ? ` · ОКВЭД ${profile.okved}` : ''}</p>
    </section>
    <div className="hub-stats">
      <button onClick={onSupport}><b>{confirmed}</b><span>Подходит<br />по правилам</span></button>
      <button onClick={onApplications}><b>{applications}</b><span>Ваши<br />заявки</span></button>
      <button onClick={onSaved}><b>{saved}</b><span>Сохранённые<br />программы</span></button>
    </div>
    <section className="hub-services" aria-label="Инструменты бизнеса">
      <button onClick={onAssistant}><span className="hub-service-icon"><Icon name="spark" /></span><span><b>AI-помощник</b></span><Icon name="chevron" size={17} /></button>
      <button onClick={onCalendar}><span className="hub-service-icon"><Icon name="calendar" /></span><span><b>Календарь</b></span><Icon name="chevron" size={17} /></button>
    </section>
    <button className="hub-next" onClick={insight ? () => onInsight(insight.action) : !purpose ? onNeed : applications ? onApplications : onSupport}>
      <b>{insight?.title ?? (!purpose ? 'Расскажите, на что нужны средства' : applications ? 'Продолжить подготовку заявки' : 'Посмотреть персональную подборку')}</b>
      <Icon name="arrow" />
    </button>
    {!confirmed && <p className="hub-hint">{pending ? `Нужно уточнить соответствие: ${pending} программ.` : 'Совпадений пока нет. Уточните профиль или посмотрите каталог.'}</p>}
    <button className="hub-need-link" onClick={onNeed}><Icon name="compass" size={18} />{purpose ? 'Изменить цель и сумму' : 'Настроить подбор'}<Icon name="chevron" size={15} /></button>
  </div>;
}
