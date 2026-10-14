import 'server-only';
import * as React from 'react';
import { query, transaction } from '../db.js';
import { isAdmin, isOrganizer } from '../policy.js';
import { spaceKeyOf } from '../spaces.js';
import { parseBoardKey, boardHref, COMPANY_BOARD_NAME } from '../suggestions.js';
import { writableSql } from './spaces.js';

// The Suggestions/Announcements boards (design-amendments A10, which replaces the A5 thread spaces in the UI):
// CAGE ('company', everyone) and one board per office (its home and extra-office members, Director and up (L4)
// and admins: the A5 office-space rule). One feed per board; each post is a row of suggestions with a kind:
//   suggestion:   today's rules (design §2.1 /suggestions, §4.5, §8.2, §13 #13; inventory §1.15, rules 27-28):
//                 category, +1 votes, the status rule, optional anonymity, replies, authors edit and delete their
//                 own, admins hide;
//   announcement: a title and a body (details, notes markup), always shows its author (never anonymous), no votes,
//                 status or category, replies, the author edits and deletes, admins and culture organizers hide.
// Every read and write filters with tb_can_read_space(viewer, scope, office_id, team_id) in SQL, so a post on a
// board the viewer can't read answers like a missing one. Archived offices are read-only for everyone but admins
// (409). Masking happens HERE, in SQL, so no response ever carries another person's user_id for an anonymous post
// or reply (rule 28):
//   - a suggestion's author fields are NULL when it is anonymous (the users row isn't even joined);
//   - a reply is anonymous when it is by the poster of an anonymous suggestion, computed at read time
//     (r.user_id = s.user_id AND s.anonymous), so toggling anonymity never de-anonymizes earlier replies;
//   - `mine` is computed per viewer on the server; voter lists are never exposed (count + own flag only).
// Hidden posts and replies are left out for everyone but admins (and, for announcements, organizers).

const cache = typeof React.cache === 'function' ? React.cache : (fn) => fn;

// Status changes are open to everyone while the company is small; from this many active users on,
// only culture organizers and admins may change a suggestion's status (requirements, design §4.5).
export const STATUS_OPEN_LIMIT = 50;

// "Active users" = accounts that can sign in (not disabled), test accounts (zz_) excluded.
const ACTIVE_USERS_SQL = `SELECT count(*)::int AS n FROM users
  WHERE disabled_at IS NULL AND username NOT LIKE 'zz!_%' ESCAPE '!'`;

export async function activeUserCount() {
  const r = await query(ACTIVE_USERS_SQL);
  return Number(r.rows[0]?.n || 0);
}

// May viewer v change a suggestion's status, given the active-user count?
export const canChangeStatus = (v, activeUsers) => Number(activeUsers) < STATUS_OPEN_LIMIT || isOrganizer(v);
// Who hides (and sees hidden) posts of a kind: suggestions admins; announcements admins and culture organizers.
export const canHideKind = (v, kind) => (kind === 'announcement' ? isOrganizer(v) : isAdmin(v));

const iso = (v) => (v == null ? null : v instanceof Date ? v.toISOString() : String(v));
const idOrNull = (v) => (v == null ? null : String(v));

function author(r) {
  if (r.author_id == null) return null;
  return {
    id: String(r.author_id),
    username: r.author_username || '',
    display_name: r.author_display_name || '',
    name: r.author_display_name || r.author_username || '',
    avatar_v: r.author_avatar_v != null ? String(r.author_avatar_v) : null,
    identity_verified: !!r.author_verified,
    // the profile opens for this viewer (not a zz_ or disabled account, or the viewer is an admin or the author)
    listed: r.author_listed !== false,
  };
}

// One post as the client sees it. `row` comes from SUGGESTIONS_SQL (or a subset of it).
export function shapeSuggestion(r) {
  const a = author(r);
  const space = r.scope ? spaceKeyOf({ scope: r.scope, office_id: idOrNull(r.office_id), team_id: idOrNull(r.team_id) }) : null;
  return {
    id: String(r.id),
    kind: r.kind === 'announcement' ? 'announcement' : 'suggestion',
    space,
    board: space,
    title: r.title ?? '',
    details: r.details ?? '',
    category: r.category ?? 'other',
    status: r.status ?? 'new',
    anonymous: !!r.anonymous,
    created_at: iso(r.created_at),
    updated_at: iso(r.updated_at),
    mine: !!r.mine,
    votes: Number(r.votes) || 0,
    voted: !!r.voted,
    hidden: !!r.hidden,
    hidden_by_name: r.hidden_by_name || null,
    author_id: a ? a.id : null,
    author: a,
  };
}

export function shapeReply(r) {
  const a = author(r);
  return {
    id: String(r.id),
    suggestion_id: String(r.suggestion_id),
    body: r.body ?? '',
    anonymous: !!r.anonymous,
    created_at: iso(r.created_at),
    mine: !!r.mine,
    hidden: !!r.hidden,
    author_id: a ? a.id : null,
    author: a,
  };
}

// The read filter shared by both lists. $1 = viewer id, $3 / $4 / $5 = one board's scope, office_id and team_id
// (all NULL = every board the viewer can read), $6 = one id (or NULL). Team-scoped rows belong to no board.
const IN_SCOPE = `tb_can_read_space($1::bigint, s.scope, s.office_id, s.team_id) AND s.scope <> 'team'
  AND ($3::text IS NULL OR (s.scope = $3::text AND s.office_id IS NOT DISTINCT FROM $4::bigint
                            AND s.team_id IS NOT DISTINCT FROM $5::bigint))`;
// Hidden rows: admins see every one; organizers also see hidden announcements ($7).
const SEES_HIDDEN = `($2::boolean OR ($7::boolean AND s.kind = 'announcement'))`;

// $1 = viewer id, $2 = viewer is admin, $3-$5 the board, $6 one id or NULL, $7 = viewer is an organizer (or admin).
// Anonymous rows never join users.
const SUGGESTIONS_SQL = `
SELECT s.id, s.kind, s.scope, s.office_id, s.team_id, s.title, s.details, s.category, s.status, s.anonymous, s.created_at,
       s.updated_at, (s.hidden_at IS NOT NULL) AS hidden,
       CASE WHEN ${SEES_HIDDEN} AND s.hidden_at IS NOT NULL
            THEN (SELECT COALESCE(NULLIF(h.display_name, ''), h.username) FROM users h WHERE h.id = s.hidden_by) END
         AS hidden_by_name,
       u.id AS author_id, u.username AS author_username, u.display_name AS author_display_name,
       u.avatar_v AS author_avatar_v, (u.identity_verified_at IS NOT NULL) AS author_verified,
       ($2::boolean OR u.id = $1::bigint OR (u.disabled_at IS NULL AND u.username NOT LIKE 'zz!_%' ESCAPE '!')) AS author_listed,
       COALESCE(s.user_id = $1::bigint, false) AS mine,
       (SELECT count(*) FROM suggestion_votes v WHERE v.suggestion_id = s.id)::int AS votes,
       EXISTS (SELECT 1 FROM suggestion_votes v WHERE v.suggestion_id = s.id AND v.user_id = $1::bigint) AS voted
FROM suggestions s
LEFT JOIN users u ON u.id = s.user_id AND NOT s.anonymous
WHERE (s.hidden_at IS NULL OR ${SEES_HIDDEN}) AND ${IN_SCOPE} AND ($6::bigint IS NULL OR s.id = $6::bigint)
ORDER BY s.created_at DESC, s.id DESC`;

// Replies, oldest first. A reply's anonymity is computed here (design §13 #13). $6 = one reply id or NULL; $7 as
// above (a hidden announcement's replies show to the organizers who see it).
const REPLIES_SQL = `
WITH x AS (
  SELECT r.id, r.suggestion_id, r.user_id, r.body, r.created_at, r.hidden_at,
         COALESCE(s.anonymous AND r.user_id = s.user_id, false) AS anon
  FROM suggestion_replies r JOIN suggestions s ON s.id = r.suggestion_id
  WHERE (s.hidden_at IS NULL OR ${SEES_HIDDEN}) AND (r.hidden_at IS NULL OR $2::boolean) AND ${IN_SCOPE}
    AND ($6::bigint IS NULL OR r.id = $6::bigint))
SELECT x.id, x.suggestion_id, x.body, x.created_at, x.anon AS anonymous, (x.hidden_at IS NOT NULL) AS hidden,
       u.id AS author_id, u.username AS author_username, u.display_name AS author_display_name,
       u.avatar_v AS author_avatar_v, (u.identity_verified_at IS NOT NULL) AS author_verified,
       ($2::boolean OR u.id = $1::bigint OR (u.disabled_at IS NULL AND u.username NOT LIKE 'zz!_%' ESCAPE '!')) AS author_listed,
       COALESCE(x.user_id = $1::bigint, false) AS mine
FROM x LEFT JOIN users u ON u.id = x.user_id AND NOT x.anon
ORDER BY x.created_at ASC, x.id ASC`;

// ---------------------------------------------------------------- boards

// The board for a key ('company' | 'office:<id>'), as this viewer may use it, or null when the key is malformed
// (team keys included), the office doesn't exist, or the viewer can't read it (one answer for all three).
//   { key, scope, office_id, name, href, archived, mine, can_post }
//   can_post: false on an archived office's board (admins excepted).
export async function resolveBoard(viewer, key) {
  const b = typeof key === 'string' ? parseBoardKey(key) : key;
  if (!b || !b.scope) return null;
  const r = await query(
    `SELECT o.name, COALESCE(o.archived, false) AS archived,
            (COALESCE(tb_user_level($1::bigint), 0) >= 9) AS admin,
            (k.office_id IS NOT NULL AND k.office_id IN (SELECT tb_user_office_ids($1::bigint))) AS mine
     FROM (SELECT $2::text AS scope, $3::bigint AS office_id) k
     LEFT JOIN offices o ON k.scope = 'office' AND o.id = k.office_id
     WHERE tb_can_read_space($1::bigint, k.scope, k.office_id, NULL::bigint)
       AND (k.scope = 'company' OR o.id IS NOT NULL)`,
    [String(viewer.id), b.scope, b.office_id]);
  const x = r.rows[0];
  if (!x) return null;
  const archived = b.scope === 'office' && !!x.archived;
  return {
    key: b.key,
    scope: b.scope,
    office_id: b.office_id,
    name: b.scope === 'company' ? COMPANY_BOARD_NAME : (x.name || ''),
    href: boardHref(b),
    archived,
    mine: b.scope === 'company' || !!x.mine,
    can_post: !archived || !!x.admin,
  };
}

// The viewer's floor for "new": the later of their account's creation and A10's first migration (schema_meta
// board_at), so nobody starts with the history marked unread.
const FLOOR = `GREATEST(u.created_at,
           COALESCE((SELECT to_timestamp(m.value::double precision / 1000) FROM schema_meta m
                     WHERE m.key = 'board_at' AND m.value ~ '^[0-9]{1,15}$'), '-infinity'::timestamptz))`;

// Unread per board, for every board the viewer can read (A10.4): posts of either kind and replies by someone
// else, created after the viewer's last visit to that board (space_reads, space_key = the board key, section
// 'suggestions') and after their floor. Hidden ones never count. $1 = viewer id. Rows with n = 0 are left out.
export const UNREAD_SQL = `
WITH f AS (SELECT ${FLOOR} AS floor FROM users u WHERE u.id = $1::bigint),
b AS (
  SELECT 'company'::text AS board, 'company'::text AS scope, NULL::bigint AS office_id
  UNION ALL
  SELECT 'office:' || o.id::text, 'office'::text, o.id FROM offices o),
th AS (
  SELECT b.board, b.scope, b.office_id, GREATEST(f.floor, COALESCE(r.last_read_at, '-infinity'::timestamptz)) AS since
  FROM b CROSS JOIN f
  LEFT JOIN space_reads r ON r.user_id = $1::bigint AND r.space_key = b.board AND r.section = 'suggestions'
  WHERE tb_can_read_space($1::bigint, b.scope, b.office_id, NULL::bigint)),
n AS (
  SELECT th.board,
    ((SELECT count(*) FROM suggestions s
      WHERE s.scope = th.scope AND s.office_id IS NOT DISTINCT FROM th.office_id AND s.team_id IS NULL
        AND s.created_at > th.since AND s.hidden_at IS NULL AND s.user_id IS DISTINCT FROM $1::bigint)
   + (SELECT count(*) FROM suggestion_replies r JOIN suggestions s ON s.id = r.suggestion_id
      WHERE s.scope = th.scope AND s.office_id IS NOT DISTINCT FROM th.office_id AND s.team_id IS NULL
        AND r.created_at > th.since AND r.hidden_at IS NULL AND s.hidden_at IS NULL
        AND r.user_id IS DISTINCT FROM $1::bigint))::int AS n
  FROM th)
SELECT n.board, n.n FROM n WHERE n.n > 0`;

// UNREAD_SQL rows -> { byKey: Map(board key -> n), total }
export function foldUnread(rows) {
  const byKey = new Map();
  let total = 0;
  for (const r of rows || []) {
    const n = Number(r.n) || 0;
    byKey.set(r.board, (byKey.get(r.board) || 0) + n);
    total += n;
  }
  return { byKey, total };
}
// The lazy query for a batch (lib/queries/nav.js adds it to the shell's batch).
export const unreadQuery = (viewer) => query(UNREAD_SQL, [String(viewer.id)]);

const OFFICES_SQL = `
SELECT o.id, o.name, o.position, o.archived,
       (o.id IN (SELECT tb_user_office_ids($1::bigint))) AS mine,
       EXISTS (SELECT 1 FROM suggestions s WHERE s.scope = 'office' AND s.office_id = o.id AND s.hidden_at IS NULL) AS has_posts
FROM offices o
WHERE tb_can_read_space($1::bigint, 'office', o.id, NULL::bigint)
ORDER BY o.position ASC, o.id ASC`;

// listBoards(viewer) -> { boards: [{ key, scope, office_id, name, href, archived, mine, unread }], unread_total }
//   Order: CAGE; my offices (home first, then extra offices by position); then (L4 and admins) the other offices.
//   An archived office is listed only while its board has posts.
export const listBoards = cache(async (viewer) => {
  const uid = String(viewer.id);
  const res = await transaction([query(OFFICES_SQL, [uid]), query(UNREAD_SQL, [uid])], { readOnly: true });
  const [offices, unreadRows] = res.map((r) => r.rows);
  const { byKey, total } = foldUnread(unreadRows);
  const home = idOrNull(viewer.office_id);
  const listed = offices.filter((o) => !o.archived || o.has_posts);
  const mine = listed.filter((o) => o.mine).sort((a, b) => (String(b.id) === home) - (String(a.id) === home));
  const others = listed.filter((o) => !o.mine);
  const office = (o) => ({
    key: `office:${o.id}`, scope: 'office', office_id: String(o.id), name: o.name || '', href: `/suggestions/office/${o.id}`,
    archived: !!o.archived, mine: !!o.mine, unread: byKey.get(`office:${o.id}`) || 0,
  });
  return {
    boards: [
      { key: 'company', scope: 'company', office_id: null, name: COMPANY_BOARD_NAME, href: '/suggestions', archived: false,
        mine: true, unread: byKey.get('company') || 0 },
      ...mine.map(office),
      ...others.map(office),
    ],
    unread_total: total,
  };
});

// The office page's link to its board: { key, href, name, unread } or null when the viewer can't read it.
export async function boardLinkFor(viewer, key) {
  const board = await resolveBoard(viewer, key);
  if (!board) return null;
  const r = await query(`SELECT z.n FROM (${UNREAD_SQL}) z WHERE z.board = $2::text`, [String(viewer.id), board.key]);
  return { key: board.key, href: board.href, name: board.name, unread: Number(r.rows[0]?.n) || 0 };
}

// The total for the header badge (nav posts_unread).
export async function unreadTotal(viewer) {
  const r = await unreadQuery(viewer);
  return foldUnread(r.rows).total;
}

// When this viewer last visited a board (before now), with the floor: posts after it show "New".
const SINCE_SQL = `
SELECT GREATEST(${FLOOR},
         COALESCE((SELECT r.last_read_at FROM space_reads r WHERE r.user_id = u.id AND r.space_key = $2::text
                     AND r.section = 'suggestions'), '-infinity'::timestamptz)) AS since
FROM users u WHERE u.id = $1::bigint`;

const scopeOf = (b) => [b.scope, b.scope === 'office' ? b.office_id : null, null];

// loadBoard(viewer, key) -> { board, suggestions, replies, canStatus, statusOpen, isAdmin, isOrganizer, canPost,
// since } in one read-only batch, or null when the key names no board the viewer can read (or none at all).
//   suggestions: both kinds, newest first (the page orders them: lib/suggestions.js boardOrder).
//   canStatus: this viewer may change suggestion statuses; statusOpen: everyone may (fewer than 50 active users).
//   since: the viewer's previous visit (ISO; null = never), for the "New" markers.
export const loadBoard = cache(async (viewer, key) => {
  const board = await resolveBoard(viewer, key);
  if (!board) return null;
  const uid = String(viewer.id);
  const admin = isAdmin(viewer);
  const org = isOrganizer(viewer);
  const scope = scopeOf(board);
  const res = await transaction([
    query(SUGGESTIONS_SQL, [uid, admin, ...scope, null, org]),
    query(REPLIES_SQL, [uid, admin, ...scope, null, org]),
    query(ACTIVE_USERS_SQL),
    query(SINCE_SQL, [uid, board.key]),
  ], { readOnly: true });
  const [sRows, rRows, nRows, sinceRows] = res.map((r) => r.rows);
  const active = Number(nRows[0]?.n || 0);
  const since = sinceRows[0]?.since;
  const sinceIso = since == null ? null : iso(since);
  return {
    board,
    suggestions: sRows.map(shapeSuggestion),
    replies: rRows.map(shapeReply),
    canStatus: canChangeStatus(viewer, active),
    statusOpen: active < STATUS_OPEN_LIMIT,
    isAdmin: admin,
    isOrganizer: org,
    canPost: !!board.can_post,
    since: sinceIso && !sinceIso.startsWith('-') ? sinceIso : null,
  };
});

// GET /api/suggestions without a board: every post on every board the viewer can read, the same shape minus the
// board facts (board: null).
export async function loadAllBoards(viewer) {
  const uid = String(viewer.id);
  const admin = isAdmin(viewer);
  const org = isOrganizer(viewer);
  const res = await transaction([
    query(SUGGESTIONS_SQL, [uid, admin, null, null, null, null, org]),
    query(REPLIES_SQL, [uid, admin, null, null, null, null, org]),
    query(ACTIVE_USERS_SQL),
  ], { readOnly: true });
  const [sRows, rRows, nRows] = res.map((r) => r.rows);
  const active = Number(nRows[0]?.n || 0);
  return {
    board: null,
    suggestions: sRows.map(shapeSuggestion),
    replies: rRows.map(shapeReply),
    canStatus: canChangeStatus(viewer, active),
    statusOpen: active < STATUS_OPEN_LIMIT,
    isAdmin: admin,
    isOrganizer: org,
    canPost: true,
  };
}

// The newest posts across the boards the viewer reads (Home cards, the office page), newest first, each with its
// board: [{ ...post, reply_count, board_info: { key, name, href } }]. kind: 'announcement' | 'suggestion' | null
// (both); board: one board key or null (every board). Hidden posts are left out.
export const latestPosts = cache(async (viewer, { kind = null, board = null, limit = 5 } = {}) => {
  const n = Math.max(1, Math.min(Number(limit) || 5, 20));
  const b = board ? parseBoardKey(board) : null;
  if (board && !b) return [];
  const r = await query(
    `SELECT s.id, s.kind, s.scope, s.office_id, s.team_id, s.title, s.details, s.category, s.status, s.anonymous,
            s.created_at, s.updated_at, false AS hidden, o.name AS office_name,
            u.id AS author_id, u.username AS author_username, u.display_name AS author_display_name,
            u.avatar_v AS author_avatar_v, (u.identity_verified_at IS NOT NULL) AS author_verified,
            (u.id = $1::bigint OR (u.disabled_at IS NULL AND u.username NOT LIKE 'zz!_%' ESCAPE '!')
               OR EXISTS (SELECT 1 FROM users va WHERE va.id = $1::bigint AND va.is_admin AND va.disabled_at IS NULL))
              AS author_listed,
            COALESCE(s.user_id = $1::bigint, false) AS mine,
            (SELECT count(*) FROM suggestion_votes v WHERE v.suggestion_id = s.id)::int AS votes,
            (SELECT count(*) FROM suggestion_replies x WHERE x.suggestion_id = s.id AND x.hidden_at IS NULL)::int
              AS reply_count
     FROM suggestions s
     LEFT JOIN offices o ON s.scope = 'office' AND o.id = s.office_id
     LEFT JOIN users u ON u.id = s.user_id AND NOT s.anonymous
     WHERE s.hidden_at IS NULL AND s.scope <> 'team'
       AND tb_can_read_space($1::bigint, s.scope, s.office_id, s.team_id)
       AND ($2::text IS NULL OR s.kind = $2::text)
       AND ($3::text IS NULL OR (s.scope = $3::text AND s.office_id IS NOT DISTINCT FROM $4::bigint))
     ORDER BY s.created_at DESC, s.id DESC
     LIMIT $5::int`,
    [String(viewer.id), kind, b ? b.scope : null, b ? b.office_id : null, n]);
  return r.rows.map((row) => {
    const post = shapeSuggestion(row);
    const name = row.scope === 'company' ? COMPANY_BOARD_NAME : (row.office_name || '');
    return { ...post, reply_count: Number(row.reply_count) || 0, board_info: { key: post.board, name, href: boardHref(post.board) } };
  });
});

// POST /api/suggestions/read { space }: the viewer has seen this board up to now (upsert, never backwards).
// -> { ok, space, last_read_at, unread_total } or null when the board doesn't exist or isn't readable.
export async function markBoardRead(viewer, key) {
  const b = parseBoardKey(key);
  if (!b) return null;
  const r = await query(
    `WITH ok AS (SELECT 1 AS x WHERE tb_can_read_space($1::bigint, $2::text, $3::bigint, NULL::bigint)
                   AND ($2::text = 'company' OR EXISTS (SELECT 1 FROM offices o WHERE o.id = $3::bigint)))
     INSERT INTO space_reads (user_id, space_key, section, last_read_at)
     SELECT $1::bigint, $4::text, 'suggestions', now() FROM ok
     ON CONFLICT (user_id, space_key, section)
       DO UPDATE SET last_read_at = GREATEST(space_reads.last_read_at, EXCLUDED.last_read_at)
     RETURNING last_read_at`,
    [String(viewer.id), b.scope, b.office_id, b.key]);
  if (!r.rows[0]) return null;
  return { ok: true, space: b.key, last_read_at: iso(r.rows[0].last_read_at), unread_total: await unreadTotal(viewer) };
}

// ---------------------------------------------------------------- write helpers

// The facts the write routes check before writing, for viewer v: { id, kind, user_id, hidden, space, writable } or
// null when the post doesn't exist or its board isn't readable (one answer for both).
//   writable: the board isn't archived (or v is an admin).
export async function suggestionMeta(v, id) {
  const r = await query(
    `SELECT s.id, s.kind, s.user_id, (s.hidden_at IS NOT NULL) AS hidden, s.scope, s.office_id, s.team_id,
            ${writableSql('$1::bigint', 's.scope', 's.office_id', 's.team_id')} AS writable
     FROM suggestions s
     WHERE s.id = $2::bigint AND tb_can_read_space($1::bigint, s.scope, s.office_id, s.team_id)`,
    [String(v.id), String(id)]);
  const row = r.rows[0];
  if (!row) return null;
  return {
    id: String(row.id), kind: row.kind === 'announcement' ? 'announcement' : 'suggestion', user_id: idOrNull(row.user_id),
    hidden: !!row.hidden, writable: !!row.writable,
    space: spaceKeyOf({ scope: row.scope, office_id: idOrNull(row.office_id), team_id: idOrNull(row.team_id) }),
  };
}

// The same for a reply: { id, user_id, suggestion_id, kind, hidden, suggestion_hidden, writable } or null.
export async function replyMeta(v, id) {
  const r = await query(
    `SELECT r.id, r.user_id, r.suggestion_id, s.kind, (r.hidden_at IS NOT NULL) AS hidden,
            (s.hidden_at IS NOT NULL) AS suggestion_hidden,
            ${writableSql('$1::bigint', 's.scope', 's.office_id', 's.team_id')} AS writable
     FROM suggestion_replies r JOIN suggestions s ON s.id = r.suggestion_id
     WHERE r.id = $2::bigint AND tb_can_read_space($1::bigint, s.scope, s.office_id, s.team_id)`,
    [String(v.id), String(id)]);
  const row = r.rows[0];
  if (!row) return null;
  return {
    id: String(row.id), user_id: idOrNull(row.user_id), suggestion_id: String(row.suggestion_id),
    kind: row.kind === 'announcement' ? 'announcement' : 'suggestion', hidden: !!row.hidden,
    suggestion_hidden: !!row.suggestion_hidden, writable: !!row.writable,
  };
}

// One post for viewer v (after a write), shaped and masked like the list. null when missing, hidden (for those
// who don't see hidden posts of its kind) or on a board v can't read.
export async function loadSuggestion(v, id) {
  const r = await query(SUGGESTIONS_SQL, [String(v.id), isAdmin(v), null, null, null, String(id), isOrganizer(v)]);
  return r.rows[0] ? shapeSuggestion(r.rows[0]) : null;
}

// One reply for viewer v, shaped and masked like the list. null when missing, hidden or not readable.
export async function loadReply(v, id) {
  const r = await query(REPLIES_SQL, [String(v.id), isAdmin(v), null, null, null, String(id), isOrganizer(v)]);
  return r.rows[0] ? shapeReply(r.rows[0]) : null;
}

// The board an old /threads/team/<id> link goes to (A10.1): its team's office board, CAGE when the team has no
// office, null when there is no such team. Team names and offices are company-public (design §2.1); the board page
// itself decides who reads it.
export async function teamBoardKey(teamId) {
  const r = await query('SELECT t.office_id FROM teams t WHERE t.id = $1::bigint', [String(teamId)]);
  if (!r.rows[0]) return null;
  return r.rows[0].office_id == null ? 'company' : `office:${r.rows[0].office_id}`;
}

// The board a new post goes onto: { archived, board } for a board v can read, or null (malformed key, a team key,
// a board v can't read: the route answers 404). body.space omitted = CAGE ('company'), where suggestions went
// before Release 2 (old open tabs).
export async function suggestionTarget(v, spaceKey) {
  const key = spaceKey == null || spaceKey === '' ? 'company' : spaceKey;
  const board = await resolveBoard(v, key);
  if (!board) return null;
  return { archived: !board.can_post, board };
}
