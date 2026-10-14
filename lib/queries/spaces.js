import 'server-only';
import { query } from '../db.js';
import { HttpError } from '../http.js';

// Thread spaces (design-amendments A5, Release 2) left the UI with A10 (Neil, 2026-10-14): the Suggestions/
// Announcements boards (lib/queries/suggestions.js) replace them. The space tables stay as they are: chat is kept
// in the database unused, each announcement was copied onto its board (space_posts.migrated_to, lib/schema/
// threads.js), and the space API routes answer 410. What is left here is shared:
//   writableSql   the archived rule the boards' writes re-check in SQL;
//   spaceUsage    the office and team delete guards (posts of any kind, in either table, keep them).

export const ARCHIVED_MESSAGE = 'This office is archived, so its board is read-only.';
export const archivedError = () => new HttpError(409, ARCHIVED_MESSAGE, { code: 'archived' });

// The space takes posts: CAGE always; an office while it isn't archived; a team while neither it nor its office is.
// sc / of / tm are SQL expressions for scope, office_id and team_id (constants, never input).
const openSql = (sc, of, tm) => `(CASE ${sc}
    WHEN 'company' THEN true
    WHEN 'office' THEN COALESCE((SELECT NOT ox.archived FROM offices ox WHERE ox.id = ${of}), false)
    WHEN 'team' THEN COALESCE((SELECT NOT (tx.archived OR COALESCE(tox.archived, false)) FROM teams tx
                               LEFT JOIN offices tox ON tox.id = tx.office_id WHERE tx.id = ${tm}), false)
    ELSE false END)`;
// Writable for the viewer uid: open, or the viewer is an admin (level 9).
export const writableSql = (uid, sc, of, tm) => `(${openSql(sc, of, tm)} OR COALESCE(tb_user_level(${uid}), 0) >= 9)`;

// ---------------------------------------------------------------- office / team delete guards

// What still belongs to an office or a team (thread posts of any state, and board posts). An office counts its
// teams' rows too (deleting the office would delete them). -> { posts, suggestions }
export async function spaceUsage({ officeId = null, teamId = null }) {
  const idOrNull = (v) => (v == null ? null : String(v));
  const r = await query(
    `SELECT (SELECT count(*) FROM space_posts p
             WHERE ($1::bigint IS NOT NULL AND (p.office_id = $1::bigint
                      OR p.team_id IN (SELECT t.id FROM teams t WHERE t.office_id = $1::bigint)))
                OR ($2::bigint IS NOT NULL AND p.team_id = $2::bigint))::int AS posts,
            (SELECT count(*) FROM suggestions s
             WHERE ($1::bigint IS NOT NULL AND (s.office_id = $1::bigint
                      OR s.team_id IN (SELECT t.id FROM teams t WHERE t.office_id = $1::bigint)))
                OR ($2::bigint IS NOT NULL AND s.team_id = $2::bigint))::int AS suggestions`,
    [idOrNull(officeId), idOrNull(teamId)]);
  const x = r.rows[0] || {};
  return { posts: Number(x.posts || 0), suggestions: Number(x.suggestions || 0) };
}
export const SPACE_DELETE_REFUSED = {
  office: 'This office has posts on its boards; archive it instead.',
  team: 'This team has thread posts; archive it instead.',
};

// The answer of every retired thread-space route (A10.3: "the API routes may answer 410").
export const THREADS_RETIRED = 'Threads were replaced by Suggestions/Announcements. Reload the page.';
export const threadsRetired = () => new HttpError(410, THREADS_RETIRED, { code: 'retired' });
