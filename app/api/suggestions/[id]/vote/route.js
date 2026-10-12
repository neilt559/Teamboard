import { handle, notFound, parseId } from '@/lib/http';
import { query } from '@/lib/db';
import { isAdmin } from '@/lib/policy';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';
export const maxDuration = 60;

// +1 ({ on: true }) or take back your +1 ({ on: false }). One per person (PK (suggestion_id, user_id), rule 24);
// the voter always comes from the session (rule 23). Authors may +1 their own idea. A missing (or hidden)
// suggestion is now a 404 instead of a foreign-key 500 (design §8.2). Voter lists are never returned.
export const POST = handle(async ({ viewer, params, body }) => {
  const id = parseId(params.id);
  const b = await body();
  const on = !!b.on;
  const uid = String(viewer.id);
  const admin = isAdmin(viewer);
  const r = on
    ? await query(
      `WITH s AS (SELECT id FROM suggestions WHERE id = $1::bigint AND (hidden_at IS NULL OR $3::boolean)),
            ins AS (INSERT INTO suggestion_votes (suggestion_id, user_id)
                    SELECT s.id, $2::bigint FROM s ON CONFLICT DO NOTHING RETURNING suggestion_id)
       SELECT (SELECT count(*) FROM s)::int AS found,
              ((SELECT count(*) FROM suggestion_votes v WHERE v.suggestion_id = $1::bigint)
                + (SELECT count(*) FROM ins))::int AS votes`,
      [id, uid, admin])
    : await query(
      `WITH s AS (SELECT id FROM suggestions WHERE id = $1::bigint AND (hidden_at IS NULL OR $3::boolean)),
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
