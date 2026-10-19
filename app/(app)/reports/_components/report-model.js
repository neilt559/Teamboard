import { fmtMonthDay, fmtShort } from '@/app/_ui/project-format';

// Shared by the server sheet (ReportDoc.js) and Copy for email (report-email.js), so both name things the same way.
// A plain module (no 'use client', no hooks).

// The project's name without the job number a pre-A6 name starts with ("230021 - Randall Commons" -> "Randall
// Commons"); the number has its own place in the title block.
export function sheetName(p) {
  const name = String(p?.name ?? '').trim();
  const num = String(p?.project_number ?? '').trim();
  if (num && name.startsWith(num)) return name.slice(num.length).replace(/^[\s\-–—:·]+/, '').trim() || name;
  return name || p?.title || 'Untitled project';
}

// The Status Report's heading: its own leading "%t" title, else "Week of <Monday of the report week>".
export const sheetWeekTitle = (p) => p?.status_title || (p?.week_of ? `Week of ${fmtMonthDay(p.week_of)}` : 'Status report');

// A short signature of the report data: the pages key ReportReady with it, so a refresh that brings new content
// (back / forward refreshes the page's server data) fits the new sheets again.
export function reportSig(x) {
  const s = JSON.stringify(x ?? null);
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return `${s.length.toString(36)}-${(h >>> 0).toString(36)}`;
}

// An attention item's status cell: "5 days late", or "Open".
export const itemStatus = (a) => (a.late ? `${a.days_late} ${a.days_late === 1 ? 'day' : 'days'} late` : 'Open');

// A submittal's status detail line: the date its status carries and the review period ("Submitted Oct 6, 21-day
// review"); a closed one shows only its date.
export function subDetail(s, ref) {
  const d = s.detail;
  if (!d) return '';
  if (s.closed) return d.date ? fmtShort(d.date, ref) : '';
  return [d.date ? `${d.label} ${fmtShort(d.date, ref)}` : '', d.days ? `${d.days}-day review` : ''].filter(Boolean).join(', ');
}

// "3 of 5" for the current stage, '' when there is none.
export function stageCount(p) {
  const at = (p.steps || []).findIndex((s) => s.state === 'current');
  return at >= 0 ? `${at + 1} of ${p.steps.length}` : '';
}
