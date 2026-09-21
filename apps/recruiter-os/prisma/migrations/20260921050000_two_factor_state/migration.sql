-- Enrolment and lockout columns the two-factor plugin expects.
ALTER TABLE "twoFactor" ADD COLUMN "verified" BOOLEAN DEFAULT false;
ALTER TABLE "twoFactor" ADD COLUMN "failedVerificationCount" INTEGER DEFAULT 0;
ALTER TABLE "twoFactor" ADD COLUMN "lockedUntil" TIMESTAMP(3);
