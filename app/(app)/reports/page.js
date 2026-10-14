import Link from 'next/link';
import { requirePageViewer } from '@/lib/viewer';
import { nowFromRequestContext } from '@/lib/clock';
import { listReportGroups } from '@/lib/queries/reports';
import { IconAlert, IconChevronRight, IconFile } from '@/app/icons';
import Crumbs from '@/app/_ui/Crumbs';
import { ScheduleBadge } from '@/app/_ui/project-status';
import { fmtYmd } from '@/app/_ui/project-format';

// /reports (design-amendments A6.7): every active project the viewer can see (not archived, in an active team and
// office), grouped by owner company (spellings that differ only in case or spacing are one owner). Each group
// opens its packet (/reports/owner?name=), each project its own report. Projects without an owner sit under
// "No owner set" with a prompt to fill it in. Report-safe data only (lib/queries/reports.js).
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const maxDuration = 60;

export const metadata = { title: 'Weekly reports' };

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

function ProjectRow({ p, noOwner = false }) {
  return (
    <li className="rp-prow">
      <div className="rp-prow-main">
        <Link href={`/projects/${p.id}`} prefetch={false} className="rp-prow-title">{p.title || 'Untitled project'}</Link>
        <span className="rp-prow-meta">
          {[p.jurisdiction, p.current_stage_label || 'No stage set'].filter(Boolean).join(' · ')}
          {p.status_report_pending && <span className="rp-prow-flag" title="Its text predates the weekly reports: review it on the project page (Use in reports)"> · Status Report not reviewed yet</span>}
        </span>
      </div>
      <ScheduleBadge status={p.schedule_status} empty="No schedule" />
      {noOwner ? (
        <Link href={`/projects/${p.id}`} prefetch={false} className="btn btn-plain btn-sm rp-prow-btn">Set owner</Link>
      ) : (
        <Link href={`/projects/${p.id}/report`} prefetch={false} className="btn btn-plain btn-sm rp-prow-btn">Report</Link>
      )}
    </li>
  );
}

export default async function ReportsPage() {
  const viewer = await requirePageViewer();
  const data = await listReportGroups(viewer, nowFromRequestContext());
  const total = data.groups.reduce((n, g) => n + g.projects.length, 0) + data.no_owner.length;
  return (
    <div className="lt-page rp-index">
      <Crumbs items={[{ label: 'Projects', href: '/projects' }, { label: 'Weekly reports' }]} />
      <div className="proj-head">
        <h1 className="wi-h"><IconFile size={24} /> Weekly reports</h1>
        <span className="progress-label">{plural(total, 'active project')} · {fmtYmd(data.report_date, { long: true })}</span>
        <span className="spacer" />
        <Link href="/projects" prefetch={false} className="lt-head-link">All projects <IconChevronRight size={14} /></Link>
      </div>
      <p className="rp-intro">
        Every active project you can see, grouped by owner company. Open an owner’s packet to save it as one PDF or copy
        it into an email; each project also has its own report. Reports show the stage, schedule, Status Report,
        submittals and upcoming meetings only, never tasks or other internal notes.
      </p>

      {total === 0 && (
        <div className="empty">
          <h3>No active projects to report on</h3>
          <p>Projects you can see show up here, grouped by their owner company.</p>
        </div>
      )}

      {data.groups.map((g) => (
        <section key={g.key} className="rp-group" aria-label={`Owner: ${g.owner}`}>
          <div className="rp-group-head">
            <h2>{g.owner}</h2>
            <span className="rp-count">{plural(g.projects.length, 'project')}</span>
            <span className="spacer" />
            <Link href={`/reports/owner?name=${encodeURIComponent(g.owner)}`} prefetch={false} className="btn btn-lime wi rp-open-packet">
              <IconFile size={15} /> Open packet
            </Link>
          </div>
          <ul className="rp-plist">
            {g.projects.map((p) => <ProjectRow key={p.id} p={p} />)}
          </ul>
        </section>
      ))}

      {data.no_owner.length > 0 && (
        <section className="rp-group rp-noowner" aria-label="No owner set">
          <div className="rp-group-head">
            <h2>No owner set</h2>
            <span className="rp-count">{plural(data.no_owner.length, 'project')}</span>
          </div>
          <p className="rp-noowner-hint">
            <IconAlert size={15} />
            <span>
              These projects have no owner company yet, so they aren’t in any packet. Open each one and fill in the
              owner under <b>Project details</b> (its creator, its office’s project engineers and PMs can).
            </span>
          </p>
          <ul className="rp-plist">
            {data.no_owner.map((p) => <ProjectRow key={p.id} p={p} noOwner />)}
          </ul>
        </section>
      )}
    </div>
  );
}
