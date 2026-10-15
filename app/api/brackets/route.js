import { handle, bad, str, parseId, HttpError } from '@/lib/http';
import { query, transaction } from '@/lib/db';
import { initialMatches, QUADRANTS, SEEDS } from '@/lib/bracket';
import { nextMondayStatus } from '@/lib/bracket-auto';
import { loadBracketTemplate } from '@/lib/queries/brackets';
import { BRACKET_LOCK, normRegions, checkStartMonday, TAKEN_MONDAY } from './_shared';

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

// Insert the bracket, its 20 entrants and 19 matches: ONE statement (today it was four, not in a transaction).
// A manual bracket archives the current bracket(s) first (rule 26); upcoming auto brackets are left alone. A
// weekly auto bracket ($6 = its Monday) archives nothing: it is "upcoming" until its Monday, and the request
// that activates it then archives the bracket it replaces (lib/bracket-auto.js).
const CREATE_SQL = `
WITH arch AS (
  UPDATE brackets SET archived = true
  WHERE $6::text IS NULL AND NOT archived AND NOT (mode = 'auto' AND activated_at IS NULL)
  RETURNING id),
nb AS (
  INSERT INTO brackets (name, regions, crown_policy, mode, starts_on, created_by)
  VALUES ($1::text, $2::text, 'organizers', CASE WHEN $6::text IS NULL THEN 'manual' ELSE 'auto' END, $6::text, $3::bigint)
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
         jsonb_build_object('name', $1::text, 'starts_on', $6::text,
                            'archived', (SELECT COALESCE(jsonb_agg(arch.id), '[]'::jsonb) FROM arch))
  FROM nb)
SELECT (SELECT id FROM nb) AS id, (SELECT count(*) FROM ne)::int AS entrants, (SELECT count(*) FROM nm)::int AS matches`;

// POST /api/brackets { name, regions, entrants: [4][5], mode?, starts_on?, clone_from? } -> { id, mode, starts_on }
// Organizers and admins only (§4.5: new brackets are organizer-managed; crown_policy 'organizers').
// Today's rules: all 20 names required (120 chars), regions 60 chars with "Quadrant N" defaults, name
// defaults to "Office Bracket". A manual bracket archives the current one at once (rule 26), which moves it to
// Past. mode 'auto' (Release 3, design §10(c)): a weekly bracket that runs Mon-Fri from starts_on, a Monday on
// or after today (Central; default: the first Monday after today with no auto bracket). One per Monday: 409.
// Nothing is ever created without an organizer saving this form ("Repeat next Monday" only prefills it).
export const POST = handle(async ({ viewer, body, now }) => {
  const b = await body();
  const mode = b.mode == null || b.mode === '' ? 'manual' : b.mode;
  if (mode !== 'manual' && mode !== 'auto') throw bad('Pick how the bracket runs.');
  let startsOn = null;
  if (mode === 'auto') {
    startsOn = b.starts_on == null || b.starts_on === '' ? (await nextMondayStatus(now)).free_monday : String(b.starts_on);
    checkStartMonday(startsOn, now);
  }
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
  let res;
  try {
    res = await transaction([
      query('SELECT pg_advisory_xact_lock($1::bigint)', [BRACKET_LOCK]),
      query(CREATE_SQL, [name, JSON.stringify(regions), String(viewer.id), JSON.stringify(rows), MATCH_SPEC, startsOn]),
    ]);
  } catch (e) {
    if (e?.code === '23505') throw new HttpError(409, TAKEN_MONDAY);
    throw e;
  }
  const out = res[1].rows[0];
  return { ok: true, id: String(out.id), mode, starts_on: startsOn };
}, { auth: 'organizer', legacyWrite: true });
