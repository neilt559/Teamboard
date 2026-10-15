import { handle } from '@/lib/http';
import { calendarJson, createEvent } from '@/lib/queries/events';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';
export const maxDuration = 60;

// Culture events calendar (design §10(b), §8.2; agent K2).
// GET /api/culture/events[?m=YYYY-MM][&office=mine|company|all|<office id>] -> the month: { month, grid, filter,
//   offices, events, challenges, brackets, ... }. Every signed-in user reads every event (company-public); the office
//   filter only changes what is shown (default: company + my offices + followed).
export const GET = handle(async ({ req, viewer, now }) => calendarJson(viewer, new URL(req.url).searchParams, now));

// POST /api/culture/events { title, details?, location?, link_url?, office_id?, all_day?, starts_on, ends_on?,
// start_time?, end_time?, tz? } -> { ok, event, id }. Culture organizers and admins only.
export const POST = handle(async ({ viewer, body }) => {
  const event = await createEvent(viewer, await body());
  return { ok: true, event, id: event.id };
}, { auth: 'organizer' });
