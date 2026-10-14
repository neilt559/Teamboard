import 'server-only';
import { query, transaction } from '../db.js';
import { HttpError, bad, noNul, parseId, ymd } from '../http.js';
import { guardedPatch, norm } from '../patch.js';
import { SUBMITTAL_STATUS_KEYS, expectedResponse, isHhmm } from '../projects.js';

// A6 project sections: submittals and upcoming meetings (design-amendments A6.2, A6.3, A6.5). Anyone who can
// see the project reads and writes them, like tasks; every statement carries tb_can_see_project($viewer,
// project) in the SAME statement, so a project you can't see behaves exactly like one that doesn't exist (404),
// and every write bumps projects.rev in the same statement. Soft delete only: { archived: true } (and back).
// The weekly reports read these tables through lib/queries/reports.js, which selects only report-safe columns.

const has = (o, k) => !!o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);
const idOrNull = (v) => (v == null ? null : String(v));
const iso = (v) => (v == null ? null : v instanceof Date ? v.toISOString() : String(v));
const notFoundProject = () => new HttpError(404, 'Project not found');

// 'YYYY-MM-DD' or null ('' and null clear it); anything else is a 400.
const dateOrNull = (v) => {
  if (v == null || v === '') return null;
  const d = ymd(String(v));
  if (!d) throw bad('Invalid date.');
  return d;
};

// ---------------------------------------------------------------------------------------------- submittals

const updatedByName = (a) =>
  `(SELECT COALESCE(NULLIF(x.display_name, ''), x.username) FROM users x WHERE x.id = ${a}.updated_by) AS updated_by_name`;

// Every column of a submittal plus who last changed it. Callers add WHERE ... tb_can_see_project(...).
export const SUBMITTAL_SELECT = `SELECT s.id, s.project_id, s.agency, s.title, s.status, s.target_date, s.received_date,
       s.reply_by_date, s.submitted_date, s.approved_date, s.review_days, s.note, s.position, s.archived,
       s.created_at, s.created_by, s.updated_at, s.updated_by, ${updatedByName('s')}
FROM project_submittals s`;

// Normalizers (design §7.1): agency and title are single-line (trimmed), note multi-line (capped only).
export const SUBMITTAL_NORM = {
  agency: norm.line(200),
  title: norm.line(300),
  note: norm.text(2000),
  status: (v) => {
    const s = v == null || v === '' ? 'not_submitted' : v;
    if (typeof s !== 'string' || !SUBMITTAL_STATUS_KEYS.includes(s)) throw bad('Unknown submittal status.');
    return s;
  },
  target_date: dateOrNull,
  received_date: dateOrNull,
  reply_by_date: dateOrNull,
  submitted_date: dateOrNull,
  approved_date: dateOrNull,
  review_days: (v) => {
    if (v == null || v === '') return null;
    const n = typeof v === 'number' ? v : /^[0-9]{1,3}$/.test(String(v).trim()) ? Number(String(v).trim()) : NaN;
    if (!Number.isInteger(n) || n < 1 || n > 365) throw bad('The review period is 1 to 365 days.');
    return n;
  },
};
const SUBMITTAL_TEXT = ['agency', 'title', 'note'];

// PATCH whitelist (lib/patch.js guardedPatch): text fields are base-compared, the rest last-write-wins. Changing
// the status keeps the other dates (history); the UI and the reports show the ones that match the status.
const SUBMITTAL_COLUMNS = {
  agency: { type: 'text', text: true, norm: SUBMITTAL_NORM.agency },
  title: { type: 'text', text: true, norm: SUBMITTAL_NORM.title },
  note: { type: 'text', text: true, norm: SUBMITTAL_NORM.note },
  status: { type: 'text', norm: SUBMITTAL_NORM.status },
  target_date: { type: 'text', norm: dateOrNull },
  received_date: { type: 'text', norm: dateOrNull },
  reply_by_date: { type: 'text', norm: dateOrNull },
  submitted_date: { type: 'text', norm: dateOrNull },
  approved_date: { type: 'text', norm: dateOrNull },
  review_days: { type: 'integer', norm: SUBMITTAL_NORM.review_days },
  archived: { type: 'boolean', norm: (v) => !!v },
  position: { type: 'float8', norm: (v) => Number(v) },
};

// The row as clients get it: ids as strings, review_days a number (or null), plus expected_response
// (submitted_date + review_days, for Under review; null until both are set).
export function shapeSubmittal(r) {
  if (!r) return r;
  const s = {
    id: String(r.id), project_id: String(r.project_id), agency: r.agency || '', title: r.title || '',
    status: SUBMITTAL_STATUS_KEYS.includes(r.status) ? r.status : 'not_submitted',
    target_date: r.target_date || null, received_date: r.received_date || null, reply_by_date: r.reply_by_date || null,
    submitted_date: r.submitted_date || null, approved_date: r.approved_date || null,
    review_days: r.review_days == null ? null : Number(r.review_days),
    note: r.note || '', position: Number(r.position) || 0, archived: !!r.archived,
    created_at: iso(r.created_at), created_by: idOrNull(r.created_by),
    updated_at: iso(r.updated_at), updated_by: idOrNull(r.updated_by), updated_by_name: r.updated_by_name || null,
  };
  s.expected_response = expectedResponse(s);
  return s;
}

// GET /api/projects/:id/submittals -> every submittal (archived included, flagged), in board order; null when
// the project is hidden or missing.
export async function listSubmittals(viewer, projectId) {
  const uid = String(viewer.id);
  const pid = parseId(projectId);
  const [vis, rows] = (await transaction([
    query(`SELECT tb_can_see_project($1::bigint, $2::bigint) AS ok`, [uid, pid]),
    query(`${SUBMITTAL_SELECT}
           WHERE s.project_id = $2::bigint AND tb_can_see_project($1::bigint, $2::bigint)
           ORDER BY s.position ASC, s.id ASC`, [uid, pid]),
  ], { readOnly: true })).map((r) => r.rows);
  if (!vis[0]?.ok) return null;
  return rows.map(shapeSubmittal);
}

// POST /api/projects/:id/submittals {agency, title, status?, the dates?, review_days?, note?}: a new submittal at
// the end (blank text is allowed, as for a new task; the reports skip a submittal with neither agency nor title).
export async function createSubmittal(viewer, projectId, b) {
  const pid = parseId(projectId);
  for (const k of SUBMITTAL_TEXT) noNul(b[k]);
  const v = {};
  for (const k of Object.keys(SUBMITTAL_NORM)) v[k] = SUBMITTAL_NORM[k](b[k]);
  const r = await query(
    `WITH ins AS (INSERT INTO project_submittals (project_id, agency, title, status, target_date, received_date,
                    reply_by_date, submitted_date, approved_date, review_days, note, position, created_by, updated_at, updated_by)
                  SELECT p.id, $3::text, $4::text, $5::text, $6::text, $7::text, $8::text, $9::text, $10::text,
                         $11::integer, $12::text, $13::float8, $2::bigint, now(), $2::bigint
                  FROM projects p
                  WHERE p.id = $1::bigint AND tb_can_see_project($2::bigint, p.id)
                  RETURNING *),
     pr AS (UPDATE projects SET rev = rev + 1 WHERE id = (SELECT project_id FROM ins))
     SELECT ins.*, ${updatedByName('ins')} FROM ins`,
    [pid, String(viewer.id), v.agency, v.title, v.status, v.target_date, v.received_date, v.reply_by_date,
      v.submitted_date, v.approved_date, v.review_days, v.note, Date.now()]);
  if (!r.rows[0]) throw notFoundProject();
  return shapeSubmittal(r.rows[0]);
}

// PATCH /api/projects/:id/submittals/:submittalId: the fields sent (text with base), { archived } to archive or
// restore, { position } to reorder. 404 'gone' when it isn't in this project or the project can't be seen.
export async function patchSubmittal({ viewer, projectId, id, body, now }) {
  const pid = parseId(projectId);
  for (const k of SUBMITTAL_TEXT) if (has(body, k)) noNul(body[k]);
  if (has(body, 'position') && (body.position === null || body.position === '' || !Number.isFinite(Number(body.position)))) throw bad();
  const { row } = await guardedPatch({
    table: 'project_submittals', id: parseId(id), body, columns: SUBMITTAL_COLUMNS, actorId: viewer.id,
    scopeSql: 'project_id = $2::bigint AND tb_can_see_project($1::bigint, project_id)',
    scopeParams: [String(viewer.id), pid], bumpProjectRev: true, now,
  });
  return shapeSubmittal(row);
}

// ------------------------------------------------------------------------------------------ upcoming meetings

// Every column of an upcoming meeting plus who last changed it. Callers add WHERE ... tb_can_see_project(...).
export const UPCOMING_SELECT = `SELECT m.id, m.project_id, m.meeting_date, m.meeting_time, m.title, m.location, m.archived,
       m.created_at, m.created_by, m.updated_at, m.updated_by, ${updatedByName('m')}
FROM project_upcoming_meetings m`;

export const UPCOMING_NORM = {
  meeting_date: (v) => {
    const d = typeof v === 'string' ? ymd(v) : null;
    if (!d) throw bad('Pick the meeting date.');
    return d;
  },
  meeting_time: (v) => {
    if (v == null || v === '') return null;
    if (!isHhmm(v)) throw bad('Invalid time (use HH:MM).');
    return v;
  },
  title: norm.line(300),
  location: norm.line(300),
};
const UPCOMING_COLUMNS = {
  meeting_date: { type: 'text', norm: UPCOMING_NORM.meeting_date },
  meeting_time: { type: 'text', norm: UPCOMING_NORM.meeting_time },
  title: { type: 'text', text: true, norm: UPCOMING_NORM.title },
  location: { type: 'text', text: true, norm: UPCOMING_NORM.location },
  archived: { type: 'boolean', norm: (v) => !!v },
};
const UPCOMING_TEXT = ['title', 'location'];
const NEEDS_TITLE = 'Say what the meeting is (and with whom).';

// The row as clients get it, plus past (meeting_date before today, Central; past ones are hidden by default).
export function shapeUpcoming(r, today) {
  if (!r) return r;
  return {
    id: String(r.id), project_id: String(r.project_id), meeting_date: r.meeting_date, meeting_time: r.meeting_time || null,
    title: r.title || '', location: r.location || '', archived: !!r.archived,
    past: !!today && String(r.meeting_date) < today,
    created_at: iso(r.created_at), created_by: idOrNull(r.created_by),
    updated_at: iso(r.updated_at), updated_by: idOrNull(r.updated_by), updated_by_name: r.updated_by_name || null,
  };
}

// GET /api/projects/:id/upcoming-meetings -> every one (archived and past included, flagged), by date and time;
// null when the project is hidden or missing.
export async function listUpcoming(viewer, projectId, today) {
  const uid = String(viewer.id);
  const pid = parseId(projectId);
  const [vis, rows] = (await transaction([
    query(`SELECT tb_can_see_project($1::bigint, $2::bigint) AS ok`, [uid, pid]),
    query(`${UPCOMING_SELECT}
           WHERE m.project_id = $2::bigint AND tb_can_see_project($1::bigint, $2::bigint)
           ORDER BY m.meeting_date ASC, m.meeting_time ASC NULLS FIRST, m.id ASC`, [uid, pid]),
  ], { readOnly: true })).map((r) => r.rows);
  if (!vis[0]?.ok) return null;
  return rows.map((m) => shapeUpcoming(m, today));
}

// POST /api/projects/:id/upcoming-meetings {meeting_date, meeting_time?, title, location?}.
export async function createUpcoming(viewer, projectId, b, today) {
  const pid = parseId(projectId);
  for (const k of UPCOMING_TEXT) noNul(b[k]);
  const v = {};
  for (const k of Object.keys(UPCOMING_NORM)) v[k] = UPCOMING_NORM[k](b[k]);
  if (!v.title) throw bad(NEEDS_TITLE);
  const r = await query(
    `WITH ins AS (INSERT INTO project_upcoming_meetings (project_id, meeting_date, meeting_time, title, location,
                    created_by, updated_at, updated_by)
                  SELECT p.id, $3::text, $4::text, $5::text, $6::text, $2::bigint, now(), $2::bigint
                  FROM projects p
                  WHERE p.id = $1::bigint AND tb_can_see_project($2::bigint, p.id)
                  RETURNING *),
     pr AS (UPDATE projects SET rev = rev + 1 WHERE id = (SELECT project_id FROM ins))
     SELECT ins.*, ${updatedByName('ins')} FROM ins`,
    [pid, String(viewer.id), v.meeting_date, v.meeting_time, v.title, v.location]);
  if (!r.rows[0]) throw notFoundProject();
  return shapeUpcoming(r.rows[0], today);
}

// PATCH /api/projects/:id/upcoming-meetings/:meetingId: date, time, title (+base, non-empty), location (+base),
// { archived }. 404 'gone' when it isn't in this project or the project can't be seen.
export async function patchUpcoming({ viewer, projectId, id, body, now, today }) {
  const pid = parseId(projectId);
  for (const k of UPCOMING_TEXT) if (has(body, k)) noNul(body[k]);
  if (has(body, 'title') && !UPCOMING_NORM.title(body.title)) throw bad(NEEDS_TITLE);
  const { row } = await guardedPatch({
    table: 'project_upcoming_meetings', id: parseId(id), body, columns: UPCOMING_COLUMNS, actorId: viewer.id,
    scopeSql: 'project_id = $2::bigint AND tb_can_see_project($1::bigint, project_id)',
    scopeParams: [String(viewer.id), pid], bumpProjectRev: true, now,
  });
  return shapeUpcoming(row, today);
}
