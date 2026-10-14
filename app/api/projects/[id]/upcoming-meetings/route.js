import { handle, HttpError } from '@/lib/http';
import { listUpcoming, createUpcoming } from '@/lib/queries/project-items';
import { chicagoToday } from '@/lib/time';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';
export const maxDuration = 60;

// GET /api/projects/:id/upcoming-meetings -> { meetings: [...], today } (design-amendments A6.2, A6.5): every
// upcoming-meeting row of the project by date and time, archived and past ones included (flags archived, past =
// before today, Central). Anyone who can see the project; otherwise the same 404 as a missing project.
export const GET = handle(async ({ viewer, params, now }) => {
  const today = chicagoToday(now);
  const meetings = await listUpcoming(viewer, params.id, today);
  if (!meetings) throw new HttpError(404, 'Project not found');
  return { meetings, today };
});

// POST /api/projects/:id/upcoming-meetings {meeting_date, meeting_time?, title, location?} -> { ok, row }.
// meeting_date 'YYYY-MM-DD' and title (what / with whom) required; meeting_time 'HH:MM' (24 h) or empty.
// Anyone who can see the project (A6.3); bumps projects.rev.
export const POST = handle(async ({ viewer, params, body, now }) => {
  const row = await createUpcoming(viewer, params.id, await body(), chicagoToday(now));
  return { ok: true, row };
});
