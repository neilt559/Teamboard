// A6 schema (design-amendments A6, Neil 2026-10-13): project structure and the weekly owner reports' sources.
// Same element shape as core.js: { sql: '<exactly one statement>', kind: 'ddl' | 'data' }. Runs after LEGACY,
// CORE and THREADS in the one migration transaction (lib/db.js STEPS).
// Additive and idempotent: ADD COLUMN IF NOT EXISTS with constant defaults (metadata-only, no rewrite), named
// constraints added once (duplicate_object), CREATE ... IF NOT EXISTS. The data steps are one-time and
// ledger-gated and cannot fail: the job-number backfill (writes only project_number where it is still '') and the
// Status Report review stamp for projects with blank notes (writes only a NULL status_report_reviewed_at).
// Project names are NEVER changed. Nothing here drops, renames, truncates or deletes.
// SQL here never contains a backslash (template text is sent as-is).

const ddl = (sql) => ({ sql, kind: 'ddl' });
const data = (sql) => ({ sql, kind: 'data' });

// 'YYYY-MM-DD' (date-only columns are TEXT with a CHECK, design §3.1).
const YMD = (c) => `${c} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'`;

export const PROJECTS_EXT = [
  // 1. projects: job number, owner, jurisdiction, the stages it goes through (a JSON array of keys in the fixed
  //    order concept, preliminary, final, bidding, construction: lib/projects.js STAGES), the current stage and
  //    the schedule status ('' = not set). Existing rows get the defaults.
  ddl(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS project_number TEXT NOT NULL DEFAULT ''`),
  ddl(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS owner_company TEXT NOT NULL DEFAULT ''`),
  ddl(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS jurisdiction TEXT NOT NULL DEFAULT ''`),
  ddl(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS stages TEXT NOT NULL DEFAULT '[]'`),
  ddl(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS current_stage TEXT NOT NULL DEFAULT ''`),
  ddl(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS schedule_status TEXT NOT NULL DEFAULT ''`),
  ddl(`DO $$ BEGIN ALTER TABLE projects ADD CONSTRAINT projects_schedule_status_chk
  CHECK (schedule_status IN ('', 'ahead', 'on_track', 'behind'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$`),

  // 2. One time: the job number of every existing project, from the leading digits of its name
  //    ("230021 - Randall Commons" -> 230021; at least 4 digits, leading spaces skipped). Only where the number is
  //    still '', and the name is untouched. Nothing else changes (not rev, not updated_at). One audit row lists
  //    the ids (actor NULL = the deploy). A name without a leading number keeps project_number ''.
  data(`WITH u AS (UPDATE projects p SET project_number = substring(p.name from '^[[:space:]]*([0-9]{4,})')
       WHERE p.project_number = '' AND substring(p.name from '^[[:space:]]*([0-9]{4,})') IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM schema_meta WHERE key = 'once:project_numbers')
       RETURNING p.id)
INSERT INTO audit_log (actor_id, action, entity, entity_id, detail)
SELECT NULL::bigint, 'project.number_backfill', 'projects', NULL::text,
       jsonb_build_object('project_ids', jsonb_agg(u.id ORDER BY u.id), 'seed', true)
FROM u HAVING count(*) > 0`),
  data(`INSERT INTO schema_meta (key, value) VALUES ('once:project_numbers', now()::text) ON CONFLICT (key) DO NOTHING`),

  // 3. Submittals: who it goes to (agency) and what it is (title), with a status. Every status has its own
  //    dates; changing the status keeps the others (history). Review period in days (expected response =
  //    submitted_date + review_days, computed). Soft delete = archived. CASCADE with the project, like the other
  //    project children (a project delete snapshots them first, lib/queries/project.js deleteProject).
  ddl(`CREATE TABLE IF NOT EXISTS project_submittals (
  id BIGSERIAL PRIMARY KEY,
  project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  agency TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'not_submitted'
    CHECK (status IN ('not_submitted','comments_received','under_review','approved')),
  target_date TEXT CHECK (${YMD('target_date')}),
  received_date TEXT CHECK (${YMD('received_date')}),
  reply_by_date TEXT CHECK (${YMD('reply_by_date')}),
  submitted_date TEXT CHECK (${YMD('submitted_date')}),
  approved_date TEXT CHECK (${YMD('approved_date')}),
  review_days INTEGER CHECK (review_days BETWEEN 1 AND 365),
  note TEXT NOT NULL DEFAULT '',
  position DOUBLE PRECISION NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ,
  updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  archived BOOLEAN NOT NULL DEFAULT false)`),
  ddl(`CREATE INDEX IF NOT EXISTS project_submittals_project_idx ON project_submittals (project_id)`),

  // 4. Upcoming meetings: a simple list (minutes stay in the project meetings). Date required, time 'HH:MM'
  //    optional, what / with whom required, where optional. Past ones stay (hidden by default); soft delete =
  //    archived. CASCADE with the project (snapshotted by a project delete).
  ddl(`CREATE TABLE IF NOT EXISTS project_upcoming_meetings (
  id BIGSERIAL PRIMARY KEY,
  project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  meeting_date TEXT NOT NULL CHECK (${YMD('meeting_date')}),
  meeting_time TEXT CHECK (meeting_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  title TEXT NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 300),
  location TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ,
  updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  archived BOOLEAN NOT NULL DEFAULT false)`),
  ddl(`CREATE INDEX IF NOT EXISTS project_upcoming_meetings_project_idx ON project_upcoming_meetings (project_id, meeting_date)`),

  // 5. Status Report review (2026-10-14 review: the pre-A6 "Project notes" were written as internal notes, with
  //    staff names, internal reviews and remarks; A6 retitles that field "Status Report", which goes to owners).
  //    status_report_reviewed_at NULL = the text predates reports and nobody has reviewed it for owners yet: the
  //    report loaders never select it (reports say "No status report this week.") and the project page asks for a
  //    review ("Use in reports"; emptying the text also counts). Existing rows get NULL (the ADD has no default);
  //    rows inserted afterwards get now() (their Status Report is written as one). The text is never changed.
  ddl(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS status_report_reviewed_at TIMESTAMPTZ`),
  ddl(`ALTER TABLE projects ALTER COLUMN status_report_reviewed_at SET DEFAULT now()`),
  //    One time: a project whose notes are blank has nothing to review, so it starts reviewed (only NULL stamps
  //    are filled; rev, updated_at and the text untouched). Ledger-gated: a later deploy never stamps anything.
  data(`UPDATE projects SET status_report_reviewed_at = now()
WHERE status_report_reviewed_at IS NULL AND COALESCE(notes, '') !~ '[^[:space:]]'
  AND NOT EXISTS (SELECT 1 FROM schema_meta WHERE key = 'once:status_report_review')`),
  data(`INSERT INTO schema_meta (key, value) VALUES ('once:status_report_review', now()::text) ON CONFLICT (key) DO NOTHING`),

  // 6. A8 Attention Items (design-amendments A8.1, Neil 2026-10-14): what we need from third parties (owner, client,
  //    architect, a village, a person...), who it's from, and optionally when we need it by. Open until someone
  //    clicks Received (status 'received' + the date it came in; Re-open sets it back to 'open' and keeps the
  //    date as history). Soft delete = archived. CASCADE with the project like the other A6 children (a project
  //    delete snapshots them first, lib/queries/project.js deleteProject). The owner reports list every OPEN,
  //    non-archived item (what, from whom, need by); never the internal note.
  ddl(`CREATE TABLE IF NOT EXISTS project_attention_items (
  id BIGSERIAL PRIMARY KEY,
  project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  item TEXT NOT NULL CHECK (char_length(btrim(item)) BETWEEN 1 AND 500),
  from_party TEXT NOT NULL DEFAULT '',
  need_by TEXT CHECK (${YMD('need_by')}),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','received')),
  received_date TEXT CHECK (${YMD('received_date')}),
  note TEXT NOT NULL DEFAULT '',
  position DOUBLE PRECISION NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ,
  updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  archived BOOLEAN NOT NULL DEFAULT false)`),
  ddl(`CREATE INDEX IF NOT EXISTS project_attention_items_project_idx ON project_attention_items (project_id)`),

  // 7. A9 one combined Meetings section (design-amendments A9, Neil 2026-10-14: "The meetings should be combined but
  //    do not include meeting minutes in the report"). project_meetings gains a time ('HH:MM', optional), a place and
  //    archived (the soft delete: nothing is ever deleted); a meeting series gains archived. Upcoming and Past are
  //    worked out from meeting_date on the Central date; the owner reports list the upcoming ones, never minutes.
  ddl(`ALTER TABLE project_meetings ADD COLUMN IF NOT EXISTS meeting_time TEXT`),
  ddl(`DO $$ BEGIN ALTER TABLE project_meetings ADD CONSTRAINT project_meetings_time_chk
  CHECK (meeting_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
EXCEPTION WHEN duplicate_object THEN NULL; END $$`),
  ddl(`ALTER TABLE project_meetings ADD COLUMN IF NOT EXISTS location TEXT NOT NULL DEFAULT ''`),
  ddl(`ALTER TABLE project_meetings ADD COLUMN IF NOT EXISTS archived BOOLEAN NOT NULL DEFAULT false`),
  ddl(`ALTER TABLE meeting_series ADD COLUMN IF NOT EXISTS archived BOOLEAN NOT NULL DEFAULT false`),
  ddl(`CREATE INDEX IF NOT EXISTS project_meetings_date_idx ON project_meetings (project_id, meeting_date)`),
  //    Where each A6 upcoming meeting went (a project_meetings id).
  ddl(`ALTER TABLE project_upcoming_meetings ADD COLUMN IF NOT EXISTS merged_into BIGINT`),
  //    One time (once:merge_upcoming_meetings, can't fail): every A6 upcoming meeting that isn't archived becomes a
  //    project meeting (title, date, time, place, who made and last changed it and when; no series, no minutes),
  //    then the old row is stamped (merged_into) and archived. Never deleted. One audit row maps old -> new ids.
  data(`DO $$
DECLARE r record; nid bigint; moved jsonb := '[]'::jsonb;
BEGIN
  IF EXISTS (SELECT 1 FROM schema_meta WHERE key = 'once:merge_upcoming_meetings') THEN RETURN; END IF;
  FOR r IN SELECT u.id, u.project_id, u.meeting_date, u.meeting_time, u.title, u.location, u.created_at, u.created_by,
                  u.updated_at, u.updated_by
           FROM project_upcoming_meetings u WHERE NOT u.archived AND u.merged_into IS NULL ORDER BY u.id
  LOOP
    INSERT INTO project_meetings (project_id, series_id, title, meeting_date, meeting_time, location, attendance, notes,
                                  position, created_at, created_by, updated_at, updated_by)
    VALUES (r.project_id, NULL, r.title, r.meeting_date, r.meeting_time, r.location, '', '',
            extract(epoch FROM r.created_at) * 1000, r.created_at, r.created_by, r.updated_at, r.updated_by)
    RETURNING id INTO nid;
    UPDATE project_upcoming_meetings SET merged_into = nid, archived = true WHERE id = r.id;
    moved := moved || jsonb_build_array(jsonb_build_object('upcoming_id', r.id, 'meeting_id', nid, 'project_id', r.project_id));
  END LOOP;
  IF jsonb_array_length(moved) > 0 THEN
    INSERT INTO audit_log (actor_id, action, entity, entity_id, detail)
    VALUES (NULL, 'project_meeting.merge_upcoming', 'project_meetings', NULL, jsonb_build_object('moved', moved, 'seed', true));
  END IF;
END $$`),
  data(`INSERT INTO schema_meta (key, value) VALUES ('once:merge_upcoming_meetings', now()::text) ON CONFLICT (key) DO NOTHING`),
  // 8. The report's document link (Neil, 2026-10-15: "a 'Report Egnyte Link' ... where we will paste a link to the
  //    egnyte folder ... so on the report they can click that link"). One web address per project ('' = none),
  //    shown on the owner report and its email copy. The old "Additional project info" rows stay (never deleted).
  ddl(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS report_link TEXT NOT NULL DEFAULT ''`),
  ddl(`DO $$ BEGIN ALTER TABLE projects ADD CONSTRAINT projects_report_link_chk CHECK (char_length(report_link) <= 2000);
EXCEPTION WHEN duplicate_object THEN NULL; END $$`),
];
