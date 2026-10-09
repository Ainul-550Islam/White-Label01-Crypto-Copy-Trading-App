-- # Responsibility: adds tenant-scoped transactional outbox persistence and notification idempotency.
-- GAP-177: outbox rows are committed with the domain state that produced them.
-- Row-level-security policy generation is additive and follows this migration.

BEGIN;

CREATE TYPE "OutboxEventStatus" AS ENUM ('PENDING', 'PROCESSING', 'PUBLISHED', 'DEAD');

ALTER TABLE "notifications"
    ADD COLUMN "source_event_id" UUID;

CREATE UNIQUE INDEX "notifications_tenant_id_source_event_id_user_id_key"
    ON "notifications"("tenant_id", "source_event_id", "user_id");

CREATE TABLE "outbox_events" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "aggregate_type" VARCHAR(64) NOT NULL,
    "aggregate_id" VARCHAR(128) NOT NULL,
    "aggregate_sequence" INTEGER NOT NULL,
    "event_type" VARCHAR(96) NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "OutboxEventStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "available_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMPTZ(6),
    "lease_owner" VARCHAR(96),
    "lease_expires_at" TIMESTAMPTZ(6),
    "last_error_code" VARCHAR(64),
    "correlation_id" VARCHAR(64),
    "idempotency_key" VARCHAR(255) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "outbox_events_attempts_nonnegative_check" CHECK ("attempts" >= 0),
    CONSTRAINT "outbox_events_aggregate_sequence_positive_check" CHECK ("aggregate_sequence" > 0),
    CONSTRAINT "outbox_events_aggregate_type_nonempty_check" CHECK (length(btrim("aggregate_type")) > 0),
    CONSTRAINT "outbox_events_aggregate_id_nonempty_check" CHECK (length(btrim("aggregate_id")) > 0),
    CONSTRAINT "outbox_events_event_type_nonempty_check" CHECK (length(btrim("event_type")) > 0),
    CONSTRAINT "outbox_events_idempotency_key_nonempty_check" CHECK (length(btrim("idempotency_key")) > 0),
    CONSTRAINT "outbox_events_processing_lease_check"
        CHECK ("status" <> 'PROCESSING' OR ("lease_owner" IS NOT NULL AND "lease_expires_at" IS NOT NULL)),
    CONSTRAINT "outbox_events_published_timestamp_check"
        CHECK ("status" <> 'PUBLISHED' OR "published_at" IS NOT NULL),
    CONSTRAINT "outbox_events_dead_error_code_check"
        CHECK ("status" <> 'DEAD' OR "last_error_code" IS NOT NULL),
    CONSTRAINT "outbox_events_tenant_id_fkey"
        FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "outbox_events_tenant_id_idempotency_key_key"
    ON "outbox_events"("tenant_id", "idempotency_key");

CREATE UNIQUE INDEX "outbox_events_tenant_id_aggregate_type_aggregate_id_aggregate_sequence_key"
    ON "outbox_events"("tenant_id", "aggregate_type", "aggregate_id", "aggregate_sequence");

CREATE INDEX "outbox_events_tenant_id_status_available_at_created_at_idx"
    ON "outbox_events"("tenant_id", "status", "available_at", "created_at");

CREATE INDEX "outbox_events_tenant_id_aggregate_type_aggregate_id_aggregate_sequence_idx"
    ON "outbox_events"("tenant_id", "aggregate_type", "aggregate_id", "aggregate_sequence");

COMMIT;
