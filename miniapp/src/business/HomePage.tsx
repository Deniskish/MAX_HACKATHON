import { Icon } from './Icon';
import { AppNavigation, BrandWordmark } from './AppChrome';

type HomePageProps = {
  onFindSupport: () => void;
  onAddBusiness: () => void;
  onOpportunities: () => void;
  onNotifications: () => void;
  onApplications: () => void;
  onMore: () => void;
  hasNotifications: boolean;
};

function Arrow() {
  return <span className="home-arrow" aria-hidden="true"><Icon name="arrow" size={20} /></span>;
}

export function HomePage({ onFindSupport, onAddBusiness, onOpportunities, onNotifications, onApplications, onMore, hasNotifications }: HomePageProps) {
  return <div className="home-dashboard">
    <header className="home-topbar">
      <BrandWordmark className="home-wordmark-small" />
      <button type="button" className="home-notifications" aria-label={hasNotifications ? 'Уведомления — есть новые события' : 'Уведомления'} onClick={onNotifications}>
        <Icon name="bell" size={22} />
        <span className="home-notification-dot" aria-hidden="true" />
      </button>
    </header>
    <div className="home-scroll">
      <section className="home-hero" aria-label="Опора — поддержка бизнеса">
        <img className="home-hero-shapes" src="/assets/hero-shapes.png" width={1254} height={1254} alt="" draggable={false} />
        <BrandWordmark className="home-wordmark-hero" />
        <div className="home-hero-index" aria-hidden="true"><span>01 <i /></span><span>02</span><span>03</span></div>
        <p className="home-hero-caption" aria-hidden="true">БИЗНЕС<br />РАЗВИВАЕТСЯ<br />С ПОДДЕРЖКОЙ</p>
      </section>
      <section className="home-actions" aria-label="Возможности для бизнеса">
        <div className="home-action-pair">
          <button type="button" className="home-action home-action-support" onClick={onFindSupport}>
            <span className="home-action-title">Найти<br />поддержку</span>
            <Arrow />
            <img className="home-document" src="/assets/document.png" width={1254} height={1254} alt="" draggable={false} />
          </button>
          <button type="button" className="home-action home-action-business" onClick={onAddBusiness}>
            <span className="home-action-title">Добавить<br />бизнес</span>
            <Arrow />
            <img className="home-briefcase" src="/assets/briefcase.png" width={1254} height={1254} alt="" draggable={false} />
          </button>
        </div>
        <button type="button" className="home-opportunities" onClick={onOpportunities}>
          <img className="home-orb" src="/assets/orb.png" width={1254} height={1254} alt="" draggable={false} />
          <span className="home-opportunities-copy">
            <span className="home-action-title">Возможности<br />рядом</span>
            <span className="home-opportunities-description">Государственная поддержка<br />для вашего бизнеса</span>
          </span>
          <Arrow />
        </button>
      </section>
    </div>
    <AppNavigation active="overview" onMore={onMore} onNavigate={(page) => {
      if (page === 'programs') onOpportunities();
      else if (page === 'applications') onApplications();
      else document.querySelector('.home-scroll')?.scrollTo({ top: 0, behavior: 'smooth' });
    }} />
  </div>;
}
