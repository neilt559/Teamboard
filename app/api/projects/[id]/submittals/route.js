import { handle, HttpError } from '@/lib/http';
import { listSubmittals, createSubmittal } from '@/lib/queries/project-items';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';
export const maxDuration = 60;

// GET /api/projects/:id/submittals -> { submittals: [...] } (design-amendments A6.2, A6.5): every submittal of the
// project, archived ones included (archived: true), each with expected_response. Anyone who can see the project;
// otherwise the same 404 as a missing project.
export const GET = handle(async ({ viewer, params }) => {
  const submittals = await listSubmittals(viewer, params.id);
  if (!submittals) throw new HttpError(404, 'Project not found');
  return { submittals };
});

// POST /api/projects/:id/submittals {agency, title, status?, target_date?, received_date?, reply_by_date?,
// submitted_date?, approved_date?, review_days?, note?} -> { ok, row }. Anyone who can see the project (A6.3);
// bumps projects.rev. Dates 'YYYY-MM-DD' (or null), review_days 1-365, status one of not_submitted,
// comments_received, under_review, approved (default not_submitted).
export const POST = handle(async ({ viewer, params, body }) => {
  const row = await createSubmittal(viewer, params.id, await body());
  return { ok: true, row };
});
