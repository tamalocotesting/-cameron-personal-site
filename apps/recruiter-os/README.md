# RecruiterOS

**Turn scattered applicant conversations into recruiter-ready case files.**

A daily operating workspace for military recruiters, and the respectful intake
experience that feeds it. The governing rule, stated in the product and
enforced in the code: **AI prepares. Recruiter decides.**

---

## What this is not

Being explicit about this is part of the product:

- It is **not an eligibility engine**. It never tells anyone whether they
  qualify, and it never infers citizenship, health, protected characteristics
  or suitability.
- It is **not an autonomous recruiting agent**. Nothing reaches an applicant
  without a named human approving that exact text.
- It is **not a generic sales CRM**, and it does not score, rank or rate
  applicants. There is no "lead quality" number anywhere in the schema.
- It is **not a replacement for an official recruiting system**, and it is
  **not government-authorized, certified, or approved for real applicant
  data**. See [SECURITY.md](./SECURITY.md) for the prerequisites that would
  have to be met first, and what remains an organizational decision.
- It does not ask for SSNs, dates of birth, government identifiers, documents,
  medical histories or detailed legal histories. See
  [ARCHITECTURE.md](./ARCHITECTURE.md#intake).

---

## Run it locally

Two paths. Both end at <http://localhost:3000>.

### With Docker Compose

```bash
cp .env.example .env          # the compose file supplies its own values
docker compose up --build
```

Brings up PostgreSQL, Mailpit, the application and the worker, applies the
migrations and seeds the fictional demo workspace. Mail is captured at
<http://localhost:8025>; nothing leaves the machine.

> This compose file has **never been executed in the environment this was
> built in** — there is no Docker daemon available there. It is written but
> unverified. See [BUILD_STATUS.md](./BUILD_STATUS.md).

### Without containers

Needs Node 22 (see `.nvmrc`), pnpm 10 and a PostgreSQL 16 you can reach.

```bash
pnpm install
pnpm setup                    # .env, prisma generate, migrate deploy, seed
pnpm dev                      # terminal 1 — the application
pnpm dev:worker               # terminal 2 — the durable worker
```

`pnpm setup` creates `.env` from `.env.example` if it is missing. It leaves an
existing `.env` alone.

Without the worker, scheduled sends, reminders, brief preparation and outbox
publication do not run — and the workspace **says so** in the mode strip
rather than appearing to work.

---

## The fictional demo

The seed refuses to run unless `APP_MODE=DEMO`. It builds two organizations so
tenant isolation can actually be tested, and 15 fictional cases in
`America/Chicago` covering every state the workspace has to handle.

Sign in at <http://localhost:3000/login>. The password for every demo account
is `demo-password-not-for-live-use`.

| Account | Role | Why it exists |
| --- | --- | --- |
| `austin.reyes@central.invalid` | Recruiter | The primary demonstration recruiter |
| `marcus.hale@central.invalid` | Recruiter | Away this week, so coverage applies |
| `dana.whitfield@central.invalid` | Manager | Team metadata, **no** conversation content |
| `priya.nandi@central.invalid` | Org admin | Settings and integrations, **no** case content |
| `jordan.kim@northside.invalid` | Recruiter | The other organization, for isolation |

Useful demo entry points:

- `/today` — the priority queue beside the case file. Start here.
- `/intake/central-demo` — the public applicant intake, as an applicant sees it.
- `/demo-console` — simulate inbound SMS, a missed call, a delivery status, an
  opt-out or an opt-in, from an existing contact **or a number nobody has used
  before**. These run through **the real domain handlers**, not a parallel fake
  path.
- `pnpm seed` — idempotent; re-running rebuilds only the demo dataset.

### The call nobody answered

The path the product exists for. Somebody rings while the recruiter is busy;
by the morning the case is waiting with the answers on it.

1. Open `/demo-console`, type a phone number **nobody has contacted from
   before**, and place an inbound call with the forwarded leg set to
   `no-answer`.
2. A case appears with a callback task — and one automated text goes back to
   that number saying we could not pick up, offering to take a few details.
3. Deliver an inbound text saying `GO` from the same number. The script asks
   the first question of the organization's published intake set.
4. Keep answering, one message at a time. Try `CALL` or a medical question
   part-way through: the script stops immediately, pauses automation on the
   case and creates the recruiter's work without answering anything.
5. Open `/today`. The case is no longer a masked phone number — it is a person,
   with their answers, a brief, and the callback still outstanding.

This is off by default. In the demo organization it is on so the path can be
walked; Settings → Organization has the switch, the reply window and the
question cap. See [INTEGRATIONS.md](./INTEGRATIONS.md#text-back-after-an-unanswered-call).

### A demonstration path that exercises the whole system

1. Open `/demo-console` and simulate a **missed call** from a new number. A
   case and a callback task appear in the queue with the reason
   "Callback requested".
2. Open the case from `/today`, send the consented **intake invitation**, and
   note that the message is a draft until it is approved.
3. Open `/intake/central-demo` in another tab, walk the callback path, and use
   **Save and finish later** — then follow the resume link the seed printed (or
   the one the intake shows) to continue on the other device.
4. Back in the workspace, the case now carries a **brief** whose every factual
   line links to the exact message or intake answer it came from. Click a
   citation; the source page highlights the quoted span.
5. **Prepare** a reply, **approve** it, then **send** it — three separate
   steps, with three separate states on the transcript.
6. Simulate a **delivery status** and an inbound **reply** from the console.
7. **Record a call** outcome (voicemail, no answer, spoke) — a clicked phone
   link never counts as a connected call.
8. **Schedule** an appointment, **confirm** it, then **record its outcome**;
   completion requires the outcome, transactionally.
9. Complete the follow-up, then open `/reports` — every number there is
   derived from the events the steps above actually wrote.

### Resetting the demo

`/demo-console` has a reset, and `pnpm seed:reset` does the same from the
terminal. Both are limited to the demo dataset. The seed refuses to run at all
unless `APP_MODE=DEMO`; the console and its reset additionally require
`DEMO_TOOLS_ENABLED=true`. Setting `APP_MODE=LIVE` with
`DEMO_TOOLS_ENABLED=true` makes the application refuse to start.

---

## Operating modes

`APP_MODE` is explicit and independent of `NODE_ENV`.

| | `DEMO` | `LIVE` |
| --- | --- | --- |
| Data | Isolated fictional organizations | Real organizations |
| Brief preparation | Deterministic local rules adapter | Configured, organization-enabled provider |
| SMS / voice | Local simulator | Configured, organization-enabled provider |
| Email | Captured locally (Mailpit) | Configured SMTP |
| Outbound messaging | **Hard-blocked**, even if credentials exist | Only after enablement and verification |
| Demo shortcuts | Available when `DEMO_TOOLS_ENABLED=true` | Refuses to start |

Integration status is one of **Disabled**, **Demo**, **Configured but
unverified**, **Healthy** or **Error**. "Healthy" is only ever shown after an
actual relevant check has run and passed; a present credential earns
"Configured but unverified" and nothing more.

---

## Commands

Every command below exists and does what it says.

| Command | What it does |
| --- | --- |
| `pnpm setup` | `.env`, `prisma generate`, `migrate deploy`, seed |
| `pnpm dev` | The application in development on :3000 |
| `pnpm dev:worker` | The durable worker, watched |
| `pnpm build` | `prisma generate` then a production Next build |
| `pnpm start` | Serves the standalone production build |
| `pnpm worker` | The durable worker |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm lint` | ESLint over the whole project |
| `pnpm test` | Vitest — unit and **real-PostgreSQL** integration tests |
| `pnpm test:watch` | The same suite, watched |
| `pnpm test:e2e` | Playwright, desktop and 375px, with axe checks |
| `pnpm test:e2e:install` | Installs the Chromium the browser suite needs |
| `pnpm check` | typecheck → lint → test → db:check → build |
| `pnpm db:migrate` | `prisma migrate deploy` |
| `pnpm db:migrate:dev` | `prisma migrate dev` (interactive, development only) |
| `pnpm db:status` | `prisma migrate status` |
| `pnpm db:check` | Replays the committed migrations and proves they still produce `schema.prisma` |
| `pnpm db:reset` | Drops and re-migrates — **development only** |
| `pnpm seed` | Idempotent fictional demo dataset (`APP_MODE=DEMO` only) |
| `pnpm seed:reset` | Rebuilds the demo dataset from scratch |
| `pnpm bootstrap:org` | One-time interactive creation of the first live organization and administrator |
| `pnpm config:check` | Validates a configuration and prints the security checklist split by who owns each control |

Health endpoints: `GET /api/health` (liveness), `GET /api/ready`
(migrations + worker heartbeat), and the worker's own `GET :3001/health`.

---

## Documentation

| File | What is in it |
| --- | --- |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Layers, the ER diagram, every state machine, the queue ordering rule, the outbox |
| [PERMISSIONS.md](./PERMISSIONS.md) | The permission matrix, grants, coverage, and how each is enforced |
| [SECURITY.md](./SECURITY.md) | Controls the app implements, controls hosting owns, retention, and the honest prerequisite list |
| [INTEGRATIONS.md](./INTEGRATIONS.md) | Twilio, Anthropic, SMTP, outbound webhooks — what is implemented and what is unverified |
| [DEPLOYMENT.md](./DEPLOYMENT.md) | Migration ordering, backup/restore, rollback boundaries, proxy configuration |
| [BUILD_STATUS.md](./BUILD_STATUS.md) | What is implemented and tested, what is not, and exactly which checks ran |
| [CLAUDE.md](./CLAUDE.md) | Conventions for anyone (or anything) changing this code |
