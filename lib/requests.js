import 'server-only';
import { query, transaction } from './db.js';

// Approval statements (design §4.2, §5.4, §5.5): position decisions, office changes, person links and
// identity checks. Each decision applies only to the state the admin saw, and a request is marked approved
// only by the same statement that applied it, so request state can never disagree with the user row.
// Every function returns plain counts or flags; the route turns "nothing happened" into its 409 text.
//
// verify: "Approving any other item for the same user also verifies them unless the admin unticks
// 'Name and email look right'" (§5.5). The verification is folded into the same UPDATE of users, because
// two UPDATEs of one row in one statement silently drop one of them.

const id = (v) => (v == null ? null : String(v));
const VERIFY_SET = (admin, verify) => `
  identity_verified_at = CASE WHEN ${verify}::boolean THEN COALESCE(identity_verified_at, now()) ELSE identity_verified_at END,
  identity_verified_by = CASE WHEN ${verify}::boolean AND identity_verified_at IS NULL THEN ${admin}::bigint
                              ELSE identity_verified_by END`;

// ---------------------------------------------------------------- positions (§4.2a: derived queue)

// Approve the position the user asked for, if it is still the one the admin saw. -> true, or false (409
// "This request changed. Refresh.").
export async function approvePosition({ adminId, userId, expectedPositionId, verify = false }) {
  const r = await query(
    `WITH u AS (UPDATE users SET approved_position_id = position_id, position_decided_at = now(),
                  position_decided_by = $1::bigint, updated_at = now(), ${VERIFY_SET('$1', '$4')}
                WHERE id = $2::bigint AND position_id = $3::bigint AND position_id IS DISTINCT FROM approved_position_id
                RETURNING id, position_id)
     INSERT INTO audit_log (actor_id, action, entity, entity_id, detail)
     SELECT $1::bigint, 'position.approve', 'users', u.id::text, jsonb_build_object('position_id', u.position_id) FROM u
     RETURNING entity_id`,
    [id(adminId), id(userId), id(expectedPositionId), !!verify]);
  return r.rows.length > 0;
}

// Set (and approve) any position; also covers "deny" (the admin picks the right one). expectedPositionId is
// what the admin saw as requested (null when nothing was requested).
export async function setPosition({ adminId, userId, expectedPositionId, positionId, verify = false }) {
  const r = await query(
    `WITH u AS (UPDATE users SET position_id = $3::bigint, approved_position_id = $3::bigint, position_decided_at = now(),
                  position_decided_by = $1::bigint, updated_at = now(), ${VERIFY_SET('$1', '$5')}
                WHERE id = $2::bigint AND position_id IS NOT DISTINCT FROM $4::bigint
                RETURNING id)
     INSERT INTO audit_log (actor_id, action, entity, entity_id, detail)
     SELECT $1::bigint, 'position.set', 'users', u.id::text, jsonb_build_object('position_id', $3::bigint) FROM u
     RETURNING entity_id`,
    [id(adminId), id(userId), id(positionId), id(expectedPositionId), !!verify]);
  return r.rows.length > 0;
}

// ---------------------------------------------------------------- requests by the user (immutable; a re-request supersedes)

// After onboarding, a different home office is a request (§4.2b). One transaction: supersede any pending
// one, then insert. Both steps are skipped when the office isn't active, so a bad pick never drops the
// previous request. -> the new request id, or null.
export async function requestOfficeChange({ userId, officeId, teamId = null, fromOfficeId = null, note = '' }) {
  const ok = 'EXISTS (SELECT 1 FROM offices o WHERE o.id = $2::bigint AND NOT o.archived)';
  const res = await transaction([
    query(`UPDATE access_requests SET status = 'superseded'
           WHERE user_id = $1::bigint AND kind = 'office_change' AND status = 'pending' AND ${ok}`,
      [id(userId), id(officeId)]),
    query(`INSERT INTO access_requests (user_id, kind, office_id, team_id, from_office_id, note)
           SELECT $1::bigint, 'office_change', $2::bigint, $3::bigint, $4::bigint, $5::text WHERE ${ok}
           RETURNING id`,
      [id(userId), id(officeId), id(teamId), id(fromOfficeId), String(note ?? '')]),
  ]);
  return res[1].rows[0]?.id ?? null;
}

// "That's me" (§5.2 step 3, §5.4): only an unlinked, unarchived person row can be claimed. -> id or null.
export async function requestPersonLink({ userId, personId, note = '' }) {
  const ok = `EXISTS (SELECT 1 FROM people p WHERE p.id = $2::bigint AND p.user_id IS NULL AND p.kind = 'person'
                        AND p.archived_at IS NULL)`;
  const res = await transaction([
    query(`UPDATE access_requests SET status = 'superseded'
           WHERE user_id = $1::bigint AND kind = 'person_link' AND status = 'pending' AND ${ok}`,
      [id(userId), id(personId)]),
    query(`INSERT INTO access_requests (user_id, kind, person_id, note)
           SELECT $1::bigint, 'person_link', $2::bigint, $3::text WHERE ${ok}
           RETURNING id`,
      [id(userId), id(personId), String(note ?? '')]),
  ]);
  return res[1].rows[0]?.id ?? null;
}

// The user withdraws their own pending request. -> true, or false when it was already decided.
export async function withdrawRequest({ userId, requestId }) {
  const r = await query(
    `UPDATE access_requests SET status = 'withdrawn', decided_at = now()
     WHERE id = $1::bigint AND user_id = $2::bigint AND status = 'pending' RETURNING id`,
    [id(requestId), id(userId)]);
  return r.rows.length > 0;
}

// ---------------------------------------------------------------- admin decisions on requests

// Office change: write the user first, then mark the request. -> { pending, approved }:
//   pending 0 -> 409 "Someone already decided this request."
//   pending 1, approved 0 -> the office was archived or deleted since (409 "That office is no longer available.").
// The team comes along only when it still sits, active, in the new office. Memberships are untouched.
export async function approveOfficeChange({ adminId, requestId, note = '', verify = false }) {
  const r = await query(
    `WITH q AS (SELECT id, user_id, office_id, team_id FROM access_requests
                WHERE id = $2::bigint AND kind = 'office_change' AND status = 'pending' FOR UPDATE),
     u AS (UPDATE users SET office_id = q.office_id,
             team_id = (SELECT t.id FROM teams t WHERE t.id = q.team_id AND t.office_id = q.office_id AND NOT t.archived),
             updated_at = now(), ${VERIFY_SET('$1', '$4')}
           FROM q WHERE users.id = q.user_id
             AND EXISTS (SELECT 1 FROM offices o WHERE o.id = q.office_id AND NOT o.archived)
           RETURNING users.id),
     r AS (UPDATE access_requests a SET status = 'approved', decided_by = $1::bigint, decided_at = now(),
             decision_note = $3::text
           FROM u WHERE a.id = $2::bigint RETURNING a.id),
     a AS (INSERT INTO audit_log (actor_id, action, entity, entity_id, detail)
           SELECT $1::bigint, 'office_change.approve', 'users', q.user_id::text, to_jsonb(q) FROM q JOIN r ON true)
     SELECT (SELECT count(*) FROM q)::int AS pending, (SELECT count(*) FROM r)::int AS approved`,
    [id(adminId), id(requestId), String(note ?? ''), !!verify]);
  const row = r.rows[0] || {};
  return { pending: Number(row.pending || 0), approved: Number(row.approved || 0) };
}

// Person link (§5.4), one batch transaction. -> { pending, linked, projects_added }:
//   pending 0 -> 409 "Someone already decided this request."
//   linked 0 -> 409 "That name is already linked, or this account already has its own name with tasks.
//               Reassign those tasks on the board first." (the request stays pending)
export async function approvePersonLink({ adminId, requestId, note = '', verify = false }) {
  const rid = id(requestId), admin = id(adminId);
  const res = await transaction([
    // 1. lock the request and the claimed person
    query(`SELECT q.id FROM access_requests q JOIN people c ON c.id = q.person_id
           WHERE q.id = $1::bigint AND q.kind = 'person_link' AND q.status = 'pending' FOR UPDATE OF q, c`, [rid]),
    // 2. retire the user's own auto-created name ONLY if it has no tasks and the claim is linkable (archive, never delete)
    query(`UPDATE people o SET user_id = NULL, archived_at = now()
           WHERE o.user_id = (SELECT user_id FROM access_requests WHERE id = $1::bigint AND status = 'pending')
             AND o.id <> (SELECT person_id FROM access_requests WHERE id = $1::bigint)
             AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.assignee_id = o.id)
             AND EXISTS (SELECT 1 FROM access_requests q JOIN people c ON c.id = q.person_id
                         WHERE q.id = $1::bigint AND q.kind = 'person_link' AND q.status = 'pending'
                           AND c.user_id IS NULL AND c.kind = 'person' AND c.archived_at IS NULL)`, [rid]),
    // 3. link, then mark the request ONLY if the link happened; add task-based memberships
    query(`WITH q AS (SELECT id, user_id, person_id FROM access_requests
                      WHERE id = $1::bigint AND kind = 'person_link' AND status = 'pending'),
           l AS (UPDATE people p SET user_id = q.user_id FROM q
                 WHERE p.id = q.person_id AND p.user_id IS NULL AND p.kind = 'person' AND p.archived_at IS NULL
                   AND NOT EXISTS (SELECT 1 FROM people x WHERE x.user_id = q.user_id)
                 RETURNING p.id, p.user_id),
           r AS (UPDATE access_requests a SET status = 'approved', decided_by = $2::bigint, decided_at = now(),
                   decision_note = $3::text
                 FROM l WHERE a.id = $1::bigint RETURNING a.id),
           m AS (INSERT INTO project_members (project_id, user_id, source, added_by)
                 SELECT DISTINCT t.project_id, l.user_id, 'task'::text, $2::bigint FROM l JOIN tasks t ON t.assignee_id = l.id
                 ON CONFLICT (project_id, user_id) DO UPDATE
                   SET source = 'task', removed_at = NULL, removed_by = NULL, remove_batch = NULL
                   WHERE project_members.removed_at IS NOT NULL
                 RETURNING project_id),
           a AS (INSERT INTO audit_log (actor_id, action, entity, entity_id, detail)
                 SELECT $2::bigint, 'person.link', 'people', l.id::text, jsonb_build_object('user_id', l.user_id) FROM l)
           SELECT (SELECT count(*) FROM q)::int AS pending, (SELECT count(*) FROM l)::int AS linked,
                  (SELECT count(*) FROM m)::int AS projects_added`, [rid, admin, String(note ?? '')]),
    // 4. verify name and email along with it (only when this request was just approved)
    query(`UPDATE users SET identity_verified_at = now(), identity_verified_by = $2::bigint, updated_at = now()
           WHERE $3::boolean AND identity_verified_at IS NULL
             AND id = (SELECT user_id FROM access_requests WHERE id = $1::bigint AND status = 'approved'
                         AND decided_by = $2::bigint)`, [rid, admin, !!verify]),
  ]);
  const row = res[2].rows[0] || {};
  return { pending: Number(row.pending || 0), linked: Number(row.linked || 0), projects_added: Number(row.projects_added || 0) };
}

// Decline an office change or a person link. A declined person link makes sure the user has a name of their
// own, so tasks can still be assigned to them (§5.4). -> true, or false (409 "Someone already decided this request.").
export async function declineRequest({ adminId, requestId, note = '' }) {
  const rid = id(requestId), admin = id(adminId);
  const res = await transaction([
    query(`WITH r AS (UPDATE access_requests SET status = 'declined', decided_by = $2::bigint, decided_at = now(),
                        decision_note = $3::text
                      WHERE id = $1::bigint AND status = 'pending' RETURNING id, user_id, kind, person_id, office_id),
           a AS (INSERT INTO audit_log (actor_id, action, entity, entity_id, detail)
                 SELECT $2::bigint, r.kind || '.decline', 'access_requests', r.id::text, to_jsonb(r) FROM r)
           SELECT id FROM r`, [rid, admin, String(note ?? '')]),
    query(`INSERT INTO people (name, color, user_id)
           SELECT COALESCE(NULLIF(u.display_name, ''), u.username), '#5B5859', u.id FROM users u
           WHERE u.id = (SELECT user_id FROM access_requests WHERE id = $1::bigint AND kind = 'person_link'
                           AND status = 'declined')
             AND NOT EXISTS (SELECT 1 FROM people WHERE user_id = u.id)
             AND NOT EXISTS (SELECT 1 FROM access_requests WHERE user_id = u.id AND kind = 'person_link'
                               AND status = 'pending')`, [rid]),
  ]);
  return res[0].rows.length > 0;
}

// ---------------------------------------------------------------- identity (§5.1, §5.5)

// Admin "Verify": removes the "unverified" chip. -> true when the user exists.
export async function verifyIdentity({ adminId, userId }) {
  const r = await query(
    `WITH u AS (UPDATE users SET identity_verified_at = now(), identity_verified_by = $1::bigint, updated_at = now()
                WHERE id = $2::bigint RETURNING id)
     INSERT INTO audit_log (actor_id, action, entity, entity_id, detail)
     SELECT $1::bigint, 'identity.verify', 'users', u.id::text, '{}'::jsonb FROM u
     RETURNING entity_id`,
    [id(adminId), id(userId)]);
  return r.rows.length > 0;
}
