import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePageViewer, tagUpdating } from '@/lib/viewer';
import { loadPerson } from '@/lib/queries/people';
import { isAdmin } from '@/lib/policy';
import { IconBuilding, IconUsers, IconFolder, IconTag, IconSettings, IconShield } from '@/app/icons';
import { Headshot } from '@/app/_ui/Headshot';
import NameLabel from '@/app/_ui/NameLabel';
import Crumbs from '@/app/_ui/Crumbs';
import { initials } from '@/app/_ui/tasks';
import { DeptTag } from '../parts';
import RefreshOnFocus from '../RefreshOnFocus';

// /people/[userId]: a person's profile (design §2.1): photo, tags, approved position (a "Pending" chip
// only to the person and admins), office, team, "Reports to", direct reports, and shared projects (their
// memberships that the viewer can see, §4.6). zz_ and disabled accounts are 404 except to admins and
// themselves.
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const maxDuration = 60;

const VALID_ID = /^[0-9]{1,18}$/;
const SHOW_PROJECTS = 12;

async function load(viewer, userId) {
  try {
    return await loadPerson(viewer, userId);
  } catch (e) {
    throw tagUpdating(e);
  }
}

export async function generateMetadata({ params }) {
  const viewer = await requirePageViewer();
  if (!VALID_ID.test(String(params.userId))) return { title: 'Profile' };
  const data = await load(viewer, params.userId);
  return { title: data ? data.person.name : 'Profile' };
}

function PersonChip({ p, sub }) {
  return (
    <Link href={`/people/${p.id}`} prefetch={false} className="pp-chip">
      <Headshot user={p} size={30} />
      <span className="pp-chip-text">
        <span className="pp-chip-name">{p.name}</span>
        {sub && <span className="pp-chip-sub">{sub}</span>}
      </span>
    </Link>
  );
}

function ProjectRow({ p }) {
  return (
    <li className="pp-proj">
      <Link href={`/projects/${p.id}`} prefetch={false} className="pp-proj-name">{p.name}</Link>
      <span className="pp-proj-where">{p.office.name} · {p.team.name}</span>
      {p.archived && <span className="acct-tag test">Archived</span>}
    </li>
  );
}

export default async function PersonPage({ params }) {
  const viewer = await requirePageViewer();
  if (!VALID_ID.test(String(params.userId))) notFound();
  const data = await load(viewer, params.userId);
  if (!data) notFound();
  const { person: p, reports, projects, name_on_tasks: nameOnTasks, self } = data;
  const admin = isAdmin(viewer);
  const first = projects.slice(0, SHOW_PROJECTS);
  const rest = projects.slice(SHOW_PROJECTS);

  return (
    <div className="pp-page">
      <RefreshOnFocus />
      <Crumbs items={[{ label: 'People', href: '/people' }, { label: p.name }]} />

      <section className="pp-head">
        <Headshot user={p} size={76} className="pp-photo" />
        <div className="pp-head-main">
          <h1 className="pp-name"><NameLabel user={p} /></h1>
          <div className="pp-tags">
            {p.department && (
              <Link href={`/people?dept=${p.department.id}`} prefetch={false} className="pp-tag-link" title={`Everyone in ${p.department.name}`}>
                <DeptTag dept={p.department} />
              </Link>
            )}
            {p.is_organizer && <span className="acct-tag you">Culture organizer</span>}
            {p.unlisted && <span className="acct-tag test">Hidden from the directory</span>}
          </div>
          <div className="pp-position">
            {p.position ? p.position.name : <span className="dir-muted">No position yet</span>}
            {p.requested_position && (
              <span className="acct-tag pending" title={self ? 'An admin will review this' : 'Waiting for an admin to approve'}>
                Pending: {p.requested_position.name}
              </span>
            )}
          </div>
          {(self || admin) && (
            <div className="pp-actions">
              {self && <Link href="/settings" prefetch={false} className="btn btn-plain btn-sm wi"><IconSettings size={14} /> Edit your profile</Link>}
              {admin && !self && <Link href="/admin/users" prefetch={false} className="btn btn-plain btn-sm wi"><IconShield size={14} /> Manage in Admin</Link>}
            </div>
          )}
        </div>
      </section>

      <div className="pp-grid">
        <section className="pp-card">
          <h2 className="pp-h"><IconBuilding size={16} /> Where they work</h2>
          <dl className="pp-facts">
            <div>
              <dt>Office</dt>
              <dd>{p.office ? <Link href={`/offices/${p.office.id}`} prefetch={false}>{p.office.name}</Link> : <span className="dir-muted">Not set yet</span>}</dd>
            </div>
            <div>
              <dt>Team</dt>
              <dd>{p.team ? <Link href={`/teams/${p.team.id}`} prefetch={false}>{p.team.name}</Link> : <span className="dir-muted">No team</span>}</dd>
            </div>
            <div>
              <dt>Reports to</dt>
              <dd>{p.boss ? <PersonChip p={p.boss} /> : <span className="dir-muted">Not set</span>}</dd>
            </div>
            {nameOnTasks && (
              <div>
                <dt>Name on tasks</dt>
                <dd className="pp-nametag">
                  <span className="avatar xs" style={{ background: nameOnTasks.color }}>{initials(nameOnTasks.name)}</span>
                  {nameOnTasks.name}
                </dd>
              </div>
            )}
          </dl>
        </section>

        <section className="pp-card">
          <h2 className="pp-h"><IconUsers size={16} /> Direct reports</h2>
          {reports.length ? (
            <div className="pp-chips">
              {reports.map((r) => <PersonChip key={r.id} p={r} sub={r.position} />)}
            </div>
          ) : <p className="dir-muted pp-empty">Nobody reports to {self ? 'you' : p.name} in TeamBoard.</p>}
        </section>

        <section className="pp-card pp-wide">
          <h2 className="pp-h"><IconFolder size={16} /> Shared projects <span className="pp-count">{projects.length}</span></h2>
          <p className="pp-sub">{self ? 'Projects you’re a member of.' : 'Projects they’re on that you can see.'}</p>
          {projects.length ? (
            <>
              <ul className="pp-projects">{first.map((x) => <ProjectRow key={x.id} p={x} />)}</ul>
              {rest.length > 0 && (
                <details className="pp-more">
                  <summary>Show all {projects.length}</summary>
                  <ul className="pp-projects">{rest.map((x) => <ProjectRow key={x.id} p={x} />)}</ul>
                </details>
              )}
            </>
          ) : <p className="dir-muted pp-empty">No projects to show.</p>}
        </section>
      </div>

      <p className="pp-foot">
        <Link href="/people" prefetch={false}>All people</Link>
        <span aria-hidden="true"> · </span>
        <Link href="/people/names" prefetch={false} className="wi"><IconTag size={13} /> Names on tasks</Link>
      </p>
    </div>
  );
}
