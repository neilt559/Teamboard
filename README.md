# TeamBoard

CAGE Civil's company project board: offices, teams, projects and tasks, plus the Culture section
(brackets, GeoGuessr) and the suggestion box. Everyone signs in, and what each person sees depends on
their office and approved position.

Live at https://cage-teamboard.vercel.app. Vercel deploys every push to `main`, so pushing to `main` is a deploy.

## What's in it

- **Sign-in required.** Accounts are created at `/login` with a `@cagecivil.com` email and the signup code
  (`SIGNUP_CODE`). Each person finishes a one-time profile at `/welcome`: name and email, office, department,
  position, team and boss, and which "name on tasks" is theirs.
- **Pages, not one live screen.** Home (a dashboard you can customize in Settings), My work, Projects,
  All tasks, Offices, Teams, Culture, Suggestions, People and Settings. Every click loads a page with fresh
  data, and text edits are checked against what you started from: if someone else changed the same text,
  you get a "keep mine / use theirs" choice instead of a silent overwrite.
- **Offices, teams and projects.** Offices (Lisle, Chicago, Chandler, Asheville, Charlotte, Lakewood, Venice)
  hold teams, teams hold projects, and projects hold tasks, subtasks, project info and meeting notes.
  Offices have their own meeting minutes.
- **Position-based visibility.** Positions carry a level, and any position above level 1 waits for an admin's
  approval (`/admin/approvals`):

  | Level | Positions | Sees |
  |---|---|---|
  | 1 | Default; entry-level and staff positions | Projects they're a member of |
  | 2 | Senior Designer, Project Engineer, Senior PE, Office Manager | Plus every project in their offices |
  | 3 | Project Manager, Senior PM | Every project, and every office's minutes |
  | 4 | Associate, Director, Principal, VP | Everything level 3 sees; can delete projects |
  | Admin | `is_admin` | Everything, plus `/admin` |

  Anyone on a project can add other people to it, and assigning a task to someone's name adds them. Existing
  accounts keep access to all of today's projects until an admin clicks "Apply new rules" in Admin > Accounts
  (`/admin/users`; it can be undone). The rules are enforced in the database (`tb_*` SQL functions) and in every API route,
  not only in the UI.
- **Culture.** The bracket (vote, crown, undo; culture organizers and admins create new ones) and GeoGuessr,
  which works exactly as before.
- **Admin** (`/admin`, admins only): approvals, accounts (password resets, sign-in locks, disable, extra
  offices, organizers), organization (offices, teams, positions, departments), names on tasks, and a health
  check with row counts.
- **Phones first.** Bottom tab bar, cards instead of tables, 44 px tap targets. Brand colors gray `#5B5859`
  and lime `#CBCE00`; icons are inline SVG (`app/icons.js`), never emoji.

Nothing is ever dropped: `lib/db.js` `ensureSchema()` only adds tables, columns and rows, and runs once per
schema version on the first request after a deploy. Deletes of projects, teams, tasks, meetings and
suggestions save a JSON copy in `audit_log`.

## Code map

| Path | What |
|---|---|
| `app/(app)/` | Signed-in pages; `layout.js` checks the session and draws the shell (`app/_ui/AppShell.js`) |
| `app/login`, `app/welcome`, `app/password` | Sign-in and signup, the one-time profile, the forced password change |
| `app/api/` | JSON routes; each one is wrapped in `handle()` from `lib/http.js` (sign-in, profile, CSRF and error checks) |
| `app/_ui/` | Shared client components (header, sidebar, dialogs, pickers, the `api()` fetch helper) |
| `lib/` | Database (`db.js`, `schema/`), sessions (`auth.js`, `viewer.js`), rules (`policy.js`, `access.js`), page loaders (`queries/`) |
| `middleware.js` | Session check and redirects for every page |

Stack: Next.js 14.2.35 (App Router, plain JavaScript), React 18.3.1, Neon Postgres through
`@neondatabase/serverless` 0.10.4 (HTTP driver, never cached).

## Environment variables (Vercel, Production only)

| Name | Purpose |
|---|---|
| `DATABASE_URL` (or `POSTGRES_URL`) | Neon connection string, added by the Neon integration |
| `SIGNUP_CODE` | The code new accounts need. While it's unset, the old code still works and `/admin` shows a red warning. |
| `CRON_SECRET` | Secret for the daily `/api/cron/brackets` job (`vercel.json`) |
| `ALLOWED_EMAIL_DOMAINS` | Optional; defaults to `cagecivil.com` |

Preview deployments refuse to use the database ("This preview deployment has no database."), so keep the Neon
variables scoped to Production. Never set `TB_SQL_ENDPOINT` or `TB_ALLOW_ADMIN_CLAIM` on Vercel: the first
points the app at a local test database, the second opens the one-time first-admin claim.

## Running and testing locally

Local runs and tests never touch the live site or database. They use a PGlite copy of the live data in
`..\teamboard-testdb` (a sibling folder, not part of this repo):

- `node runapp.mjs` there builds a fresh copy from `pgdata-baseline/` and runs this app against it
  (app on port 3100, SQL on 4444).
- `node tests/run-r1.mjs --build` is the Release 1 gate (build, unit, static checks, migration, roles and
  leak sweep, conflicts, security, GeoGuessr parity, bracket, smoke). `tests/README.md` there explains each suite.

Use portable Node 22 (`C:\Users\NeilTerrell\tools\node-v22.23.3-win-x64`). `TB_DIST_DIR=.next-<name>` builds into
a separate folder so parallel builds don't share `.next`.
