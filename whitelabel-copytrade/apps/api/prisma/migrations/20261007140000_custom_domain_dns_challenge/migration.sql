-- # Responsibility: persists bounded custom-domain DNS challenge attempts and expiry for fail-closed ownership verification.
ALTER TABLE "tenant_domains"
  ADD COLUMN "verification_attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "verification_expires_at" TIMESTAMPTZ(6);

ALTER TABLE "tenant_domains"
  ADD CONSTRAINT "tenant_domains_verification_attempts_bounded"
  CHECK ("verification_attempts" BETWEEN 0 AND 5);
