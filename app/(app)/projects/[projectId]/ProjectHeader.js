'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { IconArchive, IconFile, IconMore, IconPencil, IconRestore, IconTrash, IconUsers } from '@/app/icons';
import { SyncedField } from '@/app/synced';
import { settleWrites } from '@/app/_ui/api';
import { projectTitle, stageSteps } from '@/lib/projects';
import { ScheduleBadge, ScheduleButtons, StageStepper } from '@/app/_ui/project-status';

// Project header (design §2.3): the name (inline rename for people who may manage the project), progress over
// ALL top-level tasks (archived Done tasks still count, rule 21), the team select (move), "+ Add Task", and a
// "more" menu with Archive / Restore and Delete. A team move asks first (it changes who is on the project, A4). Capabilities come from the loader (canManageProject,
// canMoveProject targets, canDeleteProject), so the header shows exactly what the API allows.
// A6.5: the project number shows next to the rename box (it is edited in Project details), then a line with the
// owner company and jurisdiction plus "Project details" (managers), and a bar with the schedule status (segmented
// button: Ahead / On track / Behind, click the active one to clear), the stage stepper (click a stage to make it
// current) and the lime "Generate report" (/projects/[id]/report). Schedule and stage are for everyone who sees
// the project; an archived project shows them read-only.
export default function ProjectHeader({ project: p, can, teams, pct, doneCount, total, memberCount, ro, actions, conflictUI, ask }) {
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

      <div className="pa6">
        <div className="pa6-facts">
          <span className="pa6-fact"><span className="pa6-k">Owner</span> {p.owner_company ? <b>{p.owner_company}</b> : <span className="muted">Not set</span>}</span>
          <span className="pa6-fact"><span className="pa6-k">Jurisdiction</span> {p.jurisdiction ? <b>{p.jurisdiction}</b> : <span className="muted">Not set</span>}</span>
          {can.manage && !ro && (
            <button type="button" className="btn btn-plain btn-sm wi pa6-details" onClick={actions.openDetails}>
              <IconPencil size={13} /> Project details
            </button>
          )}
        </div>
        <div className="pa6-bar">
          <div className="pa6-group pa6-sched">
            <span className="pa6-k">Schedule</span>
            {ro ? <ScheduleBadge status={p.schedule_status} /> : <ScheduleButtons value={p.schedule_status || ''} onPick={actions.setSchedule} />}
          </div>
          <div className="pa6-group pa6-stage">
            <span className="pa6-k">Stage</span>
            {steps.length ? (
              <div className="pa6-steps-scroll"><StageStepper steps={steps} onPick={ro ? null : actions.setStage} /></div>
            ) : (
              <span className="pa6-nostages">
                <span className="muted">No stages set yet.</span>
                {can.manage && !ro && <button type="button" className="btn-link" onClick={actions.openDetails}>Pick the stages</button>}
              </span>
            )}
          </div>
          <span className="spacer" />
          <GenerateReport pid={p.id} />
        </div>
      </div>
    </>
  );
}

// "Generate report" (A6.5): the Status Report, submittal and other fields save on blur, so clicking straight from
// a field to this button must not race that save (2026-10-14 review: with a slow write the report showed last
// week's text). It blurs the field, waits for every write in flight (app/_ui/api.js settleWrites), and only then
// opens /projects/[id]/report. A write that failed keeps you here, where its error or conflict notice shows.
function GenerateReport({ pid }) {
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
    <span className="pa6-report-wrap">
      <button type="button" className="btn btn-lime wi pa6-report" onClick={go} aria-busy={busy || undefined} data-state={state || 'idle'}>
        <IconFile size={15} /> {state === 'saving' ? 'Saving changes…' : state === 'opening' ? 'Opening report…' : 'Generate report'}
      </button>
      {state === 'failed' && <span className="pa6-report-msg" role="alert">A change didn’t save, so the report would be out of date. Fix it, then try again.</span>}
      {state === 'slow' && <span className="pa6-report-msg" role="alert">Your changes are still saving. Try again in a moment.</span>}
    </span>
  );
}

// The number shown in front of the manager's rename box: only when the name doesn't already start with it (pre-A6
// names carry their job number: "230021 - Randall Commons").
function numberChip(p) {
  const num = String(p.project_number || '').trim();
  if (!num || String(p.name || '').trim().startsWith(num)) return '';
  return num;
}
