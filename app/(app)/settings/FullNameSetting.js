'use client';
import { useState } from 'react';
import { api } from '@/app/_ui/api';
import { IconCheck } from '@/app/icons';

// "Full name (on owner reports)" (Neil, 2026-10-16): the Name above can be a nickname that everyone inside
// TeamBoard sees; this is what prints as "Prepared by" on the owner reports and their email copy. Empty uses the
// Name. Saved on its own (PATCH /api/users/:id/full-name), apart from the profile form.
export default function FullNameSetting({ me }) {
  const [value, setValue] = useState(me.full_name || '');
  const [saved, setSaved] = useState(me.full_name || '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);           // { ok, text }
  const dirty = value.trim().replace(/\s+/g, ' ') !== saved;
  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api(`/api/users/${me.id}/full-name`, { method: 'PATCH', body: { full_name: value } });
      setSaved(r.full_name);
      setValue(r.full_name);
      setMsg({ ok: true, text: 'Saved' });
    } catch (e) {
      setMsg({ ok: false, text: e.message || 'That didn’t save. Try again.' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="pf-section pf-fullname" onSubmit={(e) => { e.preventDefault(); if (dirty) save(); }}>
      <h2 className="pf-h">Name on owner reports</h2>
      <label className="atm-label" htmlFor="pf-fullname">Full name</label>
      <div className="pf-fullname-row">
        <input id="pf-fullname" className="field" value={value} maxLength={120} autoComplete="name"
          placeholder={me.display_name || me.username} onChange={(e) => { setValue(e.target.value); setMsg(null); }} />
        <button type="submit" className="btn btn-ink" disabled={busy || !dirty}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
      <p className="pf-help">Printed as “Prepared by” on the reports that go to owners. Everywhere inside TeamBoard people still see your Name above (a nickname is fine there). Empty uses your Name.</p>
      {msg && (msg.ok
        ? <p className="pf-ok wi" role="status"><IconCheck size={14} /> {msg.text}</p>
        : <p className="pm-error" role="alert">{msg.text}</p>)}
    </form>
  );
}
