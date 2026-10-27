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
CREATE POLICY tenant_isolation ON "developer_mutation_intents"
  AS PERMISSIVE FOR ALL TO PUBLIC
  USING ("tenant_id" = wlct_current_tenant_id())
  WITH CHECK ("tenant_id" = wlct_current_tenant_id());
ALTER TABLE "developer_mutation_intents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "developer_mutation_intents" FORCE ROW LEVEL SECURITY;

-- Version 1 rows retain their original algorithm; never silently re-hash
-- history. New audit rows use deterministic, recursively sorted JSON.
ALTER TABLE "developer_audit" ADD COLUMN "hash_version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "developer_audit" ADD CONSTRAINT "developer_audit_hash_version_check" CHECK ("hash_version" IN (1, 2));
