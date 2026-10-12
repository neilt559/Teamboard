'use client';
import { useState } from 'react';
import { ClaimAdminModal } from '@/app/_ui/ClaimAdmin';
import { IconShield } from '@/app/icons';

// /admin for a non-admin while first-admin setup is switched on (TB_ALLOW_ADMIN_CLAIM=1) and nobody is an
// admin yet. Everyone else gets the usual 404.
export default function ClaimCard({ user }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="empty adm-claim">
      <h3 className="wi" style={{ justifyContent: 'center' }}><IconShield size={18} /> Set up admin access</h3>
      <p>Nobody is an admin yet. The first person to claim it becomes the admin.</p>
      <button type="button" className="btn btn-ink" onClick={() => setOpen(true)}>Make me the admin</button>
      {open && <ClaimAdminModal user={user} onClose={() => setOpen(false)} onClaimed={() => window.location.assign('/admin')} />}
    </div>
  );
}
