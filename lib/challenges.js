import { addDays, daysBetween } from './time.js';

// Monthly challenge rules and formatting (design §10(a), §4.5; agent K1). Isomorphic: the API routes, the loaders
// and the client components all use these, so the UI shows exactly the controls the server allows. The only
// import is lib/time.js (import-free). Dates are 'YYYY-MM-DD' strings compared as text; "today" is always
// America/Chicago (chicagoToday) on the server, handed to the client as a prop.
//
// A challenge c: { id, office_id (null = company-wide), starts_on, ends_on, aggregation, higher_is_better,
// group_rank, archived }. A viewer v: lib/viewer.js publicViewer (office_ids, is_admin, is_organizer).

export const AGGREGATIONS = {
  sum: { label: 'Total of all entries', short: 'Total' },
  max: { label: 'Best single entry', short: 'Best' },
  count: { label: 'Number of entries', short: 'Entries' },
};
export const AGGREGATION_KEYS = Object.keys(AGGREGATIONS);
export const GROUP_RANKS = {
  avg: { label: 'Average per participant', short: 'Average', hint: 'Fair across office sizes' },
  sum: { label: 'Total of everyone', short: 'Total', hint: 'Bigger groups have an edge' },
};
export const GROUP_RANK_KEYS = Object.keys(GROUP_RANKS);

export const MAX_VALUE = 1_000_000;
export const MAX_ENTRIES_PER_DAY = 20;     // per person, per challenge, per entry date
export const ENTRY_GRACE_DAYS = 3;         // owners change their entries until ends_on + 3 days
export const MAX_RANGE_DAYS = 366;
export const LIMITS = { title: 200, description: 20000, metric_label: 60, unit: 20, note: 500 };

const isOrg = (v) => !!(v?.is_admin || v?.is_organizer);
const inOffices = (v, officeId) => officeId != null && (v?.office_ids || []).map(String).includes(String(officeId));

// The last day (Central) an owner can log, change or delete entries.
export const entriesCloseOn = (c) => addDays(c.ends_on, ENTRY_GRACE_DAYS);

// 'archived' | 'upcoming' | 'running' | 'ended'
export function challengeStatus(c, today) {
  if (c.archived) return 'archived';
  if (today < c.starts_on) return 'upcoming';
  if (today > c.ends_on) return 'ended';
  return 'running';
}

// Who takes part: everyone for a company challenge, that office's people (home or extra office) for an office one.
export const isParticipant = (v, c) => !!v && (c.office_id == null || inOffices(v, c.office_id));

// The entry dates a person may pick right now: inside the challenge and no later than tomorrow (Central), so a
// viewer whose local date is already tomorrow can still log "today". null = nothing can be logged now.
export function entryDateBounds(c, today) {
  const max = c.ends_on < addDays(today, 1) ? c.ends_on : addDays(today, 1);
  return max < c.starts_on ? null : { min: c.starts_on, max };
}

// Logging new stats: participants, while the challenge has started (or starts tomorrow) and until the entry
// window closes (ends_on + 3 days); organizers log their own stats any time.
export function canLogStats(v, c, today) {
  if (!v || c.archived || !isParticipant(v, c) || !entryDateBounds(c, today)) return false;
  return isOrg(v) || today <= entriesCloseOn(c);
}

// Editing or deleting an entry: its owner until the window closes; organizers (and admins) any time.
export function canChangeEntry(v, entry, c, today) {
  if (!v || !entry) return false;
  if (isOrg(v)) return true;
  return String(entry.user_id) === String(v.id) && !c.archived && today <= entriesCloseOn(c);
}

export const canManageChallenges = isOrg;

// A stat value as typed: a number or numeric text, 0..1,000,000, at most 2 decimals. Returns the number, or null
// when it isn't valid (the caller answers 400).
export function parseValue(raw) {
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || raw < 0 || raw > MAX_VALUE) return null;
    return Math.abs(raw * 100 - Math.round(raw * 100)) < 1e-6 ? Math.round(raw * 100) / 100 : null;
  }
  if (typeof raw !== 'string') return null;
  const s = raw.trim().replace(/,/g, '');
  if (!/^[0-9]{1,7}([.][0-9]{0,2})?$/.test(s) && !/^[.][0-9]{1,2}$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 && n <= MAX_VALUE ? n : null;
}

// One person's score from their counted entries' values (entries inside the challenge dates, not deleted):
// sum = total, max = best single entry (the lowest when lower is better), count = number of entries.
export function aggregate(c, values) {
  const nums = values.map(Number).filter((n) => Number.isFinite(n));
  if (!nums.length) return null;
  if (c.aggregation === 'count') return nums.length;
  if (c.aggregation === 'max') return c.higher_is_better === false ? Math.min(...nums) : Math.max(...nums);
  return Math.round(nums.reduce((a, b) => a + b, 0) * 100) / 100;
}

// Board order: score in the challenge's direction, then who got there first (tie key), then name. Ranks are
// dense (equal scores share a rank; the next score gets the next number). rows: [{ score, ...tie }].
export function rankRows(rows, higherIsBetter = true, { score = 'score', tie = null, name = 'name' } = {}) {
  const dir = higherIsBetter === false ? 1 : -1;
  const sorted = [...rows].sort((a, b) => {
    const d = (Number(a[score]) - Number(b[score])) * dir;
    if (d) return d;
    if (tie && a[tie] !== b[tie]) return String(a[tie] ?? '') < String(b[tie] ?? '') ? -1 : 1;
    return String(a[name] ?? '').localeCompare(String(b[name] ?? ''), undefined, { sensitivity: 'base' });
  });
  let rank = 0;
  let prev;
  return sorted.map((r, i) => {
    const s = Number(r[score]);
    if (i === 0 || s !== prev) rank += 1;
    prev = s;
    return { ...r, rank };
  });
}

// 1234.5 -> "1,234.5"; never more than 2 decimals.
export const fmtNumber = (n) => (n == null || !Number.isFinite(Number(n)) ? '' : Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 }));

// A score with its unit: "42.5 mi", "3 entries" (count challenges without a unit), "12 workouts".
export function fmtScore(c, n) {
  if (n == null || !Number.isFinite(Number(n))) return '';
  const num = fmtNumber(n);
  if (c.unit) return `${num} ${c.unit}`;
  if (c.aggregation === 'count') return `${num} ${Number(n) === 1 ? 'entry' : 'entries'}`;
  return num;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const parts = (ymd) => { const [y, m, d] = String(ymd).split('-').map(Number); return { y, m, d }; };

// "Oct 14" / "Tue, Oct 14" / "Oct 14, 2026"
export function fmtDay(ymd, { weekday = false, year = false } = {}) {
  if (!ymd) return '';
  const { y, m, d } = parts(ymd);
  if (!y || !m || !d) return String(ymd);
  const wd = weekday ? `${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}, ` : '';
  return `${wd}${MONTHS[m - 1]} ${d}${year ? `, ${y}` : ''}`;
}

// "Oct 1 – 31, 2026", "Oct 25 – Nov 3, 2026", "Dec 28, 2026 – Jan 3, 2027"
export function fmtRange(a, b) {
  const p = parts(a);
  const q = parts(b);
  if (a === b) return fmtDay(a, { year: true });
  if (p.y !== q.y) return `${fmtDay(a, { year: true })} – ${fmtDay(b, { year: true })}`;
  if (p.m === q.m) return `${MONTHS[p.m - 1]} ${p.d} – ${q.d}, ${p.y}`;
  return `${fmtDay(a)} – ${fmtDay(b)}, ${p.y}`;
}

// The calendar month around today: { starts_on: 'YYYY-MM-01', ends_on: last day }.
export function monthRange(today) {
  const { y, m } = parts(today);
  const first = `${y}-${String(m).padStart(2, '0')}-01`;
  const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return { starts_on: first, ends_on: last };
}

// "Ends today", "3 days left", "Starts Nov 1", "Ended Oct 31"
export function timeLabel(c, today) {
  const st = challengeStatus(c, today);
  if (st === 'upcoming') return `Starts ${fmtDay(c.starts_on)}`;
  if (st === 'ended' || st === 'archived') return `Ended ${fmtDay(c.ends_on)}`;
  const left = daysBetween(today, c.ends_on);
  if (left === 0) return 'Last day';
  return `${left + 1} days left`;
}

// "Miles (total)", "Workouts (number of entries)", "5K time (best single entry, lowest wins)"
export function metricLine(c) {
  if (c.kind === 'bingo') return 'CAGEO';
  const how = c.aggregation === 'sum' ? 'total' : c.aggregation === 'max' ? 'best single entry' : 'number of entries';
  return `${c.metric_label || 'Points'} (${how}${c.higher_is_better === false ? ', lowest wins' : ''})`;
}
