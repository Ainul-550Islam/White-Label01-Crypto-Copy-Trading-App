-- Reconcile current schema - missing enums, tables, indexes, foreign keys
-- Generated from full schema diff vs existing migrations
-- Existing tables: 73 Existing enums: 60
-- Missing tables: 117 Missing enums: 111

-- Create missing enums (111 total)
CREATE TYPE "BillingNotificationEventKey" AS ENUM ('PAYMENT_SUCCEEDED', 'PAYMENT_PENDING', 'PAYMENT_FAILED', 'PAYMENT_EXPIRED', 'REFUND_SUCCEEDED', 'REFUND_FAILED', 'INVOICE_CREATED', 'INVOICE_FINALIZED', 'INVOICE_PAID', 'INVOICE_OVERDUE', 'SUBSCRIPTION_ACTIVATED', 'SUBSCRIPTION_CHANGED', 'SUBSCRIPTION_CANCELLATION_SCHEDULED', 'SUBSCRIPTION_RESUMED', 'TRIAL_STARTING', 'TRIAL_ENDING', 'DUNNING_RETRY', 'DUNNING_RECOVERED', 'DUNNING_FINAL_FAILURE', 'USAGE_THRESHOLD_REACHED', 'USAGE_OVERAGE_DETECTED', 'CUSTOM_DOMAIN_VERIFICATION', 'CUSTOM_DOMAIN_VERIFICATION_FAILED', 'WHITE_LABEL_PROVISIONING', 'FEE_SETTLEMENT_CREATED', 'FEE_SETTLEMENT_FINALIZED', 'PAYOUT_CREATED', 'PAYOUT_SUCCEEDED', 'PAYOUT_FAILED', 'SAAS_TENANT_PROVISIONED', 'SAAS_PLAN_CHANGED');

CREATE TYPE "BillingNotificationChannel" AS ENUM ('EMAIL', 'IN_APP', 'PUSH', 'SMS', 'WEBHOOK');

CREATE TYPE "BillingNotificationPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'CRITICAL');

CREATE TYPE "BillingDeliveryStatus" AS ENUM ('CREATED', 'PENDING', 'QUEUED', 'PROCESSING', 'SENT', 'DELIVERED', 'FAILED', 'RETRY_SCHEDULED', 'PERMANENT_FAILURE', 'SUPPRESSED', 'CANCELLED');

CREATE TYPE "BillingNotificationCategory" AS ENUM ('BILLING', 'DUNNING', 'USAGE', 'SUBSCRIPTION', 'SECURITY', 'SAAS_ADMIN', 'FEE', 'PAYOUT');

CREATE TYPE "ComplianceKycState" AS ENUM ('NOT_STARTED', 'PENDING', 'IN_REVIEW', 'VERIFIED', 'REJECTED', 'EXPIRED', 'REQUIRES_REVERIFICATION');

CREATE TYPE "ComplianceAmlState" AS ENUM ('NOT_SCREENED', 'CLEAR', 'POTENTIAL_MATCH', 'MATCH', 'REVIEW_REQUIRED', 'BLOCKED', 'PROVIDER_UNAVAILABLE');

CREATE TYPE "ComplianceRiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL', 'UNKNOWN');

CREATE TYPE "ComplianceDecision" AS ENUM ('ALLOW', 'PENDING', 'REVIEW_REQUIRED', 'RESTRICT', 'BLOCK');

CREATE TYPE "ComplianceCaseState" AS ENUM ('OPEN', 'IN_REVIEW', 'ESCALATED', 'RESOLVED', 'REJECTED', 'CLOSED');

CREATE TYPE "ComplianceCaseType" AS ENUM ('KYC_VERIFICATION', 'AML_SCREENING', 'SANCTIONS', 'PEP', 'TRANSACTION_REVIEW', 'ACCOUNT_RISK', 'MANUAL_REVIEW', 'ENHANCED_DUE_DILIGENCE');

CREATE TYPE "ComplianceReviewAction" AS ENUM ('ASSIGN', 'ESCALATE', 'APPROVE', 'REJECT', 'REQUEST_EDD', 'REQUEST_REVERIFICATION', 'REQUEST_HOLD', 'REQUEST_RELEASE', 'ADD_EVIDENCE', 'ADD_NOTE', 'RESOLVE', 'CLOSE');

CREATE TYPE "SsoProviderType" AS ENUM ('SAML', 'OIDC');

CREATE TYPE "SsoProviderState" AS ENUM ('DISABLED', 'ENABLED', 'ENFORCED');

CREATE TYPE "SecurityAuthFactor" AS ENUM ('PASSWORD', 'TOTP', 'WEBAUTHN', 'SAML', 'OIDC', 'RECOVERY');

CREATE TYPE "SecuritySessionState" AS ENUM ('ACTIVE', 'EXPIRED', 'REVOKED', 'SUSPICIOUS');

CREATE TYPE "SecurityApiKeyState" AS ENUM ('ACTIVE', 'EXPIRED', 'REVOKED', 'ROTATED');

CREATE TYPE "SecurityDeviceState" AS ENUM ('UNKNOWN', 'PENDING_TRUST', 'TRUSTED', 'REVOKED');

CREATE TYPE "SecurityRiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

CREATE TYPE "SecurityDecision" AS ENUM ('ALLOW', 'STEP_UP_REQUIRED', 'DENY', 'SUSPICIOUS', 'REVIEW_REQUIRED');

CREATE TYPE "SecurityEventCategory" AS ENUM ('LOGIN_SUCCESS', 'LOGIN_FAILURE', 'LOGOUT', 'MFA_REQUIRED', 'MFA_SUCCESS', 'MFA_FAILURE', 'SSO_LOGIN_STARTED', 'SSO_LOGIN_SUCCESS', 'SSO_LOGIN_FAILURE', 'API_KEY_CREATED', 'API_KEY_ROTATED', 'API_KEY_REVOKED', 'SESSION_CREATED', 'SESSION_REVOKED', 'SESSION_SUSPICIOUS', 'DEVICE_REGISTERED', 'DEVICE_TRUSTED', 'DEVICE_REVOKED', 'SECURITY_POLICY_CHANGED', 'PRIVILEGED_ACTION', 'SECURITY_ALERT');

CREATE TYPE "TraderVerificationState" AS ENUM ('UNVERIFIED', 'PENDING', 'VERIFIED', 'REJECTED', 'SUSPENDED');

CREATE TYPE "TraderStrategyStatus" AS ENUM ('DRAFT', 'PENDING_VALIDATION', 'VALIDATED', 'PUBLISHED', 'PAUSED', 'ARCHIVED', 'REJECTED');

CREATE TYPE "TraderStrategyType" AS ENUM ('MANUAL', 'ALGORITHMIC', 'COPY', 'HYBRID');

CREATE TYPE "CopySubscriptionState" AS ENUM ('PENDING', 'ACTIVE', 'PAUSED', 'STOPPED', 'CANCELLED', 'EXPIRED');

CREATE TYPE "CopyExecutionStatus" AS ENUM ('PENDING', 'VALIDATED', 'MAPPED', 'RISK_CHECKED', 'ROUTED', 'SUBMITTED', 'FILLED', 'FAILED', 'REJECTED', 'SKIPPED', 'BLOCKED');

CREATE TYPE "CopySizingMode" AS ENUM ('PROPORTIONAL', 'FIXED', 'PERCENTAGE_BALANCE');

CREATE TYPE "CopyRiskDecision" AS ENUM ('ALLOW', 'REDUCE', 'BLOCK', 'PAUSE', 'STOP_COPY');

CREATE TYPE "CopyReconciliationSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

CREATE TYPE "CopyReconciliationCategory" AS ENUM ('MISSING_COPY', 'DUPLICATE_COPY', 'STALE_INTENT', 'ORDER_MISMATCH', 'QUANTITY_MISMATCH', 'PRICE_MISMATCH', 'STATUS_MISMATCH', 'UNSUPPORTED_SYMBOL', 'EXECUTION_AFTER_STOP', 'EXECUTION_AFTER_RISK_BLOCK', 'SLIPPAGE_EXCEEDED');

CREATE TYPE "ResearchStatus" AS ENUM ('DRAFT', 'VALIDATING', 'VALID', 'RUNNING', 'COMPLETED', 'FAILED', 'INVALIDATED', 'ARCHIVED', 'PROMOTED');

CREATE TYPE "ResearchDatasetStatus" AS ENUM ('DRAFT', 'VALIDATING', 'VALID', 'INVALID', 'ARCHIVED');

CREATE TYPE "ResearchStrategyVersionStatus" AS ENUM ('DRAFT', 'VALIDATING', 'VALID', 'FROZEN', 'PUBLISHED', 'DEPRECATED', 'ARCHIVED');

CREATE TYPE "ResearchBacktestStatus" AS ENUM ('QUEUED', 'VALIDATING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

CREATE TYPE "ResearchPaperSessionStatus" AS ENUM ('CREATED', 'STARTING', 'RUNNING', 'PAUSED', 'STOPPED', 'FAILED', 'EXPIRED');

CREATE TYPE "ResearchPaperOrderStatus" AS ENUM ('PENDING', 'OPEN', 'PARTIALLY_FILLED', 'FILLED', 'CANCELLED', 'REJECTED', 'EXPIRED');

CREATE TYPE "ResearchSignalState" AS ENUM ('DRAFT', 'VALID', 'PUBLISHED', 'EXPIRED', 'REVOKED', 'REJECTED', 'FILTERED');

CREATE TYPE "ResearchPromotionState" AS ENUM ('DRAFT', 'PENDING_BACKTEST_VALIDATION', 'PENDING_OUT_OF_SAMPLE', 'PENDING_PAPER_TRADING', 'PENDING_RISK_REVIEW', 'PENDING_COMPLIANCE_REVIEW', 'PENDING_PUBLICATION', 'APPROVED', 'REJECTED', 'PROMOTED', 'ARCHIVED');

CREATE TYPE "ResearchSignalSide" AS ENUM ('BUY', 'SELL', 'HOLD', 'CLOSE_LONG', 'CLOSE_SHORT');

CREATE TYPE "InstitutionalRiskPolicyScope" AS ENUM ('PLATFORM', 'TENANT', 'TRADER', 'STRATEGY', 'FOLLOWER');

CREATE TYPE "RiskManagementDecision" AS ENUM ('ALLOW', 'REDUCE', 'REVIEW_REQUIRED', 'BLOCK', 'PAUSE', 'STOP_COPY', 'KILL_SWITCH_REQUIRED');

CREATE TYPE "RiskState" AS ENUM ('NORMAL', 'WATCH', 'ELEVATED', 'HIGH', 'CRITICAL', 'BLOCKED', 'UNKNOWN', 'STALE');

CREATE TYPE "CircuitBreakerScope" AS ENUM ('SYMBOL', 'STRATEGY', 'TRADER', 'ACCOUNT', 'TENANT', 'VENUE', 'PLATFORM');

CREATE TYPE "CircuitBreakerState" AS ENUM ('CLOSED', 'OPEN', 'HALF_OPEN');

CREATE TYPE "RiskReconciliationCategory" AS ENUM ('POSITION_WITHOUT_EXPOSURE', 'EXPOSURE_WITHOUT_POSITION', 'ORDER_EXPOSURE_MISMATCH', 'BALANCE_MISMATCH', 'PNL_DRIFT', 'SNAPSHOT_STALE', 'BREAKER_MISMATCH', 'KILL_SWITCH_INCONSISTENCY', 'COMPLIANCE_MISMATCH', 'MISSING_SOURCE', 'IMPOSSIBLE_LEVERAGE', 'NEGATIVE_MARGIN', 'STALE_MARKET_DATA', 'EXCHANGE_HEALTH_MISMATCH');

CREATE TYPE "OmsOrderIntentState" AS ENUM ('CREATED', 'VALIDATING', 'APPROVED', 'SUBMITTED', 'ACKNOWLEDGED', 'PARTIALLY_FILLED', 'FILLED', 'CANCEL_REQUESTED', 'CANCELLED', 'REJECTED', 'EXPIRED', 'REPLACED', 'FAILED', 'RECONCILIATION_REQUIRED');

CREATE TYPE "OmsFillState" AS ENUM ('RECEIVED', 'VALIDATED', 'APPLIED', 'REJECTED', 'DUPLICATE');

CREATE TYPE "OmsTradeState" AS ENUM ('OPEN', 'PARTIAL', 'CLOSED', 'RECONCILIATION_REQUIRED');

CREATE TYPE "OmsExecutionAckType" AS ENUM ('ACCEPTED', 'REJECTED');

CREATE TYPE "OmsRejectionCategory" AS ENUM ('RISK_BLOCK', 'COMPLIANCE_BLOCK', 'SECURITY_BLOCK', 'INVALID_SYMBOL', 'INVALID_PRECISION', 'INSUFFICIENT_BALANCE', 'INSUFFICIENT_MARGIN', 'EXCHANGE_REJECT', 'RATE_LIMITED', 'MARKET_DATA_STALE', 'LIVE_GATE_BLOCK', 'CREDENTIAL_FAILURE', 'UNKNOWN');

CREATE TYPE "OmsReconciliationCategory" AS ENUM ('MISSING_EXCHANGE_ORDER', 'MISSING_ACK', 'DUPLICATE_PROVIDER_ORDER', 'PROVIDER_STATUS_MISMATCH', 'STALE_ORDER', 'IMPOSSIBLE_LIFECYCLE_TRANSITION', 'ORDER_QUANTITY_MISMATCH', 'TERMINAL_STATE_MISMATCH', 'MISSING_FILL', 'DUPLICATE_FILL', 'QUANTITY_DRIFT', 'PRICE_DRIFT', 'FEE_MISMATCH', 'ORPHAN_FILL', 'POSITION_WITHOUT_FILLS', 'FILLS_WITHOUT_POSITION', 'POSITION_QUANTITY_MISMATCH', 'SIDE_MISMATCH', 'LEVERAGE_MISMATCH', 'STALE_POSITION');

CREATE TYPE "OmsAuditEventType" AS ENUM ('ORDER_INTENT_CREATED', 'ORDER_APPROVED', 'ORDER_SUBMITTED', 'ORDER_ACKNOWLEDGED', 'ORDER_PARTIALLY_FILLED', 'ORDER_FILLED', 'ORDER_CANCEL_REQUESTED', 'ORDER_CANCELLED', 'ORDER_REPLACED', 'ORDER_REJECTED', 'FILL_RECEIVED', 'FILL_APPLIED', 'TRADE_OPENED', 'TRADE_CLOSED', 'RECONCILIATION_DETECTED', 'RECOVERY_REQUESTED', 'EXECUTION_QUALITY_CALCULATED', 'OPERATOR_ACTION');

CREATE TYPE "OmsOperationalType" AS ENUM ('STALE_ORDER', 'RECONCILIATION_QUEUE', 'REJECTED_ORDER', 'EXCEPTION', 'RETRY_REQUESTED', 'RECOVERY_REQUESTED');

CREATE TYPE "OmsOperationalState" AS ENUM ('PENDING', 'ACKNOWLEDGED', 'RETRY_REQUESTED', 'RECOVERY_REQUESTED', 'RESOLVED');

CREATE TYPE "OperationalReadinessState" AS ENUM ('READY', 'NOT_READY', 'DEGRADED', 'MAINTENANCE', 'UNKNOWN');

CREATE TYPE "OperationalDependencyState" AS ENUM ('HEALTHY', 'DEGRADED', 'UNAVAILABLE', 'MISCONFIGURED', 'UNKNOWN');

CREATE TYPE "OperationalDependencyType" AS ENUM ('DATABASE', 'REDIS', 'QUEUE', 'CONFIGURATION', 'SECURITY', 'LIVE_GATE', 'EXCHANGE', 'COMPLIANCE', 'RISK', 'OMS', 'BILLING', 'NOTIFICATION', 'OBSERVABILITY', 'COPY_TRADING', 'RESEARCH', 'USAGE', 'SUBSCRIPTION', 'FEE', 'FINANCE', 'CREDENTIAL_SOURCE', 'VENUE_ATTESTATION', 'DISTRIBUTED_LOCK', 'SIGNED_TRANSPORT', 'IP_ALLOWLIST', 'DURABLE_STORE', 'EXECUTION_ENGINE', 'STRATEGY_ENGINE', 'MARKET_DATA', 'EXTERNAL_PROVIDER');

CREATE TYPE "OperationalIncidentSeverity" AS ENUM ('INFO', 'WARNING', 'ERROR', 'CRITICAL');

CREATE TYPE "OperationalIncidentState" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'ESCALATED', 'MITIGATING', 'RESOLVED', 'SUPPRESSED', 'REOPENED');

CREATE TYPE "OperationalMaintenanceState" AS ENUM ('SCHEDULED', 'ACTIVE', 'COMPLETED', 'CANCELLED', 'EXPIRED');

CREATE TYPE "OperationalMaintenanceScope" AS ENUM ('PLATFORM', 'TENANT', 'SERVICE', 'VENUE', 'TRADING_CAPABILITY', 'BILLING_CAPABILITY');

CREATE TYPE "OperationalDegradationLevel" AS ENUM ('NORMAL', 'DEGRADED', 'READ_ONLY', 'PAUSED', 'DISABLED');

CREATE TYPE "OperationalRecoveryState" AS ENUM ('PENDING', 'REQUIRES_APPROVAL', 'APPROVED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

CREATE TYPE "OperationalActionType" AS ENUM ('ACKNOWLEDGE', 'RETRY', 'RERUN_RECONCILIATION', 'ENTER_MAINTENANCE', 'EXIT_MAINTENANCE', 'ESCALATE', 'SUPPRESS', 'RECOVER', 'RESOLVE', 'REOPEN', 'CANCEL', 'DEGRADATION_CHANGE', 'TRIGGER_READINESS_CHECK', 'TRIGGER_DEPENDENCY_CHECK', 'TRIGGER_QUEUE_CHECK', 'TRIGGER_JOB_CHECK');

CREATE TYPE "OperationalActionStatus" AS ENUM ('PENDING', 'VALIDATED', 'AUTHORIZED', 'EXECUTING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'REQUIRES_APPROVAL');

CREATE TYPE "OperationalReconciliationRunState" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'SKIPPED', 'CANCELLED');

CREATE TYPE "OperationalReconciliationType" AS ENUM ('OMS_ORDER', 'OMS_FILL', 'OMS_POSITION', 'EXCHANGE_ACCOUNT', 'COPY_TRADING', 'RISK', 'COMPLIANCE', 'PAYMENT', 'BILLING_FINANCE', 'FEE', 'USAGE', 'NOTIFICATION', 'SUBSCRIPTION');

CREATE TYPE "OperationalTriggerType" AS ENUM ('MANUAL', 'SCHEDULED', 'INCIDENT', 'RECOVERY', 'HEALTH_CHECK', 'READINESS_CHECK', 'OPERATOR_ACTION', 'SYSTEM');

CREATE TYPE "OperationalAuditEventType" AS ENUM ('READINESS_CHECK', 'DEPENDENCY_TRANSITION', 'INCIDENT_CREATED', 'INCIDENT_ACKNOWLEDGED', 'INCIDENT_ESCALATED', 'INCIDENT_MITIGATING', 'INCIDENT_RESOLVED', 'INCIDENT_SUPPRESSED', 'INCIDENT_REOPENED', 'INCIDENT_DEDUPLICATED', 'MAINTENANCE_CREATED', 'MAINTENANCE_UPDATED', 'MAINTENANCE_STARTED', 'MAINTENANCE_COMPLETED', 'MAINTENANCE_CANCELLED', 'RECONCILIATION_RUN_STARTED', 'RECONCILIATION_RUN_COMPLETED', 'RECONCILIATION_RUN_FAILED', 'RECOVERY_STARTED', 'RECOVERY_COMPLETED', 'RECOVERY_FAILED', 'OPERATOR_ACTION', 'DEGRADATION_CHANGED', 'QUEUE_HEALTH_CHECK', 'JOB_HEALTH_CHECK', 'ESCALATION_TRIGGERED');

CREATE TYPE "PortfolioAccountingScope" AS ENUM ('TENANT', 'TRADER', 'FOLLOWER', 'STRATEGY', 'MANAGED_ACCOUNT');

CREATE TYPE "PortfolioType" AS ENUM ('SPOT', 'MARGIN', 'FUTURES', 'MANAGED', 'COPY_TRADING', 'PAPER');

CREATE TYPE "PortfolioPositionClassification" AS ENUM ('LONG', 'SHORT', 'FLAT', 'CASH');

CREATE TYPE "PortfolioCashFlowType" AS ENUM ('DEPOSIT', 'WITHDRAWAL', 'TRANSFER_IN', 'TRANSFER_OUT', 'TRADE_SETTLEMENT_BUY', 'TRADE_SETTLEMENT_SELL', 'FEE', 'PLATFORM_FEE', 'PERFORMANCE_FEE', 'FUNDING', 'ADJUSTMENT', 'REVERSAL', 'DIVIDEND', 'INTEREST');

CREATE TYPE "PortfolioValuationState" AS ENUM ('VALID', 'STALE', 'MISSING_PRICE', 'MISSING_FX', 'INCOMPLETE', 'UNAVAILABLE');

CREATE TYPE "PortfolioPeriodState" AS ENUM ('OPEN', 'CLOSING', 'CLOSED');

CREATE TYPE "PortfolioReturnMethodology" AS ENUM ('TIME_WEIGHTED_RETURN', 'MONEY_WEIGHTED_RETURN');

CREATE TYPE "PortfolioAttributionDimension" AS ENUM ('STRATEGY', 'TRADER', 'FOLLOWER', 'SYMBOL', 'ASSET', 'VENUE', 'COPY_ALLOCATION', 'FEE');

CREATE TYPE "PortfolioStatementState" AS ENUM ('DRAFT', 'FINALIZED', 'SUPERSEDED', 'VOID');

CREATE TYPE "PortfolioReconciliationState" AS ENUM ('PENDING', 'MATCHED', 'MISMATCH', 'RESOLVED', 'FAILED');

CREATE TYPE "PortfolioAdjustmentType" AS ENUM ('CORRECTION', 'REVERSAL', 'MANUAL_ADJUSTMENT', 'FEE_CORRECTION', 'CASH_CORRECTION', 'POSITION_CORRECTION');

CREATE TYPE "PortfolioPnLType" AS ENUM ('REALIZED', 'UNREALIZED', 'GROSS', 'FEE_ADJUSTED', 'NET');

CREATE TYPE "ClientProfileStatus" AS ENUM ('PENDING', 'ONBOARDING', 'UNDER_REVIEW', 'APPROVED', 'ACTIVE', 'RESTRICTED', 'SUSPENDED', 'CLOSURE_PENDING', 'CLOSED');

CREATE TYPE "InstitutionalAccountState" AS ENUM ('PENDING', 'ONBOARDING', 'UNDER_REVIEW', 'APPROVED', 'ACTIVE', 'RESTRICTED', 'SUSPENDED', 'CLOSURE_PENDING', 'CLOSED');

CREATE TYPE "ClientOnboardingState" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'CANCELLED');

CREATE TYPE "ClientOnboardingStepType" AS ENUM ('PROFILE_CREATED', 'IDENTITY_REQUIRED', 'KYC_PENDING', 'AML_PENDING', 'SECURITY_SETUP_REQUIRED', 'COMPLIANCE_REVIEW', 'RISK_REVIEW', 'ACCOUNT_CONFIGURATION', 'EXCHANGE_BINDING', 'PORTFOLIO_BINDING', 'APPROVAL', 'ACTIVATION_ELIGIBILITY');

CREATE TYPE "ClientOnboardingStepStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'BLOCKED', 'SKIPPED');

CREATE TYPE "AccountOwnershipType" AS ENUM ('OWNER', 'MANAGER', 'OPERATOR', 'BENEFICIAL_OWNER');

CREATE TYPE "AccountRelationshipType" AS ENUM ('CLIENT_TO_MANAGED_ACCOUNT', 'CLIENT_TO_PORTFOLIO', 'CLIENT_TO_EXCHANGE_ACCOUNT', 'CLIENT_TO_FOLLOWER', 'CLIENT_TO_TRADER', 'CLIENT_TO_STRATEGY', 'TRADER_TO_FOLLOWER', 'CLIENT_TO_CLIENT', 'OPERATOR_TO_ACCOUNT');

CREATE TYPE "RelationshipStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'PENDING', 'REVOKED');

CREATE TYPE "AccountRestrictionType" AS ENUM ('NO_TRADING', 'NO_COPY_TRADING', 'NO_WITHDRAWAL', 'NO_DEPOSIT', 'READ_ONLY', 'REVIEW_REQUIRED', 'ACCOUNT_LOCKED', 'COMPLIANCE_HOLD', 'SECURITY_HOLD', 'RISK_HOLD', 'OPERATIONAL_HOLD');

CREATE TYPE "RestrictionScope" AS ENUM ('ACCOUNT', 'CLIENT', 'TENANT', 'GLOBAL');

CREATE TYPE "RestrictionStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'REVOKED', 'PENDING');

CREATE TYPE "FundingRequestState" AS ENUM ('REQUESTED', 'UNDER_REVIEW', 'APPROVED', 'SUBMITTED', 'CONFIRMED', 'FAILED', 'REVERSED', 'CANCELLED');

CREATE TYPE "WithdrawalRequestState" AS ENUM ('REQUESTED', 'UNDER_REVIEW', 'APPROVED', 'SUBMITTED', 'CONFIRMED', 'FAILED', 'REVERSED', 'CANCELLED');

CREATE TYPE "FundingApprovalDecision" AS ENUM ('APPROVED', 'REJECTED', 'PENDING', 'ESCALATED');

CREATE TYPE "ClientReviewType" AS ENUM ('PERIODIC', 'MANUAL', 'COMPLIANCE', 'RISK', 'SECURITY', 'OPERATIONAL');

CREATE TYPE "ClientReviewDecision" AS ENUM ('APPROVED', 'REJECTED', 'ESCALATED', 'PENDING', 'REVIEW_REQUIRED');

CREATE TYPE "TradingEligibilityStatus" AS ENUM ('ELIGIBLE', 'BLOCKED', 'REVIEW_REQUIRED');

CREATE TYPE "CustodyWalletState" AS ENUM ('PENDING', 'ACTIVE', 'RESTRICTED', 'SUSPENDED', 'CLOSURE_PENDING', 'CLOSED');

CREATE TYPE "CustodyWalletAddressState" AS ENUM ('GENERATING', 'ACTIVE', 'RESERVED', 'DEPRECATED', 'BLOCKED');

CREATE TYPE "CustodyDepositState" AS ENUM ('EXPECTED', 'OBSERVED', 'CONFIRMING', 'CONFIRMED', 'FAILED', 'REORGED', 'REJECTED');

CREATE TYPE "CustodyWithdrawalState" AS ENUM ('REQUESTED', 'UNDER_REVIEW', 'APPROVED', 'QUEUED', 'SUBMITTED', 'CONFIRMING', 'CONFIRMED', 'FAILED', 'REJECTED', 'CANCELLED', 'REORGED');

CREATE TYPE "CustodyTransactionState" AS ENUM ('PENDING', 'SUBMITTED', 'OBSERVED', 'CONFIRMING', 'CONFIRMED', 'FINAL', 'FAILED', 'DROPPED', 'REPLACED', 'REORGED');

CREATE TYPE "CustodyConfirmationState" AS ENUM ('OBSERVED', 'REQUIRED', 'CONFIRMED', 'FINAL', 'FAILED', 'REORGED');

CREATE TYPE "CustodyInternalTransferState" AS ENUM ('REQUESTED', 'APPROVED', 'SETTLING', 'SETTLED', 'FAILED', 'CANCELLED');

CREATE TYPE "CustodyReserveState" AS ENUM ('ACTIVE', 'INSUFFICIENT', 'SUFFICIENT', 'LOCKED', 'PENDING');

CREATE TYPE "CustodySweepState" AS ENUM ('REQUESTED', 'APPROVED', 'SUBMITTING', 'CONFIRMING', 'SETTLED', 'FAILED', 'CANCELLED');

CREATE TYPE "CustodySettlementState" AS ENUM ('PENDING', 'SETTLED', 'FAILED', 'REORGED');

CREATE TYPE "CustodyScope" AS ENUM ('PLATFORM', 'TENANT', 'ACCOUNT', 'WALLET');

CREATE TYPE "CustodyReconciliationType" AS ENUM ('WALLET', 'TRANSACTION', 'DEPOSIT', 'WITHDRAWAL', 'BALANCE', 'RESERVE', 'FEE', 'CONFIRMATION', 'SETTLEMENT');

CREATE TYPE "CustodyAuditAction" AS ENUM ('WALLET_CREATED', 'WALLET_ACTIVATED', 'WALLET_RESTRICTED', 'WALLET_SUSPENDED', 'WALLET_CLOSED', 'ADDRESS_GENERATED', 'ADDRESS_VERIFIED', 'DEPOSIT_OBSERVED', 'DEPOSIT_CONFIRMED', 'DEPOSIT_REORGED', 'WITHDRAWAL_REQUESTED', 'WITHDRAWAL_APPROVED', 'WITHDRAWAL_SUBMITTED', 'WITHDRAWAL_CONFIRMED', 'WITHDRAWAL_FAILED', 'TRANSACTION_CREATED', 'TRANSACTION_OBSERVED', 'TRANSACTION_CONFIRMED', 'TRANSACTION_FAILED', 'TRANSACTION_REORGED', 'CONFIRMATION_OBSERVED', 'INTERNAL_TRANSFER_CREATED', 'INTERNAL_TRANSFER_SETTLED', 'SWEEP_REQUESTED', 'SWEEP_APPROVED', 'SWEEP_SETTLED', 'RESERVE_UPDATED', 'RECONCILIATION_RUN', 'SETTLEMENT_FINALIZED');

-- Create missing tables (117 total)
CREATE TABLE "account_ownerships" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "client_profile_id" UUID,
    "owner_id" UUID NOT NULL,
    "owner_type" VARCHAR(32) NOT NULL,
    "ownership_type" "AccountOwnershipType" NOT NULL DEFAULT 'OWNER',
    "status" "RelationshipStatus" NOT NULL DEFAULT 'ACTIVE',
    "effective_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMPTZ(6),
    "created_by" UUID,
    "source" VARCHAR(64),
    "idempotency_key" VARCHAR(255) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "account_ownerships_pkey" PRIMARY KEY ("id")
);



CREATE TABLE "account_relationships" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "source_id" UUID NOT NULL,
    "source_type" VARCHAR(32) NOT NULL,
    "target_id" UUID NOT NULL,
    "target_type" VARCHAR(32) NOT NULL,
    "relationship_type" "AccountRelationshipType" NOT NULL,
    "status" "RelationshipStatus" NOT NULL DEFAULT 'ACTIVE',
    "effective_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMPTZ(6),
    "client_profile_id" UUID,
    "account_id" UUID,
    "created_by" UUID,
    "source" VARCHAR(64),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "idempotency_key" VARCHAR(255) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "account_relationships_pkey" PRIMARY KEY ("id")
);



CREATE TABLE "account_restrictions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "account_id" UUID,
    "client_profile_id" UUID,
    "restriction_type" "AccountRestrictionType" NOT NULL,
    "scope" "RestrictionScope" NOT NULL DEFAULT 'ACCOUNT',
    "status" "RestrictionStatus" NOT NULL DEFAULT 'ACTIVE',
    "reason" VARCHAR(1000) NOT NULL,
    "source" VARCHAR(64) NOT NULL,
    "created_by" UUID,
    "effective_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "revoked_by" UUID,
    "audit_reference" VARCHAR(255),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "idempotency_key" VARCHAR(255) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "account_restrictions_pkey" PRIMARY KEY ("id")
);



CREATE TABLE "billing_notification_audit_logs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "operation" VARCHAR(64) NOT NULL,
    "reference_id" VARCHAR(255) NOT NULL,
    "reference_type" VARCHAR(64) NOT NULL,
    "status" VARCHAR(32) NOT NULL,
    "metadata" JSONB DEFAULT '{}',
    "actor_id" UUID,
    "timestamp" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_notification_audit_logs_pkey" PRIMARY KEY ("id")
);



CREATE TABLE "billing_notification_jobs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID,
    "recipient" JSONB NOT NULL DEFAULT '{}',
    "event_key" "BillingNotificationEventKey" NOT NULL,
    "channel" "BillingNotificationChannel" NOT NULL,
    "template_key" VARCHAR(120) NOT NULL,
    "locale" VARCHAR(10) NOT NULL DEFAULT 'en',
    "priority" "BillingNotificationPriority" NOT NULL DEFAULT 'NORMAL',
    "category" "BillingNotificationCategory" NOT NULL DEFAULT 'BILLING',
    "delivery_status" "BillingDeliveryStatus" NOT NULL DEFAULT 'CREATED',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 3,
    "next_attempt_at" TIMESTAMPTZ(6),
    "provider_reference" VARCHAR(255),
    "idempotency_key" VARCHAR(255) NOT NULL,
    "safe_payload" JSONB NOT NULL DEFAULT '{}',
    "rendered_subject" VARCHAR(500),
    "rendered_body" TEXT,
    "failure_reason" VARCHAR(1000),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "sent_at" TIMESTAMPTZ(6),
    "delivered_at" TIMESTAMPTZ(6),

    CONSTRAINT "billing_notification_jobs_pkey" PRIMARY KEY ("id")
);



CREATE TABLE "billing_notification_preferences" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID,
    "event_key" "BillingNotificationEventKey",
    "channel" "BillingNotificationChannel" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "category" VARCHAR(48) NOT NULL DEFAULT 'billing',
    "is_mandatory" BOOLEAN NOT NULL DEFAULT false,
    "locale" VARCHAR(10) NOT NULL DEFAULT 'en',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "billing_notification_preferences_pkey" PRIMARY KEY ("id")
);



CREATE TABLE "circuit_breaker_records" (
    "id" UUID NOT NULL,
    "tenant_id" UUID,
    "scope" "CircuitBreakerScope" NOT NULL,
    "scope_id" VARCHAR(128) NOT NULL,
    "state" "CircuitBreakerState" NOT NULL DEFAULT 'CLOSED',
    "trigger_type" VARCHAR(64) NOT NULL,
    "trigger_rule_id" VARCHAR(64),
    "reason" VARCHAR(1000) NOT NULL,
    "policy_version" VARCHAR(64) NOT NULL,
    "triggered_at" TIMESTAMPTZ(6),
    "acknowledged_at" TIMESTAMPTZ(6),
    "cleared_at" TIMESTAMPTZ(6),
    "half_open_at" TIMESTAMPTZ(6),
    "triggered_by_user_id" UUID,
    "cleared_by_user_id" UUID,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "circuit_breaker_records_pkey" PRIMARY KEY ("id")
);



CREATE TABLE "client_lifecycle_audits" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "client_profile_id" UUID,
    "account_id" UUID,
    "action" VARCHAR(128) NOT NULL,
    "entity_type" VARCHAR(64) NOT NULL,
    "entity_id" UUID,
    "actor_id" UUID,
    "actor_type" VARCHAR(32),
    "from_state" VARCHAR(64),
    "to_state" VARCHAR(64),
    "reason" VARCHAR(1000),
    "source_type" VARCHAR(64),
    "source_id" VARCHAR(255),
    "evidence" JSONB NOT NULL DEFAULT '{}',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "correlation_id" VARCHAR(64),
    "idempotency_key" VARCHAR(255),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_lifecycle_audits_pkey" PRIMARY KEY ("id")
);



CREATE TABLE "client_onboarding_steps" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "onboarding_id" UUID NOT NULL,
    "step_type" "ClientOnboardingStepType" NOT NULL,
    "status" "ClientOnboardingStepStatus" NOT NULL DEFAULT 'PENDING',
    "required" BOOLEAN NOT NULL DEFAULT true,
    "blocking_reasons" JSONB NOT NULL DEFAULT '[]',
    "evidence" JSONB NOT NULL DEFAULT '{}',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "completed_by" UUID,
    "completed_at" TIMESTAMPTZ(6),
    "source_type" VARCHAR(64),
    "source_id" VARCHAR(255),
    "source_timestamp" TIMESTAMPTZ(6),
    "idempotency_key" VARCHAR(255) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "client_onboarding_steps_pkey" PRIMARY KEY ("id")
);



CREATE TABLE "client_onboardings" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "client_profile_id" UUID NOT NULL,
    "state" "ClientOnboardingState" NOT NULL DEFAULT 'NOT_STARTED',
    "current_step" "ClientOnboardingStepType",
    "required_steps" JSONB NOT NULL DEFAULT '[]',
    "completed_steps" JSONB NOT NULL DEFAULT '[]',
    "blocking_reasons" JSONB NOT NULL DEFAULT '[]',
    "initiated_by" UUID,
    "approved_by" UUID,
    "kyc_state" VARCHAR(32),
    "aml_state" VARCHAR(32),
    "compliance_decision" VARCHAR(32),
    "risk_decision" VARCHAR(32),
    "security_state" VARCHAR(32),
    "compliance_case_id" UUID,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "evidence" JSONB NOT NULL DEFAULT '{}',
    "idempotency_key" VARCHAR(255) NOT NULL,
    "started_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "client_onboardings_pkey" PRIMARY KEY ("id")
);



CREATE TABLE "client_profiles" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "client_type" VARCHAR(32) NOT NULL DEFAULT 'CLIENT',
    "status" "ClientProfileStatus" NOT NULL DEFAULT 'PENDING',
    "legal_name" VARCHAR(160),
    "display_name" VARCHAR(120),
    "email" VARCHAR(254),
    "phone" VARCHAR(32),
    "country_code" CHAR(2),
    "external_identity_ref" VARCHAR(255),
    "kyc_reference_id" UUID,
    "aml_reference_id" UUID,
    "compliance_case_id" UUID,
    "risk_profile_id" UUID,
    "onboarding_id" UUID,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "pii_hash" VARCHAR(255),
    "idempotency_key" VARCHAR(255) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "client_profiles_pkey" PRIMARY KEY ("id")
);



CREATE TABLE "client_reviews" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "client_profile_id" UUID,
    "account_id" UUID,
    "review_type" "ClientReviewType" NOT NULL,
    "review_decision" "ClientReviewDecision" NOT NULL DEFAULT 'PENDING',
    "reviewer_id" UUID,
    "reason" VARCHAR(1000),
    "evidence_references" JSONB NOT NULL DEFAULT '[]',
    "risk_summary_reference" VARCHAR(255),
    "compliance_summary_reference" VARCHAR(255),
    "security_summary_reference" VARCHAR(255),
    "activity_summary" JSONB,
    "review_period_start" TIMESTAMPTZ(6),
    "review_period_end" TIMESTAMPTZ(6),
    "next_review_date" TIMESTAMPTZ(6),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "idempotency_key" VARCHAR(255) NOT NULL,
    "reviewed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "client_reviews_pkey" PRIMARY KEY ("id")
);



CREATE TABLE "compliance_audit_logs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "case_id" UUID,
    "user_id" UUID,
    "action" VARCHAR(64) NOT NULL,
    "actor_id" UUID,
    "actor_type" VARCHAR(16) NOT NULL DEFAULT 'USER',
    "outcome" VARCHAR(16) NOT NULL DEFAULT 'SUCCESS',
    "safe_metadata" JSONB NOT NULL DEFAULT '{}',
    "ip_hash" VARCHAR(64),
    "request_id" VARCHAR(64),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "compliance_audit_logs_pkey" PRIMARY KEY ("id")
);



CREATE TABLE "compliance_cases" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "case_type" "ComplianceCaseType" NOT NULL,
    "state" "ComplianceCaseState" NOT NULL DEFAULT 'OPEN',
    "severity" VARCHAR(16) NOT NULL DEFAULT 'MEDIUM',
    "risk_level" "ComplianceRiskLevel" NOT NULL DEFAULT 'UNKNOWN',
    "decision" "ComplianceDecision",
    "assigned_to" UUID,
    "assigned_at" TIMESTAMPTZ(6),
    "escalated_at" TIMESTAMPTZ(6),
    "resolved_at" TIMESTAMPTZ(6),
    "closed_at" TIMESTAMPTZ(6),
    "idempotency_key" VARCHAR(255) NOT NULL,
    "safe_summary" VARCHAR(1000) NOT NULL,
    "jurisdiction" VARCHAR(16),
    "policy_version" VARCHAR(32),
    "rule_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "source_refs" JSONB NOT NULL DEFAULT '[]',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "compliance_cases_pkey" PRIMARY KEY ("id")
);



CREATE TABLE "compliance_evidences" (
    "id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "evidence_type" VARCHAR(64) NOT NULL,
    "reference_id" VARCHAR(255) NOT NULL,
    "reference_type" VARCHAR(64) NOT NULL,
    "safe_description" VARCHAR(1000),
    "added_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "compliance_evidences_pkey" PRIMARY KEY ("id")
);



CREATE TABLE "compliance_policy_records" (
    "id" UUID NOT NULL,
    "tenant_id" UUID,
    "jurisdiction" VARCHAR(16) NOT NULL DEFAULT 'DEFAULT',
    "policy_version" VARCHAR(32) NOT NULL,
    "kyc_required" BOOLEAN NOT NULL DEFAULT true,
    "aml_required" BOOLEAN NOT NULL DEFAULT true,
    "sanctions_required" BOOLEAN NOT NULL DEFAULT true,
    "pep_required" BOOLEAN NOT NULL DEFAULT false,
    "edd_required" BOOLEAN NOT NULL DEFAULT false,
    "transaction_thresholds" JSONB NOT NULL DEFAULT '{}',
    "risk_thresholds" JSONB NOT NULL DEFAULT '{}',
    "high_risk_countries" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "blocked_countries" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "reverification_interval_days" INTEGER NOT NULL DEFAULT 365,
    "manual_review_required" BOOLEAN NOT NULL DEFAULT false,
    "rules" JSONB NOT NULL DEFAULT '[]',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "compliance_policy_records_pkey" PRIMARY KEY ("id")
);



CREATE TABLE "compliance_reviews" (
    "id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "reviewer_id" UUID NOT NULL,
    "action" "ComplianceReviewAction" NOT NULL,
    "from_state" "ComplianceCaseState",
    "to_state" "ComplianceCaseState",
    "decision" "ComplianceDecision",
    "reason" VARCHAR(1000) NOT NULL,
    "safe_note" VARCHAR(2000),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "compliance_reviews_pkey" PRIMARY KEY ("id")
);



CREATE TABLE "compliance_screening_requests" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" VARCHAR(32) NOT NULL,
    "provider" VARCHAR(64),
    "provider_ref" VARCHAR(255),
    "status" VARCHAR(32) NOT NULL DEFAULT 'PENDING',
    "kyc_state" "ComplianceKycState",
    "aml_state" "ComplianceAmlState",
    "decision" "ComplianceDecision",
    "risk_level" "ComplianceRiskLevel",
    "idempotency_key" VARCHAR(255) NOT NULL,
    "safe_metadata" JSONB NOT NULL DEFAULT '{}',
    "failure_reason" VARCHAR(1000),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "expires_at" TIMESTAMPTZ(6),

    CONSTRAINT "compliance_screening_requests_pkey" PRIMARY KEY ("id")
);



CREATE TABLE "copy_executions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "leader_event_id" VARCHAR(128) NOT NULL,
    "leader_order_id" UUID,
    "leader_fill_id" UUID,
    "subscription_id" UUID NOT NULL,
    "follower_id" UUID NOT NULL,
    "trader_id" UUID NOT NULL,
    "follower_account_id" UUID,
    "status" "CopyExecutionStatus" NOT NULL DEFAULT 'PENDING',
    "sizing_mode" "CopySizingMode" NOT NULL DEFAULT 'PROPORTIONAL',
    "leader_quantity" VARCHAR(64) NOT NULL,
    "leader_price" VARCHAR(64),
    "follower_quantity" VARCHAR(64),
    "follower_price" VARCHAR(64),
    "slippage_tolerance" VARCHAR(32),
    "max_notional" VARCHAR(64),
    "execution_intent" JSONB NOT NULL DEFAULT '{}',
    "follower_order_id" UUID,
    "follower_fill_id" UUID,
    "provider_order_id" VARCHAR(128),
    "provider_trade_id" VARCHAR(128),
    "failure_reason" VARCHAR(1000),
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "risk_decision" "CopyRiskDecision",
    "risk_rule_id" VARCHAR(64),
    "idempotency_key" VARCHAR(255) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "copy_executions_pkey" PRIMARY KEY ("id")
);



CREATE TABLE "copy_reconciliation_records" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "leader_event_id" VARCHAR(128) NOT NULL,
    "subscription_id" UUID,
    "execution_id" UUID,
    "category" "CopyReconciliationCategory" NOT NULL,
    "severity" "CopyReconciliationSeverity" NOT NULL,
    "expected" JSONB DEFAULT '{}',
    "actual" JSONB DEFAULT '{}',
    "leader_reference" JSONB,
    "follower_reference" JSONB,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "resolved_at" TIMESTAMPTZ(6),
    "resolved_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "copy_reconciliation_records_pkey" PRIMARY KEY ("id")
);



CREATE TABLE "copy_subscriptions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "follower_id" UUID NOT NULL,
    "trader_id" UUID NOT NULL,
    "strategy_id" UUID NOT NULL,
    "state" "CopySubscriptionState" NOT NULL DEFAULT 'PENDING',
    "allocation_mode" "CopySizingMode" NOT NULL DEFAULT 'PROPORTIONAL',
    "allocation_amount" VARCHAR(64) NOT NULL,
    "max_allocation" VARCHAR(64),
    "min_allocation" VARCHAR(64),
    "copy_policy" JSONB NOT NULL DEFAULT '{}',
    "risk_policy" JSONB NOT NULL DEFAULT '{}',
    "follower_account_id" UUID,
    "started_at" TIMESTAMPTZ(6),
    "paused_at" TIMESTAMPTZ(6),
    "stopped_at" TIMESTAMPTZ(6),
    "cancelled_at" TIMESTAMPTZ(6),
    "expires_at" TIMESTAMPTZ(6),
    "total_copied_volume" VARCHAR(64) NOT NULL DEFAULT '0',
    "total_copies" INTEGER NOT NULL DEFAULT 0,
    "failed_copies" INTEGER NOT NULL DEFAULT 0,
    "idempotency_key" VARCHAR(255) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "copy_subscriptions_pkey" PRIMARY KEY ("id")
);



CREATE TABLE "copy_trading_audit_logs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "event" VARCHAR(64) NOT NULL,
    "actor_id" UUID,
    "trader_id" UUID,
    "follower_id" UUID,
    "strategy_id" UUID,
    "subscription_id" UUID,
    "execution_id" UUID,
    "result" VARCHAR(32) NOT NULL DEFAULT 'SUCCESS',
    "safe_metadata" JSONB NOT NULL DEFAULT '{}',
    "request_id" VARCHAR(64),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "copy_trading_audit_logs_pkey" PRIMARY KEY ("id")
);



CREATE TABLE "custody_assets" (
    "id" UUID NOT NULL,
    "asset_id" VARCHAR(128) NOT NULL,
    "symbol" VARCHAR(32) NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "decimals" INTEGER NOT NULL,
    "display_precision" INTEGER NOT NULL DEFAULT 8,
    "is_native" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "contract_address" VARCHAR(255),
    "token_standard" VARCHAR(32),
    "chain_id" VARCHAR(64),
    "network_id" VARCHAR(64),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "custody_assets_pkey" PRIMARY KEY ("id")
);



CREATE TABLE "custody_audits" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "wallet_id" UUID,
    "action" "CustodyAuditAction" NOT NULL,
    "entity_type" VARCHAR(64) NOT NULL,
    "entity_id" UUID,
    "actor_id" UUID,
    "actor_type" VARCHAR(32),
    "from_state" VARCHAR(64),
    "to_state" VARCHAR(64),
    "reason" VARCHAR(1000),
    "source_type" VARCHAR(64),
    "source_id" VARCHAR(255),
    "evidence" JSONB NOT NULL DEFAULT '{}',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "correlation_id" VARCHAR(64),
    "idempotency_key" VARCHAR(255),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "custody_audits_pkey" PRIMARY KEY ("id")
);



CREATE TABLE "custody_deposits" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "wallet_id" UUID,
    "address_id" UUID,
    "asset_id" VARCHAR(128) NOT NULL,
    "network_id" VARCHAR(64) NOT NULL,
    "amount" VARCHAR(64) NOT NULL,
    "transaction_hash" VARCHAR(255),
    "block_hash" VARCHAR(255),
    "block_number" VARCHAR(64),
    "from_address" VARCHAR(512),
    "to_address" VARCHAR(512) NOT NULL,
    "provider_reference" VARCHAR(255),
    "state" "CustodyDepositState" NOT NULL DEFAULT 'EXPECTED',
    "confirmation_count" INTEGER NOT NULL DEFAULT 0,
    "required_confirmation_count" INTEGER NOT NULL DEFAULT 6,
    "is_final" BOOLEAN NOT NULL DEFAULT false,
    "observed_at" TIMESTAMPTZ(6),
    "confirmed_at" TIMESTAMPTZ(6),
    "failed_at" TIMESTAMPTZ(6),
    "failure_reason" VARCHAR(1000),
    "funding_request_id" UUID,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "evidence" JSONB NOT NULL DEFAULT '{}',
    "idempotency_key" VARCHAR(255) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "custody_deposits_pkey" PRIMARY KEY ("id")
);



CREATE TABLE "custody_internal_transfers" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "source_wallet_id" UUID NOT NULL,
    "destination_wallet_id" UUID NOT NULL,
    "asset_id" VARCHAR(128) NOT NULL,
    "network_id" VARCHAR(64),
    "amount" VARCHAR(64) NOT NULL,
    "state" "CustodyInternalTransferState" NOT NULL DEFAULT 'REQUESTED',
    "authorization_reference" VARCHAR(255),
    "operator_id" UUID,
    "reason" VARCHAR(1000),
    "settlement_reference" VARCHAR(255),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "evidence" JSONB NOT NULL DEFAULT '{}',
    "idempotency_key" VARCHAR(255) NOT NULL,
    "requested_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approved_at" TIMESTAMPTZ(6),
    "settled_at" TIMESTAMPTZ(6),
    "failed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "custody_internal_transfers_pkey" PRIMARY KEY ("id")
);



CREATE TABLE "custody_networks" (
    "id" UUID NOT NULL,
    "network_id" VARCHAR(64) NOT NULL,
    "chain_id" VARCHAR(64),
    "name" VARCHAR(128) NOT NULL,
    "native_asset_id" VARCHAR(128),
    "native_asset_symbol" VARCHAR(32),
    "explorer_url" VARCHAR(512),
    "rpc_url" VARCHAR(512),
    "finality_model" VARCHAR(32),
    "confirmation_policy" JSONB,
    "status" VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
    "provider_capabilities" JSONB NOT NULL DEFAULT '[]',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "custody_networks_pkey" PRIMARY KEY ("id")
);



CREATE TABLE "custody_reconciliations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "reconciliation_type" "CustodyReconciliationType" NOT NULL,
    "wallet_id" UUID,
    "transaction_id" UUID,
    "deposit_id" UUID,
    "withdrawal_id" UUID,
    "expected" JSONB DEFAULT '{}',
    "actual" JSONB DEFAULT '{}',
    "discrepancy_type" VARCHAR(64),
    "discrepancy_details" JSONB,
    "is_critical" BOOLEAN NOT NULL DEFAULT false,
    "is_resolved" BOOLEAN NOT NULL DEFAULT false,
    "resolved_at" TIMESTAMPTZ(6),
    "resolved_by" UUID,
    "source_type" VARCHAR(64),
    "source_id" VARCHAR(255),
    "external_reference" VARCHAR(255),
    "calculation_version" VARCHAR(64) NOT NULL DEFAULT 'custody-v1.0.0',
    "idempotency_key" VARCHAR(255) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "custody_reconciliations_pkey" PRIMARY KEY ("id")
);



CREATE TABLE "custody_reserves" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "wallet_id" UUID,
    "asset_id" VARCHAR(128) NOT NULL,
    "network_id" VARCHAR(64),
    "reserve_type" VARCHAR(32) NOT NULL,
    "required_amount" VARCHAR(64) NOT NULL,
    "available_amount" VARCHAR(64),
    "reserved_amount" VARCHAR(64),
    "locked_amount" VARCHAR(64),
    "state" "CustodyReserveState" NOT NULL DEFAULT 'ACTIVE',
    "policy_version" VARCHAR(64),
    "calculation_version" VARCHAR(64) NOT NULL DEFAULT 'custody-v1.0.0',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "idempotency_key" VARCHAR(255) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "custody_reserves_pkey" PRIMARY KEY ("id")
);



CREATE TABLE "custody_sweeps" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "source_wallet_id" UUID NOT NULL,
    "destination_wallet_id" UUID NOT NULL,
    "asset_id" VARCHAR(128) NOT NULL,
    "network_id" VARCHAR(64) NOT NULL,
    "amount" VARCHAR(64) NOT NULL,
    "state" "CustodySweepState" NOT NULL DEFAULT 'REQUESTED',
    "provider_reference" VARCHAR(255),
    "transaction_id" UUID,
    "operator_id" UUID,
    "approved_by" UUID,
    "reason" VARCHAR(1000),
    "estimated_fee" VARCHAR(64),
    "actual_fee" VARCHAR(64),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "evidence" JSONB NOT NULL DEFAULT '{}',
    "idempotency_key" VARCHAR(255) NOT NULL,
    "requested_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approved_at" TIMESTAMPTZ(6),
    "submitted_at" TIMESTAMPTZ(6),
    "settled_at" TIMESTAMPTZ(6),
    "failed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "custody_sweeps_pkey" PRIMARY KEY ("id")
);



CREATE TABLE "custody_transaction_confirmations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "transaction_id" UUID NOT NULL,
    "block_hash" VARCHAR(255),
    "block_number" VARCHAR(64),
    "confirmation_count" INTEGER NOT NULL,
    "required_confirmation_count" INTEGER NOT NULL,
    "state" "CustodyConfirmationState" NOT NULL DEFAULT 'OBSERVED',
    "is_final" BOOLEAN NOT NULL DEFAULT false,
    "provider_reference" VARCHAR(255),
    "observed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "custody_transaction_confirmations_pkey" PRIMARY KEY ("id")
);



CREATE TABLE "custody_transactions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "wallet_id" UUID,
    "asset_id" VARCHAR(128) NOT NULL,
    "network_id" VARCHAR(64) NOT NULL,
    "direction" VARCHAR(16) NOT NULL,
    "amount" VARCHAR(64) NOT NULL,
    "transaction_hash" VARCHAR(255),
    "block_hash" VARCHAR(255),
    "block_number" VARCHAR(64),
    "provider_reference" VARCHAR(255),
    "provider_metadata" JSONB,
    "status" "CustodyTransactionState" NOT NULL DEFAULT 'PENDING',
    "confirmation_count" INTEGER NOT NULL DEFAULT 0,
    "required_confirmation_count" INTEGER NOT NULL DEFAULT 6,
    "estimated_fee" VARCHAR(64),
    "actual_fee" VARCHAR(64),
    "fee_asset" VARCHAR(32),
    "fee_reference" VARCHAR(255),
    "source_workflow_type" VARCHAR(64),
    "source_workflow_id" UUID,
    "deposit_id" UUID,
    "withdrawal_id" UUID,
    "observed_at" TIMESTAMPTZ(6),
    "submitted_at" TIMESTAMPTZ(6),
    "confirmed_at" TIMESTAMPTZ(6),
    "failed_at" TIMESTAMPTZ(6),
    "failure_reason" VARCHAR(1000),
    "is_reorged" BOOLEAN NOT NULL DEFAULT false,
    "reorged_at" TIMESTAMPTZ(6),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "evidence" JSONB NOT NULL DEFAULT '{}',
    "idempotency_key" VARCHAR(255) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "custody_transactions_pkey" PRIMARY KEY ("id")
);



CREATE TABLE "custody_wallet_addresses" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "wallet_id" UUID NOT NULL,
    "asset_id" VARCHAR(128),
    "network_id" VARCHAR(64),
    "address" VARCHAR(512) NOT NULL,
    "provider_reference" VARCHAR(255),
    "creation_source" VARCHAR(64),
    "status" "CustodyWalletAddressState" NOT NULL DEFAULT 'GENERATING',
    "label" VARCHAR(128),
    "is_deposit_address" BOOLEAN NOT NULL DEFAULT false,
    "client_profile_id" UUID,
    "account_id" UUID,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "verified_at" TIMESTAMPTZ(6),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "idempotency_key" VARCHAR(255) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "activated_at" TIMESTAMPTZ(6),
    "deprecated_at" TIMESTAMPTZ(6),

    CONSTRAINT "custody_wallet_addresses_pkey" PRIMARY KEY ("id")
);



CREATE TABLE "custody_wallets" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "client_profile_id" UUID,
    "account_id" UUID,
    "wallet_type" VARCHAR(32) NOT NULL DEFAULT 'HOT',
    "state" "CustodyWalletState" NOT NULL DEFAULT 'PENDING',
    "scope" "CustodyScope" NOT NULL DEFAULT 'TENANT',
    "asset_id" VARCHAR(128),
    "network_id" VARCHAR(64),
    "provider" VARCHAR(64),
    "provider_reference" VARCHAR(255),
    "provider_metadata" JSONB,
    "encrypted_secret_reference" VARCHAR(512),
    "credential_fingerprint" VARCHAR(255),
    "owner_id" UUID,
    "owner_type" VARCHAR(32),
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "idempotency_key" VARCHAR(255) NOT NULL,
    "activated_at" TIMESTAMPTZ(6),
    "suspended_at" TIMESTAMPTZ(6),
    "closed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "custody_wallets_pkey" PRIMARY KEY ("id")
);



CREATE TABLE "custody_withdrawals" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "wallet_id" UUID,
    "account_id" UUID,
    "asset_id" VARCHAR(128) NOT NULL,
    "network_id" VARCHAR(64) NOT NULL,
    "amount" VARCHAR(64) NOT NULL,
    "destination_address" VARCHAR(512) NOT NULL,
    "destination_type" VARCHAR(64),
    "transaction_hash" VARCHAR(255),
    "provider_reference" VARCHAR(255),
    "state" "CustodyWithdrawalState" NOT NULL DEFAULT 'REQUESTED',
    "funding_request_id" UUID,
    "withdrawal_request_id" UUID,
    "approved_by" UUID,
    "submitted_by" UUID,
    "estimated_fee" VARCHAR(64),
    "actual_fee" VARCHAR(64),
    "fee_asset" VARCHAR(32),
    "confirmation_count" INTEGER NOT NULL DEFAULT 0,
    "required_confirmation_count" INTEGER NOT NULL DEFAULT 6,
    "failure_reason" VARCHAR(1000),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "evidence" JSONB NOT NULL DEFAULT '{}',
    "idempotency_key" VARCHAR(255) NOT NULL,
    "requested_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approved_at" TIMESTAMPTZ(6),
    "submitted_at" TIMESTAMPTZ(6),
    "confirmed_at" TIMESTAMPTZ(6),
    "failed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "custody_withdrawals_pkey" PRIMARY KEY ("id")
);



CREATE TABLE "device_trusts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "device_id" VARCHAR(128) NOT NULL,
    "device_hash" VARCHAR(128) NOT NULL,
    "state" "SecurityDeviceState" NOT NULL DEFAULT 'UNKNOWN',
    "trusted_at" TIMESTAMPTZ(6),
    "expires_at" TIMESTAMPTZ(6),
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(6),
    "ip_hash" VARCHAR(64),
    "user_agent_hash" VARCHAR(128),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "device_trusts_pkey" PRIMARY KEY ("id")
);



CREATE TABLE "dunning_cases" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "subscription_id" UUID,
    "trigger" VARCHAR(64) NOT NULL,
    "status" VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 4,
    "grace_period_ends_at" TIMESTAMPTZ(6),
    "next_retry_at" TIMESTAMPTZ(6),
    "last_attempt_at" TIMESTAMPTZ(6),
    "last_error" VARCHAR(1000),
    "last_error_code" VARCHAR(64),
    "action_taken" VARCHAR(32) NOT NULL DEFAULT 'NONE',
    "suspended_at" TIMESTAMPTZ(6),
    "recovered_at" TIMESTAMPTZ(6),
    "failed_at" TIMESTAMPTZ(6),
    "canceled_at" TIMESTAMPTZ(6),
    "resolved_at" TIMESTAMPTZ(6),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "dunning_cases_pkey" PRIMARY KEY ("id")
);



CREATE TABLE "enterprise_api_keys" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "key_id" VARCHAR(48) NOT NULL,
    "secret_hash" VARCHAR(255) NOT NULL,
    "fingerprint" VARCHAR(128) NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "state" "SecurityApiKeyState" NOT NULL DEFAULT 'ACTIVE',
    "ip_allowlist" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "expires_at" TIMESTAMPTZ(6),
    "last_used_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "rotated_at" TIMESTAMPTZ(6),
    "rotated_from_id" UUID,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "idempotency_key" VARCHAR(255),

    CONSTRAINT "enterprise_api_keys_pkey" PRIMARY KEY ("id")
);



CREATE TABLE "fee_accruals" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "fee_type" VARCHAR(32) NOT NULL,
    "fee_source_type" VARCHAR(32) NOT NULL,
    "source_id" VARCHAR(255) NOT NULL,
    "source_amount" VARCHAR(32) NOT NULL,
    "fee_amount" VARCHAR(32) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "rate_bps" INTEGER,
    "rate_reference" VARCHAR(255),
    "status" VARCHAR(32) NOT NULL DEFAULT 'ACCRUED',
    "settlement_state" VARCHAR(32) NOT NULL DEFAULT 'DRAFT',
    "settlement_id" UUID,
    "settlement_timestamp" TIMESTAMPTZ(6),
    "idempotency_key" VARCHAR(255) NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "safe_metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "fee_accruals_pkey" PRIMARY KEY ("id")
);



CREATE TABLE "fee_settlements" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "gross_fee_amount" VARCHAR(32) NOT NULL,
    "adjustments" VARCHAR(32) NOT NULL DEFAULT '0',
    "final_settlement_amount" VARCHAR(32) NOT NULL,
    "number_of_accruals" INTEGER NOT NULL,
    "fee_type" VARCHAR(32) NOT NULL,
    "status" VARCHAR(32) NOT NULL DEFAULT 'DRAFT',
    "idempotency_key" VARCHAR(255) NOT NULL,
    "accrual_ids" TEXT[],
    "approved_at" TIMESTAMPTZ(6),
    "finalized_at" TIMESTAMPTZ(6),
    "paid_at" TIMESTAMPTZ(6),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "fee_settlements_pkey" PRIMARY KEY ("id")
);



CREATE TABLE "funding_approvals" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "funding_request_id" UUID,
    "withdrawal_request_id" UUID,
    "decision" "FundingApprovalDecision" NOT NULL DEFAULT 'PENDING',
    "approver_id" UUID,
    "reason" VARCHAR(1000),
    "approval_policy_version" VARCHAR(64),
    "evidence" JSONB NOT NULL DEFAULT '{}',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "idempotency_key" VARCHAR(255) NOT NULL,
    "decided_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "funding_approvals_pkey" PRIMARY KEY ("id")
);



CREATE TABLE "funding_reconciliations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "funding_request_id" UUID,
    "withdrawal_request_id" UUID,
    "reconciliation_type" VARCHAR(64) NOT NULL,
    "expected" JSONB DEFAULT '{}',
    "actual" JSONB DEFAULT '{}',
    "discrepancy_type" VARCHAR(64),
    "discrepancy_details" JSONB,
    "is_critical" BOOLEAN NOT NULL DEFAULT false,
    "is_resolved" BOOLEAN NOT NULL DEFAULT false,
    "resolved_at" TIMESTAMPTZ(6),
    "resolved_by" UUID,
    "source_type" VARCHAR(64),
    "source_id" VARCHAR(255),
    "external_reference" VARCHAR(255),
    "calculation_version" VARCHAR(64) NOT NULL DEFAULT 'client-lifecycle-v1.0.0',
    "idempotency_key" VARCHAR(255) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "funding_reconciliations_pkey" PRIMARY KEY ("id")
);



CREATE TABLE "funding_requests" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "client_profile_id" UUID,
    "account_id" UUID NOT NULL,
    "state" "FundingRequestState" NOT NULL DEFAULT 'REQUESTED',
    "requested_amount" VARCHAR(64) NOT NULL,
    "approved_amount" VARCHAR(64),
    "submitted_amount" VARCHAR(64),
    "confirmed_amount" VARCHAR(64),
    "settled_amount" VARCHAR(64),
    "currency" VARCHAR(16) NOT NULL,
    "external_reference" VARCHAR(255),
    "source_type" VARCHAR(64),
    "source_id" VARCHAR(255),
    "requested_by" UUID,
    "approved_by" UUID,
    "approval_policy_version" VARCHAR(64),
    "calculation_version" VARCHAR(64) NOT NULL DEFAULT 'client-lifecycle-v1.0.0',
    "failure_reason" VARCHAR(1000),
    "reversal_reason" VARCHAR(1000),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "evidence" JSONB NOT NULL DEFAULT '{}',
    "idempotency_key" VARCHAR(255) NOT NULL,
    "requested_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approved_at" TIMESTAMPTZ(6),
    "submitted_at" TIMESTAMPTZ(6),
    "confirmed_at" TIMESTAMPTZ(6),
    "failed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "funding_requests_pkey" PRIMARY KEY ("id")
);



CREATE TABLE "institutional_accounts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "client_profile_id" UUID,
    "account_type" VARCHAR(32) NOT NULL DEFAULT 'TRADING',
    "state" "InstitutionalAccountState" NOT NULL DEFAULT 'PENDING',
    "display_name" VARCHAR(120),
    "owner_id" UUID,
    "owner_type" VARCHAR(32),
    "exchange_account_id" UUID,
    "portfolio_id" UUID,
    "is_trading_enabled" BOOLEAN NOT NULL DEFAULT false,
    "is_funding_enabled" BOOLEAN NOT NULL DEFAULT false,
    "is_withdrawal_enabled" BOOLEAN NOT NULL DEFAULT false,
    "trading_eligibility" "TradingEligibilityStatus",
    "eligibility_evidence" JSONB,
    "blocking_reasons" JSONB NOT NULL DEFAULT '[]',
    "compliance_status" VARCHAR(32),
    "risk_status" VARCHAR(32),
    "security_status" VARCHAR(32),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "idempotency_key" VARCHAR(255) NOT NULL,
    "activated_at" TIMESTAMPTZ(6),
    "suspended_at" TIMESTAMPTZ(6),
    "closed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "institutional_accounts_pkey" PRIMARY KEY ("id")
);



CREATE TABLE "institutional_risk_policies" (
    "id" UUID NOT NULL,
    "tenant_id" UUID,
    "scope" "InstitutionalRiskPolicyScope" NOT NULL,
    "scope_id" VARCHAR(128),
    "version" INTEGER NOT NULL DEFAULT 1,
    "digest" VARCHAR(64) NOT NULL,
    "policy_json" JSONB NOT NULL,
    "rule_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "change_reason" VARCHAR(500) NOT NULL,
    "changed_by_user_id" UUID NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "institutional_risk_policies_pkey" PRIMARY KEY ("id")
);



CREATE TABLE "invoices" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "invoice_number" VARCHAR(64) NOT NULL,
    "status" VARCHAR(32) NOT NULL DEFAULT 'DRAFT',
    "currency" VARCHAR(3) NOT NULL DEFAULT 'USD',
    "subtotal" VARCHAR(32) NOT NULL DEFAULT '0',
    "tax_total" VARCHAR(32) NOT NULL DEFAULT '0',
    "total" VARCHAR(32) NOT NULL DEFAULT '0',
    "amount_paid" VARCHAR(32) NOT NULL DEFAULT '0',
    "amount_due" VARCHAR(32) NOT NULL DEFAULT '0',
    "amount_refunded" VARCHAR(32) NOT NULL DEFAULT '0',
    "payment_id" UUID,
    "subscription_id" UUID,
    "plan_id" UUID,
    "provider" VARCHAR(32),
    "idempotency_key" VARCHAR(255),
    "customer" JSONB NOT NULL DEFAULT '{}',
    "lines" JSONB NOT NULL DEFAULT '[]',
    "tax_summary" JSONB NOT NULL DEFAULT '[]',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "issued_at" TIMESTAMPTZ(6),
    "due_date" TIMESTAMPTZ(6),
    "finalized_at" TIMESTAMPTZ(6),
    "paid_at" TIMESTAMPTZ(6),
    "voided_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);



CREATE TABLE "oms_allocations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "strategy_id" UUID,
    "trader_id" UUID,
    "follower_id" UUID,
    "subscription_id" UUID,
    "account_id" UUID NOT NULL,
    "order_intent_id" UUID,
    "symbol" VARCHAR(32) NOT NULL,
    "side" VARCHAR(8) NOT NULL,
    "intended_quantity" VARCHAR(40) NOT NULL,
    "intended_notional" VARCHAR(40),
    "executed_quantity" VARCHAR(40) NOT NULL DEFAULT '0',
    "executed_notional" VARCHAR(40),
    "remaining_quantity" VARCHAR(40) NOT NULL,
    "remaining_notional" VARCHAR(40),
    "allocation_mode" VARCHAR(32),
    "correlation_id" VARCHAR(64),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "oms_allocations_pkey" PRIMARY KEY ("id")
);



CREATE TABLE "oms_audits" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "event_type" "OmsAuditEventType" NOT NULL,
    "order_intent_id" UUID,
    "internal_order_id" UUID,
    "fill_id" UUID,
    "trade_id" UUID,
    "account_id" UUID,
    "symbol" VARCHAR(32),
    "venue" VARCHAR(32),
    "strategy_id" UUID,
    "trader_id" UUID,
    "follower_id" UUID,
    "actor_id" UUID,
    "actor_type" VARCHAR(16) NOT NULL DEFAULT 'SYSTEM',
    "reason" VARCHAR(1000),
    "correlation_id" VARCHAR(64),
    "request_id" VARCHAR(64),
    "policy_version" VARCHAR(64),
    "risk_rule_id" VARCHAR(64),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "timestamp" VARCHAR(32) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oms_audits_pkey" PRIMARY KEY ("id")
);



CREATE TABLE "oms_execution_acks" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "order_intent_id" UUID NOT NULL,
    "internal_order_id" UUID,
    "client_order_id" VARCHAR(128) NOT NULL,
    "provider_order_id" VARCHAR(128),
    "exchange_order_id" VARCHAR(64),
    "venue" VARCHAR(32) NOT NULL,
    "ack_type" "OmsExecutionAckType" NOT NULL,
    "timestamp_micros" VARCHAR(32) NOT NULL,
    "latency_micros" VARCHAR(32),
    "provider_error_code" VARCHAR(128),
    "provider_error_message" VARCHAR(500),
    "raw_ack_ref" VARCHAR(128),
    "correlation_id" VARCHAR(64),
    "source" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oms_execution_acks_pkey" PRIMARY KEY ("id")
);



CREATE TABLE "oms_execution_latency" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "order_intent_id" UUID NOT NULL,
    "signal_timestamp" VARCHAR(32),
    "intent_timestamp" VARCHAR(32) NOT NULL,
    "submit_timestamp" VARCHAR(32),
    "ack_timestamp" VARCHAR(32),
    "first_fill_timestamp" VARCHAR(32),
    "complete_fill_timestamp" VARCHAR(32),
    "signal_timestamp_micros" VARCHAR(32),
    "intent_timestamp_micros" VARCHAR(32),
    "submit_timestamp_micros" VARCHAR(32),
    "ack_timestamp_micros" VARCHAR(32),
    "first_fill_timestamp_micros" VARCHAR(32),
    "complete_fill_timestamp_micros" VARCHAR(32),
    "signal_to_intent_ms" VARCHAR(16),
    "intent_to_submit_ms" VARCHAR(16),
    "submit_to_ack_ms" VARCHAR(16),
    "ack_to_first_fill_ms" VARCHAR(16),
    "first_fill_to_complete_ms" VARCHAR(16),
    "total_latency_ms" VARCHAR(16),
    "clock_skew_detected" BOOLEAN NOT NULL DEFAULT false,
    "missing_timestamps" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "calculated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oms_execution_latency_pkey" PRIMARY KEY ("id")
);



CREATE TABLE "oms_execution_quality" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "account_id" UUID,
    "symbol" VARCHAR(32),
    "venue" VARCHAR(32),
    "strategy_id" UUID,
    "trader_id" UUID,
    "period_start" VARCHAR(32) NOT NULL,
    "period_end" VARCHAR(32) NOT NULL,
    "total_orders" INTEGER NOT NULL,
    "filled_orders" INTEGER NOT NULL,
    "partially_filled_orders" INTEGER NOT NULL,
    "cancelled_orders" INTEGER NOT NULL,
    "rejected_orders" INTEGER NOT NULL,
    "fill_ratio" VARCHAR(16),
    "rejection_rate" VARCHAR(16),
    "completion_rate" VARCHAR(16),
    "average_slippage" VARCHAR(16),
    "median_slippage" VARCHAR(16),
    "p95_slippage" VARCHAR(16),
    "implementation_shortfall" VARCHAR(16),
    "price_improvement" VARCHAR(16),
    "average_fill_latency_ms" VARCHAR(16),
    "median_fill_latency_ms" VARCHAR(16),
    "p95_fill_latency_ms" VARCHAR(16),
    "fee_impact" VARCHAR(40),
    "total_fees" VARCHAR(40),
    "benchmark_method" VARCHAR(64) NOT NULL,
    "observation_count" INTEGER NOT NULL,
    "note" VARCHAR(500) NOT NULL,
    "calculated_at" TIMESTAMPTZ(6) NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oms_execution_quality_pkey" PRIMARY KEY ("id")
);



CREATE TABLE "oms_fills" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "order_intent_id" UUID NOT NULL,
    "internal_order_id" UUID,
    "provider_fill_id" VARCHAR(128) NOT NULL,
    "provider_order_id" VARCHAR(128),
    "exchange_order_id" VARCHAR(64),
    "symbol" VARCHAR(32) NOT NULL,
    "venue" VARCHAR(32),
    "side" VARCHAR(8) NOT NULL,
    "quantity" VARCHAR(40) NOT NULL,
    "price" VARCHAR(40) NOT NULL,
    "fee" VARCHAR(40) NOT NULL DEFAULT '0',
    "fee_currency" VARCHAR(16) NOT NULL DEFAULT 'USDT',
    "quote_quantity" VARCHAR(40),
    "liquidity" VARCHAR(16),
    "state" "OmsFillState" NOT NULL DEFAULT 'RECEIVED',
    "timestamp_micros" VARCHAR(32) NOT NULL,
    "exchange_timestamp_micros" VARCHAR(32),
    "received_timestamp_micros" VARCHAR(32) NOT NULL,
    "cumulative_quantity" VARCHAR(40),
    "average_price" VARCHAR(40),
    "correlation_id" VARCHAR(64),
    "source" VARCHAR(32) NOT NULL,
    "is_simulated" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oms_fills_pkey" PRIMARY KEY ("id")
);



CREATE TABLE "oms_operational" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "type" "OmsOperationalType" NOT NULL,
    "state" "OmsOperationalState" NOT NULL DEFAULT 'PENDING',
    "order_intent_id" UUID,
    "internal_order_id" UUID,
    "symbol" VARCHAR(32),
    "venue" VARCHAR(32),
    "account_id" UUID,
    "summary" VARCHAR(1000) NOT NULL,
    "acknowledged_by" UUID,
    "acknowledged_at" TIMESTAMPTZ(6),
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "last_retry_at" TIMESTAMPTZ(6),
    "operator_notes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "correlation_id" VARCHAR(64),
    "requested_by" UUID,
    "reason" VARCHAR(500),
    "recovery_type" VARCHAR(32),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "oms_operational_pkey" PRIMARY KEY ("id")
);



CREATE TABLE "oms_order_intents" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "strategy_id" UUID,
    "trader_id" UUID,
    "follower_id" UUID,
    "subscription_id" UUID,
    "symbol" VARCHAR(32) NOT NULL,
    "venue" VARCHAR(32),
    "side" VARCHAR(8) NOT NULL,
    "order_type" VARCHAR(16) NOT NULL,
    "time_in_force" VARCHAR(8) NOT NULL DEFAULT 'GTC',
    "quantity" VARCHAR(40) NOT NULL,
    "price" VARCHAR(40),
    "stop_price" VARCHAR(40),
    "reduce_only" BOOLEAN NOT NULL DEFAULT false,
    "environment" VARCHAR(8) NOT NULL,
    "state" "OmsOrderIntentState" NOT NULL DEFAULT 'CREATED',
    "client_order_id" VARCHAR(128) NOT NULL,
    "exchange_order_id" VARCHAR(64),
    "provider_order_id" VARCHAR(128),
    "signal_id" VARCHAR(128),
    "risk_decision_id" UUID,
    "compliance_decision_id" VARCHAR(128),
    "risk_policy_version" VARCHAR(64),
    "compliance_policy_version" VARCHAR(64),
    "rejection_category" VARCHAR(32),
    "rejection_reason" VARCHAR(1000),
    "filled_quantity" VARCHAR(40) NOT NULL DEFAULT '0',
    "average_fill_price" VARCHAR(40),
    "cumulative_fee" VARCHAR(40) NOT NULL DEFAULT '0',
    "fee_currency" VARCHAR(16),
    "correlation_id" VARCHAR(64),
    "request_id" VARCHAR(64),
    "source" VARCHAR(32) NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "is_simulated" BOOLEAN NOT NULL DEFAULT false,
    "was_dry_run" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "submitted_at" TIMESTAMPTZ(6),
    "acknowledged_at" TIMESTAMPTZ(6),
    "terminal_at" TIMESTAMPTZ(6),

    CONSTRAINT "oms_order_intents_pkey" PRIMARY KEY ("id")
);



CREATE TABLE "oms_post_trades" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "order_intent_id" UUID NOT NULL,
    "trade_id" UUID,
    "account_id" UUID NOT NULL,
    "symbol" VARCHAR(32) NOT NULL,
    "venue" VARCHAR(32),
    "total_filled_quantity" VARCHAR(40) NOT NULL,
    "average_fill_price" VARCHAR(40),
    "total_fees" VARCHAR(40) NOT NULL,
    "fee_currency" VARCHAR(16),
    "settlement_ref" VARCHAR(128),
    "fee_accrual_ref" UUID,
    "usage_event_ref" UUID,
    "notification_ref" UUID,
    "trade_lifecycle_ref" UUID,
    "reconciliation_triggered" BOOLEAN NOT NULL DEFAULT false,
    "completed_at" TIMESTAMPTZ(6) NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oms_post_trades_pkey" PRIMARY KEY ("id")
);



CREATE TABLE "oms_reconciliations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "order_intent_id" UUID,
    "internal_order_id" UUID,
    "provider_order_id" VARCHAR(128),
    "provider_fill_id" VARCHAR(128),
    "category" "OmsReconciliationCategory" NOT NULL,
    "severity" VARCHAR(16) NOT NULL,
    "expected" JSONB DEFAULT '{}',
    "actual" JSONB DEFAULT '{}',
    "summary" VARCHAR(1000) NOT NULL,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "resolved_at" TIMESTAMPTZ(6),
    "resolved_by" UUID,
    "resolution_note" VARCHAR(1000),
    "correlation_id" VARCHAR(64),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oms_reconciliations_pkey" PRIMARY KEY ("id")
);



CREATE TABLE "oms_rejections" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "order_intent_id" UUID NOT NULL,
    "category" "OmsRejectionCategory" NOT NULL,
    "reason" VARCHAR(1000) NOT NULL,
    "provider_code" VARCHAR(128),
    "provider_message" VARCHAR(500),
    "risk_rule_id" VARCHAR(64),
    "compliance_rule_id" VARCHAR(64),
    "venue" VARCHAR(32),
    "symbol" VARCHAR(32),
    "account_id" UUID,
    "strategy_id" UUID,
    "timestamp" VARCHAR(32) NOT NULL,
    "correlation_id" VARCHAR(64),
    "is_retriable" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oms_rejections_pkey" PRIMARY KEY ("id")
);



CREATE TABLE "oms_trades" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "symbol" VARCHAR(32) NOT NULL,
    "venue" VARCHAR(32),
    "strategy_id" UUID,
    "trader_id" UUID,
    "follower_id" UUID,
    "state" "OmsTradeState" NOT NULL DEFAULT 'OPEN',
    "side" VARCHAR(8) NOT NULL,
    "open_quantity" VARCHAR(40) NOT NULL,
    "closed_quantity" VARCHAR(40) NOT NULL DEFAULT '0',
    "remaining_quantity" VARCHAR(40) NOT NULL,
    "average_entry_price" VARCHAR(40),
    "average_exit_price" VARCHAR(40),
    "total_fee" VARCHAR(40) NOT NULL DEFAULT '0',
    "order_ids" TEXT[],
    "fill_ids" TEXT[],
    "position_ref" VARCHAR(128),
    "opened_at" TIMESTAMPTZ(6),
    "closed_at" TIMESTAMPTZ(6),
    "correlation_id" VARCHAR(64),
    "is_simulated" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "order_intent_id" UUID,

    CONSTRAINT "oms_trades_pkey" PRIMARY KEY ("id")
);



CREATE TABLE "oms_venue_scores" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "venue" VARCHAR(32) NOT NULL,
    "period_start" VARCHAR(32) NOT NULL,
    "period_end" VARCHAR(32) NOT NULL,
    "total_orders" INTEGER NOT NULL,
    "filled_orders" INTEGER NOT NULL,
    "rejected_orders" INTEGER NOT NULL,
    "average_latency_ms" VARCHAR(16),
    "median_latency_ms" VARCHAR(16),
    "p95_latency_ms" VARCHAR(16),
    "fill_ratio" VARCHAR(16),
    "rejection_rate" VARCHAR(16),
    "average_slippage" VARCHAR(16),
    "provider_error_count" INTEGER NOT NULL DEFAULT 0,
    "rate_limit_count" INTEGER NOT NULL DEFAULT 0,
    "stale_data_count" INTEGER NOT NULL DEFAULT 0,
    "methodology" VARCHAR(500) NOT NULL,
    "observation_count" INTEGER NOT NULL,
    "score_components" JSONB NOT NULL,
    "note" VARCHAR(500) NOT NULL,
    "calculated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oms_venue_scores_pkey" PRIMARY KEY ("id")
);



CREATE TABLE "operational_actions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID,
    "action_type" "OperationalActionType" NOT NULL,
    "status" "OperationalActionStatus" NOT NULL DEFAULT 'PENDING',
    "target_type" VARCHAR(64),
    "target_id" VARCHAR(128),
    "incident_id" UUID,
    "maintenance_window_id" UUID,
    "reconciliation_run_id" UUID,
    "recovery_run_id" UUID,
    "actor_id" UUID,
    "actor_type" VARCHAR(32) NOT NULL DEFAULT 'USER',
    "reason" VARCHAR(1000),
    "preconditions" JSONB NOT NULL DEFAULT '{}',
    "result" JSONB NOT NULL DEFAULT '{}',
    "correlation_id" VARCHAR(64),
    "request_id" VARCHAR(64),
    "idempotency_key" VARCHAR(255) NOT NULL,
    "audit_reference" VARCHAR(128),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "operational_actions_pkey" PRIMARY KEY ("id")
);



CREATE TABLE "operational_audit_logs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID,
    "event_type" "OperationalAuditEventType" NOT NULL,
    "actor_id" UUID,
    "actor_type" VARCHAR(32) NOT NULL DEFAULT 'SYSTEM',
    "target_type" VARCHAR(64),
    "target_id" VARCHAR(128),
    "evidence" JSONB NOT NULL DEFAULT '{}',
    "correlation_id" VARCHAR(64),
    "request_id" VARCHAR(64),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "operational_audit_logs_pkey" PRIMARY KEY ("id")
);



CREATE TABLE "operational_dependency_checks" (
    "id" UUID NOT NULL,
    "tenant_id" UUID,
    "dependency_type" "OperationalDependencyType" NOT NULL,
    "dependency_name" VARCHAR(128) NOT NULL,
    "state" "OperationalDependencyState" NOT NULL,
    "latency_ms" INTEGER,
    "error_code" VARCHAR(64),
    "error_message" VARCHAR(500),
    "evidence" JSONB NOT NULL DEFAULT '{}',
    "checked_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "operational_dependency_checks_pkey" PRIMARY KEY ("id")
);



CREATE TABLE "operational_incident_events" (
    "id" UUID NOT NULL,
    "tenant_id" UUID,
    "incident_id" UUID NOT NULL,
    "event_type" VARCHAR(64) NOT NULL,
    "from_state" "OperationalIncidentState",
    "to_state" "OperationalIncidentState",
    "actor_id" UUID,
    "actor_type" VARCHAR(32) NOT NULL DEFAULT 'SYSTEM',
    "reason" VARCHAR(1000),
    "evidence" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "operational_incident_events_pkey" PRIMARY KEY ("id")
);



CREATE TABLE "operational_incidents" (
    "id" UUID NOT NULL,
    "tenant_id" UUID,
    "fingerprint" VARCHAR(128) NOT NULL,
    "type" VARCHAR(128) NOT NULL,
    "severity" "OperationalIncidentSeverity" NOT NULL,
    "state" "OperationalIncidentState" NOT NULL DEFAULT 'OPEN',
    "title" VARCHAR(255) NOT NULL,
    "summary" VARCHAR(1000) NOT NULL,
    "source" VARCHAR(64) NOT NULL,
    "affected_component" VARCHAR(128) NOT NULL,
    "affected_capability" VARCHAR(128),
    "evidence" JSONB NOT NULL DEFAULT '{}',
    "correlation_id" VARCHAR(64),
    "request_id" VARCHAR(64),
    "idempotency_key" VARCHAR(255) NOT NULL,
    "first_seen_at" TIMESTAMPTZ(6) NOT NULL,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL,
    "occurrence_count" INTEGER NOT NULL DEFAULT 1,
    "assigned_operator_id" UUID,
    "acknowledged_at" TIMESTAMPTZ(6),
    "acknowledged_by" UUID,
    "escalated_at" TIMESTAMPTZ(6),
    "escalation_history" JSONB NOT NULL DEFAULT '[]',
    "resolved_at" TIMESTAMPTZ(6),
    "resolved_by" UUID,
    "resolution_note" VARCHAR(1000),
    "suppressed_at" TIMESTAMPTZ(6),
    "suppressed_by" UUID,
    "suppression_reason" VARCHAR(500),
    "suppress_until" TIMESTAMPTZ(6),
    "reopened_at" TIMESTAMPTZ(6),
    "reopened_by" UUID,
    "reopen_reason" VARCHAR(500),
    "audit_reference" VARCHAR(128),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "operational_incidents_pkey" PRIMARY KEY ("id")
);



CREATE TABLE "operational_maintenance_windows" (
    "id" UUID NOT NULL,
    "tenant_id" UUID,
    "scope" "OperationalMaintenanceScope" NOT NULL,
    "scope_target" VARCHAR(128),
    "state" "OperationalMaintenanceState" NOT NULL DEFAULT 'SCHEDULED',
    "title" VARCHAR(255) NOT NULL,
    "description" VARCHAR(2000),
    "scheduled_start" TIMESTAMPTZ(6) NOT NULL,
    "scheduled_end" TIMESTAMPTZ(6) NOT NULL,
    "actual_start" TIMESTAMPTZ(6),
    "actual_end" TIMESTAMPTZ(6),
    "requested_by" UUID,
    "approved_by" UUID,
    "cancelled_by" UUID,
    "cancellation_reason" VARCHAR(500),
    "conflict_checked" BOOLEAN NOT NULL DEFAULT false,
    "is_emergency" BOOLEAN NOT NULL DEFAULT false,
    "idempotency_key" VARCHAR(255) NOT NULL,
    "correlation_id" VARCHAR(64),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "audit_reference" VARCHAR(128),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "operational_maintenance_windows_pkey" PRIMARY KEY ("id")
);



CREATE TABLE "operational_readiness_checks" (
    "id" UUID NOT NULL,
    "tenant_id" UUID,
    "state" "OperationalReadinessState" NOT NULL,
    "is_ready" BOOLEAN NOT NULL,
    "blocking_reasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "degraded_components" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "evidence" JSONB NOT NULL DEFAULT '{}',
    "requested_by" UUID,
    "correlation_id" VARCHAR(64),
    "checked_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "operational_readiness_checks_pkey" PRIMARY KEY ("id")
);



CREATE TABLE "operational_reconciliation_runs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID,
    "scope" VARCHAR(32) NOT NULL,
    "reconciliation_type" "OperationalReconciliationType" NOT NULL,
    "requested_by" UUID,
    "trigger_type" "OperationalTriggerType" NOT NULL DEFAULT 'MANUAL',
    "status" "OperationalReconciliationRunState" NOT NULL DEFAULT 'PENDING',
    "start_time" TIMESTAMPTZ(6),
    "finish_time" TIMESTAMPTZ(6),
    "duration_ms" INTEGER,
    "subsystem_results" JSONB NOT NULL DEFAULT '{}',
    "failure_details" JSONB,
    "retry_metadata" JSONB NOT NULL DEFAULT '{}',
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 3,
    "correlation_id" VARCHAR(64),
    "idempotency_key" VARCHAR(255) NOT NULL,
    "parent_run_id" UUID,
    "audit_reference" VARCHAR(128),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "operational_reconciliation_runs_pkey" PRIMARY KEY ("id")
);



CREATE TABLE "operational_recovery_runs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID,
    "plan_id" VARCHAR(128),
    "incident_id" UUID,
    "maintenance_window_id" UUID,
    "state" "OperationalRecoveryState" NOT NULL DEFAULT 'PENDING',
    "requested_by" UUID,
    "approved_by" UUID,
    "steps" JSONB NOT NULL DEFAULT '[]',
    "current_step" INTEGER NOT NULL DEFAULT 0,
    "total_steps" INTEGER NOT NULL DEFAULT 0,
    "result" JSONB NOT NULL DEFAULT '{}',
    "failure_reason" VARCHAR(1000),
    "started_at" TIMESTAMPTZ(6),
    "finished_at" TIMESTAMPTZ(6),
    "duration_ms" INTEGER,
    "correlation_id" VARCHAR(64),
    "idempotency_key" VARCHAR(255) NOT NULL,
    "audit_reference" VARCHAR(128),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "operational_recovery_runs_pkey" PRIMARY KEY ("id")
);



CREATE TABLE "operational_service_degradations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID,
    "service_name" VARCHAR(128) NOT NULL,
    "capability" VARCHAR(128),
    "level" "OperationalDegradationLevel" NOT NULL,
    "previous_level" "OperationalDegradationLevel",
    "reason" VARCHAR(1000) NOT NULL,
    "requested_by" UUID,
    "approved_by" UUID,
    "allowed_operations" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "blocked_operations" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "starts_at" TIMESTAMPTZ(6) NOT NULL,
    "ends_at" TIMESTAMPTZ(6),
    "correlation_id" VARCHAR(64),
    "audit_reference" VARCHAR(128),
    "idempotency_key" VARCHAR(255) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "operational_service_degradations_pkey" PRIMARY KEY ("id")
);



CREATE TABLE "overage_records" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "meter_key" VARCHAR(64) NOT NULL,
    "limit_key" VARCHAR(64) NOT NULL,
    "period_id" VARCHAR(255) NOT NULL,
    "period_start" TIMESTAMPTZ(6) NOT NULL,
    "period_end" TIMESTAMPTZ(6) NOT NULL,
    "allowed_quantity" INTEGER NOT NULL,
    "actual_quantity" INTEGER NOT NULL,
    "excess_quantity" INTEGER NOT NULL,
    "unit" VARCHAR(32) NOT NULL,
    "policy_reference" VARCHAR(255),
    "rate_reference" VARCHAR(255),
    "rate_bps" INTEGER,
    "estimated_amount" VARCHAR(32),
    "currency" VARCHAR(3),
    "status" VARCHAR(32) NOT NULL DEFAULT 'DETECTED',
    "idempotency_key" VARCHAR(255) NOT NULL,
    "calculation_timestamp" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "overage_records_pkey" PRIMARY KEY ("id")
);



CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "plan_id" UUID,
    "subscription_id" UUID,
    "provider" VARCHAR(32) NOT NULL,
    "provider_payment_id" VARCHAR(255),
    "provider_checkout_id" VARCHAR(255),
    "provider_session_id" VARCHAR(255),
    "provider_invoice_id" VARCHAR(255),
    "provider_reference" JSONB,
    "order_id" VARCHAR(255),
    "status" VARCHAR(32) NOT NULL DEFAULT 'CREATED',
    "amount" VARCHAR(32) NOT NULL DEFAULT '0',
    "currency" VARCHAR(3) NOT NULL DEFAULT 'USD',
    "refunded_amount" VARCHAR(32) NOT NULL DEFAULT '0',
    "failure_reason" VARCHAR(1000),
    "failure_code" VARCHAR(64),
    "idempotency_key" VARCHAR(255) NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "paid_at" TIMESTAMPTZ(6),
    "failed_at" TIMESTAMPTZ(6),
    "cancelled_at" TIMESTAMPTZ(6),
    "refunded_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);



CREATE TABLE "payouts" (
    "id" UUID NOT NULL,
    "settlement_id" UUID NOT NULL,
    "beneficiary_id" VARCHAR(255) NOT NULL,
    "beneficiary_type" VARCHAR(32) NOT NULL,
    "tenant_id" UUID NOT NULL,
    "amount" VARCHAR(32) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "destination" JSONB NOT NULL DEFAULT '{}',
    "provider" VARCHAR(32) NOT NULL,
    "provider_payout_id" VARCHAR(255),
    "provider_reference" VARCHAR(255),
    "status" VARCHAR(32) NOT NULL DEFAULT 'CREATED',
    "failure_reason" VARCHAR(1000),
    "idempotency_key" VARCHAR(255) NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "safe_metadata" JSONB NOT NULL DEFAULT '{}',
    "processed_at" TIMESTAMPTZ(6),
    "succeeded_at" TIMESTAMPTZ(6),
    "failed_at" TIMESTAMPTZ(6),
    "cancelled_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "payouts_pkey" PRIMARY KEY ("id")
);



CREATE TABLE "portfolio_accounting_adjustments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "original_event_id" UUID,
    "adjustment_type" "PortfolioAdjustmentType" NOT NULL,
    "reason" VARCHAR(1000) NOT NULL,
    "requested_by" UUID,
    "approved_by" UUID,
    "original_values" JSONB,
    "adjusted_values" JSONB NOT NULL,
    "amount" VARCHAR(64),
    "currency" VARCHAR(16),
    "reversal_event_id" UUID,
    "calculation_version" VARCHAR(64) NOT NULL,
    "policy_version" VARCHAR(64) NOT NULL,
    "correlation_id" VARCHAR(64),
    "idempotency_key" VARCHAR(255) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portfolio_accounting_adjustments_pkey" PRIMARY KEY ("id")
);



CREATE TABLE "portfolio_accounting_closes" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "period_id" UUID NOT NULL,
    "requested_by" UUID,
    "closed_by" UUID,
    "validation_passed" BOOLEAN NOT NULL DEFAULT false,
    "validation_evidence" JSONB NOT NULL DEFAULT '{}',
    "failure_evidence" JSONB,
    "closing_nav" VARCHAR(64),
    "opening_nav_next" VARCHAR(64),
    "reconciliation_status" VARCHAR(32),
    "calculation_version" VARCHAR(64) NOT NULL,
    "policy_version" VARCHAR(64) NOT NULL,
    "idempotency_key" VARCHAR(255) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portfolio_accounting_closes_pkey" PRIMARY KEY ("id")
);



CREATE TABLE "portfolio_accounting_events" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "event_type" VARCHAR(64) NOT NULL,
    "cash_flow_type" "PortfolioCashFlowType",
    "source_type" VARCHAR(64) NOT NULL,
    "source_id" VARCHAR(255) NOT NULL,
    "source_timestamp" TIMESTAMPTZ(6) NOT NULL,
    "idempotency_key" VARCHAR(255) NOT NULL,
    "fingerprint" VARCHAR(128) NOT NULL,
    "asset" VARCHAR(32),
    "quantity" VARCHAR(64),
    "price" VARCHAR(64),
    "amount" VARCHAR(64),
    "fee_amount" VARCHAR(64),
    "currency" VARCHAR(16),
    "order_id" VARCHAR(128),
    "fill_id" VARCHAR(128),
    "trade_id" VARCHAR(128),
    "fee_accrual_id" UUID,
    "finance_ledger_id" VARCHAR(128),
    "copy_allocation_id" VARCHAR(128),
    "base_currency" VARCHAR(16),
    "conversion_rate" VARCHAR(64),
    "conversion_source" VARCHAR(64),
    "conversion_timestamp" TIMESTAMPTZ(6),
    "conversion_status" VARCHAR(32),
    "calculation_version" VARCHAR(64) NOT NULL,
    "policy_version" VARCHAR(64) NOT NULL,
    "is_reversed" BOOLEAN NOT NULL DEFAULT false,
    "reversed_by_event_id" UUID,
    "correlation_id" VARCHAR(64),
    "request_id" VARCHAR(64),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "evidence" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portfolio_accounting_events_pkey" PRIMARY KEY ("id")
);



CREATE TABLE "portfolio_accounting_periods" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "period_start" TIMESTAMPTZ(6) NOT NULL,
    "period_end" TIMESTAMPTZ(6) NOT NULL,
    "state" "PortfolioPeriodState" NOT NULL DEFAULT 'OPEN',
    "opening_nav" VARCHAR(64),
    "closing_nav" VARCHAR(64),
    "total_deposits" VARCHAR(64),
    "total_withdrawals" VARCHAR(64),
    "total_fees" VARCHAR(64),
    "realized_pnl" VARCHAR(64),
    "unrealized_pnl" VARCHAR(64),
    "net_pnl" VARCHAR(64),
    "return_percent" VARCHAR(32),
    "base_currency" VARCHAR(16) NOT NULL,
    "calculation_version" VARCHAR(64) NOT NULL,
    "policy_version" VARCHAR(64) NOT NULL,
    "close_metadata" JSONB,
    "validation_evidence" JSONB,
    "idempotency_key" VARCHAR(255) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "closed_at" TIMESTAMPTZ(6),

    CONSTRAINT "portfolio_accounting_periods_pkey" PRIMARY KEY ("id")
);



CREATE TABLE "portfolio_accounting_profiles" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "scope" "PortfolioAccountingScope" NOT NULL,
    "scope_id" VARCHAR(128) NOT NULL,
    "portfolio_type" "PortfolioType" NOT NULL DEFAULT 'SPOT',
    "base_currency" VARCHAR(16) NOT NULL DEFAULT 'USD',
    "valuation_currency" VARCHAR(16),
    "return_methodology" "PortfolioReturnMethodology" NOT NULL DEFAULT 'TIME_WEIGHTED_RETURN',
    "cost_basis_method" VARCHAR(16) NOT NULL DEFAULT 'FIFO',
    "fee_treatment" VARCHAR(32) NOT NULL DEFAULT 'NET',
    "valuation_frequency" VARCHAR(32) NOT NULL DEFAULT 'DAILY',
    "period_boundary" VARCHAR(32) NOT NULL DEFAULT 'UTC_MIDNIGHT',
    "rounding_mode" VARCHAR(16) NOT NULL DEFAULT 'HALF_UP',
    "rounding_scale" INTEGER NOT NULL DEFAULT 8,
    "policy_version" VARCHAR(64) NOT NULL,
    "calculation_version" VARCHAR(64) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "portfolio_accounting_profiles_pkey" PRIMARY KEY ("id")
);



CREATE TABLE "portfolio_accounting_reconciliations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "profile_id" UUID,
    "reconciliation_type" VARCHAR(64) NOT NULL,
    "state" "PortfolioReconciliationState" NOT NULL DEFAULT 'PENDING',
    "expected" JSONB DEFAULT '{}',
    "actual" JSONB DEFAULT '{}',
    "discrepancy" JSONB DEFAULT '{}',
    "summary" VARCHAR(1000) NOT NULL,
    "severity" VARCHAR(16) NOT NULL DEFAULT 'MEDIUM',
    "is_critical" BOOLEAN NOT NULL DEFAULT false,
    "source_type" VARCHAR(64),
    "source_id" VARCHAR(255),
    "period_id" UUID,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "resolved_at" TIMESTAMPTZ(6),
    "resolved_by" UUID,
    "resolution_note" VARCHAR(1000),
    "calculation_version" VARCHAR(64) NOT NULL,
    "policy_version" VARCHAR(64),
    "correlation_id" VARCHAR(64),
    "idempotency_key" VARCHAR(255) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "portfolio_accounting_reconciliations_pkey" PRIMARY KEY ("id")
);



CREATE TABLE "portfolio_attribution_records" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "period_id" UUID,
    "dimension" "PortfolioAttributionDimension" NOT NULL,
    "dimension_id" VARCHAR(128) NOT NULL,
    "pnl_contribution" VARCHAR(64) NOT NULL,
    "gross_pnl" VARCHAR(64),
    "fees" VARCHAR(64),
    "net_pnl" VARCHAR(64),
    "quantity" VARCHAR(64),
    "exposure" VARCHAR(64),
    "base_currency" VARCHAR(16) NOT NULL,
    "calculation_version" VARCHAR(64) NOT NULL,
    "policy_version" VARCHAR(64) NOT NULL,
    "data_completeness" VARCHAR(32) NOT NULL DEFAULT 'COMPLETE',
    "source_references" JSONB NOT NULL DEFAULT '[]',
    "evidence" JSONB NOT NULL DEFAULT '{}',
    "idempotency_key" VARCHAR(255) NOT NULL,
    "period_start" TIMESTAMPTZ(6) NOT NULL,
    "period_end" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portfolio_attribution_records_pkey" PRIMARY KEY ("id")
);



CREATE TABLE "portfolio_cash_ledger_entries" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "accounting_event_id" UUID,
    "cash_flow_type" "PortfolioCashFlowType" NOT NULL,
    "asset" VARCHAR(32) NOT NULL,
    "amount" VARCHAR(64) NOT NULL,
    "currency" VARCHAR(16) NOT NULL,
    "running_balance" VARCHAR(64),
    "base_currency" VARCHAR(16) NOT NULL,
    "base_currency_amount" VARCHAR(64),
    "conversion_rate" VARCHAR(64),
    "conversion_source" VARCHAR(64),
    "conversion_timestamp" TIMESTAMPTZ(6),
    "conversion_status" VARCHAR(32),
    "source_type" VARCHAR(64),
    "source_id" VARCHAR(255),
    "idempotency_key" VARCHAR(255) NOT NULL,
    "calculation_version" VARCHAR(64) NOT NULL,
    "policy_version" VARCHAR(64) NOT NULL,
    "correlation_id" VARCHAR(64),
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portfolio_cash_ledger_entries_pkey" PRIMARY KEY ("id")
);



CREATE TABLE "portfolio_performance_records" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "period_id" UUID,
    "methodology" "PortfolioReturnMethodology" NOT NULL,
    "period_start" TIMESTAMPTZ(6) NOT NULL,
    "period_end" TIMESTAMPTZ(6) NOT NULL,
    "starting_nav" VARCHAR(64),
    "ending_nav" VARCHAR(64),
    "external_cash_flows" JSONB NOT NULL DEFAULT '[]',
    "fees_treatment" VARCHAR(32) NOT NULL,
    "return_percent" VARCHAR(32),
    "benchmark_return" VARCHAR(32),
    "excess_return" VARCHAR(32),
    "base_currency" VARCHAR(16) NOT NULL,
    "calculation_version" VARCHAR(64) NOT NULL,
    "policy_version" VARCHAR(64) NOT NULL,
    "data_completeness" VARCHAR(32) NOT NULL DEFAULT 'COMPLETE',
    "valuation_timestamp" TIMESTAMPTZ(6),
    "source_references" JSONB NOT NULL DEFAULT '[]',
    "evidence" JSONB NOT NULL DEFAULT '{}',
    "idempotency_key" VARCHAR(255) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portfolio_performance_records_pkey" PRIMARY KEY ("id")
);



CREATE TABLE "portfolio_position_lots" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "accounting_event_id" UUID,
    "symbol" VARCHAR(64) NOT NULL,
    "asset" VARCHAR(32) NOT NULL,
    "venue" VARCHAR(32),
    "classification" "PortfolioPositionClassification" NOT NULL,
    "opening_event_id" UUID,
    "closing_event_id" UUID,
    "parent_lot_id" UUID,
    "quantity" VARCHAR(64) NOT NULL,
    "remaining_quantity" VARCHAR(64) NOT NULL,
    "cost_basis_per_unit" VARCHAR(64),
    "total_cost_basis" VARCHAR(64),
    "realized_pnl" VARCHAR(64),
    "currency" VARCHAR(16) NOT NULL,
    "base_currency" VARCHAR(16) NOT NULL,
    "cost_basis_method" VARCHAR(16) NOT NULL,
    "calculation_version" VARCHAR(64) NOT NULL,
    "policy_version" VARCHAR(64) NOT NULL,
    "is_closed" BOOLEAN NOT NULL DEFAULT false,
    "is_reversed" BOOLEAN NOT NULL DEFAULT false,
    "opened_at" TIMESTAMPTZ(6) NOT NULL,
    "closed_at" TIMESTAMPTZ(6),
    "idempotency_key" VARCHAR(255) NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "evidence" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "portfolio_position_lots_pkey" PRIMARY KEY ("id")
);



CREATE TABLE "portfolio_snapshots" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "snapshot_id" VARCHAR(128) NOT NULL,
    "timestamp" TIMESTAMPTZ(6) NOT NULL,
    "base_currency" VARCHAR(16) NOT NULL,
    "cash" VARCHAR(64) NOT NULL,
    "gross_asset_value" VARCHAR(64),
    "gross_liability" VARCHAR(64),
    "nav" VARCHAR(64) NOT NULL,
    "realized_pnl" VARCHAR(64),
    "unrealized_pnl" VARCHAR(64),
    "gross_pnl" VARCHAR(64),
    "fees" VARCHAR(64),
    "net_pnl" VARCHAR(64),
    "positions" JSONB NOT NULL DEFAULT '[]',
    "cash_breakdown" JSONB NOT NULL DEFAULT '{}',
    "performance_metrics" JSONB NOT NULL DEFAULT '{}',
    "valuation_evidence" JSONB NOT NULL DEFAULT '{}',
    "source_references" JSONB NOT NULL DEFAULT '[]',
    "calculation_version" VARCHAR(64) NOT NULL,
    "policy_version" VARCHAR(64) NOT NULL,
    "data_completeness" VARCHAR(32) NOT NULL DEFAULT 'COMPLETE',
    "idempotency_key" VARCHAR(255) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portfolio_snapshots_pkey" PRIMARY KEY ("id")
);



CREATE TABLE "portfolio_statements" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "period_id" UUID,
    "statement_id" VARCHAR(128) NOT NULL,
    "state" "PortfolioStatementState" NOT NULL DEFAULT 'DRAFT',
    "period_start" TIMESTAMPTZ(6) NOT NULL,
    "period_end" TIMESTAMPTZ(6) NOT NULL,
    "opening_nav" VARCHAR(64),
    "closing_nav" VARCHAR(64),
    "deposits" VARCHAR(64),
    "withdrawals" VARCHAR(64),
    "transfers" VARCHAR(64),
    "trading_activity" JSONB NOT NULL DEFAULT '[]',
    "realized_pnl" VARCHAR(64),
    "unrealized_pnl" VARCHAR(64),
    "fees" JSONB NOT NULL DEFAULT '{}',
    "net_pnl" VARCHAR(64),
    "return_methodology" VARCHAR(32),
    "return_percent" VARCHAR(32),
    "benchmark_return" VARCHAR(32),
    "ending_holdings" JSONB NOT NULL DEFAULT '[]',
    "cash" VARCHAR(64),
    "reconciliation_status" VARCHAR(32),
    "base_currency" VARCHAR(16) NOT NULL,
    "calculation_version" VARCHAR(64) NOT NULL,
    "policy_version" VARCHAR(64) NOT NULL,
    "source_references" JSONB NOT NULL DEFAULT '[]',
    "evidence" JSONB NOT NULL DEFAULT '{}',
    "idempotency_key" VARCHAR(255) NOT NULL,
    "finalized_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "portfolio_statements_pkey" PRIMARY KEY ("id")
);



CREATE TABLE "portfolio_valuations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "symbol" VARCHAR(64),
    "asset" VARCHAR(32) NOT NULL,
    "valuation_state" "PortfolioValuationState" NOT NULL DEFAULT 'VALID',
    "quantity" VARCHAR(64),
    "market_price" VARCHAR(64),
    "market_price_source" VARCHAR(64),
    "market_price_timestamp" TIMESTAMPTZ(6),
    "gross_value" VARCHAR(64),
    "currency" VARCHAR(16) NOT NULL,
    "base_currency" VARCHAR(16) NOT NULL,
    "base_currency_value" VARCHAR(64),
    "conversion_rate" VARCHAR(64),
    "conversion_source" VARCHAR(64),
    "conversion_timestamp" TIMESTAMPTZ(6),
    "conversion_status" VARCHAR(32),
    "valuation_timestamp" TIMESTAMPTZ(6) NOT NULL,
    "calculation_version" VARCHAR(64) NOT NULL,
    "policy_version" VARCHAR(64) NOT NULL,
    "data_completeness" VARCHAR(32) NOT NULL DEFAULT 'COMPLETE',
    "evidence" JSONB NOT NULL DEFAULT '{}',
    "source_references" JSONB NOT NULL DEFAULT '[]',
    "idempotency_key" VARCHAR(255) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portfolio_valuations_pkey" PRIMARY KEY ("id")
);



CREATE TABLE "refunds" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "invoice_id" UUID,
    "refund_type" VARCHAR(32) NOT NULL,
    "reason" VARCHAR(64) NOT NULL,
    "reason_details" VARCHAR(500),
    "amount" VARCHAR(32) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "status" VARCHAR(32) NOT NULL DEFAULT 'PENDING',
    "provider" VARCHAR(32) NOT NULL,
    "provider_refund_id" VARCHAR(255),
    "provider_status" VARCHAR(64),
    "idempotency_key" VARCHAR(255) NOT NULL,
    "failure_reason" VARCHAR(1000),
    "failure_code" VARCHAR(64),
    "requested_by" UUID,
    "requested_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(6),
    "succeeded_at" TIMESTAMPTZ(6),
    "failed_at" TIMESTAMPTZ(6),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);



CREATE TABLE "research_audit_logs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "event" VARCHAR(64) NOT NULL,
    "actor_id" UUID,
    "strategy_version_id" UUID,
    "dataset_id" UUID,
    "backtest_run_id" UUID,
    "paper_session_id" UUID,
    "signal_id" UUID,
    "promotion_id" UUID,
    "result" VARCHAR(32) NOT NULL DEFAULT 'SUCCESS',
    "safe_metadata" JSONB NOT NULL DEFAULT '{}',
    "request_id" VARCHAR(64),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "research_audit_logs_pkey" PRIMARY KEY ("id")
);



CREATE TABLE "research_backtest_runs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "strategy_version_id" UUID NOT NULL,
    "dataset_id" UUID,
    "dataset_fingerprint" VARCHAR(128),
    "status" "ResearchBacktestStatus" NOT NULL DEFAULT 'QUEUED',
    "config" JSONB NOT NULL DEFAULT '{}',
    "config_fingerprint" VARCHAR(128) NOT NULL,
    "timeframe" VARCHAR(16) NOT NULL,
    "symbols" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "start_time" TIMESTAMPTZ(6) NOT NULL,
    "end_time" TIMESTAMPTZ(6) NOT NULL,
    "initial_capital" VARCHAR(64) NOT NULL,
    "quote_currency" VARCHAR(16) NOT NULL DEFAULT 'USDT',
    "fee_assumption" JSONB NOT NULL DEFAULT '{}',
    "slippage_assumption" JSONB NOT NULL DEFAULT '{}',
    "latency_assumption" JSONB NOT NULL DEFAULT '{}',
    "leverage" VARCHAR(16),
    "benchmark" VARCHAR(64),
    "execution_model" JSONB NOT NULL DEFAULT '{}',
    "run_identifier" VARCHAR(64) NOT NULL,
    "result_summary" JSONB,
    "metrics" JSONB DEFAULT '{}',
    "equity_curve" JSONB DEFAULT '[]',
    "error_code" VARCHAR(64),
    "error_summary" VARCHAR(1000),
    "started_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "idempotency_key" VARCHAR(255),
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "research_backtest_runs_pkey" PRIMARY KEY ("id")
);



CREATE TABLE "research_backtest_snapshots" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "backtest_run_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "timestamp" TIMESTAMPTZ(6) NOT NULL,
    "cash" VARCHAR(64) NOT NULL,
    "equity" VARCHAR(64) NOT NULL,
    "exposure" VARCHAR(64),
    "realized_pnl" VARCHAR(64) NOT NULL DEFAULT '0',
    "unrealized_pnl" VARCHAR(64),
    "drawdown" VARCHAR(64),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "research_backtest_snapshots_pkey" PRIMARY KEY ("id")
);



CREATE TABLE "research_backtest_trades" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "backtest_run_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "symbol" VARCHAR(32) NOT NULL,
    "side" VARCHAR(16) NOT NULL,
    "type" VARCHAR(16) NOT NULL,
    "quantity" VARCHAR(64) NOT NULL,
    "entry_price" VARCHAR(64) NOT NULL,
    "exit_price" VARCHAR(64),
    "gross_pnl" VARCHAR(64),
    "fee" VARCHAR(64) NOT NULL DEFAULT '0',
    "net_pnl" VARCHAR(64),
    "is_win" BOOLEAN,
    "opened_at" TIMESTAMPTZ(6) NOT NULL,
    "closed_at" TIMESTAMPTZ(6),
    "holding_ms" INTEGER,
    "is_simulated" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "research_backtest_trades_pkey" PRIMARY KEY ("id")
);



CREATE TABLE "research_datasets" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" VARCHAR(1000),
    "venue" VARCHAR(32) NOT NULL,
    "symbol" VARCHAR(32) NOT NULL,
    "timeframe" VARCHAR(16) NOT NULL,
    "timezone" VARCHAR(64) NOT NULL DEFAULT 'UTC',
    "source" VARCHAR(64) NOT NULL,
    "source_metadata" JSONB NOT NULL DEFAULT '{}',
    "start_time" TIMESTAMPTZ(6) NOT NULL,
    "end_time" TIMESTAMPTZ(6) NOT NULL,
    "fingerprint" VARCHAR(128) NOT NULL,
    "checksum" VARCHAR(128),
    "status" "ResearchDatasetStatus" NOT NULL DEFAULT 'DRAFT',
    "record_count" INTEGER NOT NULL DEFAULT 0,
    "gap_count" INTEGER NOT NULL DEFAULT 0,
    "duplicate_count" INTEGER NOT NULL DEFAULT 0,
    "validation_result" JSONB,
    "quality_score" DOUBLE PRECISION,
    "idempotency_key" VARCHAR(255),
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "research_datasets_pkey" PRIMARY KEY ("id")
);



CREATE TABLE "research_paper_fills" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "fill_id" VARCHAR(64) NOT NULL,
    "trade_id" VARCHAR(64),
    "symbol" VARCHAR(32) NOT NULL,
    "side" VARCHAR(16) NOT NULL,
    "quantity" VARCHAR(64) NOT NULL,
    "price" VARCHAR(64) NOT NULL,
    "fee" VARCHAR(64) NOT NULL DEFAULT '0',
    "is_maker" BOOLEAN NOT NULL DEFAULT false,
    "is_simulated" BOOLEAN NOT NULL DEFAULT true,
    "timestamp" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "research_paper_fills_pkey" PRIMARY KEY ("id")
);



CREATE TABLE "research_paper_orders" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "order_id" VARCHAR(64) NOT NULL,
    "client_order_id" VARCHAR(128) NOT NULL,
    "symbol" VARCHAR(32) NOT NULL,
    "side" VARCHAR(16) NOT NULL,
    "type" VARCHAR(16) NOT NULL,
    "status" "ResearchPaperOrderStatus" NOT NULL DEFAULT 'PENDING',
    "quantity" VARCHAR(64) NOT NULL,
    "price" VARCHAR(64),
    "stop_price" VARCHAR(64),
    "filled_quantity" VARCHAR(64) NOT NULL DEFAULT '0',
    "average_fill_price" VARCHAR(64),
    "fee" VARCHAR(64) NOT NULL DEFAULT '0',
    "is_simulated" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "research_paper_orders_pkey" PRIMARY KEY ("id")
);



CREATE TABLE "research_paper_sessions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "strategy_version_id" UUID NOT NULL,
    "status" "ResearchPaperSessionStatus" NOT NULL DEFAULT 'CREATED',
    "session_identifier" VARCHAR(64) NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "initial_capital" VARCHAR(64) NOT NULL,
    "current_equity" VARCHAR(64),
    "symbols" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "timeframe" VARCHAR(16) NOT NULL DEFAULT '1m',
    "realized_pnl" VARCHAR(64) NOT NULL DEFAULT '0',
    "unrealized_pnl" VARCHAR(64),
    "max_drawdown" VARCHAR(64),
    "fees_paid" VARCHAR(64) NOT NULL DEFAULT '0',
    "is_simulated" BOOLEAN NOT NULL DEFAULT true,
    "started_at" TIMESTAMPTZ(6),
    "stopped_at" TIMESTAMPTZ(6),
    "expires_at" TIMESTAMPTZ(6),
    "idempotency_key" VARCHAR(255),
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "research_paper_sessions_pkey" PRIMARY KEY ("id")
);



CREATE TABLE "research_paper_snapshots" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "timestamp" TIMESTAMPTZ(6) NOT NULL,
    "cash" VARCHAR(64) NOT NULL,
    "equity" VARCHAR(64) NOT NULL,
    "realized_pnl" VARCHAR(64) NOT NULL DEFAULT '0',
    "unrealized_pnl" VARCHAR(64),
    "drawdown" VARCHAR(64),
    "is_simulated" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "research_paper_snapshots_pkey" PRIMARY KEY ("id")
);



CREATE TABLE "research_promotion_requests" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "strategy_version_id" UUID NOT NULL,
    "state" "ResearchPromotionState" NOT NULL DEFAULT 'DRAFT',
    "backtest_run_id" UUID,
    "paper_session_id" UUID,
    "validation_checklist" JSONB NOT NULL DEFAULT '{}',
    "risk_review" JSONB,
    "compliance_review" JSONB,
    "requested_by" UUID,
    "reviewed_by" UUID,
    "requested_at" TIMESTAMPTZ(6),
    "reviewed_at" TIMESTAMPTZ(6),
    "reason" VARCHAR(1000),
    "idempotency_key" VARCHAR(255),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "research_promotion_requests_pkey" PRIMARY KEY ("id")
);



CREATE TABLE "research_signals" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "strategy_version_id" UUID NOT NULL,
    "signal_key" VARCHAR(128) NOT NULL,
    "symbol" VARCHAR(32) NOT NULL,
    "side" "ResearchSignalSide" NOT NULL,
    "strength" VARCHAR(32),
    "confidence" VARCHAR(32),
    "price" VARCHAR(64),
    "quantity" VARCHAR(64),
    "timestamp" TIMESTAMPTZ(6) NOT NULL,
    "expires_at" TIMESTAMPTZ(6),
    "state" "ResearchSignalState" NOT NULL DEFAULT 'DRAFT',
    "source_event" JSONB,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "idempotency_key" VARCHAR(255),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "research_signals_pkey" PRIMARY KEY ("id")
);



CREATE TABLE "research_strategy_versions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "strategy_id" UUID,
    "trader_strategy_id" UUID,
    "definition_id" UUID,
    "version" VARCHAR(32) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" VARCHAR(1000),
    "status" "ResearchStrategyVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "logic_hash" VARCHAR(128) NOT NULL,
    "config_hash" VARCHAR(128) NOT NULL,
    "fingerprint" VARCHAR(128) NOT NULL,
    "parameters" JSONB NOT NULL DEFAULT '{}',
    "risk_profile" JSONB NOT NULL DEFAULT '{}',
    "execution_model" JSONB NOT NULL DEFAULT '{}',
    "frozen_at" TIMESTAMPTZ(6),
    "published_at" TIMESTAMPTZ(6),
    "deprecated_at" TIMESTAMPTZ(6),
    "parent_version_id" UUID,
    "change_note" VARCHAR(1000),
    "idempotency_key" VARCHAR(255),
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "research_strategy_versions_pkey" PRIMARY KEY ("id")
);



CREATE TABLE "risk_decision_records" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID,
    "account_id" UUID,
    "trader_id" UUID,
    "follower_id" UUID,
    "strategy_id" UUID,
    "symbol" VARCHAR(32),
    "venue" VARCHAR(32),
    "decision" "RiskManagementDecision" NOT NULL,
    "state" "RiskState" NOT NULL DEFAULT 'UNKNOWN',
    "rule_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "policy_version" VARCHAR(64) NOT NULL,
    "blocking_reasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "warnings" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "decision_json" JSONB NOT NULL,
    "exposure_json" JSONB,
    "request_id" VARCHAR(64),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "risk_decision_records_pkey" PRIMARY KEY ("id")
);



CREATE TABLE "risk_management_snapshots" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID,
    "trader_id" UUID,
    "follower_id" UUID,
    "account_id" UUID,
    "strategy_id" UUID,
    "policy_version" VARCHAR(64) NOT NULL,
    "policy_digest" VARCHAR(64),
    "state" "RiskState" NOT NULL DEFAULT 'UNKNOWN',
    "gross_exposure" VARCHAR(64),
    "net_exposure" VARCHAR(64),
    "long_exposure" VARCHAR(64),
    "short_exposure" VARCHAR(64),
    "margin_utilization" VARCHAR(32),
    "leverage_gross" VARCHAR(32),
    "leverage_net" VARCHAR(32),
    "drawdown_abs" VARCHAR(64),
    "drawdown_percent" VARCHAR(32),
    "daily_pnl" VARCHAR(64),
    "daily_loss_budget" VARCHAR(64),
    "concentration_json" JSONB,
    "exposure_json" JSONB,
    "margin_json" JSONB,
    "leverage_json" JSONB,
    "liquidation_json" JSONB,
    "correlation_json" JSONB,
    "var_json" JSONB,
    "stress_json" JSONB,
    "source_timestamps" JSONB NOT NULL DEFAULT '{}',
    "captured_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "risk_management_snapshots_pkey" PRIMARY KEY ("id")
);



CREATE TABLE "risk_reconciliation_records" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "account_id" UUID,
    "category" "RiskReconciliationCategory" NOT NULL,
    "severity" VARCHAR(16) NOT NULL DEFAULT 'MEDIUM',
    "expected" JSONB DEFAULT '{}',
    "actual" JSONB DEFAULT '{}',
    "summary" VARCHAR(1000) NOT NULL,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "resolved_at" TIMESTAMPTZ(6),
    "resolved_by" UUID,
    "policy_version" VARCHAR(64),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "risk_reconciliation_records_pkey" PRIMARY KEY ("id")
);



CREATE TABLE "risk_score_records" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "score" INTEGER NOT NULL,
    "risk_level" "ComplianceRiskLevel" NOT NULL,
    "rule_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "policy_version" VARCHAR(32) NOT NULL,
    "contributing_factors" JSONB NOT NULL DEFAULT '[]',
    "idempotency_key" VARCHAR(255) NOT NULL,
    "calculated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "risk_score_records_pkey" PRIMARY KEY ("id")
);



CREATE TABLE "security_audit_logs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID,
    "actor_id" UUID,
    "actor_type" VARCHAR(32) NOT NULL DEFAULT 'USER',
    "event" "SecurityEventCategory" NOT NULL,
    "result" VARCHAR(32) NOT NULL DEFAULT 'SUCCESS',
    "policy_version" VARCHAR(32),
    "target_type" VARCHAR(64),
    "target_id" VARCHAR(128),
    "safe_metadata" JSONB NOT NULL DEFAULT '{}',
    "ip_hash" VARCHAR(64),
    "request_id" VARCHAR(64),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "security_audit_logs_pkey" PRIMARY KEY ("id")
);



CREATE TABLE "security_policies" (
    "id" UUID NOT NULL,
    "tenant_id" UUID,
    "policy_version" VARCHAR(32) NOT NULL,
    "mfa_required" BOOLEAN NOT NULL DEFAULT false,
    "mfa_for_privileged_roles" BOOLEAN NOT NULL DEFAULT true,
    "mfa_for_sensitive_ops" BOOLEAN NOT NULL DEFAULT true,
    "session_absolute_timeout_sec" INTEGER NOT NULL DEFAULT 86400,
    "session_idle_timeout_sec" INTEGER NOT NULL DEFAULT 1800,
    "max_concurrent_sessions" INTEGER NOT NULL DEFAULT 5,
    "device_trust_duration_days" INTEGER NOT NULL DEFAULT 30,
    "api_key_expiration_days" INTEGER NOT NULL DEFAULT 90,
    "api_key_rotation_days" INTEGER NOT NULL DEFAULT 30,
    "sso_enforced" BOOLEAN NOT NULL DEFAULT false,
    "allowed_sso_domains" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "jit_provisioning" BOOLEAN NOT NULL DEFAULT false,
    "privileged_reauth_required" BOOLEAN NOT NULL DEFAULT true,
    "security_notifications" BOOLEAN NOT NULL DEFAULT true,
    "password_min_length" INTEGER NOT NULL DEFAULT 12,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "security_policies_pkey" PRIMARY KEY ("id")
);



CREATE TABLE "security_threat_signals" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID,
    "rule_id" VARCHAR(64) NOT NULL,
    "risk_level" "SecurityRiskLevel" NOT NULL,
    "decision" "SecurityDecision" NOT NULL DEFAULT 'REVIEW_REQUIRED',
    "source_event_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "safe_summary" VARCHAR(1000) NOT NULL,
    "policy_version" VARCHAR(32),
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "resolved_at" TIMESTAMPTZ(6),
    "resolved_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "security_threat_signals_pkey" PRIMARY KEY ("id")
);



CREATE TABLE "sso_configurations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "provider_type" "SsoProviderType" NOT NULL,
    "state" "SsoProviderState" NOT NULL DEFAULT 'DISABLED',
    "issuer" VARCHAR(512),
    "audience" VARCHAR(512),
    "client_id" VARCHAR(512),
    "metadata_url" VARCHAR(2048),
    "entity_id" VARCHAR(512),
    "acs_url" VARCHAR(2048),
    "sso_url" VARCHAR(2048),
    "certificate" TEXT,
    "allowed_domains" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "enforced" BOOLEAN NOT NULL DEFAULT false,
    "jit_enabled" BOOLEAN NOT NULL DEFAULT false,
    "default_role" VARCHAR(64),
    "discovery_url" VARCHAR(2048),
    "jwks_url" VARCHAR(2048),
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "sso_configurations_pkey" PRIMARY KEY ("id")
);



CREATE TABLE "sso_login_attempts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "provider_type" "SsoProviderType" NOT NULL,
    "state" VARCHAR(128) NOT NULL,
    "nonce" VARCHAR(128),
    "email" VARCHAR(254),
    "ip_hash" VARCHAR(64),
    "success" BOOLEAN NOT NULL DEFAULT false,
    "failure_reason" VARCHAR(500),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "sso_login_attempts_pkey" PRIMARY KEY ("id")
);



CREATE TABLE "trader_profiles" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "display_name" VARCHAR(80) NOT NULL,
    "bio" VARCHAR(1000),
    "avatar_url" VARCHAR(512),
    "verification_state" "TraderVerificationState" NOT NULL DEFAULT 'UNVERIFIED',
    "verified_at" TIMESTAMPTZ(6),
    "verified_by_id" UUID,
    "supported_venues" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "supported_symbols" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "risk_profile" JSONB NOT NULL DEFAULT '{}',
    "is_public" BOOLEAN NOT NULL DEFAULT false,
    "is_featured" BOOLEAN NOT NULL DEFAULT false,
    "follower_count" INTEGER NOT NULL DEFAULT 0,
    "total_volume" VARCHAR(64) NOT NULL DEFAULT '0',
    "total_trades" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "trader_profiles_pkey" PRIMARY KEY ("id")
);



CREATE TABLE "trader_strategies" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "trader_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" VARCHAR(1000),
    "status" "TraderStrategyStatus" NOT NULL DEFAULT 'DRAFT',
    "type" "TraderStrategyType" NOT NULL DEFAULT 'MANUAL',
    "supported_symbols" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "supported_venues" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "risk_profile" JSONB NOT NULL DEFAULT '{}',
    "fee_policy" JSONB NOT NULL DEFAULT '{}',
    "strategy_config" JSONB NOT NULL DEFAULT '{}',
    "published_at" TIMESTAMPTZ(6),
    "paused_at" TIMESTAMPTZ(6),
    "archived_at" TIMESTAMPTZ(6),
    "validation_errors" JSONB,
    "follower_count" INTEGER NOT NULL DEFAULT 0,
    "total_copies" INTEGER NOT NULL DEFAULT 0,
    "idempotency_key" VARCHAR(255),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "trader_strategies_pkey" PRIMARY KEY ("id")
);



CREATE TABLE "transaction_monitoring_signals" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID,
    "source_type" VARCHAR(64) NOT NULL,
    "source_id" VARCHAR(255) NOT NULL,
    "rule_id" VARCHAR(64) NOT NULL,
    "risk_level" "ComplianceRiskLevel" NOT NULL,
    "decision" "ComplianceDecision" NOT NULL DEFAULT 'PENDING',
    "safe_summary" VARCHAR(1000) NOT NULL,
    "idempotency_key" VARCHAR(255) NOT NULL,
    "case_id" UUID,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "resolved_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transaction_monitoring_signals_pkey" PRIMARY KEY ("id")
);



CREATE TABLE "usage_alert_configs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "meter_key" VARCHAR(64) NOT NULL,
    "limit_key" VARCHAR(64) NOT NULL,
    "threshold_type" VARCHAR(32) NOT NULL,
    "threshold_value" INTEGER NOT NULL,
    "severity" VARCHAR(32) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "cooldown_minutes" INTEGER NOT NULL DEFAULT 60,
    "last_triggered_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "usage_alert_configs_pkey" PRIMARY KEY ("id")
);



CREATE TABLE "usage_alert_events" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "config_id" UUID NOT NULL,
    "meter_key" VARCHAR(64) NOT NULL,
    "limit_key" VARCHAR(64) NOT NULL,
    "threshold_type" VARCHAR(32) NOT NULL,
    "threshold_value" INTEGER NOT NULL,
    "current_value" INTEGER NOT NULL,
    "maximum_value" INTEGER,
    "utilization_percent" INTEGER,
    "severity" VARCHAR(32) NOT NULL,
    "state" VARCHAR(32) NOT NULL DEFAULT 'TRIGGERED',
    "period_id" VARCHAR(255) NOT NULL,
    "triggered_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledged_at" TIMESTAMPTZ(6),
    "resolved_at" TIMESTAMPTZ(6),
    "delivery_state" VARCHAR(32) NOT NULL DEFAULT 'PENDING',
    "idempotency_key" VARCHAR(255) NOT NULL,
    "safe_metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usage_alert_events_pkey" PRIMARY KEY ("id")
);



CREATE TABLE "usage_events" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "meter_key" VARCHAR(64) NOT NULL,
    "event_type" VARCHAR(64) NOT NULL,
    "source_id" VARCHAR(255) NOT NULL,
    "source_type" VARCHAR(64) NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "period_id" VARCHAR(255) NOT NULL,
    "idempotency_key" VARCHAR(255) NOT NULL,
    "status" VARCHAR(32) NOT NULL DEFAULT 'RECEIVED',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "safe_metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usage_events_pkey" PRIMARY KEY ("id")
);



CREATE TABLE "usage_meters" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "meter_key" VARCHAR(64) NOT NULL,
    "limit_key" VARCHAR(64) NOT NULL,
    "period_id" VARCHAR(255) NOT NULL,
    "period_start" TIMESTAMPTZ(6) NOT NULL,
    "period_end" TIMESTAMPTZ(6) NOT NULL,
    "current_value" INTEGER NOT NULL DEFAULT 0,
    "max_value" INTEGER,
    "unit" VARCHAR(32) NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "usage_meters_pkey" PRIMARY KEY ("id")
);



CREATE TABLE "webhook_delivery_attempts" (
    "id" UUID NOT NULL,
    "subscription_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "event_id" VARCHAR(255) NOT NULL,
    "event_type" "BillingNotificationEventKey" NOT NULL,
    "endpoint_url" VARCHAR(2048) NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "signature" VARCHAR(255) NOT NULL,
    "timestamp" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "BillingDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "provider_reference" VARCHAR(255),
    "failure_reason" VARCHAR(1000),
    "next_attempt_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_delivery_attempts_pkey" PRIMARY KEY ("id")
);



CREATE TABLE "webhook_subscriptions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "endpoint_url" VARCHAR(2048) NOT NULL,
    "event_types" "BillingNotificationEventKey"[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "secret_hash" VARCHAR(255) NOT NULL,
    "secret_masked" VARCHAR(64) NOT NULL,
    "last_delivery_at" TIMESTAMPTZ(6),
    "last_delivery_status" VARCHAR(32),
    "failure_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "webhook_subscriptions_pkey" PRIMARY KEY ("id")
);



CREATE TABLE "withdrawal_requests" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "client_profile_id" UUID,
    "account_id" UUID NOT NULL,
    "state" "WithdrawalRequestState" NOT NULL DEFAULT 'REQUESTED',
    "requested_amount" VARCHAR(64) NOT NULL,
    "approved_amount" VARCHAR(64),
    "submitted_amount" VARCHAR(64),
    "confirmed_amount" VARCHAR(64),
    "settled_amount" VARCHAR(64),
    "currency" VARCHAR(16) NOT NULL,
    "destination_address" VARCHAR(512),
    "destination_type" VARCHAR(64),
    "external_reference" VARCHAR(255),
    "source_type" VARCHAR(64),
    "source_id" VARCHAR(255),
    "requested_by" UUID,
    "approved_by" UUID,
    "approval_policy_version" VARCHAR(64),
    "calculation_version" VARCHAR(64) NOT NULL DEFAULT 'client-lifecycle-v1.0.0',
    "failure_reason" VARCHAR(1000),
    "reversal_reason" VARCHAR(1000),
    "compliance_check_id" UUID,
    "risk_check_id" UUID,
    "security_check_id" UUID,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "evidence" JSONB NOT NULL DEFAULT '{}',
    "idempotency_key" VARCHAR(255) NOT NULL,
    "requested_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approved_at" TIMESTAMPTZ(6),
    "submitted_at" TIMESTAMPTZ(6),
    "confirmed_at" TIMESTAMPTZ(6),
    "failed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "withdrawal_requests_pkey" PRIMARY KEY ("id")
);



-- Alter existing tables for missing columns (48 total)
ALTER TABLE "audit_logs" ADD COLUMN "operation_id" VARCHAR(64);
ALTER TABLE "risk_configurations" ADD COLUMN "config_digest" VARCHAR(64);
ALTER TABLE "risk_configurations" ADD COLUMN "policy_json" JSONB;
ALTER TABLE "risk_configurations" ADD COLUMN "daily_loss_includes_unrealized" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "risk_configurations" ADD COLUMN "config_version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "risk_configurations" ADD COLUMN "protection_json" JSONB;
ALTER TABLE "kill_switches" ADD COLUMN "cleared_at" TIMESTAMPTZ(6);
ALTER TABLE "kill_switches" ADD COLUMN "acknowledged_by_user_id" UUID;
ALTER TABLE "kill_switches" ADD COLUMN "requires_explicit_clear" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "kill_switches" ADD COLUMN "cleared_reason" VARCHAR(500);
ALTER TABLE "kill_switches" ADD COLUMN "acknowledgement_reason" VARCHAR(500);
ALTER TABLE "kill_switches" ADD COLUMN "status" "RiskSwitchStatus" NOT NULL DEFAULT 'INACTIVE';
ALTER TABLE "kill_switches" ADD COLUMN "cleared_by_user_id" UUID;
ALTER TABLE "kill_switches" ADD COLUMN "trigger_severity" "RiskEventSeverity";
ALTER TABLE "kill_switches" ADD COLUMN "triggered_at" TIMESTAMPTZ(6);
ALTER TABLE "kill_switches" ADD COLUMN "triggered_by_rule" VARCHAR(64);
ALTER TABLE "risk_events" ADD COLUMN "snapshot_version" BIGINT;
ALTER TABLE "risk_events" ADD COLUMN "scope" VARCHAR(24);
ALTER TABLE "risk_events" ADD COLUMN "scope_target" VARCHAR(64);
ALTER TABLE "risk_events" ADD COLUMN "source" VARCHAR(64);
ALTER TABLE "risk_events" ADD COLUMN "is_simulated" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "risk_events" ADD COLUMN "dedupe_key" VARCHAR(64);
ALTER TABLE "risk_events" ADD COLUMN "rule_id" VARCHAR(64);
ALTER TABLE "orders" ADD COLUMN "reconciliation_state" "OrderReconciliationState" NOT NULL DEFAULT 'IN_SYNC';
ALTER TABLE "orders" ADD COLUMN "metadata" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "orders" ADD COLUMN "was_dry_run" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "orders" ADD COLUMN "reconciliation_detail" VARCHAR(500);
ALTER TABLE "strategy_configurations" ADD COLUMN "strategy_version_id" UUID;
ALTER TABLE "strategies" ADD COLUMN "last_heartbeat_at" TIMESTAMPTZ(6);
ALTER TABLE "strategies" ADD COLUMN "consecutive_errors" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "strategies" ADD COLUMN "instance_key" VARCHAR(32);
ALTER TABLE "strategies" ADD COLUMN "health" "StrategyHealth" NOT NULL DEFAULT 'UNKNOWN';
ALTER TABLE "strategies" ADD COLUMN "definition_id" UUID;
ALTER TABLE "strategies" ADD COLUMN "quarantine_reason" VARCHAR(500);
ALTER TABLE "strategies" ADD COLUMN "failure_policy" "StrategyFailurePolicy" NOT NULL DEFAULT 'STOP_INSTANCE';
ALTER TABLE "strategies" ADD COLUMN "version_id" UUID;
ALTER TABLE "strategies" ADD COLUMN "quarantined_at" TIMESTAMPTZ(6);
ALTER TABLE "fills" ADD COLUMN "side" "OrderSideEnum";
ALTER TABLE "fills" ADD COLUMN "venue" "TradingVenue";
ALTER TABLE "fills" ADD COLUMN "source" "FillSource" NOT NULL DEFAULT 'PRIVATE_STREAM';
ALTER TABLE "fills" ADD COLUMN "symbol" VARCHAR(32);
ALTER TABLE "fills" ADD COLUMN "quote_quantity" DECIMAL(28,12);
ALTER TABLE "trading_accounts" ADD COLUMN "live_trading_enabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "trading_accounts" ADD COLUMN "credential_ref" VARCHAR(512);
ALTER TABLE "trading_accounts" ADD COLUMN "verified_permissions" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "trading_accounts" ADD COLUMN "credential_source" "CredentialSource" NOT NULL DEFAULT 'ENVELOPE_DB';
ALTER TABLE "trading_accounts" ADD COLUMN "credential_rotated_at" TIMESTAMPTZ(6);
ALTER TABLE "trading_accounts" ADD COLUMN "private_stream_enabled" BOOLEAN NOT NULL DEFAULT false;

-- Create indexes for missing tables (403 total)
CREATE UNIQUE INDEX "account_ownerships_idempotency_key_key" ON "account_ownerships"("idempotency_key");
CREATE INDEX "account_ownerships_tenant_id_account_id_status_idx" ON "account_ownerships"("tenant_id", "account_id", "status");
CREATE INDEX "account_ownerships_tenant_id_client_profile_id_idx" ON "account_ownerships"("tenant_id", "client_profile_id");
CREATE INDEX "account_ownerships_tenant_id_owner_id_status_idx" ON "account_ownerships"("tenant_id", "owner_id", "status");
CREATE UNIQUE INDEX "account_relationships_idempotency_key_key" ON "account_relationships"("idempotency_key");
CREATE INDEX "account_relationships_tenant_id_account_id_idx" ON "account_relationships"("tenant_id", "account_id");
CREATE INDEX "account_relationships_tenant_id_client_profile_id_idx" ON "account_relationships"("tenant_id", "client_profile_id");
CREATE INDEX "account_relationships_tenant_id_source_id_relationship_type_idx" ON "account_relationships"("tenant_id", "source_id", "relationship_type", "status");
CREATE INDEX "account_relationships_tenant_id_target_id_relationship_type_idx" ON "account_relationships"("tenant_id", "target_id", "relationship_type", "status");
CREATE UNIQUE INDEX "account_restrictions_idempotency_key_key" ON "account_restrictions"("idempotency_key");
CREATE INDEX "account_restrictions_tenant_id_account_id_restriction_type__idx" ON "account_restrictions"("tenant_id", "account_id", "restriction_type", "status");
CREATE INDEX "account_restrictions_tenant_id_client_profile_id_status_idx" ON "account_restrictions"("tenant_id", "client_profile_id", "status");
CREATE INDEX "account_restrictions_tenant_id_status_effective_at_idx" ON "account_restrictions"("tenant_id", "status", "effective_at");
CREATE INDEX "billing_notification_audit_logs_operation_created_at_idx" ON "billing_notification_audit_logs"("operation", "created_at");
CREATE INDEX "billing_notification_audit_logs_tenant_id_operation_created_idx" ON "billing_notification_audit_logs"("tenant_id", "operation", "created_at");
CREATE INDEX "billing_notification_audit_logs_tenant_id_reference_id_idx" ON "billing_notification_audit_logs"("tenant_id", "reference_id");
CREATE INDEX "billing_notification_jobs_delivery_status_next_attempt_at_idx" ON "billing_notification_jobs"("delivery_status", "next_attempt_at");
CREATE INDEX "billing_notification_jobs_idempotency_key_idx" ON "billing_notification_jobs"("idempotency_key");
CREATE UNIQUE INDEX "billing_notification_jobs_idempotency_key_key" ON "billing_notification_jobs"("idempotency_key");
CREATE INDEX "billing_notification_jobs_tenant_id_delivery_status_created_idx" ON "billing_notification_jobs"("tenant_id", "delivery_status", "created_at");
CREATE INDEX "billing_notification_jobs_tenant_id_event_key_channel_idx" ON "billing_notification_jobs"("tenant_id", "event_key", "channel");
CREATE INDEX "billing_notification_jobs_tenant_id_user_id_idx" ON "billing_notification_jobs"("tenant_id", "user_id");
CREATE INDEX "billing_notification_preferences_tenant_id_channel_idx" ON "billing_notification_preferences"("tenant_id", "channel");
CREATE UNIQUE INDEX "billing_notification_preferences_tenant_id_user_id_event_ke_key" ON "billing_notification_preferences"("tenant_id", "user_id", "event_key", "channel");
CREATE INDEX "billing_notification_preferences_tenant_id_user_id_idx" ON "billing_notification_preferences"("tenant_id", "user_id");
CREATE INDEX "circuit_breaker_records_scope_state_idx" ON "circuit_breaker_records"("scope", "state");
CREATE INDEX "circuit_breaker_records_tenant_id_scope_scope_id_state_idx" ON "circuit_breaker_records"("tenant_id", "scope", "scope_id", "state");
CREATE INDEX "client_lifecycle_audits_tenant_id_account_id_action_created_idx" ON "client_lifecycle_audits"("tenant_id", "account_id", "action", "created_at");
CREATE INDEX "client_lifecycle_audits_tenant_id_client_profile_id_action__idx" ON "client_lifecycle_audits"("tenant_id", "client_profile_id", "action", "created_at");
CREATE INDEX "client_lifecycle_audits_tenant_id_entity_type_entity_id_idx" ON "client_lifecycle_audits"("tenant_id", "entity_type", "entity_id");
CREATE UNIQUE INDEX "client_onboarding_steps_idempotency_key_key" ON "client_onboarding_steps"("idempotency_key");
CREATE INDEX "client_onboarding_steps_tenant_id_onboarding_id_status_idx" ON "client_onboarding_steps"("tenant_id", "onboarding_id", "status");
CREATE INDEX "client_onboarding_steps_tenant_id_onboarding_id_step_type_idx" ON "client_onboarding_steps"("tenant_id", "onboarding_id", "step_type");
CREATE UNIQUE INDEX "client_onboardings_idempotency_key_key" ON "client_onboardings"("idempotency_key");
CREATE INDEX "client_onboardings_tenant_id_client_profile_id_state_idx" ON "client_onboardings"("tenant_id", "client_profile_id", "state");
CREATE INDEX "client_onboardings_tenant_id_state_idx" ON "client_onboardings"("tenant_id", "state");
CREATE UNIQUE INDEX "client_profiles_idempotency_key_key" ON "client_profiles"("idempotency_key");
CREATE INDEX "client_profiles_tenant_id_email_idx" ON "client_profiles"("tenant_id", "email");
CREATE INDEX "client_profiles_tenant_id_external_identity_ref_idx" ON "client_profiles"("tenant_id", "external_identity_ref");
CREATE INDEX "client_profiles_tenant_id_status_idx" ON "client_profiles"("tenant_id", "status");
CREATE UNIQUE INDEX "client_reviews_idempotency_key_key" ON "client_reviews"("idempotency_key");
CREATE INDEX "client_reviews_tenant_id_account_id_review_type_idx" ON "client_reviews"("tenant_id", "account_id", "review_type");
CREATE INDEX "client_reviews_tenant_id_client_profile_id_review_type_revi_idx" ON "client_reviews"("tenant_id", "client_profile_id", "review_type", "review_decision");
CREATE INDEX "client_reviews_tenant_id_next_review_date_idx" ON "client_reviews"("tenant_id", "next_review_date");
CREATE INDEX "compliance_audit_logs_case_id_created_at_idx" ON "compliance_audit_logs"("case_id", "created_at");
CREATE INDEX "compliance_audit_logs_tenant_id_action_created_at_idx" ON "compliance_audit_logs"("tenant_id", "action", "created_at");
CREATE INDEX "compliance_cases_assigned_to_state_idx" ON "compliance_cases"("assigned_to", "state");
CREATE INDEX "compliance_cases_case_type_state_idx" ON "compliance_cases"("case_type", "state");
CREATE UNIQUE INDEX "compliance_cases_idempotency_key_key" ON "compliance_cases"("idempotency_key");
CREATE INDEX "compliance_cases_tenant_id_state_created_at_idx" ON "compliance_cases"("tenant_id", "state", "created_at");
CREATE INDEX "compliance_cases_tenant_id_user_id_idx" ON "compliance_cases"("tenant_id", "user_id");
CREATE INDEX "compliance_evidences_case_id_evidence_type_idx" ON "compliance_evidences"("case_id", "evidence_type");
CREATE INDEX "compliance_evidences_tenant_id_reference_type_reference_id_idx" ON "compliance_evidences"("tenant_id", "reference_type", "reference_id");
CREATE INDEX "compliance_policy_records_tenant_id_is_active_idx" ON "compliance_policy_records"("tenant_id", "is_active");
CREATE UNIQUE INDEX "compliance_policy_records_tenant_id_jurisdiction_policy_ver_key" ON "compliance_policy_records"("tenant_id", "jurisdiction", "policy_version");
CREATE INDEX "compliance_reviews_case_id_created_at_idx" ON "compliance_reviews"("case_id", "created_at");
CREATE INDEX "compliance_reviews_tenant_id_reviewer_id_idx" ON "compliance_reviews"("tenant_id", "reviewer_id");
CREATE INDEX "compliance_screening_requests_idempotency_key_idx" ON "compliance_screening_requests"("idempotency_key");
CREATE UNIQUE INDEX "compliance_screening_requests_idempotency_key_key" ON "compliance_screening_requests"("idempotency_key");
CREATE INDEX "compliance_screening_requests_tenant_id_status_idx" ON "compliance_screening_requests"("tenant_id", "status");
CREATE INDEX "compliance_screening_requests_tenant_id_user_id_type_idx" ON "compliance_screening_requests"("tenant_id", "user_id", "type");
CREATE INDEX "copy_executions_follower_order_id_idx" ON "copy_executions"("follower_order_id");
CREATE UNIQUE INDEX "copy_executions_idempotency_key_key" ON "copy_executions"("idempotency_key");
CREATE INDEX "copy_executions_leader_event_id_idx" ON "copy_executions"("leader_event_id");
CREATE INDEX "copy_executions_tenant_id_follower_id_status_idx" ON "copy_executions"("tenant_id", "follower_id", "status");
CREATE UNIQUE INDEX "copy_executions_tenant_id_leader_event_id_subscription_id_key" ON "copy_executions"("tenant_id", "leader_event_id", "subscription_id");
CREATE INDEX "copy_executions_tenant_id_subscription_id_status_idx" ON "copy_executions"("tenant_id", "subscription_id", "status");
CREATE INDEX "copy_executions_tenant_id_trader_id_status_idx" ON "copy_executions"("tenant_id", "trader_id", "status");
CREATE INDEX "copy_reconciliation_records_tenant_id_category_severity_idx" ON "copy_reconciliation_records"("tenant_id", "category", "severity");
CREATE INDEX "copy_reconciliation_records_tenant_id_leader_event_id_idx" ON "copy_reconciliation_records"("tenant_id", "leader_event_id");
CREATE INDEX "copy_subscriptions_follower_account_id_idx" ON "copy_subscriptions"("follower_account_id");
CREATE UNIQUE INDEX "copy_subscriptions_idempotency_key_key" ON "copy_subscriptions"("idempotency_key");
CREATE INDEX "copy_subscriptions_tenant_id_follower_id_state_idx" ON "copy_subscriptions"("tenant_id", "follower_id", "state");
CREATE UNIQUE INDEX "copy_subscriptions_tenant_id_follower_id_strategy_id_key" ON "copy_subscriptions"("tenant_id", "follower_id", "strategy_id");
CREATE INDEX "copy_subscriptions_tenant_id_strategy_id_state_idx" ON "copy_subscriptions"("tenant_id", "strategy_id", "state");
CREATE INDEX "copy_subscriptions_tenant_id_trader_id_state_idx" ON "copy_subscriptions"("tenant_id", "trader_id", "state");
CREATE INDEX "copy_trading_audit_logs_tenant_id_event_created_at_idx" ON "copy_trading_audit_logs"("tenant_id", "event", "created_at");
CREATE INDEX "copy_trading_audit_logs_tenant_id_follower_id_idx" ON "copy_trading_audit_logs"("tenant_id", "follower_id");
CREATE INDEX "copy_trading_audit_logs_tenant_id_trader_id_idx" ON "copy_trading_audit_logs"("tenant_id", "trader_id");
CREATE UNIQUE INDEX "custody_assets_asset_id_key" ON "custody_assets"("asset_id");
CREATE INDEX "custody_assets_network_id_is_active_idx" ON "custody_assets"("network_id", "is_active");
CREATE INDEX "custody_assets_symbol_is_active_idx" ON "custody_assets"("symbol", "is_active");
CREATE INDEX "custody_audits_tenant_id_entity_type_entity_id_idx" ON "custody_audits"("tenant_id", "entity_type", "entity_id");
CREATE INDEX "custody_audits_tenant_id_wallet_id_action_created_at_idx" ON "custody_audits"("tenant_id", "wallet_id", "action", "created_at");
CREATE UNIQUE INDEX "custody_deposits_idempotency_key_key" ON "custody_deposits"("idempotency_key");
CREATE INDEX "custody_deposits_tenant_id_asset_id_network_id_state_idx" ON "custody_deposits"("tenant_id", "asset_id", "network_id", "state");
CREATE UNIQUE INDEX "custody_deposits_tenant_id_network_id_transaction_hash_to_a_key" ON "custody_deposits"("tenant_id", "network_id", "transaction_hash", "to_address");
CREATE INDEX "custody_deposits_tenant_id_to_address_idx" ON "custody_deposits"("tenant_id", "to_address");
CREATE INDEX "custody_deposits_tenant_id_transaction_hash_idx" ON "custody_deposits"("tenant_id", "transaction_hash");
CREATE INDEX "custody_deposits_tenant_id_wallet_id_state_idx" ON "custody_deposits"("tenant_id", "wallet_id", "state");
CREATE UNIQUE INDEX "custody_internal_transfers_idempotency_key_key" ON "custody_internal_transfers"("idempotency_key");
CREATE INDEX "custody_internal_transfers_tenant_id_asset_id_state_idx" ON "custody_internal_transfers"("tenant_id", "asset_id", "state");
CREATE INDEX "custody_internal_transfers_tenant_id_destination_wallet_id__idx" ON "custody_internal_transfers"("tenant_id", "destination_wallet_id", "state");
CREATE INDEX "custody_internal_transfers_tenant_id_source_wallet_id_state_idx" ON "custody_internal_transfers"("tenant_id", "source_wallet_id", "state");
CREATE INDEX "custody_networks_chain_id_status_idx" ON "custody_networks"("chain_id", "status");
CREATE UNIQUE INDEX "custody_networks_network_id_key" ON "custody_networks"("network_id");
CREATE INDEX "custody_networks_status_idx" ON "custody_networks"("status");
CREATE UNIQUE INDEX "custody_reconciliations_idempotency_key_key" ON "custody_reconciliations"("idempotency_key");
CREATE INDEX "custody_reconciliations_tenant_id_is_critical_is_resolved_idx" ON "custody_reconciliations"("tenant_id", "is_critical", "is_resolved");
CREATE INDEX "custody_reconciliations_tenant_id_reconciliation_type_discr_idx" ON "custody_reconciliations"("tenant_id", "reconciliation_type", "discrepancy_type");
CREATE INDEX "custody_reconciliations_tenant_id_wallet_id_idx" ON "custody_reconciliations"("tenant_id", "wallet_id");
CREATE UNIQUE INDEX "custody_reserves_idempotency_key_key" ON "custody_reserves"("idempotency_key");
CREATE INDEX "custody_reserves_tenant_id_asset_id_network_id_reserve_type_idx" ON "custody_reserves"("tenant_id", "asset_id", "network_id", "reserve_type");
CREATE INDEX "custody_reserves_tenant_id_wallet_id_reserve_type_idx" ON "custody_reserves"("tenant_id", "wallet_id", "reserve_type");
CREATE UNIQUE INDEX "custody_sweeps_idempotency_key_key" ON "custody_sweeps"("idempotency_key");
CREATE INDEX "custody_sweeps_tenant_id_asset_id_network_id_state_idx" ON "custody_sweeps"("tenant_id", "asset_id", "network_id", "state");
CREATE INDEX "custody_sweeps_tenant_id_destination_wallet_id_state_idx" ON "custody_sweeps"("tenant_id", "destination_wallet_id", "state");
CREATE INDEX "custody_sweeps_tenant_id_source_wallet_id_state_idx" ON "custody_sweeps"("tenant_id", "source_wallet_id", "state");
CREATE UNIQUE INDEX "custody_transactions_idempotency_key_key" ON "custody_transactions"("idempotency_key");
CREATE INDEX "custody_transactions_tenant_id_asset_id_network_id_status_idx" ON "custody_transactions"("tenant_id", "asset_id", "network_id", "status");
CREATE INDEX "custody_transactions_tenant_id_deposit_id_idx" ON "custody_transactions"("tenant_id", "deposit_id");
CREATE UNIQUE INDEX "custody_transactions_tenant_id_network_id_transaction_hash_key" ON "custody_transactions"("tenant_id", "network_id", "transaction_hash");
CREATE INDEX "custody_transactions_tenant_id_source_workflow_type_source__idx" ON "custody_transactions"("tenant_id", "source_workflow_type", "source_workflow_id");
CREATE INDEX "custody_transactions_tenant_id_transaction_hash_idx" ON "custody_transactions"("tenant_id", "transaction_hash");
CREATE INDEX "custody_transactions_tenant_id_wallet_id_status_idx" ON "custody_transactions"("tenant_id", "wallet_id", "status");
CREATE INDEX "custody_transactions_tenant_id_withdrawal_id_idx" ON "custody_transactions"("tenant_id", "withdrawal_id");
CREATE INDEX "custody_tx_conf_tenant_tx_count_idx" ON "custody_transaction_confirmations"("tenant_id", "transaction_id", "confirmation_count");
CREATE INDEX "custody_tx_conf_tenant_tx_state_idx" ON "custody_transaction_confirmations"("tenant_id", "transaction_id", "state");
CREATE UNIQUE INDEX "custody_wallet_addresses_idempotency_key_key" ON "custody_wallet_addresses"("idempotency_key");
CREATE INDEX "custody_wallet_addresses_tenant_id_account_id_idx" ON "custody_wallet_addresses"("tenant_id", "account_id");
CREATE INDEX "custody_wallet_addresses_tenant_id_address_idx" ON "custody_wallet_addresses"("tenant_id", "address");
CREATE INDEX "custody_wallet_addresses_tenant_id_asset_id_network_id_stat_idx" ON "custody_wallet_addresses"("tenant_id", "asset_id", "network_id", "status");
CREATE INDEX "custody_wallet_addresses_tenant_id_client_profile_id_idx" ON "custody_wallet_addresses"("tenant_id", "client_profile_id");
CREATE UNIQUE INDEX "custody_wallet_addresses_tenant_id_network_id_address_key" ON "custody_wallet_addresses"("tenant_id", "network_id", "address");
CREATE INDEX "custody_wallet_addresses_tenant_id_wallet_id_status_idx" ON "custody_wallet_addresses"("tenant_id", "wallet_id", "status");
CREATE UNIQUE INDEX "custody_wallets_idempotency_key_key" ON "custody_wallets"("idempotency_key");
CREATE INDEX "custody_wallets_tenant_id_account_id_idx" ON "custody_wallets"("tenant_id", "account_id");
CREATE INDEX "custody_wallets_tenant_id_asset_id_network_id_state_idx" ON "custody_wallets"("tenant_id", "asset_id", "network_id", "state");
CREATE INDEX "custody_wallets_tenant_id_client_profile_id_idx" ON "custody_wallets"("tenant_id", "client_profile_id");
CREATE INDEX "custody_wallets_tenant_id_provider_provider_reference_idx" ON "custody_wallets"("tenant_id", "provider", "provider_reference");
CREATE INDEX "custody_wallets_tenant_id_state_idx" ON "custody_wallets"("tenant_id", "state");
CREATE UNIQUE INDEX "custody_withdrawals_idempotency_key_key" ON "custody_withdrawals"("idempotency_key");
CREATE INDEX "custody_withdrawals_tenant_id_account_id_state_idx" ON "custody_withdrawals"("tenant_id", "account_id", "state");
CREATE INDEX "custody_withdrawals_tenant_id_asset_id_network_id_state_idx" ON "custody_withdrawals"("tenant_id", "asset_id", "network_id", "state");
CREATE INDEX "custody_withdrawals_tenant_id_transaction_hash_idx" ON "custody_withdrawals"("tenant_id", "transaction_hash");
CREATE INDEX "custody_withdrawals_tenant_id_wallet_id_state_idx" ON "custody_withdrawals"("tenant_id", "wallet_id", "state");
CREATE INDEX "device_trusts_device_id_idx" ON "device_trusts"("device_id");
CREATE UNIQUE INDEX "device_trusts_tenant_id_user_id_device_hash_key" ON "device_trusts"("tenant_id", "user_id", "device_hash");
CREATE INDEX "device_trusts_tenant_id_user_id_state_idx" ON "device_trusts"("tenant_id", "user_id", "state");
CREATE INDEX "dunning_cases_status_next_retry_at_idx" ON "dunning_cases"("status", "next_retry_at");
CREATE INDEX "dunning_cases_tenant_id_payment_id_idx" ON "dunning_cases"("tenant_id", "payment_id");
CREATE INDEX "dunning_cases_tenant_id_status_idx" ON "dunning_cases"("tenant_id", "status");
CREATE INDEX "enterprise_api_keys_fingerprint_idx" ON "enterprise_api_keys"("fingerprint");
CREATE UNIQUE INDEX "enterprise_api_keys_fingerprint_key" ON "enterprise_api_keys"("fingerprint");
CREATE UNIQUE INDEX "enterprise_api_keys_idempotency_key_key" ON "enterprise_api_keys"("idempotency_key");
CREATE UNIQUE INDEX "enterprise_api_keys_key_id_key" ON "enterprise_api_keys"("key_id");
CREATE INDEX "enterprise_api_keys_tenant_id_state_idx" ON "enterprise_api_keys"("tenant_id", "state");
CREATE INDEX "enterprise_api_keys_tenant_id_user_id_state_idx" ON "enterprise_api_keys"("tenant_id", "user_id", "state");
CREATE UNIQUE INDEX "fee_accruals_idempotency_key_key" ON "fee_accruals"("idempotency_key");
CREATE INDEX "fee_accruals_settlement_id_idx" ON "fee_accruals"("settlement_id");
CREATE INDEX "fee_accruals_tenant_id_fee_type_status_idx" ON "fee_accruals"("tenant_id", "fee_type", "status");
CREATE INDEX "fee_accruals_tenant_id_settlement_state_idx" ON "fee_accruals"("tenant_id", "settlement_state");
CREATE UNIQUE INDEX "fee_settlements_idempotency_key_key" ON "fee_settlements"("idempotency_key");
CREATE INDEX "fee_settlements_tenant_id_status_idx" ON "fee_settlements"("tenant_id", "status");
CREATE UNIQUE INDEX "funding_approvals_idempotency_key_key" ON "funding_approvals"("idempotency_key");
CREATE INDEX "funding_approvals_tenant_id_funding_request_id_decision_idx" ON "funding_approvals"("tenant_id", "funding_request_id", "decision");
CREATE INDEX "funding_approvals_tenant_id_withdrawal_request_id_decision_idx" ON "funding_approvals"("tenant_id", "withdrawal_request_id", "decision");
CREATE UNIQUE INDEX "funding_reconciliations_idempotency_key_key" ON "funding_reconciliations"("idempotency_key");
CREATE INDEX "funding_reconciliations_tenant_id_external_reference_idx" ON "funding_reconciliations"("tenant_id", "external_reference");
CREATE INDEX "funding_reconciliations_tenant_id_funding_request_id_reconc_idx" ON "funding_reconciliations"("tenant_id", "funding_request_id", "reconciliation_type");
CREATE INDEX "funding_reconciliations_tenant_id_withdrawal_request_id_rec_idx" ON "funding_reconciliations"("tenant_id", "withdrawal_request_id", "reconciliation_type");
CREATE UNIQUE INDEX "funding_requests_idempotency_key_key" ON "funding_requests"("idempotency_key");
CREATE INDEX "funding_requests_tenant_id_account_id_state_idx" ON "funding_requests"("tenant_id", "account_id", "state");
CREATE INDEX "funding_requests_tenant_id_client_profile_id_state_idx" ON "funding_requests"("tenant_id", "client_profile_id", "state");
CREATE INDEX "funding_requests_tenant_id_external_reference_idx" ON "funding_requests"("tenant_id", "external_reference");
CREATE INDEX "funding_requests_tenant_id_state_requested_at_idx" ON "funding_requests"("tenant_id", "state", "requested_at");
CREATE UNIQUE INDEX "institutional_accounts_idempotency_key_key" ON "institutional_accounts"("idempotency_key");
CREATE INDEX "institutional_accounts_tenant_id_client_profile_id_state_idx" ON "institutional_accounts"("tenant_id", "client_profile_id", "state");
CREATE INDEX "institutional_accounts_tenant_id_exchange_account_id_idx" ON "institutional_accounts"("tenant_id", "exchange_account_id");
CREATE INDEX "institutional_accounts_tenant_id_owner_id_idx" ON "institutional_accounts"("tenant_id", "owner_id");
CREATE INDEX "institutional_accounts_tenant_id_portfolio_id_idx" ON "institutional_accounts"("tenant_id", "portfolio_id");
CREATE INDEX "institutional_accounts_tenant_id_state_idx" ON "institutional_accounts"("tenant_id", "state");
CREATE INDEX "institutional_risk_policies_scope_is_active_idx" ON "institutional_risk_policies"("scope", "is_active");
CREATE INDEX "institutional_risk_policies_tenant_id_scope_is_active_idx" ON "institutional_risk_policies"("tenant_id", "scope", "is_active");
CREATE UNIQUE INDEX "institutional_risk_policies_tenant_id_scope_scope_id_versio_key" ON "institutional_risk_policies"("tenant_id", "scope", "scope_id", "version");
CREATE UNIQUE INDEX "invoices_idempotency_key_key" ON "invoices"("idempotency_key");
CREATE UNIQUE INDEX "invoices_invoice_number_key" ON "invoices"("invoice_number");
CREATE INDEX "invoices_tenant_id_payment_id_idx" ON "invoices"("tenant_id", "payment_id");
CREATE INDEX "invoices_tenant_id_status_created_at_idx" ON "invoices"("tenant_id", "status", "created_at");
CREATE INDEX "oms_allocations_tenant_id_account_id_symbol_idx" ON "oms_allocations"("tenant_id", "account_id", "symbol");
CREATE INDEX "oms_allocations_tenant_id_follower_id_idx" ON "oms_allocations"("tenant_id", "follower_id");
CREATE INDEX "oms_allocations_tenant_id_strategy_id_idx" ON "oms_allocations"("tenant_id", "strategy_id");
CREATE INDEX "oms_allocations_tenant_id_trader_id_idx" ON "oms_allocations"("tenant_id", "trader_id");
CREATE INDEX "oms_audits_tenant_id_account_id_symbol_idx" ON "oms_audits"("tenant_id", "account_id", "symbol");
CREATE INDEX "oms_audits_tenant_id_event_type_created_at_idx" ON "oms_audits"("tenant_id", "event_type", "created_at");
CREATE INDEX "oms_audits_tenant_id_order_intent_id_timestamp_idx" ON "oms_audits"("tenant_id", "order_intent_id", "timestamp");
CREATE UNIQUE INDEX "oms_execution_acks_tenant_id_client_order_id_exchange_order_key" ON "oms_execution_acks"("tenant_id", "client_order_id", "exchange_order_id");
CREATE INDEX "oms_execution_acks_tenant_id_order_intent_id_idx" ON "oms_execution_acks"("tenant_id", "order_intent_id");
CREATE INDEX "oms_execution_acks_tenant_id_venue_ack_type_idx" ON "oms_execution_acks"("tenant_id", "venue", "ack_type");
CREATE INDEX "oms_execution_latency_tenant_id_order_intent_id_idx" ON "oms_execution_latency"("tenant_id", "order_intent_id");
CREATE INDEX "oms_execution_quality_tenant_id_account_id_venue_calculated_idx" ON "oms_execution_quality"("tenant_id", "account_id", "venue", "calculated_at");
CREATE INDEX "oms_fills_tenant_id_order_intent_id_timestamp_micros_idx" ON "oms_fills"("tenant_id", "order_intent_id", "timestamp_micros");
CREATE UNIQUE INDEX "oms_fills_tenant_id_provider_fill_id_order_intent_id_key" ON "oms_fills"("tenant_id", "provider_fill_id", "order_intent_id");
CREATE INDEX "oms_fills_tenant_id_symbol_venue_idx" ON "oms_fills"("tenant_id", "symbol", "venue");
CREATE INDEX "oms_operational_tenant_id_account_id_state_idx" ON "oms_operational"("tenant_id", "account_id", "state");
CREATE INDEX "oms_operational_tenant_id_type_state_idx" ON "oms_operational"("tenant_id", "type", "state");
CREATE INDEX "oms_order_intents_tenant_id_account_id_state_idx" ON "oms_order_intents"("tenant_id", "account_id", "state");
CREATE UNIQUE INDEX "oms_order_intents_tenant_id_client_order_id_key" ON "oms_order_intents"("tenant_id", "client_order_id");
CREATE INDEX "oms_order_intents_tenant_id_follower_id_idx" ON "oms_order_intents"("tenant_id", "follower_id");
CREATE INDEX "oms_order_intents_tenant_id_state_created_at_idx" ON "oms_order_intents"("tenant_id", "state", "created_at");
CREATE INDEX "oms_order_intents_tenant_id_strategy_id_state_idx" ON "oms_order_intents"("tenant_id", "strategy_id", "state");
CREATE INDEX "oms_order_intents_tenant_id_symbol_state_idx" ON "oms_order_intents"("tenant_id", "symbol", "state");
CREATE INDEX "oms_order_intents_tenant_id_trader_id_idx" ON "oms_order_intents"("tenant_id", "trader_id");
CREATE INDEX "oms_post_trades_tenant_id_account_id_symbol_completed_at_idx" ON "oms_post_trades"("tenant_id", "account_id", "symbol", "completed_at");
CREATE INDEX "oms_reconciliations_tenant_id_category_resolved_idx" ON "oms_reconciliations"("tenant_id", "category", "resolved");
CREATE INDEX "oms_reconciliations_tenant_id_order_intent_id_idx" ON "oms_reconciliations"("tenant_id", "order_intent_id");
CREATE INDEX "oms_rejections_tenant_id_account_id_symbol_idx" ON "oms_rejections"("tenant_id", "account_id", "symbol");
CREATE INDEX "oms_rejections_tenant_id_category_created_at_idx" ON "oms_rejections"("tenant_id", "category", "created_at");
CREATE INDEX "oms_trades_tenant_id_account_id_symbol_state_idx" ON "oms_trades"("tenant_id", "account_id", "symbol", "state");
CREATE INDEX "oms_trades_tenant_id_state_opened_at_idx" ON "oms_trades"("tenant_id", "state", "opened_at");
CREATE INDEX "oms_trades_tenant_id_strategy_id_state_idx" ON "oms_trades"("tenant_id", "strategy_id", "state");
CREATE INDEX "oms_venue_scores_tenant_id_venue_calculated_at_idx" ON "oms_venue_scores"("tenant_id", "venue", "calculated_at");
CREATE INDEX "operational_actions_idempotency_key_idx" ON "operational_actions"("idempotency_key");
CREATE UNIQUE INDEX "operational_actions_idempotency_key_key" ON "operational_actions"("idempotency_key");
CREATE INDEX "operational_actions_incident_id_idx" ON "operational_actions"("incident_id");
CREATE INDEX "operational_actions_tenant_id_action_type_status_created_at_idx" ON "operational_actions"("tenant_id", "action_type", "status", "created_at");
CREATE INDEX "operational_actions_tenant_id_target_type_target_id_idx" ON "operational_actions"("tenant_id", "target_type", "target_id");
CREATE INDEX "operational_audit_logs_correlation_id_idx" ON "operational_audit_logs"("correlation_id");
CREATE INDEX "operational_audit_logs_event_type_created_at_idx" ON "operational_audit_logs"("event_type", "created_at");
CREATE INDEX "operational_audit_logs_tenant_id_event_type_created_at_idx" ON "operational_audit_logs"("tenant_id", "event_type", "created_at");
CREATE INDEX "operational_audit_logs_tenant_id_target_type_target_id_idx" ON "operational_audit_logs"("tenant_id", "target_type", "target_id");
CREATE INDEX "operational_dependency_checks_dependency_type_state_checked_idx" ON "operational_dependency_checks"("dependency_type", "state", "checked_at");
CREATE INDEX "operational_dependency_checks_tenant_id_dependency_type_sta_idx" ON "operational_dependency_checks"("tenant_id", "dependency_type", "state", "checked_at");
CREATE INDEX "operational_incident_events_incident_id_created_at_idx" ON "operational_incident_events"("incident_id", "created_at");
CREATE INDEX "operational_incident_events_tenant_id_incident_id_created_a_idx" ON "operational_incident_events"("tenant_id", "incident_id", "created_at");
CREATE INDEX "operational_incidents_affected_component_affected_capabilit_idx" ON "operational_incidents"("affected_component", "affected_capability");
CREATE INDEX "operational_incidents_correlation_id_idx" ON "operational_incidents"("correlation_id");
CREATE INDEX "operational_incidents_idempotency_key_idx" ON "operational_incidents"("idempotency_key");
CREATE UNIQUE INDEX "operational_incidents_idempotency_key_key" ON "operational_incidents"("idempotency_key");
CREATE INDEX "operational_incidents_state_severity_last_seen_at_idx" ON "operational_incidents"("state", "severity", "last_seen_at");
CREATE INDEX "operational_incidents_tenant_id_fingerprint_idx" ON "operational_incidents"("tenant_id", "fingerprint");
CREATE UNIQUE INDEX "operational_incidents_tenant_id_fingerprint_key" ON "operational_incidents"("tenant_id", "fingerprint");
CREATE INDEX "operational_incidents_tenant_id_state_severity_created_at_idx" ON "operational_incidents"("tenant_id", "state", "severity", "created_at");
CREATE UNIQUE INDEX "operational_maintenance_windows_idempotency_key_key" ON "operational_maintenance_windows"("idempotency_key");
CREATE INDEX "operational_maintenance_windows_scope_state_scheduled_start_idx" ON "operational_maintenance_windows"("scope", "state", "scheduled_start");
CREATE INDEX "operational_maintenance_windows_state_scheduled_start_sched_idx" ON "operational_maintenance_windows"("state", "scheduled_start", "scheduled_end");
CREATE INDEX "operational_maintenance_windows_tenant_id_scope_state_sched_idx" ON "operational_maintenance_windows"("tenant_id", "scope", "state", "scheduled_start");
CREATE INDEX "operational_readiness_checks_state_checked_at_idx" ON "operational_readiness_checks"("state", "checked_at");
CREATE INDEX "operational_readiness_checks_tenant_id_state_checked_at_idx" ON "operational_readiness_checks"("tenant_id", "state", "checked_at");
CREATE INDEX "operational_reconciliation_runs_correlation_id_idx" ON "operational_reconciliation_runs"("correlation_id");
CREATE INDEX "operational_reconciliation_runs_idempotency_key_idx" ON "operational_reconciliation_runs"("idempotency_key");
CREATE UNIQUE INDEX "operational_reconciliation_runs_idempotency_key_key" ON "operational_reconciliation_runs"("idempotency_key");
CREATE INDEX "operational_reconciliation_runs_status_trigger_type_created_idx" ON "operational_reconciliation_runs"("status", "trigger_type", "created_at");
CREATE INDEX "operational_reconciliation_runs_tenant_id_reconciliation_ty_idx" ON "operational_reconciliation_runs"("tenant_id", "reconciliation_type", "status", "created_at");
CREATE INDEX "operational_reconciliation_runs_tenant_id_scope_created_at_idx" ON "operational_reconciliation_runs"("tenant_id", "scope", "created_at");
CREATE INDEX "operational_recovery_runs_idempotency_key_idx" ON "operational_recovery_runs"("idempotency_key");
CREATE UNIQUE INDEX "operational_recovery_runs_idempotency_key_key" ON "operational_recovery_runs"("idempotency_key");
CREATE INDEX "operational_recovery_runs_incident_id_idx" ON "operational_recovery_runs"("incident_id");
CREATE INDEX "operational_recovery_runs_tenant_id_state_created_at_idx" ON "operational_recovery_runs"("tenant_id", "state", "created_at");
CREATE UNIQUE INDEX "operational_service_degradations_idempotency_key_key" ON "operational_service_degradations"("idempotency_key");
CREATE INDEX "operational_service_degradations_service_name_level_created_idx" ON "operational_service_degradations"("service_name", "level", "created_at");
CREATE INDEX "operational_service_degradations_tenant_id_service_name_lev_idx" ON "operational_service_degradations"("tenant_id", "service_name", "level", "created_at");
CREATE UNIQUE INDEX "overage_records_idempotency_key_key" ON "overage_records"("idempotency_key");
CREATE INDEX "overage_records_tenant_id_meter_key_period_id_idx" ON "overage_records"("tenant_id", "meter_key", "period_id");
CREATE INDEX "overage_records_tenant_id_status_idx" ON "overage_records"("tenant_id", "status");
CREATE UNIQUE INDEX "payments_idempotency_key_key" ON "payments"("idempotency_key");
CREATE INDEX "payments_tenant_id_provider_idx" ON "payments"("tenant_id", "provider");
CREATE INDEX "payments_tenant_id_status_created_at_idx" ON "payments"("tenant_id", "status", "created_at");
CREATE UNIQUE INDEX "payouts_idempotency_key_key" ON "payouts"("idempotency_key");
CREATE INDEX "payouts_settlement_id_idx" ON "payouts"("settlement_id");
CREATE INDEX "payouts_tenant_id_status_idx" ON "payouts"("tenant_id", "status");
CREATE UNIQUE INDEX "portfolio_accounting_adjustments_idempotency_key_key" ON "portfolio_accounting_adjustments"("idempotency_key");
CREATE INDEX "portfolio_accounting_adjustments_tenant_id_original_event_i_idx" ON "portfolio_accounting_adjustments"("tenant_id", "original_event_id");
CREATE INDEX "portfolio_accounting_adjustments_tenant_id_profile_id_adjus_idx" ON "portfolio_accounting_adjustments"("tenant_id", "profile_id", "adjustment_type", "created_at");
CREATE UNIQUE INDEX "portfolio_accounting_closes_idempotency_key_key" ON "portfolio_accounting_closes"("idempotency_key");
CREATE INDEX "portfolio_accounting_closes_tenant_id_period_id_created_at_idx" ON "portfolio_accounting_closes"("tenant_id", "period_id", "created_at");
CREATE UNIQUE INDEX "portfolio_accounting_events_idempotency_key_key" ON "portfolio_accounting_events"("idempotency_key");
CREATE INDEX "portfolio_accounting_events_profile_id_created_at_idx" ON "portfolio_accounting_events"("profile_id", "created_at");
CREATE INDEX "portfolio_accounting_events_source_type_source_id_idx" ON "portfolio_accounting_events"("source_type", "source_id");
CREATE INDEX "portfolio_accounting_events_tenant_id_fingerprint_idx" ON "portfolio_accounting_events"("tenant_id", "fingerprint");
CREATE INDEX "portfolio_accounting_events_tenant_id_idempotency_key_idx" ON "portfolio_accounting_events"("tenant_id", "idempotency_key");
CREATE INDEX "portfolio_accounting_events_tenant_id_profile_id_event_type_idx" ON "portfolio_accounting_events"("tenant_id", "profile_id", "event_type", "created_at");
CREATE INDEX "portfolio_accounting_events_tenant_id_source_type_source_id_idx" ON "portfolio_accounting_events"("tenant_id", "source_type", "source_id");
CREATE UNIQUE INDEX "portfolio_accounting_periods_idempotency_key_key" ON "portfolio_accounting_periods"("idempotency_key");
CREATE UNIQUE INDEX "portfolio_accounting_periods_tenant_id_profile_id_period_st_key" ON "portfolio_accounting_periods"("tenant_id", "profile_id", "period_start", "period_end");
CREATE INDEX "portfolio_accounting_periods_tenant_id_profile_id_state_per_idx" ON "portfolio_accounting_periods"("tenant_id", "profile_id", "state", "period_start");
CREATE INDEX "portfolio_accounting_periods_tenant_id_state_period_start_idx" ON "portfolio_accounting_periods"("tenant_id", "state", "period_start");
CREATE INDEX "portfolio_accounting_profiles_tenant_id_portfolio_type_idx" ON "portfolio_accounting_profiles"("tenant_id", "portfolio_type");
CREATE INDEX "portfolio_accounting_profiles_tenant_id_scope_is_active_idx" ON "portfolio_accounting_profiles"("tenant_id", "scope", "is_active");
CREATE UNIQUE INDEX "portfolio_accounting_profiles_tenant_id_scope_scope_id_key" ON "portfolio_accounting_profiles"("tenant_id", "scope", "scope_id");
CREATE UNIQUE INDEX "portfolio_accounting_reconciliations_idempotency_key_key" ON "portfolio_accounting_reconciliations"("idempotency_key");
CREATE INDEX "portfolio_accounting_reconciliations_tenant_id_period_id_idx" ON "portfolio_accounting_reconciliations"("tenant_id", "period_id");
CREATE INDEX "portfolio_accounting_reconciliations_tenant_id_profile_id_r_idx" ON "portfolio_accounting_reconciliations"("tenant_id", "profile_id", "reconciliation_type", "state");
CREATE INDEX "portfolio_accounting_reconciliations_tenant_id_state_is_cri_idx" ON "portfolio_accounting_reconciliations"("tenant_id", "state", "is_critical", "created_at");
CREATE UNIQUE INDEX "portfolio_attribution_records_idempotency_key_key" ON "portfolio_attribution_records"("idempotency_key");
CREATE INDEX "portfolio_attribution_records_tenant_id_period_id_dimension_idx" ON "portfolio_attribution_records"("tenant_id", "period_id", "dimension");
CREATE INDEX "portfolio_attribution_records_tenant_id_profile_id_dimensio_idx" ON "portfolio_attribution_records"("tenant_id", "profile_id", "dimension", "period_start");
CREATE UNIQUE INDEX "portfolio_cash_ledger_entries_idempotency_key_key" ON "portfolio_cash_ledger_entries"("idempotency_key");
CREATE INDEX "portfolio_cash_ledger_entries_profile_id_asset_occurred_at_idx" ON "portfolio_cash_ledger_entries"("profile_id", "asset", "occurred_at");
CREATE INDEX "portfolio_cash_ledger_entries_tenant_id_cash_flow_type_occu_idx" ON "portfolio_cash_ledger_entries"("tenant_id", "cash_flow_type", "occurred_at");
CREATE INDEX "portfolio_cash_ledger_entries_tenant_id_profile_id_occurred_idx" ON "portfolio_cash_ledger_entries"("tenant_id", "profile_id", "occurred_at");
CREATE UNIQUE INDEX "portfolio_performance_records_idempotency_key_key" ON "portfolio_performance_records"("idempotency_key");
CREATE INDEX "portfolio_performance_records_tenant_id_period_id_idx" ON "portfolio_performance_records"("tenant_id", "period_id");
CREATE INDEX "portfolio_performance_records_tenant_id_profile_id_methodol_idx" ON "portfolio_performance_records"("tenant_id", "profile_id", "methodology", "period_start");
CREATE UNIQUE INDEX "portfolio_position_lots_idempotency_key_key" ON "portfolio_position_lots"("idempotency_key");
CREATE INDEX "portfolio_position_lots_profile_id_symbol_is_closed_idx" ON "portfolio_position_lots"("profile_id", "symbol", "is_closed");
CREATE INDEX "portfolio_position_lots_tenant_id_profile_id_is_closed_idx" ON "portfolio_position_lots"("tenant_id", "profile_id", "is_closed");
CREATE INDEX "portfolio_position_lots_tenant_id_profile_id_symbol_opened__idx" ON "portfolio_position_lots"("tenant_id", "profile_id", "symbol", "opened_at");
CREATE UNIQUE INDEX "portfolio_snapshots_idempotency_key_key" ON "portfolio_snapshots"("idempotency_key");
CREATE INDEX "portfolio_snapshots_profile_id_timestamp_idx" ON "portfolio_snapshots"("profile_id", "timestamp");
CREATE UNIQUE INDEX "portfolio_snapshots_snapshot_id_key" ON "portfolio_snapshots"("snapshot_id");
CREATE INDEX "portfolio_snapshots_tenant_id_profile_id_timestamp_idx" ON "portfolio_snapshots"("tenant_id", "profile_id", "timestamp");
CREATE INDEX "portfolio_snapshots_tenant_id_snapshot_id_idx" ON "portfolio_snapshots"("tenant_id", "snapshot_id");
CREATE UNIQUE INDEX "portfolio_statements_idempotency_key_key" ON "portfolio_statements"("idempotency_key");
CREATE INDEX "portfolio_statements_profile_id_state_period_start_idx" ON "portfolio_statements"("profile_id", "state", "period_start");
CREATE UNIQUE INDEX "portfolio_statements_statement_id_key" ON "portfolio_statements"("statement_id");
CREATE INDEX "portfolio_statements_tenant_id_profile_id_period_start_idx" ON "portfolio_statements"("tenant_id", "profile_id", "period_start");
CREATE INDEX "portfolio_statements_tenant_id_statement_id_idx" ON "portfolio_statements"("tenant_id", "statement_id");
CREATE UNIQUE INDEX "portfolio_valuations_idempotency_key_key" ON "portfolio_valuations"("idempotency_key");
CREATE INDEX "portfolio_valuations_profile_id_valuation_state_valuation_t_idx" ON "portfolio_valuations"("profile_id", "valuation_state", "valuation_timestamp");
CREATE INDEX "portfolio_valuations_tenant_id_profile_id_valuation_timesta_idx" ON "portfolio_valuations"("tenant_id", "profile_id", "valuation_timestamp");
CREATE INDEX "portfolio_valuations_tenant_id_symbol_valuation_timestamp_idx" ON "portfolio_valuations"("tenant_id", "symbol", "valuation_timestamp");
CREATE UNIQUE INDEX "refunds_idempotency_key_key" ON "refunds"("idempotency_key");
CREATE INDEX "refunds_tenant_id_payment_id_idx" ON "refunds"("tenant_id", "payment_id");
CREATE INDEX "refunds_tenant_id_status_idx" ON "refunds"("tenant_id", "status");
CREATE INDEX "research_audit_logs_tenant_id_event_created_at_idx" ON "research_audit_logs"("tenant_id", "event", "created_at");
CREATE INDEX "research_audit_logs_tenant_id_strategy_version_id_idx" ON "research_audit_logs"("tenant_id", "strategy_version_id");
CREATE UNIQUE INDEX "research_backtest_runs_idempotency_key_key" ON "research_backtest_runs"("idempotency_key");
CREATE UNIQUE INDEX "research_backtest_runs_tenant_id_run_identifier_key" ON "research_backtest_runs"("tenant_id", "run_identifier");
CREATE INDEX "research_backtest_runs_tenant_id_status_created_at_idx" ON "research_backtest_runs"("tenant_id", "status", "created_at");
CREATE INDEX "research_backtest_runs_tenant_id_strategy_version_id_status_idx" ON "research_backtest_runs"("tenant_id", "strategy_version_id", "status");
CREATE UNIQUE INDEX "research_backtest_snapshots_backtest_run_id_sequence_key" ON "research_backtest_snapshots"("backtest_run_id", "sequence");
CREATE INDEX "research_backtest_snapshots_tenant_id_backtest_run_id_idx" ON "research_backtest_snapshots"("tenant_id", "backtest_run_id");
CREATE UNIQUE INDEX "research_backtest_trades_backtest_run_id_sequence_key" ON "research_backtest_trades"("backtest_run_id", "sequence");
CREATE INDEX "research_backtest_trades_tenant_id_backtest_run_id_idx" ON "research_backtest_trades"("tenant_id", "backtest_run_id");
CREATE UNIQUE INDEX "research_datasets_idempotency_key_key" ON "research_datasets"("idempotency_key");
CREATE UNIQUE INDEX "research_datasets_tenant_id_fingerprint_key" ON "research_datasets"("tenant_id", "fingerprint");
CREATE INDEX "research_datasets_tenant_id_status_idx" ON "research_datasets"("tenant_id", "status");
CREATE INDEX "research_datasets_tenant_id_venue_symbol_timeframe_idx" ON "research_datasets"("tenant_id", "venue", "symbol", "timeframe");
CREATE UNIQUE INDEX "research_paper_fills_tenant_id_fill_id_key" ON "research_paper_fills"("tenant_id", "fill_id");
CREATE INDEX "research_paper_fills_tenant_id_session_id_idx" ON "research_paper_fills"("tenant_id", "session_id");
CREATE UNIQUE INDEX "research_paper_orders_tenant_id_client_order_id_key" ON "research_paper_orders"("tenant_id", "client_order_id");
CREATE UNIQUE INDEX "research_paper_orders_tenant_id_order_id_key" ON "research_paper_orders"("tenant_id", "order_id");
CREATE INDEX "research_paper_orders_tenant_id_session_id_status_idx" ON "research_paper_orders"("tenant_id", "session_id", "status");
CREATE UNIQUE INDEX "research_paper_sessions_idempotency_key_key" ON "research_paper_sessions"("idempotency_key");
CREATE UNIQUE INDEX "research_paper_sessions_tenant_id_session_identifier_key" ON "research_paper_sessions"("tenant_id", "session_identifier");
CREATE INDEX "research_paper_sessions_tenant_id_status_idx" ON "research_paper_sessions"("tenant_id", "status");
CREATE INDEX "research_paper_sessions_tenant_id_strategy_version_id_statu_idx" ON "research_paper_sessions"("tenant_id", "strategy_version_id", "status");
CREATE UNIQUE INDEX "research_paper_snapshots_session_id_sequence_key" ON "research_paper_snapshots"("session_id", "sequence");
CREATE INDEX "research_paper_snapshots_tenant_id_session_id_idx" ON "research_paper_snapshots"("tenant_id", "session_id");
CREATE UNIQUE INDEX "research_promotion_requests_idempotency_key_key" ON "research_promotion_requests"("idempotency_key");
CREATE INDEX "research_promotion_requests_tenant_id_state_idx" ON "research_promotion_requests"("tenant_id", "state");
CREATE INDEX "research_promotion_requests_tenant_id_strategy_version_id_s_idx" ON "research_promotion_requests"("tenant_id", "strategy_version_id", "state");
CREATE UNIQUE INDEX "research_signals_idempotency_key_key" ON "research_signals"("idempotency_key");
CREATE UNIQUE INDEX "research_signals_tenant_id_signal_key_key" ON "research_signals"("tenant_id", "signal_key");
CREATE INDEX "research_signals_tenant_id_strategy_version_id_state_idx" ON "research_signals"("tenant_id", "strategy_version_id", "state");
CREATE INDEX "research_signals_tenant_id_symbol_state_idx" ON "research_signals"("tenant_id", "symbol", "state");
CREATE UNIQUE INDEX "research_strategy_versions_idempotency_key_key" ON "research_strategy_versions"("idempotency_key");
CREATE UNIQUE INDEX "research_strategy_versions_tenant_id_fingerprint_key" ON "research_strategy_versions"("tenant_id", "fingerprint");
CREATE INDEX "research_strategy_versions_tenant_id_status_idx" ON "research_strategy_versions"("tenant_id", "status");
CREATE INDEX "research_strategy_versions_tenant_id_strategy_id_status_idx" ON "research_strategy_versions"("tenant_id", "strategy_id", "status");
CREATE UNIQUE INDEX "research_strategy_versions_tenant_id_strategy_id_version_key" ON "research_strategy_versions"("tenant_id", "strategy_id", "version");
CREATE INDEX "risk_decision_records_tenant_id_account_id_created_at_idx" ON "risk_decision_records"("tenant_id", "account_id", "created_at");
CREATE INDEX "risk_decision_records_tenant_id_decision_created_at_idx" ON "risk_decision_records"("tenant_id", "decision", "created_at");
CREATE INDEX "risk_decision_records_tenant_id_symbol_created_at_idx" ON "risk_decision_records"("tenant_id", "symbol", "created_at");
CREATE INDEX "risk_management_snapshots_tenant_id_account_id_captured_at_idx" ON "risk_management_snapshots"("tenant_id", "account_id", "captured_at");
CREATE INDEX "risk_management_snapshots_tenant_id_captured_at_idx" ON "risk_management_snapshots"("tenant_id", "captured_at");
CREATE INDEX "risk_management_snapshots_tenant_id_trader_id_captured_at_idx" ON "risk_management_snapshots"("tenant_id", "trader_id", "captured_at");
CREATE INDEX "risk_reconciliation_records_tenant_id_category_created_at_idx" ON "risk_reconciliation_records"("tenant_id", "category", "created_at");
CREATE INDEX "risk_reconciliation_records_tenant_id_resolved_created_at_idx" ON "risk_reconciliation_records"("tenant_id", "resolved", "created_at");
CREATE UNIQUE INDEX "risk_score_records_idempotency_key_key" ON "risk_score_records"("idempotency_key");
CREATE INDEX "risk_score_records_tenant_id_risk_level_idx" ON "risk_score_records"("tenant_id", "risk_level");
CREATE INDEX "risk_score_records_tenant_id_user_id_calculated_at_idx" ON "risk_score_records"("tenant_id", "user_id", "calculated_at");
CREATE INDEX "security_audit_logs_actor_id_idx" ON "security_audit_logs"("actor_id");
CREATE INDEX "security_audit_logs_tenant_id_event_created_at_idx" ON "security_audit_logs"("tenant_id", "event", "created_at");
CREATE INDEX "security_audit_logs_tenant_id_user_id_idx" ON "security_audit_logs"("tenant_id", "user_id");
CREATE UNIQUE INDEX "security_policies_tenant_id_key" ON "security_policies"("tenant_id");
CREATE INDEX "security_threat_signals_tenant_id_risk_level_created_at_idx" ON "security_threat_signals"("tenant_id", "risk_level", "created_at");
CREATE INDEX "security_threat_signals_tenant_id_user_id_idx" ON "security_threat_signals"("tenant_id", "user_id");
CREATE UNIQUE INDEX "sso_configurations_tenant_id_provider_type_key" ON "sso_configurations"("tenant_id", "provider_type");
CREATE INDEX "sso_configurations_tenant_id_state_idx" ON "sso_configurations"("tenant_id", "state");
CREATE INDEX "sso_login_attempts_state_idx" ON "sso_login_attempts"("state");
CREATE INDEX "sso_login_attempts_tenant_id_provider_type_created_at_idx" ON "sso_login_attempts"("tenant_id", "provider_type", "created_at");
CREATE INDEX "trader_profiles_tenant_id_follower_count_idx" ON "trader_profiles"("tenant_id", "follower_count");
CREATE INDEX "trader_profiles_tenant_id_is_public_idx" ON "trader_profiles"("tenant_id", "is_public");
CREATE INDEX "trader_profiles_tenant_id_verification_state_idx" ON "trader_profiles"("tenant_id", "verification_state");
CREATE UNIQUE INDEX "trader_profiles_user_id_key" ON "trader_profiles"("user_id");
CREATE UNIQUE INDEX "trader_strategies_idempotency_key_key" ON "trader_strategies"("idempotency_key");
CREATE INDEX "trader_strategies_tenant_id_status_idx" ON "trader_strategies"("tenant_id", "status");
CREATE UNIQUE INDEX "trader_strategies_tenant_id_trader_id_name_key" ON "trader_strategies"("tenant_id", "trader_id", "name");
CREATE INDEX "trader_strategies_tenant_id_trader_id_status_idx" ON "trader_strategies"("tenant_id", "trader_id", "status");
CREATE INDEX "transaction_monitoring_signals_idempotency_key_idx" ON "transaction_monitoring_signals"("idempotency_key");
CREATE UNIQUE INDEX "transaction_monitoring_signals_idempotency_key_key" ON "transaction_monitoring_signals"("idempotency_key");
CREATE INDEX "transaction_monitoring_signals_tenant_id_risk_level_resolve_idx" ON "transaction_monitoring_signals"("tenant_id", "risk_level", "resolved");
CREATE INDEX "transaction_monitoring_signals_tenant_id_source_type_create_idx" ON "transaction_monitoring_signals"("tenant_id", "source_type", "created_at");
CREATE INDEX "usage_alert_configs_tenant_id_meter_key_idx" ON "usage_alert_configs"("tenant_id", "meter_key");
CREATE UNIQUE INDEX "usage_alert_events_idempotency_key_key" ON "usage_alert_events"("idempotency_key");
CREATE INDEX "usage_alert_events_tenant_id_meter_key_triggered_at_idx" ON "usage_alert_events"("tenant_id", "meter_key", "triggered_at");
CREATE UNIQUE INDEX "usage_events_idempotency_key_key" ON "usage_events"("idempotency_key");
CREATE INDEX "usage_events_tenant_id_meter_key_period_id_idx" ON "usage_events"("tenant_id", "meter_key", "period_id");
CREATE INDEX "usage_events_tenant_id_source_id_idx" ON "usage_events"("tenant_id", "source_id");
CREATE INDEX "usage_meters_tenant_id_meter_key_idx" ON "usage_meters"("tenant_id", "meter_key");
CREATE UNIQUE INDEX "usage_meters_tenant_id_meter_key_period_id_key" ON "usage_meters"("tenant_id", "meter_key", "period_id");
CREATE INDEX "webhook_delivery_attempts_event_id_idx" ON "webhook_delivery_attempts"("event_id");
CREATE UNIQUE INDEX "webhook_delivery_attempts_subscription_id_event_id_key" ON "webhook_delivery_attempts"("subscription_id", "event_id");
CREATE INDEX "webhook_delivery_attempts_tenant_id_status_created_at_idx" ON "webhook_delivery_attempts"("tenant_id", "status", "created_at");
CREATE INDEX "webhook_subscriptions_tenant_id_enabled_idx" ON "webhook_subscriptions"("tenant_id", "enabled");
CREATE INDEX "webhook_subscriptions_tenant_id_endpoint_url_idx" ON "webhook_subscriptions"("tenant_id", "endpoint_url");
CREATE UNIQUE INDEX "withdrawal_requests_idempotency_key_key" ON "withdrawal_requests"("idempotency_key");
CREATE INDEX "withdrawal_requests_tenant_id_account_id_state_idx" ON "withdrawal_requests"("tenant_id", "account_id", "state");
CREATE INDEX "withdrawal_requests_tenant_id_client_profile_id_state_idx" ON "withdrawal_requests"("tenant_id", "client_profile_id", "state");
CREATE INDEX "withdrawal_requests_tenant_id_external_reference_idx" ON "withdrawal_requests"("tenant_id", "external_reference");
CREATE INDEX "withdrawal_requests_tenant_id_state_requested_at_idx" ON "withdrawal_requests"("tenant_id", "state", "requested_at");

-- Create foreign keys for missing tables (191 total)
ALTER TABLE "account_ownerships" ADD CONSTRAINT "account_ownerships_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "institutional_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "account_ownerships" ADD CONSTRAINT "account_ownerships_client_profile_id_fkey" FOREIGN KEY ("client_profile_id") REFERENCES "client_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "account_ownerships" ADD CONSTRAINT "account_ownerships_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "account_relationships" ADD CONSTRAINT "account_relationships_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "institutional_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "account_relationships" ADD CONSTRAINT "account_relationships_client_profile_id_fkey" FOREIGN KEY ("client_profile_id") REFERENCES "client_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "account_relationships" ADD CONSTRAINT "account_relationships_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "account_restrictions" ADD CONSTRAINT "account_restrictions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "institutional_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "account_restrictions" ADD CONSTRAINT "account_restrictions_client_profile_id_fkey" FOREIGN KEY ("client_profile_id") REFERENCES "client_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "account_restrictions" ADD CONSTRAINT "account_restrictions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "circuit_breaker_records" ADD CONSTRAINT "circuit_breaker_records_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "client_lifecycle_audits" ADD CONSTRAINT "client_lifecycle_audits_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "institutional_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "client_lifecycle_audits" ADD CONSTRAINT "client_lifecycle_audits_client_profile_id_fkey" FOREIGN KEY ("client_profile_id") REFERENCES "client_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "client_lifecycle_audits" ADD CONSTRAINT "client_lifecycle_audits_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "client_onboarding_steps" ADD CONSTRAINT "client_onboarding_steps_onboarding_id_fkey" FOREIGN KEY ("onboarding_id") REFERENCES "client_onboardings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "client_onboarding_steps" ADD CONSTRAINT "client_onboarding_steps_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "client_onboardings" ADD CONSTRAINT "client_onboardings_client_profile_id_fkey" FOREIGN KEY ("client_profile_id") REFERENCES "client_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "client_onboardings" ADD CONSTRAINT "client_onboardings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "client_profiles" ADD CONSTRAINT "client_profiles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "client_reviews" ADD CONSTRAINT "client_reviews_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "institutional_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "client_reviews" ADD CONSTRAINT "client_reviews_client_profile_id_fkey" FOREIGN KEY ("client_profile_id") REFERENCES "client_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "client_reviews" ADD CONSTRAINT "client_reviews_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "compliance_audit_logs" ADD CONSTRAINT "compliance_audit_logs_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "compliance_cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "compliance_evidences" ADD CONSTRAINT "compliance_evidences_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "compliance_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "compliance_reviews" ADD CONSTRAINT "compliance_reviews_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "compliance_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "copy_executions" ADD CONSTRAINT "copy_executions_follower_account_id_fkey" FOREIGN KEY ("follower_account_id") REFERENCES "trading_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "copy_executions" ADD CONSTRAINT "copy_executions_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "copy_subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "copy_executions" ADD CONSTRAINT "copy_executions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "copy_reconciliation_records" ADD CONSTRAINT "copy_reconciliation_records_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "copy_subscriptions" ADD CONSTRAINT "copy_subscriptions_follower_account_id_fkey" FOREIGN KEY ("follower_account_id") REFERENCES "trading_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "copy_subscriptions" ADD CONSTRAINT "copy_subscriptions_follower_id_fkey" FOREIGN KEY ("follower_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "copy_subscriptions" ADD CONSTRAINT "copy_subscriptions_strategy_id_fkey" FOREIGN KEY ("strategy_id") REFERENCES "trader_strategies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "copy_subscriptions" ADD CONSTRAINT "copy_subscriptions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "copy_subscriptions" ADD CONSTRAINT "copy_subscriptions_trader_id_fkey" FOREIGN KEY ("trader_id") REFERENCES "trader_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "copy_trading_audit_logs" ADD CONSTRAINT "copy_trading_audit_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "custody_audits" ADD CONSTRAINT "custody_audits_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "custody_audits" ADD CONSTRAINT "custody_audits_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "custody_wallets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "custody_deposits" ADD CONSTRAINT "custody_deposits_address_id_fkey" FOREIGN KEY ("address_id") REFERENCES "custody_wallet_addresses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "custody_deposits" ADD CONSTRAINT "custody_deposits_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "custody_assets"("asset_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "custody_deposits" ADD CONSTRAINT "custody_deposits_network_id_fkey" FOREIGN KEY ("network_id") REFERENCES "custody_networks"("network_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "custody_deposits" ADD CONSTRAINT "custody_deposits_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "custody_deposits" ADD CONSTRAINT "custody_deposits_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "custody_wallets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "custody_internal_transfers" ADD CONSTRAINT "custody_internal_transfers_destination_wallet_id_fkey" FOREIGN KEY ("destination_wallet_id") REFERENCES "custody_wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "custody_internal_transfers" ADD CONSTRAINT "custody_internal_transfers_source_wallet_id_fkey" FOREIGN KEY ("source_wallet_id") REFERENCES "custody_wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "custody_internal_transfers" ADD CONSTRAINT "custody_internal_transfers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "custody_reconciliations" ADD CONSTRAINT "custody_reconciliations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "custody_reserves" ADD CONSTRAINT "custody_reserves_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "custody_assets"("asset_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "custody_reserves" ADD CONSTRAINT "custody_reserves_network_id_fkey" FOREIGN KEY ("network_id") REFERENCES "custody_networks"("network_id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "custody_reserves" ADD CONSTRAINT "custody_reserves_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "custody_reserves" ADD CONSTRAINT "custody_reserves_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "custody_wallets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "custody_sweeps" ADD CONSTRAINT "custody_sweeps_destination_wallet_id_fkey" FOREIGN KEY ("destination_wallet_id") REFERENCES "custody_wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "custody_sweeps" ADD CONSTRAINT "custody_sweeps_source_wallet_id_fkey" FOREIGN KEY ("source_wallet_id") REFERENCES "custody_wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "custody_sweeps" ADD CONSTRAINT "custody_sweeps_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "custody_transaction_confirmations" ADD CONSTRAINT "custody_transaction_confirmations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "custody_transaction_confirmations" ADD CONSTRAINT "custody_transaction_confirmations_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "custody_transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "custody_transactions" ADD CONSTRAINT "custody_transactions_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "custody_assets"("asset_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "custody_transactions" ADD CONSTRAINT "custody_transactions_deposit_id_fkey" FOREIGN KEY ("deposit_id") REFERENCES "custody_deposits"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "custody_transactions" ADD CONSTRAINT "custody_transactions_network_id_fkey" FOREIGN KEY ("network_id") REFERENCES "custody_networks"("network_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "custody_transactions" ADD CONSTRAINT "custody_transactions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "custody_transactions" ADD CONSTRAINT "custody_transactions_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "custody_wallets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "custody_transactions" ADD CONSTRAINT "custody_transactions_withdrawal_id_fkey" FOREIGN KEY ("withdrawal_id") REFERENCES "custody_withdrawals"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "custody_wallet_addresses" ADD CONSTRAINT "custody_wallet_addresses_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "custody_assets"("asset_id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "custody_wallet_addresses" ADD CONSTRAINT "custody_wallet_addresses_network_id_fkey" FOREIGN KEY ("network_id") REFERENCES "custody_networks"("network_id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "custody_wallet_addresses" ADD CONSTRAINT "custody_wallet_addresses_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "custody_wallet_addresses" ADD CONSTRAINT "custody_wallet_addresses_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "custody_wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "custody_wallets" ADD CONSTRAINT "custody_wallets_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "custody_assets"("asset_id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "custody_wallets" ADD CONSTRAINT "custody_wallets_network_id_fkey" FOREIGN KEY ("network_id") REFERENCES "custody_networks"("network_id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "custody_wallets" ADD CONSTRAINT "custody_wallets_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "custody_withdrawals" ADD CONSTRAINT "custody_withdrawals_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "custody_assets"("asset_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "custody_withdrawals" ADD CONSTRAINT "custody_withdrawals_network_id_fkey" FOREIGN KEY ("network_id") REFERENCES "custody_networks"("network_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "custody_withdrawals" ADD CONSTRAINT "custody_withdrawals_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "custody_withdrawals" ADD CONSTRAINT "custody_withdrawals_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "custody_wallets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "device_trusts" ADD CONSTRAINT "device_trusts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "device_trusts" ADD CONSTRAINT "device_trusts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "enterprise_api_keys" ADD CONSTRAINT "enterprise_api_keys_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "enterprise_api_keys" ADD CONSTRAINT "enterprise_api_keys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "funding_approvals" ADD CONSTRAINT "funding_approvals_funding_request_id_fkey" FOREIGN KEY ("funding_request_id") REFERENCES "funding_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "funding_approvals" ADD CONSTRAINT "funding_approvals_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "funding_approvals" ADD CONSTRAINT "funding_approvals_withdrawal_request_id_fkey" FOREIGN KEY ("withdrawal_request_id") REFERENCES "withdrawal_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "funding_reconciliations" ADD CONSTRAINT "funding_reconciliations_funding_request_id_fkey" FOREIGN KEY ("funding_request_id") REFERENCES "funding_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "funding_reconciliations" ADD CONSTRAINT "funding_reconciliations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "funding_reconciliations" ADD CONSTRAINT "funding_reconciliations_withdrawal_request_id_fkey" FOREIGN KEY ("withdrawal_request_id") REFERENCES "withdrawal_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "funding_requests" ADD CONSTRAINT "funding_requests_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "institutional_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "funding_requests" ADD CONSTRAINT "funding_requests_client_profile_id_fkey" FOREIGN KEY ("client_profile_id") REFERENCES "client_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "funding_requests" ADD CONSTRAINT "funding_requests_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "institutional_accounts" ADD CONSTRAINT "institutional_accounts_client_profile_id_fkey" FOREIGN KEY ("client_profile_id") REFERENCES "client_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "institutional_accounts" ADD CONSTRAINT "institutional_accounts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "institutional_risk_policies" ADD CONSTRAINT "institutional_risk_policies_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "oms_allocations" ADD CONSTRAINT "oms_allocations_order_intent_id_fkey" FOREIGN KEY ("order_intent_id") REFERENCES "oms_order_intents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "oms_allocations" ADD CONSTRAINT "oms_allocations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "oms_audits" ADD CONSTRAINT "oms_audits_order_intent_id_fkey" FOREIGN KEY ("order_intent_id") REFERENCES "oms_order_intents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "oms_audits" ADD CONSTRAINT "oms_audits_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "oms_execution_acks" ADD CONSTRAINT "oms_execution_acks_order_intent_id_fkey" FOREIGN KEY ("order_intent_id") REFERENCES "oms_order_intents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "oms_execution_acks" ADD CONSTRAINT "oms_execution_acks_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "oms_execution_latency" ADD CONSTRAINT "oms_execution_latency_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "oms_execution_quality" ADD CONSTRAINT "oms_execution_quality_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "oms_fills" ADD CONSTRAINT "oms_fills_order_intent_id_fkey" FOREIGN KEY ("order_intent_id") REFERENCES "oms_order_intents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "oms_fills" ADD CONSTRAINT "oms_fills_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "oms_operational" ADD CONSTRAINT "oms_operational_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "oms_order_intents" ADD CONSTRAINT "oms_order_intents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "oms_post_trades" ADD CONSTRAINT "oms_post_trades_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "oms_reconciliations" ADD CONSTRAINT "oms_reconciliations_order_intent_id_fkey" FOREIGN KEY ("order_intent_id") REFERENCES "oms_order_intents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "oms_reconciliations" ADD CONSTRAINT "oms_reconciliations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "oms_rejections" ADD CONSTRAINT "oms_rejections_order_intent_id_fkey" FOREIGN KEY ("order_intent_id") REFERENCES "oms_order_intents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "oms_rejections" ADD CONSTRAINT "oms_rejections_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "oms_trades" ADD CONSTRAINT "oms_trades_order_intent_id_fkey" FOREIGN KEY ("order_intent_id") REFERENCES "oms_order_intents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "oms_trades" ADD CONSTRAINT "oms_trades_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "oms_venue_scores" ADD CONSTRAINT "oms_venue_scores_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "operational_actions" ADD CONSTRAINT "operational_actions_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "operational_incidents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "operational_actions" ADD CONSTRAINT "operational_actions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "operational_audit_logs" ADD CONSTRAINT "operational_audit_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "operational_dependency_checks" ADD CONSTRAINT "operational_dependency_checks_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "operational_incident_events" ADD CONSTRAINT "operational_incident_events_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "operational_incidents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "operational_incident_events" ADD CONSTRAINT "operational_incident_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "operational_incidents" ADD CONSTRAINT "operational_incidents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "operational_maintenance_windows" ADD CONSTRAINT "operational_maintenance_windows_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "operational_readiness_checks" ADD CONSTRAINT "operational_readiness_checks_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "operational_reconciliation_runs" ADD CONSTRAINT "operational_reconciliation_runs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "operational_recovery_runs" ADD CONSTRAINT "operational_recovery_runs_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "operational_incidents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "operational_recovery_runs" ADD CONSTRAINT "operational_recovery_runs_maintenance_window_id_fkey" FOREIGN KEY ("maintenance_window_id") REFERENCES "operational_maintenance_windows"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "operational_recovery_runs" ADD CONSTRAINT "operational_recovery_runs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "operational_service_degradations" ADD CONSTRAINT "operational_service_degradations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "portfolio_accounting_adjustments" ADD CONSTRAINT "portfolio_accounting_adjustments_original_event_id_fkey" FOREIGN KEY ("original_event_id") REFERENCES "portfolio_accounting_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "portfolio_accounting_adjustments" ADD CONSTRAINT "portfolio_accounting_adjustments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "portfolio_accounting_closes" ADD CONSTRAINT "portfolio_accounting_closes_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "portfolio_accounting_periods"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "portfolio_accounting_closes" ADD CONSTRAINT "portfolio_accounting_closes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "portfolio_accounting_events" ADD CONSTRAINT "portfolio_accounting_events_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "portfolio_accounting_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "portfolio_accounting_events" ADD CONSTRAINT "portfolio_accounting_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "portfolio_accounting_periods" ADD CONSTRAINT "portfolio_accounting_periods_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "portfolio_accounting_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "portfolio_accounting_periods" ADD CONSTRAINT "portfolio_accounting_periods_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "portfolio_accounting_profiles" ADD CONSTRAINT "portfolio_accounting_profiles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "portfolio_accounting_reconciliations" ADD CONSTRAINT "portfolio_accounting_reconciliations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "portfolio_attribution_records" ADD CONSTRAINT "portfolio_attribution_records_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "portfolio_accounting_periods"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "portfolio_attribution_records" ADD CONSTRAINT "portfolio_attribution_records_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "portfolio_accounting_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "portfolio_attribution_records" ADD CONSTRAINT "portfolio_attribution_records_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "portfolio_cash_ledger_entries" ADD CONSTRAINT "portfolio_cash_ledger_entries_accounting_event_id_fkey" FOREIGN KEY ("accounting_event_id") REFERENCES "portfolio_accounting_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "portfolio_cash_ledger_entries" ADD CONSTRAINT "portfolio_cash_ledger_entries_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "portfolio_accounting_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "portfolio_cash_ledger_entries" ADD CONSTRAINT "portfolio_cash_ledger_entries_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "portfolio_performance_records" ADD CONSTRAINT "portfolio_performance_records_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "portfolio_accounting_periods"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "portfolio_performance_records" ADD CONSTRAINT "portfolio_performance_records_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "portfolio_accounting_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "portfolio_performance_records" ADD CONSTRAINT "portfolio_performance_records_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "portfolio_position_lots" ADD CONSTRAINT "portfolio_position_lots_accounting_event_id_fkey" FOREIGN KEY ("accounting_event_id") REFERENCES "portfolio_accounting_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "portfolio_position_lots" ADD CONSTRAINT "portfolio_position_lots_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "portfolio_accounting_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "portfolio_position_lots" ADD CONSTRAINT "portfolio_position_lots_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "portfolio_snapshots" ADD CONSTRAINT "portfolio_snapshots_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "portfolio_accounting_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "portfolio_snapshots" ADD CONSTRAINT "portfolio_snapshots_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "portfolio_statements" ADD CONSTRAINT "portfolio_statements_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "portfolio_accounting_periods"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "portfolio_statements" ADD CONSTRAINT "portfolio_statements_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "portfolio_accounting_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "portfolio_statements" ADD CONSTRAINT "portfolio_statements_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "portfolio_valuations" ADD CONSTRAINT "portfolio_valuations_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "portfolio_accounting_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "portfolio_valuations" ADD CONSTRAINT "portfolio_valuations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "research_audit_logs" ADD CONSTRAINT "research_audit_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "research_backtest_runs" ADD CONSTRAINT "research_backtest_runs_dataset_id_fkey" FOREIGN KEY ("dataset_id") REFERENCES "research_datasets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "research_backtest_runs" ADD CONSTRAINT "research_backtest_runs_strategy_version_id_fkey" FOREIGN KEY ("strategy_version_id") REFERENCES "research_strategy_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "research_backtest_runs" ADD CONSTRAINT "research_backtest_runs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "research_backtest_snapshots" ADD CONSTRAINT "research_backtest_snapshots_backtest_run_id_fkey" FOREIGN KEY ("backtest_run_id") REFERENCES "research_backtest_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "research_backtest_snapshots" ADD CONSTRAINT "research_backtest_snapshots_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "research_backtest_trades" ADD CONSTRAINT "research_backtest_trades_backtest_run_id_fkey" FOREIGN KEY ("backtest_run_id") REFERENCES "research_backtest_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "research_backtest_trades" ADD CONSTRAINT "research_backtest_trades_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "research_datasets" ADD CONSTRAINT "research_datasets_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "research_paper_fills" ADD CONSTRAINT "research_paper_fills_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "research_paper_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "research_paper_fills" ADD CONSTRAINT "research_paper_fills_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "research_paper_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "research_paper_fills" ADD CONSTRAINT "research_paper_fills_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "research_paper_orders" ADD CONSTRAINT "research_paper_orders_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "research_paper_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "research_paper_orders" ADD CONSTRAINT "research_paper_orders_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "research_paper_sessions" ADD CONSTRAINT "research_paper_sessions_strategy_version_id_fkey" FOREIGN KEY ("strategy_version_id") REFERENCES "research_strategy_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "research_paper_sessions" ADD CONSTRAINT "research_paper_sessions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "research_paper_snapshots" ADD CONSTRAINT "research_paper_snapshots_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "research_paper_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "research_paper_snapshots" ADD CONSTRAINT "research_paper_snapshots_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "research_promotion_requests" ADD CONSTRAINT "research_promotion_requests_strategy_version_id_fkey" FOREIGN KEY ("strategy_version_id") REFERENCES "research_strategy_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "research_promotion_requests" ADD CONSTRAINT "research_promotion_requests_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "research_signals" ADD CONSTRAINT "research_signals_strategy_version_id_fkey" FOREIGN KEY ("strategy_version_id") REFERENCES "research_strategy_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "research_signals" ADD CONSTRAINT "research_signals_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "research_strategy_versions" ADD CONSTRAINT "research_strategy_versions_parent_version_id_fkey" FOREIGN KEY ("parent_version_id") REFERENCES "research_strategy_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "research_strategy_versions" ADD CONSTRAINT "research_strategy_versions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "risk_decision_records" ADD CONSTRAINT "risk_decision_records_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "risk_management_snapshots" ADD CONSTRAINT "risk_management_snapshots_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "risk_reconciliation_records" ADD CONSTRAINT "risk_reconciliation_records_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "security_audit_logs" ADD CONSTRAINT "security_audit_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "security_policies" ADD CONSTRAINT "security_policies_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "security_threat_signals" ADD CONSTRAINT "security_threat_signals_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sso_configurations" ADD CONSTRAINT "sso_configurations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sso_login_attempts" ADD CONSTRAINT "sso_login_attempts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "trader_profiles" ADD CONSTRAINT "trader_profiles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "trader_profiles" ADD CONSTRAINT "trader_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "trader_strategies" ADD CONSTRAINT "trader_strategies_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "trader_strategies" ADD CONSTRAINT "trader_strategies_trader_id_fkey" FOREIGN KEY ("trader_id") REFERENCES "trader_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "trader_strategies" ADD CONSTRAINT "trader_strategies_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "webhook_delivery_attempts" ADD CONSTRAINT "webhook_delivery_attempts_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "webhook_subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "withdrawal_requests" ADD CONSTRAINT "withdrawal_requests_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "institutional_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "withdrawal_requests" ADD CONSTRAINT "withdrawal_requests_client_profile_id_fkey" FOREIGN KEY ("client_profile_id") REFERENCES "client_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "withdrawal_requests" ADD CONSTRAINT "withdrawal_requests_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Create missing foreign keys for existing tables (5 total)
ALTER TABLE "engine_incidents" ADD CONSTRAINT "engine_incidents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "engine_order_events" ADD CONSTRAINT "engine_order_events_tenant_id_order_id_fkey" FOREIGN KEY ("tenant_id", "order_id") REFERENCES "engine_orders"("tenant_id", "order_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "engine_order_fills" ADD CONSTRAINT "engine_order_fills_tenant_id_order_id_fkey" FOREIGN KEY ("tenant_id", "order_id") REFERENCES "engine_orders"("tenant_id", "order_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "engine_orders" ADD CONSTRAINT "engine_orders_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "engine_retention_runs" ADD CONSTRAINT "engine_retention_runs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
