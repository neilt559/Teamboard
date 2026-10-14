import { handle, str, bad, HttpError, notFound } from '@/lib/http';
import { query } from '@/lib/db';
import { CATEGORIES } from '@/lib/suggestions';
import { loadSuggestion, loadSuggestions, suggestionTarget } from '@/lib/queries/suggestions';
import { writableSql, ARCHIVED_MESSAGE } from '@/lib/queries/spaces';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';
export const maxDuration = 60;

// GET /api/suggestions?space=<key> -> the suggestion box of one thread space (design-amendments A5.5), the same
// object the space page renders: { suggestions, replies, canStatus, statusOpen, isAdmin, space, canPost }.
// Without space: every suggestion in every space the viewer can read (space: null). A space the viewer can't
// read is the same 404 as a missing one.
export const GET = handle(async ({ req, viewer }) => {
  const key = new URL(req.url).searchParams.get('space');
  const data = await loadSuggestions(viewer, key == null || key === '' ? null : key);
  if (!data) throw notFound('Space not found');
  return data;
});

// Post a suggestion as the signed-in user, optionally anonymous (inventory §1.15, rules 23, 27-28), into a thread
// space: { space, title, details?, category?, anonymous? }. space omitted = CAGE ('company'), where suggestions
// went before Release 2. user_id always comes from the session and is always stored; it is masked in every
// response. The INSERT re-checks the read right and that the space isn't archived (admins excepted) in the same
// statement. Response keeps today's { id } and adds the shaped suggestion.
export const POST = handle(async ({ viewer, body }) => {
  const b = await body();
  const title = str(b.title, 160);
  if (!title) throw bad('Give your suggestion a title.');
  const details = str(b.details, 5000);
  const category = CATEGORIES.some((c) => c.key === b.category) ? b.category : 'other';
  const target = await suggestionTarget(viewer, b.space);
  if (!target) throw notFound('Space not found');
  if (target.archived) throw new HttpError(409, ARCHIVED_MESSAGE, { code: 'archived' });
  const sp = target.space;
  const office = sp.scope === 'office' ? sp.office_id : null;
  const team = sp.scope === 'team' ? sp.team_id : null;
  const r = await query(
    `INSERT INTO suggestions (user_id, title, details, category, anonymous, scope, office_id, team_id)
     SELECT $1::bigint, $2::text, $3::text, $4::text, $5::boolean, $6::text, $7::bigint, $8::bigint
     WHERE tb_can_read_space($1::bigint, $6::text, $7::bigint, $8::bigint)
       AND ${writableSql('$1::bigint', '$6::text', '$7::bigint', '$8::bigint')}
     RETURNING id`,
    [String(viewer.id), title, details, category, !!b.anonymous, sp.scope, office, team]);
  if (!r.rows[0]) throw notFound('Space not found');            // lost access or archived meanwhile
  const id = String(r.rows[0].id);
  const row = await loadSuggestion(viewer, id);
  return { ...(row || {}), id };
}, { legacyWrite: true });
