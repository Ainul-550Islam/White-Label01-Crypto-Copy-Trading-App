#!/usr/bin/env node
// # Responsibility: evaluates repository-backed implementation, workflow, and assertion evidence for GAP-51 through GAP-100; it never trusts filenames or hard-coded statuses.
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FORBIDDEN_PLACEHOLDERS = [
  ['Rest of the code', 'here'].join(' '),
  ['existing code', 'omitted'].join(' '),
  ['same as', 'above'].join(' '),
  ['TODO-only', 'implementation'].join(' '),
];

function criterion(key, evidence, mode) {
  return { key, evidence, mode: mode || (evidence.length > 1 ? 'all' : 'any') };
}
function probe(file, patterns) {
  return { file, patterns };
}
function source(file, ...patterns) {
  return probe(file, patterns);
}
function test(file, subjectPattern) {
  return probe(file, ['\\b(?:test|it)\\s*\\(', '\\bexpect\\s*\\(', subjectPattern]);
}

// Each record is a declarative evidence rubric, not a status. The scanner evaluates
// implementation behavior, a customer/operator/API surface, and test assertions from
// file contents. Commercial weights are disclosed again in the final report.
const BASELINE_ACCEPTED_GAPS = 50;
const PRODUCTION_CRITICAL_GAP_IDS = new Set([
  'GAP-55', 'GAP-57', 'GAP-60', 'GAP-61', 'GAP-62', 'GAP-63', 'GAP-64', 'GAP-65',
  'GAP-66', 'GAP-67', 'GAP-68', 'GAP-69', 'GAP-70', 'GAP-71', 'GAP-72', 'GAP-73',
  'GAP-74', 'GAP-75', 'GAP-76', 'GAP-77', 'GAP-78', 'GAP-79', 'GAP-80', 'GAP-81',
  'GAP-82', 'GAP-83', 'GAP-95', 'GAP-96', 'GAP-97', 'GAP-98', 'GAP-100',
]);

const GAP_CHECKS = [
  {
    id: 'GAP-51', title: 'Trader profile, follower/AUM/activity detail', commercialWeight: 5,
    criteria: [
      criterion('tenant-profile-read', [source('apps/api/src/modules/copy-trading/trader-profile.service.ts', 'class\\s+TraderProfileService', 'getProfile')]),
      criterion('customer-profile-surface', [source('apps/web/src/features/trading/trader-detail-page.tsx', 'TraderDetailPage', 'followerCount')]),
      criterion('verified-aum-or-activity-provenance', [source('apps/api/src/modules/copy-trading/trader-profile.service.ts', 'aum|assetsUnderManagement|asset[s]? under management', 'source|provenance|asOf')]),
      criterion('profile-regression-assertions', [test('apps/web/src/tests/trader-detail-page.test.tsx', 'followerCount|AUM|activity')]),
    ],
  },
  {
    id: 'GAP-52', title: 'Lead-trader application and qualification workflow', commercialWeight: 5,
    criteria: [
      criterion('existing-trader-profile-and-verification-foundation', [source('apps/api/src/modules/copy-trading/trader-profile.service.ts', 'class\\s+TraderProfileService', 'verificationState|TraderVerificationState')]),
      criterion('application-domain-state-machine', [source('apps/api/src/modules/copy-trading/lead-trader-application.service.ts', 'class\\s+LeadTraderApplicationService', 'apply|transition|qualification')]),
      criterion('applicant-and-review-queue-surfaces', [source('apps/web/src/features/trading/lead-trader-application-page.tsx', 'application|qualification'), source('apps/admin-web/src/features/trading/lead-trader-application-queue.tsx', 'review|application')]),
      criterion('application-authorization-and-tenant-scope', [source('apps/api/src/modules/copy-trading/lead-trader-application.service.ts', 'tenantId', 'assertTenant|tenantId.*userId|userId.*tenantId')]),
      criterion('application-regression-assertions', [test('apps/api/src/modules/copy-trading/lead-trader-application.spec.ts', 'application|qualification|transition')]),
    ],
  },
  {
    id: 'GAP-53', title: 'Lead-trader profit-share and fee configuration', commercialWeight: 5,
    criteria: [
      criterion('existing-platform-fee-policy-and-calculator', [source('apps/api/src/modules/billing/fees/fee-policy.service.ts', 'FeePolicyService', 'effective|fee'), source('apps/api/src/modules/billing/fees/fee-calculator.service.ts', 'FeeCalculatorService|calculate', 'fee|basisPoints')]),
      criterion('effective-fee-policy-engine', [source('apps/api/src/modules/copy-trading/leader-fee.service.ts', 'class\\s+LeaderFeeService', 'effective|basis|fee')]),
      criterion('customer-fee-configuration-surface', [source('apps/web/src/features/trading/leader-fee-settings-page.tsx', 'fee|commission|basis')]),
      criterion('exact-money-arithmetic', [source('apps/api/src/modules/copy-trading/leader-fee.service.ts', 'BigInt|Decimal|parseDecimalString')]),
      criterion('fee-policy-regression-assertions', [test('apps/api/src/modules/copy-trading/leader-fee.spec.ts', 'fee|commission|round')]),
    ],
  },
  {
    id: 'GAP-54', title: 'Leaderboard timeframe and ranking methodology', commercialWeight: 4,
    criteria: [
      criterion('ranking-methodology', [source('apps/api/src/modules/copy-trading/trader-ranking.service.ts', 'class\\s+TraderRankingService', 'weight|score|rank')]),
      criterion('explicit-timeframe-control', [source('apps/web/src/features/trading/trader-ranking-controls.tsx', 'timeframe|period|window'), source('apps/web/src/features/trading/traders-page.tsx', 'timeframe|period|window')]),
      criterion('ranking-response-explains-method', [source('apps/api/src/modules/copy-trading/trader-ranking.service.ts', 'weighting|methodology')]),
      criterion('ranking-regression-assertions', [test('apps/api/src/modules/copy-trading/trader-ranking.spec.ts', 'rank|score|weight|timeframe'), test('apps/web/src/tests/trader-ranking-controls.test.tsx', 'timeframe|rank|filter')]),
    ],
  },
  {
    id: 'GAP-55', title: 'Verified performance calculation methodology', commercialWeight: 5,
    criteria: [
      criterion('deterministic-exact-calculation', [source('apps/api/src/modules/copy-trading/performance-calculation.service.ts', 'TIME_WEIGHTED_RETURN', 'flowBoundary', 'parseDecimalString')]),
      criterion('unavailable-on-incomplete-input', [source('apps/api/src/modules/copy-trading/performance-calculation.service.ts', 'dataCompleteness', 'UNAVAILABLE', 'stale|incomplete|boundary')]),
      criterion('customer-methodology-disclosure', [source('apps/web/src/features/trading/performance-methodology.tsx', 'methodology|calculationVersion|dataCompleteness')]),
      criterion('canonical-calculation-integration', [source('apps/api/src/modules/copy-trading/trader-performance.service.ts', 'PerformanceCalculationService|flowBoundary|TIME_WEIGHTED_RETURN')]),
      criterion('calculation-regression-assertions', [test('apps/api/src/modules/copy-trading/performance-calculation.spec.ts', 'incomplete|duplicate|return|drawdown')]),
    ],
  },
  {
    id: 'GAP-56', title: 'Verified benchmark and market comparison overlay', commercialWeight: 4,
    criteria: [
      criterion('tenant-scoped-persisted-benchmark-service', [source('apps/api/src/modules/copy-trading/performance-benchmark.service.ts', 'getTraderBenchmarkSeries', 'tenantId', 'portfolioPerformanceRecord')]),
      criterion('benchmark-provenance-and-no-synthesis', [source('apps/api/src/modules/copy-trading/performance-benchmark.service.ts', 'sourceReferences', 'UNAVAILABLE', 'benchmarkKey')]),
      criterion('authorized-controller-and-chart', [source('apps/api/src/modules/copy-trading/performance-benchmark.controller.ts', 'RequirePermissions', 'authTenantId'), source('apps/web/src/features/trading/performance-benchmark-chart.tsx', 'UNAVAILABLE|PARTIAL|observations')]),
      criterion('benchmark-regression-assertions', [test('apps/api/src/modules/copy-trading/performance-benchmark.spec.ts', 'UNAVAILABLE|COMPLETE|benchmark'), test('apps/web/src/tests/performance-benchmark-chart.test.tsx', 'UNAVAILABLE|benchmark')]),
    ],
  },
  {
    id: 'GAP-57', title: 'Unified trader risk score', commercialWeight: 5,
    criteria: [
      criterion('explainable-fresh-factor-engine', [source('apps/api/src/modules/risk/trader-risk-score.service.ts', 'class\\s+TraderRiskScoreService', 'observedAt', 'weightBps')]),
      criterion('missing-or-stale-is-unavailable', [source('apps/api/src/modules/risk/trader-risk-score.service.ts', 'STALE', 'MISSING', 'UNAVAILABLE')]),
      criterion('customer-risk-score-surface', [source('apps/web/src/features/trading/trader-risk-score.tsx', 'confidence|factor|risk')]),
      criterion('risk-score-regression-assertions', [test('apps/api/src/modules/risk/trader-risk-score.spec.ts', 'STALE|MISSING|score|confidence')]),
      criterion('canonical-data-api-integration', [source('apps/api/src/modules/copy-trading/trader-profile.service.ts', 'TraderRiskScoreService|riskScore|riskFactors')]),
    ],
  },
  {
    id: 'GAP-58', title: 'Trader exposure and asset allocation breakdown', commercialWeight: 4,
    criteria: [
      criterion('measured-exposure-domain', [source('apps/api/src/modules/risk-management/portfolio-exposure.service.ts', 'class\\s+PortfolioExposureService', 'exposure|valuation')]),
      criterion('tenant-authorized-trader-exposure-api', [source('apps/api/src/modules/risk-management/risk.controller.ts', 'exposure|authTenantId')]),
      criterion('customer-trader-exposure-panel', [source('apps/web/src/features/trading/trader-exposure-panel.tsx', 'exposure|allocation|UNAVAILABLE')]),
      criterion('exposure-regression-assertions', [test('apps/web/src/tests/trader-exposure-panel.test.tsx', 'exposure|unknown|unavailable')]),
    ],
  },
  {
    id: 'GAP-59', title: 'Concentration and correlation risk view', commercialWeight: 4,
    criteria: [
      criterion('server-risk-calculations', [source('apps/api/src/modules/risk-management/concentration-risk.service.ts', 'class\\s+ConcentrationRiskService', 'concentration'), source('apps/api/src/modules/risk-management/correlation-risk.service.ts', 'correlation')]),
      criterion('measured-or-stale-risk-evidence', [source('apps/api/src/modules/risk-management/concentration-risk.service.ts', 'stale|source|observedAt|timestamp')]),
      criterion('customer-risk-panel-and-tests', [source('apps/web/src/features/trading/concentration-risk-panel.tsx', 'concentration|correlation'), test('apps/api/src/modules/risk/concentration-risk.spec.ts', 'concentration|correlation')]),
    ],
  },
  {
    id: 'GAP-60', title: 'Preview-only exact-decimal allocation rebalance planner', commercialWeight: 5,
    criteria: [
      criterion('exact-decimal-preview-without-execution', [source('apps/api/src/modules/copy-trading/allocation-rebalance.service.ts', 'parseDecimalString', 'executable:\\s*false', 'no order|no transfer')]),
      criterion('authenticated-preview-route-and-provenance', [source('apps/api/src/modules/copy-trading/allocation-rebalance.controller.ts', 'RequirePermissions', 'authTenantId', 'CLIENT_SUPPLIED_UNVERIFIED')]),
      criterion('customer-preview-ui-and-api-link', [source('apps/web/src/features/trading/allocation-rebalance-page.tsx', 'previewAllocationRebalance|UNAVAILABLE|preview')]),
      criterion('planner-regression-assertions', [test('apps/api/src/modules/copy-trading/allocation-rebalance.spec.ts', 'executable|UNAVAILABLE|10000'), test('apps/web/src/tests/allocation-rebalance-page.test.tsx', 'preview|UNAVAILABLE')]),
      criterion('persisted-portfolio-valuation-input', [source('apps/api/src/modules/copy-trading/allocation-rebalance.controller.ts', 'portfolioPosition|portfolioBalance|allocationRepository')]),
    ],
  },
  {
    id: 'GAP-61', title: 'Copy budget and allocation-cap automation', commercialWeight: 5,
    criteria: [
      criterion('existing-per-subscription-budget-and-policy', [source('apps/api/src/modules/copy-trading/follower-allocation.service.ts', 'allocationAmount|maxAllocation|allocation')]),
      criterion('global-active-copy-budget-engine', [source('apps/api/src/modules/copy-trading/copy-budget.service.ts', 'active|aggregate|budget|reserve')]),
      criterion('customer-budget-surface', [source('apps/web/src/features/trading/copy-budget-settings.tsx', 'budget|allocation')]),
      criterion('budget-enforcement-test', [test('apps/api/src/modules/copy-trading/copy-budget.spec.ts', 'budget|allocation|cap')]),
    ],
  },
  {
    id: 'GAP-62', title: 'Maximum concurrent position and order limits', commercialWeight: 5,
    criteria: [
      criterion('existing-position-risk-gates', [source('apps/api/src/modules/risk-management/position-risk.service.ts', 'position|limit|risk')]),
      criterion('explicit-user-concurrent-position-limit', [source('apps/api/src/modules/risk/position-limit.service.ts', 'maxConcurrent|openPositions|openOrders')]),
      criterion('customer-position-limit-control', [source('apps/web/src/features/trading/position-limit-settings.tsx', 'position|order|limit')]),
      criterion('position-limit-regression-assertions', [test('apps/api/src/modules/risk/position-limit.spec.ts', 'position|limit|concurrent')]),
    ],
  },
  {
    id: 'GAP-63', title: 'Copy-trading symbol allow and deny policies', commercialWeight: 4,
    criteria: [
      criterion('policy-intersection-and-validation', [source('apps/api/src/modules/copy-trading/copy-policy.service.ts', 'allowedSymbols', 'blockedSymbols', 'validateSymbolRules')]),
      criterion('pre-dispatch-symbol-enforcement', [source('apps/api/src/modules/copy-trading/follower-risk.service.ts', 'UNALLOWED_SYMBOL', 'BLOCKED_SYMBOL')]),
      criterion('customer-settings-and-contract-link', [source('apps/web/src/features/trading/copy-settings-page.tsx', 'Allowed Symbols', 'Blocked Symbols', 'updateCopySubscriptionSettings')]),
      criterion('symbol-policy-regression-assertions', [test('apps/api/src/modules/copy-trading/follower-risk.service.spec.ts', 'blockedSymbols|allowedSymbols|UNALLOWED_SYMBOL')]),
    ],
  },
  {
    id: 'GAP-64', title: 'Leverage and margin-mode policy surface', commercialWeight: 5,
    criteria: [
      criterion('server-ceiling-and-venue-capability', [source('apps/api/src/modules/risk/leverage-policy.service.ts', 'class\\s+LeveragePolicyService', 'maximumAllowed', 'venueMaximum')]),
      criterion('leverage-regression-assertions', [test('apps/api/src/modules/risk/leverage-policy.spec.ts', 'venue|ceiling|accountCanTrade')]),
      criterion('customer-leverage-policy-surface', [source('apps/web/src/features/trading/leverage-policy-panel.tsx', 'leverage|margin|maximum')]),
      criterion('service-connected-to-authoritative-risk-api', [source('apps/api/src/modules/risk-management/risk.controller.ts', 'LeveragePolicyService|evaluate\\(')]),
    ],
  },
  {
    id: 'GAP-65', title: 'Liquidation distance and margin health alerts', commercialWeight: 5,
    criteria: [
      criterion('existing-canonical-liquidation-risk', [source('apps/api/src/modules/risk-management/liquidation-risk.service.ts', 'liquidation|margin|risk')]),
      criterion('customer-liquidation-alert-surface', [source('apps/web/src/features/trading/liquidation-risk-alert.tsx', 'liquidation|margin|UNKNOWN')]),
      criterion('notification-dispatch-and-test', [source('apps/api/src/modules/notifications/processors/liquidation-risk-notification.processor.ts', 'liquidation|notification'), test('apps/api/src/modules/risk/liquidation-risk.spec.ts', 'liquidation|margin')]),
    ],
  },
  {
    id: 'GAP-66', title: 'User-configurable slippage tolerance', commercialWeight: 5,
    criteria: [
      criterion('subscription-setting-and-api-contract', [source('apps/web/src/features/trading/copy-settings-page.tsx', 'Slippage Tolerance', 'slippageToleranceBps', 'updateCopySubscriptionSettings')]),
      criterion('exact-adverse-slippage-enforcement', [source('apps/api/src/modules/copy-trading/copy-policy.service.ts', 'evaluateSlippageAndDelay', 'SLIPPAGE_TOLERANCE_EXCEEDED', 'parseDecimalString')]),
      criterion('no-substituted-follower-fill-price', [source('apps/api/src/modules/copy-trading/copy-execution.service.ts', 'executionPrice:\\s*followerIntent\\.price \\|\\| null')]),
      criterion('slippage-regression-assertions', [test('apps/api/src/modules/copy-trading/copy-policy.service.spec.ts', 'SLIPPAGE_TOLERANCE_EXCEEDED|SLIPPAGE_REFERENCE_UNAVAILABLE'), test('apps/web/src/tests/copy-settings-page.test.tsx', 'slippageToleranceBps')]),
    ],
  },
  {
    id: 'GAP-67', title: 'Copy execution retry/failure timeline', commercialWeight: 4,
    criteria: [
      criterion('durable-copy-execution-state', [source('apps/api/src/modules/copy-trading/copy-trading.types.ts', 'CopyExecutionStatus|failureReason|retryCount'), source('apps/api/src/modules/copy-trading/copy-execution.service.ts', 'failureReason|retryCount|status')]),
      criterion('owner-filtered-execution-read-api', [source('apps/api/src/modules/copy-trading/copy-trading.controller.ts', 'executions|authTenantId|subscriptionId')]),
      criterion('customer-timeline-surface', [source('apps/web/src/features/trading/copy-execution-status-timeline.tsx', 'timeline|retry|failure')]),
      criterion('timeline-state-regression-assertions', [test('apps/api/src/modules/copy-trading/copy-execution-status.spec.ts', 'retry|transition|failure')]),
    ],
  },
  {
    id: 'GAP-68', title: 'OMS state machine visualization and recovery action', commercialWeight: 4,
    criteria: [
      criterion('canonical-lifecycle-and-events', [source('apps/api/src/modules/oms/order-lifecycle.service.ts', 'transition|OrderEvent|event')]),
      criterion('operator-timeline-surface', [source('apps/admin-web/src/features/execution/order-state-timeline.tsx', 'timeline|status|event')]),
      criterion('recovery-authorized-through-oms', [source('apps/api/src/modules/oms/order-lifecycle.service.ts', 'permission|authorize|transition')]),
      criterion('lifecycle-regression-assertions', [test('apps/api/src/modules/oms/order-state-machine.spec.ts', 'transition|illegal|recovery')]),
    ],
  },
  {
    id: 'GAP-69', title: 'Exchange user-data stream health', commercialWeight: 4,
    criteria: [
      criterion('persisted-stream-and-health-evidence', [source('apps/api/prisma/schema.prisma', 'model\\s+ExchangeStreamSession'), source('apps/api/src/modules/exchanges/exchange-health.service.ts', 'stream|health|session')]),
      criterion('account-scoped-user-stream-api', [source('apps/api/src/modules/exchanges/exchange-user-stream.controller.ts', 'authTenantId|accountId|health')]),
      criterion('operator-stream-health-surface', [source('apps/admin-web/src/features/execution/exchange-stream-health.tsx', 'stream|health|UNKNOWN')]),
      criterion('stream-lifecycle-regression-assertions', [test('apps/api/src/modules/exchanges/exchange-user-stream.spec.ts', 'stream|health|UNKNOWN')]),
    ],
  },
  {
    id: 'GAP-70', title: 'Clock drift and venue timestamp safety', commercialWeight: 4,
    criteria: [
      criterion('existing-venue-time-evidence', [source('apps/api/src/modules/exchanges/exchange-connectivity.service.ts', 'serverTime|clockDrift|timestamp')]),
      criterion('bounded-clock-offset-service', [source('apps/api/src/modules/exchanges/venue-clock.service.ts', 'offset|drift|maximum|fail')]),
      criterion('execution-engine-monotonic-sync', [source('services/execution-engine/app/exchanges/clock_sync.py', 'monotonic|offset|drift')]),
      criterion('clock-safety-regression-assertions', [test('apps/api/src/modules/exchanges/venue-clock.spec.ts', 'drift|offset|reject')]),
    ],
  },
  {
    id: 'GAP-71', title: 'Exchange rate-limit budget and backpressure', commercialWeight: 5,
    criteria: [
      criterion('atomic-tenant-budget-reservation', [source('apps/api/src/modules/exchanges/exchange-rate-limit.service.ts', 'incrementBy', 'getCacheKey\\(input\\.tenantId')]),
      criterion('routing-denies-unavailable-budget', [source('apps/api/src/modules/exchanges/exchange-routing.service.ts', 'RATE_LIMIT_STATE_UNAVAILABLE', 'rateLimitCheck\\.allowed')]),
      criterion('operator-rate-limit-dashboard', [source('apps/admin-web/src/features/execution/exchange-rate-limit-health.tsx', 'budget|remaining|pressure')]),
      criterion('rate-limit-outage-regression-assertions', [test('apps/api/src/modules/exchanges/exchange-rate-limit.service.spec.ts', 'unavailable|denying|weight')]),
    ],
  },
  {
    id: 'GAP-72', title: 'Venue maintenance and incident status surface', commercialWeight: 4,
    criteria: [
      criterion('existing-maintenance-and-health-domains', [source('apps/api/src/modules/operations/maintenance-mode.service.ts', 'maintenance|status'), source('apps/api/src/modules/exchanges/exchange-health.service.ts', 'health|state')]),
      criterion('normalized-venue-status-api', [source('apps/api/src/modules/exchanges/venue-status.controller.ts', 'venue|status|authTenantId')]),
      criterion('customer-venue-status-banner', [source('apps/web/src/features/trading/venue-status-banner.tsx', 'UNKNOWN|degraded|maintenance')]),
      criterion('admin-venue-status-console', [source('apps/admin-web/src/features/execution/venue-status-console.tsx', 'incident|venue|status')]),
      criterion('status-failure-regression-assertions', [test('apps/api/src/modules/exchanges/venue-status.spec.ts', 'UNKNOWN|unavailable|maintenance')]),
    ],
  },
  {
    id: 'GAP-73', title: 'Exchange account permission/capability health', commercialWeight: 4,
    criteria: [
      criterion('persisted-account-capability-evidence', [source('apps/api/prisma/schema.prisma', 'canTrade|canReadData|canWithdraw', 'verifiedPermissions|permissionsVerifiedAt')]),
      criterion('capability-discovery-api', [source('apps/api/src/modules/exchanges/exchange-connectivity.service.ts', 'permissions|canTrade|capability')]),
      criterion('customer-account-health-surface', [source('apps/web/src/features/exchanges/account-capability-health.tsx', 'READ_ONLY|TRADE_ENABLED|UNKNOWN')]),
      criterion('account-health-regression-assertions', [test('apps/api/src/modules/exchanges/account-capability-health.spec.ts', 'permission|stale|UNKNOWN')]),
    ],
  },
  {
    id: 'GAP-74', title: 'Exchange API-key rotation workflow', commercialWeight: 5,
    criteria: [
      criterion('existing-rotation-api-and-service', [source('apps/api/src/modules/exchanges/exchanges.controller.ts', 'rotate'), source('apps/api/src/modules/exchanges/exchange-account.service.ts', 'rotateCredentials')]),
      criterion('customer-rotation-workflow', [source('apps/web/src/features/exchanges/api-key-rotation-page.tsx', 'rotate|credential|verify')]),
      criterion('secret-readiness-and-audit', [source('apps/api/src/modules/exchanges/exchange-account.service.ts', 'audit|credential|verify|secret')]),
      criterion('rotation-regression-assertions', [test('apps/api/src/modules/exchanges/api-key-rotation.spec.ts', 'rotate|credential|secret')]),
    ],
  },
  {
    id: 'GAP-75', title: 'Read-only versus trade permission verification', commercialWeight: 4,
    criteria: [
      criterion('persisted-verified-permission-state', [source('apps/api/prisma/schema.prisma', 'canTrade|canReadData|verifiedPermissions|permissionsVerifiedAt')]),
      criterion('live-provider-permission-check', [source('apps/api/src/modules/exchanges/exchange-connectivity.service.ts', 'canTrade|permissions|verified')]),
      criterion('customer-permission-badge', [source('apps/web/src/features/exchanges/permission-verification-badge.tsx', 'READ_ONLY|TRADE_ENABLED|UNKNOWN')]),
      criterion('permission-regression-assertions', [test('apps/api/src/modules/exchanges/permission-verification.spec.ts', 'read.only|trade|UNKNOWN')]),
    ],
  },
  {
    id: 'GAP-76', title: 'Withdrawal destination whitelist and policy', commercialWeight: 5,
    criteria: [
      criterion('existing-withdrawal-safety-gates', [source('apps/api/src/modules/custody/withdrawal-policy.service.ts', 'allow|deny|hold|approval')]),
      criterion('tenant-user-destination-allowlist', [source('apps/api/src/modules/custody/withdrawal-destination-policy.service.ts', 'tenantId', 'userId|ownerUserId', 'allowlist|destination')]),
      criterion('customer-and-admin-destination-surfaces', [source('apps/web/src/features/funding/withdrawal-destination-manager.tsx', 'confirm|destination'), source('apps/admin-web/src/features/funding/withdrawal-destination-audit.tsx', 'audit|destination')]),
      criterion('destination-policy-regression-assertions', [test('apps/api/src/modules/custody/withdrawal-destination-policy.spec.ts', 'unverified|tenant|destination')]),
    ],
  },
  {
    id: 'GAP-77', title: 'Step-up authentication for sensitive operations', commercialWeight: 5,
    criteria: [
      criterion('existing-mfa-and-totp-controls', [source('apps/api/src/modules/auth/services/two-factor.service.ts', 'TOTP|totp|recoveryCode|two.factor')]),
      criterion('action-bound-step-up-service', [source('apps/api/src/modules/auth/step-up-auth.service.ts', 'action|challenge|consume|expiry')]),
      criterion('step-up-api-and-dialog', [source('apps/api/src/modules/auth/step-up-auth.controller.ts', 'RequirePermissions|challenge'), source('apps/web/src/features/security/step-up-auth-dialog.tsx', 'challenge|verify|action')]),
      criterion('step-up-replay-regression-assertions', [test('apps/api/src/modules/auth/step-up-auth.spec.ts', 'replay|expiry|action|TOTP')]),
    ],
  },
  {
    id: 'GAP-78', title: 'Session and device management', commercialWeight: 4,
    criteria: [
      criterion('session-list-and-revocation-service', [source('apps/api/src/modules/auth/services/session.service.ts', 'listForUser', 'revokeAll|revoke')]),
      criterion('authenticated-session-controller', [source('apps/api/src/modules/auth/sessions.controller.ts', 'sessions|revoke|Permission')]),
      criterion('customer-session-device-surface', [source('apps/web/src/features/security/sessions-page.tsx', 'revoke|device|session')]),
      criterion('session-regression-assertions', [test('apps/api/src/modules/auth/services/session.service.spec.ts', 'revoke|session|owner')]),
    ],
  },
  {
    id: 'GAP-79', title: 'Suspicious-login and device-anomaly alerts', commercialWeight: 4,
    criteria: [
      criterion('existing-anomaly-detection-and-events', [source('apps/api/src/modules/security/suspicious-login.detector.ts', 'suspicious|anomaly|risk'), source('apps/api/src/modules/security/security-threat-detection.service.ts', 'login|event|threat')]),
      criterion('customer-notification-dispatch', [source('apps/api/src/modules/notifications/processors/login-anomaly-notification.processor.ts', 'login|notification|anomaly')]),
      criterion('customer-login-alert-surface', [source('apps/web/src/features/security/login-alerts.tsx', 'login|alert|device')]),
      criterion('login-alert-regression-assertions', [test('apps/api/src/modules/auth/login-anomaly.spec.ts', 'login|anomaly|alert')]),
    ],
  },
  {
    id: 'GAP-80', title: 'Account recovery and backup security controls', commercialWeight: 5,
    criteria: [
      criterion('existing-recovery-verification-foundation', [source('apps/api/src/modules/auth/services/two-factor.service.ts', 'recoveryCode|verificationToken|passwordReset')]),
      criterion('single-use-recovery-token-workflow', [source('apps/api/src/modules/auth/account-recovery.service.ts', 'token|consume|expires|single.use')]),
      criterion('customer-recovery-surface-and-api', [source('apps/api/src/modules/auth/account-recovery.controller.ts', 'Controller|recovery'), source('apps/web/src/features/security/account-recovery-page.tsx', 'recovery|email|verify')]),
      criterion('recovery-security-regression-assertions', [test('apps/api/src/modules/auth/account-recovery.spec.ts', 'replay|expired|consume|tenant')]),
    ],
  },
  {
    id: 'GAP-81', title: 'Full audit export with filters', commercialWeight: 5,
    criteria: [
      criterion('existing-governance-audit-export-service', [source('apps/api/src/modules/governance/governance-audit-export.service.ts', 'export|filter|tenantId')]),
      criterion('authorized-filtered-export-route', [source('apps/api/src/modules/governance/governance.controller.ts', 'audit.*export|exportAudit|governance-audit')]),
      criterion('operator-export-panel', [source('apps/admin-web/src/features/audit/audit-export-panel.tsx', 'filter|export|integrity')]),
      criterion('export-authorization-and-integrity-tests', [test('apps/api/src/modules/audit/audit-export.spec.ts', 'tenant|permission|integrity')]),
    ],
  },
  {
    id: 'GAP-82', title: 'Data retention and privacy control center', commercialWeight: 5,
    criteria: [
      criterion('existing-retention-policy-and-engine', [source('apps/api/src/modules/governance/retention-policy.service.ts', 'retention|policy'), source('apps/api/src/modules/governance/retention-engine.service.ts', 'retention|legal|hold')]),
      criterion('customer-privacy-surface', [source('apps/web/src/app/privacy/page.tsx', 'privacy|retention')]),
      criterion('admin-retention-control-center', [source('apps/admin-web/src/features/privacy/data-retention-console.tsx', 'retention|legal.hold|policy')]),
      criterion('retention-safety-tests', [test('apps/api/src/modules/governance/privacy-governance.contract.spec.ts', 'retention|legal.hold|delete')]),
    ],
  },
  {
    id: 'GAP-83', title: 'Customer data access and export request workflow', commercialWeight: 5,
    criteria: [
      criterion('existing-request-and-export-domain', [source('apps/api/src/modules/governance/privacy-request.service.ts', 'createRequest|tenantId|subjectUserId'), source('apps/api/src/modules/governance/privacy-export.service.ts', 'export|subjectUserId|tenantId')]),
      criterion('authorized-customer-data-request-route', [source('apps/api/src/modules/governance/governance.controller.ts', 'privacy-requests|privacy-export|RequirePermissions')]),
      criterion('actionable-customer-request-ui', [source('apps/web/src/features/security/data-export-page.tsx', 'request|export|status')]),
      criterion('data-access-security-regression-assertions', [test('apps/api/src/modules/privacy/data-access-request.spec.ts', 'tenant|subject|authorization')]),
    ],
  },
  {
    id: 'GAP-84', title: 'Public fee schedule and pricing transparency', commercialWeight: 5,
    criteria: [
      criterion('existing-public-pricing-and-fee-policy', [source('apps/web/src/app/pricing/page.tsx', 'pricing|plan'), source('apps/api/src/modules/billing/fees/fee-policy.service.ts', 'effective|fee|basisPoints')]),
      criterion('effective-public-fee-schedule-api', [source('apps/api/src/modules/billing/fee-schedule.service.ts', 'effective|fee|schedule'), source('apps/api/src/modules/billing/fee-schedule.controller.ts', 'Controller|schedule')]),
      criterion('customer-fee-schedule-surface', [source('apps/web/src/features/billing/fee-schedule-page.tsx', 'fee|schedule|trading')]),
      criterion('fee-schedule-regression-assertions', [test('apps/api/src/modules/billing/fee-schedule.spec.ts', 'fee|schedule|effective')]),
    ],
  },
  {
    id: 'GAP-85', title: 'Profit-share and fee statement calculation', commercialWeight: 5,
    criteria: [
      criterion('existing-fee-ledger-and-statement-storage', [source('apps/api/src/modules/billing/fees/fee-accrual.service.ts', 'ledger|accrual|posted'), source('apps/api/prisma/schema.prisma', 'model\\s+PortfolioStatement')]),
      criterion('profit-share-from-posted-ledger', [source('apps/api/src/modules/billing/profit-share-statement.service.ts', 'posted|ledger|profit.share|BigInt|Decimal')]),
      criterion('customer-profit-share-statement-surface', [source('apps/web/src/features/billing/profit-share-statement-page.tsx', 'statement|commission|fee')]),
      criterion('statement-calculation-regression-assertions', [test('apps/api/src/modules/billing/profit-share-statement.spec.ts', 'posted|unrealized|decimal|statement')]),
    ],
  },
  {
    id: 'GAP-86', title: 'Subscription billing and invoice lifecycle', commercialWeight: 5,
    criteria: [
      criterion('backend-subscription-and-invoice-lifecycle', [source('apps/api/src/modules/billing/subscriptions.service.ts', 'subscription|status|invoice'), source('apps/api/src/modules/billing/finance/invoice.service.ts', 'invoice|tenantId')]),
      criterion('customer-billing-and-invoice-pages', [source('apps/web/src/app/billing/invoices/page.tsx', 'Invoices'), source('apps/web/src/features/billing/invoices-page.tsx', 'invoice|status|download')]),
      criterion('provider-success-not-fabricated', [source('apps/api/src/modules/billing/billing-no-fake-success.spec.ts', 'payment|success|provider|fake')]),
      criterion('billing-api-regression-assertions', [test('apps/web/src/tests/billing-api.test.ts', 'invoice|subscription|status'), test('apps/api/src/modules/billing/portal/billing-portal-not-found.spec.ts', 'invoice|tenant|not found')]),
    ],
  },
  {
    id: 'GAP-87', title: 'Product plan and tenant entitlement enforcement', commercialWeight: 5,
    criteria: [
      criterion('canonical-entitlement-service-and-guard', [source('apps/api/src/modules/billing/entitlements/entitlement.service.ts', 'tenantId|entitlement'), source('apps/api/src/modules/billing/entitlements/entitlement.guard.ts', 'CanActivate|entitlement')]),
      criterion('plan-catalogue-or-admin-surface', [source('apps/admin-web/src/modules/billing/entitlements/tenant-entitlements-panel.tsx', 'tenant|plan|feature')]),
      criterion('authorization-and-denial-regression-tests', [test('apps/api/src/modules/billing/entitlements/entitlement.spec.ts', 'tenant|deny|plan')]),
    ],
  },
  {
    id: 'GAP-88', title: 'White-label tenant branding and theme configuration', commercialWeight: 5,
    criteria: [
      criterion('tenant-scoped-branding-api-and-persistence', [source('apps/api/src/modules/tenants/tenant-branding.service.ts', 'tenantId|branding|sanitize'), source('apps/api/src/modules/tenants/tenants.controller.ts', 'branding|tenantId')]),
      criterion('admin-brand-editor', [source('apps/admin-web/src/features/branding/tenant-branding-editor.tsx', 'logo|theme|branding')]),
      criterion('customer-runtime-theme-provider', [source('apps/web/src/features/branding/runtime-branding-provider.tsx', 'tenant|theme|logo')]),
      criterion('tenant-isolation-regression-assertions', [test('apps/api/src/modules/tenants/tenant-branding.spec.ts', 'tenant|isolation|sanitize')]),
    ],
  },
  {
    id: 'GAP-89', title: 'Custom domain and hostname tenant routing', commercialWeight: 4,
    criteria: [
      criterion('domain-verification-and-tenant-resolution', [source('apps/api/src/modules/billing/saas-admin/custom-domain.service.ts', 'tenantId|domain|verification'), source('apps/api/src/modules/billing/saas-admin/custom-domain-verification.service.ts', 'DNS|verification|resolve')]),
      criterion('admin-domain-settings-surface', [source('apps/admin-web/src/modules/billing/saas-admin/tenant-branding-domain.tsx', 'domain|verify|tenant')]),
      criterion('domain-isolation-regression-assertions', [test('apps/api/src/modules/tenants/custom-domain.spec.ts', 'domain|tenant|verify')]),
    ],
  },
  {
    id: 'GAP-90', title: 'Tenant feature-flag and entitlement admin console', commercialWeight: 4,
    criteria: [
      criterion('existing-tenant-feature-flag-service', [source('apps/api/src/modules/feature-flags/feature-flags.service.ts', 'tenantId|flag|enabled'), source('apps/api/src/modules/feature-flags/feature-flags.controller.ts', 'tenantId|RequirePermissions')]),
      criterion('dedicated-admin-flag-route-and-surface', [source('apps/admin-web/src/app/(console)/feature-flags/page.tsx', 'feature|flag|tenant'), source('apps/admin-web/src/features/settings/tenant-feature-flags.tsx', 'flag|enabled|tenant')]),
      criterion('flag-authorization-regression-assertions', [test('apps/api/src/modules/tenants/tenant-feature-flag.spec.ts', 'tenant|permission|flag')]),
    ],
  },
  {
    id: 'GAP-91', title: 'Localization, currency, and date-time preferences', commercialWeight: 3,
    criteria: [
      criterion('existing-user-preference-storage', [source('apps/api/prisma/schema.prisma', 'model\\s+UserProfile', 'locale|timezone|preferredCurrency')]),
      criterion('persisted-tenant-user-preferences-api', [source('apps/api/src/modules/users/user-preferences.service.ts', 'tenantId|userId|locale|timezone')]),
      criterion('customer-locale-and-exact-financial-formatting', [source('apps/web/src/features/settings/localization-settings-page.tsx', 'locale|timezone|currency'), source('apps/web/src/lib/i18n/locale-number-format.ts', 'Intl.NumberFormat|decimal|string')]),
      criterion('preference-isolation-regression-assertions', [test('apps/api/src/modules/users/user-preferences.spec.ts', 'tenant|user|locale')]),
    ],
  },
  {
    id: 'GAP-92', title: 'Accessibility compliance surface', commercialWeight: 4,
    criteria: [
      criterion('existing-accessibility-helpers', [source('apps/web/src/accessibility/accessibility-checks.ts', 'accessibility|contrast|label|focus')]),
      criterion('route-and-focus-announcement-helper', [source('apps/web/src/components/ui/focus-announcer.tsx', 'aria-live|role|announcement')]),
      criterion('web-and-admin-accessibility-smoke-tests', [test('apps/web/src/tests/accessibility-smoke.test.tsx', 'focus|aria|keyboard'), test('apps/admin-web/src/tests/accessibility-smoke.test.tsx', 'focus|aria|keyboard')]),
    ],
  },
  {
    id: 'GAP-93', title: 'Marketplace SEO metadata and indexing controls', commercialWeight: 4,
    criteria: [
      criterion('existing-public-marketplace-routes', [source('apps/web/src/app/traders/page.tsx', 'traders|marketplace'), source('apps/web/src/app/strategies/page.tsx', 'strategies|marketplace')]),
      criterion('public-marketplace-route-metadata', [source('apps/web/src/app/traders/layout.tsx', 'metadata|title|description'), source('apps/web/src/app/strategies/layout.tsx', 'metadata|title|description')]),
      criterion('crawler-policy-and-sitemap', [source('apps/web/src/app/robots.ts', 'robots|disallow'), source('apps/web/src/app/sitemap.ts', 'sitemap|traders|strategies')]),
      criterion('seo-regression-assertions', [test('apps/web/src/tests/seo-public-marketplace.test.ts', 'robots|sitemap|metadata')]),
    ],
  },
  {
    id: 'GAP-94', title: 'Shareable public trader and strategy links', commercialWeight: 4,
    criteria: [
      criterion('existing-public-trader-and-strategy-surfaces', [source('apps/web/src/features/trading/trader-detail-page.tsx', 'TraderDetailPage|traderId'), source('apps/web/src/features/trading/strategy-detail-page.tsx', 'StrategyDetailPage|strategyId')]),
      criterion('signed-expiring-public-share-token', [source('apps/api/src/modules/copy-trading/public-share.service.ts', 'sign|token|expires|read.only')]),
      criterion('customer-share-and-metadata-surface', [source('apps/web/src/features/trading/share-trader-dialog.tsx', 'share|public'), source('apps/web/src/features/trading/public-share-metadata.ts', 'canonical|title|description')]),
      criterion('share-security-regression-assertions', [test('apps/api/src/modules/copy-trading/public-share.spec.ts', 'expiry|signature|secret|tenant')]),
    ],
  },
  {
    id: 'GAP-95', title: 'Risk disclosure and consent versioning', commercialWeight: 5,
    criteria: [
      criterion('versioned-durable-consent-ledger-and-audit', [source('apps/api/src/modules/governance/consent.service.ts', 'tenantId', 'policyReference', 'version', 'consentModel\\.create', 'GovernanceActionType\\.CONSENT_CAPTURE')]),
      criterion('persistence-failure-does-not-report-success', [source('apps/api/src/modules/governance/consent.service.ts', 'ServiceUnavailableException', 'Consent could not be durably recorded')]),
      criterion('customer-risk-disclosure-consent-ui', [source('apps/web/src/features/compliance/risk-disclosure-consent.tsx', 'checkbox|consent|version|policyReference')]),
      criterion('consent-persistence-regression-assertions', [test('apps/api/src/modules/governance/consent.service.spec.ts', 'persistence|withdraw|audit|version')]),
    ],
  },
  {
    id: 'GAP-96', title: 'Terms and policy acceptance versioning', commercialWeight: 5,
    criteria: [
      criterion('existing-versioned-consent-and-terms-route', [source('apps/api/src/modules/governance/consent.service.ts', 'version|policyReference'), source('apps/web/src/app/terms/page.tsx', 'terms|policy')]),
      criterion('action-bound-policy-acceptance-service', [source('apps/api/src/modules/compliance/policy-acceptance.service.ts', 'version|acceptedAt|action')]),
      criterion('explicit-customer-policy-acceptance-ui', [source('apps/web/src/features/legal/policy-acceptance-page.tsx', 'accept|version|consent')]),
      criterion('policy-acceptance-regression-assertions', [test('apps/api/src/modules/compliance/policy-acceptance.spec.ts', 'version|accept|tenant|page.view')]),
    ],
  },
  {
    id: 'GAP-97', title: 'Affiliate attribution integrity', commercialWeight: 5,
    criteria: [
      criterion('durable-idempotent-attribution-engine', [source('apps/api/src/modules/partners/partner-attribution.service.ts', 'findFirst', 'tenantId:\\s*params\\.tenantId', 'idempotencyKey:\\s*params\\.idempotencyKey', 'attributionModel\\.create|partnerAttribution\\.create')]),
      criterion('fail-closed-storage-and-conflict-check', [source('apps/api/src/modules/partners/partner-attribution.service.ts', 'ServiceUnavailableException', 'findMany', 'ConflictException')]),
      criterion('partner-attribution-reporting-surface', [source('apps/web/src/features/partner/affiliate-attribution-panel.tsx', 'attribution|partner|tenant')]),
      criterion('attribution-integrity-regression-assertions', [test('apps/api/src/modules/partners/partner-attribution.service.spec.ts', 'idempotent|persistence|conflict|lookup')]),
    ],
  },
  {
    id: 'GAP-98', title: 'Referral abuse and self-referral controls', commercialWeight: 5,
    criteria: [
      criterion('existing-self-referral-and-referral-validation', [source('apps/api/src/modules/partners/partner-attribution.service.ts', 'self.referral|referral evidence|referral code belongs')]),
      criterion('deterministic-abuse-rules-and-review-queue', [source('apps/api/src/modules/partner/referral-abuse.service.ts', 'velocity|self.referral|score|review'), source('apps/admin-web/src/features/partners/referral-abuse-queue.tsx', 'review|flag|evidence')]),
      criterion('abuse-rules-regression-assertions', [test('apps/api/src/modules/partner/referral-abuse.spec.ts', 'self.referral|velocity|review')]),
    ],
  },
  {
    id: 'GAP-99', title: 'Business and operator KPI dashboard', commercialWeight: 5,
    criteria: [
      criterion('existing-billing-analytics-evidence', [source('apps/api/src/modules/billing/analytics/revenue-analytics.service.ts', 'MRR|revenue|tenantId'), source('apps/api/src/modules/billing/analytics/churn-analytics.service.ts', 'churn|tenantId')]),
      criterion('unified-copy-trading-business-kpi-service', [source('apps/api/src/modules/analytics/business-kpi.service.ts', 'AUM|copier|trader|revenue|currency')]),
      criterion('authorized-admin-kpi-surface', [source('apps/api/src/modules/analytics/business-kpi.controller.ts', 'RequirePermissions|tenantId'), source('apps/admin-web/src/features/analytics/business-kpi-dashboard.tsx', 'AUM|copier|retention|revenue')]),
      criterion('currency-and-freshness-regression-assertions', [test('apps/api/src/modules/analytics/business-kpi.spec.ts', 'currency|fresh|tenant|revenue')]),
    ],
  },
  {
    id: 'GAP-100', title: 'Commercial readiness and buyer handover evidence', commercialWeight: 5,
    criteria: [
      criterion('buyer-facing-commercial-readiness-report', [source('docs/COMMERCIAL_READINESS_GAP_51_100.md', 'commercial|limitations|prerequisites|benchmark')]),
      criterion('evidence-based-parity-scanner', [source('ops/gap-parity-scanner-51-100.js', 'criteria|commercialWeight|weightedCommercialParityPct', 'fs\\.readFileSync')]),
      criterion('readiness-admin-dashboard-and-api', [source('apps/api/src/modules/ops/commercial-readiness.service.ts', 'check|readiness|evidence'), source('apps/admin-web/src/features/analytics/commercial-readiness-dashboard.tsx', 'readiness|blocker|evidence')]),
      criterion('scanner-regression-tests', [test('ops/gap-parity-scanner-51-100.test.js', 'missing|hard.code|weight|criteria')]),
    ],
  },
];

function validateManifest(gapChecks) {
  if (!Array.isArray(gapChecks) || gapChecks.length !== 50) {
    throw new Error(`Expected exactly 50 gap evidence rubrics, received ${Array.isArray(gapChecks) ? gapChecks.length : 'non-array'}`);
  }
  const ids = gapChecks.map((gap) => gap.id);
  for (let id = 51; id <= 100; id += 1) {
    const expected = `GAP-${id}`;
    if (ids.filter((actual) => actual === expected).length !== 1) {
      throw new Error(`Evidence rubric manifest must contain ${expected} exactly once`);
    }
  }
  for (const gap of gapChecks) {
    if (!Number.isInteger(gap.commercialWeight) || gap.commercialWeight < 1 || gap.commercialWeight > 5) {
      throw new Error(`${gap.id} commercialWeight must be an integer from 1 through 5`);
    }
    if (!Array.isArray(gap.criteria) || gap.criteria.length === 0) {
      throw new Error(`${gap.id} must declare at least one evidence criterion`);
    }
    for (const item of gap.criteria) {
      if (!Array.isArray(item.evidence) || item.evidence.length === 0) {
        throw new Error(`${gap.id}/${item.key} must declare at least one evidence probe`);
      }
      if (item.mode !== 'all' && item.mode !== 'any') {
        throw new Error(`${gap.id}/${item.key} evidence mode must be all or any`);
      }
    }
  }
  return true;
}

function isTestProbe(probeItem) {
  return probeItem.patterns.some((pattern) => String(pattern).includes('expect\\s*\\('));
}

function evaluateProbe(rootDir, probeItem) {
  const absolutePath = path.resolve(rootDir, probeItem.file);
  const relativePath = path.relative(rootDir, absolutePath);
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    return { file: probeItem.file, matched: false, reason: 'Evidence path escapes repository root' };
  }
  if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
    return { file: probeItem.file, matched: false, reason: 'Evidence file is missing' };
  }
  const text = fs.readFileSync(absolutePath, 'utf8');
  if (text.trim().length < 40) return { file: probeItem.file, matched: false, reason: 'Evidence file is too short to contain an implementation' };
  const placeholder = FORBIDDEN_PLACEHOLDERS.find((value) => text.includes(value));
  if (placeholder) return { file: probeItem.file, matched: false, reason: `Contains forbidden placeholder: ${placeholder}` };

  const patterns = probeItem.patterns || [];
  const missingPatterns = [];
  for (const patternSource of patterns) {
    let expression;
    try {
      expression = new RegExp(patternSource, 'i');
    } catch (error) {
      return { file: probeItem.file, matched: false, reason: `Invalid evidence expression: ${error.message}` };
    }
    if (!expression.test(text)) missingPatterns.push(patternSource);
  }
  if (isTestProbe(probeItem)) {
    if (!/\b(?:test|it)\s*\(/i.test(text) || !/\bexpect\s*\(/i.test(text)) {
      if (!missingPatterns.includes('assertive-test-structure')) missingPatterns.push('assertive-test-structure');
    }
  }
  return missingPatterns.length === 0
    ? { file: probeItem.file, matched: true, reason: null }
    : { file: probeItem.file, matched: false, reason: 'Required behavior/assertion signal is absent', missingPatterns };
}

function evaluateCriterion(rootDir, criterionItem) {
  const probes = criterionItem.evidence.map((item) => evaluateProbe(rootDir, item));
  const matches = probes.filter((item) => item.matched);
  const mode = criterionItem.mode === 'all' ? 'all' : 'any';
  const satisfied = mode === 'all' ? matches.length === probes.length : matches.length > 0;
  return {
    key: criterionItem.key,
    mode,
    satisfied,
    matchedFiles: matches.map((item) => item.file),
    probeResults: probes,
  };
}

function evaluateGap(gap, rootDir = ROOT) {
  const criteria = gap.criteria.map((item) => evaluateCriterion(rootDir, item));
  const satisfiedCriteria = criteria.filter((item) => item.satisfied).length;
  const evidenceCoverage = satisfiedCriteria / criteria.length;
  const status = satisfiedCriteria === 0
    ? 'FAIL'
    : satisfiedCriteria === criteria.length
      ? 'EXISTING_VERIFIED'
      : 'PARTIAL';
  return {
    id: gap.id,
    title: gap.title,
    status,
    commercialWeight: gap.commercialWeight,
    satisfiedCriteria,
    totalCriteria: criteria.length,
    evidenceCoverage,
    criteria,
    testExecutionVerified: false,
  };
}

function calculateWeightedCommercialParity(results) {
  const weightTotal = results.reduce((total, result) => total + result.commercialWeight, 0);
  if (weightTotal === 0) return 0;
  const weightedEvidence = results.reduce(
    (total, result) => total + result.commercialWeight * result.evidenceCoverage,
    0,
  );
  return Number(((weightedEvidence / weightTotal) * 100).toFixed(2));
}

function calculateProductionCriticalEvidencePct(results) {
  const productionResults = results.filter((result) => PRODUCTION_CRITICAL_GAP_IDS.has(result.id));
  if (productionResults.length === 0) return 0;
  const coverage = productionResults.reduce((total, result) => total + result.evidenceCoverage, 0) / productionResults.length;
  return Number((coverage * 100).toFixed(2));
}

function runGapParityScan(rootDir = ROOT, gapChecks = GAP_CHECKS) {
  validateManifest(gapChecks);
  const results = gapChecks.map((gap) => evaluateGap(gap, rootDir));
  const fullyVerifiedCount = results.filter((result) => result.status === 'EXISTING_VERIFIED').length;
  const partialCount = results.filter((result) => result.status === 'PARTIAL').length;
  const failedCount = results.filter((result) => result.status === 'FAIL').length;
  const criterionCount = results.reduce((total, result) => total + result.totalCriteria, 0);
  const satisfiedCriterionCount = results.reduce((total, result) => total + result.satisfiedCriteria, 0);
  const commercialWeightTotal = results.reduce((total, result) => total + result.commercialWeight, 0);
  const batchProductEvidencePct = Number(((satisfiedCriterionCount / criterionCount) * 100).toFixed(2));
  const batchCommercialEvidencePct = calculateWeightedCommercialParity(results);
  const batchProductionCriticalEvidencePct = calculateProductionCriticalEvidencePct(results);
  const cumulativeFromAcceptedBaseline = (batchPct) => Number((BASELINE_ACCEPTED_GAPS + batchPct / 2).toFixed(2));
  return {
    batch: 'GAP-51–GAP-100',
    total: results.length,
    fullyVerified: fullyVerifiedCount,
    partial: partialCount,
    failed: failedCount,
    evidenceCriteriaSatisfied: satisfiedCriterionCount,
    evidenceCriteriaTotal: criterionCount,
    commercialWeightTotal,
    weightedCommercialParityPct: batchCommercialEvidencePct,
    productionCriticalGapCount: results.filter((result) => PRODUCTION_CRITICAL_GAP_IDS.has(result.id)).length,
    productionCriticalEvidencePct: batchProductionCriticalEvidencePct,
    batchProductEvidencePct,
    cumulativeProductCompletenessPct: cumulativeFromAcceptedBaseline(batchProductEvidencePct),
    cumulativeProductionReadinessPct: cumulativeFromAcceptedBaseline(batchProductionCriticalEvidencePct),
    cumulativeCommercialReadinessPct: cumulativeFromAcceptedBaseline(batchCommercialEvidencePct),
    baselineAssumedVerifiedGaps: BASELINE_ACCEPTED_GAPS,
    staticEvidenceOnly: true,
    testExecutionVerifiedByScanner: false,
    results,
  };
}

if (require.main === module) {
  let report;
  try {
    report = runGapParityScan();
  } catch (error) {
    console.error(`GAP-51–GAP-100 parity scan configuration error: ${error.message}`);
    process.exit(2);
  }
  for (const item of report.results) {
    const icon = item.status === 'EXISTING_VERIFIED' ? '✓' : item.status === 'PARTIAL' ? '!' : '×';
    console.log(`${icon} ${item.id}: ${item.status} (${item.satisfiedCriteria}/${item.totalCriteria} evidence criteria; weight ${item.commercialWeight}) — ${item.title}`);
    for (const check of item.criteria.filter((candidate) => !candidate.satisfied)) {
      const reasons = check.probeResults.map((candidate) => `${candidate.file}: ${candidate.reason}`).join('; ');
      console.log(`   unresolved evidence [${check.key}]: ${reasons}`);
    }
  }
  console.log(`\nGAP-51–GAP-100 static evidence: ${report.evidenceCriteriaSatisfied}/${report.evidenceCriteriaTotal} criteria; ${report.fullyVerified} fully evidenced, ${report.partial} partial, ${report.failed} no evidence`);
  console.log(`Weighted commercial-parity evidence score: ${report.weightedCommercialParityPct}% (${report.commercialWeightTotal} total weight)`);
  console.log(`Production-critical evidence score: ${report.productionCriticalEvidencePct}% (${report.productionCriticalGapCount} declared critical gaps)`);
  console.log(`Cumulative evidence proxies (baseline assumed 50/50): product ${report.cumulativeProductCompletenessPct}%, production ${report.cumulativeProductionReadinessPct}%, commercial ${report.cumulativeCommercialReadinessPct}%`);
  console.log('This scanner checks static repository evidence only; it does not run tests, validate live providers, or certify commercial parity.');
  process.exit(report.failed === 0 ? 0 : 1);
}

module.exports = {
  BASELINE_ACCEPTED_GAPS,
  GAP_CHECKS,
  PRODUCTION_CRITICAL_GAP_IDS,
  calculateProductionCriticalEvidencePct,
  calculateWeightedCommercialParity,
  evaluateGap,
  evaluateProbe,
  runGapParityScan,
  validateManifest,
};
