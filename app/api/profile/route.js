import { handle, HttpError, bad, parseId, str } from '@/lib/http';
import { query, transaction } from '@/lib/db';
import { normEmail, emailAllowed, allowedEmailDomains } from '@/lib/auth';
import { PERSON_COLORS } from '@/app/_ui/people';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';
export const maxDuration = 60;

// PUT /api/profile: the /welcome wizard's one submit, and every later Settings > Profile save (design §5.2-§5.4).
// Body (every key optional; only the keys present change, rule 32):
//   display_name, email, office_id, team_id (null = no team), department_id, position_id, manager_id (null = none)
//   person_id: "that's me" (an admin approves the link), or add_me: true ("none of these, add me")
//   base: { display_name, email }: the values the form started from (conflict check, design §7.4 draft editors)
// While the profile is incomplete the submit IS the wizard: name, email, office, department and position are
// required, and the office applies at once (the only time it is self-set). After that:
//   - a different office becomes an office_change request (the team picked with it rides along in the request);
//   - the team must be an active team in my own offices (home or extra), checked INSIDE the UPDATE, so two
//     concurrent first submits can never pair office A with a team in office B;
//   - a position above max(1, my approved level) waits for an admin (§4.2a); admins' apply at once;
//   - a name or email change clears identity verification (§5.1).
// -> { ok, profile, pending_position, pending_link, pending_office, next, warning? }

const has = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);
const cleanName = (v) => str(v, 200).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/ {2,}/g, ' ').trim();
const optId = (v) => (v === null || v === '' || v === undefined ? null : parseId(v));
const TAKEN_EMAIL = 'That email is already registered. If it’s yours, ask an admin to clear it.';
const TEAM_MSG = 'Pick a team in your office.';

export const PUT = handle(async ({ viewer: me, body }) => {
  const b = await body();
  const base = b.base && typeof b.base === 'object' ? b.base : {};
  const uid = String(me.id);

  // ---- current state and everything the checks need, in one read batch
  const officeId = has(b, 'office_id') ? optId(b.office_id) : undefined;
  const teamId = has(b, 'team_id') ? optId(b.team_id) : undefined;
  const deptId = has(b, 'department_id') ? optId(b.department_id) : undefined;
  const posId = has(b, 'position_id') ? optId(b.position_id) : undefined;
  const mgrId = has(b, 'manager_id') ? optId(b.manager_id) : undefined;
  const personId = has(b, 'person_id') && b.person_id != null && b.person_id !== '' ? parseId(b.person_id) : null;
  const addMe = b.add_me === true && !personId;
  const email = has(b, 'email') ? normEmail(b.email) : undefined;

  const reads = await transaction([
    query(`SELECT username, display_name, email, office_id, team_id, department_id, position_id, approved_position_id,
                  manager_id, (profile_completed_at IS NOT NULL) AS done, is_admin
           FROM users WHERE id = $1::bigint AND disabled_at IS NULL`, [uid]),
    query(`SELECT id, archived FROM offices WHERE id = $1::bigint`, [officeId ?? null]),
    query(`SELECT id, archived FROM departments WHERE id = $1::bigint`, [deptId ?? null]),
    query(`SELECT id, archived, name, level::int AS level FROM positions WHERE id = $1::bigint`, [posId ?? null]),
    query(`SELECT id, (disabled_at IS NOT NULL) AS disabled FROM users WHERE id = $1::bigint`, [mgrId ?? null]),
    // Boss cycle: walking up from the new boss must never reach me (UNION also stops on an existing cycle).
    query(`WITH RECURSIVE up AS (SELECT id, manager_id FROM users WHERE id = $1::bigint
                                 UNION SELECT u.id, u.manager_id FROM users u JOIN up ON u.id = up.manager_id)
           SELECT 1 AS hit FROM up WHERE id = $2::bigint LIMIT 1`, [mgrId ?? null, uid]),
    query(`SELECT EXISTS (SELECT 1 FROM users WHERE id <> $1::bigint
                            AND (lower(email) = $2::text OR lower(username) = $2::text)) AS taken`, [uid, email || '']),
    query(`SELECT id, user_id, kind, archived_at FROM people WHERE id = $1::bigint`, [personId]),
    query(`SELECT id, kind, person_id, office_id, team_id FROM access_requests
           WHERE user_id = $1::bigint AND status = 'pending'`, [uid]),
    query(`SELECT id, office_id, archived FROM teams WHERE id = $1::bigint`, [teamId ?? null]),
  ], { readOnly: true });
  const [curR, offR, deptR, posR, mgrR, cycR, emailR, personR, pendR, teamR] = reads.map((r) => r.rows);
  const cur = curR[0];
  if (!cur) throw new HttpError(401, 'Please sign in');
  const completing = !cur.done;
  const same = (a, x) => String(a ?? '') === String(x ?? '');

  // ---- validate (design §5.2 step 1)
  let name;
  if (has(b, 'display_name')) {
    name = cleanName(b.display_name);
    if (name.length < 2 || name.length > 80) throw bad('Enter your full name (2-80 characters).');
  }
  if (email !== undefined && !same(email, normEmail(cur.email))) {
    if (!email) throw bad('Enter your work email.');
    if (!emailAllowed(email)) throw bad(`Use your work email (ending in @${allowedEmailDomains()[0] || 'cagecivil.com'}).`);
    if (emailR[0]?.taken) throw new HttpError(409, TAKEN_EMAIL);
  }
  if (officeId !== undefined) {
    if (officeId === null) throw bad('Pick your office.');
    if (!offR[0] || (offR[0].archived && !same(officeId, cur.office_id))) throw bad('That office isn’t available. Pick another one.');
  }
  if (deptId !== undefined) {
    if (deptId === null) throw bad('Pick your department.');
    if (!deptR[0] || (deptR[0].archived && !same(deptId, cur.department_id))) throw bad('That department isn’t available. Pick another one.');
  }
  if (posId !== undefined) {
    if (posId === null) throw bad('Pick your position.');
    if (!posR[0] || (posR[0].archived && !same(posId, cur.position_id) && !same(posId, cur.approved_position_id))) {
      throw bad('That position isn’t available. Pick another one.');
    }
  }
  if (mgrId) {
    if (same(mgrId, uid)) throw bad('You can’t be your own boss here.');
    if (!mgrR[0] || mgrR[0].disabled) throw bad('That person isn’t an active account. Pick someone else, or “Not listed yet”.');
    if (cycR.length) throw bad('That would make a loop: they already report to you, directly or through someone else.');
  }
  let person = null;
  if (personId) {
    person = personR[0];
    if (!person || person.kind !== 'person' || person.archived_at
        || (person.user_id != null && !same(person.user_id, uid))) {
      throw bad('That name can’t be linked (it may already belong to someone). Pick another, or “None of these”.');
    }
  }

  // The values the profile will have, for the completion check.
  const after = {
    display_name: name ?? cur.display_name, email: email ?? cur.email, office_id: officeId ?? cur.office_id,
    department_id: deptId ?? cur.department_id, position_id: posId ?? cur.position_id,
  };
  if (completing) {
    const missing = [];
    if (!after.display_name || after.display_name.length < 2) missing.push('your name');
    if (!after.email) missing.push('your work email');
    if (!after.office_id) missing.push('your office');
    if (!after.department_id) missing.push('your department');
    if (!after.position_id) missing.push('your position');
    if (missing.length) throw bad(`Please add ${missing.join(', ')}.`);
  }

  // After onboarding a different office is a request; the team picked with it goes into the request.
  let officeRequest = null;
  let teamForUpdate = teamId;
  if (!completing && officeId != null && !same(officeId, cur.office_id)) {
    let reqTeam = null;
    if (teamId) {
      const t = teamR[0];
      if (!t || t.archived || !same(t.office_id, officeId)) throw bad('Pick a team in that office, or “No home team yet”.');
      reqTeam = teamId;
    }
    officeRequest = { office_id: officeId, team_id: reqTeam };
    teamForUpdate = undefined;                       // users.team_id stays until an admin approves the move
  }

  // ---- 1. the profile UPDATE, alone (its row count decides whether step 2 runs)
  const nb = (v) => (v == null ? '' : String(v));
  const baseName = has(base, 'display_name') && name !== undefined ? cleanName(base.display_name) : null;
  const baseEmail = has(base, 'email') && email !== undefined ? normEmail(base.email) : null;
  const immediate = `(is_admin OR COALESCE((SELECT p.level FROM positions p WHERE p.id = $15::bigint), 99)
                       <= GREATEST(1, COALESCE((SELECT a.level FROM positions a WHERE a.id = users.approved_position_id), 1)))`;
  const changed = `(($2::boolean AND display_name IS DISTINCT FROM $3::text) OR ($4::boolean AND email IS DISTINCT FROM $5::text))`;
  const params = [
    uid,                                                   // $1
    name !== undefined, name ?? '',                        // $2 $3
    email !== undefined, email ?? '',                      // $4 $5
    officeId !== undefined && completing, officeId ?? null,   // $6 $7
    teamForUpdate !== undefined, teamForUpdate ?? null,    // $8 $9
    deptId !== undefined, deptId ?? null,                  // $10 $11
    mgrId !== undefined, mgrId ?? null,                    // $12 $13
    posId !== undefined, posId ?? null,                    // $14 $15
    completing,                                            // $16
    baseName != null, nb(baseName),                        // $17 $18
    baseEmail != null, nb(baseEmail),                      // $19 $20
  ];
  const upd = await query(
    `UPDATE users SET
       display_name = CASE WHEN $2::boolean THEN $3::text ELSE display_name END,
       email = CASE WHEN $4::boolean THEN $5::text ELSE email END,
       identity_verified_at = CASE WHEN ${changed} THEN NULL ELSE identity_verified_at END,
       identity_verified_by = CASE WHEN ${changed} THEN NULL ELSE identity_verified_by END,
       office_id = CASE WHEN $6::boolean AND profile_completed_at IS NULL THEN $7::bigint ELSE office_id END,
       team_id = CASE WHEN $8::boolean THEN $9::bigint ELSE team_id END,
       department_id = CASE WHEN $10::boolean THEN $11::bigint ELSE department_id END,
       manager_id = CASE WHEN $12::boolean THEN $13::bigint ELSE manager_id END,
       position_id = CASE WHEN $14::boolean THEN $15::bigint ELSE position_id END,
       approved_position_id = CASE WHEN $14::boolean AND ${immediate} THEN $15::bigint ELSE approved_position_id END,
       position_requested_at = CASE WHEN NOT $14::boolean THEN position_requested_at
                                    WHEN ${immediate} THEN NULL
                                    WHEN position_id IS NOT DISTINCT FROM $15::bigint THEN position_requested_at
                                    ELSE now() END,
       profile_completed_at = CASE WHEN $16::boolean THEN COALESCE(profile_completed_at, now()) ELSE profile_completed_at END,
       updated_at = now()
     WHERE id = $1::bigint AND disabled_at IS NULL
       AND (NOT $8::boolean OR $9::bigint IS NULL OR EXISTS (
             SELECT 1 FROM teams t JOIN offices o ON o.id = t.office_id
             WHERE t.id = $9::bigint AND NOT t.archived AND NOT o.archived
               AND (t.office_id = CASE WHEN users.profile_completed_at IS NULL AND $6::boolean THEN $7::bigint ELSE users.office_id END
                    OR t.office_id IN (SELECT x.office_id FROM user_offices x WHERE x.user_id = users.id AND x.revoked_at IS NULL))))
       AND (NOT $17::boolean OR display_name = $18::text OR display_name = $3::text)
       AND (NOT $19::boolean OR COALESCE(email, '') = $20::text OR COALESCE(email, '') = $5::text)
     RETURNING id, username, display_name, email, office_id, team_id, department_id, manager_id, position_id,
               approved_position_id, position_requested_at, (identity_verified_at IS NOT NULL) AS identity_verified,
               (position_requested_at = now()) AS newly_requested, (profile_completed_at = now()) AS just_completed`,
    params);

  if (!upd.rows.length) {
    // Nothing matched: someone else changed the name or email since the form opened (409), or the team is not
    // in my offices (400).
    const now = (await query('SELECT display_name, email FROM users WHERE id = $1::bigint AND disabled_at IS NULL', [uid])).rows[0];
    if (!now) throw new HttpError(401, 'Please sign in');
    const fields = [];
    if (baseName != null && now.display_name !== baseName && now.display_name !== name) fields.push('display_name');
    if (baseEmail != null && nb(now.email) !== baseEmail && nb(now.email) !== email) fields.push('email');
    if (fields.length) {
      throw new HttpError(409, 'conflict', {
        message: 'Your name or email was changed somewhere else while you were editing.',
        fields, current: { display_name: now.display_name, email: now.email },
      });
    }
    throw bad(TEAM_MSG);
  }
  const row = upd.rows[0];

  // ---- 2. follow-up batch: requests, "add me", audit. Every statement is safe to resend.
  const pend = pendR;
  const follow = [];
  const keys = ['display_name', 'email', 'office_id', 'team_id', 'department_id', 'position_id', 'manager_id'].filter((k) => has(b, k));
  if (row.just_completed) follow.push(audit(uid, 'profile.complete', { keys }));
  else if (keys.length) follow.push(audit(uid, 'profile.update', { keys }));
  if (row.newly_requested) follow.push(audit(uid, 'position.request', { position_id: String(row.position_id), name: posR[0]?.name || null }));

  const linkable = `EXISTS (SELECT 1 FROM people p WHERE p.id = $2::bigint AND p.user_id IS NULL AND p.kind = 'person'
                              AND p.archived_at IS NULL)`;
  const pendingLink = pend.find((r) => r.kind === 'person_link');
  if (person && person.user_id == null && !(pendingLink && same(pendingLink.person_id, personId))) {
    follow.push(query(`UPDATE access_requests SET status = 'superseded'
                       WHERE user_id = $1::bigint AND kind = 'person_link' AND status = 'pending' AND ${linkable}`, [uid, personId]));
    follow.push(query(`INSERT INTO access_requests (user_id, kind, person_id)
                       SELECT $1::bigint, 'person_link', $2::bigint WHERE ${linkable}`, [uid, personId]));
  }
  if (addMe) {
    // "None of these, add me": my own name on tasks (never a second one), and any open claim is withdrawn.
    const color = PERSON_COLORS[Math.floor(Math.random() * PERSON_COLORS.length)] || '#5B5859';
    follow.push(query(`UPDATE access_requests SET status = 'withdrawn', decided_at = now()
                       WHERE user_id = $1::bigint AND kind = 'person_link' AND status = 'pending'`, [uid]));
    follow.push(query(`INSERT INTO people (name, color, user_id)
                       SELECT $2::text, $3::text, $1::bigint
                       WHERE NOT EXISTS (SELECT 1 FROM people WHERE user_id = $1::bigint)
                       ON CONFLICT DO NOTHING`, [uid, row.display_name || row.username, color]));
  }
  const pendingOffice = pend.find((r) => r.kind === 'office_change');
  if (officeRequest && !(pendingOffice && same(pendingOffice.office_id, officeRequest.office_id)
                         && same(pendingOffice.team_id, officeRequest.team_id))) {
    const ok = 'EXISTS (SELECT 1 FROM offices o WHERE o.id = $2::bigint AND NOT o.archived)';
    follow.push(query(`UPDATE access_requests SET status = 'superseded'
                       WHERE user_id = $1::bigint AND kind = 'office_change' AND status = 'pending' AND ${ok}`,
    [uid, officeRequest.office_id]));
    follow.push(query(`INSERT INTO access_requests (user_id, kind, office_id, team_id, from_office_id)
                       SELECT $1::bigint, 'office_change', $2::bigint, $3::bigint, $4::bigint WHERE ${ok}`,
    [uid, officeRequest.office_id, officeRequest.team_id, cur.office_id == null ? null : String(cur.office_id)]));
  }

  let warning = null;
  if (follow.length) {
    try {
      await transaction(follow);
    } catch (e) {
      console.error('[profile] follow-up batch failed', e?.code || e);
      warning = officeRequest
        ? 'Your profile was saved, but your office change request didn’t go through. Try again from Settings.'
        : 'Your profile was saved, but your name request didn’t go through. Use “Link me to an existing name” in Settings.';
    }
  }

  const st = await query(
    `SELECT (SELECT kind FROM access_requests WHERE user_id = $1::bigint AND kind = 'person_link' AND status = 'pending' LIMIT 1) AS link,
            (SELECT office_id FROM access_requests WHERE user_id = $1::bigint AND kind = 'office_change' AND status = 'pending' LIMIT 1) AS office`,
    [uid]);
  const s = st.rows[0] || {};
  const pos = (v) => (v == null ? null : String(v));
  return {
    ok: true,
    profile: {
      id: String(row.id), username: row.username, display_name: row.display_name, email: row.email,
      office_id: pos(row.office_id), team_id: pos(row.team_id), department_id: pos(row.department_id),
      manager_id: pos(row.manager_id), position_id: pos(row.position_id), approved_position_id: pos(row.approved_position_id),
      identity_verified: !!row.identity_verified,
    },
    pending_position: pos(row.position_id) !== pos(row.approved_position_id),
    pending_link: !!s.link,
    pending_office: s.office != null,
    next: '/',
    ...(warning ? { warning } : {}),
  };
}, { allowIncomplete: true, maxBody: 20_000 });

function audit(uid, action, detail) {
  return query(
    `INSERT INTO audit_log (actor_id, action, entity, entity_id, detail) VALUES ($1::bigint, $2::text, 'users', $1::text, $3::jsonb)`,
    [uid, action, JSON.stringify(detail || {})]);
}
