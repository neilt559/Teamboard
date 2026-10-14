import { handle, notFound, parseId, HttpError } from '@/lib/http';
import { query } from '@/lib/db';
import { isAdmin } from '@/lib/policy';
import { suggestionMeta } from '@/lib/queries/suggestions';
import { writableSql, ARCHIVED_MESSAGE } from '@/lib/queries/spaces';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';
export const maxDuration = 60;

// +1 ({ on: true }) or take back your +1 ({ on: false }). One per person (PK (suggestion_id, user_id), rule 24);
// the voter always comes from the session (rule 23). Authors may +1 their own idea. A missing (or hidden)
// suggestion is now a 404 instead of a foreign-key 500 (design §8.2). Voter lists are never returned.
// Release 2 (design-amendments A5): only in a thread space the viewer can read (404 otherwise, the same as
// missing), and not in an archived office or team space (409, admins excepted); both re-checked in the statement.
export const POST = handle(async ({ viewer, params, body }) => {
  const id = parseId(params.id);
  const b = await body();
  const on = !!b.on;
  const uid = String(viewer.id);
  const admin = isAdmin(viewer);
  const meta = await suggestionMeta(viewer, id);
  if (!meta || (meta.hidden && !admin)) throw notFound('Suggestion not found');
  if (!meta.writable) throw new HttpError(409, ARCHIVED_MESSAGE, { code: 'archived' });
  const target = `SELECT s.id FROM suggestions s WHERE s.id = $1::bigint AND (s.hidden_at IS NULL OR $3::boolean)
                    AND tb_can_read_space($2::bigint, s.scope, s.office_id, s.team_id)
                    AND ${writableSql('$2::bigint', 's.scope', 's.office_id', 's.team_id')}`;
  const r = on
    ? await query(
      `WITH s AS (${target}),
            ins AS (INSERT INTO suggestion_votes (suggestion_id, user_id)
                    SELECT s.id, $2::bigint FROM s ON CONFLICT DO NOTHING RETURNING suggestion_id)
       SELECT (SELECT count(*) FROM s)::int AS found,
              ((SELECT count(*) FROM suggestion_votes v WHERE v.suggestion_id = $1::bigint)
                + (SELECT count(*) FROM ins))::int AS votes`,
      [id, uid, admin])
    : await query(
      `WITH s AS (${target}),
            del AS (DELETE FROM suggestion_votes v USING s
                    WHERE v.suggestion_id = s.id AND v.user_id = $2::bigint RETURNING v.suggestion_id)
       SELECT (SELECT count(*) FROM s)::int AS found,
              ((SELECT count(*) FROM suggestion_votes v WHERE v.suggestion_id = $1::bigint)
                - (SELECT count(*) FROM del))::int AS votes`,
      [id, uid, admin]);
  const row = r.rows[0] || {};
  if (!Number(row.found)) throw notFound('Suggestion not found');
  return { ok: true, voted: on, votes: Math.max(0, Number(row.votes) || 0) };
}, { legacyWrite: true });
