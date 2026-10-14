// Dates and times for the thread pages, in the viewer's office time zone. Built from Intl parts so the server
// HTML and the browser agree (no hydration mismatch from the host's zone or ICU's narrow no-break space).
// Plain module: server and client components both import it.

const fmts = new Map();
function parts(v, tz, opts) {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  const key = `${tz || ''}|${JSON.stringify(opts)}`;
  let f = fmts.get(key);
  if (!f) {
    try { f = new Intl.DateTimeFormat('en-US', { ...opts, timeZone: tz || undefined }); }
    catch { f = new Intl.DateTimeFormat('en-US', opts); }
    fmts.set(key, f);
  }
  return Object.fromEntries(f.formatToParts(d).map((p) => [p.type, p.value]));
}

// 'YYYY-MM-DD' of an instant in tz.
export function dayKey(v, tz) {
  const p = parts(v, tz, { year: 'numeric', month: '2-digit', day: '2-digit' });
  return p ? `${p.year}-${p.month}-${p.day}` : '';
}

// "3:14 PM"
export function fmtTime(v, tz) {
  const p = parts(v, tz, { hour: 'numeric', minute: '2-digit', hour12: true });
  return p ? `${p.hour}:${p.minute} ${p.dayPeriod || ''}`.trim() : '';
}

const DAY_MS = 86_400_000;
const shift = (key, days) => {
  const [y, m, d] = key.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d) + days * DAY_MS);
  return t.toISOString().slice(0, 10);
};

// Day separator text: "Today", "Yesterday", "Monday, Oct 12" (this year) or "Oct 12, 2025".
export function dayLabel(v, tz, now) {
  const k = dayKey(v, tz);
  const today = dayKey(now ?? Date.now(), tz);
  if (!k) return '';
  if (k === today) return 'Today';
  if (k === shift(today, -1)) return 'Yesterday';
  const p = parts(v, tz, { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });
  if (!p) return '';
  return k.slice(0, 4) === today.slice(0, 4) ? `${p.weekday}, ${p.month} ${p.day}` : `${p.month} ${p.day}, ${p.year}`;
}

// "Today 3:14 PM", "Yesterday 9:02 AM", "Oct 12, 3:14 PM", "Oct 12, 2025".
export function fmtWhen(v, tz, now) {
  const k = dayKey(v, tz);
  if (!k) return '';
  const today = dayKey(now ?? Date.now(), tz);
  if (k === today) return `Today ${fmtTime(v, tz)}`;
  if (k === shift(today, -1)) return `Yesterday ${fmtTime(v, tz)}`;
  const p = parts(v, tz, { month: 'short', day: 'numeric', year: 'numeric' });
  if (!p) return '';
  return k.slice(0, 4) === today.slice(0, 4) ? `${p.month} ${p.day}, ${fmtTime(v, tz)}` : `${p.month} ${p.day}, ${p.year}`;
}

// Full date and time for a title attribute: "Tue, Oct 13, 2026, 3:14 PM".
export function fmtFull(v, tz) {
  const p = parts(v, tz, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  return p ? `${p.weekday}, ${p.month} ${p.day}, ${p.year}, ${fmtTime(v, tz)}` : '';
}

// A short plain-text excerpt of a notes-markup body (Home widgets, previews): codes dropped, lines joined.
export function excerpt(body, max = 160) {
  const text = String(body || '').split('\n')
    .map((l) => l.replace(/^\s*%[th]\s?/i, '').replace(/^\s*-\s+/, '').trim())
    .filter(Boolean).join(' · ');
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}
