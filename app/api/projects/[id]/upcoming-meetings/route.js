import { handle, HttpError } from '@/lib/http';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';
export const maxDuration = 60;

// Retired by design-amendments A9: the A6 upcoming meetings were merged into the project's Meetings
// (/api/project-meetings, with a time and a place; the old rows are archived, never deleted). Signed-in callers get
// 410, so an old open tab reloads.
const retired = () => new HttpError(410, 'Upcoming meetings are now part of Meetings. Reload the page.', { code: 'retired' });
export const GET = handle(async () => { throw retired(); });
export const POST = handle(async () => { throw retired(); });
