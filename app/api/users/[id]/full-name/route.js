import { handle, bad, notFound, noNul, parseId } from '@/lib/http';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';
export const maxDuration = 60;

// PATCH /api/users/:id/full-name { full_name } -> { ok, full_name }
// The name printed on things that leave the company, the owner reports' "Prepared by" (Neil, 2026-10-16). Everyone
// sets their own; admins anyone's (audited). One line, spaces collapsed, at most 120 characters; '' = use the display
// name. Anyone else gets the same 404 as a missing account.
export const PATCH = handle(async ({ viewer, params, body }) => {
  const id = parseId(params.id);
  const self = String(viewer.id) === String(id);
  if (!self && !viewer.is_admin) throw notFound('Account not found');
  const b = await body();
  if (b.full_name != null && typeof b.full_name !== 'string') throw bad('Type the full name.');
  noNul(b.full_name);
  const name = String(b.full_name ?? '').replace(/\s+/g, ' ').trim();
  if (name.length > 120) throw bad('A full name can be at most 120 characters.');
  const r = await query(
    `WITH u AS (UPDATE users SET full_name = $2::text, updated_at = now() WHERE id = $1::bigint RETURNING id, full_name),
     a AS (INSERT INTO audit_log (actor_id, action, entity, entity_id, detail)
           SELECT $3::bigint, 'user.full_name', 'users', u.id::text, jsonb_build_object('full_name', u.full_name) FROM u
           WHERE $4::boolean)
     SELECT full_name FROM u`,
    [String(id), name, String(viewer.id), !self]);
  if (!r.rows[0]) throw notFound('Account not found');
  return { ok: true, full_name: r.rows[0].full_name };
}, { allowIncomplete: true });
