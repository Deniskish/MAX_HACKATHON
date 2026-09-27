import { useEffect, useRef, type ReactNode } from 'react';

/** Native details keeps keyboard behavior and mounted form state in every disclosure. */
export function InfoDisclosure({ summary, children, className = '', defaultOpen = false, open, onOpenChange }: {
  summary: ReactNode; children: ReactNode; className?: string; defaultOpen?: boolean; open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  const initialOpen = useRef(open ?? defaultOpen);
  const expanded = useRef(initialOpen.current);
  const animation = useRef<Animation | null>(null);

  function settle() {
    animation.current?.cancel();
    animation.current = null;
    if (ref.current) {
      ref.current.open = expanded.current;
      ref.current.classList.remove('is-toggling');
    }
  }

  function toggle(next: boolean) {
    const element = ref.current!;
    const start = element.getBoundingClientRect().height;
    animation.current?.cancel();
    animation.current = null;
    expanded.current = next;
    onOpenChange?.(next);
    if (!next && element.querySelector('.info-disclosure-content')?.contains(document.activeElement)) {
      element.querySelector('summary')?.focus({ preventScroll: true });
    }
    element.dataset.expanded = String(next);
    element.open = next;
    element.classList.remove('is-toggling');
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !element.animate) return;
    const end = element.getBoundingClientRect().height;
    element.open = true;
    element.classList.add('is-toggling');
    const transition = element.animate([{ height: `${start}px` }, { height: `${end}px` }], {
      duration: 240, easing: 'cubic-bezier(.22,.8,.25,1)',
    });
    animation.current = transition;
    transition.onfinish = settle;
  }

  useEffect(() => {
    if (open !== undefined && open !== expanded.current) toggle(open);
  }, [open]);

  useEffect(() => {
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    motion.addEventListener('change', settle);
    window.addEventListener('resize', settle);
    return () => {
      settle();
      motion.removeEventListener('change', settle);
      window.removeEventListener('resize', settle);
    };
  }, []);

  return <details ref={ref} className={`info-disclosure ${className}`} open={initialOpen.current}
    onToggle={event => {
      // Ignore the temporary open state needed to animate a closing panel.
      if (animation.current) return;
      expanded.current = event.currentTarget.open;
      event.currentTarget.dataset.expanded = String(expanded.current);
      onOpenChange?.(expanded.current);
    }}
    onClick={event => {
      const element = ref.current!;
      if (event.defaultPrevented || !(event.target instanceof Element) ||
        event.target.closest('summary')?.parentElement !== element) return;
      event.preventDefault();
      // Read native state too: form validation can open a collapsed details element.
      toggle(!(animation.current ? expanded.current : element.open));
    }}>
    {summary}
    <div className="info-disclosure-content">{children}</div>
  </details>;
}
