-- An opt-out belongs to a phone number, not to a case.
--
-- Before this, STOP from a number with no case suppressed nothing, and a
-- later inbound call could be answered with an automated text. Suppression
-- now lives with the number and is checked before every send.

CREATE TABLE "sms_suppression" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "contactValue"   TEXT NOT NULL,
  "suppressedAt"   TIMESTAMP(3) NOT NULL,
  "source"         TEXT NOT NULL,
  "liftedAt"       TIMESTAMP(3),
  "liftedSource"   TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "sms_suppression_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "sms_suppression_organizationId_contactValue_key"
  ON "sms_suppression" ("organizationId", "contactValue");
CREATE INDEX "sms_suppression_organizationId_contactValue_liftedAt_idx"
  ON "sms_suppression" ("organizationId", "contactValue", "liftedAt");

ALTER TABLE "sms_suppression"
  ADD CONSTRAINT "sms_suppression_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A lift is an event with a reason, never a silent clear.
ALTER TABLE "sms_suppression" ADD CONSTRAINT "sms_suppression_lift_needs_source" CHECK (
  ("liftedAt" IS NULL AND "liftedSource" IS NULL)
  OR ("liftedAt" IS NOT NULL AND "liftedSource" IS NOT NULL)
);

-- Backfill from the per-case permission rows that already carry suppression,
-- so an existing opt-out is not lost by this change.
INSERT INTO "sms_suppression" ("id", "organizationId", "contactValue", "suppressedAt", "source", "updatedAt")
SELECT
  gen_random_uuid()::text,
  "organizationId",
  "contactValue",
  MIN(COALESCE("suppressedAt", "updatedAt")),
  COALESCE(MIN("suppressionSource"), 'backfill'),
  CURRENT_TIMESTAMP
FROM "channel_permission"
WHERE "suppressed" = true AND "channel" = 'SMS'
GROUP BY "organizationId", "contactValue"
ON CONFLICT ("organizationId", "contactValue") DO NOTHING;
