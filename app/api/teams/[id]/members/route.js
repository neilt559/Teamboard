import { handle, HttpError, parseId, bad } from '@/lib/http';
import { loadRoster } from '@/lib/queries/teams';
import { ROSTER_ROLES, addToRoster, explainRosterMiss, requireRosterEditor, teamPageVisible } from '@/lib/rosters';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';
export const maxDuration = 60;

// Team rosters (design-amendments A4). The roster drives project membership: people on it join every current
// project of the team, and every project later created in or moved into it (source 'team').

// GET /api/teams/:id/members: everyone who can see the team page sees its roster.
// -> { team, my_role, can_edit, members: [{ id, name, username, avatar_v, department, office, role, ... }],
//      picked: [people who chose this team in their profile but aren't on the roster] (roster editors only) }
export const GET = handle(async ({ viewer, params }) => {
  const r = await loadRoster(viewer, parseId(params.id));
  if (!r || !teamPageVisible(viewer, r.team)) throw new HttpError(404, 'Team not found');
  return r;
});

// POST /api/teams/:id/members {user_ids: [...] | user_id, role?: 'member' | 'pm'}: add people to the roster (or
// back onto it) and, in the same statement, to every non-archived project of the team (rule 3a; an active
// membership keeps its source). Roster editors only: admins, L3+, L2 in the team's office, the team's PMs.
// All or nothing: a missing or disabled account adds nobody (404). People already on it stay as they are.
// -> { ok, added: [user ids], already: [user ids], projects_added }
export const POST = handle(async ({ viewer, params, body }) => {
  const b = await body();
  const team = await requireRosterEditor(viewer, parseId(params.id));
  const raw = Array.isArray(b.user_ids) ? b.user_ids : b.user_id != null && b.user_id !== '' ? [b.user_id] : [];
  const ids = [...new Set(raw.map((x) => parseId(x)))];
  if (!ids.length) throw bad('Pick at least one person.');
  if (ids.length > 50) throw bad('Add at most 50 people at a time.');
  const role = b.role == null || b.role === '' ? 'member' : String(b.role);
  if (!ROSTER_ROLES.includes(role)) throw bad('A role is Member or PM.');
  const r = await addToRoster({ viewer, team, userIds: ids, role });
  if (!r.team_ok) await explainRosterMiss(viewer, team.id);
  if (r.users_ok < ids.length) throw new HttpError(404, ids.length === 1 ? 'That person isn’t available.' : 'One of those people isn’t available.');
  return { ok: true, added: r.added, already: r.already, projects_added: r.projects_added };
});
