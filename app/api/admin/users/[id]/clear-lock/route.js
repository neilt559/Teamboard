import { handle, HttpError, parseId } from '@/lib/http';
import { clearSignInLock } from '@/lib/queries/admin';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';
export const maxDuration = 60;

// "Clear sign-in lock" (§13 #4): the username's failure count goes back to 0 (the row is reused, not deleted).
export const POST = handle(async ({ viewer, params }) => {
  const uid = parseId(params.id);
  if (!(await clearSignInLock({ adminId: viewer.id, userId: uid }))) throw new HttpError(404, 'Account not found');
  return { ok: true };
}, { auth: 'admin' });
