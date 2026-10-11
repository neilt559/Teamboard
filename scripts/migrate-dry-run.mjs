// Dry-run the TeamBoard migration (lib/db.js ensureSchema) against a Neon BRANCH and
// print row counts and the schema_meta ledger. Never run it against production: it
// refuses unless TB_PROD_NEON_ENDPOINT names the production endpoint id and every
// connection variable points somewhere else.
//
//   $env:TB_PROD_NEON_ENDPOINT = 'ep-xxxx'            # production endpoint id (Neon console)
//   $env:DATABASE_URL = '<branch connection string>'
//   node scripts/migrate-dry-run.mjs [--force-full]
//
// --force-full resets the branch's version row first, so the full migration batch
// runs even when the branch is already current (same guard).
import { register } from 'node:module';

// lib/db.js starts with import 'server-only'; outside Next, map it to an empty module.
register('data:text/javascript,' + encodeURIComponent(
  'export async function resolve(specifier, context, next) {' +
  "  if (specifier === 'server-only') return { url: 'data:text/javascript,', shortCircuit: true };" +
  '  return next(specifier, context);' +
  '}'));

const refuse = (msg) => {
  console.error(`REFUSED: ${msg}`);
  process.exit(2);
};
const hostOf = (v) => {
  try { return new URL(v).hostname.toLowerCase(); } catch { return ''; }
};
// Neon endpoint id = first host label, with the pooler suffix stripped:
// ep-cool-name-123456-pooler.us-east-2.aws.neon.tech -> ep-cool-name-123456
const endpointId = (host) => host.split('.')[0].replace(/-pooler$/, '');

const rawProd = (process.env.TB_PROD_NEON_ENDPOINT || '').trim().toLowerCase();
const prod = endpointId(rawProd.includes('://') ? hostOf(rawProd) : rawProd);
if (!prod) refuse('TB_PROD_NEON_ENDPOINT is not set. Set it to the production endpoint id (ep-...) from the Neon console.');
if (!/^ep-[a-z0-9-]+$/.test(prod)) refuse(`TB_PROD_NEON_ENDPOINT "${rawProd}" doesn't look like a Neon endpoint id (ep-...).`);
if (!process.env.DATABASE_URL) refuse('DATABASE_URL is not set (point it at a Neon branch).');

// lib/db.js connects through DATABASE_URL || POSTGRES_URL || POSTGRES_PRISMA_URL, and
// TB_SQL_ENDPOINT overrides the HTTP host, so every one that is set must be safe.
const targets = ['DATABASE_URL', 'POSTGRES_URL', 'POSTGRES_PRISMA_URL', 'TB_SQL_ENDPOINT']
  .filter((k) => process.env[k]);
for (const k of targets) {
  const host = hostOf(process.env[k]);
  if (!host) refuse(`${k} is not a valid URL.`);
  if (endpointId(host) === prod) refuse(`${k} points at the production endpoint (${host}).`);
}
if (process.env.VERCEL) refuse('run this locally, not on Vercel.');

const forceFull = process.argv.includes('--force-full');
const db = await import('../lib/db.js');
const t0 = Date.now();

const tableCounts = async () => {
  const t = await db.query(`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`);
  const out = {};
  for (const { tablename } of t.rows) {
    const r = await db.query(`SELECT count(*)::int AS n FROM "${tablename.replace(/"/g, '""')}"`);
    out[tablename] = r.rows[0].n;
  }
  return out;
};
const readVersion = async () => {
  try {
    const r = await db.query(`SELECT value FROM schema_meta WHERE key = 'version'`);
    return r.rows[0]?.value ?? null;
  } catch (e) {
    if (e.code === '42P01') return null;
    throw e;
  }
};

try {
  console.log(`target: ${targets.map((k) => `${k}=${hostOf(process.env[k])}`).join(', ')} (production ${prod} excluded)`);
  console.log(`code SCHEMA_VERSION: ${db.SCHEMA_VERSION}`);
  const before = await tableCounts();
  if (forceFull) {
    try {
      await db.query(`UPDATE schema_meta SET value = $1, updated_at = now() WHERE key = 'version'`,
        [`forced-full ${new Date().toISOString()}`]);
      console.log('--force-full: version row reset on this branch');
    } catch (e) {
      if (e.code !== '42P01') throw e;
    }
  }
  const stored = await readVersion();
  console.log(`branch version before: ${stored ?? '(none)'} -> ${stored === db.SCHEMA_VERSION ? 'fast path (sweeps only)' : 'full migration'}`);

  const t1 = Date.now();
  await db.ensureSchema();
  console.log(`ensureSchema() ok in ${Date.now() - t1} ms; RELEASED_AT ${db.RELEASED_AT}`);

  const after = await tableCounts();
  console.log('\nrow counts (before -> after):');
  for (const t of Object.keys(after)) {
    const b = before[t];
    console.log(`  ${t.padEnd(22)} ${String(b ?? '-').padStart(6)} -> ${String(after[t]).padStart(6)}${b === undefined ? '  (new table)' : ''}`);
  }

  const ledger = await db.query(`SELECT key, value, updated_at::text AS updated_at FROM schema_meta ORDER BY key`);
  console.log('\nschema_meta ledger:');
  for (const r of ledger.rows) console.log(`  ${r.key.padEnd(22)} ${r.value}  (${r.updated_at})`);

  const m = await db.query(`SELECT
      (SELECT count(*) FROM users WHERE username NOT LIKE 'zz!_%' ESCAPE '!')::int AS real_users,
      (SELECT count(*) FROM projects)::int AS projects,
      (SELECT count(*) FROM project_members WHERE source = 'legacy')::int AS legacy`);
  const { real_users: u, projects: p, legacy } = m.rows[0];
  console.log(`\nlegacy memberships: ${legacy} (non-zz users ${u} x projects ${p} = ${u * p} on a never-pruned copy)`);
  console.log(`\ndone in ${Date.now() - t0} ms`);
  process.exit(0);
} catch (e) {
  console.error(`FAILED: ${e.code || ''} ${e.message}`);
  process.exit(1);
}
