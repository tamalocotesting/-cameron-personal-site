-- The consent purpose a send was gated on, stored on the message.
--
-- It used to be inferred from the author kind at dispatch time, which meant
-- the pre-queue gate and the pre-dispatch gate could ask different questions:
-- an automated reply gated on INBOUND_CALL_RESPONSE was re-checked against
-- INTAKE_SMS and blocked.

ALTER TABLE "message" ADD COLUMN "consentPurpose" "ConsentPurpose";

-- Backfill from what the old inference would have produced, so existing rows
-- keep behaving exactly as they did.
UPDATE "message"
SET "consentPurpose" = CASE
  WHEN "authorKind" = 'APPROVED_AUTOMATION' AND "templateVersionId" IS NOT NULL THEN 'INTAKE_SMS'::"ConsentPurpose"
  ELSE 'RECRUITER_SMS'::"ConsentPurpose"
END
WHERE "direction" = 'OUTBOUND' AND "consentPurpose" IS NULL;
