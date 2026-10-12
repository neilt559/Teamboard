import 'server-only';
import * as React from 'react';
import { query } from '../db.js';

// Project lists (design §2.1 /projects and /my-work "My projects", §4.6). Every query goes through
// tb_visible_project_ids, so a project the viewer can't see never reaches the page (not its name, not a count).
const cache = typeof React.cache === 'function' ? React.cache : (fn) => fn;

const byName = (a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { numeric: true, sensitivity: 'base' });
const idStr = (v) => (v == null ? null : String(v));
const iso = (v) => (v == null ? null : v instanceof Date ? v.toISOString() : String(v));

// One row per visible project, with its team and office (names are company-public) and task counts.
//   $1 viewer id, $2 the viewer's linked "name on tasks" (people.id) or NULL, $3 the viewer's team or NULL,
//   $4 include archived projects (and projects whose team or office is archived), $5 only "mine" rows.
// mine = "my project": a membership that isn't the day-one legacy grant, a task assigned to me there (open or
// done), or a project of my own team. Legacy members of all 48 pre-launch projects would otherwise find every
// project under "Mine"; this is the same set "Apply new rules" keeps for them (design §6), so the tab means
// the same thing before and after Neil applies the rules.
// open_count = top-level tasks not archived (the sidebar's count); total/done = top-level tasks, archived
// included (progress counts archived Done tasks, rule 21); my_open = my open tasks (not done, not archived,
// parent not archived: §4.6).
const PROJECTS_SQL = `
SELECT p.id, p.name, p.archived, p.team_id, p.created_at,
       t.name AS team_name, t.archived AS team_archived, t.position AS team_position,
       o.id AS office_id, o.name AS office_name, o.archived AS office_archived, o.position AS office_position,
       EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = p.id AND m.user_id = $1::bigint
                 AND m.removed_at IS NULL) AS is_member,
       (EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = p.id AND m.user_id = $1::bigint
                  AND m.removed_at IS NULL AND m.source <> 'legacy')
        OR EXISTS (SELECT 1 FROM tasks k WHERE k.project_id = p.id AND k.assignee_id = $2::bigint)
        OR p.team_id = $3::bigint) AS mine,
       c.open_count, c.total_count, c.done_count, c.my_open
FROM projects p
JOIN teams t ON t.id = p.team_id
JOIN offices o ON o.id = t.office_id
CROSS JOIN LATERAL (
  SELECT count(*) FILTER (WHERE k.parent_id IS NULL AND NOT k.archived)::int AS open_count,
         count(*) FILTER (WHERE k.parent_id IS NULL)::int AS total_count,
         count(*) FILTER (WHERE k.parent_id IS NULL AND k.status = 'done')::int AS done_count,
         count(*) FILTER (WHERE k.assignee_id = $2::bigint AND NOT k.archived AND k.status <> 'done'
                            AND NOT EXISTS (SELECT 1 FROM tasks pa WHERE pa.id = k.parent_id AND pa.archived))::int AS my_open
  FROM tasks k WHERE k.project_id = p.id) c
WHERE p.id IN (SELECT tb_visible_project_ids($1::bigint))
  AND ($4::boolean OR (NOT p.archived AND NOT t.archived AND NOT o.archived))
  AND (NOT $5::boolean
       OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = p.id AND m.user_id = $1::bigint
                    AND m.removed_at IS NULL AND m.source <> 'legacy')
       OR EXISTS (SELECT 1 FROM tasks k WHERE k.project_id = p.id AND k.assignee_id = $2::bigint)
       OR p.team_id = $3::bigint)`;

function shape(r) {
  return {
    id: String(r.id),
    name: r.name || '',
    archived: !!r.archived,
    team_id: idStr(r.team_id),
    team_name: r.team_name || '',
    team_archived: !!r.team_archived,
    team_position: Number(r.team_position) || 0,
    office_id: idStr(r.office_id),
    office_name: r.office_name || '',
    office_archived: !!r.office_archived,
    office_position: Number(r.office_position) || 0,
    created_at: iso(r.created_at),
    is_member: !!r.is_member,
    mine: !!r.mine,
    open_count: Number(r.open_count) || 0,
    total_count: Number(r.total_count) || 0,
    done_count: Number(r.done_count) || 0,
    my_open: Number(r.my_open) || 0,
  };
}

const params = (viewer, { archived = false, mineOnly = false } = {}) =>
  [String(viewer.id), viewer.person_id ?? null, viewer.team_id ?? null, !!archived, !!mineOnly];

// listVisibleProjects(viewer, { archived }) -> { projects }
//   projects: every project the viewer can see, by name (numeric-aware). Without `archived`, only active
//   projects in active teams and offices; with it, archived ones too (flags say which part is archived).
//   The tabs, office/team filter and search run on the client over this list (it is already permission-
//   filtered, so filtering in the browser shows nothing new).
export const listVisibleProjects = cache(async (viewer, filters = {}) => {
  // PROJECTS_SQL filters through tb_visible_project_ids.
  const { rows } = await query(PROJECTS_SQL, params(viewer, { archived: !!filters.archived }));
  return { projects: rows.map(shape).sort(byName) };
});

// listMyProjects(viewer) -> my active projects ("mine" above), the ones with my open tasks first, then by name.
export const listMyProjects = cache(async (viewer) => {
  // PROJECTS_SQL filters through tb_visible_project_ids.
  const { rows } = await query(PROJECTS_SQL, params(viewer, { mineOnly: true }));
  return rows.map(shape).sort((a, b) => (b.my_open - a.my_open) || byName(a, b));
});
