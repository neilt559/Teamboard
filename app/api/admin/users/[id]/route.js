import { handle, HttpError, bad, parseId, str } from '@/lib/http';
import { query } from '@/lib/db';
import { normEmail, emailAllowed, allowedEmailDomains } from '@/lib/auth';
import { setPosition, expectedIdentity } from '@/lib/requests';
import {
  setAdminFlag, setDisabled, updateAccountFields, updateAccountIdentity, managerProblem, loadAccount,
} from '@/lib/queries/admin';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const runtime = 'nodejs';
export const maxDuration = 60;

// Admin edits one account (design §8.2). Any subset of:
//   is_admin            make or remove admin (at least one active admin stays, advisory-locked)
//   disabled            true disables (expires every session; never the last active admin, never yourself); false enables
//   is_organizer        culture organizer flag
//   office_id, team_id, department_id, manager_id   (null clears). A direct office change keeps the team only
//                       when it still fits, and supersedes a pending office-change request.
//   position_id (+ expected_position_id)  set AND approve; refused with 409 when the person changed it meanwhile
//   display_name, email ('' clears)  (+ optional base: { display_name, email } for conflict detection)
//   identity_verified   true sets identity_verified_at/by, only while the name and email are still
//                       expected_identity: { display_name, email } (what the admin was shown; required with true),
//                       otherwise 409 "Their name or email changed" and they stay unverified; false clears
// Old Accounts tabs send { is_admin } exactly as before. Returns { ok, user } with the updated account.
const has = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);
const optId = (v) => (v === null || v === undefined || v === '' ? null : parseId(v));
const bool = (v, label) => {
  if (typeof v !== 'boolean') throw bad(`${label} must be true or false.`);
  return v;
};

async function exists(sqlText, idValue) {
  if (idValue == null) return true;
  return (await query(sqlText, [idValue])).rows.length > 0;
}

export const PATCH = handle(async ({ viewer, params, body }) => {
  const uid = parseId(params.id);
  const b = await body();
  const me = String(viewer.id);

  const target = (await query(`SELECT id, position_id FROM users WHERE id = $1::bigint`, [uid])).rows[0];
  if (!target) throw new HttpError(404, 'Account not found');

  // ---- validate everything before writing anything
  const isAdmin = has(b, 'is_admin') ? bool(b.is_admin, 'is_admin') : undefined;
  const disabled = has(b, 'disabled') ? bool(b.disabled, 'disabled') : undefined;
  if (disabled === true && uid === me) throw new HttpError(409, 'You can’t disable your own account.');

  const fields = {};
  if (has(b, 'is_organizer')) fields.is_organizer = bool(b.is_organizer, 'is_organizer');
  if (has(b, 'identity_verified')) {
    fields.identity_verified = bool(b.identity_verified, 'identity_verified');
    if (fields.identity_verified) {
      fields.expected_identity = expectedIdentity(b.expected_identity);
      if (!fields.expected_identity) throw bad('Refresh the page: verifying needs the name and email you checked.');
    }
  }
  if (has(b, 'office_id')) {
    fields.office_id = optId(b.office_id);
    if (!(await exists(`SELECT 1 FROM offices WHERE id = $1::bigint AND NOT archived`, fields.office_id))) throw bad('Pick an active office.');
  }
  if (has(b, 'team_id')) {
    fields.team_id = optId(b.team_id);
    if (!(await exists(`SELECT 1 FROM teams WHERE id = $1::bigint AND NOT archived`, fields.team_id))) throw bad('Pick an active team.');
  }
  if (has(b, 'department_id')) {
    fields.department_id = optId(b.department_id);
    if (!(await exists(`SELECT 1 FROM departments WHERE id = $1::bigint AND NOT archived`, fields.department_id))) {
      throw bad('Pick an active department.');
    }
  }
  if (has(b, 'manager_id')) {
    fields.manager_id = optId(b.manager_id);
    const problem = await managerProblem(uid, fields.manager_id);
    if (problem) throw bad(problem);
  }

  let positionId;
  let expectedPosition;
  if (has(b, 'position_id')) {
    positionId = optId(b.position_id);
    if (!(await exists(`SELECT 1 FROM positions WHERE id = $1::bigint AND NOT archived`, positionId))) throw bad('Pick an active position.');
    expectedPosition = has(b, 'expected_position_id') ? optId(b.expected_position_id) : (target.position_id == null ? null : String(target.position_id));
  }

  const ident = {};
  if (has(b, 'display_name')) {
    const name = str(b.display_name, 200);
    if (name && (name.length < 2 || name.length > 80)) throw bad('A display name needs 2 to 80 characters (or leave it empty to show the username).');
    ident.display_name = name;
  }
  if (has(b, 'email')) {
    const raw = b.email == null ? '' : normEmail(b.email);
    if (raw && (raw.length > 254 || !emailAllowed(raw))) {
      throw bad(`Use a work email ending in @${allowedEmailDomains().join(' or @')}.`);
    }
    ident.email = raw || null;
  }
  const base = b.base && typeof b.base === 'object' ? b.base : {};

  // ---- apply
  if (isAdmin !== undefined) {
    const r = await setAdminFlag({ adminId: me, userId: uid, on: isAdmin });
    if (r === 'missing') throw new HttpError(404, 'Account not found');
    if (r === 'last_admin') throw new HttpError(409, 'There has to be at least one admin.');
  }
  if (disabled !== undefined) {
    const r = await setDisabled({ adminId: me, userId: uid, on: disabled });
    if (r === 'missing') throw new HttpError(404, 'Account not found');
    if (r === 'last_admin') throw new HttpError(409, 'There has to be at least one active admin. Make someone else an admin first.');
  }
  if (positionId !== undefined) {
    const r = await setPosition({ adminId: me, userId: uid, expectedPositionId: expectedPosition, positionId });
    if (!r.ok) throw new HttpError(409, 'Their position request changed while you were looking. Refresh and try again.');
  }
  if (Object.keys(ident).length) {
    let r;
    try {
      r = await updateAccountIdentity({ adminId: me, userId: uid, fields: ident, base });
    } catch (e) {
      if (e?.code === '23505') throw new HttpError(409, 'That email is already registered on another account. Clear it there first.');
      throw e;
    }
    if (r.status === 'missing') throw new HttpError(404, 'Account not found');
    if (r.status === 'taken') throw new HttpError(409, 'That email is another account’s username.');
    if (r.status === 'conflict') {
      throw new HttpError(409, 'conflict', { message: 'Someone changed this while you were editing.', fields: r.fields, current: r.current });
    }
  }
  if (Object.keys(fields).length) {
    const r = await updateAccountFields({ adminId: me, userId: uid, fields });
    if (r.status === 'missing') throw new HttpError(404, 'Account not found');
    if (r.status === 'team') throw bad('Pick a team in their offices (home or extra), or no team.');
    if (fields.identity_verified && !r.verified) {
      throw new HttpError(409, 'Their name or email changed since you loaded this, so they’re still unverified. Refresh and check the new one.');
    }
  }
  return { ok: true, user: await loadAccount(uid) };
}, { auth: 'admin' });
