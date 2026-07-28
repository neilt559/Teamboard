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
  const [error, setError] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [collapsedTeams, setCollapsedTeams] = useState({});
  const [expandedTask, setExpandedTask] = useState(null);
  const [expandedSubtasks, setExpandedSubtasks] = useState({});
  const guard = useRef(0); // skip background refreshes briefly after a local edit

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

  // keep a valid project selected
  useEffect(() => {
    if (!data.projects.length) { if (selected !== null) setSelected(null); return; }
    if (selected === null || !data.projects.find((p) => String(p.id) === String(selected))) {
      setSelected(data.projects[0].id);
    }
  }, [data.projects, selected]);

  const touch = () => { guard.current = Date.now() + 2500; };

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

  // ---- projects ----
  async function addProject(teamId) {
    const name = prompt('New project name', 'New Project');
    if (name === null) return;
    touch();
    try {
      const np = await api('/api/projects', { method: 'POST', body: JSON.stringify({ name: name.trim() || 'New Project', team_id: teamId }) });
      await load(true);
      if (np && np.id) { setSelected(np.id); setCollapsedTeams((c) => ({ ...c, [teamId]: false })); setSidebarOpen(false); }
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

  // ---- tasks ----
  async function addTask() {
    if (selected === null) return;
    touch();
    try {
      await api('/api/tasks', { method: 'POST', body: JSON.stringify({ project_id: selected }) });
      await load(true);
    } catch (e) { setError(e.message); }
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
  async function updateTask(id, patch) {
    setData((d) => ({ ...d, tasks: d.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)) }));
    touch();
    try { await api(`/api/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }); }
    catch (e) { setError(e.message); }
  }
  // Marking a task Done also archives it (moves it out of the active list).
  function changeStatus(id, status) {
    updateTask(id, status === 'done' ? { status, archived: true } : { status });
  }
  function restoreTask(id) { updateTask(id, { archived: false }); }
  async function deleteTask(id) {
    if (!confirm('Delete this task? This can’t be undone.')) return;
    // Drop the task and any of its subtasks from view immediately.
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
        <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
          <h2>Teams <button className="add-mini" onClick={addTeam} aria-label="Add team">+</button></h2>
          {data.teams.map((team) => {
            const teamProjects = data.projects.filter((p) => String(p.team_id) === String(team.id));
            const collapsed = collapsedTeams[team.id];
            return (
              <div key={team.id} className="team">
                <div className="team-head">
                  <button className="team-caret" onClick={() => toggleTeam(team.id)} aria-label="Collapse team">{collapsed ? '▶' : '▼'}</button>
                  <span className="team-name" onDoubleClick={() => renameTeam(team)} title="Double-click to rename">{team.name}</span>
                  <button className="team-add" title="Add project to this team" onClick={() => addProject(team.id)}>+</button>
                  <button className="team-x" title="Delete team" onClick={() => deleteTeam(team)}>×</button>
                </div>
                {!collapsed && teamProjects.map((p) => {
                  const count = data.tasks.filter((t) => t.project_id === p.id && !t.archived && !t.parent_id).length;
                  return (
                    <div
                      key={p.id}
                      className={`proj ${String(p.id) === String(selected) ? 'active' : ''}`}
                      onClick={() => { setSelected(p.id); setSidebarOpen(false); }}
                      onDoubleClick={() => renameProject(p)}
                      title="Double-click to rename"
                    >
                      <span className="name">{p.name}</span>
                      <span className="count">{count}</span>
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
        </aside>

        <main className="main">
          {error && (
            <div className={`banner ${isSetup ? 'setup' : ''}`}>
              {isSetup ? (
                <>⚠️ <b>Database not connected yet.</b> In your Vercel project open <b>Storage → Create Database → Postgres</b>, connect it to this project, then redeploy.</>
              ) : (
                <>⚠️ {error}</>
              )}
            </div>
          )}

          {!project && loaded && !error && (
            <div className="empty">
              {data.teams.length === 0 ? (
                <>
                  <h3>Create your first team</h3>
                  <p>Teams group your projects. Add a team, then add projects inside it.</p>
                  <button className="btn btn-lime" onClick={addTeam}>+ New Team</button>
                </>
              ) : (
                <>
                  <h3>Add a project</h3>
                  <p>Click the <b>+</b> next to a team in the sidebar to add a project, then add tasks.</p>
                </>
              )}
            </div>
          )}

          {project && (
            <>
              <div className="proj-head">
                <h1>{project.name}</h1>
                <div className="progress" title={`${pct}% done`}><span style={{ width: `${pct}%` }} /></div>
                <span className="progress-label">{doneCount}/{allTasks.length} done</span>
                <label className="team-select-wrap">Team
                  <select className="team-select" value={project.team_id ?? ''} onChange={(e) => moveProject(project.id, e.target.value)}>
                    {data.teams.map((tm) => <option key={tm.id} value={tm.id}>{tm.name}</option>)}
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
                      {tasks.map((t) => {
                        const owner = data.people.find((p) => String(p.id) === String(t.assignee_id));
                        const st = STATUSES[t.status] || STATUSES.not_started;
                        const expanded = expandedTask === t.id;
                        const subs = subtasksByParent[String(t.id)] || [];
                        const subExpanded = !!expandedSubtasks[t.id];
                        const subDone = subs.filter((s) => s.status === 'done').length;
                        return (
                          <Fragment key={t.id}>
                            <tr>
                              <td>
                                <div className="title-cell">
                                  <button className="subtask-toggle" title="Show / add subtasks" onClick={() => toggleSubtasks(t.id)}>
                                    <span className="caret">{subExpanded ? '▾' : '▸'}</span>
                                    {subs.length > 0 && <span className="sub-badge">{subDone}/{subs.length}</span>}
                                  </button>
                                  <input
                                    className="task-title"
                                    defaultValue={t.title}
                                    placeholder="Untitled task"
                                    onBlur={(e) => { if (e.target.value !== t.title) updateTask(t.id, { title: e.target.value }); }}
                                  />
                                </div>
                              </td>
                              <td>
                                <div className="cell-owner">
                                  {owner ? (
                                    <span className="avatar" style={{ background: owner.color }}>{initials(owner.name)}</span>
                                  ) : (
                                    <span className="avatar" style={{ background: '#dcdcdc', color: '#8a8788' }}>–</span>
                                  )}
                                  <select
                                    className="owner-select"
                                    value={t.assignee_id ?? ''}
                                    onChange={(e) => updateTask(t.id, { assignee_id: e.target.value || null })}
                                  >
                                    <option value="">Unassigned</option>
                                    {data.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                                  </select>
                                </div>
                              </td>
                              <td>
                                <input
                                  type="date"
                                  className="date-input"
                                  value={t.due_date ?? ''}
                                  onChange={(e) => updateTask(t.id, { due_date: e.target.value || null })}
                                />
                              </td>
                              <td>
                                <select
                                  className="status-select"
                                  value={t.status}
                                  style={{ background: st.color, color: t.status === 'not_started' ? '#3a3a3a' : '#fff' }}
                                  onChange={(e) => changeStatus(t.id, e.target.value)}
                                >
                                  {STATUS_ORDER.map((s) => <option key={s} value={s}>{STATUSES[s].label}</option>)}
                                </select>
                              </td>
                              <td className="row-actions">
                                <button
                                  className={`notes-btn ${(t.notes || '').trim() ? 'has-notes' : ''}`}
                                  title={(t.notes || '').trim() ? 'Task notes (has notes)' : 'Add task notes'}
                                  onClick={() => setExpandedTask(expanded ? null : t.id)}
                                >📝</button>
                                <button className="row-x" title="Delete task" onClick={() => deleteTask(t.id)}>×</button>
                              </td>
                            </tr>
                            {subExpanded && (
                              <>
                                {subs.map((sub) => {
                                  const sowner = data.people.find((p) => String(p.id) === String(sub.assignee_id));
                                  const sst = STATUSES[sub.status] || STATUSES.not_started;
                                  return (
                                    <tr key={sub.id} className="subtask-row">
                                      <td>
                                        <div className="subtask-title-cell">
                                          <span className="subtask-arrow">↳</span>
                                          <input
                                            className="task-title"
                                            defaultValue={sub.title}
                                            placeholder="Untitled subtask"
                                            onBlur={(e) => { if (e.target.value !== sub.title) updateTask(sub.id, { title: e.target.value }); }}
                                          />
                                        </div>
                                      </td>
                                      <td>
                                        <div className="cell-owner">
                                          {sowner ? (
                                            <span className="avatar" style={{ background: sowner.color }}>{initials(sowner.name)}</span>
                                          ) : (
                                            <span className="avatar" style={{ background: '#dcdcdc', color: '#8a8788' }}>–</span>
                                          )}
                                          <select
                                            className="owner-select"
                                            value={sub.assignee_id ?? ''}
                                            onChange={(e) => updateTask(sub.id, { assignee_id: e.target.value || null })}
                                          >
                                            <option value="">Unassigned</option>
                                            {data.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                                          </select>
                                        </div>
                                      </td>
                                      <td>
                                        <input
                                          type="date"
                                          className="date-input"
                                          value={sub.due_date ?? ''}
                                          onChange={(e) => updateTask(sub.id, { due_date: e.target.value || null })}
                                        />
                                      </td>
                                      <td>
                                        <select
                                          className="status-select"
                                          value={sub.status}
                                          style={{ background: sst.color, color: sub.status === 'not_started' ? '#3a3a3a' : '#fff' }}
                                          onChange={(e) => updateTask(sub.id, { status: e.target.value })}
                                        >
                                          {STATUS_ORDER.map((s) => <option key={s} value={s}>{STATUSES[s].label}</option>)}
                                        </select>
                                      </td>
                                      <td className="row-actions">
                                        <button className="row-x" title="Delete subtask" onClick={() => deleteTask(sub.id)}>×</button>
                                      </td>
                                    </tr>
                                  );
                                })}
                                <tr className="subtask-add-row">
                                  <td colSpan={5}>
                                    <button className="add-subtask-btn" onClick={() => addSubtask(t.id)}>+ Add subtask</button>
                                  </td>
                                </tr>
                              </>
                            )}
                            {expanded && (
                              <tr className="task-notes-row">
                                <td colSpan={5}>
                                  <label className="task-notes-label">Notes for “{t.title || 'this task'}”</label>
                                  <textarea
                                    key={t.id}
                                    className="task-notes-area"
                                    defaultValue={t.notes || ''}
                                    placeholder="Details, blockers, links — everyone on the team can see this."
                                    onBlur={(e) => { if ((e.target.value || '') !== (t.notes || '')) updateTask(t.id, { notes: e.target.value }); }}
                                  />
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
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
          )}
        </main>
      </div>

      {peopleOpen && (
        <PeopleModal
          people={data.people}
          onAdd={addPerson}
          onDelete={deletePerson}
          onClose={() => setPeopleOpen(false)}
        />
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
          <input
            className="field"
            placeholder="Full name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
          />
          <div className="swatches">
            {PERSON_COLORS.map((c) => (
              <span
                key={c}
                className={`sw ${c === color ? 'sel' : ''}`}
                style={{ background: c }}
                onClick={() => setColor(c)}
              />
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
