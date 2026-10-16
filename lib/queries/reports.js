import 'server-only';
import * as React from 'react';
import { query, transaction } from '../db.js';
import { tagUpdating } from '../viewer.js';
import { attentionDaysLate, mondayOf, normReportLink, ownerKey, parseStages, projectTitle, reportAttentionOrder, scheduleOf, stageLabel, stageSteps,
  statusReportBody, statusReportTitle, submittalDates, submittalLog, submittalLogOrder, submittalStatusOf } from '../projects.js';
import { chicagoToday } from '../time.js';

// Weekly owner reports (design-amendments A6.6, A6.7). What goes out to owners is built ONLY from these
// report-safe columns: the project's number, name, owner, jurisdiction, stages, current stage, schedule status
// and Status Report (projects.notes); its submittals (to, what, status, the dates that match the status, and the
// note: A11 made it the owner report log's "Notes" column, so the project page says it goes to the owner); its
// upcoming meetings (A9: the project meetings dated today or later, not archived: date, time, what / with whom,
// where; never their minutes, attendance or series); its OPEN attention
// items (A8: what, from whom, need by; never received or archived ones, never the internal note). Never tasks,
// subtasks, task notes, members, project info rows, minutes, team or office internals, or who edited what.
// Every query filters through tb_can_see_project / tb_visible_project_ids in SQL, so a project the viewer can't
// see is the same as one that doesn't exist.
const cache = typeof React.cache === 'function' ? React.cache : (fn) => fn;
const ID = /^[0-9]{1,18}$/;

// The ONLY columns a report reads. Keep them explicit: no p.*, no joins to tasks, members, info or minutes.
// The Status Report text leaves the database only once it has been reviewed for owners: a pre-A6 project's notes
// were written as internal notes (staff names, internal reviews, remarks), so until someone reviews them on the
// project page ("Use in reports", or empties them; lib/schema/projects-ext.js status_report_reviewed_at) the report
// gets '' ("No status report this week.") plus a flag that the text waits for a review (shown on screen only).
const PROJECT_COLS = `p.id, p.project_number, p.name, p.owner_company, p.jurisdiction, p.stages, p.current_stage,
       p.schedule_status, p.report_link,
       CASE WHEN p.status_report_reviewed_at IS NOT NULL THEN p.notes ELSE '' END AS notes,
       (p.status_report_reviewed_at IS NULL AND COALESCE(p.notes, '') ~ '[^[:space:]]') AS status_report_pending`;
const SUBMITTAL_COLS = `s.id, s.project_id, s.agency, s.title, s.status, s.target_date, s.received_date, s.reply_by_date,
       s.submitted_date, s.approved_date, s.review_days, s.note, s.position`;
// A9: project_meetings holds the minutes too (attendance, notes) and the series; only these columns are ever read.
const MEETING_COLS = `m.id, m.project_id, m.meeting_date, m.meeting_time, m.title, m.location`;
const ATTENTION_COLS = `a.id, a.project_id, a.item, a.from_party, a.need_by, a.position`;

// Active = not archived, in a team and an office that aren't archived (A6.7).
const ACTIVE = `NOT p.archived AND NOT t.archived AND NOT o.archived`;

const byTitle = (a, b) => a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' });

// One submittal as a report shows it: the dates that match its status only (Under review adds the expected
// response date), its note (A11 "Notes" column) and its log line (lib/projects.js submittalLog: next date, ball in
// court, the status's date, closed). Archived ones and ones with neither agency nor title never reach a report.
function reportSubmittal(r) {
  const s = {
    status: r.status, target_date: r.target_date, received_date: r.received_date, reply_by_date: r.reply_by_date,
    submitted_date: r.submitted_date, approved_date: r.approved_date, review_days: r.review_days == null ? null : Number(r.review_days),
    agency: r.agency || '',
  };
  const st = submittalStatusOf(r.status);
  return {
    id: String(r.id), agency: r.agency || '', title: r.title || '', status: st.key, status_label: st.label, status_color: st.color,
    note: String(r.note || '').trim(), position: Number(r.position) || 0,
    dates: submittalDates(s).map((d) => ({ ...d, value: d.value === '' || d.value == null ? '' : String(d.value) })),
    ...submittalLog(s),
  };
}

// One open attention item as a report shows it (A8.4, A11): what, from whom, need by; late = need-by before today
// (Central) and days_late how many days (the A11 sheet's "N days late" and its revision cloud).
const reportAttention = (r, today) => {
  const days = attentionDaysLate(r.need_by, today);
  return { id: String(r.id), item: r.item || '', from_party: r.from_party || '', need_by: r.need_by || '', late: days > 0, days_late: days };
};

const reportMeeting = (r) => ({
  id: String(r.id), meeting_date: r.meeting_date, meeting_time: r.meeting_time || '', title: r.title || '', location: r.location || '',
});

// One project's report: { id, title, project_number, name, owner_company, jurisdiction, stages, current_stage,
// current_stage_label, steps, schedule_status, schedule, status_report, status_title, status_body, week_of,
// status_report_pending, submittals (in log order: open by next date, closed last), meetings, attention }.
// status_title is the Status Report's own leading "%t" title (the A11 notes heading and the project page's "Week of"
// cell), status_body the text without it; week_of the Monday of the report week ('YYYY-MM-DD'). attention (A8, A11 "Attention Items"): ONE list of the open, non-archived items, late first, then by
// need-by date, undated last; no grouping (Neil 2026-10-14).
// status_report is '' while status_report_pending (pre-A6 text nobody has reviewed for owners yet); the flag is for
// the screen-only notice of the report pages, never printed or copied.
function reportProject(p, subs, meets, items = [], today = '') {
  const stages = parseStages(p.stages);
  const statusReport = p.status_report_pending ? '' : (p.notes || '');
  const open = reportAttentionOrder(items.filter((a) => String(a.project_id) === String(p.id) && String(a.item || '').trim()), today)
    .map((a) => reportAttention(a, today));
  return {
    id: String(p.id),
    title: projectTitle(p),
    project_number: p.project_number || '',
    name: p.name || '',
    owner_company: p.owner_company || '',
    jurisdiction: p.jurisdiction || '',
    // The Egnyte folder the owner can open (2026-10-15); re-checked here so only an http(s) address is ever a link.
    report_link: normReportLink(p.report_link) || '',
    stages,
    current_stage: stages.includes(p.current_stage) ? p.current_stage : '',
    current_stage_label: stages.includes(p.current_stage) ? stageLabel(p.current_stage) : '',
    steps: stageSteps(stages, p.current_stage),
    schedule_status: scheduleOf(p.schedule_status) ? p.schedule_status : '',
    schedule: scheduleOf(p.schedule_status),
    status_report: statusReport,
    status_title: statusReportTitle(statusReport),
    status_body: statusReportBody(statusReport),
    week_of: mondayOf(today),
    status_report_pending: !!p.status_report_pending,
    submittals: submittalLogOrder(subs.filter((s) => String(s.project_id) === String(p.id) && (s.agency || s.title)).map(reportSubmittal)),
    meetings: meets.filter((m) => String(m.project_id) === String(p.id)).map(reportMeeting),
    attention: open,
  };
}

// The submittals (not archived), upcoming meetings (not archived, today or later) and open attention items (not
// archived, status 'open') of the given projects, in report order, each statement checking visibility again.
function sectionQueries(uid, ids, today) {
  return [
    query(`SELECT ${SUBMITTAL_COLS} FROM project_submittals s
           WHERE s.project_id = ANY($2::bigint[]) AND NOT s.archived AND tb_can_see_project($1::bigint, s.project_id)
           ORDER BY s.project_id ASC, s.position ASC, s.id ASC`, [uid, ids]),
    query(`SELECT ${MEETING_COLS} FROM project_meetings m
           WHERE m.project_id = ANY($2::bigint[]) AND NOT m.archived AND m.meeting_date >= $3::text
             AND tb_can_see_project($1::bigint, m.project_id)
           ORDER BY m.meeting_date ASC, m.meeting_time ASC NULLS FIRST, m.id ASC`, [uid, ids, today]),
    query(`SELECT ${ATTENTION_COLS} FROM project_attention_items a
           WHERE a.project_id = ANY($2::bigint[]) AND NOT a.archived AND a.status = 'open'
             AND tb_can_see_project($1::bigint, a.project_id)
           ORDER BY a.project_id ASC, a.need_by ASC NULLS LAST, a.position ASC, a.id ASC`, [uid, ids]),
  ];
}

// The title block's "Prepared by" (A11): the viewer's full name (2026-10-16: what leaves the company; the display
// name, which may be a nickname, only when no full name is set), approved position and email. Only the viewer's
// own data; positions is a lookup table (no users read here).
async function preparedBy(viewer) {
  let position = '';
  if (viewer.approved_position_id && ID.test(String(viewer.approved_position_id))) {
    const r = await query(`SELECT name FROM positions WHERE id = $1::bigint`, [String(viewer.approved_position_id)]);
    position = r.rows[0]?.name || '';
  }
  return { name: String(viewer.full_name || '').trim() || viewer.name || viewer.username || '', position, email: viewer.email || '' };
}

// /projects/[id]/report: { report_date ('YYYY-MM-DD', Central), prepared_by, project: <report> }, or null when the project is
// missing or not visible (the page answers 404 for both). Any visible project, archived ones too.
export const loadProjectReport = cache(async (viewer, projectId, now) => {
  if (!ID.test(String(projectId))) return null;
  const uid = String(viewer.id);
  const pid = String(projectId);
  const today = chicagoToday(Number.isFinite(now) ? now : Date.now());
  let res;
  try {
    res = await transaction([
      query(`SELECT ${PROJECT_COLS} FROM projects p
             WHERE p.id = $2::bigint AND tb_can_see_project($1::bigint, p.id)`, [uid, pid]),
      ...sectionQueries(uid, [pid], today),
    ], { readOnly: true });
  } catch (e) {
    throw tagUpdating(e);
  }
  const [projects, subs, meets, items] = res.map((r) => r.rows);
  if (!projects[0]) return null;
  let by;
  try {
    by = await preparedBy(viewer);
  } catch (e) {
    throw tagUpdating(e);
  }
  return { report_date: today, prepared_by: by, project: reportProject(projects[0], subs, meets, items, today) };
});

// Every active project the viewer can see, report-safe columns only, by title.
async function activeProjects(uid) {
  const r = await query(`SELECT ${PROJECT_COLS} FROM projects p
                         JOIN teams t ON t.id = p.team_id JOIN offices o ON o.id = t.office_id
                         WHERE ${ACTIVE} AND p.id IN (SELECT tb_visible_project_ids($1::bigint))`, [uid]);
  return r.rows;
}

// The owner label for a set of spellings: the most used one (ties: alphabetical).
function ownerLabel(rows) {
  const n = new Map();
  for (const p of rows) n.set(p.owner_company.trim(), (n.get(p.owner_company.trim()) || 0) + 1);
  return [...n.entries()].sort((a, b) => (b[1] - a[1]) || (a[0] < b[0] ? -1 : 1))[0]?.[0] || '';
}

// /reports: { report_date, groups: [{ key, owner, projects: [...] }], no_owner: [...] }. Every active project the
// viewer can see (not archived, in an active team and office), grouped by owner company (spellings that differ
// only in case or spacing are one owner, lib/projects.js ownerKey), owners A-Z; projects without an owner sit in
// no_owner. Each project: { id, title, project_number, name, owner_company, jurisdiction, stages, current_stage,
// current_stage_label, schedule_status, schedule, status_report_pending }.
export const listReportGroups = cache(async (viewer, now) => {
  const today = chicagoToday(Number.isFinite(now) ? now : Date.now());
  let rows;
  try {
    rows = await activeProjects(String(viewer.id));
  } catch (e) {
    throw tagUpdating(e);
  }
  const brief = (p) => {
    const { submittals, meetings, status_report: _s, status_title: _st, status_body: _sb, week_of: _w, steps: _t, attention: _a, ...rest } = reportProject(p, [], []);
    return rest;
  };
  const groups = new Map();
  const noOwner = [];
  for (const p of rows) {
    const k = ownerKey(p.owner_company);
    if (!k) { noOwner.push(p); continue; }
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(p);
  }
  return {
    report_date: today,
    groups: [...groups.entries()]
      .map(([key, ps]) => ({ key, owner: ownerLabel(ps), projects: ps.map(brief).sort(byTitle) }))
      .sort((a, b) => a.owner.localeCompare(b.owner, undefined, { numeric: true, sensitivity: 'base' })),
    no_owner: noOwner.map(brief).sort(byTitle),
  };
});

// /reports/owner?name=<owner>: { report_date, prepared_by, key, owner, projects: [<report>, ...] } for every active project
// the viewer can see whose owner company matches (ownerKey), by title. A blank name is null; an owner with no
// such project gives projects: [] (the same answer whether or not invisible projects carry that owner).
export const loadOwnerPacket = cache(async (viewer, name, now) => {
  const key = ownerKey(name);
  if (!key) return null;
  const uid = String(viewer.id);
  const today = chicagoToday(Number.isFinite(now) ? now : Date.now());
  let rows;
  let subs = [];
  let meets = [];
  let items = [];
  let by;
  try {
    by = await preparedBy(viewer);
    rows = (await activeProjects(uid)).filter((p) => ownerKey(p.owner_company) === key);
    if (rows.length) {
      const res = await transaction(sectionQueries(uid, rows.map((p) => String(p.id)), today), { readOnly: true });
      [subs, meets, items] = res.map((r) => r.rows);
    }
  } catch (e) {
    throw tagUpdating(e);
  }
  return {
    report_date: today,
    prepared_by: by,
    key,
    owner: rows.length ? ownerLabel(rows) : String(name).trim().replace(/\s+/g, ' '),
    projects: rows.map((p) => reportProject(p, subs, meets, items, today)).sort(byTitle),
  };
});
