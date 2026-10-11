import { CATEGORIES } from '../suggestions.js';

// Today's every-cold-start cleanups (design §3.4), as one batch of statements.
// lib/db.js runs them on every cold start, but only once the schema version is
// known current: standalone (fast path) in their own transaction behind a SHARED
// advisory lock, so they wait for any migration in progress instead of running
// beside it; or at the end of a full migration, which already holds the lock.
// They reference only columns that exist on live today.
// Projects are re-homed before teams, so a just-created "My Team" gets an office
// in the same pass, and orphans always land in an ACTIVE parent when one exists.
export const sweeps = (s, { standalone }) => [
  ...(standalone ? [
    s`SET LOCAL lock_timeout = '20s'`,
    s`SELECT pg_advisory_xact_lock_shared(${7342001}::bigint)`,
  ] : []),
  // Brackets are company-wide; office_id is a leftover that must stay NULL so
  // deleting an office can never take a bracket with it.
  s`UPDATE brackets SET office_id = NULL WHERE office_id IS NOT NULL`,
  // File any idea in a retired category under Other (one source of truth: CATEGORIES).
  s`UPDATE suggestions SET category = 'other' WHERE category <> ALL(${CATEGORIES.map((c) => c.key)}::text[])`,
  // Nothing disappears: team-less projects go into a team, office-less teams into an office.
  s`INSERT INTO teams (name, position) SELECT 'My Team', ${Date.now()}::float8
     WHERE EXISTS (SELECT 1 FROM projects WHERE team_id IS NULL) AND NOT EXISTS (SELECT 1 FROM teams)`,
  s`UPDATE projects SET team_id = (SELECT id FROM teams ORDER BY archived ASC, position ASC, id ASC LIMIT 1)
     WHERE team_id IS NULL`,
  // A fallback office never joins GeoGuessr on its own (geo_on = false).
  s`INSERT INTO offices (name, position, geo_on) SELECT 'Main Office', ${Date.now()}::float8, false
     WHERE EXISTS (SELECT 1 FROM teams WHERE office_id IS NULL) AND NOT EXISTS (SELECT 1 FROM offices)`,
  s`UPDATE teams SET office_id = (SELECT id FROM offices ORDER BY archived ASC, position ASC, id ASC LIMIT 1)
     WHERE office_id IS NULL`,
];
