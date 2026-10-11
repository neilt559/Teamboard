// The pre-rebuild ensureSchema() statements, verbatim, one statement per element
// (lib/db.js sends them as one transaction, which allows one statement per query).
// Four changes from the old lib/db.js (design §3.1):
//   1. the cold-start "archive every bracket but the newest" UPDATE is deleted
//      (a one-time migration already applied on live; it would archive upcoming auto brackets);
//   2. the suggestion-category whitelist UPDATE moved to sweeps.js;
//   3. the orphan team/project re-homing moved to sweeps.js;
//   4. UPDATE brackets SET office_id = NULL moved to sweeps.js.
// SQL here never contains a backslash (template text is sent as-is).

const ddl = (sql) => ({ sql, kind: 'ddl' });

export const LEGACY = [
  ddl(`CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`),
  ddl(`CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at TIMESTAMPTZ NOT NULL
    )`),
  // Admins can open the (hidden) Accounts page and reset passwords.
  // must_change = the password was reset by an admin; ask for a new one.
  ddl(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT false`),
  ddl(`ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change BOOLEAN NOT NULL DEFAULT false`),
  ddl(`CREATE TABLE IF NOT EXISTS people (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#5B5859',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`),
  ddl(`CREATE TABLE IF NOT EXISTS teams (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      position DOUBLE PRECISION NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`),
  ddl(`CREATE TABLE IF NOT EXISTS projects (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      position DOUBLE PRECISION NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`),
  ddl(`CREATE TABLE IF NOT EXISTS tasks (
      id BIGSERIAL PRIMARY KEY,
      project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      title TEXT NOT NULL DEFAULT '',
      assignee_id BIGINT REFERENCES people(id) ON DELETE SET NULL,
      due_date TEXT,
      status TEXT NOT NULL DEFAULT 'not_started',
      position DOUBLE PRECISION NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`),

  // Migrations for things added after the initial release (idempotent).
  ddl(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS archived BOOLEAN NOT NULL DEFAULT false`),
  ddl(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS notes TEXT NOT NULL DEFAULT ''`),
  // Subtasks: a task with a parent_id is a subtask of that task. Deleting a
  // parent cascades to its subtasks.
  ddl(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS parent_id BIGINT REFERENCES tasks(id) ON DELETE CASCADE`),
  ddl(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS stoplight TEXT NOT NULL DEFAULT ''`),
  // Per-project "additional info": free rows of label + value (link/path).
  ddl(`CREATE TABLE IF NOT EXISTS project_info (
      id BIGSERIAL PRIMARY KEY,
      project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      label TEXT NOT NULL DEFAULT '',
      value TEXT NOT NULL DEFAULT '',
      position DOUBLE PRECISION NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`),
  ddl(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS notes TEXT NOT NULL DEFAULT ''`),
  ddl(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS team_id BIGINT REFERENCES teams(id) ON DELETE CASCADE`),
  ddl(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS archived BOOLEAN NOT NULL DEFAULT false`),
  ddl(`ALTER TABLE teams ADD COLUMN IF NOT EXISTS archived BOOLEAN NOT NULL DEFAULT false`),

  // Offices sit above teams (Office -> Team -> Project).
  ddl(`CREATE TABLE IF NOT EXISTS offices (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      position DOUBLE PRECISION NOT NULL DEFAULT 0,
      archived BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`),
  ddl(`ALTER TABLE teams ADD COLUMN IF NOT EXISTS office_id BIGINT REFERENCES offices(id) ON DELETE CASCADE`),
  // Running tally of perfect 5,000-point GeoGuessr guesses per office.
  ddl(`ALTER TABLE offices ADD COLUMN IF NOT EXISTS fivek INTEGER NOT NULL DEFAULT 0`),
  // Whether the office shows on the GeoGuessr page. Offices that existed when
  // this was added default to on; new offices opt in via "+ Add office".
  ddl(`ALTER TABLE offices ADD COLUMN IF NOT EXISTS geo_on BOOLEAN NOT NULL DEFAULT true`),
  // Per-office meetings (with minutes) and daily GeoGuessr scores.
  ddl(`CREATE TABLE IF NOT EXISTS meetings (
      id BIGSERIAL PRIMARY KEY,
      office_id BIGINT NOT NULL REFERENCES offices(id) ON DELETE CASCADE,
      title TEXT NOT NULL DEFAULT 'Meeting',
      meeting_date TEXT,
      minutes TEXT NOT NULL DEFAULT '',
      position DOUBLE PRECISION NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`),
  ddl(`CREATE TABLE IF NOT EXISTS geo_scores (
      id BIGSERIAL PRIMARY KEY,
      office_id BIGINT NOT NULL REFERENCES offices(id) ON DELETE CASCADE,
      score INTEGER NOT NULL DEFAULT 0,
      score_date TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`),
  // GeoGuessr scores must never disappear with their office: switch the
  // foreign key from ON DELETE CASCADE to RESTRICT so the database itself
  // refuses to delete an office that still has scores. Wrapped so a surprise
  // here can never stop the app from starting.
  ddl(`DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'geo_scores_office_id_fkey' AND confdeltype = 'c') THEN
        ALTER TABLE geo_scores DROP CONSTRAINT geo_scores_office_id_fkey;
        ALTER TABLE geo_scores ADD CONSTRAINT geo_scores_office_id_fkey
          FOREIGN KEY (office_id) REFERENCES offices(id) ON DELETE RESTRICT;
      END IF;
    EXCEPTION WHEN others THEN NULL;
    END $$`),
  // Per-project meetings, optionally grouped into a named series.
  ddl(`CREATE TABLE IF NOT EXISTS meeting_series (
      id BIGSERIAL PRIMARY KEY,
      project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL DEFAULT 'Series',
      position DOUBLE PRECISION NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`),
  ddl(`CREATE TABLE IF NOT EXISTS project_meetings (
      id BIGSERIAL PRIMARY KEY,
      project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      series_id BIGINT REFERENCES meeting_series(id) ON DELETE CASCADE,
      title TEXT NOT NULL DEFAULT 'Meeting',
      meeting_date TEXT,
      attendance TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      position DOUBLE PRECISION NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`),
  // Headshots for logged-in users (shown next to their bracket votes). The
  // image is a small square JPEG data URL; avatar_v busts the browser cache.
  ddl(`ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar TEXT`),
  ddl(`ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_v BIGINT`),
  // The larger original photo + the crop used, so a headshot can be re-cropped
  // later without uploading it again. avatar_crop is JSON {x, y, w} (0-1).
  ddl(`ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_src TEXT`),
  ddl(`ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_crop TEXT`),
  // Vote brackets: 20 entrants, 19 matchups, one vote per user per matchup.
  // office_id is a leftover from when brackets lived on an office page; the
  // every-cold-start sweep keeps it NULL (sweeps.js).
  ddl(`CREATE TABLE IF NOT EXISTS brackets (
      id BIGSERIAL PRIMARY KEY,
      office_id BIGINT REFERENCES offices(id) ON DELETE CASCADE,
      name TEXT NOT NULL DEFAULT 'Bracket',
      notes TEXT NOT NULL DEFAULT '',
      regions TEXT NOT NULL DEFAULT '[]',
      champion_id BIGINT,
      archived BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      completed_at TIMESTAMPTZ
    )`),
  ddl(`ALTER TABLE brackets ALTER COLUMN office_id DROP NOT NULL`),
  ddl(`CREATE TABLE IF NOT EXISTS bracket_entrants (
      id BIGSERIAL PRIMARY KEY,
      bracket_id BIGINT NOT NULL REFERENCES brackets(id) ON DELETE CASCADE,
      name TEXT NOT NULL DEFAULT '',
      quadrant INTEGER NOT NULL DEFAULT 0,
      seed INTEGER NOT NULL DEFAULT 0
    )`),
  ddl(`CREATE TABLE IF NOT EXISTS bracket_matches (
      id BIGSERIAL PRIMARY KEY,
      bracket_id BIGINT NOT NULL REFERENCES brackets(id) ON DELETE CASCADE,
      round INTEGER NOT NULL,
      idx INTEGER NOT NULL,
      a_id BIGINT REFERENCES bracket_entrants(id) ON DELETE SET NULL,
      b_id BIGINT REFERENCES bracket_entrants(id) ON DELETE SET NULL,
      winner_id BIGINT REFERENCES bracket_entrants(id) ON DELETE SET NULL,
      decided_at TIMESTAMPTZ,
      UNIQUE (bracket_id, round, idx)
    )`),
  ddl(`CREATE TABLE IF NOT EXISTS bracket_votes (
      match_id BIGINT NOT NULL REFERENCES bracket_matches(id) ON DELETE CASCADE,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      entrant_id BIGINT NOT NULL REFERENCES bracket_entrants(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (match_id, user_id)
    )`),
  // Suggestion box: ideas anyone can post, +1 and track. user_id is always
  // stored (so the author can edit/delete) but hidden when anonymous = true.
  ddl(`CREATE TABLE IF NOT EXISTS suggestions (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
      title TEXT NOT NULL DEFAULT '',
      details TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT 'other',
      status TEXT NOT NULL DEFAULT 'new',
      anonymous BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`),
  ddl(`CREATE TABLE IF NOT EXISTS suggestion_votes (
      suggestion_id BIGINT NOT NULL REFERENCES suggestions(id) ON DELETE CASCADE,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (suggestion_id, user_id)
    )`),
  // Replies on suggestions. When the poster of an anonymous suggestion replies
  // to it, the reply is anonymous too (so replying doesn't give them away).
  ddl(`CREATE TABLE IF NOT EXISTS suggestion_replies (
      id BIGSERIAL PRIMARY KEY,
      suggestion_id BIGINT NOT NULL REFERENCES suggestions(id) ON DELETE CASCADE,
      user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
      body TEXT NOT NULL DEFAULT '',
      anonymous BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`),
];
