import { parseNotes } from '@/app/notes-parse';
import { scheduleOf } from '@/lib/projects';
import { fmtDay, fmtHhmm, fmtShort, fmtYmd } from '@/app/_ui/project-format';
import { sheetName, sheetWeekTitle, itemStatus, subDetail, stageCount } from './report-model';

// "Copy for email" (design-amendments A6.6, A15): the report(s) as rich, email-safe HTML laid out like the standard
// report (ReportDoc.js): the CAGE letterhead with the logo, the project information box, the schedule summary and
// stage track, numbered sections with shaded tables, red late items, and the footer. Tables and inline styles only,
// so it pastes into Outlook and Gmail with the formatting; a plain-text version goes on the clipboard too.
// Built ONLY from lib/queries/reports.js report objects (the same ones the page renders), never from anything else on
// the page, so no task, member, info row or minutes text can reach an owner.
//   reportEmail(reports, { reportDate, owner, preparedBy, logoUrl }) -> { html, text }
// logoUrl: the absolute address of the horizontal CAGE logo (a public /_next/static file), or '' for no image.

const INK = '#1F1F21';
const GRAY = '#58585A';
const SOFT = '#6C6C6F';
const RULE = '#D4D4D7';
const BAND = '#F3F3F5';
const LIME = '#C2D02E';
const GREEN = '#2E7D32';
const RED = '#B42318';
const RED_SOFT = '#FDECEA';
const FONT = "Barlow,'Segoe UI',Calibri,Helvetica,Arial,sans-serif";
const COND = "'Barlow Condensed','Arial Narrow',Arial,sans-serif";

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const TABLE = 'role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;width:100%;';
const PILL = { ahead: [GREEN, '#ffffff'], on_track: [LIME, INK], behind: [RED, '#ffffff'] };

// ---------------------------------------------------------------------------------------------------------- HTML

function letterhead(reportDate, logoUrl) {
  const logo = logoUrl
    ? `<img src="${esc(logoUrl)}" width="200" alt="CAGE Civil Engineering" style="display:block;width:200px;max-width:200px;height:auto;border:0;">`
    : `<span style="font:700 22px/1 ${COND};color:${GRAY};letter-spacing:.04em;">CAGE</span> <span style="font:600 13px/1 ${FONT};color:${SOFT};">Civil Engineering</span>`;
  return `<table ${TABLE}border-bottom:4px solid ${LIME};"><tr>`
    + `<td valign="bottom" style="padding:0 0 12px;">${logo}</td>`
    + `<td valign="bottom" align="right" style="padding:0 0 12px;text-align:right;">`
    + `<div style="font:700 22px/1.05 ${COND};letter-spacing:.03em;text-transform:uppercase;color:${GRAY};">Project Status Report</div>`
    + `<div style="font:400 14px/1.4 ${FONT};color:${SOFT};margin-top:3px;">${esc(fmtYmd(reportDate, { long: true }))}</div></td></tr></table>`;
}

function infoBox(p, reportDate, by) {
  const th = (t) => `<td width="16%" style="width:16%;padding:7px 10px;border:1px solid ${RULE};background:${BAND};font:600 11px/1.3 ${FONT};color:${GRAY};text-transform:uppercase;letter-spacing:.04em;white-space:nowrap;">${esc(t)}</td>`;
  const td = (h, bold) => `<td width="34%" style="width:34%;padding:7px 10px;border:1px solid ${RULE};font:${bold ? 700 : 400} 14px/1.35 ${FONT};color:${INK};">${h}</td>`;
  const byHtml = `${esc(by?.name || '')}${by?.position ? `<span style="color:${SOFT};">, ${esc(by.position)}</span>` : ''}`;
  return `<table ${TABLE}margin-top:16px;border:1px solid ${RULE};">`
    + `<tr>${th('Project')}${td(esc(sheetName(p)), true)}${th('Project No.')}${td(esc(p.project_number || '–'))}</tr>`
    + `<tr>${th('Owner')}${td(esc(p.owner_company || '–'))}${th('Jurisdiction')}${td(esc(p.jurisdiction || '–'))}</tr>`
    + `<tr>${th('Prepared by')}${td(byHtml)}${th('Report date')}${td(esc(fmtYmd(reportDate, { long: true })))}</tr></table>`;
}

function stagesHtml(p) {
  if (!p.steps?.length) return `<span style="color:${SOFT};font-style:italic;">No stages set</span>`;
  return p.steps.map((s) => {
    if (s.state === 'current') return `<span style="display:inline-block;margin:2px 0;padding:3px 10px;border-radius:12px;background:${LIME};border:1px solid ${INK};color:${INK};font-weight:700;">&#9679; ${esc(s.label)}</span>`;
    if (s.state === 'done') return `<span style="display:inline-block;margin:2px 0;padding:3px 10px;border-radius:12px;background:${GRAY};color:#ffffff;">&#10003; ${esc(s.label)}</span>`;
    return `<span style="display:inline-block;margin:2px 0;padding:3px 10px;border-radius:12px;border:1px solid ${RULE};color:${SOFT};">${esc(s.label)}</span>`;
  }).join(`<span style="color:${RULE};"> &#8212; </span>`);
}

function summary(p) {
  const items = p.attention || [];
  const late = items.filter((a) => a.late).length;
  const s = scheduleOf(p.schedule_status);
  const [bg, fg] = PILL[p.schedule_status] || ['#ECECEE', GRAY];
  const cur = (p.steps || []).find((x) => x.state === 'current');
  const k = (t) => `<div style="font:600 11px/1.3 ${FONT};color:${GRAY};text-transform:uppercase;letter-spacing:.05em;margin-bottom:5px;">${esc(t)}</div>`;
  const cell = (inner, last) => `<td valign="top" width="33%" style="width:33%;padding:10px 12px;${last ? '' : `border-right:1px solid ${RULE};`}">${inner}</td>`;
  return `<table ${TABLE}margin-top:12px;border:1px solid ${RULE};"><tr>`
    + cell(`${k('Schedule')}<span style="display:inline-block;padding:3px 14px;border-radius:14px;background:${bg};color:${fg};font:700 14px/1.3 ${FONT};">${esc(s ? s.label : 'Not set')}</span>`)
    + cell(`${k('Current stage')}<div style="font:600 15px/1.3 ${FONT};color:${INK};">${esc(cur ? `${cur.label} (${stageCount(p)})` : 'Not set')}</div>`)
    + cell(`${k('Open items')}<div style="font:600 15px/1.3 ${FONT};color:${INK};">${items.length}${late ? ` <span style="color:${RED};font-weight:700;">&middot; ${late} late</span>` : ''}</div>`, true)
    + `</tr><tr><td colspan="3" style="padding:10px 12px;border-top:1px solid ${RULE};font:400 13px/1.6 ${FONT};">${stagesHtml(p)}</td></tr></table>`;
}

const h2 = (n, title, sub = '') => `<table ${TABLE}margin:24px 0 8px;"><tr>`
  + `<td style="padding:0 0 5px;border-bottom:2px solid ${GRAY};">`
  + `<span style="display:inline-block;min-width:20px;padding:1px 6px;border-radius:4px;background:${GRAY};color:#ffffff;font:700 14px/1.3 ${COND};text-align:center;">${n}</span>`
  + `&nbsp; <span style="font:700 17px/1.2 ${COND};letter-spacing:.03em;text-transform:uppercase;color:${GRAY};">${esc(title)}</span></td>`
  + `<td align="right" style="padding:0 0 5px;border-bottom:2px solid ${GRAY};font:500 13px/1.2 ${FONT};color:${SOFT};white-space:nowrap;text-align:right;">${esc(sub)}</td></tr></table>`;

function notesHtml(text) {
  if (!String(text || '').trim()) return `<p style="margin:0;color:${SOFT};font-style:italic;">No status report this week.</p>`;
  return parseNotes(text).map((b) => {
    if (b.type === 'gap') return '';
    if (b.type === 'title' || b.type === 'header') return `<p style="margin:12px 0 3px;font-weight:700;color:${INK};">${esc(b.text)}</p>`;
    if (b.type === 'bullet') return `<p style="margin:3px 0 3px ${16 + b.level * 18}px;"><span style="color:${GRAY};">&#8226;</span>&nbsp; ${esc(b.text)}</p>`;
    return `<p style="margin:0 0 7px;">${esc(b.text)}</p>`;
  }).join('');
}

const head = (cols) => `<tr>${cols.map(([t, w]) => `<td${w ? ` width="${w}"` : ''} style="${w ? `width:${w};` : ''}padding:7px 9px;background:${GRAY};color:#ffffff;font:600 12px/1.25 ${FONT};">${esc(t)}</td>`).join('')}</tr>`;
const cell = (h, { bg = '', color = INK, bold = false, first = false, nowrap = false } = {}) => `<td valign="top" style="padding:7px 9px;border-bottom:1px solid ${RULE};`
  + `${bg ? `background:${bg};` : ''}${first && bg === RED_SOFT ? `border-left:3px solid ${RED};` : ''}font:${bold ? 600 : 400} 13px/1.35 ${FONT};color:${color};${nowrap ? 'white-space:nowrap;' : ''}">${h}</td>`;
const two = (a, b) => `${a ? `<div style="font-weight:600;">${esc(a)}</div>` : ''}${b ? `<div style="color:${SOFT};font-size:12px;">${esc(b)}</div>` : ''}`;
const zebra = (i) => (i % 2 ? '#FAFAFB' : '');

function itemsHtml(items, ref) {
  return `<table ${TABLE}">${head([['#', '5%'], ['Item needed', '45%'], ['From', '22%'], ['Needed by', '13%'], ['Status', '15%']])}`
    + items.map((a, i) => {
      const bg = a.late ? RED_SOFT : zebra(i);
      return `<tr>${cell(String(i + 1), { bg, color: SOFT, first: true })}${cell(esc(a.item), { bg, bold: true })}${cell(esc(a.from_party || '–'), { bg })}`
        + `${cell(esc(a.need_by ? fmtShort(a.need_by, ref) : '–'), { bg, nowrap: true })}`
        + `${cell(esc(itemStatus(a)), { bg, color: a.late ? RED : SOFT, bold: a.late })}</tr>`;
    }).join('') + '</table>';
}

function logHtml(subs, ref) {
  if (!subs.length) return `<p style="margin:0;color:${SOFT};font-style:italic;">No submittals.</p>`;
  return `<table ${TABLE}">${head([['Agency / submittal', '30%'], ['Status', '20%'], ['Next date', '16%'], ['Ball in court', '12%'], ['Notes', '22%']])}`
    + subs.map((s, i) => {
      const bg = zebra(i);
      const color = s.closed ? SOFT : INK;
      return `<tr>${cell(two(s.agency || 'Agency not set', s.title), { bg, color })}${cell(two(s.status_label, subDetail(s, ref)), { bg, color })}`
        + `${cell(s.next ? two(fmtShort(s.next, ref), s.next_label) : '–', { bg, color, nowrap: true })}`
        + `${cell(esc(s.ball || '–'), { bg, color })}${cell(esc(s.note || ''), { bg, color })}</tr>`;
    }).join('') + '</table>';
}

function meetingsHtml(meetings, ref) {
  if (!meetings.length) return `<p style="margin:0;color:${SOFT};font-style:italic;">No meetings scheduled.</p>`;
  return `<table ${TABLE}">${head([['Date', '20%'], ['Time', '14%'], ['Meeting', '40%'], ['Location', '26%']])}`
    + meetings.map((m, i) => {
      const bg = zebra(i);
      return `<tr>${cell(esc(fmtDay(m.meeting_date, ref)), { bg, bold: true, nowrap: true })}${cell(esc(m.meeting_time ? fmtHhmm(m.meeting_time) : '–'), { bg, nowrap: true })}`
        + `${cell(esc(m.title), { bg })}${cell(esc(m.location || '–'), { bg })}</tr>`;
    }).join('') + '</table>';
}

function projectHtml(p, i, { reportDate, preparedBy: by, logoUrl }) {
  const items = p.attention || [];
  const late = items.filter((a) => a.late).length;
  const subs = p.submittals || [];
  let n = 0;
  return `<div style="${i ? `margin:40px 0 0;padding-top:28px;border-top:3px solid ${GRAY};` : 'margin:0;'}">`
    + letterhead(reportDate, logoUrl) + infoBox(p, reportDate, by) + summary(p)
    + h2(++n, 'Status Update', sheetWeekTitle(p)) + notesHtml(p.status_body ?? p.status_report)
    + (items.length ? h2(++n, 'Attention Items', `${items.length} open${late ? `, ${late} late` : ''}`) + itemsHtml(items, reportDate) : '')
    + h2(++n, 'Submittals & Permits', subs.length ? `${subs.filter((s) => !s.closed).length} open` : '') + logHtml(subs, reportDate)
    + h2(++n, 'Upcoming Meetings') + meetingsHtml(p.meetings || [], reportDate)
    + (p.report_note ? `<p style="margin:14px 0 0;font:400 12px/1.4 ${FONT};color:#8a8a8d;"><b style="color:${GRAY};">Notes:</b> ${esc(p.report_note)}</p>` : '')
    + (p.report_link ? `<p style="margin:10px 0 0;font:400 13px/1.4 ${FONT};color:${GRAY};">Project documents: <a href="${esc(p.report_link)}" style="color:${INK};font-weight:600;text-decoration:underline;">Open the Egnyte folder</a></p>` : '')
    + `<table ${TABLE}margin-top:24px;border-top:1px solid ${RULE};"><tr>`
    + `<td style="padding:8px 0 0;font:400 12px/1.4 ${FONT};color:${SOFT};"><b style="color:${GRAY};">CAGE Civil Engineering</b> &middot; cagecivil.com</td>`
    + `<td align="right" style="padding:8px 0 0;font:400 12px/1.4 ${FONT};color:${SOFT};text-align:right;">${by?.name ? `Prepared by ${esc(by.name)}${by.email ? ` &middot; ${esc(by.email)}` : ''}` : ''}</td></tr></table>`
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
  const L = ['CAGE CIVIL ENGINEERING · PROJECT STATUS REPORT', fmtYmd(reportDate, { long: true }), ''];
  L.push(`Project: ${sheetName(p)}${p.project_number ? ` (No. ${p.project_number})` : ''}`);
  L.push(`Owner: ${p.owner_company || '-'} · Jurisdiction: ${p.jurisdiction || '-'}`);
  if (by?.name) L.push(`Prepared by: ${[by.name, by.position].filter(Boolean).join(', ')}`);
  L.push(`Schedule: ${scheduleOf(p.schedule_status)?.label || 'Not set'} · Current stage: ${cur ? `${cur.label} (${stageCount(p)})` : 'Not set'} · Open items: ${items.length}${late ? ` (${late} late)` : ''}`);
  if (p.steps?.length) L.push(`Stages: ${p.steps.map((s) => (s.state === 'current' ? `[${s.label}]` : s.state === 'done' ? `${s.label} (complete)` : s.label)).join(' > ')}`);
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
  L.push('', `CAGE Civil Engineering · cagecivil.com${by?.name ? ` · Prepared by ${by.name}${by.email ? ` (${by.email})` : ''}` : ''}`);
  return L.join('\n');
}

export function reportEmail(reports, { reportDate, owner = '', preparedBy = null, logoUrl = '' } = {}) {
  const list = reports || [];
  const ctx = { reportDate, preparedBy, logoUrl };
  const intro = owner
    ? `<table ${TABLE}margin:0 0 22px;"><tr><td style="padding:10px 14px;background:${BAND};border-left:4px solid ${LIME};font:400 15px/1.4 ${FONT};color:${GRAY};">`
      + `Weekly status for <b style="color:${INK};">${esc(owner)}</b>: ${esc(plural(list.length, 'active project'))}.</td></tr></table>`
    : '';
  const html = `<div style="font-family:${FONT};font-size:14px;line-height:1.45;color:${INK};max-width:760px;">`
    + intro + list.map((p, i) => projectHtml(p, i, ctx)).join('') + '</div>';
  const top = owner ? [`Weekly status for ${owner}: ${plural(list.length, 'active project')}.`, '', ''] : [];
  const text = [...top, list.map((p) => projectText(p, ctx)).join('\n\n\n')].join('\n');
  return { html, text };
}
