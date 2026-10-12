import { handle, HttpError, bad, str } from '@/lib/http';
import { query } from '@/lib/db';
import { validTimeZone } from '@/app/(app)/admin/_parts/timezones';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';
export const maxDuration = 60;

// Create an office (design §8.2).
//   { name, geo_on: true }  -> GeoGuessr's "Or create a new office" (anyone, as today; rule 6: only these join
//                              GeoGuessr). Kept exactly: same body, same { id, name } answer. Audited.
//   { name, tz? }           -> admins only (/admin/org; 404 for others, like every admin API); geo_on = false,
//                              so it never joins GeoGuessr on its own (rule 46).
// position = Date.now(), so a new office sorts last (as today). A blank name becomes 'New Office' (as today).
export const POST = handle(async ({ viewer, body }) => {
  const b = await body();
  const geo = b.geo_on === true;
  if (!geo && !viewer.is_admin) throw new HttpError(404, 'Not found');
  const name = str(b.name, 200) || 'New Office';
  let tz = null;
  if (!geo && b.tz != null && b.tz !== '') {
    tz = validTimeZone(b.tz);
    if (!tz) throw bad('Pick a valid time zone.');
  }
  const r = await query(
    `WITH o AS (INSERT INTO offices (name, position, geo_on, tz) VALUES ($1::text, $2::float8, $3::boolean, $4::text)
                RETURNING id, name, position, archived, geo_on, fivek, tz),
     a AS (INSERT INTO audit_log (actor_id, action, entity, entity_id, detail)
           SELECT $5::bigint, 'office.create', 'offices', o.id::text, jsonb_build_object('name', o.name, 'geo_on', o.geo_on) FROM o)
     SELECT * FROM o`,
    [name, Date.now(), geo, tz, String(viewer.id)]);
  const row = r.rows[0];
  return { ...row, id: String(row.id), position: Number(row.position), fivek: Number(row.fivek) || 0 };
}, { legacyWrite: true });
