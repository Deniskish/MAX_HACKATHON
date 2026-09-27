import { useEffect, useLayoutEffect, useRef } from 'react';
import type { AppPage } from './AppChrome';

const tabs: AppPage[] = ['overview', 'programs', 'applications', 'profile'];

/** A short-lived inert DOM snapshot avoids mounting a second set of forms/effects. */
export function useTabTransition(page: AppPage) {
  const shell = useRef<HTMLDivElement>(null);
  const positions = useRef<Partial<Record<AppPage, [number, number]>>>({});
  const pending = useRef<{ node: HTMLElement; direction: number; scroll: [Element, number, number][] } | null>(null);
  const cleanup = useRef<() => void>(() => {});

  function prepare(next: AppPage) {
    if (next === page) return;
    positions.current[page] = [shell.current?.querySelector('.app-content')?.scrollTop ?? 0, shell.current?.querySelector('.home-scroll')?.scrollTop ?? 0];
    cleanup.current();
    pending.current = null;
    const from = tabs.indexOf(page), to = tabs.indexOf(next);
    const element = shell.current;
    if (!element || from < 0 || to < 0 || from === to || document.hidden ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches || !element.animate) return;
    const node = element.cloneNode(true) as HTMLElement;
    const original = [element, ...element.querySelectorAll('*')];
    const copies = [node, ...node.querySelectorAll('*')];
    const scroll: [Element, number, number][] = [];
    original.forEach((item, i) => {
      if (item.scrollTop || item.scrollLeft) scroll.push([copies[i], item.scrollTop, item.scrollLeft]);
    });
    node.querySelectorAll('dialog, .home-nav-wrap, .toast, .tab-snapshot').forEach((item) => item.remove());
    node.querySelectorAll('[id]').forEach((item) => item.removeAttribute('id'));
    node.classList.add('tab-snapshot');
    node.setAttribute('aria-hidden', 'true');
    node.setAttribute('inert', '');
    pending.current = { node, scroll, direction: to > from ? 1 : -1 };
  }

  useLayoutEffect(() => {
    const element = shell.current;
    element?.querySelector(':scope > .app-content')?.scrollTo({ top: positions.current[page]?.[0] ?? 0 });
    element?.querySelector('.home-scroll')?.scrollTo({ top: positions.current[page]?.[1] ?? 0 });
    const transition = pending.current;
    pending.current = null;
    if (!element || !transition) return;
    const { node, direction, scroll } = transition;
    element.append(node);
    scroll.forEach(([item, top, left]) => { item.scrollTop = top; item.scrollLeft = left; });
    const options: KeyframeAnimationOptions = { duration: 260, easing: 'cubic-bezier(.22,.8,.25,1)', fill: 'both' };
    const distance = 32 * direction;
    const outgoing = node.animate([{ transform: 'translateX(0)', opacity: 1 },
      { transform: `translateX(${-distance}px)`, opacity: 0 }], options);
    const animations = [outgoing, ...Array.from(element.querySelectorAll(':scope > .app-content, :scope > .app-topbar'),
      (item) => item.animate([{ transform: `translateX(${distance}px)`, opacity: 0 },
        { transform: 'translateX(0)', opacity: 1 }], options))];
    const finish = () => { animations.forEach((animation) => animation.cancel()); node.remove(); };
    cleanup.current = finish;
    outgoing.onfinish = finish;
    return finish;
  }, [page]);

  useEffect(() => {
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const stop = () => { cleanup.current(); pending.current = null; };
    document.addEventListener('visibilitychange', stop);
    window.addEventListener('resize', stop);
    motion.addEventListener('change', stop);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', stop);
      window.removeEventListener('resize', stop);
      motion.removeEventListener('change', stop);
    };
  }, []);
  return { shell, prepare };
}
