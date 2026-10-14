// Display helpers for the A6 project sections and the weekly reports (design-amendments A6.5-A6.7). A plain
// module (no 'use client', no hooks, no imports), so the report pages (Server Components), the project board and
// the Copy-for-email builder all format dates and times exactly the same way. Date-only values are always
// 'YYYY-MM-DD' strings; they are formatted in UTC, so the server's and the browser's time zones never shift a day.

const YMD = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/;
const fmts = new Map();
function fmt(opts) {
  const k = JSON.stringify(opts);
  if (!fmts.has(k)) fmts.set(k, new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...opts }));
  return fmts.get(k);
}

// 'YYYY-MM-DD' -> 'Oct 14, 2026' ({ weekday: true } -> 'Wed, Oct 14, 2026'; { long: true } -> 'October 14, 2026').
// '' / null -> ''. Anything unreadable comes back as it is.
export function fmtYmd(ymd, { weekday = false, long = false } = {}) {
  if (ymd == null || ymd === '') return '';
  const m = YMD.exec(String(ymd));
  if (!m) return String(ymd);
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (Number.isNaN(d.getTime())) return String(ymd);
  return fmt({ ...(weekday ? { weekday: 'short' } : {}), month: long ? 'long' : 'short', day: 'numeric', year: 'numeric' }).format(d);
}

// 'HH:MM' (24 h) -> '2:30 PM'; '' / null -> ''.
export function fmtHhmm(hhmm) {
  const m = /^([0-9]{2}):([0-9]{2})$/.exec(String(hhmm ?? ''));
  if (!m) return '';
  const h = Number(m[1]);
  return `${((h + 11) % 12) + 1}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`;
}

// A submittal date entry from lib/projects.js submittalDates() as text: review_days -> '30 days'; dates formatted.
export function fmtSubmittalValue(d) {
  if (!d || d.value === '' || d.value == null) return '';
  if (d.key === 'review_days') {
    const n = Number(d.value);
    return `${n} ${n === 1 ? 'day' : 'days'}`;
  }
  return fmtYmd(String(d.value));
}

// Its label in a report: the value already says "days", so the review period drops the "(days)".
export const submittalLabel = (d) => (d?.key === 'review_days' ? 'Review period' : d?.label || '');
