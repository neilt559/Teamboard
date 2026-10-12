import { handle, HttpError, parseId, str, ymd, bad } from '@/lib/http';
import { query } from '@/lib/db';
import { shapeMeeting } from '@/lib/queries/offices';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';
export const maxDuration = 60;

// POST /api/meetings {office_id, title, meeting_date}: a new office meeting (design §8.2, inventory §1.8).
// Office-internal: home or extra office at any level, L3+ or admin (tb_can_see_office), checked inside the
// INSERT. The client sends its own local date (the old UTC default pre-filled tomorrow in US evenings).
// Response shape unchanged for old tabs: the created row { id, office_id, title, meeting_date, minutes, position }.
export const POST = handle(async ({ viewer, body }) => {
  const b = await body();
  if (b.office_id == null || b.office_id === '') throw bad('office_id required');
  const officeId = parseId(b.office_id);
  const title = str(b.title, 300) || 'Meeting';
  let date = null;
  if (b.meeting_date != null && b.meeting_date !== '') {
    date = ymd(b.meeting_date);
    if (!date) throw bad('Invalid date.');
  }
  const r = await query(
    `INSERT INTO meetings (office_id, title, meeting_date, position, updated_at, updated_by)
     SELECT o.id, $3::text, $4::text, $5::float8, now(), $1::bigint
     FROM offices o
     WHERE o.id = $2::bigint AND tb_can_see_office($1::bigint, o.id)
     RETURNING id, office_id, title, meeting_date, minutes, position, updated_at, updated_by`,
    [String(viewer.id), officeId, title, date, Date.now()]);
  // A missing office and one whose internals you can't see get the same answer (no existence leak).
  if (!r.rows[0]) throw new HttpError(404, 'Office not found');
  return shapeMeeting(r.rows[0]);
}, { legacyWrite: true });
