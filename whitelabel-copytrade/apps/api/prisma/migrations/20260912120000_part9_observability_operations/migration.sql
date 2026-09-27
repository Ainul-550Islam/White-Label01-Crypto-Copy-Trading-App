-- Part 9: observability & operations.
--
-- Generated with `prisma migrate diff --from-schema-datamodel
-- prisma/.tmp_pre_part9.prisma --to-schema-datamodel apps/api/prisma/schema.prisma
-- --script` (the pre-Part-9 datamodel reconstructed from docs/source, so the
-- diff is the exact delta Part 9 introduces) and reviewed to be strictly
-- additive: four CREATE TYPE, three CREATE TABLE, two nullable ADD COLUMN on
-- audit_logs, and CREATE INDEX/ADD CONSTRAINT only. Nothing drops, renames,
-- or rewrites: the destructive-statement grep over this body returns zero hits.
--
-- Enum caveat, carried forward from Part 8 because it still applies:
-- PostgreSQL forbids *using* a newly added enum label in the same transaction
-- that adds it. Every statement here consumes only freshly created types, so
-- the whole file runs inside Prisma's transaction on PostgreSQL 12+.
--
-- Operational note for readers of the tables: ops_alerts rows are FOLDED by
-- dedupe key, so occurrence counts live in `occurrences` and the row set
-- stays bounded no matter how loud a condition gets. Unresolved rows are
-- never pruned; see ALERT_RETENTION_DAYS handling in the maintenance
-- processor for what "retention" is allowed to touch.

-- CreateEnum
CREATE TYPE "OpsAlertSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL', 'EMERGENCY');

-- CreateEnum
CREATE TYPE "OpsAlertState" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "OpsIncidentStatus" AS ENUM ('OPEN', 'REVIEWING', 'CLOSED');

-- CreateEnum
CREATE TYPE "OpsIncidentLinkKind" AS ENUM ('ALERT', 'RISK_EVENT', 'AUDIT', 'ORDER', 'EXECUTION_INCIDENT', 'STRATEGY_EVENT', 'MARKET_DATA_FAULT', 'QUEUE_JOB');

-- AlterTable: correlation metadata on audit rows (nullable; existing rows keep null and no existing query changes meaning)
ALTER TABLE "audit_logs" ADD COLUMN     "correlation_id" VARCHAR(64),
ADD COLUMN     "operation_id" VARCHAR(64);

-- CreateTable
CREATE TABLE "ops_alerts" (
    "id" UUID NOT NULL,
    "dedupe_key" VARCHAR(191) NOT NULL,
    "rule_id" VARCHAR(64) NOT NULL,
    "component" VARCHAR(64) NOT NULL,
    "scope" VARCHAR(128),
    "severity" "OpsAlertSeverity" NOT NULL,
    "state" "OpsAlertState" NOT NULL DEFAULT 'OPEN',
    "title" VARCHAR(255) NOT NULL,
    "condition" VARCHAR(500) NOT NULL,
    "message" VARCHAR(500),
    "observed_value" VARCHAR(64),
    "threshold_value" VARCHAR(64),
    "occurrences" INTEGER NOT NULL DEFAULT 1,
    "first_seen_at" TIMESTAMPTZ(6) NOT NULL,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL,
    "acknowledged_by" VARCHAR(64),
    "acknowledged_at" TIMESTAMPTZ(6),
    "resolved_at" TIMESTAMPTZ(6),
    "resolution" VARCHAR(500),
    "links" JSONB,
    "tenant_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ops_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ops_incidents" (
    "id" UUID NOT NULL,
    "incident_id" VARCHAR(64) NOT NULL,
    "grouping_key" VARCHAR(191) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "status" "OpsIncidentStatus" NOT NULL DEFAULT 'OPEN',
    "severity" "OpsAlertSeverity",
    "correlation_id" VARCHAR(64),
    "operation_id" VARCHAR(64),
    "opened_at" TIMESTAMPTZ(6) NOT NULL,
    "closed_at" TIMESTAMPTZ(6),
    "close_note" VARCHAR(500),
    "tenant_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ops_incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ops_incident_links" (
    "id" UUID NOT NULL,
    "incident_id" UUID NOT NULL,
    "kind" "OpsIncidentLinkKind" NOT NULL,
    "target_id" VARCHAR(128) NOT NULL,
    "note" VARCHAR(255),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ops_incident_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ops_alerts_dedupe_key_key" ON "ops_alerts"("dedupe_key");

-- CreateIndex
CREATE INDEX "ops_alerts_state_last_seen_at_idx" ON "ops_alerts"("state", "last_seen_at");

-- CreateIndex
CREATE INDEX "ops_alerts_severity_state_idx" ON "ops_alerts"("severity", "state");

-- CreateIndex
CREATE INDEX "ops_alerts_tenant_id_last_seen_at_idx" ON "ops_alerts"("tenant_id", "last_seen_at");

-- CreateIndex
CREATE UNIQUE INDEX "ops_incidents_incident_id_key" ON "ops_incidents"("incident_id");

-- CreateIndex
CREATE UNIQUE INDEX "ops_incidents_grouping_key_key" ON "ops_incidents"("grouping_key");

-- CreateIndex
CREATE INDEX "ops_incidents_status_opened_at_idx" ON "ops_incidents"("status", "opened_at");

-- CreateIndex
CREATE INDEX "ops_incidents_correlation_id_idx" ON "ops_incidents"("correlation_id");

-- CreateIndex
CREATE UNIQUE INDEX "ops_incident_links_incident_id_kind_target_id_key" ON "ops_incident_links"("incident_id", "kind", "target_id");

-- CreateIndex
CREATE INDEX "ops_incident_links_kind_target_id_idx" ON "ops_incident_links"("kind", "target_id");

-- CreateIndex
CREATE INDEX "audit_logs_correlation_id_created_at_idx" ON "audit_logs"("correlation_id", "created_at");

-- AddForeignKey
ALTER TABLE "ops_alerts" ADD CONSTRAINT "ops_alerts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ops_incidents" ADD CONSTRAINT "ops_incidents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ops_incident_links" ADD CONSTRAINT "ops_incident_links_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "ops_incidents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
