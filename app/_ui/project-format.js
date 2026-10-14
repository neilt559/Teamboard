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

// ---- the owner report's ONE date style (design-amendments A11): "Oct 22", "Tue Oct 20"; no commas, no zero
// padding. The year is added only when it differs from the report's (ref) year: "Dec 3, 2025". Numeric only in the
// title block's Issued cell: "10/14/2026".
const parts = (ymd) => {
  const m = YMD.exec(String(ymd ?? ''));
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(d.getTime()) ? null : { d, y: Number(m[1]), mo: Number(m[2]), day: Number(m[3]) };
};
const yearOf = (ymd) => parts(ymd)?.y;
const MON = (d) => fmt({ month: 'short' }).format(d);
const WDAY = (d) => fmt({ weekday: 'short' }).format(d);

// 'YYYY-MM-DD' -> 'Oct 22' ('Oct 22, 2025' when ref is in another year). '' / unreadable -> ''.
export function fmtShort(ymd, ref = '') {
  const p = parts(ymd);
  if (!p) return '';
  const y = ref && yearOf(ref) !== p.y ? `, ${p.y}` : '';
  return `${MON(p.d)} ${p.day}${y}`;
}
// 'YYYY-MM-DD' -> 'Tue Oct 20' (with the year when ref is in another year).
export function fmtDay(ymd, ref = '') {
  const p = parts(ymd);
  if (!p) return '';
  return `${WDAY(p.d)} ${fmtShort(ymd, ref)}`;
}
// 'YYYY-MM-DD' -> 'Wed Oct 14, 2026' (the report's date line).
export function fmtDayYear(ymd) {
  const p = parts(ymd);
  return p ? `${WDAY(p.d)} ${MON(p.d)} ${p.day}, ${p.y}` : '';
}
// 'YYYY-MM-DD' -> '10/14/2026' (the title block's Issued cell only).
export function fmtIssued(ymd) {
  const p = parts(ymd);
  return p ? `${p.mo}/${p.day}/${p.y}` : '';
}
// 'YYYY-MM-DD' -> 'October 12' ("Week of October 12").
export function fmtMonthDay(ymd) {
  const p = parts(ymd);
  return p ? `${fmt({ month: 'long' }).format(p.d)} ${p.day}` : '';
}
