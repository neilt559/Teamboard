import { handle } from '@/lib/http';
import { undoPick } from '@/lib/queries/bingo';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';
export const maxDuration = 60;

// DELETE /api/culture/bingo-picks/:id -> { ok, pick, board }: undo a marked square. The pick is kept and stamped
// undone (undone_at / undone_by). The office's people undo today's square only; admins any square.
export const DELETE = handle(async ({ viewer, params, now }) => {
  const r = await undoPick(viewer, params.id, now);
  return { ok: true, ...r };
});
