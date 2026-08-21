import { NextResponse } from 'next/server';
import { sql, ensureSchema } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function PATCH(req, { params }) {
  try {
    await ensureSchema();
    const { id } = await params;
    const b = await req.json();
    if ('label' in b) {
      await sql`UPDATE project_info SET label=${(b.label ?? '').slice(0, 300)} WHERE id=${id}`;
    }
    if ('value' in b) {
      await sql`UPDATE project_info SET value=${(b.value ?? '').slice(0, 4000)} WHERE id=${id}`;
    }
    if ('position' in b) {
      await sql`UPDATE project_info SET position=${b.position} WHERE id=${id}`;
    }
    const r = await sql`SELECT id, project_id, label, value, position FROM project_info WHERE id=${id}`;
    return NextResponse.json(r.rows[0] || {});
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function DELETE(req, { params }) {
  try {
    await ensureSchema();
    const { id } = await params;
    await sql`DELETE FROM project_info WHERE id=${id}`;
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
