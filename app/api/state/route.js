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
    const offices = await sql`SELECT id, name, position, archived FROM offices ORDER BY position ASC, id ASC`;
    const teams = await sql`SELECT id, name, office_id, position, archived FROM teams ORDER BY position ASC, id ASC`;
    const projects = await sql`SELECT id, team_id, name, notes, position, archived FROM projects ORDER BY position ASC, id ASC`;
    const tasks = await sql`SELECT id, project_id, parent_id, title, assignee_id, due_date, status, archived, notes, stoplight
                            FROM tasks ORDER BY position ASC, id ASC`;
    const info = await sql`SELECT id, project_id, label, value, position FROM project_info ORDER BY position ASC, id ASC`;
    const meetings = await sql`SELECT id, office_id, title, meeting_date, minutes, position FROM meetings ORDER BY meeting_date DESC NULLS LAST, id DESC`;
    const geo = await sql`SELECT id, office_id, score, score_date FROM geo_scores ORDER BY score_date ASC NULLS LAST, id ASC`;
    const pseries = await sql`SELECT id, project_id, name, position FROM meeting_series ORDER BY position ASC, id ASC`;
    const pmeetings = await sql`SELECT id, project_id, series_id, title, meeting_date, attendance, notes, position FROM project_meetings ORDER BY meeting_date DESC NULLS LAST, id DESC`;
    return NextResponse.json({
      people: people.rows,
      offices: offices.rows,
      teams: teams.rows,
      projects: projects.rows,
      tasks: tasks.rows,
      info: info.rows,
      meetings: meetings.rows,
      geo: geo.rows,
      pseries: pseries.rows,
      pmeetings: pmeetings.rows,
    });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
