-- # Responsibility: creates tenant-scoped customer settings for concurrent position and open-order ceilings.
-- GAP-62: exact integer-count limits only; null means unlimited and zero blocks new reservations.

CREATE TABLE "user_position_limits" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "max_concurrent_positions" INTEGER,
    "max_open_orders" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "user_position_limits_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "user_position_limits_max_concurrent_positions_nonnegative"
        CHECK ("max_concurrent_positions" IS NULL OR "max_concurrent_positions" >= 0),
    CONSTRAINT "user_position_limits_max_open_orders_nonnegative"
        CHECK ("max_open_orders" IS NULL OR "max_open_orders" >= 0),
    CONSTRAINT "user_position_limits_tenant_id_fkey"
        FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "user_position_limits_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "user_position_limits_tenant_id_user_id_key"
    ON "user_position_limits"("tenant_id", "user_id");
