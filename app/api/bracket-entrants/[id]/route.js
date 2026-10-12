import { handle, parseId, str, bad, notFound, forbidden, HttpError } from '@/lib/http';
import { query } from '@/lib/db';
import { bracketPolicy, isAdmin, isOrganizer } from '@/lib/access';
import { guardedPatch, norm } from '@/lib/patch';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';
export const maxDuration = 60;

// PATCH /api/bracket-entrants/:id { name, base?: { name } }: rename an entrant (fixes typos). Matches point at
// entrants by id, so the new name shows everywhere that entrant has advanced to. Today's rules: trimmed,
// 120 characters, 400 "Name required". New: base-compared (§7.1), and only where bracketPolicy.canEdit
// allows (legacy bracket: everyone; new brackets: organizers; archived: admins).
export const PATCH = handle(async ({ viewer, params, body, now }) => {
  const id = parseId(params.id);
  const b = await body();
  if (!str(b.name, 120)) throw bad('Name required');
  const r = await query(
    `SELECT e.id, b.archived, b.deleted_at, b.mode, b.crown_policy, b.activated_at
     FROM bracket_entrants e JOIN brackets b ON b.id = e.bracket_id WHERE e.id = $1::bigint`, [id]);
  const row = r.rows[0];
  if (!row || row.deleted_at) throw notFound('Entrant not found');
  const pol = bracketPolicy(viewer, { ...row, archived: !!row.archived });
  if (!pol.canEdit) {
    if (row.archived && !isAdmin(viewer)) throw new HttpError(409, 'This bracket is closed.');
    throw forbidden('Only culture organizers can edit this bracket.');
  }
  const { row: saved } = await guardedPatch({
    table: 'bracket_entrants', id, body: { name: b.name, ...(b.base ? { base: b.base } : {}) }, now, actorId: viewer.id,
    columns: { name: { type: 'text', text: true, norm: norm.line(120) } },
    scopeSql: `bracket_id IN (SELECT x.id FROM brackets x WHERE x.deleted_at IS NULL
                 AND (x.crown_policy = 'anyone' OR $1::boolean) AND (NOT x.archived OR $2::boolean))`,
    scopeParams: [isOrganizer(viewer), isAdmin(viewer)],
  });
  return {
    ok: true,
    row: {
      id: String(saved.id), bracket_id: String(saved.bracket_id), name: saved.name,
      quadrant: Number(saved.quadrant), seed: Number(saved.seed),
      updated_at: saved.updated_at instanceof Date ? saved.updated_at.toISOString() : saved.updated_at,
      updated_by: saved.updated_by == null ? null : String(saved.updated_by),
      updated_by_name: saved.updated_by_name ?? null,
    },
  };
}, { legacyWrite: true });
