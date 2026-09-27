-- Part 8: real-time risk engine control plane.
--
-- Generated with `prisma migrate diff --from-schema-datamodel
-- /tmp/schema_pre_part8.prisma --to-schema-datamodel
-- apps/api/prisma/schema.prisma --script` and reviewed to be strictly
-- additive: CREATE TYPE/CREATE TABLE/CREATE INDEX for the three new
-- tables, ADD COLUMN (all nullable or defaulted) on risk_configurations,
-- risk_events and kill_switches, ALTER TYPE ... ADD VALUE on three
-- existing enums, and one new UNIQUE index on risk_events for idempotent
-- event writes. Nothing drops, renames, or rewrites a column.
--
-- Enum-label caveat, stated because it is a real deployment note rather
-- than boilerplate: PostgreSQL refuses to *use* a newly added enum label
-- in the same transaction that adds it. No statement below does (the new
-- labels are consumed by the engine and the API at runtime, and the two
-- new typed columns use freshly created types), so this migration runs
-- inside Prisma's transaction on PostgreSQL 12+.

-- CreateEnum
CREATE TYPE "RiskSwitchStatus" AS ENUM ('INACTIVE', 'ACTIVE', 'TRIGGERED', 'ACKNOWLEDGED', 'CLEARED');

-- CreateEnum
CREATE TYPE "RiskLimitScope" AS ENUM ('GLOBAL', 'EXCHANGE', 'ACCOUNT', 'STRATEGY', 'SYMBOL');

-- CreateEnum
CREATE TYPE "RiskProtectionAction" AS ENUM ('BLOCK_NEW_RISK', 'BLOCK_SYMBOL', 'BLOCK_STRATEGY', 'BLOCK_ACCOUNT', 'BLOCK_EXCHANGE', 'GLOBAL_TRADING_STOP');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "RiskEventType" ADD VALUE 'KILL_SWITCH_TRIGGERED';
ALTER TYPE "RiskEventType" ADD VALUE 'KILL_SWITCH_ACKNOWLEDGED';
ALTER TYPE "RiskEventType" ADD VALUE 'KILL_SWITCH_CLEARED';
ALTER TYPE "RiskEventType" ADD VALUE 'STALE_RISK_STATE';
ALTER TYPE "RiskEventType" ADD VALUE 'PROTECTION_TRIGGERED';
ALTER TYPE "RiskEventType" ADD VALUE 'PROTECTION_CLEARED';
ALTER TYPE "RiskEventType" ADD VALUE 'PROTECTION_EXEMPTED';
ALTER TYPE "RiskEventType" ADD VALUE 'DAILY_LOSS_BREACHED';
ALTER TYPE "RiskEventType" ADD VALUE 'ORDER_RATE_BREACHED';
ALTER TYPE "RiskEventType" ADD VALUE 'CANCEL_RATE_BREACHED';
ALTER TYPE "RiskEventType" ADD VALUE 'CONSECUTIVE_LOSSES_BREACHED';
ALTER TYPE "RiskEventType" ADD VALUE 'CONFIG_CHANGED';

-- AlterEnum
ALTER TYPE "RiskEventSeverity" ADD VALUE 'EMERGENCY';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "KillSwitchScopeEnum" ADD VALUE 'ACCOUNT';
ALTER TYPE "KillSwitchScopeEnum" ADD VALUE 'RISK';

-- AlterTable
ALTER TABLE "risk_configurations" ADD COLUMN     "allow_risk_reducing_orders" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "config_digest" VARCHAR(64),
ADD COLUMN     "config_version" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "daily_loss_includes_unrealized" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "policy_json" JSONB,
ADD COLUMN     "protection_json" JSONB;

-- AlterTable
ALTER TABLE "risk_events" ADD COLUMN     "action" VARCHAR(32),
ADD COLUMN     "dedupe_key" VARCHAR(64),
ADD COLUMN     "is_simulated" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "rule_id" VARCHAR(64),
ADD COLUMN     "scope" VARCHAR(24),
ADD COLUMN     "scope_target" VARCHAR(64),
ADD COLUMN     "snapshot_version" BIGINT,
ADD COLUMN     "source" VARCHAR(64);

-- AlterTable
ALTER TABLE "kill_switches" ADD COLUMN     "acknowledged_at" TIMESTAMPTZ(6),
ADD COLUMN     "acknowledged_by_user_id" UUID,
ADD COLUMN     "acknowledgement_reason" VARCHAR(500),
ADD COLUMN     "cleared_at" TIMESTAMPTZ(6),
ADD COLUMN     "cleared_by_user_id" UUID,
ADD COLUMN     "cleared_reason" VARCHAR(500),
ADD COLUMN     "requires_explicit_clear" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "status" "RiskSwitchStatus" NOT NULL DEFAULT 'INACTIVE',
ADD COLUMN     "trigger_severity" "RiskEventSeverity",
ADD COLUMN     "triggered_at" TIMESTAMPTZ(6),
ADD COLUMN     "triggered_by_rule" VARCHAR(64);

-- CreateTable
CREATE TABLE "risk_configuration_versions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "digest" VARCHAR(64) NOT NULL,
    "policy_json" JSONB NOT NULL,
    "protection_json" JSONB,
    "changed_by_user_id" UUID NOT NULL,
    "change_reason" VARCHAR(500) NOT NULL,
    "loosened_ceilings" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "risk_configuration_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "risk_snapshot_metadata" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "snapshot_id" VARCHAR(64) NOT NULL,
    "snapshot_version" BIGINT NOT NULL,
    "trading_day" VARCHAR(10) NOT NULL,
    "config_digest" VARCHAR(64),
    "state_digest" VARCHAR(64),
    "equity" DECIMAL(28,8),
    "account_gross_notional" DECIMAL(28,8),
    "net_daily_pnl" DECIMAL(28,8),
    "open_order_count" INTEGER NOT NULL,
    "stale_sources" JSONB,
    "advisories" JSONB,
    "is_complete" BOOLEAN NOT NULL DEFAULT false,
    "is_simulated" BOOLEAN NOT NULL DEFAULT false,
    "captured_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "risk_snapshot_metadata_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "risk_protection_actions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "account_id" UUID,
    "scope" "RiskLimitScope" NOT NULL,
    "target" VARCHAR(64),
    "action" "RiskProtectionAction" NOT NULL,
    "rule_id" VARCHAR(64),
    "reason" VARCHAR(500) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    "triggered_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledged_by_user_id" UUID,
    "acknowledged_at" TIMESTAMPTZ(6),
    "cleared_by_user_id" UUID,
    "cleared_at" TIMESTAMPTZ(6),
    "cleared_reason" VARCHAR(500),
    "snapshot_version" BIGINT,
    "is_simulated" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "risk_protection_actions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "risk_configuration_versions_tenant_id_created_at_idx" ON "risk_configuration_versions"("tenant_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "risk_configuration_versions_account_id_version_key" ON "risk_configuration_versions"("account_id", "version");

-- CreateIndex
CREATE INDEX "risk_snapshot_metadata_tenant_id_captured_at_idx" ON "risk_snapshot_metadata"("tenant_id", "captured_at");

-- CreateIndex
CREATE INDEX "risk_snapshot_metadata_tenant_id_is_complete_captured_at_idx" ON "risk_snapshot_metadata"("tenant_id", "is_complete", "captured_at");

-- CreateIndex
CREATE UNIQUE INDEX "risk_snapshot_metadata_account_id_snapshot_version_key" ON "risk_snapshot_metadata"("account_id", "snapshot_version");

-- CreateIndex
CREATE INDEX "risk_protection_actions_tenant_id_status_triggered_at_idx" ON "risk_protection_actions"("tenant_id", "status", "triggered_at");

-- CreateIndex
CREATE INDEX "risk_protection_actions_tenant_id_account_id_idx" ON "risk_protection_actions"("tenant_id", "account_id");

-- CreateIndex
CREATE UNIQUE INDEX "risk_events_tenant_id_dedupe_key_key" ON "risk_events"("tenant_id", "dedupe_key");

-- AddForeignKey
ALTER TABLE "risk_configuration_versions" ADD CONSTRAINT "risk_configuration_versions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_configuration_versions" ADD CONSTRAINT "risk_configuration_versions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "trading_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_snapshot_metadata" ADD CONSTRAINT "risk_snapshot_metadata_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_snapshot_metadata" ADD CONSTRAINT "risk_snapshot_metadata_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "trading_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_protection_actions" ADD CONSTRAINT "risk_protection_actions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_protection_actions" ADD CONSTRAINT "risk_protection_actions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "trading_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

