import 'server-only';
import { query, transaction } from './db.js';
import { HttpError, forbidden } from './http.js';
import { canEditRoster, canManageTeamsIn, inMyOffices, isAdmin } from './policy.js';

// Team rosters drive project membership (design-amendments A4). Every roster write applies its membership rule
// in the SAME statement, with an audit_log row:
//   3a  added to a team (or a removed roster row revived): every non-archived project of the team, source 'team'.
//       An active membership is left alone (it keeps 'legacy' / 'manual' / 'task' / 'creator', so legacy-manager
//       rights are never lost); a soft-removed one is revived as 'team'.
//   3c  removed from a team: only that person's roster rows ('team', and 'team_legacy' = a legacy row the prune
//       kept for the roster, rule 3d) on that team's projects are soft-removed (removed_by, remove_batch = the
//       audit row's id); manual, task, creator, legacy and admin rows stay. A roster row on a project where the
//       person owns a task stays too (the same test the legacy prune uses), relabeled 'task' ('team_legacy' goes
//       back to 'legacy'): sources are never relabeled when a task or a hand-add comes after the roster, so
//       without the test the outcome would depend on which came first.
// Rule 3b (a project created in or moved into a team) lives with the project writes (lib/queries/project.js
// createProject, teamMoveCtes below); 3d with the legacy prune (lib/queries/admin.js pruneLegacy).
//
// Concurrency: every write that reads a roster to change memberships (roster add / remove, project create and
// move, the legacy prune) runs as [ROSTER_LOCK, the write] in one READ COMMITTED transaction. The write is a
// new statement, so its snapshot is taken after the lock is granted: a create or move can't miss a roster change
// that committed just before it, and two moves of one project can't both start from the old team.
//
// Who edits a roster (A4.4, lib/policy.js canEditRoster): admins, L3 and up, L2 in the team's office, and anyone
// with role 'pm' on that team. The route checks it first; each statement checks it again (rightsCte), so a
// right lost meanwhile (a PM demoted, the team moved out of an L2's office) writes nothing.
// Archived teams (or teams in an archived office) take no roster changes: restore the team first.

const id = (v) => (v == null ? null : String(v));
export const ROSTER_ROLES = ['member', 'pm'];

// project_members sources a roster manages (rule 3c and the move remove them; the Members panel says "via <team>").
export const ROSTER_SOURCES_SQL = `('team', 'team_legacy')`;
// Sources that make someone a legacy manager of a pre-launch project (lib/policy.js isLegacyManager: the loaders'
// legacy_member). 'team_legacy' is a legacy row the prune kept because of the roster (rule 3d): the roster now
// manages it, and its holder keeps the rights design §6 promises ("each person remains a legacy manager of their
// own team's projects").
export const LEGACY_SOURCES_SQL = `('legacy', 'team_legacy')`;
// The person owns a task on the project (through their linked name; archived tasks count), as in pruneLegacy.
export const ownsTaskSql = (m) => `EXISTS (SELECT 1 FROM tasks tk JOIN people pk ON pk.id = tk.assignee_id
                 WHERE tk.project_id = ${m}.project_id AND pk.user_id = ${m}.user_id)`;
// A roster row kept because of a task becomes what a task gives: 'task' ('team_legacy' back to 'legacy').
const keptSource = (m) => `CASE WHEN ${m}.source = 'team_legacy' THEN 'legacy' ELSE 'task' END`;

// The roster lock (see "Concurrency" above). 7342001 is the migration's, 7342002 the admin / bracket one.
export const ROSTER_LOCK = 7342003;
export const ROSTER_LOCK_SQL = { text: 'SELECT pg_advisory_xact_lock($1::bigint)', params: [String(ROSTER_LOCK)] };
// Run one statement under the roster lock; returns its result (the batch's last).
export async function underRosterLock(text, params) {
  const res = await transaction([query(ROSTER_LOCK_SQL.text, ROSTER_LOCK_SQL.params), query(text, params)]);
  return res[res.length - 1];
}

// The team as the rights check needs it, plus the viewer's own active role on it. null when it doesn't exist.
//   { id, name, office_id, archived, office_archived, my_role: 'pm' | 'member' | null }
export async function rosterTeam(viewer, teamId) {
  const r = await query(
    `SELECT t.id, t.name, t.office_id, t.archived, COALESCE(o.archived, false) AS office_archived,
            (SELECT x.role FROM team_members x WHERE x.team_id = t.id AND x.user_id = $2::bigint AND x.removed_at IS NULL)
              AS my_role
     FROM teams t LEFT JOIN offices o ON o.id = t.office_id WHERE t.id = $1::bigint`,
    [id(teamId), id(viewer.id)]);
  const t = r.rows[0];
  if (!t) return null;
  return {
    id: String(t.id), name: t.name, office_id: id(t.office_id), archived: !!t.archived,
    office_archived: !!t.office_archived, my_role: t.my_role || null,
  };
}

// Who sees a team page (and so its roster): everyone, except that an archived team is shown only to those who
// could restore it, and a team in an archived office only to admins (app/(app)/teams/[teamId]/page.js).
export const teamPageVisible = (viewer, team) => !!team
  && !(team.archived && !canManageTeamsIn(viewer, team.office_id))
  && !(team.office_archived && !isAdmin(viewer));

export const NOT_EDITOR = 'Only the team’s PM, project engineers and up in its office, project managers and admins can change its roster.';

// The team for a roster write, or the right error: 404 (missing, or a page the viewer can't see), 403 (no roster
// rights), 409 (archived team or office).
export async function requireRosterEditor(viewer, teamId) {
  const team = await rosterTeam(viewer, teamId);
  if (!teamPageVisible(viewer, team)) throw new HttpError(404, 'Team not found');
  if (!canEditRoster(viewer, team, team.my_role)) throw forbidden(NOT_EDITOR);
  if (team.archived || team.office_archived) throw new HttpError(409, 'This team is archived. Restore it first.');
  return team;
}

// A write whose rights CTE matched nothing: the team was deleted, archived or moved, or the actor lost the PM
// role, since the route's check. Throws the error that explains it.
export async function explainRosterMiss(viewer, teamId) {
  await requireRosterEditor(viewer, teamId);
  throw new HttpError(409, 'This team changed while you were editing. Refresh and try again.');
}

// The rights a statement re-checks, as parameters: company-wide (L3+, admins), office (L2 in the office the team
// was read in; the statement requires the team to still be there), and the PM role (checked in SQL).
function rights(viewer, team) {
  return {
    company: viewer.level >= 3 || isAdmin(viewer),
    office: viewer.level >= 2 && inMyOffices(viewer, team.office_id),
    officeId: id(team.office_id),
  };
}

// CTE "ok": the team, when it is active, in an active office, and the actor may still edit its roster.
// Placeholders: team, actor, company flag, office flag, office id.
const rightsCte = (team, me, company, office, officeId) => `ok AS (
  SELECT t.id FROM teams t JOIN offices o ON o.id = t.office_id
  WHERE t.id = ${team}::bigint AND NOT t.archived AND NOT o.archived
    AND (${company}::boolean
         OR (${office}::boolean AND t.office_id = ${officeId}::bigint)
         OR EXISTS (SELECT 1 FROM team_members g WHERE g.team_id = t.id AND g.user_id = ${me}::bigint
                      AND g.role = 'pm' AND g.removed_at IS NULL)))`;

// Add (or revive) people on the roster with a role, and apply rule 3a for each of them. All or nothing: when any
// id is missing or disabled, nobody is added. People already on the roster are left as they are.
// -> { team_ok, users_ok, added: [user ids], already: [user ids], projects_added }
export async function addToRoster({ viewer, team, userIds, role }) {
  const rg = rights(viewer, team);
  const r = await underRosterLock(
    `WITH ${rightsCte('$1', '$2', '$5', '$6', '$7')},
     u AS (SELECT u.id FROM users u WHERE u.id = ANY($3::bigint[]) AND u.disabled_at IS NULL),
     r AS (INSERT INTO team_members (team_id, user_id, role, added_by)
           SELECT ok.id, u.id, $4::text, $2::bigint FROM ok CROSS JOIN u
           WHERE (SELECT count(*) FROM u) = cardinality($3::bigint[])
           ON CONFLICT (team_id, user_id) DO UPDATE
             SET role = EXCLUDED.role, added_by = EXCLUDED.added_by, created_at = now(), removed_at = NULL, removed_by = NULL
             WHERE team_members.removed_at IS NOT NULL
           RETURNING team_id, user_id, role),
     m AS (INSERT INTO project_members (project_id, user_id, source, added_by)
           SELECT p.id, r.user_id, 'team'::text, $2::bigint FROM r JOIN projects p ON p.team_id = r.team_id AND NOT p.archived
           ON CONFLICT (project_id, user_id) DO UPDATE
             SET source = 'team', removed_at = NULL, removed_by = NULL, remove_batch = NULL, added_by = EXCLUDED.added_by,
                 created_at = now()
             WHERE project_members.removed_at IS NOT NULL
           RETURNING project_id, user_id),
     rv AS (UPDATE projects SET rev = rev + 1 WHERE id IN (SELECT project_id FROM m)),
     a AS (INSERT INTO audit_log (actor_id, action, entity, entity_id, detail)
           SELECT $2::bigint, 'team.member_add', 'teams', r.team_id::text,
                  jsonb_build_object('user_id', r.user_id, 'role', r.role,
                    'project_ids', COALESCE((SELECT jsonb_agg(m.project_id ORDER BY m.project_id) FROM m
                                             WHERE m.user_id = r.user_id), '[]'::jsonb))
           FROM r)
     SELECT (SELECT count(*) FROM ok)::int AS team_ok, (SELECT count(*) FROM u)::int AS users_ok,
            COALESCE((SELECT json_agg(r.user_id::text ORDER BY r.user_id) FROM r), '[]'::json) AS added,
            COALESCE((SELECT json_agg(x.user_id::text ORDER BY x.user_id) FROM team_members x JOIN ok ON ok.id = x.team_id
                      WHERE x.user_id = ANY($3::bigint[]) AND x.removed_at IS NULL), '[]'::json) AS already,
            (SELECT count(*) FROM m)::int AS projects_added`,
    [id(team.id), id(viewer.id), userIds.map(String), role, rg.company, rg.office, rg.officeId]);
  const x = r.rows[0] || {};
  const added = Array.isArray(x.added) ? x.added.map(String) : [];
  // "already" is read from the statement's snapshot, so it lists the people who were active BEFORE this write.
  const already = (Array.isArray(x.already) ? x.already.map(String) : []).filter((u) => !added.includes(u));
  return { team_ok: Number(x.team_ok || 0), users_ok: Number(x.users_ok || 0), added, already,
    projects_added: Number(x.projects_added || 0) };
}

// Member <-> PM. Projects are untouched. -> { team_ok, found, changed }
export async function setRosterRole({ viewer, team, userId, role }) {
  const rg = rights(viewer, team);
  const r = await query(
    `WITH ${rightsCte('$1', '$2', '$5', '$6', '$7')},
     cur AS (SELECT x.team_id, x.user_id, x.role FROM team_members x JOIN ok ON ok.id = x.team_id
             WHERE x.user_id = $3::bigint AND x.removed_at IS NULL FOR UPDATE OF x),
     r AS (UPDATE team_members x SET role = $4::text FROM cur
           WHERE x.team_id = cur.team_id AND x.user_id = cur.user_id AND x.removed_at IS NULL AND x.role <> $4::text
           RETURNING x.team_id, x.user_id, cur.role AS was),
     a AS (INSERT INTO audit_log (actor_id, action, entity, entity_id, detail)
           SELECT $2::bigint, 'team.member_role', 'teams', r.team_id::text,
                  jsonb_build_object('user_id', r.user_id, 'from', r.was, 'to', $4::text) FROM r)
     SELECT (SELECT count(*) FROM ok)::int AS team_ok, (SELECT count(*) FROM cur)::int AS found,
            (SELECT count(*) FROM r)::int AS changed`,
    [id(team.id), id(viewer.id), id(userId), role, rg.company, rg.office, rg.officeId]);
  const x = r.rows[0] || {};
  return { team_ok: Number(x.team_ok || 0), found: Number(x.found || 0), changed: Number(x.changed || 0) };
}

// Soft-remove someone from the roster and apply rule 3c: their roster rows on the team's projects (archived ones
// too) go, except on projects where they own a task, which stay as 'task' ('team_legacy' -> 'legacy').
// -> { team_ok, removed, projects_removed, projects_kept, batch }
export async function removeFromRoster({ viewer, team, userId }) {
  const rg = rights(viewer, team);
  const r = await underRosterLock(
    `WITH ${rightsCte('$1', '$2', '$4', '$5', '$6')},
     cur AS (SELECT x.team_id, x.user_id, x.role FROM team_members x JOIN ok ON ok.id = x.team_id
             WHERE x.user_id = $3::bigint AND x.removed_at IS NULL FOR UPDATE OF x),
     hit AS (SELECT m.project_id, ${ownsTaskSql('m')} AS owns
             FROM project_members m JOIN projects p ON p.id = m.project_id
             JOIN cur ON cur.team_id = p.team_id AND cur.user_id = m.user_id
             WHERE m.source IN ${ROSTER_SOURCES_SQL} AND m.removed_at IS NULL),
     a AS (INSERT INTO audit_log (actor_id, action, entity, entity_id, detail)
           SELECT $2::bigint, 'team.member_remove', 'teams', cur.team_id::text,
                  jsonb_build_object('user_id', cur.user_id, 'role', cur.role,
                    'project_ids', COALESCE((SELECT jsonb_agg(h.project_id ORDER BY h.project_id) FROM hit h WHERE NOT h.owns), '[]'::jsonb),
                    'kept_for_tasks', COALESCE((SELECT jsonb_agg(h.project_id ORDER BY h.project_id) FROM hit h WHERE h.owns), '[]'::jsonb))
           FROM cur RETURNING id),
     r AS (UPDATE team_members x SET removed_at = now(), removed_by = $2::bigint FROM cur
           WHERE x.team_id = cur.team_id AND x.user_id = cur.user_id AND x.removed_at IS NULL
           RETURNING x.user_id),
     pm AS (UPDATE project_members m SET removed_at = now(), removed_by = $2::bigint, remove_batch = (SELECT id FROM a)
            WHERE m.user_id = $3::bigint AND m.project_id IN (SELECT project_id FROM hit WHERE NOT owns)
              AND m.source IN ${ROSTER_SOURCES_SQL} AND m.removed_at IS NULL
            RETURNING m.project_id),
     pkeep AS (UPDATE project_members m SET source = ${keptSource('m')}
            WHERE m.user_id = $3::bigint AND m.project_id IN (SELECT project_id FROM hit WHERE owns)
              AND m.source IN ${ROSTER_SOURCES_SQL} AND m.removed_at IS NULL
            RETURNING m.project_id),
     rv AS (UPDATE projects SET rev = rev + 1 WHERE id IN (SELECT project_id FROM pm UNION SELECT project_id FROM pkeep))
     SELECT (SELECT count(*) FROM ok)::int AS team_ok, (SELECT count(*) FROM r)::int AS removed,
            (SELECT count(*) FROM pm)::int AS projects_removed, (SELECT count(*) FROM pkeep)::int AS projects_kept,
            (SELECT id FROM a) AS batch`,
    [id(team.id), id(viewer.id), id(userId), rg.company, rg.office, rg.officeId]);
  const x = r.rows[0] || {};
  return { team_ok: Number(x.team_ok || 0), removed: Number(x.removed || 0), projects_removed: Number(x.projects_removed || 0),
    projects_kept: Number(x.projects_kept || 0), batch: x.batch == null ? null : String(x.batch) };
}

// Rule 3b/3c for a project MOVE, as CTEs appended to the projects UPDATE (lib/patch.js guardedPatch `extraCtes`;
// its CTE "r" is the updated project row, so r.team_id is the NEW team). The caller runs it under the roster lock
// (guardedPatch `prelude: [ROSTER_LOCK_SQL]`). bind(v) adds a parameter and returns its placeholder. In the same
// statement as the move:
//   - every active roster member of the new team who isn't an active member is added (or revived) as 'team';
//   - roster rows ('team', 'team_legacy') of people who aren't on the new team's roster are soft-removed, with the
//     audit row's id as remove_batch, except where the person owns a task on the project: those stay, relabeled
//     as rule 3c does (manual, task, creator, legacy and admin rows always stay);
//   - one audit_log 'project.move_team' row records from / to and the three lists. "from" is read from the
//     statement's snapshot (CTEs don't see the UPDATE), i.e. the team the project was really in.
// TEAM_MOVE_SELECT: the counts for the answer (added, removed, kept) as extra output columns.
export function teamMoveCtes(bind, { actorId }) {
  const me = bind(id(actorId));
  return `,
     tfrom AS (SELECT pj.team_id FROM projects pj JOIN r ON r.id = pj.id),
     tcand AS (SELECT m.user_id, ${ownsTaskSql('m')} AS owns FROM project_members m JOIN r ON r.id = m.project_id
               WHERE m.source IN ${ROSTER_SOURCES_SQL} AND m.removed_at IS NULL
                 AND NOT EXISTS (SELECT 1 FROM team_members x WHERE x.team_id = r.team_id AND x.user_id = m.user_id
                                   AND x.removed_at IS NULL)),
     tgo AS (SELECT user_id FROM tcand WHERE NOT owns),
     tkeep AS (SELECT user_id FROM tcand WHERE owns),
     tadd AS (SELECT x.user_id FROM r JOIN team_members x ON x.team_id = r.team_id AND x.removed_at IS NULL
              JOIN users u ON u.id = x.user_id AND u.disabled_at IS NULL
              WHERE NOT EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = r.id AND m.user_id = x.user_id
                                  AND m.removed_at IS NULL)),
     tma AS (INSERT INTO audit_log (actor_id, action, entity, entity_id, detail)
             SELECT ${me}::bigint, 'project.move_team', 'projects', r.id::text,
                    jsonb_build_object('from', (SELECT team_id FROM tfrom), 'to', r.team_id,
                      'added', COALESCE((SELECT jsonb_agg(tadd.user_id ORDER BY tadd.user_id) FROM tadd), '[]'::jsonb),
                      'removed', COALESCE((SELECT jsonb_agg(tgo.user_id ORDER BY tgo.user_id) FROM tgo), '[]'::jsonb),
                      'kept_for_tasks', COALESCE((SELECT jsonb_agg(tkeep.user_id ORDER BY tkeep.user_id) FROM tkeep), '[]'::jsonb))
             FROM r RETURNING id),
     tins AS (INSERT INTO project_members (project_id, user_id, source, added_by)
              SELECT r.id, tadd.user_id, 'team'::text, ${me}::bigint FROM r CROSS JOIN tadd
              ON CONFLICT (project_id, user_id) DO UPDATE
                SET source = 'team', removed_at = NULL, removed_by = NULL, remove_batch = NULL, added_by = EXCLUDED.added_by,
                    created_at = now()
                WHERE project_members.removed_at IS NOT NULL
              RETURNING user_id),
     tdel AS (UPDATE project_members m SET removed_at = now(), removed_by = ${me}::bigint, remove_batch = (SELECT id FROM tma)
              FROM r WHERE m.project_id = r.id AND m.user_id IN (SELECT user_id FROM tgo)
                AND m.source IN ${ROSTER_SOURCES_SQL} AND m.removed_at IS NULL
              RETURNING m.user_id),
     tkp AS (UPDATE project_members m SET source = ${keptSource('m')}
             FROM r WHERE m.project_id = r.id AND m.user_id IN (SELECT user_id FROM tkeep)
               AND m.source IN ${ROSTER_SOURCES_SQL} AND m.removed_at IS NULL
             RETURNING m.user_id)`;
}
export const TEAM_MOVE_SELECT = `, (SELECT count(*) FROM tins)::int AS team_move_added,
    (SELECT count(*) FROM tdel)::int AS team_move_removed, (SELECT count(*) FROM tkp)::int AS team_move_kept`;
