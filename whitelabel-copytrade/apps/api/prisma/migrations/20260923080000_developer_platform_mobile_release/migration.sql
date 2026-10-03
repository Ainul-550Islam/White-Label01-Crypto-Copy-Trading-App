-- Developer platform and mobile release tables.
--
-- WHY THIS MIGRATION EXISTS. schema.prisma declares eleven MobileRelease* models
-- (apps/api/src/modules/mobile-release) and eight Developer* models
-- (apps/api/src/modules/developer-platform), and no earlier migration created
-- their tables or the twelve Mobile* enums. The row-level-security migration
-- that follows (20260923090000_part11_row_level_security) already issued
-- CREATE POLICY for the mobile tables, so a fresh `prisma migrate deploy`
-- stopped there with 42P01 undefined_table; without this file the services in
-- both modules query tables that do not exist.
--
-- The stamp sits deliberately BEFORE the RLS migration: policies can only be
-- created on tables that exist, and the RLS generator
-- (scripts/gen_part11_rls.py) emits one policy per covered tenant table.
--
-- Generated with `prisma migrate diff --from-url <database migrated through
-- 20260922120000_plan_catalog_tables> --to-schema-datamodel prisma/schema.prisma
-- --script` and kept verbatim. The single ALTER on "plans" aligns the column
-- default with `@default(now()) @updatedAt` declared in schema.prisma.

-- CreateEnum
CREATE TYPE "MobilePlatform" AS ENUM ('ANDROID', 'IOS');

-- CreateEnum
CREATE TYPE "MobileEnvironment" AS ENUM ('DEVELOPMENT', 'STAGING', 'PRODUCTION');

-- CreateEnum
CREATE TYPE "MobileApplicationState" AS ENUM ('PROVISIONING', 'CONFIGURED', 'READY_FOR_BUILD', 'BUILDING', 'BUILD_FAILED', 'BUILT', 'SIGNING', 'SIGNED', 'SECURITY_REVIEW', 'READY_FOR_RELEASE', 'ACTIVE', 'SUSPENDED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "MobileBuildState" AS ENUM ('QUEUED', 'VALIDATING', 'BUILDING', 'FAILED', 'BUILT', 'VERIFYING', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "MobileSigningState" AS ENUM ('NOT_CONFIGURED', 'PENDING', 'SIGNED', 'FAILED', 'SIGNING_UNAVAILABLE');

-- CreateEnum
CREATE TYPE "MobileSecurityScanState" AS ENUM ('NOT_RUN', 'RUNNING', 'PASSED', 'FINDINGS', 'BLOCKED', 'FAILED');

-- CreateEnum
CREATE TYPE "MobileReleaseState" AS ENUM ('DRAFT', 'REVIEW', 'APPROVAL_REQUIRED', 'APPROVED', 'SUBMITTING', 'SUBMITTED', 'PUBLISHED', 'ROLLED_OUT', 'HALTED', 'ROLLED_BACK', 'REJECTED');

-- CreateEnum
CREATE TYPE "MobileRolloutState" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'HALTED', 'COMPLETED', 'ABORTED');

-- CreateEnum
CREATE TYPE "MobileStoreProvider" AS ENUM ('GOOGLE_PLAY', 'APPLE_APP_STORE', 'ENTERPRISE_DISTRIBUTION', 'INTERNAL_DISTRIBUTION');

-- CreateEnum
CREATE TYPE "MobileStoreState" AS ENUM ('NOT_CONFIGURED', 'CONFIGURED', 'SUBMISSION_PENDING', 'SUBMITTED', 'PUBLISHED', 'REJECTED', 'UNAVAILABLE');

-- CreateEnum
CREATE TYPE "MobileApprovalDecision" AS ENUM ('APPROVED', 'REJECTED', 'REWORK');

-- CreateEnum
CREATE TYPE "MobileReconciliationSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- AlterTable
ALTER TABLE "plans" ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "mobile_applications" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "partner_id" UUID,
    "slug" VARCHAR(63) NOT NULL,
    "display_name" VARCHAR(64) NOT NULL,
    "description" VARCHAR(500),
    "state" "MobileApplicationState" NOT NULL DEFAULT 'PROVISIONING',
    "android_package_id" VARCHAR(120),
    "ios_bundle_id" VARCHAR(160),
    "branding_snapshot" JSONB NOT NULL DEFAULT '{}',
    "runtime_config" JSONB NOT NULL DEFAULT '{}',
    "marketing_version" VARCHAR(32),
    "android_version_code" INTEGER,
    "ios_build_number" INTEGER,
    "idempotency_key" VARCHAR(128) NOT NULL,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "mobile_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mobile_builds" (
    "id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "platform" "MobilePlatform" NOT NULL,
    "environment" "MobileEnvironment" NOT NULL,
    "build_mode" VARCHAR(16) NOT NULL DEFAULT 'release',
    "state" "MobileBuildState" NOT NULL DEFAULT 'QUEUED',
    "version_name" VARCHAR(32) NOT NULL,
    "version_code" INTEGER NOT NULL,
    "ios_build_number" INTEGER,
    "commit_sha" VARCHAR(40),
    "toolchain_version" VARCHAR(64),
    "runner_reference" VARCHAR(255),
    "log_reference" VARCHAR(500),
    "failure_code" VARCHAR(64),
    "failure_detail" VARCHAR(500),
    "idempotency_key" VARCHAR(128) NOT NULL,
    "requested_by_id" UUID,
    "started_at" TIMESTAMPTZ(6),
    "finished_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "mobile_builds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mobile_artifacts" (
    "id" UUID NOT NULL,
    "build_id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "platform" "MobilePlatform" NOT NULL,
    "environment" "MobileEnvironment" NOT NULL,
    "version_name" VARCHAR(32) NOT NULL,
    "version_code" INTEGER NOT NULL,
    "ios_build_number" INTEGER,
    "commit_sha" VARCHAR(40) NOT NULL,
    "sha256" VARCHAR(64) NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "storage_reference" VARCHAR(500) NOT NULL,
    "signing_state" "MobileSigningState" NOT NULL DEFAULT 'NOT_CONFIGURED',
    "signing_reference" VARCHAR(255),
    "signature_verified" BOOLEAN NOT NULL DEFAULT false,
    "security_scan_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mobile_artifacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mobile_security_scans" (
    "id" UUID NOT NULL,
    "artifact_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "state" "MobileSecurityScanState" NOT NULL DEFAULT 'NOT_RUN',
    "scanner_version" VARCHAR(64) NOT NULL DEFAULT 'builtin-1',
    "findings" JSONB NOT NULL DEFAULT '[]',
    "blocking_count" INTEGER NOT NULL DEFAULT 0,
    "ran_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mobile_security_scans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mobile_releases" (
    "id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "artifact_id" UUID NOT NULL,
    "platform" "MobilePlatform" NOT NULL,
    "environment" "MobileEnvironment" NOT NULL,
    "version_name" VARCHAR(32) NOT NULL,
    "version_code" INTEGER NOT NULL,
    "ios_build_number" INTEGER,
    "release_notes" VARCHAR(2000),
    "state" "MobileReleaseState" NOT NULL DEFAULT 'DRAFT',
    "submitted_at" TIMESTAMPTZ(6),
    "published_at" TIMESTAMPTZ(6),
    "rolled_out_at" TIMESTAMPTZ(6),
    "halted_at" TIMESTAMPTZ(6),
    "halt_reason" VARCHAR(255),
    "rolled_back_at" TIMESTAMPTZ(6),
    "rejected_at" TIMESTAMPTZ(6),
    "reject_reason" VARCHAR(500),
    "idempotency_key" VARCHAR(128) NOT NULL,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "mobile_releases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mobile_release_approvals" (
    "id" UUID NOT NULL,
    "release_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "decision" "MobileApprovalDecision" NOT NULL,
    "approver_id" UUID NOT NULL,
    "approver_role" VARCHAR(64) NOT NULL,
    "platform_approval" BOOLEAN NOT NULL DEFAULT false,
    "reason" VARCHAR(500),
    "policy_version" VARCHAR(64) NOT NULL,
    "decided_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mobile_release_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mobile_release_rollouts" (
    "id" UUID NOT NULL,
    "release_id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "track" VARCHAR(32) NOT NULL DEFAULT 'production',
    "state" "MobileRolloutState" NOT NULL DEFAULT 'NOT_STARTED',
    "stage_percentage" INTEGER NOT NULL DEFAULT 0,
    "observed_percentage" INTEGER,
    "halt_reason" VARCHAR(255),
    "evidence" JSONB NOT NULL DEFAULT '[]',
    "idempotency_key" VARCHAR(128) NOT NULL,
    "started_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "halted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "mobile_release_rollouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mobile_store_submissions" (
    "id" UUID NOT NULL,
    "release_id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "provider" "MobileStoreProvider" NOT NULL,
    "state" "MobileStoreState" NOT NULL DEFAULT 'NOT_CONFIGURED',
    "credential_reference" VARCHAR(255),
    "track" VARCHAR(64),
    "external_submission_id" VARCHAR(255),
    "evidence" JSONB NOT NULL DEFAULT '{}',
    "submitted_at" TIMESTAMPTZ(6),
    "published_at" TIMESTAMPTZ(6),
    "rejected_at" TIMESTAMPTZ(6),
    "last_checked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "mobile_store_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mobile_crash_events" (
    "id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "platform" "MobilePlatform" NOT NULL,
    "release_id" UUID,
    "artifact_id" UUID,
    "version_name" VARCHAR(32) NOT NULL,
    "build_number" INTEGER NOT NULL,
    "fingerprint" VARCHAR(64) NOT NULL,
    "exception_type" VARCHAR(255),
    "signal" VARCHAR(32),
    "source" VARCHAR(64) NOT NULL,
    "occurrence_count" INTEGER NOT NULL DEFAULT 1,
    "affected_installations" INTEGER,
    "idempotency_key" VARCHAR(128) NOT NULL,
    "first_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "mobile_crash_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mobile_release_audits" (
    "id" UUID NOT NULL,
    "tenant_id" UUID,
    "application_id" UUID,
    "build_id" UUID,
    "artifact_id" UUID,
    "release_id" UUID,
    "actor_id" UUID,
    "actor_type" VARCHAR(32) NOT NULL DEFAULT 'USER',
    "actor_role" VARCHAR(64),
    "action" VARCHAR(64) NOT NULL,
    "environment" VARCHAR(16),
    "platform" VARCHAR(16),
    "version" VARCHAR(32),
    "commit_sha" VARCHAR(40),
    "artifact_sha256" VARCHAR(64),
    "correlation_id" VARCHAR(64) NOT NULL,
    "evidence" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mobile_release_audits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mobile_reconciliation_findings" (
    "id" UUID NOT NULL,
    "run_id" VARCHAR(64) NOT NULL,
    "tenant_id" UUID,
    "code" VARCHAR(64) NOT NULL,
    "severity" "MobileReconciliationSeverity" NOT NULL DEFAULT 'WARNING',
    "subject_type" VARCHAR(64) NOT NULL,
    "subject_id" VARCHAR(64) NOT NULL,
    "detail" JSONB NOT NULL DEFAULT '{}',
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mobile_reconciliation_findings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "developer_applications" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "partner_id" TEXT,
    "name" VARCHAR(120) NOT NULL,
    "description" VARCHAR(2000) NOT NULL,
    "client_id" VARCHAR(48) NOT NULL,
    "state" VARCHAR(32) NOT NULL,
    "environment" VARCHAR(16) NOT NULL,
    "redirect_uris" TEXT[],
    "scopes" TEXT[],
    "home_page_url" VARCHAR(255),
    "natural_key" VARCHAR(64) NOT NULL,
    "idempotency_key" VARCHAR(48) NOT NULL,
    "created_by_actor_id" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "developer_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "developer_credentials" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "label" VARCHAR(120) NOT NULL,
    "kind" VARCHAR(24) NOT NULL,
    "key_id" VARCHAR(64) NOT NULL,
    "secret_hash" VARCHAR(128) NOT NULL,
    "scopes" TEXT[],
    "expires_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "rotated_from_key_id" VARCHAR(64),
    "created_by_actor_id" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "developer_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "developer_oauth_grants" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "state" VARCHAR(32) NOT NULL,
    "redirect_uri" VARCHAR(512) NOT NULL,
    "requested_scopes" TEXT[],
    "consented_scopes" TEXT[],
    "code_challenge" VARCHAR(128),
    "code_challenge_method" VARCHAR(16),
    "nonce" VARCHAR(128),
    "state_parameter" VARCHAR(128) NOT NULL,
    "idempotency_key" VARCHAR(48) NOT NULL,
    "code_hash" VARCHAR(128),
    "code_expires_at" TIMESTAMPTZ(6),
    "code_redeemed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "developer_oauth_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "developer_access_tokens" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "grant_id" UUID NOT NULL,
    "token_hash" VARCHAR(128) NOT NULL,
    "scopes" TEXT[],
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "developer_access_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "developer_webhook_subscriptions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "endpoint_url" VARCHAR(512) NOT NULL,
    "event_types" TEXT[],
    "event_version" VARCHAR(16) NOT NULL DEFAULT 'v1',
    "environment" VARCHAR(16) NOT NULL,
    "description" VARCHAR(200),
    "state" VARCHAR(16) NOT NULL,
    "secret_hash" VARCHAR(128) NOT NULL,
    "secret_encrypted" TEXT NOT NULL,
    "idempotency_key" VARCHAR(48) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "created_by_actor_id" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "developer_webhook_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "developer_webhook_deliveries" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "subscription_id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "event_id" VARCHAR(48) NOT NULL,
    "event_type" VARCHAR(64) NOT NULL,
    "event_version" VARCHAR(16) NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "state" VARCHAR(24) NOT NULL,
    "outcome_class" VARCHAR(40),
    "response_status" INTEGER,
    "duration_ms" INTEGER,
    "next_retry_at" TIMESTAMPTZ(6),
    "correlation_id" VARCHAR(64) NOT NULL,
    "environment" VARCHAR(16) NOT NULL,
    "replay_of_delivery_id" UUID,
    "idempotency_key" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "developer_webhook_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "developer_event_subscriptions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "subscription_id" UUID NOT NULL,
    "resource_type" VARCHAR(48) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "developer_event_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "developer_audit" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "application_id" UUID,
    "actor_type" VARCHAR(16) NOT NULL,
    "actor_id" VARCHAR(64) NOT NULL,
    "correlation_id" VARCHAR(64) NOT NULL,
    "action" VARCHAR(64) NOT NULL,
    "detail" JSONB NOT NULL DEFAULT '{}',
    "sequence" INTEGER NOT NULL,
    "previous_hash" VARCHAR(64) NOT NULL,
    "chain_hash" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "developer_audit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "mobile_applications_android_package_id_key" ON "mobile_applications"("android_package_id");

-- CreateIndex
CREATE UNIQUE INDEX "mobile_applications_ios_bundle_id_key" ON "mobile_applications"("ios_bundle_id");

-- CreateIndex
CREATE UNIQUE INDEX "mobile_applications_idempotency_key_key" ON "mobile_applications"("idempotency_key");

-- CreateIndex
CREATE INDEX "mobile_applications_tenant_id_state_idx" ON "mobile_applications"("tenant_id", "state");

-- CreateIndex
CREATE UNIQUE INDEX "mobile_applications_tenant_id_slug_key" ON "mobile_applications"("tenant_id", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "mobile_builds_idempotency_key_key" ON "mobile_builds"("idempotency_key");

-- CreateIndex
CREATE INDEX "mobile_builds_tenant_id_state_idx" ON "mobile_builds"("tenant_id", "state");

-- CreateIndex
CREATE INDEX "mobile_builds_application_id_created_at_idx" ON "mobile_builds"("application_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "mobile_builds_application_id_platform_environment_version_n_key" ON "mobile_builds"("application_id", "platform", "environment", "version_name", "version_code");

-- CreateIndex
CREATE UNIQUE INDEX "mobile_artifacts_build_id_key" ON "mobile_artifacts"("build_id");

-- CreateIndex
CREATE INDEX "mobile_artifacts_tenant_id_idx" ON "mobile_artifacts"("tenant_id");

-- CreateIndex
CREATE INDEX "mobile_artifacts_application_id_platform_environment_idx" ON "mobile_artifacts"("application_id", "platform", "environment");

-- CreateIndex
CREATE INDEX "mobile_security_scans_artifact_id_idx" ON "mobile_security_scans"("artifact_id");

-- CreateIndex
CREATE UNIQUE INDEX "mobile_releases_artifact_id_key" ON "mobile_releases"("artifact_id");

-- CreateIndex
CREATE UNIQUE INDEX "mobile_releases_idempotency_key_key" ON "mobile_releases"("idempotency_key");

-- CreateIndex
CREATE INDEX "mobile_releases_tenant_id_state_idx" ON "mobile_releases"("tenant_id", "state");

-- CreateIndex
CREATE INDEX "mobile_releases_application_id_created_at_idx" ON "mobile_releases"("application_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "mobile_releases_application_id_platform_environment_version_key" ON "mobile_releases"("application_id", "platform", "environment", "version_name", "version_code");

-- CreateIndex
CREATE INDEX "mobile_release_approvals_release_id_idx" ON "mobile_release_approvals"("release_id");

-- CreateIndex
CREATE UNIQUE INDEX "mobile_release_rollouts_idempotency_key_key" ON "mobile_release_rollouts"("idempotency_key");

-- CreateIndex
CREATE INDEX "mobile_release_rollouts_release_id_idx" ON "mobile_release_rollouts"("release_id");

-- CreateIndex
CREATE INDEX "mobile_release_rollouts_tenant_id_state_idx" ON "mobile_release_rollouts"("tenant_id", "state");

-- CreateIndex
CREATE INDEX "mobile_store_submissions_tenant_id_idx" ON "mobile_store_submissions"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "mobile_store_submissions_release_id_provider_key" ON "mobile_store_submissions"("release_id", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "mobile_crash_events_idempotency_key_key" ON "mobile_crash_events"("idempotency_key");

-- CreateIndex
CREATE INDEX "mobile_crash_events_release_id_idx" ON "mobile_crash_events"("release_id");

-- CreateIndex
CREATE INDEX "mobile_crash_events_application_id_platform_last_seen_at_idx" ON "mobile_crash_events"("application_id", "platform", "last_seen_at");

-- CreateIndex
CREATE INDEX "mobile_release_audits_tenant_id_created_at_idx" ON "mobile_release_audits"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "mobile_release_audits_application_id_created_at_idx" ON "mobile_release_audits"("application_id", "created_at");

-- CreateIndex
CREATE INDEX "mobile_release_audits_release_id_idx" ON "mobile_release_audits"("release_id");

-- CreateIndex
CREATE INDEX "mobile_reconciliation_findings_run_id_idx" ON "mobile_reconciliation_findings"("run_id");

-- CreateIndex
CREATE UNIQUE INDEX "mobile_reconciliation_findings_run_id_code_subject_id_key" ON "mobile_reconciliation_findings"("run_id", "code", "subject_id");

-- CreateIndex
CREATE UNIQUE INDEX "developer_applications_client_id_key" ON "developer_applications"("client_id");

-- CreateIndex
CREATE UNIQUE INDEX "developer_applications_idempotency_key_key" ON "developer_applications"("idempotency_key");

-- CreateIndex
CREATE INDEX "developer_applications_tenant_id_state_idx" ON "developer_applications"("tenant_id", "state");

-- CreateIndex
CREATE INDEX "developer_applications_tenant_id_created_at_idx" ON "developer_applications"("tenant_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "developer_credentials_key_id_key" ON "developer_credentials"("key_id");

-- CreateIndex
CREATE INDEX "developer_credentials_tenant_id_application_id_idx" ON "developer_credentials"("tenant_id", "application_id");

-- CreateIndex
CREATE INDEX "developer_credentials_application_id_revoked_at_idx" ON "developer_credentials"("application_id", "revoked_at");

-- CreateIndex
CREATE UNIQUE INDEX "developer_oauth_grants_idempotency_key_key" ON "developer_oauth_grants"("idempotency_key");

-- CreateIndex
CREATE INDEX "developer_oauth_grants_tenant_id_application_id_state_idx" ON "developer_oauth_grants"("tenant_id", "application_id", "state");

-- CreateIndex
CREATE INDEX "developer_oauth_grants_application_id_code_hash_idx" ON "developer_oauth_grants"("application_id", "code_hash");

-- CreateIndex
CREATE UNIQUE INDEX "developer_access_tokens_token_hash_key" ON "developer_access_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "developer_access_tokens_application_id_revoked_at_idx" ON "developer_access_tokens"("application_id", "revoked_at");

-- CreateIndex
CREATE UNIQUE INDEX "developer_webhook_subscriptions_idempotency_key_key" ON "developer_webhook_subscriptions"("idempotency_key");

-- CreateIndex
CREATE INDEX "developer_webhook_subscriptions_tenant_id_state_idx" ON "developer_webhook_subscriptions"("tenant_id", "state");

-- CreateIndex
CREATE INDEX "developer_webhook_subscriptions_application_id_revoked_at_idx" ON "developer_webhook_subscriptions"("application_id", "revoked_at");

-- CreateIndex
CREATE UNIQUE INDEX "developer_webhook_deliveries_idempotency_key_key" ON "developer_webhook_deliveries"("idempotency_key");

-- CreateIndex
CREATE INDEX "developer_webhook_deliveries_tenant_id_state_idx" ON "developer_webhook_deliveries"("tenant_id", "state");

-- CreateIndex
CREATE INDEX "developer_webhook_deliveries_subscription_id_created_at_idx" ON "developer_webhook_deliveries"("subscription_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "developer_webhook_deliveries_subscription_id_event_id_attem_key" ON "developer_webhook_deliveries"("subscription_id", "event_id", "attempt");

-- CreateIndex
CREATE INDEX "developer_event_subscriptions_tenant_id_idx" ON "developer_event_subscriptions"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "developer_event_subscriptions_subscription_id_resource_type_key" ON "developer_event_subscriptions"("subscription_id", "resource_type");

-- CreateIndex
CREATE INDEX "developer_audit_tenant_id_application_id_idx" ON "developer_audit"("tenant_id", "application_id");

-- CreateIndex
CREATE INDEX "developer_audit_tenant_id_action_idx" ON "developer_audit"("tenant_id", "action");

-- CreateIndex
CREATE UNIQUE INDEX "developer_audit_tenant_id_sequence_key" ON "developer_audit"("tenant_id", "sequence");

-- AddForeignKey
ALTER TABLE "mobile_applications" ADD CONSTRAINT "mobile_applications_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mobile_builds" ADD CONSTRAINT "mobile_builds_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "mobile_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mobile_artifacts" ADD CONSTRAINT "mobile_artifacts_build_id_fkey" FOREIGN KEY ("build_id") REFERENCES "mobile_builds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mobile_security_scans" ADD CONSTRAINT "mobile_security_scans_artifact_id_fkey" FOREIGN KEY ("artifact_id") REFERENCES "mobile_artifacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mobile_releases" ADD CONSTRAINT "mobile_releases_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "mobile_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mobile_release_approvals" ADD CONSTRAINT "mobile_release_approvals_release_id_fkey" FOREIGN KEY ("release_id") REFERENCES "mobile_releases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mobile_release_rollouts" ADD CONSTRAINT "mobile_release_rollouts_release_id_fkey" FOREIGN KEY ("release_id") REFERENCES "mobile_releases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mobile_store_submissions" ADD CONSTRAINT "mobile_store_submissions_release_id_fkey" FOREIGN KEY ("release_id") REFERENCES "mobile_releases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mobile_crash_events" ADD CONSTRAINT "mobile_crash_events_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "mobile_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "developer_applications" ADD CONSTRAINT "developer_applications_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "developer_credentials" ADD CONSTRAINT "developer_credentials_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "developer_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "developer_oauth_grants" ADD CONSTRAINT "developer_oauth_grants_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "developer_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "developer_access_tokens" ADD CONSTRAINT "developer_access_tokens_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "developer_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "developer_access_tokens" ADD CONSTRAINT "developer_access_tokens_grant_id_fkey" FOREIGN KEY ("grant_id") REFERENCES "developer_oauth_grants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "developer_webhook_subscriptions" ADD CONSTRAINT "developer_webhook_subscriptions_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "developer_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "developer_webhook_deliveries" ADD CONSTRAINT "developer_webhook_deliveries_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "developer_webhook_subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "developer_event_subscriptions" ADD CONSTRAINT "developer_event_subscriptions_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "developer_webhook_subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
