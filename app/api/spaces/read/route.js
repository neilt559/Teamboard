import { handle } from '@/lib/http';
import { markRead } from '@/lib/queries/spaces';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';
export const maxDuration = 60;

// POST /api/spaces/read { space, section: 'announcements' | 'suggestions' | 'chat' } (design-amendments A5.5)
// The viewer has read that section of that space up to now (space_reads upsert; never moves backwards).
// -> { ok, space, section, last_read_at, unread: { announcements, suggestions, chat }, unread_total }
// A space the viewer can't read is the same 404 as a missing one.
export const POST = handle(async ({ viewer, body }) => markRead(viewer, await body()), { maxBody: 10_000 });
