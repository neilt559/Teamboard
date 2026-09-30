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
    const offices = await sql`SELECT id, name, position, archived, fivek FROM offices ORDER BY position ASC, id ASC`;
    const teams = await sql`SELECT id, name, office_id, position, archived FROM teams ORDER BY position ASC, id ASC`;
    const projects = await sql`SELECT id, team_id, name, notes, position, archived FROM projects ORDER BY position ASC, id ASC`;
    const tasks = await sql`SELECT id, project_id, parent_id, title, assignee_id, due_date, status, archived, notes, stoplight, created_at
                            FROM tasks ORDER BY position ASC, id ASC`;
    const info = await sql`SELECT id, project_id, label, value, position FROM project_info ORDER BY position ASC, id ASC`;
    const meetings = await sql`SELECT id, office_id, title, meeting_date, minutes, position FROM meetings ORDER BY meeting_date DESC NULLS LAST, id DESC`;
    const geo = await sql`SELECT id, office_id, score, score_date FROM geo_scores ORDER BY score_date ASC NULLS LAST, id ASC`;
    const pseries = await sql`SELECT id, project_id, name, position FROM meeting_series ORDER BY position ASC, id ASC`;
    const pmeetings = await sql`SELECT id, project_id, series_id, title, meeting_date, attendance, notes, position FROM project_meetings ORDER BY meeting_date DESC NULLS LAST, id DESC`;
    // Brackets: every bracket's summary (for the history list), but entrants,
    // matches and votes only for current (non-archived) ones to keep polls light.
    const users = await sql`SELECT id, username, avatar_v FROM users ORDER BY username ASC`;
    const brackets = await sql`SELECT b.id, b.office_id, b.name, b.notes, b.regions, b.champion_id, b.archived, b.created_at, b.completed_at, e.name AS champion_name
                               FROM brackets b LEFT JOIN bracket_entrants e ON e.id = b.champion_id
                               ORDER BY b.created_at DESC, b.id DESC`;
    const bentrants = await sql`SELECT e.id, e.bracket_id, e.name, e.quadrant, e.seed
                                FROM bracket_entrants e JOIN brackets b ON b.id = e.bracket_id WHERE NOT b.archived`;
    const bmatches = await sql`SELECT m.id, m.bracket_id, m.round, m.idx, m.a_id, m.b_id, m.winner_id
                               FROM bracket_matches m JOIN brackets b ON b.id = m.bracket_id WHERE NOT b.archived`;
    const bvotes = await sql`SELECT v.match_id, v.user_id, v.entrant_id
                             FROM bracket_votes v JOIN bracket_matches m ON m.id = v.match_id
                             JOIN brackets b ON b.id = m.bracket_id WHERE NOT b.archived
                             ORDER BY v.created_at ASC`;
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
      users: users.rows,
      brackets: brackets.rows,
      bentrants: bentrants.rows,
      bmatches: bmatches.rows,
      bvotes: bvotes.rows,
    });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
