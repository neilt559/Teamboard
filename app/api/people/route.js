import { NextResponse } from 'next/server';
import { sql, ensureSchema } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req) {
  try {
    await ensureSchema();
    const { name, color } = await req.json();
    if (!name || !name.trim()) {
      return NextResponse.json({ error: 'name required' }, { status: 400 });
    }
    const r = await sql`
      INSERT INTO people (name, color)
      VALUES (${name.trim().slice(0, 120)}, ${color || '#5B5859'})
      RETURNING id, name, color`;
    return NextResponse.json(r.rows[0]);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
