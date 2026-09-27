import { Icon } from './Icon';
import { ThemedImage } from './ThemedImage';

export type AppPage = 'overview' | 'programs' | 'applications' | 'calendar' | 'profile' | 'assistant' | 'funding-results' | 'settings' | 'verification' | 'business-details';

export function BrandWordmark({ className = '' }: { className?: string }) {
  return <span className={`home-wordmark ${className}`}>
    <ThemedImage src="/assets/opora-logo.png" sizes={className.includes('hero') ? '260px' : '140px'} width={1254} height={1254} alt="опора." draggable={false} />
  </span>;
}

export function AppNavigation({ active, onNavigate }: {
  active: AppPage; onNavigate: (page: AppPage) => void;
}) {
  return <div className="home-nav-wrap">
    <nav className="home-nav" data-active={active === 'overview' ? 0 : ['programs', 'funding-results'].includes(active) ? 1 : active === 'applications' ? 2 : 3} aria-label="Основная навигация">
      <span className="home-nav-indicator" aria-hidden="true" />
      {([
        ['overview', 'home', 'Главная'], ['programs', 'compass', 'Поддержка'], ['applications', 'file', 'Заявки'],
      ] as const).map(([page, icon, label]) => <button key={page} type="button" className={`nav-${page}`}
        aria-current={active === page || page === 'programs' && active === 'funding-results' ? 'page' : undefined} onClick={() => onNavigate(page)}>
        <Icon name={icon} /><span>{label}</span>
      </button>)}
      <button type="button" aria-current={['calendar', 'profile', 'assistant', 'settings', 'verification', 'business-details'].includes(active) ? 'page' : undefined} onClick={() => onNavigate('profile')}>
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
