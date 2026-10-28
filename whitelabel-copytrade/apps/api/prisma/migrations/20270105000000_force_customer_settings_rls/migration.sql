-- These settings tables are read and written through tenant-scoped
-- transactions. Their existing tenant policies were installed by the Batch 03
-- and Batch 04 policy migrations. Keep their mandatory protection independent
-- of the older Part 11 operator enable/disable pair: that rollback script
-- must not silently disable security on newer customer-facing tables.
-- Deploy only after all instances and legacy writers have been upgraded to
-- set app.tenant_id for these tables; a non-tenant-aware writer fails closed.
BEGIN;
SET LOCAL search_path = pg_catalog, public;
DO $$
DECLARE item record; policy_count integer; matching_count integer;
BEGIN
  FOR item IN SELECT * FROM (VALUES
    ('copy_budgets', 'copy_budget_tenant_isolation'),
    ('user_preferences', 'tenant_isolation')
  ) AS expected(table_name, policy_name)
  LOOP
    SELECT count(*), count(*) FILTER (WHERE p.polname = item.policy_name
      AND p.polpermissive AND p.polcmd = '*' AND p.polroles = ARRAY[0::oid]
      AND pg_get_expr(p.polqual, p.polrelid) = '(tenant_id = wlct_current_tenant_id())'
      AND pg_get_expr(p.polwithcheck, p.polrelid) = '(tenant_id = wlct_current_tenant_id())')
      INTO policy_count, matching_count
      FROM pg_catalog.pg_policy p
      JOIN pg_catalog.pg_class c ON c.oid = p.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = item.table_name;
    IF policy_count <> 1 OR matching_count <> 1 THEN
      RAISE EXCEPTION 'Required tenant policy is missing or ambiguous for %', item.table_name;
    END IF;
  END LOOP;
END $$;
ALTER TABLE "copy_budgets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "copy_budgets" FORCE ROW LEVEL SECURITY;
ALTER TABLE "user_preferences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_preferences" FORCE ROW LEVEL SECURITY;
COMMIT;
