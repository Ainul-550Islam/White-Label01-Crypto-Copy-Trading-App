-- Durable retry identity for owner-scoped count-limit edits. The intent, audit
-- and policy write commit together under the existing user advisory lock.
-- The API exposes millisecond timestamps as optimistic versions. Ensure that
-- even two writes in the same millisecond (including older SQL writers) never
-- share a version, so a stale form cannot silently overwrite a newer edit.
CREATE FUNCTION wlct_user_position_limit_advance_version() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE old_scope text; new_scope text;
BEGIN
  IF TG_OP <> 'INSERT' THEN old_scope := OLD.tenant_id::text || ':' || OLD.user_id::text; END IF;
  IF TG_OP <> 'DELETE' THEN new_scope := NEW.tenant_id::text || ':' || NEW.user_id::text; END IF;
  IF old_scope IS NOT NULL AND new_scope IS NOT NULL AND old_scope <> new_scope THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('user-position-limits:' || LEAST(old_scope, new_scope), 0));
    PERFORM pg_advisory_xact_lock(hashtextextended('user-position-limits:' || GREATEST(old_scope, new_scope), 0));
  ELSE
    PERFORM pg_advisory_xact_lock(hashtextextended('user-position-limits:' || COALESCE(old_scope, new_scope), 0));
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF TG_OP = 'UPDATE' THEN
    NEW.updated_at := GREATEST(NEW.updated_at, OLD.updated_at + interval '1 millisecond');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER user_position_limit_advance_version
BEFORE INSERT OR UPDATE OR DELETE ON "user_position_limits"
FOR EACH ROW EXECUTE FUNCTION wlct_user_position_limit_advance_version();

-- Ownership changes must serialize with reservation and policy checks for
-- BOTH owners. A transfer otherwise lets an OMS writer measure the previous
-- owner's limits after the account has moved to a stricter owner. A row update
-- takes its row lock before this trigger; the OMS reader takes FOR SHARE on
-- that same row before taking its owner advisory lock. Plain usage SELECTs do
-- not lock other account rows. Uncommitted changes therefore either precede the
-- entire decision or wait for its transaction to commit.
CREATE FUNCTION wlct_user_position_account_owner_lock() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE old_scope text; new_scope text;
BEGIN
  IF TG_OP <> 'INSERT' AND OLD.user_id IS NOT NULL THEN old_scope := OLD.tenant_id::text || ':' || OLD.user_id::text; END IF;
  IF TG_OP <> 'DELETE' AND NEW.user_id IS NOT NULL THEN new_scope := NEW.tenant_id::text || ':' || NEW.user_id::text; END IF;
  IF old_scope IS NOT NULL AND new_scope IS NOT NULL AND old_scope <> new_scope THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('user-position-limits:' || LEAST(old_scope, new_scope), 0));
    PERFORM pg_advisory_xact_lock(hashtextextended('user-position-limits:' || GREATEST(old_scope, new_scope), 0));
  ELSIF COALESCE(old_scope, new_scope) IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('user-position-limits:' || COALESCE(old_scope, new_scope), 0));
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
CREATE TRIGGER user_position_account_owner_lock
BEFORE INSERT OR DELETE OR UPDATE OF tenant_id, user_id, deleted_at ON "trading_accounts"
FOR EACH ROW EXECUTE FUNCTION wlct_user_position_account_owner_lock();

CREATE TABLE "user_position_limit_update_intents" (
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "key_hash" varchar(64) NOT NULL,
  "intent_hash" varchar(64) NOT NULL,
  "created_at" timestamptz(6) NOT NULL DEFAULT now(),
  PRIMARY KEY ("tenant_id", "user_id", "key_hash"),
  CHECK ("key_hash" ~ '^[0-9a-f]{64}$'),
  CHECK ("intent_hash" ~ '^[0-9a-f]{64}$')
);
ALTER TABLE "user_position_limit_update_intents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_position_limit_update_intents" FORCE ROW LEVEL SECURITY;
CREATE POLICY "user_position_limit_update_intents_tenant" ON "user_position_limit_update_intents"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
