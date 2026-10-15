// Small display helpers shared by the bracket pages and the /admin Brackets section. Plain module (no hooks),
// so server and client components can both import it.

// Region names from the stored JSON text (or an array), falling back to "Quadrant N".
export function parseRegions(s) {
  let r = [];
  try { r = typeof s === 'string' ? JSON.parse(s || '[]') : (s || []); } catch {}
  return [0, 1, 2, 3].map((q) => (Array.isArray(r) && r[q]) || `Quadrant ${q + 1}`);
}

// "Oct 9, 2026" ('' when missing), as the old Past brackets list showed dates. In an explicit zone (viewer.tz;
// Central when not given) so the server render (UTC on Vercel) and the browser print the same day.
export function fmtDay(v, tz) {
  if (!v) return '';
  const d = new Date(v);
  return isNaN(d) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: tz || 'America/Chicago' });
}

// ---------------------------------------------------------------- weekly auto brackets (Release 3)

const CT = 'America/Chicago';
const tzParts = (ms, tz, opts) => {
  try {
    return Object.fromEntries(new Intl.DateTimeFormat('en-US', { ...opts, timeZone: tz }).formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  } catch { return null; }
};
const hm = (ms, tz) => {
  const p = tzParts(ms, tz, { hour: 'numeric', minute: '2-digit', hour12: true });
  return p ? `${p.hour}:${p.minute} ${p.dayPeriod || ''}`.trim() : '';
};
const ZONE_ABBR = { 'America/New_York': 'ET', 'America/Chicago': 'CT', 'America/Denver': 'MT', 'America/Phoenix': 'MST', 'America/Los_Angeles': 'PT' };
const abbr = (tz) => ZONE_ABBR[tz] || tz;

// When a round closes, as people read it: midnight Central is shown as "11:59 PM CT" (the last minute you can
// vote), plus the viewer's own office zone when it differs ("12:59 AM ET your time").
//   closesAtIso: the close instant; tz: the viewer's zone. -> { ct: '11:59 PM CT', mine: '12:59 AM ET' | null }
export function closeLabel(closesAtIso, tz) {
  const t = Date.parse(closesAtIso || '');
  if (!Number.isFinite(t)) return { ct: '', mine: null };
  const last = t - 60_000;
  const ct = `${hm(last, CT)} CT`;
  const mine = tz && tz !== CT ? `${hm(last, tz)} ${abbr(tz)}` : null;
  return { ct, mine };
}

// "Monday Oct 19" / "Mon Oct 19" for a 'YYYY-MM-DD' (calendar math, no zone shift).
export function fmtStart(ymd, { long = false } = {}) {
  if (!ymd || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(String(ymd))) return '';
  const [y, m, d] = String(ymd).split('-').map(Number);
  const p = tzParts(Date.UTC(y, m - 1, d, 12), 'UTC', { weekday: long ? 'long' : 'short', month: 'short', day: 'numeric' });
  return p ? `${p.weekday} ${p.month} ${p.day}` : String(ymd);
}

// "2 h 14 min" / "9 min" / "under a minute" until an instant (the last-hour countdown).
export function untilText(targetIso, nowMs) {
  const ms = Date.parse(targetIso || '') - nowMs;
  if (!Number.isFinite(ms) || ms <= 0) return '';
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'under a minute';
  const h = Math.floor(min / 60);
  return h ? `${h} h ${min % 60} min` : `${min} min`;
}
