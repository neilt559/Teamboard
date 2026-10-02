import { NextResponse } from 'next/server';
import { sql, ensureSchema } from '@/lib/db';
import { adminUser, hashPassword, MIN_PASSWORD } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Admin sets a temporary password for someone. It signs them out on every
// device, and they're asked to choose their own password at next sign-in.
export async function POST(req, { params }) {
  try {
    await ensureSchema();
    if (!(await adminUser(req))) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const { id } = await params;
    const { password } = await req.json();
    if (typeof password !== 'string' || password.length < MIN_PASSWORD) {
      return NextResponse.json({ error: `The temporary password needs at least ${MIN_PASSWORD} characters.` }, { status: 400 });
    }
    const r = await sql`UPDATE users SET password_hash = ${hashPassword(password)}, must_change = true WHERE id = ${id} RETURNING id`;
    if (!r.rows.length) return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    await sql`DELETE FROM sessions WHERE user_id = ${id}`;
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
