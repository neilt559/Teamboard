import { handle, bad, str, parseId } from '@/lib/http';
import { query, transaction } from '@/lib/db';
import { initialMatches, QUADRANTS, SEEDS } from '@/lib/bracket';
import { loadBracketTemplate } from '@/lib/queries/brackets';
import { BRACKET_LOCK, normRegions } from './_shared';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';
export const maxDuration = 60;

// The 19 matches of a fresh bracket, with each side named by (quadrant, seed) so the insert can join them to
// the entrants it creates in the same statement.
const MATCH_SPEC = JSON.stringify(initialMatches((q, s) => ({ q, s })).map((m) => ({
  round: m.round, idx: m.idx,
  aq: m.a_id ? m.a_id.q : null, aseed: m.a_id ? m.a_id.s : null,
  bq: m.b_id ? m.b_id.q : null, bseed: m.b_id ? m.b_id.s : null,
})));

// Archive the current bracket(s), then insert the bracket, its 20 entrants and 19 matches: ONE statement
// (today it was four, not in a transaction). Upcoming auto brackets (Release 3) are left alone.
const CREATE_SQL = `
WITH arch AS (
  UPDATE brackets SET archived = true
  WHERE NOT archived AND NOT (mode = 'auto' AND activated_at IS NULL)
  RETURNING id),
nb AS (
  INSERT INTO brackets (name, regions, crown_policy, mode, created_by)
  VALUES ($1::text, $2::text, 'organizers', 'manual', $3::bigint)
  RETURNING id),
ne AS (
  INSERT INTO bracket_entrants (bracket_id, name, quadrant, seed)
  SELECT nb.id, x.name, x.quadrant, x.seed
  FROM nb CROSS JOIN json_to_recordset($4::json) AS x(name text, quadrant int, seed int)
  RETURNING id, quadrant, seed),
nm AS (
  INSERT INTO bracket_matches (bracket_id, round, idx, a_id, b_id)
  SELECT nb.id, x.round, x.idx, ea.id, eb.id
  FROM nb CROSS JOIN json_to_recordset($5::json) AS x(round int, idx int, aq int, aseed int, bq int, bseed int)
  LEFT JOIN ne ea ON ea.quadrant = x.aq AND ea.seed = x.aseed
  LEFT JOIN ne eb ON eb.quadrant = x.bq AND eb.seed = x.bseed
  RETURNING id),
au AS (
  INSERT INTO audit_log (actor_id, action, entity, entity_id, detail)
  SELECT $3::bigint, 'bracket.create', 'brackets', nb.id::text,
         jsonb_build_object('name', $1::text, 'archived', (SELECT COALESCE(jsonb_agg(arch.id), '[]'::jsonb) FROM arch))
  FROM nb)
SELECT (SELECT id FROM nb) AS id, (SELECT count(*) FROM ne)::int AS entrants, (SELECT count(*) FROM nm)::int AS matches`;

// POST /api/brackets { name, regions, entrants: [4][5], mode?, clone_from? } -> { id }
// Organizers and admins only (§4.5: new brackets are organizer-managed; crown_policy 'organizers').
// Today's rules: all 20 names required (120 chars), regions 60 chars with "Quadrant N" defaults, name
// defaults to "Office Bracket". Creating archives the current bracket (rule 26), which moves it to Past.
// Release 1 creates manual brackets only; weekly auto brackets (mode 'auto', starts_on) are Release 3.
export const POST = handle(async ({ viewer, body }) => {
  const b = await body();
  if (b.mode != null && b.mode !== 'manual') throw bad('Weekly auto-advancing brackets aren’t available yet.');
  let src = b;
  if (b.clone_from != null && !Array.isArray(b.entrants)) {
    const t = await loadBracketTemplate(parseId(b.clone_from));
    if (!t) throw bad('That bracket is gone.');
    src = { name: b.name ?? t.name, regions: b.regions ?? t.regions, entrants: t.entrants };
  }
  const grid = Array.isArray(src.entrants) ? src.entrants : [];
  const rows = [];
  for (let q = 0; q < QUADRANTS; q++) {
    for (let s = 0; s < SEEDS; s++) {
      const name = str((Array.isArray(grid[q]) ? grid[q] : [])[s], 120);
      if (!name) throw bad('All 20 spots need a name.');
      rows.push({ name, quadrant: q, seed: s + 1 });
    }
  }
  const regions = normRegions(src.regions);
  const name = str(src.name, 120) || 'Office Bracket';
  const res = await transaction([
    query('SELECT pg_advisory_xact_lock($1::bigint)', [BRACKET_LOCK]),
    query(CREATE_SQL, [name, JSON.stringify(regions), String(viewer.id), JSON.stringify(rows), MATCH_SPEC]),
  ]);
  const out = res[1].rows[0];
  return { ok: true, id: String(out.id) };
}, { auth: 'organizer', legacyWrite: true });
