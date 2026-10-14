import Link from 'next/link';
import { FormattedNotes } from '@/app/notes-format';
import { IconAlert } from '@/app/icons';
import { ScheduleBadge, StageStepper } from '@/app/_ui/project-status';
import { fmtHhmm, fmtSubmittalValue, fmtYmd, submittalLabel } from '@/app/_ui/project-format';

// Screen only (inside .rp-screen-only: never printed, never copied): which projects' Status Reports are left out
// because their text predates the reports and nobody has reviewed it for owners yet (status_report_pending).
export function PendingReviewNotice({ projects, packet = false }) {
  const list = (projects || []).filter((p) => p.status_report_pending);
  if (!list.length) return null;
  const where = packet ? 'this packet' : 'this report';
  return (
    <div className="rp-pending" role="note">
      <IconAlert size={15} />
      <div>
        <b>{list.length === 1 ? `A Status Report is left out of ${where} until someone reviews it.` : `${list.length} Status Reports are left out of ${where} until someone reviews them.`}</b>
        {' '}The text was written as internal project notes before weekly reports existed, so it doesn’t go to owners
        yet. Open the project, check the Status Report and click <b>Use in reports</b>.
        <ul className="rp-pending-list">
          {list.map((p) => (
            <li key={p.id}><Link href={`/projects/${p.id}#status-report`} prefetch={false}>{p.title || 'Untitled project'}</Link></li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// One project's status report (design-amendments A6.6), print-optimized (Letter; reports.css). Rendered on the
// server from a lib/queries/reports.js report object ONLY: { title, project_number, owner_company, jurisdiction,
// steps, current_stage_label, schedule_status, status_report, submittals, meetings }. Nothing else is
// report-safe: no tasks, subtasks, task notes, members, project info rows, minutes or who edited what.
// A plain module (no 'use client'): the single report and the owner packet both render it.

export function ReportBrand({ reportDate, kind = 'Project Status Report' }) {
  return (
    <header className="rp-head">
      <div className="rp-brand">
        <span className="rp-mark" aria-hidden="true" />
        <div>
          <div className="rp-co">CAGE Civil Engineering</div>
          <div className="rp-kind">{kind}</div>
        </div>
      </div>
      <div className="rp-date">
        <span>Report date</span>
        <b>{fmtYmd(reportDate, { long: true })}</b>
      </div>
    </header>
  );
}

export default function ReportDoc({ project: p, reportDate, brand = true }) {
  return (
    <article className="rp-doc" data-report-project={p.id}>
      {brand && <ReportBrand reportDate={reportDate} />}
      <h1 className="rp-title">{p.title || 'Untitled project'}</h1>
      <dl className="rp-facts">
        <div><dt>Project no.</dt><dd>{p.project_number || '—'}</dd></div>
        <div><dt>Owner</dt><dd>{p.owner_company || '—'}</dd></div>
        <div><dt>Jurisdiction</dt><dd>{p.jurisdiction || '—'}</dd></div>
        <div><dt>Schedule</dt><dd><ScheduleBadge status={p.schedule_status} /></dd></div>
      </dl>

      <section className="rp-sec rp-stage">
        <h2>Project stage{p.current_stage_label ? <span className="rp-sec-sub">: {p.current_stage_label}</span> : null}</h2>
        {p.steps?.length ? <StageStepper steps={p.steps} full /> : <p className="rp-none">No stages set.</p>}
      </section>

      <section className="rp-sec rp-status">
        <h2>Status Report</h2>
        <FormattedNotes text={p.status_report} empty="No status report this week." linkify />
      </section>

      <section className="rp-sec rp-subs">
        <h2>Submittals</h2>
        {p.submittals?.length ? (
          <table className="rp-table">
            <thead>
              <tr><th scope="col">To</th><th scope="col">Submittal</th><th scope="col">Status</th><th scope="col">Dates</th></tr>
            </thead>
            <tbody>
              {p.submittals.map((s) => (
                <tr key={s.id}>
                  <td data-label="To">{s.agency || '—'}</td>
                  <td data-label="Submittal" className="rp-strong">{s.title || '—'}</td>
                  <td data-label="Status"><span className="sub-chip" style={{ '--sc': s.status_color }}>{s.status_label}</span></td>
                  <td data-label="Dates">
                    {s.dates.length ? (
                      <ul className="rp-dates">
                        {s.dates.map((d) => (
                          <li key={d.key} className={d.key === 'expected_response' ? 'rp-expected' : undefined}>
                            <span>{submittalLabel(d)}:</span> {fmtSubmittalValue(d) || <span className="muted">not set</span>}
                          </li>
                        ))}
                      </ul>
                    ) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="rp-none">No submittals.</p>}
      </section>

      <section className="rp-sec rp-meets">
        <h2>Upcoming meetings</h2>
        {p.meetings?.length ? (
          <table className="rp-table">
            <thead>
              <tr><th scope="col">Date</th><th scope="col">Time</th><th scope="col">What / with whom</th><th scope="col">Where</th></tr>
            </thead>
            <tbody>
              {p.meetings.map((m) => (
                <tr key={m.id}>
                  <td data-label="Date" className="rp-nowrap">{fmtYmd(m.meeting_date, { weekday: true })}</td>
                  <td data-label="Time" className="rp-nowrap">{fmtHhmm(m.meeting_time) || '—'}</td>
                  <td data-label="What / with whom" className="rp-strong">{m.title}</td>
                  <td data-label="Where">{m.location || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="rp-none">No upcoming meetings.</p>}
      </section>

      <footer className="rp-foot">CAGE Civil Engineering · {p.title} · {fmtYmd(reportDate)}</footer>
    </article>
  );
}
