import { handle, parseId, forbidden } from '@/lib/http';
import { deleteWithSnapshot } from '@/lib/audit';
import { officeStatsScope } from '@/lib/office-stats';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';
export const maxDuration = 60;

// Delete one GeoGuessr score (design §8.2, §10(d), §13 #12). A hard delete (the client keeps its "Only do this to
// fix a mistake" confirm), but the removed row is kept as a JSON snapshot in audit_log, written in the same
// statement. Admins any office's score, everyone else their own offices' only (Neil, 2026-10-19): the scope is
// part of the DELETE, so a score from another office is left alone and answers 403. A score that is already gone
// answers { ok: true }, as before.
export const DELETE = handle(async ({ viewer, params }) => {
  const id = parseId(params.id);
  const r = await deleteWithSnapshot({ table: 'geo_scores', id, actorId: viewer.id, action: 'geo_score.delete', ...officeStatsScope(viewer) });
  if (!r.deleted && r.existed) throw forbidden('Only that office’s people (and admins) can delete its GeoGuessr scores.');
  return { ok: true };
}, { legacyWrite: true });
