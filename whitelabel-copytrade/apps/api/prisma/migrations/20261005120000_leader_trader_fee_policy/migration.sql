-- # Responsibility: creates tenant-scoped, versioned leader fee policies with fee-ceiling and HWM constraints.
CREATE TYPE "LeadTraderHighWaterMarkScope" AS ENUM (
    'PER_TRADER_CURRENCY',
    'PER_FOLLOWER_CURRENCY'
);

CREATE TABLE "leader_fee_policies" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "trader_id" UUID NOT NULL,
    "currency" VARCHAR(4) NOT NULL,
    "profit_share_bps" INTEGER NOT NULL,
    "maximum_share_bps_at_creation" INTEGER NOT NULL,
    "fee_policy_source" VARCHAR(32) NOT NULL,
    "fee_policy_reference" VARCHAR(255),
    "high_water_mark_scope" "LeadTraderHighWaterMarkScope" NOT NULL DEFAULT 'PER_FOLLOWER_CURRENCY',
    "version" INTEGER NOT NULL DEFAULT 1,
    "effective_from" TIMESTAMPTZ(6) NOT NULL,
    "effective_to" TIMESTAMPTZ(6),
    "created_by_user_id" UUID NOT NULL,
    "request_fingerprint" VARCHAR(64) NOT NULL,
    "idempotency_key" VARCHAR(255) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "leader_fee_policies_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "leader_fee_policies_profit_share_bps_check" CHECK ("profit_share_bps" >= 0 AND "profit_share_bps" <= 10000),
    CONSTRAINT "leader_fee_policies_maximum_share_bps_check" CHECK ("maximum_share_bps_at_creation" >= 0 AND "maximum_share_bps_at_creation" <= 10000 AND "profit_share_bps" <= "maximum_share_bps_at_creation"),
    CONSTRAINT "leader_fee_policies_currency_check" CHECK ("currency" = upper("currency")),
    CONSTRAINT "leader_fee_policies_effective_range_check" CHECK ("effective_to" IS NULL OR "effective_to" > "effective_from"),
    CONSTRAINT "leader_fee_policies_version_check" CHECK ("version" >= 1),
    CONSTRAINT "leader_fee_policies_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "leader_fee_policies_trader_id_fkey" FOREIGN KEY ("trader_id") REFERENCES "trader_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "leader_fee_policies_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "leader_fee_policies_tenant_id_idempotency_key_key"
    ON "leader_fee_policies"("tenant_id", "idempotency_key");

CREATE UNIQUE INDEX "leader_fee_policies_tenant_id_trader_id_currency_version_key"
    ON "leader_fee_policies"("tenant_id", "trader_id", "currency", "version");

CREATE INDEX "leader_fee_effective_from_idx"
    ON "leader_fee_policies"("tenant_id", "trader_id", "currency", "effective_from");

CREATE INDEX "leader_fee_effective_to_idx"
    ON "leader_fee_policies"("tenant_id", "trader_id", "currency", "effective_to");
