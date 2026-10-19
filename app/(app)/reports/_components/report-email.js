import { parseNotes } from '@/app/notes-parse';
import { scheduleOf } from '@/lib/projects';
import { fmtDay, fmtHhmm, fmtShort } from '@/app/_ui/project-format';
import { sheetName, sheetWeekTitle, itemStatus, subDetail, stageCount, proseRows, nextLine, longDate } from './report-model';

// "Copy for email" (design-amendments A6.6, A15): the report(s) as rich, email-safe HTML laid out like the clean
// letter-style report (ReportDoc.js): the letterhead line with the CAGE logo, the project as a big title, then rows
// split by thin rules with a label column on the left and the content on the right (schedule and stage, the week's
// status, Attention Items with late ones in red, submittals & permits, upcoming meetings), the notes line and the
// footer. Tables and inline styles only, so it pastes into Outlook and Gmail with the formatting; Georgia for the
// body, the system sans for labels. A plain-text version goes on the clipboard too.
// Built ONLY from lib/queries/reports.js report objects (the same ones the page renders), never from anything else on
// the page, so no task, member, info row or minutes text can reach an owner.
//   reportEmail(reports, { reportDate, owner, preparedBy, logoUrl }) -> { html, text }
// logoUrl: the absolute address of the horizontal CAGE logo (a public /_next/static file), or '' for no image.

const INK = '#1F1F21';
const GRAY = '#58585A';
const SOFT = '#707073';
const RULE = '#CFCFD2';
const HAIR = '#E3E3E6';
const RED = '#A63A1F';
const GREEN = '#2E7D32';
const SANS = "Barlow,'Segoe UI',Calibri,Helvetica,Arial,sans-serif";
const SERIF = "Georgia,'Times New Roman',serif";
const LABEL_W = '22%';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const TABLE = 'role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;width:100%;';
const SCHED_COLOR = { ahead: GREEN, behind: RED };

// ---------------------------------------------------------------------------------------------------------- HTML

// One section: a thin ink rule, then a label cell and a content cell.
const row = (label, content, { rule = true, top = 18 } = {}) => `<table ${TABLE}margin-top:${top}px;${rule ? `border-top:1px solid ${INK};` : ''}"><tr>`
  + `<td valign="top" width="${LABEL_W}" style="width:${LABEL_W};padding:${rule ? 12 : 0}px 18px 0 0;font:400 13px/1.4 ${SANS};color:${GRAY};">${label}</td>`
  + `<td valign="top" style="padding:${rule ? 12 : 0}px 0 0;font:400 14px/1.5 ${SERIF};color:${INK};">${content}</td></tr></table>`;
const k = (t) => `<div style="font:500 12px/1.3 ${SANS};color:${GRAY};">${esc(t)}</div>`;
const h2 = (t) => `<div style="font:600 16px/1.25 ${SANS};color:${INK};">${esc(t)}</div>`;
const sub = (t) => `<div style="margin-top:3px;font:400 12px/1.4 ${SANS};color:${GRAY};">${esc(t)}</div>`;
const big = (t, color = INK) => `<div style="margin-top:2px;font:600 20px/1.2 ${SANS};color:${color};">${esc(t)}</div>`;

function letterhead(reportDate, logoUrl) {
  const logo = logoUrl
    ? `<img src="${esc(logoUrl)}" width="140" alt="CAGE Engineering" style="display:block;width:140px;max-width:140px;height:auto;border:0;">`
    : `<b style="font:700 20px/1 ${SANS};color:${GRAY};">CAGE</b>`;
  return `<table ${TABLE}"><tr>`
    + `<td valign="middle" width="${LABEL_W}" style="width:${LABEL_W};padding:0 18px 0 0;">${logo}</td>`
    + `<td valign="middle" style="font:600 14px/1.2 ${SANS};color:${INK};">Project Status Report</td>`
    + `<td valign="middle" align="right" style="text-align:right;font:400 14px/1.2 ${SANS};color:${GRAY};white-space:nowrap;">${esc(longDate(reportDate))}</td></tr></table>`;
}

function titleRow(p) {
  const forLine = [p.owner_company ? `For ${p.owner_company}` : '', p.jurisdiction].filter(Boolean).join(' · ');
  return row(p.project_number ? `No. ${esc(p.project_number)}` : '',
    `<div style="font:700 36px/1.05 ${SANS};letter-spacing:-0.5px;color:${INK};">${esc(sheetName(p))}</div>`
    + (forLine ? `<div style="margin-top:6px;font:400 18px/1.3 ${SERIF};color:${GRAY};">${esc(forLine)}</div>` : ''),
  { rule: false, top: 30 });
}

function summaryRow(p) {
  const s = scheduleOf(p.schedule_status);
  const cur = (p.steps || []).find((x) => x.state === 'current');
  return row(k('Schedule') + big(s ? s.label : 'Not set', s ? SCHED_COLOR[p.schedule_status] || INK : SOFT),
    k(cur ? `Stage ${stageCount(p)}` : 'Stage') + big(cur ? cur.label : 'Not set', cur ? INK : SOFT), { top: 26 });
}

const bulletsHtml = (bullets) => bullets.map((b) => `<div style="margin:0 0 4px ${b.level * 18}px;padding-left:16px;text-indent:-16px;"><span style="color:${SOFT};">&ndash;</span>&nbsp;&nbsp;${esc(b.text)}</div>`).join('');
const rowBody = (r, lede = false) => r.paras.map((t, j) => `<div style="margin:0 0 7px;${lede && j === 0 ? 'font-size:17px;line-height:1.45;' : ''}">${esc(t)}</div>`).join('') + bulletsHtml(r.bullets);

function notesRows(p, by) {
  const rows = proseRows(p.status_body ?? p.status_report);
  const first = rows[0] && !rows[0].head ? rows[0] : null;
  const rest = first ? rows.slice(1) : rows;
  const label = k('Status update') + h2(sheetWeekTitle(p)) + (by?.name ? sub(`Notes from ${by.name}`) : '');
  const body = first ? rowBody(first, true) : rows.length ? '' : `<div style="color:${SOFT};font-style:italic;">No status report this week.</div>`;
  return row(label, body) + rest.map((r) => row(esc(r.head || ''), rowBody(r), { rule: false, top: 8 })).join('');
}

function itemsRow(items, ref) {
  const late = items.filter((a) => a.late).length;
  const list = items.map((a) => `<div style="margin:0 0 9px;">${a.late ? `<span style="color:${RED};">&#9632;</span>&nbsp;` : ''}`
    + `<b>${esc(a.item)}</b>${a.from_party ? ` from ${esc(a.from_party)}` : ''}${a.need_by ? `, needed by ${esc(fmtShort(a.need_by, ref))}.` : `. <span style="color:${SOFT};">No date set yet.</span>`}`
    + `${a.late ? ` <b style="color:${RED};">${esc(itemStatus(a))}</b>` : ''}</div>`).join('');
  return row(h2('Attention Items') + sub(`${items.length} open${late ? `, ${late} late` : ''}`), list);
}

function logRow(subs, ref) {
  if (!subs.length) return row(h2('Submittals & Permits'), `<div style="color:${SOFT};font-style:italic;">No submittals.</div>`);
  const th = (t, w) => `<td width="${w}" style="width:${w};padding:0 8px 6px 0;border-bottom:1px solid ${RULE};font:400 12px/1.3 ${SANS};color:${GRAY};">${esc(t)}</td>`;
  const td = (h, closed, extra = '') => `<td valign="top" style="padding:8px 8px 9px 0;border-bottom:1px solid ${HAIR};font:400 14px/1.35 ${SERIF};color:${closed ? SOFT : INK};${extra}">${h}</td>`;
  const strong = (t, closed) => `<div style="font:${closed ? 400 : 600} 13px/1.35 ${SANS};color:${closed ? SOFT : INK};">${esc(t)}</div>`;
  const table = `<table ${TABLE}"><tr>${th('Ball in court', '12%')}${th('Agency and submittal', '29%')}${th('Where it stands', '27%')}${th('Notes', '32%')}</tr>`
    + subs.map((s) => {
      const c = s.closed;
      const detail = subDetail(s, ref);
      const next = nextLine(s, ref);
      return `<tr>${td(c ? '' : `<span style="font:600 13px/1.35 ${SANS};">${esc(s.ball || '')}</span>`, c)}`
        + `${td(strong(s.agency || 'Agency not set', c) + (s.title ? `<div>${esc(s.title)}</div>` : ''), c)}`
        + `${td(strong(s.status_label, c) + (next && !c ? `<div style="font-style:italic;">${esc(next)}</div>` : '') + (detail ? `<div style="margin-top:2px;font:400 11px/1.35 ${SANS};color:${SOFT};">${esc(detail)}</div>` : ''), c)}`
        + `${td(esc(s.note || ''), c, `font-size:13px;color:${GRAY};`)}</tr>`;
    }).join('') + '</table>';
  return row(h2('Submittals & Permits'), table);
}

function meetingsRow(meetings, ref) {
  const body = meetings.length
    ? `<table ${TABLE}">${meetings.map((m) => `<tr><td valign="top" width="30%" style="width:30%;padding:0 12px 8px 0;font:400 13px/1.4 ${SANS};color:${GRAY};">`
      + `<div style="font-weight:600;color:${INK};">${esc(fmtDay(m.meeting_date, ref))}</div>${m.meeting_time ? esc(fmtHhmm(m.meeting_time)) : ''}</td>`
      + `<td valign="top" style="padding:0 0 8px;font:400 14px/1.4 ${SERIF};color:${INK};">${esc(m.title)}${m.location ? `<div style="font-size:13px;color:${GRAY};">${esc(m.location)}</div>` : ''}</td></tr>`).join('')}</table>`
    : `<div style="color:${SOFT};font-style:italic;">No meetings scheduled.</div>`;
  return row(h2('Upcoming Meetings'), body);
}

function projectHtml(p, i, { reportDate, preparedBy: by, logoUrl }) {
  const items = p.attention || [];
  return `<div style="${i ? `margin:44px 0 0;padding-top:30px;border-top:3px double ${RULE};` : 'margin:0;'}">`
    + letterhead(reportDate, logoUrl) + titleRow(p) + summaryRow(p) + notesRows(p, by)
    + (items.length ? itemsRow(items, reportDate) : '')
    + logRow(p.submittals || [], reportDate) + meetingsRow(p.meetings || [], reportDate)
    + (p.report_note ? `<p style="margin:18px 0 0;padding-top:8px;border-top:1px solid ${HAIR};font:400 12px/1.4 ${SANS};color:#8a8a8d;"><b style="color:${GRAY};">Notes:</b> ${esc(p.report_note)}</p>` : '')
    + (p.report_link ? `<p style="margin:8px 0 0;font:400 13px/1.4 ${SANS};color:${GRAY};">Project documents: <a href="${esc(p.report_link)}" style="color:${INK};font-weight:600;text-decoration:underline;">Open the Egnyte folder</a></p>` : '')
    + `<table ${TABLE}margin-top:24px;border-top:1px solid ${INK};"><tr>`
    + `<td style="padding:8px 0 0;font:400 12px/1.4 ${SANS};color:${GRAY};">${by?.name ? `Prepared by <b style="color:${INK};">${esc(by.name)}</b>${by.position ? `, ${esc(by.position)}` : ''}${by.email ? ` &middot; ${esc(by.email)}` : ''}` : ''}</td>`
    + `<td align="right" style="padding:8px 0 0;font:400 12px/1.4 ${SANS};color:${GRAY};text-align:right;">CAGE Engineering &middot; cagecivil.com</td></tr></table>`
    + '</div>';
}

// ---------------------------------------------------------------------------------------------------------- text

function notesText(text) {
  if (!String(text || '').trim()) return 'No status report this week.';
  const out = [];
  for (const b of parseNotes(text)) {
    if (b.type === 'gap') { if (out.length && out[out.length - 1] !== '') out.push(''); continue; }
    if (b.type === 'title' || b.type === 'header') out.push(b.text);
    else if (b.type === 'bullet') out.push(`${'  '.repeat(b.level)}- ${b.text}`);
    else out.push(b.text);
  }
  while (out.length && out[out.length - 1] === '') out.pop();
  return out.join('\n');
}

function projectText(p, { reportDate, preparedBy: by }) {
  const items = p.attention || [];
  const late = items.filter((a) => a.late).length;
  const meetings = p.meetings || [];
  const subs = p.submittals || [];
  const cur = (p.steps || []).find((s) => s.state === 'current');
  let n = 0;
  const L = ['CAGE ENGINEERING · PROJECT STATUS REPORT', longDate(reportDate), ''];
  L.push(`Project: ${sheetName(p)}${p.project_number ? ` (No. ${p.project_number})` : ''}`);
  L.push(`Owner: ${p.owner_company || '-'} · Jurisdiction: ${p.jurisdiction || '-'}`);
  if (by?.name) L.push(`Prepared by: ${[by.name, by.position].filter(Boolean).join(', ')}`);
  L.push(`Schedule: ${scheduleOf(p.schedule_status)?.label || 'Not set'} · Stage${cur ? ` ${stageCount(p)}: ${cur.label}` : ': not set'}`);
  L.push('', `${++n}. STATUS UPDATE: ${sheetWeekTitle(p)}`, notesText(p.status_body ?? p.status_report));
  if (items.length) {
    L.push('', `${++n}. ATTENTION ITEMS (${items.length} open${late ? `, ${late} late` : ''})`);
    items.forEach((a, i) => {
      L.push(`${i + 1}. ${a.item}`);
      L.push(`   ${[a.from_party, a.need_by ? `needed by ${fmtShort(a.need_by, reportDate)}` : 'no date set', a.late ? itemStatus(a).toUpperCase() : ''].filter(Boolean).join(' · ')}`);
    });
  }
  L.push('', `${++n}. SUBMITTALS & PERMITS${subs.length ? ` (${subs.filter((s) => !s.closed).length} open)` : ''}`);
  if (subs.length) {
    for (const s of subs) {
      L.push(`- ${s.agency || 'Agency not set'}${s.title ? `: ${s.title}` : ''}`);
      const detail = subDetail(s, reportDate);
      const bits = [`${s.status_label}${detail ? ` (${detail})` : ''}`];
      if (s.next) bits.push(`Next: ${fmtShort(s.next, reportDate)}, ${s.next_label}`);
      if (s.ball) bits.push(`Ball in court: ${s.ball}`);
      L.push(`  ${bits.join(' · ')}`);
      if (s.note) L.push(`  Notes: ${s.note}`);
    }
  } else L.push('No submittals.');
  L.push('', `${++n}. UPCOMING MEETINGS`);
  if (meetings.length) {
    for (const m of meetings) {
      const when = [fmtDay(m.meeting_date, reportDate), fmtHhmm(m.meeting_time)].filter(Boolean).join(', ');
      L.push(`- ${when}: ${m.title}${m.location ? ` (${m.location})` : ''}`);
    }
  } else L.push('No meetings scheduled.');
  if (p.report_note) L.push('', `Notes: ${p.report_note}`);
  if (p.report_link) L.push(`Project documents: ${p.report_link}`);
  L.push('', `CAGE Engineering · cagecivil.com${by?.name ? ` · Prepared by ${by.name}${by.email ? ` (${by.email})` : ''}` : ''}`);
  return L.join('\n');
}

export function reportEmail(reports, { reportDate, owner = '', preparedBy = null, logoUrl = '' } = {}) {
  const list = reports || [];
  const ctx = { reportDate, preparedBy, logoUrl };
  const intro = owner
    ? `<p style="margin:0 0 26px;font:400 15px/1.4 ${SERIF};color:${GRAY};">Weekly status for <b style="color:${INK};">${esc(owner)}</b>: ${esc(plural(list.length, 'active project'))}.</p>`
    : '';
  const html = `<div style="font-family:${SERIF};font-size:14px;line-height:1.5;color:${INK};max-width:760px;">`
    + intro + list.map((p, i) => projectHtml(p, i, ctx)).join('') + '</div>';
  const top = owner ? [`Weekly status for ${owner}: ${plural(list.length, 'active project')}.`, '', ''] : [];
  const text = [...top, list.map((p) => projectText(p, ctx)).join('\n\n\n')].join('\n');
  return { html, text };
}
