'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { IconAlert, IconArchive, IconCheck, IconNote, IconRestore } from '@/app/icons';
import { FormattedNotes, SyncedNotesEditor } from '@/app/notes-format';
import { api, ConflictError, settleWrites, trackWrite } from '@/app/_ui/api';
import useServerState, { mergeById } from '@/app/_ui/useServerState';
import { RefreshPill } from '@/app/_ui/useRefresh';
import ConflictNotice from '@/app/_ui/ConflictNotice';
import { useConfirm } from '@/app/_ui/ConfirmDialog';
import Crumbs from '@/app/_ui/Crumbs';
import { ProjectMeetings, NEW_SERIES } from '@/app/_ui/meetings';
import ProjectHeader from './ProjectHeader';
import TaskTable from './TaskTable';
import ArchivedTasks from './ArchivedTasks';
import ProjectInfo from './ProjectInfo';
import ReportLink from './ReportLink';
import MembersPanel from './MembersPanel';
import Submittals from './Submittals';
import AttentionItems from './AttentionItems';
import ProjectDetailsDialog from './ProjectDetailsDialog';
import useBoardSync from './useBoardSync';
import { projectTitle, parseStages } from '@/lib/projects';

// The project board (design §2.1, §2.3): header (rename, team move, archive, delete), progress, notes, the task
// table with subtasks and task notes (cards that open the task page on phones), archived tasks, meetings and
// series, additional info and the Members panel. Server-rendered data, optimistic edits, and a 20 s poll of the
// project's rev counter instead of the old whole-database poll (§7.5).
// A6 (design-amendments A6.5): the header's schedule status, stage stepper, Project details and Generate report;
// the notes are the "Status Report" (it goes to the owner in the weekly report); the Submittals section. Every A6
// write bumps the project's rev like any other write (wrote()).
// A8 (design-amendments A8.3): the Attention Items section after Submittals.
// A9 (design-amendments A9.2): ONE Meetings section (Upcoming / Past, minutes inside, series as a label) replaces
// both the meeting minutes and A6's Upcoming meetings; meetings and series are archived, never deleted.

const same = (a, b) => a != null && b != null && String(a) === String(b);
const nPeople = (n) => `${n} ${n === 1 ? 'person' : 'people'}`;
const LISTS = { task: 'tasks', info: 'info', meeting: 'meetings', series: 'series', submittal: 'submittals', attention: 'attention_items' };
const URLS = {
  task: (id) => `/api/tasks/${id}`,
  info: (id) => `/api/info/${id}`,
  meeting: (id) => `/api/project-meetings/${id}`,
  series: (id) => `/api/meeting-series/${id}`,
  project: (id) => `/api/projects/${id}`,
  submittal: (id, pid) => `/api/projects/${pid}/submittals/${id}`,
  attention: (id, pid) => `/api/projects/${pid}/attention-items/${id}`,
};
// A project row from the API (PATCH answers carry stages as an array; a 409's current row carries the stored
// JSON text): stages always become an array here.
const projectPatch = (row) => (row && Object.prototype.hasOwnProperty.call(row, 'stages') ? { ...row, stages: parseStages(row.stages) } : row);
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
  const [a6Dirty, setA6Dirty] = useState({});            // open attention-item drafts
  const [details, setDetails] = useState(false);         // the Project details dialog
  const [confirmUI, ask] = useConfirm();
  const toastTimer = useRef(null);

  // 20 s rev poll that ignores our own writes, and refreshes that can't undo them (useBoardSync.js).
  const { stale, refresh, wrote, refreshNow } = useBoardSync({
    projectId: pid, initialRev: initial.project.rev, initialArchived: initial.project.archived,
    dirty: draftDirty || Object.values(a6Dirty).some(Boolean), props: initial,
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
    if (kind === 'project') { setD((x) => ({ ...x, project: { ...x.project, ...projectPatch(patch) } })); return; }
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
      const r = await api(URLS[kind](id, pid), { method: 'PATCH', body: { [field]: value, base: { [field]: base } } });
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
  }, [clearConflict, mergeLocal, showToast, refreshNow, fail, handleGone, wrote, pid]);

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

  // Team move (A4 rules 3b/3c): it changes who is on the project, so it asks first, with the counts the loader
  // computed for that team (move_leaves: roster members here who aren't on its roster and own no task here;
  // move_joins: people on its roster who aren't members yet), and reports what the server actually did.
  const moveProject = useCallback(async (teamId) => {
    const target = (d.teams || []).find((t) => same(t.id, teamId));
    if (!target || same(teamId, p.team_id)) return false;
    const leaves = Number(target.move_leaves) || 0;
    const joins = Number(target.move_joins) || 0;
    const from = p.team_name || 'the current team';
    const ok = await ask({
      title: `Move “${projectTitle(p)}” to ${target.name}?`,
      lines: [
        leaves ? `${nPeople(leaves)} who got this project from ${from}’s roster ${leaves === 1 ? 'comes' : 'come'} off it.` : null,
        joins ? `${nPeople(joins)} on ${target.name}’s roster ${joins === 1 ? 'joins' : 'join'} it.` : null,
        leaves || joins
          ? 'People who own tasks here, were added by hand or created it stay.'
          : 'Nobody’s project membership changes.',
      ],
      confirmLabel: 'Move project',
    });
    if (!ok) return false;
    touch();
    try {
      const r = await api(URLS.project(pid), { method: 'PATCH', body: { team_id: teamId } });
      wrote();
      if (r?.row) mergeLocal('project', pid, r.row);
      const m = r?.team_move;
      if (m) {
        const bits = [m.added ? `${nPeople(m.added)} joined` : null, m.removed ? `${nPeople(m.removed)} came off` : null,
          m.kept ? `${nPeople(m.kept)} stayed for their tasks` : null].filter(Boolean);
        showToast(`Moved to ${target.name}. ${bits.length ? `${bits.join(', ')}.` : 'Nobody’s membership changed.'}`);
      }
      refreshNow();
      return true;
    } catch (e) { fail(e); refreshNow(); return false; }
  }, [d.teams, p.team_id, p.team_name, p.name, p.project_number, ask, touch, pid, wrote, mergeLocal, showToast, refreshNow, fail]);

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

  // ---------------------------------------------------------------- meetings and series (A9)
  // "New series…" in the editor: the series is made first, then the meeting goes into it. An active series with
  // that name is used instead (also when a retry follows a meeting save that failed after its series was made).
  const seriesRef = useRef(d.series);
  seriesRef.current = d.series;
  const seriesFor = useCallback(async (fields, newName) => {
    if (fields.series_id !== NEW_SERIES) return fields;
    const key = String(newName || '').trim().toLowerCase();
    const have = (seriesRef.current || []).find((s) => !s.archived && String(s.name || '').trim().toLowerCase() === key);
    if (have) return { ...fields, series_id: String(have.id) };
    const row = await api('/api/meeting-series', { method: 'POST', body: { project_id: pid, name: newName } });
    wrote();
    if (row?.id != null) appendLocal('series', row);
    return { ...fields, series_id: row?.id != null ? String(row.id) : null };
  }, [pid, appendLocal, wrote]);
  const createMeeting = useCallback(async (fields, newName) => {
    touch();
    const f = await seriesFor(fields, newName);
    const row = await api('/api/project-meetings', { method: 'POST', body: { project_id: pid, ...f } });
    wrote();
    if (row?.id != null) appendLocal('meeting', row);
    refreshNow();
    return row;
  }, [touch, seriesFor, pid, appendLocal, refreshNow, wrote]);
  const saveMeeting = useCallback(async (m, patch, base, newName) => {
    touch();
    try {
      const p2 = await seriesFor(patch, newName);
      const r = await api(URLS.meeting(m.id), { method: 'PATCH', body: { ...p2, base } });
      wrote();
      if (r?.row) mergeLocal('meeting', m.id, r.row);
    } catch (e) {
      if (e instanceof ConflictError && e.current) mergeLocal('meeting', m.id, e.current);
      else handleGone('meeting', m.id, e);
      throw e;
    }
  }, [touch, seriesFor, mergeLocal, handleGone, wrote]);
  const addSeries = useCallback(async (name) => {
    touch();
    try {
      const row = await api('/api/meeting-series', { method: 'POST', body: { project_id: pid, name } });
      wrote();
      if (row?.id != null) appendLocal('series', row);
      refreshNow();
      return row;
    } catch (e) { fail(e); throw e; }
  }, [touch, pid, appendLocal, refreshNow, fail, wrote]);
  // A rename that loses a race shows a conflict notice under the series (the dialog row closes either way).
  const renameSeries = useCallback(async (sv, name) => {
    try { await saveText('series', sv.id, 'name', name, sv.name); } catch {}
  }, [saveText]);

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

  // ---------------------------------------------------------------- A6: schedule, stage, details
  // Optimistic: the button or stage changes at once; a failure puts the server's value back (refreshNow).
  const setProjectField = useCallback((patch) => {
    mergeLocal('project', pid, patch);
    return patchProject(patch);
  }, [mergeLocal, pid, patchProject]);
  const setSchedule = useCallback((v) => setProjectField({ schedule_status: v }), [setProjectField]);
  const setStage = useCallback((k) => setProjectField({ current_stage: k }), [setProjectField]);
  // After Save (our write: the rev poll expects it) or "Discard mine" after a 409 (their row, nothing written).
  const detailsSaved = useCallback((row, { wrote: ours = true } = {}) => {
    if (row) { if (ours) wrote(); mergeLocal('project', pid, row); }
    refreshNow();
  }, [wrote, mergeLocal, pid, refreshNow]);

  // ---------------------------------------------------------------- Status Report review (pre-A6 text)
  // A pre-A6 project's notes were written as internal notes, so reports leave them out until someone reviews them
  // (status_report_reviewed_at NULL). "Use in reports" saves whatever is being typed first, then sends the text it
  // reviewed as the base: if someone changed it meanwhile the server answers 409 and nothing is released.
  const [reviewBusy, setReviewBusy] = useState(false);
  const notesNow = useRef(p.notes || '');
  notesNow.current = p.notes || '';
  const reviewPending = p.status_report_reviewed_at == null && /\S/.test(p.notes || '');
  const markReviewed = useCallback(async () => {
    const el = document.activeElement;
    if (el && el !== document.body && typeof el.blur === 'function') el.blur();
    setReviewBusy(true);
    try {
      await new Promise((r) => setTimeout(r, 0));
      const s = await settleWrites();
      await new Promise((r) => setTimeout(r, 0));     // the saved text is rendered (notesNow)
      if (!s.ok) {
        if (s.timedOut) setError('Your changes are still saving. Try again in a moment.');
        return;
      }
      touch();
      const r = await api(URLS.project(pid), { method: 'PATCH', body: { status_report_reviewed: true, base: { notes: notesNow.current } } });
      wrote();
      if (r?.row) mergeLocal('project', pid, r.row);
    } catch (e) {
      if (e instanceof ConflictError) {
        if (e.current) mergeLocal('project', pid, e.current);
        setError('Someone changed the Status Report while you were reading it. Read it again, then click Use in reports.');
      } else fail(e);
    } finally {
      setReviewBusy(false);
    }
  }, [touch, pid, wrote, mergeLocal, fail]);

  // ---------------------------------------------------------------- A6: submittals (and A9 archive of meetings and series)
  // Writes to one submittal or meeting go out one at a time, in the order they were made, so a slow earlier write
  // can never land after a later one (2026-10-14 review: a date typed segment by segment stored an in-between
  // value). Only the newest write's answer is merged, so an older answer never flickers the field back.
  const itemQueues = useRef({});
  const patchItem = useCallback((kind, id, patch) => {
    mergeLocal(kind, id, patch);
    const key = `${kind}:${id}`;
    const q = itemQueues.current;
    const run = async () => {
      try {
        const r = await api(URLS[kind](id, pid), { method: 'PATCH', body: patch });
        wrote();
        if (r?.row && q[key] === job) mergeLocal(kind, id, r.row);
        return r?.row;
      } catch (e) {
        fail(e);
        handleGone(kind, id, e);
        refreshNow();
        return null;
      }
    };
    const job = trackWrite((q[key] || Promise.resolve()).then(run, run));
    q[key] = job;
    job.then(() => { if (q[key] === job) delete q[key]; });
    return job;
  }, [mergeLocal, pid, wrote, fail, handleGone, refreshNow]);
  // A9: archive or restore a meeting or a series (meetings and series are never deleted).
  const archiveMeeting = useCallback((m, archived) => patchItem('meeting', m.id, { archived }), [patchItem]);
  const archiveSeries = useCallback((sv, archived) => patchItem('series', sv.id, { archived }), [patchItem]);

  const addSubmittal = useCallback(async () => {
    touch();
    try {
      const r = await api(`/api/projects/${pid}/submittals`, { method: 'POST', body: {} });
      wrote();
      if (r?.row?.id != null) { appendLocal('submittal', r.row); setFocusId(`submittal:${r.row.id}`); }
      refreshNow();
    } catch (e) { fail(e); }
  }, [touch, pid, wrote, appendLocal, refreshNow, fail]);
  const archiveSubmittal = useCallback(async (s) => {
    const what = [s.agency, s.title].filter(Boolean).join(', ');
    if (!(await ask({
      title: what ? `Archive “${what}”?` : 'Archive this submittal?',
      lines: ['It leaves this list and the weekly report. “Show archived” brings it back.'],
      confirmLabel: 'Archive',
    }))) return;
    await patchItem('submittal', s.id, { archived: true });
  }, [ask, patchItem]);

  // ---------------------------------------------------------------- A8: attention items
  const createAttention = useCallback(async (f) => {
    touch();
    const r = await api(`/api/projects/${pid}/attention-items`, {
      method: 'POST',
      body: { item: f.item.trim(), from_party: f.from_party.trim(), need_by: f.need_by || '' },
    });
    wrote();
    if (r?.row?.id != null) appendLocal('attention', r.row);
    refreshNow();
  }, [touch, pid, wrote, appendLocal, refreshNow]);
  const saveAttention = useCallback(async (a, f, bases) => {
    const body = attentionBody(f, bases);
    if (!Object.keys(body).some((k) => k !== 'base')) return;
    touch();
    try {
      const r = await api(URLS.attention(a.id, pid), { method: 'PATCH', body });
      wrote();
      if (r?.row) mergeLocal('attention', a.id, r.row);
    } catch (e) {
      if (e instanceof ConflictError && e.current) mergeLocal('attention', a.id, e.current);
      else handleGone('attention', a.id, e);
      throw e;
    }
  }, [touch, pid, wrote, mergeLocal, handleGone]);
  // Received stamps today on the server (Central); the row moves to the Received list at once.
  const receiveAttention = useCallback((a) => {
    mergeLocal('attention', a.id, { received_date: d.today || null });
    return patchItem('attention', a.id, { status: 'received' });
  }, [mergeLocal, patchItem, d.today]);
  const reopenAttention = useCallback((a) => patchItem('attention', a.id, { status: 'open' }), [patchItem]);
  const archiveAttention = useCallback(async (a) => {
    if (!(await ask({
      title: `Archive “${a.item}”?`,
      lines: [a.status === 'received' ? 'It leaves the Received list. “Show archived” brings it back.' : 'It leaves this list and the weekly report. “Show archived” brings it back.'],
      confirmLabel: 'Archive',
    }))) return;
    await patchItem('attention', a.id, { archived: true });
  }, [ask, patchItem]);

  const setDraftFlag = useCallback((key, v) => setA6Dirty((x) => (!!x[key] === !!v ? x : { ...x, [key]: !!v })), []);

  // ---------------------------------------------------------------- derived
  const { active, archived, subsByParent } = useMemo(() => {
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
    };
  }, [d.tasks]);

  const actions = {
    patchTask, setStatus, addTask, addTaskAndOpen, addSubtask, deleteTask, restoreTask,
    saveTaskText: (id, field, v, base) => saveText('task', id, field, v, base),
    saveInfoText: (id, field, v, base) => saveText('info', id, field, v, base),
    saveProjectText: (field, v, base) => saveText('project', pid, field, v, base),
    patchProject, moveProject, deleteProject, addInfo, deleteInfo, addMembers, removeMember,
    setSchedule, setStage, openDetails: () => setDetails(true),
    addSubmittal, archiveSubmittal,
    patchSubmittal: (id, patch) => patchItem('submittal', id, patch),
    saveSubmittalText: (id, field, v, base) => saveText('submittal', id, field, v, base),
    createAttention, saveAttention, receiveAttention, reopenAttention, archiveAttention,
    patchAttention: (id, patch) => patchItem('attention', id, patch),
    setDraftDirty: setDraftFlag,
  };
  const ctx = {
    pid, people: d.people, ro, mounted, focusId, actions, conflictUI,
    expandedSubs, expandedNotes,
    toggleSubs: (id) => setExpandedSubs((s) => ({ ...s, [id]: !s[id] })),
    toggleNotes: (id) => setExpandedNotes((s) => ({ ...s, [id]: !s[id] })),
  };

  const statusReport = (
        <div className="notes-panel status-report-panel" id="status-report">
          <h2 className="notes-label" id={`pnotes-h-${pid}`}><IconNote size={14} /> Status Report <span>· goes to the owner in the weekly report</span></h2>
          {reviewPending && (
            <div className="sr-review" role="note">
              <IconAlert size={15} />
              <div className="sr-review-text">
                <b>Not in the owner reports yet.</b> This text was written as internal project notes before weekly reports
                existed. Read it and take out anything internal (staff names, internal reviews, remarks), then click
                <b> Use in reports</b>. Until then the report says “No status report this week.”
              </div>
              {!ro && (
                <button type="button" className="btn btn-ink btn-sm wi sr-review-btn" onClick={markReviewed} disabled={reviewBusy}>
                  <IconCheck size={14} /> {reviewBusy ? 'Saving…' : 'Use in reports'}
                </button>
              )}
            </div>
          )}
          {ro ? (
            <div className="notes-area notes-ro"><FormattedNotes text={p.notes} empty="No status report." /></div>
          ) : (
            <SyncedNotesEditor
              key={pid}
              id={`pnotes-${pid}`}
              role="group"
              aria-labelledby={`pnotes-h-${pid}`}
              className="sr-editor"
              value={p.notes || ''}
              placeholder="Where the project stands this week: progress, what’s next, what you’re waiting on…"
              onSave={(v, base) => actions.saveProjectText('notes', v, base)}
            />
          )}
          {conflictUI(`project:${pid}:notes`)}
        </div>
  );
  const meetingsPanel = (
    <ProjectMeetings
      key={pid}
      meetings={d.meetings}
      series={d.series}
      today={d.today}
      readOnly={ro}
      onCreate={createMeeting}
      onSave={saveMeeting}
      onArchive={archiveMeeting}
      onAddSeries={addSeries}
      onRenameSeries={renameSeries}
      onArchiveSeries={archiveSeries}
      onDiscard={() => refreshNow()}
      onDirtyChange={setDraftDirty}
      seriesNotice={(sv) => conflictUI(`series:${sv.id}:name`)}
    />
  );

  const crumbs = [
    { label: 'Offices', href: '/offices' },
    p.office_id != null ? { label: p.office_name, href: p.office_archived ? undefined : `/offices/${p.office_id}` } : null,
    p.team_id != null ? { label: p.team_name, href: p.team_archived || p.office_archived ? undefined : `/teams/${p.team_id}` } : null,
    { label: projectTitle(p) },
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
        memberCount={d.members.length}
        ro={ro}
        actions={actions}
        conflictUI={conflictUI}
        ask={ask}
        today={d.today}
      />

      {statusReport}

      {/* Neil, 2026-10-15: submittals above the tasks. */}
      <Submittals submittals={d.submittals || []} ctx={ctx} />

      <TaskTable tasks={active} subsByParent={subsByParent} ctx={ctx} />

      {archived.length > 0 && (
        <ArchivedTasks tasks={archived} subsByParent={subsByParent} ctx={ctx} open={showArchived} onToggle={toggleArchived} />
      )}

      <AttentionItems items={d.attention_items || []} today={d.today} fromOptions={d.attention_from || []} ctx={ctx} />
      {meetingsPanel}

      <ReportLink project={p} ro={ro} actions={actions} conflictUI={conflictUI} />
      <ProjectInfo rows={d.info} ctx={ctx} />

      <MembersPanel project={p} members={d.members} ro={ro} actions={actions} ask={ask} />

      {details && d.can.manage && !ro && (
        <ProjectDetailsDialog project={p} options={d.field_options} onSaved={detailsSaved} onClose={() => setDetails(false)} />
      )}
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

// Only the fields of an attention item that changed since the editor opened; text with its base (design §7.4).
function attentionBody(f, bases) {
  const body = {};
  const base = {};
  if ((f.need_by || '') !== (bases.need_by || '')) body.need_by = f.need_by || null;
  for (const k of ['item', 'from_party']) {
    if (f[k].trim() !== String(bases[k] ?? '').trim()) { body[k] = f[k].trim(); base[k] = bases[k] ?? ''; }
  }
  if (Object.keys(base).length) body.base = base;
  return body;
}
