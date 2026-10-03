-- Domain persistence tables (audit 2026-09-29).
--
-- Thirty-five tables that service code already addressed through
-- `(prisma as any).<delegate>` while no such model existed: billing
-- (customers, ledger, invoice counters, webhook replay ledger, usage buckets,
-- fee/finance/SaaS audit, fee settlement items), governance (compliance
-- reports and their certification/delivery/validation, consent, evidence
-- packages, actions, audit, data classification/inventory, reconciliation,
-- legal holds, privacy requests/exports, retention candidates) and partners
-- (profiles, agreements, tenant relationships, referrals, attributions,
-- campaigns, commissions, settlements, payouts, users, audit).
--
-- Strictly additive: CREATE TABLE / CREATE INDEX only, no existing object is
-- altered. Ordered before 20260923090000_part11_row_level_security so the
-- regenerated tenant_isolation policies find every covered table.
-- Generated with `prisma migrate diff` from the previous schema to this one.

-- CreateTable
CREATE TABLE "billing_customers" (
    "id" VARCHAR(64) NOT NULL,
    "tenant_id" UUID NOT NULL,
    "billing_name" VARCHAR(255) NOT NULL,
    "legal_name" VARCHAR(255),
    "business_name" VARCHAR(255),
    "billing_email" VARCHAR(320) NOT NULL,
    "billing_address_line1" VARCHAR(255),
    "billing_address_line2" VARCHAR(255),
    "billing_city" VARCHAR(128),
    "billing_region" VARCHAR(128),
    "billing_postal_code" VARCHAR(32),
    "billing_country" VARCHAR(64) NOT NULL,
    "tax_id" VARCHAR(64),
    "vat_number" VARCHAR(64),
    "preferred_currency" VARCHAR(10) NOT NULL DEFAULT 'USD',
    "provider_customer_id" VARCHAR(255),
    "provider" VARCHAR(32),
    "is_business_customer" BOOLEAN NOT NULL DEFAULT false,
    "is_tax_exempt" BOOLEAN NOT NULL DEFAULT false,
    "exemption_reason" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "billing_customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_ledger_entries" (
    "id" VARCHAR(64) NOT NULL,
    "tenant_id" UUID NOT NULL,
    "account_category" VARCHAR(64) NOT NULL,
    "entry_type" VARCHAR(32) NOT NULL,
    "amount" VARCHAR(64) NOT NULL,
    "currency" VARCHAR(10) NOT NULL,
    "source_type" VARCHAR(64) NOT NULL,
    "source_id" VARCHAR(255) NOT NULL,
    "invoice_id" VARCHAR(64),
    "payment_id" VARCHAR(255),
    "refund_id" VARCHAR(255),
    "tax_id" VARCHAR(255),
    "fee_reference" VARCHAR(255),
    "idempotency_key" VARCHAR(512) NOT NULL,
    "effective_at" TIMESTAMPTZ(6) NOT NULL,
    "description" TEXT NOT NULL,
    "metadata" JSONB,
    "status" VARCHAR(32) NOT NULL DEFAULT 'POSTED',
    "created_by" VARCHAR(64),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "billing_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_counters" (
    "scope" VARCHAR(128) NOT NULL,
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "invoice_counters_pkey" PRIMARY KEY ("scope")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" VARCHAR(64) NOT NULL,
    "provider" VARCHAR(32) NOT NULL,
    "provider_event_id" VARCHAR(255) NOT NULL,
    "event_type" VARCHAR(128) NOT NULL,
    "event_category" VARCHAR(64) NOT NULL,
    "provider_payment_id" VARCHAR(255),
    "provider_checkout_id" VARCHAR(255),
    "event_hash" VARCHAR(128) NOT NULL,
    "payload" JSONB,
    "signature" VARCHAR(64),
    "processing_status" VARCHAR(32) NOT NULL,
    "processing_attempts" INTEGER NOT NULL DEFAULT 0,
    "payment_id" VARCHAR(255),
    "tenant_id" VARCHAR(64),
    "received_at" TIMESTAMPTZ(6) NOT NULL,
    "first_seen_at" TIMESTAMPTZ(6) NOT NULL,
    "processed_at" TIMESTAMPTZ(6),
    "last_processing_error" VARCHAR(1000),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usage_buckets" (
    "id" VARCHAR(64) NOT NULL,
    "tenant_id" UUID NOT NULL,
    "meter_key" VARCHAR(64) NOT NULL,
    "scope" VARCHAR(32) NOT NULL,
    "subject_id" VARCHAR(255) NOT NULL DEFAULT '',
    "window" VARCHAR(32) NOT NULL,
    "period_id" VARCHAR(255) NOT NULL,
    "period_start" TIMESTAMPTZ(6) NOT NULL,
    "period_end" TIMESTAMPTZ(6) NOT NULL,
    "total_quantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "event_count" INTEGER NOT NULL DEFAULT 0,
    "unit" VARCHAR(32) NOT NULL,
    "last_event_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "usage_buckets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_audit_logs" (
    "id" VARCHAR(64) NOT NULL,
    "tenant_id" UUID NOT NULL,
    "operation" VARCHAR(64) NOT NULL,
    "reference_id" VARCHAR(255) NOT NULL,
    "reference_type" VARCHAR(64) NOT NULL,
    "status" VARCHAR(32) NOT NULL,
    "amount" VARCHAR(64),
    "currency" VARCHAR(10),
    "metadata" JSONB,
    "actor_id" VARCHAR(64),
    "timestamp" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fee_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_audit_logs" (
    "id" VARCHAR(64) NOT NULL,
    "tenant_id" UUID NOT NULL,
    "operation" VARCHAR(64) NOT NULL,
    "reference_id" VARCHAR(255) NOT NULL,
    "reference_type" VARCHAR(64) NOT NULL,
    "status" VARCHAR(32) NOT NULL,
    "amount" VARCHAR(64),
    "currency" VARCHAR(10),
    "metadata" JSONB,
    "actor_id" VARCHAR(64),
    "actor_type" VARCHAR(32),
    "timestamp" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "finance_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_settlement_items" (
    "id" VARCHAR(64) NOT NULL,
    "settlement_id" VARCHAR(64) NOT NULL,
    "accrual_id" VARCHAR(64) NOT NULL,
    "tenant_id" UUID NOT NULL,
    "fee_type" VARCHAR(32) NOT NULL,
    "fee_amount" VARCHAR(64) NOT NULL DEFAULT '0',
    "currency" VARCHAR(10) NOT NULL,
    "status" VARCHAR(32) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "fee_settlement_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saas_audit_logs" (
    "id" VARCHAR(64) NOT NULL,
    "tenant_id" UUID NOT NULL,
    "operation" VARCHAR(64) NOT NULL,
    "actor_id" VARCHAR(64) NOT NULL,
    "actor_type" VARCHAR(32) NOT NULL DEFAULT 'USER',
    "reference_id" VARCHAR(255) NOT NULL,
    "reference_type" VARCHAR(64) NOT NULL,
    "previous_state" JSONB,
    "new_state" JSONB,
    "result" VARCHAR(32) NOT NULL DEFAULT 'SUCCESS',
    "reason" TEXT,
    "metadata" JSONB,
    "timestamp" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saas_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_reports" (
    "id" VARCHAR(64) NOT NULL,
    "tenant_id" UUID NOT NULL,
    "report_type" VARCHAR(64) NOT NULL,
    "report_version" VARCHAR(32) NOT NULL,
    "schema_version" VARCHAR(32) NOT NULL,
    "jurisdiction" VARCHAR(16) NOT NULL,
    "period_start" TIMESTAMPTZ(6) NOT NULL,
    "period_end" TIMESTAMPTZ(6) NOT NULL,
    "generated_at" TIMESTAMPTZ(6) NOT NULL,
    "data_as_of" TIMESTAMPTZ(6) NOT NULL,
    "source_references" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "methodology" TEXT NOT NULL,
    "calculation_version" VARCHAR(32) NOT NULL,
    "policy_version" VARCHAR(32) NOT NULL,
    "validation_status" VARCHAR(32) NOT NULL,
    "certification_status" VARCHAR(32) NOT NULL,
    "delivery_status" VARCHAR(32) NOT NULL,
    "state" VARCHAR(32) NOT NULL,
    "record_count" INTEGER NOT NULL DEFAULT 0,
    "file_location" TEXT,
    "file_hash" VARCHAR(128),
    "fingerprint" VARCHAR(128) NOT NULL,
    "correlation_id" VARCHAR(255) NOT NULL,
    "created_by" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "compliance_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_report_certifications" (
    "id" VARCHAR(64) NOT NULL,
    "tenant_id" UUID NOT NULL,
    "report_id" VARCHAR(64) NOT NULL,
    "state" VARCHAR(32) NOT NULL,
    "reviewer_id" VARCHAR(64),
    "reviewer_role" VARCHAR(64),
    "fingerprint" VARCHAR(128) NOT NULL,
    "validation_evidence" TEXT NOT NULL,
    "comments" TEXT,
    "correlation_id" VARCHAR(255) NOT NULL,
    "policy_version" VARCHAR(32) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "compliance_report_certifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_report_deliveries" (
    "id" VARCHAR(64) NOT NULL,
    "tenant_id" UUID NOT NULL,
    "report_id" VARCHAR(64) NOT NULL,
    "channel" VARCHAR(64) NOT NULL,
    "state" VARCHAR(32) NOT NULL,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "last_attempt_at" TIMESTAMPTZ(6),
    "delivered_at" TIMESTAMPTZ(6),
    "delivery_evidence" TEXT,
    "failure_reason" TEXT,
    "correlation_id" VARCHAR(255) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "compliance_report_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_report_validations" (
    "id" VARCHAR(64) NOT NULL,
    "tenant_id" UUID NOT NULL,
    "report_id" VARCHAR(64) NOT NULL,
    "is_valid" BOOLEAN NOT NULL,
    "validation_status" VARCHAR(32) NOT NULL,
    "errors" JSONB NOT NULL DEFAULT '[]',
    "warnings" JSONB NOT NULL DEFAULT '[]',
    "source_completeness" BOOLEAN NOT NULL,
    "reconciliation_resolved" BOOLEAN NOT NULL,
    "period_completeness" BOOLEAN NOT NULL,
    "fingerprint_valid" BOOLEAN NOT NULL,
    "source_references_checked" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "validated_at" TIMESTAMPTZ(6) NOT NULL,
    "validator" VARCHAR(64) NOT NULL,
    "correlation_id" VARCHAR(255) NOT NULL,
    "policy_version" VARCHAR(32) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "compliance_report_validations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consent_records" (
    "id" VARCHAR(64) NOT NULL,
    "tenant_id" UUID NOT NULL,
    "subject_user_id" VARCHAR(64) NOT NULL,
    "purpose" VARCHAR(128) NOT NULL,
    "version" VARCHAR(32) NOT NULL,
    "policy_reference" VARCHAR(255) NOT NULL,
    "source" VARCHAR(64) NOT NULL,
    "captured_at" TIMESTAMPTZ(6) NOT NULL,
    "withdrawn_at" TIMESTAMPTZ(6),
    "status" VARCHAR(32) NOT NULL,
    "evidence_reference" TEXT,
    "correlation_id" VARCHAR(255) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "consent_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidence_packages" (
    "id" VARCHAR(64) NOT NULL,
    "tenant_id" UUID NOT NULL,
    "case_reference" VARCHAR(255) NOT NULL,
    "evidence_type" VARCHAR(64) NOT NULL,
    "state" VARCHAR(32) NOT NULL,
    "source_records" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "source_references" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "record_count" INTEGER NOT NULL DEFAULT 0,
    "generated_at" TIMESTAMPTZ(6) NOT NULL,
    "finalized_at" TIMESTAMPTZ(6),
    "file_location" TEXT,
    "file_hash" VARCHAR(128),
    "fingerprint" VARCHAR(128) NOT NULL,
    "redaction_policy" VARCHAR(128) NOT NULL,
    "generator" VARCHAR(128) NOT NULL,
    "audit_reference" VARCHAR(255),
    "policy_version" VARCHAR(32) NOT NULL,
    "correlation_id" VARCHAR(255) NOT NULL,
    "is_immutable" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "evidence_packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "governance_actions" (
    "id" VARCHAR(64) NOT NULL,
    "tenant_id" UUID NOT NULL,
    "action_type" VARCHAR(64) NOT NULL,
    "entity_id" VARCHAR(255),
    "requested_by" VARCHAR(64) NOT NULL,
    "approved_by" VARCHAR(64),
    "state" VARCHAR(32) NOT NULL,
    "reason" TEXT,
    "correlation_id" VARCHAR(255) NOT NULL,
    "safe_params" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "governance_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "governance_audits" (
    "id" VARCHAR(64) NOT NULL,
    "tenant_id" UUID NOT NULL,
    "action_type" VARCHAR(64) NOT NULL,
    "subject_user_id" VARCHAR(64),
    "request_id" VARCHAR(64),
    "report_id" VARCHAR(64),
    "evidence_package_id" VARCHAR(64),
    "legal_hold_id" VARCHAR(64),
    "retention_candidate_id" VARCHAR(64),
    "consent_id" VARCHAR(64),
    "state" VARCHAR(32) NOT NULL,
    "result" TEXT NOT NULL,
    "reason" TEXT,
    "correlation_id" VARCHAR(255) NOT NULL,
    "created_by" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "safe_evidence" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "governance_audits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "governance_data_classifications" (
    "id" VARCHAR(64) NOT NULL,
    "tenant_id" UUID NOT NULL,
    "source_system" VARCHAR(64) NOT NULL,
    "source_table" VARCHAR(128) NOT NULL,
    "source_field" VARCHAR(128) NOT NULL,
    "data_class" VARCHAR(64) NOT NULL,
    "jurisdiction" VARCHAR(16) NOT NULL,
    "sensitivity_score" DOUBLE PRECISION NOT NULL,
    "pii_flag" BOOLEAN NOT NULL,
    "regulated_flag" BOOLEAN NOT NULL,
    "classified_at" TIMESTAMPTZ(6) NOT NULL,
    "classified_by" VARCHAR(64) NOT NULL,
    "policy_version" VARCHAR(32) NOT NULL,
    "correlation_id" VARCHAR(255) NOT NULL,

    CONSTRAINT "governance_data_classifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "governance_data_inventory" (
    "id" VARCHAR(64) NOT NULL,
    "tenant_id" UUID NOT NULL,
    "subject_user_id" VARCHAR(64),
    "source_system" VARCHAR(64) NOT NULL,
    "source_table" VARCHAR(128) NOT NULL,
    "source_id" VARCHAR(255) NOT NULL,
    "data_classes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "jurisdiction" VARCHAR(16) NOT NULL,
    "retention_start_at" TIMESTAMPTZ(6) NOT NULL,
    "location_reference" TEXT NOT NULL,
    "record_hash" VARCHAR(128) NOT NULL,
    "correlation_id" VARCHAR(255) NOT NULL,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL,
    "policy_version" VARCHAR(32) NOT NULL,

    CONSTRAINT "governance_data_inventory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "governance_reconciliations" (
    "id" VARCHAR(64) NOT NULL,
    "tenant_id" UUID NOT NULL,
    "type" VARCHAR(64) NOT NULL,
    "entity_id" VARCHAR(255) NOT NULL,
    "severity" VARCHAR(16) NOT NULL,
    "description" TEXT NOT NULL,
    "detected_at" TIMESTAMPTZ(6) NOT NULL,
    "correlation_id" VARCHAR(255) NOT NULL,
    "source_references" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "governance_reconciliations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "legal_holds" (
    "id" VARCHAR(64) NOT NULL,
    "tenant_id" UUID,
    "case_reference" VARCHAR(255) NOT NULL,
    "reason" TEXT NOT NULL,
    "state" VARCHAR(32) NOT NULL,
    "affected_data_classes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "affected_jurisdictions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "affected_subjects" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_by" VARCHAR(64) NOT NULL,
    "activated_by" VARCHAR(64),
    "released_by" VARCHAR(64),
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "activated_at" TIMESTAMPTZ(6),
    "released_at" TIMESTAMPTZ(6),
    "expires_at" TIMESTAMPTZ(6),
    "correlation_id" VARCHAR(255) NOT NULL,
    "policy_version" VARCHAR(32) NOT NULL,

    CONSTRAINT "legal_holds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "privacy_exports" (
    "id" VARCHAR(64) NOT NULL,
    "tenant_id" UUID NOT NULL,
    "request_id" VARCHAR(64) NOT NULL,
    "subject_user_id" VARCHAR(64) NOT NULL,
    "export_version" VARCHAR(32) NOT NULL,
    "data_as_of" TIMESTAMPTZ(6) NOT NULL,
    "generated_at" TIMESTAMPTZ(6) NOT NULL,
    "data_categories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "source_references" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "record_count" INTEGER NOT NULL DEFAULT 0,
    "file_location" TEXT,
    "file_hash" VARCHAR(128),
    "methodology" TEXT NOT NULL,
    "policy_version" VARCHAR(32) NOT NULL,
    "correlation_id" VARCHAR(255) NOT NULL,
    "is_deterministic" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "privacy_exports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "privacy_requests" (
    "id" VARCHAR(64) NOT NULL,
    "tenant_id" UUID NOT NULL,
    "subject_user_id" VARCHAR(64) NOT NULL,
    "subject_type" VARCHAR(16) NOT NULL,
    "request_type" VARCHAR(32) NOT NULL,
    "state" VARCHAR(32) NOT NULL,
    "jurisdiction" VARCHAR(16) NOT NULL,
    "reason" TEXT,
    "idempotency_key" VARCHAR(255) NOT NULL,
    "correlation_id" VARCHAR(255) NOT NULL,
    "requested_at" TIMESTAMPTZ(6) NOT NULL,
    "verified_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "blocked_reason" TEXT,
    "retention_block" BOOLEAN NOT NULL DEFAULT false,
    "legal_hold_block" BOOLEAN NOT NULL DEFAULT false,
    "source_references" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_by" VARCHAR(64) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "privacy_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "retention_candidates" (
    "id" VARCHAR(64) NOT NULL,
    "tenant_id" UUID NOT NULL,
    "data_class" VARCHAR(64) NOT NULL,
    "source_system" VARCHAR(64) NOT NULL,
    "source_id" VARCHAR(255) NOT NULL,
    "jurisdiction" VARCHAR(16) NOT NULL,
    "retention_start_at" TIMESTAMPTZ(6) NOT NULL,
    "retention_end_at" TIMESTAMPTZ(6) NOT NULL,
    "state" VARCHAR(32) NOT NULL,
    "eligible_action" VARCHAR(16) NOT NULL,
    "blocked_by_legal_hold" BOOLEAN NOT NULL DEFAULT false,
    "legal_hold_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "policy_version" VARCHAR(32) NOT NULL,
    "correlation_id" VARCHAR(255) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "retention_candidates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_profiles" (
    "id" VARCHAR(64) NOT NULL,
    "code" VARCHAR(64) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "legal_name" VARCHAR(255),
    "type" VARCHAR(32) NOT NULL,
    "state" VARCHAR(32) NOT NULL,
    "owner_user_id" VARCHAR(64) NOT NULL,
    "contact_email" VARCHAR(320) NOT NULL,
    "contact_name" VARCHAR(255),
    "website" VARCHAR(512),
    "country_code" VARCHAR(8),
    "tax_id" VARCHAR(64),
    "billing_email" VARCHAR(320),
    "currency" VARCHAR(10) NOT NULL,
    "idempotency_key" VARCHAR(255) NOT NULL,
    "policy_version" VARCHAR(32) NOT NULL,
    "agreement_version" VARCHAR(32),
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "activated_at" TIMESTAMPTZ(6),
    "suspended_at" TIMESTAMPTZ(6),
    "terminated_at" TIMESTAMPTZ(6),

    CONSTRAINT "partner_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_agreements" (
    "id" VARCHAR(64) NOT NULL,
    "partner_id" VARCHAR(64) NOT NULL,
    "version" INTEGER NOT NULL,
    "state" VARCHAR(32) NOT NULL,
    "commission_policy" JSONB NOT NULL,
    "pricing_rules" JSONB NOT NULL DEFAULT '[]',
    "payout_terms" JSONB NOT NULL,
    "attribution_rules" JSONB NOT NULL DEFAULT '[]',
    "effective_from" TIMESTAMPTZ(6) NOT NULL,
    "effective_to" TIMESTAMPTZ(6),
    "jurisdiction" VARCHAR(16),
    "responsibilities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "termination_clause" TEXT,
    "created_by" VARCHAR(64) NOT NULL,
    "approved_by" VARCHAR(64),
    "activated_at" TIMESTAMPTZ(6),
    "superseded_at" TIMESTAMPTZ(6),
    "terminated_at" TIMESTAMPTZ(6),
    "previous_version_id" VARCHAR(64),
    "is_immutable" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "partner_agreements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_tenant_relationships" (
    "id" VARCHAR(64) NOT NULL,
    "partner_id" VARCHAR(64) NOT NULL,
    "tenant_id" UUID,
    "relationship_type" VARCHAR(32) NOT NULL,
    "state" VARCHAR(32) NOT NULL,
    "attribution_id" VARCHAR(64),
    "campaign_id" VARCHAR(64),
    "referral_code" VARCHAR(64),
    "assigned_at" TIMESTAMPTZ(6) NOT NULL,
    "assigned_by" VARCHAR(64) NOT NULL,
    "activated_at" TIMESTAMPTZ(6),
    "terminated_at" TIMESTAMPTZ(6),
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB,
    "idempotency_key" VARCHAR(255) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "partner_tenant_relationships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_referrals" (
    "id" VARCHAR(64) NOT NULL,
    "partner_id" VARCHAR(64) NOT NULL,
    "campaign_id" VARCHAR(64),
    "code" VARCHAR(64) NOT NULL,
    "token" VARCHAR(255) NOT NULL,
    "state" VARCHAR(32) NOT NULL,
    "created_by" VARCHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(6),
    "converted_at" TIMESTAMPTZ(6),
    "converted_tenant_id" UUID,
    "max_uses" INTEGER,
    "current_uses" INTEGER NOT NULL DEFAULT 0,
    "idempotency_key" VARCHAR(255) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "partner_referrals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_attributions" (
    "id" VARCHAR(64) NOT NULL,
    "partner_id" VARCHAR(64) NOT NULL,
    "tenant_id" UUID,
    "campaign_id" VARCHAR(64),
    "referral_code" VARCHAR(64),
    "referral_token" VARCHAR(255),
    "attribution_source" VARCHAR(32) NOT NULL,
    "attribution_window_hours" INTEGER NOT NULL,
    "captured_at" TIMESTAMPTZ(6) NOT NULL,
    "effective_at" TIMESTAMPTZ(6) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "agreement_version" VARCHAR(32) NOT NULL,
    "policy_version" VARCHAR(32) NOT NULL,
    "state" VARCHAR(32) NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "idempotency_key" VARCHAR(255) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "partner_attributions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_campaigns" (
    "id" VARCHAR(64) NOT NULL,
    "partner_id" VARCHAR(64) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "code" VARCHAR(64) NOT NULL,
    "state" VARCHAR(32) NOT NULL,
    "discount_type" VARCHAR(32),
    "discount_value" VARCHAR(64),
    "discount_currency" VARCHAR(10),
    "max_uses" INTEGER,
    "current_uses" INTEGER NOT NULL DEFAULT 0,
    "allowed_plans" JSONB,
    "attribution_window_hours" INTEGER NOT NULL,
    "starts_at" TIMESTAMPTZ(6) NOT NULL,
    "ends_at" TIMESTAMPTZ(6),
    "created_by" VARCHAR(64) NOT NULL,
    "idempotency_key" VARCHAR(255) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "partner_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_commissions" (
    "id" VARCHAR(64) NOT NULL,
    "partner_id" VARCHAR(64) NOT NULL,
    "tenant_id" UUID,
    "source_payment_id" VARCHAR(255),
    "source_invoice_id" VARCHAR(255),
    "source_subscription_id" VARCHAR(255),
    "source_fee_id" VARCHAR(255),
    "source_event_id" VARCHAR(255) NOT NULL,
    "source_event_type" VARCHAR(32) NOT NULL,
    "gross_revenue" VARCHAR(64) NOT NULL,
    "discount_amount" VARCHAR(64) NOT NULL,
    "net_eligible_revenue" VARCHAR(64) NOT NULL,
    "commission_rate" VARCHAR(64) NOT NULL,
    "commission_basis" VARCHAR(32) NOT NULL,
    "commission_model" VARCHAR(32) NOT NULL,
    "commission_amount" VARCHAR(64) NOT NULL,
    "currency" VARCHAR(10) NOT NULL,
    "source_currency" VARCHAR(10) NOT NULL,
    "commission_currency" VARCHAR(10) NOT NULL,
    "fx_required" BOOLEAN NOT NULL DEFAULT false,
    "fx_rate" VARCHAR(64),
    "fx_timestamp" TIMESTAMPTZ(6),
    "fx_source" VARCHAR(64),
    "agreement_version" VARCHAR(32) NOT NULL,
    "policy_version" VARCHAR(32) NOT NULL,
    "calculation_version" VARCHAR(32) NOT NULL,
    "state" VARCHAR(32) NOT NULL,
    "settlement_id" VARCHAR(64),
    "payout_id" VARCHAR(64),
    "reversal_of_id" VARCHAR(64),
    "accrued_at" TIMESTAMPTZ(6) NOT NULL,
    "idempotency_key" VARCHAR(255) NOT NULL,
    "correlation_id" VARCHAR(255) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "partner_commissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_settlements" (
    "id" VARCHAR(64) NOT NULL,
    "partner_id" VARCHAR(64) NOT NULL,
    "period_start" TIMESTAMPTZ(6) NOT NULL,
    "period_end" TIMESTAMPTZ(6) NOT NULL,
    "currency" VARCHAR(10) NOT NULL,
    "state" VARCHAR(32) NOT NULL,
    "total_gross_revenue" VARCHAR(64) NOT NULL,
    "total_discount" VARCHAR(64) NOT NULL,
    "total_net_eligible_revenue" VARCHAR(64) NOT NULL,
    "total_commission_accrued" VARCHAR(64) NOT NULL,
    "total_commission_reversed" VARCHAR(64) NOT NULL,
    "total_commission_payable" VARCHAR(64) NOT NULL,
    "commission_count" INTEGER NOT NULL DEFAULT 0,
    "reversal_count" INTEGER NOT NULL DEFAULT 0,
    "refund_count" INTEGER NOT NULL DEFAULT 0,
    "chargeback_count" INTEGER NOT NULL DEFAULT 0,
    "fingerprint" VARCHAR(128) NOT NULL,
    "calculation_version" VARCHAR(32) NOT NULL,
    "policy_version" VARCHAR(32) NOT NULL,
    "agreement_version" VARCHAR(32) NOT NULL,
    "reconciled_at" TIMESTAMPTZ(6),
    "locked_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "payout_id" VARCHAR(64),
    "created_by" VARCHAR(64) NOT NULL,
    "idempotency_key" VARCHAR(255) NOT NULL,
    "correlation_id" VARCHAR(255) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "partner_settlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_payouts" (
    "id" VARCHAR(64) NOT NULL,
    "partner_id" VARCHAR(64) NOT NULL,
    "settlement_id" VARCHAR(64) NOT NULL,
    "amount" VARCHAR(64) NOT NULL,
    "currency" VARCHAR(10) NOT NULL,
    "state" VARCHAR(32) NOT NULL,
    "method" VARCHAR(64) NOT NULL,
    "provider_payout_id" VARCHAR(255),
    "provider_reference" VARCHAR(255),
    "failure_reason" TEXT,
    "requested_at" TIMESTAMPTZ(6) NOT NULL,
    "requested_by" VARCHAR(64) NOT NULL,
    "approved_at" TIMESTAMPTZ(6),
    "approved_by" VARCHAR(64),
    "submitted_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "failed_at" TIMESTAMPTZ(6),
    "reversed_at" TIMESTAMPTZ(6),
    "idempotency_key" VARCHAR(255) NOT NULL,
    "correlation_id" VARCHAR(255) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "partner_payouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_users" (
    "id" VARCHAR(64) NOT NULL,
    "partner_id" VARCHAR(64) NOT NULL,
    "user_id" VARCHAR(64) NOT NULL,
    "role" VARCHAR(32) NOT NULL,
    "state" VARCHAR(32) NOT NULL,
    "invited_by" VARCHAR(64) NOT NULL,
    "invited_at" TIMESTAMPTZ(6) NOT NULL,
    "activated_at" TIMESTAMPTZ(6),
    "suspended_at" TIMESTAMPTZ(6),
    "idempotency_key" VARCHAR(255) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "partner_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_audits" (
    "id" VARCHAR(64) NOT NULL,
    "partner_id" VARCHAR(64) NOT NULL,
    "tenant_id" UUID,
    "actor_id" VARCHAR(64) NOT NULL,
    "actor_role" VARCHAR(64),
    "action" VARCHAR(64) NOT NULL,
    "source" VARCHAR(64) NOT NULL,
    "correlation_id" VARCHAR(255) NOT NULL,
    "agreement_version" VARCHAR(32),
    "policy_version" VARCHAR(32),
    "timestamp" TIMESTAMPTZ(6) NOT NULL,
    "safe_evidence" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "partner_audits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "billing_customers_tenant_id_key" ON "billing_customers"("tenant_id");

-- CreateIndex
CREATE INDEX "billing_customers_provider_customer_id_idx" ON "billing_customers"("provider_customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "billing_ledger_entries_idempotency_key_key" ON "billing_ledger_entries"("idempotency_key");

-- CreateIndex
CREATE INDEX "billing_ledger_entries_tenant_id_effective_at_idx" ON "billing_ledger_entries"("tenant_id", "effective_at");

-- CreateIndex
CREATE INDEX "billing_ledger_entries_tenant_id_source_type_source_id_idx" ON "billing_ledger_entries"("tenant_id", "source_type", "source_id");

-- CreateIndex
CREATE INDEX "billing_ledger_entries_currency_effective_at_idx" ON "billing_ledger_entries"("currency", "effective_at");

-- CreateIndex
CREATE INDEX "billing_ledger_entries_invoice_id_idx" ON "billing_ledger_entries"("invoice_id");

-- CreateIndex
CREATE INDEX "webhook_events_provider_provider_event_id_created_at_idx" ON "webhook_events"("provider", "provider_event_id", "created_at");

-- CreateIndex
CREATE INDEX "webhook_events_processing_status_created_at_idx" ON "webhook_events"("processing_status", "created_at");

-- CreateIndex
CREATE INDEX "webhook_events_tenant_id_idx" ON "webhook_events"("tenant_id");

-- CreateIndex
CREATE INDEX "usage_buckets_tenant_id_period_start_idx" ON "usage_buckets"("tenant_id", "period_start");

-- CreateIndex
CREATE UNIQUE INDEX "usage_buckets_tenant_id_meter_key_scope_subject_id_period_i_key" ON "usage_buckets"("tenant_id", "meter_key", "scope", "subject_id", "period_id");

-- CreateIndex
CREATE INDEX "fee_audit_logs_tenant_id_operation_created_at_idx" ON "fee_audit_logs"("tenant_id", "operation", "created_at");

-- CreateIndex
CREATE INDEX "fee_audit_logs_tenant_id_reference_id_idx" ON "fee_audit_logs"("tenant_id", "reference_id");

-- CreateIndex
CREATE INDEX "finance_audit_logs_tenant_id_operation_created_at_idx" ON "finance_audit_logs"("tenant_id", "operation", "created_at");

-- CreateIndex
CREATE INDEX "finance_audit_logs_tenant_id_reference_id_idx" ON "finance_audit_logs"("tenant_id", "reference_id");

-- CreateIndex
CREATE INDEX "fee_settlement_items_settlement_id_created_at_idx" ON "fee_settlement_items"("settlement_id", "created_at");

-- CreateIndex
CREATE INDEX "fee_settlement_items_tenant_id_accrual_id_idx" ON "fee_settlement_items"("tenant_id", "accrual_id");

-- CreateIndex
CREATE INDEX "saas_audit_logs_tenant_id_operation_created_at_idx" ON "saas_audit_logs"("tenant_id", "operation", "created_at");

-- CreateIndex
CREATE INDEX "compliance_reports_tenant_id_generated_at_idx" ON "compliance_reports"("tenant_id", "generated_at");

-- CreateIndex
CREATE INDEX "compliance_reports_tenant_id_report_type_state_idx" ON "compliance_reports"("tenant_id", "report_type", "state");

-- CreateIndex
CREATE INDEX "compliance_report_certifications_tenant_id_report_id_create_idx" ON "compliance_report_certifications"("tenant_id", "report_id", "created_at");

-- CreateIndex
CREATE INDEX "compliance_report_deliveries_tenant_id_report_id_created_at_idx" ON "compliance_report_deliveries"("tenant_id", "report_id", "created_at");

-- CreateIndex
CREATE INDEX "compliance_report_validations_tenant_id_report_id_validated_idx" ON "compliance_report_validations"("tenant_id", "report_id", "validated_at");

-- CreateIndex
CREATE INDEX "consent_records_tenant_id_subject_user_id_captured_at_idx" ON "consent_records"("tenant_id", "subject_user_id", "captured_at");

-- CreateIndex
CREATE INDEX "consent_records_tenant_id_status_idx" ON "consent_records"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "evidence_packages_tenant_id_generated_at_idx" ON "evidence_packages"("tenant_id", "generated_at");

-- CreateIndex
CREATE INDEX "evidence_packages_tenant_id_case_reference_idx" ON "evidence_packages"("tenant_id", "case_reference");

-- CreateIndex
CREATE INDEX "governance_actions_tenant_id_created_at_idx" ON "governance_actions"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "governance_actions_tenant_id_action_type_state_idx" ON "governance_actions"("tenant_id", "action_type", "state");

-- CreateIndex
CREATE INDEX "governance_audits_tenant_id_created_at_idx" ON "governance_audits"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "governance_audits_tenant_id_action_type_idx" ON "governance_audits"("tenant_id", "action_type");

-- CreateIndex
CREATE INDEX "governance_audits_correlation_id_idx" ON "governance_audits"("correlation_id");

-- CreateIndex
CREATE INDEX "governance_data_classifications_tenant_id_classified_at_idx" ON "governance_data_classifications"("tenant_id", "classified_at");

-- CreateIndex
CREATE INDEX "governance_data_inventory_tenant_id_subject_user_id_idx" ON "governance_data_inventory"("tenant_id", "subject_user_id");

-- CreateIndex
CREATE INDEX "governance_data_inventory_tenant_id_last_seen_at_idx" ON "governance_data_inventory"("tenant_id", "last_seen_at");

-- CreateIndex
CREATE UNIQUE INDEX "governance_data_inventory_tenant_id_source_system_source_id_key" ON "governance_data_inventory"("tenant_id", "source_system", "source_id");

-- CreateIndex
CREATE INDEX "governance_reconciliations_tenant_id_detected_at_idx" ON "governance_reconciliations"("tenant_id", "detected_at");

-- CreateIndex
CREATE UNIQUE INDEX "governance_reconciliations_tenant_id_entity_id_type_key" ON "governance_reconciliations"("tenant_id", "entity_id", "type");

-- CreateIndex
CREATE INDEX "legal_holds_tenant_id_state_idx" ON "legal_holds"("tenant_id", "state");

-- CreateIndex
CREATE INDEX "legal_holds_state_created_at_idx" ON "legal_holds"("state", "created_at");

-- CreateIndex
CREATE INDEX "privacy_exports_tenant_id_request_id_generated_at_idx" ON "privacy_exports"("tenant_id", "request_id", "generated_at");

-- CreateIndex
CREATE UNIQUE INDEX "privacy_requests_idempotency_key_key" ON "privacy_requests"("idempotency_key");

-- CreateIndex
CREATE INDEX "privacy_requests_tenant_id_requested_at_idx" ON "privacy_requests"("tenant_id", "requested_at");

-- CreateIndex
CREATE INDEX "privacy_requests_tenant_id_state_idx" ON "privacy_requests"("tenant_id", "state");

-- CreateIndex
CREATE INDEX "retention_candidates_tenant_id_created_at_idx" ON "retention_candidates"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "retention_candidates_tenant_id_source_system_source_id_idx" ON "retention_candidates"("tenant_id", "source_system", "source_id");

-- CreateIndex
CREATE INDEX "retention_candidates_tenant_id_state_idx" ON "retention_candidates"("tenant_id", "state");

-- CreateIndex
CREATE UNIQUE INDEX "partner_profiles_code_key" ON "partner_profiles"("code");

-- CreateIndex
CREATE UNIQUE INDEX "partner_profiles_idempotency_key_key" ON "partner_profiles"("idempotency_key");

-- CreateIndex
CREATE INDEX "partner_profiles_state_type_idx" ON "partner_profiles"("state", "type");

-- CreateIndex
CREATE INDEX "partner_profiles_owner_user_id_idx" ON "partner_profiles"("owner_user_id");

-- CreateIndex
CREATE INDEX "partner_agreements_partner_id_state_idx" ON "partner_agreements"("partner_id", "state");

-- CreateIndex
CREATE UNIQUE INDEX "partner_agreements_partner_id_version_key" ON "partner_agreements"("partner_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "partner_tenant_relationships_idempotency_key_key" ON "partner_tenant_relationships"("idempotency_key");

-- CreateIndex
CREATE INDEX "partner_tenant_relationships_partner_id_created_at_idx" ON "partner_tenant_relationships"("partner_id", "created_at");

-- CreateIndex
CREATE INDEX "partner_tenant_relationships_tenant_id_is_primary_state_idx" ON "partner_tenant_relationships"("tenant_id", "is_primary", "state");

-- CreateIndex
CREATE UNIQUE INDEX "partner_referrals_code_key" ON "partner_referrals"("code");

-- CreateIndex
CREATE UNIQUE INDEX "partner_referrals_token_key" ON "partner_referrals"("token");

-- CreateIndex
CREATE UNIQUE INDEX "partner_referrals_idempotency_key_key" ON "partner_referrals"("idempotency_key");

-- CreateIndex
CREATE INDEX "partner_referrals_partner_id_idx" ON "partner_referrals"("partner_id");

-- CreateIndex
CREATE UNIQUE INDEX "partner_attributions_idempotency_key_key" ON "partner_attributions"("idempotency_key");

-- CreateIndex
CREATE INDEX "partner_attributions_tenant_id_is_primary_state_idx" ON "partner_attributions"("tenant_id", "is_primary", "state");

-- CreateIndex
CREATE INDEX "partner_attributions_partner_id_idx" ON "partner_attributions"("partner_id");

-- CreateIndex
CREATE UNIQUE INDEX "partner_campaigns_idempotency_key_key" ON "partner_campaigns"("idempotency_key");

-- CreateIndex
CREATE INDEX "partner_campaigns_partner_id_created_at_idx" ON "partner_campaigns"("partner_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "partner_campaigns_partner_id_code_key" ON "partner_campaigns"("partner_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "partner_commissions_idempotency_key_key" ON "partner_commissions"("idempotency_key");

-- CreateIndex
CREATE INDEX "partner_commissions_partner_id_accrued_at_idx" ON "partner_commissions"("partner_id", "accrued_at");

-- CreateIndex
CREATE INDEX "partner_commissions_partner_id_source_event_id_idx" ON "partner_commissions"("partner_id", "source_event_id");

-- CreateIndex
CREATE INDEX "partner_commissions_settlement_id_idx" ON "partner_commissions"("settlement_id");

-- CreateIndex
CREATE INDEX "partner_commissions_tenant_id_idx" ON "partner_commissions"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "partner_settlements_idempotency_key_key" ON "partner_settlements"("idempotency_key");

-- CreateIndex
CREATE INDEX "partner_settlements_partner_id_created_at_idx" ON "partner_settlements"("partner_id", "created_at");

-- CreateIndex
CREATE INDEX "partner_settlements_partner_id_fingerprint_idx" ON "partner_settlements"("partner_id", "fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "partner_payouts_idempotency_key_key" ON "partner_payouts"("idempotency_key");

-- CreateIndex
CREATE INDEX "partner_payouts_partner_id_created_at_idx" ON "partner_payouts"("partner_id", "created_at");

-- CreateIndex
CREATE INDEX "partner_payouts_settlement_id_idx" ON "partner_payouts"("settlement_id");

-- CreateIndex
CREATE UNIQUE INDEX "partner_users_idempotency_key_key" ON "partner_users"("idempotency_key");

-- CreateIndex
CREATE INDEX "partner_users_partner_id_user_id_idx" ON "partner_users"("partner_id", "user_id");

-- CreateIndex
CREATE INDEX "partner_users_user_id_state_idx" ON "partner_users"("user_id", "state");

-- CreateIndex
CREATE INDEX "partner_audits_partner_id_timestamp_idx" ON "partner_audits"("partner_id", "timestamp");

-- CreateIndex
CREATE INDEX "partner_audits_correlation_id_idx" ON "partner_audits"("correlation_id");
