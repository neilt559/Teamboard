import { handle, HttpError, bad, gone, parseId } from '@/lib/http';
import { query } from '@/lib/db';
import { guardedPatch, norm } from '@/lib/patch';
import { validTimeZone } from '@/app/(app)/admin/_parts/timezones';
import { deleteOffice, officeUsage } from '@/lib/queries/admin';
import { spaceUsage, SPACE_DELETE_REFUSED } from '@/lib/queries/spaces';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';
export const maxDuration = 60;

const has = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);
const RET = 'id, name, position, archived, geo_on, tz';
const shape = (row) => ({ ...row, id: String(row.id), position: Number(row.position) });
const GEO_HISTORY = 'This office has GeoGuessr history, so it can’t be deleted. Archive it instead.';

// PATCH (design §8.2)
//   { geo_on: true } alone -> joins GeoGuessr: one-way, anyone, exactly as today (GeoGuessr's "Add").
//   name (trimmed, not blank; optional base.name), position, archived, tz -> admins only (404 for others).
//   geo_on is honored only when true; nothing ever sets it false (rule 5).
// Returns { ok, row } plus today's top-level { id, name, position, archived }.
export const PATCH = handle(async ({ viewer, params, body, now }) => {
  const oid = parseId(params.id);
  const b = await body();
  const keys = Object.keys(b).filter((k) => k !== 'base');

  if (keys.length === 1 && keys[0] === 'geo_on') {
    if (b.geo_on !== true) {                                   // one-way: anything but true changes nothing
      const cur = (await query(`SELECT ${RET} FROM offices WHERE id = $1::bigint`, [oid])).rows[0];
      if (!cur) throw gone();
      return { ok: true, row: shape(cur), ...shape(cur) };
    }
    const r = await query(
      `WITH old AS (SELECT id, geo_on FROM offices WHERE id = $1::bigint),
       o AS (UPDATE offices SET geo_on = true WHERE id = $1::bigint RETURNING ${RET}),
       a AS (INSERT INTO audit_log (actor_id, action, entity, entity_id, detail)
             SELECT $2::bigint, 'office.geo_join', 'offices', o.id::text, '{}'::jsonb FROM o JOIN old ON old.id = o.id AND NOT old.geo_on)
       SELECT * FROM o`, [oid, String(viewer.id)]);
    if (!r.rows[0]) throw gone();
    return { ok: true, row: shape(r.rows[0]), ...shape(r.rows[0]) };
  }

  if (!viewer.is_admin) throw new HttpError(404, 'Not found');
  const columns = {};
  const base = b.base && typeof b.base === 'object' ? b.base : {};
  if (has(b, 'name')) {
    if (!String(b.name ?? '').trim()) throw bad('An office name can’t be blank.');
    columns.name = { type: 'text', text: has(base, 'name'), norm: norm.line(200) };
  }
  if (has(b, 'position')) {
    if (typeof b.position !== 'number' || !Number.isFinite(b.position)) throw bad('Invalid position.');
    columns.position = { type: 'float8' };
  }
  if (has(b, 'archived')) {
    if (typeof b.archived !== 'boolean') throw bad('archived must be true or false.');
    columns.archived = { type: 'boolean' };
  }
  if (has(b, 'tz')) {
    const tz = b.tz == null || b.tz === '' ? null : validTimeZone(b.tz);
    if (b.tz != null && b.tz !== '' && !tz) throw bad('Pick a valid time zone.');
    columns.tz = { type: 'text', norm: () => tz };
  }
  if (b.geo_on === true) columns.geo_on = { type: 'boolean', norm: () => true };
  const body2 = { ...b };
  if (has(b, 'geo_on') && b.geo_on !== true) delete body2.geo_on;

  const { row } = await guardedPatch({ table: 'offices', id: oid, body: body2, columns, actorId: viewer.id, now });
  const changed = Object.keys(columns).filter((c) => has(body2, c));
  if (changed.length) {
    await query(
      `INSERT INTO audit_log (actor_id, action, entity, entity_id, detail)
       VALUES ($1::bigint, 'office.update', 'offices', $2::text, jsonb_build_object('fields', $3::jsonb, 'name', $4::text))`,
      [String(viewer.id), oid, JSON.stringify(changed), row.name]);
  }
  const out = shape({ id: row.id, name: row.name, position: row.position, archived: row.archived, geo_on: row.geo_on, tz: row.tz });
  return { ok: true, row: out, ...out };
}, { legacyWrite: true });

// DELETE (admins; the UI asks twice). Refused while the office has GeoGuessr history (scores or 5Ks), with
// today's text; refused while people still have it as their home office; refused while the office's board (or an
// old thread space of it or its teams) has posts (design-amendments A5.3, A10: nothing is ever deleted, archive it
// instead; the RESTRICT keys on space_posts and suggestions back this up). GeoGuessr history is checked first,
// so an office that has both (Charlotte: scores and the moved suggestions) keeps today's answer (rule 3, geo
// parity). The whole office tree is snapshotted to audit_log in the same statement as the delete. A missing office
// is { ok: true }.
export const DELETE = handle(async ({ viewer, params }) => {
  const oid = parseId(params.id);
  const threads = await spaceUsage({ officeId: oid });
  if (threads.posts || threads.suggestions) {
    const g = await query(
      `SELECT (o.fivek > 0 OR EXISTS (SELECT 1 FROM geo_scores gs WHERE gs.office_id = o.id)) AS geo
       FROM offices o WHERE o.id = $1::bigint`, [oid]);
    if (g.rows[0]?.geo) throw new HttpError(409, GEO_HISTORY);
    throw new HttpError(409, SPACE_DELETE_REFUSED.office, { code: 'has_threads' });
  }
  let r;
  try {
    r = await deleteOffice({ adminId: viewer.id, officeId: oid });
  } catch (e) {
    // RESTRICT foreign keys (users.office_id, geo_scores, space_posts, suggestions) raise 23001; NO ACTION ones 23503.
    if (e?.code !== '23503' && e?.code !== '23001') throw e;
    const t = await spaceUsage({ officeId: oid });               // a post that arrived meanwhile
    if (t.posts || t.suggestions) throw new HttpError(409, SPACE_DELETE_REFUSED.office, { code: 'has_threads' });
    const u = await officeUsage(oid);
    if (u?.people) {
      throw new HttpError(409, `${u.people} ${u.people === 1 ? 'person has' : 'people have'} “${u.name}” as their home office, `
        + 'so it can’t be deleted. Archive it instead.');
    }
    throw new HttpError(409, 'Other records still use this office (GeoGuessr scores, posts or events), so it can’t be deleted. Archive it instead.');
  }
  if (!r.deleted && r.existed && (r.scores > 0 || r.fivek > 0)) {
    throw new HttpError(409, GEO_HISTORY);
  }
  return { ok: true };
}, { auth: 'admin', legacyWrite: true });
