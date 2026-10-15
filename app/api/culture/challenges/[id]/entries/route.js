import { handle } from '@/lib/http';
import { listEntries, createEntry } from '@/lib/queries/challenges';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';
export const maxDuration = 60;

// GET /api/culture/challenges/:id/entries[?all=1] -> { entries }: my entries; with all=1 every entry (organizers).
export const GET = handle(async ({ req, viewer, params }) => {
  const all = new URL(req.url).searchParams.get('all') === '1';
  return listEntries(viewer, params.id, { all });
});

// POST /api/culture/challenges/:id/entries { entry_date, value, note? } -> { ok, entry }: "Log my stats".
// Participants only (everyone for a company challenge, that office's people for an office one); the date inside the
// challenge and no later than tomorrow (Central); until ends_on + 3 days; 20 entries per person per day. The entry
// snapshots the person's office and department.
export const POST = handle(async ({ viewer, params, body, now }) => {
  const entry = await createEntry(viewer, params.id, await body(), now);
  return { ok: true, entry };
});
