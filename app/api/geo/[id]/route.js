import { handle, parseId } from '@/lib/http';
import { deleteWithSnapshot } from '@/lib/audit';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';
export const maxDuration = 60;

// Delete one GeoGuessr score (design §8.2, §10(d), §13 #12). Still a hard delete open to everyone signed in
// (the client keeps its "Only do this to fix a mistake" confirm), but the removed row is now kept as a JSON
// snapshot in audit_log, written in the same statement. A score that is already gone answers { ok: true },
// as before.
export const DELETE = handle(async ({ viewer, params }) => {
  const id = parseId(params.id);
  await deleteWithSnapshot({ table: 'geo_scores', id, actorId: viewer.id, action: 'geo_score.delete' });
  return { ok: true };
}, { legacyWrite: true });
