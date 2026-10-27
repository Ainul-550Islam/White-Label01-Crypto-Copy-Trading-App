-- The historical Batch 03 table already exists. The repository now opens a
-- transaction with a tenant-local GUC for every read and mutation.
ALTER TABLE "withdrawal_destinations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "withdrawal_destinations" FORCE ROW LEVEL SECURITY;
CREATE POLICY "withdrawal_destination_tenant_isolation" ON "withdrawal_destinations"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
