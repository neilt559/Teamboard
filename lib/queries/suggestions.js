import 'server-only';
import * as React from 'react';
import { query, transaction } from '../db.js';
import { isAdmin, isOrganizer } from '../policy.js';

// Suggestions (design §2.1 /suggestions, §4.5, §8.2, §13 #13; inventory §1.15, rules 27-28).
// Company-wide: everyone reads every suggestion that isn't hidden. The masking happens HERE, in SQL, so no
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

// $1 = viewer id, $2 = viewer is admin (sees hidden rows). Anonymous rows never join users.
const SUGGESTIONS_SQL = `
SELECT s.id, s.title, s.details, s.category, s.status, s.anonymous, s.created_at, s.updated_at,
       (s.hidden_at IS NOT NULL) AS hidden,
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
WHERE s.hidden_at IS NULL OR $2::boolean
ORDER BY s.created_at DESC, s.id DESC`;

// Replies, oldest first. A reply's anonymity is computed here (design §13 #13).
const REPLIES_SQL = `
WITH x AS (
  SELECT r.id, r.suggestion_id, r.user_id, r.body, r.created_at, r.hidden_at,
         COALESCE(s.anonymous AND r.user_id = s.user_id, false) AS anon
  FROM suggestion_replies r JOIN suggestions s ON s.id = r.suggestion_id
  WHERE (s.hidden_at IS NULL AND r.hidden_at IS NULL) OR $2::boolean)
SELECT x.id, x.suggestion_id, x.body, x.created_at, x.anon AS anonymous, (x.hidden_at IS NOT NULL) AS hidden,
       u.id AS author_id, u.username AS author_username, u.display_name AS author_display_name,
       u.avatar_v AS author_avatar_v, (u.identity_verified_at IS NOT NULL) AS author_verified,
       ($2::boolean OR u.id = $1::bigint OR (u.disabled_at IS NULL AND u.username NOT LIKE 'zz!_%' ESCAPE '!')) AS author_listed,
       COALESCE(x.user_id = $1::bigint, false) AS mine
FROM x LEFT JOIN users u ON u.id = x.user_id AND NOT x.anon
ORDER BY x.created_at ASC, x.id ASC`;

// loadSuggestions(viewer) -> { suggestions, replies, canStatus, statusOpen, isAdmin } in one read-only batch.
//   canStatus: this viewer may change statuses; statusOpen: everyone may (fewer than 50 active users).
export const loadSuggestions = cache(async (viewer) => {
  const uid = String(viewer.id);
  const admin = isAdmin(viewer);
  const res = await transaction([
    query(SUGGESTIONS_SQL, [uid, admin]),
    query(REPLIES_SQL, [uid, admin]),
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
  };
});

// The few facts the write routes check before writing: { id, user_id, hidden } or null.
export async function suggestionMeta(id) {
  const r = await query(`SELECT id, user_id, (hidden_at IS NOT NULL) AS hidden FROM suggestions WHERE id = $1::bigint`,
    [String(id)]);
  const row = r.rows[0];
  return row ? { id: String(row.id), user_id: idOrNull(row.user_id), hidden: !!row.hidden } : null;
}

// One suggestion for viewer v (after a write), shaped and masked like the list. null when missing or hidden.
export async function loadSuggestion(v, id) {
  const r = await query(`SELECT * FROM (${SUGGESTIONS_SQL}) z WHERE z.id = $3::bigint`, [String(v.id), isAdmin(v), String(id)]);
  return r.rows[0] ? shapeSuggestion(r.rows[0]) : null;
}

// One reply for viewer v, shaped and masked like the list. null when missing or hidden.
export async function loadReply(v, id) {
  const r = await query(`SELECT * FROM (${REPLIES_SQL}) z WHERE z.id = $3::bigint`, [String(v.id), isAdmin(v), String(id)]);
  return r.rows[0] ? shapeReply(r.rows[0]) : null;
}
