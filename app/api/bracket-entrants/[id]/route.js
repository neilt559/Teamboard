import { NextResponse } from 'next/server';
import { sql, ensureSchema } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Rename an entrant (fixes typos). Matches reference entrants by id, so the
// new name shows everywhere that entrant has advanced to.
export async function PATCH(req, { params }) {
  try {
    await ensureSchema();
    const { id } = await params;
    const { name } = await req.json();
    const n = String(name || '').trim().slice(0, 120);
    if (!n) return NextResponse.json({ error: 'Name required' }, { status: 400 });
    await sql`UPDATE bracket_entrants SET name = ${n} WHERE id = ${id}`;
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
