'use client';
import { useState, useEffect, useCallback } from 'react';
import { IconShield, IconKey, IconCheck } from './icons';

// ---- accounts & passwords --------------------------------------------------
// • ChangePasswordModal: anyone, from their name in the header. Also shown
//   (and required) right after an admin has reset your password.
// • AccountsView: admins only, reached through a hidden entrance (5 quick
//   clicks on the TeamBoard logo, or /#accounts). Lists accounts, resets
//   passwords, makes/removes admins.
// • ClaimAdminModal: one-time setup while nobody is an admin yet.

const MIN = 6;
const WORDS = ['maple', 'river', 'granite', 'cedar', 'harbor', 'summit', 'meadow', 'canyon', 'willow', 'pebble', 'birch', 'lantern', 'orchard', 'falcon', 'prairie', 'quarry'];

// e.g. "cedar-harbor-47": easy to read out loud, hard to guess.
function tempPassword() {
  const n = new Uint32Array(3);
  window.crypto.getRandomValues(n);
  return `${WORDS[n[0] % WORDS.length]}-${WORDS[n[1] % WORDS.length]}-${10 + (n[2] % 90)}`;
}
function fmtDay(v) {
  if (!v) return '—';
  const d = new Date(v);
  return isNaN(d) ? '—' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
async function call(path, opts) {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts });
  let j = {};
  try { j = await res.json(); } catch {}
  if (!res.ok) throw new Error(j.error || 'Something went wrong — please try again.');
  return j;
}

export function ChangePasswordModal({ user, forced, onDone, onClose }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    if (next.length < MIN) { setErr(`Your new password needs at least ${MIN} characters.`); return; }
    if (next !== again) { setErr('The two new passwords don’t match.'); return; }
    setBusy(true);
    try {
      await call('/api/auth/password', { method: 'POST', body: JSON.stringify({ current, next }) });
      setDone(true);
      if (onDone) onDone();
    } catch (x) { setErr(x.message); }
    setBusy(false);
  };

  return (
    <div className="modal-overlay" onClick={forced || done ? undefined : onClose}>
      <form className="modal pw-modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2 className="wi-h"><IconKey size={20} /> {forced ? 'Choose a new password' : 'Change password'}</h2>
        {done ? (
          <>
            <p className="pw-ok"><IconCheck size={16} /> Password changed. Any other devices you were signed in on have been signed out.</p>
            <div className="modal-actions"><button type="button" className="btn btn-ink" onClick={onClose}>Done</button></div>
          </>
        ) : (
          <>
            <p className="pw-sub">
              {forced
                ? 'An admin reset your password. Pick your own now — enter the temporary password you were given, then your new one.'
                : <>Signed in as <b>{user ? user.username : ''}</b>.</>}
            </p>
            <label className="atm-label">{forced ? 'Temporary password' : 'Current password'}</label>
            <input className="field" type="password" autoComplete="current-password" autoFocus value={current} onChange={(e) => setCurrent(e.target.value)} />
            <label className="atm-label">New password</label>
            <input className="field" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
            <label className="atm-label">New password again</label>
            <input className="field" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} />
            {err && <div className="bk-err">{err}</div>}
            <div className="modal-actions">
              {!forced && <button type="button" className="btn btn-plain" onClick={onClose} disabled={busy}>Cancel</button>}
              <button type="submit" className="btn btn-ink" disabled={busy || !current || !next || !again}>{busy ? 'Saving…' : 'Change password'}</button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}

export function ClaimAdminModal({ user, onClaimed, onClose }) {
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const claim = async () => {
    setBusy(true);
    setErr('');
    try { await call('/api/admin/claim', { method: 'POST' }); onClaimed(); }
    catch (x) { setErr(x.message); setBusy(false); }
  };
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal pw-modal" onClick={(e) => e.stopPropagation()}>
        <h2 className="wi-h"><IconShield size={20} /> Set up admin access</h2>
        <p className="pw-sub">Nobody is an admin yet. Make <b>{user ? user.username : 'this account'}</b> the admin? Admins can see the hidden Accounts page, reset passwords, and make other people admins.</p>
        <p className="pw-sub">This is one-time setup — once there’s an admin, only admins can add more.</p>
        {err && <div className="bk-err">{err}</div>}
        <div className="modal-actions">
          <button className="btn btn-plain" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn btn-ink" onClick={claim} disabled={busy}>{busy ? 'Setting up…' : 'Make me the admin'}</button>
        </div>
      </div>
    </div>
  );
}

function ResetRow({ u, onReset, onCancel }) {
  const [pw, setPw] = useState(() => tempPassword());
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [copied, setCopied] = useState(false);
  const go = async () => {
    if (pw.length < MIN) { setErr(`At least ${MIN} characters.`); return; }
    setBusy(true);
    setErr('');
    try { await onReset(u.id, pw); setDone(true); }
    catch (x) { setErr(x.message); }
    setBusy(false);
  };
  const copy = async () => { try { await navigator.clipboard.writeText(pw); setCopied(true); } catch {} };
  if (done) {
    return (
      <div className="acct-reset done">
        <p><IconCheck size={15} /> Done. <b>{u.username}</b> has been signed out everywhere. Their temporary password is:</p>
        <div className="acct-temp"><code>{pw}</code><button className="btn btn-plain btn-sm" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button></div>
        <p className="acct-note">Tell them in person or by message. They’ll be asked to pick their own password when they sign in.</p>
        <button className="btn btn-ink btn-sm" onClick={onCancel}>Close</button>
      </div>
    );
  }
  return (
    <div className="acct-reset">
      <label className="atm-label">Temporary password for {u.username}</label>
      <div className="acct-temp">
        <input className="field" value={pw} onChange={(e) => setPw(e.target.value)} spellCheck={false} autoComplete="off" />
        <button className="btn btn-plain btn-sm" type="button" onClick={() => setPw(tempPassword())}>New one</button>
      </div>
      <p className="acct-note">This signs {u.username} out on every device. They’ll use this to sign in, then choose their own.</p>
      {err && <div className="bk-err">{err}</div>}
      <div className="acct-reset-actions">
        <button className="btn btn-plain btn-sm" onClick={onCancel} disabled={busy}>Cancel</button>
        <button className="btn btn-danger btn-sm" onClick={go} disabled={busy}>{busy ? 'Resetting…' : 'Reset password'}</button>
      </div>
    </div>
  );
}

export default function AccountsView({ me, onChangeMine }) {
  const [users, setUsers] = useState(null);
  const [err, setErr] = useState('');
  const [resetting, setResetting] = useState(null);

  const load = useCallback(async () => {
    try { const j = await call('/api/admin/users'); setUsers(j.users); setErr(''); }
    catch (x) { setErr(x.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const setAdmin = async (u, on) => {
    if (!on && !confirm(`Remove admin from ${u.username}?`)) return;
    try { await call(`/api/admin/users/${u.id}`, { method: 'PATCH', body: JSON.stringify({ is_admin: on }) }); load(); }
    catch (x) { alert(x.message); }
  };
  const reset = async (id, password) => {
    await call(`/api/admin/users/${id}/reset`, { method: 'POST', body: JSON.stringify({ password }) });
    load();
  };

  const isMe = (u) => me && String(u.id) === String(me.id);
  return (
    <>
      <div className="proj-head">
        <h1 className="wi-h"><IconShield size={24} /> Accounts</h1>
        <span className="progress-label">Admins only — this page isn’t linked anywhere.</span>
      </div>
      {err && <div className="bk-err">{err}</div>}
      {!users && !err && <p className="ov-empty">Loading…</p>}
      {users && (
        <div className="acct-list">
          {users.map((u) => (
            <div key={u.id} className={`acct-row${resetting === u.id ? ' open' : ''}`}>
              <div className="acct-main">
                <div className="acct-name">
                  {u.username}
                  {isMe(u) && <span className="acct-tag you">you</span>}
                  {u.is_admin && <span className="acct-tag admin">Admin</span>}
                  {u.must_change && <span className="acct-tag pending" title="Has a temporary password and hasn’t chosen a new one yet">Temp password</span>}
                  {/^zz_/.test(u.username) && <span className="acct-tag test" title="Left over from testing the site">test account</span>}
                </div>
                <div className="acct-meta">Joined {fmtDay(u.created_at)} · Last sign-in {fmtDay(u.last_sign_in)} · {u.devices} device{u.devices === 1 ? '' : 's'} signed in</div>
              </div>
              <div className="acct-actions">
                {isMe(u)
                  ? <button className="btn btn-plain btn-sm wi" onClick={onChangeMine}><IconKey size={13} /> Change my password</button>
                  : <button className="btn btn-plain btn-sm wi" onClick={() => setResetting(resetting === u.id ? null : u.id)}><IconKey size={13} /> Reset password</button>}
                {u.is_admin
                  ? !isMe(u) && <button className="bk-link" onClick={() => setAdmin(u, false)}>Remove admin</button>
                  : <button className="bk-link" onClick={() => setAdmin(u, true)}>Make admin</button>}
              </div>
              {resetting === u.id && <ResetRow u={u} onReset={reset} onCancel={() => setResetting(null)} />}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
