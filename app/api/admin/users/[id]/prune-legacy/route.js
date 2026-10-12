import { handle, HttpError, parseId } from '@/lib/http';
import { query } from '@/lib/db';
import { pruneLegacy } from '@/lib/queries/admin';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';
export const maxDuration = 60;

// "Apply new rules" to one person (§6): their legacy memberships are soft-removed, except their own team's
// projects and projects where they own tasks. Undo with POST /api/admin/legacy/undo/:batch.
// -> { ok, batch, removed, people }
export const POST = handle(async ({ viewer, params }) => {
  const uid = parseId(params.id);
  const found = await query(`SELECT 1 FROM users WHERE id = $1::bigint`, [uid]);
  if (!found.rows.length) throw new HttpError(404, 'Account not found');
  return { ok: true, ...(await pruneLegacy({ adminId: viewer.id, userId: uid })) };
}, { auth: 'admin' });
