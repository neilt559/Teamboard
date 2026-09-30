import { NextResponse } from 'next/server';
import { sql, ensureSchema } from '@/lib/db';
import { initialMatches, QUADRANTS, SEEDS } from '@/lib/bracket';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Start a new 20-entrant bracket (there's one shared bracket for everyone).
// The current one is archived first, which moves it into "Past brackets".
export async function POST(req) {
  try {
    await ensureSchema();
    const b = await req.json();
    const grid = Array.isArray(b.entrants) ? b.entrants : [];
    const rows = [];
    for (let q = 0; q < QUADRANTS; q++) {
      for (let s = 0; s < SEEDS; s++) {
        const name = String((grid[q] || [])[s] || '').trim().slice(0, 120);
        if (!name) return NextResponse.json({ error: 'All 20 spots need a name.' }, { status: 400 });
        rows.push({ name, quadrant: q, seed: s + 1 });
      }
    }
    const regions = Array.from({ length: QUADRANTS }, (_, q) =>
      String((b.regions || [])[q] || '').trim().slice(0, 60) || `Quadrant ${q + 1}`);
    const name = String(b.name || '').trim().slice(0, 120) || 'Office Bracket';

    await sql`UPDATE brackets SET archived = true WHERE NOT archived`;
    const created = await sql`
      INSERT INTO brackets (name, regions)
      VALUES (${name}, ${JSON.stringify(regions)})
      RETURNING id`;
    const bid = created.rows[0].id;
    const ents = await sql`
      INSERT INTO bracket_entrants (bracket_id, name, quadrant, seed)
      SELECT ${bid}::bigint, x.name, x.quadrant, x.seed
      FROM json_to_recordset(${JSON.stringify(rows)}::json) AS x(name text, quadrant int, seed int)
      RETURNING id, quadrant, seed`;
    const idOf = (q, seed) => Number(ents.rows.find((r) => Number(r.quadrant) === q && Number(r.seed) === seed).id);
    await sql`
      INSERT INTO bracket_matches (bracket_id, round, idx, a_id, b_id)
      SELECT ${bid}::bigint, x.round, x.idx, x.a_id, x.b_id
      FROM json_to_recordset(${JSON.stringify(initialMatches(idOf))}::json) AS x(round int, idx int, a_id bigint, b_id bigint)`;
    return NextResponse.json({ id: bid });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
