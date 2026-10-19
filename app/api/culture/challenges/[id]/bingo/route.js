import { handle } from '@/lib/http';
import { markSquare } from '@/lib/queries/bingo';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';
export const maxDuration = 60;

// POST /api/culture/challenges/:id/bingo { office_id, square } -> { ok, pick, board }: mark today's (Central) square
// on an office's bingo card (lib/bingo.js). One square per office per day, each square once; the office's own
// people, or an admin for any playing office; only while the challenge runs. 409 with a plain
// message when today's square is already marked.
export const POST = handle(async ({ viewer, params, body, now }) => {
  const r = await markSquare(viewer, params.id, await body(), now);
  return { ok: true, ...r };
});
