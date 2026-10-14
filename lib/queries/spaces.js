import 'server-only';
import * as React from 'react';
import { query, transaction } from '../db.js';
import { HttpError, bad, notFound, forbidden, gone, parseId, noNul } from '../http.js';
import { guardedPatch } from '../patch.js';
import {
  parseSpaceKey, spaceKeyOf, spaceHref, isPostSection, COMPANY_SPACE_NAME, POST_BODY_MAX,
} from '../spaces.js';

// Thread spaces (design-amendments A5): the space list, announcements and chat (space_posts), read markers and
// unread counts. Suggestions are scoped in lib/queries/suggestions.js with the same function.
//
// Authorization lives in SQL. Every list, read and write filters with tb_can_read_space(viewer, scope, office,
// team) in the same statement (lib/schema/threads.js), and moderation with tb_can_moderate_space. A space the
// viewer can't read answers exactly like a missing one (404 'Space not found'); a post in such a space is
// "gone". Archived offices and teams (or a team in an archived office) are read-only for everyone but admins.
//
// Masking happens HERE, in SQL: a removed post (the author's soft delete, or a moderator's hide seen by anyone
// who isn't a moderator of that space) comes back with an empty body and no author, and only when it still has
// visible replies ("Message removed"); otherwise it is left out. Moderators see hidden posts in full, flagged
// hidden, so they can unhide them.

const cache = typeof React.cache === 'function' ? React.cache : (fn) => fn;

const idOrNull = (v) => (v == null ? null : String(v));
const iso = (v) => {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};
const has = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);

export const ARCHIVED_MESSAGE = 'This space is archived, so it’s read-only.';
const archivedError = () => new HttpError(409, ARCHIVED_MESSAGE, { code: 'archived' });
export const spaceNotFound = () => notFound('Space not found');

// ---------------------------------------------------------------- SQL fragments (constants, never input)

// The space exists. sc / of / tm are SQL expressions for scope, office_id and team_id.
const existsSql = (sc, of, tm) => `(CASE ${sc}
    WHEN 'company' THEN true
    WHEN 'office' THEN EXISTS (SELECT 1 FROM offices ex WHERE ex.id = ${of})
    WHEN 'team' THEN EXISTS (SELECT 1 FROM teams ext WHERE ext.id = ${tm})
    ELSE false END)`;
// The space takes posts: CAGE always; an office while it isn't archived; a team while neither it nor its office is.
const openSql = (sc, of, tm) => `(CASE ${sc}
    WHEN 'company' THEN true
    WHEN 'office' THEN COALESCE((SELECT NOT ox.archived FROM offices ox WHERE ox.id = ${of}), false)
    WHEN 'team' THEN COALESCE((SELECT NOT (tx.archived OR COALESCE(tox.archived, false)) FROM teams tx
                               LEFT JOIN offices tox ON tox.id = tx.office_id WHERE tx.id = ${tm}), false)
    ELSE false END)`;
// Writable for the viewer uid: open, or the viewer is an admin (level 9).
export const writableSql = (uid, sc, of, tm) => `(${openSql(sc, of, tm)} OR COALESCE(tb_user_level(${uid}), 0) >= 9)`;

// One post as every reader sees it. $1 is always the viewer id. mz.moderator = the viewer moderates this post's
// space; rz.removed = deleted, or hidden from a non-moderator; rc.n = replies this viewer sees; wz.writable = the
// viewer may write in this post's space. author_listed: the author's profile opens for this viewer (rule 51, as in
// lib/queries/suggestions.js): not a disabled or zz_ account, or the viewer is that author or an admin; when
// false the name shows without a /people link (NameLabel listed: false).
const POST_FROM = `space_posts p
  CROSS JOIN LATERAL (SELECT tb_can_moderate_space($1::bigint, p.scope, p.office_id, p.team_id) AS moderator) mz
  CROSS JOIN LATERAL (SELECT (p.deleted_at IS NOT NULL OR (p.hidden_at IS NOT NULL AND NOT mz.moderator)) AS removed) rz
  CROSS JOIN LATERAL (SELECT count(*)::int AS n FROM space_posts rr
                      WHERE rr.parent_id = p.id AND rr.deleted_at IS NULL AND (rr.hidden_at IS NULL OR mz.moderator)) rc
  CROSS JOIN LATERAL (SELECT ${writableSql('$1::bigint', 'p.scope', 'p.office_id', 'p.team_id')} AS writable) wz
  LEFT JOIN users u ON u.id = p.author_id AND NOT rz.removed
  LEFT JOIN departments d ON d.id = u.department_id AND NOT d.archived`;
const POST_COLS = `p.id, p.scope, p.office_id, p.team_id, p.section, p.parent_id, p.pinned, p.created_at, p.edited_at,
  (p.hidden_at IS NOT NULL) AS hidden, mz.moderator, rz.removed, rc.n AS reply_count, wz.writable,
  CASE WHEN rz.removed THEN '' ELSE p.body END AS body,
  COALESCE(NOT rz.removed AND p.author_id = $1::bigint, false) AS mine,
  u.id AS author_id, u.username AS author_username, COALESCE(NULLIF(u.display_name, ''), u.username) AS author_name,
  u.avatar_v AS author_avatar_v, (u.identity_verified_at IS NOT NULL) AS author_verified,
  (u.id = $1::bigint OR (u.disabled_at IS NULL AND u.username NOT LIKE 'zz!_%' ESCAPE '!')
     OR EXISTS (SELECT 1 FROM users va WHERE va.id = $1::bigint AND va.is_admin AND va.disabled_at IS NULL)) AS author_listed,
  d.name AS author_dept_name, d.color AS author_dept_color`;
const CAN_READ = `tb_can_read_space($1::bigint, p.scope, p.office_id, p.team_id)`;

// Pages of ONE space pick their ids first with plain column tests (the viewer's rights computed once, in ctx) and
// only then shape those rows through POST_FROM, so a long chat history never runs the per-row rights for every
// post before the LIMIT. $1 = viewer, $2 / $3 / $4 = the space's scope, office_id and team_id, $5 = section.
const CTX = `ctx AS (SELECT tb_can_read_space($1::bigint, $2::text, $3::bigint, $4::bigint) AS rd,
                            tb_can_moderate_space($1::bigint, $2::text, $3::bigint, $4::bigint) AS md)`;
// The row filter for one space (constant per scope; the CHECK keeps the other id NULL).
const IN_SPACE = {
  company: `p.scope = 'company'`,
  office: `p.scope = 'office' AND p.office_id = $3::bigint`,
  team: `p.scope = 'team' AND p.team_id = $4::bigint`,
};
// Visible to this viewer: not deleted, and not hidden unless they moderate the space.
const VISIBLE = (a) => `(${a}.deleted_at IS NULL AND (${a}.hidden_at IS NULL OR ctx.md))`;
// A top-level post shows while it is visible, or (as "Message removed") while it still has visible replies.
const SHOWN = `(${VISIBLE('p')} OR EXISTS (SELECT 1 FROM space_posts rr WHERE rr.parent_id = p.id AND ${VISIBLE('rr')}))`;
const PINNED_NOW = `(p.pinned AND ${VISIBLE('p')})`;
// One page: ids chosen by `where` in `order`, at most `limit` (a parameter placeholder), then shaped.
const pageSql = (scope, where, order, limit) => `WITH ${CTX},
ids AS (SELECT p.id FROM space_posts p CROSS JOIN ctx
        WHERE ctx.rd AND ${IN_SPACE[scope]} AND p.section = $5::text AND ${where}
        ORDER BY ${order} LIMIT ${limit})
SELECT ${POST_COLS} FROM ${POST_FROM} WHERE p.id IN (SELECT ids.id FROM ids) AND ${CAN_READ} ORDER BY ${order}`;

// ---------------------------------------------------------------- shapes

function shapeAuthor(r) {
  if (r.author_id == null) return null;
  return {
    id: String(r.author_id),
    name: r.author_name || r.author_username || '',
    username: r.author_username || '',
    avatar_v: r.author_avatar_v != null ? String(r.author_avatar_v) : null,
    identity_verified: !!r.author_verified,
    listed: r.author_listed !== false,
    department: r.author_dept_name ? { name: r.author_dept_name, color: r.author_dept_color || '#5B5859' } : null,
  };
}

// The post as the client sees it (A5.5): id, author, body, created_at, edited_at, pinned, mine, can_edit,
// can_moderate, removed, plus space, section, parent_id, reply_count, hidden (moderators only), can_delete, can_pin.
export function shapePost(r) {
  const removed = !!r.removed;
  const writable = !!r.writable;
  const moderator = !!r.moderator;
  const mine = !removed && !!r.mine;
  const top = r.parent_id == null;
  const announcement = r.section === 'announcements';
  return {
    id: String(r.id),
    space: spaceKeyOf({ scope: r.scope, office_id: idOrNull(r.office_id), team_id: idOrNull(r.team_id) }),
    section: r.section,
    parent_id: idOrNull(r.parent_id),
    author: removed ? null : shapeAuthor(r),
    body: removed ? '' : (r.body ?? ''),
    created_at: iso(r.created_at),
    edited_at: removed ? null : iso(r.edited_at),
    pinned: !removed && !!r.pinned,
    mine,
    removed,
    hidden: !removed && !!r.hidden,                       // true only for a moderator looking at a hidden post
    reply_count: Number(r.reply_count) || 0,
    can_edit: mine && writable && !r.hidden,
    can_delete: mine && writable,
    can_moderate: moderator && writable && !removed,
    can_pin: moderator && writable && !removed && announcement && top,
  };
}

// ---------------------------------------------------------------- spaces

// The space for a key, as this viewer may use it, or null when the key is malformed, the office or team doesn't
// exist, or the viewer can't read it (one answer for all three).
//   { key, scope, office_id, team_id, name, office_name, href, archived, my_role, can_post, can_moderate }
//   office_id / office_name: for a team space, the team's office (the key itself carries only the team).
export async function resolveSpace(viewer, key) {
  const s = typeof key === 'string' ? parseSpaceKey(key) : key;
  if (!s || !s.scope) return null;
  const r = await query(
    `SELECT k.scope, o.name AS office_name, t.name AS team_name, t.office_id AS team_office_id, tof.name AS team_office_name,
            CASE k.scope WHEN 'company' THEN false WHEN 'office' THEN o.archived
                 ELSE (t.archived OR COALESCE(tof.archived, false)) END AS archived,
            tb_can_moderate_space($1::bigint, k.scope, k.office_id, k.team_id) AS moderator,
            (COALESCE(tb_user_level($1::bigint), 0) >= 9) AS admin,
            (SELECT m.role FROM team_members m WHERE k.scope = 'team' AND m.team_id = k.team_id AND m.user_id = $1::bigint
               AND m.removed_at IS NULL) AS my_role
     FROM (SELECT $2::text AS scope, $3::bigint AS office_id, $4::bigint AS team_id) k
     LEFT JOIN offices o ON k.scope = 'office' AND o.id = k.office_id
     LEFT JOIN teams t ON k.scope = 'team' AND t.id = k.team_id
     LEFT JOIN offices tof ON tof.id = t.office_id
     WHERE tb_can_read_space($1::bigint, k.scope, k.office_id, k.team_id)
       AND (k.scope = 'company' OR o.id IS NOT NULL OR t.id IS NOT NULL)`,
    [String(viewer.id), s.scope, s.office_id, s.team_id]);
  const x = r.rows[0];
  if (!x) return null;
  const archived = !!x.archived;
  const writable = !archived || !!x.admin;
  const name = s.scope === 'company' ? COMPANY_SPACE_NAME : s.scope === 'office' ? x.office_name : x.team_name;
  return {
    key: s.key,
    scope: s.scope,
    office_id: s.scope === 'team' ? idOrNull(x.team_office_id) : s.office_id,
    team_id: s.team_id,
    name: name || '',
    office_name: s.scope === 'team' ? (x.team_office_name || null) : s.scope === 'office' ? (x.office_name || null) : null,
    href: spaceHref(s),
    archived,
    my_role: x.my_role || null,
    can_post: writable,
    can_moderate: !!x.moderator && writable,
  };
}

// The same, or 404 'Space not found'.
export async function requireSpace(viewer, key) {
  const sp = await resolveSpace(viewer, key);
  if (!sp) throw spaceNotFound();
  return sp;
}
// The scope triple of a resolved space, for the page parameters ($2, $3, $4).
const triple = (sp) => [sp.scope, sp.scope === 'office' ? sp.office_id : null, sp.scope === 'team' ? sp.team_id : null];

// Unread counts for the viewer, per (space_key, section), in spaces the viewer can read (A5.5). A post counts
// when someone else wrote it after the viewer's last read of that section and after the viewer's floor: the later
// of their account's creation and Release 2's first migration (schema_meta release2_at), so nobody starts with
// history marked unread. Deleted and hidden posts never count; announcement replies count in announcements;
// suggestions count new suggestions and new replies (votes don't). $1 = viewer id.
// Shape: every readable space x section gets its threshold (since), then one range count per pair on the
// space_posts (scope, office_id, team_id, section, created_at) index, so the cost follows the unread rows, not the
// whole history (the shell's nav runs this on every page). Rows with n = 0 are left out.
export const UNREAD_SQL = `
WITH f AS (
  SELECT GREATEST(u.created_at,
           COALESCE((SELECT to_timestamp(m.value::double precision / 1000) FROM schema_meta m
                     WHERE m.key = 'release2_at' AND m.value ~ '^[0-9]{1,15}$'), '-infinity'::timestamptz)) AS floor
  FROM users u WHERE u.id = $1::bigint),
sp AS (
  SELECT 'company'::text AS space_key, 'company'::text AS scope, NULL::bigint AS office_id, NULL::bigint AS team_id
  UNION ALL
  SELECT 'office:' || o.id::text, 'office'::text, o.id, NULL::bigint FROM offices o
  UNION ALL
  SELECT 'team:' || t.id::text, 'team'::text, NULL::bigint, t.id FROM teams t),
vis AS (SELECT sp.* FROM sp WHERE tb_can_read_space($1::bigint, sp.scope, sp.office_id, sp.team_id)),
th AS (
  SELECT vis.space_key, vis.scope, vis.office_id, vis.team_id, x.section,
         GREATEST(f.floor, COALESCE(r.last_read_at, '-infinity'::timestamptz)) AS since
  FROM vis CROSS JOIN f
  CROSS JOIN (VALUES ('announcements'::text), ('suggestions'::text), ('chat'::text)) AS x(section)
  LEFT JOIN space_reads r ON r.user_id = $1::bigint AND r.space_key = vis.space_key AND r.section = x.section),
n AS (
  SELECT th.space_key, th.section, (CASE
    WHEN th.section = 'suggestions' THEN
        (SELECT count(*) FROM suggestions s
         WHERE s.scope = th.scope AND s.office_id IS NOT DISTINCT FROM th.office_id AND s.team_id IS NOT DISTINCT FROM th.team_id
           AND s.created_at > th.since AND s.hidden_at IS NULL AND s.user_id IS DISTINCT FROM $1::bigint)
      + (SELECT count(*) FROM suggestion_replies r JOIN suggestions s ON s.id = r.suggestion_id
         WHERE s.scope = th.scope AND s.office_id IS NOT DISTINCT FROM th.office_id AND s.team_id IS NOT DISTINCT FROM th.team_id
           AND r.created_at > th.since AND r.hidden_at IS NULL AND s.hidden_at IS NULL AND r.user_id IS DISTINCT FROM $1::bigint)
    WHEN th.scope = 'company' THEN
        (SELECT count(*) FROM space_posts p
         WHERE p.scope = 'company' AND p.office_id IS NULL AND p.team_id IS NULL AND p.section = th.section
           AND p.created_at > th.since AND p.deleted_at IS NULL AND p.hidden_at IS NULL AND p.author_id IS DISTINCT FROM $1::bigint)
    WHEN th.scope = 'office' THEN
        (SELECT count(*) FROM space_posts p
         WHERE p.scope = 'office' AND p.office_id = th.office_id AND p.team_id IS NULL AND p.section = th.section
           AND p.created_at > th.since AND p.deleted_at IS NULL AND p.hidden_at IS NULL AND p.author_id IS DISTINCT FROM $1::bigint)
    ELSE
        (SELECT count(*) FROM space_posts p
         WHERE p.scope = 'team' AND p.office_id IS NULL AND p.team_id = th.team_id AND p.section = th.section
           AND p.created_at > th.since AND p.deleted_at IS NULL AND p.hidden_at IS NULL AND p.author_id IS DISTINCT FROM $1::bigint)
    END)::int AS n
  FROM th)
SELECT n.space_key, n.section, n.n FROM n WHERE n.n > 0`;

const emptyUnread = () => ({ announcements: 0, suggestions: 0, chat: 0 });
// UNREAD_SQL rows -> { byKey: Map(key -> { announcements, suggestions, chat }), total }
export function foldUnread(rows) {
  const byKey = new Map();
  let total = 0;
  for (const r of rows || []) {
    const n = Number(r.n) || 0;
    if (!byKey.has(r.space_key)) byKey.set(r.space_key, emptyUnread());
    const u = byKey.get(r.space_key);
    if (r.section in u) { u[r.section] += n; total += n; }
  }
  return { byKey, total };
}
// The lazy query for a batch (lib/queries/nav.js adds it to the shell's batch).
export const unreadQuery = (viewer) => query(UNREAD_SQL, [String(viewer.id)]);

const OFFICES_SQL = `
SELECT o.id, o.name, o.position, o.archived,
       (o.id IN (SELECT tb_user_office_ids($1::bigint))) AS mine,
       (EXISTS (SELECT 1 FROM space_posts p WHERE p.scope = 'office' AND p.office_id = o.id
                  AND p.deleted_at IS NULL AND p.hidden_at IS NULL)
        OR EXISTS (SELECT 1 FROM suggestions s WHERE s.scope = 'office' AND s.office_id = o.id AND s.hidden_at IS NULL))
         AS has_posts
FROM offices o
WHERE tb_can_read_space($1::bigint, 'office', o.id, NULL::bigint)
ORDER BY o.position ASC, o.id ASC`;
const TEAMS_SQL = `
SELECT t.id, t.name, t.position, t.office_id, o.name AS office_name, o.position AS office_position,
       (t.archived OR COALESCE(o.archived, false)) AS archived,
       (SELECT m.role FROM team_members m WHERE m.team_id = t.id AND m.user_id = $1::bigint AND m.removed_at IS NULL)
         AS my_role,
       (EXISTS (SELECT 1 FROM space_posts p WHERE p.scope = 'team' AND p.team_id = t.id
                  AND p.deleted_at IS NULL AND p.hidden_at IS NULL)
        OR EXISTS (SELECT 1 FROM suggestions s WHERE s.scope = 'team' AND s.team_id = t.id AND s.hidden_at IS NULL))
         AS has_posts
FROM teams t LEFT JOIN offices o ON o.id = t.office_id
WHERE tb_can_read_space($1::bigint, 'team', NULL::bigint, t.id)
ORDER BY t.position ASC, t.id ASC`;

// listSpaces(viewer) -> { spaces: [...], unread_total }   (GET /api/spaces, the /threads list, the Home widget)
// Each space: { key, scope, office_id, team_id, name, parent_key, archived, unread: { announcements, suggestions,
//   chat }, href, office_name, mine, my_role }.
//   Order: CAGE first; then my offices (home first, then extra offices by position), each followed by the team
//   spaces I can read in it; then (L4 and admins) the other offices with their teams; then any team space whose
//   office isn't listed (a roster team in an office I can't read, or an archived office left out).
//   Team spaces carry their team's office in office_id / office_name, and parent_key is always that office's key
//   (whether or not the office itself is listed; the client checks). Archived offices and teams are left out
//   unless they have posts or suggestions.
//   mine: my home or extra office / my active roster team.
export const listSpaces = cache(async (viewer) => {
  const uid = String(viewer.id);
  const res = await transaction([
    query(OFFICES_SQL, [uid]),
    query(TEAMS_SQL, [uid]),
    query(UNREAD_SQL, [uid]),
  ], { readOnly: true });
  const [offices, teams, unreadRows] = res.map((r) => r.rows);
  const { byKey, total } = foldUnread(unreadRows);
  const unreadOf = (key) => ({ ...(byKey.get(key) || emptyUnread()) });
  const keep = (x) => !x.archived || !!x.has_posts;

  const officeSpace = (o) => ({
    key: `office:${o.id}`, scope: 'office', office_id: String(o.id), team_id: null, name: o.name || '',
    parent_key: null, archived: !!o.archived, unread: unreadOf(`office:${o.id}`), href: `/threads/office/${o.id}`,
    office_name: o.name || '', mine: !!o.mine, my_role: null,
  });
  const teamSpace = (t) => ({
    key: `team:${t.id}`, scope: 'team', office_id: idOrNull(t.office_id), team_id: String(t.id), name: t.name || '',
    parent_key: t.office_id != null ? `office:${t.office_id}` : null, archived: !!t.archived,
    unread: unreadOf(`team:${t.id}`), href: `/threads/team/${t.id}`,
    office_name: t.office_name || null, mine: !!t.my_role, my_role: t.my_role || null,
  });

  const out = [{
    key: 'company', scope: 'company', office_id: null, team_id: null, name: COMPANY_SPACE_NAME, parent_key: null,
    archived: false, unread: unreadOf('company'), href: '/threads/cage', office_name: null, mine: true, my_role: null,
  }];
  const listedOffices = offices.filter(keep);
  const listedTeams = teams.filter(keep);
  const home = idOrNull(viewer.office_id);
  const mineFirst = listedOffices.filter((o) => o.mine)
    .sort((a, b) => (String(b.id) === home) - (String(a.id) === home));            // stable: home, then by position
  const others = listedOffices.filter((o) => !o.mine);
  const placed = new Set();
  for (const o of [...mineFirst, ...others]) {
    const sp = officeSpace(o);
    out.push(sp);
    for (const t of listedTeams) {
      if (String(t.office_id) !== String(o.id)) continue;
      out.push(teamSpace(t));
      placed.add(String(t.id));
    }
  }
  const orphans = listedTeams.filter((t) => !placed.has(String(t.id)))
    .sort((a, b) => (Number(a.office_position) - Number(b.office_position)) || (Number(a.office_id) - Number(b.office_id))
      || (Number(a.position) - Number(b.position)) || (Number(a.id) - Number(b.id)));
  for (const t of orphans) out.push(teamSpace(t));
  return { spaces: out, unread_total: total };
});

// The space plus its own unread counts (the space page header and its tabs), or null (missing or not readable).
export const loadSpace = cache(async (viewer, key) => {
  const sp = await resolveSpace(viewer, key);
  if (!sp) return null;
  const r = await query(`SELECT * FROM (${UNREAD_SQL}) z WHERE z.space_key = $2::text`, [String(viewer.id), sp.key]);
  const { byKey } = foldUnread(r.rows);
  return { ...sp, unread: { ...(byKey.get(sp.key) || emptyUnread()) } };
});

// The total for the header badge (A5.5 nav threads_unread).
export async function unreadTotal(viewer) {
  const r = await unreadQuery(viewer);
  return foldUnread(r.rows).total;
}

// ---------------------------------------------------------------- posts: reads

const clampLimit = (v, dflt, max) => {
  if (v == null || v === '') return dflt;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw bad('Invalid limit.');
  return Math.min(n, max);
};
const idParam = (v) => (v == null || v === '' ? null : parseId(v));
const DAY_MS = 24 * 3600 * 1000;
const CHANGED_SINCE_MIN = Date.UTC(2000, 0, 1);

// The latest `n` visible replies of each announcement in ids, oldest first within each parent.
async function lastReplies(viewer, ids, n) {
  if (!ids.length) return new Map();
  const r = await query(
    `SELECT * FROM (
       SELECT ${POST_COLS}, row_number() OVER (PARTITION BY p.parent_id ORDER BY p.id DESC) AS rn
       FROM ${POST_FROM}
       WHERE p.parent_id = ANY($2::bigint[]) AND NOT rz.removed AND ${CAN_READ}) z
     WHERE z.rn <= $3::int
     ORDER BY z.parent_id ASC, z.id ASC`,
    [String(viewer.id), ids, n]);
  const out = new Map();
  for (const row of r.rows) {
    const k = String(row.parent_id);
    if (!out.has(k)) out.set(k, []);
    out.get(k).push(shapePost(row));
  }
  return out;
}

// GET /api/spaces/posts (A5.5). sp = a resolved space (resolveSpace). opts: { before, after, limit, parent_id,
// changed_since } as given in the query string (validated here).
//   announcements: newest first. The first page (no before / after) starts with every pinned announcement, then
//     `limit` (default 20, max 50) unpinned ones; `before=<id>` pages older unpinned ones; `after=<id>` returns
//     every announcement newer than that id (pinned or not). Each top-level post carries reply_count and replies
//     (its latest 3 visible replies, oldest first).
//     parent_id=<announcement id>: that announcement as `parent` and ALL its visible replies, oldest first, as
//     `replies` ("N replies" expanded).
//   chat: oldest first. A page of `limit` (default 50, max 100): the latest ones, or the ones before `before=<id>`
//     (has_more = there are older ones: "Load earlier"), or the ones after `after=<id>` (polling; has_more = more
//     newer ones are waiting).
//   changed_since=<ISO time> (either section, optional; 2000 .. tomorrow, else 400): also returns `changed`, the
//     posts of this section edited, deleted, hidden, unhidden, pinned or unpinned (edited_at / deleted_at /
//     hidden_at / moderated_at) after that time, shaped like the rest (removed ones flagged removed), so a poller
//     can update or drop rows it already shows, and put back one a moderator unhid.
// -> { space, section, posts, has_more, server_time, changed? }   (parent_id: { space, section, parent, replies,
//    server_time }). server_time = the database clock minus 10 s, to pass back as changed_since.
export async function listPosts(viewer, sp, section, opts = {}) {
  if (!isPostSection(section)) throw bad('Pick announcements or chat.');
  const uid = String(viewer.id);
  const [scope, office, team] = triple(sp);
  const before = idParam(opts.before);
  const after = idParam(opts.after);
  const parent = idParam(opts.parent_id);
  if (before && after) throw bad('Use before or after, not both.');
  let since = null;
  if (opts.changed_since != null && opts.changed_since !== '') {
    // A server_time we handed out: anything outside 2000 .. tomorrow is crafted (and the JavaScript date limits
    // are outside Postgres' timestamptz range, 22009), so 400 rather than a database error.
    const t = Date.parse(String(opts.changed_since));
    if (!Number.isFinite(t) || t < CHANGED_SINCE_MIN || t > Date.now() + DAY_MS) throw bad('Invalid changed_since.');
    since = new Date(t).toISOString();
  }
  const base = [uid, scope, office, team, section];
  const timeQ = query(`SELECT now() - interval '10 seconds' AS t`);
  // moderated_at: the last hide, unhide, pin or unpin, so an unhidden post (hidden_at back to NULL) is listed too.
  const changedQ = since ? query(
    pageSql(scope, `GREATEST(p.edited_at, p.deleted_at, p.hidden_at, p.moderated_at) > $6::timestamptz`, 'p.id ASC', '200'),
    [...base, since]) : null;

  if (section === 'announcements' && parent) {
    const res = await transaction([
      query(pageSql(scope, `p.id = $6::bigint AND p.parent_id IS NULL AND ${SHOWN}`, 'p.id ASC', '1'), [...base, parent]),
      timeQ,
    ], { readOnly: true });
    const row = res[0].rows[0];
    if (!row) throw new HttpError(404, 'That announcement was removed.');
    const replies = (await lastReplies(viewer, [String(row.id)], 100000)).get(String(row.id)) || [];
    return { space: sp, section, parent: shapePost(row), replies, server_time: iso(res[1].rows[0]?.t) };
  }

  if (section === 'announcements') {
    const limit = clampLimit(opts.limit, 20, 50);
    const top = `p.parent_id IS NULL AND ${SHOWN}`;
    const qs = [];
    if (after) {
      qs.push(query(pageSql(scope, `${top} AND p.id > $6::bigint`, 'p.id DESC', '$7::int'), [...base, after, limit + 1]));
    } else {
      qs.push(query(pageSql(scope, `${top} AND NOT ${PINNED_NOW} AND ($6::bigint IS NULL OR p.id < $6::bigint)`,
        'p.id DESC', '$7::int'), [...base, before, limit + 1]));
    }
    const pinnedQ = !after && !before
      ? query(pageSql(scope, `${top} AND ${PINNED_NOW}`, 'p.id DESC', '100'), base)
      : null;
    const res = await transaction([...qs, ...(pinnedQ ? [pinnedQ] : []), timeQ, ...(changedQ ? [changedQ] : [])],
      { readOnly: true });
    let i = 0;
    const main = res[i++].rows;
    const pinned = pinnedQ ? res[i++].rows : [];
    const time = res[i++].rows[0]?.t;
    const changed = changedQ ? res[i++].rows.map(shapePost) : undefined;
    const hasMore = main.length > limit;
    const rows = [...pinned, ...main.slice(0, limit)];
    const posts = rows.map(shapePost);
    const replies = await lastReplies(viewer, posts.filter((p) => p.reply_count > 0).map((p) => p.id), 3);
    for (const p of posts) p.replies = replies.get(p.id) || [];
    return { space: sp, section, posts, has_more: hasMore, server_time: iso(time), ...(changed ? { changed } : {}) };
  }

  // chat
  const limit = clampLimit(opts.limit, 50, 100);
  const visible = `p.parent_id IS NULL AND ${VISIBLE('p')}`;
  const mainQ = after
    ? query(pageSql(scope, `${visible} AND p.id > $6::bigint`, 'p.id ASC', '$7::int'), [...base, after, limit + 1])
    : query(pageSql(scope, `${visible} AND ($6::bigint IS NULL OR p.id < $6::bigint)`, 'p.id DESC', '$7::int'),
      [...base, before, limit + 1]);
  const res = await transaction([mainQ, timeQ, ...(changedQ ? [changedQ] : [])], { readOnly: true });
  const rows = res[0].rows;
  const hasMore = rows.length > limit;
  let page = rows.slice(0, limit);
  if (!after) page = page.reverse();                                   // newest-first query -> oldest first
  const changed = changedQ ? res[2].rows.map(shapePost) : undefined;
  return {
    space: sp, section, posts: page.map(shapePost), has_more: hasMore, server_time: iso(res[1].rows[0]?.t),
    ...(changed ? { changed } : {}),
  };
}

// One post for the viewer (shaped; removed ones flagged), or null when it doesn't exist or its space isn't readable.
export async function loadPost(viewer, id) {
  const r = await query(`SELECT ${POST_COLS} FROM ${POST_FROM} WHERE p.id = $2::bigint AND ${CAN_READ}`,
    [String(viewer.id), String(id)]);
  return r.rows[0] ? shapePost(r.rows[0]) : null;
}

// The latest announcements across every space the viewer reads (the Home widgets), newest first, with the space
// they belong to: [{ ...post, space_info: { key, name, href } }]. Removed posts are left out.
export const latestAnnouncements = cache(async (viewer, limit = 5) => {
  const n = Math.max(1, Math.min(Number(limit) || 5, 20));
  // Ids first (cheap column tests plus the read right), then only those rows go through the shaping laterals.
  const r = await query(
    `WITH ids AS (SELECT q.id FROM space_posts q
                  WHERE q.section = 'announcements' AND q.parent_id IS NULL AND q.deleted_at IS NULL
                    AND q.hidden_at IS NULL AND tb_can_read_space($1::bigint, q.scope, q.office_id, q.team_id)
                  ORDER BY q.id DESC LIMIT $2::int)
     SELECT ${POST_COLS},
            CASE p.scope WHEN 'company' THEN $3::text WHEN 'office' THEN so.name ELSE st.name END AS space_name
     FROM ${POST_FROM}
     LEFT JOIN offices so ON so.id = p.office_id
     LEFT JOIN teams st ON st.id = p.team_id
     WHERE p.id IN (SELECT ids.id FROM ids) AND NOT rz.removed AND ${CAN_READ}
     ORDER BY p.id DESC`,
    [String(viewer.id), n, COMPANY_SPACE_NAME]);
  return r.rows.map((row) => {
    const post = shapePost(row);
    return { ...post, space_info: { key: post.space, name: row.space_name || '', href: spaceHref(post.space) } };
  });
});

// Home: { spaces, unread_total, announcements } in two round trips.
export const loadThreadsHome = cache(async (viewer, { announcements = 5 } = {}) => {
  const [list, latest] = await Promise.all([listSpaces(viewer), latestAnnouncements(viewer, announcements)]);
  return { spaces: list.spaces, unread_total: list.unread_total, announcements: latest };
});

// ---------------------------------------------------------------- posts: writes

// Body normalization, the SAME function for the stored value and the client's base (lib/patch.js): line endings
// become \n, leading blank lines and trailing whitespace go, everything else (indentation, %t / %h / - markup)
// stays. Capped so a base can never exceed the column.
const capChars = (s, max) => {
  if (s.length <= max) return s;
  let out = s.slice(0, max);
  const last = out.charCodeAt(out.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) out = out.slice(0, -1);
  return out;
};
// A NUL character can never be stored (Postgres TEXT), so normalization drops it: a base that carries one compares
// like the stored text. A new body with one is refused instead (postBody), so nothing is silently changed.
const cleanBody = (v) => (v == null ? '' : String(v)).replace(/\u0000/g, '').replace(/\r\n?/g, '\n').replace(/^(?:[ \t]*\n)+/, '').replace(/\s+$/, '');
export const normBody = (v) => capChars(cleanBody(v), POST_BODY_MAX);
// A body from a request: a non-empty string of at most 10,000 characters after normalization, without NUL
// characters, else 400.
export function postBody(v) {
  if (typeof v !== 'string') throw bad('Write something first.');
  noNul(v);
  const s = cleanBody(v);
  if (!s.trim()) throw bad('Write something first.');
  if (s.length > POST_BODY_MAX) throw bad('That’s too long (10,000 characters at most).');
  return s;
}

// The facts the write paths check first: the post, its space's rights for this viewer. null when the post doesn't
// exist or its space isn't readable (one answer for both).
export async function postMeta(viewer, id) {
  const r = await query(
    `SELECT p.id, p.scope, p.office_id, p.team_id, p.section, p.parent_id, p.author_id, p.pinned,
            (p.deleted_at IS NOT NULL) AS deleted, (p.hidden_at IS NOT NULL) AS hidden,
            tb_can_moderate_space($1::bigint, p.scope, p.office_id, p.team_id) AS moderator,
            ${writableSql('$1::bigint', 'p.scope', 'p.office_id', 'p.team_id')} AS writable
     FROM space_posts p WHERE p.id = $2::bigint AND ${CAN_READ}`,
    [String(viewer.id), String(id)]);
  const x = r.rows[0];
  if (!x) return null;
  return {
    id: String(x.id), scope: x.scope, office_id: idOrNull(x.office_id), team_id: idOrNull(x.team_id), section: x.section,
    parent_id: idOrNull(x.parent_id), author_id: idOrNull(x.author_id), pinned: !!x.pinned, deleted: !!x.deleted,
    hidden: !!x.hidden, moderator: !!x.moderator, writable: !!x.writable,
  };
}

// POST /api/spaces/posts { space, section, body, parent_id? } -> the new post (shaped).
//   Anyone who can read the space posts in announcements and chat (A5.4); a reply (parent_id) goes under a
//   top-level announcement of the same space that isn't deleted or hidden. One statement re-checks the read
//   right, the space's existence and that it isn't archived (admins excepted), and the parent.
export async function createPost(viewer, b) {
  if (!b || typeof b !== 'object') throw bad();
  const section = b.section;
  if (!isPostSection(section)) throw bad('Pick announcements or chat.');
  const parent = idParam(b.parent_id);
  if (parent && section !== 'announcements') throw bad('Only announcements take replies.');
  const text = postBody(b.body);
  const sp = await requireSpace(viewer, b.space);
  if (!sp.can_post) throw archivedError();
  const uid = String(viewer.id);
  const [scope, office, team] = triple(sp);
  const r = await query(
    `WITH ok AS (
       SELECT 1 AS x WHERE tb_can_read_space($1::bigint, $2::text, $3::bigint, $4::bigint)
         AND ${existsSql('$2::text', '$3::bigint', '$4::bigint')}
         AND ${writableSql('$1::bigint', '$2::text', '$3::bigint', '$4::bigint')}
         AND ($6::bigint IS NULL OR EXISTS (
               SELECT 1 FROM space_posts q WHERE q.id = $6::bigint AND q.parent_id IS NULL
                 AND q.section = 'announcements' AND q.scope = $2::text AND q.office_id IS NOT DISTINCT FROM $3::bigint
                 AND q.team_id IS NOT DISTINCT FROM $4::bigint AND q.deleted_at IS NULL AND q.hidden_at IS NULL)))
     INSERT INTO space_posts (scope, office_id, team_id, section, parent_id, author_id, body)
     SELECT $2::text, $3::bigint, $4::bigint, $5::text, $6::bigint, $1::bigint, $7::text FROM ok
     RETURNING id`,
    [uid, scope, office, team, section, parent, text]);
  const id = r.rows[0]?.id;
  if (id == null) {
    // Nothing inserted: tell the cases apart (the space checks again, then the parent).
    const again = await resolveSpace(viewer, sp.key);
    if (!again) throw spaceNotFound();
    if (!again.can_post) throw archivedError();
    if (parent) throw new HttpError(404, 'That announcement was removed.');
    throw spaceNotFound();
  }
  const post = await loadPost(viewer, id);
  if (post && section === 'announcements' && !parent) post.replies = [];
  return post;
}

// PATCH /api/space-posts/:id { body, base } (the author; base-compared via lib/patch.js, 409 on a stale base)
//   or { pinned } / { hidden } (moderators; pinned on top-level announcements only; last write wins; each one
//   stamps moderated_at, so pollers' changed_since sees an unhide, which leaves hidden_at NULL).
// -> the stored post (shaped).
export async function patchPost({ viewer, id, body: b, now }) {
  const pid = parseId(id);
  if (!b || typeof b !== 'object') throw bad();
  const editing = has(b, 'body');
  const moderating = has(b, 'pinned') || has(b, 'hidden');
  if (editing && moderating) throw bad('Edit the text and pin or hide in separate requests.');
  if (!editing && !moderating) {
    const cur = await loadPost(viewer, pid);
    if (!cur) throw gone();
    return cur;
  }
  const meta = await postMeta(viewer, pid);
  if (!meta || meta.deleted || (meta.hidden && !meta.moderator)) throw gone();
  return editing ? editPost(viewer, meta, b, now) : moderatePost(viewer, meta, b);
}

async function editPost(viewer, meta, b, now) {
  const uid = String(viewer.id);
  if (meta.author_id !== uid) throw forbidden('Only the person who wrote this can edit it.');
  if (!meta.writable) throw archivedError();
  if (meta.hidden) throw new HttpError(409, 'A moderator hid this post. Unhide it before editing.');
  const text = postBody(b.body);
  const rawBase = typeof b.base === 'string' ? { body: b.base } : (b.base && typeof b.base === 'object' ? b.base : {});
  const base = has(rawBase, 'body') ? { body: rawBase.body == null ? '' : String(rawBase.body) } : {};
  if (has(base, 'body') && normBody(base.body) === text) {
    const cur = await loadPost(viewer, meta.id);                    // nothing changed: no write, no "edited"
    if (!cur) throw gone();
    return cur;
  }
  try {
    await guardedPatch({
      table: 'space_posts', id: meta.id, now, actorId: uid,
      body: { body: text, edited_at: new Date(now).toISOString(), base },
      columns: {
        body: { type: 'text', text: true, norm: normBody },
        edited_at: { type: 'timestamptz' },
      },
      // Race-safe: still the author's, not deleted or hidden, the space still readable and writable.
      scopeSql: `space_posts.author_id = $1::bigint AND space_posts.deleted_at IS NULL AND space_posts.hidden_at IS NULL
        AND tb_can_read_space($1::bigint, space_posts.scope, space_posts.office_id, space_posts.team_id)
        AND ${writableSql('$1::bigint', 'space_posts.scope', 'space_posts.office_id', 'space_posts.team_id')}`,
      scopeParams: [uid],
      notFound: gone(),
    });
  } catch (e) {
    if (e instanceof HttpError && e.status === 409 && e.extra?.current) {
      // Only the author edits a post, so a stale base means another window of theirs saved first.
      const current = await loadPost(viewer, meta.id);
      throw new HttpError(409, 'conflict', {
        message: 'You changed this in another window while you were editing.', fields: ['body'], current,
      });
    }
    throw e;
  }
  const post = await loadPost(viewer, meta.id);
  if (!post) throw gone();
  return post;
}

async function moderatePost(viewer, meta, b) {
  const uid = String(viewer.id);
  if (!meta.moderator) throw forbidden('Only moderators can pin or hide posts.');
  if (!meta.writable) throw archivedError();
  let pinned = null;
  let hidden = null;
  if (has(b, 'pinned')) {
    if (typeof b.pinned !== 'boolean') throw bad('pinned must be true or false.');
    if (meta.section !== 'announcements' || meta.parent_id != null) throw bad('Only announcements can be pinned.');
    pinned = b.pinned;
  }
  if (has(b, 'hidden')) {
    if (typeof b.hidden !== 'boolean') throw bad('hidden must be true or false.');
    hidden = b.hidden;
  }
  const r = await query(
    `WITH t AS (SELECT p.id, p.pinned AS was_pinned, (p.hidden_at IS NOT NULL) AS was_hidden FROM space_posts p
                WHERE p.id = $2::bigint AND p.deleted_at IS NULL
                  AND tb_can_moderate_space($1::bigint, p.scope, p.office_id, p.team_id)
                  AND ${writableSql('$1::bigint', 'p.scope', 'p.office_id', 'p.team_id')}
                  AND ($3::boolean IS NULL OR (p.section = 'announcements' AND p.parent_id IS NULL))
                FOR UPDATE),
     up AS (UPDATE space_posts p SET
              pinned = COALESCE($3::boolean, p.pinned),
              hidden_at = CASE WHEN $4::boolean IS NULL THEN p.hidden_at WHEN $4::boolean THEN COALESCE(p.hidden_at, now()) END,
              hidden_by = CASE WHEN $4::boolean IS NULL THEN p.hidden_by WHEN $4::boolean THEN COALESCE(p.hidden_by, $1::bigint) END,
              moderated_at = now()
            FROM t WHERE p.id = t.id RETURNING p.id),
     a AS (INSERT INTO audit_log (actor_id, action, entity, entity_id, detail)
           SELECT $1::bigint, 'space_post.moderate', 'space_posts', up.id::text,
                  jsonb_build_object('pinned', $3::boolean, 'hidden', $4::boolean,
                                     'was_pinned', t.was_pinned, 'was_hidden', t.was_hidden)
           FROM up JOIN t ON t.id = up.id)
     SELECT count(*)::int AS n FROM up`,
    [uid, meta.id, pinned, hidden]);
  if (!Number(r.rows[0]?.n)) throw gone();
  const post = await loadPost(viewer, meta.id);
  if (!post) throw gone();
  return post;
}

// DELETE /api/space-posts/:id: the author's soft delete (deleted_at). Missing, unreadable or already deleted ->
// { ok: true } with nothing to show (design §7.1, no existence leak); someone else's -> 403; archived space -> 409.
// -> { ok: true, post? } (post: the stored post, now removed or gone from lists).
export async function deletePost(viewer, id) {
  const pid = parseId(id);
  const meta = await postMeta(viewer, pid);
  if (!meta || meta.deleted) return { ok: true };
  const uid = String(viewer.id);
  if (meta.author_id !== uid) throw forbidden('Only the person who wrote this can delete it.');
  if (!meta.writable) throw archivedError();
  await query(
    `UPDATE space_posts p SET deleted_at = now()
     WHERE p.id = $2::bigint AND p.author_id = $1::bigint AND p.deleted_at IS NULL
       AND ${CAN_READ} AND ${writableSql('$1::bigint', 'p.scope', 'p.office_id', 'p.team_id')}`,
    [uid, pid]);
  const post = await loadPost(viewer, pid);
  return post ? { ok: true, post } : { ok: true };
}

// POST /api/spaces/read { space, section }: the viewer has seen this section of this space up to now (upsert,
// never backwards). -> { ok, space, section, last_read_at, unread: { announcements, suggestions, chat },
// unread_total } (the space's counts and the header total after the mark).
export async function markRead(viewer, b) {
  if (!b || typeof b !== 'object') throw bad();
  const section = b.section;
  if (!['announcements', 'suggestions', 'chat'].includes(section)) throw bad('Pick announcements, suggestions or chat.');
  const s = parseSpaceKey(b.space);
  if (!s) throw spaceNotFound();
  const uid = String(viewer.id);
  const r = await query(
    `WITH ok AS (SELECT 1 AS x WHERE tb_can_read_space($1::bigint, $2::text, $3::bigint, $4::bigint)
                   AND ${existsSql('$2::text', '$3::bigint', '$4::bigint')})
     INSERT INTO space_reads (user_id, space_key, section, last_read_at)
     SELECT $1::bigint, $5::text, $6::text, now() FROM ok
     ON CONFLICT (user_id, space_key, section)
       DO UPDATE SET last_read_at = GREATEST(space_reads.last_read_at, EXCLUDED.last_read_at)
     RETURNING last_read_at`,
    [uid, s.scope, s.office_id, s.team_id, s.key, section]);
  if (!r.rows[0]) throw spaceNotFound();
  const u = foldUnread((await unreadQuery(viewer)).rows);
  return {
    ok: true, space: s.key, section, last_read_at: iso(r.rows[0].last_read_at),
    unread: { ...(u.byKey.get(s.key) || emptyUnread()) }, unread_total: u.total,
  };
}

// ---------------------------------------------------------------- office / team delete guards

// What still belongs to an office's or a team's spaces (posts of any state, and suggestions). An office counts its
// teams' spaces too (deleting the office would delete them). -> { posts, suggestions }
export async function spaceUsage({ officeId = null, teamId = null }) {
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
  office: 'This office has thread posts; archive it instead.',
  team: 'This team has thread posts; archive it instead.',
};
