'use client';
import { useCallback, useRef, useState } from 'react';
import Modal from './Modal';

// The in-page replacement for the browser's yes/no box (moved from bracket-ui.js). Same props as before:
//   <ConfirmDialog title lines={[...]} confirmLabel danger onConfirm onClose />
// Every confirmation keeps its old wording, and the two-step deletes stay two steps (rule 18).
export default function ConfirmDialog({ title, lines, confirmLabel = 'OK', cancelLabel = 'Cancel', danger = false, onConfirm, onClose }) {
  return (
    <Modal
      title={title}
      role="alertdialog"
      className="bk-confirm"
      onClose={onClose}
      actions={(
        <>
          <button type="button" className="btn btn-plain" onClick={onClose}>{cancelLabel}</button>
          <button type="button" className={`btn ${danger ? 'btn-danger' : 'btn-ink'}`} autoFocus onClick={() => { onClose(); onConfirm(); }}>{confirmLabel}</button>
        </>
      )}
    >
      {(lines || []).map((l, i) => (l ? <p key={i}>{l}</p> : null))}
    </Modal>
  );
}

// Promise style, for chained confirms:
//   const [confirmUI, ask] = useConfirm();
//   if (!(await ask({ title: 'Delete “X” and all of its tasks?', confirmLabel: 'Delete', danger: true }))) return;
//   if (!(await ask({ title: 'Are you REALLY really sure? ...', confirmLabel: 'Delete for good', danger: true }))) return;
//   ...render {confirmUI} somewhere in the component.
export function useConfirm() {
  const [req, setReq] = useState(null);
  const cur = useRef(null);                                 // { id, resolve } of the open question
  const seq = useRef(0);
  const ask = useCallback((opts) => new Promise((resolve) => {
    if (cur.current) cur.current.resolve(false);            // a second ask replaces the first
    const id = ++seq.current;
    cur.current = { id, resolve };
    setReq({ ...(opts || {}), id });
  }), []);
  const finish = (id, answer) => {
    if (!cur.current || cur.current.id !== id) return;
    const { resolve } = cur.current;
    cur.current = null;
    setReq(null);
    resolve(answer);
  };
  // ConfirmDialog calls onClose and then onConfirm on the confirm button, so "cancel" waits a tick:
  // a confirm in the same click wins.
  const ui = req ? (
    <ConfirmDialog
      key={req.id}
      title={req.title}
      lines={req.lines}
      confirmLabel={req.confirmLabel}
      cancelLabel={req.cancelLabel}
      danger={req.danger}
      onConfirm={() => finish(req.id, true)}
      onClose={() => { const id = req.id; Promise.resolve().then(() => finish(id, false)); }}
    />
  ) : null;
  return [ui, ask];
}
