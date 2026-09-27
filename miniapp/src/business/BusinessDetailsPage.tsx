import { useState, type ReactNode } from 'react';
import { Icon } from './Icon';

const tabs = [
  { id: 'analysis', label: 'Рекомендации', icon: 'compass' },
  { id: 'details', label: 'Данные', icon: 'building' },
] as const;
export function BusinessDetailsPage({ name, analysis, details }: {
  name: string; analysis: ReactNode; details: ReactNode;
}) {
  const [active, setActive] = useState<typeof tabs[number]['id']>('analysis');
  const content = { analysis, details };
  return <div className="business-details-page">
    <p className="business-details-name">{name}</p>
    <div className="business-details-tabs" role="tablist" aria-label="Разделы бизнеса">
      {tabs.map((tab, index) => <button key={tab.id} id={`business-tab-${tab.id}`} type="button" role="tab"
        aria-selected={active === tab.id} aria-controls={`business-panel-${tab.id}`} tabIndex={active === tab.id ? 0 : -1}
        onClick={() => setActive(tab.id)} onKeyDown={event => {
          const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length
            : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null;
          if (next !== null) { event.preventDefault(); setActive(tabs[next].id); document.getElementById(`business-tab-${tabs[next].id}`)?.focus(); }
        }}><Icon name={tab.icon} size={19} /><span>{tab.label}</span></button>)}
    </div>
    {tabs.map(tab => <section key={tab.id} className="business-details-panel" id={`business-panel-${tab.id}`} role="tabpanel"
      aria-labelledby={`business-tab-${tab.id}`} tabIndex={0} hidden={active !== tab.id}>
      {content[tab.id]}
    </section>)}
  </div>;
}
