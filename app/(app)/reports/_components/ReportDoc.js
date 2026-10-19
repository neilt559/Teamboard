import Link from 'next/link';
import { IconAlert } from '@/app/icons';
import { fmtHhmm, fmtShort, fmtDay } from '@/app/_ui/project-format';
import { scheduleOf } from '@/lib/projects';
import logo from '@/public/brand/cage-logo-horizontal.png';
import { sheetName, sheetWeekTitle, itemStatus, subDetail, stageCount, proseRows, nextLine, longDate } from './report-model';

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

// One project's owner report as a clean letter-style report (Neil, 2026-10-19: his boss wanted a normal report; Neil
// wanted it "cleaner, less boxy, like this older mockup", and only the current stage, no stage bar). Portrait Letter,
// no boxes: the letterhead line (logo, "Project Status Report", date), the project as a big title with owner and
// jurisdiction under it, then rows split by thin rules, each with a label column on the left and the content on the
// right: schedule and stage; the week's status (its own headers become left labels); Attention Items (late ones
// marked in red); submittals & permits; upcoming meetings; then the notes line and the footer. Body text is a serif
// (Georgia), labels Barlow. It flows onto another page when it needs to. Copy for email (report-email.js) mirrors it.
// Rendered on the server from a lib/queries/reports.js report object ONLY, so nothing internal can reach it: never
// tasks, subtasks, task notes, members, project info rows, minutes or who edited what.

function Bullets({ items }) {
  return <ul>{items.map((b, i) => <li key={i} className={b.level ? `lv${Math.min(b.level, 3)}` : undefined}>{b.text}</li>)}</ul>;
}

function ProseBody({ row, lede = false }) {
  return (
    <>
      {row.paras.map((t, j) => <p key={j} className={lede && j === 0 ? 'sr-lede' : undefined}>{t}</p>)}
      {row.bullets.length > 0 && <Bullets items={row.bullets} />}
    </>
  );
}

export default function ReportSheet({ project: p, reportDate, preparedBy: by }) {
  const items = p.attention || [];
  const late = items.filter((a) => a.late).length;
  const meetings = p.meetings || [];
  const subs = p.submittals || [];
  const sched = scheduleOf(p.schedule_status);
  const cur = (p.steps || []).find((s) => s.state === 'current');
  const rows = proseRows(p.status_body ?? p.status_report);
  const first = rows[0] && !rows[0].head ? rows[0] : null;     // text before the first header sits beside the week
  const rest = first ? rows.slice(1) : rows;
  return (
    <article className="sr-doc rs-proj" data-report-project={p.id}>
      <header className="sr-head">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="sr-logo" src={logo.src} width={logo.width} height={logo.height} alt="CAGE Engineering" />
        <p className="sr-kind">Project Status Report</p>
        <p className="sr-date">{longDate(reportDate)}</p>
      </header>

      <div className="sr-title sr-row">
        <p className="sr-l sr-no">{p.project_number ? `No. ${p.project_number}` : ''}</p>
        <div className="sr-r">
          <h1 className="sr-h1">{sheetName(p)}</h1>
          <p className="sr-for">{[p.owner_company ? `For ${p.owner_company}` : '', p.jurisdiction].filter(Boolean).join(' · ')}</p>
        </div>
      </div>

      <section className="sr-sec sr-row sr-summary" aria-label="Schedule and stage">
        <div className="sr-l">
          <p className="sr-k">Schedule</p>
          <p className={`sr-big sr-sched sr-sched-${p.schedule_status || 'none'}`}>{sched ? sched.label : 'Not set'}</p>
        </div>
        <div className="sr-r">
          <p className="sr-k">{cur ? `Stage ${stageCount(p)}` : 'Stage'}</p>
          <p className="sr-big sr-stage">{cur ? cur.label : 'Not set'}</p>
        </div>
      </section>

      <section className="sr-sec sr-notes rs-notes" aria-label="Status update">
        <div className="sr-row">
          <div className="sr-l">
            <p className="sr-k">Status update</p>
            <h2>{sheetWeekTitle(p)}</h2>
            {by?.name ? <p className="sr-sub">Notes from {by.name}</p> : null}
          </div>
          <div className="sr-r rs-prose">
            {first ? <ProseBody row={first} lede /> : rows.length ? null : <p className="sr-none">No status report this week.</p>}
          </div>
        </div>
        {rest.map((r, i) => (
          <div key={i} className="sr-row sr-prose-row">
            <div className="sr-l sr-prose-h">{r.head || ''}</div>
            <div className="sr-r rs-prose"><ProseBody row={r} /></div>
          </div>
        ))}
      </section>

      {items.length > 0 && (
        <section className="sr-sec sr-row rs-items" aria-label="Attention Items">
          <div className="sr-l">
            <h2>Attention Items</h2>
            <p className="sr-sub">{`${items.length} open${late ? `, ${late} late` : ''}`}</p>
          </div>
          <ol className="sr-r sr-items">
            {items.map((a) => (
              <li key={a.id} className={`rs-item${a.late ? ' late' : ''}`}>
                <b>{a.item}</b>
                {a.from_party ? ` from ${a.from_party}` : ''}
                {a.need_by ? `, needed by ${fmtShort(a.need_by, reportDate)}.` : '.'}
                {a.need_by ? null : <span className="sr-muted"> No date set yet.</span>}
                {a.late ? <span className="sr-late">{` ${itemStatus(a)}`}</span> : null}
              </li>
            ))}
          </ol>
        </section>
      )}

      <section className="sr-sec sr-row rs-log" aria-label="Submittals and permits">
        <div className="sr-l">
          <h2>Submittals &amp; Permits</h2>
        </div>
        <div className="sr-r">
          {subs.length ? (
            <table className="sr-table">
              <colgroup><col style={{ width: '12%' }} /><col style={{ width: '29%' }} /><col style={{ width: '27%' }} /><col style={{ width: '32%' }} /></colgroup>
              <thead><tr><th scope="col">Ball in court</th><th scope="col">Agency and submittal</th><th scope="col">Where it stands</th><th scope="col">Notes</th></tr></thead>
              <tbody>
                {subs.map((s) => {
                  const detail = subDetail(s, reportDate);
                  const next = nextLine(s, reportDate);
                  return (
                    <tr key={s.id} className={s.closed ? 'sr-closed' : undefined}>
                      <td className="sr-with">{s.closed ? '' : s.ball || ''}</td>
                      <td><span className="sr-strong">{s.agency || 'Agency not set'}</span>{s.title ? <span className="sr-serif">{s.title}</span> : null}</td>
                      <td>
                        <span className="sr-strong">{s.status_label}</span>
                        {next ? <span className="sr-next">{next}</span> : null}
                        {detail ? <span className="sr-line2">{detail}</span> : null}
                      </td>
                      <td className="note">{s.note || ''}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : <p className="sr-none">No submittals.</p>}
        </div>
      </section>

      <section className="sr-sec sr-row rs-meet" aria-label="Upcoming Meetings">
        <div className="sr-l"><h2>Upcoming Meetings</h2></div>
        <div className="sr-r">
          {meetings.length ? (
            <ul className="sr-meets">
              {meetings.map((m) => (
                <li key={m.id}>
                  <span className="sr-when"><b>{fmtDay(m.meeting_date, reportDate)}</b>{m.meeting_time ? <span>{fmtHhmm(m.meeting_time)}</span> : null}</span>
                  <span className="sr-what">{m.title}{m.location ? <span className="sr-where">{m.location}</span> : null}</span>
                </li>
              ))}
            </ul>
          ) : <p className="sr-none">No meetings scheduled.</p>}
        </div>
      </section>

      {/* Neil 2026-10-16: a small gray "Notes: ..." line, no header. */}
      {p.report_note ? <p className="rs-foot-note"><b>Notes:</b> {p.report_note}</p> : null}
      {p.report_link && (
        <p className="sr-docs rs-docs">Project documents: <a href={p.report_link} target="_blank" rel="noopener noreferrer">Open the Egnyte folder</a></p>
      )}

      <footer className="sr-foot">
        <span>{by?.name ? <>Prepared by <b>{by.name}</b>{by.position ? `, ${by.position}` : ''}{by.email ? ` · ${by.email}` : ''}</> : null}</span>
        <span>CAGE Engineering · cagecivil.com</span>
      </footer>
    </article>
  );
}
