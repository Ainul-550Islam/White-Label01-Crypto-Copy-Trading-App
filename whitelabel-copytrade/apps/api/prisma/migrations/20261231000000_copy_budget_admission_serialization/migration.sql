-- Copy admission and all budget/tenant-ceiling writes share these transaction
-- locks. This does not invent exposure or authorize configured-budget orders:
-- it closes the race where a budget is configured between the earlier estimate
-- and OMS intent persistence. Readers take ceiling-shared before owner-exclusive.
CREATE FUNCTION wlct_copy_budget_owner_write_lock() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE old_tenant text; new_tenant text; old_scope text; new_scope text;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    old_tenant := OLD.tenant_id::text; old_scope := old_tenant || ':' || OLD.user_id::text;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    new_tenant := NEW.tenant_id::text; new_scope := new_tenant || ':' || NEW.user_id::text;
  END IF;
  IF old_tenant IS NOT NULL AND new_tenant IS NOT NULL AND old_tenant <> new_tenant THEN
    PERFORM pg_advisory_xact_lock_shared(hashtextextended('copy-budget-ceiling:' || LEAST(old_tenant, new_tenant), 0));
    PERFORM pg_advisory_xact_lock_shared(hashtextextended('copy-budget-ceiling:' || GREATEST(old_tenant, new_tenant), 0));
  ELSE
    PERFORM pg_advisory_xact_lock_shared(hashtextextended('copy-budget-ceiling:' || COALESCE(old_tenant, new_tenant), 0));
  END IF;
  IF old_scope IS NOT NULL AND new_scope IS NOT NULL AND old_scope <> new_scope THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('copy-budget:' || LEAST(old_scope, new_scope), 0));
    PERFORM pg_advisory_xact_lock(hashtextextended('copy-budget:' || GREATEST(old_scope, new_scope), 0));
  ELSE
    PERFORM pg_advisory_xact_lock(hashtextextended('copy-budget:' || COALESCE(old_scope, new_scope), 0));
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
CREATE TRIGGER copy_budget_owner_write_lock
BEFORE INSERT OR UPDATE OR DELETE ON "copy_budgets"
FOR EACH ROW EXECUTE FUNCTION wlct_copy_budget_owner_write_lock();

CREATE FUNCTION wlct_copy_budget_ceiling_write_lock() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE old_tenant text; new_tenant text;
BEGIN
  IF TG_OP <> 'INSERT' AND OLD.key = 'copy_budget.tenant_ceiling' THEN old_tenant := OLD.tenant_id::text; END IF;
  IF TG_OP <> 'DELETE' AND NEW.key = 'copy_budget.tenant_ceiling' THEN new_tenant := NEW.tenant_id::text; END IF;
  IF old_tenant IS NOT NULL AND new_tenant IS NOT NULL AND old_tenant <> new_tenant THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('copy-budget-ceiling:' || LEAST(old_tenant, new_tenant), 0));
    PERFORM pg_advisory_xact_lock(hashtextextended('copy-budget-ceiling:' || GREATEST(old_tenant, new_tenant), 0));
  ELSIF COALESCE(old_tenant, new_tenant) IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('copy-budget-ceiling:' || COALESCE(old_tenant, new_tenant), 0));
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
CREATE TRIGGER copy_budget_ceiling_write_lock
BEFORE INSERT OR UPDATE OR DELETE ON "tenant_settings"
FOR EACH ROW EXECUTE FUNCTION wlct_copy_budget_ceiling_write_lock();
