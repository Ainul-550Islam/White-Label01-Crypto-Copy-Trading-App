-- A trading operator may act on another customer's account. Account ownership
-- must remain stable from admission through routing: a queued intent cannot be
-- moved to a different customer after that customer's risk and compliance
-- checks were made. New intents and observed canonical orders take a SHARE
-- lock on the account row; a transfer takes the conflicting row lock first.
-- This applies to older writers too, not just the current OMS service.
-- A transaction without tenant RLS context must not mistake hidden activity
-- for an empty account. Roles with explicit BYPASSRLS/superuser are exempt.
BEGIN;
LOCK TABLE "trading_accounts", "oms_order_intents", "orders" IN SHARE ROW EXCLUSIVE MODE;

CREATE FUNCTION wlct_order_owner_assert_scope(p_tenant uuid) RETURNS void
LANGUAGE plpgsql VOLATILE AS $$
DECLARE may_bypass boolean;
BEGIN
  SELECT r.rolsuper OR r.rolbypassrls INTO may_bypass FROM pg_roles r WHERE r.rolname = current_user;
  IF NOT COALESCE(may_bypass, false) AND
     NULLIF(current_setting('app.tenant_id', true), '') IS DISTINCT FROM p_tenant::text THEN
    RAISE EXCEPTION 'Tenant context is required for order ownership checks' USING ERRCODE = 'check_violation';
  END IF;
  -- Advisory/row locks cannot refresh a REPEATABLE READ snapshot. Do not let
  -- a stale snapshot be interpreted as proof that there are no active orders.
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'Order ownership checks require read committed isolation' USING ERRCODE = 'check_violation';
  END IF;
END $$;

CREATE FUNCTION wlct_order_owner_lock_account(p_tenant uuid, p_account uuid) RETURNS void
LANGUAGE plpgsql VOLATILE AS $$
BEGIN
  PERFORM wlct_order_owner_assert_scope(p_tenant);
  PERFORM 1 FROM "trading_accounts" a
    WHERE a.id = p_account AND a.tenant_id = p_tenant AND a.deleted_at IS NULL FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Trading account ownership is unavailable' USING ERRCODE = 'check_violation';
  END IF;
END $$;

CREATE FUNCTION wlct_oms_owner_binding_guard() RETURNS trigger
LANGUAGE plpgsql VOLATILE AS $$
DECLARE old_unresolved boolean; new_active boolean;
BEGIN
  new_active := NEW.state IN ('CREATED', 'VALIDATING', 'APPROVED', 'SUBMITTED', 'ACKNOWLEDGED',
    'PARTIALLY_FILLED', 'CANCEL_REQUESTED', 'FAILED', 'RECONCILIATION_REQUIRED', 'REPLACED');
  IF TG_OP = 'UPDATE' THEN
    old_unresolved := wlct_copy_intent_unresolved(OLD);
    IF old_unresolved AND (OLD.tenant_id IS DISTINCT FROM NEW.tenant_id OR OLD.account_id IS DISTINCT FROM NEW.account_id
      OR OLD.client_order_id IS DISTINCT FROM NEW.client_order_id) THEN
      RAISE EXCEPTION 'Unresolved intent ownership cannot be changed' USING ERRCODE = 'check_violation';
    END IF;
    -- Progressing an existing reservation must not obstruct cancellation or
    -- reconciliation. Only an inserted or reactivated reservation needs a new
    -- account lock; the existing reservation already blocks transfers.
    IF old_unresolved OR NOT new_active THEN RETURN NEW; END IF;
  ELSIF NOT new_active THEN
    RETURN NEW;
  END IF;
  PERFORM wlct_order_owner_lock_account(NEW.tenant_id, NEW.account_id);
  RETURN NEW;
END $$;
CREATE TRIGGER account_order_owner_binding
BEFORE INSERT OR UPDATE OF tenant_id, account_id, client_order_id, state ON "oms_order_intents"
FOR EACH ROW EXECUTE FUNCTION wlct_oms_owner_binding_guard();

CREATE FUNCTION wlct_canonical_order_owner_binding_guard() RETURNS trigger
LANGUAGE plpgsql VOLATILE AS $$
DECLARE old_unresolved boolean; new_unresolved boolean;
BEGIN
  new_unresolved := NEW.status IN ('PENDING', 'SUBMITTED', 'ACKNOWLEDGED', 'PARTIALLY_FILLED', 'CANCEL_REQUESTED', 'FAILED')
    OR NEW.reconciliation_state <> 'IN_SYNC';
  IF TG_OP = 'UPDATE' THEN
    old_unresolved := OLD.status IN ('PENDING', 'SUBMITTED', 'ACKNOWLEDGED', 'PARTIALLY_FILLED', 'CANCEL_REQUESTED', 'FAILED')
      OR OLD.reconciliation_state <> 'IN_SYNC';
    IF old_unresolved AND (OLD.tenant_id IS DISTINCT FROM NEW.tenant_id OR OLD.account_id IS DISTINCT FROM NEW.account_id
      OR OLD.client_order_id IS DISTINCT FROM NEW.client_order_id) THEN
      RAISE EXCEPTION 'Unresolved canonical order ownership cannot be changed' USING ERRCODE = 'check_violation';
    END IF;
    IF old_unresolved OR NOT new_unresolved THEN RETURN NEW; END IF;
  ELSIF NOT new_unresolved THEN
    RETURN NEW;
  END IF;
  -- External orders must remain ingestible even if they exceed a policy: an
  -- observed venue order is evidence, not a new platform authorization.
  PERFORM wlct_order_owner_lock_account(NEW.tenant_id, NEW.account_id);
  RETURN NEW;
END $$;
CREATE TRIGGER account_canonical_order_owner_binding
BEFORE INSERT OR UPDATE OF tenant_id, account_id, client_order_id, status, reconciliation_state ON "orders"
FOR EACH ROW EXECUTE FUNCTION wlct_canonical_order_owner_binding_guard();

CREATE FUNCTION wlct_account_owner_transfer_active_orders_guard() RETURNS trigger
LANGUAGE plpgsql VOLATILE AS $$
BEGIN
  IF OLD.tenant_id IS NOT DISTINCT FROM NEW.tenant_id AND OLD.user_id IS NOT DISTINCT FROM NEW.user_id
     AND NOT (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL) THEN RETURN NEW; END IF;
  PERFORM wlct_order_owner_assert_scope(OLD.tenant_id);
  IF EXISTS (SELECT 1 FROM "oms_order_intents" i
      WHERE i.tenant_id = OLD.tenant_id AND i.account_id = OLD.id AND wlct_copy_intent_unresolved(i))
    OR EXISTS (SELECT 1 FROM "orders" o WHERE o.tenant_id = OLD.tenant_id AND o.account_id = OLD.id
      AND (o.status IN ('PENDING', 'SUBMITTED', 'ACKNOWLEDGED', 'PARTIALLY_FILLED', 'CANCEL_REQUESTED', 'FAILED')
        OR o.reconciliation_state <> 'IN_SYNC')) THEN
    RAISE EXCEPTION 'Resolve active orders before changing account ownership' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER account_owner_transfer_active_orders_guard
BEFORE UPDATE OF tenant_id, user_id, deleted_at ON "trading_accounts"
FOR EACH ROW EXECUTE FUNCTION wlct_account_owner_transfer_active_orders_guard();

-- Erasing an unresolved reservation or account would otherwise hide a queued
-- order from the transfer guard. Deliberate cleanup must first establish a
-- terminal, reconciled state; a tenant cascade is not a substitute for that.
CREATE FUNCTION wlct_oms_owner_delete_guard() RETURNS trigger
LANGUAGE plpgsql VOLATILE AS $$
BEGIN
  PERFORM wlct_order_owner_assert_scope(OLD.tenant_id);
  IF wlct_copy_intent_unresolved(OLD) THEN
    RAISE EXCEPTION 'Resolve the order intent before deletion' USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER account_oms_owner_delete_guard BEFORE DELETE ON "oms_order_intents"
FOR EACH ROW EXECUTE FUNCTION wlct_oms_owner_delete_guard();

CREATE FUNCTION wlct_order_owner_delete_guard() RETURNS trigger
LANGUAGE plpgsql VOLATILE AS $$
BEGIN
  PERFORM wlct_order_owner_assert_scope(OLD.tenant_id);
  IF OLD.status IN ('PENDING', 'SUBMITTED', 'ACKNOWLEDGED', 'PARTIALLY_FILLED', 'CANCEL_REQUESTED', 'FAILED')
      OR OLD.reconciliation_state <> 'IN_SYNC' THEN
    RAISE EXCEPTION 'Resolve the canonical order before deletion' USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER account_canonical_owner_delete_guard BEFORE DELETE ON "orders"
FOR EACH ROW EXECUTE FUNCTION wlct_order_owner_delete_guard();

CREATE FUNCTION wlct_account_owner_delete_guard() RETURNS trigger
LANGUAGE plpgsql VOLATILE AS $$
BEGIN
  PERFORM wlct_order_owner_assert_scope(OLD.tenant_id);
  IF EXISTS (SELECT 1 FROM "oms_order_intents" i
      WHERE i.tenant_id = OLD.tenant_id AND i.account_id = OLD.id AND wlct_copy_intent_unresolved(i))
    OR EXISTS (SELECT 1 FROM "orders" o WHERE o.tenant_id = OLD.tenant_id AND o.account_id = OLD.id
      AND (o.status IN ('PENDING', 'SUBMITTED', 'ACKNOWLEDGED', 'PARTIALLY_FILLED', 'CANCEL_REQUESTED', 'FAILED')
        OR o.reconciliation_state <> 'IN_SYNC')) THEN
    RAISE EXCEPTION 'Resolve active orders before deleting the account' USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER account_owner_delete_guard BEFORE DELETE ON "trading_accounts"
FOR EACH ROW EXECUTE FUNCTION wlct_account_owner_delete_guard();
COMMIT;
