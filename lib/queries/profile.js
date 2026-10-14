import 'server-only';
import * as React from 'react';
import { query, transaction, RELEASED_AT } from '../db.js';
import { getViewer, tagUpdating } from '../viewer.js';
import { withDefaults } from '../prefs.js';
import { projectTitle } from '../projects.js';

// Loaders for the account pages (design §2.1, §5): /welcome (the one-time wizard), /settings, and /login's
// "already signed in?" check. One read-only batch each. Nothing here reads project-scoped tables except the
// pinned-project names in Settings, which go through tb_visible_project_ids.
const cache = typeof React.cache === 'function' ? React.cache : (fn) => fn;

const idStr = (v) => (v == null ? null : String(v));
const nameSql = (a) => `COALESCE(NULLIF(${a}.display_name, ''), ${a}.username)`;

// zz_ test accounts are hidden from pickers (rule 51), except from other zz_ accounts (the local test harness).
export const isTestAccount = (v) => /^zz_/.test(String(v?.username || ''));

// /login only: the signed-in viewer, or null (no redirect, and a database hiccup just shows the form).
export async function viewerForLogin() {
  try { return await getViewer(); } catch { return null; }
}

// The statements both pages share. $1 = me, $2 = show zz_ accounts, $3 = ids of my current office, team,
// department and positions (always listed, even when archived, so a form never shows a blank choice).
function profileStatements(v) {
  const uid = String(v.id);
  const zz = isTestAccount(v);
  const cur = [v.office_id, v.team_id, v.department_id, v.position_id, v.approved_position_id].filter((x) => x != null).map(String);
  return [
    // 0 me
    query(`SELECT u.id, u.username, u.display_name, u.email, u.office_id, u.team_id, u.department_id, u.position_id,
                  u.approved_position_id, u.position_requested_at, u.position_decided_at, u.manager_id,
                  u.avatar_v, u.avatar_crop, (u.avatar_src IS NOT NULL) AS has_src, u.avatar_set_at,
                  (u.identity_verified_at IS NOT NULL) AS identity_verified, u.profile_completed_at, u.created_at,
                  m.id AS m_id, m.username AS m_username, m.display_name AS m_display_name, m.avatar_v AS m_avatar_v,
                  (m.identity_verified_at IS NOT NULL) AS m_verified, (m.disabled_at IS NOT NULL) AS m_disabled
           FROM users u LEFT JOIN users m ON m.id = u.manager_id
           WHERE u.id = $1::bigint`, [uid]),
    // 1 offices (active, plus my own)
    query(`SELECT id, name, COALESCE(tz, 'America/Chicago') AS tz, position, archived FROM offices
           WHERE NOT archived OR id = ANY($1::bigint[]) ORDER BY position ASC, id ASC`, [cur]),
    // 2 teams (active, in active offices, plus my own)
    query(`SELECT t.id, t.name, t.office_id, (t.archived OR o.archived) AS archived FROM teams t JOIN offices o ON o.id = t.office_id
           WHERE (NOT t.archived AND NOT o.archived) OR t.id = ANY($1::bigint[]) ORDER BY t.position ASC, t.id ASC`, [cur]),
    // 3 departments
    query(`SELECT id, name, color, archived FROM departments
           WHERE NOT archived OR id = ANY($1::bigint[]) ORDER BY sort ASC, lower(name) ASC`, [cur]),
    // 4 positions
    query(`SELECT id, name, level::int AS level, archived FROM positions
           WHERE NOT archived OR id = ANY($1::bigint[]) ORDER BY level ASC, sort ASC, lower(name) ASC`, [cur]),
    // 5 boss candidates: active people, never me (display_name || username, so not-yet-onboarded people show too)
    query(`SELECT u.id, u.username, u.display_name, ${nameSql('u')} AS name, (u.identity_verified_at IS NOT NULL) AS identity_verified,
                  u.avatar_v, o.name AS office, d.name AS dept_name, d.color AS dept_color, ap.name AS position, t.name AS team
           FROM users u LEFT JOIN offices o ON o.id = u.office_id LEFT JOIN departments d ON d.id = u.department_id
           LEFT JOIN positions ap ON ap.id = u.approved_position_id LEFT JOIN teams t ON t.id = u.team_id
           WHERE u.disabled_at IS NULL AND u.id <> $1::bigint
             AND ($2::boolean OR u.username NOT LIKE 'zz!_%' ESCAPE '!')
           ORDER BY lower(${nameSql('u')}) ASC, u.id ASC`, [uid, zz]),
    // 6 names on tasks that could be me: unlinked, active, a person (not a group)
    query(`SELECT p.id, p.name, p.color,
                  EXISTS (SELECT 1 FROM access_requests q WHERE q.person_id = p.id AND q.kind = 'person_link'
                            AND q.status = 'pending' AND q.user_id <> $1::bigint) AS requested,
                  EXISTS (SELECT 1 FROM access_requests q WHERE q.person_id = p.id AND q.kind = 'person_link'
                            AND q.status = 'pending' AND q.user_id = $1::bigint) AS mine
           FROM people p
           WHERE p.kind = 'person' AND p.archived_at IS NULL AND p.user_id IS NULL
           ORDER BY lower(p.name) ASC, p.id ASC`, [uid]),
    // 7 my name on tasks (linked row)
    query(`SELECT id, name, color, archived_at FROM people WHERE user_id = $1::bigint ORDER BY id ASC LIMIT 1`, [uid]),
    // 8 my requests: pending ones, plus decisions from the last 14 days (so a decline doesn't vanish silently)
    query(`SELECT q.id, q.kind, q.status, q.office_id, o.name AS office_name, q.team_id, t.name AS team_name,
                  q.person_id, p.name AS person_name, q.created_at, q.decided_at, q.decision_note
           FROM access_requests q LEFT JOIN offices o ON o.id = q.office_id LEFT JOIN teams t ON t.id = q.team_id
           LEFT JOIN people p ON p.id = q.person_id
           WHERE q.user_id = $1::bigint
             AND (q.status = 'pending' OR (q.status IN ('approved', 'declined') AND q.decided_at > now() - interval '14 days'))
           ORDER BY q.created_at DESC`, [uid]),
    // 9 the team rosters I'm on (A4): Settings and the wizard show them next to the home-team pick, which is a
    // different thing (the roster, not the pick, adds me to a team's projects).
    query(`SELECT t.id, t.name, x.role, (t.archived OR o.archived) AS archived
           FROM team_members x JOIN teams t ON t.id = x.team_id JOIN offices o ON o.id = t.office_id
           WHERE x.user_id = $1::bigint AND x.removed_at IS NULL
           ORDER BY (x.role = 'pm') DESC, t.position ASC, t.id ASC`, [uid]),
  ];
}

function shapeProfile(v, rows) {
  const [meRows, offices, teams, departments, positions, bosses, people, linked, requests, rosters = []] = rows;
  const me = meRows[0] || {};
  const releasedAt = Number(RELEASED_AT) || null;
  const createdAt = me.created_at ? Date.parse(me.created_at) : null;
  const pending = requests.filter((r) => r.status === 'pending');
  const pendingOf = (kind) => pending.find((r) => r.kind === kind) || null;
  const req = (r) => r && ({
    id: String(r.id), kind: r.kind, status: r.status, office_id: idStr(r.office_id), office_name: r.office_name || null,
    team_id: idStr(r.team_id), team_name: r.team_name || null, person_id: idStr(r.person_id), person_name: r.person_name || null,
    created_at: r.created_at, decided_at: r.decided_at || null, decision_note: r.decision_note || '',
  });
  return {
    me: {
      id: String(v.id),
      username: me.username || v.username,
      display_name: me.display_name || '',
      email: me.email || '',
      office_id: idStr(me.office_id),
      team_id: idStr(me.team_id),
      department_id: idStr(me.department_id),
      position_id: idStr(me.position_id),
      approved_position_id: idStr(me.approved_position_id),
      position_pending: idStr(me.position_id) !== idStr(me.approved_position_id),
      position_requested_at: me.position_requested_at || null,
      manager: me.m_id != null ? {
        id: String(me.m_id), username: me.m_username, display_name: me.m_display_name || '',
        name: me.m_display_name || me.m_username, identity_verified: !!me.m_verified, avatar_v: idStr(me.m_avatar_v),
        disabled: !!me.m_disabled,
      } : null,
      avatar_v: idStr(me.avatar_v),
      avatar_crop: me.avatar_crop || null,
      has_src: !!me.has_src,
      identity_verified: !!me.identity_verified,
      profile_done: !!me.profile_completed_at,
      is_admin: !!v.is_admin,
      level: v.level,
      // An account that existed before Release 1 (it gets the "TeamBoard now covers all seven offices" intro).
      legacy: !!(releasedAt && createdAt && createdAt < releasedAt),
    },
    offices: offices.map((o) => ({ id: String(o.id), name: o.name, tz: o.tz, archived: !!o.archived })),
    teams: teams.map((t) => ({ id: String(t.id), name: t.name, office_id: idStr(t.office_id), archived: !!t.archived })),
    rosters: rosters.map((t) => ({ id: String(t.id), name: t.name, role: t.role === 'pm' ? 'pm' : 'member', archived: !!t.archived })),
    departments: departments.map((d) => ({ id: String(d.id), name: d.name, color: d.color, archived: !!d.archived })),
    positions: positions.map((p) => ({ id: String(p.id), name: p.name, level: Number(p.level) || 1, archived: !!p.archived })),
    bosses: bosses.map((u) => ({
      id: String(u.id), username: u.username, display_name: u.display_name || '', name: u.name,
      identity_verified: !!u.identity_verified, avatar_v: idStr(u.avatar_v), office: u.office || null,
      department: u.dept_name ? { name: u.dept_name, color: u.dept_color } : null, position: u.position || null,
      team: u.team || null,
    })),
    people: people.map((p) => ({ id: String(p.id), name: p.name, color: p.color, requested: !!p.requested, mine: !!p.mine })),
    linked: linked[0] ? { id: String(linked[0].id), name: linked[0].name, color: linked[0].color, archived: !!linked[0].archived_at } : null,
    requests: {
      office_change: req(pendingOf('office_change')),
      person_link: req(pendingOf('person_link')),
      recent: requests.filter((r) => r.status !== 'pending').map(req),
    },
  };
}

// /welcome and GET /api/profile/options.
export const loadProfileOptions = cache(async (viewer) => {
  try {
    const res = await transaction(profileStatements(viewer), { readOnly: true });
    return shapeProfile(viewer, res.map((r) => r.rows));
  } catch (e) {
    throw tagUpdating(e);
  }
});

// /settings: the same, plus signed-in devices and the names of pinned projects (visible ones only).
// sessions is read first in the batch (lock order, design §3.1 and amendment A3).
export const loadSettings = cache(async (viewer) => {
  const uid = String(viewer.id);
  const prefs = withDefaults(viewer.prefs, { isAdmin: viewer.is_admin });
  try {
    const res = await transaction([
      query(`SELECT count(*)::int AS n FROM sessions WHERE user_id = $1::bigint AND expires_at > now()`, [uid]),
      ...profileStatements(viewer),
      query(`SELECT p.id, p.name, p.project_number, p.archived FROM projects p
             WHERE p.id = ANY($1::bigint[]) AND p.id IN (SELECT tb_visible_project_ids($2::bigint))`,
      [prefs.pinned_project_ids, uid]),
    ], { readOnly: true });
    const rows = res.map((r) => r.rows);
    const devices = Number(rows[0][0]?.n || 0);
    const pinRows = rows[rows.length - 1];
    const byId = new Map(pinRows.map((p) => [String(p.id), p]));
    return {
      ...shapeProfile(viewer, rows.slice(1, -1)),
      devices,
      prefs,
      pinned: prefs.pinned_project_ids.filter((id) => byId.has(id))
        .map((id) => ({ id, name: byId.get(id).name, project_number: byId.get(id).project_number || '', title: projectTitle(byId.get(id)),
          archived: !!byId.get(id).archived })),
    };
  } catch (e) {
    throw tagUpdating(e);
  }
});
