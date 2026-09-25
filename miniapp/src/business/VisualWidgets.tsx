// Небольшие общие виджеты: категории, карточка бизнеса и этапы подготовки.
import { useState } from 'react';
import { Icon } from './Icon';
import { ActionButton } from './MaxControls';
import { BrandWordmark } from './AppChrome';
import { type Profile } from './domain';

export const supportCategories = [
  { label: 'Гранты', filter: 'Грант', icon: 'spark', tone: 'violet' },
  { label: 'Субсидии', filter: 'Субсидия', icon: 'cube', tone: 'orange' },
  { label: 'Кредиты', filter: 'Льготный кредит', icon: 'loan', tone: 'blue' },
  { label: 'Компенсации', filter: 'Компенсация', icon: 'refresh', tone: 'pink' },
  { label: 'Налоги', filter: 'Налоговая льгота', icon: 'percent', tone: 'orange' },
  { label: 'Гарантии', filter: 'Гарантия', icon: 'shield', tone: 'green' },
  { label: 'Лизинг', filter: 'Лизинг', icon: 'lease', tone: 'blue' },
  { label: 'Акселераторы', filter: 'Акселератор', icon: 'growth', tone: 'violet' },
  { label: 'Имущество', filter: 'Имущественная поддержка', icon: 'building', tone: 'orange' },
  { label: 'Микрозаймы', filter: 'Микрозаём', icon: 'loan', tone: 'blue' },
  { label: 'Консультации', filter: 'Консультации', icon: 'people', tone: 'green' },
  { label: 'Сбыт и закупки', filter: 'Сбыт и закупки', icon: 'globe', tone: 'pink' },
];
export const supportFilters = ['Все меры', ...supportCategories.map((c) => c.filter)];
export function Orb({ small = false }: { small?: boolean }) {
  return <span className={'color-orb ' + (small ? 'small' : '')} aria-hidden="true" />;
}
function PanelHeading({
  title,
  action,
  onAction,
}: {
  title: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <div className="widget-heading">
      <h2>{title}</h2>
      {onAction && (
        <button className="widget-chevron" onClick={onAction} aria-label={action || title}>
          <Icon name="chevron" size={17} />
        </button>
      )}
    </div>
  );
}
export function CategoryWidget({
  onChoose,
  active = 'Все меры',
}: {
  onChoose: (type: string) => void;
  active?: string;
}) {
  return (
    <section className="widget category-widget">
      <PanelHeading title="Виды поддержки" />
      <div className="service-grid">
        {supportCategories.map((c) => (
          <button
            key={c.filter}
            aria-pressed={active === c.filter}
            onClick={() => onChoose(c.filter)}
            className={active === c.filter ? 'selected' : ''}
          >
            <span className={`service-icon tone-${c.tone}`}>
              <Icon name={c.icon} size={26} />
            </span>
            <span>{c.label}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
export function BusinessCard({ profile, onEdit }: { profile: Profile | null; onEdit: () => void }) {
  const [visible, setVisible] = useState(false);
  return (
    <section className="business-card-widget">
      <div className="black-business-card">
        <BrandWordmark className="profile-wordmark" />
        <img className="profile-briefcase" src="/assets/briefcase.png" width={100} height={100} alt="" />
        <div className="black-card-meta">
          <span>{profile?.companyType || 'ВАШ БИЗНЕС'}</span>
          <span>{profile && !profile.inn ? 'Профиль проекта' : 'Профиль компании'}</span>
        </div>
        <strong>{profile?.name || 'Здесь начинается рост'}</strong>
        <div className="black-card-bottom">
          <span>
            {profile?.inn
              ? visible
                ? profile.inn
                : `•••• •••• ${profile.inn.slice(-4)}`
              : profile ? 'Проект без компании' : 'Добавьте компанию или проект'}
          </span>
        </div>
      </div>
      <button
        className="card-reveal"
        disabled={!profile?.inn}
        onClick={() => setVisible((v) => !v)}
        aria-pressed={visible}
      >
        <Icon name={visible ? 'eyeOff' : 'eye'} size={18} />
        {visible ? 'Скрыть ИНН' : 'Показать ИНН'}
      </button>
      <ActionButton className="primary dark-action" onClick={onEdit}>
        <Icon name="building" size={18} />
        {profile ? 'Редактировать профиль' : 'Добавить бизнес'}
      </ActionButton>
    </section>
  );
}
export function DetailSteps({
  prepared,
  total,
  hasProject,
  hasBudget,
}: {
  prepared: number;
  total: number;
  hasProject: boolean;
  hasBudget: boolean;
}) {
  const selected = prepared < total ? 0 : !hasProject ? 1 : !hasBudget ? 2 : -1;
  const steps = [
    {
      title: 'Документы',
      description: `${prepared} из ${total}`,
      done: prepared === total,
      target: 'application-documents',
    },
    {
      title: 'Проект',
      description: hasProject ? 'Описан' : 'Добавьте идею',
      done: hasProject,
      target: 'application-project',
    },
    {
      title: 'Бюджет',
      description: hasBudget ? 'Указан' : 'Рассчитайте',
      done: hasBudget,
      target: 'application-budget',
    },
  ];
  return (
    <section className="widget preparation-widget">
      <PanelHeading title="Подготовим заявку" />
      <div className="preparation-options">
        {steps.map((s, i) => (
          <button
            key={s.title}
            className={i === selected ? 'current' : ''}
            onClick={() =>
              document
                .getElementById(s.target)
                ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
            }
          >
            <span className={'step-radio ' + (s.done ? 'complete' : '')}>
              {s.done ? <Icon name="check" size={13} /> : i === selected ? <i /> : null}
            </span>
            <b>{s.title}</b>
            <small>{s.description}</small>
          </button>
        ))}
      </div>
    </section>
  );
}
