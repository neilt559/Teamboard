import { handle, notFound, parseId } from '@/lib/http';
import { archiveEvent, loadEvent, patchEvent } from '@/lib/queries/events';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';
export const maxDuration = 60;

// GET /api/culture/events/:id -> { event }. Everyone signed in; an archived event is 404 except for organizers.
export const GET = handle(async ({ viewer, params }) => {
  const event = await loadEvent(viewer, parseId(params.id));
  if (!event) throw notFound('Event not found');
  return { event };
});

// PATCH /api/culture/events/:id { title?, details?, location?, link_url? (each with base, design §7.3), office_id?,
// all_day?, starts_on?, ends_on?, start_time?, end_time?, tz?, cancelled?, archived? } -> { ok, row }.
// Culture organizers and admins only; 409 with the current row when a text field changed since its base.
export const PATCH = handle(async ({ viewer, params, body, now }) => {
  const row = await patchEvent(viewer, params.id, await body(), now);
  return { ok: true, row };
}, { auth: 'organizer' });

// DELETE /api/culture/events/:id: archive (soft; nothing is removed; organizers restore with PATCH { archived: false }).
// A missing or already archived event answers { ok: true }. Culture organizers and admins only.
export const DELETE = handle(async ({ viewer, params }) => archiveEvent(viewer, params.id), { auth: 'organizer' });
