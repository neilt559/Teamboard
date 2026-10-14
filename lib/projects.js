// Project structure (design-amendments A6): stages, schedule status, submittal statuses, and the one display
// helper for a project's title. Isomorphic and import-free (like lib/policy.js), so client components, route
// handlers and loaders share exactly the same rules. SQL lives in lib/queries; this file has none.

// ------------------------------------------------------------------------------------------------ stages

// Fixed order (A6.1). projects.stages stores the chosen keys as a JSON array in this order; current_stage is one
// of them ('' only on projects made before A6, until a manager picks their stages).
export const STAGES = [
  { key: 'concept', label: 'Concept', short: 'Concept' },
  { key: 'preliminary', label: 'Preliminary Engineering', short: 'Preliminary' },
  { key: 'final', label: 'Final Engineering', short: 'Final' },
  { key: 'bidding', label: 'Bidding', short: 'Bidding' },
  { key: 'construction', label: 'Construction', short: 'Construction' },
];
export const STAGE_KEYS = STAGES.map((s) => s.key);
export const stageOf = (key) => STAGES.find((s) => s.key === key) || null;
export const stageLabel = (key) => stageOf(key)?.label || '';

// The stored value (JSON text) or an array -> the known keys, deduplicated, in the fixed order. Anything
// unreadable is []. For display; writes validate with checkStages below.
export function parseStages(v) {
  let arr = v;
  if (typeof v === 'string') {
    try { arr = JSON.parse(v); } catch { arr = []; }
  }
  if (!Array.isArray(arr)) return [];
  const set = new Set(arr.map((x) => String(x)));
  return STAGE_KEYS.filter((k) => set.has(k));
}

// Validation for a write: an array of known keys (at least one). Returns { keys } in the fixed order, or
// { error } with the message the API answers (400).
export function checkStages(v) {
  if (!Array.isArray(v)) return { error: 'Pick the stages this project will go through.' };
  const keys = [];
  for (const x of v) {
    const k = typeof x === 'string' ? x : '';
    if (!STAGE_KEYS.includes(k)) return { error: 'Unknown stage.' };
    if (!keys.includes(k)) keys.push(k);
  }
  if (!keys.length) return { error: 'Pick at least one stage.' };
  return { keys: STAGE_KEYS.filter((k) => keys.includes(k)) };
}
export const stagesJson = (keys) => JSON.stringify(STAGE_KEYS.filter((k) => keys.includes(k)));

// The stepper: every chosen stage in order with done (before the current one), current, or upcoming.
export function stageSteps(stages, current) {
  const keys = parseStages(stages);
  const at = keys.indexOf(current);
  return keys.map((k, i) => ({
    key: k, label: stageLabel(k), short: stageOf(k).short,
    state: at < 0 ? 'upcoming' : i < at ? 'done' : i === at ? 'current' : 'upcoming',
  }));
}

// ------------------------------------------------------------------------------------------------ schedule

// '' = not set (the button shows nothing selected). Colors per A6.5: Ahead green, On track lime, Behind red.
export const SCHEDULE_STATUSES = [
  { key: 'ahead', label: 'Ahead', color: '#2fb344' },
  { key: 'on_track', label: 'On track', color: '#CBCE00' },
  { key: 'behind', label: 'Behind', color: '#c4483e' },
];
export const SCHEDULE_KEYS = ['', ...SCHEDULE_STATUSES.map((s) => s.key)];
export const scheduleOf = (key) => SCHEDULE_STATUSES.find((s) => s.key === key) || null;

// ------------------------------------------------------------------------------------------------ title

// The one way a project's title is shown (A6.1): pre-A6 names already start with their job number
// ("230021 - Randall Commons"), so those show as they are; a project with a separate number shows
// "230021 - Randall Commons"; no number -> the name. `name` is never changed by this.
export function projectTitle(p) {
  const name = String(p?.name ?? '').trim();
  const num = String(p?.project_number ?? '').trim();
  if (!num) return name;
  if (name.startsWith(num)) return name;
  return name ? `${num} - ${name}` : num;
}

// Owner companies group the weekly packets (A6.7). Spelling variants that differ only in case or spacing are
// one owner: this key is what /reports groups by and what /reports/owner?name= matches.
export const ownerKey = (s) => String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

// ------------------------------------------------------------------------------------------------ submittals

// Each status shows its own dates (A6.2/A6.5); changing the status keeps the other dates as history.
export const SUBMITTAL_STATUSES = [
  { key: 'not_submitted', label: 'Not yet submitted', color: '#8a8788', fields: ['target_date'] },
  { key: 'comments_received', label: 'Comments received', color: '#c77c02', fields: ['received_date', 'reply_by_date'] },
  { key: 'under_review', label: 'Under review', color: '#0086c0', fields: ['submitted_date', 'review_days'] },
  { key: 'approved', label: 'Approved', color: '#2fb344', fields: ['approved_date'] },
];
export const SUBMITTAL_STATUS_KEYS = SUBMITTAL_STATUSES.map((s) => s.key);
export const submittalStatusOf = (key) => SUBMITTAL_STATUSES.find((s) => s.key === key) || SUBMITTAL_STATUSES[0];
export const SUBMITTAL_DATE_FIELDS = ['target_date', 'received_date', 'reply_by_date', 'submitted_date', 'approved_date'];
export const SUBMITTAL_FIELD_LABELS = {
  target_date: 'Target date',
  received_date: 'Received',
  reply_by_date: 'Reply by',
  submitted_date: 'Submitted',
  review_days: 'Review period (days)',
  expected_response: 'Response expected',
  approved_date: 'Approved',
};

// 'YYYY-MM-DD' plus n days (UTC calendar math, so a DST change never shifts a day); null on bad input.
export function addDaysYmd(ymd, n) {
  if (typeof ymd !== 'string' || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(ymd) || !Number.isInteger(Number(n))) return null;
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + Number(n))).toISOString().slice(0, 10);
}

// Under review: the submitted date plus the review period (A6: "review period in days, with the expected
// response date shown"). null until both are set.
export const expectedResponse = (s) =>
  (s?.submitted_date && s?.review_days != null && s.review_days !== '' ? addDaysYmd(s.submitted_date, Number(s.review_days)) : null);

// The dates that match the submittal's status, in display order: [{ key, label, value }] (value '' when unset;
// review_days as a number of days). Under review adds expected_response.
export function submittalDates(s) {
  const st = submittalStatusOf(s?.status);
  const out = st.fields.map((f) => ({ key: f, label: SUBMITTAL_FIELD_LABELS[f], value: s?.[f] == null ? '' : s[f] }));
  if (st.key === 'under_review') {
    out.push({ key: 'expected_response', label: SUBMITTAL_FIELD_LABELS.expected_response, value: expectedResponse(s) || '' });
  }
  return out;
}

// 'HH:MM' (24 h) for upcoming meetings; '' or null = no time.
export const isHhmm = (v) => typeof v === 'string' && /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(v);

// ------------------------------------------------------------------------------------------ attention items

// A8: items we need from third parties. 'open' until Received (which stamps received_date); Re-open sets 'open'.
export const ATTENTION_STATUS_KEYS = ['open', 'received'];
export const ATTENTION_SOON_DAYS = 7;

// The need-by flag on today's Central date ('YYYY-MM-DD', lib/time.js chicagoToday): 'overdue' when the need-by
// date is before today, 'soon' when it is today or within the next 7 days, '' otherwise (or no date / no today).
export function attentionFlag(needBy, today) {
  if (typeof needBy !== 'string' || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(needBy)) return '';
  if (typeof today !== 'string' || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(today)) return '';
  if (needBy < today) return 'overdue';
  return needBy <= addDaysYmd(today, ATTENTION_SOON_DAYS) ? 'soon' : '';
}

// Open items in the order A8.3 lists them: dated first, oldest need-by first; undated last; then board order.
export function sortAttention(list) {
  return [...(list || [])].sort((a, b) => {
    const da = a.need_by || '';
    const db = b.need_by || '';
    if (da && db && da !== db) return da < db ? -1 : 1;
    if (!da !== !db) return da ? -1 : 1;
    return (Number(a.position) || 0) - (Number(b.position) || 0) || (Number(a.id) - Number(b.id));
  });
}

// Received items, newest received first (then newest id).
export const sortReceived = (list) => [...(list || [])].sort((a, b) =>
  String(b.received_date || '').localeCompare(String(a.received_date || '')) || (Number(b.id) - Number(a.id)));

// Whole days an open item is late on today's Central date (need-by before today), else 0. UTC calendar math.
export function attentionDaysLate(needBy, today) {
  if (attentionFlag(needBy, today) !== 'overdue') return 0;
  const [a, b] = [needBy, today].map((x) => { const [y, m, d] = x.split('-').map(Number); return Date.UTC(y, m - 1, d); });
  return Math.round((b - a) / 86400000);
}

// The owner report's ONE "Attention Items" list (A11, Neil 2026-10-14: no "From you / From others" split, no
// grouping): late items first, then by need-by date (oldest first), undated last; ties in board order.
export function reportAttentionOrder(list, today) {
  const late = (a) => attentionFlag(a.need_by, today) === 'overdue';
  const sorted = sortAttention(list);
  return [...sorted.filter(late), ...sorted.filter((a) => !late(a))];
}

// The From box's suggestions (A8.3): the project's owner company, "Owner", "Client", "Architect", "Surveyor", the
// jurisdiction, then values used before (on projects the viewer can see); case and spacing duplicates dropped.
export function attentionFromOptions(project, used = []) {
  const out = [];
  const seen = new Set();
  for (const v of [project?.owner_company, 'Owner', 'Client', 'Architect', 'Surveyor', project?.jurisdiction, ...(used || [])]) {
    const s = String(v ?? '').trim().replace(/\s+/g, ' ');
    const k = ownerKey(s);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

// ------------------------------------------------------------------------------------- A11 submittal & permit log

// Whose move it is while a submittal sits with the reviewer: the kind of agency for a "City of ..." / "Village of
// ..." / "... County" reviewer, a short agency name as it is ("MWRD", "IEPA"), else "Reviewer".
export function reviewerShort(agency) {
  const a = String(agency ?? '').trim().replace(/\s+/g, ' ');
  const m = /^(City|Village|Town|Township|County|State)\s+of\b/i.exec(a);
  if (m) return m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();
  if (/\bCounty\b/i.test(a)) return 'County';
  if (a && a.length <= 16) return a;
  return 'Reviewer';
}

// One submittal as a line of the owner report's log (design-amendments A11): the next date and what it is, whose
// move it is (ball in court), the date that goes with the status, and closed (Approved: history, shown last and
// gray). Dates stay 'YYYY-MM-DD'; the renderers format them.
//   { next, next_label, ball, detail: { label, date, days } | null, closed }
export function submittalLog(s) {
  const st = submittalStatusOf(s?.status).key;
  const days = s?.review_days == null || s.review_days === '' ? null : Number(s.review_days);
  if (st === 'comments_received') {
    return { next: s.reply_by_date || '', next_label: 'our reply due', ball: 'CAGE',
      detail: s.received_date ? { label: 'Received', date: s.received_date, days: null } : null, closed: false };
  }
  if (st === 'under_review') {
    return { next: expectedResponse(s) || '', next_label: 'response expected', ball: reviewerShort(s.agency),
      detail: s.submitted_date || days ? { label: 'Submitted', date: s.submitted_date || '', days } : null, closed: false };
  }
  if (st === 'approved') {
    return { next: '', next_label: '', ball: '', detail: s.approved_date ? { label: '', date: s.approved_date, days: null } : null, closed: true };
  }
  return { next: s?.target_date || '', next_label: 'target to submit', ball: 'CAGE', detail: null, closed: false };
}

// The log's order: open submittals by next date (oldest first; ones without a next date after the dated ones), then
// the closed ones (newest approval first); ties in board order. Each row needs its submittalLog() fields merged in.
export function submittalLogOrder(rows) {
  const pos = (a, b) => (Number(a.position) || 0) - (Number(b.position) || 0) || (Number(a.id) - Number(b.id));
  return [...(rows || [])].sort((a, b) => {
    if (a.closed !== b.closed) return a.closed ? 1 : -1;
    if (a.closed) {
      const da = a.detail?.date || '';
      const db = b.detail?.date || '';
      if (da !== db) return da > db ? -1 : 1;
      return pos(a, b);
    }
    if (!a.next !== !b.next) return a.next ? -1 : 1;
    if (a.next !== b.next) return a.next < b.next ? -1 : 1;
    return pos(a, b);
  });
}

// The Status Report's own title: the first "%t" line when it is the first non-empty line (Neil's notes start with
// "%t Week of October 12"); '' otherwise. The report uses it as the notes' heading and drops that line from the text.
export function statusReportTitle(notes) {
  const lines = String(notes ?? '').split('\n');
  const first = lines.find((l) => l.trim());
  const m = first ? /^\s*%t\s?(.*)$/i.exec(first) : null;
  return m ? m[1].trim() : '';
}
export function statusReportBody(notes) {
  const text = String(notes ?? '');
  if (!statusReportTitle(text)) return text;
  const lines = text.split('\n');
  const i = lines.findIndex((l) => l.trim());
  return lines.slice(i + 1).join('\n').replace(/^\s*\n/, '');
}

// The Monday of the week of a 'YYYY-MM-DD' date ('' on bad input): "Week of October 12".
export function mondayOf(ymd) {
  if (typeof ymd !== 'string' || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(ymd)) return '';
  const [y, m, d] = ymd.split('-').map(Number);
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return addDaysYmd(ymd, -((day + 6) % 7));
}
