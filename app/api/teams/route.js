import { handle, HttpError, parseId, str, bad, forbidden } from '@/lib/http';
import { query } from '@/lib/db';
import { canManageTeamsIn } from '@/lib/access';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';
export const maxDuration = 60;

// POST /api/teams {name, office_id}: a new team in an office (design §8.2, §4.5). Allowed for L2 in their
// own offices (home or extra) and L3+ anywhere (canManageTeamsIn). The office must exist and be active.
// Response shape unchanged for old tabs: { id, name, office_id }.
export const POST = handle(async ({ viewer, body }) => {
  const b = await body();
  if (b.office_id == null || b.office_id === '') throw bad('Pick an office.');
  const officeId = parseId(b.office_id);
  if (!canManageTeamsIn(viewer, officeId)) throw forbidden('Only project engineers and up in that office can add teams.');
  const name = str(b.name, 200) || 'New Team';
  const r = await query(
    `INSERT INTO teams (name, office_id, position, created_by)
     SELECT $1::text, o.id, $3::float8, $4::bigint FROM offices o WHERE o.id = $2::bigint AND NOT o.archived
     RETURNING id, name, office_id, position, archived`,
    [name, officeId, Date.now(), String(viewer.id)]);
  const row = r.rows[0];
  if (!row) throw new HttpError(404, 'Office not found');
  return { id: String(row.id), name: row.name, office_id: String(row.office_id), position: Number(row.position), archived: !!row.archived };
}, { legacyWrite: true });
