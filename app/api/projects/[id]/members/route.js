import { handle, HttpError } from '@/lib/http';
import { requireVisibleProject } from '@/lib/access';
import { listMembers, addMembers } from '@/lib/queries/project';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';
export const maxDuration = 60;

// GET /api/projects/:id/members: active members with name, department, office, source, who added them and
// how many open tasks they own here (design §6, §8.2). Anyone who can see the project.
export const GET = handle(async ({ viewer, params }) => {
  const members = await listMembers(viewer, params.id);
  if (!members) throw new HttpError(404, 'Project not found');
  return { members };
});

// POST /api/projects/:id/members {user_ids:[...]}: anyone who can see the project adds anyone ("every position
// can add others to projects they're on"). Revives soft-removed rows. -> { ok, added: [user ids] }.
export const POST = handle(async ({ viewer, params, body }) => {
  const b = await body();
  await requireVisibleProject(viewer, params.id);
  const added = await addMembers(viewer, params.id, b.user_ids);
  return { ok: true, added };
});
