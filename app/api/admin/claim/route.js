import { handle, HttpError } from '@/lib/http';
import { adminClaimAllowed, claimAdmin } from '@/lib/queries/admin';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';
export const maxDuration = 60;

// First-admin bootstrap (§13 #6). 404 unless TB_ALLOW_ADMIN_CLAIM=1 (never set on Vercel). One
// advisory-locked transaction, so two people can't both become the first admin.
export const POST = handle(async ({ viewer }) => {
  if (!adminClaimAllowed()) throw new HttpError(404, 'Not found');
  if (!(await claimAdmin(viewer.id))) throw new HttpError(403, 'An admin is already set up.');
  return { ok: true };
}, { allowIncomplete: true });
