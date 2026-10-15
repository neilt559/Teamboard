import { handle, HttpError } from '@/lib/http';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';
export const maxDuration = 60;

// Retired by design-amendments A9: the A6 upcoming meetings were merged into the project's Meetings
// (/api/project-meetings/:id). Signed-in callers get 410, so an old open tab reloads.
export const PATCH = handle(async () => {
  throw new HttpError(410, 'Upcoming meetings are now part of Meetings. Reload the page.', { code: 'retired' });
});
