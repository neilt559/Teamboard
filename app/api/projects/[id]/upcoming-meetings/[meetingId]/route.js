import { handle } from '@/lib/http';
import { patchUpcoming } from '@/lib/queries/project-items';
import { chicagoToday } from '@/lib/time';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';
export const maxDuration = 60;

// PATCH /api/projects/:id/upcoming-meetings/:meetingId (design-amendments A6.2, A6.3, A6.5) -> { ok, row }:
//   title (+base, non-empty), location (+base): 409 with the current row when someone else changed it first;
//   meeting_date ('YYYY-MM-DD', required), meeting_time ('HH:MM' or empty): last write wins;
//   archived (true = archive, false = restore; there is no delete; past meetings simply stay).
// Anyone who can see the project; bumps projects.rev. A meeting that isn't in this project, or a project the
// caller can't see: 404 'gone', the same as a missing one.
export const PATCH = handle(async ({ viewer, params, body, now }) => {
  const row = await patchUpcoming({
    viewer, projectId: params.id, id: params.meetingId, body: await body(), now, today: chicagoToday(now),
  });
  return { ok: true, row };
});
