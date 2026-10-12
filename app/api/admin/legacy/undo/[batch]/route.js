import { handle, HttpError, parseId } from '@/lib/http';
import { undoPrune } from '@/lib/queries/admin';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';
export const maxDuration = 60;

// Undo one "apply new rules" batch exactly: every membership that batch removed (and nothing since revived)
// comes back, and the kept rows it relabeled 'team_legacy' (A4 rule 3d) are 'legacy' again. Undoing twice restores
// nothing the second time. -> { ok, restored }
export const POST = handle(async ({ viewer, params }) => {
  const batch = parseId(params.batch);
  const r = await undoPrune({ adminId: viewer.id, batch });
  if (!r.found) throw new HttpError(404, 'That batch doesn’t exist.');
  return { ok: true, restored: r.restored };
}, { auth: 'admin' });
