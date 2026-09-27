import { Icon } from './Icon';
import { ThemedImage } from './ThemedImage';

export type AppPage = 'overview' | 'programs' | 'applications' | 'calendar' | 'profile' | 'assistant' | 'funding-results' | 'settings' | 'verification' | 'business-details';
export type MainTab = 'overview' | 'programs' | 'applications' | 'profile';
export function navigationTab(page: AppPage): MainTab | null {
  if (page === 'settings' || page === 'verification' || page === 'assistant') return null;
  if (page === 'funding-results') return 'programs';
  if (page === 'calendar' || page === 'business-details') return 'profile';
  return page;
}

export function BrandWordmark({ className = '' }: { className?: string }) {
  return <span className={`home-wordmark ${className}`}>
    <ThemedImage src="/assets/opora-logo.png" sizes={className.includes('hero') ? '260px' : '140px'} width={1254} height={1254} alt="опора." draggable={false} />
  </span>;
}

export function AppNavigation({ active, onNavigate }: {
  active: AppPage; onNavigate: (page: AppPage) => void;
}) {
  const tab = navigationTab(active);
  return <div className="home-nav-wrap">
    <nav className="home-nav" data-active={tab === 'overview' ? 0 : tab === 'programs' ? 1 : tab === 'applications' ? 2 : tab === 'profile' ? 3 : undefined} aria-label="Основная навигация">
      {tab && <span className="home-nav-indicator" aria-hidden="true" />}
      {([
        ['overview', 'home', 'Главная'], ['programs', 'compass', 'Поддержка'], ['applications', 'file', 'Заявки'],
      ] as const).map(([page, icon, label]) => <button key={page} type="button" className={`nav-${page}`}
        aria-current={tab === page ? 'page' : undefined} onClick={() => onNavigate(page)}>
        <Icon name={icon} /><span>{label}</span>
      </button>)}
      <button type="button" aria-current={tab === 'profile' ? 'page' : undefined} onClick={() => onNavigate('profile')}>
        <Icon name="building" /><span>Мой бизнес</span>
      </button>
    </nav>
  </div>;
}

export function AppHeader({ title, onBack, onSettings, hasNotifications, backLabel = 'На главную' }: {
  title: string; onBack: () => void; onSettings?: () => void; hasNotifications: boolean; backLabel?: string;
}) {
  return <header className="app-topbar">
    <button type="button" className="app-back icon-button" aria-label={backLabel} onClick={onBack}><Icon name="chevron" /></button>
    <h1>{title}</h1>
    {onSettings ? <button type="button" className="home-notifications" aria-label={hasNotifications ? 'Настройки — есть новые уведомления' : 'Настройки'} onClick={onSettings}>
      <Icon name="settings" size={22} />
      {hasNotifications && <span className="home-notification-dot" aria-hidden="true" />}
    </button> : <span className="app-header-spacer" aria-hidden="true" />}
  </header>;
}
