'use client';
import { useEffect, useId, useRef } from 'react';

// Shared dialog frame: the existing .modal-overlay / .modal look, plus what the old modals lacked
// (inventory corrections): Escape closes, dialog semantics, focus moves into the dialog and back after.
// Leave onClose out for a dialog that must not be dismissed (the forced password change, rule 48).
//   <Modal title="Add task" onClose={close} className="add-task-modal" actions={<>...buttons...</>}>...</Modal>
export default function Modal({ title, icon = null, onClose, className = '', role = 'dialog', closeOnOverlay = true, actions = null, children }) {
  const id = useId();
  const box = useRef(null);
  const close = useRef(onClose);
  close.current = onClose;
  // Close on the backdrop only when the press STARTED there too. A press that starts on a button inside the
  // dialog and is released over the backdrop (because the dialog shrank under the pointer) is not a backdrop click.
  const downOnOverlay = useRef(false);

  useEffect(() => {
    const before = document.activeElement;
    // Focus the dialog itself unless something inside asked for autoFocus.
    if (box.current && !box.current.contains(document.activeElement)) box.current.focus({ preventScroll: true });
    const k = (e) => { if (e.key === 'Escape' && close.current) { e.stopPropagation(); close.current(); } };
    window.addEventListener('keydown', k);
    return () => {
      window.removeEventListener('keydown', k);
      if (before && typeof before.focus === 'function' && document.contains(before)) before.focus({ preventScroll: true });
    };
  }, []);

  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => { downOnOverlay.current = e.target === e.currentTarget; }}
      onClick={(e) => {
        const fromOverlay = downOnOverlay.current && e.target === e.currentTarget;
        downOnOverlay.current = false;
        if (fromOverlay && closeOnOverlay && close.current) close.current();
      }}
    >
      <div
        ref={box}
        className={`modal${className ? ` ${className}` : ''}`}
        role={role}
        aria-modal="true"
        aria-labelledby={title ? id : undefined}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        {title && <h2 id={id} className={icon ? 'wi-h' : undefined}>{icon}{title}</h2>}
        {children}
        {actions && <div className="modal-actions">{actions}</div>}
      </div>
    </div>
  );
}
