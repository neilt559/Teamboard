'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/app/_ui/api';
import { IconAlert, IconCheck, IconFilter } from '@/app/icons';

// Shared by All tasks (GlobalTasks.js) and My work (my-work/MyWork.js): optimistic task edits through
// PATCH /api/tasks/:id (design §8.2), the small toast, and date labels that render the same on the server
// and in the browser (so hydration never disagrees about a date).

const idStr = (v) => (v == null || v === '' ? null : String(v));

// The fields a list keeps from a PATCH reply ({ ok, row } from the rewritten route; the pre-release route
// answered with the bare row). Anything else on the row is ignored.
export function taskFieldsFrom(row) {
  if (!row || typeof row !== 'object' || row.id == null) return null;
  const out = { id: String(row.id) };
  if ('title' in row) out.title = row.title ?? '';
  if ('notes' in row) out.notes = row.notes ?? '';
  if ('assignee_id' in row) out.assignee_id = idStr(row.assignee_id);
  if ('due_date' in row) out.due_date = row.due_date || null;
  if ('status' in row) out.status = row.status || 'not_started';
  if ('stoplight' in row) out.stoplight = row.stoplight || '';
  if ('archived' in row) out.archived = !!row.archived;
  if ('parent_id' in row) out.parent_id = idStr(row.parent_id);
  return out;
}

// What a status pick sends. A top-level task set to Done also archives (rule 20, same as the board); a subtask
// set to Done stays put (design §2.3: All tasks no longer archives subtasks on Done).
export const statusPatch = (task, status) =>
  (status === 'done' && !task.parent_id ? { status: 'done', archived: true } : { status });

// useTaskEdits(setTasks, { people }) -> { update, error, clearError, toast, showToast, clearToast }
//   update(task, patch, { undo }) applies the patch locally at once (optimistic, like today), PATCHes only the
//   changed keys, then adopts the stored row. On an error the banner shows the message and the page reloads
//   its data from the server (so the row shows the truth again). Assigning a task to a name linked to an account
//   adds that person to the project; the reply's added_member then shows "<name> was added to this project."
export function useTaskEdits(setTasks, { people = [] } = {}) {
  const router = useRouter();
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);
  const peopleRef = useRef(people);
  peopleRef.current = people;

  const showToast = useCallback((t) => setToast({ ...t, key: Date.now() }), []);
  const clearToast = useCallback(() => setToast(null), []);
  const clearError = useCallback(() => setError(null), []);

  const update = useCallback(async (task, patch, { toast: okToast } = {}) => {
    const id = String(task.id);
    setTasks((list) => list.map((t) => (String(t.id) === id ? { ...t, ...patch } : t)));
    try {
      const res = await api(`/api/tasks/${id}`, { method: 'PATCH', body: patch });
      const fields = taskFieldsFrom(res?.row || res);
      if (fields) setTasks((list) => list.map((t) => (String(t.id) === fields.id ? { ...t, ...fields } : t)));
      const row = res?.row || res;
      // { added_members: [{ user_id, name }] } from the rewritten route (design §6's added_member count also works).
      const added = Array.isArray(res?.added_members) ? res.added_members.filter((m) => m && m.name) : [];
      if ('assignee_id' in patch && (added.length || Number(row?.added_member) > 0)) {
        const who = added.length ? added.map((m) => m.name).join(', ')
          : (peopleRef.current || []).find((p) => String(p.id) === String(row.assignee_id ?? patch.assignee_id))?.name;
        showToast({ message: `${who || 'They'} ${added.length > 1 || !who ? 'were' : 'was'} added to this project.` });
      } else if (okToast) {
        showToast(okToast);
      }
      return true;
    } catch (e) {
      setError(e?.message || 'Something went wrong — please try again.');
      router.refresh();
      return false;
    }
  }, [setTasks, router, showToast]);

  return { update, error, clearError, toast, showToast, clearToast };
}

// Phones only (hidden by CSS on wider screens): the filter menus fold away behind this button so the list
// starts on the first screen. count = filters in use besides the search box.
export function FilterToggle({ open, onToggle, count = 0 }) {
  return (
    <button type="button" className={`lt-filter-toggle${open ? ' on' : ''}`} aria-expanded={open} onClick={onToggle}>
      <IconFilter size={15} /> Filters{count > 0 ? <span className="lt-tab-n">{count}</span> : null}
    </button>
  );
}

export function ErrorBanner({ message, onDismiss }) {
  if (!message) return null;
  return (
    <div className="banner lt-banner" role="alert">
      <IconAlert size={16} />
      <span>{message}</span>
      <span className="spacer" />
      <button type="button" className="btn btn-plain btn-sm" onClick={onDismiss}>Dismiss</button>
    </div>
  );
}

// Bottom toast, gone after 6 s (or when its action is used). toast: { message, actionLabel?, onAction? }.
export function Toast({ toast, onClose }) {
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(onClose, 6000);
    return () => clearTimeout(t);
  }, [toast, onClose]);
  if (!toast) return null;
  return (
    <div className="lt-toast" role="status" key={toast.key}>
      <IconCheck size={15} />
      <span>{toast.message}</span>
      {toast.actionLabel && (
        <button type="button" className="lt-toast-btn" onClick={() => { onClose(); toast.onAction?.(); }}>{toast.actionLabel}</button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- dates
// The viewer's office time zone (lib/viewer.js tz) on both sides, so the server's HTML and the browser agree.

const safeTz = (tz) => {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return tz; } catch { return 'America/Chicago'; }
};

// "9/14/26": the compact Added label (deliberately small and muted, rule 45).
export function fmtAddedIn(v, tz) {
  if (!v) return '';
  const d = new Date(v);
  if (isNaN(d)) return '';
  return d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit', timeZone: safeTz(tz) });
}
// "Added 9/14/2026, 3:04 PM" for the tooltip.
export function fmtAddedTitle(v, tz) {
  if (!v) return '';
  const d = new Date(v);
  if (isNaN(d)) return '';
  const s = d.toLocaleString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: safeTz(tz) });
  return `Added ${s.replace(/[  ]/g, ' ')}`;
}

// A 'YYYY-MM-DD' due date as "Wed, Oct 14" (calendar math only; never shifted by a time zone).
export function fmtDue(ymd, { weekday = true, year = false } = {}) {
  if (!ymd || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(ymd)) return '';
  const [y, m, d] = ymd.split('-').map(Number);
  const opts = { month: 'short', day: 'numeric', timeZone: 'UTC' };
  if (weekday) opts.weekday = 'short';
  if (year) opts.year = 'numeric';
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', opts);
}

// Read-only due chip: red when overdue, lime when due today. `today` may be null (not known yet).
export function DueChip({ due, today }) {
  if (!due) return <span className="lt-due none">No date</span>;
  const cls = today && due < today ? ' overdue' : today && due === today ? ' today' : '';
  const label = today && due === today ? 'Today' : fmtDue(due, { year: !!today && due.slice(0, 4) !== today.slice(0, 4) });
  return <span className={`lt-due${cls}`} title={`Due ${fmtDue(due, { year: true })}`}>{label}</span>;
}
