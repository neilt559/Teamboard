import { handle } from '@/lib/http';
import { threadsRetired } from '@/lib/queries/spaces';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';
export const maxDuration = 60;

// Retired with the thread spaces (design-amendments A10.3): thread posts can no longer be edited, moderated or
// deleted (nothing is removed from the database). Signed-in callers get 410.
export const PATCH = handle(async () => { throw threadsRetired(); });
export const DELETE = handle(async () => { throw threadsRetired(); });
