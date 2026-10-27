CREATE TABLE "mobile_push_devices" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "session_id" UUID NOT NULL REFERENCES "user_sessions"("id") ON DELETE CASCADE,
  "platform" VARCHAR(8) NOT NULL CHECK ("platform" IN ('FCM', 'APNS')),
  "token_hash" VARCHAR(128) NOT NULL,
  "token_sealed" JSONB NOT NULL,
  "revoked_at" TIMESTAMPTZ,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mobile_push_device_session_key" UNIQUE ("tenant_id", "user_id", "session_id")
);
CREATE INDEX "mobile_push_device_recipient_idx" ON "mobile_push_devices" ("tenant_id", "user_id", "revoked_at");
ALTER TABLE "mobile_push_devices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mobile_push_devices" FORCE ROW LEVEL SECURITY;
CREATE POLICY "mobile_push_device_tenant_isolation" ON "mobile_push_devices"
 USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
 WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE TABLE "mobile_push_attempts" (
  "tenant_id" UUID NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "job_id" VARCHAR(128) NOT NULL,
  "device_id" UUID NOT NULL REFERENCES "mobile_push_devices"("id") ON DELETE CASCADE,
  "state" VARCHAR(16) NOT NULL CHECK ("state" IN ('ACCEPTED','FAILED')),
  "error_code" VARCHAR(64),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("tenant_id", "job_id", "device_id")
);
ALTER TABLE "mobile_push_attempts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mobile_push_attempts" FORCE ROW LEVEL SECURITY;
CREATE POLICY "mobile_push_attempt_tenant_isolation" ON "mobile_push_attempts"
 USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
 WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
