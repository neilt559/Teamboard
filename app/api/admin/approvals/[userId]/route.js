import { handle, HttpError, bad, parseId } from '@/lib/http';
import { query } from '@/lib/db';
import { approvePosition, setPosition, expectedIdentity } from '@/lib/requests';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';
export const maxDuration = 60;

// Decide a position request (§4.2a): { decision: 'approve' | 'set', expected_position_id, position_id?,
// verify_identity?, expected_identity?: { display_name, email } }.
// Applies only if the person hasn't changed their request since the admin loaded it (409 otherwise).
// verify_identity (the card's "Name and email look right" tick) also verifies them in the same UPDATE, but only
// while their name and email are still expected_identity (what the card showed; required with the tick).
// -> { ok, verified, message? } (message when the approval applied but the name or email had changed).
const STALE_IDENTITY = 'Approved, but their name or email changed since you loaded this, so they’re still unverified. Check the new one.';
export const POST = handle(async ({ viewer, params, body }) => {
  const uid = parseId(params.userId);
  const b = await body();
  const verify = b.verify_identity === true;
  const ident = expectedIdentity(b.expected_identity);
  if (verify && !ident) throw bad('Refresh the page: verifying needs the name and email you checked.');
  const expected = b.expected_position_id == null || b.expected_position_id === '' ? null : parseId(b.expected_position_id);
  const answer = (r) => {
    if (!r.ok) throw new HttpError(409, 'This request changed. Refresh.');
    return verify && !r.verified ? { ok: true, verified: false, message: STALE_IDENTITY } : { ok: true, verified: r.verified };
  };
  if (b.decision === 'approve') {
    if (expected == null) throw bad('Missing expected_position_id.');
    return answer(await approvePosition({ adminId: viewer.id, userId: uid, expectedPositionId: expected, verify, expected: ident }));
  }
  if (b.decision === 'set') {
    if (b.position_id == null || b.position_id === '') throw bad('Pick a position.');
    const positionId = parseId(b.position_id);
    const pos = await query(`SELECT 1 FROM positions WHERE id = $1::bigint AND NOT archived`, [positionId]);
    if (!pos.rows.length) throw bad('Pick an active position.');
    return answer(await setPosition({ adminId: viewer.id, userId: uid, expectedPositionId: expected, positionId, verify, expected: ident }));
  }
  throw bad('decision must be approve or set.');
}, { auth: 'admin' });
