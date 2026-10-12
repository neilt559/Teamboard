import { handle, forbidden, parseId, notFound } from '@/lib/http';
import { query } from '@/lib/db';
import { deleteWithSnapshot } from '@/lib/audit';
import { isAdmin } from '@/lib/policy';
import { loadReply } from '@/lib/queries/suggestions';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';
export const maxDuration = 60;

// Only the person who wrote a reply can delete it (rule 27). A reply that is already gone is fine
// ({ ok: true }, design §7.1); someone else's reply is 403. A JSON snapshot goes to audit_log in the same
// statement as the delete.
export const DELETE = handle(async ({ viewer, params }) => {
  const id = parseId(params.id);
  const r = await deleteWithSnapshot({
    table: 'suggestion_replies', id, actorId: viewer.id, action: 'suggestion_reply.delete',
    scopeSql: 'user_id = $1::bigint', scopeParams: [String(viewer.id)],
  });
  if (!r.deleted && r.existed) throw forbidden('Only the person who wrote a reply can delete it.');
  return { ok: true };
}, { legacyWrite: true });

// Moderation: { hidden: true | false }. Admins only (design §4.5 "hide suggestion or reply"). Replies
// themselves still can't be edited.
export const PATCH = handle(async ({ viewer, params, body }) => {
  const id = parseId(params.id);
  if (!isAdmin(viewer)) throw forbidden('Only admins can hide replies.');
  const b = await body();
  if (typeof b.hidden !== 'boolean') return { ok: true, row: await loadReply(viewer, id) };
  const r = await query(
    `UPDATE suggestion_replies
        SET hidden_at = CASE WHEN $2::boolean THEN COALESCE(hidden_at, now()) END,
            hidden_by = CASE WHEN $2::boolean THEN COALESCE(hidden_by, $3::bigint) END
      WHERE id = $1::bigint RETURNING id`,
    [id, b.hidden, String(viewer.id)]);
  if (!r.rows.length) throw notFound('Reply not found');
  return { ok: true, row: await loadReply(viewer, id) };
});
