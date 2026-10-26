-- # Durable referral-abuse decisions and tenant-scoped manual-review queue.
CREATE TABLE "partner_referral_abuse_reviews" (
    "id" VARCHAR(64) NOT NULL,
    "tenant_id" UUID NOT NULL,
    "partner_id" VARCHAR(64) NOT NULL,
    "referrer_user_id" VARCHAR(64) NOT NULL,
    "referred_user_id" VARCHAR(64) NOT NULL,
    "referrer_device_hash" VARCHAR(128),
    "referred_device_hash" VARCHAR(128),
    "referrer_ip_hash" VARCHAR(128),
    "referred_ip_hash" VARCHAR(128),
    "idempotency_key" VARCHAR(255) NOT NULL,
    "risk_score" INTEGER NOT NULL,
    "reasons" JSONB NOT NULL,
    "velocity_counts" JSONB NOT NULL,
    "decision" VARCHAR(32) NOT NULL,
    "state" VARCHAR(32) NOT NULL,
    "reviewer_user_id" VARCHAR(64),
    "resolution_note" VARCHAR(1000),
    "reviewed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "partner_referral_abuse_reviews_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "partner_referral_abuse_reviews_risk_score_check" CHECK ("risk_score" BETWEEN 0 AND 100),
    CONSTRAINT "partner_referral_abuse_reviews_decision_check" CHECK ("decision" IN ('ALLOW', 'REVIEW', 'REFUSE')),
    CONSTRAINT "partner_referral_abuse_reviews_state_check" CHECK ("state" IN ('ALLOWED', 'BLOCKED', 'REVIEW_REQUIRED', 'REVIEW_APPROVED', 'REVIEW_REJECTED'))
);

CREATE UNIQUE INDEX "partner_referral_abuse_reviews_tenant_id_idempotency_key_key"
    ON "partner_referral_abuse_reviews" ("tenant_id", "idempotency_key");
CREATE INDEX "partner_referral_abuse_reviews_tenant_id_state_risk_score_created_at_idx"
    ON "partner_referral_abuse_reviews" ("tenant_id", "state", "risk_score", "created_at");
CREATE INDEX "partner_referral_abuse_reviews_tenant_id_partner_id_referrer_user_id_created_at_idx"
    ON "partner_referral_abuse_reviews" ("tenant_id", "partner_id", "referrer_user_id", "created_at");
CREATE INDEX "partner_referral_abuse_reviews_tenant_id_referrer_device_hash_created_at_idx"
    ON "partner_referral_abuse_reviews" ("tenant_id", "referrer_device_hash", "created_at");
CREATE INDEX "partner_referral_abuse_reviews_tenant_id_referred_device_hash_created_at_idx"
    ON "partner_referral_abuse_reviews" ("tenant_id", "referred_device_hash", "created_at");
CREATE INDEX "partner_referral_abuse_reviews_tenant_id_referrer_ip_hash_created_at_idx"
    ON "partner_referral_abuse_reviews" ("tenant_id", "referrer_ip_hash", "created_at");
CREATE INDEX "partner_referral_abuse_reviews_tenant_id_referred_ip_hash_created_at_idx"
    ON "partner_referral_abuse_reviews" ("tenant_id", "referred_ip_hash", "created_at");
