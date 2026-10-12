import { handle, HttpError, bad, parseId, str } from '@/lib/http';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';
export const maxDuration = 60;

const has = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);

// Rename, re-level, reorder or archive/restore a position: any of { name, level, sort, archived }.
// Re-leveling changes what everyone approved at this position sees, at once (tb_user_level reads it live).
// Never deleted: an archived position stays on the people who hold it but can't be picked any more.
export const PATCH = handle(async ({ viewer, params, body }) => {
  const pid = parseId(params.id);
  const b = await body();
  const params2 = [pid, String(viewer.id)];
  const p = (v) => { params2.push(v); return `$${params2.length}`; };
  const set = [];
  if (has(b, 'name')) {
    const name = str(b.name, 80);
    if (!name) throw bad('A position needs a name.');
    set.push(`name = ${p(name)}::text`);
  }
  if (has(b, 'level')) {
    const level = Number(b.level);
    if (!Number.isInteger(level) || level < 1 || level > 4) throw bad('The level must be 1, 2, 3 or 4.');
    set.push(`level = ${p(level)}::smallint`);
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
  const changed = p(JSON.stringify(Object.keys(b).filter((k) => ['name', 'level', 'sort', 'archived'].includes(k))));
  const r = await query(
    `WITH old AS (SELECT * FROM positions WHERE id = $1::bigint),
     u AS (UPDATE positions SET ${set.join(', ')} WHERE id = $1::bigint RETURNING id, key, name, level, sort, archived),
     a AS (INSERT INTO audit_log (actor_id, action, entity, entity_id, detail)
           SELECT $2::bigint, 'position.edit', 'positions', u.id::text,
                  jsonb_build_object('fields', ${changed}::jsonb, 'before', (SELECT to_jsonb(old) FROM old), 'after', to_jsonb(u)) FROM u)
     SELECT * FROM u`, params2);
  const row = r.rows[0];
  if (!row) throw new HttpError(404, 'Position not found');
  return { ok: true, row: { ...row, id: String(row.id), level: Number(row.level) } };
}, { auth: 'admin' });
