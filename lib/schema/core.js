// Release 1 schema (design §3.2 and the §4.3 visibility functions). One statement
// per element. kind 'data' marks backfills and seeds: each one is ledger-gated
// (schema_meta 'once:*' rows written in the same transaction) or guarded with
// ON CONFLICT / NOT EXISTS, and touches only NULL or default values, so it cannot
// fail and never repeats. Nothing here drops, truncates or deletes.
// SQL here never contains a backslash (template text is sent as-is).

const ddl = (sql) => ({ sql, kind: 'ddl' });
const data = (sql) => ({ sql, kind: 'data' });

export const CORE = [
  // 0. ledger
  ddl(`CREATE TABLE IF NOT EXISTS schema_meta (
  key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '', updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`),

  // 1. sessions (sessions and users are already locked, in that order, by lib/db.js)
  ddl(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS token_hash TEXT`),
  data(`UPDATE sessions SET token_hash = encode(sha256(convert_to(token, 'UTF8')), 'hex') WHERE token_hash IS NULL`),
  ddl(`CREATE UNIQUE INDEX IF NOT EXISTS sessions_token_hash_uq ON sessions (token_hash)`),
  ddl(`CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id)`),

  // 2. reference tables + seeds (idempotent by key; admin renames and re-levels survive re-runs)
  ddl(`CREATE TABLE IF NOT EXISTS positions (
  id BIGSERIAL PRIMARY KEY, key TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  level SMALLINT NOT NULL DEFAULT 1 CHECK (level BETWEEN 1 AND 4),
  sort INTEGER NOT NULL DEFAULT 0, archived BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now())`),
  ddl(`CREATE TABLE IF NOT EXISTS departments (
  id BIGSERIAL PRIMARY KEY, key TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#5B5859', sort INTEGER NOT NULL DEFAULT 0,
  archived BOOLEAN NOT NULL DEFAULT false, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`),
  data(`INSERT INTO positions (key, name, level, sort) VALUES
  ('intern','Intern',1,10), ('cad_tech','CAD Technician',1,20), ('designer','Designer',1,30),
  ('engineer_1','Civil Engineer I (Entry Level)',1,40), ('engineer_2','Civil Engineer II',1,50),
  ('landscape_designer','Landscape Designer',1,60), ('survey_tech','Survey Technician',1,70),
  ('admin_staff','Administrative / Office Staff',1,80), ('marketing','Marketing Coordinator',1,90),
  ('accounting','Accounting Staff',1,100),
  ('senior_designer','Senior Designer',2,110), ('project_engineer','Project Engineer',2,120),
  ('senior_project_engineer','Senior Project Engineer',2,130), ('office_manager','Office Manager',2,140),
  ('project_manager','Project Manager',3,150), ('senior_project_manager','Senior Project Manager',3,160),
  ('associate','Associate',4,170), ('director','Director / Department Head',4,180),
  ('principal','Principal',4,190), ('executive','Vice President / Executive',4,200)
ON CONFLICT (key) DO NOTHING`),
  data(`INSERT INTO departments (key, name, color, sort) VALUES
  ('civil','Civil Engineering','#5B5859',10), ('design_cad','Design & CAD','#0086c0',20),
  ('survey','Survey','#7f5347',30), ('landscape','Landscape Architecture','#037f4c',40),
  ('permitting','Permitting & Entitlements','#a25ddc',50), ('construction','Construction Services','#c77c02',60),
  ('bd_marketing','Business Development & Marketing','#fdab3d',70), ('accounting','Accounting & Finance','#00c875',80),
  ('hr','Human Resources','#ff158a',90), ('it','IT','#e2445c',100),
  ('operations','Operations & Administration','#8a8788',110), ('leadership','Leadership','#9aa000',120)
ON CONFLICT (key) DO NOTHING`),

  // 3. offices: time zone + the five new offices (Charlotte id 1 and Asheville id 3
  //    untouched, still geo_on = true). NULL tz is displayed as America/Chicago.
  ddl(`ALTER TABLE offices ADD COLUMN IF NOT EXISTS tz TEXT`),
  data(`INSERT INTO offices (name, position, geo_on, tz)
SELECT v.name, (SELECT COALESCE(max(position), 0) FROM offices) + v.n, false, v.tz
FROM (VALUES ('Lisle',1,'America/Chicago'), ('Chicago',2,'America/Chicago'), ('Chandler',3,'America/Phoenix'),
             ('Lakewood',4,'America/Denver'), ('Venice',5,'America/New_York')) AS v(name, n, tz)
WHERE NOT EXISTS (SELECT 1 FROM offices o WHERE lower(btrim(o.name)) = lower(v.name))
  AND NOT EXISTS (SELECT 1 FROM schema_meta WHERE key = 'once:seed_offices')`),
  data(`INSERT INTO schema_meta (key, value) VALUES ('once:seed_offices', 'done') ON CONFLICT (key) DO NOTHING`),
  // All seven names, not just Charlotte and Asheville: an office someone created under a seed name before the
  // deploy is reused by the seed above (no duplicate), and gets its time zone here. NULL tz only.
  data(`UPDATE offices o SET tz = v.tz
FROM (VALUES ('charlotte','America/New_York'), ('asheville','America/New_York'), ('lisle','America/Chicago'),
             ('chicago','America/Chicago'), ('chandler','America/Phoenix'), ('lakewood','America/Denver'),
             ('venice','America/New_York')) AS v(n, tz)
 WHERE o.tz IS NULL AND lower(btrim(o.name)) = v.n`),

  // 4. users: profile, approval, flags, prefs, identity check (all nullable or constant-default)
  ddl(`ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name TEXT NOT NULL DEFAULT ''`),
  ddl(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT`),
  ddl(`ALTER TABLE users ADD COLUMN IF NOT EXISTS office_id BIGINT REFERENCES offices(id) ON DELETE RESTRICT`),
  ddl(`ALTER TABLE users ADD COLUMN IF NOT EXISTS team_id BIGINT REFERENCES teams(id) ON DELETE SET NULL`),
  ddl(`ALTER TABLE users ADD COLUMN IF NOT EXISTS department_id BIGINT REFERENCES departments(id) ON DELETE SET NULL`),
  ddl(`ALTER TABLE users ADD COLUMN IF NOT EXISTS position_id BIGINT REFERENCES positions(id) ON DELETE SET NULL`),
  ddl(`ALTER TABLE users ADD COLUMN IF NOT EXISTS approved_position_id BIGINT REFERENCES positions(id) ON DELETE SET NULL`),
  ddl(`ALTER TABLE users ADD COLUMN IF NOT EXISTS position_requested_at TIMESTAMPTZ`),
  ddl(`ALTER TABLE users ADD COLUMN IF NOT EXISTS position_decided_at TIMESTAMPTZ`),
  ddl(`ALTER TABLE users ADD COLUMN IF NOT EXISTS position_decided_by BIGINT REFERENCES users(id) ON DELETE SET NULL`),
  ddl(`ALTER TABLE users ADD COLUMN IF NOT EXISTS manager_id BIGINT REFERENCES users(id) ON DELETE SET NULL`),
  ddl(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_organizer BOOLEAN NOT NULL DEFAULT false`),
  ddl(`ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_completed_at TIMESTAMPTZ`),
  ddl(`ALTER TABLE users ADD COLUMN IF NOT EXISTS disabled_at TIMESTAMPTZ`),
  ddl(`ALTER TABLE users ADD COLUMN IF NOT EXISTS prefs JSONB NOT NULL DEFAULT '{}'::jsonb`),
  ddl(`ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_set_by BIGINT REFERENCES users(id) ON DELETE SET NULL`),
  ddl(`ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_set_at TIMESTAMPTZ`),
  // NULL = name/email not yet checked by an admin
  ddl(`ALTER TABLE users ADD COLUMN IF NOT EXISTS identity_verified_at TIMESTAMPTZ`),
  ddl(`ALTER TABLE users ADD COLUMN IF NOT EXISTS identity_verified_by BIGINT REFERENCES users(id) ON DELETE SET NULL`),
  ddl(`ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ`),
  ddl(`CREATE UNIQUE INDEX IF NOT EXISTS users_email_uq ON users (lower(email)) WHERE email IS NOT NULL AND email <> ''`),
  // jgnowak@cagecivil.com and sjones@cagecivil.com sign in with their email as username.
  data(`UPDATE users SET email = lower(username)
 WHERE email IS NULL AND username ~* '^[^@[:space:]]+@cagecivil[.]com$'
   AND NOT EXISTS (SELECT 1 FROM users x WHERE x.id <> users.id AND lower(x.email) = lower(users.username))
   AND NOT EXISTS (SELECT 1 FROM users y WHERE y.id <> users.id AND lower(y.username) = lower(users.username))
   AND NOT EXISTS (SELECT 1 FROM schema_meta WHERE key = 'once:email_backfill')`),
  data(`INSERT INTO schema_meta (key, value) VALUES ('once:email_backfill', 'done') ON CONFLICT (key) DO NOTHING`),
  ddl(`CREATE INDEX IF NOT EXISTS users_office_idx ON users (office_id)`),
  ddl(`CREATE INDEX IF NOT EXISTS users_team_idx ON users (team_id)`),
  ddl(`CREATE INDEX IF NOT EXISTS users_manager_idx ON users (manager_id)`),

  // 5. people <-> users link (tasks.assignee_id untouched); kind is 'person' | 'group'
  ddl(`ALTER TABLE people ADD COLUMN IF NOT EXISTS user_id BIGINT REFERENCES users(id) ON DELETE SET NULL`),
  ddl(`ALTER TABLE people ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'person'`),
  ddl(`ALTER TABLE people ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ`),
  ddl(`CREATE UNIQUE INDEX IF NOT EXISTS people_user_uq ON people (user_id) WHERE user_id IS NOT NULL`),
  // *Everyone, Team Beaver, Team Potato
  data(`UPDATE people SET kind = 'group'
 WHERE kind = 'person' AND (name LIKE '*%' OR name ~* '^team[[:space:]]')
   AND NOT EXISTS (SELECT 1 FROM schema_meta WHERE key = 'once:people_groups')`),
  data(`INSERT INTO schema_meta (key, value) VALUES ('once:people_groups', 'done') ON CONFLICT (key) DO NOTHING`),

  // 6. authorship, edit tracking and the per-project change counter (all nullable / constant default).
  //    Every table that guardedPatch stamps with 'full' audit has both updated_at and updated_by.
  ddl(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS created_by BIGINT REFERENCES users(id) ON DELETE SET NULL`),
  ddl(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ`),
  ddl(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL`),
  // bumped by every write inside the project
  ddl(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS rev BIGINT NOT NULL DEFAULT 0`),
  ddl(`ALTER TABLE teams ADD COLUMN IF NOT EXISTS created_by BIGINT REFERENCES users(id) ON DELETE SET NULL`),
  ddl(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS created_by BIGINT REFERENCES users(id) ON DELETE SET NULL`),
  ddl(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ`),
  ddl(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL`),
  ddl(`ALTER TABLE project_info ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ`),
  ddl(`ALTER TABLE project_info ADD COLUMN IF NOT EXISTS updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL`),
  ddl(`ALTER TABLE meetings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ`),
  ddl(`ALTER TABLE meetings ADD COLUMN IF NOT EXISTS updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL`),
  ddl(`ALTER TABLE project_meetings ADD COLUMN IF NOT EXISTS created_by BIGINT REFERENCES users(id) ON DELETE SET NULL`),
  ddl(`ALTER TABLE project_meetings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ`),
  ddl(`ALTER TABLE project_meetings ADD COLUMN IF NOT EXISTS updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL`),
  ddl(`ALTER TABLE meeting_series ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ`),
  ddl(`ALTER TABLE meeting_series ADD COLUMN IF NOT EXISTS updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL`),
  ddl(`ALTER TABLE brackets ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ`),
  ddl(`ALTER TABLE brackets ADD COLUMN IF NOT EXISTS updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL`),
  ddl(`ALTER TABLE bracket_entrants ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ`),
  ddl(`ALTER TABLE bracket_entrants ADD COLUMN IF NOT EXISTS updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL`),

  // 7. membership (soft removal), extra-office grants (soft revoke), approval requests.
  //    project_members.source: 'manual' | 'creator' | 'task' | 'legacy' | 'admin';
  //    remove_batch = audit_log.id of a bulk prune (undo restores by batch).
  ddl(`CREATE TABLE IF NOT EXISTS project_members (
  project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT 'manual',
  added_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  removed_at TIMESTAMPTZ,
  removed_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  remove_batch BIGINT,
  PRIMARY KEY (project_id, user_id))`),
  ddl(`CREATE INDEX IF NOT EXISTS project_members_user_idx ON project_members (user_id) WHERE removed_at IS NULL`),
  ddl(`CREATE TABLE IF NOT EXISTS user_offices (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  office_id BIGINT NOT NULL REFERENCES offices(id) ON DELETE CASCADE,
  granted_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  revoked_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  PRIMARY KEY (user_id, office_id))`),
  // Immutable payload; a re-request supersedes, never edits in place.
  ddl(`CREATE TABLE IF NOT EXISTS access_requests (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('person_link','office_change')),
  person_id BIGINT REFERENCES people(id) ON DELETE SET NULL,
  office_id BIGINT REFERENCES offices(id) ON DELETE SET NULL,
  team_id BIGINT REFERENCES teams(id) ON DELETE SET NULL,
  from_office_id BIGINT REFERENCES offices(id) ON DELETE SET NULL,
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','declined','superseded','withdrawn')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  decided_at TIMESTAMPTZ,
  decision_note TEXT NOT NULL DEFAULT '')`),
  ddl(`CREATE UNIQUE INDEX IF NOT EXISTS access_requests_one_pending ON access_requests (user_id, kind) WHERE status = 'pending'`),

  // 8. DAY-ONE ACCESS: every existing real account keeps every existing project (exactly once)
  data(`INSERT INTO project_members (project_id, user_id, source)
SELECT p.id, u.id, 'legacy' FROM projects p CROSS JOIN users u
WHERE u.username NOT LIKE 'zz!_%' ESCAPE '!'
  AND NOT EXISTS (SELECT 1 FROM schema_meta WHERE key = 'once:legacy_members')
ON CONFLICT DO NOTHING`),
  data(`INSERT INTO schema_meta (key, value) VALUES ('once:legacy_members', now()::text) ON CONFLICT (key) DO NOTHING`),

  // 9. brackets: policy, soft delete, scheduling (scheduling columns stay inert until Release 3).
  //    Existing rows get today's rules (crown_policy 'anyone', mode 'manual'); new rows insert 'organizers'.
  ddl(`ALTER TABLE brackets ADD COLUMN IF NOT EXISTS created_by BIGINT REFERENCES users(id) ON DELETE SET NULL`),
  ddl(`ALTER TABLE brackets ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`),
  ddl(`ALTER TABLE brackets ADD COLUMN IF NOT EXISTS deleted_by BIGINT REFERENCES users(id) ON DELETE SET NULL`),
  ddl(`ALTER TABLE brackets ADD COLUMN IF NOT EXISTS crown_policy TEXT NOT NULL DEFAULT 'anyone'`),
  ddl(`ALTER TABLE brackets ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'manual'`),
  // Monday 'YYYY-MM-DD' (auto only)
  ddl(`ALTER TABLE brackets ADD COLUMN IF NOT EXISTS starts_on TEXT`),
  ddl(`ALTER TABLE brackets ADD COLUMN IF NOT EXISTS activated_at TIMESTAMPTZ`),
  ddl(`ALTER TABLE brackets ADD COLUMN IF NOT EXISTS resolved_through SMALLINT NOT NULL DEFAULT -1`),
  ddl(`DO $$ BEGIN ALTER TABLE brackets ADD CONSTRAINT brackets_mode_chk CHECK (mode IN ('manual','auto'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$`),
  ddl(`DO $$ BEGIN ALTER TABLE brackets ADD CONSTRAINT brackets_policy_chk CHECK (crown_policy IN ('anyone','organizers'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$`),
  ddl(`DO $$ BEGIN ALTER TABLE brackets ADD CONSTRAINT brackets_auto_start_chk
  CHECK (mode = 'manual' OR starts_on ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$');
EXCEPTION WHEN duplicate_object THEN NULL; END $$`),
  ddl(`CREATE UNIQUE INDEX IF NOT EXISTS brackets_auto_start_uq ON brackets (starts_on)
  WHERE mode = 'auto' AND deleted_at IS NULL AND NOT archived`),
  // decided_by: NULL (legacy) | 'manual' | 'auto' | 'organizer'
  ddl(`ALTER TABLE bracket_matches ADD COLUMN IF NOT EXISTS decided_by TEXT`),
  ddl(`ALTER TABLE bracket_matches ADD COLUMN IF NOT EXISTS decided_by_user BIGINT REFERENCES users(id) ON DELETE SET NULL`),
  // decide_reason: 'manual' | 'organizer' | 'votes' | 'seed' | 'total_votes' | 'quadrant' | 'bye'
  ddl(`ALTER TABLE bracket_matches ADD COLUMN IF NOT EXISTS decide_reason TEXT`),
  ddl(`ALTER TABLE bracket_matches ADD COLUMN IF NOT EXISTS a_votes INTEGER`),
  ddl(`ALTER TABLE bracket_matches ADD COLUMN IF NOT EXISTS b_votes INTEGER`),

  // 10. suggestions moderation + status attribution
  ddl(`ALTER TABLE suggestions ADD COLUMN IF NOT EXISTS hidden_at TIMESTAMPTZ`),
  ddl(`ALTER TABLE suggestions ADD COLUMN IF NOT EXISTS hidden_by BIGINT REFERENCES users(id) ON DELETE SET NULL`),
  ddl(`ALTER TABLE suggestions ADD COLUMN IF NOT EXISTS status_changed_by BIGINT REFERENCES users(id) ON DELETE SET NULL`),
  ddl(`ALTER TABLE suggestions ADD COLUMN IF NOT EXISTS status_changed_at TIMESTAMPTZ`),
  ddl(`ALTER TABLE suggestion_replies ADD COLUMN IF NOT EXISTS hidden_at TIMESTAMPTZ`),
  ddl(`ALTER TABLE suggestion_replies ADD COLUMN IF NOT EXISTS hidden_by BIGINT REFERENCES users(id) ON DELETE SET NULL`),

  // 11. audit trail (hard deletes store a JSON snapshot) + login throttle (upsert only, rows reused in place).
  //     audit_log.action: 'task.delete', 'position.approve', 'member.prune_legacy', ...
  //     auth_throttle.key: 'u:<existing username>' | 'ip:<addr>' | 'signup:<addr>' | 'pw:<userId>'
  ddl(`CREATE TABLE IF NOT EXISTS audit_log (
  id BIGSERIAL PRIMARY KEY, at TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity TEXT NOT NULL, entity_id TEXT, detail JSONB NOT NULL DEFAULT '{}'::jsonb)`),
  ddl(`CREATE INDEX IF NOT EXISTS audit_log_entity_idx ON audit_log (entity, entity_id)`),
  ddl(`CREATE TABLE IF NOT EXISTS auth_throttle (
  key TEXT PRIMARY KEY,
  window_start TIMESTAMPTZ NOT NULL DEFAULT now(), failures INTEGER NOT NULL DEFAULT 0)`),

  // 12. indexes for scoped queries (tables are small; plain CREATE INDEX inside the txn is fine)
  ddl(`CREATE INDEX IF NOT EXISTS tasks_project_idx ON tasks (project_id)`),
  ddl(`CREATE INDEX IF NOT EXISTS tasks_assignee_idx ON tasks (assignee_id) WHERE assignee_id IS NOT NULL`),
  ddl(`CREATE INDEX IF NOT EXISTS tasks_parent_idx ON tasks (parent_id) WHERE parent_id IS NOT NULL`),
  ddl(`CREATE INDEX IF NOT EXISTS projects_team_idx ON projects (team_id)`),
  ddl(`CREATE INDEX IF NOT EXISTS teams_office_idx ON teams (office_id)`),
  ddl(`CREATE INDEX IF NOT EXISTS project_info_project_idx ON project_info (project_id)`),
  ddl(`CREATE INDEX IF NOT EXISTS meetings_office_idx ON meetings (office_id)`),
  ddl(`CREATE INDEX IF NOT EXISTS project_meetings_project_idx ON project_meetings (project_id)`),
  ddl(`CREATE INDEX IF NOT EXISTS meeting_series_project_idx ON meeting_series (project_id)`),
  ddl(`CREATE INDEX IF NOT EXISTS geo_scores_office_idx ON geo_scores (office_id)`),
  ddl(`CREATE INDEX IF NOT EXISTS bracket_entrants_bracket_idx ON bracket_entrants (bracket_id)`),
  ddl(`CREATE INDEX IF NOT EXISTS bracket_votes_entrant_idx ON bracket_votes (entrant_id)`),
  ddl(`CREATE INDEX IF NOT EXISTS bracket_votes_user_idx ON bracket_votes (user_id)`),
  ddl(`CREATE INDEX IF NOT EXISTS suggestion_replies_sugg_idx ON suggestion_replies (suggestion_id)`),

  // 13. visibility functions (design §4.3), created last so every referenced column exists.
  //     Signatures and return types are frozen; a future change adds a new function name.
  //     Levels: 0 disabled, 1 assigned, 2 office, 3 company (PM), 4 leadership, 9 admin.
  ddl(`CREATE OR REPLACE FUNCTION tb_user_level(p_uid BIGINT) RETURNS INTEGER LANGUAGE sql STABLE AS $fn$
  SELECT CASE WHEN u.disabled_at IS NOT NULL THEN 0
              WHEN u.is_admin THEN 9
              ELSE COALESCE((SELECT p.level FROM positions p WHERE p.id = u.approved_position_id), 1) END
  FROM users u WHERE u.id = p_uid
$fn$`),
  ddl(`CREATE OR REPLACE FUNCTION tb_user_office_ids(p_uid BIGINT) RETURNS SETOF BIGINT LANGUAGE sql STABLE AS $fn$
  SELECT u.office_id FROM users u WHERE u.id = p_uid AND u.office_id IS NOT NULL
  UNION
  SELECT x.office_id FROM user_offices x WHERE x.user_id = p_uid AND x.revoked_at IS NULL
$fn$`),
  ddl(`CREATE OR REPLACE FUNCTION tb_visible_project_ids(p_uid BIGINT) RETURNS SETOF BIGINT LANGUAGE sql STABLE AS $fn$
  WITH lv AS (SELECT COALESCE(tb_user_level(p_uid), 0) AS n)
  SELECT p.id FROM projects p CROSS JOIN lv WHERE lv.n >= 3
  UNION
  SELECT m.project_id FROM project_members m CROSS JOIN lv
   WHERE lv.n >= 1 AND m.user_id = p_uid AND m.removed_at IS NULL
  UNION
  SELECT p.id FROM projects p JOIN teams t ON t.id = p.team_id CROSS JOIN lv
   WHERE lv.n >= 2 AND t.office_id IN (SELECT tb_user_office_ids(p_uid))
$fn$`),
  ddl(`CREATE OR REPLACE FUNCTION tb_can_see_project(p_uid BIGINT, p_pid BIGINT) RETURNS BOOLEAN LANGUAGE sql STABLE AS $fn$
  WITH lv AS (SELECT COALESCE(tb_user_level(p_uid), 0) AS n)
  SELECT EXISTS (SELECT 1 FROM projects WHERE id = p_pid) AND (
       (SELECT n FROM lv) >= 3
    OR ((SELECT n FROM lv) >= 1 AND EXISTS (SELECT 1 FROM project_members m
          WHERE m.project_id = p_pid AND m.user_id = p_uid AND m.removed_at IS NULL))
    OR ((SELECT n FROM lv) >= 2 AND EXISTS (SELECT 1 FROM projects p JOIN teams t ON t.id = p.team_id
          WHERE p.id = p_pid AND t.office_id IN (SELECT tb_user_office_ids(p_uid)))))
$fn$`),
  // Office-internal content (office meetings, office thread). PMs and up (L3+) read every
  // office's internals (Neil, 2026-10-11).
  ddl(`CREATE OR REPLACE FUNCTION tb_can_see_office(p_uid BIGINT, p_office BIGINT) RETURNS BOOLEAN LANGUAGE sql STABLE AS $fn$
  SELECT COALESCE(tb_user_level(p_uid), 0) >= 3
      OR (COALESCE(tb_user_level(p_uid), 0) >= 1 AND p_office IN (SELECT tb_user_office_ids(p_uid)))
$fn$`),
  ddl(`CREATE OR REPLACE FUNCTION tb_can_read_channel(p_uid BIGINT, p_scope TEXT, p_office BIGINT, p_team BIGINT)
RETURNS BOOLEAN LANGUAGE sql STABLE AS $fn$
  SELECT CASE
    WHEN COALESCE(tb_user_level(p_uid), 0) = 0 THEN false
    WHEN p_scope = 'company' THEN true
    WHEN p_scope = 'office'  THEN tb_can_see_office(p_uid, p_office)
    WHEN p_scope = 'team'    THEN COALESCE(tb_user_level(p_uid), 0) >= 3
                                 OR EXISTS (SELECT 1 FROM users u WHERE u.id = p_uid AND u.team_id = p_team)
    ELSE false END
$fn$`),
];
