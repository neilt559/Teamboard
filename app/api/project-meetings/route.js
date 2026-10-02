import { NextResponse } from 'next/server';
import { sql, ensureSchema } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Meetings are written up first and saved in one go when someone presses Post.
export async function POST(req) {
  try {
    await ensureSchema();
    const { project_id, series_id, title, meeting_date, attendance, notes } = await req.json();
    if (!project_id) {
      return NextResponse.json({ error: 'project_id required' }, { status: 400 });
    }
    const r = await sql`
      INSERT INTO project_meetings (project_id, series_id, title, meeting_date, attendance, notes, position)
      VALUES (${project_id}, ${series_id || null}, ${(title || 'Meeting').slice(0, 300)}, ${meeting_date || null},
              ${String(attendance || '').slice(0, 4000)}, ${String(notes || '').slice(0, 100000)}, ${Date.now()})
      RETURNING id, project_id, series_id, title, meeting_date, attendance, notes, position`;
    return NextResponse.json(r.rows[0]);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
