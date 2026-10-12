'use client';
import { Fragment, useState } from 'react';
import Link from 'next/link';
import { IconArchive, IconCaret, IconChevronRight, IconRestore } from '@/app/icons';
import { Avatar, StatusPill, StoplightDots, fmtAdded, personById } from '@/app/_ui/tasks';
import TaskRow, { TaskCard } from './TaskRow';

// Archived (done) top-level tasks (inventory §1.4): collapsed by default; read-only rows with Restore (status
// stays Done, rule 22) and delete. An archived parent's subtasks are listed under it and stay editable
// (design §4.6: they no longer appear in All Tasks or My work, so this is where they live).
export default function ArchivedTasks({ tasks, subsByParent, ctx, open, onToggle }) {
  const { people, ro, mounted, actions } = ctx;
  const [openSubs, setOpenSubs] = useState({});
  return (
    <div className="archive">
      <button type="button" className="archive-toggle wi" aria-expanded={open} onClick={onToggle}>
        <IconArchive size={15} /> Archived ({tasks.length}) <IconCaret size={13} className={open ? 'caret-up' : ''} />
      </button>
      {open && (
        <>
          <div className="board archive-board board-desktop">
            <div className="board-scroll">
              <table>
                <tbody>
                  {tasks.map((t) => {
                    const owner = personById(people, t.assignee_id);
                    const subs = subsByParent[String(t.id)] || [];
                    const subOpen = !!openSubs[t.id];
                    const subDone = subs.filter((s) => s.status === 'done').length;
                    return (
                      <Fragment key={t.id}>
                        <tr className="archived-row">
                          <td style={{ width: '30%' }}>
                            <div className="title-cell">
                              {subs.length > 0 ? (
                                <button type="button" className="subtask-toggle" title="Show subtasks" aria-expanded={subOpen} onClick={() => setOpenSubs((s) => ({ ...s, [t.id]: !s[t.id] }))}>
                                  <IconCaret size={13} className={`caret${subOpen ? '' : ' caret-closed'}`} />
                                  <span className="sub-badge">{subDone}/{subs.length}</span>
                                </button>
                              ) : null}
                              <span className="archived-title">{t.title || 'Untitled task'}</span>
                              <Link href={`/projects/${ctx.pid}/tasks/${t.id}`} prefetch={false} className="row-open" title="Open this task" aria-label={`Open task ${t.title || ''}`.trim()}>
                                <IconChevronRight size={14} />
                              </Link>
                            </div>
                          </td>
                          <td style={{ width: '16%' }}>
                            <div className="cell-owner">
                              <Avatar person={owner} />
                              <span className="archived-owner">{owner ? owner.name : 'Unassigned'}</span>
                            </div>
                          </td>
                          <td style={{ width: '10%' }}><StoplightDots value={t.stoplight} /></td>
                          <td style={{ width: '13%' }} className="archived-due">{t.due_date || '—'}</td>
                          <td style={{ width: '15%' }}><StatusPill value={t.status} /></td>
                          <td style={{ width: '8%', textAlign: 'center' }} className="added-cell">{mounted ? fmtAdded(t.created_at) : ''}</td>
                          <td style={{ width: '8%', whiteSpace: 'nowrap', textAlign: 'right' }}>
                            {!ro && (
                              <>
                                <button type="button" className="restore-btn" title="Restore to the board" aria-label="Restore to the board" onClick={() => actions.restoreTask(t)}><IconRestore size={15} /></button>
                                <button type="button" className="row-x" title="Delete task" aria-label="Delete task" onClick={() => actions.deleteTask(t)}>×</button>
                              </>
                            )}
                          </td>
                        </tr>
                        {subOpen && subs.map((sub) => <TaskRow key={sub.id} t={sub} isSub ctx={ctx} />)}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          <div className="task-cards archive-cards">
            {tasks.map((t) => <TaskCard key={t.id} t={t} subs={subsByParent[String(t.id)] || []} people={people} pid={ctx.pid} archived />)}
          </div>
        </>
      )}
    </div>
  );
}
