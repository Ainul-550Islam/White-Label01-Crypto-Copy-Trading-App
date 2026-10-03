-- Round 8: SAML Single Logout (SP-initiated and IdP-initiated, HTTP-Redirect binding).
--
-- sso_configurations: the IdP SingleLogoutService URL, our own SingleLogoutService URL, and the
-- SP signing pair (the key envelope-encrypted, write-only; the certificate public). All nullable:
-- a configuration without them keeps working for login and reports SLO as not configured.
ALTER TABLE "sso_configurations" ADD COLUMN "slo_url" VARCHAR(2048);
ALTER TABLE "sso_configurations" ADD COLUMN "logout_callback_url" VARCHAR(2048);
ALTER TABLE "sso_configurations" ADD COLUMN "sp_signing_key_ciphertext" JSONB;
ALTER TABLE "sso_configurations" ADD COLUMN "sp_signing_certificate" TEXT;

-- sso_auth_transactions: the sealed logout context of a verified SAML assertion, carried from the
-- ACS to session issuance (and through the two-factor step).
ALTER TABLE "sso_auth_transactions" ADD COLUMN "saml_logout_context" JSONB;

-- sso_auth_transactions.status stays a closed set and gains LOGOUT_PENDING: an SP-initiated SAML
-- logout round trip is LOGOUT_PENDING -> CONSUMED | REJECTED. Replaces the constraint created by
-- 20260923089000_sso_authorization_code_flow (that migration itself is not modified).
ALTER TABLE "sso_auth_transactions" DROP CONSTRAINT "sso_auth_transactions_status_check";
ALTER TABLE "sso_auth_transactions" ADD CONSTRAINT "sso_auth_transactions_status_check"
    CHECK ("status" IN ('PENDING', 'VERIFIED', 'CONSUMED', 'REJECTED', 'LOGOUT_PENDING'));

-- user_sessions: the sealed logout context of the session's SAML login, plus keyed hashes used to
-- find the sessions named by an IdP-initiated LogoutRequest. Existing sessions have none and are
-- logged out locally only, exactly as before.
ALTER TABLE "user_sessions" ADD COLUMN "sso_logout_context" JSONB;
ALTER TABLE "user_sessions" ADD COLUMN "sso_subject_hash" VARCHAR(128);
ALTER TABLE "user_sessions" ADD COLUMN "sso_session_index_hash" VARCHAR(128);

CREATE INDEX "user_sessions_sso_configuration_id_sso_subject_hash_idx" ON "user_sessions"("sso_configuration_id", "sso_subject_hash");
