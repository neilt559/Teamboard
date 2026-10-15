import 'server-only';
import * as React from 'react';
import { query, transaction } from '../db.js';
import { HttpError, bad, gone, noNul, parseId } from '../http.js';
import { guardedPatch, norm } from '../patch.js';
import { isOrganizer } from '../policy.js';
import { tagUpdating } from '../viewer.js';
import { nowFromRequestContext } from '../clock.js';
import { withDefaults } from '../prefs.js';
import { chicagoToday, addDays } from '../time.js';
import { ROUNDS } from '../bracket.js';
import { listChallengesInRange } from './challenges.js';
import {
  DEFAULT_TZ, LIMITS, eventInstants, eventStatus, eventWhen, fmtDateRange, fmtMonth, isZone, monthGrid, monthOf,
  normalizeLink, parseMonth, parseTime, parseYmd, scheduleProblem, shiftMonth,
} from '../events.js';

// Culture events calendar: loaders and writes (design §10(b), §4.5, §8.2; agent K2).
// Every signed-in user reads every event (company-wide and every office's: events are company-public, design
// §4.6), so nothing here is filtered by office for ACCESS; the office chips only filter what is SHOWN (default:
// company + the viewer's offices + followed ones). Culture organizers and admins create, edit, cancel (still shown,
// struck through) and archive (hidden; organizers can restore). An archived event is the same 404 as a missing one
// for everyone else.
// Virtual items are merged in at read time and never stored (design §10(b)): running challenges as all-day range
// bars (lib/queries/challenges.js listChallengesInRange, K1) and auto brackets as Mon-Fri bars labeled with each
// day's round. The live manual bracket has no dates and never shows.
// BIGINT arrives as a string (rule 39): ids stay strings. Timestamps become ISO strings.

const cache = typeof React.cache === 'function' ? React.cache : (fn) => fn;
const READ = { readOnly: true, isolationLevel: 'RepeatableRead' };

const idOrNull = (v) => (v == null ? null : String(v));
const iso = (v) => { if (v == null) return null; const d = v instanceof Date ? v : new Date(v); return Number.isNaN(d.getTime()) ? null : d.toISOString(); };
const has = (o, k) => !!o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);
const NAME_SQL = (a) => `COALESCE(NULLIF(${a}.display_name, ''), ${a}.username)`;
const notFoundEvent = () => new HttpError(404, 'Event not found');

// The columns every list needs (no details: they can be long; the event page loads them).
const LIST_COLS = `e.id, e.title, e.location, e.office_id, o.name AS office_name, e.all_day, e.starts_on, e.ends_on,
       e.start_time, e.end_time, e.tz, e.starts_at, e.ends_at, e.cancelled_at, e.archived_at`;
export const EVENT_SELECT = `SELECT ${LIST_COLS}, e.details, e.link_url, e.created_by, e.created_at, e.updated_at, e.updated_by,
       (SELECT ${NAME_SQL('x')} FROM users x WHERE x.id = e.created_by) AS created_by_name,
       (SELECT ${NAME_SQL('x')} FROM users x WHERE x.id = e.updated_by) AS updated_by_name,
       e.cancelled_by, (SELECT ${NAME_SQL('x')} FROM users x WHERE x.id = e.cancelled_by) AS cancelled_by_name,
       e.archived_by
FROM culture_events e LEFT JOIN offices o ON o.id = e.office_id`;

// One event as plain JSON, with its display strings for the viewer's zone (viewerTz).
export function shapeEvent(r, viewerTz = DEFAULT_TZ) {
  if (!r) return null;
  const e = {
    id: String(r.id), title: r.title || '', location: r.location || '',
    office_id: idOrNull(r.office_id), office_name: r.office_name ?? null,
    all_day: r.all_day !== false, starts_on: r.starts_on, ends_on: r.ends_on,
    start_time: r.start_time ?? null, end_time: r.end_time ?? null, tz: r.tz || DEFAULT_TZ,
    starts_at: iso(r.starts_at), ends_at: iso(r.ends_at),
    cancelled: r.cancelled_at != null, cancelled_at: iso(r.cancelled_at),
    archived: r.archived_at != null, archived_at: iso(r.archived_at),
  };
  if (r.details !== undefined) {
    Object.assign(e, {
      details: r.details || '', link_url: r.link_url || '',
      created_by: idOrNull(r.created_by), created_by_name: r.created_by_name ?? null, created_at: iso(r.created_at),
      updated_at: iso(r.updated_at), updated_by: idOrNull(r.updated_by), updated_by_name: r.updated_by_name ?? null,
      cancelled_by: idOrNull(r.cancelled_by), cancelled_by_name: r.cancelled_by_name ?? null, archived_by: idOrNull(r.archived_by),
    });
  }
  e.when = eventWhen(e, viewerTz);
  e.href = `/culture/events/${e.id}`;
  return e;
}

// The offices a viewer sees by default: home and extra offices plus followed ones.
function myOfficeIds(viewer) {
  const prefs = withDefaults(viewer.prefs, { isAdmin: !!viewer.is_admin });
  return [...new Set([...(viewer.office_ids || []), ...(prefs.followed_office_ids || [])].map(String))];
}
const viewerTz = (viewer) => viewer?.tz || DEFAULT_TZ;

// The office filter (design §10(b) chips): 'mine' (the default: company + my offices + followed), 'company'
// (company-wide only), 'all' (every office) or one office id (company + that office). Unknown values mean 'mine'.
// -> { key, all, ids, office }
export function resolveFilter(viewer, raw, offices) {
  const v = typeof raw === 'string' ? raw : '';
  if (v === 'company') return { key: 'company', all: false, ids: [] };
  if (v === 'all') return { key: 'all', all: true, ids: [] };
  if (/^[0-9]{1,18}$/.test(v)) {
    const o = offices.find((x) => x.id === v);
    if (o) return { key: v, all: false, ids: [v], office: o };
  }
  return { key: 'mine', all: false, ids: myOfficeIds(viewer) };
}
const showOffice = (f, officeId) => officeId == null || f.all || f.ids.includes(String(officeId));

// Offices for the filter chips and the form (non-archived, plus any extra id asked for, e.g. an event's own).
async function officeRows(extraId = null) {
  const r = await query(`SELECT o.id, o.name, o.archived, COALESCE(o.tz, 'America/Chicago') AS tz FROM offices o
    WHERE NOT o.archived OR o.id = $1::bigint ORDER BY o.position ASC, o.id ASC`, [extraId == null ? null : String(extraId)]);
  return r.rows.map((o) => ({ id: String(o.id), name: o.name, archived: !!o.archived, tz: o.tz }));
}
export async function listEventOffices(extraId = null) {
  try {
    return await officeRows(extraId);
  } catch (e) {
    throw tagUpdating(e);
  }
}

// Auto brackets whose Mon-Fri week overlaps [from, to], as range items labeled per day with the round voted then.
function bracketItems(rows, from, to) {
  return rows.map((b) => {
    const starts_on = b.starts_on;
    const ends_on = addDays(starts_on, ROUNDS.length - 1);
    const days = {};
    ROUNDS.forEach((name, i) => { days[addDays(starts_on, i)] = name; });
    return { key: `b${b.id}`, kind: 'bracket', id: String(b.id), title: b.name || 'Bracket', starts_on, ends_on, all_day: true,
      start_time: null, days, href: `/culture/brackets/${b.id}`, deleted: false,
      range: fmtDateRange(starts_on, ends_on) };
  }).filter((x) => x.starts_on <= to && x.ends_on >= from);
}

// /culture/calendar and GET /api/culture/events: one month (Sunday-first grid) for a filter.
//   { month, label, prev, next, today, grid: { from, to, first, last, weeks }, filter: { key, label },
//     offices, events, challenges, brackets, archived (organizers only: this month's archived events), can_manage,
//     viewer_tz }
export async function listCalendar(viewer, { month = null, office = null, now = Date.now() } = {}) {
  try {
    const today = chicagoToday(now);
    const m = parseMonth(month) || monthOf(today);
    const grid = monthGrid(m);
    const offices = await officeRows();
    const f = resolveFilter(viewer, office, offices);
    const org = isOrganizer(viewer);
    const [events, brackets, archived] = (await transaction([
      query(`SELECT ${LIST_COLS} FROM culture_events e LEFT JOIN offices o ON o.id = e.office_id
             WHERE e.archived_at IS NULL AND e.starts_on <= $2::text AND e.ends_on >= $1::text
               AND (e.office_id IS NULL OR $3::boolean OR e.office_id = ANY($4::bigint[]))
             ORDER BY e.starts_on, e.start_time NULLS FIRST, e.id LIMIT 1000`, [grid.from, grid.to, f.all, f.ids]),
      // Auto brackets only (the live manual one has no dates). A bracket archived before it ever opened was called
      // off, so its week doesn't show; one archived after it ran is a past bracket and keeps its week.
      query(`SELECT b.id, b.name, b.starts_on FROM brackets b
             WHERE b.mode = 'auto' AND b.deleted_at IS NULL AND b.starts_on IS NOT NULL
               AND NOT (b.archived AND b.activated_at IS NULL)
               AND b.starts_on <= $2::text AND b.starts_on >= $1::text
             ORDER BY b.starts_on, b.id LIMIT 20`, [addDays(grid.from, -(ROUNDS.length - 1)), grid.to]),
      // Organizers: this month's archived events (any office), so they can be found and restored. Nothing for others.
      query(`SELECT ${LIST_COLS} FROM culture_events e LEFT JOIN offices o ON o.id = e.office_id
             WHERE $3::boolean AND e.archived_at IS NOT NULL AND e.starts_on <= $2::text AND e.ends_on >= $1::text
             ORDER BY e.starts_on, e.start_time NULLS FIRST, e.id LIMIT 200`, [grid.first, grid.last, org]),
    ], READ)).map((r) => r.rows);
    const challenges = (await listChallengesInRange(grid.from, grid.to)).filter((c) => showOffice(f, c.office_id))
      .map((c) => ({ ...c, key: `c${c.id}`, kind: 'challenge', all_day: true, start_time: null, range: fmtDateRange(c.starts_on, c.ends_on) }));
    const tz = viewerTz(viewer);
    const label = f.key === 'company' ? 'Company-wide only' : f.key === 'all' ? 'All offices'
      : f.office ? `Company + ${f.office.name}` : 'Company + my offices';
    return {
      month: m, label: fmtMonth(m), prev: shiftMonth(m, -1), next: shiftMonth(m, 1), today, this_month: monthOf(today),
      grid: { from: grid.from, to: grid.to, first: grid.first, last: grid.last, weeks: grid.weeks },
      filter: { key: f.key, label },
      offices: offices.filter((o) => !o.archived),
      events: events.map((r) => ({ ...shapeEvent(r, tz), key: `e${r.id}`, kind: 'event' })),
      challenges,
      brackets: bracketItems(brackets, grid.from, grid.to),
      archived: archived.map((r) => shapeEvent(r, tz)),
      can_manage: org,
      viewer_tz: tz,
    };
  } catch (e) {
    throw tagUpdating(e);
  }
}

// The Home and Culture cards: the next events for the viewer (company + my offices + followed), soonest first.
// Events that ended (all-day: before today; timed: past their end, or their start when they have no end and the
// day is over) are left out; cancelled ones stay (struck through) so nobody shows up for them.
//   { today, events: [...], more: boolean, can_manage }
export const loadUpcomingEvents = cache(async (viewer, now, limit = 5) => {
  try {
    const today = chicagoToday(now);
    const r = await query(`SELECT ${LIST_COLS} FROM culture_events e LEFT JOIN offices o ON o.id = e.office_id
      WHERE e.archived_at IS NULL AND e.ends_on >= $1::text AND e.starts_on <= $2::text
        AND (e.office_id IS NULL OR e.office_id = ANY($3::bigint[]))
      ORDER BY e.starts_on, e.start_time NULLS FIRST, e.id LIMIT 60`, [today, addDays(today, 120), myOfficeIds(viewer)]);
    const tz = viewerTz(viewer);
    const list = r.rows.map((x) => shapeEvent(x, tz))
      .filter((e) => eventStatus(e, today, now) !== 'past')
      .map((e) => ({ ...e, status: eventStatus(e, today, now) }));
    return { today, events: list.slice(0, limit), more: list.length > limit, can_manage: isOrganizer(viewer) };
  } catch (e) {
    throw tagUpdating(e);
  }
});

// /culture/events/[id] and GET /api/culture/events/:id. null when missing, or archived and the viewer isn't an
// organizer (the same answer).
export async function loadEvent(viewer, id) {
  if (!/^[0-9]{1,18}$/.test(String(id ?? ''))) return null;
  try {
    const r = await query(`${EVENT_SELECT} WHERE e.id = $1::bigint`, [String(id)]);
    const e = shapeEvent(r.rows[0], viewerTz(viewer));
    if (!e || (e.archived && !isOrganizer(viewer))) return null;
    return e;
  } catch (e) {
    throw tagUpdating(e);
  }
}
// The page and its generateMetadata share one load per request.
export const loadEventPage = cache((viewer, id) => loadEvent(viewer, id));

// Today (Central) for pages that need it (the test clock included).
export const todayCT = () => chicagoToday(nowFromRequestContext());

// ---------------------------------------------------------------- writes (organizers)

// Normalizers: single-line fields are trimmed, the details (notes markup) are only capped (design §7.1).
const NORM = {
  title: norm.line(LIMITS.title),
  details: norm.text(LIMITS.details),
  location: norm.line(LIMITS.location),
  link_url: norm.line(LIMITS.link_url),
};
const TEXT_FIELDS = ['title', 'details', 'location', 'link_url'];
const SCHEDULE_FIELDS = ['all_day', 'starts_on', 'ends_on', 'start_time', 'end_time', 'tz'];

function pickLink(v) {
  const s = normalizeLink(v);
  if (s == null) throw bad('The link must be a web address (https://…).');
  return s;
}
async function pickOffice(v) {
  if (v == null || v === '' || v === 'company') return null;
  const id = /^[0-9]{1,18}$/.test(String(v)) ? String(v) : null;
  if (!id) throw bad('Pick an office.');
  const r = await query(`SELECT id FROM offices WHERE id = $1::bigint AND NOT archived`, [id]);
  if (!r.rows[0]) throw bad('Pick an office.');
  return id;
}
async function officeTz(officeId) {
  if (officeId == null) return null;
  const r = await query(`SELECT tz FROM offices WHERE id = $1::bigint`, [String(officeId)]);
  return r.rows[0]?.tz || null;
}

// A complete, checked schedule from the body over a base (the current row on PATCH). Throws 400 with the
// first problem. -> { all_day, starts_on, ends_on, start_time, end_time, tz, starts_at, ends_at } (instants as ISO).
function pickSchedule(b, base) {
  const s = { ...base };
  if (has(b, 'all_day')) {
    if (typeof b.all_day !== 'boolean') throw bad('Say whether it’s an all-day event.');
    s.all_day = b.all_day;
  }
  for (const k of ['starts_on', 'ends_on']) {
    if (!has(b, k)) continue;
    const d = parseYmd(b[k]);
    if (!d) throw bad(k === 'starts_on' ? 'Pick the start date.' : 'Pick the end date.');
    s[k] = d;
  }
  if (has(b, 'starts_on') && !has(b, 'ends_on') && (!s.ends_on || s.ends_on < s.starts_on)) s.ends_on = s.starts_on;
  for (const k of ['start_time', 'end_time']) {
    if (!has(b, k)) continue;
    if (b[k] == null || b[k] === '') { s[k] = null; continue; }
    const t = parseTime(b[k]);
    if (!t) throw bad(k === 'start_time' ? 'Pick the start time.' : 'Pick a valid end time.');
    s[k] = t;
  }
  if (has(b, 'tz')) {
    if (!isZone(b.tz)) throw bad('Pick a time zone.');
    s.tz = b.tz;
  }
  if (s.all_day) { s.start_time = null; s.end_time = null; }
  if (!s.tz) s.tz = DEFAULT_TZ;
  const p = scheduleProblem(s);
  if (p) throw bad(p.message);
  const inst = eventInstants(s);
  return { ...s, starts_at: inst.starts_at == null ? null : new Date(inst.starts_at).toISOString(),
    ends_at: inst.ends_at == null ? null : new Date(inst.ends_at).toISOString() };
}

// POST /api/culture/events { title, details?, location?, link_url?, office_id?, all_day?, starts_on, ends_on?,
// start_time?, end_time?, tz? } -> the stored event. Organizers only (the route's handle() checks). An all-day event
// unless all_day is false; ends_on defaults to starts_on; tz defaults to the office's zone (company: Central).
export async function createEvent(viewer, b) {
  for (const k of TEXT_FIELDS) noNul(b[k]);
  const title = NORM.title(b.title);
  if (!title) throw bad('Give the event a title.');
  if (b.starts_on == null || b.starts_on === '') throw bad('Pick the start date.');
  const office_id = await pickOffice(b.office_id);
  const all_day = has(b, 'all_day') ? b.all_day : true;
  let tz = b.tz;                                               // checked by pickSchedule
  if (tz == null || tz === '') {
    const otz = await officeTz(office_id);
    tz = isZone(otz) ? otz : DEFAULT_TZ;
  }
  const s = pickSchedule({ ...b, all_day, tz }, { all_day: true, starts_on: null, ends_on: null, start_time: null,
    end_time: null, tz: DEFAULT_TZ });
  const v = {
    title, details: NORM.details(b.details), location: NORM.location(b.location), link_url: pickLink(b.link_url),
  };
  const r = await query(`INSERT INTO culture_events (title, details, location, link_url, office_id, all_day, starts_on, ends_on,
      start_time, end_time, tz, starts_at, ends_at, created_by)
    VALUES ($1, $2, $3, $4, $5::bigint, $6, $7, $8, $9, $10, $11, $12::timestamptz, $13::timestamptz, $14::bigint) RETURNING id`,
  [v.title, v.details, v.location, v.link_url, office_id, s.all_day, s.starts_on, s.ends_on, s.start_time, s.end_time, s.tz,
    s.starts_at, s.ends_at, String(viewer.id)]);
  return loadEvent(viewer, r.rows[0].id);
}

const EVENT_COLUMNS = {
  title: { type: 'text', text: true, norm: NORM.title },
  details: { type: 'text', text: true, norm: NORM.details },
  location: { type: 'text', text: true, norm: NORM.location },
  link_url: { type: 'text', text: true, norm: NORM.link_url },
  office_id: { type: 'bigint' },
  all_day: { type: 'boolean' },
  starts_on: { type: 'text' },
  ends_on: { type: 'text' },
  start_time: { type: 'text' },
  end_time: { type: 'text' },
  tz: { type: 'text' },
  starts_at: { type: 'timestamptz' },
  ends_at: { type: 'timestamptz' },
  // { cancelled: true } keeps the first cancel time and who did it; { cancelled: false } restores. The SET reads the
  // row's old values, so a repeated cancel never moves them.
  cancelled_at: { type: 'timestamptz', expr: (ph) => `CASE WHEN ${ph}::timestamptz IS NULL THEN NULL ELSE COALESCE(cancelled_at, now()) END` },
  cancelled_by: { type: 'bigint', expr: (ph) => `CASE WHEN ${ph}::bigint IS NULL THEN NULL WHEN cancelled_at IS NULL THEN ${ph}::bigint ELSE cancelled_by END` },
  archived_at: { type: 'timestamptz', expr: (ph) => `CASE WHEN ${ph}::timestamptz IS NULL THEN NULL ELSE COALESCE(archived_at, now()) END` },
  archived_by: { type: 'bigint', expr: (ph) => `CASE WHEN ${ph}::bigint IS NULL THEN NULL WHEN archived_at IS NULL THEN ${ph}::bigint ELSE archived_by END` },
};

const pickBool = (v) => { if (typeof v !== 'boolean') throw bad(); return v; };

// PATCH /api/culture/events/:id: any field (text ones with base, design §7.3); a schedule field re-checks and
// re-derives the whole schedule; { cancelled }, { archived }. Organizers only. 404 'gone' for a missing id.
export async function patchEvent(viewer, id, b, now) {
  const eid = parseId(id);
  const cur = (await query(`SELECT * FROM culture_events WHERE id = $1::bigint`, [eid])).rows[0];
  if (!cur) throw gone();
  const body = {};
  if (has(b, 'base')) body.base = b.base;
  for (const k of TEXT_FIELDS) {
    if (!has(b, k)) continue;
    noNul(b[k]);
    if (b.base && typeof b.base === 'object') noNul(b.base[k]);
    body[k] = k === 'link_url' ? pickLink(b[k]) : b[k];
  }
  if (has(body, 'title') && !NORM.title(body.title)) throw bad('Give the event a title.');
  if (has(b, 'office_id')) {
    const same = b.office_id != null && b.office_id !== '' && String(b.office_id) === String(cur.office_id);
    body.office_id = same ? String(cur.office_id) : await pickOffice(b.office_id);
  }
  if (SCHEDULE_FIELDS.some((k) => has(b, k))) {
    const s = pickSchedule(b, { all_day: cur.all_day !== false, starts_on: cur.starts_on, ends_on: cur.ends_on,
      start_time: cur.start_time ?? null, end_time: cur.end_time ?? null, tz: cur.tz || DEFAULT_TZ });
    for (const k of [...SCHEDULE_FIELDS, 'starts_at', 'ends_at']) body[k] = s[k];
  }
  const uid = String(viewer.id);
  if (has(b, 'cancelled')) {
    const c = pickBool(b.cancelled);
    body.cancelled_at = c ? new Date(now).toISOString() : null;
    body.cancelled_by = c ? uid : null;
  }
  if (has(b, 'archived')) {
    const a = pickBool(b.archived);
    body.archived_at = a ? new Date(now).toISOString() : null;
    body.archived_by = a ? uid : null;
  }
  const { row } = await guardedPatch({ table: 'culture_events', id: eid, body, columns: EVENT_COLUMNS, actorId: uid, now });
  const out = (await query(`${EVENT_SELECT} WHERE e.id = $1::bigint`, [String(row.id)])).rows[0];
  return shapeEvent(out, viewerTz(viewer));
}

// DELETE /api/culture/events/:id: archive (soft; nothing is removed). A missing or already archived event answers
// { ok: true } and changes nothing (design §7.1).
export async function archiveEvent(viewer, id) {
  const eid = parseId(id);
  const r = await query(`UPDATE culture_events SET archived_at = now(), archived_by = $2::bigint, updated_at = now(), updated_by = $2::bigint
    WHERE id = $1::bigint AND archived_at IS NULL RETURNING id`, [eid, String(viewer.id)]);
  return { ok: true, archived: !!r.rows[0], id: eid };
}

// For the event form: an event as the form edits it (organizers; the page checks). null when missing.
export async function loadEventRow(viewer, id) {
  if (!/^[0-9]{1,18}$/.test(String(id ?? ''))) return null;
  try {
    const r = await query(`${EVENT_SELECT} WHERE e.id = $1::bigint`, [String(id)]);
    return shapeEvent(r.rows[0], viewerTz(viewer));
  } catch (e) {
    throw tagUpdating(e);
  }
}

// GET /api/culture/events?m=YYYY-MM&office=… (the calendar as JSON); exported for the route.
export async function calendarJson(viewer, q, now) {
  const month = q.get('m');
  if (month != null && month !== '' && !parseMonth(month)) throw bad('Pick a month as YYYY-MM.');
  return listCalendar(viewer, { month, office: q.get('office'), now });
}
