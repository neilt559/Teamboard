import { handle } from '@/lib/http';
import { threadsRetired } from '@/lib/queries/spaces';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';
export const maxDuration = 60;

// Retired with the thread spaces (design-amendments A10.3): announcements now live on the Suggestions/
// Announcements boards (/api/suggestions) and chat stays in the database unused. Signed-in callers get 410.
export const GET = handle(async () => { throw threadsRetired(); });
export const POST = handle(async () => { throw threadsRetired(); });
