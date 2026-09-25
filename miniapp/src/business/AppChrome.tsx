import { Icon } from './Icon';
import { ThemedImage } from './ThemedImage';

export type AppPage = 'overview' | 'programs' | 'applications' | 'calendar' | 'profile' | 'assistant' | 'funding-results';

export function BrandWordmark({ className = '' }: { className?: string }) {
  return <span className={`home-wordmark ${className}`}>
    <ThemedImage src="/assets/opora-logo.png" width={1254} height={1254} alt="опора." draggable={false} />
  </span>;
}

export function AppNavigation({ active, onNavigate }: {
  active: AppPage; onNavigate: (page: AppPage) => void;
}) {
  return <div className="home-nav-wrap">
    <nav className="home-nav" aria-label="Основная навигация">
      {([
        ['overview', 'home', 'Главная'], ['programs', 'compass', 'Поддержка'], ['applications', 'file', 'Заявки'],
      ] as const).map(([page, icon, label]) => <button key={page} type="button" className={`nav-${page}`}
        aria-current={active === page || page === 'programs' && active === 'funding-results' ? 'page' : undefined} onClick={() => onNavigate(page)}>
        <Icon name={icon} /><span>{label}</span>
      </button>)}
      <button type="button" aria-current={['calendar', 'profile', 'assistant'].includes(active) ? 'page' : undefined} onClick={() => onNavigate('profile')}>
        <Icon name="building" /><span>Мой бизнес</span>
      </button>
    </nav>
  </div>;
}

export function AppHeader({ title, onBack, onNotifications, hasNotifications, backLabel = 'На главную' }: {
  title: string; onBack: () => void; onNotifications: () => void; hasNotifications: boolean; backLabel?: string;
}) {
  return <header className="app-topbar">
    <button type="button" className="app-back icon-button" aria-label={backLabel} onClick={onBack}><Icon name="chevron" /></button>
    <h1>{title}</h1>
    <button type="button" className="home-notifications" aria-label="Уведомления" onClick={onNotifications}>
      <Icon name="bell" size={22} />{hasNotifications && <span className="home-notification-dot" aria-hidden="true" />}
    </button>
  </header>;
}
