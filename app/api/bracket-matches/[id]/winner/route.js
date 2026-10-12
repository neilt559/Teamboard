import { handle, parseId, bad, notFound, forbidden, HttpError } from '@/lib/http';
import { query } from '@/lib/db';
import { isOrganizer } from '@/lib/access';
import { ROUNDS, nextSlot } from '@/lib/bracket';
import { readMatch } from '../../../brackets/_shared';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';
export const maxDuration = 60;

// Winners are picked by hand in manual brackets ("who's in the office changes day to day", rule 50). The
// legacy bracket (crown_policy 'anyone') stays open to everyone; new brackets are crowned by organizers.
// Auto brackets (Release 3) are decided at midnight Central; K3 adds the organizer "decide early" here.

const CROWN_FAIL = 'Couldn’t declare that winner — the matchup may already be decided, or its round isn’t open yet. Refresh and try again.';
const AUTO_MSG = 'This bracket advances on its own at midnight Central.';
const ORG_ONLY = 'Only culture organizers can pick winners in this bracket.';

// One atomic statement (design §10(c) "Manual crown"): the guarded UPDATE (not archived or deleted, manual,
// policy, undecided, both sides set, the entrant is one of them, every earlier round decided), the slot fill
// in the next round (or the champion), and an audit row. Two crowns at once can't both win (rule 25).
const CROWN_SQL = `
WITH d AS (
  UPDATE bracket_matches m
     SET winner_id = $2::bigint, decided_at = $4::timestamptz, decided_by = 'manual', decided_by_user = $3::bigint,
         decide_reason = 'manual',
         a_votes = (SELECT count(*) FROM bracket_votes v WHERE v.match_id = m.id AND v.entrant_id = m.a_id),
         b_votes = (SELECT count(*) FROM bracket_votes v WHERE v.match_id = m.id AND v.entrant_id = m.b_id)
    FROM brackets b
   WHERE m.id = $1::bigint AND b.id = m.bracket_id AND NOT b.archived AND b.deleted_at IS NULL AND b.mode = 'manual'
     AND (b.crown_policy = 'anyone' OR $5::boolean)
     AND m.winner_id IS NULL AND m.a_id IS NOT NULL AND m.b_id IS NOT NULL AND $2::bigint IN (m.a_id, m.b_id)
     AND NOT EXISTS (SELECT 1 FROM bracket_matches p WHERE p.bracket_id = m.bracket_id AND p.round < m.round AND p.winner_id IS NULL)
  RETURNING m.id, m.bracket_id, m.round, m.idx),
fill AS (
  UPDATE bracket_matches n
     SET a_id = CASE WHEN d.round > 0 AND d.idx % 2 = 0 THEN $2::bigint ELSE n.a_id END,
         b_id = CASE WHEN d.round = 0 OR d.idx % 2 = 1 THEN $2::bigint ELSE n.b_id END
    FROM d
   WHERE d.round < 4 AND n.bracket_id = d.bracket_id AND n.round = d.round + 1
     AND n.idx = CASE WHEN d.round = 0 THEN d.idx * 2 ELSE d.idx / 2 END),
champ AS (
  UPDATE brackets x SET champion_id = $2::bigint, completed_at = $4::timestamptz
    FROM d WHERE d.round = 4 AND x.id = d.bracket_id),
au AS (
  INSERT INTO audit_log (actor_id, action, entity, entity_id, detail)
  SELECT $3::bigint, 'bracket.crown', 'bracket_matches', d.id::text,
         jsonb_build_object('bracket_id', d.bracket_id, 'round', d.round, 'idx', d.idx, 'winner_id', $2::bigint)
  FROM d)
SELECT count(*)::int AS decided FROM d`;

// POST /api/bracket-matches/:id/winner { entrant_id } -> { ok }
export const POST = handle(async ({ viewer, params, body, now }) => {
  const id = parseId(params.id);
  const b = await body();
  if (!b.entrant_id) throw bad('entrant_id required');
  const eid = parseId(b.entrant_id);
  const org = isOrganizer(viewer);
  const r = await query(CROWN_SQL, [id, eid, String(viewer.id), new Date(now).toISOString(), org]);
  if (Number(r.rows[0]?.decided || 0) > 0) return { ok: true };
  // Nothing changed: say why (today's 409 text for everything that isn't a permission or mode question).
  const m = await readMatch(id);
  if (m && !m.deleted && !m.archived) {
    if (m.mode === 'auto') throw new HttpError(409, AUTO_MSG);
    if (m.crown_policy !== 'anyone' && !org) throw forbidden(ORG_ONLY);
  }
  throw new HttpError(409, CROWN_FAIL);
}, { legacyWrite: true });

// Undo (design §10(c) "Manual undo"), one statement: lock the match (guarded by crown_policy), lock the next
// match and refuse when it is decided, write the next match's votes to audit_log, clear them (today's rule 25),
// empty the slot (or clear the champion), then clear the winner. Locking the next match (rising rounds, the same
// order a crown locks in, so no deadlock) makes a crown of it that commits while this runs visible here: the
// undo then waits, re-reads it decided and refuses, instead of emptying the slot of a decided match (rule 25).
const UNDO_SQL = `
WITH m AS (
  SELECT m.id, m.bracket_id, m.round, m.idx, m.winner_id
    FROM bracket_matches m JOIN brackets b ON b.id = m.bracket_id
   WHERE m.id = $1::bigint AND m.winner_id IS NOT NULL AND NOT b.archived AND b.deleted_at IS NULL AND b.mode = 'manual'
     AND (b.crown_policy = 'anyone' OR $3::boolean)
   FOR UPDATE OF m),
nx AS (
  SELECT n.id, n.winner_id FROM bracket_matches n JOIN m ON n.bracket_id = m.bracket_id
   WHERE m.round < 4 AND n.round = m.round + 1 AND n.idx = CASE WHEN m.round = 0 THEN m.idx * 2 ELSE m.idx / 2 END
   FOR UPDATE OF n),
ok AS (SELECT m.* FROM m WHERE NOT EXISTS (SELECT 1 FROM nx WHERE nx.winner_id IS NOT NULL)),
au AS (
  INSERT INTO audit_log (actor_id, action, entity, entity_id, detail)
  SELECT $2::bigint, 'bracket.undo', 'bracket_matches', ok.id::text,
         jsonb_build_object('bracket_id', ok.bracket_id, 'round', ok.round, 'idx', ok.idx, 'winner_id', ok.winner_id,
           'cleared_votes', COALESCE((SELECT jsonb_agg(to_jsonb(v) ORDER BY v.created_at) FROM bracket_votes v
                                      WHERE v.match_id IN (SELECT nx.id FROM nx)), '[]'::jsonb))
  FROM ok),
dv AS (DELETE FROM bracket_votes v USING ok, nx WHERE v.match_id = nx.id RETURNING v.match_id),
slot AS (
  UPDATE bracket_matches n
     SET a_id = CASE WHEN ok.round > 0 AND ok.idx % 2 = 0 THEN NULL ELSE n.a_id END,
         b_id = CASE WHEN ok.round = 0 OR ok.idx % 2 = 1 THEN NULL ELSE n.b_id END
    FROM ok, nx WHERE n.id = nx.id AND n.winner_id IS NULL),
champ AS (
  UPDATE brackets x SET champion_id = NULL, completed_at = NULL FROM ok WHERE ok.round = 4 AND x.id = ok.bracket_id),
clr AS (
  UPDATE bracket_matches c
     SET winner_id = NULL, decided_at = NULL, decided_by = NULL, decided_by_user = NULL, decide_reason = NULL,
         a_votes = NULL, b_votes = NULL
    FROM ok WHERE c.id = ok.id
  RETURNING c.id)
SELECT (SELECT count(*) FROM clr)::int AS undone`;

// DELETE /api/bracket-matches/:id/winner -> { ok }. Today's checks and messages, in order: 404 "Matchup not
// found"; 409 "This bracket is closed."; no winner -> { ok }; 409 "Undo the {next round} result first."
export const DELETE = handle(async ({ viewer, params }) => {
  const id = parseId(params.id);
  const org = isOrganizer(viewer);
  const why = (m) => {
    if (!m || m.deleted) return notFound('Matchup not found');
    if (m.archived) return new HttpError(409, 'This bracket is closed.');
    if (!m.winner_id) return null;                                     // nothing to undo
    if (m.mode === 'auto') return new HttpError(409, AUTO_MSG);
    if (m.crown_policy !== 'anyone' && !org) return forbidden(ORG_ONLY);
    const nx = nextSlot(m.round, m.idx);
    if (nx && m.next_winner_id) return new HttpError(409, `Undo the ${ROUNDS[nx.round]} result first.`);
    return undefined;                                                  // allowed
  };
  const before = why(await readMatch(id));
  if (before === null) return { ok: true };
  if (before) throw before;
  const r = await query(UNDO_SQL, [id, String(viewer.id), org]);
  if (Number(r.rows[0]?.undone || 0) > 0) return { ok: true };
  const after = why(await readMatch(id));                              // someone else got there first
  if (after === null) return { ok: true };
  if (after) throw after;
  throw new HttpError(409, 'This matchup just changed — refresh and try again.');
}, { legacyWrite: true });
