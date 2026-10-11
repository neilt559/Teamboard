import 'server-only';
import { query } from './db.js';

// audit_log helpers (design §3.2 step 11, §13 #12). Hard deletes keep a JSON snapshot of what they removed,
// written in the SAME statement as the delete, so a delete can never happen without its record.

const NAME = /^[a-z_][a-z0-9_]*$/;

// One audit row, as a lazy query: await it, or put it in a transaction([...]) batch.
//   await auditStmt(viewer.id, 'office.create', 'offices', row.id, { name });
export const auditStmt = (actorId, action, entity, entityId, detail = {}) => query(
  `INSERT INTO audit_log (actor_id, action, entity, entity_id, detail) VALUES ($1, $2, $3, $4, $5::jsonb)`,
  [actorId == null ? null : String(actorId), String(action), String(entity), entityId == null ? null : String(entityId),
    JSON.stringify(detail ?? {})]);
export async function audit(actorId, action, entity, entityId, detail) {
  await auditStmt(actorId, action, entity, entityId, detail);
}

// Hard delete of one row plus its JSON snapshot in one statement.
//   table, children: constants from the route, never input. children = { tasks: { table: 'tasks', fk: 'project_id' } }
//     adds every child row (they go with the cascade) to the snapshot under that key.
//   scopeSql / scopeParams: as in guardedPatch ($1..$n are the scope params), e.g.
//     'tb_can_see_project($1::bigint, project_id)' with [viewer.id].
//   bumpProjectRev: the row has project_id; bump that project's rev.
// Returns { deleted, existed }: deleted = rows removed (0 or 1); existed = whether the id exists at all, so
// a route can tell "already gone" ({ ok: true }) from "not yours to delete" (404).
export async function deleteWithSnapshot({ table, id, actorId, action, scopeSql = '', scopeParams = [], children = {},
                                           bumpProjectRev = false }) {
  if (!NAME.test(table)) throw new Error(`deleteWithSnapshot: bad table ${table}`);
  const kids = Object.entries(children).map(([key, c]) => {
    if (!NAME.test(key) || !NAME.test(c.table) || !NAME.test(c.fk)) throw new Error(`deleteWithSnapshot: bad child ${key}`);
    return `, '${key}', COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM ${c.table} c WHERE c.${c.fk} = s.id), '[]'::jsonb)`;
  }).join('');
  const params = [...scopeParams];
  const p = (v) => { params.push(v); return `$${params.length}`; };
  const idp = p(String(id));
  const actor = p(actorId == null ? null : String(actorId));
  const act = p(String(action));
  const r = await query(
    `WITH s AS (SELECT * FROM ${table} WHERE id = ${idp}::bigint${scopeSql ? ` AND (${scopeSql})` : ''}),
     d AS (DELETE FROM ${table} t USING s WHERE t.id = s.id RETURNING t.id${bumpProjectRev ? ', t.project_id' : ''}),
     a AS (INSERT INTO audit_log (actor_id, action, entity, entity_id, detail)
           SELECT ${actor}::bigint, ${act}::text, '${table}', s.id::text, jsonb_build_object('row', to_jsonb(s)${kids})
           FROM s JOIN d ON d.id = s.id)${bumpProjectRev
      ? `,
     pr AS (UPDATE projects SET rev = rev + 1 WHERE id IN (SELECT project_id FROM d))` : ''}
     SELECT (SELECT count(*) FROM d)::int AS deleted,
            EXISTS (SELECT 1 FROM ${table} WHERE id = ${idp}::bigint) AS existed`, params);
  return { deleted: Number(r.rows[0]?.deleted || 0), existed: !!r.rows[0]?.existed };
}
