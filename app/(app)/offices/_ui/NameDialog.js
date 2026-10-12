'use client';
import { useState } from 'react';
import Modal from '@/app/_ui/Modal';

// The in-page replacement for prompt('New team name', 'New Team') and friends (design §2.3: no native
// dialogs). Same rules as the old prompts:
//   mode 'create': a blank entry becomes `fallback` (Cancel aborts).
//   mode 'rename': blank or unchanged is ignored (the dialog just closes).
// onSubmit(name) may be async; while it runs the button reads busyLabel. A thrown error stays in the dialog.
export default function NameDialog({
  title, label, initial = '', fallback = '', mode = 'create', confirmLabel = 'Save', busyLabel = 'Saving…',
  placeholder = '', maxLength = 200, onSubmit, onClose,
}) {
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const submit = async () => {
    if (busy) return;
    const trimmed = name.trim();
    let value = trimmed;
    if (mode === 'rename') {
      if (!trimmed || trimmed === String(initial).trim()) { onClose(); return; }
    } else if (!trimmed) {
      value = fallback;
    }
    setBusy(true);
    setErr(null);
    try {
      await onSubmit(value);
      onClose();
    } catch (e) {
      setErr(e?.message || 'Request failed');
      setBusy(false);
    }
  };

  return (
    <Modal
      title={title}
      className="add-task-modal name-dialog"
      onClose={busy ? undefined : onClose}
      actions={(
        <>
          <button type="button" className="btn btn-plain" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="btn btn-ink" onClick={submit} disabled={busy}>{busy ? busyLabel : confirmLabel}</button>
        </>
      )}
    >
      {label && <label className="atm-label" htmlFor="name-dialog-input">{label}</label>}
      <input
        id="name-dialog-input"
        className="field"
        autoFocus
        value={name}
        maxLength={maxLength}
        placeholder={placeholder || fallback}
        onChange={(e) => setName(e.target.value)}
        onFocus={(e) => e.target.select()}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
      />
      {err && <p className="ofc-dialog-err" role="alert">{err}</p>}
    </Modal>
  );
}
