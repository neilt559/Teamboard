import 'server-only';
import * as React from 'react';
import { query, transaction } from '../db.js';

// Task lists: All tasks (/tasks) and My work (/my-work), design §2.1 and §4.6.
// Open tasks are the non-archived tasks of visible, active projects in active teams and offices, minus subtasks
// whose parent is archived: marking a parent Done archives only the parent, and without that last predicate its
// unfinished subtasks would sit in these lists forever with no visible parent (they still show, and stay
// editable, under their parent in the board's archived section).
const cache = typeof React.cache === 'function' ? React.cache : (fn) => fn;

const idStr = (v) => (v == null ? null : String(v));
const iso = (v) => (v == null ? null : v instanceof Date ? v.toISOString() : String(v));

//   $1 viewer id; $2 only tasks assigned to this people.id (NULL = everyone's); $3 leave out status 'done'.
// Order = the board's (position, id); the lists sort on the client and ties keep this order.
const OPEN_TASKS_SQL = `
SELECT k.id, k.project_id, k.parent_id, k.title, k.notes, k.assignee_id, k.due_date, k.status, k.stoplight,
       k.created_at, p.name AS project_name, p.team_id, t.name AS team_name, t.office_id, o.name AS office_name,
       par.title AS parent_title
FROM tasks k
JOIN projects p ON p.id = k.project_id
JOIN teams t ON t.id = p.team_id
JOIN offices o ON o.id = t.office_id
LEFT JOIN tasks par ON par.id = k.parent_id
WHERE p.id IN (SELECT tb_visible_project_ids($1::bigint))
  AND NOT k.archived AND NOT p.archived AND NOT t.archived AND NOT o.archived
  AND NOT EXISTS (SELECT 1 FROM tasks pa WHERE pa.id = k.parent_id AND pa.archived)
  AND ($2::bigint IS NULL OR k.assignee_id = $2::bigint)
  AND (NOT $3::boolean OR k.status <> 'done')
ORDER BY k.position ASC, k.id ASC`;

// The assignee roster for owner pickers and the Person filter ("names on tasks", not login accounts).
// Archived names are included and flagged: they stay on the tasks they own, so a row must still show them.
const PEOPLE_SQL = `
SELECT id, name, color, kind, (archived_at IS NOT NULL) AS archived
FROM people ORDER BY lower(name) ASC, id ASC`;

// Visible active projects with their team and office: the Office -> Team -> Project filter choices.
const FILTER_PROJECTS_SQL = `
SELECT p.id, p.name, p.team_id, t.name AS team_name, t.position AS team_position,
       t.office_id, o.name AS office_name, o.position AS office_position
FROM projects p JOIN teams t ON t.id = p.team_id JOIN offices o ON o.id = t.office_id
WHERE p.id IN (SELECT tb_visible_project_ids($1::bigint))
  AND NOT p.archived AND NOT t.archived AND NOT o.archived`;

export function shapeTask(r) {
  return {
    id: String(r.id),
    project_id: String(r.project_id),
    parent_id: idStr(r.parent_id),
    title: r.title || '',
    notes: r.notes || '',
    assignee_id: idStr(r.assignee_id),
    due_date: r.due_date || null,
    status: r.status || 'not_started',
    stoplight: r.stoplight || '',
    archived: false,
    created_at: iso(r.created_at),
    project_name: r.project_name || '',
    team_id: idStr(r.team_id),
    team_name: r.team_name || '',
    office_id: idStr(r.office_id),
    office_name: r.office_name || '',
    parent_title: r.parent_id != null ? (r.parent_title || '') : null,
  };
}

const shapePerson = (r) => ({
  id: String(r.id), name: r.name || '', color: r.color || '#5B5859', kind: r.kind || 'person', archived: !!r.archived,
});

const shapeFilterProject = (r) => ({
  id: String(r.id), name: r.name || '', team_id: idStr(r.team_id), team_name: r.team_name || '',
  team_position: Number(r.team_position) || 0, office_id: idStr(r.office_id), office_name: r.office_name || '',
  office_position: Number(r.office_position) || 0,
});

// listVisibleOpenTasks(viewer) -> { tasks, people, projects } for All tasks. One read-only batch.
//   tasks: every open task (top-level and subtasks, any status) of the projects the viewer can see.
//   people: the whole roster (archived flagged). projects: visible active projects for the filter menus.
export const listVisibleOpenTasks = cache(async (viewer) => {
  const uid = String(viewer.id);
  const [tasks, people, projects] = (await transaction([
    query(OPEN_TASKS_SQL, [uid, null, false]),
    query(PEOPLE_SQL),
    query(FILTER_PROJECTS_SQL, [uid]),
  ], { readOnly: true })).map((r) => r.rows);
  return { tasks: tasks.map(shapeTask), people: people.map(shapePerson), projects: projects.map(shapeFilterProject) };
});

// listMyTasks(viewer) -> my open tasks (assigned to my linked name, status not Done), in board order; [] when my
// account isn't linked to a name on tasks yet. Also used by the Home "My tasks" widget.
export const listMyTasks = cache(async (viewer) => {
  if (!viewer.person_id) return [];
  // OPEN_TASKS_SQL filters through tb_visible_project_ids.
  const { rows } = await query(OPEN_TASKS_SQL, [String(viewer.id), String(viewer.person_id), true]);
  return rows.map(shapeTask);
});

// What My work says about the viewer's own pending requests (design §4.2): a position waiting for approval
// and pending office-change or "that's me" person-link requests. Only the viewer's own rows.
const NOTICES_SQL = `
SELECT q.id, q.kind, q.created_at, o.name AS office_name, tm.name AS team_name, fo.name AS from_office_name,
       pe.name AS person_name
FROM access_requests q
LEFT JOIN offices o ON o.id = q.office_id
LEFT JOIN teams tm ON tm.id = q.team_id
LEFT JOIN offices fo ON fo.id = q.from_office_id
LEFT JOIN people pe ON pe.id = q.person_id
WHERE q.user_id = $1::bigint AND q.status = 'pending'
ORDER BY q.created_at ASC, q.id ASC`;
const POSITION_SQL = `
SELECT rp.name AS requested, rp.level AS requested_level, ap.name AS approved, ap.level AS approved_level,
       u.position_requested_at
FROM users u
LEFT JOIN positions rp ON rp.id = u.position_id
LEFT JOIN positions ap ON ap.id = u.approved_position_id
WHERE u.id = $1::bigint AND u.position_id IS DISTINCT FROM u.approved_position_id AND u.position_id IS NOT NULL`;

// loadMyWork(viewer) -> { tasks, people, notices } for /my-work. One read-only batch; the page runs
// listMyProjects (lib/queries/projects-list.js) beside it.
//   tasks: as listMyTasks; people: the roster; notices: { position: {...} | null, requests: [...] }.
export const loadMyWork = cache(async (viewer) => {
  const uid = String(viewer.id);
  const person = viewer.person_id ? String(viewer.person_id) : null;
  const res = await transaction([
    // OPEN_TASKS_SQL filters through tb_visible_project_ids; with no linked name, $2 = 0 matches nothing.
    query(OPEN_TASKS_SQL, [uid, person ?? '0', true]),
    query(PEOPLE_SQL),
    query(NOTICES_SQL, [uid]),
    query(POSITION_SQL, [uid]),
  ], { readOnly: true });
  const [tasks, people, requests, position] = res.map((r) => r.rows);
  const pos = position[0] || null;
  return {
    tasks: person ? tasks.map(shapeTask) : [],
    people: people.map(shapePerson),
    notices: {
      position: pos ? {
        requested: pos.requested || '', requested_level: Number(pos.requested_level) || 1,
        approved: pos.approved || null, approved_level: pos.approved_level == null ? null : Number(pos.approved_level),
        requested_at: iso(pos.position_requested_at),
      } : null,
      requests: requests.map((q) => ({
        id: String(q.id), kind: q.kind, created_at: iso(q.created_at), office_name: q.office_name || null,
        team_name: q.team_name || null, from_office_name: q.from_office_name || null, person_name: q.person_name || null,
      })),
    },
  };
});
