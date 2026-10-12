'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { IconList, IconSearch, IconChevronUp, IconCaret, IconChevronRight } from '@/app/icons';
import {
  TASK_STATUSES, STATUS_ORDER, Avatar, OwnerSelect, StatusSelect, StoplightDots, localISO, byName, personById,
} from '@/app/_ui/tasks';
import useServerState from '@/app/_ui/useServerState';
import { useRefreshOnFocus } from '@/app/_ui/useRefresh';
import { useTaskEdits, statusPatch, ErrorBanner, Toast, FilterToggle, fmtAddedIn, fmtAddedTitle, DueChip } from './task-list-ui';
import './lists.css';

// All tasks (inventory §1.9), ported from the old single page. Same filters, sort, inline edits and the
// localStorage key tb_alltasks_filters (search is never saved), so filters set before the rebuild still apply.
// Changes from the old view (design §2.1, §2.3): only projects the viewer can see; tasks of archived teams
// and offices and subtasks of archived parents are not listed (lib/queries/tasks.js); setting a subtask to
// Done no longer archives it; the stoplight dots have the board's tooltips; on a phone the table becomes
// cards whose title opens the task page.

export const TASK_FILTERS_DEFAULT = { office: 'all', team: 'all', project: 'all', owner: 'all', light: 'all', status: 'all', due: 'any', q: '' };
const FILTERS_KEY = 'tb_alltasks_filters';
const LIGHTS = ['all', 'red', 'yellow', 'green', 'none'];
const DUES = ['any', 'overdue', 'today', 'week', 'month', 'none'];
// Rows drawn at once (each table row carries an owner menu with every name); "Show more" adds the next batch.
const PAGE = 300;

const same = (a, b) => a != null && b != null && String(a) === String(b);
const byPosition = (pos) => (a, b) => (a[pos] - b[pos]) || (Number(a.id) - Number(b.id));

function SortArrow({ on, dir }) {
  if (!on) return null;
  return dir === 'asc'
    ? <IconChevronUp size={12} className="lt-sort-arrow" />
    : <IconCaret size={12} className="lt-sort-arrow" />;
}

export default function GlobalTasks({ data, viewer }) {
  const router = useRouter();
  useRefreshOnFocus(30_000);
  const [tasks, setTasks] = useServerState(data.tasks);
  const people = data.people || [];
  const { update, error, clearError, toast, clearToast } = useTaskEdits(setTasks, { people });
  const tz = viewer?.tz || 'America/Chicago';
  const myPerson = viewer?.person_id ? String(viewer.person_id) : null;

  // Filters are remembered in this browser, so e.g. "Person: me" sticks.
  const [f, setF] = useState(TASK_FILTERS_DEFAULT);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(FILTERS_KEY) || 'null');
      if (saved && typeof saved === 'object') setF({ ...TASK_FILTERS_DEFAULT, ...saved, q: '' });
    } catch {}
  }, []);
  const setFilter = (patch) => setF((cur) => {
    const next = { ...cur, ...patch };
    try { localStorage.setItem(FILTERS_KEY, JSON.stringify({ ...next, q: '' })); } catch {}
    return next;
  });
  const [showFilters, setShowFilters] = useState(false);
  const [sortBy, setSortBy] = useState('due');
  const [sortDir, setSortDir] = useState('asc');
  const [limit, setLimit] = useState(PAGE);

  // "Today" is the browser's local date, as before. It only matters once a due filter is picked (after the
  // saved filters load), so the server's HTML never depends on it.
  const [today, setToday] = useState(null);
  useEffect(() => { setToday(localISO(new Date())); }, []);

  // ---- choices: each location menu only offers choices inside the one before it ----
  const projects = data.projects || [];
  const officeChoices = useMemo(() => {
    const m = new Map();
    for (const p of projects) if (!m.has(p.office_id)) m.set(p.office_id, { id: p.office_id, name: p.office_name, position: p.office_position });
    return [...m.values()].sort(byPosition('position'));
  }, [projects]);
  // A saved choice that is no longer offered (an office, team or project you can't see any more, a name that
  // was archived) counts as "all", so the menu and the list always agree.
  const office = f.office !== 'all' && officeChoices.some((o) => same(o.id, f.office)) ? f.office : 'all';
  const teamChoices = useMemo(() => {
    const m = new Map();
    for (const p of projects) {
      if (office !== 'all' && !same(p.office_id, office)) continue;
      if (!m.has(p.team_id)) m.set(p.team_id, { id: p.team_id, name: p.team_name });
    }
    return [...m.values()].sort(byName);
  }, [projects, office]);
  const team = f.team !== 'all' && teamChoices.some((t) => same(t.id, f.team)) ? f.team : 'all';
  const projectChoices = useMemo(() => projects
    .filter((p) => (team === 'all' ? (office === 'all' || same(p.office_id, office)) : same(p.team_id, team)))
    .sort(byName), [projects, office, team]);
  const project = f.project !== 'all' && projectChoices.some((p) => same(p.id, f.project)) ? f.project : 'all';

  // Person menu: everyone on the roster; archived names only while they still own a listed task.
  const ownedIds = useMemo(() => new Set(tasks.map((t) => String(t.assignee_id))), [tasks]);
  const personChoices = people.filter((p) => !p.archived || ownedIds.has(String(p.id)));
  const ownerOk = f.owner === 'all' || f.owner === 'none' || (f.owner === 'me' && myPerson)
    || personChoices.some((p) => same(p.id, f.owner));
  const owner = ownerOk ? f.owner : 'all';
  const light = LIGHTS.includes(f.light) ? f.light : 'all';
  const status = f.status === 'all' || TASK_STATUSES[f.status] ? f.status : 'all';
  const due = DUES.includes(f.due) ? f.due : 'any';
  const q = typeof f.q === 'string' ? f.q : '';
  const fx = { office, team, project, owner, light, status, due, q };

  // ---- rows ----
  // A task archived here (a top-level task set to Done) leaves the list, and so do its open subtasks (their
  // parent is archived now; the next server load agrees).
  const archivedIds = new Set(tasks.filter((t) => t.archived).map((t) => String(t.id)));
  const live = tasks.filter((t) => !t.archived && !(t.parent_id && archivedIds.has(String(t.parent_id))));

  const inDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return localISO(d); };
  const now = today || localISO(new Date());
  const needle = q.trim().toLowerCase();
  let rows = live.filter((t) => {
    if (fx.office !== 'all' && !same(t.office_id, fx.office)) return false;
    if (fx.team !== 'all' && !same(t.team_id, fx.team)) return false;
    if (fx.project !== 'all' && !same(t.project_id, fx.project)) return false;
    if (fx.owner === 'none' && t.assignee_id) return false;
    if (fx.owner === 'me' && !same(t.assignee_id, myPerson)) return false;
    if (fx.owner !== 'all' && fx.owner !== 'none' && fx.owner !== 'me' && !same(t.assignee_id, fx.owner)) return false;
    if (fx.light === 'none' && t.stoplight) return false;
    if (fx.light !== 'all' && fx.light !== 'none' && t.stoplight !== fx.light) return false;
    if (fx.status !== 'all' && t.status !== fx.status) return false;
    const d = t.due_date || '';
    if (fx.due === 'overdue' && !(d && d < now)) return false;
    if (fx.due === 'today' && d !== now) return false;
    if (fx.due === 'week' && !(d && d >= now && d <= inDays(7))) return false;
    if (fx.due === 'month' && !(d && d >= now && d <= inDays(30))) return false;
    if (fx.due === 'none' && d) return false;
    if (needle && !(`${t.title || ''} ${t.notes || ''}`.toLowerCase().includes(needle))) return false;
    return true;
  });
  const filtering = Object.keys(TASK_FILTERS_DEFAULT).some((k) => fx[k] !== TASK_FILTERS_DEFAULT[k]);

  const nameById = useMemo(() => new Map(people.map((p) => [String(p.id), p.name])), [people]);
  const personName = (id) => (id == null ? '' : nameById.get(String(id)) || '');
  const slRank = { red: 0, yellow: 1, green: 2, '': 3 };
  const cmp = {
    project: (a, b) => (a.project_name || '—').localeCompare(b.project_name || '—', undefined, { numeric: true }),
    task: (a, b) => (a.title || '').localeCompare(b.title || ''),
    owner: (a, b) => (personName(a.assignee_id) || 'zzzz').localeCompare(personName(b.assignee_id) || 'zzzz'),
    stoplight: (a, b) => ((slRank[a.stoplight || ''] ?? 3) - (slRank[b.stoplight || ''] ?? 3)),
    due: (a, b) => (a.due_date || '9999-99-99').localeCompare(b.due_date || '9999-99-99'),
    status: (a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status),
    added: (a, b) => (new Date(a.created_at || 0) - new Date(b.created_at || 0)),
  };
  rows = [...rows].sort((a, b) => { const c = (cmp[sortBy] || cmp.due)(a, b); return sortDir === 'asc' ? c : -c; });

  // A new filter or sort starts again from the first batch.
  const filterKey = JSON.stringify(fx) + sortBy + sortDir;
  useEffect(() => { setLimit(PAGE); }, [filterKey]);
  const shown = rows.slice(0, limit);

  const setSort = (col) => {
    if (sortBy === col) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortBy(col); setSortDir('asc'); }
  };
  const th = (col, label, style) => (
    <th
      style={style}
      className="sortable"
      onClick={() => setSort(col)}
      aria-sort={sortBy === col ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}
    >
      <button type="button" className="lt-th-btn" onClick={(e) => { e.stopPropagation(); setSort(col); }}>
        {label}<SortArrow on={sortBy === col} dir={sortDir} />
      </button>
    </th>
  );

  // Owner menus list the active roster, plus a row's own archived owner so its value still shows.
  const activePeople = useMemo(() => people.filter((p) => !p.archived), [people]);
  const ownerOptions = (t) => {
    if (!t.assignee_id || activePeople.some((p) => same(p.id, t.assignee_id))) return activePeople;
    const own = personById(people, t.assignee_id);
    return own ? [...activePeople, { ...own, name: `${own.name} (archived)` }] : activePeople;
  };
  const manageNames = useCallback(() => router.push('/people/names'), [router]);
  const changeStatus = (t, v) => update(t, statusPatch(t, v));

  // Today's text when filters hide everything; a clearer one when there is nothing to show at all.
  const emptyText = !live.length && !filtering ? 'No open tasks on the projects you can see.' : 'No tasks match these filters.';
  const countLabel = `${rows.length} task${rows.length !== 1 ? 's' : ''}${filtering ? (rows.length === 1 ? ' matches your filters' : ' match your filters') : ' across all projects'}`;

  return (
    <div className="lt-page">
      <div className="proj-head">
        <h1 className="wi-h"><IconList size={24} /> All Tasks</h1>
        <span className="progress-label" aria-live="polite">{countLabel}</span>
        <span className="spacer" />
        <Link href="/my-work" prefetch={false} className="lt-head-link">My work <IconChevronRight size={14} /></Link>
      </div>

      <ErrorBanner message={error} onDismiss={clearError} />

      <div className={`filters lt-filters${showFilters ? ' open' : ''}`}>
        <label className="filter-search">
          <IconSearch size={15} />
          <input placeholder="Search tasks & notes" value={q} onChange={(e) => setFilter({ q: e.target.value })} aria-label="Search tasks and notes" />
        </label>
        <FilterToggle open={showFilters} onToggle={() => setShowFilters((v) => !v)} count={['office', 'team', 'project', 'owner', 'light', 'status', 'due'].filter((k) => fx[k] !== TASK_FILTERS_DEFAULT[k]).length} />
        <label>Office
          <select value={fx.office} onChange={(e) => setFilter({ office: e.target.value, team: 'all', project: 'all' })}>
            <option value="all">All offices</option>
            {officeChoices.map((o) => <option key={o.id} value={String(o.id)}>{o.name}</option>)}
          </select>
        </label>
        <label>Team
          <select value={fx.team} onChange={(e) => setFilter({ team: e.target.value, project: 'all' })}>
            <option value="all">All teams</option>
            {teamChoices.map((t) => <option key={t.id} value={String(t.id)}>{t.name}</option>)}
          </select>
        </label>
        <label>Project
          <select value={fx.project} onChange={(e) => setFilter({ project: e.target.value })}>
            <option value="all">All projects</option>
            {projectChoices.map((p) => <option key={p.id} value={String(p.id)}>{p.name}</option>)}
          </select>
        </label>
        <label>Person
          <select value={fx.owner} onChange={(e) => setFilter({ owner: e.target.value })}>
            <option value="all">Everyone</option>
            {myPerson && <option value="me">Me</option>}
            <option value="none">Unassigned</option>
            {personChoices.map((p) => <option key={p.id} value={String(p.id)}>{p.name}{p.archived ? ' (archived)' : ''}</option>)}
          </select>
        </label>
        <label>Stoplight
          <select value={fx.light} onChange={(e) => setFilter({ light: e.target.value })}>
            <option value="all">Any</option>
            <option value="red">Red</option>
            <option value="yellow">Yellow</option>
            <option value="green">Green</option>
            <option value="none">None</option>
          </select>
        </label>
        <label>Status
          <select value={fx.status} onChange={(e) => setFilter({ status: e.target.value })}>
            <option value="all">Any</option>
            {STATUS_ORDER.map((s) => <option key={s} value={s}>{TASK_STATUSES[s].label}</option>)}
          </select>
        </label>
        <label>Due
          <select value={fx.due} onChange={(e) => setFilter({ due: e.target.value })}>
            <option value="any">Any time</option>
            <option value="overdue">Overdue</option>
            <option value="today">Due today</option>
            <option value="week">Next 7 days</option>
            <option value="month">Next 30 days</option>
            <option value="none">No due date</option>
          </select>
        </label>
        {filtering && <button type="button" className="btn btn-plain btn-sm filters-clear" onClick={() => setFilter(TASK_FILTERS_DEFAULT)}>Clear filters</button>}
      </div>

      {/* Desktop and tablet: the sortable table. */}
      <div className="board lt-table">
        <div className="board-scroll">
          <table>
            <thead>
              <tr>
                {th('project', 'Project', { width: '19%' })}
                {th('task', 'Task', { width: '24%' })}
                {th('owner', 'Owner', { width: '15%' })}
                {th('stoplight', 'Stoplight', { width: '10%', textAlign: 'center' })}
                {th('due', 'Due', { width: '11%' })}
                {th('status', 'Status', { width: '13%' })}
                {th('added', 'Added', { width: '8%', textAlign: 'center' })}
              </tr>
            </thead>
            <tbody>
              {shown.map((t) => {
                const ownerP = personById(people, t.assignee_id);
                return (
                  <tr key={t.id}>
                    <td>
                      <Link href={`/projects/${t.project_id}`} prefetch={false} className="proj-link" title="Open this project">{t.project_name || '—'}</Link>
                      {t.team_name ? <div className="gt-where">{t.office_name ? `${t.office_name} › ` : ''}{t.team_name}</div> : null}
                    </td>
                    <td>
                      {t.parent_id ? <span className="subtask-arrow">↳ </span> : null}
                      <Link href={`/projects/${t.project_id}/tasks/${t.id}`} prefetch={false} className="gt-title lt-title-link" title="Open this task">{t.title || 'Untitled task'}</Link>
                      {t.parent_id ? <div className="gt-where" title="Subtask of">in {t.parent_title || 'Untitled task'}</div> : null}
                    </td>
                    <td>
                      <div className="cell-owner">
                        <Avatar person={ownerP} />
                        <OwnerSelect
                          value={t.assignee_id}
                          people={ownerOptions(t)}
                          onChange={(v) => update(t, { assignee_id: v || null })}
                          onManageNames={manageNames}
                          aria-label="Owner"
                        />
                      </div>
                    </td>
                    <td>
                      <StoplightDots value={t.stoplight} onChange={(c) => update(t, { stoplight: c })} />
                    </td>
                    <td>
                      <input type="date" className="date-input" value={t.due_date ?? ''} onChange={(e) => update(t, { due_date: e.target.value || null })} aria-label="Due date" />
                    </td>
                    <td>
                      <StatusSelect value={t.status} onChange={(v) => changeStatus(t, v)} aria-label="Status" />
                    </td>
                    <td className="added-cell" title={fmtAddedTitle(t.created_at, tz)}>{fmtAddedIn(t.created_at, tz)}</td>
                  </tr>
                );
              })}
              {!rows.length && (
                <tr><td colSpan={7} style={{ padding: 28, textAlign: 'center', color: '#8a8788' }}>{emptyText}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Phones: cards. The title opens the task page; status and priority stay one tap away. */}
      <ul className="lt-cards" aria-label="Tasks">
        {shown.map((t) => {
          const ownerP = personById(people, t.assignee_id);
          return (
            <li key={t.id} className="lt-card">
              <Link href={`/projects/${t.project_id}/tasks/${t.id}`} prefetch={false} className="lt-card-title">
                {t.parent_id ? <span className="subtask-arrow">↳ </span> : null}{t.title || 'Untitled task'}
              </Link>
              <div className="lt-card-where">
                <Link href={`/projects/${t.project_id}`} prefetch={false}>{t.project_name || '—'}</Link>
                {t.team_name ? <span> · {t.office_name ? `${t.office_name} › ` : ''}{t.team_name}</span> : null}
                {t.parent_id ? <span> · in {t.parent_title || 'Untitled task'}</span> : null}
              </div>
              <div className="lt-card-meta">
                <span className="lt-owner"><Avatar person={ownerP} xs />{ownerP ? ownerP.name : 'Unassigned'}</span>
                <DueChip due={t.due_date} today={today} />
              </div>
              <div className="lt-card-actions">
                <StoplightDots value={t.stoplight} onChange={(c) => update(t, { stoplight: c })} />
                <StatusSelect value={t.status} onChange={(v) => changeStatus(t, v)} aria-label="Status" />
              </div>
            </li>
          );
        })}
        {!rows.length && <li className="lt-card lt-card-empty">{emptyText}</li>}
      </ul>

      {rows.length > shown.length && (
        <div className="lt-more">
          <button type="button" className="btn btn-plain" onClick={() => setLimit((n) => n + PAGE)}>
            Show {Math.min(PAGE, rows.length - shown.length)} more
          </button>
          <span className="muted">Showing {shown.length} of {rows.length}</span>
        </div>
      )}

      <Toast toast={toast} onClose={clearToast} />
    </div>
  );
}
