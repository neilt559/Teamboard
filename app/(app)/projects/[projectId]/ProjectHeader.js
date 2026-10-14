'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { IconArchive, IconMore, IconPencil, IconRestore, IconTrash, IconUsers } from '@/app/icons';
import { SyncedField } from '@/app/synced';
import { settleWrites } from '@/app/_ui/api';
import { mondayOf, projectTitle, stageLabel, stageSteps, statusReportTitle } from '@/lib/projects';
import { ScheduleRadios } from '@/app/_ui/project-status';
import { fmtMonthDay } from '@/app/_ui/project-format';

// Project header (design §2.3): the name (inline rename for people who may manage the project), progress over
// ALL top-level tasks (archived Done tasks still count, rule 21), the team select (move), "+ Add Task", and a
// "more" menu with Archive / Restore and Delete. A team move asks first (it changes who is on the project, A4). Capabilities come from the loader (canManageProject,
// canMoveProject targets, canDeleteProject), so the header shows exactly what the API allows.
// A6.5 + A11 (direction B): the project number shows next to the rename box (it is edited in Project details). Under
// the title sits ONE ruled strip, the project's own title block, lettered like the owner report (Barlow; Barlow
// Condensed tracked caps only for the cell labels and the stage names):
//   Owner & jurisdiction (pencil = Project details, managers) | Stage (the stationing line; each run is a button,
//   hover / focus states, an Undo toast after a change) | Schedule (a single-choice radio group: click or arrow keys;
//   Behind turns brick) | Owner report (an ink button cell: "Week of ..." or the Status Report's own title).
// Lime means the current stage; brick means Behind. Schedule and stage are for everyone who sees the project; an
// archived project shows them read-only. Phone: the strip stacks and the stage line turns vertical (container
// queries on the strip's width, project-strip.css).
export default function ProjectHeader({ project: p, can, teams, pct, doneCount, total, memberCount, ro, actions, conflictUI, ask, today }) {
  const [menu, setMenu] = useState(false);
  const wrap = useRef(null);

  useEffect(() => {
    if (!menu) return undefined;
    const close = (e) => { if (wrap.current && !wrap.current.contains(e.target)) setMenu(false); };
    const esc = (e) => { if (e.key === 'Escape') setMenu(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('touchstart', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('touchstart', close);
      document.removeEventListener('keydown', esc);
    };
  }, [menu]);

  const archive = (archived) => { setMenu(false); actions.patchProject({ archived }); };
  const del = async () => {
    setMenu(false);
    if (!(await ask({ title: `Delete “${projectTitle(p)}” and all of its tasks?`, confirmLabel: 'Delete', danger: true }))) return;
    if (!(await ask({ title: `Are you REALLY really sure? “${projectTitle(p)}” and all its tasks will be gone for good.`, confirmLabel: 'Delete for good', danger: true }))) return;
    actions.deleteProject();
  };

  // Move targets grouped by office (the old select listed every team, archived ones too, with no office).
  const groups = [];
  for (const t of teams || []) {
    let g = groups.find((x) => String(x.office_id) === String(t.office_id));
    if (!g) { g = { office_id: t.office_id, office_name: t.office_name || 'Office', teams: [] }; groups.push(g); }
    g.teams.push(t);
  }
  // The Undo toast after a stage change (8 s); it puts the previous stage back and focuses its run.
  const [undo, setUndo] = useState(null);           // { prev, label, n }
  const undoTimer = useRef(null);
  useEffect(() => () => { if (undoTimer.current) clearTimeout(undoTimer.current); }, []);
  const stageChanged = (prev, label) => {
    setUndo((u) => ({ prev, label, n: (u?.n || 0) + 1 }));
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => setUndo(null), 8000);
  };
  const doUndo = () => {
    if (!undo?.prev) return;
    const prev = undo.prev;
    actions.setStage(prev);
    setUndo(null);
    if (undoTimer.current) clearTimeout(undoTimer.current);
    requestAnimationFrame(() => document.querySelector(`.ps-line [data-stage="${prev}"]`)?.focus());
  };

  const showMenu = (can.manage || can.delete);
  const steps = stageSteps(p.stages, p.current_stage);

  return (
    <>
      <div className="proj-head">
        {can.manage && !ro ? (
          <h1 className="proj-title">
            {numberChip(p) && <span className="proj-num" title="Project number (change it in Project details)">{numberChip(p)}</span>}
            <SyncedField
              className="proj-title-input"
              value={p.name}
              aria-label="Project name (click to rename)"
              title="Click to rename"
              maxLength={200}
              onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
              onSave={(v, base) => (v.trim() ? actions.saveProjectText('name', v, base) : false)}
            />
          </h1>
        ) : (
          <h1 className="proj-title-ro">{projectTitle(p)}</h1>
        )}
        <div className="proj-progress">
          <div className="progress" title={`${pct}% done`}><span style={{ width: `${pct}%` }} /></div>
          <span className="progress-label">{doneCount}/{total} done</span>
        </div>
        {can.move && !ro ? (
          <label className="team-select-wrap">Team
            <select className="team-select" value={p.team_id ?? ''} onChange={(e) => actions.moveProject(e.target.value)}>
              {groups.map((g) => (
                <optgroup key={g.office_id ?? 'none'} label={g.office_name}>
                  {g.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </optgroup>
              ))}
            </select>
          </label>
        ) : p.team_name ? (
          <span className="team-select-wrap">Team <b className="team-name-ro">{p.team_name}</b></span>
        ) : null}
        <a href="#members" className="members-link" title="Who’s on this project">
          <IconUsers size={14} /> {memberCount} {memberCount === 1 ? 'member' : 'members'}
        </a>
        <div className="spacer" />
        {!ro && <button type="button" className="btn btn-lime add-task-top" onClick={actions.addTask}>+ Add Task</button>}
        {showMenu && (
          <div className="more-wrap" ref={wrap}>
            <button
              type="button"
              className="btn btn-plain more-btn"
              aria-label="More project actions"
              aria-haspopup="menu"
              aria-expanded={menu}
              onClick={() => setMenu((m) => !m)}
            ><IconMore size={18} /></button>
            {menu && (
              <div className="more-menu" role="menu">
                {can.manage && !p.archived && (
                  <button type="button" role="menuitem" onClick={() => archive(true)}><IconArchive size={15} /> Archive project</button>
                )}
                {can.manage && p.archived && (
                  <button type="button" role="menuitem" onClick={() => archive(false)}><IconRestore size={15} /> Restore project</button>
                )}
                {can.delete && (
                  <button type="button" role="menuitem" className="danger" onClick={del}><IconTrash size={15} /> Delete project</button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
      {conflictUI(`project:${p.id}:name`)}

      <div className="pstrip-wrap">
      <section className="pstrip" aria-label="Project status">
        <div className="ps-cell ps-who">
          <dl>
            <dt className="ps-k">Owner</dt>
            <dd>{p.owner_company || <span className="ps-unset">Not set</span>}</dd>
            <dt className="ps-k">Jurisdiction</dt>
            <dd>{p.jurisdiction || <span className="ps-unset">Not set</span>}</dd>
          </dl>
          {can.manage && !ro && (
            <button type="button" className="ps-edit pa6-details" title="Edit owner, jurisdiction and the other project details"
              aria-label="Edit owner, jurisdiction and project details" onClick={actions.openDetails}>
              <IconPencil size={14} />
            </button>
          )}
        </div>
        <StageCell p={p} steps={steps} ro={ro} can={can} actions={actions} onChanged={stageChanged} />
        <div className="ps-cell ps-sched">
          <p className="ps-k" id={`ps-sched-k-${p.id}`}>Schedule</p>
          <ScheduleRadios value={p.schedule_status || ''} onPick={actions.setSchedule} disabled={ro} labelledBy={`ps-sched-k-${p.id}`} />
        </div>
        <GenerateReport pid={p.id} week={statusReportTitle(p.notes) || (today ? `Week of ${fmtMonthDay(mondayOf(today))}` : 'This week')} />
      </section>
      </div>
      {undo && (
        <div className="ps-toast" role="status" aria-live="polite" key={undo.n}>
          <span>Stage changed to {undo.label}.</span>
          {undo.prev && <button type="button" onClick={doUndo}>Undo</button>}
        </div>
      )}
    </>
  );
}

// The stage cell: the stationing line (complete runs screened solid, the current one a lime bar with a heavy outline,
// later ones dashed). Each run is a button that makes its stage current; after a change an Undo toast offers the
// previous stage back for 8 seconds (ProjectHeader shows it: onChanged(prev, label)).
function StageCell({ p, steps, ro, can, actions, onChanged }) {
  const at = steps.findIndex((s) => s.state === 'current');
  const kId = `ps-stage-k-${p.id}`;
  const pick = (k) => {
    if (ro || k === p.current_stage) return;
    const prev = p.current_stage || '';
    actions.setStage(k);
    onChanged(prev, stageLabel(k));
  };
  return (
    <div className="ps-cell ps-stage">
      <p className="ps-k" id={kId}>Stage {steps.length > 0 && <b>{at >= 0 ? `${at + 1} of ${steps.length}` : 'not set'}</b>}</p>
      {steps.length ? (
        <ol className="ps-line" aria-labelledby={kId} style={{ '--n': steps.length }}>
          {steps.map((s, i) => {
            const cls = s.state === 'done' ? 'done' : s.state === 'current' ? 'now' : '';
            const inner = (
              <>
                <span className="ps-name">{s.label}</span>
                <span className="sr-only">{s.state === 'done' ? ', complete' : s.state === 'current' ? ', current stage' : ''}</span>
                {i === steps.length - 1 && <span className="ps-end" aria-hidden="true" />}
              </>
            );
            return (
              <li key={s.key} className={cls}>
                {ro ? (
                  <span className="ps-run" aria-current={s.state === 'current' ? 'step' : undefined}>{inner}</span>
                ) : (
                  <button
                    type="button"
                    className="ps-run"
                    data-stage={s.key}
                    aria-current={s.state === 'current' ? 'step' : undefined}
                    title={s.state === 'current' ? `${s.label} is the current stage` : `Make ${s.label} the current stage`}
                    onClick={() => pick(s.key)}
                  >{inner}</button>
                )}
              </li>
            );
          })}
        </ol>
      ) : (
        <span className="ps-nostages">
          <span className="ps-unset">No stages set yet.</span>
          {can.manage && !ro && <button type="button" className="btn-link" onClick={actions.openDetails}>Pick the stages</button>}
        </span>
      )}
    </div>
  );
}

// The "Owner report" button cell (A6.5 "Generate report"; A11 ink cell): the Status Report, submittal and other fields save on blur, so clicking straight from
// a field to this button must not race that save (2026-10-14 review: with a slow write the report showed last
// week's text). It blurs the field, waits for every write in flight (app/_ui/api.js settleWrites), and only then
// opens /projects/[id]/report. A write that failed keeps you here, where its error or conflict notice shows.
function GenerateReport({ pid, week }) {
  const router = useRouter();
  const [state, setState] = useState(null);            // null | 'saving' | 'opening' | 'failed' | 'slow'
  const go = async () => {
    if (state === 'saving' || state === 'opening') return;
    const el = typeof document !== 'undefined' ? document.activeElement : null;
    if (el && el !== document.body && typeof el.blur === 'function') el.blur();
    setState('saving');
    await new Promise((r) => setTimeout(r, 0));         // a save the blur scheduled has started
    const res = await settleWrites();
    if (!res.ok) { setState(res.timedOut ? 'slow' : 'failed'); return; }
    setState('opening');
    router.push(`/projects/${pid}/report`);
  };
  const busy = state === 'saving' || state === 'opening';
  return (
    <div className="ps-cell ps-report">
      <button type="button" className="pa6-report" onClick={go} aria-busy={busy || undefined} data-state={state || 'idle'}
        title="Open the owner report to preview, print or save as PDF">
        <span className="ps-week">{week}</span>
        <span>
          <b>{state === 'saving' ? 'Saving changes…' : state === 'opening' ? 'Opening report…' : 'Owner report'}
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h9.5M8.5 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </b>
          <small>Preview, print or save as PDF</small>
        </span>
      </button>
      {state === 'failed' && <span className="pa6-report-msg" role="alert">A change didn’t save, so the report would be out of date. Fix it, then try again.</span>}
      {state === 'slow' && <span className="pa6-report-msg" role="alert">Your changes are still saving. Try again in a moment.</span>}
    </div>
  );
}

// The number shown in front of the manager's rename box: only when the name doesn't already start with it (pre-A6
// names carry their job number: "230021 - Randall Commons").
function numberChip(p) {
  const num = String(p.project_number || '').trim();
  if (!num || String(p.name || '').trim().startsWith(num)) return '';
  return num;
}
