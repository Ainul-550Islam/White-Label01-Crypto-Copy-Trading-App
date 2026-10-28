-- Login anomaly reads/writes now set the transaction-local tenant. The older
-- account_recovery_tokens table has no current application writer; keep its
-- legacy secrets isolated rather than leaving the table publicly readable.
-- Roll out tenant-aware writers before this migration and drain old workers.
-- The composite FKs intentionally fail migration if existing rows point at a
-- user from another tenant. Repair those rows explicitly; do not guess an owner.
BEGIN;
CREATE UNIQUE INDEX "users_tenant_id_id_batch02_key" ON "users" ("tenant_id", "id");

ALTER TABLE "login_devices" DROP CONSTRAINT "login_devices_user_id_fkey";
ALTER TABLE "login_devices" ADD CONSTRAINT "login_devices_tenant_user_batch02_fkey"
  FOREIGN KEY ("tenant_id", "user_id") REFERENCES "users" ("tenant_id", "id")
  ON DELETE CASCADE ON UPDATE RESTRICT;
ALTER TABLE "account_recovery_tokens" DROP CONSTRAINT "account_recovery_tokens_user_id_fkey";
ALTER TABLE "account_recovery_tokens" ADD CONSTRAINT "account_recovery_tokens_tenant_user_batch02_fkey"
  FOREIGN KEY ("tenant_id", "user_id") REFERENCES "users" ("tenant_id", "id")
  ON DELETE CASCADE ON UPDATE RESTRICT;

CREATE POLICY login_device_tenant_isolation ON "login_devices"
  AS PERMISSIVE FOR ALL TO PUBLIC
  USING (tenant_id = wlct_current_tenant_id()) WITH CHECK (tenant_id = wlct_current_tenant_id());
ALTER TABLE "login_devices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "login_devices" FORCE ROW LEVEL SECURITY;

CREATE POLICY account_recovery_token_tenant_isolation ON "account_recovery_tokens"
  AS PERMISSIVE FOR ALL TO PUBLIC
  USING (tenant_id = wlct_current_tenant_id()) WITH CHECK (tenant_id = wlct_current_tenant_id());
ALTER TABLE "account_recovery_tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "account_recovery_tokens" FORCE ROW LEVEL SECURITY;
COMMIT;
