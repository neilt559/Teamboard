import * as React from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePageViewer } from '@/lib/viewer';
import { nowFromRequestContext } from '@/lib/clock';
import { loadOwnerPacket } from '@/lib/queries/reports';
import Crumbs from '@/app/_ui/Crumbs';
import { ScheduleBadge } from '@/app/_ui/project-status';
import ReportDoc, { PendingReviewNotice, ReportBrand } from '../_components/ReportDoc';
import ReportActions from '../_components/ReportActions';

// /reports/owner?name=<owner> (design-amendments A6.7): one printable packet for an owner company: a cover
// (owner, report date, the projects in it), then each active project the viewer can see with that owner on its
// own page (page-break-before in reports.css), with Save as PDF and Copy for email. A blank name is a 404; an
// owner with no such project shows an empty packet (the same whether or not hidden projects carry that owner).
// Report-safe data only (lib/queries/reports.js).
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const maxDuration = 60;

const cache = typeof React.cache === 'function' ? React.cache : (fn) => fn;
const requestNow = cache(() => nowFromRequestContext());
const nameOf = (sp) => {
  const v = Array.isArray(sp?.name) ? sp.name[0] : sp?.name;
  return typeof v === 'string' ? v.slice(0, 300) : '';
};

export async function generateMetadata({ searchParams }) {
  const viewer = await requirePageViewer();
  const data = await loadOwnerPacket(viewer, nameOf(searchParams), requestNow());
  if (!data) notFound();
  return { title: `${data.owner} · weekly packet` };
}

export default async function OwnerPacketPage({ searchParams }) {
  const viewer = await requirePageViewer();
  const data = await loadOwnerPacket(viewer, nameOf(searchParams), requestNow());
  if (!data) notFound();
  const n = data.projects.length;
  return (
    <div className="rp-page rp-packet">
      <div className="rp-screen-only">
        <Crumbs items={[{ label: 'Projects', href: '/projects' }, { label: 'Weekly reports', href: '/reports' }, { label: data.owner }]} />
        <ReportActions reports={data.projects} reportDate={data.report_date} owner={data.owner} backHref="/reports" backLabel="Back to weekly reports" />
        <PendingReviewNotice projects={data.projects} packet />
      </div>
      <div className="rp-paper rp-cover">
        <ReportBrand reportDate={data.report_date} kind="Weekly Project Status" />
        <p className="rp-cover-k">Prepared for</p>
        <h1 className="rp-cover-owner">{data.owner}</h1>
        <p className="rp-cover-n">{n} active {n === 1 ? 'project' : 'projects'}</p>
        {n > 0 ? (
          <ol className="rp-toc">
            {data.projects.map((p) => (
              <li key={p.id}>
                <span className="rp-toc-title">{p.title}</span>
                <span className="rp-toc-meta">{p.current_stage_label || 'No stage set'}</span>
                <ScheduleBadge status={p.schedule_status} />
              </li>
            ))}
          </ol>
        ) : (
          <p className="rp-none">No active projects you can see have this owner. <Link href="/reports" prefetch={false}>Back to weekly reports</Link>.</p>
        )}
      </div>
      {data.projects.map((p) => (
        <div key={p.id} className="rp-paper rp-pagebreak">
          <ReportDoc project={p} reportDate={data.report_date} />
        </div>
      ))}
    </div>
  );
}
