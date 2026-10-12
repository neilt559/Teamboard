import { handle, HttpError, bad, parseId } from '@/lib/http';
import { grantOffice, loadAccount } from '@/lib/queries/admin';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';
export const maxDuration = 60;

// Grant an extra office { office_id } (§4.1 "own offices" = home + active grants). A revoked grant is revived.
export const POST = handle(async ({ viewer, params, body }) => {
  const uid = parseId(params.id);
  const b = await body();
  if (b.office_id == null || b.office_id === '') throw bad('Pick an office.');
  const officeId = parseId(b.office_id);
  const r = await grantOffice({ adminId: viewer.id, userId: uid, officeId });
  if (r === 'missing') throw new HttpError(404, 'Account not found');
  if (r === 'home') throw bad('That’s already their home office.');
  if (r === 'office') throw bad('Pick an active office.');
  return { ok: true, granted: r === 'ok', user: await loadAccount(uid) };
}, { auth: 'admin' });
