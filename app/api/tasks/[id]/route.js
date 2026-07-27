import { NextResponse } from 'next/server';
import { sql, ensureSchema } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Only the fields present in the body are updated, so the client can send
// a single changed column (title / assignee_id / due_date / status).
export async function PATCH(req, { params }) {
  try {
    await ensureSchema();
    const { id } = await params;
    const b = await req.json();
    if ('title' in b) {
      await sql`UPDATE tasks SET title=${(b.title ?? '').slice(0, 500)} WHERE id=${id}`;
    }
    if ('assignee_id' in b) {
      await sql`UPDATE tasks SET assignee_id=${b.assignee_id || null} WHERE id=${id}`;
    }
    if ('due_date' in b) {
      await sql`UPDATE tasks SET due_date=${b.due_date || null} WHERE id=${id}`;
    }
    if ('status' in b) {
      await sql`UPDATE tasks SET status=${b.status || 'not_started'} WHERE id=${id}`;
    }
    if ('archived' in b) {
      await sql`UPDATE tasks SET archived=${!!b.archived} WHERE id=${id}`;
    }
    const r = await sql`
      SELECT id, project_id, title, assignee_id, due_date, status, archived
      FROM tasks WHERE id=${id}`;
    return NextResponse.json(r.rows[0] || {});
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function DELETE(req, { params }) {
  try {
    await ensureSchema();
    const { id } = await params;
    await sql`DELETE FROM tasks WHERE id=${id}`;
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
