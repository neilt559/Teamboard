import 'server-only';
import * as React from 'react';
import { query, transaction } from '../db.js';
import { shapePerson } from './offices.js';

// Loader for /teams/[teamId], the team overview (design §2.1, §2.3, inventory §1.10).
// Team names and members are company-public; projects and their tasks are only the viewer's visible ones
// (tb_visible_project_ids, §4.6). Done subtasks stay listed (they never auto-archive) and get an indicator.
const cache = typeof React.cache === 'function' ? React.cache : (fn) => fn;

const idOrNull = (v) => (v == null ? null : String(v));
const byName = (a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { numeric: true, sensitivity: 'base' });

// loadTeam(viewer, teamId) -> null (no such team) or
//   { team: { id, name, office_id, archived, position }, office: { id, name, archived } | null,
//     offices: [{ id, name, position }]  active offices (for the move select; the page filters by rights),
//     projects: [{ id, name, notes, team_id, office_id, created_by, legacy_member, archived }] by name,
//     tasks:   [{ id, project_id, parent_id, title, assignee_id, status, stoplight, position }] in board order:
//              active top-level tasks of those projects plus their active subtasks,
//     people:  the task-name roster [{ id, name, color, kind, archived }] (archived names only when a listed
//              task still points at them, so owner chips keep their name),
//     members: [{ ...public person fields }] accounts whose team this is (zz_ and disabled hidden) }
// Whether an archived team (or a team in an archived office) is shown at all is the page's call.
export const loadTeam = cache(async (viewer, teamId) => {
  const uid = String(viewer.id);
  const tid = String(teamId);
  const [teamRows, offices, projects, tasks, people, members] = (await transaction([
    query(`SELECT t.id, t.name, t.office_id, t.archived, t.position, o.name AS office_name, o.archived AS office_archived
           FROM teams t LEFT JOIN offices o ON o.id = t.office_id WHERE t.id = $1::bigint`, [tid]),
    query(`SELECT id, name, position FROM offices WHERE NOT archived ORDER BY position ASC, id ASC`),
    query(`SELECT p.id, p.name, p.notes, p.team_id, t.office_id, p.created_by, p.archived,
             EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = p.id AND m.user_id = $1::bigint
                       AND m.removed_at IS NULL AND m.source = 'legacy') AS legacy_member
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
    query(`SELECT u.id, u.username, COALESCE(NULLIF(u.display_name, ''), u.username) AS name,
             (u.identity_verified_at IS NOT NULL) AS identity_verified, u.avatar_v,
             d.name AS dept_name, d.color AS dept_color, ap.name AS position_name, NULL::bigint AS team_id, NULL::text AS team_name
           FROM users u
           LEFT JOIN departments d ON d.id = u.department_id AND NOT d.archived
           LEFT JOIN positions ap ON ap.id = u.approved_position_id
           WHERE u.team_id = $1::bigint AND u.disabled_at IS NULL AND u.username NOT LIKE 'zz!_%' ESCAPE '!'
           ORDER BY lower(COALESCE(NULLIF(u.display_name, ''), u.username)), u.id`, [tid]),
  ], { readOnly: true })).map((r) => r.rows);

  const t = teamRows[0];
  if (!t) return null;
  const top = new Set(tasks.filter((k) => k.parent_id == null).map((k) => String(k.id)));
  return {
    team: { id: String(t.id), name: t.name, office_id: idOrNull(t.office_id), archived: !!t.archived, position: Number(t.position) },
    office: t.office_id != null
      ? { id: String(t.office_id), name: t.office_name, archived: !!t.office_archived } : null,
    offices: offices.map((o) => ({ id: String(o.id), name: o.name, position: Number(o.position) })),
    projects: projects.map((p) => ({
      id: String(p.id), name: p.name, notes: p.notes || '', team_id: String(p.team_id), office_id: idOrNull(p.office_id),
      created_by: idOrNull(p.created_by), legacy_member: !!p.legacy_member, archived: !!p.archived,
    })).sort(byName),
    // A subtask is listed only under an active, listed parent (as on the old overview).
    tasks: tasks
      .filter((k) => k.parent_id == null || top.has(String(k.parent_id)))
      .map((k) => ({
        id: String(k.id), project_id: String(k.project_id), parent_id: idOrNull(k.parent_id), title: k.title || '',
        assignee_id: idOrNull(k.assignee_id), status: k.status || 'not_started', stoplight: k.stoplight || '',
        position: Number(k.position),
      })),
    people: people.map((p) => ({ id: String(p.id), name: p.name, color: p.color, kind: p.kind || 'person', archived: !!p.archived })),
    members: members.map(shapePerson),
  };
});
