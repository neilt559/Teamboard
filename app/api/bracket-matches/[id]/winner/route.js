import { NextResponse } from 'next/server';
import { sql, ensureSchema } from '@/lib/db';
import { nextSlot, ROUNDS } from '@/lib/bracket';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Declare the winner of a matchup and move them into their next-round slot
// (or crown them champion if this is the final).
export async function POST(req, { params }) {
  try {
    await ensureSchema();
    const { id } = await params;
    const { entrant_id } = await req.json();
    if (!entrant_id) return NextResponse.json({ error: 'entrant_id required' }, { status: 400 });
    // One guarded UPDATE, so two people clicking at once can't both "win" —
    // and rounds go one at a time, so every earlier matchup must be decided.
    const r = await sql`
      UPDATE bracket_matches m SET winner_id = ${entrant_id}, decided_at = now()
      FROM brackets b
      WHERE m.id = ${id} AND b.id = m.bracket_id AND NOT b.archived
        AND m.winner_id IS NULL AND m.a_id IS NOT NULL AND m.b_id IS NOT NULL
        AND (m.a_id = ${entrant_id} OR m.b_id = ${entrant_id})
        AND NOT EXISTS (
          SELECT 1 FROM bracket_matches p
          WHERE p.bracket_id = m.bracket_id AND p.round < m.round AND p.winner_id IS NULL)
      RETURNING m.bracket_id, m.round, m.idx`;
    if (!r.rows.length) {
      return NextResponse.json({ error: 'Couldn’t declare that winner — the matchup may already be decided, or its round isn’t open yet. Refresh and try again.' }, { status: 409 });
    }
    const { bracket_id, round, idx } = r.rows[0];
    const nx = nextSlot(round, idx);
    if (!nx) {
      await sql`UPDATE brackets SET champion_id = ${entrant_id}, completed_at = now() WHERE id = ${bracket_id}`;
    } else if (nx.side === 'a') {
      await sql`UPDATE bracket_matches SET a_id = ${entrant_id} WHERE bracket_id = ${bracket_id} AND round = ${nx.round} AND idx = ${nx.idx}`;
    } else {
      await sql`UPDATE bracket_matches SET b_id = ${entrant_id} WHERE bracket_id = ${bracket_id} AND round = ${nx.round} AND idx = ${nx.idx}`;
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// Undo a declared winner: pull them back out of the next round (clearing any
// votes already cast on that next matchup). Refused if the next round's
// matchup has itself been decided — undo that one first.
export async function DELETE(req, { params }) {
  try {
    await ensureSchema();
    const { id } = await params;
    const r = await sql`
      SELECT m.bracket_id, m.round, m.idx, m.winner_id, b.archived
      FROM bracket_matches m JOIN brackets b ON b.id = m.bracket_id
      WHERE m.id = ${id}`;
    const m = r.rows[0];
    if (!m) return NextResponse.json({ error: 'Matchup not found' }, { status: 404 });
    if (m.archived) return NextResponse.json({ error: 'This bracket is closed.' }, { status: 409 });
    if (!m.winner_id) return NextResponse.json({ ok: true });

    const nx = nextSlot(m.round, m.idx);
    if (!nx) {
      await sql`UPDATE brackets SET champion_id = NULL, completed_at = NULL WHERE id = ${m.bracket_id}`;
    } else {
      const n = (await sql`
        SELECT id, winner_id FROM bracket_matches
        WHERE bracket_id = ${m.bracket_id} AND round = ${nx.round} AND idx = ${nx.idx}`).rows[0];
      if (n && n.winner_id) {
        return NextResponse.json({ error: `Undo the ${ROUNDS[nx.round]} result first.` }, { status: 409 });
      }
      if (n) {
        await sql`DELETE FROM bracket_votes WHERE match_id = ${n.id}`;
        if (nx.side === 'a') await sql`UPDATE bracket_matches SET a_id = NULL WHERE id = ${n.id}`;
        else await sql`UPDATE bracket_matches SET b_id = NULL WHERE id = ${n.id}`;
      }
    }
    await sql`UPDATE bracket_matches SET winner_id = NULL, decided_at = NULL WHERE id = ${id}`;
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
