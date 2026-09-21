# Build status

What is actually built, what was actually run, and what is not true yet.

Last verified: **2026-09-21**, against Node 22, pnpm 10.33.0 and PostgreSQL 16
on the machine this was built on.

---

## Checks that ran, and what they returned

Every line below was executed. None is a projection.

| Check | Command | Result |
| --- | --- | --- |
| Type checking | `pnpm typecheck` | **Pass** — no errors |
| Linting | `pnpm lint` | **Pass** — no errors, no warnings |
| Migration/schema agreement | `pnpm db:check` | **Pass** — "No difference detected" |
| Unit + integration tests | `pnpm test` | **Pass** — 17 files, **234 tests**, 0 failures |
| Production build | `pnpm build` | **Pass** — compiled, 40 routes |
| Configuration validator | `pnpm config:check` | **Pass** — 0 errors, 0 warnings |
| Browser tests | `pnpm test:e2e` | **Pass** — **41 tests** across desktop (1440px) and mobile (375px), 0 failures |
| Accessibility | axe-core inside the browser tests | **Clean** — 0 serious/critical WCAG 2.0/2.1 A/AA violations on 6 pages × 2 widths |
| Horizontal overflow | asserted in the browser tests | **Clean** at 375px |

The integration tests run against **real PostgreSQL** with the committed
migrations applied and the tables truncated between tests. They exercise the
actual services and persistence; none of them asserts that a mock was called.

The browser tests run against the built application, the real worker and the
seeded dataset. Nothing is intercepted or stubbed.

---

## Implemented and locally tested

Built, and covered by tests that were run:

- **Authorization** — one server-side policy layer for pages, queries,
  mutations, exports, `.ics`, brief citations, reports and worker jobs.
  Recruiter / manager / org-admin floors, grants, expiring coverage,
  revocation, tenant isolation through compound foreign keys, and the rule
  that an unauthorized case is indistinguishable from a missing one.
- **Authentication** — invitation-only staff access, login, logout, password
  reset, session expiry and revocation, TOTP MFA, rate-limited sign-in, and a
  one-time interactive bootstrap for the first live organization.
- **Today's Priority Queue** — deterministic six-category ordering derived
  only from workflow events, explained in words on every row, ranked and
  paginated in SQL. No applicant-quality score exists anywhere in the schema.
- **Case file** — source-linked brief above the transcript, six views, manual
  records, notes with immutable revisions, call outcomes, follow-ups, coverage,
  review-flag resolution, message preparation, scheduling, duplicate detection.
- **Intake** — scripted, versioned, mobile-first, two pathways, human request
  available throughout, sensitive-topic handoff, secure pause/resume with
  hashed expiring revocable credentials, additional verification on a new
  device, consent per channel/purpose/value with disclosure versions.
- **Text-back intake** — an unanswered call answered with one automated
  message, then the same published question set asked over SMS, one question
  per message, with its own consent basis, its own stopping rules and a brief
  waiting in the morning. Off by default. Covered by 19 integration tests and
  a browser test that drives the demo console, the worker and the queue.
- **Messaging** — provider-neutral SMS and voice, draft → approve → queue →
  dispatch as separate states, the full transport state machine, out-of-order
  delivery resolution, `OUTCOME_UNKNOWN` plus reconciliation instead of blind
  retry, durable number-level opt-out, quiet hours, unknown-timezone policy,
  approved-template automation.
- **Briefs** — deterministic local adapter, schema-validated structured
  output, every factual item verified against a real same-case source with a
  matching excerpt, recruiter corrections never overwritten, staleness,
  review actions instead of invented accuracy scores.
- **Follow-ups and appointments** — tasks with original promised dates, snooze
  with reason and audit, DST-correct scheduling, transactional no-double-booking
  via a PostgreSQL exclusion constraint, outcome required before completion,
  reminder cancellation, `.ics` download.
- **Team and reporting** — invitations, teams, reassignment, expiring
  coverage, absences, fallback owner; event-derived reports with visible
  definitions, denominators and exclusions, "Not measured" where there is no
  baseline, CSV export with formula-injection protection and an audit entry.
- **Durable processing** — transactional outbox, idempotent publication and
  consumption, bounded retries, dead-letter visibility, worker heartbeat, and
  an operations view with redacted diagnostics.
- **Retention** — approved-policy-only deletion, dry-run preview, legal hold,
  derived material included, minimal audit metadata retained.
- **Honest modes** — `APP_MODE` independent of `NODE_ENV`; DEMO hard-blocks
  outbound messaging and external AI even when credentials are present; LIVE
  with demo tools enabled refuses to start.

---

## Implemented but not live-tested

The code is real. The verification is not, and no part of the product claims
it is.

| Thing | Why not |
| --- | --- |
| **Twilio SMS adapter** | Sending a message needs an authorized account. Doing it unprompted would spend money and text a real phone. The adapter is written against the official SDK, including the ambiguous-outcome handling — but **no message has been sent through it**. |
| **Twilio Voice adapter** | Same. The forwarded-leg logic is the part most likely to be wrong in the wild, and it has only been exercised against the simulator and the webhook tests. |
| **Twilio webhook signatures** | Verified in tests using the official SDK's own signing helper, against both form and JSON bodies and against a deliberately wrong URL. **Not verified against a request Twilio actually sent.** |
| **Anthropic brief adapter** | Written against the SDK's structured-output support with independent zod validation. **No request has been made.** The model is read from configuration, so there is no hardcoded identifier to be stale. |
| **Outbound handoff webhook** | Signing, allowlisting, idempotency and SSRF protection are implemented. **No request has been delivered to a real destination.** |
| **SMTP** | Exercised against Mailpit locally. **Not tested against a real mail provider.** |
| **Docker image and compose stack** | There is **no Docker daemon in the environment this was built in**, so `Dockerfile` and `docker-compose.yml` have never been built or run. They are written from the same standalone layout `pnpm start` assembles and exercises. Treat the first build as untested. |
| **CI workflow** | `.github/workflows/recruiter-os.yml` runs the same commands that pass locally, but **it has never executed on a runner**. |
| **Backup and restore** | The procedure and smoke test in DEPLOYMENT.md are written. **No restore has been performed.** |

---

## Blocked by external configuration or approval

Not missing — waiting on something that is not code:

- **Any real messaging**, which needs an authorized Twilio account, a number,
  and a decision to spend money on a test.
- **External AI brief preparation**, which needs an API key, an
  organization-level enablement, an approved-category decision and a
  data-handling agreement.
- **Handoff delivery to a business system**, which needs a destination that
  exists, an allowlist entry and a signing secret.
- **Collecting anything from a real applicant**, which needs the
  organizational approvals listed in
  [SECURITY.md](./SECURITY.md#before-any-real-applicant-data): authority to
  collect, a reviewed youth/age policy, a decision on citizenship questions, a
  decision on whether to text people who call you, approved disclosure text, a
  provider data-handling review, an approved retention policy and a content
  review.

---

## Deliberately outside v1

Decided against, not forgotten:

- **Down-migrations.** A generated rollback that has never been run is a
  liability. Reversing a schema change means a new forward migration.
- **A distributed rate limiter.** The in-process one is adequate for what it
  guards and its limitation is documented rather than hidden.
- **Tamper-evident audit storage.** Append-only through the application is not
  tamper-proof against database administrators, and pretending otherwise would
  be worse than saying so.
- **External calendar synchronization.** There is an `.ics` download, which
  works. Google and Microsoft sync are not implemented and are not advertised.
- **Call recording, transcription, or a voice agent.** Out of scope, by
  instruction and by judgement.
- **Stripe, checkout, or a marketing site.** The commercial metadata is an
  admin-only editable hypothesis. The $3,000 setup / $1,000 monthly /
  five-recruiter model is **not established pricing**, and individual
  recruiters do not need to buy anything.
- **An eligibility engine, rankings, seriousness scores, or predicted
  suitability.** Not an omission. The product exists partly to not do this.

---

## Known limitations

- The rate limiter is in-process; behind N application instances the effective
  limit is N × the configured limit.
- Brief quality on the local adapter is deliberately conservative: it states
  what it can cite and marks everything else unknown. That is the point, but
  it reads as thin next to what a model would produce.
- The scripted SMS intake refuses ambiguous answers rather than interpreting
  them, which occasionally means asking a question twice.
- Duplicate detection surfaces candidates; it never merges on its own, and a
  shared phone number is explicitly not treated as proof of identity.
- Demo reports are labelled fictional, and the savings report shows
  "Not measured" unless a real baseline and observation have been entered.

---

## What this is not

Repeated here because it is the most important line in the document:

**This is not government-authorized, certified, or approved for real applicant
data.** It holds no Authority to Operate, no FedRAMP authorization, no DoD
approval and no HIPAA compliance, and it makes no such claim anywhere in the
product. There is no AFRISS or other government-system integration, fabricated
or otherwise.
