import { NextResponse } from 'next/server';
import { sql, ensureSchema } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req) {
  try {
    await ensureSchema();
    const { name, geo_on } = await req.json();
    // Only offices created from the GeoGuessr page join GeoGuessr.
    const r = await sql`
      INSERT INTO offices (name, position, geo_on)
      VALUES (${(name || 'New Office').slice(0, 200)}, ${Date.now()}, ${!!geo_on})
      RETURNING id, name`;
    return NextResponse.json(r.rows[0]);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
