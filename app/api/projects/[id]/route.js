import { handle, bad, forbidden, parseId, str, HttpError } from '@/lib/http';
import { projectAccess, requireVisibleProject, canManageProject, canMoveProject, canDeleteProject } from '@/lib/access';
import { guardedPatch, norm } from '@/lib/patch';
import { moveTarget, deleteProject } from '@/lib/queries/project';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';
export const maxDuration = 60;

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

const COLUMNS = {
  name: { type: 'text', text: true, norm: norm.line(200) },
  notes: { type: 'text', text: true, norm: norm.text(5000) },
  team_id: { type: 'bigint', norm: (v) => String(v) },
  archived: { type: 'boolean', norm: (v) => !!v },
  position: { type: 'float8', norm: (v) => Number(v) },
};

// PATCH /api/projects/:id (design §8.2), one statement that also bumps projects.rev:
//   notes (+base): anyone who can see the project.
//   name (+base, non-empty), archived, position: canManageProject (creator, legacy manager, office L2+, L3+).
//   team_id: canMoveProject (manage rights, and the target team in the caller's scope).
// Returns { ok: true, row }.
export const PATCH = handle(async ({ viewer, params, body, now }) => {
  const id = parseId(params.id);
  const b = await body();
  const p = await requireVisibleProject(viewer, id);
  if ((has(b, 'name') || has(b, 'archived') || has(b, 'position')) && !canManageProject(viewer, p)) {
    throw forbidden('Only the project’s creator, its office’s project engineers and PMs can rename or archive it.');
  }
  if (has(b, 'name') && !str(b.name, 200)) throw bad('A project needs a name.');
  if (has(b, 'position') && (b.position === null || b.position === '' || !Number.isFinite(Number(b.position)))) throw bad();
  const patch = { ...b };
  if (has(b, 'team_id')) {
    const tid = b.team_id == null || b.team_id === '' ? null : parseId(b.team_id);
    if (!tid) throw bad('Pick a team.');
    if (String(tid) === String(p.team_id)) {
      delete patch.team_id;                                  // no move
    } else {
      const target = await moveTarget(tid);
      if (!target) throw bad('That team isn’t available. Pick another one.');
      if (!canMoveProject(viewer, p, target)) throw forbidden('You can move this project only into teams in your own offices.');
      patch.team_id = tid;
    }
  }
  const { row } = await guardedPatch({
    table: 'projects', id, body: patch, columns: COLUMNS, actorId: viewer.id,
    scopeSql: 'tb_can_see_project($1::bigint, id)', scopeParams: [String(viewer.id)], bumpProjectRev: true, now,
    notFound: new HttpError(404, 'Project not found'),
  });
  return { ok: true, row };
}, { legacyWrite: true });

// DELETE /api/projects/:id: Associates and up (L4) and admins (design §4.5). Two confirms in the UI; a JSON
// snapshot of the project and everything in it goes to audit_log in the same statement. Already gone, or a
// project the caller can't see: { ok } either way, so a hidden project answers exactly like a missing one
// (§4.6, §7.1). Below L4 the 403 is only for a project the caller can see.
export const DELETE = handle(async ({ viewer, params }) => {
  const id = parseId(params.id);
  if (!canDeleteProject(viewer)) {
    const p = await projectAccess(viewer, id);
    if (!p || !p.visible) return { ok: true };
    throw forbidden('Only Associates and above can delete a project. Archive it instead.');
  }
  await deleteProject(viewer, id);
  return { ok: true };
}, { legacyWrite: true });
