import { handle, HttpError } from '@/lib/http';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';
export const maxDuration = 60;

// Retired with the culture events calendar (Neil, 2026-10-15). The events stay in culture_events (nothing is
// deleted); signed-in callers get 410 so an old open tab reloads, signed-out ones 401.
const retired = () => new HttpError(410, 'The culture calendar was removed. Reload the page.', { code: 'retired' });
export const GET = handle(async () => { throw retired(); });
export const POST = handle(async () => { throw retired(); });
