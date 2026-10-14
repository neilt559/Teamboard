// Release 2 schema: thread spaces (design-amendments A5, which replaces design §9 and the §3.3 threads schema).
// Same element shape as core.js: { sql: '<exactly one statement>', kind: 'ddl' | 'data' }. Runs after LEGACY and
// CORE in one transaction, so tb_user_level, tb_user_office_ids and team_members already exist.
// Additive and idempotent: CREATE ... IF NOT EXISTS, ADD COLUMN IF NOT EXISTS with constant defaults, named
// constraints added once (duplicate_object), CREATE OR REPLACE functions. The only data steps are the one-time,
// ledger-gated move of the existing suggestions into the Charlotte space (skipped quietly when there is no
// Charlotte) and the release2_at stamp; neither can fail. Nothing here drops, truncates or deletes.
// SQL here never contains a backslash (template text is sent as-is).
//
// Spaces: 'company' (CAGE, everyone), 'office:<id>', 'team:<id>' (lib/spaces.js). Sections: announcements and chat
// (space_posts), suggestions (the suggestions tables, now scoped). Office and team ids are ON DELETE RESTRICT:
// an office or team with posts or suggestions can only be archived, never deleted (the admin DELETE routes refuse
// with 409 first; these keys back that up).

const ddl = (sql) => ({ sql, kind: 'ddl' });
const data = (sql) => ({ sql, kind: 'data' });

export const THREADS = [
  // 1. announcements and chat. parent_id = a reply (announcements only, one level). deleted_at = the author's own
  //    soft delete; hidden_at/by = a moderator's hide. Nothing is ever deleted.
  ddl(`CREATE TABLE IF NOT EXISTS space_posts (
  id BIGSERIAL PRIMARY KEY,
  scope TEXT NOT NULL CHECK (scope IN ('company','office','team')),
  office_id BIGINT REFERENCES offices(id) ON DELETE RESTRICT,
  team_id BIGINT REFERENCES teams(id) ON DELETE RESTRICT,
  section TEXT NOT NULL CHECK (section IN ('announcements','chat')),
  parent_id BIGINT REFERENCES space_posts(id) ON DELETE RESTRICT,
  author_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 10000),
  pinned BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  edited_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  hidden_at TIMESTAMPTZ,
  hidden_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT space_posts_scope_chk CHECK (
    (scope = 'company' AND office_id IS NULL AND team_id IS NULL) OR
    (scope = 'office' AND office_id IS NOT NULL AND team_id IS NULL) OR
    (scope = 'team' AND team_id IS NOT NULL AND office_id IS NULL)),
  CONSTRAINT space_posts_reply_chk CHECK (parent_id IS NULL OR section = 'announcements'))`),
  //    moderated_at: when a moderator last hid, unhid, pinned or unpinned it. An unhide puts hidden_at back to NULL,
  //    so chat polling (changed_since) needs this stamp to bring the post back (review fix, 2026-10-14). Its own
  //    statement, so a database that already has space_posts gains it too.
  ddl(`ALTER TABLE space_posts ADD COLUMN IF NOT EXISTS moderated_at TIMESTAMPTZ`),
  ddl(`CREATE INDEX IF NOT EXISTS space_posts_space_idx ON space_posts (scope, office_id, team_id, section, created_at DESC)`),
  ddl(`CREATE INDEX IF NOT EXISTS space_posts_parent_idx ON space_posts (parent_id)`),

  // 2. suggestions belong to a space. Existing rows default to 'company' (valid under the CHECK), and the one-time
  //    step below moves them to Charlotte. Votes and replies hang off the suggestion ids, so they move along.
  ddl(`ALTER TABLE suggestions ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'company'`),
  ddl(`ALTER TABLE suggestions ADD COLUMN IF NOT EXISTS office_id BIGINT REFERENCES offices(id) ON DELETE RESTRICT`),
  ddl(`ALTER TABLE suggestions ADD COLUMN IF NOT EXISTS team_id BIGINT REFERENCES teams(id) ON DELETE RESTRICT`),
  ddl(`DO $$ BEGIN ALTER TABLE suggestions ADD CONSTRAINT suggestions_space_chk CHECK (
    (scope = 'company' AND office_id IS NULL AND team_id IS NULL) OR
    (scope = 'office' AND office_id IS NOT NULL AND team_id IS NULL) OR
    (scope = 'team' AND team_id IS NOT NULL AND office_id IS NULL));
EXCEPTION WHEN duplicate_object THEN NULL; END $$`),
  ddl(`CREATE INDEX IF NOT EXISTS suggestions_space_idx ON suggestions (scope, office_id, team_id)`),

  // 3. read markers, one per (user, space, section); upsert only (GREATEST, never backwards).
  ddl(`CREATE TABLE IF NOT EXISTS space_reads (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  space_key TEXT NOT NULL CHECK (space_key ~ '^(company|(office|team):[1-9][0-9]*)$'),
  section TEXT NOT NULL CHECK (section IN ('announcements','suggestions','chat')),
  last_read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, space_key, section))`),

  // 4. visibility (A5.2): the single source of truth for every space list, read and write. A disabled user (level
  //    0) reads nothing; CAGE is everyone's; an office space is its home and extra-office members' plus Director
  //    and up (L4) and admins (9), which is stricter than meeting minutes (L3+); a team space is its active roster
  //    plus L4 and admins. Profile-incomplete users never get this far (handle() and requirePageViewer).
  //    Signatures and return types are frozen; a future change adds a new function name.
  ddl(`CREATE OR REPLACE FUNCTION tb_can_read_space(p_uid BIGINT, p_scope TEXT, p_office BIGINT, p_team BIGINT)
RETURNS BOOLEAN LANGUAGE sql STABLE AS $fn$
  SELECT COALESCE(CASE
    WHEN COALESCE(tb_user_level(p_uid), 0) = 0 THEN false
    WHEN p_scope = 'company' THEN true
    WHEN p_scope = 'office' THEN COALESCE(tb_user_level(p_uid), 0) >= 4
                                 OR p_office IN (SELECT tb_user_office_ids(p_uid))
    WHEN p_scope = 'team' THEN COALESCE(tb_user_level(p_uid), 0) >= 4
                               OR EXISTS (SELECT 1 FROM team_members m
                                          WHERE m.team_id = p_team AND m.user_id = p_uid AND m.removed_at IS NULL)
    ELSE false END, false)
$fn$`),
  //    Moderators (A5.4) hide/unhide any post and pin/unpin announcements: admins, L4 and up, and in a team space
  //    that team's PM (an active 'pm' roster row). Always within spaces they can read.
  ddl(`CREATE OR REPLACE FUNCTION tb_can_moderate_space(p_uid BIGINT, p_scope TEXT, p_office BIGINT, p_team BIGINT)
RETURNS BOOLEAN LANGUAGE sql STABLE AS $fn$
  SELECT COALESCE(tb_can_read_space(p_uid, p_scope, p_office, p_team) AND (
       COALESCE(tb_user_level(p_uid), 0) >= 4
    OR (p_scope = 'team' AND EXISTS (SELECT 1 FROM team_members m
                                     WHERE m.team_id = p_team AND m.user_id = p_uid AND m.removed_at IS NULL
                                       AND m.role = 'pm'))), false)
$fn$`),

  // 5. One time (Neil, 2026-10-13): the existing company suggestions move into the Charlotte office space. Only
  //    the new columns change (title, status, votes, replies, anonymity and updated_at stay as they are). Charlotte
  //    is matched by lower(btrim(name)), an active one first; with no Charlotte nothing moves and the ledger row is
  //    still written, so suggestions posted to CAGE later are never swept along. One audit row lists the ids.
  data(`WITH ch AS (SELECT o.id FROM offices o WHERE lower(btrim(o.name)) = 'charlotte' ORDER BY o.archived ASC, o.id ASC LIMIT 1),
mv AS (UPDATE suggestions s SET scope = 'office', office_id = ch.id FROM ch
       WHERE s.scope = 'company' AND s.office_id IS NULL AND s.team_id IS NULL
         AND NOT EXISTS (SELECT 1 FROM schema_meta WHERE key = 'once:suggestions_to_charlotte')
       RETURNING s.id, ch.id AS office_id)
INSERT INTO audit_log (actor_id, action, entity, entity_id, detail)
SELECT NULL::bigint, 'suggestion.move_space', 'offices', min(mv.office_id)::text,
       jsonb_build_object('suggestion_ids', jsonb_agg(mv.id ORDER BY mv.id), 'from', 'company', 'seed', true)
FROM mv HAVING count(*) > 0`),
  data(`INSERT INTO schema_meta (key, value) VALUES ('once:suggestions_to_charlotte', now()::text) ON CONFLICT (key) DO NOTHING`),
  // When Release 2 first migrated (epoch ms, like release1_at). Unread counts start here for existing users, so
  // nobody opens TeamBoard to a pile of "unread" history (lib/queries/spaces.js).
  data(`INSERT INTO schema_meta (key, value)
VALUES ('release2_at', (extract(epoch FROM now()) * 1000)::bigint::text) ON CONFLICT (key) DO NOTHING`),
];
