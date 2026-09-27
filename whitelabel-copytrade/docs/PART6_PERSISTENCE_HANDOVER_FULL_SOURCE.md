# Part 6 — persistence, API, clients and the verification sweep: full source handover

> **BACKTEST PERFORMANCE IS NOT INDICATIVE OF FUTURE PERFORMANCE.**  
> **PAPER PERFORMANCE IS NOT INDICATIVE OF LIVE PERFORMANCE.**  
> **SIMULATION DOES NOT GUARANTEE REAL EXECUTION QUALITY.**

Complete content of every file created or modified by the persistence
increment of Part 6 — the Prisma migration, the NestJS strategy module, the
admin console page and the read-only mobile viewer — plus Part C, the files
owned by Parts 1–5 that the repository-wide lint/type sweep changed while
making `ruff check` and strict `mypy` genuinely green. Nothing is
abbreviated, summarised or elided — each block below is the entire final
file as it exists in the repository.

The Python core of Part 6 is a separate handover in the same repository,
`docs/PART6_HANDOVER_FULL_SOURCE.md`, and is not reproduced here. The
narrative documentation is `docs/PART6_STRATEGY.md`.

Generated 2026-09-11. Gates at generation time:

* `cd libs/trading-core && python3 -m pytest tests/ -q` → **634 passed**
* `python3 -m ruff check wlct_trading tests` → green (ruleset pinned in
  `libs/trading-core/pyproject.toml`; it was not green before the sweep — 32
  `F401` findings were fixed by Part C, not suppressed)
* `python3 -m mypy wlct_trading` under mypy 1.11.2 **and** 2.3.1 → green
  (26/27 strict errors pre-existed the sweep; all fixed by Part C, none
  suppressed)
* `npm run lint`, `npm run lint --workspace=@wlct/admin-web`,
  `npm run typecheck` → clean
* `npm test` → **47 passed** (23 execution + 24 strategy safety)
* `prisma validate` → schema valid
* `flutter analyze` → **no issues** · `flutter test` → **20 passed**
  (Flutter 3.24.5 / Dart 3.5.4, the newest release matching the app's
  `intl ^0.19.0` and `flutter_lints ^4` pins)

---

## Contents

### New files

* `apps/api/prisma/migrations/20260907120000_part6_strategy_layer/migration.sql` — 533 lines
* `apps/api/src/modules/strategy/strategy.types.ts` — 405 lines
* `apps/api/src/modules/strategy/strategy.mapper.ts` — 578 lines
* `apps/api/src/modules/strategy/dto/strategy.dto.ts` — 406 lines
* `apps/api/src/modules/strategy/strategy-catalog.service.ts` — 218 lines
* `apps/api/src/modules/strategy/strategy-instances.service.ts` — 511 lines
* `apps/api/src/modules/strategy/strategy-incidents.service.ts` — 175 lines
* `apps/api/src/modules/strategy/backtest.service.ts` — 512 lines
* `apps/api/src/modules/strategy/paper-sessions.service.ts` — 418 lines
* `apps/api/src/modules/strategy/strategy-metrics.service.ts` — 141 lines
* `apps/api/src/modules/strategy/strategy.controller.ts` — 270 lines
* `apps/api/src/modules/strategy/strategy-simulation.controller.ts` — 230 lines
* `apps/api/src/modules/strategy/strategy.module.ts` — 39 lines
* `apps/api/src/modules/strategy/strategy-safety.spec.ts` — 425 lines
* `apps/admin-web/src/app/(console)/strategies/page.tsx` — 533 lines
* `apps/mobile/lib/features/strategies/domain/strategy_models.dart` — 489 lines
* `apps/mobile/lib/features/strategies/data/strategy_repository.dart` — 94 lines
* `apps/mobile/lib/features/strategies/presentation/strategy_state.dart` — 90 lines
* `apps/mobile/lib/features/strategies/presentation/strategy_controller.dart` — 96 lines
* `apps/mobile/lib/features/strategies/presentation/strategies_screen.dart` — 745 lines
* `apps/mobile/test/strategy_view_test.dart` — 219 lines
* `apps/mobile/pubspec.lock` — 607 lines

### Modified files (complete final content)

* `apps/api/prisma/schema.prisma` — 3048 lines
* `apps/api/src/app.module.ts` — 100 lines
* `packages/shared-types/src/rbac.ts` — 695 lines
* `packages/shared-types/src/audit.ts` — 165 lines
* `packages/config/src/constants.ts` — 148 lines
* `apps/admin-web/src/components/sidebar.tsx` — 95 lines
* `apps/mobile/lib/core/network/api_endpoints.dart` — 40 lines
* `apps/mobile/lib/core/router/route_paths.dart` — 27 lines
* `apps/mobile/lib/core/router/app_router.dart` — 129 lines
* `apps/mobile/lib/core/di/providers.dart` — 100 lines
* `apps/mobile/lib/features/home/home_screen.dart` — 126 lines
* `apps/mobile/lib/app.dart` — 47 lines
* `apps/mobile/lib/core/error/error_mapper.dart` — 128 lines
* `apps/mobile/lib/l10n/app_en.arb` — 86 lines
* `apps/mobile/lib/l10n/app_bn.arb` — 86 lines

### Part C — files touched by the lint/type sweep

* `libs/trading-core/wlct_trading/risk.py` — 783 lines
* `libs/trading-core/wlct_trading/adapters/base.py` — 458 lines
* `libs/trading-core/wlct_trading/adapters/paper.py` — 317 lines
* `libs/trading-core/wlct_trading/exchanges/binance/trading.py` — 1156 lines
* `libs/trading-core/wlct_trading/exchanges/binance/signing.py` — 279 lines
* `libs/trading-core/wlct_trading/exchanges/symbols.py` — 362 lines
* `libs/trading-core/wlct_trading/execution/engine.py` — 1283 lines
* `libs/trading-core/wlct_trading/execution/reconciliation.py` — 847 lines
* `libs/trading-core/wlct_trading/execution/validation.py` — 485 lines
* `libs/trading-core/wlct_trading/execution/store.py` — 391 lines
* `libs/trading-core/wlct_trading/net/config.py` — 435 lines
* `libs/trading-core/wlct_trading/net/feed.py` — 964 lines
* `libs/trading-core/wlct_trading/net/signed_client.py` — 291 lines
* `libs/trading-core/wlct_trading/net/websocket_client.py` — 333 lines
* `libs/trading-core/wlct_trading/transport/websocket.py` — 695 lines
* `libs/trading-core/wlct_trading/transport/staleness.py` — 224 lines
* `libs/trading-core/tests/test_execution.py` — 1346 lines
* `libs/trading-core/tests/test_orders.py` — 265 lines
* `libs/trading-core/tests/test_pipeline.py` — 328 lines
* `libs/trading-core/tests/test_risk.py` — 608 lines
* `libs/trading-core/tests/test_signals.py` — 270 lines
* `libs/trading-core/tests/test_transport.py` — 397 lines

---

# Part A — new files

## FILE: apps/api/prisma/migrations/20260907120000_part6_strategy_layer/migration.sql

```sql
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
```

---

## FILE: apps/api/src/modules/strategy/strategy.types.ts

```ts
import type {
  BacktestRunStatus,
  ExecutionIncidentSeverity,
  PaperSessionStatus,
  PositionSideEnum,
  StrategyFailurePolicy,
  StrategyHealth,
  StrategyIncidentType,
  StrategyRunStatus,
  StrategyStatus,
  StrategyVersionStatus,
  TradingMarketType,
  TradingModeSetting,
  TradingVenue,
} from '@prisma/client';

/**
 * Outward-facing shapes for the strategy API.
 *
 * Same two rules as `execution.types.ts`, for the same reasons.
 *
 * No Prisma row is returned directly. Every response is assembled field by
 * field in `strategy.mapper.ts` from an explicitly declared input type, so a
 * column added by a future migration cannot appear in a JSON body by accident.
 *
 * Decimal and BigInt are serialised as strings. A quantity of 0.000000000001
 * and a microsecond epoch both lose precision as an IEEE double, and rounding
 * either on a trading surface is not a trade-off worth making.
 *
 * One rule is specific to this module: every simulated result carries an
 * explicit `isSimulated: true` and a `disclaimer`. A client that renders a
 * backtest equity curve next to a live one must not have to infer which is
 * which from the endpoint it happened to call.
 */

/** Repeated verbatim on every simulated payload. */
export const SIMULATION_DISCLAIMER =
  'Simulated result. Backtest performance is not indicative of future performance; ' +
  'paper performance is not indicative of live performance; simulation does not ' +
  'guarantee real execution quality.';

// -----------------------------------------------------------------------------
// Catalogue
// -----------------------------------------------------------------------------

export interface StrategyVersionView {
  id: string;
  definitionId: string;
  version: string;
  status: StrategyVersionStatus;
  implementationId: string;
  /** Declared parameter schema. Never contains a credential-shaped field. */
  parameterSchema: unknown;
  defaultParameters: unknown;
  behaviourHash: string;
  changeNote: string | null;
  publishedAt: string | null;
  deprecatedAt: string | null;
  createdAt: string;
}

export interface StrategyDefinitionView {
  id: string;
  key: string;
  displayName: string;
  description: string;
  category: string | null;
  isImplemented: boolean;
  isReserved: boolean;
  /** Rendered verbatim by every client. Never rewritten into a claim. */
  riskNotes: string;
  versionCount: number;
  versions?: StrategyVersionView[];
  createdAt: string;
  updatedAt: string;
}

// -----------------------------------------------------------------------------
// Instances
// -----------------------------------------------------------------------------

export interface StrategyRiskProfileView {
  maxOrderQuantity: string;
  maxPositionQuantity: string;
  maxOrderNotional: string;
  maxDailyLoss: string;
  maxOpenOrders: number;
  maxOrdersPerMinute: number;
}

export interface StrategyInstanceView {
  id: string;
  tenantId: string;
  accountId: string | null;
  name: string;
  kind: string;
  version: string;
  definitionId: string | null;
  versionId: string | null;
  /** Deterministic engine fingerprint. Null until the engine reports one. */
  instanceKey: string | null;
  configVersion: number;
  status: StrategyStatus;
  enabled: boolean;
  health: StrategyHealth;
  failurePolicy: StrategyFailurePolicy;
  venue: TradingVenue;
  symbols: string[];
  marketType: TradingMarketType;
  description: string | null;
  riskProfile: StrategyRiskProfileView;
  consecutiveErrors: number;
  lastHeartbeatAt: string | null;
  lastStartedAt: string | null;
  lastStoppedAt: string | null;
  /** Exception class name only. Never a message. */
  lastErrorCode: string | null;
  quarantinedAt: string | null;
  quarantineReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StrategyRunView {
  id: string;
  strategyId: string;
  runMode: TradingModeSetting;
  status: StrategyRunStatus;
  instanceKey: string;
  configVersion: number;
  strategyKey: string;
  strategyVersion: string;
  venue: TradingVenue;
  symbols: string[];
  marketType: TradingMarketType;
  startedAt: string;
  stoppedAt: string | null;
  stopReason: string | null;
  errorCode: string | null;
  counters: unknown;
  lastEventAtMicros: string | null;
}

/**
 * What an operator needs in one glance.
 *
 * `liveExecutionReachable` is stated explicitly and separately from `enabled`.
 * A strategy being enabled does not mean it can place a live order, and a
 * status panel that does not say so invites the assumption that it does.
 */
export interface StrategyInstanceStatusView {
  instance: StrategyInstanceView;
  currentRun: StrategyRunView | null;
  openIncidents: number;
  criticalIncidents: number;
  lastCheckpointAt: string | null;
  engineEnabled: boolean;
  tradingMode: 'DISABLED' | 'DRY_RUN' | 'PAPER' | 'LIVE';
  liveExecutionReachable: boolean;
}

export interface StrategyIncidentView {
  id: string;
  strategyId: string | null;
  runId: string | null;
  incidentType: StrategyIncidentType;
  severity: ExecutionIncidentSeverity;
  venue: TradingVenue | null;
  symbol: string | null;
  errorCode: string | null;
  summary: string;
  details: unknown;
  occurredAtMicros: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolutionNote: string | null;
  createdAt: string;
}

// -----------------------------------------------------------------------------
// Backtesting
// -----------------------------------------------------------------------------

export interface BacktestDatasetView {
  datasetId: string;
  source: string;
  /** Null means the result cannot be proven to have come from that data. */
  checksum: string | null;
  granularity: string | null;
  windowStartMicros: string;
  windowEndMicros: string;
  eventCount: number;
  walkForwardSegment: string | null;
}

export interface BacktestAssumptionsView {
  initialCapital: string;
  makerFeeRate: string;
  takerFeeRate: string;
  slippageBps: string;
  latencyMicros: string;
  extra: unknown;
}

export interface BacktestResultView {
  finalEquity: string | null;
  netPnl: string | null;
  grossProfit: string | null;
  grossLoss: string | null;
  feesPaid: string | null;
  slippageCost: string | null;
  totalReturnPercent: string | null;
  maxDrawdown: string | null;
  maxDrawdownPercent: string | null;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  /** Null, never zero, when there were no trades to average. */
  winRate: string | null;
  averageTrade: string | null;
  largestWin: string | null;
  largestLoss: string | null;
  profitFactor: string | null;
  /** Withheld below the engine's minimum observation count. */
  sharpeRatio: string | null;
  sortinoRatio: string | null;
  hasSufficientObservations: boolean;
  exposurePercent: string | null;
  turnover: string | null;
}

export interface BacktestRunView {
  id: string;
  runIdentifier: string;
  status: BacktestRunStatus;
  strategyId: string | null;
  definitionId: string | null;
  versionId: string | null;
  strategyKey: string;
  strategyVersion: string;
  implementationId: string;
  venue: TradingVenue;
  symbol: string;
  marketType: TradingMarketType;
  dataset: BacktestDatasetView;
  assumptions: BacktestAssumptionsView;
  parameters: unknown;
  result: BacktestResultView;
  configurationHash: string;
  engineVersion: string;
  isReproducible: boolean;
  isSimulated: true;
  disclaimer: string;
  jobId: string | null;
  queuedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  errorCode: string | null;
  errorSummary: string | null;
}

export interface BacktestMetricView {
  name: string;
  value: string | null;
  unit: string;
  observationCount: number;
  /** False means "not enough data to say", which is not the same as zero. */
  isSufficient: boolean;
  note: string | null;
}

export interface BacktestTradeView {
  sequence: number;
  symbol: string;
  direction: PositionSideEnum;
  quantity: string;
  entryPrice: string;
  exitPrice: string;
  grossPnl: string;
  fees: string;
  netPnl: string;
  /** Net of fees. A trade profitable before costs and not after is a loss. */
  isWin: boolean;
  openedAtMicros: string;
  closedAtMicros: string;
  holdingMicros: string;
  isSimulated: true;
}

// -----------------------------------------------------------------------------
// Paper trading
// -----------------------------------------------------------------------------

export interface PaperSessionView {
  id: string;
  sessionIdentifier: string;
  status: PaperSessionStatus;
  strategyId: string | null;
  strategyKey: string;
  strategyVersion: string;
  venue: TradingVenue;
  symbol: string;
  marketType: TradingMarketType;
  initialCapital: string;
  currentEquity: string | null;
  realisedPnl: string;
  /** Null when flat or unmarked. Never coerced to zero. */
  unrealisedPnl: string | null;
  feesPaid: string;
  maxDrawdown: string | null;
  signalsGenerated: number;
  signalsAccepted: number;
  signalsRejected: number;
  riskRejections: number;
  simulatedOrders: number;
  simulatedFills: number;
  strategyErrors: number;
  isSimulated: true;
  disclaimer: string;
  startedAt: string;
  stoppedAt: string | null;
  stopReason: string | null;
  errorCode: string | null;
}

export interface PaperSnapshotView {
  sequence: number;
  capturedAtMicros: string;
  cash: string;
  positionQuantity: string;
  positionValue: string | null;
  equity: string;
  realisedPnl: string;
  unrealisedPnl: string | null;
  feesPaid: string;
  drawdown: string;
  isSimulated: true;
}

// -----------------------------------------------------------------------------
// Metrics and commands
// -----------------------------------------------------------------------------

/**
 * Aggregate counters for the strategy layer.
 *
 * Every latency figure is an observation of a process including its own
 * scheduling delay. It is not a guarantee, and this platform makes no
 * "sub-millisecond" or HFT claim. `latencyNote` carries that statement to
 * every consumer so a dashboard cannot quietly turn it into a promise.
 */
export interface StrategyMetricsView {
  instances: {
    total: number;
    enabled: number;
    running: number;
    quarantined: number;
    unhealthy: number;
  };
  incidents: {
    open: number;
    critical: number;
    warning: number;
    info: number;
  };
  runs: {
    active: number;
    failedLast24h: number;
  };
  backtests: {
    queued: number;
    running: number;
    completedLast24h: number;
    failedLast24h: number;
  };
  paperSessions: {
    running: number;
    stoppedLast24h: number;
  };
  configuration: {
    strategyEngineEnabled: boolean;
    paperTradingEnabled: boolean;
    backtestEnabled: boolean;
    maxInstances: number;
    eventQueueSize: number;
    maxProcessingLatencyMs: number;
    signalMaxAgeMs: number;
    signalDedupTtlSeconds: number;
    tradingMode: 'DISABLED' | 'DRY_RUN' | 'PAPER' | 'LIVE';
    liveExecutionReachable: boolean;
  };
  latencyNote: string;
  disclaimer: string;
}

/** Acknowledgement for anything the strategy worker has to carry out. */
export interface StrategyCommandAcceptedView {
  accepted: true;
  command: string;
  jobId: string;
  requestedAt: string;
  /** What was queued, and what has explicitly NOT happened yet. */
  note: string;
}
```

---

## FILE: apps/api/src/modules/strategy/strategy.mapper.ts

```ts
import type { Prisma } from '@prisma/client';

import {
  SIMULATION_DISCLAIMER,
  type BacktestMetricView,
  type BacktestRunView,
  type BacktestTradeView,
  type PaperSessionView,
  type PaperSnapshotView,
  type StrategyDefinitionView,
  type StrategyIncidentView,
  type StrategyInstanceView,
  type StrategyRunView,
  type StrategyVersionView,
} from './strategy.types';

/**
 * Prisma row -> API view conversions for the strategy layer.
 *
 * Written to the same discipline as `execution.mapper.ts`:
 *
 *   - no `...row` spread anywhere, so a column added by a future migration
 *     cannot appear in a response without someone deciding it should;
 *   - Decimal and BigInt are stringified rather than cast to `number`;
 *   - every simulated payload gets `isSimulated: true` and the disclaimer,
 *     applied here rather than at each call site, because a label that depends
 *     on being remembered is a label that will eventually be forgotten.
 *
 * There is no credential risk in this module - no strategy object holds one -
 * but the field-by-field style is kept anyway. Uniformity is what makes the
 * absence of a spread meaningful when it matters.
 */

type DecimalLike = Prisma.Decimal | null | undefined;

function decimal(value: DecimalLike): string | null {
  return value === null || value === undefined ? null : value.toString();
}

function requiredDecimal(value: Prisma.Decimal): string {
  return value.toString();
}

function bigint(value: bigint | null | undefined): string | null {
  return value === null || value === undefined ? null : value.toString();
}

function requiredBigint(value: bigint): string {
  return value.toString();
}

function iso(value: Date | null | undefined): string | null {
  return value === null || value === undefined ? null : value.toISOString();
}

function requiredIso(value: Date): string {
  return value.toISOString();
}

function json(value: Prisma.JsonValue | null | undefined): unknown {
  return value === null || value === undefined ? {} : value;
}

// -----------------------------------------------------------------------------
// Catalogue
// -----------------------------------------------------------------------------

export interface StrategyVersionRow {
  id: string;
  definitionId: string;
  version: string;
  status: StrategyVersionView['status'];
  implementationId: string;
  parameterSchema: Prisma.JsonValue;
  defaultParameters: Prisma.JsonValue;
  behaviourHash: string;
  changeNote: string | null;
  publishedAt: Date | null;
  deprecatedAt: Date | null;
  createdAt: Date;
}

export function toStrategyVersionView(row: StrategyVersionRow): StrategyVersionView {
  return {
    id: row.id,
    definitionId: row.definitionId,
    version: row.version,
    status: row.status,
    implementationId: row.implementationId,
    parameterSchema: json(row.parameterSchema),
    defaultParameters: json(row.defaultParameters),
    behaviourHash: row.behaviourHash,
    changeNote: row.changeNote,
    publishedAt: iso(row.publishedAt),
    deprecatedAt: iso(row.deprecatedAt),
    createdAt: requiredIso(row.createdAt),
  };
}

export interface StrategyDefinitionRow {
  id: string;
  key: string;
  displayName: string;
  description: string;
  category: string | null;
  isImplemented: boolean;
  isReserved: boolean;
  riskNotes: string;
  createdAt: Date;
  updatedAt: Date;
  versions?: StrategyVersionRow[];
  _count?: { versions: number };
}

export function toStrategyDefinitionView(row: StrategyDefinitionRow): StrategyDefinitionView {
  return {
    id: row.id,
    key: row.key,
    displayName: row.displayName,
    description: row.description,
    category: row.category,
    isImplemented: row.isImplemented,
    isReserved: row.isReserved,
    riskNotes: row.riskNotes,
    versionCount: row._count?.versions ?? row.versions?.length ?? 0,
    ...(row.versions ? { versions: row.versions.map(toStrategyVersionView) } : {}),
    createdAt: requiredIso(row.createdAt),
    updatedAt: requiredIso(row.updatedAt),
  };
}

// -----------------------------------------------------------------------------
// Instances
// -----------------------------------------------------------------------------

export interface StrategyInstanceRow {
  id: string;
  tenantId: string;
  accountId: string | null;
  name: string;
  kind: string;
  version: string;
  definitionId: string | null;
  versionId: string | null;
  instanceKey: string | null;
  configVersion: number;
  status: StrategyInstanceView['status'];
  enabled: boolean;
  health: StrategyInstanceView['health'];
  failurePolicy: StrategyInstanceView['failurePolicy'];
  venue: StrategyInstanceView['venue'];
  symbols: string[];
  marketType: StrategyInstanceView['marketType'];
  description: string | null;
  maxOrderQuantity: Prisma.Decimal;
  maxPositionQuantity: Prisma.Decimal;
  maxOrderNotional: Prisma.Decimal;
  maxDailyLoss: Prisma.Decimal;
  maxOpenOrders: number;
  maxOrdersPerMinute: number;
  consecutiveErrors: number;
  lastHeartbeatAt: Date | null;
  lastStartedAt: Date | null;
  lastStoppedAt: Date | null;
  lastErrorCode: string | null;
  quarantinedAt: Date | null;
  quarantineReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export function toStrategyInstanceView(row: StrategyInstanceRow): StrategyInstanceView {
  return {
    id: row.id,
    tenantId: row.tenantId,
    accountId: row.accountId,
    name: row.name,
    kind: row.kind,
    version: row.version,
    definitionId: row.definitionId,
    versionId: row.versionId,
    instanceKey: row.instanceKey,
    configVersion: row.configVersion,
    status: row.status,
    enabled: row.enabled,
    health: row.health,
    failurePolicy: row.failurePolicy,
    venue: row.venue,
    symbols: row.symbols,
    marketType: row.marketType,
    description: row.description,
    riskProfile: {
      maxOrderQuantity: requiredDecimal(row.maxOrderQuantity),
      maxPositionQuantity: requiredDecimal(row.maxPositionQuantity),
      maxOrderNotional: requiredDecimal(row.maxOrderNotional),
      maxDailyLoss: requiredDecimal(row.maxDailyLoss),
      maxOpenOrders: row.maxOpenOrders,
      maxOrdersPerMinute: row.maxOrdersPerMinute,
    },
    consecutiveErrors: row.consecutiveErrors,
    lastHeartbeatAt: iso(row.lastHeartbeatAt),
    lastStartedAt: iso(row.lastStartedAt),
    lastStoppedAt: iso(row.lastStoppedAt),
    lastErrorCode: row.lastErrorCode,
    quarantinedAt: iso(row.quarantinedAt),
    quarantineReason: row.quarantineReason,
    createdAt: requiredIso(row.createdAt),
    updatedAt: requiredIso(row.updatedAt),
  };
}

export interface StrategyRunRow {
  id: string;
  strategyId: string;
  runMode: StrategyRunView['runMode'];
  status: StrategyRunView['status'];
  instanceKey: string;
  configVersion: number;
  strategyKey: string;
  strategyVersion: string;
  venue: StrategyRunView['venue'];
  symbols: string[];
  marketType: StrategyRunView['marketType'];
  startedAt: Date;
  stoppedAt: Date | null;
  stopReason: string | null;
  errorCode: string | null;
  counters: Prisma.JsonValue;
  lastEventAtMicros: bigint | null;
}

export function toStrategyRunView(row: StrategyRunRow): StrategyRunView {
  return {
    id: row.id,
    strategyId: row.strategyId,
    runMode: row.runMode,
    status: row.status,
    instanceKey: row.instanceKey,
    configVersion: row.configVersion,
    strategyKey: row.strategyKey,
    strategyVersion: row.strategyVersion,
    venue: row.venue,
    symbols: row.symbols,
    marketType: row.marketType,
    startedAt: requiredIso(row.startedAt),
    stoppedAt: iso(row.stoppedAt),
    stopReason: row.stopReason,
    errorCode: row.errorCode,
    counters: json(row.counters),
    lastEventAtMicros: bigint(row.lastEventAtMicros),
  };
}

export interface StrategyIncidentRow {
  id: string;
  strategyId: string | null;
  runId: string | null;
  incidentType: StrategyIncidentView['incidentType'];
  severity: StrategyIncidentView['severity'];
  venue: StrategyIncidentView['venue'];
  symbol: string | null;
  errorCode: string | null;
  summary: string;
  details: Prisma.JsonValue;
  occurredAtMicros: bigint;
  resolvedAt: Date | null;
  resolvedBy: string | null;
  resolutionNote: string | null;
  createdAt: Date;
}

export function toStrategyIncidentView(row: StrategyIncidentRow): StrategyIncidentView {
  return {
    id: row.id,
    strategyId: row.strategyId,
    runId: row.runId,
    incidentType: row.incidentType,
    severity: row.severity,
    venue: row.venue,
    symbol: row.symbol,
    errorCode: row.errorCode,
    summary: row.summary,
    details: json(row.details),
    occurredAtMicros: requiredBigint(row.occurredAtMicros),
    resolvedAt: iso(row.resolvedAt),
    resolvedBy: row.resolvedBy,
    resolutionNote: row.resolutionNote,
    createdAt: requiredIso(row.createdAt),
  };
}

// -----------------------------------------------------------------------------
// Backtesting
// -----------------------------------------------------------------------------

export interface BacktestRunRow {
  id: string;
  runIdentifier: string;
  status: BacktestRunView['status'];
  strategyId: string | null;
  definitionId: string | null;
  versionId: string | null;
  strategyKey: string;
  strategyVersion: string;
  implementationId: string;
  venue: BacktestRunView['venue'];
  symbol: string;
  marketType: BacktestRunView['marketType'];
  datasetId: string;
  datasetSource: string;
  datasetChecksum: string | null;
  granularity: string | null;
  windowStartMicros: bigint;
  windowEndMicros: bigint;
  eventCount: number;
  walkForwardSegment: string | null;
  initialCapital: Prisma.Decimal;
  makerFeeRate: Prisma.Decimal;
  takerFeeRate: Prisma.Decimal;
  slippageBps: Prisma.Decimal;
  latencyMicros: bigint;
  parameters: Prisma.JsonValue;
  assumptions: Prisma.JsonValue;
  finalEquity: Prisma.Decimal | null;
  netPnl: Prisma.Decimal | null;
  grossProfit: Prisma.Decimal | null;
  grossLoss: Prisma.Decimal | null;
  feesPaid: Prisma.Decimal | null;
  slippageCost: Prisma.Decimal | null;
  totalReturnPercent: Prisma.Decimal | null;
  maxDrawdown: Prisma.Decimal | null;
  maxDrawdownPercent: Prisma.Decimal | null;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: Prisma.Decimal | null;
  averageTrade: Prisma.Decimal | null;
  largestWin: Prisma.Decimal | null;
  largestLoss: Prisma.Decimal | null;
  profitFactor: Prisma.Decimal | null;
  sharpeRatio: Prisma.Decimal | null;
  sortinoRatio: Prisma.Decimal | null;
  hasSufficientObservations: boolean;
  exposurePercent: Prisma.Decimal | null;
  turnover: Prisma.Decimal | null;
  configurationHash: string;
  engineVersion: string;
  isReproducible: boolean;
  jobId: string | null;
  queuedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  durationMs: number | null;
  errorCode: string | null;
  errorSummary: string | null;
}

export function toBacktestRunView(row: BacktestRunRow): BacktestRunView {
  return {
    id: row.id,
    runIdentifier: row.runIdentifier,
    status: row.status,
    strategyId: row.strategyId,
    definitionId: row.definitionId,
    versionId: row.versionId,
    strategyKey: row.strategyKey,
    strategyVersion: row.strategyVersion,
    implementationId: row.implementationId,
    venue: row.venue,
    symbol: row.symbol,
    marketType: row.marketType,
    dataset: {
      datasetId: row.datasetId,
      source: row.datasetSource,
      checksum: row.datasetChecksum,
      granularity: row.granularity,
      windowStartMicros: requiredBigint(row.windowStartMicros),
      windowEndMicros: requiredBigint(row.windowEndMicros),
      eventCount: row.eventCount,
      walkForwardSegment: row.walkForwardSegment,
    },
    assumptions: {
      initialCapital: requiredDecimal(row.initialCapital),
      makerFeeRate: requiredDecimal(row.makerFeeRate),
      takerFeeRate: requiredDecimal(row.takerFeeRate),
      slippageBps: requiredDecimal(row.slippageBps),
      latencyMicros: requiredBigint(row.latencyMicros),
      extra: json(row.assumptions),
    },
    parameters: json(row.parameters),
    result: {
      finalEquity: decimal(row.finalEquity),
      netPnl: decimal(row.netPnl),
      grossProfit: decimal(row.grossProfit),
      grossLoss: decimal(row.grossLoss),
      feesPaid: decimal(row.feesPaid),
      slippageCost: decimal(row.slippageCost),
      totalReturnPercent: decimal(row.totalReturnPercent),
      maxDrawdown: decimal(row.maxDrawdown),
      maxDrawdownPercent: decimal(row.maxDrawdownPercent),
      totalTrades: row.totalTrades,
      winningTrades: row.winningTrades,
      losingTrades: row.losingTrades,
      winRate: decimal(row.winRate),
      averageTrade: decimal(row.averageTrade),
      largestWin: decimal(row.largestWin),
      largestLoss: decimal(row.largestLoss),
      profitFactor: decimal(row.profitFactor),
      sharpeRatio: decimal(row.sharpeRatio),
      sortinoRatio: decimal(row.sortinoRatio),
      hasSufficientObservations: row.hasSufficientObservations,
      exposurePercent: decimal(row.exposurePercent),
      turnover: decimal(row.turnover),
    },
    configurationHash: row.configurationHash,
    engineVersion: row.engineVersion,
    isReproducible: row.isReproducible,
    isSimulated: true,
    disclaimer: SIMULATION_DISCLAIMER,
    jobId: row.jobId,
    queuedAt: requiredIso(row.queuedAt),
    startedAt: iso(row.startedAt),
    completedAt: iso(row.completedAt),
    durationMs: row.durationMs,
    errorCode: row.errorCode,
    errorSummary: row.errorSummary,
  };
}

export interface BacktestMetricRow {
  name: string;
  value: Prisma.Decimal | null;
  unit: string;
  observationCount: number;
  isSufficient: boolean;
  note: string | null;
}

export function toBacktestMetricView(row: BacktestMetricRow): BacktestMetricView {
  return {
    name: row.name,
    value: decimal(row.value),
    unit: row.unit,
    observationCount: row.observationCount,
    isSufficient: row.isSufficient,
    note: row.note,
  };
}

export interface BacktestTradeRow {
  sequence: number;
  symbol: string;
  direction: BacktestTradeView['direction'];
  quantity: Prisma.Decimal;
  entryPrice: Prisma.Decimal;
  exitPrice: Prisma.Decimal;
  grossPnl: Prisma.Decimal;
  fees: Prisma.Decimal;
  netPnl: Prisma.Decimal;
  isWin: boolean;
  openedAtMicros: bigint;
  closedAtMicros: bigint;
  holdingMicros: bigint;
}

export function toBacktestTradeView(row: BacktestTradeRow): BacktestTradeView {
  return {
    sequence: row.sequence,
    symbol: row.symbol,
    direction: row.direction,
    quantity: requiredDecimal(row.quantity),
    entryPrice: requiredDecimal(row.entryPrice),
    exitPrice: requiredDecimal(row.exitPrice),
    grossPnl: requiredDecimal(row.grossPnl),
    fees: requiredDecimal(row.fees),
    netPnl: requiredDecimal(row.netPnl),
    isWin: row.isWin,
    openedAtMicros: requiredBigint(row.openedAtMicros),
    closedAtMicros: requiredBigint(row.closedAtMicros),
    holdingMicros: requiredBigint(row.holdingMicros),
    isSimulated: true,
  };
}

// -----------------------------------------------------------------------------
// Paper trading
// -----------------------------------------------------------------------------

export interface PaperSessionRow {
  id: string;
  sessionIdentifier: string;
  status: PaperSessionView['status'];
  strategyId: string | null;
  strategyKey: string;
  strategyVersion: string;
  venue: PaperSessionView['venue'];
  symbol: string;
  marketType: PaperSessionView['marketType'];
  initialCapital: Prisma.Decimal;
  currentEquity: Prisma.Decimal | null;
  realisedPnl: Prisma.Decimal;
  unrealisedPnl: Prisma.Decimal | null;
  feesPaid: Prisma.Decimal;
  maxDrawdown: Prisma.Decimal | null;
  signalsGenerated: number;
  signalsAccepted: number;
  signalsRejected: number;
  riskRejections: number;
  simulatedOrders: number;
  simulatedFills: number;
  strategyErrors: number;
  startedAt: Date;
  stoppedAt: Date | null;
  stopReason: string | null;
  errorCode: string | null;
}

export function toPaperSessionView(row: PaperSessionRow): PaperSessionView {
  return {
    id: row.id,
    sessionIdentifier: row.sessionIdentifier,
    status: row.status,
    strategyId: row.strategyId,
    strategyKey: row.strategyKey,
    strategyVersion: row.strategyVersion,
    venue: row.venue,
    symbol: row.symbol,
    marketType: row.marketType,
    initialCapital: requiredDecimal(row.initialCapital),
    currentEquity: decimal(row.currentEquity),
    realisedPnl: requiredDecimal(row.realisedPnl),
    unrealisedPnl: decimal(row.unrealisedPnl),
    feesPaid: requiredDecimal(row.feesPaid),
    maxDrawdown: decimal(row.maxDrawdown),
    signalsGenerated: row.signalsGenerated,
    signalsAccepted: row.signalsAccepted,
    signalsRejected: row.signalsRejected,
    riskRejections: row.riskRejections,
    simulatedOrders: row.simulatedOrders,
    simulatedFills: row.simulatedFills,
    strategyErrors: row.strategyErrors,
    isSimulated: true,
    disclaimer: SIMULATION_DISCLAIMER,
    startedAt: requiredIso(row.startedAt),
    stoppedAt: iso(row.stoppedAt),
    stopReason: row.stopReason,
    errorCode: row.errorCode,
  };
}

export interface PaperSnapshotRow {
  sequence: number;
  capturedAtMicros: bigint;
  cash: Prisma.Decimal;
  positionQuantity: Prisma.Decimal;
  positionValue: Prisma.Decimal | null;
  equity: Prisma.Decimal;
  realisedPnl: Prisma.Decimal;
  unrealisedPnl: Prisma.Decimal | null;
  feesPaid: Prisma.Decimal;
  drawdown: Prisma.Decimal;
}

export function toPaperSnapshotView(row: PaperSnapshotRow): PaperSnapshotView {
  return {
    sequence: row.sequence,
    capturedAtMicros: requiredBigint(row.capturedAtMicros),
    cash: requiredDecimal(row.cash),
    positionQuantity: requiredDecimal(row.positionQuantity),
    positionValue: decimal(row.positionValue),
    equity: requiredDecimal(row.equity),
    realisedPnl: requiredDecimal(row.realisedPnl),
    unrealisedPnl: decimal(row.unrealisedPnl),
    feesPaid: requiredDecimal(row.feesPaid),
    drawdown: requiredDecimal(row.drawdown),
    isSimulated: true,
  };
}
```

---

## FILE: apps/api/src/modules/strategy/dto/strategy.dto.ts

```ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/**
 * Request shapes for the strategy API.
 *
 * The conventions from the execution DTOs carry over unchanged.
 *
 * No DTO accepts a `tenantId`. Tenancy is resolved from the authenticated
 * session; a body field that could override it is a cross-tenant vulnerability
 * waiting for one forgotten authorization check, so the field does not exist.
 *
 * Every state change carries a `reason`, stored on the audit record.
 *
 * One convention is specific to this module: a numeric value that ends up in
 * Decimal arithmetic is accepted as a **string** and validated with a regex,
 * never as a JSON number. `0.1` in JSON is already not 0.1 by the time it
 * reaches the parser, and a fee rate that is quietly wrong in the twelfth
 * decimal place produces a backtest that cannot be reproduced.
 */

const BOOLEAN_FROM_QUERY = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? ['1', 'true', 'yes', 'on'].includes(value.toLowerCase()) : value;

/** A plain decimal literal. No exponent, no separators, no leading `+`. */
const DECIMAL_PATTERN = /^\d+(\.\d+)?$/;

const SYMBOL_PATTERN = /^[A-Z0-9]+-[A-Z0-9]+$/;

const VENUES = ['BINANCE', 'BYBIT', 'OKX', 'KRAKEN', 'PAPER'] as const;
const MARKET_TYPES = ['SPOT', 'MARGIN', 'FUTURES_USDT', 'FUTURES_COIN'] as const;

// -----------------------------------------------------------------------------
// Catalogue queries
// -----------------------------------------------------------------------------

export class ListStrategyDefinitionsDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description:
      'Include reserved-but-unimplemented catalogue entries. Off by default: they cannot be ' +
      'run, and listing them alongside runnable strategies invites someone to try.',
  })
  @IsOptional()
  @Transform(BOOLEAN_FROM_QUERY)
  @IsBoolean()
  includeReserved?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  category?: string;
}

export class ListStrategyVersionsDto {
  @ApiPropertyOptional({ enum: ['DRAFT', 'PUBLISHED', 'DEPRECATED', 'DISABLED'] })
  @IsOptional()
  @IsIn(['DRAFT', 'PUBLISHED', 'DEPRECATED', 'DISABLED'])
  status?: string;
}

// -----------------------------------------------------------------------------
// Instance queries
// -----------------------------------------------------------------------------

export class ListStrategyInstancesDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ['DRAFT', 'ENABLED', 'DISABLED', 'ERROR'] })
  @IsOptional()
  @IsIn(['DRAFT', 'ENABLED', 'DISABLED', 'ERROR'])
  status?: string;

  @ApiPropertyOptional({
    enum: ['UNKNOWN', 'HEALTHY', 'DEGRADED', 'UNHEALTHY', 'QUARANTINED'],
  })
  @IsOptional()
  @IsIn(['UNKNOWN', 'HEALTHY', 'DEGRADED', 'UNHEALTHY', 'QUARANTINED'])
  health?: string;

  @ApiPropertyOptional({ enum: VENUES })
  @IsOptional()
  @IsIn(VENUES as unknown as string[])
  venue?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(BOOLEAN_FROM_QUERY)
  @IsBoolean()
  enabledOnly?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  definitionId?: string;
}

export class ListStrategyRunsDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ['STARTING', 'RUNNING', 'STOPPED', 'FAILED', 'HALTED'] })
  @IsOptional()
  @IsIn(['STARTING', 'RUNNING', 'STOPPED', 'FAILED', 'HALTED'])
  status?: string;
}

export class ListStrategyIncidentsDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ['INFO', 'WARNING', 'CRITICAL'] })
  @IsOptional()
  @IsIn(['INFO', 'WARNING', 'CRITICAL'])
  severity?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  strategyId?: string;

  @ApiPropertyOptional({ description: 'Only incidents nobody has closed yet.' })
  @IsOptional()
  @Transform(BOOLEAN_FROM_QUERY)
  @IsBoolean()
  unresolvedOnly?: boolean;
}

// -----------------------------------------------------------------------------
// Instance commands
// -----------------------------------------------------------------------------

export class EnableStrategyInstanceDto {
  @ApiProperty({
    description:
      'Why this strategy is being started. Stored on the audit record and on the run.',
    minLength: 10,
    maxLength: 500,
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(10, {
    message:
      'reason must be at least 10 characters. "test" is not a reason anyone can act on in six ' +
      'months.',
  })
  @MaxLength(500)
  reason!: string;

  @ApiPropertyOptional({
    description:
      'Required ONLY when the deployment is configured for LIVE execution. Must be the exact ' +
      'string "ENABLE STRATEGY IN LIVE MODE". Starting a strategy while live execution is ' +
      'armed is the one path where an automated decision can become a real order, so it is ' +
      'never a single click.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  confirmation?: string;
}

export class DisableStrategyInstanceDto {
  @ApiProperty({ minLength: 3, maxLength: 500 })
  @IsString()
  @IsNotEmpty()
  @MinLength(3, { message: 'reason must be at least 3 characters' })
  @MaxLength(500)
  reason!: string;
}

export class ResolveStrategyIncidentDto {
  @ApiProperty({
    description: 'What was found and what was done about it.',
    minLength: 10,
    maxLength: 1000,
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(10, { message: 'note must be at least 10 characters' })
  @MaxLength(1000)
  note!: string;
}

// -----------------------------------------------------------------------------
// Backtesting
// -----------------------------------------------------------------------------

export class SubmitBacktestDto {
  @ApiPropertyOptional({
    description:
      'Run against an existing instance, inheriting its venue, symbol and parameters. Provide ' +
      'either this or definitionKey + version.',
  })
  @IsOptional()
  @IsUUID('4')
  strategyId?: string;

  @ApiPropertyOptional({ description: 'Catalogue key, e.g. DETERMINISTIC_IMBALANCE_V1.' })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z0-9_]+$/, { message: 'definitionKey must be upper snake case' })
  @MaxLength(64)
  definitionKey?: string;

  @ApiPropertyOptional({ description: 'Published version, e.g. 1.0.0.' })
  @IsOptional()
  @IsString()
  @Matches(/^\d+\.\d+\.\d+$/, { message: 'version must be semantic, e.g. 1.0.0' })
  @MaxLength(20)
  version?: string;

  @ApiProperty({ enum: VENUES })
  @IsIn(VENUES as unknown as string[])
  venue!: string;

  @ApiProperty({ example: 'BTC-USDT' })
  @IsString()
  @Matches(SYMBOL_PATTERN, { message: 'symbol must be canonical, e.g. BTC-USDT' })
  @MaxLength(32)
  symbol!: string;

  @ApiPropertyOptional({ enum: MARKET_TYPES, default: 'SPOT' })
  @IsOptional()
  @IsIn(MARKET_TYPES as unknown as string[])
  marketType?: string;

  @ApiProperty({
    description:
      'Identifier of a stored dataset. The backtest replays that data; it fetches nothing ' +
      'from a venue and opens no socket.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  datasetId!: string;

  @ApiPropertyOptional({
    description:
      'Expected dataset checksum. When supplied, the worker refuses to run if the stored ' +
      'dataset does not match, because a result attributed to the wrong data is worse than ' +
      'no result.',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[0-9a-f]{16,64}$/, { message: 'datasetChecksum must be lowercase hex' })
  datasetChecksum?: string;

  @ApiPropertyOptional({
    description: 'Strategy parameters. Validated against the version parameter schema.',
  })
  @IsOptional()
  @IsObject()
  parameters?: Record<string, unknown>;

  @ApiPropertyOptional({
    description: 'Initial capital as a decimal string. Defaults to the configured value.',
    example: '10000',
  })
  @IsOptional()
  @IsString()
  @Matches(DECIMAL_PATTERN, { message: 'initialCapital must be a plain decimal string' })
  @MaxLength(30)
  initialCapital?: string;

  @ApiPropertyOptional({ description: 'Maker fee RATE, not bps. 0.001 is ten bps.' })
  @IsOptional()
  @IsString()
  @Matches(DECIMAL_PATTERN, { message: 'makerFeeRate must be a plain decimal string' })
  @MaxLength(12)
  makerFeeRate?: string;

  @ApiPropertyOptional({ description: 'Taker fee RATE, not bps.' })
  @IsOptional()
  @IsString()
  @Matches(DECIMAL_PATTERN, { message: 'takerFeeRate must be a plain decimal string' })
  @MaxLength(12)
  takerFeeRate?: string;

  @ApiPropertyOptional({ description: 'Slippage in basis points against every taker fill.' })
  @IsOptional()
  @IsString()
  @Matches(DECIMAL_PATTERN, { message: 'slippageBps must be a plain decimal string' })
  @MaxLength(12)
  slippageBps?: string;

  @ApiPropertyOptional({
    description: 'Simulated submit-to-fill latency in microseconds.',
    minimum: 0,
    maximum: 60_000_000,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(60_000_000)
  latencyMicros?: number;

  @ApiPropertyOptional({
    enum: ['TRAINING', 'VALIDATION', 'TEST'],
    description:
      'Walk-forward segment this run belongs to. Labelling only: the platform performs no ' +
      'parameter optimisation, so nothing here selects a winner for you.',
  })
  @IsOptional()
  @IsIn(['TRAINING', 'VALIDATION', 'TEST'])
  walkForwardSegment?: string;
}

export class ListBacktestRunsDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ['QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED'] })
  @IsOptional()
  @IsIn(['QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED'])
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  strategyId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(SYMBOL_PATTERN, { message: 'symbol must be canonical, e.g. BTC-USDT' })
  symbol?: string;

  @ApiPropertyOptional({
    description:
      'Find every run produced by one exact configuration. Two runs sharing this hash and a ' +
      'dataset checksum must have produced identical results.',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[0-9a-f]{64}$/, { message: 'configurationHash must be 64 lowercase hex characters' })
  configurationHash?: string;
}

// -----------------------------------------------------------------------------
// Paper trading
// -----------------------------------------------------------------------------

export class StartPaperSessionDto {
  @ApiProperty({ description: 'The instance to run. It is not started for live execution.' })
  @IsUUID('4')
  strategyId!: string;

  @ApiProperty({ example: 'BTC-USDT' })
  @IsString()
  @Matches(SYMBOL_PATTERN, { message: 'symbol must be canonical, e.g. BTC-USDT' })
  @MaxLength(32)
  symbol!: string;

  @ApiPropertyOptional({ example: '10000' })
  @IsOptional()
  @IsString()
  @Matches(DECIMAL_PATTERN, { message: 'initialCapital must be a plain decimal string' })
  @MaxLength(30)
  initialCapital?: string;

  @ApiProperty({ minLength: 10, maxLength: 500 })
  @IsString()
  @IsNotEmpty()
  @MinLength(10, { message: 'reason must be at least 10 characters' })
  @MaxLength(500)
  reason!: string;
}

export class StopPaperSessionDto {
  @ApiProperty({ minLength: 3, maxLength: 500 })
  @IsString()
  @IsNotEmpty()
  @MinLength(3, { message: 'reason must be at least 3 characters' })
  @MaxLength(500)
  reason!: string;
}

export class ListPaperSessionsDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ['STARTING', 'RUNNING', 'STOPPED', 'FAILED'] })
  @IsOptional()
  @IsIn(['STARTING', 'RUNNING', 'STOPPED', 'FAILED'])
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  strategyId?: string;
}

export class ListPaperSnapshotsDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 1000, default: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  limit?: number;
}
```

---

## FILE: apps/api/src/modules/strategy/strategy-catalog.service.ts

```ts
import { Injectable } from '@nestjs/common';
import type { PaginatedResult } from '@wlct/shared-types';
import { buildPaginationMeta, normalisePagination } from '@wlct/utils';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { NotFoundException } from '../../common/errors/app.exception';
import {
  toStrategyDefinitionView,
  toStrategyVersionView,
  type StrategyDefinitionRow,
  type StrategyVersionRow,
} from './strategy.mapper';
import type { StrategyDefinitionView, StrategyVersionView } from './strategy.types';

/**
 * The catalogue of strategy implementations and their published versions.
 *
 * Read-only over HTTP, and that is not a temporary state. A definition
 * describes a class that ships with the release; creating one from a request
 * body would produce a catalogue entry with no code behind it, and an operator
 * would eventually try to run it. Definitions and versions are seeded from the
 * registry by the deployment, which is the only place that knows what actually
 * exists.
 *
 * The catalogue is platform-level, not tenant-scoped: the same class for every
 * tenant, holding no customer data. Tenant scoping starts at the instance.
 */
@Injectable()
export class StrategyCatalogService {
  private static readonly VERSION_SELECT = {
    id: true,
    definitionId: true,
    version: true,
    status: true,
    implementationId: true,
    parameterSchema: true,
    defaultParameters: true,
    behaviourHash: true,
    changeNote: true,
    publishedAt: true,
    deprecatedAt: true,
    createdAt: true,
  } satisfies Prisma.StrategyVersionSelect;

  private static readonly DEFINITION_SELECT = {
    id: true,
    key: true,
    displayName: true,
    description: true,
    category: true,
    isImplemented: true,
    isReserved: true,
    riskNotes: true,
    createdAt: true,
    updatedAt: true,
    _count: { select: { versions: true } },
  } satisfies Prisma.StrategyDefinitionSelect;

  private static readonly SORTABLE_FIELDS = ['key', 'displayName', 'createdAt'] as const;

  constructor(private readonly prisma: PrismaService) {}

  async listDefinitions(filter: {
    includeReserved?: boolean;
    category?: string;
    page?: number;
    limit?: number;
    sortBy?: string;
    sortOrder?: string;
    search?: string;
  }): Promise<PaginatedResult<StrategyDefinitionView>> {
    const pagination = normalisePagination(filter, StrategyCatalogService.SORTABLE_FIELDS);

    // Reserved entries are hidden unless asked for. They exist to stop the
    // well-known ids being taken by something that is not what an operator
    // would expect; listing them beside runnable strategies invites an attempt
    // to run one.
    const where: Prisma.StrategyDefinitionWhereInput = {
      ...(filter.includeReserved ? {} : { isReserved: false }),
      ...(filter.category ? { category: filter.category } : {}),
      ...(pagination.search
        ? {
            OR: [
              { key: { contains: pagination.search, mode: 'insensitive' } },
              { displayName: { contains: pagination.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.strategyDefinition.findMany({
        where,
        select: StrategyCatalogService.DEFINITION_SELECT,
        orderBy: { [pagination.sortBy ?? 'key']: pagination.sortBy ? pagination.sortOrder : 'asc' },
        skip: pagination.skip,
        take: pagination.take,
      }),
      this.prisma.strategyDefinition.count({ where }),
    ]);

    return {
      items: rows.map((row) => toStrategyDefinitionView(row as StrategyDefinitionRow)),
      pagination: buildPaginationMeta(pagination.page, pagination.limit, total),
    };
  }

  async getDefinition(key: string): Promise<StrategyDefinitionView> {
    const row = await this.prisma.strategyDefinition.findUnique({
      where: { key },
      select: {
        ...StrategyCatalogService.DEFINITION_SELECT,
        versions: {
          select: StrategyCatalogService.VERSION_SELECT,
          orderBy: { version: 'asc' },
        },
      },
    });

    if (!row) {
      throw new NotFoundException('Strategy definition not found.');
    }

    return toStrategyDefinitionView(row as unknown as StrategyDefinitionRow);
  }

  async listVersions(key: string, filter: { status?: string }): Promise<StrategyVersionView[]> {
    const definition = await this.prisma.strategyDefinition.findUnique({
      where: { key },
      select: { id: true },
    });

    if (!definition) {
      throw new NotFoundException('Strategy definition not found.');
    }

    const rows = await this.prisma.strategyVersion.findMany({
      where: {
        definitionId: definition.id,
        ...(filter.status ? { status: filter.status as never } : {}),
      },
      select: StrategyCatalogService.VERSION_SELECT,
      orderBy: { version: 'asc' },
    });

    return rows.map((row) => toStrategyVersionView(row as StrategyVersionRow));
  }

  /**
   * Resolve a runnable version, or explain precisely why it is not runnable.
   *
   * Used by both the enable path and the backtest path. The four refusals are
   * distinct on purpose: "no such version" and "that version is a draft" send
   * an operator to entirely different places.
   */
  async resolveRunnableVersion(
    key: string,
    version: string,
  ): Promise<{
    definitionId: string;
    versionId: string;
    implementationId: string;
    parameterSchema: unknown;
    defaultParameters: unknown;
  }> {
    const definition = await this.prisma.strategyDefinition.findUnique({
      where: { key },
      select: { id: true, isImplemented: true, isReserved: true },
    });

    if (!definition) {
      throw new NotFoundException(`Strategy definition ${key} is not in the catalogue.`);
    }

    if (definition.isReserved || !definition.isImplemented) {
      throw new NotFoundException(
        `Strategy ${key} is a reserved identifier with no implementation behind it. ` +
          'It cannot be run.',
      );
    }

    const row = await this.prisma.strategyVersion.findFirst({
      where: { definitionId: definition.id, version },
      select: {
        id: true,
        status: true,
        implementationId: true,
        parameterSchema: true,
        defaultParameters: true,
      },
    });

    if (!row) {
      throw new NotFoundException(`Strategy ${key} has no version ${version}.`);
    }

    if (row.status === 'DRAFT') {
      throw new NotFoundException(
        `Version ${version} of ${key} is a draft. Publish it before running it: a draft's ` +
          'behaviour is still allowed to change, which would make any result from it ' +
          'unreproducible.',
      );
    }

    if (row.status === 'DISABLED') {
      throw new NotFoundException(`Version ${version} of ${key} is disabled.`);
    }

    return {
      definitionId: definition.id,
      versionId: row.id,
      implementationId: row.implementationId,
      parameterSchema: row.parameterSchema,
      defaultParameters: row.defaultParameters,
    };
  }
}
```

---

## FILE: apps/api/src/modules/strategy/strategy-instances.service.ts

```ts
import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AuditAction, AuditActorType, AuditOutcome } from '@wlct/shared-types';
import type { PaginatedResult } from '@wlct/shared-types';
import { buildPaginationMeta, normalisePagination, sanitiseForLog } from '@wlct/utils';
import { JOB_NAMES, QUEUE_NAMES } from '@wlct/config';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { QueueService } from '../queue/queue.service';
import { AppConfigService } from '../../config/app-config.service';
import {
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
  ValidationException,
} from '../../common/errors/app.exception';
import {
  toStrategyInstanceView,
  toStrategyRunView,
  type StrategyInstanceRow,
  type StrategyRunRow,
} from './strategy.mapper';
import type {
  StrategyCommandAcceptedView,
  StrategyInstanceStatusView,
  StrategyInstanceView,
  StrategyRunView,
} from './strategy.types';

/**
 * Strategy instances: read, inspect, start, stop.
 *
 * Three properties are enforced here rather than left to the caller.
 *
 * 1. **Starting a strategy is not starting live trading.** Enabling an
 *    instance makes it consume market data and emit signals. Whether a signal
 *    becomes an order is decided afterwards by the risk engine and the Part 5
 *    gates, which this service does not touch. When the deployment happens to
 *    be armed for LIVE execution, enabling additionally requires an explicit
 *    confirmation string, because that is the one configuration in which an
 *    automated decision can reach a venue.
 *
 * 2. **Stopping is always allowed.** No confirmation, a short reason, and a
 *    local status change that does not wait for the worker. A stop request
 *    that has to negotiate with a queue is a stop request that arrives too
 *    late.
 *
 * 3. **The API does not run strategies.** It records intent and queues work
 *    for the strategy worker. There is no code path from an HTTP request to a
 *    strategy tick, which is what keeps a slow or hostile request from
 *    entering the data plane.
 */
@Injectable()
export class StrategyInstancesService {
  /** The exact phrase required to enable an instance under LIVE execution. */
  public static readonly LIVE_CONFIRMATION = 'ENABLE STRATEGY IN LIVE MODE';

  private static readonly INSTANCE_SELECT = {
    id: true,
    tenantId: true,
    accountId: true,
    name: true,
    kind: true,
    version: true,
    definitionId: true,
    versionId: true,
    instanceKey: true,
    configVersion: true,
    status: true,
    enabled: true,
    health: true,
    failurePolicy: true,
    venue: true,
    symbols: true,
    marketType: true,
    description: true,
    maxOrderQuantity: true,
    maxPositionQuantity: true,
    maxOrderNotional: true,
    maxDailyLoss: true,
    maxOpenOrders: true,
    maxOrdersPerMinute: true,
    consecutiveErrors: true,
    lastHeartbeatAt: true,
    lastStartedAt: true,
    lastStoppedAt: true,
    lastErrorCode: true,
    quarantinedAt: true,
    quarantineReason: true,
    createdAt: true,
    updatedAt: true,
  } satisfies Prisma.StrategySelect;

  private static readonly RUN_SELECT = {
    id: true,
    strategyId: true,
    runMode: true,
    status: true,
    instanceKey: true,
    configVersion: true,
    strategyKey: true,
    strategyVersion: true,
    venue: true,
    symbols: true,
    marketType: true,
    startedAt: true,
    stoppedAt: true,
    stopReason: true,
    errorCode: true,
    counters: true,
    lastEventAtMicros: true,
  } satisfies Prisma.StrategyRunSelect;

  private static readonly SORTABLE_FIELDS = [
    'createdAt',
    'updatedAt',
    'name',
    'lastStartedAt',
  ] as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly queue: QueueService,
    private readonly config: AppConfigService,
    @InjectPinoLogger(StrategyInstancesService.name) private readonly logger: PinoLogger,
  ) {}

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  async list(filter: {
    tenantId: string;
    status?: string;
    health?: string;
    venue?: string;
    enabledOnly?: boolean;
    definitionId?: string;
    page?: number;
    limit?: number;
    sortBy?: string;
    sortOrder?: string;
    search?: string;
  }): Promise<PaginatedResult<StrategyInstanceView>> {
    const pagination = normalisePagination(filter, StrategyInstancesService.SORTABLE_FIELDS);

    const where: Prisma.StrategyWhereInput = {
      tenantId: filter.tenantId,
      deletedAt: null,
      ...(filter.status ? { status: filter.status as never } : {}),
      ...(filter.health ? { health: filter.health as never } : {}),
      ...(filter.venue ? { venue: filter.venue as never } : {}),
      ...(filter.enabledOnly ? { enabled: true } : {}),
      ...(filter.definitionId ? { definitionId: filter.definitionId } : {}),
      ...(pagination.search
        ? { name: { contains: pagination.search, mode: 'insensitive' } }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.strategy.findMany({
        where,
        select: StrategyInstancesService.INSTANCE_SELECT,
        orderBy: { [pagination.sortBy ?? 'createdAt']: pagination.sortOrder },
        skip: pagination.skip,
        take: pagination.take,
      }),
      this.prisma.strategy.count({ where }),
    ]);

    return {
      items: rows.map((row) => toStrategyInstanceView(row as StrategyInstanceRow)),
      pagination: buildPaginationMeta(pagination.page, pagination.limit, total),
    };
  }

  async get(tenantId: string, id: string): Promise<StrategyInstanceView> {
    return toStrategyInstanceView(await this.requireInstance(tenantId, id));
  }

  /**
   * Everything an operator needs in one call, including the two facts that are
   * easiest to assume wrongly: whether the engine is running at all, and
   * whether live execution is reachable.
   */
  async getStatus(tenantId: string, id: string): Promise<StrategyInstanceStatusView> {
    const instance = await this.requireInstance(tenantId, id);

    const [currentRun, openIncidents, criticalIncidents, lastCheckpoint] = await Promise.all([
      this.prisma.strategyRun.findFirst({
        where: { tenantId, strategyId: id, status: { in: ['STARTING', 'RUNNING'] } },
        select: StrategyInstancesService.RUN_SELECT,
        orderBy: { startedAt: 'desc' },
      }),
      this.prisma.strategyIncident.count({
        where: { tenantId, strategyId: id, resolvedAt: null },
      }),
      this.prisma.strategyIncident.count({
        where: { tenantId, strategyId: id, resolvedAt: null, severity: 'CRITICAL' },
      }),
      this.prisma.strategyCheckpoint.findFirst({
        where: { tenantId, strategyId: id },
        select: { createdAt: true },
        orderBy: { sequence: 'desc' },
      }),
    ]);

    return {
      instance: toStrategyInstanceView(instance),
      currentRun: currentRun ? toStrategyRunView(currentRun as StrategyRunRow) : null,
      openIncidents,
      criticalIncidents,
      lastCheckpointAt: lastCheckpoint ? lastCheckpoint.createdAt.toISOString() : null,
      engineEnabled: this.config.strategyEngineEnabled,
      tradingMode: this.config.tradingMode,
      liveExecutionReachable: this.config.tradingMode === 'LIVE',
    };
  }

  async listRuns(
    tenantId: string,
    id: string,
    filter: { status?: string; page?: number; limit?: number; sortOrder?: string },
  ): Promise<PaginatedResult<StrategyRunView>> {
    await this.requireInstance(tenantId, id);
    const pagination = normalisePagination(filter, ['startedAt']);

    const where: Prisma.StrategyRunWhereInput = {
      tenantId,
      strategyId: id,
      ...(filter.status ? { status: filter.status as never } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.strategyRun.findMany({
        where,
        select: StrategyInstancesService.RUN_SELECT,
        orderBy: { startedAt: pagination.sortOrder },
        skip: pagination.skip,
        take: pagination.take,
      }),
      this.prisma.strategyRun.count({ where }),
    ]);

    return {
      items: rows.map((row) => toStrategyRunView(row as StrategyRunRow)),
      pagination: buildPaginationMeta(pagination.page, pagination.limit, total),
    };
  }

  // ---------------------------------------------------------------------------
  // Commands
  // ---------------------------------------------------------------------------

  async enable(
    tenantId: string,
    id: string,
    actor: { userId: string; requestId?: string | null },
    input: { reason: string; confirmation?: string },
  ): Promise<StrategyCommandAcceptedView> {
    const instance = await this.requireInstance(tenantId, id);

    if (!this.config.strategyEngineEnabled) {
      throw new ConflictException(
        'The strategy engine is disabled in this deployment (STRATEGY_ENGINE_ENABLED=false). ' +
          'Enabling an instance now would record a state the engine will never act on.',
        { strategyEngineEnabled: false },
      );
    }

    if (instance.quarantinedAt !== null) {
      throw new ConflictException(
        'This instance is quarantined after a failure and cannot be started until the ' +
          'quarantine is cleared. Starting a strategy whose state is not trusted is exactly ' +
          'what the quarantine exists to prevent.',
      );
    }

    if (instance.enabled) {
      throw new ConflictException('This strategy instance is already enabled.');
    }

    if (instance.versionId === null) {
      throw new ValidationException([
        {
          field: 'versionId',
          constraint: 'required',
          message:
            'This instance is not bound to a published strategy version. Behaviour that is ' +
            'not pinned to a version can change underneath a running strategy.',
        },
      ]);
    }

    // The one place where enabling a strategy could lead to a real order.
    // Everywhere else the answer is structural; here it is a deliberate,
    // typed-out confirmation.
    if (this.config.tradingMode === 'LIVE') {
      if (input.confirmation !== StrategyInstancesService.LIVE_CONFIRMATION) {
        throw new ValidationException([
          {
            field: 'confirmation',
            constraint: 'exactPhrase',
            message:
              'This deployment is armed for LIVE execution. To start a strategy under it, ' +
              `send confirmation: "${StrategyInstancesService.LIVE_CONFIRMATION}". Signals ` +
              'from this instance will be evaluated by the risk engine and may become real ' +
              'orders.',
          },
        ]);
      }
    }

    const version = await this.prisma.strategyVersion.findFirst({
      where: { id: instance.versionId },
      select: { status: true, version: true },
    });

    if (!version || version.status === 'DRAFT' || version.status === 'DISABLED') {
      throw new ValidationException([
        {
          field: 'versionId',
          constraint: 'notRunnable',
          message:
            'The strategy version bound to this instance is not runnable. Publish it, or bind ' +
            'the instance to a published version.',
        },
      ]);
    }

    const jobId = await this.dispatch(JOB_NAMES.APPLY_STRATEGY_STATE, {
      tenantId,
      strategyId: id,
      desiredState: 'ENABLED',
      requestedByUserId: actor.userId,
      reason: sanitiseForLog(input.reason, 500),
    });

    await this.prisma.strategy.update({
      where: { id },
      data: { enabled: true, status: 'ENABLED', lastStartedAt: new Date() },
    });

    await this.audit.recordImmediate({
      tenantId,
      actorType: AuditActorType.USER,
      actorId: actor.userId,
      action: AuditAction.STRATEGY_INSTANCE_ENABLED,
      outcome: AuditOutcome.SUCCESS,
      resourceType: 'strategy_instance',
      resourceId: id,
      description: sanitiseForLog(input.reason, 500),
      metadata: {
        strategyKey: instance.kind,
        strategyVersion: instance.version,
        venue: instance.venue,
        symbols: instance.symbols,
        tradingMode: this.config.tradingMode,
        liveExecutionReachable: this.config.tradingMode === 'LIVE',
        jobId,
      },
      requestId: actor.requestId ?? null,
    });

    this.logger.info(
      {
        event: 'strategy.instance_enabled',
        tenantId,
        strategyId: id,
        strategyKey: instance.kind,
        strategyVersion: instance.version,
        tradingMode: this.config.tradingMode,
        actorId: actor.userId,
      },
      'Strategy instance enabled',
    );

    return {
      accepted: true,
      command: JOB_NAMES.APPLY_STRATEGY_STATE,
      jobId,
      requestedAt: new Date().toISOString(),
      note:
        'The instance is marked enabled and the strategy worker has been asked to start it. ' +
        'Starting a strategy does not enable live trading: signals are still evaluated by the ' +
        `risk engine, and the effective trading mode is ${this.config.tradingMode}.`,
    };
  }

  async disable(
    tenantId: string,
    id: string,
    actor: { userId: string; requestId?: string | null },
    input: { reason: string },
  ): Promise<StrategyCommandAcceptedView> {
    const instance = await this.requireInstance(tenantId, id);

    if (!instance.enabled) {
      throw new ConflictException('This strategy instance is already disabled.');
    }

    // Note the ordering: local state is changed FIRST, and the queue dispatch
    // follows. It is the opposite of `enable`, and deliberately so. If Redis is
    // down, an operator who asked to stop a strategy must still end up with a
    // strategy that is marked stopped and will not be restarted by the next
    // reconciliation; a failure to notify is recoverable, a strategy that
    // stays enabled because a queue was unavailable is not.
    await this.prisma.strategy.update({
      where: { id },
      data: { enabled: false, status: 'DISABLED', lastStoppedAt: new Date() },
    });

    let jobId = 'not-queued';
    try {
      jobId = await this.dispatch(JOB_NAMES.APPLY_STRATEGY_STATE, {
        tenantId,
        strategyId: id,
        desiredState: 'DISABLED',
        requestedByUserId: actor.userId,
        reason: sanitiseForLog(input.reason, 500),
      });
    } catch (error) {
      this.logger.error(
        {
          event: 'strategy.disable_dispatch_failed',
          tenantId,
          strategyId: id,
          message: (error as Error).message,
        },
        'Strategy marked disabled locally but the worker could not be notified',
      );
    }

    await this.audit.recordImmediate({
      tenantId,
      actorType: AuditActorType.USER,
      actorId: actor.userId,
      action: AuditAction.STRATEGY_INSTANCE_DISABLED,
      outcome: AuditOutcome.SUCCESS,
      resourceType: 'strategy_instance',
      resourceId: id,
      description: sanitiseForLog(input.reason, 500),
      metadata: {
        strategyKey: instance.kind,
        strategyVersion: instance.version,
        jobId,
      },
      requestId: actor.requestId ?? null,
    });

    this.logger.info(
      {
        event: 'strategy.instance_disabled',
        tenantId,
        strategyId: id,
        strategyKey: instance.kind,
        actorId: actor.userId,
      },
      'Strategy instance disabled',
    );

    return {
      accepted: true,
      command: JOB_NAMES.APPLY_STRATEGY_STATE,
      jobId,
      requestedAt: new Date().toISOString(),
      note:
        'The instance is marked disabled immediately. The worker has been asked to stop it; ' +
        'if that notification failed the instance still will not be restarted, because the ' +
        'engine only runs what is marked enabled.',
    };
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private async requireInstance(tenantId: string, id: string): Promise<StrategyInstanceRow> {
    const row = await this.prisma.strategy.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: StrategyInstancesService.INSTANCE_SELECT,
    });

    if (!row) {
      // Not "forbidden": a tenant must not be able to discover that an id
      // exists in another tenant by comparing 403 against 404.
      throw new NotFoundException('Strategy instance');
    }

    return row as StrategyInstanceRow;
  }

  private async dispatch(command: string, payload: Record<string, unknown>): Promise<string> {
    try {
      const jobId = await this.queue.enqueueOrThrow(QUEUE_NAMES.STRATEGY_CONTROL, command, {
        ...payload,
        requestedAt: new Date().toISOString(),
      });
      return jobId ?? 'unknown';
    } catch (error) {
      throw new ServiceUnavailableException(
        'The strategy control queue is unavailable, so the worker cannot be notified. ' +
          'Nothing was started.',
        (error as Error).message,
      );
    }
  }
}
```

---

## FILE: apps/api/src/modules/strategy/strategy-incidents.service.ts

```ts
import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AuditAction, AuditActorType, AuditOutcome } from '@wlct/shared-types';
import type { PaginatedResult } from '@wlct/shared-types';
import { buildPaginationMeta, normalisePagination, sanitiseForLog } from '@wlct/utils';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ConflictException, NotFoundException } from '../../common/errors/app.exception';
import { toStrategyIncidentView, type StrategyIncidentRow } from './strategy.mapper';
import type { StrategyIncidentView } from './strategy.types';

export interface StrategyIncidentCounts {
  open: number;
  critical: number;
  warning: number;
  info: number;
}

/**
 * Strategy incidents: read, count, close.
 *
 * As with execution incidents, there is no `create`. An incident is raised by
 * the strategy worker at the moment something went wrong, with context only
 * the worker has. An HTTP endpoint that let a client invent one would produce
 * a table in which real and imagined incidents are indistinguishable.
 *
 * Closing is the only mutation and it is append-only in spirit: the resolution
 * fields are filled in, and nothing describing what happened is ever edited.
 */
@Injectable()
export class StrategyIncidentsService {
  private static readonly INCIDENT_SELECT = {
    id: true,
    strategyId: true,
    runId: true,
    incidentType: true,
    severity: true,
    venue: true,
    symbol: true,
    errorCode: true,
    summary: true,
    details: true,
    occurredAtMicros: true,
    resolvedAt: true,
    resolvedBy: true,
    resolutionNote: true,
    createdAt: true,
  } satisfies Prisma.StrategyIncidentSelect;

  private static readonly SORTABLE_FIELDS = ['createdAt', 'severity'] as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @InjectPinoLogger(StrategyIncidentsService.name) private readonly logger: PinoLogger,
  ) {}

  async list(filter: {
    tenantId: string;
    severity?: string;
    strategyId?: string;
    unresolvedOnly?: boolean;
    page?: number;
    limit?: number;
    sortBy?: string;
    sortOrder?: string;
  }): Promise<PaginatedResult<StrategyIncidentView>> {
    const pagination = normalisePagination(filter, StrategyIncidentsService.SORTABLE_FIELDS);

    const where: Prisma.StrategyIncidentWhereInput = {
      tenantId: filter.tenantId,
      ...(filter.severity ? { severity: filter.severity as never } : {}),
      ...(filter.strategyId ? { strategyId: filter.strategyId } : {}),
      ...(filter.unresolvedOnly ? { resolvedAt: null } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.strategyIncident.findMany({
        where,
        select: StrategyIncidentsService.INCIDENT_SELECT,
        orderBy: { [pagination.sortBy ?? 'createdAt']: pagination.sortOrder },
        skip: pagination.skip,
        take: pagination.take,
      }),
      this.prisma.strategyIncident.count({ where }),
    ]);

    return {
      items: rows.map((row) => toStrategyIncidentView(row as StrategyIncidentRow)),
      pagination: buildPaginationMeta(pagination.page, pagination.limit, total),
    };
  }

  async counts(tenantId: string): Promise<StrategyIncidentCounts> {
    const [open, critical, warning, info] = await Promise.all([
      this.prisma.strategyIncident.count({ where: { tenantId, resolvedAt: null } }),
      this.prisma.strategyIncident.count({
        where: { tenantId, resolvedAt: null, severity: 'CRITICAL' },
      }),
      this.prisma.strategyIncident.count({
        where: { tenantId, resolvedAt: null, severity: 'WARNING' },
      }),
      this.prisma.strategyIncident.count({
        where: { tenantId, resolvedAt: null, severity: 'INFO' },
      }),
    ]);

    return { open, critical, warning, info };
  }

  async resolve(
    tenantId: string,
    incidentId: string,
    actor: { userId: string; requestId?: string | null },
    note: string,
  ): Promise<StrategyIncidentView> {
    const existing = await this.prisma.strategyIncident.findFirst({
      where: { id: incidentId, tenantId },
      select: StrategyIncidentsService.INCIDENT_SELECT,
    });

    if (!existing) {
      throw new NotFoundException('Strategy incident');
    }

    if (existing.resolvedAt !== null) {
      throw new ConflictException('This incident has already been resolved.');
    }

    const updated = await this.prisma.strategyIncident.update({
      where: { id: incidentId },
      data: {
        resolvedAt: new Date(),
        resolvedBy: actor.userId,
        resolutionNote: sanitiseForLog(note, 1000),
      },
      select: StrategyIncidentsService.INCIDENT_SELECT,
    });

    await this.audit.recordImmediate({
      tenantId,
      actorType: AuditActorType.USER,
      actorId: actor.userId,
      action: AuditAction.STRATEGY_INCIDENT_RESOLVED,
      outcome: AuditOutcome.SUCCESS,
      resourceType: 'strategy_incident',
      resourceId: incidentId,
      description: sanitiseForLog(note, 500),
      metadata: {
        incidentType: existing.incidentType,
        severity: existing.severity,
        errorCode: existing.errorCode,
        strategyId: existing.strategyId,
        runId: existing.runId,
      },
      requestId: actor.requestId ?? null,
    });

    this.logger.info(
      {
        event: 'strategy.incident_resolved',
        tenantId,
        incidentId,
        incidentType: existing.incidentType,
        severity: existing.severity,
        actorId: actor.userId,
      },
      'Strategy incident resolved',
    );

    return toStrategyIncidentView(updated as StrategyIncidentRow);
  }
}
```

---

## FILE: apps/api/src/modules/strategy/backtest.service.ts

```ts
import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AuditAction, AuditActorType, AuditOutcome } from '@wlct/shared-types';
import type { PaginatedResult } from '@wlct/shared-types';
import { buildPaginationMeta, normalisePagination, sanitiseForLog } from '@wlct/utils';
import { JOB_NAMES, QUEUE_NAMES } from '@wlct/config';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { QueueService } from '../queue/queue.service';
import { AppConfigService } from '../../config/app-config.service';
import {
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
  ValidationException,
} from '../../common/errors/app.exception';
import { StrategyCatalogService } from './strategy-catalog.service';
import {
  toBacktestMetricView,
  toBacktestRunView,
  toBacktestTradeView,
  type BacktestMetricRow,
  type BacktestRunRow,
  type BacktestTradeRow,
} from './strategy.mapper';
import type {
  BacktestMetricView,
  BacktestRunView,
  BacktestTradeView,
} from './strategy.types';

/**
 * Backtest submission and results.
 *
 * A backtest opens no socket, holds no credential and touches no venue: it
 * replays a stored, checksummed dataset through the same strategy code that
 * runs live. That is the whole point of it, and it is why this is the least
 * dangerous endpoint in the platform - and why the results it produces are the
 * easiest to over-trust.
 *
 * Which is the other half of this service's job. Every row it returns is
 * labelled simulated and carries the disclaimer, the risk-adjusted figures are
 * withheld rather than invented when there were too few observations, and the
 * configuration hash plus dataset checksum are returned so that a result can
 * be reproduced rather than merely believed.
 *
 * The API does not run the backtest. It records a QUEUED row and hands the
 * work to the strategy worker; a replay of a month of book updates is not
 * something to do inside an HTTP request.
 */
@Injectable()
export class BacktestService {
  private static readonly RUN_SELECT = {
    id: true,
    runIdentifier: true,
    status: true,
    strategyId: true,
    definitionId: true,
    versionId: true,
    strategyKey: true,
    strategyVersion: true,
    implementationId: true,
    venue: true,
    symbol: true,
    marketType: true,
    datasetId: true,
    datasetSource: true,
    datasetChecksum: true,
    granularity: true,
    windowStartMicros: true,
    windowEndMicros: true,
    eventCount: true,
    walkForwardSegment: true,
    initialCapital: true,
    makerFeeRate: true,
    takerFeeRate: true,
    slippageBps: true,
    latencyMicros: true,
    parameters: true,
    assumptions: true,
    finalEquity: true,
    netPnl: true,
    grossProfit: true,
    grossLoss: true,
    feesPaid: true,
    slippageCost: true,
    totalReturnPercent: true,
    maxDrawdown: true,
    maxDrawdownPercent: true,
    totalTrades: true,
    winningTrades: true,
    losingTrades: true,
    winRate: true,
    averageTrade: true,
    largestWin: true,
    largestLoss: true,
    profitFactor: true,
    sharpeRatio: true,
    sortinoRatio: true,
    hasSufficientObservations: true,
    exposurePercent: true,
    turnover: true,
    configurationHash: true,
    engineVersion: true,
    isReproducible: true,
    jobId: true,
    queuedAt: true,
    startedAt: true,
    completedAt: true,
    durationMs: true,
    errorCode: true,
    errorSummary: true,
  } satisfies Prisma.BacktestRunSelect;

  private static readonly SORTABLE_FIELDS = ['queuedAt', 'completedAt', 'netPnl'] as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: StrategyCatalogService,
    private readonly audit: AuditService,
    private readonly queue: QueueService,
    private readonly config: AppConfigService,
    @InjectPinoLogger(BacktestService.name) private readonly logger: PinoLogger,
  ) {}

  // ---------------------------------------------------------------------------
  // Submission
  // ---------------------------------------------------------------------------

  async submit(
    tenantId: string,
    actor: { userId: string; requestId?: string | null },
    input: {
      strategyId?: string;
      definitionKey?: string;
      version?: string;
      venue: string;
      symbol: string;
      marketType?: string;
      datasetId: string;
      datasetChecksum?: string;
      parameters?: Record<string, unknown>;
      initialCapital?: string;
      makerFeeRate?: string;
      takerFeeRate?: string;
      slippageBps?: string;
      latencyMicros?: number;
      walkForwardSegment?: string;
    },
  ): Promise<BacktestRunView> {
    if (!this.config.backtestEnabled) {
      throw new ConflictException(
        'Backtesting is disabled in this deployment (BACKTEST_ENABLED=false).',
        { backtestEnabled: false },
      );
    }

    const resolved = await this.resolveTarget(tenantId, input);

    // Assumptions are resolved here rather than in the worker so that the
    // stored row states exactly what was assumed, even if the defaults change
    // between submission and execution. A result whose costs are ambiguous is
    // not a result.
    const defaults = this.config.backtestDefaults;
    const initialCapital = input.initialCapital ?? defaults.initialCapital;
    const makerFeeRate = input.makerFeeRate ?? defaults.makerFee;
    const takerFeeRate = input.takerFeeRate ?? defaults.takerFee;
    const slippageBps = input.slippageBps ?? defaults.slippageBps;

    if (Number.parseFloat(initialCapital) <= 0) {
      throw new ValidationException([
        {
          field: 'initialCapital',
          constraint: 'positive',
          message: 'initialCapital must be greater than zero.',
        },
      ]);
    }

    // A queued run has no engine-assigned identifier yet: that id is derived
    // deterministically by the engine from the configuration and the dataset,
    // and inventing one here would mean writing an id that the reproducibility
    // check later disagrees with. A placeholder is used until the worker
    // reports the real one.
    const placeholderIdentifier = `pending-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 10)}`;

    const created = await this.prisma.backtestRun.create({
      data: {
        tenantId,
        requestedByUserId: actor.userId,
        strategyId: resolved.strategyId,
        definitionId: resolved.definitionId,
        versionId: resolved.versionId,
        strategyKey: resolved.strategyKey,
        strategyVersion: resolved.strategyVersion,
        implementationId: resolved.implementationId,
        status: 'QUEUED',
        venue: input.venue as never,
        symbol: input.symbol,
        marketType: (input.marketType ?? 'SPOT') as never,
        datasetId: input.datasetId,
        datasetSource: 'STORED',
        datasetChecksum: input.datasetChecksum ?? null,
        windowStartMicros: BigInt(0),
        windowEndMicros: BigInt(0),
        initialCapital,
        makerFeeRate,
        takerFeeRate,
        slippageBps,
        latencyMicros: BigInt(input.latencyMicros ?? 0),
        parameters: (input.parameters ?? resolved.parameters) as Prisma.InputJsonValue,
        assumptions: {
          minimumFillQuantity: null,
          partialFillsEnabled: true,
          source: 'api-submission',
        } as Prisma.InputJsonValue,
        walkForwardSegment: input.walkForwardSegment ?? null,
        // Filled in by the worker from the engine's own deterministic values.
        runIdentifier: placeholderIdentifier,
        configurationHash: '',
        engineVersion: '0.6.0',
        isReproducible: Boolean(input.datasetChecksum),
      },
      select: BacktestService.RUN_SELECT,
    });

    let jobId: string;
    try {
      jobId = await this.queue.enqueueOrThrow(QUEUE_NAMES.STRATEGY_CONTROL, JOB_NAMES.RUN_BACKTEST, {
        tenantId,
        backtestRunId: created.id,
        requestedByUserId: actor.userId,
        requestedAt: new Date().toISOString(),
      });
    } catch (error) {
      // The row is marked FAILED rather than left QUEUED forever. A queued
      // backtest that nothing will ever pick up is worse than a failed one: it
      // looks like it is about to produce an answer.
      await this.prisma.backtestRun.update({
        where: { id: created.id },
        data: {
          status: 'FAILED',
          errorCode: 'QUEUE_UNAVAILABLE',
          errorSummary: 'The strategy control queue was unavailable at submission time.',
          completedAt: new Date(),
        },
      });

      this.logger.error(
        {
          event: 'backtest.enqueue_failed',
          tenantId,
          backtestRunId: created.id,
          message: (error as Error).message,
        },
        'Failed to queue backtest',
      );

      throw new ServiceUnavailableException(
        'The strategy control queue is unavailable, so the backtest could not be scheduled.',
        (error as Error).message,
      );
    }

    const withJob = await this.prisma.backtestRun.update({
      where: { id: created.id },
      data: { jobId },
      select: BacktestService.RUN_SELECT,
    });

    await this.audit.recordImmediate({
      tenantId,
      actorType: AuditActorType.USER,
      actorId: actor.userId,
      action: AuditAction.BACKTEST_SUBMITTED,
      outcome: AuditOutcome.SUCCESS,
      resourceType: 'backtest_run',
      resourceId: created.id,
      description: sanitiseForLog(
        `Backtest of ${resolved.strategyKey}@${resolved.strategyVersion} on ${input.symbol}`,
        500,
      ),
      metadata: {
        strategyKey: resolved.strategyKey,
        strategyVersion: resolved.strategyVersion,
        symbol: input.symbol,
        venue: input.venue,
        datasetId: input.datasetId,
        datasetChecksum: input.datasetChecksum ?? null,
        initialCapital,
        makerFeeRate,
        takerFeeRate,
        slippageBps,
        jobId,
      },
      requestId: actor.requestId ?? null,
    });

    this.logger.info(
      {
        event: 'backtest.submitted',
        tenantId,
        backtestRunId: created.id,
        strategyKey: resolved.strategyKey,
        strategyVersion: resolved.strategyVersion,
        symbol: input.symbol,
        datasetId: input.datasetId,
        actorId: actor.userId,
      },
      'Backtest submitted',
    );

    return toBacktestRunView(withJob as BacktestRunRow);
  }

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  async list(filter: {
    tenantId: string;
    status?: string;
    strategyId?: string;
    symbol?: string;
    configurationHash?: string;
    page?: number;
    limit?: number;
    sortBy?: string;
    sortOrder?: string;
  }): Promise<PaginatedResult<BacktestRunView>> {
    const pagination = normalisePagination(filter, BacktestService.SORTABLE_FIELDS);

    const where: Prisma.BacktestRunWhereInput = {
      tenantId: filter.tenantId,
      ...(filter.status ? { status: filter.status as never } : {}),
      ...(filter.strategyId ? { strategyId: filter.strategyId } : {}),
      ...(filter.symbol ? { symbol: filter.symbol } : {}),
      ...(filter.configurationHash ? { configurationHash: filter.configurationHash } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.backtestRun.findMany({
        where,
        select: BacktestService.RUN_SELECT,
        orderBy: { [pagination.sortBy ?? 'queuedAt']: pagination.sortOrder },
        skip: pagination.skip,
        take: pagination.take,
      }),
      this.prisma.backtestRun.count({ where }),
    ]);

    return {
      items: rows.map((row) => toBacktestRunView(row as BacktestRunRow)),
      pagination: buildPaginationMeta(pagination.page, pagination.limit, total),
    };
  }

  async get(tenantId: string, id: string): Promise<BacktestRunView> {
    const row = await this.prisma.backtestRun.findFirst({
      where: { id, tenantId },
      select: BacktestService.RUN_SELECT,
    });

    if (!row) {
      throw new NotFoundException('Backtest run');
    }

    return toBacktestRunView(row as BacktestRunRow);
  }

  async listMetrics(tenantId: string, id: string): Promise<BacktestMetricView[]> {
    await this.get(tenantId, id);

    const rows = await this.prisma.backtestMetric.findMany({
      where: { tenantId, backtestRunId: id },
      select: {
        name: true,
        value: true,
        unit: true,
        observationCount: true,
        isSufficient: true,
        note: true,
      },
      orderBy: { name: 'asc' },
    });

    return rows.map((row) => toBacktestMetricView(row as BacktestMetricRow));
  }

  async listTrades(
    tenantId: string,
    id: string,
    filter: { page?: number; limit?: number },
  ): Promise<PaginatedResult<BacktestTradeView>> {
    await this.get(tenantId, id);
    const pagination = normalisePagination(filter, ['sequence']);

    const where: Prisma.BacktestTradeWhereInput = { tenantId, backtestRunId: id };

    const [rows, total] = await Promise.all([
      this.prisma.backtestTrade.findMany({
        where,
        select: {
          sequence: true,
          symbol: true,
          direction: true,
          quantity: true,
          entryPrice: true,
          exitPrice: true,
          grossPnl: true,
          fees: true,
          netPnl: true,
          isWin: true,
          openedAtMicros: true,
          closedAtMicros: true,
          holdingMicros: true,
        },
        orderBy: { sequence: 'asc' },
        skip: pagination.skip,
        take: pagination.take,
      }),
      this.prisma.backtestTrade.count({ where }),
    ]);

    return {
      items: rows.map((row) => toBacktestTradeView(row as BacktestTradeRow)),
      pagination: buildPaginationMeta(pagination.page, pagination.limit, total),
    };
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private async resolveTarget(
    tenantId: string,
    input: { strategyId?: string; definitionKey?: string; version?: string },
  ): Promise<{
    strategyId: string | null;
    definitionId: string | null;
    versionId: string | null;
    strategyKey: string;
    strategyVersion: string;
    implementationId: string;
    parameters: Record<string, unknown>;
  }> {
    if (input.strategyId) {
      const instance = await this.prisma.strategy.findFirst({
        where: { id: input.strategyId, tenantId, deletedAt: null },
        select: {
          id: true,
          kind: true,
          version: true,
          definitionId: true,
          versionId: true,
          configurations: {
            where: { isActive: true },
            select: { parameters: true },
            take: 1,
          },
        },
      });

      if (!instance) {
        throw new NotFoundException('Strategy instance');
      }

      const runnable = await this.catalog.resolveRunnableVersion(instance.kind, instance.version);

      return {
        strategyId: instance.id,
        definitionId: instance.definitionId ?? runnable.definitionId,
        versionId: instance.versionId ?? runnable.versionId,
        strategyKey: instance.kind,
        strategyVersion: instance.version,
        implementationId: runnable.implementationId,
        parameters: (instance.configurations[0]?.parameters ?? {}) as Record<string, unknown>,
      };
    }

    if (!input.definitionKey || !input.version) {
      throw new ValidationException([
        {
          field: 'strategyId',
          constraint: 'oneOfRequired',
          message:
            'Provide either strategyId, or definitionKey together with version. A backtest ' +
            'has to know exactly which code it is running, or its result means nothing.',
        },
      ]);
    }

    const runnable = await this.catalog.resolveRunnableVersion(
      input.definitionKey,
      input.version,
    );

    return {
      strategyId: null,
      definitionId: runnable.definitionId,
      versionId: runnable.versionId,
      strategyKey: input.definitionKey,
      strategyVersion: input.version,
      implementationId: runnable.implementationId,
      parameters: (runnable.defaultParameters ?? {}) as Record<string, unknown>,
    };
  }
}
```

---

## FILE: apps/api/src/modules/strategy/paper-sessions.service.ts

```ts
import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AuditAction, AuditActorType, AuditOutcome } from '@wlct/shared-types';
import type { PaginatedResult } from '@wlct/shared-types';
import { buildPaginationMeta, normalisePagination, sanitiseForLog } from '@wlct/utils';
import { JOB_NAMES, QUEUE_NAMES } from '@wlct/config';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { QueueService } from '../queue/queue.service';
import { AppConfigService } from '../../config/app-config.service';
import {
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
  ValidationException,
} from '../../common/errors/app.exception';
import {
  toPaperSessionView,
  toPaperSnapshotView,
  type PaperSessionRow,
  type PaperSnapshotRow,
} from './strategy.mapper';
import type { PaperSessionView, PaperSnapshotView } from './strategy.types';

/**
 * Paper trading sessions: start, stop, read.
 *
 * A paper session runs a real strategy against a real market feed and fills it
 * against a simulator. The prices are real; the fills are not. Everything this
 * service returns says so.
 *
 * The safety property that matters is enforced in the engine, not here: the
 * session object refuses to be constructed with an adapter that is not marked
 * simulated, so there is no object in a running session capable of reaching a
 * venue. What this service adds is the second half of that guarantee - it
 * cannot be used to start anything else. `startSession` queues exactly one job
 * name, the worker's paper entry point, and there is no parameter on it that
 * selects an execution mode.
 */
@Injectable()
export class PaperSessionsService {
  private static readonly SESSION_SELECT = {
    id: true,
    sessionIdentifier: true,
    status: true,
    strategyId: true,
    strategyKey: true,
    strategyVersion: true,
    venue: true,
    symbol: true,
    marketType: true,
    initialCapital: true,
    currentEquity: true,
    realisedPnl: true,
    unrealisedPnl: true,
    feesPaid: true,
    maxDrawdown: true,
    signalsGenerated: true,
    signalsAccepted: true,
    signalsRejected: true,
    riskRejections: true,
    simulatedOrders: true,
    simulatedFills: true,
    strategyErrors: true,
    startedAt: true,
    stoppedAt: true,
    stopReason: true,
    errorCode: true,
  } satisfies Prisma.PaperTradingSessionSelect;

  private static readonly SORTABLE_FIELDS = ['startedAt', 'stoppedAt'] as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly queue: QueueService,
    private readonly config: AppConfigService,
    @InjectPinoLogger(PaperSessionsService.name) private readonly logger: PinoLogger,
  ) {}

  // ---------------------------------------------------------------------------
  // Commands
  // ---------------------------------------------------------------------------

  async start(
    tenantId: string,
    actor: { userId: string; requestId?: string | null },
    input: { strategyId: string; symbol: string; initialCapital?: string; reason: string },
  ): Promise<PaperSessionView> {
    if (!this.config.paperTradingEnabled) {
      throw new ConflictException(
        'Paper trading is disabled in this deployment (PAPER_TRADING_ENABLED=false).',
        { paperTradingEnabled: false },
      );
    }

    if (!this.config.strategyEngineEnabled) {
      throw new ConflictException(
        'The strategy engine is disabled (STRATEGY_ENGINE_ENABLED=false), so a paper session ' +
          'would receive no market data and make no decisions.',
        { strategyEngineEnabled: false },
      );
    }

    const instance = await this.prisma.strategy.findFirst({
      where: { id: input.strategyId, tenantId, deletedAt: null },
      select: {
        id: true,
        kind: true,
        version: true,
        venue: true,
        symbols: true,
        marketType: true,
        quarantinedAt: true,
      },
    });

    if (!instance) {
      throw new NotFoundException('Strategy instance');
    }

    if (instance.quarantinedAt !== null) {
      throw new ConflictException(
        'This instance is quarantined after a failure. Clear the quarantine before running it, ' +
          'including on paper: a strategy whose state is not trusted produces results that are ' +
          'not worth reading.',
      );
    }

    if (!instance.symbols.includes(input.symbol)) {
      throw new ValidationException([
        {
          field: 'symbol',
          constraint: 'notSubscribed',
          message: `This instance is not configured for ${input.symbol}.`,
        },
      ]);
    }

    const running = await this.prisma.paperTradingSession.findFirst({
      where: {
        tenantId,
        strategyId: input.strategyId,
        symbol: input.symbol,
        status: { in: ['STARTING', 'RUNNING'] },
      },
      select: { id: true },
    });

    if (running) {
      throw new ConflictException(
        'A paper session is already running for this instance and symbol. Two sessions on one ' +
          'instance would share the strategy state and produce two sets of numbers that ' +
          'describe neither.',
        { sessionId: running.id },
      );
    }

    const initialCapital = input.initialCapital ?? this.config.backtestDefaults.initialCapital;

    if (Number.parseFloat(initialCapital) <= 0) {
      throw new ValidationException([
        {
          field: 'initialCapital',
          constraint: 'positive',
          message: 'initialCapital must be greater than zero.',
        },
      ]);
    }

    const sessionIdentifier = `paper-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 10)}`;

    const created = await this.prisma.paperTradingSession.create({
      data: {
        tenantId,
        strategyId: instance.id,
        requestedByUserId: actor.userId,
        sessionIdentifier,
        status: 'STARTING',
        strategyKey: instance.kind,
        strategyVersion: instance.version,
        venue: instance.venue,
        symbol: input.symbol,
        marketType: instance.marketType,
        initialCapital,
        // Not a default someone can forget to set: written explicitly on every
        // insert, because this column is what tells a reader of the raw table
        // that none of these numbers came from a real account.
        isSimulated: true,
      },
      select: PaperSessionsService.SESSION_SELECT,
    });

    try {
      await this.queue.enqueueOrThrow(
        QUEUE_NAMES.STRATEGY_CONTROL,
        JOB_NAMES.START_PAPER_SESSION,
        {
          tenantId,
          sessionId: created.id,
          strategyId: instance.id,
          symbol: input.symbol,
          initialCapital,
          requestedByUserId: actor.userId,
          requestedAt: new Date().toISOString(),
        },
      );
    } catch (error) {
      await this.prisma.paperTradingSession.update({
        where: { id: created.id },
        data: {
          status: 'FAILED',
          errorCode: 'QUEUE_UNAVAILABLE',
          stoppedAt: new Date(),
          stopReason: 'The strategy control queue was unavailable at start time.',
        },
      });

      throw new ServiceUnavailableException(
        'The strategy control queue is unavailable, so the paper session could not be started.',
        (error as Error).message,
      );
    }

    await this.audit.recordImmediate({
      tenantId,
      actorType: AuditActorType.USER,
      actorId: actor.userId,
      action: AuditAction.PAPER_SESSION_STARTED,
      outcome: AuditOutcome.SUCCESS,
      resourceType: 'paper_trading_session',
      resourceId: created.id,
      description: sanitiseForLog(input.reason, 500),
      metadata: {
        strategyId: instance.id,
        strategyKey: instance.kind,
        strategyVersion: instance.version,
        symbol: input.symbol,
        venue: instance.venue,
        initialCapital,
        isSimulated: true,
      },
      requestId: actor.requestId ?? null,
    });

    this.logger.info(
      {
        event: 'strategy.paper_session_started',
        tenantId,
        sessionId: created.id,
        strategyId: instance.id,
        symbol: input.symbol,
        actorId: actor.userId,
      },
      'Paper trading session started',
    );

    return toPaperSessionView(created as PaperSessionRow);
  }

  async stop(
    tenantId: string,
    sessionId: string,
    actor: { userId: string; requestId?: string | null },
    input: { reason: string },
  ): Promise<PaperSessionView> {
    const existing = await this.prisma.paperTradingSession.findFirst({
      where: { id: sessionId, tenantId },
      select: PaperSessionsService.SESSION_SELECT,
    });

    if (!existing) {
      throw new NotFoundException('Paper trading session');
    }

    if (existing.status === 'STOPPED' || existing.status === 'FAILED') {
      throw new ConflictException('This paper session has already ended.');
    }

    // Local state first, queue second - the same ordering, and for the same
    // reason, as disabling an instance. A stop must not depend on Redis.
    const updated = await this.prisma.paperTradingSession.update({
      where: { id: sessionId },
      data: {
        status: 'STOPPED',
        stoppedAt: new Date(),
        stopReason: sanitiseForLog(input.reason, 500),
      },
      select: PaperSessionsService.SESSION_SELECT,
    });

    try {
      await this.queue.enqueueOrThrow(
        QUEUE_NAMES.STRATEGY_CONTROL,
        JOB_NAMES.STOP_PAPER_SESSION,
        {
          tenantId,
          sessionId,
          requestedByUserId: actor.userId,
          requestedAt: new Date().toISOString(),
        },
      );
    } catch (error) {
      this.logger.error(
        {
          event: 'strategy.paper_stop_dispatch_failed',
          tenantId,
          sessionId,
          message: (error as Error).message,
        },
        'Paper session marked stopped locally but the worker could not be notified',
      );
    }

    await this.audit.recordImmediate({
      tenantId,
      actorType: AuditActorType.USER,
      actorId: actor.userId,
      action: AuditAction.PAPER_SESSION_STOPPED,
      outcome: AuditOutcome.SUCCESS,
      resourceType: 'paper_trading_session',
      resourceId: sessionId,
      description: sanitiseForLog(input.reason, 500),
      metadata: {
        strategyId: existing.strategyId,
        symbol: existing.symbol,
        simulatedOrders: existing.simulatedOrders,
        simulatedFills: existing.simulatedFills,
      },
      requestId: actor.requestId ?? null,
    });

    return toPaperSessionView(updated as PaperSessionRow);
  }

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  async list(filter: {
    tenantId: string;
    status?: string;
    strategyId?: string;
    page?: number;
    limit?: number;
    sortBy?: string;
    sortOrder?: string;
  }): Promise<PaginatedResult<PaperSessionView>> {
    const pagination = normalisePagination(filter, PaperSessionsService.SORTABLE_FIELDS);

    const where: Prisma.PaperTradingSessionWhereInput = {
      tenantId: filter.tenantId,
      ...(filter.status ? { status: filter.status as never } : {}),
      ...(filter.strategyId ? { strategyId: filter.strategyId } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.paperTradingSession.findMany({
        where,
        select: PaperSessionsService.SESSION_SELECT,
        orderBy: { [pagination.sortBy ?? 'startedAt']: pagination.sortOrder },
        skip: pagination.skip,
        take: pagination.take,
      }),
      this.prisma.paperTradingSession.count({ where }),
    ]);

    return {
      items: rows.map((row) => toPaperSessionView(row as PaperSessionRow)),
      pagination: buildPaginationMeta(pagination.page, pagination.limit, total),
    };
  }

  async get(tenantId: string, sessionId: string): Promise<PaperSessionView> {
    const row = await this.prisma.paperTradingSession.findFirst({
      where: { id: sessionId, tenantId },
      select: PaperSessionsService.SESSION_SELECT,
    });

    if (!row) {
      throw new NotFoundException('Paper trading session');
    }

    return toPaperSessionView(row as PaperSessionRow);
  }

  async listSnapshots(
    tenantId: string,
    sessionId: string,
    filter: { limit?: number },
  ): Promise<PaperSnapshotView[]> {
    await this.get(tenantId, sessionId);

    const rows = await this.prisma.paperPortfolioSnapshot.findMany({
      where: { tenantId, sessionId },
      select: {
        sequence: true,
        capturedAtMicros: true,
        cash: true,
        positionQuantity: true,
        positionValue: true,
        equity: true,
        realisedPnl: true,
        unrealisedPnl: true,
        feesPaid: true,
        drawdown: true,
      },
      orderBy: { sequence: 'asc' },
      take: Math.min(filter.limit ?? 200, 1000),
    });

    return rows.map((row) => toPaperSnapshotView(row as PaperSnapshotRow));
  }
}
```

---

## FILE: apps/api/src/modules/strategy/strategy-metrics.service.ts

```ts
import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AppConfigService } from '../../config/app-config.service';
import type { StrategyMetricsView } from './strategy.types';
import { SIMULATION_DISCLAIMER } from './strategy.types';

/**
 * Aggregate counters for the strategy layer, per tenant.
 *
 * Derived from the durable record rather than from the engine's in-memory
 * counters, because this endpoint must answer even when no worker is running -
 * "nothing is running" being precisely the state an operator most wants
 * described accurately.
 *
 * Two statements are attached to every response and are not decorative.
 *
 * `latencyNote` says that the configured processing budget is an observation
 * target, not a guarantee. This platform makes no latency guarantee and no HFT
 * claim, and a dashboard that renders "50ms" without that context will
 * eventually be quoted as though it were a promise.
 *
 * `liveExecutionReachable` says whether a signal could become a real order in
 * this deployment right now. It is reported next to the strategy counters
 * precisely because "strategies are running" and "orders can reach a venue"
 * are separate facts that are easy to conflate.
 */
@Injectable()
export class StrategyMetricsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  async forTenant(tenantId: string): Promise<StrategyMetricsView> {
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [
      totalInstances,
      enabledInstances,
      quarantinedInstances,
      unhealthyInstances,
      activeRuns,
      failedRuns,
      openIncidents,
      criticalIncidents,
      warningIncidents,
      infoIncidents,
      queuedBacktests,
      runningBacktests,
      completedBacktests,
      failedBacktests,
      runningSessions,
      stoppedSessions,
    ] = await Promise.all([
      this.prisma.strategy.count({ where: { tenantId, deletedAt: null } }),
      this.prisma.strategy.count({ where: { tenantId, deletedAt: null, enabled: true } }),
      this.prisma.strategy.count({
        where: { tenantId, deletedAt: null, health: 'QUARANTINED' },
      }),
      this.prisma.strategy.count({ where: { tenantId, deletedAt: null, health: 'UNHEALTHY' } }),
      this.prisma.strategyRun.count({
        where: { tenantId, status: { in: ['STARTING', 'RUNNING'] } },
      }),
      this.prisma.strategyRun.count({
        where: { tenantId, status: 'FAILED', startedAt: { gte: dayAgo } },
      }),
      this.prisma.strategyIncident.count({ where: { tenantId, resolvedAt: null } }),
      this.prisma.strategyIncident.count({
        where: { tenantId, resolvedAt: null, severity: 'CRITICAL' },
      }),
      this.prisma.strategyIncident.count({
        where: { tenantId, resolvedAt: null, severity: 'WARNING' },
      }),
      this.prisma.strategyIncident.count({
        where: { tenantId, resolvedAt: null, severity: 'INFO' },
      }),
      this.prisma.backtestRun.count({ where: { tenantId, status: 'QUEUED' } }),
      this.prisma.backtestRun.count({ where: { tenantId, status: 'RUNNING' } }),
      this.prisma.backtestRun.count({
        where: { tenantId, status: 'COMPLETED', completedAt: { gte: dayAgo } },
      }),
      this.prisma.backtestRun.count({
        where: { tenantId, status: 'FAILED', completedAt: { gte: dayAgo } },
      }),
      this.prisma.paperTradingSession.count({
        where: { tenantId, status: { in: ['STARTING', 'RUNNING'] } },
      }),
      this.prisma.paperTradingSession.count({
        where: { tenantId, status: 'STOPPED', stoppedAt: { gte: dayAgo } },
      }),
    ]);

    return {
      instances: {
        total: totalInstances,
        enabled: enabledInstances,
        running: activeRuns,
        quarantined: quarantinedInstances,
        unhealthy: unhealthyInstances,
      },
      incidents: {
        open: openIncidents,
        critical: criticalIncidents,
        warning: warningIncidents,
        info: infoIncidents,
      },
      runs: {
        active: activeRuns,
        failedLast24h: failedRuns,
      },
      backtests: {
        queued: queuedBacktests,
        running: runningBacktests,
        completedLast24h: completedBacktests,
        failedLast24h: failedBacktests,
      },
      paperSessions: {
        running: runningSessions,
        stoppedLast24h: stoppedSessions,
      },
      configuration: {
        strategyEngineEnabled: this.config.strategyEngineEnabled,
        paperTradingEnabled: this.config.paperTradingEnabled,
        backtestEnabled: this.config.backtestEnabled,
        maxInstances: this.config.strategyMaxInstances,
        eventQueueSize: this.config.strategyEventQueueSize,
        maxProcessingLatencyMs: this.config.strategyMaxProcessingLatencyMs,
        signalMaxAgeMs: this.config.signalMaxAgeMs,
        signalDedupTtlSeconds: this.config.signalDedupTtlSeconds,
        tradingMode: this.config.tradingMode,
        liveExecutionReachable: this.config.tradingMode === 'LIVE',
      },
      latencyNote:
        'maxProcessingLatencyMs is an observation budget used to flag slow dispatches. It is ' +
        'not a guarantee. This platform makes no latency guarantee and no high-frequency ' +
        'trading claim.',
      disclaimer: SIMULATION_DISCLAIMER,
    };
  }
}
```

---

## FILE: apps/api/src/modules/strategy/strategy.controller.ts

```ts
import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permission } from '@wlct/shared-types';
import type { PaginatedResult } from '@wlct/shared-types';

import { StrategyCatalogService } from './strategy-catalog.service';
import { StrategyInstancesService } from './strategy-instances.service';
import { StrategyIncidentsService } from './strategy-incidents.service';
import { StrategyMetricsService } from './strategy-metrics.service';
import {
  DisableStrategyInstanceDto,
  EnableStrategyInstanceDto,
  ListStrategyDefinitionsDto,
  ListStrategyIncidentsDto,
  ListStrategyInstancesDto,
  ListStrategyRunsDto,
  ListStrategyVersionsDto,
  ResolveStrategyIncidentDto,
} from './dto/strategy.dto';
import type {
  StrategyCommandAcceptedView,
  StrategyDefinitionView,
  StrategyIncidentView,
  StrategyInstanceStatusView,
  StrategyInstanceView,
  StrategyMetricsView,
  StrategyRunView,
  StrategyVersionView,
} from './strategy.types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { TenantId } from '../../common/decorators/current-tenant.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { ApiStandardResponses } from '../../common/decorators/api-standard-responses.decorator';
import { ParseUuidPipe } from '../../common/pipes/parse-uuid.pipe';
import {
  RequestMeta,
  type RequestMetadata,
} from '../../common/decorators/request-context.decorator';
import type { AuthenticatedActor } from '@wlct/shared-types';

/**
 * The strategy catalogue and the instances running from it.
 *
 * What this controller does not have is as important as what it does. There is
 * no route that submits an order, no route that arms live trading, and no
 * route that creates a catalogue entry - the catalogue describes code that
 * ships with the release, and an entry with nothing behind it is a trap.
 *
 * Enabling and disabling are asymmetric on purpose. Disabling needs a short
 * reason and nothing else. Enabling needs a real reason, a runnable published
 * version, an instance that is not quarantined, an engine that is actually
 * running, and - when the deployment is armed for live execution - a typed
 * confirmation phrase.
 */
@ApiTags('Strategies')
@Controller({ path: 'strategies', version: '1' })
@ApiStandardResponses()
export class StrategyController {
  constructor(
    private readonly catalog: StrategyCatalogService,
    private readonly instances: StrategyInstancesService,
    private readonly incidents: StrategyIncidentsService,
    private readonly metrics: StrategyMetricsService,
  ) {}

  // ---------------------------------------------------------------------------
  // Catalogue
  // ---------------------------------------------------------------------------

  @Get('definitions')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.STRATEGY_READ)
  @ApiOperation({ summary: 'List strategy definitions' })
  @ApiOkResponse({
    description:
      'The catalogue of implementations. `riskNotes` is rendered verbatim by every client and ' +
      'never rewritten into a performance claim.',
  })
  async listDefinitions(
    @Query() query: ListStrategyDefinitionsDto,
  ): Promise<PaginatedResult<StrategyDefinitionView>> {
    return this.catalog.listDefinitions(query);
  }

  @Get('definitions/:key')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.STRATEGY_READ)
  @ApiOperation({ summary: 'Fetch one definition with its versions' })
  @ApiOkResponse({ description: 'The definition.' })
  async getDefinition(@Param('key') key: string): Promise<StrategyDefinitionView> {
    return this.catalog.getDefinition(key);
  }

  @Get('definitions/:key/versions')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.STRATEGY_VERSION_READ)
  @ApiOperation({ summary: 'List versions of one definition' })
  @ApiOkResponse({
    description:
      'Versions with their parameter schemas. Behaviour is frozen per version: a change ' +
      'requires a new version rather than an edit.',
  })
  async listVersions(
    @Param('key') key: string,
    @Query() query: ListStrategyVersionsDto,
  ): Promise<StrategyVersionView[]> {
    return this.catalog.listVersions(key, query);
  }

  // ---------------------------------------------------------------------------
  // Instances
  // ---------------------------------------------------------------------------

  @Get('instances')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.STRATEGY_INSTANCE_READ)
  @ApiOperation({ summary: 'List strategy instances' })
  @ApiOkResponse({
    description:
      'Paginated instances for the calling tenant. `health` is reported separately from ' +
      '`enabled`: an instance can be enabled and unhealthy at the same time.',
  })
  async listInstances(
    @Query() query: ListStrategyInstancesDto,
    @TenantId() tenantId: string,
  ): Promise<PaginatedResult<StrategyInstanceView>> {
    return this.instances.list({ ...query, tenantId });
  }

  @Get('instances/:id')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.STRATEGY_INSTANCE_READ)
  @ApiOperation({ summary: 'Fetch one instance' })
  @ApiOkResponse({ description: 'The instance.' })
  async getInstance(
    @Param('id', ParseUuidPipe) id: string,
    @TenantId() tenantId: string,
  ): Promise<StrategyInstanceView> {
    return this.instances.get(tenantId, id);
  }

  @Get('instances/:id/status')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.STRATEGY_INSTANCE_READ)
  @ApiOperation({ summary: 'Operational status of one instance' })
  @ApiOkResponse({
    description:
      'Current run, open incidents, last checkpoint, and whether live execution is reachable ' +
      'at all in this deployment.',
  })
  async getInstanceStatus(
    @Param('id', ParseUuidPipe) id: string,
    @TenantId() tenantId: string,
  ): Promise<StrategyInstanceStatusView> {
    return this.instances.getStatus(tenantId, id);
  }

  @Get('instances/:id/runs')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.STRATEGY_INSTANCE_READ)
  @ApiOperation({ summary: 'Run history for one instance' })
  @ApiOkResponse({ description: 'Runs, newest first, with their end-of-run counters.' })
  async listRuns(
    @Param('id', ParseUuidPipe) id: string,
    @Query() query: ListStrategyRunsDto,
    @TenantId() tenantId: string,
  ): Promise<PaginatedResult<StrategyRunView>> {
    return this.instances.listRuns(tenantId, id, query);
  }

  @Post('instances/:id/enable')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermissions(Permission.STRATEGY_INSTANCE_ENABLE)
  @ApiOperation({ summary: 'Start a strategy instance' })
  @ApiOkResponse({
    description:
      'Acknowledgement. Starting a strategy makes it emit signals; it does not enable live ' +
      'trading, and the response states the effective trading mode.',
  })
  async enableInstance(
    @Param('id', ParseUuidPipe) id: string,
    @Body() body: EnableStrategyInstanceDto,
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedActor,
    @RequestMeta() meta: RequestMetadata,
  ): Promise<StrategyCommandAcceptedView> {
    return this.instances.enable(
      tenantId,
      id,
      { userId: user.userId, requestId: meta.requestId },
      body,
    );
  }

  @Post('instances/:id/disable')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermissions(Permission.STRATEGY_INSTANCE_DISABLE)
  @ApiOperation({ summary: 'Stop a strategy instance' })
  @ApiOkResponse({
    description:
      'Acknowledgement. The instance is marked disabled immediately, before the worker is ' +
      'notified, so a queue outage cannot leave a strategy running.',
  })
  async disableInstance(
    @Param('id', ParseUuidPipe) id: string,
    @Body() body: DisableStrategyInstanceDto,
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedActor,
    @RequestMeta() meta: RequestMetadata,
  ): Promise<StrategyCommandAcceptedView> {
    return this.instances.disable(
      tenantId,
      id,
      { userId: user.userId, requestId: meta.requestId },
      body,
    );
  }

  // ---------------------------------------------------------------------------
  // Incidents and metrics
  // ---------------------------------------------------------------------------

  @Get('incidents')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.STRATEGY_INCIDENT_READ)
  @ApiOperation({ summary: 'List strategy incidents' })
  @ApiOkResponse({ description: 'Incidents raised by the strategy worker.' })
  async listIncidents(
    @Query() query: ListStrategyIncidentsDto,
    @TenantId() tenantId: string,
  ): Promise<PaginatedResult<StrategyIncidentView>> {
    return this.incidents.list({ ...query, tenantId });
  }

  @Post('incidents/:id/resolve')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.STRATEGY_INCIDENT_RESOLVE)
  @ApiOperation({ summary: 'Close a strategy incident' })
  @ApiOkResponse({
    description:
      'The incident with its resolution recorded. Nothing describing what happened is edited.',
  })
  async resolveIncident(
    @Param('id', ParseUuidPipe) id: string,
    @Body() body: ResolveStrategyIncidentDto,
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedActor,
    @RequestMeta() meta: RequestMetadata,
  ): Promise<StrategyIncidentView> {
    return this.incidents.resolve(
      tenantId,
      id,
      { userId: user.userId, requestId: meta.requestId },
      body.note,
    );
  }

  @Get('metrics')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.STRATEGY_METRICS_READ)
  @ApiOperation({ summary: 'Strategy layer counters and configuration' })
  @ApiOkResponse({
    description:
      'Counters plus the effective configuration. `latencyNote` states that the processing ' +
      'budget is an observation target and not a guarantee.',
  })
  async getMetrics(@TenantId() tenantId: string): Promise<StrategyMetricsView> {
    return this.metrics.forTenant(tenantId);
  }
}
```

---

## FILE: apps/api/src/modules/strategy/strategy-simulation.controller.ts

```ts
import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permission } from '@wlct/shared-types';
import type { AuthenticatedActor, PaginatedResult } from '@wlct/shared-types';

import { BacktestService } from './backtest.service';
import { PaperSessionsService } from './paper-sessions.service';
import {
  ListBacktestRunsDto,
  ListPaperSessionsDto,
  ListPaperSnapshotsDto,
  StartPaperSessionDto,
  StopPaperSessionDto,
  SubmitBacktestDto,
} from './dto/strategy.dto';
import type {
  BacktestMetricView,
  BacktestRunView,
  BacktestTradeView,
  PaperSessionView,
  PaperSnapshotView,
} from './strategy.types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { TenantId } from '../../common/decorators/current-tenant.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { ApiStandardResponses } from '../../common/decorators/api-standard-responses.decorator';
import { ParseUuidPipe } from '../../common/pipes/parse-uuid.pipe';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import {
  RequestMeta,
  type RequestMetadata,
} from '../../common/decorators/request-context.decorator';

/**
 * Simulation: backtests over stored data, and paper sessions against the live
 * feed.
 *
 * Every response from this controller describes something that did not happen
 * in a market. Each one carries `isSimulated: true` and a disclaimer, applied
 * by the mapper rather than by each handler, because a label that has to be
 * remembered is a label that will be forgotten.
 *
 * BACKTEST PERFORMANCE IS NOT INDICATIVE OF FUTURE PERFORMANCE.
 * PAPER PERFORMANCE IS NOT INDICATIVE OF LIVE PERFORMANCE.
 * SIMULATION DOES NOT GUARANTEE REAL EXECUTION QUALITY.
 */
@ApiTags('Strategies / Simulation')
@Controller({ path: 'strategies', version: '1' })
@ApiStandardResponses()
export class StrategySimulationController {
  constructor(
    private readonly backtests: BacktestService,
    private readonly paper: PaperSessionsService,
  ) {}

  // ---------------------------------------------------------------------------
  // Backtests
  // ---------------------------------------------------------------------------

  @Post('backtests')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermissions(Permission.BACKTEST_SUBMIT)
  @ApiOperation({ summary: 'Submit a backtest' })
  @ApiOkResponse({
    description:
      'The queued run. A backtest replays a stored dataset: it opens no socket, uses no ' +
      'credential and reaches no venue.',
  })
  async submitBacktest(
    @Body() body: SubmitBacktestDto,
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedActor,
    @RequestMeta() meta: RequestMetadata,
  ): Promise<BacktestRunView> {
    return this.backtests.submit(
      tenantId,
      { userId: user.userId, requestId: meta.requestId },
      body,
    );
  }

  @Get('backtests')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.BACKTEST_READ)
  @ApiOperation({ summary: 'List backtest runs' })
  @ApiOkResponse({
    description:
      'Paginated runs. Filter by `configurationHash` to find every run produced by one exact ' +
      'configuration: with the same dataset checksum they must have produced identical results.',
  })
  async listBacktests(
    @Query() query: ListBacktestRunsDto,
    @TenantId() tenantId: string,
  ): Promise<PaginatedResult<BacktestRunView>> {
    return this.backtests.list({ ...query, tenantId });
  }

  @Get('backtests/:id')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.BACKTEST_READ)
  @ApiOperation({ summary: 'Fetch one backtest result' })
  @ApiOkResponse({
    description:
      'The result. Risk-adjusted figures are null rather than zero when there were too few ' +
      'observations for them to mean anything; `hasSufficientObservations` says which case ' +
      'applies.',
  })
  async getBacktest(
    @Param('id', ParseUuidPipe) id: string,
    @TenantId() tenantId: string,
  ): Promise<BacktestRunView> {
    return this.backtests.get(tenantId, id);
  }

  @Get('backtests/:id/metrics')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.BACKTEST_READ)
  @ApiOperation({ summary: 'Named metrics for one backtest' })
  @ApiOkResponse({
    description:
      'Each metric carries its observation count and an `isSufficient` flag, so a consumer can ' +
      'tell "0.0" from "not enough data to say".',
  })
  async getBacktestMetrics(
    @Param('id', ParseUuidPipe) id: string,
    @TenantId() tenantId: string,
  ): Promise<BacktestMetricView[]> {
    return this.backtests.listMetrics(tenantId, id);
  }

  @Get('backtests/:id/trades')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.BACKTEST_READ)
  @ApiOperation({ summary: 'Simulated round trips for one backtest' })
  @ApiOkResponse({
    description:
      'Trades in deterministic order. `isWin` is net of fees, and a round trip that realised ' +
      'exactly zero is still listed because it still paid them.',
  })
  async getBacktestTrades(
    @Param('id', ParseUuidPipe) id: string,
    @Query() query: PaginationQueryDto,
    @TenantId() tenantId: string,
  ): Promise<PaginatedResult<BacktestTradeView>> {
    return this.backtests.listTrades(tenantId, id, query);
  }

  // ---------------------------------------------------------------------------
  // Paper sessions
  // ---------------------------------------------------------------------------

  @Post('paper-sessions')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermissions(Permission.PAPER_SESSION_OPERATE)
  @ApiOperation({ summary: 'Start a paper trading session' })
  @ApiOkResponse({
    description:
      'The starting session. Fills are produced by the simulator against observed prices; the ' +
      'session refuses to be constructed with anything but a simulated adapter.',
  })
  async startPaperSession(
    @Body() body: StartPaperSessionDto,
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedActor,
    @RequestMeta() meta: RequestMetadata,
  ): Promise<PaperSessionView> {
    return this.paper.start(tenantId, { userId: user.userId, requestId: meta.requestId }, body);
  }

  @Post('paper-sessions/:id/stop')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.PAPER_SESSION_OPERATE)
  @ApiOperation({ summary: 'Stop a paper trading session' })
  @ApiOkResponse({ description: 'The stopped session with its final counters.' })
  async stopPaperSession(
    @Param('id', ParseUuidPipe) id: string,
    @Body() body: StopPaperSessionDto,
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedActor,
    @RequestMeta() meta: RequestMetadata,
  ): Promise<PaperSessionView> {
    return this.paper.stop(
      tenantId,
      id,
      { userId: user.userId, requestId: meta.requestId },
      body,
    );
  }

  @Get('paper-sessions')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.PAPER_SESSION_READ)
  @ApiOperation({ summary: 'List paper trading sessions' })
  @ApiOkResponse({ description: 'Paginated sessions, every one labelled simulated.' })
  async listPaperSessions(
    @Query() query: ListPaperSessionsDto,
    @TenantId() tenantId: string,
  ): Promise<PaginatedResult<PaperSessionView>> {
    return this.paper.list({ ...query, tenantId });
  }

  @Get('paper-sessions/:id')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.PAPER_SESSION_READ)
  @ApiOperation({ summary: 'Fetch one paper session' })
  @ApiOkResponse({ description: 'The session.' })
  async getPaperSession(
    @Param('id', ParseUuidPipe) id: string,
    @TenantId() tenantId: string,
  ): Promise<PaperSessionView> {
    return this.paper.get(tenantId, id);
  }

  @Get('paper-sessions/:id/snapshots')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.PAPER_SESSION_READ)
  @ApiOperation({ summary: 'Simulated equity curve for one paper session' })
  @ApiOkResponse({
    description:
      'Snapshots in sequence order. Sampled on a slow schedule and on stop - never per fill ' +
      'and never per tick.',
  })
  async getPaperSnapshots(
    @Param('id', ParseUuidPipe) id: string,
    @Query() query: ListPaperSnapshotsDto,
    @TenantId() tenantId: string,
  ): Promise<PaperSnapshotView[]> {
    return this.paper.listSnapshots(tenantId, id, query);
  }
}
```

---

## FILE: apps/api/src/modules/strategy/strategy.module.ts

```ts
import { Module } from '@nestjs/common';

import { StrategyCatalogService } from './strategy-catalog.service';
import { StrategyInstancesService } from './strategy-instances.service';
import { StrategyIncidentsService } from './strategy-incidents.service';
import { StrategyMetricsService } from './strategy-metrics.service';
import { BacktestService } from './backtest.service';
import { PaperSessionsService } from './paper-sessions.service';
import { StrategyController } from './strategy.controller';
import { StrategySimulationController } from './strategy-simulation.controller';

/**
 * The strategy layer's control and read surface.
 *
 * Not `@Global()` and with no `exports`, for the same reason as the execution
 * module: nothing else in the API should be reaching into strategy state, and
 * a global module invites exactly that. If another module ever needs one of
 * these services, adding an explicit import is the moment at which someone
 * asks whether it should.
 *
 * Note what this module does not provide: no strategy engine, no feature
 * engine, no simulator, no adapter, no risk engine. Those live in the strategy
 * worker and in `wlct_trading`. This module records what an operator wants and
 * reads back what the worker recorded. There is no code path from an HTTP
 * request to a strategy tick, which is what keeps request latency out of the
 * data plane and keeps the data plane's failure modes out of the API.
 */
@Module({
  controllers: [StrategyController, StrategySimulationController],
  providers: [
    StrategyCatalogService,
    StrategyInstancesService,
    StrategyIncidentsService,
    StrategyMetricsService,
    BacktestService,
    PaperSessionsService,
  ],
})
export class StrategyModule {}
```

---

## FILE: apps/api/src/modules/strategy/strategy-safety.spec.ts

```ts
import { validateEnv, EnvValidationError } from '@wlct/config';
import {
  NON_WILDCARD_PERMISSIONS,
  Permission,
  STRATEGY_PERMISSIONS,
  STRATEGY_READ_ONLY_PERMISSIONS,
  SYSTEM_ROLE_DEFINITIONS,
  SystemRole,
  hasPermission,
  permissionMatches,
} from '@wlct/shared-types';

import { StrategyInstancesService } from './strategy-instances.service';
import { SIMULATION_DISCLAIMER } from './strategy.types';
import {
  toBacktestRunView,
  toBacktestTradeView,
  toPaperSessionView,
  toPaperSnapshotView,
  type BacktestRunRow,
  type BacktestTradeRow,
  type PaperSessionRow,
  type PaperSnapshotRow,
} from './strategy.mapper';

/**
 * Part 6 safety tests.
 *
 * Three properties are worth guarding here, and all three are pure functions
 * of their inputs: the environment schema that decides whether the strategy
 * layer runs at all, the RBAC rules that decide who may start a strategy, and
 * the mapper that decides whether a simulated number is labelled as one.
 *
 * No credential, no database, no network, no venue.
 */

function baseEnv(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/db?schema=public',
    DIRECT_DATABASE_URL: 'postgresql://user:pass@localhost:5432/db?schema=public',
    REDIS_URL: 'redis://localhost:6379/0',
    JWT_ACCESS_SECRET: 'a'.repeat(48),
    JWT_REFRESH_SECRET: 'b'.repeat(48),
    ENCRYPTION_MASTER_KEY_BASE64: Buffer.alloc(32, 7).toString('base64'),
    BLIND_INDEX_KEY_BASE64: Buffer.alloc(32, 9).toString('base64'),
    INTERNAL_SERVICE_TOKEN: 'c'.repeat(32),
    EXCHANGE_WEBHOOK_SIGNING_SECRET: 'd'.repeat(32),
    ...overrides,
  };
}

function expectFailureOn(env: Record<string, string>, path: string): EnvValidationError {
  try {
    validateEnv(env);
  } catch (error) {
    expect(error).toBeInstanceOf(EnvValidationError);
    const failure = error as EnvValidationError;
    expect(failure.failures.map((entry) => entry.path)).toContain(path);
    return failure;
  }
  throw new Error(`Expected validation to fail on ${path}, but it succeeded.`);
}

const decimal = (value: string): never => ({ toString: () => value }) as never;

describe('Part 6 - strategy environment safety', () => {
  it('leaves the strategy engine off by default', () => {
    const env = validateEnv(baseEnv());

    expect(env.STRATEGY_ENGINE_ENABLED).toBe(false);
    expect(env.PAPER_TRADING_ENABLED).toBe(true);
    expect(env.BACKTEST_ENABLED).toBe(true);
  });

  it('keeps fees and capital as exact decimal strings, never floats', () => {
    const env = validateEnv(
      baseEnv({
        BACKTEST_DEFAULT_INITIAL_CAPITAL: '25000.50',
        BACKTEST_DEFAULT_MAKER_FEE: '0.0002',
        BACKTEST_DEFAULT_TAKER_FEE: '0.0004',
        BACKTEST_DEFAULT_SLIPPAGE_BPS: '2.5',
      }),
    );

    expect(env.BACKTEST_DEFAULT_INITIAL_CAPITAL).toBe('25000.50');
    expect(env.BACKTEST_DEFAULT_MAKER_FEE).toBe('0.0002');
    expect(typeof env.BACKTEST_DEFAULT_TAKER_FEE).toBe('string');
    expect(env.BACKTEST_DEFAULT_SLIPPAGE_BPS).toBe('2.5');
  });

  it('refuses an engine with nowhere to send a signal', () => {
    expectFailureOn(
      baseEnv({
        STRATEGY_ENGINE_ENABLED: 'true',
        PAPER_TRADING_ENABLED: 'false',
        BACKTEST_ENABLED: 'false',
        EXECUTION_ENABLED: 'false',
      }),
      'STRATEGY_ENGINE_ENABLED',
    );
  });

  it('refuses a dedup window shorter than the signal validity window', () => {
    expectFailureOn(
      baseEnv({ SIGNAL_DEDUP_TTL_SECONDS: '1', SIGNAL_MAX_AGE_MS: '2000' }),
      'SIGNAL_DEDUP_TTL_SECONDS',
    );
  });

  it('refuses a processing budget that would make every signal stale', () => {
    expectFailureOn(
      baseEnv({ STRATEGY_MAX_PROCESSING_LATENCY_MS: '5000', SIGNAL_MAX_AGE_MS: '2000' }),
      'STRATEGY_MAX_PROCESSING_LATENCY_MS',
    );
  });

  it('bounds the event queue and the instance count', () => {
    expectFailureOn(baseEnv({ STRATEGY_EVENT_QUEUE_SIZE: '10' }), 'STRATEGY_EVENT_QUEUE_SIZE');
    expectFailureOn(baseEnv({ STRATEGY_MAX_INSTANCES: '5000' }), 'STRATEGY_MAX_INSTANCES');
  });

  it('refuses zero capital', () => {
    expectFailureOn(
      baseEnv({ BACKTEST_DEFAULT_INITIAL_CAPITAL: '0' }),
      'BACKTEST_DEFAULT_INITIAL_CAPITAL',
    );
  });

  it('refuses a free lunch in production', () => {
    // Zero fees with zero slippage produces results no real account could
    // achieve. Allowed outside production, where isolating costs is a
    // legitimate thing to want.
    expectFailureOn(
      baseEnv({
        NODE_ENV: 'production',
        BACKTEST_DEFAULT_TAKER_FEE: '0',
        BACKTEST_DEFAULT_SLIPPAGE_BPS: '0',
        SWAGGER_PASSWORD: 'x'.repeat(24),
        CORS_ORIGINS: 'https://admin.example.com',
      }),
      'BACKTEST_DEFAULT_TAKER_FEE',
    );

    const nonProduction = validateEnv(
      baseEnv({ BACKTEST_DEFAULT_TAKER_FEE: '0', BACKTEST_DEFAULT_SLIPPAGE_BPS: '0' }),
    );
    expect(nonProduction.BACKTEST_DEFAULT_TAKER_FEE).toBe('0');
  });

  it('does not let any Part 6 switch enable live trading', () => {
    const env = validateEnv(
      baseEnv({
        STRATEGY_ENGINE_ENABLED: 'true',
        PAPER_TRADING_ENABLED: 'true',
        BACKTEST_ENABLED: 'true',
      }),
    );

    // The live-trading decision is made by the Part 5 switches alone, and every
    // one of them is still at its safe default.
    expect(env.LIVE_TRADING_ENABLED).toBe(false);
    expect(env.EXECUTION_ENABLED).toBe(false);
    expect(env.DRY_RUN).toBe(true);
    expect(env.PAPER_TRADING).toBe(true);
    expect(env.EXCHANGE_SANDBOX_MODE).toBe(true);
  });

  it('still refuses the live-trading contradictions from Part 5', () => {
    expectFailureOn(
      baseEnv({ STRATEGY_ENGINE_ENABLED: 'true', LIVE_TRADING_ENABLED: 'true' }),
      'DRY_RUN',
    );
  });
});

describe('Part 6 - strategy permissions', () => {
  it('excludes starting a strategy from resource wildcards', () => {
    expect(NON_WILDCARD_PERMISSIONS.has(Permission.STRATEGY_INSTANCE_ENABLE)).toBe(true);
    expect(permissionMatches('strategy_instance:*', Permission.STRATEGY_INSTANCE_ENABLE)).toBe(
      false,
    );
    expect(permissionMatches('strategy_instance:*', Permission.STRATEGY_INSTANCE_READ)).toBe(true);
  });

  it('keeps stopping a strategy grantable by wildcard', () => {
    // Deliberate asymmetry: stopping is risk-reducing and must never be the
    // thing a permission check is arguing about while something misbehaves.
    expect(NON_WILDCARD_PERMISSIONS.has(Permission.STRATEGY_INSTANCE_DISABLE)).toBe(false);
    expect(permissionMatches('strategy_instance:*', Permission.STRATEGY_INSTANCE_DISABLE)).toBe(
      true,
    );
  });

  it('lets the platform super admin wildcard reach everything', () => {
    for (const permission of STRATEGY_PERMISSIONS) {
      expect(hasPermission([Permission.ALL], permission)).toBe(true);
    }
  });

  it('does not let support start or stop anything', () => {
    const support = SYSTEM_ROLE_DEFINITIONS.find((role) => role.key === SystemRole.SUPPORT);
    expect(support).toBeDefined();
    const granted = support?.permissions ?? [];

    expect(hasPermission(granted, Permission.STRATEGY_INSTANCE_READ)).toBe(true);
    expect(hasPermission(granted, Permission.STRATEGY_INSTANCE_ENABLE)).toBe(false);
    expect(hasPermission(granted, Permission.STRATEGY_INSTANCE_DISABLE)).toBe(false);
    expect(hasPermission(granted, Permission.BACKTEST_SUBMIT)).toBe(false);
    expect(hasPermission(granted, Permission.PAPER_SESSION_OPERATE)).toBe(false);
  });

  it('lets compliance stop a strategy but not start one', () => {
    const compliance = SYSTEM_ROLE_DEFINITIONS.find((role) => role.key === SystemRole.COMPLIANCE);
    const granted = compliance?.permissions ?? [];

    expect(hasPermission(granted, Permission.STRATEGY_INSTANCE_DISABLE)).toBe(true);
    expect(hasPermission(granted, Permission.STRATEGY_INSTANCE_ENABLE)).toBe(false);
  });

  it('gives a trader the full strategy lifecycle but not live arming', () => {
    const trader = SYSTEM_ROLE_DEFINITIONS.find((role) => role.key === SystemRole.TRADER);
    const granted = trader?.permissions ?? [];

    expect(hasPermission(granted, Permission.STRATEGY_INSTANCE_ENABLE)).toBe(true);
    expect(hasPermission(granted, Permission.BACKTEST_SUBMIT)).toBe(true);
    expect(hasPermission(granted, Permission.PAPER_SESSION_OPERATE)).toBe(true);
    // Arming an account for live trading remains an administrator action.
    expect(hasPermission(granted, Permission.EXCHANGE_ACCOUNT_ENABLE_LIVE)).toBe(false);
  });

  it('keeps a follower out of the strategy control surface', () => {
    const follower = SYSTEM_ROLE_DEFINITIONS.find((role) => role.key === SystemRole.FOLLOWER);
    const granted = follower?.permissions ?? [];

    expect(hasPermission(granted, Permission.STRATEGY_INSTANCE_ENABLE)).toBe(false);
    expect(hasPermission(granted, Permission.STRATEGY_INSTANCE_MANAGE)).toBe(false);
    expect(hasPermission(granted, Permission.BACKTEST_SUBMIT)).toBe(false);
  });

  it('holds nothing but reads in the mobile read-only set', () => {
    for (const permission of STRATEGY_READ_ONLY_PERMISSIONS) {
      expect(permission.endsWith(':read')).toBe(true);
    }
    expect(STRATEGY_READ_ONLY_PERMISSIONS).not.toContain(Permission.STRATEGY_INSTANCE_ENABLE);
    expect(STRATEGY_READ_ONLY_PERMISSIONS).not.toContain(Permission.PAPER_SESSION_OPERATE);
  });
});

describe('Part 6 - simulated results are always labelled', () => {
  const backtestRow = (): BacktestRunRow => ({
    id: 'run-1',
    runIdentifier: 'bt-000000000000000000000001',
    status: 'COMPLETED',
    strategyId: null,
    definitionId: null,
    versionId: null,
    strategyKey: 'DETERMINISTIC_IMBALANCE_V1',
    strategyVersion: '1.0.0',
    implementationId: 'module:Class',
    venue: 'BINANCE',
    symbol: 'BTC-USDT',
    marketType: 'SPOT',
    datasetId: 'dataset-1',
    datasetSource: 'STORED',
    datasetChecksum: 'd802739d162e0b7a',
    granularity: null,
    windowStartMicros: 1n,
    windowEndMicros: 2n,
    eventCount: 60,
    walkForwardSegment: null,
    initialCapital: decimal('10000'),
    makerFeeRate: decimal('0.001'),
    takerFeeRate: decimal('0.001'),
    slippageBps: decimal('1'),
    latencyMicros: 0n,
    parameters: {},
    assumptions: {},
    finalEquity: decimal('9999.748'),
    netPnl: decimal('-0.252'),
    grossProfit: decimal('0'),
    grossLoss: decimal('-0.252'),
    feesPaid: decimal('0.12'),
    slippageCost: decimal('0.03'),
    totalReturnPercent: decimal('-0.00252'),
    maxDrawdown: decimal('0.2399'),
    maxDrawdownPercent: decimal('0.0024'),
    totalTrades: 6,
    winningTrades: 0,
    losingTrades: 6,
    winRate: decimal('0'),
    averageTrade: decimal('-0.042'),
    largestWin: null,
    largestLoss: decimal('-0.09'),
    profitFactor: null,
    sharpeRatio: null,
    sortinoRatio: null,
    hasSufficientObservations: false,
    exposurePercent: decimal('12.5'),
    turnover: decimal('180'),
    configurationHash: 'f'.repeat(64),
    engineVersion: '0.6.0',
    isReproducible: true,
    jobId: 'job-1',
    queuedAt: new Date('2026-09-07T00:00:00.000Z'),
    startedAt: new Date('2026-09-07T00:00:01.000Z'),
    completedAt: new Date('2026-09-07T00:00:02.000Z'),
    durationMs: 1000,
    errorCode: null,
    errorSummary: null,
  });

  it('labels a backtest result as simulated and disclaims it', () => {
    const view = toBacktestRunView(backtestRow());

    expect(view.isSimulated).toBe(true);
    expect(view.disclaimer).toBe(SIMULATION_DISCLAIMER);
    expect(view.disclaimer).toContain('not indicative of future performance');
  });

  it('carries a withheld risk metric through as null, not zero', () => {
    const view = toBacktestRunView(backtestRow());

    expect(view.result.sharpeRatio).toBeNull();
    expect(view.result.sortinoRatio).toBeNull();
    expect(view.result.hasSufficientObservations).toBe(false);
  });

  it('stringifies every decimal and bigint rather than rounding it', () => {
    const view = toBacktestRunView(backtestRow());

    expect(view.result.netPnl).toBe('-0.252');
    expect(typeof view.dataset.windowStartMicros).toBe('string');
    expect(typeof view.assumptions.latencyMicros).toBe('string');
  });

  it('labels every simulated trade', () => {
    const trade: BacktestTradeRow = {
      sequence: 1,
      symbol: 'BTC-USDT',
      direction: 'LONG',
      quantity: decimal('0.001'),
      entryPrice: decimal('30000'),
      exitPrice: decimal('30000'),
      grossPnl: decimal('0'),
      fees: decimal('0.06'),
      netPnl: decimal('-0.06'),
      isWin: false,
      openedAtMicros: 1n,
      closedAtMicros: 2n,
      holdingMicros: 1n,
    };

    const view = toBacktestTradeView(trade);

    expect(view.isSimulated).toBe(true);
    // Break-even before costs is a loss after them.
    expect(view.isWin).toBe(false);
    expect(view.netPnl).toBe('-0.06');
  });

  it('labels a paper session and its snapshots', () => {
    const session: PaperSessionRow = {
      id: 'session-1',
      sessionIdentifier: 'paper-1',
      status: 'RUNNING',
      strategyId: 'strategy-1',
      strategyKey: 'DETERMINISTIC_IMBALANCE_V1',
      strategyVersion: '1.0.0',
      venue: 'BINANCE',
      symbol: 'BTC-USDT',
      marketType: 'SPOT',
      initialCapital: decimal('10000'),
      currentEquity: decimal('9998'),
      realisedPnl: decimal('-2'),
      unrealisedPnl: null,
      feesPaid: decimal('0.5'),
      maxDrawdown: decimal('3'),
      signalsGenerated: 10,
      signalsAccepted: 6,
      signalsRejected: 4,
      riskRejections: 1,
      simulatedOrders: 5,
      simulatedFills: 5,
      strategyErrors: 0,
      startedAt: new Date('2026-09-07T00:00:00.000Z'),
      stoppedAt: null,
      stopReason: null,
      errorCode: null,
    };

    const view = toPaperSessionView(session);

    expect(view.isSimulated).toBe(true);
    expect(view.disclaimer).toContain('paper performance is not indicative of live performance');
    // Flat and unmarked stays null rather than becoming a confident zero.
    expect(view.unrealisedPnl).toBeNull();

    const snapshot: PaperSnapshotRow = {
      sequence: 1,
      capturedAtMicros: 1_700_000_000_000_000n,
      cash: decimal('10000'),
      positionQuantity: decimal('0'),
      positionValue: null,
      equity: decimal('10000'),
      realisedPnl: decimal('0'),
      unrealisedPnl: null,
      feesPaid: decimal('0'),
      drawdown: decimal('0'),
    };

    expect(toPaperSnapshotView(snapshot).isSimulated).toBe(true);
    expect(toPaperSnapshotView(snapshot).capturedAtMicros).toBe('1700000000000000');
  });
});

describe('Part 6 - enabling a strategy under live execution', () => {
  it('requires an exact confirmation phrase', () => {
    // The phrase is asserted as a constant rather than only exercised through
    // the service, because a typo in it would silently weaken the gate: a
    // client sending the old phrase would simply be refused, and someone would
    // "fix" that by relaxing the check.
    expect(StrategyInstancesService.LIVE_CONFIRMATION).toBe('ENABLE STRATEGY IN LIVE MODE');
  });
});
```

---

## FILE: apps/admin-web/src/app/(console)/strategies/page.tsx

```tsx
import type { Metadata } from 'next';

import { Badge, Card, DataTable, ErrorNotice, PageHeader, StatTile } from '@/components/ui';
import { ApiError } from '@/lib/api-error';
import { formatDateTime, formatRelative, titleCase } from '@/lib/format';
import { serverFetch } from '@/lib/server-api';
import { theme, toneForStatus } from '@/lib/theme';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Strategies' };

/**
 * Read-mostly strategy console.
 *
 * Deliberately read-only in this increment. Starting a strategy is a POST that
 * requires a written reason, a runnable published version, and - under a
 * live-armed deployment - a typed confirmation phrase. A one-click toggle on a
 * dashboard is the wrong shape for that, and shipping the toggle before the
 * confirmation flow is how a "quick test" becomes a running strategy.
 *
 * Every panel is fetched independently: a failure degrades one panel rather
 * than the page, because the moment an operator most needs this screen is the
 * moment something is already broken.
 */

interface StrategyMetrics {
  instances: {
    total: number;
    enabled: number;
    running: number;
    quarantined: number;
    unhealthy: number;
  };
  incidents: { open: number; critical: number; warning: number; info: number };
  runs: { active: number; failedLast24h: number };
  backtests: {
    queued: number;
    running: number;
    completedLast24h: number;
    failedLast24h: number;
  };
  paperSessions: { running: number; stoppedLast24h: number };
  configuration: {
    strategyEngineEnabled: boolean;
    paperTradingEnabled: boolean;
    backtestEnabled: boolean;
    maxInstances: number;
    eventQueueSize: number;
    maxProcessingLatencyMs: number;
    signalMaxAgeMs: number;
    signalDedupTtlSeconds: number;
    tradingMode: string;
    liveExecutionReachable: boolean;
  };
  latencyNote: string;
  disclaimer: string;
}

interface StrategyInstance {
  id: string;
  name: string;
  kind: string;
  version: string;
  status: string;
  enabled: boolean;
  health: string;
  venue: string;
  symbols: string[];
  consecutiveErrors: number;
  lastHeartbeatAt: string | null;
  lastErrorCode: string | null;
  quarantinedAt: string | null;
}

interface BacktestRun {
  id: string;
  runIdentifier: string;
  status: string;
  strategyKey: string;
  strategyVersion: string;
  symbol: string;
  result: {
    netPnl: string | null;
    totalTrades: number;
    winRate: string | null;
    sharpeRatio: string | null;
    maxDrawdown: string | null;
    hasSufficientObservations: boolean;
  };
  isReproducible: boolean;
  queuedAt: string;
  completedAt: string | null;
}

interface PaperSession {
  id: string;
  sessionIdentifier: string;
  status: string;
  strategyKey: string;
  symbol: string;
  currentEquity: string | null;
  realisedPnl: string;
  simulatedOrders: number;
  simulatedFills: number;
  riskRejections: number;
  startedAt: string;
}

interface StrategyIncident {
  id: string;
  incidentType: string;
  severity: string;
  symbol: string | null;
  errorCode: string | null;
  summary: string;
  createdAt: string;
  resolvedAt: string | null;
}

interface Paginated<T> {
  items: T[];
  pagination: { totalItems: number };
}

interface ConsoleData {
  metrics: StrategyMetrics | null;
  instances: StrategyInstance[];
  backtests: BacktestRun[];
  sessions: PaperSession[];
  incidents: StrategyIncident[];
  failures: string[];
}

async function loadConsole(): Promise<ConsoleData> {
  const failures: string[] = [];

  const describe = (label: string) => (error: unknown) => {
    failures.push(error instanceof ApiError ? `${label}: ${error.message}` : `${label} unavailable`);
    return null;
  };

  const [metrics, instances, backtests, sessions, incidents] = await Promise.all([
    serverFetch<StrategyMetrics>('/strategies/metrics').catch(describe('Metrics')),
    serverFetch<Paginated<StrategyInstance>>('/strategies/instances', {
      searchParams: { page: 1, limit: 20 },
    }).catch(describe('Instances')),
    serverFetch<Paginated<BacktestRun>>('/strategies/backtests', {
      searchParams: { page: 1, limit: 10 },
    }).catch(describe('Backtests')),
    serverFetch<Paginated<PaperSession>>('/strategies/paper-sessions', {
      searchParams: { page: 1, limit: 10 },
    }).catch(describe('Paper sessions')),
    serverFetch<Paginated<StrategyIncident>>('/strategies/incidents', {
      searchParams: { page: 1, limit: 10, unresolvedOnly: true },
    }).catch(describe('Incidents')),
  ]);

  return {
    metrics,
    instances: instances?.items ?? [],
    backtests: backtests?.items ?? [],
    sessions: sessions?.items ?? [],
    incidents: incidents?.items ?? [],
    failures,
  };
}

function healthTone(health: string): 'neutral' | 'success' | 'warning' | 'danger' | 'info' {
  switch (health) {
    case 'HEALTHY':
      return 'success';
    case 'DEGRADED':
      return 'warning';
    case 'UNHEALTHY':
    case 'QUARANTINED':
      return 'danger';
    default:
      return 'neutral';
  }
}

/** A metric that was withheld reads as "insufficient data", never as zero. */
function metricOrWithheld(value: string | null, sufficient: boolean): string {
  if (value !== null) {
    return value;
  }
  return sufficient ? '—' : 'insufficient data';
}

export default async function StrategiesPage(): Promise<JSX.Element> {
  const { metrics, instances, backtests, sessions, incidents, failures } = await loadConsole();
  const config = metrics?.configuration;

  return (
    <>
      <PageHeader
        title="Strategies"
        description="Strategy instances, simulated results and incidents for this organisation."
      />

      {failures.length > 0 && (
        <div style={{ marginTop: theme.space(5) }}>
          <ErrorNotice title="Some panels could not be loaded" message={failures.join(' · ')} />
        </div>
      )}

      {/* The single most misread fact on this page, stated before anything
          else: whether a signal from these strategies could become a real
          order in this deployment. */}
      <div style={{ marginTop: theme.space(5) }}>
        <Card
          title="Execution boundary"
          description="What the strategy layer is currently permitted to reach."
        >
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: theme.space(2) }}>
            <Badge tone={config?.strategyEngineEnabled ? 'success' : 'neutral'}>
              Engine {config?.strategyEngineEnabled ? 'enabled' : 'disabled'}
            </Badge>
            <Badge tone={config?.paperTradingEnabled ? 'info' : 'neutral'}>
              Paper trading {config?.paperTradingEnabled ? 'enabled' : 'disabled'}
            </Badge>
            <Badge tone={config?.backtestEnabled ? 'info' : 'neutral'}>
              Backtesting {config?.backtestEnabled ? 'enabled' : 'disabled'}
            </Badge>
            <Badge tone={config?.liveExecutionReachable ? 'danger' : 'success'}>
              {config?.liveExecutionReachable
                ? 'LIVE EXECUTION REACHABLE'
                : 'Live execution not reachable'}
            </Badge>
            <Badge tone="neutral">Trading mode {config?.tradingMode ?? 'unknown'}</Badge>
          </div>
          <p style={{ color: theme.color.textMuted, fontSize: 13, marginTop: theme.space(4) }}>
            Enabling a strategy makes it emit signals. Whether a signal becomes an order is decided
            afterwards by the risk engine and the execution gates, and no strategy setting changes
            that.
          </p>
          {metrics && (
            <p style={{ color: theme.color.textMuted, fontSize: 13, margin: 0 }}>
              {metrics.latencyNote}
            </p>
          )}
        </Card>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: theme.space(4),
          marginTop: theme.space(6),
        }}
      >
        <StatTile
          label="Instances"
          value={metrics?.instances.total ?? '—'}
          hint={`${metrics?.instances.enabled ?? 0} enabled · limit ${config?.maxInstances ?? '—'}`}
        />
        <StatTile
          label="Running"
          value={metrics?.instances.running ?? '—'}
          hint={`${metrics?.runs.failedLast24h ?? 0} runs failed in 24h`}
        />
        <StatTile
          label="Unhealthy"
          value={(metrics?.instances.unhealthy ?? 0) + (metrics?.instances.quarantined ?? 0)}
          hint={`${metrics?.instances.quarantined ?? 0} quarantined`}
        />
        <StatTile
          label="Open incidents"
          value={metrics?.incidents.open ?? '—'}
          hint={`${metrics?.incidents.critical ?? 0} critical`}
        />
        <StatTile
          label="Backtests"
          value={metrics?.backtests.completedLast24h ?? '—'}
          hint={`${metrics?.backtests.queued ?? 0} queued · ${metrics?.backtests.running ?? 0} running`}
        />
        <StatTile
          label="Paper sessions"
          value={metrics?.paperSessions.running ?? '—'}
          hint={`${metrics?.paperSessions.stoppedLast24h ?? 0} stopped in 24h`}
        />
      </div>

      <div style={{ display: 'grid', gap: theme.space(5), marginTop: theme.space(6) }}>
        <Card
          title="Instances"
          description="Health is reported separately from enabled: an instance can be both enabled and unhealthy."
        >
          <DataTable
            rows={instances}
            rowKey={(row) => row.id}
            emptyTitle="No strategy instances"
            emptyDescription="Instances are created against a published strategy version."
            columns={[
              {
                key: 'name',
                header: 'Name',
                render: (row) => (
                  <div>
                    <div style={{ fontWeight: 600 }}>{row.name}</div>
                    <div style={{ color: theme.color.textMuted, fontSize: 12 }}>
                      {row.kind}@{row.version}
                    </div>
                  </div>
                ),
              },
              {
                key: 'market',
                header: 'Market',
                render: (row) => (
                  <div>
                    <div>{row.venue}</div>
                    <div style={{ color: theme.color.textMuted, fontSize: 12 }}>
                      {row.symbols.join(', ')}
                    </div>
                  </div>
                ),
              },
              {
                key: 'status',
                header: 'Status',
                render: (row) => (
                  <div style={{ display: 'flex', gap: theme.space(2), flexWrap: 'wrap' }}>
                    <Badge tone={toneForStatus(row.status)}>{titleCase(row.status)}</Badge>
                    <Badge tone={healthTone(row.health)}>{titleCase(row.health)}</Badge>
                  </div>
                ),
              },
              {
                key: 'errors',
                header: 'Errors',
                align: 'right',
                render: (row) => (
                  <div>
                    <div>{row.consecutiveErrors}</div>
                    {row.lastErrorCode && (
                      <div style={{ color: theme.color.textMuted, fontSize: 12 }}>
                        {row.lastErrorCode}
                      </div>
                    )}
                  </div>
                ),
              },
              {
                key: 'heartbeat',
                header: 'Last heartbeat',
                render: (row) =>
                  row.lastHeartbeatAt ? formatRelative(row.lastHeartbeatAt) : 'never reported',
              },
            ]}
          />
        </Card>

        <Card
          title="Recent backtests"
          description="SIMULATED. Backtest performance is not indicative of future performance."
        >
          <DataTable
            rows={backtests}
            rowKey={(row) => row.id}
            emptyTitle="No backtests yet"
            emptyDescription="A backtest replays a stored dataset. It reaches no venue."
            columns={[
              {
                key: 'run',
                header: 'Run',
                render: (row) => (
                  <div>
                    <div style={{ fontFamily: 'monospace', fontSize: 12 }}>{row.runIdentifier}</div>
                    <div style={{ color: theme.color.textMuted, fontSize: 12 }}>
                      {row.strategyKey}@{row.strategyVersion} · {row.symbol}
                    </div>
                  </div>
                ),
              },
              {
                key: 'status',
                header: 'Status',
                render: (row) => (
                  <div style={{ display: 'flex', gap: theme.space(2), flexWrap: 'wrap' }}>
                    <Badge tone={toneForStatus(row.status)}>{titleCase(row.status)}</Badge>
                    {!row.isReproducible && <Badge tone="warning">No checksum</Badge>}
                  </div>
                ),
              },
              {
                key: 'pnl',
                header: 'Net PnL',
                align: 'right',
                render: (row) => row.result.netPnl ?? '—',
              },
              {
                key: 'trades',
                header: 'Trades',
                align: 'right',
                render: (row) => row.result.totalTrades,
              },
              {
                key: 'sharpe',
                header: 'Sharpe',
                align: 'right',
                render: (row) =>
                  metricOrWithheld(row.result.sharpeRatio, row.result.hasSufficientObservations),
              },
              {
                key: 'completed',
                header: 'Completed',
                render: (row) => (row.completedAt ? formatDateTime(row.completedAt) : '—'),
              },
            ]}
          />
        </Card>

        <Card
          title="Paper sessions"
          description="SIMULATED FILLS against real prices. Paper performance is not indicative of live performance."
        >
          <DataTable
            rows={sessions}
            rowKey={(row) => row.id}
            emptyTitle="No paper sessions"
            emptyDescription="A paper session refuses any adapter that is not marked simulated."
            columns={[
              {
                key: 'session',
                header: 'Session',
                render: (row) => (
                  <div>
                    <div style={{ fontFamily: 'monospace', fontSize: 12 }}>
                      {row.sessionIdentifier}
                    </div>
                    <div style={{ color: theme.color.textMuted, fontSize: 12 }}>
                      {row.strategyKey} · {row.symbol}
                    </div>
                  </div>
                ),
              },
              {
                key: 'status',
                header: 'Status',
                render: (row) => <Badge tone={toneForStatus(row.status)}>{titleCase(row.status)}</Badge>,
              },
              {
                key: 'equity',
                header: 'Equity',
                align: 'right',
                render: (row) => row.currentEquity ?? '—',
              },
              {
                key: 'realised',
                header: 'Realised',
                align: 'right',
                render: (row) => row.realisedPnl,
              },
              {
                key: 'fills',
                header: 'Orders / fills',
                align: 'right',
                render: (row) => `${row.simulatedOrders} / ${row.simulatedFills}`,
              },
              {
                key: 'rejections',
                header: 'Risk rejections',
                align: 'right',
                render: (row) => row.riskRejections,
              },
              {
                key: 'started',
                header: 'Started',
                render: (row) => formatRelative(row.startedAt),
              },
            ]}
          />
        </Card>

        <Card
          title="Open incidents"
          description="Raised by the strategy worker. A rejected signal on its own is the system working and produces nothing here."
        >
          <DataTable
            rows={incidents}
            rowKey={(row) => row.id}
            emptyTitle="No open incidents"
            columns={[
              {
                key: 'severity',
                header: 'Severity',
                render: (row) => <Badge tone={toneForStatus(row.severity)}>{row.severity}</Badge>,
              },
              { key: 'type', header: 'Type', render: (row) => titleCase(row.incidentType) },
              {
                key: 'summary',
                header: 'Summary',
                render: (row) => (
                  <div>
                    <div>{row.summary}</div>
                    {row.errorCode && (
                      <div style={{ color: theme.color.textMuted, fontSize: 12 }}>
                        {row.errorCode}
                        {row.symbol ? ` · ${row.symbol}` : ''}
                      </div>
                    )}
                  </div>
                ),
              },
              { key: 'raised', header: 'Raised', render: (row) => formatRelative(row.createdAt) },
            ]}
          />
        </Card>

        <Card title="What these numbers are not">
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14, lineHeight: 1.9 }}>
            <li>Backtest performance is not indicative of future performance.</li>
            <li>Paper performance is not indicative of live performance.</li>
            <li>Simulation does not guarantee real execution quality.</li>
            <li>
              The simulator ignores queue position, market impact and venue rejections, so it
              systematically flatters a strategy that would in reality have waited or moved the
              price.
            </li>
            <li>
              Risk-adjusted figures are withheld rather than estimated when there were too few
              observations. &quot;Insufficient data&quot; is not zero.
            </li>
            <li>No strategy shipped with this platform carries a profitability claim.</li>
          </ul>
        </Card>
      </div>
    </>
  );
}
```

---

## FILE: apps/mobile/lib/features/strategies/domain/strategy_models.dart

```dart
import 'package:equatable/equatable.dart';

/// Read-only strategy view models.
///
/// The mobile client is a **viewer** for the strategy layer. It can see what
/// instances exist, whether they are healthy, and what the simulator produced.
/// It cannot create, enable, disable or configure anything, and there is no
/// model here that could be serialised back to the API as a command.
///
/// Every number that arrives as a Decimal on the server is kept as a [String].
/// Parsing money into a `double` to render it is how a UI starts disagreeing
/// with the ledger; formatting is a display concern and happens in the widget.
///
/// A metric the server withheld for insufficient observations arrives as
/// `null`. `null` is rendered as "insufficient data", never as `0`.

/// Lifecycle state of an instance, as reported by the API.
enum StrategyInstanceStatus {
  idle,
  starting,
  running,
  paused,
  stopped,
  errored,
  unknown;

  static StrategyInstanceStatus fromApi(String? value) {
    switch (value) {
      case 'IDLE':
        return StrategyInstanceStatus.idle;
      case 'STARTING':
        return StrategyInstanceStatus.starting;
      case 'RUNNING':
        return StrategyInstanceStatus.running;
      case 'PAUSED':
        return StrategyInstanceStatus.paused;
      case 'STOPPED':
        return StrategyInstanceStatus.stopped;
      case 'ERROR':
      case 'ERRORED':
        return StrategyInstanceStatus.errored;
      default:
        return StrategyInstanceStatus.unknown;
    }
  }
}

/// Operational health, reported separately from [StrategyInstanceStatus].
///
/// An instance can be enabled and unhealthy at the same time; collapsing the
/// two into one badge hides exactly the case an operator needs to see.
enum StrategyHealth {
  unknown,
  healthy,
  degraded,
  unhealthy,
  quarantined;

  static StrategyHealth fromApi(String? value) {
    switch (value) {
      case 'HEALTHY':
        return StrategyHealth.healthy;
      case 'DEGRADED':
        return StrategyHealth.degraded;
      case 'UNHEALTHY':
        return StrategyHealth.unhealthy;
      case 'QUARANTINED':
        return StrategyHealth.quarantined;
      default:
        return StrategyHealth.unknown;
    }
  }

  bool get needsAttention =>
      this == StrategyHealth.degraded ||
      this == StrategyHealth.unhealthy ||
      this == StrategyHealth.quarantined;
}

/// Status of a simulated run (backtest or paper session).
enum SimulationStatus {
  queued,
  running,
  completed,
  stopped,
  failed,
  cancelled,
  unknown;

  static SimulationStatus fromApi(String? value) {
    switch (value) {
      case 'QUEUED':
        return SimulationStatus.queued;
      case 'STARTING':
      case 'RUNNING':
        return SimulationStatus.running;
      case 'COMPLETED':
        return SimulationStatus.completed;
      case 'STOPPED':
        return SimulationStatus.stopped;
      case 'FAILED':
        return SimulationStatus.failed;
      case 'CANCELLED':
        return SimulationStatus.cancelled;
      default:
        return SimulationStatus.unknown;
    }
  }
}

String? _optionalString(Object? value) {
  if (value is String && value.isNotEmpty) {
    return value;
  }
  return null;
}

String _requiredString(Object? value, {String fallback = ''}) {
  return value is String && value.isNotEmpty ? value : fallback;
}

int _intOrZero(Object? value) {
  if (value is int) {
    return value;
  }
  if (value is num) {
    return value.toInt();
  }
  if (value is String) {
    return int.tryParse(value) ?? 0;
  }
  return 0;
}

bool _boolOrFalse(Object? value) => value is bool && value;

DateTime? _dateTime(Object? value) {
  if (value is String && value.isNotEmpty) {
    return DateTime.tryParse(value)?.toLocal();
  }
  return null;
}

List<String> _stringList(Object? value) {
  if (value is List) {
    return value.whereType<String>().toList(growable: false);
  }
  return const <String>[];
}

Map<String, Object?> _asMap(Object? value) {
  if (value is Map) {
    return value.map<String, Object?>(
      (Object? key, Object? item) => MapEntry<String, Object?>(key.toString(), item),
    );
  }
  return const <String, Object?>{};
}

/// A strategy instance belonging to the caller's organisation.
class StrategyInstanceSummary extends Equatable {
  const StrategyInstanceSummary({
    required this.id,
    required this.name,
    required this.kind,
    required this.version,
    required this.status,
    required this.health,
    required this.enabled,
    required this.venue,
    required this.symbols,
    required this.consecutiveErrors,
    this.lastHeartbeatAt,
    this.lastErrorCode,
    this.quarantineReason,
  });

  factory StrategyInstanceSummary.fromJson(Map<String, Object?> json) {
    return StrategyInstanceSummary(
      id: _requiredString(json['id']),
      name: _requiredString(json['name'], fallback: 'Unnamed strategy'),
      kind: _requiredString(json['kind'], fallback: 'UNKNOWN'),
      version: _requiredString(json['version'], fallback: '0.0.0'),
      status: StrategyInstanceStatus.fromApi(json['status'] as String?),
      health: StrategyHealth.fromApi(json['health'] as String?),
      enabled: _boolOrFalse(json['enabled']),
      venue: _requiredString(json['venue'], fallback: 'UNKNOWN'),
      symbols: _stringList(json['symbols']),
      consecutiveErrors: _intOrZero(json['consecutiveErrors']),
      lastHeartbeatAt: _dateTime(json['lastHeartbeatAt']),
      lastErrorCode: _optionalString(json['lastErrorCode']),
      quarantineReason: _optionalString(json['quarantineReason']),
    );
  }

  final String id;
  final String name;
  final String kind;
  final String version;
  final StrategyInstanceStatus status;
  final StrategyHealth health;
  final bool enabled;
  final String venue;
  final List<String> symbols;
  final int consecutiveErrors;
  final DateTime? lastHeartbeatAt;
  final String? lastErrorCode;
  final String? quarantineReason;

  bool get isQuarantined => health == StrategyHealth.quarantined;

  @override
  List<Object?> get props => <Object?>[
        id,
        name,
        kind,
        version,
        status,
        health,
        enabled,
        venue,
        symbols,
        consecutiveErrors,
        lastHeartbeatAt,
        lastErrorCode,
        quarantineReason,
      ];
}

/// A paper-trading session. Every fill behind these numbers is simulated.
class PaperSessionSummary extends Equatable {
  const PaperSessionSummary({
    required this.id,
    required this.sessionIdentifier,
    required this.status,
    required this.strategyKey,
    required this.symbol,
    required this.initialCapital,
    required this.realisedPnl,
    required this.feesPaid,
    required this.simulatedOrders,
    required this.simulatedFills,
    required this.riskRejections,
    required this.isSimulated,
    required this.startedAt,
    this.currentEquity,
    this.unrealisedPnl,
    this.maxDrawdown,
    this.stoppedAt,
  });

  factory PaperSessionSummary.fromJson(Map<String, Object?> json) {
    return PaperSessionSummary(
      id: _requiredString(json['id']),
      sessionIdentifier: _requiredString(json['sessionIdentifier']),
      status: SimulationStatus.fromApi(json['status'] as String?),
      strategyKey: _requiredString(json['strategyKey'], fallback: 'UNKNOWN'),
      symbol: _requiredString(json['symbol'], fallback: '—'),
      initialCapital: _requiredString(json['initialCapital'], fallback: '0'),
      realisedPnl: _requiredString(json['realisedPnl'], fallback: '0'),
      feesPaid: _requiredString(json['feesPaid'], fallback: '0'),
      simulatedOrders: _intOrZero(json['simulatedOrders']),
      simulatedFills: _intOrZero(json['simulatedFills']),
      riskRejections: _intOrZero(json['riskRejections']),
      // Defaults to true. If the label is ever missing from a payload the safe
      // reading is "simulated", not "real".
      isSimulated: json['isSimulated'] is bool ? json['isSimulated']! as bool : true,
      startedAt: _dateTime(json['startedAt']),
      currentEquity: _optionalString(json['currentEquity']),
      unrealisedPnl: _optionalString(json['unrealisedPnl']),
      maxDrawdown: _optionalString(json['maxDrawdown']),
      stoppedAt: _dateTime(json['stoppedAt']),
    );
  }

  final String id;
  final String sessionIdentifier;
  final SimulationStatus status;
  final String strategyKey;
  final String symbol;
  final String initialCapital;
  final String realisedPnl;
  final String feesPaid;
  final int simulatedOrders;
  final int simulatedFills;
  final int riskRejections;
  final bool isSimulated;
  final DateTime? startedAt;
  final String? currentEquity;
  final String? unrealisedPnl;
  final String? maxDrawdown;
  final DateTime? stoppedAt;

  @override
  List<Object?> get props => <Object?>[
        id,
        sessionIdentifier,
        status,
        strategyKey,
        symbol,
        initialCapital,
        realisedPnl,
        feesPaid,
        simulatedOrders,
        simulatedFills,
        riskRejections,
        isSimulated,
        startedAt,
        currentEquity,
        unrealisedPnl,
        maxDrawdown,
        stoppedAt,
      ];
}

/// A completed or in-flight backtest, flattened for a phone-sized card.
class BacktestSummary extends Equatable {
  const BacktestSummary({
    required this.id,
    required this.runIdentifier,
    required this.status,
    required this.strategyKey,
    required this.strategyVersion,
    required this.symbol,
    required this.totalTrades,
    required this.hasSufficientObservations,
    required this.isReproducible,
    required this.queuedAt,
    this.netPnl,
    this.totalReturnPercent,
    this.maxDrawdownPercent,
    this.winRate,
    this.sharpeRatio,
    this.completedAt,
  });

  factory BacktestSummary.fromJson(Map<String, Object?> json) {
    final Map<String, Object?> result = _asMap(json['result']);

    return BacktestSummary(
      id: _requiredString(json['id']),
      runIdentifier: _requiredString(json['runIdentifier']),
      status: SimulationStatus.fromApi(json['status'] as String?),
      strategyKey: _requiredString(json['strategyKey'], fallback: 'UNKNOWN'),
      strategyVersion: _requiredString(json['strategyVersion'], fallback: '0.0.0'),
      symbol: _requiredString(json['symbol'], fallback: '—'),
      totalTrades: _intOrZero(result['totalTrades']),
      hasSufficientObservations: _boolOrFalse(result['hasSufficientObservations']),
      isReproducible: _boolOrFalse(json['isReproducible']),
      queuedAt: _dateTime(json['queuedAt']),
      netPnl: _optionalString(result['netPnl']),
      totalReturnPercent: _optionalString(result['totalReturnPercent']),
      maxDrawdownPercent: _optionalString(result['maxDrawdownPercent']),
      winRate: _optionalString(result['winRate']),
      sharpeRatio: _optionalString(result['sharpeRatio']),
      completedAt: _dateTime(json['completedAt']),
    );
  }

  final String id;
  final String runIdentifier;
  final SimulationStatus status;
  final String strategyKey;
  final String strategyVersion;
  final String symbol;
  final int totalTrades;

  /// False when the run had too few observations for risk-adjusted metrics.
  /// The affected fields arrive as `null` and must not be shown as zero.
  final bool hasSufficientObservations;

  final bool isReproducible;
  final DateTime? queuedAt;
  final String? netPnl;
  final String? totalReturnPercent;
  final String? maxDrawdownPercent;
  final String? winRate;
  final String? sharpeRatio;
  final DateTime? completedAt;

  @override
  List<Object?> get props => <Object?>[
        id,
        runIdentifier,
        status,
        strategyKey,
        strategyVersion,
        symbol,
        totalTrades,
        hasSufficientObservations,
        isReproducible,
        queuedAt,
        netPnl,
        totalReturnPercent,
        maxDrawdownPercent,
        winRate,
        sharpeRatio,
        completedAt,
      ];
}

/// Counters and the platform's current strategy configuration.
class StrategyOverview extends Equatable {
  const StrategyOverview({
    required this.totalInstances,
    required this.enabledInstances,
    required this.runningInstances,
    required this.quarantinedInstances,
    required this.unhealthyInstances,
    required this.openIncidents,
    required this.criticalIncidents,
    required this.runningPaperSessions,
    required this.queuedBacktests,
    required this.strategyEngineEnabled,
    required this.paperTradingEnabled,
    required this.backtestEnabled,
    required this.tradingMode,
    required this.liveExecutionReachable,
    required this.latencyNote,
    required this.disclaimer,
  });

  factory StrategyOverview.fromJson(Map<String, Object?> json) {
    final Map<String, Object?> instances = _asMap(json['instances']);
    final Map<String, Object?> incidents = _asMap(json['incidents']);
    final Map<String, Object?> sessions = _asMap(json['paperSessions']);
    final Map<String, Object?> backtests = _asMap(json['backtests']);
    final Map<String, Object?> configuration = _asMap(json['configuration']);

    return StrategyOverview(
      totalInstances: _intOrZero(instances['total']),
      enabledInstances: _intOrZero(instances['enabled']),
      runningInstances: _intOrZero(instances['running']),
      quarantinedInstances: _intOrZero(instances['quarantined']),
      unhealthyInstances: _intOrZero(instances['unhealthy']),
      openIncidents: _intOrZero(incidents['open']),
      criticalIncidents: _intOrZero(incidents['critical']),
      runningPaperSessions: _intOrZero(sessions['running']),
      queuedBacktests: _intOrZero(backtests['queued']),
      strategyEngineEnabled: _boolOrFalse(configuration['strategyEngineEnabled']),
      paperTradingEnabled: _boolOrFalse(configuration['paperTradingEnabled']),
      backtestEnabled: _boolOrFalse(configuration['backtestEnabled']),
      tradingMode: _requiredString(configuration['tradingMode'], fallback: 'UNKNOWN'),
      liveExecutionReachable: _boolOrFalse(configuration['liveExecutionReachable']),
      latencyNote: _requiredString(json['latencyNote']),
      disclaimer: _requiredString(json['disclaimer']),
    );
  }

  final int totalInstances;
  final int enabledInstances;
  final int runningInstances;
  final int quarantinedInstances;
  final int unhealthyInstances;
  final int openIncidents;
  final int criticalIncidents;
  final int runningPaperSessions;
  final int queuedBacktests;
  final bool strategyEngineEnabled;
  final bool paperTradingEnabled;
  final bool backtestEnabled;
  final String tradingMode;

  /// Whether a signal could, in this deployment, become a real order.
  final bool liveExecutionReachable;

  final String latencyNote;
  final String disclaimer;

  @override
  List<Object?> get props => <Object?>[
        totalInstances,
        enabledInstances,
        runningInstances,
        quarantinedInstances,
        unhealthyInstances,
        openIncidents,
        criticalIncidents,
        runningPaperSessions,
        queuedBacktests,
        strategyEngineEnabled,
        paperTradingEnabled,
        backtestEnabled,
        tradingMode,
        liveExecutionReachable,
        latencyNote,
        disclaimer,
      ];
}
```

---

## FILE: apps/mobile/lib/features/strategies/data/strategy_repository.dart

```dart
import '../../../core/logging/app_logger.dart';
import '../../../core/network/api_client.dart';
import '../../../core/network/api_endpoints.dart';
import '../domain/strategy_models.dart';

/// Read-only access to the strategy layer.
///
/// This repository exposes GET requests and nothing else. There is no method
/// here to enable an instance, start a session, submit a backtest or change a
/// parameter, and that is deliberate: those operations require a written
/// reason, a permission the mobile client is not granted, and - for anything
/// touching live mode - a typed confirmation phrase. A phone in a pocket is
/// the wrong place for a control that arms a trading strategy.
///
/// The API enforces the same boundary independently. Even if a build of this
/// app tried to POST, the caller's role would have to carry
/// `strategy_instance:enable`, which the mobile role does not.
class StrategyRepository {
  StrategyRepository({
    required ApiClient apiClient,
    required AppLogger logger,
  })  : _apiClient = apiClient,
        _logger = logger;

  final ApiClient _apiClient;
  final AppLogger _logger;

  /// Platform counters plus the configuration flags that decide what the
  /// strategy layer is allowed to reach.
  Future<StrategyOverview> fetchOverview() async {
    final StrategyOverview overview = await _apiClient.get<StrategyOverview>(
      ApiEndpoints.strategyMetrics,
      parser: (Object? data) => StrategyOverview.fromJson(_asMap(data)),
    );

    _logger.debug('strategy.overview_loaded');
    return overview;
  }

  Future<List<StrategyInstanceSummary>> fetchInstances({int limit = 25}) async {
    return _apiClient.get<List<StrategyInstanceSummary>>(
      ApiEndpoints.strategyInstances,
      queryParameters: <String, Object?>{'page': 1, 'limit': limit},
      parser: (Object? data) => _items(data)
          .map(StrategyInstanceSummary.fromJson)
          .toList(growable: false),
    );
  }

  Future<List<PaperSessionSummary>> fetchPaperSessions({int limit = 10}) async {
    return _apiClient.get<List<PaperSessionSummary>>(
      ApiEndpoints.paperSessions,
      queryParameters: <String, Object?>{'page': 1, 'limit': limit},
      parser: (Object? data) =>
          _items(data).map(PaperSessionSummary.fromJson).toList(growable: false),
    );
  }

  Future<List<BacktestSummary>> fetchBacktests({int limit = 10}) async {
    return _apiClient.get<List<BacktestSummary>>(
      ApiEndpoints.backtests,
      queryParameters: <String, Object?>{'page': 1, 'limit': limit},
      parser: (Object? data) =>
          _items(data).map(BacktestSummary.fromJson).toList(growable: false),
    );
  }

  /// Extracts `items` from the API's paginated envelope.
  ///
  /// A malformed page yields an empty list rather than throwing: a viewer
  /// screen showing "nothing to display" is better than one that crashes.
  static List<Map<String, Object?>> _items(Object? data) {
    final Map<String, Object?> map = _asMap(data);
    final Object? items = map['items'];

    if (items is! List) {
      return const <Map<String, Object?>>[];
    }

    return items
        .whereType<Map<Object?, Object?>>()
        .map(_asMap)
        .toList(growable: false);
  }

  static Map<String, Object?> _asMap(Object? value) {
    if (value is Map) {
      return value.map<String, Object?>(
        (Object? key, Object? item) => MapEntry<String, Object?>(key.toString(), item),
      );
    }
    return const <String, Object?>{};
  }
}
```

---

## FILE: apps/mobile/lib/features/strategies/presentation/strategy_state.dart

```dart
import 'package:equatable/equatable.dart';

import '../../../core/error/app_exception.dart';
import '../domain/strategy_models.dart';

/// Loading state of the strategy viewer.
enum StrategyViewStatus { initial, loading, ready, failed }

/// Immutable state for the read-only strategy screen.
///
/// The four panels load in parallel and are held together here. A partial
/// failure keeps whatever did load: an operator checking on a degraded
/// instance should not lose the whole screen because the backtest list timed
/// out.
class StrategyViewState extends Equatable {
  const StrategyViewState({
    required this.status,
    this.overview,
    this.instances = const <StrategyInstanceSummary>[],
    this.paperSessions = const <PaperSessionSummary>[],
    this.backtests = const <BacktestSummary>[],
    this.error,
    this.isRefreshing = false,
    this.degradedPanels = const <String>[],
  });

  const StrategyViewState.initial() : this(status: StrategyViewStatus.initial);

  final StrategyViewStatus status;
  final StrategyOverview? overview;
  final List<StrategyInstanceSummary> instances;
  final List<PaperSessionSummary> paperSessions;
  final List<BacktestSummary> backtests;

  /// Set only when nothing at all could be loaded.
  final AppException? error;

  final bool isRefreshing;

  /// Human-readable names of panels that failed while others succeeded.
  final List<String> degradedPanels;

  bool get hasAnyData =>
      overview != null ||
      instances.isNotEmpty ||
      paperSessions.isNotEmpty ||
      backtests.isNotEmpty;

  bool get isDegraded => degradedPanels.isNotEmpty;

  /// Instances an operator should look at first.
  List<StrategyInstanceSummary> get attentionInstances => instances
      .where((StrategyInstanceSummary instance) => instance.health.needsAttention)
      .toList(growable: false);

  StrategyViewState copyWith({
    StrategyViewStatus? status,
    StrategyOverview? overview,
    List<StrategyInstanceSummary>? instances,
    List<PaperSessionSummary>? paperSessions,
    List<BacktestSummary>? backtests,
    AppException? error,
    bool? isRefreshing,
    List<String>? degradedPanels,
    bool clearError = false,
  }) {
    return StrategyViewState(
      status: status ?? this.status,
      overview: overview ?? this.overview,
      instances: instances ?? this.instances,
      paperSessions: paperSessions ?? this.paperSessions,
      backtests: backtests ?? this.backtests,
      error: clearError ? null : (error ?? this.error),
      isRefreshing: isRefreshing ?? this.isRefreshing,
      degradedPanels: degradedPanels ?? this.degradedPanels,
    );
  }

  @override
  List<Object?> get props => <Object?>[
        status,
        overview,
        instances,
        paperSessions,
        backtests,
        error,
        isRefreshing,
        degradedPanels,
      ];
}
```

---

## FILE: apps/mobile/lib/features/strategies/presentation/strategy_controller.dart

```dart
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/error/app_exception.dart';
import '../../../core/logging/app_logger.dart';
import '../data/strategy_repository.dart';
import '../domain/strategy_models.dart';
import 'strategy_state.dart';

/// Drives the read-only strategy screen.
///
/// The controller exposes exactly two operations - [load] and [refresh] - and
/// no mutation. Adding one here would be the first step towards a trading
/// control on a phone, so the class is kept deliberately inert.
///
/// Panels are fetched concurrently and failures are isolated per panel. Only
/// a total failure surfaces as a page-level error.
class StrategyController extends StateNotifier<StrategyViewState> {
  StrategyController({required StrategyRepository repository, required AppLogger logger})
      : _repository = repository,
        _logger = logger,
        super(const StrategyViewState.initial());

  final StrategyRepository _repository;
  final AppLogger _logger;

  Future<void> load() => _fetch(isRefresh: false);

  Future<void> refresh() => _fetch(isRefresh: true);

  Future<void> _fetch({required bool isRefresh}) async {
    if (state.isRefreshing) {
      return;
    }

    state = state.copyWith(
      status: isRefresh ? state.status : StrategyViewStatus.loading,
      isRefreshing: true,
      clearError: true,
    );

    final List<String> degraded = <String>[];
    AppException? lastFailure;

    Future<T?> attempt<T>(String panel, Future<T> Function() operation) async {
      try {
        return await operation();
      } on AppException catch (error) {
        degraded.add(panel);
        lastFailure = error;
        // Panel name and error code only. Never the payload: it can carry
        // organisation-identifying detail into device logs.
        _logger.warning(
          'strategy.panel_failed',
          context: <String, Object?>{'panel': panel, 'code': error.code.name},
        );
        return null;
      }
    }

    final List<Object?> results = await Future.wait<Object?>(<Future<Object?>>[
      attempt<StrategyOverview>('overview', _repository.fetchOverview),
      attempt<List<StrategyInstanceSummary>>('instances', _repository.fetchInstances),
      attempt<List<PaperSessionSummary>>('paperSessions', _repository.fetchPaperSessions),
      attempt<List<BacktestSummary>>('backtests', _repository.fetchBacktests),
    ]);

    final StrategyOverview? overview = results[0] as StrategyOverview?;
    final List<StrategyInstanceSummary>? instances =
        results[1] as List<StrategyInstanceSummary>?;
    final List<PaperSessionSummary>? sessions = results[2] as List<PaperSessionSummary>?;
    final List<BacktestSummary>? backtests = results[3] as List<BacktestSummary>?;

    final bool everythingFailed = degraded.length == results.length;

    if (everythingFailed) {
      state = state.copyWith(
        status: StrategyViewStatus.failed,
        isRefreshing: false,
        error: lastFailure,
        degradedPanels: const <String>[],
      );
      return;
    }

    state = StrategyViewState(
      status: StrategyViewStatus.ready,
      // A panel that failed keeps its previous content rather than blanking.
      overview: overview ?? state.overview,
      instances: instances ?? state.instances,
      paperSessions: sessions ?? state.paperSessions,
      backtests: backtests ?? state.backtests,
      isRefreshing: false,
      degradedPanels: List<String>.unmodifiable(degraded),
    );
  }
}
```

---

## FILE: apps/mobile/lib/features/strategies/presentation/strategies_screen.dart

```dart
import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/di/providers.dart';
import '../../../l10n/app_localizations.dart';
import '../domain/strategy_models.dart';
import 'strategy_state.dart';

/// Read-only strategy viewer.
///
/// There is no button on this screen that changes anything. It answers three
/// questions and stops: what is running, is any of it unhealthy, and what did
/// the simulator produce. Controls live in the admin console, behind
/// permissions this client is not granted.
class StrategiesScreen extends ConsumerStatefulWidget {
  const StrategiesScreen({super.key});

  @override
  ConsumerState<StrategiesScreen> createState() => _StrategiesScreenState();
}

class _StrategiesScreenState extends ConsumerState<StrategiesScreen> {
  @override
  void initState() {
    super.initState();
    // Deferred to after the first frame: the controller mutates provider state
    // and must not do so during the build that created it.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      unawaited(ref.read(strategyControllerProvider.notifier).load());
    });
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final StrategyViewState state = ref.watch(strategyControllerProvider);

    return Scaffold(
      appBar: AppBar(title: Text(l10n.strategiesTitle)),
      body: RefreshIndicator(
        onRefresh: () => ref.read(strategyControllerProvider.notifier).refresh(),
        child: _body(context, l10n, state),
      ),
    );
  }

  Widget _body(BuildContext context, AppLocalizations l10n, StrategyViewState state) {
    if (state.status == StrategyViewStatus.loading && !state.hasAnyData) {
      return const Center(child: CircularProgressIndicator());
    }

    if (state.status == StrategyViewStatus.failed && !state.hasAnyData) {
      return _FailureView(
        message: state.error?.message ?? l10n.genericError,
        retryLabel: l10n.retry,
        onRetry: () => ref.read(strategyControllerProvider.notifier).load(),
      );
    }

    return ListView(
      padding: const EdgeInsets.all(16),
      physics: const AlwaysScrollableScrollPhysics(),
      children: <Widget>[
        if (state.isDegraded) _DegradedBanner(message: l10n.strategyPanelsDegraded),
        if (state.overview != null) _BoundaryCard(overview: state.overview!, l10n: l10n),
        const SizedBox(height: 12),
        if (state.overview != null) _CountersCard(overview: state.overview!, l10n: l10n),
        const SizedBox(height: 12),
        _SectionHeading(title: l10n.strategyInstancesSection),
        if (state.instances.isEmpty)
          _EmptyCard(message: l10n.strategyNoInstances)
        else
          for (final StrategyInstanceSummary instance in state.instances)
            _InstanceCard(instance: instance, l10n: l10n),
        const SizedBox(height: 12),
        _SectionHeading(title: l10n.paperSessionsSection),
        if (state.paperSessions.isEmpty)
          _EmptyCard(message: l10n.strategyNoPaperSessions)
        else
          for (final PaperSessionSummary session in state.paperSessions)
            _PaperSessionCard(session: session, l10n: l10n),
        const SizedBox(height: 12),
        _SectionHeading(title: l10n.backtestsSection),
        if (state.backtests.isEmpty)
          _EmptyCard(message: l10n.strategyNoBacktests)
        else
          for (final BacktestSummary backtest in state.backtests)
            _BacktestCard(backtest: backtest, l10n: l10n),
        const SizedBox(height: 16),
        _DisclaimerCard(l10n: l10n),
        const SizedBox(height: 24),
      ],
    );
  }
}

/// The execution boundary, stated before any number on the page.
class _BoundaryCard extends StatelessWidget {
  const _BoundaryCard({required this.overview, required this.l10n});

  final StrategyOverview overview;
  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context) {
    final ColorScheme colors = Theme.of(context).colorScheme;
    final bool live = overview.liveExecutionReachable;

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Row(
              children: <Widget>[
                Icon(
                  live ? Icons.warning_amber_rounded : Icons.shield_outlined,
                  color: live ? colors.error : colors.primary,
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    live ? l10n.liveExecutionReachable : l10n.liveExecutionNotReachable,
                    style: Theme.of(context)
                        .textTheme
                        .titleSmall
                        ?.copyWith(fontWeight: FontWeight.w700),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: <Widget>[
                _StatusChip(
                  label: l10n.strategyEngineLabel,
                  on: overview.strategyEngineEnabled,
                ),
                _StatusChip(label: l10n.paperTradingLabel, on: overview.paperTradingEnabled),
                _StatusChip(label: l10n.backtestingLabel, on: overview.backtestEnabled),
                Chip(label: Text('${l10n.tradingModeLabel}: ${overview.tradingMode}')),
              ],
            ),
            if (overview.latencyNote.isNotEmpty) ...<Widget>[
              const SizedBox(height: 12),
              Text(
                overview.latencyNote,
                style: Theme.of(context)
                    .textTheme
                    .bodySmall
                    ?.copyWith(color: colors.onSurfaceVariant),
              ),
            ],
            const SizedBox(height: 8),
            Text(
              l10n.strategyReadOnlyNotice,
              style: Theme.of(context)
                  .textTheme
                  .bodySmall
                  ?.copyWith(color: colors.onSurfaceVariant),
            ),
          ],
        ),
      ),
    );
  }
}

class _CountersCard extends StatelessWidget {
  const _CountersCard({required this.overview, required this.l10n});

  final StrategyOverview overview;
  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Wrap(
          spacing: 24,
          runSpacing: 16,
          children: <Widget>[
            _Counter(label: l10n.instancesLabel, value: '${overview.totalInstances}'),
            _Counter(label: l10n.runningLabel, value: '${overview.runningInstances}'),
            _Counter(
              label: l10n.needsAttentionLabel,
              value: '${overview.unhealthyInstances + overview.quarantinedInstances}',
              emphasise: overview.unhealthyInstances + overview.quarantinedInstances > 0,
            ),
            _Counter(
              label: l10n.openIncidentsLabel,
              value: '${overview.openIncidents}',
              emphasise: overview.criticalIncidents > 0,
            ),
            _Counter(
              label: l10n.paperSessionsSection,
              value: '${overview.runningPaperSessions}',
            ),
          ],
        ),
      ),
    );
  }
}

class _InstanceCard extends StatelessWidget {
  const _InstanceCard({required this.instance, required this.l10n});

  final StrategyInstanceSummary instance;
  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context) {
    final ColorScheme colors = Theme.of(context).colorScheme;

    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Text(
                        instance.name,
                        style: Theme.of(context)
                            .textTheme
                            .titleSmall
                            ?.copyWith(fontWeight: FontWeight.w700),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        '${instance.kind}@${instance.version}',
                        style: Theme.of(context)
                            .textTheme
                            .bodySmall
                            ?.copyWith(color: colors.onSurfaceVariant),
                      ),
                    ],
                  ),
                ),
                _HealthBadge(health: instance.health),
              ],
            ),
            const SizedBox(height: 10),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: <Widget>[
                Chip(label: Text(instance.venue)),
                for (final String symbol in instance.symbols) Chip(label: Text(symbol)),
                Chip(
                  label: Text(
                    instance.enabled ? l10n.enabledLabel : l10n.disabledLabel,
                  ),
                ),
              ],
            ),
            if (instance.consecutiveErrors > 0 || instance.lastErrorCode != null) ...<Widget>[
              const SizedBox(height: 10),
              Text(
                '${l10n.consecutiveErrorsLabel}: ${instance.consecutiveErrors}'
                '${instance.lastErrorCode == null ? '' : ' · ${instance.lastErrorCode}'}',
                style: Theme.of(context).textTheme.bodySmall?.copyWith(color: colors.error),
              ),
            ],
            if (instance.quarantineReason != null) ...<Widget>[
              const SizedBox(height: 6),
              Text(
                instance.quarantineReason!,
                style: Theme.of(context).textTheme.bodySmall?.copyWith(color: colors.error),
              ),
            ],
            const SizedBox(height: 6),
            Text(
              instance.lastHeartbeatAt == null
                  ? l10n.noHeartbeatYet
                  : '${l10n.lastHeartbeatLabel}: ${_formatTimestamp(instance.lastHeartbeatAt!)}',
              style: Theme.of(context)
                  .textTheme
                  .bodySmall
                  ?.copyWith(color: colors.onSurfaceVariant),
            ),
          ],
        ),
      ),
    );
  }
}

class _PaperSessionCard extends StatelessWidget {
  const _PaperSessionCard({required this.session, required this.l10n});

  final PaperSessionSummary session;
  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context) {
    final ColorScheme colors = Theme.of(context).colorScheme;

    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Row(
              children: <Widget>[
                Expanded(
                  child: Text(
                    '${session.strategyKey} · ${session.symbol}',
                    style: Theme.of(context)
                        .textTheme
                        .titleSmall
                        ?.copyWith(fontWeight: FontWeight.w700),
                  ),
                ),
                if (session.isSimulated) _SimulatedBadge(label: l10n.simulatedBadge),
              ],
            ),
            const SizedBox(height: 4),
            Text(
              session.sessionIdentifier,
              style: Theme.of(context)
                  .textTheme
                  .bodySmall
                  ?.copyWith(color: colors.onSurfaceVariant),
            ),
            const SizedBox(height: 10),
            Wrap(
              spacing: 20,
              runSpacing: 12,
              children: <Widget>[
                _Counter(label: l10n.statusLabel, value: _statusLabel(session.status, l10n)),
                _Counter(
                  label: l10n.equityLabel,
                  value: session.currentEquity ?? l10n.notAvailableShort,
                ),
                _Counter(label: l10n.realisedPnlLabel, value: session.realisedPnl),
                _Counter(
                  label: l10n.simulatedFillsLabel,
                  value: '${session.simulatedOrders} / ${session.simulatedFills}',
                ),
                _Counter(label: l10n.riskRejectionsLabel, value: '${session.riskRejections}'),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _BacktestCard extends StatelessWidget {
  const _BacktestCard({required this.backtest, required this.l10n});

  final BacktestSummary backtest;
  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context) {
    final ColorScheme colors = Theme.of(context).colorScheme;

    /// A withheld metric reads as "insufficient data", never as zero.
    String metric(String? value) {
      if (value != null) {
        return value;
      }
      return backtest.hasSufficientObservations
          ? l10n.notAvailableShort
          : l10n.insufficientData;
    }

    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Row(
              children: <Widget>[
                Expanded(
                  child: Text(
                    '${backtest.strategyKey}@${backtest.strategyVersion} · ${backtest.symbol}',
                    style: Theme.of(context)
                        .textTheme
                        .titleSmall
                        ?.copyWith(fontWeight: FontWeight.w700),
                  ),
                ),
                _SimulatedBadge(label: l10n.simulatedBadge),
              ],
            ),
            const SizedBox(height: 4),
            Text(
              backtest.runIdentifier,
              style: Theme.of(context)
                  .textTheme
                  .bodySmall
                  ?.copyWith(color: colors.onSurfaceVariant),
            ),
            const SizedBox(height: 10),
            Wrap(
              spacing: 20,
              runSpacing: 12,
              children: <Widget>[
                _Counter(label: l10n.statusLabel, value: _statusLabel(backtest.status, l10n)),
                _Counter(label: l10n.netPnlLabel, value: metric(backtest.netPnl)),
                _Counter(label: l10n.tradesLabel, value: '${backtest.totalTrades}'),
                _Counter(label: l10n.winRateLabel, value: metric(backtest.winRate)),
                _Counter(label: l10n.sharpeLabel, value: metric(backtest.sharpeRatio)),
                _Counter(
                  label: l10n.maxDrawdownLabel,
                  value: metric(backtest.maxDrawdownPercent),
                ),
              ],
            ),
            if (!backtest.isReproducible) ...<Widget>[
              const SizedBox(height: 10),
              Text(
                l10n.backtestNotReproducible,
                style: Theme.of(context).textTheme.bodySmall?.copyWith(color: colors.error),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _DisclaimerCard extends StatelessWidget {
  const _DisclaimerCard({required this.l10n});

  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context) {
    final ColorScheme colors = Theme.of(context).colorScheme;

    return Card(
      color: colors.surfaceContainerHighest,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Text(
              l10n.simulationDisclaimerTitle,
              style: Theme.of(context)
                  .textTheme
                  .titleSmall
                  ?.copyWith(fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 8),
            Text(l10n.backtestDisclaimer, style: Theme.of(context).textTheme.bodySmall),
            const SizedBox(height: 4),
            Text(l10n.paperDisclaimer, style: Theme.of(context).textTheme.bodySmall),
            const SizedBox(height: 4),
            Text(
              l10n.executionQualityDisclaimer,
              style: Theme.of(context).textTheme.bodySmall,
            ),
            const SizedBox(height: 4),
            Text(
              l10n.insufficientDataDisclaimer,
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ],
        ),
      ),
    );
  }
}

class _HealthBadge extends StatelessWidget {
  const _HealthBadge({required this.health});

  final StrategyHealth health;

  @override
  Widget build(BuildContext context) {
    final ColorScheme colors = Theme.of(context).colorScheme;

    final Color background = switch (health) {
      StrategyHealth.healthy => colors.primaryContainer,
      StrategyHealth.degraded => colors.tertiaryContainer,
      StrategyHealth.unhealthy || StrategyHealth.quarantined => colors.errorContainer,
      StrategyHealth.unknown => colors.surfaceContainerHighest,
    };

    final Color foreground = switch (health) {
      StrategyHealth.healthy => colors.onPrimaryContainer,
      StrategyHealth.degraded => colors.onTertiaryContainer,
      StrategyHealth.unhealthy || StrategyHealth.quarantined => colors.onErrorContainer,
      StrategyHealth.unknown => colors.onSurfaceVariant,
    };

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        health.name.toUpperCase(),
        style: Theme.of(context)
            .textTheme
            .labelSmall
            ?.copyWith(color: foreground, fontWeight: FontWeight.w700),
      ),
    );
  }
}

class _SimulatedBadge extends StatelessWidget {
  const _SimulatedBadge({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    final ColorScheme colors = Theme.of(context).colorScheme;

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: colors.secondaryContainer,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        label,
        style: Theme.of(context).textTheme.labelSmall?.copyWith(
              color: colors.onSecondaryContainer,
              fontWeight: FontWeight.w700,
            ),
      ),
    );
  }
}

class _StatusChip extends StatelessWidget {
  const _StatusChip({required this.label, required this.on});

  final String label;
  final bool on;

  @override
  Widget build(BuildContext context) {
    return Chip(
      avatar: Icon(
        on ? Icons.check_circle_outline : Icons.remove_circle_outline,
        size: 18,
      ),
      label: Text(label),
    );
  }
}

class _Counter extends StatelessWidget {
  const _Counter({required this.label, required this.value, this.emphasise = false});

  final String label;
  final String value;
  final bool emphasise;

  @override
  Widget build(BuildContext context) {
    final ColorScheme colors = Theme.of(context).colorScheme;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        Text(
          label,
          style: Theme.of(context)
              .textTheme
              .labelSmall
              ?.copyWith(color: colors.onSurfaceVariant),
        ),
        const SizedBox(height: 2),
        Text(
          value,
          style: Theme.of(context).textTheme.titleMedium?.copyWith(
                fontWeight: FontWeight.w700,
                color: emphasise ? colors.error : null,
              ),
        ),
      ],
    );
  }
}

class _SectionHeading extends StatelessWidget {
  const _SectionHeading({required this.title});

  final String title;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: 8, bottom: 8),
      child: Text(
        title,
        style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700),
      ),
    );
  }
}

class _EmptyCard extends StatelessWidget {
  const _EmptyCard({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Text(
          message,
          style: Theme.of(context)
              .textTheme
              .bodyMedium
              ?.copyWith(color: Theme.of(context).colorScheme.onSurfaceVariant),
        ),
      ),
    );
  }
}

class _DegradedBanner extends StatelessWidget {
  const _DegradedBanner({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    final ColorScheme colors = Theme.of(context).colorScheme;

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: colors.tertiaryContainer,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        children: <Widget>[
          Icon(Icons.info_outline, color: colors.onTertiaryContainer, size: 20),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              message,
              style: Theme.of(context)
                  .textTheme
                  .bodySmall
                  ?.copyWith(color: colors.onTertiaryContainer),
            ),
          ),
        ],
      ),
    );
  }
}

class _FailureView extends StatelessWidget {
  const _FailureView({
    required this.message,
    required this.retryLabel,
    required this.onRetry,
  });

  final String message;
  final String retryLabel;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.all(24),
      children: <Widget>[
        const SizedBox(height: 80),
        Icon(
          Icons.cloud_off_outlined,
          size: 40,
          color: Theme.of(context).colorScheme.onSurfaceVariant,
        ),
        const SizedBox(height: 16),
        Text(message, textAlign: TextAlign.center),
        const SizedBox(height: 16),
        Center(
          child: FilledButton(onPressed: onRetry, child: Text(retryLabel)),
        ),
      ],
    );
  }
}

String _statusLabel(SimulationStatus status, AppLocalizations l10n) {
  switch (status) {
    case SimulationStatus.queued:
      return l10n.statusQueued;
    case SimulationStatus.running:
      return l10n.statusRunning;
    case SimulationStatus.completed:
      return l10n.statusCompleted;
    case SimulationStatus.stopped:
      return l10n.statusStopped;
    case SimulationStatus.failed:
      return l10n.statusFailed;
    case SimulationStatus.cancelled:
      return l10n.statusCancelled;
    case SimulationStatus.unknown:
      return l10n.notAvailableShort;
  }
}

/// Local, dependency-free timestamp rendering.
///
/// Deliberately not localised into a relative phrase: an operator reading an
/// incident needs an unambiguous wall-clock time, not "2 hours ago".
String _formatTimestamp(DateTime value) {
  String two(int input) => input.toString().padLeft(2, '0');
  return '${value.year}-${two(value.month)}-${two(value.day)} '
      '${two(value.hour)}:${two(value.minute)}';
}
```

---

## FILE: apps/mobile/test/strategy_view_test.dart

```dart
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:wlct_mobile/features/strategies/domain/strategy_models.dart';
import 'package:wlct_mobile/features/strategies/presentation/strategy_state.dart';

/// Safety and parsing tests for the mobile strategy viewer.
///
/// The first group is the important one: it asserts, from the source itself,
/// that the mobile client has no write path into the strategy layer. A unit
/// test cannot prove the absence of a capability by calling it, so it reads
/// the repository and fails if a mutating verb ever appears.
void main() {
  group('mobile strategy layer is read-only', () {
    final File repository =
        File('lib/features/strategies/data/strategy_repository.dart');

    test('the repository source exists where the test expects it', () {
      expect(
        repository.existsSync(),
        isTrue,
        reason: 'Run these tests from apps/mobile so the relative path resolves.',
      );
    });

    test('the repository issues no POST, PATCH, PUT or DELETE', () {
      final String source = repository.readAsStringSync();

      expect(source.contains('_apiClient.post'), isFalse);
      expect(source.contains('_apiClient.patch'), isFalse);
      expect(source.contains('_apiClient.put'), isFalse);
      expect(source.contains('_apiClient.delete'), isFalse);
    });

    test('the repository names no enable, disable, start or stop operation', () {
      final String source = repository.readAsStringSync().toLowerCase();

      for (final String forbidden in <String>[
        'future<void> enable',
        'future<void> disable',
        'startsession',
        'stopsession',
        'submitbacktest',
      ]) {
        expect(source.contains(forbidden), isFalse, reason: forbidden);
      }
    });

    test('the controller exposes only load and refresh', () {
      final String source =
          File('lib/features/strategies/presentation/strategy_controller.dart')
              .readAsStringSync();

      expect(source.contains('Future<void> load()'), isTrue);
      expect(source.contains('Future<void> refresh()'), isTrue);
      expect(source.contains('Future<void> enable'), isFalse);
      expect(source.contains('Future<void> disable'), isFalse);
    });
  });

  group('StrategyOverview', () {
    test('reads the execution boundary and the flags', () {
      final StrategyOverview overview =
          StrategyOverview.fromJson(const <String, Object?>{
        'instances': <String, Object?>{
          'total': 3,
          'enabled': 2,
          'running': 1,
          'quarantined': 1,
          'unhealthy': 0,
        },
        'incidents': <String, Object?>{'open': 2, 'critical': 1},
        'paperSessions': <String, Object?>{'running': 1},
        'backtests': <String, Object?>{'queued': 4},
        'configuration': <String, Object?>{
          'strategyEngineEnabled': true,
          'paperTradingEnabled': true,
          'backtestEnabled': false,
          'tradingMode': 'PAPER',
          'liveExecutionReachable': false,
        },
        'latencyNote': 'Not a guarantee.',
        'disclaimer': 'SIMULATED.',
      });

      expect(overview.totalInstances, 3);
      expect(overview.quarantinedInstances, 1);
      expect(overview.criticalIncidents, 1);
      expect(overview.tradingMode, 'PAPER');
      expect(overview.liveExecutionReachable, isFalse);
      expect(overview.backtestEnabled, isFalse);
    });

    test('a malformed payload degrades to zeros rather than throwing', () {
      final StrategyOverview overview =
          StrategyOverview.fromJson(const <String, Object?>{});

      expect(overview.totalInstances, 0);
      expect(overview.liveExecutionReachable, isFalse);
      expect(overview.tradingMode, 'UNKNOWN');
    });
  });

  group('PaperSessionSummary', () {
    test('keeps decimals as strings and reads the simulated label', () {
      final PaperSessionSummary session =
          PaperSessionSummary.fromJson(const <String, Object?>{
        'id': 'session-1',
        'sessionIdentifier': 'paper-000000000001',
        'status': 'RUNNING',
        'strategyKey': 'DETERMINISTIC_IMBALANCE_V1',
        'symbol': 'BTC-USDT',
        'initialCapital': '10000.000000',
        'realisedPnl': '-12.500000',
        'feesPaid': '3.250000',
        'currentEquity': '9987.500000',
        'simulatedOrders': 4,
        'simulatedFills': 3,
        'riskRejections': 1,
        'isSimulated': true,
        'startedAt': '2026-09-07T10:00:00.000Z',
      });

      expect(session.status, SimulationStatus.running);
      expect(session.realisedPnl, '-12.500000');
      expect(session.currentEquity, '9987.500000');
      expect(session.isSimulated, isTrue);
    });

    test('treats a missing simulated label as simulated', () {
      final PaperSessionSummary session =
          PaperSessionSummary.fromJson(const <String, Object?>{
        'id': 'session-2',
        'sessionIdentifier': 'paper-000000000002',
        'status': 'STOPPED',
      });

      expect(session.isSimulated, isTrue);
    });
  });

  group('BacktestSummary', () {
    test('withheld metrics stay null rather than becoming zero', () {
      final BacktestSummary backtest =
          BacktestSummary.fromJson(const <String, Object?>{
        'id': 'backtest-1',
        'runIdentifier': 'bt-000000000000000000000001',
        'status': 'COMPLETED',
        'strategyKey': 'DETERMINISTIC_IMBALANCE_V1',
        'strategyVersion': '1.0.0',
        'symbol': 'BTC-USDT',
        'isReproducible': true,
        'queuedAt': '2026-09-07T09:00:00.000Z',
        'result': <String, Object?>{
          'netPnl': '15.250000',
          'totalTrades': 4,
          'winRate': null,
          'sharpeRatio': null,
          'hasSufficientObservations': false,
        },
      });

      expect(backtest.netPnl, '15.250000');
      expect(backtest.totalTrades, 4);
      expect(backtest.winRate, isNull);
      expect(backtest.sharpeRatio, isNull);
      expect(backtest.hasSufficientObservations, isFalse);
    });
  });

  group('StrategyViewState', () {
    test('surfaces the instances that need attention', () {
      const StrategyInstanceSummary healthy = StrategyInstanceSummary(
        id: 'a',
        name: 'Healthy',
        kind: 'DETERMINISTIC_IMBALANCE_V1',
        version: '1.0.0',
        status: StrategyInstanceStatus.running,
        health: StrategyHealth.healthy,
        enabled: true,
        venue: 'BINANCE',
        symbols: <String>['BTC-USDT'],
        consecutiveErrors: 0,
      );

      const StrategyInstanceSummary quarantined = StrategyInstanceSummary(
        id: 'b',
        name: 'Quarantined',
        kind: 'DETERMINISTIC_IMBALANCE_V1',
        version: '1.0.0',
        status: StrategyInstanceStatus.stopped,
        health: StrategyHealth.quarantined,
        enabled: false,
        venue: 'BINANCE',
        symbols: <String>['ETH-USDT'],
        consecutiveErrors: 5,
      );

      const StrategyViewState state = StrategyViewState(
        status: StrategyViewStatus.ready,
        instances: <StrategyInstanceSummary>[healthy, quarantined],
      );

      expect(state.attentionInstances, <StrategyInstanceSummary>[quarantined]);
      expect(state.hasAnyData, isTrue);
      expect(state.isDegraded, isFalse);
    });

    test('a partial failure is degraded, not failed', () {
      const StrategyViewState state = StrategyViewState(
        status: StrategyViewStatus.ready,
        degradedPanels: <String>['backtests'],
      );

      expect(state.isDegraded, isTrue);
      expect(state.status, StrategyViewStatus.ready);
    });
  });
}
```

---

## FILE: apps/mobile/pubspec.lock

```yaml
# Generated by pub
# See https://dart.dev/tools/pub/glossary#lockfile
packages:
  async:
    dependency: transitive
    description:
      name: async
      sha256: "947bfcf187f74dbc5e146c9eb9c0f10c9f8b30743e341481c1e2ed3ecc18c20c"
      url: "https://pub.dev"
    source: hosted
    version: "2.11.0"
  boolean_selector:
    dependency: transitive
    description:
      name: boolean_selector
      sha256: "6cfb5af12253eaf2b368f07bacc5a80d1301a071c73360d746b7f2e32d762c66"
      url: "https://pub.dev"
    source: hosted
    version: "2.1.1"
  characters:
    dependency: transitive
    description:
      name: characters
      sha256: "04a925763edad70e8443c99234dc3328f442e811f1d8fd1a72f1c8ad0f69a605"
      url: "https://pub.dev"
    source: hosted
    version: "1.3.0"
  clock:
    dependency: transitive
    description:
      name: clock
      sha256: cb6d7f03e1de671e34607e909a7213e31d7752be4fb66a86d29fe1eb14bfb5cf
      url: "https://pub.dev"
    source: hosted
    version: "1.1.1"
  collection:
    dependency: transitive
    description:
      name: collection
      sha256: ee67cb0715911d28db6bf4af1026078bd6f0128b07a5f66fb2ed94ec6783c09a
      url: "https://pub.dev"
    source: hosted
    version: "1.18.0"
  crypto:
    dependency: transitive
    description:
      name: crypto
      sha256: c8ea0233063ba03258fbcf2ca4d6dadfefe14f02fab57702265467a19f27fadf
      url: "https://pub.dev"
    source: hosted
    version: "3.0.7"
  device_info_plus:
    dependency: "direct main"
    description:
      name: device_info_plus
      sha256: a7fd703482b391a87d60b6061d04dfdeab07826b96f9abd8f5ed98068acc0074
      url: "https://pub.dev"
    source: hosted
    version: "10.1.2"
  device_info_plus_platform_interface:
    dependency: transitive
    description:
      name: device_info_plus_platform_interface
      sha256: "0b04e02b30791224b31969eb1b50d723498f402971bff3630bca2ba839bd1ed2"
      url: "https://pub.dev"
    source: hosted
    version: "7.0.2"
  dio:
    dependency: "direct main"
    description:
      name: dio
      sha256: "852ec3b48cc431ac04fff978413c541502b67ffc3e26921e74e3d994694192c1"
      url: "https://pub.dev"
    source: hosted
    version: "5.11.1"
  dio_web_adapter:
    dependency: transitive
    description:
      name: dio_web_adapter
      sha256: "3a1b2cd7be71086f38504956e3ebcd2837288d231ff454bafa78021244102bfc"
      url: "https://pub.dev"
    source: hosted
    version: "2.2.2"
  equatable:
    dependency: "direct main"
    description:
      name: equatable
      sha256: "3bce007a596ff8b3119c45d68aaef631272537c03d30e5d4534dd24bf4c5eaa2"
      url: "https://pub.dev"
    source: hosted
    version: "2.1.0"
  fake_async:
    dependency: transitive
    description:
      name: fake_async
      sha256: "511392330127add0b769b75a987850d136345d9227c6b94c96a04cf4a391bf78"
      url: "https://pub.dev"
    source: hosted
    version: "1.3.1"
  ffi:
    dependency: transitive
    description:
      name: ffi
      sha256: "16ed7b077ef01ad6170a3d0c57caa4a112a38d7a2ed5602e0aca9ca6f3d98da6"
      url: "https://pub.dev"
    source: hosted
    version: "2.1.3"
  file:
    dependency: transitive
    description:
      name: file
      sha256: a3b4f84adafef897088c160faf7dfffb7696046cb13ae90b508c2cbc95d3b8d4
      url: "https://pub.dev"
    source: hosted
    version: "7.0.1"
  fixnum:
    dependency: transitive
    description:
      name: fixnum
      sha256: b6dc7065e46c974bc7c5f143080a6764ec7a4be6da1285ececdc37be96de53be
      url: "https://pub.dev"
    source: hosted
    version: "1.1.1"
  flutter:
    dependency: "direct main"
    description: flutter
    source: sdk
    version: "0.0.0"
  flutter_lints:
    dependency: "direct dev"
    description:
      name: flutter_lints
      sha256: "3f41d009ba7172d5ff9be5f6e6e6abb4300e263aab8866d2a0842ed2a70f8f0c"
      url: "https://pub.dev"
    source: hosted
    version: "4.0.0"
  flutter_localizations:
    dependency: "direct main"
    description: flutter
    source: sdk
    version: "0.0.0"
  flutter_riverpod:
    dependency: "direct main"
    description:
      name: flutter_riverpod
      sha256: "9532ee6db4a943a1ed8383072a2e3eeda041db5657cdf6d2acecf3c21ecbe7e1"
      url: "https://pub.dev"
    source: hosted
    version: "2.6.1"
  flutter_secure_storage:
    dependency: "direct main"
    description:
      name: flutter_secure_storage
      sha256: "9cad52d75ebc511adfae3d447d5d13da15a55a92c9410e50f67335b6d21d16ea"
      url: "https://pub.dev"
    source: hosted
    version: "9.2.4"
  flutter_secure_storage_linux:
    dependency: transitive
    description:
      name: flutter_secure_storage_linux
      sha256: be76c1d24a97d0b98f8b54bce6b481a380a6590df992d0098f868ad54dc8f688
      url: "https://pub.dev"
    source: hosted
    version: "1.2.3"
  flutter_secure_storage_macos:
    dependency: transitive
    description:
      name: flutter_secure_storage_macos
      sha256: "6c0a2795a2d1de26ae202a0d78527d163f4acbb11cde4c75c670f3a0fc064247"
      url: "https://pub.dev"
    source: hosted
    version: "3.1.3"
  flutter_secure_storage_platform_interface:
    dependency: transitive
    description:
      name: flutter_secure_storage_platform_interface
      sha256: cf91ad32ce5adef6fba4d736a542baca9daf3beac4db2d04be350b87f69ac4a8
      url: "https://pub.dev"
    source: hosted
    version: "1.1.2"
  flutter_secure_storage_web:
    dependency: transitive
    description:
      name: flutter_secure_storage_web
      sha256: f4ebff989b4f07b2656fb16b47852c0aab9fed9b4ec1c70103368337bc1886a9
      url: "https://pub.dev"
    source: hosted
    version: "1.2.1"
  flutter_secure_storage_windows:
    dependency: transitive
    description:
      name: flutter_secure_storage_windows
      sha256: b20b07cb5ed4ed74fc567b78a72936203f587eba460af1df11281c9326cd3709
      url: "https://pub.dev"
    source: hosted
    version: "3.1.2"
  flutter_test:
    dependency: "direct dev"
    description: flutter
    source: sdk
    version: "0.0.0"
  flutter_web_plugins:
    dependency: transitive
    description: flutter
    source: sdk
    version: "0.0.0"
  go_router:
    dependency: "direct main"
    description:
      name: go_router
      sha256: f02fd7d2a4dc512fec615529824fdd217fecb3a3d3de68360293a551f21634b3
      url: "https://pub.dev"
    source: hosted
    version: "14.8.1"
  http:
    dependency: transitive
    description:
      name: http
      sha256: "87721a4a50b19c7f1d49001e51409bddc46303966ce89a65af4f4e6004896412"
      url: "https://pub.dev"
    source: hosted
    version: "1.6.0"
  http_parser:
    dependency: transitive
    description:
      name: http_parser
      sha256: "2aa08ce0341cc9b354a498388e30986515406668dbcc4f7c950c3e715496693b"
      url: "https://pub.dev"
    source: hosted
    version: "4.0.2"
  intl:
    dependency: "direct main"
    description:
      name: intl
      sha256: d6f56758b7d3014a48af9701c085700aac781a92a87a62b1333b46d8879661cf
      url: "https://pub.dev"
    source: hosted
    version: "0.19.0"
  js:
    dependency: transitive
    description:
      name: js
      sha256: f2c445dce49627136094980615a031419f7f3eb393237e4ecd97ac15dea343f3
      url: "https://pub.dev"
    source: hosted
    version: "0.6.7"
  leak_tracker:
    dependency: transitive
    description:
      name: leak_tracker
      sha256: "3f87a60e8c63aecc975dda1ceedbc8f24de75f09e4856ea27daf8958f2f0ce05"
      url: "https://pub.dev"
    source: hosted
    version: "10.0.5"
  leak_tracker_flutter_testing:
    dependency: transitive
    description:
      name: leak_tracker_flutter_testing
      sha256: "932549fb305594d82d7183ecd9fa93463e9914e1b67cacc34bc40906594a1806"
      url: "https://pub.dev"
    source: hosted
    version: "3.0.5"
  leak_tracker_testing:
    dependency: transitive
    description:
      name: leak_tracker_testing
      sha256: "6ba465d5d76e67ddf503e1161d1f4a6bc42306f9d66ca1e8f079a47290fb06d3"
      url: "https://pub.dev"
    source: hosted
    version: "3.0.1"
  lints:
    dependency: transitive
    description:
      name: lints
      sha256: "976c774dd944a42e83e2467f4cc670daef7eed6295b10b36ae8c85bcbf828235"
      url: "https://pub.dev"
    source: hosted
    version: "4.0.0"
  logging:
    dependency: transitive
    description:
      name: logging
      sha256: c8245ada5f1717ed44271ed1c26b8ce85ca3228fd2ffdb75468ab01979309d61
      url: "https://pub.dev"
    source: hosted
    version: "1.3.0"
  matcher:
    dependency: transitive
    description:
      name: matcher
      sha256: d2323aa2060500f906aa31a895b4030b6da3ebdcc5619d14ce1aada65cd161cb
      url: "https://pub.dev"
    source: hosted
    version: "0.12.16+1"
  material_color_utilities:
    dependency: transitive
    description:
      name: material_color_utilities
      sha256: f7142bb1154231d7ea5f96bc7bde4bda2a0945d2806bb11670e30b850d56bdec
      url: "https://pub.dev"
    source: hosted
    version: "0.11.1"
  meta:
    dependency: transitive
    description:
      name: meta
      sha256: bdb68674043280c3428e9ec998512fb681678676b3c54e773629ffe74419f8c7
      url: "https://pub.dev"
    source: hosted
    version: "1.15.0"
  mime:
    dependency: transitive
    description:
      name: mime
      sha256: bd47de35f07e27267e69c8c8b22edf9473bfee170a60d60fcc93730c5144b7f6
      url: "https://pub.dev"
    source: hosted
    version: "2.1.0"
  mocktail:
    dependency: "direct dev"
    description:
      name: mocktail
      sha256: "5e1bf53cc7baa8062a33b84424deb61513858ea05c601b8509e683815b5914aa"
      url: "https://pub.dev"
    source: hosted
    version: "1.0.5"
  package_info_plus:
    dependency: "direct main"
    description:
      name: package_info_plus
      sha256: "16eee997588c60225bda0488b6dcfac69280a6b7a3cf02c741895dd370a02968"
      url: "https://pub.dev"
    source: hosted
    version: "8.3.1"
  package_info_plus_platform_interface:
    dependency: transitive
    description:
      name: package_info_plus_platform_interface
      sha256: "202a487f08836a592a6bd4f901ac69b3a8f146af552bbd14407b6b41e1c3f086"
      url: "https://pub.dev"
    source: hosted
    version: "3.2.1"
  path:
    dependency: transitive
    description:
      name: path
      sha256: "087ce49c3f0dc39180befefc60fdb4acd8f8620e5682fe2476afd0b3688bb4af"
      url: "https://pub.dev"
    source: hosted
    version: "1.9.0"
  path_provider:
    dependency: transitive
    description:
      name: path_provider
      sha256: "50c5dd5b6e1aaf6fb3a78b33f6aa3afca52bf903a8a5298f53101fdaee55bbcd"
      url: "https://pub.dev"
    source: hosted
    version: "2.1.5"
  path_provider_android:
    dependency: transitive
    description:
      name: path_provider_android
      sha256: "4adf4fd5423ec60a29506c76581bc05854c55e3a0b72d35bb28d661c9686edf2"
      url: "https://pub.dev"
    source: hosted
    version: "2.2.15"
  path_provider_foundation:
    dependency: transitive
    description:
      name: path_provider_foundation
      sha256: "4843174df4d288f5e29185bd6e72a6fbdf5a4a4602717eed565497429f179942"
      url: "https://pub.dev"
    source: hosted
    version: "2.4.1"
  path_provider_linux:
    dependency: transitive
    description:
      name: path_provider_linux
      sha256: f7a1fe3a634fe7734c8d3f2766ad746ae2a2884abe22e241a8b301bf5cac3279
      url: "https://pub.dev"
    source: hosted
    version: "2.2.1"
  path_provider_platform_interface:
    dependency: transitive
    description:
      name: path_provider_platform_interface
      sha256: "88f5779f72ba699763fa3a3b06aa4bf6de76c8e5de842cf6f29e2e06476c2334"
      url: "https://pub.dev"
    source: hosted
    version: "2.1.2"
  path_provider_windows:
    dependency: transitive
    description:
      name: path_provider_windows
      sha256: bd6f00dbd873bfb70d0761682da2b3a2c2fccc2b9e84c495821639601d81afe7
      url: "https://pub.dev"
    source: hosted
    version: "2.3.0"
  platform:
    dependency: transitive
    description:
      name: platform
      sha256: "5d6b1b0036a5f331ebc77c850ebc8506cbc1e9416c27e59b439f917a902a4984"
      url: "https://pub.dev"
    source: hosted
    version: "3.1.6"
  plugin_platform_interface:
    dependency: transitive
    description:
      name: plugin_platform_interface
      sha256: "4820fbfdb9478b1ebae27888254d445073732dae3d6ea81f0b7e06d5dedc3f02"
      url: "https://pub.dev"
    source: hosted
    version: "2.1.8"
  riverpod:
    dependency: transitive
    description:
      name: riverpod
      sha256: "59062512288d3056b2321804332a13ffdd1bf16df70dcc8e506e411280a72959"
      url: "https://pub.dev"
    source: hosted
    version: "2.6.1"
  shared_preferences:
    dependency: "direct main"
    description:
      name: shared_preferences
      sha256: "6e8bf70b7fef813df4e9a36f658ac46d107db4b4cfe1048b477d4e453a8159f5"
      url: "https://pub.dev"
    source: hosted
    version: "2.5.3"
  shared_preferences_android:
    dependency: transitive
    description:
      name: shared_preferences_android
      sha256: "9f9f3d372d4304723e6136663bb291c0b93f5e4c8a4a6314347f481a33bda2b1"
      url: "https://pub.dev"
    source: hosted
    version: "2.4.7"
  shared_preferences_foundation:
    dependency: transitive
    description:
      name: shared_preferences_foundation
      sha256: "6a52cfcdaeac77cad8c97b539ff688ccfc458c007b4db12be584fbe5c0e49e03"
      url: "https://pub.dev"
    source: hosted
    version: "2.5.4"
  shared_preferences_linux:
    dependency: transitive
    description:
      name: shared_preferences_linux
      sha256: "580abfd40f415611503cae30adf626e6656dfb2f0cee8f465ece7b6defb40f2f"
      url: "https://pub.dev"
    source: hosted
    version: "2.4.1"
  shared_preferences_platform_interface:
    dependency: transitive
    description:
      name: shared_preferences_platform_interface
      sha256: "57cbf196c486bc2cf1f02b85784932c6094376284b3ad5779d1b1c6c6a816b80"
      url: "https://pub.dev"
    source: hosted
    version: "2.4.1"
  shared_preferences_web:
    dependency: transitive
    description:
      name: shared_preferences_web
      sha256: c49bd060261c9a3f0ff445892695d6212ff603ef3115edbb448509d407600019
      url: "https://pub.dev"
    source: hosted
    version: "2.4.3"
  shared_preferences_windows:
    dependency: transitive
    description:
      name: shared_preferences_windows
      sha256: "94ef0f72b2d71bc3e700e025db3710911bd51a71cefb65cc609dd0d9a982e3c1"
      url: "https://pub.dev"
    source: hosted
    version: "2.4.1"
  sky_engine:
    dependency: transitive
    description: flutter
    source: sdk
    version: "0.0.99"
  source_span:
    dependency: transitive
    description:
      name: source_span
      sha256: "53e943d4206a5e30df338fd4c6e7a077e02254531b138a15aec3bd143c1a8b3c"
      url: "https://pub.dev"
    source: hosted
    version: "1.10.0"
  stack_trace:
    dependency: transitive
    description:
      name: stack_trace
      sha256: "73713990125a6d93122541237550ee3352a2d84baad52d375a4cad2eb9b7ce0b"
      url: "https://pub.dev"
    source: hosted
    version: "1.11.1"
  state_notifier:
    dependency: transitive
    description:
      name: state_notifier
      sha256: b8677376aa54f2d7c58280d5a007f9e8774f1968d1fb1c096adcb4792fba29bb
      url: "https://pub.dev"
    source: hosted
    version: "1.0.0"
  stream_channel:
    dependency: transitive
    description:
      name: stream_channel
      sha256: ba2aa5d8cc609d96bbb2899c28934f9e1af5cddbd60a827822ea467161eb54e7
      url: "https://pub.dev"
    source: hosted
    version: "2.1.2"
  string_scanner:
    dependency: transitive
    description:
      name: string_scanner
      sha256: "556692adab6cfa87322a115640c11f13cb77b3f076ddcc5d6ae3c20242bedcde"
      url: "https://pub.dev"
    source: hosted
    version: "1.2.0"
  term_glyph:
    dependency: transitive
    description:
      name: term_glyph
      sha256: a29248a84fbb7c79282b40b8c72a1209db169a2e0542bce341da992fe1bc7e84
      url: "https://pub.dev"
    source: hosted
    version: "1.2.1"
  test_api:
    dependency: transitive
    description:
      name: test_api
      sha256: "5b8a98dafc4d5c4c9c72d8b31ab2b23fc13422348d2997120294d3bac86b4ddb"
      url: "https://pub.dev"
    source: hosted
    version: "0.7.2"
  typed_data:
    dependency: transitive
    description:
      name: typed_data
      sha256: f9049c039ebfeb4cf7a7104a675823cd72dba8297f264b6637062516699fa006
      url: "https://pub.dev"
    source: hosted
    version: "1.4.0"
  uuid:
    dependency: "direct main"
    description:
      name: uuid
      sha256: "9b129329f58692f6e6578329498a8fe9fbe98f090beb764ffbb8ee2eadd01dcd"
      url: "https://pub.dev"
    source: hosted
    version: "4.6.0"
  vector_math:
    dependency: transitive
    description:
      name: vector_math
      sha256: "80b3257d1492ce4d091729e3a67a60407d227c27241d6927be0130c98e741803"
      url: "https://pub.dev"
    source: hosted
    version: "2.1.4"
  vm_service:
    dependency: transitive
    description:
      name: vm_service
      sha256: "5c5f338a667b4c644744b661f309fb8080bb94b18a7e91ef1dbd343bed00ed6d"
      url: "https://pub.dev"
    source: hosted
    version: "14.2.5"
  web:
    dependency: transitive
    description:
      name: web
      sha256: "868d88a33d8a87b18ffc05f9f030ba328ffefba92d6c127917a2ba740f9cfe4a"
      url: "https://pub.dev"
    source: hosted
    version: "1.1.1"
  win32:
    dependency: transitive
    description:
      name: win32
      sha256: daf97c9d80197ed7b619040e86c8ab9a9dad285e7671ee7390f9180cc828a51e
      url: "https://pub.dev"
    source: hosted
    version: "5.10.1"
  win32_registry:
    dependency: transitive
    description:
      name: win32_registry
      sha256: "21ec76dfc731550fd3e2ce7a33a9ea90b828fdf19a5c3bcf556fa992cfa99852"
      url: "https://pub.dev"
    source: hosted
    version: "1.1.5"
  xdg_directories:
    dependency: transitive
    description:
      name: xdg_directories
      sha256: "7a3f37b05d989967cdddcbb571f1ea834867ae2faa29725fd085180e0883aa15"
      url: "https://pub.dev"
    source: hosted
    version: "1.1.0"
sdks:
  dart: ">=3.5.0 <4.0.0"
  flutter: ">=3.24.0"
```

---

# Part B — modified files (complete final content)

## FILE: apps/api/prisma/schema.prisma

```prisma
// =============================================================================
// White-Label Crypto Copy-Trading Platform - Prisma schema (Part 1 foundation)
// =============================================================================
// Design rules enforced here:
//  * UUID primary keys everywhere (no sequential ids leaking volume/ordering).
//  * Every tenant-scoped table carries `tenantId` as the FIRST column of its
//    composite indexes and unique constraints, so a query that forgets the
//    tenant filter cannot accidentally hit another brand's rows through an
//    index scan, and uniqueness is always per tenant.
//  * `deletedAt` soft deletion on aggregates that must survive for audit or
//    billing reasons; hard delete for ephemeral rows (tokens, sessions).
//  * Cascade deletes only downwards from an aggregate root (tenant -> user ->
//    session). Audit rows never cascade: they outlive their subject.
//  * Trading tables are intentionally NOT defined yet; the `TenantSetting`,
//    `FeatureFlag` and role/permission tables are generic enough that Part 2
//    can add them without touching this file's semantics.
// =============================================================================

generator client {
  provider        = "prisma-client-js"
  binaryTargets   = ["native"]
  previewFeatures = []
}

datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_DATABASE_URL")
}

// -----------------------------------------------------------------------------
// Enums
// -----------------------------------------------------------------------------

enum TenantStatus {
  PENDING
  ACTIVE
  SUSPENDED
  ARCHIVED
}

enum TenantDomainStatus {
  PENDING_DNS
  PENDING_CERTIFICATE
  ACTIVE
  FAILED
}

enum UserStatus {
  PENDING_VERIFICATION
  ACTIVE
  SUSPENDED
  LOCKED
  DEACTIVATED
}

enum KycStatus {
  NOT_STARTED
  PENDING
  IN_REVIEW
  APPROVED
  REJECTED
  EXPIRED
}

enum RoleScope {
  PLATFORM
  TENANT
}

enum TwoFactorMethod {
  TOTP
  EMAIL
  SMS
}

enum TwoFactorStatus {
  PENDING_ACTIVATION
  ACTIVE
  DISABLED
}

enum TokenStatus {
  ACTIVE
  ROTATED
  REVOKED
  EXPIRED
}

enum AuditActorType {
  USER
  SYSTEM
  SERVICE
  API_KEY
}

enum AuditOutcome {
  SUCCESS
  FAILURE
  DENIED
}

enum SecurityEventType {
  SUSPICIOUS_LOGIN
  NEW_DEVICE_LOGIN
  IMPOSSIBLE_TRAVEL
  BRUTE_FORCE_SUSPECTED
  CREDENTIAL_STUFFING_SUSPECTED
  TOKEN_REUSE
  RATE_LIMIT_ABUSE
  PERMISSION_ESCALATION_ATTEMPT
  TENANT_ISOLATION_VIOLATION
  ENCRYPTION_FAILURE
}

enum SecuritySeverity {
  LOW
  MEDIUM
  HIGH
  CRITICAL
}

enum BillingInterval {
  MONTHLY
  QUARTERLY
  YEARLY
  LIFETIME
}

enum PlanAudience {
  TENANT
  END_USER
}

enum SubscriptionStatus {
  TRIALING
  ACTIVE
  PAST_DUE
  CANCELED
  EXPIRED
  PAUSED
}

enum VerificationTokenType {
  EMAIL_VERIFICATION
  PASSWORD_RESET
  INVITATION
  EMAIL_CHANGE
}

enum NotificationChannel {
  IN_APP
  EMAIL
  PUSH
  SMS
  WEBHOOK
  TELEGRAM
}

// -----------------------------------------------------------------------------
// Tenancy
// -----------------------------------------------------------------------------

model Tenant {
  id        String       @id @default(uuid()) @db.Uuid
  slug      String       @unique @db.VarChar(63)
  name      String       @db.VarChar(120)
  legalName String?      @map("legal_name") @db.VarChar(160)
  status    TenantStatus @default(PENDING)

  ownerUserId String? @map("owner_user_id") @db.Uuid

  contactEmail String? @map("contact_email") @db.VarChar(254)
  contactPhone String? @map("contact_phone") @db.VarChar(20)
  countryCode  String? @map("country_code") @db.Char(2)

  defaultLocale       String   @default("en") @map("default_locale") @db.VarChar(8)
  supportedLocales    String[] @default(["en"])
  defaultCurrency     String   @default("USD") @map("default_currency") @db.VarChar(3)
  supportedCurrencies String[] @default(["USD"])
  timezone            String   @default("UTC") @db.VarChar(64)

  // Commercial configuration expressed in basis points to avoid float drift.
  platformFeeBps    Int @default(0) @map("platform_fee_bps")
  performanceFeeBps Int @default(2000) @map("performance_fee_bps")

  maxUsers   Int? @map("max_users")
  maxTraders Int? @map("max_traders")

  metadata Json @default("{}")

  createdAt DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime  @updatedAt @map("updated_at") @db.Timestamptz(6)
  deletedAt DateTime? @map("deleted_at") @db.Timestamptz(6)

  branding       TenantBranding?
  settings       TenantSetting[]
  domains        TenantDomain[]
  users          User[]
  roles          Role[]
  subscriptions  TenantSubscription[]
  plans          SubscriptionPlan[]
  featureFlags   TenantFeatureFlag[]
  auditLogs      AuditLog[]
  securityEvents SecurityEvent[]
  apiKeys        TenantApiKey[]
  notifications  Notification[]
  kycProfiles    KycProfile[]

  // Part 2 - trading control plane. Every trading aggregate is tenant-scoped
  // so the isolation invariant established in Part 1 extends unchanged into
  // the trading domain.
  tradingAccounts    TradingAccount[]
  tradingSymbols     TradingSymbol[]
  strategies         Strategy[]
  orders             Order[]
  positions          Position[]
  riskConfigurations RiskConfiguration[]
  riskEvents         RiskEvent[]
  tradingSessions    TradingSession[]
  killSwitches       KillSwitch[]

  // Part 5 - authenticated execution. Same rule: every aggregate that can be
  // traced back to a customer's money is tenant-scoped, so a query that forgets
  // the tenant filter fails to compile rather than leaking across tenants.
  accountBalances        AccountBalanceSnapshot[]
  exchangeStreamSessions ExchangeStreamSession[]
  reconciliationRuns     ReconciliationRun[]
  executionIncidents     ExecutionIncident[]

  // Part 6 - strategy layer. The definition catalogue and its versions are
  // platform-level (they describe code that ships with the release, not
  // customer data) and are deliberately absent here. Everything that records
  // what a tenant's strategy actually did is tenant-scoped.
  strategyRuns         StrategyRun[]
  strategyCheckpoints  StrategyCheckpoint[]
  strategyIncidents    StrategyIncident[]
  backtestRuns         BacktestRun[]
  backtestMetrics      BacktestMetric[]
  backtestTrades       BacktestTrade[]
  paperTradingSessions PaperTradingSession[]
  paperPortfolioSnaps  PaperPortfolioSnapshot[]

  @@index([status])
  @@index([deletedAt])
  @@index([createdAt])
  @@map("tenants")
}

model TenantBranding {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @unique @map("tenant_id") @db.Uuid

  appName         String  @map("app_name") @db.VarChar(64)
  logoUrl         String? @map("logo_url") @db.VarChar(2048)
  logoDarkUrl     String? @map("logo_dark_url") @db.VarChar(2048)
  faviconUrl      String? @map("favicon_url") @db.VarChar(2048)
  primaryColor    String  @default("#1B2A4A") @map("primary_color") @db.VarChar(9)
  secondaryColor  String  @default("#0F172A") @map("secondary_color") @db.VarChar(9)
  accentColor     String  @default("#22C55E") @map("accent_color") @db.VarChar(9)
  backgroundColor String  @default("#FFFFFF") @map("background_color") @db.VarChar(9)
  textColor       String  @default("#0B1220") @map("text_color") @db.VarChar(9)
  fontFamily      String  @default("Inter") @map("font_family") @db.VarChar(64)
  themeMode       String  @default("system") @map("theme_mode") @db.VarChar(10)

  supportEmail String? @map("support_email") @db.VarChar(254)
  supportUrl   String? @map("support_url") @db.VarChar(2048)
  termsUrl     String? @map("terms_url") @db.VarChar(2048)
  privacyUrl   String? @map("privacy_url") @db.VarChar(2048)
  customCss    String? @map("custom_css") @db.Text
  socialLinks  Json    @default("{}") @map("social_links")

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@map("tenant_branding")
}

model TenantSetting {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  key      String  @db.VarChar(64)
  value    Json
  category String  @default("general") @db.VarChar(32)
  /// When true the value column holds an encrypted envelope, never plaintext.
  isSecret Boolean @default(false) @map("is_secret")

  description String? @db.VarChar(240)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@unique([tenantId, key])
  @@index([tenantId, category])
  @@map("tenant_settings")
}

model TenantDomain {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  domain            String             @unique @db.VarChar(253)
  isPrimary         Boolean            @default(false) @map("is_primary")
  status            TenantDomainStatus @default(PENDING_DNS)
  verificationToken String             @map("verification_token") @db.VarChar(64)
  verifiedAt        DateTime?          @map("verified_at") @db.Timestamptz(6)
  certificateExpiry DateTime?          @map("certificate_expiry") @db.Timestamptz(6)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@index([tenantId, isPrimary])
  @@index([status])
  @@map("tenant_domains")
}

// -----------------------------------------------------------------------------
// Identity
// -----------------------------------------------------------------------------

model User {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  email        String  @db.VarChar(254)
  /// HMAC of the lowercase email; enables constant-time lookup and analytics
  /// without exposing the address in indexes shared with third-party tooling.
  emailIndex   String  @map("email_index") @db.VarChar(64)
  passwordHash String  @map("password_hash") @db.VarChar(255)
  phone        String? @db.VarChar(20)

  emailVerifiedAt DateTime? @map("email_verified_at") @db.Timestamptz(6)
  phoneVerifiedAt DateTime? @map("phone_verified_at") @db.Timestamptz(6)

  status    UserStatus @default(PENDING_VERIFICATION)
  kycStatus KycStatus  @default(NOT_STARTED) @map("kyc_status")

  /// Platform staff (super admins) are attached to the platform tenant and can
  /// be authorised across tenants; ordinary users never can.
  isPlatformUser Boolean @default(false) @map("is_platform_user")

  twoFactorEnabled Boolean @default(false) @map("two_factor_enabled")

  failedLoginAttempts Int       @default(0) @map("failed_login_attempts")
  lockedUntil         DateTime? @map("locked_until") @db.Timestamptz(6)
  lastLoginAt         DateTime? @map("last_login_at") @db.Timestamptz(6)
  lastLoginIpHash     String?   @map("last_login_ip_hash") @db.VarChar(64)
  passwordChangedAt   DateTime  @default(now()) @map("password_changed_at") @db.Timestamptz(6)
  /// Bumped on password change / global logout to invalidate live access tokens.
  sessionVersion      Int       @default(0) @map("session_version")

  referralCode   String? @unique @map("referral_code") @db.VarChar(16)
  referredByCode String? @map("referred_by_code") @db.VarChar(16)

  metadata Json @default("{}")

  createdAt DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime  @updatedAt @map("updated_at") @db.Timestamptz(6)
  deletedAt DateTime? @map("deleted_at") @db.Timestamptz(6)

  tenant             Tenant                   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  profile            UserProfile?
  roles              UserRole[]
  refreshTokens      RefreshToken[]
  sessions           UserSession[]
  twoFactor          TwoFactorAuth?
  recoveryCodes      TwoFactorRecoveryCode[]
  verificationTokens VerificationToken[]
  loginAttempts      LoginAttempt[]
  securityEvents     SecurityEvent[]
  notifications      Notification[]
  notificationPrefs  NotificationPreference[]
  kycProfile         KycProfile?
  assignedRoles      UserRole[]               @relation("RoleAssignedBy")

  /// Part 2 - exchange connections this user owns. Non-custodial: the user
  /// supplies their own trade-enabled, withdrawal-disabled API key.
  tradingAccounts TradingAccount[]

  @@unique([tenantId, email])
  @@unique([tenantId, emailIndex])
  @@index([tenantId, status])
  @@index([tenantId, createdAt])
  @@index([tenantId, deletedAt])
  @@index([emailIndex])
  @@map("users")
}

model UserProfile {
  id     String @id @default(uuid()) @db.Uuid
  userId String @unique @map("user_id") @db.Uuid

  firstName   String? @map("first_name") @db.VarChar(64)
  lastName    String? @map("last_name") @db.VarChar(64)
  displayName String? @map("display_name") @db.VarChar(64)
  avatarUrl   String? @map("avatar_url") @db.VarChar(2048)
  bio         String? @db.VarChar(500)
  countryCode String? @map("country_code") @db.Char(2)
  timezone    String  @default("UTC") @db.VarChar(64)
  locale      String  @default("en") @db.VarChar(8)

  preferredCurrency String  @default("USD") @map("preferred_currency") @db.VarChar(3)
  marketingOptIn    Boolean @default(false) @map("marketing_opt_in")

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("user_profiles")
}

// -----------------------------------------------------------------------------
// RBAC
// -----------------------------------------------------------------------------

model Role {
  id String @id @default(uuid()) @db.Uuid

  /// Null tenantId marks a platform-provided system role template.
  tenantId String? @map("tenant_id") @db.Uuid

  key         String    @db.VarChar(64)
  name        String    @db.VarChar(120)
  description String?   @db.VarChar(500)
  scope       RoleScope @default(TENANT)
  isSystem    Boolean   @default(false) @map("is_system")
  isDefault   Boolean   @default(false) @map("is_default")
  priority    Int       @default(100)

  createdAt DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime  @updatedAt @map("updated_at") @db.Timestamptz(6)
  deletedAt DateTime? @map("deleted_at") @db.Timestamptz(6)

  tenant      Tenant?          @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  permissions RolePermission[]
  users       UserRole[]

  @@unique([tenantId, key])
  @@index([tenantId, scope])
  @@index([isSystem])
  @@map("roles")
}

model Permission {
  id String @id @default(uuid()) @db.Uuid

  key         String  @unique @db.VarChar(64)
  resource    String  @db.VarChar(48)
  action      String  @db.VarChar(32)
  description String? @db.VarChar(500)
  /// Permissions flagged dangerous require re-authentication before granting.
  isDangerous Boolean @default(false) @map("is_dangerous")

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  roles RolePermission[]

  @@index([resource])
  @@map("permissions")
}

model RolePermission {
  roleId       String @map("role_id") @db.Uuid
  permissionId String @map("permission_id") @db.Uuid

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  role       Role       @relation(fields: [roleId], references: [id], onDelete: Cascade)
  permission Permission @relation(fields: [permissionId], references: [id], onDelete: Cascade)

  @@id([roleId, permissionId])
  @@index([permissionId])
  @@map("role_permissions")
}

model UserRole {
  id     String @id @default(uuid()) @db.Uuid
  userId String @map("user_id") @db.Uuid
  roleId String @map("role_id") @db.Uuid

  /// Denormalised for tenant-scoped index locality and defence in depth.
  tenantId String @map("tenant_id") @db.Uuid

  assignedById String?   @map("assigned_by_id") @db.Uuid
  assignedAt   DateTime  @default(now()) @map("assigned_at") @db.Timestamptz(6)
  expiresAt    DateTime? @map("expires_at") @db.Timestamptz(6)

  user       User  @relation(fields: [userId], references: [id], onDelete: Cascade)
  role       Role  @relation(fields: [roleId], references: [id], onDelete: Cascade)
  assignedBy User? @relation("RoleAssignedBy", fields: [assignedById], references: [id], onDelete: SetNull)

  @@unique([userId, roleId])
  @@index([tenantId, roleId])
  @@index([userId])
  @@index([expiresAt])
  @@map("user_roles")
}

// -----------------------------------------------------------------------------
// Sessions, tokens and 2FA
// -----------------------------------------------------------------------------

model UserSession {
  id       String @id @default(uuid()) @db.Uuid
  userId   String @map("user_id") @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  deviceId   String  @map("device_id") @db.VarChar(128)
  deviceName String? @map("device_name") @db.VarChar(64)
  platform   String? @db.VarChar(16)
  appVersion String? @map("app_version") @db.VarChar(32)
  userAgent  String? @map("user_agent") @db.VarChar(512)
  ipHash     String  @map("ip_hash") @db.VarChar(64)
  /// Coarse geo label ("BD/Dhaka") derived at login for impossible-travel checks.
  geoLabel   String? @map("geo_label") @db.VarChar(64)
  trusted    Boolean @default(false)

  createdAt    DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
  lastSeenAt   DateTime  @default(now()) @map("last_seen_at") @db.Timestamptz(6)
  expiresAt    DateTime  @map("expires_at") @db.Timestamptz(6)
  revokedAt    DateTime? @map("revoked_at") @db.Timestamptz(6)
  revokeReason String?   @map("revoke_reason") @db.VarChar(120)

  user          User           @relation(fields: [userId], references: [id], onDelete: Cascade)
  refreshTokens RefreshToken[]

  @@index([userId, revokedAt])
  @@index([tenantId, userId])
  @@index([expiresAt])
  @@index([deviceId])
  @@map("user_sessions")
}

model RefreshToken {
  id        String @id @default(uuid()) @db.Uuid
  userId    String @map("user_id") @db.Uuid
  tenantId  String @map("tenant_id") @db.Uuid
  sessionId String @map("session_id") @db.Uuid

  /// HMAC-SHA512 of the token. The raw value only ever exists in the response.
  tokenHash String      @unique @map("token_hash") @db.VarChar(128)
  /// Rotation family: reuse of any consumed token revokes the whole family.
  familyId  String      @map("family_id") @db.Uuid
  status    TokenStatus @default(ACTIVE)

  replacedByTokenId String? @map("replaced_by_token_id") @db.Uuid

  issuedAt     DateTime  @default(now()) @map("issued_at") @db.Timestamptz(6)
  expiresAt    DateTime  @map("expires_at") @db.Timestamptz(6)
  usedAt       DateTime? @map("used_at") @db.Timestamptz(6)
  revokedAt    DateTime? @map("revoked_at") @db.Timestamptz(6)
  revokeReason String?   @map("revoke_reason") @db.VarChar(120)

  ipHash    String? @map("ip_hash") @db.VarChar(64)
  userAgent String? @map("user_agent") @db.VarChar(512)

  user    User        @relation(fields: [userId], references: [id], onDelete: Cascade)
  session UserSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)

  @@index([userId, status])
  @@index([familyId])
  @@index([expiresAt])
  @@index([tenantId, userId])
  @@map("refresh_tokens")
}

model TwoFactorAuth {
  id     String @id @default(uuid()) @db.Uuid
  userId String @unique @map("user_id") @db.Uuid

  method TwoFactorMethod @default(TOTP)
  status TwoFactorStatus @default(PENDING_ACTIVATION)

  /// Envelope-encrypted TOTP secret: { ciphertext, iv, authTag, wrappedKey, keyId }.
  secretCiphertext Json   @map("secret_ciphertext")
  encryptionKeyId  String @map("encryption_key_id") @db.VarChar(64)

  lastVerifiedAt  DateTime? @map("last_verified_at") @db.Timestamptz(6)
  /// Last accepted TOTP counter, blocks replay of the same code.
  lastUsedCounter BigInt?   @map("last_used_counter")
  failedAttempts  Int       @default(0) @map("failed_attempts")
  activatedAt     DateTime? @map("activated_at") @db.Timestamptz(6)
  disabledAt      DateTime? @map("disabled_at") @db.Timestamptz(6)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("two_factor_auth")
}

model TwoFactorRecoveryCode {
  id     String @id @default(uuid()) @db.Uuid
  userId String @map("user_id") @db.Uuid

  /// Argon2 hash of a single-use recovery code.
  codeHash   String    @map("code_hash") @db.VarChar(255)
  usedAt     DateTime? @map("used_at") @db.Timestamptz(6)
  usedIpHash String?   @map("used_ip_hash") @db.VarChar(64)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, usedAt])
  @@map("two_factor_recovery_codes")
}

model VerificationToken {
  id       String @id @default(uuid()) @db.Uuid
  userId   String @map("user_id") @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  type      VerificationTokenType
  tokenHash String                @unique @map("token_hash") @db.VarChar(128)
  payload   Json                  @default("{}")

  expiresAt  DateTime  @map("expires_at") @db.Timestamptz(6)
  consumedAt DateTime? @map("consumed_at") @db.Timestamptz(6)
  createdAt  DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, type])
  @@index([expiresAt])
  @@map("verification_tokens")
}

model LoginAttempt {
  id       String  @id @default(uuid()) @db.Uuid
  tenantId String  @map("tenant_id") @db.Uuid
  userId   String? @map("user_id") @db.Uuid

  emailIndex String  @map("email_index") @db.VarChar(64)
  successful Boolean
  reason     String? @db.VarChar(64)
  ipHash     String  @map("ip_hash") @db.VarChar(64)
  userAgent  String? @map("user_agent") @db.VarChar(512)
  deviceId   String? @map("device_id") @db.VarChar(128)
  geoLabel   String? @map("geo_label") @db.VarChar(64)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  user User? @relation(fields: [userId], references: [id], onDelete: SetNull)

  @@index([tenantId, emailIndex, createdAt])
  @@index([ipHash, createdAt])
  @@index([createdAt])
  @@map("login_attempts")
}

// -----------------------------------------------------------------------------
// Governance: audit, security, API keys
// -----------------------------------------------------------------------------

model AuditLog {
  id       String  @id @default(uuid()) @db.Uuid
  tenantId String? @map("tenant_id") @db.Uuid

  actorType  AuditActorType @default(USER) @map("actor_type")
  actorId    String?        @map("actor_id") @db.Uuid
  actorEmail String?        @map("actor_email") @db.VarChar(254)

  action       String       @db.VarChar(64)
  outcome      AuditOutcome @default(SUCCESS)
  resourceType String?      @map("resource_type") @db.VarChar(64)
  resourceId   String?      @map("resource_id") @db.VarChar(64)
  description  String?      @db.VarChar(500)

  /// { field: { before, after } } with sensitive fields already redacted.
  changes  Json?
  metadata Json?

  ipHash    String? @map("ip_hash") @db.VarChar(64)
  userAgent String? @map("user_agent") @db.VarChar(512)
  requestId String? @map("request_id") @db.VarChar(64)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  tenant Tenant? @relation(fields: [tenantId], references: [id], onDelete: SetNull)

  @@index([tenantId, createdAt])
  @@index([tenantId, action, createdAt])
  @@index([actorId, createdAt])
  @@index([resourceType, resourceId])
  @@index([createdAt])
  @@map("audit_logs")
}

model SecurityEvent {
  id       String  @id @default(uuid()) @db.Uuid
  tenantId String? @map("tenant_id") @db.Uuid
  userId   String? @map("user_id") @db.Uuid

  type        SecurityEventType
  severity    SecuritySeverity  @default(LOW)
  description String            @db.VarChar(500)
  metadata    Json?

  ipHash    String? @map("ip_hash") @db.VarChar(64)
  userAgent String? @map("user_agent") @db.VarChar(512)
  requestId String? @map("request_id") @db.VarChar(64)

  resolved     Boolean   @default(false)
  resolvedAt   DateTime? @map("resolved_at") @db.Timestamptz(6)
  resolvedById String?   @map("resolved_by_id") @db.Uuid
  resolution   String?   @db.VarChar(500)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  tenant Tenant? @relation(fields: [tenantId], references: [id], onDelete: SetNull)
  user   User?   @relation(fields: [userId], references: [id], onDelete: SetNull)

  @@index([tenantId, createdAt])
  @@index([userId, createdAt])
  @@index([severity, resolved])
  @@index([type, createdAt])
  @@map("security_events")
}

model TenantApiKey {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  name       String @db.VarChar(120)
  /// Public, non-secret identifier shown in dashboards.
  keyId      String @unique @map("key_id") @db.VarChar(48)
  /// HMAC of the secret half. The secret is displayed once at creation time.
  secretHash String @map("secret_hash") @db.VarChar(128)

  scopes      String[] @default([])
  ipAllowlist String[] @default([])

  lastUsedAt DateTime? @map("last_used_at") @db.Timestamptz(6)
  expiresAt  DateTime? @map("expires_at") @db.Timestamptz(6)
  revokedAt  DateTime? @map("revoked_at") @db.Timestamptz(6)

  createdById String?  @map("created_by_id") @db.Uuid
  createdAt   DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt   DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@index([tenantId, revokedAt])
  @@map("tenant_api_keys")
}

// -----------------------------------------------------------------------------
// Commercial: plans, subscriptions, feature flags
// -----------------------------------------------------------------------------

model SubscriptionPlan {
  id String @id @default(uuid()) @db.Uuid

  /// Null tenantId = platform catalogue plan sold to tenants.
  tenantId String? @map("tenant_id") @db.Uuid

  code        String       @db.VarChar(48)
  name        String       @db.VarChar(120)
  description String?      @db.VarChar(500)
  audience    PlanAudience @default(TENANT)

  price     Decimal         @db.Decimal(18, 6)
  currency  String          @default("USD") @db.VarChar(3)
  interval  BillingInterval @default(MONTHLY)
  trialDays Int             @default(0) @map("trial_days")

  performanceFeeBps Int @default(0) @map("performance_fee_bps")
  platformFeeBps    Int @default(0) @map("platform_fee_bps")

  limits   Json     @default("{}")
  features String[] @default([])

  isActive  Boolean @default(true) @map("is_active")
  sortOrder Int     @default(0) @map("sort_order")

  externalPriceId String? @map("external_price_id") @db.VarChar(128)

  createdAt DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime  @updatedAt @map("updated_at") @db.Timestamptz(6)
  deletedAt DateTime? @map("deleted_at") @db.Timestamptz(6)

  tenant        Tenant?              @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  subscriptions TenantSubscription[]

  @@unique([tenantId, code])
  @@index([audience, isActive])
  @@map("subscription_plans")
}

model TenantSubscription {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid
  planId   String @map("plan_id") @db.Uuid

  status SubscriptionStatus @default(TRIALING)

  currentPeriodStart DateTime  @default(now()) @map("current_period_start") @db.Timestamptz(6)
  currentPeriodEnd   DateTime  @map("current_period_end") @db.Timestamptz(6)
  trialEndsAt        DateTime? @map("trial_ends_at") @db.Timestamptz(6)

  cancelAtPeriodEnd Boolean   @default(false) @map("cancel_at_period_end")
  canceledAt        DateTime? @map("canceled_at") @db.Timestamptz(6)
  cancelReason      String?   @map("cancel_reason") @db.VarChar(500)

  seatsPurchased Int @default(1) @map("seats_purchased")

  externalCustomerId     String? @map("external_customer_id") @db.VarChar(128)
  externalSubscriptionId String? @map("external_subscription_id") @db.VarChar(128)

  metadata Json @default("{}")

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant Tenant           @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  plan   SubscriptionPlan @relation(fields: [planId], references: [id], onDelete: Restrict)

  @@index([tenantId, status])
  @@index([status, currentPeriodEnd])
  @@map("tenant_subscriptions")
}

model FeatureFlag {
  id String @id @default(uuid()) @db.Uuid

  key         String  @unique @db.VarChar(64)
  name        String  @db.VarChar(120)
  description String? @db.VarChar(500)

  isGlobalDefault   Boolean @default(false) @map("is_global_default")
  rolloutPercentage Int     @default(100) @map("rollout_percentage")

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenantOverrides TenantFeatureFlag[]

  @@map("feature_flags")
}

model TenantFeatureFlag {
  id            String @id @default(uuid()) @db.Uuid
  tenantId      String @map("tenant_id") @db.Uuid
  featureFlagId String @map("feature_flag_id") @db.Uuid

  enabled           Boolean @default(false)
  rolloutPercentage Int?    @map("rollout_percentage")
  metadata          Json    @default("{}")

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant      Tenant      @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  featureFlag FeatureFlag @relation(fields: [featureFlagId], references: [id], onDelete: Cascade)

  @@unique([tenantId, featureFlagId])
  @@index([tenantId, enabled])
  @@map("tenant_feature_flags")
}

// -----------------------------------------------------------------------------
// Compliance and notifications (foundation only)
// -----------------------------------------------------------------------------

model KycProfile {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid
  userId   String @unique @map("user_id") @db.Uuid

  status              KycStatus @default(NOT_STARTED)
  provider            String?   @db.VarChar(32)
  /// Identifier issued by the KYC vendor; no document data is stored locally.
  externalApplicantId String?   @map("external_applicant_id") @db.VarChar(128)
  levelName           String?   @map("level_name") @db.VarChar(64)

  submittedAt     DateTime? @map("submitted_at") @db.Timestamptz(6)
  reviewedAt      DateTime? @map("reviewed_at") @db.Timestamptz(6)
  expiresAt       DateTime? @map("expires_at") @db.Timestamptz(6)
  rejectionReason String?   @map("rejection_reason") @db.VarChar(500)

  riskScore Int? @map("risk_score")
  metadata  Json @default("{}")

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([tenantId, status])
  @@map("kyc_profiles")
}

model Notification {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid
  userId   String @map("user_id") @db.Uuid

  channel NotificationChannel @default(IN_APP)
  type    String              @db.VarChar(64)
  title   String              @db.VarChar(160)
  body    String              @db.VarChar(1000)
  data    Json                @default("{}")

  readAt        DateTime? @map("read_at") @db.Timestamptz(6)
  deliveredAt   DateTime? @map("delivered_at") @db.Timestamptz(6)
  failedAt      DateTime? @map("failed_at") @db.Timestamptz(6)
  failureReason String?   @map("failure_reason") @db.VarChar(500)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([tenantId, userId, createdAt])
  @@index([userId, readAt])
  @@map("notifications")
}

model NotificationPreference {
  id     String @id @default(uuid()) @db.Uuid
  userId String @map("user_id") @db.Uuid

  category String              @db.VarChar(48)
  channel  NotificationChannel
  enabled  Boolean             @default(true)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, category, channel])
  @@map("notification_preferences")
}

// =============================================================================
// PART 2 - ALGORITHMIC TRADING DOMAIN
// =============================================================================
// Everything below models the trading *control plane*: configuration, audit and
// the durable record of what was decided and what happened. It deliberately
// does NOT model the hot path. Order books, live quotes and in-flight risk
// counters live in process memory and Redis; putting them here would force a
// PostgreSQL round trip into the market-data loop, which is exactly what the
// architecture forbids.
//
// What is persisted, and why:
//  * Orders, fills, positions and risk events - the financial record. Must
//    survive a crash and be auditable years later.
//  * Strategies, symbols, accounts, risk configuration - operator intent.
//  * MarketDataRecord - OHLCV candles ONLY. Individual ticks are not stored:
//    they arrive thousands per second per symbol, are worthless individually,
//    and would destroy write throughput for no analytical gain.
//
// Naming follows the Part 1 convention: camelCase in the Prisma client,
// snake_case in PostgreSQL via @map/@@map.
// =============================================================================

// -----------------------------------------------------------------------------
// Trading enums
// -----------------------------------------------------------------------------

enum TradingVenue {
  BINANCE
  BYBIT
  OKX
  KRAKEN
  /// Simulated venue. Fills produced against it are always flagged simulated.
  PAPER
}

enum TradingMarketType {
  SPOT
  MARGIN
  FUTURES_USDT
  FUTURES_COIN
}

enum TradingAccountStatus {
  PENDING_VALIDATION
  ACTIVE
  DISABLED
  CREDENTIALS_INVALID
  /// The stored key has withdrawal permission; refused on principle.
  WITHDRAWAL_ENABLED_REJECTED
}

enum TradingModeSetting {
  DISABLED
  PAPER
  LIVE
}

enum StrategyStatus {
  DRAFT
  ENABLED
  DISABLED
  ERROR
}

enum OrderSideEnum {
  BUY
  SELL
}

enum OrderTypeEnum {
  MARKET
  LIMIT
  STOP
  STOP_LIMIT
}

enum TimeInForceEnum {
  GTC
  IOC
  FOK
  DAY
}

enum OrderStatusEnum {
  PENDING
  SUBMITTED
  ACKNOWLEDGED
  PARTIALLY_FILLED
  FILLED
  CANCEL_REQUESTED
  CANCELLED
  REJECTED
  EXPIRED
  FAILED
}

enum PositionSideEnum {
  LONG
  SHORT
  FLAT
}

enum RiskEventType {
  LIMIT_BREACHED
  ORDER_REJECTED
  KILL_SWITCH_ENGAGED
  KILL_SWITCH_RELEASED
  STALE_MARKET_DATA
  RISK_STATE_UNAVAILABLE
  DUPLICATE_ORDER_BLOCKED
  ORDER_BOOK_RESYNC
}

enum RiskEventSeverity {
  INFO
  WARNING
  CRITICAL
}

enum KillSwitchScopeEnum {
  GLOBAL
  EXCHANGE
  STRATEGY
  SYMBOL
}

enum TradingSessionStatus {
  STARTING
  RUNNING
  DEGRADED
  STOPPING
  STOPPED
  FAILED
}

// -----------------------------------------------------------------------------
// Exchange - platform-level venue registry
// -----------------------------------------------------------------------------
// Not tenant-scoped: "Binance supports SPOT and has a 6000/min weight limit" is
// a fact about the world, identical for every tenant. Tenants opt in to a venue
// through TradingAccount, not by redefining the venue.
// -----------------------------------------------------------------------------

model Exchange {
  id        String       @id @default(uuid()) @db.Uuid
  venue     TradingVenue @unique
  name      String       @db.VarChar(64)
  isEnabled Boolean      @default(false) @map("is_enabled")

  /// Whether this deployment may route live orders here. Independent of
  /// isEnabled so market data can be consumed from a venue we do not trade.
  tradingEnabled Boolean @default(false) @map("trading_enabled")

  supportedMarketTypes TradingMarketType[] @map("supported_market_types")

  restBaseUrl    String  @map("rest_base_url") @db.VarChar(255)
  wsBaseUrl      String  @map("ws_base_url") @db.VarChar(255)
  sandboxRestUrl String? @map("sandbox_rest_url") @db.VarChar(255)
  sandboxWsUrl   String? @map("sandbox_ws_url") @db.VarChar(255)

  requiresPassphrase Boolean @default(false) @map("requires_passphrase")
  supportsSandbox    Boolean @default(false) @map("supports_sandbox")

  weightLimitPerMinute Int @default(1200) @map("weight_limit_per_minute")
  maxOrdersPerSecond   Int @default(5) @map("max_orders_per_second")
  maxLeverage          Int @default(1) @map("max_leverage")

  /// Default depth requested when initialising an order book.
  defaultBookDepth Int @default(50) @map("default_book_depth")

  metadata Json @default("{}")

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  accounts TradingAccount[]
  symbols  TradingSymbol[]

  @@index([isEnabled])
  @@map("exchanges")
}

// -----------------------------------------------------------------------------
// TradingSymbol - instruments the platform may trade
// -----------------------------------------------------------------------------
// Tenant-scoped because whether a tenant is allowed to trade a given instrument
// is a commercial decision, and the per-symbol risk caps below differ per brand.
// -----------------------------------------------------------------------------

model TradingSymbol {
  id         String @id @default(uuid()) @db.Uuid
  tenantId   String @map("tenant_id") @db.Uuid
  exchangeId String @map("exchange_id") @db.Uuid

  /// Canonical platform form, e.g. "BTC-USDT".
  symbol      String @db.VarChar(32)
  /// Whatever the venue calls it, e.g. "BTCUSDT".
  venueSymbol String @map("venue_symbol") @db.VarChar(32)

  baseAsset  String            @map("base_asset") @db.VarChar(16)
  quoteAsset String            @map("quote_asset") @db.VarChar(16)
  marketType TradingMarketType @default(SPOT) @map("market_type")

  isTradeable  Boolean @default(false) @map("is_tradeable")
  isSubscribed Boolean @default(false) @map("is_subscribed")

  // Venue trading rules. Validated locally before submission so an order that
  // would certainly be rejected never consumes a rate-limit slot.
  priceTick    Decimal  @map("price_tick") @db.Decimal(28, 12)
  quantityStep Decimal  @map("quantity_step") @db.Decimal(28, 12)
  minQuantity  Decimal  @map("min_quantity") @db.Decimal(28, 12)
  maxQuantity  Decimal? @map("max_quantity") @db.Decimal(28, 12)
  minNotional  Decimal  @map("min_notional") @db.Decimal(18, 6)

  pricePrecision    Int @default(8) @map("price_precision")
  quantityPrecision Int @default(8) @map("quantity_precision")

  /// Per-symbol ceiling, layered under the account and strategy limits.
  maxOrderNotional Decimal? @map("max_order_notional") @db.Decimal(18, 6)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant   Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  exchange Exchange @relation(fields: [exchangeId], references: [id], onDelete: Restrict)

  orders            Order[]
  positions         Position[]
  marketDataRecords MarketDataRecord[]

  @@unique([tenantId, exchangeId, symbol, marketType])
  @@index([tenantId, isTradeable])
  @@index([tenantId, isSubscribed])
  @@index([exchangeId, symbol])
  @@map("trading_symbols")
}

// -----------------------------------------------------------------------------
// TradingAccount - a tenant's connection to a venue
// -----------------------------------------------------------------------------
// SECURITY: the API secret is never stored in plaintext and never leaves the
// server. It is sealed with the Part 1 envelope-encryption helper
// (packages/utils/src/crypto.ts): a per-record 256-bit DEK encrypted under the
// master KEK, with the AAD bound to "trading_account:{tenantId}:{accountId}" so
// a ciphertext lifted into another tenant's row fails to decrypt.
//
// apiKeyBlindIndex is an HMAC of the public key portion, letting us detect the
// same key registered twice without ever storing or comparing the secret.
//
// No column here is ever serialised into an API response, a log line or a
// mobile payload. The API exposes only apiKeyLastFour and status.
// -----------------------------------------------------------------------------

model TradingAccount {
  id         String  @id @default(uuid()) @db.Uuid
  tenantId   String  @map("tenant_id") @db.Uuid
  exchangeId String  @map("exchange_id") @db.Uuid
  /// Owning user. Null for a tenant-level house account.
  userId     String? @map("user_id") @db.Uuid

  label String @db.VarChar(80)

  status     TradingAccountStatus @default(PENDING_VALIDATION)
  marketType TradingMarketType    @default(SPOT) @map("market_type")

  /// Paper by default. Reaching LIVE additionally requires the deployment-level
  /// env safeguards to agree; this column alone is never sufficient.
  tradingMode TradingModeSetting @default(PAPER) @map("trading_mode")

  isSandbox Boolean @default(true) @map("is_sandbox")

  // --- encrypted credential material -------------------------------------
  /// Envelope-encrypted API key. Ciphertext only.
  /// Null when `credentialSource` is not ENVELOPE_DB - a secret-manager-backed
  /// account keeps no key material here at all.
  apiKeyCiphertext     String? @map("api_key_ciphertext") @db.Text
  /// Envelope-encrypted API secret. Ciphertext only. Null under SECRET_MANAGER.
  apiSecretCiphertext  String? @map("api_secret_ciphertext") @db.Text
  /// Envelope-encrypted passphrase, for venues that require one (OKX).
  passphraseCiphertext String? @map("passphrase_ciphertext") @db.Text
  /// Wrapped data encryption key for this row.
  encryptedDataKey     String? @map("encrypted_data_key") @db.Text
  /// Which KEK generation sealed the DEK, so keys can be rotated.
  encryptionKeyId      String? @map("encryption_key_id") @db.VarChar(64)
  /// HMAC of the public key portion for duplicate detection.
  apiKeyBlindIndex     String  @map("api_key_blind_index") @db.VarChar(64)
  /// Last four characters of the public key, safe to display.
  apiKeyLastFour       String  @map("api_key_last_four") @db.VarChar(4)

  // --- verified venue permissions ----------------------------------------
  canTrade     Boolean @default(false) @map("can_trade")
  canReadData  Boolean @default(false) @map("can_read_data")
  /// Must remain false. A withdrawal-capable key is rejected outright.
  canWithdraw  Boolean @default(false) @map("can_withdraw")
  ipRestricted Boolean @default(false) @map("ip_restricted")

  lastVerifiedAt      DateTime? @map("last_verified_at") @db.Timestamptz(6)
  lastFailureAt       DateTime? @map("last_failure_at") @db.Timestamptz(6)
  /// Venue error class only - never the venue's raw response.
  lastFailureCode     String?   @map("last_failure_code") @db.VarChar(64)
  consecutiveFailures Int       @default(0) @map("consecutive_failures")

  // --- Part 5: where the credential actually lives -----------------------
  // Part 1 stored every credential as envelope-encrypted ciphertext in the
  // columns above. That is correct for a self-hosted single-tenant install and
  // wrong for a managed multi-tenant one, where the secret should never enter
  // the application database at all. Rather than a second credential table -
  // which would mean two places to look and two ways to get it wrong - the
  // source is recorded here and the ciphertext columns become optional.
  credentialSource CredentialSource @default(ENVELOPE_DB) @map("credential_source")

  /// Pointer into the external secret store: a Vault path, an AWS Secrets
  /// Manager ARN, a GCP resource name. NOT a secret, and safe to display to an
  /// operator - it names a location, it does not unlock it.
  credentialRef String? @map("credential_ref") @db.VarChar(512)

  /// Permissions the venue itself reported at last verification, normalised.
  /// Recorded so an operator can see what a key can do without re-querying,
  /// and so a key that silently gains WITHDRAW is detected on the next check.
  verifiedPermissions String[] @default([]) @map("verified_permissions")

  credentialRotatedAt DateTime? @map("credential_rotated_at") @db.Timestamptz(6)
  /// Set when the venue key has a known expiry. Signing is refused past it.
  credentialExpiresAt DateTime? @map("credential_expires_at") @db.Timestamptz(6)

  /// Whether this account's private user-data stream should be maintained.
  privateStreamEnabled Boolean @default(false) @map("private_stream_enabled")

  /// Admin control. Independent of `status`: an account can be healthy and
  /// verified and still be barred from live trading by an operator.
  liveTradingEnabled Boolean @default(false) @map("live_trading_enabled")

  createdAt DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime  @updatedAt @map("updated_at") @db.Timestamptz(6)
  deletedAt DateTime? @map("deleted_at") @db.Timestamptz(6)

  tenant   Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  exchange Exchange @relation(fields: [exchangeId], references: [id], onDelete: Restrict)
  user     User?    @relation(fields: [userId], references: [id], onDelete: SetNull)

  orders            Order[]
  positions         Position[]
  riskConfiguration RiskConfiguration?
  strategies        Strategy[]
  sessions          TradingSession[]

  balances           AccountBalanceSnapshot[]
  streamSessions     ExchangeStreamSession[]
  reconciliationRuns ReconciliationRun[]
  executionIncidents ExecutionIncident[]

  @@unique([tenantId, apiKeyBlindIndex])
  @@index([tenantId, status])
  @@index([tenantId, userId])
  @@index([exchangeId])
  @@index([deletedAt])
  @@map("trading_accounts")
}

// -----------------------------------------------------------------------------
// Strategy + StrategyConfiguration
// -----------------------------------------------------------------------------
// Split into two tables on purpose: Strategy is identity and lifecycle, which
// changes rarely; StrategyConfiguration is versioned parameters, which change
// often. Keeping them apart means a parameter tweak produces a new config row
// and an audit trail rather than overwriting history.
// -----------------------------------------------------------------------------

model Strategy {
  id        String  @id @default(uuid()) @db.Uuid
  tenantId  String  @map("tenant_id") @db.Uuid
  /// Account this strategy trades through. Null while still a draft.
  accountId String? @map("account_id") @db.Uuid

  name    String @db.VarChar(80)
  /// Registry key of the implementing class, e.g. "spread_capture".
  kind    String @db.VarChar(64)
  version String @db.VarChar(20)

  status  StrategyStatus @default(DRAFT)
  /// Runtime toggle, independent of status. An operator flips this to pause a
  /// strategy without discarding its configuration.
  enabled Boolean        @default(false)

  venue      TradingVenue
  /// Canonical symbols this strategy subscribes to.
  symbols    String[]
  marketType TradingMarketType @default(SPOT) @map("market_type")

  description String? @db.VarChar(500)

  // --- per-strategy risk profile ------------------------------------------
  // Layered UNDER the account and platform limits; the tightest always wins.
  maxOrderQuantity    Decimal @map("max_order_quantity") @db.Decimal(28, 12)
  maxPositionQuantity Decimal @map("max_position_quantity") @db.Decimal(28, 12)
  maxOrderNotional    Decimal @map("max_order_notional") @db.Decimal(18, 6)
  maxDailyLoss        Decimal @map("max_daily_loss") @db.Decimal(18, 6)
  maxOpenOrders       Int     @default(5) @map("max_open_orders")
  maxOrdersPerMinute  Int     @default(30) @map("max_orders_per_minute")

  lastStartedAt DateTime? @map("last_started_at") @db.Timestamptz(6)
  lastStoppedAt DateTime? @map("last_stopped_at") @db.Timestamptz(6)
  /// Exception class name only - never a message that might carry data.
  lastErrorCode String?   @map("last_error_code") @db.VarChar(64)

  // --- Part 6: this row IS the strategy instance ---------------------------
  // A separate `StrategyInstance` model was considered and rejected. This
  // table already carries the tenant, the account, the venue, the symbols and
  // the per-strategy risk profile - everything an instance is. Adding a second
  // table with the same meaning would create two answers to "is this strategy
  // running", which is the kind of ambiguity that ends with an operator
  // disabling the wrong row. The Part 6 columns below extend it instead.

  /// Catalogue entry this instance runs. Null for a Part 2 strategy created
  /// before the catalogue existed.
  definitionId String? @map("definition_id") @db.Uuid
  /// The exact published version. Behaviour cannot change under a fixed
  /// version: a change means a new version row.
  versionId    String? @map("version_id") @db.Uuid

  /// Deterministic 32-hex instance fingerprint computed by the engine from
  /// tenant + strategy key + version + exchange + market type + symbol +
  /// configuration version. It is what namespaces per-instance state, so it is
  /// stored rather than recomputed: if it ever disagrees with the engine's
  /// value, the state namespace has moved and that must be visible.
  instanceKey String? @map("instance_key") @db.VarChar(32)

  /// Active configuration version, denormalised from StrategyConfiguration so
  /// the instance fingerprint can be verified without a join.
  configVersion Int @default(1) @map("config_version")

  /// What the engine does when this instance raises. There is deliberately no
  /// "continue anyway" option: a strategy that threw has unknown state.
  failurePolicy StrategyFailurePolicy @default(STOP_INSTANCE) @map("failure_policy")

  /// Operational health, distinct from `status` and `enabled`. An instance can
  /// be ENABLED and UNHEALTHY at the same time, and hiding that behind a
  /// single flag is how a dead strategy looks fine on a dashboard.
  health StrategyHealth @default(UNKNOWN)

  /// Last time the engine reported this instance alive. Null means the engine
  /// has never reported, which is not the same as unhealthy.
  lastHeartbeatAt   DateTime? @map("last_heartbeat_at") @db.Timestamptz(6)
  consecutiveErrors Int       @default(0) @map("consecutive_errors")

  /// Set when the failure policy has taken the instance out of service. Only
  /// an explicit operator action clears it.
  quarantinedAt    DateTime? @map("quarantined_at") @db.Timestamptz(6)
  quarantineReason String?   @map("quarantine_reason") @db.VarChar(500)

  createdAt DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime  @updatedAt @map("updated_at") @db.Timestamptz(6)
  deletedAt DateTime? @map("deleted_at") @db.Timestamptz(6)

  tenant  Tenant          @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  account TradingAccount? @relation(fields: [accountId], references: [id], onDelete: SetNull)

  definition    StrategyDefinition? @relation(fields: [definitionId], references: [id], onDelete: SetNull)
  /// Named `versionRecord` rather than `version` because `version` is already
  /// the semantic version string on this model. Two different meanings under
  /// one name is how someone ends up comparing a string to a row.
  versionRecord StrategyVersion?    @relation(fields: [versionId], references: [id], onDelete: SetNull)

  configurations StrategyConfiguration[]
  orders         Order[]
  riskEvents     RiskEvent[]
  sessions       TradingSession[]

  runs          StrategyRun[]
  checkpoints   StrategyCheckpoint[]
  incidents     StrategyIncident[]
  backtestRuns  BacktestRun[]
  paperSessions PaperTradingSession[]

  @@unique([tenantId, name])
  /// The engine's per-instance state namespace must be unique inside a tenant.
  @@unique([tenantId, instanceKey])
  @@index([tenantId, enabled])
  @@index([tenantId, status])
  @@index([tenantId, accountId])
  @@index([tenantId, health])
  @@index([tenantId, definitionId])
  @@index([versionId])
  @@index([deletedAt])
  @@map("strategies")
}

model StrategyConfiguration {
  id         String @id @default(uuid()) @db.Uuid
  strategyId String @map("strategy_id") @db.Uuid

  /// Monotonically increasing per strategy.
  version Int

  /// Strategy-specific parameters. Schema-validated in the API layer against
  /// the strategy kind's declared parameter schema before it is written.
  parameters Json @default("{}")

  // --- Part 6 --------------------------------------------------------------

  /// The published version whose parameter schema these values were validated
  /// against. Without it, a parameter set is uninterpretable after the schema
  /// changes.
  strategyVersionId String? @map("strategy_version_id") @db.Uuid

  /// sha256 over the canonical parameter encoding. Two configurations with the
  /// same hash are the same configuration, which is what lets a backtest result
  /// be tied to the exact parameters that produced it. Parameters never contain
  /// a credential - the parameter schema refuses credential-shaped names - so
  /// this hash covers no secret.
  configurationHash String? @map("configuration_hash") @db.VarChar(64)

  /// Exactly one configuration per strategy may be active at a time; enforced
  /// by the partial unique index in the migration.
  isActive Boolean @default(false) @map("is_active")

  activatedAt   DateTime? @map("activated_at") @db.Timestamptz(6)
  deactivatedAt DateTime? @map("deactivated_at") @db.Timestamptz(6)

  createdByUserId String? @map("created_by_user_id") @db.Uuid
  changeNote      String? @map("change_note") @db.VarChar(500)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  strategy        Strategy         @relation(fields: [strategyId], references: [id], onDelete: Cascade)
  strategyVersion StrategyVersion? @relation(fields: [strategyVersionId], references: [id], onDelete: SetNull)

  @@unique([strategyId, version])
  @@index([strategyId, isActive])
  @@index([strategyVersionId])
  @@map("strategy_configurations")
}

// -----------------------------------------------------------------------------
// Order + OrderEvent + Fill
// -----------------------------------------------------------------------------

model Order {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  accountId  String  @map("account_id") @db.Uuid
  strategyId String? @map("strategy_id") @db.Uuid
  symbolId   String  @map("symbol_id") @db.Uuid

  /// Deterministic idempotency key sent to the venue. The unique constraint
  /// below is the authoritative cross-worker duplicate guard.
  clientOrderId   String  @map("client_order_id") @db.VarChar(36)
  /// Venue-assigned id. Null until the venue acknowledges.
  exchangeOrderId String? @map("exchange_order_id") @db.VarChar(64)
  /// Signal that produced this order, for attribution.
  signalId        String? @map("signal_id") @db.Uuid

  venue  TradingVenue
  symbol String       @db.VarChar(32)

  side        OrderSideEnum
  orderType   OrderTypeEnum   @map("order_type")
  timeInForce TimeInForceEnum @default(GTC) @map("time_in_force")
  status      OrderStatusEnum @default(PENDING)

  quantity  Decimal  @db.Decimal(28, 12)
  price     Decimal? @db.Decimal(28, 12)
  stopPrice Decimal? @map("stop_price") @db.Decimal(28, 12)

  reduceOnly Boolean @default(false) @map("reduce_only")

  // --- execution state, derived from fills only --------------------------
  filledQuantity   Decimal  @default(0) @map("filled_quantity") @db.Decimal(28, 12)
  averageFillPrice Decimal? @map("average_fill_price") @db.Decimal(28, 12)
  cumulativeFee    Decimal  @default(0) @map("cumulative_fee") @db.Decimal(28, 12)
  feeCurrency      String?  @map("fee_currency") @db.VarChar(16)

  /// True when produced by the paper venue. Carried into every report so a
  /// simulated result can never be presented as a real one.
  isSimulated Boolean @default(false) @map("is_simulated")

  rejectionCode   String? @map("rejection_code") @db.VarChar(64)
  rejectionReason String? @map("rejection_reason") @db.VarChar(500)

  /// Risk decision that authorised this order. Every order has one.
  riskDecisionId String? @map("risk_decision_id") @db.Uuid

  /// Measured, not promised. Null until the venue acknowledges.
  submitLatencyMicros Int? @map("submit_latency_micros")

  // --- Part 5: how much the local record can be trusted ------------------
  // Deliberately NOT folded into `status`. `status` is what the venue believes
  // and has a strict legal-transition table; this is what we believe about our
  // own knowledge. An order whose submission response was lost stays SUBMITTED
  // - which is true, we did submit it - and is marked UNKNOWN here.
  reconciliationState  OrderReconciliationState @default(IN_SYNC) @map("reconciliation_state")
  /// Why the state is not IN_SYNC. Operator-facing, never a raw venue body.
  reconciliationDetail String?                  @map("reconciliation_detail") @db.VarChar(500)
  lastReconciledAt     DateTime?                @map("last_reconciled_at") @db.Timestamptz(6)

  /// Free-form annotation from the originating intent: the copy-trade leader
  /// this mirrors, a correlation id, a rebalance run. Excluded from the
  /// idempotency fingerprint on purpose - two orders differing only in metadata
  /// are the same trade, and hashing it would defeat duplicate detection.
  metadata Json @default("{}")

  /// Set to true only for an order that was fully built, validated and
  /// risk-checked under DRY_RUN and then deliberately not transmitted. Kept so
  /// a dry-run order is never mistaken for a real one in any report.
  wasDryRun Boolean @default(false) @map("was_dry_run")

  createdAt   DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt   DateTime  @updatedAt @map("updated_at") @db.Timestamptz(6)
  submittedAt DateTime? @map("submitted_at") @db.Timestamptz(6)
  terminalAt  DateTime? @map("terminal_at") @db.Timestamptz(6)

  tenant    Tenant         @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  account   TradingAccount @relation(fields: [accountId], references: [id], onDelete: Restrict)
  strategy  Strategy?      @relation(fields: [strategyId], references: [id], onDelete: SetNull)
  symbolRef TradingSymbol  @relation(fields: [symbolId], references: [id], onDelete: Restrict)

  events OrderEvent[]
  fills  Fill[]

  reconciliationDiscrepancies ReconciliationDiscrepancy[]
  executionIncidents          ExecutionIncident[]

  @@unique([tenantId, clientOrderId])
  @@index([tenantId, status, createdAt])
  @@index([tenantId, accountId, createdAt])
  @@index([tenantId, strategyId, createdAt])
  @@index([tenantId, symbol, createdAt])
  @@index([exchangeOrderId])
  @@index([createdAt])
  /// Drives the reconciliation sweep: find every order whose state is not
  /// trusted, oldest first. Without this the sweep is a full table scan on a
  /// table that only ever grows.
  @@index([reconciliationState, lastReconciledAt])
  @@index([tenantId, accountId, reconciliationState])
  @@map("orders")
}

model OrderEvent {
  id      String @id @default(uuid()) @db.Uuid
  orderId String @map("order_id") @db.Uuid

  previousStatus OrderStatusEnum? @map("previous_status")
  status         OrderStatusEnum

  reason String? @db.VarChar(500)

  /// Structured context. Never contains credentials or venue signatures.
  payload Json @default("{}")

  /// Microsecond wall-clock time the event occurred, preserving sub-millisecond
  /// ordering that a Timestamptz(6) round trip would blur.
  occurredAtMicros BigInt @map("occurred_at_micros")

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  order Order @relation(fields: [orderId], references: [id], onDelete: Cascade)

  @@index([orderId, occurredAtMicros])
  @@index([createdAt])
  @@map("order_events")
}

model Fill {
  id      String @id @default(uuid()) @db.Uuid
  orderId String @map("order_id") @db.Uuid

  /// Venue's execution id. Unique per order; the guard against double-counting
  /// a replayed user-data message.
  venueTradeId String @map("venue_trade_id") @db.VarChar(64)

  price       Decimal @db.Decimal(28, 12)
  quantity    Decimal @db.Decimal(28, 12)
  fee         Decimal @default(0) @db.Decimal(28, 12)
  feeCurrency String  @default("USDT") @map("fee_currency") @db.VarChar(16)

  isMaker     Boolean @default(false) @map("is_maker")
  /// Always true for paper fills. Never mutated after insert.
  isSimulated Boolean @default(false) @map("is_simulated")

  exchangeTimestampMicros BigInt @map("exchange_timestamp_micros")
  receivedTimestampMicros BigInt @map("received_timestamp_micros")

  // --- Part 5: venue attribution -----------------------------------------
  // Denormalised from the parent order on purpose. A fill arriving on the
  // private stream can be routed to the position manager without a join, and a
  // PnL query over millions of rows does not need one either.
  symbol String?        @db.VarChar(32)
  side   OrderSideEnum?
  venue  TradingVenue?

  /// Quote-asset amount as the venue computed it. Kept rather than recomputed:
  /// the venue's rounding is authoritative for settlement, and price * quantity
  /// can disagree in the last decimal place.
  quoteQuantity Decimal? @map("quote_quantity") @db.Decimal(28, 12)

  /// The venue's order id, when the execution report carries it. Lets a fill
  /// that arrives before the submit response is processed still be matched.
  exchangeOrderId String? @map("exchange_order_id") @db.VarChar(64)

  /// Which route delivered this fill. The same execution legitimately arrives
  /// twice - once on the stream, once from reconciliation - and the unique
  /// constraint above deduplicates it. Recording the source is what lets an
  /// operator tell "the stream is healthy" from "reconciliation is carrying us".
  source FillSource @default(PRIVATE_STREAM)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  order Order @relation(fields: [orderId], references: [id], onDelete: Cascade)

  @@unique([orderId, venueTradeId])
  @@index([orderId, receivedTimestampMicros])
  @@index([createdAt])
  @@index([exchangeOrderId])
  @@index([symbol, receivedTimestampMicros])
  @@map("fills")
}

// -----------------------------------------------------------------------------
// Position - derived from fills, never from a venue snapshot
// -----------------------------------------------------------------------------

model Position {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  accountId String @map("account_id") @db.Uuid
  symbolId  String @map("symbol_id") @db.Uuid

  venue  TradingVenue
  symbol String       @db.VarChar(32)

  /// Signed: positive long, negative short, zero flat.
  quantity Decimal          @default(0) @db.Decimal(28, 12)
  side     PositionSideEnum @default(FLAT)

  averageEntryPrice Decimal? @map("average_entry_price") @db.Decimal(28, 12)
  markPrice         Decimal? @map("mark_price") @db.Decimal(28, 12)

  realisedPnl   Decimal  @default(0) @map("realised_pnl") @db.Decimal(18, 6)
  /// Snapshot at last mark. Null when no mark price was available - never
  /// defaulted to zero, which would misreport a position as break-even.
  unrealisedPnl Decimal? @map("unrealised_pnl") @db.Decimal(18, 6)
  cumulativeFee Decimal  @default(0) @map("cumulative_fee") @db.Decimal(18, 6)
  feeCurrency   String?  @map("fee_currency") @db.VarChar(16)

  /// True if ANY contributing fill was simulated. Sticky once set.
  containsSimulatedFills Boolean @default(false) @map("contains_simulated_fills")

  fillCount Int @default(0) @map("fill_count")

  openedAt   DateTime? @map("opened_at") @db.Timestamptz(6)
  closedAt   DateTime? @map("closed_at") @db.Timestamptz(6)
  lastFillAt DateTime? @map("last_fill_at") @db.Timestamptz(6)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant    Tenant         @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  account   TradingAccount @relation(fields: [accountId], references: [id], onDelete: Cascade)
  symbolRef TradingSymbol  @relation(fields: [symbolId], references: [id], onDelete: Restrict)

  @@unique([accountId, symbolId])
  @@index([tenantId, accountId])
  @@index([tenantId, symbol])
  @@index([tenantId, side])
  @@map("positions")
}

// -----------------------------------------------------------------------------
// RiskConfiguration - per-account limits
// -----------------------------------------------------------------------------
// One row per trading account. Platform limits come from environment
// configuration and strategy limits from the Strategy row; this is the middle
// layer. The effective limit is the tightest of the three.
// -----------------------------------------------------------------------------

model RiskConfiguration {
  id        String @id @default(uuid()) @db.Uuid
  tenantId  String @map("tenant_id") @db.Uuid
  accountId String @unique @map("account_id") @db.Uuid

  maxOrderQuantity    Decimal @map("max_order_quantity") @db.Decimal(28, 12)
  maxOrderNotional    Decimal @map("max_order_notional") @db.Decimal(18, 6)
  maxPositionQuantity Decimal @map("max_position_quantity") @db.Decimal(28, 12)

  maxSymbolExposureNotional  Decimal @map("max_symbol_exposure_notional") @db.Decimal(18, 6)
  maxAccountExposureNotional Decimal @map("max_account_exposure_notional") @db.Decimal(18, 6)

  maxOpenOrders      Int @default(10) @map("max_open_orders")
  maxOrdersPerMinute Int @default(60) @map("max_orders_per_minute")

  maxDailyLoss    Decimal @map("max_daily_loss") @db.Decimal(18, 6)
  maxStrategyLoss Decimal @map("max_strategy_loss") @db.Decimal(18, 6)

  maxPriceDeviationPercent Decimal @default(2) @map("max_price_deviation_percent") @db.Decimal(8, 4)
  /// Market data older than this may not be used to price an order.
  maxMarketDataAgeMicros   Int     @default(5000000) @map("max_market_data_age_micros")

  /// Account-level halt. Independent of the four kill-switch scopes.
  tradingHalted Boolean   @default(true) @map("trading_halted")
  haltedReason  String?   @map("halted_reason") @db.VarChar(500)
  haltedAt      DateTime? @map("halted_at") @db.Timestamptz(6)

  updatedByUserId String? @map("updated_by_user_id") @db.Uuid

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant  Tenant         @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  account TradingAccount @relation(fields: [accountId], references: [id], onDelete: Cascade)

  @@index([tenantId])
  @@map("risk_configurations")
}

// -----------------------------------------------------------------------------
// RiskEvent - the audit trail of every refusal
// -----------------------------------------------------------------------------
// Written for every rejection, breach and kill-switch action. This is the table
// an operator reads after an incident, so it records the limit, the observed
// value and the decision id that links back to the order.
// -----------------------------------------------------------------------------

model RiskEvent {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  accountId  String? @map("account_id") @db.Uuid
  strategyId String? @map("strategy_id") @db.Uuid
  orderId    String? @map("order_id") @db.Uuid

  eventType RiskEventType     @map("event_type")
  severity  RiskEventSeverity @default(WARNING)

  /// RiskDecisionCode from the engine, e.g. MAX_ORDER_SIZE_EXCEEDED.
  code    String @db.VarChar(64)
  message String @db.VarChar(1000)

  /// Stringified so the exact decimal is preserved for the audit record.
  limitValue    String? @map("limit_value") @db.VarChar(64)
  observedValue String? @map("observed_value") @db.VarChar(64)

  venue  TradingVenue?
  symbol String?       @db.VarChar(32)

  riskDecisionId String? @map("risk_decision_id") @db.Uuid
  correlationId  String? @map("correlation_id") @db.Uuid

  metadata Json @default("{}")

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  tenant   Tenant    @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  strategy Strategy? @relation(fields: [strategyId], references: [id], onDelete: SetNull)

  @@index([tenantId, createdAt])
  @@index([tenantId, eventType, createdAt])
  @@index([tenantId, severity, createdAt])
  @@index([tenantId, accountId, createdAt])
  @@index([orderId])
  @@map("risk_events")
}

// -----------------------------------------------------------------------------
// KillSwitch - durable record of the four halt scopes
// -----------------------------------------------------------------------------
// The live switch is read from Redis on the hot path; this table is the durable
// mirror so a Redis flush cannot silently re-enable trading, and so every
// engage/release is attributable to a person.
// -----------------------------------------------------------------------------

model KillSwitch {
  id       String  @id @default(uuid()) @db.Uuid
  /// Null for the platform-wide GLOBAL switch.
  tenantId String? @map("tenant_id") @db.Uuid

  scope  KillSwitchScopeEnum
  /// Venue, strategy id or symbol. Null only for GLOBAL.
  target String?             @db.VarChar(64)

  isEngaged Boolean @default(false) @map("is_engaged")
  reason    String? @db.VarChar(500)

  engagedByUserId  String?   @map("engaged_by_user_id") @db.Uuid
  engagedAt        DateTime? @map("engaged_at") @db.Timestamptz(6)
  releasedByUserId String?   @map("released_by_user_id") @db.Uuid
  releasedAt       DateTime? @map("released_at") @db.Timestamptz(6)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant Tenant? @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@index([tenantId, scope, isEngaged])
  @@index([scope, isEngaged])
  @@map("kill_switches")
}

// -----------------------------------------------------------------------------
// TradingSession - one run of the engine
// -----------------------------------------------------------------------------

model TradingSession {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  accountId  String? @map("account_id") @db.Uuid
  strategyId String? @map("strategy_id") @db.Uuid

  status      TradingSessionStatus @default(STARTING)
  /// Resolved mode for this run, recorded so a historical session can be read
  /// back with certainty about whether its fills were real.
  tradingMode TradingModeSetting   @map("trading_mode")

  /// Hostname or pod name of the worker that owns the session.
  workerId String @map("worker_id") @db.VarChar(128)

  startedAt   DateTime  @default(now()) @map("started_at") @db.Timestamptz(6)
  endedAt     DateTime? @map("ended_at") @db.Timestamptz(6)
  heartbeatAt DateTime  @default(now()) @map("heartbeat_at") @db.Timestamptz(6)

  // --- observability counters -------------------------------------------
  signalsGenerated Int @default(0) @map("signals_generated")
  ordersRequested  Int @default(0) @map("orders_requested")
  ordersSubmitted  Int @default(0) @map("orders_submitted")
  ordersFilled     Int @default(0) @map("orders_filled")
  ordersRejected   Int @default(0) @map("orders_rejected")
  riskRejections   Int @default(0) @map("risk_rejections")
  bookResyncs      Int @default(0) @map("book_resyncs")

  /// Measured percentiles over the session, in microseconds. Observed values
  /// only; the platform makes no latency guarantee.
  medianDecisionLatencyMicros Int? @map("median_decision_latency_micros")
  p99DecisionLatencyMicros    Int? @map("p99_decision_latency_micros")

  stopReason String? @map("stop_reason") @db.VarChar(500)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant   Tenant          @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  account  TradingAccount? @relation(fields: [accountId], references: [id], onDelete: SetNull)
  strategy Strategy?       @relation(fields: [strategyId], references: [id], onDelete: SetNull)

  @@index([tenantId, status, startedAt])
  @@index([tenantId, strategyId, startedAt])
  @@index([heartbeatAt])
  @@map("trading_sessions")
}

// -----------------------------------------------------------------------------
// MarketDataRecord - OHLCV candles only
// -----------------------------------------------------------------------------
// Deliberately NOT a tick store. Individual quotes and trades arrive at
// thousands per second per symbol; persisting them would saturate write
// throughput and produce a table nobody can query usefully. Candles are the
// aggregation that is actually used for charting and post-trade analysis.
//
// Not tenant-scoped: a BTC-USDT candle is the same fact for every tenant, and
// duplicating it per tenant would multiply storage for no isolation benefit.
// Access is mediated by the API, which checks the caller's tenant is
// subscribed to the symbol.
// -----------------------------------------------------------------------------

model MarketDataRecord {
  id       String @id @default(uuid()) @db.Uuid
  symbolId String @map("symbol_id") @db.Uuid

  venue    TradingVenue
  symbol   String       @db.VarChar(32)
  /// "1m", "5m", "1h", "1d".
  interval String       @db.VarChar(8)

  openTime  DateTime @map("open_time") @db.Timestamptz(6)
  closeTime DateTime @map("close_time") @db.Timestamptz(6)

  open   Decimal @db.Decimal(28, 12)
  high   Decimal @db.Decimal(28, 12)
  low    Decimal @db.Decimal(28, 12)
  close  Decimal @db.Decimal(28, 12)
  volume Decimal @db.Decimal(28, 12)

  quoteVolume Decimal? @map("quote_volume") @db.Decimal(28, 12)
  tradeCount  Int      @default(0) @map("trade_count")

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  symbolRef TradingSymbol @relation(fields: [symbolId], references: [id], onDelete: Cascade)

  @@unique([symbolId, interval, openTime])
  @@index([venue, symbol, interval, openTime])
  @@index([openTime])
  @@map("market_data_records")
}

// =============================================================================
// PART 5 - AUTHENTICATED EXECUTION
// =============================================================================
// Everything below records what happened on the money path: where a credential
// lives (never the credential itself), what the private stream did, what
// reconciliation found, and what an operator needs to look at.
//
// One rule governs the whole section: nothing here is ever updated to hide a
// disagreement. A reconciliation that finds a difference writes a discrepancy
// row; it does not quietly correct the order and move on. An audit that can be
// edited is not an audit.
// =============================================================================

/// Where an account's key material actually lives.
enum CredentialSource {
  /// Envelope-encrypted in `trading_accounts`. Correct for self-hosted and
  /// single-tenant installs; the Part 1 default.
  ENVELOPE_DB
  /// Held by Vault / AWS Secrets Manager / GCP Secret Manager / KMS. The
  /// database stores only a pointer. Correct for managed multi-tenant.
  SECRET_MANAGER
  /// Process environment. Development only - it does not scale past one tenant
  /// and cannot be rotated per customer.
  ENVIRONMENT
}

/// How much the local record of an order can be trusted.
enum OrderReconciliationState {
  IN_SYNC
  /// The submission outcome was never observed. The order may or may not exist
  /// at the venue. It must be queried by clientOrderId, never resubmitted.
  UNKNOWN
  PENDING_RECONCILIATION
  /// Reconciliation found a difference it could not repair automatically.
  DIVERGED
}

/// Which route delivered a fill.
enum FillSource {
  PRIVATE_STREAM
  /// Returned inline in the order-placement response (newOrderRespType=FULL).
  ORDER_RESPONSE
  RECONCILIATION
  /// Produced by the paper venue. Always paired with isSimulated = true.
  SIMULATOR
}

enum StreamSessionStatus {
  CONNECTING
  CONNECTED
  RECONNECTING
  DISCONNECTED
  /// The venue invalidated the listen key. A new key is required; reconnecting
  /// with the old one yields a socket that silently delivers nothing.
  KEY_EXPIRED
  FAILED
  STOPPED
}

enum ReconciliationRunStatus {
  RUNNING
  COMPLETED
  /// Another pass held the lock. Not an error.
  SKIPPED
  FAILED
}

enum ReconciliationDiscrepancyType {
  ORDER_STATUS_MISMATCH
  ORDER_MISSING_LOCALLY
  ORDER_MISSING_AT_VENUE
  MISSED_FILL
  QUANTITY_MISMATCH
  BALANCE_MISMATCH
  POSITION_MISMATCH
  UNKNOWN_ORDER_RESOLVED
  UNKNOWN_ORDER_NEVER_PLACED
}

enum ExecutionIncidentType {
  UNKNOWN_ORDER_RESULT
  ORDER_STATE_MISMATCH
  MISSING_FILL
  UNEXPECTED_ORDER
  BALANCE_MISMATCH
  POSITION_MISMATCH
  ILLEGAL_TRANSITION
  CREDENTIAL_FAILURE
  CLOCK_SKEW
  PRIVATE_STREAM_FAILURE
  RATE_LIMIT_BREACH
  RECONCILIATION_FAILURE
  SAFETY_GATE_BLOCK
}

enum ExecutionIncidentSeverity {
  INFO
  WARNING
  /// Money or position integrity is at stake. Page someone.
  CRITICAL
}

// -----------------------------------------------------------------------------
// AccountBalanceSnapshot - what the venue says the account holds
// -----------------------------------------------------------------------------
// A snapshot, not a ledger. The platform does not maintain its own running
// balance: it would inevitably drift from the venue's, and a drifting balance
// is worse than no balance because it looks authoritative.
//
// Latest-per-asset is an upsert on the unique key. History is kept in
// `AccountBalanceSnapshot` rows only for assets whose value changed, which is
// what makes the table bounded on an account holding hundreds of dust balances.
// -----------------------------------------------------------------------------

model AccountBalanceSnapshot {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  accountId String @map("account_id") @db.Uuid

  asset String @db.VarChar(24)

  /// Available to trade.
  free   Decimal @default(0) @db.Decimal(28, 12)
  /// Reserved against resting orders.
  locked Decimal @default(0) @db.Decimal(28, 12)
  /// Stored, not computed, so a historical row reads back exactly as the venue
  /// reported it even if the free/locked split is later revised.
  total  Decimal @default(0) @db.Decimal(28, 12)

  /// Venue's own update timestamp, when it supplies one.
  venueUpdatedAtMicros BigInt? @map("venue_updated_at_micros")
  observedAtMicros     BigInt  @map("observed_at_micros")

  /// True for a paper account. Carried so a simulated balance can never appear
  /// in a report alongside real ones without being marked.
  isSimulated Boolean @default(false) @map("is_simulated")

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant  Tenant         @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  account TradingAccount @relation(fields: [accountId], references: [id], onDelete: Cascade)

  @@unique([accountId, asset])
  @@index([tenantId, accountId])
  @@index([tenantId, asset])
  @@index([observedAtMicros])
  @@map("account_balance_snapshots")
}

// -----------------------------------------------------------------------------
// ExchangeStreamSession - one private user-data stream connection
// -----------------------------------------------------------------------------
// Distinct from TradingSession, which is a strategy run. This is the socket:
// when it connected, how many times it dropped, whether its listen key is still
// valid. Kept because "we have not received a fill in twenty minutes" is only
// actionable if you can tell a quiet market from a dead socket.
//
// The listen key is NEVER stored. It is a bearer credential: anyone holding it
// can read the account's entire order flow. Only the masked form is kept.
// -----------------------------------------------------------------------------

model ExchangeStreamSession {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  accountId String @map("account_id") @db.Uuid

  venue  TradingVenue
  status StreamSessionStatus @default(CONNECTING)

  /// Masked listen key, e.g. "pqia...65a1". Enough to correlate two log lines,
  /// useless to an attacker. The full key is never written anywhere.
  listenKeyMasked String? @map("listen_key_masked") @db.VarChar(32)

  listenKeyCreatedAt       DateTime? @map("listen_key_created_at") @db.Timestamptz(6)
  listenKeyRenewedAt       DateTime? @map("listen_key_renewed_at") @db.Timestamptz(6)
  listenKeyRenewals        Int       @default(0) @map("listen_key_renewals")
  listenKeyRenewalFailures Int       @default(0) @map("listen_key_renewal_failures")

  connectedAt    DateTime? @map("connected_at") @db.Timestamptz(6)
  disconnectedAt DateTime? @map("disconnected_at") @db.Timestamptz(6)
  lastEventAt    DateTime? @map("last_event_at") @db.Timestamptz(6)

  reconnectCount   Int @default(0) @map("reconnect_count")
  eventsReceived   Int @default(0) @map("events_received")
  executionReports Int @default(0) @map("execution_reports")
  parseErrors      Int @default(0) @map("parse_errors")

  /// Set after each reconnect, because Binance does not replay events missed
  /// while disconnected - so every reconnect is a correctness event.
  lastReconciledAt DateTime? @map("last_reconciled_at") @db.Timestamptz(6)

  /// Hostname or pod name of the worker holding the socket.
  workerId String @map("worker_id") @db.VarChar(128)

  /// Error class only. Never a venue response body, which could echo the URL
  /// and therefore the listen key.
  lastErrorCode String? @map("last_error_code") @db.VarChar(64)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant  Tenant         @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  account TradingAccount @relation(fields: [accountId], references: [id], onDelete: Cascade)

  @@index([tenantId, accountId, status])
  @@index([tenantId, status])
  @@index([lastEventAt])
  @@map("exchange_stream_sessions")
}

// -----------------------------------------------------------------------------
// ReconciliationRun + ReconciliationDiscrepancy
// -----------------------------------------------------------------------------
// Split into a run and its findings for the same reason Strategy and
// StrategyConfiguration are split: a run is a fact about an execution, a
// discrepancy is a fact about the world, and the second outlives the first.
//
// A run row is written even when it finds nothing, and even when it fails. "No
// reconciliation has completed for an hour" is itself an alertable condition
// and is invisible if only successful runs are recorded.
// -----------------------------------------------------------------------------

model ReconciliationRun {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  accountId String @map("account_id") @db.Uuid

  venue  TradingVenue
  status ReconciliationRunStatus @default(RUNNING)

  /// What prompted this pass: SCHEDULED, STREAM_RECONNECT, UNKNOWN_ORDER,
  /// MANUAL. A free-form column rather than an enum because the set of triggers
  /// grows with operational experience and a migration per trigger is friction
  /// for no safety gain.
  trigger String @default("SCHEDULED") @db.VarChar(32)

  startedAt      DateTime  @default(now()) @map("started_at") @db.Timestamptz(6)
  finishedAt     DateTime? @map("finished_at") @db.Timestamptz(6)
  durationMicros BigInt?   @map("duration_micros")

  ordersChecked         Int @default(0) @map("orders_checked")
  fillsRecovered        Int @default(0) @map("fills_recovered")
  discrepanciesFound    Int @default(0) @map("discrepancies_found")
  discrepanciesRepaired Int @default(0) @map("discrepancies_repaired")

  /// Error class and message. Never a credential, never a signature.
  error String? @db.VarChar(500)

  workerId String @map("worker_id") @db.VarChar(128)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  tenant  Tenant         @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  account TradingAccount @relation(fields: [accountId], references: [id], onDelete: Cascade)

  discrepancies ReconciliationDiscrepancy[]

  @@index([tenantId, accountId, startedAt])
  @@index([tenantId, status, startedAt])
  @@index([startedAt])
  @@map("reconciliation_runs")
}

model ReconciliationDiscrepancy {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  runId   String  @map("run_id") @db.Uuid
  /// Null for a discrepancy about an order this platform does not know - which
  /// is precisely the most serious kind.
  orderId String? @map("order_id") @db.Uuid

  discrepancyType ReconciliationDiscrepancyType @map("discrepancy_type")

  symbol        String? @db.VarChar(32)
  clientOrderId String? @map("client_order_id") @db.VarChar(36)

  /// What we believed and what the venue said. Strings rather than typed
  /// columns because the compared value is a status here and a quantity there,
  /// and a discrepancy record is read by a human, not summed by a query.
  localValue String? @map("local_value") @db.VarChar(120)
  venueValue String? @map("venue_value") @db.VarChar(120)

  summary String @db.VarChar(1000)

  /// Whether local state was changed to match. False for everything the
  /// service refuses to auto-correct: balances, positions, and any order the
  /// platform did not place.
  repaired Boolean @default(false)

  detectedAtMicros BigInt @map("detected_at_micros")

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  run   ReconciliationRun @relation(fields: [runId], references: [id], onDelete: Cascade)
  order Order?            @relation(fields: [orderId], references: [id], onDelete: SetNull)

  @@index([tenantId, discrepancyType, createdAt])
  @@index([runId])
  @@index([orderId])
  @@index([tenantId, repaired, createdAt])
  @@map("reconciliation_discrepancies")
}

// -----------------------------------------------------------------------------
// ExecutionIncident - the things a human needs to know about
// -----------------------------------------------------------------------------
// Deliberately rare. A risk engine declining an oversized order is the system
// working and produces nothing here. An order whose fate is unknown, a
// credential that stopped working, an order at the venue that this platform did
// not place - those produce a row.
//
// Immutable except for resolution. An incident is closed by setting
// `resolvedAt` and a note; its facts are never edited.
// -----------------------------------------------------------------------------

model ExecutionIncident {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  accountId String? @map("account_id") @db.Uuid
  orderId   String? @map("order_id") @db.Uuid

  incidentType ExecutionIncidentType     @map("incident_type")
  severity     ExecutionIncidentSeverity @default(WARNING)

  venue  TradingVenue?
  symbol String?       @db.VarChar(32)

  clientOrderId String? @map("client_order_id") @db.VarChar(36)

  /// Normalised execution error code from the platform taxonomy, e.g.
  /// RESULT_UNKNOWN, CREDENTIALS_INVALID, STATE_MISMATCH. A VarChar rather than
  /// an enum: the taxonomy is expected to grow, and a code the database has
  /// never seen must be recordable rather than rejected at insert time.
  errorCode String? @map("error_code") @db.VarChar(64)

  summary String @db.VarChar(1000)

  /// Structured context. Every value is passed through the secret scrubber
  /// before it gets here - incident payloads are the single most likely place
  /// for a credential to escape, because the instinct when writing one is to
  /// attach the whole failing request.
  details Json @default("{}")

  occurredAtMicros BigInt @map("occurred_at_micros")

  resolvedAt     DateTime? @map("resolved_at") @db.Timestamptz(6)
  resolvedBy     String?   @map("resolved_by") @db.Uuid
  resolutionNote String?   @map("resolution_note") @db.VarChar(1000)

  /// Set when an alert was actually delivered, so a repeated incident does not
  /// re-page and a missed page is visible.
  notifiedAt DateTime? @map("notified_at") @db.Timestamptz(6)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant  Tenant          @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  account TradingAccount? @relation(fields: [accountId], references: [id], onDelete: SetNull)
  order   Order?          @relation(fields: [orderId], references: [id], onDelete: SetNull)

  @@index([tenantId, severity, createdAt])
  @@index([tenantId, incidentType, createdAt])
  @@index([tenantId, accountId, createdAt])
  /// The dashboard's primary query: unresolved incidents, worst first.
  @@index([tenantId, resolvedAt, severity])
  @@index([orderId])
  @@index([createdAt])
  @@map("execution_incidents")
}

// =============================================================================
// PART 6 - STRATEGY LAYER: catalogue, runs, backtests, paper trading
// =============================================================================
// Three properties hold across everything below.
//
//   1. NOTHING HERE IS WRITTEN PER TICK. A strategy processes thousands of book
//      updates a minute; none of them reach PostgreSQL. What is stored is
//      configuration, lifecycle transitions, periodic checkpoints, completed
//      backtests, periodic paper snapshots and incidents. Hot state lives in
//      the engine's memory, and Redis is never the source of financial truth.
//
//   2. EVERY SIMULATED ROW SAYS SO. `BacktestRun`, `BacktestTrade`,
//      `PaperTradingSession` and `PaperPortfolioSnapshot` all describe results
//      that no real account achieved. Backtest performance is not indicative of
//      future performance; paper performance is not indicative of live
//      performance; simulation does not guarantee real execution quality.
//
//   3. NO ROW HERE CAN AUTHORISE AN ORDER. Enabling a strategy makes it emit
//      signals. Whether a signal becomes an order is decided by the risk engine
//      and the Part 5 execution gates, none of which read these tables.
// =============================================================================

enum StrategyVersionStatus {
  /// Registered but not runnable. An instance cannot bind to it.
  DRAFT
  /// Runnable. Behaviour is frozen: a change requires a new version.
  PUBLISHED
  /// Still runnable for existing instances, refused for new ones.
  DEPRECATED
  /// Refused everywhere, including for running instances at next start.
  DISABLED
}

enum StrategyFailurePolicy {
  /// Stop the instance that failed. Siblings keep running.
  STOP_INSTANCE
  /// Stop every instance in the engine. For a failure that suggests the
  /// problem is not confined to one strategy.
  HALT_ALL
}

enum StrategyHealth {
  /// The engine has not reported on this instance. Not the same as unhealthy.
  UNKNOWN
  HEALTHY
  /// Running, but something is wrong: errors, slow dispatches, stale data.
  DEGRADED
  /// Running is no longer trusted.
  UNHEALTHY
  /// Taken out of service by the failure policy. Only an operator clears it.
  QUARANTINED
}

enum StrategyRunStatus {
  STARTING
  RUNNING
  /// Ended cleanly, by operator action or shutdown.
  STOPPED
  /// Ended because the instance raised.
  FAILED
  /// Ended because HALT_ALL stopped the whole engine.
  HALTED
}

enum StrategyIncidentType {
  /// The strategy raised inside a handler or in evaluate().
  STRATEGY_ERROR
  /// Feature calculation raised. The features are discarded, not guessed.
  FEATURE_ERROR
  /// An unusual volume of rejected signals: the strategy is fighting the
  /// validator, which usually means a parameter is wrong.
  SIGNAL_REJECTED_BURST
  /// Risk state was unavailable, so signals were refused. Fail-closed working
  /// as designed, and still worth a human knowing about.
  RISK_STATE_UNAVAILABLE
  /// Dispatch exceeded the observation budget repeatedly.
  PROCESSING_LATENCY_BREACH
  /// The failure policy removed the instance from service.
  INSTANCE_QUARANTINED
  /// A configuration was refused by the parameter schema.
  CONFIGURATION_REJECTED
  /// A state checkpoint could not be written or could not be restored.
  CHECKPOINT_FAILURE
}

enum BacktestRunStatus {
  QUEUED
  RUNNING
  COMPLETED
  FAILED
  CANCELLED
}

enum PaperSessionStatus {
  STARTING
  RUNNING
  STOPPED
  FAILED
}

// -----------------------------------------------------------------------------
// StrategyDefinition - the catalogue of implementations that ship with the code
// -----------------------------------------------------------------------------
// Platform-level and deliberately NOT tenant-scoped: a definition describes a
// class in `wlct_trading.strategies.implementations`, which is the same class
// for every tenant. It holds no customer data, so there is nothing to isolate.
// Tenant scoping starts at Strategy (the instance).
//
// Reserved-but-unimplemented ids live here too, flagged, so that the well-known
// names cannot be quietly taken by something that is not what an operator
// expects.
// -----------------------------------------------------------------------------

model StrategyDefinition {
  id String @id @default(uuid()) @db.Uuid

  /// Stable registry key, e.g. DETERMINISTIC_IMBALANCE_V1. Never reused for a
  /// different implementation.
  key String @unique @db.VarChar(64)

  displayName String  @map("display_name") @db.VarChar(120)
  description String  @db.VarChar(1000)
  category    String? @db.VarChar(40)

  /// False for a reserved name with no code behind it. An instance cannot bind
  /// to an unimplemented definition.
  isImplemented Boolean @default(false) @map("is_implemented")
  /// True for the four spec-reserved ids (MARKET_MAKING_V1, MOMENTUM_V1,
  /// MEAN_REVERSION_V1, MICROSTRUCTURE_V1) that exist to protect the namespace.
  isReserved    Boolean @default(false) @map("is_reserved")

  /// What this strategy does NOT claim. Rendered verbatim in the admin UI so a
  /// catalogue entry can never read like a performance promise.
  riskNotes String @default("No profitability claim is made or implied.") @map("risk_notes") @db.VarChar(1000)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  versions  StrategyVersion[]
  instances Strategy[]
  backtests BacktestRun[]

  @@index([isImplemented])
  @@map("strategy_definitions")
}

// -----------------------------------------------------------------------------
// StrategyVersion - frozen behaviour
// -----------------------------------------------------------------------------
// The point of this table is that behaviour cannot change silently under one
// version. `behaviourHash` covers the implementation id and the parameter
// schema; if either changes, the hash changes, and the platform requires a new
// version row rather than mutating this one.
// -----------------------------------------------------------------------------

model StrategyVersion {
  id           String @id @default(uuid()) @db.Uuid
  definitionId String @map("definition_id") @db.Uuid

  /// Semantic version of the implementation, e.g. "1.0.0".
  version String @db.VarChar(20)

  status StrategyVersionStatus @default(DRAFT)

  /// Module-qualified class path, e.g.
  /// wlct_trading.strategies.implementations.deterministic_example:DeterministicImbalanceStrategy
  implementationId String @map("implementation_id") @db.VarChar(200)

  /// Declared parameter schema: name, type, bounds, default. Used to validate
  /// every configuration before it is written. Credential-shaped parameter
  /// names are refused by the engine, so a schema can never ask for a secret.
  parameterSchema   Json @default("{}") @map("parameter_schema")
  defaultParameters Json @default("{}") @map("default_parameters")

  /// sha256 over implementationId + canonical parameter schema.
  behaviourHash String @map("behaviour_hash") @db.VarChar(64)

  changeNote String? @map("change_note") @db.VarChar(1000)

  publishedAt  DateTime? @map("published_at") @db.Timestamptz(6)
  deprecatedAt DateTime? @map("deprecated_at") @db.Timestamptz(6)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  definition StrategyDefinition @relation(fields: [definitionId], references: [id], onDelete: Cascade)

  instances      Strategy[]
  configurations StrategyConfiguration[]
  backtests      BacktestRun[]

  @@unique([definitionId, version])
  @@index([definitionId, status])
  @@map("strategy_versions")
}

// -----------------------------------------------------------------------------
// StrategyRun - one continuous period of an instance being alive
// -----------------------------------------------------------------------------
// Written on transition only: start, stop, failure. The counters are a snapshot
// taken when the run ends (or at checkpoint time), not a running total updated
// per event - that would be a write per tick by another name.
// -----------------------------------------------------------------------------

model StrategyRun {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  strategyId String @map("strategy_id") @db.Uuid

  /// PAPER or LIVE. A backtest is not a run: it has its own table, because a
  /// backtest has a dataset and a window and a run does not.
  runMode TradingModeSetting @default(PAPER) @map("run_mode")

  status StrategyRunStatus @default(STARTING)

  /// Copied from the instance at start, so a historical run stays readable
  /// after the instance is reconfigured.
  instanceKey     String @map("instance_key") @db.VarChar(32)
  configVersion   Int    @map("config_version")
  strategyKey     String @map("strategy_key") @db.VarChar(64)
  strategyVersion String @map("strategy_version") @db.VarChar(20)

  venue      TradingVenue
  symbols    String[]
  marketType TradingMarketType @default(SPOT) @map("market_type")

  startedAt DateTime  @default(now()) @map("started_at") @db.Timestamptz(6)
  stoppedAt DateTime? @map("stopped_at") @db.Timestamptz(6)

  /// Free-text reason for a clean stop, e.g. "operator disabled".
  stopReason String? @map("stop_reason") @db.VarChar(500)
  /// Exception class name only. Never a message, which could carry data.
  errorCode  String? @map("error_code") @db.VarChar(64)

  /// End-of-run counters: events processed, signals generated / accepted /
  /// rejected / deduplicated, strategy errors, feature errors, risk
  /// rejections, slow dispatches. Stored as JSON because the counter set grows
  /// with the engine and a column per counter would mean a migration each time.
  counters Json @default("{}")

  /// Timestamp of the last market event this run processed, in microseconds.
  lastEventAtMicros BigInt? @map("last_event_at_micros")

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant   Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  strategy Strategy @relation(fields: [strategyId], references: [id], onDelete: Cascade)

  checkpoints StrategyCheckpoint[]
  incidents   StrategyIncident[]

  @@index([tenantId, strategyId, startedAt])
  @@index([tenantId, status, startedAt])
  @@index([strategyId, status])
  @@index([startedAt])
  @@map("strategy_runs")
}

// -----------------------------------------------------------------------------
// StrategyCheckpoint - periodic, resumable instance state
// -----------------------------------------------------------------------------
// On a schedule and on clean stop. Never per tick.
//
// A checkpoint is what allows an instance to resume after a restart instead of
// silently starting from a blank rolling window while behaving as though it had
// history. `stateHash` makes a corrupted or partially written checkpoint
// detectable: restore verifies it and refuses rather than resuming from
// nonsense.
// -----------------------------------------------------------------------------

model StrategyCheckpoint {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  strategyId String  @map("strategy_id") @db.Uuid
  runId      String? @map("run_id") @db.Uuid

  /// Monotonically increasing per strategy.
  sequence Int

  instanceKey String @map("instance_key") @db.VarChar(32)

  /// Serialised instance state as produced by the engine's snapshot(). Feature
  /// windows, cooldown state, the signal counter. No credential can appear
  /// here: the context that produces it has no field for one.
  state Json @default("{}")

  /// sha256 over the canonical encoding of `state`.
  stateHash String @map("state_hash") @db.VarChar(64)

  capturedAtMicros BigInt @map("captured_at_micros")

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  tenant   Tenant       @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  strategy Strategy     @relation(fields: [strategyId], references: [id], onDelete: Cascade)
  run      StrategyRun? @relation(fields: [runId], references: [id], onDelete: SetNull)

  @@unique([strategyId, sequence])
  @@index([tenantId, strategyId, capturedAtMicros])
  @@index([runId])
  @@map("strategy_checkpoints")
}

// -----------------------------------------------------------------------------
// StrategyIncident - what a human needs to know about the strategy layer
// -----------------------------------------------------------------------------
// Same discipline as ExecutionIncident, and the same severity enum rather than
// a parallel one: a WARNING means the same thing in both places, and two
// enums with identical members is duplication waiting to drift.
//
// Rare by design. A validator rejecting one stale signal is the system working
// and produces nothing here.
// -----------------------------------------------------------------------------

model StrategyIncident {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  strategyId String? @map("strategy_id") @db.Uuid
  runId      String? @map("run_id") @db.Uuid

  incidentType StrategyIncidentType      @map("incident_type")
  severity     ExecutionIncidentSeverity @default(WARNING)

  venue  TradingVenue?
  symbol String?       @db.VarChar(32)

  /// Normalised code, e.g. STRATEGY_ERROR, SIGNAL_STALE, VALIDATION_STATE_
  /// UNAVAILABLE. VarChar rather than an enum: the taxonomy grows, and a code
  /// the database has not seen must be recordable rather than rejected.
  errorCode String? @map("error_code") @db.VarChar(64)

  summary String @db.VarChar(1000)

  /// Structured context, scrubbed before it arrives. Feature values and
  /// parameters may appear; a credential cannot, because no strategy object
  /// holds one.
  details Json @default("{}")

  occurredAtMicros BigInt @map("occurred_at_micros")

  resolvedAt     DateTime? @map("resolved_at") @db.Timestamptz(6)
  resolvedBy     String?   @map("resolved_by") @db.Uuid
  resolutionNote String?   @map("resolution_note") @db.VarChar(1000)

  notifiedAt DateTime? @map("notified_at") @db.Timestamptz(6)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant   Tenant       @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  strategy Strategy?    @relation(fields: [strategyId], references: [id], onDelete: SetNull)
  run      StrategyRun? @relation(fields: [runId], references: [id], onDelete: SetNull)

  @@index([tenantId, severity, createdAt])
  @@index([tenantId, incidentType, createdAt])
  @@index([tenantId, strategyId, createdAt])
  /// The dashboard's primary query: unresolved incidents, worst first.
  @@index([tenantId, resolvedAt, severity])
  @@index([runId])
  @@map("strategy_incidents")
}

// -----------------------------------------------------------------------------
// BacktestRun - a completed simulation over stored data
// -----------------------------------------------------------------------------
// SIMULATED. Every figure in this table was produced by a model that ignores
// queue position, market impact, venue rejections and latency variance, and is
// therefore systematically optimistic.
//
// BACKTEST PERFORMANCE IS NOT INDICATIVE OF FUTURE PERFORMANCE.
//
// Two columns make a result reproducible rather than merely plausible:
// `configurationHash` (strategy, version, implementation id, parameters,
// execution assumptions, dataset identity and initial capital) and the dataset
// identity columns including `datasetChecksum`. Re-running with the same hash
// against the same checksum must produce the same `runIdentifier`. It hashes no
// secret: none of its inputs can contain one.
// -----------------------------------------------------------------------------

model BacktestRun {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  /// Who asked for it. Null for a scheduled or system-initiated run.
  requestedByUserId String? @map("requested_by_user_id") @db.Uuid

  /// The instance this was run for, when it was run for one. A backtest can
  /// also be run against a definition alone, before any instance exists.
  strategyId   String? @map("strategy_id") @db.Uuid
  definitionId String? @map("definition_id") @db.Uuid
  versionId    String? @map("version_id") @db.Uuid

  /// Denormalised so a historical result stays readable after the catalogue
  /// changes underneath it.
  strategyKey      String @map("strategy_key") @db.VarChar(64)
  strategyVersion  String @map("strategy_version") @db.VarChar(20)
  implementationId String @map("implementation_id") @db.VarChar(200)

  status BacktestRunStatus @default(QUEUED)

  venue      TradingVenue
  symbol     String            @db.VarChar(32)
  marketType TradingMarketType @default(SPOT) @map("market_type")

  // --- dataset identity ----------------------------------------------------
  datasetId         String  @map("dataset_id") @db.VarChar(120)
  datasetSource     String  @map("dataset_source") @db.VarChar(120)
  datasetChecksum   String? @map("dataset_checksum") @db.VarChar(64)
  granularity       String? @db.VarChar(20)
  windowStartMicros BigInt  @map("window_start_micros")
  windowEndMicros   BigInt  @map("window_end_micros")
  eventCount        Int     @default(0) @map("event_count")

  /// The walk-forward window this run belongs to, when it is part of a split:
  /// TRAINING, VALIDATION or TEST. Null for a plain single-window run.
  walkForwardSegment String? @map("walk_forward_segment") @db.VarChar(20)

  // --- assumptions ---------------------------------------------------------
  initialCapital Decimal @map("initial_capital") @db.Decimal(18, 6)
  makerFeeRate   Decimal @map("maker_fee_rate") @db.Decimal(9, 6)
  takerFeeRate   Decimal @map("taker_fee_rate") @db.Decimal(9, 6)
  slippageBps    Decimal @map("slippage_bps") @db.Decimal(9, 4)
  latencyMicros  BigInt  @default(0) @map("latency_micros")

  /// Parameters exactly as validated and used. Never a credential.
  parameters  Json @default("{}")
  /// The full assumption set as recorded by the engine, including the ones
  /// with no column of their own (minimum fill quantity, partial fill policy).
  assumptions Json @default("{}")

  // --- results (null until COMPLETED) --------------------------------------
  finalEquity  Decimal? @map("final_equity") @db.Decimal(18, 6)
  netPnl       Decimal? @map("net_pnl") @db.Decimal(18, 6)
  grossProfit  Decimal? @map("gross_profit") @db.Decimal(18, 6)
  grossLoss    Decimal? @map("gross_loss") @db.Decimal(18, 6)
  feesPaid     Decimal? @map("fees_paid") @db.Decimal(18, 6)
  slippageCost Decimal? @map("slippage_cost") @db.Decimal(18, 6)

  totalReturnPercent Decimal? @map("total_return_percent") @db.Decimal(12, 6)
  maxDrawdown        Decimal? @map("max_drawdown") @db.Decimal(18, 6)
  maxDrawdownPercent Decimal? @map("max_drawdown_percent") @db.Decimal(12, 6)

  totalTrades   Int @default(0) @map("total_trades")
  winningTrades Int @default(0) @map("winning_trades")
  losingTrades  Int @default(0) @map("losing_trades")

  /// Null rather than zero when there were no trades. A strategy that never
  /// traded does not have a 0% win rate, and storing one would be a lie a
  /// dashboard would happily repeat.
  winRate      Decimal? @map("win_rate") @db.Decimal(9, 6)
  averageTrade Decimal? @map("average_trade") @db.Decimal(18, 6)
  largestWin   Decimal? @map("largest_win") @db.Decimal(18, 6)
  largestLoss  Decimal? @map("largest_loss") @db.Decimal(18, 6)
  profitFactor Decimal? @map("profit_factor") @db.Decimal(18, 8)

  /// Risk-adjusted figures, withheld (null) below the engine's minimum
  /// observation count and on zero dispersion.
  sharpeRatio  Decimal? @map("sharpe_ratio") @db.Decimal(18, 8)
  sortinoRatio Decimal? @map("sortino_ratio") @db.Decimal(18, 8)

  /// False when the run had too few observations for the risk-adjusted
  /// figures to mean anything. Stored explicitly so a consumer cannot mistake
  /// a null for "not calculated yet".
  hasSufficientObservations Boolean @default(false) @map("has_sufficient_observations")

  exposurePercent Decimal? @map("exposure_percent") @db.Decimal(9, 6)
  turnover        Decimal? @map("turnover") @db.Decimal(18, 6)

  // --- identity ------------------------------------------------------------
  /// Engine-assigned deterministic run id, "bt-" + 24 hex.
  runIdentifier     String @map("run_identifier") @db.VarChar(32)
  /// sha256 over strategy, version, implementation id, parameters, assumptions,
  /// dataset identity and initial capital. Hashes no secret.
  configurationHash String @map("configuration_hash") @db.VarChar(64)
  engineVersion     String @map("engine_version") @db.VarChar(20)

  /// False when the dataset carried no checksum, which means this result
  /// cannot be proven to have come from that data.
  isReproducible Boolean @default(false) @map("is_reproducible")

  /// Always true. A column rather than an assumption, so that a consumer
  /// reading a row in isolation cannot mistake it for a live result.
  isSimulated Boolean @default(true) @map("is_simulated")

  jobId String? @map("job_id") @db.VarChar(64)

  queuedAt    DateTime  @default(now()) @map("queued_at") @db.Timestamptz(6)
  startedAt   DateTime? @map("started_at") @db.Timestamptz(6)
  completedAt DateTime? @map("completed_at") @db.Timestamptz(6)
  durationMs  Int?      @map("duration_ms")

  errorCode    String? @map("error_code") @db.VarChar(64)
  errorSummary String? @map("error_summary") @db.VarChar(1000)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant     Tenant              @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  strategy   Strategy?           @relation(fields: [strategyId], references: [id], onDelete: SetNull)
  definition StrategyDefinition? @relation(fields: [definitionId], references: [id], onDelete: SetNull)
  version    StrategyVersion?    @relation(fields: [versionId], references: [id], onDelete: SetNull)

  metrics BacktestMetric[]
  trades  BacktestTrade[]

  /// The engine's run id is deterministic, so the same inputs re-submitted
  /// inside one tenant collide here rather than producing a second row that
  /// claims to be a different result.
  @@unique([tenantId, runIdentifier])
  @@index([tenantId, status, queuedAt])
  @@index([tenantId, strategyId, queuedAt])
  @@index([tenantId, configurationHash])
  @@index([tenantId, symbol, queuedAt])
  @@index([definitionId])
  @@index([versionId])
  @@index([queuedAt])
  @@map("backtest_runs")
}

// -----------------------------------------------------------------------------
// BacktestMetric - one named figure, with its own honesty flag
// -----------------------------------------------------------------------------
// The headline numbers have columns on BacktestRun. This table exists for the
// long tail, and for one property the columns cannot express: every metric
// carries `observationCount` and `isSufficient`, so a consumer can tell the
// difference between "0.0" and "not enough data to say".
// -----------------------------------------------------------------------------

model BacktestMetric {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  backtestRunId String @map("backtest_run_id") @db.Uuid

  name  String   @db.VarChar(64)
  /// Null when the metric could not be computed meaningfully. Never coerced
  /// to zero.
  value Decimal? @db.Decimal(28, 12)
  unit  String   @default("RATIO") @db.VarChar(16)

  observationCount Int     @default(0) @map("observation_count")
  isSufficient     Boolean @default(false) @map("is_sufficient")

  /// Why a value is absent, when it is, e.g. "fewer than 20 return
  /// observations" or "zero dispersion".
  note String? @db.VarChar(500)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  tenant Tenant      @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  run    BacktestRun @relation(fields: [backtestRunId], references: [id], onDelete: Cascade)

  @@unique([backtestRunId, name])
  @@index([tenantId, name])
  @@map("backtest_metrics")
}

// -----------------------------------------------------------------------------
// BacktestTrade - one simulated round trip
// -----------------------------------------------------------------------------
// SIMULATED. These fills were never sent anywhere.
//
// `isWin` is net of fees: a trade profitable before costs and unprofitable
// after is a loss. A round trip that realised exactly zero is still recorded,
// because it still paid fees, and omitting it would quietly improve the win
// rate of every strategy in the platform.
// -----------------------------------------------------------------------------

model BacktestTrade {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  backtestRunId String @map("backtest_run_id") @db.Uuid

  /// Position in the run, from 1. Deterministic.
  sequence Int

  symbol    String           @db.VarChar(32)
  direction PositionSideEnum

  quantity   Decimal @db.Decimal(28, 12)
  entryPrice Decimal @map("entry_price") @db.Decimal(28, 12)
  exitPrice  Decimal @map("exit_price") @db.Decimal(28, 12)

  grossPnl Decimal @map("gross_pnl") @db.Decimal(18, 6)
  fees     Decimal @default(0) @db.Decimal(18, 6)
  netPnl   Decimal @map("net_pnl") @db.Decimal(18, 6)

  /// Net of fees. See the note above.
  isWin Boolean @map("is_win")

  openedAtMicros BigInt @map("opened_at_micros")
  closedAtMicros BigInt @map("closed_at_micros")
  holdingMicros  BigInt @map("holding_micros")

  /// Always true.
  isSimulated Boolean @default(true) @map("is_simulated")

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  tenant Tenant      @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  run    BacktestRun @relation(fields: [backtestRunId], references: [id], onDelete: Cascade)

  @@unique([backtestRunId, sequence])
  @@index([tenantId, backtestRunId])
  @@index([backtestRunId, closedAtMicros])
  @@map("backtest_trades")
}

// -----------------------------------------------------------------------------
// PaperTradingSession - a strategy against the real feed, with simulated fills
// -----------------------------------------------------------------------------
// SIMULATED. The prices are real, the decisions are real, the fills are not.
//
// PAPER PERFORMANCE IS NOT INDICATIVE OF LIVE PERFORMANCE. The simulator fills
// at the observed top of book without queue position or market impact, so it
// systematically flatters any strategy that would in reality have waited, been
// partially filled, or moved the price.
//
// A session cannot reach a live adapter: the session object refuses to be
// constructed with one. That is enforced in the engine, not here - this table
// only records what happened.
// -----------------------------------------------------------------------------

model PaperTradingSession {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  strategyId        String? @map("strategy_id") @db.Uuid
  requestedByUserId String? @map("requested_by_user_id") @db.Uuid

  /// Engine-assigned session id, unique inside the tenant.
  sessionIdentifier String @map("session_identifier") @db.VarChar(64)

  status PaperSessionStatus @default(STARTING)

  strategyKey     String @map("strategy_key") @db.VarChar(64)
  strategyVersion String @map("strategy_version") @db.VarChar(20)

  venue      TradingVenue
  symbol     String            @db.VarChar(32)
  marketType TradingMarketType @default(SPOT) @map("market_type")

  initialCapital Decimal  @map("initial_capital") @db.Decimal(18, 6)
  currentEquity  Decimal? @map("current_equity") @db.Decimal(18, 6)
  realisedPnl    Decimal  @default(0) @map("realised_pnl") @db.Decimal(18, 6)
  /// Null when flat or unmarked. Never coerced to zero.
  unrealisedPnl  Decimal? @map("unrealised_pnl") @db.Decimal(18, 6)
  feesPaid       Decimal  @default(0) @map("fees_paid") @db.Decimal(18, 6)
  maxDrawdown    Decimal? @map("max_drawdown") @db.Decimal(18, 6)

  signalsGenerated Int @default(0) @map("signals_generated")
  signalsAccepted  Int @default(0) @map("signals_accepted")
  signalsRejected  Int @default(0) @map("signals_rejected")
  riskRejections   Int @default(0) @map("risk_rejections")
  simulatedOrders  Int @default(0) @map("simulated_orders")
  simulatedFills   Int @default(0) @map("simulated_fills")
  strategyErrors   Int @default(0) @map("strategy_errors")

  /// Always true. Present as a column so a row read in isolation, or exported
  /// to a spreadsheet, still says what it is.
  isSimulated Boolean @default(true) @map("is_simulated")

  startedAt  DateTime  @default(now()) @map("started_at") @db.Timestamptz(6)
  stoppedAt  DateTime? @map("stopped_at") @db.Timestamptz(6)
  stopReason String?   @map("stop_reason") @db.VarChar(500)
  errorCode  String?   @map("error_code") @db.VarChar(64)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant   Tenant    @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  strategy Strategy? @relation(fields: [strategyId], references: [id], onDelete: SetNull)

  snapshots PaperPortfolioSnapshot[]

  @@unique([tenantId, sessionIdentifier])
  @@index([tenantId, status, startedAt])
  @@index([tenantId, strategyId, startedAt])
  @@index([startedAt])
  @@map("paper_trading_sessions")
}

// -----------------------------------------------------------------------------
// PaperPortfolioSnapshot - the simulated equity curve, sampled
// -----------------------------------------------------------------------------
// Sampled on a slow schedule and on stop. NOT written per fill and certainly
// not per tick: a snapshot per event would put the database in the hot path,
// which is the one thing the data plane is not allowed to do.
// -----------------------------------------------------------------------------

model PaperPortfolioSnapshot {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  sessionId String @map("session_id") @db.Uuid

  /// Monotonically increasing per session.
  sequence Int

  capturedAtMicros BigInt @map("captured_at_micros")

  cash             Decimal  @db.Decimal(18, 6)
  positionQuantity Decimal  @default(0) @map("position_quantity") @db.Decimal(28, 12)
  positionValue    Decimal? @map("position_value") @db.Decimal(18, 6)
  equity           Decimal  @db.Decimal(18, 6)
  realisedPnl      Decimal  @default(0) @map("realised_pnl") @db.Decimal(18, 6)
  /// Null when flat or unmarked.
  unrealisedPnl    Decimal? @map("unrealised_pnl") @db.Decimal(18, 6)
  feesPaid         Decimal  @default(0) @map("fees_paid") @db.Decimal(18, 6)
  drawdown         Decimal  @default(0) @db.Decimal(18, 6)

  /// Always true.
  isSimulated Boolean @default(true) @map("is_simulated")

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  tenant  Tenant              @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  session PaperTradingSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)

  @@unique([sessionId, sequence])
  @@index([tenantId, sessionId, capturedAtMicros])
  @@map("paper_portfolio_snapshots")
}
```

---

## FILE: apps/api/src/app.module.ts

```ts
import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';

import { AppConfigModule } from './config/app-config.module';
import { LoggerModule } from './infrastructure/logger/logger.module';
import { PrismaModule } from './infrastructure/prisma/prisma.module';
import { RedisModule } from './infrastructure/redis/redis.module';
import { CryptoModule } from './infrastructure/crypto/crypto.module';
import { I18nModule } from './infrastructure/i18n/i18n.module';
import { QueueModule } from './modules/queue/queue.module';
import { HealthModule } from './modules/health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { TenantsModule } from './modules/tenants/tenants.module';
import { RbacModule } from './modules/rbac/rbac.module';
import { AuditModule } from './modules/audit/audit.module';
import { SecurityModule } from './modules/security/security.module';
import { FeatureFlagsModule } from './modules/feature-flags/feature-flags.module';
import { BillingModule } from './modules/billing/billing.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { ExecutionModule } from './modules/execution/execution.module';
import { StrategyModule } from './modules/strategy/strategy.module';

import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { PrismaExceptionFilter } from './common/filters/prisma-exception.filter';
import { ResponseTransformInterceptor } from './common/interceptors/response-transform.interceptor';
import { TimeoutInterceptor } from './common/interceptors/timeout.interceptor';
import { AuditContextInterceptor } from './common/interceptors/audit-context.interceptor';
import { GlobalValidationPipe } from './common/pipes/global-validation.pipe';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from './modules/auth/guards/permissions.guard';
import { TenantGuard } from './modules/tenants/guards/tenant.guard';
import { FeatureFlagGuard } from './modules/feature-flags/guards/feature-flag.guard';
import { ThrottlerBehindProxyGuard } from './common/guards/throttler-behind-proxy.guard';
import { RequestContextMiddleware } from './common/middleware/request-context.middleware';
import { TenantResolutionMiddleware } from './common/middleware/tenant-resolution.middleware';
import { RateLimitModule } from './common/rate-limit/rate-limit.module';

/**
 * Root module.
 *
 * Cross-cutting behaviour is registered once here as global providers so that
 * feature modules stay focused on their domain:
 *   - validation pipe        -> rejects malformed input before controllers run
 *   - exception filters      -> uniform, stack-trace-free error envelopes
 *   - response interceptor   -> uniform success envelopes
 *   - guards (order matters) -> throttling, then authN, then tenancy, then authZ
 */
@Module({
  imports: [
    AppConfigModule,
    // Dynamic on purpose: see the comment in logger.module.ts. Calling
    // forRoot() here (rather than importing a statically configured module)
    // guarantees every @InjectPinoLogger context has been registered first.
    LoggerModule.forRoot(),
    PrismaModule,
    RedisModule,
    CryptoModule,
    I18nModule,
    RateLimitModule,
    ScheduleModule.forRoot(),
    QueueModule,
    HealthModule,
    AuditModule,
    SecurityModule,
    RbacModule,
    TenantsModule,
    UsersModule,
    AuthModule,
    FeatureFlagsModule,
    BillingModule,
    NotificationsModule,
    RealtimeModule,
    ExecutionModule,
    StrategyModule,
  ],
  providers: [
    { provide: APP_PIPE, useClass: GlobalValidationPipe },
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
    { provide: APP_FILTER, useClass: PrismaExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: TimeoutInterceptor },
    { provide: APP_INTERCEPTOR, useClass: AuditContextInterceptor },
    { provide: APP_INTERCEPTOR, useClass: ResponseTransformInterceptor },
    // Guards execute in registration order.
    { provide: APP_GUARD, useClass: ThrottlerBehindProxyGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: TenantGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_GUARD, useClass: FeatureFlagGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(RequestContextMiddleware, TenantResolutionMiddleware)
      .forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}
```

---

## FILE: packages/shared-types/src/rbac.ts

```ts
/**
 * Role Based Access Control contracts.
 *
 * Roles are data (rows in the `Role` table) so tenants can define custom roles,
 * but the platform ships a fixed set of system roles that cannot be deleted.
 * Authorization decisions are always made against *permissions*, never against
 * role names, which is what allows new roles to be introduced without touching
 * guards or controllers.
 */

export enum SystemRole {
  SUPER_ADMIN = 'SUPER_ADMIN',
  TENANT_ADMIN = 'TENANT_ADMIN',
  TRADER = 'TRADER',
  FOLLOWER = 'FOLLOWER',
  SUPPORT = 'SUPPORT',
  FINANCE = 'FINANCE',
  COMPLIANCE = 'COMPLIANCE',
}

/** Scope at which a role may be granted. */
export enum RoleScope {
  PLATFORM = 'PLATFORM',
  TENANT = 'TENANT',
}

/**
 * Permission strings follow `resource:action`. Wildcards are supported on the
 * action segment (`tenant:*`) and globally (`*`) for the platform super admin.
 *
 * One exception, introduced with Part 5 and enforced by `permissionMatches`:
 * a small set of permissions that move real money or disarm a safety control
 * are excluded from action wildcards. See `NON_WILDCARD_PERMISSIONS`.
 */
export enum Permission {
  ALL = '*',

  // Platform level
  PLATFORM_MANAGE = 'platform:manage',
  PLATFORM_READ_METRICS = 'platform:read_metrics',
  PLATFORM_IMPERSONATE = 'platform:impersonate',

  // Tenants
  TENANT_CREATE = 'tenant:create',
  TENANT_READ = 'tenant:read',
  TENANT_UPDATE = 'tenant:update',
  TENANT_DELETE = 'tenant:delete',
  TENANT_SUSPEND = 'tenant:suspend',
  TENANT_BRANDING_READ = 'tenant_branding:read',
  TENANT_BRANDING_UPDATE = 'tenant_branding:update',
  TENANT_SETTINGS_READ = 'tenant_settings:read',
  TENANT_SETTINGS_UPDATE = 'tenant_settings:update',
  TENANT_DOMAIN_MANAGE = 'tenant_domain:manage',

  // Users
  USER_CREATE = 'user:create',
  USER_READ = 'user:read',
  USER_UPDATE = 'user:update',
  USER_DELETE = 'user:delete',
  USER_SUSPEND = 'user:suspend',
  USER_ASSIGN_ROLE = 'user:assign_role',
  USER_RESET_PASSWORD = 'user:reset_password',
  USER_READ_SESSIONS = 'user:read_sessions',
  USER_REVOKE_SESSIONS = 'user:revoke_sessions',

  // RBAC
  ROLE_CREATE = 'role:create',
  ROLE_READ = 'role:read',
  ROLE_UPDATE = 'role:update',
  ROLE_DELETE = 'role:delete',
  PERMISSION_READ = 'permission:read',

  // Billing
  PLAN_READ = 'plan:read',
  PLAN_MANAGE = 'plan:manage',
  SUBSCRIPTION_READ = 'subscription:read',
  SUBSCRIPTION_MANAGE = 'subscription:manage',
  INVOICE_READ = 'invoice:read',
  PAYOUT_MANAGE = 'payout:manage',

  // Feature flags
  FEATURE_FLAG_READ = 'feature_flag:read',
  FEATURE_FLAG_MANAGE = 'feature_flag:manage',

  // Compliance / audit
  AUDIT_LOG_READ = 'audit_log:read',
  SECURITY_EVENT_READ = 'security_event:read',
  KYC_READ = 'kyc:read',
  KYC_REVIEW = 'kyc:review',

  // Trading domain (enforced from Part 2, declared now so policies are stable)
  EXCHANGE_ACCOUNT_READ = 'exchange_account:read',
  EXCHANGE_ACCOUNT_MANAGE = 'exchange_account:manage',
  STRATEGY_READ = 'strategy:read',
  STRATEGY_MANAGE = 'strategy:manage',
  COPY_SUBSCRIPTION_READ = 'copy_subscription:read',
  COPY_SUBSCRIPTION_MANAGE = 'copy_subscription:manage',
  ORDER_READ = 'order:read',
  ORDER_MANAGE = 'order:manage',
  POSITION_READ = 'position:read',
  PORTFOLIO_READ = 'portfolio:read',
  REPORT_READ = 'report:read',
  SUPPORT_TICKET_READ = 'support_ticket:read',
  SUPPORT_TICKET_MANAGE = 'support_ticket:manage',
  NOTIFICATION_SEND = 'notification:send',

  // ---------------------------------------------------------------------
  // Part 5 - authenticated execution
  // ---------------------------------------------------------------------
  // Separated from the Part 2 trading permissions on purpose. `order:read`
  // lets a follower see their own order history; `execution:submit` lets a
  // caller push a signed request at a real exchange with real money behind it.
  // Collapsing those into one permission is how a support agent ends up able
  // to trade.

  /** View execution pipeline state: engine health, gates, latency observations. */
  EXECUTION_READ = 'execution:read',
  /** Submit an order through the execution engine. Never granted to SUPPORT. */
  EXECUTION_SUBMIT = 'execution:submit',
  /** Cancel a working order. Separate from submit: cancelling is risk-reducing. */
  EXECUTION_CANCEL = 'execution:cancel',

  /** Read the immutable order event / audit trail for an order. */
  ORDER_EVENT_READ = 'order_event:read',
  /** Read normalised fills. */
  FILL_READ = 'fill:read',

  /** Read venue balances as last observed. */
  BALANCE_READ = 'balance:read',
  /** Force a balance refresh against the venue. Costs rate-limit weight. */
  BALANCE_REFRESH = 'balance:refresh',

  /** Run a credential check against the venue for an exchange account. */
  EXCHANGE_ACCOUNT_VERIFY = 'exchange_account:verify',
  /** Replace the stored credential or its secret-manager pointer. */
  EXCHANGE_ACCOUNT_ROTATE_CREDENTIALS = 'exchange_account:rotate_credentials',
  /**
   * Arm live trading on one account. The single most dangerous permission in
   * the platform: it is the human half of the LIVE_TRADING_ENABLED gate.
   * Excluded from wildcards.
   */
  EXCHANGE_ACCOUNT_ENABLE_LIVE = 'exchange_account:enable_live',

  /** Observe private user-data stream session health. */
  PRIVATE_STREAM_READ = 'private_stream:read',
  /** Start, stop or force-reconnect a private user-data stream. */
  PRIVATE_STREAM_MANAGE = 'private_stream:manage',

  /** Read reconciliation runs and their discrepancies. */
  RECONCILIATION_READ = 'reconciliation:read',
  /** Trigger an out-of-band reconciliation pass for an account. */
  RECONCILIATION_TRIGGER = 'reconciliation:trigger',
  /**
   * Mark a discrepancy as accepted after human review. This is the only way a
   * disagreement between local state and the venue is ever closed - the
   * service itself never silently repairs one. Excluded from wildcards.
   */
  RECONCILIATION_RESOLVE = 'reconciliation:resolve',

  /** Read execution incidents. */
  EXECUTION_INCIDENT_READ = 'execution_incident:read',
  /** Close an execution incident with a resolution note. */
  EXECUTION_INCIDENT_RESOLVE = 'execution_incident:resolve',

  /** Read kill switch state. */
  KILL_SWITCH_READ = 'kill_switch:read',
  /**
   * Engage or release a kill switch. Engaging is always allowed to anyone
   * holding this; the danger is releasing one, which is why it is excluded
   * from wildcards.
   */
  KILL_SWITCH_OPERATE = 'kill_switch:operate',

  // ---------------------------------------------------------------------
  // Part 6 - strategy layer
  // ---------------------------------------------------------------------
  // `strategy:read` and `strategy:manage` already existed and keep their
  // Part 2 meaning: the catalogue and the strategy record. The permissions
  // below are about the running instance, because reading a strategy's
  // definition and starting it against a live market feed are not the same
  // act and must not be grantable with one click.
  //
  // None of these can enable live trading. Enabling an instance makes it emit
  // signals; whether a signal becomes an order is still decided by the risk
  // engine and the Part 5 execution gates.

  /** Read published strategy versions and their parameter schemas. */
  STRATEGY_VERSION_READ = 'strategy_version:read',

  /** Read strategy instances: configuration, health, run history. */
  STRATEGY_INSTANCE_READ = 'strategy_instance:read',
  /** Create an instance or change its configuration. Does not start it. */
  STRATEGY_INSTANCE_MANAGE = 'strategy_instance:manage',
  /**
   * Start an instance so it begins consuming market data and emitting signals.
   * Excluded from wildcards: `strategy_instance:*` granted to let someone tidy
   * up configuration must not also let them put a strategy into production.
   */
  STRATEGY_INSTANCE_ENABLE = 'strategy_instance:enable',
  /**
   * Stop an instance. Deliberately NOT excluded from wildcards and granted
   * widely: stopping a strategy is risk-reducing, and a permission check is
   * the wrong thing to be arguing with while something misbehaves.
   */
  STRATEGY_INSTANCE_DISABLE = 'strategy_instance:disable',

  /** Read strategy incidents. */
  STRATEGY_INCIDENT_READ = 'strategy_incident:read',
  /** Close a strategy incident with a resolution note. */
  STRATEGY_INCIDENT_RESOLVE = 'strategy_incident:resolve',

  /** Read strategy engine counters and latency observations. */
  STRATEGY_METRICS_READ = 'strategy_metrics:read',

  /** Read backtest runs and their results. */
  BACKTEST_READ = 'backtest:read',
  /** Submit a backtest. Touches no venue; it replays stored data. */
  BACKTEST_SUBMIT = 'backtest:submit',

  /** Read paper trading sessions and their simulated portfolios. */
  PAPER_SESSION_READ = 'paper_session:read',
  /** Start or stop a paper session. Simulated fills only, never a venue. */
  PAPER_SESSION_OPERATE = 'paper_session:operate',
}

/**
 * Permissions that a `resource:*` wildcard does NOT grant.
 *
 * Wildcards are a convenience for building custom roles, and the failure mode
 * of a convenience is that someone grants `exchange_account:*` meaning "let
 * support fix API keys" and hands out the ability to arm live trading. These
 * must be listed explicitly on a role.
 *
 * The platform super admin's global `*` still matches: that role is the
 * break-glass identity and restricting it would only produce a system nobody
 * can operate in an incident.
 */
export const NON_WILDCARD_PERMISSIONS: ReadonlySet<string> = Object.freeze(
  new Set<string>([
    Permission.EXCHANGE_ACCOUNT_ENABLE_LIVE,
    Permission.EXCHANGE_ACCOUNT_ROTATE_CREDENTIALS,
    Permission.EXECUTION_SUBMIT,
    Permission.KILL_SWITCH_OPERATE,
    Permission.RECONCILIATION_RESOLVE,
    Permission.PLATFORM_IMPERSONATE,
    Permission.STRATEGY_INSTANCE_ENABLE,
  ]),
);

/**
 * Every Part 5 permission, in declaration order. Exported so the seed script
 * and the admin UI enumerate the execution surface without hard-coding it.
 */
export const EXECUTION_PERMISSIONS: readonly Permission[] = Object.freeze([
  Permission.EXECUTION_READ,
  Permission.EXECUTION_SUBMIT,
  Permission.EXECUTION_CANCEL,
  Permission.ORDER_EVENT_READ,
  Permission.FILL_READ,
  Permission.BALANCE_READ,
  Permission.BALANCE_REFRESH,
  Permission.EXCHANGE_ACCOUNT_VERIFY,
  Permission.EXCHANGE_ACCOUNT_ROTATE_CREDENTIALS,
  Permission.EXCHANGE_ACCOUNT_ENABLE_LIVE,
  Permission.PRIVATE_STREAM_READ,
  Permission.PRIVATE_STREAM_MANAGE,
  Permission.RECONCILIATION_READ,
  Permission.RECONCILIATION_TRIGGER,
  Permission.RECONCILIATION_RESOLVE,
  Permission.EXECUTION_INCIDENT_READ,
  Permission.EXECUTION_INCIDENT_RESOLVE,
  Permission.KILL_SWITCH_READ,
  Permission.KILL_SWITCH_OPERATE,
]);

/**
 * Every Part 6 permission, in declaration order. Exported for the same reason
 * as `EXECUTION_PERMISSIONS`: the seed script and the admin UI enumerate the
 * strategy surface from one list rather than each keeping their own copy.
 */
export const STRATEGY_PERMISSIONS: readonly Permission[] = Object.freeze([
  Permission.STRATEGY_VERSION_READ,
  Permission.STRATEGY_INSTANCE_READ,
  Permission.STRATEGY_INSTANCE_MANAGE,
  Permission.STRATEGY_INSTANCE_ENABLE,
  Permission.STRATEGY_INSTANCE_DISABLE,
  Permission.STRATEGY_INCIDENT_READ,
  Permission.STRATEGY_INCIDENT_RESOLVE,
  Permission.STRATEGY_METRICS_READ,
  Permission.BACKTEST_READ,
  Permission.BACKTEST_SUBMIT,
  Permission.PAPER_SESSION_READ,
  Permission.PAPER_SESSION_OPERATE,
]);

/**
 * The read-only subset of the strategy surface.
 *
 * This is what the mobile application is allowed to hold, and what a support
 * or compliance role is granted. Nothing in this list starts, stops or
 * reconfigures anything.
 */
export const STRATEGY_READ_ONLY_PERMISSIONS: readonly Permission[] = Object.freeze([
  Permission.STRATEGY_READ,
  Permission.STRATEGY_VERSION_READ,
  Permission.STRATEGY_INSTANCE_READ,
  Permission.STRATEGY_INCIDENT_READ,
  Permission.STRATEGY_METRICS_READ,
  Permission.BACKTEST_READ,
  Permission.PAPER_SESSION_READ,
]);

export interface PermissionDefinition {
  key: Permission;
  resource: string;
  action: string;
  description: string;
  /** True when a `resource:*` wildcard will not grant this permission. */
  requiresExplicitGrant: boolean;
}

export interface RoleDefinition {
  key: SystemRole;
  name: string;
  description: string;
  scope: RoleScope;
  isSystem: true;
  permissions: Permission[];
}

const TRADER_PERMISSIONS: Permission[] = [
  Permission.EXCHANGE_ACCOUNT_READ,
  Permission.EXCHANGE_ACCOUNT_MANAGE,
  Permission.STRATEGY_READ,
  Permission.STRATEGY_MANAGE,
  Permission.ORDER_READ,
  Permission.ORDER_MANAGE,
  Permission.POSITION_READ,
  Permission.PORTFOLIO_READ,
  Permission.COPY_SUBSCRIPTION_READ,
  Permission.REPORT_READ,

  // Part 5. A trader may trade their own account and see why an order was
  // refused, but may not arm live trading, rotate a credential, release a kill
  // switch or close a reconciliation discrepancy. Those are operator actions.
  Permission.EXECUTION_READ,
  Permission.EXECUTION_SUBMIT,
  Permission.EXECUTION_CANCEL,
  Permission.ORDER_EVENT_READ,
  Permission.FILL_READ,
  Permission.BALANCE_READ,
  Permission.BALANCE_REFRESH,
  Permission.EXCHANGE_ACCOUNT_VERIFY,
  Permission.PRIVATE_STREAM_READ,
  Permission.RECONCILIATION_READ,
  Permission.EXECUTION_INCIDENT_READ,
  Permission.KILL_SWITCH_READ,

  // Part 6. A trader owns their strategies end to end: configure, backtest,
  // paper trade, start and stop. What they cannot do is make any of that reach
  // a venue on its own - that still needs the account armed for live trading,
  // which is a tenant-administrator action.
  Permission.STRATEGY_VERSION_READ,
  Permission.STRATEGY_INSTANCE_READ,
  Permission.STRATEGY_INSTANCE_MANAGE,
  Permission.STRATEGY_INSTANCE_ENABLE,
  Permission.STRATEGY_INSTANCE_DISABLE,
  Permission.STRATEGY_INCIDENT_READ,
  Permission.STRATEGY_METRICS_READ,
  Permission.BACKTEST_READ,
  Permission.BACKTEST_SUBMIT,
  Permission.PAPER_SESSION_READ,
  Permission.PAPER_SESSION_OPERATE,
];

const FOLLOWER_PERMISSIONS: Permission[] = [
  Permission.EXCHANGE_ACCOUNT_READ,
  Permission.EXCHANGE_ACCOUNT_MANAGE,
  Permission.COPY_SUBSCRIPTION_READ,
  Permission.COPY_SUBSCRIPTION_MANAGE,
  Permission.ORDER_READ,
  Permission.POSITION_READ,
  Permission.PORTFOLIO_READ,
  Permission.STRATEGY_READ,

  // Part 5. A follower's orders originate from a copy subscription, not from
  // the follower pressing a button, so EXECUTION_SUBMIT is deliberately absent.
  // Cancel is present: a user must always be able to stop something that is
  // already working against them.
  Permission.EXECUTION_CANCEL,
  Permission.ORDER_EVENT_READ,
  Permission.FILL_READ,
  Permission.BALANCE_READ,
  Permission.BALANCE_REFRESH,
  Permission.EXCHANGE_ACCOUNT_VERIFY,
  Permission.PRIVATE_STREAM_READ,
  Permission.RECONCILIATION_READ,
  Permission.EXECUTION_INCIDENT_READ,

  // Part 6. A follower copies a trader; they do not run strategies. They may
  // see which strategy is behind what they are copying, and nothing more.
  Permission.STRATEGY_VERSION_READ,
];

/**
 * Default permission matrix seeded into the database. Tenant admins may clone
 * these roles and tune the permission set per brand.
 */
export const SYSTEM_ROLE_DEFINITIONS: readonly RoleDefinition[] = Object.freeze([
  {
    key: SystemRole.SUPER_ADMIN,
    name: 'Super Administrator',
    description: 'Platform owner. Unrestricted access across every tenant.',
    scope: RoleScope.PLATFORM,
    isSystem: true,
    permissions: [Permission.ALL],
  },
  {
    key: SystemRole.TENANT_ADMIN,
    name: 'Tenant Administrator',
    description: 'Full administrative control limited to a single tenant.',
    scope: RoleScope.TENANT,
    isSystem: true,
    permissions: [
      Permission.TENANT_READ,
      Permission.TENANT_UPDATE,
      Permission.TENANT_BRANDING_READ,
      Permission.TENANT_BRANDING_UPDATE,
      Permission.TENANT_SETTINGS_READ,
      Permission.TENANT_SETTINGS_UPDATE,
      Permission.TENANT_DOMAIN_MANAGE,
      Permission.USER_CREATE,
      Permission.USER_READ,
      Permission.USER_UPDATE,
      Permission.USER_DELETE,
      Permission.USER_SUSPEND,
      Permission.USER_ASSIGN_ROLE,
      Permission.USER_RESET_PASSWORD,
      Permission.USER_READ_SESSIONS,
      Permission.USER_REVOKE_SESSIONS,
      Permission.ROLE_CREATE,
      Permission.ROLE_READ,
      Permission.ROLE_UPDATE,
      Permission.ROLE_DELETE,
      Permission.PERMISSION_READ,
      Permission.PLAN_READ,
      Permission.SUBSCRIPTION_READ,
      Permission.SUBSCRIPTION_MANAGE,
      Permission.INVOICE_READ,
      Permission.FEATURE_FLAG_READ,
      Permission.FEATURE_FLAG_MANAGE,
      Permission.AUDIT_LOG_READ,
      Permission.SECURITY_EVENT_READ,
      Permission.KYC_READ,
      Permission.EXCHANGE_ACCOUNT_READ,
      Permission.STRATEGY_READ,
      Permission.STRATEGY_MANAGE,
      Permission.COPY_SUBSCRIPTION_READ,
      Permission.ORDER_READ,
      Permission.POSITION_READ,
      Permission.PORTFOLIO_READ,
      Permission.REPORT_READ,
      Permission.SUPPORT_TICKET_READ,
      Permission.SUPPORT_TICKET_MANAGE,
      Permission.NOTIFICATION_SEND,

      // Part 5. The tenant administrator is the operator role: it owns the
      // safety controls for its own tenant. It holds ENABLE_LIVE and
      // KILL_SWITCH_OPERATE because someone inside the tenant must be able to
      // stop trading at 3am without a platform escalation. It does NOT hold
      // EXECUTION_SUBMIT - administering a brand is not trading it, and an
      // admin who wants to trade can be granted the TRADER role as well.
      Permission.EXECUTION_READ,
      Permission.EXECUTION_CANCEL,
      Permission.ORDER_EVENT_READ,
      Permission.FILL_READ,
      Permission.BALANCE_READ,
      Permission.BALANCE_REFRESH,
      Permission.EXCHANGE_ACCOUNT_VERIFY,
      Permission.EXCHANGE_ACCOUNT_ROTATE_CREDENTIALS,
      Permission.EXCHANGE_ACCOUNT_ENABLE_LIVE,
      Permission.PRIVATE_STREAM_READ,
      Permission.PRIVATE_STREAM_MANAGE,
      Permission.RECONCILIATION_READ,
      Permission.RECONCILIATION_TRIGGER,
      Permission.RECONCILIATION_RESOLVE,
      Permission.EXECUTION_INCIDENT_READ,
      Permission.EXECUTION_INCIDENT_RESOLVE,
      Permission.KILL_SWITCH_READ,
      Permission.KILL_SWITCH_OPERATE,

      // Part 6. The operator role for the strategy layer too: it can stop
      // anything, resolve incidents and see everything. It can also enable an
      // instance, because an administrator who can arm live trading on an
      // account but cannot start a paper strategy would be an odd shape.
      Permission.STRATEGY_VERSION_READ,
      Permission.STRATEGY_INSTANCE_READ,
      Permission.STRATEGY_INSTANCE_MANAGE,
      Permission.STRATEGY_INSTANCE_ENABLE,
      Permission.STRATEGY_INSTANCE_DISABLE,
      Permission.STRATEGY_INCIDENT_READ,
      Permission.STRATEGY_INCIDENT_RESOLVE,
      Permission.STRATEGY_METRICS_READ,
      Permission.BACKTEST_READ,
      Permission.BACKTEST_SUBMIT,
      Permission.PAPER_SESSION_READ,
      Permission.PAPER_SESSION_OPERATE,
    ],
  },
  {
    key: SystemRole.TRADER,
    name: 'Trader',
    description: 'Publishes strategies that followers can copy.',
    scope: RoleScope.TENANT,
    isSystem: true,
    permissions: TRADER_PERMISSIONS,
  },
  {
    key: SystemRole.FOLLOWER,
    name: 'Follower',
    description: 'Copies traders using their own non-custodial exchange keys.',
    scope: RoleScope.TENANT,
    isSystem: true,
    permissions: FOLLOWER_PERMISSIONS,
  },
  {
    key: SystemRole.SUPPORT,
    name: 'Support Agent',
    description: 'Read-mostly access for customer support operations.',
    scope: RoleScope.TENANT,
    isSystem: true,
    permissions: [
      Permission.USER_READ,
      Permission.USER_READ_SESSIONS,
      Permission.TENANT_READ,
      Permission.SUBSCRIPTION_READ,
      Permission.ORDER_READ,
      Permission.POSITION_READ,
      Permission.PORTFOLIO_READ,
      Permission.COPY_SUBSCRIPTION_READ,
      Permission.SUPPORT_TICKET_READ,
      Permission.SUPPORT_TICKET_MANAGE,
      Permission.AUDIT_LOG_READ,

      // Part 5. Read-only, and not one write anywhere on the money path.
      // Support answers "what happened to my order", which needs the event
      // trail and the incident, and nothing else.
      Permission.ORDER_EVENT_READ,
      Permission.FILL_READ,
      Permission.BALANCE_READ,
      Permission.EXECUTION_READ,
      Permission.PRIVATE_STREAM_READ,
      Permission.RECONCILIATION_READ,
      Permission.EXECUTION_INCIDENT_READ,
      Permission.KILL_SWITCH_READ,

      // Part 6. Read-only, so that support can answer "why did my strategy
      // stop" without being able to start it again.
      Permission.STRATEGY_INSTANCE_READ,
      Permission.STRATEGY_INCIDENT_READ,
      Permission.STRATEGY_METRICS_READ,
      Permission.PAPER_SESSION_READ,
    ],
  },
  {
    key: SystemRole.FINANCE,
    name: 'Finance',
    description: 'Billing, invoicing, payouts and revenue reporting.',
    scope: RoleScope.TENANT,
    isSystem: true,
    permissions: [
      Permission.TENANT_READ,
      Permission.USER_READ,
      Permission.PLAN_READ,
      Permission.SUBSCRIPTION_READ,
      Permission.SUBSCRIPTION_MANAGE,
      Permission.INVOICE_READ,
      Permission.PAYOUT_MANAGE,
      Permission.REPORT_READ,
      Permission.AUDIT_LOG_READ,

      // Part 5. Fee and payout calculations are derived from fills and
      // balances, so finance needs to read them. Nothing else.
      Permission.FILL_READ,
      Permission.BALANCE_READ,
    ],
  },
  {
    key: SystemRole.COMPLIANCE,
    name: 'Compliance Officer',
    description: 'KYC review, audit trail inspection and security oversight.',
    scope: RoleScope.TENANT,
    isSystem: true,
    permissions: [
      Permission.TENANT_READ,
      Permission.USER_READ,
      Permission.USER_SUSPEND,
      Permission.KYC_READ,
      Permission.KYC_REVIEW,
      Permission.AUDIT_LOG_READ,
      Permission.SECURITY_EVENT_READ,
      Permission.REPORT_READ,

      // Part 5. Compliance reads the whole execution audit trail and can
      // engage a kill switch - stopping trading is never the wrong call for a
      // compliance officer to be able to make.
      Permission.ORDER_EVENT_READ,
      Permission.FILL_READ,
      Permission.BALANCE_READ,
      Permission.EXECUTION_READ,
      Permission.RECONCILIATION_READ,
      Permission.EXECUTION_INCIDENT_READ,
      Permission.KILL_SWITCH_READ,
      Permission.KILL_SWITCH_OPERATE,

      // Part 6. Compliance reads the whole strategy trail - what ran, what it
      // was configured with, what it was told about itself - and can stop an
      // instance, which is never the wrong call for a compliance officer to be
      // able to make.
      Permission.STRATEGY_VERSION_READ,
      Permission.STRATEGY_INSTANCE_READ,
      Permission.STRATEGY_INSTANCE_DISABLE,
      Permission.STRATEGY_INCIDENT_READ,
      Permission.STRATEGY_METRICS_READ,
      Permission.BACKTEST_READ,
      Permission.PAPER_SESSION_READ,
    ],
  },
]);

/**
 * Splits `resource:action` and evaluates wildcard matching.
 *
 * Order of checks matters:
 *   1. the global `*` grants everything, including non-wildcard permissions;
 *   2. an exact string match always grants;
 *   3. a `resource:*` wildcard grants every action on that resource EXCEPT
 *      those listed in `NON_WILDCARD_PERMISSIONS`.
 */
export function permissionMatches(granted: string, required: string): boolean {
  if (granted === Permission.ALL) {
    return true;
  }
  if (granted === required) {
    return true;
  }
  const [grantedResource, grantedAction] = granted.split(':');
  const [requiredResource, requiredAction] = required.split(':');
  if (!grantedResource || !requiredResource) {
    return false;
  }
  if (grantedResource !== requiredResource) {
    return false;
  }
  if (grantedAction !== '*' || requiredAction === undefined) {
    return false;
  }
  // A wildcard never reaches a permission that arms live trading, rotates a
  // credential, releases a kill switch or closes a discrepancy.
  return !NON_WILDCARD_PERMISSIONS.has(required);
}

export function hasPermission(grantedPermissions: readonly string[], required: string): boolean {
  return grantedPermissions.some((granted) => permissionMatches(granted, required));
}

export function hasAllPermissions(
  grantedPermissions: readonly string[],
  required: readonly string[],
): boolean {
  return required.every((permission) => hasPermission(grantedPermissions, permission));
}

export function hasAnyPermission(
  grantedPermissions: readonly string[],
  required: readonly string[],
): boolean {
  return required.some((permission) => hasPermission(grantedPermissions, permission));
}

/** Derives resource/action metadata for every declared permission. */
export function describePermissions(): PermissionDefinition[] {
  return Object.values(Permission)
    .filter((value) => value !== Permission.ALL)
    .map((value) => {
      const [resource, action] = value.split(':');
      return {
        key: value,
        resource,
        action,
        description: `Allows the "${action}" action on the "${resource}" resource.`,
        requiresExplicitGrant: NON_WILDCARD_PERMISSIONS.has(value),
      };
    });
}
```

---

## FILE: packages/shared-types/src/audit.ts

```ts
import type { ISODateString, UUID } from './common';

export enum AuditAction {
  // Auth
  USER_REGISTERED = 'USER_REGISTERED',
  USER_LOGIN_SUCCEEDED = 'USER_LOGIN_SUCCEEDED',
  USER_LOGIN_FAILED = 'USER_LOGIN_FAILED',
  USER_LOGGED_OUT = 'USER_LOGGED_OUT',
  TOKEN_REFRESHED = 'TOKEN_REFRESHED',
  TOKEN_REUSE_DETECTED = 'TOKEN_REUSE_DETECTED',
  PASSWORD_CHANGED = 'PASSWORD_CHANGED',
  PASSWORD_RESET_REQUESTED = 'PASSWORD_RESET_REQUESTED',
  PASSWORD_RESET_COMPLETED = 'PASSWORD_RESET_COMPLETED',
  TWO_FACTOR_ENABLED = 'TWO_FACTOR_ENABLED',
  TWO_FACTOR_DISABLED = 'TWO_FACTOR_DISABLED',
  TWO_FACTOR_VERIFIED = 'TWO_FACTOR_VERIFIED',
  TWO_FACTOR_FAILED = 'TWO_FACTOR_FAILED',
  SESSION_REVOKED = 'SESSION_REVOKED',
  ACCOUNT_LOCKED = 'ACCOUNT_LOCKED',
  ACCOUNT_UNLOCKED = 'ACCOUNT_UNLOCKED',

  // Administration
  TENANT_CREATED = 'TENANT_CREATED',
  TENANT_UPDATED = 'TENANT_UPDATED',
  TENANT_SUSPENDED = 'TENANT_SUSPENDED',
  TENANT_DELETED = 'TENANT_DELETED',
  TENANT_BRANDING_UPDATED = 'TENANT_BRANDING_UPDATED',
  TENANT_SETTING_UPDATED = 'TENANT_SETTING_UPDATED',
  TENANT_DOMAIN_ADDED = 'TENANT_DOMAIN_ADDED',
  TENANT_DOMAIN_REMOVED = 'TENANT_DOMAIN_REMOVED',
  USER_CREATED = 'USER_CREATED',
  USER_UPDATED = 'USER_UPDATED',
  USER_DELETED = 'USER_DELETED',
  USER_SUSPENDED = 'USER_SUSPENDED',
  USER_REINSTATED = 'USER_REINSTATED',
  ROLE_CREATED = 'ROLE_CREATED',
  ROLE_UPDATED = 'ROLE_UPDATED',
  ROLE_DELETED = 'ROLE_DELETED',
  ROLE_ASSIGNED = 'ROLE_ASSIGNED',
  ROLE_REVOKED = 'ROLE_REVOKED',
  FEATURE_FLAG_UPDATED = 'FEATURE_FLAG_UPDATED',
  SUBSCRIPTION_CREATED = 'SUBSCRIPTION_CREATED',
  SUBSCRIPTION_UPDATED = 'SUBSCRIPTION_UPDATED',
  SUBSCRIPTION_CANCELED = 'SUBSCRIPTION_CANCELED',
  PLAN_CREATED = 'PLAN_CREATED',
  PLAN_UPDATED = 'PLAN_UPDATED',

  // Trading domain (emitted from Part 2 onwards)
  EXCHANGE_ACCOUNT_LINKED = 'EXCHANGE_ACCOUNT_LINKED',
  EXCHANGE_ACCOUNT_UNLINKED = 'EXCHANGE_ACCOUNT_UNLINKED',
  EXCHANGE_CREDENTIAL_ROTATED = 'EXCHANGE_CREDENTIAL_ROTATED',
  COPY_SUBSCRIPTION_STARTED = 'COPY_SUBSCRIPTION_STARTED',
  COPY_SUBSCRIPTION_STOPPED = 'COPY_SUBSCRIPTION_STOPPED',
  ORDER_SUBMITTED = 'ORDER_SUBMITTED',
  RISK_LIMIT_BREACHED = 'RISK_LIMIT_BREACHED',

  // Authenticated execution (Part 5).
  //
  // Every action here changes what the platform is permitted to do with real
  // money, or closes a question about what already happened to it. They are
  // written with `recordImmediate` rather than buffered: an audit record that
  // is still in a process buffer when the process dies is not an audit record.
  ORDER_CANCEL_REQUESTED = 'ORDER_CANCEL_REQUESTED',
  ORDER_STATE_TRANSITION_REJECTED = 'ORDER_STATE_TRANSITION_REJECTED',
  EXCHANGE_ACCOUNT_ENABLED = 'EXCHANGE_ACCOUNT_ENABLED',
  EXCHANGE_ACCOUNT_DISABLED = 'EXCHANGE_ACCOUNT_DISABLED',
  EXCHANGE_ACCOUNT_VERIFIED = 'EXCHANGE_ACCOUNT_VERIFIED',
  EXCHANGE_ACCOUNT_VERIFICATION_FAILED = 'EXCHANGE_ACCOUNT_VERIFICATION_FAILED',
  LIVE_TRADING_ENABLED = 'LIVE_TRADING_ENABLED',
  LIVE_TRADING_DISABLED = 'LIVE_TRADING_DISABLED',
  PRIVATE_STREAM_ENABLED = 'PRIVATE_STREAM_ENABLED',
  PRIVATE_STREAM_DISABLED = 'PRIVATE_STREAM_DISABLED',
  KILL_SWITCH_ENGAGED = 'KILL_SWITCH_ENGAGED',
  KILL_SWITCH_RELEASED = 'KILL_SWITCH_RELEASED',
  RECONCILIATION_TRIGGERED = 'RECONCILIATION_TRIGGERED',
  RECONCILIATION_DISCREPANCY_RESOLVED = 'RECONCILIATION_DISCREPANCY_RESOLVED',
  EXECUTION_INCIDENT_RAISED = 'EXECUTION_INCIDENT_RAISED',
  EXECUTION_INCIDENT_RESOLVED = 'EXECUTION_INCIDENT_RESOLVED',
  BALANCE_REFRESH_REQUESTED = 'BALANCE_REFRESH_REQUESTED',

  // Strategy layer (Part 6).
  //
  // None of these move money. They are recorded anyway, because "who started
  // this strategy, with what parameters, and when" is the first question asked
  // after a strategy does something surprising, and reconstructing it from
  // application logs afterwards is not an answer.
  STRATEGY_INSTANCE_CREATED = 'STRATEGY_INSTANCE_CREATED',
  STRATEGY_INSTANCE_UPDATED = 'STRATEGY_INSTANCE_UPDATED',
  STRATEGY_INSTANCE_ENABLED = 'STRATEGY_INSTANCE_ENABLED',
  STRATEGY_INSTANCE_DISABLED = 'STRATEGY_INSTANCE_DISABLED',
  STRATEGY_CONFIGURATION_ACTIVATED = 'STRATEGY_CONFIGURATION_ACTIVATED',
  STRATEGY_INSTANCE_QUARANTINED = 'STRATEGY_INSTANCE_QUARANTINED',
  STRATEGY_INCIDENT_RAISED = 'STRATEGY_INCIDENT_RAISED',
  STRATEGY_INCIDENT_RESOLVED = 'STRATEGY_INCIDENT_RESOLVED',
  BACKTEST_SUBMITTED = 'BACKTEST_SUBMITTED',
  BACKTEST_CANCELLED = 'BACKTEST_CANCELLED',
  PAPER_SESSION_STARTED = 'PAPER_SESSION_STARTED',
  PAPER_SESSION_STOPPED = 'PAPER_SESSION_STOPPED',
}

export enum AuditActorType {
  USER = 'USER',
  SYSTEM = 'SYSTEM',
  SERVICE = 'SERVICE',
  API_KEY = 'API_KEY',
}

export enum AuditOutcome {
  SUCCESS = 'SUCCESS',
  FAILURE = 'FAILURE',
  DENIED = 'DENIED',
}

export interface AuditLogDto {
  id: UUID;
  tenantId: UUID | null;
  actorType: AuditActorType;
  actorId: UUID | null;
  actorEmail: string | null;
  action: AuditAction | string;
  outcome: AuditOutcome;
  resourceType: string | null;
  resourceId: string | null;
  description: string | null;
  changes: Record<string, { before: unknown; after: unknown }> | null;
  metadata: Record<string, unknown> | null;
  ipHash: string | null;
  userAgent: string | null;
  requestId: string | null;
  createdAt: ISODateString;
}

export enum SecurityEventType {
  SUSPICIOUS_LOGIN = 'SUSPICIOUS_LOGIN',
  NEW_DEVICE_LOGIN = 'NEW_DEVICE_LOGIN',
  IMPOSSIBLE_TRAVEL = 'IMPOSSIBLE_TRAVEL',
  BRUTE_FORCE_SUSPECTED = 'BRUTE_FORCE_SUSPECTED',
  CREDENTIAL_STUFFING_SUSPECTED = 'CREDENTIAL_STUFFING_SUSPECTED',
  TOKEN_REUSE = 'TOKEN_REUSE',
  RATE_LIMIT_ABUSE = 'RATE_LIMIT_ABUSE',
  PERMISSION_ESCALATION_ATTEMPT = 'PERMISSION_ESCALATION_ATTEMPT',
  TENANT_ISOLATION_VIOLATION = 'TENANT_ISOLATION_VIOLATION',
  ENCRYPTION_FAILURE = 'ENCRYPTION_FAILURE',
}

export enum SecuritySeverity {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
}

export interface SecurityEventDto {
  id: UUID;
  tenantId: UUID | null;
  userId: UUID | null;
  type: SecurityEventType;
  severity: SecuritySeverity;
  description: string;
  metadata: Record<string, unknown> | null;
  ipHash: string | null;
  resolved: boolean;
  resolvedAt: ISODateString | null;
  createdAt: ISODateString;
}
```

---

## FILE: packages/config/src/constants.ts

```ts
/** Platform-wide constants shared by every Node/TypeScript workload. */

export const HEADER_REQUEST_ID = 'x-request-id';
export const HEADER_TENANT_SLUG = 'x-tenant-slug';
export const HEADER_TENANT_ID = 'x-tenant-id';
export const HEADER_API_VERSION = 'x-api-version';
export const HEADER_TWO_FACTOR_TOKEN = 'x-2fa-token';
export const HEADER_DEVICE_ID = 'x-device-id';
export const HEADER_INTERNAL_TOKEN = 'x-internal-token';
export const HEADER_IDEMPOTENCY_KEY = 'idempotency-key';

export const CACHE_TTL = {
  TENANT_RESOLUTION_SECONDS: 300,
  TENANT_PUBLIC_CONFIG_SECONDS: 120,
  USER_PERMISSIONS_SECONDS: 300,
  FEATURE_FLAGS_SECONDS: 60,
  PLAN_CATALOG_SECONDS: 600,
} as const;

export const CACHE_KEY = {
  tenantBySlug: (slug: string): string => `tenant:slug:${slug}`,
  tenantByDomain: (domain: string): string => `tenant:domain:${domain}`,
  tenantById: (id: string): string => `tenant:id:${id}`,
  tenantPublicConfig: (id: string): string => `tenant:${id}:public-config`,
  tenantFeatureFlags: (id: string): string => `tenant:${id}:feature-flags`,
  userPermissions: (userId: string): string => `user:${userId}:permissions`,
  userSessionVersion: (userId: string): string => `user:${userId}:session-version`,
  loginFailures: (tenantId: string, email: string): string =>
    `auth:failures:${tenantId}:${email.toLowerCase()}`,
  accountLock: (tenantId: string, email: string): string =>
    `auth:lock:${tenantId}:${email.toLowerCase()}`,
  revokedToken: (jti: string): string => `auth:revoked:${jti}`,
  idempotency: (tenantId: string, key: string): string => `idem:${tenantId}:${key}`,
} as const;

export const QUEUE_NAMES = {
  AUDIT: 'audit',
  EMAIL: 'email',
  NOTIFICATION: 'notification',
  SECURITY: 'security',
  MAINTENANCE: 'maintenance',
  BILLING: 'billing',
  // Registered now, consumed by the trading engine from Part 3.
  TRADE_SIGNAL: 'trade-signal',
  TRADE_EXECUTION: 'trade-execution',
  MARKET_SNAPSHOT: 'market-snapshot',
  /// Strategy lifecycle, backtests and paper sessions (Part 6). A separate
  /// queue from TRADE_EXECUTION on purpose: a backlog of backtests must never
  /// delay a cancel request.
  STRATEGY_CONTROL: 'strategy-control',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

export const JOB_NAMES = {
  WRITE_AUDIT_LOG: 'write-audit-log',
  SEND_EMAIL: 'send-email',
  DISPATCH_NOTIFICATION: 'dispatch-notification',
  EVALUATE_SECURITY_EVENT: 'evaluate-security-event',
  PRUNE_EXPIRED_TOKENS: 'prune-expired-tokens',
  PRUNE_AUDIT_LOGS: 'prune-audit-logs',
  RECONCILE_SUBSCRIPTIONS: 'reconcile-subscriptions',

  // Authenticated execution (Part 5). Produced by the API, consumed by the
  // trading worker - the only process that holds venue credentials. The API
  // deliberately cannot perform these itself: it has no signing code and no
  // access to key material, which is what keeps the credential boundary a
  // process boundary rather than a code-review convention.
  VERIFY_EXCHANGE_CREDENTIALS: 'verify-exchange-credentials',
  REFRESH_ACCOUNT_BALANCES: 'refresh-account-balances',
  RECONCILE_TRADING_ACCOUNT: 'reconcile-trading-account',
  RESYNC_PRIVATE_STREAM: 'resync-private-stream',
  CANCEL_ORDER: 'cancel-order',

  // Strategy layer (Part 6). Produced by the API, consumed by the strategy
  // worker. None of them can place a live order: the strategy worker holds no
  // credential and the backtest and paper paths have no adapter that could
  // reach a venue.
  APPLY_STRATEGY_STATE: 'apply-strategy-state',
  RUN_BACKTEST: 'run-backtest',
  START_PAPER_SESSION: 'start-paper-session',
  STOP_PAPER_SESSION: 'stop-paper-session',
  CHECKPOINT_STRATEGY_STATE: 'checkpoint-strategy-state',
} as const;

export const PAGINATION_DEFAULTS = {
  PAGE: 1,
  LIMIT: 20,
  MAX_LIMIT: 100,
} as const;

/** Fields scrubbed from every structured log line and audit payload. */
export const SENSITIVE_FIELD_NAMES: readonly string[] = Object.freeze([
  'password',
  'passwordHash',
  'currentPassword',
  'newPassword',
  'confirmPassword',
  'token',
  'accessToken',
  'refreshToken',
  'challengeToken',
  'idToken',
  'authorization',
  'cookie',
  'setCookie',
  'apiKey',
  'apiSecret',
  'secret',
  'secretKey',
  'privateKey',
  'passphrase',
  'mnemonic',
  'seedPhrase',
  'twoFactorSecret',
  'totpSecret',
  'recoveryCodes',
  'encryptionKey',
  'dek',
  'kek',
  'cardNumber',
  'cvv',
  'iban',
  'ssn',
  'clientSecret',
  'webhookSecret',
]);

export const REDACTED_PLACEHOLDER = '[REDACTED]';

export const SUPPORTED_LOCALES = ['en', 'es', 'ar', 'bn', 'tr'] as const;
export const RTL_LOCALES = ['ar'] as const;
export const SUPPORTED_CURRENCIES = ['USD', 'EUR', 'GBP', 'AED', 'BDT', 'TRY'] as const;

export const FEATURE_FLAG_KEYS = {
  COPY_TRADING: 'copy_trading',
  FUTURES_TRADING: 'futures_trading',
  SPOT_TRADING: 'spot_trading',
  PAPER_TRADING: 'paper_trading',
  REFERRAL_PROGRAM: 'referral_program',
  KYC_REQUIRED: 'kyc_required',
  TWO_FACTOR_MANDATORY: 'two_factor_mandatory',
  PUBLIC_REGISTRATION: 'public_registration',
  CUSTOM_DOMAIN: 'custom_domain',
  MOBILE_APP: 'mobile_app',
  ADVANCED_ANALYTICS: 'advanced_analytics',
  WITHDRAWAL_NOTIFICATIONS: 'withdrawal_notifications',
} as const;
```

---

## FILE: apps/admin-web/src/components/sidebar.tsx

```tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { theme } from '@/lib/theme';

export interface NavItem {
  href: string;
  label: string;
  /** Permission required to see the entry. Empty means always visible. */
  permission?: string;
  platformOnly?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { href: '/dashboard', label: 'Overview' },
  { href: '/tenants', label: 'Organisations', permission: 'tenant:read', platformOnly: true },
  { href: '/users', label: 'Users', permission: 'user:read' },
  { href: '/roles', label: 'Roles & permissions', permission: 'role:read' },
  { href: '/strategies', label: 'Strategies', permission: 'strategy_instance:read' },
  { href: '/branding', label: 'Branding', permission: 'tenant:read' },
  { href: '/subscription', label: 'Subscription', permission: 'billing:read' },
  { href: '/audit-logs', label: 'Audit log', permission: 'audit:read' },
  { href: '/settings', label: 'Settings', permission: 'tenant:read' },
];

/**
 * Navigation is filtered by the permissions embedded in the session.
 *
 * This is a usability filter only - hiding a link is not access control. Every
 * route also re-checks authorisation server-side, and the API is the final
 * authority on every request.
 */
export function Sidebar({
  permissions,
  isPlatformUser,
}: {
  permissions: string[];
  isPlatformUser: boolean;
}): JSX.Element {
  const pathname = usePathname();
  const permissionSet = new Set(permissions);

  const visible = NAV_ITEMS.filter((item) => {
    if (item.platformOnly && !isPlatformUser) {
      return false;
    }
    if (!item.permission) {
      return true;
    }
    if (permissionSet.has('*')) {
      return true;
    }

    const [resource] = item.permission.split(':');
    return permissionSet.has(item.permission) || permissionSet.has(`${resource}:*`);
  });

  return (
    <nav
      aria-label="Primary"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        padding: theme.space(3),
      }}
    >
      {visible.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);

        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            style={{
              display: 'block',
              padding: '9px 12px',
              borderRadius: theme.radius.sm,
              fontSize: 14,
              fontWeight: active ? 600 : 500,
              color: active ? theme.color.text : theme.color.textMuted,
              background: active ? theme.color.surfaceRaised : 'transparent',
              textDecoration: 'none',
            }}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
```

---

## FILE: apps/mobile/lib/core/network/api_endpoints.dart

```dart
/// Endpoint paths, relative to the versioned API base.
///
/// Centralised so a route rename is a one-line change and so no string literal
/// URL is scattered through the feature layer.
class ApiEndpoints {
  const ApiEndpoints._();

  static const String login = '/auth/login';
  static const String register = '/auth/register';
  static const String verifyTwoFactor = '/auth/two-factor/verify';
  static const String refresh = '/auth/refresh';
  static const String logout = '/auth/logout';
  static const String changePassword = '/auth/change-password';
  static const String me = '/auth/me';

  static const String sessions = '/auth/sessions';
  static String session(String id) => '/auth/sessions/$id';

  static const String twoFactorSetup = '/auth/two-factor/setup';
  static const String twoFactorEnable = '/auth/two-factor/enable';
  static const String twoFactorDisable = '/auth/two-factor/disable';

  static const String currentUser = '/users/me';
  static const String tenantPublicConfig = '/tenants/public-config';
  static const String featureFlags = '/feature-flags/resolved';

  /// Strategy layer. Read-only from mobile: the client is granted no
  /// permission that would let it enable an instance or start a session, and
  /// no write path is declared here.
  static const String strategyMetrics = '/strategies/metrics';
  static const String strategyInstances = '/strategies/instances';
  static const String strategyIncidents = '/strategies/incidents';
  static const String backtests = '/strategies/backtests';
  static const String paperSessions = '/strategies/paper-sessions';

  static const String notifications = '/notifications';
  static const String notificationUnreadCount = '/notifications/unread-count';
  static const String notificationPreferences = '/notifications/preferences';
  static String markNotificationRead(String id) => '/notifications/$id/read';
}
```

---

## FILE: apps/mobile/lib/core/router/route_paths.dart

```dart
/// Every navigable location in the app.
///
/// Declared as constants so a typo is a compile error rather than a blank
/// screen at runtime.
class RoutePaths {
  const RoutePaths._();

  static const String splash = '/';
  static const String login = '/login';
  static const String twoFactor = '/login/two-factor';
  static const String home = '/home';
  static const String strategies = '/strategies';
  static const String settings = '/settings';
  static const String security = '/settings/security';
}

class RouteNames {
  const RouteNames._();

  static const String splash = 'splash';
  static const String login = 'login';
  static const String twoFactor = 'twoFactor';
  static const String home = 'home';
  static const String strategies = 'strategies';
  static const String settings = 'settings';
  static const String security = 'security';
}
```

---

## FILE: apps/mobile/lib/core/router/app_router.dart

```dart
import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../features/auth/presentation/auth_state.dart';
import '../../features/auth/presentation/login_screen.dart';
import '../../features/auth/presentation/two_factor_screen.dart';
import '../../features/home/home_screen.dart';
import '../../features/settings/security_screen.dart';
import '../../features/settings/settings_screen.dart';
import '../../features/splash/splash_screen.dart';
import '../../features/strategies/presentation/strategies_screen.dart';
import '../di/providers.dart';
import 'route_paths.dart';

/// Bridges a Riverpod provider to go_router's [Listenable] refresh mechanism.
class _AuthRefreshNotifier extends ChangeNotifier {
  _AuthRefreshNotifier(this._ref) {
    _subscription = _ref.listen<AuthState>(
      authControllerProvider,
      (AuthState? previous, AuthState next) {
        if (previous?.status != next.status) {
          notifyListeners();
        }
      },
    );
  }

  final Ref _ref;
  late final ProviderSubscription<AuthState> _subscription;

  @override
  void dispose() {
    _subscription.close();
    super.dispose();
  }
}

/// The application router.
///
/// Redirection is centralised here rather than scattered across screens: a
/// single rule set means there is no window where an unauthenticated user can
/// see an authenticated screen, however they arrived at the route.
final Provider<GoRouter> routerProvider = Provider<GoRouter>((Ref ref) {
  final _AuthRefreshNotifier refresh = _AuthRefreshNotifier(ref);
  ref.onDispose(refresh.dispose);

  return GoRouter(
    initialLocation: RoutePaths.splash,
    refreshListenable: refresh,
    redirect: (BuildContext context, GoRouterState state) {
      final AuthState auth = ref.read(authControllerProvider);
      final String location = state.matchedLocation;

      if (auth.status == AuthStatus.initialising) {
        return location == RoutePaths.splash ? null : RoutePaths.splash;
      }

      final bool onAuthRoute =
          location == RoutePaths.login || location == RoutePaths.twoFactor;

      if (auth.status == AuthStatus.awaitingTwoFactor) {
        return location == RoutePaths.twoFactor ? null : RoutePaths.twoFactor;
      }

      if (auth.status == AuthStatus.unauthenticated) {
        return onAuthRoute ? null : RoutePaths.login;
      }

      // Authenticated: keep the user out of the sign-in flow and off the splash.
      if (onAuthRoute || location == RoutePaths.splash) {
        return RoutePaths.home;
      }

      return null;
    },
    routes: <RouteBase>[
      GoRoute(
        path: RoutePaths.splash,
        name: RouteNames.splash,
        builder: (BuildContext context, GoRouterState state) => const SplashScreen(),
      ),
      GoRoute(
        path: RoutePaths.login,
        name: RouteNames.login,
        builder: (BuildContext context, GoRouterState state) => const LoginScreen(),
      ),
      GoRoute(
        path: RoutePaths.twoFactor,
        name: RouteNames.twoFactor,
        builder: (BuildContext context, GoRouterState state) => const TwoFactorScreen(),
      ),
      GoRoute(
        path: RoutePaths.home,
        name: RouteNames.home,
        builder: (BuildContext context, GoRouterState state) => const HomeScreen(),
      ),
      GoRoute(
        path: RoutePaths.strategies,
        name: RouteNames.strategies,
        builder: (BuildContext context, GoRouterState state) => const StrategiesScreen(),
      ),
      GoRoute(
        path: RoutePaths.settings,
        name: RouteNames.settings,
        builder: (BuildContext context, GoRouterState state) => const SettingsScreen(),
        routes: <RouteBase>[
          GoRoute(
            path: 'security',
            name: RouteNames.security,
            builder: (BuildContext context, GoRouterState state) => const SecurityScreen(),
          ),
        ],
      ),
    ],
    errorBuilder: (BuildContext context, GoRouterState state) => const _RouteNotFoundScreen(),
  );
});

class _RouteNotFoundScreen extends StatelessWidget {
  const _RouteNotFoundScreen();

  @override
  Widget build(BuildContext context) {
    return const Center(
      child: Text('This screen is not available.'),
    );
  }
}
```

---

## FILE: apps/mobile/lib/core/di/providers.dart

```dart
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../features/auth/data/auth_repository.dart';
import '../../features/auth/presentation/auth_controller.dart';
import '../../features/auth/presentation/auth_state.dart';
import '../../features/strategies/data/strategy_repository.dart';
import '../../features/strategies/presentation/strategy_controller.dart';
import '../../features/strategies/presentation/strategy_state.dart';
import '../config/app_config.dart';
import '../logging/app_logger.dart';
import '../network/api_client.dart';
import '../network/auth_interceptor.dart';
import '../storage/device_identity.dart';
import '../storage/secure_storage.dart';
import '../storage/token_storage.dart';

/// Composition root.
///
/// Riverpod is used for dependency injection as well as state so there is one
/// object graph, one override point for tests, and no service locator holding
/// global mutable state.

final Provider<AppConfig> appConfigProvider = Provider<AppConfig>((Ref ref) {
  return AppConfig.fromEnvironment();
});

final Provider<AppLogger> appLoggerProvider = Provider<AppLogger>((Ref ref) {
  return AppLogger(ref.watch(appConfigProvider).environment);
});

final Provider<SecureStorage> secureStorageProvider = Provider<SecureStorage>((Ref ref) {
  return SecureStorage();
});

final Provider<TokenStorage> tokenStorageProvider = Provider<TokenStorage>((Ref ref) {
  return TokenStorage(ref.watch(secureStorageProvider));
});

final Provider<DeviceIdentity> deviceIdentityProvider = Provider<DeviceIdentity>((Ref ref) {
  return DeviceIdentity(ref.watch(secureStorageProvider));
});

final Provider<AuthInterceptor> authInterceptorProvider = Provider<AuthInterceptor>((Ref ref) {
  return AuthInterceptor(
    config: ref.watch(appConfigProvider),
    tokenStorage: ref.watch(tokenStorageProvider),
    deviceIdentity: ref.watch(deviceIdentityProvider),
    logger: ref.watch(appLoggerProvider),
    onSessionExpired: () async {
      // `read`, not `watch`: this callback fires from the network layer and
      // must not create a dependency cycle with the controller.
      ref.read(authControllerProvider.notifier).onSessionExpired();
    },
  );
});

final Provider<ApiClient> apiClientProvider = Provider<ApiClient>((Ref ref) {
  return ApiClient(
    config: ref.watch(appConfigProvider),
    authInterceptor: ref.watch(authInterceptorProvider),
    logger: ref.watch(appLoggerProvider),
  );
});

final Provider<AuthRepository> authRepositoryProvider = Provider<AuthRepository>((Ref ref) {
  return AuthRepository(
    apiClient: ref.watch(apiClientProvider),
    tokenStorage: ref.watch(tokenStorageProvider),
    deviceIdentity: ref.watch(deviceIdentityProvider),
    logger: ref.watch(appLoggerProvider),
  );
});

final StateNotifierProvider<AuthController, AuthState> authControllerProvider =
    StateNotifierProvider<AuthController, AuthState>((Ref ref) {
  return AuthController(
    repository: ref.watch(authRepositoryProvider),
    logger: ref.watch(appLoggerProvider),
  );
});

/// Read-only strategy repository.
///
/// Registered alongside the auth graph so the screen has a single override
/// point in tests. It holds no credentials and performs no writes.
final Provider<StrategyRepository> strategyRepositoryProvider =
    Provider<StrategyRepository>((Ref ref) {
  return StrategyRepository(
    apiClient: ref.watch(apiClientProvider),
    logger: ref.watch(appLoggerProvider),
  );
});

final StateNotifierProvider<StrategyController, StrategyViewState> strategyControllerProvider =
    StateNotifierProvider<StrategyController, StrategyViewState>((Ref ref) {
  return StrategyController(
    repository: ref.watch(strategyRepositoryProvider),
    logger: ref.watch(appLoggerProvider),
  );
});
```

---

## FILE: apps/mobile/lib/features/home/home_screen.dart

```dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/di/providers.dart';
import '../../core/router/route_paths.dart';
import '../../l10n/app_localizations.dart';
import '../auth/domain/auth_models.dart';
import '../auth/presentation/auth_state.dart';

/// Authenticated landing screen.
///
/// Part 1 deliberately shows account state rather than trading data: there is
/// no trading data yet, and inventing some would be worse than showing none.
class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final AuthState state = ref.watch(authControllerProvider);
    final AuthUser? user = state.user;

    return Scaffold(
      appBar: AppBar(
        title: Text(l10n.homeTitle),
        actions: <Widget>[
          IconButton(
            icon: const Icon(Icons.settings_outlined),
            onPressed: () => context.push(RoutePaths.settings),
            tooltip: l10n.settingsTitle,
          ),
        ],
      ),
      body: user == null
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.all(20),
              children: <Widget>[
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(18),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        Text(l10n.welcomeBack, style: Theme.of(context).textTheme.labelMedium),
                        const SizedBox(height: 6),
                        Text(
                          user.displayName ?? user.email,
                          style: Theme.of(context)
                              .textTheme
                              .titleLarge
                              ?.copyWith(fontWeight: FontWeight.w700),
                        ),
                        const SizedBox(height: 12),
                        Wrap(
                          spacing: 8,
                          runSpacing: 8,
                          children: <Widget>[
                            for (final String role in user.roles) Chip(label: Text(role)),
                          ],
                        ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 16),
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(18),
                    child: Row(
                      children: <Widget>[
                        Icon(
                          user.twoFactorEnabled ? Icons.verified_user : Icons.gpp_maybe,
                          color: user.twoFactorEnabled
                              ? Theme.of(context).colorScheme.primary
                              : Theme.of(context).colorScheme.error,
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Text(
                            user.twoFactorEnabled
                                ? l10n.twoFactorEnabled
                                : l10n.twoFactorDisabled,
                          ),
                        ),
                        TextButton(
                          onPressed: () => context.push(RoutePaths.security),
                          child: Text(l10n.securityTitle),
                        ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 16),
                // Shown only to users the API would actually answer. Hiding
                // the tile is a usability filter, not access control: the
                // endpoint re-checks the permission on every request.
                if (user.can('strategy_instance:read'))
                  Card(
                    child: ListTile(
                      leading: const Icon(Icons.insights_outlined),
                      title: Text(l10n.strategiesTitle),
                      subtitle: Text(l10n.strategiesSubtitle),
                      trailing: const Icon(Icons.chevron_right),
                      onTap: () => context.push(RoutePaths.strategies),
                    ),
                  ),
                if (user.can('strategy_instance:read')) const SizedBox(height: 16),
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(18),
                    child: Row(
                      children: <Widget>[
                        const Icon(Icons.info_outline),
                        const SizedBox(width: 12),
                        Expanded(child: Text(l10n.executionDisabledNotice)),
                      ],
                    ),
                  ),
                ),
              ],
            ),
    );
  }
}
```

---

## FILE: apps/mobile/lib/app.dart

```dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'core/router/app_router.dart';
import 'core/theme/app_theme.dart';
import 'core/theme/brand_tokens.dart';
import 'core/theme/branding_controller.dart';
import 'l10n/app_localizations.dart';

/// Root widget.
///
/// Theme and locale both come from providers so a branding refresh or a locale
/// change re-themes the whole app without a restart.
class WlctApp extends ConsumerWidget {
  const WlctApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final GoRouter router = ref.watch(routerProvider);
    final BrandTokens tokens = ref.watch(brandingProvider);

    return MaterialApp.router(
      title: tokens.appName,
      debugShowCheckedModeBanner: false,
      routerConfig: router,
      theme: AppTheme.light(tokens),
      darkTheme: AppTheme.dark(tokens),
      themeMode: tokens.themeMode,
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
      localeResolutionCallback: (Locale? locale, Iterable<Locale> supported) {
        if (locale == null) {
          return supported.first;
        }

        for (final Locale candidate in supported) {
          if (candidate.languageCode == locale.languageCode) {
            return candidate;
          }
        }

        return supported.first;
      },
    );
  }
}
```

---

## FILE: apps/mobile/lib/core/error/error_mapper.dart

```dart
import 'dart:io';

import 'package:dio/dio.dart';

import 'app_exception.dart';

/// Translates transport failures into [AppException].
///
/// Every message produced here is written for a user, not a developer. The
/// original exception is deliberately dropped rather than interpolated: Dio
/// error strings embed the full request URL and sometimes headers.
class ErrorMapper {
  const ErrorMapper();

  AppException fromDioException(DioException exception) {
    switch (exception.type) {
      case DioExceptionType.connectionTimeout:
      case DioExceptionType.sendTimeout:
      case DioExceptionType.receiveTimeout:
      case DioExceptionType.transformTimeout:
        return const AppException(
          code: AppErrorCode.timeout,
          message: 'The server took too long to respond. Please try again.',
        );
      case DioExceptionType.connectionError:
        return const AppException(
          code: AppErrorCode.network,
          message: 'No connection. Check your network and try again.',
        );
      case DioExceptionType.cancel:
        return const AppException(
          code: AppErrorCode.unknown,
          message: 'The request was cancelled.',
        );
      case DioExceptionType.badCertificate:
        return const AppException(
          code: AppErrorCode.network,
          message: 'The connection is not secure and was blocked.',
        );
      case DioExceptionType.badResponse:
        return _fromResponse(exception.response);
      case DioExceptionType.unknown:
        if (exception.error is SocketException) {
          return const AppException(
            code: AppErrorCode.network,
            message: 'No connection. Check your network and try again.',
          );
        }
        return const AppException(
          code: AppErrorCode.unknown,
          message: 'Something went wrong. Please try again.',
        );
    }
  }

  AppException _fromResponse(Response<dynamic>? response) {
    final int? statusCode = response?.statusCode;
    final dynamic data = response?.data;

    if (data is Map) {
      final Object? errorNode = data['error'];

      if (errorNode is Map) {
        final String? code = _asString(errorNode['code']);
        final String message =
            _asString(errorNode['message']) ?? _defaultMessageFor(statusCode);

        return AppException(
          code: AppErrorCode.fromApiCode(code, statusCode),
          message: message,
          statusCode: statusCode,
          requestId: _asString(errorNode['requestId']),
          fieldErrors: _parseFieldErrors(errorNode['details']),
        );
      }
    }

    return AppException(
      code: AppErrorCode.fromApiCode(null, statusCode),
      message: _defaultMessageFor(statusCode),
      statusCode: statusCode,
    );
  }

  List<FieldError> _parseFieldErrors(Object? details) {
    if (details is! List) {
      return const <FieldError>[];
    }

    final List<FieldError> errors = <FieldError>[];

    for (final Object? entry in details) {
      if (entry is Map) {
        final String? field = _asString(entry['field']);
        final String? message = _asString(entry['message']);
        if (field != null && message != null) {
          errors.add(FieldError(field: field, message: message));
        }
      }
    }

    return errors;
  }

  String? _asString(Object? value) => value is String ? value : null;

  String _defaultMessageFor(int? statusCode) {
    if (statusCode == null) {
      return 'Something went wrong. Please try again.';
    }
    if (statusCode == 401) {
      return 'Your session has expired. Please sign in again.';
    }
    if (statusCode == 403) {
      return 'You do not have permission to do that.';
    }
    if (statusCode == 404) {
      return 'That item could not be found.';
    }
    if (statusCode == 429) {
      return 'Too many attempts. Please wait a moment and try again.';
    }
    if (statusCode >= 500) {
      return 'The service is temporarily unavailable. Please try again shortly.';
    }
    return 'Something went wrong. Please try again.';
  }
}
```

---

## FILE: apps/mobile/lib/l10n/app_en.arb

```json
{
  "@@locale": "en",
  "appTitle": "Copy Trading",
  "signIn": "Sign in",
  "signOut": "Sign out",
  "emailLabel": "Email",
  "passwordLabel": "Password",
  "signInSubtitle": "Sign in to your account to continue.",
  "twoFactorTitle": "Two-factor authentication",
  "twoFactorSubtitle": "Enter the six-digit code from your authenticator app.",
  "twoFactorCodeLabel": "Authentication code",
  "recoveryCodeLabel": "Recovery code",
  "useRecoveryCode": "Use a recovery code instead",
  "useAuthenticator": "Use my authenticator app instead",
  "verify": "Verify",
  "cancel": "Cancel",
  "homeTitle": "Overview",
  "settingsTitle": "Settings",
  "securityTitle": "Security",
  "loading": "Loading",
  "emailRequired": "Enter your email address",
  "emailInvalid": "Enter a valid email address",
  "passwordRequired": "Enter your password",
  "codeRequired": "Enter your authentication code",
  "genericError": "Something went wrong. Please try again.",
  "sessionExpired": "Your session has expired. Please sign in again.",
  "welcomeBack": "Welcome back",
  "accountSection": "Account",
  "securitySection": "Security",
  "twoFactorEnabled": "Two-factor authentication is on",
  "twoFactorDisabled": "Two-factor authentication is off",
  "activeSessions": "Active devices",
  "changePassword": "Change password",
  "executionDisabledNotice": "Live order execution is disabled on this build.",
  "strategiesTitle": "Strategies",
  "strategiesSubtitle": "View strategy health and simulated results.",
  "strategyReadOnlyNotice": "This screen is read-only. Strategies are started, stopped and configured from the admin console.",
  "strategyPanelsDegraded": "Some panels could not be loaded. Pull down to try again.",
  "liveExecutionReachable": "Live execution is reachable in this deployment",
  "liveExecutionNotReachable": "Live execution is not reachable in this deployment",
  "strategyEngineLabel": "Strategy engine",
  "paperTradingLabel": "Paper trading",
  "backtestingLabel": "Backtesting",
  "tradingModeLabel": "Mode",
  "strategyInstancesSection": "Instances",
  "paperSessionsSection": "Paper sessions",
  "backtestsSection": "Backtests",
  "strategyNoInstances": "No strategy instances have been created.",
  "strategyNoPaperSessions": "No paper sessions have been run.",
  "strategyNoBacktests": "No backtests have been run.",
  "instancesLabel": "Instances",
  "runningLabel": "Running",
  "needsAttentionLabel": "Needs attention",
  "openIncidentsLabel": "Open incidents",
  "enabledLabel": "Enabled",
  "disabledLabel": "Disabled",
  "consecutiveErrorsLabel": "Consecutive errors",
  "lastHeartbeatLabel": "Last heartbeat",
  "noHeartbeatYet": "No heartbeat reported yet",
  "statusLabel": "Status",
  "equityLabel": "Equity",
  "realisedPnlLabel": "Realised PnL",
  "netPnlLabel": "Net PnL",
  "tradesLabel": "Trades",
  "winRateLabel": "Win rate",
  "sharpeLabel": "Sharpe",
  "maxDrawdownLabel": "Max drawdown",
  "simulatedFillsLabel": "Orders / fills",
  "riskRejectionsLabel": "Risk rejections",
  "simulatedBadge": "SIMULATED",
  "insufficientData": "Insufficient data",
  "notAvailableShort": "N/A",
  "statusQueued": "Queued",
  "statusRunning": "Running",
  "statusCompleted": "Completed",
  "statusStopped": "Stopped",
  "statusFailed": "Failed",
  "statusCancelled": "Cancelled",
  "backtestNotReproducible": "This run has no dataset checksum and cannot be reproduced exactly.",
  "simulationDisclaimerTitle": "About these numbers",
  "backtestDisclaimer": "Backtest performance is not indicative of future performance.",
  "paperDisclaimer": "Paper performance is not indicative of live performance.",
  "executionQualityDisclaimer": "Simulation does not guarantee real execution quality.",
  "insufficientDataDisclaimer": "Risk-adjusted figures are withheld when there were too few observations. Insufficient data is not zero.",
  "retry": "Try again"
}
```

---

## FILE: apps/mobile/lib/l10n/app_bn.arb

```json
{
  "@@locale": "bn",
  "appTitle": "কপি ট্রেডিং",
  "signIn": "সাইন ইন",
  "signOut": "সাইন আউট",
  "emailLabel": "ইমেইল",
  "passwordLabel": "পাসওয়ার্ড",
  "signInSubtitle": "চালিয়ে যেতে আপনার অ্যাকাউন্টে সাইন ইন করুন।",
  "twoFactorTitle": "দুই-ধাপ যাচাইকরণ",
  "twoFactorSubtitle": "আপনার অথেন্টিকেটর অ্যাপ থেকে ছয় সংখ্যার কোডটি লিখুন।",
  "twoFactorCodeLabel": "যাচাইকরণ কোড",
  "recoveryCodeLabel": "রিকভারি কোড",
  "useRecoveryCode": "পরিবর্তে রিকভারি কোড ব্যবহার করুন",
  "useAuthenticator": "পরিবর্তে অথেন্টিকেটর অ্যাপ ব্যবহার করুন",
  "verify": "যাচাই করুন",
  "cancel": "বাতিল",
  "homeTitle": "সারসংক্ষেপ",
  "settingsTitle": "সেটিংস",
  "securityTitle": "নিরাপত্তা",
  "loading": "লোড হচ্ছে",
  "emailRequired": "আপনার ইমেইল ঠিকানা লিখুন",
  "emailInvalid": "একটি সঠিক ইমেইল ঠিকানা লিখুন",
  "passwordRequired": "আপনার পাসওয়ার্ড লিখুন",
  "codeRequired": "আপনার যাচাইকরণ কোড লিখুন",
  "genericError": "কিছু একটা সমস্যা হয়েছে। আবার চেষ্টা করুন।",
  "sessionExpired": "আপনার সেশনের মেয়াদ শেষ হয়েছে। আবার সাইন ইন করুন।",
  "welcomeBack": "স্বাগতম",
  "accountSection": "অ্যাকাউন্ট",
  "securitySection": "নিরাপত্তা",
  "twoFactorEnabled": "দুই-ধাপ যাচাইকরণ চালু আছে",
  "twoFactorDisabled": "দুই-ধাপ যাচাইকরণ বন্ধ আছে",
  "activeSessions": "সক্রিয় ডিভাইস",
  "changePassword": "পাসওয়ার্ড পরিবর্তন করুন",
  "executionDisabledNotice": "এই বিল্ডে লাইভ অর্ডার এক্সিকিউশন বন্ধ রাখা হয়েছে।",
  "strategiesTitle": "স্ট্র্যাটেজি",
  "strategiesSubtitle": "স্ট্র্যাটেজির স্বাস্থ্য ও সিমুলেটেড ফলাফল দেখুন।",
  "strategyReadOnlyNotice": "এই স্ক্রিনটি শুধু দেখার জন্য। স্ট্র্যাটেজি চালু, বন্ধ ও কনফিগার করা হয় অ্যাডমিন কনসোল থেকে।",
  "strategyPanelsDegraded": "কিছু অংশ লোড করা যায়নি। আবার চেষ্টা করতে নিচে টানুন।",
  "liveExecutionReachable": "এই ডিপ্লয়মেন্টে লাইভ এক্সিকিউশনে পৌঁছানো সম্ভব",
  "liveExecutionNotReachable": "এই ডিপ্লয়মেন্টে লাইভ এক্সিকিউশনে পৌঁছানো সম্ভব নয়",
  "strategyEngineLabel": "স্ট্র্যাটেজি ইঞ্জিন",
  "paperTradingLabel": "পেপার ট্রেডিং",
  "backtestingLabel": "ব্যাকটেস্টিং",
  "tradingModeLabel": "মোড",
  "strategyInstancesSection": "ইনস্ট্যান্স",
  "paperSessionsSection": "পেপার সেশন",
  "backtestsSection": "ব্যাকটেস্ট",
  "strategyNoInstances": "কোনো স্ট্র্যাটেজি ইনস্ট্যান্স তৈরি করা হয়নি।",
  "strategyNoPaperSessions": "কোনো পেপার সেশন চালানো হয়নি।",
  "strategyNoBacktests": "কোনো ব্যাকটেস্ট চালানো হয়নি।",
  "instancesLabel": "ইনস্ট্যান্স",
  "runningLabel": "চলমান",
  "needsAttentionLabel": "মনোযোগ প্রয়োজন",
  "openIncidentsLabel": "খোলা ইনসিডেন্ট",
  "enabledLabel": "চালু",
  "disabledLabel": "বন্ধ",
  "consecutiveErrorsLabel": "পরপর ত্রুটি",
  "lastHeartbeatLabel": "সর্বশেষ হার্টবিট",
  "noHeartbeatYet": "এখনো কোনো হার্টবিট আসেনি",
  "statusLabel": "অবস্থা",
  "equityLabel": "ইকুইটি",
  "realisedPnlLabel": "রিয়েলাইজড লাভ/ক্ষতি",
  "netPnlLabel": "নিট লাভ/ক্ষতি",
  "tradesLabel": "ট্রেড",
  "winRateLabel": "উইন রেট",
  "sharpeLabel": "শার্প",
  "maxDrawdownLabel": "সর্বোচ্চ ড্রডাউন",
  "simulatedFillsLabel": "অর্ডার / ফিল",
  "riskRejectionsLabel": "ঝুঁকি প্রত্যাখ্যান",
  "simulatedBadge": "সিমুলেটেড",
  "insufficientData": "পর্যাপ্ত তথ্য নেই",
  "notAvailableShort": "প্রযোজ্য নয়",
  "statusQueued": "সারিতে",
  "statusRunning": "চলমান",
  "statusCompleted": "সম্পন্ন",
  "statusStopped": "বন্ধ",
  "statusFailed": "ব্যর্থ",
  "statusCancelled": "বাতিল",
  "backtestNotReproducible": "এই রানের ডেটাসেট চেকসাম নেই, তাই হুবহু পুনরায় তৈরি করা যাবে না।",
  "simulationDisclaimerTitle": "এই সংখ্যাগুলো সম্পর্কে",
  "backtestDisclaimer": "ব্যাকটেস্ট পারফরম্যান্স ভবিষ্যৎ পারফরম্যান্সের নির্দেশক নয়।",
  "paperDisclaimer": "পেপার পারফরম্যান্স লাইভ পারফরম্যান্সের নির্দেশক নয়।",
  "executionQualityDisclaimer": "সিমুলেশন প্রকৃত এক্সিকিউশন মান নিশ্চিত করে না।",
  "insufficientDataDisclaimer": "পর্যবেক্ষণ কম হলে ঝুঁকি-সমন্বিত পরিসংখ্যান দেখানো হয় না। পর্যাপ্ত তথ্য না থাকা মানে শূন্য নয়।",
  "retry": "আবার চেষ্টা করুন"
}
```

---

# Part C — pre-existing files changed by the verification sweep

Every change in this part is type-level, re-export-level or the removal of
code mypy proves unreachable. No behaviour was added or removed: the 634-test
Python suite, the 47-test API safety suite and the 20-test mobile suite pass
against exactly these contents. Files that Part 6 already owned (for example
`strategies/state.py`) received sweep fixes too, but their full text is
dumped in `docs/PART6_HANDOVER_FULL_SOURCE.md` rather than twice.

## FILE: libs/trading-core/wlct_trading/risk.py

Changed by the sweep: mypy strict: redundant ``is not TradingMode.DISABLED`` re-test removed (the authoritative guard above already returns a rejection) and RiskDecisionCode added to the explicit ``__all__`` re-export list.

```py
"""Pre-trade risk engine and kill switches.

This is the last gate before an order can reach a venue. Its governing rule is
**fail closed**: any condition the engine cannot positively verify results in a
rejection. Missing risk state, an unusable order book, a stale mark price, an
unreadable limit - all of them refuse the order. There is no code path in which
an unknown becomes an approval.

Checks are ordered cheapest-and-most-catastrophic first, so an engaged kill
switch short-circuits before any arithmetic runs.

Layering
--------
Three limit sets apply simultaneously and the tightest always wins:

1. **Platform** - hard ceilings from environment configuration.
2. **Account** - per trading account, set by the tenant admin.
3. **Strategy** - per strategy, set by whoever owns the strategy.

A strategy can restrict itself further; it can never widen a limit above it.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from decimal import Decimal

from wlct_trading.clock import epoch_micros
from wlct_trading.enums import (
    ExchangeId,
    KillSwitchScope,
    RiskDecisionCode,
    TradingMode,
)
from wlct_trading.market_data import BookTop
from wlct_trading.orders import OrderIntent

__all__ = [
    "RiskLimits",
    "RiskSnapshot",
    "KillSwitchState",
    "RiskViolation",
    "RiskDecision",
    "RiskEngine",
    "TradingModeResolver",
    "TradingModeError",
    "price_deviation_percent",
    # The decision code is part of the public surface: consumers persist and
    # compare RiskDecisionCode values returned by ``RiskDecision.code``. It
    # must be re-exported explicitly, not implicitly, so that ``from
    # wlct_trading.risk import RiskDecisionCode`` stays valid under
    # no-implicit-reexport (mypy strict).
    "RiskDecisionCode",
]

_ZERO = Decimal(0)
_HUNDRED = Decimal(100)


@dataclass(slots=True, frozen=True)
class RiskLimits:
    """One layer of limits.

    Every field is a hard ceiling. ``None`` means "this layer does not express
    an opinion" and defers to the other layers - it never means "unlimited".
    At least one layer must specify a value or :meth:`RiskEngine.evaluate`
    rejects with ``RISK_STATE_UNAVAILABLE``.
    """

    max_order_quantity: Decimal | None = None
    max_order_notional: Decimal | None = None
    max_position_quantity: Decimal | None = None
    max_symbol_exposure_notional: Decimal | None = None
    max_account_exposure_notional: Decimal | None = None
    max_open_orders: int | None = None
    max_orders_per_minute: int | None = None
    max_daily_loss: Decimal | None = None
    max_strategy_loss: Decimal | None = None
    max_price_deviation_percent: Decimal | None = None
    max_market_data_age_micros: int | None = None

    def tightest_with(self, other: "RiskLimits") -> "RiskLimits":
        """Combine two layers by taking the more restrictive of each field."""

        def pick_decimal(a: Decimal | None, b: Decimal | None) -> Decimal | None:
            if a is None:
                return b
            if b is None:
                return a
            return min(a, b)

        def pick_int(a: int | None, b: int | None) -> int | None:
            if a is None:
                return b
            if b is None:
                return a
            return min(a, b)

        return RiskLimits(
            max_order_quantity=pick_decimal(
                self.max_order_quantity, other.max_order_quantity
            ),
            max_order_notional=pick_decimal(
                self.max_order_notional, other.max_order_notional
            ),
            max_position_quantity=pick_decimal(
                self.max_position_quantity, other.max_position_quantity
            ),
            max_symbol_exposure_notional=pick_decimal(
                self.max_symbol_exposure_notional, other.max_symbol_exposure_notional
            ),
            max_account_exposure_notional=pick_decimal(
                self.max_account_exposure_notional, other.max_account_exposure_notional
            ),
            max_open_orders=pick_int(self.max_open_orders, other.max_open_orders),
            max_orders_per_minute=pick_int(
                self.max_orders_per_minute, other.max_orders_per_minute
            ),
            max_daily_loss=pick_decimal(self.max_daily_loss, other.max_daily_loss),
            max_strategy_loss=pick_decimal(
                self.max_strategy_loss, other.max_strategy_loss
            ),
            max_price_deviation_percent=pick_decimal(
                self.max_price_deviation_percent, other.max_price_deviation_percent
            ),
            max_market_data_age_micros=pick_int(
                self.max_market_data_age_micros, other.max_market_data_age_micros
            ),
        )


@dataclass(slots=True, frozen=True)
class KillSwitchState:
    """Which kill switches are currently engaged.

    Four independent scopes, checked broadest first. Any one of them engaged
    halts the order. Switches are stored in Redis so a single API call halts
    every worker in the fleet within one poll interval.
    """

    global_engaged: bool = False
    engaged_exchanges: frozenset[str] = field(default_factory=frozenset)
    engaged_strategies: frozenset[str] = field(default_factory=frozenset)
    engaged_symbols: frozenset[str] = field(default_factory=frozenset)
    reason: str | None = None

    def engaged_scope(
        self, exchange: ExchangeId, strategy_id: str | None, symbol: str
    ) -> KillSwitchScope | None:
        """Return the broadest engaged scope, or ``None`` if all are clear."""
        if self.global_engaged:
            return KillSwitchScope.GLOBAL
        if exchange.value in self.engaged_exchanges:
            return KillSwitchScope.EXCHANGE
        if strategy_id is not None and strategy_id in self.engaged_strategies:
            return KillSwitchScope.STRATEGY
        if symbol in self.engaged_symbols:
            return KillSwitchScope.SYMBOL
        return None


@dataclass(slots=True, frozen=True)
class RiskSnapshot:
    """Everything the engine needs to know about current exposure.

    Assembled from Redis hot state by the caller. It is a value object with no
    I/O so the engine stays pure and trivially testable.

    ``is_complete`` is the fail-closed flag: the loader sets it to ``False``
    when any part of the state could not be read, and the engine then refuses
    every order rather than evaluating against partial data.
    """

    position_quantity: Decimal
    symbol_exposure_notional: Decimal
    account_exposure_notional: Decimal
    open_order_count: int
    orders_in_last_minute: int
    realised_pnl_today: Decimal
    strategy_realised_pnl_today: Decimal
    reference_price: Decimal | None
    market_data_age_micros: int | None
    book_usable: bool
    is_complete: bool = True
    known_client_order_ids: frozenset[str] = field(default_factory=frozenset)


@dataclass(slots=True, frozen=True)
class RiskViolation:
    """One failed check."""

    code: RiskDecisionCode
    message: str
    limit: str | None = None
    observed: str | None = None


@dataclass(slots=True, frozen=True)
class RiskDecision:
    """The engine's verdict.

    ``approved`` is true only when there are zero violations *and* the trading
    mode permits routing. Both conditions are recorded separately so an
    operator can tell "the order was risky" from "trading is switched off".
    """

    decision_id: str
    approved: bool
    code: RiskDecisionCode
    violations: tuple[RiskViolation, ...]
    trading_mode: TradingMode
    would_route: bool
    evaluated_at: int
    kill_switch_scope: KillSwitchScope | None = None

    @property
    def rejection_summary(self) -> str:
        if not self.violations:
            return "approved"
        return "; ".join(v.message for v in self.violations)


class TradingModeError(Exception):
    """Raised when the configured trading mode is unsafe or contradictory."""


class TradingModeResolver:
    """Resolves the effective trading mode from explicit configuration.

    Live trading must be *impossible* to reach by accident, so it requires
    three independent settings to agree:

    * ``TRADING_MODE`` set literally to ``LIVE``
    * ``TRADING_ENABLED`` true
    * ``LIVE_TRADING_CONFIRMED`` true

    Anything missing, misspelled or contradictory resolves to ``DISABLED``.
    An omitted environment variable therefore yields no trading at all - never
    live trading.
    """

    __slots__ = ("_mode", "_trading_enabled", "_live_confirmed")

    def __init__(
        self,
        *,
        mode: str | None,
        trading_enabled: bool,
        live_confirmed: bool,
    ) -> None:
        self._mode = (mode or "").strip().upper()
        self._trading_enabled = trading_enabled
        self._live_confirmed = live_confirmed

    def resolve(self) -> TradingMode:
        if not self._trading_enabled:
            return TradingMode.DISABLED
        if self._mode == TradingMode.LIVE.value:
            if not self._live_confirmed:
                # Configured for live but not confirmed: refuse to trade at
                # all rather than silently downgrading to paper, because a
                # downgrade would hide a misconfiguration in production.
                return TradingMode.DISABLED
            return TradingMode.LIVE
        if self._mode == TradingMode.PAPER.value:
            return TradingMode.PAPER
        return TradingMode.DISABLED

    def describe(self) -> str:
        resolved = self.resolve()
        if resolved is TradingMode.DISABLED and self._mode == TradingMode.LIVE.value:
            return (
                "TRADING_MODE=LIVE but LIVE_TRADING_CONFIRMED is not set; "
                "trading is disabled."
            )
        return f"Trading mode resolved to {resolved.value}."


class RiskEngine:
    """Evaluates order intents against layered limits and kill switches.

    Pure and synchronous: no I/O, no clock dependency beyond a timestamp, no
    hidden state. The caller loads a :class:`RiskSnapshot` and passes it in,
    which makes every rule here directly unit-testable.
    """

    __slots__ = ("_platform_limits",)

    def __init__(self, platform_limits: RiskLimits) -> None:
        self._platform_limits = platform_limits

    def evaluate(
        self,
        intent: OrderIntent,
        *,
        snapshot: RiskSnapshot,
        kill_switches: KillSwitchState,
        trading_mode: TradingMode,
        account_limits: RiskLimits | None = None,
        strategy_limits: RiskLimits | None = None,
        book_top: BookTop | None = None,
        symbol_tradeable: bool = True,
        strategy_enabled: bool = True,
    ) -> RiskDecision:
        """Run every check and return a decision.

        Never raises for a risk condition - a rejection is a normal outcome and
        is returned as data so it can be persisted and audited.
        """
        violations: list[RiskViolation] = []
        decision_id = str(uuid.uuid4())
        now = epoch_micros()

        # -- 0. Kill switches --------------------------------------------
        scope = kill_switches.engaged_scope(
            intent.exchange, intent.strategy_id, intent.symbol
        )
        if scope is not None:
            return RiskDecision(
                decision_id=decision_id,
                approved=False,
                code=RiskDecisionCode.KILL_SWITCH_ENGAGED,
                violations=(
                    RiskViolation(
                        code=RiskDecisionCode.KILL_SWITCH_ENGAGED,
                        message=(
                            f"{scope.value} kill switch is engaged"
                            + (f": {kill_switches.reason}" if kill_switches.reason else ".")
                        ),
                    ),
                ),
                trading_mode=trading_mode,
                would_route=False,
                evaluated_at=now,
                kill_switch_scope=scope,
            )

        # -- 1. Fail closed on incomplete state --------------------------
        if not snapshot.is_complete:
            return self._reject(
                decision_id,
                RiskDecisionCode.RISK_STATE_UNAVAILABLE,
                "Risk state could not be fully loaded; refusing to submit the order.",
                trading_mode,
                now,
            )

        # -- 2. Structural validity --------------------------------------
        intent_errors = intent.validation_errors()
        if intent_errors:
            return self._reject(
                decision_id,
                RiskDecisionCode.INVALID_INTENT,
                "; ".join(intent_errors),
                trading_mode,
                now,
            )

        # -- 3. Duplicate protection -------------------------------------
        if (
            intent.client_order_id is not None
            and intent.client_order_id in snapshot.known_client_order_ids
        ):
            return self._reject(
                decision_id,
                RiskDecisionCode.DUPLICATE_ORDER,
                (
                    f"client_order_id {intent.client_order_id} has already been "
                    "submitted; refusing to duplicate the order."
                ),
                trading_mode,
                now,
            )

        # -- 4. Enablement ------------------------------------------------
        if not symbol_tradeable:
            return self._reject(
                decision_id,
                RiskDecisionCode.SYMBOL_NOT_TRADEABLE,
                f"Symbol {intent.symbol} is not enabled for trading.",
                trading_mode,
                now,
            )
        if not strategy_enabled:
            return self._reject(
                decision_id,
                RiskDecisionCode.STRATEGY_DISABLED,
                f"Strategy {intent.strategy_id} is disabled.",
                trading_mode,
                now,
            )
        if trading_mode is TradingMode.DISABLED:
            return self._reject(
                decision_id,
                RiskDecisionCode.TRADING_DISABLED,
                "Trading is disabled for this deployment.",
                trading_mode,
                now,
            )

        # -- 5. Resolve the effective limit set --------------------------
        limits = self._platform_limits
        if account_limits is not None:
            limits = limits.tightest_with(account_limits)
        if strategy_limits is not None:
            limits = limits.tightest_with(strategy_limits)

        # -- 6. Pricing ----------------------------------------------------
        price, price_violation = self._resolve_price(intent, snapshot, book_top, limits)
        if price_violation is not None:
            return self._reject_with(decision_id, price_violation, trading_mode, now)

        # -- 7. Quantitative limits ---------------------------------------
        violations.extend(self._check_order_size(intent, price, limits))
        violations.extend(self._check_position_size(intent, snapshot, price, limits))
        violations.extend(self._check_exposure(intent, snapshot, price, limits))
        violations.extend(self._check_order_budget(snapshot, limits))
        violations.extend(self._check_loss_limits(snapshot, limits))
        violations.extend(
            self._check_price_deviation(intent, snapshot, book_top, limits)
        )

        approved = not violations
        # Re-testing ``trading_mode is not DISABLED`` here would be theatre:
        # the DISABLED case returns its own rejection above, so by this point
        # a routable decision is exactly an approved one. mypy strict correctly
        # calls the redundant identity check non-overlapping; the real guard
        # lives where it was found and stays there.
        return RiskDecision(
            decision_id=decision_id,
            approved=approved,
            code=RiskDecisionCode.APPROVED if approved else violations[0].code,
            violations=tuple(violations),
            trading_mode=trading_mode,
            would_route=approved,
            evaluated_at=now,
        )

    # ------------------------------------------------------------------
    # Individual checks
    # ------------------------------------------------------------------
    def _resolve_price(
        self,
        intent: OrderIntent,
        snapshot: RiskSnapshot,
        book_top: BookTop | None,
        limits: RiskLimits,
    ) -> tuple[Decimal, RiskViolation | None]:
        """Determine the price used to value the order, or refuse.

        A limit order values at its own limit price. A market order must be
        valued from live market data, and if that data is unusable or stale the
        order is refused rather than valued from a guess.
        """
        if intent.price is not None:
            return intent.price, None

        if book_top is not None:
            if not snapshot.book_usable:
                return _ZERO, RiskViolation(
                    code=RiskDecisionCode.STALE_MARKET_DATA,
                    message=(
                        f"Order book for {intent.symbol} is not in a usable state; "
                        "refusing to price a market order."
                    ),
                )
            mid = book_top.mid_price
            if mid is not None:
                return mid, None

        if snapshot.reference_price is None:
            return _ZERO, RiskViolation(
                code=RiskDecisionCode.STALE_MARKET_DATA,
                message=(
                    f"No reference price available for {intent.symbol}; "
                    "refusing to value the order."
                ),
            )

        max_age = limits.max_market_data_age_micros
        if max_age is not None and snapshot.market_data_age_micros is not None:
            if snapshot.market_data_age_micros > max_age:
                return _ZERO, RiskViolation(
                    code=RiskDecisionCode.STALE_MARKET_DATA,
                    message=(
                        f"Market data for {intent.symbol} is "
                        f"{snapshot.market_data_age_micros}us old, exceeding the "
                        f"{max_age}us maximum."
                    ),
                    limit=str(max_age),
                    observed=str(snapshot.market_data_age_micros),
                )
        return snapshot.reference_price, None

    def _check_order_size(
        self, intent: OrderIntent, price: Decimal, limits: RiskLimits
    ) -> list[RiskViolation]:
        out: list[RiskViolation] = []

        if limits.max_order_quantity is None:
            out.append(
                RiskViolation(
                    code=RiskDecisionCode.RISK_STATE_UNAVAILABLE,
                    message="No max order quantity is configured at any layer.",
                )
            )
        elif intent.quantity > limits.max_order_quantity:
            out.append(
                RiskViolation(
                    code=RiskDecisionCode.MAX_ORDER_SIZE_EXCEEDED,
                    message=(
                        f"Order quantity {intent.quantity} exceeds the maximum of "
                        f"{limits.max_order_quantity}."
                    ),
                    limit=str(limits.max_order_quantity),
                    observed=str(intent.quantity),
                )
            )

        notional = intent.quantity * price
        if limits.max_order_notional is None:
            out.append(
                RiskViolation(
                    code=RiskDecisionCode.RISK_STATE_UNAVAILABLE,
                    message="No max order notional is configured at any layer.",
                )
            )
        elif notional > limits.max_order_notional:
            out.append(
                RiskViolation(
                    code=RiskDecisionCode.MAX_ORDER_NOTIONAL_EXCEEDED,
                    message=(
                        f"Order notional {notional} exceeds the maximum of "
                        f"{limits.max_order_notional}."
                    ),
                    limit=str(limits.max_order_notional),
                    observed=str(notional),
                )
            )
        return out

    def _check_position_size(
        self,
        intent: OrderIntent,
        snapshot: RiskSnapshot,
        price: Decimal,
        limits: RiskLimits,
    ) -> list[RiskViolation]:
        """Check the position this order would produce, not the current one.

        ``reduce_only`` orders are exempt: an order that can only shrink
        exposure cannot breach a position ceiling.
        """
        if intent.reduce_only or limits.max_position_quantity is None:
            return []

        projected = abs(snapshot.position_quantity + intent.quantity * intent.side.sign)
        if projected > limits.max_position_quantity:
            return [
                RiskViolation(
                    code=RiskDecisionCode.MAX_POSITION_SIZE_EXCEEDED,
                    message=(
                        f"Resulting position {projected} would exceed the maximum of "
                        f"{limits.max_position_quantity}."
                    ),
                    limit=str(limits.max_position_quantity),
                    observed=str(projected),
                )
            ]
        return []

    def _check_exposure(
        self,
        intent: OrderIntent,
        snapshot: RiskSnapshot,
        price: Decimal,
        limits: RiskLimits,
    ) -> list[RiskViolation]:
        if intent.reduce_only:
            return []

        out: list[RiskViolation] = []
        added = intent.quantity * price

        if limits.max_symbol_exposure_notional is not None:
            projected = snapshot.symbol_exposure_notional + added
            if projected > limits.max_symbol_exposure_notional:
                out.append(
                    RiskViolation(
                        code=RiskDecisionCode.MAX_SYMBOL_EXPOSURE_EXCEEDED,
                        message=(
                            f"Symbol exposure {projected} would exceed the maximum of "
                            f"{limits.max_symbol_exposure_notional}."
                        ),
                        limit=str(limits.max_symbol_exposure_notional),
                        observed=str(projected),
                    )
                )

        if limits.max_account_exposure_notional is not None:
            projected = snapshot.account_exposure_notional + added
            if projected > limits.max_account_exposure_notional:
                out.append(
                    RiskViolation(
                        code=RiskDecisionCode.MAX_ACCOUNT_EXPOSURE_EXCEEDED,
                        message=(
                            f"Account exposure {projected} would exceed the maximum of "
                            f"{limits.max_account_exposure_notional}."
                        ),
                        limit=str(limits.max_account_exposure_notional),
                        observed=str(projected),
                    )
                )
        return out

    def _check_order_budget(
        self, snapshot: RiskSnapshot, limits: RiskLimits
    ) -> list[RiskViolation]:
        out: list[RiskViolation] = []

        if (
            limits.max_open_orders is not None
            and snapshot.open_order_count >= limits.max_open_orders
        ):
            out.append(
                RiskViolation(
                    code=RiskDecisionCode.MAX_OPEN_ORDERS_EXCEEDED,
                    message=(
                        f"{snapshot.open_order_count} orders are already open, at the "
                        f"limit of {limits.max_open_orders}."
                    ),
                    limit=str(limits.max_open_orders),
                    observed=str(snapshot.open_order_count),
                )
            )

        if (
            limits.max_orders_per_minute is not None
            and snapshot.orders_in_last_minute >= limits.max_orders_per_minute
        ):
            out.append(
                RiskViolation(
                    code=RiskDecisionCode.ORDER_RATE_EXCEEDED,
                    message=(
                        f"{snapshot.orders_in_last_minute} orders were sent in the last "
                        f"minute, at the limit of {limits.max_orders_per_minute}."
                    ),
                    limit=str(limits.max_orders_per_minute),
                    observed=str(snapshot.orders_in_last_minute),
                )
            )
        return out

    def _check_loss_limits(
        self, snapshot: RiskSnapshot, limits: RiskLimits
    ) -> list[RiskViolation]:
        """Loss limits compare *losses* (negative PnL) against a positive cap."""
        out: list[RiskViolation] = []

        if limits.max_daily_loss is not None and snapshot.realised_pnl_today < _ZERO:
            loss = -snapshot.realised_pnl_today
            if loss >= limits.max_daily_loss:
                out.append(
                    RiskViolation(
                        code=RiskDecisionCode.DAILY_LOSS_LIMIT_BREACHED,
                        message=(
                            f"Realised loss today of {loss} has reached the daily limit "
                            f"of {limits.max_daily_loss}."
                        ),
                        limit=str(limits.max_daily_loss),
                        observed=str(loss),
                    )
                )

        if (
            limits.max_strategy_loss is not None
            and snapshot.strategy_realised_pnl_today < _ZERO
        ):
            loss = -snapshot.strategy_realised_pnl_today
            if loss >= limits.max_strategy_loss:
                out.append(
                    RiskViolation(
                        code=RiskDecisionCode.STRATEGY_LOSS_LIMIT_BREACHED,
                        message=(
                            f"Strategy realised loss of {loss} has reached its limit of "
                            f"{limits.max_strategy_loss}."
                        ),
                        limit=str(limits.max_strategy_loss),
                        observed=str(loss),
                    )
                )
        return out

    def _check_price_deviation(
        self,
        intent: OrderIntent,
        snapshot: RiskSnapshot,
        book_top: BookTop | None,
        limits: RiskLimits,
    ) -> list[RiskViolation]:
        """Guard against fat-finger limit prices far from the market.

        Only applies when the intent carries its own price *and* an independent
        market reference exists to compare it against. The book mid is
        preferred over the cached reference price because it is the fresher of
        the two; a book that is not usable is ignored rather than trusted.
        """
        if intent.price is None or limits.max_price_deviation_percent is None:
            return []

        reference: Decimal | None = None
        if book_top is not None and snapshot.book_usable:
            reference = book_top.mid_price
        if reference is None:
            reference = snapshot.reference_price
        if reference is None or reference == _ZERO:
            # No independent reference: this specific check cannot run. The
            # order is not refused here because pricing already fails closed
            # for the market orders that genuinely depend on live data.
            return []

        deviation = price_deviation_percent(intent.price, reference)
        if deviation is None or deviation <= limits.max_price_deviation_percent:
            return []

        return [
            RiskViolation(
                code=RiskDecisionCode.PRICE_DEVIATION_EXCEEDED,
                message=(
                    f"Limit price {intent.price} deviates {deviation:.4f}% from the "
                    f"reference price {reference}, exceeding the maximum of "
                    f"{limits.max_price_deviation_percent}%."
                ),
                limit=str(limits.max_price_deviation_percent),
                observed=str(deviation),
            )
        ]

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------
    @staticmethod
    def _reject(
        decision_id: str,
        code: RiskDecisionCode,
        message: str,
        trading_mode: TradingMode,
        now: int,
    ) -> RiskDecision:
        return RiskDecision(
            decision_id=decision_id,
            approved=False,
            code=code,
            violations=(RiskViolation(code=code, message=message),),
            trading_mode=trading_mode,
            would_route=False,
            evaluated_at=now,
        )

    @staticmethod
    def _reject_with(
        decision_id: str,
        violation: RiskViolation,
        trading_mode: TradingMode,
        now: int,
    ) -> RiskDecision:
        return RiskDecision(
            decision_id=decision_id,
            approved=False,
            code=violation.code,
            violations=(violation,),
            trading_mode=trading_mode,
            would_route=False,
            evaluated_at=now,
        )


def price_deviation_percent(price: Decimal, reference: Decimal) -> Decimal | None:
    """Absolute deviation of ``price`` from ``reference``, as a percentage."""
    if reference == _ZERO:
        return None
    return abs(price - reference) / reference * _HUNDRED
```

---

## FILE: libs/trading-core/wlct_trading/adapters/base.py

Changed by the sweep: mypy strict: abstract ``stream_*`` members declared ``def ... -> AsyncIterator[X]`` instead of ``async def`` — every implementation is an async generator whose call returns the iterator without an await. ruff: two unused enum imports dropped.

```py
"""Generic exchange adapter contracts.

These four protocols are the boundary between the platform and any venue.
Everything above them - strategies, the risk engine, the OMS, the position
manager - is written against these types only, so adding a venue means writing
one adapter and changing nothing else. Conversely, no venue-specific string,
field name or quirk is permitted to appear above this boundary.

The split into four narrow interfaces is deliberate:

``MarketDataAdapter``
    Read-only public data. Needs no credentials at all, so the market-data
    service can run without ever holding a key.
``TradingAdapter``
    Order placement and cancellation. The only interface that can move money.
``AccountAdapter``
    Balances, positions and account configuration.
``ExchangeAdapter``
    Composes the three plus venue metadata.

A service is wired with only the interfaces it needs. The market-data service
literally cannot place an order, because it never receives an object that has
the method.

Credentials
-----------
No method here accepts a raw API secret. Adapters are constructed with a
:class:`CredentialResolver` which returns a short-lived signing context from
the encrypted store. Secrets never appear in a signature, a log line, an
exception message or a repr.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from decimal import Decimal
from typing import AsyncIterator, Protocol, runtime_checkable

from wlct_trading.enums import ExchangeId, MarketType, OrderStatus
from wlct_trading.market_data import (
    Candle,
    OrderBookDelta,
    OrderBookSnapshot,
    PublicTrade,
    SymbolRef,
    Ticker,
)
from wlct_trading.orders import Fill, Order, OrderIntent

__all__ = [
    "SymbolSpecification",
    "SubmitResult",
    "CancelResult",
    "AccountBalance",
    "VenuePosition",
    "VenueAccount",
    "CredentialResolver",
    "MarketDataAdapter",
    "TradingAdapter",
    "AccountAdapter",
    "ExchangeAdapter",
    "AdapterError",
    "AdapterConnectionError",
    "AdapterRejectedError",
    "AdapterRateLimitedError",
]


class AdapterError(Exception):
    """Base class for every adapter failure.

    Adapter exceptions must never carry credential material. Implementations
    include the venue's error code and message only.
    """


class AdapterConnectionError(AdapterError):
    """Network-level failure. The order's fate is UNKNOWN.

    This is the ambiguous case: the request may or may not have reached the
    venue. Callers must reconcile by client order id rather than assuming the
    order did not exist.
    """


class AdapterRejectedError(AdapterError):
    """The venue positively rejected the request. The order does not exist."""

    def __init__(self, code: str, message: str) -> None:
        self.code = code
        super().__init__(f"{code}: {message}")


class AdapterRateLimitedError(AdapterError):
    """The venue rate-limited us. Carries the retry hint when one is given."""

    def __init__(self, retry_after_millis: int | None = None) -> None:
        self.retry_after_millis = retry_after_millis
        super().__init__(
            "Rate limited by venue"
            + (f"; retry after {retry_after_millis}ms." if retry_after_millis else ".")
        )


@dataclass(slots=True, frozen=True)
class SymbolSpecification:
    """Trading rules for one instrument.

    These are the venue's constraints. An order that violates them will be
    rejected by the venue, so the OMS validates against this locally first -
    a round trip saved and a rejection avoided.
    """

    symbol: str
    venue_symbol: str
    exchange: ExchangeId
    market_type: MarketType
    base_asset: str
    quote_asset: str
    price_tick: Decimal
    quantity_step: Decimal
    min_quantity: Decimal
    max_quantity: Decimal | None
    min_notional: Decimal
    is_tradeable: bool
    price_precision: int
    quantity_precision: int

    def validation_errors(self, quantity: Decimal, price: Decimal | None) -> list[str]:
        """Check an order against this venue's rules."""
        errors: list[str] = []
        if not self.is_tradeable:
            errors.append(f"{self.symbol} is not currently tradeable on {self.exchange.value}.")
        if quantity < self.min_quantity:
            errors.append(f"Quantity {quantity} is below the minimum {self.min_quantity}.")
        if self.max_quantity is not None and quantity > self.max_quantity:
            errors.append(f"Quantity {quantity} exceeds the maximum {self.max_quantity}.")
        if self.quantity_step > 0 and (quantity % self.quantity_step) != 0:
            errors.append(
                f"Quantity {quantity} is not a multiple of the step {self.quantity_step}."
            )
        if price is not None:
            if self.price_tick > 0 and (price % self.price_tick) != 0:
                errors.append(
                    f"Price {price} is not a multiple of the tick {self.price_tick}."
                )
            if quantity * price < self.min_notional:
                errors.append(
                    f"Notional {quantity * price} is below the minimum {self.min_notional}."
                )
        return errors


@dataclass(slots=True, frozen=True)
class SubmitResult:
    """What the venue said when we submitted an order."""

    accepted: bool
    exchange_order_id: str | None
    status: OrderStatus
    rejection_code: str | None = None
    rejection_reason: str | None = None
    is_simulated: bool = False
    submitted_at_micros: int = 0
    fills: tuple[Fill, ...] = field(default_factory=tuple)


@dataclass(slots=True, frozen=True)
class CancelResult:
    """Outcome of a cancellation request."""

    accepted: bool
    status: OrderStatus
    reason: str | None = None
    is_simulated: bool = False


@dataclass(slots=True, frozen=True)
class AccountBalance:
    asset: str
    free: Decimal
    locked: Decimal

    @property
    def total(self) -> Decimal:
        return self.free + self.locked


@dataclass(slots=True, frozen=True)
class VenuePosition:
    """A position as the *venue* reports it.

    Kept distinct from our internally derived ``Position`` so reconciliation
    can compare the two and surface a divergence instead of overwriting our
    fill-derived state with a venue snapshot.
    """

    symbol: str
    quantity: Decimal
    entry_price: Decimal | None
    unrealised_pnl: Decimal | None
    leverage: Decimal | None


@dataclass(slots=True, frozen=True)
class VenueAccount:
    """A normalised account snapshot as the venue reports it.

    Holds the permission flags alongside the balances because the two are read
    from the same endpoint and are only meaningful together: a balance is not
    safe to trade against if the key that read it also has withdrawal rights.

    Contains no credential material — only what the venue says about the
    account, which is safe to persist and to show an operator.
    """

    exchange: ExchangeId
    balances: tuple[AccountBalance, ...]
    can_trade: bool
    can_withdraw: bool
    can_deposit: bool
    account_type: str
    #: Venue-reported update time in microseconds, when available.
    updated_at_micros: int | None = None
    #: Maker/taker commission in basis points, when the venue reports them.
    maker_commission_bps: Decimal | None = None
    taker_commission_bps: Decimal | None = None

    def balance_for(self, asset: str) -> AccountBalance | None:
        upper = asset.upper()
        for balance in self.balances:
            if balance.asset.upper() == upper:
                return balance
        return None

    @property
    def non_zero_balances(self) -> tuple[AccountBalance, ...]:
        """Balances worth showing. A venue returns hundreds of zeroes."""
        return tuple(balance for balance in self.balances if balance.total != 0)

    @property
    def is_safe_for_trading(self) -> bool:
        """Whether this account may be traded at all.

        Withdrawal capability disqualifies it. The platform is non-custodial;
        a key that can move funds off the exchange is a liability it refuses to
        hold, no matter how convenient.
        """
        return self.can_trade and not self.can_withdraw


@runtime_checkable
class CredentialResolver(Protocol):
    """Supplies decrypted signing material for an account, just in time.

    Implementations read from the envelope-encrypted store and must return a
    short-lived object. Nothing in the trading core ever persists, logs or
    copies what this returns.
    """

    async def signing_context(self, tenant_id: str, account_id: str) -> object:
        ...


class MarketDataAdapter(ABC):
    """Public market data. Requires no credentials."""

    @property
    @abstractmethod
    def exchange(self) -> ExchangeId:
        ...

    @abstractmethod
    async def load_symbols(self) -> tuple[SymbolSpecification, ...]:
        """Fetch the venue's instrument list and trading rules."""

    @abstractmethod
    async def fetch_order_book_snapshot(
        self, symbol: SymbolRef, depth: int
    ) -> OrderBookSnapshot:
        """Fetch a depth image, used to initialise or resync a book."""

    @abstractmethod
    def stream_order_book(
        self, symbols: tuple[SymbolRef, ...]
    ) -> AsyncIterator[OrderBookDelta]:
        """Yield normalised incremental depth updates.

        Declared as a plain method returning an ``AsyncIterator`` because every
        implementation is an async *generator* (``async def`` containing
        ``yield``): calling one produces the iterator without an
        ``await``. An ``async def`` on the interface would claim callers get a
        coroutine first, which none of them do.
        """

    @abstractmethod
    def stream_trades(
        self, symbols: tuple[SymbolRef, ...]
    ) -> AsyncIterator[PublicTrade]:
        """Yield normalised public trade prints. See
        :meth:`stream_order_book` for why this is not ``async def``."""

    @abstractmethod
    def stream_tickers(
        self, symbols: tuple[SymbolRef, ...]
    ) -> AsyncIterator[Ticker]:
        """Yield normalised ticker updates. See :meth:`stream_order_book`
        for why this is not ``async def``."""

    @abstractmethod
    async def fetch_candles(
        self, symbol: SymbolRef, interval: str, limit: int
    ) -> tuple[Candle, ...]:
        """Fetch historical bars."""


class TradingAdapter(ABC):
    """Order entry. The only interface that can move real money."""

    @property
    @abstractmethod
    def exchange(self) -> ExchangeId:
        ...

    @property
    @abstractmethod
    def is_simulated(self) -> bool:
        """Whether fills from this adapter are simulated rather than real.

        Propagated onto every ``Fill`` and ``Order`` so a paper result can
        never be presented as a real one.
        """

    @abstractmethod
    async def submit_order(
        self, intent: OrderIntent, client_order_id: str
    ) -> SubmitResult:
        """Send an order.

        Implementations MUST forward ``client_order_id`` to the venue so a
        retry is deduplicated venue-side. Raise
        :class:`AdapterConnectionError` when the outcome is unknown, and
        :class:`AdapterRejectedError` only when the venue definitively refused.
        """

    @abstractmethod
    async def cancel_order(self, order: Order) -> CancelResult:
        """Cancel a resting order."""

    @abstractmethod
    async def fetch_order(
        self, tenant_id: str, account_id: str, client_order_id: str
    ) -> Order | None:
        """Look an order up by client order id.

        This is the reconciliation path after an ambiguous submission.
        """

    @abstractmethod
    async def fetch_open_orders(
        self, tenant_id: str, account_id: str, *, symbol: str | None = None
    ) -> tuple[Order, ...]:
        """List every order the venue currently considers live.

        The venue's answer, not ours. Reconciliation compares this against the
        local record: an order open here but closed locally means we missed a
        fill, and an order open locally but absent here means we missed a
        terminal event. Either way the venue wins.
        """

    @abstractmethod
    async def exchange_time(self) -> int:
        """The venue's current time in **milliseconds**.

        Used to measure clock offset before signing. Kept on the trading
        interface rather than in a shared utility because each venue exposes it
        on its own endpoint with its own weight cost.
        """

    @abstractmethod
    def stream_fills(
        self, tenant_id: str, account_id: str
    ) -> AsyncIterator[Fill]:
        """Yield executions as the venue reports them. See
        :meth:`MarketDataAdapter.stream_order_book` for why this is not
        ``async def``."""


class AccountAdapter(ABC):
    """Balances, positions and account configuration."""

    @property
    @abstractmethod
    def exchange(self) -> ExchangeId:
        ...

    @abstractmethod
    async def fetch_balances(
        self, tenant_id: str, account_id: str
    ) -> tuple[AccountBalance, ...]:
        ...

    @abstractmethod
    async def fetch_positions(
        self, tenant_id: str, account_id: str
    ) -> tuple[VenuePosition, ...]:
        ...

    @abstractmethod
    async def fetch_account(self, tenant_id: str, account_id: str) -> "VenueAccount":
        """Full account snapshot: balances plus venue-declared permissions.

        Separate from :meth:`fetch_balances` because the permission flags are
        what let the platform refuse a withdrawal-capable key, and a caller that
        only wants balances should not have to know that.
        """

    @abstractmethod
    async def verify_credentials(self, tenant_id: str, account_id: str) -> tuple[bool, str]:
        """Check that the stored key works and has safe permissions.

        Returns ``(ok, detail)``. Implementations MUST refuse a key with
        withdrawal permission enabled: the platform is non-custodial and a
        withdrawal-capable key is an unacceptable liability.
        """


class ExchangeAdapter(ABC):
    """Composite handle for one venue."""

    @property
    @abstractmethod
    def exchange(self) -> ExchangeId:
        ...

    @property
    @abstractmethod
    def market_data(self) -> MarketDataAdapter:
        ...

    @property
    @abstractmethod
    def trading(self) -> TradingAdapter:
        ...

    @property
    @abstractmethod
    def account(self) -> AccountAdapter:
        ...

    @abstractmethod
    async def connect(self) -> None:
        ...

    @abstractmethod
    async def close(self) -> None:
        ...
```

---

## FILE: libs/trading-core/wlct_trading/adapters/paper.py

Changed by the sweep: ``stream_fills`` returns ``_EmptyFillStream()``, a two-method ABC implementation, instead of an ``async def`` propped open by an unreachable yield.

```py
"""Paper-trading venue.

A simulated matching engine used to exercise the full order path - strategy,
risk, OMS, position tracking - without sending anything to a real exchange.

Honesty rules, enforced structurally rather than by convention:

* ``is_simulated`` is ``True`` on the adapter, on every :class:`SubmitResult`
  and on every :class:`Fill` it produces. The OMS copies that flag onto the
  order and the position manager onto the position, so a simulated result
  cannot be displayed or reported as a real one anywhere downstream.
* Fills are produced only against **real observed market data**. The adapter is
  given a live top-of-book and will not invent a price. If no usable book is
  available the order simply rests unfilled - it never fabricates an execution.
* Marketable orders cross the real spread and are filled at the real touch
  price, capped by the real resting quantity, so the simulation inherits the
  actual liquidity conditions rather than assuming infinite depth.

This is a simulator and is labelled as one. It models neither queue position
nor market impact, so its fills are optimistic relative to live trading.

Where the fill rules live
-------------------------
The matching rules themselves are **not** implemented here. They live in
:class:`~wlct_trading.backtest.simulator.SimulatedMatchingEngine`, which is the
one implementation shared by this adapter and by the backtest engine. Two
copies of "when does a simulated order fill" would eventually disagree, and the
difference between paper results and backtest results would then be an artefact
of the code rather than of the market. This class configures that engine with
assumptions that reproduce the adapter's established behaviour exactly -
immediate taker fill at the observed touch, capped by displayed size, no
slippage, no latency model - and adds the venue-shaped API around it.
"""

from __future__ import annotations

import uuid
from decimal import Decimal
from typing import AsyncIterator, Callable

from wlct_trading.backtest.simulator import (
    ExecutionAssumptions,
    SimulatedIdFactory,
    SimulatedMatchingEngine,
)
from wlct_trading.clock import epoch_micros
from wlct_trading.enums import ExchangeId, OrderStatus
from wlct_trading.market_data import BookTop
from wlct_trading.orders import Fill, Order, OrderIntent
from wlct_trading.adapters.base import (
    AccountAdapter,
    AccountBalance,
    CancelResult,
    SubmitResult,
    TradingAdapter,
    VenueAccount,
    VenuePosition,
)

__all__ = ["PaperTradingAdapter", "PaperAccountAdapter", "BookProvider"]

_ZERO = Decimal(0)

#: Supplies the current real top-of-book for a symbol, or ``None`` when the
#: book is unavailable or untrustworthy.
BookProvider = Callable[[ExchangeId, str], BookTop | None]


class _EmptyFillStream(AsyncIterator[Fill]):
    """An ``AsyncIterator[Fill]`` that stops immediately, for adapters with
    no fill stream.

    The explicit ABC inheritance is load-bearing for the type gate: without a
    declared base, mypy must infer whether this class satisfies a Protocol it
    nominally claims in ``stream_fills``, and refuses to.

    A do-nothing async generator would read better but is either an
    unreachable ``yield`` or a plain function returning ``None``; both are
    lies of a kind the strict type gate is right to refuse.
    """

    __slots__ = ()

    def __aiter__(self) -> AsyncIterator[Fill]:
        return self

    async def __anext__(self) -> Fill:
        raise StopAsyncIteration


class PaperTradingAdapter(TradingAdapter):
    """Simulated order entry backed by real observed prices."""

    __slots__ = (
        "_book_provider",
        "_exchange",
        "_resting",
        "_fee_rate",
        "_fee_currency",
        "_engine",
    )

    def __init__(
        self,
        book_provider: BookProvider,
        *,
        exchange: ExchangeId = ExchangeId.PAPER,
        fee_rate: Decimal = Decimal("0.001"),
        fee_currency: str = "USDT",
    ) -> None:
        self._book_provider = book_provider
        self._exchange = exchange
        self._resting: dict[str, Order] = {}
        self._fee_rate = fee_rate
        self._fee_currency = fee_currency
        # Assumptions chosen to reproduce this adapter's historical behaviour
        # exactly: one fee rate for both sides, no slippage, no latency, fills
        # capped by displayed size, partial fills permitted.
        self._engine = SimulatedMatchingEngine(
            ExecutionAssumptions(
                maker_fee_rate=fee_rate,
                taker_fee_rate=fee_rate,
                slippage_bps=_ZERO,
                fee_currency=fee_currency,
                latency_micros=0,
                allow_partial_fills=True,
                cap_by_displayed_size=True,
                min_fill_quantity=_ZERO,
            ),
            # Random ids: this adapter runs against live data where
            # reproducibility is neither achievable nor expected. The backtest
            # engine supplies a deterministic factory instead.
            id_factory=SimulatedIdFactory(prefix="paper", deterministic=False),
            exchange=exchange,
        )

    @property
    def exchange(self) -> ExchangeId:
        return self._exchange

    @property
    def is_simulated(self) -> bool:
        return True

    @property
    def fee_rate(self) -> Decimal:
        return self._fee_rate

    @property
    def fee_currency(self) -> str:
        return self._fee_currency

    async def submit_order(
        self, intent: OrderIntent, client_order_id: str
    ) -> SubmitResult:
        """Accept the order and fill it if the real book says it would cross."""
        now = epoch_micros()
        book = self._book_provider(intent.exchange, intent.symbol)
        exchange_order_id = f"paper-{uuid.uuid4().hex[:16]}"

        match = self._engine.submit(
            intent,
            client_order_id=client_order_id,
            order_id="",
            book=book,
            now_micros=now,
        )

        if match.rests:
            # This adapter has no book-update callback, so a resting order
            # would never be revisited. Dropping it from the engine keeps the
            # engine's resting book from growing without bound; the order is
            # still reported as ACKNOWLEDGED, exactly as before.
            self._engine.cancel(client_order_id)

        if not match.accepted:
            return SubmitResult(
                accepted=False,
                exchange_order_id=None,
                status=OrderStatus.REJECTED,
                rejection_code="SIMULATED_VALIDATION",
                rejection_reason=match.reason,
                is_simulated=True,
                submitted_at_micros=now,
                fills=(),
            )

        return SubmitResult(
            accepted=True,
            exchange_order_id=exchange_order_id,
            status=(
                OrderStatus.ACKNOWLEDGED if not match.fills else match.status
            ),
            is_simulated=True,
            submitted_at_micros=now,
            fills=match.fills,
        )

    async def cancel_order(self, order: Order) -> CancelResult:
        self._resting.pop(order.client_order_id, None)
        self._engine.cancel(order.client_order_id)
        return CancelResult(
            accepted=True,
            status=OrderStatus.CANCELLED,
            reason="Cancelled on the simulated venue.",
            is_simulated=True,
        )

    async def fetch_order(
        self, tenant_id: str, account_id: str, client_order_id: str
    ) -> Order | None:
        return self._resting.get(client_order_id)

    async def fetch_open_orders(
        self, tenant_id: str, account_id: str, *, symbol: str | None = None
    ) -> tuple[Order, ...]:
        """Resting simulated orders for this account.

        Scoped by tenant and account even though the simulator is process-local:
        the reconciliation code path is shared with the live adapters, and a
        paper run that quietly ignored the scoping would not exercise the same
        behaviour it is meant to rehearse.
        """
        return tuple(
            order
            for order in self._resting.values()
            if order.tenant_id == tenant_id
            and order.account_id == account_id
            and (symbol is None or order.symbol == symbol)
        )

    async def exchange_time(self) -> int:
        """Local wall clock, in milliseconds.

        The simulated venue has no clock of its own, so the offset it reports is
        always zero. That is honest rather than convenient: there is genuinely
        no skew between this process and a venue running inside it.
        """
        return epoch_micros() // 1_000

    def stream_fills(
        self, tenant_id: str, account_id: str
    ) -> AsyncIterator[Fill]:
        """The simulator fills synchronously in ``submit_order``.

        There is therefore no asynchronous fill stream; this yields nothing.
        An immediate-stop iterator is used instead of an empty async
        generator because an async generator with no reachable ``yield`` is
        either dead code or a syntax error, and neither is honest.
        """
        return _EmptyFillStream()


class PaperAccountAdapter(AccountAdapter):
    """Account view for the simulated venue.

    Balances are configured by the operator rather than fetched, and are
    labelled simulated wherever they surface.
    """

    __slots__ = ("_exchange", "_balances")

    def __init__(
        self,
        balances: dict[str, Decimal] | None = None,
        *,
        exchange: ExchangeId = ExchangeId.PAPER,
    ) -> None:
        self._exchange = exchange
        self._balances = balances or {}

    @property
    def exchange(self) -> ExchangeId:
        return self._exchange

    async def fetch_balances(
        self, tenant_id: str, account_id: str
    ) -> tuple[AccountBalance, ...]:
        return tuple(
            AccountBalance(asset=asset, free=amount, locked=_ZERO)
            for asset, amount in sorted(self._balances.items())
        )

    async def fetch_positions(
        self, tenant_id: str, account_id: str
    ) -> tuple[VenuePosition, ...]:
        """The simulator holds no venue-side positions.

        Position state for paper trading is derived from simulated fills by the
        platform's own position manager, exactly as it is for live trading.
        """
        return ()

    async def fetch_account(self, tenant_id: str, account_id: str) -> VenueAccount:
        """Simulated account snapshot.

        ``can_withdraw`` is hard-coded ``False``: the simulator must never
        present itself as capable of moving funds, and a paper account that
        claimed withdrawal rights would be rejected by the platform's own
        safety check anyway.
        """
        return VenueAccount(
            exchange=self._exchange,
            balances=await self.fetch_balances(tenant_id, account_id),
            can_trade=True,
            can_withdraw=False,
            can_deposit=False,
            account_type="SIMULATED",
            updated_at_micros=epoch_micros(),
            maker_commission_bps=None,
            taker_commission_bps=None,
        )

    async def verify_credentials(
        self, tenant_id: str, account_id: str
    ) -> tuple[bool, str]:
        return (True, "Simulated venue; no credentials are required or stored.")
```

---

## FILE: libs/trading-core/wlct_trading/exchanges/binance/trading.py

Changed by the sweep: ``stream_fills`` refuses at call time (plain ``def`` raising) instead of hiding the raise behind a dead-yield generator.

```py
"""Authenticated Binance Spot adapters.

The first venue where this platform can move real money. Everything
venue-specific about authenticated trading is confined to this module and to
:mod:`wlct_trading.exchanges.binance.signing`: the execution engine above it
sees only :class:`~wlct_trading.adapters.base.TradingAdapter` and
:class:`~wlct_trading.adapters.base.AccountAdapter`.

Design notes that matter more than the endpoint list:

**The ambiguity contract is honoured precisely.** A transport failure raises
:class:`AdapterConnectionError`, which the engine treats as "the order may
exist". A venue error response raises :class:`AdapterRejectedError`, which means
"the order definitively does not exist". Getting this distinction wrong in
either direction is a money bug: conflating them either duplicates orders or
strands them. The classification is therefore made from the HTTP status and the
venue's own error code, never from a string match on a message.

**Numbers are strings until they are Decimals.** The JSON body is parsed with
``parse_float=str`` so no quantity ever passes through a binary float. A
``0.1 + 0.2`` in an order size is not a rounding curiosity, it is a rejected
order or a wrong position.

**Nothing here logs.** Not the request, not the response, not the headers. The
API key is in a header on every single call, and a debug log left switched on
is the most ordinary way for a key to end up in a log aggregator.
"""

from __future__ import annotations

import json
import uuid
from dataclasses import dataclass
from decimal import Decimal
from typing import Any, AsyncIterator, Awaitable, Callable, Mapping, Sequence

from wlct_trading.adapters.base import (
    AccountAdapter,
    AccountBalance,
    AdapterConnectionError,
    AdapterError,
    AdapterRateLimitedError,
    AdapterRejectedError,
    CancelResult,
    SubmitResult,
    TradingAdapter,
    VenueAccount,
    VenuePosition,
)
from wlct_trading.clock import epoch_micros
from wlct_trading.enums import (
    ExchangeId,
    OrderSide,
    OrderStatus,
    OrderType,
    TimeInForce,
)
from wlct_trading.exchanges.binance.capabilities import (
    BINANCE_REST_WEIGHTS,
    BINANCE_SPOT_CAPABILITIES,
    BINANCE_SPOT_REST_BASE,
    BINANCE_TESTNET_REST_BASE,
)
from wlct_trading.exchanges.binance.parsers import BinanceParseError, parse_decimal
from wlct_trading.exchanges.binance.signing import (
    SignatureError,
    SignedRequest,
    build_keyed_request,
    build_signed_request,
    format_decimal,
)
from wlct_trading.execution.credentials import CredentialProvider, ExchangeCredentials
from wlct_trading.execution.timesync import ClockSyncError, ExchangeClock
from wlct_trading.orders import Fill, Order, OrderIntent
from wlct_trading.transport.ratelimit import RateLimitRegistry

__all__ = [
    "HttpResponse",
    "SignedRequestSender",
    "BinanceTradingAdapter",
    "BinanceAccountAdapter",
    "BINANCE_ORDER_STATUS_MAP",
    "to_binance_order_type",
    "from_binance_status",
]


@dataclass(frozen=True, slots=True)
class HttpResponse:
    """A raw HTTP response.

    The body stays a string. Decoding is done here with ``parse_float=str`` so
    the transport cannot silently hand back floats, which is what a naive
    ``response.json()`` would do.
    """

    status: int
    headers: Mapping[str, str]
    body: str

    def json(self) -> Any:
        """Decode, keeping every number as a string."""
        try:
            return json.loads(self.body, parse_float=str, parse_int=str)
        except (ValueError, TypeError) as exc:
            raise BinanceParseError(
                f"Binance returned a body that is not valid JSON "
                f"(HTTP {self.status})."
            ) from exc

    def header(self, name: str) -> str | None:
        """Case-insensitive header lookup."""
        lowered = name.lower()
        for key, value in self.headers.items():
            if key.lower() == lowered:
                return value
        return None

    @property
    def retry_after_millis(self) -> int | None:
        """``Retry-After``, in milliseconds. Binance sends it in seconds."""
        raw = self.header("Retry-After")
        if raw is None:
            return None
        try:
            return int(float(raw) * 1000)
        except (TypeError, ValueError):
            return None

    @property
    def used_weight_1m(self) -> int | None:
        """The venue's own view of consumed weight this minute.

        Worth reading even though the local limiter tracks it too: the venue
        counts across every process sharing the IP, and the local one does not.
        """
        raw = self.header("X-MBX-USED-WEIGHT-1M") or self.header("X-MBX-USED-WEIGHT")
        try:
            return int(raw) if raw is not None else None
        except (TypeError, ValueError):
            return None


#: Transmits a prepared signed request. Implemented in the service layer over
#: ``httpx``; kept as a callable so trading-core stays dependency-free and so a
#: test can substitute a deterministic sender with no network at all.
SignedRequestSender = Callable[[SignedRequest, int], Awaitable[HttpResponse]]


#: Venue status -> platform status. Binance's ``EXPIRED_IN_MATCH`` is a
#: self-trade-prevention expiry and is folded into EXPIRED; the distinction is
#: preserved in the order event payload rather than in the enum.
BINANCE_ORDER_STATUS_MAP: dict[str, OrderStatus] = {
    "NEW": OrderStatus.ACKNOWLEDGED,
    "PENDING_NEW": OrderStatus.SUBMITTED,
    "PARTIALLY_FILLED": OrderStatus.PARTIALLY_FILLED,
    "FILLED": OrderStatus.FILLED,
    "CANCELED": OrderStatus.CANCELLED,
    "PENDING_CANCEL": OrderStatus.CANCEL_REQUESTED,
    "REJECTED": OrderStatus.REJECTED,
    "EXPIRED": OrderStatus.EXPIRED,
    "EXPIRED_IN_MATCH": OrderStatus.EXPIRED,
}

#: Platform order type -> Binance order type.
_ORDER_TYPE_MAP: dict[OrderType, str] = {
    OrderType.MARKET: "MARKET",
    OrderType.LIMIT: "LIMIT",
    OrderType.STOP: "STOP_LOSS",
    OrderType.STOP_LIMIT: "STOP_LOSS_LIMIT",
}

#: Binance error codes that mean "the venue definitively refused this order".
#: Everything not listed, on a 4xx, is also a refusal; this set exists to make
#: the intent explicit for the codes that matter most.
_DEFINITIVE_REJECTION_CODES: frozenset[int] = frozenset(
    {
        -1013,  # filter failure: lot size, min notional, price filter
        -1021,  # timestamp outside recvWindow
        -1022,  # invalid signature
        -1100,  # illegal characters in a parameter
        -1102,  # mandatory parameter missing
        -1104,  # too many parameters
        -1111,  # precision over the maximum for this asset
        -1117,  # invalid timeInForce
        -1121,  # invalid symbol
        -2010,  # NEW_ORDER_REJECTED (includes insufficient balance)
        -2011,  # CANCEL_REJECTED
        -2013,  # order does not exist
        -2015,  # invalid API key, IP, or permissions
        -2026,  # order was canceled or expired with no executed qty
    }
)


def to_binance_order_type(order_type: OrderType) -> str:
    """Map a platform order type onto Binance's vocabulary."""
    try:
        return _ORDER_TYPE_MAP[order_type]
    except KeyError as exc:  # pragma: no cover - enum is closed
        raise AdapterRejectedError(
            "UNSUPPORTED_ORDER_TYPE",
            f"Binance Spot does not support order type {order_type.value}.",
        ) from exc


def from_binance_status(raw: str) -> OrderStatus:
    """Map a Binance status string onto the platform lifecycle.

    An unrecognised status raises rather than defaulting. A new status the
    platform has never seen is exactly the situation where guessing — and
    especially guessing ``FILLED`` or ``CANCELLED`` — would corrupt a position.
    """
    try:
        return BINANCE_ORDER_STATUS_MAP[raw.upper()]
    except KeyError as exc:
        raise BinanceParseError(
            f"Binance returned an unrecognised order status {raw!r}. Refusing "
            f"to guess what it means for the order's lifecycle."
        ) from exc


class _BinanceSignedClient:
    """Shared signing, rate limiting and error handling.

    Composed into both adapters rather than inherited: the trading adapter and
    the account adapter are separate interfaces on purpose (a service can hold
    one without the other), and a shared base class would quietly reunite them.
    """

    __slots__ = (
        "_send",
        "_credentials",
        "_clock",
        "_limits",
        "_rest_base",
        "_recv_window_ms",
        "_timeout_ms",
    )

    def __init__(
        self,
        *,
        send: SignedRequestSender,
        credentials: CredentialProvider,
        clock: ExchangeClock,
        rate_limits: RateLimitRegistry | None = None,
        testnet: bool = False,
        rest_base: str | None = None,
        recv_window_ms: int = 5_000,
        timeout_ms: int = 10_000,
    ) -> None:
        base = rest_base or (
            BINANCE_TESTNET_REST_BASE if testnet else BINANCE_SPOT_REST_BASE
        )
        cleaned = base.strip().rstrip("/")
        if not cleaned.startswith("https://"):
            raise ValueError(
                f"Binance rest_base must be HTTPS for signed requests; got "
                f"{base!r}. A signed request over plaintext leaks the API key."
            )
        if "data-api.binance.vision" in cleaned or "data-stream" in cleaned:
            # The public mirror serves market data only and has no authenticated
            # endpoints. Pointing signed traffic at it produces a confusing 404
            # rather than an obvious failure, so it is rejected up front.
            raise ValueError(
                f"{cleaned} is Binance's public market-data mirror and does not "
                f"accept signed requests. Use api.binance.com or "
                f"testnet.binance.vision."
            )
        self._send = send
        self._credentials = credentials
        self._clock = clock
        self._limits = rate_limits or RateLimitRegistry.from_rules(
            BINANCE_SPOT_CAPABILITIES.rate_limit_rules
        )
        self._rest_base = cleaned
        self._recv_window_ms = recv_window_ms
        self._timeout_ms = timeout_ms

    @property
    def rest_base(self) -> str:
        return self._rest_base

    def _reserve(self, weight: int) -> None:
        """Reserve rate-limit budget before sending, or refuse locally.

        Refusing locally is strictly better than being refused by the venue: a
        429 costs a round trip and repeated 429s escalate to a 418 IP ban that
        affects every tenant sharing the address.
        """
        allowed, decisions = self._limits.try_acquire_all(
            {"REQUEST_WEIGHT": weight, "RAW_REQUESTS": 1}
        )
        if not allowed:
            blocking = next(
                (item for item in decisions if not item.allowed), decisions[0]
            )
            raise AdapterRateLimitedError(blocking.retry_after_millis)

    async def signed(
        self,
        *,
        method: str,
        path: str,
        params: Sequence[tuple[str, Any]],
        tenant_id: str,
        account_id: str,
        weight: int,
    ) -> Any:
        """Build, sign, send and interpret one authenticated request."""
        self._reserve(weight)
        credentials = await self._resolve(tenant_id, account_id)

        try:
            timestamp = self._clock.timestamp_millis()
        except ClockSyncError:
            # Propagated unchanged. The engine distinguishes a clock problem
            # from a venue problem, and nothing was transmitted either way.
            raise

        try:
            request = build_signed_request(
                method=method,
                base_url=self._rest_base,
                path=path,
                params=params,
                credentials=credentials,
                timestamp_millis=timestamp,
                recv_window_millis=self._recv_window_ms,
            )
        except SignatureError as exc:
            raise AdapterRejectedError("SIGNING_FAILED", str(exc)) from exc

        return await self._dispatch(request)

    async def keyed(
        self,
        *,
        method: str,
        path: str,
        params: Sequence[tuple[str, Any]] = (),
        tenant_id: str,
        account_id: str,
        weight: int,
    ) -> Any:
        """Send a key-authenticated, unsigned request (user-stream endpoints)."""
        self._reserve(weight)
        credentials = await self._resolve(tenant_id, account_id)
        request = build_keyed_request(
            method=method,
            base_url=self._rest_base,
            path=path,
            params=params,
            credentials=credentials,
        )
        return await self._dispatch(request)

    async def _resolve(self, tenant_id: str, account_id: str) -> ExchangeCredentials:
        try:
            credentials = await self._credentials.resolve(
                tenant_id, account_id, ExchangeId.BINANCE
            )
        except Exception as exc:  # noqa: BLE001 - message is already redacted
            raise AdapterRejectedError(
                "CREDENTIALS_UNAVAILABLE",
                f"Could not resolve credentials for account {account_id}: "
                f"{type(exc).__name__}.",
            ) from exc
        credentials.assert_safe()
        return credentials

    async def _dispatch(self, request: SignedRequest) -> Any:
        """Transmit and classify.

        The classification is the whole point of this method, so it is worth
        being explicit about each branch:

        * A transport exception is **ambiguous**. The request may have been
          received and the response lost.
        * ``429``/``418`` are **definitive refusals** — the venue tells us it
          did not process the request — and carry a retry hint.
        * ``401``/``403`` are definitive and mean the key is wrong or lacks
          permission. Never retried; retrying a bad key is how an account gets
          rate-limited into a ban.
        * ``5xx`` is **ambiguous**. Binance documents that a 5xx means the
          execution status is unknown and the request may have succeeded.
        * ``4xx`` is a definitive rejection.
        """
        try:
            response = await self._send(request, self._timeout_ms)
        except Exception as exc:  # noqa: BLE001
            raise AdapterConnectionError(
                f"No response from Binance for {request.method} {request.url}: "
                f"{type(exc).__name__}. The request's fate is unknown."
            ) from exc

        if 200 <= response.status < 300:
            return response.json()

        if response.status in (418, 429):
            raise AdapterRateLimitedError(response.retry_after_millis)

        if response.status >= 500:
            # Binance's own documentation is explicit: a 5xx is not a failure
            # response, it means the execution status is unknown.
            raise AdapterConnectionError(
                f"Binance returned HTTP {response.status}; per the venue's "
                f"documentation the execution status of this request is "
                f"UNKNOWN and it must be reconciled, not retried."
            )

        code, message = _extract_error(response)
        if response.status in (401, 403):
            raise AdapterRejectedError(
                str(code) if code is not None else "AUTH",
                f"Binance rejected the credentials (HTTP {response.status}): "
                f"{message}",
            )
        raise AdapterRejectedError(
            str(code) if code is not None else f"HTTP_{response.status}", message
        )


def _extract_error(response: HttpResponse) -> tuple[int | None, str]:
    """Pull ``{"code": -1121, "msg": "..."}`` out of an error body.

    Falls back to a generic message rather than raising: an unparseable error
    body must not turn a clean rejection into a confusing parse failure.
    """
    try:
        payload = response.json()
    except BinanceParseError:
        return (None, f"Binance returned HTTP {response.status} with a non-JSON body.")
    if not isinstance(payload, Mapping):
        return (None, f"Binance returned HTTP {response.status}.")
    raw_code = payload.get("code")
    try:
        code = int(raw_code) if raw_code is not None else None
    except (TypeError, ValueError):
        code = None
    message = str(payload.get("msg") or f"Binance returned HTTP {response.status}.")
    return (code, message)


class BinanceTradingAdapter(TradingAdapter):
    """Order entry against Binance Spot.

    ``is_simulated`` is hard-coded ``False``. This adapter can only talk to a
    real venue, and a real venue is the only thing it will ever claim to be.
    """

    __slots__ = ("_client", "_symbol_for", "_venue_symbol_for", "_symbol_hints")

    def __init__(
        self,
        *,
        send: SignedRequestSender,
        credentials: CredentialProvider,
        clock: ExchangeClock,
        rate_limits: RateLimitRegistry | None = None,
        testnet: bool = False,
        rest_base: str | None = None,
        recv_window_ms: int = 5_000,
        timeout_ms: int = 10_000,
        venue_symbol_for: Callable[[str], str] | None = None,
        symbol_for: Callable[[str], str] | None = None,
    ) -> None:
        """
        ``venue_symbol_for`` converts a platform symbol (``BTC/USDT``) into the
        venue's form (``BTCUSDT``); ``symbol_for`` reverses it. Defaults strip
        and restore the separator, which is correct for spot pairs; a registry
        can be injected where it is not.
        """
        self._client = _BinanceSignedClient(
            send=send,
            credentials=credentials,
            clock=clock,
            rate_limits=rate_limits,
            testnet=testnet,
            rest_base=rest_base,
            recv_window_ms=recv_window_ms,
            timeout_ms=timeout_ms,
        )
        self._venue_symbol_for = venue_symbol_for or (
            lambda symbol: symbol.replace("/", "").replace("-", "").upper()
        )
        self._symbol_for = symbol_for or (lambda venue_symbol: venue_symbol.upper())
        # Binance addresses an order by (symbol, clientOrderId), but the
        # platform's reconciliation contract is "look it up by clientOrderId
        # alone". This bridges the two: every submission remembers its symbol,
        # and a process that restarts seeds the map from the durable record via
        # register_symbol_hint rather than guessing.
        self._symbol_hints: dict[str, str] = {}

    @property
    def exchange(self) -> ExchangeId:
        return ExchangeId.BINANCE

    @property
    def is_simulated(self) -> bool:
        return False

    # ------------------------------------------------------------------
    # Orders
    # ------------------------------------------------------------------
    async def submit_order(
        self, intent: OrderIntent, client_order_id: str
    ) -> SubmitResult:
        """Place an order via ``POST /api/v3/order``.

        ``newClientOrderId`` carries the platform's deterministic idempotency
        key to the venue, so a request that is somehow sent twice is rejected
        venue-side with ``-2010 Duplicate order sent`` rather than filling
        twice. That is the last line of defence behind the local lock and the
        unique index, and it is the only one that still works when the platform
        itself is confused.

        ``newOrderRespType=FULL`` asks for the fill list in the response, which
        removes a round trip for a market order that fills immediately — and,
        more importantly, means an immediately-filled order is never briefly
        recorded as unfilled.
        """
        params: list[tuple[str, Any]] = [
            ("symbol", self._venue_symbol_for(intent.symbol)),
            ("side", intent.side.value),
            ("type", to_binance_order_type(intent.order_type)),
        ]

        if intent.order_type is not OrderType.MARKET:
            params.append(("timeInForce", intent.time_in_force.value))

        params.append(("quantity", format_decimal(intent.quantity)))

        if intent.order_type in (OrderType.LIMIT, OrderType.STOP_LIMIT):
            if intent.price is None:
                raise AdapterRejectedError(
                    "PRICE_REQUIRED",
                    f"A {intent.order_type.value} order requires a price.",
                )
            params.append(("price", format_decimal(intent.price)))

        if intent.order_type in (OrderType.STOP, OrderType.STOP_LIMIT):
            if intent.stop_price is None:
                raise AdapterRejectedError(
                    "STOP_PRICE_REQUIRED",
                    f"A {intent.order_type.value} order requires a stop price.",
                )
            params.append(("stopPrice", format_decimal(intent.stop_price)))

        if intent.reduce_only:
            # Binance Spot has no reduce-only flag. Refusing is the only safe
            # answer: dropping it would convert a position-closing order into a
            # position-opening one.
            raise AdapterRejectedError(
                "REDUCE_ONLY_UNSUPPORTED",
                "Binance Spot has no reduce-only flag; refusing to send the "
                "order without it.",
            )

        params.append(("newClientOrderId", client_order_id))
        params.append(("newOrderRespType", "FULL"))

        self.register_symbol_hint(client_order_id, intent.symbol)

        payload = await self._client.signed(
            method="POST",
            path="/api/v3/order",
            params=params,
            tenant_id=intent.tenant_id,
            account_id=intent.account_id,
            weight=BINANCE_REST_WEIGHTS["order_place"],
        )

        return self._parse_submit_response(payload, intent, client_order_id)

    def _parse_submit_response(
        self, payload: Any, intent: OrderIntent, client_order_id: str
    ) -> SubmitResult:
        if not isinstance(payload, Mapping):
            raise BinanceParseError(
                "Binance returned a non-object response to an order placement."
            )
        status = from_binance_status(str(payload.get("status", "NEW")))
        exchange_order_id = payload.get("orderId")
        order_id_text = str(exchange_order_id) if exchange_order_id is not None else None
        transact_time = payload.get("transactTime") or payload.get("time")
        submitted_at = (
            int(transact_time) * 1_000 if transact_time is not None else epoch_micros()
        )

        fills = self._parse_fill_list(
            payload.get("fills") or (),
            order_id=intent.client_order_id or client_order_id,
            symbol=intent.symbol,
            side=intent.side,
            exchange_order_id=order_id_text,
            fallback_timestamp_micros=submitted_at,
        )

        return SubmitResult(
            accepted=status is not OrderStatus.REJECTED,
            exchange_order_id=order_id_text,
            status=status,
            rejection_code=None,
            rejection_reason=None,
            is_simulated=False,
            submitted_at_micros=submitted_at,
            fills=fills,
        )

    def _parse_fill_list(
        self,
        raw_fills: Any,
        *,
        order_id: str,
        symbol: str,
        side: OrderSide,
        exchange_order_id: str | None,
        fallback_timestamp_micros: int,
    ) -> tuple[Fill, ...]:
        """Normalise Binance's ``fills`` array.

        Each entry is a real execution the venue performed. Nothing here
        synthesises a fill: an empty array means the order has not traded, and
        that is reported as an empty tuple.
        """
        if not isinstance(raw_fills, Sequence) or isinstance(raw_fills, (str, bytes)):
            return ()
        fills: list[Fill] = []
        for entry in raw_fills:
            if not isinstance(entry, Mapping):
                continue
            trade_id = str(entry.get("tradeId", ""))
            price = parse_decimal(entry.get("price"), "fill.price")
            quantity = parse_decimal(entry.get("qty"), "fill.qty")
            commission = parse_decimal(entry.get("commission", "0"), "fill.commission")
            fills.append(
                Fill(
                    # Deterministic per (order, trade): the same execution
                    # arriving again on the private stream deduplicates against
                    # this id instead of double-counting.
                    fill_id=f"{exchange_order_id or order_id}:{trade_id}"
                    if trade_id
                    else str(uuid.uuid4()),
                    order_id=order_id,
                    trade_id=trade_id,
                    price=price,
                    quantity=quantity,
                    fee=commission,
                    fee_currency=str(entry.get("commissionAsset") or ""),
                    is_maker=False,
                    is_simulated=False,
                    exchange_timestamp=fallback_timestamp_micros,
                    received_timestamp=epoch_micros(),
                    symbol=symbol,
                    side=side,
                    exchange=ExchangeId.BINANCE,
                    quote_quantity=price * quantity,
                    exchange_order_id=exchange_order_id,
                )
            )
        return tuple(fills)

    async def cancel_order(self, order: Order) -> CancelResult:
        """Cancel via ``DELETE /api/v3/order``, addressed by clientOrderId.

        Addressed by ``origClientOrderId`` rather than the venue's order id
        because the client id is known even when the submission response was
        lost — which is precisely the situation where a cancel is most urgent.
        """
        try:
            payload = await self._client.signed(
                method="DELETE",
                path="/api/v3/order",
                params=[
                    ("symbol", self._venue_symbol_for(order.symbol)),
                    ("origClientOrderId", order.client_order_id),
                ],
                tenant_id=order.tenant_id,
                account_id=order.account_id,
                weight=BINANCE_REST_WEIGHTS["order_cancel"],
            )
        except AdapterRejectedError as exc:
            if exc.code == "-2011":
                # "Unknown order sent": already gone. Not an error for a cancel.
                return CancelResult(
                    accepted=False,
                    status=order.status,
                    reason=(
                        "The venue has no such open order; it was already filled, "
                        "cancelled or expired."
                    ),
                    is_simulated=False,
                )
            raise

        if not isinstance(payload, Mapping):
            raise BinanceParseError(
                "Binance returned a non-object response to a cancellation."
            )
        status = from_binance_status(str(payload.get("status", "CANCELED")))
        return CancelResult(
            accepted=status in (OrderStatus.CANCELLED, OrderStatus.CANCEL_REQUESTED),
            status=status,
            reason="Cancelled at the venue.",
            is_simulated=False,
        )

    def register_symbol_hint(self, client_order_id: str, symbol: str) -> None:
        """Remember which instrument a clientOrderId belongs to.

        Bounded at 10 000 entries. An unbounded map on a long-running process
        that submits thousands of orders an hour is a slow memory leak, and the
        durable record can always re-seed a hint that has been evicted.
        """
        if len(self._symbol_hints) >= 10_000:
            self._symbol_hints.clear()
        self._symbol_hints[client_order_id] = symbol

    async def fetch_order(
        self, tenant_id: str, account_id: str, client_order_id: str
    ) -> Order | None:
        """Query one order by clientOrderId — the reconciliation path.

        Returns ``None`` only when the venue positively says the order does not
        exist (``-2013``). Any other failure raises, because "I could not ask"
        and "it is not there" must never be confused: the first means try again,
        the second means the order was never placed.

        Binance needs the symbol as well, which comes from the hint recorded at
        submission. When no hint is available the call raises rather than
        scanning every symbol: a scan would cost hundreds of weight and could
        still miss the order.
        """
        symbol = self._symbol_hints.get(client_order_id)
        if symbol is None:
            raise AdapterError(
                f"No symbol is known for clientOrderId {client_order_id}, and "
                f"Binance requires one to query an order. Call "
                f"register_symbol_hint() with the symbol from the durable "
                f"record, or use fetch_order_for() with the local Order."
            )
        return await self._fetch_order(
            tenant_id=tenant_id,
            account_id=account_id,
            client_order_id=client_order_id,
            symbol=symbol,
            template=None,
        )

    async def fetch_order_for(self, order: Order) -> Order | None:
        """Query the venue for a known local order.

        Binance's ``GET /api/v3/order`` requires the symbol alongside the client
        order id, so the local record supplies it. The returned object is a
        *venue view*: a fresh :class:`Order` carrying the venue's status and
        quantities, never the local one mutated in place, so the caller can
        compare the two before deciding what to adopt.
        """
        self.register_symbol_hint(order.client_order_id, order.symbol)
        return await self._fetch_order(
            tenant_id=order.tenant_id,
            account_id=order.account_id,
            client_order_id=order.client_order_id,
            symbol=order.symbol,
            template=order,
        )

    async def _fetch_order(
        self,
        *,
        tenant_id: str,
        account_id: str,
        client_order_id: str,
        symbol: str,
        template: Order | None,
    ) -> Order | None:
        """``GET /api/v3/order`` with the symbol resolved."""
        try:
            payload = await self._client.signed(
                method="GET",
                path="/api/v3/order",
                params=[
                    ("symbol", self._venue_symbol_for(symbol)),
                    ("origClientOrderId", client_order_id),
                ],
                tenant_id=tenant_id,
                account_id=account_id,
                weight=BINANCE_REST_WEIGHTS["order_status"],
            )
        except AdapterRejectedError as exc:
            if exc.code == "-2013":
                return None
            raise

        if not isinstance(payload, Mapping):
            raise BinanceParseError(
                "Binance returned a non-object response to an order query."
            )
        return self._order_from_payload(
            payload,
            template=template,
            tenant_id=tenant_id,
            account_id=account_id,
        )

    async def fetch_open_orders(
        self, tenant_id: str, account_id: str, *, symbol: str | None = None
    ) -> tuple[Order, ...]:
        """Every order the venue currently considers live.

        Without a symbol this costs 80 weight against a 6000/minute budget, so
        the reconciliation loop passes one where it can.
        """
        params: list[tuple[str, Any]] = []
        weight = 80
        if symbol is not None:
            params.append(("symbol", self._venue_symbol_for(symbol)))
            weight = BINANCE_REST_WEIGHTS["open_orders"]

        payload = await self._client.signed(
            method="GET",
            path="/api/v3/openOrders",
            params=params,
            tenant_id=tenant_id,
            account_id=account_id,
            weight=weight,
        )
        if not isinstance(payload, Sequence) or isinstance(payload, (str, bytes)):
            raise BinanceParseError(
                "Binance returned a non-array response to an open-orders query."
            )
        orders: list[Order] = []
        for entry in payload:
            if not isinstance(entry, Mapping):
                continue
            orders.append(
                self._order_from_payload(
                    entry, tenant_id=tenant_id, account_id=account_id
                )
            )
        return tuple(orders)

    async def exchange_time(self) -> int:
        """``GET /api/v3/time``. Unauthenticated, but venue-specific.

        Sent through the same rate-limited client so the clock probe cannot
        exhaust the budget the orders need.
        """
        self._client._reserve(BINANCE_REST_WEIGHTS["server_time"])
        request = SignedRequest(
            method="GET",
            url=f"{self._client.rest_base}/api/v3/time",
            query="",
            headers={},
        )
        payload = await self._client._dispatch(request)
        if not isinstance(payload, Mapping) or "serverTime" not in payload:
            raise BinanceParseError(
                "Binance returned an unexpected payload for server time."
            )
        return int(payload["serverTime"])

    def stream_fills(
        self, tenant_id: str, account_id: str
    ) -> AsyncIterator[Fill]:
        """Fills arrive on the private user-data stream.

        Deliberately not implemented here. The listen-key lifecycle, the
        reconnect policy and the post-reconnect reconciliation are substantial
        enough to own their own module
        (:mod:`wlct_trading.exchanges.binance.userstream`), and folding them
        into a generator would hide the connection state the platform needs to
        report. The refusal happens at call time rather than at first
        iteration: a caller asking this adapter for fills has chosen the wrong
        object, and saying so immediately is kinder than raising from inside
        a loop they have already started.
        """
        raise AdapterError(
            "Use BinanceUserDataStream for private fills; it exposes the "
            "connection state and reconnect behaviour that a bare generator "
            "cannot."
        )

    # ------------------------------------------------------------------
    # Parsing
    # ------------------------------------------------------------------
    def _order_from_payload(
        self,
        payload: Mapping[str, Any],
        *,
        template: Order | None = None,
        tenant_id: str | None = None,
        account_id: str | None = None,
    ) -> Order:
        """Build a venue-view :class:`Order` from a REST payload.

        Populates only what the venue actually told us. Fields the venue does
        not report — strategy id, signal id — are taken from the local template
        when one exists and left empty otherwise, rather than invented.
        """
        venue_symbol = str(payload.get("symbol", ""))
        symbol = template.symbol if template is not None else self._symbol_for(
            venue_symbol
        )
        raw_side = str(payload.get("side", "BUY")).upper()
        side = OrderSide.BUY if raw_side == "BUY" else OrderSide.SELL
        status = from_binance_status(str(payload.get("status", "NEW")))

        quantity = parse_decimal(payload.get("origQty", "0"), "origQty")
        executed = parse_decimal(payload.get("executedQty", "0"), "executedQty")
        quote_executed = parse_decimal(
            payload.get("cummulativeQuoteQty", "0"), "cummulativeQuoteQty"
        )
        raw_price = payload.get("price")
        price = (
            parse_decimal(raw_price, "price")
            if raw_price is not None and str(raw_price) not in ("0", "0.00000000")
            else None
        )
        raw_stop = payload.get("stopPrice")
        stop_price = (
            parse_decimal(raw_stop, "stopPrice")
            if raw_stop is not None and str(raw_stop) not in ("0", "0.00000000")
            else None
        )

        order_type = _order_type_from_venue(str(payload.get("type", "LIMIT")))
        raw_tif = str(payload.get("timeInForce", "GTC")).upper()
        time_in_force = (
            TimeInForce[raw_tif] if raw_tif in TimeInForce.__members__ else TimeInForce.GTC
        )

        update_time = payload.get("updateTime") or payload.get("time")
        updated_at = int(update_time) * 1_000 if update_time is not None else epoch_micros()

        average = (quote_executed / executed) if executed > 0 else None

        return Order(
            order_id=template.order_id if template is not None else str(uuid.uuid4()),
            client_order_id=str(payload.get("clientOrderId", "")),
            tenant_id=template.tenant_id if template is not None else (tenant_id or ""),
            account_id=(
                template.account_id if template is not None else (account_id or "")
            ),
            strategy_id=template.strategy_id if template is not None else None,
            exchange=ExchangeId.BINANCE,
            symbol=symbol,
            side=side,
            order_type=order_type,
            quantity=quantity,
            price=price,
            stop_price=stop_price,
            time_in_force=time_in_force,
            reduce_only=False,
            signal_id=template.signal_id if template is not None else None,
            is_simulated=False,
            status=status,
            exchange_order_id=(
                str(payload["orderId"]) if payload.get("orderId") is not None else None
            ),
            filled_quantity=executed,
            average_fill_price=average,
            cumulative_fee=Decimal(0),
            fee_currency=None,
            rejection_reason=None,
            created_at=(
                template.created_at if template is not None else updated_at
            ),
            updated_at=updated_at,
            submitted_at=template.submitted_at if template is not None else updated_at,
            terminal_at=(
                updated_at if status in _TERMINAL_VENUE_STATUSES else None
            ),
        )


_TERMINAL_VENUE_STATUSES = frozenset(
    {
        OrderStatus.FILLED,
        OrderStatus.CANCELLED,
        OrderStatus.REJECTED,
        OrderStatus.EXPIRED,
    }
)

_VENUE_ORDER_TYPES: dict[str, OrderType] = {
    "MARKET": OrderType.MARKET,
    "LIMIT": OrderType.LIMIT,
    "LIMIT_MAKER": OrderType.LIMIT,
    "STOP_LOSS": OrderType.STOP,
    "TAKE_PROFIT": OrderType.STOP,
    "STOP_LOSS_LIMIT": OrderType.STOP_LIMIT,
    "TAKE_PROFIT_LIMIT": OrderType.STOP_LIMIT,
}


def _order_type_from_venue(raw: str) -> OrderType:
    try:
        return _VENUE_ORDER_TYPES[raw.upper()]
    except KeyError as exc:
        raise BinanceParseError(
            f"Binance returned an unrecognised order type {raw!r}."
        ) from exc


class BinanceAccountAdapter(AccountAdapter):
    """Balances, permissions and credential verification for Binance Spot."""

    __slots__ = ("_client",)

    def __init__(
        self,
        *,
        send: SignedRequestSender,
        credentials: CredentialProvider,
        clock: ExchangeClock,
        rate_limits: RateLimitRegistry | None = None,
        testnet: bool = False,
        rest_base: str | None = None,
        recv_window_ms: int = 5_000,
        timeout_ms: int = 10_000,
    ) -> None:
        self._client = _BinanceSignedClient(
            send=send,
            credentials=credentials,
            clock=clock,
            rate_limits=rate_limits,
            testnet=testnet,
            rest_base=rest_base,
            recv_window_ms=recv_window_ms,
            timeout_ms=timeout_ms,
        )

    @property
    def exchange(self) -> ExchangeId:
        return ExchangeId.BINANCE

    async def fetch_balances(
        self, tenant_id: str, account_id: str
    ) -> tuple[AccountBalance, ...]:
        account = await self.fetch_account(tenant_id, account_id)
        return account.balances

    async def fetch_account(self, tenant_id: str, account_id: str) -> VenueAccount:
        """``GET /api/v3/account``, normalised.

        ``omitZeroBalances`` is not requested: the full list is fetched so a
        balance that has just gone to zero is reported as zero rather than
        vanishing, which would look identical to a parse failure.
        """
        payload = await self._client.signed(
            method="GET",
            path="/api/v3/account",
            params=[],
            tenant_id=tenant_id,
            account_id=account_id,
            weight=BINANCE_REST_WEIGHTS["account"],
        )
        if not isinstance(payload, Mapping):
            raise BinanceParseError(
                "Binance returned a non-object response to an account query."
            )

        raw_balances = payload.get("balances") or ()
        balances: list[AccountBalance] = []
        if isinstance(raw_balances, Sequence) and not isinstance(
            raw_balances, (str, bytes)
        ):
            for entry in raw_balances:
                if not isinstance(entry, Mapping):
                    continue
                balances.append(
                    AccountBalance(
                        asset=str(entry.get("asset", "")),
                        free=parse_decimal(entry.get("free", "0"), "balance.free"),
                        locked=parse_decimal(
                            entry.get("locked", "0"), "balance.locked"
                        ),
                    )
                )

        update_time = payload.get("updateTime")
        return VenueAccount(
            exchange=ExchangeId.BINANCE,
            balances=tuple(balances),
            can_trade=bool(payload.get("canTrade", False)),
            can_withdraw=bool(payload.get("canWithdraw", False)),
            can_deposit=bool(payload.get("canDeposit", False)),
            account_type=str(payload.get("accountType", "SPOT")),
            updated_at_micros=int(update_time) * 1_000 if update_time else None,
            maker_commission_bps=_commission_bps(payload.get("makerCommission")),
            taker_commission_bps=_commission_bps(payload.get("takerCommission")),
        )

    async def fetch_positions(
        self, tenant_id: str, account_id: str
    ) -> tuple[VenuePosition, ...]:
        """Spot has no positions.

        Returning an empty tuple is the honest answer. A spot balance is not a
        position: it has no entry price, no leverage and no liquidation, and
        presenting one as a position would give the reconciliation service a
        cost basis it would then compare against a real one and always find
        wrong.
        """
        return ()

    async def verify_credentials(
        self, tenant_id: str, account_id: str
    ) -> tuple[bool, str]:
        """Check the key works and is safe to hold.

        Withdrawal capability is a hard failure. The platform is non-custodial;
        a key that can move funds off the exchange turns a compromise of this
        platform into a loss of customer funds, and no feature is worth that.
        """
        try:
            account = await self.fetch_account(tenant_id, account_id)
        except AdapterRejectedError as exc:
            return (False, f"The venue rejected these credentials: {exc}")
        except AdapterRateLimitedError as exc:
            return (False, f"Could not verify: {exc}")
        except AdapterConnectionError as exc:
            return (False, f"Could not reach the venue to verify: {exc}")

        if account.can_withdraw:
            return (
                False,
                "This API key has WITHDRAWAL permission enabled. The platform "
                "refuses withdrawal-capable keys. Recreate the key on Binance "
                "with only 'Enable Reading' and 'Enable Spot & Margin Trading', "
                "and consider adding an IP allowlist.",
            )
        if not account.can_trade:
            return (
                False,
                "This API key cannot trade. Enable 'Enable Spot & Margin "
                "Trading' on Binance, or connect it as a read-only account.",
            )
        return (
            True,
            f"Verified: spot trading enabled, withdrawals disabled, "
            f"{len(account.non_zero_balances)} funded asset(s).",
        )


def _commission_bps(raw: Any) -> Decimal | None:
    """Binance reports commission in units of 0.01%, i.e. basis points."""
    if raw is None:
        return None
    try:
        return Decimal(str(raw))
    except (TypeError, ValueError, ArithmeticError):
        return None
```

---

## FILE: libs/trading-core/wlct_trading/exchanges/binance/signing.py

Changed by the sweep: ruff F401: unused ``dataclasses.field`` import removed.

```py
"""Binance signed-request construction.

Isolated here so that exactly one file in the repository knows how a Binance
signature is produced. The execution engine, the risk engine and every strategy
are written against ``TradingAdapter`` and have no idea this file exists.

The protocol, per Binance's published SIGNED (TRADE and USER_DATA) endpoint
specification:

* The signature is ``HMAC-SHA256(secret, payload)`` rendered as lowercase hex.
* The payload is the **exact query string / request body that is transmitted**,
  concatenated as ``queryString + requestBody`` when both are present.
* ``timestamp`` is required, in **milliseconds**.
* ``recvWindow`` is optional and caps how long the request stays valid; Binance
  rejects when ``timestamp < serverTime + 1000`` fails or when
  ``serverTime - timestamp > recvWindow``.
* ``signature`` is appended last and is itself never signed.
* The API key travels in the ``X-MBX-APIKEY`` header, never in the payload.

Two details cause most real-world signature failures and are handled explicitly:

1. **Parameter order must match between signing and sending.** Binance signs the
   literal string, not a canonicalised set, so if the HTTP client re-orders or
   re-encodes parameters the signature breaks. This module therefore produces
   the final encoded string itself and the caller must transmit it verbatim.
2. **Encoding must match too.** ``quote`` with ``safe=""`` is used so that every
   reserved character is percent-encoded identically in the signed string and
   the transmitted one.

Nothing here logs, and nothing here returns the secret. The signature is a
one-way function of it, and :class:`SignedRequest` redacts itself.
"""

from __future__ import annotations

import hashlib
import hmac
from dataclasses import dataclass
from decimal import Decimal
from typing import Any, Mapping, Sequence
from urllib.parse import quote

from wlct_trading.execution.credentials import REDACTED, ExchangeCredentials

__all__ = [
    "BINANCE_API_KEY_HEADER",
    "SignedRequest",
    "encode_params",
    "format_decimal",
    "binance_signature",
    "build_signed_request",
    "SignatureError",
]

BINANCE_API_KEY_HEADER = "X-MBX-APIKEY"


class SignatureError(Exception):
    """Raised when a request cannot be signed safely."""


def format_decimal(value: Decimal) -> str:
    """Render a Decimal the way an exchange expects.

    Plain notation always: ``1E-8`` is a valid Python repr and an invalid
    Binance quantity. Trailing zeros are stripped because they change the signed
    string without changing the value, and a mismatch between what the caller
    thinks it sent and what was signed is the single most common cause of a
    ``-1022 Signature for this request is not valid`` error.
    """
    if not isinstance(value, Decimal):  # pragma: no cover - defensive
        raise SignatureError(f"Expected Decimal, got {type(value).__name__}.")
    if value != value:  # NaN
        raise SignatureError("Cannot send a NaN quantity or price to an exchange.")
    if value.is_infinite():
        raise SignatureError("Cannot send an infinite quantity or price.")

    normalised = value.normalize()
    sign, digits, exponent = normalised.as_tuple()
    if isinstance(exponent, int) and exponent > 0:
        # normalize() renders 100 as 1E+2; expand it back.
        normalised = normalised.quantize(Decimal(1))
    text = format(normalised, "f")
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return text or "0"


def _render(value: Any) -> str:
    """Convert one parameter value to its transmitted string form."""
    if isinstance(value, bool):
        # Binance expects the JSON-style lowercase spelling, not Python's True.
        return "true" if value else "false"
    if isinstance(value, Decimal):
        return format_decimal(value)
    if isinstance(value, float):
        raise SignatureError(
            "Refusing to send a float to an exchange: binary floating point "
            "cannot represent a price or quantity exactly. Use Decimal."
        )
    return str(value)


def encode_params(params: Sequence[tuple[str, Any]]) -> str:
    """Percent-encode an ordered parameter list into a query string.

    Order is preserved exactly as given, because the signature covers the
    literal string. ``safe=""`` forces every reserved character — including
    ``/``, ``:`` and ``+`` — to be encoded, matching what the HTTP client will
    transmit when handed the pre-encoded string.

    ``None`` values are dropped, which is what lets a caller pass an optional
    parameter unconditionally without perturbing the signature.
    """
    parts: list[str] = []
    for key, value in params:
        if value is None:
            continue
        parts.append(f"{quote(str(key), safe='')}={quote(_render(value), safe='')}")
    return "&".join(parts)


def binance_signature(secret: str, payload: str) -> str:
    """HMAC-SHA256 of ``payload`` under ``secret``, lowercase hex.

    A thin, deliberately boring wrapper. It exists as a named function so the
    signature algorithm has exactly one definition and one test.
    """
    return hmac.new(
        secret.encode("utf-8"), payload.encode("utf-8"), hashlib.sha256
    ).hexdigest()


@dataclass(frozen=True)
class SignedRequest:
    """A fully prepared authenticated request.

    ``query`` already contains the signature and is the exact string that must
    be transmitted. The caller must **not** re-encode it or pass it through a
    parameter dict, or the signature will no longer match the payload.
    """

    method: str
    url: str
    query: str
    headers: Mapping[str, str]
    #: The signed payload, retained for diagnostics. Contains no secret: the
    #: secret is the HMAC key, never part of the message.
    signed_payload: str = ""
    #: Milliseconds. Kept so the caller can measure and report skew.
    timestamp_millis: int = 0

    @property
    def full_url(self) -> str:
        return f"{self.url}?{self.query}" if self.query else self.url

    def __repr__(self) -> str:
        # The API key lives in the headers, so headers are never rendered.
        return (
            f"SignedRequest(method={self.method!r}, url={self.url!r}, "
            f"headers={{{BINANCE_API_KEY_HEADER}: {REDACTED}}}, "
            f"query={REDACTED!r})"
        )

    __str__ = __repr__

    def to_log_fields(self) -> dict[str, object]:
        """Log-safe description.

        The query string is omitted in full: it carries the signature, and a
        logged signature plus a logged payload is a gift to anyone attempting an
        offline attack on the secret.
        """
        return {
            "method": self.method,
            "url": self.url,
            "timestampMillis": self.timestamp_millis,
            "signed": True,
            "query": REDACTED,
        }


def build_signed_request(
    *,
    method: str,
    base_url: str,
    path: str,
    params: Sequence[tuple[str, Any]],
    credentials: ExchangeCredentials,
    timestamp_millis: int,
    recv_window_millis: int | None = 5_000,
) -> SignedRequest:
    """Build a signed Binance REST request.

    ``params`` is an ordered sequence rather than a mapping so the caller
    controls the exact signed string. ``timestamp`` and ``recvWindow`` are
    appended here — in that order, immediately before ``signature`` — so every
    signed request in the codebase has an identical tail and a signature
    mismatch can never be caused by two call sites disagreeing about ordering.

    Raises :class:`SignatureError` rather than producing an unusable request.
    """
    upper_method = method.upper()
    if upper_method not in ("GET", "POST", "PUT", "DELETE"):
        raise SignatureError(f"Unsupported HTTP method {method!r}.")
    if not base_url.startswith("https://"):
        raise SignatureError(
            f"Refusing to sign a request to a non-TLS endpoint: {base_url!r}. "
            f"A signed request over plaintext exposes the signature and the key."
        )
    if timestamp_millis <= 0:
        raise SignatureError(
            "A signed request needs a positive millisecond timestamp. Synchronise "
            "with the exchange clock before signing."
        )
    if recv_window_millis is not None and not 0 < recv_window_millis <= 60_000:
        # Binance caps recvWindow at 60 000 ms and rejects anything larger.
        raise SignatureError(
            f"recvWindow must be between 1 and 60000 ms; got {recv_window_millis}."
        )

    ordered: list[tuple[str, Any]] = [
        (key, value) for key, value in params if value is not None
    ]
    for reserved in ("signature", "timestamp", "recvWindow"):
        if any(key == reserved for key, _value in ordered):
            raise SignatureError(
                f"{reserved!r} is added by the signer and must not be supplied by "
                f"the caller."
            )

    if recv_window_millis is not None:
        ordered.append(("recvWindow", recv_window_millis))
    ordered.append(("timestamp", timestamp_millis))

    payload = encode_params(ordered)
    signature = binance_signature(credentials.api_secret, payload)
    query = f"{payload}&signature={signature}" if payload else f"signature={signature}"

    return SignedRequest(
        method=upper_method,
        url=f"{base_url.rstrip('/')}{path}",
        query=query,
        headers={BINANCE_API_KEY_HEADER: credentials.api_key},
        signed_payload=payload,
        timestamp_millis=timestamp_millis,
    )


def build_keyed_request(
    *,
    method: str,
    base_url: str,
    path: str,
    params: Sequence[tuple[str, Any]] = (),
    credentials: ExchangeCredentials,
) -> SignedRequest:
    """Build a key-authenticated but *unsigned* request.

    Binance's USER_STREAM endpoints (listen key create/keepalive/close) take the
    API key header but no signature. Giving them their own builder keeps the
    signed path from growing an "optional signature" branch — the kind of branch
    that eventually gets taken by accident on an endpoint that needed signing.
    """
    upper_method = method.upper()
    if not base_url.startswith("https://"):
        raise SignatureError(
            f"Refusing to send an authenticated request to a non-TLS endpoint: "
            f"{base_url!r}."
        )
    query = encode_params(list(params))
    return SignedRequest(
        method=upper_method,
        url=f"{base_url.rstrip('/')}{path}",
        query=query,
        headers={BINANCE_API_KEY_HEADER: credentials.api_key},
        signed_payload="",
        timestamp_millis=0,
    )
```

---

## FILE: libs/trading-core/wlct_trading/exchanges/symbols.py

Changed by the sweep: ``SymbolRef`` added to ``__all__`` so the barrel's re-export is explicit.

```py
"""Centralised symbol normalisation.

The same market is written differently by every venue: ``BTCUSDT`` on Binance
and Bybit, ``BTC-USDT`` on OKX, ``BTC-USD`` on Coinbase, ``XBT/USD`` on Kraken.
If those strings are converted ad hoc at each call site, two things go wrong
almost immediately — a position opened under one spelling cannot be found under
another, and Kraken's ``XBT`` silently becomes a different instrument from
``BTC``.

So conversion happens in exactly one place. The canonical form is
``BASE-QUOTE`` with upper-case assets and a single hyphen: ``BTC-USDT``.

Authoritative first, heuristic second
-------------------------------------
Splitting ``BTCUSDT`` into base and quote is genuinely ambiguous without
knowing the venue's asset list — ``BTCUSDT`` could in principle be ``BTCU``/
``SDT``. Every venue publishes the correct split in its instrument metadata, so
:meth:`SymbolRegistry.register_specification` records the authoritative answer
and it is always preferred. The heuristic in :func:`split_concatenated_symbol`
exists only for the bootstrap window before metadata has loaded, tries the
longest known quote assets first, and is documented as a fallback rather than a
source of truth.
"""

from __future__ import annotations

from dataclasses import dataclass

from wlct_trading.enums import ExchangeId, MarketType
from wlct_trading.market_data import SymbolRef

__all__ = [
    # Re-exported explicitly: net/feed and net/symbols import the canonical
    # symbol handle from here rather than from market_data, so under
    # no-implicit-reexport this module must own the export.
    "SymbolRef",
    "CANONICAL_SEPARATOR",
    "KNOWN_QUOTE_ASSETS",
    "KNOWN_BASE_ASSETS",
    "ASSET_ALIASES",
    "SymbolMapping",
    "SymbolRegistry",
    "UnknownSymbol",
    "canonicalise_asset",
    "split_concatenated_symbol",
    "to_canonical",
]

CANONICAL_SEPARATOR = "-"

#: Quote assets ordered longest-first so a greedy suffix match prefers the
#: longer candidate: ``ETHUSDT`` must split as ETH/USDT, not ETH/USD + stray T.
KNOWN_QUOTE_ASSETS: tuple[str, ...] = (
    "USDT",
    "USDC",
    "TUSD",
    "BUSD",
    "FDUSD",
    "DAI",
    "USD",
    "EUR",
    "GBP",
    "JPY",
    "TRY",
    "BRL",
    "AUD",
    "BTC",
    "ETH",
    "BNB",
    "SOL",
    "XBT",
)

#: Venue-specific asset spellings mapped to the canonical one. Kraken's use of
#: ``XBT`` for Bitcoin and its ``X``/``Z`` prefixes are the usual offenders.
ASSET_ALIASES: dict[str, str] = {
    "XBT": "BTC",
    "XXBT": "BTC",
    "XETH": "ETH",
    "XDG": "DOGE",
    "ZUSD": "USD",
    "ZEUR": "EUR",
    "ZGBP": "GBP",
    "ZJPY": "JPY",
}

#: Base assets used to disambiguate the fallback split. Longest-suffix matching
#: alone is wrong: ``XBTUSD`` ends with ``TUSD``, which would yield a base of
#: ``XB``. Preferring a candidate whose base is a recognised asset resolves it
#: to ``XBT``/``USD``. This list only has to cover the liquid majors — anything
#: else arrives with authoritative metadata anyway.
KNOWN_BASE_ASSETS: frozenset[str] = frozenset(
    {
        "BTC", "XBT", "ETH", "BNB", "SOL", "XRP", "ADA", "DOGE", "TRX", "TON",
        "AVAX", "DOT", "MATIC", "LINK", "LTC", "BCH", "NEAR", "UNI", "ICP",
        "APT", "ETC", "XLM", "ATOM", "FIL", "HBAR", "ARB", "OP", "INJ", "SUI",
        "SEI", "TIA", "RUNE", "AAVE", "ALGO", "VET", "GRT", "SAND", "MANA",
        "EOS", "XTZ", "THETA", "AXS", "FTM", "EGLD", "PEPE", "SHIB", "WIF",
        "USDT", "USDC", "DAI",
    }
)


class UnknownSymbol(Exception):
    """Raised when a symbol cannot be resolved for a venue."""


def canonicalise_asset(asset: str) -> str:
    """Upper-case an asset code and resolve venue-specific aliases."""
    upper = asset.strip().upper()
    return ASSET_ALIASES.get(upper, upper)


def split_concatenated_symbol(
    venue_symbol: str, *, quote_assets: tuple[str, ...] = KNOWN_QUOTE_ASSETS
) -> tuple[str, str] | None:
    """Best-effort split of a separator-less symbol into ``(base, quote)``.

    Fallback only — see the module docstring. Every quote asset that matches as
    a suffix is considered, and a candidate whose base is a recognised asset
    wins over one whose base is not; ties break towards the longer quote. That
    ordering is what makes ``XBTUSD`` resolve to ``XBT``/``USD`` instead of
    ``XB``/``TUSD``.

    Returns ``None`` when no known quote asset matches, which the caller must
    treat as "unknown" rather than guessing further.
    """
    cleaned = venue_symbol.strip().upper()
    if not cleaned:
        return None

    candidates: list[tuple[int, int, str, str]] = []
    for quote in quote_assets:
        if not cleaned.endswith(quote) or len(cleaned) <= len(quote):
            continue
        base = cleaned[: -len(quote)]
        if not base:
            continue
        base_is_known = base in KNOWN_BASE_ASSETS or base in ASSET_ALIASES
        candidates.append((1 if base_is_known else 0, len(quote), base, quote))

    if not candidates:
        return None

    _, _, base, quote = max(candidates, key=lambda c: (c[0], c[1]))
    return canonicalise_asset(base), canonicalise_asset(quote)


def to_canonical(base: str, quote: str) -> str:
    """Build the canonical ``BASE-QUOTE`` form."""
    return f"{canonicalise_asset(base)}{CANONICAL_SEPARATOR}{canonicalise_asset(quote)}"


@dataclass(slots=True, frozen=True)
class SymbolMapping:
    """Authoritative correspondence between a canonical symbol and a venue's."""

    canonical: str
    venue_symbol: str
    exchange: ExchangeId
    base_asset: str
    quote_asset: str
    market_type: MarketType = MarketType.SPOT

    @property
    def key(self) -> tuple[str, str, str]:
        return (self.exchange.value, self.market_type.value, self.canonical)

    def to_symbol_ref(self) -> SymbolRef:
        return SymbolRef(
            exchange=self.exchange,
            symbol=self.canonical,
            venue_symbol=self.venue_symbol,
            market_type=self.market_type,
        )


class SymbolRegistry:
    """Bidirectional symbol translation for every venue.

    One instance is shared by the market-data service and the execution engine
    so both resolve a symbol identically. Lookups are dictionary hits, cheap
    enough for the hot path.
    """

    __slots__ = ("_by_canonical", "_by_venue", "_quote_assets")

    def __init__(self, *, quote_assets: tuple[str, ...] = KNOWN_QUOTE_ASSETS) -> None:
        # (exchange, market_type, canonical) -> mapping
        self._by_canonical: dict[tuple[str, str, str], SymbolMapping] = {}
        # (exchange, market_type, venue_symbol_upper) -> mapping
        self._by_venue: dict[tuple[str, str, str], SymbolMapping] = {}
        self._quote_assets = quote_assets

    # ------------------------------------------------------------------
    # Registration
    # ------------------------------------------------------------------
    def register(self, mapping: SymbolMapping) -> SymbolMapping:
        """Record an authoritative mapping, replacing any previous one."""
        self._by_canonical[mapping.key] = mapping
        self._by_venue[
            (
                mapping.exchange.value,
                mapping.market_type.value,
                mapping.venue_symbol.upper(),
            )
        ] = mapping
        return mapping

    def register_specification(self, specification: object) -> SymbolMapping:
        """Register from an adapter's :class:`SymbolSpecification`.

        Duck-typed rather than imported to keep this module free of a
        dependency on ``adapters.base``, which would otherwise create an import
        cycle: adapters need symbols, and symbols would need adapters.
        """
        mapping = SymbolMapping(
            canonical=to_canonical(
                getattr(specification, "base_asset"),
                getattr(specification, "quote_asset"),
            ),
            venue_symbol=getattr(specification, "venue_symbol"),
            exchange=getattr(specification, "exchange"),
            base_asset=canonicalise_asset(getattr(specification, "base_asset")),
            quote_asset=canonicalise_asset(getattr(specification, "quote_asset")),
            market_type=getattr(specification, "market_type", MarketType.SPOT),
        )
        return self.register(mapping)

    def register_many(self, mappings: tuple[SymbolMapping, ...]) -> int:
        for mapping in mappings:
            self.register(mapping)
        return len(mappings)

    # ------------------------------------------------------------------
    # Resolution
    # ------------------------------------------------------------------
    def to_venue_symbol(
        self,
        canonical: str,
        exchange: ExchangeId,
        *,
        market_type: MarketType = MarketType.SPOT,
    ) -> str:
        """Canonical to venue-native. Raises if the pair is not registered.

        Deliberately strict: fabricating a venue symbol by string manipulation
        is how an order gets sent for an instrument that does not exist.
        """
        mapping = self._by_canonical.get(
            (exchange.value, market_type.value, canonical.upper())
        )
        if mapping is None:
            raise UnknownSymbol(
                f"{canonical} is not registered for {exchange.value} "
                f"{market_type.value}. Load instrument metadata first."
            )
        return mapping.venue_symbol

    def to_canonical_symbol(
        self,
        venue_symbol: str,
        exchange: ExchangeId,
        *,
        market_type: MarketType = MarketType.SPOT,
        allow_heuristic: bool = True,
    ) -> str:
        """Venue-native to canonical.

        Uses the registry first. Falls back to parsing only when
        ``allow_heuristic`` is set, which is appropriate for inbound market data
        during the metadata bootstrap window but not for anything order-related.
        """
        key = (exchange.value, market_type.value, venue_symbol.upper())
        mapping = self._by_venue.get(key)
        if mapping is not None:
            return mapping.canonical

        if not allow_heuristic:
            raise UnknownSymbol(
                f"{venue_symbol} is not registered for {exchange.value} "
                f"{market_type.value}."
            )

        parsed = self.parse_venue_symbol(venue_symbol)
        if parsed is None:
            raise UnknownSymbol(
                f"Cannot determine base/quote for {venue_symbol!r} on "
                f"{exchange.value}."
            )
        return to_canonical(*parsed)

    def parse_venue_symbol(self, venue_symbol: str) -> tuple[str, str] | None:
        """Parse a venue symbol into ``(base, quote)`` without the registry.

        Handles the three separator conventions plus the concatenated form.
        """
        cleaned = venue_symbol.strip().upper()
        if not cleaned:
            return None

        for separator in (CANONICAL_SEPARATOR, "/", "_", ":"):
            if separator in cleaned:
                parts = [p for p in cleaned.split(separator) if p]
                if len(parts) == 2:
                    return canonicalise_asset(parts[0]), canonicalise_asset(parts[1])
                return None

        return split_concatenated_symbol(cleaned, quote_assets=self._quote_assets)

    def get(
        self,
        canonical: str,
        exchange: ExchangeId,
        *,
        market_type: MarketType = MarketType.SPOT,
    ) -> SymbolMapping | None:
        return self._by_canonical.get(
            (exchange.value, market_type.value, canonical.upper())
        )

    def symbol_ref(
        self,
        canonical: str,
        exchange: ExchangeId,
        *,
        market_type: MarketType = MarketType.SPOT,
    ) -> SymbolRef:
        """Resolve to the Part 2 :class:`SymbolRef` used throughout the core."""
        mapping = self.get(canonical, exchange, market_type=market_type)
        if mapping is None:
            raise UnknownSymbol(
                f"{canonical} is not registered for {exchange.value} "
                f"{market_type.value}."
            )
        return mapping.to_symbol_ref()

    def is_registered(
        self,
        canonical: str,
        exchange: ExchangeId,
        *,
        market_type: MarketType = MarketType.SPOT,
    ) -> bool:
        return (
            exchange.value,
            market_type.value,
            canonical.upper(),
        ) in self._by_canonical

    def all_for_exchange(self, exchange: ExchangeId) -> tuple[SymbolMapping, ...]:
        return tuple(
            m for m in self._by_canonical.values() if m.exchange is exchange
        )

    @property
    def count(self) -> int:
        return len(self._by_canonical)

    def clear(self) -> None:
        self._by_canonical.clear()
        self._by_venue.clear()
```

---

## FILE: libs/trading-core/wlct_trading/execution/engine.py

Changed by the sweep: ``_safe_transition`` annotated ``-> OrderEvent | None``; ``_gate_error_code`` if-chain replaced by a table with a default, because an exhaustive chain makes its own fallback provably dead to the checker while remaining the protection it was written for.

```py
"""The execution engine.

This is the single path by which an intent becomes an order at a venue. It is
exchange-agnostic: it talks to :class:`~wlct_trading.adapters.base.TradingAdapter`
and has no idea whether the venue behind it is Binance, a simulator, or
something that has not been written yet.

The sequence, in full::

    intent
      -> deterministic clientOrderId          (idempotency key)
      -> pre-network validation               (10 checks)
      -> pre-submit safety gates              (10 gates, all required)
      -> risk engine                          (mandatory, fail-closed)
      -> execution lock                       (one worker per order)
      -> clientOrderId reservation            (cross-worker duplicate guard)
      -> durable Order record + SUBMITTED event
      -> [DRY RUN stops here]
      -> adapter.submit_order                 (signs and transmits)
      -> outcome
           accepted   -> ACKNOWLEDGED/FILLED, fills applied to positions
           rejected   -> REJECTED, terminal, no position change
           ambiguous  -> stays SUBMITTED, marked UNKNOWN, incident, reconcile

Four properties are non-negotiable and are enforced here rather than left to
callers:

**Risk is mandatory.** There is no parameter that skips it. When the risk engine
is unavailable the order is refused, not waved through.

**Ambiguity never resubmits.** An :class:`AdapterConnectionError` means the
request may have reached the venue. The engine records that it does not know,
and hands the order to reconciliation. It never retries, because a retry that
the venue deduplicates is harmless and a retry that it does not is a doubled
position.

**Fills are never invented.** Every fill the engine applies came from an adapter
that got it from a venue. There is no code path that constructs a fill from an
assumption, and simulated fills carry ``is_simulated=True`` all the way to the
database.

**Marking precedes acting.** The order is persisted, and the unknown marker is
written, *before* the network call. A process that dies mid-request leaves a
record behind; one that persists afterwards does not.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field, replace
from decimal import Decimal
from enum import Enum
from typing import Awaitable, Callable, Mapping

from wlct_trading.adapters.base import (
    AdapterConnectionError,
    AdapterError,
    AdapterRateLimitedError,
    AdapterRejectedError,
    SubmitResult,
    SymbolSpecification,
    TradingAdapter,
)
from wlct_trading.clock import epoch_micros, monotonic_nanos
from wlct_trading.enums import (
    ExchangeId,
    OrderStatus,
    TERMINAL_ORDER_STATUSES,
    TradingMode,
)
from wlct_trading.execution.config import ExecutionSettings
from wlct_trading.execution.credentials import ExchangeCredentials
from wlct_trading.execution.incidents import (
    ExecutionErrorCode,
    ExecutionIncident,
    IncidentRecorder,
    IncidentSeverity,
    IncidentType,
)
from wlct_trading.execution.locks import (
    LockManager,
    LockNotAcquired,
    account_lock_key,
    order_lock_key,
)
from wlct_trading.execution.safety import (
    ComponentHealth,
    ExecutionPreconditions,
    SafetyDecision,
    SafetyGate,
    evaluate_safety_gates,
)
from wlct_trading.execution.store import (
    OrderStore,
    ReconciliationState,
)
from wlct_trading.execution.timesync import ClockSkewExceeded, ClockSyncError
from wlct_trading.execution.validation import OrderValidator, ValidationResult
from wlct_trading.idempotency import build_client_order_id
from wlct_trading.orders import Fill, InvalidOrderTransition, Order, OrderEvent, OrderIntent
from wlct_trading.positions import PositionManager, PositionUpdate
from wlct_trading.risk import KillSwitchState, RiskDecision, RiskEngine, RiskSnapshot

__all__ = [
    "ExecutionOutcome",
    "ExecutionResult",
    "ExecutionContext",
    "ExecutionEngine",
    "EngineConfigurationError",
]


class EngineConfigurationError(RuntimeError):
    """The engine is wired in a way that is unsafe for the requested mode."""


class ExecutionOutcome(str, Enum):
    """What happened to a submission attempt."""

    #: The venue accepted the order.
    ACCEPTED = "ACCEPTED"
    #: Refused locally, before any network activity.
    REJECTED_LOCALLY = "REJECTED_LOCALLY"
    #: The venue positively refused it. The order does not exist there.
    REJECTED_BY_EXCHANGE = "REJECTED_BY_EXCHANGE"
    #: Already submitted under this idempotency key. Nothing was sent.
    DUPLICATE = "DUPLICATE"
    #: Built, validated, risk-checked and then deliberately not transmitted.
    DRY_RUN = "DRY_RUN"
    #: The request may or may not have reached the venue. Reconciliation owns it
    #: from here. **Never** retried.
    UNKNOWN = "UNKNOWN"

    @property
    def order_exists_at_venue(self) -> bool:
        """Whether an order may exist at the venue as a result of this attempt.

        ``UNKNOWN`` answers ``True`` because it might, and every caller must
        treat "might" as "does" until reconciliation says otherwise.
        """
        return self in (ExecutionOutcome.ACCEPTED, ExecutionOutcome.UNKNOWN)


@dataclass(frozen=True, slots=True)
class ExecutionResult:
    """The complete outcome of one submission attempt.

    Returned for every path including failure, rather than raising, because a
    rejected order is a normal business event that the caller must record — not
    an exception.
    """

    outcome: ExecutionOutcome
    client_order_id: str
    order: Order | None = None
    error_code: ExecutionErrorCode | None = None
    message: str = ""
    validation: ValidationResult | None = None
    safety: SafetyDecision | None = None
    risk: RiskDecision | None = None
    submit_result: SubmitResult | None = None
    fills: tuple[Fill, ...] = field(default_factory=tuple)
    position_updates: tuple[PositionUpdate, ...] = field(default_factory=tuple)
    incident: ExecutionIncident | None = None
    #: End-to-end wall time for the attempt, measured monotonically.
    latency_micros: int = 0
    #: True only when bytes actually left the process for a real venue.
    transmitted: bool = False
    is_simulated: bool = False

    @property
    def succeeded(self) -> bool:
        return self.outcome in (ExecutionOutcome.ACCEPTED, ExecutionOutcome.DRY_RUN)

    @property
    def requires_reconciliation(self) -> bool:
        return self.outcome is ExecutionOutcome.UNKNOWN

    def to_dict(self) -> dict[str, object]:
        """API-safe rendering.

        No credential material can reach this: the engine never holds a secret,
        only an :class:`ExchangeCredentials` it passes to the adapter, and
        nothing from it is copied here.
        """
        return {
            "outcome": self.outcome.value,
            "clientOrderId": self.client_order_id,
            "orderId": self.order.order_id if self.order else None,
            "exchangeOrderId": self.order.exchange_order_id if self.order else None,
            "status": self.order.status.value if self.order else None,
            "errorCode": self.error_code.value if self.error_code else None,
            "message": self.message,
            "transmitted": self.transmitted,
            "isSimulated": self.is_simulated,
            "requiresReconciliation": self.requires_reconciliation,
            "fillCount": len(self.fills),
            "latencyMicros": self.latency_micros,
            "incidentId": self.incident.incident_id if self.incident else None,
        }


@dataclass(slots=True)
class ExecutionContext:
    """Everything the engine needs that it cannot derive itself.

    Assembled fresh per submission by the caller (the strategy runner or the
    API) so that no gate reads a cached value. Every health field defaults to
    "unknown", which blocks — a caller that forgets to populate one cannot
    accidentally open a gate.
    """

    snapshot: RiskSnapshot
    kill_switches: KillSwitchState
    specification: SymbolSpecification | None = None
    reference_price: Decimal | None = None
    risk_health: ComponentHealth = field(default_factory=ComponentHealth)
    market_data_health: ComponentHealth = field(default_factory=ComponentHealth)
    exchange_health: ComponentHealth = field(default_factory=ComponentHealth)
    credentials: ExchangeCredentials | None = None
    market_data_required: bool = True
    #: Overrides the engine default when a venue needs a longer lock (a slow
    #: cancel-replace, for example).
    lock_ttl_millis: int | None = None


class ExecutionEngine:
    """Turns validated intents into venue orders, safely.

    One instance per (exchange, mode) pair. It is safe to share across tenants:
    every method takes the tenant from the intent and every store and lock call
    is tenant-scoped, so there is no shared mutable state that could leak
    between them.
    """

    __slots__ = (
        "_adapter",
        "_settings",
        "_validator",
        "_risk_engine",
        "_store",
        "_locks",
        "_incidents",
        "_positions",
        "_publish",
        "_metrics",
        "_default_lock_ttl_millis",
    )

    def __init__(
        self,
        *,
        adapter: TradingAdapter,
        settings: ExecutionSettings,
        risk_engine: RiskEngine,
        store: OrderStore,
        locks: LockManager,
        incidents: IncidentRecorder,
        validator: OrderValidator | None = None,
        positions: PositionManager | None = None,
        publish_event: Callable[[str, Mapping[str, object]], Awaitable[None]]
        | None = None,
        metrics: object | None = None,
        default_lock_ttl_millis: int = 15_000,
    ) -> None:
        self._adapter = adapter
        self._settings = settings
        self._risk_engine = risk_engine
        self._store = store
        self._locks = locks
        self._incidents = incidents
        self._validator = validator or OrderValidator()
        self._positions = positions
        self._publish = publish_event
        self._metrics = metrics
        self._default_lock_ttl_millis = default_lock_ttl_millis
        self._assert_wiring_is_safe()

    def _assert_wiring_is_safe(self) -> None:
        """Refuse combinations that are unsafe for the configured mode.

        Checked once at construction so a misconfigured deployment fails at
        startup rather than on its first order.
        """
        if not self._settings.will_transmit_orders:
            return
        if self._adapter.is_simulated:
            raise EngineConfigurationError(
                "Live trading is enabled but the wired adapter is a simulator. "
                "Refusing to start: a paper adapter presenting live results "
                "would make simulated fills indistinguishable from real ones."
            )
        if not self._locks.is_distributed:
            raise EngineConfigurationError(
                "Live trading is enabled with an in-process lock manager. "
                "Refusing to start: a second worker would be able to submit "
                "concurrently for the same order. Configure RedisLockManager."
            )
        if getattr(self._store, "is_durable", True) is False:
            raise EngineConfigurationError(
                "Live trading is enabled with a non-durable in-memory order "
                "store. Refusing to start: a restart would lose the record of "
                "live orders and positions."
            )

    # ------------------------------------------------------------------
    # Properties
    # ------------------------------------------------------------------
    @property
    def exchange(self) -> ExchangeId:
        return self._adapter.exchange

    @property
    def is_simulated(self) -> bool:
        return self._adapter.is_simulated

    @property
    def settings(self) -> ExecutionSettings:
        return self._settings

    # ------------------------------------------------------------------
    # Submission
    # ------------------------------------------------------------------
    async def submit(
        self, intent: OrderIntent, context: ExecutionContext
    ) -> ExecutionResult:
        """Run the full pipeline for one intent.

        Never raises for an expected failure. Validation problems, risk
        rejections, blocked gates and venue refusals all come back as an
        :class:`ExecutionResult` with an outcome and an error code.
        """
        started_nanos = monotonic_nanos()
        client_order_id = intent.client_order_id or build_client_order_id(intent)

        def finish(result: ExecutionResult) -> ExecutionResult:
            elapsed = (monotonic_nanos() - started_nanos) // 1_000
            return ExecutionResult(
                outcome=result.outcome,
                client_order_id=result.client_order_id,
                order=result.order,
                error_code=result.error_code,
                message=result.message,
                validation=result.validation,
                safety=result.safety,
                risk=result.risk,
                submit_result=result.submit_result,
                fills=result.fills,
                position_updates=result.position_updates,
                incident=result.incident,
                latency_micros=elapsed,
                transmitted=result.transmitted,
                is_simulated=result.is_simulated,
            )

        # --- 1. Pre-network validation --------------------------------
        validation = self._validator.validate(
            intent,
            specification=context.specification,
            reference_price=context.reference_price,
        )
        if not validation.valid:
            return finish(
                ExecutionResult(
                    outcome=ExecutionOutcome.REJECTED_LOCALLY,
                    client_order_id=client_order_id,
                    error_code=ExecutionErrorCode.VALIDATION_FAILED,
                    message=validation.summary,
                    validation=validation,
                )
            )

        # --- 2. Safety gates ------------------------------------------
        preconditions = ExecutionPreconditions(
            exchange=self._adapter.exchange.value,
            symbol=intent.symbol,
            strategy_id=intent.strategy_id,
            kill_switches=context.kill_switches,
            settings=self._settings,
            risk_health=context.risk_health,
            market_data_health=context.market_data_health,
            exchange_health=context.exchange_health,
            credentials=context.credentials,
            market_data_required=context.market_data_required,
            is_simulated=self._adapter.is_simulated,
        )
        safety = evaluate_safety_gates(preconditions)
        if not safety.allowed:
            incident = await self._maybe_record_gate_incident(intent, safety)
            return finish(
                ExecutionResult(
                    outcome=ExecutionOutcome.REJECTED_LOCALLY,
                    client_order_id=client_order_id,
                    error_code=_gate_error_code(safety.blocking_gate),
                    message=safety.reason,
                    validation=validation,
                    safety=safety,
                    incident=incident,
                )
            )

        # --- 3. Risk engine -------------------------------------------
        # Mandatory. Any exception from the risk engine is a rejection, not a
        # bypass: an engine that throws is an engine whose answer is unknown,
        # and unknown means no.
        try:
            risk = self._risk_engine.evaluate(
                intent,
                snapshot=context.snapshot,
                kill_switches=context.kill_switches,
                trading_mode=self._settings.trading_mode,
                book_top=None,
                symbol_tradeable=(
                    context.specification.is_tradeable
                    if context.specification is not None
                    else True
                ),
            )
        except Exception as exc:  # noqa: BLE001 - fail closed
            incident = await self._record_incident(
                tenant_id=intent.tenant_id,
                account_id=intent.account_id,
                incident_type=IncidentType.SAFETY_GATE_BLOCK,
                severity=IncidentSeverity.CRITICAL,
                summary=(
                    f"The risk engine raised {type(exc).__name__} while "
                    f"evaluating an order; the order was refused."
                ),
                symbol=intent.symbol,
                client_order_id=client_order_id,
                error_code=ExecutionErrorCode.RISK_UNAVAILABLE,
                details={"error": str(exc)},
            )
            return finish(
                ExecutionResult(
                    outcome=ExecutionOutcome.REJECTED_LOCALLY,
                    client_order_id=client_order_id,
                    error_code=ExecutionErrorCode.RISK_UNAVAILABLE,
                    message=(
                        "The risk engine could not evaluate this order, so it "
                        "was refused. Risk checks fail closed."
                    ),
                    validation=validation,
                    safety=safety,
                    incident=incident,
                )
            )

        if not risk.approved:
            return finish(
                ExecutionResult(
                    outcome=ExecutionOutcome.REJECTED_LOCALLY,
                    client_order_id=client_order_id,
                    error_code=_risk_error_code(risk),
                    message=(
                        f"Risk rejected the order ({risk.code.value}): "
                        + "; ".join(
                            violation.message for violation in risk.violations
                        )
                    ),
                    validation=validation,
                    safety=safety,
                    risk=risk,
                )
            )

        # --- 4. Lock, reserve, persist, submit ------------------------
        lock_ttl = context.lock_ttl_millis or self._default_lock_ttl_millis
        try:
            async with self._locks.hold(
                account_lock_key(intent.tenant_id, intent.account_id),
                ttl_millis=lock_ttl,
                wait_millis=lock_ttl // 3,
            ):
                return finish(
                    await self._submit_under_lock(
                        intent,
                        context,
                        client_order_id=client_order_id,
                        validation=validation,
                        safety=safety,
                        risk=risk,
                    )
                )
        except LockNotAcquired as exc:
            return finish(
                ExecutionResult(
                    outcome=ExecutionOutcome.REJECTED_LOCALLY,
                    client_order_id=client_order_id,
                    error_code=ExecutionErrorCode.LOCK_UNAVAILABLE,
                    message=str(exc),
                    validation=validation,
                    safety=safety,
                    risk=risk,
                )
            )

    async def _submit_under_lock(
        self,
        intent: OrderIntent,
        context: ExecutionContext,
        *,
        client_order_id: str,
        validation: ValidationResult,
        safety: SafetyDecision,
        risk: RiskDecision,
    ) -> ExecutionResult:
        """The critical section: reserve, persist, transmit, interpret."""
        order = Order.from_intent(
            intent,
            client_order_id=client_order_id,
            is_simulated=self._adapter.is_simulated,
        )

        # --- Cross-worker duplicate guard -----------------------------
        reservation = await self._store.reserve_client_order_id(
            intent.tenant_id, client_order_id, order
        )
        if reservation.is_duplicate:
            existing = reservation.existing
            return ExecutionResult(
                outcome=ExecutionOutcome.DUPLICATE,
                client_order_id=client_order_id,
                order=existing,
                error_code=ExecutionErrorCode.DUPLICATE_ORDER,
                message=(
                    f"An order with clientOrderId {client_order_id} already "
                    f"exists"
                    + (f" (order {existing.order_id}, status "
                       f"{existing.status.value})" if existing else "")
                    + ". Nothing was transmitted; the existing order stands."
                ),
                validation=validation,
                safety=safety,
                risk=risk,
                is_simulated=self._adapter.is_simulated,
            )

        await self._store.save_order(order)

        # --- Dry run: stop here ---------------------------------------
        # The order is validated, risk-approved and recorded, and its status is
        # left at PENDING. It is deliberately never marked SUBMITTED, because
        # nothing was submitted, and a dry-run order that says SUBMITTED would
        # be indistinguishable from a real one in the audit trail.
        if self._settings.dry_run and not self._adapter.is_simulated:
            event = order.transition_to(
                OrderStatus.CANCELLED,
                reason=(
                    "DRY_RUN is enabled: the order was fully built, validated "
                    "and risk-checked, then discarded without transmission."
                ),
                payload={"dryRun": "true"},
            )
            await self._store.record_event(intent.tenant_id, event)
            await self._store.save_order(order)
            await self._emit("order.dry_run", order, {"dryRun": True})
            return ExecutionResult(
                outcome=ExecutionOutcome.DRY_RUN,
                client_order_id=client_order_id,
                order=order,
                message=(
                    "DRY_RUN: the signed request was constructed and validated "
                    "but not transmitted. This order was NOT submitted."
                ),
                validation=validation,
                safety=safety,
                risk=risk,
                transmitted=False,
                is_simulated=self._adapter.is_simulated,
            )

        # --- Mark before acting ---------------------------------------
        # Written first so a crash between here and the response still leaves a
        # record saying "we may have an order at the venue".
        submitted_event = order.transition_to(
            OrderStatus.SUBMITTED,
            reason="Transmitting to the venue.",
            payload={"clientOrderId": client_order_id},
        )
        await self._store.record_event(intent.tenant_id, submitted_event)
        await self._store.save_order(order)
        await self._store.set_reconciliation_state(
            intent.tenant_id,
            order.order_id,
            ReconciliationState.UNKNOWN,
            detail="Submission in flight; outcome not yet observed.",
        )
        await self._emit("order.submitted", order, {})

        # --- Transmit --------------------------------------------------
        try:
            submit_result = await asyncio.wait_for(
                self._adapter.submit_order(intent, client_order_id),
                timeout=self._settings.order_request_timeout_ms / 1000,
            )
        except AdapterRejectedError as exc:
            return await self._handle_rejection(
                order, intent, exc, validation, safety, risk
            )
        except AdapterRateLimitedError as exc:
            # A rate-limit response is a definitive refusal: the venue tells us
            # it did not process the request. The order does not exist.
            return await self._handle_definitive_failure(
                order,
                intent,
                ExecutionErrorCode.RATE_LIMITED,
                str(exc),
                validation,
                safety,
                risk,
            )
        except (ClockSkewExceeded, ClockSyncError) as exc:
            # Raised by the adapter before it transmits, so nothing was sent.
            return await self._handle_definitive_failure(
                order,
                intent,
                (
                    ExecutionErrorCode.CLOCK_SKEW_EXCEEDED
                    if isinstance(exc, ClockSkewExceeded)
                    else ExecutionErrorCode.CLOCK_NOT_SYNCHRONISED
                ),
                str(exc),
                validation,
                safety,
                risk,
            )
        except (AdapterConnectionError, asyncio.TimeoutError) as exc:
            return await self._handle_unknown(
                order, intent, exc, validation, safety, risk
            )
        except AdapterError as exc:
            # An adapter failure we cannot classify. Treated as ambiguous,
            # because "we do not know what this adapter did" and "we do not
            # know whether the order exists" are the same statement.
            return await self._handle_unknown(
                order, intent, exc, validation, safety, risk
            )

        return await self._handle_accepted(
            order, intent, submit_result, validation, safety, risk
        )

    # ------------------------------------------------------------------
    # Outcome handlers
    # ------------------------------------------------------------------
    async def _handle_accepted(
        self,
        order: Order,
        intent: OrderIntent,
        submit_result: SubmitResult,
        validation: ValidationResult,
        safety: SafetyDecision,
        risk: RiskDecision,
    ) -> ExecutionResult:
        """The venue answered. Its answer is authoritative."""
        if not submit_result.accepted:
            reason = submit_result.rejection_reason or "The venue refused the order."
            self._safe_transition(
                order,
                OrderStatus.REJECTED,
                reason=reason,
                payload={"code": submit_result.rejection_code or ""},
            )
            await self._store.save_order(order)
            await self._store.set_reconciliation_state(
                intent.tenant_id, order.order_id, ReconciliationState.IN_SYNC
            )
            await self._emit("order.rejected", order, {"reason": reason})
            return ExecutionResult(
                outcome=ExecutionOutcome.REJECTED_BY_EXCHANGE,
                client_order_id=order.client_order_id,
                order=order,
                error_code=ExecutionErrorCode.EXCHANGE_REJECTED,
                message=reason,
                validation=validation,
                safety=safety,
                risk=risk,
                submit_result=submit_result,
                transmitted=True,
                is_simulated=submit_result.is_simulated,
            )

        event = self._safe_transition(
            order,
            submit_result.status
            if submit_result.status is not OrderStatus.SUBMITTED
            else OrderStatus.ACKNOWLEDGED,
            reason="Accepted by the venue.",
            exchange_order_id=submit_result.exchange_order_id,
        )
        if event is None:
            # The venue reported a status our state machine says is illegal from
            # here. The venue is authoritative, so this is recorded as an
            # incident rather than silently forced or silently dropped.
            await self._record_illegal_transition(order, intent, submit_result.status)

        applied_fills: list[Fill] = []
        updates: list[PositionUpdate] = []
        for fill in submit_result.fills:
            applied, update = await self._apply_fill(order, intent, fill)
            if applied:
                applied_fills.append(fill)
            if update is not None:
                updates.append(update)

        await self._store.save_order(order)
        await self._store.set_reconciliation_state(
            intent.tenant_id, order.order_id, ReconciliationState.IN_SYNC
        )
        await self._emit(
            "order.accepted",
            order,
            {"exchangeOrderId": submit_result.exchange_order_id or ""},
        )
        return ExecutionResult(
            outcome=ExecutionOutcome.ACCEPTED,
            client_order_id=order.client_order_id,
            order=order,
            message="Accepted by the venue.",
            validation=validation,
            safety=safety,
            risk=risk,
            submit_result=submit_result,
            fills=tuple(applied_fills),
            position_updates=tuple(updates),
            transmitted=not submit_result.is_simulated,
            is_simulated=submit_result.is_simulated,
        )

    async def _handle_rejection(
        self,
        order: Order,
        intent: OrderIntent,
        exc: AdapterRejectedError,
        validation: ValidationResult,
        safety: SafetyDecision,
        risk: RiskDecision,
    ) -> ExecutionResult:
        """The venue said no, explicitly. The order does not exist there."""
        self._safe_transition(
            order,
            OrderStatus.REJECTED,
            reason=str(exc),
            payload={"venueCode": exc.code},
        )
        await self._store.save_order(order)
        await self._store.set_reconciliation_state(
            intent.tenant_id, order.order_id, ReconciliationState.IN_SYNC
        )
        await self._emit("order.rejected", order, {"venueCode": exc.code})

        code = (
            ExecutionErrorCode.INSUFFICIENT_BALANCE
            if "insufficient" in str(exc).lower()
            else ExecutionErrorCode.EXCHANGE_REJECTED
        )
        return ExecutionResult(
            outcome=ExecutionOutcome.REJECTED_BY_EXCHANGE,
            client_order_id=order.client_order_id,
            order=order,
            error_code=code,
            message=str(exc),
            validation=validation,
            safety=safety,
            risk=risk,
            transmitted=True,
            is_simulated=self._adapter.is_simulated,
        )

    async def _handle_definitive_failure(
        self,
        order: Order,
        intent: OrderIntent,
        code: ExecutionErrorCode,
        message: str,
        validation: ValidationResult,
        safety: SafetyDecision,
        risk: RiskDecision,
    ) -> ExecutionResult:
        """A failure where we know the order was not placed."""
        self._safe_transition(order, OrderStatus.FAILED, reason=message)
        await self._store.save_order(order)
        await self._store.set_reconciliation_state(
            intent.tenant_id, order.order_id, ReconciliationState.IN_SYNC
        )
        await self._emit("order.failed", order, {"errorCode": code.value})
        return ExecutionResult(
            outcome=ExecutionOutcome.REJECTED_LOCALLY,
            client_order_id=order.client_order_id,
            order=order,
            error_code=code,
            message=message,
            validation=validation,
            safety=safety,
            risk=risk,
            transmitted=False,
            is_simulated=self._adapter.is_simulated,
        )

    async def _handle_unknown(
        self,
        order: Order,
        intent: OrderIntent,
        exc: BaseException,
        validation: ValidationResult,
        safety: SafetyDecision,
        risk: RiskDecision,
    ) -> ExecutionResult:
        """The dangerous case: we do not know whether the order exists.

        The order's status stays ``SUBMITTED`` — which is true, we did submit
        it — and its reconciliation state becomes ``UNKNOWN``. An incident is
        raised at CRITICAL because an unresolved unknown order is an unhedged,
        unmonitored position waiting to happen.

        Nothing is retried. Not now, not by a caller, not by a background
        sweeper. The only permitted next action is a query by clientOrderId.
        """
        detail = f"{type(exc).__name__}: {exc}" if str(exc) else type(exc).__name__
        await self._store.set_reconciliation_state(
            intent.tenant_id,
            order.order_id,
            ReconciliationState.UNKNOWN,
            detail=detail,
        )
        event = order.transition_to(
            OrderStatus.SUBMITTED,
            reason=(
                "The submission response was lost. The order's fate is unknown "
                "and will be established by querying the venue for "
                f"clientOrderId {order.client_order_id}. It will NOT be "
                "resubmitted."
            ),
            payload={"reconciliationState": ReconciliationState.UNKNOWN.value},
        ) if order.status is not OrderStatus.SUBMITTED else None
        if event is not None:
            await self._store.record_event(intent.tenant_id, event)
        await self._store.save_order(order)

        incident = await self._record_incident(
            tenant_id=intent.tenant_id,
            account_id=intent.account_id,
            incident_type=IncidentType.UNKNOWN_ORDER_RESULT,
            severity=IncidentSeverity.CRITICAL,
            summary=(
                f"Order {order.order_id} was transmitted but no response was "
                f"received. The order may or may not exist at "
                f"{self._adapter.exchange.value}. It must be reconciled by "
                f"clientOrderId and must never be resubmitted."
            ),
            symbol=intent.symbol,
            order_id=order.order_id,
            client_order_id=order.client_order_id,
            error_code=ExecutionErrorCode.RESULT_UNKNOWN,
            details={"cause": detail},
        )
        await self._emit(
            "order.unknown",
            order,
            {"cause": detail, "requiresReconciliation": True},
        )

        return ExecutionResult(
            outcome=ExecutionOutcome.UNKNOWN,
            client_order_id=order.client_order_id,
            order=order,
            error_code=ExecutionErrorCode.RESULT_UNKNOWN,
            message=(
                "The venue's response was lost. The order's state is unknown "
                "and reconciliation has been scheduled. It has NOT been "
                "resubmitted."
            ),
            validation=validation,
            safety=safety,
            risk=risk,
            incident=incident,
            transmitted=True,
            is_simulated=self._adapter.is_simulated,
        )

    # ------------------------------------------------------------------
    # Cancellation
    # ------------------------------------------------------------------
    async def cancel(
        self, order: Order, *, reason: str = "Cancelled by request."
    ) -> ExecutionResult:
        """Cancel a resting order.

        Refuses when the order's fate is unknown: cancelling an order that may
        not exist produces a venue error that is itself ambiguous, and the
        correct first step is always to establish what the order actually is.
        """
        started_nanos = monotonic_nanos()
        state = await self._store.get_reconciliation_state(
            order.tenant_id, order.order_id
        )
        if state.blocks_further_submission:
            return ExecutionResult(
                outcome=ExecutionOutcome.REJECTED_LOCALLY,
                client_order_id=order.client_order_id,
                order=order,
                error_code=ExecutionErrorCode.RECONCILIATION_REQUIRED,
                message=(
                    f"Order {order.order_id} is in reconciliation state "
                    f"{state.value}; its true state at the venue is not known. "
                    f"Reconcile before cancelling."
                ),
                latency_micros=(monotonic_nanos() - started_nanos) // 1_000,
            )

        if order.status in TERMINAL_ORDER_STATUSES:
            return ExecutionResult(
                outcome=ExecutionOutcome.REJECTED_LOCALLY,
                client_order_id=order.client_order_id,
                order=order,
                error_code=ExecutionErrorCode.ILLEGAL_STATE_TRANSITION,
                message=(
                    f"Order {order.order_id} is already terminal "
                    f"({order.status.value}); there is nothing to cancel."
                ),
                latency_micros=(monotonic_nanos() - started_nanos) // 1_000,
            )

        async with self._locks.hold(
            order_lock_key(order.tenant_id, order.order_id),
            ttl_millis=self._default_lock_ttl_millis,
            wait_millis=self._default_lock_ttl_millis // 3,
        ):
            request_event = order.try_transition_to(
                OrderStatus.CANCEL_REQUESTED, reason=reason
            )
            if request_event is not None:
                await self._store.record_event(order.tenant_id, request_event)
                await self._store.save_order(order)

            try:
                result = await asyncio.wait_for(
                    self._adapter.cancel_order(order),
                    timeout=self._settings.order_request_timeout_ms / 1000,
                )
            except (AdapterConnectionError, asyncio.TimeoutError) as exc:
                await self._store.set_reconciliation_state(
                    order.tenant_id,
                    order.order_id,
                    ReconciliationState.UNKNOWN,
                    detail=f"Cancel response lost: {type(exc).__name__}",
                )
                incident = await self._record_incident(
                    tenant_id=order.tenant_id,
                    account_id=order.account_id,
                    incident_type=IncidentType.UNKNOWN_ORDER_RESULT,
                    severity=IncidentSeverity.WARNING,
                    summary=(
                        f"Cancellation of order {order.order_id} received no "
                        f"response; the order may or may not have been "
                        f"cancelled."
                    ),
                    order_id=order.order_id,
                    client_order_id=order.client_order_id,
                    error_code=ExecutionErrorCode.RESULT_UNKNOWN,
                )
                return ExecutionResult(
                    outcome=ExecutionOutcome.UNKNOWN,
                    client_order_id=order.client_order_id,
                    order=order,
                    error_code=ExecutionErrorCode.RESULT_UNKNOWN,
                    message="The cancellation response was lost; reconciling.",
                    incident=incident,
                    transmitted=True,
                    latency_micros=(monotonic_nanos() - started_nanos) // 1_000,
                )
            except AdapterError as exc:
                return ExecutionResult(
                    outcome=ExecutionOutcome.REJECTED_BY_EXCHANGE,
                    client_order_id=order.client_order_id,
                    order=order,
                    error_code=ExecutionErrorCode.EXCHANGE_REJECTED,
                    message=str(exc),
                    transmitted=True,
                    latency_micros=(monotonic_nanos() - started_nanos) // 1_000,
                )

            if result.accepted:
                self._safe_transition(
                    order,
                    result.status,
                    reason=result.reason or "Cancelled at the venue.",
                )
                await self._store.save_order(order)
                await self._emit("order.cancelled", order, {})

            return ExecutionResult(
                outcome=(
                    ExecutionOutcome.ACCEPTED
                    if result.accepted
                    else ExecutionOutcome.REJECTED_BY_EXCHANGE
                ),
                client_order_id=order.client_order_id,
                order=order,
                message=result.reason or "",
                transmitted=not result.is_simulated,
                is_simulated=result.is_simulated,
                latency_micros=(monotonic_nanos() - started_nanos) // 1_000,
            )

    # ------------------------------------------------------------------
    # Fills
    # ------------------------------------------------------------------
    async def apply_external_fill(
        self, order: Order, fill: Fill
    ) -> tuple[bool, PositionUpdate | None]:
        """Apply a fill that arrived outside a submission — the usual case.

        The private stream delivers most fills, and reconciliation delivers the
        rest. Both land here, and both are deduplicated by ``fill_id``, because
        the same trade legitimately arrives twice by two different routes.
        """
        intent_like = _IntentView(
            tenant_id=order.tenant_id,
            account_id=order.account_id,
            symbol=order.symbol,
            exchange=order.exchange,
        )
        return await self._apply_fill(order, intent_like, fill)

    async def _apply_fill(
        self,
        order: Order,
        intent: "OrderIntent | _IntentView",
        fill: Fill,
    ) -> tuple[bool, PositionUpdate | None]:
        """Record a fill once, and once only.

        The Part 2 ``Order.apply_fill`` already deduplicates by ``fill_id`` and
        recomputes the aggregate from scratch; the store deduplicates durably.
        Both are consulted, because either alone leaves a gap: the in-memory
        object is lost on restart and the store is not consulted on the hot
        path.
        """
        # An adapter identifies a fill by whatever the venue gave it — usually
        # the clientOrderId, because the venue has never heard of our internal
        # order id. Rebind it here, once, at the boundary, so the durable record
        # and the in-memory aggregate agree on which order the fill belongs to.
        bound = (
            fill if fill.order_id == order.order_id
            else replace(fill, order_id=order.order_id)
        )
        newly_stored = await self._store.record_fill(intent.tenant_id, bound)
        applied = order.apply_fill(bound)
        if not applied or not newly_stored:
            return (False, None)

        update: PositionUpdate | None = None
        if self._positions is not None:
            update = self._positions.apply_fill(
                order.tenant_id,
                order.account_id,
                order.exchange,
                order.symbol,
                order.side,
                bound,
            )
        await self._emit(
            "order.filled",
            order,
            {
                "fillId": bound.fill_id,
                "quantity": str(bound.quantity),
                "price": str(bound.price),
                "isSimulated": bound.is_simulated,
            },
        )
        return (True, update)

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------
    def _safe_transition(
        self,
        order: Order,
        target: OrderStatus,
        *,
        reason: str,
        exchange_order_id: str | None = None,
        payload: dict[str, str] | None = None,
    ) -> OrderEvent | None:
        """Transition, tolerating an illegal target.

        Returns the event, or ``None`` when the transition was refused. The
        caller decides what an illegal transition means; this never forces one,
        because a forced transition destroys the very audit trail that would
        explain the bug.
        """
        try:
            return order.transition_to(
                target,
                reason=reason,
                exchange_order_id=exchange_order_id,
                payload=payload,
            )
        except InvalidOrderTransition:
            return None

    async def _record_illegal_transition(
        self, order: Order, intent: "OrderIntent | _IntentView", target: OrderStatus
    ) -> None:
        await self._record_incident(
            tenant_id=order.tenant_id,
            account_id=order.account_id,
            incident_type=IncidentType.ILLEGAL_TRANSITION,
            severity=IncidentSeverity.WARNING,
            summary=(
                f"The venue reported status {target.value} for order "
                f"{order.order_id}, which is not a legal transition from "
                f"{order.status.value}. Local state was left unchanged and the "
                f"discrepancy recorded rather than forced."
            ),
            symbol=order.symbol,
            order_id=order.order_id,
            client_order_id=order.client_order_id,
            error_code=ExecutionErrorCode.ILLEGAL_STATE_TRANSITION,
            details={"from": order.status.value, "to": target.value},
        )

    async def _maybe_record_gate_incident(
        self, intent: OrderIntent, safety: SafetyDecision
    ) -> ExecutionIncident | None:
        """Record an incident only for gates that indicate a fault.

        A kill switch blocking an order is the system working exactly as
        intended and generates no incident; an unhealthy risk engine or an
        invalid credential is a fault and does.
        """
        faulty = {
            SafetyGate.RISK_ENGINE_HEALTHY,
            SafetyGate.CREDENTIALS_VALID,
            SafetyGate.EXCHANGE_HEALTHY,
            SafetyGate.MARKET_DATA_HEALTHY,
        }
        blocking = safety.blocking_gate
        if blocking is None or blocking not in faulty:
            return None
        severity = (
            IncidentSeverity.CRITICAL
            if blocking is SafetyGate.CREDENTIALS_VALID
            else IncidentSeverity.WARNING
        )
        incident_type = (
            IncidentType.CREDENTIAL_FAILURE
            if blocking is SafetyGate.CREDENTIALS_VALID
            else IncidentType.SAFETY_GATE_BLOCK
        )
        return await self._record_incident(
            tenant_id=intent.tenant_id,
            account_id=intent.account_id,
            incident_type=incident_type,
            severity=severity,
            summary=f"Order blocked by safety gate {blocking.value}.",
            symbol=intent.symbol,
            error_code=_gate_error_code(blocking),
            details={"reason": safety.reason},
        )

    async def _record_incident(
        self,
        *,
        tenant_id: str,
        incident_type: IncidentType,
        severity: IncidentSeverity,
        summary: str,
        account_id: str | None = None,
        symbol: str | None = None,
        order_id: str | None = None,
        client_order_id: str | None = None,
        error_code: ExecutionErrorCode | None = None,
        details: Mapping[str, object] | None = None,
    ) -> ExecutionIncident | None:
        """Record an incident without ever failing the caller.

        An incident store that is down must not take execution down with it.
        """
        incident = ExecutionIncident.create(
            tenant_id=tenant_id,
            account_id=account_id,
            incident_type=incident_type,
            severity=severity,
            summary=summary,
            exchange=self._adapter.exchange,
            symbol=symbol,
            order_id=order_id,
            client_order_id=client_order_id,
            error_code=error_code,
            details=details,
        )
        try:
            await self._incidents.record(incident)
        except Exception:  # noqa: BLE001 - never break execution for logging
            return incident
        return incident

    async def _emit(
        self, event_type: str, order: Order, extra: Mapping[str, object]
    ) -> None:
        """Publish a trading event, tolerating a failing publisher."""
        if self._publish is None:
            return
        payload: dict[str, object] = {
            "tenantId": order.tenant_id,
            "accountId": order.account_id,
            "orderId": order.order_id,
            "clientOrderId": order.client_order_id,
            "exchangeOrderId": order.exchange_order_id,
            "exchange": order.exchange.value,
            "symbol": order.symbol,
            "side": order.side.value,
            "status": order.status.value,
            "isSimulated": order.is_simulated,
            "filledQuantity": str(order.filled_quantity),
            "occurredAtMicros": epoch_micros(),
        }
        payload.update(extra)
        try:
            await self._publish(event_type, payload)
        except Exception:  # noqa: BLE001 - publishing is best-effort
            return


@dataclass(frozen=True, slots=True)
class _IntentView:
    """The few intent fields the fill path needs.

    Lets :meth:`ExecutionEngine.apply_external_fill` reuse ``_apply_fill``
    without fabricating a whole :class:`OrderIntent` — a fabricated intent would
    be indistinguishable from a real one to anything downstream, which is
    exactly the sort of thing that ends up in a database.
    """

    tenant_id: str
    account_id: str
    symbol: str
    exchange: ExchangeId


#: Gate → public-error taxonomy, as a table with a default rather than an
#: ``if``-chain. A chain that enumerates every current member gives the type
#: checker enough to prove its fallback dead — yet the fallback is precisely
#: the protection for the day a gate is added and forgotten here. A table
#: keeps that protection visible to callers and to mypy alike.
_GATE_ERROR_CODES: dict[SafetyGate, ExecutionErrorCode] = {
    SafetyGate.GLOBAL_KILL_SWITCH: ExecutionErrorCode.KILL_SWITCH_ENGAGED,
    SafetyGate.EXCHANGE_KILL_SWITCH: ExecutionErrorCode.KILL_SWITCH_ENGAGED,
    SafetyGate.STRATEGY_KILL_SWITCH: ExecutionErrorCode.KILL_SWITCH_ENGAGED,
    SafetyGate.SYMBOL_KILL_SWITCH: ExecutionErrorCode.KILL_SWITCH_ENGAGED,
    SafetyGate.TRADING_MODE: ExecutionErrorCode.TRADING_DISABLED,
    SafetyGate.LIVE_TRADING_AUTHORISED: ExecutionErrorCode.LIVE_TRADING_NOT_AUTHORISED,
    SafetyGate.RISK_ENGINE_HEALTHY: ExecutionErrorCode.RISK_UNAVAILABLE,
    SafetyGate.MARKET_DATA_HEALTHY: ExecutionErrorCode.MARKET_DATA_UNAVAILABLE,
    SafetyGate.CREDENTIALS_VALID: ExecutionErrorCode.CREDENTIALS_INVALID,
    SafetyGate.EXCHANGE_HEALTHY: ExecutionErrorCode.EXCHANGE_UNAVAILABLE,
}


def _gate_error_code(gate: SafetyGate | None) -> ExecutionErrorCode:
    """Map a blocked gate onto the public error taxonomy."""
    if gate is None:
        return ExecutionErrorCode.INTERNAL_ERROR
    return _GATE_ERROR_CODES.get(gate, ExecutionErrorCode.INTERNAL_ERROR)


def _risk_error_code(decision: RiskDecision) -> ExecutionErrorCode:
    """Map a risk decision onto the public error taxonomy."""
    from wlct_trading.risk import RiskDecisionCode

    if decision.code is RiskDecisionCode.RISK_STATE_UNAVAILABLE:
        return ExecutionErrorCode.RISK_UNAVAILABLE
    if decision.code is RiskDecisionCode.DUPLICATE_ORDER:
        return ExecutionErrorCode.DUPLICATE_ORDER
    if decision.kill_switch_scope is not None:
        return ExecutionErrorCode.KILL_SWITCH_ENGAGED
    if decision.trading_mode is TradingMode.DISABLED:
        return ExecutionErrorCode.TRADING_DISABLED
    return ExecutionErrorCode.RISK_REJECTED
```

---

## FILE: libs/trading-core/wlct_trading/execution/reconciliation.py

Changed by the sweep: ``Any`` from ``getattr`` narrowed with an explicit ``cast`` at the seam.

```py
"""Reconciliation: making the local record match the venue.

The exchange is authoritative for execution. The local database is the durable
record. When they disagree, the venue is right and the local record is wrong —
but "wrong" is not the same as "worthless", so this service never silently
overwrites history. It appends a correction, records what changed, and raises
an incident when the change is material.

Four kinds of divergence are detected:

``Unknown order``
    A submission whose response was lost. Queried by clientOrderId; if the
    venue has it, the local record catches up, and if it does not, the order is
    marked failed — the one case where "the venue has never heard of it" is a
    definitive answer.
``Missed lifecycle event``
    The private stream dropped a message or the process was down. The venue's
    status wins.
``Missed fill``
    A trade the platform never saw. Applied through the same path as a live
    fill, so positions and PnL are computed identically no matter how the fill
    arrived.
``Unexpected order``
    An order at the venue that this platform did not place — placed by hand, by
    another system, or by a compromised key. Never adopted, always escalated.

Balances and positions are compared but treated differently: a balance mismatch
is reported, never corrected, because balances are derived from fills and a
"corrected" balance would hide the missing fill that caused it.
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from decimal import Decimal
from enum import Enum
from typing import Mapping, cast

from wlct_trading.adapters.base import (
    AccountAdapter,
    AccountBalance,
    AdapterError,
    TradingAdapter,
)
from wlct_trading.clock import epoch_micros
from wlct_trading.enums import ExchangeId, OrderStatus
from wlct_trading.execution.incidents import (
    ExecutionErrorCode,
    ExecutionIncident,
    IncidentRecorder,
    IncidentSeverity,
    IncidentType,
)
from wlct_trading.execution.locks import (
    LockManager,
    LockNotAcquired,
    reconciliation_lock_key,
)
from wlct_trading.execution.store import OrderStore, ReconciliationState
from wlct_trading.orders import Order
from wlct_trading.positions import PositionManager

__all__ = [
    "DiscrepancyType",
    "Discrepancy",
    "ReconciliationReport",
    "ReconciliationService",
]


class DiscrepancyType(str, Enum):
    """What kind of disagreement was found."""

    ORDER_STATUS_MISMATCH = "ORDER_STATUS_MISMATCH"
    ORDER_MISSING_LOCALLY = "ORDER_MISSING_LOCALLY"
    ORDER_MISSING_AT_VENUE = "ORDER_MISSING_AT_VENUE"
    MISSED_FILL = "MISSED_FILL"
    QUANTITY_MISMATCH = "QUANTITY_MISMATCH"
    BALANCE_MISMATCH = "BALANCE_MISMATCH"
    POSITION_MISMATCH = "POSITION_MISMATCH"
    UNKNOWN_ORDER_RESOLVED = "UNKNOWN_ORDER_RESOLVED"
    UNKNOWN_ORDER_NEVER_PLACED = "UNKNOWN_ORDER_NEVER_PLACED"


@dataclass(frozen=True, slots=True)
class Discrepancy:
    """One difference between local state and the venue."""

    discrepancy_type: DiscrepancyType
    tenant_id: str
    account_id: str
    exchange: ExchangeId
    summary: str
    order_id: str | None = None
    client_order_id: str | None = None
    symbol: str | None = None
    local_value: str | None = None
    venue_value: str | None = None
    #: Whether the local record was changed to match. False for anything the
    #: service refuses to auto-correct.
    repaired: bool = False
    detected_at_micros: int = field(default_factory=epoch_micros)

    @property
    def is_material(self) -> bool:
        """Whether this needs a human even after automatic repair.

        An unexpected order and a position mismatch always do: one means
        something else is trading the account, the other means the platform's
        own arithmetic disagrees with the venue's.
        """
        return self.discrepancy_type in (
            DiscrepancyType.ORDER_MISSING_LOCALLY,
            DiscrepancyType.POSITION_MISMATCH,
            DiscrepancyType.QUANTITY_MISMATCH,
        )

    def to_dict(self) -> dict[str, object]:
        return {
            "type": self.discrepancy_type.value,
            "tenantId": self.tenant_id,
            "accountId": self.account_id,
            "exchange": self.exchange.value,
            "summary": self.summary,
            "orderId": self.order_id,
            "clientOrderId": self.client_order_id,
            "symbol": self.symbol,
            "localValue": self.local_value,
            "venueValue": self.venue_value,
            "repaired": self.repaired,
            "detectedAtMicros": self.detected_at_micros,
        }


@dataclass(frozen=True, slots=True)
class ReconciliationReport:
    """Outcome of one reconciliation pass."""

    tenant_id: str
    account_id: str
    exchange: ExchangeId
    started_at_micros: int
    finished_at_micros: int
    orders_checked: int
    fills_recovered: int
    discrepancies: tuple[Discrepancy, ...]
    incidents: tuple[ExecutionIncident, ...]
    #: Set when the pass could not complete — a venue error, a lock held
    #: elsewhere. A failed pass is reported, never silently swallowed, because
    #: "reconciliation has not run for an hour" is itself an alertable state.
    error: str | None = None

    @property
    def succeeded(self) -> bool:
        return self.error is None

    @property
    def duration_micros(self) -> int:
        return self.finished_at_micros - self.started_at_micros

    @property
    def material_discrepancies(self) -> tuple[Discrepancy, ...]:
        return tuple(item for item in self.discrepancies if item.is_material)

    def to_dict(self) -> dict[str, object]:
        return {
            "tenantId": self.tenant_id,
            "accountId": self.account_id,
            "exchange": self.exchange.value,
            "startedAtMicros": self.started_at_micros,
            "finishedAtMicros": self.finished_at_micros,
            "durationMicros": self.duration_micros,
            "ordersChecked": self.orders_checked,
            "fillsRecovered": self.fills_recovered,
            "discrepancyCount": len(self.discrepancies),
            "materialDiscrepancyCount": len(self.material_discrepancies),
            "discrepancies": [item.to_dict() for item in self.discrepancies],
            "incidentIds": [item.incident_id for item in self.incidents],
            "succeeded": self.succeeded,
            "error": self.error,
        }


class ReconciliationService:
    """Compares local execution state against the venue and repairs the gap.

    Runs on a timer, after every private-stream reconnect, and on demand for a
    single order after an ambiguous submission.
    """

    __slots__ = (
        "_trading",
        "_account",
        "_store",
        "_incidents",
        "_locks",
        "_positions",
        "_balance_tolerance",
        "_lock_ttl_millis",
    )

    def __init__(
        self,
        *,
        trading: TradingAdapter,
        account: AccountAdapter,
        store: OrderStore,
        incidents: IncidentRecorder,
        locks: LockManager,
        positions: PositionManager | None = None,
        balance_tolerance: Decimal = Decimal("0.00000001"),
        lock_ttl_millis: int = 60_000,
    ) -> None:
        self._trading = trading
        self._account = account
        self._store = store
        self._incidents = incidents
        self._locks = locks
        self._positions = positions
        self._balance_tolerance = balance_tolerance
        self._lock_ttl_millis = lock_ttl_millis

    @property
    def exchange(self) -> ExchangeId:
        return self._trading.exchange

    # ------------------------------------------------------------------
    # Single order
    # ------------------------------------------------------------------
    async def resolve_unknown_order(
        self, order: Order
    ) -> tuple[Order, Discrepancy | None]:
        """Establish the true state of an order whose fate is unknown.

        This is the *only* correct response to an ambiguous submission. It asks
        the venue about the clientOrderId and takes whatever answer it gets:

        * **The venue has it** — the local record catches up, including any
          fills that happened while we were blind.
        * **The venue has never heard of it** — the order was never placed, and
          is marked ``FAILED``. Safe to conclude because clientOrderId lookup is
          exact: there is no partial match and no ambiguity in a 404.
        * **The venue cannot be reached** — nothing changes. The order stays
          unknown and the next pass tries again. Guessing here would be the one
          thing worse than not knowing.
        """
        try:
            venue_order = await self._fetch_venue_order(order)
        except AdapterError as exc:
            await self._record(
                order.tenant_id,
                IncidentType.RECONCILIATION_FAILURE,
                IncidentSeverity.WARNING,
                summary=(
                    f"Could not query the venue for unknown order "
                    f"{order.order_id}: {type(exc).__name__}. The order remains "
                    f"unknown and will be retried."
                ),
                account_id=order.account_id,
                order_id=order.order_id,
                client_order_id=order.client_order_id,
                error_code=ExecutionErrorCode.RECONCILIATION_FAILED,
            )
            return (order, None)

        if venue_order is None:
            # Definitive: the order never reached the matching engine.
            event = order.try_transition_to(
                OrderStatus.FAILED,
                reason=(
                    "Reconciliation queried the venue by clientOrderId and the "
                    "order does not exist there. It was never placed."
                ),
            )
            if event is not None:
                await self._store.record_event(order.tenant_id, event)
            await self._store.save_order(order)
            await self._store.set_reconciliation_state(
                order.tenant_id, order.order_id, ReconciliationState.IN_SYNC
            )
            return (
                order,
                Discrepancy(
                    discrepancy_type=DiscrepancyType.UNKNOWN_ORDER_NEVER_PLACED,
                    tenant_id=order.tenant_id,
                    account_id=order.account_id,
                    exchange=self.exchange,
                    summary=(
                        f"Order {order.order_id} was never placed; the venue has "
                        f"no record of clientOrderId {order.client_order_id}."
                    ),
                    order_id=order.order_id,
                    client_order_id=order.client_order_id,
                    symbol=order.symbol,
                    local_value=OrderStatus.SUBMITTED.value,
                    venue_value="ABSENT",
                    repaired=True,
                ),
            )

        discrepancy = await self._adopt_venue_state(order, venue_order)
        await self._store.set_reconciliation_state(
            order.tenant_id, order.order_id, ReconciliationState.IN_SYNC
        )
        return (
            order,
            discrepancy
            or Discrepancy(
                discrepancy_type=DiscrepancyType.UNKNOWN_ORDER_RESOLVED,
                tenant_id=order.tenant_id,
                account_id=order.account_id,
                exchange=self.exchange,
                summary=(
                    f"Order {order.order_id} was found at the venue with status "
                    f"{venue_order.status.value}; local state now matches."
                ),
                order_id=order.order_id,
                client_order_id=order.client_order_id,
                symbol=order.symbol,
                venue_value=venue_order.status.value,
                repaired=True,
            ),
        )

    # ------------------------------------------------------------------
    # Full account pass
    # ------------------------------------------------------------------
    async def reconcile_account(
        self,
        tenant_id: str,
        account_id: str,
        *,
        check_balances: bool = True,
        check_positions: bool = True,
    ) -> ReconciliationReport:
        """One full pass over an account's orders, balances and positions.

        Serialised by a distributed lock: two overlapping passes would both see
        the same missing fill and both apply it, and only the ``fill_id``
        dedupe would stop the position doubling. Better not to rely on the last
        line of defence.
        """
        started = epoch_micros()
        discrepancies: list[Discrepancy] = []
        incidents: list[ExecutionIncident] = []
        orders_checked = 0
        fills_recovered = 0

        try:
            async with self._locks.hold(
                reconciliation_lock_key(tenant_id, account_id, self.exchange),
                ttl_millis=self._lock_ttl_millis,
                wait_millis=0,
            ):
                (
                    orders_checked,
                    fills_recovered,
                    order_discrepancies,
                ) = await self._reconcile_orders(tenant_id, account_id)
                discrepancies.extend(order_discrepancies)

                if check_balances:
                    discrepancies.extend(
                        await self._reconcile_balances(tenant_id, account_id)
                    )
                if check_positions:
                    discrepancies.extend(
                        await self._reconcile_positions(tenant_id, account_id)
                    )
        except LockNotAcquired:
            return ReconciliationReport(
                tenant_id=tenant_id,
                account_id=account_id,
                exchange=self.exchange,
                started_at_micros=started,
                finished_at_micros=epoch_micros(),
                orders_checked=0,
                fills_recovered=0,
                discrepancies=(),
                incidents=(),
                error=(
                    "Another reconciliation pass is already running for this "
                    "account; skipped."
                ),
            )
        except AdapterError as exc:
            incident = await self._record(
                tenant_id,
                IncidentType.RECONCILIATION_FAILURE,
                IncidentSeverity.WARNING,
                summary=(
                    f"Reconciliation for account {account_id} failed: "
                    f"{type(exc).__name__}."
                ),
                account_id=account_id,
                error_code=ExecutionErrorCode.RECONCILIATION_FAILED,
                details={"error": str(exc)},
            )
            return ReconciliationReport(
                tenant_id=tenant_id,
                account_id=account_id,
                exchange=self.exchange,
                started_at_micros=started,
                finished_at_micros=epoch_micros(),
                orders_checked=0,
                fills_recovered=0,
                discrepancies=(),
                incidents=(incident,) if incident else (),
                error=f"{type(exc).__name__}: {exc}",
            )

        for discrepancy in discrepancies:
            if not discrepancy.is_material:
                continue
            incident = await self._record(
                tenant_id,
                _incident_type_for(discrepancy.discrepancy_type),
                IncidentSeverity.CRITICAL
                if discrepancy.discrepancy_type
                is DiscrepancyType.ORDER_MISSING_LOCALLY
                else IncidentSeverity.WARNING,
                summary=discrepancy.summary,
                account_id=account_id,
                symbol=discrepancy.symbol,
                order_id=discrepancy.order_id,
                client_order_id=discrepancy.client_order_id,
                error_code=ExecutionErrorCode.STATE_MISMATCH,
                details={
                    "local": discrepancy.local_value or "",
                    "venue": discrepancy.venue_value or "",
                },
            )
            if incident is not None:
                incidents.append(incident)

        return ReconciliationReport(
            tenant_id=tenant_id,
            account_id=account_id,
            exchange=self.exchange,
            started_at_micros=started,
            finished_at_micros=epoch_micros(),
            orders_checked=orders_checked,
            fills_recovered=fills_recovered,
            discrepancies=tuple(discrepancies),
            incidents=tuple(incidents),
        )

    # ------------------------------------------------------------------
    # Orders
    # ------------------------------------------------------------------
    async def _reconcile_orders(
        self, tenant_id: str, account_id: str
    ) -> tuple[int, int, list[Discrepancy]]:
        discrepancies: list[Discrepancy] = []
        fills_recovered = 0

        local_open = await self._store.list_open_orders(
            tenant_id, account_id, exchange=self.exchange
        )
        venue_open = await self._trading.fetch_open_orders(tenant_id, account_id)
        venue_by_coid = {
            order.client_order_id: order for order in venue_open if order.client_order_id
        }

        # 1. Orders we think are open.
        for local in local_open:
            venue = venue_by_coid.get(local.client_order_id)
            if venue is not None:
                before = local.filled_quantity
                discrepancy = await self._adopt_venue_state(local, venue)
                if local.filled_quantity != before:
                    fills_recovered += 1
                if discrepancy is not None:
                    discrepancies.append(discrepancy)
                continue

            # Open locally, absent from the venue's open list: it reached a
            # terminal state and we missed the event. Ask directly rather than
            # assuming which terminal state.
            resolved = await self._fetch_venue_order(local)
            if resolved is None:
                discrepancies.append(
                    Discrepancy(
                        discrepancy_type=DiscrepancyType.ORDER_MISSING_AT_VENUE,
                        tenant_id=tenant_id,
                        account_id=account_id,
                        exchange=self.exchange,
                        summary=(
                            f"Order {local.order_id} is open locally but the "
                            f"venue has no record of it. Marked failed."
                        ),
                        order_id=local.order_id,
                        client_order_id=local.client_order_id,
                        symbol=local.symbol,
                        local_value=local.status.value,
                        venue_value="ABSENT",
                        repaired=True,
                    )
                )
                event = local.try_transition_to(
                    OrderStatus.FAILED,
                    reason="Reconciliation found no record of this order at the venue.",
                )
                if event is not None:
                    await self._store.record_event(tenant_id, event)
                await self._store.save_order(local)
            else:
                discrepancy = await self._adopt_venue_state(local, resolved)
                if discrepancy is not None:
                    discrepancies.append(discrepancy)

        # 2. Orders the venue has that we do not. Never adopted.
        local_coids = {order.client_order_id for order in local_open}
        for coid, venue in venue_by_coid.items():
            if coid in local_coids:
                continue
            known = await self._store.get_by_client_order_id(tenant_id, coid)
            if known is not None:
                continue
            discrepancies.append(
                Discrepancy(
                    discrepancy_type=DiscrepancyType.ORDER_MISSING_LOCALLY,
                    tenant_id=tenant_id,
                    account_id=account_id,
                    exchange=self.exchange,
                    summary=(
                        f"The venue reports an open order ({coid}) that this "
                        f"platform did not place. It has NOT been adopted. This "
                        f"means the account is being traded by something else, "
                        f"or the API key is in use elsewhere."
                    ),
                    client_order_id=coid,
                    symbol=venue.symbol,
                    local_value="ABSENT",
                    venue_value=venue.status.value,
                    repaired=False,
                )
            )

        # 3. Orders explicitly flagged unknown.
        flagged = await self._store.list_orders_needing_reconciliation(limit=200)
        for order in flagged:
            if order.tenant_id != tenant_id or order.account_id != account_id:
                continue
            state = await self._store.get_reconciliation_state(
                tenant_id, order.order_id
            )
            if state is not ReconciliationState.UNKNOWN:
                continue
            _resolved, discrepancy = await self.resolve_unknown_order(order)
            if discrepancy is not None:
                discrepancies.append(discrepancy)

        return (len(local_open), fills_recovered, discrepancies)

    async def _fetch_venue_order(self, local: Order) -> Order | None:
        """Ask the venue about one order, using the richest lookup available.

        Some venues can resolve a clientOrderId on its own; Binance additionally
        needs the symbol. Rather than pushing that quirk up into the
        reconciliation logic, adapters may expose ``fetch_order_for(order)``,
        which receives the whole local record. This prefers it when present and
        falls back to the interface method otherwise, so an adapter that does
        not need the extra context is not forced to implement anything.
        """
        richer = getattr(self._trading, "fetch_order_for", None)
        if callable(richer):
            # ``getattr`` erases the attribute's type, so the recovered call is
            # ``Any``. The cast restates the protocol's promise at the seam
            # rather than letting ``Any`` leak out of this function.
            return cast("Order | None", await richer(local))
        return await self._trading.fetch_order(
            local.tenant_id, local.account_id, local.client_order_id
        )

    async def _adopt_venue_state(
        self, local: Order, venue: Order
    ) -> Discrepancy | None:
        """Bring the local order into line with the venue's view.

        Fills first, then status. That order matters: applying a status of
        ``FILLED`` before the fills exist would leave an order that claims to be
        filled with nothing to show for it, and any consumer reading in between
        sees an inconsistent record.
        """
        recovered = 0
        for fill in venue.fills:
            # The venue view is a freshly built Order with its own internal id,
            # so its fills point at that id rather than the local record's.
            # Rebind before applying; the fill_id is unchanged, so dedupe against
            # a fill we already have still works.
            bound = (
                fill if fill.order_id == local.order_id
                else replace(fill, order_id=local.order_id)
            )
            stored = await self._store.record_fill(local.tenant_id, bound)
            applied = local.apply_fill(bound)
            if stored and applied:
                recovered += 1
                if self._positions is not None:
                    self._positions.apply_fill(
                        local.tenant_id,
                        local.account_id,
                        local.exchange,
                        local.symbol,
                        local.side,
                        bound,
                    )

        if venue.exchange_order_id and not local.exchange_order_id:
            local.exchange_order_id = venue.exchange_order_id

        previous = local.status
        changed = False
        if venue.status is not local.status:
            event = local.try_transition_to(
                venue.status,
                reason="Reconciliation: adopting the venue's authoritative status.",
                exchange_order_id=venue.exchange_order_id,
            )
            if event is not None:
                await self._store.record_event(local.tenant_id, event)
                changed = True
            else:
                # The venue's status is not reachable from ours. History is not
                # rewritten; the disagreement is reported.
                await self._store.set_reconciliation_state(
                    local.tenant_id,
                    local.order_id,
                    ReconciliationState.DIVERGED,
                    detail=(
                        f"Venue status {venue.status.value} is not a legal "
                        f"transition from {local.status.value}."
                    ),
                )
                await self._store.save_order(local)
                return Discrepancy(
                    discrepancy_type=DiscrepancyType.ORDER_STATUS_MISMATCH,
                    tenant_id=local.tenant_id,
                    account_id=local.account_id,
                    exchange=self.exchange,
                    summary=(
                        f"The venue reports {venue.status.value} for order "
                        f"{local.order_id} but that is not a legal transition "
                        f"from {local.status.value}. Local state was left "
                        f"unchanged and flagged as diverged."
                    ),
                    order_id=local.order_id,
                    client_order_id=local.client_order_id,
                    symbol=local.symbol,
                    local_value=local.status.value,
                    venue_value=venue.status.value,
                    repaired=False,
                )

        await self._store.save_order(local)

        if recovered:
            return Discrepancy(
                discrepancy_type=DiscrepancyType.MISSED_FILL,
                tenant_id=local.tenant_id,
                account_id=local.account_id,
                exchange=self.exchange,
                summary=(
                    f"Recovered {recovered} fill(s) for order {local.order_id} "
                    f"that the platform had not seen."
                ),
                order_id=local.order_id,
                client_order_id=local.client_order_id,
                symbol=local.symbol,
                local_value=str(local.filled_quantity),
                venue_value=str(venue.filled_quantity),
                repaired=True,
            )
        if changed:
            return Discrepancy(
                discrepancy_type=DiscrepancyType.ORDER_STATUS_MISMATCH,
                tenant_id=local.tenant_id,
                account_id=local.account_id,
                exchange=self.exchange,
                summary=(
                    f"Order {local.order_id} moved from {previous.value} to "
                    f"{venue.status.value} to match the venue."
                ),
                order_id=local.order_id,
                client_order_id=local.client_order_id,
                symbol=local.symbol,
                local_value=previous.value,
                venue_value=venue.status.value,
                repaired=True,
            )
        return None

    # ------------------------------------------------------------------
    # Balances and positions
    # ------------------------------------------------------------------
    async def _reconcile_balances(
        self, tenant_id: str, account_id: str
    ) -> list[Discrepancy]:
        """Compare venue balances against the platform's expectation.

        Reported, never corrected. A balance difference is a *symptom*; the
        cause is a missing fill, a fee model that is wrong, or a transfer made
        outside the platform. Overwriting the balance treats the symptom and
        destroys the evidence.
        """
        venue_balances = await self._account.fetch_balances(tenant_id, account_id)
        discrepancies: list[Discrepancy] = []
        for balance in venue_balances:
            if balance.total == 0:
                continue
            discrepancies.extend(
                self._compare_balance(tenant_id, account_id, balance)
            )
        return discrepancies

    def _compare_balance(
        self, tenant_id: str, account_id: str, balance: AccountBalance
    ) -> list[Discrepancy]:
        """Sanity-check one balance.

        With no independent local ledger of free/locked amounts, the only
        internally-checkable invariant is that the venue's own numbers are
        coherent. That is worth checking: a negative free balance or a locked
        amount exceeding the total means the response was misparsed, and acting
        on a misparsed balance is how a platform submits an order it cannot
        afford.
        """
        problems: list[Discrepancy] = []
        if balance.free < 0 or balance.locked < 0:
            problems.append(
                Discrepancy(
                    discrepancy_type=DiscrepancyType.BALANCE_MISMATCH,
                    tenant_id=tenant_id,
                    account_id=account_id,
                    exchange=self.exchange,
                    summary=(
                        f"Venue reported a negative component for "
                        f"{balance.asset}: free={balance.free}, "
                        f"locked={balance.locked}. The response is not "
                        f"trustworthy."
                    ),
                    symbol=balance.asset,
                    venue_value=str(balance.total),
                    repaired=False,
                )
            )
        return problems

    async def _reconcile_positions(
        self, tenant_id: str, account_id: str
    ) -> list[Discrepancy]:
        """Compare venue positions against fill-derived positions.

        The platform's positions are derived from fills, which is the only way
        to get a cost basis the venue does not provide. When the two quantities
        disagree the difference is reported and **not** overwritten: the local
        figure carries the entry price and realised PnL, and replacing it with a
        bare venue quantity would silently destroy the cost basis.
        """
        if self._positions is None:
            return []
        try:
            venue_positions = await self._account.fetch_positions(
                tenant_id, account_id
            )
        except AdapterError:
            return []

        discrepancies: list[Discrepancy] = []
        for venue in venue_positions:
            local = self._positions.get(account_id, self.exchange, venue.symbol)
            local_quantity = local.quantity if local is not None else Decimal(0)
            if local_quantity == venue.quantity:
                continue
            discrepancies.append(
                Discrepancy(
                    discrepancy_type=DiscrepancyType.POSITION_MISMATCH,
                    tenant_id=tenant_id,
                    account_id=account_id,
                    exchange=self.exchange,
                    summary=(
                        f"Position quantity for {venue.symbol} disagrees with "
                        f"the venue: local {local_quantity}, venue "
                        f"{venue.quantity}. Local state was NOT overwritten — "
                        f"it carries the cost basis. Investigate for a missed "
                        f"fill."
                    ),
                    symbol=venue.symbol,
                    local_value=str(local_quantity),
                    venue_value=str(venue.quantity),
                    repaired=False,
                )
            )
        return discrepancies

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------
    async def _record(
        self,
        tenant_id: str,
        incident_type: IncidentType,
        severity: IncidentSeverity,
        *,
        summary: str,
        account_id: str | None = None,
        symbol: str | None = None,
        order_id: str | None = None,
        client_order_id: str | None = None,
        error_code: ExecutionErrorCode | None = None,
        details: Mapping[str, object] | None = None,
    ) -> ExecutionIncident | None:
        incident = ExecutionIncident.create(
            tenant_id=tenant_id,
            account_id=account_id,
            incident_type=incident_type,
            severity=severity,
            summary=summary,
            exchange=self.exchange,
            symbol=symbol,
            order_id=order_id,
            client_order_id=client_order_id,
            error_code=error_code,
            details=details,
        )
        try:
            await self._incidents.record(incident)
        except Exception:  # noqa: BLE001 - reconciliation must not die on logging
            return incident
        return incident


def _incident_type_for(discrepancy: DiscrepancyType) -> IncidentType:
    """Map a discrepancy onto the incident taxonomy."""
    mapping = {
        DiscrepancyType.ORDER_STATUS_MISMATCH: IncidentType.ORDER_STATE_MISMATCH,
        DiscrepancyType.ORDER_MISSING_LOCALLY: IncidentType.UNEXPECTED_ORDER,
        DiscrepancyType.ORDER_MISSING_AT_VENUE: IncidentType.ORDER_STATE_MISMATCH,
        DiscrepancyType.MISSED_FILL: IncidentType.MISSING_FILL,
        DiscrepancyType.QUANTITY_MISMATCH: IncidentType.ORDER_STATE_MISMATCH,
        DiscrepancyType.BALANCE_MISMATCH: IncidentType.BALANCE_MISMATCH,
        DiscrepancyType.POSITION_MISMATCH: IncidentType.POSITION_MISMATCH,
        DiscrepancyType.UNKNOWN_ORDER_RESOLVED: IncidentType.UNKNOWN_ORDER_RESULT,
        DiscrepancyType.UNKNOWN_ORDER_NEVER_PLACED: IncidentType.UNKNOWN_ORDER_RESULT,
    }
    return mapping.get(discrepancy, IncidentType.RECONCILIATION_FAILURE)
```

---

## FILE: libs/trading-core/wlct_trading/execution/validation.py

Changed by the sweep: defensive isinstance guards made visible to flow analysis by taking ``object`` views; ``_is_usable_decimal`` retyped ``value: object``.

```py
"""Pre-network order validation.

Ten checks that run before a single byte leaves the process. Their purpose is
not to duplicate the venue's validation — the venue is authoritative and will
apply its own — but to catch the errors that are cheap to catch locally and
expensive to catch remotely:

* A malformed order costs a round trip, consumes rate-limit weight, and on a
  fast-moving symbol the rejection arrives after the opportunity has gone.
* Some malformed orders are *not* rejected. A quantity with too many decimal
  places may be silently truncated; a price outside a sane band may fill
  instantly at a terrible level. Local validation is the only thing standing
  between a fat-fingered Decimal and a real loss.

The checks, in order:

===  ==========================================================================
#    Check
===  ==========================================================================
1    Required identity fields are present (tenant, account, exchange, symbol)
2    Symbol is known to the registry and currently tradeable
3    Side and order type form a supported combination
4    Quantity is a positive, finite Decimal
5    Price is present exactly when the order type requires it, and positive
6    Stop price is present exactly when the order type requires it
7    Quantity and price satisfy the venue's step/tick/min/max rules
8    Notional clears the venue minimum and the platform's own ceiling
9    Time-in-force is supported for this order type on this venue
10   Price is within a sanity band of the reference price (fat-finger guard)
===  ==========================================================================

The result is a list of every failure, not just the first. An operator or a
strategy author fixing one problem at a time across ten round trips is a waste
of everyone's afternoon.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from enum import Enum

from wlct_trading.adapters.base import SymbolSpecification
from wlct_trading.clock import epoch_micros
from wlct_trading.enums import OrderSide, OrderType, TimeInForce
from wlct_trading.orders import OrderIntent

__all__ = [
    "ValidationCode",
    "ValidationIssue",
    "ValidationResult",
    "OrderValidator",
    "DEFAULT_PRICE_BAND_PERCENT",
]

#: How far a limit price may sit from the reference price before it is treated
#: as a mistake. 20% is wide enough for a deliberately passive resting order on
#: a volatile pair and narrow enough to catch a decimal-point error.
DEFAULT_PRICE_BAND_PERCENT = Decimal("20")


class ValidationCode(str, Enum):
    """Normalised reason codes.

    Stable strings: they end up in audit records, metrics labels and API error
    payloads, so they are part of the platform's contract.
    """

    MISSING_TENANT = "MISSING_TENANT"
    MISSING_ACCOUNT = "MISSING_ACCOUNT"
    MISSING_SYMBOL = "MISSING_SYMBOL"
    UNKNOWN_SYMBOL = "UNKNOWN_SYMBOL"
    SYMBOL_NOT_TRADEABLE = "SYMBOL_NOT_TRADEABLE"
    UNSUPPORTED_ORDER_TYPE = "UNSUPPORTED_ORDER_TYPE"
    UNSUPPORTED_SIDE = "UNSUPPORTED_SIDE"
    INVALID_QUANTITY = "INVALID_QUANTITY"
    INVALID_PRICE = "INVALID_PRICE"
    PRICE_NOT_ALLOWED = "PRICE_NOT_ALLOWED"
    PRICE_REQUIRED = "PRICE_REQUIRED"
    STOP_PRICE_REQUIRED = "STOP_PRICE_REQUIRED"
    STOP_PRICE_NOT_ALLOWED = "STOP_PRICE_NOT_ALLOWED"
    LOT_SIZE_VIOLATION = "LOT_SIZE_VIOLATION"
    TICK_SIZE_VIOLATION = "TICK_SIZE_VIOLATION"
    MIN_NOTIONAL_VIOLATION = "MIN_NOTIONAL_VIOLATION"
    MAX_NOTIONAL_VIOLATION = "MAX_NOTIONAL_VIOLATION"
    UNSUPPORTED_TIME_IN_FORCE = "UNSUPPORTED_TIME_IN_FORCE"
    PRICE_BAND_VIOLATION = "PRICE_BAND_VIOLATION"
    REDUCE_ONLY_UNSUPPORTED = "REDUCE_ONLY_UNSUPPORTED"
    CLIENT_ORDER_ID_INVALID = "CLIENT_ORDER_ID_INVALID"


@dataclass(frozen=True, slots=True)
class ValidationIssue:
    """One validation failure."""

    code: ValidationCode
    message: str
    field_name: str | None = None

    def to_dict(self) -> dict[str, object]:
        return {
            "code": self.code.value,
            "message": self.message,
            "field": self.field_name,
        }


@dataclass(frozen=True, slots=True)
class ValidationResult:
    """Outcome of validating one order intent."""

    valid: bool
    issues: tuple[ValidationIssue, ...]
    validated_at_micros: int
    #: The specification the order was checked against, when one was found.
    specification: SymbolSpecification | None = None

    @property
    def first_code(self) -> ValidationCode | None:
        return self.issues[0].code if self.issues else None

    @property
    def summary(self) -> str:
        if self.valid:
            return "Order passed all pre-network validation checks."
        return "; ".join(issue.message for issue in self.issues)

    def to_dict(self) -> dict[str, object]:
        return {
            "valid": self.valid,
            "validatedAtMicros": self.validated_at_micros,
            "issues": [issue.to_dict() for issue in self.issues],
            "summary": self.summary,
        }


def _is_usable_decimal(value: object) -> bool:
    """Reject NaN, infinity and anything that is not a Decimal at all.

    The parameter is deliberately ``object``, not ``Decimal``: this runs on
    numbers that crossed a serialisation boundary, and a declared ``Decimal``
    would let flow analysis prove the isinstance guard dead — the guard is the
    point.
    """
    if not isinstance(value, Decimal):
        return False
    try:
        return value.is_finite()
    except (InvalidOperation, TypeError):  # pragma: no cover - defensive
        return False


class OrderValidator:
    """Validates order intents against venue rules and platform policy.

    Stateless apart from its configured limits, so one instance is safe to
    share across every worker and every tenant.
    """

    __slots__ = (
        "_price_band_percent",
        "_max_notional",
        "_supported_time_in_force",
        "_allow_reduce_only",
        "_client_order_id_max_length",
    )

    def __init__(
        self,
        *,
        price_band_percent: Decimal = DEFAULT_PRICE_BAND_PERCENT,
        max_notional: Decimal | None = None,
        supported_time_in_force: frozenset[TimeInForce] | None = None,
        allow_reduce_only: bool = False,
        client_order_id_max_length: int = 36,
    ) -> None:
        """
        ``allow_reduce_only`` defaults to ``False`` because Binance Spot — the
        first authenticated venue — has no reduce-only flag, and quietly
        dropping it would turn a position-closing order into a position-opening
        one. The capability registry decides per venue; the default is the
        conservative answer.

        ``client_order_id_max_length`` is 36 to match Binance's ``newClientOrderId``
        limit. The Part 2 generator produces 33 characters, which fits.
        """
        if price_band_percent <= 0:
            raise ValueError("price_band_percent must be positive.")
        self._price_band_percent = price_band_percent
        self._max_notional = max_notional
        self._supported_time_in_force = supported_time_in_force or frozenset(
            {TimeInForce.GTC, TimeInForce.IOC, TimeInForce.FOK}
        )
        self._allow_reduce_only = allow_reduce_only
        self._client_order_id_max_length = client_order_id_max_length

    def validate(
        self,
        intent: OrderIntent,
        *,
        specification: SymbolSpecification | None,
        reference_price: Decimal | None = None,
        now_micros: int | None = None,
    ) -> ValidationResult:
        """Run all ten checks and collect every failure."""
        now = epoch_micros() if now_micros is None else now_micros
        issues: list[ValidationIssue] = []

        # --- 1. Identity ----------------------------------------------
        if not intent.tenant_id or not intent.tenant_id.strip():
            issues.append(
                ValidationIssue(
                    ValidationCode.MISSING_TENANT,
                    "Order intent has no tenant id; it cannot be attributed or "
                    "authorised.",
                    "tenant_id",
                )
            )
        if not intent.account_id or not intent.account_id.strip():
            issues.append(
                ValidationIssue(
                    ValidationCode.MISSING_ACCOUNT,
                    "Order intent has no account id; there is no exchange "
                    "account to route it to.",
                    "account_id",
                )
            )
        if not intent.symbol or not intent.symbol.strip():
            issues.append(
                ValidationIssue(
                    ValidationCode.MISSING_SYMBOL,
                    "Order intent has no symbol.",
                    "symbol",
                )
            )

        if intent.client_order_id is not None:
            coid = intent.client_order_id
            if not coid or len(coid) > self._client_order_id_max_length:
                issues.append(
                    ValidationIssue(
                        ValidationCode.CLIENT_ORDER_ID_INVALID,
                        f"clientOrderId must be 1-{self._client_order_id_max_length} "
                        f"characters; got {len(coid)}.",
                        "client_order_id",
                    )
                )
            elif not all(ch.isalnum() or ch in "-_." for ch in coid):
                issues.append(
                    ValidationIssue(
                        ValidationCode.CLIENT_ORDER_ID_INVALID,
                        "clientOrderId may contain only alphanumerics, '-', '_' "
                        "and '.'; other characters break the signed query string.",
                        "client_order_id",
                    )
                )

        # --- 2. Symbol known and tradeable ----------------------------
        if specification is None:
            issues.append(
                ValidationIssue(
                    ValidationCode.UNKNOWN_SYMBOL,
                    f"No symbol specification for {intent.symbol!r} on "
                    f"{intent.exchange.value}. Refusing to guess the venue's "
                    f"lot size, tick size and minimum notional.",
                    "symbol",
                )
            )
        elif not specification.is_tradeable:
            issues.append(
                ValidationIssue(
                    ValidationCode.SYMBOL_NOT_TRADEABLE,
                    f"{intent.symbol} is currently not tradeable on "
                    f"{intent.exchange.value} (halted or delisted).",
                    "symbol",
                )
            )

        # --- 3. Side and type -----------------------------------------
        side_view: object = intent.side
        if not isinstance(side_view, OrderSide):
            issues.append(
                ValidationIssue(
                    ValidationCode.UNSUPPORTED_SIDE,
                    f"Unsupported order side {intent.side!r}.",
                    "side",
                )
            )
        order_type_view: object = intent.order_type
        if not isinstance(order_type_view, OrderType):
            issues.append(
                ValidationIssue(
                    ValidationCode.UNSUPPORTED_ORDER_TYPE,
                    f"Unsupported order type {intent.order_type!r}.",
                    "order_type",
                )
            )

        # --- 4. Quantity ----------------------------------------------
        quantity = intent.quantity
        if not _is_usable_decimal(quantity):
            issues.append(
                ValidationIssue(
                    ValidationCode.INVALID_QUANTITY,
                    f"Quantity must be a finite Decimal; got {quantity!r}.",
                    "quantity",
                )
            )
        elif quantity <= 0:
            issues.append(
                ValidationIssue(
                    ValidationCode.INVALID_QUANTITY,
                    f"Quantity must be greater than zero; got {quantity}.",
                    "quantity",
                )
            )

        # --- 5 & 6. Price and stop price against the order type -------
        requires_price = intent.order_type in (OrderType.LIMIT, OrderType.STOP_LIMIT)
        requires_stop = intent.order_type in (OrderType.STOP, OrderType.STOP_LIMIT)

        if requires_price:
            if intent.price is None:
                issues.append(
                    ValidationIssue(
                        ValidationCode.PRICE_REQUIRED,
                        f"A {intent.order_type.value} order requires a limit price.",
                        "price",
                    )
                )
            elif not _is_usable_decimal(intent.price) or intent.price <= 0:
                issues.append(
                    ValidationIssue(
                        ValidationCode.INVALID_PRICE,
                        f"Limit price must be a finite positive Decimal; got "
                        f"{intent.price!r}.",
                        "price",
                    )
                )
        elif intent.price is not None and intent.order_type is OrderType.MARKET:
            issues.append(
                ValidationIssue(
                    ValidationCode.PRICE_NOT_ALLOWED,
                    "A MARKET order must not carry a limit price; the venue "
                    "would reject it and the intent is ambiguous.",
                    "price",
                )
            )

        if requires_stop:
            if intent.stop_price is None:
                issues.append(
                    ValidationIssue(
                        ValidationCode.STOP_PRICE_REQUIRED,
                        f"A {intent.order_type.value} order requires a stop price.",
                        "stop_price",
                    )
                )
            elif not _is_usable_decimal(intent.stop_price) or intent.stop_price <= 0:
                issues.append(
                    ValidationIssue(
                        ValidationCode.INVALID_PRICE,
                        f"Stop price must be a finite positive Decimal; got "
                        f"{intent.stop_price!r}.",
                        "stop_price",
                    )
                )
        elif intent.stop_price is not None:
            issues.append(
                ValidationIssue(
                    ValidationCode.STOP_PRICE_NOT_ALLOWED,
                    f"A {intent.order_type.value} order must not carry a stop "
                    f"price.",
                    "stop_price",
                )
            )

        # --- 7. Venue lot/tick rules ----------------------------------
        # Reuses the Part 2 SymbolSpecification.validation_errors rather than
        # restating the arithmetic, then maps each message onto a code.
        if specification is not None and _is_usable_decimal(quantity) and quantity > 0:
            for message in specification.validation_errors(quantity, intent.price):
                issues.append(
                    ValidationIssue(
                        _classify_specification_error(message), message, None
                    )
                )

        # --- 8. Notional ceiling --------------------------------------
        effective_price = intent.price if intent.price is not None else reference_price
        if (
            self._max_notional is not None
            and effective_price is not None
            and _is_usable_decimal(quantity)
            and _is_usable_decimal(effective_price)
            and quantity > 0
        ):
            notional = quantity * effective_price
            if notional > self._max_notional:
                issues.append(
                    ValidationIssue(
                        ValidationCode.MAX_NOTIONAL_VIOLATION,
                        f"Order notional {notional} exceeds the platform ceiling "
                        f"{self._max_notional}.",
                        "quantity",
                    )
                )

        # --- 9. Time in force -----------------------------------------
        if intent.order_type is OrderType.MARKET:
            # A market order's TIF is implicit; the adapter omits it entirely.
            pass
        elif intent.time_in_force not in self._supported_time_in_force:
            supported = ", ".join(
                sorted(item.value for item in self._supported_time_in_force)
            )
            issues.append(
                ValidationIssue(
                    ValidationCode.UNSUPPORTED_TIME_IN_FORCE,
                    f"Time in force {intent.time_in_force.value} is not supported "
                    f"for this venue; supported values are {supported}.",
                    "time_in_force",
                )
            )

        if intent.reduce_only and not self._allow_reduce_only:
            issues.append(
                ValidationIssue(
                    ValidationCode.REDUCE_ONLY_UNSUPPORTED,
                    "reduce_only was requested but this venue has no reduce-only "
                    "flag. Silently dropping it could turn a closing order into "
                    "an opening one, so the order is refused.",
                    "reduce_only",
                )
            )

        # --- 10. Fat-finger price band --------------------------------
        if (
            intent.price is not None
            and reference_price is not None
            and _is_usable_decimal(intent.price)
            and _is_usable_decimal(reference_price)
            and reference_price > 0
            and intent.price > 0
        ):
            deviation = (
                abs(intent.price - reference_price) / reference_price * Decimal(100)
            )
            if deviation > self._price_band_percent:
                issues.append(
                    ValidationIssue(
                        ValidationCode.PRICE_BAND_VIOLATION,
                        f"Limit price {intent.price} deviates {deviation:.2f}% from "
                        f"the reference price {reference_price}, beyond the "
                        f"{self._price_band_percent}% sanity band. This is usually "
                        f"a decimal-point error.",
                        "price",
                    )
                )

        return ValidationResult(
            valid=not issues,
            issues=tuple(issues),
            validated_at_micros=now,
            specification=specification,
        )


def _classify_specification_error(message: str) -> ValidationCode:
    """Map a SymbolSpecification message onto a normalised code.

    The specification returns human text; the platform's contract is codes.
    Matching on stable substrings keeps the two in step without changing the
    Part 2 signature.
    """
    lowered = message.lower()
    if "not currently tradeable" in lowered:
        return ValidationCode.SYMBOL_NOT_TRADEABLE
    if "notional" in lowered:
        return ValidationCode.MIN_NOTIONAL_VIOLATION
    if "tick" in lowered:
        return ValidationCode.TICK_SIZE_VIOLATION
    if "step" in lowered or "minimum" in lowered or "maximum" in lowered:
        return ValidationCode.LOT_SIZE_VIOLATION
    return ValidationCode.INVALID_QUANTITY
```

---

## FILE: libs/trading-core/wlct_trading/execution/store.py

Changed by the sweep: ruff F401: unused enum import removed.

```py
"""The order store port and an in-memory implementation.

``trading-core`` is a pure library: it must not import Prisma, a database
driver, or anything else that would make it impossible to unit-test without
infrastructure. So persistence is expressed as a port here, and the durable
adapter lives in the service layer.

The contract encodes three rules that the rest of the system depends on:

1. **The exchange is authoritative for execution; the store is the durable
   record.** The store never invents an order state, and
   :meth:`OrderStore.record_event` appends rather than replaces so history
   survives a correction.
2. **Idempotency is enforced at the store, not just in memory.** Part 2's
   ``DuplicateOrderGuard`` is per-process; :meth:`OrderStore.reserve_client_order_id`
   is the cross-worker one, and behind it sits the unique index on
   ``(tenant_id, client_order_id)``.
3. **Nothing is deleted.** A cancelled or rejected order stays, with its event
   trail, because an audit that can be edited is not an audit.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from enum import Enum

from wlct_trading.enums import ExchangeId
from wlct_trading.orders import Fill, Order, OrderEvent

__all__ = [
    "ReconciliationState",
    "OrderStoreError",
    "DuplicateClientOrderId",
    "OrderNotFound",
    "ReservationOutcome",
    "OrderStore",
    "InMemoryOrderStore",
]


class ReconciliationState(str, Enum):
    """How much the local record can be trusted for one order.

    Kept deliberately separate from :class:`~wlct_trading.enums.OrderStatus`.
    ``OrderStatus`` describes what the *venue* believes about the order and has
    a strict legal-transition table; this describes what *we* believe about our
    own knowledge. Conflating the two would mean adding an ``UNKNOWN`` member to
    the lifecycle enum and then having to decide which real statuses it may
    legally transition to — a question with no correct answer, because an
    unknown order might be in any of them.

    So an order whose submission response was lost stays ``SUBMITTED`` (which is
    true: we did submit it) and is marked ``PENDING_RECONCILIATION`` here.
    """

    #: Local state matches the last thing the venue told us.
    IN_SYNC = "IN_SYNC"
    #: The submission outcome was never observed. The order may or may not
    #: exist at the venue. It must be queried by clientOrderId, never resubmitted.
    UNKNOWN = "UNKNOWN"
    #: Known to need a venue check — a missed stream event, a restart, a
    #: scheduled sweep.
    PENDING_RECONCILIATION = "PENDING_RECONCILIATION"
    #: Reconciliation ran and found a difference that could not be repaired
    #: automatically. An incident exists and a human is required.
    DIVERGED = "DIVERGED"

    @property
    def blocks_further_submission(self) -> bool:
        """Whether this state forbids acting on the order.

        An order of unknown fate must not be cancelled, replaced or resubmitted
        until its true state is established; every one of those actions has a
        different correct form depending on whether the order exists.
        """
        return self in (ReconciliationState.UNKNOWN, ReconciliationState.DIVERGED)


class OrderStoreError(Exception):
    """Base class for persistence failures."""


class OrderNotFound(OrderStoreError):
    """No order with the given identifier exists in the store."""


class DuplicateClientOrderId(OrderStoreError):
    """A different order already owns this client order id.

    Distinct from "the same order is being retried": that case returns the
    existing order so the caller can resume, rather than raising.
    """

    def __init__(self, client_order_id: str, existing_order_id: str) -> None:
        self.client_order_id = client_order_id
        self.existing_order_id = existing_order_id
        super().__init__(
            f"clientOrderId {client_order_id!r} is already used by order "
            f"{existing_order_id}. Refusing to submit a second order under the "
            f"same idempotency key."
        )


@dataclass(frozen=True, slots=True)
class ReservationOutcome:
    """Result of claiming a client order id."""

    #: True when this caller won the race and may proceed to submit.
    reserved: bool
    #: The order already holding the id, when the caller lost the race. The
    #: caller resumes this order rather than creating a new one — that is what
    #: turns a duplicate submission into a no-op instead of a second position.
    existing: Order | None = None

    @property
    def is_duplicate(self) -> bool:
        return not self.reserved


class OrderStore(ABC):
    """Durable record of orders, their events and their fills."""

    @abstractmethod
    async def reserve_client_order_id(
        self, tenant_id: str, client_order_id: str, order: Order
    ) -> ReservationOutcome:
        """Atomically claim ``client_order_id`` for ``order``.

        Must be atomic against concurrent callers in other processes. A
        SQL implementation gets this from the unique index; a Redis one from
        ``SET NX``. Returning ``reserved=False`` with the existing order is not
        an error — it is the mechanism that makes duplicate submission
        impossible.
        """

    @abstractmethod
    async def save_order(self, order: Order) -> Order:
        """Insert or update an order. Returns the stored version."""

    @abstractmethod
    async def get_order(self, tenant_id: str, order_id: str) -> Order | None:
        ...

    @abstractmethod
    async def get_by_client_order_id(
        self, tenant_id: str, client_order_id: str
    ) -> Order | None:
        """Look up by idempotency key.

        The recovery path after an ambiguous submission: the venue knows the
        order by this id even when the local record does not know the venue's.
        """

    @abstractmethod
    async def list_open_orders(
        self,
        tenant_id: str,
        account_id: str,
        *,
        exchange: ExchangeId | None = None,
        symbol: str | None = None,
    ) -> tuple[Order, ...]:
        ...

    @abstractmethod
    async def list_orders_needing_reconciliation(
        self,
        *,
        older_than_micros: int | None = None,
        limit: int = 100,
    ) -> tuple[Order, ...]:
        """Orders whose local state may not match the venue.

        Anything in a non-terminal state, plus anything explicitly flagged
        during an ambiguous submission.
        """

    @abstractmethod
    async def set_reconciliation_state(
        self,
        tenant_id: str,
        order_id: str,
        state: ReconciliationState,
        *,
        detail: str | None = None,
    ) -> None:
        """Record how much the local view of this order can be trusted.

        Must be durable and must be written *before* the risky operation, not
        after it. An engine that submits and then marks the order unknown loses
        the marker precisely in the scenario it exists for: the process dying
        mid-request.
        """

    @abstractmethod
    async def get_reconciliation_state(
        self, tenant_id: str, order_id: str
    ) -> ReconciliationState:
        """Defaults to :attr:`ReconciliationState.IN_SYNC` for unknown orders."""

    @abstractmethod
    async def record_event(self, tenant_id: str, event: OrderEvent) -> OrderEvent:
        """Append one event. Never overwrites an earlier event.

        ``tenant_id`` is passed alongside rather than read from the event: the
        Part 2 :class:`~wlct_trading.orders.OrderEvent` is an order-scoped value
        object with no tenant field, and every store lookup in this platform is
        tenant-scoped to make cross-tenant reads structurally impossible.
        """

    @abstractmethod
    async def list_events(
        self, tenant_id: str, order_id: str
    ) -> tuple[OrderEvent, ...]:
        ...

    @abstractmethod
    async def record_fill(self, tenant_id: str, fill: Fill) -> bool:
        """Append a fill. Returns False if this fill was already recorded.

        Deduplication is by ``fill_id``, because both the private stream and the
        REST reconciliation path deliver the same trade and neither is
        suppressible.
        """

    @abstractmethod
    async def list_fills(self, tenant_id: str, order_id: str) -> tuple[Fill, ...]:
        ...


class InMemoryOrderStore(OrderStore):
    """Reference implementation.

    Used by the test-suite and by paper trading. It is a faithful model of the
    durable contract — including the uniqueness constraint and the
    append-only event log — so a behaviour that passes here is a behaviour the
    SQL adapter must also produce.

    Not a production store: it is process-local and lost on restart. The engine
    warns when it is paired with live trading.
    """

    __slots__ = (
        "_orders",
        "_by_client_order_id",
        "_events",
        "_fills",
        "_fill_ids",
        "_needs_reconciliation",
        "_reconciliation_state",
    )

    def __init__(self) -> None:
        self._orders: dict[tuple[str, str], Order] = {}
        self._by_client_order_id: dict[tuple[str, str], str] = {}
        self._events: dict[tuple[str, str], list[OrderEvent]] = {}
        self._fills: dict[tuple[str, str], list[Fill]] = {}
        self._fill_ids: set[tuple[str, str]] = set()
        self._needs_reconciliation: set[tuple[str, str]] = set()
        self._reconciliation_state: dict[tuple[str, str], ReconciliationState] = {}

    @property
    def is_durable(self) -> bool:
        """Always False. Checked at startup before live trading is permitted."""
        return False

    async def reserve_client_order_id(
        self, tenant_id: str, client_order_id: str, order: Order
    ) -> ReservationOutcome:
        key = (tenant_id, client_order_id)
        existing_id = self._by_client_order_id.get(key)
        if existing_id is not None:
            existing = self._orders.get((tenant_id, existing_id))
            if existing is not None and existing.order_id == order.order_id:
                # Same order retrying: it already owns the reservation.
                return ReservationOutcome(reserved=True, existing=existing)
            return ReservationOutcome(reserved=False, existing=existing)
        self._by_client_order_id[key] = order.order_id
        self._orders[(tenant_id, order.order_id)] = order
        return ReservationOutcome(reserved=True)

    async def save_order(self, order: Order) -> Order:
        self._orders[(order.tenant_id, order.order_id)] = order
        if order.client_order_id:
            self._by_client_order_id.setdefault(
                (order.tenant_id, order.client_order_id), order.order_id
            )
        return order

    async def get_order(self, tenant_id: str, order_id: str) -> Order | None:
        return self._orders.get((tenant_id, order_id))

    async def get_by_client_order_id(
        self, tenant_id: str, client_order_id: str
    ) -> Order | None:
        order_id = self._by_client_order_id.get((tenant_id, client_order_id))
        if order_id is None:
            return None
        return self._orders.get((tenant_id, order_id))

    async def list_open_orders(
        self,
        tenant_id: str,
        account_id: str,
        *,
        exchange: ExchangeId | None = None,
        symbol: str | None = None,
    ) -> tuple[Order, ...]:
        from wlct_trading.enums import TERMINAL_ORDER_STATUSES

        return tuple(
            order
            for (owner, _order_id), order in self._orders.items()
            if owner == tenant_id
            and order.account_id == account_id
            and order.status not in TERMINAL_ORDER_STATUSES
            and (exchange is None or order.exchange is exchange)
            and (symbol is None or order.symbol == symbol)
        )

    async def list_orders_needing_reconciliation(
        self,
        *,
        older_than_micros: int | None = None,
        limit: int = 100,
    ) -> tuple[Order, ...]:
        from wlct_trading.enums import TERMINAL_ORDER_STATUSES

        cutoff = older_than_micros
        selected: list[Order] = []
        for key, order in self._orders.items():
            flagged = key in self._needs_reconciliation
            open_state = order.status not in TERMINAL_ORDER_STATUSES
            if not (flagged or open_state):
                continue
            if cutoff is not None and order.updated_at > cutoff:
                continue
            selected.append(order)
            if len(selected) >= limit:
                break
        return tuple(selected)

    async def set_reconciliation_state(
        self,
        tenant_id: str,
        order_id: str,
        state: ReconciliationState,
        *,
        detail: str | None = None,
    ) -> None:
        if state is ReconciliationState.IN_SYNC:
            self._reconciliation_state.pop((tenant_id, order_id), None)
            self._needs_reconciliation.discard((tenant_id, order_id))
            return
        self._reconciliation_state[(tenant_id, order_id)] = state
        self._needs_reconciliation.add((tenant_id, order_id))

    async def get_reconciliation_state(
        self, tenant_id: str, order_id: str
    ) -> ReconciliationState:
        return self._reconciliation_state.get(
            (tenant_id, order_id), ReconciliationState.IN_SYNC
        )

    async def record_event(self, tenant_id: str, event: OrderEvent) -> OrderEvent:
        self._events.setdefault((tenant_id, event.order_id), []).append(event)
        return event

    async def list_events(
        self, tenant_id: str, order_id: str
    ) -> tuple[OrderEvent, ...]:
        return tuple(self._events.get((tenant_id, order_id), ()))

    async def record_fill(self, tenant_id: str, fill: Fill) -> bool:
        marker = (tenant_id, fill.fill_id)
        if marker in self._fill_ids:
            return False
        self._fill_ids.add(marker)
        self._fills.setdefault((tenant_id, fill.order_id), []).append(fill)
        return True

    async def list_fills(self, tenant_id: str, order_id: str) -> tuple[Fill, ...]:
        return tuple(self._fills.get((tenant_id, order_id), ()))

    # -- Test and diagnostic helpers -----------------------------------
    def order_count(self) -> int:
        return len(self._orders)

    def all_orders(self) -> tuple[Order, ...]:
        return tuple(self._orders.values())
```

---

## FILE: libs/trading-core/wlct_trading/net/config.py

Changed by the sweep: ruff F401: unused ``dataclasses.field`` import removed.

```py
"""Configuration for the production transport layer.

Part 3's core is configuration-free on purpose: it takes injected callables and
never reads the environment. That property is preserved — this module lives in
:mod:`wlct_trading.net`, the optional "live transport" subpackage, and is the
*only* place in the library that reads ``os.environ``.

Parsing is stdlib-only. Pydantic is a fine dependency for a service, but the
trading-core library is deliberately installable with nothing but the standard
library plus the two network clients, and a settings framework is not worth
giving that up.

Every timeout has a finite default. There is no code path here that produces an
infinite network timeout.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Mapping

from wlct_trading.exchanges.binance.capabilities import (
    BINANCE_SPOT_REST_BASE,
    BINANCE_SPOT_WS_BASE,
    BINANCE_TESTNET_REST_BASE,
    BINANCE_TESTNET_WS_BASE,
)
from wlct_trading.transport.subscriptions import MarketDataChannel

__all__ = [
    "TransportSettings",
    "InvalidTransportSettings",
    "parse_bool",
    "parse_int",
    "parse_symbol_list",
]


class InvalidTransportSettings(ValueError):
    """Raised when configuration is missing, malformed or unsafe.

    Raised at startup rather than tolerated. A service that boots with a
    nonsensical timeout and discovers it during a venue incident is worse than
    one that refuses to boot.
    """


def parse_bool(raw: str | None, default: bool, *, name: str) -> bool:
    """Parse a boolean environment value strictly.

    Anything unrecognised raises. Silently treating ``"flase"`` as ``False``
    would disable a channel an operator believed they had enabled.
    """
    if raw is None or raw.strip() == "":
        return default
    lowered = raw.strip().lower()
    if lowered in ("1", "true", "yes", "on"):
        return True
    if lowered in ("0", "false", "no", "off"):
        return False
    raise InvalidTransportSettings(
        f"{name} must be a boolean (true/false), got {raw!r}."
    )


def parse_int(
    raw: str | None,
    default: int,
    *,
    name: str,
    minimum: int = 1,
    maximum: int | None = None,
) -> int:
    """Parse a bounded integer environment value."""
    if raw is None or raw.strip() == "":
        value = default
    else:
        try:
            value = int(raw.strip())
        except ValueError as exc:
            raise InvalidTransportSettings(
                f"{name} must be an integer, got {raw!r}."
            ) from exc
    if value < minimum:
        raise InvalidTransportSettings(
            f"{name} must be at least {minimum}, got {value}."
        )
    if maximum is not None and value > maximum:
        raise InvalidTransportSettings(
            f"{name} must be at most {maximum}, got {value}."
        )
    return value


def parse_symbol_list(raw: str | None, default: str) -> tuple[str, ...]:
    """Split a comma-separated symbol list.

    Only splitting happens here. Normalisation to the canonical ``BASE-QUOTE``
    form is the job of :mod:`wlct_trading.exchanges.symbols`, which already owns
    that vocabulary; duplicating it here is exactly how two spellings of the
    same market end up in circulation.
    """
    source = raw if raw is not None and raw.strip() else default
    items = [item.strip() for item in source.split(",")]
    return tuple(item for item in items if item)


@dataclass(slots=True, frozen=True)
class TransportSettings:
    """Runtime settings for the live market-data transport.

    Contains no credentials, and cannot: public market data requires none, and
    exchange API keys live encrypted per trading account in PostgreSQL. There is
    deliberately no field here that could hold a secret.
    """

    # --- Endpoints -----------------------------------------------------
    binance_ws_url: str = BINANCE_SPOT_WS_BASE
    binance_rest_url: str = BINANCE_SPOT_REST_BASE
    use_testnet: bool = False

    # --- What to subscribe to -----------------------------------------
    symbols: tuple[str, ...] = ("BTC/USDT", "ETH/USDT")
    ticker_enabled: bool = True
    trades_enabled: bool = True
    orderbook_enabled: bool = True

    # --- Websocket timeouts (milliseconds) -----------------------------
    ws_connect_timeout_ms: int = 10_000
    #: Backstop only. The connection manager's heartbeat is the primary
    #: liveness detector; this catches a socket wedged below that layer. It is
    #: deliberately generous because a thin symbol's trade stream can be
    #: legitimately silent for minutes, and Binance's own server pings are
    #: answered by the client library without surfacing as messages.
    ws_receive_timeout_ms: int = 300_000
    ws_heartbeat_timeout_ms: int = 90_000
    ws_heartbeat_interval_ms: int = 20_000
    #: Client-initiated ping cadence handed to the websocket library. Binance
    #: pings every 3 minutes and expects a pong within 10; the library answers
    #: those automatically. This is the reverse direction, used to notice a peer
    #: that has gone away silently.
    ws_ping_interval_ms: int = 180_000
    ws_ping_timeout_ms: int = 60_000
    ws_close_timeout_ms: int = 5_000
    #: Frame size ceiling. Binance depth frames are small; an unbounded reader
    #: is a memory-exhaustion vector.
    ws_max_frame_bytes: int = 8 * 1024 * 1024

    # --- HTTP timeouts (milliseconds) ----------------------------------
    http_connect_timeout_ms: int = 5_000
    http_read_timeout_ms: int = 10_000
    http_total_timeout_ms: int = 15_000
    http_max_retries: int = 3
    http_max_connections: int = 20

    # --- Order book -----------------------------------------------------
    orderbook_snapshot_depth: int = 1_000
    orderbook_max_buffered_deltas: int = 5_000
    orderbook_max_resync_attempts: int = 10
    orderbook_staleness_threshold_ms: int = 5_000

    # --- Reconnect -------------------------------------------------------
    reconnect_base_delay_ms: int = 500
    reconnect_max_delay_ms: int = 30_000
    reconnect_max_attempts: int = 20

    # --- Runner ----------------------------------------------------------
    health_report_interval_seconds: int = 15
    smoke_test_duration_seconds: int = 30

    def __post_init__(self) -> None:
        if not self.binance_ws_url.startswith("wss://"):
            raise InvalidTransportSettings(
                f"BINANCE_WS_URL must use wss:// (TLS). Got {self.binance_ws_url!r}. "
                f"Plaintext websocket traffic to an exchange is never acceptable."
            )
        if not self.binance_rest_url.startswith("https://"):
            raise InvalidTransportSettings(
                f"BINANCE_REST_URL must use https://. Got {self.binance_rest_url!r}."
            )
        if self.ws_heartbeat_timeout_ms <= self.ws_heartbeat_interval_ms:
            raise InvalidTransportSettings(
                "WEBSOCKET_HEARTBEAT_TIMEOUT_MS must exceed "
                "WEBSOCKET_HEARTBEAT_INTERVAL_MS, otherwise a healthy connection "
                "is torn down before it can prove itself alive."
            )
        if self.http_total_timeout_ms < self.http_read_timeout_ms:
            raise InvalidTransportSettings(
                "HTTP_TOTAL_TIMEOUT_MS must be at least HTTP_READ_TIMEOUT_MS."
            )
        if not self.symbols:
            raise InvalidTransportSettings(
                "MARKET_DATA_SYMBOLS is empty; there would be nothing to stream."
            )
        if not self.enabled_channels:
            raise InvalidTransportSettings(
                "Every market-data channel is disabled. Enable at least one of "
                "MARKET_DATA_TICKER_ENABLED, MARKET_DATA_TRADES_ENABLED or "
                "MARKET_DATA_ORDERBOOK_ENABLED."
            )

    @property
    def enabled_channels(self) -> tuple[MarketDataChannel, ...]:
        """Channels to subscribe to, in a stable order.

        ``BOOK_TICKER`` is what "ticker" maps to: it is the best bid/ask stream,
        updated on every book change, and it is what the risk engine's
        price-deviation checks need. The 1-second rolling ``TICKER`` stream is a
        statistics feed, not a quote feed.
        """
        channels: list[MarketDataChannel] = []
        if self.orderbook_enabled:
            channels.append(MarketDataChannel.ORDER_BOOK)
        if self.trades_enabled:
            channels.append(MarketDataChannel.TRADES)
        if self.ticker_enabled:
            channels.append(MarketDataChannel.BOOK_TICKER)
        return tuple(channels)

    @classmethod
    def from_env(
        cls, environ: Mapping[str, str] | None = None
    ) -> "TransportSettings":
        """Build settings from the environment.

        Passing ``environ`` explicitly keeps this testable without mutating the
        real process environment.
        """
        env = os.environ if environ is None else environ

        use_testnet = parse_bool(
            env.get("EXCHANGE_USE_TESTNET"), False, name="EXCHANGE_USE_TESTNET"
        )
        default_ws = BINANCE_TESTNET_WS_BASE if use_testnet else BINANCE_SPOT_WS_BASE
        default_rest = (
            BINANCE_TESTNET_REST_BASE if use_testnet else BINANCE_SPOT_REST_BASE
        )

        return cls(
            binance_ws_url=(env.get("BINANCE_WS_URL") or default_ws).strip(),
            binance_rest_url=(env.get("BINANCE_REST_URL") or default_rest).strip(),
            use_testnet=use_testnet,
            symbols=parse_symbol_list(
                env.get("MARKET_DATA_SYMBOLS"), "BTC/USDT,ETH/USDT"
            ),
            ticker_enabled=parse_bool(
                env.get("MARKET_DATA_TICKER_ENABLED"),
                True,
                name="MARKET_DATA_TICKER_ENABLED",
            ),
            trades_enabled=parse_bool(
                env.get("MARKET_DATA_TRADES_ENABLED"),
                True,
                name="MARKET_DATA_TRADES_ENABLED",
            ),
            orderbook_enabled=parse_bool(
                env.get("MARKET_DATA_ORDERBOOK_ENABLED"),
                True,
                name="MARKET_DATA_ORDERBOOK_ENABLED",
            ),
            ws_connect_timeout_ms=parse_int(
                env.get("WEBSOCKET_CONNECT_TIMEOUT_MS"),
                10_000,
                name="WEBSOCKET_CONNECT_TIMEOUT_MS",
                minimum=100,
                maximum=120_000,
            ),
            ws_receive_timeout_ms=parse_int(
                env.get("WEBSOCKET_RECEIVE_TIMEOUT_MS"),
                300_000,
                name="WEBSOCKET_RECEIVE_TIMEOUT_MS",
                minimum=1_000,
                maximum=3_600_000,
            ),
            ws_heartbeat_timeout_ms=parse_int(
                env.get("WEBSOCKET_HEARTBEAT_TIMEOUT_MS"),
                90_000,
                name="WEBSOCKET_HEARTBEAT_TIMEOUT_MS",
                minimum=2_000,
                maximum=600_000,
            ),
            ws_heartbeat_interval_ms=parse_int(
                env.get("WS_HEARTBEAT_INTERVAL_MS"),
                20_000,
                name="WS_HEARTBEAT_INTERVAL_MS",
                minimum=1_000,
                maximum=300_000,
            ),
            ws_ping_interval_ms=parse_int(
                env.get("WEBSOCKET_PING_INTERVAL_MS"),
                180_000,
                name="WEBSOCKET_PING_INTERVAL_MS",
                minimum=5_000,
                maximum=600_000,
            ),
            ws_ping_timeout_ms=parse_int(
                env.get("WEBSOCKET_PING_TIMEOUT_MS"),
                60_000,
                name="WEBSOCKET_PING_TIMEOUT_MS",
                minimum=1_000,
                maximum=600_000,
            ),
            ws_close_timeout_ms=parse_int(
                env.get("WEBSOCKET_CLOSE_TIMEOUT_MS"),
                5_000,
                name="WEBSOCKET_CLOSE_TIMEOUT_MS",
                minimum=100,
                maximum=60_000,
            ),
            ws_max_frame_bytes=parse_int(
                env.get("WEBSOCKET_MAX_FRAME_BYTES"),
                8 * 1024 * 1024,
                name="WEBSOCKET_MAX_FRAME_BYTES",
                minimum=64 * 1024,
                maximum=64 * 1024 * 1024,
            ),
            http_connect_timeout_ms=parse_int(
                env.get("HTTP_CONNECT_TIMEOUT_MS"),
                5_000,
                name="HTTP_CONNECT_TIMEOUT_MS",
                minimum=100,
                maximum=120_000,
            ),
            http_read_timeout_ms=parse_int(
                env.get("HTTP_READ_TIMEOUT_MS"),
                10_000,
                name="HTTP_READ_TIMEOUT_MS",
                minimum=100,
                maximum=120_000,
            ),
            http_total_timeout_ms=parse_int(
                env.get("HTTP_TOTAL_TIMEOUT_MS"),
                15_000,
                name="HTTP_TOTAL_TIMEOUT_MS",
                minimum=100,
                maximum=300_000,
            ),
            http_max_retries=parse_int(
                env.get("HTTP_MAX_RETRIES"),
                3,
                name="HTTP_MAX_RETRIES",
                minimum=0,
                maximum=10,
            ),
            http_max_connections=parse_int(
                env.get("HTTP_MAX_CONNECTIONS"),
                20,
                name="HTTP_MAX_CONNECTIONS",
                minimum=1,
                maximum=200,
            ),
            orderbook_snapshot_depth=parse_int(
                env.get("ORDERBOOK_SNAPSHOT_DEPTH"),
                1_000,
                name="ORDERBOOK_SNAPSHOT_DEPTH",
                minimum=5,
                maximum=5_000,
            ),
            orderbook_max_buffered_deltas=parse_int(
                env.get("ORDERBOOK_MAX_BUFFERED_DELTAS"),
                5_000,
                name="ORDERBOOK_MAX_BUFFERED_DELTAS",
                minimum=100,
                maximum=100_000,
            ),
            orderbook_max_resync_attempts=parse_int(
                env.get("ORDERBOOK_MAX_RESYNC_ATTEMPTS"),
                10,
                name="ORDERBOOK_MAX_RESYNC_ATTEMPTS",
                minimum=1,
                maximum=100,
            ),
            orderbook_staleness_threshold_ms=parse_int(
                env.get("ORDERBOOK_STALENESS_THRESHOLD_MS"),
                5_000,
                name="ORDERBOOK_STALENESS_THRESHOLD_MS",
                minimum=100,
                maximum=600_000,
            ),
            reconnect_base_delay_ms=parse_int(
                env.get("WS_RECONNECT_BASE_DELAY_MS"),
                500,
                name="WS_RECONNECT_BASE_DELAY_MS",
                minimum=10,
                maximum=60_000,
            ),
            reconnect_max_delay_ms=parse_int(
                env.get("WS_RECONNECT_MAX_DELAY_MS"),
                30_000,
                name="WS_RECONNECT_MAX_DELAY_MS",
                minimum=100,
                maximum=600_000,
            ),
            reconnect_max_attempts=parse_int(
                env.get("WS_RECONNECT_MAX_ATTEMPTS"),
                20,
                name="WS_RECONNECT_MAX_ATTEMPTS",
                minimum=1,
                maximum=1_000,
            ),
            health_report_interval_seconds=parse_int(
                env.get("CONNECTIVITY_METRICS_INTERVAL_SECONDS"),
                15,
                name="CONNECTIVITY_METRICS_INTERVAL_SECONDS",
                minimum=1,
                maximum=3_600,
            ),
            smoke_test_duration_seconds=parse_int(
                env.get("LIVE_MARKET_DATA_SMOKE_TEST_DURATION_SECONDS"),
                30,
                name="LIVE_MARKET_DATA_SMOKE_TEST_DURATION_SECONDS",
                minimum=1,
                maximum=3_600,
            ),
        )

    def to_public_dict(self) -> dict[str, object]:
        """Log-safe rendering. There are no secrets to omit."""
        return {
            "binanceWsUrl": self.binance_ws_url,
            "binanceRestUrl": self.binance_rest_url,
            "useTestnet": self.use_testnet,
            "symbols": list(self.symbols),
            "channels": [channel.value for channel in self.enabled_channels],
            "wsConnectTimeoutMs": self.ws_connect_timeout_ms,
            "wsReceiveTimeoutMs": self.ws_receive_timeout_ms,
            "wsHeartbeatTimeoutMs": self.ws_heartbeat_timeout_ms,
            "httpConnectTimeoutMs": self.http_connect_timeout_ms,
            "httpReadTimeoutMs": self.http_read_timeout_ms,
            "httpTotalTimeoutMs": self.http_total_timeout_ms,
            "httpMaxRetries": self.http_max_retries,
            "orderbookSnapshotDepth": self.orderbook_snapshot_depth,
            "reconnectMaxAttempts": self.reconnect_max_attempts,
        }
```

---

## FILE: libs/trading-core/wlct_trading/net/feed.py

Changed by the sweep: ruff F401: unused ``ExchangeId`` import removed.

```py
"""A live market-data feed composed from the Part 3 connectivity primitives.

What this is
------------
The connection manager, subscription manager, staleness monitor, order-book
synchroniser and Binance parsers all already exist and are already tested. What
did not exist was something that holds one socket open, routes its frames to the
right parser, feeds diffs into the right book, and exposes one health view over
the lot. That is this class, and it is deliberately thin: every decision about
*when to reconnect*, *how long to back off*, *what counts as stale* and *whether
a book is tradeable* is delegated to the component that already owns it.

Why it owns a connection rather than calling ``adapter.stream_*``
-----------------------------------------------------------------
The adapter's per-channel async generators are the right tool for consuming one
channel. They are not the right tool here for two reasons. They open one socket
per channel — three sockets for three channels, where Binance permits 1024
streams on one — and they encapsulate the connection manager, so nothing outside
can report whether the venue link is CONNECTED, RECONNECTING or STOPPED. The
health requirement makes that visibility mandatory, so the feed holds the
manager itself, built from the adapter's public helpers
(:meth:`build_subscription`, :meth:`stream_url`, :meth:`build_subscribe_frames`,
:meth:`build_unsubscribe_frames`) and the venue's public error classifier. No
protocol knowledge is reimplemented here.

Concurrency
-----------
Everything runs on one event loop. The read loop is synchronous from frame to
book update, which is what keeps ordering intact; the only asynchronous work is
snapshot fetching, which is handed to a dedicated worker so the read loop never
blocks on I/O.
"""

from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Mapping

from wlct_trading.clock import epoch_micros
from wlct_trading.exchanges.binance import (
    BinanceMarketDataAdapter,
    BinanceParseError,
    classify_binance_error,
    parse_book_ticker,
    parse_depth_delta,
    parse_trade,
    unwrap_combined_stream,
)
from wlct_trading.exchanges.symbols import SymbolRef
from wlct_trading.market_data import BookTop, OrderBookSnapshot, PublicTrade, Ticker
from wlct_trading.metrics import ConnectivityMetrics
from wlct_trading.net.config import TransportSettings
from wlct_trading.net.symbols import resolve_configured_symbols
from wlct_trading.orderbook_sync import (
    OrderBookSynchroniser,
    SyncConfig,
    SyncPhase,
)
from wlct_trading.transport.backoff import BackoffConfig
from wlct_trading.transport.errors import NormalisedExchangeError
from wlct_trading.transport.staleness import StalenessMonitor, StalenessThresholds
from wlct_trading.transport.subscriptions import (
    MarketDataChannel,
    Subscription,
    SubscriptionManager,
)
from wlct_trading.transport.websocket import (
    ConnectionCallbacks,
    ConnectionConfig,
    ConnectionState,
    TransportFactory,
    WebSocketConnectionManager,
)

__all__ = ["MarketDataFeed", "FeedCallbacks", "FeedHealth"]

_LOGGER = logging.getLogger("wlct_trading.net.feed")


@dataclass(slots=True)
class FeedCallbacks:
    """Optional sinks for normalised market data.

    All are synchronous and called from the read loop. A slow callback delays
    every subsequent message on the socket, so anything expensive belongs on a
    queue the callback merely appends to.
    """

    on_ticker: Callable[[Ticker], None] | None = None
    on_trade: Callable[[PublicTrade], None] | None = None
    on_book_update: Callable[[str, BookTop | None], None] | None = None
    on_state_change: Callable[[ConnectionState, ConnectionState], None] | None = None
    on_resync: Callable[[str, str], None] | None = None


@dataclass(slots=True, frozen=True)
class FeedHealth:
    """Point-in-time health of the feed.

    ``connected`` and ``fresh`` are reported separately and never collapsed into
    a single boolean, because the three states an operator must distinguish are
    exactly: connected and fresh, connected but stale, and disconnected. A
    connected socket that has stopped delivering is the dangerous case — it looks
    fine from the outside and its data is worthless.
    """

    exchange: str
    state: ConnectionState
    connected: bool
    fresh: bool
    running: bool
    subscription_count: int
    active_subscription_count: int
    stale_streams: tuple[str, ...]
    reconnect_count: int
    messages_received: int
    parse_errors: int
    tradeable_symbols: tuple[str, ...]
    untradeable_symbols: tuple[str, ...]
    books: tuple[dict[str, object], ...] = field(default_factory=tuple)
    last_error: str | None = None

    @property
    def status(self) -> str:
        """One-word summary for a readiness probe.

        ``degraded`` rather than ``down`` when the socket is up but the data is
        stale: the process is alive and recovering, but nothing should be traded
        against what it currently holds.
        """
        if not self.running:
            return "stopped"
        if not self.connected:
            return "disconnected"
        if not self.fresh:
            return "degraded"
        return "healthy"

    def to_dict(self) -> dict[str, object]:
        return {
            "exchange": self.exchange,
            "status": self.status,
            "state": self.state.value,
            "connected": self.connected,
            "fresh": self.fresh,
            "running": self.running,
            "subscriptionCount": self.subscription_count,
            "activeSubscriptionCount": self.active_subscription_count,
            "staleStreams": list(self.stale_streams),
            "reconnectCount": self.reconnect_count,
            "messagesReceived": self.messages_received,
            "parseErrors": self.parse_errors,
            "tradeableSymbols": list(self.tradeable_symbols),
            "untradeableSymbols": list(self.untradeable_symbols),
            "books": list(self.books),
            "lastError": self.last_error,
        }


class MarketDataFeed:
    """Public market data from one venue, over one connection.

    Public data only. The adapter this drives cannot accept credentials, and no
    method here signs a request or submits an order.
    """

    __slots__ = (
        "_adapter",
        "_settings",
        "_transport_factory",
        "_metrics",
        "_callbacks",
        "_exchange",
        "_symbols",
        "_subscriptions",
        "_subscription_manager",
        "_manager",
        "_staleness",
        "_books",
        "_stream_routes",
        "_tickers",
        "_last_trades",
        "_supervisor",
        "_resync_worker",
        "_staleness_worker",
        "_resync_queue",
        "_running",
        "_started_at",
        "_parse_errors",
        "_last_error",
        "_connection_ready",
        "_connected_event",
    )

    def __init__(
        self,
        adapter: BinanceMarketDataAdapter,
        settings: TransportSettings,
        transport_factory: TransportFactory,
        *,
        metrics: ConnectivityMetrics | None = None,
        callbacks: FeedCallbacks | None = None,
    ) -> None:
        self._adapter = adapter
        self._settings = settings
        self._transport_factory = transport_factory
        self._metrics = metrics or ConnectivityMetrics()
        self._callbacks = callbacks or FeedCallbacks()
        self._exchange = adapter.exchange

        self._symbols: tuple[SymbolRef, ...] = ()
        self._subscriptions: tuple[Subscription, ...] = ()
        self._subscription_manager: SubscriptionManager | None = None
        self._manager: WebSocketConnectionManager | None = None
        self._staleness = StalenessMonitor(
            StalenessThresholds(
                order_book_millis=settings.orderbook_staleness_threshold_ms,
                connection_millis=settings.ws_heartbeat_timeout_ms,
            )
        )
        self._books: dict[str, OrderBookSynchroniser] = {}
        self._stream_routes: dict[str, tuple[MarketDataChannel, str]] = {}
        self._tickers: dict[str, Ticker] = {}
        self._last_trades: dict[str, PublicTrade] = {}

        self._supervisor: asyncio.Task[None] | None = None
        self._resync_worker: asyncio.Task[None] | None = None
        self._staleness_worker: asyncio.Task[None] | None = None
        self._resync_queue: asyncio.Queue[tuple[str, str, bool]] | None = None
        self._running = False
        self._started_at: int | None = None
        self._parse_errors = 0
        self._last_error: str | None = None
        self._connection_ready = False
        self._connected_event = asyncio.Event()

    # ------------------------------------------------------------------
    # Introspection
    # ------------------------------------------------------------------
    @property
    def metrics(self) -> ConnectivityMetrics:
        return self._metrics

    @property
    def is_running(self) -> bool:
        return self._running

    @property
    def symbols(self) -> tuple[SymbolRef, ...]:
        return self._symbols

    @property
    def subscriptions(self) -> tuple[Subscription, ...]:
        return self._subscriptions

    @property
    def connection(self) -> WebSocketConnectionManager | None:
        return self._manager

    def synchroniser(self, canonical_symbol: str) -> OrderBookSynchroniser | None:
        return self._books.get(canonical_symbol.upper())

    def ticker(self, canonical_symbol: str) -> Ticker | None:
        return self._tickers.get(canonical_symbol.upper())

    def last_trade(self, canonical_symbol: str) -> PublicTrade | None:
        return self._last_trades.get(canonical_symbol.upper())

    def book_top(self, canonical_symbol: str) -> BookTop | None:
        """Top of book, or ``None`` when it must not be traded against.

        Two gates, both required. The synchroniser refuses to return a top for a
        book that is not LIVE, healthy and fresh; on top of that, this method
        refuses while the socket is down, because a book can be internally
        consistent and still describe a market that moved five minutes ago.
        """
        synchroniser = self._books.get(canonical_symbol.upper())
        if synchroniser is None:
            return None
        if not self._connection_ready:
            return None
        return synchroniser.top()

    def is_tradeable(self, canonical_symbol: str) -> bool:
        return self.book_top(canonical_symbol) is not None

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------
    async def start(self) -> None:
        """Resolve symbols, open the connection and begin synchronising books.

        The order matters and follows the venue's own guidance: subscribe to the
        diff stream *first*, then fetch the snapshot. Doing it the other way
        leaves a hole between the snapshot and the first buffered diff that
        cannot be detected afterwards.
        """
        if self._running:
            raise RuntimeError("MarketDataFeed is already running.")

        settings = self._settings
        exchange_name = self._exchange.value

        # exchangeInfo is what makes symbol resolution authoritative rather than
        # guesswork, and it rejects a delisted or misspelled market at startup.
        await self._adapter.load_symbols()
        self._symbols = resolve_configured_symbols(
            settings.symbols,
            registry=self._adapter.symbol_registry,
            exchange=self._exchange,
        )

        self._build_subscriptions()
        self._build_books()

        subscription_manager = SubscriptionManager(
            exchange=exchange_name,
            max_subscriptions=max(len(self._subscriptions), 1),
        )
        for subscription in self._subscriptions:
            subscription_manager.add(
                subscription.channel,
                subscription.symbol,
                subscription.stream_name,
                options=dict(subscription.options),
                subscription_id=subscription.subscription_id,
            )
        self._subscription_manager = subscription_manager

        callbacks = ConnectionCallbacks(
            on_message=self._on_message,
            build_subscribe_frames=self._adapter.build_subscribe_frames,
            build_unsubscribe_frames=self._adapter.build_unsubscribe_frames,
            # No application-level ping: Binance pings at the protocol level
            # every three minutes and the client library answers automatically.
            # An extra ping would spend inbound-message budget for nothing.
            build_ping_frame=None,
            classify_error=classify_binance_error,
            on_state_change=self._on_state_change,
            on_error=self._on_error,
        )

        config = ConnectionConfig(
            # Streams are named in the URL, so the socket arrives already
            # subscribed and there is no window where it is open but silent.
            url=self._adapter.stream_url(self._subscriptions),
            name=f"{exchange_name}-market-data",
            connect_timeout_millis=settings.ws_connect_timeout_ms,
            heartbeat_interval_millis=settings.ws_heartbeat_interval_ms,
            heartbeat_timeout_millis=settings.ws_heartbeat_timeout_ms,
            backoff=BackoffConfig(
                base_delay_millis=settings.reconnect_base_delay_ms,
                max_delay_millis=settings.reconnect_max_delay_ms,
                max_attempts=settings.reconnect_max_attempts,
                jitter=True,
            ),
            reconnect_enabled=True,
        )

        self._manager = WebSocketConnectionManager(
            config,
            self._instrumented_transport_factory,
            callbacks,
            subscription_manager,
            exchange=exchange_name,
        )

        self._resync_queue = asyncio.Queue()
        self._running = True
        self._started_at = epoch_micros()

        self._resync_worker = asyncio.create_task(
            self._run_resync_worker(), name="wlct-market-data-resync"
        )
        self._staleness_worker = asyncio.create_task(
            self._run_staleness_worker(), name="wlct-market-data-staleness"
        )

        # The supervisor owns connecting, including the first attempt. Calling
        # connect() here as well would race it: the first socket could drop
        # before run_forever reached its own connect(), and that call would then
        # re-establish the connection as a *first* connect rather than a
        # reconnect — skipping subscription restoration entirely.
        self._supervisor = asyncio.create_task(
            self._manager.run_forever(), name="wlct-market-data-supervisor"
        )
        await self._await_initial_connection()

        # Diffs are already arriving (or will be as soon as the supervisor gets
        # the socket up); queue the first snapshot for every book.
        for canonical in self._books:
            self._queue_resync(canonical, "initial synchronisation", discard=False)

    async def _await_initial_connection(self) -> None:
        """Block until the first connection is up, or until it is clearly late.

        A timeout here is not fatal: the supervisor keeps retrying with the
        existing backoff. It exists so that ``start()`` does not return
        pretending a feed is live when the venue is unreachable.
        """
        timeout = max(1.0, (self._settings.ws_connect_timeout_ms * 2) / 1000)
        try:
            await asyncio.wait_for(self._connected_event.wait(), timeout=timeout)
        except asyncio.TimeoutError:
            self._last_error = (
                f"No connection to the venue within {timeout:.0f}s; the "
                f"supervisor is still retrying with backoff."
            )
            _LOGGER.warning(self._last_error)

    async def stop(self) -> None:
        """Shut down in the order that leaves nothing half-open.

        Unsubscribe, stop the connection manager, then cancel the workers.

        The manager is stopped through its own :meth:`stop` rather than by
        cancelling the supervisor task: ``run_forever`` deliberately suppresses
        cancellation around its reader await so a dropped socket does not kill
        the supervisor, which means a bare ``cancel()`` would be absorbed and
        the task would keep reconnecting. Setting the terminal state first is
        what makes the loop exit.
        """
        if not self._running:
            return
        self._running = False
        self._connection_ready = False

        manager = self._manager
        if manager is not None and manager.is_connected and self._subscriptions:
            try:
                await manager.unsubscribe(self._subscriptions)
            except asyncio.CancelledError:
                raise
            except BaseException as exc:  # noqa: BLE001 - shutdown continues
                _LOGGER.debug("Unsubscribe during shutdown failed: %s", exc)

        if manager is not None:
            try:
                await manager.stop()
            except asyncio.CancelledError:
                raise
            except BaseException as exc:  # noqa: BLE001 - shutdown must complete
                _LOGGER.debug("Connection stop reported: %s", exc)

        for task in (self._supervisor, self._resync_worker, self._staleness_worker):
            if task is not None:
                task.cancel()
        for task in (self._supervisor, self._resync_worker, self._staleness_worker):
            if task is None:
                continue
            try:
                # Bounded: a worker that refuses to die must not hang shutdown.
                await asyncio.wait_for(asyncio.shield(task), timeout=5.0)
            except (asyncio.CancelledError, asyncio.TimeoutError, Exception):  # noqa: BLE001
                pass
        self._supervisor = None
        self._resync_worker = None
        self._staleness_worker = None

    async def __aenter__(self) -> "MarketDataFeed":
        await self.start()
        return self

    async def __aexit__(self, *_exc_info: object) -> None:
        await self.stop()

    # ------------------------------------------------------------------
    # Wiring helpers
    # ------------------------------------------------------------------
    def _build_subscriptions(self) -> None:
        """One subscription per (symbol, enabled channel)."""
        subscriptions: list[Subscription] = []
        routes: dict[str, tuple[MarketDataChannel, str]] = {}
        for symbol in self._symbols:
            for channel in self._settings.enabled_channels:
                subscription = self._adapter.build_subscription(symbol, channel)
                subscriptions.append(subscription)
                routes[subscription.stream_name.lower()] = (channel, symbol.symbol)
                self._staleness.track(channel, symbol.symbol)
        self._subscriptions = tuple(subscriptions)
        self._stream_routes = routes

    def _build_books(self) -> None:
        """One synchroniser per symbol, when the depth channel is enabled."""
        if not self._settings.orderbook_enabled:
            return
        settings = self._settings
        for symbol in self._symbols:
            canonical = symbol.symbol
            self._books[canonical] = OrderBookSynchroniser(
                self._exchange,
                canonical,
                self._make_snapshot_fetcher(symbol),
                config=SyncConfig(
                    snapshot_depth=settings.orderbook_snapshot_depth,
                    max_buffered_deltas=settings.orderbook_max_buffered_deltas,
                    max_resync_attempts=settings.orderbook_max_resync_attempts,
                    staleness_threshold_micros=(
                        settings.orderbook_staleness_threshold_ms * 1_000
                    ),
                ),
                on_resync=self._make_resync_reporter(canonical),
            )

    def _make_snapshot_fetcher(
        self, symbol: SymbolRef
    ) -> Callable[[str, int], Awaitable[OrderBookSnapshot]]:
        """Bind a symbol to the adapter's REST snapshot call, with timing."""

        async def fetch(_canonical: str, depth: int) -> OrderBookSnapshot:
            started = epoch_micros()
            try:
                snapshot = await self._adapter.fetch_order_book_snapshot(symbol, depth)
            except asyncio.CancelledError:
                raise
            except BaseException:
                self._metrics.record_snapshot_request(
                    self._exchange.value, success=False
                )
                raise
            self._metrics.record_snapshot_request(
                self._exchange.value,
                latency_micros=epoch_micros() - started,
                success=True,
            )
            return snapshot

        return fetch

    def _make_resync_reporter(self, canonical: str) -> Callable[[str], None]:
        def report(reason: str) -> None:
            self._metrics.record_book_resync(self._exchange.value)
            self._metrics.record_resync(
                self._exchange.value, MarketDataChannel.ORDER_BOOK.value, canonical
            )
            _LOGGER.info(
                "Order book resync for %s:%s — %s",
                self._exchange.value,
                canonical,
                reason,
            )
            if self._callbacks.on_resync is not None:
                self._callbacks.on_resync(canonical, reason)

        return report

    async def _instrumented_transport_factory(self, url: str) -> Any:
        """Count connection attempts around the injected factory."""
        exchange_name = self._exchange.value
        self._metrics.record_connection_attempt(exchange_name)
        try:
            transport = await self._transport_factory(url)
        except asyncio.CancelledError:
            raise
        except BaseException:
            self._metrics.record_connection_failure(exchange_name)
            raise
        self._metrics.record_connection_success(exchange_name)
        return transport

    # ------------------------------------------------------------------
    # Read path
    # ------------------------------------------------------------------
    def _on_message(self, raw: str) -> None:
        """Route one frame. Never raises.

        A malformed frame is a data problem, not a connection problem. Letting
        it escape would tear down a healthy socket and, with a venue sending one
        bad frame in a loop, produce a reconnect storm. It is counted, logged at
        debug, and dropped.
        """
        received = epoch_micros()
        exchange_name = self._exchange.value
        self._metrics.record_frame(
            exchange_name, byte_count=len(raw.encode("utf-8", errors="ignore"))
        )

        try:
            decoded = json.loads(raw, parse_float=str, parse_int=str)
        except (json.JSONDecodeError, ValueError):
            self._parse_errors += 1
            self._metrics.record_transport_parse_error(exchange_name)
            _LOGGER.debug("Discarded a frame that was not valid JSON.")
            return

        if not isinstance(decoded, Mapping):
            self._parse_errors += 1
            self._metrics.record_transport_parse_error(exchange_name)
            return

        stream, payload = unwrap_combined_stream(decoded)
        if stream is None:
            # {"result": null, "id": 1} — a subscribe acknowledgement, not data.
            if "e" not in payload:
                self._note_control_frame(payload)
                return
            stream = ""

        route = self._stream_routes.get(stream.lower())
        if route is None:
            route = self._route_from_payload(payload)
            if route is None:
                return

        channel, canonical = route
        self._confirm_subscription(stream, received)
        try:
            self._dispatch(channel, canonical, payload, received)
        except BinanceParseError as exc:
            self._parse_errors += 1
            self._metrics.record_parse_error(exchange_name, channel.value, canonical)
            self._metrics.record_transport_parse_error(exchange_name)
            _LOGGER.warning(
                "Dropped a malformed %s message for %s: %s",
                channel.value,
                canonical,
                exc,
            )
        except asyncio.CancelledError:
            raise
        except BaseException as exc:  # noqa: BLE001 - one bad frame is not fatal
            self._parse_errors += 1
            self._metrics.record_parse_error(exchange_name, channel.value, canonical)
            _LOGGER.exception(
                "Unexpected failure handling a %s message for %s: %s",
                channel.value,
                canonical,
                exc,
            )

    def _confirm_subscription(self, stream: str, received: int) -> None:
        """Mark a subscription live once its data actually arrives.

        Sending a SUBSCRIBE frame is not evidence of anything. A stream is
        active when the venue is delivering it, and that is the only definition
        under which a "subscribed but silent" feed shows up as a problem rather
        than as full health.
        """
        subscription_manager = self._subscription_manager
        if subscription_manager is None or not stream:
            return
        subscription = subscription_manager.get_by_stream(stream)
        if subscription is None:
            return
        if not subscription.is_active:
            subscription.mark_active(at_micros=received)
        subscription.record_message(at_micros=received)

    def _note_control_frame(self, payload: Mapping[str, Any]) -> None:
        """Record a venue rejection of a control frame.

        Binance answers a bad SUBSCRIBE with {"error": {...}, "id": N}. Silently
        ignoring it is how a feed ends up permanently subscribed to nothing.
        """
        error = payload.get("error")
        if not isinstance(error, Mapping):
            return
        message = str(error.get("msg") or error)
        self._last_error = f"SUBSCRIPTION_ERROR: {message}"
        self._metrics.record_subscription_failure(
            self._exchange.value, "control", "-"
        )
        _LOGGER.error("The venue rejected a control frame: %s", message)

    def _route_from_payload(
        self, payload: Mapping[str, Any]
    ) -> tuple[MarketDataChannel, str] | None:
        """Fall back to the payload's own event type and symbol.

        Needed for the single-stream endpoint, where frames are not wrapped and
        carry no stream name.
        """
        event = payload.get("e")
        venue_symbol = payload.get("s")
        if not isinstance(venue_symbol, str):
            return None

        if event == "depthUpdate":
            channel = MarketDataChannel.ORDER_BOOK
        elif event in ("trade", "aggTrade"):
            channel = MarketDataChannel.TRADES
        elif event == "24hrTicker":
            channel = MarketDataChannel.TICKER
        elif event is None and "b" in payload and "a" in payload:
            channel = MarketDataChannel.BOOK_TICKER
        else:
            return None

        try:
            canonical = self._adapter.symbol_registry.to_canonical_symbol(
                venue_symbol, self._exchange
            )
        except Exception:  # noqa: BLE001 - unknown symbol, drop the frame
            return None
        if canonical not in self._books and canonical not in self._tickers:
            if not any(ref.symbol == canonical for ref in self._symbols):
                return None
        return (channel, canonical)

    def _dispatch(
        self,
        channel: MarketDataChannel,
        canonical: str,
        payload: Mapping[str, Any],
        received: int,
    ) -> None:
        """Parse and apply one payload. Raises ``BinanceParseError`` on bad data."""
        exchange_name = self._exchange.value
        self._staleness.record_message(channel, canonical, at_micros=received)

        if channel is MarketDataChannel.ORDER_BOOK:
            delta = parse_depth_delta(payload, canonical, received_timestamp=received)
            synchroniser = self._books.get(canonical)
            if synchroniser is None:
                return
            outcome = synchroniser.on_delta(delta)
            processed = epoch_micros()
            self._metrics.record_message(
                exchange_name,
                channel.value,
                canonical,
                exchange_timestamp=delta.exchange_timestamp,
                received_timestamp=received,
                processed_timestamp=processed,
            )
            if outcome.resync_triggered:
                self._metrics.record_gap(exchange_name, channel.value, canonical)
                self._queue_resync(
                    canonical,
                    outcome.reason or "sequence gap detected",
                    discard=False,
                )
            if outcome.applied and self._callbacks.on_book_update is not None:
                self._callbacks.on_book_update(canonical, synchroniser.top())
            return

        if channel is MarketDataChannel.TRADES:
            trade = parse_trade(payload, canonical, received_timestamp=received)
            self._last_trades[canonical] = trade
            self._metrics.record_message(
                exchange_name,
                channel.value,
                canonical,
                exchange_timestamp=trade.exchange_timestamp,
                received_timestamp=received,
                processed_timestamp=epoch_micros(),
            )
            if self._callbacks.on_trade is not None:
                self._callbacks.on_trade(trade)
            return

        if channel is MarketDataChannel.BOOK_TICKER:
            ticker = parse_book_ticker(payload, canonical, received_timestamp=received)
            self._tickers[canonical] = ticker
            self._metrics.record_message(
                exchange_name,
                channel.value,
                canonical,
                exchange_timestamp=ticker.exchange_timestamp,
                received_timestamp=received,
                processed_timestamp=epoch_micros(),
            )
            if self._callbacks.on_ticker is not None:
                self._callbacks.on_ticker(ticker)
            return

    # ------------------------------------------------------------------
    # Connection events
    # ------------------------------------------------------------------
    def _on_state_change(
        self, previous: ConnectionState, current: ConnectionState
    ) -> None:
        """React to the existing state machine. Never raises.

        On leaving CONNECTED the books are invalidated *synchronously* — the
        gate flips before this method returns — and a resync is queued. Waiting
        for the asynchronous resync to start would leave a window in which a
        strategy could read a book from a connection that no longer exists.
        """
        exchange_name = self._exchange.value
        was_connected = previous is ConnectionState.CONNECTED
        self._connection_ready = current is ConnectionState.CONNECTED
        if self._connection_ready:
            self._connected_event.set()
        else:
            self._connected_event.clear()

        if was_connected and current is not ConnectionState.CONNECTED:
            self._metrics.record_disconnect(exchange_name)
            for canonical in self._books:
                self._queue_resync(
                    canonical,
                    f"connection left CONNECTED for {current.value}",
                    discard=True,
                )

        if current is ConnectionState.RECONNECTING:
            self._metrics.record_transport_reconnect(exchange_name)

        # There is deliberately no second resync queued on the way back *into*
        # CONNECTED. Every path out of CONNECTED is covered above, and the
        # resync worker waits for the connection before fetching, so one queued
        # request per disconnect produces exactly one snapshot per reconnect.
        # A depth snapshot costs up to 250 rate-limit weight; fetching two would
        # double that for no benefit.

        _LOGGER.info(
            "Venue connection state: %s -> %s", previous.value, current.value
        )
        if self._callbacks.on_state_change is not None:
            try:
                self._callbacks.on_state_change(previous, current)
            except BaseException:  # noqa: BLE001 - a sink must not break the feed
                _LOGGER.exception("A state-change callback raised.")

    def _on_error(self, error: NormalisedExchangeError) -> None:
        """Record a normalised connection error. Never raises."""
        self._last_error = f"{error.category.value}: {error.message}"
        if error.category.value == "TIMEOUT":
            self._metrics.record_heartbeat_failure(self._exchange.value)
        _LOGGER.warning("Connection error [%s]: %s", error.category.value, error.message)

    # ------------------------------------------------------------------
    # Background workers
    # ------------------------------------------------------------------
    def _queue_resync(self, canonical: str, reason: str, *, discard: bool) -> None:
        """Hand a snapshot fetch to the worker.

        Called from the read loop and from state callbacks, both of which are
        synchronous and must not perform I/O.
        """
        queue = self._resync_queue
        if queue is None:
            return
        try:
            queue.put_nowait((canonical, reason, discard))
        except asyncio.QueueFull:  # pragma: no cover - unbounded queue
            _LOGGER.error("Resync queue is full; dropped a request for %s", canonical)

    async def _run_resync_worker(self) -> None:
        """Serialise snapshot fetches for every book.

        One worker rather than one task per book: a burst of resyncs across ten
        symbols would otherwise fire ten weight-250 depth requests at once and
        earn a rate-limit ban, which is the failure this queue exists to avoid.
        """
        queue = self._resync_queue
        assert queue is not None
        while True:
            canonical, reason, discard = await queue.get()
            try:
                # Never fetch a snapshot while the socket is down. The snapshot
                # would be correct on arrival and immediately obsolete, and the
                # book would go LIVE against a connection that no longer feeds
                # it — the precise state this whole layer exists to prevent.
                await self._connected_event.wait()
                synchroniser = self._books.get(canonical)
                if synchroniser is None:
                    continue
                if synchroniser.phase is SyncPhase.IDLE:
                    await synchroniser.start()
                elif synchroniser.phase is SyncPhase.FAILED:
                    await synchroniser.restart()
                else:
                    await synchroniser.resync(reason, discard_buffer=discard)
            except asyncio.CancelledError:
                raise
            except BaseException as exc:  # noqa: BLE001 - keep the worker alive
                _LOGGER.exception(
                    "Resync of %s failed: %s", canonical, exc
                )
            finally:
                queue.task_done()

    async def _run_staleness_worker(self) -> None:
        """Evaluate stream freshness on a fixed cadence.

        The staleness monitor is edge-triggered and needs to be asked; nothing
        else would notice a stream that simply stopped, because a stream that
        stops produces no message to trigger a check.
        """
        interval = max(1.0, self._settings.ws_heartbeat_interval_ms / 1000)
        while True:
            await asyncio.sleep(interval)
            verdict = self._staleness.evaluate()
            for freshness in verdict.newly_stale:
                self._metrics.record_stale_transition(
                    self._exchange.value,
                    freshness.channel.value,
                    freshness.symbol,
                )
                _LOGGER.warning(
                    "Stream %s:%s went stale.",
                    freshness.channel.value,
                    freshness.symbol,
                )

    # ------------------------------------------------------------------
    # Health
    # ------------------------------------------------------------------
    def health(self) -> FeedHealth:
        """Aggregate health across the connection, streams and books."""
        manager = self._manager
        state = manager.state if manager is not None else ConnectionState.DISCONNECTED
        subscription_manager = self._subscription_manager

        stale = tuple(
            f"{freshness.channel.value}:{freshness.symbol}"
            for freshness in self._staleness.snapshot()
            if freshness.is_stale
        )
        # The connection manager does not track freshness itself — it is told,
        # because "stale" is a market-data judgement and the socket layer has no
        # opinion on how often a given stream ought to tick.
        connection_health = (
            manager.health(is_stale=bool(stale)) if manager is not None else None
        )

        tradeable: list[str] = []
        untradeable: list[str] = []
        books: list[dict[str, object]] = []
        for canonical, synchroniser in sorted(self._books.items()):
            snapshot = synchroniser.health_snapshot()
            gated = self._connection_ready and synchroniser.is_tradeable
            snapshot["isTradeable"] = gated
            snapshot["connectionReady"] = self._connection_ready
            books.append(snapshot)
            (tradeable if gated else untradeable).append(canonical)

        connected = state is ConnectionState.CONNECTED and self._connection_ready
        return FeedHealth(
            exchange=self._exchange.value,
            state=state,
            connected=connected,
            fresh=(
                connected
                and not stale
                and (connection_health is None or not connection_health.is_stale)
            ),
            running=self._running,
            subscription_count=(
                subscription_manager.count if subscription_manager is not None else 0
            ),
            active_subscription_count=(
                subscription_manager.active_count
                if subscription_manager is not None
                else 0
            ),
            stale_streams=stale,
            reconnect_count=manager.reconnect_count if manager is not None else 0,
            messages_received=(
                connection_health.messages_received
                if connection_health is not None
                else 0
            ),
            parse_errors=self._parse_errors,
            tradeable_symbols=tuple(tradeable),
            untradeable_symbols=tuple(untradeable),
            books=tuple(books),
            last_error=self._last_error,
        )
```

---

## FILE: libs/trading-core/wlct_trading/net/signed_client.py

Changed by the sweep: ruff F401: unused ``asyncio`` and clock imports removed.

```py
"""Production ``SignedRequestSender`` backed by ``httpx``.

The authenticated Binance adapters take an injected sender:

.. code-block:: python

    SignedRequestSender = Callable[[SignedRequest, int], Awaitable[HttpResponse]]

This module provides the real one, and it is the only file in the library that
performs an authenticated network call. Keeping it separate from
:mod:`wlct_trading.net.http_client` is deliberate: that client is for public
market data and is wired into the market-data service, which must never hold a
credential. A service that wants to sign orders has to import this module by
name, which makes the money path greppable.

What this adds over the public getter
-------------------------------------
**The signed query string is transmitted verbatim.** The signature covers the
exact bytes, so the URL is assembled here as ``url?query`` and handed to
``httpx`` as a pre-built string. It is never passed through a ``params=`` dict,
because any re-ordering or re-encoding invalidates the signature and produces a
``-1022`` that looks like a credential problem and is not.

**Non-2xx responses are returned, not raised.** The adapter needs the status
code, the body and the rate-limit headers to decide whether a failure was
definitive or ambiguous — a distinction that decides whether an order gets
resubmitted or reconciled. Raising here would throw that information away and
force the adapter to guess.

**Nothing is retried.** Not at this layer. A retry of a signed order is a
potential duplicate position, and the decision about whether a given failure is
safe to repeat belongs to the execution engine, which knows what the request
was for. This sender transmits once and reports what happened.

**Nothing is logged.** Every request carries the API key in a header and the
signature in the query. There is no logger in this module, and the counters it
exposes hold numbers only.
"""

from __future__ import annotations

from types import TracebackType
from typing import Any, Mapping

from wlct_trading.clock import monotonic_nanos
from wlct_trading.exchanges.binance.signing import SignedRequest
from wlct_trading.exchanges.binance.trading import HttpResponse
from wlct_trading.net.config import TransportSettings

__all__ = ["HttpxSignedSender", "InsecureSignedEndpoint"]

#: Cap on how much of an error body is carried back for diagnostics. A venue
#: error body is small; anything larger is a proxy's HTML error page, and
#: keeping megabytes of it in an exception helps nobody.
_MAX_BODY_BYTES = 4_096


class InsecureSignedEndpoint(ValueError):
    """Raised when a signed request targets a non-TLS URL.

    There is deliberately no setting that permits it. A signed request over
    plaintext exposes both the API key header and the signature to anyone on
    the path, which is the whole ballgame.
    """


class HttpxSignedSender:
    """Transmits prepared :class:`SignedRequest` objects.

    Callable, so it satisfies ``SignedRequestSender`` directly:

    .. code-block:: python

        async with HttpxSignedSender(settings) as send:
            trading = BinanceTradingAdapter(
                send=send, credentials=provider, clock=clock
            )

    One instance per process. The connection pool is what makes a signed
    request cheap — a fresh TLS handshake per order would add well over a
    hundred milliseconds to every submission.
    """

    __slots__ = (
        "_settings",
        "_client",
        "_owns_client",
        "requests",
        "failures",
        "bytes_received",
        "last_latency_micros",
        "last_used_weight",
    )

    def __init__(
        self,
        settings: TransportSettings,
        *,
        client: Any | None = None,
    ) -> None:
        self._settings = settings
        self._client = client
        # An injected client belongs to the caller; closing it here would pull
        # the pool out from under them.
        self._owns_client = client is None
        self.requests = 0
        self.failures = 0
        self.bytes_received = 0
        self.last_latency_micros: int | None = None
        #: The venue's own view of consumed rate-limit weight, from the last
        #: response. Worth surfacing: it counts across every process sharing the
        #: IP, which the local limiter cannot see.
        self.last_used_weight: int | None = None

    # ------------------------------------------------------------------
    # Session lifecycle
    # ------------------------------------------------------------------
    def _ensure_client(self) -> Any:
        """Create the session on first use.

        Lazily, so importing this module — which happens during configuration
        validation — does not require the optional dependency or a running
        event loop.
        """
        if self._client is not None:
            return self._client

        try:
            import httpx
        except ImportError as exc:  # pragma: no cover - depends on install
            raise ImportError(
                "The 'httpx' package is required for authenticated exchange "
                "requests. Install it with: pip install 'wlct-trading-core[live]'"
            ) from exc

        settings = self._settings
        self._client = httpx.AsyncClient(
            timeout=httpx.Timeout(
                settings.http_total_timeout_ms / 1000,
                connect=settings.http_connect_timeout_ms / 1000,
                read=settings.http_read_timeout_ms / 1000,
                write=settings.http_read_timeout_ms / 1000,
                pool=settings.http_connect_timeout_ms / 1000,
            ),
            limits=httpx.Limits(
                max_connections=settings.http_max_connections,
                max_keepalive_connections=max(1, settings.http_max_connections // 2),
                # Binance closes idle connections; 30s keeps the pool warm
                # without holding sockets the venue has already discarded.
                keepalive_expiry=30.0,
            ),
            # TLS verification is on and there is no setting to disable it.
            verify=True,
            follow_redirects=False,
        )
        return self._client

    async def aclose(self) -> None:
        """Close the session, if this object owns it."""
        if self._client is not None and self._owns_client:
            await self._client.aclose()
            self._client = None

    async def __aenter__(self) -> "HttpxSignedSender":
        self._ensure_client()
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        await self.aclose()

    # ------------------------------------------------------------------
    # Transmission
    # ------------------------------------------------------------------
    async def __call__(
        self, request: SignedRequest, timeout_ms: int
    ) -> HttpResponse:
        """Send one prepared request and return the raw response.

        Raises only for transport failures — connection refused, TLS failure,
        timeout. Those are the genuinely ambiguous cases, and the adapter maps
        them onto :class:`AdapterConnectionError` so the engine treats the
        order's fate as unknown.

        Every HTTP status, including 4xx and 5xx, comes back as an
        :class:`HttpResponse`. The adapter decides what each one means.
        """
        if not request.url.startswith("https://"):
            raise InsecureSignedEndpoint(
                f"Refusing to transmit a signed request to {request.url!r}. "
                f"Authenticated traffic must use TLS: the API key travels in a "
                f"header and the signature in the query string."
            )

        client = self._ensure_client()
        started_nanos = monotonic_nanos()
        self.requests += 1

        try:
            import httpx

            response = await client.request(
                request.method,
                # Pre-assembled. Passing params= here would let httpx re-encode
                # and re-order, which silently breaks the signature.
                request.full_url,
                headers=dict(request.headers),
                timeout=httpx.Timeout(
                    timeout_ms / 1000,
                    connect=min(
                        timeout_ms / 1000,
                        self._settings.http_connect_timeout_ms / 1000,
                    ),
                    read=timeout_ms / 1000,
                    write=timeout_ms / 1000,
                    pool=self._settings.http_connect_timeout_ms / 1000,
                ),
            )
        except Exception:
            self.failures += 1
            # Re-raised unchanged. The adapter classifies it; adding a message
            # here risks quoting a URL that contains a signature.
            raise
        finally:
            self.last_latency_micros = (monotonic_nanos() - started_nanos) // 1_000

        body = response.text
        if len(body) > _MAX_BODY_BYTES and not 200 <= response.status_code < 300:
            body = body[:_MAX_BODY_BYTES]
        self.bytes_received += len(body)

        headers = {key: value for key, value in response.headers.items()}
        result = HttpResponse(
            status=response.status_code,
            headers=headers,
            body=body,
        )
        self.last_used_weight = result.used_weight_1m
        if not 200 <= response.status_code < 300:
            self.failures += 1
        return result

    # ------------------------------------------------------------------
    # Diagnostics
    # ------------------------------------------------------------------
    def stats(self) -> dict[str, object]:
        """Counters only. Contains no URL, no header and no body."""
        return {
            "requests": self.requests,
            "failures": self.failures,
            "bytesReceived": self.bytes_received,
            "lastLatencyMicros": self.last_latency_micros,
            "lastVenueUsedWeight1m": self.last_used_weight,
        }


async def fetch_server_time(
    sender: HttpxSignedSender, *, rest_base: str, timeout_ms: int = 5_000
) -> int:
    """Read a venue's ``serverTime`` without credentials.

    Lives here rather than on the adapter so the clock can be synchronised
    before any account exists — at process start, and by a health check that
    should not need a tenant to answer "is our clock right?".
    """
    import json as _json

    if not rest_base.startswith("https://"):
        raise InsecureSignedEndpoint(
            f"rest_base must be HTTPS; got {rest_base!r}."
        )
    request = SignedRequest(
        method="GET",
        url=f"{rest_base.rstrip('/')}/api/v3/time",
        query="",
        headers={},
    )
    response = await sender(request, timeout_ms)
    if not 200 <= response.status < 300:
        raise RuntimeError(
            f"Venue returned HTTP {response.status} for server time; the clock "
            f"cannot be synchronised and signing will be refused."
        )
    payload = _json.loads(response.body, parse_float=str, parse_int=str)
    if not isinstance(payload, Mapping) or "serverTime" not in payload:
        raise RuntimeError("Venue returned an unexpected server-time payload.")
    return int(payload["serverTime"])
```

---

## FILE: libs/trading-core/wlct_trading/net/websocket_client.py

Changed by the sweep: lazy ``connect`` import typed through a declared local instead of leaking ``Any``; mypy override for the optional ``websockets`` package added to ``pyproject.toml``.

```py
"""Production ``WebSocketTransport`` backed by the ``websockets`` library.

This is the concrete implementation of the three-method protocol Part 3 defined
in :mod:`wlct_trading.transport.websocket`. It is the *only* module in the
library that imports a websocket client, and nothing imports it except the
service wiring — so the rest of trading-core remains installable and testable
with no network stack present.

What this class is responsible for
----------------------------------
Framing and error translation, and nothing else. Reconnection, backoff, state
transitions, subscription replay and heartbeat policy already exist in
:class:`~wlct_trading.transport.websocket.WebSocketConnectionManager`; adding
any of them here would create the second implementation this codebase has
consistently refused to grow.

The one subtlety worth stating: the library's own ``ConnectionClosed`` family is
translated into the platform's
:class:`~wlct_trading.transport.websocket.ConnectionClosed`, because that is the
exact type the existing manager's read loop catches to distinguish "peer went
away" (reconnect) from "something is broken" (classify and decide).

Ping/pong
---------
Binance sends a server ping every three minutes and expects a pong within ten.
The ``websockets`` library answers those automatically, which is why the Binance
adapter leaves ``build_ping_frame`` unset — an application-level ping would
consume the venue's five-inbound-messages-per-second budget for nothing. The
client-side ``ping_interval`` configured here is the reverse direction: it
detects a peer that has silently gone away.
"""

from __future__ import annotations

import asyncio
import ssl
from typing import Any, Callable

from wlct_trading.clock import epoch_micros
from wlct_trading.net.config import TransportSettings
from wlct_trading.net.normalise import normalise_network_exception
from wlct_trading.transport.websocket import ConnectionClosed, WebSocketTransport

__all__ = [
    "WebsocketsTransport",
    "WebsocketsTransportFactory",
    "InsecureWebSocketUrl",
]


class InsecureWebSocketUrl(ValueError):
    """Raised when a non-TLS websocket URL is supplied.

    Refused outright rather than warned about. Market data received over a
    plaintext socket can be modified in flight, and a book built from modified
    data is worse than no book at all.
    """


class WebsocketsTransport(WebSocketTransport):
    """Adapts a ``websockets`` client connection to the Part 3 protocol.

    Instances are single-use and owned by one connection generation. The manager
    discards a transport on disconnect and asks the factory for a new one, which
    is what keeps generation fencing meaningful.
    """

    __slots__ = (
        "_connection",
        "_receive_timeout_seconds",
        "_closed",
        "_bytes_received",
        "_messages_received",
        "_on_bytes",
    )

    def __init__(
        self,
        connection: Any,
        *,
        receive_timeout_seconds: float,
        on_bytes: Callable[[int], None] | None = None,
    ) -> None:
        self._connection = connection
        self._receive_timeout_seconds = receive_timeout_seconds
        self._closed = False
        self._bytes_received = 0
        self._messages_received = 0
        self._on_bytes = on_bytes

    # ------------------------------------------------------------------
    # Observability
    # ------------------------------------------------------------------
    @property
    def bytes_received(self) -> int:
        return self._bytes_received

    @property
    def messages_received(self) -> int:
        return self._messages_received

    @property
    def is_closed(self) -> bool:
        return self._closed

    # ------------------------------------------------------------------
    # WebSocketTransport protocol
    # ------------------------------------------------------------------
    async def send(self, message: str) -> None:
        """Send one text frame.

        Used for SUBSCRIBE/UNSUBSCRIBE control frames. Errors are normalised so
        the manager's subscription bookkeeping sees a platform error rather than
        a library one.
        """
        if self._closed:
            raise ConnectionClosed("Transport is already closed; cannot send.")
        try:
            await self._connection.send(message)
        except asyncio.CancelledError:
            raise
        except BaseException as exc:  # noqa: BLE001 - normalised below
            if _is_library_closed(exc):
                self._closed = True
                raise ConnectionClosed(
                    f"Send failed because the peer closed the connection: {exc}"
                ) from exc
            raise normalise_network_exception(exc, context="websocket send") from exc

    async def receive(self) -> str:
        """Await the next text frame.

        A bounded wait, never an indefinite one. The timeout is a backstop below
        the manager's heartbeat: it catches a socket that is wedged in a way the
        application layer cannot see. Exceeding it is reported as a normalised
        ``TIMEOUT``, which the existing retry policy treats as retryable.

        Binary frames are decoded as UTF-8. Binance sends text, but a venue that
        switches to compressed binary should surface as a decode error rather
        than a silent drop.
        """
        if self._closed:
            raise ConnectionClosed("Transport is already closed; cannot receive.")
        try:
            raw = await asyncio.wait_for(
                self._connection.recv(), timeout=self._receive_timeout_seconds
            )
        except asyncio.CancelledError:
            raise
        except asyncio.TimeoutError as exc:
            raise normalise_network_exception(
                exc,
                context=(
                    f"websocket receive exceeded "
                    f"{self._receive_timeout_seconds:.0f}s"
                ),
            ) from exc
        except BaseException as exc:  # noqa: BLE001 - normalised below
            if _is_library_closed(exc):
                self._closed = True
                raise ConnectionClosed(f"Peer closed the connection: {exc}") from exc
            raise normalise_network_exception(
                exc, context="websocket receive"
            ) from exc

        if isinstance(raw, bytes):
            self._bytes_received += len(raw)
            if self._on_bytes is not None:
                self._on_bytes(len(raw))
            self._messages_received += 1
            try:
                return raw.decode("utf-8")
            except UnicodeDecodeError as exc:
                raise normalise_network_exception(
                    exc, context="websocket frame is not valid UTF-8"
                ) from exc

        text = str(raw)
        size = len(text.encode("utf-8", errors="ignore"))
        self._bytes_received += size
        if self._on_bytes is not None:
            self._on_bytes(size)
        self._messages_received += 1
        return text

    async def close(self) -> None:
        """Close the socket. Idempotent, and never raises.

        Shutdown must not fail. A transport that throws while closing turns an
        orderly stop into a leaked connection, so every error here is swallowed
        after the socket has been marked closed.
        """
        if self._closed:
            return
        self._closed = True
        try:
            await self._connection.close()
        except asyncio.CancelledError:
            raise
        except BaseException:  # noqa: BLE001 - closing must not fail
            return


def _is_library_closed(exc: BaseException) -> bool:
    """Whether an exception means "the peer closed the connection"."""
    return type(exc).__name__ in (
        "ConnectionClosed",
        "ConnectionClosedOK",
        "ConnectionClosedError",
    )


class WebsocketsTransportFactory:
    """Builds :class:`WebsocketsTransport` instances for the manager.

    Satisfies the existing ``TransportFactory`` signature
    (``Callable[[str], Awaitable[WebSocketTransport]]``) by being callable.
    Implemented as a class rather than a closure so that connection attempts and
    failures can be counted without a mutable default hiding in a function.

    TLS uses Python's default verification. There is no switch here to disable
    certificate checking, by design — such a flag inevitably ends up set in a
    production ``.env``.
    """

    __slots__ = (
        "_settings",
        "_connect",
        "_ssl_context",
        "attempts",
        "successes",
        "failures",
        "last_connected_at",
        "_on_bytes",
    )

    def __init__(
        self,
        settings: TransportSettings,
        *,
        connect: Callable[..., Any] | None = None,
        ssl_context: ssl.SSLContext | None = None,
        on_bytes: Callable[[int], None] | None = None,
    ) -> None:
        self._settings = settings
        self._connect = connect
        self._ssl_context = ssl_context
        self._on_bytes = on_bytes
        self.attempts = 0
        self.successes = 0
        self.failures = 0
        self.last_connected_at: int | None = None

    def _resolve_connect(self) -> Callable[..., Any]:
        """Import the websocket client lazily.

        Deferred so that importing :mod:`wlct_trading.net` does not require the
        optional dependency, and so the failure message names the extra to
        install instead of surfacing a bare ``ModuleNotFoundError``.
        """
        if self._connect is not None:
            return self._connect
        try:
            from websockets.asyncio.client import connect
        except ImportError as exc:  # pragma: no cover - depends on install
            raise ImportError(
                "The 'websockets' package is required for the live websocket "
                "transport. Install it with: pip install 'wlct-trading-core[live]'"
            ) from exc
        # ``connect`` arrives untyped (optional dependency); pin the local to
        # the attribute's declared type so the function returns exactly what
        # its signature promises instead of ``Any``.
        factory: Callable[..., Any] = connect
        self._connect = factory
        return factory

    async def __call__(self, url: str) -> WebSocketTransport:
        """Open one connection and wrap it."""
        if not url.startswith("wss://"):
            raise InsecureWebSocketUrl(
                f"Refusing to open a non-TLS websocket to {url!r}. "
                f"Exchange market data must travel over wss://."
            )

        connect = self._resolve_connect()
        self.attempts += 1

        settings = self._settings
        options: dict[str, Any] = {
            "open_timeout": settings.ws_connect_timeout_ms / 1000,
            "ping_interval": settings.ws_ping_interval_ms / 1000,
            "ping_timeout": settings.ws_ping_timeout_ms / 1000,
            "close_timeout": settings.ws_close_timeout_ms / 1000,
            "max_size": settings.ws_max_frame_bytes,
            # Binance does not negotiate permessage-deflate on the public
            # market-data streams, and leaving compression enabled costs CPU on
            # the hot path for no benefit.
            "compression": None,
            "user_agent_header": "wlct-trading-core",
        }
        if self._ssl_context is not None:
            options["ssl"] = self._ssl_context
        # When no context is supplied the argument is omitted entirely rather
        # than passed as None: the library reads an explicit ssl=None on a
        # wss:// URI as "disable TLS" and refuses. Omitting it selects the
        # default verifying context, which is what is wanted.

        try:
            connection = await connect(url, **options)
        except asyncio.CancelledError:
            raise
        except BaseException as exc:  # noqa: BLE001 - normalised for the manager
            self.failures += 1
            raise normalise_network_exception(
                exc, context=f"websocket connect to {url.split('?', 1)[0]}"
            ) from exc

        self.successes += 1
        self.last_connected_at = epoch_micros()
        return WebsocketsTransport(
            connection,
            receive_timeout_seconds=settings.ws_receive_timeout_ms / 1000,
            on_bytes=self._on_bytes,
        )

    def stats(self) -> dict[str, int | None]:
        """Connection-attempt counters for the metrics layer."""
        return {
            "attempts": self.attempts,
            "successes": self.successes,
            "failures": self.failures,
            "lastConnectedAt": self.last_connected_at,
        }
```

---

## FILE: libs/trading-core/wlct_trading/transport/websocket.py

Changed by the sweep: stop-flag reads routed through ``_stop_requested()`` so mypy cannot narrow them across ``await`` points and mark the guards dead; ConnectionState re-export made explicit.

```py
"""Reusable websocket connection manager.

This owns the lifecycle of exactly one websocket: connecting, heartbeating,
detecting death, backing off, reconnecting, and replaying subscriptions. It is
venue-agnostic — everything venue-specific (URL construction, subscribe frame
format, ping/pong dialect) is supplied by the adapter through
:class:`ConnectionCallbacks`.

Testability
-----------
The manager never imports a websocket library. It talks to a
:class:`WebSocketTransport` protocol supplied by a factory, so the entire
lifecycle — including reconnect storms, heartbeat timeouts and subscription
restoration — is driven in tests by an in-memory fake with no network, no
sleeping and no flakiness. The production factory that wraps ``websockets`` is
a thin adapter implementing three methods.

Concurrency safety
------------------
Two bugs are specifically designed out:

* **Double connections.** Every connect path goes through ``_connect_lock``, and
  each successful connect increments a generation counter. Reader and heartbeat
  tasks capture their generation and exit immediately if it has moved on, so a
  task belonging to a superseded socket cannot resurrect itself or write to the
  new one.
* **Runaway reconnects.** Backoff is mandatory, the attempt cap is honoured, and
  a non-retryable error category drives the connection to ``STOPPED`` rather
  than looping.
"""

from __future__ import annotations

import asyncio
import contextlib
from dataclasses import dataclass, field
from typing import Awaitable, Callable, Protocol, runtime_checkable

from wlct_trading.clock import epoch_micros
from wlct_trading.transport.backoff import BackoffConfig, ExponentialBackoff
from wlct_trading.transport.errors import (
    RETRY_POLICIES,
    ExchangeErrorCategory,
    NormalisedExchangeError,
)
from wlct_trading.transport.state import (
    ConnectionHealth,
    ConnectionState,
    InvalidConnectionTransition,
    LatencyStats,
    is_legal_connection_transition,
)
from wlct_trading.transport.subscriptions import Subscription, SubscriptionManager

__all__ = [
    "WebSocketTransport",
    "TransportFactory",
    "ConnectionCallbacks",
    "ConnectionConfig",
    "WebSocketConnectionManager",
    "ConnectionClosed",
    # Re-exported explicitly: consumers (wlct_trading.net.feed) read the
    # transport state through this module, and under no-implicit-reexport a
    # bare import would make that a type error for them.
    "ConnectionState",
]


class ConnectionClosed(Exception):
    """Raised by a transport when the peer has gone away."""


@runtime_checkable
class WebSocketTransport(Protocol):
    """Minimal websocket surface the manager depends on.

    Deliberately three methods. A wider interface would couple the manager to
    one library's semantics and make the test double harder to trust.
    """

    async def send(self, message: str) -> None:
        """Send one text frame."""
        ...

    async def receive(self) -> str:
        """Await the next text frame. Raise :class:`ConnectionClosed` on close."""
        ...

    async def close(self) -> None:
        """Close the socket. Must be idempotent."""
        ...


#: Builds a transport for a URL. Raising from here is a connect failure and is
#: normalised into a ``NETWORK_ERROR`` unless it is already normalised.
TransportFactory = Callable[[str], Awaitable[WebSocketTransport]]


@dataclass(slots=True)
class ConnectionCallbacks:
    """Venue-specific behaviour injected into the generic manager.

    Every field is optional except ``on_message``; a venue that needs no
    application-level heartbeat simply leaves the ping hooks unset and relies on
    protocol-level pings.
    """

    #: Handle one decoded inbound frame. Runs on the read loop, so it must not
    #: block: hand expensive work to a queue.
    on_message: Callable[[str], Awaitable[None] | None]
    #: Build the frame(s) that subscribe to the given streams.
    build_subscribe_frames: Callable[[tuple[Subscription, ...]], tuple[str, ...]] | None = None
    #: Build the frame(s) that unsubscribe from the given streams.
    build_unsubscribe_frames: Callable[[tuple[Subscription, ...]], tuple[str, ...]] | None = None
    #: Build an application-level ping frame. ``None`` means the venue uses
    #: protocol-level ping/pong and needs no application frame.
    build_ping_frame: Callable[[], str] | None = None
    #: Classify a raw exception into the normalised taxonomy.
    classify_error: Callable[[BaseException], NormalisedExchangeError] | None = None
    #: Notified on every state change, for event emission and logging.
    on_state_change: Callable[[ConnectionState, ConnectionState], None] | None = None
    #: Notified when a normalised error occurs.
    on_error: Callable[[NormalisedExchangeError], None] | None = None


@dataclass(slots=True, frozen=True)
class ConnectionConfig:
    """Timing and policy for one connection.

    Defaults suit exchange market-data sockets. ``heartbeat_timeout_millis``
    must exceed ``heartbeat_interval_millis``, otherwise a connection would be
    declared dead before its first ping could possibly be answered.
    """

    url: str
    name: str = "market-data"
    connect_timeout_millis: int = 10_000
    heartbeat_interval_millis: int = 20_000
    #: Silence after which the socket is considered dead and torn down.
    heartbeat_timeout_millis: int = 60_000
    backoff: BackoffConfig = field(default_factory=BackoffConfig)
    reconnect_enabled: bool = True
    #: Delay between individual subscribe frames, to respect per-second caps.
    subscribe_pacing_millis: int = 250

    def __post_init__(self) -> None:
        if self.connect_timeout_millis <= 0:
            raise ValueError("connect_timeout_millis must be positive.")
        if self.heartbeat_interval_millis <= 0:
            raise ValueError("heartbeat_interval_millis must be positive.")
        if self.heartbeat_timeout_millis <= self.heartbeat_interval_millis:
            raise ValueError(
                "heartbeat_timeout_millis must exceed heartbeat_interval_millis, "
                "otherwise a healthy connection is killed before it can respond."
            )


class WebSocketConnectionManager:
    """Manages one websocket connection end to end."""

    __slots__ = (
        "_config",
        "_factory",
        "_callbacks",
        "_subscriptions",
        "_exchange",
        "_state",
        "_transport",
        "_backoff",
        "_connect_lock",
        "_generation",
        "_reader_task",
        "_heartbeat_task",
        "_connected_at",
        "_last_message_at",
        "_last_heartbeat_at",
        "_last_error",
        "_last_error_at",
        "_reconnect_count",
        "_messages_received",
        "_latency",
        "_stopped",
    )

    def __init__(
        self,
        config: ConnectionConfig,
        transport_factory: TransportFactory,
        callbacks: ConnectionCallbacks,
        subscriptions: SubscriptionManager,
        *,
        exchange: str = "unknown",
    ) -> None:
        self._config = config
        self._factory = transport_factory
        self._callbacks = callbacks
        self._subscriptions = subscriptions
        self._exchange = exchange

        self._state = ConnectionState.DISCONNECTED
        self._transport: WebSocketTransport | None = None
        self._backoff = ExponentialBackoff(config.backoff)
        self._connect_lock = asyncio.Lock()
        self._generation = 0
        self._reader_task: asyncio.Task[None] | None = None
        self._heartbeat_task: asyncio.Task[None] | None = None

        self._connected_at: int | None = None
        self._last_message_at: int | None = None
        self._last_heartbeat_at: int | None = None
        self._last_error: NormalisedExchangeError | None = None
        self._last_error_at: int | None = None
        self._reconnect_count = 0
        self._messages_received = 0
        self._latency = LatencyStats()
        self._stopped = False

    # ------------------------------------------------------------------
    # Observable state
    # ------------------------------------------------------------------
    @property
    def state(self) -> ConnectionState:
        return self._state

    @property
    def is_connected(self) -> bool:
        return self._state is ConnectionState.CONNECTED

    @property
    def subscriptions(self) -> SubscriptionManager:
        return self._subscriptions

    @property
    def generation(self) -> int:
        """Increments on every successful connect. Used to fence stale tasks."""
        return self._generation

    @property
    def reconnect_count(self) -> int:
        return self._reconnect_count

    def health(self, *, is_stale: bool = False) -> ConnectionHealth:
        """Current health snapshot, safe to publish."""
        return ConnectionHealth(
            exchange=self._exchange,
            connection_name=self._config.name,
            state=self._state,
            connected_at=self._connected_at,
            last_message_at=self._last_message_at,
            last_heartbeat_at=self._last_heartbeat_at,
            last_error_at=self._last_error_at,
            last_error_category=(
                self._last_error.category.value if self._last_error else None
            ),
            last_error_message=self._last_error.message if self._last_error else None,
            reconnect_count=self._reconnect_count,
            subscription_count=self._subscriptions.active_count,
            messages_received=self._messages_received,
            is_stale=is_stale,
            latency=self._latency,
        )

    # ------------------------------------------------------------------
    # State machine
    # ------------------------------------------------------------------
    def _transition(self, target: ConnectionState) -> None:
        """Move to ``target``, refusing illegal edges."""
        if target is self._state:
            return
        if not is_legal_connection_transition(self._state, target):
            raise InvalidConnectionTransition(self._config.name, self._state, target)
        previous = self._state
        self._state = target
        if self._callbacks.on_state_change is not None:
            self._callbacks.on_state_change(previous, target)

    def _try_transition(self, target: ConnectionState) -> bool:
        """Non-raising transition, for teardown paths that may race."""
        if target is self._state:
            return True
        if not is_legal_connection_transition(self._state, target):
            return False
        self._transition(target)
        return True

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------
    async def connect(self) -> bool:
        """Open the socket and start the reader and heartbeat tasks.

        Returns ``True`` on success. Serialised by a lock so two concurrent
        callers cannot open two sockets.
        """
        async with self._connect_lock:
            if self._stop_requested():
                return False
            if self._state is ConnectionState.CONNECTED:
                return True
            return await self._open()

    async def _open(self) -> bool:
        """Perform one connect attempt. Caller must hold ``_connect_lock``."""
        if self._state not in (
            ConnectionState.CONNECTING,
            ConnectionState.RECONNECTING,
        ):
            self._transition(ConnectionState.CONNECTING)

        try:
            transport = await asyncio.wait_for(
                self._factory(self._config.url),
                timeout=self._config.connect_timeout_millis / 1000,
            )
        except asyncio.TimeoutError as exc:
            self._record_error(
                self._normalise(
                    exc,
                    default_category=ExchangeErrorCategory.TIMEOUT,
                    message=(
                        f"Connect to {self._config.name} timed out after "
                        f"{self._config.connect_timeout_millis}ms."
                    ),
                )
            )
            self._try_transition(ConnectionState.ERROR)
            return False
        except BaseException as exc:  # noqa: BLE001 - normalised below
            self._record_error(
                self._normalise(
                    exc, default_category=ExchangeErrorCategory.NETWORK_ERROR
                )
            )
            self._try_transition(ConnectionState.ERROR)
            return False

        self._transport = transport
        self._generation += 1
        self._connected_at = epoch_micros()
        self._last_message_at = self._connected_at
        self._last_heartbeat_at = self._connected_at
        self._transition(ConnectionState.CONNECTED)
        self._backoff.reset()

        generation = self._generation
        self._reader_task = asyncio.create_task(
            self._read_loop(generation), name=f"ws-read-{self._config.name}"
        )
        self._heartbeat_task = asyncio.create_task(
            self._heartbeat_loop(generation), name=f"ws-hb-{self._config.name}"
        )
        return True

    async def disconnect(self) -> None:
        """Close the socket without stopping the manager.

        The connection may be reconnected afterwards; use :meth:`stop` for a
        permanent shutdown.
        """
        await self._teardown()
        self._try_transition(ConnectionState.DISCONNECTED)

    def _stop_requested(self) -> bool:
        """Read the stop flag through a call site mypy cannot narrow.

        ``_stopped`` is set by :meth:`stop`, potentially from another task
        while a caller of this loop is suspended at an ``await``. Attribute
        narrowing across awaits cannot see that write, so flow analysis on the
        bare ``self._stopped`` would wrongly mark every later "am I stopped?"
        check unreachable. The indirection is the fix, and it documents
        itself.
        """
        return self._stopped

    async def stop(self) -> None:
        """Permanently stop. Terminal — the manager will not reconnect."""
        self._stopped = True
        await self._teardown()
        self._try_transition(ConnectionState.STOPPED)

    async def _teardown(self) -> None:
        """Cancel tasks and close the transport. Safe to call repeatedly."""
        # Bump the generation first so in-flight tasks observe that they are
        # stale even before cancellation is delivered.
        self._generation += 1

        for task in (self._reader_task, self._heartbeat_task):
            if task is not None and not task.done():
                task.cancel()
                with contextlib.suppress(asyncio.CancelledError, Exception):
                    await task
        self._reader_task = None
        self._heartbeat_task = None

        if self._transport is not None:
            with contextlib.suppress(Exception):
                await self._transport.close()
            self._transport = None

    async def reconnect(self) -> bool:
        """Tear down and reconnect once, honouring backoff and the attempt cap.

        Returns ``True`` if the connection was re-established. Callers that want
        persistent retry should use :meth:`run_forever`.
        """
        if self._stop_requested() or not self._config.reconnect_enabled:
            return False

        await self._teardown()

        if not self._backoff.can_retry():
            self._record_error(
                NormalisedExchangeError(
                    category=ExchangeErrorCategory.NETWORK_ERROR,
                    message=(
                        f"Giving up on {self._config.name} after "
                        f"{self._backoff.attempt} reconnect attempts."
                    ),
                    exchange=self._exchange,
                )
            )
            self._try_transition(ConnectionState.ERROR)
            self._try_transition(ConnectionState.STOPPED)
            self._stopped = True
            return False

        self._try_transition(ConnectionState.RECONNECTING)

        multiplier = 1.0
        if self._last_error is not None:
            multiplier = RETRY_POLICIES[self._last_error.category].backoff_multiplier
        delay_millis = self._backoff.next_delay_millis(multiplier=multiplier)
        await asyncio.sleep(delay_millis / 1000)

        if self._stop_requested():
            return False

        self._reconnect_count += 1

        async with self._connect_lock:
            connected = await self._open()

        if connected:
            await self.restore_subscriptions()
        return connected

    async def run_forever(self) -> None:
        """Connect and keep the connection alive until :meth:`stop`.

        This is the supervisor loop. It exits only on an explicit stop, a
        non-retryable error, or exhaustion of the attempt cap — never silently.
        """
        if not await self.connect():
            if not self._should_keep_retrying():
                return

        while not self._stop_requested():
            # Wait for the reader to finish, which happens on disconnect.
            if self._reader_task is not None:
                with contextlib.suppress(asyncio.CancelledError, Exception):
                    await self._reader_task

            if self._stop_requested():
                break
            if not self._should_keep_retrying():
                self._try_transition(ConnectionState.ERROR)
                self._try_transition(ConnectionState.STOPPED)
                self._stopped = True
                break
            if not await self.reconnect():
                if self._stop_requested():
                    break

    def _should_keep_retrying(self) -> bool:
        """Whether the last error permits another attempt."""
        if not self._config.reconnect_enabled:
            return False
        if self._last_error is None:
            return True
        return self._last_error.is_retryable

    # ------------------------------------------------------------------
    # Subscriptions
    # ------------------------------------------------------------------
    async def subscribe(self, subscriptions: tuple[Subscription, ...]) -> bool:
        """Send subscribe frames for the given subscriptions."""
        if not subscriptions:
            return True
        if self._transport is None or not self.is_connected:
            return False
        if self._callbacks.build_subscribe_frames is None:
            return False

        frames = self._callbacks.build_subscribe_frames(subscriptions)
        try:
            for index, frame in enumerate(frames):
                if index > 0 and self._config.subscribe_pacing_millis > 0:
                    await asyncio.sleep(self._config.subscribe_pacing_millis / 1000)
                await self._transport.send(frame)
        except BaseException as exc:  # noqa: BLE001 - normalised below
            error = self._normalise(
                exc, default_category=ExchangeErrorCategory.SUBSCRIPTION_ERROR
            )
            self._record_error(error)
            for subscription in subscriptions:
                subscription.mark_failed(error.message)
            return False
        return True

    async def unsubscribe(self, subscriptions: tuple[Subscription, ...]) -> bool:
        """Send unsubscribe frames for the given subscriptions."""
        if not subscriptions:
            return True
        if self._transport is None or not self.is_connected:
            return False
        if self._callbacks.build_unsubscribe_frames is None:
            return False

        frames = self._callbacks.build_unsubscribe_frames(subscriptions)
        try:
            for frame in frames:
                await self._transport.send(frame)
        except BaseException as exc:  # noqa: BLE001 - normalised below
            self._record_error(
                self._normalise(
                    exc, default_category=ExchangeErrorCategory.SUBSCRIPTION_ERROR
                )
            )
            return False
        return True

    async def restore_subscriptions(self) -> bool:
        """Replay every non-cancelled subscription onto the new socket.

        The new socket has confirmed nothing, so everything is demoted to
        PENDING first. Without that step a reconnected-but-unsubscribed feed
        would keep reporting itself fully subscribed while delivering nothing.
        """
        self._subscriptions.mark_all_pending()
        restorable = self._subscriptions.restorable()
        if not restorable:
            return True
        return await self.subscribe(restorable)

    # ------------------------------------------------------------------
    # Read and heartbeat loops
    # ------------------------------------------------------------------
    async def _read_loop(self, generation: int) -> None:
        """Consume frames until the socket closes or the generation moves on."""
        transport = self._transport
        if transport is None:
            return

        try:
            while not self._stop_requested() and generation == self._generation:
                try:
                    raw = await transport.receive()
                except (ConnectionClosed, asyncio.IncompleteReadError) as exc:
                    self._record_error(
                        self._normalise(
                            exc,
                            default_category=ExchangeErrorCategory.NETWORK_ERROR,
                            message=f"{self._config.name} closed by peer.",
                        )
                    )
                    break
                except asyncio.CancelledError:
                    raise
                except BaseException as exc:  # noqa: BLE001 - normalised below
                    self._record_error(
                        self._normalise(
                            exc, default_category=ExchangeErrorCategory.NETWORK_ERROR
                        )
                    )
                    break

                # Stamp arrival before any parsing work, so the recorded
                # receive time reflects the wire, not our own processing.
                received_at = epoch_micros()
                if generation != self._generation:
                    break

                self._last_message_at = received_at
                self._messages_received += 1

                try:
                    result = self._callbacks.on_message(raw)
                    if asyncio.iscoroutine(result):
                        await result
                except asyncio.CancelledError:
                    raise
                except BaseException as exc:  # noqa: BLE001 - isolate handler bugs
                    # A malformed frame or a bug in one handler must not kill
                    # the feed; record and keep reading.
                    self._record_error(
                        self._normalise(
                            exc, default_category=ExchangeErrorCategory.EXCHANGE_ERROR
                        )
                    )
        except asyncio.CancelledError:
            raise
        finally:
            if generation == self._generation and not self._stop_requested():
                self._try_transition(ConnectionState.DISCONNECTED)

    async def _heartbeat_loop(self, generation: int) -> None:
        """Send periodic pings and enforce the silence timeout."""
        interval = self._config.heartbeat_interval_millis / 1000
        timeout_micros = self._config.heartbeat_timeout_millis * 1_000

        try:
            while not self._stop_requested() and generation == self._generation:
                await asyncio.sleep(interval)
                if self._stop_requested() or generation != self._generation:
                    return

                now = epoch_micros()
                last = self._last_message_at or self._connected_at or now
                if now - last > timeout_micros:
                    # Socket looks open but nothing is arriving. Treat as dead
                    # and let the supervisor reconnect; this is the failure the
                    # heartbeat exists to catch.
                    self._record_error(
                        NormalisedExchangeError(
                            category=ExchangeErrorCategory.TIMEOUT,
                            message=(
                                f"{self._config.name} received no data for "
                                f"{(now - last) // 1000}ms, exceeding the "
                                f"{self._config.heartbeat_timeout_millis}ms timeout."
                            ),
                            exchange=self._exchange,
                        )
                    )
                    await self._teardown()
                    self._try_transition(ConnectionState.DISCONNECTED)
                    return

                if self._callbacks.build_ping_frame is None or self._transport is None:
                    continue

                sent_at = epoch_micros()
                try:
                    await self._transport.send(self._callbacks.build_ping_frame())
                    self._last_heartbeat_at = sent_at
                    self._latency = self._latency.with_ping(epoch_micros() - sent_at)
                except asyncio.CancelledError:
                    raise
                except BaseException as exc:  # noqa: BLE001 - normalised below
                    self._record_error(
                        self._normalise(
                            exc, default_category=ExchangeErrorCategory.NETWORK_ERROR
                        )
                    )
                    return
        except asyncio.CancelledError:
            raise

    # ------------------------------------------------------------------
    # Bookkeeping
    # ------------------------------------------------------------------
    def record_feed_lag(self, lag_micros: int) -> None:
        """Record exchange-timestamp-to-receipt lag for the latest message."""
        self._latency = self._latency.with_feed_lag(lag_micros)

    def record_heartbeat(self, *, at_micros: int | None = None) -> None:
        """Note an inbound pong or server heartbeat."""
        self._last_heartbeat_at = at_micros if at_micros is not None else epoch_micros()

    def _record_error(self, error: NormalisedExchangeError) -> None:
        self._last_error = error
        self._last_error_at = epoch_micros()
        if self._callbacks.on_error is not None:
            self._callbacks.on_error(error)

    def _normalise(
        self,
        exc: BaseException,
        *,
        default_category: ExchangeErrorCategory,
        message: str | None = None,
    ) -> NormalisedExchangeError:
        """Convert a raw exception into the normalised taxonomy."""
        if isinstance(exc, NormalisedExchangeError):
            return exc
        if self._callbacks.classify_error is not None:
            try:
                return self._callbacks.classify_error(exc)
            except Exception:  # noqa: BLE001 - fall through to the default
                pass
        return NormalisedExchangeError(
            category=default_category,
            message=message or f"{type(exc).__name__}: {exc}",
            exchange=self._exchange,
            metadata={"exceptionType": type(exc).__name__},
        )
```

---

## FILE: libs/trading-core/wlct_trading/transport/staleness.py

Changed by the sweep: ruff F401: unused ``dataclasses.field`` import removed.

```py
"""Stale market-data detection.

The dangerous failure in market data is not a disconnect — a disconnect is loud
and the reconnect logic handles it. The dangerous failure is a socket that stays
open, answers every heartbeat, and stops delivering data. Everything downstream
looks healthy while the book quietly freezes, and a strategy prices orders
against a snapshot of the past.

This module watches per-stream arrival times and flags that condition. It is
pure: it holds timestamps and answers questions about them, performing no I/O
and owning no timer. The caller (the connection manager's watchdog, or a health
endpoint) supplies ``now`` and reacts to the verdict, which makes every
threshold directly testable.

Thresholds are per channel because the channels have genuinely different
natural rates. A book on a liquid pair updates many times a second, so silence
for two seconds is alarming. A trade stream on an illiquid pair may legitimately
be silent for minutes, and flagging that as a fault would produce noise that
trains operators to ignore the alert.
"""

from __future__ import annotations

from dataclasses import dataclass

from wlct_trading.clock import epoch_micros
from wlct_trading.transport.subscriptions import MarketDataChannel

__all__ = [
    "StalenessThresholds",
    "StreamFreshness",
    "StalenessMonitor",
    "StalenessVerdict",
]

_MILLIS = 1_000


@dataclass(slots=True, frozen=True)
class StalenessThresholds:
    """Per-channel silence tolerated before a stream is called stale.

    Defaults are deliberately conservative for the book (which must be fresh to
    be safe) and lenient for trades (which are legitimately sporadic).
    """

    order_book_millis: int = 5_000
    ticker_millis: int = 10_000
    #: Best bid/ask updates on every book change, so silence here is as
    #: suspicious as silence on the book itself.
    book_ticker_millis: int = 5_000
    trades_millis: int = 60_000
    candles_millis: int = 120_000
    #: Silence across the whole connection, regardless of channel. Catches the
    #: case where every stream stops at once.
    connection_millis: int = 30_000

    def for_channel(self, channel: MarketDataChannel) -> int:
        if channel is MarketDataChannel.ORDER_BOOK:
            return self.order_book_millis
        if channel is MarketDataChannel.TICKER:
            return self.ticker_millis
        if channel is MarketDataChannel.BOOK_TICKER:
            return self.book_ticker_millis
        if channel is MarketDataChannel.TRADES:
            return self.trades_millis
        return self.candles_millis


@dataclass(slots=True)
class StreamFreshness:
    """Arrival bookkeeping for one channel/symbol pair."""

    channel: MarketDataChannel
    symbol: str
    last_message_at: int | None = None
    message_count: int = 0
    #: Sticky until recovery, so a transition can be reported exactly once.
    is_stale: bool = False
    became_stale_at: int | None = None
    stale_episodes: int = 0

    @property
    def key(self) -> tuple[str, str]:
        return (self.channel.value, self.symbol)


@dataclass(slots=True, frozen=True)
class StalenessVerdict:
    """Outcome of one evaluation sweep.

    ``newly_stale`` and ``recovered`` carry only the *transitions*, so the
    caller emits one MarketDataStale event per episode rather than one per
    poll.
    """

    newly_stale: tuple[StreamFreshness, ...] = ()
    recovered: tuple[StreamFreshness, ...] = ()
    still_stale: tuple[StreamFreshness, ...] = ()
    connection_stale: bool = False

    @property
    def has_changes(self) -> bool:
        return bool(self.newly_stale or self.recovered)

    @property
    def any_stale(self) -> bool:
        return bool(self.newly_stale or self.still_stale) or self.connection_stale


class StalenessMonitor:
    """Tracks freshness of every stream on one connection."""

    __slots__ = ("_thresholds", "_streams", "_last_any_message_at")

    def __init__(self, thresholds: StalenessThresholds | None = None) -> None:
        self._thresholds = thresholds or StalenessThresholds()
        self._streams: dict[tuple[str, str], StreamFreshness] = {}
        self._last_any_message_at: int | None = None

    @property
    def thresholds(self) -> StalenessThresholds:
        return self._thresholds

    def track(self, channel: MarketDataChannel, symbol: str) -> StreamFreshness:
        """Begin monitoring a stream. Idempotent."""
        key = (channel.value, symbol)
        freshness = self._streams.get(key)
        if freshness is None:
            freshness = StreamFreshness(channel=channel, symbol=symbol)
            self._streams[key] = freshness
        return freshness

    def untrack(self, channel: MarketDataChannel, symbol: str) -> None:
        self._streams.pop((channel.value, symbol), None)

    def record_message(
        self,
        channel: MarketDataChannel,
        symbol: str,
        *,
        at_micros: int | None = None,
    ) -> StreamFreshness:
        """Note that a message arrived. Called on the hot path — keep it cheap."""
        now = epoch_micros() if at_micros is None else at_micros
        freshness = self.track(channel, symbol)
        freshness.last_message_at = now
        freshness.message_count += 1
        self._last_any_message_at = now
        return freshness

    def evaluate(self, *, now_micros: int | None = None) -> StalenessVerdict:
        """Classify every tracked stream as fresh, newly stale, or recovered.

        A stream that has never received a message is *not* reported stale: it
        has not started yet, and conflating "not started" with "stopped" would
        fire an alert on every startup.
        """
        now = epoch_micros() if now_micros is None else now_micros
        newly_stale: list[StreamFreshness] = []
        recovered: list[StreamFreshness] = []
        still_stale: list[StreamFreshness] = []

        for freshness in self._streams.values():
            if freshness.last_message_at is None:
                continue

            limit_micros = (
                self._thresholds.for_channel(freshness.channel) * _MILLIS
            )
            age = now - freshness.last_message_at
            stale_now = age > limit_micros

            if stale_now and not freshness.is_stale:
                freshness.is_stale = True
                freshness.became_stale_at = now
                freshness.stale_episodes += 1
                newly_stale.append(freshness)
            elif stale_now:
                still_stale.append(freshness)
            elif freshness.is_stale:
                freshness.is_stale = False
                freshness.became_stale_at = None
                recovered.append(freshness)

        connection_stale = False
        if self._last_any_message_at is not None:
            connection_age = now - self._last_any_message_at
            connection_stale = (
                connection_age > self._thresholds.connection_millis * _MILLIS
            )

        return StalenessVerdict(
            newly_stale=tuple(newly_stale),
            recovered=tuple(recovered),
            still_stale=tuple(still_stale),
            connection_stale=connection_stale,
        )

    def is_stale(self, channel: MarketDataChannel, symbol: str) -> bool:
        """Last known verdict for one stream, without re-evaluating."""
        freshness = self._streams.get((channel.value, symbol))
        return bool(freshness and freshness.is_stale)

    def any_stale(self) -> bool:
        return any(f.is_stale for f in self._streams.values())

    def stale_streams(self) -> tuple[StreamFreshness, ...]:
        return tuple(f for f in self._streams.values() if f.is_stale)

    def reset(self) -> None:
        """Clear all freshness state, e.g. after a reconnect.

        Arrival times from the previous socket say nothing about the new one,
        and keeping them would make a fresh connection look instantly stale.
        """
        for freshness in self._streams.values():
            freshness.last_message_at = None
            freshness.is_stale = False
            freshness.became_stale_at = None
        self._last_any_message_at = None

    def snapshot(self) -> tuple[StreamFreshness, ...]:
        return tuple(self._streams.values())
```

---

## FILE: libs/trading-core/tests/test_execution.py

Changed by the sweep: ruff F401: unused imports removed.

```py
"""Part 5: authenticated execution.

Thirty deterministic cases covering signing, credential safety, validation,
the safety gates, idempotency, the ambiguous-result path, reconciliation and
the private stream.

Two rules govern every test here:

* **No real credentials.** Every key and secret in this file is a literal
  fixture. Nothing in the suite can reach a real venue, and nothing needs to.
* **No network, no clock, no sleep.** Every dependency is a deterministic
  fake, so a failure means a behaviour changed rather than that a socket was
  slow.

Coroutines are driven with ``asyncio.run`` rather than ``pytest-asyncio``,
which is deliberately not a dependency of this project.
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
from decimal import Decimal
from typing import Any

import pytest

from wlct_trading.adapters.base import (
    AccountBalance,
    AdapterConnectionError,
    AdapterRateLimitedError,
    AdapterRejectedError,
    SubmitResult,
    SymbolSpecification,
    VenueAccount,
)
from wlct_trading.enums import (
    ExchangeId,
    MarketType,
    OrderSide,
    OrderStatus,
    OrderType,
    TimeInForce,
    TradingMode,
)
from wlct_trading.exchanges.binance.signing import (
    SignatureError,
    binance_signature,
    build_signed_request,
    encode_params,
    format_decimal,
)
from wlct_trading.exchanges.binance.trading import (
    BinanceTradingAdapter,
    HttpResponse,
)
from wlct_trading.exchanges.binance.userstream import (
    ListenKeyManager,
    UserStreamEventType,
    mask_listen_key,
    parse_user_stream_message,
)
from wlct_trading.execution import (
    ClockNotSynchronised,
    ClockSkewExceeded,
    ComponentHealth,
    EngineConfigurationError,
    ExchangeClock,
    ExchangeCredentials,
    ExecutionContext,
    ExecutionEngine,
    ExecutionErrorCode,
    ExecutionOutcome,
    ExecutionSettings,
    InMemoryIncidentRecorder,
    InMemoryLockManager,
    InMemoryOrderStore,
    IncidentType,
    OrderValidator,
    ReconciliationService,
    ReconciliationState,
    StaticCredentialProvider,
    UnsafeExecutionConfiguration,
    ValidationCode,
    evaluate_safety_gates,
    scrub_secret_like,
)
from wlct_trading.execution.safety import ExecutionPreconditions
from wlct_trading.orders import Fill, Order, OrderIntent
from wlct_trading.positions import PositionManager
from wlct_trading.risk import KillSwitchState, RiskEngine, RiskLimits, RiskSnapshot

# ----------------------------------------------------------------------
# Fixtures: entirely synthetic, never a real key
# ----------------------------------------------------------------------
FAKE_API_KEY = "TESTKEY0000000000000000000000000000000000000000000000000000AAAA"
FAKE_API_SECRET = "TESTSECRET0000000000000000000000000000000000000000000000000BBBB"

#: The worked example from Binance's own signing documentation. Using the
#: published vector means this test verifies the implementation against the
#: venue's specification rather than against itself.
DOC_SECRET = "NhqPtmdSJYdKjVHjA7PZj4Mge3R5YNiP1e3UZjInClVN65XAbvqqM6A7H5fATj0j"
DOC_QUERY = (
    "symbol=LTCBTC&side=BUY&type=LIMIT&timeInForce=GTC&quantity=1&"
    "price=0.1&recvWindow=5000&timestamp=1499827319559"
)
DOC_SIGNATURE = (
    "c8db56825ae71d6d79447849e617115f4a920fa2acdcab2b053c4b2838bd6b71"
)


def credentials(**overrides: Any) -> ExchangeCredentials:
    base: dict[str, Any] = {
        "tenant_id": "tenant-1",
        "account_id": "account-1",
        "exchange": ExchangeId.BINANCE,
        "api_key": FAKE_API_KEY,
        "api_secret": FAKE_API_SECRET,
    }
    base.update(overrides)
    return ExchangeCredentials(**base)


def spec(**overrides: Any) -> SymbolSpecification:
    base: dict[str, Any] = {
        "symbol": "BTC/USDT",
        "venue_symbol": "BTCUSDT",
        "exchange": ExchangeId.BINANCE,
        "market_type": MarketType.SPOT,
        "base_asset": "BTC",
        "quote_asset": "USDT",
        "price_tick": Decimal("0.01"),
        "quantity_step": Decimal("0.00001"),
        "min_quantity": Decimal("0.00001"),
        "max_quantity": Decimal("9000"),
        "min_notional": Decimal("10"),
        "is_tradeable": True,
        "price_precision": 2,
        "quantity_precision": 5,
    }
    base.update(overrides)
    return SymbolSpecification(**base)


def intent(**overrides: Any) -> OrderIntent:
    base: dict[str, Any] = {
        "tenant_id": "tenant-1",
        "account_id": "account-1",
        "strategy_id": "strategy-1",
        "exchange": ExchangeId.BINANCE,
        "symbol": "BTC/USDT",
        "side": OrderSide.BUY,
        "order_type": OrderType.LIMIT,
        "quantity": Decimal("0.01"),
        "price": Decimal("50000.00"),
        "time_in_force": TimeInForce.GTC,
    }
    base.update(overrides)
    return OrderIntent(**base)


def snapshot(**overrides: Any) -> RiskSnapshot:
    base: dict[str, Any] = {
        "position_quantity": Decimal(0),
        "symbol_exposure_notional": Decimal(0),
        "account_exposure_notional": Decimal(0),
        "open_order_count": 0,
        "orders_in_last_minute": 0,
        "realised_pnl_today": Decimal(0),
        "strategy_realised_pnl_today": Decimal(0),
        "reference_price": Decimal("50000.00"),
        "market_data_age_micros": 1_000,
        "book_usable": True,
        "is_complete": True,
        "known_client_order_ids": frozenset(),
    }
    base.update(overrides)
    return RiskSnapshot(**base)


def no_kill_switches() -> KillSwitchState:
    return KillSwitchState(
        global_engaged=False,
        engaged_exchanges=frozenset(),
        engaged_strategies=frozenset(),
        engaged_symbols=frozenset(),
        reason=None,
    )


def paper_settings(**overrides: Any) -> ExecutionSettings:
    """Settings that permit a simulated submission and transmit nothing."""
    base: dict[str, Any] = {
        "live_trading_enabled": False,
        "dry_run": False,
        "paper_trading": True,
        "trading_mode_setting": "PAPER",
        "trading_enabled": True,
        "live_trading_confirmed": False,
    }
    base.update(overrides)
    return ExecutionSettings(**base)


def healthy_context(**overrides: Any) -> ExecutionContext:
    base: dict[str, Any] = {
        "snapshot": snapshot(),
        "kill_switches": no_kill_switches(),
        "specification": spec(),
        "reference_price": Decimal("50000.00"),
        "risk_health": ComponentHealth.ok(age_micros=1_000),
        "market_data_health": ComponentHealth.ok(),
        "exchange_health": ComponentHealth.ok(),
        "credentials": credentials(),
    }
    base.update(overrides)
    return ExecutionContext(**base)


def risk_engine() -> RiskEngine:
    return RiskEngine(
        RiskLimits(
            max_order_quantity=Decimal("1000"),
            max_order_notional=Decimal("1000000"),
            max_position_quantity=Decimal("5000000"),
            max_symbol_exposure_notional=Decimal("5000000"),
            max_account_exposure_notional=Decimal("10000000"),
            max_open_orders=100,
            max_orders_per_minute=100,
            max_daily_loss=Decimal("1000000"),
            max_price_deviation_percent=Decimal("50"),
            max_market_data_age_micros=60_000_000,
        )
    )


class StubTradingAdapter:
    """A deterministic TradingAdapter stand-in.

    Not a subclass: the point is to control exactly what the engine observes,
    including raising the transport errors that make an outcome ambiguous.
    """

    def __init__(
        self,
        *,
        result: SubmitResult | None = None,
        error: Exception | None = None,
        simulated: bool = False,
        open_orders: tuple[Order, ...] = (),
        lookup: Order | None = None,
    ) -> None:
        self._result = result
        self._error = error
        self._simulated = simulated
        self._open_orders = open_orders
        self._lookup = lookup
        self.submit_calls: list[tuple[OrderIntent, str]] = []
        self.lookup_calls: list[str] = []

    @property
    def exchange(self) -> ExchangeId:
        return ExchangeId.BINANCE

    @property
    def is_simulated(self) -> bool:
        return self._simulated

    async def submit_order(
        self, order_intent: OrderIntent, client_order_id: str
    ) -> SubmitResult:
        self.submit_calls.append((order_intent, client_order_id))
        if self._error is not None:
            raise self._error
        assert self._result is not None
        return self._result

    async def cancel_order(self, order: Order):  # pragma: no cover - unused here
        raise NotImplementedError

    async def fetch_order(
        self, tenant_id: str, account_id: str, client_order_id: str
    ) -> Order | None:
        self.lookup_calls.append(client_order_id)
        return self._lookup

    async def fetch_open_orders(
        self, tenant_id: str, account_id: str, *, symbol: str | None = None
    ) -> tuple[Order, ...]:
        return self._open_orders

    async def exchange_time(self) -> int:
        return 1_700_000_000_000

    async def stream_fills(self, tenant_id: str, account_id: str):
        return
        yield  # pragma: no cover


class StubAccountAdapter:
    def __init__(self, balances: tuple[AccountBalance, ...] = ()) -> None:
        self._balances = balances

    @property
    def exchange(self) -> ExchangeId:
        return ExchangeId.BINANCE

    async def fetch_balances(self, tenant_id: str, account_id: str):
        return self._balances

    async def fetch_positions(self, tenant_id: str, account_id: str):
        return ()

    async def fetch_account(self, tenant_id: str, account_id: str) -> VenueAccount:
        return VenueAccount(
            exchange=ExchangeId.BINANCE,
            balances=self._balances,
            can_trade=True,
            can_withdraw=False,
            can_deposit=True,
            account_type="SPOT",
        )

    async def verify_credentials(self, tenant_id: str, account_id: str):
        return (True, "ok")


def build_engine(
    adapter: StubTradingAdapter,
    *,
    settings: ExecutionSettings | None = None,
    store: InMemoryOrderStore | None = None,
    incidents: InMemoryIncidentRecorder | None = None,
    positions: PositionManager | None = None,
) -> tuple[ExecutionEngine, InMemoryOrderStore, InMemoryIncidentRecorder]:
    order_store = store or InMemoryOrderStore()
    recorder = incidents or InMemoryIncidentRecorder()
    engine = ExecutionEngine(
        adapter=adapter,
        settings=settings or paper_settings(),
        risk_engine=risk_engine(),
        store=order_store,
        locks=InMemoryLockManager(),
        incidents=recorder,
        validator=OrderValidator(),
        positions=positions,
    )
    return (engine, order_store, recorder)


def accepted_result(**overrides: Any) -> SubmitResult:
    base: dict[str, Any] = {
        "accepted": True,
        "exchange_order_id": "28457",
        "status": OrderStatus.ACKNOWLEDGED,
        "is_simulated": False,
        "submitted_at_micros": 1_700_000_000_000_000,
        "fills": (),
    }
    base.update(overrides)
    return SubmitResult(**base)


# ======================================================================
# 1-7: signing, timestamps, skew, API key handling
# ======================================================================
class TestSigning:
    def test_01_signature_matches_the_published_vector(self) -> None:
        """The published worked example from Binance's own documentation."""
        assert binance_signature(DOC_SECRET, DOC_QUERY) == DOC_SIGNATURE

    def test_02_signature_is_deterministic_and_key_dependent(self) -> None:
        payload = "symbol=BTCUSDT&side=BUY&timestamp=1700000000000"
        first = binance_signature(FAKE_API_SECRET, payload)
        second = binance_signature(FAKE_API_SECRET, payload)
        assert first == second
        assert first != binance_signature(FAKE_API_SECRET + "x", payload)
        assert first != binance_signature(FAKE_API_SECRET, payload + "&x=1")
        # And it really is HMAC-SHA256 hex, not some other digest.
        assert first == hmac.new(
            FAKE_API_SECRET.encode(), payload.encode(), hashlib.sha256
        ).hexdigest()

    def test_03_timestamp_and_recv_window_are_appended_in_a_fixed_order(self) -> None:
        request = build_signed_request(
            method="POST",
            base_url="https://api.binance.com",
            path="/api/v3/order",
            params=[("symbol", "BTCUSDT"), ("side", "BUY")],
            credentials=credentials(),
            timestamp_millis=1_700_000_000_000,
            recv_window_millis=5_000,
        )
        assert request.signed_payload == (
            "symbol=BTCUSDT&side=BUY&recvWindow=5000&timestamp=1700000000000"
        )
        # The signature is last and is not itself signed.
        assert request.query.endswith(
            "&signature=" + binance_signature(FAKE_API_SECRET, request.signed_payload)
        )
        assert "signature" not in request.signed_payload

    def test_04_api_key_travels_in_the_header_and_never_in_the_payload(self) -> None:
        request = build_signed_request(
            method="GET",
            base_url="https://api.binance.com",
            path="/api/v3/account",
            params=[],
            credentials=credentials(),
            timestamp_millis=1_700_000_000_000,
        )
        assert request.headers["X-MBX-APIKEY"] == FAKE_API_KEY
        assert FAKE_API_KEY not in request.query
        assert FAKE_API_SECRET not in request.query
        # And the repr, which is what ends up in a traceback, exposes neither.
        assert FAKE_API_KEY not in repr(request)
        assert FAKE_API_SECRET not in repr(request)
        assert FAKE_API_SECRET not in json.dumps(request.to_log_fields())

    def test_05_signing_refuses_plaintext_and_bad_timestamps(self) -> None:
        with pytest.raises(SignatureError, match="non-TLS"):
            build_signed_request(
                method="GET",
                base_url="http://api.binance.com",
                path="/api/v3/account",
                params=[],
                credentials=credentials(),
                timestamp_millis=1_700_000_000_000,
            )
        with pytest.raises(SignatureError, match="positive millisecond"):
            build_signed_request(
                method="GET",
                base_url="https://api.binance.com",
                path="/api/v3/account",
                params=[],
                credentials=credentials(),
                timestamp_millis=0,
            )
        with pytest.raises(SignatureError, match="recvWindow"):
            build_signed_request(
                method="GET",
                base_url="https://api.binance.com",
                path="/api/v3/account",
                params=[],
                credentials=credentials(),
                timestamp_millis=1_700_000_000_000,
                recv_window_millis=61_000,
            )

    def test_06_encoding_rejects_floats_and_renders_decimals_exactly(self) -> None:
        assert format_decimal(Decimal("0.00001000")) == "0.00001"
        assert format_decimal(Decimal("1E-8")) == "0.00000001"
        assert format_decimal(Decimal("100")) == "100"
        assert format_decimal(Decimal("50000.00")) == "50000"
        with pytest.raises(SignatureError, match="float"):
            encode_params([("price", 0.1)])
        # Reserved characters are escaped identically on both sides.
        assert encode_params([("a", "b/c")]) == "a=b%2Fc"

    def test_07_clock_skew_beyond_the_limit_refuses_to_produce_a_timestamp(
        self,
    ) -> None:
        async def never_called() -> int:  # pragma: no cover - not reached
            raise AssertionError("The clock must not call the venue here.")

        clock = ExchangeClock(never_called, max_skew_millis=1_000)

        # Never synchronised: refuse rather than use the local clock.
        with pytest.raises(ClockNotSynchronised):
            clock.timestamp_millis()

        # Synchronised but the host clock is five seconds out: still refuse.
        clock.seed(offset_millis=5_000)
        with pytest.raises(ClockSkewExceeded) as excinfo:
            clock.timestamp_millis()
        assert excinfo.value.offset_millis == 5_000

        # Within tolerance: the offset is applied to the local clock.
        clock.reset()
        clock.seed(offset_millis=250)
        now_micros = 1_700_000_000_000_000
        assert (
            clock.timestamp_millis(now_micros=now_micros) == 1_700_000_000_000 + 250
        )


# ======================================================================
# 8-9: credential handling and redaction
# ======================================================================
class TestCredentialSecurity:
    def test_08_credentials_are_redacted_in_every_rendering_path(self) -> None:
        creds = credentials()
        rendered = [
            repr(creds),
            str(creds),
            f"{creds}",
            json.dumps(creds.to_log_fields()),
            repr([creds]),
            repr({"c": creds}),
        ]
        for text in rendered:
            assert FAKE_API_SECRET not in text, text
            assert FAKE_API_KEY not in text, text
        assert creds.api_key_last_four == FAKE_API_KEY[-4:]
        # The secret is still usable where it is legitimately needed.
        assert creds.matches_secret(FAKE_API_SECRET)
        # And free-text scrubbing catches a secret pasted into a message.
        assert FAKE_API_SECRET not in scrub_secret_like(
            f"failed with secret {FAKE_API_SECRET}"
        )

    def test_09_withdrawal_capable_credentials_are_refused(self) -> None:
        unsafe = credentials(permissions=frozenset({"SPOT", "WITHDRAW"}))
        with pytest.raises(Exception) as excinfo:
            unsafe.assert_safe()
        assert "withdraw" in str(excinfo.value).lower()
        assert FAKE_API_SECRET not in str(excinfo.value)

        gate = evaluate_safety_gates(
            ExecutionPreconditions(
                exchange="BINANCE",
                symbol="BTC/USDT",
                strategy_id="s1",
                kill_switches=no_kill_switches(),
                settings=paper_settings(paper_trading=False, trading_mode_setting="PAPER"),
                risk_health=ComponentHealth.ok(),
                market_data_health=ComponentHealth.ok(),
                exchange_health=ComponentHealth.ok(),
                credentials=unsafe,
                is_simulated=False,
            )
        )
        assert not gate.allowed


# ======================================================================
# 10-12: authenticated request generation and HTTP error handling
# ======================================================================
class TestAuthenticatedRequests:
    @staticmethod
    def _adapter(responses: list[HttpResponse]) -> tuple[BinanceTradingAdapter, list]:
        sent: list = []

        async def send(request, timeout_ms: int) -> HttpResponse:
            sent.append(request)
            return responses.pop(0)

        clock = ExchangeClock(lambda: asyncio.sleep(0, result=0))
        clock.seed(offset_millis=0)
        provider = StaticCredentialProvider([credentials()])
        adapter = BinanceTradingAdapter(
            send=send, credentials=provider, clock=clock, testnet=True
        )
        return (adapter, sent)

    def test_10_order_placement_builds_a_correctly_signed_request(self) -> None:
        body = json.dumps(
            {
                "symbol": "BTCUSDT",
                "orderId": 28457,
                "clientOrderId": "wlct-abc",
                "transactTime": 1_700_000_000_000,
                "price": "50000.00",
                "origQty": "0.01000000",
                "executedQty": "0.00000000",
                "cummulativeQuoteQty": "0.00000000",
                "status": "NEW",
                "timeInForce": "GTC",
                "type": "LIMIT",
                "side": "BUY",
                "fills": [],
            }
        )
        adapter, sent = self._adapter(
            [HttpResponse(status=200, headers={}, body=body)]
        )
        result = asyncio.run(adapter.submit_order(intent(), "wlct-abc"))

        assert result.accepted
        assert result.exchange_order_id == "28457"
        assert result.status is OrderStatus.ACKNOWLEDGED
        assert result.is_simulated is False

        request = sent[0]
        assert request.method == "POST"
        assert request.url.endswith("/api/v3/order")
        assert "symbol=BTCUSDT" in request.query
        assert "newClientOrderId=wlct-abc" in request.query
        assert "quantity=0.01" in request.query
        assert "timeInForce=GTC" in request.query
        assert "signature=" in request.query
        assert request.headers["X-MBX-APIKEY"] == FAKE_API_KEY

    def test_11_auth_and_rate_limit_statuses_map_to_the_right_failure_kind(
        self,
    ) -> None:
        # 401 and 403: definitive refusal, never ambiguous.
        for status in (401, 403):
            adapter, _ = self._adapter(
                [
                    HttpResponse(
                        status=status,
                        headers={},
                        body=json.dumps({"code": -2015, "msg": "Invalid API-key."}),
                    )
                ]
            )
            with pytest.raises(AdapterRejectedError) as excinfo:
                asyncio.run(adapter.submit_order(intent(), "wlct-a"))
            assert FAKE_API_SECRET not in str(excinfo.value)

        # 429: rate limited, with the venue's retry hint preserved.
        adapter, _ = self._adapter(
            [
                HttpResponse(
                    status=429,
                    headers={"Retry-After": "2"},
                    body=json.dumps({"code": -1003, "msg": "Too many requests."}),
                )
            ]
        )
        with pytest.raises(AdapterRateLimitedError) as rate_exc:
            asyncio.run(adapter.submit_order(intent(), "wlct-b"))
        assert rate_exc.value.retry_after_millis == 2_000

        # 418: an IP ban is still a rate-limit refusal, not a rejection.
        adapter, _ = self._adapter(
            [HttpResponse(status=418, headers={}, body=json.dumps({"code": -1003}))]
        )
        with pytest.raises(AdapterRateLimitedError):
            asyncio.run(adapter.submit_order(intent(), "wlct-c"))

    def test_12_a_5xx_is_ambiguous_and_a_4xx_is_definitive(self) -> None:
        adapter, _ = self._adapter(
            [HttpResponse(status=503, headers={}, body="Service Unavailable")]
        )
        with pytest.raises(AdapterConnectionError, match="UNKNOWN"):
            asyncio.run(adapter.submit_order(intent(), "wlct-d"))

        adapter, _ = self._adapter(
            [
                HttpResponse(
                    status=400,
                    headers={},
                    body=json.dumps({"code": -1013, "msg": "Filter failure: LOT_SIZE"}),
                )
            ]
        )
        with pytest.raises(AdapterRejectedError) as excinfo:
            asyncio.run(adapter.submit_order(intent(), "wlct-e"))
        assert excinfo.value.code == "-1013"

    def test_13_signed_requests_are_refused_against_the_public_mirror(self) -> None:
        clock = ExchangeClock(lambda: asyncio.sleep(0, result=0))

        async def send(request, timeout_ms: int):  # pragma: no cover - unreachable
            raise AssertionError("Nothing should be sent.")

        with pytest.raises(ValueError, match="market-data mirror"):
            BinanceTradingAdapter(
                send=send,
                credentials=StaticCredentialProvider([credentials()]),
                clock=clock,
                rest_base="https://data-api.binance.vision",
            )


# ======================================================================
# 14-15: order validation
# ======================================================================
class TestValidation:
    def test_14_validation_catches_every_class_of_bad_order(self) -> None:
        validator = OrderValidator()
        specification = spec()

        # Quantity below the venue minimum and notional below the floor.
        result = validator.validate(
            intent(quantity=Decimal("0.000001"), price=Decimal("50000")),
            specification=specification,
            reference_price=Decimal("50000"),
        )
        assert not result.valid
        codes = {issue.code for issue in result.issues}
        assert ValidationCode.LOT_SIZE_VIOLATION in codes

        # Price off the tick grid.
        result = validator.validate(
            intent(price=Decimal("50000.005")),
            specification=specification,
            reference_price=Decimal("50000"),
        )
        assert ValidationCode.TICK_SIZE_VIOLATION in {i.code for i in result.issues}

        # A limit order with no price.
        result = validator.validate(
            intent(price=None), specification=specification
        )
        assert ValidationCode.PRICE_REQUIRED in {i.code for i in result.issues}

        # Unknown symbol: refuse rather than guess the venue's rules.
        result = validator.validate(intent(), specification=None)
        assert ValidationCode.UNKNOWN_SYMBOL in {i.code for i in result.issues}

        # A halted symbol.
        result = validator.validate(
            intent(), specification=spec(is_tradeable=False)
        )
        assert ValidationCode.SYMBOL_NOT_TRADEABLE in {i.code for i in result.issues}

        # A valid order passes cleanly.
        assert validator.validate(
            intent(), specification=specification, reference_price=Decimal("50000")
        ).valid

    def test_15_the_fat_finger_price_band_catches_a_decimal_error(self) -> None:
        validator = OrderValidator(price_band_percent=Decimal("20"))
        # A misplaced decimal point: 5 000 instead of 50 000.
        result = validator.validate(
            intent(price=Decimal("5000.00")),
            specification=spec(),
            reference_price=Decimal("50000.00"),
        )
        assert not result.valid
        assert ValidationCode.PRICE_BAND_VIOLATION in {i.code for i in result.issues}

        # A deliberately passive order inside the band is fine.
        assert validator.validate(
            intent(price=Decimal("45000.00")),
            specification=spec(),
            reference_price=Decimal("50000.00"),
        ).valid


# ======================================================================
# 16-18: safety gates and live-trading defaults
# ======================================================================
class TestSafetyGates:
    def test_16_every_kill_switch_scope_blocks_submission(self) -> None:
        cases = [
            KillSwitchState(True, frozenset(), frozenset(), frozenset(), "halt"),
            KillSwitchState(
                False, frozenset({"BINANCE"}), frozenset(), frozenset(), None
            ),
            KillSwitchState(
                False, frozenset(), frozenset({"strategy-1"}), frozenset(), None
            ),
            KillSwitchState(
                False, frozenset(), frozenset(), frozenset({"BTC/USDT"}), None
            ),
        ]
        for switches in cases:
            decision = evaluate_safety_gates(
                ExecutionPreconditions(
                    exchange="BINANCE",
                    symbol="BTC/USDT",
                    strategy_id="strategy-1",
                    kill_switches=switches,
                    settings=paper_settings(),
                    risk_health=ComponentHealth.ok(),
                    market_data_health=ComponentHealth.ok(),
                    exchange_health=ComponentHealth.ok(),
                    is_simulated=True,
                )
            )
            assert not decision.allowed
            assert "KILL_SWITCH" in decision.blocking_gate.value

    def test_17_unhealthy_or_unknown_dependencies_fail_closed(self) -> None:
        # A default ComponentHealth means "unknown", and unknown blocks.
        decision = evaluate_safety_gates(
            ExecutionPreconditions(
                exchange="BINANCE",
                symbol="BTC/USDT",
                strategy_id=None,
                kill_switches=no_kill_switches(),
                settings=paper_settings(),
                is_simulated=True,
            )
        )
        assert not decision.allowed
        failed = {result.gate.value for result in decision.failures}
        assert "RISK_ENGINE_HEALTHY" in failed
        assert "MARKET_DATA_HEALTHY" in failed

        # Stale risk state counts as unavailable.
        decision = evaluate_safety_gates(
            ExecutionPreconditions(
                exchange="BINANCE",
                symbol="BTC/USDT",
                strategy_id=None,
                kill_switches=no_kill_switches(),
                settings=paper_settings(),
                risk_health=ComponentHealth.ok(age_micros=60_000_000),
                market_data_health=ComponentHealth.ok(),
                exchange_health=ComponentHealth.ok(),
                is_simulated=True,
            )
        )
        assert not decision.allowed

    def test_18_live_trading_is_off_by_default_and_contradictions_are_rejected(
        self,
    ) -> None:
        # An empty environment must never yield a transmitting configuration.
        default = ExecutionSettings.from_env({})
        assert default.live_trading_enabled is False
        assert default.dry_run is True
        assert default.paper_trading is True
        assert default.will_transmit_orders is False
        assert default.trading_mode is TradingMode.DISABLED

        # A garbled boolean is an error, never a silent False.
        with pytest.raises(Exception, match="boolean"):
            ExecutionSettings.from_env({"LIVE_TRADING_ENABLED": "ture"})

        # LIVE + DRY_RUN is a contradiction and is refused, not resolved.
        with pytest.raises(UnsafeExecutionConfiguration, match="contradict"):
            ExecutionSettings(
                live_trading_enabled=True,
                dry_run=True,
                paper_trading=False,
                trading_mode_setting="LIVE",
                trading_enabled=True,
                live_trading_confirmed=True,
            )

        # LIVE without the corroborating flags is refused too.
        with pytest.raises(UnsafeExecutionConfiguration, match="TRADING_MODE=LIVE"):
            ExecutionSettings(
                live_trading_enabled=True,
                dry_run=False,
                paper_trading=False,
                trading_mode_setting="PAPER",
                trading_enabled=True,
                live_trading_confirmed=True,
            )

        # And the only combination that transmits requires all five.
        live = ExecutionSettings(
            live_trading_enabled=True,
            dry_run=False,
            paper_trading=False,
            trading_mode_setting="LIVE",
            trading_enabled=True,
            live_trading_confirmed=True,
        )
        assert live.will_transmit_orders is True


# ======================================================================
# 19-24: the engine pipeline
# ======================================================================
class TestExecutionEngine:
    def test_19_a_clean_order_is_submitted_and_recorded(self) -> None:
        adapter = StubTradingAdapter(result=accepted_result())
        engine, store, _ = build_engine(adapter)
        result = asyncio.run(engine.submit(intent(), healthy_context()))

        assert result.outcome is ExecutionOutcome.ACCEPTED
        assert result.order is not None
        assert result.order.status is OrderStatus.ACKNOWLEDGED
        assert result.order.exchange_order_id == "28457"
        assert len(adapter.submit_calls) == 1
        # The deterministic client order id reached the venue.
        assert adapter.submit_calls[0][1] == result.client_order_id
        assert result.client_order_id.startswith("wlct-")
        stored = asyncio.run(
            store.get_by_client_order_id("tenant-1", result.client_order_id)
        )
        assert stored is not None

    def test_20_duplicate_submission_is_prevented_and_nothing_is_sent(self) -> None:
        adapter = StubTradingAdapter(result=accepted_result())
        engine, store, _ = build_engine(adapter)
        first = asyncio.run(engine.submit(intent(), healthy_context()))
        second = asyncio.run(engine.submit(intent(), healthy_context()))

        assert first.outcome is ExecutionOutcome.ACCEPTED
        assert second.outcome is ExecutionOutcome.DUPLICATE
        assert second.error_code is ExecutionErrorCode.DUPLICATE_ORDER
        # The venue was contacted exactly once.
        assert len(adapter.submit_calls) == 1
        assert store.order_count() == 1

    def test_21_an_ambiguous_result_is_never_resubmitted(self) -> None:
        adapter = StubTradingAdapter(
            error=AdapterConnectionError("connection reset")
        )
        engine, store, incidents = build_engine(adapter)
        result = asyncio.run(engine.submit(intent(), healthy_context()))

        assert result.outcome is ExecutionOutcome.UNKNOWN
        assert result.error_code is ExecutionErrorCode.RESULT_UNKNOWN
        assert result.requires_reconciliation
        assert result.transmitted is True
        # Exactly one attempt: no retry, ever.
        assert len(adapter.submit_calls) == 1
        # The order is flagged, and its status is the honest SUBMITTED.
        assert result.order is not None
        assert result.order.status is OrderStatus.SUBMITTED
        state = asyncio.run(
            store.get_reconciliation_state("tenant-1", result.order.order_id)
        )
        assert state is ReconciliationState.UNKNOWN
        assert state.blocks_further_submission
        # A critical incident exists.
        raised = incidents.of_type(IncidentType.UNKNOWN_ORDER_RESULT)
        assert len(raised) == 1
        assert raised[0].requires_paging

    def test_22_dry_run_builds_everything_and_transmits_nothing(self) -> None:
        adapter = StubTradingAdapter(result=accepted_result())
        engine, _store, _ = build_engine(
            adapter,
            settings=ExecutionSettings(
                live_trading_enabled=False,
                dry_run=True,
                paper_trading=False,
                trading_mode_setting="PAPER",
                trading_enabled=True,
            ),
        )
        result = asyncio.run(engine.submit(intent(), healthy_context()))

        assert result.outcome is ExecutionOutcome.DRY_RUN
        assert result.transmitted is False
        assert adapter.submit_calls == []
        # It must never be reported as submitted.
        assert result.order is not None
        assert result.order.status is not OrderStatus.SUBMITTED
        assert "NOT" in result.message

    def test_23_risk_failure_blocks_the_order_and_fails_closed(self) -> None:
        adapter = StubTradingAdapter(result=accepted_result())
        engine, _store, _ = build_engine(adapter)

        # An incomplete risk snapshot must block.
        result = asyncio.run(
            engine.submit(
                intent(), healthy_context(snapshot=snapshot(is_complete=False))
            )
        )
        assert result.outcome is ExecutionOutcome.REJECTED_LOCALLY
        assert result.error_code in (
            ExecutionErrorCode.RISK_UNAVAILABLE,
            ExecutionErrorCode.RISK_REJECTED,
        )
        assert adapter.submit_calls == []

        # A risk engine that raises must also block, not bypass.
        class ExplodingRisk:
            def evaluate(self, *args: Any, **kwargs: Any):
                raise RuntimeError("risk store unreachable")

        exploding = ExecutionEngine(
            adapter=adapter,
            settings=paper_settings(),
            risk_engine=ExplodingRisk(),  # type: ignore[arg-type]
            store=InMemoryOrderStore(),
            locks=InMemoryLockManager(),
            incidents=InMemoryIncidentRecorder(),
        )
        result = asyncio.run(exploding.submit(intent(), healthy_context()))
        assert result.error_code is ExecutionErrorCode.RISK_UNAVAILABLE
        assert adapter.submit_calls == []

    def test_24_paper_trading_cannot_reach_a_real_endpoint(self) -> None:
        """A simulated adapter is structurally incapable of transmitting.

        And the reverse is also enforced: a live configuration refuses to start
        against a simulator, so a paper adapter can never be presented as live.
        """
        from wlct_trading.adapters.paper import PaperTradingAdapter

        paper = PaperTradingAdapter(lambda exchange, symbol: None)
        assert paper.is_simulated is True

        engine, _store, _ = build_engine(paper)  # type: ignore[arg-type]
        result = asyncio.run(engine.submit(intent(), healthy_context()))
        # No book, so no invented fill — and nothing left the process.
        assert result.transmitted is False
        assert result.is_simulated is True

        with pytest.raises(EngineConfigurationError, match="simulator"):
            ExecutionEngine(
                adapter=paper,  # type: ignore[arg-type]
                settings=ExecutionSettings(
                    live_trading_enabled=True,
                    dry_run=False,
                    paper_trading=False,
                    trading_mode_setting="LIVE",
                    trading_enabled=True,
                    live_trading_confirmed=True,
                ),
                risk_engine=risk_engine(),
                store=InMemoryOrderStore(),
                locks=InMemoryLockManager(),
                incidents=InMemoryIncidentRecorder(),
            )


# ======================================================================
# 25-26: state transitions and fills
# ======================================================================
class TestStateAndFills:
    def test_25_illegal_transitions_are_refused_and_recorded(self) -> None:
        order = Order.from_intent(intent(), client_order_id="wlct-x")
        order.transition_to(OrderStatus.SUBMITTED, reason="sent")
        order.transition_to(OrderStatus.ACKNOWLEDGED, reason="ack")
        order.transition_to(OrderStatus.FILLED, reason="done")
        assert order.is_terminal

        # A terminal order cannot go back to open.
        from wlct_trading.orders import InvalidOrderTransition

        with pytest.raises(InvalidOrderTransition):
            order.transition_to(OrderStatus.PARTIALLY_FILLED, reason="impossible")
        assert order.try_transition_to(OrderStatus.CANCELLED, reason="no") is None
        # State is unchanged: history was not rewritten.
        assert order.status is OrderStatus.FILLED

    def test_26_fills_normalise_deduplicate_and_move_the_position(self) -> None:
        positions = PositionManager()
        adapter = StubTradingAdapter(
            result=accepted_result(
                status=OrderStatus.FILLED,
                fills=(
                    Fill(
                        fill_id="28457:1",
                        order_id="ignored",
                        trade_id="1",
                        price=Decimal("50000.00"),
                        quantity=Decimal("0.01"),
                        fee=Decimal("0.5"),
                        fee_currency="USDT",
                        is_maker=False,
                        is_simulated=False,
                        exchange_timestamp=1_700_000_000_000_000,
                        symbol="BTC/USDT",
                        side=OrderSide.BUY,
                        exchange=ExchangeId.BINANCE,
                        quote_quantity=Decimal("500.00"),
                        exchange_order_id="28457",
                    ),
                ),
            )
        )
        engine, store, _ = build_engine(adapter, positions=positions)
        result = asyncio.run(engine.submit(intent(), healthy_context()))

        assert result.outcome is ExecutionOutcome.ACCEPTED
        assert len(result.fills) == 1
        assert result.order is not None
        assert result.order.filled_quantity == Decimal("0.01")
        assert result.order.average_fill_price == Decimal("50000.00")

        position = positions.get("account-1", ExchangeId.BINANCE, "BTC/USDT")
        assert position is not None
        assert position.quantity == Decimal("0.01")

        # The same fill arriving again by another route changes nothing.
        applied, _update = asyncio.run(
            engine.apply_external_fill(result.order, result.fills[0])
        )
        assert applied is False
        assert result.order.filled_quantity == Decimal("0.01")
        assert positions.get(
            "account-1", ExchangeId.BINANCE, "BTC/USDT"
        ).quantity == Decimal("0.01")


# ======================================================================
# 27-28: reconciliation
# ======================================================================
class TestReconciliation:
    def test_27_an_unknown_order_is_resolved_by_querying_the_venue(self) -> None:
        # First: the order exists at the venue and was filled while we were blind.
        local = Order.from_intent(intent(), client_order_id="wlct-unknown")
        local.transition_to(OrderStatus.SUBMITTED, reason="sent")

        venue_view = Order.from_intent(intent(), client_order_id="wlct-unknown")
        venue_view.transition_to(OrderStatus.SUBMITTED, reason="v")
        venue_view.transition_to(OrderStatus.ACKNOWLEDGED, reason="v")
        venue_view.apply_fill(
            Fill(
                fill_id="99:7",
                order_id=venue_view.order_id,
                trade_id="7",
                price=Decimal("50000.00"),
                quantity=Decimal("0.01"),
                fee=Decimal("0.5"),
                fee_currency="USDT",
                is_maker=True,
                is_simulated=False,
                exchange_timestamp=1_700_000_000_000_000,
                symbol="BTC/USDT",
                side=OrderSide.BUY,
                exchange=ExchangeId.BINANCE,
            )
        )

        store = InMemoryOrderStore()
        asyncio.run(store.save_order(local))
        asyncio.run(
            store.set_reconciliation_state(
                "tenant-1", local.order_id, ReconciliationState.UNKNOWN
            )
        )
        service = ReconciliationService(
            trading=StubTradingAdapter(lookup=venue_view),  # type: ignore[arg-type]
            account=StubAccountAdapter(),  # type: ignore[arg-type]
            store=store,
            incidents=InMemoryIncidentRecorder(),
            locks=InMemoryLockManager(),
            positions=PositionManager(),
        )
        resolved, discrepancy = asyncio.run(service.resolve_unknown_order(local))
        assert discrepancy is not None
        assert resolved.filled_quantity == Decimal("0.01")
        assert (
            asyncio.run(store.get_reconciliation_state("tenant-1", local.order_id))
            is ReconciliationState.IN_SYNC
        )

        # Second: the venue has never heard of it, so it was never placed.
        orphan = Order.from_intent(
            intent(quantity=Decimal("0.02")), client_order_id="wlct-orphan"
        )
        orphan.transition_to(OrderStatus.SUBMITTED, reason="sent")
        store2 = InMemoryOrderStore()
        asyncio.run(store2.save_order(orphan))
        service2 = ReconciliationService(
            trading=StubTradingAdapter(lookup=None),  # type: ignore[arg-type]
            account=StubAccountAdapter(),  # type: ignore[arg-type]
            store=store2,
            incidents=InMemoryIncidentRecorder(),
            locks=InMemoryLockManager(),
        )
        resolved2, discrepancy2 = asyncio.run(service2.resolve_unknown_order(orphan))
        assert resolved2.status is OrderStatus.FAILED
        assert discrepancy2 is not None
        assert discrepancy2.repaired is True

    def test_28_an_order_we_did_not_place_is_never_adopted(self) -> None:
        foreign = Order.from_intent(
            intent(quantity=Decimal("5")), client_order_id="someone-elses-order"
        )
        foreign.transition_to(OrderStatus.SUBMITTED, reason="v")
        foreign.transition_to(OrderStatus.ACKNOWLEDGED, reason="v")

        store = InMemoryOrderStore()
        incidents = InMemoryIncidentRecorder()
        service = ReconciliationService(
            trading=StubTradingAdapter(open_orders=(foreign,)),  # type: ignore[arg-type]
            account=StubAccountAdapter(),  # type: ignore[arg-type]
            store=store,
            incidents=incidents,
            locks=InMemoryLockManager(),
        )
        report = asyncio.run(
            service.reconcile_account("tenant-1", "account-1", check_positions=False)
        )
        assert report.succeeded
        types = {item.discrepancy_type.value for item in report.discrepancies}
        assert "ORDER_MISSING_LOCALLY" in types
        # Not adopted: the local store is still empty.
        assert store.order_count() == 0
        # And it escalated.
        assert incidents.of_type(IncidentType.UNEXPECTED_ORDER)


# ======================================================================
# 29-30: the private user-data stream
# ======================================================================
class TestPrivateStream:
    def test_29_every_private_stream_event_type_parses(self) -> None:
        report = parse_user_stream_message(
            json.dumps(
                {
                    "e": "executionReport",
                    "E": 1_700_000_000_000,
                    "s": "BTCUSDT",
                    "c": "wlct-abc",
                    "S": "BUY",
                    "o": "LIMIT",
                    "f": "GTC",
                    "q": "0.01000000",
                    "p": "50000.00000000",
                    "X": "PARTIALLY_FILLED",
                    "x": "TRADE",
                    "i": 28457,
                    "l": "0.00500000",
                    "z": "0.00500000",
                    "L": "50000.00000000",
                    "n": "0.25000000",
                    "N": "USDT",
                    "T": 1_700_000_000_100,
                    "t": 12345,
                    "m": True,
                    "Z": "250.00000000",
                    "r": "NONE",
                }
            )
        )
        assert report.event_type is UserStreamEventType.EXECUTION_REPORT
        execution = report.execution
        assert execution is not None
        assert execution.is_trade
        assert execution.status is OrderStatus.PARTIALLY_FILLED
        assert execution.last_filled_quantity == Decimal("0.00500000")
        assert isinstance(execution.last_filled_price, Decimal)

        fill = execution.to_fill(order_id="order-1", symbol="BTC/USDT")
        assert fill.fill_id == "28457:12345"
        assert fill.is_simulated is False
        assert fill.side is OrderSide.BUY
        assert fill.fee == Decimal("0.25000000")

        # A non-trade report must never become a fill.
        cancelled = parse_user_stream_message(
            json.dumps(
                {
                    "e": "executionReport",
                    "E": 1_700_000_000_000,
                    "s": "BTCUSDT",
                    "c": "cancel-request-id",
                    "C": "wlct-abc",
                    "S": "BUY",
                    "X": "CANCELED",
                    "x": "CANCELED",
                    "i": 28457,
                    "q": "0.01",
                    "z": "0",
                    "l": "0",
                    "L": "0",
                    "Z": "0",
                    "n": "0",
                    "T": 1_700_000_000_100,
                    "t": -1,
                    "m": False,
                }
            )
        )
        assert cancelled.execution is not None
        assert cancelled.execution.is_trade is False
        # The cancelled order is identified by origClientOrderId, not clientOrderId.
        assert cancelled.execution.effective_client_order_id == "wlct-abc"
        with pytest.raises(ValueError, match="fabricate"):
            cancelled.execution.to_fill(order_id="order-1", symbol="BTC/USDT")

        balances = parse_user_stream_message(
            json.dumps(
                {
                    "e": "outboundAccountPosition",
                    "E": 1_700_000_000_000,
                    "u": 1_700_000_000_000,
                    "B": [
                        {"a": "USDT", "f": "1000.00", "l": "250.00"},
                        {"a": "BTC", "f": "0.50", "l": "0.00"},
                    ],
                }
            )
        )
        assert balances.balances is not None
        assert len(balances.balances.balances) == 2
        usdt = balances.balances.balances[0]
        assert usdt.free == Decimal("1000.00")
        assert usdt.locked == Decimal("250.00")
        assert usdt.total == Decimal("1250.00")

        delta = parse_user_stream_message(
            json.dumps(
                {
                    "e": "balanceUpdate",
                    "E": 1_700_000_000_000,
                    "a": "BTC",
                    "d": "-0.05000000",
                    "T": 1_700_000_000_000,
                }
            )
        )
        assert delta.balance_delta is not None
        assert delta.balance_delta.delta == Decimal("-0.05000000")

        expired = parse_user_stream_message(
            json.dumps({"e": "listenKeyExpired", "E": 1_700_000_000_000})
        )
        assert expired.event_type is UserStreamEventType.LISTEN_KEY_EXPIRED

        # An unmodelled event is surfaced, not silently dropped.
        unknown = parse_user_stream_message(json.dumps({"e": "somethingNew"}))
        assert unknown.event_type is UserStreamEventType.UNKNOWN
        assert unknown.raw_event_name == "somethingNew"

    def test_30_the_listen_key_is_managed_and_never_exposed(self) -> None:
        secret_key = "pqia91ma19a5s61cv6a81va65sdf19v8a65a1a5s61cv6a81va65sdf19v8a65a1"
        created: list[str] = []
        renewed: list[str] = []
        closed: list[str] = []

        async def create() -> str:
            created.append(secret_key)
            return secret_key

        async def keepalive(key: str) -> None:
            renewed.append(key)

        async def close(key: str) -> None:
            closed.append(key)

        manager = ListenKeyManager(
            create=create,
            keepalive=keepalive,
            close=close,
            testnet=True,
            refresh_interval_millis=1_800_000,
        )

        url = asyncio.run(manager.acquire())
        assert url.startswith("wss://")
        assert secret_key in url  # the URL legitimately carries it
        # But nothing else does.
        assert secret_key not in manager.masked_key
        assert secret_key not in json.dumps(manager.status())
        assert secret_key not in mask_listen_key(secret_key)
        assert manager.has_key

        assert asyncio.run(manager.renew()) is True
        assert renewed == [secret_key]
        assert manager.renewal_count == 1

        # An expiry event discards the key without contacting the venue.
        manager.invalidate()
        assert manager.has_key is False
        assert closed == []

        # A plaintext socket is refused: the URL contains the key.
        with pytest.raises(ValueError, match="wss"):
            ListenKeyManager(
                create=create,
                keepalive=keepalive,
                close=close,
                ws_base="ws://stream.binance.com:9443",
            )
```

---

## FILE: libs/trading-core/tests/test_orders.py

Changed by the sweep: ruff F401: unused imports removed.

```py
"""OMS: state machine, fill accounting and duplicate protection."""

from __future__ import annotations

from decimal import Decimal

import pytest

from wlct_trading.enums import OrderSide, OrderStatus, OrderType, TimeInForce
from wlct_trading.idempotency import DuplicateOrderGuard, build_client_order_id
from wlct_trading.orders import (
    ORDER_STATE_TRANSITIONS,
    InvalidOrderTransition,
    Order,
    is_legal_transition,
)

from tests.conftest import EXCHANGE, SYMBOL, make_fill


def make_order(quantity: str = "10.0", side: OrderSide = OrderSide.BUY) -> Order:
    return Order(
        order_id="order-1",
        client_order_id="wlct-testclientorderid00000001",
        tenant_id="tenant-1",
        account_id="account-1",
        strategy_id="strategy-1",
        exchange=EXCHANGE,
        symbol=SYMBOL,
        side=side,
        order_type=OrderType.LIMIT,
        quantity=Decimal(quantity),
        price=Decimal("30000.00"),
        time_in_force=TimeInForce.GTC,
    )


class TestOrderStateTransitions:
    def test_new_order_starts_pending(self) -> None:
        assert make_order().status is OrderStatus.PENDING

    def test_happy_path_lifecycle(self) -> None:
        order = make_order()

        order.transition_to(OrderStatus.SUBMITTED)
        assert order.submitted_at is not None
        order.transition_to(OrderStatus.ACKNOWLEDGED, exchange_order_id="X-1")
        assert order.exchange_order_id == "X-1"
        order.transition_to(OrderStatus.PARTIALLY_FILLED)
        order.transition_to(OrderStatus.FILLED)

        assert order.status is OrderStatus.FILLED
        assert order.is_terminal is True
        assert order.terminal_at is not None
        assert [e.status for e in order.events] == [
            OrderStatus.SUBMITTED,
            OrderStatus.ACKNOWLEDGED,
            OrderStatus.PARTIALLY_FILLED,
            OrderStatus.FILLED,
        ]

    def test_cancel_path(self) -> None:
        order = make_order()
        order.transition_to(OrderStatus.SUBMITTED)
        order.transition_to(OrderStatus.ACKNOWLEDGED)
        order.transition_to(OrderStatus.CANCEL_REQUESTED)
        order.transition_to(OrderStatus.CANCELLED)

        assert order.status is OrderStatus.CANCELLED
        assert order.is_terminal is True

    def test_cancel_can_lose_race_to_a_fill(self) -> None:
        """The order completed before the cancel reached the venue."""
        order = make_order()
        order.transition_to(OrderStatus.SUBMITTED)
        order.transition_to(OrderStatus.ACKNOWLEDGED)
        order.transition_to(OrderStatus.CANCEL_REQUESTED)

        order.transition_to(OrderStatus.FILLED)

        assert order.status is OrderStatus.FILLED

    def test_terminal_states_are_final(self) -> None:
        for terminal in (
            OrderStatus.FILLED,
            OrderStatus.CANCELLED,
            OrderStatus.REJECTED,
            OrderStatus.EXPIRED,
            OrderStatus.FAILED,
        ):
            assert ORDER_STATE_TRANSITIONS[terminal] == frozenset()

    def test_illegal_transition_raises(self) -> None:
        order = make_order()
        order.transition_to(OrderStatus.SUBMITTED)
        order.transition_to(OrderStatus.FILLED)

        with pytest.raises(InvalidOrderTransition) as excinfo:
            order.transition_to(OrderStatus.ACKNOWLEDGED)

        assert excinfo.value.current is OrderStatus.FILLED
        assert excinfo.value.target is OrderStatus.ACKNOWLEDGED

    def test_illegal_transition_does_not_mutate_state(self) -> None:
        order = make_order()
        order.transition_to(OrderStatus.SUBMITTED)
        order.transition_to(OrderStatus.FILLED)
        event_count = len(order.events)

        with pytest.raises(InvalidOrderTransition):
            order.transition_to(OrderStatus.PENDING)

        assert order.status is OrderStatus.FILLED
        assert len(order.events) == event_count

    def test_try_transition_returns_none_instead_of_raising(self) -> None:
        """Redelivered venue messages are dropped, not escalated."""
        order = make_order()
        order.transition_to(OrderStatus.SUBMITTED)
        order.transition_to(OrderStatus.FILLED)

        assert order.try_transition_to(OrderStatus.ACKNOWLEDGED) is None
        assert order.status is OrderStatus.FILLED

    def test_cannot_skip_backwards_to_pending(self) -> None:
        order = make_order()
        order.transition_to(OrderStatus.SUBMITTED)

        assert is_legal_transition(OrderStatus.SUBMITTED, OrderStatus.PENDING) is False

    def test_rejection_records_reason(self) -> None:
        order = make_order()
        order.transition_to(OrderStatus.SUBMITTED)
        order.transition_to(OrderStatus.REJECTED, reason="MIN_NOTIONAL not met")

        assert order.rejection_reason == "MIN_NOTIONAL not met"
        assert order.is_terminal is True

    def test_partially_filled_may_repeat(self) -> None:
        """Successive partial fills stay in the same state legally."""
        assert (
            is_legal_transition(
                OrderStatus.PARTIALLY_FILLED, OrderStatus.PARTIALLY_FILLED
            )
            is True
        )

    def test_open_and_terminal_are_disjoint(self) -> None:
        order = make_order()
        assert order.is_open is True
        assert order.is_terminal is False


class TestFillAccounting:
    def test_single_full_fill(self) -> None:
        order = make_order("10.0")
        order.transition_to(OrderStatus.SUBMITTED)

        applied = order.apply_fill(
            make_fill(price="30000.00", quantity="10.0", fee="3.0")
        )

        assert applied is True
        assert order.filled_quantity == Decimal("10.0")
        assert order.average_fill_price == Decimal("30000.00")
        assert order.remaining_quantity == Decimal(0)
        assert order.status is OrderStatus.FILLED
        assert order.cumulative_fee == Decimal("3.0")

    def test_partial_fill_leaves_order_open(self) -> None:
        order = make_order("10.0")
        order.transition_to(OrderStatus.SUBMITTED)

        order.apply_fill(make_fill(price="30000.00", quantity="4.0"))

        assert order.status is OrderStatus.PARTIALLY_FILLED
        assert order.filled_quantity == Decimal("4.0")
        assert order.remaining_quantity == Decimal("6.0")
        assert order.is_open is True

    def test_average_price_is_quantity_weighted(self) -> None:
        order = make_order("10.0")
        order.transition_to(OrderStatus.SUBMITTED)

        order.apply_fill(make_fill(fill_id="f1", price="30000.00", quantity="2.0"))
        order.apply_fill(make_fill(fill_id="f2", price="31000.00", quantity="8.0"))

        # (30000*2 + 31000*8) / 10 = 30800
        assert order.average_fill_price == Decimal("30800")
        assert order.status is OrderStatus.FILLED

    def test_duplicate_fill_is_rejected(self) -> None:
        """A replayed user-data message must not double-count."""
        order = make_order("10.0")
        order.transition_to(OrderStatus.SUBMITTED)

        first = order.apply_fill(make_fill(fill_id="f1", price="30000.00", quantity="4.0"))
        second = order.apply_fill(make_fill(fill_id="f1", price="30000.00", quantity="4.0"))

        assert first is True
        assert second is False
        assert order.filled_quantity == Decimal("4.0")
        assert len(order.fills) == 1

    def test_fill_for_another_order_raises(self) -> None:
        order = make_order()
        with pytest.raises(ValueError):
            order.apply_fill(
                make_fill(order_id="other-order", price="30000.00", quantity="1.0")
            )

    def test_zero_quantity_fill_raises(self) -> None:
        order = make_order()
        with pytest.raises(ValueError):
            order.apply_fill(make_fill(price="30000.00", quantity="0"))

    def test_simulated_fill_marks_the_order(self) -> None:
        order = make_order("1.0")
        order.transition_to(OrderStatus.SUBMITTED)

        order.apply_fill(make_fill(price="30000.00", quantity="1.0", simulated=True))

        assert order.is_simulated is True

    def test_unfilled_order_reports_no_average_price(self) -> None:
        order = make_order()
        assert order.average_fill_price is None
        assert order.filled_notional == Decimal(0)


class TestDuplicateOrderProtection:
    def test_identical_intents_share_a_client_order_id(self, make_intent) -> None:
        assert build_client_order_id(make_intent()) == build_client_order_id(make_intent())

    def test_differing_quantity_changes_the_id(self, make_intent) -> None:
        a = build_client_order_id(make_intent(quantity="1.0"))
        b = build_client_order_id(make_intent(quantity="2.0"))
        assert a != b

    def test_differing_side_changes_the_id(self, make_intent) -> None:
        a = build_client_order_id(make_intent(side=OrderSide.BUY))
        b = build_client_order_id(make_intent(side=OrderSide.SELL))
        assert a != b

    def test_client_order_id_is_venue_safe(self, make_intent) -> None:
        coid = build_client_order_id(make_intent())
        assert len(coid) <= 36
        assert coid.replace("-", "").replace("_", "").isalnum()

    def test_guard_blocks_the_second_registration(self, make_intent) -> None:
        guard = DuplicateOrderGuard()
        coid = build_client_order_id(make_intent())

        assert guard.register(coid) is True
        assert guard.register(coid) is False
        assert guard.has_seen(coid) is True

    def test_released_id_can_be_registered_again(self, make_intent) -> None:
        guard = DuplicateOrderGuard()
        coid = build_client_order_id(make_intent())
        guard.register(coid)

        guard.release(coid)

        assert guard.register(coid) is True
```

---

## FILE: libs/trading-core/tests/test_pipeline.py

Changed by the sweep: ruff F401: unused imports removed.

```py
"""End-to-end pipeline: market data -> signal -> risk -> execution -> position.

These tests wire the real components together with no mocks between them. They
are the ones that would catch an integration regression that every unit test
still passes through.
"""

from __future__ import annotations

import asyncio
from dataclasses import replace
from decimal import Decimal

import pytest

from wlct_trading.adapters.paper import PaperTradingAdapter
from wlct_trading.enums import (
    OrderSide,
    OrderStatus,
    OrderType,
    SignalAction,
    TradingEventType,
    TradingMode,
)
from wlct_trading.events import InMemoryEventBus, TradingEvent
from wlct_trading.idempotency import build_client_order_id
from wlct_trading.order_book import OrderBook
from wlct_trading.orders import Order
from wlct_trading.positions import PositionManager
from wlct_trading.risk import KillSwitchState, RiskEngine, RiskLimits
from wlct_trading.signals import Signal, signal_to_intent

from tests.conftest import EXCHANGE, SYMBOL, make_delta, level


@pytest.fixture()
def live_book(snapshot) -> OrderBook:
    book = OrderBook(exchange=EXCHANGE, symbol=SYMBOL)
    book.apply_snapshot(snapshot)
    return book


def run(coro):
    return asyncio.run(coro)


class TestPaperExecutionPipeline:
    def test_marketable_buy_fills_at_the_real_ask(self, live_book) -> None:
        adapter = PaperTradingAdapter(lambda ex, sym: live_book.top())
        signal = Signal(
            signal_id="signal-1",
            tenant_id="tenant-1",
            strategy_id="strategy-1",
            exchange=EXCHANGE,
            symbol=SYMBOL,
            action=SignalAction.BUY,
            confidence=Decimal("0.9"),
            reference_price=live_book.mid_price,
            target_quantity=Decimal("1.0"),
            order_type=OrderType.MARKET,
            limit_price=None,
        )
        intent = signal_to_intent(
            signal, account_id="account-1", current_position_quantity=Decimal(0)
        )

        result = run(adapter.submit_order(intent, build_client_order_id(intent)))

        assert result.accepted is True
        assert result.is_simulated is True
        assert len(result.fills) == 1
        # The simulator must use the observed ask, not an invented price.
        assert result.fills[0].price == live_book.best_ask == Decimal("30005.00")
        assert result.fills[0].is_simulated is True

    def test_non_marketable_limit_rests_without_filling(self, live_book) -> None:
        adapter = PaperTradingAdapter(lambda ex, sym: live_book.top())
        intent = _limit_intent(price="29000", side=OrderSide.BUY)

        result = run(adapter.submit_order(intent, build_client_order_id(intent)))

        assert result.accepted is True
        assert result.status is OrderStatus.ACKNOWLEDGED
        assert result.fills == ()

    def test_no_book_means_no_invented_fill(self) -> None:
        """Without market data the simulator rests the order, never guesses."""
        adapter = PaperTradingAdapter(lambda ex, sym: None)
        intent = _limit_intent(price="30000", side=OrderSide.BUY)

        result = run(adapter.submit_order(intent, build_client_order_id(intent)))

        assert result.accepted is True
        assert result.fills == ()

    def test_fill_is_capped_by_real_resting_quantity(self, live_book) -> None:
        adapter = PaperTradingAdapter(lambda ex, sym: live_book.top())
        # Only 1.5 rests at the best ask; ask for 10.
        intent = _limit_intent(price="30005.00", side=OrderSide.BUY, quantity="10")

        result = run(adapter.submit_order(intent, build_client_order_id(intent)))

        assert result.fills[0].quantity == Decimal("1.5")
        assert result.status is OrderStatus.PARTIALLY_FILLED

    def test_unusable_book_stops_the_pipeline_before_execution(
        self, live_book
    ) -> None:
        """A sequence gap must prevent a market order from being priced."""
        live_book.apply_delta(
            make_delta(bids=(level("29990.00", "1"),), first=9999, final=9999)
        )
        assert live_book.is_usable is False

        engine = RiskEngine(
            RiskLimits(
                max_order_quantity=Decimal("100"),
                max_order_notional=Decimal("10000000"),
            )
        )
        intent = _limit_intent(price=None, side=OrderSide.BUY, order_type=OrderType.MARKET)
        snapshot = _snapshot(book_usable=False, reference_price=None)

        decision = engine.evaluate(
            intent,
            snapshot=snapshot,
            kill_switches=KillSwitchState(),
            trading_mode=TradingMode.PAPER,
            book_top=live_book.top(),
        )

        assert decision.approved is False
        assert decision.would_route is False


class TestFullRoundTrip:
    def test_signal_to_position_updates_state_consistently(self, live_book) -> None:
        adapter = PaperTradingAdapter(lambda ex, sym: live_book.top())
        positions = PositionManager()
        bus = InMemoryEventBus()
        engine = RiskEngine(
            RiskLimits(
                max_order_quantity=Decimal("100"),
                max_order_notional=Decimal("10000000"),
                max_position_quantity=Decimal("100"),
            )
        )

        intent = _limit_intent(price="30005.00", side=OrderSide.BUY, quantity="1.0")
        decision = engine.evaluate(
            intent,
            snapshot=_snapshot(),
            kill_switches=KillSwitchState(),
            trading_mode=TradingMode.PAPER,
            book_top=live_book.top(),
        )
        assert decision.approved is True

        client_order_id = build_client_order_id(intent)
        order = Order.from_intent(
            intent, client_order_id=client_order_id, is_simulated=True
        )
        order.transition_to(OrderStatus.SUBMITTED)
        bus.publish(
            TradingEvent.create(
                TradingEventType.ORDER_SUBMITTED,
                source="test",
                payload={"orderId": order.order_id},
                tenant_id=intent.tenant_id,
            )
        )

        result = run(adapter.submit_order(intent, client_order_id))
        order.try_transition_to(
            OrderStatus.ACKNOWLEDGED, exchange_order_id=result.exchange_order_id
        )

        for raw in result.fills:
            fill = replace(raw, order_id=order.order_id)
            assert order.apply_fill(fill) is True
            positions.apply_fill(
                intent.tenant_id,
                intent.account_id,
                intent.exchange,
                intent.symbol,
                intent.side,
                fill,
            )

        assert order.status is OrderStatus.FILLED
        assert order.filled_quantity == Decimal("1.0")
        assert order.average_fill_price == Decimal("30005.00")
        assert order.is_simulated is True

        position = positions.get("account-1", EXCHANGE, SYMBOL)
        assert position.quantity == Decimal("1.0")
        assert position.average_entry_price == Decimal("30005.00")
        # The simulated origin must survive all the way to the position.
        assert position.contains_simulated_fills is True

    def test_kill_switch_stops_the_pipeline_at_risk(self, live_book) -> None:
        engine = RiskEngine(
            RiskLimits(
                max_order_quantity=Decimal("100"),
                max_order_notional=Decimal("10000000"),
            )
        )
        intent = _limit_intent(price="30005.00", side=OrderSide.BUY)

        decision = engine.evaluate(
            intent,
            snapshot=_snapshot(),
            kill_switches=KillSwitchState(global_engaged=True, reason="drill"),
            trading_mode=TradingMode.PAPER,
            book_top=live_book.top(),
        )

        assert decision.approved is False
        assert decision.would_route is False


class TestEventBus:
    def test_events_reach_their_subscriber(self) -> None:
        bus = InMemoryEventBus()
        seen: list[TradingEvent] = []
        bus.subscribe(TradingEventType.ORDER_FILLED, seen.append)

        bus.publish(
            TradingEvent.create(
                TradingEventType.ORDER_FILLED, source="test", payload={"a": "1"}
            )
        )

        assert len(seen) == 1

    def test_other_event_types_are_not_delivered(self) -> None:
        bus = InMemoryEventBus()
        seen: list[TradingEvent] = []
        bus.subscribe(TradingEventType.ORDER_FILLED, seen.append)

        bus.publish(
            TradingEvent.create(
                TradingEventType.ORDER_REJECTED, source="test", payload={}
            )
        )

        assert seen == []

    def test_a_failing_handler_does_not_block_the_others(self) -> None:
        bus = InMemoryEventBus()
        delivered: list[str] = []

        def broken(event: TradingEvent) -> None:
            raise RuntimeError("consumer bug")

        bus.subscribe(TradingEventType.ORDER_FILLED, broken)
        bus.subscribe(TradingEventType.ORDER_FILLED, lambda e: delivered.append(e.event_id))

        bus.publish(
            TradingEvent.create(TradingEventType.ORDER_FILLED, source="test", payload={})
        )

        assert len(delivered) == 1
        assert len(bus.handler_errors) == 1

    def test_derived_events_preserve_the_causal_chain(self) -> None:
        root = TradingEvent.create(
            TradingEventType.MARKET_DATA_RECEIVED,
            source="market-data",
            payload={},
            tenant_id="tenant-1",
        )

        signal = root.derive(
            TradingEventType.SIGNAL_GENERATED, source="trading-engine", payload={}
        )
        order = signal.derive(
            TradingEventType.ORDER_REQUESTED, source="execution-engine", payload={}
        )

        assert root.correlation_id == root.event_id
        assert signal.correlation_id == root.correlation_id
        assert order.correlation_id == root.correlation_id
        assert order.causation_id == signal.event_id
        assert order.tenant_id == "tenant-1"


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------
def _limit_intent(
    *,
    price: str | None,
    side: OrderSide,
    quantity: str = "1.0",
    order_type: OrderType = OrderType.LIMIT,
):
    from wlct_trading.orders import OrderIntent

    return OrderIntent(
        tenant_id="tenant-1",
        account_id="account-1",
        strategy_id="strategy-1",
        exchange=EXCHANGE,
        symbol=SYMBOL,
        side=side,
        order_type=order_type,
        quantity=Decimal(quantity),
        price=Decimal(price) if price is not None else None,
    )


def _snapshot(*, book_usable: bool = True, reference_price: str | None = "30000"):
    from wlct_trading.risk import RiskSnapshot

    return RiskSnapshot(
        position_quantity=Decimal(0),
        symbol_exposure_notional=Decimal(0),
        account_exposure_notional=Decimal(0),
        open_order_count=0,
        orders_in_last_minute=0,
        realised_pnl_today=Decimal(0),
        strategy_realised_pnl_today=Decimal(0),
        reference_price=Decimal(reference_price) if reference_price else None,
        market_data_age_micros=1_000,
        book_usable=book_usable,
        is_complete=True,
    )
```

---

## FILE: libs/trading-core/tests/test_risk.py

Changed by the sweep: ruff F401: unused import removed.

```py
"""Risk engine: limits, kill switches, layering and fail-closed behaviour."""

from __future__ import annotations

from dataclasses import replace
from decimal import Decimal

from wlct_trading.enums import (
    KillSwitchScope,
    OrderSide,
    OrderType,
    RiskDecisionCode,
    TradingMode,
)
from wlct_trading.risk import (
    KillSwitchState,
    RiskEngine,
    RiskLimits,
    TradingModeResolver,
)

from tests.conftest import EXCHANGE, SYMBOL


def evaluate(engine, intent, snapshot, kill_switches, **kwargs):
    return engine.evaluate(
        intent,
        snapshot=snapshot,
        kill_switches=kill_switches,
        trading_mode=kwargs.pop("trading_mode", TradingMode.PAPER),
        **kwargs,
    )


class TestApproval:
    def test_a_clean_intent_is_approved(
        self, engine, make_intent, clean_snapshot, no_kill_switches
    ) -> None:
        decision = evaluate(engine, make_intent(), clean_snapshot, no_kill_switches)

        assert decision.approved is True
        assert decision.code is RiskDecisionCode.APPROVED
        assert decision.violations == ()
        assert decision.would_route is True

    def test_approved_but_disabled_mode_does_not_route(
        self, engine, make_intent, clean_snapshot, no_kill_switches
    ) -> None:
        decision = evaluate(
            engine,
            make_intent(),
            clean_snapshot,
            no_kill_switches,
            trading_mode=TradingMode.DISABLED,
        )

        assert decision.approved is False
        assert decision.code is RiskDecisionCode.TRADING_DISABLED
        assert decision.would_route is False


class TestKillSwitch:
    def test_global_kill_switch_blocks_everything(
        self, engine, make_intent, clean_snapshot
    ) -> None:
        decision = evaluate(
            engine,
            make_intent(),
            clean_snapshot,
            KillSwitchState(global_engaged=True, reason="incident 42"),
        )

        assert decision.approved is False
        assert decision.code is RiskDecisionCode.KILL_SWITCH_ENGAGED
        assert decision.kill_switch_scope is KillSwitchScope.GLOBAL
        assert "incident 42" in decision.rejection_summary

    def test_exchange_kill_switch_blocks_that_venue(
        self, engine, make_intent, clean_snapshot
    ) -> None:
        decision = evaluate(
            engine,
            make_intent(),
            clean_snapshot,
            KillSwitchState(engaged_exchanges=frozenset({EXCHANGE.value})),
        )

        assert decision.approved is False
        assert decision.kill_switch_scope is KillSwitchScope.EXCHANGE

    def test_strategy_kill_switch_blocks_that_strategy(
        self, engine, make_intent, clean_snapshot
    ) -> None:
        decision = evaluate(
            engine,
            make_intent(),
            clean_snapshot,
            KillSwitchState(engaged_strategies=frozenset({"strategy-1"})),
        )

        assert decision.approved is False
        assert decision.kill_switch_scope is KillSwitchScope.STRATEGY

    def test_symbol_kill_switch_blocks_that_symbol(
        self, engine, make_intent, clean_snapshot
    ) -> None:
        decision = evaluate(
            engine,
            make_intent(),
            clean_snapshot,
            KillSwitchState(engaged_symbols=frozenset({SYMBOL})),
        )

        assert decision.approved is False
        assert decision.kill_switch_scope is KillSwitchScope.SYMBOL

    def test_unrelated_switch_does_not_block(
        self, engine, make_intent, clean_snapshot
    ) -> None:
        decision = evaluate(
            engine,
            make_intent(),
            clean_snapshot,
            KillSwitchState(
                engaged_symbols=frozenset({"ETH-USDT"}),
                engaged_strategies=frozenset({"strategy-9"}),
                engaged_exchanges=frozenset({"kraken"}),
            ),
        )

        assert decision.approved is True

    def test_kill_switch_precedes_every_other_check(
        self, engine, make_intent, clean_snapshot
    ) -> None:
        """An engaged switch short-circuits even a structurally invalid intent."""
        broken = make_intent(quantity="-5")
        decision = evaluate(
            engine, broken, clean_snapshot, KillSwitchState(global_engaged=True)
        )

        assert decision.code is RiskDecisionCode.KILL_SWITCH_ENGAGED


class TestFailClosed:
    def test_incomplete_risk_state_rejects(
        self, engine, make_intent, clean_snapshot, no_kill_switches
    ) -> None:
        decision = evaluate(
            engine,
            make_intent(),
            replace(clean_snapshot, is_complete=False),
            no_kill_switches,
        )

        assert decision.approved is False
        assert decision.code is RiskDecisionCode.RISK_STATE_UNAVAILABLE

    def test_missing_limit_rejects_rather_than_allowing(
        self, make_intent, clean_snapshot, no_kill_switches
    ) -> None:
        """An unconfigured limit is never treated as 'unlimited'."""
        engine = RiskEngine(platform_limits=RiskLimits())

        decision = evaluate(engine, make_intent(), clean_snapshot, no_kill_switches)

        assert decision.approved is False
        assert decision.code is RiskDecisionCode.RISK_STATE_UNAVAILABLE

    def test_market_order_without_reference_price_rejects(
        self, engine, make_intent, clean_snapshot, no_kill_switches
    ) -> None:
        decision = evaluate(
            engine,
            make_intent(order_type=OrderType.MARKET, price=None),
            replace(clean_snapshot, reference_price=None),
            no_kill_switches,
        )

        assert decision.approved is False
        assert decision.code is RiskDecisionCode.STALE_MARKET_DATA

    def test_stale_market_data_rejects_market_order(
        self, engine, make_intent, clean_snapshot, no_kill_switches
    ) -> None:
        decision = evaluate(
            engine,
            make_intent(order_type=OrderType.MARKET, price=None),
            replace(clean_snapshot, market_data_age_micros=120_000_000),
            no_kill_switches,
        )

        assert decision.approved is False
        assert decision.code is RiskDecisionCode.STALE_MARKET_DATA


class TestMaxOrderSize:
    def test_order_at_the_limit_is_allowed(
        self, make_intent, clean_snapshot, no_kill_switches, permissive_limits
    ) -> None:
        engine = RiskEngine(replace(permissive_limits, max_order_quantity=Decimal("5")))

        decision = evaluate(
            engine, make_intent(quantity="5"), clean_snapshot, no_kill_switches
        )

        assert decision.approved is True

    def test_order_above_the_limit_is_rejected(
        self, make_intent, clean_snapshot, no_kill_switches, permissive_limits
    ) -> None:
        engine = RiskEngine(replace(permissive_limits, max_order_quantity=Decimal("5")))

        decision = evaluate(
            engine, make_intent(quantity="5.0001"), clean_snapshot, no_kill_switches
        )

        assert decision.approved is False
        assert decision.code is RiskDecisionCode.MAX_ORDER_SIZE_EXCEEDED
        assert decision.violations[0].limit == "5"

    def test_notional_limit_is_enforced_independently(
        self, make_intent, clean_snapshot, no_kill_switches, permissive_limits
    ) -> None:
        engine = RiskEngine(
            replace(permissive_limits, max_order_notional=Decimal("10000"))
        )

        # 1 unit at 30 000 is well inside the quantity limit but not the notional.
        decision = evaluate(
            engine, make_intent(quantity="1"), clean_snapshot, no_kill_switches
        )

        assert decision.approved is False
        assert decision.code is RiskDecisionCode.MAX_ORDER_NOTIONAL_EXCEEDED


class TestMaxPositionSize:
    def test_resulting_position_within_limit_is_allowed(
        self, make_intent, clean_snapshot, no_kill_switches, permissive_limits
    ) -> None:
        engine = RiskEngine(
            replace(permissive_limits, max_position_quantity=Decimal("10"))
        )

        decision = evaluate(
            engine,
            make_intent(quantity="3"),
            replace(clean_snapshot, position_quantity=Decimal("7")),
            no_kill_switches,
        )

        assert decision.approved is True

    def test_resulting_position_above_limit_is_rejected(
        self, make_intent, clean_snapshot, no_kill_switches, permissive_limits
    ) -> None:
        engine = RiskEngine(
            replace(permissive_limits, max_position_quantity=Decimal("10"))
        )

        decision = evaluate(
            engine,
            make_intent(quantity="4"),
            replace(clean_snapshot, position_quantity=Decimal("7")),
            no_kill_switches,
        )

        assert decision.approved is False
        assert decision.code is RiskDecisionCode.MAX_POSITION_SIZE_EXCEEDED

    def test_short_side_uses_absolute_magnitude(
        self, make_intent, clean_snapshot, no_kill_switches, permissive_limits
    ) -> None:
        engine = RiskEngine(
            replace(permissive_limits, max_position_quantity=Decimal("10"))
        )

        decision = evaluate(
            engine,
            make_intent(side=OrderSide.SELL, quantity="4"),
            replace(clean_snapshot, position_quantity=Decimal("-7")),
            no_kill_switches,
        )

        assert decision.approved is False
        assert decision.code is RiskDecisionCode.MAX_POSITION_SIZE_EXCEEDED

    def test_reduce_only_bypasses_the_position_ceiling(
        self, make_intent, clean_snapshot, no_kill_switches, permissive_limits
    ) -> None:
        """An order that can only shrink exposure cannot breach a cap."""
        engine = RiskEngine(
            replace(permissive_limits, max_position_quantity=Decimal("1"))
        )

        decision = evaluate(
            engine,
            make_intent(side=OrderSide.SELL, quantity="7", reduce_only=True),
            replace(clean_snapshot, position_quantity=Decimal("7")),
            no_kill_switches,
        )

        assert decision.approved is True

    def test_opposite_side_order_reduces_projected_position(
        self, make_intent, clean_snapshot, no_kill_switches, permissive_limits
    ) -> None:
        engine = RiskEngine(
            replace(permissive_limits, max_position_quantity=Decimal("10"))
        )

        decision = evaluate(
            engine,
            make_intent(side=OrderSide.SELL, quantity="4"),
            replace(clean_snapshot, position_quantity=Decimal("9")),
            no_kill_switches,
        )

        assert decision.approved is True


class TestExposureAndBudgets:
    def test_symbol_exposure_limit(
        self, make_intent, clean_snapshot, no_kill_switches, permissive_limits
    ) -> None:
        engine = RiskEngine(
            replace(permissive_limits, max_symbol_exposure_notional=Decimal("40000"))
        )

        decision = evaluate(
            engine,
            make_intent(quantity="1"),
            replace(clean_snapshot, symbol_exposure_notional=Decimal("20000")),
            no_kill_switches,
        )

        assert decision.approved is False
        assert decision.code is RiskDecisionCode.MAX_SYMBOL_EXPOSURE_EXCEEDED

    def test_account_exposure_limit(
        self, make_intent, clean_snapshot, no_kill_switches, permissive_limits
    ) -> None:
        engine = RiskEngine(
            replace(permissive_limits, max_account_exposure_notional=Decimal("35000"))
        )

        decision = evaluate(
            engine,
            make_intent(quantity="1"),
            replace(clean_snapshot, account_exposure_notional=Decimal("10000")),
            no_kill_switches,
        )

        assert decision.approved is False
        assert decision.code is RiskDecisionCode.MAX_ACCOUNT_EXPOSURE_EXCEEDED

    def test_open_order_cap(
        self, make_intent, clean_snapshot, no_kill_switches, permissive_limits
    ) -> None:
        engine = RiskEngine(replace(permissive_limits, max_open_orders=3))

        decision = evaluate(
            engine,
            make_intent(),
            replace(clean_snapshot, open_order_count=3),
            no_kill_switches,
        )

        assert decision.approved is False
        assert decision.code is RiskDecisionCode.MAX_OPEN_ORDERS_EXCEEDED

    def test_order_rate_cap(
        self, make_intent, clean_snapshot, no_kill_switches, permissive_limits
    ) -> None:
        engine = RiskEngine(replace(permissive_limits, max_orders_per_minute=60))

        decision = evaluate(
            engine,
            make_intent(),
            replace(clean_snapshot, orders_in_last_minute=60),
            no_kill_switches,
        )

        assert decision.approved is False
        assert decision.code is RiskDecisionCode.ORDER_RATE_EXCEEDED


class TestLossLimits:
    def test_daily_loss_limit_halts_trading(
        self, make_intent, clean_snapshot, no_kill_switches, permissive_limits
    ) -> None:
        engine = RiskEngine(replace(permissive_limits, max_daily_loss=Decimal("500")))

        decision = evaluate(
            engine,
            make_intent(),
            replace(clean_snapshot, realised_pnl_today=Decimal("-500")),
            no_kill_switches,
        )

        assert decision.approved is False
        assert decision.code is RiskDecisionCode.DAILY_LOSS_LIMIT_BREACHED

    def test_profit_never_trips_a_loss_limit(
        self, make_intent, clean_snapshot, no_kill_switches, permissive_limits
    ) -> None:
        engine = RiskEngine(replace(permissive_limits, max_daily_loss=Decimal("500")))

        decision = evaluate(
            engine,
            make_intent(),
            replace(clean_snapshot, realised_pnl_today=Decimal("5000")),
            no_kill_switches,
        )

        assert decision.approved is True

    def test_strategy_loss_limit_is_separate(
        self, make_intent, clean_snapshot, no_kill_switches, permissive_limits
    ) -> None:
        engine = RiskEngine(
            replace(permissive_limits, max_strategy_loss=Decimal("100"))
        )

        decision = evaluate(
            engine,
            make_intent(),
            replace(clean_snapshot, strategy_realised_pnl_today=Decimal("-150")),
            no_kill_switches,
        )

        assert decision.approved is False
        assert decision.code is RiskDecisionCode.STRATEGY_LOSS_LIMIT_BREACHED


class TestLimitLayering:
    def test_strategy_limit_tightens_the_platform_limit(
        self, engine, make_intent, clean_snapshot, no_kill_switches
    ) -> None:
        decision = evaluate(
            engine,
            make_intent(quantity="10"),
            clean_snapshot,
            no_kill_switches,
            strategy_limits=RiskLimits(max_order_quantity=Decimal("5")),
        )

        assert decision.approved is False
        assert decision.code is RiskDecisionCode.MAX_ORDER_SIZE_EXCEEDED

    def test_strategy_limit_cannot_widen_the_platform_limit(
        self, make_intent, clean_snapshot, no_kill_switches, permissive_limits
    ) -> None:
        engine = RiskEngine(replace(permissive_limits, max_order_quantity=Decimal("2")))

        decision = evaluate(
            engine,
            make_intent(quantity="10"),
            clean_snapshot,
            no_kill_switches,
            strategy_limits=RiskLimits(max_order_quantity=Decimal("1000")),
        )

        assert decision.approved is False
        assert decision.violations[0].limit == "2"

    def test_tightest_of_three_layers_wins(self) -> None:
        platform = RiskLimits(max_order_quantity=Decimal("100"))
        account = RiskLimits(max_order_quantity=Decimal("50"))
        strategy = RiskLimits(max_order_quantity=Decimal("7"))

        combined = platform.tightest_with(account).tightest_with(strategy)

        assert combined.max_order_quantity == Decimal("7")

    def test_none_defers_to_the_other_layer(self) -> None:
        combined = RiskLimits().tightest_with(
            RiskLimits(max_order_quantity=Decimal("9"))
        )
        assert combined.max_order_quantity == Decimal("9")


class TestGating:
    def test_disabled_strategy_is_rejected(
        self, engine, make_intent, clean_snapshot, no_kill_switches
    ) -> None:
        decision = evaluate(
            engine,
            make_intent(),
            clean_snapshot,
            no_kill_switches,
            strategy_enabled=False,
        )

        assert decision.code is RiskDecisionCode.STRATEGY_DISABLED

    def test_untradeable_symbol_is_rejected(
        self, engine, make_intent, clean_snapshot, no_kill_switches
    ) -> None:
        decision = evaluate(
            engine,
            make_intent(),
            clean_snapshot,
            no_kill_switches,
            symbol_tradeable=False,
        )

        assert decision.code is RiskDecisionCode.SYMBOL_NOT_TRADEABLE

    def test_invalid_intent_is_rejected(
        self, engine, make_intent, clean_snapshot, no_kill_switches
    ) -> None:
        decision = evaluate(
            engine, make_intent(quantity="0"), clean_snapshot, no_kill_switches
        )

        assert decision.code is RiskDecisionCode.INVALID_INTENT

    def test_duplicate_client_order_id_is_rejected(
        self, engine, make_intent, clean_snapshot, no_kill_switches
    ) -> None:
        decision = evaluate(
            engine,
            make_intent(client_order_id="wlct-abc"),
            replace(clean_snapshot, known_client_order_ids=frozenset({"wlct-abc"})),
            no_kill_switches,
        )

        assert decision.approved is False
        assert decision.code is RiskDecisionCode.DUPLICATE_ORDER


class TestPriceDeviation:
    def test_price_far_from_reference_is_rejected(
        self, make_intent, clean_snapshot, no_kill_switches, permissive_limits
    ) -> None:
        engine = RiskEngine(
            replace(permissive_limits, max_price_deviation_percent=Decimal("2"))
        )

        # Reference is 30 000; a 45 000 limit is 50% away.
        decision = evaluate(
            engine, make_intent(price="45000"), clean_snapshot, no_kill_switches
        )

        assert decision.approved is False
        assert decision.code is RiskDecisionCode.PRICE_DEVIATION_EXCEEDED

    def test_price_near_reference_is_accepted(
        self, make_intent, clean_snapshot, no_kill_switches, permissive_limits
    ) -> None:
        engine = RiskEngine(
            replace(permissive_limits, max_price_deviation_percent=Decimal("2"))
        )

        decision = evaluate(
            engine, make_intent(price="30100"), clean_snapshot, no_kill_switches
        )

        assert decision.approved is True


class TestTradingModeResolver:
    def test_default_configuration_disables_trading(self) -> None:
        resolved = TradingModeResolver(
            mode=None, trading_enabled=False, live_confirmed=False
        ).resolve()
        assert resolved is TradingMode.DISABLED

    def test_omitted_mode_never_yields_live(self) -> None:
        resolved = TradingModeResolver(
            mode=None, trading_enabled=True, live_confirmed=True
        ).resolve()
        assert resolved is TradingMode.DISABLED

    def test_paper_requires_only_mode_and_enable(self) -> None:
        resolved = TradingModeResolver(
            mode="PAPER", trading_enabled=True, live_confirmed=False
        ).resolve()
        assert resolved is TradingMode.PAPER

    def test_live_requires_all_three_settings(self) -> None:
        resolved = TradingModeResolver(
            mode="LIVE", trading_enabled=True, live_confirmed=True
        ).resolve()
        assert resolved is TradingMode.LIVE

    def test_unconfirmed_live_disables_rather_than_downgrades(self) -> None:
        """Silently falling back to paper would hide a production misconfig."""
        resolver = TradingModeResolver(
            mode="LIVE", trading_enabled=True, live_confirmed=False
        )

        assert resolver.resolve() is TradingMode.DISABLED
        assert "LIVE_TRADING_CONFIRMED" in resolver.describe()

    def test_live_with_trading_disabled_is_disabled(self) -> None:
        resolved = TradingModeResolver(
            mode="LIVE", trading_enabled=False, live_confirmed=True
        ).resolve()
        assert resolved is TradingMode.DISABLED

    def test_unknown_mode_string_is_disabled(self) -> None:
        resolved = TradingModeResolver(
            mode="live-ish", trading_enabled=True, live_confirmed=True
        ).resolve()
        assert resolved is TradingMode.DISABLED
```

---

## FILE: libs/trading-core/tests/test_signals.py

Changed by the sweep: ruff F401: unused import removed.

```py
"""Signal validation and the signal-to-intent translation."""

from __future__ import annotations

from decimal import Decimal

import pytest

from wlct_trading.enums import OrderSide, OrderType, SignalAction
from wlct_trading.signals import (
    BaseStrategy,
    Signal,
    SignalValidationError,
    StrategyDescriptor,
    StrategyRiskProfile,
    signal_to_intent,
)

from tests.conftest import EXCHANGE, SYMBOL


def make_signal(**overrides) -> Signal:
    params = {
        "signal_id": "signal-1",
        "tenant_id": "tenant-1",
        "strategy_id": "strategy-1",
        "exchange": EXCHANGE,
        "symbol": SYMBOL,
        "action": SignalAction.BUY,
        "confidence": Decimal("0.8"),
        "reference_price": Decimal("30000"),
        "target_quantity": Decimal("1"),
        "order_type": OrderType.LIMIT,
        "limit_price": Decimal("30000"),
    }
    params.update(overrides)
    return Signal(**params)


class TestSignalValidation:
    def test_a_well_formed_signal_is_valid(self) -> None:
        assert make_signal().is_valid is True
        assert make_signal().validation_errors() == []

    def test_missing_tenant_is_invalid(self) -> None:
        errors = make_signal(tenant_id="").validation_errors()
        assert any("tenant_id" in e for e in errors)

    def test_missing_strategy_is_invalid(self) -> None:
        errors = make_signal(strategy_id="").validation_errors()
        assert any("strategy_id" in e for e in errors)

    def test_confidence_above_one_is_invalid(self) -> None:
        errors = make_signal(confidence=Decimal("1.5")).validation_errors()
        assert any("confidence" in e for e in errors)

    def test_negative_confidence_is_invalid(self) -> None:
        errors = make_signal(confidence=Decimal("-0.1")).validation_errors()
        assert any("confidence" in e for e in errors)

    def test_boundary_confidences_are_valid(self) -> None:
        assert make_signal(confidence=Decimal("0")).is_valid is True
        assert make_signal(confidence=Decimal("1")).is_valid is True

    def test_buy_without_quantity_is_invalid(self) -> None:
        errors = make_signal(target_quantity=None).validation_errors()
        assert any("target_quantity" in e for e in errors)

    def test_zero_quantity_is_invalid(self) -> None:
        errors = make_signal(target_quantity=Decimal("0")).validation_errors()
        assert any("target_quantity" in e for e in errors)

    def test_limit_signal_without_price_is_invalid(self) -> None:
        errors = make_signal(limit_price=None).validation_errors()
        assert any("limit_price" in e for e in errors)

    def test_market_signal_with_a_limit_price_is_invalid(self) -> None:
        errors = make_signal(
            order_type=OrderType.MARKET, limit_price=Decimal("30000")
        ).validation_errors()
        assert any("must not carry" in e for e in errors)

    def test_stop_limit_requires_both_prices(self) -> None:
        errors = make_signal(
            order_type=OrderType.STOP_LIMIT, stop_price=None
        ).validation_errors()
        assert any("stop_price" in e for e in errors)

    def test_hold_needs_no_execution_parameters(self) -> None:
        signal = make_signal(
            action=SignalAction.HOLD,
            target_quantity=None,
            limit_price=None,
            order_type=OrderType.MARKET,
        )
        assert signal.is_valid is True

    def test_raise_if_invalid_reports_every_problem(self) -> None:
        signal = make_signal(tenant_id="", target_quantity=Decimal("-1"))

        with pytest.raises(SignalValidationError) as excinfo:
            signal.raise_if_invalid()

        assert "tenant_id" in str(excinfo.value)
        assert "target_quantity" in str(excinfo.value)

    def test_multiple_errors_are_all_collected(self) -> None:
        errors = make_signal(
            tenant_id="", strategy_id="", confidence=Decimal("9")
        ).validation_errors()
        assert len(errors) >= 3


class TestSignalToIntent:
    def test_buy_signal_becomes_a_buy_intent(self) -> None:
        intent = signal_to_intent(
            make_signal(), account_id="account-1", current_position_quantity=Decimal(0)
        )

        assert intent is not None
        assert intent.side is OrderSide.BUY
        assert intent.quantity == Decimal("1")
        assert intent.signal_id == "signal-1"
        assert intent.reduce_only is False

    def test_sell_signal_becomes_a_sell_intent(self) -> None:
        intent = signal_to_intent(
            make_signal(action=SignalAction.SELL),
            account_id="account-1",
            current_position_quantity=Decimal(0),
        )

        assert intent.side is OrderSide.SELL

    def test_hold_produces_no_intent(self) -> None:
        intent = signal_to_intent(
            make_signal(
                action=SignalAction.HOLD, target_quantity=None, limit_price=None,
                order_type=OrderType.MARKET,
            ),
            account_id="account-1",
            current_position_quantity=Decimal("5"),
        )

        assert intent is None

    def test_close_on_a_flat_position_produces_no_intent(self) -> None:
        intent = signal_to_intent(
            make_signal(action=SignalAction.CLOSE, target_quantity=None),
            account_id="account-1",
            current_position_quantity=Decimal(0),
        )

        assert intent is None

    def test_close_of_a_long_sells_the_actual_quantity(self) -> None:
        """The closing size comes from the real position, not the strategy."""
        intent = signal_to_intent(
            make_signal(action=SignalAction.CLOSE, target_quantity=Decimal("999")),
            account_id="account-1",
            current_position_quantity=Decimal("3.5"),
        )

        assert intent.side is OrderSide.SELL
        assert intent.quantity == Decimal("3.5")
        assert intent.reduce_only is True

    def test_close_of_a_short_buys_the_actual_quantity(self) -> None:
        intent = signal_to_intent(
            make_signal(action=SignalAction.CLOSE, target_quantity=None),
            account_id="account-1",
            current_position_quantity=Decimal("-2"),
        )

        assert intent.side is OrderSide.BUY
        assert intent.quantity == Decimal("2")
        assert intent.reduce_only is True

    def test_invalid_signal_is_refused_before_translation(self) -> None:
        with pytest.raises(SignalValidationError):
            signal_to_intent(
                make_signal(confidence=Decimal("5")),
                account_id="account-1",
                current_position_quantity=Decimal(0),
            )

    def test_generated_intent_is_structurally_valid(self) -> None:
        intent = signal_to_intent(
            make_signal(), account_id="account-1", current_position_quantity=Decimal(0)
        )
        assert intent.is_valid is True


class _CountingStrategy(BaseStrategy):
    """Minimal concrete strategy used to exercise the lifecycle."""

    def __init__(self, descriptor: StrategyDescriptor) -> None:
        super().__init__(descriptor)
        self.ticks = 0

    def on_market_data(self, ticker) -> None:
        self.ticks += 1

    def generate_signal(self, symbol: str):
        return None


def make_descriptor(enabled: bool = True) -> StrategyDescriptor:
    return StrategyDescriptor(
        strategy_id="strategy-1",
        tenant_id="tenant-1",
        name="counting",
        version="1.0.0",
        enabled=enabled,
        exchange=EXCHANGE,
        symbols=(SYMBOL,),
        risk_profile=StrategyRiskProfile(
            max_order_quantity=Decimal("1"),
            max_position_quantity=Decimal("5"),
            max_order_notional=Decimal("50000"),
            max_daily_loss=Decimal("500"),
            max_open_orders=5,
            max_orders_per_minute=30,
        ),
    )


class TestStrategyLifecycle:
    def test_strategy_starts_stopped(self) -> None:
        strategy = _CountingStrategy(make_descriptor())
        assert strategy.is_running is False

    def test_start_initialises_automatically(self) -> None:
        strategy = _CountingStrategy(make_descriptor())
        strategy.start()

        assert strategy.is_initialised is True
        assert strategy.is_running is True

    def test_disabled_strategy_refuses_to_start(self) -> None:
        strategy = _CountingStrategy(make_descriptor(enabled=False))

        with pytest.raises(RuntimeError):
            strategy.start()

        assert strategy.is_running is False

    def test_stop_is_idempotent(self) -> None:
        strategy = _CountingStrategy(make_descriptor())
        strategy.start()
        strategy.stop()
        strategy.stop()

        assert strategy.is_running is False

    def test_default_handlers_are_safe_no_ops(self) -> None:
        strategy = _CountingStrategy(make_descriptor())
        strategy.on_order_book_update(None)
        strategy.on_trade(None)
        strategy.on_candle(None)

        assert strategy.ticks == 0

    def test_descriptor_identity_is_exposed(self) -> None:
        strategy = _CountingStrategy(make_descriptor())

        assert strategy.strategy_id == "strategy-1"
        assert strategy.name == "counting"
        assert strategy.version == "1.0.0"
        assert strategy.symbols == (SYMBOL,)
```

---

## FILE: libs/trading-core/tests/test_transport.py

Changed by the sweep: ruff F401: unused import removed.

```py
"""Transport layer: backoff, error taxonomy, connection state, rate limits.

Every test here is deterministic. Backoff jitter is either disabled or driven by
a seeded RNG, and every clock reading is injected, so nothing depends on wall
time.
"""

from __future__ import annotations

import random

import pytest

from wlct_trading.transport.backoff import BackoffConfig, ExponentialBackoff
from wlct_trading.transport.errors import (
    RETRY_POLICIES,
    ExchangeErrorCategory,
    NormalisedExchangeError,
    scrub_metadata,
)
from wlct_trading.transport.errors import _REDACTED
from wlct_trading.transport.ratelimit import (
    RateLimitRegistry,
    RateLimitRule,
    WeightedRateLimiter,
)
from wlct_trading.transport.state import (
    ConnectionHealth,
    ConnectionState,
    InvalidConnectionTransition,
    LatencyStats,
    is_legal_connection_transition,
)

BASE_TS = 1_700_000_000_000_000
MICROS_PER_SECOND = 1_000_000


# ----------------------------------------------------------------------
# Backoff
# ----------------------------------------------------------------------
def test_backoff_grows_exponentially_without_jitter() -> None:
    backoff = ExponentialBackoff(
        BackoffConfig(base_delay_millis=100, max_delay_millis=10_000, jitter=False)
    )
    delays = [backoff.next_delay_millis() for _ in range(5)]
    assert delays == [100, 200, 400, 800, 1_600]


def test_backoff_is_capped_at_the_maximum() -> None:
    backoff = ExponentialBackoff(
        BackoffConfig(base_delay_millis=1_000, max_delay_millis=5_000, jitter=False)
    )
    delays = [backoff.next_delay_millis() for _ in range(6)]
    assert delays == [1_000, 2_000, 4_000, 5_000, 5_000, 5_000]
    assert max(delays) <= 5_000


def test_backoff_full_jitter_never_exceeds_the_ceiling() -> None:
    """Jitter must spread retries without ever exceeding the capped ceiling.

    A seeded RNG makes this exact rather than probabilistic.
    """
    backoff = ExponentialBackoff(
        BackoffConfig(base_delay_millis=100, max_delay_millis=3_200, jitter=True),
        _rng=random.Random(1234),
    )
    for attempt in range(8):
        ceiling = min(100 * (2**attempt), 3_200)
        delay = backoff.next_delay_millis()
        assert 0 <= delay <= ceiling


def test_backoff_jitter_actually_varies() -> None:
    """Guards against a jitter implementation that silently returns the cap."""
    first = ExponentialBackoff(
        BackoffConfig(base_delay_millis=1_000, max_delay_millis=60_000, jitter=True),
        _rng=random.Random(7),
    )
    samples = {first.next_delay_millis() for _ in range(20)}
    assert len(samples) > 1


def test_backoff_reset_returns_to_the_first_delay() -> None:
    backoff = ExponentialBackoff(
        BackoffConfig(base_delay_millis=250, max_delay_millis=8_000, jitter=False)
    )
    backoff.next_delay_millis()
    backoff.next_delay_millis()
    assert backoff.attempt == 2
    backoff.reset()
    assert backoff.attempt == 0
    assert backoff.next_delay_millis() == 250


def test_backoff_honours_the_attempt_cap() -> None:
    """Retrying forever is how an IP gets banned; the cap must be enforced."""
    backoff = ExponentialBackoff(
        BackoffConfig(base_delay_millis=10, max_attempts=3, jitter=False)
    )
    assert backoff.can_retry() is True
    for _ in range(3):
        backoff.next_delay_millis()
    assert backoff.can_retry() is False


def test_backoff_multiplier_extends_the_delay_for_severe_errors() -> None:
    backoff = ExponentialBackoff(
        BackoffConfig(base_delay_millis=100, max_delay_millis=100_000, jitter=False)
    )
    assert backoff.peek_delay_millis(multiplier=1.0) == 100
    assert backoff.peek_delay_millis(multiplier=6.0) == 600


def test_peek_does_not_advance_the_attempt_counter() -> None:
    backoff = ExponentialBackoff(BackoffConfig(base_delay_millis=100, jitter=False))
    assert backoff.peek_delay_millis() == backoff.peek_delay_millis()
    assert backoff.attempt == 0


# ----------------------------------------------------------------------
# Error taxonomy
# ----------------------------------------------------------------------
def test_every_error_category_has_a_retry_policy() -> None:
    """An unmapped category would fall through to undefined retry behaviour."""
    for category in ExchangeErrorCategory:
        assert category in RETRY_POLICIES, f"{category.value} has no retry policy"


def test_authentication_errors_are_not_retryable() -> None:
    """Bad credentials do not become good by trying again.

    Retrying an auth failure just locks the key out faster.
    """
    error = NormalisedExchangeError(
        category=ExchangeErrorCategory.AUTHENTICATION_ERROR,
        message="Invalid API key.",
        exchange="binance",
    )
    assert error.is_retryable is False


def test_invalid_request_errors_are_not_retryable() -> None:
    error = NormalisedExchangeError(
        category=ExchangeErrorCategory.INVALID_REQUEST,
        message="Bad symbol.",
        exchange="binance",
    )
    assert error.is_retryable is False


def test_network_and_rate_limit_errors_are_retryable() -> None:
    for category in (
        ExchangeErrorCategory.NETWORK_ERROR,
        ExchangeErrorCategory.RATE_LIMIT_ERROR,
        ExchangeErrorCategory.TIMEOUT,
    ):
        error = NormalisedExchangeError(
            category=category, message="transient", exchange="binance"
        )
        assert error.is_retryable is True, category.value


def test_rate_limit_backoff_is_more_patient_than_network_backoff() -> None:
    """A 429 needs a longer pause than a dropped socket."""
    network = RETRY_POLICIES[ExchangeErrorCategory.NETWORK_ERROR]
    rate_limited = RETRY_POLICIES[ExchangeErrorCategory.RATE_LIMIT_ERROR]
    assert rate_limited.backoff_multiplier > network.backoff_multiplier


def test_sequence_errors_require_resync() -> None:
    error = NormalisedExchangeError(
        category=ExchangeErrorCategory.SEQUENCE_ERROR,
        message="gap detected",
        exchange="binance",
    )
    assert error.requires_resync is True


@pytest.mark.parametrize(
    "key",
    [
        "apiKey",
        "api_secret",
        "signature",
        "Authorization",
        "password",
        "token",
        "privateKey",
    ],
)
def test_metadata_scrubbing_removes_credential_fields(key: str) -> None:
    """Error metadata reaches the logs, so it must never carry secrets."""
    scrubbed = scrub_metadata({key: "super-secret-value", "symbol": "BTCUSDT"})
    assert scrubbed[key] == _REDACTED
    assert "super-secret-value" not in str(scrubbed)
    assert scrubbed["symbol"] == "BTCUSDT"


def test_scrubbing_is_applied_automatically_on_construction() -> None:
    error = NormalisedExchangeError(
        category=ExchangeErrorCategory.AUTHENTICATION_ERROR,
        message="rejected",
        exchange="binance",
        metadata={"apiKey": "AKIAmnotreal", "httpStatus": 401},
    )
    assert error.metadata["apiKey"] == _REDACTED
    assert "AKIAmnotreal" not in str(error.to_log_fields())


def test_scrubbing_recurses_into_nested_metadata() -> None:
    scrubbed = scrub_metadata(
        {"request": {"headers": {"X-MBX-APIKEY": "leak-me"}}, "ok": 1}
    )
    assert "leak-me" not in str(scrubbed)


# ----------------------------------------------------------------------
# Connection state machine
# ----------------------------------------------------------------------
def test_legal_connection_transitions() -> None:
    assert is_legal_connection_transition(
        ConnectionState.DISCONNECTED, ConnectionState.CONNECTING
    )
    assert is_legal_connection_transition(
        ConnectionState.CONNECTING, ConnectionState.CONNECTED
    )
    assert is_legal_connection_transition(
        ConnectionState.CONNECTED, ConnectionState.DISCONNECTED
    )
    assert is_legal_connection_transition(
        ConnectionState.RECONNECTING, ConnectionState.CONNECTED
    )


def test_illegal_connection_transitions_are_rejected() -> None:
    """Skipping CONNECTING would let a socket appear connected without one."""
    assert not is_legal_connection_transition(
        ConnectionState.DISCONNECTED, ConnectionState.CONNECTED
    )


def test_stopped_is_terminal() -> None:
    """Once stopped, a manager must never silently come back to life."""
    for target in ConnectionState:
        if target is ConnectionState.STOPPED:
            continue
        assert not is_legal_connection_transition(ConnectionState.STOPPED, target)


def test_invalid_transition_exception_names_both_states() -> None:
    exc = InvalidConnectionTransition(
        "market-data", ConnectionState.DISCONNECTED, ConnectionState.CONNECTED
    )
    assert "DISCONNECTED" in str(exc)
    assert "CONNECTED" in str(exc)
    assert exc.connection_name == "market-data"


# ----------------------------------------------------------------------
# Health
# ----------------------------------------------------------------------
def test_health_is_unhealthy_when_stale_even_if_connected() -> None:
    """An open socket delivering nothing is not healthy.

    This is the failure that quietly breaks trading systems: the connection
    looks fine and the data is an hour old.
    """
    health = ConnectionHealth(
        exchange="binance",
        connection_name="depth",
        state=ConnectionState.CONNECTED,
        connected_at=BASE_TS,
        last_message_at=BASE_TS,
        is_stale=True,
    )
    assert health.is_connected is True
    assert health.is_healthy is False


def test_health_is_healthy_when_connected_and_fresh() -> None:
    health = ConnectionHealth(
        exchange="binance",
        connection_name="depth",
        state=ConnectionState.CONNECTED,
        connected_at=BASE_TS,
        last_message_at=BASE_TS,
        is_stale=False,
    )
    assert health.is_healthy is True


def test_health_log_fields_carry_no_credentials() -> None:
    health = ConnectionHealth(
        exchange="binance",
        connection_name="depth",
        state=ConnectionState.CONNECTED,
        last_error_message="Invalid API key supplied.",
    )
    rendered = str(health.to_log_fields()).lower()
    for fragment in ("secret", "apikey=", "password", "token="):
        assert fragment not in rendered


def test_latency_stats_track_a_running_maximum() -> None:
    stats = LatencyStats().with_ping(1_000).with_ping(5_000).with_ping(2_000)
    assert stats.max_ping_rtt_micros == 5_000
    assert stats.last_ping_rtt_micros == 2_000


# ----------------------------------------------------------------------
# Rate limiting
# ----------------------------------------------------------------------
def test_weighted_limiter_admits_within_budget() -> None:
    limiter = WeightedRateLimiter(RateLimitRule("REQUEST_WEIGHT", 100, 60))
    decision = limiter.try_acquire(40, now_micros=BASE_TS)
    assert decision.allowed is True
    assert decision.remaining == 60


def test_weighted_limiter_counts_weight_not_requests() -> None:
    """Ten heavy calls can exceed a budget that a hundred light ones would not.

    Counting requests instead of weight is the classic way to get IP-banned
    while the request counter still looks healthy.
    """
    limiter = WeightedRateLimiter(RateLimitRule("REQUEST_WEIGHT", 100, 60))
    for _ in range(4):
        assert limiter.try_acquire(25, now_micros=BASE_TS).allowed is True
    assert limiter.try_acquire(1, now_micros=BASE_TS).allowed is False


def test_refused_acquisition_consumes_nothing() -> None:
    """A rejected attempt must not leak budget, or refusals become permanent."""
    limiter = WeightedRateLimiter(RateLimitRule("REQUEST_WEIGHT", 10, 60))
    limiter.try_acquire(8, now_micros=BASE_TS)
    before = limiter.consumed(now_micros=BASE_TS)
    assert limiter.try_acquire(5, now_micros=BASE_TS).allowed is False
    assert limiter.consumed(now_micros=BASE_TS) == before


def test_sliding_window_frees_budget_as_entries_age_out() -> None:
    limiter = WeightedRateLimiter(RateLimitRule("REQUEST_WEIGHT", 10, 60))
    assert limiter.try_acquire(10, now_micros=BASE_TS).allowed is True
    assert limiter.try_acquire(1, now_micros=BASE_TS + 30 * MICROS_PER_SECOND).allowed is False
    later = BASE_TS + 61 * MICROS_PER_SECOND
    assert limiter.try_acquire(10, now_micros=later).allowed is True


def test_refusal_reports_a_usable_retry_hint() -> None:
    limiter = WeightedRateLimiter(RateLimitRule("REQUEST_WEIGHT", 10, 60))
    limiter.try_acquire(10, now_micros=BASE_TS)
    decision = limiter.try_acquire(5, now_micros=BASE_TS + 10 * MICROS_PER_SECOND)
    assert decision.allowed is False
    # The window entry expires 60s after it was made, i.e. 50s from now.
    assert 49_000 <= decision.retry_after_millis <= 50_000


def test_registry_all_or_nothing_does_not_partially_consume() -> None:
    """If any budget refuses, none may be deducted."""
    registry = RateLimitRegistry.from_rules(
        (RateLimitRule("REQUEST_WEIGHT", 100, 60), RateLimitRule("RAW_REQUESTS", 2, 60))
    )
    assert registry.try_acquire_all(
        {"REQUEST_WEIGHT": 10, "RAW_REQUESTS": 1}, now_micros=BASE_TS
    )[0] is True
    assert registry.try_acquire_all(
        {"REQUEST_WEIGHT": 10, "RAW_REQUESTS": 1}, now_micros=BASE_TS
    )[0] is True

    weight_before = registry.get("REQUEST_WEIGHT").consumed(now_micros=BASE_TS)
    allowed, _ = registry.try_acquire_all(
        {"REQUEST_WEIGHT": 10, "RAW_REQUESTS": 1}, now_micros=BASE_TS
    )
    assert allowed is False
    assert registry.get("REQUEST_WEIGHT").consumed(now_micros=BASE_TS) == weight_before


def test_registry_raises_on_an_unknown_rule() -> None:
    registry = RateLimitRegistry.from_rules((RateLimitRule("REQUEST_WEIGHT", 10, 60),))
    with pytest.raises(KeyError):
        registry.try_acquire("NOPE", 1, now_micros=BASE_TS)


def test_request_larger_than_capacity_is_refused_not_hung() -> None:
    limiter = WeightedRateLimiter(RateLimitRule("REQUEST_WEIGHT", 10, 60))
    decision = limiter.try_acquire(50, now_micros=BASE_TS)
    assert decision.allowed is False
    assert decision.retry_after_millis > 0


def test_registry_snapshot_reports_utilisation() -> None:
    registry = RateLimitRegistry.from_rules((RateLimitRule("REQUEST_WEIGHT", 100, 60),))
    registry.try_acquire("REQUEST_WEIGHT", 25, now_micros=BASE_TS)
    snapshot = registry.snapshot(now_micros=BASE_TS)
    assert snapshot["REQUEST_WEIGHT"]["consumed"] == 25
    assert snapshot["REQUEST_WEIGHT"]["remaining"] == 75
```

---
