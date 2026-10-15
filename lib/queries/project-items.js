import 'server-only';
import { query, transaction } from '../db.js';
import { HttpError, bad, noNul, parseId, ymd } from '../http.js';
import { guardedPatch, norm } from '../patch.js';
import { ATTENTION_STATUS_KEYS, SUBMITTAL_STATUS_KEYS, attentionFlag, expectedResponse } from '../projects.js';

// A6 project sections: submittals (and, until A9, upcoming meetings) (design-amendments A6.2, A6.3, A6.5). Anyone who can
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
// A6's upcoming meetings were merged into the project meetings by A9 (design-amendments A9.1: one Meetings section;
// lib/schema/projects-ext.js step 7 copied them and archived the old rows). Their routes answer 410; the meetings
// live in lib/queries/project.js (createMeeting, MEETING_NORM) and the reports read the upcoming ones there.

// ------------------------------------------------------------------------------------------- attention items

// A8 (design-amendments A8.1-A8.3): what we need from third parties, who it's from, an optional need-by date.
// Same rules as submittals: anyone who can see the project adds, edits, marks received, re-opens and archives;
// tb_can_see_project in the same statement; every write bumps projects.rev; text edits are base-compared.

// Every column of an attention item plus who last changed it. Callers add WHERE ... tb_can_see_project(...).
export const ATTENTION_SELECT = `SELECT a.id, a.project_id, a.item, a.from_party, a.need_by, a.status, a.received_date, a.note,
       a.position, a.archived, a.created_at, a.created_by, a.updated_at, a.updated_by, ${updatedByName('a')}
FROM project_attention_items a`;

const NEEDS_ITEM = 'Say what is needed.';
export const ATTENTION_NORM = {
  item: norm.line(500),
  from_party: norm.line(200),
  note: norm.text(2000),
  need_by: dateOrNull,
  received_date: dateOrNull,
  status: (v) => {
    const s = v == null || v === '' ? 'open' : v;
    if (typeof s !== 'string' || !ATTENTION_STATUS_KEYS.includes(s)) throw bad('Unknown item status.');
    return s;
  },
};
const ATTENTION_TEXT = ['item', 'from_party', 'note'];
const ATTENTION_COLUMNS = {
  item: { type: 'text', text: true, norm: ATTENTION_NORM.item },
  from_party: { type: 'text', text: true, norm: ATTENTION_NORM.from_party },
  note: { type: 'text', text: true, norm: ATTENTION_NORM.note },
  need_by: { type: 'text', norm: dateOrNull },
  status: { type: 'text', norm: ATTENTION_NORM.status },
  received_date: { type: 'text', norm: dateOrNull },
  archived: { type: 'boolean', norm: (v) => !!v },
  position: { type: 'float8', norm: (v) => Number(v) },
};

// The row as clients get it, plus flag ('overdue' | 'soon' | '') for an open item on today's Central date.
export function shapeAttention(r, today) {
  if (!r) return r;
  const status = ATTENTION_STATUS_KEYS.includes(r.status) ? r.status : 'open';
  return {
    id: String(r.id), project_id: String(r.project_id), item: r.item || '', from_party: r.from_party || '',
    need_by: r.need_by || null, status, received_date: r.received_date || null, note: r.note || '',
    position: Number(r.position) || 0, archived: !!r.archived,
    flag: status === 'open' && !r.archived ? attentionFlag(r.need_by, today) : '',
    created_at: iso(r.created_at), created_by: idOrNull(r.created_by),
    updated_at: iso(r.updated_at), updated_by: idOrNull(r.updated_by), updated_by_name: r.updated_by_name || null,
  };
}

// The From suggestions used before on any project the viewer can see (A8.3), most used first; the page adds the
// project's owner, "Owner", "Client", "Architect", "Surveyor" and the jurisdiction (lib/projects.js).
export function attentionFromQuery(uid) {
  return query(`SELECT a.from_party AS v, count(*)::int AS n FROM project_attention_items a
                WHERE a.from_party <> '' AND a.project_id IN (SELECT tb_visible_project_ids($1::bigint))
                GROUP BY a.from_party ORDER BY count(*) DESC, a.from_party ASC LIMIT 60`, [uid]);
}

// GET /api/projects/:id/attention-items -> every item (archived and received included, flagged), open ones in
// need-by order; null when the project is hidden or missing.
export async function listAttention(viewer, projectId, today) {
  const uid = String(viewer.id);
  const pid = parseId(projectId);
  const [vis, rows] = (await transaction([
    query(`SELECT tb_can_see_project($1::bigint, $2::bigint) AS ok`, [uid, pid]),
    query(`${ATTENTION_SELECT}
           WHERE a.project_id = $2::bigint AND tb_can_see_project($1::bigint, $2::bigint)
           ORDER BY a.need_by ASC NULLS LAST, a.position ASC, a.id ASC`, [uid, pid]),
  ], { readOnly: true })).map((r) => r.rows);
  if (!vis[0]?.ok) return null;
  return rows.map((a) => shapeAttention(a, today));
}

// POST /api/projects/:id/attention-items {item, from_party?, need_by?, note?}: a new open item at the end.
export async function createAttention(viewer, projectId, b, today) {
  const pid = parseId(projectId);
  for (const k of ATTENTION_TEXT) noNul(b[k]);
  const v = {};
  for (const k of ['item', 'from_party', 'note', 'need_by']) v[k] = ATTENTION_NORM[k](b[k]);
  if (!v.item) throw bad(NEEDS_ITEM);
  const r = await query(
    `WITH ins AS (INSERT INTO project_attention_items (project_id, item, from_party, need_by, note, position,
                    created_by, updated_at, updated_by)
                  SELECT p.id, $3::text, $4::text, $5::text, $6::text, $7::float8, $2::bigint, now(), $2::bigint
                  FROM projects p
                  WHERE p.id = $1::bigint AND tb_can_see_project($2::bigint, p.id)
                  RETURNING *),
     pr AS (UPDATE projects SET rev = rev + 1 WHERE id = (SELECT project_id FROM ins))
     SELECT ins.*, ${updatedByName('ins')} FROM ins`,
    [pid, String(viewer.id), v.item, v.from_party, v.need_by, v.note, Date.now()]);
  if (!r.rows[0]) throw notFoundProject();
  return shapeAttention(r.rows[0], today);
}

// PATCH /api/projects/:id/attention-items/:itemId: item, from_party, note (+base); need_by; status ('received'
// stamps received_date = today, Central, unless the body sets it; 'open' re-opens and keeps the date as history);
// received_date (editable); { archived }; { position }. 404 'gone' when it isn't in this project or the project
// can't be seen.
export async function patchAttention({ viewer, projectId, id, body, now, today }) {
  const pid = parseId(projectId);
  const b = body && typeof body === 'object' && !Array.isArray(body) ? { ...body } : {};
  for (const k of ATTENTION_TEXT) if (has(b, k)) noNul(b[k]);
  if (has(b, 'item') && !ATTENTION_NORM.item(b.item)) throw bad(NEEDS_ITEM);
  if (has(b, 'position') && (b.position === null || b.position === '' || !Number.isFinite(Number(b.position)))) throw bad();
  let columns = ATTENTION_COLUMNS;
  if (has(b, 'status')) {
    const st = ATTENTION_NORM.status(b.status);
    if (st === 'received' && (!has(b, 'received_date') || b.received_date == null || b.received_date === '')) {
      // The stamp: today, unless the item is already received with a date (a repeated click or a retried request
      // never moves a date someone set by hand). The SET reads the row's old values (same statement).
      b.received_date = today;
      columns = { ...ATTENTION_COLUMNS, received_date: { ...ATTENTION_COLUMNS.received_date,
        expr: (ph) => `CASE WHEN status = 'received' AND received_date IS NOT NULL THEN received_date ELSE ${ph}::text END` } };
    }
  }
  // The received date can be changed but not emptied (a received item always says when it came in); re-opening
  // keeps it as history.
  if (has(b, 'received_date') && dateOrNull(b.received_date) == null && !(has(b, 'status') && b.status === 'open')) {
    throw bad('Pick the date it was received.');
  }
  const { row } = await guardedPatch({
    table: 'project_attention_items', id: parseId(id), body: b, columns, actorId: viewer.id,
    scopeSql: 'project_id = $2::bigint AND tb_can_see_project($1::bigint, project_id)',
    scopeParams: [String(viewer.id), pid], bumpProjectRev: true, now,
  });
  return shapeAttention(row, today);
}
