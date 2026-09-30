import { NextResponse } from 'next/server';
import { sql, ensureSchema } from '@/lib/db';
import { sessionUser, COOKIE } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Cast, change, or (entrant_id: null) take back the signed-in user's vote on a
// matchup. The voter always comes from the session, never the request body.
export async function POST(req) {
  try {
    await ensureSchema();
    const me = await sessionUser(req.cookies.get(COOKIE)?.value);
    if (!me) return NextResponse.json({ error: 'Please sign in' }, { status: 401 });
    const { match_id, entrant_id } = await req.json();
    const r = await sql`
      SELECT m.a_id, m.b_id, m.winner_id, b.archived
      FROM bracket_matches m JOIN brackets b ON b.id = m.bracket_id
      WHERE m.id = ${match_id}`;
    const m = r.rows[0];
    if (!m) return NextResponse.json({ error: 'Matchup not found' }, { status: 404 });
    if (m.archived) return NextResponse.json({ error: 'This bracket is closed.' }, { status: 409 });
    if (m.winner_id) return NextResponse.json({ error: 'A winner was already picked for this matchup.' }, { status: 409 });

    if (!entrant_id) {
      await sql`DELETE FROM bracket_votes WHERE match_id = ${match_id} AND user_id = ${me.id}`;
      return NextResponse.json({ ok: true });
    }
    if (!m.a_id || !m.b_id) return NextResponse.json({ error: 'This matchup isn’t set yet.' }, { status: 409 });
    if (String(entrant_id) !== String(m.a_id) && String(entrant_id) !== String(m.b_id)) {
      return NextResponse.json({ error: 'That entrant isn’t in this matchup.' }, { status: 400 });
    }
    await sql`
      INSERT INTO bracket_votes (match_id, user_id, entrant_id)
      VALUES (${match_id}, ${me.id}, ${entrant_id})
      ON CONFLICT (match_id, user_id) DO UPDATE SET entrant_id = EXCLUDED.entrant_id, created_at = now()`;
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
