-- Part 10: reliability - SLO configuration versions and evaluation rows.
--
-- Generated with `prisma migrate diff --from-schema-datamodel
-- prisma/.tmp_pre_part10.prisma --to-schema-datamodel apps/api/prisma/schema.prisma
-- --script` (the pre-Part-10 datamodel reconstructed from docs/source, so the
-- diff is the exact delta Part 10 introduces) and reviewed to be strictly
-- additive: one CREATE TYPE, two CREATE TABLE, their indexes and unique
-- constraints. Nothing drops, renames, or rewrites: the destructive-statement
-- grep over this body returns zero hits.
--
-- Operational notes: slo_configuration_versions rows are append-only versioned
-- snapshots of each objective (unique (slo_id, version)); slo_evaluations is
-- an evidence log the maintenance job prunes by age within a retention floor
-- of seven days. UNKNOWN evaluations are rows, not gaps - measurement failure
-- must be distinguishable from nobody looking. Neither table is read by the
-- trading path; nothing here authorises anything.
-- CreateEnum
CREATE TYPE "SloEvaluationState" AS ENUM ('HEALTHY', 'WARNING', 'CRITICAL', 'EXHAUSTED', 'UNKNOWN');

-- CreateTable
CREATE TABLE "slo_configuration_versions" (
    "id" UUID NOT NULL,
    "slo_id" VARCHAR(64) NOT NULL,
    "version" INTEGER NOT NULL,
    "objective" VARCHAR(16) NOT NULL,
    "window_minutes" INTEGER NOT NULL,
    "short_window_minutes" INTEGER NOT NULL,
    "indicator" VARCHAR(48) NOT NULL,
    "owner" VARCHAR(64) NOT NULL,
    "description" VARCHAR(200) NOT NULL,
    "good_event" VARCHAR(200) NOT NULL,
    "bad_event" VARCHAR(200) NOT NULL,
    "warning_burn_ppm" INTEGER NOT NULL,
    "critical_burn_ppm" INTEGER NOT NULL,
    "max_age_micros" BIGINT,
    "latency_threshold_micros" BIGINT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "payload" JSONB NOT NULL,
    "checksum" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "slo_configuration_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "slo_evaluations" (
    "id" UUID NOT NULL,
    "slo_id" VARCHAR(64) NOT NULL,
    "version" INTEGER NOT NULL,
    "checksum" VARCHAR(64) NOT NULL,
    "indicator" VARCHAR(48) NOT NULL,
    "service" VARCHAR(64) NOT NULL,
    "state" "SloEvaluationState" NOT NULL,
    "evaluated_at_micros" BIGINT NOT NULL,
    "window_minutes" INTEGER NOT NULL,
    "short_window_minutes" INTEGER NOT NULL,
    "target_ppm" INTEGER NOT NULL,
    "actual_ppm" INTEGER,
    "budget_total_events" INTEGER NOT NULL DEFAULT 0,
    "budget_consumed_events" INTEGER NOT NULL DEFAULT 0,
    "budget_remaining_events" INTEGER NOT NULL DEFAULT 0,
    "remaining_ratio_ppm" INTEGER,
    "long_burn_ppm" INTEGER,
    "short_burn_ppm" INTEGER,
    "alert_kind" VARCHAR(8) NOT NULL,
    "samples_good" INTEGER NOT NULL,
    "samples_bad" INTEGER NOT NULL,
    "data_complete" BOOLEAN NOT NULL,
    "reason" VARCHAR(500),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "slo_evaluations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "slo_configuration_versions_slo_id_idx" ON "slo_configuration_versions"("slo_id");

-- CreateIndex
CREATE UNIQUE INDEX "slo_configuration_versions_slo_id_version_key" ON "slo_configuration_versions"("slo_id", "version");

-- CreateIndex
CREATE INDEX "slo_evaluations_slo_id_created_at_idx" ON "slo_evaluations"("slo_id", "created_at");

-- CreateIndex
CREATE INDEX "slo_evaluations_state_created_at_idx" ON "slo_evaluations"("state", "created_at");

