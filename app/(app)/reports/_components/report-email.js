import { parseNotes } from '@/app/notes-parse';
import { scheduleOf } from '@/lib/projects';
import { fmtDay, fmtDayYear, fmtHhmm, fmtIssued, fmtShort } from '@/app/_ui/project-format';
import { sheetName, sheetWeekTitle } from './report-model';

// "Copy for email" (design-amendments A6.6, A11): the report(s) as clean, email-safe HTML (tables and inline styles,
// so it pastes into Outlook and Gmail) plus a plain-text version, both laid out like the sheet: the heading and date
// line, project facts, schedule, stage, the week's Status Report, the ONE "Attention Items" list (late first, with
// "N days late"), the meetings ahead and the submittal & permit log (with its Notes column), then who prepared it.
// Built ONLY from lib/queries/reports.js report objects (the same ones the page renders), never from anything else on
// the page, so no task, member, info row or minutes text can reach an owner. Same palette rules as the sheet: lime
// only on the current stage, brick only on Behind and late items.
//   reportEmail(reports, { reportDate, owner, preparedBy }) -> { html, text }

const INK = '#1F1F21';
const GRAY = '#58585A';
const SOFT = '#6C6C6F';
const RULE = '#B1B1B4';
const LIME = '#C2D02E';
const BRICK = '#9A3B1F';
const COND = "'Barlow Condensed','Arial Narrow',Arial,sans-serif";
const TEXT = "Barlow,'Segoe UI',Helvetica,Arial,sans-serif";

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const lateText = (a) => (a.late ? `${plural(a.days_late, 'day')} late` : '');
const needBy = (a, ref) => (a.need_by ? `need by ${fmtShort(a.need_by, ref)}` : 'no date set');
const stageLine = (p) => {
  const at = (p.steps || []).findIndex((s) => s.state === 'current');
  return at >= 0 ? `Stage ${at + 1} of ${p.steps.length}` : 'Stage';
};
function logDetail(s, ref) {
  const d = s.detail;
  if (!d) return '';
  if (s.closed) return d.date ? fmtShort(d.date, ref) : '';
  return [d.date ? `${d.label} ${fmtShort(d.date, ref)}` : '', d.days ? `${d.days}-day review` : ''].filter(Boolean).join(', ');
}
const logCount = (subs) => {
  const open = subs.filter((s) => !s.closed).length;
  return `${open} open, by next date${subs.length > open ? '; closed last' : ''}`;
};

// ---------------------------------------------------------------------------------------------------------- HTML

const h2 = (title, count = '') => `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;width:100%;margin:22px 0 8px;"><tr>`
  + `<td style="padding:0 0 4px;border-bottom:1.5px solid ${INK};font:700 15px/1.1 ${COND};letter-spacing:.075em;text-transform:uppercase;color:${INK};">${esc(title)}</td>`
  + `<td align="right" style="padding:0 0 4px;border-bottom:1.5px solid ${INK};font:500 12.5px/1.1 ${TEXT};color:${SOFT};white-space:nowrap;">${esc(count)}</td></tr></table>`;

function notesHtml(text) {
  if (!String(text || '').trim()) return `<p style="margin:0;color:${SOFT};">No status report this week.</p>`;
  return parseNotes(text).map((b) => {
    if (b.type === 'gap') return '';
    if (b.type === 'title' || b.type === 'header') return `<p style="margin:10px 0 2px;font-weight:600;color:${INK};">${esc(b.text)}</p>`;
    if (b.type === 'bullet') return `<p style="margin:2px 0 2px ${14 + b.level * 14}px;text-indent:-12px;"><span style="color:${GRAY};">&ndash;</span>&nbsp; ${esc(b.text)}</p>`;
    return `<p style="margin:6px 0 0;">${esc(b.text)}</p>`;
  }).join('');
}

function stagesHtml(p) {
  if (!p.steps?.length) return `<span style="color:${SOFT};">No stages set</span>`;
  return p.steps.map((s) => {
    if (s.state === 'current') return `<span style="background:${LIME};color:${INK};font-weight:700;padding:1px 6px;border:1px solid ${INK};">${esc(s.label)}</span>`;
    if (s.state === 'done') return `<span style="color:${SOFT};">${esc(s.label)} (complete)</span>`;
    return `<span style="color:${GRAY};">${esc(s.label)}</span>`;
  }).join(`<span style="color:${RULE};"> &nbsp;&rsaquo;&nbsp; </span>`);
}

function scheduleHtml(key) {
  const s = scheduleOf(key);
  if (!s) return `<span style="color:${SOFT};">Not set</span>`;
  return `<b style="color:${key === 'behind' ? BRICK : INK};">${esc(s.label)}</b>`;
}

function itemsHtml(items, ref) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;width:100%;">${items.map((a, i) => {
    const late = lateText(a);
    const box = a.late ? `border:1.5px solid ${BRICK};border-radius:10px;` : '';
    return `<tr><td style="padding:3px 0;"><table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:separate;width:100%;${box}"><tr>`
      + `<td valign="top" width="26" style="width:26px;padding:6px 0 6px 8px;font:700 12px/1.3 ${TEXT};color:${INK};">${i + 1}.</td>`
      + `<td valign="top" style="padding:6px 8px 6px 0;"><div style="font-weight:600;color:${INK};">${esc(a.item)}</div>`
      + `<div style="font-size:13px;color:${GRAY};">${a.from_party ? `${esc(a.from_party)} &middot; ` : ''}${esc(needBy(a, ref))}`
      + `${late ? ` &middot; <b style="color:${BRICK};">${esc(late)}</b>` : ''}</div></td></tr></table></td></tr>`;
  }).join('')}</table>`;
}

function meetingsHtml(meetings, ref) {
  if (!meetings.length) return `<p style="margin:0;color:${SOFT};">No meetings scheduled.</p>`;
  return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;width:100%;">${meetings.map((m) => `<tr>`
    + `<td valign="top" width="130" style="width:130px;padding:6px 10px 6px 0;border-bottom:1px solid ${RULE};font-weight:600;white-space:nowrap;">${esc(fmtDay(m.meeting_date, ref))}`
    + `${m.meeting_time ? `<div style="font-weight:500;color:${GRAY};">${esc(fmtHhmm(m.meeting_time))}</div>` : ''}</td>`
    + `<td valign="top" style="padding:6px 0;border-bottom:1px solid ${RULE};"><div style="font-weight:500;">${esc(m.title)}</div>`
    + `${m.location ? `<div style="font-size:13px;color:${GRAY};">${esc(m.location)}</div>` : ''}</td></tr>`).join('')}</table>`;
}

function logHtml(subs, ref) {
  if (!subs.length) return `<p style="margin:0;color:${SOFT};">No submittals.</p>`;
  const th = (t, w) => `<th align="left" ${w ? `width="${w}" ` : ''}style="text-align:left;padding:4px 6px;border-bottom:1.5px solid ${INK};font:600 12px/1.2 ${TEXT};color:${GRAY};">${esc(t)}</th>`;
  const td = (h, closed) => `<td valign="top" style="vertical-align:top;padding:6px;border-bottom:1px solid ${RULE};font-size:13px;color:${closed ? SOFT : INK};">${h}</td>`;
  const two = (a, b, closed) => `${a ? `<div style="font-weight:${closed ? 500 : 600};">${esc(a)}</div>` : ''}${b ? `<div style="color:${closed ? SOFT : GRAY};">${esc(b)}</div>` : ''}`;
  return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;width:100%;">`
    + `<tr>${th('Agency and submittal')}${th('Status')}${th('Next date')}${th('Ball in court')}${th('Notes')}</tr>`
    + subs.map((s) => `<tr>${td(two(s.agency || 'Agency not set', s.title, s.closed), s.closed)}${td(two(s.status_label, logDetail(s, ref), s.closed), s.closed)}`
      + `${td(s.next ? two(fmtShort(s.next, ref), s.next_label, s.closed) : `<span style="color:${SOFT};">${s.closed ? '&ndash;' : 'not set'}</span>`, s.closed)}`
      + `${td(s.ball ? `<b style="font-weight:600;">${esc(s.ball)}</b>` : `<span style="color:${SOFT};">&ndash;</span>`, s.closed)}`
      + `${td(esc(s.note || ''), s.closed)}</tr>`).join('')
    + '</table>';
}

function projectHtml(p, i, { reportDate, preparedBy }) {
  const items = p.attention || [];
  const late = items.filter((a) => a.late).length;
  const meetings = p.meetings || [];
  const subs = p.submittals || [];
  const facts = [p.project_number ? `Project No. <b>${esc(p.project_number)}</b>` : '', `Owner: <b>${esc(p.owner_company || '–')}</b>`,
    `Jurisdiction: <b>${esc(p.jurisdiction || '–')}</b>`].filter(Boolean).join(' &nbsp;&middot;&nbsp; ');
  const by = [preparedBy?.name, preparedBy?.position, preparedBy?.email].filter(Boolean).map(esc).join(', ');
  return `<div style="${i ? `margin:34px 0 0;padding-top:22px;border-top:2px solid ${INK};` : 'margin:0;'}">`
    + `<div style="font:700 22px/1.1 ${COND};letter-spacing:.075em;text-transform:uppercase;color:${INK};">Project status report</div>`
    + `<p style="margin:4px 0 10px;color:${GRAY};"><b style="color:${INK};">${esc(sheetName(p))}</b> &middot; ${esc(fmtDayYear(reportDate))}</p>`
    + `<p style="margin:0 0 4px;color:${GRAY};">${facts}</p>`
    + `<p style="margin:0 0 4px;color:${GRAY};">Schedule: ${scheduleHtml(p.schedule_status)}</p>`
    + `<p style="margin:0;color:${GRAY};">${esc(stageLine(p))}: ${stagesHtml(p)}</p>`
    + (p.report_link ? `<p style="margin:4px 0 0;color:${GRAY};">Project documents: <a href="${esc(p.report_link)}" style="color:${INK};font-weight:600;">Open the Egnyte folder</a></p>` : '')
    + h2(sheetWeekTitle(p)) + notesHtml(p.status_body ?? p.status_report)
    + (items.length ? h2('Attention Items', `${items.length} open${late ? `, ${late} late` : ''}`) + itemsHtml(items, reportDate) : '')
    + h2('Meetings ahead', meetings.length ? `Next ${meetings.length}` : '') + meetingsHtml(meetings, reportDate)
    + h2('Submittal & permit log', subs.length ? logCount(subs) : '') + logHtml(subs, reportDate)
    + `<p style="margin:18px 0 0;padding-top:8px;border-top:1px solid ${RULE};font-size:12.5px;color:${GRAY};">`
    + `${by ? `Prepared by ${by} &middot; ` : ''}Issued ${esc(fmtIssued(reportDate))} &middot; CAGE Civil Engineering &middot; cagecivil.com</p>`
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

function projectText(p, { reportDate, preparedBy }) {
  const items = p.attention || [];
  const late = items.filter((a) => a.late).length;
  const meetings = p.meetings || [];
  const subs = p.submittals || [];
  const L = ['PROJECT STATUS REPORT', `${sheetName(p)} · ${fmtDayYear(reportDate)}`];
  L.push([p.project_number ? `Project No. ${p.project_number}` : '', `Owner: ${p.owner_company || '-'}`, `Jurisdiction: ${p.jurisdiction || '-'}`].filter(Boolean).join(' · '));
  L.push(`Schedule: ${scheduleOf(p.schedule_status)?.label || 'Not set'}`);
  if (p.report_link) L.push(`Project documents: ${p.report_link}`);
  L.push(p.steps?.length
    ? `${stageLine(p)}: ${p.steps.map((s) => (s.state === 'current' ? `[${s.label}]` : s.state === 'done' ? `${s.label} (complete)` : s.label)).join(' > ')}`
    : 'Stage: no stages set');
  L.push('', sheetWeekTitle(p).toUpperCase(), notesText(p.status_body ?? p.status_report));
  if (items.length) {
    L.push('', `ATTENTION ITEMS (${items.length} open${late ? `, ${late} late` : ''})`);
    items.forEach((a, i) => {
      const lt = lateText(a);
      L.push(`${i + 1}. ${a.item}`);
      L.push(`   ${[a.from_party, needBy(a, reportDate), lt ? lt.toUpperCase() : ''].filter(Boolean).join(' · ')}`);
    });
  }
  L.push('', 'MEETINGS AHEAD');
  if (meetings.length) {
    for (const m of meetings) {
      const when = [fmtDay(m.meeting_date, reportDate), fmtHhmm(m.meeting_time)].filter(Boolean).join(', ');
      L.push(`- ${when}: ${m.title}${m.location ? ` (${m.location})` : ''}`);
    }
  } else L.push('No meetings scheduled.');
  L.push('', `SUBMITTAL & PERMIT LOG${subs.length ? ` (${logCount(subs)})` : ''}`);
  if (subs.length) {
    for (const s of subs) {
      L.push(`- ${s.agency || 'Agency not set'}${s.title ? `: ${s.title}` : ''}`);
      const detail = logDetail(s, reportDate);
      const bits = [`${s.status_label}${detail ? ` (${detail})` : ''}`];
      if (s.next) bits.push(`Next: ${fmtShort(s.next, reportDate)}, ${s.next_label}`);
      if (s.ball) bits.push(`Ball in court: ${s.ball}`);
      L.push(`  ${bits.join(' · ')}`);
      if (s.note) L.push(`  Notes: ${s.note}`);
    }
  } else L.push('No submittals.');
  const by = [preparedBy?.name, preparedBy?.position, preparedBy?.email].filter(Boolean).join(', ');
  L.push('', `${by ? `Prepared by ${by} · ` : ''}Issued ${fmtIssued(reportDate)} · CAGE Civil Engineering · cagecivil.com`);
  return L.join('\n');
}

export function reportEmail(reports, { reportDate, owner = '', preparedBy = null } = {}) {
  const list = reports || [];
  const ctx = { reportDate, preparedBy };
  const intro = owner
    ? `<p style="margin:0 0 18px;color:${GRAY};">Weekly status for <b style="color:${INK};">${esc(owner)}</b>: ${esc(plural(list.length, 'active project'))}.</p>`
    : '';
  const html = `<div style="font-family:${TEXT};font-size:14px;line-height:1.45;color:${INK};max-width:720px;">`
    + intro + list.map((p, i) => projectHtml(p, i, ctx)).join('') + '</div>';
  const head = owner ? [`Weekly status for ${owner}: ${plural(list.length, 'active project')}.`, '', ''] : [];
  const text = [...head, list.map((p) => projectText(p, ctx)).join('\n\n\n')].join('\n');
  return { html, text };
}
