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
