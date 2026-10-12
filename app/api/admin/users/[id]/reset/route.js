import { handle, HttpError, bad, parseId } from '@/lib/http';
import { hashPassword, tempPassword, MIN_TEMP_PASSWORD, MAX_PASSWORD } from '@/lib/auth';
import { resetPassword } from '@/lib/queries/admin';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';
export const maxDuration = 60;

// Temporary password (§13 #15, rule 30). Server-generated (four words plus two digits) unless the admin types
// one of at least 8 characters. Sets must_change, signs the person out on every device (sessions expired,
// not deleted), clears their sign-in lock, and is audited. Returns the password once so the admin can pass
// it on: { ok, password, generated }.
export const POST = handle(async ({ viewer, params, body }) => {
  const uid = parseId(params.id);
  const b = await body();
  let password = b.password;
  const generated = password == null || password === '';
  if (generated) password = tempPassword();
  else {
    if (typeof password !== 'string') throw bad('The temporary password must be text.');
    if (password.length < MIN_TEMP_PASSWORD) throw bad(`The temporary password needs at least ${MIN_TEMP_PASSWORD} characters.`);
    if (password.length > MAX_PASSWORD) throw bad(`The temporary password can be at most ${MAX_PASSWORD} characters.`);
  }
  const ok = await resetPassword({ adminId: viewer.id, userId: uid, hash: hashPassword(password) });
  if (!ok) throw new HttpError(404, 'Account not found');
  return { ok: true, password, generated };
}, { auth: 'admin' });
