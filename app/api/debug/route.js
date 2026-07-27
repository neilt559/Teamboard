import { NextResponse } from 'next/server';
import { sql, ensureSchema } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// TEMPORARY diagnostic endpoint. Shows how the deployment is wired to the DB
// and whether a freshly inserted row is visible in the same request.
// Delete this route once the issue is resolved.
function hostOf(u) {
  try { return new URL(u).host; } catch { return null; }
}

export async function GET() {
  const info = {
    env: {
      POSTGRES_URL: !!process.env.POSTGRES_URL,
      DATABASE_URL: !!process.env.DATABASE_URL,
      POSTGRES_PRISMA_URL: !!process.env.POSTGRES_PRISMA_URL,
      POSTGRES_URL_NON_POOLING: !!process.env.POSTGRES_URL_NON_POOLING,
      DATABASE_URL_UNPOOLED: !!process.env.DATABASE_URL_UNPOOLED,
    },
    hosts: {
      POSTGRES_URL: hostOf(process.env.POSTGRES_URL),
      DATABASE_URL: hostOf(process.env.DATABASE_URL),
    },
  };
  try {
    await ensureSchema();
    const db = await sql`SELECT current_database() AS db, current_schema() AS schema, version() AS version`;
    info.db = db.rows[0];

    const ins = await sql`INSERT INTO projects (name, position) VALUES ('__DEBUG_COMMIT_TEST__', ${Date.now()}) RETURNING id`;
    const id = ins.rows[0].id;
    const back = await sql`SELECT id FROM projects WHERE id=${id}`;
    info.insertedId = id;
    info.visibleAfterInsert = back.rows.length > 0;

    const counts = await sql`SELECT
      (SELECT count(*) FROM projects) AS projects,
      (SELECT count(*) FROM people) AS people`;
    info.counts = counts.rows[0];

    // Compare sequential vs concurrent (Promise.all) row reads to confirm cause.
    const seq = await sql`SELECT id FROM projects ORDER BY position ASC, id ASC`;
    info.seqProjectRows = seq.rows.length;
    const [pa, pb] = await Promise.all([
      sql`SELECT id FROM people ORDER BY id ASC`,
      sql`SELECT id FROM projects ORDER BY position ASC, id ASC`,
    ]);
    info.concProjectRows = pb.rows.length;
    info.concPeopleRows = pa.rows.length;

    await sql`DELETE FROM projects WHERE id=${id}`;
  } catch (e) {
    info.error = e.message;
  }
  return NextResponse.json(info);
}
