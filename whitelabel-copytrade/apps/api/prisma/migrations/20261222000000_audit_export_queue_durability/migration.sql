-- A queued intent is committed before Redis is contacted. The bounded relay
-- can reconstruct an unsubmitted job after a crash or transient Redis outage.
ALTER TABLE "governance_audit_export_intents"
  ADD COLUMN "job_payload" JSONB,
  ADD COLUMN "queue_checked_at" TIMESTAMPTZ;
CREATE INDEX "governance_audit_export_job_lookup_idx"
  ON "governance_audit_export_intents" ("tenant_id", (("response"->>'id')))
  WHERE "response"->>'status' = 'QUEUED';
CREATE INDEX "governance_audit_export_pending_queue_idx"
  ON "governance_audit_export_intents" ("tenant_id", "queue_checked_at", "created_at")
  WHERE "job_payload" IS NOT NULL AND "queued_result" IS NULL;
