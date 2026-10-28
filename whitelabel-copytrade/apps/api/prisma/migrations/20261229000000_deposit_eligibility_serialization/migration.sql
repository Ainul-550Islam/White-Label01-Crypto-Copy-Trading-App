-- Customer address eligibility is checked again at the commit that publishes
-- an address. These transaction locks serialize that decision with *all* SQL
-- writers, including older application instances and administrative writes.
-- They do not certify provider health or connect deposit monitoring.
CREATE FUNCTION wlct_deposit_eligibility_tenant_lock() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE old_tenant text; new_tenant text;
BEGIN
  -- Match the address reader's global-before-tenant order.
  PERFORM pg_advisory_xact_lock_shared(hashtextextended('customer-deposit-eligibility:global', 0));
  IF TG_OP <> 'INSERT' THEN old_tenant := OLD.tenant_id::text; END IF;
  IF TG_OP <> 'DELETE' THEN new_tenant := NEW.tenant_id::text; END IF;
  -- Consistent ordering if a row is ever moved between tenants.
  IF old_tenant IS NOT NULL AND new_tenant IS NOT NULL AND old_tenant <> new_tenant THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('customer-deposit-eligibility:' || LEAST(old_tenant, new_tenant), 0));
    PERFORM pg_advisory_xact_lock(hashtextextended('customer-deposit-eligibility:' || GREATEST(old_tenant, new_tenant), 0));
  ELSE
    PERFORM pg_advisory_xact_lock(hashtextextended('customer-deposit-eligibility:' || COALESCE(new_tenant, old_tenant), 0));
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;

CREATE FUNCTION wlct_deposit_eligibility_global_lock() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('customer-deposit-eligibility:global', 0));
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;

CREATE TRIGGER deposit_eligibility_user
BEFORE DELETE OR UPDATE OF tenant_id, status, deleted_at ON users
FOR EACH ROW EXECUTE FUNCTION wlct_deposit_eligibility_tenant_lock();
CREATE TRIGGER deposit_eligibility_account
BEFORE DELETE OR UPDATE OF tenant_id, client_profile_id, owner_id, owner_type, state, is_funding_enabled, deleted_at ON institutional_accounts
FOR EACH ROW EXECUTE FUNCTION wlct_deposit_eligibility_tenant_lock();
CREATE TRIGGER deposit_eligibility_profile
BEFORE DELETE OR UPDATE OF tenant_id, status, external_identity_ref, deleted_at ON client_profiles
FOR EACH ROW EXECUTE FUNCTION wlct_deposit_eligibility_tenant_lock();
CREATE TRIGGER deposit_eligibility_funding
BEFORE DELETE OR UPDATE OF tenant_id, account_id, client_profile_id, state, currency ON funding_requests
FOR EACH ROW EXECUTE FUNCTION wlct_deposit_eligibility_tenant_lock();
CREATE TRIGGER deposit_eligibility_ownership
BEFORE INSERT OR UPDATE OR DELETE ON account_ownerships
FOR EACH ROW EXECUTE FUNCTION wlct_deposit_eligibility_tenant_lock();
CREATE TRIGGER deposit_eligibility_restriction
BEFORE INSERT OR UPDATE OR DELETE ON account_restrictions
FOR EACH ROW EXECUTE FUNCTION wlct_deposit_eligibility_tenant_lock();
CREATE TRIGGER deposit_eligibility_asset
BEFORE INSERT OR UPDATE OR DELETE ON custody_assets
FOR EACH ROW EXECUTE FUNCTION wlct_deposit_eligibility_global_lock();
CREATE TRIGGER deposit_eligibility_network
BEFORE INSERT OR UPDATE OR DELETE ON custody_networks
FOR EACH ROW EXECUTE FUNCTION wlct_deposit_eligibility_global_lock();
