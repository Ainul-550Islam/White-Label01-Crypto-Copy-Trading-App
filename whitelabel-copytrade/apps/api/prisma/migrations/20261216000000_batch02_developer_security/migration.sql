-- Only the new request-key namespace is indexed; existing delivery keys and
-- historical replay records are left unchanged. Conflicting concurrent intent
-- keys in the same tenant cannot create multiple replay deliveries.
CREATE UNIQUE INDEX "developer_replay_intent_tenant_key"
  ON "developer_webhook_deliveries" ("tenant_id", "idempotency_key")
  WHERE "idempotency_key" LIKE 'replay2:%';

-- One-time secret issuance and rotation cannot safely replay their plaintext
-- response. A committed intent is therefore a conflict on retry, not a new
-- secret. The row is inserted in the same transaction as the mutation.
CREATE TABLE "developer_mutation_intents" (
  "tenant_id" UUID NOT NULL,
  "key_hash" VARCHAR(64) NOT NULL,
  "operation" VARCHAR(64) NOT NULL,
  "resource" VARCHAR(128) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "developer_mutation_intents_pkey" PRIMARY KEY ("tenant_id", "key_hash"),
  CONSTRAINT "developer_mutation_intents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
-- The tenant_isolation policy is deliberately NOT created here: Part 11's
-- generated RLS sweep (and the batch-03 reconcile migration
-- 20261228000000_rls_coverage_reconcile) owns policy creation so the policy
-- body always matches the regenerated canonical text. This migration only
-- creates the table and marks it RLS-protected; FORCE prevents the table
-- owner from bypassing the policy once the sweep attaches it.
ALTER TABLE "developer_mutation_intents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "developer_mutation_intents" FORCE ROW LEVEL SECURITY;

-- Version 1 rows retain their original algorithm; never silently re-hash
-- history. New audit rows use deterministic, recursively sorted JSON.
ALTER TABLE "developer_audit" ADD COLUMN "hash_version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "developer_audit" ADD CONSTRAINT "developer_audit_hash_version_check" CHECK ("hash_version" IN (1, 2));
