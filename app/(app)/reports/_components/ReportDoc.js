import Link from 'next/link';
import { IconAlert } from '@/app/icons';
import { parseNotes } from '@/app/notes-parse';
import { fmtHhmm, fmtShort, fmtYmd, fmtDay } from '@/app/_ui/project-format';
import { scheduleOf } from '@/lib/projects';
import logo from '@/public/brand/cage-logo-horizontal.png';
import { sheetName, sheetWeekTitle, itemStatus, subDetail, stageCount } from './report-model';

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

// One project's owner report as a standard business report (Neil's boss, 2026-10-19: "more normal report like";
// replaces the A11/A13 plan-sheet): portrait Letter, the CAGE letterhead, a project information box, the schedule
// and stage, then numbered sections (Status update, Attention items, Submittals & permits, Upcoming meetings) with
// plain tables, and a footer. It flows onto a second page when the content needs it; table headers repeat and rows
// don't split. Late attention items are red. Copy for email (report-email.js) mirrors this layout.
// Rendered on the server from a lib/queries/reports.js report object ONLY, so nothing internal can reach it: never
// tasks, subtasks, task notes, members, project info rows, minutes or who edited what.

function Prose({ text }) {
  const blocks = parseNotes(text).filter((b) => b.type !== 'gap');
  if (!blocks.length) return <p className="sr-none">No status report this week.</p>;
  const out = [];
  let list = null;
  blocks.forEach((b, i) => {
    if (b.type === 'bullet') {
      if (!list) { list = []; out.push({ list }); }
      list.push(b);
      return;
    }
    list = null;
    out.push({ b, i });
  });
  return (
    <div className="sr-prose rs-prose">
      {out.map((x, k) => (x.list
        ? <ul key={k}>{x.list.map((b, j) => <li key={j} className={b.level ? `lv${Math.min(b.level, 3)}` : undefined}>{b.text}</li>)}</ul>
        : x.b.type === 'title' || x.b.type === 'header'
          ? <h4 key={k}>{x.b.text}</h4>
          : <p key={k}>{x.b.text}</p>))}
    </div>
  );
}

function Section({ n, title, sub, children, className = '' }) {
  return (
    <section className={`sr-sec ${className}`} aria-label={title}>
      <h2 className="sr-h2"><span className="sr-n">{n}</span>{title}{sub ? <span className="sr-sub">{sub}</span> : null}</h2>
      {children}
    </section>
  );
}

function Stages({ steps }) {
  if (!steps?.length) return <span className="sr-none">No stages set</span>;
  return (
    <ol className="sr-stages" aria-label="Project stages">
      {steps.map((s) => (
        <li key={s.key} className={`sr-stage rs-seg${s.state === 'done' ? ' done' : s.state === 'current' ? ' now' : ''}`} aria-current={s.state === 'current' ? 'step' : undefined}>
          <span className="sr-dot" aria-hidden="true" />
          <span className="sr-stage-name">{s.label}</span>
          <span className="sr-vh">{s.state === 'done' ? ' (complete)' : s.state === 'current' ? ' (current stage)' : ''}</span>
        </li>
      ))}
    </ol>
  );
}

export default function ReportSheet({ project: p, reportDate, preparedBy: by }) {
  const items = p.attention || [];
  const late = items.filter((a) => a.late).length;
  const meetings = p.meetings || [];
  const subs = p.submittals || [];
  const sched = scheduleOf(p.schedule_status);
  const cur = (p.steps || []).find((s) => s.state === 'current');
  let n = 0;
  return (
    <article className="sr-doc rs-proj" data-report-project={p.id}>
      <header className="sr-head">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="sr-logo" src={logo.src} width={logo.width} height={logo.height} alt="CAGE Civil Engineering" />
        <div className="sr-head-r">
          <h1 className="sr-h1">Project Status Report</h1>
          <p className="sr-date">{fmtYmd(reportDate, { long: true })}</p>
        </div>
      </header>

      <table className="sr-info">
        <tbody>
          <tr>
            <th scope="row">Project</th><td className="sr-proj-name">{sheetName(p)}</td>
            <th scope="row">Project No.</th><td>{p.project_number || '–'}</td>
          </tr>
          <tr>
            <th scope="row">Owner</th><td>{p.owner_company || '–'}</td>
            <th scope="row">Jurisdiction</th><td>{p.jurisdiction || '–'}</td>
          </tr>
          <tr>
            <th scope="row">Prepared by</th>
            <td>{by?.name || ''}{by?.position ? <span className="sr-muted">, {by.position}</span> : null}</td>
            <th scope="row">Report date</th><td>{fmtYmd(reportDate, { long: true })}</td>
          </tr>
        </tbody>
      </table>

      <div className="sr-summary">
        <div className="sr-sum-cell">
          <span className="sr-k">Schedule</span>
          <span className={`sr-pill sr-pill-${p.schedule_status || 'none'}`}>{sched ? sched.label : 'Not set'}</span>
        </div>
        <div className="sr-sum-cell">
          <span className="sr-k">Current stage</span>
          <span className="sr-v">{cur ? `${cur.label} (${stageCount(p)})` : 'Not set'}</span>
        </div>
        <div className="sr-sum-cell">
          <span className="sr-k">Open items</span>
          <span className="sr-v">{items.length}{late ? <b className="sr-late-t"> · {late} late</b> : null}</span>
        </div>
        <div className="sr-sum-stages"><Stages steps={p.steps} /></div>
      </div>

      <Section n={++n} title="Status Update" sub={sheetWeekTitle(p)} className="sr-notes">
        <Prose text={p.status_body ?? p.status_report} />
      </Section>

      {items.length > 0 && (
        <Section n={++n} title="Attention Items" sub={`${items.length} open${late ? `, ${late} late` : ''}`} className="rs-items">
          <table className="sr-table">
            <colgroup><col style={{ width: '4%' }} /><col style={{ width: '46%' }} /><col style={{ width: '22%' }} /><col style={{ width: '13%' }} /><col style={{ width: '15%' }} /></colgroup>
            <thead><tr><th scope="col">#</th><th scope="col">Item needed</th><th scope="col">From</th><th scope="col">Needed by</th><th scope="col">Status</th></tr></thead>
            <tbody>
              {items.map((a, i) => (
                <tr key={a.id} className={`rs-item${a.late ? ' late' : ''}`}>
                  <td className="sr-num">{i + 1}</td>
                  <td className="sr-strong">{a.item}</td>
                  <td>{a.from_party || '–'}</td>
                  <td className="sr-nowrap">{a.need_by ? fmtShort(a.need_by, reportDate) : '–'}</td>
                  <td className={a.late ? 'sr-late-t' : 'sr-muted'}>{itemStatus(a)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      <Section n={++n} title="Submittals & Permits" sub={subs.length ? `${subs.filter((s) => !s.closed).length} open` : ''} className="rs-log">
        {subs.length ? (
          <table className="sr-table">
            <colgroup><col style={{ width: '30%' }} /><col style={{ width: '20%' }} /><col style={{ width: '16%' }} /><col style={{ width: '12%' }} /><col style={{ width: '22%' }} /></colgroup>
            <thead><tr><th scope="col">Agency / submittal</th><th scope="col">Status</th><th scope="col">Next date</th><th scope="col">Ball in court</th><th scope="col">Notes</th></tr></thead>
            <tbody>
              {subs.map((s) => {
                const detail = subDetail(s, reportDate);
                return (
                  <tr key={s.id} className={s.closed ? 'sr-closed' : undefined}>
                    <td><span className="sr-strong">{s.agency || 'Agency not set'}</span>{s.title ? <span className="sr-line2">{s.title}</span> : null}</td>
                    <td><span className="sr-strong">{s.status_label}</span>{detail ? <span className="sr-line2">{detail}</span> : null}</td>
                    <td className="sr-nowrap">{s.next ? <><span className="sr-strong">{fmtShort(s.next, reportDate)}</span><span className="sr-line2">{s.next_label}</span></> : '–'}</td>
                    <td>{s.ball || '–'}</td>
                    <td className="note">{s.note || ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : <p className="sr-none">No submittals.</p>}
      </Section>

      <Section n={++n} title="Upcoming Meetings" className="rs-meet">
        {meetings.length ? (
          <table className="sr-table">
            <colgroup><col style={{ width: '20%' }} /><col style={{ width: '14%' }} /><col style={{ width: '40%' }} /><col style={{ width: '26%' }} /></colgroup>
            <thead><tr><th scope="col">Date</th><th scope="col">Time</th><th scope="col">Meeting</th><th scope="col">Location</th></tr></thead>
            <tbody>
              {meetings.map((m) => (
                <tr key={m.id}>
                  <td className="sr-nowrap sr-strong">{fmtDay(m.meeting_date, reportDate)}</td>
                  <td className="sr-nowrap">{m.meeting_time ? fmtHhmm(m.meeting_time) : '–'}</td>
                  <td>{m.title}</td>
                  <td>{m.location || '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="sr-none">No meetings scheduled.</p>}
      </Section>

      {/* Neil 2026-10-16: a small gray "Notes: ..." line, no header. */}
      {p.report_note ? <p className="rs-foot-note"><b>Notes:</b> {p.report_note}</p> : null}
      {p.report_link && (
        <p className="sr-docs rs-docs">Project documents: <a href={p.report_link} target="_blank" rel="noopener noreferrer">Open the Egnyte folder</a></p>
      )}

      <footer className="sr-foot">
        <span><b>CAGE Civil Engineering</b> · cagecivil.com</span>
        <span>{by?.name ? `Prepared by ${by.name}${by.email ? ` · ${by.email}` : ''}` : ''}</span>
      </footer>
    </article>
  );
}
