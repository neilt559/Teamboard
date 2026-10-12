'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { IconAlert, IconArchive, IconChevronRight, IconFile, IconNote, IconRestore, IconTrash } from '@/app/icons';
import { SyncedField, SyncedTextarea } from '@/app/synced';
import { api, ConflictError } from '@/app/_ui/api';
import useServerState from '@/app/_ui/useServerState';
import { RefreshPill } from '@/app/_ui/useRefresh';
import ConflictNotice from '@/app/_ui/ConflictNotice';
import { useConfirm } from '@/app/_ui/ConfirmDialog';
import Crumbs from '@/app/_ui/Crumbs';
import { Avatar, OwnerSelect, StatusPill, StatusSelect, StoplightDots, fmtAdded, personById } from '@/app/_ui/tasks';
import { ownerOptions } from '../../TaskRow';
import { addedText, useMounted } from '../../ProjectBoard';
import useBoardSync from '../../useBoardSync';

// Task detail (design §2.1): phone-first page for one task or subtask: title, owner, stoplight, due date,
// status, notes, subtasks, and who added and last edited it. Same API and conflict handling as the board;
// polls the project's rev every 20 s.

const same = (a, b) => a != null && b != null && String(a) === String(b);

export default function TaskDetail({ initial }) {
  const router = useRouter();
  const [d, setD] = useServerState(initial);
  const { project: p, task: t, parent } = d;
  const pid = String(p.id);
  const isSub = t.parent_id != null;
  const ro = !!p.archived || !!t.archived;
  const mounted = useMounted();
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);
  const [conflicts, setConflicts] = useState({});
  const [focusSubId, setFocusSubId] = useState(null);   // the subtask just added: its title gets focus, as on the board
  const [confirmUI, ask] = useConfirm();
  const toastTimer = useRef(null);

  const { stale, refresh, wrote, refreshNow } = useBoardSync({
    projectId: pid, initialRev: initial.project.rev, initialArchived: initial.project.archived, props: initial,
  });

  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);
  const showToast = (msg) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4500);
  };
  const fail = (e) => { if (e?.status !== 401) setError(e?.message || 'Something went wrong — please try again.'); };

  // The task, its parent or one of its subtasks: wherever that id lives in local state.
  const mergeLocal = useCallback((id, patch) => setD((x) => ({
    ...x,
    task: same(x.task.id, id) ? { ...x.task, ...patch } : x.task,
    parent: x.parent && same(x.parent.id, id) ? { ...x.parent, ...patch } : x.parent,
    subtasks: x.subtasks.map((s) => (same(s.id, id) ? { ...s, ...patch } : s)),
  })), [setD]);

  const clearConflict = (key) => setConflicts((c) => { if (!c[key]) return c; const n = { ...c }; delete n[key]; return n; });

  const afterWrite = (r) => {
    wrote();
    if (r?.added_members?.length) { showToast(addedText(r.added_members)); refreshNow(); }
  };
  const gone = (e) => { if (e?.status === 404) refreshNow(); };

  const saveText = async (id, field, value, base) => {
    const key = `${id}:${field}`;
    clearConflict(key);
    mergeLocal(id, { [field]: value });
    try {
      const r = await api(`/api/tasks/${id}`, { method: 'PATCH', body: { [field]: value, base: { [field]: base } } });
      afterWrite(r);
      if (r?.row) mergeLocal(id, r.row);
      return r?.row ? r.row[field] : value;
    } catch (e) {
      if (e instanceof ConflictError) {
        if (e.current) mergeLocal(id, e.current);
        setConflicts((c) => ({ ...c, [key]: { conflict: e, mine: value, retry: (theirs) => saveText(id, field, value, theirs) } }));
      } else { fail(e); gone(e); }
      throw e;
    }
  };
  const conflictUI = (key) => {
    const c = conflicts[key];
    if (!c) return null;
    return (
      <ConflictNotice
        conflict={c.conflict}
        field={key.split(':').pop()}
        mine={c.mine}
        onKeepMine={async (theirs) => { clearConflict(key); try { await c.retry(theirs); } catch {} }}
        onUseTheirs={() => clearConflict(key)}
      />
    );
  };

  const patch = async (id, body, local = body) => {
    mergeLocal(id, local);
    try {
      const r = await api(`/api/tasks/${id}`, { method: 'PATCH', body });
      afterWrite(r);
      if (r?.row) mergeLocal(id, r.row);
    } catch (e) { fail(e); gone(e); refreshNow(); }
  };
  const setStatus = (task, status) => patch(task.id, { status }, status === 'done' && task.parent_id == null ? { status, archived: true } : { status });

  const addSubtask = async () => {
    try {
      const r = await api('/api/tasks', { method: 'POST', body: { project_id: pid, parent_id: t.id } });
      wrote();
      const { added_members: added, ...row } = r || {};
      if (row.id != null) {
        setD((x) => ({ ...x, subtasks: [...x.subtasks, row] }));
        setFocusSubId(String(row.id));
      }
      if (added?.length) showToast(addedText(added));
      refreshNow();
    } catch (e) { fail(e); }
  };

  const del = async () => {
    const what = isSub ? 'subtask' : 'task';
    if (!(await ask({ title: `Delete this ${what}? This can’t be undone.`, confirmLabel: 'Delete', danger: true }))) return;
    try {
      await api(`/api/tasks/${t.id}`, { method: 'DELETE' });
      router.replace(isSub ? `/projects/${pid}/tasks/${t.parent_id}` : `/projects/${pid}`);
      router.refresh();
    } catch (e) { fail(e); }
  };
  const delSub = async (s) => {
    if (!(await ask({ title: 'Delete this subtask? This can’t be undone.', confirmLabel: 'Delete', danger: true }))) return;
    setD((x) => ({ ...x, subtasks: x.subtasks.filter((y) => !same(y.id, s.id)) }));
    try { await api(`/api/tasks/${s.id}`, { method: 'DELETE' }); wrote(); refreshNow(); } catch (e) { fail(e); refreshNow(); }
  };

  const owner = personById(d.people, t.assignee_id);
  const subDone = d.subtasks.filter((s) => s.status === 'done').length;
  const crumbs = [
    { label: 'Offices', href: '/offices' },
    p.office_id != null ? { label: p.office_name, href: `/offices/${p.office_id}` } : null,
    p.team_id != null ? { label: p.team_name, href: `/teams/${p.team_id}` } : null,
    { label: p.name, href: `/projects/${pid}` },
    parent ? { label: parent.title || 'Untitled task', href: `/projects/${pid}/tasks/${parent.id}` } : null,
    { label: t.title || (isSub ? 'Untitled subtask' : 'Untitled task') },
  ];

  return (
    <div className="task-detail">
      <Crumbs items={crumbs} />
      {error && (
        <div className="banner" role="alert">
          <IconAlert size={16} />
          <span>{error}</span>
          <span className="spacer" />
          <button type="button" className="btn btn-plain btn-sm" onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}
      {p.archived && (
        <div className="banner setup" role="status"><IconArchive size={16} /><span>This project was archived. Its tasks are read-only.</span></div>
      )}
      {!p.archived && t.archived && (
        <div className="banner setup td-archived" role="status">
          <IconArchive size={16} />
          <span>{isSub ? 'This subtask is archived.' : 'This task is done and archived.'}</span>
          <span className="spacer" />
          <button type="button" className="btn btn-ink btn-sm wi" onClick={() => patch(t.id, { archived: false })}><IconRestore size={14} /> Restore to the board</button>
        </div>
      )}

      <div className="td-card">
        <div className="td-kind">
          <IconFile size={14} />
          {isSub && parent ? (
            <span>Subtask of <Link href={`/projects/${pid}/tasks/${parent.id}`} prefetch={false}>{parent.title || 'Untitled task'}</Link></span>
          ) : (
            <span>Task in <Link href={`/projects/${pid}`} prefetch={false}>{p.name}</Link></span>
          )}
        </div>
        {ro ? (
          <h1 className="td-title td-title-ro">{t.title || <span className="muted">{isSub ? 'Untitled subtask' : 'Untitled task'}</span>}</h1>
        ) : (
          <SyncedField
            className="td-title"
            value={t.title}
            placeholder={isSub ? 'Untitled subtask' : 'Untitled task'}
            aria-label={isSub ? 'Subtask title' : 'Task title'}
            maxLength={500}
            autoFocus={!t.title}
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
            onSave={(v, base) => saveText(t.id, 'title', v, base)}
          />
        )}
        {conflictUI(`${t.id}:title`)}

        <div className="td-fields">
          <div className="td-field">
            <span className="td-label">Status</span>
            {ro ? <StatusPill value={t.status} /> : <StatusSelect value={t.status} aria-label="Status" onChange={(s) => setStatus(t, s)} />}
          </div>
          <div className="td-field">
            <span className="td-label">Owner</span>
            <div className="cell-owner">
              <Avatar person={owner} />
              {ro ? <span>{owner ? owner.name : 'Unassigned'}</span> : (
                <OwnerSelect value={t.assignee_id} people={ownerOptions(d.people, t.assignee_id)} aria-label="Owner" onChange={(v) => patch(t.id, { assignee_id: v })} />
              )}
            </div>
          </div>
          <div className="td-field">
            <span className="td-label">Priority</span>
            <StoplightDots value={t.stoplight} onChange={ro ? undefined : (c) => patch(t.id, { stoplight: c })} />
          </div>
          <div className="td-field">
            <span className="td-label">Due date</span>
            {ro ? <span>{t.due_date || '—'}</span> : (
              <input type="date" className="date-input" aria-label="Due date" value={t.due_date ?? ''} onChange={(e) => patch(t.id, { due_date: e.target.value || null })} />
            )}
          </div>
        </div>

        <div className="td-notes">
          <label className="notes-label" htmlFor={`tnotes-${t.id}`}><IconNote size={14} /> Notes</label>
          {ro ? (
            <div className="notes-area notes-ro">{t.notes || <span className="muted">No notes.</span>}</div>
          ) : (
            <SyncedTextarea
              id={`tnotes-${t.id}`}
              className="notes-area td-notes-area"
              value={t.notes || ''}
              placeholder="Notes — details, blockers, links. Everyone on the team can see this."
              maxLength={5000}
              onSave={(v, base) => saveText(t.id, 'notes', v, base)}
            />
          )}
          {conflictUI(`${t.id}:notes`)}
        </div>

        {!isSub && (
          <div className="td-subtasks">
            <div className="td-sub-head">
              <span className="notes-label">Subtasks {d.subtasks.length > 0 && <span className="sub-badge">{subDone}/{d.subtasks.length}</span>}</span>
            </div>
            {d.subtasks.length === 0 && <p className="info-empty">No subtasks yet.</p>}
            <ul className="td-sub-list">
              {d.subtasks.map((s) => {
                const sro = !!p.archived || !!s.archived;
                return (
                  <li key={s.id} className="td-sub">
                    <div className="td-sub-main">
                      {sro ? <span className="td-sub-title">{s.title || <span className="muted">Untitled subtask</span>}</span> : (
                        <SyncedField
                          className="task-title td-sub-title"
                          value={s.title}
                          placeholder="Untitled subtask"
                          aria-label="Subtask title"
                          maxLength={500}
                          autoFocus={focusSubId != null && String(focusSubId) === String(s.id)}
                          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                          onSave={(v, base) => saveText(s.id, 'title', v, base)}
                        />
                      )}
                      {conflictUI(`${s.id}:title`)}
                      <div className="td-sub-meta">
                        {sro ? <StatusPill value={s.status} /> : <StatusSelect value={s.status} aria-label="Subtask status" onChange={(v) => setStatus(s, v)} />}
                        <Avatar person={personById(d.people, s.assignee_id)} xs />
                        {s.due_date && <span className="tc-due">{s.due_date}</span>}
                      </div>
                    </div>
                    <div className="td-sub-actions">
                      <Link href={`/projects/${pid}/tasks/${s.id}`} prefetch={false} className="btn btn-plain btn-sm td-open" aria-label={`Open subtask ${s.title || ''}`.trim()}>
                        Open <IconChevronRight size={14} />
                      </Link>
                      {!p.archived && (
                        <button type="button" className="row-x" aria-label="Delete subtask" title="Delete subtask" onClick={() => delSub(s)}>×</button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
            {!p.archived && <button type="button" className="btn btn-plain btn-sm td-add-sub" onClick={addSubtask}>+ Add subtask</button>}
          </div>
        )}

        <p className="td-foot">
          {mounted && t.created_at ? <>Added {fmtAdded(t.created_at)}{t.created_by_name ? ` by ${t.created_by_name}` : ''}</> : null}
          {mounted && t.updated_at ? <> · Last edited {new Date(t.updated_at).toLocaleString()}{t.updated_by_name ? ` by ${t.updated_by_name}` : ''}</> : null}
        </p>

        <div className="td-actions">
          <Link href={`/projects/${pid}`} prefetch={false} className="btn btn-plain">Back to the project</Link>
          <div className="spacer" />
          {!p.archived && (
            <button type="button" className="btn btn-plain td-delete wi" onClick={del}><IconTrash size={14} /> Delete {isSub ? 'subtask' : 'task'}</button>
          )}
        </div>
      </div>

      {toast && <div className="board-toast" role="status">{toast}</div>}
      {stale && <RefreshPill onClick={refresh} />}
      {confirmUI}
    </div>
  );
}
