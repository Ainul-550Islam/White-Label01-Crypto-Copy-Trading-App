-- A previously admitted copy intent can still be routed after its admission
-- transaction commits. Until there are exposure-backed reservations, do not
-- activate/change a budget while such intents are in flight. Database guards
-- also protect against application instances that predate the new reader
-- locks. Deployment must drain inconsistent legacy copy intents first; this
-- migration checks with RLS disabled and holds write-blocking table locks until
-- all guards are installed. A migration role unable to bypass RLS fails closed.
BEGIN;
LOCK TABLE "trading_accounts", "copy_budgets", "tenant_settings", "oms_order_intents", "orders" IN SHARE ROW EXCLUSIVE MODE;
SET LOCAL row_security = off;

-- FAILED is not evidence that an ambiguously enqueued job did not execute.
-- REPLACED is settled only once the original canonical order is known closed.
-- Any still-open, failed or unreconciled canonical order keeps its copy intent
-- unresolved regardless of that intent's nominal terminal state.
CREATE FUNCTION wlct_copy_intent_unresolved(i "oms_order_intents") RETURNS boolean
LANGUAGE sql VOLATILE AS $$
  SELECT i.state IN ('CREATED', 'VALIDATING', 'APPROVED', 'SUBMITTED', 'ACKNOWLEDGED', 'PARTIALLY_FILLED', 'CANCEL_REQUESTED', 'FAILED', 'RECONCILIATION_REQUIRED')
    OR EXISTS (SELECT 1 FROM "orders" o WHERE o.tenant_id = i.tenant_id AND o.client_order_id = i.client_order_id
      AND (o.status IN ('PENDING', 'SUBMITTED', 'ACKNOWLEDGED', 'PARTIALLY_FILLED', 'CANCEL_REQUESTED', 'FAILED') OR o.reconciliation_state <> 'IN_SYNC'))
    OR (i.state = 'REPLACED' AND NOT EXISTS (SELECT 1 FROM "orders" o WHERE o.tenant_id = i.tenant_id AND o.client_order_id = i.client_order_id
      AND o.status IN ('FILLED', 'CANCELLED', 'REJECTED', 'EXPIRED') AND o.reconciliation_state = 'IN_SYNC'));
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "oms_order_intents" i
    LEFT JOIN "trading_accounts" a ON a.id = i.account_id AND a.tenant_id = i.tenant_id AND a.deleted_at IS NULL
    WHERE i.source = 'COPY_TRADING'
      AND wlct_copy_intent_unresolved(i)
      AND (a.user_id IS NULL OR i.follower_id IS DISTINCT FROM a.user_id
        OR EXISTS (SELECT 1 FROM "copy_budgets" b WHERE b.tenant_id = i.tenant_id AND b.user_id = a.user_id)
        OR EXISTS (SELECT 1 FROM "tenant_settings" s WHERE s.tenant_id = i.tenant_id AND s.key = 'copy_budget.tenant_ceiling'))
  ) THEN
    RAISE EXCEPTION 'Drain or reconcile active copy intents with configured budgets or inconsistent account ownership before installing the copy-budget guard';
  END IF;
END $$;

-- These guards must see all relevant tenant rows even when legacy writers do
-- not set the tenant GUC. The owner must bypass forced RLS; otherwise reads
-- fail closed instead of mistaking hidden budgets or orders for their absence.
CREATE OR REPLACE FUNCTION wlct_copy_budget_owner_write_lock() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp SET row_security = off AS $$
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
  IF TG_OP <> 'DELETE' AND EXISTS (
    SELECT 1 FROM "oms_order_intents" i
    LEFT JOIN "trading_accounts" a ON a.id = i.account_id AND a.tenant_id = i.tenant_id
    WHERE i.tenant_id = NEW.tenant_id AND i.source = 'COPY_TRADING'
      AND wlct_copy_intent_unresolved(i)
      AND (i.follower_id = NEW.user_id OR a.user_id = NEW.user_id)
  ) THEN
    RAISE EXCEPTION 'Resolve active copy orders before changing this budget' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;

CREATE OR REPLACE FUNCTION wlct_copy_budget_ceiling_write_lock() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp SET row_security = off AS $$
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
  IF new_tenant IS NOT NULL AND EXISTS (
    SELECT 1 FROM "oms_order_intents" i WHERE i.tenant_id = NEW.tenant_id AND i.source = 'COPY_TRADING'
      AND wlct_copy_intent_unresolved(i)
  ) THEN
    RAISE EXCEPTION 'Resolve active copy orders before changing this tenant ceiling' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;

-- Inserts from an older service instance must obey the same budget and owner
-- rules. Only a new, reactivated or re-identified active copy intent is gated;
-- progressing or cancelling an already active intent is never obstructed.
CREATE FUNCTION wlct_copy_order_admission_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp SET row_security = off AS $$
DECLARE account_owner uuid; old_active boolean; new_active boolean;
BEGIN
  new_active := NEW.state IN ('CREATED', 'VALIDATING', 'APPROVED', 'SUBMITTED', 'ACKNOWLEDGED', 'PARTIALLY_FILLED', 'CANCEL_REQUESTED', 'FAILED', 'RECONCILIATION_REQUIRED');
  IF TG_OP = 'UPDATE' THEN
    IF OLD.source = 'COPY_TRADING' THEN
      old_active := wlct_copy_intent_unresolved(OLD);
    ELSE
      old_active := OLD.state IN ('CREATED', 'VALIDATING', 'APPROVED', 'SUBMITTED', 'ACKNOWLEDGED', 'PARTIALLY_FILLED', 'CANCEL_REQUESTED', 'FAILED', 'RECONCILIATION_REQUIRED');
    END IF;
    IF old_active AND OLD.source = 'COPY_TRADING' AND
      (OLD.source IS DISTINCT FROM NEW.source OR OLD.tenant_id IS DISTINCT FROM NEW.tenant_id
       OR OLD.account_id IS DISTINCT FROM NEW.account_id OR OLD.follower_id IS DISTINCT FROM NEW.follower_id) THEN
      RAISE EXCEPTION 'Active copy order ownership and source cannot be changed' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW.source <> 'COPY_TRADING' OR NOT new_active THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF old_active AND OLD.source = NEW.source AND OLD.tenant_id = NEW.tenant_id
      AND OLD.account_id = NEW.account_id AND OLD.follower_id IS NOT DISTINCT FROM NEW.follower_id THEN
      RETURN NEW;
    END IF;
  END IF;
  SELECT a.user_id INTO account_owner FROM "trading_accounts" a
    WHERE a.id = NEW.account_id AND a.tenant_id = NEW.tenant_id AND a.deleted_at IS NULL FOR SHARE;
  IF account_owner IS NULL OR NEW.follower_id IS DISTINCT FROM account_owner THEN
    RAISE EXCEPTION 'Copy follower does not own the trading account' USING ERRCODE = 'check_violation';
  END IF;
  PERFORM pg_advisory_xact_lock_shared(hashtextextended('copy-budget-ceiling:' || NEW.tenant_id::text, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('copy-budget:' || NEW.tenant_id::text || ':' || account_owner::text, 0));
  IF EXISTS (SELECT 1 FROM "copy_budgets" b WHERE b.tenant_id = NEW.tenant_id AND b.user_id = account_owner)
    OR EXISTS (SELECT 1 FROM "tenant_settings" s WHERE s.tenant_id = NEW.tenant_id AND s.key = 'copy_budget.tenant_ceiling') THEN
    RAISE EXCEPTION 'Copy budget exposure and reservations are unverified' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER copy_order_admission_guard
BEFORE INSERT OR UPDATE OF tenant_id, account_id, follower_id, source, state ON "oms_order_intents"
FOR EACH ROW EXECUTE FUNCTION wlct_copy_order_admission_guard();

-- A delayed routing process must not create or reactivate a canonical order
-- for a cancelled intent after a budget has been installed. Lock its OMS row
-- and account before the same tenant/owner locks used by admission.
CREATE FUNCTION wlct_copy_canonical_order_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp SET row_security = off AS $$
DECLARE intent_row "oms_order_intents"%ROWTYPE; account_owner uuid; new_active boolean; old_active boolean;
BEGIN
  new_active := NEW.status IN ('PENDING', 'SUBMITTED', 'ACKNOWLEDGED', 'PARTIALLY_FILLED', 'CANCEL_REQUESTED', 'FAILED');
  IF TG_OP = 'UPDATE' THEN
    old_active := OLD.status IN ('PENDING', 'SUBMITTED', 'ACKNOWLEDGED', 'PARTIALLY_FILLED', 'CANCEL_REQUESTED', 'FAILED');
    IF OLD.tenant_id IS NOT DISTINCT FROM NEW.tenant_id AND OLD.account_id IS NOT DISTINCT FROM NEW.account_id
      AND OLD.client_order_id IS NOT DISTINCT FROM NEW.client_order_id
      AND (OLD.metadata->>'source') IS NOT DISTINCT FROM (NEW.metadata->>'source')
      AND (old_active OR NOT new_active) THEN RETURN NEW; END IF;
  END IF;
  IF NOT new_active THEN RETURN NEW; END IF;
  SELECT i.* INTO intent_row FROM "oms_order_intents" i
    WHERE i.tenant_id = NEW.tenant_id AND i.client_order_id = NEW.client_order_id FOR SHARE;
  IF NOT FOUND THEN
    IF NEW.metadata->>'source' = 'COPY_TRADING' THEN
      RAISE EXCEPTION 'A copy order requires its original intent' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF intent_row.source <> 'COPY_TRADING' THEN RETURN NEW; END IF;
  IF intent_row.account_id IS DISTINCT FROM NEW.account_id OR intent_row.state NOT IN
    ('CREATED', 'VALIDATING', 'APPROVED', 'SUBMITTED', 'ACKNOWLEDGED', 'PARTIALLY_FILLED', 'CANCEL_REQUESTED', 'RECONCILIATION_REQUIRED') THEN
    RAISE EXCEPTION 'Copy intent is not routable' USING ERRCODE = 'check_violation';
  END IF;
  SELECT a.user_id INTO account_owner FROM "trading_accounts" a
    WHERE a.id = NEW.account_id AND a.tenant_id = NEW.tenant_id AND a.deleted_at IS NULL FOR SHARE;
  IF account_owner IS NULL OR intent_row.follower_id IS DISTINCT FROM account_owner THEN
    RAISE EXCEPTION 'Copy follower does not own the trading account' USING ERRCODE = 'check_violation';
  END IF;
  PERFORM pg_advisory_xact_lock_shared(hashtextextended('copy-budget-ceiling:' || NEW.tenant_id::text, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('copy-budget:' || NEW.tenant_id::text || ':' || account_owner::text, 0));
  IF EXISTS (SELECT 1 FROM "copy_budgets" b WHERE b.tenant_id = NEW.tenant_id AND b.user_id = account_owner)
    OR EXISTS (SELECT 1 FROM "tenant_settings" s WHERE s.tenant_id = NEW.tenant_id AND s.key = 'copy_budget.tenant_ceiling') THEN
    RAISE EXCEPTION 'Copy budget exposure and reservations are unverified' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER copy_canonical_order_guard
BEFORE INSERT OR UPDATE OF tenant_id, account_id, client_order_id, metadata, status ON "orders"
FOR EACH ROW EXECUTE FUNCTION wlct_copy_canonical_order_guard();

CREATE FUNCTION wlct_copy_canonical_order_delete_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp SET row_security = off AS $$
BEGIN
  IF (OLD.status IN ('PENDING', 'SUBMITTED', 'ACKNOWLEDGED', 'PARTIALLY_FILLED', 'CANCEL_REQUESTED', 'FAILED')
      OR OLD.reconciliation_state <> 'IN_SYNC') AND EXISTS (
    SELECT 1 FROM "oms_order_intents" i WHERE i.tenant_id = OLD.tenant_id
      AND i.client_order_id = OLD.client_order_id AND i.source = 'COPY_TRADING'
  ) THEN
    RAISE EXCEPTION 'Resolve the copy order before deleting its canonical record' USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER copy_canonical_order_delete_guard BEFORE DELETE ON "orders"
FOR EACH ROW EXECUTE FUNCTION wlct_copy_canonical_order_delete_guard();

-- Deleting an unresolved copy intent must not erase the only evidence that a
-- queued order may still execute. Resolve it first, even during tenant cleanup.
CREATE FUNCTION wlct_copy_order_delete_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp SET row_security = off AS $$
BEGIN
  IF OLD.source = 'COPY_TRADING' AND wlct_copy_intent_unresolved(OLD) THEN
    RAISE EXCEPTION 'Resolve active copy orders before deleting their intents' USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER copy_order_delete_guard BEFORE DELETE ON "oms_order_intents"
FOR EACH ROW EXECUTE FUNCTION wlct_copy_order_delete_guard();

CREATE FUNCTION wlct_copy_order_owner_transfer_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp SET row_security = off AS $$
BEGIN
  IF (OLD.tenant_id IS DISTINCT FROM NEW.tenant_id OR OLD.user_id IS DISTINCT FROM NEW.user_id
      OR (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL)) AND EXISTS (
    SELECT 1 FROM "oms_order_intents" i WHERE i.tenant_id = OLD.tenant_id AND i.account_id = OLD.id
      AND i.source = 'COPY_TRADING'
      AND wlct_copy_intent_unresolved(i)
  ) THEN
    RAISE EXCEPTION 'Resolve active copy orders before changing account ownership' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER copy_order_owner_transfer_guard
BEFORE UPDATE OF tenant_id, user_id, deleted_at ON "trading_accounts"
FOR EACH ROW EXECUTE FUNCTION wlct_copy_order_owner_transfer_guard();

-- A transfer of an already-active account can otherwise introduce positions
-- or orders into a new owner's count-limited scope without any admission. Be
-- conservative until there is a transactional transfer/revaluation workflow:
-- drain relevant activity before transferring into a limited owner or hiding
-- an active limited account by soft deletion.
CREATE OR REPLACE FUNCTION wlct_user_position_account_owner_lock() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp SET row_security = off AS $$
DECLARE old_scope text; new_scope text; max_positions integer; max_orders integer;
BEGIN
  IF TG_OP <> 'INSERT' AND OLD.user_id IS NOT NULL THEN old_scope := OLD.tenant_id::text || ':' || OLD.user_id::text; END IF;
  IF TG_OP <> 'DELETE' AND NEW.user_id IS NOT NULL THEN new_scope := NEW.tenant_id::text || ':' || NEW.user_id::text; END IF;
  IF old_scope IS NOT NULL AND new_scope IS NOT NULL AND old_scope <> new_scope THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('user-position-limits:' || LEAST(old_scope, new_scope), 0));
    PERFORM pg_advisory_xact_lock(hashtextextended('user-position-limits:' || GREATEST(old_scope, new_scope), 0));
  ELSIF COALESCE(old_scope, new_scope) IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('user-position-limits:' || COALESCE(old_scope, new_scope), 0));
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.tenant_id IS DISTINCT FROM NEW.tenant_id THEN
    RAISE EXCEPTION 'Cross-tenant account transfer is not supported' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND (
    (OLD.user_id IS DISTINCT FROM NEW.user_id AND NEW.user_id IS NOT NULL AND NEW.deleted_at IS NULL)
    OR (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL AND OLD.user_id IS NOT NULL)
  ) THEN
    SELECT l.max_concurrent_positions, l.max_open_orders INTO max_positions, max_orders FROM "user_position_limits" l
      WHERE l.tenant_id = NEW.tenant_id AND l.user_id = CASE WHEN NEW.deleted_at IS NOT NULL THEN OLD.user_id ELSE NEW.user_id END;
    IF (max_positions IS NOT NULL AND (
        EXISTS (SELECT 1 FROM "positions" p WHERE p.tenant_id = OLD.tenant_id AND p.account_id = OLD.id AND p.quantity <> 0)
        OR EXISTS (SELECT 1 FROM "oms_trades" t WHERE t.tenant_id = OLD.tenant_id AND t.account_id = OLD.id AND t.state IN ('OPEN', 'PARTIAL', 'RECONCILIATION_REQUIRED'))
      )) OR ((max_positions IS NOT NULL OR max_orders IS NOT NULL) AND (
        EXISTS (SELECT 1 FROM "oms_order_intents" i WHERE i.tenant_id = OLD.tenant_id AND i.account_id = OLD.id
          AND i.state IN ('CREATED', 'VALIDATING', 'APPROVED', 'SUBMITTED', 'ACKNOWLEDGED', 'PARTIALLY_FILLED', 'CANCEL_REQUESTED', 'FAILED', 'RECONCILIATION_REQUIRED'))
        OR EXISTS (SELECT 1 FROM "orders" o WHERE o.tenant_id = OLD.tenant_id AND o.account_id = OLD.id
          AND (o.status IN ('PENDING', 'SUBMITTED', 'ACKNOWLEDGED', 'PARTIALLY_FILLED', 'CANCEL_REQUESTED', 'FAILED') OR o.reconciliation_state <> 'IN_SYNC'))
      )) THEN
      RAISE EXCEPTION 'Resolve account positions and orders before changing a count-limited account scope' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;

-- Only the installed table triggers may invoke these privileged functions.
-- In particular, an untrusted role must not attach them to a crafted table.
REVOKE ALL ON FUNCTION wlct_copy_budget_owner_write_lock() FROM PUBLIC;
REVOKE ALL ON FUNCTION wlct_copy_budget_ceiling_write_lock() FROM PUBLIC;
REVOKE ALL ON FUNCTION wlct_copy_order_admission_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION wlct_copy_canonical_order_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION wlct_copy_canonical_order_delete_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION wlct_copy_order_delete_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION wlct_copy_order_owner_transfer_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION wlct_user_position_account_owner_lock() FROM PUBLIC;
COMMIT;
