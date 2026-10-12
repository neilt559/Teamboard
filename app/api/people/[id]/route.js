import { handle, HttpError, bad, forbidden, gone, parseId, str } from '@/lib/http';
import { query } from '@/lib/db';
import { guardedPatch, norm } from '@/lib/patch';
import { normHex } from '@/app/_ui/people';
import { loadPerson, linkPersonDirect, unlinkPerson } from '@/lib/queries/admin';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';
export const maxDuration = 60;

// One name on tasks (design §4.5, §8.2). tasks.assignee_id is never rewritten (rule 11).
//
// PATCH any of:
//   name (trimmed, not blank, <= 120; optional base.name for conflict detection) and color (hex):
//       anyone for unlinked names and groups; the linked person or an admin for a linked name.
//   kind ('person' | 'group'), user_id (link to an account, or null to unlink), archived:false (restore): admin only.
//   archived:true: same rule as DELETE.
// DELETE archives (archived_at); tasks keep their owner. Unlinked names and groups: anyone. Linked names: admin.
// Both return the stored row ({ ok, row } plus today's top-level { id, name, color }).
const has = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);

async function archive(pid, viewer) {
  const r = await query(
    `WITH p AS (UPDATE people SET archived_at = now()
                WHERE id = $1::bigint AND archived_at IS NULL AND (user_id IS NULL OR $2::boolean)
                RETURNING id, name, user_id),
     a AS (INSERT INTO audit_log (actor_id, action, entity, entity_id, detail)
           SELECT $3::bigint, 'person.archive', 'people', p.id::text, jsonb_build_object('name', p.name, 'user_id', p.user_id) FROM p)
     SELECT (SELECT count(*) FROM p)::int AS archived`,
    [pid, !!viewer.is_admin, String(viewer.id)]);
  return Number(r.rows[0]?.archived || 0) > 0;
}

async function restore(pid, viewer) {
  await query(
    `WITH p AS (UPDATE people SET archived_at = NULL WHERE id = $1::bigint AND archived_at IS NOT NULL RETURNING id, name),
     a AS (INSERT INTO audit_log (actor_id, action, entity, entity_id, detail)
           SELECT $2::bigint, 'person.restore', 'people', p.id::text, jsonb_build_object('name', p.name) FROM p)
     SELECT 1`, [pid, String(viewer.id)]);
}

// Why an admin's direct link didn't happen.
async function linkRefusal(person, userId) {
  if (person.kind === 'group') return new HttpError(409, 'Groups can’t be linked to an account. Make it a person first.');
  if (person.archived_at) return new HttpError(409, 'Restore this name before linking it.');
  const u = (await query(`SELECT 1 FROM users WHERE id = $1::bigint`, [userId])).rows[0];
  if (!u) return new HttpError(404, 'Account not found');
  const own = (await query(
    `SELECT p.name, (SELECT count(*) FROM tasks k WHERE k.assignee_id = p.id)::int AS tasks FROM people p WHERE p.user_id = $1::bigint`,
    [userId])).rows[0];
  if (own) {
    return new HttpError(409, `That account already has its own name “${own.name}” with ${own.tasks} task${own.tasks === 1 ? '' : 's'}. `
      + 'Unlink that name first (its tasks stay where they are).');
  }
  return new HttpError(409, 'Someone linked this name meanwhile. Refresh.');
}

export const PATCH = handle(async ({ viewer, params, body, now }) => {
  const pid = parseId(params.id);
  const b = await body();
  const admin = !!viewer.is_admin;
  const cur = await loadPerson(pid);
  if (!cur) throw gone();

  const restoring = has(b, 'archived') && b.archived === false;
  const archiving = has(b, 'archived') && b.archived === true;
  if ((has(b, 'kind') || has(b, 'user_id') || restoring) && !admin) throw forbidden('Only an admin can do that.');
  if (has(b, 'archived') && typeof b.archived !== 'boolean') throw bad('archived must be true or false.');

  const linked = cur.user_id != null;
  const editing = has(b, 'name') || has(b, 'color');
  if (editing && linked && cur.user_id !== String(viewer.id) && !admin) {
    throw forbidden('Only the person linked to this name, or an admin, can change it.');
  }
  if (archiving && linked && !admin) throw forbidden('Only an admin can archive a name that’s linked to an account.');
  if (editing && cur.archived_at && !admin && !restoring) throw new HttpError(409, 'This name was archived. An admin can restore it.');

  let name;
  let color;
  if (has(b, 'name')) {
    name = str(b.name, 120);
    if (!name) throw bad('A name can’t be blank.');
  }
  if (has(b, 'color')) {
    color = normHex(b.color);
    if (!color) throw bad('Pick a valid color like #5B5859.');
  }
  if (has(b, 'kind') && b.kind !== 'person' && b.kind !== 'group') throw bad('kind must be person or group.');

  // 1. link / unlink (admin)
  let linkedNow = linked;
  let projectsAdded = 0;
  if (has(b, 'user_id')) {
    if (b.user_id == null || b.user_id === '') {
      if (linked) await unlinkPerson({ adminId: viewer.id, personId: pid });
      linkedNow = false;
    } else {
      const uid = parseId(b.user_id);
      if (linked && cur.user_id !== uid) throw new HttpError(409, 'That name is linked to another account. Unlink it first.');
      if (!linked) {
        const r = await linkPersonDirect({ adminId: viewer.id, personId: pid, userId: uid });
        if (!r.linked) throw await linkRefusal(cur, uid);
        projectsAdded = r.projects_added;
      }
      linkedNow = true;
    }
  }
  // 2. person or group (admin); a linked name can't become a group
  if (has(b, 'kind') && b.kind !== cur.kind) {
    if (b.kind === 'group' && linkedNow) throw new HttpError(409, 'Unlink it first: groups can’t be linked to an account.');
    const r = await query(
      `WITH p AS (UPDATE people SET kind = $2::text WHERE id = $1::bigint AND ($2::text = 'person' OR user_id IS NULL) RETURNING id),
       a AS (INSERT INTO audit_log (actor_id, action, entity, entity_id, detail)
             SELECT $3::bigint, 'person.kind', 'people', p.id::text, jsonb_build_object('kind', $2::text) FROM p)
       SELECT (SELECT count(*) FROM p)::int AS n`, [pid, b.kind, String(viewer.id)]);
    if (!Number(r.rows[0]?.n)) throw new HttpError(409, 'Unlink it first: groups can’t be linked to an account.');
  }
  // 3. archive / restore
  if (restoring) await restore(pid, viewer);
  if (archiving && !cur.archived_at && !(await archive(pid, viewer))) {
    throw forbidden('Only an admin can archive a name that’s linked to an account.');
  }
  // 4. name and color: one statement; the permission is re-checked inside it (a name linked meanwhile).
  if (editing) {
    const columns = {};
    const base = b.base && typeof b.base === 'object' ? b.base : {};
    if (name !== undefined) columns.name = { type: 'text', text: has(base, 'name'), norm: norm.line(120) };
    if (color !== undefined) columns.color = { type: 'text', norm: () => color };
    await guardedPatch({
      table: 'people', id: pid, body: { ...b, ...(name !== undefined ? { name } : {}) }, columns, actorId: viewer.id, now,
      scopeSql: '(user_id IS NULL OR user_id = $1::bigint OR $2::boolean) AND (archived_at IS NULL OR $2::boolean)',
      scopeParams: [String(viewer.id), admin],
    });
  }
  const row = await loadPerson(pid);
  if (!row) throw gone();
  return { ok: true, row, ...row, ...(projectsAdded ? { projects_added: projectsAdded } : {}) };
}, { legacyWrite: true });

export const DELETE = handle(async ({ viewer, params }) => {
  const pid = parseId(params.id);
  const cur = await loadPerson(pid);
  if (!cur || cur.archived_at) return { ok: true };            // already gone or archived
  if (cur.user_id != null && !viewer.is_admin) throw forbidden('Only an admin can archive a name that’s linked to an account.');
  if (!(await archive(pid, viewer))) {
    const again = await loadPerson(pid);
    if (again && !again.archived_at) throw forbidden('Only an admin can archive a name that’s linked to an account.');
  }
  return { ok: true };
}, { legacyWrite: true });
