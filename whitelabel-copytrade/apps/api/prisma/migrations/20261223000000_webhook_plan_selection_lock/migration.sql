-- A queued webhook may leave the platform only under the tenant's current
-- plan. Locking the currently selected subscription row does not prevent a
-- newer subscription from being inserted (or another row becoming current).
-- All subscription writers take this per-tenant exclusive transaction lock;
-- a dispatcher holds its shared counterpart throughout the bounded send.
-- Multiple dispatchers may still run concurrently for the same tenant.
--
-- The trigger covers every writer, including provisioning and payment sync.
-- UPDATE can change tenant_id, so take both keys in a stable order. Advisory
-- hash collisions only serialize unrelated tenants; they do not weaken safety.
CREATE FUNCTION "lock_developer_subscription_selection"() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE old_key text; new_key text;
BEGIN
  IF TG_OP <> 'INSERT' THEN old_key := OLD.tenant_id::text; END IF;
  IF TG_OP <> 'DELETE' THEN new_key := NEW.tenant_id::text; END IF;

  IF old_key IS NOT NULL AND new_key IS NOT NULL AND old_key <> new_key THEN
    PERFORM pg_advisory_xact_lock(hashtext('wlct.developer.plan-selection'), hashtext(LEAST(old_key, new_key)));
    PERFORM pg_advisory_xact_lock(hashtext('wlct.developer.plan-selection'), hashtext(GREATEST(old_key, new_key)));
  ELSE
    PERFORM pg_advisory_xact_lock(hashtext('wlct.developer.plan-selection'), hashtext(COALESCE(new_key, old_key)));
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "tenant_subscription_developer_selection_lock"
BEFORE INSERT OR UPDATE OR DELETE ON "tenant_subscriptions"
FOR EACH ROW EXECUTE FUNCTION "lock_developer_subscription_selection"();
