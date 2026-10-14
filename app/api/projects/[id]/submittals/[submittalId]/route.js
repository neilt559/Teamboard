import { handle } from '@/lib/http';
import { patchSubmittal } from '@/lib/queries/project-items';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';
export const maxDuration = 60;

// PATCH /api/projects/:id/submittals/:submittalId (design-amendments A6.2, A6.3, A6.5) -> { ok, row }:
//   agency, title, note (+base: 409 with the current row when someone else changed it first);
//   status, target_date, received_date, reply_by_date, submitted_date, approved_date, review_days (last write
//   wins; changing the status keeps the other dates); archived (true = archive, false = restore; there is no
//   delete); position.
// Anyone who can see the project; bumps projects.rev. A submittal that isn't in this project, or a project the
// caller can't see: 404 'gone', the same as a missing one.
export const PATCH = handle(async ({ viewer, params, body, now }) => {
  const row = await patchSubmittal({ viewer, projectId: params.id, id: params.submittalId, body: await body(), now });
  return { ok: true, row };
});
