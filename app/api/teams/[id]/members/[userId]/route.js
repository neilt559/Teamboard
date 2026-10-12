import { handle, HttpError, parseId, bad } from '@/lib/http';
import { ROSTER_ROLES, explainRosterMiss, removeFromRoster, requireRosterEditor, setRosterRole } from '@/lib/rosters';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';
export const maxDuration = 60;

// One person on a team roster (design-amendments A4). Both need roster rights: admins, L3+, L2 in the team's
// office, or role 'pm' on the team.

// PATCH /api/teams/:id/members/:userId {role: 'member' | 'pm'}: the Member / PM toggle. Project memberships are
// untouched. -> { ok, changed } (changed 0 when they already had that role). 404 when they aren't on the roster.
export const PATCH = handle(async ({ viewer, params, body }) => {
  const b = await body();
  const team = await requireRosterEditor(viewer, parseId(params.id));
  const userId = parseId(params.userId);
  const role = String(b.role ?? '');
  if (!ROSTER_ROLES.includes(role)) throw bad('A role is Member or PM.');
  const r = await setRosterRole({ viewer, team, userId, role });
  if (!r.team_ok) await explainRosterMiss(viewer, team.id);
  if (!r.found) throw new HttpError(404, 'They aren’t on this team’s roster.');
  return { ok: true, changed: r.changed };
});

// DELETE /api/teams/:id/members/:userId: soft removal from the roster and, in the same statement (rule 3c), of
// their roster memberships ('team', 'team_legacy') on this team's projects (remove_batch = the audit row's id).
// Memberships they got another way (added by hand, a task, creating the project, legacy access, an admin grant)
// stay, and so does a roster membership on a project where they own a task (it becomes a task membership).
// Already off the roster -> { ok, removed: 0 }. -> { ok, removed, projects_removed, projects_kept }
export const DELETE = handle(async ({ viewer, params }) => {
  const team = await requireRosterEditor(viewer, parseId(params.id));
  const userId = parseId(params.userId);
  const r = await removeFromRoster({ viewer, team, userId });
  if (!r.team_ok) await explainRosterMiss(viewer, team.id);
  return { ok: true, removed: r.removed, projects_removed: r.projects_removed, projects_kept: r.projects_kept };
});
