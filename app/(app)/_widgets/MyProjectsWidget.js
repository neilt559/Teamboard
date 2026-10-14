import Link from 'next/link';
import { IconFolder } from '@/app/icons';
import { projectTitle } from '@/lib/projects';

// Home dashboard widget 'my_projects' (design §2.1, §11): active projects I can see where I was added
// (day-one "legacy" access to every old project doesn't count, or this would list all 48), that belong to my
// team, or where my name owns a task. Data from loadDashboard. No hooks: a server component.
const SHOW = 8;

export default function MyProjectsWidget({ data }) {
  const mp = data?.my_projects || { total: 0, rows: [] };
  const rows = mp.rows.slice(0, SHOW);
  return (
    <section className="widget" aria-labelledby="w-my-projects">
      <div className="widget-head">
        <h2 id="w-my-projects" className="widget-title wi-h"><IconFolder size={18} /> My projects</h2>
        <Link href="/projects" prefetch={false} className="widget-more">All projects →</Link>
      </div>
      {rows.length === 0 ? (
        <p className="widget-empty">
          Projects you’re added to, own tasks in, or that belong to your team show up here.{' '}
          <Link href="/projects" prefetch={false}>Browse projects</Link>
        </p>
      ) : (
        <>
          <ul className="widget-list">
            {rows.map((p) => (
              <li key={p.id}>
                <Link href={`/projects/${p.id}`} prefetch={false} className="wl-row">
                  <span className="wl-main">
                    <span className="wl-name">{projectTitle(p)}</span>
                    <span className="wl-meta">{p.office_name} › {p.team_name}</span>
                  </span>
                  <span className="wl-count" title="Open tasks">{p.open_count}</span>
                </Link>
              </li>
            ))}
          </ul>
          {mp.total > rows.length && (
            <Link href="/projects" prefetch={false} className="widget-foot">{mp.total - rows.length} more →</Link>
          )}
        </>
      )}
    </section>
  );
}
