-- Database-level invariants.
--
-- TypeScript types and the transition tables in
-- src/server/domain/state-machines.ts describe the intended workflow. These
-- constraints make the important parts of it true even if something reaches
-- the database another way: a migration, a console session, a future service.

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ---------------------------------------------------------------------------
-- Appointments: no overlapping ACTIVE appointments for one recruiter.
--
-- This is what makes two concurrent booking requests safe: the loser gets a
-- 23P01 exclusion violation, which the service turns into a clear conflict.
-- ---------------------------------------------------------------------------
ALTER TABLE "appointment"
  ADD CONSTRAINT "appointment_no_overlap"
  EXCLUDE USING gist (
    "organizationId" WITH =,
    "recruiterMemberId" WITH =,
    tsrange("startsAt", "endsAt") WITH &&
  )
  WHERE ("state" IN ('PROPOSED', 'SCHEDULED', 'CONFIRMED'));

ALTER TABLE "appointment"
  ADD CONSTRAINT "appointment_ends_after_starts" CHECK ("endsAt" > "startsAt");

-- Completion and no-show require a recorded outcome, entered by someone.
ALTER TABLE "appointment"
  ADD CONSTRAINT "appointment_outcome_required" CHECK (
    "state" NOT IN ('COMPLETED', 'NO_SHOW')
    OR ("outcome" IS NOT NULL AND "outcomeRecordedAt" IS NOT NULL AND "outcomeRecordedByMemberId" IS NOT NULL)
  );

-- ---------------------------------------------------------------------------
-- Cases: an active case always has an accountable owner. Closing always has a
-- reason and a timestamp.
-- ---------------------------------------------------------------------------
ALTER TABLE "applicant"
  ADD CONSTRAINT "applicant_active_requires_owner" CHECK (
    "status" = 'CLOSED' OR "mergedIntoApplicantId" IS NOT NULL OR "ownerMemberId" IS NOT NULL
  );

ALTER TABLE "applicant"
  ADD CONSTRAINT "applicant_closure_requires_reason" CHECK (
    "status" <> 'CLOSED' OR ("closureReason" IS NOT NULL AND "closedAt" IS NOT NULL)
  );

ALTER TABLE "applicant"
  ADD CONSTRAINT "applicant_merge_is_not_self" CHECK (
    "mergedIntoApplicantId" IS NULL OR "mergedIntoApplicantId" <> "id"
  );

-- ---------------------------------------------------------------------------
-- Tasks: completion needs a time and an outcome; cancellation needs a reason.
-- Snoozing must never rewrite the original promise, so originalDueAt can only
-- be at or before the current due date.
-- ---------------------------------------------------------------------------
ALTER TABLE "task"
  ADD CONSTRAINT "task_completion_requires_outcome" CHECK (
    "status" <> 'COMPLETED'
    OR ("completedAt" IS NOT NULL AND "completionOutcome" IS NOT NULL AND "completedByMemberId" IS NOT NULL)
  );

ALTER TABLE "task"
  ADD CONSTRAINT "task_cancel_requires_reason" CHECK (
    "status" <> 'CANCELED' OR ("canceledAt" IS NOT NULL AND "cancelReason" IS NOT NULL)
  );

ALTER TABLE "task"
  ADD CONSTRAINT "task_original_due_not_after_due" CHECK ("originalDueAt" <= "dueAt");

-- ---------------------------------------------------------------------------
-- Messages: an outbound message may not be past APPROVED without an approval
-- hash, and a blocked message must say why.
-- ---------------------------------------------------------------------------
ALTER TABLE "message"
  ADD CONSTRAINT "message_dispatchable_requires_approval" CHECK (
    "direction" <> 'OUTBOUND'
    OR "state" IN ('DRAFT', 'CANCELED', 'BLOCKED')
    OR "approvedBodyHash" IS NOT NULL
  );

ALTER TABLE "message"
  ADD CONSTRAINT "message_blocked_requires_reason" CHECK (
    "state" <> 'BLOCKED' OR "blockedReason" IS NOT NULL
  );

ALTER TABLE "message"
  ADD CONSTRAINT "message_inbound_is_received" CHECK (
    "direction" <> 'INBOUND' OR "state" = 'RECEIVED'
  );

-- ---------------------------------------------------------------------------
-- Coverage ALWAYS expires. An open-ended coverage grant is not expressible.
-- ---------------------------------------------------------------------------
ALTER TABLE "coverage"
  ADD CONSTRAINT "coverage_expires_after_start" CHECK ("expiresAt" > "startsAt");

ALTER TABLE "coverage"
  ADD CONSTRAINT "coverage_not_self" CHECK ("fromMemberId" <> "toMemberId");

ALTER TABLE "permission_grant"
  ADD CONSTRAINT "grant_expiry_after_start" CHECK ("expiresAt" IS NULL OR "expiresAt" > "startsAt");

ALTER TABLE "absence"
  ADD CONSTRAINT "absence_ends_after_start" CHECK ("endsAt" > "startsAt");

-- ---------------------------------------------------------------------------
-- Settings: quiet-hour minutes are minutes of a day.
-- ---------------------------------------------------------------------------
ALTER TABLE "organization_settings"
  ADD CONSTRAINT "settings_quiet_hours_range" CHECK (
    "quietHoursStartMinute" BETWEEN 0 AND 1439 AND "quietHoursEndMinute" BETWEEN 0 AND 1439
  );

ALTER TABLE "organization_settings"
  ADD CONSTRAINT "settings_seat_limit_positive" CHECK ("seatLimit" > 0);

-- ---------------------------------------------------------------------------
-- Published definitions are immutable and approved.
-- ---------------------------------------------------------------------------
ALTER TABLE "intake_version"
  ADD CONSTRAINT "intake_version_published_requires_approval" CHECK (
    "state" <> 'PUBLISHED' OR ("publishedAt" IS NOT NULL AND "approvedByMemberId" IS NOT NULL)
  );

ALTER TABLE "template_version"
  ADD CONSTRAINT "template_version_published_requires_approval" CHECK (
    "state" <> 'PUBLISHED' OR ("publishedAt" IS NOT NULL AND "approvedByMemberId" IS NOT NULL)
  );

-- Only one PUBLISHED version per intake definition and per template.
CREATE UNIQUE INDEX "intake_version_one_published"
  ON "intake_version" ("organizationId", "definitionId")
  WHERE ("state" = 'PUBLISHED');

CREATE UNIQUE INDEX "template_version_one_published"
  ON "template_version" ("organizationId", "templateId")
  WHERE ("state" = 'PUBLISHED');

-- ---------------------------------------------------------------------------
-- Availability windows are a real interval inside a day.
-- ---------------------------------------------------------------------------
ALTER TABLE "availability_window"
  ADD CONSTRAINT "availability_window_valid" CHECK (
    "weekday" BETWEEN 0 AND 6 AND "startMinute" BETWEEN 0 AND 1439 AND "endMinute" > "startMinute" AND "endMinute" <= 1440
  );

-- ---------------------------------------------------------------------------
-- Brief citations must quote something.
-- ---------------------------------------------------------------------------
ALTER TABLE "brief_source_ref"
  ADD CONSTRAINT "brief_source_ref_excerpt_not_empty" CHECK (length(btrim("quotedExcerpt")) >= 3);

-- ---------------------------------------------------------------------------
-- Queue and report query support.
-- ---------------------------------------------------------------------------
CREATE INDEX "task_open_due_idx" ON "task" ("organizationId", "dueAt")
  WHERE ("status" IN ('OPEN', 'SNOOZED'));

CREATE INDEX "review_flag_open_idx" ON "review_flag" ("organizationId", "raisedAt")
  WHERE ("status" = 'OPEN');

CREATE INDEX "applicant_active_idx" ON "applicant" ("organizationId", "ownerMemberId", "updatedAt")
  WHERE ("status" <> 'CLOSED' AND "mergedIntoApplicantId" IS NULL);

CREATE INDEX "message_pending_send_idx" ON "message" ("organizationId", "scheduledFor")
  WHERE ("state" IN ('APPROVED', 'SCHEDULED', 'QUEUED'));
