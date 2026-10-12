import { handle, parseId, notFound, HttpError } from '@/lib/http';
import { query, transaction } from '@/lib/db';
import { ROUNDS } from '@/lib/bracket';
import { readMatch } from '../brackets/_shared';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';
export const maxDuration = 60;

// Today's checks, in today's order (inventory §1.14). The voter always comes from the session (rule 23);
// one vote per user per matchup (rule 24). Manual brackets: a round opens once every earlier matchup has
// a winner. The auto branch ($5 open round, $6 close) is Release 3; it gets NULLs here, so it never matches.
function refusal(m, entrantId) {
  if (!m || m.deleted) return notFound('Matchup not found');
  if (m.archived) return new HttpError(409, 'This bracket is closed.');
  if (m.winner_id) return new HttpError(409, 'A winner was already picked for this matchup.');
  if (m.mode === 'auto') return new HttpError(409, 'Voting on this bracket opens with its scheduled round.');
  if (m.earlier_open > 0) {
    return new HttpError(409, `Voting for the ${ROUNDS[m.round]} opens once the ${ROUNDS[m.round - 1]} is finished.`);
  }
  if (!entrantId) return null;
  if (!m.a_id || !m.b_id) return new HttpError(409, 'This matchup isn’t set yet.');
  if (entrantId !== m.a_id && entrantId !== m.b_id) return new HttpError(400, 'That entrant isn’t in this matchup.');
  return null;
}

// The guard both statements share (design §10(c) "Voting").
const GUARD = `NOT b.archived AND b.deleted_at IS NULL AND m.winner_id IS NULL
  AND ((b.mode = 'manual' AND NOT EXISTS (SELECT 1 FROM bracket_matches p
          WHERE p.bracket_id = m.bracket_id AND p.round < m.round AND p.winner_id IS NULL))
    OR (b.mode = 'auto' AND m.round = $5::int AND $4::timestamptz < $6::timestamptz))`;

const VOTE_SQL = `
INSERT INTO bracket_votes (match_id, user_id, entrant_id, created_at)
SELECT m.id, $2::bigint, $3::bigint, $4::timestamptz FROM bracket_matches m JOIN brackets b ON b.id = m.bracket_id
WHERE m.id = $1::bigint AND m.a_id IS NOT NULL AND m.b_id IS NOT NULL AND $3::bigint IN (m.a_id, m.b_id) AND ${GUARD}
ON CONFLICT (match_id, user_id) DO UPDATE SET entrant_id = EXCLUDED.entrant_id, created_at = EXCLUDED.created_at
RETURNING match_id`;

const RETRACT_SQL = `
DELETE FROM bracket_votes v USING bracket_matches m, brackets b
WHERE v.match_id = $1::bigint AND v.user_id = $2::bigint AND m.id = v.match_id AND b.id = m.bracket_id
  AND ($3::bigint IS NULL) AND ${GUARD}
RETURNING v.match_id`;

// POST /api/bracket-votes { match_id, entrant_id } -> { ok }. A falsy entrant_id takes your vote back;
// a different entrant switches it (and moves you to the end of the voter row, as today).
export const POST = handle(async ({ viewer, body, now }) => {
  const b = await body();
  const mid = parseId(b.match_id);
  const eid = b.entrant_id ? parseId(b.entrant_id) : null;
  const m = await readMatch(mid);
  const no = refusal(m, eid);
  if (no) throw no;
  const params = [mid, String(viewer.id), eid, new Date(now).toISOString(), null, null];
  // FOR SHARE blocks a resolver's FOR UPDATE (Release 3) while the vote is written.
  const res = await transaction([
    query('SELECT id FROM bracket_matches WHERE id = $1::bigint FOR SHARE', [mid]),
    query(eid ? VOTE_SQL : RETRACT_SQL, params),
  ]);
  if (eid && !res[1].rows.length) {
    // Something changed between the read and the write (a winner was picked, an undo reopened an earlier
    // round, ...): re-read and give the message that applies now.
    const again = refusal(await readMatch(mid), eid);
    if (again) throw again;
    throw new HttpError(409, 'That matchup just changed — refresh and try again.');
  }
  return { ok: true };
}, { legacyWrite: true });

