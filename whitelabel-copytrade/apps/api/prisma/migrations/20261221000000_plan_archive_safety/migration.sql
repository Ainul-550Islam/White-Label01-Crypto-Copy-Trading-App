-- Return only the existence of a live subscriber, not tenant details. The
-- definer must actually bypass forced RLS; otherwise this function fails closed.
CREATE FUNCTION "plan_has_live_subscribers"(plan_id UUID) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF row_security_active('public.tenant_subscriptions'::regclass) THEN
    RAISE EXCEPTION 'Global subscription visibility is required' USING ERRCODE = '42501';
  END IF;
  RETURN EXISTS (SELECT 1 FROM public.tenant_subscriptions AS s
    WHERE s.plan_id = plan_has_live_subscribers.plan_id AND s.status::text IN ('TRIALING','ACTIVE','PAST_DUE'));
END;
$$;

-- Every writer, including payments and provisioning, participates in the plan
-- row lock. An archive holds FOR UPDATE, then checks subscribers; a competing
-- insert/change waits and refuses the archived plan after the lock is released.
CREATE FUNCTION "check_subscription_plan_available"() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE plan_row RECORD; is_new_assignment BOOLEAN;
BEGIN
  IF NEW.status::text NOT IN ('TRIALING','ACTIVE','PAST_DUE') THEN RETURN NEW; END IF;
  is_new_assignment := TG_OP = 'INSERT';
  IF TG_OP = 'UPDATE' THEN is_new_assignment := NEW.plan_id IS DISTINCT FROM OLD.plan_id; END IF;
  SELECT id, tenant_id, is_active, deleted_at INTO plan_row
    FROM public.subscription_plans WHERE id = NEW.plan_id FOR SHARE;
  IF NOT FOUND OR plan_row.deleted_at IS NOT NULL OR (is_new_assignment AND NOT plan_row.is_active)
     OR (plan_row.tenant_id IS NOT NULL AND plan_row.tenant_id <> NEW.tenant_id) THEN
    RAISE EXCEPTION 'Subscription plan is unavailable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "tenant_subscription_plan_available"
BEFORE INSERT OR UPDATE OF plan_id, status ON "tenant_subscriptions"
FOR EACH ROW EXECUTE FUNCTION "check_subscription_plan_available"();
