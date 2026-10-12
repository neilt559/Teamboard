import { handle } from '@/lib/http';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';
export const maxDuration = 60;

// GET /api/cron/brackets: the daily backup resolver for auto brackets (vercel.json, 06:10 UTC). Release 1 has
// manual brackets only, so it answers { skipped: true }; Release 3 (K3) runs advanceDueBrackets(now) here.
// handle({ auth: 'cron' }) checks Authorization: Bearer ${CRON_SECRET} in constant time before anything
// else: 503 while CRON_SECRET is unset, 401 for a missing or wrong secret. Middleware lets /api/cron/ through.
export const GET = handle(async () => ({ skipped: true }), { auth: 'cron' });
