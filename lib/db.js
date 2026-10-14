import 'server-only';
import crypto from 'node:crypto';
import { neon, neonConfig } from '@neondatabase/serverless';
import { LEGACY } from './schema/legacy.js';
import { CORE } from './schema/core.js';
import { THREADS } from './schema/threads.js';
import { PROJECTS_EXT } from './schema/projects-ext.js';
import { CULTURE } from './schema/culture.js';
import { sweeps } from './schema/sweeps.js';

// Local testing only: send queries to a local stand-in database instead of
// Neon. Never set on Vercel.
if (process.env.TB_SQL_ENDPOINT) neonConfig.fetchEndpoint = process.env.TB_SQL_ENDPOINT;

// Preview guard: a non-production Vercel deployment never connects unless it was
// pointed at a Neon branch (TB_PREVIEW_DB_OK), so agent-branch previews can't
// migrate or write the live database.
export const previewBlocked = () =>
  !!process.env.VERCEL_ENV && process.env.VERCEL_ENV !== 'production' && !process.env.TB_PREVIEW_DB_OK;

// Neon's HTTP driver runs each query as an independent, stateless request.
// fetchOptions cache:'no-store' is essential: the driver reads via fetch(), and
// Next.js otherwise caches each query's response and serves stale data forever.
let _sql;
export function getSql() {
  if (previewBlocked()) {
    const e = new Error('No database for previews');
    e.code = 'TB_PREVIEW';
    throw e;
  }
  if (!_sql) {
    const cs = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.POSTGRES_PRISMA_URL;
    _sql = neon(cs, { fullResults: true, fetchOptions: { cache: 'no-store' } });
  }
  return _sql;
}

// Tagged-template passthrough so callers keep writing sql`...` and reading .rows
// (the pre-rebuild routes use this until they are rewritten).
export function sql(strings, ...values) {
  return getSql()(strings, ...values);
}

// Dynamic SQL built from whitelists only; params are always bound.
export const query = (text, params = []) => getSql()(text, params);
// Non-interactive batch: every query in ONE HTTP request and one transaction.
export const transaction = (qs, opts = {}) =>
  getSql().transaction(qs, { isolationLevel: 'ReadCommitted', ...opts });

// Every element is { sql: '<exactly one statement>', kind: 'ddl' | 'data' }.
// PROJECTS_EXT: design-amendments A6 (project structure + weekly owner reports), after Release 2.
const STEPS = [...LEGACY, ...CORE, ...THREADS, ...PROJECTS_EXT, ...CULTURE];
// The migration is version-gated by a hash of the DDL text: any schema change
// in the code runs the full batch once; otherwise cold starts take the fast path.
export const SCHEMA_VERSION = crypto.createHash('sha256')
  .update(STEPS.map((s) => s.sql).join('\n;\n')).digest('hex').slice(0, 16);
// Epoch ms (as a string) from schema_meta 'release1_at'; drives the 48 h legacy-client grace.
export let RELEASED_AT = null;

const ADVISORY_KEY = 7342001;
// READ COMMITTED explicitly: the version re-check right after the advisory lock
// must see a commit made by the instance we waited for (a snapshot-per-transaction
// level would hide it and re-run the whole migration).
const TXN = { isolationLevel: 'ReadCommitted' };
// Plain JS strings (not sql``): the hash is hex from our own code and the table
// names are constants.
const CURRENT_CHECK = (v) => `DO $$ BEGIN
  IF to_regclass('schema_meta') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM schema_meta WHERE key = 'version' AND value = '${v}') THEN
      RAISE EXCEPTION 'schema already current' USING ERRCODE = 'TBM01';
    END IF;
  END IF;
END $$`;
const LOCK_IF_EXISTS = (t) => `DO $$ BEGIN
  IF to_regclass('${t}') IS NOT NULL THEN LOCK TABLE ${t} IN ACCESS EXCLUSIVE MODE; END IF;
END $$`;

// Lock timeout, deadlock, serialization failure, statement timeout.
const RETRYABLE = new Set(['55P03', '40P01', '40001', '57014']);

let schemaReady;

// Memoized per server instance; a failure clears the memo so the next request retries.
// ddlOnly (teamboard-testdb/restore.mjs) creates every table without seeds, ledger or sweeps.
export async function ensureSchema({ ddlOnly = false } = {}) {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    const t0 = Date.now();
    for (let attempt = 1; ; attempt++) {
      try {
        return await migrateOnce(ddlOnly);
      } catch (e) {
        // Stays inside the routes' maxDuration of 60 s.
        if (!RETRYABLE.has(e.code) || attempt >= 3 || Date.now() - t0 > 40_000) throw e;
        await new Promise((r) => setTimeout(r, 300 * attempt));
      }
    }
  })().catch((e) => {
    schemaReady = undefined;
    throw e;
  });
  return schemaReady;
}

async function readMeta(s) {
  try {
    const r = await s`SELECT key, value FROM schema_meta WHERE key IN ('version', 'release1_at')`;
    return Object.fromEntries(r.rows.map((x) => [x.key, x.value]));
  } catch (e) {
    if (e.code === '42P01') return {};   // first deploy: table not created yet
    throw e;
  }
}

async function migrateOnce(ddlOnly) {
  const s = getSql();
  if (!ddlOnly) {
    // Fast path, request 1: the version only.
    const m = await readMeta(s);
    if (m.version === SCHEMA_VERSION) {
      RELEASED_AT = m.release1_at ?? null;
      // Request 2, only once the schema is known current.
      await s.transaction(sweeps(s, { standalone: true }), TXN);
      return;
    }
  }
  const steps = STEPS.filter((x) => !ddlOnly || x.kind === 'ddl');
  try {
    const res = await s.transaction([
      // Bounds the wait behind another instance's migration.
      s`SET LOCAL lock_timeout = '25s'`,
      // Serializes concurrent cold starts.
      s`SELECT pg_advisory_xact_lock(${ADVISORY_KEY}::bigint)`,
      // TBM01 when another instance already migrated while we waited.
      ...(ddlOnly ? [] : [s(CURRENT_CHECK(SCHEMA_VERSION), [])]),
      // Never queue behind live reads for long; retried by ensureSchema.
      s`SET LOCAL lock_timeout = '5s'`,
      // The first two locks, taken in the same order as every session lookup
      // (sessions, then users), so a lookup can't deadlock with the migration.
      s(LOCK_IF_EXISTS('sessions'), []),
      s(LOCK_IF_EXISTS('users'), []),
      ...steps.map((x) => s(x.sql, [])),
      ...(ddlOnly ? [] : [
        ...sweeps(s, { standalone: false }),
        s`INSERT INTO schema_meta (key, value)
            VALUES ('release1_at', (extract(epoch FROM now()) * 1000)::bigint::text) ON CONFLICT (key) DO NOTHING`,
        s`INSERT INTO schema_meta (key, value) VALUES ('version', ${SCHEMA_VERSION}::text)
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
        s`SELECT value FROM schema_meta WHERE key = 'release1_at'`,
      ]),
    ], TXN);
    if (!ddlOnly) RELEASED_AT = res.at(-1).rows[0]?.value ?? null;
  } catch (e) {
    if (e.code !== 'TBM01') throw e;
    // Another instance finished while we waited: success, and its batch already ran the sweeps.
    RELEASED_AT = (await readMeta(s)).release1_at ?? null;
  }
}
