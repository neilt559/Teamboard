import { handle, parseId, bad, forbidden } from '@/lib/http';
import { query } from '@/lib/db';
import { canManageTeamsIn } from '@/lib/access';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';
export const maxDuration = 60;

// POST /api/teams/reorder {office_id, ids: [teamId, ...]}: the new order of teams within ONE office
// (design §8.2; fixes the old ▲/▼, which swapped with a neighbor from any office, archived ones included).
// The listed teams take the positions they already hold among themselves, in the new order, in one
// statement; teams left out (archived ones) keep theirs. Every id must be a team in that office.
export const POST = handle(async ({ viewer, body }) => {
  const b = await body();
  if (b.office_id == null || b.office_id === '') throw bad('Pick an office.');
  const officeId = parseId(b.office_id);
  if (!Array.isArray(b.ids) || !b.ids.length || b.ids.length > 500) throw bad('Invalid order.');
  const ids = b.ids.map(parseId);
  if (new Set(ids).size !== ids.length) throw bad('Invalid order.');
  if (!canManageTeamsIn(viewer, officeId)) throw forbidden('Only project engineers and up in this office can reorder its teams.');
  const r = await query(
    `WITH want AS (SELECT x.id, x.ord FROM unnest($2::bigint[]) WITH ORDINALITY AS x(id, ord)),
     cur AS (SELECT t.id, t.position, row_number() OVER (ORDER BY t.position ASC, t.id ASC) AS rn
             FROM teams t WHERE t.office_id = $1::bigint AND t.id IN (SELECT id FROM want)),
     ok AS (SELECT (SELECT count(*) FROM cur) = $3::int AS all_here),
     upd AS (UPDATE teams t SET position = c.position
             FROM want w JOIN cur c ON c.rn = w.ord, ok
             WHERE ok.all_here AND t.id = w.id AND t.office_id = $1::bigint
             RETURNING t.id, t.position)
     SELECT (SELECT all_here FROM ok) AS all_here, (SELECT count(*) FROM upd)::int AS updated`,
    [officeId, ids, ids.length]);
  if (!r.rows[0]?.all_here) throw bad('Those teams are not all in this office. Refresh and try again.');
  return { ok: true, updated: Number(r.rows[0].updated) || 0 };
});
