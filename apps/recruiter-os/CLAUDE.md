# Working in this repository

RecruiterOS is a daily operating workspace for military recruiters. The
governing rule is **"AI prepares. Recruiter decides."** It is stated in the
product and enforced in the code, and most of the conventions below exist to
keep it true.

Read [ARCHITECTURE.md](./ARCHITECTURE.md) before changing anything structural.

## Layout

```
src/app/          routes — (workspace), (auth), public intake, api
src/server/       everything that touches data
  authz/          the one policy layer + error types
  services/       domain logic. This is where behaviour lives.
  domain/         state machines and the job catalogue
  providers/      sms, voice, ai, webhook — interface + simulator + real
  actions/        server actions: validate, authorize, call a service
src/components/   ui/ primitives, app/ workspace composites
src/lib/          pure helpers. No database, no server-only imports.
worker/           the durable worker and its handlers
prisma/           schema, committed migrations, seed
tests/            unit, integration (real PostgreSQL), e2e (real browser)
```

## Rules that are not negotiable

These are not style preferences. Breaking one produces a product that lies to
a recruiter.

**Authorize on the server, every time.** Everything goes through
`src/server/authz/policy.ts`. Hiding a nav item is not authorization. Never
trust a submitted organization id, role, owner id or applicant id.

**Never widen what a role grants.** Org admin does not read conversation
content by role. Manager does not read conversation content by role. Both need
an explicit, audited grant.

**One clock.** `now()` from `src/server/clock.ts`. Nothing calls `new Date()`.
Stamp row timestamps from it rather than relying on database defaults, or a
pinned `DEMO_CLOCK` produces an incoherent dataset.

**Distinguish the four things messaging conflates.** Authorship, approval,
transport state and human contact are separate fields and separate questions.
Drafting is not sending. Provider acceptance is not delivery. Delivery is not a
conversation. A bot exchange is never human contact.

**An ambiguous external outcome is `OUTCOME_UNKNOWN`.** Never `FAILED`, never
retried. Reconcile it. The alternative is texting somebody twice.

**Consent is per channel, per purpose, per contact value**, with the exact
disclosure version, a timestamp, a source and full revocation history. A
submitted phone number is not consent. A missed call is not consent. Suppression
lives with the **number**, is durable, and a recruiter cannot override it.

**A brief item that states a fact must cite a real source** in the same case
whose excerpt actually appears in the referenced row. Validate server-side.
Reject invented citations rather than displaying them. Never overwrite a
recruiter's correction with a later generation.

**Never state a conclusion about a person.** No eligibility, no scores, no
rankings, no predicted suitability, no inference about citizenship, health or
protected characteristics. A review flag names a routing bucket, never a
judgement. "Closed" is an operational state with a reason.

**Say what is true about status.** "Healthy" requires an actual check. An
adapter existing is not an integration being live. If a check has not run, the
UI says so.

**Every visible control works, or explains what is blocking it.** No decorative
buttons, no toggles that do nothing.

## Conventions

- **Zod at every server boundary.** Actions, route handlers, webhooks, job
  payloads.
- **Services own domain logic.** A React component renders what a service
  returned. Server actions validate, resolve the actor, authorize, then call a
  service.
- **Transactions cover the whole change.** Business rows, the audit event and
  the outbox record commit together or not at all.
- **Jobs carry scoped identifiers**, never transcripts or rendered bodies, and
  they re-read current state when they run. Consent, ownership and appointment
  state all change between enqueue and execution.
- **Invariants that matter go in the database.** Constraints, exclusion
  constraints, partial unique indexes. A TypeScript type is not a constraint.
- **Migrations are hand-written SQL, committed, forward-only.** `pnpm db:check`
  proves they still reproduce `schema.prisma`. `prisma migrate dev` is
  interactive and development-only.
- **Tenant scope is structural.** `organizationId` on every business row;
  child rows reference parents through compound keys that include it.
- **Comments explain why.** The reader can see what the code does. Write down
  the thing that will not be obvious in six months — usually the failure mode
  the code is avoiding.

## Prisma 7 specifics

- **No `url` in the schema datasource.** Connection config lives in
  `prisma.config.ts`; the runtime client uses `PrismaPg` from
  `@prisma/adapter-pg` in `src/server/db.ts`, which is the only place allowed
  to construct a client.
- Prisma `DateTime` maps to `timestamp without time zone`. That is why the
  appointment exclusion constraint uses `tsrange`, not `tstzrange` — the
  `tstzrange` cast is only STABLE, and an index expression must be IMMUTABLE.

## Tests

- `tests/unit` — pure logic. Fast.
- `tests/integration` — **real PostgreSQL**, migrations applied, truncated per
  test, clock pinned. Exercise the real service. Never assert that a mock was
  called.
- `tests/e2e` — the built application, the real worker, the seeded dataset, at
  1440px and 375px, with axe-core.

Write the test that would have caught the bug. Several of the bugs found
during this build — a dispatch re-gating on a purpose it was never approved
for, an opt-out that vanished when the number had no case, a question looked
up across the wrong intake pathway — were found by integration tests and would
not have been found by unit tests with mocks.

**Fix failures. Never weaken an assertion to make one pass.**

## Before you say it is done

```bash
pnpm check        # typecheck, lint, test, db:check, build
pnpm test:e2e     # needs the app and worker running
```

Then update [BUILD_STATUS.md](./BUILD_STATUS.md) with **which checks you
actually ran and what they returned**. Never record a pass for something that
was not executed, and never describe an integration as live because an adapter
exists.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
