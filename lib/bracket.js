import { chicagoMidnightUtc, chicagoToday, addDays, daysBetween } from './time.js';

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

// Rounds are played one at a time: the round that's open for voting is the
// earliest one that still has an undecided matchup (null once it's all done).
// A round never opens until every matchup before it has a winner.
export function currentRound(matches) {
  for (let r = 0; r < ROUNDS.length; r++) {
    if (matches.some((m) => Number(m.round) === r && !m.winner_id)) return r;
  }
  return null;
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

// ---------------------------------------------------------------- weekly auto brackets (Release 3, design §10(c))
// An auto bracket runs Mon-Fri of one week: round r is voted on the CT day starts_on + r and closes at the next CT
// midnight (R0 Wildcard Mon ... R4 Championship Fri; the champion shows from Saturday). These helpers are pure
// and isomorphic (the resolver, the vote route, the board UI and the unit vectors share them). starts_on is a
// 'YYYY-MM-DD' Monday; manual brackets have none, so never call these for them.

export const GRACE_MS = 30_000;                          // the resolver decides a round 30 s after its close

// Epoch ms when round r closes (midnight CT after its day). closesAt(S, -1) is when R0 opens.
export const closesAt = (startsOn, r) => chicagoMidnightUtc(addDays(startsOn, Number(r) + 1));
// Epoch ms when round r opens (midnight CT at the start of its day).
export const opensAt = (startsOn, r) => chicagoMidnightUtc(addDays(startsOn, Number(r)));

// -1 upcoming, 0..4 the round open for voting, 5 every round closed.
export function scheduledRound(startsOn, now) {
  const d = daysBetween(startsOn, chicagoToday(now));
  return d < 0 ? -1 : d > 4 ? 5 : d;
}

// The highest round whose close (plus the grace) has passed, or -1: the resolver decides rounds up to this one.
export function closedThrough(startsOn, now) {
  let r = -1;
  while (r < 4 && now >= closesAt(startsOn, r + 1) + GRACE_MS) r++;
  return r;
}

// Tie chain (mirrors the resolver's SQL; drives the "Leading" UI and the unit vectors):
// more votes -> lower seed -> more total votes received in this bracket -> lower quadrant index.
//   a, b: entrants { id, seed, quadrant }; votes / totals: { [entrantId]: count } (this match / whole bracket).
export function pickWinner(a, b, votes, totals) {
  const va = votes[a.id] || 0, vb = votes[b.id] || 0;
  if (va !== vb) return { side: va > vb ? 'a' : 'b', reason: 'votes' };
  if (Number(a.seed) !== Number(b.seed)) return { side: Number(a.seed) < Number(b.seed) ? 'a' : 'b', reason: 'seed' };
  const ta = totals[a.id] || 0, tb = totals[b.id] || 0;
  if (ta !== tb) return { side: ta > tb ? 'a' : 'b', reason: 'total_votes' };
  return { side: Number(a.quadrant) <= Number(b.quadrant) ? 'a' : 'b', reason: 'quadrant' };
}

// Weekday name of the day round r is voted ('Monday' ... 'Friday').
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const roundWeekday = (startsOn, r) => DAY_NAMES[new Date(`${addDays(startsOn, Number(r))}T00:00:00Z`).getUTCDay()];

// Where an auto bracket stands at `now` (the board, the status bar, the cards and GET /api/brackets/current):
//   { phase: 'upcoming' | 'open' | 'closing' | 'done', open_round, closes_at, opens_at, next_close }
//   open: a round is open for voting (open_round 0..4, closes_at its close, ISO).
//   closing: every round has closed but the final hasn't been decided yet (the first seconds after Sat 00:00).
//   upcoming: before Monday 00:00 CT (opens_at = R0's opening). done: the week is over and decided.
// next_close (epoch ms or null): the next instant the board changes on its own (a close plus the grace), for the
// page's one-shot refresh timer.
export function autoSchedule(startsOn, now, { decided = false } = {}) {
  const sr = scheduledRound(startsOn, now);
  const ct = closedThrough(startsOn, now);
  const nextClose = ct < 4 ? closesAt(startsOn, ct + 1) + GRACE_MS : null;
  if (sr < 0) {
    return { phase: 'upcoming', open_round: null, closes_at: null, opens_at: new Date(opensAt(startsOn, 0)).toISOString(), next_close: nextClose };
  }
  if (sr <= 4) {
    return { phase: 'open', open_round: sr, closes_at: new Date(closesAt(startsOn, sr)).toISOString(), opens_at: null, next_close: nextClose };
  }
  return { phase: decided ? 'done' : 'closing', open_round: null, closes_at: null, opens_at: null, next_close: nextClose };
}

// "Mon Oct 19" for a 'YYYY-MM-DD' (no zone shift: plain calendar math).
const MON3 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function fmtMonday(ymd) {
  if (!ymd || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(String(ymd))) return '';
  const [y, m, d] = String(ymd).split('-').map(Number);
  const wd = DAY_NAMES[new Date(Date.UTC(y, m - 1, d)).getUTCDay()].slice(0, 3);
  return `${wd} ${MON3[m - 1]} ${d}`;
}
