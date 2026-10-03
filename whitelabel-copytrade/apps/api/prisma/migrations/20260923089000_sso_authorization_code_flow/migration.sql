-- Part 11 - production SSO: OIDC authorization-code flow (state, nonce, PKCE
-- held server-side) and SAML Web-SSO with assertion replay protection.
--
-- * sso_configurations gains the OIDC client secret (envelope-encrypted JSON,
--   never plaintext), token-endpoint auth method, registered redirect URI,
--   PKCE / clock-skew / max-age / algorithm settings and the SAML
--   response-signature switch.
-- * sso_auth_transactions: one row per login attempt. Only hashes of state,
--   nonce, binding secret and SAML hand-off code are stored; the PKCE
--   verifier is envelope-encrypted. UNIQUE(state_hash), UNIQUE(saml_request_id)
--   and UNIQUE(handoff_hash) make every value single-owner; one-time use is
--   enforced by conditional status transitions.
-- * sso_identities: (tenant, provider, issuer, subject) -> user. The
--   verified subject, not the email, is the login key.
-- * sso_assertion_replays: UNIQUE(tenant, issuer, assertion_id) rejects a
--   replayed SAML assertion.
-- * sso_audit_events: durable SSO audit trail (codes and outcomes only; no
--   token, code, assertion, nonce, verifier or secret is ever stored).
--
-- Stamped before 20260923090000_part11_row_level_security so the regenerated
-- RLS migration can attach tenant policies to these tables on a fresh deploy.

-- AlterTable
ALTER TABLE "sso_configurations" ADD COLUMN     "allowed_algorithms" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "client_secret_ciphertext" JSONB,
ADD COLUMN     "clock_skew_sec" INTEGER NOT NULL DEFAULT 60,
ADD COLUMN     "max_auth_age_sec" INTEGER,
ADD COLUMN     "pkce_required" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "redirect_uri" VARCHAR(2048),
ADD COLUMN     "token_endpoint_auth_method" VARCHAR(32) NOT NULL DEFAULT 'client_secret_basic',
ADD COLUMN     "want_response_signed" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "sso_auth_transactions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "configuration_id" UUID NOT NULL,
    "provider_type" "SsoProviderType" NOT NULL,
    "state_hash" VARCHAR(64) NOT NULL,
    "nonce_hash" VARCHAR(64),
    "pkce_verifier_ciphertext" JSONB,
    "binding_hash" VARCHAR(128) NOT NULL,
    "device_id" VARCHAR(128) NOT NULL,
    "redirect_uri" VARCHAR(2048) NOT NULL,
    "return_to" VARCHAR(512),
    "saml_request_id" VARCHAR(128),
    "status" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    "verified_user_id" UUID,
    "handoff_hash" VARCHAR(64),
    "correlation_id" UUID NOT NULL,
    "ip_hash" VARCHAR(64),
    "failure_reason" VARCHAR(64),
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "verified_at" TIMESTAMPTZ(6),
    "consumed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sso_auth_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sso_identities" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "configuration_id" UUID NOT NULL,
    "provider_type" "SsoProviderType" NOT NULL,
    "issuer" VARCHAR(512) NOT NULL,
    "subject" VARCHAR(512) NOT NULL,
    "email_index_at_link" VARCHAR(64),
    "linked_via" VARCHAR(32) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_login_at" TIMESTAMPTZ(6),

    CONSTRAINT "sso_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sso_assertion_replays" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "issuer" VARCHAR(512) NOT NULL,
    "assertion_id" VARCHAR(256) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sso_assertion_replays_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sso_audit_events" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "provider_type" "SsoProviderType",
    "configuration_id" UUID,
    "transaction_id" UUID,
    "user_id" UUID,
    "correlation_id" UUID NOT NULL,
    "event_code" VARCHAR(64) NOT NULL,
    "outcome" VARCHAR(16) NOT NULL,
    "reason_code" VARCHAR(64),
    "ip_hash" VARCHAR(64),
    "safe_metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sso_audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sso_auth_transactions_state_hash_key" ON "sso_auth_transactions"("state_hash");

-- CreateIndex
CREATE UNIQUE INDEX "sso_auth_transactions_saml_request_id_key" ON "sso_auth_transactions"("saml_request_id");

-- CreateIndex
CREATE UNIQUE INDEX "sso_auth_transactions_handoff_hash_key" ON "sso_auth_transactions"("handoff_hash");

-- CreateIndex
CREATE INDEX "sso_auth_transactions_tenant_id_ip_hash_status_expires_at_idx" ON "sso_auth_transactions"("tenant_id", "ip_hash", "status", "expires_at");

-- CreateIndex
CREATE INDEX "sso_auth_transactions_expires_at_idx" ON "sso_auth_transactions"("expires_at");

-- CreateIndex
CREATE INDEX "sso_identities_tenant_id_user_id_idx" ON "sso_identities"("tenant_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "sso_identities_tenant_id_provider_type_issuer_subject_key" ON "sso_identities"("tenant_id", "provider_type", "issuer", "subject");

-- CreateIndex
CREATE UNIQUE INDEX "sso_identities_tenant_id_configuration_id_user_id_key" ON "sso_identities"("tenant_id", "configuration_id", "user_id");

-- CreateIndex
CREATE INDEX "sso_assertion_replays_expires_at_idx" ON "sso_assertion_replays"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "sso_assertion_replays_tenant_id_issuer_assertion_id_key" ON "sso_assertion_replays"("tenant_id", "issuer", "assertion_id");

-- CreateIndex
CREATE INDEX "sso_audit_events_tenant_id_created_at_idx" ON "sso_audit_events"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "sso_audit_events_tenant_id_event_code_created_at_idx" ON "sso_audit_events"("tenant_id", "event_code", "created_at");

-- CreateIndex
CREATE INDEX "sso_audit_events_correlation_id_idx" ON "sso_audit_events"("correlation_id");

-- AddForeignKey
ALTER TABLE "sso_auth_transactions" ADD CONSTRAINT "sso_auth_transactions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sso_auth_transactions" ADD CONSTRAINT "sso_auth_transactions_configuration_id_fkey" FOREIGN KEY ("configuration_id") REFERENCES "sso_configurations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sso_identities" ADD CONSTRAINT "sso_identities_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sso_identities" ADD CONSTRAINT "sso_identities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sso_identities" ADD CONSTRAINT "sso_identities_configuration_id_fkey" FOREIGN KEY ("configuration_id") REFERENCES "sso_configurations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sso_assertion_replays" ADD CONSTRAINT "sso_assertion_replays_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sso_audit_events" ADD CONSTRAINT "sso_audit_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Status values are a closed set (PENDING -> [VERIFIED ->] CONSUMED | REJECTED).
ALTER TABLE "sso_auth_transactions" ADD CONSTRAINT "sso_auth_transactions_status_check"
    CHECK ("status" IN ('PENDING', 'VERIFIED', 'CONSUMED', 'REJECTED'));
