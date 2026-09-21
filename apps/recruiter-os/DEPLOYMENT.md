# Deployment

This describes how to deploy the application. It does not authorize you to
collect real applicant data — see the prerequisites in
[SECURITY.md](./SECURITY.md#before-any-real-applicant-data).

## What runs

Three processes and a database:

| Process | Command | Port | Health |
| --- | --- | --- | --- |
| Application | `pnpm start` | 3000 | `GET /api/health`, `GET /api/ready` |
| Worker | `pnpm worker` | 3001 | `GET /health` |
| PostgreSQL 16 | — | 5432 | `pg_isready` |
| Mailpit (dev only) | — | 1025 / 8025 | — |

`/api/health` is liveness: the process is up. `/api/ready` is readiness: it
reports the applied migration count and the worker's last heartbeat. Point a
load balancer at `/api/health` and a deployment gate at `/api/ready`.

The worker is **not optional**. Without it, scheduled sends, appointment
reminders, brief preparation, scripted text intake, outbox publication and
reconciliation do not run. The workspace says so in the mode strip rather than
appearing to work.

## Containers

`Dockerfile` is a multi-stage build ending in a `runtime` stage that runs as a
**non-root user** and serves the Next.js standalone output.
`docker-compose.yml` wires the application, worker, PostgreSQL and Mailpit
together for local use.

> **Not verified here.** The environment this was built in has no Docker
> daemon, so the Dockerfile has never been built and the compose file has never
> been run. The commands are written from the same standalone layout that
> `pnpm start` assembles and exercises locally. Treat the first container build
> as untested. See [BUILD_STATUS.md](./BUILD_STATUS.md).

The compose file is for **development and demonstration**: plain HTTP, a fixed
local password and a committed auth secret, none of which belong in a real
deployment.

## Configuration

Copy `.env.example`, which documents every variable and contains no secrets.
Then run:

```bash
pnpm config:check
```

It validates the configuration, refuses unsafe combinations (`APP_MODE=LIVE`
with `DEMO_TOOLS_ENABLED=true`, an auth secret that still looks like the
example, provider credentials that are half-configured, unfinished migrations)
and prints the split between what the application controls and what hosting
controls. Run it in your deployment pipeline.

### Behind a proxy

- `PUBLIC_APP_URL` and `BETTER_AUTH_URL` must be the **externally reachable**
  origin, not the internal one. Cookies, callback URLs and webhook signature
  verification all depend on it.
- `TWILIO_WEBHOOK_BASE_URL` must be **exactly what you typed into the Twilio
  console**. If your proxy rewrites the path, signature validation fails — and
  it should, because the signature covers the URL.
- `TRUST_PROXY_HEADERS=true` only when the proxy in front of this is one you
  control and it sets `X-Forwarded-*`. Trusting those headers from an
  untrusted source lets a client spoof its own address.
- `TRUSTED_ORIGINS` adds origins to the CSRF/origin check for state-changing
  requests.

## Migration and deployment ordering

Migrations are committed SQL in `prisma/migrations`, applied with
`prisma migrate deploy`. They are written to be **backward compatible with the
currently running version**, which is what makes this ordering safe:

1. **Apply migrations** against the live database.
2. **Deploy the worker.**
3. **Deploy the application.**

Migrations first, because the new code expects the new schema. The worker
before the application, so a job enqueued by new application code always has a
handler. Both old and new application code must tolerate the new schema during
the window where both are running.

Verify before deploying:

```bash
pnpm db:check      # the committed migrations still reproduce schema.prisma
pnpm db:status     # what the target database has applied
```

`pnpm db:check` creates and drops a throwaway shadow database
(`SHADOW_DATABASE_URL`). Never point it at anything you care about.

### Writing a migration that is safe to deploy

- Add columns as nullable, or with a default. Backfill in the same migration.
- Do not drop or rename a column the currently deployed code still reads. Ship
  the code that stops reading it first, then drop it in a later release.
- Add constraints only after the data satisfies them; the migration should
  backfill and then constrain, in that order.
- Creating an index on a large table locks it. Use `CONCURRENTLY` outside a
  transaction when that matters.

`prisma migrate dev` is interactive and is for development only. Production
uses `migrate deploy`, which never prompts and never resets.

**Production must not automatically seed demo accounts or reset databases.**
The seed refuses to run unless `APP_MODE=DEMO`, and the reset is a deliberate
terminal command with no one-click equivalent in the browser.

## Backup and restore

The application does not back anything up. That is an operations
responsibility, and an untested backup is not a backup.

A workable baseline:

- Nightly `pg_dump` plus continuous WAL archiving, both encrypted at rest.
- Retention long enough to cover the longest plausible gap between a problem
  happening and somebody noticing.
- **A restore rehearsal on a schedule**, not a restore procedure in a
  document.

### Restoration smoke test

After restoring into a scratch database, point a non-production application at
it and check:

```bash
pnpm db:status                      # every migration present, none pending
curl -fsS $APP/api/ready            # migration count and worker heartbeat
```

Then, in the workspace:

1. Sign in. Sessions survive a restore; if sign-in fails, the auth tables did
   not come back.
2. Open Today. The queue is derived from tasks, flags, messages and calls — if
   it renders with the expected cases, those all restored.
3. Open a case file and click a brief citation. That proves briefs, brief
   items, source references and the underlying messages restored **and still
   reference each other**.
4. Open `/operations`. Check the outbox is not full of rows that should have
   been published before the backup was taken.

If a restore silently loses the outbox, jobs that were queued at backup time
never run. Reconcile pending sends before letting the worker loose on a
restored database.

## Rollback

**What rolls back cleanly:** the application and the worker. Deploy the
previous image. Both are stateless.

**What does not:** migrations. `prisma migrate` has no down-migrations here,
on purpose — a generated rollback that has never been run is a liability, not
a safety net. To reverse a schema change, write a new forward migration that
undoes it and deploy it the same way.

**What cannot be rolled back at all:** anything that left the building. A sent
text message, a delivered email, a webhook that reached its destination. The
state machine and the audit trail record what happened; nothing un-sends it.

This is why the ordering above puts migrations first and keeps them backward
compatible: rolling the application back to the previous version has to work
against the new schema, because the schema is the part that is stuck.

## Operating it

- `/operations` (org admin) shows failed jobs, dead-lettered outbox rows,
  blocked sends and the worker heartbeat, with **redacted** diagnostics.
- `pnpm bootstrap:org` creates the first live organization and administrator,
  interactively, once. It reads the password with terminal echo off, stores
  only a hash, and refuses to run a second time. **No default live credential
  ships in this repository.**
- Scale the application horizontally. Note that the rate limiter is
  in-process, so the effective limit multiplies by instance count — see
  [SECURITY.md](./SECURITY.md#secrets).
- The worker can run more than one instance: pg-boss handles the locking, and
  the handlers are idempotent. `WORKER_CONCURRENCY` controls per-instance
  parallelism.

## CI

`.github/workflows/recruiter-os.yml` runs, against a real PostgreSQL service:
typecheck → lint → migrate → migration check → unit and integration tests →
production build → seed → configuration check → browser tests, uploading the
Playwright report and screenshots as artifacts.
