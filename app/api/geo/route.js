import { handle, bad, parseId, str } from '@/lib/http';
import { query } from '@/lib/db';
import { requireOfficeStats } from '@/lib/office-stats';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';
export const maxDuration = 60;

// Add a GeoGuessr score (design §8.2, §10(d)). Admins for any office, everyone else for their own offices only
// (Neil, 2026-10-19; 403 naming the office otherwise). Otherwise the old rules: scores belong to the office (no
// user), duplicates per day are fine, there is no range check, and an empty date is stored as NULL.
// Body { office_id, score, score_date }; answers the inserted row as before.
export const POST = handle(async ({ viewer, body }) => {
  const { office_id, score, score_date } = await body();
  if (!office_id) throw bad('office_id required');
  const officeId = parseId(office_id);
  await requireOfficeStats(viewer, officeId);
  const n = Math.round(Number(score) || 0);
  // Stored as sent (TEXT, untrimmed, as before); capped only so a runaway value can't bloat the table.
  const date = score_date ? str(score_date, 100, { trim: false }) : '';
  const r = await query(
    `INSERT INTO geo_scores (office_id, score, score_date)
     VALUES ($1::bigint, $2::int, $3::text)
     RETURNING id, office_id, score, score_date`,
    [officeId, n, date || null]);
  return r.rows[0];
}, { legacyWrite: true });
