// Chili cook-off rules (Neil, 2026-10-20): a monthly challenge where one person brings chili each week and everyone
// rates it 1 to 10, blind. Nobody (admins included) sees anyone else's rating, any average, or who cooked which
// chili until the reveal; then each chili's average rating and count, its cook, and the winner (the best average)
// show. Individual ratings never show. Isomorphic and import-free: the API, the loaders and the client use it.
// Dates are 'YYYY-MM-DD' (Central). A chili's week_of is that week's Monday; rating opens that Monday.

export const SCORE_MIN = 1;
export const SCORE_MAX = 10;
export const COOK_NAME_MAX = 80;
export const MAX_CHILIS = 20;

export const DEFAULT_RULES = [
  '%h How it works',
  '- One chili each week. Taste it, then rate it from 1 to 10 here.',
  '- Ratings are blind and secret: nobody sees anyone’s scores, or whose chili is whose, until the end.',
  '- You can change your rating until the results are revealed. Cooks can’t rate their own chili.',
  '- After the last chili, the best average rating wins.',
].join('\n');

const utc = (ymd) => { const [y, m, d] = String(ymd).split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const ymdOf = (t) => t.toISOString().slice(0, 10);
const plusDays = (ymd, n) => { const t = utc(ymd); t.setUTCDate(t.getUTCDate() + n); return ymdOf(t); };
export const isYmd = (v) => typeof v === 'string' && /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(v) && ymdOf(utc(v)) === v;

// The Monday of the week a date falls in.
export function mondayOf(ymd) {
  const dow = utc(ymd).getUTCDay();          // 0 Sunday .. 6 Saturday
  return plusDays(ymd, dow === 0 ? -6 : 1 - dow);
}

// Default challenge dates for a schedule: the first chili's Monday through the last chili's Friday (the results
// reveal the next day).
export function datesFor(weeks) {
  const w = [...weeks].filter(isYmd).map(mondayOf).sort();
  if (!w.length) return null;
  return { starts_on: w[0], ends_on: plusDays(w[w.length - 1], 4) };
}

// Revealed: an organizer revealed early, or the challenge's last day (Central) has passed.
export const isRevealed = (c, today) => !!c && (!!c.revealed_at || today > c.ends_on);

// A chili can be rated from its week's Monday until the reveal (and never in an archived challenge).
export const chiliOpen = (c, chili, today) => !!c && !c.archived && !isRevealed(c, today) && today >= chili.week_of;

// A score as typed: a whole number 1..10, else null.
export function parseScore(raw) {
  const n = typeof raw === 'number' ? raw : /^[0-9]{1,2}$/.test(String(raw ?? '').trim()) ? Number(String(raw).trim()) : NaN;
  return Number.isInteger(n) && n >= SCORE_MIN && n <= SCORE_MAX ? n : null;
}

// After the reveal: chilis with their averages, best first (ties share a place; more ratings first among equals,
// then the earlier week). Chilis nobody rated come last, unranked.
//   chilis: [{ id, week_of, average (number|null), count }] -> same with rank (null when unrated)
export function rankChilis(chilis) {
  const rated = chilis.filter((x) => x.count > 0 && x.average != null)
    .sort((a, b) => b.average - a.average || b.count - a.count || (a.week_of < b.week_of ? -1 : 1));
  let rank = 0;
  let prev = null;
  const out = rated.map((x, i) => {
    if (i === 0 || x.average !== prev) rank = i + 1;
    prev = x.average;
    return { ...x, rank };
  });
  return [...out, ...chilis.filter((x) => !(x.count > 0 && x.average != null)).map((x) => ({ ...x, rank: null }))];
}

// 8.4 / 8 -> "8.4" / "8.0"
export const fmtAvg = (n) => (n == null ? '–' : Number(n).toFixed(1));
