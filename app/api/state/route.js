import { NextResponse } from 'next/server';
import { sql, ensureSchema } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Returns the entire board in one shot: people, projects, and tasks.
export async function GET() {
  try {
    await ensureSchema();
    // Run sequentially, not via Promise.all: the @vercel/postgres pooled `sql`
    // helper can return empty rowsets when several queries fire concurrently.
    const people = await sql`SELECT id, name, color FROM people ORDER BY lower(name) ASC, id ASC`;
    const projects = await sql`SELECT id, name FROM projects ORDER BY position ASC, id ASC`;
    const tasks = await sql`SELECT id, project_id, title, assignee_id, due_date, status
                            FROM tasks ORDER BY position ASC, id ASC`;
    const diag = await sql`SELECT current_database() AS db, (SELECT count(*) FROM projects) AS pc`;
    const hostOf = (u) => { try { return new URL(u).host; } catch { return null; } };
    return NextResponse.json({
      _build: 'http-v3',
      people: people.rows,
      projects: projects.rows,
      tasks: tasks.rows,
      _diag: {
        db: diag.rows[0].db,
        projectCount: diag.rows[0].pc,
        pgHost: hostOf(process.env.POSTGRES_URL),
        dbHost: hostOf(process.env.DATABASE_URL),
      },
    });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
