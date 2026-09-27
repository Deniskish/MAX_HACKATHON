import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from './Icon';

const tabs = [
  { id: 'analysis', label: 'Рекомендации', icon: 'compass' },
  { id: 'details', label: 'Данные', icon: 'building' },
] as const;
export function BusinessDetailsPage({ name, analysis, details }: {
  name: string; analysis: ReactNode; details: ReactNode;
}) {
  const [active, setActive] = useState<typeof tabs[number]['id']>('analysis');
  const panels = useRef<HTMLDivElement>(null);
  const pending = useRef<{ height: number; direction: number } | null>(null);
  const cleanup = useRef<() => void>(() => {});
  function select(next: typeof active) {
    if (next === active) return;
    const height = panels.current?.getBoundingClientRect().height ?? 0;
    cleanup.current();
    pending.current = { height, direction: next === 'details' ? 1 : -1 };
    setActive(next);
  }
  useLayoutEffect(() => {
    const element = panels.current;
    const transition = pending.current;
    pending.current = null;
    const panel = element?.querySelector<HTMLElement>(':scope > :not([hidden])');
    if (!element || !panel || !transition || !element.animate ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const height = element.getBoundingClientRect().height;
    const options = { duration: 240, easing: 'cubic-bezier(.22,.8,.25,1)' };
    element.classList.add('is-toggling');
    const resize = element.animate([{ height: `${transition.height}px` }, { height: `${height}px` }], options);
    const reveal = panel.animate([{ opacity: 0, transform: `translateX(${12 * transition.direction}px)` },
      { opacity: 1, transform: 'translateX(0)' }], options);
    const finish = () => { resize.cancel(); reveal.cancel(); element.classList.remove('is-toggling'); };
    cleanup.current = finish;
    resize.onfinish = finish;
    return finish;
  }, [active]);
  useEffect(() => {
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const stop = () => cleanup.current();
    motion.addEventListener('change', stop);
    window.addEventListener('resize', stop);
    return () => { stop(); motion.removeEventListener('change', stop); window.removeEventListener('resize', stop); };
  }, []);
  const content = { analysis, details };
  return <div className="business-details-page">
    <p className="business-details-name">{name}</p>
    <div className="business-details-tabs" role="tablist" aria-label="Разделы бизнеса">
      {tabs.map((tab, index) => <button key={tab.id} id={`business-tab-${tab.id}`} type="button" role="tab"
        aria-selected={active === tab.id} aria-controls={`business-panel-${tab.id}`} tabIndex={active === tab.id ? 0 : -1}
        onClick={() => select(tab.id)} onKeyDown={event => {
          const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length
            : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null;
          if (next !== null) { event.preventDefault(); select(tabs[next].id); document.getElementById(`business-tab-${tabs[next].id}`)?.focus(); }
        }}><Icon name={tab.icon} size={19} /><span>{tab.label}</span></button>)}
    </div>
    <div ref={panels} className="business-details-panels">
    {tabs.map(tab => <section key={tab.id} className="business-details-panel" id={`business-panel-${tab.id}`} role="tabpanel"
      aria-labelledby={`business-tab-${tab.id}`} tabIndex={0} hidden={active !== tab.id}>
      {content[tab.id]}
    </section>)}
    </div>
  </div>;
}
