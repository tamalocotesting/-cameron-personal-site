-- Text-back intake: answering a call nobody picked up with one automated
-- message, then conducting the SAME scripted, versioned intake over SMS.

-- A narrow consent basis created only by an inbound call the person placed to
-- the organization's own number. It authorizes exactly one reply.
ALTER TYPE "ConsentPurpose" ADD VALUE IF NOT EXISTS 'INBOUND_CALL_RESPONSE';

ALTER TYPE "TemplateKind" ADD VALUE IF NOT EXISTS 'MISSED_CALL_REPLY';
ALTER TYPE "TemplateKind" ADD VALUE IF NOT EXISTS 'INTAKE_SMS_PROMPT';

CREATE TYPE "IntakeChannel" AS ENUM ('WEB', 'SMS');

ALTER TABLE "intake_session"
  ADD COLUMN "channel" "IntakeChannel" NOT NULL DEFAULT 'WEB',
  ADD COLUMN "smsContactValue" TEXT,
  ADD COLUMN "smsInvitedAt" TIMESTAMP(3),
  ADD COLUMN "smsOptInAt" TIMESTAMP(3);

CREATE INDEX "intake_session_organizationId_smsContactValue_status_idx"
  ON "intake_session" ("organizationId", "smsContactValue", "status");

-- An SMS session must know which number it is talking to, and a web session
-- must not claim one.
ALTER TABLE "intake_session" ADD CONSTRAINT "intake_session_sms_requires_contact" CHECK (
  ("channel" = 'SMS' AND "smsContactValue" IS NOT NULL)
  OR ("channel" = 'WEB' AND "smsContactValue" IS NULL)
);

-- No question is ever asked by text before the person explicitly opted in, so
-- an opt-in timestamp without an invitation is a contradiction.
ALTER TABLE "intake_session" ADD CONSTRAINT "intake_session_optin_requires_invite" CHECK (
  "smsOptInAt" IS NULL OR "smsInvitedAt" IS NOT NULL
);

-- At most one live SMS intake conversation per number per organization: two
-- scripts talking to the same phone at once is how people get spammed.
CREATE UNIQUE INDEX "intake_session_one_live_sms_per_number"
  ON "intake_session" ("organizationId", "smsContactValue")
  WHERE ("channel" = 'SMS' AND "status" IN ('IN_PROGRESS', 'PAUSED'));

ALTER TABLE "organization_settings"
  ADD COLUMN "textBackEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "textBackWindowMinutes" INTEGER NOT NULL DEFAULT 15,
  ADD COLUMN "textBackMaxQuestions" INTEGER NOT NULL DEFAULT 8;

ALTER TABLE "organization_settings" ADD CONSTRAINT "organization_settings_text_back_window" CHECK (
  "textBackWindowMinutes" BETWEEN 1 AND 240 AND "textBackMaxQuestions" BETWEEN 1 AND 30
);
