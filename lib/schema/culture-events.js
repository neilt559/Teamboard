// Release 3 schema: the culture events calendar (design §3.3, §10(b); agent K2).
// Same element shape as core.js: { sql: '<exactly one statement>', kind: 'ddl' | 'data' }. Runs last in the one
// migration transaction (lib/db.js STEPS, after culture-challenges.js), so users and offices already exist.
// Additive and idempotent: one new table and its index, all CREATE ... IF NOT EXISTS. There are no data steps
// (nothing is seeded or backfilled), so nothing here can fail on live data. Nothing drops, renames, truncates or
// deletes: an event is cancelled (cancelled_at: still shown, struck through) or archived (archived_at: hidden; admins
// and organizers can restore). The office key is ON DELETE RESTRICT, so an office with events can't be deleted
// (the office DELETE route answers 409 "Archive it instead").
// Dates are TEXT 'YYYY-MM-DD' with a CHECK (design §3.1); times are TEXT 'HH:MM' (24 h) in the event's own zone
// (tz), and starts_at / ends_at are derived from them on every write (lib/events.js eventInstants). SQL here never
// contains a backslash.

const ddl = (sql) => ({ sql, kind: 'ddl' });

const YMD = (c) => `${c} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'`;
const HHMM = (c) => `${c} IS NULL OR ${c} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'`;

export const CULTURE_EVENTS = [
  // 1. An event. Company-wide when office_id is NULL, else one office's (everyone still sees it: events are
  //    company-public, design §4.6). all_day events use only the date strings and never shift; timed events keep the
  //    organizer's wall-clock start_time (required) and end_time (optional) in tz, plus the derived UTC instants for
  //    the viewer's-zone display. Columns beyond design §3.3 (new table only): cancelled_by and archived_by (who), the
  //    length CHECKs, the HH:MM CHECKs, the all-day/time pairing CHECK and the named range CHECK.
  ddl(`CREATE TABLE IF NOT EXISTS culture_events (
  id BIGSERIAL PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '' CHECK (char_length(title) <= 200),
  details TEXT NOT NULL DEFAULT '' CHECK (char_length(details) <= 20000),
  location TEXT NOT NULL DEFAULT '' CHECK (char_length(location) <= 300),
  link_url TEXT NOT NULL DEFAULT '' CHECK (char_length(link_url) <= 2000),
  office_id BIGINT REFERENCES offices(id) ON DELETE RESTRICT,
  all_day BOOLEAN NOT NULL DEFAULT true,
  starts_on TEXT NOT NULL CHECK (${YMD('starts_on')}),
  ends_on TEXT NOT NULL CHECK (${YMD('ends_on')}),
  start_time TEXT CHECK (${HHMM('start_time')}),
  end_time TEXT CHECK (${HHMM('end_time')}),
  tz TEXT NOT NULL DEFAULT 'America/Chicago' CHECK (char_length(tz) BETWEEN 1 AND 64),
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ,
  updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  cancelled_at TIMESTAMPTZ,
  cancelled_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  archived_at TIMESTAMPTZ,
  archived_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT culture_events_range_chk CHECK (ends_on >= starts_on),
  CONSTRAINT culture_events_time_chk CHECK (
    (all_day AND start_time IS NULL AND end_time IS NULL) OR (NOT all_day AND start_time IS NOT NULL)),
  CONSTRAINT culture_events_instants_chk CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at >= starts_at))`),
  ddl(`CREATE INDEX IF NOT EXISTS culture_events_range_idx ON culture_events (starts_on, ends_on) WHERE archived_at IS NULL`),
];
