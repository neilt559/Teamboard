// Time-zone helpers (design §10(c)). Isomorphic, Intl only: Node on Vercel has full ICU.
// Date-only values are always 'YYYY-MM-DD' strings, never Date objects or DATE columns.
// Brackets, challenges and "today" all run on America/Chicago; offices carry their own zone.

export const TZ = 'America/Chicago';

const partsFmts = new Map();
const ymdFmts = new Map();

// Local wall clock minus UTC, in minutes, for the instant ms in zone tz.
function offsetMin(ms, tz = TZ) {
  if (!partsFmts.has(tz)) partsFmts.set(tz, new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric',
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }));
  const p = Object.fromEntries(partsFmts.get(tz).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  // % 24: some ICU builds print midnight as hour 24 even with h23.
  return Math.round((Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - ms) / 60000);
}

// The UTC instant (epoch ms) of wall time ymd hhmm in tz. Two passes, so the offset is the one in force at
// that wall time; US midnights are never inside a DST gap.
export function zonedToUtc(ymd, hhmm = '00:00', tz = TZ) {
  const [y, m, d] = ymd.split('-').map(Number);
  const [hh, mi] = hhmm.split(':').map(Number);
  const wall = Date.UTC(y, m - 1, d, hh, mi);
  const t0 = wall - offsetMin(wall, tz) * 60000;
  return wall - offsetMin(t0, tz) * 60000;
}

export const chicagoMidnightUtc = (ymd) => zonedToUtc(ymd, '00:00', TZ);

// 'YYYY-MM-DD' of the instant ms in tz (en-CA formats as ISO dates).
export function localYmd(ms, tz = TZ) {
  if (!ymdFmts.has(tz)) ymdFmts.set(tz, new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }));
  return ymdFmts.get(tz).format(new Date(ms));
}
export const chicagoToday = (ms) => localYmd(ms, TZ);

// Plain calendar math on 'YYYY-MM-DD' strings, done in UTC so a DST change never shifts a day.
export function addDays(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
export function daysBetween(a, b) {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
}
// 0 = Sunday ... 6 = Saturday, for a 'YYYY-MM-DD' string.
export const weekdayOf = (ymd) => new Date(ymd + 'T00:00:00Z').getUTCDay();

// The Monday after today in Central (a Monday gives the following Monday).
export function nextMondayCT(ms) {
  const t = chicagoToday(ms);
  return addDays(t, ((8 - weekdayOf(t)) % 7) || 7);
}
