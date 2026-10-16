import Link from 'next/link';
import { IconAlert } from '@/app/icons';
import { parseNotes } from '@/app/notes-parse';
import { fmtDay, fmtDayYear, fmtHhmm, fmtIssued, fmtShort } from '@/app/_ui/project-format';
import logo from '@/public/brand/cage-logo-stacked.png';
import { CLOUD_PAD_X, CLOUD_PAD_Y, CLOUD_STROKE, cloudBox, cloudPath } from './cloud';
import { sheetName, sheetWeekTitle } from './report-model';

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

// One project's owner report drawn as a sheet from a CAGE plan set, in landscape (Neil's mockup, 2026-10-16: "Status
// Report Template.pdf"): a bordered Letter sheet turned sideways with the title block as a strip down the right edge
// (the stacked logo and the website, the project turned to read up the sheet with its number, owner, jurisdiction and issue date, prepared
// by, sheet 1 of 1). The field: the masthead; two columns (the week's Status Report with the meetings ahead under it;
// the ONE "Attention Items" list with the schedule under it: "Status: Ahead | On Track | Behind" and the stage line);
// the submittal & permit log across the foot. No abbreviations block and no legend.
// Rendered on the server from a lib/queries/reports.js report object ONLY, so nothing internal can reach it: never
// tasks, subtasks, task notes, members, project info rows, minutes or who edited what.
// ALWAYS one page: the fit pass (SheetFit.js + sheet-fit.js) copies the sheet into the empty .rs-out next to it and
// finds the largest type scale (--k) at which everything fits, so a light week reads large and a heavy week shrinks to
// fit. The title block is its own column of the sheet, so content can never print over it.

const nb = (s) => String(s ?? '').replace(/ /g, ' ');

// The Status Report as the sheet's prose: paragraphs, and each header with the bullets under it as one block (blocks
// keep their header and bullets together).
function proseBlocks(text) {
  const out = [];
  let group = null;
  let list = null;
  const flush = () => { group = null; list = null; };
  for (const b of parseNotes(text)) {
    if (b.type === 'gap') { if (!group) list = null; continue; }
    if (b.type === 'title' || b.type === 'header') {
      flush();
      group = { kind: 'group', head: b.text, items: [] };
      out.push(group);
      continue;
    }
    if (b.type === 'bullet') {
      if (group) { group.items.push(b); continue; }
      if (!list) { list = { kind: 'list', items: [] }; out.push(list); }
      list.items.push(b);
      continue;
    }
    flush();
    out.push({ kind: 'p', text: b.text });
  }
  return out;
}

function Bullets({ items }) {
  return (
    <ul>
      {items.map((b, i) => <li key={i} className={b.level ? `lv${Math.min(b.level, 3)}` : undefined}>{b.text}</li>)}
    </ul>
  );
}

function Prose({ text }) {
  const blocks = proseBlocks(text);
  if (!blocks.length) return <div className="rs-prose"><p className="rs-blk rs-none">No status report this week.</p></div>;
  return (
    <div className="rs-prose">
      {blocks.map((b, i) => {
        if (b.kind === 'p') return <p key={i} className="rs-blk">{b.text}</p>;
        if (b.kind === 'list') return <div key={i} className="rs-blk rs-grp"><Bullets items={b.items} /></div>;
        return (
          <div key={i} className="rs-blk rs-grp">
            <h3>{b.head}</h3>
            {b.items.length > 0 && <Bullets items={b.items} />}
          </div>
        );
      })}
    </div>
  );
}

const SCHED = [['ahead', 'Ahead'], ['on_track', 'On Track'], ['behind', 'Behind']];

// The schedule (Neil's mockup): "Status: Ahead | On Track | Behind" with the current one boxed, then the stage line.
function Schedule({ status, steps }) {
  return (
    <section className="rs-sched" aria-label="Schedule">
      <div className="rs-vt"><h2>Schedule</h2></div>
      <p className="rs-status">
        <span className="rs-status-k">Status:</span>
        {SCHED.map(([k, label], i) => (
          <span key={k} className="rs-status-w">
            {i > 0 && <i aria-hidden="true">|</i>}
            <span className={`rs-st${status === k ? ' on' : ''}${k === 'behind' ? ' behind' : ''}`}>
              {label}{status === k ? <span className="rs-vh"> (current)</span> : null}
            </span>
          </span>
        ))}
      </p>
      <Stages steps={steps} />
    </section>
  );
}

function Stages({ steps }) {
  if (!steps?.length) return <p className="rs-stages-k">Stage not set</p>;
  return (
    <ol className="rs-line" style={{ '--n': steps.length }} aria-label="Project stages">
      {steps.map((s, i) => (
        <li key={s.key} className={`rs-seg${s.state === 'done' ? ' done' : s.state === 'current' ? ' now' : ''}`} aria-current={s.state === 'current' ? 'step' : undefined}>
          <span className="rs-seg-name">
            {s.label}
            <span className="rs-vh">{s.state === 'done' ? ' (complete)' : s.state === 'current' ? ' (current stage)' : ''}</span>
          </span>
          {i === steps.length - 1 && <span className="rs-end" />}
        </li>
      ))}
    </ol>
  );
}

function Cloud({ item, who }) {
  const { W, H } = cloudBox(item, who);
  return (
    <svg className="rs-cloud" aria-hidden="true" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none"
      style={{ inset: `-${CLOUD_PAD_Y}px -${CLOUD_PAD_X}px` }}>
      <path d={cloudPath(W, H)} fill="none" stroke={CLOUD_STROKE} strokeWidth="1.3" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Attention({ items, reportDate }) {
  const late = items.filter((a) => a.late).length;
  return (
    <section className="rs-items" aria-label="Attention Items">
      <div className="rs-vt"><h2>Attention Items</h2><p>{`${items.length} open${late ? `, ${late} late` : ''}`}</p></div>
      <ol className="rs-list">
        {items.map((a) => {
          const due = a.need_by ? `need by ${fmtShort(a.need_by, reportDate)}` : 'no date set';
          const lateText = a.late ? `${a.days_late} ${a.days_late === 1 ? 'day' : 'days'} late` : '';
          return (
            <li key={a.id} className={`rs-item${a.late ? ' late' : ''}`}>
              <span className="rs-item-what">{a.item}</span>
              <span className="rs-item-who">
                {a.from_party ? <>{a.from_party}<i>·</i></> : null}
                <span className="rs-nb">{nb(due)}</span>
                {lateText && <><i>·</i><span className="rs-late-note">{lateText}</span></>}
              </span>
              {a.late && <Cloud item={a.item} who={`${a.from_party} · ${due} · ${lateText}`} />}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function Meetings({ meetings, reportDate }) {
  return (
    <section className="rs-meet" aria-label="Meetings ahead">
      <div className="rs-vt"><h2>Meetings ahead</h2>{meetings.length > 0 && <p>{`Next ${meetings.length}`}</p>}</div>
      {meetings.length ? (
        <ul className="rs-mtgs">
          {meetings.map((m) => (
            <li key={m.id} className="rs-mtg">
              <p className="rs-mtg-when">{fmtDay(m.meeting_date, reportDate)}{m.meeting_time ? <span>{nb(fmtHhmm(m.meeting_time))}</span> : null}</p>
              <p className="rs-mtg-what">{m.title}{m.location ? <span className="rs-mtg-where">{m.location}</span> : null}</p>
            </li>
          ))}
        </ul>
      ) : <p className="rs-none rs-pad">No meetings scheduled.</p>}
    </section>
  );
}

function statusDetail(s, reportDate) {
  const d = s.detail;
  if (!d) return '';
  if (s.closed) return d.date ? fmtShort(d.date, reportDate) : '';
  const bits = [];
  if (d.date) bits.push(`${d.label} ${fmtShort(d.date, reportDate)}`);
  if (d.days) bits.push(`${d.days}-day review`);
  return bits.map(nb).join(', ');            // each part stays whole; a line may break after the comma
}

function Log({ subs, reportDate }) {
  const open = subs.filter((s) => !s.closed).length;
  return (
    <section className="rs-log" aria-label="Submittal and permit log">
      <div className="rs-vt"><h2>Submittal &amp; permit log</h2>{subs.length > 0 && <p>{`${open} open, by next date${subs.length > open ? '; closed last' : ''}`}</p>}</div>
      {subs.length ? (
        <table>
          <colgroup><col style={{ width: '33%' }} /><col style={{ width: '17.5%' }} /><col style={{ width: '16.5%' }} /><col style={{ width: '11%' }} /><col style={{ width: '22%' }} /></colgroup>
          <thead><tr><th scope="col">Agency and submittal</th><th scope="col">Status</th><th scope="col">Next date</th><th scope="col">Ball in court</th><th scope="col">Notes</th></tr></thead>
          <tbody>
            {subs.map((s) => {
              const detail = statusDetail(s, reportDate);
              return (
                <tr key={s.id} className={s.closed ? 'closed' : undefined}>
                  <td className="ag"><b>{s.agency || 'Agency not set'}</b>{s.title ? <span>{s.title}</span> : null}</td>
                  <td className="st"><b>{s.status_label}</b>{detail ? <span>{detail}</span> : null}</td>
                  {s.next
                    ? <td className="next"><b>{fmtShort(s.next, reportDate)}</b><span>{s.next_label}</span></td>
                    : <td className="next rs-empty"><span className="rs-dash">{s.closed ? '–' : 'not set'}</span></td>}
                  {s.ball ? <td className="bic">{s.ball}</td> : <td className="bic rs-empty"><span className="rs-dash">–</span></td>}
                  <td className={`note${s.note ? '' : ' rs-empty'}`}>{s.note}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : <p className="rs-none rs-pad">No submittals.</p>}
    </section>
  );
}

// The title block: a strip down the right edge (fixed furniture: it never scales with the content). The project
// part is turned to read up the sheet, the way a plan set's title block does.
export function TitleBlock({ p, reportDate, by }) {
  return (
    <footer className="rs-tb">
      <div className="rs-tb-firm">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logo.src} width={logo.width} height={logo.height} alt="CAGE Civil Engineering" />
        <p className="rs-tb-web">cagecivil.com</p>
      </div>
      <div className="rs-tb-proj">
        <div className="rs-tb-name">
          <span className="rs-k">Project</span>
          <p className="rs-name"><span className="rs-name-t">{sheetName(p)}</span></p>
          {p.project_number ? <p className="rs-no">Project No. <b>{p.project_number}</b></p> : null}
        </div>
        <div className="rs-tb-row">
          <div><span className="rs-k">Owner</span><p className="rs-v">{p.owner_company || '–'}</p></div>
          <div><span className="rs-k">Jurisdiction</span><p className="rs-v">{p.jurisdiction || '–'}</p></div>
          <div><span className="rs-k">Issued</span><p className="rs-v">{fmtIssued(reportDate)}</p></div>
        </div>
      </div>
      <div className="rs-tb-by"><span className="rs-k">Prepared by</span>
        <p className="rs-v">{by?.name || ''}{by?.position ? <span>{by.position}</span> : null}{by?.email ? <span>{by.email}</span> : null}</p>
      </div>
      <div className="rs-tb-sheet"><span className="rs-k">Sheet</span><p className="rs-tb-title">Status report</p>
        <p className="rs-n"><span className="rs-num">1</span><span className="rs-of">of 1</span></p>
      </div>
    </footer>
  );
}

export default function ReportSheet({ project: p, reportDate, preparedBy }) {
  const items = p.attention || [];
  const meetings = p.meetings || [];
  return (
    <div className="rs-proj" data-report-project={p.id}>
      <div className="rs-src">
        <div className="rs-pack" data-fit="1">
          <section className="rs-sheet" aria-label="Sheet 1 of 1">
            <div className="rs-frame">
              <div className="rs-field">
                <header className="rs-mast">
                  <h1 className="rs-h1">Project status report</h1>
                  <p className="rs-meta"><b>{sheetName(p)}</b><i>·</i>{fmtDayYear(reportDate)}</p>
                  {p.report_link && (
                    <p className="rs-docs">Project documents: <a href={p.report_link} target="_blank" rel="noopener noreferrer">Open the Egnyte folder</a></p>
                  )}
                </header>
                <div className="rs-sp rs-sp-a" />
                <div className="rs-cols">
                  <div className="rs-col rs-col-l">
                    <section className="rs-notes" aria-label="Status report">
                      <div className="rs-vt"><h2>{sheetWeekTitle(p)}</h2></div>
                      <Prose text={p.status_body ?? p.status_report} />
                    </section>
                    <Meetings meetings={meetings} reportDate={reportDate} />
                  </div>
                  <div className="rs-col rs-col-r">
                    {items.length > 0 && <Attention items={items} reportDate={reportDate} />}
                    <Schedule status={p.schedule_status} steps={p.steps} />
                  </div>
                </div>
                <div className="rs-sp rs-sp-c" />
                <Log subs={p.submittals || []} reportDate={reportDate} />
                {/* Neil 2026-10-16: a small gray "Notes: ..." line across the foot, no header. */}
                {p.report_note ? <p className="rs-foot-note"><b>Notes:</b> {p.report_note}</p> : null}
              </div>
              <TitleBlock p={p} reportDate={reportDate} by={preparedBy} />
            </div>
          </section>
        </div>
      </div>
      <div className="rs-out" />
    </div>
  );
}
