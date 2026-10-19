import 'server-only';
import * as React from 'react';
import { query, transaction } from '../db.js';
import { HttpError, bad, forbidden, gone, noNul, parseId, str, ymd } from '../http.js';
import { guardedPatch, norm } from '../patch.js';
import { isOrganizer } from '../policy.js';
import { tagUpdating } from '../viewer.js';
import { nowFromRequestContext } from '../clock.js';
import { withDefaults } from '../prefs.js';
import { chicagoToday, addDays, daysBetween } from '../time.js';
import {
  AGGREGATION_KEYS, GROUP_RANK_KEYS, LIMITS, MAX_ENTRIES_PER_DAY, MAX_RANGE_DAYS, aggregate, canChangeEntry,
  canLogStats, challengeStatus, entriesCloseOn, entryDateBounds, fmtDay, isParticipant, monthRange, parseValue, rankRows,
} from '../challenges.js';
import { DEFAULT_SQUARES, cleanSquares, readSquares } from '../bingo.js';
import { bingoSummaries, geoOfficeIds, loadBingo, pickBingoOffices, setBingoOffices } from './bingo.js';

// Monthly challenges: loaders and writes (design §10(a), §4.5; agent K1).
// Every signed-in user reads every challenge and its leaderboards (company-public, like events and brackets), so
// nothing here is filtered by office for access; office challenges are only filtered for DISPLAY (the viewer's
// offices plus followed ones, design §10(a) "Featured challenge"). Entries are private to their owner, except
// that culture organizers and admins see and edit every entry. Archived challenges are visible to organizers only
// (anyone else gets the same 404 as a missing id).
// Leaderboards leave out zz_ test accounts and disabled users on EVERY board (rule 51), count only entries that
// aren't deleted and fall inside the challenge dates, and attribute each person once, with their whole score, to
// the office and department snapshot of their most recent entry (design §10(a) "Group attribution").
// NUMERIC and BIGINT arrive as strings (rule 39): ids stay strings, scores become numbers here.

const cache = typeof React.cache === 'function' ? React.cache : (fn) => fn;
const READ = { readOnly: true, isolationLevel: 'RepeatableRead' };

const idOrNull = (v) => (v == null ? null : String(v));
const iso = (v) => { if (v == null) return null; const d = v instanceof Date ? v : new Date(v); return Number.isNaN(d.getTime()) ? null : d.toISOString(); };
const num = (v) => (v == null ? null : Number(v));
const has = (o, k) => !!o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);
const notFoundChallenge = () => new HttpError(404, 'Challenge not found');

// One person's score in SQL (the same rule as lib/challenges.js aggregate()).
const SCORE = `CASE c.aggregation WHEN 'sum' THEN sum(e.value)
    WHEN 'max' THEN CASE WHEN c.higher_is_better THEN max(e.value) ELSE min(e.value) END
    ELSE count(*)::numeric END`;
// Entries that count: not deleted, dated inside the challenge (an organizer may shorten the dates later).
const COUNTED = `e.deleted_at IS NULL AND e.entry_date >= c.starts_on AND e.entry_date <= c.ends_on`;
// People on the boards: not disabled, not a zz_ test account.
const RANKED = `u.disabled_at IS NULL AND u.username NOT LIKE 'zz!_%' ESCAPE '!'`;

const NAME_SQL = (a) => `COALESCE(NULLIF(${a}.display_name, ''), ${a}.username)`;

export const CHALLENGE_SELECT = `SELECT c.id, c.title, c.description, c.metric_label, c.unit, c.aggregation, c.higher_is_better,
       c.group_rank, c.starts_on, c.ends_on, c.office_id, o.name AS office_name, c.created_by, c.created_at,
       c.updated_at, c.updated_by, (SELECT ${NAME_SQL('x')} FROM users x WHERE x.id = c.updated_by) AS updated_by_name,
       c.archived_at, c.kind, c.bingo_squares
FROM culture_challenges c LEFT JOIN offices o ON o.id = c.office_id`;

export function shapeChallenge(r) {
  if (!r) return null;
  return {
    id: String(r.id), title: r.title || '', description: r.description || '', metric_label: r.metric_label || 'Points',
    unit: r.unit || '', aggregation: AGGREGATION_KEYS.includes(r.aggregation) ? r.aggregation : 'sum',
    higher_is_better: r.higher_is_better !== false, group_rank: GROUP_RANK_KEYS.includes(r.group_rank) ? r.group_rank : 'avg',
    starts_on: r.starts_on, ends_on: r.ends_on, office_id: idOrNull(r.office_id), office_name: r.office_name ?? null,
    created_by: idOrNull(r.created_by), created_at: iso(r.created_at),
    updated_at: iso(r.updated_at), updated_by: idOrNull(r.updated_by), updated_by_name: r.updated_by_name ?? null,
    archived_at: iso(r.archived_at), archived: r.archived_at != null,
    kind: r.kind === 'bingo' ? 'bingo' : 'stats',
    ...(r.kind === 'bingo' ? { squares: readSquares(r.bingo_squares) } : {}),
  };
}

const shapeEntry = (r) => ({
  id: String(r.id), challenge_id: String(r.challenge_id), user_id: String(r.user_id),
  entry_date: r.entry_date, value: num(r.value), note: r.note || '',
  created_at: iso(r.created_at), updated_at: iso(r.updated_at), updated_by: idOrNull(r.updated_by),
  ...(r.user_name !== undefined ? { user_name: r.user_name, username: r.username } : {}),
  ...(r.updated_by_name !== undefined ? { updated_by_name: r.updated_by_name } : {}),
});

// The offices a viewer sees office challenges for by default: home and extra offices plus followed ones.
function myOfficeIds(viewer) {
  const prefs = withDefaults(viewer.prefs, { isAdmin: !!viewer.is_admin });
  return [...new Set([...(viewer.office_ids || []), ...(prefs.followed_office_ids || [])].map(String))];
}

// ---------------------------------------------------------------- summaries (list, hub, Home widget)

// Per challenge: participants, the top 5 (dense ranks), the viewer's score / rank / entry count.
//   -> Map(id -> { participants, top: [{ user_id, name, username, avatar_v, score, rank }], me: { score, rank, entries } })
async function summarize(viewer, challenges) {
  const out = new Map();
  if (!challenges.length) return out;
  const ids = challenges.map((c) => c.id);
  const [board, mine] = (await transaction([
    query(`WITH per_user AS (
             SELECT e.challenge_id, e.user_id, ${SCORE} AS score, min(e.created_at) AS first_at
             FROM culture_entries e JOIN culture_challenges c ON c.id = e.challenge_id
             JOIN users u ON u.id = e.user_id AND ${RANKED}
             WHERE e.challenge_id = ANY($1::bigint[]) AND ${COUNTED}
             GROUP BY e.challenge_id, e.user_id, c.aggregation, c.higher_is_better)
           SELECT p.challenge_id, p.user_id, p.score, p.first_at, ${NAME_SQL('u')} AS name, u.username, u.avatar_v
           FROM per_user p JOIN users u ON u.id = p.user_id`, [ids]),
    query(`SELECT e.challenge_id, ${SCORE} AS score, count(*)::int AS entries
           FROM culture_entries e JOIN culture_challenges c ON c.id = e.challenge_id
           WHERE e.challenge_id = ANY($1::bigint[]) AND e.user_id = $2::bigint AND ${COUNTED}
           GROUP BY e.challenge_id, c.aggregation, c.higher_is_better`, [ids, String(viewer.id)]),
  ], READ)).map((r) => r.rows);
  const byId = new Map(challenges.map((c) => [c.id, c]));
  const groups = new Map();
  for (const r of board) {
    const k = String(r.challenge_id);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push({ user_id: String(r.user_id), name: r.name, username: r.username, avatar_v: r.avatar_v ?? null,
      score: Number(r.score), first_at: iso(r.first_at) });
  }
  const mineBy = new Map(mine.map((r) => [String(r.challenge_id), r]));
  for (const c of challenges) {
    const ranked = rankRows(groups.get(c.id) || [], byId.get(c.id).higher_is_better, { tie: 'first_at' });
    const meRow = ranked.find((r) => r.user_id === String(viewer.id));
    const m = mineBy.get(c.id);
    out.set(c.id, {
      participants: ranked.length,
      top: ranked.slice(0, 5).map(({ first_at, ...r }) => r),   // eslint-disable-line no-unused-vars
      me: { score: m ? Number(m.score) : null, entries: m ? Number(m.entries) : 0, rank: meRow ? meRow.rank : null },
    });
  }
  return out;
}

// A bingo challenge has no personal stats: its cards carry each office's marks and the prizes instead (bingo), and
// can_mark (the viewer can mark today's square for one of their offices) in place of can_log.
const withSummary = (c, sums, today, viewer, bingo = new Map()) => ({
  ...c,
  status: challengeStatus(c, today),
  can_log: c.kind === 'bingo' ? false : canLogStats(viewer, c, today),
  ...(sums.get(c.id) || { participants: 0, top: [], me: { score: null, entries: 0, rank: null } }),
  ...(c.kind === 'bingo' ? (bingo.get(c.id) || { bingo: { offices: [], winners: { bingo: null, corners: null } }, can_mark: false }) : {}),
});

// /culture/challenges: every challenge, newest first, in Running now / Coming up / Past. show = 'mine' (company +
// my offices + followed, the default) or 'all'; organizers may also ask for the archived ones.
export async function listChallenges(viewer, now, { show = 'mine', archived = false } = {}) {
  try {
    const today = chicagoToday(now);
    const all = show === 'all';
    const org = isOrganizer(viewer);
    const [rows, offices] = (await transaction([
      query(`${CHALLENGE_SELECT}
             WHERE ${archived && org ? 'c.archived_at IS NOT NULL' : 'c.archived_at IS NULL'}
               AND (c.office_id IS NULL OR $1::boolean OR c.office_id = ANY($2::bigint[]))
             ORDER BY c.starts_on DESC, c.ends_on DESC, c.id DESC LIMIT 500`, [all, myOfficeIds(viewer)]),
      query(`SELECT count(*)::int AS n FROM culture_challenges c
             WHERE c.archived_at IS NULL AND c.office_id IS NOT NULL AND NOT (c.office_id = ANY($1::bigint[]))`,
      [myOfficeIds(viewer)]),
    ], READ)).map((r) => r.rows);
    const list = rows.map(shapeChallenge);
    const [sums, bingo] = await Promise.all([summarize(viewer, list), bingoSummaries(viewer, list, today)]);
    const shaped = list.map((c) => withSummary(c, sums, today, viewer, bingo));
    return {
      today,
      show: all ? 'all' : 'mine',
      archived: !!(archived && org),
      other_office_count: Number(offices[0]?.n || 0),
      running: shaped.filter((c) => c.status === 'running'),
      upcoming: shaped.filter((c) => c.status === 'upcoming').reverse(),
      past: shaped.filter((c) => c.status === 'ended'),
      archived_list: shaped.filter((c) => c.status === 'archived'),
    };
  } catch (e) {
    throw tagUpdating(e);
  }
}

// The Home and Culture cards: the featured challenge (the company challenge whose dates cover today in Central;
// the latest-starting one when several do), the other running ones for the viewer (other company challenges, office
// challenges in the viewer's and followed offices), the next one coming up and the recently finished ones.
export const loadChallengeSummary = cache(async (viewer, now) => {
  try {
    const today = chicagoToday(now);
    const rows = (await query(`${CHALLENGE_SELECT}
      WHERE c.archived_at IS NULL AND (c.office_id IS NULL OR c.office_id = ANY($1::bigint[]))
        AND c.ends_on >= $2::text
      ORDER BY c.starts_on DESC, c.id DESC LIMIT 60`, [myOfficeIds(viewer), addDays(today, -400)])).rows.map(shapeChallenge);
    const running = rows.filter((c) => challengeStatus(c, today) === 'running');
    const featured = running.find((c) => c.office_id == null) || null;
    const others = running.filter((c) => c !== featured).slice(0, 4);
    const next = rows.filter((c) => challengeStatus(c, today) === 'upcoming').sort((a, b) => (a.starts_on < b.starts_on ? -1 : 1))[0] || null;
    const recent = rows.filter((c) => challengeStatus(c, today) === 'ended')
      .sort((a, b) => (a.ends_on > b.ends_on ? -1 : a.ends_on < b.ends_on ? 1 : Number(b.id) - Number(a.id))).slice(0, 3);
    const pick = [featured, ...others, next, ...recent].filter(Boolean);
    const [sums, bingo] = await Promise.all([summarize(viewer, pick), bingoSummaries(viewer, pick, today)]);
    const s = (c) => (c ? withSummary(c, sums, today, viewer, bingo) : null);
    return {
      today,
      can_manage: isOrganizer(viewer),
      featured: s(featured),
      others: others.map(s),
      next: s(next),
      recent: recent.map(s),
    };
  } catch (e) {
    throw tagUpdating(e);
  }
});

// /culture/challenge: the challenge to open (the featured one, else a running one in the viewer's offices), or null.
export async function currentChallengeId(viewer, now) {
  const sum = await loadChallengeSummary(viewer, now);
  return sum.featured?.id || sum.others[0]?.id || null;
}

// ---------------------------------------------------------------- one challenge

// /culture/challenges/[id] and GET /api/culture/challenges/:id. null when the id is missing or archived (archived
// ones open for organizers only).
//   { challenge, today, status, can: { log, manage }, bounds: { min, max } | null, entries_close_on,
//     boards: { individuals, offices, departments }, me: { ranked, score, rank, entries: [...] }, all_entries | null }
export async function loadChallenge(viewer, id, now) {
  if (!/^[0-9]{1,18}$/.test(String(id ?? ''))) return null;
  const cid = String(id);
  const uid = String(viewer.id);
  const org = isOrganizer(viewer);
  try {
    const qs = [
      query(`${CHALLENGE_SELECT} WHERE c.id = $1::bigint`, [cid]),
      query(`SELECT u.id, ${NAME_SQL('u')} AS name, u.username, u.avatar_v, o.name AS office_name,
                    d.name AS department_name, d.color AS department_color,
                    ${SCORE} AS score, count(*)::int AS entries, min(e.created_at) AS first_at
             FROM culture_entries e JOIN culture_challenges c ON c.id = e.challenge_id
             JOIN users u ON u.id = e.user_id AND ${RANKED}
             LEFT JOIN offices o ON o.id = u.office_id LEFT JOIN departments d ON d.id = u.department_id
             WHERE e.challenge_id = $1::bigint AND ${COUNTED}
             GROUP BY u.id, u.display_name, u.username, u.avatar_v, o.name, d.name, d.color, c.aggregation, c.higher_is_better
             LIMIT 2000`, [cid]),
      query(`WITH per_user AS (
               SELECT e.user_id, (array_agg(e.office_id ORDER BY e.created_at DESC, e.id DESC))[1] AS group_id, ${SCORE} AS score
               FROM culture_entries e JOIN culture_challenges c ON c.id = e.challenge_id
               JOIN users u ON u.id = e.user_id AND ${RANKED}
               WHERE e.challenge_id = $1::bigint AND ${COUNTED}
               GROUP BY e.user_id, c.aggregation, c.higher_is_better)
             SELECT o.id, o.name, NULL::text AS color, count(*)::int AS participants, sum(p.score) AS total,
                    round(avg(p.score), 2) AS average
             FROM per_user p JOIN offices o ON o.id = p.group_id
             GROUP BY o.id, o.name`, [cid]),
      query(`WITH per_user AS (
               SELECT e.user_id, (array_agg(e.department_id ORDER BY e.created_at DESC, e.id DESC))[1] AS group_id, ${SCORE} AS score
               FROM culture_entries e JOIN culture_challenges c ON c.id = e.challenge_id
               JOIN users u ON u.id = e.user_id AND ${RANKED}
               WHERE e.challenge_id = $1::bigint AND ${COUNTED}
               GROUP BY e.user_id, c.aggregation, c.higher_is_better)
             SELECT d.id, d.name, d.color, count(*)::int AS participants, sum(p.score) AS total,
                    round(avg(p.score), 2) AS average
             FROM per_user p JOIN departments d ON d.id = p.group_id
             GROUP BY d.id, d.name, d.color`, [cid]),
      query(`SELECT e.id, e.challenge_id, e.user_id, e.entry_date, e.value, e.note, e.created_at, e.updated_at, e.updated_by,
                    (SELECT ${NAME_SQL('x')} FROM users x WHERE x.id = e.updated_by) AS updated_by_name
             FROM culture_entries e
             WHERE e.challenge_id = $1::bigint AND e.user_id = $2::bigint AND e.deleted_at IS NULL
             ORDER BY e.entry_date DESC, e.id DESC LIMIT 1000`, [cid, uid]),
      query(`SELECT (u.disabled_at IS NULL AND u.username NOT LIKE 'zz!_%' ESCAPE '!') AS ranked FROM users u WHERE u.id = $1::bigint`, [uid]),
    ];
    if (org) {
      qs.push(query(`SELECT e.id, e.challenge_id, e.user_id, e.entry_date, e.value, e.note, e.created_at, e.updated_at, e.updated_by,
                            ${NAME_SQL('u')} AS user_name, u.username,
                            (SELECT ${NAME_SQL('x')} FROM users x WHERE x.id = e.updated_by) AS updated_by_name
                     FROM culture_entries e JOIN users u ON u.id = e.user_id
                     WHERE e.challenge_id = $1::bigint AND e.deleted_at IS NULL
                     ORDER BY e.created_at DESC, e.id DESC LIMIT 300`, [cid]));
    }
    const [crow, indiv, offs, depts, mine, rk, all] = (await transaction(qs, READ)).map((r) => r.rows);
    const c = shapeChallenge(crow[0]);
    if (!c || (c.archived && !org)) return null;
    const today = chicagoToday(now);
    if (c.kind === 'bingo') {
      const { board } = await loadBingo(viewer, c, now);
      return { challenge: c, today, status: challengeStatus(c, today), can: { manage: org }, bingo: board };
    }
    const hib = c.higher_is_better;
    const individuals = rankRows(indiv.map((r) => ({
      user_id: String(r.id), name: r.name, username: r.username, avatar_v: r.avatar_v ?? null,
      office_name: r.office_name ?? null, department_name: r.department_name ?? null, department_color: r.department_color ?? null,
      score: Number(r.score), entries: Number(r.entries), first_at: iso(r.first_at),
    })), hib, { tie: 'first_at' }).map(({ first_at, ...r }) => r);   // eslint-disable-line no-unused-vars
    const group = (rows) => rankRows(rows.map((r) => {
      const total = Number(r.total);
      const average = Number(r.average);
      return { id: String(r.id), name: r.name, color: r.color ?? null, participants: Number(r.participants), total, average,
        score: c.group_rank === 'sum' ? total : average };
    }), hib);
    const myEntries = mine.map(shapeEntry);
    const counted = myEntries.filter((e) => e.entry_date >= c.starts_on && e.entry_date <= c.ends_on);
    const meRow = individuals.find((r) => r.user_id === uid);
    return {
      challenge: c,
      today,
      status: challengeStatus(c, today),
      can: { log: canLogStats(viewer, c, today), manage: org, participant: isParticipant(viewer, c),
        change_own: org || (!c.archived && today <= entriesCloseOn(c)) },
      bounds: entryDateBounds(c, today),
      entries_close_on: entriesCloseOn(c),
      boards: { individuals, offices: group(offs), departments: group(depts) },
      me: {
        ranked: !!rk[0]?.ranked,
        score: aggregate(c, counted.map((e) => e.value)),
        entries_counted: counted.length,
        rank: meRow ? meRow.rank : null,
        entries: myEntries.map((e) => ({ ...e, counted: e.entry_date >= c.starts_on && e.entry_date <= c.ends_on })),
      },
      all_entries: org ? (all || []).map(shapeEntry) : null,
    };
  } catch (e) {
    throw tagUpdating(e);
  }
}

// The page and its generateMetadata share one load per request (React cache; the clock is read inside, so both
// calls have the same arguments).
export const loadChallengePage = cache((viewer, id) => loadChallenge(viewer, id, nowFromRequestContext()));

// /culture/challenges/[id]/edit: the challenge row alone (organizers; the page checks). null when missing.
export async function loadChallengeRow(id) {
  if (!/^[0-9]{1,18}$/.test(String(id ?? ''))) return null;
  try {
    const r = await query(`${CHALLENGE_SELECT} WHERE c.id = $1::bigint`, [String(id)]);
    return shapeChallenge(r.rows[0]);
  } catch (e) {
    throw tagUpdating(e);
  }
}

// The offices an organizer can aim a challenge at (non-archived, plus the challenge's own office if archived, plus
// the offices playing in a bingo challenge). playing = in that bingo now; geo_on = a GeoGuessr office (the default
// players of a new bingo).
export async function listChallengeOffices(includeId = null, challengeId = null) {
  try {
    const r = await query(`SELECT o.id, o.name, o.archived, o.geo_on,
        EXISTS (SELECT 1 FROM culture_bingo_offices b WHERE b.challenge_id = $2::bigint AND b.office_id = o.id) AS playing,
        EXISTS (SELECT 1 FROM culture_bingo_picks p WHERE p.challenge_id = $2::bigint AND p.office_id = o.id AND p.undone_at IS NULL) AS marked
      FROM offices o
      WHERE NOT o.archived OR o.id = $1::bigint
         OR EXISTS (SELECT 1 FROM culture_bingo_offices b WHERE b.challenge_id = $2::bigint AND b.office_id = o.id)
      ORDER BY o.position ASC, o.id ASC`, [includeId == null ? null : String(includeId), challengeId == null ? null : String(challengeId)]);
    return r.rows.map((o) => ({ id: String(o.id), name: o.name, archived: !!o.archived, geo_on: !!o.geo_on,
      playing: !!o.playing, marked: !!o.marked }));
  } catch (e) {
    throw tagUpdating(e);
  }
}

// For the culture calendar (design §10(b), agent K2): non-archived challenges overlapping [from, to] (dates
// 'YYYY-MM-DD'), as all-day range bars. Company-public.
export async function listChallengesInRange(from, to) {
  const r = await query(`SELECT c.id, c.title, c.metric_label, c.starts_on, c.ends_on, c.office_id, o.name AS office_name
    FROM culture_challenges c LEFT JOIN offices o ON o.id = c.office_id
    WHERE c.archived_at IS NULL AND c.starts_on <= $2::text AND c.ends_on >= $1::text
    ORDER BY c.starts_on ASC, c.id ASC`, [String(from), String(to)]);
  return r.rows.map((x) => ({ id: String(x.id), title: x.title, metric_label: x.metric_label, starts_on: x.starts_on,
    ends_on: x.ends_on, office_id: idOrNull(x.office_id), office_name: x.office_name ?? null,
    href: `/culture/challenges/${x.id}` }));
}

// ---------------------------------------------------------------- challenge writes (organizers)

// Normalizers: single-line fields are trimmed, the description (notes markup) is only capped (design §7.1).
const NORM = {
  title: norm.line(LIMITS.title),
  description: norm.text(LIMITS.description),
  metric_label: (v) => str(v, LIMITS.metric_label) || 'Points',
  unit: norm.line(LIMITS.unit),
};
const TEXT_FIELDS = ['title', 'description', 'metric_label', 'unit'];

const pickAggregation = (v) => { if (!AGGREGATION_KEYS.includes(v)) throw bad('Pick how scores add up.'); return v; };
const pickGroupRank = (v) => { if (!GROUP_RANK_KEYS.includes(v)) throw bad('Pick how offices and departments rank.'); return v; };
const pickBool = (v, msg) => { if (typeof v !== 'boolean') throw bad(msg); return v; };
const pickDate = (v, label) => { const d = typeof v === 'string' ? ymd(v) : null; if (!d) throw bad(`Pick the ${label} date.`); return d; };
function checkRange(a, b) {
  if (b < a) throw bad('The end date can’t be before the start date.');
  if (daysBetween(a, b) + 1 > MAX_RANGE_DAYS) throw bad('A challenge can run for a year at most.');
}
async function pickOffice(v) {
  if (v == null || v === '' || v === 'company') return null;
  const id = /^[0-9]{1,18}$/.test(String(v)) ? String(v) : null;
  if (!id) throw bad('Pick an office.');
  const r = await query(`SELECT id FROM offices WHERE id = $1::bigint AND NOT archived`, [id]);
  if (!r.rows[0]) throw bad('Pick an office.');
  return id;
}

// POST /api/culture/challenges { title, description?, metric_label?, unit?, aggregation?, higher_is_better?,
// group_rank?, starts_on?, ends_on?, office_id? } -> the stored challenge. Dates default to this calendar month
// (Central). Organizers only (the route's handle() checks).
export async function createChallenge(viewer, b, now) {
  for (const k of TEXT_FIELDS) noNul(b[k]);
  const title = NORM.title(b.title);
  if (!title) throw bad('Give the challenge a title.');
  if (b.kind != null && b.kind !== 'stats' && b.kind !== 'bingo') throw bad('Pick the kind of challenge.');
  if (b.kind === 'bingo') return createBingo(viewer, b, title, now);
  const month = monthRange(chicagoToday(now));
  const starts_on = b.starts_on == null || b.starts_on === '' ? month.starts_on : pickDate(b.starts_on, 'start');
  const ends_on = b.ends_on == null || b.ends_on === '' ? (b.starts_on ? monthRange(starts_on).ends_on : month.ends_on) : pickDate(b.ends_on, 'end');
  checkRange(starts_on, ends_on);
  const v = {
    title, description: NORM.description(b.description), metric_label: NORM.metric_label(b.metric_label),
    unit: NORM.unit(b.unit),
    aggregation: b.aggregation == null ? 'sum' : pickAggregation(b.aggregation),
    higher_is_better: b.higher_is_better == null ? true : pickBool(b.higher_is_better, 'Say whether higher or lower wins.'),
    group_rank: b.group_rank == null ? 'avg' : pickGroupRank(b.group_rank),
    office_id: await pickOffice(b.office_id),
  };
  const r = await query(`INSERT INTO culture_challenges (title, description, metric_label, unit, aggregation, higher_is_better,
      group_rank, starts_on, ends_on, office_id, created_by, updated_at, updated_by)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::bigint, $11::bigint, now(), $11::bigint) RETURNING id`,
  [v.title, v.description, v.metric_label, v.unit, v.aggregation, v.higher_is_better, v.group_rank, starts_on, ends_on,
    v.office_id, String(viewer.id)]);
  return loadChallengeRow(r.rows[0].id);
}

// Office bingo (lib/bingo.js): { kind: 'bingo', title, description?, starts_on?, ends_on?, squares? (25 labels; the
// default is the GeoGuessr card), office_ids? (default: the GeoGuessr offices) }. Company-wide (office_id NULL);
// the metric columns keep neutral values the bingo screens never show.
async function createBingo(viewer, b, title, now) {
  const month = monthRange(chicagoToday(now));
  const starts_on = b.starts_on == null || b.starts_on === '' ? month.starts_on : pickDate(b.starts_on, 'start');
  const ends_on = b.ends_on == null || b.ends_on === '' ? (b.starts_on ? monthRange(starts_on).ends_on : month.ends_on) : pickDate(b.ends_on, 'end');
  checkRange(starts_on, ends_on);
  const squares = b.squares == null ? DEFAULT_SQUARES : cleanSquares(b.squares);
  if (!squares) throw bad('The card needs 25 squares, each with some text (120 characters at most).');
  const officeIds = b.office_ids == null ? await geoOfficeIds() : await pickBingoOffices(b.office_ids);
  if (!officeIds.length) throw bad('Pick at least one office to play.');
  const r = await query(`WITH c AS (
      INSERT INTO culture_challenges (title, description, metric_label, unit, aggregation, higher_is_better, group_rank,
        starts_on, ends_on, office_id, created_by, updated_at, updated_by, kind, bingo_squares)
      VALUES ($1, $2, 'Squares', '', 'count', true, 'sum', $3, $4, NULL, $5::bigint, now(), $5::bigint, 'bingo', $6)
      RETURNING id)
    INSERT INTO culture_bingo_offices (challenge_id, office_id) SELECT c.id, o FROM c, unnest($7::bigint[]) o RETURNING challenge_id`,
  [title, NORM.description(b.description), starts_on, ends_on, String(viewer.id), JSON.stringify(squares), officeIds]);
  return loadChallengeRow(r.rows[0].challenge_id);
}

const CHALLENGE_COLUMNS = {
  title: { type: 'text', text: true, norm: NORM.title },
  description: { type: 'text', text: true, norm: NORM.description },
  metric_label: { type: 'text', text: true, norm: NORM.metric_label },
  unit: { type: 'text', text: true, norm: NORM.unit },
  aggregation: { type: 'text' },
  higher_is_better: { type: 'boolean' },
  group_rank: { type: 'text' },
  starts_on: { type: 'text' },
  ends_on: { type: 'text' },
  office_id: { type: 'bigint' },
  bingo_squares: { type: 'text' },
  // { archived: true } archives (keeps the first archive time), { archived: false } restores.
  archived_at: { type: 'timestamptz', expr: (ph) => `CASE WHEN ${ph}::timestamptz IS NULL THEN NULL ELSE COALESCE(archived_at, now()) END` },
};

// PATCH /api/culture/challenges/:id: any of the fields (text ones with base, design §7.3), { archived }.
// Organizers only. 404 'gone' for a missing id.
export async function patchChallenge(viewer, id, b, now) {
  const cid = parseId(id);
  const cur = await loadChallengeRow(cid);
  if (!cur) throw gone();
  const bingo = cur.kind === 'bingo';
  if (has(b, 'kind') && b.kind !== cur.kind) throw bad('A challenge keeps its kind. Set up a new one instead.');
  if (!bingo && (has(b, 'squares') || has(b, 'office_ids'))) throw bad('Only a CAGEO challenge has squares and playing offices.');
  const body = {};
  if (has(b, 'base')) body.base = b.base;
  if (has(b, 'squares')) {
    const squares = cleanSquares(b.squares);
    if (!squares) throw bad('The card needs 25 squares, each with some text (120 characters at most).');
    body.bingo_squares = JSON.stringify(squares);
  }
  const officeIds = has(b, 'office_ids') ? await pickBingoOffices(b.office_ids, cid) : null;
  for (const k of TEXT_FIELDS) {
    if (!has(b, k)) continue;
    noNul(b[k]);
    if (b.base && typeof b.base === 'object') noNul(b.base[k]);
    body[k] = b[k];
  }
  if (has(body, 'title') && !NORM.title(body.title)) throw bad('Give the challenge a title.');
  if (has(b, 'aggregation')) body.aggregation = pickAggregation(b.aggregation);
  if (has(b, 'higher_is_better')) body.higher_is_better = pickBool(b.higher_is_better, 'Say whether higher or lower wins.');
  if (has(b, 'group_rank')) body.group_rank = pickGroupRank(b.group_rank);
  if (has(b, 'starts_on') || has(b, 'ends_on')) {
    const s = has(b, 'starts_on') ? pickDate(b.starts_on, 'start') : cur.starts_on;
    const e = has(b, 'ends_on') ? pickDate(b.ends_on, 'end') : cur.ends_on;
    checkRange(s, e);
    if (has(b, 'starts_on')) body.starts_on = s;
    if (has(b, 'ends_on')) body.ends_on = e;
  }
  if (bingo && has(b, 'office_id') && b.office_id != null && b.office_id !== '') throw bad('A CAGEO challenge is for the playing offices; pick them instead.');
  if (!bingo && has(b, 'office_id')) {
    const same = b.office_id != null && b.office_id !== '' && String(b.office_id) === String(cur.office_id);
    body.office_id = same ? cur.office_id : await pickOffice(b.office_id);
  }
  if (has(b, 'archived')) body.archived_at = pickBool(b.archived, 'Invalid request.') ? new Date(now).toISOString() : null;
  if (officeIds) await setBingoOffices(cid, officeIds);
  const { row } = await guardedPatch({
    table: 'culture_challenges', id: cid, body, columns: CHALLENGE_COLUMNS, actorId: viewer.id, now,
    // The range stays valid even if another organizer moved the other date meanwhile (a CHECK backs this up).
  });
  return { ...(await loadChallengeRow(row.id)) };
}

// ---------------------------------------------------------------- entries

const ENTRY_LOCK = 7342021;   // with the user id: one person's concurrent logs are counted one at a time
const noteNorm = norm.line(LIMITS.note);

function pickEntryValue(c, raw) {
  if (c.aggregation === 'count' && (raw == null || raw === '')) return 1;
  const v = parseValue(raw);
  if (v == null) throw bad('Enter a number from 0 to 1,000,000 (up to 2 decimals).');
  return v;
}
function pickEntryDate(c, raw, today) {
  const d = typeof raw === 'string' ? ymd(raw) : null;
  if (!d) throw bad('Pick the date.');
  const bounds = entryDateBounds(c, today);
  if (!bounds || d < bounds.min || d > bounds.max) {
    throw bad(bounds
      ? `Pick a date from ${fmtDay(bounds.min)} to ${fmtDay(bounds.max)}.`
      : `Logging opens ${fmtDay(addDays(c.starts_on, -1))}.`);
  }
  return d;
}
const closedMessage = (c) => `This challenge closed for changes after ${fmtDay(entriesCloseOn(c), { year: true })}.`;

// POST /api/culture/challenges/:id/entries { entry_date, value, note? } -> the stored entry. Participants only (all
// for a company challenge, that office's people for an office one); the date inside the challenge and no later than
// tomorrow (Central); at most 20 entries per person per day; snapshots the person's office and department.
export async function createEntry(viewer, challengeId, b, now) {
  const cid = parseId(challengeId);
  const c = await loadChallengeRow(cid);
  if (!c || c.archived) throw notFoundChallenge();
  if (c.kind === 'bingo') throw bad('This is CAGEO: mark a square on your office’s card instead.');
  const today = chicagoToday(now);
  if (!isParticipant(viewer, c)) throw forbidden(`This challenge is for the ${c.office_name || 'office'}’s people.`);
  if (!entryDateBounds(c, today)) throw bad(`Logging opens ${fmtDay(addDays(c.starts_on, -1))}.`);
  if (!canLogStats(viewer, c, today)) throw forbidden(closedMessage(c));
  noNul(b.note);
  const entry_date = pickEntryDate(c, b.entry_date, today);
  const value = pickEntryValue(c, b.value);
  const note = noteNorm(b.note);
  const uid = String(viewer.id);
  const res = await transaction([
    query(`SELECT pg_advisory_xact_lock($1::int, ($2::bigint % 2147483647)::int)`, [ENTRY_LOCK, uid]),
    query(`INSERT INTO culture_entries (challenge_id, user_id, office_id, department_id, entry_date, value, note)
           SELECT c.id, u.id, u.office_id, u.department_id, $3::text, $4::numeric, $5::text
           FROM culture_challenges c JOIN users u ON u.id = $2::bigint
           WHERE c.id = $1::bigint AND c.archived_at IS NULL
             AND (SELECT count(*) FROM culture_entries x WHERE x.challenge_id = c.id AND x.user_id = u.id
                    AND x.entry_date = $3::text AND x.deleted_at IS NULL) < $6::int
           RETURNING *`, [cid, uid, entry_date, value, note, MAX_ENTRIES_PER_DAY]),
  ]);
  const row = res[1].rows[0];
  if (!row) {
    const again = await loadChallengeRow(cid);
    if (!again || again.archived) throw notFoundChallenge();
    throw new HttpError(409, `You’ve logged ${MAX_ENTRIES_PER_DAY} entries for ${fmtDay(entry_date)} already. Edit one of them instead.`);
  }
  return shapeEntry(row);
}

// The entry with its challenge, for the viewer: null when it's missing, or isn't theirs and they aren't an organizer
// (entries are private; the same answer as a missing id).
async function entryForViewer(viewer, id, { deleted = false } = {}) {
  const r = await query(`SELECT e.*, c.starts_on, c.ends_on, c.aggregation, c.higher_is_better, c.office_id AS c_office_id,
                                c.archived_at AS c_archived_at, c.title AS c_title
    FROM culture_entries e JOIN culture_challenges c ON c.id = e.challenge_id
    WHERE e.id = $1::bigint AND ${deleted ? 'e.deleted_at IS NOT NULL' : 'e.deleted_at IS NULL'}
      AND (e.user_id = $2::bigint OR $3::boolean)`, [String(id), String(viewer.id), isOrganizer(viewer)]);
  const e = r.rows[0];
  if (!e) return null;
  const c = { id: String(e.challenge_id), starts_on: e.starts_on, ends_on: e.ends_on, aggregation: e.aggregation,
    higher_is_better: e.higher_is_better !== false, office_id: idOrNull(e.c_office_id), archived: e.c_archived_at != null };
  return { e, c };
}

const ENTRY_COLUMNS = {
  entry_date: { type: 'text' },
  value: { type: 'numeric' },
  note: { type: 'text', text: true, norm: noteNorm },
};

// PATCH /api/culture/entries/:id { entry_date?, value?, note? (+ base.note) } -> the stored entry;
// { deleted: false } restores a soft-deleted entry (the Undo after a delete). Owner until ends_on + 3 days,
// organizers any time. Someone else's entry (non-organizer) or a missing one: 404 'gone'.
export async function patchEntry(viewer, id, b, now) {
  const eid = parseId(id);
  const today = chicagoToday(now);
  const uid = String(viewer.id);
  const org = isOrganizer(viewer);
  if (has(b, 'deleted')) {
    if (b.deleted !== false) throw bad();
    const found = await entryForViewer(viewer, eid, { deleted: true });
    if (!found) {
      const live = await entryForViewer(viewer, eid);
      if (live && !(live.c.archived && !org)) return shapeEntry(live.e);          // already restored
      throw gone();
    }
    if (found.c.archived && !org) throw gone();
    if (!canChangeEntry(viewer, found.e, found.c, today)) throw forbidden(closedMessage(found.c));
    const r = await query(`UPDATE culture_entries SET deleted_at = NULL, deleted_by = NULL, updated_at = now(), updated_by = $2::bigint
      WHERE id = $1::bigint AND deleted_at IS NOT NULL AND (user_id = $2::bigint OR $3::boolean) RETURNING *`, [eid, uid, org]);
    if (!r.rows[0]) throw gone();
    return shapeEntry(r.rows[0]);
  }
  const found = await entryForViewer(viewer, eid);
  if (!found) throw gone();
  const { e, c } = found;
  if (c.archived && !org) throw gone();
  if (!canChangeEntry(viewer, e, c, today)) throw forbidden(closedMessage(c));
  const body = {};
  if (has(b, 'entry_date')) {
    const d = typeof b.entry_date === 'string' ? ymd(b.entry_date) : null;
    // An unchanged date is always fine (an organizer fixing a value after the challenge).
    body.entry_date = d && d === e.entry_date ? d : pickEntryDate(c, b.entry_date, today);
  }
  if (has(b, 'value')) body.value = pickEntryValue(c, b.value);
  if (has(b, 'note')) {
    noNul(b.note);
    if (b.base && typeof b.base === 'object') noNul(b.base.note);
    body.note = b.note;
    if (has(b, 'base')) body.base = b.base;
  }
  const { row } = await guardedPatch({
    table: 'culture_entries', id: eid, body, columns: ENTRY_COLUMNS, actorId: uid, now,
    scopeSql: 'deleted_at IS NULL AND (user_id = $1::bigint OR $2::boolean)', scopeParams: [uid, org],
    extraSet: (p) => [`updated_by = ${p(uid)}::bigint`],
  });
  return shapeEntry(row);
}

// DELETE /api/culture/entries/:id: soft delete (deleted_at / deleted_by; nothing is ever removed). A missing,
// already deleted or someone else's entry (non-organizer) answers { ok: true } and changes nothing (§7.1).
export async function deleteEntry(viewer, id, now) {
  const eid = parseId(id);
  const found = await entryForViewer(viewer, eid);
  // An archived challenge's entries are out of reach for everyone but organizers: like a missing one.
  if (!found || (found.c.archived && !isOrganizer(viewer))) return { ok: true, deleted: false };
  if (!canChangeEntry(viewer, found.e, found.c, chicagoToday(now))) throw forbidden(closedMessage(found.c));
  const r = await query(`UPDATE culture_entries SET deleted_at = now(), deleted_by = $2::bigint
    WHERE id = $1::bigint AND deleted_at IS NULL AND (user_id = $2::bigint OR $3::boolean) RETURNING id`,
  [eid, String(viewer.id), isOrganizer(viewer)]);
  return { ok: true, deleted: !!r.rows[0], id: eid };
}

// GET /api/culture/challenges/:id/entries -> { entries } (mine), or every entry for organizers with ?all=1.
export async function listEntries(viewer, challengeId, { all = false } = {}) {
  const cid = parseId(challengeId);
  const c = await loadChallengeRow(cid);
  const org = isOrganizer(viewer);
  if (!c || (c.archived && !org)) throw notFoundChallenge();
  const everyone = all && org;
  const r = await query(`SELECT e.id, e.challenge_id, e.user_id, e.entry_date, e.value, e.note, e.created_at, e.updated_at, e.updated_by,
                                ${NAME_SQL('u')} AS user_name, u.username
    FROM culture_entries e JOIN users u ON u.id = e.user_id
    WHERE e.challenge_id = $1::bigint AND e.deleted_at IS NULL AND (e.user_id = $2::bigint OR $3::boolean)
    ORDER BY e.entry_date DESC, e.id DESC LIMIT 2000`, [cid, String(viewer.id), everyone]);
  return { entries: r.rows.map(shapeEntry) };
}
