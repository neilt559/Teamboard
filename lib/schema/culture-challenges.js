// Release 3 schema: monthly challenges and their stat entries (design §3.3, §10(a); agent K1).
// Same element shape as core.js: { sql: '<exactly one statement>', kind: 'ddl' | 'data' }. Runs last in the one
// migration transaction (lib/db.js STEPS), after LEGACY, CORE, THREADS and PROJECTS_EXT, so users, offices and
// departments already exist.
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
];
