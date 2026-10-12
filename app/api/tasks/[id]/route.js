import { handle, parseId } from '@/lib/http';
import { deleteWithSnapshot } from '@/lib/audit';
import { patchTask } from '@/lib/queries/project';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';
export const maxDuration = 60;

// PATCH /api/tasks/:id (design §7, §8.2): only the keys present are written, in one statement.
// title / notes (+base), status (Done archives a top-level task), stoplight, due_date, assignee_id (auto
// membership), archived. -> { ok, row, added_members: [{user_id, name}], added_member: count (§6) }; 409
// conflict, 404 gone.
export const PATCH = handle(async ({ viewer, params, body, now }) => {
  const r = await patchTask({ viewer, id: params.id, body: await body(), now });
  return { ok: true, ...r, added_member: (r.added_members || []).length };
}, { legacyWrite: true });

// DELETE /api/tasks/:id: the task and its subtasks (DB cascade), with a JSON snapshot of both in audit_log.
// Already gone, or in a project the caller can't see: { ok } either way (design §4.6: a row you can't see answers
// exactly like a missing one; §7.1: deleting a missing row is ok). The scoped statement never deletes a hidden row.
export const DELETE = handle(async ({ viewer, params }) => {
  const id = parseId(params.id);
  await deleteWithSnapshot({
    table: 'tasks', id, actorId: viewer.id, action: 'task.delete',
    scopeSql: 'tb_can_see_project($1::bigint, project_id)', scopeParams: [String(viewer.id)],
    children: { subtasks: { table: 'tasks', fk: 'parent_id' } }, bumpProjectRev: true,
  });
  return { ok: true };
}, { legacyWrite: true });
