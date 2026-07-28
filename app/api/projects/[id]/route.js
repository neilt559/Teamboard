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
      await sql`UPDATE projects SET name=${(b.name || '').slice(0, 200)} WHERE id=${id}`;
    }
    if ('notes' in b) {
      await sql`UPDATE projects SET notes=${(b.notes ?? '').slice(0, 5000)} WHERE id=${id}`;
    }
    if ('team_id' in b) {
      await sql`UPDATE projects SET team_id=${b.team_id || null} WHERE id=${id}`;
    }
    if ('position' in b) {
      await sql`UPDATE projects SET position=${b.position} WHERE id=${id}`;
    }
    if ('archived' in b) {
      await sql`UPDATE projects SET archived=${!!b.archived} WHERE id=${id}`;
    }
    const r = await sql`SELECT id, team_id, name, notes, position, archived FROM projects WHERE id=${id}`;
    return NextResponse.json(r.rows[0] || {});
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function DELETE(req, { params }) {
  try {
    await ensureSchema();
    const { id } = await params;
    await sql`DELETE FROM projects WHERE id=${id}`;
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
