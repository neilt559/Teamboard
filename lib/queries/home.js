import 'server-only';
import * as React from 'react';
import { query, transaction } from '../db.js';
import { withDefaults } from '../prefs.js';
import { localYmd, addDays } from '../time.js';

// The Home dashboard's own data (design §2.1 "/", §11): one read-only batch for the widgets this area owns
// (my tasks, pinned projects, my projects, the admin queue) plus the viewer's notices. Other widgets
// (bracket, GeoGuessr, threads, culture) load their own data. Everything project-scoped goes through
// tb_visible_project_ids (§4.6); pins are re-filtered on read, so a lost project just drops out.
const cache = typeof React.cache === 'function' ? React.cache : (fn) => fn;

const idOrNull = (v) => (v == null ? null : String(v));
const iso = (v) => { if (v == null) return null; const d = v instanceof Date ? v : new Date(v); return Number.isNaN(d.getTime()) ? null : d.toISOString(); };
const byName = (a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { numeric: true, sensitivity: 'base' });
const MY_TASKS_LIMIT = 60;

// loadDashboard(viewer, now) ->
//   today:     'YYYY-MM-DD' in the viewer's office time zone (viewer.tz; Central when no office yet)
//   my_tasks:  { linked, total, overdue, due_today, rows: [{ id, title, project_id, project_name, parent_id,
//               parent_title, due_date, status, stoplight }] }  open tasks owned by my linked name: not done,
//               not archived, in visible active projects, teams and offices, never under an archived parent
//   pinned:    [{ id, name, archived, team_name, office_name, open_count }] in pin order (visible only)
//   my_projects: { total, rows: [...same shape] }  active visible projects where I'm a member (legacy day-one
//               rows don't count, they cover all 48), that belong to my team, or where my name owns a task
//   admin:     null, or { counts: { positions, office_changes, person_links, identity }, total,
//               oldest: [{ kind, user_id, name, detail, at }] }  (admins only)
//   notices:   { position_decided_at, decided_by, decision, position_name, position_pending, requested_name,
//               pending_office, pending_person }
export const loadDashboard = cache(async (viewer, now) => {
  const uid = String(viewer.id);
  const prefs = withDefaults(viewer.prefs, { isAdmin: !!viewer.is_admin });
  const pins = prefs.pinned_project_ids;
  const personId = idOrNull(viewer.person_id);
  const today = localYmd(now, viewer.tz || 'America/Chicago');

  const projectCols = `p.id, p.name, p.archived, t.name AS team_name, o.name AS office_name,
           (SELECT count(*) FROM tasks k WHERE k.project_id = p.id AND k.parent_id IS NULL AND NOT k.archived)::int AS open_count`;
  const batch = [
    query(`SELECT k.id, k.title, k.project_id, p.name AS project_name, k.parent_id, par.title AS parent_title,
             k.due_date, k.status, k.stoplight
           FROM tasks k JOIN projects p ON p.id = k.project_id JOIN teams t ON t.id = p.team_id
           JOIN offices o ON o.id = t.office_id LEFT JOIN tasks par ON par.id = k.parent_id
           WHERE k.assignee_id = $2::bigint AND k.status <> 'done'
             AND p.id IN (SELECT tb_visible_project_ids($1::bigint))
             AND NOT k.archived AND NOT p.archived AND NOT t.archived AND NOT o.archived
             AND NOT EXISTS (SELECT 1 FROM tasks x WHERE x.id = k.parent_id AND x.archived)
           ORDER BY (k.due_date IS NULL) ASC, k.due_date ASC, k.id ASC
           LIMIT ${MY_TASKS_LIMIT + 1}`, [uid, personId]),
    query(`SELECT count(*)::int AS total,
             count(*) FILTER (WHERE k.due_date < $3::text)::int AS overdue,
             count(*) FILTER (WHERE k.due_date = $3::text)::int AS due_today
           FROM tasks k JOIN projects p ON p.id = k.project_id JOIN teams t ON t.id = p.team_id
           JOIN offices o ON o.id = t.office_id
           WHERE k.assignee_id = $2::bigint AND k.status <> 'done'
             AND p.id IN (SELECT tb_visible_project_ids($1::bigint))
             AND NOT k.archived AND NOT p.archived AND NOT t.archived AND NOT o.archived
             AND NOT EXISTS (SELECT 1 FROM tasks x WHERE x.id = k.parent_id AND x.archived)`, [uid, personId, today]),
    query(`SELECT ${projectCols}
           FROM projects p JOIN teams t ON t.id = p.team_id JOIN offices o ON o.id = t.office_id
           WHERE p.id = ANY($2::bigint[]) AND p.id IN (SELECT tb_visible_project_ids($1::bigint))`, [uid, pins]),
    query(`SELECT ${projectCols}
           FROM projects p JOIN teams t ON t.id = p.team_id JOIN offices o ON o.id = t.office_id
           WHERE p.id IN (SELECT tb_visible_project_ids($1::bigint))
             AND NOT p.archived AND NOT t.archived AND NOT o.archived
             AND (EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = p.id AND m.user_id = $1::bigint
                            AND m.removed_at IS NULL AND m.source <> 'legacy')
                  OR p.team_id = $2::bigint
                  OR EXISTS (SELECT 1 FROM tasks k WHERE k.project_id = p.id AND k.assignee_id = $3::bigint
                               AND NOT k.archived))`, [uid, idOrNull(viewer.team_id), personId]),
    // Notices: the latest position decision (§4.2a banner) and anything still waiting for an admin.
    query(`SELECT u.position_decided_at,
             COALESCE(NULLIF(m.display_name, ''), m.username) AS decided_by,
             ap.name AS position_name, rp.name AS requested_name,
             (u.position_id IS DISTINCT FROM u.approved_position_id) AS position_pending,
             (SELECT a.action FROM audit_log a WHERE a.entity = 'users' AND a.entity_id = u.id::text
                AND a.action IN ('position.approve', 'position.set') ORDER BY a.id DESC LIMIT 1) AS decision,
             (SELECT o.name FROM access_requests q JOIN offices o ON o.id = q.office_id
                WHERE q.user_id = u.id AND q.kind = 'office_change' AND q.status = 'pending' LIMIT 1) AS pending_office,
             (SELECT pe.name FROM access_requests q JOIN people pe ON pe.id = q.person_id
                WHERE q.user_id = u.id AND q.kind = 'person_link' AND q.status = 'pending' LIMIT 1) AS pending_person
           FROM users u
           LEFT JOIN users m ON m.id = u.position_decided_by
           LEFT JOIN positions ap ON ap.id = u.approved_position_id
           LEFT JOIN positions rp ON rp.id = u.position_id
           WHERE u.id = $1::bigint`, [uid]),
  ];
  if (viewer.is_admin) {
    // The approval queue (§5.5): the same three sources as the header's "Admin (N)" count, oldest first.
    batch.push(query(`SELECT kind, user_id, name, detail, at FROM (
        SELECT 'position'::text AS kind, u.id::text AS user_id, COALESCE(NULLIF(u.display_name, ''), u.username) AS name,
               rp.name AS detail, u.position_requested_at AS at
        FROM users u JOIN positions rp ON rp.id = u.position_id
        WHERE u.disabled_at IS NULL AND u.position_id IS DISTINCT FROM u.approved_position_id
        UNION ALL
        SELECT q.kind, u.id::text, COALESCE(NULLIF(u.display_name, ''), u.username),
               COALESCE(o.name, pe.name, ''), q.created_at
        FROM access_requests q JOIN users u ON u.id = q.user_id
        LEFT JOIN offices o ON o.id = q.office_id LEFT JOIN people pe ON pe.id = q.person_id
        WHERE q.status = 'pending' AND u.disabled_at IS NULL
        UNION ALL
        SELECT 'identity'::text, u.id::text, COALESCE(NULLIF(u.display_name, ''), u.username),
               COALESCE(u.email, ''), u.profile_completed_at
        FROM users u
        WHERE u.disabled_at IS NULL AND u.profile_completed_at IS NOT NULL AND u.identity_verified_at IS NULL
      ) x ORDER BY at ASC NULLS LAST, user_id ASC`));
  }
  const res = (await transaction(batch, { readOnly: true })).map((r) => r.rows);
  const [taskRows, taskCounts, pinnedRows, myRows, noticeRows, queueRows] = res;

  const shapeProject = (p) => ({
    id: String(p.id), name: p.name, archived: !!p.archived, team_name: p.team_name, office_name: p.office_name,
    open_count: Number(p.open_count) || 0,
  });
  const pinnedById = new Map(pinnedRows.map((p) => [String(p.id), shapeProject(p)]));
  const tc = taskCounts[0] || {};
  const n = noticeRows[0] || {};
  let admin = null;
  if (viewer.is_admin) {
    const rows = queueRows || [];
    const count = (k) => rows.filter((r) => r.kind === k).length;
    admin = {
      counts: { positions: count('position'), office_changes: count('office_change'), person_links: count('person_link'),
        identity: count('identity') },
      total: rows.length,
      oldest: rows.slice(0, 6).map((r) => ({ kind: r.kind, user_id: String(r.user_id), name: r.name, detail: r.detail || '',
        at: iso(r.at) })),
    };
  }
  return {
    today,
    week_end: addDays(today, 7),
    my_tasks: {
      linked: personId != null,
      total: Number(tc.total) || 0,
      overdue: Number(tc.overdue) || 0,
      due_today: Number(tc.due_today) || 0,
      rows: taskRows.slice(0, MY_TASKS_LIMIT).map((k) => ({
        id: String(k.id), title: k.title || '', project_id: String(k.project_id), project_name: k.project_name,
        parent_id: idOrNull(k.parent_id), parent_title: k.parent_title ?? null, due_date: k.due_date || null,
        status: k.status || 'not_started', stoplight: k.stoplight || '',
      })),
    },
    pinned: pins.map((id) => pinnedById.get(id)).filter(Boolean),
    my_projects: { total: myRows.length, rows: myRows.map(shapeProject).sort(byName) },
    admin,
    notices: {
      position_decided_at: iso(n.position_decided_at),
      decided_by: n.decided_by || null,
      decision: n.decision || null,
      position_name: n.position_name || null,
      position_pending: !!n.position_pending,
      requested_name: n.requested_name || null,
      pending_office: n.pending_office || null,
      pending_person: n.pending_person || null,
    },
  };
});
