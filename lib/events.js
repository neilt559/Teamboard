import { addDays, daysBetween, weekdayOf, zonedToUtc } from './time.js';

// Culture events calendar: rules and formatting (design §10(b); agent K2). Isomorphic: the API routes, the loaders
// and the client components all use these. The only import is lib/time.js (import-free). Dates are 'YYYY-MM-DD'
// strings compared as text, times 'HH:MM' (24 h) in the event's own zone (tz); "today" is America/Chicago on the
// server, handed to the client as a prop. Every display string the page needs is built on the server with these
// (same code, same zone table), so a server render and a browser render never disagree.
//
// An event e: { id, title, office_id (null = company-wide), all_day, starts_on, ends_on, start_time, end_time, tz,
// starts_at, ends_at (ISO or epoch ms; timed events only), cancelled, archived }.

export const LIMITS = { title: 200, details: 20000, location: 300, link_url: 2000 };
export const MAX_SPAN_DAYS = 62;               // an event covers at most two months of days
export const DEFAULT_TZ = 'America/Chicago';

// The zones an organizer can enter times in (every office's zone is one of these; an office whose zone isn't is
// added at read time by the form). Short labels are fixed here rather than read from ICU, so they never differ
// between Node and a browser.
export const ZONES = [
  { tz: 'America/New_York', abbr: 'ET', label: 'Eastern (ET)' },
  { tz: 'America/Chicago', abbr: 'CT', label: 'Central (CT)' },
  { tz: 'America/Denver', abbr: 'MT', label: 'Mountain (MT)' },
  { tz: 'America/Phoenix', abbr: 'MST', label: 'Arizona (MST)' },
  { tz: 'America/Los_Angeles', abbr: 'PT', label: 'Pacific (PT)' },
];
export const ZONE_KEYS = ZONES.map((z) => z.tz);
export const isZone = (tz) => typeof tz === 'string' && ZONE_KEYS.includes(tz);

const abbrCache = new Map();
// "ET", "CT", "MT", "MST" (Arizona), "PT"; any other zone: Intl's short generic name, else the zone id.
export function tzAbbr(tz) {
  const z = ZONES.find((x) => x.tz === tz);
  if (z) return z.abbr;
  if (!tz) return '';
  if (abbrCache.has(tz)) return abbrCache.get(tz);
  let out = tz;
  try {
    const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'shortGeneric' }).formatToParts(new Date(0));
    out = p.find((x) => x.type === 'timeZoneName')?.value || tz;
  } catch { /* unknown zone: the id itself */ }
  abbrCache.set(tz, out);
  return out;
}

// 'HH:MM' (24 h) for '9:05', '09:05' or '09:05:00' (what <input type="time"> sends), else null.
export function parseTime(v) {
  if (typeof v !== 'string') return null;
  const m = /^([0-9]{1,2}):([0-9]{2})(:[0-9]{2})?$/.exec(v.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return `${String(h).padStart(2, '0')}:${m[2]}`;
}

// 'YYYY-MM-DD' for a real calendar date between 2000 and 2099, else null.
export function parseYmd(v) {
  if (typeof v !== 'string' || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(v)) return null;
  const [y, m, d] = v.split('-').map(Number);
  if (y < 2000 || y > 2099) return null;
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? v : null;
}

// A link as typed: '' stays ''; 'example.com/x' becomes 'https://example.com/x'; only http(s) URLs are kept.
// Returns the normalized URL, '' for blank, or null when it isn't a usable web link (the caller answers 400).
export function normalizeLink(v) {
  if (v == null) return '';
  if (typeof v !== 'string') return null;
  let s = v.trim();
  if (!s) return '';
  if (s.length > LIMITS.link_url || /[\s<>"]/.test(s)) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = `https://${s.replace(/^\/+/, '')}`;
  let u;
  try { u = new URL(s); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (!u.hostname || !u.hostname.includes('.')) return null;
  return s.length > LIMITS.link_url ? null : s;
}

// The UTC instants of a timed event (epoch ms): starts_at from starts_on + start_time, ends_at from ends_on + end_time
// (null without an end time). All-day events have none.
export function eventInstants(e) {
  if (e.all_day || !e.start_time) return { starts_at: null, ends_at: null };
  const tz = e.tz || DEFAULT_TZ;
  return {
    starts_at: zonedToUtc(e.starts_on, e.start_time, tz),
    ends_at: e.end_time ? zonedToUtc(e.ends_on, e.end_time, tz) : null,
  };
}

// Checks a complete schedule { all_day, starts_on, ends_on, start_time, end_time, tz }; returns the first problem as
// { field, message } or null. The API answers 400 with the message; the form shows it under the field.
export function scheduleProblem(s) {
  if (!parseYmd(s.starts_on)) return { field: 'starts_on', message: 'Pick the start date.' };
  if (!parseYmd(s.ends_on)) return { field: 'ends_on', message: 'Pick the end date.' };
  if (s.ends_on < s.starts_on) return { field: 'ends_on', message: 'The end date can’t be before the start date.' };
  if (daysBetween(s.starts_on, s.ends_on) + 1 > MAX_SPAN_DAYS) return { field: 'ends_on', message: `An event can last ${MAX_SPAN_DAYS} days at most.` };
  if (s.all_day) return null;
  if (!isZone(s.tz)) return { field: 'tz', message: 'Pick a time zone.' };
  if (!parseTime(s.start_time)) return { field: 'start_time', message: 'Pick the start time.' };
  if (s.end_time != null && s.end_time !== '' && !parseTime(s.end_time)) return { field: 'end_time', message: 'Pick a valid end time.' };
  if (s.end_time && s.starts_on === s.ends_on && parseTime(s.end_time) <= parseTime(s.start_time)) {
    return { field: 'end_time', message: 'The end time must be after the start time.' };
  }
  return null;
}

// ---------------------------------------------------------------- formatting

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October',
  'November', 'December'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const WEEKDAY_NAMES = WEEKDAYS;
const parts = (ymd) => { const [y, m, d] = String(ymd).split('-').map(Number); return { y, m, d }; };

// "Oct 14" / "Wed, Oct 14" / "Oct 14, 2026"
export function fmtDate(ymd, { weekday = false, year = false } = {}) {
  if (!ymd) return '';
  const { y, m, d } = parts(ymd);
  if (!y || !m || !d) return String(ymd);
  return `${weekday ? `${WEEKDAYS[weekdayOf(ymd)]}, ` : ''}${MONTHS[m - 1]} ${d}${year ? `, ${y}` : ''}`;
}
export const monthShort = (ymd) => MONTHS[parts(ymd).m - 1] || '';
export const dayNum = (ymd) => parts(ymd).d;

// '16:00' -> '4:00 PM'
export function fmtTime(hhmm) {
  const t = parseTime(hhmm);
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}
// '4:00–6:00 PM', '11:00 AM–1:00 PM', '4:00 PM' (no end)
export function fmtTimeRange(a, b) {
  const x = fmtTime(a);
  if (!b) return x;
  const y = fmtTime(b);
  if (!x || !y) return x || y;
  return x.slice(-2) === y.slice(-2) ? `${x.slice(0, -3)}–${y}` : `${x}–${y}`;
}
// Chip label: '4 PM', '4:30 PM'
export function fmtTimeShort(hhmm) {
  const t = fmtTime(hhmm);
  return t.replace(':00 ', ' ');
}

const wallFmts = new Map();
// The wall clock in tz at instant ms: { ymd: 'YYYY-MM-DD', hhmm: 'HH:MM' }.
export function wallIn(ms, tz) {
  if (!wallFmts.has(tz)) {
    wallFmts.set(tz, new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit',
      day: '2-digit', hour: '2-digit', minute: '2-digit' }));
  }
  const p = Object.fromEntries(wallFmts.get(tz).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { ymd: `${p.year}-${p.month}-${p.day}`, hhmm: `${String(Number(p.hour) % 24).padStart(2, '0')}:${p.minute}` };
}

// "Oct 22 – 24, 2026", "Oct 30 – Nov 2, 2026", "Dec 30, 2026 – Jan 2, 2027"
export function fmtDateRange(a, b, { weekday = false } = {}) {
  if (!b || a === b) return fmtDate(a, { weekday, year: true });
  const p = parts(a);
  const q = parts(b);
  if (p.y !== q.y) return `${fmtDate(a, { weekday, year: true })} – ${fmtDate(b, { weekday, year: true })}`;
  if (p.m === q.m && !weekday) return `${MONTHS[p.m - 1]} ${p.d} – ${q.d}, ${p.y}`;
  return `${fmtDate(a, { weekday })} – ${fmtDate(b, { weekday })}, ${p.y}`;
}

const toMs = (v) => (v == null ? null : typeof v === 'number' ? v : Date.parse(v));

// When an event happens, for display. viewerTz: the viewer's office zone; a timed event in another zone also gets
// the viewer's own time ("alt").
//   { date: 'Thu, Oct 22' | 'Oct 22 – 24, 2026', time: '4:00–6:00 PM ET' | 'All day', alt: '3:00–5:00 PM CT' | null,
//     line: 'Thu, Oct 22 · 4:00–6:00 PM ET (3:00–5:00 PM CT)' }
export function eventWhen(e, viewerTz = DEFAULT_TZ) {
  const multi = e.ends_on && e.ends_on !== e.starts_on;
  if (e.all_day || !e.start_time) {
    const date = multi ? fmtDateRange(e.starts_on, e.ends_on, { weekday: true }) : fmtDate(e.starts_on, { weekday: true });
    return { date, time: 'All day', alt: null, line: multi ? date : `${date} · All day` };
  }
  const tz = e.tz || DEFAULT_TZ;
  const ab = tzAbbr(tz);
  let date;
  let time;
  if (multi) {
    date = fmtDateRange(e.starts_on, e.ends_on, { weekday: true });
    time = `${fmtDate(e.starts_on, { weekday: true })} ${fmtTime(e.start_time)}${e.end_time ? ` – ${fmtDate(e.ends_on, { weekday: true })} ${fmtTime(e.end_time)}` : ''} ${ab}`;
  } else {
    date = fmtDate(e.starts_on, { weekday: true });
    time = `${fmtTimeRange(e.start_time, e.end_time)} ${ab}`;
  }
  let alt = null;
  const vtz = viewerTz || DEFAULT_TZ;
  if (vtz !== tz && tzAbbr(vtz) !== ab) {
    const inst = e.starts_at != null ? { starts_at: toMs(e.starts_at), ends_at: toMs(e.ends_at) } : eventInstants(e);
    if (inst.starts_at != null && Number.isFinite(inst.starts_at)) {
      const s = wallIn(inst.starts_at, vtz);
      const en = inst.ends_at != null && Number.isFinite(inst.ends_at) ? wallIn(inst.ends_at, vtz) : null;
      const sameStartDay = s.ymd === e.starts_on;
      if (en && s.ymd === en.ymd && !multi) {
        alt = `${sameStartDay ? '' : `${fmtDate(s.ymd, { weekday: true })} `}${fmtTimeRange(s.hhmm, en.hhmm)} ${tzAbbr(vtz)}`;
      } else if (en) {
        alt = `${fmtDate(s.ymd, { weekday: true })} ${fmtTime(s.hhmm)} – ${fmtDate(en.ymd, { weekday: true })} ${fmtTime(en.hhmm)} ${tzAbbr(vtz)}`;
      } else {
        alt = `${sameStartDay && !multi ? '' : `${fmtDate(s.ymd, { weekday: true })} `}${fmtTime(s.hhmm)} ${tzAbbr(vtz)}`;
      }
    }
  }
  const line = multi ? `${time}${alt ? ` (${alt})` : ''}` : `${date} · ${time}${alt ? ` (${alt})` : ''}`;
  return { date, time, alt, line };
}

// 'archived' | 'cancelled' | 'past' | 'now' | 'upcoming' for a day (Central today) and, for timed events, the instant.
export function eventStatus(e, today, nowMs = null) {
  if (e.archived) return 'archived';
  if (e.cancelled) return 'cancelled';
  if (e.ends_on < today) return 'past';
  if (e.starts_on > today) return 'upcoming';
  if (!e.all_day && nowMs != null) {
    const end = toMs(e.ends_at);
    if (end != null && Number.isFinite(end) && end < nowMs) return 'past';
  }
  return 'now';
}

// ---------------------------------------------------------------- the month grid

// 'YYYY-MM' (2000..2099) or null.
export function parseMonth(v) {
  if (typeof v !== 'string' || !/^[0-9]{4}-[0-9]{2}$/.test(v)) return null;
  const [y, m] = v.split('-').map(Number);
  return y >= 2000 && y <= 2099 && m >= 1 && m <= 12 ? v : null;
}
export const monthOf = (ymd) => String(ymd).slice(0, 7);
export function shiftMonth(m, n) {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(Date.UTC(y, mo - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}
export function fmtMonth(m) {
  const [y, mo] = m.split('-').map(Number);
  return `${MONTHS_LONG[mo - 1]} ${y}`;
}

// The weeks shown for month m (Sunday first): { month, first, last, from, to, weeks: [[ymd x 7], ...] }.
export function monthGrid(m) {
  const first = `${m}-01`;
  const [y, mo] = m.split('-').map(Number);
  const last = new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10);
  const from = addDays(first, -weekdayOf(first));
  const to = addDays(last, 6 - weekdayOf(last));
  const weeks = [];
  for (let d = from; d <= to; d = addDays(d, 7)) weeks.push(Array.from({ length: 7 }, (_, i) => addDays(d, i)));
  return { month: m, first, last, from, to, weeks };
}

// One week of the month grid laid out in lanes (rows), the way a wall calendar draws it: every item spanning
// several days keeps ONE lane for the whole week, so its bar never jumps rows mid-week; single-day items then fill
// each day's lowest free lanes (all-day ones first, then timed ones by start time). An empty lane under a bar on
// another day becomes a spacer, so the rows line up.
//   items: [{ key, kind, starts_on, ends_on, all_day, start_time, title }]; days: the week's 7 'YYYY-MM-DD' strings.
// -> one entry per day: { day, slots: [item | null] (the rows to draw), hidden: number (behind "+N more"),
//    all: [item] (every item that day, in lane order, for the popover) }. A day needing more than maxRows rows draws
//    maxRows - 1 of them and "+N more".
const KIND_ORDER = { bracket: 0, challenge: 1, event: 2 };
const timeKey = (it) => (it.all_day || !it.start_time ? '' : it.start_time);
function bySingle(a, b) {
  const ta = timeKey(a);
  const tb = timeKey(b);
  if (ta !== tb) return ta < tb ? -1 : 1;
  if (a.kind !== b.kind) return KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
  const c = String(a.title).localeCompare(String(b.title));
  return c || (String(a.key) < String(b.key) ? -1 : String(a.key) > String(b.key) ? 1 : 0);
}
export function layoutWeek(items, days, maxRows = 3) {
  const first = days[0];
  const last = days[days.length - 1];
  const n = days.length;
  const at = (d) => (d < first ? 0 : d > last ? n - 1 : days.indexOf(d));
  const inWeek = items.filter((it) => it.starts_on <= last && it.ends_on >= first);
  const multi = inWeek.filter((it) => it.ends_on !== it.starts_on).sort((a, b) => {
    if (a.starts_on !== b.starts_on) return a.starts_on < b.starts_on ? -1 : 1;
    const la = daysBetween(a.starts_on, a.ends_on);
    const lb = daysBetween(b.starts_on, b.ends_on);
    if (la !== lb) return lb - la;                                  // longer first
    if (a.kind !== b.kind) return KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
    return String(a.key) < String(b.key) ? -1 : String(a.key) > String(b.key) ? 1 : 0;
  });
  const lanes = [];                                                 // lanes[l][dayIndex] = item | null
  const freeLane = (a, b) => {
    for (let l = 0; ; l++) {
      if (!lanes[l]) lanes[l] = Array(n).fill(null);
      let ok = true;
      for (let i = a; i <= b && ok; i++) if (lanes[l][i]) ok = false;
      if (ok) return l;
    }
  };
  for (const it of multi) {
    const a = at(it.starts_on);
    const b = at(it.ends_on);
    const l = freeLane(a, b);
    for (let i = a; i <= b; i++) lanes[l][i] = it;
  }
  const singles = inWeek.filter((it) => it.ends_on === it.starts_on).sort(bySingle);
  for (const it of singles) {
    const i = at(it.starts_on);
    const l = freeLane(i, i);
    lanes[l][i] = it;
  }
  return days.map((day, i) => {
    let slots = lanes.map((lane) => lane[i]);
    while (slots.length && !slots[slots.length - 1]) slots.pop();
    const all = slots.filter(Boolean);
    let hidden = 0;
    if (slots.length > maxRows) {
      const shown = slots.slice(0, Math.max(0, maxRows - 1));
      hidden = all.length - shown.filter(Boolean).length;
      slots = shown;
    }
    return { day, slots, hidden, all };
  });
}

export const canManageEvents = (v) => !!(v?.is_admin || v?.is_organizer);
