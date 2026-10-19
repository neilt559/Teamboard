import 'server-only';
import { query } from './db.js';
import { forbidden, notFound } from './http.js';
import { canTouchOfficeStats } from './policy.js';

// Server side of canTouchOfficeStats (lib/policy.js): GeoGuessr scores and the 5K counter change only for admins
// and the office's own people (Neil, 2026-10-19). Throws 403 naming the office, or 404 for an office that doesn't
// exist (so a stranger can't tell a missing office from someone else's).
export async function requireOfficeStats(viewer, officeId) {
  if (canTouchOfficeStats(viewer, officeId)) return;
  const r = await query(`SELECT name FROM offices WHERE id = $1::bigint`, [String(officeId)]);
  const name = r.rows[0]?.name;
  if (!name) throw notFound('Office not found');
  throw forbidden(`Only ${name}’s people (and admins) can change ${name}’s GeoGuessr.`);
}

// The SQL scope for a single geo_scores row the viewer may change (for deleteWithSnapshot's scopeSql).
export const officeStatsScope = (viewer) => ({
  scopeSql: `$1::boolean OR office_id = ANY($2::bigint[])`,
  scopeParams: [String(!!viewer?.is_admin), (viewer?.office_ids || []).map(String)],
});
