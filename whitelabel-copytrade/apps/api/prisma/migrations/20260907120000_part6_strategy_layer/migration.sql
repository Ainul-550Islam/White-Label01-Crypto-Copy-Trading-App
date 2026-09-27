-- =============================================================================
-- Part 6 - strategy layer: catalogue, runs, backtests, paper trading
-- =============================================================================
-- Additive only. Nine new tables, seven new enum types, and a set of new
-- columns on two existing tables. Every added column on an existing table is
-- either nullable or carries a default, so this applies to a populated
-- production database without a backfill and without rewriting a hot table.
--
-- Nothing is dropped, no column is removed, no existing constraint is
-- tightened, and no data is rewritten. Running this against the Part 5
-- database leaves every existing row behaving exactly as it did before.
--
-- Two notes on the changes to `strategies`:
--
--   1. `strategies` IS the strategy instance. A separate strategy_instances
--      table was considered and rejected: this table already carries the
--      tenant, the account, the venue, the symbols and the risk profile, and
--      a second table with the same meaning would create two answers to "is
--      this strategy running".
--
--   2. The new unique index on (tenant_id, instance_key) tolerates existing
--      rows because instance_key is nullable and Postgres does not treat two
--      NULLs as equal. Strategies created before Part 6 keep a NULL key until
--      the engine reports one.
--
-- What this migration does NOT create is any path to a live order. These
-- tables record what a strategy decided and what a simulator did with it.
-- Whether anything reaches a venue is still decided by the risk engine and the
-- Part 5 execution gates, none of which read from here.
--
-- BACKTEST PERFORMANCE IS NOT INDICATIVE OF FUTURE PERFORMANCE.
-- PAPER PERFORMANCE IS NOT INDICATIVE OF LIVE PERFORMANCE.
-- SIMULATION DOES NOT GUARANTEE REAL EXECUTION QUALITY.
-- =============================================================================

-- CreateEnum
CREATE TYPE "StrategyVersionStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'DEPRECATED', 'DISABLED');

-- CreateEnum
CREATE TYPE "StrategyFailurePolicy" AS ENUM ('STOP_INSTANCE', 'HALT_ALL');

-- CreateEnum
CREATE TYPE "StrategyHealth" AS ENUM ('UNKNOWN', 'HEALTHY', 'DEGRADED', 'UNHEALTHY', 'QUARANTINED');

-- CreateEnum
CREATE TYPE "StrategyRunStatus" AS ENUM ('STARTING', 'RUNNING', 'STOPPED', 'FAILED', 'HALTED');

-- CreateEnum
CREATE TYPE "StrategyIncidentType" AS ENUM ('STRATEGY_ERROR', 'FEATURE_ERROR', 'SIGNAL_REJECTED_BURST', 'RISK_STATE_UNAVAILABLE', 'PROCESSING_LATENCY_BREACH', 'INSTANCE_QUARANTINED', 'CONFIGURATION_REJECTED', 'CHECKPOINT_FAILURE');

-- CreateEnum
CREATE TYPE "BacktestRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaperSessionStatus" AS ENUM ('STARTING', 'RUNNING', 'STOPPED', 'FAILED');

-- AlterTable
ALTER TABLE "strategies" ADD COLUMN     "config_version" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "consecutive_errors" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "definition_id" UUID,
ADD COLUMN     "failure_policy" "StrategyFailurePolicy" NOT NULL DEFAULT 'STOP_INSTANCE',
ADD COLUMN     "health" "StrategyHealth" NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN     "instance_key" VARCHAR(32),
ADD COLUMN     "last_heartbeat_at" TIMESTAMPTZ(6),
ADD COLUMN     "quarantine_reason" VARCHAR(500),
ADD COLUMN     "quarantined_at" TIMESTAMPTZ(6),
ADD COLUMN     "version_id" UUID;

-- AlterTable
ALTER TABLE "strategy_configurations" ADD COLUMN     "configuration_hash" VARCHAR(64),
ADD COLUMN     "strategy_version_id" UUID;

-- CreateTable
CREATE TABLE "strategy_definitions" (
    "id" UUID NOT NULL,
    "key" VARCHAR(64) NOT NULL,
    "display_name" VARCHAR(120) NOT NULL,
    "description" VARCHAR(1000) NOT NULL,
    "category" VARCHAR(40),
    "is_implemented" BOOLEAN NOT NULL DEFAULT false,
    "is_reserved" BOOLEAN NOT NULL DEFAULT false,
    "risk_notes" VARCHAR(1000) NOT NULL DEFAULT 'No profitability claim is made or implied.',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "strategy_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "strategy_versions" (
    "id" UUID NOT NULL,
    "definition_id" UUID NOT NULL,
    "version" VARCHAR(20) NOT NULL,
    "status" "StrategyVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "implementation_id" VARCHAR(200) NOT NULL,
    "parameter_schema" JSONB NOT NULL DEFAULT '{}',
    "default_parameters" JSONB NOT NULL DEFAULT '{}',
    "behaviour_hash" VARCHAR(64) NOT NULL,
    "change_note" VARCHAR(1000),
    "published_at" TIMESTAMPTZ(6),
    "deprecated_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "strategy_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "strategy_runs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "strategy_id" UUID NOT NULL,
    "run_mode" "TradingModeSetting" NOT NULL DEFAULT 'PAPER',
    "status" "StrategyRunStatus" NOT NULL DEFAULT 'STARTING',
    "instance_key" VARCHAR(32) NOT NULL,
    "config_version" INTEGER NOT NULL,
    "strategy_key" VARCHAR(64) NOT NULL,
    "strategy_version" VARCHAR(20) NOT NULL,
    "venue" "TradingVenue" NOT NULL,
    "symbols" TEXT[],
    "market_type" "TradingMarketType" NOT NULL DEFAULT 'SPOT',
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stopped_at" TIMESTAMPTZ(6),
    "stop_reason" VARCHAR(500),
    "error_code" VARCHAR(64),
    "counters" JSONB NOT NULL DEFAULT '{}',
    "last_event_at_micros" BIGINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "strategy_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "strategy_checkpoints" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "strategy_id" UUID NOT NULL,
    "run_id" UUID,
    "sequence" INTEGER NOT NULL,
    "instance_key" VARCHAR(32) NOT NULL,
    "state" JSONB NOT NULL DEFAULT '{}',
    "state_hash" VARCHAR(64) NOT NULL,
    "captured_at_micros" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "strategy_checkpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "strategy_incidents" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "strategy_id" UUID,
    "run_id" UUID,
    "incident_type" "StrategyIncidentType" NOT NULL,
    "severity" "ExecutionIncidentSeverity" NOT NULL DEFAULT 'WARNING',
    "venue" "TradingVenue",
    "symbol" VARCHAR(32),
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

    CONSTRAINT "strategy_incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "backtest_runs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "requested_by_user_id" UUID,
    "strategy_id" UUID,
    "definition_id" UUID,
    "version_id" UUID,
    "strategy_key" VARCHAR(64) NOT NULL,
    "strategy_version" VARCHAR(20) NOT NULL,
    "implementation_id" VARCHAR(200) NOT NULL,
    "status" "BacktestRunStatus" NOT NULL DEFAULT 'QUEUED',
    "venue" "TradingVenue" NOT NULL,
    "symbol" VARCHAR(32) NOT NULL,
    "market_type" "TradingMarketType" NOT NULL DEFAULT 'SPOT',
    "dataset_id" VARCHAR(120) NOT NULL,
    "dataset_source" VARCHAR(120) NOT NULL,
    "dataset_checksum" VARCHAR(64),
    "granularity" VARCHAR(20),
    "window_start_micros" BIGINT NOT NULL,
    "window_end_micros" BIGINT NOT NULL,
    "event_count" INTEGER NOT NULL DEFAULT 0,
    "walk_forward_segment" VARCHAR(20),
    "initial_capital" DECIMAL(18,6) NOT NULL,
    "maker_fee_rate" DECIMAL(9,6) NOT NULL,
    "taker_fee_rate" DECIMAL(9,6) NOT NULL,
    "slippage_bps" DECIMAL(9,4) NOT NULL,
    "latency_micros" BIGINT NOT NULL DEFAULT 0,
    "parameters" JSONB NOT NULL DEFAULT '{}',
    "assumptions" JSONB NOT NULL DEFAULT '{}',
    "final_equity" DECIMAL(18,6),
    "net_pnl" DECIMAL(18,6),
    "gross_profit" DECIMAL(18,6),
    "gross_loss" DECIMAL(18,6),
    "fees_paid" DECIMAL(18,6),
    "slippage_cost" DECIMAL(18,6),
    "total_return_percent" DECIMAL(12,6),
    "max_drawdown" DECIMAL(18,6),
    "max_drawdown_percent" DECIMAL(12,6),
    "total_trades" INTEGER NOT NULL DEFAULT 0,
    "winning_trades" INTEGER NOT NULL DEFAULT 0,
    "losing_trades" INTEGER NOT NULL DEFAULT 0,
    "win_rate" DECIMAL(9,6),
    "average_trade" DECIMAL(18,6),
    "largest_win" DECIMAL(18,6),
    "largest_loss" DECIMAL(18,6),
    "profit_factor" DECIMAL(18,8),
    "sharpe_ratio" DECIMAL(18,8),
    "sortino_ratio" DECIMAL(18,8),
    "has_sufficient_observations" BOOLEAN NOT NULL DEFAULT false,
    "exposure_percent" DECIMAL(9,6),
    "turnover" DECIMAL(18,6),
    "run_identifier" VARCHAR(32) NOT NULL,
    "configuration_hash" VARCHAR(64) NOT NULL,
    "engine_version" VARCHAR(20) NOT NULL,
    "is_reproducible" BOOLEAN NOT NULL DEFAULT false,
    "is_simulated" BOOLEAN NOT NULL DEFAULT true,
    "job_id" VARCHAR(64),
    "queued_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "duration_ms" INTEGER,
    "error_code" VARCHAR(64),
    "error_summary" VARCHAR(1000),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "backtest_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "backtest_metrics" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "backtest_run_id" UUID NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "value" DECIMAL(28,12),
    "unit" VARCHAR(16) NOT NULL DEFAULT 'RATIO',
    "observation_count" INTEGER NOT NULL DEFAULT 0,
    "is_sufficient" BOOLEAN NOT NULL DEFAULT false,
    "note" VARCHAR(500),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "backtest_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "backtest_trades" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "backtest_run_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "symbol" VARCHAR(32) NOT NULL,
    "direction" "PositionSideEnum" NOT NULL,
    "quantity" DECIMAL(28,12) NOT NULL,
    "entry_price" DECIMAL(28,12) NOT NULL,
    "exit_price" DECIMAL(28,12) NOT NULL,
    "gross_pnl" DECIMAL(18,6) NOT NULL,
    "fees" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "net_pnl" DECIMAL(18,6) NOT NULL,
    "is_win" BOOLEAN NOT NULL,
    "opened_at_micros" BIGINT NOT NULL,
    "closed_at_micros" BIGINT NOT NULL,
    "holding_micros" BIGINT NOT NULL,
    "is_simulated" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "backtest_trades_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "paper_trading_sessions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "strategy_id" UUID,
    "requested_by_user_id" UUID,
    "session_identifier" VARCHAR(64) NOT NULL,
    "status" "PaperSessionStatus" NOT NULL DEFAULT 'STARTING',
    "strategy_key" VARCHAR(64) NOT NULL,
    "strategy_version" VARCHAR(20) NOT NULL,
    "venue" "TradingVenue" NOT NULL,
    "symbol" VARCHAR(32) NOT NULL,
    "market_type" "TradingMarketType" NOT NULL DEFAULT 'SPOT',
    "initial_capital" DECIMAL(18,6) NOT NULL,
    "current_equity" DECIMAL(18,6),
    "realised_pnl" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "unrealised_pnl" DECIMAL(18,6),
    "fees_paid" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "max_drawdown" DECIMAL(18,6),
    "signals_generated" INTEGER NOT NULL DEFAULT 0,
    "signals_accepted" INTEGER NOT NULL DEFAULT 0,
    "signals_rejected" INTEGER NOT NULL DEFAULT 0,
    "risk_rejections" INTEGER NOT NULL DEFAULT 0,
    "simulated_orders" INTEGER NOT NULL DEFAULT 0,
    "simulated_fills" INTEGER NOT NULL DEFAULT 0,
    "strategy_errors" INTEGER NOT NULL DEFAULT 0,
    "is_simulated" BOOLEAN NOT NULL DEFAULT true,
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stopped_at" TIMESTAMPTZ(6),
    "stop_reason" VARCHAR(500),
    "error_code" VARCHAR(64),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "paper_trading_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "paper_portfolio_snapshots" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "captured_at_micros" BIGINT NOT NULL,
    "cash" DECIMAL(18,6) NOT NULL,
    "position_quantity" DECIMAL(28,12) NOT NULL DEFAULT 0,
    "position_value" DECIMAL(18,6),
    "equity" DECIMAL(18,6) NOT NULL,
    "realised_pnl" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "unrealised_pnl" DECIMAL(18,6),
    "fees_paid" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "drawdown" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "is_simulated" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "paper_portfolio_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "strategy_definitions_key_key" ON "strategy_definitions"("key");

-- CreateIndex
CREATE INDEX "strategy_definitions_is_implemented_idx" ON "strategy_definitions"("is_implemented");

-- CreateIndex
CREATE INDEX "strategy_versions_definition_id_status_idx" ON "strategy_versions"("definition_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "strategy_versions_definition_id_version_key" ON "strategy_versions"("definition_id", "version");

-- CreateIndex
CREATE INDEX "strategy_runs_tenant_id_strategy_id_started_at_idx" ON "strategy_runs"("tenant_id", "strategy_id", "started_at");

-- CreateIndex
CREATE INDEX "strategy_runs_tenant_id_status_started_at_idx" ON "strategy_runs"("tenant_id", "status", "started_at");

-- CreateIndex
CREATE INDEX "strategy_runs_strategy_id_status_idx" ON "strategy_runs"("strategy_id", "status");

-- CreateIndex
CREATE INDEX "strategy_runs_started_at_idx" ON "strategy_runs"("started_at");

-- CreateIndex
CREATE INDEX "strategy_checkpoints_tenant_id_strategy_id_captured_at_micr_idx" ON "strategy_checkpoints"("tenant_id", "strategy_id", "captured_at_micros");

-- CreateIndex
CREATE INDEX "strategy_checkpoints_run_id_idx" ON "strategy_checkpoints"("run_id");

-- CreateIndex
CREATE UNIQUE INDEX "strategy_checkpoints_strategy_id_sequence_key" ON "strategy_checkpoints"("strategy_id", "sequence");

-- CreateIndex
CREATE INDEX "strategy_incidents_tenant_id_severity_created_at_idx" ON "strategy_incidents"("tenant_id", "severity", "created_at");

-- CreateIndex
CREATE INDEX "strategy_incidents_tenant_id_incident_type_created_at_idx" ON "strategy_incidents"("tenant_id", "incident_type", "created_at");

-- CreateIndex
CREATE INDEX "strategy_incidents_tenant_id_strategy_id_created_at_idx" ON "strategy_incidents"("tenant_id", "strategy_id", "created_at");

-- CreateIndex
CREATE INDEX "strategy_incidents_tenant_id_resolved_at_severity_idx" ON "strategy_incidents"("tenant_id", "resolved_at", "severity");

-- CreateIndex
CREATE INDEX "strategy_incidents_run_id_idx" ON "strategy_incidents"("run_id");

-- CreateIndex
CREATE INDEX "backtest_runs_tenant_id_status_queued_at_idx" ON "backtest_runs"("tenant_id", "status", "queued_at");

-- CreateIndex
CREATE INDEX "backtest_runs_tenant_id_strategy_id_queued_at_idx" ON "backtest_runs"("tenant_id", "strategy_id", "queued_at");

-- CreateIndex
CREATE INDEX "backtest_runs_tenant_id_configuration_hash_idx" ON "backtest_runs"("tenant_id", "configuration_hash");

-- CreateIndex
CREATE INDEX "backtest_runs_tenant_id_symbol_queued_at_idx" ON "backtest_runs"("tenant_id", "symbol", "queued_at");

-- CreateIndex
CREATE INDEX "backtest_runs_definition_id_idx" ON "backtest_runs"("definition_id");

-- CreateIndex
CREATE INDEX "backtest_runs_version_id_idx" ON "backtest_runs"("version_id");

-- CreateIndex
CREATE INDEX "backtest_runs_queued_at_idx" ON "backtest_runs"("queued_at");

-- CreateIndex
CREATE UNIQUE INDEX "backtest_runs_tenant_id_run_identifier_key" ON "backtest_runs"("tenant_id", "run_identifier");

-- CreateIndex
CREATE INDEX "backtest_metrics_tenant_id_name_idx" ON "backtest_metrics"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "backtest_metrics_backtest_run_id_name_key" ON "backtest_metrics"("backtest_run_id", "name");

-- CreateIndex
CREATE INDEX "backtest_trades_tenant_id_backtest_run_id_idx" ON "backtest_trades"("tenant_id", "backtest_run_id");

-- CreateIndex
CREATE INDEX "backtest_trades_backtest_run_id_closed_at_micros_idx" ON "backtest_trades"("backtest_run_id", "closed_at_micros");

-- CreateIndex
CREATE UNIQUE INDEX "backtest_trades_backtest_run_id_sequence_key" ON "backtest_trades"("backtest_run_id", "sequence");

-- CreateIndex
CREATE INDEX "paper_trading_sessions_tenant_id_status_started_at_idx" ON "paper_trading_sessions"("tenant_id", "status", "started_at");

-- CreateIndex
CREATE INDEX "paper_trading_sessions_tenant_id_strategy_id_started_at_idx" ON "paper_trading_sessions"("tenant_id", "strategy_id", "started_at");

-- CreateIndex
CREATE INDEX "paper_trading_sessions_started_at_idx" ON "paper_trading_sessions"("started_at");

-- CreateIndex
CREATE UNIQUE INDEX "paper_trading_sessions_tenant_id_session_identifier_key" ON "paper_trading_sessions"("tenant_id", "session_identifier");

-- CreateIndex
CREATE INDEX "paper_portfolio_snapshots_tenant_id_session_id_captured_at__idx" ON "paper_portfolio_snapshots"("tenant_id", "session_id", "captured_at_micros");

-- CreateIndex
CREATE UNIQUE INDEX "paper_portfolio_snapshots_session_id_sequence_key" ON "paper_portfolio_snapshots"("session_id", "sequence");

-- CreateIndex
CREATE INDEX "strategies_tenant_id_health_idx" ON "strategies"("tenant_id", "health");

-- CreateIndex
CREATE INDEX "strategies_tenant_id_definition_id_idx" ON "strategies"("tenant_id", "definition_id");

-- CreateIndex
CREATE INDEX "strategies_version_id_idx" ON "strategies"("version_id");

-- CreateIndex
CREATE UNIQUE INDEX "strategies_tenant_id_instance_key_key" ON "strategies"("tenant_id", "instance_key");

-- CreateIndex
CREATE INDEX "strategy_configurations_strategy_version_id_idx" ON "strategy_configurations"("strategy_version_id");

-- AddForeignKey
ALTER TABLE "strategies" ADD CONSTRAINT "strategies_definition_id_fkey" FOREIGN KEY ("definition_id") REFERENCES "strategy_definitions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "strategies" ADD CONSTRAINT "strategies_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "strategy_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "strategy_configurations" ADD CONSTRAINT "strategy_configurations_strategy_version_id_fkey" FOREIGN KEY ("strategy_version_id") REFERENCES "strategy_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "strategy_versions" ADD CONSTRAINT "strategy_versions_definition_id_fkey" FOREIGN KEY ("definition_id") REFERENCES "strategy_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "strategy_runs" ADD CONSTRAINT "strategy_runs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "strategy_runs" ADD CONSTRAINT "strategy_runs_strategy_id_fkey" FOREIGN KEY ("strategy_id") REFERENCES "strategies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "strategy_checkpoints" ADD CONSTRAINT "strategy_checkpoints_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "strategy_checkpoints" ADD CONSTRAINT "strategy_checkpoints_strategy_id_fkey" FOREIGN KEY ("strategy_id") REFERENCES "strategies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "strategy_checkpoints" ADD CONSTRAINT "strategy_checkpoints_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "strategy_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "strategy_incidents" ADD CONSTRAINT "strategy_incidents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "strategy_incidents" ADD CONSTRAINT "strategy_incidents_strategy_id_fkey" FOREIGN KEY ("strategy_id") REFERENCES "strategies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "strategy_incidents" ADD CONSTRAINT "strategy_incidents_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "strategy_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "backtest_runs" ADD CONSTRAINT "backtest_runs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "backtest_runs" ADD CONSTRAINT "backtest_runs_strategy_id_fkey" FOREIGN KEY ("strategy_id") REFERENCES "strategies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "backtest_runs" ADD CONSTRAINT "backtest_runs_definition_id_fkey" FOREIGN KEY ("definition_id") REFERENCES "strategy_definitions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "backtest_runs" ADD CONSTRAINT "backtest_runs_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "strategy_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "backtest_metrics" ADD CONSTRAINT "backtest_metrics_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "backtest_metrics" ADD CONSTRAINT "backtest_metrics_backtest_run_id_fkey" FOREIGN KEY ("backtest_run_id") REFERENCES "backtest_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "backtest_trades" ADD CONSTRAINT "backtest_trades_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "backtest_trades" ADD CONSTRAINT "backtest_trades_backtest_run_id_fkey" FOREIGN KEY ("backtest_run_id") REFERENCES "backtest_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paper_trading_sessions" ADD CONSTRAINT "paper_trading_sessions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paper_trading_sessions" ADD CONSTRAINT "paper_trading_sessions_strategy_id_fkey" FOREIGN KEY ("strategy_id") REFERENCES "strategies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paper_portfolio_snapshots" ADD CONSTRAINT "paper_portfolio_snapshots_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paper_portfolio_snapshots" ADD CONSTRAINT "paper_portfolio_snapshots_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "paper_trading_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

