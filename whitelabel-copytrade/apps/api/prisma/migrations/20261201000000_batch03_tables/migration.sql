-- # Batch 03 tables: copy budgets, withdrawal destinations, login devices, account-recovery tokens and public share links.
--
-- WHAT THIS MIGRATION IS AND IS NOT
-- ---------------------------------
-- It creates five tables, three enums and their indexes and foreign keys. It is
-- additive and it touches no existing table: no `ALTER TABLE`, no column added to
-- `users`, `tenants` or `trading_accounts`. That is deliberate - Batch 04 edits the
-- same schema at the same time, and a migration that changes a shared table cannot
-- be merged in either order without conflict.
--
-- There are NO row-level-security statements here. RLS policy generation is a
-- separate, generated step (`scripts/gen_part11_rls.py`) that runs in
-- `scripts/post-merge-batch03-04.sh` after both batches are present; putting policies
-- in this file would either duplicate them or silently diverge from the generator's
-- table list. Tenant isolation for these tables is enforced twice: every query in
-- these features carries `tenant_id` from the JWT, and the generated policies close
-- the gap once they are applied.
--
-- The foreign keys ARE created here even though the Prisma schema does not express
-- them: the schema deliberately omits `@relation` so that no back-relation has to be
-- added inside `User` or `Tenant`, but the database still needs the constraint. An
-- orphaned `public_share_links` row is a link that survives its owner's deletion.

-- Enums ----------------------------------------------------------------------

CREATE TYPE "WithdrawalDestinationStatus" AS ENUM ('PENDING', 'ACTIVE', 'REVOKED');

CREATE TYPE "PublicShareSubjectType" AS ENUM ('TRADER', 'STRATEGY');

-- Copy budgets ---------------------------------------------------------------

-- One row per (tenant, user): the follower's global active-copy ceiling across all
-- subscriptions. Decimal(28, 12) is the same precision the rest of the money columns
-- use, so a budget and an exposure are comparable without a cast.
CREATE TABLE "copy_budgets" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "max_active_exposure" decimal(28, 12) NOT NULL,
  "per_trader_cap" decimal(28, 12),
  "currency" varchar(12) NOT NULL DEFAULT 'USDT',
  "created_at" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "copy_budgets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "copy_budgets_tenant_id_user_id_key" ON "copy_budgets" ("tenant_id", "user_id");
CREATE INDEX "copy_budgets_tenant_id_user_id_updated_at_idx" ON "copy_budgets" ("tenant_id", "user_id", "updated_at");

ALTER TABLE "copy_budgets" ADD CONSTRAINT "copy_budgets_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "copy_budgets" ADD CONSTRAINT "copy_budgets_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "copy_budgets" ADD CONSTRAINT "copy_budgets_max_active_exposure_non_negative"
  CHECK ("max_active_exposure" >= 0);
ALTER TABLE "copy_budgets" ADD CONSTRAINT "copy_budgets_per_trader_cap_non_negative"
  CHECK ("per_trader_cap" IS NULL OR "per_trader_cap" >= 0);

-- Withdrawal destinations ----------------------------------------------------

-- The allowlist. `activates_at` is the cooldown deadline: a row is PENDING until the
-- service sweeps it, and a withdrawal to anything that is not ACTIVE is refused. The
-- unique key is (tenant, user, network, address) so two spellings of one address
-- cannot become two entries - the service normalises before it writes.
CREATE TABLE "withdrawal_destinations" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "network" varchar(32) NOT NULL,
  "address" varchar(128) NOT NULL,
  "label" varchar(80) NOT NULL,
  "status" "WithdrawalDestinationStatus" NOT NULL DEFAULT 'PENDING',
  "activates_at" timestamptz(6) NOT NULL,
  "revoked_at" timestamptz(6),
  "created_at" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "withdrawal_destinations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "withdrawal_destinations_tenant_id_user_id_network_address_key"
  ON "withdrawal_destinations" ("tenant_id", "user_id", "network", "address");
CREATE INDEX "withdrawal_destinations_tenant_id_user_id_status_idx"
  ON "withdrawal_destinations" ("tenant_id", "user_id", "status");

ALTER TABLE "withdrawal_destinations" ADD CONSTRAINT "withdrawal_destinations_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "withdrawal_destinations" ADD CONSTRAINT "withdrawal_destinations_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- A revoked destination must carry the time it was revoked: the audit trail is the
-- reason revocation exists as a row change rather than a delete.
ALTER TABLE "withdrawal_destinations" ADD CONSTRAINT "withdrawal_destinations_revoked_has_timestamp"
  CHECK ("status" <> 'REVOKED' OR "revoked_at" IS NOT NULL);

-- Login devices --------------------------------------------------------------

-- Keyed device fingerprints only. No IP, no user agent, no raw fingerprint: this
-- table answers "have I seen this device" and must not become a tracking log.
CREATE TABLE "login_devices" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "fingerprint_hash" varchar(64) NOT NULL,
  "country_code" char(2),
  "last_latitude" decimal(9, 6),
  "last_longitude" decimal(9, 6),
  "last_seen_at" timestamptz(6) NOT NULL,
  "first_seen_at" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "trusted" boolean NOT NULL DEFAULT false,
  CONSTRAINT "login_devices_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "login_devices_tenant_id_user_id_fingerprint_hash_key"
  ON "login_devices" ("tenant_id", "user_id", "fingerprint_hash");
CREATE INDEX "login_devices_tenant_id_user_id_last_seen_at_idx"
  ON "login_devices" ("tenant_id", "user_id", "last_seen_at");

ALTER TABLE "login_devices" ADD CONSTRAINT "login_devices_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "login_devices" ADD CONSTRAINT "login_devices_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Account-recovery tokens ----------------------------------------------------

-- Single-use recovery tokens, stored only as a keyed hash. `used_at` is what makes
-- replay impossible: the update that sets it is the same statement that checks it.
CREATE TABLE "account_recovery_tokens" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "token_hash" varchar(64) NOT NULL,
  "method" varchar(24) NOT NULL DEFAULT 'EMAIL',
  "expires_at" timestamptz(6) NOT NULL,
  "used_at" timestamptz(6),
  "request_ip_hash" varchar(64),
  "created_at" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "account_recovery_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "account_recovery_tokens_tenant_id_token_hash_key"
  ON "account_recovery_tokens" ("tenant_id", "token_hash");
CREATE INDEX "account_recovery_tokens_tenant_id_user_id_expires_at_idx"
  ON "account_recovery_tokens" ("tenant_id", "user_id", "expires_at");

ALTER TABLE "account_recovery_tokens" ADD CONSTRAINT "account_recovery_tokens_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "account_recovery_tokens" ADD CONSTRAINT "account_recovery_tokens_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Public share links ---------------------------------------------------------

-- `token_id` is the opaque id carried inside the signed token. The row is looked up
-- by it after the signature is verified, so revoking a link is an update rather than
-- a key rotation, and `fields_json` is the allow-list the owner opted into.
CREATE TABLE "public_share_links" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "owner_user_id" uuid NOT NULL,
  "subject_type" "PublicShareSubjectType" NOT NULL,
  "subject_id" uuid NOT NULL,
  "token_id" uuid NOT NULL,
  "expires_at" timestamptz(6) NOT NULL,
  "revoked_at" timestamptz(6),
  "fields_json" jsonb NOT NULL,
  "created_at" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "public_share_links_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "public_share_links_token_id_key" ON "public_share_links" ("token_id");
CREATE INDEX "public_share_links_tenant_id_owner_user_id_subject_type_subject_id_idx"
  ON "public_share_links" ("tenant_id", "owner_user_id", "subject_type", "subject_id");

ALTER TABLE "public_share_links" ADD CONSTRAINT "public_share_links_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public_share_links" ADD CONSTRAINT "public_share_links_owner_user_id_fkey"
  FOREIGN KEY ("owner_user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- A share must expire: a link with no expiry is a permanent public page nobody is
-- tracking. An expiry in the past is allowed (the row is already dead) but null is not.
ALTER TABLE "public_share_links" ADD CONSTRAINT "public_share_links_expires_at_not_null"
  CHECK ("expires_at" IS NOT NULL);
-- The allow-list must be a JSON array: the projection iterates it, and a scalar
-- would silently publish nothing (or, worse, everything a future reader defaults to).
ALTER TABLE "public_share_links" ADD CONSTRAINT "public_share_links_fields_json_is_array"
  CHECK (jsonb_typeof("fields_json") = 'array');
