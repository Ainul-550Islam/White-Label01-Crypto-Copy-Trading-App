-- # Responsibility: scopes partner-attribution idempotency to its tenant without changing other partner programme keys.
-- The application requires tenantId before creating an attribution. Historical
-- tenant_id NULL rows remain readable and are not backfilled to an invented tenant.
-- Existing global uniqueness guarantees the new composite index can be created
-- without data cleanup: every previously unique idempotency key is also unique
-- within its (tenant_id, idempotency_key) pair.
DROP INDEX "partner_attributions_idempotency_key_key";

CREATE UNIQUE INDEX "partner_attributions_tenant_id_idempotency_key_key"
  ON "partner_attributions" ("tenant_id", "idempotency_key");
