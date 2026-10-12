import { handle, bad } from '@/lib/http';
import { query } from '@/lib/db';
import { sanitizePrefs, withDefaults, DEFAULT_PREFS } from '@/lib/prefs';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';
export const maxDuration = 60;

// PATCH /api/prefs { key: value, ... } (design §11): Customize view, pins, follows, dismissed cards.
// Keys present replace the stored ones; a key set to null goes back to its default. Unknown keys and invalid
// values are dropped by sanitizePrefs (lib/prefs.js). Each key is merged in SQL (prefs - removed || set), so
// two tabs saving different keys at once never undo each other. -> { ok, prefs } (stored, with defaults).
// Preferences only change what is shown: follows and pins grant no access, and pins are re-filtered through
// tb_visible_project_ids whenever they are read.
const KEYS = Object.keys(DEFAULT_PREFS).concat('widgets');

export const PATCH = handle(async ({ viewer, body }) => {
  const b = await body();
  const present = Object.keys(b).filter((k) => KEYS.includes(k));
  if (!present.length) throw bad('Nothing to save.');
  const remove = present.filter((k) => b[k] === null);
  const set = sanitizePrefs(Object.fromEntries(present.filter((k) => b[k] !== null).map((k) => [k, b[k]])),
    { isAdmin: viewer.is_admin });
  const r = await query(
    `UPDATE users SET prefs = (COALESCE(prefs, '{}'::jsonb) - $2::text[]) || $3::jsonb, updated_at = now()
     WHERE id = $1::bigint RETURNING prefs`,
    [viewer.id, remove, JSON.stringify(set)]);
  const stored = r.rows[0]?.prefs ?? {};
  return { ok: true, prefs: withDefaults(stored, { isAdmin: viewer.is_admin }), ignored: present.filter((k) => !(k in set) && b[k] !== null) };
}, { maxBody: 20_000 });
