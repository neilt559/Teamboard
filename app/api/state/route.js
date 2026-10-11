import { handle, HttpError } from '@/lib/http';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';
export const maxDuration = 60;

// The old single page polled this for the whole database every 4 s. Pages now load their own filtered data,
// so tabs left open across the deploy get this message in their banner (design §8.2).
export const GET = handle(async () => {
  throw new HttpError(410, 'TeamBoard was updated — please reload this page.');
}, { auth: 'public' });
