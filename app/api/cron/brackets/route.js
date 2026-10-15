import { handle } from '@/lib/http';
import { advanceDueBrackets } from '@/lib/bracket-auto';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';
export const maxDuration = 60;

// GET /api/cron/brackets: the daily backup resolver for weekly auto brackets (vercel.json, 06:10 UTC = 01:10 CDT /
// 00:10 CST). The brackets advance lazily on any visit anyway; this finalizes rounds and champions overnight even
// when nobody visits (design §10(c)). handle({ auth: 'cron' }) checks Authorization: Bearer ${CRON_SECRET} in
// constant time before anything else: 401 for a missing or wrong secret, and also while CRON_SECRET is unset
// (design-amendments A7). Middleware lets /api/cron/ through. Manual brackets are never touched.
//   -> { ok, activated: [ids], resolved: [{ id, round }], errors }
export const GET = handle(async ({ now }) => {
  const r = await advanceDueBrackets(now);
  return { ok: r.errors === 0, ...r };
}, { auth: 'cron' });
