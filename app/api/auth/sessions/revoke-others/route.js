import { handle } from '@/lib/http';
import { query } from '@/lib/db';
import { expireSessions, COOKIE } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';
export const maxDuration = 60;

// POST /api/auth/sessions/revoke-others: "Sign out other devices" (Settings > Password; design §8.2).
// Every other session of mine ends (expires_at = now(), rows kept); this device stays signed in.
// -> { ok, devices } (devices still signed in, i.e. 1). Works before the profile is finished (/api/auth/* is on the
// design §5.2 allow-list); a pending password change must come first.
export const POST = handle(async ({ req, viewer: me }) => {
  await expireSessions(me.id, { exceptRaw: req.cookies.get(COOKIE)?.value });
  const r = await query(
    `WITH a AS (INSERT INTO audit_log (actor_id, action, entity, entity_id, detail)
                VALUES ($1::bigint, 'sessions.revoke_others', 'users', $1::text, '{}'::jsonb))
     SELECT count(*)::int AS n FROM sessions WHERE user_id = $1::bigint AND expires_at > now()`, [me.id]);
  return { ok: true, devices: Number(r.rows[0]?.n || 0) };
}, { allowIncomplete: true, maxBody: 10_000 });
