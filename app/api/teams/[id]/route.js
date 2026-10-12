import { handle, HttpError, parseId, str, bad, forbidden, gone } from '@/lib/http';
import { query } from '@/lib/db';
import { guardedPatch, norm } from '@/lib/patch';
import { canManageTeamsIn } from '@/lib/access';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';
export const maxDuration = 60;

const has = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);
const shapeTeam = (t) => ({
  id: String(t.id), name: t.name, office_id: t.office_id == null ? null : String(t.office_id),
  position: Number(t.position), archived: !!t.archived,
});

// PATCH /api/teams/:id {name?, archived?, office_id?, position?, base?: {name?}} (design §8.2, §4.5).
//   Every change needs team rights in the team's office (canManageTeamsIn: L2 in their own offices, L3+
//   anywhere); a move also needs them in the target office, which must be active ("Off -> Off" for L2).
//   name is trimmed, required and base-compared (409 on a stale base); archived, office_id and position are
//   last-write-wins. position stays accepted for tabs left open across the deploy (their ▲/▼ sends it);
//   new pages reorder through POST /api/teams/reorder.
//   A move to another office keeps the §4.3 invariant (users.team_id only points at a team in the user's own
//   offices, so team-thread access can't cross offices): in the SAME statement as the move, members whose home
//   and extra offices don't include the target office lose the team, with an audit row (as revokeOffice and the
//   admin office change do). -> { ok, row, team_cleared } (team_cleared = how many members lost the team).
export const PATCH = handle(async ({ viewer, params, body, now }) => {
  const id = parseId(params.id);
  const b = await body();
  const cur = (await query(`SELECT id, office_id, archived FROM teams WHERE id = $1::bigint`, [id])).rows[0];
  if (!cur) throw gone();
  if (!canManageTeamsIn(viewer, cur.office_id)) throw forbidden('Only project engineers and up in this office can change its teams.');

  const columns = {};
  const patch = {};
  if (has(b, 'name')) {
    const name = str(b.name, 200);
    if (!name) throw bad('Name required.');
    columns.name = { type: 'text', text: true, norm: norm.line(200) };
    patch.name = name;
  }
  if (has(b, 'archived')) {
    columns.archived = { type: 'boolean' };
    patch.archived = !!b.archived;
  }
  let moveTo = null;                                         // a real move: done below, with the member cleanup
  if (has(b, 'office_id')) {
    if (b.office_id == null || b.office_id === '') throw bad('Pick an office.');
    const target = parseId(b.office_id);
    if (String(target) !== String(cur.office_id)) {
      if (!canManageTeamsIn(viewer, target)) throw forbidden('You can only move teams into offices where you manage teams.');
      const ok = (await query(`SELECT 1 FROM offices WHERE id = $1::bigint AND NOT archived`, [target])).rows[0];
      if (!ok) throw new HttpError(404, 'Office not found');
      moveTo = String(target);
    }
  }
  if (has(b, 'position')) {
    const pos = Number(b.position);
    if (!Number.isFinite(pos)) throw bad('Invalid position.');
    columns.position = { type: 'float8' };
    patch.position = pos;
  }
  if (has(b, 'base')) patch.base = b.base;

  const from = cur.office_id == null ? null : String(cur.office_id);
  let { row } = await guardedPatch({
    table: 'teams', id, body: patch, columns, actorId: viewer.id, now,
    // The rights were checked against this office; if the team moved meanwhile, answer "gone" instead.
    scopeSql: 'office_id IS NOT DISTINCT FROM $1::bigint', scopeParams: [from],
  });
  let teamCleared = 0;
  if (moveTo) {
    // One statement: move the team (still only from the office the rights were checked against), clear the team
    // of members who can't be in it any more, and audit both. The first CTE references users so this statement
    // takes its users lock before the teams one (the migration locks sessions, then users: §3.1).
    const r = await query(
      `WITH lk AS (SELECT u.id FROM users u WHERE u.team_id = $1::bigint FOR UPDATE),
       t AS (UPDATE teams SET office_id = $2::bigint WHERE id = $1::bigint AND office_id IS NOT DISTINCT FROM $3::bigint
             RETURNING id, name, office_id, position, archived),
       c AS (UPDATE users u SET team_id = NULL, updated_at = now() FROM t
             WHERE u.id IN (SELECT id FROM lk) AND u.team_id = t.id AND u.office_id IS DISTINCT FROM t.office_id
               AND NOT EXISTS (SELECT 1 FROM user_offices x
                               WHERE x.user_id = u.id AND x.office_id = t.office_id AND x.revoked_at IS NULL)
             RETURNING u.id),
       a AS (INSERT INTO audit_log (actor_id, action, entity, entity_id, detail)
             SELECT $4::bigint, 'team.move', 'teams', t.id::text,
                    jsonb_build_object('from', $3::bigint, 'to', t.office_id,
                      'team_cleared_user_ids', COALESCE((SELECT jsonb_agg(c.id ORDER BY c.id) FROM c), '[]'::jsonb))
             FROM t)
       SELECT t.*, (SELECT count(*) FROM c)::int AS team_cleared FROM t`,
      [String(id), moveTo, from, String(viewer.id)]);
    const moved = r.rows[0];
    if (!moved) throw gone();                                 // deleted or moved by someone else meanwhile
    row = moved;
    teamCleared = Number(moved.team_cleared || 0);
  }
  return { ok: true, row: shapeTeam(row), team_cleared: teamCleared };
}, { legacyWrite: true });

// DELETE /api/teams/:id: admins only (two confirms in the UI). One statement deletes the team (its projects
// and everything in them cascade; members' team is cleared by the FK) and writes a JSON snapshot of all of
// it to audit_log, so the delete can never happen without its record (§13 #12). Already gone -> { ok: true }.
export const DELETE = handle(async ({ viewer, params }) => {
  const id = parseId(params.id);
  // A reference that refuses the delete (threads.team_id is ON DELETE RESTRICT from Release 2) rolls the whole
  // statement back, snapshot included, and answers 409.
  const r = await query(
    `WITH s AS (SELECT * FROM teams WHERE id = $1::bigint),
     pr AS (SELECT p.* FROM projects p WHERE p.team_id IN (SELECT id FROM s)),
     snap AS (SELECT jsonb_build_object(
         'row', (SELECT to_jsonb(s) FROM s),
         'projects', COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM pr p), '[]'::jsonb),
         'tasks', COALESCE((SELECT jsonb_agg(to_jsonb(k) ORDER BY k.id) FROM tasks k
                            WHERE k.project_id IN (SELECT id FROM pr)), '[]'::jsonb),
         'project_info', COALESCE((SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) FROM project_info i
                                   WHERE i.project_id IN (SELECT id FROM pr)), '[]'::jsonb),
         'meeting_series', COALESCE((SELECT jsonb_agg(to_jsonb(ms) ORDER BY ms.id) FROM meeting_series ms
                                     WHERE ms.project_id IN (SELECT id FROM pr)), '[]'::jsonb),
         'project_meetings', COALESCE((SELECT jsonb_agg(to_jsonb(pm) ORDER BY pm.id) FROM project_meetings pm
                                       WHERE pm.project_id IN (SELECT id FROM pr)), '[]'::jsonb),
         'project_members', COALESCE((SELECT jsonb_agg(to_jsonb(pmb) ORDER BY pmb.project_id, pmb.user_id)
                                      FROM project_members pmb WHERE pmb.project_id IN (SELECT id FROM pr)), '[]'::jsonb),
         'member_user_ids', COALESCE((SELECT jsonb_agg(u.id ORDER BY u.id) FROM users u
                                      WHERE u.team_id IN (SELECT id FROM s)), '[]'::jsonb)) AS detail),
     d AS (DELETE FROM teams t USING s WHERE t.id = s.id RETURNING t.id),
     a AS (INSERT INTO audit_log (actor_id, action, entity, entity_id, detail)
           SELECT $2::bigint, 'team.delete', 'teams', d.id::text, snap.detail FROM d CROSS JOIN snap)
     SELECT (SELECT count(*) FROM d)::int AS deleted`,
    [id, String(viewer.id)]).catch((e) => {
    if (e?.code === '23503') throw new HttpError(409, 'This team still has threads or other records that need it. Archive it instead.');
    throw e;
  });
  return { ok: true, deleted: Number(r.rows[0]?.deleted || 0) };
}, { auth: 'admin', legacyWrite: true });
