import { NextResponse } from 'next/server';
import { sql, ensureSchema } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req) {
  try {
    await ensureSchema();
    const { name } = await req.json();
    const r = await sql`
      INSERT INTO projects (name, position)
      VALUES (${(name || 'New Project').slice(0, 200)}, ${Date.now()})
      RETURNING id, name`;
    return NextResponse.json(r.rows[0]);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
