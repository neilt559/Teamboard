import 'server-only';
import { query, transaction } from '../db.js';
import { HttpError, bad, forbidden, parseId } from '../http.js';
import { chicagoToday } from '../time.js';
import { isParticipant } from '../challenges.js';
import { COOK_NAME_MAX, MAX_CHILIS, chiliOpen, isRevealed, isYmd, mondayOf, parseScore, rankChilis } from '../chili.js';

// Chili cook-off (Neil, 2026-10-20; rules in lib/chili.js): the weekly chilis, blind secret ratings, the reveal.
// SECRECY is enforced here, for every viewer including admins and organizers: before the reveal nothing that leaves
// this file carries another person's score, an average, or who cooked a chili (a cook only learns "this is your
// chili"). After the reveal: each chili's average, count and cook; never who gave which score.
// No import from ./challenges.js (it imports this file).

const READ = { readOnly: true, isolationLevel: 'RepeatableRead' };
const NAME_SQL = (a) => `COALESCE(NULLIF(${a}.display_name, ''), ${a}.username)`;
const ROW = `SELECT c.id, c.title, c.kind, c.starts_on, c.ends_on, c.office_id, c.archived_at, c.revealed_at
  FROM culture_challenges c WHERE c.id = $1::bigint`;
const shapeRow = (r) => (r ? { id: String(r.id), title: r.title || '', kind: r.kind, starts_on: r.starts_on, ends_on: r.ends_on,
  office_id: r.office_id == null ? null : String(r.office_id), archived: r.archived_at != null,
  revealed_at: r.revealed_at ? new Date(r.revealed_at).toISOString() : null } : null);

// Every non-archived chili of some challenges, in week order, with the viewer's own rating and the rating count;
// cooks and averages are read too, but only shape() decides what leaves.
async function chiliRows(ids, viewerId) {
  if (!ids.length) return [];
  const r = await query(`SELECT x.id, x.challenge_id, x.week_of, x.cook_user_id,
      COALESCE((SELECT ${NAME_SQL('u')} FROM users u WHERE u.id = x.cook_user_id), NULLIF(x.cook_name, ''), 'Unnamed cook') AS cook,
      (SELECT count(*) FROM culture_chili_ratings g WHERE g.chili_id = x.id)::int AS count,
      (SELECT round(avg(g.score)::numeric, 2) FROM culture_chili_ratings g WHERE g.chili_id = x.id) AS average,
      (SELECT g.score FROM culture_chili_ratings g WHERE g.chili_id = x.id AND g.user_id = $2::bigint) AS mine
    FROM culture_chilis x WHERE x.challenge_id = ANY($1::bigint[]) AND x.archived_at IS NULL
    ORDER BY x.week_of ASC, x.id ASC`, [ids, String(viewerId)]);
  return r.rows;
}

// What the viewer may see of one challenge's chilis.
function shape(viewer, c, rows, today) {
  const revealed = isRevealed(c, today);
  const uid = String(viewer.id);
  const list = rows.map((x, i) => {
    const isCook = x.cook_user_id != null && String(x.cook_user_id) === uid;
    const base = {
      id: String(x.id), n: i + 1, week_of: x.week_of, count: Number(x.count) || 0,
      mine: x.mine == null ? null : Number(x.mine), is_cook: isCook,
      open: chiliOpen(c, x, today) && !isCook, upcoming: today < x.week_of,
    };
    return revealed ? { ...base, cook_name: x.cook, average: x.average == null ? null : Number(x.average) } : base;
  });
  return {
    revealed,
    chilis: revealed ? rankChilis(list) : list,
    my_rated: list.filter((x) => x.mine != null).length,
    total: list.length,
  };
}

// The challenge page for a chili cook-off (lib/queries/challenges.js loadChallenge hands over once it sees the kind).
export async function loadChili(viewer, c, now) {
  const today = chicagoToday(now);
  const rows = await chiliRows([c.id], viewer.id);
  return shape(viewer, c, rows, today);
}

// The cards (list, Home, Culture): per chili challenge the viewer's progress, the next chili, and after the reveal
// the winner(s).   -> Map(id -> { chili: { total, my_rated, revealed, next_week_of, winners: [{ cook_name, average }] }, can_rate })
export async function chiliSummaries(viewer, challenges, today) {
  const list = challenges.filter((c) => c.kind === 'chili');
  const out = new Map();
  if (!list.length) return out;
  const rows = await chiliRows(list.map((c) => c.id), viewer.id);
  for (const c of list) {
    const s = shape(viewer, c, rows.filter((x) => String(x.challenge_id) === c.id), today);
    const next = s.chilis.filter((x) => x.week_of >= mondayOf(today)).sort((a, b) => (a.week_of < b.week_of ? -1 : 1))[0];
    out.set(c.id, {
      chili: {
        total: s.total, my_rated: s.my_rated, revealed: s.revealed, next_week_of: next ? next.week_of : null,
        winners: s.revealed ? s.chilis.filter((x) => x.rank === 1).map((x) => ({ cook_name: x.cook_name, average: x.average })) : [],
      },
      can_rate: !s.revealed && isParticipant(viewer, c) && s.chilis.some((x) => x.open && x.mine == null),
    });
  }
  return out;
}

// ---------------------------------------------------------------- the schedule (challenge create / edit)

// chilis as sent: [{ id?, week_of, cook_user_id?, cook_name? }], 1..20 of them. week_of may be any day of the week
// (it is stored as that week's Monday); the cook is an active account or a name. Returns the clean list, or 400.
export async function pickChilis(raw) {
  if (!Array.isArray(raw) || !raw.length) throw bad('Add at least one chili week.');
  if (raw.length > MAX_CHILIS) throw bad(`A cook-off has ${MAX_CHILIS} chilis at most.`);
  const out = raw.map((x) => {
    if (!x || typeof x !== 'object' || !isYmd(x.week_of)) throw bad('Pick the week for every chili.');
    const id = x.id == null || x.id === '' ? null : String(x.id);
    if (id && !/^[0-9]{1,18}$/.test(id)) throw bad('Invalid chili.');
    const uid = x.cook_user_id == null || x.cook_user_id === '' ? null : String(x.cook_user_id);
    if (uid && !/^[0-9]{1,18}$/.test(uid)) throw bad('Pick the cook from the list.');
    const name = typeof x.cook_name === 'string' ? x.cook_name.replace(/\s+/g, ' ').trim() : '';
    if (name.includes('\u0000') || name.length > COOK_NAME_MAX) throw bad('That cook name is too long.');
    if (!uid && !name) throw bad('Pick or type the cook for every chili.');
    return { id, week_of: mondayOf(x.week_of), cook_user_id: uid, cook_name: uid ? '' : name };
  });
  const uids = [...new Set(out.map((x) => x.cook_user_id).filter(Boolean))];
  if (uids.length) {
    const r = await query(`SELECT id FROM users WHERE id = ANY($1::bigint[]) AND disabled_at IS NULL`, [uids]);
    if (r.rows.length !== uids.length) throw bad('Pick the cook from the list.');
  }
  return out;
}

// Make the challenge's chilis exactly list: update the ones with an id, add the new ones, archive the left-out ones
// (their ratings stay; nothing is deleted).
export async function setChilis(challengeId, list) {
  const cid = String(challengeId);
  const cur = (await query(`SELECT id FROM culture_chilis WHERE challenge_id = $1::bigint AND archived_at IS NULL`, [cid])).rows.map((r) => String(r.id));
  const keep = list.filter((x) => x.id);
  if (keep.some((x) => !cur.includes(x.id))) throw bad('Invalid chili.');
  const qs = [];
  for (const x of keep) {
    qs.push(query(`UPDATE culture_chilis SET week_of = $2::text, cook_user_id = $3::bigint, cook_name = $4::text
      WHERE id = $1::bigint AND challenge_id = $5::bigint`, [x.id, x.week_of, x.cook_user_id, x.cook_name, cid]));
  }
  for (const x of list.filter((y) => !y.id)) {
    qs.push(query(`INSERT INTO culture_chilis (challenge_id, week_of, cook_user_id, cook_name) VALUES ($1::bigint, $2::text, $3::bigint, $4::text)`,
      [cid, x.week_of, x.cook_user_id, x.cook_name]));
  }
  const gone = cur.filter((id) => !keep.some((x) => x.id === id));
  if (gone.length) qs.push(query(`UPDATE culture_chilis SET archived_at = now() WHERE id = ANY($1::bigint[]) AND archived_at IS NULL`, [gone]));
  if (qs.length) await transaction(qs);
}

// The organizer's view of the schedule (the edit form only; organizers, the page checks): cooks included.
export async function chiliSchedule(challengeId) {
  const r = await query(`SELECT x.id, x.week_of, x.cook_user_id, x.cook_name,
      (SELECT count(*) FROM culture_chili_ratings g WHERE g.chili_id = x.id)::int AS count
    FROM culture_chilis x WHERE x.challenge_id = $1::bigint AND x.archived_at IS NULL ORDER BY x.week_of, x.id`, [String(challengeId)]);
  return r.rows.map((x) => ({ id: String(x.id), week_of: x.week_of, cook_user_id: x.cook_user_id == null ? '' : String(x.cook_user_id),
    cook_name: x.cook_name || '', count: Number(x.count) }));
}

// The people a cook can be picked from (the setup form): active accounts, not test accounts, by name.
export async function listCookChoices() {
  const r = await query(`SELECT u.id, ${NAME_SQL('u')} AS name, o.name AS office FROM users u LEFT JOIN offices o ON o.id = u.office_id
    WHERE u.disabled_at IS NULL AND u.username NOT LIKE 'zz!_%' ESCAPE '!' ORDER BY lower(${NAME_SQL('u')}), u.id`);
  return r.rows.map((u) => ({ id: String(u.id), name: u.name, office: u.office || '' }));
}

// ---------------------------------------------------------------- rating

// POST /api/culture/chilis/:id/rating { score } -> { ok, chili: { id, mine, count } }: the viewer's rating for one
// chili (set or changed). The challenge's people only (everyone for a company challenge); from the chili's week
// until the reveal; never your own chili. The answer carries only the viewer's own score and the count.
export async function rateChili(viewer, chiliId, b, now) {
  const id = parseId(chiliId);
  const today = chicagoToday(now);
  const x = (await query(`SELECT id, challenge_id, week_of, cook_user_id, archived_at FROM culture_chilis WHERE id = $1::bigint`, [id])).rows[0];
  if (!x || x.archived_at) throw new HttpError(404, 'That chili is gone.');
  const c = shapeRow((await query(ROW, [String(x.challenge_id)])).rows[0]);
  if (!c || c.archived || c.kind !== 'chili') throw new HttpError(404, 'That chili is gone.');
  const score = parseScore(b?.score);
  if (score == null) throw bad('Rate it from 1 to 10.');
  if (!isParticipant(viewer, c)) throw forbidden('This cook-off is for another office’s people.');
  if (x.cook_user_id != null && String(x.cook_user_id) === String(viewer.id)) throw forbidden('You can’t rate your own chili.');
  if (isRevealed(c, today)) throw new HttpError(409, 'The results are out, so ratings are closed.');
  if (today < x.week_of) throw new HttpError(409, 'This chili isn’t ready to rate yet.');
  const at = new Date(now).toISOString();
  await query(`INSERT INTO culture_chili_ratings (chili_id, user_id, score, created_at) VALUES ($1::bigint, $2::bigint, $3::smallint, $4::timestamptz)
    ON CONFLICT (chili_id, user_id) DO UPDATE SET score = EXCLUDED.score, updated_at = EXCLUDED.created_at`, [id, String(viewer.id), score, at]);
  const count = Number((await query(`SELECT count(*)::int AS n FROM culture_chili_ratings WHERE chili_id = $1::bigint`, [id])).rows[0].n);
  return { id: String(x.id), mine: score, count };
}
