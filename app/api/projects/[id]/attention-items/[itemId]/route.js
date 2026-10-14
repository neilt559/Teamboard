import { handle } from '@/lib/http';
import { patchAttention } from '@/lib/queries/project-items';
import { chicagoToday } from '@/lib/time';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';
export const maxDuration = 60;

// PATCH /api/projects/:id/attention-items/:itemId (design-amendments A8.2, A8.3) -> { ok, row }:
//   item, from_party, note (+base: 409 with the current row when someone else changed it first; item can't be
//   emptied); need_by (a date or null); status 'received' (stamps received_date with today, Central, unless the body
//   sets one or the item already has one) or 'open' (re-open; the received date stays as history); received_date
//   (edit the stamp); archived (true = archive, false = restore; there is no delete); position.
// Anyone who can see the project; bumps projects.rev. An item that isn't in this project, or a project the caller
// can't see: 404 'gone', the same as a missing one.
export const PATCH = handle(async ({ viewer, params, body, now }) => {
  const row = await patchAttention({ viewer, projectId: params.id, id: params.itemId, body: await body(), now, today: chicagoToday(now) });
  return { ok: true, row };
});
