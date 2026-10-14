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

  // 6. Suggestions/Announcements (design-amendments A10, Neil 2026-10-14: "remove announcements and general chat
  //    and just make the suggestions a combined suggestions/announcements"). One board for CAGE ('company') and
  //    one per office; every post is a row of suggestions with a kind. Announcements have a title and a body
  //    (details, notes markup), always show their author, take replies, and have no votes, status or category.
  //    The space tables stay: chat is kept unused, and each announcement copied below is stamped in migrated_to.
  ddl(`ALTER TABLE suggestions ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'suggestion'`),
  ddl(`DO $$ BEGIN ALTER TABLE suggestions ADD CONSTRAINT suggestions_kind_chk CHECK (kind IN ('suggestion','announcement'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$`),
  //    The suggestions row an announcement became, or the suggestion_replies row a reply became (no key: two tables).
  ddl(`ALTER TABLE space_posts ADD COLUMN IF NOT EXISTS migrated_to BIGINT`),

  //    One time (ledger once:board_a10, written after both steps below), like the other data steps: team spaces are
  //    gone, so a team-scoped suggestion moves to its team's office board (CAGE when the team has no office). Only
  //    the space columns change. One audit row lists the moves.
  data(`WITH mv AS (UPDATE suggestions s
                SET scope = CASE WHEN t.office_id IS NULL THEN 'company' ELSE 'office' END,
                    office_id = t.office_id, team_id = NULL
                FROM teams t WHERE s.scope = 'team' AND t.id = s.team_id
                  AND NOT EXISTS (SELECT 1 FROM schema_meta WHERE key = 'once:board_a10')
                RETURNING s.id, t.id AS team_id, t.office_id)
INSERT INTO audit_log (actor_id, action, entity, entity_id, detail)
SELECT NULL::bigint, 'suggestion.move_space', 'suggestions', NULL::text,
       jsonb_build_object('moved', jsonb_agg(jsonb_build_object('id', mv.id, 'team_id', mv.team_id, 'office_id', mv.office_id)
                                             ORDER BY mv.id), 'from', 'team', 'seed', true)
FROM mv HAVING count(*) > 0`),

  //    Every thread-space announcement (top level, not deleted or hidden) becomes a kind 'announcement' row on the
  //    board of its space (a team's goes to the team's office), with the same author, created_at and anonymity
  //    off; its replies (not deleted or hidden) become suggestion_replies. The title is the first line without its
  //    notes code (%t, %h) when that line is a short plain line, and the body is the rest; otherwise (a bullet, a
  //    line over 120 characters, nothing left) the title is cut from it and the body keeps the full text. One time
  //    (once:board_a10); each original is also stamped with the id it became, and nothing else in space_posts ever
  //    changes. One audit row maps each post and reply to its new row. Known rollback effect: an announcement posted
  //    while Release 2 serves again after this ran stays in space_posts (kept, not shown).
  data(`DO $$
DECLARE
  r record; nid bigint; first_line text; head text; rest text; nl int; cut boolean;
  posts jsonb := '[]'::jsonb; replies jsonb := '[]'::jsonb;
BEGIN
  IF EXISTS (SELECT 1 FROM schema_meta WHERE key = 'once:board_a10') THEN RETURN; END IF;
  FOR r IN
    SELECT p.id, p.author_id, p.body, p.created_at, p.edited_at,
           CASE WHEN p.scope <> 'team' THEN p.scope WHEN t.office_id IS NULL THEN 'company' ELSE 'office' END AS scope,
           CASE WHEN p.scope = 'team' THEN t.office_id ELSE p.office_id END AS office_id
    FROM space_posts p LEFT JOIN teams t ON p.scope = 'team' AND t.id = p.team_id
    WHERE p.section = 'announcements' AND p.parent_id IS NULL AND p.migrated_to IS NULL
      AND p.deleted_at IS NULL AND p.hidden_at IS NULL
    ORDER BY p.id
  LOOP
    nl := strpos(r.body, chr(10));
    first_line := CASE WHEN nl = 0 THEN r.body ELSE left(r.body, nl - 1) END;
    head := btrim(regexp_replace(first_line, '^[[:space:]]*(%[tThH][[:space:]]+|-[[:space:]]+)', ''));
    cut := first_line ~ '^[[:space:]]*-[[:space:]]' OR head = '' OR char_length(head) > 120;
    IF cut THEN
      rest := r.body;
      head := CASE WHEN head = '' THEN 'Announcement'
                   WHEN char_length(head) > 120 THEN rtrim(left(head, 119)) || chr(8230) ELSE head END;
    ELSE
      rest := CASE WHEN nl = 0 THEN '' ELSE substr(r.body, nl + 1) END;
      rest := regexp_replace(rest, '^([[:blank:]]*' || chr(10) || ')+', '');
      rest := regexp_replace(rest, '[[:space:]]+$', '');
    END IF;
    INSERT INTO suggestions (user_id, title, details, category, status, anonymous, created_at, updated_at,
                             scope, office_id, team_id, kind)
    VALUES (r.author_id, head, rest, 'other', 'new', false, r.created_at, COALESCE(r.edited_at, r.created_at),
            r.scope, r.office_id, NULL, 'announcement')
    RETURNING id INTO nid;
    UPDATE space_posts SET migrated_to = nid WHERE id = r.id;
    posts := posts || jsonb_build_array(jsonb_build_object('post_id', r.id, 'suggestion_id', nid));
  END LOOP;
  FOR r IN
    SELECT q.id, q.author_id, q.body, q.created_at, par.migrated_to AS sid
    FROM space_posts q JOIN space_posts par ON par.id = q.parent_id
    WHERE q.migrated_to IS NULL AND q.deleted_at IS NULL AND q.hidden_at IS NULL
      AND par.section = 'announcements' AND par.migrated_to IS NOT NULL
      AND EXISTS (SELECT 1 FROM suggestions s WHERE s.id = par.migrated_to AND s.kind = 'announcement')
    ORDER BY q.id
  LOOP
    INSERT INTO suggestion_replies (suggestion_id, user_id, body, anonymous, created_at)
    VALUES (r.sid, r.author_id, r.body, false, r.created_at)
    RETURNING id INTO nid;
    UPDATE space_posts SET migrated_to = nid WHERE id = r.id;
    replies := replies || jsonb_build_array(jsonb_build_object('post_id', r.id, 'reply_id', nid));
  END LOOP;
  IF jsonb_array_length(posts) > 0 OR jsonb_array_length(replies) > 0 THEN
    INSERT INTO audit_log (actor_id, action, entity, entity_id, detail)
    VALUES (NULL, 'suggestion.from_announcements', 'suggestions', NULL,
            jsonb_build_object('posts', posts, 'replies', replies, 'seed', true));
  END IF;
END $$`),
  data(`INSERT INTO schema_meta (key, value) VALUES ('once:board_a10', now()::text) ON CONFLICT (key) DO NOTHING`),
  //    When A10 first migrated (epoch ms). Board unread counts start here (lib/queries/suggestions.js), so the
  //    copied announcements and older posts don't arrive as a pile of "unread".
  data(`INSERT INTO schema_meta (key, value)
VALUES ('board_at', (extract(epoch FROM now()) * 1000)::bigint::text) ON CONFLICT (key) DO NOTHING`),
];
