-- Existing applications keep the v1 contract they were created against. A pin
-- never silently follows "latest"; a deliberate verified change is required.
ALTER TABLE "developer_applications"
  ADD COLUMN "pinned_api_version" VARCHAR(16) NOT NULL DEFAULT 'v1';
ALTER TABLE "developer_applications"
  ADD CONSTRAINT "developer_application_version_format"
  CHECK ("pinned_api_version" ~ '^v[0-9]+$');
