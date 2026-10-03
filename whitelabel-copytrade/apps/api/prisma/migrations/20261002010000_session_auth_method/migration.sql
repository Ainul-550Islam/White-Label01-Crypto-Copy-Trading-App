-- Round 7 D3: record how a session was established, so logout can end the
-- IdP session (OIDC RP-initiated logout) only for sessions an IdP created.
-- Existing rows are password sessions by definition of the default.
ALTER TABLE "user_sessions" ADD COLUMN "auth_method" VARCHAR(16) NOT NULL DEFAULT 'PASSWORD';
ALTER TABLE "user_sessions" ADD COLUMN "sso_configuration_id" UUID;
