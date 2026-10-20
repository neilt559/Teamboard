// Release 3 schema: monthly challenges and their stat entries (design §3.3, §10(a); agent K1).
// Same element shape as core.js: { sql: '<exactly one statement>', kind: 'ddl' | 'data' }. Runs last in the one
// migration transaction (lib/db.js STEPS), after LEGACY, CORE, THREADS and PROJECTS_EXT, so users, offices and
// departments already exist.
// Office bingo (2026-10-19) adds two columns with defaults (kind 'stats' keeps every existing challenge as it was) and
// two tables, all ... IF NOT EXISTS.
// Additive and idempotent: two new tables and their indexes, all CREATE ... IF NOT EXISTS. There are no data steps
// (nothing is seeded or backfilled), so nothing here can fail on live data. Nothing drops, renames, truncates or
// deletes: challenges are archived (archived_at) and entries soft-deleted (deleted_at); the keys to users and
// challenges are ON DELETE RESTRICT, so neither can be hard-deleted while entries point at it.
// Dates are TEXT 'YYYY-MM-DD' with a CHECK (design §3.1). SQL here never contains a backslash.

const ddl = (sql) => ({ sql, kind: 'ddl' });

const YMD = (c) => `${c} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'`;

export const CULTURE_CHALLENGES = [
  // 1. A challenge: one metric (label + unit), aggregated per person as sum (total), max (best single entry; the
  //    lowest one when lower is better) or count (number of entries). Company-wide when office_id is NULL, else
  //    for that office's people. group_rank = how the Offices and Departments boards rank: avg per participant
  //    (fair across office sizes) or sum. Soft delete = archived_at (organizers can restore).
  ddl(`CREATE TABLE IF NOT EXISTS culture_challenges (
  id BIGSERIAL PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '' CHECK (char_length(title) <= 200),
  description TEXT NOT NULL DEFAULT '' CHECK (char_length(description) <= 20000),
  metric_label TEXT NOT NULL DEFAULT 'Points' CHECK (char_length(metric_label) <= 60),
  unit TEXT NOT NULL DEFAULT '' CHECK (char_length(unit) <= 20),
  aggregation TEXT NOT NULL DEFAULT 'sum' CHECK (aggregation IN ('sum','max','count')),
  higher_is_better BOOLEAN NOT NULL DEFAULT true,
  group_rank TEXT NOT NULL DEFAULT 'avg' CHECK (group_rank IN ('avg','sum')),
  starts_on TEXT NOT NULL CHECK (${YMD('starts_on')}),
  ends_on TEXT NOT NULL CHECK (${YMD('ends_on')}),
  office_id BIGINT REFERENCES offices(id) ON DELETE RESTRICT,
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ,
  updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  archived_at TIMESTAMPTZ,
  CONSTRAINT culture_challenges_range_chk CHECK (ends_on >= starts_on))`),
  ddl(`CREATE INDEX IF NOT EXISTS culture_challenges_range_idx ON culture_challenges (starts_on, ends_on) WHERE archived_at IS NULL`),

  // 2. A stat entry. office_id and department_id are snapshots of the person's home office and department when
  //    the entry was logged, so past group boards stay stable when someone moves (the boards count each person
  //    once, under their latest entry's snapshot). value 0..1,000,000 with 2 decimals. Owners change their own
  //    entries until ends_on + 3 days, organizers any time (lib/challenges.js); updated_by records an organizer's
  //    edit of someone else's entry. Soft delete only: deleted_at / deleted_by.
  ddl(`CREATE TABLE IF NOT EXISTS culture_entries (
  id BIGSERIAL PRIMARY KEY,
  challenge_id BIGINT NOT NULL REFERENCES culture_challenges(id) ON DELETE RESTRICT,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  office_id BIGINT REFERENCES offices(id) ON DELETE SET NULL,
  department_id BIGINT REFERENCES departments(id) ON DELETE SET NULL,
  entry_date TEXT NOT NULL CHECK (${YMD('entry_date')}),
  value NUMERIC(12,2) NOT NULL CHECK (value >= 0 AND value <= 1000000),
  note TEXT NOT NULL DEFAULT '' CHECK (char_length(note) <= 500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ,
  updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  deleted_at TIMESTAMPTZ,
  deleted_by BIGINT REFERENCES users(id) ON DELETE SET NULL)`),
  ddl(`CREATE INDEX IF NOT EXISTS culture_entries_board_idx ON culture_entries (challenge_id, user_id) WHERE deleted_at IS NULL`),
  ddl(`CREATE INDEX IF NOT EXISTS culture_entries_user_idx ON culture_entries (user_id, challenge_id, entry_date) WHERE deleted_at IS NULL`),

  // 3. Office bingo (Neil, 2026-10-19; lib/bingo.js). kind 'stats' is every challenge so far (the default, so
  //    existing rows are untouched); kind 'bingo' is one shared 5x5 card (bingo_squares, a JSON array of 25 labels)
  //    that the playing offices (culture_bingo_offices) mark one square a day. A playing office row is only setup,
  //    so it goes with its office; a pick is history and keeps its office (RESTRICT) and its challenge.
  ddl(`ALTER TABLE culture_challenges ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'stats' CHECK (kind IN ('stats','bingo'))`),
  ddl(`ALTER TABLE culture_challenges ADD COLUMN IF NOT EXISTS bingo_squares TEXT NOT NULL DEFAULT '' CHECK (char_length(bingo_squares) <= 10000)`),
  ddl(`CREATE TABLE IF NOT EXISTS culture_bingo_offices (
  challenge_id BIGINT NOT NULL REFERENCES culture_challenges(id) ON DELETE RESTRICT,
  office_id BIGINT NOT NULL REFERENCES offices(id) ON DELETE CASCADE,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (challenge_id, office_id))`),

  // 4. A marked square. play_date = the Central day it counts for. Undo is soft (undone_at / undone_by). The two
  //    partial unique indexes ARE the rules: one standing pick per office per day, and a square marked once.
  ddl(`CREATE TABLE IF NOT EXISTS culture_bingo_picks (
  id BIGSERIAL PRIMARY KEY,
  challenge_id BIGINT NOT NULL REFERENCES culture_challenges(id) ON DELETE RESTRICT,
  office_id BIGINT NOT NULL REFERENCES offices(id) ON DELETE RESTRICT,
  square SMALLINT NOT NULL CHECK (square >= 0 AND square <= 24),
  play_date TEXT NOT NULL CHECK (${YMD('play_date')}),
  picked_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  undone_at TIMESTAMPTZ,
  undone_by BIGINT REFERENCES users(id) ON DELETE SET NULL)`),
  ddl(`CREATE UNIQUE INDEX IF NOT EXISTS culture_bingo_picks_day_uq ON culture_bingo_picks (challenge_id, office_id, play_date) WHERE undone_at IS NULL`),
  ddl(`CREATE UNIQUE INDEX IF NOT EXISTS culture_bingo_picks_square_uq ON culture_bingo_picks (challenge_id, office_id, square) WHERE undone_at IS NULL`),

  // 5. Chili cook-off (Neil, 2026-10-20; lib/chili.js): kind 'chili'. The kind CHECK widens once (the column's own
  //    check from step 3 is swapped for a named one that allows 'chili'; existing rows are 'stats' or 'bingo').
  //    revealed_at = an organizer revealed the results early (otherwise they reveal after ends_on, Central).
  ddl(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'culture_challenges_kind_chk') THEN
        ALTER TABLE culture_challenges DROP CONSTRAINT IF EXISTS culture_challenges_kind_check;
        ALTER TABLE culture_challenges ADD CONSTRAINT culture_challenges_kind_chk CHECK (kind IN ('stats','bingo','chili'));
      END IF;
    END $$`),
  ddl(`ALTER TABLE culture_challenges ADD COLUMN IF NOT EXISTS revealed_at TIMESTAMPTZ`),

  // 6. The chilis: one per week (week_of = that week's Monday, Central), with its cook (an account, or just a name).
  //    A chili with ratings is archived, never deleted.
  ddl(`CREATE TABLE IF NOT EXISTS culture_chilis (
  id BIGSERIAL PRIMARY KEY,
  challenge_id BIGINT NOT NULL REFERENCES culture_challenges(id) ON DELETE RESTRICT,
  week_of TEXT NOT NULL CHECK (${YMD('week_of')}),
  cook_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  cook_name TEXT NOT NULL DEFAULT '' CHECK (char_length(cook_name) <= 80),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ)`),
  ddl(`CREATE INDEX IF NOT EXISTS culture_chilis_challenge_idx ON culture_chilis (challenge_id, week_of) WHERE archived_at IS NULL`),

  // 7. A rating: one per person per chili, 1 to 10, changeable until the reveal. Secret: only its author ever sees it;
  //    after the reveal everyone sees each chili's average and count, never who gave what.
  ddl(`CREATE TABLE IF NOT EXISTS culture_chili_ratings (
  chili_id BIGINT NOT NULL REFERENCES culture_chilis(id) ON DELETE RESTRICT,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  score SMALLINT NOT NULL CHECK (score >= 1 AND score <= 10),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ,
  PRIMARY KEY (chili_id, user_id))`),
];
