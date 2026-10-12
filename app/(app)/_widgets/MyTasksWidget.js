import Link from 'next/link';
import { IconCheck } from '@/app/icons';
import { STOPLIGHTS, TASK_STATUSES } from '@/app/_ui/tasks';
import { addDays } from '@/lib/time';

// Home dashboard widget 'my_tasks' (design §2.1, §11): open tasks owned by my linked name, soonest due first
// (overdue, today, upcoming, then no date). Data comes from loadDashboard (lib/queries/home.js) through the
// page; rows open the task detail. No hooks: a server component.
const SHOW = 8;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const md = (ymd) => { const [, m, d] = ymd.split('-').map(Number); return `${MONTHS[m - 1]} ${d}`; };

// "Overdue · Oct 9" / "Today" / "Tomorrow" / "Fri" / "Oct 20", against today in the viewer's office zone.
export function dueLabel(due, today) {
  if (!due) return null;
  if (due < today) return { text: `Overdue · ${md(due)}`, kind: 'overdue' };
  if (due === today) return { text: 'Today', kind: 'today' };
  if (due === addDays(today, 1)) return { text: 'Tomorrow', kind: 'soon' };
  if (due <= addDays(today, 6)) return { text: DAYS[new Date(`${due}T00:00:00Z`).getUTCDay()], kind: 'soon' };
  return { text: md(due), kind: 'later' };
}

export default function MyTasksWidget({ data }) {
  const mt = data?.my_tasks || { linked: false, rows: [], total: 0, overdue: 0, due_today: 0 };
  const today = data?.today;
  const rows = mt.rows.slice(0, SHOW);
  return (
    <section className="widget" aria-labelledby="w-my-tasks">
      <div className="widget-head">
        <h2 id="w-my-tasks" className="widget-title wi-h"><IconCheck size={18} /> My tasks</h2>
        <Link href="/my-work" prefetch={false} className="widget-more">My work →</Link>
      </div>
      {!mt.linked && data?.pending_person ? (
        <p className="widget-empty">
          Waiting for an admin to confirm you’re “{data.pending_person}”. Its tasks show up here once it’s approved.{' '}
          <Link href="/settings?tab=names" prefetch={false}>Name on tasks</Link>
        </p>
      ) : !mt.linked ? (
        <p className="widget-empty">
          Your account isn’t linked to a name on tasks yet, so nothing is assigned to you here.{' '}
          <Link href="/settings?tab=names" prefetch={false}>Link me to my name</Link>
        </p>
      ) : mt.total === 0 ? (
        <p className="widget-empty">Nothing open with your name on it. Tasks assigned to you show up here.</p>
      ) : (
        <>
          <p className="widget-sum">
            {mt.overdue > 0 && <span className="due-chip overdue">{mt.overdue} overdue</span>}
            {mt.due_today > 0 && <span className="due-chip today">{mt.due_today} due today</span>}
            <span>{mt.total} open</span>
          </p>
          <ul className="widget-list">
            {rows.map((t) => {
              const due = dueLabel(t.due_date, today);
              const st = TASK_STATUSES[t.status];
              return (
                <li key={t.id}>
                  <Link href={`/projects/${t.project_id}/tasks/${t.id}`} prefetch={false} className="wl-row"
                    style={{ '--sl': t.stoplight && STOPLIGHTS[t.stoplight] ? STOPLIGHTS[t.stoplight] : 'transparent' }}>
                    <span className="wl-main">
                      <span className="wl-name">{t.parent_id ? '↳ ' : ''}{t.title || (t.parent_id ? 'Untitled subtask' : 'Untitled task')}</span>
                      <span className="wl-meta">
                        {t.project_name}{t.parent_id && t.parent_title ? ` · under “${t.parent_title}”` : ''}
                        {st && t.status !== 'not_started' ? <span className="wl-status" style={{ color: st.text }}> · {st.label}</span> : null}
                      </span>
                    </span>
                    {due && <span className={`due-chip ${due.kind}`}>{due.text}</span>}
                  </Link>
                </li>
              );
            })}
          </ul>
          {mt.total > rows.length && (
            <Link href="/my-work" prefetch={false} className="widget-foot">{mt.total - rows.length} more in My work →</Link>
          )}
        </>
      )}
    </section>
  );
}
