// Thread spaces (design-amendments A5, Release 2). Pure helpers with no imports, so route handlers, loaders and
// (if the static checks' client list allows it) client components can share them.
//
// A space is not a row: it is (scope, office_id, team_id), named by a key:
//   'company'      the CAGE space (everyone)
//   'office:<id>'  one per office
//   'team:<id>'    one per team (shown nested under its office; the team's office is read from teams)
// Every space has three sections. Announcements and chat live in space_posts; suggestions keep their own tables
// (suggestions, suggestion_votes, suggestion_replies) and carry scope / office_id / team_id.
// Who reads a space is decided in SQL only (tb_can_read_space, lib/schema/threads.js); these helpers never grant
// anything.

export const SECTIONS = ['announcements', 'suggestions', 'chat'];
export const POST_SECTIONS = ['announcements', 'chat'];          // the sections stored in space_posts
export const COMPANY_SPACE_NAME = 'CAGE';
export const POST_BODY_MAX = 10000;                              // space_posts.body CHECK (1..10000 characters)

// An id inside a key: canonical digits only (no sign, no leading zero, at most 18 digits, so it fits a BIGINT).
// The same rule as the space_reads.space_key CHECK (lib/schema/threads.js).
const KEY = /^(office|team):([1-9][0-9]{0,17})$/;

// 'company' | 'office:<id>' | 'team:<id>' -> { key, scope, office_id, team_id } (ids as strings), else null.
// Strict: exactly these spellings (no case folding, no spaces, no leading zeros), so one space has one key and
// space_reads rows stay unique. Anything else is treated like a space that doesn't exist.
export function parseSpaceKey(v) {
  if (typeof v !== 'string') return null;
  if (v === 'company') return { key: 'company', scope: 'company', office_id: null, team_id: null };
  const m = KEY.exec(v);
  if (!m) return null;
  const id = m[2];
  if (m[1] === 'office') return { key: `office:${id}`, scope: 'office', office_id: id, team_id: null };
  return { key: `team:${id}`, scope: 'team', office_id: null, team_id: id };
}

// The key of a (scope, office_id, team_id) triple, as stored in space_reads.
export function spaceKeyOf({ scope, office_id: officeId, team_id: teamId }) {
  if (scope === 'company') return 'company';
  if (scope === 'office') return `office:${officeId}`;
  if (scope === 'team') return `team:${teamId}`;
  return null;
}

// The page for a space key: /threads/cage, /threads/office/<id>, /threads/team/<id>.
export function spaceHref(key) {
  const s = typeof key === 'string' ? parseSpaceKey(key) : key;
  if (!s) return '/threads';
  if (s.scope === 'company') return '/threads/cage';
  if (s.scope === 'office') return `/threads/office/${s.office_id}`;
  return `/threads/team/${s.team_id}`;
}

export const isSection = (v) => SECTIONS.includes(v);
export const isPostSection = (v) => POST_SECTIONS.includes(v);

// The moderator rule (A5.4), mirrored for display only: admins, L4 and up, and in a team space that team's PM.
// space.my_role = the viewer's active roster role on the team ('pm' | 'member' | null). The API decides with the
// SQL function tb_can_moderate_space; every post it returns already carries can_moderate.
export const isSpaceModerator = (v, space) =>
  !!v && (!!v.is_admin || Number(v.level) >= 4 || (space?.scope === 'team' && space?.my_role === 'pm'));
