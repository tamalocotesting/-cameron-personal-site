-- A question key is stable ACROSS versions and legitimately appears on both
-- pathways (the callback flow and the fuller flow both ask for a name). So
-- uniqueness is per pathway, which keeps answers comparable between versions
-- without forbidding the same question on both paths.
DROP INDEX IF EXISTS "intake_question_organizationId_intakeVersionId_key_key";

CREATE UNIQUE INDEX "intake_question_organizationId_intakeVersionId_pathway_key_key"
  ON "intake_question" ("organizationId", "intakeVersionId", "pathway", "key");
