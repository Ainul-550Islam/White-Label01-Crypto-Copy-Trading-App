-- The copy_budgets table was created by Batch 03 but lacked a generated model
-- and a tenant policy. Install the policy without enabling it during a rolling
-- deployment; enable.sql applies FORCE RLS after tenant-aware code is deployed.
CREATE POLICY "copy_budget_tenant_isolation" ON "copy_budgets"
  AS PERMISSIVE FOR ALL TO PUBLIC
  USING ("tenant_id" = wlct_current_tenant_id())
  WITH CHECK ("tenant_id" = wlct_current_tenant_id());
