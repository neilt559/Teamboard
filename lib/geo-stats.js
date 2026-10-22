// GeoGuessr numbers for one office (Neil, 2026-10-22: "i want the high, i want the low, i want all time average, i want
// best week average, i want worst week average, i want ... number of bronzes, number of silvers, number of golds, number
// of diamonds for the days"). Pure functions over the geo_scores rows ({ id, score, score_date: 'YYYY-MM-DD' | null }),
// shared by the GeoGuessr page (app/(app)/culture/geoguessr/geo-ui.js) and the unit tests. Dates are calendar dates,
// so all date math is done in UTC on the 'YYYY-MM-DD' text and never shifts with the browser's time zone.
//   Work week = Monday to Friday: weekly averages leave weekend scores out and are keyed by the Monday of their week
//   (as before). Monthly averages and everything else count every score.

const DAY = 86400000;
const parseDay = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s ?? ''));
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(t) ? null : t;
};
const isoOf = (t) => new Date(t).toISOString().slice(0, 10);
const valueOf = (s) => {
  const v = Number(s?.score);
  return s?.score === null || s?.score === '' || Number.isNaN(v) ? null : v;
};

// The Monday of a weekday's work week ('YYYY-MM-DD'), or null for a weekend day or a missing/bad date.
export function workWeekOf(date) {
  const t = parseDay(date);
  if (t == null) return null;
  const dow = new Date(t).getUTCDay();
  if (dow === 0 || dow === 6) return null;
  return isoOf(t - (dow - 1) * DAY);
}

function averaged(groups, prefix) {
  return Object.keys(groups).sort().map((k) => {
    const arr = groups[k];
    const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
    return { id: prefix + k, score: Math.round(avg), avg, n: arr.length, score_date: k };
  });
}

// Work-week (Mon-Fri) averages, oldest first: { id: 'w<monday>', score (rounded), avg, n (scores), score_date: monday }.
export function weeklyAverages(scores) {
  const weeks = {};
  for (const s of scores || []) {
    const v = valueOf(s);
    const k = v == null ? null : workWeekOf(s.score_date);
    if (k) (weeks[k] = weeks[k] || []).push(v);
  }
  return averaged(weeks, 'w');
}

// Calendar-month averages, oldest first: { id: 'm<YYYY-MM>', score (rounded), avg, n, score_date: 'YYYY-MM' }.
export function monthlyAverages(scores) {
  const months = {};
  for (const s of scores || []) {
    const v = valueOf(s);
    if (v == null || parseDay(s.score_date) == null) continue;
    const k = String(s.score_date).slice(0, 7);
    (months[k] = months[k] || []).push(v);
  }
  return averaged(months, 'm');
}

// The tier a score falls in: the first of `tiers` (highest first, { min, label }) whose min it reaches.
export function tierOf(v, tiers) {
  for (const t of tiers) if (v >= t.min) return t.label;
  return tiers.length ? tiers[tiers.length - 1].label : '';
}

// The highest and lowest of a list of averages (a tie goes to the earliest, i.e. the first in the list).
function extremes(list) {
  let best = null;
  let worst = null;
  for (const x of list) {
    if (!best || x.avg > best.avg) best = x;
    if (!worst || x.avg < worst.avg) worst = x;
  }
  return [best, worst];
}

// Everything the stats show, or null when there is no score yet. `today` is the viewer's local date ('YYYY-MM-DD').
//   days                    how many scores
//   high, low               { score, date } (a tie goes to the earliest date)
//   today                   today's score { score, date } (the last one entered, if there are two) or null
//   mean                    all-time average
//   bestWeek, worstWeek     the work weeks with the highest and lowest average ({ score, week, n }); a tie goes
//                           to the earliest week
//   currentWeek             this work week's average ({ score, week, n }) or null
//   bestMonth, worstMonth,  the same for calendar months ({ score, month: 'YYYY-MM', n })
//   currentMonth
//   medals                  { <tier label>: number of daily scores in that tier } for every tier, zeros included
export function geoStats(scores, { tiers = [], today = '' } = {}) {
  const rows = (scores || []).map((s) => ({ v: valueOf(s), date: parseDay(s?.score_date) == null ? null : String(s.score_date) }))
    .filter((r) => r.v != null)
    .sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'));
  if (!rows.length) return null;
  let high = rows[0];
  let low = rows[0];
  for (const r of rows) {
    if (r.v > high.v) high = r;
    if (r.v < low.v) low = r;
  }
  const weeks = weeklyAverages(scores);
  const months = monthlyAverages(scores);
  const [bestW, worstW] = extremes(weeks);
  const [bestM, worstM] = extremes(months);
  const wk = (w) => (w ? { score: w.avg, week: w.score_date, n: w.n } : null);
  const mo = (m) => (m ? { score: m.avg, month: m.score_date, n: m.n } : null);
  const todays = rows.filter((r) => r.date && r.date === today);
  // this week = the Monday on or before today (on a weekend, the work week just finished)
  const t0 = parseDay(today);
  const thisWeek = t0 == null ? null : isoOf(t0 - ((new Date(t0).getUTCDay() + 6) % 7) * DAY);
  const medals = Object.fromEntries(tiers.map((t) => [t.label, 0]));
  for (const r of rows) {
    const label = tierOf(r.v, tiers);
    if (label in medals) medals[label] += 1;
  }
  return {
    days: rows.length,
    high: { score: high.v, date: high.date },
    low: { score: low.v, date: low.date },
    today: todays.length ? { score: todays[todays.length - 1].v, date: today } : null,
    mean: rows.reduce((a, r) => a + r.v, 0) / rows.length,
    bestWeek: wk(bestW),
    worstWeek: wk(worstW),
    currentWeek: wk(weeks.find((w) => w.score_date === thisWeek)),
    bestMonth: mo(bestM),
    worstMonth: mo(worstM),
    currentMonth: mo(months.find((m) => m.score_date === String(today).slice(0, 7))),
    medals,
  };
}

// ------------------------------------------------------------------------------------------------ labels

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOWS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// 'Tue, Oct 21, 2026' ('' for no date).
export function fmtGeoDay(date) {
  const t = parseDay(date);
  if (t == null) return '';
  const d = new Date(t);
  return `${DOWS[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}
// 'Oct 21' (short, for the stat tiles; the year only when it is not `year`).
export function fmtGeoShort(date, year = '') {
  const t = parseDay(date);
  if (t == null) return '';
  const d = new Date(t);
  const y = String(d.getUTCFullYear());
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}${year && y !== String(year) ? `, ${y}` : ''}`;
}
// 'Oct 21, 2026' (the chart's axis ends).
export function fmtGeoDate(date) {
  const t = parseDay(date);
  if (t == null) return '';
  const d = new Date(t);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}
// 'Oct 20 – 24, 2026' or 'Sep 29 – Oct 3, 2026' for the work week starting on `monday`.
export function fmtGeoWeek(monday) {
  const t = parseDay(monday);
  if (t == null) return '';
  const a = new Date(t);
  const b = new Date(t + 4 * DAY);
  const left = `${MONTHS[a.getUTCMonth()]} ${a.getUTCDate()}${a.getUTCFullYear() !== b.getUTCFullYear() ? `, ${a.getUTCFullYear()}` : ''}`;
  const right = a.getUTCMonth() === b.getUTCMonth() ? `${b.getUTCDate()}` : `${MONTHS[b.getUTCMonth()]} ${b.getUTCDate()}`;
  return `${left} – ${right}, ${b.getUTCFullYear()}`;
}
// 'Oct 2026' for 'YYYY-MM' (the stat tiles).
export function fmtGeoMonthShort(ym) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(ym ?? ''));
  return m ? `${MONTHS[Number(m[2]) - 1]} ${m[1]}` : '';
}
// 'October 2026' for 'YYYY-MM'.
export function fmtGeoMonth(ym) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(ym ?? ''));
  return m ? `${MONTHS_LONG[Number(m[2]) - 1]} ${m[1]}` : '';
}
