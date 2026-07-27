import { NextResponse } from 'next/server';
import { sql, ensureSchema } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req) {
  try {
    await ensureSchema();
    const { project_id } = await req.json();
    if (!project_id) {
      return NextResponse.json({ error: 'project_id required' }, { status: 400 });
    }
    const r = await sql`
      INSERT INTO tasks (project_id, position)
      VALUES (${project_id}, ${Date.now()})
      RETURNING id, project_id, title, assignee_id, due_date, status, archived, notes`;
    return NextResponse.json(r.rows[0]);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
