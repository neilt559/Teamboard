'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Modal from './Modal';
import { api } from './api';
import { IconShield } from '../icons';

// First-admin setup (moved from app/accounts-ui.js, design §2.3). The claim API answers 404 unless
// TB_ALLOW_ADMIN_CLAIM=1, and /api/admin/status only says canClaim when that flag is set and nobody is an
// admin yet (§13 #6), so on the live site this never appears.
export function ClaimAdminModal({ user, onClaimed, onClose }) {
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const claim = async () => {
    setBusy(true);
    setErr('');
    try {
      await api('/api/admin/claim', { method: 'POST' });
      onClaimed();
    } catch (x) {
      setErr(x.message);
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Set up admin access"
      icon={<IconShield size={20} />}
      className="pw-modal"
      onClose={busy ? undefined : onClose}
      actions={(
        <>
          <button type="button" className="btn btn-plain" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="btn btn-ink" onClick={claim} disabled={busy}>{busy ? 'Setting up…' : 'Make me the admin'}</button>
        </>
      )}
    >
      <p className="pw-sub">
        Nobody is an admin yet. Make <b>{user ? user.username : 'this account'}</b> the admin? Admins can see the hidden
        Accounts page, reset passwords, and make other people admins.
      </p>
      <p className="pw-sub">This is one-time setup — once there’s an admin, only admins can add more.</p>
      {err && <div className="bk-err">{err}</div>}
    </Modal>
  );
}

// The hidden Admin entrance (rule 43) for everyone who isn't an admin yet. The header calls
// openAdminEntrance() on five quick brand clicks or a #accounts link; this asks /api/admin/status and, only
// when the server says canClaim, offers the one-time claim. Otherwise nothing visible happens. An admin is
// sent to /admin (the header already does that itself).
export const ADMIN_ENTRANCE_EVENT = 'tb:admin-entrance';
export function openAdminEntrance() {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(ADMIN_ENTRANCE_EVENT));
}

export function ClaimAdminHost({ viewer }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onEntrance = async () => {
      try {
        const s = await api('/api/admin/status', { quiet: true });
        if (s?.isAdmin) router.push('/admin');
        else if (s?.canClaim) setOpen(true);
      } catch {
        // errors are swallowed, as today: the entrance stays invisible
      }
    };
    window.addEventListener(ADMIN_ENTRANCE_EVENT, onEntrance);
    return () => window.removeEventListener(ADMIN_ENTRANCE_EVENT, onEntrance);
  }, [router]);
  if (!open) return null;
  return (
    <ClaimAdminModal
      user={viewer}
      onClose={() => setOpen(false)}
      // A full load, so the header and menu pick up the new admin rights.
      onClaimed={() => { window.location.assign('/admin'); }}
    />
  );
}

export default ClaimAdminModal;
