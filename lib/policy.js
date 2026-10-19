// Pure permission rules (design §4.4, §4.5). Isomorphic and import-free, so
// client components (bracket-ui.js, ProjectHeader.js, ...) can show exactly the
// controls the API will allow. Server code reaches these through lib/access.js.
//
// A viewer v is what lib/viewer.js builds: { id, level, office_ids, is_admin,
// is_organizer, ... } with ids as strings (BIGINT comes back from Postgres as
// text, rule 39). Levels: 0 disabled, 1 assigned, 2 office, 3 company (PM),
// 4 leadership, 9 admin. The SQL functions tb_* in lib/schema/core.js are the
// source of truth for visibility; these mirror them for the UI and for checks
// that need no database read.

export const LEVEL = { ASSIGNED: 1, OFFICE: 2, COMPANY: 3, LEADERSHIP: 4, ADMIN: 9 };

export const displayName = (u) => (u?.display_name || u?.username || '');
export const isAdmin = (v) => !!v?.is_admin;
export const isOrganizer = (v) => !!(v?.is_admin || v?.is_organizer);
export const inMyOffices = (v, officeId) =>
  officeId != null && (v?.office_ids || []).map(String).includes(String(officeId));

// An office's own stats (GeoGuessr scores, the 5K counter; Neil 2026-10-19: "everyone but admins can only touch
// their office's stats"): admins any office, everyone else only their home and extra offices. Reading stays open.
export const canTouchOfficeStats = (v, officeId) => !!v && (isAdmin(v) || inMyOffices(v, officeId));

// Neil 2026-10-11: PMs and up (L3+) read every office's internals (minutes, office and team threads).
export const canSeeOfficeInternal = (v, officeId) => v.level >= 3 || inMyOffices(v, officeId);
export const canManageTeamsIn = (v, officeId) => v.level >= 3 || (v.level >= 2 && inMyOffices(v, officeId));
export const canCreateProjectIn = (v, team) => v.level >= 3 || inMyOffices(v, team?.office_id);
// A4: who edits a team's roster (add, change Member / PM, remove): admins, L3 and up, L2 in the team's office,
// and anyone with role 'pm' on that team (myRole = the viewer's active role on it: 'pm' | 'member' | null).
// Everyone who can see the team page can see the roster.
export const canEditRoster = (v, team, myRole = null) =>
  isAdmin(v) || canManageTeamsIn(v, team?.office_id) || myRole === 'pm';

// Legacy manager: a project with no recorded creator (all 48 pre-launch projects) can be managed by anyone
// holding an active source='legacy' membership on it, or 'team_legacy' (a legacy row "Apply new rules" kept
// because of the person's team roster, A4 rule 3d). "Apply new rules" removes the other legacy rows, and
// leaving the roster removes the team_legacy ones, so this narrows with them (§6). p comes from lib/access.js
// projectAccess() or a loader returning the same fields.
export const isLegacyManager = (p) => p.created_by == null && !!p.legacy_member;
export const canManageProject = (v, p) =>
  v.level >= 3 || (v.level >= 2 && inMyOffices(v, p.office_id)) || String(p.created_by) === String(v.id) || isLegacyManager(p);
export const canMoveProject = (v, p, targetTeam) => canManageProject(v, p) && canCreateProjectIn(v, targetTeam);
export const canDeleteProject = (v) => v.level >= 4;                      // admins are 9
export const canRemoveMember = (v, p, m) =>
  String(m.user_id) === String(v.id) || String(m.added_by) === String(v.id) || (v.level >= 2 && !!p.visible) || isAdmin(v);

// PMs read every office but moderate only their own (ch.office_id = the team's office for team channels).
export const canModerateChannel = (v, ch) =>
  v.level >= 4 || (v.level >= 3 && ch.scope !== 'company' && inMyOffices(v, ch.office_id));

// §4.2(a): picking a position that grants no new visibility applies at once; anything above
// max(1, approved level) waits for an admin. Levels may arrive as strings.
export const positionNeedsApproval = (newLevel, approvedLevel) =>
  Number(newLevel) > Math.max(1, Number(approvedLevel) || 1);

export function bracketPolicy(v, b) {                                     // b: { crown_policy, mode, archived, activated_at }
  const open = b.crown_policy === 'anyone', org = isOrganizer(v);
  const upcoming = b.mode === 'auto' && !b.activated_at && !b.archived;
  return {
    canCrown: !b.archived && (open || org),
    canUndo: !b.archived && (open || org),
    canEdit: (!b.archived || isAdmin(v)) && (open || org),
    canDelete: isAdmin(v) || (b.archived && open) || (org && (b.archived || upcoming)),
    canRestore: isAdmin(v),
  };
}

// Open-redirect-proof return path for ?next= and the login {next} (§8.1, §13). Lives here rather than only
// in lib/http.js because the edge middleware needs it too and can't import server modules.
// Returns a same-origin path ('/projects/3?x=1') or null; callers fall back to '/'.
// Percent-encoded control characters and backslashes are refused as well (§14.6: '/%0d%0aLocation:x').
export function safeNext(next, origin) {
  if (typeof next !== 'string' || !next || next.length > 2000) return null;
  let decoded;
  try { decoded = decodeURIComponent(next); } catch { return null; }
  for (const s of [next, decoded]) {
    for (const ch of s) { const c = ch.charCodeAt(0); if (c < 0x20 || c === 0x7f || ch === '\\') return null; }
  }
  if (decoded.startsWith('//')) return null;
  let u, base;
  try { base = new URL(origin); u = new URL(next, base); } catch { return null; }
  if (u.origin !== base.origin) return null;                       // rejects //evil.example and https://evil.example
  const out = u.pathname + u.search + u.hash;
  // Checked again after resolution: dot segments collapse '/.//evil.example' or '/a/..//evil.example' to
  // '//evil.example', which a browser reads as another site.
  if (out.startsWith('//') || out.startsWith('/\\')) return null;
  return out;
}
