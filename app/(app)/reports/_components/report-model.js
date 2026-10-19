import { fmtMonthDay, fmtShort } from '@/app/_ui/project-format';
import { parseNotes } from '@/app/notes-parse';

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

// The Status Report as label / content rows (the report's left and right columns): each header starts a row and
// labels it; paragraphs and bullets under it are its content. Text before the first header is a row with no label;
// a paragraph after bullets starts a new unlabeled row so the order reads as written.
//   -> [{ head: '' | 'Site & grading', paras: ['...'], bullets: [{ text, level }] }]
export function proseRows(text) {
  const rows = [];
  let row = null;
  const open = (head = '') => { row = { head, paras: [], bullets: [] }; rows.push(row); return row; };
  for (const b of parseNotes(text)) {
    if (b.type === 'gap') continue;
    if (b.type === 'title' || b.type === 'header') { open(b.text); continue; }
    if (b.type === 'bullet') { (row || open()).bullets.push({ text: b.text, level: b.level || 0 }); continue; }
    if (!row || row.bullets.length) open();
    row.paras.push(b.text);
  }
  return rows;
}

// A submittal's next step as a sentence: "Response expected Nov 5." / "Our reply due Oct 22." ('' when none).
export function nextLine(s, ref) {
  if (!s.next) return '';
  const label = String(s.next_label || 'next');
  return `${label.charAt(0).toUpperCase()}${label.slice(1)} ${fmtShort(s.next, ref)}.`;
}

// 'YYYY-MM-DD' -> 'Wednesday, October 14, 2026' (the report's date line).
export function longDate(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ''));
  if (!m) return String(ymd || '');
  return new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))));
}
