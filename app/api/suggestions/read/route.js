import { handle, notFound } from '@/lib/http';
import { markBoardRead } from '@/lib/queries/suggestions';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';
export const maxDuration = 60;

// POST /api/suggestions/read { space: 'company' | 'office:<id>' } (design-amendments A10.4): the viewer has seen
// that Suggestions/Announcements board up to now (space_reads upsert; never moves backwards). The board page calls
// it from an effect after it renders. -> { ok, space, last_read_at, unread_total }. A board the viewer can't read
// (and any team key) is the same 404 as a missing one.
export const POST = handle(async ({ viewer, body }) => {
  const r = await markBoardRead(viewer, (await body()).space);
  if (!r) throw notFound('Board not found');
  return r;
}, { maxBody: 10_000 });
