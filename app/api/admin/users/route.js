import { NextResponse } from 'next/server';
import { sql, ensureSchema } from '@/lib/db';
import { adminUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';

// Every account, for the admin-only Accounts page. Never includes passwords.
export async function GET(req) {
  try {
    await ensureSchema();
    if (!(await adminUser(req))) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const r = await sql`
      SELECT u.id, u.username, u.is_admin, u.must_change, u.created_at,
             (SELECT max(s.created_at) FROM sessions s WHERE s.user_id = u.id) AS last_sign_in,
             (SELECT count(*)::int FROM sessions s WHERE s.user_id = u.id AND s.expires_at > now()) AS devices
      FROM users u ORDER BY lower(u.username)`;
    return NextResponse.json({ users: r.rows });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
