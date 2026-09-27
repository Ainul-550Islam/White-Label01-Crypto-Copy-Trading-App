-- =============================================================================
-- Part 7 - historical datasets: registry, versions, files, validation, jobs
-- =============================================================================
-- Additive only. Seven new enum types, five new tables, one nullable column
-- and one index on `backtest_runs`, one foreign key per new relation. Every
-- statement is CREATE or ADD CONSTRAINT; nothing is dropped, renamed,
-- retyped or rewritten, and no existing row is touched. `backtest_runs`
-- gains a nullable `dataset_version_id`: existing Part 6 runs keep NULL and
-- keep working; new submissions in a BACKTEST_DATASET_REQUIRED deployment
-- point at an immutable version row.
--
-- These tables hold dataset METADATA - manifests, per-file digests,
-- validation verdicts, ingestion progress. Event payloads live in dataset
-- storage (local filesystem now, object storage later) and never here:
-- Postgres stays out of the replay path the same way it stays out of the
-- strategy hot path in Part 6.
--
-- What this migration does NOT create, again, is any path to a live order.
-- A dataset is frozen public market data consumed by the backtest engine;
-- no column here references an account, a venue endpoint or a credential,
-- and the paper/live paths do not read these tables at all.
-- =============================================================================

-- CreateEnum
CREATE TYPE "dataset_status" AS ENUM ('created', 'ingesting', 'validating', 'valid', 'invalid', 'quarantined', 'archived');

-- CreateEnum
CREATE TYPE "dataset_completeness" AS ENUM ('complete', 'partial', 'unknown');

-- CreateEnum
CREATE TYPE "dataset_validation_run_status" AS ENUM ('running', 'passed', 'failed', 'error');

-- CreateEnum
CREATE TYPE "dataset_ingestion_run_status" AS ENUM ('pending', 'running', 'validating', 'finalizing', 'succeeded', 'failed', 'quarantined');

-- CreateEnum
CREATE TYPE "historical_source_kind" AS ENUM ('binance_public_data', 'local_files', 'object_storage_export', 'database_export', 'stream_capture');

-- CreateEnum
CREATE TYPE "dataset_event_kind" AS ENUM ('TICKER', 'TRADE', 'BOOK_SNAPSHOT', 'BOOK_DELTA', 'CANDLE');

-- AlterTable
ALTER TABLE "backtest_runs" ADD COLUMN     "dataset_version_id" UUID;

-- CreateTable
CREATE TABLE "historical_datasets" (
    "id" UUID NOT NULL,
    "dataset_key" VARCHAR(64) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "venue" "TradingVenue" NOT NULL,
    "symbols" TEXT[],
    "market_type" "TradingMarketType" NOT NULL DEFAULT 'SPOT',
    "event_kinds" "dataset_event_kind"[],
    "granularity" VARCHAR(20),
    "start_micros" BIGINT NOT NULL,
    "end_micros" BIGINT NOT NULL,
    "status" "dataset_status" NOT NULL DEFAULT 'created',
    "latest_version" INTEGER,
    "schema_version" INTEGER NOT NULL DEFAULT 1,
    "canonical_schema_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "historical_datasets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "historical_dataset_versions" (
    "id" UUID NOT NULL,
    "dataset_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "dataset_status" NOT NULL,
    "content_checksum" VARCHAR(64) NOT NULL,
    "manifest_checksum" VARCHAR(64),
    "storage_uri" VARCHAR(500) NOT NULL,
    "compression" VARCHAR(16),
    "file_count" INTEGER NOT NULL DEFAULT 0,
    "event_count" INTEGER NOT NULL DEFAULT 0,
    "total_bytes" BIGINT NOT NULL DEFAULT 0,
    "start_micros" BIGINT NOT NULL,
    "end_micros" BIGINT NOT NULL,
    "completeness" "dataset_completeness" NOT NULL DEFAULT 'unknown',
    "source_kind" "historical_source_kind" NOT NULL,
    "source_label" VARCHAR(200) NOT NULL,
    "manifest_json" JSONB NOT NULL DEFAULT '{}',
    "quality_json" JSONB,
    "validated_at" TIMESTAMPTZ(6),
    "finalized_at" TIMESTAMPTZ(6),
    "creator_job_id" VARCHAR(80),
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "historical_dataset_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "historical_dataset_files" (
    "id" UUID NOT NULL,
    "version_id" UUID NOT NULL,
    "partition_path" VARCHAR(400) NOT NULL,
    "symbol" VARCHAR(32) NOT NULL,
    "event_kind" "dataset_event_kind" NOT NULL,
    "events" INTEGER NOT NULL,
    "bytes" BIGINT NOT NULL,
    "sha256" VARCHAR(64) NOT NULL,
    "first_ts_micros" BIGINT NOT NULL,
    "last_ts_micros" BIGINT NOT NULL,
    "compression" VARCHAR(16),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "historical_dataset_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "historical_dataset_validations" (
    "id" UUID NOT NULL,
    "version_id" UUID NOT NULL,
    "status" "dataset_validation_run_status" NOT NULL DEFAULT 'running',
    "info_count" INTEGER NOT NULL DEFAULT 0,
    "warning_count" INTEGER NOT NULL DEFAULT 0,
    "error_count" INTEGER NOT NULL DEFAULT 0,
    "fatal_count" INTEGER NOT NULL DEFAULT 0,
    "counts_by_rule" JSONB,
    "report_uri" VARCHAR(500),
    "report_sha256" VARCHAR(64),
    "policy_digest" VARCHAR(64),
    "duration_micros" BIGINT,
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(6),

    CONSTRAINT "historical_dataset_validations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dataset_ingestion_runs" (
    "id" UUID NOT NULL,
    "dataset_id" UUID,
    "dataset_key_hint" VARCHAR(64),
    "version" INTEGER,
    "status" "dataset_ingestion_run_status" NOT NULL DEFAULT 'pending',
    "stage" VARCHAR(40),
    "progress_json" JSONB NOT NULL DEFAULT '{}',
    "error_text" TEXT,
    "staging_key" VARCHAR(80) NOT NULL,
    "source_kind" "historical_source_kind" NOT NULL,
    "params_json" JSONB NOT NULL DEFAULT '{}',
    "bytes_downloaded" BIGINT NOT NULL DEFAULT 0,
    "events_written" INTEGER NOT NULL DEFAULT 0,
    "requested_by_user_id" UUID,
    "started_at" TIMESTAMPTZ(6),
    "finished_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "dataset_ingestion_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "historical_datasets_dataset_key_key" ON "historical_datasets"("dataset_key");

-- CreateIndex
CREATE INDEX "historical_datasets_venue_market_type_status_idx" ON "historical_datasets"("venue", "market_type", "status");

-- CreateIndex
CREATE INDEX "historical_datasets_status_created_at_idx" ON "historical_datasets"("status", "created_at");

-- CreateIndex
CREATE INDEX "historical_datasets_start_micros_end_micros_idx" ON "historical_datasets"("start_micros", "end_micros");

-- CreateIndex
CREATE INDEX "historical_dataset_versions_content_checksum_idx" ON "historical_dataset_versions"("content_checksum");

-- CreateIndex
CREATE INDEX "historical_dataset_versions_status_finalized_at_idx" ON "historical_dataset_versions"("status", "finalized_at");

-- CreateIndex
CREATE UNIQUE INDEX "historical_dataset_versions_dataset_id_version_key" ON "historical_dataset_versions"("dataset_id", "version");

-- CreateIndex
CREATE INDEX "historical_dataset_files_version_id_event_kind_symbol_idx" ON "historical_dataset_files"("version_id", "event_kind", "symbol");

-- CreateIndex
CREATE UNIQUE INDEX "historical_dataset_files_version_id_partition_path_key" ON "historical_dataset_files"("version_id", "partition_path");

-- CreateIndex
CREATE INDEX "historical_dataset_validations_version_id_status_idx" ON "historical_dataset_validations"("version_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "dataset_ingestion_runs_staging_key_key" ON "dataset_ingestion_runs"("staging_key");

-- CreateIndex
CREATE INDEX "dataset_ingestion_runs_status_created_at_idx" ON "dataset_ingestion_runs"("status", "created_at");

-- CreateIndex
CREATE INDEX "dataset_ingestion_runs_dataset_id_version_idx" ON "dataset_ingestion_runs"("dataset_id", "version");

-- CreateIndex
CREATE INDEX "backtest_runs_dataset_version_id_idx" ON "backtest_runs"("dataset_version_id");

-- AddForeignKey
ALTER TABLE "backtest_runs" ADD CONSTRAINT "backtest_runs_dataset_version_id_fkey" FOREIGN KEY ("dataset_version_id") REFERENCES "historical_dataset_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "historical_dataset_versions" ADD CONSTRAINT "historical_dataset_versions_dataset_id_fkey" FOREIGN KEY ("dataset_id") REFERENCES "historical_datasets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "historical_dataset_files" ADD CONSTRAINT "historical_dataset_files_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "historical_dataset_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "historical_dataset_validations" ADD CONSTRAINT "historical_dataset_validations_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "historical_dataset_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dataset_ingestion_runs" ADD CONSTRAINT "dataset_ingestion_runs_dataset_id_fkey" FOREIGN KEY ("dataset_id") REFERENCES "historical_datasets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

