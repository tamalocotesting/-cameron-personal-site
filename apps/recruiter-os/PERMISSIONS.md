# Permissions

One policy layer, enforced on the server, for pages, queries, mutations,
exports, `.ics` downloads, brief citations, reports and worker jobs:
`src/server/authz/policy.ts`.

**Hiding navigation is not authorization.** Every route in this application
can be typed into the address bar; the browser suite does exactly that and
asserts the refusal. `tests/integration/authorization.test.ts` asserts the same
thing at the service layer.

---

## Staff access is invitation-only

There is no public staff sign-up (`disableSignUp: true` in the Better Auth
configuration) and no shared password. What exists:

- Invitation → acceptance → password set, with the email captured locally by
  Mailpit in development.
- Login, logout, password reset, session expiry, session revocation, and MFA
  (TOTP) through Better Auth's `twoFactor` plugin.
- `pnpm bootstrap:org` — a one-time interactive CLI that creates the first
  live organization and its administrator. It prompts for everything, reads
  the password with terminal echo off, stores only a hash, and refuses to run
  a second time. **No default live credential ships in this repository.**

The demo accounts exist only in the seeded demo organizations, only when
`APP_MODE=DEMO`, and the seed refuses to run in any other mode. The demo
sign-in shortcut additionally requires `DEMO_TOOLS_ENABLED=true`, and
`APP_MODE=LIVE` with that flag set makes the application refuse to start.
Choosing a demo role creates a properly authorized session for that member —
it is not a client-side role variable.

---

## Roles

A role is a floor, not a ceiling. Everything above it is an explicit,
revocable, audited grant.

| | Recruiter | Manager | Org admin |
| --- | --- | --- | --- |
| Cases they own — metadata, content, actions | ✅ | ✅ (if they own any) | ✅ (if they own any) |
| Cases under an active coverage grant | ✅ | ✅ | ✅ |
| Operational metadata for their teams' cases | — | ✅ **by role** | — |
| Conversation **content** for their teams' cases | — | ❌ **needs a grant** | ❌ **needs a grant** |
| Reassign ownership within their teams | — | ✅ | ✅ |
| Team reports within scope | — | ✅ | ✅ |
| Members, invitations, teams | — | — | ✅ |
| Organization and workflow settings | — | — | ✅ |
| Intake question sets and templates | — | — | ✅ |
| Integrations | — | — | ✅ |
| Audit history | — | — | ✅ |
| Operations view (failed jobs, blocked sends) | — | — | ✅ |
| Sensitive original free text | ❌ grant | ❌ grant | ❌ grant |
| CSV / handoff exports | ❌ grant | ❌ grant | ❌ grant |
| Retention preview and execution | ❌ grant | ❌ grant | ❌ grant |
| Baseline / observation entry | ❌ grant | ❌ grant | ❌ grant |

**The org-admin role alone does not grant conversation access.** An
administrator who needs to read a case must grant themselves `CASE_CONTENT`
explicitly, which is an audited security event. The settings page says so in
those words.

---

## Grants

`PermissionGrant` rows, scoped to an organization, optionally narrowed to one
case or one team, with `startsAt`, an optional `expiresAt`, a `revokedAt`, and
the member who granted them.

| Grant | What it opens |
| --- | --- |
| `CASE_CONTENT` | Conversation, intake answers, notes and brief text for a case (or, unscoped, the organization) |
| `TEAM_CONVERSATION_CONTENT` | The same, across one authorized team |
| `REASSIGNMENT` | Changing case ownership |
| `EXPORT` | Producing CSV and handoff exports |
| `SENSITIVE_SOURCE` | Sensitive original free text and material derived from it |
| `TEAM_REPORTS` | Team operational reports (metadata only) |
| `BASELINE_ENTRY` | Recording the baseline/observation measurements the savings report uses |
| `RETENTION_ADMIN` | Running retention previews and executions |

## Coverage

`Coverage` transfers a colleague's cases — all of them, or one — to another
member for a bounded period. **Coverage grants must expire**, and the database
enforces it (`coverage_expires_after_start`). An `Absence` records the dates
somebody is away; an active fallback owner means a new inquiry never sits
unclaimed because the configured owner is out. A member cannot be deactivated
while they still own active cases: reassignment comes first.

---

## What `caseAccess` returns

```ts
{
  metadata: boolean,   // name, owner, status, next action, due times
  content:  boolean,   // conversation, intake answers, notes, brief text, excerpts
  sensitive: boolean,  // sensitive original text and derived material
  act:      boolean,   // write actions on the case
  reassign: boolean,   // change ownership
  basis:    string,    // human-readable reason, shown in the UI and audited
}
```

`basis` is surfaced to the user ("case owner", "active coverage grant",
"manager of the owning team (metadata only)"). When something is withheld, the
UI names the specific grant that would be required rather than hiding the
control silently.

`requireCase(ctx, id, need)` throws:

- `NotFoundError` when there is no access at all — a caller must not learn
  that a case exists, so an unauthorized case and a nonexistent one are
  indistinguishable.
- `ForbiddenError`, naming the missing grant, when there is partial access.

---

## Tenant isolation

- Every business row carries `organizationId`.
- Child rows reference parents through **compound foreign keys** that include
  `organizationId`, so a cross-organization reference cannot be written.
- Uniqueness is scoped per organization.
- A submitted organization id, role, owner id or applicant id is never trusted.
  The actor's organization comes from their session-backed membership; the
  subject's organization is read from the row and compared. Webhooks resolve
  ownership from the trusted endpoint and provider configuration, never from
  the request body.
- Search results, queue counts, notifications, brief citations, reports and
  exports all run through the same scope.

The seed creates two organizations for exactly this reason, and the browser
and integration suites both use the second one to prove the boundary holds.

---

## Revocation

Revoking a membership, a coverage grant or a permission grant takes effect on
the next authorization check — which is every read and every write, including
through an old link or an already-established session. Grants are filtered by
`revokedAt`, `startsAt` and `expiresAt` at query time; nothing is cached across
requests. A deactivated member fails `caseAccess` with the basis
"membership is deactivated".

---

## Jobs

A background job never inherits a human's authority. `systemContext(orgId,
jobName)` grants `metadata`, `content` and `act` **inside that one
organization only**, and never `sensitive` or `reassign`. Jobs re-check
current permission and consent state when they execute, because both can have
changed since the job was enqueued.

---

## What an applicant's own actions grant

Consent is per channel, per purpose, per contact value — and each action
grants exactly what it says:

| The person did this | It grants |
| --- | --- |
| Called the office number, nobody answered | `INBOUND_CALL_RESPONSE`: **one** automated reply to that number, inside a configured window |
| Replied to that message saying yes | `INTAKE_SMS`: the scripted questions may continue by text |
| Gave a number and asked for a callback | `CALLBACK_CALL`: a recruiter may ring it. **Not** permission to text |
| Ticked the SMS question in intake | `RECRUITER_SMS` |
| Texted STOP | Durable suppression of the **number**, across every case it appears on |

`INBOUND_CALL_RESPONSE` cannot be recorded by a recruiter. It is not something
a person says yes to — it is a fact about a call they placed — so only the
inbound-call handler may write it, and `recordVerbalConsent` rejects it.

Submitting a phone number is not consent to be texted. A missed call is not
consent to be texted. Asking for a callback is not consent to be texted.

## Applicants

An applicant can reach only their own intake session and their own appointment
confirmation, each through a scoped, expiring, revocable credential. They never
reach staff notes, briefs, tasks, audit logs, workspace pages, or any other
applicant's anything. Shared phone numbers and matching names are not treated
as proof of identity: a case's contents are never exposed or merged on the
basis of publicly submitted contact information alone.
