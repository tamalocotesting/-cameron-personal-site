# Security and privacy

This document is deliberately split: controls **this application
implements**, controls **hosting and operations must supply**, and
prerequisites that remain **unresolved organizational decisions**. Conflating
those three is how software ends up claiming compliance it does not have.

There are **no compliance badges in this product**. It is not DoD approved,
not FedRAMP authorized, not HIPAA compliant, and it holds no Authority to
Operate. It is not approved for real applicant data.

---

## Implemented in the application

### Authorization and validation

- One server-side policy layer for every read and write
  (`src/server/authz/policy.ts`). See [PERMISSIONS.md](./PERMISSIONS.md).
- Zod validation at every server boundary — actions, route handlers, webhooks,
  job payloads — with `z.prettifyError` for field-level messages.
- Submitted organization ids, role names, owner ids and applicant ids are
  never trusted. Scope comes from the session-backed membership and the row.
- Unauthorized reads are reported as "not found", so existence does not leak.

### Sessions and requests

- Better Auth sessions in `httpOnly`, `sameSite`, `secure`-in-production
  cookies. No public staff sign-up. TOTP MFA available.
- Origin checking for every state-changing request in `src/middleware.ts`,
  before any server action runs, plus Better Auth's own CSRF checks.
- Security headers on every response (`next.config.ts`): CSP with
  `frame-ancestors 'none'`, `object-src 'none'`, `form-action 'self'` and no
  external script, font or connect origins; `X-Frame-Options: DENY`;
  `nosniff`; `Referrer-Policy: strict-origin-when-cross-origin`;
  a `Permissions-Policy` that turns off camera, microphone and geolocation;
  `poweredByHeader: false`.
- Request and body size limits on webhook and action endpoints.
- Rate limits on sign-in, password reset, intake start, intake answers,
  resume and additional verification, with uniform responses so accounts
  cannot be enumerated.
- Parameterized database access throughout. The few raw SQL queries (the queue
  ranking, the report aggregates) use Prisma's tagged-template parameter
  binding; no string concatenation of user input.

> **Known limitation.** The rate limiter (`src/server/rate-limit.ts`) is
> in-process. Behind more than one application instance the effective limit is
> (limit × instances). That is adequate for the abuse it guards, but it is not
> a distributed limiter. The counters that must survive a restart — resume
> verification attempts — are in the database instead.

### Secrets

- Provider credentials are read from the environment (or whatever your secret
  manager injects) **on the server only**. They are never sent to a settings
  page, never returned by an API, and never written to a log. The integrations
  page shows *which variables are missing* by name, and nothing else.
- `src/lib/redact.ts` masks contact values and strips known secret shapes from
  error text before it reaches a log line, a job record or the operations view.
- `pnpm config:check` refuses a configuration whose auth secret still looks
  like the example value.

### Applicant data handling

- No applicant data in analytics tools, URLs, `localStorage`, client error
  telemetry or console logs.
- **No third-party session-replay or analytics of any kind.** The CSP would
  block it even if something were added.
- Job payloads carry scoped identifiers, not transcripts. Handlers load what
  they need under the policy layer.
- No shared or public caching of private case data — workspace pages are
  `force-dynamic` and served per session.
- SMS suppression lives with the **phone number**, not the case. Somebody can
  text STOP before they have a case, from a number on three cases, or from one
  never seen before; all of those stick, and every send checks the number's own
  suppression record first.
- The automated reply to an unanswered call is off by default, limited to one
  message inside a configured window, and sent only on a consent basis created
  by the call itself. Continuing by text requires an explicit yes, recorded
  separately. See [INTEGRATIONS.md](./INTEGRATIONS.md#text-back-after-an-unanswered-call).
- The resume credential is high-entropy, stored **only as a hash**, expiring,
  revocable, exchanged once for a limited session, and removed from the
  navigable URL after exchange. Stored intake is never retrievable by a phone
  or email lookup.
- Sensitive original free text is stored with restricted access
  (`SENSITIVE_SOURCE` grant) and is **excluded from external AI by default**.
  The documented boundary is in [ARCHITECTURE.md](./ARCHITECTURE.md#intake).

### Audit

Two logs, and the distinction is real:

- **Operational activity** — what happened on a case. Visible to authorized
  staff on the case's Activity view.
- **Security audit** — sensitive reads, exports, grants, settings changes and
  mutations, with actor, subject, timestamp and basis. Administrators see it at
  `/settings/audit`.

Audit metadata records *that* something was read or exported and under what
basis. It does **not** copy full sensitive payloads into broadly accessible
metadata.

> Append-only *through the application* is not tamper-proof. Anyone with
> direct database or backup access can alter these tables. Real tamper
> evidence needs shipping to an append-only store outside this database, which
> is an operations decision and is **not** implemented here.

### Retention

`src/server/services/retention.ts` and `/settings/retention`:

- A policy must be **created, approved and enabled** before anything is
  deleted. There is **no universal destructive default for live
  organizations**.
- `preview` is a dry run: it reports exactly what would be affected, including
  how many cases are protected by a legal hold.
- Execution requires the `RETENTION_ADMIN` grant and writes an audit record.
- Scope includes derived material: briefs and their items, source references,
  jobs, export records and stored provider payloads — not just the case row.
- A legal hold protects a case from every policy.
- Minimal permitted audit metadata survives a deletion, without retaining the
  deleted content inside it.

> A database delete does not erase every copy. Backups, replicas, WAL archives
> and a provider's own retention outlive it. Those expiries are an operations
> responsibility; see [DEPLOYMENT.md](./DEPLOYMENT.md).

---

## Supplied by hosting and operations — not by this code

`pnpm config:check` prints this list every time it runs, so it cannot be
quietly forgotten.

- [ ] TLS termination, HSTS, and certificate management
- [ ] Database encryption at rest
- [ ] A backup schedule **and a tested restore**
- [ ] Secret storage and rotation in a real secret manager
- [ ] Network restrictions in front of the application and the database
- [ ] Log retention, log access control, and periodic access review
- [ ] A signed data-handling agreement with every provider you enable
- [ ] Incident response: who is called, how an affected person is notified, on
      what timeline, and who decides
- [ ] Trusted-proxy configuration (`TRUST_PROXY_HEADERS`) verified against the
      proxy you actually run

---

## Before any real applicant data

Honestly stated, because the alternative is pretending:

1. **Organizational authorization to collect the data at all**, from whoever
   owns that decision in your organization. The application can record that an
   organization approved a question set. That recording creates no official
   authorization of any kind, and the settings page says so.
2. **A reviewed youth/age policy.** `minimumIntakeAge` and `youthPolicyNote`
   are deliberately unset by default. The code does not invent a universal
   rule, because there isn't one.
3. **A decision on citizenship questions**, which are disabled by default.
4. **A decision on whether to text people who call you**, which is what
   `textBackEnabled` turns on. It is off by default, and the reply window and
   question cap are yours to set. This is a legal question in most
   jurisdictions, and the application deliberately does not decide it for you.
5. **A privacy notice and consent disclosure text** reviewed by whoever is
   accountable for it. Consent is captured per channel and purpose with the
   exact disclosure version, timestamp, source and revocation history — but the
   *wording* is yours to approve.
6. **Provider data-handling review** for any provider you enable. Application
   code cannot guarantee a provider's retention or training policies, and this
   product does not claim it can.
7. **A retention policy someone has approved**, per the section above.
8. **An accessibility and content review** of the applicant-facing text by
   someone who owns that responsibility.

### Unresolved by design

- Tamper-evident audit storage outside this database.
- A distributed rate limiter.
- Any claim about official recruiting-system integration. There is no AFRISS
  or other government API here, fabricated or otherwise, and nothing scrapes
  or bypasses approved access. The handoff is a **manual, reviewed export**.

---

## Reporting a problem

This is a demonstration build with no security contact and no disclosure
process. Do not deploy it against real applicant data, and do not treat
anything in it as a substitute for your organization's own review.
