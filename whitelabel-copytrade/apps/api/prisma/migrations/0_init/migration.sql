-- CreateEnum
CREATE TYPE "TenantStatus" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "TenantDomainStatus" AS ENUM ('PENDING_DNS', 'PENDING_CERTIFICATE', 'ACTIVE', 'FAILED');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED', 'LOCKED', 'DEACTIVATED');

-- CreateEnum
CREATE TYPE "KycStatus" AS ENUM ('NOT_STARTED', 'PENDING', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "RoleScope" AS ENUM ('PLATFORM', 'TENANT');

-- CreateEnum
CREATE TYPE "TwoFactorMethod" AS ENUM ('TOTP', 'EMAIL', 'SMS');

-- CreateEnum
CREATE TYPE "TwoFactorStatus" AS ENUM ('PENDING_ACTIVATION', 'ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "TokenStatus" AS ENUM ('ACTIVE', 'ROTATED', 'REVOKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "AuditActorType" AS ENUM ('USER', 'SYSTEM', 'SERVICE', 'API_KEY');

-- CreateEnum
CREATE TYPE "AuditOutcome" AS ENUM ('SUCCESS', 'FAILURE', 'DENIED');

-- CreateEnum
CREATE TYPE "SecurityEventType" AS ENUM ('SUSPICIOUS_LOGIN', 'NEW_DEVICE_LOGIN', 'IMPOSSIBLE_TRAVEL', 'BRUTE_FORCE_SUSPECTED', 'CREDENTIAL_STUFFING_SUSPECTED', 'TOKEN_REUSE', 'RATE_LIMIT_ABUSE', 'PERMISSION_ESCALATION_ATTEMPT', 'TENANT_ISOLATION_VIOLATION', 'ENCRYPTION_FAILURE');

-- CreateEnum
CREATE TYPE "SecuritySeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "BillingInterval" AS ENUM ('MONTHLY', 'QUARTERLY', 'YEARLY', 'LIFETIME');

-- CreateEnum
CREATE TYPE "PlanAudience" AS ENUM ('TENANT', 'END_USER');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'EXPIRED', 'PAUSED');

-- CreateEnum
CREATE TYPE "VerificationTokenType" AS ENUM ('EMAIL_VERIFICATION', 'PASSWORD_RESET', 'INVITATION', 'EMAIL_CHANGE');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('IN_APP', 'EMAIL', 'PUSH', 'SMS', 'WEBHOOK', 'TELEGRAM');

-- CreateEnum
CREATE TYPE "TradingVenue" AS ENUM ('BINANCE', 'BYBIT', 'OKX', 'KRAKEN', 'PAPER');

-- CreateEnum
CREATE TYPE "TradingMarketType" AS ENUM ('SPOT', 'MARGIN', 'FUTURES_USDT', 'FUTURES_COIN');

-- CreateEnum
CREATE TYPE "TradingAccountStatus" AS ENUM ('PENDING_VALIDATION', 'ACTIVE', 'DISABLED', 'CREDENTIALS_INVALID', 'WITHDRAWAL_ENABLED_REJECTED');

-- CreateEnum
CREATE TYPE "TradingModeSetting" AS ENUM ('DISABLED', 'PAPER', 'LIVE');

-- CreateEnum
CREATE TYPE "StrategyStatus" AS ENUM ('DRAFT', 'ENABLED', 'DISABLED', 'ERROR');

-- CreateEnum
CREATE TYPE "OrderSideEnum" AS ENUM ('BUY', 'SELL');

-- CreateEnum
CREATE TYPE "OrderTypeEnum" AS ENUM ('MARKET', 'LIMIT', 'STOP', 'STOP_LIMIT');

-- CreateEnum
CREATE TYPE "TimeInForceEnum" AS ENUM ('GTC', 'IOC', 'FOK', 'DAY');

-- CreateEnum
CREATE TYPE "OrderStatusEnum" AS ENUM ('PENDING', 'SUBMITTED', 'ACKNOWLEDGED', 'PARTIALLY_FILLED', 'FILLED', 'CANCEL_REQUESTED', 'CANCELLED', 'REJECTED', 'EXPIRED', 'FAILED');

-- CreateEnum
CREATE TYPE "PositionSideEnum" AS ENUM ('LONG', 'SHORT', 'FLAT');

-- CreateEnum
CREATE TYPE "RiskEventType" AS ENUM ('LIMIT_BREACHED', 'ORDER_REJECTED', 'KILL_SWITCH_ENGAGED', 'KILL_SWITCH_RELEASED', 'STALE_MARKET_DATA', 'RISK_STATE_UNAVAILABLE', 'DUPLICATE_ORDER_BLOCKED', 'ORDER_BOOK_RESYNC');

-- CreateEnum
CREATE TYPE "RiskEventSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- CreateEnum
CREATE TYPE "KillSwitchScopeEnum" AS ENUM ('GLOBAL', 'EXCHANGE', 'STRATEGY', 'SYMBOL');

-- CreateEnum
CREATE TYPE "TradingSessionStatus" AS ENUM ('STARTING', 'RUNNING', 'DEGRADED', 'STOPPING', 'STOPPED', 'FAILED');

-- CreateTable
CREATE TABLE "tenants" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(63) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "legal_name" VARCHAR(160),
    "status" "TenantStatus" NOT NULL DEFAULT 'PENDING',
    "owner_user_id" UUID,
    "contact_email" VARCHAR(254),
    "contact_phone" VARCHAR(20),
    "country_code" CHAR(2),
    "default_locale" VARCHAR(8) NOT NULL DEFAULT 'en',
    "supportedLocales" TEXT[] DEFAULT ARRAY['en']::TEXT[],
    "default_currency" VARCHAR(3) NOT NULL DEFAULT 'USD',
    "supportedCurrencies" TEXT[] DEFAULT ARRAY['USD']::TEXT[],
    "timezone" VARCHAR(64) NOT NULL DEFAULT 'UTC',
    "platform_fee_bps" INTEGER NOT NULL DEFAULT 0,
    "performance_fee_bps" INTEGER NOT NULL DEFAULT 2000,
    "max_users" INTEGER,
    "max_traders" INTEGER,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_branding" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "app_name" VARCHAR(64) NOT NULL,
    "logo_url" VARCHAR(2048),
    "logo_dark_url" VARCHAR(2048),
    "favicon_url" VARCHAR(2048),
    "primary_color" VARCHAR(9) NOT NULL DEFAULT '#1B2A4A',
    "secondary_color" VARCHAR(9) NOT NULL DEFAULT '#0F172A',
    "accent_color" VARCHAR(9) NOT NULL DEFAULT '#22C55E',
    "background_color" VARCHAR(9) NOT NULL DEFAULT '#FFFFFF',
    "text_color" VARCHAR(9) NOT NULL DEFAULT '#0B1220',
    "font_family" VARCHAR(64) NOT NULL DEFAULT 'Inter',
    "theme_mode" VARCHAR(10) NOT NULL DEFAULT 'system',
    "support_email" VARCHAR(254),
    "support_url" VARCHAR(2048),
    "terms_url" VARCHAR(2048),
    "privacy_url" VARCHAR(2048),
    "custom_css" TEXT,
    "social_links" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tenant_branding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_settings" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "key" VARCHAR(64) NOT NULL,
    "value" JSONB NOT NULL,
    "category" VARCHAR(32) NOT NULL DEFAULT 'general',
    "is_secret" BOOLEAN NOT NULL DEFAULT false,
    "description" VARCHAR(240),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tenant_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_domains" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "domain" VARCHAR(253) NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "status" "TenantDomainStatus" NOT NULL DEFAULT 'PENDING_DNS',
    "verification_token" VARCHAR(64) NOT NULL,
    "verified_at" TIMESTAMPTZ(6),
    "certificate_expiry" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tenant_domains_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "email_index" VARCHAR(64) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "phone" VARCHAR(20),
    "email_verified_at" TIMESTAMPTZ(6),
    "phone_verified_at" TIMESTAMPTZ(6),
    "status" "UserStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "kyc_status" "KycStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "is_platform_user" BOOLEAN NOT NULL DEFAULT false,
    "two_factor_enabled" BOOLEAN NOT NULL DEFAULT false,
    "failed_login_attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(6),
    "last_login_at" TIMESTAMPTZ(6),
    "last_login_ip_hash" VARCHAR(64),
    "password_changed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "session_version" INTEGER NOT NULL DEFAULT 0,
    "referral_code" VARCHAR(16),
    "referred_by_code" VARCHAR(16),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_profiles" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "first_name" VARCHAR(64),
    "last_name" VARCHAR(64),
    "display_name" VARCHAR(64),
    "avatar_url" VARCHAR(2048),
    "bio" VARCHAR(500),
    "country_code" CHAR(2),
    "timezone" VARCHAR(64) NOT NULL DEFAULT 'UTC',
    "locale" VARCHAR(8) NOT NULL DEFAULT 'en',
    "preferred_currency" VARCHAR(3) NOT NULL DEFAULT 'USD',
    "marketing_opt_in" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "user_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "tenant_id" UUID,
    "key" VARCHAR(64) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" VARCHAR(500),
    "scope" "RoleScope" NOT NULL DEFAULT 'TENANT',
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" UUID NOT NULL,
    "key" VARCHAR(64) NOT NULL,
    "resource" VARCHAR(48) NOT NULL,
    "action" VARCHAR(32) NOT NULL,
    "description" VARCHAR(500),
    "is_dangerous" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "role_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id","permission_id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "assigned_by_id" UUID,
    "assigned_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6),

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "device_id" VARCHAR(128) NOT NULL,
    "device_name" VARCHAR(64),
    "platform" VARCHAR(16),
    "app_version" VARCHAR(32),
    "user_agent" VARCHAR(512),
    "ip_hash" VARCHAR(64) NOT NULL,
    "geo_label" VARCHAR(64),
    "trusted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "revoke_reason" VARCHAR(120),

    CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "token_hash" VARCHAR(128) NOT NULL,
    "family_id" UUID NOT NULL,
    "status" "TokenStatus" NOT NULL DEFAULT 'ACTIVE',
    "replaced_by_token_id" UUID,
    "issued_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "used_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "revoke_reason" VARCHAR(120),
    "ip_hash" VARCHAR(64),
    "user_agent" VARCHAR(512),

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "two_factor_auth" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "method" "TwoFactorMethod" NOT NULL DEFAULT 'TOTP',
    "status" "TwoFactorStatus" NOT NULL DEFAULT 'PENDING_ACTIVATION',
    "secret_ciphertext" JSONB NOT NULL,
    "encryption_key_id" VARCHAR(64) NOT NULL,
    "last_verified_at" TIMESTAMPTZ(6),
    "last_used_counter" BIGINT,
    "failed_attempts" INTEGER NOT NULL DEFAULT 0,
    "activated_at" TIMESTAMPTZ(6),
    "disabled_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "two_factor_auth_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "two_factor_recovery_codes" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "code_hash" VARCHAR(255) NOT NULL,
    "used_at" TIMESTAMPTZ(6),
    "used_ip_hash" VARCHAR(64),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "two_factor_recovery_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "type" "VerificationTokenType" NOT NULL,
    "token_hash" VARCHAR(128) NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "consumed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "login_attempts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID,
    "email_index" VARCHAR(64) NOT NULL,
    "successful" BOOLEAN NOT NULL,
    "reason" VARCHAR(64),
    "ip_hash" VARCHAR(64) NOT NULL,
    "user_agent" VARCHAR(512),
    "device_id" VARCHAR(128),
    "geo_label" VARCHAR(64),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID,
    "actor_type" "AuditActorType" NOT NULL DEFAULT 'USER',
    "actor_id" UUID,
    "actor_email" VARCHAR(254),
    "action" VARCHAR(64) NOT NULL,
    "outcome" "AuditOutcome" NOT NULL DEFAULT 'SUCCESS',
    "resource_type" VARCHAR(64),
    "resource_id" VARCHAR(64),
    "description" VARCHAR(500),
    "changes" JSONB,
    "metadata" JSONB,
    "ip_hash" VARCHAR(64),
    "user_agent" VARCHAR(512),
    "request_id" VARCHAR(64),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "security_events" (
    "id" UUID NOT NULL,
    "tenant_id" UUID,
    "user_id" UUID,
    "type" "SecurityEventType" NOT NULL,
    "severity" "SecuritySeverity" NOT NULL DEFAULT 'LOW',
    "description" VARCHAR(500) NOT NULL,
    "metadata" JSONB,
    "ip_hash" VARCHAR(64),
    "user_agent" VARCHAR(512),
    "request_id" VARCHAR(64),
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "resolved_at" TIMESTAMPTZ(6),
    "resolved_by_id" UUID,
    "resolution" VARCHAR(500),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "security_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_api_keys" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "key_id" VARCHAR(48) NOT NULL,
    "secret_hash" VARCHAR(128) NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "ipAllowlist" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "last_used_at" TIMESTAMPTZ(6),
    "expires_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tenant_api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_plans" (
    "id" UUID NOT NULL,
    "tenant_id" UUID,
    "code" VARCHAR(48) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" VARCHAR(500),
    "audience" "PlanAudience" NOT NULL DEFAULT 'TENANT',
    "price" DECIMAL(18,6) NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'USD',
    "interval" "BillingInterval" NOT NULL DEFAULT 'MONTHLY',
    "trial_days" INTEGER NOT NULL DEFAULT 0,
    "performance_fee_bps" INTEGER NOT NULL DEFAULT 0,
    "platform_fee_bps" INTEGER NOT NULL DEFAULT 0,
    "limits" JSONB NOT NULL DEFAULT '{}',
    "features" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "external_price_id" VARCHAR(128),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "subscription_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_subscriptions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'TRIALING',
    "current_period_start" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "current_period_end" TIMESTAMPTZ(6) NOT NULL,
    "trial_ends_at" TIMESTAMPTZ(6),
    "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
    "canceled_at" TIMESTAMPTZ(6),
    "cancel_reason" VARCHAR(500),
    "seats_purchased" INTEGER NOT NULL DEFAULT 1,
    "external_customer_id" VARCHAR(128),
    "external_subscription_id" VARCHAR(128),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tenant_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feature_flags" (
    "id" UUID NOT NULL,
    "key" VARCHAR(64) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" VARCHAR(500),
    "is_global_default" BOOLEAN NOT NULL DEFAULT false,
    "rollout_percentage" INTEGER NOT NULL DEFAULT 100,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "feature_flags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_feature_flags" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "feature_flag_id" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "rollout_percentage" INTEGER,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tenant_feature_flags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kyc_profiles" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "status" "KycStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "provider" VARCHAR(32),
    "external_applicant_id" VARCHAR(128),
    "level_name" VARCHAR(64),
    "submitted_at" TIMESTAMPTZ(6),
    "reviewed_at" TIMESTAMPTZ(6),
    "expires_at" TIMESTAMPTZ(6),
    "rejection_reason" VARCHAR(500),
    "risk_score" INTEGER,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "kyc_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "channel" "NotificationChannel" NOT NULL DEFAULT 'IN_APP',
    "type" VARCHAR(64) NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "body" VARCHAR(1000) NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "read_at" TIMESTAMPTZ(6),
    "delivered_at" TIMESTAMPTZ(6),
    "failed_at" TIMESTAMPTZ(6),
    "failure_reason" VARCHAR(500),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "category" VARCHAR(48) NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exchanges" (
    "id" UUID NOT NULL,
    "venue" "TradingVenue" NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "is_enabled" BOOLEAN NOT NULL DEFAULT false,
    "trading_enabled" BOOLEAN NOT NULL DEFAULT false,
    "supported_market_types" "TradingMarketType"[],
    "rest_base_url" VARCHAR(255) NOT NULL,
    "ws_base_url" VARCHAR(255) NOT NULL,
    "sandbox_rest_url" VARCHAR(255),
    "sandbox_ws_url" VARCHAR(255),
    "requires_passphrase" BOOLEAN NOT NULL DEFAULT false,
    "supports_sandbox" BOOLEAN NOT NULL DEFAULT false,
    "weight_limit_per_minute" INTEGER NOT NULL DEFAULT 1200,
    "max_orders_per_second" INTEGER NOT NULL DEFAULT 5,
    "max_leverage" INTEGER NOT NULL DEFAULT 1,
    "default_book_depth" INTEGER NOT NULL DEFAULT 50,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "exchanges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trading_symbols" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "exchange_id" UUID NOT NULL,
    "symbol" VARCHAR(32) NOT NULL,
    "venue_symbol" VARCHAR(32) NOT NULL,
    "base_asset" VARCHAR(16) NOT NULL,
    "quote_asset" VARCHAR(16) NOT NULL,
    "market_type" "TradingMarketType" NOT NULL DEFAULT 'SPOT',
    "is_tradeable" BOOLEAN NOT NULL DEFAULT false,
    "is_subscribed" BOOLEAN NOT NULL DEFAULT false,
    "price_tick" DECIMAL(28,12) NOT NULL,
    "quantity_step" DECIMAL(28,12) NOT NULL,
    "min_quantity" DECIMAL(28,12) NOT NULL,
    "max_quantity" DECIMAL(28,12),
    "min_notional" DECIMAL(18,6) NOT NULL,
    "price_precision" INTEGER NOT NULL DEFAULT 8,
    "quantity_precision" INTEGER NOT NULL DEFAULT 8,
    "max_order_notional" DECIMAL(18,6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "trading_symbols_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trading_accounts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "exchange_id" UUID NOT NULL,
    "user_id" UUID,
    "label" VARCHAR(80) NOT NULL,
    "status" "TradingAccountStatus" NOT NULL DEFAULT 'PENDING_VALIDATION',
    "market_type" "TradingMarketType" NOT NULL DEFAULT 'SPOT',
    "trading_mode" "TradingModeSetting" NOT NULL DEFAULT 'PAPER',
    "is_sandbox" BOOLEAN NOT NULL DEFAULT true,
    "api_key_ciphertext" TEXT NOT NULL,
    "api_secret_ciphertext" TEXT NOT NULL,
    "passphrase_ciphertext" TEXT,
    "encrypted_data_key" TEXT NOT NULL,
    "encryption_key_id" VARCHAR(64) NOT NULL,
    "api_key_blind_index" VARCHAR(64) NOT NULL,
    "api_key_last_four" VARCHAR(4) NOT NULL,
    "can_trade" BOOLEAN NOT NULL DEFAULT false,
    "can_read_data" BOOLEAN NOT NULL DEFAULT false,
    "can_withdraw" BOOLEAN NOT NULL DEFAULT false,
    "ip_restricted" BOOLEAN NOT NULL DEFAULT false,
    "last_verified_at" TIMESTAMPTZ(6),
    "last_failure_at" TIMESTAMPTZ(6),
    "last_failure_code" VARCHAR(64),
    "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "trading_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "strategies" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "account_id" UUID,
    "name" VARCHAR(80) NOT NULL,
    "kind" VARCHAR(64) NOT NULL,
    "version" VARCHAR(20) NOT NULL,
    "status" "StrategyStatus" NOT NULL DEFAULT 'DRAFT',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "venue" "TradingVenue" NOT NULL,
    "symbols" TEXT[],
    "market_type" "TradingMarketType" NOT NULL DEFAULT 'SPOT',
    "description" VARCHAR(500),
    "max_order_quantity" DECIMAL(28,12) NOT NULL,
    "max_position_quantity" DECIMAL(28,12) NOT NULL,
    "max_order_notional" DECIMAL(18,6) NOT NULL,
    "max_daily_loss" DECIMAL(18,6) NOT NULL,
    "max_open_orders" INTEGER NOT NULL DEFAULT 5,
    "max_orders_per_minute" INTEGER NOT NULL DEFAULT 30,
    "last_started_at" TIMESTAMPTZ(6),
    "last_stopped_at" TIMESTAMPTZ(6),
    "last_error_code" VARCHAR(64),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "strategies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "strategy_configurations" (
    "id" UUID NOT NULL,
    "strategy_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "parameters" JSONB NOT NULL DEFAULT '{}',
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "activated_at" TIMESTAMPTZ(6),
    "deactivated_at" TIMESTAMPTZ(6),
    "created_by_user_id" UUID,
    "change_note" VARCHAR(500),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "strategy_configurations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "strategy_id" UUID,
    "symbol_id" UUID NOT NULL,
    "client_order_id" VARCHAR(36) NOT NULL,
    "exchange_order_id" VARCHAR(64),
    "signal_id" UUID,
    "venue" "TradingVenue" NOT NULL,
    "symbol" VARCHAR(32) NOT NULL,
    "side" "OrderSideEnum" NOT NULL,
    "order_type" "OrderTypeEnum" NOT NULL,
    "time_in_force" "TimeInForceEnum" NOT NULL DEFAULT 'GTC',
    "status" "OrderStatusEnum" NOT NULL DEFAULT 'PENDING',
    "quantity" DECIMAL(28,12) NOT NULL,
    "price" DECIMAL(28,12),
    "stop_price" DECIMAL(28,12),
    "reduce_only" BOOLEAN NOT NULL DEFAULT false,
    "filled_quantity" DECIMAL(28,12) NOT NULL DEFAULT 0,
    "average_fill_price" DECIMAL(28,12),
    "cumulative_fee" DECIMAL(28,12) NOT NULL DEFAULT 0,
    "fee_currency" VARCHAR(16),
    "is_simulated" BOOLEAN NOT NULL DEFAULT false,
    "rejection_code" VARCHAR(64),
    "rejection_reason" VARCHAR(500),
    "risk_decision_id" UUID,
    "submit_latency_micros" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "submitted_at" TIMESTAMPTZ(6),
    "terminal_at" TIMESTAMPTZ(6),

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_events" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "previous_status" "OrderStatusEnum",
    "status" "OrderStatusEnum" NOT NULL,
    "reason" VARCHAR(500),
    "payload" JSONB NOT NULL DEFAULT '{}',
    "occurred_at_micros" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fills" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "venue_trade_id" VARCHAR(64) NOT NULL,
    "price" DECIMAL(28,12) NOT NULL,
    "quantity" DECIMAL(28,12) NOT NULL,
    "fee" DECIMAL(28,12) NOT NULL DEFAULT 0,
    "fee_currency" VARCHAR(16) NOT NULL DEFAULT 'USDT',
    "is_maker" BOOLEAN NOT NULL DEFAULT false,
    "is_simulated" BOOLEAN NOT NULL DEFAULT false,
    "exchange_timestamp_micros" BIGINT NOT NULL,
    "received_timestamp_micros" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "positions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "symbol_id" UUID NOT NULL,
    "venue" "TradingVenue" NOT NULL,
    "symbol" VARCHAR(32) NOT NULL,
    "quantity" DECIMAL(28,12) NOT NULL DEFAULT 0,
    "side" "PositionSideEnum" NOT NULL DEFAULT 'FLAT',
    "average_entry_price" DECIMAL(28,12),
    "mark_price" DECIMAL(28,12),
    "realised_pnl" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "unrealised_pnl" DECIMAL(18,6),
    "cumulative_fee" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "fee_currency" VARCHAR(16),
    "contains_simulated_fills" BOOLEAN NOT NULL DEFAULT false,
    "fill_count" INTEGER NOT NULL DEFAULT 0,
    "opened_at" TIMESTAMPTZ(6),
    "closed_at" TIMESTAMPTZ(6),
    "last_fill_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "positions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "risk_configurations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "max_order_quantity" DECIMAL(28,12) NOT NULL,
    "max_order_notional" DECIMAL(18,6) NOT NULL,
    "max_position_quantity" DECIMAL(28,12) NOT NULL,
    "max_symbol_exposure_notional" DECIMAL(18,6) NOT NULL,
    "max_account_exposure_notional" DECIMAL(18,6) NOT NULL,
    "max_open_orders" INTEGER NOT NULL DEFAULT 10,
    "max_orders_per_minute" INTEGER NOT NULL DEFAULT 60,
    "max_daily_loss" DECIMAL(18,6) NOT NULL,
    "max_strategy_loss" DECIMAL(18,6) NOT NULL,
    "max_price_deviation_percent" DECIMAL(8,4) NOT NULL DEFAULT 2,
    "max_market_data_age_micros" INTEGER NOT NULL DEFAULT 5000000,
    "trading_halted" BOOLEAN NOT NULL DEFAULT true,
    "halted_reason" VARCHAR(500),
    "halted_at" TIMESTAMPTZ(6),
    "updated_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "risk_configurations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "risk_events" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "account_id" UUID,
    "strategy_id" UUID,
    "order_id" UUID,
    "event_type" "RiskEventType" NOT NULL,
    "severity" "RiskEventSeverity" NOT NULL DEFAULT 'WARNING',
    "code" VARCHAR(64) NOT NULL,
    "message" VARCHAR(1000) NOT NULL,
    "limit_value" VARCHAR(64),
    "observed_value" VARCHAR(64),
    "venue" "TradingVenue",
    "symbol" VARCHAR(32),
    "risk_decision_id" UUID,
    "correlation_id" UUID,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "risk_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kill_switches" (
    "id" UUID NOT NULL,
    "tenant_id" UUID,
    "scope" "KillSwitchScopeEnum" NOT NULL,
    "target" VARCHAR(64),
    "is_engaged" BOOLEAN NOT NULL DEFAULT false,
    "reason" VARCHAR(500),
    "engaged_by_user_id" UUID,
    "engaged_at" TIMESTAMPTZ(6),
    "released_by_user_id" UUID,
    "released_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "kill_switches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trading_sessions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "account_id" UUID,
    "strategy_id" UUID,
    "status" "TradingSessionStatus" NOT NULL DEFAULT 'STARTING',
    "trading_mode" "TradingModeSetting" NOT NULL,
    "worker_id" VARCHAR(128) NOT NULL,
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMPTZ(6),
    "heartbeat_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "signals_generated" INTEGER NOT NULL DEFAULT 0,
    "orders_requested" INTEGER NOT NULL DEFAULT 0,
    "orders_submitted" INTEGER NOT NULL DEFAULT 0,
    "orders_filled" INTEGER NOT NULL DEFAULT 0,
    "orders_rejected" INTEGER NOT NULL DEFAULT 0,
    "risk_rejections" INTEGER NOT NULL DEFAULT 0,
    "book_resyncs" INTEGER NOT NULL DEFAULT 0,
    "median_decision_latency_micros" INTEGER,
    "p99_decision_latency_micros" INTEGER,
    "stop_reason" VARCHAR(500),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "trading_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "market_data_records" (
    "id" UUID NOT NULL,
    "symbol_id" UUID NOT NULL,
    "venue" "TradingVenue" NOT NULL,
    "symbol" VARCHAR(32) NOT NULL,
    "interval" VARCHAR(8) NOT NULL,
    "open_time" TIMESTAMPTZ(6) NOT NULL,
    "close_time" TIMESTAMPTZ(6) NOT NULL,
    "open" DECIMAL(28,12) NOT NULL,
    "high" DECIMAL(28,12) NOT NULL,
    "low" DECIMAL(28,12) NOT NULL,
    "close" DECIMAL(28,12) NOT NULL,
    "volume" DECIMAL(28,12) NOT NULL,
    "quote_volume" DECIMAL(28,12),
    "trade_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "market_data_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateIndex
CREATE INDEX "tenants_status_idx" ON "tenants"("status");

-- CreateIndex
CREATE INDEX "tenants_deleted_at_idx" ON "tenants"("deleted_at");

-- CreateIndex
CREATE INDEX "tenants_created_at_idx" ON "tenants"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_branding_tenant_id_key" ON "tenant_branding"("tenant_id");

-- CreateIndex
CREATE INDEX "tenant_settings_tenant_id_category_idx" ON "tenant_settings"("tenant_id", "category");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_settings_tenant_id_key_key" ON "tenant_settings"("tenant_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_domains_domain_key" ON "tenant_domains"("domain");

-- CreateIndex
CREATE INDEX "tenant_domains_tenant_id_is_primary_idx" ON "tenant_domains"("tenant_id", "is_primary");

-- CreateIndex
CREATE INDEX "tenant_domains_status_idx" ON "tenant_domains"("status");

-- CreateIndex
CREATE UNIQUE INDEX "users_referral_code_key" ON "users"("referral_code");

-- CreateIndex
CREATE INDEX "users_tenant_id_status_idx" ON "users"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "users_tenant_id_created_at_idx" ON "users"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "users_tenant_id_deleted_at_idx" ON "users"("tenant_id", "deleted_at");

-- CreateIndex
CREATE INDEX "users_email_index_idx" ON "users"("email_index");

-- CreateIndex
CREATE UNIQUE INDEX "users_tenant_id_email_key" ON "users"("tenant_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "users_tenant_id_email_index_key" ON "users"("tenant_id", "email_index");

-- CreateIndex
CREATE UNIQUE INDEX "user_profiles_user_id_key" ON "user_profiles"("user_id");

-- CreateIndex
CREATE INDEX "roles_tenant_id_scope_idx" ON "roles"("tenant_id", "scope");

-- CreateIndex
CREATE INDEX "roles_is_system_idx" ON "roles"("is_system");

-- CreateIndex
CREATE UNIQUE INDEX "roles_tenant_id_key_key" ON "roles"("tenant_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_key_key" ON "permissions"("key");

-- CreateIndex
CREATE INDEX "permissions_resource_idx" ON "permissions"("resource");

-- CreateIndex
CREATE INDEX "role_permissions_permission_id_idx" ON "role_permissions"("permission_id");

-- CreateIndex
CREATE INDEX "user_roles_tenant_id_role_id_idx" ON "user_roles"("tenant_id", "role_id");

-- CreateIndex
CREATE INDEX "user_roles_user_id_idx" ON "user_roles"("user_id");

-- CreateIndex
CREATE INDEX "user_roles_expires_at_idx" ON "user_roles"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "user_roles_user_id_role_id_key" ON "user_roles"("user_id", "role_id");

-- CreateIndex
CREATE INDEX "user_sessions_user_id_revoked_at_idx" ON "user_sessions"("user_id", "revoked_at");

-- CreateIndex
CREATE INDEX "user_sessions_tenant_id_user_id_idx" ON "user_sessions"("tenant_id", "user_id");

-- CreateIndex
CREATE INDEX "user_sessions_expires_at_idx" ON "user_sessions"("expires_at");

-- CreateIndex
CREATE INDEX "user_sessions_device_id_idx" ON "user_sessions"("device_id");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_status_idx" ON "refresh_tokens"("user_id", "status");

-- CreateIndex
CREATE INDEX "refresh_tokens_family_id_idx" ON "refresh_tokens"("family_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_expires_at_idx" ON "refresh_tokens"("expires_at");

-- CreateIndex
CREATE INDEX "refresh_tokens_tenant_id_user_id_idx" ON "refresh_tokens"("tenant_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "two_factor_auth_user_id_key" ON "two_factor_auth"("user_id");

-- CreateIndex
CREATE INDEX "two_factor_recovery_codes_user_id_used_at_idx" ON "two_factor_recovery_codes"("user_id", "used_at");

-- CreateIndex
CREATE UNIQUE INDEX "verification_tokens_token_hash_key" ON "verification_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "verification_tokens_user_id_type_idx" ON "verification_tokens"("user_id", "type");

-- CreateIndex
CREATE INDEX "verification_tokens_expires_at_idx" ON "verification_tokens"("expires_at");

-- CreateIndex
CREATE INDEX "login_attempts_tenant_id_email_index_created_at_idx" ON "login_attempts"("tenant_id", "email_index", "created_at");

-- CreateIndex
CREATE INDEX "login_attempts_ip_hash_created_at_idx" ON "login_attempts"("ip_hash", "created_at");

-- CreateIndex
CREATE INDEX "login_attempts_created_at_idx" ON "login_attempts"("created_at");

-- CreateIndex
CREATE INDEX "audit_logs_tenant_id_created_at_idx" ON "audit_logs"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_tenant_id_action_created_at_idx" ON "audit_logs"("tenant_id", "action", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_actor_id_created_at_idx" ON "audit_logs"("actor_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_resource_type_resource_id_idx" ON "audit_logs"("resource_type", "resource_id");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- CreateIndex
CREATE INDEX "security_events_tenant_id_created_at_idx" ON "security_events"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "security_events_user_id_created_at_idx" ON "security_events"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "security_events_severity_resolved_idx" ON "security_events"("severity", "resolved");

-- CreateIndex
CREATE INDEX "security_events_type_created_at_idx" ON "security_events"("type", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_api_keys_key_id_key" ON "tenant_api_keys"("key_id");

-- CreateIndex
CREATE INDEX "tenant_api_keys_tenant_id_revoked_at_idx" ON "tenant_api_keys"("tenant_id", "revoked_at");

-- CreateIndex
CREATE INDEX "subscription_plans_audience_is_active_idx" ON "subscription_plans"("audience", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_plans_tenant_id_code_key" ON "subscription_plans"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "tenant_subscriptions_tenant_id_status_idx" ON "tenant_subscriptions"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "tenant_subscriptions_status_current_period_end_idx" ON "tenant_subscriptions"("status", "current_period_end");

-- CreateIndex
CREATE UNIQUE INDEX "feature_flags_key_key" ON "feature_flags"("key");

-- CreateIndex
CREATE INDEX "tenant_feature_flags_tenant_id_enabled_idx" ON "tenant_feature_flags"("tenant_id", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_feature_flags_tenant_id_feature_flag_id_key" ON "tenant_feature_flags"("tenant_id", "feature_flag_id");

-- CreateIndex
CREATE UNIQUE INDEX "kyc_profiles_user_id_key" ON "kyc_profiles"("user_id");

-- CreateIndex
CREATE INDEX "kyc_profiles_tenant_id_status_idx" ON "kyc_profiles"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "notifications_tenant_id_user_id_created_at_idx" ON "notifications"("tenant_id", "user_id", "created_at");

-- CreateIndex
CREATE INDEX "notifications_user_id_read_at_idx" ON "notifications"("user_id", "read_at");

-- CreateIndex
CREATE UNIQUE INDEX "notification_preferences_user_id_category_channel_key" ON "notification_preferences"("user_id", "category", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "exchanges_venue_key" ON "exchanges"("venue");

-- CreateIndex
CREATE INDEX "exchanges_is_enabled_idx" ON "exchanges"("is_enabled");

-- CreateIndex
CREATE INDEX "trading_symbols_tenant_id_is_tradeable_idx" ON "trading_symbols"("tenant_id", "is_tradeable");

-- CreateIndex
CREATE INDEX "trading_symbols_tenant_id_is_subscribed_idx" ON "trading_symbols"("tenant_id", "is_subscribed");

-- CreateIndex
CREATE INDEX "trading_symbols_exchange_id_symbol_idx" ON "trading_symbols"("exchange_id", "symbol");

-- CreateIndex
CREATE UNIQUE INDEX "trading_symbols_tenant_id_exchange_id_symbol_market_type_key" ON "trading_symbols"("tenant_id", "exchange_id", "symbol", "market_type");

-- CreateIndex
CREATE INDEX "trading_accounts_tenant_id_status_idx" ON "trading_accounts"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "trading_accounts_tenant_id_user_id_idx" ON "trading_accounts"("tenant_id", "user_id");

-- CreateIndex
CREATE INDEX "trading_accounts_exchange_id_idx" ON "trading_accounts"("exchange_id");

-- CreateIndex
CREATE INDEX "trading_accounts_deleted_at_idx" ON "trading_accounts"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "trading_accounts_tenant_id_api_key_blind_index_key" ON "trading_accounts"("tenant_id", "api_key_blind_index");

-- CreateIndex
CREATE INDEX "strategies_tenant_id_enabled_idx" ON "strategies"("tenant_id", "enabled");

-- CreateIndex
CREATE INDEX "strategies_tenant_id_status_idx" ON "strategies"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "strategies_tenant_id_account_id_idx" ON "strategies"("tenant_id", "account_id");

-- CreateIndex
CREATE INDEX "strategies_deleted_at_idx" ON "strategies"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "strategies_tenant_id_name_key" ON "strategies"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "strategy_configurations_strategy_id_is_active_idx" ON "strategy_configurations"("strategy_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "strategy_configurations_strategy_id_version_key" ON "strategy_configurations"("strategy_id", "version");

-- CreateIndex
CREATE INDEX "orders_tenant_id_status_created_at_idx" ON "orders"("tenant_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "orders_tenant_id_account_id_created_at_idx" ON "orders"("tenant_id", "account_id", "created_at");

-- CreateIndex
CREATE INDEX "orders_tenant_id_strategy_id_created_at_idx" ON "orders"("tenant_id", "strategy_id", "created_at");

-- CreateIndex
CREATE INDEX "orders_tenant_id_symbol_created_at_idx" ON "orders"("tenant_id", "symbol", "created_at");

-- CreateIndex
CREATE INDEX "orders_exchange_order_id_idx" ON "orders"("exchange_order_id");

-- CreateIndex
CREATE INDEX "orders_created_at_idx" ON "orders"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "orders_tenant_id_client_order_id_key" ON "orders"("tenant_id", "client_order_id");

-- CreateIndex
CREATE INDEX "order_events_order_id_occurred_at_micros_idx" ON "order_events"("order_id", "occurred_at_micros");

-- CreateIndex
CREATE INDEX "order_events_created_at_idx" ON "order_events"("created_at");

-- CreateIndex
CREATE INDEX "fills_order_id_received_timestamp_micros_idx" ON "fills"("order_id", "received_timestamp_micros");

-- CreateIndex
CREATE INDEX "fills_created_at_idx" ON "fills"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "fills_order_id_venue_trade_id_key" ON "fills"("order_id", "venue_trade_id");

-- CreateIndex
CREATE INDEX "positions_tenant_id_account_id_idx" ON "positions"("tenant_id", "account_id");

-- CreateIndex
CREATE INDEX "positions_tenant_id_symbol_idx" ON "positions"("tenant_id", "symbol");

-- CreateIndex
CREATE INDEX "positions_tenant_id_side_idx" ON "positions"("tenant_id", "side");

-- CreateIndex
CREATE UNIQUE INDEX "positions_account_id_symbol_id_key" ON "positions"("account_id", "symbol_id");

-- CreateIndex
CREATE UNIQUE INDEX "risk_configurations_account_id_key" ON "risk_configurations"("account_id");

-- CreateIndex
CREATE INDEX "risk_configurations_tenant_id_idx" ON "risk_configurations"("tenant_id");

-- CreateIndex
CREATE INDEX "risk_events_tenant_id_created_at_idx" ON "risk_events"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "risk_events_tenant_id_event_type_created_at_idx" ON "risk_events"("tenant_id", "event_type", "created_at");

-- CreateIndex
CREATE INDEX "risk_events_tenant_id_severity_created_at_idx" ON "risk_events"("tenant_id", "severity", "created_at");

-- CreateIndex
CREATE INDEX "risk_events_tenant_id_account_id_created_at_idx" ON "risk_events"("tenant_id", "account_id", "created_at");

-- CreateIndex
CREATE INDEX "risk_events_order_id_idx" ON "risk_events"("order_id");

-- CreateIndex
CREATE INDEX "kill_switches_tenant_id_scope_is_engaged_idx" ON "kill_switches"("tenant_id", "scope", "is_engaged");

-- CreateIndex
CREATE INDEX "kill_switches_scope_is_engaged_idx" ON "kill_switches"("scope", "is_engaged");

-- CreateIndex
CREATE INDEX "trading_sessions_tenant_id_status_started_at_idx" ON "trading_sessions"("tenant_id", "status", "started_at");

-- CreateIndex
CREATE INDEX "trading_sessions_tenant_id_strategy_id_started_at_idx" ON "trading_sessions"("tenant_id", "strategy_id", "started_at");

-- CreateIndex
CREATE INDEX "trading_sessions_heartbeat_at_idx" ON "trading_sessions"("heartbeat_at");

-- CreateIndex
CREATE INDEX "market_data_records_venue_symbol_interval_open_time_idx" ON "market_data_records"("venue", "symbol", "interval", "open_time");

-- CreateIndex
CREATE INDEX "market_data_records_open_time_idx" ON "market_data_records"("open_time");

-- CreateIndex
CREATE UNIQUE INDEX "market_data_records_symbol_id_interval_open_time_key" ON "market_data_records"("symbol_id", "interval", "open_time");

-- AddForeignKey
ALTER TABLE "tenant_branding" ADD CONSTRAINT "tenant_branding_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_settings" ADD CONSTRAINT "tenant_settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_domains" ADD CONSTRAINT "tenant_domains_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_assigned_by_id_fkey" FOREIGN KEY ("assigned_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "user_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "two_factor_auth" ADD CONSTRAINT "two_factor_auth_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "two_factor_recovery_codes" ADD CONSTRAINT "two_factor_recovery_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_tokens" ADD CONSTRAINT "verification_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "login_attempts" ADD CONSTRAINT "login_attempts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_events" ADD CONSTRAINT "security_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_events" ADD CONSTRAINT "security_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_api_keys" ADD CONSTRAINT "tenant_api_keys_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_plans" ADD CONSTRAINT "subscription_plans_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_subscriptions" ADD CONSTRAINT "tenant_subscriptions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_subscriptions" ADD CONSTRAINT "tenant_subscriptions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "subscription_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_feature_flags" ADD CONSTRAINT "tenant_feature_flags_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_feature_flags" ADD CONSTRAINT "tenant_feature_flags_feature_flag_id_fkey" FOREIGN KEY ("feature_flag_id") REFERENCES "feature_flags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kyc_profiles" ADD CONSTRAINT "kyc_profiles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kyc_profiles" ADD CONSTRAINT "kyc_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trading_symbols" ADD CONSTRAINT "trading_symbols_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trading_symbols" ADD CONSTRAINT "trading_symbols_exchange_id_fkey" FOREIGN KEY ("exchange_id") REFERENCES "exchanges"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trading_accounts" ADD CONSTRAINT "trading_accounts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trading_accounts" ADD CONSTRAINT "trading_accounts_exchange_id_fkey" FOREIGN KEY ("exchange_id") REFERENCES "exchanges"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trading_accounts" ADD CONSTRAINT "trading_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "strategies" ADD CONSTRAINT "strategies_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "strategies" ADD CONSTRAINT "strategies_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "trading_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "strategy_configurations" ADD CONSTRAINT "strategy_configurations_strategy_id_fkey" FOREIGN KEY ("strategy_id") REFERENCES "strategies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "trading_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_strategy_id_fkey" FOREIGN KEY ("strategy_id") REFERENCES "strategies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_symbol_id_fkey" FOREIGN KEY ("symbol_id") REFERENCES "trading_symbols"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fills" ADD CONSTRAINT "fills_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "positions" ADD CONSTRAINT "positions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "positions" ADD CONSTRAINT "positions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "trading_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "positions" ADD CONSTRAINT "positions_symbol_id_fkey" FOREIGN KEY ("symbol_id") REFERENCES "trading_symbols"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_configurations" ADD CONSTRAINT "risk_configurations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_configurations" ADD CONSTRAINT "risk_configurations_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "trading_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_events" ADD CONSTRAINT "risk_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_events" ADD CONSTRAINT "risk_events_strategy_id_fkey" FOREIGN KEY ("strategy_id") REFERENCES "strategies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kill_switches" ADD CONSTRAINT "kill_switches_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trading_sessions" ADD CONSTRAINT "trading_sessions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trading_sessions" ADD CONSTRAINT "trading_sessions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "trading_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trading_sessions" ADD CONSTRAINT "trading_sessions_strategy_id_fkey" FOREIGN KEY ("strategy_id") REFERENCES "strategies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "market_data_records" ADD CONSTRAINT "market_data_records_symbol_id_fkey" FOREIGN KEY ("symbol_id") REFERENCES "trading_symbols"("id") ON DELETE CASCADE ON UPDATE CASCADE;

