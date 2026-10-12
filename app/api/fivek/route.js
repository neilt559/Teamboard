import { handle, bad, notFound, parseId } from '@/lib/http';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';
export const maxDuration = 60;

// Bump an office's 5K counter by +1 or -1 (design §8.2, §10(d), rule 8). Done as a single atomic UPDATE so
// simultaneous taps from different people all count; never goes below zero. Anyone signed in, any office.
// Body { office_id, delta }: a negative delta is -1, anything else +1. Answers { id, fivek } as before.
export const POST = handle(async ({ body }) => {
  const { office_id, delta } = await body();
  if (!office_id) throw bad('office_id required');
  const officeId = parseId(office_id);
  const d = Number(delta) < 0 ? -1 : 1;
  const r = await query(
    `UPDATE offices SET fivek = GREATEST(0, fivek + $1::int)
     WHERE id = $2::bigint
     RETURNING id, fivek`,
    [d, officeId]);
  if (!r.rows.length) throw notFound('Office not found');
  return r.rows[0];
}, { legacyWrite: true });
