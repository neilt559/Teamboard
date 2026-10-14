import { handle, str, bad, notFound, parseId, HttpError } from '@/lib/http';
import { query } from '@/lib/db';
import { isAdmin } from '@/lib/policy';
import { loadReply, suggestionMeta } from '@/lib/queries/suggestions';
import { writableSql, ARCHIVED_MESSAGE } from '@/lib/queries/spaces';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';
export const maxDuration = 60;

// Reply to a suggestion as the signed-in user (rule 23). Anyone who can read its thread space can reply. If you
// posted the suggestion anonymously, your reply is anonymous too (rule 28): the flag is still stored as today (old
// code reads it), and every read computes it again from the suggestion (design §13 #13). One statement, so a
// suggestion deleted or hidden meanwhile, or a space the viewer lost or that was archived, simply matches nothing.
// Release 2 (design-amendments A5): a space the viewer can't read is the same 404 as a missing suggestion; an
// archived office or team space is read-only (409, admins excepted).
export const POST = handle(async ({ viewer, params, body }) => {
  const id = parseId(params.id);
  const text = str((await body()).body, 5000);
  if (!text) throw bad('Write something first.');
  const uid = String(viewer.id);
  const admin = isAdmin(viewer);
  const meta = await suggestionMeta(viewer, id);
  if (!meta || (meta.hidden && !admin)) throw notFound('That suggestion was deleted.');
  if (!meta.writable) throw new HttpError(409, ARCHIVED_MESSAGE, { code: 'archived' });
  const r = await query(
    `WITH s AS (SELECT id, user_id, anonymous FROM suggestions
                WHERE id = $1::bigint AND (hidden_at IS NULL OR $4::boolean)
                  AND tb_can_read_space($2::bigint, scope, office_id, team_id)
                  AND ${writableSql('$2::bigint', 'suggestions.scope', 'suggestions.office_id', 'suggestions.team_id')})
     INSERT INTO suggestion_replies (suggestion_id, user_id, body, anonymous)
     SELECT s.id, $2::bigint, $3::text, COALESCE(s.anonymous AND s.user_id = $2::bigint, false) FROM s
     RETURNING id`,
    [id, uid, text, admin]);
  if (!r.rows.length) throw notFound('That suggestion was deleted.');
  const rid = String(r.rows[0].id);
  const row = await loadReply(viewer, rid);
  return { ...(row || {}), id: rid };
}, { legacyWrite: true });
