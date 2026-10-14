import 'server-only';
import * as React from 'react';
import { query, transaction } from '../db.js';
import { withDefaults } from '../prefs.js';
import { projectTitle } from '../projects.js';

// Loaders for /offices and /offices/[officeId] (design §2.1, §4.5, §4.6).
// Office names, team names and people are company-public; project names and counts are filtered per project
// through tb_visible_project_ids; office meetings (office-internal) come back only when tb_can_see_office is
// true for the viewer (home or extra office at any level, or L3+, or admin; Neil 2026-10-11).
const cache = typeof React.cache === 'function' ? React.cache : (fn) => fn;

const idOrNull = (v) => (v == null ? null : String(v));
const iso = (v) => { if (v == null) return null; const d = v instanceof Date ? v : new Date(v); return Number.isNaN(d.getTime()) ? null : d.toISOString(); };
const byPos = (a, b) => (Number(a.position) - Number(b.position)) || (Number(a.id) - Number(b.id));
const byName = (a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { numeric: true, sensitivity: 'base' });

// Public fields of a person card (never email, a pending position, the admin flag or photo blobs).
const PERSON_COLS = `u.id, u.username, COALESCE(NULLIF(u.display_name, ''), u.username) AS name,
       (u.identity_verified_at IS NOT NULL) AS identity_verified, u.avatar_v,
       d.name AS dept_name, d.color AS dept_color, ap.name AS position_name, t.id AS team_id, t.name AS team_name`;
const PERSON_JOINS = `LEFT JOIN departments d ON d.id = u.department_id AND NOT d.archived
       LEFT JOIN positions ap ON ap.id = u.approved_position_id
       LEFT JOIN teams t ON t.id = u.team_id AND NOT t.archived`;
// Directory rule (§2.1 /people): zz_ test accounts and disabled accounts are hidden.
const REAL_USER = `u.disabled_at IS NULL AND u.username NOT LIKE 'zz!_%' ESCAPE '!'`;

export const shapePerson = (r) => ({
  id: String(r.id),
  username: r.username,
  name: r.name,
  identity_verified: !!r.identity_verified,
  avatar_v: r.avatar_v != null ? String(r.avatar_v) : null,
  department: r.dept_name ? { name: r.dept_name, color: r.dept_color || '#5B5859' } : null,
  position: r.position_name || null,
  team: r.team_id != null && r.team_name ? { id: String(r.team_id), name: r.team_name } : null,
});

// listOffices(viewer) -> { offices: [{ id, name, position, tz, people, teams: [{id, name}], projects, open,
//                                       mine, home, followed }], followed_office_ids }
// Every active office (all 7 are listed for everyone). projects / open = visible, active projects in the
// office's active teams and their open top-level tasks (old workCounts: not archived, not done, no subtasks).
// Order (§11): my offices (home, then extra), then followed ones, then the rest, each by position.
export const listOffices = cache(async (viewer) => {
  const uid = String(viewer.id);
  const prefs = withDefaults(viewer.prefs, { isAdmin: !!viewer.is_admin });
  const [offices, teams, counts] = (await transaction([
    // people = home-office accounts (the company-public directory count).
    query(`SELECT o.id, o.name, o.position, COALESCE(o.tz, 'America/Chicago') AS tz,
             (SELECT count(*) FROM users u WHERE u.office_id = o.id AND ${REAL_USER})::int AS people
           FROM offices o WHERE NOT o.archived ORDER BY o.position ASC, o.id ASC`),
    query(`SELECT t.id, t.name, t.office_id, t.position FROM teams t JOIN offices o ON o.id = t.office_id
           WHERE NOT t.archived AND NOT o.archived ORDER BY t.position ASC, t.id ASC`),
    query(`SELECT t.office_id, count(DISTINCT p.id)::int AS projects, count(k.id)::int AS open
           FROM projects p JOIN teams t ON t.id = p.team_id JOIN offices o ON o.id = t.office_id
           LEFT JOIN tasks k ON k.project_id = p.id AND k.parent_id IS NULL AND NOT k.archived AND k.status <> 'done'
           WHERE p.id IN (SELECT tb_visible_project_ids($1::bigint))
             AND NOT p.archived AND NOT t.archived AND NOT o.archived
           GROUP BY t.office_id`, [uid]),
  ], { readOnly: true })).map((r) => r.rows);

  const mine = viewer.office_ids.map(String);
  const followed = prefs.followed_office_ids;
  const countBy = new Map(counts.map((c) => [String(c.office_id), c]));
  const list = offices.map((o) => {
    const id = String(o.id);
    const c = countBy.get(id);
    return {
      id,
      name: o.name,
      position: Number(o.position),
      tz: o.tz,
      people: Number(o.people) || 0,
      teams: teams.filter((t) => String(t.office_id) === id).sort(byPos).map((t) => ({ id: String(t.id), name: t.name })),
      projects: c ? Number(c.projects) : 0,
      open: c ? Number(c.open) : 0,
      mine: mine.includes(id),
      home: idOrNull(viewer.office_id) === id,
      followed: followed.includes(id),
    };
  });
  const rank = (o) => (o.home ? 0 : o.mine ? 1 : o.followed ? 2 : 3);
  list.sort((a, b) => (rank(a) - rank(b)) || byPos(a, b));
  return { offices: list, followed_office_ids: [...followed] };
});

// loadOffice(viewer, officeId) -> null (missing, or archived and the viewer isn't an admin) or
//   { office: { id, name, tz, archived, geo_on }, internal, teams, archived_teams, meetings, people }
//   internal: tb_can_see_office (meetings and the office thread); meetings is [] otherwise (filtered in SQL).
//   teams: active teams by position, each { id, name, position, projects: [{id, name}] by name, open,
//          project_count }; projects are the viewer's visible active ones, project_count counts every
//          visible one (archived included) for the delete confirmation.
//   archived_teams: [{ id, name, position, project_count }] (the page shows them to people who manage teams here).
//   people: home-office accounts and active extra-office grants (home: false), zz_ and disabled hidden.
export const loadOffice = cache(async (viewer, officeId) => {
  const uid = String(viewer.id);
  const oid = String(officeId);
  const [officeRows, internalRows, teams, projects, meetings, people] = (await transaction([
    query(`SELECT id, name, archived, geo_on, COALESCE(tz, 'America/Chicago') AS tz FROM offices WHERE id = $1::bigint`, [oid]),
    query(`SELECT tb_can_see_office($1::bigint, $2::bigint) AS ok`, [uid, oid]),
    query(`SELECT t.id, t.name, t.position, t.archived,
             (SELECT count(*) FROM projects p WHERE p.team_id = t.id
                AND p.id IN (SELECT tb_visible_project_ids($1::bigint)))::int AS project_count
           FROM teams t WHERE t.office_id = $2::bigint ORDER BY t.position ASC, t.id ASC`, [uid, oid]),
    query(`SELECT p.id, p.name, p.project_number, p.team_id,
             (SELECT count(*) FROM tasks k WHERE k.project_id = p.id AND k.parent_id IS NULL AND NOT k.archived
                AND k.status <> 'done')::int AS open
           FROM projects p JOIN teams t ON t.id = p.team_id
           WHERE t.office_id = $2::bigint AND NOT p.archived AND NOT t.archived
             AND p.id IN (SELECT tb_visible_project_ids($1::bigint))`, [uid, oid]),
    query(`SELECT m.id, m.office_id, m.title, m.meeting_date, m.minutes, m.position, m.updated_at, m.updated_by
           FROM meetings m
           WHERE m.office_id = $2::bigint AND tb_can_see_office($1::bigint, $2::bigint)
           ORDER BY m.meeting_date DESC NULLS LAST, m.id DESC`, [uid, oid]),
    query(`SELECT ${PERSON_COLS}, (u.office_id IS NOT DISTINCT FROM $1::bigint) AS home
           FROM users u ${PERSON_JOINS}
           WHERE ${REAL_USER}
             AND (u.office_id = $1::bigint OR EXISTS (SELECT 1 FROM user_offices x
                    WHERE x.user_id = u.id AND x.office_id = $1::bigint AND x.revoked_at IS NULL))
           ORDER BY lower(COALESCE(NULLIF(u.display_name, ''), u.username)), u.id`, [oid]),
  ], { readOnly: true })).map((r) => r.rows);

  const o = officeRows[0];
  if (!o) return null;
  if (o.archived && !viewer.is_admin) return null;
  const visible = projects.map((p) => ({ id: String(p.id), name: p.name, project_number: p.project_number || '', title: projectTitle(p),
    team_id: String(p.team_id), open: Number(p.open) || 0 }));
  const active = teams.filter((t) => !t.archived).map((t) => {
    const ps = visible.filter((p) => p.team_id === String(t.id)).sort(byName);
    return {
      id: String(t.id),
      name: t.name,
      position: Number(t.position),
      projects: ps.map((p) => ({ id: p.id, name: p.name, project_number: p.project_number, title: p.title })),
      open: ps.reduce((n, p) => n + p.open, 0),
      project_count: Number(t.project_count) || 0,
    };
  });
  return {
    office: { id: String(o.id), name: o.name, tz: o.tz, archived: !!o.archived, geo_on: !!o.geo_on },
    internal: !!internalRows[0]?.ok,
    teams: active,
    archived_teams: teams.filter((t) => t.archived)
      .map((t) => ({ id: String(t.id), name: t.name, position: Number(t.position), project_count: Number(t.project_count) || 0 })),
    meetings: meetings.map(shapeMeeting),
    people: people.map((r) => ({ ...shapePerson(r), home: !!r.home })),
  };
});

// One office meeting as pages and the API hand it out (ids as strings, rule 39).
export const shapeMeeting = (m) => ({
  id: String(m.id),
  office_id: String(m.office_id),
  title: m.title,
  meeting_date: m.meeting_date || null,
  minutes: m.minutes || '',
  position: Number(m.position),
  updated_at: iso(m.updated_at),
  updated_by: idOrNull(m.updated_by),
});
