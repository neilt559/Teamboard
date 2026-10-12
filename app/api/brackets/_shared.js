import 'server-only';
import { query } from '@/lib/db';
import { str } from '@/lib/http';

// Helpers shared by the bracket routes (app/api/brackets/**, bracket-entrants, bracket-matches, bracket-votes).
// Not a route: Next only serves route.js files.

// Serializes the statements that change which bracket is current (create, un-archive, restore), so two
// of them at once can never leave two live brackets.
export const BRACKET_LOCK = 7342002;

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
    archived: !!m.archived, deleted: !!m.deleted, earlier_open: Number(m.earlier_open) || 0,
  };
}
