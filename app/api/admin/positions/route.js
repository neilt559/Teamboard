import { handle, bad, str } from '@/lib/http';
import { query } from '@/lib/db';
import { uniqueKey } from '@/lib/queries/admin';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';
export const maxDuration = 60;

// Add a position { name, level 1-4 } (§3.2, §8.2). Positions are never deleted, only archived (PATCH).
// It sorts last; reorder with PATCH { sort }.
export const POST = handle(async ({ viewer, body }) => {
  const b = await body();
  const name = str(b.name, 80);
  if (!name) throw bad('Type a name for the position.');
  const level = Number(b.level ?? 1);
  if (!Number.isInteger(level) || level < 1 || level > 4) throw bad('The level must be 1, 2, 3 or 4.');
  const key = await uniqueKey('positions', name);
  const r = await query(
    `WITH p AS (INSERT INTO positions (key, name, level, sort)
                SELECT $1::text, $2::text, $3::smallint, COALESCE((SELECT max(sort) FROM positions), 0) + 10
                RETURNING id, key, name, level, sort, archived),
     a AS (INSERT INTO audit_log (actor_id, action, entity, entity_id, detail)
           SELECT $4::bigint, 'position.create', 'positions', p.id::text, jsonb_build_object('name', p.name, 'level', p.level) FROM p)
     SELECT * FROM p`,
    [key, name, level, String(viewer.id)]);
  const row = r.rows[0];
  return { ok: true, row: { ...row, id: String(row.id), level: Number(row.level) } };
}, { auth: 'admin' });
