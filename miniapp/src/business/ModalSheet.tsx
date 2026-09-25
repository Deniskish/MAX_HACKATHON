import React, { type ReactNode } from 'react';
import { Icon } from './Icon';

/** Native dialog keeps focus and keyboard navigation inside the open sheet. */
export function ModalSheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = React.useRef<HTMLDialogElement>(null);
  React.useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return <dialog ref={ref} className="modal-sheet" aria-label={title}
    onCancel={(event) => { event.preventDefault(); onClose(); }}
    onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="modal-toolbar">
      <button className="modal-close icon-button" aria-label="Закрыть" onClick={onClose}><Icon name="close" /></button>
      <span>{title}</span>
    </div>
    <section className="project-dialog">{children}</section>
  </dialog>;
}
