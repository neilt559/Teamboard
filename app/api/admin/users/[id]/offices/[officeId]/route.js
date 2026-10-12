import { handle, parseId } from '@/lib/http';
import { revokeOffice, loadAccount } from '@/lib/queries/admin';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';
export const maxDuration = 60;

// Revoke an extra office (soft: revoked_at/by). Their team is cleared in the same statement when it sits in
// that office (and that isn't their home office), so team-thread access can't outlive the grant (§8.2).
// Revoking something already revoked is a no-op.
export const DELETE = handle(async ({ viewer, params }) => {
  const uid = parseId(params.id);
  const officeId = parseId(params.officeId);
  const r = await revokeOffice({ adminId: viewer.id, userId: uid, officeId });
  return { ok: true, ...r, user: await loadAccount(uid) };
}, { auth: 'admin' });
