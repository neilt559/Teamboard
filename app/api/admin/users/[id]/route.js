import { NextResponse } from 'next/server';
import { sql, ensureSchema } from '@/lib/db';
import { adminUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Make someone an admin, or take admin away ({ is_admin }). There must
// always be at least one admin left.
export async function PATCH(req, { params }) {
  try {
    await ensureSchema();
    if (!(await adminUser(req))) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const { id } = await params;
    const { is_admin } = await req.json();
    if (is_admin) {
      await sql`UPDATE users SET is_admin = true WHERE id = ${id}`;
    } else {
      const r = await sql`
        UPDATE users SET is_admin = false
        WHERE id = ${id} AND (SELECT count(*) FROM users WHERE is_admin) > 1
        RETURNING id`;
      if (!r.rows.length) return NextResponse.json({ error: 'There has to be at least one admin.' }, { status: 409 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
