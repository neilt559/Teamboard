import { handle } from '@/lib/http';
import { createTask } from '@/lib/queries/project';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';
export const maxDuration = 60;

// POST /api/tasks {project_id, parent_id?, title?, assignee_id?} (design §8.2). Anyone who can see the project.
// parent_id must be a top-level task in the same project. Assigning a name linked to an account makes that
// account a member (§6). Response: today's task row (old tabs read its id) plus added_members.
export const POST = handle(async ({ viewer, body }) => {
  const { row, added_members } = await createTask(viewer, await body());
  return { ...row, added_members };
}, { legacyWrite: true });
