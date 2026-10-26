# GAP-51–100 Final Static Evidence Report

Generated from the final run of `ops/gap-parity-scanner-51-100.js`; the scanner itself sets `testExecutionVerified=false` for every gap.

- Static evidence: 126/199 criteria.
- Status counts: 19 fully evidenced, 31 partial, 0 no evidence.
- Weighted commercial-parity evidence: 63.01% (229 total weight).
- Production-critical evidence: 60.05% (31 declared critical gaps).
- Cumulative evidence proxies (assumed 50/50 baseline): product 81.66%, production 80.03%, commercial 81.50%.
- These are static repository evidence proxies only. They do not certify tests, live integrations, security posture, or production readiness.

## Per-gap evidence

- GAP-51 EXISTING_VERIFIED (4/4): Trader profile, follower/AUM/activity detail
- GAP-52 EXISTING_VERIFIED (5/5): Lead-trader application and qualification workflow
- GAP-53 EXISTING_VERIFIED (5/5): Lead-trader profit-share and fee configuration
- GAP-54 EXISTING_VERIFIED (4/4): Leaderboard timeframe and ranking methodology
- GAP-55 EXISTING_VERIFIED (5/5): Verified performance calculation methodology
- GAP-56 EXISTING_VERIFIED (4/4): Verified benchmark and market comparison overlay
- GAP-57 EXISTING_VERIFIED (5/5): Unified trader risk score
- GAP-58 EXISTING_VERIFIED (4/4): Trader exposure and asset allocation breakdown
- GAP-59 EXISTING_VERIFIED (3/3): Concentration and correlation risk view
- GAP-60 EXISTING_VERIFIED (5/5): Preview-only exact-decimal allocation rebalance planner
- GAP-61 PARTIAL (1/4): Copy budget and allocation-cap automation — unresolved: global-active-copy-budget-engine, customer-budget-surface, budget-enforcement-test
- GAP-62 EXISTING_VERIFIED (4/4): Maximum concurrent position and order limits
- GAP-63 EXISTING_VERIFIED (4/4): Copy-trading symbol allow and deny policies
- GAP-64 EXISTING_VERIFIED (4/4): Leverage and margin-mode policy surface
- GAP-65 PARTIAL (1/3): Liquidation distance and margin health alerts — unresolved: customer-liquidation-alert-surface, notification-dispatch-and-test
- GAP-66 EXISTING_VERIFIED (4/4): User-configurable slippage tolerance
- GAP-67 PARTIAL (2/4): Copy execution retry/failure timeline — unresolved: customer-timeline-surface, timeline-state-regression-assertions
- GAP-68 PARTIAL (3/4): OMS state machine visualization and recovery action — unresolved: operator-timeline-surface
- GAP-69 PARTIAL (1/4): Exchange user-data stream health — unresolved: account-scoped-user-stream-api, operator-stream-health-surface, stream-lifecycle-regression-assertions
- GAP-70 PARTIAL (1/4): Clock drift and venue timestamp safety — unresolved: bounded-clock-offset-service, execution-engine-monotonic-sync, clock-safety-regression-assertions
- GAP-71 EXISTING_VERIFIED (4/4): Exchange rate-limit budget and backpressure
- GAP-72 PARTIAL (1/5): Venue maintenance and incident status surface — unresolved: normalized-venue-status-api, customer-venue-status-banner, admin-venue-status-console, status-failure-regression-assertions
- GAP-73 PARTIAL (2/4): Exchange account permission/capability health — unresolved: customer-account-health-surface, account-health-regression-assertions
- GAP-74 PARTIAL (2/4): Exchange API-key rotation workflow — unresolved: customer-rotation-workflow, rotation-regression-assertions
- GAP-75 PARTIAL (2/4): Read-only versus trade permission verification — unresolved: customer-permission-badge, permission-regression-assertions
- GAP-76 PARTIAL (1/4): Withdrawal destination whitelist and policy — unresolved: tenant-user-destination-allowlist, customer-and-admin-destination-surfaces, destination-policy-regression-assertions
- GAP-77 PARTIAL (1/4): Step-up authentication for sensitive operations — unresolved: action-bound-step-up-service, step-up-api-and-dialog, step-up-replay-regression-assertions
- GAP-78 EXISTING_VERIFIED (4/4): Session and device management
- GAP-79 PARTIAL (1/4): Suspicious-login and device-anomaly alerts — unresolved: customer-notification-dispatch, customer-login-alert-surface, login-alert-regression-assertions
- GAP-80 PARTIAL (1/4): Account recovery and backup security controls — unresolved: single-use-recovery-token-workflow, customer-recovery-surface-and-api, recovery-security-regression-assertions
- GAP-81 PARTIAL (2/4): Full audit export with filters — unresolved: operator-export-panel, export-authorization-and-integrity-tests
- GAP-82 PARTIAL (3/4): Data retention and privacy control center — unresolved: admin-retention-control-center
- GAP-83 PARTIAL (2/4): Customer data access and export request workflow — unresolved: actionable-customer-request-ui, data-access-security-regression-assertions
- GAP-84 PARTIAL (1/4): Public fee schedule and pricing transparency — unresolved: effective-public-fee-schedule-api, customer-fee-schedule-surface, fee-schedule-regression-assertions
- GAP-85 PARTIAL (1/4): Profit-share and fee statement calculation — unresolved: profit-share-from-posted-ledger, customer-profit-share-statement-surface, statement-calculation-regression-assertions
- GAP-86 EXISTING_VERIFIED (4/4): Subscription billing and invoice lifecycle
- GAP-87 EXISTING_VERIFIED (3/3): Product plan and tenant entitlement enforcement
- GAP-88 PARTIAL (1/4): White-label tenant branding and theme configuration — unresolved: admin-brand-editor, customer-runtime-theme-provider, tenant-isolation-regression-assertions
- GAP-89 EXISTING_VERIFIED (3/3): Custom domain and hostname tenant routing
- GAP-90 PARTIAL (1/3): Tenant feature-flag and entitlement admin console — unresolved: dedicated-admin-flag-route-and-surface, flag-authorization-regression-assertions
- GAP-91 PARTIAL (1/4): Localization, currency, and date-time preferences — unresolved: persisted-tenant-user-preferences-api, customer-locale-and-exact-financial-formatting, preference-isolation-regression-assertions
- GAP-92 PARTIAL (1/3): Accessibility compliance surface — unresolved: route-and-focus-announcement-helper, web-and-admin-accessibility-smoke-tests
- GAP-93 PARTIAL (2/4): Marketplace SEO metadata and indexing controls — unresolved: public-marketplace-route-metadata, seo-regression-assertions
- GAP-94 PARTIAL (1/4): Shareable public trader and strategy links — unresolved: signed-expiring-public-share-token, customer-share-and-metadata-surface, share-security-regression-assertions
- GAP-95 PARTIAL (3/4): Risk disclosure and consent versioning — unresolved: customer-risk-disclosure-consent-ui
- GAP-96 PARTIAL (1/4): Terms and policy acceptance versioning — unresolved: action-bound-policy-acceptance-service, explicit-customer-policy-acceptance-ui, policy-acceptance-regression-assertions
- GAP-97 PARTIAL (3/4): Affiliate attribution integrity — unresolved: partner-attribution-reporting-surface
- GAP-98 PARTIAL (1/3): Referral abuse and self-referral controls — unresolved: deterministic-abuse-rules-and-review-queue, abuse-rules-regression-assertions
- GAP-99 PARTIAL (1/4): Business and operator KPI dashboard — unresolved: unified-copy-trading-business-kpi-service, authorized-admin-kpi-surface, currency-and-freshness-regression-assertions
- GAP-100 PARTIAL (3/4): Commercial readiness and buyer handover evidence — unresolved: readiness-admin-dashboard-and-api

## Self-check commands not run

- `npm run typecheck --workspace=@wlct/api`
- `npm test --workspace=@wlct/api -- --ci`
- `python -m pytest services/execution-engine/tests/test_routes_helper.py services/execution-engine/tests/test_part15_enablement.py services/execution-engine/tests/test_part20_status_read.py -q`
- `node scripts/secret-scan.mjs --tree`
