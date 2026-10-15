import 'server-only';
import { query } from '@/lib/db';
import { str, bad, HttpError } from '@/lib/http';
import { ROUNDS, scheduledRound, closesAt, roundWeekday } from '@/lib/bracket';
import { chicagoToday, weekdayOf, addDays } from '@/lib/time';

// Helpers shared by the bracket routes (app/api/brackets/**, bracket-entrants, bracket-matches, bracket-votes).
// Not a route: Next only serves route.js files.

// Serializes the statements that change which bracket is current (create, activation, un-archive, restore), so
// two of them at once can never leave two live brackets. Defined next to the resolver (lib/bracket-auto.js).
export { BRACKET_LOCK } from '@/lib/bracket-auto';

export const TAKEN_MONDAY = 'There’s already a bracket starting that Monday. Pick another Monday.';

// A weekly auto bracket's start (design §10(c) Rules): a real 'YYYY-MM-DD' Monday, today (Central) or later, and
// at most a year out. Throws a plain 400 otherwise.
export function checkStartMonday(ymd, now) {
  const s = String(ymd ?? '');
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(s) || addDays(s, 0) !== s) throw bad('Pick the Monday it starts.');
  if (weekdayOf(s) !== 1) throw bad('A weekly bracket starts on a Monday.');
  const today = chicagoToday(now);
  if (s < today) throw bad('Pick a Monday from today on.');
  if (s > addDays(today, 371)) throw bad('Pick a Monday within the next year.');
  return s;
}

// Four region names: trimmed, 60 characters, blank -> "Quadrant N" (today's PATCH and POST rules).
export function normRegions(v) {
  const arr = Array.isArray(v) ? v : [];
  return [0, 1, 2, 3].map((q) => str(arr[q], 60) || `Quadrant ${q + 1}`);
}

// Everything the vote, crown and undo routes need to pick today's messages, in one read:
// the match, its bracket's state, the next match (where the winner goes) and how many earlier-round
// matches are still undecided. null when the match doesn't exist.
export async function readMatch(matchId) {
  const r = await query(
    `SELECT m.id, m.bracket_id, m.round, m.idx, m.a_id, m.b_id, m.winner_id, m.decided_by,
            b.archived, (b.deleted_at IS NOT NULL) AS deleted, b.mode, b.crown_policy, b.starts_on, b.activated_at,
            n.id AS next_id, n.winner_id AS next_winner_id,
            (SELECT count(*) FROM bracket_matches p
              WHERE p.bracket_id = m.bracket_id AND p.round < m.round AND p.winner_id IS NULL)::int AS earlier_open
     FROM bracket_matches m JOIN brackets b ON b.id = m.bracket_id
     LEFT JOIN bracket_matches n ON n.bracket_id = m.bracket_id AND m.round < 4 AND n.round = m.round + 1
       AND n.idx = CASE WHEN m.round = 0 THEN m.idx * 2 ELSE m.idx / 2 END
     WHERE m.id = $1::bigint`, [String(matchId)]);
  const m = r.rows[0];
  if (!m) return null;
  return {
    ...m,
    id: String(m.id), bracket_id: String(m.bracket_id), round: Number(m.round), idx: Number(m.idx),
    a_id: m.a_id == null ? null : String(m.a_id), b_id: m.b_id == null ? null : String(m.b_id),
    winner_id: m.winner_id == null ? null : String(m.winner_id),
    next_id: m.next_id == null ? null : String(m.next_id),
    next_winner_id: m.next_winner_id == null ? null : String(m.next_winner_id),
    starts_on: m.starts_on == null ? null : String(m.starts_on),
    archived: !!m.archived, deleted: !!m.deleted, earlier_open: Number(m.earlier_open) || 0,
  };
}

// The voting window of a match, for the shared vote / decide-early SQL (design §10(c) "Voting"): only for auto
// brackets { open: the round open today (CT), closeIso: this match's round close }. Manual brackets get NULLs:
// their starts_on is NULL and the SQL's manual branch never reads these (the live legacy bracket must never
// compute a close time).
export function voteWindow(m, now) {
  if (!m || m.mode !== 'auto' || !m.starts_on) return { open: null, closeIso: null };
  return { open: scheduledRound(m.starts_on, now), closeIso: new Date(closesAt(m.starts_on, m.round)).toISOString() };
}

// Why an auto bracket's match can't be voted on (or decided early) right now, or null when it can.
//   entrantId: the entrant being picked (null for a retract: only the window matters then).
//   { early: true }: an organizer's "decide early" (past rounds are final; a decided match says so).
export function autoRefusal(m, entrantId, now, { early = false } = {}) {
  if (!m || m.deleted) return new HttpError(404, 'Matchup not found');
  if (m.archived) return new HttpError(409, 'This bracket is closed.');
  const open = scheduledRound(m.starts_on, now);
  const name = ROUNDS[m.round];
  const closed = m.round < open || now >= closesAt(m.starts_on, m.round);
  if (m.winner_id) {
    if (closed || m.decided_by !== 'organizer') {
      return new HttpError(409, early ? 'Past rounds are final.' : `Voting for the ${name} closed at midnight Central.`);
    }
    return new HttpError(409, 'An organizer already decided this matchup.');
  }
  if (open < 0) return new HttpError(409, 'Voting opens Monday at 12:00 AM Central.');
  if (m.round > open) return new HttpError(409, `The ${name} opens ${roundWeekday(m.starts_on, m.round)}.`);
  if (closed) return new HttpError(409, early ? 'Past rounds are final.' : `Voting for the ${name} closed at midnight Central.`);
  if (!entrantId) return null;
  if (!m.a_id || !m.b_id) return new HttpError(409, 'This matchup is being set up — try again in a minute.');
  if (entrantId !== m.a_id && entrantId !== m.b_id) return new HttpError(400, 'That entrant isn’t in this matchup.');
  return null;
}
