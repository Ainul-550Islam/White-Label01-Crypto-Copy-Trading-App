-- The response and its audit event are committed together; duplicate keys replay
-- the same bounded result, never a new export. Rows expire after seven days.
CREATE TABLE "governance_audit_export_intents" (
  "tenant_id" UUID NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "key_hash" VARCHAR(64) NOT NULL,
  "request_hash" VARCHAR(64) NOT NULL,
  "response" JSONB,
  "queued_result" JSONB,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMPTZ NOT NULL DEFAULT (CURRENT_TIMESTAMP + INTERVAL '7 days'),
  PRIMARY KEY ("tenant_id", "key_hash")
);
CREATE INDEX "governance_audit_export_intent_expiry_idx" ON "governance_audit_export_intents" ("expires_at");
ALTER TABLE "governance_audit_export_intents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "governance_audit_export_intents" FORCE ROW LEVEL SECURITY;
CREATE POLICY "governance_audit_export_intent_tenant_isolation" ON "governance_audit_export_intents"
 USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
 WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
