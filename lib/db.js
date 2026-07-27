import { neon } from '@neondatabase/serverless';

// Neon's HTTP driver runs each query as an independent, stateless request.
// This avoids a quirk of the pooled (PgBouncer) connection used by
// @vercel/postgres where the first queries on a fresh connection could return
// empty rowsets. `fullResults: true` makes tagged-template queries resolve to
// { rows, rowCount, ... }, matching the shape the route handlers expect.
let _sql;
function getSql() {
  if (!_sql) {
    const connectionString =
      process.env.DATABASE_URL ||
      process.env.POSTGRES_URL ||
      process.env.POSTGRES_PRISMA_URL;
    // fetchOptions cache:'no-store' is essential: the Neon HTTP driver reads via
    // fetch(), and Next.js otherwise caches each query's response the first time
    // it runs and serves that frozen result forever — so new rows never appear.
    _sql = neon(connectionString, {
      fullResults: true,
      fetchOptions: { cache: 'no-store' },
    });
  }
  return _sql;
}

// Tagged-template passthrough so callers can keep writing sql`...` and reading
// `.rows`, while we control how the underlying client is created.
export function sql(strings, ...values) {
  return getSql()(strings, ...values);
}

// Runs the table creation once per server instance. CREATE TABLE IF NOT EXISTS
// is idempotent. If it fails (e.g. the database isn't connected yet) we clear
// the cache so a later request retries.
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
  })().catch((e) => {
    schemaReady = undefined;
    throw e;
  });
  return schemaReady;
}
