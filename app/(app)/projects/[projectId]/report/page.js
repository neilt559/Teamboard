import * as React from 'react';
import { notFound } from 'next/navigation';
import { requirePageViewer } from '@/lib/viewer';
import { nowFromRequestContext } from '@/lib/clock';
import { loadProjectReport } from '@/lib/queries/reports';
import Crumbs from '@/app/_ui/Crumbs';
import ReportDoc, { PendingReviewNotice } from '../../../reports/_components/ReportDoc';
import ReportActions from '../../../reports/_components/ReportActions';

// /projects/[projectId]/report (design-amendments A6.6): the project's status report for its owner, a CAGE-branded,
// print-optimized page (reports.css: Letter, the app's chrome hidden in print) with Save as PDF and Copy for email.
// Same visibility as the project (tb_can_see_project in the loader): anything else is the same 404 as a missing
// project. Built only from lib/queries/reports.js loadProjectReport (report-safe columns): never tasks,
// subtasks, task notes, members, project info rows or minutes. The report date is today in Central (the test
// clock applies locally).
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const maxDuration = 60;

const ID = /^[0-9]{1,18}$/;
const cache = typeof React.cache === 'function' ? React.cache : (fn) => fn;
// One "now" per request, so the metadata and the page share the loader's cached read.
const requestNow = cache(() => nowFromRequestContext());

export async function generateMetadata({ params }) {
  const viewer = await requirePageViewer();
  const data = ID.test(String(params.projectId)) ? await loadProjectReport(viewer, String(params.projectId), requestNow()) : null;
  if (!data) notFound();
  return { title: `Status report · ${data.project.title}` };
}

export default async function ProjectReportPage({ params }) {
  const viewer = await requirePageViewer();
  if (!ID.test(String(params.projectId))) notFound();
  const data = await loadProjectReport(viewer, String(params.projectId), requestNow());
  if (!data) notFound();
  const p = data.project;
  return (
    <div className="rp-page">
      <div className="rp-screen-only">
        <Crumbs items={[{ label: 'Projects', href: '/projects' }, { label: p.title, href: `/projects/${p.id}` }, { label: 'Status report' }]} />
        <ReportActions reports={[p]} reportDate={data.report_date} backHref={`/projects/${p.id}`} backLabel="Back to project" />
        <PendingReviewNotice projects={[p]} />
      </div>
      <div className="rp-paper">
        <ReportDoc project={p} reportDate={data.report_date} />
      </div>
    </div>
  );
}
