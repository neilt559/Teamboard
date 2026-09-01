import { NextResponse } from 'next/server';
import { sql, ensureSchema } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function PATCH(req, { params }) {
  try {
    await ensureSchema();
    const { id } = await params;
    const b = await req.json();
    if ('name' in b) {
      await sql`UPDATE meeting_series SET name=${(b.name || 'Series').slice(0, 300)} WHERE id=${id}`;
    }
    const r = await sql`SELECT id, project_id, name, position FROM meeting_series WHERE id=${id}`;
    return NextResponse.json(r.rows[0] || {});
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// Deleting a series cascades to its meetings.
export async function DELETE(req, { params }) {
  try {
    await ensureSchema();
    const { id } = await params;
    await sql`DELETE FROM meeting_series WHERE id=${id}`;
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
