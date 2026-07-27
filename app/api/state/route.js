import { NextResponse } from 'next/server';
import { sql, ensureSchema } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';

// Returns the entire board in one shot: people, projects, and tasks.
export async function GET() {
  try {
    await ensureSchema();
    const people = await sql`SELECT id, name, color FROM people ORDER BY lower(name) ASC, id ASC`;
    const projects = await sql`SELECT id, name FROM projects ORDER BY position ASC, id ASC`;
    const tasks = await sql`SELECT id, project_id, title, assignee_id, due_date, status
                            FROM tasks ORDER BY position ASC, id ASC`;
    return NextResponse.json({
      _v: 'nocache1',
      people: people.rows,
      projects: projects.rows,
      tasks: tasks.rows,
    });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
