import 'server-only';
import { query, transaction } from '../db.js';
import { HttpError, bad, forbidden, parseId } from '../http.js';
import { isOrganizer } from '../policy.js';
import { chicagoToday } from '../time.js';
import { fmtDay } from '../challenges.js';
import { CELLS, canMark, canUndo, inOffice, officeProgress, readSquares, winners } from '../bingo.js';

// Office bingo (Neil, 2026-10-19; rules in lib/bingo.js): the playing offices, their picks, marking a square and
// undoing a pick. Company-public like every challenge: everyone sees every office's card and who marked what.
// The one-square-a-day rule lives in the database (culture_bingo_picks_day_uq), so two people marking for the same
// office at the same moment can't both get one in; the checks here only turn that into a plain message.
// No import from ./challenges.js (it imports this file); the challenge row is read here directly.

const READ = { readOnly: true, isolationLevel: 'RepeatableRead' };
const iso = (v) => { if (v == null) return null; const d = v instanceof Date ? v : new Date(v); return Number.isNaN(d.getTime()) ? null : d.toISOString(); };
const NAME_SQL = (a) => `COALESCE(NULLIF(${a}.display_name, ''), ${a}.username)`;
const ROW = `SELECT c.id, c.title, c.kind, c.bingo_squares, c.starts_on, c.ends_on, c.archived_at FROM culture_challenges c WHERE c.id = $1::bigint`;
const shapeRow = (r) => (r ? { id: String(r.id), title: r.title || '', kind: r.kind, squares: readSquares(r.bingo_squares),
  starts_on: r.starts_on, ends_on: r.ends_on, archived: r.archived_at != null } : null);

const shapePick = (r) => ({
  id: String(r.id), challenge_id: String(r.challenge_id), office_id: String(r.office_id), square: Number(r.square),
  play_date: r.play_date, created_at: iso(r.created_at), picked_by: r.picked_by == null ? null : String(r.picked_by),
  picked_by_name: r.picked_by_name ?? null,
});

// The playing offices and their standing picks for some bingo challenges, in one read.
//   -> Map(challenge id -> [{ id, name, position, picks: [...] }])
export async function bingoOffices(ids) {
  const out = new Map();
  if (!ids.length) return out;
  const [offs, picks] = (await transaction([
    query(`SELECT b.challenge_id, o.id, o.name, o.position FROM culture_bingo_offices b JOIN offices o ON o.id = b.office_id
           WHERE b.challenge_id = ANY($1::bigint[]) ORDER BY o.position ASC, o.id ASC`, [ids]),
    query(`SELECT p.id, p.challenge_id, p.office_id, p.square, p.play_date, p.created_at, p.picked_by,
                  (SELECT ${NAME_SQL('u')} FROM users u WHERE u.id = p.picked_by) AS picked_by_name
           FROM culture_bingo_picks p
           WHERE p.challenge_id = ANY($1::bigint[]) AND p.undone_at IS NULL
           ORDER BY p.play_date ASC, p.created_at ASC, p.id ASC`, [ids]),
  ], READ)).map((r) => r.rows);
  for (const id of ids) out.set(String(id), []);
  const byKey = new Map();
  for (const o of offs) {
    const office = { id: String(o.id), name: o.name, position: Number(o.position), picks: [] };
    out.get(String(o.challenge_id))?.push(office);
    byKey.set(`${o.challenge_id}|${o.id}`, office);
  }
  // A pick whose office has left the game still counts in history, never on a card.
  for (const p of picks) byKey.get(`${p.challenge_id}|${p.office_id}`)?.picks.push(shapePick(p));
  return out;
}

// The viewer's offices first (home office before extra ones), then the rest in office order.
function orderFor(viewer, offices) {
  const rank = (o) => (String(o.id) === String(viewer.office_id) ? 0 : inOffice(viewer, o.id) ? 1 : 2);
  return [...offices].sort((a, b) => rank(a) - rank(b) || a.position - b.position || Number(a.id) - Number(b.id));
}

// The bingo part of the challenge page (and of every mark / undo answer).
//   -> { offices: [{ id, name, mine, picks, marks, lines, bingo_pick_id, corners_pick_id, letters_pick_id, today_pick, can_mark }], winners }
export function bingoBoard(viewer, c, offices, today) {
  const playing = offices.map((o) => o.id);
  return {
    offices: orderFor(viewer, offices).map((o) => {
      const prog = officeProgress(o.picks);
      const todayPick = o.picks.find((p) => p.play_date === today) || null;
      return {
        id: o.id, name: o.name, mine: inOffice(viewer, o.id), picks: o.picks, marks: prog.marked.size, lines: prog.lines,
        bingo_pick_id: prog.bingo ? prog.bingo.pick.id : null, bingo_line: prog.bingo ? prog.bingo.line : null,
        corners_pick_id: prog.corners ? prog.corners.pick.id : null, letters_pick_id: prog.letters ? prog.letters.pick.id : null,
        today_pick: todayPick, can_mark: !todayPick && canMark(viewer, c, o.id, playing, today),
      };
    }),
    winners: winners(offices),
  };
}

// The challenge page for a bingo challenge (lib/queries/challenges.js loadChallenge hands over once it sees the kind).
export async function loadBingo(viewer, c, now) {
  const today = chicagoToday(now);
  const offices = (await bingoOffices([c.id])).get(String(c.id)) || [];
  return { offices, board: bingoBoard(viewer, c, offices, today), today };
}

// The cards (list, Home, Culture): per bingo challenge, each office's marks and prizes, the winners, and whether the
// viewer can mark a square for one of their offices today.
//   -> Map(id -> { bingo: { offices: [{ id, name, marks, bingo, corners, letters, mine, picked_today }], winners }, can_mark })
export async function bingoSummaries(viewer, challenges, today) {
  const list = challenges.filter((c) => c.kind === 'bingo');
  const out = new Map();
  if (!list.length) return out;
  const offs = await bingoOffices(list.map((c) => c.id));
  for (const c of list) {
    const board = bingoBoard(viewer, c, offs.get(c.id) || [], today);
    out.set(c.id, {
      bingo: {
        offices: board.offices.map((o) => ({ id: o.id, name: o.name, marks: o.marks, bingo: !!o.bingo_pick_id,
          corners: !!o.corners_pick_id, letters: !!o.letters_pick_id, mine: o.mine, picked_today: !!o.today_pick })),
        winners: board.winners,
      },
      can_mark: board.offices.some((o) => o.can_mark),
    });
  }
  return out;
}

// ---------------------------------------------------------------- setup (challenge create / edit)

// office_ids as sent: a non-empty list of distinct office ids that exist and aren't archived (an office already
// playing in this challenge may stay even if it was archived since). Returns the ids, or 400.
export async function pickBingoOffices(raw, challengeId = null) {
  if (!Array.isArray(raw) || !raw.length) throw bad('Pick at least one office to play.');
  if (raw.length > 50) throw bad('Pick fewer offices.');
  const ids = [...new Set(raw.map((v) => String(v ?? '')))];
  if (ids.some((v) => !/^[0-9]{1,18}$/.test(v))) throw bad('Pick the offices from the list.');
  const r = await query(`SELECT o.id FROM offices o WHERE o.id = ANY($1::bigint[])
      AND (NOT o.archived OR EXISTS (SELECT 1 FROM culture_bingo_offices b WHERE b.challenge_id = $2::bigint AND b.office_id = o.id))`,
  [ids, challengeId]);
  if (r.rows.length !== ids.length) throw bad('Pick the offices from the list.');
  return ids;
}

// The GeoGuessr offices (the default players): active offices with geo_on.
export async function geoOfficeIds() {
  const r = await query(`SELECT id FROM offices WHERE geo_on AND NOT archived ORDER BY position ASC, id ASC`);
  return r.rows.map((o) => String(o.id));
}

// Edit: make the playing offices exactly ids. An office that has marked squares can't leave (409).
export async function setBingoOffices(challengeId, ids) {
  const cid = String(challengeId);
  const cur = await query(`SELECT b.office_id, o.name,
      EXISTS (SELECT 1 FROM culture_bingo_picks p WHERE p.challenge_id = b.challenge_id AND p.office_id = b.office_id AND p.undone_at IS NULL) AS marked
    FROM culture_bingo_offices b JOIN offices o ON o.id = b.office_id WHERE b.challenge_id = $1::bigint`, [cid]);
  const leaving = cur.rows.filter((r) => !ids.includes(String(r.office_id)));
  const stuck = leaving.filter((r) => r.marked);
  if (stuck.length) {
    throw new HttpError(409, `${stuck.map((r) => r.name).join(' and ')} already marked squares, so ${stuck.length === 1 ? 'it stays' : 'they stay'} in the game.`);
  }
  await transaction([
    query(`DELETE FROM culture_bingo_offices WHERE challenge_id = $1::bigint AND NOT (office_id = ANY($2::bigint[]))
           AND NOT EXISTS (SELECT 1 FROM culture_bingo_picks p WHERE p.challenge_id = $1::bigint AND p.office_id = culture_bingo_offices.office_id AND p.undone_at IS NULL)`, [cid, ids]),
    query(`INSERT INTO culture_bingo_offices (challenge_id, office_id) SELECT $1::bigint, o FROM unnest($2::bigint[]) o
           ON CONFLICT (challenge_id, office_id) DO NOTHING`, [cid, ids]),
  ]);
}

// ---------------------------------------------------------------- marking

const notBingo = () => new HttpError(404, 'Challenge not found');

async function stateAfter(viewer, c, now) {
  const { board } = await loadBingo(viewer, c, now);
  return board;
}

// POST /api/culture/challenges/:id/bingo { office_id, square } -> { ok, pick, board }: today's (Central) square for
// that office. One standing pick per office per day and each square once per office (the database enforces both);
// the office's own people, or an admin for any playing office; only while the challenge runs.
export async function markSquare(viewer, challengeId, b, now) {
  const cid = parseId(challengeId);
  const org = isOrganizer(viewer);
  const today = chicagoToday(now);
  const [crow, offs] = (await transaction([
    query(ROW, [cid]),
    query(`SELECT o.id, o.name FROM culture_bingo_offices b JOIN offices o ON o.id = b.office_id WHERE b.challenge_id = $1::bigint`, [cid]),
  ], READ)).map((r) => r.rows);
  const c = shapeRow(crow[0]);
  if (!c || (c.archived && !org)) throw notBingo();
  if (c.kind !== 'bingo') throw bad('This challenge isn’t a CAGEO card.');
  if (c.archived) throw new HttpError(409, 'This challenge is archived.');
  const officeId = String(b?.office_id ?? '');
  const office = offs.find((o) => String(o.id) === officeId);
  if (!office) throw bad('That office isn’t playing in this CAGEO.');
  const square = typeof b?.square === 'number' ? b.square : /^[0-9]{1,2}$/.test(String(b?.square ?? '')) ? Number(b.square) : NaN;
  if (!Number.isInteger(square) || square < 0 || square >= CELLS) throw bad('Pick a square on the card.');
  if (today < c.starts_on) throw new HttpError(409, `This CAGEO starts ${fmtDay(c.starts_on, { weekday: true })}.`);
  if (today > c.ends_on) throw new HttpError(409, `This CAGEO ended ${fmtDay(c.ends_on, { year: true })}.`);
  if (!canMark(viewer, c, officeId, offs.map((o) => String(o.id)), today)) {
    throw forbidden(`Only ${office.name}’s people can mark ${office.name}’s card.`);
  }

  const why = async () => {
    const r = await query(`SELECT square, play_date FROM culture_bingo_picks
      WHERE challenge_id = $1::bigint AND office_id = $2::bigint AND undone_at IS NULL AND (play_date = $3::text OR square = $4::smallint)`,
    [cid, officeId, today, square]);
    const day = r.rows.find((p) => p.play_date === today);
    if (day) return new HttpError(409, `${office.name} already marked today’s square (“${c.squares[Number(day.square)]}”). One square a day: come back tomorrow.`);
    if (r.rows.length) return new HttpError(409, `${office.name} already has that square.`);
    return null;
  };
  const early = await why();
  if (early) throw early;
  let row;
  try {
    // created_at is the request's clock (the same instant "today" came from), so "who marked first" on a shared day
    // follows the app's time.
    row = (await query(`INSERT INTO culture_bingo_picks (challenge_id, office_id, square, play_date, picked_by, created_at)
      VALUES ($1::bigint, $2::bigint, $3::smallint, $4::text, $5::bigint, $6::timestamptz)
      RETURNING id, challenge_id, office_id, square, play_date, created_at, picked_by`,
    [cid, officeId, square, today, String(viewer.id), new Date(now).toISOString()])).rows[0];
  } catch (e) {
    if (e?.code === '23505') throw (await why()) || new HttpError(409, `${office.name} already marked today’s square.`);
    throw e;
  }
  return { pick: shapePick({ ...row, picked_by_name: viewer.name ?? null }), board: await stateAfter(viewer, c, now) };
}

// DELETE /api/culture/bingo-picks/:id -> { ok, board }: undo a pick (kept, marked undone). The office's people undo
// today's pick only (so a slip can be fixed and another square marked); admins any pick.
export async function undoPick(viewer, pickId, now) {
  const pid = parseId(pickId);
  const today = chicagoToday(now);
  const p = (await query(`SELECT p.id, p.challenge_id, p.office_id, p.square, p.play_date, p.created_at, p.picked_by, p.undone_at
    FROM culture_bingo_picks p WHERE p.id = $1::bigint`, [pid])).rows[0];
  if (!p) throw new HttpError(404, 'That pick is gone.');
  const c = shapeRow((await query(ROW, [String(p.challenge_id)])).rows[0]);
  const org = isOrganizer(viewer);
  if (!c || (c.archived && !org)) throw new HttpError(404, 'That pick is gone.');
  const pick = shapePick(p);
  if (p.undone_at != null) throw new HttpError(409, 'That pick was already undone.');
  if (!canUndo(viewer, c, pick, today)) {
    throw forbidden(inOffice(viewer, pick.office_id)
      ? 'Only today’s square can be undone. Ask an admin to fix an older one.'
      : 'Only that office’s people can undo its square.');
  }
  const r = await query(`UPDATE culture_bingo_picks SET undone_at = $3::timestamptz, undone_by = $2::bigint
    WHERE id = $1::bigint AND undone_at IS NULL RETURNING id`, [pid, String(viewer.id), new Date(now).toISOString()]);
  if (!r.rows[0]) throw new HttpError(409, 'That pick was already undone.');
  return { pick, board: await stateAfter(viewer, c, now) };
}
