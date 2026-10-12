'use client';
import { useState } from 'react';
import { IconKey, IconCheck } from '../icons';
import { api } from './api';
import Modal from './Modal';

// Change your own password (moved from app/accounts-ui.js ChangePasswordModal; inventory §1.1). Same wording,
// same checks, same success screen. Three ways to show it:
//   <ChangePasswordForm user={viewer} onCancel? onDone? />    inline (Settings > Password)
//   <ChangePasswordForm user={viewer} forced onDone />         the forced /password page
//   <ChangePasswordModal user forced onDone onClose />         the old modal, same props as before
// forced: an admin reset the password (must_change). No Cancel, and the modal can't be dismissed (rule 48).
// onChanged() fires the moment the server accepts the new password; onDone() when the person clicks Done on
// the success screen. The server keeps this session and signs out every other device (rule 30), and it
// enforces must_change itself (design §13 #3), so this screen is only the friendly half.

export const MIN_PASSWORD = 6;      // lib/auth.js MIN_PASSWORD (kept from today; §17 asks Neil about 8)
export const MAX_PASSWORD = 200;    // lib/auth.js MAX_PASSWORD

export function ChangePasswordForm({ user, forced = false, onChanged, onDone, onCancel, doneLabel = 'Done', className = '' }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    if (next.length < MIN_PASSWORD) { setErr(`Your new password needs at least ${MIN_PASSWORD} characters.`); return; }
    if (next.length > MAX_PASSWORD) { setErr(`Your new password can be at most ${MAX_PASSWORD} characters.`); return; }
    if (next !== again) { setErr('The two new passwords don’t match.'); return; }
    setBusy(true);
    try {
      await api('/api/auth/password', { method: 'POST', body: { current, next } });
      setCurrent(''); setNext(''); setAgain('');
      setDone(true);
      if (onChanged) onChanged();
    } catch (x) {
      setErr(x.message || 'Something went wrong — please try again.');
    }
    setBusy(false);
  };

  const cls = `pw-form${className ? ` ${className}` : ''}`;
  if (done) {
    return (
      <div className={cls}>
        <p className="pw-ok" role="status"><IconCheck size={16} /> Password changed. Any other devices you were signed in on have been signed out.</p>
        <div className="modal-actions">
          <button type="button" className="btn btn-ink" autoFocus onClick={() => { if (onDone) onDone(); else setDone(false); }}>{doneLabel}</button>
        </div>
      </div>
    );
  }

  return (
    <form className={cls} onSubmit={submit}>
      <p className="pw-sub">
        {forced
          ? 'An admin reset your password. Pick your own now — enter the temporary password you were given, then your new one.'
          : <>Signed in as <b>{user ? user.username : ''}</b>.</>}
      </p>
      {/* Lets password managers file the new password under the right account. */}
      <input type="text" name="username" autoComplete="username" value={user ? user.username : ''} readOnly hidden />
      <label className="atm-label" htmlFor="pw-current">{forced ? 'Temporary password' : 'Current password'}</label>
      <input id="pw-current" className="field" type="password" autoComplete="current-password" autoFocus={forced}
        value={current} onChange={(e) => setCurrent(e.target.value)} />
      <label className="atm-label" htmlFor="pw-next">New password</label>
      <input id="pw-next" className="field" type="password" autoComplete="new-password" maxLength={MAX_PASSWORD}
        value={next} onChange={(e) => setNext(e.target.value)} />
      <label className="atm-label" htmlFor="pw-again">New password again</label>
      <input id="pw-again" className="field" type="password" autoComplete="new-password" maxLength={MAX_PASSWORD}
        value={again} onChange={(e) => setAgain(e.target.value)} />
      {err && <div className="bk-err" role="alert">{err}</div>}
      <div className="modal-actions">
        {!forced && onCancel && <button type="button" className="btn btn-plain" onClick={onCancel} disabled={busy}>Cancel</button>}
        <button type="submit" className="btn btn-ink" disabled={busy || !current || !next || !again}>{busy ? 'Saving…' : 'Change password'}</button>
      </div>
    </form>
  );
}

// The old modal (accounts-ui.js), for a page that still wants a pop-up (e.g. Accounts "Change my password").
// Overlay click, Escape and Cancel close it, except when forced or once the success screen shows.
export function ChangePasswordModal({ user, forced = false, onDone, onClose }) {
  const [finished, setFinished] = useState(false);
  const locked = forced || finished;
  return (
    <Modal
      title={forced ? 'Choose a new password' : 'Change password'}
      icon={<IconKey size={20} />}
      className="pw-modal"
      onClose={locked ? undefined : onClose}
    >
      <ChangePasswordForm
        user={user}
        forced={forced}
        onCancel={onClose}
        onChanged={() => { setFinished(true); if (onDone) onDone(); }}
        onDone={onClose}
      />
    </Modal>
  );
}

export default ChangePasswordForm;
