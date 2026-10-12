'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { IconAlert, IconArchive, IconNote, IconRestore } from '@/app/icons';
import { SyncedTextarea } from '@/app/synced';
import { api, ConflictError } from '@/app/_ui/api';
import useServerState, { mergeById } from '@/app/_ui/useServerState';
import { RefreshPill } from '@/app/_ui/useRefresh';
import ConflictNotice from '@/app/_ui/ConflictNotice';
import { useConfirm } from '@/app/_ui/ConfirmDialog';
import Crumbs from '@/app/_ui/Crumbs';
import { ProjectMeetings } from '@/app/_ui/meetings';
import ProjectHeader from './ProjectHeader';
import TaskTable from './TaskTable';
import ArchivedTasks from './ArchivedTasks';
import ProjectInfo from './ProjectInfo';
import MembersPanel from './MembersPanel';
import useBoardSync from './useBoardSync';

// The project board (design §2.1, §2.3): header (rename, team move, archive, delete), progress, notes, the task
// table with subtasks and task notes (cards that open the task page on phones), archived tasks, meetings and
// series, additional info and the Members panel. Server-rendered data, optimistic edits, and a 20 s poll of the
// project's rev counter instead of the old whole-database poll (§7.5).

const same = (a, b) => a != null && b != null && String(a) === String(b);
const LISTS = { task: 'tasks', info: 'info', meeting: 'meetings', series: 'series' };
const URLS = {
  task: (id) => `/api/tasks/${id}`,
  info: (id) => `/api/info/${id}`,
  meeting: (id) => `/api/project-meetings/${id}`,
  series: (id) => `/api/meeting-series/${id}`,
  project: (id) => `/api/projects/${id}`,
};
const SS_ARCHIVED = 'tb_show_archived_tasks';

export function useMounted() {
  const [m, setM] = useState(false);
  useEffect(() => { setM(true); }, []);
  return m;
}

export default function ProjectBoard({ initial }) {
  const router = useRouter();
  const [d, setD, touch] = useServerState(initial);
  const p = d.project;
  const pid = String(p.id);
  const ro = !!p.archived;
  const mounted = useMounted();
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);
  const [conflicts, setConflicts] = useState({});         // 'task:12:title' -> { conflict, mine, retry }
  const [expandedSubs, setExpandedSubs] = useState({});
  const [expandedNotes, setExpandedNotes] = useState({});
  const [showArchived, setShowArchived] = useState(false);
  const [focusId, setFocusId] = useState(null);
  const [draftDirty, setDraftDirty] = useState(false);
  const [confirmUI, ask] = useConfirm();
  const toastTimer = useRef(null);

  // 20 s rev poll that ignores our own writes, and refreshes that can't undo them (useBoardSync.js).
  const { stale, refresh, wrote, refreshNow } = useBoardSync({
    projectId: pid, initialRev: initial.project.rev, initialArchived: initial.project.archived, dirty: draftDirty, props: initial,
  });

  // The archived section stays open or closed across projects for this tab (as before).
  useEffect(() => {
    try { setShowArchived(sessionStorage.getItem(SS_ARCHIVED) === '1'); } catch {}
  }, []);
  const toggleArchived = () => setShowArchived((s) => {
    try { sessionStorage.setItem(SS_ARCHIVED, s ? '0' : '1'); } catch {}
    return !s;
  });
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  const showToast = useCallback((msg) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4500);
  }, []);
  const fail = useCallback((e) => { if (e?.status !== 401) setError(e?.message || 'Something went wrong — please try again.'); }, []);

  // ---------------------------------------------------------------- local state helpers
  const mergeLocal = useCallback((kind, id, patch) => {
    if (kind === 'project') { setD((x) => ({ ...x, project: { ...x.project, ...patch } })); return; }
    const key = LISTS[kind];
    setD((x) => ({ ...x, [key]: x[key].map((r) => (same(r.id, id) ? { ...r, ...patch } : r)) }));
  }, [setD]);
  const removeLocal = useCallback((kind, pred) => {
    const key = LISTS[kind];
    setD((x) => ({ ...x, [key]: x[key].filter((r) => !pred(r)) }));
  }, [setD]);
  const appendLocal = useCallback((kind, row) => {
    const key = LISTS[kind];
    setD((x) => ({ ...x, [key]: mergeById(x[key], row) }));
  }, [setD]);

  const clearConflict = useCallback((key) => setConflicts((c) => {
    if (!c[key]) return c;
    const n = { ...c };
    delete n[key];
    return n;
  }), []);

  // Someone deleted what we were editing (404 gone): drop it here and reload the page's data.
  const handleGone = useCallback((kind, id, e) => {
    if (e?.status === 404 && kind !== 'project') { removeLocal(kind, (r) => same(r.id, id)); refreshNow(); }
  }, [removeLocal, refreshNow]);

  // Text fields: send the value and the base it started from; adopt the stored row (its value becomes the
  // field's next base). A 409 puts their text in the field and a ConflictNotice under it.
  const saveText = useCallback(async (kind, id, field, value, base) => {
    const key = `${kind}:${id}:${field}`;
    clearConflict(key);
    mergeLocal(kind, id, { [field]: value });
    try {
      const r = await api(URLS[kind](id), { method: 'PATCH', body: { [field]: value, base: { [field]: base } } });
      wrote();
      if (r?.row) mergeLocal(kind, id, r.row);
      if (r?.added_members?.length) { showToast(addedText(r.added_members)); refreshNow(); }
      return r?.row ? r.row[field] : value;
    } catch (e) {
      if (e instanceof ConflictError) {
        if (e.current) mergeLocal(kind, id, e.current);
        setConflicts((c) => ({ ...c, [key]: { conflict: e, mine: value, retry: (theirs) => saveText(kind, id, field, value, theirs) } }));
      } else {
        fail(e);
        handleGone(kind, id, e);
      }
      throw e;
    }
  }, [clearConflict, mergeLocal, showToast, refreshNow, fail, handleGone, wrote]);

  const conflictUI = useCallback((key) => {
    const c = conflicts[key];
    if (!c) return null;
    const field = key.split(':').pop();
    return (
      <ConflictNotice
        conflict={c.conflict}
        field={field}
        mine={c.mine}
        onKeepMine={async (theirs) => { clearConflict(key); try { await c.retry(theirs); } catch {} }}
        onUseTheirs={() => clearConflict(key)}
      />
    );
  }, [conflicts, clearConflict]);

  // ---------------------------------------------------------------- tasks
  const patchTask = useCallback(async (id, patch, local = patch) => {
    mergeLocal('task', id, local);
    try {
      const r = await api(URLS.task(id), { method: 'PATCH', body: patch });
      wrote();
      if (r?.row) mergeLocal('task', id, r.row);
      if (r?.added_members?.length) { showToast(addedText(r.added_members)); refreshNow(); }
      return r?.row;
    } catch (e) {
      fail(e);
      handleGone('task', id, e);
      refreshNow();                                    // put the server's value back
      return null;
    }
  }, [mergeLocal, showToast, refreshNow, fail, handleGone, wrote]);

  // A top-level task set to Done drops into Archived at once (the server archives it in the same statement);
  // subtasks stay in place (rule 20).
  const setStatus = useCallback((t, status) => {
    const local = status === 'done' && t.parent_id == null ? { status, archived: true } : { status };
    return patchTask(t.id, { status }, local);
  }, [patchTask]);

  const createTask = useCallback(async (body) => {
    touch();
    try {
      const r = await api('/api/tasks', { method: 'POST', body: { project_id: pid, ...body } });
      wrote();
      const { added_members: added, ...row } = r || {};
      if (row.id != null) appendLocal('task', row);
      if (added?.length) showToast(addedText(added));
      refreshNow();
      return row;
    } catch (e) { fail(e); return null; }
  }, [touch, pid, appendLocal, showToast, refreshNow, fail, wrote]);

  const addTask = useCallback(async () => {
    const row = await createTask({});
    if (row?.id != null) setFocusId(String(row.id));
    return row;
  }, [createTask]);
  // Phones: a new task opens on its own page, with the title ready to type.
  const addTaskAndOpen = useCallback(async () => {
    const row = await createTask({});
    if (row?.id != null) router.push(`/projects/${pid}/tasks/${row.id}`);
  }, [createTask, router, pid]);
  const addSubtask = useCallback(async (parentId) => {
    const row = await createTask({ parent_id: parentId });
    if (row?.id != null) {
      setExpandedSubs((s) => ({ ...s, [parentId]: true }));
      setFocusId(String(row.id));
    }
  }, [createTask]);

  const deleteTask = useCallback(async (t) => {
    if (!(await ask({ title: 'Delete this task? This can’t be undone.', confirmLabel: 'Delete', danger: true }))) return;
    removeLocal('task', (x) => same(x.id, t.id) || same(x.parent_id, t.id));
    try { await api(URLS.task(t.id), { method: 'DELETE' }); wrote(); refreshNow(); } catch (e) { fail(e); refreshNow(); }
  }, [ask, removeLocal, refreshNow, fail, wrote]);

  // Restore keeps status Done (rule 22): the task shows Done on the board again.
  const restoreTask = useCallback((t) => patchTask(t.id, { archived: false }), [patchTask]);

  // ---------------------------------------------------------------- project
  const patchProject = useCallback(async (patch) => {
    touch();
    try {
      const r = await api(URLS.project(pid), { method: 'PATCH', body: patch });
      wrote();
      if (r?.row) mergeLocal('project', pid, r.row);
      refreshNow();
      return true;
    } catch (e) { fail(e); refreshNow(); return false; }
  }, [touch, pid, mergeLocal, refreshNow, fail, wrote]);

  const deleteProject = useCallback(async () => {
    try {
      await api(URLS.project(pid), { method: 'DELETE' });
      router.replace(p.team_id != null ? `/teams/${p.team_id}` : '/');
      router.refresh();
    } catch (e) { fail(e); }
  }, [pid, p.team_id, router, fail]);

  // ---------------------------------------------------------------- info rows
  const addInfo = useCallback(async () => {
    touch();
    try {
      const row = await api('/api/info', { method: 'POST', body: { project_id: pid } });
      wrote();
      if (row?.id != null) { appendLocal('info', row); setFocusId(`info:${row.id}`); }
      refreshNow();
    } catch (e) { fail(e); }
  }, [touch, pid, appendLocal, refreshNow, fail, wrote]);
  const deleteInfo = useCallback(async (r) => {
    const label = (r.label || '').trim();
    if (!(await ask({ title: label ? `Delete “${label}”?` : 'Delete this row?', lines: ['This can’t be undone.'], confirmLabel: 'Delete', danger: true }))) return;
    removeLocal('info', (x) => same(x.id, r.id));
    try { await api(URLS.info(r.id), { method: 'DELETE' }); wrote(); refreshNow(); } catch (e) { fail(e); refreshNow(); }
  }, [ask, removeLocal, refreshNow, fail, wrote]);

  // ---------------------------------------------------------------- meetings and series
  const createMeeting = useCallback(async (seriesId, fields) => {
    touch();
    const row = await api('/api/project-meetings', { method: 'POST', body: { project_id: pid, series_id: seriesId || null, ...fields } });
    wrote();
    if (row?.id != null) appendLocal('meeting', row);
    refreshNow();
    return row;
  }, [touch, pid, appendLocal, refreshNow, wrote]);
  const saveMeeting = useCallback(async (m, patch, base) => {
    touch();
    try {
      const r = await api(URLS.meeting(m.id), { method: 'PATCH', body: { ...patch, base } });
      wrote();
      if (r?.row) mergeLocal('meeting', m.id, r.row);
    } catch (e) {
      if (e instanceof ConflictError && e.current) mergeLocal('meeting', m.id, e.current);
      else handleGone('meeting', m.id, e);
      throw e;
    }
  }, [touch, mergeLocal, handleGone, wrote]);
  const deleteMeeting = useCallback(async (m) => {
    removeLocal('meeting', (x) => same(x.id, m.id));
    try { await api(URLS.meeting(m.id), { method: 'DELETE' }); wrote(); refreshNow(); } catch (e) { fail(e); refreshNow(); }
  }, [removeLocal, refreshNow, fail, wrote]);
  const addSeries = useCallback(async (name) => {
    touch();
    try {
      const row = await api('/api/meeting-series', { method: 'POST', body: { project_id: pid, name } });
      wrote();
      if (row?.id != null) appendLocal('series', row);
      refreshNow();
    } catch (e) { fail(e); throw e; }
  }, [touch, pid, appendLocal, refreshNow, fail, wrote]);
  // A rename that loses a race shows a conflict notice under the series head (the dialog closes either way).
  const renameSeries = useCallback(async (sv, name) => {
    try { await saveText('series', sv.id, 'name', name, sv.name); } catch {}
  }, [saveText]);
  const deleteSeries = useCallback(async (sv) => {
    setD((x) => ({ ...x, series: x.series.filter((s) => !same(s.id, sv.id)), meetings: x.meetings.filter((m) => !same(m.series_id, sv.id)) }));
    try { await api(URLS.series(sv.id), { method: 'DELETE' }); wrote(); refreshNow(); } catch (e) { fail(e); refreshNow(); }
  }, [setD, refreshNow, fail, wrote]);

  // ---------------------------------------------------------------- members
  const addMembers = useCallback(async (ids) => {
    const r = await api(`/api/projects/${pid}/members`, { method: 'POST', body: { user_ids: ids } });
    if (r?.added?.length) wrote();
    refreshNow();
    return r;
  }, [pid, refreshNow, wrote]);
  const removeMember = useCallback(async (m) => {
    setD((x) => ({ ...x, members: x.members.filter((y) => !same(y.user_id, m.user_id)) }));
    try {
      const r = await api(`/api/projects/${pid}/members/${m.user_id}`, { method: 'DELETE' });
      if (r && r.still_visible === false) { router.replace('/?notice=project_gone'); return; }
      if (r?.removed) wrote();
      refreshNow();
    } catch (e) { fail(e); refreshNow(); }
  }, [setD, pid, router, refreshNow, fail, wrote]);

  // ---------------------------------------------------------------- derived
  const { active, archived, subsByParent, doneCount, total } = useMemo(() => {
    const top = d.tasks.filter((t) => t.parent_id == null);
    const subs = {};
    for (const t of d.tasks) {
      if (t.parent_id == null) continue;
      const k = String(t.parent_id);
      (subs[k] ||= []).push(t);
    }
    return {
      active: top.filter((t) => !t.archived),
      archived: top.filter((t) => t.archived),
      subsByParent: subs,
      doneCount: top.filter((t) => t.status === 'done').length,   // archived Done tasks still count (rule 21)
      total: top.length,
    };
  }, [d.tasks]);
  const pct = total ? Math.round((doneCount / total) * 100) : 0;

  const actions = {
    patchTask, setStatus, addTask, addTaskAndOpen, addSubtask, deleteTask, restoreTask,
    saveTaskText: (id, field, v, base) => saveText('task', id, field, v, base),
    saveInfoText: (id, field, v, base) => saveText('info', id, field, v, base),
    saveProjectText: (field, v, base) => saveText('project', pid, field, v, base),
    patchProject, deleteProject, addInfo, deleteInfo, addMembers, removeMember,
  };
  const ctx = {
    pid, people: d.people, ro, mounted, focusId, actions, conflictUI,
    expandedSubs, expandedNotes,
    toggleSubs: (id) => setExpandedSubs((s) => ({ ...s, [id]: !s[id] })),
    toggleNotes: (id) => setExpandedNotes((s) => ({ ...s, [id]: !s[id] })),
  };

  const crumbs = [
    { label: 'Offices', href: '/offices' },
    p.office_id != null ? { label: p.office_name, href: p.office_archived ? undefined : `/offices/${p.office_id}` } : null,
    p.team_id != null ? { label: p.team_name, href: p.team_archived || p.office_archived ? undefined : `/teams/${p.team_id}` } : null,
    { label: p.name },
  ];

  return (
    <div className="project-board">
      <Crumbs items={crumbs} />
      {error && (
        <div className="banner" role="alert">
          <IconAlert size={16} />
          <span>{error}</span>
          <span className="spacer" />
          <button type="button" className="btn btn-plain btn-sm" onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}
      {ro && (
        <div className="banner setup proj-archived-banner" role="status">
          <IconArchive size={16} />
          <span>This project was archived. It’s read-only until someone restores it.</span>
          <span className="spacer" />
          {d.can.manage && (
            <button type="button" className="btn btn-ink btn-sm wi" onClick={() => patchProject({ archived: false })}>
              <IconRestore size={14} /> Restore project
            </button>
          )}
        </div>
      )}

      <ProjectHeader
        project={p}
        can={d.can}
        teams={d.teams}
        pct={pct}
        doneCount={doneCount}
        total={total}
        memberCount={d.members.length}
        ro={ro}
        actions={actions}
        conflictUI={conflictUI}
        ask={ask}
      />

      <div className="notes-panel">
        <label className="notes-label" htmlFor={`pnotes-${pid}`}><IconNote size={14} /> Project notes <span>· visible to your whole team</span></label>
        {ro ? (
          <div className="notes-area notes-ro">{p.notes || <span className="muted">No notes.</span>}</div>
        ) : (
          <SyncedTextarea
            key={pid}
            id={`pnotes-${pid}`}
            className="notes-area"
            value={p.notes || ''}
            placeholder="Notes for this project — plans, links, reminders…"
            onSave={(v, base) => actions.saveProjectText('notes', v, base)}
          />
        )}
        {conflictUI(`project:${pid}:notes`)}
      </div>

      <TaskTable tasks={active} subsByParent={subsByParent} ctx={ctx} />

      {archived.length > 0 && (
        <ArchivedTasks tasks={archived} subsByParent={subsByParent} ctx={ctx} open={showArchived} onToggle={toggleArchived} />
      )}

      <ProjectMeetings
        key={pid}
        meetings={d.meetings}
        series={d.series}
        readOnly={ro}
        onCreate={createMeeting}
        onSave={saveMeeting}
        onDelete={deleteMeeting}
        onAddSeries={addSeries}
        onRenameSeries={renameSeries}
        onDeleteSeries={deleteSeries}
        onDiscard={() => refreshNow()}
        onDirtyChange={setDraftDirty}
        seriesNotice={(sv) => conflictUI(`series:${sv.id}:name`)}
      />

      <ProjectInfo rows={d.info} ctx={ctx} />

      <MembersPanel project={p} members={d.members} ro={ro} actions={actions} ask={ask} />

      {toast && <div className="board-toast" role="status">{toast}</div>}
      {stale && <RefreshPill onClick={refresh} />}
      {confirmUI}
    </div>
  );
}

export function addedText(list) {
  const names = list.map((m) => m.name).filter(Boolean);
  if (!names.length) return 'Added to this project.';
  if (names.length === 1) return `${names[0]} was added to this project.`;
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]} were added to this project.`;
}
