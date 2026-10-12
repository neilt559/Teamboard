'use client';
import { useEffect, useRef, useState } from 'react';
import { IconArchive, IconMore, IconRestore, IconTrash, IconUsers } from '@/app/icons';
import { SyncedField } from '@/app/synced';

// Project header (design §2.3): the name (inline rename for people who may manage the project), progress over
// ALL top-level tasks (archived Done tasks still count, rule 21), the team select (move), "+ Add Task", and a
// "more" menu with Archive / Restore and Delete. A team move asks first (it changes who is on the project, A4). Capabilities come from the loader (canManageProject,
// canMoveProject targets, canDeleteProject), so the header shows exactly what the API allows.
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
    if (!(await ask({ title: `Delete “${p.name}” and all of its tasks?`, confirmLabel: 'Delete', danger: true }))) return;
    if (!(await ask({ title: `Are you REALLY really sure? “${p.name}” and all its tasks will be gone for good.`, confirmLabel: 'Delete for good', danger: true }))) return;
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

  return (
    <>
      <div className="proj-head">
        {can.manage && !ro ? (
          <h1 className="proj-title">
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
          <h1 className="proj-title-ro">{p.name}</h1>
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
    </>
  );
}
