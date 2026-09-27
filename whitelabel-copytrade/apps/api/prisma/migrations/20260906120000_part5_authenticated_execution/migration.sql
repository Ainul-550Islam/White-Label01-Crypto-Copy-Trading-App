-- =============================================================================
-- Part 5 - authenticated execution
-- =============================================================================
-- Additive only. Every new column on an existing table is either nullable or
-- carries a default, so this migration applies to a populated production
-- database without a table rewrite lock on the hot path and without a backfill.
--
-- The four DROP NOT NULL statements on trading_accounts widen the credential
-- columns. Widening is safe: every existing row keeps its ciphertext and its
-- credential_source defaults to ENVELOPE_DB, so existing accounts behave
-- exactly as they did before. Only a newly created SECRET_MANAGER account
-- leaves them null.
--
-- Nothing here is destructive. No column is dropped, no data is rewritten, no
-- existing constraint is tightened.
-- =============================================================================

-- CreateEnum
CREATE TYPE "CredentialSource" AS ENUM ('ENVELOPE_DB', 'SECRET_MANAGER', 'ENVIRONMENT');

-- CreateEnum
CREATE TYPE "OrderReconciliationState" AS ENUM ('IN_SYNC', 'UNKNOWN', 'PENDING_RECONCILIATION', 'DIVERGED');

-- CreateEnum
CREATE TYPE "FillSource" AS ENUM ('PRIVATE_STREAM', 'ORDER_RESPONSE', 'RECONCILIATION', 'SIMULATOR');

-- CreateEnum
CREATE TYPE "StreamSessionStatus" AS ENUM ('CONNECTING', 'CONNECTED', 'RECONNECTING', 'DISCONNECTED', 'KEY_EXPIRED', 'FAILED', 'STOPPED');

-- CreateEnum
CREATE TYPE "ReconciliationRunStatus" AS ENUM ('RUNNING', 'COMPLETED', 'SKIPPED', 'FAILED');

-- CreateEnum
CREATE TYPE "ReconciliationDiscrepancyType" AS ENUM ('ORDER_STATUS_MISMATCH', 'ORDER_MISSING_LOCALLY', 'ORDER_MISSING_AT_VENUE', 'MISSED_FILL', 'QUANTITY_MISMATCH', 'BALANCE_MISMATCH', 'POSITION_MISMATCH', 'UNKNOWN_ORDER_RESOLVED', 'UNKNOWN_ORDER_NEVER_PLACED');

-- CreateEnum
CREATE TYPE "ExecutionIncidentType" AS ENUM ('UNKNOWN_ORDER_RESULT', 'ORDER_STATE_MISMATCH', 'MISSING_FILL', 'UNEXPECTED_ORDER', 'BALANCE_MISMATCH', 'POSITION_MISMATCH', 'ILLEGAL_TRANSITION', 'CREDENTIAL_FAILURE', 'CLOCK_SKEW', 'PRIVATE_STREAM_FAILURE', 'RATE_LIMIT_BREACH', 'RECONCILIATION_FAILURE', 'SAFETY_GATE_BLOCK');

-- CreateEnum
CREATE TYPE "ExecutionIncidentSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- AlterTable
ALTER TABLE "trading_accounts" ADD COLUMN     "credential_expires_at" TIMESTAMPTZ(6),
ADD COLUMN     "credential_ref" VARCHAR(512),
ADD COLUMN     "credential_rotated_at" TIMESTAMPTZ(6),
ADD COLUMN     "credential_source" "CredentialSource" NOT NULL DEFAULT 'ENVELOPE_DB',
ADD COLUMN     "live_trading_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "private_stream_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "verified_permissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
ALTER COLUMN "api_key_ciphertext" DROP NOT NULL,
ALTER COLUMN "api_secret_ciphertext" DROP NOT NULL,
ALTER COLUMN "encrypted_data_key" DROP NOT NULL,
ALTER COLUMN "encryption_key_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "last_reconciled_at" TIMESTAMPTZ(6),
ADD COLUMN     "metadata" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "reconciliation_detail" VARCHAR(500),
ADD COLUMN     "reconciliation_state" "OrderReconciliationState" NOT NULL DEFAULT 'IN_SYNC',
ADD COLUMN     "was_dry_run" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "fills" ADD COLUMN     "exchange_order_id" VARCHAR(64),
ADD COLUMN     "quote_quantity" DECIMAL(28,12),
ADD COLUMN     "side" "OrderSideEnum",
ADD COLUMN     "source" "FillSource" NOT NULL DEFAULT 'PRIVATE_STREAM',
ADD COLUMN     "symbol" VARCHAR(32),
ADD COLUMN     "venue" "TradingVenue";

-- CreateTable
CREATE TABLE "account_balance_snapshots" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "asset" VARCHAR(24) NOT NULL,
    "free" DECIMAL(28,12) NOT NULL DEFAULT 0,
    "locked" DECIMAL(28,12) NOT NULL DEFAULT 0,
    "total" DECIMAL(28,12) NOT NULL DEFAULT 0,
    "venue_updated_at_micros" BIGINT,
    "observed_at_micros" BIGINT NOT NULL,
    "is_simulated" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "account_balance_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exchange_stream_sessions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "venue" "TradingVenue" NOT NULL,
    "status" "StreamSessionStatus" NOT NULL DEFAULT 'CONNECTING',
    "listen_key_masked" VARCHAR(32),
    "listen_key_created_at" TIMESTAMPTZ(6),
    "listen_key_renewed_at" TIMESTAMPTZ(6),
    "listen_key_renewals" INTEGER NOT NULL DEFAULT 0,
    "listen_key_renewal_failures" INTEGER NOT NULL DEFAULT 0,
    "connected_at" TIMESTAMPTZ(6),
    "disconnected_at" TIMESTAMPTZ(6),
    "last_event_at" TIMESTAMPTZ(6),
    "reconnect_count" INTEGER NOT NULL DEFAULT 0,
    "events_received" INTEGER NOT NULL DEFAULT 0,
    "execution_reports" INTEGER NOT NULL DEFAULT 0,
    "parse_errors" INTEGER NOT NULL DEFAULT 0,
    "last_reconciled_at" TIMESTAMPTZ(6),
    "worker_id" VARCHAR(128) NOT NULL,
    "last_error_code" VARCHAR(64),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "exchange_stream_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconciliation_runs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "venue" "TradingVenue" NOT NULL,
    "status" "ReconciliationRunStatus" NOT NULL DEFAULT 'RUNNING',
    "trigger" VARCHAR(32) NOT NULL DEFAULT 'SCHEDULED',
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(6),
    "duration_micros" BIGINT,
    "orders_checked" INTEGER NOT NULL DEFAULT 0,
    "fills_recovered" INTEGER NOT NULL DEFAULT 0,
    "discrepancies_found" INTEGER NOT NULL DEFAULT 0,
    "discrepancies_repaired" INTEGER NOT NULL DEFAULT 0,
    "error" VARCHAR(500),
    "worker_id" VARCHAR(128) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reconciliation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconciliation_discrepancies" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "order_id" UUID,
    "discrepancy_type" "ReconciliationDiscrepancyType" NOT NULL,
    "symbol" VARCHAR(32),
    "client_order_id" VARCHAR(36),
    "local_value" VARCHAR(120),
    "venue_value" VARCHAR(120),
    "summary" VARCHAR(1000) NOT NULL,
    "repaired" BOOLEAN NOT NULL DEFAULT false,
    "detected_at_micros" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reconciliation_discrepancies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "execution_incidents" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "account_id" UUID,
    "order_id" UUID,
    "incident_type" "ExecutionIncidentType" NOT NULL,
    "severity" "ExecutionIncidentSeverity" NOT NULL DEFAULT 'WARNING',
    "venue" "TradingVenue",
    "symbol" VARCHAR(32),
    "client_order_id" VARCHAR(36),
    "error_code" VARCHAR(64),
    "summary" VARCHAR(1000) NOT NULL,
    "details" JSONB NOT NULL DEFAULT '{}',
    "occurred_at_micros" BIGINT NOT NULL,
    "resolved_at" TIMESTAMPTZ(6),
    "resolved_by" UUID,
    "resolution_note" VARCHAR(1000),
    "notified_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "execution_incidents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "account_balance_snapshots_tenant_id_account_id_idx" ON "account_balance_snapshots"("tenant_id", "account_id");

-- CreateIndex
CREATE INDEX "account_balance_snapshots_tenant_id_asset_idx" ON "account_balance_snapshots"("tenant_id", "asset");

-- CreateIndex
CREATE INDEX "account_balance_snapshots_observed_at_micros_idx" ON "account_balance_snapshots"("observed_at_micros");

-- CreateIndex
CREATE UNIQUE INDEX "account_balance_snapshots_account_id_asset_key" ON "account_balance_snapshots"("account_id", "asset");

-- CreateIndex
CREATE INDEX "exchange_stream_sessions_tenant_id_account_id_status_idx" ON "exchange_stream_sessions"("tenant_id", "account_id", "status");

-- CreateIndex
CREATE INDEX "exchange_stream_sessions_tenant_id_status_idx" ON "exchange_stream_sessions"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "exchange_stream_sessions_last_event_at_idx" ON "exchange_stream_sessions"("last_event_at");

-- CreateIndex
CREATE INDEX "reconciliation_runs_tenant_id_account_id_started_at_idx" ON "reconciliation_runs"("tenant_id", "account_id", "started_at");

-- CreateIndex
CREATE INDEX "reconciliation_runs_tenant_id_status_started_at_idx" ON "reconciliation_runs"("tenant_id", "status", "started_at");

-- CreateIndex
CREATE INDEX "reconciliation_runs_started_at_idx" ON "reconciliation_runs"("started_at");

-- CreateIndex
CREATE INDEX "reconciliation_discrepancies_tenant_id_discrepancy_type_cre_idx" ON "reconciliation_discrepancies"("tenant_id", "discrepancy_type", "created_at");

-- CreateIndex
CREATE INDEX "reconciliation_discrepancies_run_id_idx" ON "reconciliation_discrepancies"("run_id");

-- CreateIndex
CREATE INDEX "reconciliation_discrepancies_order_id_idx" ON "reconciliation_discrepancies"("order_id");

-- CreateIndex
CREATE INDEX "reconciliation_discrepancies_tenant_id_repaired_created_at_idx" ON "reconciliation_discrepancies"("tenant_id", "repaired", "created_at");

-- CreateIndex
CREATE INDEX "execution_incidents_tenant_id_severity_created_at_idx" ON "execution_incidents"("tenant_id", "severity", "created_at");

-- CreateIndex
CREATE INDEX "execution_incidents_tenant_id_incident_type_created_at_idx" ON "execution_incidents"("tenant_id", "incident_type", "created_at");

-- CreateIndex
CREATE INDEX "execution_incidents_tenant_id_account_id_created_at_idx" ON "execution_incidents"("tenant_id", "account_id", "created_at");

-- CreateIndex
CREATE INDEX "execution_incidents_tenant_id_resolved_at_severity_idx" ON "execution_incidents"("tenant_id", "resolved_at", "severity");

-- CreateIndex
CREATE INDEX "execution_incidents_order_id_idx" ON "execution_incidents"("order_id");

-- CreateIndex
CREATE INDEX "execution_incidents_created_at_idx" ON "execution_incidents"("created_at");

-- CreateIndex
CREATE INDEX "orders_reconciliation_state_last_reconciled_at_idx" ON "orders"("reconciliation_state", "last_reconciled_at");

-- CreateIndex
CREATE INDEX "orders_tenant_id_account_id_reconciliation_state_idx" ON "orders"("tenant_id", "account_id", "reconciliation_state");

-- CreateIndex
CREATE INDEX "fills_exchange_order_id_idx" ON "fills"("exchange_order_id");

-- CreateIndex
CREATE INDEX "fills_symbol_received_timestamp_micros_idx" ON "fills"("symbol", "received_timestamp_micros");

-- AddForeignKey
ALTER TABLE "account_balance_snapshots" ADD CONSTRAINT "account_balance_snapshots_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_balance_snapshots" ADD CONSTRAINT "account_balance_snapshots_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "trading_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exchange_stream_sessions" ADD CONSTRAINT "exchange_stream_sessions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exchange_stream_sessions" ADD CONSTRAINT "exchange_stream_sessions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "trading_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_runs" ADD CONSTRAINT "reconciliation_runs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_runs" ADD CONSTRAINT "reconciliation_runs_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "trading_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_discrepancies" ADD CONSTRAINT "reconciliation_discrepancies_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "reconciliation_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_discrepancies" ADD CONSTRAINT "reconciliation_discrepancies_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "execution_incidents" ADD CONSTRAINT "execution_incidents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "execution_incidents" ADD CONSTRAINT "execution_incidents_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "trading_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "execution_incidents" ADD CONSTRAINT "execution_incidents_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

