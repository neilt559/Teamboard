import { handle, HttpError } from '@/lib/http';
import { projectRev } from '@/lib/queries/project';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';
export const maxDuration = 60;

// GET /api/projects/:id/rev -> { rev, archived } (design §7.5). The project board and task detail poll this
// one row every 20 s; 404 when the project was deleted or the viewer lost access (the page goes Home).
export const GET = handle(async ({ viewer, params }) => {
  const r = await projectRev(viewer, params.id);
  if (!r) throw new HttpError(404, 'Project not found');
  return r;
});
