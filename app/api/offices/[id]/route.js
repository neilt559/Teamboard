import { NextResponse } from 'next/server';
import { sql, ensureSchema } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function PATCH(req, { params }) {
  try {
    await ensureSchema();
    const { id } = await params;
    const b = await req.json();
    if ('name' in b) {
      await sql`UPDATE offices SET name=${(b.name || '').slice(0, 200)} WHERE id=${id}`;
    }
    if ('position' in b) {
      await sql`UPDATE offices SET position=${b.position} WHERE id=${id}`;
    }
    if ('archived' in b) {
      await sql`UPDATE offices SET archived=${!!b.archived} WHERE id=${id}`;
    }
    // Joining GeoGuessr is one-way: an office can be added, never taken off.
    if (b.geo_on === true) {
      await sql`UPDATE offices SET geo_on=true WHERE id=${id}`;
    }
    const r = await sql`SELECT id, name, position, archived FROM offices WHERE id=${id}`;
    return NextResponse.json(r.rows[0] || {});
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// Deleting an office cascades to its teams (and their projects and tasks).
// An office with any GeoGuessr history can never be deleted — that data is
// kept for good (archive the office instead). The database enforces this too.
export async function DELETE(req, { params }) {
  try {
    await ensureSchema();
    const { id } = await params;
    const g = await sql`
      SELECT (SELECT count(*)::int FROM geo_scores WHERE office_id=${id}) AS scores,
             (SELECT fivek FROM offices WHERE id=${id}) AS fivek`;
    const { scores, fivek } = g.rows[0] || {};
    if (scores > 0 || Number(fivek) > 0) {
      return NextResponse.json({ error: 'This office has GeoGuessr history, so it can’t be deleted. Archive it instead.' }, { status: 409 });
    }
    await sql`DELETE FROM offices WHERE id=${id}`;
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
