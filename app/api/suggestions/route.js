import { handle, str, bad } from '@/lib/http';
import { query } from '@/lib/db';
import { CATEGORIES } from '@/lib/suggestions';
import { loadSuggestion } from '@/lib/queries/suggestions';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';
export const maxDuration = 60;

// Post a suggestion as the signed-in user, optionally anonymous (inventory §1.15, rules 23, 27-28).
// user_id always comes from the session and is always stored; it is masked in every response.
// Response keeps today's { id } and adds the shaped suggestion (old tabs only read the id, if anything).
export const POST = handle(async ({ viewer, body }) => {
  const b = await body();
  const title = str(b.title, 160);
  if (!title) throw bad('Give your suggestion a title.');
  const details = str(b.details, 5000);
  const category = CATEGORIES.some((c) => c.key === b.category) ? b.category : 'other';
  const r = await query(
    `INSERT INTO suggestions (user_id, title, details, category, anonymous)
     VALUES ($1::bigint, $2::text, $3::text, $4::text, $5::boolean)
     RETURNING id`,
    [String(viewer.id), title, details, category, !!b.anonymous]);
  const id = String(r.rows[0].id);
  const row = await loadSuggestion(viewer, id);
  return { ...(row || {}), id };
}, { legacyWrite: true });
