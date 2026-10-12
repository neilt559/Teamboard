import { handle, bad, parseId } from '@/lib/http';
import { guardedPatch, norm } from '@/lib/patch';
import { deleteWithSnapshot } from '@/lib/audit';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';
export const maxDuration = 60;

const SCOPE = 'tb_can_see_project($1::bigint, project_id)';
const COLUMNS = {
  label: { type: 'text', text: true, norm: norm.line(300) },
  value: { type: 'text', text: true, norm: norm.text(4000) },
  position: { type: 'float8', norm: (v) => Number(v) },
};

// PATCH /api/info/:id: label (300) and value (4000), base-compared; position. -> { ok, row }.
export const PATCH = handle(async ({ viewer, params, body, now }) => {
  const b = await body();
  if ('position' in b && (b.position === null || b.position === '' || !Number.isFinite(Number(b.position)))) throw bad();
  const { row } = await guardedPatch({
    table: 'project_info', id: parseId(params.id), body: b, columns: COLUMNS, actorId: viewer.id,
    scopeSql: SCOPE, scopeParams: [String(viewer.id)], bumpProjectRev: true, now,
  });
  return { ok: true, row };
}, { legacyWrite: true });

// DELETE /api/info/:id: confirmed in the UI; the row goes to audit_log as JSON in the same statement.
// Missing or not visible: { ok } either way (no existence leak, design §4.6 / §7.1).
export const DELETE = handle(async ({ viewer, params }) => {
  await deleteWithSnapshot({
    table: 'project_info', id: parseId(params.id), actorId: viewer.id, action: 'info.delete',
    scopeSql: SCOPE, scopeParams: [String(viewer.id)], bumpProjectRev: true,
  });
  return { ok: true };
}, { legacyWrite: true });
