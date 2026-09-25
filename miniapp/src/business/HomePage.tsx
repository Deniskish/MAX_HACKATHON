import { Icon } from './Icon';
import { AppNavigation, BrandWordmark } from './AppChrome';
import type { BusinessAnalysis } from './useBusinessAnalysis';
import type { WorkspaceInsight } from '../../api-server/ai/types';

type HomePageProps = {
  onFindSupport: () => void;
  onAddBusiness: () => void;
  onOpportunities: () => void;
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

export function HomePage({ onFindSupport, onAddBusiness, onOpportunities, onNotifications, onApplications, onBusiness, personalized, hasNotifications, analysis, onAIAction }: HomePageProps) {
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
          <img className="home-hero-shapes" src="/assets/hero-shapes.png" width={1254} height={1254} alt="" draggable={false} />
          <BrandWordmark className="home-wordmark-hero" />
          <p className="home-hero-caption" aria-hidden="true">БИЗНЕС<br />РАЗВИВАЕТСЯ<br />С ПОДДЕРЖКОЙ</p>
        </div>
      </section>
      <section className="home-actions" aria-label="Возможности для бизнеса">
        <div className="home-action-pair">
          <button type="button" className="home-action home-action-support" onClick={onFindSupport}>
            <span className="home-action-title">{personalized ? 'Поддержка' : 'Найти'}<br />{personalized ? 'для вас' : 'поддержку'}</span>
            <Arrow />
            <img className="home-document" src="/assets/document.png" width={1254} height={1254} alt="" draggable={false} />
          </button>
          <button type="button" className="home-action home-action-business" onClick={onAddBusiness}>
            <span className="home-action-title">{personalized ? 'Мой' : 'Добавить'}<br />бизнес</span>
            <Arrow />
            <img className="home-briefcase" src="/assets/briefcase.png" width={1254} height={1254} alt="" draggable={false} />
          </button>
        </div>
        <button type="button" className={`home-opportunities${personalized ? ' home-adaptive' : ''}`} onClick={() => insight ? onAIAction(insight.action) : onOpportunities()}>
          <img className="home-orb" src="/assets/orb.png" width={1254} height={1254} alt="" draggable={false} />
          <span className="home-opportunities-copy">
            {personalized && <span className="home-ai-label">{insight ? 'AI · ВАШ СЛЕДУЮЩИЙ ШАГ' : analysis.status === 'loading' ? 'AI · АНАЛИЗ БИЗНЕСА' : 'ПОДБОР ПО ПРАВИЛАМ'}</span>}
            <span className="home-action-title">{insight ? insight.title : personalized ? 'Уточните вашу задачу' : <>Возможности<br />рядом</>}</span>
            <span className="home-opportunities-description">{insight ? insight.text : personalized ? analysis.status === 'loading' ? 'Изучаем ваш бизнес, цели и заявки. Скоро здесь появится рекомендация.' : 'AI пока недоступен. Укажите цель для подбора по правилам.' : <>Государственная поддержка<br />для вашего бизнеса</>}</span>
          </span>
          <Arrow />
        </button>
        {personalized && <details className="home-analysis-details"><summary>{insight ? 'Почему этот шаг важен' : 'Как подстраивается приложение'}</summary>{insight && <p>{insight.text}</p>}<p>{analysis.data?.personalization?.summary ?? 'AI анализирует профиль, потребность и состояние заявок. Его выводы используются на главной, в поддержке, заявках, календаре и чате. Изменение данных обновляет анализ.'}</p><button onClick={analysis.refresh} disabled={analysis.status === 'loading'}>{analysis.status === 'loading' ? 'Анализируем…' : 'Обновить AI-анализ'}</button></details>}
      </section>
    </div>
    <AppNavigation active="overview" onNavigate={(page) => {
      if (page === 'programs') onFindSupport();
      else if (page === 'applications') onApplications();
      else if (page === 'profile') onBusiness();
      else document.querySelector('.home-scroll')?.scrollTo({ top: 0, behavior: 'smooth' });
    }} />
  </div>;
}
