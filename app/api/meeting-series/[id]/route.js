import { handle, parseId } from '@/lib/http';
import { guardedPatch, norm } from '@/lib/patch';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';
export const maxDuration = 60;

const SCOPE = 'tb_can_see_project($1::bigint, project_id)';
const COLUMNS = {
  name: { type: 'text', text: true, norm: norm.lineOr(300, 'Series') },
  archived: { type: 'boolean', norm: (v) => !!v },
};

// PATCH /api/meeting-series/:id {name, base}: rename (blank -> 'Series'); { archived }: archive or restore it
// (design-amendments A9.2: an archived series leaves the series picker; its meetings keep their label). -> { ok, row }.
export const PATCH = handle(async ({ viewer, params, body, now }) => {
  const { row } = await guardedPatch({
    table: 'meeting_series', id: parseId(params.id), body: await body(), columns: COLUMNS, actorId: viewer.id,
    scopeSql: SCOPE, scopeParams: [String(viewer.id)], bumpProjectRev: true, now,
  });
  return { ok: true, row };
}, { legacyWrite: true });

// DELETE /api/meeting-series/:id: since A9 a series is archived, never deleted (deleting it used to take its
// meetings with it); an old open tab's delete archives it too. Missing or not visible: { ok } either way (no
// existence leak, design §4.6 / §7.1).
export const DELETE = handle(async ({ viewer, params, now }) => {
  try {
    await guardedPatch({
      table: 'meeting_series', id: parseId(params.id), body: { archived: true }, columns: { archived: COLUMNS.archived },
      actorId: viewer.id, scopeSql: SCOPE, scopeParams: [String(viewer.id)], bumpProjectRev: true, now,
    });
  } catch (e) {
    if (e?.status !== 404) throw e;
  }
  return { ok: true };
}, { legacyWrite: true });
