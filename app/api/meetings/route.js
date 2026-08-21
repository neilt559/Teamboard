import { NextResponse } from 'next/server';
import { sql, ensureSchema } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req) {
  try {
    await ensureSchema();
    const { office_id, title, meeting_date } = await req.json();
    if (!office_id) {
      return NextResponse.json({ error: 'office_id required' }, { status: 400 });
    }
    const r = await sql`
      INSERT INTO meetings (office_id, title, meeting_date, position)
      VALUES (${office_id}, ${(title || 'Meeting').slice(0, 300)}, ${meeting_date || null}, ${Date.now()})
      RETURNING id, office_id, title, meeting_date, minutes, position`;
    return NextResponse.json(r.rows[0]);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
