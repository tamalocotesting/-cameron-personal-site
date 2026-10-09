# StationOps

Digital station-opening checklists for one restaurant location. Employees work through their station's checklist on a phone, mark tasks done, add notes and flag problems. Managers see what was done, by whom and when, resolve flagged issues, edit the checklist without touching history, and export records as CSV.

This is a pilot MVP: **one location, one checklist per station (the opening shift)**. It is self-contained in this folder and is separate from the personal site at the repository root.

---

## Contents

1. [What's built](#whats-built)
2. [Stack and architecture](#stack-and-architecture)
3. [Run it locally](#run-it-locally)
4. [Demo environment](#demo-environment)
5. [Deploy](#deploy)
6. [Set up a real restaurant](#set-up-a-real-restaurant)
7. [Database schema](#database-schema)
8. [Testing](#testing)
9. [Assumptions](#assumptions)
10. [Known limitations](#known-limitations)
11. [Project documents](#project-documents)

---

## What's built

| Screen | Path | Who |
| --- | --- | --- |
| Sign in | `/login` | Everyone |
| Station dashboard: welcome, station, today's checklist, progress, start/continue | `/station` | Employees |
| Checklist: done / undo, notes, flag a problem, progress bar, review and submit | `/station/checklist` | Employees |
| Dashboard: today's counts, required-task progress, open issues, needs attention, recent submissions | `/manager` | Managers |
| Checklist detail: every task with timestamps, notes, issues and resolutions | `/manager/runs/:id` | Managers |
| Issues: open issues with resolution form, recently resolved | `/manager/issues` | Managers |
| History: filter by date, employee, station, status and text; CSV export (summary or every task) | `/manager/history` | Managers |
| Checklist editor: add, edit, reorder, remove, required on/off, version history | `/manager/templates` | Managers |
| Pilot metric: completion rate per period, baseline vs. pilot | `/manager/pilot` | Managers |
| Staff: add people, assign stations, reset passwords, turn off access | `/manager/staff` | Managers |

Rules the app enforces:

- **Progress saves on every tap.** Each change goes straight to the database. Nothing is kept only in the browser.
- **A checklist is "Complete" only when every required task is done.** If a required task is still open or flagged when someone submits, it is recorded as *Submitted with exceptions*, and the exceptions are listed for the employee before they confirm.
- **Flagging a task needs a description.** It opens an issue straight away, so managers see it before the checklist is submitted.
- **One checklist per station per shift date.** A database unique constraint stops duplicates. A second employee on the same station continues the same checklist, and each task records who did it.
- **Checklist edits never change history.** Saving creates a new, unchangeable version. When a checklist starts, its tasks are copied from the current version, so past checklists and today's (if already started) keep the exact wording they had.
- **"Today" is the restaurant's date**, worked out from the restaurant's time zone. All times are stored in UTC and shown in that zone, and CSV headers name the zone.

## Stack and architecture

- **Next.js 16 (App Router) + React 19 + TypeScript**, server-rendered. All data access runs on the server (server components, server actions and one route handler). The browser never talks to the database.
- **Tailwind CSS 4.**
- **PostgreSQL** through `pg`. This works with Supabase, Neon, Render or any Postgres 14+.
- **Authentication is built into the app**: usernames and passwords (no email needed, which suits hourly staff), scrypt password hashing, random 256-bit session tokens stored only as SHA-256 hashes, `httpOnly` + `SameSite=Lax` + `Secure` cookies, 7-day sessions, and a 15-minute lockout after 5 failed attempts.
- **Permissions are enforced on the server for every request.** Manager pages call `requireManager()`, and every manager server action and the CSV route check the role again on their own, so it is never left to the layout alone. Employee writes also check that the run belongs to their station, is today's and is not yet submitted. Every query is scoped to the user's restaurant.
- **Input validation** with zod on every server action.
- **Supabase hardening**: every table has row level security turned on with no policies. If the database is on Supabase, its public REST API can read nothing; the app connects as the table owner.

Why not Supabase Auth? Staff log in with a username instead of an email address, and keeping auth in the app means the whole security model can be tested end to end on plain Postgres. Supabase still works fine as the database host.

```
src/
  app/
    login/            sign-in form + login/logout server actions
    station/          employee dashboard, checklist runner, actions
    manager/          dashboard, runs/[id], issues, history (+ export route), templates, pilot, staff
    denied/           shown when an employee opens a manager page
  lib/
    auth.ts           sessions, login, requireUser/requireManager/assert*
    checklists.ts     start run, update task, submit (transactions + row locks)
    templates.ts      versioned template saves
    reports.ts        history queries and filters
    metrics.ts        completion-rate formula (pure)
    progress.ts       checklist math (pure, shared with the browser)
    csv.ts, time.ts, db.ts, passwords.ts
db/migrations/        SQL schema
scripts/              migrate, seed-demo, setup-restaurant
tests/                unit (vitest) + end-to-end (Playwright)
docs/                 implementation documents (see below)
```

## Run it locally

Requires Node 20.9+ (22 recommended) and PostgreSQL 14+.

```bash
cd stationops
npm install
cp .env.example .env.local          # set DATABASE_URL
npm run db:migrate
npm run db:seed-demo                # prints the demo passwords once
npm run dev                         # http://localhost:3000
```

`npm run build && npm start` runs the production build. Session cookies are `Secure` in production, so a production build only keeps you signed in over HTTPS. For local testing over plain `http://localhost` only, set `INSECURE_COOKIES=true`. **Never set it on a real deployment.**

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | yes | Postgres connection string |
| `DATABASE_SSL` | no | `require` for hosted Postgres (Supabase, Neon, Render) |
| `DATABASE_POOL_MAX` | no | Connections per server instance (default 5; use 1–2 on serverless) |
| `DEMO_MANAGER_PASSWORD`, `DEMO_EMPLOYEE_PASSWORD` | no | Demo passwords for `db:seed-demo`; random ones are generated if unset |
| `DEMO_TIMEZONE` | no | Demo restaurant time zone (default `America/Indiana/Indianapolis`) |
| `MANAGER_PASSWORD` | no | First manager's password for `npm run setup` |

## Demo environment

`npm run db:seed-demo` creates **Sample Bagel Co. (Demo)**. Every screen shows a yellow "Demo environment" banner, and sample records are tagged "sample" in tables and in the CSV `sample_data` column.

| Username | Role | Station |
| --- | --- | --- |
| `demo.manager` | Manager | — |
| `demo.alex` | Employee | Bagel Prep Station |
| `demo.jordan` | Employee | Bagel Prep Station |

Passwords are never in source code. They come from `DEMO_MANAGER_PASSWORD` / `DEMO_EMPLOYEE_PASSWORD`, or are generated randomly and printed once.

The demo includes the 8-task *Bagel Preparation Station — Opening* checklist (sample tasks, which **must be replaced with manager-approved tasks before real use**) and six sample checklists from the past week:

- 3 complete
- 1 with a resolved cooler-temperature issue
- 1 with an open ingredient-shortage issue and an unfinished task
- 1 started but never submitted

There is also one deliberately missed day.

`npm run db:seed-demo -- --reset` rebuilds it. The script refuses to run against a database that holds a real restaurant.

## Deploy

The app was **not deployed** from this build environment because no hosting account or database credentials were available. Both options below are standard. The Docker image has not been built here, because Docker is not available in this environment.

### Option A — Vercel + Supabase (recommended)

1. **Supabase:** create a project. Under *Project Settings → Database → Connection string*, copy the **Session pooler** URI and put in your database password.
2. **Run migrations** once from your computer:
   ```bash
   cd stationops
   DATABASE_URL='postgres://…pooler.supabase.com:5432/postgres' DATABASE_SSL=require npm run db:migrate
   ```
3. **Vercel:** import the GitHub repository. Set **Root Directory** to `stationops`, keep the framework as Next.js, and set the **Build Command** to `npm run build:deploy` (this runs migrations, then builds).
4. Add the environment variables `DATABASE_URL`, `DATABASE_SSL=require` and `DATABASE_POOL_MAX=1`, then deploy.
5. Create the restaurant and first manager ([below](#set-up-a-real-restaurant)), or seed the demo **into a separate database** for demonstrations.

### Option B — any Docker host (Render, Fly.io, Railway, a VPS)

```bash
cd stationops
docker build -t stationops .
docker run -p 3000:3000 -e DATABASE_URL='postgres://…' -e DATABASE_SSL=require stationops
```

The container runs migrations on start. Put it behind HTTPS; the host normally handles that.

### After any deploy

Sign in as the manager on a phone and on a desktop. Work through `docs/04-user-acceptance-testing.md` before go-live.

## Set up a real restaurant

Use a database with no demo data in it.

```bash
MANAGER_PASSWORD='choose-a-strong-one' npm run setup -- \
  --restaurant "Your Restaurant" --timezone America/Chicago \
  --station "Bagel Prep" --manager-username jsmith --manager-name "Jordan Smith"
```

Then the manager signs in and does everything else in the app: creating the checklist (*Checklists*), adding employees (*Staff*) and adding pilot periods (*Pilot metric*). `--station` can be repeated. The time zone must be an IANA name such as `America/New_York`.

## Database schema

The full SQL with comments is in [`db/migrations/001_init.sql`](db/migrations/001_init.sql).

| Table | Holds |
| --- | --- |
| `restaurants` | Name, IANA time zone, demo flag |
| `stations` | Stations at the restaurant |
| `users` | Username, display name, role (`employee`/`manager`), assigned station, password hash, active flag, lockout counters |
| `sessions` | SHA-256 of each session token, user, expiry |
| `checklist_templates` | One per station and shift type; points at its current version |
| `template_versions` | Unchangeable snapshots: version number, name, change note, author |
| `template_tasks` | Tasks of a version: position, description, required |
| `checklist_runs` | One per station + shift type + shift date (unique). Template version used, started/submitted by and at, status, outcome (`complete`/`exceptions`) |
| `run_items` | Tasks copied into the run, with status (`pending`/`done`/`blocked`), note, completed at/by, flagged at/by |
| `issues` | Opened when a task is flagged: description, reporter, status (`open`/`resolved`/`withdrawn`), resolution, resolved by/at. At most one open issue per task |
| `measurement_periods` | Baseline/pilot periods: dates, expected count, optional manually entered completed count |

## Testing

```bash
npm run lint        # TypeScript type-check
npm test            # unit tests: progress math, completion rate, CSV escaping, time zones
npm run build
npm run test:e2e    # Playwright end-to-end against a real Postgres test database
```

The end-to-end suite needs a separate, empty database. It defaults to `postgres://stationops:localdev@localhost:5432/stationops_test`; override it with `TEST_DATABASE_URL`. **The suite drops and recreates that database's `public` schema.** Run `npm run build` first. If Playwright's bundled Chromium is unavailable, set `PLAYWRIGHT_CHROMIUM_PATH`.

Every scenario runs at phone and desktop sizes. The last run passed **22/22** end-to-end runs and **12/12** unit tests:

1. An employee completes a checklist. Progress and notes survive a reload, timestamps appear, the manager sees the submission, and a second employee cannot create a duplicate.
2. A required task left undone is submitted as an exception, not as complete.
3. An employee flags a problem; an empty description is rejected; the manager sees and resolves it, and a too-short resolution is rejected.
4. A manager edits the template (rename, reorder, remove, add, optional). It becomes version 2; past and in-progress checklists keep version 1, and new checklists use version 2.
5. An employee is denied every manager page (redirected) and the CSV export (403); signed-out export requests get 401.

Also covered:

- Logout invalidates the session on the server (a replayed cookie fails).
- Login validation and lockout after 5 failures.
- CSV export, including filters, local times and formula injection being neutralised.
- Pilot-metric math and validation.
- A manager adding an employee who can then sign in.
- No sideways scrolling at 375 px wide.

## Assumptions

Made to keep moving; each one is easy to change.

- One location per database; one opening checklist per station.
- Any employee assigned to a station may work on that station's checklist for today; tasks record who did them.
- The shift date is the restaurant's calendar date when the checklist is first opened. An unsubmitted checklist from a previous day can no longer be edited and appears under *Needs attention*.
- The "Completed today … of N" count assumes every station with an active checklist opens every day. Pilot measurement uses the manager-entered expected count instead.
- Completion % for a checklist = required tasks done ÷ required tasks. Optional tasks never count against it.
- Employees reset forgotten passwords by asking a manager; there is no email-based reset.

## Known limitations

- **Not deployed**, and the Docker image is untested (see [Deploy](#deploy)).
- **No offline mode.** If the connection drops, the tap shows "Could not save" and the employee retries. Nothing is silently lost, but nothing is queued either.
- **Not real-time push.** The manager dashboard shows current data on load or refresh; it does not update live.
- **Lockout is per account only.** There is no IP-based rate limiting; add one at the host or CDN if the app is public.
- **Shift dates are tied to calendar days**, so overnight shifts that cross midnight aren't modelled.
- **No closing or mid-shift checklists**, and no due-time or "late" status.
- **Deactivating a station or removing a template** isn't exposed in the UI (database only). Removing tasks is supported.
- **Staff cannot change their own password** — a manager sets it.
- **History pages show up to 500 rows**, so narrow by date for more. CSV exports up to 10,000 runs.
- **Browser support:** current Chrome, Safari 16.4+ and Firefox. The submit dialog uses `<dialog>`.
- **The accessibility review was informal:** labelled controls, focus rings, roles and 48 px touch targets. There has been no formal WCAG audit or screen-reader test.

## Project documents

In [`docs/`](docs):

1. [Customer discovery and requirements](docs/01-discovery-and-requirements.md)
2. [One-page project scope](docs/02-project-scope.md)
3. [Checklist configuration](docs/03-checklist-configuration.md)
4. [User acceptance testing (testing checklist)](docs/04-user-acceptance-testing.md)
5. [Staff guide](docs/05-staff-guide.md)
6. [Manager training guide](docs/06-manager-guide.md)
7. [Go-live approval](docs/07-go-live-approval.md)
8. [Issue tracking](docs/08-issue-tracking.md)
9. [Customer handoff](docs/09-customer-handoff.md)
10. [Two-week pilot rollout plan](docs/10-pilot-rollout-plan.md)
