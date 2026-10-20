import { handle } from '@/lib/http';
import { rateChili } from '@/lib/queries/chili';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';
export const maxDuration = 60;

// POST /api/culture/chilis/:id/rating { score } -> { ok, chili: { id, mine, count } }: rate a chili 1 to 10 (or change
// your rating) in a chili cook-off (lib/chili.js). Secret: the answer carries only your own score and the count.
// The challenge's people, from the chili's week until the reveal; never your own chili.
export const POST = handle(async ({ viewer, params, body, now }) => {
  const chili = await rateChili(viewer, params.id, await body(), now);
  return { ok: true, chili };
});
