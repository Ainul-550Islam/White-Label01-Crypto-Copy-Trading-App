-- Each self-service reduction is monotone and recorded with its original
-- client key. The row is both replay protection and durable change history.
CREATE TABLE "copy_budget_reduction_intents" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "key_hash" CHAR(64) NOT NULL,
  "requested_exposure" DECIMAL(28,12) NOT NULL,
  "previous_exposure" DECIMAL(28,12),
  "currency" VARCHAR(12) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "copy_budget_reduction_intents_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "copy_budget_reduction_intents_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
  CONSTRAINT "copy_budget_reduction_intents_user_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
  CONSTRAINT "copy_budget_reduction_intents_nonnegative" CHECK ("requested_exposure" >= 0 AND ("previous_exposure" IS NULL OR "previous_exposure" >= 0))
);
CREATE UNIQUE INDEX "copy_budget_reduction_intents_unique_key" ON "copy_budget_reduction_intents" ("tenant_id", "user_id", "key_hash");
CREATE INDEX "copy_budget_reduction_intents_history_idx" ON "copy_budget_reduction_intents" ("tenant_id", "user_id", "created_at");
CREATE POLICY "copy_budget_reduction_tenant_isolation" ON "copy_budget_reduction_intents"
  AS PERMISSIVE FOR ALL TO PUBLIC
  USING ("tenant_id" = wlct_current_tenant_id())
  WITH CHECK ("tenant_id" = wlct_current_tenant_id());
-- This is a new table, so there are no old unscoped writers to disrupt.
ALTER TABLE "copy_budget_reduction_intents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "copy_budget_reduction_intents" FORCE ROW LEVEL SECURITY;
