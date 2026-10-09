-- # NEW — adds persisted webhook envelope fields for faithful at-least-once delivery and replay
BEGIN;

ALTER TABLE "developer_webhook_deliveries"
    ADD COLUMN "source" VARCHAR(64),
    ADD COLUMN "occurred_at" TIMESTAMPTZ(6),
    ADD COLUMN "payload" JSONB;

UPDATE "developer_webhook_deliveries"
SET "source" = 'legacy',
    "occurred_at" = "created_at",
    "payload" = '{}'::jsonb
WHERE "source" IS NULL
   OR "occurred_at" IS NULL
   OR "payload" IS NULL;

ALTER TABLE "developer_webhook_deliveries"
    ALTER COLUMN "source" SET NOT NULL,
    ALTER COLUMN "occurred_at" SET NOT NULL,
    ALTER COLUMN "payload" SET NOT NULL;

DROP INDEX "developer_webhook_deliveries_subscription_id_event_id_attem_key";
CREATE UNIQUE INDEX "developer_webhook_deliveries_event_request_key"
    ON "developer_webhook_deliveries"("subscription_id", "event_id", "idempotency_key");
CREATE INDEX "developer_webhook_deliveries_event_attempt_idx"
    ON "developer_webhook_deliveries"("subscription_id", "event_id", "attempt");

COMMIT;
