import 'server-only';
import * as React from 'react';
import { query, transaction } from '../db.js';
import { currentRound, autoSchedule } from '../bracket.js';
import { advanceDueBrackets, nextMondayStatus } from '../bracket-auto.js';
import { isOrganizer } from '../policy.js';
import { addDays as addDaysYmd, weekdayOf as weekdayOfYmd } from '../time.js';
import { tagUpdating } from '../viewer.js';

// Bracket loaders (design §2.1, §10(c)): the /culture/brackets pages, the poll endpoint, the Home and Culture
// bracket cards and the /admin Brackets section. Brackets are company-wide: every signed-in user reads every
// bracket that isn't soft-deleted (§4.5), so nothing here is filtered by office or project.
//
// "Current" = the newest bracket that is not archived, not soft-deleted and not an upcoming auto bracket
// (an auto bracket that hasn't activated yet; Release 3). Today's rule (inventory §1.14) was "the first
// un-archived bracket, newest first"; the extra conditions only matter once soft delete and auto brackets
// exist. Release 3 (K3): every loader calls advanceDueBrackets(now) first (lazy: a round that closed at
// midnight Central is decided by the first request after it; the daily cron is only the backup).
//
// Ids come back from Postgres as strings (rule 39); timestamps are turned into ISO strings here, so server
// components can hand plain JSON to client components.

const cache = typeof React.cache === 'function' ? React.cache : (fn) => fn;
// Read-only batches see one snapshot, so "which bracket is current" can't change between the statements.
const SNAPSHOT = { readOnly: true, isolationLevel: 'RepeatableRead' };

const idStr = (v) => (v == null ? null : String(v));
const clockOf = (now) => (Number.isFinite(Number(now)) && now != null ? Number(now) : Date.now());
export function iso(v) {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(String(v).replace(' ', 'T').replace(/([+-]\d\d)$/, '$1:00'));
  return Number.isNaN(d.getTime()) ? String(v) : d.toISOString();
}

// SQL: the current bracket's id (0 or 1 row). Also used by the routes' "is another bracket live" checks.
export const CURRENT_SQL = `SELECT c.id FROM brackets c
  WHERE NOT c.archived AND c.deleted_at IS NULL AND NOT (c.mode = 'auto' AND c.activated_at IS NULL)
  ORDER BY c.created_at DESC, c.id DESC LIMIT 1`;

// Summary columns for one bracket (b) plus its champion's name. Notes travel only for brackets that are not
// archived (the board shows them); past brackets load theirs on their own page.
const SUMMARY_COLS = `b.id, b.name, b.regions, b.champion_id, b.archived, b.created_at, b.completed_at,
  b.mode, b.crown_policy, b.starts_on, b.activated_at, b.created_by, b.updated_at, b.updated_by,
  CASE WHEN b.archived THEN NULL ELSE b.notes END AS notes,
  (b.archived AND b.notes <> '') AS has_notes,
  ce.name AS champion_name`;

export function shapeBracket(r) {
  if (!r) return null;
  return {
    id: String(r.id),
    name: r.name,
    notes: r.notes ?? null,
    has_notes: !!r.has_notes || !!(r.notes && String(r.notes).trim()),
    regions: r.regions || '[]',
    champion_id: idStr(r.champion_id),
    champion_name: r.champion_name ?? null,
    archived: !!r.archived,
    created_at: iso(r.created_at),
    completed_at: iso(r.completed_at),
    mode: r.mode || 'manual',
    crown_policy: r.crown_policy || 'anyone',
    starts_on: r.starts_on ?? null,
    activated_at: iso(r.activated_at),
    created_by: idStr(r.created_by),
    updated_at: iso(r.updated_at),
    updated_by: idStr(r.updated_by),
    ...(r.updated_by_name !== undefined ? { updated_by_name: r.updated_by_name } : {}),
    ...(r.deleted_at !== undefined ? { deleted_at: iso(r.deleted_at), deleted_by_name: r.deleted_by_name ?? null } : {}),
  };
}
export const shapeEntrant = (r) => ({
  id: String(r.id), bracket_id: String(r.bracket_id), name: r.name, quadrant: Number(r.quadrant), seed: Number(r.seed),
  ...(r.updated_at !== undefined ? { updated_at: iso(r.updated_at), updated_by: idStr(r.updated_by) } : {}),
  ...(r.updated_by_name !== undefined ? { updated_by_name: r.updated_by_name } : {}),
});
export const shapeMatch = (r) => ({
  id: String(r.id), bracket_id: String(r.bracket_id), round: Number(r.round), idx: Number(r.idx),
  a_id: idStr(r.a_id), b_id: idStr(r.b_id), winner_id: idStr(r.winner_id), decided_at: iso(r.decided_at),
  decided_by: r.decided_by ?? null, decide_reason: r.decide_reason ?? null, decided_by_user: idStr(r.decided_by_user),
  a_votes: r.a_votes == null ? null : Number(r.a_votes), b_votes: r.b_votes == null ? null : Number(r.b_votes),
});
const shapeVote = (r) => ({ match_id: String(r.match_id), user_id: String(r.user_id), entrant_id: String(r.entrant_id) });
const shapeUser = (r) => ({
  id: String(r.id), username: r.username, display_name: r.display_name || '',
  name: r.display_name || r.username, avatar_v: idStr(r.avatar_v), avatar_crop: r.avatar_crop ?? null,
  has_src: !!r.has_src, disabled: !!r.disabled,
});

// Lifecycle (§10(c)): upcoming = auto and not activated (and not archived); current = see CURRENT_SQL.
export const isUpcoming = (b) => b.mode === 'auto' && !b.activated_at && !b.archived;

const MATCH_COLS = `m.id, m.bracket_id, m.round, m.idx, m.a_id, m.b_id, m.winner_id, m.decided_at, m.decided_by,
  m.decide_reason, m.decided_by_user, m.a_votes, m.b_votes`;

// Where a bracket stands at `now` (the board, the status bar, the cards, the poll):
//   manual: the earliest round with an undecided matchup is open (one round at a time; no clock).
//   auto:   the calendar decides (lib/bracket.js autoSchedule): { phase upcoming | open | closing | done,
//           open_round, closes_at, opens_at, next_close } plus starts_on.
export function scheduleOf(bracket, matches, now) {
  if (bracket && bracket.mode === 'auto' && bracket.starts_on) {
    return { mode: 'auto', starts_on: bracket.starts_on, ...autoSchedule(bracket.starts_on, clockOf(now), { decided: !!bracket.champion_id }) };
  }
  const open = bracket ? currentRound(matches || []) : null;
  return { mode: 'manual', phase: open == null ? 'done' : 'open', open_round: open, closes_at: null, opens_at: null, next_close: null };
}

// The organizer cadence (design §10(c) "Keeping the Monday cadence"), organizers and admins only (null for
// everyone else): { next_monday, scheduled, warn (from Wednesday on with nothing next Monday), free_monday }.
async function cadenceFor(viewer, now) {
  if (!isOrganizer(viewer)) return null;
  const c = await nextMondayStatus(clockOf(now));
  return { next_monday: c.next_monday, scheduled: c.scheduled, warn: c.warn, free_monday: c.free_monday };
}

// Never let the lazy resolver break a page: it logs and retries on the next request by itself.
async function advance(now) {
  try { await advanceDueBrackets(clockOf(now)); } catch (e) { console.error('[brackets] advance', e); }
}

// Users for headshots and Voter photos: every active, non-test account, plus anyone who voted in the given
// brackets (so an old vote by a since-disabled or zz_ account still shows a face), plus the viewer.
// votersOnly: just the voters and the viewer (the 15 s poll).
const usersQuery = (meId, bracketIds, { votersOnly = false } = {}) => query(
  `SELECT u.id, u.username, u.display_name, u.avatar_v, u.avatar_crop, (u.avatar_src IS NOT NULL) AS has_src,
          (u.disabled_at IS NOT NULL) AS disabled
   FROM users u
   WHERE ${votersOnly ? 'false' : `(u.disabled_at IS NULL AND u.username NOT LIKE 'zz!_%' ESCAPE '!')`}
      OR u.id = $1::bigint
      OR u.id IN (SELECT v.user_id FROM bracket_votes v JOIN bracket_matches m ON m.id = v.match_id
                  WHERE m.bracket_id = ANY($2::bigint[]))
      OR u.id IN (SELECT m.decided_by_user FROM bracket_matches m
                  WHERE m.bracket_id = ANY($2::bigint[]) AND m.decided_by = 'organizer')
   ORDER BY lower(COALESCE(NULLIF(u.display_name, ''), u.username)), u.id`,
  [String(meId), bracketIds]);

// Every bracket that isn't soft-deleted, newest first, plus the current one's entrants, matches and votes.
async function readBoard(viewer, now, { votersOnly = false } = {}) {
  await advance(now);
  const [list, ents, matches, votes] = (await transaction([
    query(`SELECT ${SUMMARY_COLS}
           FROM brackets b LEFT JOIN bracket_entrants ce ON ce.id = b.champion_id
           WHERE b.deleted_at IS NULL
           ORDER BY b.created_at DESC, b.id DESC`),
    query(`SELECT e.id, e.bracket_id, e.name, e.quadrant, e.seed FROM bracket_entrants e
           WHERE e.bracket_id IN (${CURRENT_SQL}) ORDER BY e.quadrant, e.seed, e.id`),
    query(`SELECT ${MATCH_COLS} FROM bracket_matches m
           WHERE m.bracket_id IN (${CURRENT_SQL}) ORDER BY m.round, m.idx`),
    query(`SELECT v.match_id, v.user_id, v.entrant_id FROM bracket_votes v JOIN bracket_matches m ON m.id = v.match_id
           WHERE m.bracket_id IN (${CURRENT_SQL}) ORDER BY v.created_at ASC, v.match_id ASC, v.user_id ASC`),
  ], SNAPSHOT)).map((r) => r.rows);
  const brackets = list.map(shapeBracket);
  const current = brackets.find((b) => !b.archived && !isUpcoming(b)) || null;
  const users = (await usersQuery(viewer.id, current ? [current.id] : [], { votersOnly })).rows.map(shapeUser);
  const curMatches = current ? matches.map(shapeMatch) : [];
  return {
    current: current ? {
      bracket: current,
      entrants: ents.map(shapeEntrant),
      matches: curMatches,
      votes: votes.map(shapeVote),
    } : null,
    upcoming: brackets.filter(isUpcoming).sort((a, b) => String(a.starts_on).localeCompare(String(b.starts_on))),
    past: brackets.filter((b) => (!current || b.id !== current.id) && !isUpcoming(b)),
    users,
    schedule: scheduleOf(current, curMatches, now),
    cadence: await cadenceFor(viewer, now),
    now: new Date(clockOf(now)).toISOString(),
  };
}

// /culture/brackets: the live board, upcoming and past brackets, and the users for headshots / Voter photos.
export const loadBrackets = cache(async (viewer, now) => {
  try {
    return await readBoard(viewer, now);
  } catch (e) {
    throw tagUpdating(e);
  }
});

// GET /api/brackets/current (the 15 s poll): the same, but users = voters and the viewer only.
export async function loadBracketPoll(viewer, now) {
  return readBoard(viewer, now, { votersOnly: true });
}

// /culture/brackets/[id] and GET /api/brackets/:id: one bracket that isn't soft-deleted, with everything on
// it, plus the history list (for the Past brackets panel). null when missing or deleted.
export const loadBracket = cache(async (viewer, id, now) => {
  try {
    await advance(now);
    const [rows, ents, matches, votes, list] = (await transaction([
      query(`SELECT ${SUMMARY_COLS.replace('CASE WHEN b.archived THEN NULL ELSE b.notes END AS notes', 'b.notes')}
             FROM brackets b LEFT JOIN bracket_entrants ce ON ce.id = b.champion_id
             WHERE b.id = $1::bigint AND b.deleted_at IS NULL`, [String(id)]),
      query(`SELECT e.id, e.bracket_id, e.name, e.quadrant, e.seed FROM bracket_entrants e
             WHERE e.bracket_id = $1::bigint ORDER BY e.quadrant, e.seed, e.id`, [String(id)]),
      query(`SELECT ${MATCH_COLS} FROM bracket_matches m WHERE m.bracket_id = $1::bigint ORDER BY m.round, m.idx`,
        [String(id)]),
      query(`SELECT v.match_id, v.user_id, v.entrant_id FROM bracket_votes v JOIN bracket_matches m ON m.id = v.match_id
             WHERE m.bracket_id = $1::bigint ORDER BY v.created_at ASC, v.match_id ASC, v.user_id ASC`, [String(id)]),
      query(`SELECT ${SUMMARY_COLS}, (b.id IN (${CURRENT_SQL})) AS is_current
             FROM brackets b LEFT JOIN bracket_entrants ce ON ce.id = b.champion_id
             WHERE b.deleted_at IS NULL ORDER BY b.created_at DESC, b.id DESC`),
    ], SNAPSHOT)).map((r) => r.rows);
    if (!rows[0]) return null;
    const bracket = shapeBracket(rows[0]);
    const curRow = list.find((r) => r.is_current);
    const users = (await usersQuery(viewer.id, [bracket.id], { votersOnly: true })).rows.map(shapeUser);
    return {
      bracket,
      is_current: !!curRow && String(curRow.id) === bracket.id,
      entrants: ents.map(shapeEntrant),
      matches: matches.map(shapeMatch),
      votes: votes.map(shapeVote),
      users,
      history: list.filter((r) => !r.is_current).map(shapeBracket).filter((b) => !isUpcoming(b)),
      schedule: scheduleOf(bracket, matches.map(shapeMatch), now),
      cadence: await cadenceFor(viewer, now),
    };
  } catch (e) {
    throw tagUpdating(e);
  }
});

// /culture/brackets/new: the start Mondays an organizer can pick for a weekly bracket: the next 12 Mondays from
// today (Central; today too when it is a Monday), each { ymd, taken: name of the weekly bracket already on it }.
export async function loadStartMondays(now) {
  const t = clockOf(now);
  const c = await nextMondayStatus(t);
  const taken = new Map(c.taken.map((x) => [x.starts_on, x.name]));
  const first = weekdayOfYmd(c.today) === 1 ? c.today : c.next_monday;
  const out = [];
  for (let i = 0; i < 12; i++) {
    const ymd = addDaysYmd(first, 7 * i);
    out.push({ ymd, taken: taken.get(ymd) || null });
  }
  return { mondays: out, free_monday: c.free_monday, next_monday: c.next_monday, today: c.today };
}

// /culture/brackets/new?from=<id>: names, regions and entrants to prefill the setup form (not soft-deleted).
export async function loadBracketTemplate(id) {
  if (!/^[0-9]{1,18}$/.test(String(id ?? ''))) return null;
  try {
    const [b, ents] = (await transaction([
      query(`SELECT id, name, regions FROM brackets WHERE id = $1::bigint AND deleted_at IS NULL`, [String(id)]),
      query(`SELECT quadrant, seed, name FROM bracket_entrants WHERE bracket_id = $1::bigint
             AND bracket_id IN (SELECT id FROM brackets WHERE deleted_at IS NULL) ORDER BY quadrant, seed`, [String(id)]),
    ], SNAPSHOT)).map((r) => r.rows);
    if (!b[0]) return null;
    const grid = [0, 1, 2, 3].map(() => ['', '', '', '', '']);
    for (const e of ents) {
      const q = Number(e.quadrant); const s = Number(e.seed) - 1;
      if (q >= 0 && q < 4 && s >= 0 && s < 5) grid[q][s] = e.name || '';
    }
    let regions = [];
    try { regions = JSON.parse(b[0].regions || '[]'); } catch { /* old rows: defaults */ }
    return {
      id: String(b[0].id),
      name: b[0].name || '',
      regions: [0, 1, 2, 3].map((q) => (Array.isArray(regions) && regions[q]) || `Quadrant ${q + 1}`),
      entrants: grid,
    };
  } catch (e) {
    throw tagUpdating(e);
  }
}

// Home and Culture bracket cards: the current bracket's status and the viewer's part in the open round.
//   null when no bracket exists at all; otherwise { current, upcoming (the next weekly bracket that hasn't
//   started), schedule, open_round, open_done, open_total, my_open_votes, open_votable, past_count, last_champion }.
export const loadBracketSummary = cache(async (viewer, now) => {
  try {
    await advance(now);
    const [cur, matches, mine, past, nextUp] = (await transaction([
      query(`SELECT ${SUMMARY_COLS} FROM brackets b LEFT JOIN bracket_entrants ce ON ce.id = b.champion_id
             WHERE b.id IN (${CURRENT_SQL})`),
      query(`SELECT ${MATCH_COLS} FROM bracket_matches m WHERE m.bracket_id IN (${CURRENT_SQL})`),
      query(`SELECT v.match_id FROM bracket_votes v JOIN bracket_matches m ON m.id = v.match_id
             WHERE v.user_id = $1::bigint AND m.bracket_id IN (${CURRENT_SQL})`, [String(viewer.id)]),
      query(`SELECT count(*)::int AS n,
                    (SELECT row_to_json(x) FROM (SELECT p.id, p.name, pe.name AS champion_name FROM brackets p
                       JOIN bracket_entrants pe ON pe.id = p.champion_id
                       WHERE p.archived AND p.deleted_at IS NULL
                       ORDER BY p.completed_at DESC NULLS LAST, p.id DESC LIMIT 1) x) AS last_champion
             FROM brackets WHERE archived AND deleted_at IS NULL`),
      query(`SELECT id, name, starts_on FROM brackets
             WHERE mode = 'auto' AND activated_at IS NULL AND NOT archived AND deleted_at IS NULL
             ORDER BY starts_on, id LIMIT 1`),
    ], SNAPSHOT)).map((r) => r.rows);
    const current = cur[0] ? shapeBracket(cur[0]) : null;
    const upcoming = nextUp[0] ? { id: String(nextUp[0].id), name: nextUp[0].name, starts_on: String(nextUp[0].starts_on) } : null;
    const ms = matches.map(shapeMatch);
    const sched = scheduleOf(current, ms, now);
    const open = current ? sched.open_round : null;
    const openMs = open == null ? [] : ms.filter((m) => m.round === open);
    const votable = openMs.filter((m) => m.a_id && m.b_id && !m.winner_id);
    const mineSet = new Set(mine.map((r) => String(r.match_id)));
    let last = past[0]?.last_champion ?? null;
    if (typeof last === 'string') { try { last = JSON.parse(last); } catch { last = null; } }
    const pastCount = Number(past[0]?.n || 0);
    if (!current && !pastCount && !upcoming) return null;
    return {
      current,
      upcoming,
      schedule: sched,
      open_round: open,
      open_done: openMs.filter((m) => m.winner_id).length,
      open_total: openMs.length,
      open_votable: votable.length,
      my_open_votes: votable.filter((m) => mineSet.has(m.id)).length,
      past_count: pastCount,
      last_champion: last ? { id: String(last.id), name: last.name, champion_name: last.champion_name } : null,
    };
  } catch (e) {
    throw tagUpdating(e);
  }
});

// /culture hub (design §2.1 loadCultureHub). Release 1: the bracket card; Release 3 adds the challenge,
// events and the organizer warning (K1/K2/K3 extend this or load their own cards).
export const loadCultureHub = cache(async (viewer, now) => ({
  bracket: await loadBracketSummary(viewer, now),
}));

// The Home organizer card (design §10(c) "Organizer warning"): null for everyone else, and when nothing is due.
//   { next_monday, repeat_id } where repeat_id is the current or newest weekly bracket to copy ("Repeat this week's").
export const loadBracketCadence = cache(async (viewer, now) => {
  const c = await cadenceFor(viewer, now);
  if (!c || !c.warn) return null;
  const r = await query(`SELECT id FROM brackets WHERE deleted_at IS NULL AND mode = 'auto'
                         ORDER BY starts_on DESC NULLS LAST, id DESC LIMIT 1`);
  return { next_monday: c.next_monday, free_monday: c.free_monday, repeat_id: r.rows[0] ? String(r.rows[0].id) : null };
});

// /admin Brackets section: soft-deleted brackets (Restore) and archived ones (Un-archive), plus the live one
// (un-archiving is refused while a different bracket is live). Admin-only page; the caller checks.
export async function listBracketsForAdmin() {
  try {
    const [deleted, archived, live] = (await transaction([
      query(`SELECT ${SUMMARY_COLS}, b.deleted_at, COALESCE(NULLIF(du.display_name, ''), du.username) AS deleted_by_name
             FROM brackets b LEFT JOIN bracket_entrants ce ON ce.id = b.champion_id
             LEFT JOIN users du ON du.id = b.deleted_by
             WHERE b.deleted_at IS NOT NULL ORDER BY b.deleted_at DESC, b.id DESC`),
      query(`SELECT ${SUMMARY_COLS} FROM brackets b LEFT JOIN bracket_entrants ce ON ce.id = b.champion_id
             WHERE b.archived AND b.deleted_at IS NULL ORDER BY b.created_at DESC, b.id DESC`),
      query(`SELECT ${SUMMARY_COLS} FROM brackets b LEFT JOIN bracket_entrants ce ON ce.id = b.champion_id
             WHERE b.id IN (${CURRENT_SQL})`),
    ], SNAPSHOT)).map((r) => r.rows);
    return {
      deleted: deleted.map(shapeBracket),
      archived: archived.map(shapeBracket),
      live: live[0] ? shapeBracket(live[0]) : null,
    };
  } catch (e) {
    throw tagUpdating(e);
  }
}
