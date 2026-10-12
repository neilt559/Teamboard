import { handle, bad, forbidden, parseId, str, HttpError } from '@/lib/http';
import { projectAccess, requireVisibleProject, canManageProject, canMoveProject, canDeleteProject } from '@/lib/access';
import { guardedPatch, norm } from '@/lib/patch';
import { moveTarget, deleteProject } from '@/lib/queries/project';
import { ROSTER_LOCK_SQL, TEAM_MOVE_SELECT, teamMoveCtes } from '@/lib/rosters';

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
//   team_id: canMoveProject (manage rights, and the target team in the caller's scope). In the same statement
//     (A4 rule 3b/3c): the new team's roster joins the project as 'team' members, roster rows of people who
//     aren't on the new team's roster are soft-removed (kept, as task rows, where the person owns a task here),
//     and the move is audited (project.move_team). It runs under the roster lock (lib/rosters.js), so it never
//     races a roster change or another move of the same project.
// Returns { ok: true, row }, plus team_move: { added, removed, kept } (membership counts) on a move.
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
  const moving = has(patch, 'team_id');
  const { row } = await guardedPatch({
    table: 'projects', id, body: patch, columns: COLUMNS, actorId: viewer.id,
    scopeSql: 'tb_can_see_project($1::bigint, id)', scopeParams: [String(viewer.id)], bumpProjectRev: true, now,
    notFound: new HttpError(404, 'Project not found'),
    ...(moving ? {
      prelude: [ROSTER_LOCK_SQL],
      extraCtes: (bind) => teamMoveCtes(bind, { actorId: viewer.id }),
      extraSelect: TEAM_MOVE_SELECT,
    } : {}),
  });
  if (!moving) return { ok: true, row };
  const { team_move_added: added, team_move_removed: removed, team_move_kept: kept, ...stored } = row;
  return {
    ok: true, row: stored,
    team_move: added === undefined ? null : { added: Number(added) || 0, removed: Number(removed) || 0, kept: Number(kept) || 0 },
  };
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
