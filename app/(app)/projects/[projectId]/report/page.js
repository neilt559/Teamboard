import * as React from 'react';
import { notFound } from 'next/navigation';
import { requirePageViewer } from '@/lib/viewer';
import { nowFromRequestContext } from '@/lib/clock';
import { loadProjectReport } from '@/lib/queries/reports';
import Crumbs from '@/app/_ui/Crumbs';
import ReportSheet, { PendingReviewNotice } from '../../../reports/_components/ReportDoc';
import ReportActions from '../../../reports/_components/ReportActions';
import ReportReady from '../../../reports/_components/ReportReady';
import { reportSig } from '../../../reports/_components/report-model';

// /projects/[projectId]/report (design-amendments A6.6, A11): the project's status report for its owner, drawn as a
// standard business report (ReportDoc.js; report-sheet.css: portrait Letter, flowing onto more pages if needed; the app's chrome
// hidden in print) with Save as PDF and Copy for email. "Prepared by" in the title block is the viewer.
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
    <div className="rp-page rs-page">
      <div className="rp-screen-only">
        <Crumbs items={[{ label: 'Projects', href: '/projects' }, { label: p.title, href: `/projects/${p.id}` }, { label: 'Status report' }]} />
        <ReportActions reports={[p]} reportDate={data.report_date} preparedBy={data.prepared_by} backHref={`/projects/${p.id}`} backLabel="Back to project" />
        <PendingReviewNotice projects={[p]} />
      </div>
      <div className="rs-set">
        <ReportSheet project={p} reportDate={data.report_date} preparedBy={data.prepared_by} />
      </div>
      <ReportReady key={reportSig([p, data.prepared_by, data.report_date])} />
    </div>
  );
}
