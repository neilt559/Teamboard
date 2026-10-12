import 'server-only';
import { query } from './db.js';
import { HttpError } from './http.js';
import { LEGACY_SOURCES_SQL } from './rosters.js';

// Server-side access lookups (design §4.4). Re-exports the pure rules so routes import from one place;
// client components import lib/policy.js directly, never this file.
export * from './policy.js';

// The project facts the policy rules need, for viewer v. null when the project doesn't exist.
// visible = tb_can_see_project; is_member / legacy_member = an active membership (of source 'legacy', or
// 'team_legacy': a legacy row the prune kept for the roster, A4 rule 3d; lib/rosters.js LEGACY_SOURCES_SQL).
export async function projectAccess(v, projectId) {
  const r = await query(
    `SELECT p.id, p.name, p.archived, p.created_by, p.team_id, p.rev, t.office_id,
            tb_can_see_project($1::bigint, p.id) AS visible,
            EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = p.id AND m.user_id = $1::bigint
                      AND m.removed_at IS NULL) AS is_member,
            EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = p.id AND m.user_id = $1::bigint
                      AND m.removed_at IS NULL AND m.source IN ${LEGACY_SOURCES_SQL}) AS legacy_member
     FROM projects p LEFT JOIN teams t ON t.id = p.team_id
     WHERE p.id = $2::bigint`,
    [String(v.id), String(projectId)]);
  return r.rows[0] || null;
}

// The same row, or 404 'Project not found' when it is missing OR not visible (no existence leak).
export async function requireVisibleProject(v, projectId) {
  const p = await projectAccess(v, projectId);
  if (!p || !p.visible) throw new HttpError(404, 'Project not found');
  return p;
}
