import 'server-only';
import { query, transaction } from '@/lib/db';

// GeoGuessr reads (design §2.1 loadGeo(), §8.2 GET /api/geo/state, §10(d)). Shared by the page, the 4 s poll
// endpoint and the Home widget.
//
// GeoGuessr is the same for everyone: every office and every score, whatever the viewer's office scope
// (offices are public, and an office that once played keeps its column forever, archived or not). These are
// the exact columns and ORDER BYs the old GET /api/state used for its `offices` and `geo` arrays, so the
// verbatim client sees byte-identical data (parity, design §14.5).
const OFFICES_SQL = 'SELECT id, name, position, archived, fivek, geo_on FROM offices ORDER BY position ASC, id ASC';
const GEO_SQL = 'SELECT id, office_id, score, score_date FROM geo_scores ORDER BY score_date ASC NULLS LAST, id ASC';

// { offices: [{id, name, position, archived, fivek, geo_on}], geo: [{id, office_id, score, score_date}] }.
// Two read-only queries in one round trip.
export async function loadGeo() {
  const [offices, geo] = await transaction([query(OFFICES_SQL), query(GEO_SQL)], { readOnly: true });
  return { offices: offices.rows, geo: geo.rows };
}

// Home widget: each playing office (geo_on not false, archived included, in page order) with its 5K count,
// how many scores it has and its latest dated score (undated scores sort last here).
export async function loadGeoWidget() {
  const r = await query(`
    SELECT o.id, o.name, o.archived, o.fivek,
           (SELECT count(*) FROM geo_scores c WHERE c.office_id = o.id)::int AS scores,
           l.score AS last_score, l.score_date AS last_date
    FROM offices o
    LEFT JOIN LATERAL (SELECT g.score, g.score_date FROM geo_scores g WHERE g.office_id = o.id
                       ORDER BY g.score_date DESC NULLS LAST, g.id DESC LIMIT 1) l ON true
    WHERE o.geo_on IS DISTINCT FROM false
    ORDER BY o.position ASC, o.id ASC`);
  return r.rows;
}
