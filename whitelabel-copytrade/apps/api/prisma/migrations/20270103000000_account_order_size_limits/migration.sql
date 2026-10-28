-- Optional, owner-editable per-account order-size limits. These are separate
-- from (and cannot weaken) existing institutional/account risk policy. An
-- absolute notional cap is enforceable only for a spot BUY LIMIT, whose limit
-- price is a real upper bound. Unknown currency, derivatives, market orders
-- and SELL limits fail closed when a notional cap is configured.
--
-- OMS reservations, platform canonical orders and policy updates share an
-- account-scoped transaction lock. Policy edits are refused while any order
-- may still route or remains unreconciled. Observations imported from a venue
-- are always accepted as evidence and never treated as newly authorized orders.
BEGIN;
LOCK TABLE "trading_accounts", "oms_order_intents", "orders" IN SHARE ROW EXCLUSIVE MODE;

CREATE TABLE "account_order_size_limits" (
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "account_id" uuid NOT NULL REFERENCES "trading_accounts"("id") ON DELETE CASCADE,
  "max_base_quantity" numeric(28,12),
  "max_order_notional" numeric(28,12),
  "notional_currency" varchar(16),
  "revision" uuid NOT NULL DEFAULT gen_random_uuid(),
  "created_at" timestamptz(6) NOT NULL DEFAULT now(),
  "updated_at" timestamptz(6) NOT NULL DEFAULT now(),
  PRIMARY KEY ("tenant_id", "account_id"),
  CONSTRAINT account_order_base_quantity_valid CHECK ("max_base_quantity" IS NULL OR ("max_base_quantity" >= 0 AND "max_base_quantity" <> 'NaN'::numeric)),
  CONSTRAINT account_order_notional_valid CHECK ("max_order_notional" IS NULL OR ("max_order_notional" >= 0 AND "max_order_notional" <> 'NaN'::numeric)),
  CONSTRAINT account_order_currency_valid CHECK (("max_order_notional" IS NULL AND "notional_currency" IS NULL) OR
    ("max_order_notional" IS NOT NULL AND "notional_currency" IS NOT NULL AND "notional_currency" ~ '^[A-Z0-9]{2,16}$'))
);
ALTER TABLE "account_order_size_limits" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "account_order_size_limits" FORCE ROW LEVEL SECURITY;
CREATE POLICY account_order_size_limits_tenant ON "account_order_size_limits"
  USING (tenant_id = wlct_current_tenant_id()) WITH CHECK (tenant_id = wlct_current_tenant_id());

CREATE TABLE "account_order_size_limit_update_intents" (
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "key_hash" varchar(64) NOT NULL CHECK ("key_hash" ~ '^[0-9a-f]{64}$'),
  "intent_hash" varchar(64) NOT NULL CHECK ("intent_hash" ~ '^[0-9a-f]{64}$'),
  "created_at" timestamptz(6) NOT NULL DEFAULT now(),
  PRIMARY KEY ("tenant_id", "user_id", "key_hash")
);
ALTER TABLE "account_order_size_limit_update_intents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "account_order_size_limit_update_intents" FORCE ROW LEVEL SECURITY;
CREATE POLICY account_order_size_limit_update_intents_tenant ON "account_order_size_limit_update_intents"
  USING (tenant_id = wlct_current_tenant_id()) WITH CHECK (tenant_id = wlct_current_tenant_id());

-- AuditLog is shared with platform-wide events and is not covered by the
-- general tenant-policy generator. These narrowly scoped policies allow this
-- action's atomic audit INSERT/RETURNING when a deployment forces RLS on it;
-- they do not expose or authorize any other audit action or tenant.
CREATE POLICY account_order_size_audit_insert ON "audit_logs" FOR INSERT
  WITH CHECK (tenant_id = wlct_current_tenant_id() AND actor_type = 'USER' AND action = 'ACCOUNT_ORDER_SIZE_LIMIT_UPDATED');
CREATE POLICY account_order_size_audit_read ON "audit_logs" FOR SELECT
  USING (tenant_id = wlct_current_tenant_id() AND actor_type = 'USER' AND action = 'ACCOUNT_ORDER_SIZE_LIMIT_UPDATED');

CREATE FUNCTION wlct_account_order_size_lock(p_tenant uuid, p_account uuid) RETURNS void
LANGUAGE plpgsql VOLATILE AS $$
BEGIN
  PERFORM wlct_order_owner_lock_account(p_tenant, p_account);
  PERFORM pg_advisory_xact_lock(hashtextextended('account-order-size:' || p_tenant::text || ':' || p_account::text, 0));
END $$;

-- These trigger functions must see the protected policy and all relevant
-- orders even when a legacy writer has not set the tenant GUC. They execute
-- as the migration owner with row_security=off; if that owner cannot bypass
-- forced RLS, PostgreSQL raises rather than treating hidden rows as absent.
CREATE FUNCTION wlct_account_order_size_policy_guard() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp SET row_security = off AS $$
DECLARE v_tenant uuid; v_account uuid;
BEGIN
  IF TG_OP = 'UPDATE' AND (OLD.tenant_id IS DISTINCT FROM NEW.tenant_id OR OLD.account_id IS DISTINCT FROM NEW.account_id) THEN
    RAISE EXCEPTION 'Account order-limit identity cannot change' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN v_tenant := OLD.tenant_id; v_account := OLD.account_id;
  ELSE v_tenant := NEW.tenant_id; v_account := NEW.account_id; END IF;
  -- During a parent cascade the account no longer exists; active account
  -- deletion itself is already guarded by account_owner_delete_guard.
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM "trading_accounts" a WHERE a.id=v_account AND a.tenant_id=v_tenant) THEN RETURN OLD; END IF;
  PERFORM wlct_account_order_size_lock(v_tenant, v_account);
  IF NOT EXISTS (SELECT 1 FROM "trading_accounts" a WHERE a.id=v_account AND a.tenant_id=v_tenant AND a.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'ACCOUNT_ORDER_LIMIT_ACCOUNT_MISMATCH' USING ERRCODE='check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM "oms_order_intents" i WHERE i.tenant_id=v_tenant AND i.account_id=v_account AND wlct_copy_intent_unresolved(i))
    OR EXISTS (SELECT 1 FROM "orders" o WHERE o.tenant_id=v_tenant AND o.account_id=v_account
      AND (o.status IN ('PENDING', 'SUBMITTED', 'ACKNOWLEDGED', 'PARTIALLY_FILLED', 'CANCEL_REQUESTED', 'FAILED') OR o.reconciliation_state <> 'IN_SYNC')) THEN
    RAISE EXCEPTION 'ACCOUNT_ORDER_LIMIT_ACTIVE_ORDERS' USING ERRCODE='check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF TG_OP = 'UPDATE' THEN NEW.revision := gen_random_uuid(); NEW.updated_at := clock_timestamp(); END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER account_order_size_policy_guard BEFORE INSERT OR UPDATE OR DELETE ON "account_order_size_limits"
FOR EACH ROW EXECUTE FUNCTION wlct_account_order_size_policy_guard();

CREATE FUNCTION wlct_account_order_size_check(p_tenant uuid, p_account uuid, p_symbol text, p_symbol_id uuid,
  p_side text, p_type text, p_quantity text, p_price text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp SET row_security = off AS $$
DECLARE cfg "account_order_size_limits"%ROWTYPE; market text; venue_id uuid; quote text; match_count integer;
BEGIN
  PERFORM wlct_account_order_size_lock(p_tenant, p_account);
  SELECT * INTO cfg FROM "account_order_size_limits" WHERE tenant_id=p_tenant AND account_id=p_account;
  IF NOT FOUND OR (cfg.max_base_quantity IS NULL AND cfg.max_order_notional IS NULL) THEN RETURN; END IF;
  IF p_quantity IS NULL OR p_quantity !~ '^\d{1,16}(\.\d{1,12})?$' OR p_quantity::numeric <= 0 THEN
    RAISE EXCEPTION 'ACCOUNT_ORDER_LIMIT_QUANTITY_UNAVAILABLE' USING ERRCODE='check_violation';
  END IF;
  IF cfg.max_base_quantity IS NOT NULL AND p_quantity::numeric > cfg.max_base_quantity THEN
    RAISE EXCEPTION 'ACCOUNT_ORDER_LIMIT_QUANTITY_EXCEEDED' USING ERRCODE='check_violation';
  END IF;
  IF cfg.max_order_notional IS NULL THEN RETURN; END IF;
  IF p_side <> 'BUY' OR p_type <> 'LIMIT' OR p_price IS NULL OR p_price !~ '^\d{1,16}(\.\d{1,12})?$' OR p_price::numeric <= 0 THEN
    RAISE EXCEPTION 'ACCOUNT_ORDER_LIMIT_NOTIONAL_UNBOUNDED' USING ERRCODE='check_violation';
  END IF;
  SELECT a.market_type::text, a.exchange_id INTO market, venue_id FROM "trading_accounts" a
    WHERE a.tenant_id=p_tenant AND a.id=p_account AND a.deleted_at IS NULL;
  IF market IS DISTINCT FROM 'SPOT' THEN
    RAISE EXCEPTION 'ACCOUNT_ORDER_LIMIT_MARKET_UNVERIFIED' USING ERRCODE='check_violation';
  END IF;
  SELECT count(*), min(s.quote_asset) INTO match_count, quote FROM "trading_symbols" s
    WHERE s.tenant_id=p_tenant AND s.exchange_id=venue_id AND s.market_type::text=market AND s.symbol=p_symbol
      AND (p_symbol_id IS NULL OR s.id=p_symbol_id);
  IF match_count <> 1 OR quote IS DISTINCT FROM cfg.notional_currency THEN
    RAISE EXCEPTION 'ACCOUNT_ORDER_LIMIT_CURRENCY_UNVERIFIED' USING ERRCODE='check_violation';
  END IF;
  -- PostgreSQL numeric multiplication is exact and keeps the full scale.
  IF p_quantity::numeric * p_price::numeric > cfg.max_order_notional THEN
    RAISE EXCEPTION 'ACCOUNT_ORDER_LIMIT_NOTIONAL_EXCEEDED' USING ERRCODE='check_violation';
  END IF;
END $$;
REVOKE ALL ON FUNCTION wlct_account_order_size_check(uuid, uuid, text, uuid, text, text, text, text) FROM PUBLIC;

CREATE FUNCTION wlct_oms_account_order_size_guard() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp SET row_security = off AS $$
DECLARE old_unresolved boolean; new_active boolean; configured boolean;
BEGIN
  new_active := NEW.state IN ('CREATED', 'VALIDATING', 'APPROVED', 'SUBMITTED', 'ACKNOWLEDGED',
    'PARTIALLY_FILLED', 'CANCEL_REQUESTED', 'FAILED', 'RECONCILIATION_REQUIRED', 'REPLACED');
  IF TG_OP = 'UPDATE' THEN
    old_unresolved := wlct_copy_intent_unresolved(OLD);
    IF old_unresolved AND (OLD.symbol IS DISTINCT FROM NEW.symbol OR OLD.side IS DISTINCT FROM NEW.side
      OR OLD.order_type IS DISTINCT FROM NEW.order_type OR OLD.quantity IS DISTINCT FROM NEW.quantity OR OLD.price IS DISTINCT FROM NEW.price) THEN
      PERFORM wlct_account_order_size_lock(OLD.tenant_id, OLD.account_id);
      SELECT EXISTS (SELECT 1 FROM "account_order_size_limits" p WHERE p.tenant_id=OLD.tenant_id AND p.account_id=OLD.account_id
        AND (p.max_base_quantity IS NOT NULL OR p.max_order_notional IS NOT NULL)) INTO configured;
      IF configured THEN RAISE EXCEPTION 'ACCOUNT_ORDER_LIMIT_ACTIVE_INTENT_IMMUTABLE' USING ERRCODE='check_violation'; END IF;
    END IF;
    IF old_unresolved OR NOT new_active THEN RETURN NEW; END IF;
  ELSIF NOT new_active THEN RETURN NEW; END IF;
  PERFORM wlct_account_order_size_check(NEW.tenant_id, NEW.account_id, NEW.symbol, NULL, NEW.side, NEW.order_type, NEW.quantity, NEW.price);
  RETURN NEW;
END $$;
CREATE TRIGGER account_order_size_intent_guard BEFORE INSERT OR UPDATE OF tenant_id, account_id, state, symbol, side, order_type, quantity, price
ON "oms_order_intents" FOR EACH ROW EXECUTE FUNCTION wlct_oms_account_order_size_guard();

CREATE FUNCTION wlct_canonical_account_order_size_guard() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp SET row_security = off AS $$
DECLARE old_active boolean; new_active boolean; platform_order boolean;
BEGIN
  new_active := NEW.status IN ('PENDING', 'SUBMITTED', 'ACKNOWLEDGED', 'PARTIALLY_FILLED', 'CANCEL_REQUESTED', 'FAILED')
    OR NEW.reconciliation_state <> 'IN_SYNC';
  IF TG_OP = 'UPDATE' THEN
    old_active := OLD.status IN ('PENDING', 'SUBMITTED', 'ACKNOWLEDGED', 'PARTIALLY_FILLED', 'CANCEL_REQUESTED', 'FAILED')
      OR OLD.reconciliation_state <> 'IN_SYNC';
    IF old_active OR NOT new_active THEN RETURN NEW; END IF;
  ELSIF NOT new_active THEN RETURN NEW; END IF;
  -- Every new observation takes the lock so edits cannot race past it. Only an
  -- OMS-originated order is an admission decision; venue observations are not.
  PERFORM wlct_account_order_size_lock(NEW.tenant_id, NEW.account_id);
  platform_order := NEW.metadata->>'omsIntent' = 'true' OR NEW.metadata ? 'omsIntentId' OR EXISTS (
    SELECT 1 FROM "oms_order_intents" i WHERE i.tenant_id=NEW.tenant_id AND i.account_id=NEW.account_id AND i.client_order_id=NEW.client_order_id);
  IF platform_order THEN
    PERFORM wlct_account_order_size_check(NEW.tenant_id, NEW.account_id, NEW.symbol, NEW.symbol_id,
      NEW.side::text, NEW.order_type::text, NEW.quantity::text, NEW.price::text);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER account_order_size_canonical_guard BEFORE INSERT OR UPDATE OF tenant_id, account_id, client_order_id, status, reconciliation_state
ON "orders" FOR EACH ROW EXECUTE FUNCTION wlct_canonical_account_order_size_guard();
-- Installed triggers remain effective, but untrusted roles cannot attach these
-- SECURITY DEFINER functions to attacker-controlled relations.
REVOKE ALL ON FUNCTION wlct_account_order_size_policy_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION wlct_oms_account_order_size_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION wlct_canonical_account_order_size_guard() FROM PUBLIC;
COMMIT;
