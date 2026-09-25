import { ThemedImage } from './ThemedImage';
import { Icon } from './Icon';
import { AppNavigation, BrandWordmark } from './AppChrome';
import { ContextHelp } from './ContextHelp';
import type { BusinessAnalysis } from './useBusinessAnalysis';
import type { WorkspaceInsight } from '../../api-server/ai/types';

type HomePageProps = {
  showNavigation?: boolean;
  onFindSupport: () => void;
  onAddBusiness: () => void;
  onAssistant: () => void;
  onNotifications: () => void;
  onApplications: () => void;
  onBusiness: () => void;
  personalized: boolean;
  analysis: BusinessAnalysis;
  onAIAction: (action: WorkspaceInsight['action']) => void;
  hasNotifications: boolean;
};

function Arrow() {
  return <span className="home-arrow" aria-hidden="true"><Icon name="arrow" size={20} /></span>;
}

export function HomePage({ showNavigation = true, onFindSupport, onAddBusiness, onOpportunities, onNotifications, onApplications, onBusiness, personalized, hasNotifications, analysis, onAIAction }: HomePageProps) {
  const insight = analysis.data?.personalization?.sections.home;
  return <div className={`home-dashboard${personalized ? ' home-personalized' : ''}`}>
    <header className="home-topbar">
      <BrandWordmark className="home-wordmark-small" />
      <button type="button" className="home-notifications" aria-label={hasNotifications ? 'Уведомления — есть новые события' : 'Уведомления'} onClick={onNotifications}>
        <Icon name="bell" size={22} />
        {hasNotifications && <span className="home-notification-dot" aria-hidden="true" />}
      </button>
    </header>
    <div className="home-scroll">
      <section className="home-hero" aria-label="Опора — поддержка бизнеса">
        <div className="home-hero-artwork">
          <ThemedImage className="home-hero-shapes" src="/assets/hero-shapes.png" width={1254} height={1254} alt="" draggable={false} />
          <BrandWordmark className="home-wordmark-hero" />
        </div>
      </section>
      <section className="home-actions" aria-label="Возможности для бизнеса">
        <div className="home-action-pair">
          <button type="button" className="home-action home-action-support" onClick={onFindSupport}>
            <span className="home-action-title">{personalized ? 'Поддержка' : 'Найти'}<br />{personalized ? 'для вас' : 'поддержку'}</span>
            <Arrow />
            <ThemedImage className="home-document" src="/assets/document.png" width={1254} height={1254} alt="" draggable={false} />
          </button>
          <button type="button" className="home-action home-action-business" onClick={onAddBusiness}>
            <span className="home-action-title">{personalized ? 'Мой' : 'Добавить'}<br />бизнес</span>
            <Arrow />
            <ThemedImage className="home-briefcase" src="/assets/briefcase.png" width={1254} height={1254} alt="" draggable={false} />
          </button>
        </div>
        <button type="button" className="home-opportunities home-adaptive" disabled={analyzing} aria-busy={analyzing}
          onClick={() => !personalized ? onAssistant() : insight ? onAIAction(insight.action) : analysis.refresh()}>
          <ThemedImage className="home-orb" src="/assets/orb.png" width={1254} height={1254} alt="" draggable={false} />
          <span className="home-opportunities-copy">
            {personalized && <span className="home-ai-label">{insight ? 'AI · следующий шаг' : 'AI · анализ бизнеса'}</span>}
            <span className="home-action-title">{!personalized ? 'AI-помощник' : insight?.title ?? (analyzing ? 'Определяем следующий шаг…' : 'Повторить анализ')}</span>
          </span>
          {!analyzing && <Arrow />}
        </button>
        {personalized && <ContextHelp title="Как выбран следующий шаг">
          <p>{insight ? 'Рекомендация AI на основе профиля бизнеса, вашей цели и текущих заявок.' : analyzing ? 'AI анализирует профиль бизнеса, вашу цель и текущие заявки.' : 'Не удалось получить AI-рекомендацию. Повторите анализ или задайте вопрос помощнику в разделе «Мой бизнес».'}</p>
          {insight && <p>{insight.text}</p>}
        </ContextHelp>}
      </section>
    </div>
    {showNavigation && <AppNavigation active="overview" onNavigate={(page) => {
      if (page === 'programs') onFindSupport();
      else if (page === 'applications') onApplications();
      else if (page === 'profile') onBusiness();
      else document.querySelector('.home-scroll')?.scrollTo({ top: 0, behavior: 'smooth' });
    }} />}
  </div>;
}
