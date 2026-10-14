import { handle, str, bad, notFound, noNul } from '@/lib/http';
import { query } from '@/lib/db';
import { CATEGORIES, isKind, TITLE_MAX, DETAILS_MAX, ANNOUNCEMENT_MAX } from '@/lib/suggestions';
import { loadSuggestion, loadBoard, loadAllBoards, suggestionTarget } from '@/lib/queries/suggestions';
import { writableSql, archivedError } from '@/lib/queries/spaces';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';
export const maxDuration = 60;

// GET /api/suggestions?space=<board> -> one Suggestions/Announcements board (design-amendments A10), the same
// object the board page renders: { board, suggestions, replies, canStatus, statusOpen, isAdmin, isOrganizer,
// canPost, since }. board = 'company' (CAGE) or 'office:<id>'. Without space: every post on every board the viewer
// can read (board: null). A board the viewer can't read (and any team key) is the same 404 as a missing one.
export const GET = handle(async ({ req, viewer }) => {
  const key = new URL(req.url).searchParams.get('space');
  if (key == null || key === '') return loadAllBoards(viewer);
  const data = await loadBoard(viewer, key);
  if (!data) throw notFound('Board not found');
  return data;
});

// Post on a board as the signed-in user (inventory §1.15, rules 23, 27-28; A10.2):
//   { space, kind: 'suggestion', title, details?, category?, anonymous? }   (kind omitted = a suggestion)
//   { space, kind: 'announcement', title, details }                        (details = the body, notes markup)
// space omitted = CAGE ('company'), where suggestions went before Release 2. Anyone who can read the board posts
// either kind. An announcement is never anonymous and has no category. user_id always comes from the session and
// is always stored; it is masked in every response. The INSERT re-checks the read right and that the board isn't
// archived (admins excepted) in the same statement. Response keeps today's { id } and adds the shaped post.
export const POST = handle(async ({ viewer, body }) => {
  const b = await body();
  const kind = b.kind == null || b.kind === '' ? 'suggestion' : b.kind;
  if (!isKind(kind)) throw bad('Pick Suggestion or Announcement.');
  const announcement = kind === 'announcement';
  const title = noNul(str(b.title, TITLE_MAX));                    // a NUL can't be stored: 400, not 500
  if (!title) throw bad(announcement ? 'Give your announcement a title.' : 'Give your suggestion a title.');
  const details = noNul(str(b.details, announcement ? ANNOUNCEMENT_MAX : DETAILS_MAX));
  if (announcement && !details) throw bad('Write the announcement first.');
  const category = !announcement && CATEGORIES.some((c) => c.key === b.category) ? b.category : 'other';
  const anonymous = !announcement && !!b.anonymous;
  const target = await suggestionTarget(viewer, b.space);
  if (!target) throw notFound('Board not found');
  if (target.archived) throw archivedError();
  const bd = target.board;
  const office = bd.scope === 'office' ? bd.office_id : null;
  const r = await query(
    `INSERT INTO suggestions (user_id, title, details, category, anonymous, scope, office_id, team_id, kind)
     SELECT $1::bigint, $2::text, $3::text, $4::text, $5::boolean, $6::text, $7::bigint, NULL::bigint, $8::text
     WHERE tb_can_read_space($1::bigint, $6::text, $7::bigint, NULL::bigint)
       AND ${writableSql('$1::bigint', '$6::text', '$7::bigint', 'NULL::bigint')}
     RETURNING id`,
    [String(viewer.id), title, details, category, anonymous, bd.scope, office, kind]);
  if (!r.rows[0]) throw notFound('Board not found');               // lost access or archived meanwhile
  const id = String(r.rows[0].id);
  const row = await loadSuggestion(viewer, id);
  return { ...(row || {}), id };
}, { legacyWrite: true });
