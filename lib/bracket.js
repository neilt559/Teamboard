// Shared bracket shape, used by both the API routes and the page.
//
// 20 entrants = 4 quadrants x 5 seeds. In each quadrant, seeds 4 & 5 play a
// wildcard game whose winner meets the 1 seed in the Round of 16; seeds 2 & 3
// meet each other. Quadrant winners (Round of 8) meet in the Round of 4 —
// quadrants 1 v 2 and 3 v 4 — and those winners play the Championship.
export const ROUNDS = ['Wildcard', 'Round of 16', 'Round of 8', 'Round of 4', 'Championship'];
export const QUADRANTS = 4;
export const SEEDS = 5;

// Where the winner of match (round, idx) goes next, or null for the final.
export function nextSlot(round, idx) {
  round = Number(round);
  idx = Number(idx);
  if (round >= 4) return null;
  if (round === 0) return { round: 1, idx: idx * 2, side: 'b' };
  return { round: round + 1, idx: Math.floor(idx / 2), side: idx % 2 === 0 ? 'a' : 'b' };
}

// The 19 matches of a fresh bracket. idOf(quadrant, seed) -> entrant id.
export function initialMatches(idOf) {
  const ms = [];
  for (let q = 0; q < QUADRANTS; q++) ms.push({ round: 0, idx: q, a_id: idOf(q, 4), b_id: idOf(q, 5) });
  for (let q = 0; q < QUADRANTS; q++) {
    ms.push({ round: 1, idx: 2 * q, a_id: idOf(q, 1), b_id: null });
    ms.push({ round: 1, idx: 2 * q + 1, a_id: idOf(q, 2), b_id: idOf(q, 3) });
  }
  for (let q = 0; q < QUADRANTS; q++) ms.push({ round: 2, idx: q, a_id: null, b_id: null });
  ms.push({ round: 3, idx: 0, a_id: null, b_id: null });
  ms.push({ round: 3, idx: 1, a_id: null, b_id: null });
  ms.push({ round: 4, idx: 0, a_id: null, b_id: null });
  return ms;
}
