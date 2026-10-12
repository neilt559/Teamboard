import { handle, HttpError, bad, parseId, str } from '@/lib/http';
import { query } from '@/lib/db';
import { normHex } from '@/app/_ui/people';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';
export const maxDuration = 60;

const has = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);

// Rename, recolor, reorder or archive/restore a department: any of { name, color, sort, archived }.
// Never deleted: an archived department stays on the people who have it but can't be picked any more.
export const PATCH = handle(async ({ viewer, params, body }) => {
  const did = parseId(params.id);
  const b = await body();
  const params2 = [did, String(viewer.id)];
  const p = (v) => { params2.push(v); return `$${params2.length}`; };
  const set = [];
  if (has(b, 'name')) {
    const name = str(b.name, 80);
    if (!name) throw bad('A department needs a name.');
    set.push(`name = ${p(name)}::text`);
  }
  if (has(b, 'color')) {
    const color = normHex(b.color);
    if (!color) throw bad('Pick a valid color like #5B5859.');
    set.push(`color = ${p(color)}::text`);
  }
  if (has(b, 'sort')) {
    const sort = Number(b.sort);
    if (!Number.isInteger(sort) || Math.abs(sort) > 1e9) throw bad('Invalid sort order.');
    set.push(`sort = ${p(sort)}::int`);
  }
  if (has(b, 'archived')) {
    if (typeof b.archived !== 'boolean') throw bad('archived must be true or false.');
    set.push(`archived = ${p(b.archived)}::boolean`);
  }
  if (!set.length) throw bad('Nothing to change.');
  const changed = p(JSON.stringify(Object.keys(b).filter((k) => ['name', 'color', 'sort', 'archived'].includes(k))));
  const r = await query(
    `WITH u AS (UPDATE departments SET ${set.join(', ')} WHERE id = $1::bigint RETURNING id, key, name, color, sort, archived),
     a AS (INSERT INTO audit_log (actor_id, action, entity, entity_id, detail)
           SELECT $2::bigint, 'department.edit', 'departments', u.id::text,
                  jsonb_build_object('fields', ${changed}::jsonb, 'after', to_jsonb(u)) FROM u)
     SELECT * FROM u`, params2);
  const row = r.rows[0];
  if (!row) throw new HttpError(404, 'Department not found');
  return { ok: true, row: { ...row, id: String(row.id) } };
}, { auth: 'admin' });
