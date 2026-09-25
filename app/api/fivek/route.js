import { NextResponse } from 'next/server';
import { sql, ensureSchema } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Bump an office's 5K counter by +1 or -1. Done as a single atomic UPDATE so
// simultaneous taps from different people all count; never goes below zero.
export async function POST(req) {
  try {
    await ensureSchema();
    const { office_id, delta } = await req.json();
    if (!office_id) {
      return NextResponse.json({ error: 'office_id required' }, { status: 400 });
    }
    const d = Number(delta) < 0 ? -1 : 1;
    const r = await sql`
      UPDATE offices SET fivek = GREATEST(0, fivek + ${d})
      WHERE id = ${office_id}
      RETURNING id, fivek`;
    if (!r.rows.length) {
      return NextResponse.json({ error: 'Office not found' }, { status: 404 });
    }
    return NextResponse.json(r.rows[0]);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
