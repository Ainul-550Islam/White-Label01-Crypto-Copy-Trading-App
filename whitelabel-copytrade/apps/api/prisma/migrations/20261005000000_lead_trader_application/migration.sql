-- # Responsibility: persists immutable tenant-scoped lead-trader applications and their active-review uniqueness boundary.
CREATE TYPE "LeadTraderApplicationStatus" AS ENUM (
  'SUBMITTED',
  'IN_REVIEW',
  'APPROVED',
  'REJECTED'
);

CREATE TABLE "lead_trader_applications" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "trader_id" UUID NOT NULL,
  "applicant_user_id" UUID,
  "reviewer_user_id" UUID,
  "status" "LeadTraderApplicationStatus" NOT NULL DEFAULT 'SUBMITTED',
  "version" INTEGER NOT NULL DEFAULT 1,
  "declaration" JSONB NOT NULL,
  "request_fingerprint" VARCHAR(64) NOT NULL,
  "idempotency_key" VARCHAR(255) NOT NULL,
  "active_application_key" VARCHAR(128),
  "submitted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewed_at" TIMESTAMPTZ(6),
  "decision_reason" VARCHAR(1000),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "lead_trader_applications_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "lead_trader_applications_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "lead_trader_applications_trader_id_fkey"
    FOREIGN KEY ("trader_id") REFERENCES "trader_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "lead_trader_applications_applicant_user_id_fkey"
    FOREIGN KEY ("applicant_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "lead_trader_applications_reviewer_user_id_fkey"
    FOREIGN KEY ("reviewer_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "lead_trader_applications_tenant_id_idempotency_key_key"
  ON "lead_trader_applications"("tenant_id", "idempotency_key");
CREATE UNIQUE INDEX "lead_trader_applications_tenant_id_trader_id_version_key"
  ON "lead_trader_applications"("tenant_id", "trader_id", "version");
CREATE UNIQUE INDEX "lead_trader_applications_tenant_id_active_application_key_key"
  ON "lead_trader_applications"("tenant_id", "active_application_key");
CREATE INDEX "lead_trader_applications_tenant_id_status_submitted_at_idx"
  ON "lead_trader_applications"("tenant_id", "status", "submitted_at");
CREATE INDEX "lead_trader_applications_tenant_id_trader_id_submitted_at_idx"
  ON "lead_trader_applications"("tenant_id", "trader_id", "submitted_at");
