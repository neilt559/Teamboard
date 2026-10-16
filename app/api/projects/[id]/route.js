import { handle, bad, forbidden, parseId, noNul, HttpError } from '@/lib/http';
import { projectAccess, requireVisibleProject, canManageProject, canMoveProject, canDeleteProject } from '@/lib/access';
import { guardedPatch, norm } from '@/lib/patch';
import { moveTarget, deleteProject, PROJECT_NORM, currentStageFallbackSql, shapeProjectRow } from '@/lib/queries/project';
import { ROSTER_LOCK_SQL, TEAM_MOVE_SELECT, teamMoveCtes } from '@/lib/rosters';
import { STAGE_KEYS, SCHEDULE_KEYS, checkStages, stagesJson, parseStages, normReportLink, normReportNote, REPORT_NOTE_MAX } from '@/lib/projects';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';
export const maxDuration = 60;

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

const COLUMNS = {
  name: { type: 'text', text: true, norm: PROJECT_NORM.name },
  notes: { type: 'text', text: true, norm: norm.text(5000) },
  team_id: { type: 'bigint', norm: (v) => String(v) },
  archived: { type: 'boolean', norm: (v) => !!v },
  position: { type: 'float8', norm: (v) => Number(v) },
  // A6 project details (managers): base-compared single-line text, like the name.
  project_number: { type: 'text', text: true, norm: PROJECT_NORM.project_number },
  owner_company: { type: 'text', text: true, norm: PROJECT_NORM.owner_company },
  jurisdiction: { type: 'text', text: true, norm: PROJECT_NORM.jurisdiction },
  // A6 discrete fields (last write wins), validated and canonicalized below: stages (managers), current stage and
  // schedule status (anyone who can see the project).
  stages: { type: 'text' },
  current_stage: { type: 'text' },
  schedule_status: { type: 'text' },
  // The report's Egnyte folder link (2026-10-15): anyone who can see the project, base-compared like the notes.
  report_link: { type: 'text', text: true, norm: (v) => normReportLink(v) ?? '' },
  // The report's foot note (2026-10-16): anyone who can see the project, base-compared like the notes.
  report_note: { type: 'text', text: true, norm: (v) => normReportNote(v) ?? '' },
};
// Fields that need canManageProject (team_id: canMoveProject, below). Everything else: anyone who can see it.
const MANAGE = ['name', 'archived', 'position', 'project_number', 'owner_company', 'jurisdiction', 'stages'];
const TEXT = ['name', 'notes', 'project_number', 'owner_company', 'jurisdiction', 'report_link', 'report_note'];
const REQUIRED = {
  name: 'A project needs a name.',
  project_number: 'A project needs a project number.',
  owner_company: 'Enter the owner company.',
  jurisdiction: 'Enter the jurisdiction.',
};

// PATCH /api/projects/:id (design §8.2, A6.3), one statement that also bumps projects.rev:
//   notes (+base; the Status Report), schedule_status ('' | ahead | on_track | behind) and current_stage (one of
//     the project's stages): anyone who can see the project. An empty Status Report counts as reviewed.
//   status_report_reviewed: true (+base.notes = the text reviewed): "Use in reports" on a pre-A6 Status Report
//     (status_report_reviewed_at stamped; 409 when the text changed since): anyone who can see the project.
//   name, project_number, owner_company, jurisdiction (+base, non-empty), stages (an array of stage keys, at
//     least one; stored in the fixed order), archived, position: canManageProject (creator, legacy manager,
//     office L2+, L3+). A stages change that drops the current stage moves it, in the same statement, to the
//     latest remaining stage before it (else the first one); a current_stage sent along must be one of the new
//     stages.
//   team_id: canMoveProject (manage rights, and the target team in the caller's scope). In the same statement
//     (A4 rule 3b/3c): the new team's roster joins the project as 'team' members, roster rows of people who
//     aren't on the new team's roster are soft-removed (kept, as task rows, where the person owns a task here),
//     and the move is audited (project.move_team). It runs under the roster lock (lib/rosters.js), so it never
//     races a roster change or another move of the same project.
// Returns { ok: true, row } (stages as an array of keys), plus team_move: { added, removed, kept } (membership counts) on a move.
export const PATCH = handle(async ({ viewer, params, body, now }) => {
  const id = parseId(params.id);
  const b = await body();
  const p = await requireVisibleProject(viewer, id);
  if (MANAGE.some((k) => has(b, k)) && !canManageProject(viewer, p)) {
    throw forbidden('Only the project’s creator, its office’s project engineers and PMs can change its name, details or stages, or archive it.');
  }
  for (const k of TEXT) if (has(b, k)) noNul(b[k]);
  for (const [k, msg] of Object.entries(REQUIRED)) if (has(b, k) && !COLUMNS[k].norm(b[k])) throw bad(msg);
  if (has(b, 'position') && (b.position === null || b.position === '' || !Number.isFinite(Number(b.position)))) throw bad();
  if (has(b, 'report_link') && normReportLink(b.report_link) === null) throw bad('Paste a web link to the folder (https://…).');
  if (has(b, 'report_note') && (typeof b.report_note !== 'string' || normReportNote(b.report_note) === null)) throw bad(`Keep the report note to ${REPORT_NOTE_MAX} characters.`);
  const patch = { ...b };
  const columns = { ...COLUMNS };
  const extra = [];                                          // more SET items: (bind) => 'col = <expr>'

  // Status Report review (review fix 2026-10-14): a pre-A6 project's notes were written as internal notes, so
  // reports leave them out until someone reviews them. "Use in reports" sends { status_report_reviewed: true,
  // base: { notes: <the text reviewed> } }: the text is written back unchanged under the usual base-compare (409
  // when it changed since), and the stamp is set in the same statement. Saving an empty Status Report also stamps
  // it (nothing internal is left). Anyone who can see the project, like the Status Report itself.
  if (has(b, 'status_report_reviewed')) {
    if (b.status_report_reviewed !== true) throw bad('Only “Use in reports” (true) is allowed.');
    const reviewed = b.base && typeof b.base === 'object' ? b.base.notes : undefined;
    if (typeof reviewed !== 'string') throw bad('Reload the page and review the Status Report again.');
    noNul(reviewed);
    if (has(b, 'notes')) throw bad('Save the Status Report first, then click Use in reports.');
    patch.notes = reviewed;
  }
  const emptied = has(patch, 'notes') && !/[^\s]/.test(COLUMNS.notes.norm(patch.notes) || '');
  if (emptied || has(b, 'status_report_reviewed')) {
    extra.push(() => 'status_report_reviewed_at = COALESCE(status_report_reviewed_at, now())');
  }
  delete patch.status_report_reviewed;

  // Stages (A6.1): known keys only, at least one, stored as a JSON array in the fixed order.
  let newStages = null;
  if (has(b, 'stages')) {
    const st = checkStages(b.stages);
    if (st.error) throw bad(st.error);
    newStages = st.keys;
    patch.stages = stagesJson(newStages);
  }
  if (has(b, 'current_stage')) {
    const cs = typeof b.current_stage === 'string' ? b.current_stage : '';
    if (!STAGE_KEYS.includes(cs)) throw bad('Pick one of the project’s stages.');
    if (!(newStages || parseStages(p.stages)).includes(cs)) throw bad('That stage isn’t one of this project’s stages.');
    patch.current_stage = cs;
    // Without a stages change in the same request, store it only while it is still one of the stored stages (a
    // stages change committed meanwhile wins; the answer carries the stored value).
    if (!newStages) {
      columns.current_stage = {
        type: 'text',
        expr: (ph) => `CASE WHEN ${ph}::text IN (SELECT jsonb_array_elements_text(stages::jsonb)) THEN ${ph}::text ELSE current_stage END`,
      };
    }
  } else if (newStages) {
    extra.push((bind) => `current_stage = ${currentStageFallbackSql(bind(newStages), bind(STAGE_KEYS))}`);
  }
  if (has(b, 'schedule_status')) {
    const s = b.schedule_status == null ? '' : b.schedule_status;
    if (typeof s !== 'string' || !SCHEDULE_KEYS.includes(s)) throw bad('Unknown schedule status.');
    patch.schedule_status = s;
  }

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
    table: 'projects', id, body: patch, columns, actorId: viewer.id,
    scopeSql: 'tb_can_see_project($1::bigint, id)', scopeParams: [String(viewer.id)], bumpProjectRev: true, now,
    notFound: new HttpError(404, 'Project not found'),
    extraSet: extra.length ? (bind) => extra.map((f) => f(bind)) : null,
    ...(moving ? {
      prelude: [ROSTER_LOCK_SQL],
      extraCtes: (bind) => teamMoveCtes(bind, { actorId: viewer.id }),
      extraSelect: TEAM_MOVE_SELECT,
    } : {}),
  });
  if (!moving) return { ok: true, row: shapeProjectRow(row) };
  const { team_move_added: added, team_move_removed: removed, team_move_kept: kept, ...stored } = row;
  return {
    ok: true, row: shapeProjectRow(stored),
    team_move: added === undefined ? null : { added: Number(added) || 0, removed: Number(removed) || 0, kept: Number(kept) || 0 },
  };
}, { legacyWrite: true });

// DELETE /api/projects/:id: Associates and up (L4) and admins (design §4.5). Two confirms in the UI; a JSON
// snapshot of the project and everything in it (A6: submittals and upcoming meetings too) goes to audit_log in
// the same statement. Already gone, or a project the caller can't see: { ok } either way, so a hidden project
// answers exactly like a missing one (§4.6, §7.1). Below L4 the 403 is only for a project the caller can see.
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
