'use client';
import { Fragment } from 'react';
import Link from 'next/link';
import { IconCaret, IconChevronRight, IconNote } from '@/app/icons';
import { SyncedField, SyncedTextarea } from '@/app/synced';
import {
  Avatar, OwnerSelect, StatusPill, StatusSelect, StoplightDots, STOPLIGHTS, STOPLIGHT_TITLES, fmtAdded, personById,
} from '@/app/_ui/tasks';

// Owner choices: every active name, plus the current owner if that name has since been archived (so the
// select still shows who owns it).
export function ownerOptions(people, currentId) {
  return (people || []).filter((pe) => !pe.archived || (currentId != null && String(pe.id) === String(currentId)));
}

// "2026-10-14" -> "Oct 14" (or "Oct 14, 2027" outside this year); read as a local date.
export function fmtDue(s, withYear = false) {
  if (!s) return '';
  const [y, m, d] = String(s).split('-').map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  if (isNaN(dt)) return s;
  const opts = { month: 'short', day: 'numeric' };
  if (withYear) opts.year = 'numeric';
  return dt.toLocaleDateString('en-US', opts);
}

// One task row of the board table (the old renderTaskRow, same markup and classes), followed by its note
// preview or notes editor and, for an expanded top-level task, its subtasks and "+ Add subtask".
// ctx = { pid, people, ro, mounted, focusId, actions, conflictUI, expandedSubs, expandedNotes, toggleSubs, toggleNotes }
export default function TaskRow({ t, isSub = false, subs = [], ctx }) {
  const { people, ro, mounted, focusId, actions, conflictUI, expandedSubs, expandedNotes, toggleSubs, toggleNotes, noSubs = false } = ctx;
  const owner = personById(people, t.assignee_id);
  const hasNotes = (t.notes || '').trim().length > 0;
  const notesOpen = !!expandedNotes[t.id];
  const subOpen = !isSub && !noSubs && !!expandedSubs[t.id];
  const subDone = subs.filter((s) => s.status === 'done').length;
  const label = isSub ? 'subtask' : 'task';
  return (
    <Fragment>
      <tr className={`${isSub ? 'subtask-row' : ''}${hasNotes && !notesOpen ? ' has-note-below' : ''}`}>
        <td>
          <div className={isSub ? 'subtask-title-cell' : 'title-cell'}>
            {isSub ? (
              <span className="subtask-arrow" aria-hidden="true">↳</span>
            ) : noSubs ? null : (
              <button type="button" className="subtask-toggle" title="Show / add subtasks" aria-expanded={subOpen} aria-label={`Subtasks of ${t.title || 'this task'}`} onClick={() => toggleSubs(t.id)}>
                <IconCaret size={13} className={`caret${subOpen ? '' : ' caret-closed'}`} />
                {subs.length > 0 && <span className="sub-badge">{subDone}/{subs.length}</span>}
              </button>
            )}
            <div className="title-main">
              {ro ? (
                <span className="task-title task-title-ro">{t.title || <span className="muted">{isSub ? 'Untitled subtask' : 'Untitled task'}</span>}</span>
              ) : (
                <SyncedField
                  className="task-title"
                  value={t.title}
                  placeholder={isSub ? 'Untitled subtask' : 'Untitled task'}
                  aria-label={isSub ? 'Subtask title' : 'Task title'}
                  maxLength={500}
                  autoFocus={focusId != null && String(focusId) === String(t.id)}
                  onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                  onSave={(v, base) => actions.saveTaskText(t.id, 'title', v, base)}
                />
              )}
              {conflictUI(`task:${t.id}:title`)}
            </div>
            <Link href={`/projects/${ctx.pid}/tasks/${t.id}`} prefetch={false} className="row-open" title={`Open this ${label}`} aria-label={`Open ${label} ${t.title || ''}`.trim()}>
              <IconChevronRight size={14} />
            </Link>
          </div>
        </td>
        <td>
          <div className="cell-owner">
            <Avatar person={owner} />
            {ro ? (
              <span className="archived-owner">{owner ? owner.name : 'Unassigned'}</span>
            ) : (
              <OwnerSelect
                value={t.assignee_id}
                people={ownerOptions(people, t.assignee_id)}
                aria-label="Owner"
                onChange={(v) => actions.patchTask(t.id, { assignee_id: v })}
              />
            )}
          </div>
        </td>
        <td>
          <StoplightDots value={t.stoplight} onChange={ro ? undefined : (c) => actions.patchTask(t.id, { stoplight: c })} />
        </td>
        <td>
          {ro ? (
            <span className="archived-due">{t.due_date || '—'}</span>
          ) : (
            <input type="date" className="date-input" aria-label="Due date" value={t.due_date ?? ''} onChange={(e) => actions.patchTask(t.id, { due_date: e.target.value || null })} />
          )}
        </td>
        <td>
          {ro ? <StatusPill value={t.status} /> : <StatusSelect value={t.status} aria-label="Status" onChange={(s) => actions.setStatus(t, s)} />}
        </td>
        <td className="added-cell" title={mounted && t.created_at ? `Added ${new Date(t.created_at).toLocaleString()}` : ''}>
          {isSub || !mounted ? '' : fmtAdded(t.created_at)}
        </td>
        <td className="row-actions">
          <button
            type="button"
            className={`notes-btn${hasNotes ? ' has-notes' : ''}`}
            title={hasNotes ? 'Edit note' : 'Add a note'}
            aria-label={hasNotes ? 'Edit note' : 'Add a note'}
            aria-expanded={notesOpen}
            onClick={() => toggleNotes(t.id)}
          ><IconNote size={15} /></button>
          {!ro && (
            <button type="button" className="row-x" title={isSub ? 'Delete subtask' : 'Delete task'} aria-label={isSub ? 'Delete subtask' : 'Delete task'} onClick={() => actions.deleteTask(t)}>×</button>
          )}
        </td>
      </tr>

      {hasNotes && !notesOpen && (
        <tr className="note-preview-row">
          <td colSpan={7}>
            <button type="button" className="note-preview" title="Click to edit note" onClick={() => toggleNotes(t.id)}><IconNote size={13} /> {t.notes}</button>
          </td>
        </tr>
      )}

      {notesOpen && (
        <tr className="task-notes-row">
          <td colSpan={7}>
            {ro ? (
              <div className="task-notes-area task-notes-ro">{t.notes || <span className="muted">No notes.</span>}</div>
            ) : (
              <SyncedTextarea
                className="task-notes-area"
                value={t.notes || ''}
                aria-label={isSub ? 'Subtask notes' : 'Task notes'}
                placeholder="Notes — details, blockers, links. Everyone on the team can see this."
                maxLength={5000}
                onSave={(v, base) => actions.saveTaskText(t.id, 'notes', v, base)}
              />
            )}
            {conflictUI(`task:${t.id}:notes`)}
          </td>
        </tr>
      )}

      {subOpen && (
        <>
          {subs.map((sub) => <TaskRow key={sub.id} t={sub} isSub ctx={ctx} />)}
          {!ro && (
            <tr className="subtask-add-row">
              <td colSpan={7}><button type="button" className="add-subtask-btn" onClick={() => actions.addSubtask(t.id)}>+ Add subtask</button></td>
            </tr>
          )}
        </>
      )}
    </Fragment>
  );
}

// Phone layout (design §2.2): each task is a card that opens its own page.
export function TaskCard({ t, subs = [], people, pid, archived = false }) {
  const owner = personById(people, t.assignee_id);
  const subDone = subs.filter((s) => s.status === 'done').length;
  const hasNotes = (t.notes || '').trim().length > 0;
  return (
    <Link href={`/projects/${pid}/tasks/${t.id}`} prefetch={false} className={`task-card${archived ? ' task-card-archived' : ''}`}>
      <span className="tc-main">
        <span className={`tc-title${t.title ? '' : ' muted'}${archived ? ' archived-title' : ''}`}>{t.title || 'Untitled task'}</span>
        <span className="tc-meta">
          <Avatar person={owner} xs />
          <span className="tc-owner">{owner ? owner.name : 'Unassigned'}</span>
          {t.due_date && <span className="tc-due">Due {fmtDue(t.due_date)}</span>}
          {subs.length > 0 && <span className="sub-badge" title="Subtasks done">{subDone}/{subs.length}</span>}
          {hasNotes && <span className="tc-note" title="Has notes"><IconNote size={13} /></span>}
        </span>
      </span>
      <span className="tc-side">
        {t.stoplight && STOPLIGHTS[t.stoplight] && (
          <span className="sl-dot on tc-sl" style={{ '--sl': STOPLIGHTS[t.stoplight] }} title={STOPLIGHT_TITLES[t.stoplight]} />
        )}
        <StatusPill value={t.status} />
      </span>
      <IconChevronRight size={16} className="tc-go" />
    </Link>
  );
}
