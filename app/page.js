'use client';
import { useEffect, useState, useRef, useCallback, Fragment } from 'react';

const STATUSES = {
  not_started: { label: 'Not Started', color: '#c4c4c4' },
  working: { label: 'Working on it', color: '#fdab3d' },
  stuck: { label: 'Stuck', color: '#e2445c' },
  done: { label: 'Done', color: '#00c875' },
};
const STATUS_ORDER = ['not_started', 'working', 'stuck', 'done'];
const PERSON_COLORS = ['#5B5859', '#CBCE00', '#0086c0', '#e2445c', '#fdab3d', '#00c875', '#a25ddc', '#ff158a', '#037f4c', '#7f5347'];

const byPos = (a, b) => (Number(a.position) - Number(b.position)) || (Number(a.id) - Number(b.id));

function initials(name) {
  if (!name) return '?';
  const p = name.trim().split(/\s+/);
  return ((p[0]?.[0] || '') + (p[1]?.[0] || '')).toUpperCase() || '?';
}

async function api(path, opts) {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts });
  if (!res.ok) {
    let msg = 'Request failed';
    try { const j = await res.json(); msg = j.error || msg; } catch {}
    throw new Error(msg);
  }
  return res.json();
}

export default function Page() {
  const [data, setData] = useState({ people: [], teams: [], projects: [], tasks: [] });
  const [selected, setSelected] = useState(null);
  const [teamView, setTeamView] = useState(null);
  const [error, setError] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [collapsedTeams, setCollapsedTeams] = useState({});
  const [expandedSubtasks, setExpandedSubtasks] = useState({});
  const [expandedNotes, setExpandedNotes] = useState({});
  const [sidebarWidth, setSidebarWidth] = useState(250);
  const guard = useRef(0);

  const load = useCallback(async (force = false) => {
    if (!force && Date.now() < guard.current) return;
    try {
      const d = await api('/api/state');
      setData(d);
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => { load(true); }, [load]);
  useEffect(() => {
    const t = setInterval(() => load(false), 4000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    const saved = Number(localStorage.getItem('tb_sidebar_w'));
    if (saved >= 180 && saved <= 600) setSidebarWidth(saved);
  }, []);

  // keep a valid project selected (only matters when not viewing a team)
  useEffect(() => {
    if (!data.projects.length) { if (selected !== null) setSelected(null); return; }
    if (selected === null || !data.projects.find((p) => String(p.id) === String(selected))) {
      setSelected([...data.projects].sort(byPos)[0].id);
    }
  }, [data.projects, selected]);

  const touch = () => { guard.current = Date.now() + 2500; };

  function startResize(e) {
    e.preventDefault();
    const startX = e.clientX;
    const startW = sidebarWidth;
    const onMove = (ev) => setSidebarWidth(Math.min(600, Math.max(180, startW + (ev.clientX - startX))));
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.userSelect = '';
      setSidebarWidth((w) => { localStorage.setItem('tb_sidebar_w', String(Math.round(w))); return w; });
    };
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  // ---- teams ----
  async function addTeam() {
    const name = prompt('New team name', 'New Team');
    if (name === null) return;
    touch();
    try { await api('/api/teams', { method: 'POST', body: JSON.stringify({ name: name.trim() || 'New Team' }) }); await load(true); }
    catch (e) { setError(e.message); }
  }
  async function renameTeam(team) {
    const name = prompt('Rename team', team.name);
    if (name === null || name.trim() === '' || name === team.name) return;
    setData((d) => ({ ...d, teams: d.teams.map((x) => (x.id === team.id ? { ...x, name } : x)) }));
    touch();
    try { await api(`/api/teams/${team.id}`, { method: 'PATCH', body: JSON.stringify({ name }) }); }
    catch (e) { setError(e.message); }
  }
  async function deleteTeam(team) {
    const projCount = data.projects.filter((p) => String(p.team_id) === String(team.id)).length;
    const extra = projCount ? ` and its ${projCount} project${projCount > 1 ? 's' : ''} (and all their tasks)` : '';
    if (!confirm(`Delete team “${team.name}”${extra}? This can’t be undone.`)) return;
    if (String(teamView) === String(team.id)) setTeamView(null);
    setData((d) => ({
      ...d,
      teams: d.teams.filter((x) => x.id !== team.id),
      projects: d.projects.filter((p) => String(p.team_id) !== String(team.id)),
    }));
    touch();
    try { await api(`/api/teams/${team.id}`, { method: 'DELETE' }); await load(true); }
    catch (e) { setError(e.message); }
  }
  function toggleTeam(id) { setCollapsedTeams((c) => ({ ...c, [id]: !c[id] })); }
  async function moveTeam(team, dir) {
    const sorted = [...data.teams].sort(byPos);
    const i = sorted.findIndex((x) => String(x.id) === String(team.id));
    const j = i + dir;
    if (j < 0 || j >= sorted.length) return;
    const other = sorted[j];
    const pi = Number(team.position), pj = Number(other.position);
    setData((d) => ({ ...d, teams: d.teams.map((x) => (String(x.id) === String(team.id) ? { ...x, position: pj } : String(x.id) === String(other.id) ? { ...x, position: pi } : x)) }));
    touch();
    try {
      await api(`/api/teams/${team.id}`, { method: 'PATCH', body: JSON.stringify({ position: pj }) });
      await api(`/api/teams/${other.id}`, { method: 'PATCH', body: JSON.stringify({ position: pi }) });
    } catch (e) { setError(e.message); }
  }

  // ---- projects ----
  async function addProject(teamId) {
    const name = prompt('New project name', 'New Project');
    if (name === null) return;
    touch();
    try {
      const np = await api('/api/projects', { method: 'POST', body: JSON.stringify({ name: name.trim() || 'New Project', team_id: teamId }) });
      await load(true);
      if (np && np.id) { setSelected(np.id); setTeamView(null); setCollapsedTeams((c) => ({ ...c, [teamId]: false })); setSidebarOpen(false); }
    } catch (e) { setError(e.message); }
  }
  async function renameProject(p) {
    const name = prompt('Rename project', p.name);
    if (name === null || name.trim() === '' || name === p.name) return;
    setData((d) => ({ ...d, projects: d.projects.map((x) => (x.id === p.id ? { ...x, name } : x)) }));
    touch();
    try { await api(`/api/projects/${p.id}`, { method: 'PATCH', body: JSON.stringify({ name }) }); }
    catch (e) { setError(e.message); }
  }
  async function deleteProject(p) {
    if (!confirm(`Delete “${p.name}” and all of its tasks?`)) return;
    setData((d) => ({
      ...d,
      projects: d.projects.filter((x) => x.id !== p.id),
      tasks: d.tasks.filter((t) => t.project_id !== p.id),
    }));
    touch();
    try { await api(`/api/projects/${p.id}`, { method: 'DELETE' }); await load(true); }
    catch (e) { setError(e.message); }
  }
  async function saveProjectNotes(id, notes) {
    setData((d) => ({ ...d, projects: d.projects.map((p) => (p.id === id ? { ...p, notes } : p)) }));
    touch();
    try { await api(`/api/projects/${id}`, { method: 'PATCH', body: JSON.stringify({ notes }) }); }
    catch (e) { setError(e.message); }
  }
  async function moveProject(id, teamId) {
    setData((d) => ({ ...d, projects: d.projects.map((p) => (p.id === id ? { ...p, team_id: teamId } : p)) }));
    touch();
    try { await api(`/api/projects/${id}`, { method: 'PATCH', body: JSON.stringify({ team_id: teamId }) }); }
    catch (e) { setError(e.message); }
  }
  async function moveProjectOrder(p, dir) {
    const siblings = data.projects.filter((x) => String(x.team_id) === String(p.team_id)).sort(byPos);
    const i = siblings.findIndex((x) => String(x.id) === String(p.id));
    const j = i + dir;
    if (j < 0 || j >= siblings.length) return;
    const other = siblings[j];
    const pi = Number(p.position), pj = Number(other.position);
    setData((d) => ({ ...d, projects: d.projects.map((x) => (String(x.id) === String(p.id) ? { ...x, position: pj } : String(x.id) === String(other.id) ? { ...x, position: pi } : x)) }));
    touch();
    try {
      await api(`/api/projects/${p.id}`, { method: 'PATCH', body: JSON.stringify({ position: pj }) });
      await api(`/api/projects/${other.id}`, { method: 'PATCH', body: JSON.stringify({ position: pi }) });
    } catch (e) { setError(e.message); }
  }

  // ---- tasks ----
  async function addTask() {
    if (selected === null) return;
    touch();
    try { await api('/api/tasks', { method: 'POST', body: JSON.stringify({ project_id: selected }) }); await load(true); }
    catch (e) { setError(e.message); }
  }
  async function addSubtask(parentId) {
    if (selected === null) return;
    touch();
    try {
      await api('/api/tasks', { method: 'POST', body: JSON.stringify({ project_id: selected, parent_id: parentId }) });
      await load(true);
      setExpandedSubtasks((s) => ({ ...s, [parentId]: true }));
    } catch (e) { setError(e.message); }
  }
  function toggleSubtasks(id) { setExpandedSubtasks((s) => ({ ...s, [id]: !s[id] })); }
  function toggleNotes(id) { setExpandedNotes((s) => ({ ...s, [id]: !s[id] })); }
  async function updateTask(id, patch) {
    setData((d) => ({ ...d, tasks: d.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)) }));
    touch();
    try { await api(`/api/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }); }
    catch (e) { setError(e.message); }
  }
  function changeStatus(id, status) {
    updateTask(id, status === 'done' ? { status, archived: true } : { status });
  }
  function restoreTask(id) { updateTask(id, { archived: false }); }
  async function deleteTask(id) {
    if (!confirm('Delete this task? This can’t be undone.')) return;
    setData((d) => ({ ...d, tasks: d.tasks.filter((t) => t.id !== id && String(t.parent_id) !== String(id)) }));
    touch();
    try { await api(`/api/tasks/${id}`, { method: 'DELETE' }); }
    catch (e) { setError(e.message); }
  }

  // ---- people ----
  async function addPerson(name, color) {
    touch();
    try { await api('/api/people', { method: 'POST', body: JSON.stringify({ name, color }) }); await load(true); }
    catch (e) { setError(e.message); }
  }
  async function deletePerson(id) {
    setData((d) => ({
      ...d,
      people: d.people.filter((p) => p.id !== id),
      tasks: d.tasks.map((t) => (t.assignee_id === id ? { ...t, assignee_id: null } : t)),
    }));
    touch();
    try { await api(`/api/people/${id}`, { method: 'DELETE' }); }
    catch (e) { setError(e.message); }
  }

  const viewedTeam = teamView != null ? data.teams.find((t) => String(t.id) === String(teamView)) : null;
  const project = data.projects.find((p) => String(p.id) === String(selected)) || null;
  const allTasks = data.tasks.filter((t) => String(t.project_id) === String(selected));
  const topTasks = allTasks.filter((t) => !t.parent_id);
  const tasks = topTasks.filter((t) => !t.archived);
  const archivedTasks = topTasks.filter((t) => t.archived);
  const doneCount = topTasks.filter((t) => t.status === 'done').length;
  const pct = topTasks.length ? Math.round((doneCount / topTasks.length) * 100) : 0;
  const subtasksByParent = {};
  allTasks.forEach((t) => {
    if (t.parent_id) {
      const k = String(t.parent_id);
      if (!subtasksByParent[k]) subtasksByParent[k] = [];
      subtasksByParent[k].push(t);
    }
  });
  const isSetup = error && /POSTGRES_URL|connection string|connect/i.test(error);

  // Renders one task row plus its (optional) subtask rows and notes editors.
  function renderTaskRow(t, isSub) {
    const owner = data.people.find((p) => String(p.id) === String(t.assignee_id));
    const st = STATUSES[t.status] || STATUSES.not_started;
    const hasNotes = (t.notes || '').trim().length > 0;
    const notesOpen = !!expandedNotes[t.id];
    const subs = isSub ? [] : (subtasksByParent[String(t.id)] || []);
    const subExpanded = !!expandedSubtasks[t.id];
    const subDone = subs.filter((s) => s.status === 'done').length;
    return (
      <Fragment key={t.id}>
        <tr className={`${isSub ? 'subtask-row' : ''}${hasNotes && !notesOpen ? ' has-note-below' : ''}`}>
          <td>
            <div className={isSub ? 'subtask-title-cell' : 'title-cell'}>
              {isSub ? (
                <span className="subtask-arrow">↳</span>
              ) : (
                <button className="subtask-toggle" title="Show / add subtasks" onClick={() => toggleSubtasks(t.id)}>
                  <span className="caret">{subExpanded ? '▾' : '▸'}</span>
                  {subs.length > 0 && <span className="sub-badge">{subDone}/{subs.length}</span>}
                </button>
              )}
              <div className="title-main">
                <input
                  className="task-title"
                  defaultValue={t.title}
                  placeholder={isSub ? 'Untitled subtask' : 'Untitled task'}
                  onBlur={(e) => { if (e.target.value !== t.title) updateTask(t.id, { title: e.target.value }); }}
                />
              </div>
            </div>
          </td>
          <td>
            <div className="cell-owner">
              {owner ? (
                <span className="avatar" style={{ background: owner.color }}>{initials(owner.name)}</span>
              ) : (
                <span className="avatar" style={{ background: '#dcdcdc', color: '#8a8788' }}>–</span>
              )}
              <select className="owner-select" value={t.assignee_id ?? ''} onChange={(e) => updateTask(t.id, { assignee_id: e.target.value || null })}>
                <option value="">Unassigned</option>
                {data.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          </td>
          <td>
            <input type="date" className="date-input" value={t.due_date ?? ''} onChange={(e) => updateTask(t.id, { due_date: e.target.value || null })} />
          </td>
          <td>
            <select
              className="status-select"
              value={t.status}
              style={{ background: st.color, color: t.status === 'not_started' ? '#3a3a3a' : '#fff' }}
              onChange={(e) => (isSub ? updateTask(t.id, { status: e.target.value }) : changeStatus(t.id, e.target.value))}
            >
              {STATUS_ORDER.map((s) => <option key={s} value={s}>{STATUSES[s].label}</option>)}
            </select>
          </td>
          <td className="row-actions">
            <button
              className={`notes-btn ${hasNotes ? 'has-notes' : ''}`}
              title={hasNotes ? 'Edit note' : 'Add a note'}
              onClick={() => toggleNotes(t.id)}
            >📝</button>
            <button className="row-x" title={isSub ? 'Delete subtask' : 'Delete task'} onClick={() => deleteTask(t.id)}>×</button>
          </td>
        </tr>

        {hasNotes && !notesOpen && (
          <tr className="note-preview-row">
            <td colSpan={5}>
              <div className="note-preview" title="Click to edit note" onClick={() => toggleNotes(t.id)}>📝 {t.notes}</div>
            </td>
          </tr>
        )}

        {notesOpen && (
          <tr className="task-notes-row">
            <td colSpan={5}>
              <textarea
                className="task-notes-area"
                defaultValue={t.notes || ''}
                placeholder="Notes — details, blockers, links. Everyone on the team can see this."
                onBlur={(e) => { if ((e.target.value || '') !== (t.notes || '')) updateTask(t.id, { notes: e.target.value }); }}
              />
            </td>
          </tr>
        )}

        {!isSub && subExpanded && (
          <>
            {subs.map((sub) => renderTaskRow(sub, true))}
            <tr className="subtask-add-row">
              <td colSpan={5}><button className="add-subtask-btn" onClick={() => addSubtask(t.id)}>+ Add subtask</button></td>
            </tr>
          </>
        )}
      </Fragment>
    );
  }

  return (
    <>
      <header className="app-header">
        <div className="brand">
          <button className="menu-btn btn-ghost" onClick={() => setSidebarOpen((s) => !s)} aria-label="Toggle teams">☰</button>
          <span className="dot" /> TeamBoard <small>shared project board</small>
        </div>
        <div className="header-actions">
          <button className="btn btn-ghost" onClick={() => setPeopleOpen(true)}>👥 People ({data.people.length})</button>
          <button className="btn btn-lime" onClick={addTeam}>+ New Team</button>
        </div>
      </header>

      <div className="layout">
        <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`} style={{ width: sidebarWidth, flex: `0 0 ${sidebarWidth}px` }}>
          <h2>Teams <button className="add-mini" onClick={addTeam} aria-label="Add team">+</button></h2>
          {[...data.teams].sort(byPos).map((team) => {
            const teamProjects = data.projects.filter((p) => String(p.team_id) === String(team.id)).sort(byPos);
            const collapsed = collapsedTeams[team.id];
            return (
              <div key={team.id} className="team">
                <div className={`team-head ${String(teamView) === String(team.id) ? 'viewing' : ''}`}>
                  <button className="team-caret" onClick={() => toggleTeam(team.id)} aria-label="Collapse team">{collapsed ? '▶' : '▼'}</button>
                  <span className="team-name" onClick={() => { setTeamView(team.id); setSidebarOpen(false); }} onDoubleClick={() => renameTeam(team)} title="Click to view team · double-click to rename">{team.name}</span>
                  <span className="reorder">
                    <button onClick={() => moveTeam(team, -1)} title="Move up">▲</button>
                    <button onClick={() => moveTeam(team, 1)} title="Move down">▼</button>
                  </span>
                  <button className="team-add" title="Add project to this team" onClick={() => addProject(team.id)}>+</button>
                  <button className="team-x" title="Delete team" onClick={() => deleteTeam(team)}>×</button>
                </div>
                {!collapsed && teamProjects.map((p) => {
                  const count = data.tasks.filter((t) => t.project_id === p.id && !t.archived && !t.parent_id).length;
                  return (
                    <div
                      key={p.id}
                      className={`proj ${String(p.id) === String(selected) && teamView == null ? 'active' : ''}`}
                      onClick={() => { setSelected(p.id); setTeamView(null); setSidebarOpen(false); }}
                      onDoubleClick={() => renameProject(p)}
                      title="Click to open · double-click to rename"
                    >
                      <span className="name">{p.name}</span>
                      <span className="count">{count}</span>
                      <span className="reorder">
                        <button onClick={(e) => { e.stopPropagation(); moveProjectOrder(p, -1); }} title="Move up">▲</button>
                        <button onClick={(e) => { e.stopPropagation(); moveProjectOrder(p, 1); }} title="Move down">▼</button>
                      </span>
                      <button className="x" onClick={(e) => { e.stopPropagation(); deleteProject(p); }} aria-label="Delete project">×</button>
                    </div>
                  );
                })}
                {!collapsed && teamProjects.length === 0 && (
                  <p className="team-empty">No projects — click <b>+</b> to add one.</p>
                )}
              </div>
            );
          })}
          {!data.teams.length && loaded && (
            <p style={{ color: '#8a8788', fontSize: 13, padding: '0 8px' }}>No teams yet. Click + to add one.</p>
          )}
          <div className="sidebar-resizer" onMouseDown={startResize} title="Drag to resize" />
        </aside>

        <main className="main">
          {error && (
            <div className={`banner ${isSetup ? 'setup' : ''}`}>
              {isSetup ? (<>⚠️ <b>Database not connected yet.</b> Connect a Postgres database in Vercel and redeploy.</>) : (<>⚠️ {error}</>)}
            </div>
          )}

          {viewedTeam ? (
            <TeamOverview
              team={viewedTeam}
              projects={data.projects.filter((p) => String(p.team_id) === String(viewedTeam.id)).sort(byPos)}
              tasks={data.tasks}
              onOpen={(id) => { setSelected(id); setTeamView(null); }}
              onAddProject={() => addProject(viewedTeam.id)}
              onSaveNotes={saveProjectNotes}
            />
          ) : project ? (
            <>
              <div className="proj-head">
                <h1>{project.name}</h1>
                <div className="progress" title={`${pct}% done`}><span style={{ width: `${pct}%` }} /></div>
                <span className="progress-label">{doneCount}/{topTasks.length} done</span>
                <label className="team-select-wrap">Team
                  <select className="team-select" value={project.team_id ?? ''} onChange={(e) => moveProject(project.id, e.target.value)}>
                    {[...data.teams].sort(byPos).map((tm) => <option key={tm.id} value={tm.id}>{tm.name}</option>)}
                  </select>
                </label>
                <div className="spacer" />
                <button className="btn btn-lime" onClick={addTask}>+ Add Task</button>
              </div>

              <div className="notes-panel">
                <label className="notes-label">📝 Project notes <span>· visible to your whole team</span></label>
                <textarea
                  key={project.id}
                  className="notes-area"
                  defaultValue={project.notes || ''}
                  placeholder="Notes for this project — plans, links, reminders…"
                  onBlur={(e) => { if ((e.target.value || '') !== (project.notes || '')) saveProjectNotes(project.id, e.target.value); }}
                />
              </div>

              <div className="board">
                <div className="board-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th style={{ width: '40%' }}>Task</th>
                        <th style={{ width: '20%' }}>Owner</th>
                        <th style={{ width: '15%' }}>Due date</th>
                        <th style={{ width: '17%' }}>Status</th>
                        <th style={{ width: '8%' }} />
                      </tr>
                    </thead>
                    <tbody>
                      {tasks.map((t) => renderTaskRow(t, false))}
                      {!tasks.length && (
                        <tr><td colSpan={5} style={{ padding: 28, textAlign: 'center', color: '#8a8788' }}>No tasks yet — add your first one.</td></tr>
                      )}
                      <tr><td colSpan={5} style={{ padding: 0 }}>
                        <button className="add-task-btn" onClick={addTask}>+ Add task</button>
                      </td></tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {archivedTasks.length > 0 && (
                <div className="archive">
                  <button className="archive-toggle" onClick={() => setShowArchived((s) => !s)}>
                    🗄 Archived ({archivedTasks.length}) {showArchived ? '▲' : '▼'}
                  </button>
                  {showArchived && (
                    <div className="board archive-board">
                      <div className="board-scroll">
                        <table>
                          <tbody>
                            {archivedTasks.map((t) => {
                              const owner = data.people.find((p) => String(p.id) === String(t.assignee_id));
                              const st = STATUSES[t.status] || STATUSES.done;
                              return (
                                <tr key={t.id} className="archived-row">
                                  <td style={{ width: '40%' }}><span className="archived-title">{t.title || 'Untitled task'}</span></td>
                                  <td style={{ width: '20%' }}>
                                    <div className="cell-owner">
                                      {owner ? (
                                        <span className="avatar" style={{ background: owner.color }}>{initials(owner.name)}</span>
                                      ) : (
                                        <span className="avatar" style={{ background: '#dcdcdc', color: '#8a8788' }}>–</span>
                                      )}
                                      <span className="archived-owner">{owner ? owner.name : 'Unassigned'}</span>
                                    </div>
                                  </td>
                                  <td style={{ width: '15%' }} className="archived-due">{t.due_date || '—'}</td>
                                  <td style={{ width: '17%' }}>
                                    <span className="status-pill" style={{ background: st.color, color: t.status === 'not_started' ? '#3a3a3a' : '#fff' }}>{st.label}</span>
                                  </td>
                                  <td style={{ width: '8%', whiteSpace: 'nowrap', textAlign: 'right' }}>
                                    <button className="restore-btn" title="Restore to the board" onClick={() => restoreTask(t.id)}>↩</button>
                                    <button className="row-x" title="Delete task" onClick={() => deleteTask(t.id)}>×</button>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          ) : (
            loaded && !error && (
              <div className="empty">
                {data.teams.length === 0 ? (
                  <>
                    <h3>Create your first team</h3>
                    <p>Teams group your projects. Add a team, then add projects inside it.</p>
                    <button className="btn btn-lime" onClick={addTeam}>+ New Team</button>
                  </>
                ) : (
                  <>
                    <h3>Pick a project or team</h3>
                    <p>Click a project in the sidebar to open its board, or click a team name to see its overview.</p>
                  </>
                )}
              </div>
            )
          )}
        </main>
      </div>

      {peopleOpen && (
        <PeopleModal people={data.people} onAdd={addPerson} onDelete={deletePerson} onClose={() => setPeopleOpen(false)} />
      )}
    </>
  );
}

function TeamOverview({ team, projects, tasks, onOpen, onAddProject, onSaveNotes }) {
  return (
    <>
      <div className="proj-head">
        <h1>{team.name}</h1>
        <span className="progress-label">{projects.length} project{projects.length !== 1 ? 's' : ''}</span>
        <div className="spacer" />
        <button className="btn btn-lime" onClick={onAddProject}>+ Add Project</button>
      </div>
      {projects.length === 0 ? (
        <div className="empty">
          <h3>No projects in this team yet</h3>
          <p>Click “+ Add Project” to create one.</p>
        </div>
      ) : (
        <div className="overview-grid">
          {projects.map((p) => {
            const count = tasks.filter((t) => String(t.project_id) === String(p.id) && !t.archived && !t.parent_id).length;
            return (
              <div key={p.id} className="overview-card">
                <div className="overview-card-head">
                  <button className="overview-open" onClick={() => onOpen(p.id)}>{p.name}</button>
                  <span className="count">{count} task{count !== 1 ? 's' : ''}</span>
                </div>
                <textarea
                  key={p.id}
                  className="overview-notes"
                  defaultValue={p.notes || ''}
                  placeholder="Project notes…"
                  onBlur={(e) => { if ((e.target.value || '') !== (p.notes || '')) onSaveNotes(p.id, e.target.value); }}
                />
                <button className="overview-open-link" onClick={() => onOpen(p.id)}>Open board →</button>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

function PeopleModal({ people, onAdd, onDelete, onClose }) {
  const [name, setName] = useState('');
  const [color, setColor] = useState(PERSON_COLORS[0]);

  const submit = async () => {
    const n = name.trim();
    if (!n) return;
    await onAdd(n, color);
    setName('');
    setColor(PERSON_COLORS[Math.floor(Math.random() * PERSON_COLORS.length)]);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Team members</h2>
        {people.map((p) => (
          <div key={p.id} className="person-row">
            <span className="avatar" style={{ background: p.color }}>{initials(p.name)}</span>
            <span className="nm">{p.name}</span>
            <button className="link-x" title="Remove" onClick={() => onDelete(p.id)}>×</button>
          </div>
        ))}
        {!people.length && <p style={{ color: '#8a8788', fontSize: 13 }}>No team members yet. Add someone below.</p>}

        <div style={{ marginTop: 16 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: '#5B5859' }}>Add a person</label>
          <input className="field" placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submit(); }} />
          <div className="swatches">
            {PERSON_COLORS.map((c) => (
              <span key={c} className={`sw ${c === color ? 'sel' : ''}`} style={{ background: c }} onClick={() => setColor(c)} />
            ))}
          </div>
        </div>

        <div className="modal-actions">
          <button className="btn btn-plain" onClick={onClose}>Close</button>
          <button className="btn btn-ink" onClick={submit}>Add person</button>
        </div>
      </div>
    </div>
  );
}
