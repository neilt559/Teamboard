import { neon } from '@neondatabase/serverless';

// Neon's HTTP driver runs each query as an independent, stateless request.
// fetchOptions cache:'no-store' is essential: the driver reads via fetch(), and
// Next.js otherwise caches each query's response and serves stale data forever.
let _sql;
function getSql() {
  if (!_sql) {
    const connectionString =
      process.env.DATABASE_URL ||
      process.env.POSTGRES_URL ||
      process.env.POSTGRES_PRISMA_URL;
    _sql = neon(connectionString, {
      fullResults: true,
      fetchOptions: { cache: 'no-store' },
    });
  }
  return _sql;
}

// Tagged-template passthrough so callers keep writing sql`...` and reading .rows.
export function sql(strings, ...values) {
  return getSql()(strings, ...values);
}

let schemaReady;

export async function ensureSchema() {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    await sql`CREATE TABLE IF NOT EXISTS people (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#5B5859',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
    await sql`CREATE TABLE IF NOT EXISTS teams (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      position DOUBLE PRECISION NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
    await sql`CREATE TABLE IF NOT EXISTS projects (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      position DOUBLE PRECISION NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
    await sql`CREATE TABLE IF NOT EXISTS tasks (
      id BIGSERIAL PRIMARY KEY,
      project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      title TEXT NOT NULL DEFAULT '',
      assignee_id BIGINT REFERENCES people(id) ON DELETE SET NULL,
      due_date TEXT,
      status TEXT NOT NULL DEFAULT 'not_started',
      position DOUBLE PRECISION NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;

    // Migrations for things added after the initial release (idempotent).
    await sql`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS archived BOOLEAN NOT NULL DEFAULT false`;
    await sql`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS notes TEXT NOT NULL DEFAULT ''`;
    // Subtasks: a task with a parent_id is a subtask of that task. Deleting a
    // parent cascades to its subtasks.
    await sql`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS parent_id BIGINT REFERENCES tasks(id) ON DELETE CASCADE`;
    await sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS notes TEXT NOT NULL DEFAULT ''`;
    await sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS team_id BIGINT REFERENCES teams(id) ON DELETE CASCADE`;
    await sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS archived BOOLEAN NOT NULL DEFAULT false`;
    await sql`ALTER TABLE teams ADD COLUMN IF NOT EXISTS archived BOOLEAN NOT NULL DEFAULT false`;

    // Any team-less projects (from before Teams existed) go into a default team
    // so nothing disappears from the sidebar.
    const orphan = await sql`SELECT count(*)::int AS c FROM projects WHERE team_id IS NULL`;
    if (orphan.rows[0].c > 0) {
      const existing = await sql`SELECT id FROM teams ORDER BY position ASC, id ASC LIMIT 1`;
      let teamId;
      if (existing.rows.length) {
        teamId = existing.rows[0].id;
      } else {
        const created = await sql`INSERT INTO teams (name, position) VALUES ('My Team', ${Date.now()}) RETURNING id`;
        teamId = created.rows[0].id;
      }
      await sql`UPDATE projects SET team_id=${teamId} WHERE team_id IS NULL`;
    }
  })().catch((e) => {
    schemaReady = undefined;
    throw e;
  });
  return schemaReady;
}
