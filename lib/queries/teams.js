import 'server-only';
import * as React from 'react';
import { query, transaction } from '../db.js';
import { canEditRoster } from '../policy.js';
import { LEGACY_SOURCES_SQL, ROSTER_SOURCES_SQL, ownsTaskSql } from '../rosters.js';
import { shapePerson } from './offices.js';
import { projectTitle, byProjectNumber } from '../projects.js';

// Loader for /teams/[teamId], the team overview (design §2.1, §2.3, inventory §1.10), and its roster (A4).
// Team names and rosters are company-public; projects and their tasks are only the viewer's visible ones
// (tb_visible_project_ids, §4.6). Done subtasks stay listed (they never auto-archive) and get an indicator.
const cache = typeof React.cache === 'function' ? React.cache : (fn) => fn;

const idOrNull = (v) => (v == null ? null : String(v));

// ------------------------------------------------------------------------------------------- roster (A4)

// Team rosters (design-amendments A4). Roster names are company-public: everyone who can see the team page sees
// them. zz_ test accounts show only to other zz_ accounts (rule 51, as in the people pickers); disabled accounts
// are hidden. For the Remove confirm, editors only (shapeRoster): team_projects = how many project memberships
// removing someone takes away, exactly the rows lib/rosters.js removeFromRoster removes (their roster rows,
// 'team' / 'team_legacy', on every project of the team, archived ones too, except where they own a task), and
// task_projects = those it keeps because they own a task there. The count must match what the DELETE does, so
// it covers projects the viewer can't open: roster editors who are admins, L3+ or L2 in the office see every
// project of the team anyway (tb_can_see_project), and for a roster PM below that it is only a number about
// their own team's roster (the DELETE answer reports it too). The picked-but-not-on-the-roster list is for
// editors too (it carries "Add").
const ROSTER_PERSON = `u.id, u.username, COALESCE(NULLIF(u.display_name, ''), u.username) AS name,
       (u.identity_verified_at IS NOT NULL) AS identity_verified, u.avatar_v,
       d.name AS dept_name, d.color AS dept_color, ap.name AS position_name, u.office_id, o.name AS office_name,
       NULL::bigint AS team_id, NULL::text AS team_name`;
const ROSTER_JOINS = `LEFT JOIN departments d ON d.id = u.department_id AND NOT d.archived
       LEFT JOIN positions ap ON ap.id = u.approved_position_id
       LEFT JOIN offices o ON o.id = u.office_id`;
const SHOWN = `u.disabled_at IS NULL AND ($2::boolean OR u.username NOT LIKE 'zz!_%' ESCAPE '!')`;
// The viewer ($3) is a PM on this roster (x = the roster row being counted).
const ROSTER_PM_VIEWER = `EXISTS (SELECT 1 FROM team_members g WHERE g.team_id = x.team_id AND g.user_id = $3::bigint
                                     AND g.role = 'pm' AND g.removed_at IS NULL)`;

// [roster, picked, my role] for one team. Roster: $1 team, $2 the viewer is a zz_ account, $3 the viewer;
// picked: $1, $2; my role: $1 team, $2 the viewer.
function rosterQueries(tid, viewer) {
  const zz = /^zz_/.test(viewer.username || '');
  const me = String(viewer.id);
  return [
    query(`SELECT ${ROSTER_PERSON}, x.role, x.created_at AS joined_at,
             (SELECT count(*) FROM project_members m JOIN projects p ON p.id = m.project_id
              WHERE p.team_id = x.team_id AND m.user_id = x.user_id AND m.source IN ${ROSTER_SOURCES_SQL}
                AND m.removed_at IS NULL AND NOT ${ownsTaskSql('m')}
                AND (tb_can_see_project($3::bigint, p.id) OR ${ROSTER_PM_VIEWER}))::int AS team_projects,
             (SELECT count(*) FROM project_members m JOIN projects p ON p.id = m.project_id
              WHERE p.team_id = x.team_id AND m.user_id = x.user_id AND m.source IN ${ROSTER_SOURCES_SQL}
                AND m.removed_at IS NULL AND ${ownsTaskSql('m')}
                AND (tb_can_see_project($3::bigint, p.id) OR ${ROSTER_PM_VIEWER}))::int AS task_projects
           FROM team_members x JOIN users u ON u.id = x.user_id
           ${ROSTER_JOINS}
           WHERE x.team_id = $1::bigint AND x.removed_at IS NULL AND ${SHOWN}
           ORDER BY (x.role = 'pm') DESC, lower(COALESCE(NULLIF(u.display_name, ''), u.username)), u.id`, [tid, zz, me]),
    // Picked this team as their home team (wizard / Settings) but aren't on the roster.
    query(`SELECT ${ROSTER_PERSON}
           FROM users u
           ${ROSTER_JOINS}
           WHERE u.team_id = $1::bigint AND ${SHOWN}
             AND NOT EXISTS (SELECT 1 FROM team_members x WHERE x.team_id = $1::bigint AND x.user_id = u.id
                               AND x.removed_at IS NULL)
           ORDER BY lower(COALESCE(NULLIF(u.display_name, ''), u.username)), u.id`, [tid, zz]),
    query(`SELECT x.role FROM team_members x WHERE x.team_id = $1::bigint AND x.user_id = $2::bigint AND x.removed_at IS NULL`,
      [tid, me]),
  ];
}

// -> { my_role, can_edit, members: [{ ...person, office, role, is_me, team_projects, task_projects (editors) }],
//      picked (editors) }
function shapeRoster(viewer, team, [rosterRows, pickedRows, mine]) {
  const myRole = mine[0]?.role || null;
  const canEdit = canEditRoster(viewer, team, myRole);
  const person = (r) => ({
    ...shapePerson(r),
    office: r.office_id != null ? { id: String(r.office_id), name: r.office_name } : null,
    // NameLabel links the name only when the profile opens for this viewer (zz_ profiles: admins and self).
    listed: !/^zz_/.test(r.username || '') || !!viewer.is_admin || String(r.id) === String(viewer.id),
  });
  return {
    my_role: myRole,
    can_edit: canEdit,
    members: rosterRows.map((r) => ({
      ...person(r),
      role: r.role === 'pm' ? 'pm' : 'member',
      is_me: String(r.id) === String(viewer.id),
      ...(canEdit ? { team_projects: Number(r.team_projects) || 0, task_projects: Number(r.task_projects) || 0 } : {}),
    })),
    picked: canEdit ? pickedRows.map(person) : [],
  };
}

// GET /api/teams/:id/members: { team, my_role, can_edit, members, picked }, or null when the team doesn't exist.
// The route applies the team page's own visibility (archived team / office) first.
export async function loadRoster(viewer, teamId) {
  const tid = String(teamId);
  const [teamRows, ...rest] = (await transaction([
    query(`SELECT t.id, t.name, t.office_id, t.archived, COALESCE(o.archived, false) AS office_archived
           FROM teams t LEFT JOIN offices o ON o.id = t.office_id WHERE t.id = $1::bigint`, [tid]),
    ...rosterQueries(tid, viewer),
  ], { readOnly: true })).map((r) => r.rows);
  const t = teamRows[0];
  if (!t) return null;
  const team = {
    id: String(t.id), name: t.name, office_id: idOrNull(t.office_id), archived: !!t.archived, office_archived: !!t.office_archived,
  };
  return { team, ...shapeRoster(viewer, team, rest) };
}

// ------------------------------------------------------------------------------------------- team page

// loadTeam(viewer, teamId) -> null (no such team) or
//   { team: { id, name, office_id, archived, position }, office: { id, name, archived } | null,
//     offices: [{ id, name, position }]  active offices (for the move select; the page filters by rights),
//     projects: [{ id, name, notes, team_id, office_id, created_by, legacy_member, archived }] by name,
//     tasks:   [{ id, project_id, parent_id, title, assignee_id, status, stoplight, position }] in board order:
//              active top-level tasks of those projects plus their active subtasks,
//     people:  the task-name roster [{ id, name, color, kind, archived }] (archived names only when a listed
//              task still points at them, so owner chips keep their name),
//     roster:  { my_role, can_edit, members, picked } (A4: the team's people, shapeRoster above) }
// Whether an archived team (or a team in an archived office) is shown at all is the page's call.
export const loadTeam = cache(async (viewer, teamId) => {
  const uid = String(viewer.id);
  const tid = String(teamId);
  const [teamRows, offices, projects, tasks, people, ...rosterRows] = (await transaction([
    query(`SELECT t.id, t.name, t.office_id, t.archived, t.position, o.name AS office_name, o.archived AS office_archived
           FROM teams t LEFT JOIN offices o ON o.id = t.office_id WHERE t.id = $1::bigint`, [tid]),
    query(`SELECT id, name, position FROM offices WHERE NOT archived ORDER BY position ASC, id ASC`),
    query(`SELECT p.id, p.name, p.project_number, p.notes, p.team_id, t.office_id, p.created_by, p.archived,
             EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = p.id AND m.user_id = $1::bigint
                       AND m.removed_at IS NULL AND m.source IN ${LEGACY_SOURCES_SQL}) AS legacy_member
           FROM projects p JOIN teams t ON t.id = p.team_id
           WHERE p.team_id = $2::bigint AND NOT p.archived
             AND p.id IN (SELECT tb_visible_project_ids($1::bigint))`, [uid, tid]),
    query(`SELECT k.id, k.project_id, k.parent_id, k.title, k.assignee_id, k.status, k.stoplight, k.position
           FROM tasks k JOIN projects p ON p.id = k.project_id
           WHERE p.team_id = $2::bigint AND NOT p.archived AND NOT k.archived
             AND p.id IN (SELECT tb_visible_project_ids($1::bigint))
           ORDER BY k.position ASC, k.id ASC`, [uid, tid]),
    query(`SELECT pe.id, pe.name, pe.color, pe.kind, (pe.archived_at IS NOT NULL) AS archived
           FROM people pe
           WHERE pe.archived_at IS NULL
              OR pe.id IN (SELECT k.assignee_id FROM tasks k JOIN projects p ON p.id = k.project_id
                           WHERE p.team_id = $2::bigint AND NOT k.archived
                             AND p.id IN (SELECT tb_visible_project_ids($1::bigint)))
           ORDER BY lower(pe.name) ASC, pe.id ASC`, [uid, tid]),
    ...rosterQueries(tid, viewer),
  ], { readOnly: true })).map((r) => r.rows);

  const t = teamRows[0];
  if (!t) return null;
  const top = new Set(tasks.filter((k) => k.parent_id == null).map((k) => String(k.id)));
  const team = { id: String(t.id), name: t.name, office_id: idOrNull(t.office_id), archived: !!t.archived, position: Number(t.position) };
  return {
    team,
    office: t.office_id != null
      ? { id: String(t.office_id), name: t.office_name, archived: !!t.office_archived } : null,
    offices: offices.map((o) => ({ id: String(o.id), name: o.name, position: Number(o.position) })),
    projects: projects.map((p) => ({
      id: String(p.id), name: p.name, project_number: p.project_number || '', title: projectTitle(p), notes: p.notes || '',
      team_id: String(p.team_id), office_id: idOrNull(p.office_id),
      created_by: idOrNull(p.created_by), legacy_member: !!p.legacy_member, archived: !!p.archived,
    })).sort(byProjectNumber),
    // A subtask is listed only under an active, listed parent (as on the old overview).
    tasks: tasks
      .filter((k) => k.parent_id == null || top.has(String(k.parent_id)))
      .map((k) => ({
        id: String(k.id), project_id: String(k.project_id), parent_id: idOrNull(k.parent_id), title: k.title || '',
        assignee_id: idOrNull(k.assignee_id), status: k.status || 'not_started', stoplight: k.stoplight || '',
        position: Number(k.position),
      })),
    people: people.map((p) => ({ id: String(p.id), name: p.name, color: p.color, kind: p.kind || 'person', archived: !!p.archived })),
    roster: shapeRoster(viewer, team, rosterRows),
  };
});
