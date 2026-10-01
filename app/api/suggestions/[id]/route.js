import { NextResponse } from 'next/server';
import { sql, ensureSchema } from '@/lib/db';
import { sessionUser, COOKIE } from '@/lib/auth';
import { CATEGORIES, STATUSES } from '@/lib/suggestions';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function load(req, id) {
  const me = await sessionUser(req.cookies.get(COOKIE)?.value);
  const r = await sql`SELECT id, user_id FROM suggestions WHERE id = ${id}`;
  return { me, s: r.rows[0] };
}

// Anyone can move a suggestion's status along; only its author can change
// the wording, category or anonymity.
export async function PATCH(req, { params }) {
  try {
    await ensureSchema();
    const { id } = await params;
    const { me, s } = await load(req, id);
    if (!me) return NextResponse.json({ error: 'Please sign in' }, { status: 401 });
    if (!s) return NextResponse.json({ error: 'Suggestion not found' }, { status: 404 });
    const b = await req.json();
    const mine = String(s.user_id) === String(me.id);
    const authorOnly = ['title', 'details', 'category', 'anonymous'].filter((k) => k in b);
    if (authorOnly.length && !mine) {
      return NextResponse.json({ error: 'Only the person who posted this can edit it.' }, { status: 403 });
    }
    if ('status' in b) {
      if (!STATUSES.some((x) => x.key === b.status)) return NextResponse.json({ error: 'Unknown status' }, { status: 400 });
      await sql`UPDATE suggestions SET status = ${b.status}, updated_at = now() WHERE id = ${id}`;
    }
    if ('title' in b) {
      const title = String(b.title || '').trim().slice(0, 160);
      if (!title) return NextResponse.json({ error: 'A suggestion needs a title.' }, { status: 400 });
      await sql`UPDATE suggestions SET title = ${title}, updated_at = now() WHERE id = ${id}`;
    }
    if ('details' in b) {
      await sql`UPDATE suggestions SET details = ${String(b.details || '').trim().slice(0, 5000)}, updated_at = now() WHERE id = ${id}`;
    }
    if ('category' in b && CATEGORIES.some((c) => c.key === b.category)) {
      await sql`UPDATE suggestions SET category = ${b.category}, updated_at = now() WHERE id = ${id}`;
    }
    if ('anonymous' in b) {
      await sql`UPDATE suggestions SET anonymous = ${!!b.anonymous}, updated_at = now() WHERE id = ${id}`;
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// Only the author can delete their own suggestion.
export async function DELETE(req, { params }) {
  try {
    await ensureSchema();
    const { id } = await params;
    const { me, s } = await load(req, id);
    if (!me) return NextResponse.json({ error: 'Please sign in' }, { status: 401 });
    if (!s) return NextResponse.json({ ok: true });
    if (String(s.user_id) !== String(me.id)) {
      return NextResponse.json({ error: 'Only the person who posted this can delete it.' }, { status: 403 });
    }
    await sql`DELETE FROM suggestions WHERE id = ${id}`;
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
