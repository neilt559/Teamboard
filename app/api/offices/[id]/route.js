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
      await sql`UPDATE offices SET name=${(b.name || '').slice(0, 200)} WHERE id=${id}`;
    }
    if ('position' in b) {
      await sql`UPDATE offices SET position=${b.position} WHERE id=${id}`;
    }
    if ('archived' in b) {
      await sql`UPDATE offices SET archived=${!!b.archived} WHERE id=${id}`;
    }
    const r = await sql`SELECT id, name, position, archived FROM offices WHERE id=${id}`;
    return NextResponse.json(r.rows[0] || {});
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// Deleting an office cascades to its teams (and their projects and tasks).
export async function DELETE(req, { params }) {
  try {
    await ensureSchema();
    const { id } = await params;
    await sql`DELETE FROM offices WHERE id=${id}`;
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
