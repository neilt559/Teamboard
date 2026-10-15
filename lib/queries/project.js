import 'server-only';
import * as React from 'react';
import { query, transaction } from '../db.js';
import { HttpError, bad, forbidden, gone, inLegacyGrace, noNul, parseId, ymd } from '../http.js';
import { norm } from '../patch.js';
import { tagUpdating } from '../viewer.js';
import { canCreateProjectIn, canDeleteProject, canManageProject, canRemoveMember } from '../policy.js';
import { LEGACY_SOURCES_SQL, ROSTER_SOURCES_SQL, ownsTaskSql, underRosterLock } from '../rosters.js';
import { attentionFromOptions, checkStages, isHhmm, ownerKey, parseStages, stagesJson } from '../projects.js';
import { chicagoToday } from '../time.js';
import { ATTENTION_SELECT, SUBMITTAL_SELECT, attentionFromQuery, shapeAttention, shapeSubmittal } from './project-items.js';

// The project page, the task detail page and the project-scoped writes that lib/patch.js guardedPatch can't
// express (design §2.1, §6, §7, §8.2). Every statement that touches a project-scoped table carries
// tb_can_see_project($viewer, project) in the SAME statement, so a project you can't see behaves exactly like
// one that doesn't exist (404, no existence leak).
const cache = typeof React.cache === 'function' ? React.cache : (fn) => fn;

export const TASK_STATUS_KEYS = ['not_started', 'working', 'stuck', 'done'];
export const STOPLIGHT_KEYS = ['', 'red', 'yellow', 'green'];

const ID = /^[0-9]{1,18}$/;
const has = (o, k) => !!o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);

// Dates leave the server as ISO strings: client components get plain JSON, and nothing depends on the
// server's time zone.
function plain(row) {
  if (!row) return row;
  const out = {};
  for (const [k, v] of Object.entries(row)) out[k] = v instanceof Date ? v.toISOString() : v;
  return out;
}
const plainAll = (rows) => rows.map(plain);

// Task columns every task response carries (today's PATCH/POST shape plus position, authorship and edit tracking).
const TASK_COLS = `id, project_id, parent_id, title, assignee_id, due_date, status, archived, notes, stoplight,
  position, created_at, created_by, updated_at, updated_by`;
const taskNames = (alias) => `
  (SELECT COALESCE(NULLIF(x.display_name, ''), x.username) FROM users x WHERE x.id = ${alias}.created_by) AS created_by_name,
  (SELECT COALESCE(NULLIF(x.display_name, ''), x.username) FROM users x WHERE x.id = ${alias}.updated_by) AS updated_by_name`;

// Text normalizers (design §7.1): single-line fields trimmed, multi-line fields only capped. The same function
// produces the stored value and normalizes the client's base, so a trailing space never conflicts.
export const TASK_TEXT = { title: norm.line(500), notes: norm.text(5000) };

// A6 project details: single-line, trimmed. All four are required on create and can't be emptied later.
export const PROJECT_NORM = {
  name: norm.line(200),
  project_number: norm.line(40),
  owner_company: norm.line(200),
  jurisdiction: norm.line(200),
};

// A6: a stages change that drops the current stage moves it to the latest remaining stage before it in the fixed
// order, else to the first remaining stage ('' -> the first stage: "current stage defaults to the first chosen
// stage"). For the SET list of the same UPDATE, so it reads the row's current_stage atomically.
//   a = placeholder of the new stage keys (text[], fixed order), o = placeholder of every key in the fixed order.
export const currentStageFallbackSql = (a, o) => `CASE WHEN current_stage = ANY(${a}::text[]) THEN current_stage
  ELSE COALESCE((SELECT x.k FROM unnest(${a}::text[]) AS x(k)
                 WHERE array_position(${o}::text[], x.k) < COALESCE(array_position(${o}::text[], current_stage), 0)
                 ORDER BY array_position(${o}::text[], x.k) DESC LIMIT 1),
                (${a}::text[])[1]) END`;

// A6 columns as clients get them: stages as an array of keys in the fixed order (the column stores JSON text).
export const shapeProjectRow = (row) => (row && Object.prototype.hasOwnProperty.call(row, 'stages')
  ? { ...row, stages: parseStages(row.stages) } : row);

// ------------------------------------------------------------------------------------------- page loaders

// Everything /projects/[projectId] shows, in one read-only batch. null when the project is missing or not
// visible (the page answers 404 for both).
//   { project, can, tasks, people, info, series, meetings, members, teams,
//     submittals, field_options, today,   (A6)
//     attention_items, attention_from }   (A8)
// A6: project gains project_number, owner_company, jurisdiction, stages (array of keys, fixed order),
// current_stage, schedule_status; notes is the "Status Report" (status_report_reviewed_at NULL = pre-A6 text that
// reports leave out until someone reviews it: the page shows "Use in reports"). can.manage also covers "Project details"
// (number, name, owner, jurisdiction, stages); schedule, current stage, Status Report, submittals and meetings are
// for everyone who sees the project. submittals: every one, archived included (archived flag; the "Show archived"
// toggle filters), each with expected_response. A9: meetings carry meeting_time, location and archived (archived
// ones included: the "Show archived" toggle filters), series carry archived; the page splits Upcoming and Past on
// today (Central). field_options: { owners,
// jurisdictions } for the details dialog's datalists (from projects the viewer can see). A8: attention_items: every
// one, received and archived included (flags), each with flag ('overdue' | 'soon' | '', open items, Central date);
// attention_from: the From box's suggestions (lib/projects.js attentionFromOptions). now: epoch ms
// (nowFromRequestContext() in pages; defaults to the clock).
export const loadProjectPage = cache(async (viewer, projectId, now) => {
  if (!ID.test(String(projectId))) return null;
  const uid = String(viewer.id);
  const pid = String(projectId);
  const today = chicagoToday(Number.isFinite(now) ? now : Date.now());
  let res;
  try {
    res = await transaction([
      query(`SELECT p.id, p.name, p.notes, p.team_id, p.archived, p.created_by, p.rev, p.created_at, p.updated_at,
                    p.project_number, p.owner_company, p.jurisdiction, p.stages, p.current_stage, p.schedule_status,
                    p.status_report_reviewed_at, p.updated_by, t.name AS team_name, t.archived AS team_archived, t.office_id,
                    o.name AS office_name, o.archived AS office_archived,
                    COALESCE(NULLIF(cu.display_name, ''), cu.username) AS created_by_name,
                    COALESCE(NULLIF(uu.display_name, ''), uu.username) AS updated_by_name,
                    EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = p.id AND m.user_id = $1::bigint
                              AND m.removed_at IS NULL) AS is_member,
                    EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = p.id AND m.user_id = $1::bigint
                              AND m.removed_at IS NULL AND m.source IN ${LEGACY_SOURCES_SQL}) AS legacy_member
             FROM projects p
             LEFT JOIN teams t ON t.id = p.team_id
             LEFT JOIN offices o ON o.id = t.office_id
             LEFT JOIN users cu ON cu.id = p.created_by
             LEFT JOIN users uu ON uu.id = p.updated_by
             WHERE p.id = $2::bigint AND tb_can_see_project($1::bigint, p.id)`, [uid, pid]),
      query(`SELECT k.id, k.project_id, k.parent_id, k.title, k.assignee_id, k.due_date, k.status, k.archived, k.notes,
                    k.stoplight, k.position, k.created_at, k.created_by, k.updated_at, k.updated_by, ${taskNames('k')}
             FROM tasks k
             WHERE k.project_id = $2::bigint AND tb_can_see_project($1::bigint, $2::bigint)
             ORDER BY k.position ASC, k.id ASC`, [uid, pid]),
      // The roster (names on tasks) is company-public; archived names stay listed only while a task here uses them.
      query(`SELECT pe.id, pe.name, pe.color, pe.kind, pe.user_id, (pe.archived_at IS NOT NULL) AS archived
             FROM people pe
             WHERE pe.archived_at IS NULL
                OR pe.id IN (SELECT k.assignee_id FROM tasks k
                             WHERE k.project_id = $2::bigint AND tb_can_see_project($1::bigint, $2::bigint))
             ORDER BY lower(pe.name) ASC, pe.id ASC`, [uid, pid]),
      query(`SELECT i.id, i.project_id, i.label, i.value, i.position, i.updated_at
             FROM project_info i
             WHERE i.project_id = $2::bigint AND tb_can_see_project($1::bigint, $2::bigint)
             ORDER BY i.position ASC, i.id ASC`, [uid, pid]),
      query(`SELECT s.id, s.project_id, s.name, s.position, s.archived, s.updated_at
             FROM meeting_series s
             WHERE s.project_id = $2::bigint AND tb_can_see_project($1::bigint, $2::bigint)
             ORDER BY s.position ASC, s.id ASC`, [uid, pid]),
      query(`SELECT ${MEETING_COLS},
                    (SELECT COALESCE(NULLIF(x.display_name, ''), x.username) FROM users x WHERE x.id = m.updated_by)
                      AS updated_by_name
             FROM project_meetings m
             WHERE m.project_id = $2::bigint AND tb_can_see_project($1::bigint, $2::bigint)
             ORDER BY m.meeting_date ASC NULLS LAST, m.meeting_time ASC NULLS FIRST, m.id ASC`, [uid, pid]),
      membersQuery(uid, pid),
      // Move targets: team names are company-public; who may move where is decided below (canMoveProject).
      // For the move confirm (A4 rules 3b/3c, lib/rosters.js teamMoveCtes), per target: move_joins = enabled people
      // on its roster who aren't active members here; move_leaves = active roster rows here ('team',
      // 'team_legacy') of enabled people who aren't on its roster and own no task here. Counts only.
      query(`SELECT t.id, t.name, t.office_id, o.name AS office_name,
                    (SELECT count(*) FROM team_members x JOIN users u ON u.id = x.user_id
                     WHERE x.team_id = t.id AND x.removed_at IS NULL AND u.disabled_at IS NULL
                       AND tb_can_see_project($1::bigint, $2::bigint)
                       AND NOT EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = $2::bigint
                                         AND m.user_id = x.user_id AND m.removed_at IS NULL))::int AS move_joins,
                    (SELECT count(*) FROM project_members m JOIN users u ON u.id = m.user_id
                     WHERE m.project_id = $2::bigint AND m.removed_at IS NULL AND u.disabled_at IS NULL
                       AND m.source IN ${ROSTER_SOURCES_SQL} AND tb_can_see_project($1::bigint, $2::bigint)
                       AND NOT EXISTS (SELECT 1 FROM team_members x WHERE x.team_id = t.id AND x.user_id = m.user_id
                                         AND x.removed_at IS NULL)
                       AND NOT ${ownsTaskSql('m')})::int AS move_leaves
             FROM teams t JOIN offices o ON o.id = t.office_id
             WHERE NOT t.archived AND NOT o.archived
             ORDER BY o.position ASC, o.id ASC, t.position ASC, t.id ASC`, [uid, pid]),
      // A6 sections (lib/queries/project-items.js holds the shared column lists).
      query(`${SUBMITTAL_SELECT}
             WHERE s.project_id = $2::bigint AND tb_can_see_project($1::bigint, $2::bigint)
             ORDER BY s.position ASC, s.id ASC`, [uid, pid]),
      fieldOptionsQuery(uid),
      // A8 attention items, and the From values used before on projects the viewer can see.
      query(`${ATTENTION_SELECT}
             WHERE a.project_id = $2::bigint AND tb_can_see_project($1::bigint, $2::bigint)
             ORDER BY a.need_by ASC NULLS LAST, a.position ASC, a.id ASC`, [uid, pid]),
      attentionFromQuery(uid),
    ], { readOnly: true });
  } catch (e) {
    throw tagUpdating(e);
  }
  const [projRows, tasks, people, info, series, meetings, members, teams, submittals, options, attention, fromUsed] = res.map((r) => r.rows);
  const p = projRows[0];
  if (!p) return null;
  const project = shapeProjectRow(plain(p));
  const access = { ...project, visible: true };
  const manage = canManageProject(viewer, access);
  // Teams this viewer may move the project into (target in the caller's scope, §4.4 canMoveProject).
  const moveTargets = manage ? teams.filter((t) => canCreateProjectIn(viewer, t)) : [];
  if (project.team_id != null && !moveTargets.some((t) => String(t.id) === String(project.team_id))) {
    moveTargets.unshift({ id: project.team_id, name: project.team_name || 'Current team', office_id: project.office_id,
      office_name: project.office_name || '', current_only: true });
  }
  return {
    project,
    can: {
      manage,
      move: manage && moveTargets.some((t) => String(t.id) !== String(project.team_id)),
      delete: canDeleteProject(viewer),
    },
    tasks: plainAll(tasks),
    people: plainAll(people),
    info: plainAll(info),
    series: plainAll(series),
    meetings: plainAll(meetings),
    members: shapeMembers(viewer, members),
    teams: moveTargets,
    submittals: submittals.map(shapeSubmittal),
    field_options: shapeFieldOptions(options),
    today,
    attention_items: attention.map((a) => shapeAttention(a, today)),
    attention_from: attentionFromOptions(project, fromUsed.map((r) => r.v)),
  };
});

// ------------------------------------------------------------------------------------------- field options

// Owner companies and jurisdictions already in use, for the create and details dialogs' datalists (A6.4). Only
// from projects the viewer can see, so no other office's client list leaks. Spelling variants that differ in case
// or spacing collapse to the most used spelling (lib/projects.js ownerKey).
function fieldOptionsQuery(uid) {
  return query(`SELECT 'owner' AS kind, p.owner_company AS v, count(*)::int AS n FROM projects p
                WHERE p.owner_company <> '' AND p.id IN (SELECT tb_visible_project_ids($1::bigint))
                GROUP BY p.owner_company
                UNION ALL
                SELECT 'jurisdiction' AS kind, p.jurisdiction AS v, count(*)::int AS n FROM projects p
                WHERE p.jurisdiction <> '' AND p.id IN (SELECT tb_visible_project_ids($1::bigint))
                GROUP BY p.jurisdiction`, [uid]);
}

function shapeFieldOptions(rows) {
  const pick = (kind) => {
    const best = new Map();                                   // ownerKey -> { v, n }
    for (const r of rows.filter((x) => x.kind === kind)) {
      const k = ownerKey(r.v);
      const n = Number(r.n) || 0;
      const cur = best.get(k);
      if (!cur || n > cur.n || (n === cur.n && r.v < cur.v)) best.set(k, { v: r.v, n });
    }
    return [...best.values()].map((x) => x.v)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
  };
  return { owners: pick('owner'), jurisdictions: pick('jurisdiction') };
}

// { owners, jurisdictions } on their own (the team page and /projects create dialogs).
export const loadProjectFieldOptions = cache(async (viewer) => {
  let r;
  try {
    r = await fieldOptionsQuery(String(viewer.id));
  } catch (e) {
    throw tagUpdating(e);
  }
  return shapeFieldOptions(r.rows);
});

// /projects/[projectId]/tasks/[taskId]: the task, its parent (for a subtask) and its subtasks, plus what the
// header and owner picker need. null when the project is hidden or the task isn't in it.
export const loadTaskPage = cache(async (viewer, projectId, taskId) => {
  if (!ID.test(String(projectId)) || !ID.test(String(taskId))) return null;
  const uid = String(viewer.id);
  const pid = String(projectId);
  const tid = String(taskId);
  let res;
  try {
    res = await transaction([
      query(`SELECT p.id, p.name, p.project_number, p.team_id, p.archived, p.rev, t.name AS team_name, t.office_id, o.name AS office_name
             FROM projects p LEFT JOIN teams t ON t.id = p.team_id LEFT JOIN offices o ON o.id = t.office_id
             WHERE p.id = $2::bigint AND tb_can_see_project($1::bigint, p.id)`, [uid, pid]),
      query(`SELECT k.id, k.project_id, k.parent_id, k.title, k.assignee_id, k.due_date, k.status, k.archived, k.notes,
                    k.stoplight, k.position, k.created_at, k.created_by, k.updated_at, k.updated_by, ${taskNames('k')}
             FROM tasks k
             WHERE k.project_id = $2::bigint AND tb_can_see_project($1::bigint, $2::bigint)
               AND (k.id = $3::bigint OR k.parent_id = $3::bigint
                    OR k.id = (SELECT c.parent_id FROM tasks c WHERE c.id = $3::bigint AND c.project_id = $2::bigint))
             ORDER BY k.position ASC, k.id ASC`, [uid, pid, tid]),
      query(`SELECT pe.id, pe.name, pe.color, pe.kind, pe.user_id, (pe.archived_at IS NOT NULL) AS archived
             FROM people pe
             WHERE pe.archived_at IS NULL
                OR pe.id IN (SELECT k.assignee_id FROM tasks k
                             WHERE k.project_id = $2::bigint AND tb_can_see_project($1::bigint, $2::bigint))
             ORDER BY lower(pe.name) ASC, pe.id ASC`, [uid, pid]),
    ], { readOnly: true });
  } catch (e) {
    throw tagUpdating(e);
  }
  const [projRows, taskRows, people] = res.map((r) => r.rows.map(plain));
  const project = projRows[0];
  const task = taskRows.find((k) => String(k.id) === tid);
  if (!project || !task) return null;
  const parent = task.parent_id != null ? taskRows.find((k) => String(k.id) === String(task.parent_id)) || null : null;
  const subtasks = taskRows.filter((k) => String(k.parent_id) === tid);
  return { project, task, parent, subtasks, people };
});

// ------------------------------------------------------------------------------------------------ members

const SOURCE_LABELS = { creator: 'Created the project', task: 'Owns a task here', manual: 'Added', legacy: 'Had access before the update', admin: 'Team access (admin)', team: 'Team member', team_legacy: 'Team member' };

function membersQuery(uid, pid) {
  // Open tasks they own here (through their linked name), for the "They still own N open task(s)" warning.
  // listed: the member's profile opens for everyone (not a zz_ account; disabled ones are filtered out below).
  return query(`SELECT m.user_id, m.source, m.added_by, m.created_at, u.username,
                       COALESCE(NULLIF(u.display_name, ''), u.username) AS name,
                       (u.username NOT LIKE 'zz!_%' ESCAPE '!') AS listed,
                       (u.identity_verified_at IS NOT NULL) AS identity_verified, u.avatar_v,
                       u.office_id, o.name AS office_name, d.name AS department, d.color AS department_color,
                       COALESCE(NULLIF(a.display_name, ''), a.username) AS added_by_name,
                       (SELECT tm.name FROM projects pj JOIN teams tm ON tm.id = pj.team_id WHERE pj.id = m.project_id) AS team_name,
                       (SELECT count(*) FROM tasks k JOIN people pe ON pe.id = k.assignee_id
                        WHERE k.project_id = m.project_id AND pe.user_id = m.user_id AND NOT k.archived)::int AS open_tasks
                FROM project_members m
                JOIN users u ON u.id = m.user_id
                LEFT JOIN users a ON a.id = m.added_by
                LEFT JOIN offices o ON o.id = u.office_id
                LEFT JOIN departments d ON d.id = u.department_id
                WHERE m.project_id = $2::bigint AND m.removed_at IS NULL AND u.disabled_at IS NULL
                  AND tb_can_see_project($1::bigint, $2::bigint)
                ORDER BY lower(COALESCE(NULLIF(u.display_name, ''), u.username)) ASC, m.user_id ASC`, [uid, pid]);
}

function shapeMembers(viewer, rows) {
  return rows.map((r) => {
    const m = plain(r);
    return {
      ...m,
      user_id: String(m.user_id),
      added_by: m.added_by == null ? null : String(m.added_by),
      // A4: roster members read "via Team Potato" (a 'team' / 'team_legacy' row always belongs to the project's
      // current team: leaving the roster or a move away removes it, or turns it into a task row).
      source_label: (m.source === 'team' || m.source === 'team_legacy') && m.team_name
        ? `via ${m.team_name}` : (SOURCE_LABELS[m.source] || 'Member'),
      is_me: String(m.user_id) === String(viewer.id),
      // NameLabel links the name only when the profile opens for this viewer (admins and the person see all).
      listed: !!m.listed || !!viewer.is_admin || String(m.user_id) === String(viewer.id),
      // canRemoveMember: yourself, people you added, L2+ who can see the project, admins (§6).
      can_remove: canRemoveMember(viewer, { visible: true }, m),
    };
  });
}

// GET /api/projects/:id/members. null when the project is hidden or missing.
export async function listMembers(viewer, projectId) {
  const uid = String(viewer.id);
  const pid = parseId(projectId);
  const [vis, rows] = (await transaction([
    query(`SELECT tb_can_see_project($1::bigint, $2::bigint) AS ok`, [uid, pid]),
    membersQuery(uid, pid),
  ], { readOnly: true })).map((r) => r.rows);
  if (!vis[0]?.ok) return null;
  return shapeMembers(viewer, rows);
}

// POST /api/projects/:id/members {user_ids}: anyone who can see the project adds anyone (design §6). Revives
// a soft-removed row. An active roster row ('team', A4) becomes a hand-added one ('manual', added_by = the
// caller, created_at kept), so a deliberate add outlives the person's roster changes whichever came first.
// Returns the user ids added, revived or turned into hand-adds (other active members are skipped).
// ('team_legacy' rows are left alone: turning them into 'manual' would end their holder's legacy-manager rights.)
export async function addMembers(viewer, projectId, userIds) {
  const pid = parseId(projectId);
  const ids = [...new Set((Array.isArray(userIds) ? userIds : []).map((x) => parseId(x)))];
  if (!ids.length) throw bad('Pick at least one person.');
  if (ids.length > 50) throw bad('Add at most 50 people at a time.');
  const r = await query(
    `WITH ins AS (
       INSERT INTO project_members (project_id, user_id, source, added_by)
       SELECT $1::bigint, u.id, 'manual'::text, $2::bigint FROM users u
       WHERE u.id = ANY($3::bigint[]) AND u.disabled_at IS NULL AND tb_can_see_project($2::bigint, $1::bigint)
       ON CONFLICT (project_id, user_id) DO UPDATE
         SET removed_at = NULL, removed_by = NULL, remove_batch = NULL, source = 'manual', added_by = $2::bigint,
             created_at = CASE WHEN project_members.removed_at IS NULL THEN project_members.created_at ELSE now() END
         WHERE project_members.removed_at IS NOT NULL OR project_members.source = 'team'
       RETURNING user_id),
     rev AS (UPDATE projects SET rev = rev + 1 WHERE id = $1::bigint AND EXISTS (SELECT 1 FROM ins))
     SELECT user_id FROM ins`, [pid, String(viewer.id), ids]);
  return r.rows.map((x) => String(x.user_id));
}

// DELETE /api/projects/:id/members/:userId: soft removal (design §6) with an audit row, in one statement.
// The caller checked canRemoveMember. Returns { removed, still_visible } (still_visible: can the CALLER still
// see the project afterwards, so "Leave project" knows whether to send you Home).
export async function removeMember(viewer, projectId, userId) {
  const pid = parseId(projectId);
  const target = parseId(userId);
  const me = String(viewer.id);
  const r = await query(
    `WITH r AS (UPDATE project_members SET removed_at = now(), removed_by = $3::bigint
                WHERE project_id = $1::bigint AND user_id = $2::bigint AND removed_at IS NULL
                  AND tb_can_see_project($3::bigint, $1::bigint)
                RETURNING project_id, user_id, source, added_by),
     a AS (INSERT INTO audit_log (actor_id, action, entity, entity_id, detail)
           SELECT $3::bigint, 'member.remove', 'project_members', r.project_id::text,
                  jsonb_build_object('user_id', r.user_id, 'source', r.source, 'added_by', r.added_by) FROM r),
     pr AS (UPDATE projects SET rev = rev + 1 WHERE id IN (SELECT project_id FROM r))
     SELECT count(*)::int AS removed FROM r`, [pid, target, me]);
  const removed = Number(r.rows[0]?.removed || 0);
  const vis = await query(`SELECT tb_can_see_project($1::bigint, $2::bigint) AS ok`, [me, pid]);
  return { removed, still_visible: !!vis.rows[0]?.ok };
}

// The active membership row (or null) for the canRemoveMember check.
export async function memberRow(viewer, projectId, userId) {
  const r = await query(
    `SELECT m.user_id, m.added_by, m.source FROM project_members m
     WHERE m.project_id = $1::bigint AND m.user_id = $2::bigint AND m.removed_at IS NULL
       AND tb_can_see_project($3::bigint, $1::bigint)`,
    [parseId(projectId), parseId(userId), String(viewer.id)]);
  return r.rows[0] || null;
}

// ------------------------------------------------------------------------------------------------- projects

// GET /api/projects/:id/rev: { rev, archived }, or null when deleted or no longer visible (§7.5).
export async function projectRev(viewer, projectId) {
  const r = await query(
    `SELECT p.rev, p.archived FROM projects p WHERE p.id = $2::bigint AND tb_can_see_project($1::bigint, p.id)`,
    [String(viewer.id), parseId(projectId)]);
  const row = r.rows[0];
  return row ? { rev: String(row.rev), archived: !!row.archived } : null;
}

// The create dialog's fields (A6.4), validated: { name, project_number, owner_company, jurisdiction, stages
// (JSON text, fixed order), current_stage }, or a 400 naming the first problem. Project number, name, owner
// company and jurisdiction are required; at least one known stage; current_stage (optional) must be one of the
// chosen stages and defaults to the first one. The schedule status always starts unset.
export function projectCreateFields(b) {
  for (const k of ['name', 'project_number', 'owner_company', 'jurisdiction']) noNul(b[k]);
  const f = {
    project_number: PROJECT_NORM.project_number(b.project_number),
    name: PROJECT_NORM.name(b.name),
    owner_company: PROJECT_NORM.owner_company(b.owner_company),
    jurisdiction: PROJECT_NORM.jurisdiction(b.jurisdiction),
  };
  if (!f.project_number) throw bad('Enter the project number.');
  if (!f.name) throw bad('Enter the project name.');
  if (!f.owner_company) throw bad('Enter the owner company.');
  if (!f.jurisdiction) throw bad('Enter the jurisdiction.');
  const st = checkStages(b.stages);
  if (st.error) throw bad(st.error);
  let current = st.keys[0];
  if (b.current_stage != null && b.current_stage !== '') {
    if (typeof b.current_stage !== 'string' || !st.keys.includes(b.current_stage)) {
      throw bad('The current stage has to be one of the chosen stages.');
    }
    current = b.current_stage;
  }
  return { ...f, stages: stagesJson(st.keys), current_stage: current };
}

// POST /api/projects {project_number, name, owner_company, jurisdiction, stages, current_stage?, team_id}: the
// project, its creator membership and the team roster's memberships in one statement (§6, A4 rule 3b, A6.4).
// Who: canCreateProjectIn(team) (anyone in their own offices' teams; PMs and up anywhere); the team and the
// rights are checked before the fields. The answer keeps today's row shape (stages as an array) plus
// team_members_added (how many roster members joined).
export async function createProject(viewer, b) {
  const teamId = b.team_id == null || b.team_id === '' ? null : parseId(b.team_id);
  if (!teamId) throw bad('Pick a team for the project.');
  const t = (await query(
    `SELECT t.id, t.office_id, t.archived, o.archived AS office_archived
     FROM teams t JOIN offices o ON o.id = t.office_id WHERE t.id = $1::bigint`, [teamId])).rows[0];
  if (!t || t.archived || t.office_archived) throw bad('That team isn’t available. Pick another one.');
  if (!canCreateProjectIn(viewer, t)) throw forbidden('You can add projects only to teams in your own offices.');
  const f = projectCreateFields(b);
  // A4 rule 3b, same statement: every active roster member of the team joins as 'team' (the creator keeps the
  // 'creator' row), with an audit row naming them. Under the roster lock (lib/rosters.js), so a roster change
  // committing at the same moment is either fully before (and seen) or fully after (and applies to this project).
  const r = await underRosterLock(
    `WITH p AS (INSERT INTO projects (name, team_id, position, created_by, project_number, owner_company, jurisdiction,
                                      stages, current_stage, status_report_reviewed_at)
                VALUES ($1::text, $2::bigint, $3::float8, $4::bigint, $5::text, $6::text, $7::text, $8::text, $9::text, now())
                RETURNING id, team_id, name, notes, position, archived, created_by, rev, created_at, project_number,
                          owner_company, jurisdiction, stages, current_stage, schedule_status, status_report_reviewed_at),
     m AS (INSERT INTO project_members (project_id, user_id, source, added_by)
           SELECT p.id, $4::bigint, 'creator'::text, $4::bigint FROM p
           ON CONFLICT (project_id, user_id) DO NOTHING RETURNING user_id),
     tm AS (INSERT INTO project_members (project_id, user_id, source, added_by)
            SELECT p.id, x.user_id, 'team'::text, $4::bigint FROM p
            JOIN team_members x ON x.team_id = p.team_id AND x.removed_at IS NULL
            JOIN users u ON u.id = x.user_id AND u.disabled_at IS NULL
            WHERE x.user_id <> $4::bigint
            ON CONFLICT (project_id, user_id) DO NOTHING RETURNING user_id),
     a AS (INSERT INTO audit_log (actor_id, action, entity, entity_id, detail)
           SELECT $4::bigint, 'project.team_members', 'projects', p.id::text,
                  jsonb_build_object('team_id', p.team_id,
                    'added', (SELECT jsonb_agg(tm.user_id ORDER BY tm.user_id) FROM tm))
           FROM p WHERE EXISTS (SELECT 1 FROM tm))
     SELECT p.*, (SELECT count(*) FROM tm)::int AS team_members_added FROM p`,
    [f.name, teamId, Date.now(), String(viewer.id), f.project_number, f.owner_company, f.jurisdiction, f.stages, f.current_stage]);
  return shapeProjectRow(plain(r.rows[0]));
}

// The target team for a move: { id, office_id } of an active team in an active office, or null.
export async function moveTarget(teamId) {
  const r = await query(
    `SELECT t.id, t.office_id FROM teams t JOIN offices o ON o.id = t.office_id
     WHERE t.id = $1::bigint AND NOT t.archived AND NOT o.archived`, [parseId(teamId)]);
  return r.rows[0] || null;
}

// DELETE /api/projects/:id (L4 and admins): a JSON snapshot of the project and everything that cascades with
// it (tasks, info rows, meetings, series, memberships, A6's submittals and upcoming meetings, A8's attention items) goes to
// audit_log in the same statement as the delete.
// Returns { deleted, existed } (see lib/audit.js deleteWithSnapshot; project_members has no id column, so the
// generic helper can't snapshot it).
export async function deleteProject(viewer, projectId) {
  const pid = parseId(projectId);
  const agg = (table, order) => `COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY ${order}) FROM ${table} c WHERE c.project_id = s.id), '[]'::jsonb)`;
  const r = await query(
    `WITH s AS (SELECT * FROM projects WHERE id = $1::bigint AND tb_can_see_project($2::bigint, id)),
     d AS (DELETE FROM projects t USING s WHERE t.id = s.id RETURNING t.id),
     a AS (INSERT INTO audit_log (actor_id, action, entity, entity_id, detail)
           SELECT $2::bigint, 'project.delete', 'projects', s.id::text,
                  jsonb_build_object('row', to_jsonb(s),
                    'tasks', ${agg('tasks', 'c.id')},
                    'info', ${agg('project_info', 'c.id')},
                    'meetings', ${agg('project_meetings', 'c.id')},
                    'series', ${agg('meeting_series', 'c.id')},
                    'members', ${agg('project_members', 'c.user_id')},
                    'submittals', ${agg('project_submittals', 'c.id')},
                    'upcoming_meetings', ${agg('project_upcoming_meetings', 'c.id')},
                    'attention_items', ${agg('project_attention_items', 'c.id')})
           FROM s JOIN d ON d.id = s.id)
     SELECT (SELECT count(*) FROM d)::int AS deleted, EXISTS (SELECT 1 FROM projects WHERE id = $1::bigint) AS existed`,
    [pid, String(viewer.id)]);
  return { deleted: Number(r.rows[0]?.deleted || 0), existed: !!r.rows[0]?.existed };
}

// --------------------------------------------------------------------------------------------------- tasks

// Assigning a task to a name linked to an account makes that account a member (design §6), in the same
// statement as the task write. `src` is the CTE holding the written task row(s).
const memberCte = (src, me) => `,
  mem AS (INSERT INTO project_members (project_id, user_id, source, added_by)
          SELECT ${src}.project_id, pe.user_id, 'task'::text, ${me}::bigint
          FROM ${src} JOIN people pe ON pe.id = ${src}.assignee_id JOIN users u ON u.id = pe.user_id
          WHERE u.disabled_at IS NULL
          ON CONFLICT (project_id, user_id) DO UPDATE
            SET removed_at = NULL, removed_by = NULL, remove_batch = NULL, source = 'task'
            WHERE project_members.removed_at IS NOT NULL
          RETURNING user_id)`;
const addedMembersSql = `COALESCE((SELECT json_agg(json_build_object('user_id', mem.user_id::text,
    'name', COALESCE(NULLIF(u.display_name, ''), u.username))) FROM mem JOIN users u ON u.id = mem.user_id), '[]'::json)`;

const shapeTask = (row) => {
  if (!row) return row;
  const { added_members: added, ...t } = plain(row);
  return { row: t, added_members: Array.isArray(added) ? added : [] };
};

// POST /api/tasks {project_id, parent_id?, title?, assignee_id?}. parent_id must be a top-level task in the
// same project (one level of subtasks). Returns today's row shape plus authorship and added_members.
export async function createTask(viewer, b) {
  if (b.project_id == null || b.project_id === '') throw bad('project_id required');
  const pid = parseId(b.project_id);
  const parent = b.parent_id == null || b.parent_id === '' || b.parent_id === 0 ? null : parseId(b.parent_id);
  const assignee = b.assignee_id == null || b.assignee_id === '' || b.assignee_id === 0 ? null : parseId(b.assignee_id);
  const title = TASK_TEXT.title(b.title);
  const me = String(viewer.id);
  const r = await query(
    `WITH ins AS (
       INSERT INTO tasks (project_id, parent_id, title, assignee_id, position, created_by)
       SELECT p.id, $2::bigint, $3::text, $4::bigint, $5::float8, $6::bigint
       FROM projects p
       WHERE p.id = $1::bigint AND tb_can_see_project($6::bigint, p.id)
         AND ($2::bigint IS NULL OR EXISTS (SELECT 1 FROM tasks par WHERE par.id = $2::bigint
                                              AND par.project_id = p.id AND par.parent_id IS NULL))
       RETURNING ${TASK_COLS})${assignee ? memberCte('ins', '$6') : ''},
     pr AS (UPDATE projects SET rev = rev + 1 WHERE id = (SELECT project_id FROM ins))
     SELECT ins.*, ${taskNames('ins')}${assignee ? `, ${addedMembersSql} AS added_members` : ''} FROM ins`,
    [pid, parent, title, assignee, Date.now(), me]);
  if (r.rows[0]) return shapeTask(r.rows[0]);
  // Nothing inserted: the project is hidden or missing (404), or the parent isn't a top-level task here (400).
  const vis = await query(`SELECT tb_can_see_project($1::bigint, $2::bigint) AS ok`, [me, pid]);
  if (!vis.rows[0]?.ok) throw new HttpError(404, 'Project not found');
  throw bad('A subtask has to sit under a top-level task in the same project.');
}

async function reselectTask(viewer, id) {
  const r = await query(
    `SELECT k.id, k.project_id, k.parent_id, k.title, k.assignee_id, k.due_date, k.status, k.archived, k.notes,
            k.stoplight, k.position, k.created_at, k.created_by, k.updated_at, k.updated_by, ${taskNames('k')}
     FROM tasks k WHERE k.id = $2::bigint AND tb_can_see_project($1::bigint, k.project_id)`,
    [String(viewer.id), String(id)]);
  return r.rows[0] ? plain(r.rows[0]) : null;
}

// PATCH /api/tasks/:id: one statement (design §7.1, §8.2).
//   title, notes: base-compared text (409 with the current row when someone else changed it first).
//   status: one of the 4 keys; Done archives a TOP-LEVEL task in the same statement (subtasks never archive on
//     Done, so an old All Tasks tab's {status:'done', archived:true} leaves a subtask in place).
//   stoplight: '', red, yellow, green. due_date: 'YYYY-MM-DD' or null. archived: boolean (an explicit value wins).
//   assignee_id: a name id or null; a name linked to an account makes that account a member (§6).
// Discrete fields are last-write-wins. Returns { row, added_members }.
export async function patchTask({ viewer, id, body, now }) {
  const tid = parseId(id);
  const base = has(body, 'base') && body.base && typeof body.base === 'object' && !Array.isArray(body.base) ? body.base : {};
  const params = [];
  const p = (v) => { params.push(v); return `$${params.length}`; };
  const me = p(String(viewer.id));
  const set = [];
  const guards = [];
  const compared = [];

  for (const f of ['title', 'notes']) {
    if (!has(body, f)) continue;
    const v = TASK_TEXT[f](body[f]);
    const ph = p(v);
    set.push(`${f} = ${ph}::text`);
    if (has(base, f)) {
      const b = TASK_TEXT[f](base[f]);
      guards.push(`(COALESCE(${f}, '') = COALESCE(${p(b)}::text, '') OR COALESCE(${f}, '') = COALESCE(${ph}::text, ''))`);
      compared.push({ f, next: v, base: b });
    } else if (!inLegacyGrace(now)) {
      throw new HttpError(428, 'TeamBoard was updated — reload the page to keep editing.', { code: 'base_required' });
    }
  }

  let status = null;
  if (has(body, 'status')) {
    status = body.status == null || body.status === '' ? 'not_started' : String(body.status);
    if (!TASK_STATUS_KEYS.includes(status)) throw bad('Unknown status.');
    set.push(`status = ${p(status)}::text`);
  }
  const archiveOnDone = `archived = CASE WHEN parent_id IS NULL THEN true ELSE archived END`;
  if (has(body, 'archived')) {
    const a = !!body.archived;
    if (status === 'done' && a) set.push(archiveOnDone);
    else set.push(`archived = ${p(a)}::boolean`);
  } else if (status === 'done') {
    set.push(archiveOnDone);
  }

  let assignee = null;
  if (has(body, 'assignee_id')) {
    const a = body.assignee_id;
    assignee = a == null || a === '' || a === 0 ? null : parseId(a);
    set.push(`assignee_id = ${p(assignee)}::bigint`);
  }
  if (has(body, 'due_date')) {
    const raw = body.due_date;
    let due = null;
    if (raw != null && raw !== '') {
      due = ymd(String(raw));
      if (!due) throw bad('Invalid date.');
    }
    set.push(`due_date = ${p(due)}::text`);
  }
  if (has(body, 'stoplight')) {
    const s = body.stoplight == null ? '' : String(body.stoplight);
    if (!STOPLIGHT_KEYS.includes(s)) throw bad('Unknown priority.');
    set.push(`stoplight = ${p(s)}::text`);
  }

  if (!set.length) {
    const row = await reselectTask(viewer, tid);
    if (!row) throw gone();
    return { row, added_members: [] };
  }
  set.push('updated_at = now()', `updated_by = ${me}::bigint`);
  const idp = p(tid);
  const text = `WITH r AS (UPDATE tasks SET ${set.join(', ')}
                 WHERE id = ${idp}::bigint AND tb_can_see_project(${me}::bigint, project_id)${guards.length ? ` AND ${guards.join(' AND ')}` : ''}
                 RETURNING ${TASK_COLS})${assignee ? memberCte('r', me) : ''},
     pr AS (UPDATE projects SET rev = rev + 1 WHERE id = (SELECT project_id FROM r))
     SELECT r.*, ${taskNames('r')}${assignee ? `, ${addedMembersSql} AS added_members` : ''} FROM r`;

  for (let attempt = 1; ; attempt++) {
    const row = (await query(text, params)).rows[0];
    if (row) return shapeTask(row);
    const cur = await reselectTask(viewer, tid);
    if (!cur) throw gone();
    const fieldsHit = compared.filter(({ f, next, base: b }) => {
      const stored = cur[f] == null ? '' : String(cur[f]);
      return stored !== b && stored !== next;
    }).map((c) => c.f);
    if (!fieldsHit.length && attempt < 2) continue;            // it moved back meanwhile: try once more
    const who = cur.updated_by != null && String(cur.updated_by) === String(viewer.id)
      ? 'You changed this in another window while you were editing.'
      : `${cur.updated_by_name || 'Someone else'} changed this while you were editing.`;
    throw new HttpError(409, 'conflict', { message: who, fields: fieldsHit, current: cur });
  }
}

// ------------------------------------------------------------------------------------- info, meetings, series

// POST /api/info {project_id, label?, value?}: a (blank) info row at the end. Today's response shape.
export async function createInfo(viewer, b) {
  if (b.project_id == null || b.project_id === '') throw bad('project_id required');
  const pid = parseId(b.project_id);
  const r = await query(
    `WITH ins AS (INSERT INTO project_info (project_id, label, value, position)
                  SELECT p.id, $2::text, $3::text, $4::float8 FROM projects p
                  WHERE p.id = $1::bigint AND tb_can_see_project($5::bigint, p.id)
                  RETURNING id, project_id, label, value, position, updated_at),
     pr AS (UPDATE projects SET rev = rev + 1 WHERE id = (SELECT project_id FROM ins))
     SELECT * FROM ins`,
    [pid, norm.line(300)(b.label), norm.text(4000)(b.value), Date.now(), String(viewer.id)]);
  if (!r.rows[0]) throw new HttpError(404, 'Project not found');
  return plain(r.rows[0]);
}

// POST /api/meeting-series {project_id, name}. Blank name -> 'Series' (as today).
export async function createSeries(viewer, b) {
  if (b.project_id == null || b.project_id === '') throw bad('project_id required');
  const pid = parseId(b.project_id);
  const r = await query(
    `WITH ins AS (INSERT INTO meeting_series (project_id, name, position)
                  SELECT p.id, $2::text, $3::float8 FROM projects p
                  WHERE p.id = $1::bigint AND tb_can_see_project($4::bigint, p.id)
                  RETURNING id, project_id, name, position, updated_at),
     pr AS (UPDATE projects SET rev = rev + 1 WHERE id = (SELECT project_id FROM ins))
     SELECT * FROM ins`,
    [pid, norm.lineOr(300, 'Series')(b.name), Date.now(), String(viewer.id)]);
  if (!r.rows[0]) throw new HttpError(404, 'Project not found');
  return plain(r.rows[0]);
}

// Project meeting field normalizers (design §7.1): blank title -> 'Meeting'; attendance and notes are multi-line
// (not trimmed); a blank date -> NULL, an invalid one is refused. A9: a time is 'HH:MM' or none (''/null -> NULL),
// the place a single line.
export const MEETING_NORM = {
  title: norm.lineOr(300, 'Meeting'),
  attendance: norm.text(4000),
  notes: norm.text(100000),
  meeting_date: (v) => {
    if (v == null || v === '') return null;
    const d = ymd(String(v));
    if (!d) throw bad('Invalid date.');
    return d;
  },
  meeting_time: (v) => {
    if (v == null || v === '') return null;
    if (!isHhmm(v)) throw bad('Invalid time (use HH:MM).');
    return v;
  },
  location: norm.line(300),
};
export const MEETING_TEXT = ['title', 'attendance', 'notes', 'location'];

// Every column of a project meeting (alias m), as the page and the routes return it.
export const MEETING_COLS = `m.id, m.project_id, m.series_id, m.title, m.meeting_date, m.meeting_time, m.location, m.attendance,
  m.notes, m.position, m.archived, m.created_at, m.created_by, m.updated_at, m.updated_by`;

// A series id from a request: null for none ('' / 0 / null), else a canonical id (400 otherwise).
export const seriesIdOf = (v) => (v == null || v === '' || v === 0 || v === '0' ? null : parseId(v));

// POST /api/project-meetings {project_id, series_id?, title, meeting_date, meeting_time?, location?, attendance,
// notes}: the whole write-up at once (Post). series_id must belong to the same project.
export async function createMeeting(viewer, b) {
  if (b.project_id == null || b.project_id === '') throw bad('project_id required');
  const pid = parseId(b.project_id);
  const sid = seriesIdOf(b.series_id);
  for (const k of MEETING_TEXT) noNul(b[k]);
  const me = String(viewer.id);
  const r = await query(
    `WITH ins AS (INSERT INTO project_meetings (project_id, series_id, title, meeting_date, meeting_time, location, attendance,
                                                notes, position, created_by)
                  SELECT p.id, $2::bigint, $3::text, $4::text, $9::text, $10::text, $5::text, $6::text, $7::float8, $8::bigint
                  FROM projects p
                  WHERE p.id = $1::bigint AND tb_can_see_project($8::bigint, p.id)
                    AND ($2::bigint IS NULL OR EXISTS (SELECT 1 FROM meeting_series s WHERE s.id = $2::bigint AND s.project_id = p.id))
                  RETURNING id, project_id, series_id, title, meeting_date, meeting_time, location, attendance, notes, position,
                            archived, created_at, created_by, updated_at, updated_by),
     pr AS (UPDATE projects SET rev = rev + 1 WHERE id = (SELECT project_id FROM ins))
     SELECT * FROM ins`,
    [pid, sid, MEETING_NORM.title(b.title), MEETING_NORM.meeting_date(b.meeting_date), MEETING_NORM.attendance(b.attendance),
      MEETING_NORM.notes(b.notes), Date.now(), me, MEETING_NORM.meeting_time(b.meeting_time), MEETING_NORM.location(b.location)]);
  if (r.rows[0]) return plain(r.rows[0]);
  const vis = await query(`SELECT tb_can_see_project($1::bigint, $2::bigint) AS ok`, [me, pid]);
  if (!vis.rows[0]?.ok) throw new HttpError(404, 'Project not found');
  throw bad('That meeting series isn’t in this project.');
}

// For a PATCH that moves a meeting into a series: is series sid in the same project as meeting mid (and can the
// viewer see that project)? null series (none) is always fine.
export async function seriesFitsMeeting(viewer, mid, sid) {
  if (sid == null) return true;
  const r = await query(
    `SELECT 1 AS ok FROM project_meetings m JOIN meeting_series s ON s.project_id = m.project_id
     WHERE m.id = $2::bigint AND s.id = $3::bigint AND tb_can_see_project($1::bigint, m.project_id)`,
    [String(viewer.id), String(mid), String(sid)]);
  return !!r.rows[0];
}
