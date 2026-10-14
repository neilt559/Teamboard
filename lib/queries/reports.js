import 'server-only';
import * as React from 'react';
import { query, transaction } from '../db.js';
import { tagUpdating } from '../viewer.js';
import { ownerKey, parseStages, projectTitle, scheduleOf, stageLabel, stageSteps, submittalDates, submittalStatusOf } from '../projects.js';
import { chicagoToday } from '../time.js';

// Weekly owner reports (design-amendments A6.6, A6.7). What goes out to owners is built ONLY from these
// report-safe columns: the project's number, name, owner, jurisdiction, stages, current stage, schedule status
// and Status Report (projects.notes); its submittals (to, what, status and the dates that match the status; never
// the internal note); its upcoming meetings (date, time, what / with whom, where; today and later). Never tasks,
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
       p.schedule_status,
       CASE WHEN p.status_report_reviewed_at IS NOT NULL THEN p.notes ELSE '' END AS notes,
       (p.status_report_reviewed_at IS NULL AND COALESCE(p.notes, '') ~ '[^[:space:]]') AS status_report_pending`;
const SUBMITTAL_COLS = `s.id, s.project_id, s.agency, s.title, s.status, s.target_date, s.received_date, s.reply_by_date,
       s.submitted_date, s.approved_date, s.review_days, s.position`;
const MEETING_COLS = `m.id, m.project_id, m.meeting_date, m.meeting_time, m.title, m.location`;

// Active = not archived, in a team and an office that aren't archived (A6.7).
const ACTIVE = `NOT p.archived AND NOT t.archived AND NOT o.archived`;

const byTitle = (a, b) => a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' });

// One submittal as a report shows it: the dates that match its status only (Under review adds the expected
// response date). Archived ones and ones with neither agency nor title never reach a report.
function reportSubmittal(r) {
  const s = {
    status: r.status, target_date: r.target_date, received_date: r.received_date, reply_by_date: r.reply_by_date,
    submitted_date: r.submitted_date, approved_date: r.approved_date, review_days: r.review_days == null ? null : Number(r.review_days),
  };
  const st = submittalStatusOf(r.status);
  return {
    id: String(r.id), agency: r.agency || '', title: r.title || '', status: st.key, status_label: st.label, status_color: st.color,
    dates: submittalDates(s).map((d) => ({ ...d, value: d.value === '' || d.value == null ? '' : String(d.value) })),
  };
}

const reportMeeting = (r) => ({
  id: String(r.id), meeting_date: r.meeting_date, meeting_time: r.meeting_time || '', title: r.title || '', location: r.location || '',
});

// One project's report: { id, title, project_number, name, owner_company, jurisdiction, stages, current_stage,
// current_stage_label, steps, schedule_status, schedule, status_report, status_report_pending, submittals, meetings }.
// status_report is '' while status_report_pending (pre-A6 text nobody has reviewed for owners yet); the flag is for
// the screen-only notice of the report pages, never printed or copied.
function reportProject(p, subs, meets) {
  const stages = parseStages(p.stages);
  return {
    id: String(p.id),
    title: projectTitle(p),
    project_number: p.project_number || '',
    name: p.name || '',
    owner_company: p.owner_company || '',
    jurisdiction: p.jurisdiction || '',
    stages,
    current_stage: stages.includes(p.current_stage) ? p.current_stage : '',
    current_stage_label: stages.includes(p.current_stage) ? stageLabel(p.current_stage) : '',
    steps: stageSteps(stages, p.current_stage),
    schedule_status: scheduleOf(p.schedule_status) ? p.schedule_status : '',
    schedule: scheduleOf(p.schedule_status),
    status_report: p.status_report_pending ? '' : (p.notes || ''),
    status_report_pending: !!p.status_report_pending,
    submittals: subs.filter((s) => String(s.project_id) === String(p.id) && (s.agency || s.title)).map(reportSubmittal),
    meetings: meets.filter((m) => String(m.project_id) === String(p.id)).map(reportMeeting),
  };
}

// The submittals (not archived) and upcoming meetings (not archived, today or later) of the given projects, in
// report order, each statement checking visibility again.
function sectionQueries(uid, ids, today) {
  return [
    query(`SELECT ${SUBMITTAL_COLS} FROM project_submittals s
           WHERE s.project_id = ANY($2::bigint[]) AND NOT s.archived AND tb_can_see_project($1::bigint, s.project_id)
           ORDER BY s.project_id ASC, s.position ASC, s.id ASC`, [uid, ids]),
    query(`SELECT ${MEETING_COLS} FROM project_upcoming_meetings m
           WHERE m.project_id = ANY($2::bigint[]) AND NOT m.archived AND m.meeting_date >= $3::text
             AND tb_can_see_project($1::bigint, m.project_id)
           ORDER BY m.meeting_date ASC, m.meeting_time ASC NULLS FIRST, m.id ASC`, [uid, ids, today]),
  ];
}

// /projects/[id]/report: { report_date ('YYYY-MM-DD', Central), project: <report> }, or null when the project is
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
  const [projects, subs, meets] = res.map((r) => r.rows);
  if (!projects[0]) return null;
  return { report_date: today, project: reportProject(projects[0], subs, meets) };
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
    const { submittals, meetings, status_report: _s, steps: _t, ...rest } = reportProject(p, [], []);
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

// /reports/owner?name=<owner>: { report_date, key, owner, projects: [<report>, ...] } for every active project
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
  try {
    rows = (await activeProjects(uid)).filter((p) => ownerKey(p.owner_company) === key);
    if (rows.length) {
      const res = await transaction(sectionQueries(uid, rows.map((p) => String(p.id)), today), { readOnly: true });
      [subs, meets] = res.map((r) => r.rows);
    }
  } catch (e) {
    throw tagUpdating(e);
  }
  return {
    report_date: today,
    key,
    owner: rows.length ? ownerLabel(rows) : String(name).trim().replace(/\s+/g, ' '),
    projects: rows.map((p) => reportProject(p, subs, meets)).sort(byTitle),
  };
});
