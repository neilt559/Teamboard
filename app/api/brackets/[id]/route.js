import { handle, parseId, notFound, forbidden, bad, HttpError } from '@/lib/http';
import { query, transaction } from '@/lib/db';
import { bracketPolicy, isAdmin, isOrganizer } from '@/lib/access';
import { guardedPatch, norm } from '@/lib/patch';
import { loadBracket, CURRENT_SQL } from '@/lib/queries/brackets';
import { advanceDueBrackets } from '@/lib/bracket-auto';
import { BRACKET_LOCK, normRegions, checkStartMonday, TAKEN_MONDAY } from '../_shared';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';
export const maxDuration = 60;

const has = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);
// Bracket notes are stored as typed (no trim, today); a generous cap keeps one save under the body limit.
const NOTES_MAX = 100_000;

async function readBracket(id) {
  const r = await query(
    `SELECT id, archived, deleted_at, mode, crown_policy, activated_at, starts_on FROM brackets WHERE id = $1::bigint`,
    [id]);
  const b = r.rows[0];
  return b ? { ...b, id: String(b.id), archived: !!b.archived } : null;
}

// GET /api/brackets/:id -> { bracket, entrants, matches, votes, users, is_current } for any bracket that
// isn't soft-deleted (current or past), or 404 "Bracket not found".
export const GET = handle(async ({ viewer, params, now }) => {
  const id = parseId(params.id);
  const d = await loadBracket(viewer, id, now);
  if (!d) throw notFound('Bracket not found');
  return { bracket: d.bracket, entrants: d.entrants, matches: d.matches, votes: d.votes, users: d.users, is_current: d.is_current };
});

// PATCH /api/brackets/:id
//   { name?, notes?, regions?, base?: { name?, notes? } }  edit (bracketPolicy.canEdit; name and notes are
//        base-compared, §7.1; regions stay last-write-wins). Returns { ok, row }.
//   { deleted: false }   admin restore of a soft-deleted bracket. If another bracket is live by then, the
//        restored one goes to Past brackets (archived) so there is still one current bracket (rule 26).
//   { archived: false }  admin un-archive; 409 while a different bracket is live.
//   { starts_on }        weekly auto bracket, organizers: move (postpone) its start while it is upcoming, to
//        another free Monday from today on (design §10(c) organizer overrides). 409 once it has started.
//   { mode: 'manual' }   weekly auto bracket that has started, organizers: switch to manual crowning for good
//        (one-way). Rounds already decided stay; organizers crown the rest one round at a time.
export const PATCH = handle(async ({ viewer, params, body, now }) => {
  const id = parseId(params.id);
  const b = await body();
  if (has(b, 'starts_on') || has(b, 'mode')) await advanceDueBrackets(now);   // a Monday that just came starts it
  const row = await readBracket(id);
  if (!row) throw notFound('Bracket not found');
  const out = { ok: true };

  if (has(b, 'starts_on')) {
    if (row.deleted_at) throw notFound('Bracket not found');
    if (!isOrganizer(viewer)) throw forbidden('Only culture organizers can reschedule brackets.');
    if (row.mode !== 'auto') throw new HttpError(409, 'Only a weekly bracket has a start Monday.');
    if (row.activated_at || row.archived) throw new HttpError(409, 'This bracket has already started.');
    const day = checkStartMonday(b.starts_on, now);
    let r;
    try {
      r = await query(
        `WITH u AS (
           UPDATE brackets SET starts_on = $2::text, updated_at = $4::timestamptz, updated_by = $3::bigint
           WHERE id = $1::bigint AND mode = 'auto' AND activated_at IS NULL AND NOT archived AND deleted_at IS NULL
           RETURNING id, starts_on),
         a AS (INSERT INTO audit_log (actor_id, action, entity, entity_id, detail)
               SELECT $3::bigint, 'bracket.reschedule', 'brackets', u.id::text,
                      jsonb_build_object('from', $5::text, 'to', u.starts_on) FROM u)
         SELECT count(*)::int AS n FROM u`,
        [id, day, String(viewer.id), new Date(now).toISOString(), row.starts_on]);
    } catch (e) {
      if (e?.code === '23505') throw new HttpError(409, TAKEN_MONDAY);
      throw e;
    }
    if (!Number(r.rows[0]?.n || 0)) throw new HttpError(409, 'This bracket has already started.');
    out.starts_on = day;
  }

  if (has(b, 'mode')) {
    if (row.deleted_at) throw notFound('Bracket not found');
    if (b.mode !== 'manual') throw bad('A bracket can only be switched to manual.');
    if (!isOrganizer(viewer)) throw forbidden('Only culture organizers can switch a bracket to manual.');
    if (row.mode === 'manual') return out;
    if (row.archived) throw new HttpError(409, 'This bracket is closed.');
    if (!row.activated_at) throw new HttpError(409, 'This bracket hasn’t started yet. Change its start Monday instead.');
    const r = await query(
      `WITH u AS (
         UPDATE brackets SET mode = 'manual', updated_at = $3::timestamptz, updated_by = $2::bigint
         WHERE id = $1::bigint AND mode = 'auto' AND activated_at IS NOT NULL AND NOT archived AND deleted_at IS NULL
         RETURNING id, resolved_through),
       a AS (INSERT INTO audit_log (actor_id, action, entity, entity_id, detail)
             SELECT $2::bigint, 'bracket.switch_manual', 'brackets', u.id::text,
                    jsonb_build_object('resolved_through', u.resolved_through) FROM u)
       SELECT count(*)::int AS n FROM u`,
      [id, String(viewer.id), new Date(now).toISOString()]);
    if (!Number(r.rows[0]?.n || 0)) throw new HttpError(409, 'This bracket just changed — refresh and try again.');
    out.mode = 'manual';
  }

  if (has(b, 'deleted') && b.deleted === false) {
    if (!isAdmin(viewer)) throw forbidden('Only admins can restore brackets.');
    if (row.deleted_at) {
      try {
        const res = await transaction([
          query('SELECT pg_advisory_xact_lock($1::bigint)', [BRACKET_LOCK]),
          query(`WITH r AS (
                   UPDATE brackets b SET deleted_at = NULL, deleted_by = NULL,
                     archived = b.archived OR (NOT (b.mode = 'auto' AND b.activated_at IS NULL)
                       AND EXISTS (SELECT 1 FROM (${CURRENT_SQL}) c WHERE c.id <> b.id)),
                     updated_at = $3::timestamptz, updated_by = $2::bigint
                   WHERE b.id = $1::bigint AND b.deleted_at IS NOT NULL
                   RETURNING b.id, b.archived),
                 a AS (INSERT INTO audit_log (actor_id, action, entity, entity_id, detail)
                       SELECT $2::bigint, 'bracket.restore', 'brackets', r.id::text, jsonb_build_object('archived', r.archived)
                       FROM r)
                 SELECT r.id, r.archived FROM r`, [id, String(viewer.id), new Date(now).toISOString()]),
        ]);
        const r = res[1].rows[0];
        if (r) { out.restored = true; out.archived = !!r.archived; row.archived = !!r.archived; row.deleted_at = null; }
      } catch (e) {
        if (e?.code === '23505') throw new HttpError(409, 'There’s already a bracket starting that Monday.');
        throw e;
      }
    }
  }

  if (has(b, 'archived') && b.archived === false) {
    if (!isAdmin(viewer)) throw forbidden('Only admins can un-archive brackets.');
    if (row.deleted_at) throw new HttpError(409, 'Restore this bracket first.');
    if (row.archived) {
      let n = 0;
      try {
        const res = await transaction([
          query('SELECT pg_advisory_xact_lock($1::bigint)', [BRACKET_LOCK]),
          query(`WITH u AS (
                   UPDATE brackets b SET archived = false, updated_at = $3::timestamptz, updated_by = $2::bigint
                   WHERE b.id = $1::bigint AND b.archived AND b.deleted_at IS NULL
                     AND ((b.mode = 'auto' AND b.activated_at IS NULL)
                          OR NOT EXISTS (SELECT 1 FROM brackets o WHERE o.id <> b.id AND NOT o.archived
                                           AND o.deleted_at IS NULL AND NOT (o.mode = 'auto' AND o.activated_at IS NULL)))
                   RETURNING b.id),
                 a AS (INSERT INTO audit_log (actor_id, action, entity, entity_id, detail)
                       SELECT $2::bigint, 'bracket.unarchive', 'brackets', u.id::text, '{}'::jsonb FROM u)
                 SELECT count(*)::int AS n FROM u`, [id, String(viewer.id), new Date(now).toISOString()]),
        ]);
        n = Number(res[1].rows[0]?.n || 0);
      } catch (e) {
        if (e?.code === '23505') throw new HttpError(409, 'There’s already a bracket starting that Monday.');
        throw e;
      }
      if (!n) {
        const again = await readBracket(id);
        if (again && again.archived && !again.deleted_at) throw new HttpError(409, 'Another bracket is live. Archive it first.');
      }
      out.unarchived = n > 0;
      row.archived = false;
    }
  }

  const edits = ['name', 'notes'].filter((k) => has(b, k));
  if (Array.isArray(b.regions)) edits.push('regions');
  if (edits.length) {
    if (row.deleted_at) throw notFound('Bracket not found');
    const pol = bracketPolicy(viewer, row);
    if (!pol.canEdit) {
      if (row.archived && !isAdmin(viewer)) throw new HttpError(409, 'This bracket is closed.');
      throw forbidden('Only culture organizers can edit this bracket.');
    }
    const columns = {};
    if (has(b, 'name')) columns.name = { type: 'text', text: true, norm: norm.lineOr(120, 'Office Bracket') };
    if (has(b, 'notes')) columns.notes = { type: 'text', text: true, norm: norm.text(NOTES_MAX) };
    if (Array.isArray(b.regions)) columns.regions = { type: 'text', norm: (v) => JSON.stringify(normRegions(v)) };
    const { row: saved } = await guardedPatch({
      table: 'brackets', id, body: b, columns, actorId: viewer.id, now,
      // The same rule as bracketPolicy.canEdit, inside the UPDATE: not deleted; legacy brackets open to
      // everyone, new ones to organizers; archived ones to admins only.
      scopeSql: `deleted_at IS NULL AND (crown_policy = 'anyone' OR $1::boolean) AND (NOT archived OR $2::boolean)`,
      scopeParams: [isOrganizer(viewer), isAdmin(viewer)],
      returning: ['name', 'notes', 'regions', 'archived'],
    });
    out.row = {
      id: String(saved.id), name: saved.name, notes: saved.notes, regions: saved.regions, archived: !!saved.archived,
      updated_at: saved.updated_at instanceof Date ? saved.updated_at.toISOString() : saved.updated_at,
      updated_by: saved.updated_by == null ? null : String(saved.updated_by),
      updated_by_name: saved.updated_by_name ?? null,
    };
  }
  return out;
}, { legacyWrite: true });

// DELETE /api/brackets/:id: soft delete (deleted_at), per bracketPolicy.canDelete. A past legacy bracket can
// still be removed by anyone (today's rule); organizer brackets by organizers once past (or while upcoming);
// the live bracket by admins only. Admins restore from the /admin Brackets section. Already gone -> { ok }.
export const DELETE = handle(async ({ viewer, params, now }) => {
  const id = parseId(params.id);
  const row = await readBracket(id);
  if (!row || row.deleted_at) return { ok: true };
  if (!bracketPolicy(viewer, row).canDelete) {
    const upcoming = row.mode === 'auto' && !row.activated_at && !row.archived;
    if (!row.archived && !upcoming) throw forbidden('Only an admin can delete the live bracket.');
    throw forbidden('Only culture organizers can delete this bracket.');
  }
  const r = await query(
    `WITH d AS (
       UPDATE brackets SET deleted_at = $4::timestamptz, deleted_by = $2::bigint
       WHERE id = $1::bigint AND deleted_at IS NULL
         AND ($3::boolean OR (archived AND crown_policy = 'anyone')
              OR ($5::boolean AND (archived OR (mode = 'auto' AND activated_at IS NULL))))
       RETURNING id, name, archived),
     a AS (INSERT INTO audit_log (actor_id, action, entity, entity_id, detail)
           SELECT $2::bigint, 'bracket.delete', 'brackets', d.id::text, jsonb_build_object('name', d.name, 'archived', d.archived)
           FROM d)
     SELECT count(*)::int AS n FROM d`,
    [id, String(viewer.id), isAdmin(viewer), new Date(now).toISOString(), isOrganizer(viewer)]);
  if (!Number(r.rows[0]?.n || 0)) {
    const again = await readBracket(id);
    if (again && !again.deleted_at) throw new HttpError(409, 'This bracket just changed — refresh and try again.');
  }
  return { ok: true };
}, { legacyWrite: true });
