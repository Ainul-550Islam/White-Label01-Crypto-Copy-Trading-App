BEGIN;

-- InstitutionalRiskPolicy contains both global platform rules and tenant rules.
-- The generic RLS migration deliberately excluded nullable-tenant tables. This
-- read policy exposes only the platform defaults and the transaction's tenant.
-- Tenant writes are limited to that same tenant; global writes still require a
-- privileged database role in addition to application-level platform RBAC.
-- Refuse rollout if existing rows have ambiguous ownership or multiple active
-- revisions. PostgreSQL's default NULL uniqueness does not protect globals.
ALTER TABLE "institutional_risk_policies" ADD CONSTRAINT institutional_risk_policy_scope_binding CHECK (
  (scope = 'PLATFORM' AND tenant_id IS NULL AND scope_id IS NULL)
  OR (scope <> 'PLATFORM' AND tenant_id IS NOT NULL AND scope_id IS NOT NULL
      AND (scope <> 'TENANT' OR scope_id = tenant_id::text))
);
CREATE UNIQUE INDEX institutional_risk_policy_revision_unique
  ON "institutional_risk_policies" (tenant_id, scope, scope_id, version) NULLS NOT DISTINCT;
CREATE UNIQUE INDEX institutional_risk_policy_active_unique
  ON "institutional_risk_policies" (tenant_id, scope, scope_id) NULLS NOT DISTINCT WHERE is_active;

CREATE POLICY institutional_risk_policy_scoped_read ON "institutional_risk_policies" FOR SELECT
  USING (
    (tenant_id IS NULL AND scope = 'PLATFORM' AND scope_id IS NULL)
    OR (tenant_id = wlct_current_tenant_id() AND scope <> 'PLATFORM')
  );

CREATE POLICY institutional_risk_policy_tenant_insert ON "institutional_risk_policies" FOR INSERT
  WITH CHECK (tenant_id = wlct_current_tenant_id() AND scope <> 'PLATFORM'
    AND scope_id IS NOT NULL AND (scope <> 'TENANT' OR scope_id = tenant_id::text));
CREATE POLICY institutional_risk_policy_tenant_update ON "institutional_risk_policies" FOR UPDATE
  USING (tenant_id = wlct_current_tenant_id() AND scope <> 'PLATFORM')
  WITH CHECK (tenant_id = wlct_current_tenant_id() AND scope <> 'PLATFORM'
    AND scope_id IS NOT NULL AND (scope <> 'TENANT' OR scope_id = tenant_id::text));
ALTER TABLE "institutional_risk_policies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "institutional_risk_policies" FORCE ROW LEVEL SECURITY;

-- Atomic tenant audit for policy updates when the shared audit table has RLS.
CREATE POLICY institutional_risk_policy_audit_insert ON "audit_logs" FOR INSERT
  WITH CHECK (tenant_id = wlct_current_tenant_id() AND actor_type = 'USER' AND action = 'RISK_POLICY_UPSERT');
CREATE POLICY institutional_risk_policy_audit_read ON "audit_logs" FOR SELECT
  USING (tenant_id = wlct_current_tenant_id() AND actor_type = 'USER' AND action = 'RISK_POLICY_UPSERT');

-- A retry key is scoped to the target tenant and the verified actor. Platform
-- policies use the platform actor's tenant for retry ownership. The hash binds
-- the entire request; the referenced immutable revision makes replay durable.
CREATE TABLE "institutional_risk_policy_update_intents" (
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "key_hash" char(64) NOT NULL CHECK ("key_hash" ~ '^[0-9a-f]{64}$'),
  "intent_hash" char(64) NOT NULL CHECK ("intent_hash" ~ '^[0-9a-f]{64}$'),
  "policy_id" uuid NOT NULL REFERENCES "institutional_risk_policies"("id") ON DELETE RESTRICT,
  "created_at" timestamptz(6) NOT NULL DEFAULT now(),
  PRIMARY KEY ("tenant_id", "user_id", "key_hash")
);
ALTER TABLE "institutional_risk_policy_update_intents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "institutional_risk_policy_update_intents" FORCE ROW LEVEL SECURITY;
CREATE POLICY institutional_risk_policy_update_intents_tenant ON "institutional_risk_policy_update_intents"
  USING (tenant_id = wlct_current_tenant_id()) WITH CHECK (tenant_id = wlct_current_tenant_id());

COMMIT;
