'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, logout } from '@/app/_ui/api';
import { ChangePasswordForm } from '@/app/_ui/ChangePassword';
import { useConfirm } from '@/app/_ui/ConfirmDialog';
import { IconKey, IconLogOut, IconCheck, IconLock } from '@/app/icons';

// Settings > Password: change your password (keeps this device signed in and signs out the others, rule 30),
// "Sign out other devices" on its own, and Log out.
export default function SecuritySettings({ viewer, devices }) {
  const router = useRouter();
  const [n, setN] = useState(devices);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [formKey, setFormKey] = useState(0);
  const [confirmUI, ask] = useConfirm();

  const revoke = async () => {
    if (!(await ask({
      title: 'Sign out every other device?',
      lines: ['Phones and computers where you’re signed in will have to sign in again. This one stays signed in.'],
      confirmLabel: 'Sign out others',
    }))) return;
    setBusy(true); setErr(''); setMsg('');
    try {
      const r = await api('/api/auth/sessions/revoke-others', { method: 'POST' });
      setN(Number(r.devices) || 1);
      setMsg('Done. Every other device has been signed out.');
      router.refresh();
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };

  return (
    <div className="pf-form">
      {confirmUI}
      <div className="pf-section pf-narrow">
        <h2 className="pf-h wi"><IconKey size={17} /> Change password</h2>
        <ChangePasswordForm key={formKey} user={viewer} onChanged={() => { setN(1); router.refresh(); }}
          onDone={() => setFormKey((k) => k + 1)} />
      </div>
      <div className="pf-section pf-narrow">
        <h2 className="pf-h wi"><IconLock size={17} /> Devices</h2>
        <p className="pf-help">
          {n > 1 ? `You’re signed in on ${n} devices (this one included).` : 'You’re signed in on this device only.'}
          {' '}Sessions last a year on each device.
        </p>
        {msg && <p className="pf-ok wi" role="status"><IconCheck size={14} /> {msg}</p>}
        {err && <div className="bk-err" role="alert">{err}</div>}
        <div className="pf-row">
          <button type="button" className="btn btn-plain" onClick={revoke} disabled={busy || n <= 1}>{busy ? 'Signing out…' : 'Sign out other devices'}</button>
          <button type="button" className="btn btn-plain wi" onClick={() => logout()}><IconLogOut size={15} /> Log out of this device</button>
        </div>
      </div>
    </div>
  );
}
