import 'server-only';
import { query } from './db.js';
import { HttpError, gone, inLegacyGrace, str } from './http.js';

// Column-level PATCH with conflict detection (design §7.1-7.3).
// Text fields carry the value the user started from in body.base; the UPDATE applies only while the column
// still equals that base, or already equals the new value (a retried save, or two people making the same fix).
// Otherwise: 409 with the current row. Discrete fields (status, dates, owner, flags) stay last-write-wins.
// Different fields still merge, as today (rule 32): only the keys present in the body are written.

// Which audit columns guardedPatch may stamp, per table. migrate.test asserts each listed column exists (§14.1).
// The table name is always a constant from this map, never input.
export const AUDIT = {
  tasks: 'full', projects: 'full', project_info: 'full', meetings: 'full', project_meetings: 'full',
  meeting_series: 'full', brackets: 'full', bracket_entrants: 'full', threads: 'full', thread_posts: 'full',
  culture_challenges: 'full', culture_events: 'full', culture_entries: 'at', users: 'at',
  offices: 'none', teams: 'none', people: 'none', suggestions: 'none',
};

// Normalizers. The SAME function produces the stored value and normalizes the client's base, so text that
// differs from the stored text only by normalization (a trailing space, a blank title) never conflicts.
export const norm = {
  line: (max) => (v) => str(v, max),                          // single-line: trimmed, capped
  text: (max) => (v) => str(v, max, { trim: false }),         // multi-line: capped only (newlines kept)
  lineOr: (max, fallback) => (v) => str(v, max) || fallback,  // blank -> 'Meeting' / 'Series', as today
};

const NAME = /^[a-z_][a-z0-9_]*$/;
const TYPES = new Set(['text', 'bigint', 'integer', 'smallint', 'boolean', 'float8', 'numeric', 'timestamptz', 'jsonb']);
const has = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);

// guardedPatch({ table, id, body, columns, actorId, scopeSql, scopeParams, bumpProjectRev, now, returning, notFound })
//   columns: whitelist { name: { type: 'text' | 'bigint' | 'boolean' | ..., text: true|false, norm: (v) => stored } }.
//            text: true = base-compared (type must be 'text'); norm is applied to the new value AND the base.
//            Validation (allowed statuses, hex colors, ...) happens in the route, before this call; a norm may
//            throw HttpError too.
//   scopeSql: extra WHERE condition on the row, using $1..$n for scopeParams (they are bound first), e.g.
//            'tb_can_see_project($1::bigint, project_id)' with scopeParams [viewer.id].
//   bumpProjectRev: projects bump rev in the same SET list; child tables (tasks, project_info,
//            project_meetings, meeting_series) bump their project's rev in a CTE.
//   returning: column list for the RETURNING clause (required for users: never return password hashes or
//            photo blobs). Default every column. The route still masks anything private before replying
//            (e.g. suggestions.user_id on anonymous posts, rule 28); 409 `current` is the same row shape.
//   now: epoch ms (for the 48 h missing-base grace); notFound: error for a missing or hidden row.
// Returns { row } (the stored row plus updated_by_name on 'full' tables), or throws:
//   404 gone (missing, or not visible), 409 { error: 'conflict', message, fields, current },
//   428 { code: 'base_required' } for a text field without base once the grace is over.
export async function guardedPatch({ table, id, body, columns, actorId, scopeSql = '', scopeParams = [],
                                     bumpProjectRev = false, now = Date.now(), returning, notFound }) {
  const audit = AUDIT[table];
  if (!audit) throw new Error(`guardedPatch: table ${table} is not in AUDIT`);
  if (table === 'users' && !returning) throw new Error('guardedPatch: users needs an explicit returning list');
  for (const [c, spec] of Object.entries(columns)) {
    if (!NAME.test(c) || !TYPES.has(spec.type) || (spec.text && spec.type !== 'text')) {
      throw new Error(`guardedPatch: bad column spec ${c}`);
    }
  }
  const missing = notFound || gone();
  const base = body?.base && typeof body.base === 'object' ? body.base : {};
  const fields = Object.keys(columns).filter((c) => c !== 'base' && has(body, c));

  // What the conflict check and the client need back.
  let ret = '*';
  if (returning) {
    const cols = new Set(['id', ...returning]);
    if (audit !== 'none') cols.add('updated_at');
    if (audit === 'full') cols.add('updated_by');
    if (bumpProjectRev && table !== 'projects') cols.add('project_id');
    for (const f of fields) cols.add(f);
    for (const c of cols) if (!NAME.test(c)) throw new Error(`guardedPatch: bad returning column ${c}`);
    ret = [...cols].join(', ');
  }
  const nameSql = audit === 'full'
    ? `, (SELECT COALESCE(NULLIF(x.display_name, ''), x.username) FROM users x WHERE x.id = r.updated_by) AS updated_by_name`
    : '';

  const scopeAt = scopeParams.length;
  const reselect = async () => {
    const params = [...scopeParams, String(id)];
    const r = await query(
      `SELECT r.*${nameSql} FROM (SELECT ${ret} FROM ${table}
         WHERE id = $${scopeAt + 1}::bigint${scopeSql ? ` AND (${scopeSql})` : ''}) r`, params);
    return r.rows[0] || null;
  };
  if (!fields.length) {
    const row = await reselect();
    if (!row) throw missing;
    return { row };
  }

  // Normalize in JS before binding; every parameter carries its whitelisted cast.
  const params = [...scopeParams];
  const p = (v) => { params.push(v); return `$${params.length}`; };
  const set = [];
  const guards = [];
  const compared = [];                                        // [{ f, next, base }]
  for (const f of fields) {
    const spec = columns[f];
    let v = spec.norm ? spec.norm(body[f]) : body[f];
    if (v === undefined) v = null;
    if (spec.type === 'jsonb' && v != null) v = JSON.stringify(v);
    const ph = p(v);
    set.push(`${f} = ${ph}::${spec.type}`);
    if (!spec.text) continue;
    if (has(base, f)) {
      const b = spec.norm ? spec.norm(base[f]) : base[f];
      const pb = p(b == null ? null : String(b));
      guards.push(`(COALESCE(${f}, '') = COALESCE(${pb}::text, '') OR COALESCE(${f}, '') = COALESCE(${ph}::text, ''))`);
      compared.push({ f, next: v == null ? '' : String(v), base: b == null ? '' : String(b) });
    } else if (!inLegacyGrace(now)) {
      throw new HttpError(428, 'TeamBoard was updated — reload the page to keep editing.', { code: 'base_required' });
    }
  }
  if (audit === 'full') set.push('updated_at = now()', `updated_by = ${p(actorId == null ? null : String(actorId))}::bigint`);
  if (audit === 'at') set.push('updated_at = now()');
  if (bumpProjectRev && table === 'projects') set.push('rev = rev + 1');
  const where = [`id = ${p(String(id))}::bigint`];
  if (scopeSql) where.push(`(${scopeSql})`);
  where.push(...guards);
  const childRev = bumpProjectRev && table !== 'projects'
    ? `, pr AS (UPDATE projects SET rev = rev + 1 WHERE id = (SELECT project_id FROM r))` : '';
  const text = `WITH r AS (UPDATE ${table} SET ${set.join(', ')} WHERE ${where.join(' AND ')} RETURNING ${ret})${childRev}
    SELECT r.*${nameSql} FROM r`;

  for (let attempt = 1; ; attempt++) {
    const row = (await query(text, params)).rows[0];
    if (row) return { row };
    // Nothing updated: the row is gone or hidden (404), or a text field moved on since its base (409).
    const cur = await reselect();
    if (!cur) throw missing;
    const fieldsHit = compared.filter(({ f, next, base: b }) => {
      const stored = cur[f] == null ? '' : String(cur[f]);
      return stored !== b && stored !== next;
    }).map((c) => c.f);
    if (!fieldsHit.length && attempt < 2) continue;           // it moved back meanwhile: try once more
    const who = cur.updated_by != null && String(cur.updated_by) === String(actorId)
      ? 'You changed this in another window while you were editing.'
      : `${cur.updated_by_name || 'Someone else'} changed this while you were editing.`;
    throw new HttpError(409, 'conflict', { message: who, fields: fieldsHit, current: cur });
  }
}
