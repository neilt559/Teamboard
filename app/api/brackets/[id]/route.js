import { NextResponse } from 'next/server';
import { sql, ensureSchema } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';

// Full detail for one bracket — used to view past brackets, whose entrants,
// matches and votes aren't included in /api/state.
export async function GET(req, { params }) {
  try {
    await ensureSchema();
    const { id } = await params;
    const b = await sql`
      SELECT b.id, b.office_id, b.name, b.notes, b.regions, b.champion_id, b.archived, b.created_at, b.completed_at, e.name AS champion_name
      FROM brackets b LEFT JOIN bracket_entrants e ON e.id = b.champion_id
      WHERE b.id = ${id}`;
    if (!b.rows.length) return NextResponse.json({ error: 'Bracket not found' }, { status: 404 });
    const entrants = await sql`SELECT id, bracket_id, name, quadrant, seed FROM bracket_entrants WHERE bracket_id = ${id}`;
    const matches = await sql`SELECT id, bracket_id, round, idx, a_id, b_id, winner_id FROM bracket_matches WHERE bracket_id = ${id}`;
    const votes = await sql`
      SELECT v.match_id, v.user_id, v.entrant_id
      FROM bracket_votes v JOIN bracket_matches m ON m.id = v.match_id
      WHERE m.bracket_id = ${id} ORDER BY v.created_at ASC`;
    return NextResponse.json({ bracket: b.rows[0], entrants: entrants.rows, matches: matches.rows, votes: votes.rows });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function PATCH(req, { params }) {
  try {
    await ensureSchema();
    const { id } = await params;
    const b = await req.json();
    if ('name' in b) {
      await sql`UPDATE brackets SET name = ${String(b.name || '').trim().slice(0, 120) || 'Office Bracket'} WHERE id = ${id}`;
    }
    if ('notes' in b) {
      await sql`UPDATE brackets SET notes = ${String(b.notes || '')} WHERE id = ${id}`;
    }
    if (Array.isArray(b.regions)) {
      const regions = [0, 1, 2, 3].map((q) => String(b.regions[q] || '').trim().slice(0, 60) || `Quadrant ${q + 1}`);
      await sql`UPDATE brackets SET regions = ${JSON.stringify(regions)} WHERE id = ${id}`;
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// Removes a bracket from history entirely (cascades to entrants/matches/votes).
export async function DELETE(req, { params }) {
  try {
    await ensureSchema();
    const { id } = await params;
    await sql`DELETE FROM brackets WHERE id = ${id}`;
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
