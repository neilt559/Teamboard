import { handle } from '@/lib/http';
import { patchEntry, deleteEntry } from '@/lib/queries/challenges';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';
export const maxDuration = 60;

// PATCH /api/culture/entries/:id { entry_date?, value?, note? (+ base.note) } -> { ok, row }, or { deleted: false }
// to restore a deleted entry (Undo). The owner until the challenge's end date + 3 days, organizers any time.
// Someone else's entry (for a non-organizer) answers like a missing one: 404 'gone'.
export const PATCH = handle(async ({ viewer, params, body, now }) => {
  const row = await patchEntry(viewer, params.id, await body(), now);
  return { ok: true, row };
});

// DELETE /api/culture/entries/:id: soft delete (deleted_at; nothing is removed). Same rights as PATCH; a missing,
// already deleted or someone else's entry answers { ok: true } and changes nothing.
export const DELETE = handle(async ({ viewer, params, now }) => deleteEntry(viewer, params.id, now));
