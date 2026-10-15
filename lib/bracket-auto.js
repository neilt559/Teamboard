import 'server-only';
import { query, transaction } from './db.js';
import { chicagoToday, nextMondayCT, addDays, weekdayOf } from './time.js';
import { closesAt, closedThrough } from './bracket.js';

// The weekly auto-bracket resolver (design §10(c), design-amendments A7). Lazy and idempotent: every bracket
// page load, GET /api/brackets/current, a vote, a winner route and the Home / Culture bracket cards call
// advanceDueBrackets(now) first; the daily Vercel cron (/api/cron/brackets, 06:10 UTC) is only the backup.
//   activate:     the first request on or after an auto bracket's Monday flips activated_at, and only that
//                 request archives the previous "current" bracket (rule 26). Upcoming brackets are untouched.
//   resolveRound: one READ COMMITTED batch per closed round: lock the round's matches (FOR UPDATE, in id
//                 order), decide them in SQL with the tie chain (votes cast before the official close only),
//                 fill the next round's slots, set the champion after R4, then move resolved_through and write
//                 one bracket.auto_decide audit row. Every write is guarded (winner_id IS NULL, COALESCE slot
//                 fills, champion_id IS NULL, resolved_through < r), so a second resolver queued behind the
//                 first changes nothing, and decided_at / completed_at are the official close, so a catch-up
//                 after an idle week looks exactly like an on-time run.
// Manual brackets (the live legacy one included) are never selected and every statement re-checks mode = 'auto',
// so nothing here can touch them at any time.

// Serializes the statements that change which bracket is current (create, activation, un-archive, restore), so
// two of them at once can never leave two live brackets. app/api/brackets/_shared.js re-exports it.
export const BRACKET_LOCK = 7342002;

const DUE_SQL = `SELECT id, starts_on, activated_at, resolved_through FROM brackets
  WHERE mode = 'auto' AND NOT archived AND deleted_at IS NULL AND starts_on <= $1::text
    AND (activated_at IS NULL OR resolved_through < 4)
  ORDER BY starts_on, id`;

// One guarded statement: only the request that flips activated_at archives the previous current bracket(s):
// every manual one that isn't archived, and an older activated auto bracket. Audited once, with what it archived.
const ACTIVATE_SQL = `
WITH act AS (
  UPDATE brackets SET activated_at = $3::timestamptz
  WHERE id = $1::bigint AND mode = 'auto' AND activated_at IS NULL AND NOT archived AND deleted_at IS NULL
    AND starts_on <= $2::text
  RETURNING id, starts_on),
arch AS (
  UPDATE brackets o SET archived = true FROM act
  WHERE o.id <> act.id AND NOT o.archived AND o.deleted_at IS NULL
    AND (o.mode = 'manual' OR (o.activated_at IS NOT NULL AND o.starts_on < act.starts_on))
  RETURNING o.id),
au AS (
  INSERT INTO audit_log (actor_id, action, entity, entity_id, detail)
  SELECT NULL, 'bracket.activate', 'brackets', act.id::text,
         jsonb_build_object('archived', (SELECT COALESCE(jsonb_agg(arch.id ORDER BY arch.id), '[]'::jsonb) FROM arch),
                            'at', $3::timestamptz)
  FROM act)
SELECT (SELECT count(*) FROM act)::int AS activated`;

// resolveRound's batch ($1 bracket, $2 round, $3 the official close). Each statement takes a fresh snapshot after
// the locks (READ COMMITTED). Every parameter outside a column comparison is cast (design Conventions); in
// statement 5 the casts are load-bearing (jsonb_build_object is VARIADIC "any": an uncast one is 42P18, which
// would roll the batch back on every attempt and no auto bracket would ever advance).
const AUTO_ONLY = `EXISTS (SELECT 1 FROM brackets x WHERE x.id = $1::bigint AND x.mode = 'auto')`;
const RESOLVE = [
  // 1. lock this round's matches in id order; waits for any in-flight vote holding FOR SHARE
  `SELECT id FROM bracket_matches WHERE bracket_id = $1::bigint AND round = $2::int ORDER BY id FOR UPDATE`,
  // 2. decide in SQL (votes cast before the official close only)
  `WITH t AS (
     SELECT m.id, m.a_id, m.b_id, ea.seed AS a_seed, eb.seed AS b_seed, ea.quadrant AS a_q, eb.quadrant AS b_q,
       (SELECT count(*) FROM bracket_votes v WHERE v.match_id = m.id AND v.entrant_id = m.a_id
          AND v.created_at < $3::timestamptz)::int AS av,
       (SELECT count(*) FROM bracket_votes v WHERE v.match_id = m.id AND v.entrant_id = m.b_id
          AND v.created_at < $3::timestamptz)::int AS bv,
       (SELECT count(*) FROM bracket_votes v JOIN bracket_matches x ON x.id = v.match_id
          WHERE x.bracket_id = m.bracket_id AND v.entrant_id = m.a_id AND v.created_at < $3::timestamptz)::int AS a_tot,
       (SELECT count(*) FROM bracket_votes v JOIN bracket_matches x ON x.id = v.match_id
          WHERE x.bracket_id = m.bracket_id AND v.entrant_id = m.b_id AND v.created_at < $3::timestamptz)::int AS b_tot
     FROM bracket_matches m
     JOIN brackets b ON b.id = m.bracket_id AND b.mode = 'auto' AND NOT b.archived AND b.deleted_at IS NULL
     LEFT JOIN bracket_entrants ea ON ea.id = m.a_id
     LEFT JOIN bracket_entrants eb ON eb.id = m.b_id
     WHERE m.bracket_id = $1::bigint AND m.round = $2::int AND m.winner_id IS NULL
       AND (m.a_id IS NOT NULL OR m.b_id IS NOT NULL))
   UPDATE bracket_matches m SET
     winner_id = CASE WHEN t.b_id IS NULL THEN t.a_id WHEN t.a_id IS NULL THEN t.b_id
                      WHEN t.av <> t.bv THEN CASE WHEN t.av > t.bv THEN t.a_id ELSE t.b_id END
                      WHEN t.a_seed <> t.b_seed THEN CASE WHEN t.a_seed < t.b_seed THEN t.a_id ELSE t.b_id END
                      WHEN t.a_tot <> t.b_tot THEN CASE WHEN t.a_tot > t.b_tot THEN t.a_id ELSE t.b_id END
                      WHEN t.a_q <= t.b_q THEN t.a_id ELSE t.b_id END,
     decide_reason = CASE WHEN t.a_id IS NULL OR t.b_id IS NULL THEN 'bye' WHEN t.av <> t.bv THEN 'votes'
                          WHEN t.a_seed <> t.b_seed THEN 'seed' WHEN t.a_tot <> t.b_tot THEN 'total_votes' ELSE 'quadrant' END,
     a_votes = t.av, b_votes = t.bv, decided_at = $3::timestamptz, decided_by = 'auto', decided_by_user = NULL
   FROM t WHERE m.id = t.id AND m.winner_id IS NULL`,
  // 3. fill the next round's empty slots, mirroring nextSlot() (organizer-decided matches included)
  `UPDATE bracket_matches n SET
     a_id = COALESCE(n.a_id, (SELECT m.winner_id FROM bracket_matches m
                              WHERE m.bracket_id = n.bracket_id AND m.round = $2::int AND $2::int > 0 AND m.idx = n.idx * 2)),
     b_id = COALESCE(n.b_id, (SELECT m.winner_id FROM bracket_matches m
                              WHERE m.bracket_id = n.bracket_id AND m.round = $2::int
                                AND (($2::int = 0 AND n.idx = m.idx * 2) OR ($2::int > 0 AND m.idx = n.idx * 2 + 1))))
   WHERE n.bracket_id = $1::bigint AND n.round = $2::int + 1 AND n.winner_id IS NULL AND ${AUTO_ONLY}`,
  // 4. champion
  `UPDATE brackets SET champion_id = (SELECT winner_id FROM bracket_matches WHERE bracket_id = $1::bigint AND round = 4),
                       completed_at = $3::timestamptz
   WHERE id = $1::bigint AND mode = 'auto' AND $2::int = 4 AND champion_id IS NULL
     AND EXISTS (SELECT 1 FROM bracket_matches WHERE bracket_id = $1::bigint AND round = 4 AND winner_id IS NOT NULL)`,
  // 5. high-water mark + audit (an audit row only when this run advanced it)
  `WITH up AS (UPDATE brackets SET resolved_through = $2::int
               WHERE id = $1::bigint AND mode = 'auto' AND resolved_through < $2::int
                 AND NOT EXISTS (SELECT 1 FROM bracket_matches WHERE bracket_id = $1::bigint AND round <= $2::int
                                   AND winner_id IS NULL)
               RETURNING id)
   INSERT INTO audit_log (actor_id, action, entity, entity_id, detail)
   SELECT NULL, 'bracket.auto_decide', 'brackets', $1::bigint::text,
          jsonb_build_object('round', $2::int, 'close', $3::timestamptz) FROM up`,
  // 6. where it stands now (this run's writes, or a concurrent resolver's committed ones)
  `SELECT resolved_through FROM brackets WHERE id = $1::bigint`,
];

// Each statement binds exactly the parameters it uses (Postgres refuses extra ones): the highest $n in it.
const maxParam = (text) => Math.max(0, ...[...text.matchAll(/[$]([0-9]+)/g)].map((m) => Number(m[1])));

async function activate(id, today, now) {
  const res = await transaction([
    query('SELECT pg_advisory_xact_lock($1::bigint)', [BRACKET_LOCK]),
    query(ACTIVATE_SQL, [id, today, new Date(now).toISOString()]),
    query(`SELECT (activated_at IS NOT NULL) AS on FROM brackets WHERE id = $1::bigint AND NOT archived AND deleted_at IS NULL`, [id]),
  ]);
  return { flipped: Number(res[1].rows[0]?.activated || 0) > 0, active: !!res[2].rows[0]?.on };
}

// true when resolved_through reached r (by this run or another one).
export async function resolveRound(id, startsOn, r) {
  const close = new Date(closesAt(startsOn, r)).toISOString();
  const params = [String(id), Number(r), close];
  const res = await transaction(RESOLVE.map((text) => query(text, params.slice(0, maxParam(text)))));
  return Number(res.at(-1).rows[0]?.resolved_through ?? -1) >= Number(r);
}

// Activate and decide whatever is due at `now`. Never throws: a failure is logged and retried by the next
// request (the page still renders the last committed state). Oldest first, and a bracket that couldn't finish
// stops the pass, so an older week always completes before a newer one's activation archives it.
//   -> { activated: [ids], resolved: [{ id, round }], errors }
export async function advanceDueBrackets(now) {
  const out = { activated: [], resolved: [], errors: 0 };
  const today = chicagoToday(now);
  let due;
  try {
    due = (await query(DUE_SQL, [today])).rows;
  } catch (e) {
    console.error('[bracket-auto] due query', e);
    out.errors++;
    return out;
  }
  for (const b of due) {
    const id = String(b.id);
    const S = String(b.starts_on);
    try {
      if (!b.activated_at) {
        const a = await activate(id, today, now);
        if (a.flipped) out.activated.push(id);
        if (!a.active) break;                               // archived or deleted meanwhile: retry next time
      }
      const target = closedThrough(S, now);
      let done = Number(b.resolved_through);
      for (let r = done + 1; r <= target; r++) {
        if (!(await resolveRound(id, S, r))) break;
        done = r;
        out.resolved.push({ id, round: r });
      }
      if (done < target) break;
    } catch (e) {
      console.error('[bracket-auto] bracket', id, e);
      out.errors++;
      break;
    }
  }
  return out;
}

// ---------------------------------------------------------------- weekly cadence (organizer helpers)

// Mondays from `from` on that already have a live or upcoming auto bracket: [{ starts_on, id, name }].
export async function takenMondays(from) {
  const r = await query(`SELECT id, name, starts_on FROM brackets
    WHERE mode = 'auto' AND NOT archived AND deleted_at IS NULL AND starts_on >= $1::text
    ORDER BY starts_on LIMIT 60`, [from]);
  return r.rows.map((x) => ({ id: String(x.id), name: x.name, starts_on: String(x.starts_on) }));
}

// The first Monday after today (CT) with no live or upcoming auto bracket ("Repeat next Monday").
export function firstFreeMonday(now, taken) {
  const set = new Set((taken || []).map((t) => t.starts_on));
  let d = nextMondayCT(now);
  for (let i = 0; i < 104 && set.has(d); i++) d = addDays(d, 7);
  return d;
}

// The organizer warning (from Wednesday on, when nothing starts next Monday) and the setup defaults.
//   { today, next_monday, scheduled, warn, free_monday, taken }
export async function nextMondayStatus(now) {
  const today = chicagoToday(now);
  const next = nextMondayCT(now);
  const taken = await takenMondays(today);
  const scheduled = taken.some((t) => t.starts_on === next);
  const dow = weekdayOf(today);                             // 0 Sun ... 6 Sat
  return {
    today, next_monday: next, scheduled,
    warn: !scheduled && (dow === 0 || dow >= 3),            // Wed, Thu, Fri, Sat, Sun
    free_monday: firstFreeMonday(now, taken),
    taken,
  };
}
