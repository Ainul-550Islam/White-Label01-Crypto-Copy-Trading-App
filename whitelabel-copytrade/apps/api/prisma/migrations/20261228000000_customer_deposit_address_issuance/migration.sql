-- Durable per-request Fireblocks vault issuance. An issued address is not a
-- deposit, a balance, a settlement, or a credit. No private keys or provider
-- access tokens are stored here.
CREATE TABLE "customer_deposit_address_issuances" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "funding_request_id" UUID NOT NULL REFERENCES "funding_requests"("id") ON DELETE RESTRICT,
  "account_id" UUID NOT NULL REFERENCES "institutional_accounts"("id") ON DELETE RESTRICT,
  "client_profile_id" UUID REFERENCES "client_profiles"("id") ON DELETE RESTRICT,
  "asset_id" VARCHAR(128) NOT NULL REFERENCES "custody_assets"("asset_id") ON DELETE RESTRICT,
  "network_id" VARCHAR(64) NOT NULL REFERENCES "custody_networks"("network_id") ON DELETE RESTRICT,
  "provider_asset_id" VARCHAR(128) NOT NULL,
  "provider_native_asset_id" VARCHAR(128) NOT NULL,
  "provider_credential_fingerprint" CHAR(64) NOT NULL,
  "vault_name" VARCHAR(128) NOT NULL,
  "provider_customer_ref" VARCHAR(128) NOT NULL,
  "vault_id" VARCHAR(31),
  "address" VARCHAR(512),
  "state" VARCHAR(24) NOT NULL DEFAULT 'PENDING',
  "attempt_started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "lease_token" UUID,
  "lease_until" TIMESTAMPTZ(6),
  "verified_at" TIMESTAMPTZ(6),
  "last_failure_code" VARCHAR(64),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "customer_deposit_issuance_state_check" CHECK ("state" IN ('PENDING', 'VERIFIED', 'MANUAL_REVIEW')),
  CONSTRAINT "customer_deposit_issuance_verified_check" CHECK (
    "state" <> 'VERIFIED' OR ("vault_id" IS NOT NULL AND "address" IS NOT NULL AND "verified_at" IS NOT NULL)
  ),
  CONSTRAINT "customer_deposit_issuance_lease_check" CHECK (("lease_token" IS NULL) = ("lease_until" IS NULL)),
  CONSTRAINT "customer_deposit_issuance_identity" UNIQUE ("tenant_id", "funding_request_id", "asset_id", "network_id"),
  CONSTRAINT "customer_deposit_issuance_tenant_id" UNIQUE ("tenant_id", "id"),
  CONSTRAINT "customer_deposit_issuance_vault_name" UNIQUE ("provider_credential_fingerprint", "vault_name")
);
CREATE INDEX "customer_deposit_issuance_account_idx" ON "customer_deposit_address_issuances" ("tenant_id", "account_id", "created_at");

-- Every client key is bound to exactly one immutable intent, including keys
-- presented by another authorised owner of the same funding request.
CREATE TABLE "customer_deposit_address_request_keys" (
  "tenant_id" UUID NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "key_hash" CHAR(64) NOT NULL,
  "intent_hash" CHAR(64) NOT NULL,
  "issuance_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  PRIMARY KEY ("tenant_id", "user_id", "key_hash"),
  CONSTRAINT "customer_deposit_key_issuance_fk" FOREIGN KEY ("tenant_id", "issuance_id")
    REFERENCES "customer_deposit_address_issuances"("tenant_id", "id") ON DELETE RESTRICT
);
CREATE POLICY "customer_deposit_issuance_tenant_isolation" ON "customer_deposit_address_issuances"
  FOR ALL TO PUBLIC USING ("tenant_id" = wlct_current_tenant_id()) WITH CHECK ("tenant_id" = wlct_current_tenant_id());
CREATE POLICY "customer_deposit_key_tenant_isolation" ON "customer_deposit_address_request_keys"
  FOR ALL TO PUBLIC USING ("tenant_id" = wlct_current_tenant_id()) WITH CHECK ("tenant_id" = wlct_current_tenant_id());
ALTER TABLE "customer_deposit_address_issuances" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "customer_deposit_address_issuances" FORCE ROW LEVEL SECURITY;
ALTER TABLE "customer_deposit_address_request_keys" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "customer_deposit_address_request_keys" FORCE ROW LEVEL SECURITY;
