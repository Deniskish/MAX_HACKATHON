import { useId, useLayoutEffect, useRef, useState } from 'react';
import { Icon } from './Icon';

const statuses = [
  ['', 'Все статусы'], ['active', 'Приём открыт'], ['closed', 'Приём завершён'],
  ['upcoming', 'Ожидается открытие'], ['unknown', 'Требует проверки'],
] as const;

/** Local presentation of the existing catalogue filter; native dialog owns focus trapping. */
export function CatalogStatusFilter({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const animation = useRef<Animation | null>(null);
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const selected = statuses.find((status) => status[0] === value) ?? statuses[0];

  useLayoutEffect(() => {
    if (!open) return;
    const element = dialog.current!;
    element.showModal();
    element.querySelector<HTMLElement>('[aria-selected="true"]')?.focus({ preventScroll: true });
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      animation.current = element.animate([{ transform: 'translateY(24px)', opacity: 0 }, { transform: 'translateY(0)', opacity: 1 }],
        { duration: 220, easing: 'cubic-bezier(.22,.8,.25,1)' });
    }
    return () => { animation.current?.cancel(); element.close(); };
  }, [open]);

  function close() {
    if (closing) return;
    setClosing(true);
    animation.current?.cancel();
    const finish = () => {
      dialog.current?.close(); setOpen(false); setClosing(false);
      trigger.current?.focus({ preventScroll: true });
    };
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { finish(); return; }
    animation.current = dialog.current!.animate([{ transform: 'translateY(0)', opacity: 1 }, { transform: 'translateY(24px)', opacity: 0 }],
      { duration: 180, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' });
    animation.current.onfinish = finish;
  }

  return <div className="field catalog-state">
    <span id={`${id}-label`}>Статус</span>
    <button ref={trigger} type="button" className="catalog-status-trigger" aria-labelledby={`${id}-label ${id}-value`}
      aria-haspopup="dialog" aria-expanded={open} aria-controls={id} onClick={() => setOpen(true)}>
      <span id={`${id}-value`}>{selected[1]}</span><Icon name="chevron" size={18} />
    </button>
    <dialog id={id} ref={dialog} className={`catalog-status-sheet${closing ? ' is-closing' : ''}`} aria-labelledby={`${id}-title`}
      onCancel={(event) => { event.preventDefault(); event.stopPropagation(); close(); }}
      onClick={(event) => { if (event.target === event.currentTarget) close(); }}>
      <header className="catalog-status-heading"><h2 id={`${id}-title`}>Статус программы</h2>
        <button type="button" className="catalog-status-close" aria-label="Закрыть" onClick={close}><Icon name="close" size={20} /></button>
      </header>
      <div className="catalog-status-options" role="listbox" aria-label="Статус программы" onKeyDown={(event) => {
        const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End'];
        if (!keys.includes(event.key)) return;
        event.preventDefault();
        const options = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="option"]'));
        const current = options.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1
          : (current + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
        options.forEach((option, index) => { option.tabIndex = index === next ? 0 : -1; });
        options[next].focus();
      }}>
        {statuses.map(([key, label]) => <button key={key} type="button" role="option" aria-selected={key === selected[0]}
          tabIndex={key === selected[0] ? 0 : -1} onClick={() => { if (!closing) { onChange(key); close(); } }}>
          <span>{label}</span>{key === selected[0] && <Icon name="check" size={20} />}
        </button>)}
      </div>
    </dialog>
  </div>;
}
