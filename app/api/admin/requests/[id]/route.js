import { handle, HttpError, bad, parseId, str } from '@/lib/http';
import { query } from '@/lib/db';
import { approveOfficeChange, approvePersonLink, declineRequest, expectedIdentity } from '@/lib/requests';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';
export const maxDuration = 60;

const DECIDED = 'Someone already decided this request.';
const STALE_IDENTITY = 'Approved, but their name or email changed since you loaded this, so they’re still unverified. Check the new one.';

// Decide an office change or a "that's me" person link (§4.2b, §5.4): { decision: 'approve' | 'decline',
// note?, verify_identity?, expected_identity?: { display_name, email } }. A request is marked approved only by
// the statement that applied it. verify_identity also verifies them, but only while their name and email are
// still expected_identity (what the card showed; required with it). -> { ok, verified?, message?, projects_added? }
export const POST = handle(async ({ viewer, params, body }) => {
  const rid = parseId(params.id);
  const b = await body();
  const note = str(b.note, 500);
  const verify = b.verify_identity === true && b.decision === 'approve';
  const ident = expectedIdentity(b.expected_identity);
  if (verify && !ident) throw bad('Refresh the page: verifying needs the name and email you checked.');
  const stale = (r) => (verify && !r.verified ? { verified: false, message: STALE_IDENTITY } : { verified: r.verified });
  const row = (await query(`SELECT kind, status FROM access_requests WHERE id = $1::bigint`, [rid])).rows[0];
  if (!row) throw new HttpError(404, 'Request not found');
  if (row.status !== 'pending') throw new HttpError(409, DECIDED);

  if (b.decision === 'decline') {
    if (!(await declineRequest({ adminId: viewer.id, requestId: rid, note }))) throw new HttpError(409, DECIDED);
    return { ok: true };
  }
  if (b.decision !== 'approve') throw bad('decision must be approve or decline.');

  if (row.kind === 'office_change') {
    const r = await approveOfficeChange({ adminId: viewer.id, requestId: rid, note, verify, expected: ident });
    if (!r.pending) throw new HttpError(409, DECIDED);
    if (!r.approved) throw new HttpError(409, 'That office is no longer available. Decline this request instead.');
    return { ok: true, ...stale(r) };
  }
  const r = await approvePersonLink({ adminId: viewer.id, requestId: rid, note, verify, expected: ident });
  if (!r.pending) throw new HttpError(409, DECIDED);
  if (!r.linked) {
    throw new HttpError(409, 'That name is already linked, or this account already has its own name with tasks. '
      + 'Reassign those tasks on the board first.');
  }
  return { ok: true, projects_added: r.projects_added, ...stale(r) };
}, { auth: 'admin' });
