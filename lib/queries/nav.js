import 'server-only';
import * as React from 'react';
import { query, transaction } from '../db.js';
import { withDefaults } from '../prefs.js';
import { unreadQuery, foldUnread } from './suggestions.js';
import { projectTitle, byProjectNumber } from '../projects.js';

// Data for the app shell (design §2.2): header badges and the left sidebar / phone drawer.
// One read-only batch. Only rows the viewer may see: projects go through tb_visible_project_ids.
const cache = typeof React.cache === 'function' ? React.cache : (fn) => fn;


// loadNav(viewer) ->
//   offices:  every active office [{ id, name, position, tz, mine, followed }] by position (names are company-public;
//             mine = home or extra office, followed = in prefs.followed_office_ids)
//   tree_office_ids: home + extra offices, then followed ones (the "My offices" tree, in that order)
//   teams:    active teams in tree offices [{ id, name, office_id, position }] by position
//   projects: visible, active projects in tree-office teams, plus pinned ones wherever they are
//             [{ id, name, project_number, title, team_id, office_id, archived, open_count, pinned }] by project
//             number (lib/projects.js byProjectNumber); title = projectTitle (A6.1), what the sidebar shows;
//             open_count = top-level tasks not archived (today's sidebar count)
//   pinned:   visible pinned project ids, in pin order
//   archived_count: archived projects the viewer can see (the "Archived" link): archived themselves or in an
//             archived team or office, the same rows /projects?archived=1 lists in its Archived section
//   admin_pending: approval items waiting (admins; 0 otherwise)
//   me:       the user menu's photo and department tag (§2.2): { avatar_v, department: { name, color } | null }.
//             Read here, not in the viewer query, whose text §4.4 fixes.
//   posts_unread: design-amendments A10.4: unread posts across every Suggestions/Announcements board the viewer can
//             read (posts of either kind and their replies; never the viewer's own, never hidden ones;
//             lib/queries/suggestions.js UNREAD_SQL), for the header's Suggestions/Announcements badge.
//   unread:   the same number (app/_ui/Header.js unreadCount reads it).
export const loadNav = cache(async (viewer) => {
  const prefs = withDefaults(viewer.prefs, { isAdmin: viewer.is_admin });
  const mine = viewer.office_ids.map(String);
  const followed = prefs.followed_office_ids.filter((o) => !mine.includes(o));
  const tree = [...mine, ...followed];
  const pins = prefs.pinned_project_ids;
  const uid = String(viewer.id);
  const res = await transaction([
    query(`SELECT id, name, position, COALESCE(tz, 'America/Chicago') AS tz FROM offices
           WHERE NOT archived ORDER BY position ASC, id ASC`),
    query(`SELECT t.id, t.name, t.office_id, t.position FROM teams t JOIN offices o ON o.id = t.office_id
           WHERE NOT t.archived AND NOT o.archived AND t.office_id = ANY($1::bigint[])
           ORDER BY t.position ASC, t.id ASC`, [tree]),
    query(`SELECT p.id, p.name, p.project_number, p.team_id, t.office_id, p.archived,
                  (SELECT count(*) FROM tasks k WHERE k.project_id = p.id AND k.parent_id IS NULL AND NOT k.archived)::int
                    AS open_count
           FROM projects p JOIN teams t ON t.id = p.team_id JOIN offices o ON o.id = t.office_id
           WHERE p.id IN (SELECT tb_visible_project_ids($1::bigint))
             AND ((NOT p.archived AND NOT t.archived AND NOT o.archived AND t.office_id = ANY($2::bigint[]))
                  OR p.id = ANY($3::bigint[]))`, [uid, tree, pins]),
    query(`SELECT count(*)::int AS n FROM projects p JOIN teams t ON t.id = p.team_id JOIN offices o ON o.id = t.office_id
           WHERE (p.archived OR t.archived OR o.archived) AND p.id IN (SELECT tb_visible_project_ids($1::bigint))`, [uid]),
    query(`SELECT CASE WHEN $1::boolean THEN
             (SELECT count(*) FROM users u JOIN positions rp ON rp.id = u.position_id
              WHERE u.disabled_at IS NULL AND u.position_id IS DISTINCT FROM u.approved_position_id)
           + (SELECT count(*) FROM access_requests q JOIN users u ON u.id = q.user_id
              WHERE q.status = 'pending' AND u.disabled_at IS NULL)
           + (SELECT count(*) FROM users u
              WHERE u.disabled_at IS NULL AND u.profile_completed_at IS NOT NULL AND u.identity_verified_at IS NULL)
           ELSE 0 END::int AS n`, [!!viewer.is_admin]),
    query(`SELECT u.avatar_v, d.name AS dept_name, d.color AS dept_color
           FROM users u LEFT JOIN departments d ON d.id = u.department_id
           WHERE u.id = $1::bigint`, [uid]),
    unreadQuery(viewer),
  ], { readOnly: true });
  const [offices, teams, projects, archived, pending, meRows, unreadRows] = res.map((r) => r.rows);
  const postsUnread = foldUnread(unreadRows).total;
  const meRow = meRows[0] || {};
  const pinnedSet = new Set(pins);
  const visibleIds = new Set(projects.map((p) => String(p.id)));
  return {
    offices: offices.map((o) => ({
      ...o, mine: mine.includes(String(o.id)), followed: prefs.followed_office_ids.includes(String(o.id)),
    })),
    tree_office_ids: tree,
    teams,
    projects: projects.map((p) => ({ ...p, title: projectTitle(p), pinned: pinnedSet.has(String(p.id)) })).sort(byProjectNumber),
    pinned: pins.filter((id) => visibleIds.has(id)),
    archived_count: Number(archived[0]?.n || 0),
    admin_pending: Number(pending[0]?.n || 0),
    me: {
      avatar_v: meRow.avatar_v != null ? String(meRow.avatar_v) : null,
      department: meRow.dept_name ? { name: meRow.dept_name, color: meRow.dept_color || null } : null,
    },
    posts_unread: postsUnread,
    unread: postsUnread,
  };
});
