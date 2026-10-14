import 'server-only';
import * as React from 'react';
import { query, transaction } from '../db.js';
import { isAdmin, isOrganizer } from '../policy.js';
import { parseSpaceKey, spaceKeyOf } from '../spaces.js';
import { resolveSpace, writableSql } from './spaces.js';

// Suggestions (design §2.1 /suggestions, §4.5, §8.2, §13 #13; inventory §1.15, rules 27-28).
// Release 2 (design-amendments A5): every suggestion belongs to a thread space (suggestions.scope / office_id /
// team_id; the 4 pre-Release-2 ones moved to Charlotte). Every read and write filters with
// tb_can_read_space(viewer, scope, office_id, team_id) in SQL, so a suggestion in a space the viewer can't read
// answers like a missing one. Archived offices and teams are read-only for everyone but admins (409). Otherwise
// today's rules: +1 votes, optional anonymity, replies, the status rule, authors edit and delete their own, admins
// hide. The masking happens HERE, in SQL, so no
// response ever carries another person's user_id for an anonymous post or reply (rule 28):
//   - a suggestion's author fields are NULL when it is anonymous (the users row isn't even joined);
//   - a reply is anonymous when it is by the poster of an anonymous suggestion, computed at read time
//     (r.user_id = s.user_id AND s.anonymous), so toggling anonymity never de-anonymizes earlier replies;
//   - `mine` is computed per viewer on the server; voter lists are never exposed (count + own flag only).
// Hidden (admin moderation, hidden_at) suggestions and replies are left out for everyone but admins.

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

// One suggestion as the client sees it. `row` comes from SUGGESTION_SELECT (or a subset of it).
export function shapeSuggestion(r) {
  const a = author(r);
  return {
    id: String(r.id),
    space: r.scope ? spaceKeyOf({ scope: r.scope, office_id: idOrNull(r.office_id), team_id: idOrNull(r.team_id) }) : null,
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

// The read filter shared by both lists. $1 = viewer id, $3 / $4 / $5 = one space's scope, office_id and team_id
// (all NULL = every space the viewer can read), $6 = one id (or NULL).
const IN_SCOPE = `tb_can_read_space($1::bigint, s.scope, s.office_id, s.team_id)
  AND ($3::text IS NULL OR (s.scope = $3::text AND s.office_id IS NOT DISTINCT FROM $4::bigint
                            AND s.team_id IS NOT DISTINCT FROM $5::bigint))`;

// $1 = viewer id, $2 = viewer is admin (sees hidden rows), $3-$5 the space, $6 one suggestion id or NULL.
// Anonymous rows never join users.
const SUGGESTIONS_SQL = `
SELECT s.id, s.scope, s.office_id, s.team_id, s.title, s.details, s.category, s.status, s.anonymous, s.created_at,
       s.updated_at, (s.hidden_at IS NOT NULL) AS hidden,
       CASE WHEN $2::boolean AND s.hidden_at IS NOT NULL
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
WHERE (s.hidden_at IS NULL OR $2::boolean) AND ${IN_SCOPE} AND ($6::bigint IS NULL OR s.id = $6::bigint)
ORDER BY s.created_at DESC, s.id DESC`;

// Replies, oldest first. A reply's anonymity is computed here (design §13 #13). $6 = one reply id or NULL.
const REPLIES_SQL = `
WITH x AS (
  SELECT r.id, r.suggestion_id, r.user_id, r.body, r.created_at, r.hidden_at,
         COALESCE(s.anonymous AND r.user_id = s.user_id, false) AS anon
  FROM suggestion_replies r JOIN suggestions s ON s.id = r.suggestion_id
  WHERE ((s.hidden_at IS NULL AND r.hidden_at IS NULL) OR $2::boolean) AND ${IN_SCOPE}
    AND ($6::bigint IS NULL OR r.id = $6::bigint))
SELECT x.id, x.suggestion_id, x.body, x.created_at, x.anon AS anonymous, (x.hidden_at IS NOT NULL) AS hidden,
       u.id AS author_id, u.username AS author_username, u.display_name AS author_display_name,
       u.avatar_v AS author_avatar_v, (u.identity_verified_at IS NOT NULL) AS author_verified,
       ($2::boolean OR u.id = $1::bigint OR (u.disabled_at IS NULL AND u.username NOT LIKE 'zz!_%' ESCAPE '!')) AS author_listed,
       COALESCE(x.user_id = $1::bigint, false) AS mine
FROM x LEFT JOIN users u ON u.id = x.user_id AND NOT x.anon
ORDER BY x.created_at ASC, x.id ASC`;

// loadSuggestions(viewer, spaceKey) -> { suggestions, replies, canStatus, statusOpen, isAdmin, space, canPost } in
// one read-only batch, or null when spaceKey names a space the viewer can't read (or one that doesn't exist).
//   spaceKey: 'company' | 'office:<id>' | 'team:<id>' (lib/spaces.js); omitted = every space the viewer can read.
//   canStatus: this viewer may change statuses; statusOpen: everyone may (fewer than 50 active users).
//   space: the resolved space (lib/queries/spaces.js resolveSpace) or null; canPost: false in an archived space
//   (admins excepted). Each suggestion also carries its space key.
export const loadSuggestions = cache(async (viewer, spaceKey = null) => {
  let sp = null;
  if (spaceKey != null) {
    sp = await resolveSpace(viewer, spaceKey);
    if (!sp) return null;
  }
  const uid = String(viewer.id);
  const admin = isAdmin(viewer);
  const scope = sp ? [sp.scope, sp.scope === 'office' ? sp.office_id : null, sp.scope === 'team' ? sp.team_id : null]
    : [null, null, null];
  const res = await transaction([
    query(SUGGESTIONS_SQL, [uid, admin, ...scope, null]),
    query(REPLIES_SQL, [uid, admin, ...scope, null]),
    query(ACTIVE_USERS_SQL),
  ], { readOnly: true });
  const [sRows, rRows, nRows] = res.map((r) => r.rows);
  const active = Number(nRows[0]?.n || 0);
  return {
    suggestions: sRows.map(shapeSuggestion),
    replies: rRows.map(shapeReply),
    canStatus: canChangeStatus(viewer, active),
    statusOpen: active < STATUS_OPEN_LIMIT,
    isAdmin: admin,
    space: sp,
    canPost: sp ? !!sp.can_post : true,
  };
});

// The facts the write routes check before writing, for viewer v: { id, user_id, hidden, space, writable } or null
// when the suggestion doesn't exist or its space isn't readable (one answer for both).
//   writable: the space isn't archived (or v is an admin).
export async function suggestionMeta(v, id) {
  const r = await query(
    `SELECT s.id, s.user_id, (s.hidden_at IS NOT NULL) AS hidden, s.scope, s.office_id, s.team_id,
            ${writableSql('$1::bigint', 's.scope', 's.office_id', 's.team_id')} AS writable
     FROM suggestions s
     WHERE s.id = $2::bigint AND tb_can_read_space($1::bigint, s.scope, s.office_id, s.team_id)`,
    [String(v.id), String(id)]);
  const row = r.rows[0];
  if (!row) return null;
  return {
    id: String(row.id), user_id: idOrNull(row.user_id), hidden: !!row.hidden, writable: !!row.writable,
    space: spaceKeyOf({ scope: row.scope, office_id: idOrNull(row.office_id), team_id: idOrNull(row.team_id) }),
  };
}

// The same for a reply: { id, user_id, suggestion_id, hidden, suggestion_hidden, writable } or null.
export async function replyMeta(v, id) {
  const r = await query(
    `SELECT r.id, r.user_id, r.suggestion_id, (r.hidden_at IS NOT NULL) AS hidden,
            (s.hidden_at IS NOT NULL) AS suggestion_hidden,
            ${writableSql('$1::bigint', 's.scope', 's.office_id', 's.team_id')} AS writable
     FROM suggestion_replies r JOIN suggestions s ON s.id = r.suggestion_id
     WHERE r.id = $2::bigint AND tb_can_read_space($1::bigint, s.scope, s.office_id, s.team_id)`,
    [String(v.id), String(id)]);
  const row = r.rows[0];
  if (!row) return null;
  return {
    id: String(row.id), user_id: idOrNull(row.user_id), suggestion_id: String(row.suggestion_id), hidden: !!row.hidden,
    suggestion_hidden: !!row.suggestion_hidden, writable: !!row.writable,
  };
}

// One suggestion for viewer v (after a write), shaped and masked like the list. null when missing, hidden (non-
// admins) or in a space v can't read.
export async function loadSuggestion(v, id) {
  const r = await query(SUGGESTIONS_SQL, [String(v.id), isAdmin(v), null, null, null, String(id)]);
  return r.rows[0] ? shapeSuggestion(r.rows[0]) : null;
}

// One reply for viewer v, shaped and masked like the list. null when missing, hidden or not readable.
export async function loadReply(v, id) {
  const r = await query(REPLIES_SQL, [String(v.id), isAdmin(v), null, null, null, String(id)]);
  return r.rows[0] ? shapeReply(r.rows[0]) : null;
}

// The space a new suggestion goes into: { scope, office_id, team_id } of a space v can read and post in.
// body.space omitted = CAGE ('company'), which is where a suggestion went before Release 2 (old open tabs).
// A malformed key or a space v can't read -> null (the route answers 404); archived -> { archived: true }.
export async function suggestionTarget(v, spaceKey) {
  const key = spaceKey == null || spaceKey === '' ? 'company' : spaceKey;
  if (!parseSpaceKey(key)) return null;
  const sp = await resolveSpace(v, key);
  if (!sp) return null;
  if (!sp.can_post) return { archived: true, space: sp };
  return { archived: false, space: sp };
}
