# Integrations

Every integration is behind a provider-neutral interface with at least two
implementations: a simulator that works offline, and a real adapter. The real
adapters are **written, not verified** — see the status column and
[BUILD_STATUS.md](./BUILD_STATUS.md).

## Status vocabulary

The workspace shows one of these for every integration, and never more than it
can prove:

| Status | Means |
| --- | --- |
| **Disabled** | Not configured, or not enabled for this organization |
| **Demo** | A simulator is handling it; nothing leaves the machine |
| **Configured but unverified** | Credentials are present and nothing has been checked |
| **Healthy** | An actual relevant check ran and passed |
| **Error** | A check ran and failed, or a call returned an error |

A present credential earns "Configured but unverified" and nothing more.
**"Healthy" requires an actual check**, and the UI records when it ran.

---

## Twilio — SMS

`src/server/providers/sms/twilio.ts`. Real integration code using the official
SDK.

**Configuration:** `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`,
`TWILIO_WEBHOOK_BASE_URL`, plus per-organization enablement and a from-number
in Settings → Integrations. Credentials stay server-side; the settings page
shows which variables are missing **by name only** and never their values.

**Outbound.** One submission per message, then:

- a 4xx with a Twilio error code → `FAILED`, terminal
- a success → `PROVIDER_ACCEPTED` with the SID recorded
- a timeout, socket hang-up or 5xx → **`OUTCOME_UNKNOWN`**, never `FAILED`

The last one matters: Twilio may well have accepted a request whose response
never reached us. `lookupByIdempotencyKey` reconciles by listing recent
messages to that recipient, because that is the only way to find a submission
whose SID we never received. **It is never blindly retried**, because the
alternative is texting somebody twice.

**Inbound webhooks** (`/api/webhooks/twilio/sms`, `/status`, `/voice`,
`/voice-status`):

- Signatures are verified with the official SDK against the **externally
  configured URL** — `TWILIO_WEBHOOK_BASE_URL`, not the internal URL a proxy
  hands us, which is the usual cause of "signature invalid in production".
- Form bodies validate with `validateRequest` over the parsed parameters;
  JSON bodies with `validateRequestWithBody` over the **raw** body.
- The organization is resolved from **our own** endpoint and provider
  configuration, never from the payload.
- Invalid requests are rejected before any processing.
- Events are deduplicated on the provider's own identifiers.
- Delivery statuses are append-only and rank-gated, so a late "sent" arriving
  after "delivered" is recorded without corrupting the current state.
- The handler validates, persists durably and acknowledges promptly; the slower
  work happens in a job.

**Opt-out.** STOP / START / HELP are processed per current Twilio behaviour.
Suppression is durable and lives with the **phone number**, not the case
(`SmsSuppression`), so an opt-out from a number with no case, or one on three
cases, sticks either way. Pending sends to that number are cancelled. We
deliberately **do not** send our own reply to STOP or HELP, because Twilio
already answers those and two replies is worse than one. **A recruiter cannot
override an opt-out by pressing Send.**

---

## Twilio — Voice

`src/server/providers/voice/twilio.ts`. Inbound calls to a configured number
are forwarded to a configured recruiter number.

The thing that is easy to get wrong: **a forwarded parent call reports
`completed` whether or not a human answered.** Deciding "missed call" from the
parent status produces callback tasks for answered calls and none for
unanswered ones. Every decision here reads the **forwarded leg's**
`DialCallStatus`, and only `completed` *with measurable duration* counts as a
human having spoken.

Busy, no-answer, failed and unknown all create exactly one callback task,
idempotent on the call SID.

**No call recording, no transcription, no autonomous voice agent.** A clicked
`tel:` link never counts as a connected call — the dialler opens, and then the
recruiter says what happened.

### Text-back after an unanswered call

Off by default (`OrganizationSettings.textBackEnabled`). When an organization
turns it on, an unanswered inbound call gets **one** automated reply to the
number that called, which offers to take a few details by text.

- The basis is `INBOUND_CALL_RESPONSE`: narrow, recorded with the call that
  created it, valid for one message inside a configured window
  (`textBackWindowMinutes`, default 15). It is **not** SMS marketing consent.
- Continuing by text requires the person to say so. That reply is recorded
  separately as `INTAKE_SMS` consent with its own disclosure.
- The questions are the organization's **published, immutable** intake
  version, asked one per message. The script cannot improvise, answer a
  question, or say anything that is not in an approved versioned artifact.
- Asking for a person, or any sensitive topic, stops it immediately.
- It stops on its own after `textBackMaxQuestions`.
- The callback task stands throughout: somebody rang a person, and that is
  still the right follow-up.

See [ARCHITECTURE.md](./ARCHITECTURE.md#text-back-intake) for the full flow.

---

## Local telecom simulator

`src/server/providers/sms/simulator.ts` and `voice/simulator.ts`. The default
in `DEMO` mode, and what the tests run against.

It is a real adapter, not a stub: it goes through the same send gate, the same
state machine, the same outbox and the same delivery-event handling. The
`/demo-console` controls post to **the same domain handlers a Twilio callback
would reach**. Only the transport is simulated, and every message it produces
is flagged `simulated` and labelled in the UI.

In `DEMO` mode, outbound messaging is **hard-blocked even if Twilio
credentials are present in the environment**.

---

## Anthropic — brief preparation (optional)

`src/server/providers/ai/anthropic.ts`. Optional. The default is
`local-rules`, a deterministic adapter that identifies itself in the UI as
rules-based demo preparation.

**Configuration:** `ANTHROPIC_API_KEY` and `ANTHROPIC_MODEL`, plus
per-organization enablement and an approved-category list. **The model is
configuration** — there is no hardcoded model identifier.

- Structured output via the SDK's JSON-schema support, then **validated
  independently with our own zod schema**. A result that does not validate is
  rejected, not displayed.
- Source references are **application-defined fields in our own schema**. No
  provider citation feature is relied on, and the two are never combined.
- Context is minimised to the approved categories. Sensitive free text,
  private staff notes, other cases and anything not on the approved list are
  **not sent by default**.
- Every factual item must cite existing, same-case sources whose excerpt
  actually appears in the referenced message, intake answer or note revision —
  checked against our own database before anything is shown.
- Transcripts are untrusted input. A message saying "ignore your instructions"
  changes nothing: the model has no tools, no data access and no ability to
  cause a request or an action.
- Timeouts, bounded retries, schema validation and failure telemetry **without
  raw applicant content**. An outage produces an explicit unavailable state;
  the workspace and intake keep working.

**Application code cannot guarantee a provider's retention or training
policies, and this product does not claim otherwise.** That is a contract you
sign, not a setting you toggle.

---

## SMTP — invitations and password resets

Nodemailer against `SMTP_*`. Locally that is Mailpit on `localhost:1025`, with
the web interface on <http://localhost:8025>, so invitation and reset flows can
be exercised end to end without anything leaving the machine.

---

## Outbound webhook — handoff

`src/server/providers/webhook/outbound.ts`. Disabled until explicitly
configured with `OUTBOUND_WEBHOOK_ALLOWED_ORIGINS` and
`OUTBOUND_WEBHOOK_SIGNING_SECRET`.

- Destination **allowlisting** by origin, with SSRF protections.
- Request signing, idempotency keys, bounded retries.
- Transport outcomes are distinguished: queued → transport-accepted → failed,
  and separately **externally confirmed**.
- **A 2xx response establishes transport acceptance, not business-system
  acceptance.** Only somebody on the receiving side telling us it landed moves
  a handoff to `EXTERNALLY_CONFIRMED`.

**There is no AFRISS or other government-system API here.** None is
fabricated, claimed, scraped, or bypassed. The handoff is a generic, versioned,
recruiter-reviewed export of allowlisted fields, and the UI says it is a manual
handoff rather than proof of import into an official system.

---

## Adding a provider

1. Implement the interface in `src/server/providers/<kind>/types.ts`.
2. Register it in `src/server/providers/registry.ts`, which resolves per
   organization and returns availability with a **reason** when unavailable.
3. Add its configuration to `.env.example` **with a description and no secret**.
4. Add the check that would justify a "Healthy" status. If there isn't one,
   the integration stays "Configured but unverified" — which is the honest
   answer.
