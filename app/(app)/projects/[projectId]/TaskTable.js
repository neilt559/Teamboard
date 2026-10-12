'use client';
import TaskRow, { TaskCard } from './TaskRow';

// The task table (inventory §1.4): non-archived top-level tasks in server order (position, id), each with its
// subtasks and notes. Desktop: the old table (Task 30%, Owner 16%, Stoplight 10%, Due 13%, Status 15%,
// Added 8%, actions 8%; min-width 640 px in a scroller). Phones: cards that open the task's own page
// (design §2.2). Both are rendered and CSS shows one, so the server HTML is right for either.
export default function TaskTable({ tasks, subsByParent, ctx }) {
  const { ro, actions } = ctx;
  return (
    <>
      <div className="board board-desktop">
        <div className="board-scroll">
          <table>
            <thead>
              <tr>
                <th style={{ width: '30%' }}>Task</th>
                <th style={{ width: '16%' }}>Owner</th>
                <th style={{ width: '10%', textAlign: 'center' }}>Stoplight</th>
                <th style={{ width: '13%' }}>Due date</th>
                <th style={{ width: '15%' }}>Status</th>
                <th style={{ width: '8%', textAlign: 'center' }}>Added</th>
                <th style={{ width: '8%' }}><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((t) => <TaskRow key={t.id} t={t} subs={subsByParent[String(t.id)] || []} ctx={ctx} />)}
              {!tasks.length && (
                <tr><td colSpan={7} className="board-empty">No tasks yet — add your first one.</td></tr>
              )}
              {!ro && (
                <tr>
                  <td colSpan={7} style={{ padding: 0 }}>
                    <button type="button" className="add-task-btn" onClick={actions.addTask}>+ Add task</button>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="task-cards" aria-label="Tasks">
        {tasks.map((t) => <TaskCard key={t.id} t={t} subs={subsByParent[String(t.id)] || []} people={ctx.people} pid={ctx.pid} />)}
        {!tasks.length && <p className="tc-empty">No tasks yet — add your first one.</p>}
        {!ro && <button type="button" className="task-card-add" onClick={actions.addTaskAndOpen}>+ Add task</button>}
      </div>
    </>
  );
}
