import { handle, bad, str } from '@/lib/http';
import { query } from '@/lib/db';
import { normHex } from '@/app/_ui/people';
import { uniqueKey } from '@/lib/queries/admin';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';
export const maxDuration = 60;

// Add a department { name, color } (its tag on profiles). Never deleted, only archived (PATCH).
export const POST = handle(async ({ viewer, body }) => {
  const b = await body();
  const name = str(b.name, 80);
  if (!name) throw bad('Type a name for the department.');
  const color = b.color == null || b.color === '' ? '#5B5859' : normHex(b.color);
  if (!color) throw bad('Pick a valid color like #5B5859.');
  const key = await uniqueKey('departments', name);
  const r = await query(
    `WITH d AS (INSERT INTO departments (key, name, color, sort)
                SELECT $1::text, $2::text, $3::text, COALESCE((SELECT max(sort) FROM departments), 0) + 10
                RETURNING id, key, name, color, sort, archived),
     a AS (INSERT INTO audit_log (actor_id, action, entity, entity_id, detail)
           SELECT $4::bigint, 'department.create', 'departments', d.id::text, jsonb_build_object('name', d.name) FROM d)
     SELECT * FROM d`,
    [key, name, color, String(viewer.id)]);
  const row = r.rows[0];
  return { ok: true, row: { ...row, id: String(row.id) } };
}, { auth: 'admin' });
