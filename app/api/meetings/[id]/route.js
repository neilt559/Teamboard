import { NextResponse } from 'next/server';
import { sql, ensureSchema } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function PATCH(req, { params }) {
  try {
    await ensureSchema();
    const { id } = await params;
    const b = await req.json();
    if ('title' in b) {
      await sql`UPDATE meetings SET title=${(b.title || 'Meeting').slice(0, 300)} WHERE id=${id}`;
    }
    if ('meeting_date' in b) {
      await sql`UPDATE meetings SET meeting_date=${b.meeting_date || null} WHERE id=${id}`;
    }
    if ('minutes' in b) {
      await sql`UPDATE meetings SET minutes=${(b.minutes ?? '').slice(0, 100000)} WHERE id=${id}`;
    }
    const r = await sql`SELECT id, office_id, title, meeting_date, minutes, position FROM meetings WHERE id=${id}`;
    return NextResponse.json(r.rows[0] || {});
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function DELETE(req, { params }) {
  try {
    await ensureSchema();
    const { id } = await params;
    await sql`DELETE FROM meetings WHERE id=${id}`;
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
