# API - data model

The Prisma schema and the idempotent seed that provisions roles, permissions and the platform tenant.

12 files. Part of the complete source dump - see `docs/source/README.md`.

---

FILE: apps/api/prisma/MIGRATION_RECONCILIATION_REPORT.md

````markdown
# Migration Reconciliation Report

## Overview
This report documents the reconciliation of the current Prisma schema (`apps/api/prisma/schema.prisma`) against the existing migration history under `apps/api/prisma/migrations/`.

**Migration generated only. Database application not performed.**

## 1. Existing migration count
- Before reconciliation: **11** migration directories
  - `0_init`
  - `20260906120000_part5_authenticated_execution`
  - `20260907120000_part6_strategy_layer`
  - `20260911120000_part7_historical_datasets`
  - `20260911150000_part8_realtime_risk_engine`
  - `20260912120000_part9_observability_operations`
  - `20260912180000_part10_reliability_slo`
  - `20260913120000_part11_row_level_security`
  - `20260914120000_part13_execution_store`
  - `20260914160000_part14_retention_ledger`
  - `20260915120000_part17_durable_incidents`
- After reconciliation: **12** directories (including new `20260922054232_reconcile_current_schema`)
- `migration_lock.toml` provider = postgresql preserved

## 2. Existing migrated tables found (before reconciliation)
- **73** unique tables detected via `CREATE TABLE` parsing in existing migrations (excluding new migration)
- Examples: `tenants`, `users`, `roles`, `trading_accounts`, `orders`, `fills`, `positions`, `strategies`, etc.
- Note: Some early counts via grep including comments showed 76 due to comment lines containing "CREATE TABLE" text; cleaned count is 73 tables with actual DDL.

## 3. Current schema model count
- **190** models in `schema.prisma` (`grep -c "^model "`)

## 4. Current enum count
- **171** enums in `schema.prisma` (`grep -c "^enum "`)

## 5. Models newly added by this migration
- **117** tables missing before reconciliation, now created
- List (sorted):
  - `account_ownerships`
  - `account_relationships`
  - `account_restrictions`
  - `billing_notification_audit_logs`
  - `billing_notification_jobs`
  - `billing_notification_preferences`
  - `circuit_breaker_records`
  - `client_lifecycle_audits`
  - `client_onboarding_steps`
  - `client_onboardings`
  - `client_profiles`
  - `client_reviews`
  - `compliance_audit_logs`
  - `compliance_cases`
  - `compliance_evidences`
  - `compliance_policy_records`
  - `compliance_reviews`
  - `compliance_screening_requests`
  - `copy_executions`
  - `copy_reconciliation_records`
  - `copy_subscriptions`
  - `copy_trading_audit_logs`
  - `custody_assets`
  - `custody_audits`
  - `custody_deposits`
  - `custody_internal_transfers`
  - `custody_networks`
  - `custody_reconciliations`
  - `custody_reserves`
  - `custody_sweeps`
  - `custody_transaction_confirmations`
  - `custody_transactions`
  - `custody_wallet_addresses`
  - `custody_wallets`
  - `custody_withdrawals`
  - `device_trusts`
  - `dunning_cases`
  - `enterprise_api_keys`
  - `fee_accruals`
  - `fee_settlements`
  - `funding_approvals`
  - `funding_reconciliations`
  - `funding_requests`
  - `institutional_accounts`
  - `institutional_risk_policies`
  - `invoices`
  - `oms_allocations`
  - `oms_audits`
  - `oms_execution_acks`
  - `oms_execution_latency`
  - `oms_execution_quality`
  - `oms_fills`
  - `oms_operational`
  - `oms_order_intents`
  - `oms_post_trades`
  - `oms_reconciliations`
  - `oms_rejections`
  - `oms_trades`
  - `oms_venue_scores`
  - `operational_actions`
  - `operational_audit_logs`
  - `operational_dependency_checks`
  - `operational_incident_events`
  - `operational_incidents`
  - `operational_maintenance_windows`
  - `operational_readiness_checks`
  - `operational_reconciliation_runs`
  - `operational_recovery_runs`
  - `operational_service_degradations`
  - `overage_records`
  - `payments`
  - `payouts`
  - `portfolio_accounting_adjustments`
  - `portfolio_accounting_closes`
  - `portfolio_accounting_events`
  - `portfolio_accounting_periods`
  - `portfolio_accounting_profiles`
  - `portfolio_accounting_reconciliations`
  - `portfolio_attribution_records`
  - `portfolio_cash_ledger_entries`
  - `portfolio_performance_records`
  - `portfolio_position_lots`
  - `portfolio_snapshots`
  - `portfolio_statements`
  - `portfolio_valuations`
  - `refunds`
  - `research_audit_logs`
  - `research_backtest_runs`
  - `research_backtest_snapshots`
  - `research_backtest_trades`
  - `research_datasets`
  - `research_paper_fills`
  - `research_paper_orders`
  - `research_paper_sessions`
  - `research_paper_snapshots`
  - `research_promotion_requests`
  - `research_signals`
  - `research_strategy_versions`
  - `risk_decision_records`
  - `risk_management_snapshots`
  - `risk_reconciliation_records`
  - `risk_score_records`
  - `security_audit_logs`
  - `security_policies`
  - `security_threat_signals`
  - `sso_configurations`
  - `sso_login_attempts`
  - `trader_profiles`
  - `trader_strategies`
  - `transaction_monitoring_signals`
  - `usage_alert_configs`
  - `usage_alert_events`
  - `usage_events`
  - `usage_meters`
  - `webhook_delivery_attempts`
  - `webhook_subscriptions`
  - `withdrawal_requests`

## 6. Enums newly added by this migration
- **111** enums missing before, now created
- List:
  - `AccountOwnershipType`, `AccountRelationshipType`, `AccountRestrictionType`
  - `BillingDeliveryStatus`, `BillingNotificationCategory`, `BillingNotificationChannel`, `BillingNotificationEventKey`, `BillingNotificationPriority`
  - `CircuitBreakerScope`, `CircuitBreakerState`
  - `ClientOnboardingState`, `ClientOnboardingStepStatus`, `ClientOnboardingStepType`, `ClientProfileStatus`, `ClientReviewDecision`, `ClientReviewType`
  - `ComplianceAmlState`, `ComplianceCaseState`, `ComplianceCaseType`, `ComplianceDecision`, `ComplianceKycState`, `ComplianceReviewAction`, `ComplianceRiskLevel`
  - `CopyExecutionStatus`, `CopyReconciliationCategory`, `CopyReconciliationSeverity`, `CopyRiskDecision`, `CopySizingMode`, `CopySubscriptionState`
  - `CustodyAuditAction`, `CustodyConfirmationState`, `CustodyDepositState`, `CustodyInternalTransferState`, `CustodyReconciliationType`, `CustodyReserveState`, `CustodyScope`, `CustodySettlementState`, `CustodySweepState`, `CustodyTransactionState`, `CustodyWalletAddressState`, `CustodyWalletState`, `CustodyWithdrawalState`
  - `FundingApprovalDecision`, `FundingRequestState`
  - `InstitutionalAccountState`, `InstitutionalRiskPolicyScope`
  - `OmsAuditEventType`, `OmsExecutionAckType`, `OmsFillState`, `OmsOperationalState`, `OmsOperationalType`, `OmsOrderIntentState`, `OmsReconciliationCategory`, `OmsRejectionCategory`, `OmsTradeState`
  - `OperationalActionStatus`, `OperationalActionType`, `OperationalAuditEventType`, `OperationalDegradationLevel`, `OperationalDependencyState`, `OperationalDependencyType`, `OperationalIncidentSeverity`, `OperationalIncidentState`, `OperationalMaintenanceScope`, `OperationalMaintenanceState`, `OperationalReadinessState`, `OperationalReconciliationRunState`, `OperationalReconciliationType`, `OperationalRecoveryState`, `OperationalTriggerType`
  - `PortfolioAccountingScope`, `PortfolioAdjustmentType`, `PortfolioAttributionDimension`, `PortfolioCashFlowType`, `PortfolioPeriodState`, `PortfolioPnLType`, `PortfolioPositionClassification`, `PortfolioReconciliationState`, `PortfolioReturnMethodology`, `PortfolioStatementState`, `PortfolioType`, `PortfolioValuationState`
  - `RelationshipStatus`
  - `ResearchBacktestStatus`, `ResearchDatasetStatus`, `ResearchPaperOrderStatus`, `ResearchPaperSessionStatus`, `ResearchPromotionState`, `ResearchSignalSide`, `ResearchSignalState`, `ResearchStatus`, `ResearchStrategyVersionStatus`
  - `RestrictionScope`, `RestrictionStatus`
  - `RiskManagementDecision`, `RiskReconciliationCategory`, `RiskState`
  - `SecurityApiKeyState`, `SecurityAuthFactor`, `SecurityDecision`, `SecurityDeviceState`, `SecurityEventCategory`, `SecurityRiskLevel`, `SecuritySessionState`
  - `SsoProviderState`, `SsoProviderType`
  - `TraderStrategyStatus`, `TraderStrategyType`, `TraderVerificationState`
  - `TradingEligibilityStatus`
  - `WithdrawalRequestState`

## 7. Existing models altered by this migration
- **8** existing tables had missing columns detected vs current schema, now altered via `ALTER TABLE ADD COLUMN`
- Tables and missing columns:
  - `audit_logs`: `operation_id`
  - `risk_configurations`: `config_digest`, `policy_json`, `daily_loss_includes_unrealized`, `config_version`, `protection_json`
  - `kill_switches`: `cleared_at`, `acknowledged_by_user_id`, `requires_explicit_clear`, `cleared_reason`, `acknowledgement_reason`, `status`, `cleared_by_user_id`, `trigger_severity`, `triggered_at`, `triggered_by_rule`
  - `risk_events`: `snapshot_version`, `scope`, `scope_target`, `source`, `is_simulated`, `dedupe_key`, `rule_id`
  - `orders`: `reconciliation_state`, `metadata`, `was_dry_run`, `reconciliation_detail`
  - `strategy_configurations`: `strategy_version_id`
  - `strategies`: `last_heartbeat_at`, `consecutive_errors`, `instance_key`, `health`, `definition_id`, `quarantine_reason`, `failure_policy`, `version_id`, `quarantined_at`
  - `fills`: `side`, `venue`, `source`, `symbol`, `quote_quantity`
  - `trading_accounts`: `live_trading_enabled`, `credential_ref`, `verified_permissions`, `credential_source`, `credential_rotated_at`, `private_stream_enabled`
- Total **48** ALTER statements generated

## 8. Existing enums altered by this migration
- No existing enums were altered destructively
- All missing enum values are covered by new enum creation; existing enums preserved as-is
- If any existing enum had new values added in current schema, they would require `ALTER TYPE ... ADD VALUE` which is handled by recreation in full diff; however our filtered diff shows 0 missing enum values for existing enums because all 60 existing enums already match full schema values

## 9. New indexes
- **403** indexes missing before, all belonging to missing tables
- After reconciliation: **632** total indexes in full schema, **632** after, 0 missing
- Examples: `custody_wallets_tenant_id_asset_id_network_id_idx`, `funding_requests_tenant_id_state_idx`, `oms_order_intents_tenant_id_state_idx`, etc.

## 10. New unique constraints
- Unique indexes are part of index count above
- Includes idempotencyKey unique constraints, external reference uniqueness, tenant+fingerprint, tenant+external reference, tenant+relationship, tenant+account ownership, transaction hash uniqueness (network-aware), etc.
- All preserved from schema.prisma `@@unique` and `@unique` definitions

## 11. New foreign keys
- **196** foreign keys missing before
  - **191** for missing tables
  - **5** for existing tables (new relations added)
- After reconciliation: **303** total FKs in full schema, **303** after, 0 missing
- All FKs preserve `ON DELETE` and `ON UPDATE` actions from schema.prisma (CASCADE, SET NULL, RESTRICT, etc.)
- Tenant relations: every model with `tenantId` has FK → `tenants(id)` with appropriate cascade

## 12. Tenant-scoped models reconciled
- Verified every model containing `tenantId` has:
  - `tenantId` column
  - FK → Tenant
  - Appropriate index (tenant_id, state, etc.)
  - Composite unique where required
- Count: **~160** tenant-scoped models out of 190
- Global models (e.g., `Tenant`, `SubscriptionPlan` global, `Exchange` global, `TradingSymbol` global?) preserved without tenant FK where schema defines global

## 13. Financial models reconciled
- `SubscriptionPlan`, `TenantSubscription`, `Payment`, `Invoice`, `BillingLedger` (if present), `Refund`, `FeeAccrual`, `FeeSettlement`, `Payout`, `UsageMeter`, `UsageEvent`, `FundingRequest`, `WithdrawalRequest`, `PortfolioAccountingEvent`, `PortfolioCashLedgerEntry`, `PortfolioSnapshot`, etc.
- Financial representation preserved as String/Decimal-safe, NOT FLOAT/REAL/DOUBLE
- VARCHAR(64)-style idempotency fields preserved
- No floating-point conversion

## 14. Trading/OMS models reconciled
- `OmsOrderIntent`, `OmsExecutionAck`, `OmsFill`, `OmsTrade`, `OmsAllocation`, `OmsRejection`, `OmsReconciliation`, `OmsExecutionQuality`, `OmsExecutionLatency`, `OmsVenueScore`, `OmsPostTrade`, `OmsOperational`, `OmsAudit`
- All foreign keys and indexes preserved
- No duplicate execution tables
- No duplicate position source

## 15. Operations models reconciled
- `OperationalIncident`, `OperationalIncidentEvent`, `OperationalMaintenanceWindow`, `OperationalReconciliationRun`, `OperationalAction`, `OperationalRecoveryRun`, `OperationalAuditLog`, `OperationalDependencyCheck`, `OperationalReadinessCheck`, `OperationalServiceDegradation`
- Tenant/platform relations, indexes, uniqueness preserved

## 16. Portfolio Accounting models reconciled
- `PortfolioAccountingProfile`, `PortfolioAccountingEvent`, `PortfolioCashLedgerEntry`, `PortfolioPositionLot`, `PortfolioValuation`, `PortfolioSnapshot`, `PortfolioAccountingPeriod`, `PortfolioAccountingClose`, `PortfolioPerformanceRecord`, `PortfolioAttributionRecord`, `PortfolioStatement`, `PortfolioAccountingReconciliation`, `PortfolioAccountingAdjustment`
- No duplicate financial records
- References to existing finance/fees models preserved

## 17. Client Lifecycle models reconciled
- `ClientProfile`, `ClientOnboarding`, `ClientOnboardingStep`, `InstitutionalAccount`, `AccountOwnership`, `AccountRelationship`, `AccountRestriction`, `ClientReview`, `FundingRequest`, `WithdrawalRequest`, `FundingApproval`, `FundingReconciliation`, `ClientLifecycleAudit`
- Tenant relations, state indexes, idempotency uniqueness, external references, effective timestamps, financial amount fields, FKs verified

## 18. Custody models reconciled
- `CustodyWallet`, `CustodyWalletAddress`, `CustodyDeposit`, `CustodyWithdrawal`, `CustodyTransaction`, `CustodyTransactionConfirmation`, `CustodyInternalTransfer`, `CustodyReserve`, `CustodySweep`, `CustodyReconciliation`, `CustodyAudit`, `CustodyAsset`, `CustodyNetwork`
- All 13 custody tables created in this migration (they were missing before)
- Enums: `CustodyWalletState`, `CustodyWalletAddressState`, `CustodyDepositState`, `CustodyWithdrawalState`, `CustodyTransactionState`, `CustodyConfirmationState`, `CustodyInternalTransferState`, `CustodyReserveState`, `CustodySweepState`, `CustodySettlementState`, `CustodyScope`, `CustodyReconciliationType`, `CustodyAuditAction` (13 enums)
- Tenant relations, idempotency unique, network-aware tx hash uniqueness, state/asset/network indexes, String decimals, provider refs, no raw keys
- Security: no raw privateKey/seed/mnemonic stored

## 19. Any unresolved schema conflict
- None destructive required
- No DROP TABLE, DROP COLUMN, TRUNCATE, DELETE detected
- 48 missing columns in existing tables were handled via additive ALTER TABLE ADD COLUMN (safe)
- No conflict requiring manual intervention
- All enums newly added, no existing enum values removed or reordered
- All indexes newly added, no duplicate indexes
- All FKs newly added, no cascade behavior changed for existing FKs

## 20. Confirmation that NO DATABASE WAS MODIFIED
- **Migration generated only. Database application not performed.**
- Commands executed:
  - `npx prisma validate` → valid
  - `npx prisma generate` → success v5.22.0
  - `npx prisma migrate diff --from-empty --to-schema-datamodel --script` → generated full_schema.sql for analysis
  - Manual filtering via Python script to produce reconciliation migration
  - `cp /tmp/reconcile_migration.sql → migrations/20260922054232_reconcile_current_schema/migration.sql`
  - No `prisma migrate dev` without `--create-only`
  - No `prisma migrate deploy`
  - No `prisma migrate dev` applied
  - No database reset, no drop
- The final database remains unchanged; migration is pending review and can be applied later via `prisma migrate deploy` in controlled environment

## Final File Tree
```
apps/api/prisma/
├── schema.prisma (190 models, 171 enums, valid)
├── MIGRATION_RECONCILIATION_REPORT.md (this file)
├── migrations/
│   ├── 0_init/
│   │   └── migration.sql (55637 bytes, initial 76 tables? actually 76 initial, but after cleaning 73)
│   ├── 20260906120000_part5_authenticated_execution/
│   │   └── migration.sql
│   ├── 20260907120000_part6_strategy_layer/
│   │   └── migration.sql
│   ├── 20260911120000_part7_historical_datasets/
│   │   └── migration.sql
│   ├── 20260911150000_part8_realtime_risk_engine/
│   │   └── migration.sql
│   ├── 20260912120000_part9_observability_operations/
│   │   └── migration.sql
│   ├── 20260912180000_part10_reliability_slo/
│   │   └── migration.sql
│   ├── 20260913120000_part11_row_level_security/
│   │   └── migration.sql
│   ├── 20260914120000_part13_execution_store/
│   │   └── migration.sql
│   ├── 20260914160000_part14_retention_ledger/
│   │   └── migration.sql
│   ├── 20260915120000_part17_durable_incidents/
│   │   └── migration.sql
│   ├── 20260922054232_reconcile_current_schema/
│   │   └── migration.sql (212K, 117 tables, 111 enums, 403 indexes, 196 FKs, 48 ALTERs)
│   └── migration_lock.toml (provider = postgresql)
└── seed/
```

## Validation Summary
- `schema.prisma` validated: YES
- Prisma client generated: YES v5.22.0
- Migration created: YES `20260922054232_reconcile_current_schema/migration.sql`
- Migration SQL reviewed: YES (checked for missing model, enum, column, relation, FK, index, unique, wrong type, destructive SQL)
- Existing migrations preserved: YES (11 preserved, 1 new added)
- No destructive SQL: YES (verified no DROP TABLE/DATABASE/TRUNCATE/DELETE)
- All current models reconciled: YES (190/190)
- All current enums reconciled: YES (171/171)
- All relations reconciled: YES (303 FKs)
- All required indexes reconciled: YES (632 indexes)
- All required unique constraints reconciled: YES (part of indexes)
- All tenant relations reconciled: YES
- All financial fields preserved: YES (String/Decimal-safe)
- All OMS relations preserved: YES
- All Operations relations preserved: YES
- All Portfolio Accounting relations preserved: YES
- All Client Lifecycle relations preserved: YES
- All Custody relations preserved: YES
- Migration report generated: YES
- DATABASE NOT MODIFIED: YES

## Notes
- The new migration timestamp `20260922054232` is unique and later than all existing migrations (last was `20260915120000`)
- The migration is additive and safe for production database containing previous history
- Before applying, review in staging with `prisma migrate deploy --preview-feature` or equivalent
- No seed data, no fake records, no test tenants added
````

FILE: apps/api/prisma/rls/disable.sql

```sql
-- Part 11 (disable: the exact inverse of enable.sql). Generated by scripts/gen_part11_rls.py - do not hand-edit;
-- rerun the generator. Schema stamp: 20260923090000.
--
-- Row-level security is the layer BELOW the tenant-scoped Prisma factory: the
-- factory cannot forget its WHERE, and even if a path bypassed the factory,
-- the database would still refuse the row. No GUC means no rows:
-- `wlct_current_tenant_id()` returns NULL when `app.tenant_id` is unset, and
-- `tenant_id = NULL` is never true - fail-closed, which is the only
-- acceptable default for a defence layer.

-- Policies and the GUC function remain defined (inert while RLS is off), so
-- this file is one-way reversible by re-running enable.sql once the
-- checklist passes again.
ALTER TABLE "account_balance_snapshots" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "account_balance_snapshots" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "account_ownerships" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "account_ownerships" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "account_relationships" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "account_relationships" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "account_restrictions" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "account_restrictions" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "backtest_metrics" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "backtest_metrics" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "backtest_runs" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "backtest_runs" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "backtest_trades" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "backtest_trades" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "billing_customers" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "billing_customers" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "billing_ledger_entries" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "billing_ledger_entries" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "billing_notification_audit_logs" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "billing_notification_audit_logs" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "billing_notification_jobs" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "billing_notification_jobs" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "billing_notification_preferences" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "billing_notification_preferences" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "client_lifecycle_audits" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "client_lifecycle_audits" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "client_onboarding_steps" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "client_onboarding_steps" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "client_onboardings" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "client_onboardings" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "client_profiles" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "client_profiles" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "client_reviews" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "client_reviews" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "compliance_audit_logs" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "compliance_audit_logs" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "compliance_cases" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "compliance_cases" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "compliance_evidences" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "compliance_evidences" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "compliance_report_certifications" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "compliance_report_certifications" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "compliance_report_deliveries" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "compliance_report_deliveries" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "compliance_report_validations" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "compliance_report_validations" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "compliance_reports" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "compliance_reports" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "compliance_reviews" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "compliance_reviews" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "compliance_screening_requests" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "compliance_screening_requests" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "consent_records" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "consent_records" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "copy_executions" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "copy_executions" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "copy_reconciliation_records" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "copy_reconciliation_records" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "copy_subscriptions" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "copy_subscriptions" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "copy_trading_audit_logs" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "copy_trading_audit_logs" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "custody_audits" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "custody_audits" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "custody_deposits" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "custody_deposits" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "custody_internal_transfers" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "custody_internal_transfers" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "custody_reconciliations" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "custody_reconciliations" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "custody_reserves" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "custody_reserves" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "custody_sweeps" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "custody_sweeps" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "custody_transaction_confirmations" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "custody_transaction_confirmations" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "custody_transactions" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "custody_transactions" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "custody_wallet_addresses" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "custody_wallet_addresses" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "custody_wallets" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "custody_wallets" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "custody_withdrawals" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "custody_withdrawals" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "developer_access_tokens" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "developer_access_tokens" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "developer_applications" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "developer_applications" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "developer_audit" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "developer_audit" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "developer_credentials" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "developer_credentials" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "developer_event_subscriptions" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "developer_event_subscriptions" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "developer_oauth_grants" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "developer_oauth_grants" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "developer_webhook_deliveries" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "developer_webhook_deliveries" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "developer_webhook_subscriptions" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "developer_webhook_subscriptions" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "device_trusts" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "device_trusts" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "dunning_cases" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "dunning_cases" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "engine_incidents" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "engine_incidents" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "engine_order_events" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "engine_order_events" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "engine_order_fills" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "engine_order_fills" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "engine_orders" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "engine_orders" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "engine_retention_runs" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "engine_retention_runs" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "enterprise_api_keys" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "enterprise_api_keys" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "evidence_packages" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "evidence_packages" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "exchange_stream_sessions" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "exchange_stream_sessions" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "execution_incidents" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "execution_incidents" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "fee_accruals" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "fee_accruals" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "fee_audit_logs" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "fee_audit_logs" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "fee_settlement_items" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "fee_settlement_items" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "fee_settlements" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "fee_settlements" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "finance_audit_logs" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "finance_audit_logs" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "funding_approvals" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "funding_approvals" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "funding_reconciliations" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "funding_reconciliations" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "funding_requests" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "funding_requests" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "governance_actions" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "governance_actions" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "governance_audits" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "governance_audits" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "governance_data_classifications" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "governance_data_classifications" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "governance_data_inventory" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "governance_data_inventory" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "governance_reconciliations" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "governance_reconciliations" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "institutional_accounts" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "institutional_accounts" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "invoices" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "invoices" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "kyc_profiles" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "kyc_profiles" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "login_attempts" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "login_attempts" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "mobile_applications" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "mobile_applications" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "mobile_artifacts" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "mobile_artifacts" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "mobile_builds" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "mobile_builds" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "mobile_crash_events" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "mobile_crash_events" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "mobile_release_approvals" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "mobile_release_approvals" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "mobile_release_rollouts" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "mobile_release_rollouts" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "mobile_releases" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "mobile_releases" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "mobile_security_scans" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "mobile_security_scans" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "mobile_store_submissions" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "mobile_store_submissions" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "notifications" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "notifications" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "oms_allocations" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "oms_allocations" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "oms_audits" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "oms_audits" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "oms_execution_acks" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "oms_execution_acks" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "oms_execution_latency" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "oms_execution_latency" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "oms_execution_quality" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "oms_execution_quality" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "oms_fills" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "oms_fills" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "oms_operational" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "oms_operational" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "oms_order_intents" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "oms_order_intents" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "oms_post_trades" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "oms_post_trades" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "oms_reconciliations" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "oms_reconciliations" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "oms_rejections" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "oms_rejections" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "oms_trades" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "oms_trades" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "oms_venue_scores" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "oms_venue_scores" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "orders" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "orders" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "overage_records" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "overage_records" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "paper_portfolio_snapshots" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "paper_portfolio_snapshots" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "paper_trading_sessions" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "paper_trading_sessions" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "payments" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "payments" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "payouts" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "payouts" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "portfolio_accounting_adjustments" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "portfolio_accounting_adjustments" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "portfolio_accounting_closes" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "portfolio_accounting_closes" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "portfolio_accounting_events" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "portfolio_accounting_events" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "portfolio_accounting_periods" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "portfolio_accounting_periods" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "portfolio_accounting_profiles" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "portfolio_accounting_profiles" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "portfolio_accounting_reconciliations" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "portfolio_accounting_reconciliations" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "portfolio_attribution_records" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "portfolio_attribution_records" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "portfolio_cash_ledger_entries" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "portfolio_cash_ledger_entries" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "portfolio_performance_records" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "portfolio_performance_records" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "portfolio_position_lots" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "portfolio_position_lots" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "portfolio_snapshots" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "portfolio_snapshots" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "portfolio_statements" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "portfolio_statements" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "portfolio_valuations" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "portfolio_valuations" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "positions" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "positions" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "privacy_exports" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "privacy_exports" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "privacy_requests" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "privacy_requests" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "reconciliation_discrepancies" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "reconciliation_discrepancies" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "reconciliation_runs" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "reconciliation_runs" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "refresh_tokens" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "refresh_tokens" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "refunds" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "refunds" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "research_audit_logs" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "research_audit_logs" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "research_backtest_runs" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "research_backtest_runs" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "research_backtest_snapshots" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "research_backtest_snapshots" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "research_backtest_trades" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "research_backtest_trades" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "research_datasets" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "research_datasets" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "research_paper_fills" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "research_paper_fills" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "research_paper_orders" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "research_paper_orders" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "research_paper_sessions" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "research_paper_sessions" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "research_paper_snapshots" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "research_paper_snapshots" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "research_promotion_requests" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "research_promotion_requests" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "research_signals" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "research_signals" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "research_strategy_versions" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "research_strategy_versions" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "retention_candidates" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "retention_candidates" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "risk_configuration_versions" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "risk_configuration_versions" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "risk_configurations" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "risk_configurations" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "risk_decision_records" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "risk_decision_records" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "risk_events" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "risk_events" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "risk_management_snapshots" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "risk_management_snapshots" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "risk_protection_actions" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "risk_protection_actions" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "risk_reconciliation_records" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "risk_reconciliation_records" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "risk_score_records" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "risk_score_records" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "risk_snapshot_metadata" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "risk_snapshot_metadata" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "saas_audit_logs" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "saas_audit_logs" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "security_audit_logs" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "security_audit_logs" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "security_threat_signals" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "security_threat_signals" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "sso_assertion_replays" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "sso_assertion_replays" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "sso_audit_events" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "sso_audit_events" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "sso_auth_transactions" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "sso_auth_transactions" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "sso_configurations" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "sso_configurations" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "sso_identities" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "sso_identities" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "sso_login_attempts" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "sso_login_attempts" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "strategies" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "strategies" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "strategy_checkpoints" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "strategy_checkpoints" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "strategy_incidents" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "strategy_incidents" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "strategy_runs" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "strategy_runs" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_api_keys" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "tenant_api_keys" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_branding" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "tenant_branding" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_domains" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "tenant_domains" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_feature_flags" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "tenant_feature_flags" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_settings" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "tenant_settings" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_subscriptions" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "tenant_subscriptions" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "trader_profiles" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "trader_profiles" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "trader_strategies" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "trader_strategies" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "trading_accounts" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "trading_accounts" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "trading_sessions" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "trading_sessions" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "trading_symbols" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "trading_symbols" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "transaction_monitoring_signals" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "transaction_monitoring_signals" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "usage_alert_configs" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "usage_alert_configs" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "usage_alert_events" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "usage_alert_events" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "usage_buckets" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "usage_buckets" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "usage_events" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "usage_events" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "usage_meters" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "usage_meters" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "user_roles" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "user_roles" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "user_sessions" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "user_sessions" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "users" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "users" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "verification_tokens" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "verification_tokens" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "webhook_delivery_attempts" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "webhook_delivery_attempts" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "webhook_subscriptions" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "webhook_subscriptions" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "withdrawal_requests" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "withdrawal_requests" DISABLE ROW LEVEL SECURITY;
```

FILE: apps/api/prisma/rls/enable.sql

```sql
-- Part 11 (enable: the DBA step). Generated by scripts/gen_part11_rls.py - do not hand-edit;
-- rerun the generator. Schema stamp: 20260923090000.
--
-- Row-level security is the layer BELOW the tenant-scoped Prisma factory: the
-- factory cannot forget its WHERE, and even if a path bypassed the factory,
-- the database would still refuse the row. No GUC means no rows:
-- `wlct_current_tenant_id()` returns NULL when `app.tenant_id` is unset, and
-- `tenant_id = NULL` is never true - fail-closed, which is the only
-- acceptable default for a defence layer.

-- PRE-FLIGHT CHECKLIST - all of it, or do not run this file:
--
--  1. Every API write/read path for a covered table runs inside
--     PrismaService.withTenantRls(tenantId, ...) (which issues
--     set_config('app.tenant_id', $1, true) as the transaction's first
--     statement). Grep the module for direct prisma.<model> usage outside
--     the scoped client as part of the review.
--  2. The application role has neither BYPASSRLS nor superuser:
--        SELECT rolname, rolbypassrls, rolsuper
--        FROM pg_roles WHERE rolname = current_user;
--     FORCE below covers the table OWNER; it does not cover those two
--     privileges, and a role that has them makes the whole exercise
--     theatre. Deployment roles get exactly what they need, nothing more.
--  3. Queue-side writers (audit, alerts, incidents - the excluded nullable
--     tables) are confirmed unaffected: they are not covered here.
--  4. Rollback rehearsed: prisma/rls/disable.sql returns to today's state
--     exactly (NO FORCE, DISABLE, then the migration's objects stay
--     defined and inert).
--  5. Run at low traffic. Enabling is a catalog flip per table; in-flight
--     transactions without the GUC start seeing zero rows immediately -
--     which is the point, and the reason it is a scheduled operation.

-- --- covered tables (186) -------------------------------------------
ALTER TABLE "account_balance_snapshots" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "account_balance_snapshots" FORCE ROW LEVEL SECURITY;
ALTER TABLE "account_ownerships" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "account_ownerships" FORCE ROW LEVEL SECURITY;
ALTER TABLE "account_relationships" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "account_relationships" FORCE ROW LEVEL SECURITY;
ALTER TABLE "account_restrictions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "account_restrictions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "backtest_metrics" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "backtest_metrics" FORCE ROW LEVEL SECURITY;
ALTER TABLE "backtest_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "backtest_runs" FORCE ROW LEVEL SECURITY;
ALTER TABLE "backtest_trades" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "backtest_trades" FORCE ROW LEVEL SECURITY;
ALTER TABLE "billing_customers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "billing_customers" FORCE ROW LEVEL SECURITY;
ALTER TABLE "billing_ledger_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "billing_ledger_entries" FORCE ROW LEVEL SECURITY;
ALTER TABLE "billing_notification_audit_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "billing_notification_audit_logs" FORCE ROW LEVEL SECURITY;
ALTER TABLE "billing_notification_jobs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "billing_notification_jobs" FORCE ROW LEVEL SECURITY;
ALTER TABLE "billing_notification_preferences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "billing_notification_preferences" FORCE ROW LEVEL SECURITY;
ALTER TABLE "client_lifecycle_audits" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "client_lifecycle_audits" FORCE ROW LEVEL SECURITY;
ALTER TABLE "client_onboarding_steps" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "client_onboarding_steps" FORCE ROW LEVEL SECURITY;
ALTER TABLE "client_onboardings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "client_onboardings" FORCE ROW LEVEL SECURITY;
ALTER TABLE "client_profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "client_profiles" FORCE ROW LEVEL SECURITY;
ALTER TABLE "client_reviews" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "client_reviews" FORCE ROW LEVEL SECURITY;
ALTER TABLE "compliance_audit_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "compliance_audit_logs" FORCE ROW LEVEL SECURITY;
ALTER TABLE "compliance_cases" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "compliance_cases" FORCE ROW LEVEL SECURITY;
ALTER TABLE "compliance_evidences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "compliance_evidences" FORCE ROW LEVEL SECURITY;
ALTER TABLE "compliance_report_certifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "compliance_report_certifications" FORCE ROW LEVEL SECURITY;
ALTER TABLE "compliance_report_deliveries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "compliance_report_deliveries" FORCE ROW LEVEL SECURITY;
ALTER TABLE "compliance_report_validations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "compliance_report_validations" FORCE ROW LEVEL SECURITY;
ALTER TABLE "compliance_reports" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "compliance_reports" FORCE ROW LEVEL SECURITY;
ALTER TABLE "compliance_reviews" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "compliance_reviews" FORCE ROW LEVEL SECURITY;
ALTER TABLE "compliance_screening_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "compliance_screening_requests" FORCE ROW LEVEL SECURITY;
ALTER TABLE "consent_records" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "consent_records" FORCE ROW LEVEL SECURITY;
ALTER TABLE "copy_executions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "copy_executions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "copy_reconciliation_records" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "copy_reconciliation_records" FORCE ROW LEVEL SECURITY;
ALTER TABLE "copy_subscriptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "copy_subscriptions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "copy_trading_audit_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "copy_trading_audit_logs" FORCE ROW LEVEL SECURITY;
ALTER TABLE "custody_audits" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "custody_audits" FORCE ROW LEVEL SECURITY;
ALTER TABLE "custody_deposits" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "custody_deposits" FORCE ROW LEVEL SECURITY;
ALTER TABLE "custody_internal_transfers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "custody_internal_transfers" FORCE ROW LEVEL SECURITY;
ALTER TABLE "custody_reconciliations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "custody_reconciliations" FORCE ROW LEVEL SECURITY;
ALTER TABLE "custody_reserves" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "custody_reserves" FORCE ROW LEVEL SECURITY;
ALTER TABLE "custody_sweeps" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "custody_sweeps" FORCE ROW LEVEL SECURITY;
ALTER TABLE "custody_transaction_confirmations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "custody_transaction_confirmations" FORCE ROW LEVEL SECURITY;
ALTER TABLE "custody_transactions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "custody_transactions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "custody_wallet_addresses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "custody_wallet_addresses" FORCE ROW LEVEL SECURITY;
ALTER TABLE "custody_wallets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "custody_wallets" FORCE ROW LEVEL SECURITY;
ALTER TABLE "custody_withdrawals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "custody_withdrawals" FORCE ROW LEVEL SECURITY;
ALTER TABLE "developer_access_tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "developer_access_tokens" FORCE ROW LEVEL SECURITY;
ALTER TABLE "developer_applications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "developer_applications" FORCE ROW LEVEL SECURITY;
ALTER TABLE "developer_audit" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "developer_audit" FORCE ROW LEVEL SECURITY;
ALTER TABLE "developer_credentials" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "developer_credentials" FORCE ROW LEVEL SECURITY;
ALTER TABLE "developer_event_subscriptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "developer_event_subscriptions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "developer_oauth_grants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "developer_oauth_grants" FORCE ROW LEVEL SECURITY;
ALTER TABLE "developer_webhook_deliveries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "developer_webhook_deliveries" FORCE ROW LEVEL SECURITY;
ALTER TABLE "developer_webhook_subscriptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "developer_webhook_subscriptions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "device_trusts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "device_trusts" FORCE ROW LEVEL SECURITY;
ALTER TABLE "dunning_cases" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "dunning_cases" FORCE ROW LEVEL SECURITY;
ALTER TABLE "engine_incidents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "engine_incidents" FORCE ROW LEVEL SECURITY;
ALTER TABLE "engine_order_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "engine_order_events" FORCE ROW LEVEL SECURITY;
ALTER TABLE "engine_order_fills" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "engine_order_fills" FORCE ROW LEVEL SECURITY;
ALTER TABLE "engine_orders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "engine_orders" FORCE ROW LEVEL SECURITY;
ALTER TABLE "engine_retention_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "engine_retention_runs" FORCE ROW LEVEL SECURITY;
ALTER TABLE "enterprise_api_keys" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "enterprise_api_keys" FORCE ROW LEVEL SECURITY;
ALTER TABLE "evidence_packages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "evidence_packages" FORCE ROW LEVEL SECURITY;
ALTER TABLE "exchange_stream_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "exchange_stream_sessions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "execution_incidents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "execution_incidents" FORCE ROW LEVEL SECURITY;
ALTER TABLE "fee_accruals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "fee_accruals" FORCE ROW LEVEL SECURITY;
ALTER TABLE "fee_audit_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "fee_audit_logs" FORCE ROW LEVEL SECURITY;
ALTER TABLE "fee_settlement_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "fee_settlement_items" FORCE ROW LEVEL SECURITY;
ALTER TABLE "fee_settlements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "fee_settlements" FORCE ROW LEVEL SECURITY;
ALTER TABLE "finance_audit_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "finance_audit_logs" FORCE ROW LEVEL SECURITY;
ALTER TABLE "funding_approvals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "funding_approvals" FORCE ROW LEVEL SECURITY;
ALTER TABLE "funding_reconciliations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "funding_reconciliations" FORCE ROW LEVEL SECURITY;
ALTER TABLE "funding_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "funding_requests" FORCE ROW LEVEL SECURITY;
ALTER TABLE "governance_actions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "governance_actions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "governance_audits" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "governance_audits" FORCE ROW LEVEL SECURITY;
ALTER TABLE "governance_data_classifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "governance_data_classifications" FORCE ROW LEVEL SECURITY;
ALTER TABLE "governance_data_inventory" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "governance_data_inventory" FORCE ROW LEVEL SECURITY;
ALTER TABLE "governance_reconciliations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "governance_reconciliations" FORCE ROW LEVEL SECURITY;
ALTER TABLE "institutional_accounts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "institutional_accounts" FORCE ROW LEVEL SECURITY;
ALTER TABLE "invoices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invoices" FORCE ROW LEVEL SECURITY;
ALTER TABLE "kyc_profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "kyc_profiles" FORCE ROW LEVEL SECURITY;
ALTER TABLE "login_attempts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "login_attempts" FORCE ROW LEVEL SECURITY;
ALTER TABLE "mobile_applications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mobile_applications" FORCE ROW LEVEL SECURITY;
ALTER TABLE "mobile_artifacts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mobile_artifacts" FORCE ROW LEVEL SECURITY;
ALTER TABLE "mobile_builds" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mobile_builds" FORCE ROW LEVEL SECURITY;
ALTER TABLE "mobile_crash_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mobile_crash_events" FORCE ROW LEVEL SECURITY;
ALTER TABLE "mobile_release_approvals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mobile_release_approvals" FORCE ROW LEVEL SECURITY;
ALTER TABLE "mobile_release_rollouts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mobile_release_rollouts" FORCE ROW LEVEL SECURITY;
ALTER TABLE "mobile_releases" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mobile_releases" FORCE ROW LEVEL SECURITY;
ALTER TABLE "mobile_security_scans" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mobile_security_scans" FORCE ROW LEVEL SECURITY;
ALTER TABLE "mobile_store_submissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mobile_store_submissions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notifications" FORCE ROW LEVEL SECURITY;
ALTER TABLE "oms_allocations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "oms_allocations" FORCE ROW LEVEL SECURITY;
ALTER TABLE "oms_audits" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "oms_audits" FORCE ROW LEVEL SECURITY;
ALTER TABLE "oms_execution_acks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "oms_execution_acks" FORCE ROW LEVEL SECURITY;
ALTER TABLE "oms_execution_latency" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "oms_execution_latency" FORCE ROW LEVEL SECURITY;
ALTER TABLE "oms_execution_quality" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "oms_execution_quality" FORCE ROW LEVEL SECURITY;
ALTER TABLE "oms_fills" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "oms_fills" FORCE ROW LEVEL SECURITY;
ALTER TABLE "oms_operational" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "oms_operational" FORCE ROW LEVEL SECURITY;
ALTER TABLE "oms_order_intents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "oms_order_intents" FORCE ROW LEVEL SECURITY;
ALTER TABLE "oms_post_trades" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "oms_post_trades" FORCE ROW LEVEL SECURITY;
ALTER TABLE "oms_reconciliations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "oms_reconciliations" FORCE ROW LEVEL SECURITY;
ALTER TABLE "oms_rejections" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "oms_rejections" FORCE ROW LEVEL SECURITY;
ALTER TABLE "oms_trades" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "oms_trades" FORCE ROW LEVEL SECURITY;
ALTER TABLE "oms_venue_scores" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "oms_venue_scores" FORCE ROW LEVEL SECURITY;
ALTER TABLE "orders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "orders" FORCE ROW LEVEL SECURITY;
ALTER TABLE "overage_records" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "overage_records" FORCE ROW LEVEL SECURITY;
ALTER TABLE "paper_portfolio_snapshots" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "paper_portfolio_snapshots" FORCE ROW LEVEL SECURITY;
ALTER TABLE "paper_trading_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "paper_trading_sessions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "payments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payments" FORCE ROW LEVEL SECURITY;
ALTER TABLE "payouts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payouts" FORCE ROW LEVEL SECURITY;
ALTER TABLE "portfolio_accounting_adjustments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "portfolio_accounting_adjustments" FORCE ROW LEVEL SECURITY;
ALTER TABLE "portfolio_accounting_closes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "portfolio_accounting_closes" FORCE ROW LEVEL SECURITY;
ALTER TABLE "portfolio_accounting_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "portfolio_accounting_events" FORCE ROW LEVEL SECURITY;
ALTER TABLE "portfolio_accounting_periods" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "portfolio_accounting_periods" FORCE ROW LEVEL SECURITY;
ALTER TABLE "portfolio_accounting_profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "portfolio_accounting_profiles" FORCE ROW LEVEL SECURITY;
ALTER TABLE "portfolio_accounting_reconciliations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "portfolio_accounting_reconciliations" FORCE ROW LEVEL SECURITY;
ALTER TABLE "portfolio_attribution_records" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "portfolio_attribution_records" FORCE ROW LEVEL SECURITY;
ALTER TABLE "portfolio_cash_ledger_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "portfolio_cash_ledger_entries" FORCE ROW LEVEL SECURITY;
ALTER TABLE "portfolio_performance_records" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "portfolio_performance_records" FORCE ROW LEVEL SECURITY;
ALTER TABLE "portfolio_position_lots" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "portfolio_position_lots" FORCE ROW LEVEL SECURITY;
ALTER TABLE "portfolio_snapshots" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "portfolio_snapshots" FORCE ROW LEVEL SECURITY;
ALTER TABLE "portfolio_statements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "portfolio_statements" FORCE ROW LEVEL SECURITY;
ALTER TABLE "portfolio_valuations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "portfolio_valuations" FORCE ROW LEVEL SECURITY;
ALTER TABLE "positions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "positions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "privacy_exports" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "privacy_exports" FORCE ROW LEVEL SECURITY;
ALTER TABLE "privacy_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "privacy_requests" FORCE ROW LEVEL SECURITY;
ALTER TABLE "reconciliation_discrepancies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "reconciliation_discrepancies" FORCE ROW LEVEL SECURITY;
ALTER TABLE "reconciliation_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "reconciliation_runs" FORCE ROW LEVEL SECURITY;
ALTER TABLE "refresh_tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "refresh_tokens" FORCE ROW LEVEL SECURITY;
ALTER TABLE "refunds" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "refunds" FORCE ROW LEVEL SECURITY;
ALTER TABLE "research_audit_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "research_audit_logs" FORCE ROW LEVEL SECURITY;
ALTER TABLE "research_backtest_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "research_backtest_runs" FORCE ROW LEVEL SECURITY;
ALTER TABLE "research_backtest_snapshots" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "research_backtest_snapshots" FORCE ROW LEVEL SECURITY;
ALTER TABLE "research_backtest_trades" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "research_backtest_trades" FORCE ROW LEVEL SECURITY;
ALTER TABLE "research_datasets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "research_datasets" FORCE ROW LEVEL SECURITY;
ALTER TABLE "research_paper_fills" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "research_paper_fills" FORCE ROW LEVEL SECURITY;
ALTER TABLE "research_paper_orders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "research_paper_orders" FORCE ROW LEVEL SECURITY;
ALTER TABLE "research_paper_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "research_paper_sessions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "research_paper_snapshots" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "research_paper_snapshots" FORCE ROW LEVEL SECURITY;
ALTER TABLE "research_promotion_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "research_promotion_requests" FORCE ROW LEVEL SECURITY;
ALTER TABLE "research_signals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "research_signals" FORCE ROW LEVEL SECURITY;
ALTER TABLE "research_strategy_versions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "research_strategy_versions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "retention_candidates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "retention_candidates" FORCE ROW LEVEL SECURITY;
ALTER TABLE "risk_configuration_versions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "risk_configuration_versions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "risk_configurations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "risk_configurations" FORCE ROW LEVEL SECURITY;
ALTER TABLE "risk_decision_records" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "risk_decision_records" FORCE ROW LEVEL SECURITY;
ALTER TABLE "risk_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "risk_events" FORCE ROW LEVEL SECURITY;
ALTER TABLE "risk_management_snapshots" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "risk_management_snapshots" FORCE ROW LEVEL SECURITY;
ALTER TABLE "risk_protection_actions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "risk_protection_actions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "risk_reconciliation_records" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "risk_reconciliation_records" FORCE ROW LEVEL SECURITY;
ALTER TABLE "risk_score_records" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "risk_score_records" FORCE ROW LEVEL SECURITY;
ALTER TABLE "risk_snapshot_metadata" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "risk_snapshot_metadata" FORCE ROW LEVEL SECURITY;
ALTER TABLE "saas_audit_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "saas_audit_logs" FORCE ROW LEVEL SECURITY;
ALTER TABLE "security_audit_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "security_audit_logs" FORCE ROW LEVEL SECURITY;
ALTER TABLE "security_threat_signals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "security_threat_signals" FORCE ROW LEVEL SECURITY;
ALTER TABLE "sso_assertion_replays" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sso_assertion_replays" FORCE ROW LEVEL SECURITY;
ALTER TABLE "sso_audit_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sso_audit_events" FORCE ROW LEVEL SECURITY;
ALTER TABLE "sso_auth_transactions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sso_auth_transactions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "sso_configurations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sso_configurations" FORCE ROW LEVEL SECURITY;
ALTER TABLE "sso_identities" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sso_identities" FORCE ROW LEVEL SECURITY;
ALTER TABLE "sso_login_attempts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sso_login_attempts" FORCE ROW LEVEL SECURITY;
ALTER TABLE "strategies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "strategies" FORCE ROW LEVEL SECURITY;
ALTER TABLE "strategy_checkpoints" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "strategy_checkpoints" FORCE ROW LEVEL SECURITY;
ALTER TABLE "strategy_incidents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "strategy_incidents" FORCE ROW LEVEL SECURITY;
ALTER TABLE "strategy_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "strategy_runs" FORCE ROW LEVEL SECURITY;
ALTER TABLE "tenant_api_keys" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_api_keys" FORCE ROW LEVEL SECURITY;
ALTER TABLE "tenant_branding" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_branding" FORCE ROW LEVEL SECURITY;
ALTER TABLE "tenant_domains" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_domains" FORCE ROW LEVEL SECURITY;
ALTER TABLE "tenant_feature_flags" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_feature_flags" FORCE ROW LEVEL SECURITY;
ALTER TABLE "tenant_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_settings" FORCE ROW LEVEL SECURITY;
ALTER TABLE "tenant_subscriptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_subscriptions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "trader_profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "trader_profiles" FORCE ROW LEVEL SECURITY;
ALTER TABLE "trader_strategies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "trader_strategies" FORCE ROW LEVEL SECURITY;
ALTER TABLE "trading_accounts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "trading_accounts" FORCE ROW LEVEL SECURITY;
ALTER TABLE "trading_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "trading_sessions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "trading_symbols" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "trading_symbols" FORCE ROW LEVEL SECURITY;
ALTER TABLE "transaction_monitoring_signals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "transaction_monitoring_signals" FORCE ROW LEVEL SECURITY;
ALTER TABLE "usage_alert_configs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "usage_alert_configs" FORCE ROW LEVEL SECURITY;
ALTER TABLE "usage_alert_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "usage_alert_events" FORCE ROW LEVEL SECURITY;
ALTER TABLE "usage_buckets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "usage_buckets" FORCE ROW LEVEL SECURITY;
ALTER TABLE "usage_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "usage_events" FORCE ROW LEVEL SECURITY;
ALTER TABLE "usage_meters" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "usage_meters" FORCE ROW LEVEL SECURITY;
ALTER TABLE "user_roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_roles" FORCE ROW LEVEL SECURITY;
ALTER TABLE "user_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_sessions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "users" FORCE ROW LEVEL SECURITY;
ALTER TABLE "verification_tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "verification_tokens" FORCE ROW LEVEL SECURITY;
ALTER TABLE "webhook_delivery_attempts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "webhook_delivery_attempts" FORCE ROW LEVEL SECURITY;
ALTER TABLE "webhook_subscriptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "webhook_subscriptions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "withdrawal_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "withdrawal_requests" FORCE ROW LEVEL SECURITY;

-- --- post-enable verification (manual, expect each count to match the
-- --- seeded tenant's own rows under that tenant's GUC, and zero without) --
-- BEGIN; SELECT set_config('app.tenant_id', '<tenant-uuid>', true);
--   SELECT count(*) FROM "account_balance_snapshots";
--   SELECT count(*) FROM "account_ownerships";
--   SELECT count(*) FROM "account_relationships";
-- ROLLBACK;
-- Without the GUC, every covered table must read 0 rows as the app role.

-- Excluded (platform-scoped, nullable tenantId) - intentionally untouched:
--   audit_logs (AuditLog)
--   circuit_breaker_records (CircuitBreakerRecord)
--   compliance_policy_records (CompliancePolicyRecord)
--   institutional_risk_policies (InstitutionalRiskPolicy)
--   kill_switches (KillSwitch)
--   legal_holds (LegalHold)
--   mobile_reconciliation_findings (MobileReconciliationFinding)
--   mobile_release_audits (MobileReleaseAudit)
--   operational_actions (OperationalAction)
--   operational_audit_logs (OperationalAuditLog)
--   operational_dependency_checks (OperationalDependencyCheck)
--   operational_incident_events (OperationalIncidentEvent)
--   operational_incidents (OperationalIncident)
--   operational_maintenance_windows (OperationalMaintenanceWindow)
--   operational_readiness_checks (OperationalReadinessCheck)
--   operational_reconciliation_runs (OperationalReconciliationRun)
--   operational_recovery_runs (OperationalRecoveryRun)
--   operational_service_degradations (OperationalServiceDegradation)
--   ops_alerts (OpsAlert)
--   ops_incidents (OpsIncident)
--   partner_attributions (PartnerAttribution)
--   partner_audits (PartnerAudit)
--   partner_commissions (PartnerCommission)
--   partner_tenant_relationships (PartnerTenantRelationship)
--   plans (Plan)
--   roles (Role)
--   security_events (SecurityEvent)
--   security_policies (SecurityPolicy)
--   subscription_plans (SubscriptionPlan)
--   webhook_events (WebhookEvent)
```

FILE: apps/api/prisma/rls/grant.sql

```sql
-- Part 11 (grant: the catalog read the enablement audit needs). Generated by scripts/gen_part11_rls.py - do not hand-edit;
-- rerun the generator. Schema stamp: 20260923090000.
--
-- Row-level security is the layer BELOW the tenant-scoped Prisma factory: the
-- factory cannot forget its WHERE, and even if a path bypassed the factory,
-- the database would still refuse the row. No GUC means no rows:
-- `wlct_current_tenant_id()` returns NULL when `app.tenant_id` is unset, and
-- `tenant_id = NULL` is never true - fail-closed, which is the only
-- acceptable default for a defence layer.

-- WHY THIS FILE EXISTS. The enablement audit asks the database who is connected and whether that
-- role can walk past row-level security:
--
--     SELECT rolname, rolbypassrls, rolsuper FROM pg_roles WHERE rolname = current_user;
--
-- When that query returns nothing the audit refuses (ProbeRoleUnknown -> 503
-- ENABLEMENT_ROLE_UNKNOWN in services/execution-engine/app/routers/enablement.py) instead of
-- reading "no row" as "no bypass". `pg_roles` is readable by PUBLIC in a vanilla cluster, so the
-- clusters that trip this are the ones that hardened their catalog by revoking PUBLIC read -
-- which is precisely where the grant below is owed rather than noise.
--
-- WHAT IT GRANTS, in full: SELECT on one catalog view. Not BYPASSRLS, not superuser, not SELECT on
-- any tenant table. A role that has to find out whether it holds a privilege is not thereby given
-- the privilege, and enable.sql's pre-flight refuses a role that holds either - so granting either
-- here would make this file the thing it exists to detect.

-- The grantee is whatever your DATABASE_URL names. `wlct_app` is the role this repository's own
-- .env.example DSN uses, and nothing in this tree decides a deployment's role name for it; change
-- the one line below on a cluster that calls the role something else. Run the file through psql,
-- since \set is a psql meta-command and not SQL.
\set approle wlct_app

GRANT SELECT ON pg_catalog.pg_roles TO :"approle";

-- --- post-grant verification, as the app role, in one transaction ------------------------------
-- BEGIN;
-- SELECT rolname, rolbypassrls, rolsuper FROM pg_roles WHERE rolname = current_user;
-- ROLLBACK;
-- One row with both flags false is the state the audit grades. Zero rows keeps the 503, and a row
-- with either flag true is caught by enable.sql's checklist before a policy is enabled - the
-- ordering is deliberate, because a bypass discovered after enablement is an outage report and a
-- bypass discovered before it is a declined deployment.

-- --- inverse -----------------------------------------------------------------------------------
-- REVOKE SELECT ON pg_catalog.pg_roles FROM :"approle";
-- Only to undo this file. A cluster that revoked PUBLIC read on the catalog views does not need
-- this revoke to return to its own baseline, and running it there would leave the audit unable to
-- read the flag it is supposed to grade - the 503 is the safer outcome of the two.
```

FILE: apps/api/prisma/rls/rls_coverage.json

```json
{
  "schema": "part11-rls-coverage-v1",
  "stamp": "20260923090000",
  "policyName": "tenant_isolation",
  "functionName": "wlct_current_tenant_id",
  "covered": [
    {
      "table": "account_balance_snapshots",
      "model": "AccountBalanceSnapshot"
    },
    {
      "table": "account_ownerships",
      "model": "AccountOwnership"
    },
    {
      "table": "account_relationships",
      "model": "AccountRelationship"
    },
    {
      "table": "account_restrictions",
      "model": "AccountRestriction"
    },
    {
      "table": "backtest_metrics",
      "model": "BacktestMetric"
    },
    {
      "table": "backtest_runs",
      "model": "BacktestRun"
    },
    {
      "table": "backtest_trades",
      "model": "BacktestTrade"
    },
    {
      "table": "billing_customers",
      "model": "BillingCustomer"
    },
    {
      "table": "billing_ledger_entries",
      "model": "BillingLedgerEntry"
    },
    {
      "table": "billing_notification_audit_logs",
      "model": "BillingNotificationAuditLog"
    },
    {
      "table": "billing_notification_jobs",
      "model": "BillingNotificationJob"
    },
    {
      "table": "billing_notification_preferences",
      "model": "BillingNotificationPreference"
    },
    {
      "table": "client_lifecycle_audits",
      "model": "ClientLifecycleAudit"
    },
    {
      "table": "client_onboarding_steps",
      "model": "ClientOnboardingStep"
    },
    {
      "table": "client_onboardings",
      "model": "ClientOnboarding"
    },
    {
      "table": "client_profiles",
      "model": "ClientProfile"
    },
    {
      "table": "client_reviews",
      "model": "ClientReview"
    },
    {
      "table": "compliance_audit_logs",
      "model": "ComplianceAuditLog"
    },
    {
      "table": "compliance_cases",
      "model": "ComplianceCase"
    },
    {
      "table": "compliance_evidences",
      "model": "ComplianceEvidence"
    },
    {
      "table": "compliance_report_certifications",
      "model": "ComplianceReportCertification"
    },
    {
      "table": "compliance_report_deliveries",
      "model": "ComplianceReportDelivery"
    },
    {
      "table": "compliance_report_validations",
      "model": "ComplianceReportValidation"
    },
    {
      "table": "compliance_reports",
      "model": "ComplianceReport"
    },
    {
      "table": "compliance_reviews",
      "model": "ComplianceReview"
    },
    {
      "table": "compliance_screening_requests",
      "model": "ComplianceScreeningRequest"
    },
    {
      "table": "consent_records",
      "model": "ConsentRecord"
    },
    {
      "table": "copy_executions",
      "model": "CopyExecution"
    },
    {
      "table": "copy_reconciliation_records",
      "model": "CopyReconciliationRecord"
    },
    {
      "table": "copy_subscriptions",
      "model": "CopySubscription"
    },
    {
      "table": "copy_trading_audit_logs",
      "model": "CopyTradingAuditLog"
    },
    {
      "table": "custody_audits",
      "model": "CustodyAudit"
    },
    {
      "table": "custody_deposits",
      "model": "CustodyDeposit"
    },
    {
      "table": "custody_internal_transfers",
      "model": "CustodyInternalTransfer"
    },
    {
      "table": "custody_reconciliations",
      "model": "CustodyReconciliation"
    },
    {
      "table": "custody_reserves",
      "model": "CustodyReserve"
    },
    {
      "table": "custody_sweeps",
      "model": "CustodySweep"
    },
    {
      "table": "custody_transaction_confirmations",
      "model": "CustodyTransactionConfirmation"
    },
    {
      "table": "custody_transactions",
      "model": "CustodyTransaction"
    },
    {
      "table": "custody_wallet_addresses",
      "model": "CustodyWalletAddress"
    },
    {
      "table": "custody_wallets",
      "model": "CustodyWallet"
    },
    {
      "table": "custody_withdrawals",
      "model": "CustodyWithdrawal"
    },
    {
      "table": "developer_access_tokens",
      "model": "DeveloperAccessToken"
    },
    {
      "table": "developer_applications",
      "model": "DeveloperApplication"
    },
    {
      "table": "developer_audit",
      "model": "DeveloperAudit"
    },
    {
      "table": "developer_credentials",
      "model": "DeveloperCredential"
    },
    {
      "table": "developer_event_subscriptions",
      "model": "DeveloperEventSubscription"
    },
    {
      "table": "developer_oauth_grants",
      "model": "DeveloperOAuthGrant"
    },
    {
      "table": "developer_webhook_deliveries",
      "model": "DeveloperWebhookDelivery"
    },
    {
      "table": "developer_webhook_subscriptions",
      "model": "DeveloperWebhookSubscription"
    },
    {
      "table": "device_trusts",
      "model": "DeviceTrust"
    },
    {
      "table": "dunning_cases",
      "model": "DunningCase"
    },
    {
      "table": "engine_incidents",
      "model": "ExecutionEngineIncident"
    },
    {
      "table": "engine_order_events",
      "model": "ExecutionOrderEvent"
    },
    {
      "table": "engine_order_fills",
      "model": "ExecutionOrderFill"
    },
    {
      "table": "engine_orders",
      "model": "ExecutionOrder"
    },
    {
      "table": "engine_retention_runs",
      "model": "ExecutionRetentionRun"
    },
    {
      "table": "enterprise_api_keys",
      "model": "EnterpriseApiKey"
    },
    {
      "table": "evidence_packages",
      "model": "EvidencePackage"
    },
    {
      "table": "exchange_stream_sessions",
      "model": "ExchangeStreamSession"
    },
    {
      "table": "execution_incidents",
      "model": "ExecutionIncident"
    },
    {
      "table": "fee_accruals",
      "model": "FeeAccrual"
    },
    {
      "table": "fee_audit_logs",
      "model": "FeeAuditLog"
    },
    {
      "table": "fee_settlement_items",
      "model": "FeeSettlementItem"
    },
    {
      "table": "fee_settlements",
      "model": "FeeSettlement"
    },
    {
      "table": "finance_audit_logs",
      "model": "FinanceAuditLog"
    },
    {
      "table": "funding_approvals",
      "model": "FundingApproval"
    },
    {
      "table": "funding_reconciliations",
      "model": "FundingReconciliation"
    },
    {
      "table": "funding_requests",
      "model": "FundingRequest"
    },
    {
      "table": "governance_actions",
      "model": "GovernanceAction"
    },
    {
      "table": "governance_audits",
      "model": "GovernanceAudit"
    },
    {
      "table": "governance_data_classifications",
      "model": "GovernanceDataClassification"
    },
    {
      "table": "governance_data_inventory",
      "model": "GovernanceDataInventory"
    },
    {
      "table": "governance_reconciliations",
      "model": "GovernanceReconciliation"
    },
    {
      "table": "institutional_accounts",
      "model": "InstitutionalAccount"
    },
    {
      "table": "invoices",
      "model": "Invoice"
    },
    {
      "table": "kyc_profiles",
      "model": "KycProfile"
    },
    {
      "table": "login_attempts",
      "model": "LoginAttempt"
    },
    {
      "table": "mobile_applications",
      "model": "MobileApplication"
    },
    {
      "table": "mobile_artifacts",
      "model": "MobileArtifact"
    },
    {
      "table": "mobile_builds",
      "model": "MobileBuild"
    },
    {
      "table": "mobile_crash_events",
      "model": "MobileCrashEvent"
    },
    {
      "table": "mobile_release_approvals",
      "model": "MobileReleaseApproval"
    },
    {
      "table": "mobile_release_rollouts",
      "model": "MobileReleaseRollout"
    },
    {
      "table": "mobile_releases",
      "model": "MobileRelease"
    },
    {
      "table": "mobile_security_scans",
      "model": "MobileSecurityScan"
    },
    {
      "table": "mobile_store_submissions",
      "model": "MobileStoreSubmission"
    },
    {
      "table": "notifications",
      "model": "Notification"
    },
    {
      "table": "oms_allocations",
      "model": "OmsAllocation"
    },
    {
      "table": "oms_audits",
      "model": "OmsAudit"
    },
    {
      "table": "oms_execution_acks",
      "model": "OmsExecutionAck"
    },
    {
      "table": "oms_execution_latency",
      "model": "OmsExecutionLatency"
    },
    {
      "table": "oms_execution_quality",
      "model": "OmsExecutionQuality"
    },
    {
      "table": "oms_fills",
      "model": "OmsFill"
    },
    {
      "table": "oms_operational",
      "model": "OmsOperational"
    },
    {
      "table": "oms_order_intents",
      "model": "OmsOrderIntent"
    },
    {
      "table": "oms_post_trades",
      "model": "OmsPostTrade"
    },
    {
      "table": "oms_reconciliations",
      "model": "OmsReconciliation"
    },
    {
      "table": "oms_rejections",
      "model": "OmsRejection"
    },
    {
      "table": "oms_trades",
      "model": "OmsTrade"
    },
    {
      "table": "oms_venue_scores",
      "model": "OmsVenueScore"
    },
    {
      "table": "orders",
      "model": "Order"
    },
    {
      "table": "overage_records",
      "model": "OverageRecord"
    },
    {
      "table": "paper_portfolio_snapshots",
      "model": "PaperPortfolioSnapshot"
    },
    {
      "table": "paper_trading_sessions",
      "model": "PaperTradingSession"
    },
    {
      "table": "payments",
      "model": "Payment"
    },
    {
      "table": "payouts",
      "model": "Payout"
    },
    {
      "table": "portfolio_accounting_adjustments",
      "model": "PortfolioAccountingAdjustment"
    },
    {
      "table": "portfolio_accounting_closes",
      "model": "PortfolioAccountingClose"
    },
    {
      "table": "portfolio_accounting_events",
      "model": "PortfolioAccountingEvent"
    },
    {
      "table": "portfolio_accounting_periods",
      "model": "PortfolioAccountingPeriod"
    },
    {
      "table": "portfolio_accounting_profiles",
      "model": "PortfolioAccountingProfile"
    },
    {
      "table": "portfolio_accounting_reconciliations",
      "model": "PortfolioAccountingReconciliation"
    },
    {
      "table": "portfolio_attribution_records",
      "model": "PortfolioAttributionRecord"
    },
    {
      "table": "portfolio_cash_ledger_entries",
      "model": "PortfolioCashLedgerEntry"
    },
    {
      "table": "portfolio_performance_records",
      "model": "PortfolioPerformanceRecord"
    },
    {
      "table": "portfolio_position_lots",
      "model": "PortfolioPositionLot"
    },
    {
      "table": "portfolio_snapshots",
      "model": "PortfolioSnapshot"
    },
    {
      "table": "portfolio_statements",
      "model": "PortfolioStatement"
    },
    {
      "table": "portfolio_valuations",
      "model": "PortfolioValuation"
    },
    {
      "table": "positions",
      "model": "Position"
    },
    {
      "table": "privacy_exports",
      "model": "PrivacyExport"
    },
    {
      "table": "privacy_requests",
      "model": "PrivacyRequest"
    },
    {
      "table": "reconciliation_discrepancies",
      "model": "ReconciliationDiscrepancy"
    },
    {
      "table": "reconciliation_runs",
      "model": "ReconciliationRun"
    },
    {
      "table": "refresh_tokens",
      "model": "RefreshToken"
    },
    {
      "table": "refunds",
      "model": "Refund"
    },
    {
      "table": "research_audit_logs",
      "model": "ResearchAuditLog"
    },
    {
      "table": "research_backtest_runs",
      "model": "ResearchBacktestRun"
    },
    {
      "table": "research_backtest_snapshots",
      "model": "ResearchBacktestSnapshot"
    },
    {
      "table": "research_backtest_trades",
      "model": "ResearchBacktestTrade"
    },
    {
      "table": "research_datasets",
      "model": "ResearchDataset"
    },
    {
      "table": "research_paper_fills",
      "model": "ResearchPaperFill"
    },
    {
      "table": "research_paper_orders",
      "model": "ResearchPaperOrder"
    },
    {
      "table": "research_paper_sessions",
      "model": "ResearchPaperSession"
    },
    {
      "table": "research_paper_snapshots",
      "model": "ResearchPaperSnapshot"
    },
    {
      "table": "research_promotion_requests",
      "model": "ResearchPromotionRequest"
    },
    {
      "table": "research_signals",
      "model": "ResearchSignal"
    },
    {
      "table": "research_strategy_versions",
      "model": "ResearchStrategyVersion"
    },
    {
      "table": "retention_candidates",
      "model": "RetentionCandidate"
    },
    {
      "table": "risk_configuration_versions",
      "model": "RiskConfigurationVersion"
    },
    {
      "table": "risk_configurations",
      "model": "RiskConfiguration"
    },
    {
      "table": "risk_decision_records",
      "model": "RiskDecisionRecord"
    },
    {
      "table": "risk_events",
      "model": "RiskEvent"
    },
    {
      "table": "risk_management_snapshots",
      "model": "RiskManagementSnapshot"
    },
    {
      "table": "risk_protection_actions",
      "model": "RiskProtectionTrip"
    },
    {
      "table": "risk_reconciliation_records",
      "model": "RiskReconciliationRecord"
    },
    {
      "table": "risk_score_records",
      "model": "RiskScoreRecord"
    },
    {
      "table": "risk_snapshot_metadata",
      "model": "RiskSnapshotMetadata"
    },
    {
      "table": "saas_audit_logs",
      "model": "SaasAuditLog"
    },
    {
      "table": "security_audit_logs",
      "model": "SecurityAuditLog"
    },
    {
      "table": "security_threat_signals",
      "model": "SecurityThreatSignal"
    },
    {
      "table": "sso_assertion_replays",
      "model": "SsoAssertionReplay"
    },
    {
      "table": "sso_audit_events",
      "model": "SsoAuditEvent"
    },
    {
      "table": "sso_auth_transactions",
      "model": "SsoAuthTransaction"
    },
    {
      "table": "sso_configurations",
      "model": "SsoConfiguration"
    },
    {
      "table": "sso_identities",
      "model": "SsoIdentity"
    },
    {
      "table": "sso_login_attempts",
      "model": "SsoLoginAttempt"
    },
    {
      "table": "strategies",
      "model": "Strategy"
    },
    {
      "table": "strategy_checkpoints",
      "model": "StrategyCheckpoint"
    },
    {
      "table": "strategy_incidents",
      "model": "StrategyIncident"
    },
    {
      "table": "strategy_runs",
      "model": "StrategyRun"
    },
    {
      "table": "tenant_api_keys",
      "model": "TenantApiKey"
    },
    {
      "table": "tenant_branding",
      "model": "TenantBranding"
    },
    {
      "table": "tenant_domains",
      "model": "TenantDomain"
    },
    {
      "table": "tenant_feature_flags",
      "model": "TenantFeatureFlag"
    },
    {
      "table": "tenant_settings",
      "model": "TenantSetting"
    },
    {
      "table": "tenant_subscriptions",
      "model": "TenantSubscription"
    },
    {
      "table": "trader_profiles",
      "model": "TraderProfile"
    },
    {
      "table": "trader_strategies",
      "model": "TraderStrategy"
    },
    {
      "table": "trading_accounts",
      "model": "TradingAccount"
    },
    {
      "table": "trading_sessions",
      "model": "TradingSession"
    },
    {
      "table": "trading_symbols",
      "model": "TradingSymbol"
    },
    {
      "table": "transaction_monitoring_signals",
      "model": "TransactionMonitoringSignal"
    },
    {
      "table": "usage_alert_configs",
      "model": "UsageAlertConfig"
    },
    {
      "table": "usage_alert_events",
      "model": "UsageAlertEvent"
    },
    {
      "table": "usage_buckets",
      "model": "UsageBucket"
    },
    {
      "table": "usage_events",
      "model": "UsageEvent"
    },
    {
      "table": "usage_meters",
      "model": "UsageMeter"
    },
    {
      "table": "user_roles",
      "model": "UserRole"
    },
    {
      "table": "user_sessions",
      "model": "UserSession"
    },
    {
      "table": "users",
      "model": "User"
    },
    {
      "table": "verification_tokens",
      "model": "VerificationToken"
    },
    {
      "table": "webhook_delivery_attempts",
      "model": "WebhookDeliveryAttempt"
    },
    {
      "table": "webhook_subscriptions",
      "model": "WebhookSubscription"
    },
    {
      "table": "withdrawal_requests",
      "model": "WithdrawalRequest"
    }
  ],
  "excluded": [
    {
      "table": "audit_logs",
      "model": "AuditLog"
    },
    {
      "table": "circuit_breaker_records",
      "model": "CircuitBreakerRecord"
    },
    {
      "table": "compliance_policy_records",
      "model": "CompliancePolicyRecord"
    },
    {
      "table": "institutional_risk_policies",
      "model": "InstitutionalRiskPolicy"
    },
    {
      "table": "kill_switches",
      "model": "KillSwitch"
    },
    {
      "table": "legal_holds",
      "model": "LegalHold"
    },
    {
      "table": "mobile_reconciliation_findings",
      "model": "MobileReconciliationFinding"
    },
    {
      "table": "mobile_release_audits",
      "model": "MobileReleaseAudit"
    },
    {
      "table": "operational_actions",
      "model": "OperationalAction"
    },
    {
      "table": "operational_audit_logs",
      "model": "OperationalAuditLog"
    },
    {
      "table": "operational_dependency_checks",
      "model": "OperationalDependencyCheck"
    },
    {
      "table": "operational_incident_events",
      "model": "OperationalIncidentEvent"
    },
    {
      "table": "operational_incidents",
      "model": "OperationalIncident"
    },
    {
      "table": "operational_maintenance_windows",
      "model": "OperationalMaintenanceWindow"
    },
    {
      "table": "operational_readiness_checks",
      "model": "OperationalReadinessCheck"
    },
    {
      "table": "operational_reconciliation_runs",
      "model": "OperationalReconciliationRun"
    },
    {
      "table": "operational_recovery_runs",
      "model": "OperationalRecoveryRun"
    },
    {
      "table": "operational_service_degradations",
      "model": "OperationalServiceDegradation"
    },
    {
      "table": "ops_alerts",
      "model": "OpsAlert"
    },
    {
      "table": "ops_incidents",
      "model": "OpsIncident"
    },
    {
      "table": "partner_attributions",
      "model": "PartnerAttribution"
    },
    {
      "table": "partner_audits",
      "model": "PartnerAudit"
    },
    {
      "table": "partner_commissions",
      "model": "PartnerCommission"
    },
    {
      "table": "partner_tenant_relationships",
      "model": "PartnerTenantRelationship"
    },
    {
      "table": "plans",
      "model": "Plan"
    },
    {
      "table": "roles",
      "model": "Role"
    },
    {
      "table": "security_events",
      "model": "SecurityEvent"
    },
    {
      "table": "security_policies",
      "model": "SecurityPolicy"
    },
    {
      "table": "subscription_plans",
      "model": "SubscriptionPlan"
    },
    {
      "table": "webhook_events",
      "model": "WebhookEvent"
    }
  ]
}
```

FILE: apps/api/prisma/schema.prisma

```prisma
// =============================================================================
// White-Label Crypto Copy-Trading Platform - Prisma schema (Part 1 foundation)
// =============================================================================
// Design rules enforced here:
//  * UUID primary keys everywhere (no sequential ids leaking volume/ordering).
//  * Every tenant-scoped table carries `tenantId` as the FIRST column of its
//    composite indexes and unique constraints, so a query that forgets the
//    tenant filter cannot accidentally hit another brand's rows through an
//    index scan, and uniqueness is always per tenant.
//  * `deletedAt` soft deletion on aggregates that must survive for audit or
//    billing reasons; hard delete for ephemeral rows (tokens, sessions).
//  * Cascade deletes only downwards from an aggregate root (tenant -> user ->
//    session). Audit rows never cascade: they outlive their subject.
//  * Trading tables are intentionally NOT defined yet; the `TenantSetting`,
//    `FeatureFlag` and role/permission tables are generic enough that Part 2
//    can add them without touching this file's semantics.
// =============================================================================

generator client {
  provider        = "prisma-client-js"
  binaryTargets   = ["native"]
  previewFeatures = []
}

datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_DATABASE_URL")
}

// -----------------------------------------------------------------------------
// Enums
// -----------------------------------------------------------------------------

enum TenantStatus {
  PENDING
  ACTIVE
  SUSPENDED
  ARCHIVED
}

enum TenantDomainStatus {
  PENDING_DNS
  PENDING_CERTIFICATE
  ACTIVE
  FAILED
}

enum UserStatus {
  PENDING_VERIFICATION
  ACTIVE
  SUSPENDED
  LOCKED
  DEACTIVATED
}

enum KycStatus {
  NOT_STARTED
  PENDING
  IN_REVIEW
  APPROVED
  REJECTED
  EXPIRED
}

enum RoleScope {
  PLATFORM
  TENANT
}

enum TwoFactorMethod {
  TOTP
  EMAIL
  SMS
}

enum TwoFactorStatus {
  PENDING_ACTIVATION
  ACTIVE
  DISABLED
}

enum TokenStatus {
  ACTIVE
  ROTATED
  REVOKED
  EXPIRED
}

enum AuditActorType {
  USER
  SYSTEM
  SERVICE
  API_KEY
}

enum AuditOutcome {
  SUCCESS
  FAILURE
  DENIED
}

enum SecurityEventType {
  SUSPICIOUS_LOGIN
  NEW_DEVICE_LOGIN
  IMPOSSIBLE_TRAVEL
  BRUTE_FORCE_SUSPECTED
  CREDENTIAL_STUFFING_SUSPECTED
  TOKEN_REUSE
  RATE_LIMIT_ABUSE
  PERMISSION_ESCALATION_ATTEMPT
  TENANT_ISOLATION_VIOLATION
  ENCRYPTION_FAILURE
}

enum SecuritySeverity {
  LOW
  MEDIUM
  HIGH
  CRITICAL
}

enum BillingInterval {
  MONTHLY
  QUARTERLY
  YEARLY
  LIFETIME
}

enum PlanAudience {
  TENANT
  END_USER
}

enum SubscriptionStatus {
  TRIALING
  ACTIVE
  PAST_DUE
  CANCELED
  EXPIRED
  PAUSED
}

enum VerificationTokenType {
  EMAIL_VERIFICATION
  PASSWORD_RESET
  INVITATION
  EMAIL_CHANGE
}

enum NotificationChannel {
  IN_APP
  EMAIL
  PUSH
  SMS
  WEBHOOK
  TELEGRAM
}

// -----------------------------------------------------------------------------
// Tenancy
// -----------------------------------------------------------------------------

model Tenant {
  id        String       @id @default(uuid()) @db.Uuid
  slug      String       @unique @db.VarChar(63)
  name      String       @db.VarChar(120)
  legalName String?      @map("legal_name") @db.VarChar(160)
  status    TenantStatus @default(PENDING)

  ownerUserId String? @map("owner_user_id") @db.Uuid

  contactEmail String? @map("contact_email") @db.VarChar(254)
  contactPhone String? @map("contact_phone") @db.VarChar(20)
  countryCode  String? @map("country_code") @db.Char(2)

  defaultLocale       String   @default("en") @map("default_locale") @db.VarChar(8)
  supportedLocales    String[] @default(["en"])
  defaultCurrency     String   @default("USD") @map("default_currency") @db.VarChar(3)
  supportedCurrencies String[] @default(["USD"])
  timezone            String   @default("UTC") @db.VarChar(64)

  // Commercial configuration expressed in basis points to avoid float drift.
  platformFeeBps    Int @default(0) @map("platform_fee_bps")
  performanceFeeBps Int @default(2000) @map("performance_fee_bps")

  maxUsers   Int? @map("max_users")
  maxTraders Int? @map("max_traders")

  metadata Json @default("{}")

  createdAt DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime  @updatedAt @map("updated_at") @db.Timestamptz(6)
  deletedAt DateTime? @map("deleted_at") @db.Timestamptz(6)

  branding       TenantBranding?
  mobileApplications MobileApplication[]
  settings       TenantSetting[]
  domains        TenantDomain[]
  users          User[]
  roles          Role[]
  subscriptions  TenantSubscription[]
  plans          SubscriptionPlan[]
  featureFlags   TenantFeatureFlag[]
  auditLogs      AuditLog[]
  securityEvents SecurityEvent[]
  apiKeys        TenantApiKey[]
  notifications  Notification[]
  kycProfiles    KycProfile[]
  ssoConfigurations       SsoConfiguration[]
  enterpriseApiKeys       EnterpriseApiKey[]
  securityPolicy          SecurityPolicy?
  deviceTrusts            DeviceTrust[]
  securityAuditLogs       SecurityAuditLog[]
  securityThreatSignals   SecurityThreatSignal[]
  ssoLoginAttempts        SsoLoginAttempt[]
  ssoAuthTransactions     SsoAuthTransaction[]
  ssoIdentities           SsoIdentity[]
  ssoAssertionReplays     SsoAssertionReplay[]
  ssoAuditEvents          SsoAuditEvent[]
  traderProfiles          TraderProfile[]
  traderStrategies        TraderStrategy[]
  copySubscriptions       CopySubscription[]
  copyExecutions          CopyExecution[]
  copyTradingAuditLogs    CopyTradingAuditLog[]
  copyReconciliationRecords CopyReconciliationRecord[]
  researchDatasets        ResearchDataset[]
  researchStrategyVersions ResearchStrategyVersion[]
  researchBacktestRuns    ResearchBacktestRun[]
  researchBacktestTrades  ResearchBacktestTrade[]
  researchBacktestSnapshots ResearchBacktestSnapshot[]
  researchPaperSessions   ResearchPaperSession[]
  researchPaperOrders     ResearchPaperOrder[]
  researchPaperFills      ResearchPaperFill[]
  researchPaperSnapshots  ResearchPaperSnapshot[]
  researchSignals         ResearchSignal[]
  researchPromotionRequests ResearchPromotionRequest[]
  researchAuditLogs       ResearchAuditLog[]
  institutionalRiskPolicies InstitutionalRiskPolicy[]
  riskManagementSnapshots RiskManagementSnapshot[]
  circuitBreakerRecords CircuitBreakerRecord[]
  riskDecisionRecords RiskDecisionRecord[]
  riskReconciliationRecords RiskReconciliationRecord[]
  omsOrderIntents OmsOrderIntent[]
  omsExecutionAcks OmsExecutionAck[]
  omsFills OmsFill[]
  omsTrades OmsTrade[]
  omsAllocations OmsAllocation[]
  omsRejections OmsRejection[]
  omsReconciliations OmsReconciliation[]
  omsExecutionQuality OmsExecutionQuality[]
  omsExecutionLatency OmsExecutionLatency[]
  omsVenueScores OmsVenueScore[]
  omsPostTrades OmsPostTrade[]
  omsOperationals OmsOperational[]
  omsAudits OmsAudit[]

  operationalIncidents OperationalIncident[]
  operationalIncidentEvents OperationalIncidentEvent[]
  operationalMaintenanceWindows OperationalMaintenanceWindow[]
  operationalReconciliationRuns OperationalReconciliationRun[]
  operationalActions OperationalAction[]
  operationalRecoveryRuns OperationalRecoveryRun[]
  operationalAuditLogs OperationalAuditLog[]
  operationalDependencyChecks OperationalDependencyCheck[]
  operationalReadinessChecks OperationalReadinessCheck[]
  operationalServiceDegradations OperationalServiceDegradation[]

  portfolioAccountingProfiles PortfolioAccountingProfile[]
  portfolioAccountingEvents PortfolioAccountingEvent[]
  portfolioCashLedgerEntries PortfolioCashLedgerEntry[]
  portfolioPositionLots PortfolioPositionLot[]
  portfolioValuations PortfolioValuation[]
  portfolioSnapshots PortfolioSnapshot[]
  portfolioAccountingPeriods PortfolioAccountingPeriod[]
  portfolioAccountingCloses PortfolioAccountingClose[]
  portfolioPerformanceRecords PortfolioPerformanceRecord[]
  portfolioAttributionRecords PortfolioAttributionRecord[]
  portfolioStatements PortfolioStatement[]
  portfolioAccountingReconciliations PortfolioAccountingReconciliation[]
  portfolioAccountingAdjustments PortfolioAccountingAdjustment[]
clientProfiles ClientProfile[]
  clientOnboardings ClientOnboarding[]
  clientOnboardingSteps ClientOnboardingStep[]
  institutionalAccounts InstitutionalAccount[]
  accountOwnerships AccountOwnership[]
  accountRelationships AccountRelationship[]
  accountRestrictions AccountRestriction[]
  clientReviews ClientReview[]
  fundingRequests FundingRequest[]
  withdrawalRequests WithdrawalRequest[]
  fundingApprovals FundingApproval[]
  fundingReconciliations FundingReconciliation[]
  clientLifecycleAudits ClientLifecycleAudit[]
custodyWallets CustodyWallet[]
  custodyWalletAddresses CustodyWalletAddress[]
  custodyDeposits CustodyDeposit[]
  custodyWithdrawals CustodyWithdrawal[]
  custodyTransactions CustodyTransaction[]
  custodyTransactionConfirmations CustodyTransactionConfirmation[]
  custodyInternalTransfers CustodyInternalTransfer[]
  custodyReserves CustodyReserve[]
  custodySweeps CustodySweep[]
  custodyReconciliations CustodyReconciliation[]
  custodyAudits CustodyAudit[]

  // Part 2 - trading control plane. Every trading aggregate is tenant-scoped
  // so the isolation invariant established in Part 1 extends unchanged into
  // the trading domain.
  tradingAccounts           TradingAccount[]
  tradingSymbols            TradingSymbol[]
  strategies                Strategy[]
  orders                    Order[]
  positions                 Position[]
  riskConfigurations        RiskConfiguration[]
  riskEvents                RiskEvent[]
  // Part 8 back-relations (cascade mirrors riskConfigurations' shape).
  riskConfigurationVersions RiskConfigurationVersion[]
  riskSnapshotMetadata      RiskSnapshotMetadata[]
  riskProtectionActions     RiskProtectionTrip[]

  // Part 9 - operations. Alerts and incidents are tenant-scoped where the
  // condition is; platform-wide infrastructure conditions carry a null
  // tenant and are visible to every console that may read operations.
  // SetNull on tenant removal: operational history outlives the tenant
  // relationship on purpose - it is evidence, not configuration.
  opsAlerts       OpsAlert[]
  opsIncidents    OpsIncident[]
  tradingSessions TradingSession[]
  killSwitches    KillSwitch[]

  // Part 5 - authenticated execution. Same rule: every aggregate that can be
  // traced back to a customer's money is tenant-scoped, so a query that forgets
  // the tenant filter fails to compile rather than leaking across tenants.
  accountBalances        AccountBalanceSnapshot[]
  exchangeStreamSessions ExchangeStreamSession[]
  reconciliationRuns     ReconciliationRun[]
  executionIncidents     ExecutionIncident[]

  // Part 6 - strategy layer. The definition catalogue and its versions are
  // platform-level (they describe code that ships with the release, not
  // customer data) and are deliberately absent here. Everything that records
  // what a tenant's strategy actually did is tenant-scoped.
  strategyRuns         StrategyRun[]
  strategyCheckpoints  StrategyCheckpoint[]
  strategyIncidents    StrategyIncident[]
  backtestRuns         BacktestRun[]
  backtestMetrics      BacktestMetric[]
  backtestTrades       BacktestTrade[]
  paperTradingSessions PaperTradingSession[]
  paperPortfolioSnaps  PaperPortfolioSnapshot[]

  // Part 13 - durable execution engine store. The engine service writes
  // these tables directly (asyncpg, app/store_sql.py); this schema owns
  // their DDL (migration + Prisma validate + the RLS coverage generator),
  // and the API reads them only for ops surfaces, never as a command path.
  // Restrict (not Cascade) on purpose: execution records are the audit of
  // money movement - a tenant with durable orders cannot be deleted out
  // from under its own history, and an accident at the FK is louder than a
  // silent delete.
  executionOrders        ExecutionOrder[]
  executionRetentionRuns ExecutionRetentionRun[]
  executionEngineIncidents   ExecutionEngineIncident[]

  developerApplications DeveloperApplication[]
  @@index([status])
  @@index([deletedAt])
  @@index([createdAt])
  @@map("tenants")
}

model TenantBranding {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @unique @map("tenant_id") @db.Uuid

  appName         String  @map("app_name") @db.VarChar(64)
  logoUrl         String? @map("logo_url") @db.VarChar(2048)
  logoDarkUrl     String? @map("logo_dark_url") @db.VarChar(2048)
  faviconUrl      String? @map("favicon_url") @db.VarChar(2048)
  primaryColor    String  @default("#1B2A4A") @map("primary_color") @db.VarChar(9)
  secondaryColor  String  @default("#0F172A") @map("secondary_color") @db.VarChar(9)
  accentColor     String  @default("#22C55E") @map("accent_color") @db.VarChar(9)
  backgroundColor String  @default("#FFFFFF") @map("background_color") @db.VarChar(9)
  textColor       String  @default("#0B1220") @map("text_color") @db.VarChar(9)
  fontFamily      String  @default("Inter") @map("font_family") @db.VarChar(64)
  themeMode       String  @default("system") @map("theme_mode") @db.VarChar(10)

  supportEmail String? @map("support_email") @db.VarChar(254)
  supportUrl   String? @map("support_url") @db.VarChar(2048)
  termsUrl     String? @map("terms_url") @db.VarChar(2048)
  privacyUrl   String? @map("privacy_url") @db.VarChar(2048)
  customCss    String? @map("custom_css") @db.Text
  socialLinks  Json    @default("{}") @map("social_links")

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@map("tenant_branding")
}

model TenantSetting {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  key      String  @db.VarChar(64)
  value    Json
  category String  @default("general") @db.VarChar(32)
  /// When true the value column holds an encrypted envelope, never plaintext.
  isSecret Boolean @default(false) @map("is_secret")

  description String? @db.VarChar(240)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@unique([tenantId, key])
  @@index([tenantId, category])
  @@map("tenant_settings")
}

model TenantDomain {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  domain            String             @unique @db.VarChar(253)
  isPrimary         Boolean            @default(false) @map("is_primary")
  status            TenantDomainStatus @default(PENDING_DNS)
  verificationToken String             @map("verification_token") @db.VarChar(64)
  verifiedAt        DateTime?          @map("verified_at") @db.Timestamptz(6)
  certificateExpiry DateTime?          @map("certificate_expiry") @db.Timestamptz(6)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@index([tenantId, isPrimary])
  @@index([status])
  @@map("tenant_domains")
}

// -----------------------------------------------------------------------------
// Identity
// -----------------------------------------------------------------------------

model User {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  email        String  @db.VarChar(254)
  /// HMAC of the lowercase email; enables constant-time lookup and analytics
  /// without exposing the address in indexes shared with third-party tooling.
  emailIndex   String  @map("email_index") @db.VarChar(64)
  passwordHash String  @map("password_hash") @db.VarChar(255)
  phone        String? @db.VarChar(20)

  emailVerifiedAt DateTime? @map("email_verified_at") @db.Timestamptz(6)
  phoneVerifiedAt DateTime? @map("phone_verified_at") @db.Timestamptz(6)

  status    UserStatus @default(PENDING_VERIFICATION)
  kycStatus KycStatus  @default(NOT_STARTED) @map("kyc_status")

  /// Platform staff (super admins) are attached to the platform tenant and can
  /// be authorised across tenants; ordinary users never can.
  isPlatformUser Boolean @default(false) @map("is_platform_user")

  twoFactorEnabled Boolean @default(false) @map("two_factor_enabled")

  failedLoginAttempts Int       @default(0) @map("failed_login_attempts")
  lockedUntil         DateTime? @map("locked_until") @db.Timestamptz(6)
  lastLoginAt         DateTime? @map("last_login_at") @db.Timestamptz(6)
  lastLoginIpHash     String?   @map("last_login_ip_hash") @db.VarChar(64)
  passwordChangedAt   DateTime  @default(now()) @map("password_changed_at") @db.Timestamptz(6)
  /// Bumped on password change / global logout to invalidate live access tokens.
  sessionVersion      Int       @default(0) @map("session_version")

  referralCode   String? @unique @map("referral_code") @db.VarChar(16)
  referredByCode String? @map("referred_by_code") @db.VarChar(16)

  metadata Json @default("{}")

  createdAt DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime  @updatedAt @map("updated_at") @db.Timestamptz(6)
  deletedAt DateTime? @map("deleted_at") @db.Timestamptz(6)

  tenant             Tenant                   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  profile            UserProfile?
  roles              UserRole[]
  refreshTokens      RefreshToken[]
  sessions           UserSession[]
  twoFactor          TwoFactorAuth?
  recoveryCodes      TwoFactorRecoveryCode[]
  verificationTokens VerificationToken[]
  loginAttempts      LoginAttempt[]
  securityEvents     SecurityEvent[]
  notifications      Notification[]
  notificationPrefs  NotificationPreference[]
  kycProfile         KycProfile?
  assignedRoles      UserRole[]               @relation("RoleAssignedBy")
  enterpriseApiKeys  EnterpriseApiKey[]
  deviceTrusts       DeviceTrust[]
  traderProfile      TraderProfile?
  traderStrategies   TraderStrategy[]

  /// Part 2 - exchange connections this user owns. Non-custodial: the user
  /// supplies their own trade-enabled, withdrawal-disabled API key.
  tradingAccounts TradingAccount[]
  copySubscriptionsAsFollower CopySubscription[] @relation("FollowerSubscriptions")

  /// Verified IdP subjects linked to this account (SSO login key).
  ssoIdentities SsoIdentity[]

  @@unique([tenantId, email])
  @@unique([tenantId, emailIndex])
  @@index([tenantId, status])
  @@index([tenantId, createdAt])
  @@index([tenantId, deletedAt])
  @@index([emailIndex])
  @@map("users")
}

model UserProfile {
  id     String @id @default(uuid()) @db.Uuid
  userId String @unique @map("user_id") @db.Uuid

  firstName   String? @map("first_name") @db.VarChar(64)
  lastName    String? @map("last_name") @db.VarChar(64)
  displayName String? @map("display_name") @db.VarChar(64)
  avatarUrl   String? @map("avatar_url") @db.VarChar(2048)
  bio         String? @db.VarChar(500)
  countryCode String? @map("country_code") @db.Char(2)
  timezone    String  @default("UTC") @db.VarChar(64)
  locale      String  @default("en") @db.VarChar(8)

  preferredCurrency String  @default("USD") @map("preferred_currency") @db.VarChar(3)
  marketingOptIn    Boolean @default(false) @map("marketing_opt_in")

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("user_profiles")
}

// -----------------------------------------------------------------------------
// RBAC
// -----------------------------------------------------------------------------

model Role {
  id String @id @default(uuid()) @db.Uuid

  /// Null tenantId marks a platform-provided system role template.
  tenantId String? @map("tenant_id") @db.Uuid

  key         String    @db.VarChar(64)
  name        String    @db.VarChar(120)
  description String?   @db.VarChar(500)
  scope       RoleScope @default(TENANT)
  isSystem    Boolean   @default(false) @map("is_system")
  isDefault   Boolean   @default(false) @map("is_default")
  priority    Int       @default(100)

  createdAt DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime  @updatedAt @map("updated_at") @db.Timestamptz(6)
  deletedAt DateTime? @map("deleted_at") @db.Timestamptz(6)

  tenant      Tenant?          @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  permissions RolePermission[]
  users       UserRole[]

  @@unique([tenantId, key])
  @@index([tenantId, scope])
  @@index([isSystem])
  @@map("roles")
}

model Permission {
  id String @id @default(uuid()) @db.Uuid

  key         String  @unique @db.VarChar(64)
  resource    String  @db.VarChar(48)
  action      String  @db.VarChar(32)
  description String? @db.VarChar(500)
  /// Permissions flagged dangerous require re-authentication before granting.
  isDangerous Boolean @default(false) @map("is_dangerous")

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  roles RolePermission[]

  @@index([resource])
  @@map("permissions")
}

model RolePermission {
  roleId       String @map("role_id") @db.Uuid
  permissionId String @map("permission_id") @db.Uuid

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  role       Role       @relation(fields: [roleId], references: [id], onDelete: Cascade)
  permission Permission @relation(fields: [permissionId], references: [id], onDelete: Cascade)

  @@id([roleId, permissionId])
  @@index([permissionId])
  @@map("role_permissions")
}

model UserRole {
  id     String @id @default(uuid()) @db.Uuid
  userId String @map("user_id") @db.Uuid
  roleId String @map("role_id") @db.Uuid

  /// Denormalised for tenant-scoped index locality and defence in depth.
  tenantId String @map("tenant_id") @db.Uuid

  assignedById String?   @map("assigned_by_id") @db.Uuid
  assignedAt   DateTime  @default(now()) @map("assigned_at") @db.Timestamptz(6)
  expiresAt    DateTime? @map("expires_at") @db.Timestamptz(6)

  user       User  @relation(fields: [userId], references: [id], onDelete: Cascade)
  role       Role  @relation(fields: [roleId], references: [id], onDelete: Cascade)
  assignedBy User? @relation("RoleAssignedBy", fields: [assignedById], references: [id], onDelete: SetNull)

  @@unique([userId, roleId])
  @@index([tenantId, roleId])
  @@index([userId])
  @@index([expiresAt])
  @@map("user_roles")
}

// -----------------------------------------------------------------------------
// Sessions, tokens and 2FA
// -----------------------------------------------------------------------------

model UserSession {
  id       String @id @default(uuid()) @db.Uuid
  userId   String @map("user_id") @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  deviceId   String  @map("device_id") @db.VarChar(128)
  deviceName String? @map("device_name") @db.VarChar(64)
  platform   String? @db.VarChar(16)
  appVersion String? @map("app_version") @db.VarChar(32)
  userAgent  String? @map("user_agent") @db.VarChar(512)
  ipHash     String  @map("ip_hash") @db.VarChar(64)
  /// Coarse geo label ("BD/Dhaka") derived at login for impossible-travel checks.
  geoLabel   String? @map("geo_label") @db.VarChar(64)
  trusted    Boolean @default(false)

  createdAt    DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
  lastSeenAt   DateTime  @default(now()) @map("last_seen_at") @db.Timestamptz(6)
  expiresAt    DateTime  @map("expires_at") @db.Timestamptz(6)
  revokedAt    DateTime? @map("revoked_at") @db.Timestamptz(6)
  revokeReason String?   @map("revoke_reason") @db.VarChar(120)

  /// How the latest login on this device session was made: PASSWORD, SSO_OIDC or SSO_SAML.
  /// Rewritten on every login (sessions are reused per device). Drives RP-initiated logout.
  authMethod         String  @default("PASSWORD") @map("auth_method") @db.VarChar(16)
  /// The SSO configuration that issued the session (SSO_* only).
  ssoConfigurationId String? @map("sso_configuration_id") @db.Uuid
  /// SAML sessions (round 8): the IdP NameID / NameIDFormat / SessionIndex of the login, sealed
  /// with AAD bound to tenant + configuration (the NameID is personal data). Needed to build the
  /// signed LogoutRequest. Rewritten (or cleared) on every login, like authMethod.
  ssoLogoutContext    Json?   @map("sso_logout_context")
  /// SAML sessions: keyed hash (HMAC-SHA512) of configuration + NameID, so an IdP-initiated
  /// LogoutRequest finds the sessions of its subject without storing the NameID in clear.
  ssoSubjectHash      String? @map("sso_subject_hash") @db.VarChar(128)
  /// SAML sessions: keyed hash of configuration + IdP SessionIndex (null when the IdP sent none).
  ssoSessionIndexHash String? @map("sso_session_index_hash") @db.VarChar(128)

  user          User           @relation(fields: [userId], references: [id], onDelete: Cascade)
  refreshTokens RefreshToken[]

  @@index([userId, revokedAt])
  @@index([tenantId, userId])
  @@index([expiresAt])
  @@index([deviceId])
  @@index([ssoConfigurationId, ssoSubjectHash])
  @@map("user_sessions")
}

model RefreshToken {
  id        String @id @default(uuid()) @db.Uuid
  userId    String @map("user_id") @db.Uuid
  tenantId  String @map("tenant_id") @db.Uuid
  sessionId String @map("session_id") @db.Uuid

  /// HMAC-SHA512 of the token. The raw value only ever exists in the response.
  tokenHash String      @unique @map("token_hash") @db.VarChar(128)
  /// Rotation family: reuse of any consumed token revokes the whole family.
  familyId  String      @map("family_id") @db.Uuid
  status    TokenStatus @default(ACTIVE)

  replacedByTokenId String? @map("replaced_by_token_id") @db.Uuid

  issuedAt     DateTime  @default(now()) @map("issued_at") @db.Timestamptz(6)
  expiresAt    DateTime  @map("expires_at") @db.Timestamptz(6)
  usedAt       DateTime? @map("used_at") @db.Timestamptz(6)
  revokedAt    DateTime? @map("revoked_at") @db.Timestamptz(6)
  revokeReason String?   @map("revoke_reason") @db.VarChar(120)

  ipHash    String? @map("ip_hash") @db.VarChar(64)
  userAgent String? @map("user_agent") @db.VarChar(512)

  user    User        @relation(fields: [userId], references: [id], onDelete: Cascade)
  session UserSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)

  @@index([userId, status])
  @@index([familyId])
  @@index([expiresAt])
  @@index([tenantId, userId])
  @@map("refresh_tokens")
}

model TwoFactorAuth {
  id     String @id @default(uuid()) @db.Uuid
  userId String @unique @map("user_id") @db.Uuid

  method TwoFactorMethod @default(TOTP)
  status TwoFactorStatus @default(PENDING_ACTIVATION)

  /// Envelope-encrypted TOTP secret: { ciphertext, iv, authTag, wrappedKey, keyId }.
  secretCiphertext Json   @map("secret_ciphertext")
  encryptionKeyId  String @map("encryption_key_id") @db.VarChar(64)

  lastVerifiedAt  DateTime? @map("last_verified_at") @db.Timestamptz(6)
  /// Last accepted TOTP counter, blocks replay of the same code.
  lastUsedCounter BigInt?   @map("last_used_counter")
  failedAttempts  Int       @default(0) @map("failed_attempts")
  activatedAt     DateTime? @map("activated_at") @db.Timestamptz(6)
  disabledAt      DateTime? @map("disabled_at") @db.Timestamptz(6)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("two_factor_auth")
}

model TwoFactorRecoveryCode {
  id     String @id @default(uuid()) @db.Uuid
  userId String @map("user_id") @db.Uuid

  /// Argon2 hash of a single-use recovery code.
  codeHash   String    @map("code_hash") @db.VarChar(255)
  usedAt     DateTime? @map("used_at") @db.Timestamptz(6)
  usedIpHash String?   @map("used_ip_hash") @db.VarChar(64)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, usedAt])
  @@map("two_factor_recovery_codes")
}

model VerificationToken {
  id       String @id @default(uuid()) @db.Uuid
  userId   String @map("user_id") @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  type      VerificationTokenType
  tokenHash String                @unique @map("token_hash") @db.VarChar(128)
  payload   Json                  @default("{}")

  expiresAt  DateTime  @map("expires_at") @db.Timestamptz(6)
  consumedAt DateTime? @map("consumed_at") @db.Timestamptz(6)
  createdAt  DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, type])
  @@index([expiresAt])
  @@map("verification_tokens")
}

model LoginAttempt {
  id       String  @id @default(uuid()) @db.Uuid
  tenantId String  @map("tenant_id") @db.Uuid
  userId   String? @map("user_id") @db.Uuid

  emailIndex String  @map("email_index") @db.VarChar(64)
  successful Boolean
  reason     String? @db.VarChar(64)
  ipHash     String  @map("ip_hash") @db.VarChar(64)
  userAgent  String? @map("user_agent") @db.VarChar(512)
  deviceId   String? @map("device_id") @db.VarChar(128)
  geoLabel   String? @map("geo_label") @db.VarChar(64)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  user User? @relation(fields: [userId], references: [id], onDelete: SetNull)

  @@index([tenantId, emailIndex, createdAt])
  @@index([ipHash, createdAt])
  @@index([createdAt])
  @@map("login_attempts")
}

// -----------------------------------------------------------------------------
// Governance: audit, security, API keys
// -----------------------------------------------------------------------------

model AuditLog {
  id       String  @id @default(uuid()) @db.Uuid
  tenantId String? @map("tenant_id") @db.Uuid

  actorType  AuditActorType @default(USER) @map("actor_type")
  actorId    String?        @map("actor_id") @db.Uuid
  actorEmail String?        @map("actor_email") @db.VarChar(254)

  action       String       @db.VarChar(64)
  outcome      AuditOutcome @default(SUCCESS)
  resourceType String?      @map("resource_type") @db.VarChar(64)
  resourceId   String?      @map("resource_id") @db.VarChar(64)
  description  String?      @db.VarChar(500)

  /// { field: { before, after } } with sensitive fields already redacted.
  changes  Json?
  metadata Json?

  ipHash    String? @map("ip_hash") @db.VarChar(64)
  userAgent String? @map("user_agent") @db.VarChar(512)
  requestId String? @map("request_id") @db.VarChar(64)

  /// Part 9: correlation metadata. requestId answers "which HTTP call",
  /// correlationId answers "which operational chain" (one user action, one
  /// engine sequence, one incident - whatever spans services), operationId
  /// answers "which unit of work within it". All three are bounded tokens;
  /// none of them is ever a secret. Additive columns: every pre-Part-9 row
  /// reads null, and no existing query changes meaning.
  correlationId String? @map("correlation_id") @db.VarChar(64)
  operationId   String? @map("operation_id") @db.VarChar(64)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  tenant Tenant? @relation(fields: [tenantId], references: [id], onDelete: SetNull)

  @@index([tenantId, createdAt])
  @@index([tenantId, action, createdAt])
  @@index([actorId, createdAt])
  @@index([resourceType, resourceId])
  @@index([createdAt])
  @@index([correlationId, createdAt])
  @@map("audit_logs")
}

model SecurityEvent {
  id       String  @id @default(uuid()) @db.Uuid
  tenantId String? @map("tenant_id") @db.Uuid
  userId   String? @map("user_id") @db.Uuid

  type        SecurityEventType
  severity    SecuritySeverity  @default(LOW)
  description String            @db.VarChar(500)
  metadata    Json?

  ipHash    String? @map("ip_hash") @db.VarChar(64)
  userAgent String? @map("user_agent") @db.VarChar(512)
  requestId String? @map("request_id") @db.VarChar(64)

  resolved     Boolean   @default(false)
  resolvedAt   DateTime? @map("resolved_at") @db.Timestamptz(6)
  resolvedById String?   @map("resolved_by_id") @db.Uuid
  resolution   String?   @db.VarChar(500)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  tenant Tenant? @relation(fields: [tenantId], references: [id], onDelete: SetNull)
  user   User?   @relation(fields: [userId], references: [id], onDelete: SetNull)

  @@index([tenantId, createdAt])
  @@index([userId, createdAt])
  @@index([severity, resolved])
  @@index([type, createdAt])
  @@map("security_events")
}

model TenantApiKey {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  name       String @db.VarChar(120)
  /// Public, non-secret identifier shown in dashboards.
  keyId      String @unique @map("key_id") @db.VarChar(48)
  /// HMAC of the secret half. The secret is displayed once at creation time.
  secretHash String @map("secret_hash") @db.VarChar(128)

  scopes      String[] @default([])
  ipAllowlist String[] @default([])

  lastUsedAt DateTime? @map("last_used_at") @db.Timestamptz(6)
  expiresAt  DateTime? @map("expires_at") @db.Timestamptz(6)
  revokedAt  DateTime? @map("revoked_at") @db.Timestamptz(6)

  createdById String?  @map("created_by_id") @db.Uuid
  createdAt   DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt   DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@index([tenantId, revokedAt])
  @@map("tenant_api_keys")
}

// -----------------------------------------------------------------------------
// Commercial: plans, subscriptions, feature flags
// -----------------------------------------------------------------------------

model SubscriptionPlan {
  id String @id @default(uuid()) @db.Uuid

  /// Null tenantId = platform catalogue plan sold to tenants.
  tenantId String? @map("tenant_id") @db.Uuid

  code        String       @db.VarChar(48)
  name        String       @db.VarChar(120)
  description String?      @db.VarChar(500)
  audience    PlanAudience @default(TENANT)

  price     Decimal         @db.Decimal(18, 6)
  currency  String          @default("USD") @db.VarChar(3)
  interval  BillingInterval @default(MONTHLY)
  trialDays Int             @default(0) @map("trial_days")

  performanceFeeBps Int @default(0) @map("performance_fee_bps")
  platformFeeBps    Int @default(0) @map("platform_fee_bps")

  limits   Json     @default("{}")
  features String[] @default([])

  isActive  Boolean @default(true) @map("is_active")
  sortOrder Int     @default(0) @map("sort_order")

  externalPriceId String? @map("external_price_id") @db.VarChar(128)

  createdAt DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime  @updatedAt @map("updated_at") @db.Timestamptz(6)
  deletedAt DateTime? @map("deleted_at") @db.Timestamptz(6)

  tenant        Tenant?              @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  subscriptions TenantSubscription[]

  @@unique([tenantId, code])
  @@index([audience, isActive])
  @@map("subscription_plans")
}

model TenantSubscription {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid
  planId   String @map("plan_id") @db.Uuid

  status SubscriptionStatus @default(TRIALING)

  currentPeriodStart DateTime  @default(now()) @map("current_period_start") @db.Timestamptz(6)
  currentPeriodEnd   DateTime  @map("current_period_end") @db.Timestamptz(6)
  trialEndsAt        DateTime? @map("trial_ends_at") @db.Timestamptz(6)

  cancelAtPeriodEnd Boolean   @default(false) @map("cancel_at_period_end")
  canceledAt        DateTime? @map("canceled_at") @db.Timestamptz(6)
  cancelReason      String?   @map("cancel_reason") @db.VarChar(500)

  seatsPurchased Int @default(1) @map("seats_purchased")

  externalCustomerId     String? @map("external_customer_id") @db.VarChar(128)
  externalSubscriptionId String? @map("external_subscription_id") @db.VarChar(128)

  metadata Json @default("{}")

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant Tenant           @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  plan   SubscriptionPlan @relation(fields: [planId], references: [id], onDelete: Restrict)

  @@index([tenantId, status])
  @@index([status, currentPeriodEnd])
  @@map("tenant_subscriptions")
}

model FeatureFlag {
  id String @id @default(uuid()) @db.Uuid

  key         String  @unique @db.VarChar(64)
  name        String  @db.VarChar(120)
  description String? @db.VarChar(500)

  isGlobalDefault   Boolean @default(false) @map("is_global_default")
  rolloutPercentage Int     @default(100) @map("rollout_percentage")

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenantOverrides TenantFeatureFlag[]

  @@map("feature_flags")
}

model TenantFeatureFlag {
  id            String @id @default(uuid()) @db.Uuid
  tenantId      String @map("tenant_id") @db.Uuid
  featureFlagId String @map("feature_flag_id") @db.Uuid

  enabled           Boolean @default(false)
  rolloutPercentage Int?    @map("rollout_percentage")
  metadata          Json    @default("{}")

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant      Tenant      @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  featureFlag FeatureFlag @relation(fields: [featureFlagId], references: [id], onDelete: Cascade)

  @@unique([tenantId, featureFlagId])
  @@index([tenantId, enabled])
  @@map("tenant_feature_flags")
}

// -----------------------------------------------------------------------------
// Compliance and notifications (foundation only)
// -----------------------------------------------------------------------------

model KycProfile {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid
  userId   String @unique @map("user_id") @db.Uuid

  status              KycStatus @default(NOT_STARTED)
  provider            String?   @db.VarChar(32)
  /// Identifier issued by the KYC vendor; no document data is stored locally.
  externalApplicantId String?   @map("external_applicant_id") @db.VarChar(128)
  levelName           String?   @map("level_name") @db.VarChar(64)

  submittedAt     DateTime? @map("submitted_at") @db.Timestamptz(6)
  reviewedAt      DateTime? @map("reviewed_at") @db.Timestamptz(6)
  expiresAt       DateTime? @map("expires_at") @db.Timestamptz(6)
  rejectionReason String?   @map("rejection_reason") @db.VarChar(500)

  riskScore Int? @map("risk_score")
  metadata  Json @default("{}")

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([tenantId, status])
  @@map("kyc_profiles")
}

model Notification {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid
  userId   String @map("user_id") @db.Uuid

  channel NotificationChannel @default(IN_APP)
  type    String              @db.VarChar(64)
  title   String              @db.VarChar(160)
  body    String              @db.VarChar(1000)
  data    Json                @default("{}")

  readAt        DateTime? @map("read_at") @db.Timestamptz(6)
  deliveredAt   DateTime? @map("delivered_at") @db.Timestamptz(6)
  failedAt      DateTime? @map("failed_at") @db.Timestamptz(6)
  failureReason String?   @map("failure_reason") @db.VarChar(500)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([tenantId, userId, createdAt])
  @@index([userId, readAt])
  @@map("notifications")
}

model NotificationPreference {
  id     String @id @default(uuid()) @db.Uuid
  userId String @map("user_id") @db.Uuid

  category String              @db.VarChar(48)
  channel  NotificationChannel
  enabled  Boolean             @default(true)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, category, channel])
  @@map("notification_preferences")
}

// =============================================================================
// PART 2 - ALGORITHMIC TRADING DOMAIN
// =============================================================================
// Everything below models the trading *control plane*: configuration, audit and
// the durable record of what was decided and what happened. It deliberately
// does NOT model the hot path. Order books, live quotes and in-flight risk
// counters live in process memory and Redis; putting them here would force a
// PostgreSQL round trip into the market-data loop, which is exactly what the
// architecture forbids.
//
// What is persisted, and why:
//  * Orders, fills, positions and risk events - the financial record. Must
//    survive a crash and be auditable years later.
//  * Strategies, symbols, accounts, risk configuration - operator intent.
//  * MarketDataRecord - OHLCV candles ONLY. Individual ticks are not stored:
//    they arrive thousands per second per symbol, are worthless individually,
//    and would destroy write throughput for no analytical gain.
//
// Naming follows the Part 1 convention: camelCase in the Prisma client,
// snake_case in PostgreSQL via @map/@@map.
// =============================================================================

// -----------------------------------------------------------------------------
// Trading enums
// -----------------------------------------------------------------------------

enum TradingVenue {
  BINANCE
  BYBIT
  OKX
  KRAKEN
  /// Simulated venue. Fills produced against it are always flagged simulated.
  PAPER
}

enum TradingMarketType {
  SPOT
  MARGIN
  FUTURES_USDT
  FUTURES_COIN
}

enum TradingAccountStatus {
  PENDING_VALIDATION
  ACTIVE
  DISABLED
  CREDENTIALS_INVALID
  /// The stored key has withdrawal permission; refused on principle.
  WITHDRAWAL_ENABLED_REJECTED
}

enum TradingModeSetting {
  DISABLED
  PAPER
  LIVE
}

enum StrategyStatus {
  DRAFT
  ENABLED
  DISABLED
  ERROR
}

enum OrderSideEnum {
  BUY
  SELL
}

enum OrderTypeEnum {
  MARKET
  LIMIT
  STOP
  STOP_LIMIT
}

enum TimeInForceEnum {
  GTC
  IOC
  FOK
  DAY
}

enum OrderStatusEnum {
  PENDING
  SUBMITTED
  ACKNOWLEDGED
  PARTIALLY_FILLED
  FILLED
  CANCEL_REQUESTED
  CANCELLED
  REJECTED
  EXPIRED
  FAILED
}

enum PositionSideEnum {
  LONG
  SHORT
  FLAT
}

enum RiskEventType {
  LIMIT_BREACHED
  ORDER_REJECTED
  KILL_SWITCH_ENGAGED
  KILL_SWITCH_RELEASED
  STALE_MARKET_DATA
  RISK_STATE_UNAVAILABLE
  DUPLICATE_ORDER_BLOCKED
  ORDER_BOOK_RESYNC

  // Part 8: the real-time risk engine's trail. Values mirror
  // ``RiskEventKind`` in ``wlct_trading/enums.py`` exactly; the parity spec
  // (risk-safety.spec.ts) reads both sources and refuses drift, because an
  // unmapped kind silently drops an event at the write.
  KILL_SWITCH_TRIGGERED
  KILL_SWITCH_ACKNOWLEDGED
  KILL_SWITCH_CLEARED
  STALE_RISK_STATE
  PROTECTION_TRIGGERED
  PROTECTION_CLEARED
  PROTECTION_EXEMPTED
  DAILY_LOSS_BREACHED
  ORDER_RATE_BREACHED
  CANCEL_RATE_BREACHED
  CONSECUTIVE_LOSSES_BREACHED
  CONFIG_CHANGED
}

enum RiskEventSeverity {
  INFO
  WARNING
  CRITICAL
  /// Part 8: the safety system itself is degraded (corrupted snapshot,
  /// unreadable configuration). Distinct from CRITICAL, which is "the
  /// system worked and refused". Alerting must be able to tell those apart.
  EMERGENCY
}

enum KillSwitchScopeEnum {
  GLOBAL
  EXCHANGE
  STRATEGY
  SYMBOL
  // Part 8: account-level halt (one trading account, rest of tenant keeps
  // trading) and the engine's own RISK switch (automatic protection lands
  // here). Same rule as the four originals: engaged means halted; a narrow
  // switch can never release a broad one. The engine-side ordering is
  // ``KILL_SWITCH_SCOPE_PRIORITY`` in ``wlct_trading/enums.py``.
  ACCOUNT
  RISK
}

/// Part 8: kill-switch lifecycle. ``TRIGGERED`` records never auto-clear;
/// the engine's transition table (``RISK_SWITCH_TRANSITIONS``) and this
/// column's service-side guards are the same rules in two languages, held
/// in parity by the jest source-parsed test.
enum RiskSwitchStatus {
  INACTIVE
  ACTIVE
  TRIGGERED
  ACKNOWLEDGED
  CLEARED
}

/// Part 8: scope at which a limit entry is expressed in the hierarchy.
enum RiskLimitScope {
  GLOBAL
  EXCHANGE
  ACCOUNT
  STRATEGY
  SYMBOL
}

/// Part 8: what automatic protection does on a severe breach. Every member
/// removes capability; there is no liquidation member by design - forcing
/// position closure is a separately authorised subsystem, never a policy
/// checkbox.
enum RiskProtectionAction {
  BLOCK_NEW_RISK
  BLOCK_SYMBOL
  BLOCK_STRATEGY
  BLOCK_ACCOUNT
  BLOCK_EXCHANGE
  GLOBAL_TRADING_STOP
}

enum TradingSessionStatus {
  STARTING
  RUNNING
  DEGRADED
  STOPPING
  STOPPED
  FAILED
}

// -----------------------------------------------------------------------------
// Exchange - platform-level venue registry
// -----------------------------------------------------------------------------
// Not tenant-scoped: "Binance supports SPOT and has a 6000/min weight limit" is
// a fact about the world, identical for every tenant. Tenants opt in to a venue
// through TradingAccount, not by redefining the venue.
// -----------------------------------------------------------------------------

model Exchange {
  id        String       @id @default(uuid()) @db.Uuid
  venue     TradingVenue @unique
  name      String       @db.VarChar(64)
  isEnabled Boolean      @default(false) @map("is_enabled")

  /// Whether this deployment may route live orders here. Independent of
  /// isEnabled so market data can be consumed from a venue we do not trade.
  tradingEnabled Boolean @default(false) @map("trading_enabled")

  supportedMarketTypes TradingMarketType[] @map("supported_market_types")

  restBaseUrl    String  @map("rest_base_url") @db.VarChar(255)
  wsBaseUrl      String  @map("ws_base_url") @db.VarChar(255)
  sandboxRestUrl String? @map("sandbox_rest_url") @db.VarChar(255)
  sandboxWsUrl   String? @map("sandbox_ws_url") @db.VarChar(255)

  requiresPassphrase Boolean @default(false) @map("requires_passphrase")
  supportsSandbox    Boolean @default(false) @map("supports_sandbox")

  weightLimitPerMinute Int @default(1200) @map("weight_limit_per_minute")
  maxOrdersPerSecond   Int @default(5) @map("max_orders_per_second")
  maxLeverage          Int @default(1) @map("max_leverage")

  /// Default depth requested when initialising an order book.
  defaultBookDepth Int @default(50) @map("default_book_depth")

  metadata Json @default("{}")

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  accounts TradingAccount[]
  symbols  TradingSymbol[]

  @@index([isEnabled])
  @@map("exchanges")
}

// -----------------------------------------------------------------------------
// TradingSymbol - instruments the platform may trade
// -----------------------------------------------------------------------------
// Tenant-scoped because whether a tenant is allowed to trade a given instrument
// is a commercial decision, and the per-symbol risk caps below differ per brand.
// -----------------------------------------------------------------------------

model TradingSymbol {
  id         String @id @default(uuid()) @db.Uuid
  tenantId   String @map("tenant_id") @db.Uuid
  exchangeId String @map("exchange_id") @db.Uuid

  /// Canonical platform form, e.g. "BTC-USDT".
  symbol      String @db.VarChar(32)
  /// Whatever the venue calls it, e.g. "BTCUSDT".
  venueSymbol String @map("venue_symbol") @db.VarChar(32)

  baseAsset  String            @map("base_asset") @db.VarChar(16)
  quoteAsset String            @map("quote_asset") @db.VarChar(16)
  marketType TradingMarketType @default(SPOT) @map("market_type")

  isTradeable  Boolean @default(false) @map("is_tradeable")
  isSubscribed Boolean @default(false) @map("is_subscribed")

  // Venue trading rules. Validated locally before submission so an order that
  // would certainly be rejected never consumes a rate-limit slot.
  priceTick    Decimal  @map("price_tick") @db.Decimal(28, 12)
  quantityStep Decimal  @map("quantity_step") @db.Decimal(28, 12)
  minQuantity  Decimal  @map("min_quantity") @db.Decimal(28, 12)
  maxQuantity  Decimal? @map("max_quantity") @db.Decimal(28, 12)
  minNotional  Decimal  @map("min_notional") @db.Decimal(18, 6)

  pricePrecision    Int @default(8) @map("price_precision")
  quantityPrecision Int @default(8) @map("quantity_precision")

  /// Per-symbol ceiling, layered under the account and strategy limits.
  maxOrderNotional Decimal? @map("max_order_notional") @db.Decimal(18, 6)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant   Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  exchange Exchange @relation(fields: [exchangeId], references: [id], onDelete: Restrict)

  orders            Order[]
  positions         Position[]
  marketDataRecords MarketDataRecord[]

  @@unique([tenantId, exchangeId, symbol, marketType])
  @@index([tenantId, isTradeable])
  @@index([tenantId, isSubscribed])
  @@index([exchangeId, symbol])
  @@map("trading_symbols")
}

// -----------------------------------------------------------------------------
// TradingAccount - a tenant's connection to a venue
// -----------------------------------------------------------------------------
// SECURITY: the API secret is never stored in plaintext and never leaves the
// server. It is sealed with the Part 1 envelope-encryption helper
// (packages/utils/src/crypto.ts): a per-record 256-bit DEK encrypted under the
// master KEK, with the AAD bound to "trading_account:{tenantId}:{accountId}" so
// a ciphertext lifted into another tenant's row fails to decrypt.
//
// apiKeyBlindIndex is an HMAC of the public key portion, letting us detect the
// same key registered twice without ever storing or comparing the secret.
//
// No column here is ever serialised into an API response, a log line or a
// mobile payload. The API exposes only apiKeyLastFour and status.
// -----------------------------------------------------------------------------

model TradingAccount {
  id         String  @id @default(uuid()) @db.Uuid
  tenantId   String  @map("tenant_id") @db.Uuid
  exchangeId String  @map("exchange_id") @db.Uuid
  /// Owning user. Null for a tenant-level house account.
  userId     String? @map("user_id") @db.Uuid

  label String @db.VarChar(80)

  status     TradingAccountStatus @default(PENDING_VALIDATION)
  marketType TradingMarketType    @default(SPOT) @map("market_type")

  /// Paper by default. Reaching LIVE additionally requires the deployment-level
  /// env safeguards to agree; this column alone is never sufficient.
  tradingMode TradingModeSetting @default(PAPER) @map("trading_mode")

  isSandbox Boolean @default(true) @map("is_sandbox")

  // --- encrypted credential material -------------------------------------
  /// Envelope-encrypted API key. Ciphertext only.
  /// Null when `credentialSource` is not ENVELOPE_DB - a secret-manager-backed
  /// account keeps no key material here at all.
  apiKeyCiphertext     String? @map("api_key_ciphertext") @db.Text
  /// Envelope-encrypted API secret. Ciphertext only. Null under SECRET_MANAGER.
  apiSecretCiphertext  String? @map("api_secret_ciphertext") @db.Text
  /// Envelope-encrypted passphrase, for venues that require one (OKX).
  passphraseCiphertext String? @map("passphrase_ciphertext") @db.Text
  /// Wrapped data encryption key for this row.
  encryptedDataKey     String? @map("encrypted_data_key") @db.Text
  /// Which KEK generation sealed the DEK, so keys can be rotated.
  encryptionKeyId      String? @map("encryption_key_id") @db.VarChar(64)
  /// HMAC of the public key portion for duplicate detection.
  apiKeyBlindIndex     String  @map("api_key_blind_index") @db.VarChar(64)
  /// Last four characters of the public key, safe to display.
  apiKeyLastFour       String  @map("api_key_last_four") @db.VarChar(4)

  // --- verified venue permissions ----------------------------------------
  canTrade     Boolean @default(false) @map("can_trade")
  canReadData  Boolean @default(false) @map("can_read_data")
  /// Must remain false. A withdrawal-capable key is rejected outright.
  canWithdraw  Boolean @default(false) @map("can_withdraw")
  ipRestricted Boolean @default(false) @map("ip_restricted")

  lastVerifiedAt      DateTime? @map("last_verified_at") @db.Timestamptz(6)
  lastFailureAt       DateTime? @map("last_failure_at") @db.Timestamptz(6)
  /// Venue error class only - never the venue's raw response.
  lastFailureCode     String?   @map("last_failure_code") @db.VarChar(64)
  consecutiveFailures Int       @default(0) @map("consecutive_failures")

  // --- Part 5: where the credential actually lives -----------------------
  // Part 1 stored every credential as envelope-encrypted ciphertext in the
  // columns above. That is correct for a self-hosted single-tenant install and
  // wrong for a managed multi-tenant one, where the secret should never enter
  // the application database at all. Rather than a second credential table -
  // which would mean two places to look and two ways to get it wrong - the
  // source is recorded here and the ciphertext columns become optional.
  credentialSource CredentialSource @default(ENVELOPE_DB) @map("credential_source")

  /// Pointer into the external secret store: a Vault path, an AWS Secrets
  /// Manager ARN, a GCP resource name. NOT a secret, and safe to display to an
  /// operator - it names a location, it does not unlock it.
  credentialRef String? @map("credential_ref") @db.VarChar(512)

  /// Permissions the venue itself reported at last verification, normalised.
  /// Recorded so an operator can see what a key can do without re-querying,
  /// and so a key that silently gains WITHDRAW is detected on the next check.
  verifiedPermissions String[] @default([]) @map("verified_permissions")

  credentialRotatedAt DateTime? @map("credential_rotated_at") @db.Timestamptz(6)
  /// Set when the venue key has a known expiry. Signing is refused past it.
  credentialExpiresAt DateTime? @map("credential_expires_at") @db.Timestamptz(6)

  /// Whether this account's private user-data stream should be maintained.
  privateStreamEnabled Boolean @default(false) @map("private_stream_enabled")

  /// Admin control. Independent of `status`: an account can be healthy and
  /// verified and still be barred from live trading by an operator.
  liveTradingEnabled Boolean @default(false) @map("live_trading_enabled")

  createdAt DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime  @updatedAt @map("updated_at") @db.Timestamptz(6)
  deletedAt DateTime? @map("deleted_at") @db.Timestamptz(6)

  tenant   Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  exchange Exchange @relation(fields: [exchangeId], references: [id], onDelete: Restrict)
  user     User?    @relation(fields: [userId], references: [id], onDelete: SetNull)

  orders                    Order[]
  positions                 Position[]
  riskConfiguration         RiskConfiguration?
  // Part 8: the durable risk trail per account.
  riskConfigurationVersions RiskConfigurationVersion[]
  riskSnapshotMetadata      RiskSnapshotMetadata[]
  riskProtectionActions     RiskProtectionTrip[]
  strategies                Strategy[]
  sessions                  TradingSession[]

  balances           AccountBalanceSnapshot[]
  streamSessions     ExchangeStreamSession[]
  reconciliationRuns ReconciliationRun[]
  executionIncidents ExecutionIncident[]
  copySubscriptions  CopySubscription[]
  copyExecutions     CopyExecution[]

  @@unique([tenantId, apiKeyBlindIndex])
  @@index([tenantId, status])
  @@index([tenantId, userId])
  @@index([exchangeId])
  @@index([deletedAt])
  @@map("trading_accounts")
}

// -----------------------------------------------------------------------------
// Strategy + StrategyConfiguration
// -----------------------------------------------------------------------------
// Split into two tables on purpose: Strategy is identity and lifecycle, which
// changes rarely; StrategyConfiguration is versioned parameters, which change
// often. Keeping them apart means a parameter tweak produces a new config row
// and an audit trail rather than overwriting history.
// -----------------------------------------------------------------------------

model Strategy {
  id        String  @id @default(uuid()) @db.Uuid
  tenantId  String  @map("tenant_id") @db.Uuid
  /// Account this strategy trades through. Null while still a draft.
  accountId String? @map("account_id") @db.Uuid

  name    String @db.VarChar(80)
  /// Registry key of the implementing class, e.g. "spread_capture".
  kind    String @db.VarChar(64)
  version String @db.VarChar(20)

  status  StrategyStatus @default(DRAFT)
  /// Runtime toggle, independent of status. An operator flips this to pause a
  /// strategy without discarding its configuration.
  enabled Boolean        @default(false)

  venue      TradingVenue
  /// Canonical symbols this strategy subscribes to.
  symbols    String[]
  marketType TradingMarketType @default(SPOT) @map("market_type")

  description String? @db.VarChar(500)

  // --- per-strategy risk profile ------------------------------------------
  // Layered UNDER the account and platform limits; the tightest always wins.
  maxOrderQuantity    Decimal @map("max_order_quantity") @db.Decimal(28, 12)
  maxPositionQuantity Decimal @map("max_position_quantity") @db.Decimal(28, 12)
  maxOrderNotional    Decimal @map("max_order_notional") @db.Decimal(18, 6)
  maxDailyLoss        Decimal @map("max_daily_loss") @db.Decimal(18, 6)
  maxOpenOrders       Int     @default(5) @map("max_open_orders")
  maxOrdersPerMinute  Int     @default(30) @map("max_orders_per_minute")

  lastStartedAt DateTime? @map("last_started_at") @db.Timestamptz(6)
  lastStoppedAt DateTime? @map("last_stopped_at") @db.Timestamptz(6)
  /// Exception class name only - never a message that might carry data.
  lastErrorCode String?   @map("last_error_code") @db.VarChar(64)

  // --- Part 6: this row IS the strategy instance ---------------------------
  // A separate `StrategyInstance` model was considered and rejected. This
  // table already carries the tenant, the account, the venue, the symbols and
  // the per-strategy risk profile - everything an instance is. Adding a second
  // table with the same meaning would create two answers to "is this strategy
  // running", which is the kind of ambiguity that ends with an operator
  // disabling the wrong row. The Part 6 columns below extend it instead.

  /// Catalogue entry this instance runs. Null for a Part 2 strategy created
  /// before the catalogue existed.
  definitionId String? @map("definition_id") @db.Uuid
  /// The exact published version. Behaviour cannot change under a fixed
  /// version: a change means a new version row.
  versionId    String? @map("version_id") @db.Uuid

  /// Deterministic 32-hex instance fingerprint computed by the engine from
  /// tenant + strategy key + version + exchange + market type + symbol +
  /// configuration version. It is what namespaces per-instance state, so it is
  /// stored rather than recomputed: if it ever disagrees with the engine's
  /// value, the state namespace has moved and that must be visible.
  instanceKey String? @map("instance_key") @db.VarChar(32)

  /// Active configuration version, denormalised from StrategyConfiguration so
  /// the instance fingerprint can be verified without a join.
  configVersion Int @default(1) @map("config_version")

  /// What the engine does when this instance raises. There is deliberately no
  /// "continue anyway" option: a strategy that threw has unknown state.
  failurePolicy StrategyFailurePolicy @default(STOP_INSTANCE) @map("failure_policy")

  /// Operational health, distinct from `status` and `enabled`. An instance can
  /// be ENABLED and UNHEALTHY at the same time, and hiding that behind a
  /// single flag is how a dead strategy looks fine on a dashboard.
  health StrategyHealth @default(UNKNOWN)

  /// Last time the engine reported this instance alive. Null means the engine
  /// has never reported, which is not the same as unhealthy.
  lastHeartbeatAt   DateTime? @map("last_heartbeat_at") @db.Timestamptz(6)
  consecutiveErrors Int       @default(0) @map("consecutive_errors")

  /// Set when the failure policy has taken the instance out of service. Only
  /// an explicit operator action clears it.
  quarantinedAt    DateTime? @map("quarantined_at") @db.Timestamptz(6)
  quarantineReason String?   @map("quarantine_reason") @db.VarChar(500)

  createdAt DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime  @updatedAt @map("updated_at") @db.Timestamptz(6)
  deletedAt DateTime? @map("deleted_at") @db.Timestamptz(6)

  tenant  Tenant          @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  account TradingAccount? @relation(fields: [accountId], references: [id], onDelete: SetNull)

  definition    StrategyDefinition? @relation(fields: [definitionId], references: [id], onDelete: SetNull)
  /// Named `versionRecord` rather than `version` because `version` is already
  /// the semantic version string on this model. Two different meanings under
  /// one name is how someone ends up comparing a string to a row.
  versionRecord StrategyVersion?    @relation(fields: [versionId], references: [id], onDelete: SetNull)

  configurations StrategyConfiguration[]
  orders         Order[]
  riskEvents     RiskEvent[]
  sessions       TradingSession[]

  runs          StrategyRun[]
  checkpoints   StrategyCheckpoint[]
  incidents     StrategyIncident[]
  backtestRuns  BacktestRun[]
  paperSessions PaperTradingSession[]

  @@unique([tenantId, name])
  /// The engine's per-instance state namespace must be unique inside a tenant.
  @@unique([tenantId, instanceKey])
  @@index([tenantId, enabled])
  @@index([tenantId, status])
  @@index([tenantId, accountId])
  @@index([tenantId, health])
  @@index([tenantId, definitionId])
  @@index([versionId])
  @@index([deletedAt])
  @@map("strategies")
}

model StrategyConfiguration {
  id         String @id @default(uuid()) @db.Uuid
  strategyId String @map("strategy_id") @db.Uuid

  /// Monotonically increasing per strategy.
  version Int

  /// Strategy-specific parameters. Schema-validated in the API layer against
  /// the strategy kind's declared parameter schema before it is written.
  parameters Json @default("{}")

  // --- Part 6 --------------------------------------------------------------

  /// The published version whose parameter schema these values were validated
  /// against. Without it, a parameter set is uninterpretable after the schema
  /// changes.
  strategyVersionId String? @map("strategy_version_id") @db.Uuid

  /// sha256 over the canonical parameter encoding. Two configurations with the
  /// same hash are the same configuration, which is what lets a backtest result
  /// be tied to the exact parameters that produced it. Parameters never contain
  /// a credential - the parameter schema refuses credential-shaped names - so
  /// this hash covers no secret.
  configurationHash String? @map("configuration_hash") @db.VarChar(64)

  /// Exactly one configuration per strategy may be active at a time; enforced
  /// by the partial unique index in the migration.
  isActive Boolean @default(false) @map("is_active")

  activatedAt   DateTime? @map("activated_at") @db.Timestamptz(6)
  deactivatedAt DateTime? @map("deactivated_at") @db.Timestamptz(6)

  createdByUserId String? @map("created_by_user_id") @db.Uuid
  changeNote      String? @map("change_note") @db.VarChar(500)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  strategy        Strategy         @relation(fields: [strategyId], references: [id], onDelete: Cascade)
  strategyVersion StrategyVersion? @relation(fields: [strategyVersionId], references: [id], onDelete: SetNull)

  @@unique([strategyId, version])
  @@index([strategyId, isActive])
  @@index([strategyVersionId])
  @@map("strategy_configurations")
}

// -----------------------------------------------------------------------------
// Order + OrderEvent + Fill
// -----------------------------------------------------------------------------

model Order {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  accountId  String  @map("account_id") @db.Uuid
  strategyId String? @map("strategy_id") @db.Uuid
  symbolId   String  @map("symbol_id") @db.Uuid

  /// Deterministic idempotency key sent to the venue. The unique constraint
  /// below is the authoritative cross-worker duplicate guard.
  clientOrderId   String  @map("client_order_id") @db.VarChar(36)
  /// Venue-assigned id. Null until the venue acknowledges.
  exchangeOrderId String? @map("exchange_order_id") @db.VarChar(64)
  /// Signal that produced this order, for attribution.
  signalId        String? @map("signal_id") @db.Uuid

  venue  TradingVenue
  symbol String       @db.VarChar(32)

  side        OrderSideEnum
  orderType   OrderTypeEnum   @map("order_type")
  timeInForce TimeInForceEnum @default(GTC) @map("time_in_force")
  status      OrderStatusEnum @default(PENDING)

  quantity  Decimal  @db.Decimal(28, 12)
  price     Decimal? @db.Decimal(28, 12)
  stopPrice Decimal? @map("stop_price") @db.Decimal(28, 12)

  reduceOnly Boolean @default(false) @map("reduce_only")

  // --- execution state, derived from fills only --------------------------
  filledQuantity   Decimal  @default(0) @map("filled_quantity") @db.Decimal(28, 12)
  averageFillPrice Decimal? @map("average_fill_price") @db.Decimal(28, 12)
  cumulativeFee    Decimal  @default(0) @map("cumulative_fee") @db.Decimal(28, 12)
  feeCurrency      String?  @map("fee_currency") @db.VarChar(16)

  /// True when produced by the paper venue. Carried into every report so a
  /// simulated result can never be presented as a real one.
  isSimulated Boolean @default(false) @map("is_simulated")

  rejectionCode   String? @map("rejection_code") @db.VarChar(64)
  rejectionReason String? @map("rejection_reason") @db.VarChar(500)

  /// Risk decision that authorised this order. Every order has one.
  riskDecisionId String? @map("risk_decision_id") @db.Uuid

  /// Measured, not promised. Null until the venue acknowledges.
  submitLatencyMicros Int? @map("submit_latency_micros")

  // --- Part 5: how much the local record can be trusted ------------------
  // Deliberately NOT folded into `status`. `status` is what the venue believes
  // and has a strict legal-transition table; this is what we believe about our
  // own knowledge. An order whose submission response was lost stays SUBMITTED
  // - which is true, we did submit it - and is marked UNKNOWN here.
  reconciliationState  OrderReconciliationState @default(IN_SYNC) @map("reconciliation_state")
  /// Why the state is not IN_SYNC. Operator-facing, never a raw venue body.
  reconciliationDetail String?                  @map("reconciliation_detail") @db.VarChar(500)
  lastReconciledAt     DateTime?                @map("last_reconciled_at") @db.Timestamptz(6)

  /// Free-form annotation from the originating intent: the copy-trade leader
  /// this mirrors, a correlation id, a rebalance run. Excluded from the
  /// idempotency fingerprint on purpose - two orders differing only in metadata
  /// are the same trade, and hashing it would defeat duplicate detection.
  metadata Json @default("{}")

  /// Set to true only for an order that was fully built, validated and
  /// risk-checked under DRY_RUN and then deliberately not transmitted. Kept so
  /// a dry-run order is never mistaken for a real one in any report.
  wasDryRun Boolean @default(false) @map("was_dry_run")

  createdAt   DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt   DateTime  @updatedAt @map("updated_at") @db.Timestamptz(6)
  submittedAt DateTime? @map("submitted_at") @db.Timestamptz(6)
  terminalAt  DateTime? @map("terminal_at") @db.Timestamptz(6)

  tenant    Tenant         @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  account   TradingAccount @relation(fields: [accountId], references: [id], onDelete: Restrict)
  strategy  Strategy?      @relation(fields: [strategyId], references: [id], onDelete: SetNull)
  symbolRef TradingSymbol  @relation(fields: [symbolId], references: [id], onDelete: Restrict)

  events OrderEvent[]
  fills  Fill[]

  reconciliationDiscrepancies ReconciliationDiscrepancy[]
  executionIncidents          ExecutionIncident[]

  @@unique([tenantId, clientOrderId])
  @@index([tenantId, status, createdAt])
  @@index([tenantId, accountId, createdAt])
  @@index([tenantId, strategyId, createdAt])
  @@index([tenantId, symbol, createdAt])
  @@index([exchangeOrderId])
  @@index([createdAt])
  /// Drives the reconciliation sweep: find every order whose state is not
  /// trusted, oldest first. Without this the sweep is a full table scan on a
  /// table that only ever grows.
  @@index([reconciliationState, lastReconciledAt])
  @@index([tenantId, accountId, reconciliationState])
  @@map("orders")
}

model OrderEvent {
  id      String @id @default(uuid()) @db.Uuid
  orderId String @map("order_id") @db.Uuid

  previousStatus OrderStatusEnum? @map("previous_status")
  status         OrderStatusEnum

  reason String? @db.VarChar(500)

  /// Structured context. Never contains credentials or venue signatures.
  payload Json @default("{}")

  /// Microsecond wall-clock time the event occurred, preserving sub-millisecond
  /// ordering that a Timestamptz(6) round trip would blur.
  occurredAtMicros BigInt @map("occurred_at_micros")

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  order Order @relation(fields: [orderId], references: [id], onDelete: Cascade)

  @@index([orderId, occurredAtMicros])
  @@index([createdAt])
  @@map("order_events")
}

model Fill {
  id      String @id @default(uuid()) @db.Uuid
  orderId String @map("order_id") @db.Uuid

  /// Venue's execution id. Unique per order; the guard against double-counting
  /// a replayed user-data message.
  venueTradeId String @map("venue_trade_id") @db.VarChar(64)

  price       Decimal @db.Decimal(28, 12)
  quantity    Decimal @db.Decimal(28, 12)
  fee         Decimal @default(0) @db.Decimal(28, 12)
  feeCurrency String  @default("USDT") @map("fee_currency") @db.VarChar(16)

  isMaker     Boolean @default(false) @map("is_maker")
  /// Always true for paper fills. Never mutated after insert.
  isSimulated Boolean @default(false) @map("is_simulated")

  exchangeTimestampMicros BigInt @map("exchange_timestamp_micros")
  receivedTimestampMicros BigInt @map("received_timestamp_micros")

  // --- Part 5: venue attribution -----------------------------------------
  // Denormalised from the parent order on purpose. A fill arriving on the
  // private stream can be routed to the position manager without a join, and a
  // PnL query over millions of rows does not need one either.
  symbol String?        @db.VarChar(32)
  side   OrderSideEnum?
  venue  TradingVenue?

  /// Quote-asset amount as the venue computed it. Kept rather than recomputed:
  /// the venue's rounding is authoritative for settlement, and price * quantity
  /// can disagree in the last decimal place.
  quoteQuantity Decimal? @map("quote_quantity") @db.Decimal(28, 12)

  /// The venue's order id, when the execution report carries it. Lets a fill
  /// that arrives before the submit response is processed still be matched.
  exchangeOrderId String? @map("exchange_order_id") @db.VarChar(64)

  /// Which route delivered this fill. The same execution legitimately arrives
  /// twice - once on the stream, once from reconciliation - and the unique
  /// constraint above deduplicates it. Recording the source is what lets an
  /// operator tell "the stream is healthy" from "reconciliation is carrying us".
  source FillSource @default(PRIVATE_STREAM)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  order Order @relation(fields: [orderId], references: [id], onDelete: Cascade)

  @@unique([orderId, venueTradeId])
  @@index([orderId, receivedTimestampMicros])
  @@index([createdAt])
  @@index([exchangeOrderId])
  @@index([symbol, receivedTimestampMicros])
  @@map("fills")
}

// -----------------------------------------------------------------------------
// Position - derived from fills, never from a venue snapshot
// -----------------------------------------------------------------------------

model Position {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  accountId String @map("account_id") @db.Uuid
  symbolId  String @map("symbol_id") @db.Uuid

  venue  TradingVenue
  symbol String       @db.VarChar(32)

  /// Signed: positive long, negative short, zero flat.
  quantity Decimal          @default(0) @db.Decimal(28, 12)
  side     PositionSideEnum @default(FLAT)

  averageEntryPrice Decimal? @map("average_entry_price") @db.Decimal(28, 12)
  markPrice         Decimal? @map("mark_price") @db.Decimal(28, 12)

  realisedPnl   Decimal  @default(0) @map("realised_pnl") @db.Decimal(18, 6)
  /// Snapshot at last mark. Null when no mark price was available - never
  /// defaulted to zero, which would misreport a position as break-even.
  unrealisedPnl Decimal? @map("unrealised_pnl") @db.Decimal(18, 6)
  cumulativeFee Decimal  @default(0) @map("cumulative_fee") @db.Decimal(18, 6)
  feeCurrency   String?  @map("fee_currency") @db.VarChar(16)

  /// True if ANY contributing fill was simulated. Sticky once set.
  containsSimulatedFills Boolean @default(false) @map("contains_simulated_fills")

  fillCount Int @default(0) @map("fill_count")

  openedAt   DateTime? @map("opened_at") @db.Timestamptz(6)
  closedAt   DateTime? @map("closed_at") @db.Timestamptz(6)
  lastFillAt DateTime? @map("last_fill_at") @db.Timestamptz(6)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant    Tenant         @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  account   TradingAccount @relation(fields: [accountId], references: [id], onDelete: Cascade)
  symbolRef TradingSymbol  @relation(fields: [symbolId], references: [id], onDelete: Restrict)

  @@unique([accountId, symbolId])
  @@index([tenantId, accountId])
  @@index([tenantId, symbol])
  @@index([tenantId, side])
  @@map("positions")
}

// -----------------------------------------------------------------------------
// RiskConfiguration - per-account limits
// -----------------------------------------------------------------------------
// One row per trading account. Platform limits come from environment
// configuration and strategy limits from the Strategy row; this is the middle
// layer. The effective limit is the tightest of the three.
// -----------------------------------------------------------------------------

model RiskConfiguration {
  id        String @id @default(uuid()) @db.Uuid
  tenantId  String @map("tenant_id") @db.Uuid
  accountId String @unique @map("account_id") @db.Uuid

  maxOrderQuantity    Decimal @map("max_order_quantity") @db.Decimal(28, 12)
  maxOrderNotional    Decimal @map("max_order_notional") @db.Decimal(18, 6)
  maxPositionQuantity Decimal @map("max_position_quantity") @db.Decimal(28, 12)

  maxSymbolExposureNotional  Decimal @map("max_symbol_exposure_notional") @db.Decimal(18, 6)
  maxAccountExposureNotional Decimal @map("max_account_exposure_notional") @db.Decimal(18, 6)

  maxOpenOrders      Int @default(10) @map("max_open_orders")
  maxOrdersPerMinute Int @default(60) @map("max_orders_per_minute")

  maxDailyLoss    Decimal @map("max_daily_loss") @db.Decimal(18, 6)
  maxStrategyLoss Decimal @map("max_strategy_loss") @db.Decimal(18, 6)

  maxPriceDeviationPercent Decimal @default(2) @map("max_price_deviation_percent") @db.Decimal(8, 4)
  /// Market data older than this may not be used to price an order.
  maxMarketDataAgeMicros   Int     @default(5000000) @map("max_market_data_age_micros")

  /// Account-level halt. Independent of the four kill-switch scopes.
  tradingHalted Boolean   @default(true) @map("trading_halted")
  haltedReason  String?   @map("halted_reason") @db.VarChar(500)
  haltedAt      DateTime? @map("halted_at") @db.Timestamptz(6)

  // ---------------------------------------------------------------------
  // Part 8: the extended risk configuration.
  //
  // The scalars above remain the *effective* view the Part 2 core engine and
  // older consumers read. The Part 8 document is `policyJson`: the full
  // hierarchical entry set (GLOBAL..SYMBOL with priorities, units,
  // effective windows) as emitted by ``wlct_trading.risk.configuration``.
  // The two are kept in sync by the API's risk service - a config write
  // derives the scalars from the resolved view of the document, so a stale
  // scalar can never be *wider* than the document it shadows, and the
  // worker binds to `digest` rather than to either copy.
  //
  // `version` increments with every accepted mutation; `digest` is the
  // content hash the engine's snapshot binding check compares. They answer
  // different questions ("which revision is this" vs "does the payload
  // match what it claims") and neither substitutes for the other.
  // ---------------------------------------------------------------------
  version        Int     @default(1) @map("config_version")
  digest         String? @map("config_digest") @db.VarChar(64)
  policyJson     Json?   @map("policy_json")
  protectionJson Json?   @map("protection_json")

  /// Definition of the daily-loss rule, stored as booleans rather than
  /// buried in JSON so the effective policy is visible in a plain SELECT.
  dailyLossIncludesUnrealized Boolean @default(false) @map("daily_loss_includes_unrealized")
  allowRiskReducingOrders     Boolean @default(true) @map("allow_risk_reducing_orders")

  updatedByUserId String? @map("updated_by_user_id") @db.Uuid

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant  Tenant         @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  account TradingAccount @relation(fields: [accountId], references: [id], onDelete: Cascade)

  @@index([tenantId])
  @@map("risk_configurations")
}

// -----------------------------------------------------------------------------
// RiskEvent - the audit trail of every refusal
// -----------------------------------------------------------------------------
// Written for every rejection, breach and kill-switch action. This is the table
// an operator reads after an incident, so it records the limit, the observed
// value and the decision id that links back to the order.
// -----------------------------------------------------------------------------

model RiskEvent {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  accountId  String? @map("account_id") @db.Uuid
  strategyId String? @map("strategy_id") @db.Uuid
  orderId    String? @map("order_id") @db.Uuid

  eventType RiskEventType     @map("event_type")
  severity  RiskEventSeverity @default(WARNING)

  /// RiskDecisionCode from the engine, e.g. MAX_ORDER_SIZE_EXCEEDED.
  code    String @db.VarChar(64)
  message String @db.VarChar(1000)

  /// Stringified so the exact decimal is preserved for the audit record.
  limitValue    String? @map("limit_value") @db.VarChar(64)
  observedValue String? @map("observed_value") @db.VarChar(64)

  venue  TradingVenue?
  symbol String?       @db.VarChar(32)

  riskDecisionId String? @map("risk_decision_id") @db.Uuid
  correlationId  String? @map("correlation_id") @db.Uuid

  // Part 8: the structured rule trail. `ruleId` names the catalogued rule
  // (RiskRuleId), `scope`/`scopeTarget` say which hierarchy level governed,
  // `action` records what protection (if any) the breach proposed or
  // applied, `source` is the emitting component, and `snapshotVersion`
  // binds the event to the exact state the decision was taken from.
  // `dedupeKey` is the engine's content hash of the *condition* (not the
  // observed value): the partial unique index below makes repeated
  // identical breaches idempotent writes while distinct conditions never
  // collide.
  ruleId          String? @map("rule_id") @db.VarChar(64)
  scope           String? @db.VarChar(24)
  scopeTarget     String? @map("scope_target") @db.VarChar(64)
  action          String? @db.VarChar(32)
  source          String? @db.VarChar(64)
  snapshotVersion BigInt? @map("snapshot_version")
  isSimulated     Boolean @default(false) @map("is_simulated")
  dedupeKey       String? @map("dedupe_key") @db.VarChar(64)

  metadata Json @default("{}")

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  tenant   Tenant    @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  strategy Strategy? @relation(fields: [strategyId], references: [id], onDelete: SetNull)

  @@unique([tenantId, dedupeKey])
  @@index([tenantId, createdAt])
  @@index([tenantId, eventType, createdAt])
  @@index([tenantId, severity, createdAt])
  @@index([tenantId, accountId, createdAt])
  @@index([orderId])
  @@map("risk_events")
}

// -----------------------------------------------------------------------------
// KillSwitch - durable record of the four halt scopes
// -----------------------------------------------------------------------------
// The live switch is read from Redis on the hot path; this table is the durable
// mirror so a Redis flush cannot silently re-enable trading, and so every
// engage/release is attributable to a person.
// -----------------------------------------------------------------------------

model KillSwitch {
  id       String  @id @default(uuid()) @db.Uuid
  /// Null for the platform-wide GLOBAL switch.
  tenantId String? @map("tenant_id") @db.Uuid

  scope  KillSwitchScopeEnum
  /// Venue, strategy id or symbol. Null only for GLOBAL.
  target String?             @db.VarChar(64)

  isEngaged Boolean @default(false) @map("is_engaged")
  reason    String? @db.VarChar(500)

  engagedByUserId  String?   @map("engaged_by_user_id") @db.Uuid
  engagedAt        DateTime? @map("engaged_at") @db.Timestamptz(6)
  releasedByUserId String?   @map("released_by_user_id") @db.Uuid
  releasedAt       DateTime? @map("released_at") @db.Timestamptz(6)

  // Part 8: lifecycle alongside the boolean, never replacing it. The
  // engine's hot path reads Redis; this table remains the durable mirror
  // (a Redis flush cannot silently re-enable trading, per the Part 5 rule),
  // and `status` carries the trigger/acknowledge/clear history the boolean
  // cannot express. `isEngaged` stays true for ACTIVE, TRIGGERED *and*
  // ACKNOWLEDGED - the three blocking states - so every pre-Part 8 reader
  // keeps the exact same semantics.
  status                RiskSwitchStatus   @default(INACTIVE)
  triggeredByRule       String?            @map("triggered_by_rule") @db.VarChar(64)
  triggeredAt           DateTime?          @map("triggered_at") @db.Timestamptz(6)
  severity              RiskEventSeverity? @map("trigger_severity")
  requiresExplicitClear Boolean            @default(false) @map("requires_explicit_clear")
  acknowledgedByUserId  String?            @map("acknowledged_by_user_id") @db.Uuid
  acknowledgedAt        DateTime?          @map("acknowledged_at") @db.Timestamptz(6)
  acknowledgementReason String?            @map("acknowledgement_reason") @db.VarChar(500)
  clearedByUserId       String?            @map("cleared_by_user_id") @db.Uuid
  clearedAt             DateTime?          @map("cleared_at") @db.Timestamptz(6)
  clearedReason         String?            @map("cleared_reason") @db.VarChar(500)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant Tenant? @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@index([tenantId, scope, isEngaged])
  @@index([scope, isEngaged])
  @@map("kill_switches")
}

// -----------------------------------------------------------------------------
// TradingSession - one run of the engine
// -----------------------------------------------------------------------------

model TradingSession {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  accountId  String? @map("account_id") @db.Uuid
  strategyId String? @map("strategy_id") @db.Uuid

  status      TradingSessionStatus @default(STARTING)
  /// Resolved mode for this run, recorded so a historical session can be read
  /// back with certainty about whether its fills were real.
  tradingMode TradingModeSetting   @map("trading_mode")

  /// Hostname or pod name of the worker that owns the session.
  workerId String @map("worker_id") @db.VarChar(128)

  startedAt   DateTime  @default(now()) @map("started_at") @db.Timestamptz(6)
  endedAt     DateTime? @map("ended_at") @db.Timestamptz(6)
  heartbeatAt DateTime  @default(now()) @map("heartbeat_at") @db.Timestamptz(6)

  // --- observability counters -------------------------------------------
  signalsGenerated Int @default(0) @map("signals_generated")
  ordersRequested  Int @default(0) @map("orders_requested")
  ordersSubmitted  Int @default(0) @map("orders_submitted")
  ordersFilled     Int @default(0) @map("orders_filled")
  ordersRejected   Int @default(0) @map("orders_rejected")
  riskRejections   Int @default(0) @map("risk_rejections")
  bookResyncs      Int @default(0) @map("book_resyncs")

  /// Measured percentiles over the session, in microseconds. Observed values
  /// only; the platform makes no latency guarantee.
  medianDecisionLatencyMicros Int? @map("median_decision_latency_micros")
  p99DecisionLatencyMicros    Int? @map("p99_decision_latency_micros")

  stopReason String? @map("stop_reason") @db.VarChar(500)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant   Tenant          @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  account  TradingAccount? @relation(fields: [accountId], references: [id], onDelete: SetNull)
  strategy Strategy?       @relation(fields: [strategyId], references: [id], onDelete: SetNull)

  @@index([tenantId, status, startedAt])
  @@index([tenantId, strategyId, startedAt])
  @@index([heartbeatAt])
  @@map("trading_sessions")
}

// -----------------------------------------------------------------------------
// MarketDataRecord - OHLCV candles only
// -----------------------------------------------------------------------------
// Deliberately NOT a tick store. Individual quotes and trades arrive at
// thousands per second per symbol; persisting them would saturate write
// throughput and produce a table nobody can query usefully. Candles are the
// aggregation that is actually used for charting and post-trade analysis.
//
// Not tenant-scoped: a BTC-USDT candle is the same fact for every tenant, and
// duplicating it per tenant would multiply storage for no isolation benefit.
// Access is mediated by the API, which checks the caller's tenant is
// subscribed to the symbol.
// -----------------------------------------------------------------------------

model MarketDataRecord {
  id       String @id @default(uuid()) @db.Uuid
  symbolId String @map("symbol_id") @db.Uuid

  venue    TradingVenue
  symbol   String       @db.VarChar(32)
  /// "1m", "5m", "1h", "1d".
  interval String       @db.VarChar(8)

  openTime  DateTime @map("open_time") @db.Timestamptz(6)
  closeTime DateTime @map("close_time") @db.Timestamptz(6)

  open   Decimal @db.Decimal(28, 12)
  high   Decimal @db.Decimal(28, 12)
  low    Decimal @db.Decimal(28, 12)
  close  Decimal @db.Decimal(28, 12)
  volume Decimal @db.Decimal(28, 12)

  quoteVolume Decimal? @map("quote_volume") @db.Decimal(28, 12)
  tradeCount  Int      @default(0) @map("trade_count")

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  symbolRef TradingSymbol @relation(fields: [symbolId], references: [id], onDelete: Cascade)

  @@unique([symbolId, interval, openTime])
  @@index([venue, symbol, interval, openTime])
  @@index([openTime])
  @@map("market_data_records")
}

// =============================================================================
// PART 5 - AUTHENTICATED EXECUTION
// =============================================================================
// Everything below records what happened on the money path: where a credential
// lives (never the credential itself), what the private stream did, what
// reconciliation found, and what an operator needs to look at.
//
// One rule governs the whole section: nothing here is ever updated to hide a
// disagreement. A reconciliation that finds a difference writes a discrepancy
// row; it does not quietly correct the order and move on. An audit that can be
// edited is not an audit.
// =============================================================================

/// Where an account's key material actually lives.
enum CredentialSource {
  /// Envelope-encrypted in `trading_accounts`. Correct for self-hosted and
  /// single-tenant installs; the Part 1 default.
  ENVELOPE_DB
  /// Held by Vault / AWS Secrets Manager / GCP Secret Manager / KMS. The
  /// database stores only a pointer. Correct for managed multi-tenant.
  SECRET_MANAGER
  /// Process environment. Development only - it does not scale past one tenant
  /// and cannot be rotated per customer.
  ENVIRONMENT
}

/// How much the local record of an order can be trusted.
enum OrderReconciliationState {
  IN_SYNC
  /// The submission outcome was never observed. The order may or may not exist
  /// at the venue. It must be queried by clientOrderId, never resubmitted.
  UNKNOWN
  PENDING_RECONCILIATION
  /// Reconciliation found a difference it could not repair automatically.
  DIVERGED
}

/// Which route delivered a fill.
enum FillSource {
  PRIVATE_STREAM
  /// Returned inline in the order-placement response (newOrderRespType=FULL).
  ORDER_RESPONSE
  RECONCILIATION
  /// Produced by the paper venue. Always paired with isSimulated = true.
  SIMULATOR
}

enum StreamSessionStatus {
  CONNECTING
  CONNECTED
  RECONNECTING
  DISCONNECTED
  /// The venue invalidated the listen key. A new key is required; reconnecting
  /// with the old one yields a socket that silently delivers nothing.
  KEY_EXPIRED
  FAILED
  STOPPED
}

enum ReconciliationRunStatus {
  RUNNING
  COMPLETED
  /// Another pass held the lock. Not an error.
  SKIPPED
  FAILED
}

enum ReconciliationDiscrepancyType {
  ORDER_STATUS_MISMATCH
  ORDER_MISSING_LOCALLY
  ORDER_MISSING_AT_VENUE
  MISSED_FILL
  QUANTITY_MISMATCH
  BALANCE_MISMATCH
  POSITION_MISMATCH
  UNKNOWN_ORDER_RESOLVED
  UNKNOWN_ORDER_NEVER_PLACED
}

enum ExecutionIncidentType {
  UNKNOWN_ORDER_RESULT
  ORDER_STATE_MISMATCH
  MISSING_FILL
  UNEXPECTED_ORDER
  BALANCE_MISMATCH
  POSITION_MISMATCH
  ILLEGAL_TRANSITION
  CREDENTIAL_FAILURE
  CLOCK_SKEW
  PRIVATE_STREAM_FAILURE
  RATE_LIMIT_BREACH
  RECONCILIATION_FAILURE
  SAFETY_GATE_BLOCK
}

enum ExecutionIncidentSeverity {
  INFO
  WARNING
  /// Money or position integrity is at stake. Page someone.
  CRITICAL
}

// -----------------------------------------------------------------------------
// AccountBalanceSnapshot - what the venue says the account holds
// -----------------------------------------------------------------------------
// A snapshot, not a ledger. The platform does not maintain its own running
// balance: it would inevitably drift from the venue's, and a drifting balance
// is worse than no balance because it looks authoritative.
//
// Latest-per-asset is an upsert on the unique key. History is kept in
// `AccountBalanceSnapshot` rows only for assets whose value changed, which is
// what makes the table bounded on an account holding hundreds of dust balances.
// -----------------------------------------------------------------------------

model AccountBalanceSnapshot {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  accountId String @map("account_id") @db.Uuid

  asset String @db.VarChar(24)

  /// Available to trade.
  free   Decimal @default(0) @db.Decimal(28, 12)
  /// Reserved against resting orders.
  locked Decimal @default(0) @db.Decimal(28, 12)
  /// Stored, not computed, so a historical row reads back exactly as the venue
  /// reported it even if the free/locked split is later revised.
  total  Decimal @default(0) @db.Decimal(28, 12)

  /// Venue's own update timestamp, when it supplies one.
  venueUpdatedAtMicros BigInt? @map("venue_updated_at_micros")
  observedAtMicros     BigInt  @map("observed_at_micros")

  /// True for a paper account. Carried so a simulated balance can never appear
  /// in a report alongside real ones without being marked.
  isSimulated Boolean @default(false) @map("is_simulated")

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant  Tenant         @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  account TradingAccount @relation(fields: [accountId], references: [id], onDelete: Cascade)

  @@unique([accountId, asset])
  @@index([tenantId, accountId])
  @@index([tenantId, asset])
  @@index([observedAtMicros])
  @@map("account_balance_snapshots")
}

// -----------------------------------------------------------------------------
// ExchangeStreamSession - one private user-data stream connection
// -----------------------------------------------------------------------------
// Distinct from TradingSession, which is a strategy run. This is the socket:
// when it connected, how many times it dropped, whether its listen key is still
// valid. Kept because "we have not received a fill in twenty minutes" is only
// actionable if you can tell a quiet market from a dead socket.
//
// The listen key is NEVER stored. It is a bearer credential: anyone holding it
// can read the account's entire order flow. Only the masked form is kept.
// -----------------------------------------------------------------------------

model ExchangeStreamSession {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  accountId String @map("account_id") @db.Uuid

  venue  TradingVenue
  status StreamSessionStatus @default(CONNECTING)

  /// Masked listen key, e.g. "pqia...65a1". Enough to correlate two log lines,
  /// useless to an attacker. The full key is never written anywhere.
  listenKeyMasked String? @map("listen_key_masked") @db.VarChar(32)

  listenKeyCreatedAt       DateTime? @map("listen_key_created_at") @db.Timestamptz(6)
  listenKeyRenewedAt       DateTime? @map("listen_key_renewed_at") @db.Timestamptz(6)
  listenKeyRenewals        Int       @default(0) @map("listen_key_renewals")
  listenKeyRenewalFailures Int       @default(0) @map("listen_key_renewal_failures")

  connectedAt    DateTime? @map("connected_at") @db.Timestamptz(6)
  disconnectedAt DateTime? @map("disconnected_at") @db.Timestamptz(6)
  lastEventAt    DateTime? @map("last_event_at") @db.Timestamptz(6)

  reconnectCount   Int @default(0) @map("reconnect_count")
  eventsReceived   Int @default(0) @map("events_received")
  executionReports Int @default(0) @map("execution_reports")
  parseErrors      Int @default(0) @map("parse_errors")

  /// Set after each reconnect, because Binance does not replay events missed
  /// while disconnected - so every reconnect is a correctness event.
  lastReconciledAt DateTime? @map("last_reconciled_at") @db.Timestamptz(6)

  /// Hostname or pod name of the worker holding the socket.
  workerId String @map("worker_id") @db.VarChar(128)

  /// Error class only. Never a venue response body, which could echo the URL
  /// and therefore the listen key.
  lastErrorCode String? @map("last_error_code") @db.VarChar(64)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant  Tenant         @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  account TradingAccount @relation(fields: [accountId], references: [id], onDelete: Cascade)

  @@index([tenantId, accountId, status])
  @@index([tenantId, status])
  @@index([lastEventAt])
  @@map("exchange_stream_sessions")
}

// -----------------------------------------------------------------------------
// ReconciliationRun + ReconciliationDiscrepancy
// -----------------------------------------------------------------------------
// Split into a run and its findings for the same reason Strategy and
// StrategyConfiguration are split: a run is a fact about an execution, a
// discrepancy is a fact about the world, and the second outlives the first.
//
// A run row is written even when it finds nothing, and even when it fails. "No
// reconciliation has completed for an hour" is itself an alertable condition
// and is invisible if only successful runs are recorded.
// -----------------------------------------------------------------------------

model ReconciliationRun {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  accountId String @map("account_id") @db.Uuid

  venue  TradingVenue
  status ReconciliationRunStatus @default(RUNNING)

  /// What prompted this pass: SCHEDULED, STREAM_RECONNECT, UNKNOWN_ORDER,
  /// MANUAL. A free-form column rather than an enum because the set of triggers
  /// grows with operational experience and a migration per trigger is friction
  /// for no safety gain.
  trigger String @default("SCHEDULED") @db.VarChar(32)

  startedAt      DateTime  @default(now()) @map("started_at") @db.Timestamptz(6)
  finishedAt     DateTime? @map("finished_at") @db.Timestamptz(6)
  durationMicros BigInt?   @map("duration_micros")

  ordersChecked         Int @default(0) @map("orders_checked")
  fillsRecovered        Int @default(0) @map("fills_recovered")
  discrepanciesFound    Int @default(0) @map("discrepancies_found")
  discrepanciesRepaired Int @default(0) @map("discrepancies_repaired")

  /// Error class and message. Never a credential, never a signature.
  error String? @db.VarChar(500)

  workerId String @map("worker_id") @db.VarChar(128)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  tenant  Tenant         @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  account TradingAccount @relation(fields: [accountId], references: [id], onDelete: Cascade)

  discrepancies ReconciliationDiscrepancy[]

  @@index([tenantId, accountId, startedAt])
  @@index([tenantId, status, startedAt])
  @@index([startedAt])
  @@map("reconciliation_runs")
}

model ReconciliationDiscrepancy {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  runId   String  @map("run_id") @db.Uuid
  /// Null for a discrepancy about an order this platform does not know - which
  /// is precisely the most serious kind.
  orderId String? @map("order_id") @db.Uuid

  discrepancyType ReconciliationDiscrepancyType @map("discrepancy_type")

  symbol        String? @db.VarChar(32)
  clientOrderId String? @map("client_order_id") @db.VarChar(36)

  /// What we believed and what the venue said. Strings rather than typed
  /// columns because the compared value is a status here and a quantity there,
  /// and a discrepancy record is read by a human, not summed by a query.
  localValue String? @map("local_value") @db.VarChar(120)
  venueValue String? @map("venue_value") @db.VarChar(120)

  summary String @db.VarChar(1000)

  /// Whether local state was changed to match. False for everything the
  /// service refuses to auto-correct: balances, positions, and any order the
  /// platform did not place.
  repaired Boolean @default(false)

  detectedAtMicros BigInt @map("detected_at_micros")

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  run   ReconciliationRun @relation(fields: [runId], references: [id], onDelete: Cascade)
  order Order?            @relation(fields: [orderId], references: [id], onDelete: SetNull)

  @@index([tenantId, discrepancyType, createdAt])
  @@index([runId])
  @@index([orderId])
  @@index([tenantId, repaired, createdAt])
  @@map("reconciliation_discrepancies")
}

// -----------------------------------------------------------------------------
// ExecutionIncident - the things a human needs to know about
// -----------------------------------------------------------------------------
// Deliberately rare. A risk engine declining an oversized order is the system
// working and produces nothing here. An order whose fate is unknown, a
// credential that stopped working, an order at the venue that this platform did
// not place - those produce a row.
//
// Immutable except for resolution. An incident is closed by setting
// `resolvedAt` and a note; its facts are never edited.
// -----------------------------------------------------------------------------

model ExecutionIncident {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  accountId String? @map("account_id") @db.Uuid
  orderId   String? @map("order_id") @db.Uuid

  incidentType ExecutionIncidentType     @map("incident_type")
  severity     ExecutionIncidentSeverity @default(WARNING)

  venue  TradingVenue?
  symbol String?       @db.VarChar(32)

  clientOrderId String? @map("client_order_id") @db.VarChar(36)

  /// Normalised execution error code from the platform taxonomy, e.g.
  /// RESULT_UNKNOWN, CREDENTIALS_INVALID, STATE_MISMATCH. A VarChar rather than
  /// an enum: the taxonomy is expected to grow, and a code the database has
  /// never seen must be recordable rather than rejected at insert time.
  errorCode String? @map("error_code") @db.VarChar(64)

  summary String @db.VarChar(1000)

  /// Structured context. Every value is passed through the secret scrubber
  /// before it gets here - incident payloads are the single most likely place
  /// for a credential to escape, because the instinct when writing one is to
  /// attach the whole failing request.
  details Json @default("{}")

  occurredAtMicros BigInt @map("occurred_at_micros")

  resolvedAt     DateTime? @map("resolved_at") @db.Timestamptz(6)
  resolvedBy     String?   @map("resolved_by") @db.Uuid
  resolutionNote String?   @map("resolution_note") @db.VarChar(1000)

  /// Set when an alert was actually delivered, so a repeated incident does not
  /// re-page and a missed page is visible.
  notifiedAt DateTime? @map("notified_at") @db.Timestamptz(6)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant  Tenant          @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  account TradingAccount? @relation(fields: [accountId], references: [id], onDelete: SetNull)
  order   Order?          @relation(fields: [orderId], references: [id], onDelete: SetNull)

  @@index([tenantId, severity, createdAt])
  @@index([tenantId, incidentType, createdAt])
  @@index([tenantId, accountId, createdAt])
  /// The dashboard's primary query: unresolved incidents, worst first.
  @@index([tenantId, resolvedAt, severity])
  @@index([orderId])
  @@index([createdAt])
  @@map("execution_incidents")
}

// =============================================================================
// PART 6 - STRATEGY LAYER: catalogue, runs, backtests, paper trading
// =============================================================================
// Three properties hold across everything below.
//
//   1. NOTHING HERE IS WRITTEN PER TICK. A strategy processes thousands of book
//      updates a minute; none of them reach PostgreSQL. What is stored is
//      configuration, lifecycle transitions, periodic checkpoints, completed
//      backtests, periodic paper snapshots and incidents. Hot state lives in
//      the engine's memory, and Redis is never the source of financial truth.
//
//   2. EVERY SIMULATED ROW SAYS SO. `BacktestRun`, `BacktestTrade`,
//      `PaperTradingSession` and `PaperPortfolioSnapshot` all describe results
//      that no real account achieved. Backtest performance is not indicative of
//      future performance; paper performance is not indicative of live
//      performance; simulation does not guarantee real execution quality.
//
//   3. NO ROW HERE CAN AUTHORISE AN ORDER. Enabling a strategy makes it emit
//      signals. Whether a signal becomes an order is decided by the risk engine
//      and the Part 5 execution gates, none of which read these tables.
// =============================================================================

enum StrategyVersionStatus {
  /// Registered but not runnable. An instance cannot bind to it.
  DRAFT
  /// Runnable. Behaviour is frozen: a change requires a new version.
  PUBLISHED
  /// Still runnable for existing instances, refused for new ones.
  DEPRECATED
  /// Refused everywhere, including for running instances at next start.
  DISABLED
}

enum StrategyFailurePolicy {
  /// Stop the instance that failed. Siblings keep running.
  STOP_INSTANCE
  /// Stop every instance in the engine. For a failure that suggests the
  /// problem is not confined to one strategy.
  HALT_ALL
}

enum StrategyHealth {
  /// The engine has not reported on this instance. Not the same as unhealthy.
  UNKNOWN
  HEALTHY
  /// Running, but something is wrong: errors, slow dispatches, stale data.
  DEGRADED
  /// Running is no longer trusted.
  UNHEALTHY
  /// Taken out of service by the failure policy. Only an operator clears it.
  QUARANTINED
}

enum StrategyRunStatus {
  STARTING
  RUNNING
  /// Ended cleanly, by operator action or shutdown.
  STOPPED
  /// Ended because the instance raised.
  FAILED
  /// Ended because HALT_ALL stopped the whole engine.
  HALTED
}

enum StrategyIncidentType {
  /// The strategy raised inside a handler or in evaluate().
  STRATEGY_ERROR
  /// Feature calculation raised. The features are discarded, not guessed.
  FEATURE_ERROR
  /// An unusual volume of rejected signals: the strategy is fighting the
  /// validator, which usually means a parameter is wrong.
  SIGNAL_REJECTED_BURST
  /// Risk state was unavailable, so signals were refused. Fail-closed working
  /// as designed, and still worth a human knowing about.
  RISK_STATE_UNAVAILABLE
  /// Dispatch exceeded the observation budget repeatedly.
  PROCESSING_LATENCY_BREACH
  /// The failure policy removed the instance from service.
  INSTANCE_QUARANTINED
  /// A configuration was refused by the parameter schema.
  CONFIGURATION_REJECTED
  /// A state checkpoint could not be written or could not be restored.
  CHECKPOINT_FAILURE
}

enum BacktestRunStatus {
  QUEUED
  RUNNING
  COMPLETED
  FAILED
  CANCELLED
}

enum PaperSessionStatus {
  STARTING
  RUNNING
  STOPPED
  FAILED
}

// -----------------------------------------------------------------------------
// StrategyDefinition - the catalogue of implementations that ship with the code
// -----------------------------------------------------------------------------
// Platform-level and deliberately NOT tenant-scoped: a definition describes a
// class in `wlct_trading.strategies.implementations`, which is the same class
// for every tenant. It holds no customer data, so there is nothing to isolate.
// Tenant scoping starts at Strategy (the instance).
//
// Reserved-but-unimplemented ids live here too, flagged, so that the well-known
// names cannot be quietly taken by something that is not what an operator
// expects.
// -----------------------------------------------------------------------------

model StrategyDefinition {
  id String @id @default(uuid()) @db.Uuid

  /// Stable registry key, e.g. DETERMINISTIC_IMBALANCE_V1. Never reused for a
  /// different implementation.
  key String @unique @db.VarChar(64)

  displayName String  @map("display_name") @db.VarChar(120)
  description String  @db.VarChar(1000)
  category    String? @db.VarChar(40)

  /// False for a reserved name with no code behind it. An instance cannot bind
  /// to an unimplemented definition.
  isImplemented Boolean @default(false) @map("is_implemented")
  /// True for the four spec-reserved ids (MARKET_MAKING_V1, MOMENTUM_V1,
  /// MEAN_REVERSION_V1, MICROSTRUCTURE_V1) that exist to protect the namespace.
  isReserved    Boolean @default(false) @map("is_reserved")

  /// What this strategy does NOT claim. Rendered verbatim in the admin UI so a
  /// catalogue entry can never read like a performance promise.
  riskNotes String @default("No profitability claim is made or implied.") @map("risk_notes") @db.VarChar(1000)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  versions  StrategyVersion[]
  instances Strategy[]
  backtests BacktestRun[]

  @@index([isImplemented])
  @@map("strategy_definitions")
}

// -----------------------------------------------------------------------------
// StrategyVersion - frozen behaviour
// -----------------------------------------------------------------------------
// The point of this table is that behaviour cannot change silently under one
// version. `behaviourHash` covers the implementation id and the parameter
// schema; if either changes, the hash changes, and the platform requires a new
// version row rather than mutating this one.
// -----------------------------------------------------------------------------

model StrategyVersion {
  id           String @id @default(uuid()) @db.Uuid
  definitionId String @map("definition_id") @db.Uuid

  /// Semantic version of the implementation, e.g. "1.0.0".
  version String @db.VarChar(20)

  status StrategyVersionStatus @default(DRAFT)

  /// Module-qualified class path, e.g.
  /// wlct_trading.strategies.implementations.deterministic_example:DeterministicImbalanceStrategy
  implementationId String @map("implementation_id") @db.VarChar(200)

  /// Declared parameter schema: name, type, bounds, default. Used to validate
  /// every configuration before it is written. Credential-shaped parameter
  /// names are refused by the engine, so a schema can never ask for a secret.
  parameterSchema   Json @default("{}") @map("parameter_schema")
  defaultParameters Json @default("{}") @map("default_parameters")

  /// sha256 over implementationId + canonical parameter schema.
  behaviourHash String @map("behaviour_hash") @db.VarChar(64)

  changeNote String? @map("change_note") @db.VarChar(1000)

  publishedAt  DateTime? @map("published_at") @db.Timestamptz(6)
  deprecatedAt DateTime? @map("deprecated_at") @db.Timestamptz(6)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  definition StrategyDefinition @relation(fields: [definitionId], references: [id], onDelete: Cascade)

  instances      Strategy[]
  configurations StrategyConfiguration[]
  backtests      BacktestRun[]

  @@unique([definitionId, version])
  @@index([definitionId, status])
  @@map("strategy_versions")
}

// -----------------------------------------------------------------------------
// StrategyRun - one continuous period of an instance being alive
// -----------------------------------------------------------------------------
// Written on transition only: start, stop, failure. The counters are a snapshot
// taken when the run ends (or at checkpoint time), not a running total updated
// per event - that would be a write per tick by another name.
// -----------------------------------------------------------------------------

model StrategyRun {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  strategyId String @map("strategy_id") @db.Uuid

  /// PAPER or LIVE. A backtest is not a run: it has its own table, because a
  /// backtest has a dataset and a window and a run does not.
  runMode TradingModeSetting @default(PAPER) @map("run_mode")

  status StrategyRunStatus @default(STARTING)

  /// Copied from the instance at start, so a historical run stays readable
  /// after the instance is reconfigured.
  instanceKey     String @map("instance_key") @db.VarChar(32)
  configVersion   Int    @map("config_version")
  strategyKey     String @map("strategy_key") @db.VarChar(64)
  strategyVersion String @map("strategy_version") @db.VarChar(20)

  venue      TradingVenue
  symbols    String[]
  marketType TradingMarketType @default(SPOT) @map("market_type")

  startedAt DateTime  @default(now()) @map("started_at") @db.Timestamptz(6)
  stoppedAt DateTime? @map("stopped_at") @db.Timestamptz(6)

  /// Free-text reason for a clean stop, e.g. "operator disabled".
  stopReason String? @map("stop_reason") @db.VarChar(500)
  /// Exception class name only. Never a message, which could carry data.
  errorCode  String? @map("error_code") @db.VarChar(64)

  /// End-of-run counters: events processed, signals generated / accepted /
  /// rejected / deduplicated, strategy errors, feature errors, risk
  /// rejections, slow dispatches. Stored as JSON because the counter set grows
  /// with the engine and a column per counter would mean a migration each time.
  counters Json @default("{}")

  /// Timestamp of the last market event this run processed, in microseconds.
  lastEventAtMicros BigInt? @map("last_event_at_micros")

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant   Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  strategy Strategy @relation(fields: [strategyId], references: [id], onDelete: Cascade)

  checkpoints StrategyCheckpoint[]
  incidents   StrategyIncident[]

  @@index([tenantId, strategyId, startedAt])
  @@index([tenantId, status, startedAt])
  @@index([strategyId, status])
  @@index([startedAt])
  @@map("strategy_runs")
}

// -----------------------------------------------------------------------------
// StrategyCheckpoint - periodic, resumable instance state
// -----------------------------------------------------------------------------
// On a schedule and on clean stop. Never per tick.
//
// A checkpoint is what allows an instance to resume after a restart instead of
// silently starting from a blank rolling window while behaving as though it had
// history. `stateHash` makes a corrupted or partially written checkpoint
// detectable: restore verifies it and refuses rather than resuming from
// nonsense.
// -----------------------------------------------------------------------------

model StrategyCheckpoint {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  strategyId String  @map("strategy_id") @db.Uuid
  runId      String? @map("run_id") @db.Uuid

  /// Monotonically increasing per strategy.
  sequence Int

  instanceKey String @map("instance_key") @db.VarChar(32)

  /// Serialised instance state as produced by the engine's snapshot(). Feature
  /// windows, cooldown state, the signal counter. No credential can appear
  /// here: the context that produces it has no field for one.
  state Json @default("{}")

  /// sha256 over the canonical encoding of `state`.
  stateHash String @map("state_hash") @db.VarChar(64)

  capturedAtMicros BigInt @map("captured_at_micros")

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  tenant   Tenant       @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  strategy Strategy     @relation(fields: [strategyId], references: [id], onDelete: Cascade)
  run      StrategyRun? @relation(fields: [runId], references: [id], onDelete: SetNull)

  @@unique([strategyId, sequence])
  @@index([tenantId, strategyId, capturedAtMicros])
  @@index([runId])
  @@map("strategy_checkpoints")
}

// -----------------------------------------------------------------------------
// StrategyIncident - what a human needs to know about the strategy layer
// -----------------------------------------------------------------------------
// Same discipline as ExecutionIncident, and the same severity enum rather than
// a parallel one: a WARNING means the same thing in both places, and two
// enums with identical members is duplication waiting to drift.
//
// Rare by design. A validator rejecting one stale signal is the system working
// and produces nothing here.
// -----------------------------------------------------------------------------

model StrategyIncident {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  strategyId String? @map("strategy_id") @db.Uuid
  runId      String? @map("run_id") @db.Uuid

  incidentType StrategyIncidentType      @map("incident_type")
  severity     ExecutionIncidentSeverity @default(WARNING)

  venue  TradingVenue?
  symbol String?       @db.VarChar(32)

  /// Normalised code, e.g. STRATEGY_ERROR, SIGNAL_STALE, VALIDATION_STATE_
  /// UNAVAILABLE. VarChar rather than an enum: the taxonomy grows, and a code
  /// the database has not seen must be recordable rather than rejected.
  errorCode String? @map("error_code") @db.VarChar(64)

  summary String @db.VarChar(1000)

  /// Structured context, scrubbed before it arrives. Feature values and
  /// parameters may appear; a credential cannot, because no strategy object
  /// holds one.
  details Json @default("{}")

  occurredAtMicros BigInt @map("occurred_at_micros")

  resolvedAt     DateTime? @map("resolved_at") @db.Timestamptz(6)
  resolvedBy     String?   @map("resolved_by") @db.Uuid
  resolutionNote String?   @map("resolution_note") @db.VarChar(1000)

  notifiedAt DateTime? @map("notified_at") @db.Timestamptz(6)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant   Tenant       @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  strategy Strategy?    @relation(fields: [strategyId], references: [id], onDelete: SetNull)
  run      StrategyRun? @relation(fields: [runId], references: [id], onDelete: SetNull)

  @@index([tenantId, severity, createdAt])
  @@index([tenantId, incidentType, createdAt])
  @@index([tenantId, strategyId, createdAt])
  /// The dashboard's primary query: unresolved incidents, worst first.
  @@index([tenantId, resolvedAt, severity])
  @@index([runId])
  @@map("strategy_incidents")
}

// -----------------------------------------------------------------------------
// BacktestRun - a completed simulation over stored data
// -----------------------------------------------------------------------------
// SIMULATED. Every figure in this table was produced by a model that ignores
// queue position, market impact, venue rejections and latency variance, and is
// therefore systematically optimistic.
//
// BACKTEST PERFORMANCE IS NOT INDICATIVE OF FUTURE PERFORMANCE.
//
// Two columns make a result reproducible rather than merely plausible:
// `configurationHash` (strategy, version, implementation id, parameters,
// execution assumptions, dataset identity and initial capital) and the dataset
// identity columns including `datasetChecksum`. Re-running with the same hash
// against the same checksum must produce the same `runIdentifier`. It hashes no
// secret: none of its inputs can contain one.
// -----------------------------------------------------------------------------

model BacktestRun {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  /// Who asked for it. Null for a scheduled or system-initiated run.
  requestedByUserId String? @map("requested_by_user_id") @db.Uuid

  /// The instance this was run for, when it was run for one. A backtest can
  /// also be run against a definition alone, before any instance exists.
  strategyId   String? @map("strategy_id") @db.Uuid
  definitionId String? @map("definition_id") @db.Uuid
  versionId    String? @map("version_id") @db.Uuid

  /// Denormalised so a historical result stays readable after the catalogue
  /// changes underneath it.
  strategyKey      String @map("strategy_key") @db.VarChar(64)
  strategyVersion  String @map("strategy_version") @db.VarChar(20)
  implementationId String @map("implementation_id") @db.VarChar(200)

  status BacktestRunStatus @default(QUEUED)

  venue      TradingVenue
  symbol     String            @db.VarChar(32)
  marketType TradingMarketType @default(SPOT) @map("market_type")

  // --- dataset identity ----------------------------------------------------
  datasetId         String  @map("dataset_id") @db.VarChar(120)
  datasetSource     String  @map("dataset_source") @db.VarChar(120)
  datasetChecksum   String? @map("dataset_checksum") @db.VarChar(64)
  granularity       String? @db.VarChar(20)
  windowStartMicros BigInt  @map("window_start_micros")
  windowEndMicros   BigInt  @map("window_end_micros")
  eventCount        Int     @default(0) @map("event_count")

  /// Part 7: the exact registered dataset VERSION this run replays. Nullable
  /// for back-compatibility with Part 6 runs, but a deployment with
  /// BACKTEST_DATASET_REQUIRED=true (the default) refuses submissions that
  /// leave it null. This is the column that ends "latest mutable data": the
  /// run points at an immutable version row, and the version row points at
  /// the content checksum the worker verified.
  datasetVersionId String? @map("dataset_version_id") @db.Uuid

  /// The walk-forward window this run belongs to, when it is part of a split:
  /// TRAINING, VALIDATION or TEST. Null for a plain single-window run.
  walkForwardSegment String? @map("walk_forward_segment") @db.VarChar(20)

  // --- assumptions ---------------------------------------------------------
  initialCapital Decimal @map("initial_capital") @db.Decimal(18, 6)
  makerFeeRate   Decimal @map("maker_fee_rate") @db.Decimal(9, 6)
  takerFeeRate   Decimal @map("taker_fee_rate") @db.Decimal(9, 6)
  slippageBps    Decimal @map("slippage_bps") @db.Decimal(9, 4)
  latencyMicros  BigInt  @default(0) @map("latency_micros")

  /// Parameters exactly as validated and used. Never a credential.
  parameters  Json @default("{}")
  /// The full assumption set as recorded by the engine, including the ones
  /// with no column of their own (minimum fill quantity, partial fill policy).
  assumptions Json @default("{}")

  // --- results (null until COMPLETED) --------------------------------------
  finalEquity  Decimal? @map("final_equity") @db.Decimal(18, 6)
  netPnl       Decimal? @map("net_pnl") @db.Decimal(18, 6)
  grossProfit  Decimal? @map("gross_profit") @db.Decimal(18, 6)
  grossLoss    Decimal? @map("gross_loss") @db.Decimal(18, 6)
  feesPaid     Decimal? @map("fees_paid") @db.Decimal(18, 6)
  slippageCost Decimal? @map("slippage_cost") @db.Decimal(18, 6)

  totalReturnPercent Decimal? @map("total_return_percent") @db.Decimal(12, 6)
  maxDrawdown        Decimal? @map("max_drawdown") @db.Decimal(18, 6)
  maxDrawdownPercent Decimal? @map("max_drawdown_percent") @db.Decimal(12, 6)

  totalTrades   Int @default(0) @map("total_trades")
  winningTrades Int @default(0) @map("winning_trades")
  losingTrades  Int @default(0) @map("losing_trades")

  /// Null rather than zero when there were no trades. A strategy that never
  /// traded does not have a 0% win rate, and storing one would be a lie a
  /// dashboard would happily repeat.
  winRate      Decimal? @map("win_rate") @db.Decimal(9, 6)
  averageTrade Decimal? @map("average_trade") @db.Decimal(18, 6)
  largestWin   Decimal? @map("largest_win") @db.Decimal(18, 6)
  largestLoss  Decimal? @map("largest_loss") @db.Decimal(18, 6)
  profitFactor Decimal? @map("profit_factor") @db.Decimal(18, 8)

  /// Risk-adjusted figures, withheld (null) below the engine's minimum
  /// observation count and on zero dispersion.
  sharpeRatio  Decimal? @map("sharpe_ratio") @db.Decimal(18, 8)
  sortinoRatio Decimal? @map("sortino_ratio") @db.Decimal(18, 8)

  /// False when the run had too few observations for the risk-adjusted
  /// figures to mean anything. Stored explicitly so a consumer cannot mistake
  /// a null for "not calculated yet".
  hasSufficientObservations Boolean @default(false) @map("has_sufficient_observations")

  exposurePercent Decimal? @map("exposure_percent") @db.Decimal(9, 6)
  turnover        Decimal? @map("turnover") @db.Decimal(18, 6)

  // --- identity ------------------------------------------------------------
  /// Engine-assigned deterministic run id, "bt-" + 24 hex.
  runIdentifier     String @map("run_identifier") @db.VarChar(32)
  /// sha256 over strategy, version, implementation id, parameters, assumptions,
  /// dataset identity and initial capital. Hashes no secret.
  configurationHash String @map("configuration_hash") @db.VarChar(64)
  engineVersion     String @map("engine_version") @db.VarChar(20)

  /// False when the dataset carried no checksum, which means this result
  /// cannot be proven to have come from that data.
  isReproducible Boolean @default(false) @map("is_reproducible")

  /// Always true. A column rather than an assumption, so that a consumer
  /// reading a row in isolation cannot mistake it for a live result.
  isSimulated Boolean @default(true) @map("is_simulated")

  jobId String? @map("job_id") @db.VarChar(64)

  queuedAt    DateTime  @default(now()) @map("queued_at") @db.Timestamptz(6)
  startedAt   DateTime? @map("started_at") @db.Timestamptz(6)
  completedAt DateTime? @map("completed_at") @db.Timestamptz(6)
  durationMs  Int?      @map("duration_ms")

  errorCode    String? @map("error_code") @db.VarChar(64)
  errorSummary String? @map("error_summary") @db.VarChar(1000)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant     Tenant              @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  strategy   Strategy?           @relation(fields: [strategyId], references: [id], onDelete: SetNull)
  definition StrategyDefinition? @relation(fields: [definitionId], references: [id], onDelete: SetNull)
  version    StrategyVersion?    @relation(fields: [versionId], references: [id], onDelete: SetNull)

  historicalVersion HistoricalDatasetVersion? @relation(fields: [datasetVersionId], references: [id], onDelete: SetNull)

  metrics BacktestMetric[]
  trades  BacktestTrade[]

  /// The engine's run id is deterministic, so the same inputs re-submitted
  /// inside one tenant collide here rather than producing a second row that
  /// claims to be a different result.
  @@unique([tenantId, runIdentifier])
  @@index([tenantId, status, queuedAt])
  @@index([tenantId, strategyId, queuedAt])
  @@index([tenantId, configurationHash])
  @@index([tenantId, symbol, queuedAt])
  @@index([definitionId])
  @@index([versionId])
  @@index([queuedAt])
  @@index([datasetVersionId])
  @@map("backtest_runs")
}

// -----------------------------------------------------------------------------
// BacktestMetric - one named figure, with its own honesty flag
// -----------------------------------------------------------------------------
// The headline numbers have columns on BacktestRun. This table exists for the
// long tail, and for one property the columns cannot express: every metric
// carries `observationCount` and `isSufficient`, so a consumer can tell the
// difference between "0.0" and "not enough data to say".
// -----------------------------------------------------------------------------

model BacktestMetric {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  backtestRunId String @map("backtest_run_id") @db.Uuid

  name  String   @db.VarChar(64)
  /// Null when the metric could not be computed meaningfully. Never coerced
  /// to zero.
  value Decimal? @db.Decimal(28, 12)
  unit  String   @default("RATIO") @db.VarChar(16)

  observationCount Int     @default(0) @map("observation_count")
  isSufficient     Boolean @default(false) @map("is_sufficient")

  /// Why a value is absent, when it is, e.g. "fewer than 20 return
  /// observations" or "zero dispersion".
  note String? @db.VarChar(500)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  tenant Tenant      @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  run    BacktestRun @relation(fields: [backtestRunId], references: [id], onDelete: Cascade)

  @@unique([backtestRunId, name])
  @@index([tenantId, name])
  @@map("backtest_metrics")
}

// -----------------------------------------------------------------------------
// BacktestTrade - one simulated round trip
// -----------------------------------------------------------------------------
// SIMULATED. These fills were never sent anywhere.
//
// `isWin` is net of fees: a trade profitable before costs and unprofitable
// after is a loss. A round trip that realised exactly zero is still recorded,
// because it still paid fees, and omitting it would quietly improve the win
// rate of every strategy in the platform.
// -----------------------------------------------------------------------------

model BacktestTrade {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  backtestRunId String @map("backtest_run_id") @db.Uuid

  /// Position in the run, from 1. Deterministic.
  sequence Int

  symbol    String           @db.VarChar(32)
  direction PositionSideEnum

  quantity   Decimal @db.Decimal(28, 12)
  entryPrice Decimal @map("entry_price") @db.Decimal(28, 12)
  exitPrice  Decimal @map("exit_price") @db.Decimal(28, 12)

  grossPnl Decimal @map("gross_pnl") @db.Decimal(18, 6)
  fees     Decimal @default(0) @db.Decimal(18, 6)
  netPnl   Decimal @map("net_pnl") @db.Decimal(18, 6)

  /// Net of fees. See the note above.
  isWin Boolean @map("is_win")

  openedAtMicros BigInt @map("opened_at_micros")
  closedAtMicros BigInt @map("closed_at_micros")
  holdingMicros  BigInt @map("holding_micros")

  /// Always true.
  isSimulated Boolean @default(true) @map("is_simulated")

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  tenant Tenant      @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  run    BacktestRun @relation(fields: [backtestRunId], references: [id], onDelete: Cascade)

  @@unique([backtestRunId, sequence])
  @@index([tenantId, backtestRunId])
  @@index([backtestRunId, closedAtMicros])
  @@map("backtest_trades")
}

// -----------------------------------------------------------------------------
// PaperTradingSession - a strategy against the real feed, with simulated fills
// -----------------------------------------------------------------------------
// SIMULATED. The prices are real, the decisions are real, the fills are not.
//
// PAPER PERFORMANCE IS NOT INDICATIVE OF LIVE PERFORMANCE. The simulator fills
// at the observed top of book without queue position or market impact, so it
// systematically flatters any strategy that would in reality have waited, been
// partially filled, or moved the price.
//
// A session cannot reach a live adapter: the session object refuses to be
// constructed with one. That is enforced in the engine, not here - this table
// only records what happened.
// -----------------------------------------------------------------------------

model PaperTradingSession {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  strategyId        String? @map("strategy_id") @db.Uuid
  requestedByUserId String? @map("requested_by_user_id") @db.Uuid

  /// Engine-assigned session id, unique inside the tenant.
  sessionIdentifier String @map("session_identifier") @db.VarChar(64)

  status PaperSessionStatus @default(STARTING)

  strategyKey     String @map("strategy_key") @db.VarChar(64)
  strategyVersion String @map("strategy_version") @db.VarChar(20)

  venue      TradingVenue
  symbol     String            @db.VarChar(32)
  marketType TradingMarketType @default(SPOT) @map("market_type")

  initialCapital Decimal  @map("initial_capital") @db.Decimal(18, 6)
  currentEquity  Decimal? @map("current_equity") @db.Decimal(18, 6)
  realisedPnl    Decimal  @default(0) @map("realised_pnl") @db.Decimal(18, 6)
  /// Null when flat or unmarked. Never coerced to zero.
  unrealisedPnl  Decimal? @map("unrealised_pnl") @db.Decimal(18, 6)
  feesPaid       Decimal  @default(0) @map("fees_paid") @db.Decimal(18, 6)
  maxDrawdown    Decimal? @map("max_drawdown") @db.Decimal(18, 6)

  signalsGenerated Int @default(0) @map("signals_generated")
  signalsAccepted  Int @default(0) @map("signals_accepted")
  signalsRejected  Int @default(0) @map("signals_rejected")
  riskRejections   Int @default(0) @map("risk_rejections")
  simulatedOrders  Int @default(0) @map("simulated_orders")
  simulatedFills   Int @default(0) @map("simulated_fills")
  strategyErrors   Int @default(0) @map("strategy_errors")

  /// Always true. Present as a column so a row read in isolation, or exported
  /// to a spreadsheet, still says what it is.
  isSimulated Boolean @default(true) @map("is_simulated")

  startedAt  DateTime  @default(now()) @map("started_at") @db.Timestamptz(6)
  stoppedAt  DateTime? @map("stopped_at") @db.Timestamptz(6)
  stopReason String?   @map("stop_reason") @db.VarChar(500)
  errorCode  String?   @map("error_code") @db.VarChar(64)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant   Tenant    @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  strategy Strategy? @relation(fields: [strategyId], references: [id], onDelete: SetNull)

  snapshots PaperPortfolioSnapshot[]

  @@unique([tenantId, sessionIdentifier])
  @@index([tenantId, status, startedAt])
  @@index([tenantId, strategyId, startedAt])
  @@index([startedAt])
  @@map("paper_trading_sessions")
}

// -----------------------------------------------------------------------------
// PaperPortfolioSnapshot - the simulated equity curve, sampled
// -----------------------------------------------------------------------------
// Sampled on a slow schedule and on stop. NOT written per fill and certainly
// not per tick: a snapshot per event would put the database in the hot path,
// which is the one thing the data plane is not allowed to do.
// -----------------------------------------------------------------------------

model PaperPortfolioSnapshot {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  sessionId String @map("session_id") @db.Uuid

  /// Monotonically increasing per session.
  sequence Int

  capturedAtMicros BigInt @map("captured_at_micros")

  cash             Decimal  @db.Decimal(18, 6)
  positionQuantity Decimal  @default(0) @map("position_quantity") @db.Decimal(28, 12)
  positionValue    Decimal? @map("position_value") @db.Decimal(18, 6)
  equity           Decimal  @db.Decimal(18, 6)
  realisedPnl      Decimal  @default(0) @map("realised_pnl") @db.Decimal(18, 6)
  /// Null when flat or unmarked.
  unrealisedPnl    Decimal? @map("unrealised_pnl") @db.Decimal(18, 6)
  feesPaid         Decimal  @default(0) @map("fees_paid") @db.Decimal(18, 6)
  drawdown         Decimal  @default(0) @db.Decimal(18, 6)

  /// Always true.
  isSimulated Boolean @default(true) @map("is_simulated")

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  tenant  Tenant              @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  session PaperTradingSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)

  @@unique([sessionId, sequence])
  @@index([tenantId, sessionId, capturedAtMicros])
  @@map("paper_portfolio_snapshots")
}

// =============================================================================
// PART 7 - HISTORICAL DATASETS (ingestion, validation, replay input)
// =============================================================================
// These tables are the control-plane projection of dataset files that live in
// dataset storage (local now, object storage later). PostgreSQL holds
// METADATA ONLY - manifests, checksums, file receipts, validation verdicts,
// ingestion progress. Event payloads never land here: millions of rows per
// capture would put a database in the replay hot path, and a replay that
// reads the same semantic content twice through two stores is a second truth
// waiting to disagree.
//
// TENANCY NOTE, stated rather than hidden: a historical dataset is public
// market data - the same tape any visitor of the venue archive would fetch.
// There is no per-tenant data in these tables to isolate, so these models
// deliberately carry no tenantId column, and adding one would imply an
// isolation the data does not have. Cross-tenant leakage protection lives on
// the doors instead: every read needs dataset:read, every mutation needs a
// named operator, and audit records carry the requesting tenant. A backtest
// run row (tenant-scoped, Part 6) REFERENCES a dataset version; that
// reference is where a tenant's results and platform data meet, and it is
// read-only from the tenant side forever.
//
// Immutability is a service-layer invariant with schema support: version
// rows are insert-only in practice (the API exposes no payload-mutating
// route), the unique (datasetId, version) constraint makes a version
// addressable exactly once, and the content checksum column is the identity
// the replay verifies. Status transitions - quarantine, archive - move a
// version OUT of use; nothing moves data INTO a published version.
//
// No endpoint here can reach a venue or an order. Datasets belong to
// BACKTEST. The live and paper paths never read these tables.

enum DatasetStatus {
  CREATED     @map("created")
  INGESTING   @map("ingesting")
  VALIDATING  @map("validating")
  VALID       @map("valid")
  INVALID     @map("invalid")
  QUARANTINED @map("quarantined")
  ARCHIVED    @map("archived")

  @@map("dataset_status")
}

enum DatasetCompleteness {
  COMPLETE @map("complete")
  PARTIAL  @map("partial")
  UNKNOWN  @map("unknown")

  @@map("dataset_completeness")
}

enum DatasetValidationRunStatus {
  RUNNING @map("running")
  PASSED  @map("passed")
  FAILED  @map("failed")
  ERROR   @map("error")

  @@map("dataset_validation_run_status")
}

enum DatasetIngestionRunStatus {
  PENDING     @map("pending")
  RUNNING     @map("running")
  VALIDATING  @map("validating")
  FINALIZING  @map("finalizing")
  SUCCEEDED   @map("succeeded")
  FAILED      @map("failed")
  QUARANTINED @map("quarantined")

  @@map("dataset_ingestion_run_status")
}

enum HistoricalSourceKind {
  BINANCE_PUBLIC_DATA   @map("binance_public_data")
  LOCAL_FILES           @map("local_files")
  OBJECT_STORAGE_EXPORT @map("object_storage_export")
  DATABASE_EXPORT       @map("database_export")
  STREAM_CAPTURE        @map("stream_capture")

  @@map("historical_source_kind")
}

/// Mirrors wlct_trading's MarketEventKind wire values exactly. No separate
/// "dataset event type" enum exists: one vocabulary, reused, per the part's
/// whole point.
enum DatasetEventKind {
  TICKER        @map("TICKER")
  TRADE         @map("TRADE")
  BOOK_SNAPSHOT @map("BOOK_SNAPSHOT")
  BOOK_DELTA    @map("BOOK_DELTA")
  CANDLE        @map("CANDLE")

  @@map("dataset_event_kind")
}

model HistoricalDataset {
  id String @id @default(uuid()) @db.Uuid

  /// The derived identity: hst-<32 hex>, a SHA-256 prefix of the dataset's
  /// CONTRACT (source kind + label, venue, market type, sorted symbol set,
  /// sorted event-kind set, requested window, granularity, canonical schema
  /// version). It changes when any of those change and ONLY then: two
  /// captures of one contract share a key and are distinguished by version
  /// and content checksum, which is the versioning story the files tell.
  datasetKey String @unique @map("dataset_key") @db.VarChar(64)

  name String @db.VarChar(120)

  venue      TradingVenue
  symbols    String[]
  marketType TradingMarketType  @default(SPOT) @map("market_type")
  eventKinds DatasetEventKind[] @map("event_kinds")

  granularity String? @db.VarChar(20)

  /// The REQUESTED window. Observed bounds live per version and per file,
  /// because a refresh may legitimately find more data than the first run.
  startMicros BigInt @map("start_micros")
  endMicros   BigInt @map("end_micros")

  /// Rollup of the newest version's status, denormalised for list pages.
  /// A version row remains the authority for any decision.
  status        DatasetStatus @default(CREATED)
  latestVersion Int?          @map("latest_version")

  /// Schema lineage: a change to either version means old manifests are not
  /// to be reinterpreted by the new reader; the reader must know both.
  schemaVersion          Int @default(1) @map("schema_version")
  canonicalSchemaVersion Int @default(1) @map("canonical_schema_version")

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  versions      HistoricalDatasetVersion[]
  ingestionRuns DatasetIngestionRun[]

  @@index([venue, marketType, status])
  @@index([status, createdAt])
  @@index([startMicros, endMicros])
  @@map("historical_datasets")
}

model HistoricalDatasetVersion {
  id        String @id @default(uuid()) @db.Uuid
  datasetId String @map("dataset_id") @db.Uuid

  /// Monotone within a dataset. The pair (datasetKey, version) is the
  /// reproducibility handle printed in every backtest result.
  version Int

  status DatasetStatus

  /// SHA-256 over the canonical checksum_source of every event in replay
  /// merge order - the Part 6 content semantics. Two versions with different
  /// bytes never share this; a backtest citing a version is citing this.
  contentChecksum  String  @map("content_checksum") @db.VarChar(64)
  manifestChecksum String? @map("manifest_checksum") @db.VarChar(64)

  /// Relative location of the manifest inside dataset storage:
  /// "<datasetKey>/v<version>". Relative BY RULE: the storage layer refuses
  /// absolute paths and traversal, and the API never constructs a filesystem
  /// path at all, so a stored value can never smuggle either. Credentials
  /// cannot ride here because URIs here carry no authority component.
  storageUri String @map("storage_uri") @db.VarChar(500)

  compression String? @db.VarChar(16)

  fileCount  Int    @default(0) @map("file_count")
  eventCount Int    @default(0) @map("event_count")
  totalBytes BigInt @default(0) @map("total_bytes")

  /// Observed bounds for THIS version's actual contents.
  startMicros BigInt @map("start_micros")
  endMicros   BigInt @map("end_micros")

  completeness DatasetCompleteness @default(UNKNOWN)

  /// Provenance, denormalised from the manifest for query: which kind of
  /// source produced this, and its label. Public by construction - the
  /// ingestion adapters accept no credentials, and the label is checked
  /// against the credential pattern on write.
  sourceKind  HistoricalSourceKind @map("source_kind")
  sourceLabel String               @map("source_label") @db.VarChar(200)

  /// The stored manifest bytes as recorded at registration. Verifiers
  /// recompute the derived key from this JSON and compare - an edited row
  /// is visible without reading a single data file.
  manifestJson Json  @default("{}") @map("manifest_json")
  qualityJson  Json? @map("quality_json")

  validatedAt DateTime? @map("validated_at") @db.Timestamptz(6)
  finalizedAt DateTime? @map("finalized_at") @db.Timestamptz(6)

  creatorJobId    String? @map("creator_job_id") @db.VarChar(80)
  createdByUserId String? @map("created_by_user_id") @db.Uuid

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  dataset     HistoricalDataset             @relation(fields: [datasetId], references: [id], onDelete: Cascade)
  files       HistoricalDatasetFile[]
  validations HistoricalDatasetValidation[]
  backtests   BacktestRun[]

  @@unique([datasetId, version])
  @@index([contentChecksum])
  @@index([status, finalizedAt])
  @@map("historical_dataset_versions")
}

/// Per-partition file receipts: what a reader must find on disk for the
/// version to be what its manifest says. Integrity-checking data, not the
/// data itself.
model HistoricalDatasetFile {
  id        String @id @default(uuid()) @db.Uuid
  versionId String @map("version_id") @db.Uuid

  partitionPath String           @map("partition_path") @db.VarChar(400)
  symbol        String           @db.VarChar(32)
  eventKind     DatasetEventKind @map("event_kind")

  events Int
  bytes  BigInt
  sha256 String @db.VarChar(64)

  firstTsMicros BigInt @map("first_ts_micros")
  lastTsMicros  BigInt @map("last_ts_micros")

  compression String? @db.VarChar(16)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  version HistoricalDatasetVersion @relation(fields: [versionId], references: [id], onDelete: Cascade)

  @@unique([versionId, partitionPath])
  @@index([versionId, eventKind, symbol])
  @@map("historical_dataset_files")
}

/// Validation runs against a version. The report body lives beside the
/// dataset (report.json); this row keeps the verdict, the counts that drove
/// it, and the digests that bind it to the exact manifest it judged.
model HistoricalDatasetValidation {
  id        String @id @default(uuid()) @db.Uuid
  versionId String @map("version_id") @db.Uuid

  status DatasetValidationRunStatus @default(RUNNING)

  infoCount    Int @default(0) @map("info_count")
  warningCount Int @default(0) @map("warning_count")
  errorCount   Int @default(0) @map("error_count")
  fatalCount   Int @default(0) @map("fatal_count")

  /// Finding-rule counts, exact even when the retained findings list was
  /// capped: report brevity must never corrupt the arithmetic.
  countsByRule Json? @map("counts_by_rule")

  reportUri      String? @map("report_uri") @db.VarChar(500)
  reportSha256   String? @map("report_sha256") @db.VarChar(64)
  policyDigest   String? @map("policy_digest") @db.VarChar(64)
  durationMicros BigInt? @map("duration_micros")

  startedAt  DateTime  @default(now()) @map("started_at") @db.Timestamptz(6)
  finishedAt DateTime? @map("finished_at") @db.Timestamptz(6)

  version HistoricalDatasetVersion @relation(fields: [versionId], references: [id], onDelete: Cascade)

  @@index([versionId, status])
  @@map("historical_dataset_validations")
}

/// One ingestion attempt, end to end. A run never marks its version VALID -
/// finalisation is the pipeline's atomic act on storage; this row tracks the
/// JOB so an operator can see stuck, failed and quarantined attempts without
/// reading a queue. paramsJson is validated credential-free on write.
model DatasetIngestionRun {
  id String @id @default(uuid()) @db.Uuid

  /// Null until the first finalisation names a dataset; the hint keeps
  /// in-flight runs attributable to the key they are writing toward.
  datasetId      String? @map("dataset_id") @db.Uuid
  datasetKeyHint String? @map("dataset_key_hint") @db.VarChar(64)
  version        Int?

  status       DatasetIngestionRunStatus @default(PENDING)
  stage        String?                   @db.VarChar(40)
  progressJson Json                      @default("{}") @map("progress_json")

  /// Redacted, operator-facing failure text. Set by the worker from the
  /// exception CLASS and message only; stack traces and response bodies
  /// (which can carry request context) are deliberately not stored.
  errorText String? @map("error_text") @db.Text

  /// The staging area this run owns. Unique so two live jobs can never
  /// write one staging tree - the resume story assumes one owner per key.
  stagingKey String @unique @map("staging_key") @db.VarChar(80)

  sourceKind HistoricalSourceKind @map("source_kind")
  paramsJson Json                 @default("{}") @map("params_json")

  bytesDownloaded BigInt @default(0) @map("bytes_downloaded")
  eventsWritten   Int    @default(0) @map("events_written")

  requestedByUserId String? @map("requested_by_user_id") @db.Uuid

  startedAt  DateTime? @map("started_at") @db.Timestamptz(6)
  finishedAt DateTime? @map("finished_at") @db.Timestamptz(6)
  createdAt  DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt  DateTime  @updatedAt @map("updated_at") @db.Timestamptz(6)

  dataset HistoricalDataset? @relation(fields: [datasetId], references: [id], onDelete: SetNull)

  @@index([status, createdAt])
  @@index([datasetId, version])
  @@map("dataset_ingestion_runs")
}

// -----------------------------------------------------------------------------
// Part 8: real-time risk engine - durable control-plane tables.
//
// Division of labour, restated at the schema because a table is where the
// next implementer looks: PostgreSQL holds what must survive a Redis flush
// (configuration versions, protection actions, event trail, periodic
// snapshot METADATA). Hot risk state - the per-account snapshot the gate
// reads for every decision - deliberately has NO table: it lives in Redis
// (``wlct:trading:t:<tenant>:risk:<account>:snapshot``) and is rebuilt from
// the authoritative sources when missing. A missing rebuild fails closed; a
// missing row never decides anything.
// -----------------------------------------------------------------------------

/// One immutable revision of an account's risk configuration document.
///
/// `RiskConfiguration` above is the *current* view; this is the history.
/// A version row is written before the pointer moves and is never updated:
/// "what were the limits when that order was approved" must be answerable
/// years later, and an UPDATE here is the audit lie the table exists to
/// prevent. `@@unique([accountId, version])` makes a double-publish
/// impossible, and the checksum cross-check (`digest` vs the engine's
/// recomputation of `policyJson`) makes a half-write visible.
model RiskConfigurationVersion {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  accountId String @map("account_id") @db.Uuid
  version   Int
  digest    String @db.VarChar(64)

  policyJson     Json  @map("policy_json")
  protectionJson Json? @map("protection_json")

  changedByUserId  String  @map("changed_by_user_id") @db.Uuid
  changeReason     String  @map("change_reason") @db.VarChar(500)
  /// Whether this revision widened any effective ceiling relative to its
  /// predecessor, computed by the service on write. Stored denormalised so
  /// "show me every loosening" is one indexed query, not a JSON diff of the
  /// whole history.
  loosenedCeilings Boolean @default(false) @map("loosened_ceilings")

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  tenant  Tenant         @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  account TradingAccount @relation(fields: [accountId], references: [id], onDelete: Cascade)

  @@unique([accountId, version])
  @@index([tenantId, createdAt])
  @@map("risk_configuration_versions")
}

/// Periodic metadata of the engine's hot risk snapshots. Metadata only -
/// NEVER the state itself, and never per tick.
///
/// Written by the risk-state sync job (queue ``risk-control``), at the
/// configured cadence or on event, not on market updates. It exists so an
/// operator can answer "when did exposure last refresh, and against which
/// config" from SQL without reading Redis, and so a stale-state incident has
/// a durable timeline. ``completenessJson`` records the snapshot's own
/// self-assessment (missing sources, advisories) exactly as the engine saw
/// it - risk's honesty is preserved by copying its words, not re-deriving.
model RiskSnapshotMetadata {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  accountId       String  @map("account_id") @db.Uuid
  snapshotId      String  @map("snapshot_id") @db.VarChar(64)
  snapshotVersion BigInt  @map("snapshot_version")
  tradingDay      String  @map("trading_day") @db.VarChar(10)
  configDigest    String? @map("config_digest") @db.VarChar(64)
  stateDigest     String? @map("state_digest") @db.VarChar(64)

  equity               Decimal? @db.Decimal(28, 8)
  accountGrossNotional Decimal? @map("account_gross_notional") @db.Decimal(28, 8)
  netDailyPnl          Decimal? @map("net_daily_pnl") @db.Decimal(28, 8)
  openOrderCount       Int      @map("open_order_count")
  staleSources         Json?    @map("stale_sources")
  advisories           Json?
  isComplete           Boolean  @default(false) @map("is_complete")
  isSimulated          Boolean  @default(false) @map("is_simulated")

  capturedAt DateTime @map("captured_at") @db.Timestamptz(6)
  createdAt  DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  tenant  Tenant         @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  account TradingAccount @relation(fields: [accountId], references: [id], onDelete: Cascade)

  @@unique([accountId, snapshotVersion])
  @@index([tenantId, capturedAt])
  @@index([tenantId, isComplete, capturedAt])
  @@map("risk_snapshot_metadata")
}

/// One automatic-protection trip and its clearance. The switch row
/// (``kill_switches``) carries the live halt; THIS row is the protection's
/// own story: why it fired, on what rule, who acknowledged it, under what
/// reason it was cleared. A triggered protection that improved out of it
/// (PnL recovered) does NOT clear - the service layer has no method that
/// writes `clearedAt` without a user id and a reason, and this table is
/// where that promise is written down.
model RiskProtectionTrip {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  accountId String?        @map("account_id") @db.Uuid
  scope     RiskLimitScope
  target    String?        @db.VarChar(64)

  action RiskProtectionAction
  ruleId String?              @map("rule_id") @db.VarChar(64)
  reason String               @db.VarChar(500)
  status String               @default("ACTIVE") @db.VarChar(16)

  triggeredAtDateTime  DateTime  @default(now()) @map("triggered_at") @db.Timestamptz(6)
  acknowledgedByUserId String?   @map("acknowledged_by_user_id") @db.Uuid
  acknowledgedAt       DateTime? @map("acknowledged_at") @db.Timestamptz(6)
  clearedByUserId      String?   @map("cleared_by_user_id") @db.Uuid
  clearedAt            DateTime? @map("cleared_at") @db.Timestamptz(6)
  clearedReason        String?   @map("cleared_reason") @db.VarChar(500)

  snapshotVersion BigInt? @map("snapshot_version")
  isSimulated     Boolean @default(false) @map("is_simulated")

  tenant  Tenant          @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  account TradingAccount? @relation(fields: [accountId], references: [id], onDelete: Cascade)

  @@index([tenantId, status, triggeredAtDateTime])
  @@index([tenantId, accountId])
  @@map("risk_protection_actions")
}

// ===========================================================================
// Part 9: observability & operations
// ===========================================================================

/// Alert severity. The four levels exist because "warning" and "critical"
/// alone collapse every judgement into "page someone"; INFO and EMERGENCY
/// restore the middle and the ceiling of the ladder. EMERGENCY is reserved
/// for conditions the platform treats as stop-and-read-now (the engine's own
/// rule catalog in wlct_trading.observability.alerts owns which is which;
/// the parity test keeps this list and that one telling the same story).
enum OpsAlertSeverity {
  INFO
  WARNING
  CRITICAL
  EMERGENCY
}

/// The explicit alert states. There is no CLOSED and no CANCELLED: OPEN ->
/// ACKNOWLEDGED -> (observed recovery or typed force-resolve) -> RESOLVED is
/// the whole machine, matching the engine-side state machine one for one.
enum OpsAlertState {
  OPEN
  ACKNOWLEDGED
  RESOLVED
}

enum OpsIncidentStatus {
  OPEN
  REVIEWING
  CLOSED
}

/// What an incident may link to. The set mirrors the engine-side
/// ``IncidentLinkKind`` exactly; the parity test enforces it.
enum OpsIncidentLinkKind {
  ALERT
  RISK_EVENT
  AUDIT
  ORDER
  EXECUTION_INCIDENT
  STRATEGY_EVENT
  MARKET_DATA_FAULT
  QUEUE_JOB
}

/// One deduplicated, currently-tracked operational condition.
///
/// Rows are FOLDED, never fanned out: the whole table is keyed by
/// ``dedupeKey`` = ``<ruleId>|<component>|<scope>``, and repeats from the
/// engine's mirror bump ``occurrences`` and ``lastSeenAt`` instead of
/// inserting. This is what lets a night of ten thousand identical stale-feed
/// ticks stay one row - and why ``occurrences``, ``firstSeenAt`` and
/// ``lastSeenAt`` are non-nullable columns rather than something to
/// reconstruct: the magnitude of an alert is part of the alert, not an
/// afterthought.
///
/// Resolution discipline: RESOLVED is written by the sync job only on
/// observed recovery (publisher mirror present, record gone) or by an
/// operator force-resolve carrying the typed confirmation phrase - each
/// force-resolve gets its own audit row, and never deletes this one.
model OpsAlert {
  id String @id @default(uuid()) @db.Uuid

  /// The engine's dedupe key. Unique, so the fold is an upsert, not a race.
  dedupeKey String           @unique @map("dedupe_key") @db.VarChar(191)
  ruleId    String           @map("rule_id") @db.VarChar(64)
  component String           @db.VarChar(64)
  scope     String?          @db.VarChar(128)
  severity  OpsAlertSeverity
  state     OpsAlertState    @default(OPEN)
  title     String           @db.VarChar(255)
  condition String           @db.VarChar(500)
  message   String?          @db.VarChar(500)

  /// Decimal-as-string discipline for any comparable quantity; observed and
  /// threshold are display facts, never computed with in SQL.
  observedValue  String? @map("observed_value") @db.VarChar(64)
  thresholdValue String? @map("threshold_value") @db.VarChar(64)

  occurrences Int      @default(1) @map("occurrences")
  firstSeenAt DateTime @map("first_seen_at") @db.Timestamptz(6)
  lastSeenAt  DateTime @map("last_seen_at") @db.Timestamptz(6)

  acknowledgedBy String?   @map("acknowledged_by") @db.VarChar(64)
  acknowledgedAt DateTime? @map("acknowledged_at") @db.Timestamptz(6)
  resolvedAt     DateTime? @map("resolved_at") @db.Timestamptz(6)
  /// How it ended: 'recovered' (observed), 'recovered (note)', or
  /// 'force-resolved by <actor>: <reason>'. Never null once RESOLVED.
  resolution     String?   @db.VarChar(500)

  /// The engine-side correlation links carried by the fold (alertId,
  /// risk event ids, correlationId, ...). References, never payloads - the
  /// same rule the incidents follow.
  links Json?

  /// Null = platform-wide infrastructure condition. Tenant rows are visible
  /// to that tenant's console; platform rows are readable everywhere the
  /// read permission reaches but mutable only by the platform role.
  tenantId String? @map("tenant_id") @db.Uuid

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant Tenant? @relation(fields: [tenantId], references: [id], onDelete: SetNull)

  @@index([state, lastSeenAt])
  @@index([severity, state])
  @@index([tenantId, lastSeenAt])
  @@map("ops_alerts")
}

/// An incident is the operator's story across several correlated records.
/// It owns no copies: links are (kind, targetId) pairs into the tables that
/// hold the truth, so an incident cannot drift from its evidence or leak a
/// payload. The sync job creates one per grouping key (correlation id when
/// present, digest of links otherwise) and folds repeats - the same
/// storm-proof discipline as alerts, applied one level up.
model OpsIncident {
  id String @id @default(uuid()) @db.Uuid

  /// The engine-side deterministic id (inc_<digest>), unique so re-publish
  /// of the same story folds instead of duplicating.
  incidentId  String            @unique @map("incident_id") @db.VarChar(64)
  /// 'correlation:<id>' or 'links:<digest>' - the dedupe identity itself,
  /// kept as a column so the panel can show why two incidents are one.
  groupingKey String            @unique @map("grouping_key") @db.VarChar(191)
  title       String            @db.VarChar(200)
  status      OpsIncidentStatus @default(OPEN)
  severity    OpsAlertSeverity?

  correlationId String? @map("correlation_id") @db.VarChar(64)
  operationId   String? @map("operation_id") @db.VarChar(64)

  openedAt  DateTime  @map("opened_at") @db.Timestamptz(6)
  closedAt  DateTime? @map("closed_at") @db.Timestamptz(6)
  /// Only ever written with a note: closing without saying why is exactly
  /// the "silently marked resolved" failure the spec forbids for alerts,
  /// extended here by the same logic.
  closeNote String?   @map("close_note") @db.VarChar(500)

  tenantId String? @map("tenant_id") @db.Uuid

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant Tenant?           @relation(fields: [tenantId], references: [id], onDelete: SetNull)
  links  OpsIncidentLink[]

  @@index([status, openedAt])
  @@index([correlationId])
  @@map("ops_incidents")
}

model OpsIncidentLink {
  id         String              @id @default(uuid()) @db.Uuid
  incidentId String              @map("incident_id") @db.Uuid
  kind       OpsIncidentLinkKind
  targetId   String              @map("target_id") @db.VarChar(128)
  note       String?             @db.VarChar(255)
  createdAt  DateTime            @default(now()) @map("created_at") @db.Timestamptz(6)

  incident OpsIncident @relation(fields: [incidentId], references: [id], onDelete: Cascade)

  @@unique([incidentId, kind, targetId])
  @@index([kind, targetId])
  @@map("ops_incident_links")
}

// ===========================================================================
// Part 10: reliability - SLO configuration versions and evaluation rows.
//
// Same versioned-appendix discipline as the risk catalog (Part 8): a change
// to an SLO definition INSERTS a new (sloId, version) row and never updates
// an old one, so every evaluation can say exactly which version of the
// promise it measured. The checksum is sha256 over the engine's canonical
// JSON of the objective (version and enabled are excluded by design: the
// identity of the PROMISE moves only when the promise changes).
//
// These tables are platform-operational, not tenant data: no tenantId, no
// tenant relation, reads gated by permission. Evaluations are an append-only
// evidence log - the maintenance job prunes by age within the retention
// floor, and nothing in the trading path reads either table.
// ===========================================================================

enum SloEvaluationState {
  HEALTHY
  WARNING
  CRITICAL
  EXHAUSTED
  UNKNOWN
}

model SloConfigurationVersion {
  id String @id @default(uuid()) @db.Uuid

  /// Catalog identity: the engine's `slo_id` bounded lowercase token.
  sloId   String @map("slo_id") @db.VarChar(64)
  version Int

  /// The objective exactly as configured: a canonical DECIMAL STRING
  /// ("99.5"), never a float column. Floats in an SLO document are how
  /// every downstream checksum quietly moves.
  objective String @db.VarChar(16)

  windowMinutes      Int @map("window_minutes")
  shortWindowMinutes Int @map("short_window_minutes")

  /// The nine closed indicator types live in the engine (SloIndicator);
  /// VarChar rather than a DB enum on purpose: the engine's enum is the
  /// authority, and a new indicator must not require a migration to store
  /// evaluations of an objective the database has never heard of.
  indicator String @db.VarChar(48)

  owner       String @db.VarChar(64)
  description String @db.VarChar(200)

  /// The human counting rule, committed into the digest on the engine side
  /// and persisted verbatim here so the panel can show what "good" meant.
  goodEvent String @map("good_event") @db.VarChar(200)
  badEvent  String @map("bad_event") @db.VarChar(200)

  warningBurnPpm  Int @map("warning_burn_ppm")
  criticalBurnPpm Int @map("critical_burn_ppm")

  /// Freshness indicators carry an age budget; latency compliance carries a
  /// threshold bucket. Micros in BigInt, serialized to strings on the wire
  /// (the platform-wide 64-bit rule), null exactly when the indicator shape
  /// forbids the field.
  maxAgeMicros           BigInt? @map("max_age_micros")
  latencyThresholdMicros BigInt? @map("latency_threshold_micros")

  /// Flipping enablement never moves the checksum (it is not part of the
  /// objective's identity) - which is precisely why it is a column here
  /// rather than a new version of the promise.
  enabled Boolean @default(true)

  /// Full canonical payload the digest was taken over: stored so a checksum
  /// can be re-verified byte-for-byte without trusting the writer.
  payload  Json
  checksum String @db.VarChar(64)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  @@unique([sloId, version])
  @@index([sloId])
  @@map("slo_configuration_versions")
}

/// One evaluation tick's full verdict, appended by the maintenance job (or a
/// manual evaluation call) and read by the panel. `UNKNOWN` is a first-class
/// state, not a gap: a row saying UNKNOWN with dataComplete=false IS the
/// record that measurement failed - the alternative (no row) is
/// indistinguishable from "nobody looked".
model SloEvaluation {
  id String @id @default(uuid()) @db.Uuid

  sloId    String @map("slo_id") @db.VarChar(64)
  version  Int
  checksum String @db.VarChar(64)

  indicator String @db.VarChar(48)
  service   String @db.VarChar(64)

  state SloEvaluationState

  /// Evaluation timestamp in microseconds (BigInt in, string on the wire).
  evaluatedAtMicros BigInt @map("evaluated_at_micros")

  windowMinutes      Int @map("window_minutes")
  shortWindowMinutes Int @map("short_window_minutes")

  targetPpm Int  @map("target_ppm")
  /// Null exactly when the window had no samples: "no evidence" renders as
  /// null, never as 100% or 0%.
  actualPpm Int? @map("actual_ppm")

  budgetTotalEvents     Int  @default(0) @map("budget_total_events")
  budgetConsumedEvents  Int  @default(0) @map("budget_consumed_events")
  budgetRemainingEvents Int  @default(0) @map("budget_remaining_events")
  remainingRatioPpm     Int? @map("remaining_ratio_ppm")

  longBurnPpm  Int? @map("long_burn_ppm")
  shortBurnPpm Int? @map("short_burn_ppm")

  /// 'none' | 'fast' | 'slow' | 'both' - the AND-window alert verdict for
  /// this tick. Bounded literal; the burn-rate rule ids derive from it.
  alertKind String @map("alert_kind") @db.VarChar(8)

  samplesGood Int @map("samples_good")
  samplesBad  Int @map("samples_bad")

  /// The collector's completeness claim for BOTH windows (AND-ed by the
  /// engine). False here means the row documents a measurement gap.
  dataComplete Boolean @map("data_complete")

  reason String? @db.VarChar(500)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  @@index([sloId, createdAt])
  @@index([state, createdAt])
  @@map("slo_evaluations")
}

// ---------------------------------------------------------------------------
// Part 13 - durable execution-engine store (libs/trading-core OrderStore port)
// ---------------------------------------------------------------------------
// Written by services/execution-engine over asyncpg (app/store_sql.py); the
// DDL lives HERE so one mechanism owns every table, every tenant column, and
// the RLS policy set. Shape notes, each a decision rather than an accident:
//  * Quantities, prices and fees are TEXT, not NUMERIC. Python `Decimal` is
//    arbitrary precision (average_fill_price is a division; cumulative sums
//    inherit the deepest scale of their inputs) and NUMERIC(p,s) RESCALES -
//    a rounded stored aggregate would make the durable record disagree with
//    the domain's own derivation, which is exactly the class of lie this
//    platform refuses. Decimal-as-text is already the wire law
//    (services/execution-engine/app/schemas.py); these tables keep it
//    end-to-end, and the store's codec round-trips scale-exactly.
//  * Timestamps are epoch MICROSECONDS in BIGINT (the platform's int-time
//    law), not Timestamptz: the engine's clock discipline lives in micros
//    and a DB-side timezone conversion must never edit execution history.
//  * Enums are VARCHAR with the engine validating on read (the store's
//    codec raises on unknown values - fail-closed). They are NOT Postgres
//    ENUM types: the vocabulary lives in wlct_trading.enums and evolves
//    with the library; a mirrored CREATE TYPE here would be a second
//    source of truth with a drift bug waiting to happen.
//  * The child tables' FKs reference the composite (tenant_id, order_id)
//    key, so a fill or event physically cannot belong to order and tenant
//    pair that do not go together - cross-tenant child rows are a
//    constraint violation, not a code review item.
//  * reconciliation_state NULL means IN_SYNC (the reference store DELETES
//    its entry on sync; one fact gets exactly one spelling here too).

model ExecutionOrder {
  tenantId String @map("tenant_id") @db.Uuid

  /// Engine-minted order id. Composite PK with tenant below: order ids are
  /// only claimed unique WITHIN a tenant, and every query must carry the
  /// tenant - a global order_id primary key would tempt a tenant-less read.
  orderId       String  @map("order_id") @db.VarChar(64)
  clientOrderId String  @map("client_order_id") @db.VarChar(128)
  accountId     String  @map("account_id") @db.VarChar(64)
  strategyId    String? @map("strategy_id") @db.VarChar(64)

  exchange    String  @db.VarChar(32)
  symbol      String  @db.VarChar(32)
  side        String  @db.VarChar(8)
  /// OrderType value ("LIMIT", "STOP_LOSS_LIMIT", ...).
  orderType   String  @map("order_type") @db.VarChar(32)
  /// TimeInForce value ("GTC", "IOC", "FOK", "GTX").
  timeInForce String  @map("time_in_force") @db.VarChar(8)
  reduceOnly  Boolean @default(false) @map("reduce_only")
  signalId    String? @map("signal_id") @db.VarChar(64)

  /// The simulated-fill label, carried on the row so a paper order can
  /// never be laundered into a real one by a restart and re-read.
  isSimulated Boolean @map("is_simulated")

  /// OrderStatus value. Terminal statuses are decided by the engine's
  /// transition table at write time; nothing here re-derives them.
  status          String  @db.VarChar(24)
  /// The venue's own id, when observed. Never used as a lookup key without
  /// tenant context, even though the exchange promises uniqueness.
  exchangeOrderId String? @map("exchange_order_id") @db.VarChar(64)

  quantity         String  @db.VarChar(40)
  price            String? @db.VarChar(40)
  stopPrice        String? @map("stop_price") @db.VarChar(40)
  filledQuantity   String  @map("filled_quantity") @db.VarChar(40)
  averageFillPrice String? @map("average_fill_price") @db.VarChar(64)
  cumulativeFee    String  @map("cumulative_fee") @db.VarChar(64)
  feeCurrency      String? @map("fee_currency") @db.VarChar(16)

  rejectionReason String? @map("rejection_reason") @db.VarChar(500)

  createdAt   BigInt  @map("created_at")
  updatedAt   BigInt  @map("updated_at")
  submittedAt BigInt? @map("submitted_at")
  terminalAt  BigInt? @map("terminal_at")

  /// ReconciliationState value or NULL (= IN_SYNC). See ReconciliationState
  /// in the store module: PENDING_RECONCILIATION / UNKNOWN / DIVERGED.
  reconciliationState String? @map("reconciliation_state") @db.VarChar(24)

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Restrict)

  events ExecutionOrderEvent[]
  fills  ExecutionOrderFill[]

  @@id([tenantId, orderId])
  /// The cross-worker idempotency constraint the port documents: one client
  /// order id, one order, database-enforced. The reservation statement's ON
  /// CONFLICT rides this index.
  @@unique([tenantId, clientOrderId], map: "engine_orders_tenant_client_key")
  @@index([tenantId, accountId, status])
  @@index([reconciliationState])
  @@map("engine_orders")
}

model ExecutionOrderEvent {
  /// Insertion order IS the journal order (the port appends, never
  /// re-sorts); a monotonic global sequence is the only faithful ordering
  /// key, and it doubles as the row identity.
  seq BigInt @id @default(autoincrement())

  tenantId String @map("tenant_id") @db.Uuid
  orderId  String @map("order_id") @db.VarChar(64)

  /// OrderEvent.event_id: engine-minted, unique per order but NOT globally
  /// (the in-memory store never checks it), so NO unique constraint here -
  /// record_event appends unconditionally by port contract, and a DB
  /// constraint stricter than that would reject rows the reference store
  /// accepts. Indexed for correlation; seq keeps list_events deterministic.
  eventId          String  @map("event_id") @db.VarChar(64)
  previousStatus   String? @map("previous_status") @db.VarChar(24)
  status           String  @db.VarChar(24)
  reason           String? @db.VarChar(500)
  occurredAtMicros BigInt  @map("occurred_at")

  /// OrderEvent.payload - dict[str, str], canonical-JSON-encoded into jsonb.
  payload Json @map("payload")

  order ExecutionOrder @relation(fields: [tenantId, orderId], references: [tenantId, orderId], onDelete: Restrict)

  @@index([tenantId, orderId, seq])
  @@index([tenantId, eventId])
  @@map("engine_order_events")
}

model ExecutionOrderFill {
  seq BigInt @id @default(autoincrement())

  tenantId String @map("tenant_id") @db.Uuid
  orderId  String @map("order_id") @db.VarChar(64)

  /// The venue's fill/trade identity within the engine's namespace. Unique
  /// per tenant by constraint: record_fill's ON CONFLICT DO NOTHING reads
  /// the same index, which is what makes an at-least-once delivery replay a
  /// no-op instead of a double count.
  fillId  String @map("fill_id") @db.VarChar(128)
  tradeId String @map("trade_id") @db.VarChar(128)

  price    String @db.VarChar(40)
  quantity String @db.VarChar(40)
  fee      String @db.VarChar(64)

  feeCurrency String  @map("fee_currency") @db.VarChar(16)
  isMaker     Boolean @map("is_maker")
  isSimulated Boolean @map("is_simulated")

  exchangeTimestamp BigInt @map("exchange_timestamp")
  receivedTimestamp BigInt @map("received_timestamp")

  // -- Venue attribution (nullable: fills predate the attribution fields) --
  symbol          String? @db.VarChar(32)
  side            String? @db.VarChar(8)
  exchange        String? @db.VarChar(32)
  quoteQuantity   String? @map("quote_quantity") @db.VarChar(64)
  exchangeOrderId String? @map("exchange_order_id") @db.VarChar(64)

  order ExecutionOrder @relation(fields: [tenantId, orderId], references: [tenantId, orderId], onDelete: Restrict)

  @@unique([tenantId, fillId], map: "engine_order_fills_tenant_fill_key")
  @@index([tenantId, orderId, seq])
  @@map("engine_order_fills")
}

/// The execution engine's own incident records (Part 17) - the durable sink
/// behind ``wlct_trading.execution.incidents.IncidentRecorder``, previously
/// process-memory-only.
///
/// Why a table of the engine's rather than a writer for `execution_incidents`
/// above: that table is the console's projection, with uuid foreign keys into the
/// API's own aggregates (`orders`, `trading_accounts`), Postgres enums for its
/// vocabularies and `timestamptz` audit columns. The engine speaks engine order
/// ids, VARCHAR vocabularies validated by the codec, and microsecond integers -
/// the Part 13 argument for `engine_orders` beside `orders`, repeated here for the
/// record that explains an order. Two tables that answer to one mapper is the
/// arrangement the platform already runs; one table that answers to two clocks is
/// not.
model ExecutionEngineIncident {
  /// Insertion order doubles as the read order: `list_open` is a seq-DESC scan,
  /// so "newest first" stays decidable when one failed command emits a pair of
  /// incidents inside the same microsecond.
  seq BigInt @id @default(autoincrement())

  /// The core's uuid, kept as text because it is minted before the row exists and
  /// is the identifier the log line and the alert already carry. Unique by
  /// constraint, which is what turns an at-least-once replay of the same incident
  /// into a refusal to double-write rather than a second row in an audit trail.
  incidentId String @unique @map("incident_id") @db.VarChar(64)

  tenantId String @map("tenant_id") @db.Uuid

  /// Nullable: most incidents have no account (a credential refusal, a lock
  /// outage). A blank string would make "no account" a value a filter matches.
  accountId String? @map("account_id") @db.VarChar(64)

  incidentType String @map("incident_type") @db.VarChar(48)
  severity     String @db.VarChar(16)
  summary      String @db.VarChar(500)

  exchange String? @db.VarChar(32)
  symbol   String? @db.VarChar(32)

  /// Plain columns, NOT a composite FK to `engine_orders`: an incident often has
  /// no order, and a MATCH SIMPLE composite key with a nullable column is a
  /// constraint that never fires while reading like a guarantee.
  orderId       String? @map("order_id") @db.VarChar(64)
  clientOrderId String? @map("client_order_id") @db.VarChar(128)

  /// The taxonomy from the core, as the string it already is on the wire.
  errorCode String? @map("error_code") @db.VarChar(48)

  /// Scrubbed by ``ExecutionIncident.create`` before it ever reaches here.
  details Json @default("{}") @db.JsonB

  /// Epoch micros, engine clock (the platform time law).
  occurredAt BigInt @map("occurred_at")

  /// Insert-only law: the core's ``resolve()`` returns a NEW incident, so these
  /// two columns are written once and read forever. There is no UPDATE path in
  /// the store, and that is the design rather than an omission.
  resolved       Boolean @default(false)
  resolutionNote String? @map("resolution_note") @db.VarChar(500)

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Restrict)

  @@index([tenantId, resolved, occurredAt], map: "engine_incidents_tenant_open_idx")
  @@index([tenantId, incidentType, occurredAt], map: "engine_incidents_tenant_type_idx")
  @@map("engine_incidents")
}

model ExecutionRetentionRun {
  /// Run identity and insertion order share one BIGSERIAL (the journal
  /// pattern from the event/fill tables): "last five runs" is a seq-DESC
  /// scan, and the row order on disk is the run order, always.
  seq BigInt @id @default(autoincrement())

  tenantId String @map("tenant_id") @db.Uuid

  /// Epoch micros, engine clock (the platform time law). started_at and
  /// finished_at bracket the WHOLE run - batch loop and ledger write - so
  /// a long run is visible as long, not as missing.
  startedAt  BigInt @map("started_at")
  finishedAt BigInt @map("finished_at")

  /// Dry runs are recorded too: a rehearsal's answer ("N rows prunable as
  /// of cutoff X") is evidence, and the row that says nobody deleted
  /// anything is what makes the next apply trustworthy. On such rows
  /// rowsDeleted holds the PRUNABLE COUNT, not a deletion.
  dryRun Boolean @map("dry_run")

  /// The cutoff the run applied, kept so "what did '90 days' mean on that
  /// date" is answerable after a config change redefines the number.
  eventCutoffUs BigInt @map("event_cutoff_us")
  rowsDeleted   BigInt @map("rows_deleted")

  /// Batch accounting: how many statements the run spent, and whether it
  /// hit EXECUTION_RETENTION_MAX_BATCHES with work remaining (exhausted
  /// true means "run again" - the scheduler's job, not this row's).
  batches   Int
  exhausted Boolean @default(false)

  /// Which engine process performed (or rehearsed) the run - the
  /// attribution field the platform's instance-id law requires.
  instanceId String @map("instance_id") @db.VarChar(64)

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Restrict)

  @@index([tenantId, seq], map: "engine_retention_runs_tenant_id_seq_idx")
  @@map("engine_retention_runs")
}

// =============================================================================
// PART 9 - Billing Notifications, Dunning, Invoice Delivery, Usage Alerts
// =============================================================================
// Tenant-isolated persistent notification jobs, preferences, webhook subscriptions,
// delivery attempts, and audit logs. No secrets in plaintext columns, all
// payloads sanitized, idempotency enforced, provider references tracked.

enum BillingNotificationEventKey {
  PAYMENT_SUCCEEDED
  PAYMENT_PENDING
  PAYMENT_FAILED
  PAYMENT_EXPIRED
  REFUND_SUCCEEDED
  REFUND_FAILED
  INVOICE_CREATED
  INVOICE_FINALIZED
  INVOICE_PAID
  INVOICE_OVERDUE
  SUBSCRIPTION_ACTIVATED
  SUBSCRIPTION_CHANGED
  SUBSCRIPTION_CANCELLATION_SCHEDULED
  SUBSCRIPTION_RESUMED
  TRIAL_STARTING
  TRIAL_ENDING
  DUNNING_RETRY
  DUNNING_RECOVERED
  DUNNING_FINAL_FAILURE
  USAGE_THRESHOLD_REACHED
  USAGE_OVERAGE_DETECTED
  CUSTOM_DOMAIN_VERIFICATION
  CUSTOM_DOMAIN_VERIFICATION_FAILED
  WHITE_LABEL_PROVISIONING
  FEE_SETTLEMENT_CREATED
  FEE_SETTLEMENT_FINALIZED
  PAYOUT_CREATED
  PAYOUT_SUCCEEDED
  PAYOUT_FAILED
  SAAS_TENANT_PROVISIONED
  SAAS_PLAN_CHANGED
}

enum BillingNotificationChannel {
  EMAIL
  IN_APP
  PUSH
  SMS
  WEBHOOK
}

enum BillingNotificationPriority {
  LOW
  NORMAL
  HIGH
  CRITICAL
}

enum BillingDeliveryStatus {
  CREATED
  PENDING
  QUEUED
  PROCESSING
  SENT
  DELIVERED
  FAILED
  RETRY_SCHEDULED
  PERMANENT_FAILURE
  SUPPRESSED
  CANCELLED
}

enum BillingNotificationCategory {
  BILLING
  DUNNING
  USAGE
  SUBSCRIPTION
  SECURITY
  SAAS_ADMIN
  FEE
  PAYOUT
}

model BillingNotificationJob {
  id        String @id @default(uuid()) @db.Uuid
  tenantId  String @map("tenant_id") @db.Uuid
  userId    String? @map("user_id") @db.Uuid

  recipient Json @default("{}")

  eventKey  BillingNotificationEventKey @map("event_key")
  channel   BillingNotificationChannel
  templateKey String @map("template_key") @db.VarChar(120)
  locale    String @default("en") @db.VarChar(10)
  priority  BillingNotificationPriority @default(NORMAL)
  category  BillingNotificationCategory @default(BILLING)

  deliveryStatus BillingDeliveryStatus @default(CREATED) @map("delivery_status")
  attemptCount   Int @default(0) @map("attempt_count")
  maxAttempts    Int @default(3) @map("max_attempts")
  nextAttemptAt  DateTime? @map("next_attempt_at") @db.Timestamptz(6)
  providerReference String? @map("provider_reference") @db.VarChar(255)
  idempotencyKey String @map("idempotency_key") @db.VarChar(255)

  safePayload Json @default("{}") @map("safe_payload")
  renderedSubject String? @map("rendered_subject") @db.VarChar(500)
  renderedBody    String? @map("rendered_body") @db.Text

  failureReason String? @map("failure_reason") @db.VarChar(1000)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)
  sentAt    DateTime? @map("sent_at") @db.Timestamptz(6)
  deliveredAt DateTime? @map("delivered_at") @db.Timestamptz(6)

  @@index([tenantId, deliveryStatus, createdAt])
  @@index([tenantId, eventKey, channel])
  @@index([deliveryStatus, nextAttemptAt])
  @@index([tenantId, userId])
  @@index([idempotencyKey])
  @@map("billing_notification_jobs")
  @@unique([tenantId, idempotencyKey])
}

model BillingNotificationPreference {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid
  userId   String? @map("user_id") @db.Uuid

  eventKey BillingNotificationEventKey? @map("event_key")
  channel  BillingNotificationChannel
  enabled  Boolean @default(true)
  category String @default("billing") @db.VarChar(48)
  isMandatory Boolean @default(false) @map("is_mandatory")
  locale   String @default("en") @db.VarChar(10)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  @@unique([tenantId, userId, eventKey, channel])
  @@index([tenantId, userId])
  @@index([tenantId, channel])
  @@map("billing_notification_preferences")
}

model WebhookSubscription {
  id        String @id @default(uuid()) @db.Uuid
  tenantId  String @map("tenant_id") @db.Uuid
  endpointUrl String @map("endpoint_url") @db.VarChar(2048)
  eventTypes BillingNotificationEventKey[] @map("event_types")
  enabled   Boolean @default(true)
  secretHash String @map("secret_hash") @db.VarChar(255)
  secretMasked String @map("secret_masked") @db.VarChar(64)
  lastDeliveryAt DateTime? @map("last_delivery_at") @db.Timestamptz(6)
  lastDeliveryStatus String? @map("last_delivery_status") @db.VarChar(32)
  failureCount Int @default(0) @map("failure_count")
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  deliveryAttempts WebhookDeliveryAttempt[]

  @@index([tenantId, enabled])
  @@index([tenantId, endpointUrl])
  @@map("webhook_subscriptions")
}

model WebhookDeliveryAttempt {
  id             String @id @default(uuid()) @db.Uuid
  subscriptionId String @map("subscription_id") @db.Uuid
  tenantId       String @map("tenant_id") @db.Uuid
  eventId        String @map("event_id") @db.VarChar(255)
  eventType      BillingNotificationEventKey @map("event_type")
  endpointUrl    String @map("endpoint_url") @db.VarChar(2048)
  payload        Json @default("{}")
  signature      String @db.VarChar(255)
  timestamp      DateTime @default(now()) @db.Timestamptz(6)
  status         BillingDeliveryStatus @default(PENDING)
  attempt        Int @default(1)
  providerReference String? @map("provider_reference") @db.VarChar(255)
  failureReason  String? @map("failure_reason") @db.VarChar(1000)
  nextAttemptAt  DateTime? @map("next_attempt_at") @db.Timestamptz(6)
  createdAt      DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  subscription WebhookSubscription @relation(fields: [subscriptionId], references: [id], onDelete: Cascade)

  @@unique([subscriptionId, eventId])
  @@index([tenantId, status, createdAt])
  @@index([eventId])
  @@map("webhook_delivery_attempts")
}

model BillingNotificationAuditLog {
  id            String @id @default(uuid()) @db.Uuid
  tenantId      String @map("tenant_id") @db.Uuid
  operation     String @db.VarChar(64)
  referenceId   String @map("reference_id") @db.VarChar(255)
  referenceType String @map("reference_type") @db.VarChar(64)
  status        String @db.VarChar(32)
  metadata      Json? @default("{}")
  actorId       String? @map("actor_id") @db.Uuid
  timestamp     DateTime @default(now()) @db.Timestamptz(6)
  createdAt     DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  @@index([tenantId, operation, createdAt])
  @@index([tenantId, referenceId])
  @@index([operation, createdAt])
  @@map("billing_notification_audit_logs")
}

// Additional billing finance models that were using fallback (optional, for completeness)
model Invoice {
  id            String @id @default(uuid()) @db.Uuid
  tenantId      String @map("tenant_id") @db.Uuid
  invoiceNumber String @unique @map("invoice_number") @db.VarChar(64)
  status        String @default("DRAFT") @db.VarChar(32)
  currency      String @default("USD") @db.VarChar(3)
  subtotal      String @default("0") @db.VarChar(32)
  taxTotal      String @default("0") @map("tax_total") @db.VarChar(32)
  total         String @default("0") @db.VarChar(32)
  amountPaid    String @default("0") @map("amount_paid") @db.VarChar(32)
  amountDue     String @default("0") @map("amount_due") @db.VarChar(32)
  amountRefunded String @default("0") @map("amount_refunded") @db.VarChar(32)
  paymentId     String? @map("payment_id") @db.Uuid
  subscriptionId String? @map("subscription_id") @db.Uuid
  planId        String? @map("plan_id") @db.Uuid
  provider      String? @db.VarChar(32)
  idempotencyKey String? @map("idempotency_key") @db.VarChar(255)
  customer      Json @default("{}")
  lines         Json @default("[]")
  taxSummary    Json @default("[]") @map("tax_summary")
  metadata      Json @default("{}")
  issuedAt      DateTime? @map("issued_at") @db.Timestamptz(6)
  dueDate       DateTime? @map("due_date") @db.Timestamptz(6)
  finalizedAt   DateTime? @map("finalized_at") @db.Timestamptz(6)
  paidAt        DateTime? @map("paid_at") @db.Timestamptz(6)
  voidedAt      DateTime? @map("voided_at") @db.Timestamptz(6)
  createdAt     DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt     DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  @@index([tenantId, status, createdAt])
  @@index([tenantId, paymentId])
  @@map("invoices")
  @@unique([tenantId, idempotencyKey])
}

model Payment {
  id                  String @id @default(uuid()) @db.Uuid
  tenantId            String @map("tenant_id") @db.Uuid
  planId              String? @map("plan_id") @db.Uuid
  subscriptionId      String? @map("subscription_id") @db.Uuid
  provider            String @db.VarChar(32)
  providerPaymentId   String? @map("provider_payment_id") @db.VarChar(255)
  providerCheckoutId  String? @map("provider_checkout_id") @db.VarChar(255)
  providerSessionId   String? @map("provider_session_id") @db.VarChar(255)
  providerInvoiceId   String? @map("provider_invoice_id") @db.VarChar(255)
  providerReference   Json? @map("provider_reference")
  orderId             String? @map("order_id") @db.VarChar(255)
  status              String @default("CREATED") @db.VarChar(32)
  amount              String @default("0") @db.VarChar(32)
  currency            String @default("USD") @db.VarChar(3)
  refundedAmount      String @default("0") @map("refunded_amount") @db.VarChar(32)
  failureReason       String? @map("failure_reason") @db.VarChar(1000)
  failureCode         String? @map("failure_code") @db.VarChar(64)
  idempotencyKey      String @map("idempotency_key") @db.VarChar(255)
  metadata            Json @default("{}")
  paidAt              DateTime? @map("paid_at") @db.Timestamptz(6)
  failedAt            DateTime? @map("failed_at") @db.Timestamptz(6)
  cancelledAt         DateTime? @map("cancelled_at") @db.Timestamptz(6)
  refundedAt          DateTime? @map("refunded_at") @db.Timestamptz(6)
  createdAt           DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt           DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  @@index([tenantId, status, createdAt])
  @@index([tenantId, provider])
  @@map("payments")
  @@unique([tenantId, idempotencyKey])
}

model Refund {
  id               String @id @default(uuid()) @db.Uuid
  tenantId         String @map("tenant_id") @db.Uuid
  paymentId        String @map("payment_id") @db.Uuid
  invoiceId        String? @map("invoice_id") @db.Uuid
  refundType       String @map("refund_type") @db.VarChar(32)
  reason           String @db.VarChar(64)
  reasonDetails    String? @map("reason_details") @db.VarChar(500)
  amount           String @db.VarChar(32)
  currency         String @db.VarChar(3)
  status           String @default("PENDING") @db.VarChar(32)
  provider         String @db.VarChar(32)
  providerRefundId String? @map("provider_refund_id") @db.VarChar(255)
  providerStatus   String? @map("provider_status") @db.VarChar(64)
  idempotencyKey   String @map("idempotency_key") @db.VarChar(255)
  failureReason    String? @map("failure_reason") @db.VarChar(1000)
  failureCode      String? @map("failure_code") @db.VarChar(64)
  requestedBy      String? @map("requested_by") @db.Uuid
  requestedAt      DateTime @default(now()) @map("requested_at") @db.Timestamptz(6)
  processedAt      DateTime? @map("processed_at") @db.Timestamptz(6)
  succeededAt      DateTime? @map("succeeded_at") @db.Timestamptz(6)
  failedAt         DateTime? @map("failed_at") @db.Timestamptz(6)
  metadata         Json @default("{}")
  createdAt        DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt        DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  @@index([tenantId, paymentId])
  @@index([tenantId, status])
  @@map("refunds")
  @@unique([tenantId, idempotencyKey])
}

model DunningCase {
  id               String @id @default(uuid()) @db.Uuid
  tenantId         String @map("tenant_id") @db.Uuid
  paymentId        String @map("payment_id") @db.Uuid
  subscriptionId   String? @map("subscription_id") @db.Uuid
  trigger          String @db.VarChar(64)
  status           String @default("ACTIVE") @db.VarChar(32)
  attempt          Int @default(0)
  maxAttempts      Int @default(4) @map("max_attempts")
  gracePeriodEndsAt DateTime? @map("grace_period_ends_at") @db.Timestamptz(6)
  nextRetryAt      DateTime? @map("next_retry_at") @db.Timestamptz(6)
  lastAttemptAt    DateTime? @map("last_attempt_at") @db.Timestamptz(6)
  lastError        String? @map("last_error") @db.VarChar(1000)
  lastErrorCode    String? @map("last_error_code") @db.VarChar(64)
  actionTaken      String @default("NONE") @map("action_taken") @db.VarChar(32)
  suspendedAt      DateTime? @map("suspended_at") @db.Timestamptz(6)
  recoveredAt      DateTime? @map("recovered_at") @db.Timestamptz(6)
  failedAt         DateTime? @map("failed_at") @db.Timestamptz(6)
  canceledAt       DateTime? @map("canceled_at") @db.Timestamptz(6)
  resolvedAt       DateTime? @map("resolved_at") @db.Timestamptz(6)
  metadata         Json @default("{}")
  createdAt        DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt        DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  @@index([tenantId, status])
  @@index([tenantId, paymentId])
  @@index([status, nextRetryAt])
  @@map("dunning_cases")
}

model FeeAccrual {
  id               String @id @default(uuid()) @db.Uuid
  tenantId         String @map("tenant_id") @db.Uuid
  feeType          String @map("fee_type") @db.VarChar(32)
  feeSourceType    String @map("fee_source_type") @db.VarChar(32)
  sourceId         String @map("source_id") @db.VarChar(255)
  sourceAmount     String @map("source_amount") @db.VarChar(32)
  feeAmount        String @map("fee_amount") @db.VarChar(32)
  currency         String @db.VarChar(3)
  rateBps          Int? @map("rate_bps")
  rateReference    String? @map("rate_reference") @db.VarChar(255)
  status           String @default("ACCRUED") @db.VarChar(32)
  settlementState  String @default("DRAFT") @map("settlement_state") @db.VarChar(32)
  settlementId     String? @map("settlement_id") @db.Uuid
  settlementTimestamp DateTime? @map("settlement_timestamp") @db.Timestamptz(6)
  idempotencyKey   String @map("idempotency_key") @db.VarChar(255)
  metadata         Json @default("{}")
  safeMetadata     Json @default("{}") @map("safe_metadata")
  createdAt        DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt        DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  @@index([tenantId, feeType, status])
  @@index([tenantId, settlementState])
  @@index([settlementId])
  @@map("fee_accruals")
  @@unique([tenantId, idempotencyKey])
}

model FeeSettlement {
  id                    String @id @default(uuid()) @db.Uuid
  tenantId              String @map("tenant_id") @db.Uuid
  currency              String @db.VarChar(3)
  grossFeeAmount        String @map("gross_fee_amount") @db.VarChar(32)
  adjustments           String @default("0") @db.VarChar(32)
  finalSettlementAmount String @map("final_settlement_amount") @db.VarChar(32)
  numberOfAccruals      Int @map("number_of_accruals")
  feeType               String @map("fee_type") @db.VarChar(32)
  status                String @default("DRAFT") @db.VarChar(32)
  idempotencyKey        String @map("idempotency_key") @db.VarChar(255)
  accrualIds            String[] @map("accrual_ids")
  approvedAt            DateTime? @map("approved_at") @db.Timestamptz(6)
  finalizedAt           DateTime? @map("finalized_at") @db.Timestamptz(6)
  paidAt                DateTime? @map("paid_at") @db.Timestamptz(6)
  metadata              Json @default("{}")
  createdAt             DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt             DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  @@index([tenantId, status])
  @@map("fee_settlements")
  @@unique([tenantId, idempotencyKey])
}

model Payout {
  id                String @id @default(uuid()) @db.Uuid
  settlementId      String @map("settlement_id") @db.Uuid
  beneficiaryId     String @map("beneficiary_id") @db.VarChar(255)
  beneficiaryType   String @map("beneficiary_type") @db.VarChar(32)
  tenantId          String @map("tenant_id") @db.Uuid
  amount            String @db.VarChar(32)
  currency          String @db.VarChar(3)
  destination       Json @default("{}")
  provider          String @db.VarChar(32)
  providerPayoutId  String? @map("provider_payout_id") @db.VarChar(255)
  providerReference String? @map("provider_reference") @db.VarChar(255)
  status            String @default("CREATED") @db.VarChar(32)
  failureReason     String? @map("failure_reason") @db.VarChar(1000)
  idempotencyKey    String @map("idempotency_key") @db.VarChar(255)
  metadata          Json @default("{}")
  safeMetadata      Json @default("{}") @map("safe_metadata")
  processedAt       DateTime? @map("processed_at") @db.Timestamptz(6)
  succeededAt       DateTime? @map("succeeded_at") @db.Timestamptz(6)
  failedAt          DateTime? @map("failed_at") @db.Timestamptz(6)
  cancelledAt       DateTime? @map("cancelled_at") @db.Timestamptz(6)
  createdAt         DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt         DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  @@index([tenantId, status])
  @@index([settlementId])
  @@map("payouts")
  @@unique([tenantId, idempotencyKey])
}

model UsageMeter {
  id            String @id @default(uuid()) @db.Uuid
  tenantId      String @map("tenant_id") @db.Uuid
  meterKey      String @map("meter_key") @db.VarChar(64)
  limitKey      String @map("limit_key") @db.VarChar(64)
  periodId      String @map("period_id") @db.VarChar(255)
  periodStart   DateTime @map("period_start") @db.Timestamptz(6)
  periodEnd     DateTime @map("period_end") @db.Timestamptz(6)
  currentValue  Int @default(0) @map("current_value")
  maxValue      Int? @map("max_value")
  unit          String @db.VarChar(32)
  metadata      Json @default("{}")
  createdAt     DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt     DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  @@unique([tenantId, meterKey, periodId])
  @@index([tenantId, meterKey])
  @@map("usage_meters")
}

model UsageEvent {
  id             String @id @default(uuid()) @db.Uuid
  tenantId       String @map("tenant_id") @db.Uuid
  meterKey       String @map("meter_key") @db.VarChar(64)
  eventType      String @map("event_type") @db.VarChar(64)
  sourceId       String @map("source_id") @db.VarChar(255)
  sourceType     String @map("source_type") @db.VarChar(64)
  quantity       Int @default(1)
  periodId       String @map("period_id") @db.VarChar(255)
  idempotencyKey String @map("idempotency_key") @db.VarChar(255)
  status         String @default("RECEIVED") @db.VarChar(32)
  metadata       Json @default("{}")
  safeMetadata   Json @default("{}") @map("safe_metadata")
  createdAt      DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  @@index([tenantId, meterKey, periodId])
  @@index([tenantId, sourceId])
  @@map("usage_events")
  @@unique([tenantId, idempotencyKey])
}

model UsageAlertConfig {
  id              String @id @default(uuid()) @db.Uuid
  tenantId        String @map("tenant_id") @db.Uuid
  meterKey        String @map("meter_key") @db.VarChar(64)
  limitKey        String @map("limit_key") @db.VarChar(64)
  thresholdType   String @map("threshold_type") @db.VarChar(32)
  thresholdValue  Int @map("threshold_value")
  severity        String @db.VarChar(32)
  enabled         Boolean @default(true)
  cooldownMinutes Int @default(60) @map("cooldown_minutes")
  lastTriggeredAt DateTime? @map("last_triggered_at") @db.Timestamptz(6)
  createdAt       DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt       DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  @@index([tenantId, meterKey])
  @@map("usage_alert_configs")
}

model UsageAlertEvent {
  id               String @id @default(uuid()) @db.Uuid
  tenantId         String @map("tenant_id") @db.Uuid
  configId         String @map("config_id") @db.Uuid
  meterKey         String @map("meter_key") @db.VarChar(64)
  limitKey         String @map("limit_key") @db.VarChar(64)
  thresholdType    String @map("threshold_type") @db.VarChar(32)
  thresholdValue   Int @map("threshold_value")
  currentValue     Int @map("current_value")
  maximumValue     Int? @map("maximum_value")
  utilizationPercent Int? @map("utilization_percent")
  severity         String @db.VarChar(32)
  state            String @default("TRIGGERED") @db.VarChar(32)
  periodId         String @map("period_id") @db.VarChar(255)
  triggeredAt      DateTime @default(now()) @map("triggered_at") @db.Timestamptz(6)
  acknowledgedAt   DateTime? @map("acknowledged_at") @db.Timestamptz(6)
  resolvedAt       DateTime? @map("resolved_at") @db.Timestamptz(6)
  deliveryState    String @default("PENDING") @map("delivery_state") @db.VarChar(32)
  idempotencyKey   String @map("idempotency_key") @db.VarChar(255)
  safeMetadata     Json? @map("safe_metadata")
  createdAt        DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  @@index([tenantId, meterKey, triggeredAt])
  @@map("usage_alert_events")
  @@unique([tenantId, idempotencyKey])
}

model OverageRecord {
  id                   String @id @default(uuid()) @db.Uuid
  tenantId             String @map("tenant_id") @db.Uuid
  meterKey             String @map("meter_key") @db.VarChar(64)
  limitKey             String @map("limit_key") @db.VarChar(64)
  periodId             String @map("period_id") @db.VarChar(255)
  periodStart          DateTime @map("period_start") @db.Timestamptz(6)
  periodEnd            DateTime @map("period_end") @db.Timestamptz(6)
  allowedQuantity      Int @map("allowed_quantity")
  actualQuantity       Int @map("actual_quantity")
  excessQuantity       Int @map("excess_quantity")
  unit                 String @db.VarChar(32)
  policyReference      String? @map("policy_reference") @db.VarChar(255)
  rateReference        String? @map("rate_reference") @db.VarChar(255)
  rateBps              Int? @map("rate_bps")
  estimatedAmount      String? @map("estimated_amount") @db.VarChar(32)
  currency             String? @db.VarChar(3)
  status               String @default("DETECTED") @db.VarChar(32)
  idempotencyKey       String @map("idempotency_key") @db.VarChar(255)
  calculationTimestamp DateTime @default(now()) @map("calculation_timestamp") @db.Timestamptz(6)
  metadata             Json @default("{}")
  createdAt            DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt            DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  @@index([tenantId, meterKey, periodId])
  @@index([tenantId, status])
  @@map("overage_records")
  @@unique([tenantId, idempotencyKey])
}

// =============================================================================
// PART 11 - Enterprise Security, KYC/AML, Risk Controls, Compliance Cases
// =============================================================================

enum ComplianceKycState {
  NOT_STARTED
  PENDING
  IN_REVIEW
  VERIFIED
  REJECTED
  EXPIRED
  REQUIRES_REVERIFICATION
}

enum ComplianceAmlState {
  NOT_SCREENED
  CLEAR
  POTENTIAL_MATCH
  MATCH
  REVIEW_REQUIRED
  BLOCKED
  PROVIDER_UNAVAILABLE
}

enum ComplianceRiskLevel {
  LOW
  MEDIUM
  HIGH
  CRITICAL
  UNKNOWN
}

enum ComplianceDecision {
  ALLOW
  PENDING
  REVIEW_REQUIRED
  RESTRICT
  BLOCK
}

enum ComplianceCaseState {
  OPEN
  IN_REVIEW
  ESCALATED
  RESOLVED
  REJECTED
  CLOSED
}

enum ComplianceCaseType {
  KYC_VERIFICATION
  AML_SCREENING
  SANCTIONS
  PEP
  TRANSACTION_REVIEW
  ACCOUNT_RISK
  MANUAL_REVIEW
  ENHANCED_DUE_DILIGENCE
}

enum ComplianceReviewAction {
  ASSIGN
  ESCALATE
  APPROVE
  REJECT
  REQUEST_EDD
  REQUEST_REVERIFICATION
  REQUEST_HOLD
  REQUEST_RELEASE
  ADD_EVIDENCE
  ADD_NOTE
  RESOLVE
  CLOSE
}

model ComplianceScreeningRequest {
  id             String @id @default(uuid()) @db.Uuid
  tenantId       String @map("tenant_id") @db.Uuid
  userId         String @map("user_id") @db.Uuid
  type           String @db.VarChar(32) // KYC, AML, SANCTIONS, PEP, TRANSACTION
  provider       String? @db.VarChar(64)
  providerRef    String? @map("provider_ref") @db.VarChar(255)
  status         String @default("PENDING") @db.VarChar(32)
  kycState       ComplianceKycState? @map("kyc_state")
  amlState       ComplianceAmlState? @map("aml_state")
  decision       ComplianceDecision?
  riskLevel      ComplianceRiskLevel? @map("risk_level")
  idempotencyKey String @map("idempotency_key") @db.VarChar(255)
  safeMetadata   Json @default("{}") @map("safe_metadata")
  failureReason  String? @map("failure_reason") @db.VarChar(1000)
  createdAt      DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt      DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)
  expiresAt      DateTime? @map("expires_at") @db.Timestamptz(6)

  @@index([tenantId, userId, type])
  @@index([tenantId, status])
  @@index([idempotencyKey])
  @@map("compliance_screening_requests")
  @@unique([tenantId, idempotencyKey])
}

model ComplianceCase {
  id             String @id @default(uuid()) @db.Uuid
  tenantId       String @map("tenant_id") @db.Uuid
  userId         String @map("user_id") @db.Uuid
  caseType       ComplianceCaseType @map("case_type")
  state          ComplianceCaseState @default(OPEN)
  severity       String @default("MEDIUM") @db.VarChar(16)
  riskLevel      ComplianceRiskLevel @default(UNKNOWN) @map("risk_level")
  decision       ComplianceDecision?
  assignedTo     String? @map("assigned_to") @db.Uuid
  assignedAt     DateTime? @map("assigned_at") @db.Timestamptz(6)
  escalatedAt    DateTime? @map("escalated_at") @db.Timestamptz(6)
  resolvedAt     DateTime? @map("resolved_at") @db.Timestamptz(6)
  closedAt       DateTime? @map("closed_at") @db.Timestamptz(6)
  idempotencyKey String @map("idempotency_key") @db.VarChar(255)
  safeSummary    String @map("safe_summary") @db.VarChar(1000)
  jurisdiction   String? @db.VarChar(16)
  policyVersion  String? @map("policy_version") @db.VarChar(32)
  ruleIds        String[] @default([]) @map("rule_ids")
  sourceRefs     Json @default("[]") @map("source_refs")
  metadata       Json @default("{}")
  createdAt      DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt      DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  reviews        ComplianceReview[]
  evidences      ComplianceEvidence[]
  auditLogs      ComplianceAuditLog[]

  @@index([tenantId, state, createdAt])
  @@index([tenantId, userId])
  @@index([assignedTo, state])
  @@index([caseType, state])
  @@map("compliance_cases")
  @@unique([tenantId, idempotencyKey])
}

model ComplianceReview {
  id          String @id @default(uuid()) @db.Uuid
  caseId      String @map("case_id") @db.Uuid
  tenantId    String @map("tenant_id") @db.Uuid
  reviewerId  String @map("reviewer_id") @db.Uuid
  action      ComplianceReviewAction
  fromState   ComplianceCaseState? @map("from_state")
  toState     ComplianceCaseState? @map("to_state")
  decision    ComplianceDecision?
  reason      String @db.VarChar(1000)
  safeNote    String? @map("safe_note") @db.VarChar(2000)
  createdAt   DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  caseRecord  ComplianceCase @relation(fields: [caseId], references: [id], onDelete: Cascade)

  @@index([caseId, createdAt])
  @@index([tenantId, reviewerId])
  @@map("compliance_reviews")
}

model ComplianceEvidence {
  id          String @id @default(uuid()) @db.Uuid
  caseId      String @map("case_id") @db.Uuid
  tenantId    String @map("tenant_id") @db.Uuid
  evidenceType String @map("evidence_type") @db.VarChar(64)
  referenceId String @map("reference_id") @db.VarChar(255)
  referenceType String @map("reference_type") @db.VarChar(64)
  safeDescription String? @map("safe_description") @db.VarChar(1000)
  addedBy     String @map("added_by") @db.Uuid
  createdAt   DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  caseRecord  ComplianceCase @relation(fields: [caseId], references: [id], onDelete: Cascade)

  @@index([caseId, evidenceType])
  @@index([tenantId, referenceType, referenceId])
  @@map("compliance_evidences")
}

model ComplianceAuditLog {
  id          String @id @default(uuid()) @db.Uuid
  tenantId    String @map("tenant_id") @db.Uuid
  caseId      String? @map("case_id") @db.Uuid
  userId      String? @map("user_id") @db.Uuid
  action      String @db.VarChar(64)
  actorId     String? @map("actor_id") @db.Uuid
  actorType   String @default("USER") @map("actor_type") @db.VarChar(16)
  outcome     String @default("SUCCESS") @db.VarChar(16)
  safeMetadata Json @default("{}") @map("safe_metadata")
  ipHash      String? @map("ip_hash") @db.VarChar(64)
  requestId   String? @map("request_id") @db.VarChar(64)
  createdAt   DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  caseRecord  ComplianceCase? @relation(fields: [caseId], references: [id], onDelete: SetNull)

  @@index([tenantId, action, createdAt])
  @@index([caseId, createdAt])
  @@map("compliance_audit_logs")
}

model RiskScoreRecord {
  id             String @id @default(uuid()) @db.Uuid
  tenantId       String @map("tenant_id") @db.Uuid
  userId         String @map("user_id") @db.Uuid
  score          Int
  riskLevel      ComplianceRiskLevel @map("risk_level")
  ruleIds        String[] @default([]) @map("rule_ids")
  policyVersion  String @map("policy_version") @db.VarChar(32)
  contributingFactors Json @default("[]") @map("contributing_factors")
  idempotencyKey String @map("idempotency_key") @db.VarChar(255)
  calculatedAt   DateTime @default(now()) @map("calculated_at") @db.Timestamptz(6)
  expiresAt      DateTime? @map("expires_at") @db.Timestamptz(6)
  createdAt      DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  @@index([tenantId, userId, calculatedAt])
  @@index([tenantId, riskLevel])
  @@map("risk_score_records")
  @@unique([tenantId, idempotencyKey])
}

model TransactionMonitoringSignal {
  id             String @id @default(uuid()) @db.Uuid
  tenantId       String @map("tenant_id") @db.Uuid
  userId         String? @map("user_id") @db.Uuid
  sourceType     String @map("source_type") @db.VarChar(64)
  sourceId       String @map("source_id") @db.VarChar(255)
  ruleId         String @map("rule_id") @db.VarChar(64)
  riskLevel      ComplianceRiskLevel @map("risk_level")
  decision       ComplianceDecision @default(PENDING)
  safeSummary    String @map("safe_summary") @db.VarChar(1000)
  idempotencyKey String @map("idempotency_key") @db.VarChar(255)
  caseId         String? @map("case_id") @db.Uuid
  resolved       Boolean @default(false)
  resolvedAt     DateTime? @map("resolved_at") @db.Timestamptz(6)
  createdAt      DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  @@index([tenantId, sourceType, createdAt])
  @@index([tenantId, riskLevel, resolved])
  @@index([idempotencyKey])
  @@map("transaction_monitoring_signals")
  @@unique([tenantId, idempotencyKey])
}

model CompliancePolicyRecord {
  id               String @id @default(uuid()) @db.Uuid
  tenantId         String? @map("tenant_id") @db.Uuid
  jurisdiction     String @default("DEFAULT") @db.VarChar(16)
  policyVersion    String @map("policy_version") @db.VarChar(32)
  kycRequired      Boolean @default(true) @map("kyc_required")
  amlRequired      Boolean @default(true) @map("aml_required")
  sanctionsRequired Boolean @default(true) @map("sanctions_required")
  pepRequired      Boolean @default(false) @map("pep_required")
  eddRequired      Boolean @default(false) @map("edd_required")
  transactionThresholds Json @default("{}") @map("transaction_thresholds")
  riskThresholds   Json @default("{}") @map("risk_thresholds")
  highRiskCountries String[] @default([]) @map("high_risk_countries")
  blockedCountries String[] @default([]) @map("blocked_countries")
  reverificationIntervalDays Int @default(365) @map("reverification_interval_days")
  manualReviewRequired Boolean @default(false) @map("manual_review_required")
  rules            Json @default("[]")
  isActive         Boolean @default(true) @map("is_active")
  createdAt        DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt        DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  @@unique([tenantId, jurisdiction, policyVersion])
  @@index([tenantId, isActive])
  @@map("compliance_policy_records")
}

// ==================== Part 12 Enterprise IAM ====================

enum SsoProviderType {
  SAML
  OIDC
}

enum SsoProviderState {
  DISABLED
  ENABLED
  ENFORCED
}

enum SecurityAuthFactor {
  PASSWORD
  TOTP
  WEBAUTHN
  SAML
  OIDC
  RECOVERY
}

enum SecuritySessionState {
  ACTIVE
  EXPIRED
  REVOKED
  SUSPICIOUS
}

enum SecurityApiKeyState {
  ACTIVE
  EXPIRED
  REVOKED
  ROTATED
}

enum SecurityDeviceState {
  UNKNOWN
  PENDING_TRUST
  TRUSTED
  REVOKED
}

enum SecurityRiskLevel {
  LOW
  MEDIUM
  HIGH
  CRITICAL
}

enum SecurityDecision {
  ALLOW
  STEP_UP_REQUIRED
  DENY
  SUSPICIOUS
  REVIEW_REQUIRED
}

enum SecurityEventCategory {
  LOGIN_SUCCESS
  LOGIN_FAILURE
  LOGOUT
  MFA_REQUIRED
  MFA_SUCCESS
  MFA_FAILURE
  SSO_LOGIN_STARTED
  SSO_LOGIN_SUCCESS
  SSO_LOGIN_FAILURE
  API_KEY_CREATED
  API_KEY_ROTATED
  API_KEY_REVOKED
  SESSION_CREATED
  SESSION_REVOKED
  SESSION_SUSPICIOUS
  DEVICE_REGISTERED
  DEVICE_TRUSTED
  DEVICE_REVOKED
  SECURITY_POLICY_CHANGED
  PRIVILEGED_ACTION
  SECURITY_ALERT
}

model SsoConfiguration {
  id             String           @id @default(uuid()) @db.Uuid
  tenantId       String           @map("tenant_id") @db.Uuid
  providerType   SsoProviderType  @map("provider_type")
  state          SsoProviderState @default(DISABLED) @map("state")
  issuer         String?          @db.VarChar(512)
  audience       String?          @db.VarChar(512)
  clientId       String?          @map("client_id") @db.VarChar(512)
  metadataUrl    String?          @map("metadata_url") @db.VarChar(2048)
  entityId       String?          @map("entity_id") @db.VarChar(512)
  acsUrl         String?          @map("acs_url") @db.VarChar(2048)
  ssoUrl         String?          @map("sso_url") @db.VarChar(2048)
  certificate    String?          @db.Text
  allowedDomains String[]         @default([]) @map("allowed_domains")
  enforced       Boolean          @default(false)
  jitEnabled     Boolean          @default(false) @map("jit_enabled")
  defaultRole    String?          @map("default_role") @db.VarChar(64)
  discoveryUrl   String?          @map("discovery_url") @db.VarChar(2048)
  jwksUrl        String?          @map("jwks_url") @db.VarChar(2048)
  scopes         String[]         @default([])
  isActive       Boolean          @default(true) @map("is_active")
  createdById    String?          @map("created_by_id") @db.Uuid
  createdAt      DateTime         @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt      DateTime         @updatedAt @map("updated_at") @db.Timestamptz(6)

  /// OIDC: envelope-encrypted client secret ({ciphertext, iv, authTag, wrappedKey, keyId}),
  /// bound to the tenant and provider by AAD. Write-only: never returned by any API.
  clientSecretCiphertext  Json?    @map("client_secret_ciphertext")
  /// OIDC token-endpoint client authentication: client_secret_basic | client_secret_post |
  /// none (public client; PKCE is then mandatory).
  tokenEndpointAuthMethod String   @default("client_secret_basic") @map("token_endpoint_auth_method") @db.VarChar(32)
  /// The exact redirect URI registered at the IdP. The only redirect URI ever sent to the IdP or
  /// used at code redemption; never taken from a request.
  redirectUri             String?  @map("redirect_uri") @db.VarChar(2048)
  pkceRequired            Boolean  @default(true) @map("pkce_required")
  /// Clock skew tolerated on token / assertion time claims (seconds, capped in code at 300).
  clockSkewSec            Int      @default(60) @map("clock_skew_sec")
  /// OIDC: when set, max_age is sent and auth_time must be within it.
  maxAuthAgeSec           Int?     @map("max_auth_age_sec")
  /// OIDC: accepted ID-token signature algorithms (asymmetric only; empty = RS/PS/ES 256-512).
  allowedAlgorithms       String[] @default([]) @map("allowed_algorithms")
  /// SAML: additionally require a signature over the whole Response (the assertion signature is
  /// always required).
  wantResponseSigned      Boolean  @default(false) @map("want_response_signed")
  /// SAML (round 7, opt-in): require the IdP to encrypt the assertion to spEncryptionCertificate.
  /// A plaintext assertion is then refused; the decrypted assertion must still be signed.
  wantAssertionsEncrypted Boolean  @default(false) @map("want_assertions_encrypted")
  /// SAML: the service provider's RSA decryption key (PEM), envelope-encrypted with AAD bound to
  /// the tenant ({ciphertext, iv, authTag, wrappedKey, keyId}). Write-only: never returned.
  spDecryptionKeyCiphertext Json?  @map("sp_decryption_key_ciphertext")
  /// SAML: the certificate of that key, given to the IdP as the SP encryption certificate. Public.
  spEncryptionCertificate String?  @map("sp_encryption_certificate") @db.Text
  /// SAML Single Logout (round 8): the IdP's SingleLogoutService endpoint (HTTP-Redirect binding).
  /// Signed LogoutRequests (SP-initiated) and LogoutResponses (to IdP-initiated logout) go here.
  sloUrl                  String?  @map("slo_url") @db.VarChar(2048)
  /// SAML Single Logout: OUR SingleLogoutService URL (…/v1/auth/sso/saml/slo on the tenant host),
  /// registered at the IdP. The Destination of every logout message the IdP sends must equal it.
  logoutCallbackUrl       String?  @map("logout_callback_url") @db.VarChar(2048)
  /// SAML Single Logout: the SP's RSA signing key (PEM), envelope-encrypted with AAD bound to the
  /// tenant ({ciphertext, iv, authTag, wrappedKey, keyId}). Write-only: never returned.
  spSigningKeyCiphertext  Json?    @map("sp_signing_key_ciphertext")
  /// SAML Single Logout: the certificate of that key, given to the IdP to verify our logout
  /// messages. Public.
  spSigningCertificate    String?  @map("sp_signing_certificate") @db.Text

  tenant           Tenant               @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  authTransactions SsoAuthTransaction[]
  identities       SsoIdentity[]

  @@unique([tenantId, providerType])
  @@index([tenantId, state])
  @@map("sso_configurations")
}

model EnterpriseApiKey {
  id             String              @id @default(uuid()) @db.Uuid
  tenantId       String              @map("tenant_id") @db.Uuid
  userId         String              @map("user_id") @db.Uuid
  name           String              @db.VarChar(120)
  keyId          String              @unique @map("key_id") @db.VarChar(48)
  secretHash     String              @map("secret_hash") @db.VarChar(255)
  fingerprint    String              @unique @db.VarChar(128)
  scopes         String[]            @default([])
  state          SecurityApiKeyState @default(ACTIVE)
  ipAllowlist    String[]            @default([]) @map("ip_allowlist")
  expiresAt      DateTime?           @map("expires_at") @db.Timestamptz(6)
  lastUsedAt     DateTime?           @map("last_used_at") @db.Timestamptz(6)
  revokedAt      DateTime?           @map("revoked_at") @db.Timestamptz(6)
  rotatedAt      DateTime?           @map("rotated_at") @db.Timestamptz(6)
  rotatedFromId  String?             @map("rotated_from_id") @db.Uuid
  createdById    String?             @map("created_by_id") @db.Uuid
  createdAt      DateTime            @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt      DateTime            @updatedAt @map("updated_at") @db.Timestamptz(6)
  idempotencyKey String?             @map("idempotency_key") @db.VarChar(255)

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([tenantId, userId, state])
  @@index([tenantId, state])
  @@index([fingerprint])
  @@map("enterprise_api_keys")
  @@unique([tenantId, idempotencyKey])
}

model SecurityPolicy {
  id                        String   @id @default(uuid()) @db.Uuid
  tenantId                  String?  @unique @map("tenant_id") @db.Uuid
  policyVersion             String   @map("policy_version") @db.VarChar(32)
  mfaRequired               Boolean  @default(false) @map("mfa_required")
  mfaForPrivilegedRoles     Boolean  @default(true) @map("mfa_for_privileged_roles")
  mfaForSensitiveOperations Boolean  @default(true) @map("mfa_for_sensitive_ops")
  sessionAbsoluteTimeoutSec Int      @default(86400) @map("session_absolute_timeout_sec")
  sessionIdleTimeoutSec     Int      @default(1800) @map("session_idle_timeout_sec")
  maxConcurrentSessions     Int      @default(5) @map("max_concurrent_sessions")
  deviceTrustDurationDays   Int      @default(30) @map("device_trust_duration_days")
  apiKeyExpirationDays      Int      @default(90) @map("api_key_expiration_days")
  apiKeyRotationDays        Int      @default(30) @map("api_key_rotation_days")
  ssoEnforced               Boolean  @default(false) @map("sso_enforced")
  allowedSsoDomains         String[] @default([]) @map("allowed_sso_domains")
  jitProvisioning           Boolean  @default(false) @map("jit_provisioning")
  privilegedReauthRequired  Boolean  @default(true) @map("privileged_reauth_required")
  securityNotifications     Boolean  @default(true) @map("security_notifications")
  passwordMinLength         Int      @default(12) @map("password_min_length")
  isActive                  Boolean  @default(true) @map("is_active")
  createdAt                 DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt                 DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant Tenant? @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@map("security_policies")
}

model DeviceTrust {
  id           String              @id @default(uuid()) @db.Uuid
  tenantId     String              @map("tenant_id") @db.Uuid
  userId       String              @map("user_id") @db.Uuid
  deviceId     String              @map("device_id") @db.VarChar(128)
  deviceHash   String              @map("device_hash") @db.VarChar(128)
  state        SecurityDeviceState @default(UNKNOWN)
  trustedAt    DateTime?           @map("trusted_at") @db.Timestamptz(6)
  expiresAt    DateTime?           @map("expires_at") @db.Timestamptz(6)
  lastSeenAt   DateTime            @default(now()) @map("last_seen_at") @db.Timestamptz(6)
  revokedAt    DateTime?           @map("revoked_at") @db.Timestamptz(6)
  ipHash       String?             @map("ip_hash") @db.VarChar(64)
  userAgentHash String?            @map("user_agent_hash") @db.VarChar(128)
  metadata     Json                @default("{}")
  createdAt    DateTime            @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt    DateTime            @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([tenantId, userId, deviceHash])
  @@index([tenantId, userId, state])
  @@index([deviceId])
  @@map("device_trusts")
}

model SecurityAuditLog {
  id            String                @id @default(uuid()) @db.Uuid
  tenantId      String                @map("tenant_id") @db.Uuid
  userId        String?               @map("user_id") @db.Uuid
  actorId       String?               @map("actor_id") @db.Uuid
  actorType     String                @default("USER") @map("actor_type") @db.VarChar(32)
  event         SecurityEventCategory
  result        String                @default("SUCCESS") @db.VarChar(32)
  policyVersion String?               @map("policy_version") @db.VarChar(32)
  targetType    String?               @map("target_type") @db.VarChar(64)
  targetId      String?               @map("target_id") @db.VarChar(128)
  safeMetadata  Json                  @default("{}") @map("safe_metadata")
  ipHash        String?               @map("ip_hash") @db.VarChar(64)
  requestId     String?               @map("request_id") @db.VarChar(64)
  createdAt     DateTime              @default(now()) @map("created_at") @db.Timestamptz(6)

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@index([tenantId, event, createdAt])
  @@index([tenantId, userId])
  @@index([actorId])
  @@map("security_audit_logs")
}

model SecurityThreatSignal {
  id            String            @id @default(uuid()) @db.Uuid
  tenantId      String            @map("tenant_id") @db.Uuid
  userId        String?           @map("user_id") @db.Uuid
  ruleId        String            @map("rule_id") @db.VarChar(64)
  riskLevel     SecurityRiskLevel @map("risk_level")
  decision      SecurityDecision  @default(REVIEW_REQUIRED)
  sourceEventIds String[]         @default([]) @map("source_event_ids")
  safeSummary   String            @map("safe_summary") @db.VarChar(1000)
  policyVersion String?           @map("policy_version") @db.VarChar(32)
  resolved      Boolean           @default(false)
  resolvedAt    DateTime?         @map("resolved_at") @db.Timestamptz(6)
  resolvedById  String?           @map("resolved_by_id") @db.Uuid
  createdAt     DateTime          @default(now()) @map("created_at") @db.Timestamptz(6)

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@index([tenantId, riskLevel, createdAt])
  @@index([tenantId, userId])
  @@map("security_threat_signals")
}

model SsoLoginAttempt {
  id            String   @id @default(uuid()) @db.Uuid
  tenantId      String   @map("tenant_id") @db.Uuid
  providerType  SsoProviderType @map("provider_type")
  state         String   @db.VarChar(128)
  nonce         String?  @db.VarChar(128)
  email         String?  @db.VarChar(254)
  ipHash        String?  @map("ip_hash") @db.VarChar(64)
  success       Boolean  @default(false)
  failureReason String?  @map("failure_reason") @db.VarChar(500)
  createdAt     DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  expiresAt     DateTime @map("expires_at") @db.Timestamptz(6)

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@index([tenantId, providerType, createdAt])
  @@index([state])
  @@map("sso_login_attempts")
}

/// One server-side SSO login transaction (OIDC authorization-code flow or SAML AuthnRequest).
/// Holds hashes only for state, nonce, binding secret and SAML hand-off code; the PKCE verifier,
/// which must be sent verbatim at code redemption, is envelope-encrypted. Consumed exactly once.
model SsoAuthTransaction {
  id                     String          @id @default(uuid()) @db.Uuid
  tenantId               String          @map("tenant_id") @db.Uuid
  configurationId        String          @map("configuration_id") @db.Uuid
  providerType           SsoProviderType @map("provider_type")
  /// SHA-256 of the state / RelayState sent to the IdP.
  stateHash              String          @unique @map("state_hash") @db.VarChar(64)
  /// OIDC: SHA-256 of the nonce; compared with the ID token's nonce claim.
  nonceHash              String?         @map("nonce_hash") @db.VarChar(64)
  /// OIDC: envelope-encrypted PKCE code_verifier.
  pkceVerifierCiphertext Json?           @map("pkce_verifier_ciphertext")
  /// Keyed hash of the binding secret held only by the client that started the login.
  bindingHash            String          @map("binding_hash") @db.VarChar(128)
  deviceId               String          @map("device_id") @db.VarChar(128)
  /// Redirect URI copied from configuration at start; code redemption reuses exactly this value.
  redirectUri            String          @map("redirect_uri") @db.VarChar(2048)
  /// App-relative path to return to after login (validated; never an absolute URL).
  returnTo               String?         @map("return_to") @db.VarChar(512)
  /// SAML: the AuthnRequest ID; the Response must carry it as InResponseTo.
  samlRequestId          String?         @unique @map("saml_request_id") @db.VarChar(128)
  /// PENDING -> (SAML only) VERIFIED -> CONSUMED, or REJECTED. A SAML Single Logout round trip
  /// is a LOGOUT_PENDING -> CONSUMED transaction (samlRequestId = the LogoutRequest ID); login
  /// completion only ever accepts PENDING / VERIFIED, so a logout row can never become a login.
  status                 String          @default("PENDING") @db.VarChar(16)
  /// SAML: user verified at the ACS, waiting for the starting client to complete.
  verifiedUserId         String?         @map("verified_user_id") @db.Uuid
  /// SAML: SHA-256 of the one-time hand-off code returned to the client after the ACS.
  handoffHash            String?         @unique @map("handoff_hash") @db.VarChar(64)
  /// SAML (round 8): what Single Logout needs from the verified assertion, carried from the ACS to
  /// session issuance: {context: sealed {nameID, nameIDFormat, nameQualifier, spNameQualifier,
  /// sessionIndex} (AAD bound to tenant + configuration), subjectHash, sessionIndexHash}.
  samlLogoutContext      Json?           @map("saml_logout_context")
  correlationId          String          @map("correlation_id") @db.Uuid
  ipHash                 String?         @map("ip_hash") @db.VarChar(64)
  failureReason          String?         @map("failure_reason") @db.VarChar(64)
  expiresAt              DateTime        @map("expires_at") @db.Timestamptz(6)
  verifiedAt             DateTime?       @map("verified_at") @db.Timestamptz(6)
  consumedAt             DateTime?       @map("consumed_at") @db.Timestamptz(6)
  createdAt              DateTime        @default(now()) @map("created_at") @db.Timestamptz(6)

  tenant        Tenant           @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  configuration SsoConfiguration @relation(fields: [configurationId], references: [id], onDelete: Cascade)

  @@index([tenantId, ipHash, status, expiresAt])
  @@index([expiresAt])
  @@map("sso_auth_transactions")
}

/// Link between a cryptographically verified IdP subject (issuer + sub / NameID) and a user.
/// The subject, not the email address, is the login key.
model SsoIdentity {
  id               String          @id @default(uuid()) @db.Uuid
  tenantId         String          @map("tenant_id") @db.Uuid
  userId           String          @map("user_id") @db.Uuid
  configurationId  String          @map("configuration_id") @db.Uuid
  providerType     SsoProviderType @map("provider_type")
  issuer           String          @db.VarChar(512)
  subject          String          @db.VarChar(512)
  /// Blind index of the email the IdP asserted when the link was created (no plaintext).
  emailIndexAtLink String?         @map("email_index_at_link") @db.VarChar(64)
  /// JIT (account created by SSO) or VERIFIED_EMAIL (existing account, IdP-verified email,
  /// allowed domain).
  linkedVia        String          @map("linked_via") @db.VarChar(32)
  createdAt        DateTime        @default(now()) @map("created_at") @db.Timestamptz(6)
  lastLoginAt      DateTime?       @map("last_login_at") @db.Timestamptz(6)

  tenant        Tenant           @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  user          User             @relation(fields: [userId], references: [id], onDelete: Cascade)
  configuration SsoConfiguration @relation(fields: [configurationId], references: [id], onDelete: Cascade)

  @@unique([tenantId, providerType, issuer, subject])
  @@unique([tenantId, configurationId, userId])
  @@index([tenantId, userId])
  @@map("sso_identities")
}

/// SAML assertion IDs already accepted, kept until the assertion would have expired anyway.
model SsoAssertionReplay {
  id          String   @id @default(uuid()) @db.Uuid
  tenantId    String   @map("tenant_id") @db.Uuid
  issuer      String   @db.VarChar(512)
  assertionId String   @map("assertion_id") @db.VarChar(256)
  expiresAt   DateTime @map("expires_at") @db.Timestamptz(6)
  createdAt   DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@unique([tenantId, issuer, assertionId])
  @@index([expiresAt])
  @@map("sso_assertion_replays")
}

/// Durable SSO audit trail. Never contains codes, tokens, assertions, nonces, PKCE verifiers,
/// session credentials or secrets.
model SsoAuditEvent {
  id              String           @id @default(uuid()) @db.Uuid
  tenantId        String           @map("tenant_id") @db.Uuid
  providerType    SsoProviderType? @map("provider_type")
  configurationId String?          @map("configuration_id") @db.Uuid
  transactionId   String?          @map("transaction_id") @db.Uuid
  userId          String?          @map("user_id") @db.Uuid
  correlationId   String           @map("correlation_id") @db.Uuid
  eventCode       String           @map("event_code") @db.VarChar(64)
  outcome         String           @db.VarChar(16)
  reasonCode      String?          @map("reason_code") @db.VarChar(64)
  ipHash          String?          @map("ip_hash") @db.VarChar(64)
  safeMetadata    Json             @default("{}") @map("safe_metadata")
  createdAt       DateTime         @default(now()) @map("created_at") @db.Timestamptz(6)

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@index([tenantId, createdAt])
  @@index([tenantId, eventCode, createdAt])
  @@index([correlationId])
  @@map("sso_audit_events")
}

// ==================== Part 14 Copy-Trading Core ====================

enum TraderVerificationState {
  UNVERIFIED
  PENDING
  VERIFIED
  REJECTED
  SUSPENDED
}

enum TraderStrategyStatus {
  DRAFT
  PENDING_VALIDATION
  VALIDATED
  PUBLISHED
  PAUSED
  ARCHIVED
  REJECTED
}

enum TraderStrategyType {
  MANUAL
  ALGORITHMIC
  COPY
  HYBRID
}

enum CopySubscriptionState {
  PENDING
  ACTIVE
  PAUSED
  STOPPED
  CANCELLED
  EXPIRED
}

enum CopyExecutionStatus {
  PENDING
  VALIDATED
  MAPPED
  RISK_CHECKED
  ROUTED
  SUBMITTED
  FILLED
  FAILED
  REJECTED
  SKIPPED
  BLOCKED
}

enum CopySizingMode {
  PROPORTIONAL
  FIXED
  PERCENTAGE_BALANCE
}

enum CopyRiskDecision {
  ALLOW
  REDUCE
  BLOCK
  PAUSE
  STOP_COPY
}

enum CopyReconciliationSeverity {
  LOW
  MEDIUM
  HIGH
  CRITICAL
}

enum CopyReconciliationCategory {
  MISSING_COPY
  DUPLICATE_COPY
  STALE_INTENT
  ORDER_MISMATCH
  QUANTITY_MISMATCH
  PRICE_MISMATCH
  STATUS_MISMATCH
  UNSUPPORTED_SYMBOL
  EXECUTION_AFTER_STOP
  EXECUTION_AFTER_RISK_BLOCK
  SLIPPAGE_EXCEEDED
}

model TraderProfile {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid
  userId   String @unique @map("user_id") @db.Uuid

  displayName String @map("display_name") @db.VarChar(80)
  bio         String? @db.VarChar(1000)
  avatarUrl   String? @map("avatar_url") @db.VarChar(512)

  verificationState TraderVerificationState @default(UNVERIFIED) @map("verification_state")
  verifiedAt        DateTime? @map("verified_at") @db.Timestamptz(6)
  verifiedById      String? @map("verified_by_id") @db.Uuid

  supportedVenues  String[] @default([]) @map("supported_venues")
  supportedSymbols String[] @default([]) @map("supported_symbols")

  riskProfile Json @default("{}") @map("risk_profile")

  isPublic         Boolean @default(false) @map("is_public")
  isFeatured       Boolean @default(false) @map("is_featured")
  followerCount    Int @default(0) @map("follower_count")
  totalVolume      String @default("0") @map("total_volume") @db.VarChar(64)
  totalTrades      Int @default(0) @map("total_trades")

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)
  deletedAt DateTime? @map("deleted_at") @db.Timestamptz(6)

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)

  strategies TraderStrategy[]
  subscriptions CopySubscription[] @relation("TraderSubscriptions")

  @@index([tenantId, verificationState])
  @@index([tenantId, isPublic])
  @@index([tenantId, followerCount])
  @@map("trader_profiles")
}

model TraderStrategy {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid
  traderId String @map("trader_id") @db.Uuid
  userId   String @map("user_id") @db.Uuid

  name        String @db.VarChar(120)
  description String? @db.VarChar(1000)

  status TraderStrategyStatus @default(DRAFT)
  type   TraderStrategyType   @default(MANUAL)

  supportedSymbols String[] @default([]) @map("supported_symbols")
  supportedVenues  String[] @default([]) @map("supported_venues")

  riskProfile Json @default("{}") @map("risk_profile")
  feePolicy   Json @default("{}") @map("fee_policy")

  strategyConfig Json @default("{}") @map("strategy_config")

  publishedAt DateTime? @map("published_at") @db.Timestamptz(6)
  pausedAt    DateTime? @map("paused_at") @db.Timestamptz(6)
  archivedAt  DateTime? @map("archived_at") @db.Timestamptz(6)

  validationErrors Json? @map("validation_errors")

  followerCount Int @default(0) @map("follower_count")
  totalCopies   Int @default(0) @map("total_copies")

  idempotencyKey String? @map("idempotency_key") @db.VarChar(255)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)
  deletedAt DateTime? @map("deleted_at") @db.Timestamptz(6)

  tenant Tenant        @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  trader TraderProfile @relation(fields: [traderId], references: [id], onDelete: Cascade)
  user   User          @relation(fields: [userId], references: [id], onDelete: Cascade)

  subscriptions CopySubscription[]

  @@unique([tenantId, traderId, name])
  @@index([tenantId, traderId, status])
  @@index([tenantId, status])
  @@map("trader_strategies")
  @@unique([tenantId, idempotencyKey])
}

model CopySubscription {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  followerId String @map("follower_id") @db.Uuid
  traderId   String @map("trader_id") @db.Uuid
  strategyId String @map("strategy_id") @db.Uuid

  state CopySubscriptionState @default(PENDING)

  allocationMode CopySizingMode @default(PROPORTIONAL) @map("allocation_mode")
  allocationAmount String @map("allocation_amount") @db.VarChar(64)
  maxAllocation    String? @map("max_allocation") @db.VarChar(64)
  minAllocation    String? @map("min_allocation") @db.VarChar(64)

  copyPolicy Json @default("{}") @map("copy_policy")
  riskPolicy Json @default("{}") @map("risk_policy")

  followerAccountId String? @map("follower_account_id") @db.Uuid

  startedAt DateTime? @map("started_at") @db.Timestamptz(6)
  pausedAt  DateTime? @map("paused_at") @db.Timestamptz(6)
  stoppedAt DateTime? @map("stopped_at") @db.Timestamptz(6)
  cancelledAt DateTime? @map("cancelled_at") @db.Timestamptz(6)
  expiresAt DateTime? @map("expires_at") @db.Timestamptz(6)

  totalCopiedVolume String @default("0") @map("total_copied_volume") @db.VarChar(64)
  totalCopies       Int @default(0) @map("total_copies")
  failedCopies      Int @default(0) @map("failed_copies")

  idempotencyKey String @map("idempotency_key") @db.VarChar(255)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant Tenant        @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  follower User        @relation("FollowerSubscriptions", fields: [followerId], references: [id], onDelete: Cascade)
  trader   TraderProfile @relation("TraderSubscriptions", fields: [traderId], references: [id], onDelete: Cascade)
  strategy TraderStrategy @relation(fields: [strategyId], references: [id], onDelete: Cascade)
  followerAccount TradingAccount? @relation(fields: [followerAccountId], references: [id], onDelete: SetNull)

  executions CopyExecution[]

  @@unique([tenantId, followerId, strategyId])
  @@index([tenantId, followerId, state])
  @@index([tenantId, traderId, state])
  @@index([tenantId, strategyId, state])
  @@index([followerAccountId])
  @@map("copy_subscriptions")
  @@unique([tenantId, idempotencyKey])
}

model CopyExecution {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  leaderEventId String @map("leader_event_id") @db.VarChar(128)
  leaderOrderId String? @map("leader_order_id") @db.Uuid
  leaderFillId  String? @map("leader_fill_id") @db.Uuid

  subscriptionId String @map("subscription_id") @db.Uuid
  followerId     String @map("follower_id") @db.Uuid
  traderId       String @map("trader_id") @db.Uuid

  followerAccountId String? @map("follower_account_id") @db.Uuid

  status CopyExecutionStatus @default(PENDING)

  sizingMode CopySizingMode @default(PROPORTIONAL) @map("sizing_mode")

  leaderQuantity String @map("leader_quantity") @db.VarChar(64)
  leaderPrice    String? @map("leader_price") @db.VarChar(64)

  followerQuantity String? @map("follower_quantity") @db.VarChar(64)
  followerPrice    String? @map("follower_price") @db.VarChar(64)

  slippageTolerance String? @map("slippage_tolerance") @db.VarChar(32)
  maxNotional       String? @map("max_notional") @db.VarChar(64)

  executionIntent Json @default("{}") @map("execution_intent")

  followerOrderId String? @map("follower_order_id") @db.Uuid
  followerFillId  String? @map("follower_fill_id") @db.Uuid

  providerOrderId String? @map("provider_order_id") @db.VarChar(128)
  providerTradeId String? @map("provider_trade_id") @db.VarChar(128)

  failureReason String? @map("failure_reason") @db.VarChar(1000)
  retryCount    Int @default(0) @map("retry_count")

  riskDecision CopyRiskDecision? @map("risk_decision")
  riskRuleId   String? @map("risk_rule_id") @db.VarChar(64)

  idempotencyKey String @map("idempotency_key") @db.VarChar(255)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  subscription CopySubscription @relation(fields: [subscriptionId], references: [id], onDelete: Cascade)
  followerAccount TradingAccount? @relation(fields: [followerAccountId], references: [id], onDelete: SetNull)

  @@unique([tenantId, leaderEventId, subscriptionId])
  @@index([tenantId, subscriptionId, status])
  @@index([tenantId, followerId, status])
  @@index([tenantId, traderId, status])
  @@index([leaderEventId])
  @@index([followerOrderId])
  @@map("copy_executions")
  @@unique([tenantId, idempotencyKey])
}

model CopyTradingAuditLog {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  event      String @db.VarChar(64)
  actorId    String? @map("actor_id") @db.Uuid
  traderId   String? @map("trader_id") @db.Uuid
  followerId String? @map("follower_id") @db.Uuid
  strategyId String? @map("strategy_id") @db.Uuid
  subscriptionId String? @map("subscription_id") @db.Uuid
  executionId    String? @map("execution_id") @db.Uuid

  result String @default("SUCCESS") @db.VarChar(32)
  safeMetadata Json @default("{}") @map("safe_metadata")
  requestId    String? @map("request_id") @db.VarChar(64)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@index([tenantId, event, createdAt])
  @@index([tenantId, traderId])
  @@index([tenantId, followerId])
  @@map("copy_trading_audit_logs")
}

model CopyReconciliationRecord {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  leaderEventId  String @map("leader_event_id") @db.VarChar(128)
  subscriptionId String? @map("subscription_id") @db.Uuid
  executionId    String? @map("execution_id") @db.Uuid

  category CopyReconciliationCategory
  severity CopyReconciliationSeverity

  expected Json? @default("{}")
  actual   Json? @default("{}")

  leaderReference   Json? @map("leader_reference")
  followerReference Json? @map("follower_reference")

  resolved   Boolean @default(false)
  resolvedAt DateTime? @map("resolved_at") @db.Timestamptz(6)
  resolvedBy String? @map("resolved_by") @db.Uuid

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@index([tenantId, category, severity])
  @@index([tenantId, leaderEventId])
  @@map("copy_reconciliation_records")
}

// ==================== Part 15 Research ====================

enum ResearchStatus {
  DRAFT
  VALIDATING
  VALID
  RUNNING
  COMPLETED
  FAILED
  INVALIDATED
  ARCHIVED
  PROMOTED
}

enum ResearchDatasetStatus {
  DRAFT
  VALIDATING
  VALID
  INVALID
  ARCHIVED
}

enum ResearchStrategyVersionStatus {
  DRAFT
  VALIDATING
  VALID
  FROZEN
  PUBLISHED
  DEPRECATED
  ARCHIVED
}

enum ResearchBacktestStatus {
  QUEUED
  VALIDATING
  RUNNING
  COMPLETED
  FAILED
  CANCELLED
}

enum ResearchPaperSessionStatus {
  CREATED
  STARTING
  RUNNING
  PAUSED
  STOPPED
  FAILED
  EXPIRED
}

enum ResearchPaperOrderStatus {
  PENDING
  OPEN
  PARTIALLY_FILLED
  FILLED
  CANCELLED
  REJECTED
  EXPIRED
}

enum ResearchSignalState {
  DRAFT
  VALID
  PUBLISHED
  EXPIRED
  REVOKED
  REJECTED
  FILTERED
}

enum ResearchPromotionState {
  DRAFT
  PENDING_BACKTEST_VALIDATION
  PENDING_OUT_OF_SAMPLE
  PENDING_PAPER_TRADING
  PENDING_RISK_REVIEW
  PENDING_COMPLIANCE_REVIEW
  PENDING_PUBLICATION
  APPROVED
  REJECTED
  PROMOTED
  ARCHIVED
}

enum ResearchSignalSide {
  BUY
  SELL
  HOLD
  CLOSE_LONG
  CLOSE_SHORT
}

model ResearchDataset {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  name        String @db.VarChar(120)
  description String? @db.VarChar(1000)

  venue     String @db.VarChar(32)
  symbol    String @db.VarChar(32)
  timeframe String @db.VarChar(16)
  timezone  String @default("UTC") @db.VarChar(64)

  source           String @db.VarChar(64)
  sourceMetadata   Json @default("{}") @map("source_metadata")

  startTime DateTime @map("start_time") @db.Timestamptz(6)
  endTime   DateTime @map("end_time") @db.Timestamptz(6)

  fingerprint String @db.VarChar(128)
  checksum    String? @db.VarChar(128)

  status ResearchDatasetStatus @default(DRAFT)

  recordCount   Int @default(0) @map("record_count")
  gapCount      Int @default(0) @map("gap_count")
  duplicateCount Int @default(0) @map("duplicate_count")

  validationResult Json? @map("validation_result")
  qualityScore     Float? @map("quality_score")

  idempotencyKey String? @map("idempotency_key") @db.VarChar(255)

  createdBy String? @map("created_by") @db.Uuid
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)
  deletedAt DateTime? @map("deleted_at") @db.Timestamptz(6)

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  backtestRuns ResearchBacktestRun[]

  @@unique([tenantId, fingerprint])
  @@index([tenantId, venue, symbol, timeframe])
  @@index([tenantId, status])
  @@map("research_datasets")
  @@unique([tenantId, idempotencyKey])
}

model ResearchStrategyVersion {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  strategyId String? @map("strategy_id") @db.Uuid
  traderStrategyId String? @map("trader_strategy_id") @db.Uuid
  definitionId String? @map("definition_id") @db.Uuid

  version String @db.VarChar(32)
  name    String @db.VarChar(120)
  description String? @db.VarChar(1000)

  status ResearchStrategyVersionStatus @default(DRAFT)

  logicHash String @map("logic_hash") @db.VarChar(128)
  configHash String @map("config_hash") @db.VarChar(128)
  fingerprint String @db.VarChar(128)

  parameters Json @default("{}")
  riskProfile Json @default("{}") @map("risk_profile")
  executionModel Json @default("{}") @map("execution_model")

  frozenAt    DateTime? @map("frozen_at") @db.Timestamptz(6)
  publishedAt DateTime? @map("published_at") @db.Timestamptz(6)
  deprecatedAt DateTime? @map("deprecated_at") @db.Timestamptz(6)

  parentVersionId String? @map("parent_version_id") @db.Uuid

  changeNote String? @map("change_note") @db.VarChar(1000)

  idempotencyKey String? @map("idempotency_key") @db.VarChar(255)

  createdBy String? @map("created_by") @db.Uuid
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)
  deletedAt DateTime? @map("deleted_at") @db.Timestamptz(6)

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  parentVersion ResearchStrategyVersion? @relation("VersionLineage", fields: [parentVersionId], references: [id], onDelete: SetNull)
  childVersions ResearchStrategyVersion[] @relation("VersionLineage")

  backtestRuns ResearchBacktestRun[]
  paperSessions ResearchPaperSession[]
  signals ResearchSignal[]
  promotionRequests ResearchPromotionRequest[]

  @@unique([tenantId, strategyId, version])
  @@unique([tenantId, fingerprint])
  @@index([tenantId, strategyId, status])
  @@index([tenantId, status])
  @@map("research_strategy_versions")
  @@unique([tenantId, idempotencyKey])
}

model ResearchBacktestRun {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  strategyVersionId String @map("strategy_version_id") @db.Uuid
  datasetId String? @map("dataset_id") @db.Uuid
  datasetFingerprint String? @map("dataset_fingerprint") @db.VarChar(128)

  status ResearchBacktestStatus @default(QUEUED)

  config Json @default("{}")
  configFingerprint String @map("config_fingerprint") @db.VarChar(128)

  timeframe String @db.VarChar(16)
  symbols   String[] @default([])
  startTime DateTime @map("start_time") @db.Timestamptz(6)
  endTime   DateTime @map("end_time") @db.Timestamptz(6)

  initialCapital String @map("initial_capital") @db.VarChar(64)
  quoteCurrency  String @default("USDT") @map("quote_currency") @db.VarChar(16)

  feeAssumption Json @default("{}") @map("fee_assumption")
  slippageAssumption Json @default("{}") @map("slippage_assumption")
  latencyAssumption Json @default("{}") @map("latency_assumption")

  leverage String? @db.VarChar(16)
  benchmark String? @db.VarChar(64)

  executionModel Json @default("{}") @map("execution_model")

  runIdentifier String @map("run_identifier") @db.VarChar(64)

  resultSummary Json? @map("result_summary")
  metrics Json? @default("{}")
  equityCurve Json? @default("[]") @map("equity_curve")

  errorCode String? @map("error_code") @db.VarChar(64)
  errorSummary String? @map("error_summary") @db.VarChar(1000)

  startedAt DateTime? @map("started_at") @db.Timestamptz(6)
  completedAt DateTime? @map("completed_at") @db.Timestamptz(6)

  idempotencyKey String? @map("idempotency_key") @db.VarChar(255)

  createdBy String? @map("created_by") @db.Uuid
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  strategyVersion ResearchStrategyVersion @relation(fields: [strategyVersionId], references: [id], onDelete: Cascade)
  dataset ResearchDataset? @relation(fields: [datasetId], references: [id], onDelete: SetNull)

  trades ResearchBacktestTrade[]
  snapshots ResearchBacktestSnapshot[]

  @@unique([tenantId, runIdentifier])
  @@index([tenantId, strategyVersionId, status])
  @@index([tenantId, status, createdAt])
  @@map("research_backtest_runs")
  @@unique([tenantId, idempotencyKey])
}

model ResearchBacktestTrade {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid
  backtestRunId String @map("backtest_run_id") @db.Uuid

  sequence Int
  symbol String @db.VarChar(32)
  side String @db.VarChar(16)
  type String @db.VarChar(16)

  quantity String @db.VarChar(64)
  entryPrice String @map("entry_price") @db.VarChar(64)
  exitPrice String? @map("exit_price") @db.VarChar(64)

  grossPnl String? @map("gross_pnl") @db.VarChar(64)
  fee String @default("0") @db.VarChar(64)
  netPnl String? @map("net_pnl") @db.VarChar(64)

  isWin Boolean? @map("is_win")

  openedAt DateTime @map("opened_at") @db.Timestamptz(6)
  closedAt DateTime? @map("closed_at") @db.Timestamptz(6)
  holdingMs Int? @map("holding_ms")

  isSimulated Boolean @default(true) @map("is_simulated")

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  backtestRun ResearchBacktestRun @relation(fields: [backtestRunId], references: [id], onDelete: Cascade)

  @@unique([backtestRunId, sequence])
  @@index([tenantId, backtestRunId])
  @@map("research_backtest_trades")
}

model ResearchBacktestSnapshot {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid
  backtestRunId String @map("backtest_run_id") @db.Uuid

  sequence Int
  timestamp DateTime @db.Timestamptz(6)

  cash String @db.VarChar(64)
  equity String @db.VarChar(64)
  exposure String? @db.VarChar(64)
  realizedPnl String @default("0") @map("realized_pnl") @db.VarChar(64)
  unrealizedPnl String? @map("unrealized_pnl") @db.VarChar(64)
  drawdown String? @db.VarChar(64)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  backtestRun ResearchBacktestRun @relation(fields: [backtestRunId], references: [id], onDelete: Cascade)

  @@unique([backtestRunId, sequence])
  @@index([tenantId, backtestRunId])
  @@map("research_backtest_snapshots")
}

model ResearchPaperSession {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  strategyVersionId String @map("strategy_version_id") @db.Uuid

  status ResearchPaperSessionStatus @default(CREATED)

  sessionIdentifier String @map("session_identifier") @db.VarChar(64)

  config Json @default("{}")
  initialCapital String @map("initial_capital") @db.VarChar(64)
  currentEquity String? @map("current_equity") @db.VarChar(64)

  symbols String[] @default([])
  timeframe String @default("1m") @db.VarChar(16)

  realizedPnl String @default("0") @map("realized_pnl") @db.VarChar(64)
  unrealizedPnl String? @map("unrealized_pnl") @db.VarChar(64)
  maxDrawdown String? @map("max_drawdown") @db.VarChar(64)
  feesPaid String @default("0") @map("fees_paid") @db.VarChar(64)

  isSimulated Boolean @default(true) @map("is_simulated")

  startedAt DateTime? @map("started_at") @db.Timestamptz(6)
  stoppedAt DateTime? @map("stopped_at") @db.Timestamptz(6)
  expiresAt DateTime? @map("expires_at") @db.Timestamptz(6)

  idempotencyKey String? @map("idempotency_key") @db.VarChar(255)

  createdBy String? @map("created_by") @db.Uuid
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  strategyVersion ResearchStrategyVersion @relation(fields: [strategyVersionId], references: [id], onDelete: Cascade)

  orders ResearchPaperOrder[]
  fills ResearchPaperFill[]
  snapshots ResearchPaperSnapshot[]

  @@unique([tenantId, sessionIdentifier])
  @@index([tenantId, strategyVersionId, status])
  @@index([tenantId, status])
  @@map("research_paper_sessions")
  @@unique([tenantId, idempotencyKey])
}

model ResearchPaperOrder {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid
  sessionId String @map("session_id") @db.Uuid

  orderId String @map("order_id") @db.VarChar(64)
  clientOrderId String @map("client_order_id") @db.VarChar(128)

  symbol String @db.VarChar(32)
  side String @db.VarChar(16)
  type String @db.VarChar(16)
  status ResearchPaperOrderStatus @default(PENDING)

  quantity String @db.VarChar(64)
  price String? @db.VarChar(64)
  stopPrice String? @map("stop_price") @db.VarChar(64)

  filledQuantity String @default("0") @map("filled_quantity") @db.VarChar(64)
  averageFillPrice String? @map("average_fill_price") @db.VarChar(64)

  fee String @default("0") @db.VarChar(64)

  isSimulated Boolean @default(true) @map("is_simulated")

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  session ResearchPaperSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)

  fills ResearchPaperFill[]

  @@unique([tenantId, orderId])
  @@unique([tenantId, clientOrderId])
  @@index([tenantId, sessionId, status])
  @@map("research_paper_orders")
}

model ResearchPaperFill {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid
  sessionId String @map("session_id") @db.Uuid
  orderId String @map("order_id") @db.Uuid

  fillId String @map("fill_id") @db.VarChar(64)
  tradeId String? @map("trade_id") @db.VarChar(64)

  symbol String @db.VarChar(32)
  side String @db.VarChar(16)

  quantity String @db.VarChar(64)
  price String @db.VarChar(64)
  fee String @default("0") @db.VarChar(64)

  isMaker Boolean @default(false) @map("is_maker")
  isSimulated Boolean @default(true) @map("is_simulated")

  timestamp DateTime @db.Timestamptz(6)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  session ResearchPaperSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  order ResearchPaperOrder @relation(fields: [orderId], references: [id], onDelete: Cascade)

  @@unique([tenantId, fillId])
  @@index([tenantId, sessionId])
  @@map("research_paper_fills")
}

model ResearchPaperSnapshot {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid
  sessionId String @map("session_id") @db.Uuid

  sequence Int
  timestamp DateTime @db.Timestamptz(6)

  cash String @db.VarChar(64)
  equity String @db.VarChar(64)
  realizedPnl String @default("0") @map("realized_pnl") @db.VarChar(64)
  unrealizedPnl String? @map("unrealized_pnl") @db.VarChar(64)
  drawdown String? @db.VarChar(64)

  isSimulated Boolean @default(true) @map("is_simulated")

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  session ResearchPaperSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)

  @@unique([sessionId, sequence])
  @@index([tenantId, sessionId])
  @@map("research_paper_snapshots")
}

model ResearchSignal {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  strategyVersionId String @map("strategy_version_id") @db.Uuid

  signalKey String @map("signal_key") @db.VarChar(128)
  symbol String @db.VarChar(32)
  side ResearchSignalSide

  strength String? @db.VarChar(32)
  confidence String? @db.VarChar(32)

  price String? @db.VarChar(64)
  quantity String? @db.VarChar(64)

  timestamp DateTime @db.Timestamptz(6)
  expiresAt DateTime? @map("expires_at") @db.Timestamptz(6)

  state ResearchSignalState @default(DRAFT)

  sourceEvent Json? @map("source_event")
  metadata Json @default("{}")

  idempotencyKey String? @map("idempotency_key") @db.VarChar(255)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  strategyVersion ResearchStrategyVersion @relation(fields: [strategyVersionId], references: [id], onDelete: Cascade)

  @@unique([tenantId, signalKey])
  @@index([tenantId, strategyVersionId, state])
  @@index([tenantId, symbol, state])
  @@map("research_signals")
  @@unique([tenantId, idempotencyKey])
}

model ResearchPromotionRequest {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  strategyVersionId String @map("strategy_version_id") @db.Uuid

  state ResearchPromotionState @default(DRAFT)

  backtestRunId String? @map("backtest_run_id") @db.Uuid
  paperSessionId String? @map("paper_session_id") @db.Uuid

  validationChecklist Json @default("{}") @map("validation_checklist")

  riskReview Json? @map("risk_review")
  complianceReview Json? @map("compliance_review")

  requestedBy String? @map("requested_by") @db.Uuid
  reviewedBy String? @map("reviewed_by") @db.Uuid

  requestedAt DateTime? @map("requested_at") @db.Timestamptz(6)
  reviewedAt DateTime? @map("reviewed_at") @db.Timestamptz(6)

  reason String? @db.VarChar(1000)

  idempotencyKey String? @map("idempotency_key") @db.VarChar(255)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  strategyVersion ResearchStrategyVersion @relation(fields: [strategyVersionId], references: [id], onDelete: Cascade)

  @@index([tenantId, strategyVersionId, state])
  @@index([tenantId, state])
  @@map("research_promotion_requests")
  @@unique([tenantId, idempotencyKey])
}

model ResearchAuditLog {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  event String @db.VarChar(64)
  actorId String? @map("actor_id") @db.Uuid
  strategyVersionId String? @map("strategy_version_id") @db.Uuid
  datasetId String? @map("dataset_id") @db.Uuid
  backtestRunId String? @map("backtest_run_id") @db.Uuid
  paperSessionId String? @map("paper_session_id") @db.Uuid
  signalId String? @map("signal_id") @db.Uuid
  promotionId String? @map("promotion_id") @db.Uuid

  result String @default("SUCCESS") @db.VarChar(32)
  safeMetadata Json @default("{}") @map("safe_metadata")
  requestId String? @map("request_id") @db.VarChar(64)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@index([tenantId, event, createdAt])
  @@index([tenantId, strategyVersionId])
  @@map("research_audit_logs")
}

// =============================================================================
// PART 16 - INSTITUTIONAL RISK MANAGEMENT, PORTFOLIO EXPOSURE, MARGIN CONTROLS
// =============================================================================
// These tables are the durable, auditable layer around canonical trading state.
// They NEVER duplicate Position/Balance/PnL as a second source; they only
// aggregate and snapshot what the canonical tables already say, plus policy
// and decision audit. Immutability and append-only disciplines mirror Part 8.

enum InstitutionalRiskPolicyScope {
  PLATFORM
  TENANT
  TRADER
  STRATEGY
  FOLLOWER
}

enum RiskManagementDecision {
  ALLOW
  REDUCE
  REVIEW_REQUIRED
  BLOCK
  PAUSE
  STOP_COPY
  KILL_SWITCH_REQUIRED
}

enum RiskState {
  NORMAL
  WATCH
  ELEVATED
  HIGH
  CRITICAL
  BLOCKED
  UNKNOWN
  STALE
}

enum CircuitBreakerScope {
  SYMBOL
  STRATEGY
  TRADER
  ACCOUNT
  TENANT
  VENUE
  PLATFORM
}

enum CircuitBreakerState {
  CLOSED
  OPEN
  HALF_OPEN
}

enum RiskReconciliationCategory {
  POSITION_WITHOUT_EXPOSURE
  EXPOSURE_WITHOUT_POSITION
  ORDER_EXPOSURE_MISMATCH
  BALANCE_MISMATCH
  PNL_DRIFT
  SNAPSHOT_STALE
  BREAKER_MISMATCH
  KILL_SWITCH_INCONSISTENCY
  COMPLIANCE_MISMATCH
  MISSING_SOURCE
  IMPOSSIBLE_LEVERAGE
  NEGATIVE_MARGIN
  STALE_MARKET_DATA
  EXCHANGE_HEALTH_MISMATCH
}

model InstitutionalRiskPolicy {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String? @map("tenant_id") @db.Uuid

  scope   InstitutionalRiskPolicyScope
  scopeId String? @map("scope_id") @db.VarChar(128)

  version Int @default(1)
  digest  String @db.VarChar(64)

  // Structured thresholds only, no executable.
  policyJson Json @map("policy_json")

  // Governing rule ids contained in this policy, for audit.
  ruleIds String[] @default([]) @map("rule_ids")

  changeReason String @map("change_reason") @db.VarChar(500)
  changedByUserId String @map("changed_by_user_id") @db.Uuid

  isActive Boolean @default(true) @map("is_active")

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant Tenant? @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@unique([tenantId, scope, scopeId, version])
  @@index([tenantId, scope, isActive])
  @@index([scope, isActive])
  @@map("institutional_risk_policies")
}

model RiskManagementSnapshot {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  userId     String? @map("user_id") @db.Uuid
  traderId   String? @map("trader_id") @db.Uuid
  followerId String? @map("follower_id") @db.Uuid
  accountId  String? @map("account_id") @db.Uuid
  strategyId String? @map("strategy_id") @db.Uuid

  policyVersion String @map("policy_version") @db.VarChar(64)
  policyDigest  String? @map("policy_digest") @db.VarChar(64)

  state RiskState @default(UNKNOWN)

  // Decimal-safe string fields for all monetary exposures
  grossExposure String? @map("gross_exposure") @db.VarChar(64)
  netExposure   String? @map("net_exposure") @db.VarChar(64)
  longExposure  String? @map("long_exposure") @db.VarChar(64)
  shortExposure String? @map("short_exposure") @db.VarChar(64)

  marginUtilization String? @map("margin_utilization") @db.VarChar(32)
  leverageGross     String? @map("leverage_gross") @db.VarChar(32)
  leverageNet       String? @map("leverage_net") @db.VarChar(32)

  drawdownAbs     String? @map("drawdown_abs") @db.VarChar(64)
  drawdownPercent String? @map("drawdown_percent") @db.VarChar(32)

  dailyPnl        String? @map("daily_pnl") @db.VarChar(64)
  dailyLossBudget String? @map("daily_loss_budget") @db.VarChar(64)

  concentrationJson Json? @map("concentration_json")
  exposureJson      Json? @map("exposure_json")
  marginJson        Json? @map("margin_json")
  leverageJson      Json? @map("leverage_json")
  liquidationJson   Json? @map("liquidation_json")
  correlationJson   Json? @map("correlation_json")
  varJson           Json? @map("var_json")
  stressJson        Json? @map("stress_json")

  sourceTimestamps Json @default("{}") @map("source_timestamps")

  capturedAt DateTime @default(now()) @map("captured_at") @db.Timestamptz(6)
  createdAt  DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@index([tenantId, accountId, capturedAt])
  @@index([tenantId, traderId, capturedAt])
  @@index([tenantId, capturedAt])
  @@map("risk_management_snapshots")
}

model CircuitBreakerRecord {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String? @map("tenant_id") @db.Uuid

  scope   CircuitBreakerScope
  scopeId String @map("scope_id") @db.VarChar(128)

  state CircuitBreakerState @default(CLOSED)

  triggerType String @map("trigger_type") @db.VarChar(64)
  triggerRuleId String? @map("trigger_rule_id") @db.VarChar(64)

  reason String @db.VarChar(1000)

  policyVersion String @map("policy_version") @db.VarChar(64)

  triggeredAt DateTime? @map("triggered_at") @db.Timestamptz(6)
  acknowledgedAt DateTime? @map("acknowledged_at") @db.Timestamptz(6)
  clearedAt DateTime? @map("cleared_at") @db.Timestamptz(6)
  halfOpenAt DateTime? @map("half_open_at") @db.Timestamptz(6)

  triggeredByUserId String? @map("triggered_by_user_id") @db.Uuid
  clearedByUserId   String? @map("cleared_by_user_id") @db.Uuid

  metadata Json @default("{}")

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant Tenant? @relation(fields: [tenantId], references: [id], onDelete: SetNull)

  @@index([tenantId, scope, scopeId, state])
  @@index([scope, state])
  @@map("circuit_breaker_records")
}

model RiskDecisionRecord {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  userId     String? @map("user_id") @db.Uuid
  accountId  String? @map("account_id") @db.Uuid
  traderId   String? @map("trader_id") @db.Uuid
  followerId String? @map("follower_id") @db.Uuid
  strategyId String? @map("strategy_id") @db.Uuid
  symbol     String? @db.VarChar(32)
  venue      String? @db.VarChar(32)

  decision RiskManagementDecision

  state RiskState @default(UNKNOWN)

  ruleIds String[] @default([]) @map("rule_ids")
  policyVersion String @map("policy_version") @db.VarChar(64)

  blockingReasons String[] @default([]) @map("blocking_reasons")
  warnings        String[] @default([])

  // Full structured decision payload with ruleId/policyVersion/current/threshold/severity/reason
  decisionJson Json @map("decision_json")
  exposureJson Json? @map("exposure_json")

  requestId String? @map("request_id") @db.VarChar(64)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@index([tenantId, accountId, createdAt])
  @@index([tenantId, symbol, createdAt])
  @@index([tenantId, decision, createdAt])
  @@map("risk_decision_records")
}

model RiskReconciliationRecord {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  accountId String? @map("account_id") @db.Uuid

  category RiskReconciliationCategory

  severity String @default("MEDIUM") @db.VarChar(16)

  expected Json? @default("{}")
  actual   Json? @default("{}")

  summary String @db.VarChar(1000)

  resolved   Boolean @default(false)
  resolvedAt DateTime? @map("resolved_at") @db.Timestamptz(6)
  resolvedBy String? @map("resolved_by") @db.Uuid

  policyVersion String? @map("policy_version") @db.VarChar(64)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@index([tenantId, category, createdAt])
  @@index([tenantId, resolved, createdAt])
  @@map("risk_reconciliation_records")
}



// =============================================================================
// PART 17 - INSTITUTIONAL OMS, ORDER LIFECYCLE, FILL, TRADE, RECONCILIATION
// =============================================================================
// OMS is operational source for order lifecycle orchestration. Actual exchange
// execution state remains authoritative for real execution facts. Every transition
// must be valid, auditable, Decimal-safe, idempotent, out-of-order safe.
// Never second execution engine, second order/fill/position/PnL source.

enum OmsOrderIntentState {
  CREATED
  VALIDATING
  APPROVED
  SUBMITTED
  ACKNOWLEDGED
  PARTIALLY_FILLED
  FILLED
  CANCEL_REQUESTED
  CANCELLED
  REJECTED
  EXPIRED
  REPLACED
  FAILED
  RECONCILIATION_REQUIRED
}

enum OmsFillState {
  RECEIVED
  VALIDATED
  APPLIED
  REJECTED
  DUPLICATE
}

enum OmsTradeState {
  OPEN
  PARTIAL
  CLOSED
  RECONCILIATION_REQUIRED
}

enum OmsExecutionAckType {
  ACCEPTED
  REJECTED
}

enum OmsRejectionCategory {
  RISK_BLOCK
  COMPLIANCE_BLOCK
  SECURITY_BLOCK
  INVALID_SYMBOL
  INVALID_PRECISION
  INSUFFICIENT_BALANCE
  INSUFFICIENT_MARGIN
  EXCHANGE_REJECT
  RATE_LIMITED
  MARKET_DATA_STALE
  LIVE_GATE_BLOCK
  CREDENTIAL_FAILURE
  UNKNOWN
}

enum OmsReconciliationCategory {
  MISSING_EXCHANGE_ORDER
  MISSING_ACK
  DUPLICATE_PROVIDER_ORDER
  PROVIDER_STATUS_MISMATCH
  STALE_ORDER
  IMPOSSIBLE_LIFECYCLE_TRANSITION
  ORDER_QUANTITY_MISMATCH
  TERMINAL_STATE_MISMATCH
  MISSING_FILL
  DUPLICATE_FILL
  QUANTITY_DRIFT
  PRICE_DRIFT
  FEE_MISMATCH
  ORPHAN_FILL
  POSITION_WITHOUT_FILLS
  FILLS_WITHOUT_POSITION
  POSITION_QUANTITY_MISMATCH
  SIDE_MISMATCH
  LEVERAGE_MISMATCH
  STALE_POSITION
}

enum OmsAuditEventType {
  ORDER_INTENT_CREATED
  ORDER_APPROVED
  ORDER_SUBMITTED
  ORDER_ACKNOWLEDGED
  ORDER_PARTIALLY_FILLED
  ORDER_FILLED
  ORDER_CANCEL_REQUESTED
  ORDER_CANCELLED
  ORDER_REPLACED
  ORDER_REJECTED
  FILL_RECEIVED
  FILL_APPLIED
  TRADE_OPENED
  TRADE_CLOSED
  RECONCILIATION_DETECTED
  RECOVERY_REQUESTED
  EXECUTION_QUALITY_CALCULATED
  OPERATOR_ACTION
}

enum OmsOperationalType {
  STALE_ORDER
  RECONCILIATION_QUEUE
  REJECTED_ORDER
  EXCEPTION
  RETRY_REQUESTED
  RECOVERY_REQUESTED
}

enum OmsOperationalState {
  PENDING
  ACKNOWLEDGED
  RETRY_REQUESTED
  RECOVERY_REQUESTED
  RESOLVED
}

model OmsOrderIntent {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  accountId      String  @map("account_id") @db.Uuid
  strategyId     String? @map("strategy_id") @db.Uuid
  traderId       String? @map("trader_id") @db.Uuid
  followerId     String? @map("follower_id") @db.Uuid
  subscriptionId String? @map("subscription_id") @db.Uuid

  symbol  String @db.VarChar(32)
  venue   String? @db.VarChar(32)
  side    String @db.VarChar(8)
  orderType String @map("order_type") @db.VarChar(16)
  timeInForce String @default("GTC") @map("time_in_force") @db.VarChar(8)

  quantity  String @db.VarChar(40)
  price     String? @db.VarChar(40)
  stopPrice String? @map("stop_price") @db.VarChar(40)

  reduceOnly Boolean @default(false) @map("reduce_only")
  environment String @db.VarChar(8) // PAPER/LIVE

  state OmsOrderIntentState @default(CREATED)

  clientOrderId   String @map("client_order_id") @db.VarChar(128)
  exchangeOrderId String? @map("exchange_order_id") @db.VarChar(64)
  providerOrderId String? @map("provider_order_id") @db.VarChar(128)

  signalId String? @map("signal_id") @db.VarChar(128)

  riskDecisionId String? @map("risk_decision_id") @db.Uuid
  complianceDecisionId String? @map("compliance_decision_id") @db.VarChar(128)
  riskPolicyVersion String? @map("risk_policy_version") @db.VarChar(64)
  compliancePolicyVersion String? @map("compliance_policy_version") @db.VarChar(64)

  rejectionCategory String? @map("rejection_category") @db.VarChar(32)
  rejectionReason String? @map("rejection_reason") @db.VarChar(1000)

  filledQuantity String @default("0") @map("filled_quantity") @db.VarChar(40)
  averageFillPrice String? @map("average_fill_price") @db.VarChar(40)
  cumulativeFee String @default("0") @map("cumulative_fee") @db.VarChar(40)
  feeCurrency String? @map("fee_currency") @db.VarChar(16)

  correlationId String? @map("correlation_id") @db.VarChar(64)
  requestId String? @map("request_id") @db.VarChar(64)
  source String @db.VarChar(32) // STRATEGY, COPY_TRADING, MANUAL, RESEARCH_PROMOTION

  metadata Json @default("{}")

  isSimulated Boolean @default(false) @map("is_simulated")
  wasDryRun Boolean @default(false) @map("was_dry_run")

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)
  submittedAt DateTime? @map("submitted_at") @db.Timestamptz(6)
  acknowledgedAt DateTime? @map("acknowledged_at") @db.Timestamptz(6)
  terminalAt DateTime? @map("terminal_at") @db.Timestamptz(6)

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  fills OmsFill[]
  acks OmsExecutionAck[]
  rejections OmsRejection[]
  reconciliations OmsReconciliation[]
  allocations OmsAllocation[]
  audits OmsAudit[]
  trades OmsTrade[]

  @@unique([tenantId, clientOrderId])
  @@index([tenantId, accountId, state])
  @@index([tenantId, strategyId, state])
  @@index([tenantId, symbol, state])
  @@index([tenantId, state, createdAt])
  @@index([tenantId, traderId])
  @@index([tenantId, followerId])
  @@map("oms_order_intents")
}

model OmsExecutionAck {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  orderIntentId String @map("order_intent_id") @db.Uuid
  internalOrderId String? @map("internal_order_id") @db.Uuid
  clientOrderId String @map("client_order_id") @db.VarChar(128)
  providerOrderId String? @map("provider_order_id") @db.VarChar(128)
  exchangeOrderId String? @map("exchange_order_id") @db.VarChar(64)

  venue String @db.VarChar(32)
  ackType OmsExecutionAckType @map("ack_type")

  timestampMicros String @map("timestamp_micros") @db.VarChar(32)
  latencyMicros String? @map("latency_micros") @db.VarChar(32)

  providerErrorCode String? @map("provider_error_code") @db.VarChar(128)
  providerErrorMessage String? @map("provider_error_message") @db.VarChar(500)
  rawAckRef String? @map("raw_ack_ref") @db.VarChar(128)

  correlationId String? @map("correlation_id") @db.VarChar(64)
  source String @db.VarChar(64)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  orderIntent OmsOrderIntent @relation(fields: [orderIntentId], references: [id], onDelete: Cascade)

  @@unique([tenantId, clientOrderId, exchangeOrderId])
  @@index([tenantId, orderIntentId])
  @@index([tenantId, venue, ackType])
  @@map("oms_execution_acks")
}

model OmsFill {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  orderIntentId String @map("order_intent_id") @db.Uuid
  internalOrderId String? @map("internal_order_id") @db.Uuid
  providerFillId String @map("provider_fill_id") @db.VarChar(128)
  providerOrderId String? @map("provider_order_id") @db.VarChar(128)
  exchangeOrderId String? @map("exchange_order_id") @db.VarChar(64)

  symbol String @db.VarChar(32)
  venue String? @db.VarChar(32)
  side String @db.VarChar(8)

  quantity String @db.VarChar(40)
  price String @db.VarChar(40)
  fee String @default("0") @db.VarChar(40)
  feeCurrency String @default("USDT") @map("fee_currency") @db.VarChar(16)
  quoteQuantity String? @map("quote_quantity") @db.VarChar(40)
  liquidity String? @db.VarChar(16)

  state OmsFillState @default(RECEIVED)

  timestampMicros String @map("timestamp_micros") @db.VarChar(32)
  exchangeTimestampMicros String? @map("exchange_timestamp_micros") @db.VarChar(32)
  receivedTimestampMicros String @map("received_timestamp_micros") @db.VarChar(32)

  cumulativeQuantity String? @map("cumulative_quantity") @db.VarChar(40)
  averagePrice String? @map("average_price") @db.VarChar(40)

  correlationId String? @map("correlation_id") @db.VarChar(64)
  source String @db.VarChar(32)

  isSimulated Boolean @default(false) @map("is_simulated")
  metadata Json @default("{}")

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  orderIntent OmsOrderIntent @relation(fields: [orderIntentId], references: [id], onDelete: Cascade)

  @@unique([tenantId, providerFillId, orderIntentId])
  @@index([tenantId, orderIntentId, timestampMicros])
  @@index([tenantId, symbol, venue])
  @@map("oms_fills")
}

model OmsTrade {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  accountId String @map("account_id") @db.Uuid
  symbol String @db.VarChar(32)
  venue String? @db.VarChar(32)
  strategyId String? @map("strategy_id") @db.Uuid
  traderId String? @map("trader_id") @db.Uuid
  followerId String? @map("follower_id") @db.Uuid

  state OmsTradeState @default(OPEN)
  side String @db.VarChar(8)

  openQuantity String @map("open_quantity") @db.VarChar(40)
  closedQuantity String @default("0") @map("closed_quantity") @db.VarChar(40)
  remainingQuantity String @map("remaining_quantity") @db.VarChar(40)

  averageEntryPrice String? @map("average_entry_price") @db.VarChar(40)
  averageExitPrice String? @map("average_exit_price") @db.VarChar(40)

  totalFee String @default("0") @map("total_fee") @db.VarChar(40)

  orderIds String[] @map("order_ids")
  fillIds String[] @map("fill_ids")

  positionRef String? @map("position_ref") @db.VarChar(128)

  openedAt DateTime? @map("opened_at") @db.Timestamptz(6)
  closedAt DateTime? @map("closed_at") @db.Timestamptz(6)

  correlationId String? @map("correlation_id") @db.VarChar(64)
  isSimulated Boolean @default(false) @map("is_simulated")
  metadata Json @default("{}")

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  orderIntent OmsOrderIntent? @relation(fields: [orderIntentId], references: [id], onDelete: SetNull)
  orderIntentId String? @map("order_intent_id") @db.Uuid

  @@index([tenantId, accountId, symbol, state])
  @@index([tenantId, strategyId, state])
  @@index([tenantId, state, openedAt])
  @@map("oms_trades")
}

model OmsAllocation {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  strategyId String? @map("strategy_id") @db.Uuid
  traderId String? @map("trader_id") @db.Uuid
  followerId String? @map("follower_id") @db.Uuid
  subscriptionId String? @map("subscription_id") @db.Uuid
  accountId String @map("account_id") @db.Uuid
  orderIntentId String? @map("order_intent_id") @db.Uuid

  symbol String @db.VarChar(32)
  side String @db.VarChar(8)

  intendedQuantity String @map("intended_quantity") @db.VarChar(40)
  intendedNotional String? @map("intended_notional") @db.VarChar(40)
  executedQuantity String @default("0") @map("executed_quantity") @db.VarChar(40)
  executedNotional String? @map("executed_notional") @db.VarChar(40)
  remainingQuantity String @map("remaining_quantity") @db.VarChar(40)
  remainingNotional String? @map("remaining_notional") @db.VarChar(40)

  allocationMode String? @map("allocation_mode") @db.VarChar(32)
  correlationId String? @map("correlation_id") @db.VarChar(64)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  orderIntent OmsOrderIntent? @relation(fields: [orderIntentId], references: [id], onDelete: SetNull)

  @@index([tenantId, accountId, symbol])
  @@index([tenantId, strategyId])
  @@index([tenantId, traderId])
  @@index([tenantId, followerId])
  @@map("oms_allocations")
}

model OmsRejection {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  orderIntentId String @map("order_intent_id") @db.Uuid

  category OmsRejectionCategory
  reason String @db.VarChar(1000)
  providerCode String? @map("provider_code") @db.VarChar(128)
  providerMessage String? @map("provider_message") @db.VarChar(500)
  riskRuleId String? @map("risk_rule_id") @db.VarChar(64)
  complianceRuleId String? @map("compliance_rule_id") @db.VarChar(64)

  venue String? @db.VarChar(32)
  symbol String? @db.VarChar(32)
  accountId String? @map("account_id") @db.Uuid
  strategyId String? @map("strategy_id") @db.Uuid

  timestamp String @db.VarChar(32)
  correlationId String? @map("correlation_id") @db.VarChar(64)
  isRetriable Boolean @default(false) @map("is_retriable")
  metadata Json @default("{}")

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  orderIntent OmsOrderIntent @relation(fields: [orderIntentId], references: [id], onDelete: Cascade)

  @@index([tenantId, category, createdAt])
  @@index([tenantId, accountId, symbol])
  @@map("oms_rejections")
}

model OmsReconciliation {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  orderIntentId String? @map("order_intent_id") @db.Uuid
  internalOrderId String? @map("internal_order_id") @db.Uuid
  providerOrderId String? @map("provider_order_id") @db.VarChar(128)
  providerFillId String? @map("provider_fill_id") @db.VarChar(128)

  category OmsReconciliationCategory
  severity String @db.VarChar(16)

  expected Json? @default("{}")
  actual Json? @default("{}")
  summary String @db.VarChar(1000)

  resolved Boolean @default(false)
  resolvedAt DateTime? @map("resolved_at") @db.Timestamptz(6)
  resolvedBy String? @map("resolved_by") @db.Uuid
  resolutionNote String? @map("resolution_note") @db.VarChar(1000)
  correlationId String? @map("correlation_id") @db.VarChar(64)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  orderIntent OmsOrderIntent? @relation(fields: [orderIntentId], references: [id], onDelete: SetNull)

  @@index([tenantId, category, resolved])
  @@index([tenantId, orderIntentId])
  @@map("oms_reconciliations")
}

model OmsExecutionQuality {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  accountId String? @map("account_id") @db.Uuid
  symbol String? @db.VarChar(32)
  venue String? @db.VarChar(32)
  strategyId String? @map("strategy_id") @db.Uuid
  traderId String? @map("trader_id") @db.Uuid

  periodStart String @map("period_start") @db.VarChar(32)
  periodEnd String @map("period_end") @db.VarChar(32)

  totalOrders Int @map("total_orders")
  filledOrders Int @map("filled_orders")
  partiallyFilledOrders Int @map("partially_filled_orders")
  cancelledOrders Int @map("cancelled_orders")
  rejectedOrders Int @map("rejected_orders")

  fillRatio String? @map("fill_ratio") @db.VarChar(16)
  rejectionRate String? @map("rejection_rate") @db.VarChar(16)
  completionRate String? @map("completion_rate") @db.VarChar(16)

  averageSlippage String? @map("average_slippage") @db.VarChar(16)
  medianSlippage String? @map("median_slippage") @db.VarChar(16)
  p95Slippage String? @map("p95_slippage") @db.VarChar(16)

  implementationShortfall String? @map("implementation_shortfall") @db.VarChar(16)
  priceImprovement String? @map("price_improvement") @db.VarChar(16)

  averageFillLatencyMs String? @map("average_fill_latency_ms") @db.VarChar(16)
  medianFillLatencyMs String? @map("median_fill_latency_ms") @db.VarChar(16)
  p95FillLatencyMs String? @map("p95_fill_latency_ms") @db.VarChar(16)

  feeImpact String? @map("fee_impact") @db.VarChar(40)
  totalFees String? @map("total_fees") @db.VarChar(40)

  benchmarkMethod String @map("benchmark_method") @db.VarChar(64)
  observationCount Int @map("observation_count")
  note String @db.VarChar(500)

  calculatedAt DateTime @map("calculated_at") @db.Timestamptz(6)
  metadata Json @default("{}")

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  @@index([tenantId, accountId, venue, calculatedAt])
  @@map("oms_execution_quality")
}

model OmsExecutionLatency {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  orderIntentId String @map("order_intent_id") @db.Uuid

  signalTimestamp String? @map("signal_timestamp") @db.VarChar(32)
  intentTimestamp String @map("intent_timestamp") @db.VarChar(32)
  submitTimestamp String? @map("submit_timestamp") @db.VarChar(32)
  ackTimestamp String? @map("ack_timestamp") @db.VarChar(32)
  firstFillTimestamp String? @map("first_fill_timestamp") @db.VarChar(32)
  completeFillTimestamp String? @map("complete_fill_timestamp") @db.VarChar(32)

  signalTimestampMicros String? @map("signal_timestamp_micros") @db.VarChar(32)
  intentTimestampMicros String? @map("intent_timestamp_micros") @db.VarChar(32)
  submitTimestampMicros String? @map("submit_timestamp_micros") @db.VarChar(32)
  ackTimestampMicros String? @map("ack_timestamp_micros") @db.VarChar(32)
  firstFillTimestampMicros String? @map("first_fill_timestamp_micros") @db.VarChar(32)
  completeFillTimestampMicros String? @map("complete_fill_timestamp_micros") @db.VarChar(32)

  signalToIntentMs String? @map("signal_to_intent_ms") @db.VarChar(16)
  intentToSubmitMs String? @map("intent_to_submit_ms") @db.VarChar(16)
  submitToAckMs String? @map("submit_to_ack_ms") @db.VarChar(16)
  ackToFirstFillMs String? @map("ack_to_first_fill_ms") @db.VarChar(16)
  firstFillToCompleteMs String? @map("first_fill_to_complete_ms") @db.VarChar(16)
  totalLatencyMs String? @map("total_latency_ms") @db.VarChar(16)

  clockSkewDetected Boolean @default(false) @map("clock_skew_detected")
  missingTimestamps String[] @default([]) @map("missing_timestamps")

  calculatedAt DateTime @map("calculated_at") @db.Timestamptz(6)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  @@index([tenantId, orderIntentId])
  @@map("oms_execution_latency")
}

model OmsVenueScore {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  venue String @db.VarChar(32)

  periodStart String @map("period_start") @db.VarChar(32)
  periodEnd String @map("period_end") @db.VarChar(32)

  totalOrders Int @map("total_orders")
  filledOrders Int @map("filled_orders")
  rejectedOrders Int @map("rejected_orders")

  averageLatencyMs String? @map("average_latency_ms") @db.VarChar(16)
  medianLatencyMs String? @map("median_latency_ms") @db.VarChar(16)
  p95LatencyMs String? @map("p95_latency_ms") @db.VarChar(16)

  fillRatio String? @map("fill_ratio") @db.VarChar(16)
  rejectionRate String? @map("rejection_rate") @db.VarChar(16)
  averageSlippage String? @map("average_slippage") @db.VarChar(16)

  providerErrorCount Int @default(0) @map("provider_error_count")
  rateLimitCount Int @default(0) @map("rate_limit_count")
  staleDataCount Int @default(0) @map("stale_data_count")

  methodology String @db.VarChar(500)
  observationCount Int @map("observation_count")
  scoreComponents Json @map("score_components")
  note String @db.VarChar(500)

  calculatedAt DateTime @map("calculated_at") @db.Timestamptz(6)
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  @@index([tenantId, venue, calculatedAt])
  @@map("oms_venue_scores")
}

model OmsPostTrade {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  orderIntentId String @map("order_intent_id") @db.Uuid
  tradeId String? @map("trade_id") @db.Uuid
  accountId String @map("account_id") @db.Uuid
  symbol String @db.VarChar(32)
  venue String? @db.VarChar(32)

  totalFilledQuantity String @map("total_filled_quantity") @db.VarChar(40)
  averageFillPrice String? @map("average_fill_price") @db.VarChar(40)
  totalFees String @map("total_fees") @db.VarChar(40)
  feeCurrency String? @map("fee_currency") @db.VarChar(16)

  settlementRef String? @map("settlement_ref") @db.VarChar(128)
  feeAccrualRef String? @map("fee_accrual_ref") @db.Uuid
  usageEventRef String? @map("usage_event_ref") @db.Uuid
  notificationRef String? @map("notification_ref") @db.Uuid
  tradeLifecycleRef String? @map("trade_lifecycle_ref") @db.Uuid

  reconciliationTriggered Boolean @default(false) @map("reconciliation_triggered")
  completedAt DateTime @map("completed_at") @db.Timestamptz(6)
  metadata Json @default("{}")

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  @@index([tenantId, accountId, symbol, completedAt])
  @@map("oms_post_trades")
}

model OmsOperational {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  type OmsOperationalType
  state OmsOperationalState @default(PENDING)

  orderIntentId String? @map("order_intent_id") @db.Uuid
  internalOrderId String? @map("internal_order_id") @db.Uuid
  symbol String? @db.VarChar(32)
  venue String? @db.VarChar(32)
  accountId String? @map("account_id") @db.Uuid

  summary String @db.VarChar(1000)

  acknowledgedBy String? @map("acknowledged_by") @db.Uuid
  acknowledgedAt DateTime? @map("acknowledged_at") @db.Timestamptz(6)

  retryCount Int @default(0) @map("retry_count")
  lastRetryAt DateTime? @map("last_retry_at") @db.Timestamptz(6)

  operatorNotes String[] @default([]) @map("operator_notes")
  correlationId String? @map("correlation_id") @db.VarChar(64)

  requestedBy String? @map("requested_by") @db.Uuid
  reason String? @db.VarChar(500)
  recoveryType String? @map("recovery_type") @db.VarChar(32)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  @@index([tenantId, type, state])
  @@index([tenantId, accountId, state])
  @@map("oms_operational")
}

model OmsAudit {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  eventType OmsAuditEventType @map("event_type")

  orderIntentId String? @map("order_intent_id") @db.Uuid
  internalOrderId String? @map("internal_order_id") @db.Uuid
  fillId String? @map("fill_id") @db.Uuid
  tradeId String? @map("trade_id") @db.Uuid
  accountId String? @map("account_id") @db.Uuid
  symbol String? @db.VarChar(32)
  venue String? @db.VarChar(32)
  strategyId String? @map("strategy_id") @db.Uuid
  traderId String? @map("trader_id") @db.Uuid
  followerId String? @map("follower_id") @db.Uuid

  actorId String? @map("actor_id") @db.Uuid
  actorType String @default("SYSTEM") @map("actor_type") @db.VarChar(16)
  reason String? @db.VarChar(1000)
  correlationId String? @map("correlation_id") @db.VarChar(64)
  requestId String? @map("request_id") @db.VarChar(64)
  policyVersion String? @map("policy_version") @db.VarChar(64)
  riskRuleId String? @map("risk_rule_id") @db.VarChar(64)

  metadata Json @default("{}")
  timestamp String @db.VarChar(32)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  orderIntent OmsOrderIntent? @relation(fields: [orderIntentId], references: [id], onDelete: SetNull)

  @@index([tenantId, orderIntentId, timestamp])
  @@index([tenantId, eventType, createdAt])
  @@index([tenantId, accountId, symbol])
  @@map("oms_audits")
}


// =============================================================================
// PART 18 - INSTITUTIONAL OPERATIONS, RELIABILITY & INCIDENT CONTROL PLANE
// =============================================================================
// Authoritative operational layer for system readiness, dependency health,
// queue/job health, reconciliation orchestration, incidents, escalation,
// maintenance windows, degradation states, recovery procedures, operator actions,
// and operational auditability.
// This module orchestrates and observes existing authoritative systems; it
// never duplicates execution/risk/position/billing engines and never invents
// health/reconciliation success.

enum OperationalReadinessState {
  READY
  NOT_READY
  DEGRADED
  MAINTENANCE
  UNKNOWN
}

enum OperationalDependencyState {
  HEALTHY
  DEGRADED
  UNAVAILABLE
  MISCONFIGURED
  UNKNOWN
}

enum OperationalDependencyType {
  DATABASE
  REDIS
  QUEUE
  CONFIGURATION
  SECURITY
  LIVE_GATE
  EXCHANGE
  COMPLIANCE
  RISK
  OMS
  BILLING
  NOTIFICATION
  OBSERVABILITY
  COPY_TRADING
  RESEARCH
  USAGE
  SUBSCRIPTION
  FEE
  FINANCE
  CREDENTIAL_SOURCE
  VENUE_ATTESTATION
  DISTRIBUTED_LOCK
  SIGNED_TRANSPORT
  IP_ALLOWLIST
  DURABLE_STORE
  EXECUTION_ENGINE
  STRATEGY_ENGINE
  MARKET_DATA
  EXTERNAL_PROVIDER
}

enum OperationalIncidentSeverity {
  INFO
  WARNING
  ERROR
  CRITICAL
}

enum OperationalIncidentState {
  OPEN
  ACKNOWLEDGED
  ESCALATED
  MITIGATING
  RESOLVED
  SUPPRESSED
  REOPENED
}

enum OperationalMaintenanceState {
  SCHEDULED
  ACTIVE
  COMPLETED
  CANCELLED
  EXPIRED
}

enum OperationalMaintenanceScope {
  PLATFORM
  TENANT
  SERVICE
  VENUE
  TRADING_CAPABILITY
  BILLING_CAPABILITY
}

enum OperationalDegradationLevel {
  NORMAL
  DEGRADED
  READ_ONLY
  PAUSED
  DISABLED
}

enum OperationalRecoveryState {
  PENDING
  REQUIRES_APPROVAL
  APPROVED
  RUNNING
  SUCCEEDED
  FAILED
  CANCELLED
}

enum OperationalActionType {
  ACKNOWLEDGE
  RETRY
  RERUN_RECONCILIATION
  ENTER_MAINTENANCE
  EXIT_MAINTENANCE
  ESCALATE
  SUPPRESS
  RECOVER
  RESOLVE
  REOPEN
  CANCEL
  DEGRADATION_CHANGE
  TRIGGER_READINESS_CHECK
  TRIGGER_DEPENDENCY_CHECK
  TRIGGER_QUEUE_CHECK
  TRIGGER_JOB_CHECK
}

enum OperationalActionStatus {
  PENDING
  VALIDATED
  AUTHORIZED
  EXECUTING
  SUCCEEDED
  FAILED
  CANCELLED
  REQUIRES_APPROVAL
}

enum OperationalReconciliationRunState {
  PENDING
  RUNNING
  SUCCEEDED
  FAILED
  SKIPPED
  CANCELLED
}

enum OperationalReconciliationType {
  OMS_ORDER
  OMS_FILL
  OMS_POSITION
  EXCHANGE_ACCOUNT
  COPY_TRADING
  RISK
  COMPLIANCE
  PAYMENT
  BILLING_FINANCE
  FEE
  USAGE
  NOTIFICATION
  SUBSCRIPTION
}

enum OperationalTriggerType {
  MANUAL
  SCHEDULED
  INCIDENT
  RECOVERY
  HEALTH_CHECK
  READINESS_CHECK
  OPERATOR_ACTION
  SYSTEM
}

enum OperationalAuditEventType {
  READINESS_CHECK
  DEPENDENCY_TRANSITION
  INCIDENT_CREATED
  INCIDENT_ACKNOWLEDGED
  INCIDENT_ESCALATED
  INCIDENT_MITIGATING
  INCIDENT_RESOLVED
  INCIDENT_SUPPRESSED
  INCIDENT_REOPENED
  INCIDENT_DEDUPLICATED
  MAINTENANCE_CREATED
  MAINTENANCE_UPDATED
  MAINTENANCE_STARTED
  MAINTENANCE_COMPLETED
  MAINTENANCE_CANCELLED
  RECONCILIATION_RUN_STARTED
  RECONCILIATION_RUN_COMPLETED
  RECONCILIATION_RUN_FAILED
  RECOVERY_STARTED
  RECOVERY_COMPLETED
  RECOVERY_FAILED
  OPERATOR_ACTION
  DEGRADATION_CHANGED
  QUEUE_HEALTH_CHECK
  JOB_HEALTH_CHECK
  ESCALATION_TRIGGERED
}

model OperationalIncident {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String? @map("tenant_id") @db.Uuid

  // Deterministic fingerprint: sha256(normalized type|severity|component|capability|tenant|scopeTarget)
  fingerprint String @db.VarChar(128)

  type String @db.VarChar(128)
  severity OperationalIncidentSeverity
  state OperationalIncidentState @default(OPEN)

  title String @db.VarChar(255)
  summary String @db.VarChar(1000)

  source String @db.VarChar(64)
  affectedComponent String @map("affected_component") @db.VarChar(128)
  affectedCapability String? @map("affected_capability") @db.VarChar(128)

  // Sanitized evidence, never secrets
  evidence Json @default("{}")

  correlationId String? @map("correlation_id") @db.VarChar(64)
  requestId String? @map("request_id") @db.VarChar(64)
  idempotencyKey String @unique @map("idempotency_key") @db.VarChar(255)

  firstSeenAt DateTime @map("first_seen_at") @db.Timestamptz(6)
  lastSeenAt DateTime @map("last_seen_at") @db.Timestamptz(6)
  occurrenceCount Int @default(1) @map("occurrence_count")

  assignedOperatorId String? @map("assigned_operator_id") @db.Uuid
  acknowledgedAt DateTime? @map("acknowledged_at") @db.Timestamptz(6)
  acknowledgedBy String? @map("acknowledged_by") @db.Uuid

  escalatedAt DateTime? @map("escalated_at") @db.Timestamptz(6)
  escalationHistory Json @default("[]") @map("escalation_history")

  resolvedAt DateTime? @map("resolved_at") @db.Timestamptz(6)
  resolvedBy String? @map("resolved_by") @db.Uuid
  resolutionNote String? @map("resolution_note") @db.VarChar(1000)

  suppressedAt DateTime? @map("suppressed_at") @db.Timestamptz(6)
  suppressedBy String? @map("suppressed_by") @db.Uuid
  suppressionReason String? @map("suppression_reason") @db.VarChar(500)
  suppressUntil DateTime? @map("suppress_until") @db.Timestamptz(6)

  reopenedAt DateTime? @map("reopened_at") @db.Timestamptz(6)
  reopenedBy String? @map("reopened_by") @db.Uuid
  reopenReason String? @map("reopen_reason") @db.VarChar(500)

  auditReference String? @map("audit_reference") @db.VarChar(128)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant Tenant? @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  events OperationalIncidentEvent[]
  recoveryRuns OperationalRecoveryRun[]
  actions OperationalAction[]

  @@unique([tenantId, fingerprint])
  @@index([tenantId, state, severity, createdAt])
  @@index([tenantId, fingerprint])
  @@index([state, severity, lastSeenAt])
  @@index([affectedComponent, affectedCapability])
  @@index([correlationId])
  @@index([idempotencyKey])
  @@map("operational_incidents")
}

model OperationalIncidentEvent {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String? @map("tenant_id") @db.Uuid
  incidentId String @map("incident_id") @db.Uuid

  eventType String @map("event_type") @db.VarChar(64)
  fromState OperationalIncidentState? @map("from_state")
  toState OperationalIncidentState? @map("to_state")

  actorId String? @map("actor_id") @db.Uuid
  actorType String @default("SYSTEM") @map("actor_type") @db.VarChar(32)

  reason String? @db.VarChar(1000)
  evidence Json @default("{}")

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  tenant Tenant? @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  incident OperationalIncident @relation(fields: [incidentId], references: [id], onDelete: Cascade)

  @@index([tenantId, incidentId, createdAt])
  @@index([incidentId, createdAt])
  @@map("operational_incident_events")
}

model OperationalMaintenanceWindow {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String? @map("tenant_id") @db.Uuid

  scope OperationalMaintenanceScope
  scopeTarget String? @map("scope_target") @db.VarChar(128)

  state OperationalMaintenanceState @default(SCHEDULED)

  title String @db.VarChar(255)
  description String? @db.VarChar(2000)

  scheduledStart DateTime @map("scheduled_start") @db.Timestamptz(6)
  scheduledEnd DateTime @map("scheduled_end") @db.Timestamptz(6)
  actualStart DateTime? @map("actual_start") @db.Timestamptz(6)
  actualEnd DateTime? @map("actual_end") @db.Timestamptz(6)

  requestedBy String? @map("requested_by") @db.Uuid
  approvedBy String? @map("approved_by") @db.Uuid
  cancelledBy String? @map("cancelled_by") @db.Uuid

  cancellationReason String? @map("cancellation_reason") @db.VarChar(500)

  conflictChecked Boolean @default(false) @map("conflict_checked")
  isEmergency Boolean @default(false) @map("is_emergency")

  idempotencyKey String @unique @map("idempotency_key") @db.VarChar(255)
  correlationId String? @map("correlation_id") @db.VarChar(64)

  metadata Json @default("{}")
  auditReference String? @map("audit_reference") @db.VarChar(128)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant Tenant? @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  recoveryRuns OperationalRecoveryRun[]

  @@index([tenantId, scope, state, scheduledStart])
  @@index([scope, state, scheduledStart])
  @@index([state, scheduledStart, scheduledEnd])
  @@map("operational_maintenance_windows")
}

model OperationalReconciliationRun {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String? @map("tenant_id") @db.Uuid

  scope String @db.VarChar(32) // PLATFORM, TENANT
  reconciliationType OperationalReconciliationType @map("reconciliation_type")

  requestedBy String? @map("requested_by") @db.Uuid
  triggerType OperationalTriggerType @default(MANUAL) @map("trigger_type")

  status OperationalReconciliationRunState @default(PENDING)

  startTime DateTime? @map("start_time") @db.Timestamptz(6)
  finishTime DateTime? @map("finish_time") @db.Timestamptz(6)
  durationMs Int? @map("duration_ms")

  subsystemResults Json @default("{}") @map("subsystem_results")
  failureDetails Json? @map("failure_details")
  retryMetadata Json @default("{}") @map("retry_metadata")

  attempt Int @default(0)
  maxAttempts Int @default(3) @map("max_attempts")

  correlationId String? @map("correlation_id") @db.VarChar(64)
  idempotencyKey String @unique @map("idempotency_key") @db.VarChar(255)
  parentRunId String? @map("parent_run_id") @db.Uuid

  auditReference String? @map("audit_reference") @db.VarChar(128)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant Tenant? @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@index([tenantId, reconciliationType, status, createdAt])
  @@index([tenantId, scope, createdAt])
  @@index([status, triggerType, createdAt])
  @@index([idempotencyKey])
  @@index([correlationId])
  @@map("operational_reconciliation_runs")
}

model OperationalAction {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String? @map("tenant_id") @db.Uuid

  actionType OperationalActionType @map("action_type")
  status OperationalActionStatus @default(PENDING)

  targetType String? @map("target_type") @db.VarChar(64)
  targetId String? @map("target_id") @db.VarChar(128)

  incidentId String? @map("incident_id") @db.Uuid
  maintenanceWindowId String? @map("maintenance_window_id") @db.Uuid
  reconciliationRunId String? @map("reconciliation_run_id") @db.Uuid
  recoveryRunId String? @map("recovery_run_id") @db.Uuid

  actorId String? @map("actor_id") @db.Uuid
  actorType String @default("USER") @map("actor_type") @db.VarChar(32)

  reason String? @db.VarChar(1000)
  preconditions Json @default("{}")
  result Json @default("{}")

  correlationId String? @map("correlation_id") @db.VarChar(64)
  requestId String? @map("request_id") @db.VarChar(64)
  idempotencyKey String @unique @map("idempotency_key") @db.VarChar(255)

  auditReference String? @map("audit_reference") @db.VarChar(128)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant Tenant? @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  incident OperationalIncident? @relation(fields: [incidentId], references: [id], onDelete: SetNull)

  @@index([tenantId, actionType, status, createdAt])
  @@index([tenantId, targetType, targetId])
  @@index([incidentId])
  @@index([idempotencyKey])
  @@map("operational_actions")
}

model OperationalRecoveryRun {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String? @map("tenant_id") @db.Uuid

  planId String? @map("plan_id") @db.VarChar(128)
  incidentId String? @map("incident_id") @db.Uuid
  maintenanceWindowId String? @map("maintenance_window_id") @db.Uuid

  state OperationalRecoveryState @default(PENDING)

  requestedBy String? @map("requested_by") @db.Uuid
  approvedBy String? @map("approved_by") @db.Uuid

  steps Json @default("[]")
  currentStep Int @default(0) @map("current_step")
  totalSteps Int @default(0) @map("total_steps")

  result Json @default("{}")
  failureReason String? @map("failure_reason") @db.VarChar(1000)

  startedAt DateTime? @map("started_at") @db.Timestamptz(6)
  finishedAt DateTime? @map("finished_at") @db.Timestamptz(6)
  durationMs Int? @map("duration_ms")

  correlationId String? @map("correlation_id") @db.VarChar(64)
  idempotencyKey String @unique @map("idempotency_key") @db.VarChar(255)
  auditReference String? @map("audit_reference") @db.VarChar(128)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant Tenant? @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  incident OperationalIncident? @relation(fields: [incidentId], references: [id], onDelete: SetNull)
  maintenanceWindow OperationalMaintenanceWindow? @relation(fields: [maintenanceWindowId], references: [id], onDelete: SetNull)

  @@index([tenantId, state, createdAt])
  @@index([incidentId])
  @@index([idempotencyKey])
  @@map("operational_recovery_runs")
}

model OperationalAuditLog {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String? @map("tenant_id") @db.Uuid

  eventType OperationalAuditEventType @map("event_type")

  actorId String? @map("actor_id") @db.Uuid
  actorType String @default("SYSTEM") @map("actor_type") @db.VarChar(32)

  targetType String? @map("target_type") @db.VarChar(64)
  targetId String? @map("target_id") @db.VarChar(128)

  // Immutable evidence, sanitized
  evidence Json @default("{}")

  correlationId String? @map("correlation_id") @db.VarChar(64)
  requestId String? @map("request_id") @db.VarChar(64)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  tenant Tenant? @relation(fields: [tenantId], references: [id], onDelete: SetNull)

  @@index([tenantId, eventType, createdAt])
  @@index([tenantId, targetType, targetId])
  @@index([eventType, createdAt])
  @@index([correlationId])
  @@map("operational_audit_logs")
}

model OperationalDependencyCheck {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String? @map("tenant_id") @db.Uuid

  dependencyType OperationalDependencyType @map("dependency_type")
  dependencyName String @map("dependency_name") @db.VarChar(128)

  state OperationalDependencyState

  latencyMs Int? @map("latency_ms")
  errorCode String? @map("error_code") @db.VarChar(64)
  errorMessage String? @map("error_message") @db.VarChar(500)

  evidence Json @default("{}")

  checkedAt DateTime @map("checked_at") @db.Timestamptz(6)
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  tenant Tenant? @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@index([tenantId, dependencyType, state, checkedAt])
  @@index([dependencyType, state, checkedAt])
  @@map("operational_dependency_checks")
}

model OperationalReadinessCheck {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String? @map("tenant_id") @db.Uuid

  state OperationalReadinessState

  isReady Boolean @map("is_ready")
  blockingReasons String[] @default([]) @map("blocking_reasons")
  degradedComponents String[] @default([]) @map("degraded_components")

  evidence Json @default("{}")

  requestedBy String? @map("requested_by") @db.Uuid
  correlationId String? @map("correlation_id") @db.VarChar(64)

  checkedAt DateTime @map("checked_at") @db.Timestamptz(6)
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  tenant Tenant? @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@index([tenantId, state, checkedAt])
  @@index([state, checkedAt])
  @@map("operational_readiness_checks")
}

model OperationalServiceDegradation {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String? @map("tenant_id") @db.Uuid

  serviceName String @map("service_name") @db.VarChar(128)
  capability String? @db.VarChar(128)

  level OperationalDegradationLevel
  previousLevel OperationalDegradationLevel? @map("previous_level")

  reason String @db.VarChar(1000)
  requestedBy String? @map("requested_by") @db.Uuid
  approvedBy String? @map("approved_by") @db.Uuid

  allowedOperations String[] @default([]) @map("allowed_operations")
  blockedOperations String[] @default([]) @map("blocked_operations")

  startsAt DateTime @map("starts_at") @db.Timestamptz(6)
  endsAt DateTime? @map("ends_at") @db.Timestamptz(6)

  correlationId String? @map("correlation_id") @db.VarChar(64)
  auditReference String? @map("audit_reference") @db.VarChar(128)
  idempotencyKey String @unique @map("idempotency_key") @db.VarChar(255)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant Tenant? @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@index([tenantId, serviceName, level, createdAt])
  @@index([serviceName, level, createdAt])
  @@map("operational_service_degradations")
}


// =============================================================================
// PART 19 - INSTITUTIONAL PORTFOLIO ACCOUNTING, PERFORMANCE & INVESTOR REPORTING
// =============================================================================
// Transforms authoritative trading/accounting events into deterministic auditable portfolio view.
// NOT second execution/position/balance/PnL engine. Authoritative sources remain exchange balances,
// positions, OMS fills, trade lifecycle, finance ledger, fee accruals, copy allocations, market prices.
// Accounting, valuation, performance, attribution, period closing, statements, snapshots, reporting,
// reconciliation, historical auditability. Decimal-safe, immutable closed periods, reversal adjustments,
// explicit FX, idempotent ingestion.

enum PortfolioAccountingScope {
  TENANT
  TRADER
  FOLLOWER
  STRATEGY
  MANAGED_ACCOUNT
}

enum PortfolioType {
  SPOT
  MARGIN
  FUTURES
  MANAGED
  COPY_TRADING
  PAPER
}

enum PortfolioPositionClassification {
  LONG
  SHORT
  FLAT
  CASH
}

enum PortfolioCashFlowType {
  DEPOSIT
  WITHDRAWAL
  TRANSFER_IN
  TRANSFER_OUT
  TRADE_SETTLEMENT_BUY
  TRADE_SETTLEMENT_SELL
  FEE
  PLATFORM_FEE
  PERFORMANCE_FEE
  FUNDING
  ADJUSTMENT
  REVERSAL
  DIVIDEND
  INTEREST
}

enum PortfolioValuationState {
  VALID
  STALE
  MISSING_PRICE
  MISSING_FX
  INCOMPLETE
  UNAVAILABLE
}

enum PortfolioPeriodState {
  OPEN
  CLOSING
  CLOSED
}

enum PortfolioReturnMethodology {
  TIME_WEIGHTED_RETURN
  MONEY_WEIGHTED_RETURN
}

enum PortfolioAttributionDimension {
  STRATEGY
  TRADER
  FOLLOWER
  SYMBOL
  ASSET
  VENUE
  COPY_ALLOCATION
  FEE
}

enum PortfolioStatementState {
  DRAFT
  FINALIZED
  SUPERSEDED
  VOID
}

enum PortfolioReconciliationState {
  PENDING
  MATCHED
  MISMATCH
  RESOLVED
  FAILED
}

enum PortfolioAdjustmentType {
  CORRECTION
  REVERSAL
  MANUAL_ADJUSTMENT
  FEE_CORRECTION
  CASH_CORRECTION
  POSITION_CORRECTION
}

enum PortfolioPnLType {
  REALIZED
  UNREALIZED
  GROSS
  FEE_ADJUSTED
  NET
}

model PortfolioAccountingProfile {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  scope PortfolioAccountingScope
  scopeId String @map("scope_id") @db.VarChar(128)

  portfolioType PortfolioType @default(SPOT) @map("portfolio_type")

  baseCurrency String @default("USD") @map("base_currency") @db.VarChar(16)
  valuationCurrency String? @map("valuation_currency") @db.VarChar(16)

  returnMethodology PortfolioReturnMethodology @default(TIME_WEIGHTED_RETURN) @map("return_methodology")
  costBasisMethod String @default("FIFO") @map("cost_basis_method") @db.VarChar(16)

  feeTreatment String @default("NET") @map("fee_treatment") @db.VarChar(32)

  valuationFrequency String @default("DAILY") @map("valuation_frequency") @db.VarChar(32)
  periodBoundary String @default("UTC_MIDNIGHT") @map("period_boundary") @db.VarChar(32)

  roundingMode String @default("HALF_UP") @map("rounding_mode") @db.VarChar(16)
  roundingScale Int @default(8) @map("rounding_scale")

  policyVersion String @map("policy_version") @db.VarChar(64)
  calculationVersion String @map("calculation_version") @db.VarChar(64)

  isActive Boolean @default(true) @map("is_active")

  metadata Json @default("{}")

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  accountingEvents PortfolioAccountingEvent[]
  cashEntries PortfolioCashLedgerEntry[]
  positionLots PortfolioPositionLot[]
  valuations PortfolioValuation[]
  snapshots PortfolioSnapshot[]
  periods PortfolioAccountingPeriod[]
  performanceRecords PortfolioPerformanceRecord[]
  attributionRecords PortfolioAttributionRecord[]
  statements PortfolioStatement[]

  @@unique([tenantId, scope, scopeId])
  @@index([tenantId, scope, isActive])
  @@index([tenantId, portfolioType])
  @@map("portfolio_accounting_profiles")
}

model PortfolioAccountingEvent {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  profileId String @map("profile_id") @db.Uuid

  // Immutable normalized accounting event from authoritative source
  eventType String @map("event_type") @db.VarChar(64)
  cashFlowType PortfolioCashFlowType? @map("cash_flow_type")

  // Source traceability mandatory
  sourceType String @map("source_type") @db.VarChar(64)
  sourceId String @map("source_id") @db.VarChar(255)
  sourceTimestamp DateTime @map("source_timestamp") @db.Timestamptz(6)

  // Deterministic idempotency
  idempotencyKey String @map("idempotency_key") @db.VarChar(255)
  fingerprint String @map("fingerprint") @db.VarChar(128)

  // Financial amounts Decimal-safe string
  asset String? @db.VarChar(32)
  quantity String? @db.VarChar(64)
  price String? @db.VarChar(64)
  amount String? @db.VarChar(64)
  feeAmount String? @map("fee_amount") @db.VarChar(64)
  currency String? @db.VarChar(16)

  // References
  orderId String? @map("order_id") @db.VarChar(128)
  fillId String? @map("fill_id") @db.VarChar(128)
  tradeId String? @map("trade_id") @db.VarChar(128)
  feeAccrualId String? @map("fee_accrual_id") @db.Uuid
  financeLedgerId String? @map("finance_ledger_id") @db.VarChar(128)
  copyAllocationId String? @map("copy_allocation_id") @db.VarChar(128)

  baseCurrency String? @map("base_currency") @db.VarChar(16)
  conversionRate String? @map("conversion_rate") @db.VarChar(64)
  conversionSource String? @map("conversion_source") @db.VarChar(64)
  conversionTimestamp DateTime? @map("conversion_timestamp") @db.Timestamptz(6)
  conversionStatus String? @map("conversion_status") @db.VarChar(32)

  calculationVersion String @map("calculation_version") @db.VarChar(64)
  policyVersion String @map("policy_version") @db.VarChar(64)

  // Immutable: no updates after creation, only reversal via adjustment
  isReversed Boolean @default(false) @map("is_reversed")
  reversedByEventId String? @map("reversed_by_event_id") @db.Uuid

  correlationId String? @map("correlation_id") @db.VarChar(64)
  requestId String? @map("request_id") @db.VarChar(64)

  metadata Json @default("{}")
  evidence Json @default("{}")

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  profile PortfolioAccountingProfile @relation(fields: [profileId], references: [id], onDelete: Cascade)

  cashLedgerEntries PortfolioCashLedgerEntry[]
  positionLots PortfolioPositionLot[]
  adjustments PortfolioAccountingAdjustment[]

  @@index([tenantId, profileId, eventType, createdAt])
  @@index([tenantId, sourceType, sourceId])
  @@index([tenantId, idempotencyKey])
  @@index([tenantId, fingerprint])
  @@index([profileId, createdAt])
  @@index([sourceType, sourceId])
  @@map("portfolio_accounting_events")
  @@unique([tenantId, idempotencyKey])
}

model PortfolioCashLedgerEntry {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  profileId String @map("profile_id") @db.Uuid
  accountingEventId String? @map("accounting_event_id") @db.Uuid

  cashFlowType PortfolioCashFlowType @map("cash_flow_type")

  asset String @db.VarChar(32)
  amount String @db.VarChar(64)
  currency String @db.VarChar(16)

  runningBalance String? @map("running_balance") @db.VarChar(64)

  baseCurrency String @map("base_currency") @db.VarChar(16)
  baseCurrencyAmount String? @map("base_currency_amount") @db.VarChar(64)
  conversionRate String? @map("conversion_rate") @db.VarChar(64)
  conversionSource String? @map("conversion_source") @db.VarChar(64)
  conversionTimestamp DateTime? @map("conversion_timestamp") @db.Timestamptz(6)
  conversionStatus String? @map("conversion_status") @db.VarChar(32)

  sourceType String? @map("source_type") @db.VarChar(64)
  sourceId String? @map("source_id") @db.VarChar(255)

  idempotencyKey String @map("idempotency_key") @db.VarChar(255)

  calculationVersion String @map("calculation_version") @db.VarChar(64)
  policyVersion String @map("policy_version") @db.VarChar(64)

  correlationId String? @map("correlation_id") @db.VarChar(64)

  occurredAt DateTime @map("occurred_at") @db.Timestamptz(6)
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  profile PortfolioAccountingProfile @relation(fields: [profileId], references: [id], onDelete: Cascade)
  accountingEvent PortfolioAccountingEvent? @relation(fields: [accountingEventId], references: [id], onDelete: SetNull)

  @@index([tenantId, profileId, occurredAt])
  @@index([tenantId, cashFlowType, occurredAt])
  @@index([profileId, asset, occurredAt])
  @@map("portfolio_cash_ledger_entries")
  @@unique([tenantId, idempotencyKey])
}

model PortfolioPositionLot {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  profileId String @map("profile_id") @db.Uuid
  accountingEventId String? @map("accounting_event_id") @db.Uuid

  symbol String @db.VarChar(64)
  asset String @db.VarChar(32)
  venue String? @db.VarChar(32)

  classification PortfolioPositionClassification

  // Lot continuity
  openingEventId String? @map("opening_event_id") @db.Uuid
  closingEventId String? @map("closing_event_id") @db.Uuid
  parentLotId String? @map("parent_lot_id") @db.Uuid

  quantity String @db.VarChar(64)
  remainingQuantity String @map("remaining_quantity") @db.VarChar(64)

  costBasisPerUnit String? @map("cost_basis_per_unit") @db.VarChar(64)
  totalCostBasis String? @map("total_cost_basis") @db.VarChar(64)

  realizedPnl String? @map("realized_pnl") @db.VarChar(64)
  currency String @db.VarChar(16)
  baseCurrency String @map("base_currency") @db.VarChar(16)

  costBasisMethod String @map("cost_basis_method") @db.VarChar(16)
  calculationVersion String @map("calculation_version") @db.VarChar(64)
  policyVersion String @map("policy_version") @db.VarChar(64)

  isClosed Boolean @default(false) @map("is_closed")
  isReversed Boolean @default(false) @map("is_reversed")

  openedAt DateTime @map("opened_at") @db.Timestamptz(6)
  closedAt DateTime? @map("closed_at") @db.Timestamptz(6)

  idempotencyKey String @map("idempotency_key") @db.VarChar(255)

  metadata Json @default("{}")
  evidence Json @default("{}")

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  profile PortfolioAccountingProfile @relation(fields: [profileId], references: [id], onDelete: Cascade)
  accountingEvent PortfolioAccountingEvent? @relation(fields: [accountingEventId], references: [id], onDelete: SetNull)

  @@index([tenantId, profileId, symbol, openedAt])
  @@index([tenantId, profileId, isClosed])
  @@index([profileId, symbol, isClosed])
  @@map("portfolio_position_lots")
  @@unique([tenantId, idempotencyKey])
}

model PortfolioValuation {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  profileId String @map("profile_id") @db.Uuid

  symbol String? @db.VarChar(64)
  asset String @db.VarChar(32)

  valuationState PortfolioValuationState @default(VALID) @map("valuation_state")

  quantity String? @db.VarChar(64)
  marketPrice String? @map("market_price") @db.VarChar(64)
  marketPriceSource String? @map("market_price_source") @db.VarChar(64)
  marketPriceTimestamp DateTime? @map("market_price_timestamp") @db.Timestamptz(6)

  grossValue String? @map("gross_value") @db.VarChar(64)
  currency String @db.VarChar(16)

  baseCurrency String @map("base_currency") @db.VarChar(16)
  baseCurrencyValue String? @map("base_currency_value") @db.VarChar(64)
  conversionRate String? @map("conversion_rate") @db.VarChar(64)
  conversionSource String? @map("conversion_source") @db.VarChar(64)
  conversionTimestamp DateTime? @map("conversion_timestamp") @db.Timestamptz(6)
  conversionStatus String? @map("conversion_status") @db.VarChar(32)

  valuationTimestamp DateTime @map("valuation_timestamp") @db.Timestamptz(6)

  calculationVersion String @map("calculation_version") @db.VarChar(64)
  policyVersion String @map("policy_version") @db.VarChar(64)

  dataCompleteness String @default("COMPLETE") @map("data_completeness") @db.VarChar(32)

  evidence Json @default("{}")
  sourceReferences Json @default("[]") @map("source_references")

  idempotencyKey String @map("idempotency_key") @db.VarChar(255)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  profile PortfolioAccountingProfile @relation(fields: [profileId], references: [id], onDelete: Cascade)

  @@index([tenantId, profileId, valuationTimestamp])
  @@index([tenantId, symbol, valuationTimestamp])
  @@index([profileId, valuationState, valuationTimestamp])
  @@map("portfolio_valuations")
  @@unique([tenantId, idempotencyKey])
}

model PortfolioSnapshot {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  profileId String @map("profile_id") @db.Uuid

  snapshotId String @unique @map("snapshot_id") @db.VarChar(128)

  timestamp DateTime @db.Timestamptz(6)
  baseCurrency String @map("base_currency") @db.VarChar(16)

  cash String @db.VarChar(64)
  grossAssetValue String? @map("gross_asset_value") @db.VarChar(64)
  grossLiability String? @map("gross_liability") @db.VarChar(64)
  nav String @db.VarChar(64)

  realizedPnl String? @map("realized_pnl") @db.VarChar(64)
  unrealizedPnl String? @map("unrealized_pnl") @db.VarChar(64)
  grossPnl String? @map("gross_pnl") @db.VarChar(64)
  fees String? @db.VarChar(64)
  netPnl String? @map("net_pnl") @db.VarChar(64)

  positions Json @default("[]")
  cashBreakdown Json @default("{}") @map("cash_breakdown")

  performanceMetrics Json @default("{}") @map("performance_metrics")
  valuationEvidence Json @default("{}") @map("valuation_evidence")
  sourceReferences Json @default("[]") @map("source_references")

  calculationVersion String @map("calculation_version") @db.VarChar(64)
  policyVersion String @map("policy_version") @db.VarChar(64)

  dataCompleteness String @default("COMPLETE") @map("data_completeness") @db.VarChar(32)

  idempotencyKey String @map("idempotency_key") @db.VarChar(255)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  profile PortfolioAccountingProfile @relation(fields: [profileId], references: [id], onDelete: Cascade)

  @@index([tenantId, profileId, timestamp])
  @@index([tenantId, snapshotId])
  @@index([profileId, timestamp])
  @@map("portfolio_snapshots")
  @@unique([tenantId, idempotencyKey])
}

model PortfolioAccountingPeriod {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  profileId String @map("profile_id") @db.Uuid

  periodStart DateTime @map("period_start") @db.Timestamptz(6)
  periodEnd DateTime @map("period_end") @db.Timestamptz(6)

  state PortfolioPeriodState @default(OPEN)

  openingNav String? @map("opening_nav") @db.VarChar(64)
  closingNav String? @map("closing_nav") @db.VarChar(64)

  totalDeposits String? @map("total_deposits") @db.VarChar(64)
  totalWithdrawals String? @map("total_withdrawals") @db.VarChar(64)
  totalFees String? @map("total_fees") @db.VarChar(64)

  realizedPnl String? @map("realized_pnl") @db.VarChar(64)
  unrealizedPnl String? @map("unrealized_pnl") @db.VarChar(64)
  netPnl String? @map("net_pnl") @db.VarChar(64)

  returnPercent String? @map("return_percent") @db.VarChar(32)

  baseCurrency String @map("base_currency") @db.VarChar(16)

  calculationVersion String @map("calculation_version") @db.VarChar(64)
  policyVersion String @map("policy_version") @db.VarChar(64)

  closeMetadata Json? @map("close_metadata")
  validationEvidence Json? @map("validation_evidence")

  idempotencyKey String @map("idempotency_key") @db.VarChar(255)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)
  closedAt DateTime? @map("closed_at") @db.Timestamptz(6)

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  profile PortfolioAccountingProfile @relation(fields: [profileId], references: [id], onDelete: Cascade)

  closes PortfolioAccountingClose[]
  performanceRecords PortfolioPerformanceRecord[]
  attributionRecords PortfolioAttributionRecord[]
  statements PortfolioStatement[]

  @@unique([tenantId, profileId, periodStart, periodEnd])
  @@index([tenantId, profileId, state, periodStart])
  @@index([tenantId, state, periodStart])
  @@map("portfolio_accounting_periods")
  @@unique([tenantId, idempotencyKey])
}

model PortfolioAccountingClose {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  periodId String @map("period_id") @db.Uuid

  requestedBy String? @map("requested_by") @db.Uuid
  closedBy String? @map("closed_by") @db.Uuid

  validationPassed Boolean @default(false) @map("validation_passed")
  validationEvidence Json @default("{}") @map("validation_evidence")
  failureEvidence Json? @map("failure_evidence")

  closingNav String? @map("closing_nav") @db.VarChar(64)
  openingNavNext String? @map("opening_nav_next") @db.VarChar(64)

  reconciliationStatus String? @map("reconciliation_status") @db.VarChar(32)

  calculationVersion String @map("calculation_version") @db.VarChar(64)
  policyVersion String @map("policy_version") @db.VarChar(64)

  idempotencyKey String @map("idempotency_key") @db.VarChar(255)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  period PortfolioAccountingPeriod @relation(fields: [periodId], references: [id], onDelete: Cascade)

  @@index([tenantId, periodId, createdAt])
  @@map("portfolio_accounting_closes")
  @@unique([tenantId, idempotencyKey])
}

model PortfolioPerformanceRecord {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  profileId String @map("profile_id") @db.Uuid
  periodId String? @map("period_id") @db.Uuid

  methodology PortfolioReturnMethodology
  periodStart DateTime @map("period_start") @db.Timestamptz(6)
  periodEnd DateTime @map("period_end") @db.Timestamptz(6)

  startingNav String? @map("starting_nav") @db.VarChar(64)
  endingNav String? @map("ending_nav") @db.VarChar(64)

  externalCashFlows Json @default("[]") @map("external_cash_flows")
  feesTreatment String @map("fees_treatment") @db.VarChar(32)

  returnPercent String? @map("return_percent") @db.VarChar(32)
  benchmarkReturn String? @map("benchmark_return") @db.VarChar(32)
  excessReturn String? @map("excess_return") @db.VarChar(32)

  baseCurrency String @map("base_currency") @db.VarChar(16)

  calculationVersion String @map("calculation_version") @db.VarChar(64)
  policyVersion String @map("policy_version") @db.VarChar(64)

  dataCompleteness String @default("COMPLETE") @map("data_completeness") @db.VarChar(32)

  valuationTimestamp DateTime? @map("valuation_timestamp") @db.Timestamptz(6)
  sourceReferences Json @default("[]") @map("source_references")
  evidence Json @default("{}")

  idempotencyKey String @map("idempotency_key") @db.VarChar(255)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  profile PortfolioAccountingProfile @relation(fields: [profileId], references: [id], onDelete: Cascade)
  period PortfolioAccountingPeriod? @relation(fields: [periodId], references: [id], onDelete: SetNull)

  @@index([tenantId, profileId, methodology, periodStart])
  @@index([tenantId, periodId])
  @@map("portfolio_performance_records")
  @@unique([tenantId, idempotencyKey])
}

model PortfolioAttributionRecord {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  profileId String @map("profile_id") @db.Uuid
  periodId String? @map("period_id") @db.Uuid

  dimension PortfolioAttributionDimension
  dimensionId String @map("dimension_id") @db.VarChar(128)

  pnlContribution String @map("pnl_contribution") @db.VarChar(64)
  grossPnl String? @map("gross_pnl") @db.VarChar(64)
  fees String? @db.VarChar(64)
  netPnl String? @map("net_pnl") @db.VarChar(64)

  quantity String? @db.VarChar(64)
  exposure String? @db.VarChar(64)

  baseCurrency String @map("base_currency") @db.VarChar(16)

  calculationVersion String @map("calculation_version") @db.VarChar(64)
  policyVersion String @map("policy_version") @db.VarChar(64)

  dataCompleteness String @default("COMPLETE") @map("data_completeness") @db.VarChar(32)

  sourceReferences Json @default("[]") @map("source_references")
  evidence Json @default("{}")

  idempotencyKey String @map("idempotency_key") @db.VarChar(255)

  periodStart DateTime @map("period_start") @db.Timestamptz(6)
  periodEnd DateTime @map("period_end") @db.Timestamptz(6)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  profile PortfolioAccountingProfile @relation(fields: [profileId], references: [id], onDelete: Cascade)
  period PortfolioAccountingPeriod? @relation(fields: [periodId], references: [id], onDelete: SetNull)

  @@index([tenantId, profileId, dimension, periodStart])
  @@index([tenantId, periodId, dimension])
  @@map("portfolio_attribution_records")
  @@unique([tenantId, idempotencyKey])
}

model PortfolioStatement {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  profileId String @map("profile_id") @db.Uuid
  periodId String? @map("period_id") @db.Uuid

  statementId String @unique @map("statement_id") @db.VarChar(128)

  state PortfolioStatementState @default(DRAFT)

  periodStart DateTime @map("period_start") @db.Timestamptz(6)
  periodEnd DateTime @map("period_end") @db.Timestamptz(6)

  openingNav String? @map("opening_nav") @db.VarChar(64)
  closingNav String? @map("closing_nav") @db.VarChar(64)

  deposits String? @db.VarChar(64)
  withdrawals String? @db.VarChar(64)
  transfers String? @db.VarChar(64)

  tradingActivity Json @default("[]") @map("trading_activity")
  realizedPnl String? @map("realized_pnl") @db.VarChar(64)
  unrealizedPnl String? @map("unrealized_pnl") @db.VarChar(64)
  fees Json @default("{}")
  netPnl String? @map("net_pnl") @db.VarChar(64)

  returnMethodology String? @map("return_methodology") @db.VarChar(32)
  returnPercent String? @map("return_percent") @db.VarChar(32)
  benchmarkReturn String? @map("benchmark_return") @db.VarChar(32)

  endingHoldings Json @default("[]") @map("ending_holdings")
  cash String? @db.VarChar(64)

  reconciliationStatus String? @map("reconciliation_status") @db.VarChar(32)

  baseCurrency String @map("base_currency") @db.VarChar(16)

  calculationVersion String @map("calculation_version") @db.VarChar(64)
  policyVersion String @map("policy_version") @db.VarChar(64)

  sourceReferences Json @default("[]") @map("source_references")
  evidence Json @default("{}")

  idempotencyKey String @map("idempotency_key") @db.VarChar(255)

  finalizedAt DateTime? @map("finalized_at") @db.Timestamptz(6)
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  profile PortfolioAccountingProfile @relation(fields: [profileId], references: [id], onDelete: Cascade)
  period PortfolioAccountingPeriod? @relation(fields: [periodId], references: [id], onDelete: SetNull)

  @@index([tenantId, profileId, periodStart])
  @@index([tenantId, statementId])
  @@index([profileId, state, periodStart])
  @@map("portfolio_statements")
  @@unique([tenantId, idempotencyKey])
}

model PortfolioAccountingReconciliation {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  profileId String? @map("profile_id") @db.Uuid

  reconciliationType String @map("reconciliation_type") @db.VarChar(64)
  state PortfolioReconciliationState @default(PENDING)

  expected Json? @default("{}")
  actual Json? @default("{}")
  discrepancy Json? @default("{}")

  summary String @db.VarChar(1000)

  severity String @default("MEDIUM") @db.VarChar(16)
  isCritical Boolean @default(false) @map("is_critical")

  sourceType String? @map("source_type") @db.VarChar(64)
  sourceId String? @map("source_id") @db.VarChar(255)

  periodId String? @map("period_id") @db.Uuid

  resolved Boolean @default(false)
  resolvedAt DateTime? @map("resolved_at") @db.Timestamptz(6)
  resolvedBy String? @map("resolved_by") @db.Uuid
  resolutionNote String? @map("resolution_note") @db.VarChar(1000)

  calculationVersion String @map("calculation_version") @db.VarChar(64)
  policyVersion String? @map("policy_version") @db.VarChar(64)

  correlationId String? @map("correlation_id") @db.VarChar(64)
  idempotencyKey String @map("idempotency_key") @db.VarChar(255)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@index([tenantId, profileId, reconciliationType, state])
  @@index([tenantId, state, isCritical, createdAt])
  @@index([tenantId, periodId])
  @@map("portfolio_accounting_reconciliations")
  @@unique([tenantId, idempotencyKey])
}

model PortfolioAccountingAdjustment {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  profileId String @map("profile_id") @db.Uuid
  originalEventId String? @map("original_event_id") @db.Uuid

  adjustmentType PortfolioAdjustmentType @map("adjustment_type")

  reason String @db.VarChar(1000)
  requestedBy String? @map("requested_by") @db.Uuid
  approvedBy String? @map("approved_by") @db.Uuid

  originalValues Json? @map("original_values")
  adjustedValues Json @map("adjusted_values")

  amount String? @db.VarChar(64)
  currency String? @db.VarChar(16)

  reversalEventId String? @map("reversal_event_id") @db.Uuid

  calculationVersion String @map("calculation_version") @db.VarChar(64)
  policyVersion String @map("policy_version") @db.VarChar(64)

  correlationId String? @map("correlation_id") @db.VarChar(64)
  idempotencyKey String @map("idempotency_key") @db.VarChar(255)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  originalEvent PortfolioAccountingEvent? @relation(fields: [originalEventId], references: [id], onDelete: SetNull)

  @@index([tenantId, profileId, adjustmentType, createdAt])
  @@index([tenantId, originalEventId])
  @@map("portfolio_accounting_adjustments")
  @@unique([tenantId, idempotencyKey])
}


// ==================== Part 20 — Client Lifecycle Enums ====================

enum ClientProfileStatus {
  PENDING
  ONBOARDING
  UNDER_REVIEW
  APPROVED
  ACTIVE
  RESTRICTED
  SUSPENDED
  CLOSURE_PENDING
  CLOSED
}

enum InstitutionalAccountState {
  PENDING
  ONBOARDING
  UNDER_REVIEW
  APPROVED
  ACTIVE
  RESTRICTED
  SUSPENDED
  CLOSURE_PENDING
  CLOSED
}

enum ClientOnboardingState {
  NOT_STARTED
  IN_PROGRESS
  PENDING_REVIEW
  APPROVED
  REJECTED
  CANCELLED
}

enum ClientOnboardingStepType {
  PROFILE_CREATED
  IDENTITY_REQUIRED
  KYC_PENDING
  AML_PENDING
  SECURITY_SETUP_REQUIRED
  COMPLIANCE_REVIEW
  RISK_REVIEW
  ACCOUNT_CONFIGURATION
  EXCHANGE_BINDING
  PORTFOLIO_BINDING
  APPROVAL
  ACTIVATION_ELIGIBILITY
}

enum ClientOnboardingStepStatus {
  PENDING
  IN_PROGRESS
  COMPLETED
  FAILED
  BLOCKED
  SKIPPED
}

enum AccountOwnershipType {
  OWNER
  MANAGER
  OPERATOR
  BENEFICIAL_OWNER
}

enum AccountRelationshipType {
  CLIENT_TO_MANAGED_ACCOUNT
  CLIENT_TO_PORTFOLIO
  CLIENT_TO_EXCHANGE_ACCOUNT
  CLIENT_TO_FOLLOWER
  CLIENT_TO_TRADER
  CLIENT_TO_STRATEGY
  TRADER_TO_FOLLOWER
  CLIENT_TO_CLIENT
  OPERATOR_TO_ACCOUNT
}

enum RelationshipStatus {
  ACTIVE
  INACTIVE
  PENDING
  REVOKED
}

enum AccountRestrictionType {
  NO_TRADING
  NO_COPY_TRADING
  NO_WITHDRAWAL
  NO_DEPOSIT
  READ_ONLY
  REVIEW_REQUIRED
  ACCOUNT_LOCKED
  COMPLIANCE_HOLD
  SECURITY_HOLD
  RISK_HOLD
  OPERATIONAL_HOLD
}

enum RestrictionScope {
  ACCOUNT
  CLIENT
  TENANT
  GLOBAL
}

enum RestrictionStatus {
  ACTIVE
  EXPIRED
  REVOKED
  PENDING
}

enum FundingRequestState {
  REQUESTED
  UNDER_REVIEW
  APPROVED
  SUBMITTED
  CONFIRMED
  FAILED
  REVERSED
  CANCELLED
}

enum WithdrawalRequestState {
  REQUESTED
  UNDER_REVIEW
  APPROVED
  SUBMITTED
  CONFIRMED
  FAILED
  REVERSED
  CANCELLED
}

enum FundingApprovalDecision {
  APPROVED
  REJECTED
  PENDING
  ESCALATED
}

enum ClientReviewType {
  PERIODIC
  MANUAL
  COMPLIANCE
  RISK
  SECURITY
  OPERATIONAL
}

enum ClientReviewDecision {
  APPROVED
  REJECTED
  ESCALATED
  PENDING
  REVIEW_REQUIRED
}

enum TradingEligibilityStatus {
  ELIGIBLE
  BLOCKED
  REVIEW_REQUIRED
}

// ==================== Part 20 — Client Lifecycle Models ====================

model ClientProfile {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  clientType String @default("CLIENT") @map("client_type") @db.VarChar(32)
  status ClientProfileStatus @default(PENDING)

  legalName String? @map("legal_name") @db.VarChar(160)
  displayName String? @map("display_name") @db.VarChar(120)
  email String? @db.VarChar(254)
  phone String? @db.VarChar(32)
  countryCode String? @map("country_code") @db.Char(2)

  externalIdentityRef String? @map("external_identity_ref") @db.VarChar(255)
  kycReferenceId String? @map("kyc_reference_id") @db.Uuid
  amlReferenceId String? @map("aml_reference_id") @db.Uuid
  complianceCaseId String? @map("compliance_case_id") @db.Uuid
  riskProfileId String? @map("risk_profile_id") @db.Uuid

  onboardingId String? @map("onboarding_id") @db.Uuid

  metadata Json @default("{}")
  piiHash String? @map("pii_hash") @db.VarChar(255)

  idempotencyKey String @map("idempotency_key") @db.VarChar(255)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)
  deletedAt DateTime? @map("deleted_at") @db.Timestamptz(6)

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  onboardings ClientOnboarding[]
  accounts InstitutionalAccount[]
  ownerships AccountOwnership[]
  relationships AccountRelationship[]
  restrictions AccountRestriction[]
  reviews ClientReview[]
  fundingRequests FundingRequest[]
  withdrawalRequests WithdrawalRequest[]
  lifecycleAudits ClientLifecycleAudit[]

  @@index([tenantId, status])
  @@index([tenantId, email])
  @@index([tenantId, externalIdentityRef])
  @@map("client_profiles")
  @@unique([tenantId, idempotencyKey])
}

model ClientOnboarding {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  clientProfileId String @map("client_profile_id") @db.Uuid

  state ClientOnboardingState @default(NOT_STARTED)

  currentStep ClientOnboardingStepType? @map("current_step")

  requiredSteps Json @default("[]") @map("required_steps")
  completedSteps Json @default("[]") @map("completed_steps")

  blockingReasons Json @default("[]") @map("blocking_reasons")

  initiatedBy String? @map("initiated_by") @db.Uuid
  approvedBy String? @map("approved_by") @db.Uuid

  kycState String? @map("kyc_state") @db.VarChar(32)
  amlState String? @map("aml_state") @db.VarChar(32)
  complianceDecision String? @map("compliance_decision") @db.VarChar(32)
  riskDecision String? @map("risk_decision") @db.VarChar(32)
  securityState String? @map("security_state") @db.VarChar(32)

  complianceCaseId String? @map("compliance_case_id") @db.Uuid

  metadata Json @default("{}")
  evidence Json @default("{}")

  idempotencyKey String @map("idempotency_key") @db.VarChar(255)

  startedAt DateTime? @map("started_at") @db.Timestamptz(6)
  completedAt DateTime? @map("completed_at") @db.Timestamptz(6)
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  clientProfile ClientProfile @relation(fields: [clientProfileId], references: [id], onDelete: Cascade)

  steps ClientOnboardingStep[]

  @@index([tenantId, clientProfileId, state])
  @@index([tenantId, state])
  @@map("client_onboardings")
  @@unique([tenantId, idempotencyKey])
}

model ClientOnboardingStep {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  onboardingId String @map("onboarding_id") @db.Uuid

  stepType ClientOnboardingStepType @map("step_type")
  status ClientOnboardingStepStatus @default(PENDING)

  required Boolean @default(true)

  blockingReasons Json @default("[]") @map("blocking_reasons")
  evidence Json @default("{}")
  metadata Json @default("{}")

  completedBy String? @map("completed_by") @db.Uuid
  completedAt DateTime? @map("completed_at") @db.Timestamptz(6)

  sourceType String? @map("source_type") @db.VarChar(64)
  sourceId String? @map("source_id") @db.VarChar(255)
  sourceTimestamp DateTime? @map("source_timestamp") @db.Timestamptz(6)

  idempotencyKey String @map("idempotency_key") @db.VarChar(255)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  onboarding ClientOnboarding @relation(fields: [onboardingId], references: [id], onDelete: Cascade)

  @@index([tenantId, onboardingId, stepType])
  @@index([tenantId, onboardingId, status])
  @@map("client_onboarding_steps")
  @@unique([tenantId, idempotencyKey])
}

model InstitutionalAccount {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  clientProfileId String? @map("client_profile_id") @db.Uuid

  accountType String @default("TRADING") @map("account_type") @db.VarChar(32)
  state InstitutionalAccountState @default(PENDING)

  displayName String? @map("display_name") @db.VarChar(120)

  ownerId String? @map("owner_id") @db.Uuid
  ownerType String? @map("owner_type") @db.VarChar(32)

  exchangeAccountId String? @map("exchange_account_id") @db.Uuid
  portfolioId String? @map("portfolio_id") @db.Uuid

  isTradingEnabled Boolean @default(false) @map("is_trading_enabled")
  isFundingEnabled Boolean @default(false) @map("is_funding_enabled")
  isWithdrawalEnabled Boolean @default(false) @map("is_withdrawal_enabled")

  tradingEligibility TradingEligibilityStatus? @map("trading_eligibility")
  eligibilityEvidence Json? @map("eligibility_evidence")
  blockingReasons Json @default("[]") @map("blocking_reasons")

  complianceStatus String? @map("compliance_status") @db.VarChar(32)
  riskStatus String? @map("risk_status") @db.VarChar(32)
  securityStatus String? @map("security_status") @db.VarChar(32)

  metadata Json @default("{}")

  idempotencyKey String @map("idempotency_key") @db.VarChar(255)

  activatedAt DateTime? @map("activated_at") @db.Timestamptz(6)
  suspendedAt DateTime? @map("suspended_at") @db.Timestamptz(6)
  closedAt DateTime? @map("closed_at") @db.Timestamptz(6)
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)
  deletedAt DateTime? @map("deleted_at") @db.Timestamptz(6)

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  clientProfile ClientProfile? @relation(fields: [clientProfileId], references: [id], onDelete: SetNull)

  ownerships AccountOwnership[]
  relationships AccountRelationship[]
  restrictions AccountRestriction[]
  fundingRequests FundingRequest[]
  withdrawalRequests WithdrawalRequest[]
  reviews ClientReview[]
  lifecycleAudits ClientLifecycleAudit[]

  @@index([tenantId, clientProfileId, state])
  @@index([tenantId, state])
  @@index([tenantId, ownerId])
  @@index([tenantId, exchangeAccountId])
  @@index([tenantId, portfolioId])
  @@map("institutional_accounts")
  @@unique([tenantId, idempotencyKey])
}

model AccountOwnership {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  accountId String @map("account_id") @db.Uuid
  clientProfileId String? @map("client_profile_id") @db.Uuid

  ownerId String @map("owner_id") @db.Uuid
  ownerType String @map("owner_type") @db.VarChar(32)

  ownershipType AccountOwnershipType @default(OWNER) @map("ownership_type")

  status RelationshipStatus @default(ACTIVE)

  effectiveAt DateTime @default(now()) @map("effective_at") @db.Timestamptz(6)
  endedAt DateTime? @map("ended_at") @db.Timestamptz(6)

  createdBy String? @map("created_by") @db.Uuid
  source String? @db.VarChar(64)

  idempotencyKey String @map("idempotency_key") @db.VarChar(255)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  account InstitutionalAccount @relation(fields: [accountId], references: [id], onDelete: Cascade)
  clientProfile ClientProfile? @relation(fields: [clientProfileId], references: [id], onDelete: SetNull)

  @@index([tenantId, accountId, status])
  @@index([tenantId, ownerId, status])
  @@index([tenantId, clientProfileId])
  @@map("account_ownerships")
  @@unique([tenantId, idempotencyKey])
}

model AccountRelationship {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  sourceId String @map("source_id") @db.Uuid
  sourceType String @map("source_type") @db.VarChar(32)
  targetId String @map("target_id") @db.Uuid
  targetType String @map("target_type") @db.VarChar(32)

  relationshipType AccountRelationshipType @map("relationship_type")
  status RelationshipStatus @default(ACTIVE)

  effectiveAt DateTime @default(now()) @map("effective_at") @db.Timestamptz(6)
  endedAt DateTime? @map("ended_at") @db.Timestamptz(6)

  clientProfileId String? @map("client_profile_id") @db.Uuid
  accountId String? @map("account_id") @db.Uuid

  createdBy String? @map("created_by") @db.Uuid
  source String? @db.VarChar(64)

  metadata Json @default("{}")

  idempotencyKey String @map("idempotency_key") @db.VarChar(255)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  clientProfile ClientProfile? @relation(fields: [clientProfileId], references: [id], onDelete: SetNull)
  account InstitutionalAccount? @relation(fields: [accountId], references: [id], onDelete: SetNull)

  @@index([tenantId, sourceId, relationshipType, status])
  @@index([tenantId, targetId, relationshipType, status])
  @@index([tenantId, clientProfileId])
  @@index([tenantId, accountId])
  @@map("account_relationships")
  @@unique([tenantId, idempotencyKey])
}

model AccountRestriction {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  accountId String? @map("account_id") @db.Uuid
  clientProfileId String? @map("client_profile_id") @db.Uuid

  restrictionType AccountRestrictionType @map("restriction_type")
  scope RestrictionScope @default(ACCOUNT)
  status RestrictionStatus @default(ACTIVE)

  reason String @db.VarChar(1000)
  source String @db.VarChar(64)
  createdBy String? @map("created_by") @db.Uuid

  effectiveAt DateTime @default(now()) @map("effective_at") @db.Timestamptz(6)
  expiresAt DateTime? @map("expires_at") @db.Timestamptz(6)
  revokedAt DateTime? @map("revoked_at") @db.Timestamptz(6)
  revokedBy String? @map("revoked_by") @db.Uuid

  auditReference String? @map("audit_reference") @db.VarChar(255)

  metadata Json @default("{}")

  idempotencyKey String @map("idempotency_key") @db.VarChar(255)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  account InstitutionalAccount? @relation(fields: [accountId], references: [id], onDelete: Cascade)
  clientProfile ClientProfile? @relation(fields: [clientProfileId], references: [id], onDelete: SetNull)

  @@index([tenantId, accountId, restrictionType, status])
  @@index([tenantId, clientProfileId, status])
  @@index([tenantId, status, effectiveAt])
  @@map("account_restrictions")
  @@unique([tenantId, idempotencyKey])
}

model ClientReview {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  clientProfileId String? @map("client_profile_id") @db.Uuid
  accountId String? @map("account_id") @db.Uuid

  reviewType ClientReviewType @map("review_type")
  decision ClientReviewDecision @default(PENDING) @map("review_decision")

  reviewerId String? @map("reviewer_id") @db.Uuid
  reason String? @db.VarChar(1000)

  evidenceReferences Json @default("[]") @map("evidence_references")
  riskSummaryReference String? @map("risk_summary_reference") @db.VarChar(255)
  complianceSummaryReference String? @map("compliance_summary_reference") @db.VarChar(255)
  securitySummaryReference String? @map("security_summary_reference") @db.VarChar(255)
  activitySummary Json? @map("activity_summary")

  reviewPeriodStart DateTime? @map("review_period_start") @db.Timestamptz(6)
  reviewPeriodEnd DateTime? @map("review_period_end") @db.Timestamptz(6)

  nextReviewDate DateTime? @map("next_review_date") @db.Timestamptz(6)

  metadata Json @default("{}")

  idempotencyKey String @map("idempotency_key") @db.VarChar(255)

  reviewedAt DateTime? @map("reviewed_at") @db.Timestamptz(6)
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  clientProfile ClientProfile? @relation(fields: [clientProfileId], references: [id], onDelete: SetNull)
  account InstitutionalAccount? @relation(fields: [accountId], references: [id], onDelete: SetNull)

  @@index([tenantId, clientProfileId, reviewType, decision])
  @@index([tenantId, accountId, reviewType])
  @@index([tenantId, nextReviewDate])
  @@map("client_reviews")
  @@unique([tenantId, idempotencyKey])
}

model FundingRequest {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  clientProfileId String? @map("client_profile_id") @db.Uuid
  accountId String @map("account_id") @db.Uuid

  state FundingRequestState @default(REQUESTED)

  requestedAmount String @map("requested_amount") @db.VarChar(64)
  approvedAmount String? @map("approved_amount") @db.VarChar(64)
  submittedAmount String? @map("submitted_amount") @db.VarChar(64)
  confirmedAmount String? @map("confirmed_amount") @db.VarChar(64)
  settledAmount String? @map("settled_amount") @db.VarChar(64)

  currency String @db.VarChar(16)

  externalReference String? @map("external_reference") @db.VarChar(255)
  sourceType String? @map("source_type") @db.VarChar(64)
  sourceId String? @map("source_id") @db.VarChar(255)

  requestedBy String? @map("requested_by") @db.Uuid
  approvedBy String? @map("approved_by") @db.Uuid

  approvalPolicyVersion String? @map("approval_policy_version") @db.VarChar(64)
  calculationVersion String @default("client-lifecycle-v1.0.0") @map("calculation_version") @db.VarChar(64)

  failureReason String? @map("failure_reason") @db.VarChar(1000)
  reversalReason String? @map("reversal_reason") @db.VarChar(1000)

  metadata Json @default("{}")
  evidence Json @default("{}")

  idempotencyKey String @map("idempotency_key") @db.VarChar(255)

  requestedAt DateTime @default(now()) @map("requested_at") @db.Timestamptz(6)
  approvedAt DateTime? @map("approved_at") @db.Timestamptz(6)
  submittedAt DateTime? @map("submitted_at") @db.Timestamptz(6)
  confirmedAt DateTime? @map("confirmed_at") @db.Timestamptz(6)
  failedAt DateTime? @map("failed_at") @db.Timestamptz(6)
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  clientProfile ClientProfile? @relation(fields: [clientProfileId], references: [id], onDelete: SetNull)
  account InstitutionalAccount @relation(fields: [accountId], references: [id], onDelete: Cascade)

  approvals FundingApproval[]
  reconciliations FundingReconciliation[]

  @@index([tenantId, accountId, state])
  @@index([tenantId, clientProfileId, state])
  @@index([tenantId, externalReference])
  @@index([tenantId, state, requestedAt])
  @@map("funding_requests")
  @@unique([tenantId, idempotencyKey])
}

model WithdrawalRequest {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  clientProfileId String? @map("client_profile_id") @db.Uuid
  accountId String @map("account_id") @db.Uuid

  state WithdrawalRequestState @default(REQUESTED)

  requestedAmount String @map("requested_amount") @db.VarChar(64)
  approvedAmount String? @map("approved_amount") @db.VarChar(64)
  submittedAmount String? @map("submitted_amount") @db.VarChar(64)
  confirmedAmount String? @map("confirmed_amount") @db.VarChar(64)
  settledAmount String? @map("settled_amount") @db.VarChar(64)

  currency String @db.VarChar(16)

  destinationAddress String? @map("destination_address") @db.VarChar(512)
  destinationType String? @map("destination_type") @db.VarChar(64)

  externalReference String? @map("external_reference") @db.VarChar(255)
  sourceType String? @map("source_type") @db.VarChar(64)
  sourceId String? @map("source_id") @db.VarChar(255)

  requestedBy String? @map("requested_by") @db.Uuid
  approvedBy String? @map("approved_by") @db.Uuid

  approvalPolicyVersion String? @map("approval_policy_version") @db.VarChar(64)
  calculationVersion String @default("client-lifecycle-v1.0.0") @map("calculation_version") @db.VarChar(64)

  failureReason String? @map("failure_reason") @db.VarChar(1000)
  reversalReason String? @map("reversal_reason") @db.VarChar(1000)

  complianceCheckId String? @map("compliance_check_id") @db.Uuid
  riskCheckId String? @map("risk_check_id") @db.Uuid
  securityCheckId String? @map("security_check_id") @db.Uuid

  metadata Json @default("{}")
  evidence Json @default("{}")

  idempotencyKey String @map("idempotency_key") @db.VarChar(255)

  requestedAt DateTime @default(now()) @map("requested_at") @db.Timestamptz(6)
  approvedAt DateTime? @map("approved_at") @db.Timestamptz(6)
  submittedAt DateTime? @map("submitted_at") @db.Timestamptz(6)
  confirmedAt DateTime? @map("confirmed_at") @db.Timestamptz(6)
  failedAt DateTime? @map("failed_at") @db.Timestamptz(6)
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  clientProfile ClientProfile? @relation(fields: [clientProfileId], references: [id], onDelete: SetNull)
  account InstitutionalAccount @relation(fields: [accountId], references: [id], onDelete: Cascade)

  approvals FundingApproval[]
  reconciliations FundingReconciliation[]

  @@index([tenantId, accountId, state])
  @@index([tenantId, clientProfileId, state])
  @@index([tenantId, externalReference])
  @@index([tenantId, state, requestedAt])
  @@map("withdrawal_requests")
  @@unique([tenantId, idempotencyKey])
}

model FundingApproval {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  fundingRequestId String? @map("funding_request_id") @db.Uuid
  withdrawalRequestId String? @map("withdrawal_request_id") @db.Uuid

  decision FundingApprovalDecision @default(PENDING)

  approverId String? @map("approver_id") @db.Uuid
  reason String? @db.VarChar(1000)

  approvalPolicyVersion String? @map("approval_policy_version") @db.VarChar(64)
  evidence Json @default("{}")
  metadata Json @default("{}")

  idempotencyKey String @map("idempotency_key") @db.VarChar(255)

  decidedAt DateTime? @map("decided_at") @db.Timestamptz(6)
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  fundingRequest FundingRequest? @relation(fields: [fundingRequestId], references: [id], onDelete: SetNull)
  withdrawalRequest WithdrawalRequest? @relation(fields: [withdrawalRequestId], references: [id], onDelete: SetNull)

  @@index([tenantId, fundingRequestId, decision])
  @@index([tenantId, withdrawalRequestId, decision])
  @@map("funding_approvals")
  @@unique([tenantId, idempotencyKey])
}

model FundingReconciliation {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  fundingRequestId String? @map("funding_request_id") @db.Uuid
  withdrawalRequestId String? @map("withdrawal_request_id") @db.Uuid

  reconciliationType String @map("reconciliation_type") @db.VarChar(64)

  expected Json? @default("{}")
  actual Json? @default("{}")
  discrepancyType String? @map("discrepancy_type") @db.VarChar(64)
  discrepancyDetails Json? @map("discrepancy_details")

  isCritical Boolean @default(false) @map("is_critical")
  isResolved Boolean @default(false) @map("is_resolved")
  resolvedAt DateTime? @map("resolved_at") @db.Timestamptz(6)
  resolvedBy String? @map("resolved_by") @db.Uuid

  sourceType String? @map("source_type") @db.VarChar(64)
  sourceId String? @map("source_id") @db.VarChar(255)

  externalReference String? @map("external_reference") @db.VarChar(255)

  calculationVersion String @default("client-lifecycle-v1.0.0") @map("calculation_version") @db.VarChar(64)

  idempotencyKey String @map("idempotency_key") @db.VarChar(255)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  fundingRequest FundingRequest? @relation(fields: [fundingRequestId], references: [id], onDelete: SetNull)
  withdrawalRequest WithdrawalRequest? @relation(fields: [withdrawalRequestId], references: [id], onDelete: SetNull)

  @@index([tenantId, fundingRequestId, reconciliationType])
  @@index([tenantId, withdrawalRequestId, reconciliationType])
  @@index([tenantId, externalReference])
  @@map("funding_reconciliations")
  @@unique([tenantId, idempotencyKey])
}

model ClientLifecycleAudit {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  clientProfileId String? @map("client_profile_id") @db.Uuid
  accountId String? @map("account_id") @db.Uuid

  action String @db.VarChar(128)
  entityType String @map("entity_type") @db.VarChar(64)
  entityId String? @map("entity_id") @db.Uuid

  actorId String? @map("actor_id") @db.Uuid
  actorType String? @map("actor_type") @db.VarChar(32)

  fromState String? @map("from_state") @db.VarChar(64)
  toState String? @map("to_state") @db.VarChar(64)

  reason String? @db.VarChar(1000)

  sourceType String? @map("source_type") @db.VarChar(64)
  sourceId String? @map("source_id") @db.VarChar(255)

  evidence Json @default("{}")
  metadata Json @default("{}")

  correlationId String? @map("correlation_id") @db.VarChar(64)
  idempotencyKey String? @map("idempotency_key") @db.VarChar(255)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  clientProfile ClientProfile? @relation(fields: [clientProfileId], references: [id], onDelete: SetNull)
  account InstitutionalAccount? @relation(fields: [accountId], references: [id], onDelete: SetNull)

  @@index([tenantId, clientProfileId, action, createdAt])
  @@index([tenantId, accountId, action, createdAt])
  @@index([tenantId, entityType, entityId])
  @@map("client_lifecycle_audits")
}


// ==================== Part 21 — Custody Enums ====================

enum CustodyWalletState {
  PENDING
  ACTIVE
  RESTRICTED
  SUSPENDED
  CLOSURE_PENDING
  CLOSED
}

enum CustodyWalletAddressState {
  GENERATING
  ACTIVE
  RESERVED
  DEPRECATED
  BLOCKED
}

enum CustodyDepositState {
  EXPECTED
  OBSERVED
  CONFIRMING
  CONFIRMED
  FAILED
  REORGED
  REJECTED
}

enum CustodyWithdrawalState {
  REQUESTED
  UNDER_REVIEW
  APPROVED
  QUEUED
  SUBMITTED
  CONFIRMING
  CONFIRMED
  FAILED
  REJECTED
  CANCELLED
  REORGED
}

enum CustodyTransactionState {
  PENDING
  SUBMITTED
  OBSERVED
  CONFIRMING
  CONFIRMED
  FINAL
  FAILED
  DROPPED
  REPLACED
  REORGED
}

enum CustodyConfirmationState {
  OBSERVED
  REQUIRED
  CONFIRMED
  FINAL
  FAILED
  REORGED
}

enum CustodyInternalTransferState {
  REQUESTED
  APPROVED
  SETTLING
  SETTLED
  FAILED
  CANCELLED
}

enum CustodyReserveState {
  ACTIVE
  INSUFFICIENT
  SUFFICIENT
  LOCKED
  PENDING
}

enum CustodySweepState {
  REQUESTED
  APPROVED
  SUBMITTING
  CONFIRMING
  SETTLED
  FAILED
  CANCELLED
}

enum CustodySettlementState {
  PENDING
  SETTLED
  FAILED
  REORGED
}

enum CustodyScope {
  PLATFORM
  TENANT
  ACCOUNT
  WALLET
}

enum CustodyReconciliationType {
  WALLET
  TRANSACTION
  DEPOSIT
  WITHDRAWAL
  BALANCE
  RESERVE
  FEE
  CONFIRMATION
  SETTLEMENT
}

enum CustodyAuditAction {
  WALLET_CREATED
  WALLET_ACTIVATED
  WALLET_RESTRICTED
  WALLET_SUSPENDED
  WALLET_CLOSED
  ADDRESS_GENERATED
  ADDRESS_VERIFIED
  DEPOSIT_OBSERVED
  DEPOSIT_CONFIRMED
  DEPOSIT_REORGED
  WITHDRAWAL_REQUESTED
  WITHDRAWAL_APPROVED
  WITHDRAWAL_SUBMITTED
  WITHDRAWAL_CONFIRMED
  WITHDRAWAL_FAILED
  TRANSACTION_CREATED
  TRANSACTION_OBSERVED
  TRANSACTION_CONFIRMED
  TRANSACTION_FAILED
  TRANSACTION_REORGED
  CONFIRMATION_OBSERVED
  INTERNAL_TRANSFER_CREATED
  INTERNAL_TRANSFER_SETTLED
  SWEEP_REQUESTED
  SWEEP_APPROVED
  SWEEP_SETTLED
  RESERVE_UPDATED
  RECONCILIATION_RUN
  SETTLEMENT_FINALIZED
}

// ==================== Part 21 — Custody Models ====================

model CustodyAsset {
  id       String @id @default(uuid()) @db.Uuid

  assetId String @unique @map("asset_id") @db.VarChar(128)
  symbol String @db.VarChar(32)
  name String @db.VarChar(128)

  decimals Int
  displayPrecision Int @default(8) @map("display_precision")

  isNative Boolean @default(false) @map("is_native")
  isActive Boolean @default(true) @map("is_active")

  contractAddress String? @map("contract_address") @db.VarChar(255)
  tokenStandard String? @map("token_standard") @db.VarChar(32)

  chainId String? @map("chain_id") @db.VarChar(64)
  networkId String? @map("network_id") @db.VarChar(64)

  metadata Json @default("{}")

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  wallets CustodyWallet[]
  addresses CustodyWalletAddress[]
  deposits CustodyDeposit[]
  withdrawals CustodyWithdrawal[]
  transactions CustodyTransaction[]
  reserves CustodyReserve[]

  @@index([symbol, isActive])
  @@index([networkId, isActive])
  @@map("custody_assets")
}

model CustodyNetwork {
  id       String @id @default(uuid()) @db.Uuid

  networkId String @unique @map("network_id") @db.VarChar(64)
  chainId String? @map("chain_id") @db.VarChar(64)
  name String @db.VarChar(128)

  nativeAssetId String? @map("native_asset_id") @db.VarChar(128)
  nativeAssetSymbol String? @map("native_asset_symbol") @db.VarChar(32)

  explorerUrl String? @map("explorer_url") @db.VarChar(512)
  rpcUrl String? @map("rpc_url") @db.VarChar(512)

  finalityModel String? @map("finality_model") @db.VarChar(32)
  confirmationPolicy Json? @map("confirmation_policy")

  status String @default("ACTIVE") @db.VarChar(32)

  providerCapabilities Json @default("[]") @map("provider_capabilities")

  metadata Json @default("{}")

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  wallets CustodyWallet[]
  addresses CustodyWalletAddress[]
  deposits CustodyDeposit[]
  withdrawals CustodyWithdrawal[]
  transactions CustodyTransaction[]
  reserves CustodyReserve[]

  @@index([chainId, status])
  @@index([status])
  @@map("custody_networks")
}

model CustodyWallet {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  clientProfileId String? @map("client_profile_id") @db.Uuid
  accountId String? @map("account_id") @db.Uuid

  walletType String @default("HOT") @map("wallet_type") @db.VarChar(32)
  state CustodyWalletState @default(PENDING)
  scope CustodyScope @default(TENANT)

  assetId String? @map("asset_id") @db.VarChar(128)
  networkId String? @map("network_id") @db.VarChar(64)

  provider String? @db.VarChar(64)
  providerReference String? @map("provider_reference") @db.VarChar(255)
  providerMetadata Json? @map("provider_metadata")

  // Never store raw private keys in plaintext — only references
  encryptedSecretReference String? @map("encrypted_secret_reference") @db.VarChar(512)
  credentialFingerprint String? @map("credential_fingerprint") @db.VarChar(255)

  ownerId String? @map("owner_id") @db.Uuid
  ownerType String? @map("owner_type") @db.VarChar(32)

  isActive Boolean @default(false) @map("is_active")

  metadata Json @default("{}")

  idempotencyKey String @map("idempotency_key") @db.VarChar(255)

  activatedAt DateTime? @map("activated_at") @db.Timestamptz(6)
  suspendedAt DateTime? @map("suspended_at") @db.Timestamptz(6)
  closedAt DateTime? @map("closed_at") @db.Timestamptz(6)
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  asset CustodyAsset? @relation(fields: [assetId], references: [assetId], onDelete: SetNull)
  network CustodyNetwork? @relation(fields: [networkId], references: [networkId], onDelete: SetNull)

  addresses CustodyWalletAddress[]
  deposits CustodyDeposit[]
  withdrawals CustodyWithdrawal[]
  transactions CustodyTransaction[]
  internalTransfersFrom CustodyInternalTransfer[] @relation("InternalTransferSource")
  internalTransfersTo CustodyInternalTransfer[] @relation("InternalTransferDestination")
  reserves CustodyReserve[]
  sweepsFrom CustodySweep[] @relation("SweepSource")
  sweepsTo CustodySweep[] @relation("SweepDestination")
  audits CustodyAudit[]

  @@index([tenantId, state])
  @@index([tenantId, assetId, networkId, state])
  @@index([tenantId, clientProfileId])
  @@index([tenantId, accountId])
  @@index([tenantId, provider, providerReference])
  @@map("custody_wallets")
  @@unique([tenantId, idempotencyKey])
}

model CustodyWalletAddress {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  walletId String @map("wallet_id") @db.Uuid

  assetId String? @map("asset_id") @db.VarChar(128)
  networkId String? @map("network_id") @db.VarChar(64)

  address String @db.VarChar(512)

  providerReference String? @map("provider_reference") @db.VarChar(255)
  creationSource String? @map("creation_source") @db.VarChar(64)

  status CustodyWalletAddressState @default(GENERATING)

  label String? @db.VarChar(128)

  isDepositAddress Boolean @default(false) @map("is_deposit_address")
  clientProfileId String? @map("client_profile_id") @db.Uuid
  accountId String? @map("account_id") @db.Uuid

  verified Boolean @default(false)
  verifiedAt DateTime? @map("verified_at") @db.Timestamptz(6)

  metadata Json @default("{}")

  idempotencyKey String @map("idempotency_key") @db.VarChar(255)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)
  activatedAt DateTime? @map("activated_at") @db.Timestamptz(6)
  deprecatedAt DateTime? @map("deprecated_at") @db.Timestamptz(6)

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  wallet CustodyWallet @relation(fields: [walletId], references: [id], onDelete: Cascade)
  asset CustodyAsset? @relation(fields: [assetId], references: [assetId], onDelete: SetNull)
  network CustodyNetwork? @relation(fields: [networkId], references: [networkId], onDelete: SetNull)

  deposits CustodyDeposit[]

  @@unique([tenantId, networkId, address])
  @@index([tenantId, walletId, status])
  @@index([tenantId, assetId, networkId, status])
  @@index([tenantId, address])
  @@index([tenantId, clientProfileId])
  @@index([tenantId, accountId])
  @@map("custody_wallet_addresses")
  @@unique([tenantId, idempotencyKey])
}

model CustodyDeposit {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  walletId String? @map("wallet_id") @db.Uuid
  addressId String? @map("address_id") @db.Uuid

  assetId String @map("asset_id") @db.VarChar(128)
  networkId String @map("network_id") @db.VarChar(64)

  amount String @db.VarChar(64)

  transactionHash String? @map("transaction_hash") @db.VarChar(255)
  blockHash String? @map("block_hash") @db.VarChar(255)
  blockNumber String? @map("block_number") @db.VarChar(64)

  fromAddress String? @map("from_address") @db.VarChar(512)
  toAddress String @map("to_address") @db.VarChar(512)

  providerReference String? @map("provider_reference") @db.VarChar(255)

  state CustodyDepositState @default(EXPECTED)

  confirmationCount Int @default(0) @map("confirmation_count")
  requiredConfirmationCount Int @default(6) @map("required_confirmation_count")

  isFinal Boolean @default(false) @map("is_final")

  observedAt DateTime? @map("observed_at") @db.Timestamptz(6)
  confirmedAt DateTime? @map("confirmed_at") @db.Timestamptz(6)
  failedAt DateTime? @map("failed_at") @db.Timestamptz(6)

  failureReason String? @map("failure_reason") @db.VarChar(1000)

  fundingRequestId String? @map("funding_request_id") @db.Uuid

  metadata Json @default("{}")
  evidence Json @default("{}")

  idempotencyKey String @map("idempotency_key") @db.VarChar(255)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  wallet CustodyWallet? @relation(fields: [walletId], references: [id], onDelete: SetNull)
  address CustodyWalletAddress? @relation(fields: [addressId], references: [id], onDelete: SetNull)
  asset CustodyAsset @relation(fields: [assetId], references: [assetId])
  network CustodyNetwork @relation(fields: [networkId], references: [networkId])

  transactions CustodyTransaction[]

  @@unique([tenantId, networkId, transactionHash, toAddress])
  @@index([tenantId, walletId, state])
  @@index([tenantId, assetId, networkId, state])
  @@index([tenantId, transactionHash])
  @@index([tenantId, toAddress])
  @@map("custody_deposits")
  @@unique([tenantId, idempotencyKey])
}

model CustodyWithdrawal {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  walletId String? @map("wallet_id") @db.Uuid
  accountId String? @map("account_id") @db.Uuid

  assetId String @map("asset_id") @db.VarChar(128)
  networkId String @map("network_id") @db.VarChar(64)

  amount String @db.VarChar(64)

  destinationAddress String @map("destination_address") @db.VarChar(512)
  destinationType String? @map("destination_type") @db.VarChar(64)

  transactionHash String? @map("transaction_hash") @db.VarChar(255)

  providerReference String? @map("provider_reference") @db.VarChar(255)

  state CustodyWithdrawalState @default(REQUESTED)

  fundingRequestId String? @map("funding_request_id") @db.Uuid
  withdrawalRequestId String? @map("withdrawal_request_id") @db.Uuid

  approvedBy String? @map("approved_by") @db.Uuid
  submittedBy String? @map("submitted_by") @db.Uuid

  estimatedFee String? @map("estimated_fee") @db.VarChar(64)
  actualFee String? @map("actual_fee") @db.VarChar(64)
  feeAsset String? @map("fee_asset") @db.VarChar(32)

  confirmationCount Int @default(0) @map("confirmation_count")
  requiredConfirmationCount Int @default(6) @map("required_confirmation_count")

  failureReason String? @map("failure_reason") @db.VarChar(1000)

  metadata Json @default("{}")
  evidence Json @default("{}")

  idempotencyKey String @map("idempotency_key") @db.VarChar(255)

  requestedAt DateTime @default(now()) @map("requested_at") @db.Timestamptz(6)
  approvedAt DateTime? @map("approved_at") @db.Timestamptz(6)
  submittedAt DateTime? @map("submitted_at") @db.Timestamptz(6)
  confirmedAt DateTime? @map("confirmed_at") @db.Timestamptz(6)
  failedAt DateTime? @map("failed_at") @db.Timestamptz(6)
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  wallet CustodyWallet? @relation(fields: [walletId], references: [id], onDelete: SetNull)
  asset CustodyAsset @relation(fields: [assetId], references: [assetId])
  network CustodyNetwork @relation(fields: [networkId], references: [networkId])

  transactions CustodyTransaction[]

  @@index([tenantId, walletId, state])
  @@index([tenantId, accountId, state])
  @@index([tenantId, assetId, networkId, state])
  @@index([tenantId, transactionHash])
  @@map("custody_withdrawals")
  @@unique([tenantId, idempotencyKey])
}

model CustodyTransaction {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  walletId String? @map("wallet_id") @db.Uuid

  assetId String @map("asset_id") @db.VarChar(128)
  networkId String @map("network_id") @db.VarChar(64)

  direction String @db.VarChar(16)

  amount String @db.VarChar(64)

  transactionHash String? @map("transaction_hash") @db.VarChar(255)
  blockHash String? @map("block_hash") @db.VarChar(255)
  blockNumber String? @map("block_number") @db.VarChar(64)

  providerReference String? @map("provider_reference") @db.VarChar(255)
  providerMetadata Json? @map("provider_metadata")

  status CustodyTransactionState @default(PENDING)

  confirmationCount Int @default(0) @map("confirmation_count")
  requiredConfirmationCount Int @default(6) @map("required_confirmation_count")

  estimatedFee String? @map("estimated_fee") @db.VarChar(64)
  actualFee String? @map("actual_fee") @db.VarChar(64)
  feeAsset String? @map("fee_asset") @db.VarChar(32)
  feeReference String? @map("fee_reference") @db.VarChar(255)

  sourceWorkflowType String? @map("source_workflow_type") @db.VarChar(64)
  sourceWorkflowId String? @map("source_workflow_id") @db.Uuid

  depositId String? @map("deposit_id") @db.Uuid
  withdrawalId String? @map("withdrawal_id") @db.Uuid

  observedAt DateTime? @map("observed_at") @db.Timestamptz(6)
  submittedAt DateTime? @map("submitted_at") @db.Timestamptz(6)
  confirmedAt DateTime? @map("confirmed_at") @db.Timestamptz(6)
  failedAt DateTime? @map("failed_at") @db.Timestamptz(6)

  failureReason String? @map("failure_reason") @db.VarChar(1000)

  isReorged Boolean @default(false) @map("is_reorged")
  reorgedAt DateTime? @map("reorged_at") @db.Timestamptz(6)

  metadata Json @default("{}")
  evidence Json @default("{}")

  idempotencyKey String @map("idempotency_key") @db.VarChar(255)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  wallet CustodyWallet? @relation(fields: [walletId], references: [id], onDelete: SetNull)
  asset CustodyAsset @relation(fields: [assetId], references: [assetId])
  network CustodyNetwork @relation(fields: [networkId], references: [networkId])
  deposit CustodyDeposit? @relation(fields: [depositId], references: [id], onDelete: SetNull)
  withdrawal CustodyWithdrawal? @relation(fields: [withdrawalId], references: [id], onDelete: SetNull)

  confirmations CustodyTransactionConfirmation[]

  @@unique([tenantId, networkId, transactionHash])
  @@index([tenantId, walletId, status])
  @@index([tenantId, assetId, networkId, status])
  @@index([tenantId, transactionHash])
  @@index([tenantId, sourceWorkflowType, sourceWorkflowId])
  @@index([tenantId, depositId])
  @@index([tenantId, withdrawalId])
  @@map("custody_transactions")
  @@unique([tenantId, idempotencyKey])
}

model CustodyTransactionConfirmation {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  transactionId String @map("transaction_id") @db.Uuid

  blockHash String? @map("block_hash") @db.VarChar(255)
  blockNumber String? @map("block_number") @db.VarChar(64)

  confirmationCount Int @map("confirmation_count")
  requiredConfirmationCount Int @map("required_confirmation_count")

  state CustodyConfirmationState @default(OBSERVED)

  isFinal Boolean @default(false) @map("is_final")

  providerReference String? @map("provider_reference") @db.VarChar(255)

  observedAt DateTime @default(now()) @map("observed_at") @db.Timestamptz(6)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  transaction CustodyTransaction @relation(fields: [transactionId], references: [id], onDelete: Cascade)

  @@index([tenantId, transactionId, confirmationCount], map: "custody_tx_conf_tenant_tx_count_idx")
  @@index([tenantId, transactionId, state], map: "custody_tx_conf_tenant_tx_state_idx")
  @@map("custody_transaction_confirmations")
}

model CustodyInternalTransfer {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  sourceWalletId String @map("source_wallet_id") @db.Uuid
  destinationWalletId String @map("destination_wallet_id") @db.Uuid

  assetId String @map("asset_id") @db.VarChar(128)
  networkId String? @map("network_id") @db.VarChar(64)

  amount String @db.VarChar(64)

  state CustodyInternalTransferState @default(REQUESTED)

  authorizationReference String? @map("authorization_reference") @db.VarChar(255)
  operatorId String? @map("operator_id") @db.Uuid
  reason String? @db.VarChar(1000)

  settlementReference String? @map("settlement_reference") @db.VarChar(255)

  metadata Json @default("{}")
  evidence Json @default("{}")

  idempotencyKey String @map("idempotency_key") @db.VarChar(255)

  requestedAt DateTime @default(now()) @map("requested_at") @db.Timestamptz(6)
  approvedAt DateTime? @map("approved_at") @db.Timestamptz(6)
  settledAt DateTime? @map("settled_at") @db.Timestamptz(6)
  failedAt DateTime? @map("failed_at") @db.Timestamptz(6)
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  sourceWallet CustodyWallet @relation("InternalTransferSource", fields: [sourceWalletId], references: [id], onDelete: Cascade)
  destinationWallet CustodyWallet @relation("InternalTransferDestination", fields: [destinationWalletId], references: [id], onDelete: Cascade)

  @@index([tenantId, sourceWalletId, state])
  @@index([tenantId, destinationWalletId, state])
  @@index([tenantId, assetId, state])
  @@map("custody_internal_transfers")
  @@unique([tenantId, idempotencyKey])
}

model CustodyReserve {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  walletId String? @map("wallet_id") @db.Uuid

  assetId String @map("asset_id") @db.VarChar(128)
  networkId String? @map("network_id") @db.VarChar(64)

  reserveType String @map("reserve_type") @db.VarChar(32)

  requiredAmount String @map("required_amount") @db.VarChar(64)
  availableAmount String? @map("available_amount") @db.VarChar(64)
  reservedAmount String? @map("reserved_amount") @db.VarChar(64)
  lockedAmount String? @map("locked_amount") @db.VarChar(64)

  state CustodyReserveState @default(ACTIVE)

  policyVersion String? @map("policy_version") @db.VarChar(64)
  calculationVersion String @default("custody-v1.0.0") @map("calculation_version") @db.VarChar(64)

  metadata Json @default("{}")

  idempotencyKey String @map("idempotency_key") @db.VarChar(255)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  wallet CustodyWallet? @relation(fields: [walletId], references: [id], onDelete: SetNull)
  asset CustodyAsset @relation(fields: [assetId], references: [assetId])
  network CustodyNetwork? @relation(fields: [networkId], references: [networkId], onDelete: SetNull)

  @@index([tenantId, assetId, networkId, reserveType])
  @@index([tenantId, walletId, reserveType])
  @@map("custody_reserves")
  @@unique([tenantId, idempotencyKey])
}

model CustodySweep {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  sourceWalletId String @map("source_wallet_id") @db.Uuid
  destinationWalletId String @map("destination_wallet_id") @db.Uuid

  assetId String @map("asset_id") @db.VarChar(128)
  networkId String @map("network_id") @db.VarChar(64)

  amount String @db.VarChar(64)

  state CustodySweepState @default(REQUESTED)

  providerReference String? @map("provider_reference") @db.VarChar(255)
  transactionId String? @map("transaction_id") @db.Uuid

  operatorId String? @map("operator_id") @db.Uuid
  approvedBy String? @map("approved_by") @db.Uuid

  reason String? @db.VarChar(1000)

  estimatedFee String? @map("estimated_fee") @db.VarChar(64)
  actualFee String? @map("actual_fee") @db.VarChar(64)

  metadata Json @default("{}")
  evidence Json @default("{}")

  idempotencyKey String @map("idempotency_key") @db.VarChar(255)

  requestedAt DateTime @default(now()) @map("requested_at") @db.Timestamptz(6)
  approvedAt DateTime? @map("approved_at") @db.Timestamptz(6)
  submittedAt DateTime? @map("submitted_at") @db.Timestamptz(6)
  settledAt DateTime? @map("settled_at") @db.Timestamptz(6)
  failedAt DateTime? @map("failed_at") @db.Timestamptz(6)
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  sourceWallet CustodyWallet @relation("SweepSource", fields: [sourceWalletId], references: [id], onDelete: Cascade)
  destinationWallet CustodyWallet @relation("SweepDestination", fields: [destinationWalletId], references: [id], onDelete: Cascade)

  @@index([tenantId, sourceWalletId, state])
  @@index([tenantId, destinationWalletId, state])
  @@index([tenantId, assetId, networkId, state])
  @@map("custody_sweeps")
  @@unique([tenantId, idempotencyKey])
}

model CustodyReconciliation {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  reconciliationType CustodyReconciliationType @map("reconciliation_type")

  walletId String? @map("wallet_id") @db.Uuid
  transactionId String? @map("transaction_id") @db.Uuid
  depositId String? @map("deposit_id") @db.Uuid
  withdrawalId String? @map("withdrawal_id") @db.Uuid

  expected Json? @default("{}")
  actual Json? @default("{}")

  discrepancyType String? @map("discrepancy_type") @db.VarChar(64)
  discrepancyDetails Json? @map("discrepancy_details")

  isCritical Boolean @default(false) @map("is_critical")
  isResolved Boolean @default(false) @map("is_resolved")
  resolvedAt DateTime? @map("resolved_at") @db.Timestamptz(6)
  resolvedBy String? @map("resolved_by") @db.Uuid

  sourceType String? @map("source_type") @db.VarChar(64)
  sourceId String? @map("source_id") @db.VarChar(255)

  externalReference String? @map("external_reference") @db.VarChar(255)

  calculationVersion String @default("custody-v1.0.0") @map("calculation_version") @db.VarChar(64)

  idempotencyKey String @map("idempotency_key") @db.VarChar(255)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@index([tenantId, reconciliationType, discrepancyType])
  @@index([tenantId, walletId])
  @@index([tenantId, isCritical, isResolved])
  @@map("custody_reconciliations")
  @@unique([tenantId, idempotencyKey])
}

model CustodyAudit {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  walletId String? @map("wallet_id") @db.Uuid

  action CustodyAuditAction
  entityType String @map("entity_type") @db.VarChar(64)
  entityId String? @map("entity_id") @db.Uuid

  actorId String? @map("actor_id") @db.Uuid
  actorType String? @map("actor_type") @db.VarChar(32)

  fromState String? @map("from_state") @db.VarChar(64)
  toState String? @map("to_state") @db.VarChar(64)

  reason String? @db.VarChar(1000)

  sourceType String? @map("source_type") @db.VarChar(64)
  sourceId String? @map("source_id") @db.VarChar(255)

  evidence Json @default("{}")
  metadata Json @default("{}")

  correlationId String? @map("correlation_id") @db.VarChar(64)
  idempotencyKey String? @map("idempotency_key") @db.VarChar(255)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  wallet CustodyWallet? @relation(fields: [walletId], references: [id], onDelete: SetNull)

  @@index([tenantId, walletId, action, createdAt])
  @@index([tenantId, entityType, entityId])
  @@map("custody_audits")
}

// ---------------------------------------------------------------------------
// Plan catalogue (tenant-facing commercial plans).
//
// Distinct from `SubscriptionPlan` on purpose: `SubscriptionPlan` is the
// platform-authored catalogue a tenant subscribes to, while `Plan` is the
// tenant-facing commercial plan record managed by the billing plans service
// (features and limits attached as first-class rows so the console can render
// comparisons and the enforcement layer can resolve them without JSON munging
// on the read path).
// ---------------------------------------------------------------------------

enum PlanTier {
  free
  basic
  standard
  premium
  enterprise
}

enum PlanStatus {
  active
  inactive
  deprecated
  archived
}

model Plan {
  id String @id @default(cuid())

  /// Nullable on purpose: null tenantId rows are the platform catalogue that
  /// every tenant sees, mirroring `SubscriptionPlan.tenantId`.
  tenantId String? @map("tenant_id")

  name        String @db.VarChar(120)
  slug        String @db.VarChar(64)
  description String? @db.VarChar(500)
  tier        PlanTier @default(free)
  status      PlanStatus @default(active)

  /// Structured price object: { amount, currency, interval, trialDays? }.
  price Json

  metadata Json @default("{}")

  createdBy String @map("created_by") @db.VarChar(64)
  updatedBy String @map("updated_by") @db.VarChar(64)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(6)

  features PlanFeature[]
  limits   PlanLimit[]

  @@unique([tenantId, slug])
  @@index([tenantId, status])
  @@index([tenantId, tier])
  @@map("plans")
}

model PlanFeature {
  id String @id @default(cuid())

  planId String @map("plan_id")

  key         String @db.VarChar(64)
  name        String @db.VarChar(120)
  description String @db.VarChar(500)
  enabled     Boolean @default(true)
  limit       Int?
  unit        String? @db.VarChar(32)

  plan Plan @relation(fields: [planId], references: [id], onDelete: Cascade)

  @@unique([planId, key])
  @@index([planId])
  @@map("plan_features")
}

model PlanLimit {
  id String @id @default(cuid())

  planId String @map("plan_id")

  key         String @db.VarChar(64)
  name        String @db.VarChar(120)
  description String @db.VarChar(500)
  value       Int
  unit        String @db.VarChar(32)
  hardLimit   Boolean @default(true) @map("hard_limit")

  plan Plan @relation(fields: [planId], references: [id], onDelete: Cascade)

  @@unique([planId, key])
  @@index([planId])
  @@map("plan_limits")
}

// ============================================================================
// Part 28 — White-Label Mobile App Factory / Release Control Plane
//
// These models carry tenant-scoped mobile app identities, builds, immutable
// artifact records, signing evidence (references only — never key material),
// security scans, releases, approvals, staged rollouts, store submissions,
// crash evidence, append-only release audit and reconciliation findings.
// States mirror src/modules/mobile-release/mobile-release.types.ts; the
// transition maps in that file are the authority on which moves are legal.
// ============================================================================

enum MobilePlatform {
  ANDROID
  IOS
}

enum MobileEnvironment {
  DEVELOPMENT
  STAGING
  PRODUCTION
}

enum MobileApplicationState {
  PROVISIONING
  CONFIGURED
  READY_FOR_BUILD
  BUILDING
  BUILD_FAILED
  BUILT
  SIGNING
  SIGNED
  SECURITY_REVIEW
  READY_FOR_RELEASE
  ACTIVE
  SUSPENDED
  ARCHIVED
}

enum MobileBuildState {
  QUEUED
  VALIDATING
  BUILDING
  FAILED
  BUILT
  VERIFYING
  VERIFIED
  REJECTED
}

enum MobileSigningState {
  NOT_CONFIGURED
  PENDING
  SIGNED
  FAILED
  SIGNING_UNAVAILABLE
}

enum MobileSecurityScanState {
  NOT_RUN
  RUNNING
  PASSED
  FINDINGS
  BLOCKED
  FAILED
}

enum MobileReleaseState {
  DRAFT
  REVIEW
  APPROVAL_REQUIRED
  APPROVED
  SUBMITTING
  SUBMITTED
  PUBLISHED
  ROLLED_OUT
  HALTED
  ROLLED_BACK
  REJECTED
}

enum MobileRolloutState {
  NOT_STARTED
  IN_PROGRESS
  HALTED
  COMPLETED
  ABORTED
}

enum MobileStoreProvider {
  GOOGLE_PLAY
  APPLE_APP_STORE
  ENTERPRISE_DISTRIBUTION
  INTERNAL_DISTRIBUTION
}

enum MobileStoreState {
  NOT_CONFIGURED
  CONFIGURED
  SUBMISSION_PENDING
  SUBMITTED
  PUBLISHED
  REJECTED
  UNAVAILABLE
}

enum MobileApprovalDecision {
  APPROVED
  REJECTED
  REWORK
}

enum MobileReconciliationSeverity {
  INFO
  WARNING
  CRITICAL
}

model MobileApplication {
  id          String                 @id @default(uuid()) @db.Uuid
  tenantId    String                 @map("tenant_id") @db.Uuid
  partnerId   String?                @map("partner_id") @db.Uuid
  slug        String                 @db.VarChar(63)
  displayName String                 @map("display_name") @db.VarChar(64)
  description String?                @db.VarChar(500)
  state       MobileApplicationState @default(PROVISIONING)

  // Deterministic, collision-checked store identities. Unique at the database
  // so two tenants can never silently share a production application id.
  androidPackageId String? @unique @map("android_package_id") @db.VarChar(120)
  iosBundleId      String? @unique @map("ios_bundle_id") @db.VarChar(160)

  // Backend-sanitized branding + safe runtime configuration snapshots.
  brandingSnapshot Json  @default("{}") @map("branding_snapshot")
  runtimeConfig    Json  @default("{}") @map("runtime_config")

  marketingVersion   String? @map("marketing_version") @db.VarChar(32)
  androidVersionCode Int?    @map("android_version_code")
  iosBuildNumber     Int?    @map("ios_build_number")

  idempotencyKey String @map("idempotency_key") @db.VarChar(128)
  createdById    String? @map("created_by_id") @db.Uuid

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant      Tenant             @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  builds      MobileBuild[]
  releases    MobileRelease[]
  crashEvents MobileCrashEvent[]

  @@unique([tenantId, slug])
  @@index([tenantId, state])
  @@map("mobile_applications")
  @@unique([tenantId, idempotencyKey])
}

model MobileBuild {
  id            String           @id @default(uuid()) @db.Uuid
  applicationId String           @map("application_id") @db.Uuid
  tenantId      String           @map("tenant_id") @db.Uuid

  platform    MobilePlatform
  environment MobileEnvironment
  buildMode   String           @default("release") @map("build_mode") @db.VarChar(16)

  state MobileBuildState @default(QUEUED)

  versionName      String @map("version_name") @db.VarChar(32)
  versionCode      Int    @map("version_code")
  iosBuildNumber   Int?    @map("ios_build_number")
  commitSha        String? @map("commit_sha") @db.VarChar(40)
  toolchainVersion String? @map("toolchain_version") @db.VarChar(64)

  runnerReference String? @map("runner_reference") @db.VarChar(255)
  logReference    String? @map("log_reference") @db.VarChar(500)

  failureCode   String? @map("failure_code") @db.VarChar(64)
  failureDetail String? @map("failure_detail") @db.VarChar(500)

  idempotencyKey String  @map("idempotency_key") @db.VarChar(128)
  requestedById  String? @map("requested_by_id") @db.Uuid

  startedAt  DateTime? @map("started_at") @db.Timestamptz(6)
  finishedAt DateTime? @map("finished_at") @db.Timestamptz(6)
  createdAt  DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt  DateTime  @updatedAt @map("updated_at") @db.Timestamptz(6)

  application MobileApplication @relation(fields: [applicationId], references: [id], onDelete: Cascade)
  artifact    MobileArtifact?

  @@unique([applicationId, platform, environment, versionName, versionCode])
  @@index([tenantId, state])
  @@index([applicationId, createdAt])
  @@map("mobile_builds")
  @@unique([tenantId, idempotencyKey])
}

model MobileArtifact {
  id            String             @id @default(uuid()) @db.Uuid
  buildId       String             @unique @map("build_id") @db.Uuid
  applicationId String             @map("application_id") @db.Uuid
  tenantId      String             @map("tenant_id") @db.Uuid

  platform    MobilePlatform
  environment MobileEnvironment

  versionName    String @map("version_name") @db.VarChar(32)
  versionCode    Int    @map("version_code")
  iosBuildNumber Int?   @map("ios_build_number")
  commitSha      String @map("commit_sha") @db.VarChar(40)

  // Immutable identity: content digest and size recorded once, verified
  // before any release may reference the artifact.
  sha256           String @db.VarChar(64)
  sizeBytes        BigInt @map("size_bytes")
  storageReference String @map("storage_reference") @db.VarChar(500)

  signingState      MobileSigningState @default(NOT_CONFIGURED) @map("signing_state")
  signingReference  String?            @map("signing_reference") @db.VarChar(255)
  signatureVerified Boolean            @default(false) @map("signature_verified")

  securityScanId String? @map("security_scan_id") @db.Uuid

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  build  MobileBuild         @relation(fields: [buildId], references: [id], onDelete: Cascade)
  scans  MobileSecurityScan[]

  @@index([tenantId])
  @@index([applicationId, platform, environment])
  @@map("mobile_artifacts")
}

model MobileSecurityScan {
  id         String                 @id @default(uuid()) @db.Uuid
  artifactId String                 @map("artifact_id") @db.Uuid
  tenantId   String                 @map("tenant_id") @db.Uuid

  state          MobileSecurityScanState @default(NOT_RUN)
  scannerVersion String                  @default("builtin-1") @map("scanner_version") @db.VarChar(64)
  findings       Json                    @default("[]")
  blockingCount  Int                     @default(0) @map("blocking_count")

  ranAt     DateTime @default(now()) @map("ran_at") @db.Timestamptz(6)
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  artifact MobileArtifact @relation(fields: [artifactId], references: [id], onDelete: Cascade)

  @@index([artifactId])
  @@map("mobile_security_scans")
}

model MobileRelease {
  id            String             @id @default(uuid()) @db.Uuid
  applicationId String             @map("application_id") @db.Uuid
  tenantId      String             @map("tenant_id") @db.Uuid
  artifactId    String             @unique @map("artifact_id") @db.Uuid

  platform    MobilePlatform
  environment MobileEnvironment

  versionName   String  @map("version_name") @db.VarChar(32)
  versionCode   Int     @map("version_code")
  iosBuildNumber Int?   @map("ios_build_number")
  releaseNotes  String? @map("release_notes") @db.VarChar(2000)

  state MobileReleaseState @default(DRAFT)

  submittedAt  DateTime? @map("submitted_at") @db.Timestamptz(6)
  publishedAt  DateTime? @map("published_at") @db.Timestamptz(6)
  rolledOutAt  DateTime? @map("rolled_out_at") @db.Timestamptz(6)
  haltedAt     DateTime? @map("halted_at") @db.Timestamptz(6)
  haltReason   String?   @map("halt_reason") @db.VarChar(255)
  rolledBackAt DateTime? @map("rolled_back_at") @db.Timestamptz(6)
  rejectedAt   DateTime? @map("rejected_at") @db.Timestamptz(6)
  rejectReason String?   @map("reject_reason") @db.VarChar(500)

  idempotencyKey String  @map("idempotency_key") @db.VarChar(128)
  createdById    String? @map("created_by_id") @db.Uuid

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  application      MobileApplication        @relation(fields: [applicationId], references: [id], onDelete: Cascade)
  approvals        MobileReleaseApproval[]
  rollouts         MobileReleaseRollout[]
  storeSubmissions MobileStoreSubmission[]

  @@unique([applicationId, platform, environment, versionName, versionCode])
  @@index([tenantId, state])
  @@index([applicationId, createdAt])
  @@map("mobile_releases")
  @@unique([tenantId, idempotencyKey])
}

model MobileReleaseApproval {
  id        String                 @id @default(uuid()) @db.Uuid
  releaseId String                 @map("release_id") @db.Uuid
  tenantId  String                 @map("tenant_id") @db.Uuid

  decision         MobileApprovalDecision
  approverId       String @map("approver_id") @db.Uuid
  approverRole     String @map("approver_role") @db.VarChar(64)
  platformApproval Boolean @default(false) @map("platform_approval")
  reason           String? @db.VarChar(500)
  policyVersion    String @map("policy_version") @db.VarChar(64)

  decidedAt DateTime @default(now()) @map("decided_at") @db.Timestamptz(6)
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  release MobileRelease @relation(fields: [releaseId], references: [id], onDelete: Cascade)

  @@index([releaseId])
  @@map("mobile_release_approvals")
}

model MobileReleaseRollout {
  id              String             @id @default(uuid()) @db.Uuid
  releaseId       String             @map("release_id") @db.Uuid
  applicationId   String             @map("application_id") @db.Uuid
  tenantId        String             @map("tenant_id") @db.Uuid

  track String @default("production") @db.VarChar(32)

  state              MobileRolloutState @default(NOT_STARTED)
  stagePercentage    Int                @default(0) @map("stage_percentage")
  observedPercentage Int?               @map("observed_percentage")
  haltReason         String?            @map("halt_reason") @db.VarChar(255)

  // Stage history: {stage, targetPercentage, startAt, evidence, observedState}
  evidence Json @default("[]")

  idempotencyKey String @map("idempotency_key") @db.VarChar(128)

  startedAt   DateTime? @map("started_at") @db.Timestamptz(6)
  completedAt DateTime? @map("completed_at") @db.Timestamptz(6)
  haltedAt    DateTime? @map("halted_at") @db.Timestamptz(6)
  createdAt   DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt   DateTime  @updatedAt @map("updated_at") @db.Timestamptz(6)

  release MobileRelease @relation(fields: [releaseId], references: [id], onDelete: Cascade)

  @@index([releaseId])
  @@index([tenantId, state])
  @@map("mobile_release_rollouts")
  @@unique([tenantId, idempotencyKey])
}

model MobileStoreSubmission {
  id            String             @id @default(uuid()) @db.Uuid
  releaseId     String             @map("release_id") @db.Uuid
  applicationId String             @map("application_id") @db.Uuid
  tenantId      String             @map("tenant_id") @db.Uuid

  provider MobileStoreProvider
  state    MobileStoreState    @default(NOT_CONFIGURED)

  // Credential REFERENCES only. Key material lives in the secret system and
  // is resolved at call time; the database must never hold it.
  credentialReference String? @map("credential_reference") @db.VarChar(255)
  track               String? @db.VarChar(64)
  externalSubmissionId String? @map("external_submission_id") @db.VarChar(255)

  evidence Json @default("{}")

  submittedAt   DateTime? @map("submitted_at") @db.Timestamptz(6)
  publishedAt   DateTime? @map("published_at") @db.Timestamptz(6)
  rejectedAt    DateTime? @map("rejected_at") @db.Timestamptz(6)
  lastCheckedAt DateTime? @map("last_checked_at") @db.Timestamptz(6)
  createdAt     DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt     DateTime  @updatedAt @map("updated_at") @db.Timestamptz(6)

  release MobileRelease @relation(fields: [releaseId], references: [id], onDelete: Cascade)

  @@unique([releaseId, provider])
  @@index([tenantId])
  @@map("mobile_store_submissions")
}

model MobileCrashEvent {
  id            String        @id @default(uuid()) @db.Uuid
  applicationId String        @map("application_id") @db.Uuid
  tenantId      String        @map("tenant_id") @db.Uuid

  platform MobilePlatform
  releaseId String? @map("release_id") @db.Uuid
  artifactId String? @map("artifact_id") @db.Uuid

  versionName  String @map("version_name") @db.VarChar(32)
  buildNumber  Int    @map("build_number")

  // Deterministic grouping fingerprint supplied/verified by the ingest path:
  // sha256(platform|exceptionType|signal|top frames). Never raw stack text.
  fingerprint String @db.VarChar(64)
  exceptionType String? @map("exception_type") @db.VarChar(255)
  signal        String? @db.VarChar(32)

  source String @db.VarChar(64)

  occurrenceCount       Int @default(1) @map("occurrence_count")
  affectedInstallations Int? @map("affected_installations")

  idempotencyKey String @map("idempotency_key") @db.VarChar(128)

  firstSeenAt DateTime @default(now()) @map("first_seen_at") @db.Timestamptz(6)
  lastSeenAt  DateTime @default(now()) @map("last_seen_at") @db.Timestamptz(6)
  updatedAt   DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  application MobileApplication @relation(fields: [applicationId], references: [id], onDelete: Cascade)

  @@index([releaseId])
  @@index([applicationId, platform, lastSeenAt])
  @@map("mobile_crash_events")
  @@unique([tenantId, idempotencyKey])
}

model MobileReleaseAudit {
  id            String  @id @default(uuid()) @db.Uuid
  tenantId      String? @map("tenant_id") @db.Uuid
  applicationId String? @map("application_id") @db.Uuid
  buildId       String? @map("build_id") @db.Uuid
  artifactId    String? @map("artifact_id") @db.Uuid
  releaseId     String? @map("release_id") @db.Uuid

  actorId   String? @map("actor_id") @db.Uuid
  actorType String  @default("USER") @map("actor_type") @db.VarChar(32)
  actorRole String? @map("actor_role") @db.VarChar(64)

  action String @db.VarChar(64)

  environment    String? @db.VarChar(16)
  platform       String? @db.VarChar(16)
  version        String? @db.VarChar(32)
  commitSha      String? @map("commit_sha") @db.VarChar(40)
  artifactSha256 String? @map("artifact_sha256") @db.VarChar(64)

  correlationId String @map("correlation_id") @db.VarChar(64)

  // Redacted at write time by the audit service; append-only afterwards.
  evidence Json @default("{}")

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  @@index([tenantId, createdAt])
  @@index([applicationId, createdAt])
  @@index([releaseId])
  @@map("mobile_release_audits")
}

model MobileReconciliationFinding {
  id      String                     @id @default(uuid()) @db.Uuid
  runId   String                     @map("run_id") @db.VarChar(64)
  tenantId String?                   @map("tenant_id") @db.Uuid

  code       String                     @db.VarChar(64)
  severity   MobileReconciliationSeverity @default(WARNING)
  subjectType String                    @map("subject_type") @db.VarChar(64)
  subjectId   String                    @map("subject_id") @db.VarChar(64)

  detail   Json    @default("{}")
  resolved Boolean @default(false)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  @@unique([runId, code, subjectId])
  @@index([runId])
  @@map("mobile_reconciliation_findings")
}

// ---------------------------------------------------------------------------
// Part 30 — Developer Platform (Enterprise API, OAuth, Webhooks, SDKs)
// Models are ADDITIVE: Tenant/User/TenantApiKey/UsageMeter/UsageEvent/
// SecurityEvent and billing webhooks remain authoritative and untouched.
// ---------------------------------------------------------------------------

model DeveloperApplication {
  id            String   @id @default(uuid()) @db.Uuid
  tenantId      String   @map("tenant_id") @db.Uuid
  partnerId     String?  @map("partner_id")
  name          String   @db.VarChar(120)
  description   String   @db.VarChar(2000)
  clientId      String   @unique @map("client_id") @db.VarChar(48)
  state         String   @db.VarChar(32)
  environment   String   @db.VarChar(16)
  redirectUris  String[] @map("redirect_uris")
  scopes        String[]
  homePageUrl   String?  @map("home_page_url") @db.VarChar(255)
  naturalKey    String   @map("natural_key") @db.VarChar(64)
  idempotencyKey String  @map("idempotency_key") @db.VarChar(48)
  createdByActorId String @map("created_by_actor_id") @db.VarChar(64)
  createdAt     DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt     DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  credentials           DeveloperCredential[]
  oauthGrants           DeveloperOAuthGrant[]
  accessTokens          DeveloperAccessToken[]
  webhookSubscriptions  DeveloperWebhookSubscription[]
  @@index([tenantId, state])
  @@index([tenantId, createdAt])
  @@map("developer_applications")
  @@unique([tenantId, idempotencyKey])
}

model DeveloperCredential {
  id            String    @id @default(uuid()) @db.Uuid
  tenantId      String    @map("tenant_id") @db.Uuid
  applicationId String    @map("application_id") @db.Uuid
  label         String    @db.VarChar(120)
  kind          String    @db.VarChar(24)
  keyId         String    @unique @map("key_id") @db.VarChar(64)
  /// HMAC digest of the secret; the plaintext is shown once, never stored.
  secretHash    String    @map("secret_hash") @db.VarChar(128)
  scopes        String[]
  expiresAt     DateTime? @map("expires_at") @db.Timestamptz(6)
  revokedAt     DateTime? @map("revoked_at") @db.Timestamptz(6)
  rotatedFromKeyId String? @map("rotated_from_key_id") @db.VarChar(64)
  createdByActorId String  @map("created_by_actor_id") @db.VarChar(64)
  createdAt     DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)

  application DeveloperApplication @relation(fields: [applicationId], references: [id], onDelete: Cascade)

  @@index([tenantId, applicationId])
  @@index([applicationId, revokedAt])
  @@map("developer_credentials")
}

model DeveloperOAuthGrant {
  id               String    @id @default(uuid()) @db.Uuid
  tenantId         String    @map("tenant_id") @db.Uuid
  applicationId    String    @map("application_id") @db.Uuid
  userId           String    @map("user_id") @db.Uuid
  state            String    @db.VarChar(32)
  redirectUri      String    @map("redirect_uri") @db.VarChar(512)
  requestedScopes  String[]  @map("requested_scopes")
  consentedScopes  String[]  @map("consented_scopes")
  codeChallenge    String?   @map("code_challenge") @db.VarChar(128)
  codeChallengeMethod String? @map("code_challenge_method") @db.VarChar(16)
  nonce            String?   @db.VarChar(128)
  stateParameter   String    @map("state_parameter") @db.VarChar(128)
  idempotencyKey   String    @map("idempotency_key") @db.VarChar(48)
  /// Authorization codes are stored ONLY as HMAC digests, single-use.
  codeHash         String?   @map("code_hash") @db.VarChar(128)
  codeExpiresAt    DateTime? @map("code_expires_at") @db.Timestamptz(6)
  codeRedeemedAt   DateTime? @map("code_redeemed_at") @db.Timestamptz(6)
  createdAt        DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt        DateTime  @updatedAt @map("updated_at") @db.Timestamptz(6)

  application DeveloperApplication @relation(fields: [applicationId], references: [id], onDelete: Cascade)

  accessTokens DeveloperAccessToken[]
  @@index([tenantId, applicationId, state])
  @@index([applicationId, codeHash])
  @@map("developer_oauth_grants")
  @@unique([tenantId, idempotencyKey])
}

model DeveloperAccessToken {
  id            String    @id @default(uuid()) @db.Uuid
  tenantId      String    @map("tenant_id") @db.Uuid
  applicationId String    @map("application_id") @db.Uuid
  grantId       String    @map("grant_id") @db.Uuid
  /// HMAC digest of the opaque bearer token; the value is shown once.
  tokenHash     String    @unique @map("token_hash") @db.VarChar(128)
  scopes        String[]
  expiresAt     DateTime  @map("expires_at") @db.Timestamptz(6)
  revokedAt     DateTime? @map("revoked_at") @db.Timestamptz(6)
  createdAt     DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)

  application DeveloperApplication @relation(fields: [applicationId], references: [id], onDelete: Cascade)
  grant       DeveloperOAuthGrant  @relation(fields: [grantId], references: [id], onDelete: Cascade)

  @@index([applicationId, revokedAt])
  @@map("developer_access_tokens")
}

model DeveloperWebhookSubscription {
  id             String    @id @default(uuid()) @db.Uuid
  tenantId       String    @map("tenant_id") @db.Uuid
  applicationId  String    @map("application_id") @db.Uuid
  endpointUrl    String    @map("endpoint_url") @db.VarChar(512)
  eventTypes     String[]  @map("event_types")
  eventVersion   String    @default("v1") @map("event_version") @db.VarChar(16)
  environment    String    @db.VarChar(16)
  description    String?   @db.VarChar(200)
  state          String    @db.VarChar(16)
  /// Verification digest AND crypto-infra encrypted secret for signing.
  secretHash     String    @map("secret_hash") @db.VarChar(128)
  secretEncrypted String   @map("secret_encrypted")
  idempotencyKey String    @map("idempotency_key") @db.VarChar(48)
  revokedAt      DateTime? @map("revoked_at") @db.Timestamptz(6)
  createdByActorId String  @map("created_by_actor_id") @db.VarChar(64)
  createdAt      DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt      DateTime  @updatedAt @map("updated_at") @db.Timestamptz(6)

  application DeveloperApplication @relation(fields: [applicationId], references: [id], onDelete: Cascade)

  deliveries         DeveloperWebhookDelivery[]
  eventSubscriptions DeveloperEventSubscription[]
  @@index([tenantId, state])
  @@index([applicationId, revokedAt])
  @@map("developer_webhook_subscriptions")
  @@unique([tenantId, idempotencyKey])
}

model DeveloperWebhookDelivery {
  id              String    @id @default(uuid()) @db.Uuid
  tenantId        String    @map("tenant_id") @db.Uuid
  subscriptionId  String    @map("subscription_id") @db.Uuid
  applicationId   String    @map("application_id") @db.Uuid
  eventId         String    @map("event_id") @db.VarChar(48)
  eventType       String    @map("event_type") @db.VarChar(64)
  eventVersion    String    @map("event_version") @db.VarChar(16)
  attempt         Int       @default(0)
  state           String    @db.VarChar(24)
  outcomeClass    String?   @map("outcome_class") @db.VarChar(40)
  responseStatus  Int?      @map("response_status")
  durationMs      Int?      @map("duration_ms")
  nextRetryAt     DateTime? @map("next_retry_at") @db.Timestamptz(6)
  correlationId   String    @map("correlation_id") @db.VarChar(64)
  environment     String    @db.VarChar(16)
  replayOfDeliveryId String? @map("replay_of_delivery_id") @db.Uuid
  idempotencyKey  String    @map("idempotency_key") @db.VarChar(64)
  createdAt       DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt       DateTime  @updatedAt @map("updated_at") @db.Timestamptz(6)

  subscription DeveloperWebhookSubscription @relation(fields: [subscriptionId], references: [id], onDelete: Cascade)

  @@unique([subscriptionId, eventId, attempt])
  @@index([tenantId, state])
  @@index([subscriptionId, createdAt])
  @@map("developer_webhook_deliveries")
  @@unique([tenantId, idempotencyKey])
}

model DeveloperEventSubscription {
  id            String   @id @default(uuid()) @db.Uuid
  tenantId      String   @map("tenant_id") @db.Uuid
  subscriptionId String  @map("subscription_id") @db.Uuid
  resourceType  String   @map("resource_type") @db.VarChar(48)
  enabled       Boolean  @default(true)
  createdAt     DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  subscription DeveloperWebhookSubscription @relation(fields: [subscriptionId], references: [id], onDelete: Cascade)

  @@unique([subscriptionId, resourceType])
  @@index([tenantId])
  @@map("developer_event_subscriptions")
}

model DeveloperAudit {
  id            String   @id @default(uuid()) @db.Uuid
  tenantId      String   @map("tenant_id") @db.Uuid
  applicationId String?  @map("application_id") @db.Uuid
  actorType     String   @map("actor_type") @db.VarChar(16)
  actorId       String   @map("actor_id") @db.VarChar(64)
  correlationId String   @map("correlation_id") @db.VarChar(64)
  action        String   @db.VarChar(64)
  detail        Json     @default("{}")
  sequence      Int
  previousHash  String   @map("previous_hash") @db.VarChar(64)
  chainHash     String   @map("chain_hash") @db.VarChar(64)
  createdAt     DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  @@unique([tenantId, sequence])
  @@index([tenantId, applicationId])
  @@index([tenantId, action])
  @@map("developer_audit")
}

// =============================================================================
// DOMAIN PERSISTENCE TABLES (audit 2026-09-29)
// =============================================================================
// Every model below was already addressed by service code as
// `(prisma as any).<delegate>` while no such model existed, so each call
// resolved to `undefined`: writes were silently skipped (the services'
// in-memory maps held the only copy, lost on restart and invisible to other
// replicas), reads returned nothing, and counts fed `?? 0` into plan limits.
// Field names and shapes are taken from the exact objects those services
// pass to create/update/where/orderBy, and from the record interfaces the
// services map rows back into, so no service call needed to change shape.
//
// Conventions follow the surrounding billing models: money and rates are
// decimal strings (VarChar), states are strings validated by the service
// enums, ids are app-generated strings (several services use prefixed ids
// such as `part_<ts>_<rand>`, so ids are VarChar rather than Uuid).
//
// Tenancy: a non-nullable `tenantId` puts the table under the Part 11
// tenant_isolation policy (scripts/gen_part11_rls.py). Partner tables and
// legal holds are PLATFORM-scoped on purpose - a partner spans many tenants
// and the platform pays its commission; a legal hold may be platform-wide
// (`tenantId: null`) - so their tenantId is nullable and they are listed as
// excluded, like audit_logs and plans. Webhook events arrive before any
// tenant is known, so theirs is nullable too.

// --- billing -----------------------------------------------------------------

/// One billing identity per tenant (BillingCustomerService). The tenant-metadata
/// fallback in that service remains for databases without this table.
model BillingCustomer {
  id                  String   @id @default(uuid()) @db.VarChar(64)
  tenantId            String   @unique @map("tenant_id") @db.Uuid
  billingName         String   @map("billing_name") @db.VarChar(255)
  legalName           String?  @map("legal_name") @db.VarChar(255)
  businessName        String?  @map("business_name") @db.VarChar(255)
  billingEmail        String   @map("billing_email") @db.VarChar(320)
  billingAddressLine1 String?  @map("billing_address_line1") @db.VarChar(255)
  billingAddressLine2 String?  @map("billing_address_line2") @db.VarChar(255)
  billingCity         String?  @map("billing_city") @db.VarChar(128)
  billingRegion       String?  @map("billing_region") @db.VarChar(128)
  billingPostalCode   String?  @map("billing_postal_code") @db.VarChar(32)
  billingCountry      String   @map("billing_country") @db.VarChar(64)
  taxId               String?  @map("tax_id") @db.VarChar(64)
  vatNumber           String?  @map("vat_number") @db.VarChar(64)
  preferredCurrency   String   @default("USD") @map("preferred_currency") @db.VarChar(10)
  providerCustomerId  String?  @map("provider_customer_id") @db.VarChar(255)
  provider            String?  @db.VarChar(32)
  isBusinessCustomer  Boolean  @default(false) @map("is_business_customer")
  isTaxExempt         Boolean  @default(false) @map("is_tax_exempt")
  exemptionReason     String?  @map("exemption_reason") @db.Text
  metadata            Json?
  createdAt           DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt           DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  @@index([providerCustomerId])
  @@map("billing_customers")
}

/// Append-only billing ledger (BillingLedgerRepository). Journal entries carry
/// per-entry keys (`<key>_<i>_<category>`), so the unique idempotency key is
/// the database-level guarantee against double posting.
model BillingLedgerEntry {
  id              String   @id @default(uuid()) @db.VarChar(64)
  tenantId        String   @map("tenant_id") @db.Uuid
  accountCategory String   @map("account_category") @db.VarChar(64)
  entryType       String   @map("entry_type") @db.VarChar(32)
  amount          String   @db.VarChar(64)
  currency        String   @db.VarChar(10)
  sourceType      String   @map("source_type") @db.VarChar(64)
  sourceId        String   @map("source_id") @db.VarChar(255)
  invoiceId       String?  @map("invoice_id") @db.VarChar(64)
  paymentId       String?  @map("payment_id") @db.VarChar(255)
  refundId        String?  @map("refund_id") @db.VarChar(255)
  taxId           String?  @map("tax_id") @db.VarChar(255)
  feeReference    String?  @map("fee_reference") @db.VarChar(255)
  idempotencyKey  String   @map("idempotency_key") @db.VarChar(512)
  effectiveAt     DateTime @map("effective_at") @db.Timestamptz(6)
  description     String   @db.Text
  metadata        Json?
  status          String   @default("POSTED") @db.VarChar(32)
  createdBy       String?  @map("created_by") @db.VarChar(64)
  createdAt       DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt       DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  @@index([tenantId, effectiveAt])
  @@index([tenantId, sourceType, sourceId])
  @@index([currency, effectiveAt])
  @@index([invoiceId])
  @@map("billing_ledger_entries")
  @@unique([tenantId, idempotencyKey])
}

/// Database fallback for invoice sequences when Redis is unavailable
/// (InvoiceNumberService). `scope` is a tenant id or `global`.
model InvoiceCounter {
  scope     String   @id @db.VarChar(128)
  sequence  Int      @default(0)
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  @@map("invoice_counters")
}

/// Durable webhook replay ledger (WebhookReplayGuard). Several rows may exist
/// per provider event (a rejected delivery and a later valid one), so there is
/// no unique constraint; the guard looks for a PROCESSED row first.
model WebhookEvent {
  id                  String    @id @default(uuid()) @db.VarChar(64)
  provider            String    @db.VarChar(32)
  providerEventId     String    @map("provider_event_id") @db.VarChar(255)
  eventType           String    @map("event_type") @db.VarChar(128)
  eventCategory       String    @map("event_category") @db.VarChar(64)
  providerPaymentId   String?   @map("provider_payment_id") @db.VarChar(255)
  providerCheckoutId  String?   @map("provider_checkout_id") @db.VarChar(255)
  eventHash           String    @map("event_hash") @db.VarChar(128)
  payload             Json?
  signature           String?   @db.VarChar(64)
  processingStatus    String    @map("processing_status") @db.VarChar(32)
  processingAttempts  Int       @default(0) @map("processing_attempts")
  paymentId           String?   @map("payment_id") @db.VarChar(255)
  /// Nullable: a webhook is received before any tenant is resolved.
  tenantId            String?   @map("tenant_id") @db.VarChar(64)
  receivedAt          DateTime  @map("received_at") @db.Timestamptz(6)
  firstSeenAt         DateTime  @map("first_seen_at") @db.Timestamptz(6)
  processedAt         DateTime? @map("processed_at") @db.Timestamptz(6)
  lastProcessingError String?   @map("last_processing_error") @db.VarChar(1000)
  createdAt           DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt           DateTime  @updatedAt @map("updated_at") @db.Timestamptz(6)

  @@index([provider, providerEventId, createdAt])
  @@index([processingStatus, createdAt])
  @@index([tenantId])
  @@map("webhook_events")
}

/// Per-period usage totals (UsageMeterRepository). `subjectId` is '' for a
/// tenant-level meter: a NULL would never match itself under the unique
/// index, so every event would open a new bucket instead of incrementing.
model UsageBucket {
  id            String    @id @default(uuid()) @db.VarChar(64)
  tenantId      String    @map("tenant_id") @db.Uuid
  meterKey      String    @map("meter_key") @db.VarChar(64)
  scope         String    @db.VarChar(32)
  subjectId     String    @default("") @map("subject_id") @db.VarChar(255)
  window        String    @db.VarChar(32)
  periodId      String    @map("period_id") @db.VarChar(255)
  periodStart   DateTime  @map("period_start") @db.Timestamptz(6)
  periodEnd     DateTime  @map("period_end") @db.Timestamptz(6)
  totalQuantity Float     @default(0) @map("total_quantity")
  eventCount    Int       @default(0) @map("event_count")
  unit          String    @db.VarChar(32)
  lastEventAt   DateTime? @map("last_event_at") @db.Timestamptz(6)
  createdAt     DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt     DateTime  @updatedAt @map("updated_at") @db.Timestamptz(6)

  @@unique([tenantId, meterKey, scope, subjectId, periodId])
  @@index([tenantId, periodStart])
  @@map("usage_buckets")
}

model FeeAuditLog {
  id            String   @id @default(uuid()) @db.VarChar(64)
  tenantId      String   @map("tenant_id") @db.Uuid
  operation     String   @db.VarChar(64)
  referenceId   String   @map("reference_id") @db.VarChar(255)
  referenceType String   @map("reference_type") @db.VarChar(64)
  status        String   @db.VarChar(32)
  amount        String?  @db.VarChar(64)
  currency      String?  @db.VarChar(10)
  metadata      Json?
  actorId       String?  @map("actor_id") @db.VarChar(64)
  timestamp     DateTime @default(now()) @db.Timestamptz(6)
  createdAt     DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  @@index([tenantId, operation, createdAt])
  @@index([tenantId, referenceId])
  @@map("fee_audit_logs")
}

model FinanceAuditLog {
  id            String   @id @default(uuid()) @db.VarChar(64)
  tenantId      String   @map("tenant_id") @db.Uuid
  operation     String   @db.VarChar(64)
  referenceId   String   @map("reference_id") @db.VarChar(255)
  referenceType String   @map("reference_type") @db.VarChar(64)
  status        String   @db.VarChar(32)
  amount        String?  @db.VarChar(64)
  currency      String?  @db.VarChar(10)
  metadata      Json?
  actorId       String?  @map("actor_id") @db.VarChar(64)
  actorType     String?  @map("actor_type") @db.VarChar(32)
  timestamp     DateTime @default(now()) @db.Timestamptz(6)
  createdAt     DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  @@index([tenantId, operation, createdAt])
  @@index([tenantId, referenceId])
  @@map("finance_audit_logs")
}

model FeeSettlementItem {
  id           String   @id @default(uuid()) @db.VarChar(64)
  settlementId String   @map("settlement_id") @db.VarChar(64)
  accrualId    String   @map("accrual_id") @db.VarChar(64)
  tenantId     String   @map("tenant_id") @db.Uuid
  feeType      String   @map("fee_type") @db.VarChar(32)
  feeAmount    String   @default("0") @map("fee_amount") @db.VarChar(64)
  currency     String   @db.VarChar(10)
  status       String   @db.VarChar(32)
  createdAt    DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt    DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  @@index([settlementId, createdAt])
  @@index([tenantId, accrualId])
  @@map("fee_settlement_items")
}

model SaasAuditLog {
  id            String   @id @default(uuid()) @db.VarChar(64)
  tenantId      String   @map("tenant_id") @db.Uuid
  operation     String   @db.VarChar(64)
  actorId       String   @map("actor_id") @db.VarChar(64)
  actorType     String   @default("USER") @map("actor_type") @db.VarChar(32)
  referenceId   String   @map("reference_id") @db.VarChar(255)
  referenceType String   @map("reference_type") @db.VarChar(64)
  previousState Json?    @map("previous_state")
  newState      Json?    @map("new_state")
  result        String   @default("SUCCESS") @db.VarChar(32)
  reason        String?  @db.Text
  metadata      Json?
  timestamp     DateTime @default(now()) @db.Timestamptz(6)
  createdAt     DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  @@index([tenantId, operation, createdAt])
  @@map("saas_audit_logs")
}

// --- governance (per tenant, except platform-wide legal holds) ---------------

model ComplianceReport {
  id                  String   @id @db.VarChar(64)
  tenantId            String   @map("tenant_id") @db.Uuid
  reportType          String   @map("report_type") @db.VarChar(64)
  reportVersion       String   @map("report_version") @db.VarChar(32)
  schemaVersion       String   @map("schema_version") @db.VarChar(32)
  jurisdiction        String   @db.VarChar(16)
  periodStart         DateTime @map("period_start") @db.Timestamptz(6)
  periodEnd           DateTime @map("period_end") @db.Timestamptz(6)
  generatedAt         DateTime @map("generated_at") @db.Timestamptz(6)
  dataAsOf            DateTime @map("data_as_of") @db.Timestamptz(6)
  sourceReferences    String[] @default([]) @map("source_references")
  methodology         String   @db.Text
  calculationVersion  String   @map("calculation_version") @db.VarChar(32)
  policyVersion       String   @map("policy_version") @db.VarChar(32)
  validationStatus    String   @map("validation_status") @db.VarChar(32)
  certificationStatus String   @map("certification_status") @db.VarChar(32)
  deliveryStatus      String   @map("delivery_status") @db.VarChar(32)
  state               String   @db.VarChar(32)
  recordCount         Int      @default(0) @map("record_count")
  fileLocation        String?  @map("file_location") @db.Text
  fileHash            String?  @map("file_hash") @db.VarChar(128)
  fingerprint         String   @db.VarChar(128)
  correlationId       String   @map("correlation_id") @db.VarChar(255)
  createdBy           String   @map("created_by") @db.VarChar(64)
  createdAt           DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt           DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  @@index([tenantId, generatedAt])
  @@index([tenantId, reportType, state])
  @@map("compliance_reports")
}

model ComplianceReportCertification {
  id                 String   @id @db.VarChar(64)
  tenantId           String   @map("tenant_id") @db.Uuid
  reportId           String   @map("report_id") @db.VarChar(64)
  state              String   @db.VarChar(32)
  reviewerId         String?  @map("reviewer_id") @db.VarChar(64)
  reviewerRole       String?  @map("reviewer_role") @db.VarChar(64)
  fingerprint        String   @db.VarChar(128)
  validationEvidence String   @map("validation_evidence") @db.Text
  comments           String?  @db.Text
  correlationId      String   @map("correlation_id") @db.VarChar(255)
  policyVersion      String   @map("policy_version") @db.VarChar(32)
  createdAt          DateTime @map("created_at") @db.Timestamptz(6)
  updatedAt          DateTime @map("updated_at") @db.Timestamptz(6)

  @@index([tenantId, reportId, createdAt])
  @@map("compliance_report_certifications")
}

model ComplianceReportDelivery {
  id               String    @id @db.VarChar(64)
  tenantId         String    @map("tenant_id") @db.Uuid
  reportId         String    @map("report_id") @db.VarChar(64)
  channel          String    @db.VarChar(64)
  state            String    @db.VarChar(32)
  attemptCount     Int       @default(0) @map("attempt_count")
  lastAttemptAt    DateTime? @map("last_attempt_at") @db.Timestamptz(6)
  deliveredAt      DateTime? @map("delivered_at") @db.Timestamptz(6)
  deliveryEvidence String?   @map("delivery_evidence") @db.Text
  failureReason    String?   @map("failure_reason") @db.Text
  correlationId    String    @map("correlation_id") @db.VarChar(255)
  createdAt        DateTime  @map("created_at") @db.Timestamptz(6)
  updatedAt        DateTime  @map("updated_at") @db.Timestamptz(6)

  @@index([tenantId, reportId, createdAt])
  @@map("compliance_report_deliveries")
}

model ComplianceReportValidation {
  id                      String   @id @db.VarChar(64)
  tenantId                String   @map("tenant_id") @db.Uuid
  reportId                String   @map("report_id") @db.VarChar(64)
  isValid                 Boolean  @map("is_valid")
  validationStatus        String   @map("validation_status") @db.VarChar(32)
  errors                  Json     @default("[]")
  warnings                Json     @default("[]")
  sourceCompleteness      Boolean  @map("source_completeness")
  reconciliationResolved  Boolean  @map("reconciliation_resolved")
  periodCompleteness      Boolean  @map("period_completeness")
  fingerprintValid        Boolean  @map("fingerprint_valid")
  sourceReferencesChecked String[] @default([]) @map("source_references_checked")
  validatedAt             DateTime @map("validated_at") @db.Timestamptz(6)
  validator               String   @db.VarChar(64)
  correlationId           String   @map("correlation_id") @db.VarChar(255)
  policyVersion           String   @map("policy_version") @db.VarChar(32)
  createdAt               DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  @@index([tenantId, reportId, validatedAt])
  @@map("compliance_report_validations")
}

model ConsentRecord {
  id                String    @id @db.VarChar(64)
  tenantId          String    @map("tenant_id") @db.Uuid
  subjectUserId     String    @map("subject_user_id") @db.VarChar(64)
  purpose           String    @db.VarChar(128)
  version           String    @db.VarChar(32)
  policyReference   String    @map("policy_reference") @db.VarChar(255)
  source            String    @db.VarChar(64)
  capturedAt        DateTime  @map("captured_at") @db.Timestamptz(6)
  withdrawnAt       DateTime? @map("withdrawn_at") @db.Timestamptz(6)
  status            String    @db.VarChar(32)
  evidenceReference String?   @map("evidence_reference") @db.Text
  correlationId     String    @map("correlation_id") @db.VarChar(255)
  createdAt         DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt         DateTime  @updatedAt @map("updated_at") @db.Timestamptz(6)

  @@index([tenantId, subjectUserId, capturedAt])
  @@index([tenantId, status])
  @@map("consent_records")
}

model EvidencePackage {
  id               String    @id @db.VarChar(64)
  tenantId         String    @map("tenant_id") @db.Uuid
  caseReference    String    @map("case_reference") @db.VarChar(255)
  evidenceType     String    @map("evidence_type") @db.VarChar(64)
  state            String    @db.VarChar(32)
  sourceRecords    String[]  @default([]) @map("source_records")
  sourceReferences String[]  @default([]) @map("source_references")
  recordCount      Int       @default(0) @map("record_count")
  generatedAt      DateTime  @map("generated_at") @db.Timestamptz(6)
  finalizedAt      DateTime? @map("finalized_at") @db.Timestamptz(6)
  fileLocation     String?   @map("file_location") @db.Text
  fileHash         String?   @map("file_hash") @db.VarChar(128)
  fingerprint      String    @db.VarChar(128)
  redactionPolicy  String    @map("redaction_policy") @db.VarChar(128)
  generator        String    @db.VarChar(128)
  auditReference   String?   @map("audit_reference") @db.VarChar(255)
  policyVersion    String    @map("policy_version") @db.VarChar(32)
  correlationId    String    @map("correlation_id") @db.VarChar(255)
  isImmutable      Boolean   @default(false) @map("is_immutable")
  createdAt        DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt        DateTime  @updatedAt @map("updated_at") @db.Timestamptz(6)

  @@index([tenantId, generatedAt])
  @@index([tenantId, caseReference])
  @@map("evidence_packages")
}

model GovernanceAction {
  id            String   @id @db.VarChar(64)
  tenantId      String   @map("tenant_id") @db.Uuid
  actionType    String   @map("action_type") @db.VarChar(64)
  entityId      String?  @map("entity_id") @db.VarChar(255)
  requestedBy   String   @map("requested_by") @db.VarChar(64)
  approvedBy    String?  @map("approved_by") @db.VarChar(64)
  state         String   @db.VarChar(32)
  reason        String?  @db.Text
  correlationId String   @map("correlation_id") @db.VarChar(255)
  safeParams    Json     @default("{}") @map("safe_params")
  createdAt     DateTime @map("created_at") @db.Timestamptz(6)
  updatedAt     DateTime @map("updated_at") @db.Timestamptz(6)

  @@index([tenantId, createdAt])
  @@index([tenantId, actionType, state])
  @@map("governance_actions")
}

model GovernanceAudit {
  id                   String   @id @db.VarChar(64)
  tenantId             String   @map("tenant_id") @db.Uuid
  actionType           String   @map("action_type") @db.VarChar(64)
  subjectUserId        String?  @map("subject_user_id") @db.VarChar(64)
  requestId            String?  @map("request_id") @db.VarChar(64)
  reportId             String?  @map("report_id") @db.VarChar(64)
  evidencePackageId    String?  @map("evidence_package_id") @db.VarChar(64)
  legalHoldId          String?  @map("legal_hold_id") @db.VarChar(64)
  retentionCandidateId String?  @map("retention_candidate_id") @db.VarChar(64)
  consentId            String?  @map("consent_id") @db.VarChar(64)
  state                String   @db.VarChar(32)
  result               String   @db.Text
  reason               String?  @db.Text
  correlationId        String   @map("correlation_id") @db.VarChar(255)
  createdBy            String   @map("created_by") @db.VarChar(64)
  createdAt            DateTime @map("created_at") @db.Timestamptz(6)
  safeEvidence         Json     @default("{}") @map("safe_evidence")

  @@index([tenantId, createdAt])
  @@index([tenantId, actionType])
  @@index([correlationId])
  @@map("governance_audits")
}

model GovernanceDataClassification {
  id               String   @id @db.VarChar(64)
  tenantId         String   @map("tenant_id") @db.Uuid
  sourceSystem     String   @map("source_system") @db.VarChar(64)
  sourceTable      String   @map("source_table") @db.VarChar(128)
  sourceField      String   @map("source_field") @db.VarChar(128)
  dataClass        String   @map("data_class") @db.VarChar(64)
  jurisdiction     String   @db.VarChar(16)
  sensitivityScore Float    @map("sensitivity_score")
  piiFlag          Boolean  @map("pii_flag")
  regulatedFlag    Boolean  @map("regulated_flag")
  classifiedAt     DateTime @map("classified_at") @db.Timestamptz(6)
  classifiedBy     String   @map("classified_by") @db.VarChar(64)
  policyVersion    String   @map("policy_version") @db.VarChar(32)
  correlationId    String   @map("correlation_id") @db.VarChar(255)

  @@index([tenantId, classifiedAt])
  @@map("governance_data_classifications")
}

model GovernanceDataInventory {
  id                String   @id @db.VarChar(64)
  tenantId          String   @map("tenant_id") @db.Uuid
  subjectUserId     String?  @map("subject_user_id") @db.VarChar(64)
  sourceSystem      String   @map("source_system") @db.VarChar(64)
  sourceTable       String   @map("source_table") @db.VarChar(128)
  sourceId          String   @map("source_id") @db.VarChar(255)
  dataClasses       String[] @default([]) @map("data_classes")
  jurisdiction      String   @db.VarChar(16)
  retentionStartAt  DateTime @map("retention_start_at") @db.Timestamptz(6)
  locationReference String   @map("location_reference") @db.Text
  recordHash        String   @map("record_hash") @db.VarChar(128)
  correlationId     String   @map("correlation_id") @db.VarChar(255)
  lastSeenAt        DateTime @map("last_seen_at") @db.Timestamptz(6)
  policyVersion     String   @map("policy_version") @db.VarChar(32)

  @@unique([tenantId, sourceSystem, sourceId])
  @@index([tenantId, subjectUserId])
  @@index([tenantId, lastSeenAt])
  @@map("governance_data_inventory")
}

/// Open reconciliation mismatches. Detection upserts one row per
/// (tenant, entity, type); resolving deletes it (GovernanceReconciliationService).
model GovernanceReconciliation {
  id               String   @id @default(uuid()) @db.VarChar(64)
  tenantId         String   @map("tenant_id") @db.Uuid
  type             String   @db.VarChar(64)
  entityId         String   @map("entity_id") @db.VarChar(255)
  severity         String   @db.VarChar(16)
  description      String   @db.Text
  detectedAt       DateTime @map("detected_at") @db.Timestamptz(6)
  correlationId    String   @map("correlation_id") @db.VarChar(255)
  sourceReferences String[] @default([]) @map("source_references")

  @@unique([tenantId, entityId, type])
  @@index([tenantId, detectedAt])
  @@map("governance_reconciliations")
}

/// Legal holds. Platform-wide holds carry `tenantId: null` and apply to every
/// tenant (LegalHoldService queries `OR [{ tenantId }, { tenantId: null }]`).
model LegalHold {
  id                    String    @id @db.VarChar(64)
  tenantId              String?   @map("tenant_id") @db.Uuid
  caseReference         String    @map("case_reference") @db.VarChar(255)
  reason                String    @db.Text
  state                 String    @db.VarChar(32)
  affectedDataClasses   String[]  @default([]) @map("affected_data_classes")
  affectedJurisdictions String[]  @default([]) @map("affected_jurisdictions")
  affectedSubjects      String[]  @default([]) @map("affected_subjects")
  createdBy             String    @map("created_by") @db.VarChar(64)
  activatedBy           String?   @map("activated_by") @db.VarChar(64)
  releasedBy            String?   @map("released_by") @db.VarChar(64)
  createdAt             DateTime  @map("created_at") @db.Timestamptz(6)
  activatedAt           DateTime? @map("activated_at") @db.Timestamptz(6)
  releasedAt            DateTime? @map("released_at") @db.Timestamptz(6)
  expiresAt             DateTime? @map("expires_at") @db.Timestamptz(6)
  correlationId         String    @map("correlation_id") @db.VarChar(255)
  policyVersion         String    @map("policy_version") @db.VarChar(32)

  @@index([tenantId, state])
  @@index([state, createdAt])
  @@map("legal_holds")
}

model PrivacyExport {
  id               String   @id @db.VarChar(64)
  tenantId         String   @map("tenant_id") @db.Uuid
  requestId        String   @map("request_id") @db.VarChar(64)
  subjectUserId    String   @map("subject_user_id") @db.VarChar(64)
  exportVersion    String   @map("export_version") @db.VarChar(32)
  dataAsOf         DateTime @map("data_as_of") @db.Timestamptz(6)
  generatedAt      DateTime @map("generated_at") @db.Timestamptz(6)
  dataCategories   String[] @default([]) @map("data_categories")
  sourceReferences String[] @default([]) @map("source_references")
  recordCount      Int      @default(0) @map("record_count")
  fileLocation     String?  @map("file_location") @db.Text
  fileHash         String?  @map("file_hash") @db.VarChar(128)
  methodology      String   @db.Text
  policyVersion    String   @map("policy_version") @db.VarChar(32)
  correlationId    String   @map("correlation_id") @db.VarChar(255)
  isDeterministic  Boolean  @default(true) @map("is_deterministic")

  @@index([tenantId, requestId, generatedAt])
  @@map("privacy_exports")
}

model PrivacyRequest {
  id               String    @id @db.VarChar(64)
  tenantId         String    @map("tenant_id") @db.Uuid
  subjectUserId    String    @map("subject_user_id") @db.VarChar(64)
  subjectType      String    @map("subject_type") @db.VarChar(16)
  requestType      String    @map("request_type") @db.VarChar(32)
  state            String    @db.VarChar(32)
  jurisdiction     String    @db.VarChar(16)
  reason           String?   @db.Text
  idempotencyKey   String    @map("idempotency_key") @db.VarChar(255)
  correlationId    String    @map("correlation_id") @db.VarChar(255)
  requestedAt      DateTime  @map("requested_at") @db.Timestamptz(6)
  verifiedAt       DateTime? @map("verified_at") @db.Timestamptz(6)
  completedAt      DateTime? @map("completed_at") @db.Timestamptz(6)
  blockedReason    String?   @map("blocked_reason") @db.Text
  retentionBlock   Boolean   @default(false) @map("retention_block")
  legalHoldBlock   Boolean   @default(false) @map("legal_hold_block")
  sourceReferences String[]  @default([]) @map("source_references")
  createdBy        String    @map("created_by") @db.VarChar(64)
  updatedAt        DateTime  @map("updated_at") @db.Timestamptz(6)

  @@index([tenantId, requestedAt])
  @@index([tenantId, state])
  @@map("privacy_requests")
  @@unique([tenantId, idempotencyKey])
}

model RetentionCandidate {
  id                 String   @id @db.VarChar(64)
  tenantId           String   @map("tenant_id") @db.Uuid
  dataClass          String   @map("data_class") @db.VarChar(64)
  sourceSystem       String   @map("source_system") @db.VarChar(64)
  sourceId           String   @map("source_id") @db.VarChar(255)
  jurisdiction       String   @db.VarChar(16)
  retentionStartAt   DateTime @map("retention_start_at") @db.Timestamptz(6)
  retentionEndAt     DateTime @map("retention_end_at") @db.Timestamptz(6)
  state              String   @db.VarChar(32)
  eligibleAction     String   @map("eligible_action") @db.VarChar(16)
  blockedByLegalHold Boolean  @default(false) @map("blocked_by_legal_hold")
  legalHoldIds       String[] @default([]) @map("legal_hold_ids")
  policyVersion      String   @map("policy_version") @db.VarChar(32)
  correlationId      String   @map("correlation_id") @db.VarChar(255)
  createdAt          DateTime @map("created_at") @db.Timestamptz(6)
  updatedAt          DateTime @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(6)

  @@index([tenantId, createdAt])
  @@index([tenantId, sourceSystem, sourceId])
  @@index([tenantId, state])
  @@map("retention_candidates")
}

// --- partners (platform-scoped: a partner spans tenants) ---------------------

model PartnerProfile {
  id               String    @id @db.VarChar(64)
  code             String    @unique @db.VarChar(64)
  name             String    @db.VarChar(255)
  legalName        String?   @map("legal_name") @db.VarChar(255)
  type             String    @db.VarChar(32)
  state            String    @db.VarChar(32)
  ownerUserId      String    @map("owner_user_id") @db.VarChar(64)
  contactEmail     String    @map("contact_email") @db.VarChar(320)
  contactName      String?   @map("contact_name") @db.VarChar(255)
  website          String?   @db.VarChar(512)
  countryCode      String?   @map("country_code") @db.VarChar(8)
  taxId            String?   @map("tax_id") @db.VarChar(64)
  billingEmail     String?   @map("billing_email") @db.VarChar(320)
  currency         String    @db.VarChar(10)
  idempotencyKey   String    @unique @map("idempotency_key") @db.VarChar(255)
  policyVersion    String    @map("policy_version") @db.VarChar(32)
  agreementVersion String?   @map("agreement_version") @db.VarChar(32)
  metadata         Json?
  createdAt        DateTime  @map("created_at") @db.Timestamptz(6)
  updatedAt        DateTime  @map("updated_at") @db.Timestamptz(6)
  activatedAt      DateTime? @map("activated_at") @db.Timestamptz(6)
  suspendedAt      DateTime? @map("suspended_at") @db.Timestamptz(6)
  terminatedAt     DateTime? @map("terminated_at") @db.Timestamptz(6)

  @@index([state, type])
  @@index([ownerUserId])
  @@map("partner_profiles")
}

model PartnerAgreement {
  id                String    @id @db.VarChar(64)
  partnerId         String    @map("partner_id") @db.VarChar(64)
  version           Int
  state             String    @db.VarChar(32)
  commissionPolicy  Json      @map("commission_policy")
  pricingRules      Json      @default("[]") @map("pricing_rules")
  payoutTerms       Json      @map("payout_terms")
  attributionRules  Json      @default("[]") @map("attribution_rules")
  effectiveFrom     DateTime  @map("effective_from") @db.Timestamptz(6)
  effectiveTo       DateTime? @map("effective_to") @db.Timestamptz(6)
  jurisdiction      String?   @db.VarChar(16)
  responsibilities  String[]  @default([])
  terminationClause String?   @map("termination_clause") @db.Text
  createdBy         String    @map("created_by") @db.VarChar(64)
  approvedBy        String?   @map("approved_by") @db.VarChar(64)
  activatedAt       DateTime? @map("activated_at") @db.Timestamptz(6)
  supersededAt      DateTime? @map("superseded_at") @db.Timestamptz(6)
  terminatedAt      DateTime? @map("terminated_at") @db.Timestamptz(6)
  previousVersionId String?   @map("previous_version_id") @db.VarChar(64)
  isImmutable       Boolean   @default(false) @map("is_immutable")
  createdAt         DateTime  @map("created_at") @db.Timestamptz(6)
  updatedAt         DateTime  @map("updated_at") @db.Timestamptz(6)

  @@unique([partnerId, version])
  @@index([partnerId, state])
  @@map("partner_agreements")
}

model PartnerTenantRelationship {
  id               String    @id @db.VarChar(64)
  partnerId        String    @map("partner_id") @db.VarChar(64)
  /// Platform-scoped row about a tenant: nullable so the partner console can
  /// read across tenants under row-level security (see section header).
  tenantId         String?   @map("tenant_id") @db.Uuid
  relationshipType String    @map("relationship_type") @db.VarChar(32)
  state            String    @db.VarChar(32)
  attributionId    String?   @map("attribution_id") @db.VarChar(64)
  campaignId       String?   @map("campaign_id") @db.VarChar(64)
  referralCode     String?   @map("referral_code") @db.VarChar(64)
  assignedAt       DateTime  @map("assigned_at") @db.Timestamptz(6)
  assignedBy       String    @map("assigned_by") @db.VarChar(64)
  activatedAt      DateTime? @map("activated_at") @db.Timestamptz(6)
  terminatedAt     DateTime? @map("terminated_at") @db.Timestamptz(6)
  isPrimary        Boolean   @default(false) @map("is_primary")
  metadata         Json?
  idempotencyKey   String    @unique @map("idempotency_key") @db.VarChar(255)
  createdAt        DateTime  @map("created_at") @db.Timestamptz(6)
  updatedAt        DateTime  @map("updated_at") @db.Timestamptz(6)

  @@index([partnerId, createdAt])
  @@index([tenantId, isPrimary, state])
  @@map("partner_tenant_relationships")
}

model PartnerReferral {
  id                String    @id @db.VarChar(64)
  partnerId         String    @map("partner_id") @db.VarChar(64)
  campaignId        String?   @map("campaign_id") @db.VarChar(64)
  code              String    @unique @db.VarChar(64)
  token             String    @unique @db.VarChar(255)
  state             String    @db.VarChar(32)
  createdBy         String    @map("created_by") @db.VarChar(64)
  expiresAt         DateTime? @map("expires_at") @db.Timestamptz(6)
  convertedAt       DateTime? @map("converted_at") @db.Timestamptz(6)
  convertedTenantId String?   @map("converted_tenant_id") @db.Uuid
  maxUses           Int?      @map("max_uses")
  currentUses       Int       @default(0) @map("current_uses")
  idempotencyKey    String    @unique @map("idempotency_key") @db.VarChar(255)
  createdAt         DateTime  @map("created_at") @db.Timestamptz(6)
  updatedAt         DateTime  @map("updated_at") @db.Timestamptz(6)

  @@index([partnerId])
  @@map("partner_referrals")
}

model PartnerAttribution {
  id                     String   @id @db.VarChar(64)
  partnerId              String   @map("partner_id") @db.VarChar(64)
  tenantId               String?  @map("tenant_id") @db.Uuid
  campaignId             String?  @map("campaign_id") @db.VarChar(64)
  referralCode           String?  @map("referral_code") @db.VarChar(64)
  referralToken          String?  @map("referral_token") @db.VarChar(255)
  attributionSource      String   @map("attribution_source") @db.VarChar(32)
  attributionWindowHours Int      @map("attribution_window_hours")
  capturedAt             DateTime @map("captured_at") @db.Timestamptz(6)
  effectiveAt            DateTime @map("effective_at") @db.Timestamptz(6)
  expiresAt              DateTime @map("expires_at") @db.Timestamptz(6)
  agreementVersion       String   @map("agreement_version") @db.VarChar(32)
  policyVersion          String   @map("policy_version") @db.VarChar(32)
  state                  String   @db.VarChar(32)
  isPrimary              Boolean  @default(false) @map("is_primary")
  idempotencyKey         String   @unique @map("idempotency_key") @db.VarChar(255)
  createdAt              DateTime @map("created_at") @db.Timestamptz(6)
  updatedAt              DateTime @map("updated_at") @db.Timestamptz(6)

  @@index([tenantId, isPrimary, state])
  @@index([partnerId])
  @@map("partner_attributions")
}

model PartnerCampaign {
  id                     String    @id @db.VarChar(64)
  partnerId              String    @map("partner_id") @db.VarChar(64)
  name                   String    @db.VarChar(255)
  code                   String    @db.VarChar(64)
  state                  String    @db.VarChar(32)
  discountType           String?   @map("discount_type") @db.VarChar(32)
  discountValue          String?   @map("discount_value") @db.VarChar(64)
  discountCurrency       String?   @map("discount_currency") @db.VarChar(10)
  maxUses                Int?      @map("max_uses")
  currentUses            Int       @default(0) @map("current_uses")
  allowedPlans           Json?     @map("allowed_plans")
  attributionWindowHours Int       @map("attribution_window_hours")
  startsAt               DateTime  @map("starts_at") @db.Timestamptz(6)
  endsAt                 DateTime? @map("ends_at") @db.Timestamptz(6)
  createdBy              String    @map("created_by") @db.VarChar(64)
  idempotencyKey         String    @unique @map("idempotency_key") @db.VarChar(255)
  createdAt              DateTime  @map("created_at") @db.Timestamptz(6)
  updatedAt              DateTime  @map("updated_at") @db.Timestamptz(6)

  /// Codes are unique per partner (PartnerDiscountService.createCampaign).
  @@unique([partnerId, code])
  @@index([partnerId, createdAt])
  @@map("partner_campaigns")
}

/// Commission ledger. Reversals are new rows pointing at `reversalOfId`;
/// the unique idempotency key blocks a double accrual for one source event.
model PartnerCommission {
  id                   String    @id @db.VarChar(64)
  partnerId            String    @map("partner_id") @db.VarChar(64)
  tenantId             String?   @map("tenant_id") @db.Uuid
  sourcePaymentId      String?   @map("source_payment_id") @db.VarChar(255)
  sourceInvoiceId      String?   @map("source_invoice_id") @db.VarChar(255)
  sourceSubscriptionId String?   @map("source_subscription_id") @db.VarChar(255)
  sourceFeeId          String?   @map("source_fee_id") @db.VarChar(255)
  sourceEventId        String    @map("source_event_id") @db.VarChar(255)
  sourceEventType      String    @map("source_event_type") @db.VarChar(32)
  grossRevenue         String    @map("gross_revenue") @db.VarChar(64)
  discountAmount       String    @map("discount_amount") @db.VarChar(64)
  netEligibleRevenue   String    @map("net_eligible_revenue") @db.VarChar(64)
  commissionRate       String    @map("commission_rate") @db.VarChar(64)
  commissionBasis      String    @map("commission_basis") @db.VarChar(32)
  commissionModel      String    @map("commission_model") @db.VarChar(32)
  commissionAmount     String    @map("commission_amount") @db.VarChar(64)
  currency             String    @db.VarChar(10)
  sourceCurrency       String    @map("source_currency") @db.VarChar(10)
  commissionCurrency   String    @map("commission_currency") @db.VarChar(10)
  fxRequired           Boolean   @default(false) @map("fx_required")
  fxRate               String?   @map("fx_rate") @db.VarChar(64)
  fxTimestamp          DateTime? @map("fx_timestamp") @db.Timestamptz(6)
  fxSource             String?   @map("fx_source") @db.VarChar(64)
  agreementVersion     String    @map("agreement_version") @db.VarChar(32)
  policyVersion        String    @map("policy_version") @db.VarChar(32)
  calculationVersion   String    @map("calculation_version") @db.VarChar(32)
  state                String    @db.VarChar(32)
  settlementId         String?   @map("settlement_id") @db.VarChar(64)
  payoutId             String?   @map("payout_id") @db.VarChar(64)
  reversalOfId         String?   @map("reversal_of_id") @db.VarChar(64)
  accruedAt            DateTime  @map("accrued_at") @db.Timestamptz(6)
  idempotencyKey       String    @unique @map("idempotency_key") @db.VarChar(255)
  correlationId        String    @map("correlation_id") @db.VarChar(255)
  createdAt            DateTime  @map("created_at") @db.Timestamptz(6)
  updatedAt            DateTime  @map("updated_at") @db.Timestamptz(6)

  @@index([partnerId, accruedAt])
  @@index([partnerId, sourceEventId])
  @@index([settlementId])
  @@index([tenantId])
  @@map("partner_commissions")
}

model PartnerSettlement {
  id                      String    @id @db.VarChar(64)
  partnerId               String    @map("partner_id") @db.VarChar(64)
  periodStart             DateTime  @map("period_start") @db.Timestamptz(6)
  periodEnd               DateTime  @map("period_end") @db.Timestamptz(6)
  currency                String    @db.VarChar(10)
  state                   String    @db.VarChar(32)
  totalGrossRevenue       String    @map("total_gross_revenue") @db.VarChar(64)
  totalDiscount           String    @map("total_discount") @db.VarChar(64)
  totalNetEligibleRevenue String    @map("total_net_eligible_revenue") @db.VarChar(64)
  totalCommissionAccrued  String    @map("total_commission_accrued") @db.VarChar(64)
  totalCommissionReversed String    @map("total_commission_reversed") @db.VarChar(64)
  totalCommissionPayable  String    @map("total_commission_payable") @db.VarChar(64)
  commissionCount         Int       @default(0) @map("commission_count")
  reversalCount           Int       @default(0) @map("reversal_count")
  refundCount             Int       @default(0) @map("refund_count")
  chargebackCount         Int       @default(0) @map("chargeback_count")
  fingerprint             String    @db.VarChar(128)
  calculationVersion      String    @map("calculation_version") @db.VarChar(32)
  policyVersion           String    @map("policy_version") @db.VarChar(32)
  agreementVersion        String    @map("agreement_version") @db.VarChar(32)
  reconciledAt            DateTime? @map("reconciled_at") @db.Timestamptz(6)
  lockedAt                DateTime? @map("locked_at") @db.Timestamptz(6)
  completedAt             DateTime? @map("completed_at") @db.Timestamptz(6)
  payoutId                String?   @map("payout_id") @db.VarChar(64)
  createdBy               String    @map("created_by") @db.VarChar(64)
  idempotencyKey          String    @unique @map("idempotency_key") @db.VarChar(255)
  correlationId           String    @map("correlation_id") @db.VarChar(255)
  createdAt               DateTime  @map("created_at") @db.Timestamptz(6)
  updatedAt               DateTime  @map("updated_at") @db.Timestamptz(6)

  @@index([partnerId, createdAt])
  @@index([partnerId, fingerprint])
  @@map("partner_settlements")
}

model PartnerPayout {
  id                String    @id @db.VarChar(64)
  partnerId         String    @map("partner_id") @db.VarChar(64)
  settlementId      String    @map("settlement_id") @db.VarChar(64)
  amount            String    @db.VarChar(64)
  currency          String    @db.VarChar(10)
  state             String    @db.VarChar(32)
  method            String    @db.VarChar(64)
  providerPayoutId  String?   @map("provider_payout_id") @db.VarChar(255)
  providerReference String?   @map("provider_reference") @db.VarChar(255)
  failureReason     String?   @map("failure_reason") @db.Text
  requestedAt       DateTime  @map("requested_at") @db.Timestamptz(6)
  requestedBy       String    @map("requested_by") @db.VarChar(64)
  approvedAt        DateTime? @map("approved_at") @db.Timestamptz(6)
  approvedBy        String?   @map("approved_by") @db.VarChar(64)
  submittedAt       DateTime? @map("submitted_at") @db.Timestamptz(6)
  completedAt       DateTime? @map("completed_at") @db.Timestamptz(6)
  failedAt          DateTime? @map("failed_at") @db.Timestamptz(6)
  reversedAt        DateTime? @map("reversed_at") @db.Timestamptz(6)
  idempotencyKey    String    @unique @map("idempotency_key") @db.VarChar(255)
  correlationId     String    @map("correlation_id") @db.VarChar(255)
  createdAt         DateTime  @map("created_at") @db.Timestamptz(6)
  updatedAt         DateTime  @map("updated_at") @db.Timestamptz(6)

  @@index([partnerId, createdAt])
  @@index([settlementId])
  @@map("partner_payouts")
}

model PartnerUser {
  id             String    @id @db.VarChar(64)
  partnerId      String    @map("partner_id") @db.VarChar(64)
  userId         String    @map("user_id") @db.VarChar(64)
  role           String    @db.VarChar(32)
  state          String    @db.VarChar(32)
  invitedBy      String    @map("invited_by") @db.VarChar(64)
  invitedAt      DateTime  @map("invited_at") @db.Timestamptz(6)
  activatedAt    DateTime? @map("activated_at") @db.Timestamptz(6)
  suspendedAt    DateTime? @map("suspended_at") @db.Timestamptz(6)
  idempotencyKey String    @unique @map("idempotency_key") @db.VarChar(255)
  createdAt      DateTime  @map("created_at") @db.Timestamptz(6)
  updatedAt      DateTime  @map("updated_at") @db.Timestamptz(6)

  /// Not unique: a DEACTIVATED member may be invited again as a new row.
  @@index([partnerId, userId])
  @@index([userId, state])
  @@map("partner_users")
}

model PartnerAudit {
  id               String   @id @db.VarChar(64)
  partnerId        String   @map("partner_id") @db.VarChar(64)
  tenantId         String?  @map("tenant_id") @db.Uuid
  actorId          String   @map("actor_id") @db.VarChar(64)
  actorRole        String?  @map("actor_role") @db.VarChar(64)
  action           String   @db.VarChar(64)
  source           String   @db.VarChar(64)
  correlationId    String   @map("correlation_id") @db.VarChar(255)
  agreementVersion String?  @map("agreement_version") @db.VarChar(32)
  policyVersion    String?  @map("policy_version") @db.VarChar(32)
  timestamp        DateTime @db.Timestamptz(6)
  safeEvidence     Json     @default("{}") @map("safe_evidence")
  createdAt        DateTime @map("created_at") @db.Timestamptz(6)

  @@index([partnerId, timestamp])
  @@index([correlationId])
  @@map("partner_audits")
}
```

FILE: apps/api/prisma/seed/billing/plan-features.ts

```typescript
/**
 * Plan Features Seed Data
 * 
 * This file contains seed data for plan features.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function seedPlanFeatures() {
  console.log('Seeding plan features...');

  const features = [
    // Free Plan Features
    { planId: 'plan-free', key: 'basic_trading', name: 'Basic Trading', description: 'Execute basic buy/sell orders', enabled: true },
    { planId: 'plan-free', key: 'portfolio_view', name: 'Portfolio View', description: 'View your portfolio overview', enabled: true },
    { planId: 'plan-free', key: 'market_data', name: 'Market Data', description: 'Access to market data', enabled: true },
    { planId: 'plan-free', key: 'stop_loss', name: 'Stop Loss', description: 'Set stop loss orders', enabled: true },
    { planId: 'plan-free', key: 'take_profit', name: 'Take Profit', description: 'Set take profit orders', enabled: true },
    { planId: 'plan-free', key: 'two_factor_auth', name: 'Two-Factor Auth', description: 'Secure your account with 2FA', enabled: true },

    // Basic Plan Features
    { planId: 'plan-basic', key: 'basic_trading', name: 'Basic Trading', description: 'Execute basic buy/sell orders', enabled: true },
    { planId: 'plan-basic', key: 'portfolio_view', name: 'Portfolio View', description: 'View your portfolio overview', enabled: true },
    { planId: 'plan-basic', key: 'real_time_data', name: 'Real-time Data', description: 'Access to real-time market data', enabled: true },
    { planId: 'plan-basic', key: 'copy_trading', name: 'Copy Trading', description: 'Copy trades from other traders', enabled: true, limit: 3, unit: 'traders' },
    { planId: 'plan-basic', key: 'basic_analytics', name: 'Basic Analytics', description: 'Basic trading analytics', enabled: true },
    { planId: 'plan-basic', key: 'email_alerts', name: 'Email Alerts', description: 'Receive email notifications', enabled: true },
    { planId: 'plan-basic', key: 'stop_loss', name: 'Stop Loss', description: 'Set stop loss orders', enabled: true },
    { planId: 'plan-basic', key: 'take_profit', name: 'Take Profit', description: 'Set take profit orders', enabled: true },
    { planId: 'plan-basic', key: 'two_factor_auth', name: 'Two-Factor Auth', description: 'Secure your account with 2FA', enabled: true },

    // Standard Plan Features
    { planId: 'plan-standard', key: 'basic_trading', name: 'Basic Trading', description: 'Execute basic buy/sell orders', enabled: true },
    { planId: 'plan-standard', key: 'portfolio_view', name: 'Portfolio View', description: 'View your portfolio overview', enabled: true },
    { planId: 'plan-standard', key: 'real_time_data', name: 'Real-time Data', description: 'Access to real-time market data', enabled: true },
    { planId: 'plan-standard', key: 'copy_trading', name: 'Copy Trading', description: 'Copy trades from other traders', enabled: true, limit: 10, unit: 'traders' },
    { planId: 'plan-standard', key: 'advanced_analytics', name: 'Advanced Analytics', description: 'Advanced trading analytics', enabled: true },
    { planId: 'plan-standard', key: 'risk_management', name: 'Risk Management', description: 'Risk management tools', enabled: true },
    { planId: 'plan-standard', key: 'api_access', name: 'API Access', description: 'Access to trading API', enabled: true },
    { planId: 'plan-standard', key: 'email_alerts', name: 'Email Alerts', description: 'Receive email notifications', enabled: true },
    { planId: 'plan-standard', key: 'push_notifications', name: 'Push Notifications', description: 'Mobile push notifications', enabled: true },
    { planId: 'plan-standard', key: 'stop_loss', name: 'Stop Loss', description: 'Set stop loss orders', enabled: true },
    { planId: 'plan-standard', key: 'take_profit', name: 'Take Profit', description: 'Set take profit orders', enabled: true },
    { planId: 'plan-standard', key: 'position_sizing', name: 'Position Sizing', description: 'Automatic position sizing', enabled: true },
    { planId: 'plan-standard', key: 'custom_reports', name: 'Custom Reports', description: 'Generate custom reports', enabled: true },
    { planId: 'plan-standard', key: 'webhook_support', name: 'Webhook Support', description: 'Webhook integrations', enabled: true },
    { planId: 'plan-standard', key: 'two_factor_auth', name: 'Two-Factor Auth', description: 'Secure your account with 2FA', enabled: true },

    // Premium Plan Features
    { planId: 'plan-premium', key: 'basic_trading', name: 'Basic Trading', description: 'Execute basic buy/sell orders', enabled: true },
    { planId: 'plan-premium', key: 'advanced_trading', name: 'Advanced Trading', description: 'Advanced order types', enabled: true },
    { planId: 'plan-premium', key: 'margin_trading', name: 'Margin Trading', description: 'Trade with leverage', enabled: true },
    { planId: 'plan-premium', key: 'portfolio_view', name: 'Portfolio View', description: 'View your portfolio overview', enabled: true },
    { planId: 'plan-premium', key: 'real_time_data', name: 'Real-time Data', description: 'Access to real-time market data', enabled: true },
    { planId: 'plan-premium', key: 'historical_data', name: 'Historical Data', description: 'Access to historical data', enabled: true },
    { planId: 'plan-premium', key: 'advanced_charts', name: 'Advanced Charts', description: 'Advanced charting tools', enabled: true },
    { planId: 'plan-premium', key: 'copy_trading', name: 'Copy Trading', description: 'Copy trades from other traders', enabled: true, limit: 50, unit: 'traders' },
    { planId: 'plan-premium', key: 'copy_trading_premium', name: 'Premium Copy Trading', description: 'Premium copy trading features', enabled: true },
    { planId: 'plan-premium', key: 'social_trading', name: 'Social Trading', description: 'Social trading features', enabled: true },
    { planId: 'plan-premium', key: 'advanced_analytics', name: 'Advanced Analytics', description: 'Advanced trading analytics', enabled: true },
    { planId: 'plan-premium', key: 'custom_reports', name: 'Custom Reports', description: 'Generate custom reports', enabled: true },
    { planId: 'plan-premium', key: 'portfolio_analytics', name: 'Portfolio Analytics', description: 'Portfolio analytics', enabled: true },
    { planId: 'plan-premium', key: 'risk_management', name: 'Risk Management', description: 'Risk management tools', enabled: true },
    { planId: 'plan-premium', key: 'position_sizing', name: 'Position Sizing', description: 'Automatic position sizing', enabled: true },
    { planId: 'plan-premium', key: 'api_access', name: 'API Access', description: 'Access to trading API', enabled: true },
    { planId: 'plan-premium', key: 'websocket_streaming', name: 'WebSocket Streaming', description: 'Real-time WebSocket streaming', enabled: true },
    { planId: 'plan-premium', key: 'webhook_support', name: 'Webhook Support', description: 'Webhook integrations', enabled: true },
    { planId: 'plan-premium', key: 'email_alerts', name: 'Email Alerts', description: 'Receive email notifications', enabled: true },
    { planId: 'plan-premium', key: 'push_notifications', name: 'Push Notifications', description: 'Mobile push notifications', enabled: true },
    { planId: 'plan-premium', key: 'sms_alerts', name: 'SMS Alerts', description: 'SMS notifications', enabled: true },
    { planId: 'plan-premium', key: 'priority_support', name: 'Priority Support', description: '24/7 priority support', enabled: true },
    { planId: 'plan-premium', key: 'custom_strategies', name: 'Custom Strategies', description: 'Create custom strategies', enabled: true },
    { planId: 'plan-premium', key: 'backtesting', name: 'Backtesting', description: 'Backtest strategies', enabled: true },
    { planId: 'plan-premium', key: 'stop_loss', name: 'Stop Loss', description: 'Set stop loss orders', enabled: true },
    { planId: 'plan-premium', key: 'take_profit', name: 'Take Profit', description: 'Set take profit orders', enabled: true },
    { planId: 'plan-premium', key: 'two_factor_auth', name: 'Two-Factor Auth', description: 'Secure your account with 2FA', enabled: true },
    { planId: 'plan-premium', key: 'ip_whitelist', name: 'IP Whitelist', description: 'IP whitelist security', enabled: true },
    { planId: 'plan-premium', key: 'tax_reporting', name: 'Tax Reporting', description: 'Tax reporting tools', enabled: true },

    // Enterprise Plan Features (all enabled)
    { planId: 'plan-enterprise', key: 'basic_trading', name: 'Basic Trading', description: 'Execute basic buy/sell orders', enabled: true },
    { planId: 'plan-enterprise', key: 'advanced_trading', name: 'Advanced Trading', description: 'Advanced order types', enabled: true },
    { planId: 'plan-enterprise', key: 'margin_trading', name: 'Margin Trading', description: 'Trade with leverage', enabled: true },
    { planId: 'plan-enterprise', key: 'portfolio_view', name: 'Portfolio View', description: 'View your portfolio overview', enabled: true },
    { planId: 'plan-enterprise', key: 'real_time_data', name: 'Real-time Data', description: 'Access to real-time market data', enabled: true },
    { planId: 'plan-enterprise', key: 'historical_data', name: 'Historical Data', description: 'Access to historical data', enabled: true },
    { planId: 'plan-enterprise', key: 'advanced_charts', name: 'Advanced Charts', description: 'Advanced charting tools', enabled: true },
    { planId: 'plan-enterprise', key: 'copy_trading', name: 'Copy Trading', description: 'Copy trades from other traders', enabled: true },
    { planId: 'plan-enterprise', key: 'copy_trading_premium', name: 'Premium Copy Trading', description: 'Premium copy trading features', enabled: true },
    { planId: 'plan-enterprise', key: 'social_trading', name: 'Social Trading', description: 'Social trading features', enabled: true },
    { planId: 'plan-enterprise', key: 'advanced_analytics', name: 'Advanced Analytics', description: 'Advanced trading analytics', enabled: true },
    { planId: 'plan-enterprise', key: 'custom_reports', name: 'Custom Reports', description: 'Generate custom reports', enabled: true },
    { planId: 'plan-enterprise', key: 'portfolio_analytics', name: 'Portfolio Analytics', description: 'Portfolio analytics', enabled: true },
    { planId: 'plan-enterprise', key: 'risk_management', name: 'Risk Management', description: 'Risk management tools', enabled: true },
    { planId: 'plan-enterprise', key: 'position_sizing', name: 'Position Sizing', description: 'Automatic position sizing', enabled: true },
    { planId: 'plan-enterprise', key: 'api_access', name: 'API Access', description: 'Access to trading API', enabled: true },
    { planId: 'plan-enterprise', key: 'websocket_streaming', name: 'WebSocket Streaming', description: 'Real-time WebSocket streaming', enabled: true },
    { planId: 'plan-enterprise', key: 'webhook_support', name: 'Webhook Support', description: 'Webhook integrations', enabled: true },
    { planId: 'plan-enterprise', key: 'email_alerts', name: 'Email Alerts', description: 'Receive email notifications', enabled: true },
    { planId: 'plan-enterprise', key: 'push_notifications', name: 'Push Notifications', description: 'Mobile push notifications', enabled: true },
    { planId: 'plan-enterprise', key: 'sms_alerts', name: 'SMS Alerts', description: 'SMS notifications', enabled: true },
    { planId: 'plan-enterprise', key: 'priority_support', name: 'Priority Support', description: '24/7 priority support', enabled: true },
    { planId: 'plan-enterprise', key: 'custom_strategies', name: 'Custom Strategies', description: 'Create custom strategies', enabled: true },
    { planId: 'plan-enterprise', key: 'backtesting', name: 'Backtesting', description: 'Backtest strategies', enabled: true },
    { planId: 'plan-enterprise', key: 'stop_loss', name: 'Stop Loss', description: 'Set stop loss orders', enabled: true },
    { planId: 'plan-enterprise', key: 'take_profit', name: 'Take Profit', description: 'Set take profit orders', enabled: true },
    { planId: 'plan-enterprise', key: 'two_factor_auth', name: 'Two-Factor Auth', description: 'Secure your account with 2FA', enabled: true },
    { planId: 'plan-enterprise', key: 'ip_whitelist', name: 'IP Whitelist', description: 'IP whitelist security', enabled: true },
    { planId: 'plan-enterprise', key: 'tax_reporting', name: 'Tax Reporting', description: 'Tax reporting tools', enabled: true },
    { planId: 'plan-enterprise', key: 'dedicated_support', name: 'Dedicated Support', description: 'Dedicated account manager', enabled: true },
    { planId: 'plan-enterprise', key: 'custom_integrations', name: 'Custom Integrations', description: 'Custom integrations', enabled: true },
    { planId: 'plan-enterprise', key: 'white_label', name: 'White Label', description: 'White label solutions', enabled: true },
    { planId: 'plan-enterprise', key: 'sla', name: 'SLA', description: 'Service level agreement', enabled: true },
  ];

  for (const feature of features) {
    await prisma.planFeature.upsert({
      where: {
        planId_key: {
          planId: feature.planId,
          key: feature.key,
        },
      },
      update: feature,
      create: feature,
    });
  }

  console.log(`Seeded ${features.length} plan features`);
}
```

FILE: apps/api/prisma/seed/billing/plan-limits.ts

```typescript
/**
 * Plan Limits Seed Data
 * 
 * This file contains seed data for plan limits.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function seedPlanLimits() {
  console.log('Seeding plan limits...');

  const limits = [
    // Free Plan Limits
    { planId: 'plan-free', key: 'max_portfolios', name: 'Portfolios', description: 'Maximum portfolios', value: 1, unit: 'portfolios', hardLimit: true },
    { planId: 'plan-free', key: 'max_orders_per_day', name: 'Daily Orders', description: 'Maximum orders per day', value: 10, unit: 'orders', hardLimit: true },
    { planId: 'plan-free', key: 'max_position_value', name: 'Position Value', description: 'Maximum position value', value: 1000, unit: 'USD', hardLimit: true },

    // Basic Plan Limits
    { planId: 'plan-basic', key: 'max_portfolios', name: 'Portfolios', description: 'Maximum portfolios', value: 3, unit: 'portfolios', hardLimit: true },
    { planId: 'plan-basic', key: 'max_exchanges', name: 'Exchanges', description: 'Connected exchanges', value: 2, unit: 'exchanges', hardLimit: true },
    { planId: 'plan-basic', key: 'max_orders_per_day', name: 'Daily Orders', description: 'Maximum orders per day', value: 50, unit: 'orders', hardLimit: true },
    { planId: 'plan-basic', key: 'max_position_value', name: 'Position Value', description: 'Maximum position value', value: 10000, unit: 'USD', hardLimit: true },
    { planId: 'plan-basic', key: 'max_copy_sources', name: 'Copy Sources', description: 'Traders to copy from', value: 3, unit: 'traders', hardLimit: true },

    // Standard Plan Limits
    { planId: 'plan-standard', key: 'max_portfolios', name: 'Portfolios', description: 'Maximum portfolios', value: 10, unit: 'portfolios', hardLimit: true },
    { planId: 'plan-standard', key: 'max_exchanges', name: 'Exchanges', description: 'Connected exchanges', value: 5, unit: 'exchanges', hardLimit: true },
    { planId: 'plan-standard', key: 'max_orders_per_day', name: 'Daily Orders', description: 'Maximum orders per day', value: 200, unit: 'orders', hardLimit: true },
    { planId: 'plan-standard', key: 'max_position_value', name: 'Position Value', description: 'Maximum position value', value: 100000, unit: 'USD', hardLimit: true },
    { planId: 'plan-standard', key: 'max_copy_sources', name: 'Copy Sources', description: 'Traders to copy from', value: 10, unit: 'traders', hardLimit: true },
    { planId: 'plan-standard', key: 'max_strategies', name: 'Strategies', description: 'Custom strategies', value: 5, unit: 'strategies', hardLimit: true },
    { planId: 'plan-standard', key: 'api_requests_per_minute', name: 'API Rate', description: 'API requests per minute', value: 100, unit: 'req/min', hardLimit: true },

    // Premium Plan Limits
    { planId: 'plan-premium', key: 'max_portfolios', name: 'Portfolios', description: 'Maximum portfolios', value: 100, unit: 'portfolios', hardLimit: true },
    { planId: 'plan-premium', key: 'max_exchanges', name: 'Exchanges', description: 'Connected exchanges', value: 20, unit: 'exchanges', hardLimit: true },
    { planId: 'plan-premium', key: 'max_orders_per_day', name: 'Daily Orders', description: 'Maximum orders per day', value: 1000, unit: 'orders', hardLimit: true },
    { planId: 'plan-premium', key: 'max_position_value', name: 'Position Value', description: 'Maximum position value', value: 1000000, unit: 'USD', hardLimit: true },
    { planId: 'plan-premium', key: 'max_copy_sources', name: 'Copy Sources', description: 'Traders to copy from', value: 50, unit: 'traders', hardLimit: true },
    { planId: 'plan-premium', key: 'max_strategies', name: 'Strategies', description: 'Custom strategies', value: 20, unit: 'strategies', hardLimit: true },
    { planId: 'plan-premium', key: 'api_requests_per_minute', name: 'API Rate', description: 'API requests per minute', value: 1000, unit: 'req/min', hardLimit: true },
    { planId: 'plan-premium', key: 'max_storage_mb', name: 'Storage', description: 'Storage space', value: 5000, unit: 'MB', hardLimit: true },

    // Enterprise Plan Limits (unlimited)
    { planId: 'plan-enterprise', key: 'max_portfolios', name: 'Portfolios', description: 'Maximum portfolios', value: -1, unit: 'portfolios', hardLimit: true },
    { planId: 'plan-enterprise', key: 'max_exchanges', name: 'Exchanges', description: 'Connected exchanges', value: -1, unit: 'exchanges', hardLimit: true },
    { planId: 'plan-enterprise', key: 'max_orders_per_day', name: 'Daily Orders', description: 'Maximum orders per day', value: -1, unit: 'orders', hardLimit: true },
    { planId: 'plan-enterprise', key: 'max_position_value', name: 'Position Value', description: 'Maximum position value', value: -1, unit: 'USD', hardLimit: true },
    { planId: 'plan-enterprise', key: 'max_copy_sources', name: 'Copy Sources', description: 'Traders to copy from', value: -1, unit: 'traders', hardLimit: true },
    { planId: 'plan-enterprise', key: 'max_strategies', name: 'Strategies', description: 'Custom strategies', value: -1, unit: 'strategies', hardLimit: true },
    { planId: 'plan-enterprise', key: 'api_requests_per_minute', name: 'API Rate', description: 'API requests per minute', value: -1, unit: 'req/min', hardLimit: true },
    { planId: 'plan-enterprise', key: 'max_storage_mb', name: 'Storage', description: 'Storage space', value: -1, unit: 'MB', hardLimit: true },
  ];

  for (const limit of limits) {
    await prisma.planLimit.upsert({
      where: {
        planId_key: {
          planId: limit.planId,
          key: limit.key,
        },
      },
      update: limit,
      create: limit,
    });
  }

  console.log(`Seeded ${limits.length} plan limits`);
}
```

FILE: apps/api/prisma/seed/billing/plans.ts

```typescript
/**
 * Plans Seed Data
 *
 * This file contains seed data for billing plans.
 *
 * Shape note: rows here match the `Plan` model in prisma/schema.prisma.
 * `tenantId` is left null so these are platform-catalogue plans every tenant
 * sees (the same convention `subscription_plans` uses), and the price is the
 * structured object the repository reads and writes as one JSON column.
 */

import { PlanStatus, PlanTier, PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const SEEDED_BY = 'seed:billing-plans';

export async function seedPlans() {
  console.log('Seeding plans...');

  const plans = [
    {
      id: 'plan-free',
      tenantId: null,
      name: 'Free',
      slug: 'free',
      description: 'Get started with basic trading features',
      tier: PlanTier.free,
      status: PlanStatus.active,
      price: { amount: 0, currency: 'USD', interval: 'monthly', trialDays: 0 },
      metadata: {},
    },
    {
      id: 'plan-basic',
      tenantId: null,
      name: 'Basic',
      slug: 'basic',
      description: 'Perfect for individual traders getting started',
      tier: PlanTier.basic,
      status: PlanStatus.active,
      price: { amount: 29, currency: 'USD', interval: 'monthly', trialDays: 7 },
      metadata: {},
    },
    {
      id: 'plan-standard',
      tenantId: null,
      name: 'Standard',
      slug: 'standard',
      description: 'For serious traders who need more power',
      tier: PlanTier.standard,
      status: PlanStatus.active,
      price: { amount: 79, currency: 'USD', interval: 'monthly', trialDays: 7 },
      metadata: {},
    },
    {
      id: 'plan-premium',
      tenantId: null,
      name: 'Premium',
      slug: 'premium',
      description: 'Advanced features for professional trading teams',
      tier: PlanTier.premium,
      status: PlanStatus.active,
      price: { amount: 199, currency: 'USD', interval: 'monthly', trialDays: 14 },
      metadata: {},
    },
    {
      id: 'plan-enterprise',
      tenantId: null,
      name: 'Enterprise',
      slug: 'enterprise',
      description: 'Custom solutions for large organizations',
      tier: PlanTier.enterprise,
      status: PlanStatus.active,
      price: { amount: 499, currency: 'USD', interval: 'monthly', trialDays: 14 },
      metadata: {},
    },
  ];

  for (const plan of plans) {
    await prisma.plan.upsert({
      where: { id: plan.id },
      update: {
        name: plan.name,
        slug: plan.slug,
        description: plan.description,
        tier: plan.tier,
        status: plan.status,
        price: plan.price,
        metadata: plan.metadata,
        updatedBy: SEEDED_BY,
      },
      create: {
        id: plan.id,
        tenantId: plan.tenantId,
        name: plan.name,
        slug: plan.slug,
        description: plan.description,
        tier: plan.tier,
        status: plan.status,
        price: plan.price,
        metadata: plan.metadata,
        createdBy: SEEDED_BY,
        updatedBy: SEEDED_BY,
      },
    });
  }

  console.log(`Seeded ${plans.length} plans.`);
}

// Allow running directly: `npx ts-node --transpile-only prisma/seed/billing/plans.ts`
if (require.main === module) {
  seedPlans()
    .catch((error) => {
      console.error('Plan seeding failed:', error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
```

FILE: apps/api/prisma/seed.ts

```typescript
/**
 * Database seed.
 *
 * Idempotent by construction: every write is an upsert keyed on a natural
 * unique constraint, so the script can be run repeatedly against the same
 * database (local bootstrap, CI, a fresh staging environment) without creating
 * duplicates or resetting data that an operator has since changed.
 *
 * What it creates:
 *   1. the permission catalogue derived from the shared `Permission` enum;
 *   2. the platform-level system role templates;
 *   3. the platform tenant plus a tenant-scoped copy of the system roles;
 *   4. the feature flag definitions;
 *   5. the platform subscription plan catalogue;
 *   6. the initial super administrator.
 *
 * The super administrator's password is never hardcoded. It is read from
 * SEED_SUPER_ADMIN_PASSWORD; when that variable is absent the script generates
 * a strong random password, prints it once, and never stores it anywhere else.
 * A provided password must satisfy the same policy the API enforces on every
 * other password (`evaluatePassword` from @wlct/validation, minimum length from
 * PASSWORD_MIN_LENGTH), and it is checked before the first database write.
 */
import { PrismaClient, Prisma } from '@prisma/client';
import * as argon2 from 'argon2';
import { createHmac, randomBytes } from 'node:crypto';
import {
  BillingInterval,
  PlanAudience,
  Permission,
  RoleScope,
  SYSTEM_ROLE_DEFINITIONS,
  SystemRole,
  TenantStatus,
} from '@wlct/shared-types';
import { FEATURE_FLAG_KEYS } from '@wlct/config';
import { DEFAULT_PASSWORD_POLICY, evaluatePassword } from '@wlct/validation';

const prisma = new PrismaClient();

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. Copy .env.example to .env and fill in every required value before seeding.`,
    );
  }
  return value;
}

/**
 * Blind index used for equality lookups on encrypted/­sensitive columns. Must
 * match the implementation in `packages/utils` so the API can find the row.
 */
function blindIndex(value: string): string {
  const key = Buffer.from(requireEnv('BLIND_INDEX_KEY_BASE64'), 'base64');
  return createHmac('sha256', key).update(value.trim().toLowerCase()).digest('hex');
}

function generatePassword(): string {
  // 32 random bytes rendered base64url: ~192 bits of entropy, no ambiguity.
  return randomBytes(32).toString('base64url');
}

/**
 * Placeholder credentials that must never reach a real database.
 *
 * `.env.example` ships a deliberately obvious value so the file is runnable out
 * of the box, and the most likely operator mistake is copying it to `.env` and
 * never touching it - which would leave a publicly documented password on the
 * super administrator. Seeding stops instead of silently accepting it.
 */
const PLACEHOLDER_PASSWORD_MARKERS = [
  'changeme',
  'change_me',
  'change-me',
  'password',
  'placeholder',
  'secret',
  'admin123',
];

function assertNotPlaceholder(name: string, value: string): void {
  const normalised = value.trim().toLowerCase();
  const looksLikePlaceholder = PLACEHOLDER_PASSWORD_MARKERS.some((marker) =>
    normalised.includes(marker),
  );

  if (looksLikePlaceholder) {
    throw new Error(
      `${name} still holds the placeholder value from .env.example. ` +
        'Set a real password, or unset the variable entirely and the seed will ' +
        'generate a strong one and print it once.',
    );
  }
}

/**
 * The password policy the API applies through PasswordService.evaluate():
 * DEFAULT_PASSWORD_POLICY with the minimum length taken from
 * PASSWORD_MIN_LENGTH (env schema default 12).
 *
 * Round 8 (Docker run): the seed only rejected the .env.example placeholder, so
 * any other non-empty value became the super administrator's password - even
 * six characters. The case that produced it is the one .env.example warns
 * about: an unquoted '#' makes dotenv-cli truncate the value, the seed hashes
 * the truncated password without complaint, and the operator's first login is
 * an inexplicable 401. The registration and password-change paths have always
 * enforced this policy; the seed was the only way around it.
 */
function passwordMinLength(): number {
  const configured = Number.parseInt(process.env.PASSWORD_MIN_LENGTH ?? '', 10);
  return Number.isInteger(configured) && configured > 0
    ? configured
    : DEFAULT_PASSWORD_POLICY.minLength;
}

function assertPasswordPolicy(name: string, value: string, email: string): void {
  const evaluation = evaluatePassword(
    value,
    { ...DEFAULT_PASSWORD_POLICY, minLength: passwordMinLength() },
    { email },
  );

  if (!evaluation.valid) {
    throw new Error(
      `${name} does not meet the password policy the API enforces: ` +
        `${evaluation.errors.join('; ')}. ` +
        "If the value in .env contains '#', wrap it in double quotes: dotenv treats an " +
        "unquoted '#' as the start of a comment and truncates the value (see the QUOTING " +
        'note in .env.example). Or unset the variable entirely and the seed will generate ' +
        'a strong password and print it once.',
    );
  }
}

/**
 * Checks the super administrator credentials before anything is written, so a
 * rejected password never leaves a half-seeded database behind.
 */
function assertSuperAdminCredentials(): void {
  const email = requireEnv('SEED_SUPER_ADMIN_EMAIL').trim().toLowerCase();
  const providedPassword = process.env.SEED_SUPER_ADMIN_PASSWORD;
  if (providedPassword) {
    assertNotPlaceholder('SEED_SUPER_ADMIN_PASSWORD', providedPassword);
    assertPasswordPolicy('SEED_SUPER_ADMIN_PASSWORD', providedPassword, email);
  }
}

function describePermission(key: string): { resource: string; action: string; description: string } {
  if (key === Permission.ALL) {
    return {
      resource: '*',
      action: '*',
      description: 'Unrestricted access to every resource on the platform.',
    };
  }

  const [resource, action] = key.split(':');
  const readableResource = resource.replace(/_/g, ' ');
  const readableAction = action.replace(/_/g, ' ');

  return {
    resource,
    action,
    description: `Allows the holder to ${readableAction} ${readableResource} records.`,
  };
}

/**
 * Permissions that grant the ability to move money, change authorisation or
 * read regulated data. Flagged so the API can demand re-authentication before
 * they are granted to a role.
 */
const DANGEROUS_PERMISSIONS = new Set<string>([
  Permission.ALL,
  Permission.PLATFORM_MANAGE,
  Permission.PLATFORM_IMPERSONATE,
  Permission.TENANT_DELETE,
  Permission.TENANT_SUSPEND,
  Permission.USER_DELETE,
  Permission.USER_RESET_PASSWORD,
  Permission.USER_ASSIGN_ROLE,
  Permission.ROLE_CREATE,
  Permission.ROLE_UPDATE,
  Permission.ROLE_DELETE,
  Permission.PAYOUT_MANAGE,
  Permission.EXCHANGE_ACCOUNT_MANAGE,
  Permission.ORDER_MANAGE,
  Permission.KYC_REVIEW,
]);

// -----------------------------------------------------------------------------
// 1. Permission catalogue
// -----------------------------------------------------------------------------

async function seedPermissions(): Promise<Map<string, string>> {
  const keys = Object.values(Permission);
  const ids = new Map<string, string>();

  for (const key of keys) {
    const meta = describePermission(key);

    const permission = await prisma.permission.upsert({
      where: { key },
      create: {
        key,
        resource: meta.resource,
        action: meta.action,
        description: meta.description,
        isDangerous: DANGEROUS_PERMISSIONS.has(key),
      },
      update: {
        resource: meta.resource,
        action: meta.action,
        description: meta.description,
        isDangerous: DANGEROUS_PERMISSIONS.has(key),
      },
      select: { id: true, key: true },
    });

    ids.set(permission.key, permission.id);
  }

  console.log(`  permissions .......... ${ids.size}`);
  return ids;
}

// -----------------------------------------------------------------------------
// 2. Role templates (tenantId = null)
// -----------------------------------------------------------------------------

async function seedRoleTemplates(permissionIds: Map<string, string>): Promise<void> {
  for (const [index, definition] of SYSTEM_ROLE_DEFINITIONS.entries()) {
    // Prisma cannot express `null` inside a compound unique lookup, so the
    // platform-scoped templates (tenantId IS NULL) are matched explicitly.
    const existingTemplate = await prisma.role.findFirst({
      where: { tenantId: null, key: definition.key },
      select: { id: true },
    });

    const role = existingTemplate
      ? await prisma.role.update({
          where: { id: existingTemplate.id },
          data: {
            name: definition.name,
            description: definition.description,
            scope: definition.scope,
            isSystem: true,
            priority: (index + 1) * 10,
            deletedAt: null,
          },
          select: { id: true },
        })
      : await prisma.role.create({
          data: {
            tenantId: null,
            key: definition.key,
            name: definition.name,
            description: definition.description,
            scope: definition.scope,
            isSystem: true,
            isDefault: definition.key === SystemRole.FOLLOWER,
            priority: (index + 1) * 10,
          },
          select: { id: true },
        });

    // Re-project the permission set so template changes propagate on re-seed.
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    await prisma.rolePermission.createMany({
      data: definition.permissions
        .map((key) => permissionIds.get(key))
        .filter((id): id is string => Boolean(id))
        .map((permissionId) => ({ roleId: role.id, permissionId })),
      skipDuplicates: true,
    });
  }

  console.log(`  role templates ....... ${SYSTEM_ROLE_DEFINITIONS.length}`);
}

// -----------------------------------------------------------------------------
// 3. Platform tenant + its own copy of the tenant-scoped roles
// -----------------------------------------------------------------------------

async function seedPlatformTenant(permissionIds: Map<string, string>): Promise<string> {
  const slug = process.env.DEFAULT_TENANT_SLUG ?? 'platform';

  const tenant = await prisma.tenant.upsert({
    where: { slug },
    create: {
      slug,
      name: process.env.APP_NAME ?? 'Copy Trading Platform',
      legalName: null,
      status: TenantStatus.ACTIVE,
      contactEmail: requireEnv('SEED_SUPER_ADMIN_EMAIL'),
      defaultLocale: process.env.DEFAULT_LOCALE ?? 'en',
      supportedLocales: (process.env.SUPPORTED_LOCALES ?? 'en,es,ar,bn,tr').split(','),
      defaultCurrency: process.env.DEFAULT_CURRENCY ?? 'USD',
      supportedCurrencies: (process.env.SUPPORTED_CURRENCIES ?? 'USD').split(','),
      timezone: 'UTC',
      branding: {
        create: {
          appName: process.env.APP_NAME ?? 'Copy Trading Platform',
        },
      },
    },
    update: {
      status: TenantStatus.ACTIVE,
      deletedAt: null,
    },
    select: { id: true },
  });

  for (const definition of SYSTEM_ROLE_DEFINITIONS) {
    if (definition.scope !== RoleScope.TENANT) {
      continue;
    }

    const role = await prisma.role.upsert({
      where: { tenantId_key: { tenantId: tenant.id, key: definition.key } },
      create: {
        tenantId: tenant.id,
        key: definition.key,
        name: definition.name,
        description: definition.description,
        scope: definition.scope,
        isSystem: true,
        isDefault: definition.key === SystemRole.FOLLOWER,
      },
      update: { name: definition.name, description: definition.description, deletedAt: null },
      select: { id: true },
    });

    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    await prisma.rolePermission.createMany({
      data: definition.permissions
        .map((key) => permissionIds.get(key))
        .filter((id): id is string => Boolean(id))
        .map((permissionId) => ({ roleId: role.id, permissionId })),
      skipDuplicates: true,
    });
  }

  console.log(`  platform tenant ...... ${slug}`);
  return tenant.id;
}

// -----------------------------------------------------------------------------
// 4. Feature flag definitions
// -----------------------------------------------------------------------------

interface FlagSeed {
  key: string;
  name: string;
  description: string;
  isGlobalDefault: boolean;
}

const FEATURE_FLAG_SEEDS: FlagSeed[] = [
  {
    key: FEATURE_FLAG_KEYS.COPY_TRADING,
    name: 'Copy trading',
    description: 'Followers can mirror a trader strategy. Requires exchange integration.',
    isGlobalDefault: false,
  },
  {
    key: FEATURE_FLAG_KEYS.SPOT_TRADING,
    name: 'Spot trading',
    description: 'Enables spot markets for the tenant.',
    isGlobalDefault: false,
  },
  {
    key: FEATURE_FLAG_KEYS.FUTURES_TRADING,
    name: 'Futures trading',
    description: 'Enables derivatives markets. Requires elevated risk controls.',
    isGlobalDefault: false,
  },
  {
    key: FEATURE_FLAG_KEYS.PAPER_TRADING,
    name: 'Paper trading',
    description: 'Simulated execution against live prices. Never touches an exchange.',
    isGlobalDefault: true,
  },
  {
    key: FEATURE_FLAG_KEYS.REFERRAL_PROGRAM,
    name: 'Referral programme',
    description: 'Referral codes and reward tracking.',
    isGlobalDefault: false,
  },
  {
    key: FEATURE_FLAG_KEYS.KYC_REQUIRED,
    name: 'Mandatory KYC',
    description: 'Blocks trading features until identity verification succeeds.',
    isGlobalDefault: true,
  },
  {
    key: FEATURE_FLAG_KEYS.TWO_FACTOR_MANDATORY,
    name: 'Mandatory two-factor authentication',
    description: 'Every user must enrol in 2FA before using the platform.',
    isGlobalDefault: false,
  },
  {
    key: FEATURE_FLAG_KEYS.PUBLIC_REGISTRATION,
    name: 'Public registration',
    description: 'Allows self-service sign-up. Disable for invitation-only brands.',
    isGlobalDefault: true,
  },
  {
    key: FEATURE_FLAG_KEYS.CUSTOM_DOMAIN,
    name: 'Custom domain',
    description: 'Lets the tenant serve the app from its own domain.',
    isGlobalDefault: false,
  },
  {
    key: FEATURE_FLAG_KEYS.MOBILE_APP,
    name: 'Mobile application',
    description: 'Enables the white-label mobile client for the tenant.',
    isGlobalDefault: true,
  },
  {
    key: FEATURE_FLAG_KEYS.ADVANCED_ANALYTICS,
    name: 'Advanced analytics',
    description: 'Extended performance reporting and attribution.',
    isGlobalDefault: false,
  },
  {
    key: FEATURE_FLAG_KEYS.WITHDRAWAL_NOTIFICATIONS,
    name: 'Withdrawal notifications',
    description: 'Alerts users when a withdrawal is detected on a linked account.',
    isGlobalDefault: true,
  },
];

async function seedFeatureFlags(tenantId: string): Promise<void> {
  for (const flag of FEATURE_FLAG_SEEDS) {
    const definition = await prisma.featureFlag.upsert({
      where: { key: flag.key },
      create: {
        key: flag.key,
        name: flag.name,
        description: flag.description,
        isGlobalDefault: flag.isGlobalDefault,
        rolloutPercentage: 100,
      },
      update: { name: flag.name, description: flag.description },
      select: { id: true },
    });

    await prisma.tenantFeatureFlag.upsert({
      where: { tenantId_featureFlagId: { tenantId, featureFlagId: definition.id } },
      create: { tenantId, featureFlagId: definition.id, enabled: flag.isGlobalDefault },
      update: {},
    });
  }

  console.log(`  feature flags ........ ${FEATURE_FLAG_SEEDS.length}`);
}

// -----------------------------------------------------------------------------
// 5. Platform plan catalogue
// -----------------------------------------------------------------------------

interface PlanSeed {
  code: string;
  name: string;
  description: string;
  price: string;
  interval: BillingInterval;
  trialDays: number;
  platformFeeBps: number;
  sortOrder: number;
  limits: Record<string, number | boolean | null>;
  features: string[];
}

const PLAN_SEEDS: PlanSeed[] = [
  {
    code: 'starter',
    name: 'Starter',
    description: 'For a new brand validating its audience.',
    price: '149.000000',
    interval: BillingInterval.MONTHLY,
    trialDays: 14,
    platformFeeBps: 100,
    sortOrder: 10,
    limits: {
      maxUsers: 250,
      maxTraders: 5,
      maxFollowersPerTrader: 100,
      maxExchangeAccountsPerUser: 1,
      maxCopySubscriptionsPerFollower: 2,
      maxApiRequestsPerMinute: 300,
      websocketConnections: 500,
      customDomain: false,
      whiteLabelMobileApp: false,
      prioritySupport: false,
    },
    features: ['Branded web app', 'Email support', 'Standard analytics'],
  },
  {
    code: 'growth',
    name: 'Growth',
    description: 'For an established brand scaling its trader roster.',
    price: '499.000000',
    interval: BillingInterval.MONTHLY,
    trialDays: 14,
    platformFeeBps: 75,
    sortOrder: 20,
    limits: {
      maxUsers: 5000,
      maxTraders: 50,
      maxFollowersPerTrader: 1000,
      maxExchangeAccountsPerUser: 3,
      maxCopySubscriptionsPerFollower: 10,
      maxApiRequestsPerMinute: 1200,
      websocketConnections: 5000,
      customDomain: true,
      whiteLabelMobileApp: true,
      prioritySupport: false,
    },
    features: ['Custom domain', 'White-label mobile app', 'Advanced analytics'],
  },
  {
    code: 'enterprise',
    name: 'Enterprise',
    description: 'Unlimited scale with dedicated support and compliance tooling.',
    price: '2499.000000',
    interval: BillingInterval.MONTHLY,
    trialDays: 0,
    platformFeeBps: 50,
    sortOrder: 30,
    limits: {
      maxUsers: null,
      maxTraders: null,
      maxFollowersPerTrader: null,
      maxExchangeAccountsPerUser: 10,
      maxCopySubscriptionsPerFollower: null,
      maxApiRequestsPerMinute: 6000,
      websocketConnections: 50000,
      customDomain: true,
      whiteLabelMobileApp: true,
      prioritySupport: true,
    },
    features: [
      'Unlimited users and traders',
      'Dedicated success manager',
      'Compliance exports',
      '99.9% uptime SLA',
    ],
  },
];

async function seedPlans(): Promise<void> {
  for (const plan of PLAN_SEEDS) {
    // Platform catalogue plans have `tenantId = null`, which a compound unique
    // lookup cannot express; match them explicitly instead.
    const existingPlan = await prisma.subscriptionPlan.findFirst({
      where: { tenantId: null, code: plan.code },
      select: { id: true },
    });

    if (existingPlan) {
      await prisma.subscriptionPlan.update({
        where: { id: existingPlan.id },
        data: {
          name: plan.name,
          description: plan.description,
          price: new Prisma.Decimal(plan.price),
          limits: plan.limits as Prisma.InputJsonValue,
          features: plan.features,
          sortOrder: plan.sortOrder,
          deletedAt: null,
        },
      });
    } else {
      await prisma.subscriptionPlan.create({
        data: {
          tenantId: null,
          code: plan.code,
          name: plan.name,
          description: plan.description,
          audience: PlanAudience.TENANT,
          price: new Prisma.Decimal(plan.price),
          currency: 'USD',
          interval: plan.interval,
          trialDays: plan.trialDays,
          platformFeeBps: plan.platformFeeBps,
          performanceFeeBps: 0,
          limits: plan.limits as Prisma.InputJsonValue,
          features: plan.features,
          isActive: true,
          sortOrder: plan.sortOrder,
        },
      });
    }
  }

  console.log(`  subscription plans ... ${PLAN_SEEDS.length}`);
}

// -----------------------------------------------------------------------------
// 6. Super administrator
// -----------------------------------------------------------------------------

async function seedSuperAdmin(tenantId: string): Promise<void> {
  const email = requireEnv('SEED_SUPER_ADMIN_EMAIL').trim().toLowerCase();
  const providedPassword = process.env.SEED_SUPER_ADMIN_PASSWORD;
  if (providedPassword) {
    assertNotPlaceholder('SEED_SUPER_ADMIN_PASSWORD', providedPassword);
    assertPasswordPolicy('SEED_SUPER_ADMIN_PASSWORD', providedPassword, email);
  }
  const password = providedPassword ?? generatePassword();

  const existing = await prisma.user.findUnique({
    where: { tenantId_email: { tenantId, email } },
    select: { id: true },
  });

  const passwordHash = await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: Number(process.env.ARGON2_MEMORY_COST ?? 65536),
    timeCost: Number(process.env.ARGON2_TIME_COST ?? 3),
    parallelism: Number(process.env.ARGON2_PARALLELISM ?? 4),
  });

  const user = existing
    ? await prisma.user.update({
        where: { id: existing.id },
        data: {
          status: 'ACTIVE',
          isPlatformUser: true,
          deletedAt: null,
          lockedUntil: null,
          failedLoginAttempts: 0,
          // An existing administrator keeps their password; re-seeding must not
          // silently reset a credential an operator is already using.
          ...(providedPassword ? { passwordHash, passwordChangedAt: new Date() } : {}),
        },
        select: { id: true },
      })
    : await prisma.user.create({
        data: {
          tenantId,
          email,
          emailIndex: blindIndex(email),
          passwordHash,
          status: 'ACTIVE',
          isPlatformUser: true,
          emailVerifiedAt: new Date(),
          passwordChangedAt: new Date(),
          profile: {
            create: {
              firstName: 'Platform',
              lastName: 'Administrator',
              displayName: 'Platform Administrator',
              locale: process.env.DEFAULT_LOCALE ?? 'en',
              preferredCurrency: process.env.DEFAULT_CURRENCY ?? 'USD',
              timezone: 'UTC',
            },
          },
        },
        select: { id: true },
      });

  const superAdminRole = await prisma.role.findFirst({
    where: { tenantId: null, key: SystemRole.SUPER_ADMIN },
    select: { id: true },
  });

  if (superAdminRole) {
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: superAdminRole.id } },
      create: { userId: user.id, roleId: superAdminRole.id, tenantId },
      update: {},
    });
  }

  console.log(`  super administrator .. ${email}`);

  if (!existing && !providedPassword) {
    console.log('');
    console.log('  ----------------------------------------------------------------');
    console.log('  A password was generated for the super administrator.');
    console.log('  It is shown once and is NOT stored anywhere in plaintext.');
    console.log('');
    console.log(`      email:    ${email}`);
    console.log(`      password: ${password}`);
    console.log('');
    console.log('  Store it in your password manager and rotate it after first use.');
    console.log('  ----------------------------------------------------------------');
    console.log('');
  }
}

// -----------------------------------------------------------------------------
// Entrypoint
// -----------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('Seeding database...');

  assertSuperAdminCredentials();

  const permissionIds = await seedPermissions();
  await seedRoleTemplates(permissionIds);
  const tenantId = await seedPlatformTenant(permissionIds);
  await seedFeatureFlags(tenantId);
  await seedPlans();
  await seedSuperAdmin(tenantId);

  console.log('Seed complete.');
}

main()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Seed failed: ${message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
```

FILE: apps/api/prisma/upgrades/rls_policies_153_to_182.sql

```sql
-- RLS policy upgrade for databases migrated BEFORE the domain-persistence tables were added.
--
-- WHO NEEDS THIS. `prisma migrate deploy` never re-runs a migration that is already recorded in
-- _prisma_migrations. 20260923090000_part11_row_level_security is regenerated by
-- scripts/gen_part11_rls.py whenever tenant tables are added (see the note at the top of
-- 20260923080000_developer_platform_mobile_release). A database that applied an older version of
-- it (153 policies, upstream 71ff495) therefore gets the new tables from the earlier-stamped
-- migrations but NOT their tenant_isolation policies. Fresh databases do not need this file:
-- the current migration already creates all 182 policies.
--
-- WHAT IT DOES. Creates the tenant_isolation policy on the 29 tenant tables covered since then.
-- Every CREATE POLICY below is copied byte-for-byte from the generated migration; nothing else
-- is changed. Each is preceded by DROP POLICY IF EXISTS, so the file is safe to run more than
-- once, and the whole file is one transaction, so it applies completely or not at all.
-- Like the migration, it does NOT enable RLS: that stays the DBA step in prisma/rls/enable.sql.
--
-- ORDER.
--   1. prisma migrate deploy            (creates the new tables)
--   2. this file, either of:
--        npx prisma db execute --schema apps/api/prisma/schema.prisma --file apps/api/prisma/upgrades/rls_policies_153_to_182.sql
--        psql "$DIRECT_DATABASE_URL" -v ON_ERROR_STOP=1 -f apps/api/prisma/upgrades/rls_policies_153_to_182.sql
--   3. prisma/rls/enable.sql            (only if RLS is, or is being, enabled; follow its pre-flight checklist)
--      Never run step 3 before step 2: a table with RLS forced and no policy returns zero rows.
--      Full procedure: docs/PART11_ROW_LEVEL_SECURITY.md
--
-- CHECK AFTERWARDS (expects 182):
--   SELECT count(*) FROM pg_policies WHERE policyname = 'tenant_isolation';

BEGIN;

-- Idempotent; identical to the definition in the migration.
CREATE OR REPLACE FUNCTION wlct_current_tenant_id() RETURNS uuid
LANGUAGE sql STABLE
AS $$ SELECT nullif(current_setting('app.tenant_id', true), '')::uuid $$;

-- BillingCustomer
DROP POLICY IF EXISTS tenant_isolation ON "billing_customers";
CREATE POLICY tenant_isolation ON "billing_customers"
    AS PERMISSIVE
    FOR ALL
    TO PUBLIC
    USING (tenant_id = wlct_current_tenant_id())
    WITH CHECK (tenant_id = wlct_current_tenant_id());

-- BillingLedgerEntry
DROP POLICY IF EXISTS tenant_isolation ON "billing_ledger_entries";
CREATE POLICY tenant_isolation ON "billing_ledger_entries"
    AS PERMISSIVE
    FOR ALL
    TO PUBLIC
    USING (tenant_id = wlct_current_tenant_id())
    WITH CHECK (tenant_id = wlct_current_tenant_id());

-- ComplianceReportCertification
DROP POLICY IF EXISTS tenant_isolation ON "compliance_report_certifications";
CREATE POLICY tenant_isolation ON "compliance_report_certifications"
    AS PERMISSIVE
    FOR ALL
    TO PUBLIC
    USING (tenant_id = wlct_current_tenant_id())
    WITH CHECK (tenant_id = wlct_current_tenant_id());

-- ComplianceReportDelivery
DROP POLICY IF EXISTS tenant_isolation ON "compliance_report_deliveries";
CREATE POLICY tenant_isolation ON "compliance_report_deliveries"
    AS PERMISSIVE
    FOR ALL
    TO PUBLIC
    USING (tenant_id = wlct_current_tenant_id())
    WITH CHECK (tenant_id = wlct_current_tenant_id());

-- ComplianceReportValidation
DROP POLICY IF EXISTS tenant_isolation ON "compliance_report_validations";
CREATE POLICY tenant_isolation ON "compliance_report_validations"
    AS PERMISSIVE
    FOR ALL
    TO PUBLIC
    USING (tenant_id = wlct_current_tenant_id())
    WITH CHECK (tenant_id = wlct_current_tenant_id());

-- ComplianceReport
DROP POLICY IF EXISTS tenant_isolation ON "compliance_reports";
CREATE POLICY tenant_isolation ON "compliance_reports"
    AS PERMISSIVE
    FOR ALL
    TO PUBLIC
    USING (tenant_id = wlct_current_tenant_id())
    WITH CHECK (tenant_id = wlct_current_tenant_id());

-- ConsentRecord
DROP POLICY IF EXISTS tenant_isolation ON "consent_records";
CREATE POLICY tenant_isolation ON "consent_records"
    AS PERMISSIVE
    FOR ALL
    TO PUBLIC
    USING (tenant_id = wlct_current_tenant_id())
    WITH CHECK (tenant_id = wlct_current_tenant_id());

-- DeveloperAccessToken
DROP POLICY IF EXISTS tenant_isolation ON "developer_access_tokens";
CREATE POLICY tenant_isolation ON "developer_access_tokens"
    AS PERMISSIVE
    FOR ALL
    TO PUBLIC
    USING (tenant_id = wlct_current_tenant_id())
    WITH CHECK (tenant_id = wlct_current_tenant_id());

-- DeveloperApplication
DROP POLICY IF EXISTS tenant_isolation ON "developer_applications";
CREATE POLICY tenant_isolation ON "developer_applications"
    AS PERMISSIVE
    FOR ALL
    TO PUBLIC
    USING (tenant_id = wlct_current_tenant_id())
    WITH CHECK (tenant_id = wlct_current_tenant_id());

-- DeveloperAudit
DROP POLICY IF EXISTS tenant_isolation ON "developer_audit";
CREATE POLICY tenant_isolation ON "developer_audit"
    AS PERMISSIVE
    FOR ALL
    TO PUBLIC
    USING (tenant_id = wlct_current_tenant_id())
    WITH CHECK (tenant_id = wlct_current_tenant_id());

-- DeveloperCredential
DROP POLICY IF EXISTS tenant_isolation ON "developer_credentials";
CREATE POLICY tenant_isolation ON "developer_credentials"
    AS PERMISSIVE
    FOR ALL
    TO PUBLIC
    USING (tenant_id = wlct_current_tenant_id())
    WITH CHECK (tenant_id = wlct_current_tenant_id());

-- DeveloperEventSubscription
DROP POLICY IF EXISTS tenant_isolation ON "developer_event_subscriptions";
CREATE POLICY tenant_isolation ON "developer_event_subscriptions"
    AS PERMISSIVE
    FOR ALL
    TO PUBLIC
    USING (tenant_id = wlct_current_tenant_id())
    WITH CHECK (tenant_id = wlct_current_tenant_id());

-- DeveloperOAuthGrant
DROP POLICY IF EXISTS tenant_isolation ON "developer_oauth_grants";
CREATE POLICY tenant_isolation ON "developer_oauth_grants"
    AS PERMISSIVE
    FOR ALL
    TO PUBLIC
    USING (tenant_id = wlct_current_tenant_id())
    WITH CHECK (tenant_id = wlct_current_tenant_id());

-- DeveloperWebhookDelivery
DROP POLICY IF EXISTS tenant_isolation ON "developer_webhook_deliveries";
CREATE POLICY tenant_isolation ON "developer_webhook_deliveries"
    AS PERMISSIVE
    FOR ALL
    TO PUBLIC
    USING (tenant_id = wlct_current_tenant_id())
    WITH CHECK (tenant_id = wlct_current_tenant_id());

-- DeveloperWebhookSubscription
DROP POLICY IF EXISTS tenant_isolation ON "developer_webhook_subscriptions";
CREATE POLICY tenant_isolation ON "developer_webhook_subscriptions"
    AS PERMISSIVE
    FOR ALL
    TO PUBLIC
    USING (tenant_id = wlct_current_tenant_id())
    WITH CHECK (tenant_id = wlct_current_tenant_id());

-- EvidencePackage
DROP POLICY IF EXISTS tenant_isolation ON "evidence_packages";
CREATE POLICY tenant_isolation ON "evidence_packages"
    AS PERMISSIVE
    FOR ALL
    TO PUBLIC
    USING (tenant_id = wlct_current_tenant_id())
    WITH CHECK (tenant_id = wlct_current_tenant_id());

-- FeeAuditLog
DROP POLICY IF EXISTS tenant_isolation ON "fee_audit_logs";
CREATE POLICY tenant_isolation ON "fee_audit_logs"
    AS PERMISSIVE
    FOR ALL
    TO PUBLIC
    USING (tenant_id = wlct_current_tenant_id())
    WITH CHECK (tenant_id = wlct_current_tenant_id());

-- FeeSettlementItem
DROP POLICY IF EXISTS tenant_isolation ON "fee_settlement_items";
CREATE POLICY tenant_isolation ON "fee_settlement_items"
    AS PERMISSIVE
    FOR ALL
    TO PUBLIC
    USING (tenant_id = wlct_current_tenant_id())
    WITH CHECK (tenant_id = wlct_current_tenant_id());

-- FinanceAuditLog
DROP POLICY IF EXISTS tenant_isolation ON "finance_audit_logs";
CREATE POLICY tenant_isolation ON "finance_audit_logs"
    AS PERMISSIVE
    FOR ALL
    TO PUBLIC
    USING (tenant_id = wlct_current_tenant_id())
    WITH CHECK (tenant_id = wlct_current_tenant_id());

-- GovernanceAction
DROP POLICY IF EXISTS tenant_isolation ON "governance_actions";
CREATE POLICY tenant_isolation ON "governance_actions"
    AS PERMISSIVE
    FOR ALL
    TO PUBLIC
    USING (tenant_id = wlct_current_tenant_id())
    WITH CHECK (tenant_id = wlct_current_tenant_id());

-- GovernanceAudit
DROP POLICY IF EXISTS tenant_isolation ON "governance_audits";
CREATE POLICY tenant_isolation ON "governance_audits"
    AS PERMISSIVE
    FOR ALL
    TO PUBLIC
    USING (tenant_id = wlct_current_tenant_id())
    WITH CHECK (tenant_id = wlct_current_tenant_id());

-- GovernanceDataClassification
DROP POLICY IF EXISTS tenant_isolation ON "governance_data_classifications";
CREATE POLICY tenant_isolation ON "governance_data_classifications"
    AS PERMISSIVE
    FOR ALL
    TO PUBLIC
    USING (tenant_id = wlct_current_tenant_id())
    WITH CHECK (tenant_id = wlct_current_tenant_id());

-- GovernanceDataInventory
DROP POLICY IF EXISTS tenant_isolation ON "governance_data_inventory";
CREATE POLICY tenant_isolation ON "governance_data_inventory"
    AS PERMISSIVE
    FOR ALL
    TO PUBLIC
    USING (tenant_id = wlct_current_tenant_id())
    WITH CHECK (tenant_id = wlct_current_tenant_id());

-- GovernanceReconciliation
DROP POLICY IF EXISTS tenant_isolation ON "governance_reconciliations";
CREATE POLICY tenant_isolation ON "governance_reconciliations"
    AS PERMISSIVE
    FOR ALL
    TO PUBLIC
    USING (tenant_id = wlct_current_tenant_id())
    WITH CHECK (tenant_id = wlct_current_tenant_id());

-- PrivacyExport
DROP POLICY IF EXISTS tenant_isolation ON "privacy_exports";
CREATE POLICY tenant_isolation ON "privacy_exports"
    AS PERMISSIVE
    FOR ALL
    TO PUBLIC
    USING (tenant_id = wlct_current_tenant_id())
    WITH CHECK (tenant_id = wlct_current_tenant_id());

-- PrivacyRequest
DROP POLICY IF EXISTS tenant_isolation ON "privacy_requests";
CREATE POLICY tenant_isolation ON "privacy_requests"
    AS PERMISSIVE
    FOR ALL
    TO PUBLIC
    USING (tenant_id = wlct_current_tenant_id())
    WITH CHECK (tenant_id = wlct_current_tenant_id());

-- RetentionCandidate
DROP POLICY IF EXISTS tenant_isolation ON "retention_candidates";
CREATE POLICY tenant_isolation ON "retention_candidates"
    AS PERMISSIVE
    FOR ALL
    TO PUBLIC
    USING (tenant_id = wlct_current_tenant_id())
    WITH CHECK (tenant_id = wlct_current_tenant_id());

-- SaasAuditLog
DROP POLICY IF EXISTS tenant_isolation ON "saas_audit_logs";
CREATE POLICY tenant_isolation ON "saas_audit_logs"
    AS PERMISSIVE
    FOR ALL
    TO PUBLIC
    USING (tenant_id = wlct_current_tenant_id())
    WITH CHECK (tenant_id = wlct_current_tenant_id());

-- UsageBucket
DROP POLICY IF EXISTS tenant_isolation ON "usage_buckets";
CREATE POLICY tenant_isolation ON "usage_buckets"
    AS PERMISSIVE
    FOR ALL
    TO PUBLIC
    USING (tenant_id = wlct_current_tenant_id())
    WITH CHECK (tenant_id = wlct_current_tenant_id());

COMMIT;
```

FILE: apps/api/prisma/upgrades/rls_policies_182_to_186.sql

```sql
-- RLS policy upgrade for databases migrated BEFORE the Part 11 SSO tables were added.
--
-- WHO NEEDS THIS. `prisma migrate deploy` never re-runs a migration that is already recorded in
-- _prisma_migrations. 20260923090000_part11_row_level_security is regenerated by
-- scripts/gen_part11_rls.py whenever tenant tables are added. A database that applied the previous
-- version of it (182 policies; see rls_policies_153_to_182.sql for older databases) gets the four
-- SSO tables from 20260923089000_sso_authorization_code_flow but NOT their tenant_isolation
-- policies. Fresh databases do not need this file: the current migration creates all 186 policies.
--
-- WHAT IT DOES. Creates the tenant_isolation policy on the 4 tenant tables added by Part 11:
-- sso_assertion_replays, sso_audit_events, sso_auth_transactions, sso_identities.
-- Every CREATE POLICY below is copied byte-for-byte from the generated migration; nothing else
-- is changed. Each is preceded by DROP POLICY IF EXISTS, so the file is safe to run more than
-- once, and the whole file is one transaction, so it applies completely or not at all.
-- Like the migration, it does NOT enable RLS: that stays the DBA step in prisma/rls/enable.sql.
--
-- ORDER.
--   1. prisma migrate deploy            (creates the new tables)
--   2. rls_policies_153_to_182.sql      (only if the database predates the 182-policy version)
--   3. this file, either of:
--        npx prisma db execute --schema apps/api/prisma/schema.prisma --file apps/api/prisma/upgrades/rls_policies_182_to_186.sql
--        psql "$DIRECT_DATABASE_URL" -v ON_ERROR_STOP=1 -f apps/api/prisma/upgrades/rls_policies_182_to_186.sql
--   4. prisma/rls/enable.sql            (only if RLS is, or is being, enabled; follow its pre-flight checklist)
--      Never run step 4 before step 3: a table with RLS forced and no policy returns zero rows.
--      Full procedure: docs/PART11_ROW_LEVEL_SECURITY.md
--
-- CHECK AFTERWARDS (expects 186):
--   SELECT count(*) FROM pg_policies WHERE policyname = 'tenant_isolation';

BEGIN;

-- Idempotent; identical to the definition in the migration.
CREATE OR REPLACE FUNCTION wlct_current_tenant_id() RETURNS uuid
LANGUAGE sql STABLE
AS $$ SELECT nullif(current_setting('app.tenant_id', true), '')::uuid $$;

-- SsoAssertionReplay
DROP POLICY IF EXISTS tenant_isolation ON "sso_assertion_replays";
CREATE POLICY tenant_isolation ON "sso_assertion_replays"
    AS PERMISSIVE
    FOR ALL
    TO PUBLIC
    USING (tenant_id = wlct_current_tenant_id())
    WITH CHECK (tenant_id = wlct_current_tenant_id());

-- SsoAuditEvent
DROP POLICY IF EXISTS tenant_isolation ON "sso_audit_events";
CREATE POLICY tenant_isolation ON "sso_audit_events"
    AS PERMISSIVE
    FOR ALL
    TO PUBLIC
    USING (tenant_id = wlct_current_tenant_id())
    WITH CHECK (tenant_id = wlct_current_tenant_id());

-- SsoAuthTransaction
DROP POLICY IF EXISTS tenant_isolation ON "sso_auth_transactions";
CREATE POLICY tenant_isolation ON "sso_auth_transactions"
    AS PERMISSIVE
    FOR ALL
    TO PUBLIC
    USING (tenant_id = wlct_current_tenant_id())
    WITH CHECK (tenant_id = wlct_current_tenant_id());

-- SsoIdentity
DROP POLICY IF EXISTS tenant_isolation ON "sso_identities";
CREATE POLICY tenant_isolation ON "sso_identities"
    AS PERMISSIVE
    FOR ALL
    TO PUBLIC
    USING (tenant_id = wlct_current_tenant_id())
    WITH CHECK (tenant_id = wlct_current_tenant_id());

COMMIT;
```

