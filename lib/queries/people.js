import 'server-only';
import * as React from 'react';
import { query, transaction } from '../db.js';
import { isAdmin } from '../policy.js';

// People: the company directory, profiles and the "Names on tasks" roster (design §2.1 /people,
// /people/[userId], /people/names; §4.5; §4.6).
// Only public profile fields leave this module: id, name (display_name || username), username, identity
// verified, photo version, office, team, department, APPROVED position, boss. Never email, is_admin, the
// requested position (except to the person and admins), password data or photo blobs.
// zz_ test accounts and disabled accounts are hidden from the directory (rule 51); their profile pages
// are 404 except to admins and to themselves.

const cache = typeof React.cache === 'function' ? React.cache : (fn) => fn;

const iso = (v) => (v == null ? null : v instanceof Date ? v.toISOString() : String(v));
const nameOf = (display, username) => display || username || '';
const byLabel = (a, b) => String(a.name).localeCompare(String(b.name), undefined, { numeric: true, sensitivity: 'base' });

// A person reference as NameLabel / Headshot want it.
function ref(prefix, r) {
  const uid = r[`${prefix}id`];
  if (uid == null) return null;
  const display = r[`${prefix}display_name`] || '';
  const username = r[`${prefix}username`] || '';
  return {
    id: String(uid),
    username,
    display_name: display,
    name: nameOf(display, username),
    identity_verified: !!r[`${prefix}verified`],
    avatar_v: r[`${prefix}avatar_v`] != null ? String(r[`${prefix}avatar_v`]) : null,
  };
}

// Hidden from the directory, pickers and lists (rule 51).
const LISTED = (a) => `${a}.disabled_at IS NULL AND ${a}.username NOT LIKE 'zz!_%' ESCAPE '!'`;

const PERSON_COLS = `
  u.id, u.username, u.display_name, (u.identity_verified_at IS NOT NULL) AS verified, u.avatar_v,
  u.office_id, o.name AS office_name, u.team_id, t.name AS team_name,
  u.department_id, d.name AS dept_name, d.color AS dept_color,
  u.approved_position_id, ap.name AS position_name, ap.sort AS position_sort,
  m.id AS boss_id, m.username AS boss_username, m.display_name AS boss_display_name,
  (m.identity_verified_at IS NOT NULL) AS boss_verified, m.avatar_v AS boss_avatar_v`;
const PERSON_JOINS = `
  LEFT JOIN offices o ON o.id = u.office_id
  LEFT JOIN teams t ON t.id = u.team_id
  LEFT JOIN departments d ON d.id = u.department_id
  LEFT JOIN positions ap ON ap.id = u.approved_position_id
  LEFT JOIN users m ON m.id = u.manager_id AND ${LISTED('m')}`;

function shapePerson(r) {
  return {
    id: String(r.id),
    username: r.username,
    display_name: r.display_name || '',
    name: nameOf(r.display_name, r.username),
    identity_verified: !!r.verified,
    avatar_v: r.avatar_v != null ? String(r.avatar_v) : null,
    office: r.office_id != null ? { id: String(r.office_id), name: r.office_name || '' } : null,
    team: r.team_id != null ? { id: String(r.team_id), name: r.team_name || '' } : null,
    department: r.department_id != null && r.dept_name
      ? { id: String(r.department_id), name: r.dept_name, color: r.dept_color || '#5B5859' } : null,
    position: r.approved_position_id != null && r.position_name
      ? { id: String(r.approved_position_id), name: r.position_name } : null,
    boss: ref('boss_', r),
  };
}

// listDirectory() -> { people, offices, departments, teams, positions } (filter options included).
// The directory is company-public (§4.5): every signed-in viewer gets the same list.
export const listDirectory = cache(async () => {
  const res = await transaction([
    query(`SELECT ${PERSON_COLS}
           FROM users u ${PERSON_JOINS}
           WHERE ${LISTED('u')}
           ORDER BY lower(COALESCE(NULLIF(u.display_name, ''), u.username)), u.id`),
    query(`SELECT id, name FROM offices WHERE NOT archived ORDER BY position ASC, id ASC`),
    query(`SELECT id, name, color FROM departments WHERE NOT archived ORDER BY sort ASC, id ASC`),
    query(`SELECT t.id, t.name, t.office_id, o.name AS office_name FROM teams t JOIN offices o ON o.id = t.office_id
           WHERE NOT t.archived AND NOT o.archived ORDER BY o.position ASC, t.position ASC, t.id ASC`),
    query(`SELECT id, name, level FROM positions WHERE NOT archived ORDER BY sort ASC, id ASC`),
  ], { readOnly: true });
  const [people, offices, departments, teams, positions] = res.map((r) => r.rows);
  return {
    people: people.map(shapePerson),
    offices: offices.map((o) => ({ id: String(o.id), name: o.name })),
    departments: departments.map((d) => ({ id: String(d.id), name: d.name, color: d.color || '#5B5859' })),
    teams: teams.map((t) => ({ id: String(t.id), name: t.name, office_id: String(t.office_id), office_name: t.office_name })),
    positions: positions.map((p) => ({ id: String(p.id), name: p.name })),
  };
});

// loadPerson(viewer, userId) -> the profile, or null (missing; or a zz_/disabled account that isn't the
// viewer, unless the viewer is an admin).
//   person:   shapePerson fields + is_organizer, created_at, requested_position (only to self and admins:
//             { id, name } while a chosen position waits for approval, else null)
//   reports:  direct reports (listed accounts only), by name
//   projects: "shared projects" = their active memberships that the VIEWER can see (§4.6), by name;
//             { id, name, archived, team: {id,name}, office: {id,name} }
//   name_on_tasks: their linked "names on tasks" row { id, name, color } or null
export const loadPerson = cache(async (viewer, userId) => {
  const uid = String(viewer.id);
  const them = String(userId);
  const admin = isAdmin(viewer);
  const self = uid === them;
  const res = await transaction([
    query(`SELECT ${PERSON_COLS}, u.is_organizer, u.created_at,
                  (u.disabled_at IS NOT NULL OR u.username LIKE 'zz!_%' ESCAPE '!') AS unlisted,
                  CASE WHEN $2::boolean AND u.position_id IS DISTINCT FROM u.approved_position_id THEN rp.id END
                    AS requested_id,
                  CASE WHEN $2::boolean AND u.position_id IS DISTINCT FROM u.approved_position_id THEN rp.name END
                    AS requested_name
           FROM users u ${PERSON_JOINS}
           LEFT JOIN positions rp ON rp.id = u.position_id
           WHERE u.id = $1::bigint`, [them, admin || self]),
    query(`SELECT r.id, r.username, r.display_name, (r.identity_verified_at IS NOT NULL) AS verified, r.avatar_v,
                  ap.name AS position_name
           FROM users r LEFT JOIN positions ap ON ap.id = r.approved_position_id
           WHERE r.manager_id = $1::bigint AND ${LISTED('r')}
           ORDER BY lower(COALESCE(NULLIF(r.display_name, ''), r.username)), r.id`, [them]),
    query(`SELECT p.id, p.name, p.archived, t.id AS team_id, t.name AS team_name, o.id AS office_id, o.name AS office_name
           FROM project_members m
           JOIN projects p ON p.id = m.project_id
           JOIN teams t ON t.id = p.team_id
           JOIN offices o ON o.id = t.office_id
           WHERE m.user_id = $1::bigint AND m.removed_at IS NULL
             AND m.project_id IN (SELECT tb_visible_project_ids($2::bigint))`, [them, uid]),
    query(`SELECT id, name, color FROM people WHERE user_id = $1::bigint AND archived_at IS NULL`, [them]),
  ], { readOnly: true });
  const [pRows, rRows, prRows, nRows] = res.map((r) => r.rows);
  const r = pRows[0];
  if (!r) return null;
  if (r.unlisted && !admin && !self) return null;
  const person = {
    ...shapePerson(r),
    is_organizer: !!r.is_organizer,
    created_at: iso(r.created_at),
    unlisted: !!r.unlisted,
    requested_position: r.requested_id != null && r.requested_name ? { id: String(r.requested_id), name: r.requested_name } : null,
  };
  const projects = prRows.map((p) => ({
    id: String(p.id), name: p.name, archived: !!p.archived,
    team: { id: String(p.team_id), name: p.team_name }, office: { id: String(p.office_id), name: p.office_name },
  })).sort((a, b) => (Number(a.archived) - Number(b.archived)) || byLabel(a, b));
  return {
    person,
    reports: rRows.map((x) => ({
      id: String(x.id), username: x.username, display_name: x.display_name || '', name: nameOf(x.display_name, x.username),
      identity_verified: !!x.verified, avatar_v: x.avatar_v != null ? String(x.avatar_v) : null,
      position: x.position_name || null,
    })),
    projects,
    name_on_tasks: nRows[0] ? { id: String(nRows[0].id), name: nRows[0].name, color: nRows[0].color } : null,
    self,
  };
});

// listNames(viewer) -> { people, groups }: the task-assignee roster (`people`), archived rows left out
// (admins restore them on /admin/people). Linked rows carry the account they belong to; they are read-only
// on /people/names (the owner edits their own in Settings, admins on /admin/people).
//   row: { id, name, color, kind, linked: { id, username, name, display_name, identity_verified, listed } | null, mine }
//   linked.listed: the account's profile opens for this viewer (not a zz_ or disabled account, or the viewer is
//   an admin or that person), so NameLabel links it only then.
export const listNames = cache(async (viewer) => {
  const uid = String(viewer.id);
  const admin = isAdmin(viewer);
  const r = await query(
    `SELECT p.id, p.name, p.color, p.kind, p.user_id,
            u.username AS linked_username, u.display_name AS linked_display_name,
            (u.identity_verified_at IS NOT NULL) AS linked_verified, (${LISTED('u')}) AS linked_listed
     FROM people p LEFT JOIN users u ON u.id = p.user_id
     WHERE p.archived_at IS NULL
     ORDER BY lower(p.name), p.id`);
  const rows = r.rows.map((x) => ({
    id: String(x.id),
    name: x.name,
    color: x.color || '#5B5859',
    kind: x.kind === 'group' ? 'group' : 'person',
    linked: x.user_id != null ? {
      id: String(x.user_id), username: x.linked_username || '', display_name: x.linked_display_name || '',
      name: nameOf(x.linked_display_name, x.linked_username), identity_verified: !!x.linked_verified,
      listed: admin || String(x.user_id) === uid || !!x.linked_listed,
    } : null,
    mine: x.user_id != null && String(x.user_id) === uid,
  }));
  return {
    people: rows.filter((x) => x.kind === 'person'),
    groups: rows.filter((x) => x.kind === 'group'),
  };
});

