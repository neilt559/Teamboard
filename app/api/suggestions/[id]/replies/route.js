import { handle, str, bad, notFound, parseId } from '@/lib/http';
import { query } from '@/lib/db';
import { isAdmin } from '@/lib/policy';
import { loadReply } from '@/lib/queries/suggestions';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';
export const maxDuration = 60;

// Reply to a suggestion as the signed-in user (rule 23). Anyone can reply. If you posted the suggestion
// anonymously, your reply is anonymous too (rule 28): the flag is still stored as today (old code reads it),
// and every read computes it again from the suggestion (design §13 #13). One statement, so a suggestion
// deleted or hidden meanwhile simply matches nothing.
export const POST = handle(async ({ viewer, params, body }) => {
  const id = parseId(params.id);
  const text = str((await body()).body, 5000);
  if (!text) throw bad('Write something first.');
  const uid = String(viewer.id);
  const r = await query(
    `WITH s AS (SELECT id, user_id, anonymous FROM suggestions
                WHERE id = $1::bigint AND (hidden_at IS NULL OR $4::boolean))
     INSERT INTO suggestion_replies (suggestion_id, user_id, body, anonymous)
     SELECT s.id, $2::bigint, $3::text, COALESCE(s.anonymous AND s.user_id = $2::bigint, false) FROM s
     RETURNING id`,
    [id, uid, text, isAdmin(viewer)]);
  if (!r.rows.length) throw notFound('That suggestion was deleted.');
  const rid = String(r.rows[0].id);
  const row = await loadReply(viewer, rid);
  return { ...(row || {}), id: rid };
}, { legacyWrite: true });
