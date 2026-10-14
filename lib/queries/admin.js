import 'server-only';
import * as React from 'react';
import { query, transaction, SCHEMA_VERSION } from '../db.js';
import { THROTTLE, signupCodeFallback } from '../auth.js';
import { underRosterLock } from '../rosters.js';

// Admin loaders and statements (design §2.1 Admin rows, §4.2, §5.4-5.5, §6, §8.2, §13 #6). Every caller is an
// admin page or an admin route (404 for everyone else), so these read whole tables on purpose (the static
// visibility check exempts this file). Lock order (§3.1, amendment A3): a statement that reads both sessions
// and users reads sessions first (a WITH on sessions, then RIGHT JOIN users), and a batch that writes both
// touches sessions first.

const cache = typeof React.cache === 'function' ? React.cache : (fn) => fn;
const id = (v) => (v == null || v === '' ? null : String(v));
const ADMIN_LOCK = 7342002;               // §13 #6: claim, remove-admin and disable run under this lock

// Dates as ISO strings and ids as strings, so rows pass to client components unchanged.
function plain(row) {
  if (!row || typeof row !== 'object') return row;
  const out = {};
  for (const [k, v] of Object.entries(row)) out[k] = v instanceof Date ? v.toISOString() : v;
  return out;
}
const rowsOf = (r) => r.rows.map(plain);
const nameSql = (a) => `COALESCE(NULLIF(${a}.display_name, ''), ${a}.username)`;

// ---------------------------------------------------------------- first-admin claim (§13 #6)

// The claim route answers 404 unless this is set (never on Vercel; local bootstrap only).
export const adminClaimAllowed = () => process.env.TB_ALLOW_ADMIN_CLAIM === '1';

export async function activeAdminExists() {
  const r = await query(`SELECT EXISTS (SELECT 1 FROM users WHERE is_admin AND disabled_at IS NULL) AS any`);
  return !!r.rows[0]?.any;
}

// One advisory-locked transaction: two people can't both become the first admin. -> true when this user won.
export async function claimAdmin(userId) {
  const res = await transaction([
    query(`SELECT pg_advisory_xact_lock($1::bigint)`, [ADMIN_LOCK]),
    query(`WITH u AS (UPDATE users SET is_admin = true, updated_at = now()
                      WHERE id = $1::bigint AND disabled_at IS NULL
                        AND NOT EXISTS (SELECT 1 FROM users x WHERE x.is_admin AND x.disabled_at IS NULL)
                      RETURNING id)
           INSERT INTO audit_log (actor_id, action, entity, entity_id, detail)
           SELECT u.id, 'admin.claim', 'users', u.id::text, '{}'::jsonb FROM u
           RETURNING entity_id`, [id(userId)]),
  ]);
  return res[1].rows.length > 0;
}

// ---------------------------------------------------------------- accounts (/admin/users)

// One account per row. sessions first (WITH s), then users (A3).
const ACCOUNT_SQL = (where) => `
WITH s AS (
  SELECT user_id, max(created_at) AS last_sign_in, (count(*) FILTER (WHERE expires_at > now()))::int AS devices
  FROM sessions GROUP BY user_id)
SELECT u.id, u.username, ${nameSql('u')} AS name, u.display_name, u.email,
       u.is_admin, u.is_organizer, u.must_change, u.created_at, u.updated_at, u.disabled_at, u.profile_completed_at,
       u.identity_verified_at, ${nameSql('iv')} AS identity_verified_by_name,
       u.office_id, o.name AS office, COALESCE(o.archived, false) AS office_archived,
       u.team_id, t.name AS team, u.department_id, d.name AS department, d.color AS department_color,
       u.position_id, rp.name AS position, rp.level AS position_level,
       u.approved_position_id, ap.name AS approved_position, ap.level AS approved_level,
       (u.position_id IS DISTINCT FROM u.approved_position_id) AS position_pending, u.position_requested_at,
       u.position_decided_at, ${nameSql('pd')} AS position_decided_by_name,
       u.manager_id, ${nameSql('m')} AS boss,
       COALESCE(tb_user_level(u.id), 0) AS level,
       u.avatar_v, u.avatar_set_at, ${nameSql('ab')} AS avatar_set_by_name,
       s.last_sign_in, COALESCE(s.devices, 0) AS devices,
       COALESCE(th.failures, 0) AS signin_failures,
       COALESCE(th.failures >= $1::int AND th.window_start > now() - make_interval(mins => $2::int), false) AS signin_locked,
       COALESCE((SELECT json_agg(json_build_object('id', x.office_id::text, 'name', xo.name) ORDER BY xo.position, xo.id)
                 FROM user_offices x JOIN offices xo ON xo.id = x.office_id
                 WHERE x.user_id = u.id AND x.revoked_at IS NULL), '[]'::json) AS extra_offices,
       (SELECT json_build_object('id', p.id::text, 'name', p.name, 'color', p.color, 'archived', p.archived_at IS NOT NULL,
                                 'tasks', (SELECT count(*) FROM tasks k WHERE k.assignee_id = p.id))
        FROM people p WHERE p.user_id = u.id) AS person,
       COALESCE((SELECT json_agg(json_build_object('id', q.id::text, 'kind', q.kind, 'office', qo.name, 'person', qp.name,
                                                   'created_at', q.created_at) ORDER BY q.id)
                 FROM access_requests q LEFT JOIN offices qo ON qo.id = q.office_id LEFT JOIN people qp ON qp.id = q.person_id
                 WHERE q.user_id = u.id AND q.status = 'pending'), '[]'::json) AS pending_requests,
       (SELECT count(*) FROM project_members pm WHERE pm.user_id = u.id AND pm.removed_at IS NULL AND pm.source = 'legacy')::int
         AS legacy_count,
       (SELECT count(*) FROM project_members pm WHERE pm.user_id = u.id AND pm.removed_at IS NULL)::int AS member_count,
       (SELECT count(*) FROM tb_visible_project_ids(u.id))::int AS visible_count
FROM s RIGHT JOIN users u ON u.id = s.user_id
LEFT JOIN users iv ON iv.id = u.identity_verified_by
LEFT JOIN offices o ON o.id = u.office_id
LEFT JOIN teams t ON t.id = u.team_id
LEFT JOIN departments d ON d.id = u.department_id
LEFT JOIN positions rp ON rp.id = u.position_id
LEFT JOIN positions ap ON ap.id = u.approved_position_id
LEFT JOIN users pd ON pd.id = u.position_decided_by
LEFT JOIN users m ON m.id = u.manager_id
LEFT JOIN users ab ON ab.id = u.avatar_set_by
LEFT JOIN auth_throttle th ON th.key = 'u:' || lower(u.username)
${where}
ORDER BY lower(u.username), u.id`;

const shapeAccount = (r) => {
  const a = plain(r);
  a.id = String(a.id);
  for (const k of ['office_id', 'team_id', 'department_id', 'position_id', 'approved_position_id', 'manager_id', 'avatar_v']) {
    a[k] = a[k] == null ? null : String(a[k]);
  }
  a.level = Number(a.level) || 0;
  a.test_account = /^zz_/.test(a.username);
  return a;
};

const lockParams = () => [THROTTLE.loginUser.limit, THROTTLE.loginUser.minutes];

export const listAccounts = cache(async () => {
  const r = await query(ACCOUNT_SQL(''), lockParams());
  return r.rows.map(shapeAccount);
});

export async function loadAccount(userId) {
  const r = await query(ACCOUNT_SQL('WHERE u.id = $3::bigint'), [...lockParams(), id(userId)]);
  return r.rows[0] ? shapeAccount(r.rows[0]) : null;
}

// Reference lists for pickers (admin forms): every office/team/department/position, archived flagged.
async function referenceLists() {
  const res = await transaction([
    query(`SELECT o.id, o.name, o.archived, o.position, COALESCE(o.tz, 'America/Chicago') AS tz FROM offices o
           ORDER BY o.archived, o.position, o.id`),
    query(`SELECT t.id, t.name, t.office_id, t.archived, t.position FROM teams t ORDER BY t.position, t.id`),
    query(`SELECT id, name, color, archived, sort FROM departments ORDER BY archived, sort, id`),
    query(`SELECT id, name, level, archived, sort FROM positions ORDER BY archived, sort, id`),
  ], { readOnly: true });
  const [offices, teams, departments, positions] = res.map(rowsOf);
  const ids = (list) => list.map((x) => ({ ...x, id: String(x.id), ...(x.office_id != null ? { office_id: String(x.office_id) } : {}) }));
  return { offices: ids(offices), teams: ids(teams), departments: ids(departments), positions: ids(positions).map((p) => ({ ...p, level: Number(p.level) })) };
}

// Bulk "apply new rules" batches, newest first, with how many rows each one still keeps removed (undo).
async function pruneBatches() {
  const r = await query(
    `SELECT a.id, a.at, a.entity_id AS target, ${nameSql('x')} AS actor,
            ${nameSql('tu')} AS target_name,
            (SELECT count(*) FROM project_members m WHERE m.remove_batch = a.id AND m.removed_at IS NOT NULL)::int AS still_removed,
            (SELECT count(DISTINCT m.user_id) FROM project_members m WHERE m.remove_batch = a.id AND m.removed_at IS NOT NULL)::int
              AS people
     FROM audit_log a LEFT JOIN users x ON x.id = a.actor_id
     LEFT JOIN users tu ON tu.id = CASE WHEN a.entity_id ~ '^[0-9]+$' THEN a.entity_id::bigint END
     WHERE a.action = 'member.prune_legacy'
     ORDER BY a.id DESC LIMIT 20`);
  return r.rows.map((b) => ({ ...plain(b), id: String(b.id) }));
}

export async function loadAccountsPage() {
  const [accounts, refs, batches, totals] = await Promise.all([
    listAccounts(), referenceLists(), pruneBatches(),
    query(`SELECT (SELECT count(*) FROM project_members WHERE source = 'legacy' AND removed_at IS NULL)::int AS legacy_active,
                  (SELECT count(*) FROM project_members WHERE source = 'legacy' AND removed_at IS NOT NULL)::int AS legacy_removed`),
  ]);
  return { accounts, ...refs, batches, totals: totals.rows[0] || {} };
}

// ---------------------------------------------------------------- admin flag, disable, reset (§13 #6, rule 29, 30)

const auditOne = (action) => `INSERT INTO audit_log (actor_id, action, entity, entity_id, detail)
  SELECT $2::bigint, '${action}', 'users', u.id::text, '{}'::jsonb FROM u RETURNING entity_id`;

// Make or remove admin. Removal keeps at least one active admin, checked inside the advisory lock.
// -> 'ok' | 'noop' | 'last_admin' | 'missing'
export async function setAdminFlag({ adminId, userId, on }) {
  const upd = on
    ? `WITH u AS (UPDATE users SET is_admin = true, updated_at = now() WHERE id = $1::bigint AND NOT is_admin RETURNING id)
       ${auditOne('admin.grant')}`
    : `WITH u AS (UPDATE users SET is_admin = false, updated_at = now()
                  WHERE id = $1::bigint AND is_admin
                    AND EXISTS (SELECT 1 FROM users x WHERE x.is_admin AND x.disabled_at IS NULL AND x.id <> $1::bigint)
                  RETURNING id)
       ${auditOne('admin.remove')}`;
  const res = await transaction([
    query(`SELECT pg_advisory_xact_lock($1::bigint)`, [ADMIN_LOCK]),
    query(upd, [id(userId), id(adminId)]),
    query(`SELECT is_admin FROM users WHERE id = $1::bigint`, [id(userId)]),
  ]);
  if (res[1].rows.length) return 'ok';
  const cur = res[2].rows[0];
  if (!cur) return 'missing';
  if (!!cur.is_admin === !!on) return 'noop';
  return 'last_admin';
}

// Disable (expires every session; never the last active admin) or enable. Sessions are written first (A3).
// -> 'ok' | 'noop' | 'last_admin' | 'missing'
export async function setDisabled({ adminId, userId, on }) {
  const uid = id(userId), admin = id(adminId);
  const keepsAdmin = `(NOT t.is_admin OR EXISTS (SELECT 1 FROM users x WHERE x.is_admin AND x.disabled_at IS NULL AND x.id <> t.id))`;
  const stmts = on ? [
    query(`SELECT pg_advisory_xact_lock($1::bigint)`, [ADMIN_LOCK]),
    query(`UPDATE sessions SET expires_at = now()
           WHERE user_id = $1::bigint AND expires_at > now()
             AND EXISTS (SELECT 1 FROM users t WHERE t.id = $1::bigint AND t.disabled_at IS NULL AND ${keepsAdmin})`, [uid]),
    query(`WITH u AS (UPDATE users t SET disabled_at = now(), updated_at = now()
                      WHERE t.id = $1::bigint AND t.disabled_at IS NULL AND ${keepsAdmin} RETURNING t.id)
           ${auditOne('user.disable')}`, [uid, admin]),
    query(`SELECT disabled_at IS NOT NULL AS disabled FROM users WHERE id = $1::bigint`, [uid]),
  ] : [
    query(`SELECT pg_advisory_xact_lock($1::bigint)`, [ADMIN_LOCK]),
    query(`SELECT 1`),
    query(`WITH u AS (UPDATE users SET disabled_at = NULL, updated_at = now() WHERE id = $1::bigint AND disabled_at IS NOT NULL
                      RETURNING id)
           ${auditOne('user.enable')}`, [uid, admin]),
    query(`SELECT disabled_at IS NOT NULL AS disabled FROM users WHERE id = $1::bigint`, [uid]),
  ];
  const res = await transaction(stmts);
  if (res[2].rows.length) return 'ok';
  const cur = res[3].rows[0];
  if (!cur) return 'missing';
  if (!!cur.disabled === !!on) return 'noop';
  return 'last_admin';
}

// Temporary password: must_change, every session expired (sessions first), the username's sign-in lock
// cleared, audited. -> true, or false when the account doesn't exist.
export async function resetPassword({ adminId, userId, hash }) {
  const uid = id(userId), admin = id(adminId);
  const res = await transaction([
    query(`UPDATE sessions SET expires_at = now()
           WHERE user_id = $1::bigint AND expires_at > now() AND EXISTS (SELECT 1 FROM users WHERE id = $1::bigint)`, [uid]),
    query(`WITH u AS (UPDATE users SET password_hash = $3::text, must_change = true, updated_at = now()
                      WHERE id = $1::bigint RETURNING id)
           ${auditOne('password.reset')}`, [uid, admin, String(hash)]),
    query(`UPDATE auth_throttle a SET failures = 0, window_start = now() FROM users u
           WHERE u.id = $1::bigint AND a.key = 'u:' || lower(u.username)`, [uid]),
  ]);
  return res[1].rows.length > 0;
}

// "Clear sign-in lock": the u:<username> throttle row back to 0 (rows are reused, never deleted).
// -> false when the account doesn't exist.
export async function clearSignInLock({ adminId, userId }) {
  const r = await query(
    `WITH u AS (SELECT id, username FROM users WHERE id = $1::bigint),
     t AS (UPDATE auth_throttle a SET failures = 0, window_start = now() FROM u WHERE a.key = 'u:' || lower(u.username)
           RETURNING a.key),
     a AS (INSERT INTO audit_log (actor_id, action, entity, entity_id, detail)
           SELECT $2::bigint, 'signin.clear_lock', 'users', u.id::text, jsonb_build_object('had_row', EXISTS (SELECT 1 FROM t))
           FROM u)
     SELECT (SELECT count(*) FROM u)::int AS found`,
    [id(userId), id(adminId)]);
  return Number(r.rows[0]?.found || 0) > 0;
}

// ---------------------------------------------------------------- profile fields set by an admin (§8.2)

// Manager must be an active user, not the person, and create no cycle (§5.2 step 1). -> error text or null.
export async function managerProblem(userId, managerId) {
  if (managerId == null) return null;
  if (String(managerId) === String(userId)) return 'Someone can’t be their own boss.';
  const res = await transaction([
    query(`SELECT 1 FROM users WHERE id = $1::bigint AND disabled_at IS NULL`, [id(managerId)]),
    query(`WITH RECURSIVE up AS (SELECT id, manager_id FROM users WHERE id = $1::bigint
                                 UNION SELECT u.id, u.manager_id FROM users u JOIN up ON u.id = up.manager_id)
           SELECT 1 FROM up WHERE id = $2::bigint LIMIT 1`, [id(managerId), id(userId)]),
  ], { readOnly: true });
  if (!res[0].rows.length) return 'Pick an active person as their boss.';
  if (res[1].rows.length) return 'That would make a loop: they’re already above that person.';
  return null;
}

// Simple columns in one UPDATE (department, boss, organizer flag, identity check, home office, team).
// A direct office change keeps the team only when it still sits in the new office or an active extra
// office, and supersedes a pending office-change request. A team must be active and in their offices
// (home or extra), so team-thread access never reaches another office (§4.3).
// identity_verified: true verifies only while the name and email are still `fields.expected_identity` (what the
// admin was shown; the route requires it), so a rename after the page loaded is never verified unseen.
// -> { status: 'ok' | 'missing' | 'team', verified }
export async function updateAccountFields({ adminId, userId, fields }) {
  const uid = id(userId), admin = id(adminId);
  const params = [uid, admin];
  const p = (v) => { params.push(v); return `$${params.length}`; };
  const set = ['updated_at = now()'];
  const has = (k) => Object.prototype.hasOwnProperty.call(fields, k);
  if (has('is_organizer')) set.push(`is_organizer = ${p(!!fields.is_organizer)}::boolean`);
  if (has('department_id')) set.push(`department_id = ${p(id(fields.department_id))}::bigint`);
  if (has('manager_id')) set.push(`manager_id = ${p(id(fields.manager_id))}::bigint`);
  if (has('identity_verified')) {
    if (fields.identity_verified) {
      const exp = fields.expected_identity || {};
      const same = `COALESCE(display_name, '') = ${p(String(exp.display_name ?? ''))}::text
                    AND COALESCE(email, '') = ${p(String(exp.email ?? ''))}::text`;
      set.push(`identity_verified_at = CASE WHEN ${same} THEN COALESCE(identity_verified_at, now()) ELSE identity_verified_at END,
         identity_verified_by = CASE WHEN ${same} AND identity_verified_at IS NULL THEN $2::bigint ELSE identity_verified_by END`);
    } else {
      set.push('identity_verified_at = NULL, identity_verified_by = NULL');
    }
  }
  // The office this statement leaves them in (the new one, or their current one).
  const officeSql = has('office_id') ? `${p(id(fields.office_id))}::bigint` : 'users.office_id';
  if (has('office_id')) set.push(`office_id = ${officeSql}`);
  const inOffices = (teamSql) => `EXISTS (SELECT 1 FROM teams tm WHERE tm.id = ${teamSql} AND NOT tm.archived
      AND (tm.office_id = ${officeSql}
           OR tm.office_id IN (SELECT x.office_id FROM user_offices x WHERE x.user_id = users.id AND x.revoked_at IS NULL)))`;
  const where = ['id = $1::bigint'];
  if (has('team_id')) {
    const tp = `${p(id(fields.team_id))}::bigint`;
    set.push(`team_id = ${tp}`);
    where.push(`(${tp} IS NULL OR ${inOffices(tp)})`);
  } else if (has('office_id')) {
    // Keep the current team only if it still fits; an archived current team is kept (it was already there).
    set.push(`team_id = CASE WHEN team_id IS NULL THEN NULL
                             WHEN EXISTS (SELECT 1 FROM teams tm WHERE tm.id = users.team_id
                                          AND (tm.office_id = ${officeSql}
                                               OR tm.office_id IN (SELECT x.office_id FROM user_offices x
                                                                   WHERE x.user_id = users.id AND x.revoked_at IS NULL)))
                             THEN team_id ELSE NULL END`);
  }
  const keys = Object.keys(fields).filter((k) => k !== 'expected_identity');
  const auditDetail = `jsonb_build_object('fields', ${p(JSON.stringify(keys))}::jsonb)`;
  const stmts = [
    query(`WITH u AS (UPDATE users SET ${set.join(', ')} WHERE ${where.join(' AND ')}
                      RETURNING id, (identity_verified_at IS NOT NULL) AS verified),
           a AS (INSERT INTO audit_log (actor_id, action, entity, entity_id, detail)
                 SELECT $2::bigint, 'user.update', 'users', u.id::text, ${auditDetail} FROM u)
           SELECT u.id, u.verified FROM u`, params),
    query(`SELECT 1 FROM users WHERE id = $1::bigint`, [uid]),
  ];
  if (has('office_id')) {
    stmts.push(query(
      `UPDATE access_requests SET status = 'superseded', decided_by = $2::bigint, decided_at = now(),
              decision_note = 'Office set directly by an admin'
       WHERE user_id = $1::bigint AND kind = 'office_change' AND status = 'pending'
         AND EXISTS (SELECT 1 FROM users WHERE id = $1::bigint AND office_id IS NOT DISTINCT FROM $3::bigint)`,
      [uid, admin, id(fields.office_id)]));
  }
  const res = await transaction(stmts);
  if (res[0].rows.length) return { status: 'ok', verified: !!res[0].rows[0].verified };
  return { status: res[1].rows.length ? 'team' : 'missing', verified: false };
}

// Display name and email (both may be cleared: '' / NULL). Email uniqueness is the users_email_uq index
// (23505); a username equal to the email is refused too (§5.1). Optional base compare for each field.
// -> { status: 'ok' | 'missing' | 'conflict' | 'taken', current }
export async function updateAccountIdentity({ adminId, userId, fields, base = {} }) {
  const uid = id(userId), admin = id(adminId);
  const params = [uid, admin];
  const p = (v) => { params.push(v); return `$${params.length}`; };
  const set = ['updated_at = now()'];
  const guards = [];
  const has = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);
  for (const k of ['display_name', 'email']) {
    if (!has(fields, k)) continue;
    const v = p(fields[k]);
    set.push(`${k} = ${v}::text`);
    if (has(base, k)) {
      const b = p(base[k] == null ? '' : String(base[k]));
      guards.push(`(COALESCE(${k}, '') = ${b}::text OR COALESCE(${k}, '') = COALESCE(${v}::text, ''))`);
    }
  }
  if (has(fields, 'email') && fields.email) {
    const e = p(String(fields.email).toLowerCase());
    guards.push(`NOT EXISTS (SELECT 1 FROM users y WHERE y.id <> $1::bigint AND lower(y.username) = ${e}::text)`);
  }
  const r = await query(
    `WITH u AS (UPDATE users SET ${set.join(', ')} WHERE id = $1::bigint${guards.length ? ` AND ${guards.join(' AND ')}` : ''}
                RETURNING id, display_name, email)
     , a AS (INSERT INTO audit_log (actor_id, action, entity, entity_id, detail)
             SELECT $2::bigint, 'user.identity_edit', 'users', u.id::text,
                    jsonb_build_object('display_name', u.display_name, 'email', u.email) FROM u)
     SELECT id FROM u`, params);
  if (r.rows.length) return { status: 'ok' };
  const cur = (await query(`SELECT id, username, display_name, email, updated_at FROM users WHERE id = $1::bigint`, [uid])).rows[0];
  if (!cur) return { status: 'missing' };
  if (has(fields, 'email') && fields.email) {
    const clash = await query(`SELECT 1 FROM users WHERE id <> $1::bigint AND lower(username) = $2::text`,
      [uid, String(fields.email).toLowerCase()]);
    if (clash.rows.length) return { status: 'taken' };
  }
  const fieldsHit = ['display_name', 'email'].filter((k) => has(base, k) && has(fields, k)
    && String(cur[k] ?? '') !== String(base[k] ?? '') && String(cur[k] ?? '') !== String(fields[k] ?? ''));
  return { status: 'conflict', fields: fieldsHit, current: plain(cur) };
}

// ---------------------------------------------------------------- extra offices (§8.2)

// Grant (or revive) an extra office. -> 'ok' | 'already' | 'missing' | 'office' | 'home'
export async function grantOffice({ adminId, userId, officeId }) {
  const r = await query(
    `WITH ok AS (SELECT u.id FROM users u WHERE u.id = $1::bigint
                   AND EXISTS (SELECT 1 FROM offices o WHERE o.id = $2::bigint AND NOT o.archived)
                   AND u.office_id IS DISTINCT FROM $2::bigint),
     g AS (INSERT INTO user_offices (user_id, office_id, granted_by)
           SELECT ok.id, $2::bigint, $3::bigint FROM ok
           ON CONFLICT (user_id, office_id) DO UPDATE
             SET revoked_at = NULL, revoked_by = NULL, granted_by = EXCLUDED.granted_by, created_at = now()
             WHERE user_offices.revoked_at IS NOT NULL
           RETURNING user_id, office_id),
     a AS (INSERT INTO audit_log (actor_id, action, entity, entity_id, detail)
           SELECT $3::bigint, 'office.grant', 'users', g.user_id::text, jsonb_build_object('office_id', g.office_id) FROM g)
     SELECT (SELECT count(*) FROM ok)::int AS ok, (SELECT count(*) FROM g)::int AS granted,
            EXISTS (SELECT 1 FROM users WHERE id = $1::bigint) AS user_exists,
            EXISTS (SELECT 1 FROM users WHERE id = $1::bigint AND office_id = $2::bigint) AS is_home`,
    [id(userId), id(officeId), id(adminId)]);
  const x = r.rows[0] || {};
  if (Number(x.granted) > 0) return 'ok';
  if (Number(x.ok) > 0) return 'already';
  if (!x.user_exists) return 'missing';
  if (x.is_home) return 'home';
  return 'office';
}

// Revoke (soft). Clears users.team_id in the same statement when the team sits in the revoked office and
// that office isn't their home office (§8.2). -> { revoked, team_cleared }
export async function revokeOffice({ adminId, userId, officeId }) {
  const r = await query(
    `WITH r AS (UPDATE user_offices SET revoked_at = now(), revoked_by = $3::bigint
                WHERE user_id = $1::bigint AND office_id = $2::bigint AND revoked_at IS NULL RETURNING user_id, office_id),
     t AS (UPDATE users u SET team_id = NULL, updated_at = now() FROM r
           WHERE u.id = r.user_id AND u.office_id IS DISTINCT FROM r.office_id
             AND u.team_id IN (SELECT tm.id FROM teams tm WHERE tm.office_id = r.office_id)
           RETURNING u.id),
     a AS (INSERT INTO audit_log (actor_id, action, entity, entity_id, detail)
           SELECT $3::bigint, 'office.revoke', 'users', r.user_id::text,
                  jsonb_build_object('office_id', r.office_id, 'team_cleared', (SELECT count(*) FROM t) > 0) FROM r)
     SELECT (SELECT count(*) FROM r)::int AS revoked, (SELECT count(*) FROM t)::int AS team_cleared`,
    [id(userId), id(officeId), id(adminId)]);
  const x = r.rows[0] || {};
  return { revoked: Number(x.revoked || 0), team_cleared: Number(x.team_cleared || 0) };
}

// ---------------------------------------------------------------- legacy access tools (§6)

// "Apply new rules": soft-remove legacy memberships, keeping projects where the person owns tasks, their own
// (home) team's projects and (A4 rule 3d) the projects of every team on their active roster. The kept legacy rows
// on roster-team projects are relabeled source='team_legacy': later roster changes manage them like 'team' rows
// (leaving the roster or a move away removes them, lib/rosters.js), and they still make their holder a legacy
// manager of the pre-launch project (lib/policy.js isLegacyManager; design §6: "each person remains a legacy
// manager of their own team's projects"). The batch's audit row lists them (detail.relabeled), so undo turns them
// back into 'legacy'. Under the roster lock (it reads rosters). userId null = everyone. Every $2 occurrence is
// cast (it is reused, §6). -> { batch, removed, people, relabeled }
export async function pruneLegacy({ adminId, userId = null }) {
  const r = await underRosterLock(
    `WITH rl0 AS (SELECT m.project_id, m.user_id FROM project_members m
                  JOIN projects pr ON pr.id = m.project_id
                  JOIN team_members x ON x.team_id = pr.team_id AND x.user_id = m.user_id AND x.removed_at IS NULL
                  WHERE m.source = 'legacy' AND m.removed_at IS NULL AND ($2::bigint IS NULL OR m.user_id = $2::bigint)),
     a AS (INSERT INTO audit_log (actor_id, action, entity, entity_id, detail)
           VALUES ($1::bigint, 'member.prune_legacy', 'project_members', COALESCE($2::text, 'all'),
                   jsonb_build_object('relabeled', COALESCE((SELECT jsonb_agg(jsonb_build_object('p', rl0.project_id, 'u', rl0.user_id)
                                                                   ORDER BY rl0.project_id, rl0.user_id) FROM rl0), '[]'::jsonb)))
           RETURNING id),
     m AS (UPDATE project_members m SET removed_at = now(), removed_by = $1::bigint, remove_batch = (SELECT id FROM a)
           WHERE m.source = 'legacy' AND m.removed_at IS NULL AND ($2::bigint IS NULL OR m.user_id = $2::bigint)
             AND NOT EXISTS (SELECT 1 FROM tasks t JOIN people p ON p.id = t.assignee_id
                             WHERE t.project_id = m.project_id AND p.user_id = m.user_id)
             AND NOT EXISTS (SELECT 1 FROM projects pr JOIN users u ON u.id = m.user_id
                             WHERE pr.id = m.project_id AND pr.team_id = u.team_id)
             AND NOT EXISTS (SELECT 1 FROM projects pr JOIN team_members x ON x.team_id = pr.team_id
                             WHERE pr.id = m.project_id AND x.user_id = m.user_id AND x.removed_at IS NULL)
           RETURNING m.project_id, m.user_id),
     rl AS (UPDATE project_members m SET source = 'team_legacy'
            FROM rl0 WHERE m.project_id = rl0.project_id AND m.user_id = rl0.user_id
              AND m.source = 'legacy' AND m.removed_at IS NULL
            RETURNING m.project_id),
     rv AS (UPDATE projects SET rev = rev + 1 WHERE id IN (SELECT project_id FROM m UNION SELECT project_id FROM rl))
     SELECT (SELECT id FROM a) AS batch, (SELECT count(*) FROM m)::int AS removed,
            (SELECT count(DISTINCT user_id) FROM m)::int AS people, (SELECT count(*) FROM rl)::int AS relabeled`,
    [id(adminId), id(userId)]);
  const x = r.rows[0] || {};
  return { batch: x.batch == null ? null : String(x.batch), removed: Number(x.removed || 0), people: Number(x.people || 0),
    relabeled: Number(x.relabeled || 0) };
}

// Undo one prune batch exactly: the memberships it removed come back (unless revived since), and the rows it
// relabeled 'legacy' -> 'team_legacy' (A4 rule 3d) are 'legacy' again while still active 'team_legacy' rows.
// -> { found, restored }
export async function undoPrune({ adminId, batch }) {
  const r = await query(
    `WITH b AS (SELECT id, detail FROM audit_log WHERE id = $1::bigint AND action = 'member.prune_legacy'),
     r AS (UPDATE project_members SET removed_at = NULL, removed_by = NULL, remove_batch = NULL
           WHERE remove_batch IN (SELECT id FROM b) AND removed_at IS NOT NULL RETURNING project_id, user_id),
     x AS (SELECT (e.v->>'p')::bigint AS p, (e.v->>'u')::bigint AS u
           FROM b CROSS JOIN LATERAL jsonb_array_elements(
             CASE WHEN jsonb_typeof(b.detail->'relabeled') = 'array' THEN b.detail->'relabeled' ELSE '[]'::jsonb END) AS e(v)),
     rl AS (UPDATE project_members m SET source = 'legacy' FROM x
            WHERE m.project_id = x.p AND m.user_id = x.u AND m.source = 'team_legacy' AND m.removed_at IS NULL
            RETURNING m.project_id),
     rv AS (UPDATE projects SET rev = rev + 1 WHERE id IN (SELECT project_id FROM r UNION SELECT project_id FROM rl)),
     a AS (INSERT INTO audit_log (actor_id, action, entity, entity_id, detail)
           SELECT $2::bigint, 'member.prune_undo', 'project_members', b.id::text,
                  jsonb_build_object('restored', (SELECT count(*) FROM r), 'relabeled', (SELECT count(*) FROM rl)) FROM b)
     SELECT (SELECT count(*) FROM b)::int AS found, (SELECT count(*) FROM r)::int AS restored`,
    [id(batch), id(adminId)]);
  const x = r.rows[0] || {};
  return { found: Number(x.found || 0), restored: Number(x.restored || 0) };
}

// Admin > Org "Give profile picks its projects": everyone whose home team (users.team_id, the profile pick) is this
// team gets all of its projects (source 'admin'; revives soft-removed rows). Roster members get the team's projects
// from the roster (A4); these admin grants are separate and stay when someone leaves the roster.
// -> { found, added, people }
export async function grantTeamProjects({ adminId, teamId }) {
  const r = await query(
    `WITH tm AS (SELECT id FROM teams WHERE id = $1::bigint),
     g AS (INSERT INTO project_members (project_id, user_id, source, added_by)
           SELECT p.id, u.id, 'admin'::text, $2::bigint FROM projects p JOIN users u ON u.team_id = p.team_id
           WHERE p.team_id = $1::bigint AND u.disabled_at IS NULL
           ON CONFLICT (project_id, user_id) DO UPDATE
             SET removed_at = NULL, removed_by = NULL, remove_batch = NULL, source = 'admin'
             WHERE project_members.removed_at IS NOT NULL
           RETURNING project_id, user_id),
     rv AS (UPDATE projects SET rev = rev + 1 WHERE id IN (SELECT project_id FROM g)),
     a AS (INSERT INTO audit_log (actor_id, action, entity, entity_id, detail)
           SELECT $2::bigint, 'member.grant_team', 'teams', tm.id::text, jsonb_build_object('added', (SELECT count(*) FROM g))
           FROM tm)
     SELECT (SELECT count(*) FROM tm)::int AS found, (SELECT count(*) FROM g)::int AS added,
            (SELECT count(DISTINCT user_id) FROM g)::int AS people`,
    [id(teamId), id(adminId)]);
  const x = r.rows[0] || {};
  return { found: Number(x.found || 0), added: Number(x.added || 0), people: Number(x.people || 0) };
}

// ---------------------------------------------------------------- approval queue (§4.2, §5.4, §5.5)

const plural = (n, one, many = `${one}s`) => `${n} ${Number(n) === 1 ? one : many}`;
const listJoin = (a) => (a.length <= 1 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`);
const article = (w) => (/^[aeiou]/i.test(String(w || '')) ? 'an' : 'a');

function positionConsequence(r, totalProjects) {
  const lvl = Number(r.requested_level);
  const now = `sees ${r.visible_now} today${Number(r.legacy_count) > 0 ? ' through legacy access' : ''}`;
  if (r.is_admin) return 'As an admin they already see everything; this only changes the title shown on their profile.';
  if (lvl >= 4) {
    return `Would see everything: every project in the company (${totalProjects}), every office’s meeting minutes `
      + `and every office’s suggestions and announcements (${now}).`;
  }
  if (lvl === 3) {
    return `Would see every project in the company (${totalProjects}), plus every office’s meeting minutes (${now}).`;
  }
  if (lvl === 2) {
    const offices = r.office_names || [];
    if (!offices.length) return `Would see every project in their office, but they haven’t picked an office yet (${now}).`;
    return `Would see all ${plural(r.office_projects, 'active project')} in ${listJoin(offices)} (${now}).`;
  }
  return `Sees only the projects they’re added to, as today (${now}).`;
}

function officeConsequence(r) {
  const from = r.from_office || r.office || 'no office';
  const to = r.to_office || 'an office that no longer exists';
  let s = `Moves from ${from} to ${to}`;
  const lvl = Number(r.level);
  if (r.to_office_archived || !r.office_id) s += ' (that office is archived or gone, so approving will fail; decline it)';
  if (lvl >= 9) s += '. As an admin they already see everything.';
  else if (lvl >= 3) s += `. As an approved ${r.approved || 'Project Manager'} they already see every project, so their projects don’t change.`;
  else if (lvl === 2) {
    s += `; as an approved ${r.approved || 'office-level position'} they’d see ${to}’s ${plural(r.to_office_projects, 'project')} `
      + `instead of ${from}’s ${r.from_office_projects}.`;
  } else {
    s += `. They still see only the projects they’re added to; they’d read ${to}’s meeting minutes, suggestions and `
      + `announcements instead of ${from}’s.`;
  }
  if (r.team_id) {
    s += r.to_team_ok ? ` Joins ${r.to_team}.` : ` The team they picked is no longer in ${to}, so they’ll have no team.`;
  }
  return s;
}

function linkConsequence(r) {
  const who = `“${r.person || 'This name'}”`;
  if (!r.person_id) return 'That name was deleted; approving will fail. Decline it.';
  if (r.person_user_id) return `${who} is already linked to ${r.person_linked_to}; approving will fail. Decline it, or unlink that name first.`;
  if (r.person_kind === 'group') return `${who} is a group, and groups can’t be linked to an account; approving will fail.`;
  if (r.person_archived_at) return `${who} is archived; restore it on Names on tasks (admin) before approving.`;
  if (r.own_person_id && Number(r.own_person_tasks) > 0) {
    return `This account already has its own name “${r.own_person}” with ${plural(r.own_person_tasks, 'task')}; `
      + 'approving will fail until those tasks are reassigned on the board.';
  }
  let s;
  const t = Number(r.person_tasks), pj = Number(r.person_projects), nw = Number(r.person_new_projects);
  if (!t) s = `${who} has no tasks yet; approving links the name to this account.`;
  else if (nw === pj) s = `${r.person} owns ${plural(t, 'task')} in ${plural(pj, 'project')}; approving adds ${pj === 1 ? 'that project' : `those ${pj} projects`}.`;
  else s = `${r.person} owns ${plural(t, 'task')} in ${plural(pj, 'project')}; approving adds ${plural(nw, 'project')} (they’re already on the rest).`;
  if (r.own_person_id) s += ` Their own name “${r.own_person}” has no tasks and will be archived.`;
  if (Number(r.others_asking) > 0) s += ` ${plural(r.others_asking, 'other person', 'other people')} also asked for this name.`;
  return s;
}

const identityConsequence = (r) => {
  const bits = [r.username, r.email || 'no email'].join(', ');
  return `Shows as “${r.name}” (${bits}). Verifying removes the “unverified” chip.`;
};

const LEGACY_USER = `(EXISTS (SELECT 1 FROM project_members pm WHERE pm.user_id = u.id AND pm.source = 'legacy')
   OR u.created_at < (SELECT to_timestamp(value::bigint / 1000.0) FROM schema_meta WHERE key = 'release1_at' AND value ~ '^[0-9]+$'))`;
const USER_COLS = `u.id AS user_id, ${nameSql('u')} AS name, u.username, u.display_name, u.email, u.created_at AS signed_up_at,
  u.is_admin, (u.identity_verified_at IS NOT NULL) AS identity_verified, u.profile_completed_at,
  o.name AS office, d.name AS department, d.color AS department_color, ut.name AS team, ${nameSql('m')} AS boss,
  ${LEGACY_USER} AS legacy_user`;

// The whole queue, oldest first, with a plain-English consequence per card. -> { items, positions, counts }
export const listApprovals = cache(async () => {
  const userCols = USER_COLS;
  const userJoins = `LEFT JOIN offices o ON o.id = u.office_id LEFT JOIN departments d ON d.id = u.department_id
    LEFT JOIN teams ut ON ut.id = u.team_id LEFT JOIN users m ON m.id = u.manager_id`;
  const res = await transaction([
    // (a) positions: derived queue
    query(`SELECT ${userCols},
                  rp.id AS requested_id, rp.name AS requested, rp.level AS requested_level,
                  ap.id AS approved_id, ap.name AS approved, ap.level AS approved_level, u.position_requested_at,
                  (SELECT count(*) FROM tb_visible_project_ids(u.id))::int AS visible_now,
                  (SELECT count(*) FROM project_members pm WHERE pm.user_id = u.id AND pm.removed_at IS NULL
                     AND pm.source = 'legacy')::int AS legacy_count,
                  (SELECT count(*) FROM projects p JOIN teams tt ON tt.id = p.team_id
                   WHERE NOT p.archived AND NOT tt.archived AND tt.office_id IN (SELECT tb_user_office_ids(u.id)))::int
                     AS office_projects,
                  ARRAY(SELECT oo.name FROM offices oo WHERE oo.id IN (SELECT tb_user_office_ids(u.id))
                        ORDER BY oo.position, oo.id) AS office_names
           FROM users u JOIN positions rp ON rp.id = u.position_id
           LEFT JOIN positions ap ON ap.id = u.approved_position_id
           ${userJoins}
           WHERE u.disabled_at IS NULL AND u.position_id IS DISTINCT FROM u.approved_position_id
           ORDER BY u.position_requested_at ASC NULLS LAST, u.id`),
    // (b) office changes and person links
    query(`SELECT ${userCols},
                  q.id, q.kind, q.created_at, q.note, q.person_id, q.office_id, q.team_id,
                  COALESCE(tb_user_level(u.id), 0) AS level, ap.name AS approved,
                  no.name AS to_office, COALESCE(no.archived, false) AS to_office_archived, fo.name AS from_office,
                  nt.name AS to_team, (nt.id IS NOT NULL AND nt.office_id = q.office_id AND NOT nt.archived) AS to_team_ok,
                  (SELECT count(*) FROM projects p JOIN teams tt ON tt.id = p.team_id
                   WHERE NOT p.archived AND NOT tt.archived AND tt.office_id = q.office_id)::int AS to_office_projects,
                  (SELECT count(*) FROM projects p JOIN teams tt ON tt.id = p.team_id
                   WHERE NOT p.archived AND NOT tt.archived AND tt.office_id = COALESCE(q.from_office_id, u.office_id))::int
                     AS from_office_projects,
                  pp.name AS person, pp.color AS person_color, pp.kind AS person_kind, pp.archived_at AS person_archived_at,
                  pp.user_id AS person_user_id, ${nameSql('pu')} AS person_linked_to,
                  (SELECT count(*) FROM tasks k WHERE k.assignee_id = q.person_id)::int AS person_tasks,
                  (SELECT count(DISTINCT k.project_id) FROM tasks k WHERE k.assignee_id = q.person_id)::int AS person_projects,
                  (SELECT count(DISTINCT k.project_id) FROM tasks k WHERE k.assignee_id = q.person_id
                     AND NOT EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = k.project_id
                                       AND pm.user_id = q.user_id AND pm.removed_at IS NULL))::int AS person_new_projects,
                  own.id AS own_person_id, own.name AS own_person,
                  (SELECT count(*) FROM tasks k WHERE k.assignee_id = own.id)::int AS own_person_tasks,
                  (SELECT count(*) FROM access_requests q2 WHERE q2.kind = 'person_link' AND q2.status = 'pending'
                     AND q2.person_id = q.person_id AND q2.id <> q.id)::int AS others_asking
           FROM access_requests q JOIN users u ON u.id = q.user_id
           LEFT JOIN positions ap ON ap.id = u.approved_position_id
           LEFT JOIN offices no ON no.id = q.office_id
           LEFT JOIN offices fo ON fo.id = COALESCE(q.from_office_id, u.office_id)
           LEFT JOIN teams nt ON nt.id = q.team_id
           LEFT JOIN people pp ON pp.id = q.person_id
           LEFT JOIN users pu ON pu.id = pp.user_id
           LEFT JOIN people own ON own.user_id = u.id AND own.id IS DISTINCT FROM q.person_id
           ${userJoins}
           WHERE q.status = 'pending' AND u.disabled_at IS NULL
           ORDER BY q.created_at, q.id`),
    // (c) identity checks (derived: profile complete, not verified)
    query(`SELECT ${userCols}, u.updated_at
           FROM users u ${userJoins}
           WHERE u.disabled_at IS NULL AND u.profile_completed_at IS NOT NULL AND u.identity_verified_at IS NULL
           ORDER BY u.profile_completed_at, u.id`),
    query(`SELECT count(*)::int AS n FROM projects`),
    query(`SELECT id, name, level, archived, sort FROM positions ORDER BY archived, sort, id`),
  ], { readOnly: true });
  const [pos, reqs, ident] = res.slice(0, 3).map(rowsOf);
  const totalProjects = Number(res[3].rows[0]?.n || 0);
  const positions = rowsOf(res[4]).map((p) => ({ ...p, id: String(p.id), level: Number(p.level) }));
  const userOf = (r) => ({
    id: String(r.user_id), name: r.name, username: r.username, display_name: r.display_name || '', email: r.email,
    signed_up_at: r.signed_up_at, is_admin: !!r.is_admin, identity_verified: !!r.identity_verified,
    office: r.office, department: r.department, department_color: r.department_color, team: r.team, boss: r.boss,
    legacy_user: !!r.legacy_user, test_account: /^zz_/.test(r.username),
  });
  const items = [];
  for (const r of pos) {
    items.push({
      key: `position:${r.user_id}`, type: 'position', at: r.position_requested_at || r.profile_completed_at || r.signed_up_at,
      user: userOf(r),
      requested: { id: String(r.requested_id), name: r.requested, level: Number(r.requested_level) },
      approved: r.approved_id == null ? null : { id: String(r.approved_id), name: r.approved, level: Number(r.approved_level) },
      consequence: positionConsequence(r, totalProjects),
    });
  }
  for (const r of reqs) {
    const base = { key: `request:${r.id}`, id: String(r.id), at: r.created_at, user: userOf(r), note: r.note || '' };
    if (r.kind === 'office_change') {
      items.push({ ...base, type: 'office_change', to_office: r.to_office, from_office: r.from_office, to_team: r.to_team,
        consequence: officeConsequence(r) });
    } else {
      items.push({ ...base, type: 'person_link', person: r.person, person_color: r.person_color,
        blocked: !!(r.person_user_id || r.person_kind === 'group' || r.person_archived_at || !r.person_id
          || (r.own_person_id && Number(r.own_person_tasks) > 0)),
        consequence: linkConsequence(r) });
    }
  }
  for (const r of ident) {
    items.push({ key: `identity:${r.user_id}`, type: 'identity', at: r.profile_completed_at, user: userOf(r),
      consequence: identityConsequence(r) });
  }
  const t = (v) => (v ? Date.parse(v) : Number.MAX_SAFE_INTEGER);
  items.sort((a, b) => (t(a.at) - t(b.at)) || a.key.localeCompare(b.key));
  const counts = {
    positions: pos.length, office_changes: reqs.filter((r) => r.kind === 'office_change').length,
    person_links: reqs.filter((r) => r.kind === 'person_link').length, identity: ident.length,
  };
  counts.total = counts.positions + counts.office_changes + counts.person_links + counts.identity;
  return { items, positions, counts };
});

// Just the numbers (admin sub-nav badge; the Home admin widget may use it too).
export const loadApprovalCounts = cache(async () => {
  const r = await query(
    `SELECT (SELECT count(*) FROM users u JOIN positions rp ON rp.id = u.position_id
             WHERE u.disabled_at IS NULL AND u.position_id IS DISTINCT FROM u.approved_position_id)::int AS positions,
            (SELECT count(*) FROM access_requests q JOIN users u ON u.id = q.user_id
             WHERE q.status = 'pending' AND q.kind = 'office_change' AND u.disabled_at IS NULL)::int AS office_changes,
            (SELECT count(*) FROM access_requests q JOIN users u ON u.id = q.user_id
             WHERE q.status = 'pending' AND q.kind = 'person_link' AND u.disabled_at IS NULL)::int AS person_links,
            (SELECT count(*) FROM users u WHERE u.disabled_at IS NULL AND u.profile_completed_at IS NOT NULL
               AND u.identity_verified_at IS NULL)::int AS identity`);
  const c = r.rows[0] || {};
  const out = {
    positions: Number(c.positions || 0), office_changes: Number(c.office_changes || 0),
    person_links: Number(c.person_links || 0), identity: Number(c.identity || 0),
  };
  out.total = out.positions + out.office_changes + out.person_links + out.identity;
  return out;
});

// ---------------------------------------------------------------- organization (/admin/org)

export const loadOrg = cache(async () => {
  const res = await transaction([
    query(`SELECT o.id, o.name, o.position, o.archived, o.geo_on, o.fivek, o.tz,
                  (SELECT count(*) FROM geo_scores g WHERE g.office_id = o.id)::int AS geo_scores,
                  (SELECT count(*) FROM teams t WHERE t.office_id = o.id)::int AS team_count,
                  (SELECT count(*) FROM teams t WHERE t.office_id = o.id AND NOT t.archived)::int AS active_teams,
                  (SELECT count(*) FROM users u WHERE u.office_id = o.id)::int AS people,
                  (SELECT count(*) FROM user_offices x WHERE x.office_id = o.id AND x.revoked_at IS NULL)::int AS extra_people,
                  (SELECT count(*) FROM projects p JOIN teams t ON t.id = p.team_id WHERE t.office_id = o.id)::int AS project_count
           FROM offices o ORDER BY o.archived, o.position, o.id`),
    query(`SELECT t.id, t.name, t.office_id, t.position, t.archived,
                  (SELECT count(*) FROM projects p WHERE p.team_id = t.id)::int AS project_count,
                  (SELECT count(*) FROM projects p WHERE p.team_id = t.id AND NOT p.archived)::int AS active_projects,
                  (SELECT count(*) FROM users u WHERE u.team_id = t.id AND u.disabled_at IS NULL)::int AS members,
                  (SELECT count(*) FROM team_members x JOIN users u ON u.id = x.user_id
                   WHERE x.team_id = t.id AND x.removed_at IS NULL AND u.disabled_at IS NULL)::int AS roster,
                  (SELECT count(*) FROM team_members x JOIN users u ON u.id = x.user_id
                   WHERE x.team_id = t.id AND x.removed_at IS NULL AND u.disabled_at IS NULL AND x.role = 'pm')::int AS roster_pms
           FROM teams t ORDER BY t.position, t.id`),
    query(`SELECT d.id, d.key, d.name, d.color, d.sort, d.archived,
                  (SELECT count(*) FROM users u WHERE u.department_id = d.id AND u.disabled_at IS NULL)::int AS members
           FROM departments d ORDER BY d.archived, d.sort, d.id`),
    query(`SELECT p.id, p.key, p.name, p.level, p.sort, p.archived,
                  (SELECT count(*) FROM users u WHERE u.approved_position_id = p.id AND u.disabled_at IS NULL)::int AS holders,
                  (SELECT count(*) FROM users u WHERE u.position_id = p.id AND u.approved_position_id IS DISTINCT FROM p.id
                     AND u.disabled_at IS NULL)::int AS pending
           FROM positions p ORDER BY p.archived, p.sort, p.id`),
  ], { readOnly: true });
  const [offices, teams, departments, positions] = res.map(rowsOf);
  const s = (x) => (x == null ? null : String(x));
  return {
    offices: offices.map((o) => ({ ...o, id: s(o.id), fivek: Number(o.fivek) || 0, position: Number(o.position) })),
    teams: teams.map((t) => ({ ...t, id: s(t.id), office_id: s(t.office_id), position: Number(t.position) })),
    departments: departments.map((d) => ({ ...d, id: s(d.id), sort: Number(d.sort) })),
    positions: positions.map((p) => ({ ...p, id: s(p.id), level: Number(p.level), sort: Number(p.sort) })),
  };
});

// Reorder offices: the given ids take the existing position values of that set, in the new order (archived
// offices keep theirs, so GeoGuessr's archived columns don't jump). Ties are spread so the order sticks.
// One statement. -> number of offices moved
export async function reorderOffices(ids) {
  const r = await query(
    `WITH ids AS (SELECT t.id, t.ord FROM unnest($1::bigint[]) WITH ORDINALITY AS t(id, ord)
                  WHERE EXISTS (SELECT 1 FROM offices o WHERE o.id = t.id)),
     ranked AS (SELECT id, row_number() OVER (ORDER BY ord) AS rn FROM ids),
     cur AS (SELECT position AS pos, row_number() OVER (ORDER BY position, id) AS rn FROM offices
             WHERE id IN (SELECT id FROM ids)),
     fixed AS (SELECT rn, rn + max(pos - rn) OVER (ORDER BY rn ROWS UNBOUNDED PRECEDING) AS pos FROM cur)
     UPDATE offices o SET position = f.pos FROM ranked r JOIN fixed f ON f.rn = r.rn
     WHERE o.id = r.id RETURNING o.id`,
    [ids.map(String)]);
  return r.rows.length;
}

// Delete an office (admin; two confirms in the UI). Refused while it has GeoGuessr history (scores or 5Ks:
// rules 3-4). The whole tree that goes with the cascade is snapshotted to audit_log in the same statement.
// People whose home office it is (users.office_id RESTRICT) make it fail with 23001: the route says
// "archive it instead". -> { deleted, existed, scores, fivek }
export async function deleteOffice({ adminId, officeId }) {
  const agg = (sqlText, order = 'x.id') => `COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY ${order}) FROM ${sqlText}), '[]'::jsonb)`;
  const r = await query(
    `WITH s AS (SELECT * FROM offices WHERE id = $1::bigint AND fivek = 0
                  AND NOT EXISTS (SELECT 1 FROM geo_scores g WHERE g.office_id = $1::bigint)),
     tm AS (SELECT * FROM teams WHERE office_id IN (SELECT id FROM s)),
     pj AS (SELECT * FROM projects WHERE team_id IN (SELECT id FROM tm)),
     snap AS (SELECT jsonb_build_object(
       'row', (SELECT to_jsonb(s) FROM s),
       'teams', ${agg('tm x')},
       'projects', ${agg('pj x')},
       'tasks', ${agg('tasks x WHERE x.project_id IN (SELECT id FROM pj)')},
       'project_info', ${agg('project_info x WHERE x.project_id IN (SELECT id FROM pj)')},
       'meeting_series', ${agg('meeting_series x WHERE x.project_id IN (SELECT id FROM pj)')},
       'project_meetings', ${agg('project_meetings x WHERE x.project_id IN (SELECT id FROM pj)')},
       'project_members', ${agg('project_members x WHERE x.project_id IN (SELECT id FROM pj)', 'x.project_id, x.user_id')},
       'team_members', ${agg('team_members x WHERE x.team_id IN (SELECT id FROM tm)', 'x.team_id, x.user_id')},
       'meetings', ${agg('meetings x WHERE x.office_id IN (SELECT id FROM s)')},
       'user_offices', ${agg('user_offices x WHERE x.office_id IN (SELECT id FROM s)', 'x.user_id')}) AS detail),
     d AS (DELETE FROM offices o USING s WHERE o.id = s.id RETURNING o.id),
     a AS (INSERT INTO audit_log (actor_id, action, entity, entity_id, detail)
           SELECT $2::bigint, 'office.delete', 'offices', d.id::text, snap.detail FROM d CROSS JOIN snap)
     SELECT (SELECT count(*) FROM d)::int AS deleted, EXISTS (SELECT 1 FROM offices WHERE id = $1::bigint) AS existed,
            (SELECT count(*) FROM geo_scores WHERE office_id = $1::bigint)::int AS scores,
            (SELECT fivek FROM offices WHERE id = $1::bigint) AS fivek`,
    [id(officeId), id(adminId)]);
  const x = r.rows[0] || {};
  return { deleted: Number(x.deleted || 0), existed: !!x.existed, scores: Number(x.scores || 0), fivek: Number(x.fivek || 0) };
}

// What still points at an office (for the "archive it instead" message).
export async function officeUsage(officeId) {
  const r = await query(
    `SELECT o.name, (SELECT count(*) FROM users u WHERE u.office_id = o.id)::int AS people
     FROM offices o WHERE o.id = $1::bigint`, [id(officeId)]);
  return r.rows[0] ? { name: r.rows[0].name, people: Number(r.rows[0].people || 0) } : null;
}

// ---------------------------------------------------------------- positions and departments (§8.2)

// A stable, unique key for a new row: the name as a slug, with a numeric suffix when taken.
export async function uniqueKey(table, name) {
  if (table !== 'positions' && table !== 'departments') throw new Error('uniqueKey: bad table');
  const slug = String(name).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'item';
  const r = await query(`SELECT key FROM ${table} WHERE key = $1::text OR starts_with(key, $2::text)`, [slug, `${slug}_`]);
  const taken = new Set(r.rows.map((x) => x.key));
  if (!taken.has(slug)) return slug;
  for (let i = 2; i < 1000; i++) if (!taken.has(`${slug}_${i}`)) return `${slug}_${i}`;
  return `${slug}_${Date.now()}`;
}

// ---------------------------------------------------------------- names on tasks (people)

// Roster for /people/names and pickers (GET /api/people): non-archived unless includeArchived (admins).
// The linked account's name is public (the roster shows "Linked to Kyler Hugg"); task counts are admin-only.
export async function listRoster({ includeArchived = false, withCounts = false } = {}) {
  const r = await query(
    `SELECT p.id, p.name, p.color, p.kind, p.user_id, p.archived_at, p.created_at,
            ${nameSql('u')} AS user_name, u.username AS user_username, (u.identity_verified_at IS NOT NULL) AS user_verified
            ${withCounts ? `, (SELECT count(*) FROM tasks k WHERE k.assignee_id = p.id)::int AS task_count` : ''}
     FROM people p LEFT JOIN users u ON u.id = p.user_id
     WHERE ($1::boolean OR p.archived_at IS NULL)
     ORDER BY lower(p.name), p.id`, [!!includeArchived]);
  return r.rows.map((x) => ({ ...plain(x), id: String(x.id), user_id: x.user_id == null ? null : String(x.user_id) }));
}

const PERSON_RET = `id, name, color, kind, user_id, archived_at, created_at`;
export async function loadPerson(personId) {
  const r = await query(`SELECT ${PERSON_RET} FROM people WHERE id = $1::bigint`, [id(personId)]);
  return r.rows[0] ? { ...plain(r.rows[0]), id: String(r.rows[0].id), user_id: r.rows[0].user_id == null ? null : String(r.rows[0].user_id) } : null;
}

// Admin links a name to an account directly (§5.4: "the same statements without a request"): retire the
// account's own name only if it has no tasks, link, add task-based memberships, close that user's pending
// "that's me" request for this name, audit. -> { linked, projects_added }
export async function linkPersonDirect({ adminId, personId, userId }) {
  const pid = id(personId), uid = id(userId), admin = id(adminId);
  const res = await transaction([
    query(`SELECT p.id FROM people p WHERE p.id = $1::bigint FOR UPDATE`, [pid]),
    query(`UPDATE people o SET user_id = NULL, archived_at = COALESCE(o.archived_at, now())
           WHERE o.user_id = $2::bigint AND o.id <> $1::bigint
             AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.assignee_id = o.id)
             AND EXISTS (SELECT 1 FROM people c WHERE c.id = $1::bigint AND c.user_id IS NULL AND c.kind = 'person'
                           AND c.archived_at IS NULL)
             AND EXISTS (SELECT 1 FROM users u WHERE u.id = $2::bigint)`, [pid, uid]),
    query(`WITH l AS (UPDATE people p SET user_id = $2::bigint
                      WHERE p.id = $1::bigint AND p.user_id IS NULL AND p.kind = 'person' AND p.archived_at IS NULL
                        AND NOT EXISTS (SELECT 1 FROM people x WHERE x.user_id = $2::bigint)
                        AND EXISTS (SELECT 1 FROM users u WHERE u.id = $2::bigint)
                      RETURNING p.id, p.user_id),
           m AS (INSERT INTO project_members (project_id, user_id, source, added_by)
                 SELECT DISTINCT t.project_id, l.user_id, 'task'::text, $3::bigint FROM l JOIN tasks t ON t.assignee_id = l.id
                 ON CONFLICT (project_id, user_id) DO UPDATE
                   SET source = 'task', removed_at = NULL, removed_by = NULL, remove_batch = NULL
                   WHERE project_members.removed_at IS NOT NULL
                 RETURNING project_id),
           rv AS (UPDATE projects SET rev = rev + 1 WHERE id IN (SELECT project_id FROM m)),
           q AS (UPDATE access_requests a SET status = 'approved', decided_by = $3::bigint, decided_at = now(),
                   decision_note = 'Linked directly by an admin'
                 FROM l WHERE a.user_id = l.user_id AND a.kind = 'person_link' AND a.status = 'pending' AND a.person_id = l.id
                 RETURNING a.id),
           a AS (INSERT INTO audit_log (actor_id, action, entity, entity_id, detail)
                 SELECT $3::bigint, 'person.link', 'people', l.id::text,
                        jsonb_build_object('user_id', l.user_id, 'direct', true) FROM l)
           SELECT (SELECT count(*) FROM l)::int AS linked, (SELECT count(*) FROM m)::int AS projects_added`,
      [pid, uid, admin]),
  ]);
  const x = res[2].rows[0] || {};
  return { linked: Number(x.linked || 0), projects_added: Number(x.projects_added || 0) };
}

// Unlink (admin). Memberships stay (unassigning never removes access either). -> previous user id or null.
export async function unlinkPerson({ adminId, personId }) {
  const r = await query(
    `WITH old AS (SELECT id, user_id FROM people WHERE id = $1::bigint AND user_id IS NOT NULL FOR UPDATE),
     u AS (UPDATE people p SET user_id = NULL FROM old WHERE p.id = old.id RETURNING p.id),
     a AS (INSERT INTO audit_log (actor_id, action, entity, entity_id, detail)
           SELECT $2::bigint, 'person.unlink', 'people', old.id::text, jsonb_build_object('user_id', old.user_id) FROM old)
     SELECT old.user_id FROM old`,
    [id(personId), id(adminId)]);
  return r.rows[0]?.user_id == null ? null : String(r.rows[0].user_id);
}

// /admin/people: every name (archived too) with its link, tasks and pending claims, plus accounts to link.
export const listPeopleAdmin = cache(async () => {
  const res = await transaction([
    query(`SELECT p.id, p.name, p.color, p.kind, p.user_id, p.archived_at, p.created_at,
                  ${nameSql('u')} AS user_name, u.username AS user_username, (u.disabled_at IS NOT NULL) AS user_disabled,
                  (u.identity_verified_at IS NOT NULL) AS user_verified,
                  (SELECT count(*) FROM tasks k WHERE k.assignee_id = p.id)::int AS task_count,
                  (SELECT count(*) FROM tasks k WHERE k.assignee_id = p.id AND NOT k.archived)::int AS open_tasks,
                  (SELECT count(DISTINCT k.project_id) FROM tasks k WHERE k.assignee_id = p.id)::int AS project_count,
                  COALESCE((SELECT json_agg(json_build_object('id', q.id::text, 'user_id', q.user_id::text,
                                                              'name', ${nameSql('qu')}, 'username', qu.username) ORDER BY q.id)
                            FROM access_requests q JOIN users qu ON qu.id = q.user_id
                            WHERE q.person_id = p.id AND q.kind = 'person_link' AND q.status = 'pending'), '[]'::json) AS requests
           FROM people p LEFT JOIN users u ON u.id = p.user_id
           ORDER BY (p.archived_at IS NOT NULL), lower(p.name), p.id`),
    query(`SELECT u.id, ${nameSql('u')} AS name, u.username, u.display_name, u.email, (u.disabled_at IS NOT NULL) AS disabled,
                  own.id AS person_id, own.name AS person_name,
                  (SELECT count(*) FROM tasks k WHERE k.assignee_id = own.id)::int AS person_tasks
           FROM users u LEFT JOIN people own ON own.user_id = u.id
           ORDER BY lower(${nameSql('u')}), u.id`),
  ], { readOnly: true });
  const s = (x) => (x == null ? null : String(x));
  const people = rowsOf(res[0]).map((p) => ({ ...p, id: s(p.id), user_id: s(p.user_id) }));
  const users = rowsOf(res[1]).map((u) => ({ ...u, id: s(u.id), person_id: s(u.person_id), test_account: /^zz_/.test(u.username) }));
  return { people, users };
});

// ---------------------------------------------------------------- health and the /admin home

const HEALTH_TABLES = [
  'users', 'sessions', 'people', 'offices', 'teams', 'projects', 'tasks', 'project_info', 'meetings', 'geo_scores',
  'meeting_series', 'project_meetings', 'brackets', 'bracket_entrants', 'bracket_matches', 'bracket_votes',
  'suggestions', 'suggestion_votes', 'suggestion_replies',
  'schema_meta', 'positions', 'departments', 'project_members', 'team_members', 'user_offices', 'access_requests', 'audit_log',
  // Release 2 thread spaces (design-amendments A5 replaced the §3.3 threads / thread_posts / thread_reads tables).
  'auth_throttle', 'space_posts', 'space_reads', 'culture_challenges', 'culture_entries', 'culture_events',
];

// Row counts per table, schema version (code vs database), the ledger, and a few integrity facts.
export const loadHealth = cache(async () => {
  const present = (await query(`SELECT n FROM unnest($1::text[]) AS n WHERE to_regclass(n) IS NOT NULL`, [HEALTH_TABLES]))
    .rows.map((x) => x.n).filter((n) => HEALTH_TABLES.includes(n));
  const countSql = present.map((n) => `SELECT '${n}' AS t, count(*)::int AS n FROM ${n}`).join(' UNION ALL ');
  const res = await transaction([
    query(countSql || `SELECT 'none' AS t, 0 AS n`),
    query(`SELECT key, value, updated_at FROM schema_meta ORDER BY key`),
    query(`SELECT
             (SELECT count(*) FROM project_members WHERE source = 'legacy' AND removed_at IS NULL)::int AS legacy_active,
             (SELECT count(*) FROM project_members WHERE source = 'legacy' AND removed_at IS NOT NULL)::int AS legacy_removed,
             (SELECT count(*) FROM project_members WHERE removed_at IS NULL)::int AS members_active,
             (SELECT count(*) FROM users WHERE username NOT LIKE 'zz!_%' ESCAPE '!')::int AS real_users,
             (SELECT count(*) FROM users WHERE disabled_at IS NULL)::int AS active_users,
             (SELECT count(*) FROM users WHERE is_admin AND disabled_at IS NULL)::int AS admins,
             (SELECT count(*) FROM users WHERE is_organizer AND disabled_at IS NULL)::int AS organizers,
             (SELECT count(*) FROM users WHERE profile_completed_at IS NULL AND disabled_at IS NULL)::int AS profiles_pending,
             (SELECT count(*) FROM user_offices WHERE revoked_at IS NULL)::int AS extra_grants,
             (SELECT confdeltype::text FROM pg_constraint WHERE conname = 'geo_scores_office_id_fkey' LIMIT 1) AS geo_fk`),
  ], { readOnly: true });
  const counts = Object.fromEntries(res[0].rows.filter((x) => x.t !== 'none').map((x) => [x.t, Number(x.n)]));
  const ledger = rowsOf(res[1]);
  const stats = plain(res[2].rows[0] || {});
  const stored = ledger.find((x) => x.key === 'version')?.value || null;
  const releasedAt = ledger.find((x) => x.key === 'release1_at')?.value || null;
  return {
    tables: HEALTH_TABLES.map((t) => ({ table: t, rows: Object.prototype.hasOwnProperty.call(counts, t) ? counts[t] : null })),
    ledger, stats,
    version: { code: SCHEMA_VERSION, stored, current: stored === SCHEMA_VERSION },
    released_at: releasedAt && /^[0-9]+$/.test(releasedAt) ? new Date(Number(releasedAt)).toISOString() : null,
    geo_guard: stats.geo_fk === 'r',
  };
});

// /admin: the queue's oldest items, health, the signup-code banner and Neil's post-deploy checklist (§16).
export async function loadAdminHome(viewer) {
  const [queue, health, extra] = await Promise.all([
    listApprovals(), loadHealth(),
    transaction([
      query(`SELECT o.name FROM offices o WHERE NOT o.archived
               AND NOT EXISTS (SELECT 1 FROM teams t WHERE t.office_id = o.id AND NOT t.archived)
             ORDER BY o.position, o.id`),
      // Applied = an everyone-batch that still has rows removed (an undone batch doesn't count).
      query(`SELECT EXISTS (SELECT 1 FROM audit_log a WHERE a.action = 'member.prune_legacy' AND a.entity_id = 'all'
                              AND EXISTS (SELECT 1 FROM project_members m WHERE m.remove_batch = a.id AND m.removed_at IS NOT NULL))
                AS applied`),
      query(`SELECT count(*)::int AS n FROM people WHERE kind = 'person' AND user_id IS NULL AND archived_at IS NULL`),
    ], { readOnly: true }),
  ]);
  return {
    queue: { counts: queue.counts, oldest: queue.items.slice(0, 5) },
    health,
    signupFallback: signupCodeFallback(),
    checklist: {
      me_linked: !!viewer.person_id,
      me_profile: !!viewer.profile_done,
      offices_without_teams: extra[0].rows.map((x) => x.name),
      rules_applied: !!extra[1].rows[0]?.applied,
      unlinked_names: Number(extra[2].rows[0]?.n || 0),
    },
  };
}
