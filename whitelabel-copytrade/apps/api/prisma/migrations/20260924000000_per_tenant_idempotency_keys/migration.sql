-- Round 7: idempotency keys are unique PER TENANT, not platform-wide.
--
-- Before this migration every tenant-owned table carried a global
-- UNIQUE(idempotency_key). Two consequences:
--   1. a client-supplied key reused by another tenant collided with that
--      tenant's row (P2002 for the second tenant - a cross-tenant denial);
--   2. the application looked rows up by the key alone, so a lookup could
--      return another tenant's row as the "idempotent replay".
-- The application lookups now always filter by tenant_id as well, and the
-- constraint below matches them: UNIQUE(tenant_id, idempotency_key).
--
-- Safety on existing data: the composite constraint is strictly weaker than
-- the global one it replaces (any set of rows unique on idempotency_key is
-- also unique on (tenant_id, idempotency_key)), so CREATE UNIQUE INDEX cannot
-- fail on data that satisfied the old index. The file contains no explicit
-- BEGIN/COMMIT: Prisma sends it as one multi-statement script, which
-- PostgreSQL executes as a single implicit transaction (the same property the
-- part8/part9 migrations rely on), so the DROPs never commit without their
-- CREATEs.
--
-- Deliberately NOT changed (the global unique stays): tables whose tenant_id
-- is nullable or absent - operational_* (platform-level rows have no tenant)
-- and partner_* (partner programme rows span tenants). A NULL tenant_id
-- would make a composite unique non-enforcing for those rows.
--
-- Generated with `prisma migrate diff --from-schema-datamodel <schema@cebba92>
-- --to-schema-datamodel prisma/schema.prisma --script`; reviewed: 68 DROP INDEX
-- + 68 CREATE UNIQUE INDEX, nothing else. Historical migrations are untouched.

-- DropIndex
DROP INDEX "billing_notification_jobs_idempotency_key_key";

-- DropIndex
DROP INDEX "invoices_idempotency_key_key";

-- DropIndex
DROP INDEX "payments_idempotency_key_key";

-- DropIndex
DROP INDEX "refunds_idempotency_key_key";

-- DropIndex
DROP INDEX "fee_accruals_idempotency_key_key";

-- DropIndex
DROP INDEX "fee_settlements_idempotency_key_key";

-- DropIndex
DROP INDEX "payouts_idempotency_key_key";

-- DropIndex
DROP INDEX "usage_events_idempotency_key_key";

-- DropIndex
DROP INDEX "usage_alert_events_idempotency_key_key";

-- DropIndex
DROP INDEX "overage_records_idempotency_key_key";

-- DropIndex
DROP INDEX "compliance_screening_requests_idempotency_key_key";

-- DropIndex
DROP INDEX "compliance_cases_idempotency_key_key";

-- DropIndex
DROP INDEX "risk_score_records_idempotency_key_key";

-- DropIndex
DROP INDEX "transaction_monitoring_signals_idempotency_key_key";

-- DropIndex
DROP INDEX "enterprise_api_keys_idempotency_key_key";

-- DropIndex
DROP INDEX "trader_strategies_idempotency_key_key";

-- DropIndex
DROP INDEX "copy_subscriptions_idempotency_key_key";

-- DropIndex
DROP INDEX "copy_executions_idempotency_key_key";

-- DropIndex
DROP INDEX "research_datasets_idempotency_key_key";

-- DropIndex
DROP INDEX "research_strategy_versions_idempotency_key_key";

-- DropIndex
DROP INDEX "research_backtest_runs_idempotency_key_key";

-- DropIndex
DROP INDEX "research_paper_sessions_idempotency_key_key";

-- DropIndex
DROP INDEX "research_signals_idempotency_key_key";

-- DropIndex
DROP INDEX "research_promotion_requests_idempotency_key_key";

-- DropIndex
DROP INDEX "portfolio_accounting_events_idempotency_key_key";

-- DropIndex
DROP INDEX "portfolio_cash_ledger_entries_idempotency_key_key";

-- DropIndex
DROP INDEX "portfolio_position_lots_idempotency_key_key";

-- DropIndex
DROP INDEX "portfolio_valuations_idempotency_key_key";

-- DropIndex
DROP INDEX "portfolio_snapshots_idempotency_key_key";

-- DropIndex
DROP INDEX "portfolio_accounting_periods_idempotency_key_key";

-- DropIndex
DROP INDEX "portfolio_accounting_closes_idempotency_key_key";

-- DropIndex
DROP INDEX "portfolio_performance_records_idempotency_key_key";

-- DropIndex
DROP INDEX "portfolio_attribution_records_idempotency_key_key";

-- DropIndex
DROP INDEX "portfolio_statements_idempotency_key_key";

-- DropIndex
DROP INDEX "portfolio_accounting_reconciliations_idempotency_key_key";

-- DropIndex
DROP INDEX "portfolio_accounting_adjustments_idempotency_key_key";

-- DropIndex
DROP INDEX "client_profiles_idempotency_key_key";

-- DropIndex
DROP INDEX "client_onboardings_idempotency_key_key";

-- DropIndex
DROP INDEX "client_onboarding_steps_idempotency_key_key";

-- DropIndex
DROP INDEX "institutional_accounts_idempotency_key_key";

-- DropIndex
DROP INDEX "account_ownerships_idempotency_key_key";

-- DropIndex
DROP INDEX "account_relationships_idempotency_key_key";

-- DropIndex
DROP INDEX "account_restrictions_idempotency_key_key";

-- DropIndex
DROP INDEX "client_reviews_idempotency_key_key";

-- DropIndex
DROP INDEX "funding_requests_idempotency_key_key";

-- DropIndex
DROP INDEX "withdrawal_requests_idempotency_key_key";

-- DropIndex
DROP INDEX "funding_approvals_idempotency_key_key";

-- DropIndex
DROP INDEX "funding_reconciliations_idempotency_key_key";

-- DropIndex
DROP INDEX "custody_wallets_idempotency_key_key";

-- DropIndex
DROP INDEX "custody_wallet_addresses_idempotency_key_key";

-- DropIndex
DROP INDEX "custody_deposits_idempotency_key_key";

-- DropIndex
DROP INDEX "custody_withdrawals_idempotency_key_key";

-- DropIndex
DROP INDEX "custody_transactions_idempotency_key_key";

-- DropIndex
DROP INDEX "custody_internal_transfers_idempotency_key_key";

-- DropIndex
DROP INDEX "custody_reserves_idempotency_key_key";

-- DropIndex
DROP INDEX "custody_sweeps_idempotency_key_key";

-- DropIndex
DROP INDEX "custody_reconciliations_idempotency_key_key";

-- DropIndex
DROP INDEX "mobile_applications_idempotency_key_key";

-- DropIndex
DROP INDEX "mobile_builds_idempotency_key_key";

-- DropIndex
DROP INDEX "mobile_releases_idempotency_key_key";

-- DropIndex
DROP INDEX "mobile_release_rollouts_idempotency_key_key";

-- DropIndex
DROP INDEX "mobile_crash_events_idempotency_key_key";

-- DropIndex
DROP INDEX "developer_applications_idempotency_key_key";

-- DropIndex
DROP INDEX "developer_oauth_grants_idempotency_key_key";

-- DropIndex
DROP INDEX "developer_webhook_subscriptions_idempotency_key_key";

-- DropIndex
DROP INDEX "developer_webhook_deliveries_idempotency_key_key";

-- DropIndex
DROP INDEX "billing_ledger_entries_idempotency_key_key";

-- DropIndex
DROP INDEX "privacy_requests_idempotency_key_key";

-- CreateIndex
CREATE UNIQUE INDEX "billing_notification_jobs_tenant_id_idempotency_key_key" ON "billing_notification_jobs"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_tenant_id_idempotency_key_key" ON "invoices"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "payments_tenant_id_idempotency_key_key" ON "payments"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "refunds_tenant_id_idempotency_key_key" ON "refunds"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "fee_accruals_tenant_id_idempotency_key_key" ON "fee_accruals"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "fee_settlements_tenant_id_idempotency_key_key" ON "fee_settlements"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "payouts_tenant_id_idempotency_key_key" ON "payouts"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "usage_events_tenant_id_idempotency_key_key" ON "usage_events"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "usage_alert_events_tenant_id_idempotency_key_key" ON "usage_alert_events"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "overage_records_tenant_id_idempotency_key_key" ON "overage_records"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "compliance_screening_requests_tenant_id_idempotency_key_key" ON "compliance_screening_requests"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "compliance_cases_tenant_id_idempotency_key_key" ON "compliance_cases"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "risk_score_records_tenant_id_idempotency_key_key" ON "risk_score_records"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "transaction_monitoring_signals_tenant_id_idempotency_key_key" ON "transaction_monitoring_signals"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "enterprise_api_keys_tenant_id_idempotency_key_key" ON "enterprise_api_keys"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "trader_strategies_tenant_id_idempotency_key_key" ON "trader_strategies"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "copy_subscriptions_tenant_id_idempotency_key_key" ON "copy_subscriptions"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "copy_executions_tenant_id_idempotency_key_key" ON "copy_executions"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "research_datasets_tenant_id_idempotency_key_key" ON "research_datasets"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "research_strategy_versions_tenant_id_idempotency_key_key" ON "research_strategy_versions"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "research_backtest_runs_tenant_id_idempotency_key_key" ON "research_backtest_runs"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "research_paper_sessions_tenant_id_idempotency_key_key" ON "research_paper_sessions"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "research_signals_tenant_id_idempotency_key_key" ON "research_signals"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "research_promotion_requests_tenant_id_idempotency_key_key" ON "research_promotion_requests"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "portfolio_accounting_events_tenant_id_idempotency_key_key" ON "portfolio_accounting_events"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "portfolio_cash_ledger_entries_tenant_id_idempotency_key_key" ON "portfolio_cash_ledger_entries"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "portfolio_position_lots_tenant_id_idempotency_key_key" ON "portfolio_position_lots"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "portfolio_valuations_tenant_id_idempotency_key_key" ON "portfolio_valuations"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "portfolio_snapshots_tenant_id_idempotency_key_key" ON "portfolio_snapshots"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "portfolio_accounting_periods_tenant_id_idempotency_key_key" ON "portfolio_accounting_periods"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "portfolio_accounting_closes_tenant_id_idempotency_key_key" ON "portfolio_accounting_closes"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "portfolio_performance_records_tenant_id_idempotency_key_key" ON "portfolio_performance_records"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "portfolio_attribution_records_tenant_id_idempotency_key_key" ON "portfolio_attribution_records"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "portfolio_statements_tenant_id_idempotency_key_key" ON "portfolio_statements"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "portfolio_accounting_reconciliations_tenant_id_idempotency__key" ON "portfolio_accounting_reconciliations"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "portfolio_accounting_adjustments_tenant_id_idempotency_key_key" ON "portfolio_accounting_adjustments"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "client_profiles_tenant_id_idempotency_key_key" ON "client_profiles"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "client_onboardings_tenant_id_idempotency_key_key" ON "client_onboardings"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "client_onboarding_steps_tenant_id_idempotency_key_key" ON "client_onboarding_steps"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "institutional_accounts_tenant_id_idempotency_key_key" ON "institutional_accounts"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "account_ownerships_tenant_id_idempotency_key_key" ON "account_ownerships"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "account_relationships_tenant_id_idempotency_key_key" ON "account_relationships"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "account_restrictions_tenant_id_idempotency_key_key" ON "account_restrictions"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "client_reviews_tenant_id_idempotency_key_key" ON "client_reviews"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "funding_requests_tenant_id_idempotency_key_key" ON "funding_requests"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "withdrawal_requests_tenant_id_idempotency_key_key" ON "withdrawal_requests"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "funding_approvals_tenant_id_idempotency_key_key" ON "funding_approvals"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "funding_reconciliations_tenant_id_idempotency_key_key" ON "funding_reconciliations"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "custody_wallets_tenant_id_idempotency_key_key" ON "custody_wallets"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "custody_wallet_addresses_tenant_id_idempotency_key_key" ON "custody_wallet_addresses"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "custody_deposits_tenant_id_idempotency_key_key" ON "custody_deposits"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "custody_withdrawals_tenant_id_idempotency_key_key" ON "custody_withdrawals"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "custody_transactions_tenant_id_idempotency_key_key" ON "custody_transactions"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "custody_internal_transfers_tenant_id_idempotency_key_key" ON "custody_internal_transfers"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "custody_reserves_tenant_id_idempotency_key_key" ON "custody_reserves"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "custody_sweeps_tenant_id_idempotency_key_key" ON "custody_sweeps"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "custody_reconciliations_tenant_id_idempotency_key_key" ON "custody_reconciliations"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "mobile_applications_tenant_id_idempotency_key_key" ON "mobile_applications"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "mobile_builds_tenant_id_idempotency_key_key" ON "mobile_builds"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "mobile_releases_tenant_id_idempotency_key_key" ON "mobile_releases"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "mobile_release_rollouts_tenant_id_idempotency_key_key" ON "mobile_release_rollouts"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "mobile_crash_events_tenant_id_idempotency_key_key" ON "mobile_crash_events"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "developer_applications_tenant_id_idempotency_key_key" ON "developer_applications"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "developer_oauth_grants_tenant_id_idempotency_key_key" ON "developer_oauth_grants"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "developer_webhook_subscriptions_tenant_id_idempotency_key_key" ON "developer_webhook_subscriptions"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "developer_webhook_deliveries_tenant_id_idempotency_key_key" ON "developer_webhook_deliveries"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "billing_ledger_entries_tenant_id_idempotency_key_key" ON "billing_ledger_entries"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "privacy_requests_tenant_id_idempotency_key_key" ON "privacy_requests"("tenant_id", "idempotency_key");

