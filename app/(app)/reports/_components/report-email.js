import { parseNotes } from '@/app/notes-format';
import { scheduleOf } from '@/lib/projects';
import { fmtHhmm, fmtSubmittalValue, fmtYmd, submittalLabel } from '@/app/_ui/project-format';

// "Copy for email" (design-amendments A6.6): the report(s) as email-safe HTML (tables and inline styles, so it
// pastes into Outlook and Gmail) plus a plain-text version. Built ONLY from lib/queries/reports.js report objects
// (the same ones the page renders), never from anything else on the page, so no task, member, info row or minutes
// text can reach an owner. Only ReportActions (a client component) calls this; it imports parseNotes from the
// client notes module, so keep it out of Server Components.
//   reportEmail(reports, { reportDate, owner }) -> { html, text }

const INK = '#5B5859';
const LIME = '#CBCE00';
const ON_LIME = '#2b2a1f';
const TEXT = '#2f2e2e';
const MUTED = '#8a8788';
const LINE = '#e1e1e3';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function notesHtml(text) {
  if (!String(text || '').trim()) return `<p style="margin:0;color:${MUTED};font-style:italic;">No status report this week.</p>`;
  return parseNotes(text).map((b) => {
    if (b.type === 'gap') return '<div style="height:10px;line-height:10px;">&nbsp;</div>';
    if (b.type === 'title') return `<p style="margin:10px 0 4px;font-size:15px;font-weight:800;color:${INK};">${esc(b.text)}</p>`;
    if (b.type === 'header') return `<p style="margin:8px 0 2px;font-weight:700;color:${INK};">${esc(b.text)}</p>`;
    if (b.type === 'bullet') {
      return `<p style="margin:1px 0 1px ${12 + b.level * 18}px;"><span style="color:${b.level ? INK : '#9a9c00'};">&#8226;</span>&nbsp; ${esc(b.text)}</p>`;
    }
    return `<p style="margin:0;white-space:pre-wrap;">${esc(b.text)}</p>`;
  }).join('');
}

function notesText(text) {
  if (!String(text || '').trim()) return 'No status report this week.';
  return parseNotes(text).map((b) => {
    if (b.type === 'gap') return '';
    if (b.type === 'title') return b.text;
    if (b.type === 'header') return b.text;
    if (b.type === 'bullet') return `${'  '.repeat(b.level)}- ${b.text}`;
    return b.text;
  }).join('\n');
}

const badgeHtml = (key) => {
  const s = scheduleOf(key);
  if (!s) return `<span style="color:${MUTED};">Not set</span>`;
  const fg = key === 'on_track' ? ON_LIME : '#ffffff';
  return `<span style="display:inline-block;background:${s.color};color:${fg};font-weight:700;padding:2px 10px;border-radius:10px;">${esc(s.label)}</span>`;
};

function stagesHtml(p) {
  if (!p.steps?.length) return `<span style="color:${MUTED};">No stages set</span>`;
  return p.steps.map((s) => {
    if (s.state === 'current') return `<span style="background:${LIME};color:${ON_LIME};font-weight:800;padding:2px 8px;border-radius:10px;">${esc(s.label)}</span>`;
    if (s.state === 'done') return `<span style="color:${INK};font-weight:600;">${esc(s.label)} (done)</span>`;
    return `<span style="color:${MUTED};">${esc(s.label)}</span>`;
  }).join(`<span style="color:${MUTED};"> &rsaquo; </span>`);
}

const th = (t) => `<th align="left" style="text-align:left;padding:6px 8px;border-bottom:2px solid ${LIME};font-size:12px;color:${INK};text-transform:uppercase;letter-spacing:.03em;">${esc(t)}</th>`;
const td = (h, extra = '') => `<td valign="top" style="padding:6px 8px;border-bottom:1px solid ${LINE};vertical-align:top;${extra}">${h}</td>`;
const tableHtml = (heads, rows) => `<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;max-width:720px;font-size:13px;">`
  + `<tr>${heads.map(th).join('')}</tr>${rows.join('')}</table>`;

function projectHtml(p, i) {
  const subs = p.submittals?.length
    ? tableHtml(['To', 'Submittal', 'Status', 'Dates'], p.submittals.map((s) => `<tr>${td(esc(s.agency || '-'))}${td(esc(s.title || '-'), 'font-weight:600;')}`
      + `${td(`<span style="color:${s.status_color};font-weight:700;">${esc(s.status_label)}</span>`)}`
      + `${td(s.dates.map((d) => `${esc(submittalLabel(d))}: ${esc(fmtSubmittalValue(d) || 'not set')}`).join('<br>') || '-')}</tr>`))
    : `<p style="margin:0;color:${MUTED};">No submittals.</p>`;
  const meets = p.meetings?.length
    ? tableHtml(['Date', 'Time', 'What / with whom', 'Where'], p.meetings.map((m) => `<tr>${td(esc(fmtYmd(m.meeting_date, { weekday: true })), 'white-space:nowrap;')}`
      + `${td(esc(fmtHhmm(m.meeting_time) || '-'), 'white-space:nowrap;')}${td(esc(m.title), 'font-weight:600;')}${td(esc(m.location || '-'))}</tr>`))
    : `<p style="margin:0;color:${MUTED};">No upcoming meetings.</p>`;
  const h3 = (t) => `<h3 style="margin:16px 0 6px;font-size:13px;color:${INK};text-transform:uppercase;letter-spacing:.04em;">${esc(t)}</h3>`;
  // The first project sits right under the header; later ones (a packet) get a rule above them.
  return `<div style="${i ? `margin:26px 0 0;padding-top:16px;border-top:1px solid ${LINE};` : 'margin:18px 0 0;'}">`
    + `<h2 style="margin:0 0 6px;font-size:19px;color:${INK};">${esc(p.title)}</h2>`
    + `<p style="margin:0 0 4px;"><b>Owner:</b> ${esc(p.owner_company || '-')} &nbsp;&middot;&nbsp; <b>Jurisdiction:</b> ${esc(p.jurisdiction || '-')}`
    + `${p.project_number ? ` &nbsp;&middot;&nbsp; <b>Project no.:</b> ${esc(p.project_number)}` : ''}</p>`
    + `<p style="margin:0 0 4px;"><b>Stage:</b> ${stagesHtml(p)}</p>`
    + `<p style="margin:0 0 4px;"><b>Schedule:</b> ${badgeHtml(p.schedule_status)}</p>`
    + h3('Status Report') + notesHtml(p.status_report)
    + h3('Submittals') + subs
    + h3('Upcoming meetings') + meets
    + '</div>';
}

function projectText(p) {
  const lines = [p.title, '-'.repeat(Math.min(60, Math.max(8, p.title.length)))];
  lines.push(`Owner: ${p.owner_company || '-'}`);
  lines.push(`Jurisdiction: ${p.jurisdiction || '-'}`);
  if (p.project_number) lines.push(`Project no.: ${p.project_number}`);
  lines.push(p.steps?.length
    ? `Stage: ${p.current_stage_label || 'not set'} (${p.steps.map((s) => s.label).join(' > ')})`
    : 'Stage: no stages set');
  lines.push(`Schedule: ${scheduleOf(p.schedule_status)?.label || 'Not set'}`);
  lines.push('', 'STATUS REPORT', notesText(p.status_report));
  lines.push('', 'SUBMITTALS');
  if (p.submittals?.length) {
    for (const s of p.submittals) {
      const dates = s.dates.map((d) => `${submittalLabel(d)}: ${fmtSubmittalValue(d) || 'not set'}`).join('; ');
      lines.push(`- ${s.agency || '-'}: ${s.title || '-'} - ${s.status_label}${dates ? ` (${dates})` : ''}`);
    }
  } else lines.push('No submittals.');
  lines.push('', 'UPCOMING MEETINGS');
  if (p.meetings?.length) {
    for (const m of p.meetings) {
      const when = [fmtYmd(m.meeting_date, { weekday: true }), fmtHhmm(m.meeting_time)].filter(Boolean).join(' ');
      lines.push(`- ${when}: ${m.title}${m.location ? ` (${m.location})` : ''}`);
    }
  } else lines.push('No upcoming meetings.');
  return lines.join('\n');
}

export function reportEmail(reports, { reportDate, owner = '' } = {}) {
  const list = reports || [];
  const date = fmtYmd(reportDate, { long: true });
  const kind = owner ? 'Weekly Project Status' : 'Project Status Report';
  const intro = owner
    ? `<p style="margin:12px 0 0;">Weekly status for <b>${esc(owner)}</b>: ${list.length} active ${list.length === 1 ? 'project' : 'projects'}.</p>`
    : '';
  const html = `<div style="font-family:'Segoe UI',Helvetica,Arial,sans-serif;font-size:14px;line-height:1.45;color:${TEXT};max-width:720px;">`
    + `<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;max-width:720px;"><tr>`
    + `<td style="padding:0 0 8px;border-bottom:3px solid ${LIME};"><div style="font-size:18px;font-weight:800;color:${INK};">CAGE Civil Engineering</div>`
    + `<div style="font-size:13px;color:${INK};">${esc(kind)} &middot; ${esc(date)}</div></td></tr></table>`
    + intro + list.map(projectHtml).join('') + '</div>';
  const head = [`CAGE Civil Engineering - ${kind}`, date];
  if (owner) head.push('', `Weekly status for ${owner}: ${list.length} active ${list.length === 1 ? 'project' : 'projects'}.`);
  const text = [...head, '', list.map(projectText).join('\n\n\n')].join('\n');
  return { html, text };
}
