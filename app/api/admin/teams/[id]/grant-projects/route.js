import { handle, HttpError, parseId } from '@/lib/http';
import { grantTeamProjects } from '@/lib/queries/admin';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';
export const maxDuration = 60;

// "Give this team's members all of its projects" (§6 tool 3): every active member of the team gets an
// 'admin' membership on each of the team's projects (archived ones too); removed rows are revived.
// -> { ok, added, people }
export const POST = handle(async ({ viewer, params }) => {
  const teamId = parseId(params.id);
  const r = await grantTeamProjects({ adminId: viewer.id, teamId });
  if (!r.found) throw new HttpError(404, 'Team not found');
  return { ok: true, added: r.added, people: r.people };
}, { auth: 'admin' });
