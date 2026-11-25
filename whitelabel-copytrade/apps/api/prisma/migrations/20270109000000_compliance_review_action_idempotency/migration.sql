-- # Responsibility: add tenant-and-reviewer-scoped idempotency receipts to immutable compliance review actions.
-- Additive only. This migration is intentionally separate from the RLS policy-gap
-- migration and is not applied automatically by this repository task.

ALTER TABLE "compliance_reviews"
  ADD COLUMN "idempotency_key" VARCHAR(128),
  ADD COLUMN "request_fingerprint" VARCHAR(64),
  ADD COLUMN "result_reference_id" UUID;

-- PostgreSQL permits multiple NULL values in a unique index, preserving legacy
-- review rows and non-idempotent actions while preventing concurrent key reuse.
CREATE UNIQUE INDEX "compliance_reviews_tenant_id_reviewer_id_idempotency_key_key"
  ON "compliance_reviews" ("tenant_id", "reviewer_id", "idempotency_key");
