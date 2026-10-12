'use client';
import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { IconCheck, IconChevronRight, IconAlert, IconFolder, IconUser } from '@/app/icons';
import { StatusSelect, StoplightDots, byName } from '@/app/_ui/tasks';
import useServerState from '@/app/_ui/useServerState';
import { useRefreshOnFocus } from '@/app/_ui/useRefresh';
import { api } from '@/app/_ui/api';
import { withDefaults } from '@/lib/prefs';
import { addDays } from '@/lib/time';
import { useTaskEdits, statusPatch, ErrorBanner, Toast, fmtDue } from '../tasks/task-list-ui';
import '../tasks/lists.css';

// My work (design §2.1). Tasks come from lib/queries/tasks.js loadMyWork (visible projects only, open, not
// Done, assigned to my linked name). Edits go through PATCH /api/tasks/:id like All tasks; a task set to Done
// leaves the list with an Undo. Grouping by due date or by project is remembered in prefs.my_work_group.

const GROUPS = [
  { key: 'overdue', label: 'Overdue' },
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This week', hint: 'next 7 days' },
  { key: 'later', label: 'Later' },
  { key: 'none', label: 'No date' },
];
const SL_RANK = { red: 0, yellow: 1, green: 2, '': 3 };
const PROJECTS_SHOWN = 8;

function groupOf(due, today, weekEnd) {
  if (!due) return 'none';
  if (due < today) return 'overdue';
  if (due === today) return 'today';
  if (due <= weekEnd) return 'week';
  return 'later';
}
const byDueThenPriority = (a, b) =>
  (a.due_date || '9999-99-99').localeCompare(b.due_date || '9999-99-99')
  || ((SL_RANK[a.stoplight || ''] ?? 3) - (SL_RANK[b.stoplight || ''] ?? 3))
  || (a.project_name || '').localeCompare(b.project_name || '', undefined, { numeric: true, sensitivity: 'base' });

function TaskItem({ t, today, showProject, onUpdate, onStatus }) {
  const overdue = t.due_date && t.due_date < today;
  return (
    <li className="lt-task">
      <div className="lt-task-sl"><StoplightDots value={t.stoplight} onChange={(c) => onUpdate(t, { stoplight: c })} /></div>
      <div className="lt-task-main">
        <Link href={`/projects/${t.project_id}/tasks/${t.id}`} prefetch={false} className="lt-task-title">
          {t.parent_id ? <span className="subtask-arrow">↳ </span> : null}{t.title || 'Untitled task'}
        </Link>
        <div className="lt-task-where">
          {showProject && <><Link href={`/projects/${t.project_id}`} prefetch={false}>{t.project_name}</Link> · </>}
          {t.office_name} › {t.team_name}
          {t.parent_id ? <> · in {t.parent_title || 'Untitled task'}</> : null}
        </div>
      </div>
      <div className="lt-task-ctrl">
        <label className={`lt-task-due${overdue ? ' overdue' : ''}`}>
          <span className="sr-only">Due date</span>
          <input
            type="date"
            className="date-input"
            value={t.due_date ?? ''}
            onChange={(e) => onUpdate(t, { due_date: e.target.value || null })}
            title={t.due_date ? `Due ${fmtDue(t.due_date, { year: true })}` : 'No due date'}
          />
        </label>
        <StatusSelect value={t.status} onChange={(v) => onStatus(t, v)} aria-label="Status" />
      </div>
    </li>
  );
}

function Notices({ notices, viewer }) {
  const items = [];
  const pos = notices?.position;
  if (pos) {
    const keeps = pos.approved && Number(pos.approved_level) > 1
      ? `Until then you keep your current access (${pos.approved}).`
      : 'Until then you see the projects you’re assigned to.';
    items.push({ key: 'pos', text: <><b>{pos.requested}</b>: pending admin approval. {keeps}</> });
  }
  for (const r of notices?.requests || []) {
    if (r.kind === 'office_change') {
      items.push({
        key: `r${r.id}`,
        text: <>Office change to <b>{r.office_name || 'another office'}</b>{r.team_name ? <> ({r.team_name})</> : null}: waiting for an admin.{r.from_office_name ? <> Until then your office stays {r.from_office_name}.</> : null}</>,
      });
    } else if (r.kind === 'person_link') {
      items.push({
        key: `r${r.id}`,
        text: <>Your link to <b>“{r.person_name || 'a name on tasks'}”</b> on tasks is waiting for an admin. Its tasks show up here once it’s approved.</>,
      });
    }
  }
  const linkPending = (notices?.requests || []).some((r) => r.kind === 'person_link');
  if (!viewer?.person_id && !linkPending) {
    items.push({
      key: 'nolink',
      href: '/settings?tab=names',
      text: <>Tasks are assigned to names on tasks, and your account isn’t linked to one yet, so none show here. Link yourself to your name in Settings.</>,
    });
  }
  if (!items.length) return null;
  return (
    <div className="lt-notices">
      {items.map((n) => (
        <div key={n.key} className="banner setup lt-notice" role="status">
          <IconAlert size={16} />
          <span>{n.text}</span>
          <span className="spacer" />
          <Link href={n.href || '/settings'} prefetch={false} className="btn btn-plain btn-sm">Settings</Link>
        </div>
      ))}
    </div>
  );
}

export default function MyWork({ data, today, viewer }) {
  useRefreshOnFocus(30_000);
  const [tasks, setTasks] = useServerState(data.tasks);
  const { update, error, clearError, toast, showToast, clearToast } = useTaskEdits(setTasks, { people: data.people });
  const prefs = withDefaults(viewer?.prefs, { isAdmin: !!viewer?.is_admin });
  const [mode, setMode] = useState(prefs.my_work_group === 'project' ? 'project' : 'due');
  const [allProjects, setAllProjects] = useState(false);
  const weekEnd = addDays(today, 7);
  const me = viewer?.person_id ? String(viewer.person_id) : null;

  // Open = not archived, not Done, still mine, parent not archived (a top-level task set to Done here takes
  // its open subtasks with it, as the next server load would).
  const archivedIds = new Set(tasks.filter((t) => t.archived).map((t) => String(t.id)));
  const open = tasks.filter((t) => !t.archived && t.status !== 'done' && me && String(t.assignee_id) === me
    && !(t.parent_id && archivedIds.has(String(t.parent_id))));

  const onStatus = useCallback((t, v) => {
    const patch = statusPatch(t, v);
    if (v !== 'done') { update(t, patch); return; }
    const before = { status: t.status, ...(patch.archived ? { archived: false } : {}) };
    update(t, patch, {
      toast: { message: `Marked “${t.title || 'Untitled task'}” done.`, actionLabel: 'Undo', onAction: () => update({ ...t, ...patch }, before) },
    });
  }, [update]);

  const setGrouping = async (next) => {
    if (next === mode) return;
    setMode(next);
    try { await api('/api/prefs', { method: 'PATCH', body: { my_work_group: next } }); } catch { /* still applies on this page */ }
  };

  const sections = useMemo(() => {
    if (mode === 'project') {
      const m = new Map();
      for (const t of open) {
        const k = String(t.project_id);
        if (!m.has(k)) m.set(k, { key: `p${k}`, project_id: k, label: t.project_name || 'Untitled project', where: `${t.office_name} › ${t.team_name}`, items: [] });
        m.get(k).items.push(t);
      }
      return [...m.values()].sort((a, b) => byName({ name: a.label }, { name: b.label }))
        .map((s) => ({ ...s, items: [...s.items].sort(byDueThenPriority) }));
    }
    const by = Object.fromEntries(GROUPS.map((g) => [g.key, []]));
    for (const t of open) by[groupOf(t.due_date, today, weekEnd)].push(t);
    return GROUPS.map((g) => ({ ...g, items: by[g.key].sort(byDueThenPriority) })).filter((g) => g.items.length);
  }, [open, mode, today, weekEnd]); // eslint-disable-line react-hooks/exhaustive-deps

  const projects = data.projects || [];
  const shownProjects = allProjects ? projects : projects.slice(0, PROJECTS_SHOWN);

  return (
    <div className="lt-page lt-mywork">
      <div className="proj-head">
        <h1 className="wi-h"><IconCheck size={24} /> My work</h1>
        <span className="progress-label" aria-live="polite">{open.length} open task{open.length !== 1 ? 's' : ''}</span>
        <span className="spacer" />
        <Link href="/tasks" prefetch={false} className="lt-head-link">All tasks <IconChevronRight size={14} /></Link>
      </div>

      <ErrorBanner message={error} onDismiss={clearError} />
      <Notices notices={data.notices} viewer={viewer} />

      <section className="lt-section" aria-label="My tasks">
        <div className="lt-section-head">
          <h2 className="lt-section-h"><IconUser size={16} /> My tasks</h2>
          <span className="spacer" />
          <div className="lt-seg" role="group" aria-label="Group my tasks by">
            <button type="button" className={mode === 'due' ? 'on' : ''} aria-pressed={mode === 'due'} onClick={() => setGrouping('due')}>By due date</button>
            <button type="button" className={mode === 'project' ? 'on' : ''} aria-pressed={mode === 'project'} onClick={() => setGrouping('project')}>By project</button>
          </div>
        </div>

        {me && open.length === 0 && (
          <div className="empty lt-empty">
            <h3>Nothing on your plate</h3>
            <p>No open tasks are assigned to you on the projects you can see.</p>
            <Link href="/tasks" prefetch={false} className="btn btn-plain">See all tasks</Link>
          </div>
        )}

        {sections.map((s) => (
          <div key={s.key} className={`lt-group lt-group-${s.key}`}>
            <h3 className="lt-group-h">
              {mode === 'project'
                ? <Link href={`/projects/${s.project_id}`} prefetch={false}>{s.label}</Link>
                : s.label}
              <span className="lt-group-n">{s.items.length}</span>
              {s.hint && <span className="lt-group-hint">{s.hint}</span>}
              {s.where && <span className="lt-group-hint">{s.where}</span>}
            </h3>
            <ul className="lt-tasks">
              {s.items.map((t) => (
                <TaskItem key={t.id} t={t} today={today} showProject={mode !== 'project'} onUpdate={update} onStatus={onStatus} />
              ))}
            </ul>
          </div>
        ))}
      </section>

      <section className="lt-section" aria-label="My projects">
        <div className="lt-section-head">
          <h2 className="lt-section-h"><IconFolder size={16} /> My projects <span className="lt-group-n">{projects.length}</span></h2>
          <span className="spacer" />
          <Link href="/projects" prefetch={false} className="lt-head-link">All projects <IconChevronRight size={14} /></Link>
        </div>
        {projects.length === 0 ? (
          <p className="muted lt-none">No projects yet. Projects you’re on, own tasks in, or that belong to your team show up here.</p>
        ) : (
          <>
            <ul className="lt-mprojects">
              {shownProjects.map((p) => (
                <li key={p.id} className="lt-mproj">
                  <Link href={`/projects/${p.id}`} prefetch={false} className="lt-mproj-name">{p.name || 'Untitled project'}</Link>
                  <div className="lt-mproj-where">{p.office_name} › {p.team_name}</div>
                  <div className="lt-mproj-stats">
                    {p.my_open > 0 ? <span className="lt-stat lt-stat-mine"><b>{p.my_open}</b> mine</span> : null}
                    <span className="lt-stat"><b>{p.open_count}</b> open</span>
                  </div>
                </li>
              ))}
            </ul>
            {projects.length > PROJECTS_SHOWN && (
              <button type="button" className="btn btn-plain btn-sm lt-more-btn" onClick={() => setAllProjects((v) => !v)}>
                {allProjects ? 'Show fewer' : `Show all ${projects.length}`}
              </button>
            )}
          </>
        )}
      </section>

      <Toast toast={toast} onClose={clearToast} />
    </div>
  );
}
