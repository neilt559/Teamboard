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
