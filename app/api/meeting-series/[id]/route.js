import { handle, parseId } from '@/lib/http';
import { guardedPatch, norm } from '@/lib/patch';
import { deleteWithSnapshot } from '@/lib/audit';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';
export const maxDuration = 60;

const SCOPE = 'tb_can_see_project($1::bigint, project_id)';
const COLUMNS = { name: { type: 'text', text: true, norm: norm.lineOr(300, 'Series') } };

// PATCH /api/meeting-series/:id {name, base}: rename (blank -> 'Series'). -> { ok, row }.
export const PATCH = handle(async ({ viewer, params, body, now }) => {
  const { row } = await guardedPatch({
    table: 'meeting_series', id: parseId(params.id), body: await body(), columns: COLUMNS, actorId: viewer.id,
    scopeSql: SCOPE, scopeParams: [String(viewer.id)], bumpProjectRev: true, now,
  });
  return { ok: true, row };
}, { legacyWrite: true });

// DELETE /api/meeting-series/:id: the series and its meetings (DB cascade), with a JSON snapshot of both.
// Missing or not visible: { ok } either way (no existence leak, design §4.6 / §7.1).
export const DELETE = handle(async ({ viewer, params }) => {
  await deleteWithSnapshot({
    table: 'meeting_series', id: parseId(params.id), actorId: viewer.id, action: 'meeting_series.delete',
    scopeSql: SCOPE, scopeParams: [String(viewer.id)], bumpProjectRev: true,
    children: { meetings: { table: 'project_meetings', fk: 'series_id' } },
  });
  return { ok: true };
}, { legacyWrite: true });
