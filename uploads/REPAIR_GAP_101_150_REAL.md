# REPAIR_GAP_101_150_REAL.md — White-Label Crypto Copy-Trading: sale-readiness repair ($20k–$60k target)

# Responsibility: single copy-paste prompt for a coding agent. Closes the REAL gaps found by auditing the checked-in tree (zip `White-Label01-Crypto-Copy-Trading-App-main`, 2,266 files, audit date 2026-10-08). Carries over every unfinished GAP-51–100 item (none skipped) and adds GAP-101–150.

> Source of truth = the tree and the commands you run. NOT `NEXT.md`, NOT `docs/NEXT_51_100_FINAL_REPORT.md`. Those documents were found to disagree with the tree (see §2).
> Auditor limits (be honest about them): static scan of all files + targeted reading of copy / execution / custody paths + Python tests and scanners executed. Node API/web suites, Prisma generate, API typecheck/build/lint were NOT run by the auditor (Prisma engine download blocked in the sandbox). Numbers marked (R) are the repo's own report and are unverified.

---

## 0. Non-negotiable rules for the agent

1. **Evidence = running code + wiring + a test that FAILS if the wiring is removed.** File presence, a 25-line minimum, a role comment, or a re-export shim is NOT evidence.
2. **Never weaken** a scanner, lint rule, tsconfig, jest config or test to get green. Fix the code.
3. **No thin re-export shims.** The path named in a target list holds the canonical implementation (`git mv` the real code there, delete the other copy, fix imports, update scanner paths).
4. **Fail closed.** Unknown / stale / unavailable stays `UNAVAILABLE` or `UNKNOWN`. Never an optimistic default, never an invented number, never a client-supplied PnL/price accepted as truth.
5. **Money, prices, quantities = exact decimal strings** (`apps/api/src/common/decimal-string.ts`). No floats.
6. **Every new route** is tenant-scoped and permission-decorated (`npm run check:route-authorization`). Every new tenant table gets an additive RLS migration (generator: `scripts/gen_part11_rls.py`); never edit an old migration.
7. **One canonical module per concern.** Before creating a file run `rg` for an existing implementation and extend it.
8. **Do not claim PASS for anything you did not run.** Record command, exit code, counts. If a gate cannot run (OOM, no network) write `BLOCKED` + cause. Never `PASS`.
9. **Allowed status words only:** `VERIFIED_RUNTIME` (test executed and passed) · `VERIFIED_STATIC` (typecheck/scanner only) · `PARTIAL` · `BLOCKED` · `NOT_STARTED`.
10. **First line of every new source file** = the role comment shown after `#` in the trees below (repo convention: `// # ...` for TS, `# ...` for Python/YAML).
11. Work in the batch order of §5. Commit per GAP. At the end write `docs/GAP_101_150_FINAL_REPORT.md` and append (do not rewrite) a new section to root `NEXT.md`.

---

## 1. Honest scorecard (sale target $20k–$60k)

| Domain | Weight | Done | Weighted | Evidence behind the number |
|---|---:|---:|---:|---|
| A. Multi-tenant SaaS foundation (tenants, RLS, SAML SSO, RBAC, plans/billing, partners) | 12 | 85% | 10.2 | RLS policies for 186 tenant tables + coverage spec, SAML, billing portal, entitlements, partner/IB module. Open: RLS enable is a manual DBA step; branding editor + feature-flag console missing (GAP-88, 90) |
| B. Copy-trading product (discovery, profile, follow wizard, positions/orders, guardrails, leader fee config) | 20 | 80% | 16.0 | 62 web pages, 37 copy-trading routes, 49 files in the copy module, TP/SL/trailing policy fields + UI. Open: copy budgets (61), liquidation alerts (65), execution timeline (67), Smart/Advanced modes, demo onboarding |
| C. Execution and venue coverage | 20 | 55% | 11.0 | Binance is real (adapter, signing, trading 1,232 lines, user-stream, attestation). Bybit/OKX/Kraken/Coinbase are read-side only; NestJS create-order adapters are spot-only and unproven; no Bitget/KuCoin; leader events are DB-polled every 5 s |
| D. Money movement and compliance | 12 | 60% | 7.2 | Dual-control withdrawals, hold windows, reconciliation, compliance cases exist. KYC/AML/custody/payout adapters are generic `BASE_URL/v1/...`; no vendor-specific Sumsub/Chainalysis/Fireblocks; leader profit-share settlement not connected |
| E. Clients (web, admin, mobile) | 10 | 70% | 7.0 | Web 26k LOC / 39 test files; admin 14k LOC / 29 pages / 3 test files; mobile 14k LOC / 3 test files, no push, no biometrics, no trader discovery/profile/follow wizard |
| F. Quality gates and test evidence | 14 | 55% | 7.7 | (R) API Jest 135 suites / 2,099 tests pass with ts-jest diagnostics OFF; API typecheck + Nest build hit V8 OOM at 1.15 GB; API lint = 6,437 warnings against `--max-warnings=0`; no Playwright dependency; auditor-run python trading-core: 1,766 pass / 1 fail |
| G. Deployability and ops evidence | 8 | 65% | 5.2 | Terraform, Dockerfiles, DR tooling, Prometheus config. No staging deploy proof, no load test, no DR drill record, no SBOM / dependency audit |
| H. Sale packaging | 4 | 60% | 2.4 | Proprietary LICENSE (owner-named), extensive docs. No IP-assignment pack, no demo tenant script, no data-room index |
| **Total** | **100** | | **66.7%** | **≈ 67% done / ≈ 33% missing (±5 points)** |

Comparison of proxies: the repo's own "cumulative 79.65%" (R) counts file and assertion presence. The 51–100 scanner on THIS tree gives 52.93% weighted for that batch (report claims 59.30%). The 67% above weights runtime proof, venue coverage and release gates — the things a buyer's diligence actually tests. All three are evidence proxies, not valuations.

LOC by area (static): api 264,712 · libs/trading-core 93,241 · web 26,155 · scripts 21,254 · execution-engine 17,629 · admin-web 14,423 · mobile 14,201 · low-latency-gateway (Rust) 10,258 · ops 8,051.

---

## 2. Verified findings that change the plan (auditor ran or read these)

| ID | Finding | Evidence |
|---|---|---|
| F1 | **Report ↔ tree drift.** Scanner on this tree: 106/199 criteria, 9 EXISTING_VERIFIED, 41 PARTIAL, weighted 52.93%, production-critical 47.63%. Report claims 119/199, 14 verified, 36 partial, 59.30%. All 139 file paths named in the report exist, but 18 wire-in / behaviour edits are missing (list in §6.B) | `node ops/gap-parity-scanner-51-100.js` |
| F2 | **Orphans.** `TraderRiskScoreService` is referenced by no non-spec file (not provided in any module). `PerformanceCalculationService` is used only by `performance-benchmark.service.ts`; `trader-performance.service.ts` (what users see) never calls it. `consent.service.ts` still contains the in-memory fallback the report says was removed | `rg TraderRiskScoreService apps/api/src` |
| F3 | The 50-gap scanner passes 50/50 but only checks file exists, non-empty, and 3 forbidden strings. It cannot detect F2 | `ops/gap-parity-scanner.js` |
| F4 | Re-export shims padded with a dataclass to pass a size check, while NEXT.md says "0 thin re-export stubs": `services/execution-engine/app/orders/placement.py`, `orders/submission.py`, `exchanges/credentials.py`, `security/secret_fetcher.py` (33–35 lines each) | read files |
| F5 | **Parallel duplicate implementations.** `exchanges/providers/*.provider.ts` (14–29 lines) are shims over `exchanges/venues/*.provider.ts` (404–512 lines). `providers/adapters/custody.adapter.ts` (33 lines) and `payment.adapter.ts` (45) shim `custody/` and `payment/` subfolders. Admin-web `features/*` vs `modules/*` has 7 same-named files. 30 duplicate basenames in API, 11 admin-web, 9 web. `lib/api-error.ts` is byte-identical in web and admin-web | `find`, `sha256sum` |
| F6 | **Only Binance can place real orders in the Python engine.** `venues/bybit.provider.ts` says "places no orders". `providers/adapters/exchange/okx.adapter.ts` `createOrder` hard-codes `tdMode: 'cash'` (spot only), has a no-op `symbol.replace('-', '-')`, `isIdempotent: false`. Two placement stacks exist (NestJS adapters vs Python engine) → double-submit risk if both enabled | read files |
| F7 | KYC / AML / custody / payout adapters call `process.env.*_PROVIDER_BASE_URL + '/v1/...'`. Sumsub, Chainalysis, Fireblocks (listed as dependencies in NEXT.md) do not appear in adapter code. Stripe and NOWPayments are vendor-specific (contract specs exist) | `rg -i fireblocks apps/api/src/modules/providers` |
| F8 | **Leader profit-share is disclosure/config only.** `leader-fee.service.ts` states it creates no accruals, posts no ledger entries, triggers no payouts. Platform billing has accrual/settlement/payout services (`modules/billing/fees/*`) that are not connected to follower profit | `leader-fee.service.ts:2,128` |
| F9 | "E2E" = `renderToStaticMarkup` Jest smoke tests. No `@playwright/test` in any `package.json`, although `playwright.config.ts` exists | `rg playwright package.json` |
| F10 | **CI.** `whitelabel-copytrade/.github/workflows/{ci,release,security}.yml` sit in a nested `.github` that GitHub ignores when the repo root is the outer folder (root has only `ci.yml`, `production-release.yml`). `security.yml` header and job name promise dependency audit + secret scanning, but its steps only run route-authorization + two validators. No npm audit / pip-audit / cargo audit / gitleaks / CodeQL / SBOM anywhere | read workflows |
| F11 | Python `libs/trading-core`: **1,766 passed, 1 failed** — `tests/test_repo_reference_integrity.py::test_every_named_artefact_resolves_to_a_file_in_the_tree` (docs name `robots.ts`, `sitemap.ts`, a `RELEASE_PACKAGE_CHECK.md` path in `scripts/generate-release-manifest.ts:41`, etc. that do not resolve). `httpx` is an optional extra, install it first | `pytest` |
| F12 | Mobile `pubspec.yaml`: riverpod, dio, go_router, flutter_secure_storage. No `firebase_messaging` (push), no `local_auth` (biometrics). No trader discovery / profile / follow-wizard screens; one `copy_trading_screen.dart` | read pubspec |
| F13 | No load/perf tests (k6/locust/artillery). No Telegram/Discord channel. Leader events are polled: `COPY_LEADER_INGESTION_INTERVAL_MS` default 5000, stale cutoff `COPY_LEADER_EVENT_MAX_AGE_MS` 30000 | `rg`, read service |
| F14 | **Keep (strengths):** no committed secrets; RLS generator + coverage spec; fail-closed gates; kill-switch; dual-control withdrawals; SAML SSO; Rust low-latency gateway; TS/Python/Rust SDKs; Terraform; DR tooling; `.env` validated by zod at boot | scans |
| F15 | **Mobile cannot produce a store binary.** `apps/mobile` holds `lib/`, `test/`, `pubspec.yaml`, `l10n.yaml`, `.gitignore` only: no `android/`, no `ios/`, no `.metadata`. CI mobile job = analyze + test (3 test files) | `ls -a apps/mobile` |
| F16 | Observability: Prometheus alert rules (`infrastructure/observability/prometheus/rules/wlct.rules.yml`) and `metrics-catalog.json` exist; no Grafana dashboards-as-code and no recorded `promtool` validation | `find infrastructure/observability` |

---

## 3. Competitor / market comparison (what buyers will compare this against)

Legend: ✅ present with evidence · ◐ partial / unproven · ❌ absent · — not verified by the auditor. Competitor columns come from public vendor / help / listing pages read on 2026-10-08 (vendor claims, not independently validated); URLs in §10. Binance and OKX copy-trading pages were NOT re-checked in this audit.

| Capability | THIS repo (this zip) | Exchange-native (Bybit, Bitget checked) | Social-investing platforms (Zignaly, Finestel) | B2B white-label stacks (B2COPY, copy.cc) |
|---|---|---|---|---|
| Delivery model | Source code, self-host | Not sold | SaaS; Finestel sells a white-label crypto copy-trading platform; Zignaly lists white-label + API | Managed SaaS (B2COPY); managed or source-code licence (copy.cc) |
| Multi-tenant white-label (brand, domain, plans) | ✅ (branding editor ❌, GAP-88) | ❌ | ✅ Finestel (white-label settings page) | ✅ |
| Crypto venues with live copy execution | ◐ Binance only proven; Bybit/OKX/Kraken/Coinbase read-side | Own venue only | Zignaly: described as a Binance-broker-backed exchange; Finestel: — | B2COPY: MT4 / MT5 / cTrader / B2TRADER (forex-CFD brokers); copy.cc: spot, futures, DEX perps in one stack |
| Futures/perps copy (margin, leverage) | ◐ policy level only | ✅ Bybit (Smart Copy follows the master's leverage; Advanced sets its own); Bitget futures copy | — | copy.cc lists futures + DEX perps |
| Smart vs Advanced copy modes | ❌ | ✅ Bybit; Bitget "Smart Copy" | — | — |
| Per-order SL / TP / trailing / slippage | ◐ policy + UI (bps); venue-side enforcement unproven | ✅ Bybit: SL ratio, TP ratio, perp copy stop-loss, trailing stop · Bitget: SL/TP ratio, slippage limit, margin limit | — | — |
| Leader profit share with HWM + settlement | ◐ HWM config only; settlement not connected (F8) | ✅ core feature (details not re-checked) | ✅ Zignaly: success fee only above the high-water mark (a directory listing says 10%) | ✅ B2COPY: 6 fee types, performance fee with HWM, accrued-fee-debt tracking |
| Leaderboard, ranking, profile, compare | ✅ web · ❌ mobile | ✅ | — | ✅ B2COPY: verified masters, risk scores, AUM, follower counts |
| Lead-trader application / verification | ✅ (GAP-52) | — | — | B2COPY: "verified masters" |
| Risk views (exposure, concentration, correlation, risk score) | ◐ risk score orphaned (F2) | — | — | — |
| Demo / paper copy | ◐ paper adapter in engine; no demo onboarding | — | — | — |
| KYC / AML / KYT | ◐ generic adapters (F7) | — | n/a | copy.cc ✅ KYC + KYT services; B2COPY: broker-side |
| Custody / wallets / payments | ◐ NOWPayments + Stripe real; custody generic | — | Zignaly: funds held at the exchange (older description) | copy.cc ✅ WaaS (MPC + multi-tier custody), crypto processing 350+ currencies, fiat gateways |
| Mobile app | ◐ Flutter source only: no android/ios folders, no push (F12, F15) | ✅ | — | copy.cc ✅ native iOS/Android apps branded per client; B2COPY: embeddable widget (iframe) + SSO |
| Partner / IB / affiliate | ✅ (abuse queue ❌, GAP-98) | — | — | ✅ B2COPY IB/affiliate programme; copy.cc affiliate dashboard |
| Back-office, compliance, audit, kill-switch | ✅ strong (29 admin pages) | n/a | — | ✅ copy.cc: back-office + risk included |
| Enterprise security (RLS, SAML, Vault/KMS fetch, DR tooling) | ✅ unusually strong for the price band | — | — | B2COPY: AWS-hosted; copy.cc: "top security" (marketing) |
| Production proof (live traffic, uptime, SLA) | ❌ | ✅ | ✅ Zignaly: "650,000 users" per a directory listing | ✅ copy.cc: "40+ exchanges launched", 24/7 support + SLAs |
| Time to launch | self-deploy; weeks incl. the gaps | n/a | n/a | B2COPY: "5 business days" (one page) to "2–4 weeks" (another page); copy.cc: "live in 3–7 days" |
| Price signal | target $20k–$60k one-time source licence | n/a | Finestel white label listed "from $299" on G2; Zignaly: no subscription, success fee | copy.cc: source code one-time from $75,000, white label from $2,500 / month · B2COPY: SaaS, 30-day trial, price on request · low-end script listings: $800 (full-source crypto trading script) and $4,990 (PAMM/PMM self-hosted, 12-month licence) on Gumroad |

Where this repo wins: multi-tenant isolation (RLS), SAML SSO, kill-switch + dual-control withdrawals, back-office depth, SDKs, Rust gateway, 1,766 passing Python tests. Where it loses: venue breadth, proven live execution, vendor-specific compliance rails, mobile parity (and no store binary), production evidence.

---

## 4. What moves the price inside $20k–$60k (judgment, not a valuation)

Market bounds seen on 2026-10-08: self-hosted script listings at $800–$4,990 (feature claims, no diligence evidence) · managed white label from $2,500 / month · source-code licence from $75,000 for a broader exchange stack (copy.cc). A $20k–$60k ask sits between them: the buyer pays for depth (RLS multi-tenancy, SAML, compliance cases, dual control, tests) but discounts hard for anything unproven.

- **As-is:** low band (≈ $20–30k) to a technical buyer who accepts source-only, self-deploy and unproven live execution.
- **After Blocks A + B** (GAP-101–125: green API gates, browser E2E, staging proof, ≥ 3 venues live-tested on testnet, single order path): mid band (≈ $35–45k).
- **After Blocks C–F** (vendor KYC/AML/custody, profit-share settlement, mobile parity with a buildable app, load/DR/security evidence, IP pack, demo): upper band (≈ $50–60k).
- Above that needs traction (users, volume, revenue), not code.
- Comparables are different products (managed SaaS, exchange stacks, script listings). They bound the market; they do not price this repo.

---

## 5. Execution order

| Block | GAPs | Priority | Goal |
|---|---|---|---|
| 0 | CARRY-51–100 wire-in repairs (§6.B) | P0 | Make the tree match what the report claims. Do first: it is mostly editing existing files |
| A | GAP-101–111 | P0 | Release gates, integrity, CI, SBOM |
| B | GAP-112–125 | P0/P1 | Single order path, venues, perps, latency, load, copy modes |
| C | GAP-126–133 | P1 | Monetization, KYC/AML/custody vendors, notification channels |
| D | GAP-134–141 | P1 | Mobile parity, push, biometrics, test depth |
| E | GAP-142–147 | P1/P2 | DAST, DR drill, chaos, observability, provisioning, capacity |
| F | GAP-148–150 | P1 | IP pack, demo + data room, final honest regression |
| 6.A | CARRY-51–100 missing files | P1 | The 90 files the scanner still reports missing (fold into the block that touches the same area) |

---

## 6. CARRY-OVER: unfinished GAP-51–GAP-100 (nothing skipped)

Scanner on this tree (`node ops/gap-parity-scanner-51-100.js`): 106/199 criteria · 9 EXISTING_VERIFIED · 41 PARTIAL · 0 FAIL. EXISTING_VERIFIED in this tree: GAP-52, 53, 56, 58, 62, 78, 86, 87, 89. Everything else below is open.

Global rules for every item below:
- No orphan UI: each new component is mounted by a route or parent page AND linked from navigation (`apps/web/src/config/routes.tsx`, `apps/admin-web/src/components/sidebar.tsx`). GAP-106 enforces this.
- Each new service is provided in its owning `*.module.ts` and is called by something other than its own spec.
- Each new tenant table: model + additive migration + additive RLS migration (generator) + coverage JSON + idempotency composite; update `idempotency-tenant-scope.spec.ts` counts truthfully.
- `<STAMP>` = next free `YYYYMMDDHHMMSS` after the newest folder in `apps/api/prisma/migrations/` (newest today: `20261007140000_custom_domain_dns_challenge`).

### 6.A Missing files and the wiring each one needs (grouped per gap)

No missing files (wire-in edits only, see 6.B): GAP-51, 54, 55, 57, 59, 60, 63, 64, 66. Gaps with both missing files and wire-in edits: GAP-71, 95, 97.

#### GAP-61 — Copy budget and allocation-cap automation  ·  scanner 1/4  ·  weight 5

Unresolved criteria: `global-active-copy-budget-engine`, `customer-budget-surface`, `budget-enforcement-test`

```text
whitelabel-copytrade/
└── apps/
    ├── api/
    │   ├── prisma/
    │   │   ├── migrations/<STAMP>_copy_budget_reservation/
    │   │   │   └── migration.sql          # NEW — additive table migration + indexes + tenant-scoped idempotency composite; then run scripts/gen_part11_rls.py for the additive RLS migration and refresh prisma/rls/rls_coverage.json
    │   │   └── schema.prisma              # EDIT — add model CopyBudgetReservation: tenantId, userId, subscriptionId, currency, amount (decimal string), status RESERVED/RELEASED/CONSUMED, idempotencyKey
    │   └── src/modules/copy-trading/
    │       ├── copy-budget.service.ts     # NEW — CopyBudgetService: per-user/global currency-denominated copy budget; atomic reserve/release ledger before dispatch; counts in-flight + current exposure; fail-closed on unreadable state
    │       ├── copy-budget.spec.ts        # NEW — Jest: concurrent reservations never exceed ceiling, release on stop/fail, cross-tenant isolation, malformed policy denies
    │       ├── copy-execution.service.ts  # EDIT — reserve budget before dispatch, release on stop/fail/terminal state, pass currentExposure into the risk call
    │       └── copy-trading.module.ts     # EDIT — provide + export CopyBudgetService
    └── web/src/
        ├── app/copy-trading/budget/
        │   └── page.tsx                   # NEW — Next route mounting CopyBudgetSettings (add nav link)
        └── features/trading/
            └── copy-budget-settings.tsx   # NEW — CopyBudgetSettings panel: read/update ceiling, show reserved/used/available per currency, disabled-with-reason when unavailable
```

Done when: Budget ceiling is currency-denominated; reservation is atomic (no over-commit under concurrency) and released on stop/fail/fill; dispatch calls it with in-flight + current exposure. Do NOT sum allocationAmount/maxAllocation across modes: units differ (FIXED = base qty, PROPORTIONAL = ratio, PERCENTAGE_BALANCE = percent).

#### GAP-65 — Liquidation distance and margin health alerts  ·  scanner 1/3  ·  weight 5

Unresolved criteria: `customer-liquidation-alert-surface`, `notification-dispatch-and-test`

```text
whitelabel-copytrade/
└── apps/
    ├── api/src/modules/
    │   ├── notifications/
    │   │   ├── processors/
    │   │   │   └── liquidation-risk-notification.processor.ts  # NEW — BullMQ processor: dedupe + throttle liquidation-distance alerts -> in-app/email/push through the notification adapter
    │   │   └── notifications.module.ts                         # EDIT — register the liquidation-risk processor
    │   └── risk/
    │       └── liquidation-risk.spec.ts                        # NEW — Jest: threshold crossing, hysteresis, stale/absent venue data -> UNKNOWN and no fabricated alert
    └── web/src/features/trading/
        ├── copy-subscription-detail-page.tsx                   # EDIT — mount LiquidationRiskAlert on the subscription page
        └── liquidation-risk-alert.tsx                          # NEW — LiquidationRiskAlert: venue-reported liquidation distance / margin ratio with as-of; UNKNOWN when venue data is absent (never infer a price)
```

Done when: Alert only from venue-reported liquidation/margin evidence; absent evidence = UNKNOWN (never infer a price). Processor dedupes and throttles.

#### GAP-67 — Copy execution retry/failure timeline  ·  scanner 2/4  ·  weight 4

Unresolved criteria: `customer-timeline-surface`, `timeline-state-regression-assertions`

```text
whitelabel-copytrade/
└── apps/
    ├── api/src/modules/copy-trading/
    │   └── copy-execution-status.spec.ts       # NEW — Jest: legal/illegal transitions, retry count, failure reason, owner/tenant filter
    └── web/src/features/trading/
        ├── copy-execution-status-timeline.tsx  # NEW — CopyExecutionStatusTimeline: ordered status/retry transitions from persisted CopyExecution history, owner+tenant scoped
        └── copy-subscription-detail-page.tsx   # EDIT — mount CopyExecutionStatusTimeline in the execution section
```

Done when: Timeline reads persisted CopyExecution status history (owner + tenant filtered). Retry stays inside the existing idempotent, risk-gated pipeline; the UI never retries.

#### GAP-68 — OMS state machine visualization and recovery action  ·  scanner 2/4  ·  weight 4

Unresolved criteria: `operator-timeline-surface`, `lifecycle-regression-assertions`

```text
whitelabel-copytrade/
└── apps/
    ├── admin-web/src/
    │   ├── app/(console)/execution-incidents/
    │   │   └── page.tsx                  # EDIT — mount OrderStateTimeline (order-id deep link) + recovery action behind permission
    │   └── features/execution/
    │       └── order-state-timeline.tsx  # NEW — OrderStateTimeline: OMS lifecycle event visualization + permissioned recovery action that goes through OMS services only
    └── api/src/modules/oms/
        └── order-state-machine.spec.ts   # NEW — Jest: full transition matrix, illegal transitions rejected, recovery action authorization + audit
```

Done when: Operator timeline from OMS event history. Recovery goes only through OMS services with permission + audit.

#### GAP-69 — Exchange user-data stream health  ·  scanner 1/4  ·  weight 4

Unresolved criteria: `account-scoped-user-stream-api`, `operator-stream-health-surface`, `stream-lifecycle-regression-assertions`

```text
whitelabel-copytrade/
└── apps/
    ├── admin-web/src/
    │   ├── app/(console)/venues/
    │   │   └── page.tsx                        # NEW — console route hosting stream health, rate-limit health and venue status (shared by GAP-69/71/72); add sidebar entry
    │   └── features/execution/
    │       └── exchange-stream-health.tsx      # NEW — ExchangeStreamHealth admin table: heartbeat age, reconnect count, last error per account/venue
    └── api/src/modules/exchanges/
        ├── exchange-user-stream.controller.ts  # NEW — ExchangeUserStreamController: GET account-scoped stream health from ExchangeStreamSession; no session => UNKNOWN
        ├── exchange-user-stream.spec.ts        # NEW — Jest: lifecycle (connected/stale/closed), tenant scope, UNKNOWN default
        └── exchanges.module.ts                 # EDIT — register ExchangeUserStreamController
```

Done when: Health from persisted ExchangeStreamSession; no session = UNKNOWN, never healthy.

#### GAP-70 — Clock drift and venue timestamp safety  ·  scanner 1/4  ·  weight 4

Unresolved criteria: `bounded-clock-offset-service`, `execution-engine-monotonic-sync`, `clock-safety-regression-assertions`

```text
whitelabel-copytrade/
├── apps/api/src/modules/exchanges/
│   ├── exchange-connectivity.service.ts  # EDIT — feed real server-time samples into VenueClockService
│   ├── exchanges.module.ts               # EDIT — provide VenueClockService
│   ├── venue-clock.service.ts            # NEW — VenueClockService: bounded offset/drift from REAL venue server-time samples; denies signed requests beyond tolerance; no synthetic samples
│   └── venue-clock.spec.ts               # NEW — Jest: drift bounds, sample staleness, failure => deny
└── services/execution-engine/
    ├── app/exchanges/
    │   └── clock_sync.py                 # NEW — ClockSync: monotonic offset estimator (median of N RTT-corrected samples), safe timestamp, drift gauge; refuses to sign when drift > bound
    └── tests/
        └── test_clock_sync.py            # NEW — pytest: median/RTT-corrected offset, drift bound refuses to sign, no synthetic samples
```

Done when: Offset from real venue server-time samples with an explicit tolerance; the engine refuses to sign beyond the bound.

#### GAP-71 — Exchange rate-limit budget and backpressure  ·  scanner 1/4  ·  weight 5

Unresolved criteria: `operator-rate-limit-dashboard`

```text
whitelabel-copytrade/
└── apps/admin-web/src/
    ├── app/(console)/venues/
    │   └── page.tsx                        # NEW — mount ExchangeRateLimitHealth (route created in GAP-69)
    └── features/execution/
        └── exchange-rate-limit-health.tsx  # NEW — ExchangeRateLimitHealth: actual budget counters + backpressure per venue/tenant; no fabricated usage
```

Done when: Admin dashboard shows real counters only (wire-in edits are in 6.B).

#### GAP-72 — Venue maintenance and incident status surface  ·  scanner 1/5  ·  weight 4

Unresolved criteria: `normalized-venue-status-api`, `customer-venue-status-banner`, `admin-venue-status-console`, `status-failure-regression-assertions`

```text
whitelabel-copytrade/
└── apps/
    ├── admin-web/src/features/execution/
    │   └── venue-status-console.tsx    # NEW — VenueStatusConsole: per-venue evidence + audited manual override
    ├── api/src/modules/exchanges/
    │   ├── exchanges.module.ts         # EDIT — register VenueStatusController
    │   ├── venue-status.controller.ts  # NEW — VenueStatusController: normalized OPERATIONAL/DEGRADED/MAINTENANCE/UNKNOWN from maintenance + health + provider feed; stale feed => UNKNOWN
    │   └── venue-status.spec.ts        # NEW — Jest: outage, missing feed, flapping, tenant scope
    └── web/src/features/trading/
        ├── trading-state.tsx           # EDIT — render VenueStatusBanner for degraded/maintenance/unknown venues
        └── venue-status-banner.tsx     # NEW — VenueStatusBanner: customer banner for degraded/maintenance venues
```

Done when: Normalized status from maintenance + health + provider feed; missing/stale feed = UNKNOWN, not OPERATIONAL.

#### GAP-73 — Exchange account permission/capability health  ·  scanner 2/4  ·  weight 4

Unresolved criteria: `customer-account-health-surface`, `account-health-regression-assertions`

```text
whitelabel-copytrade/
└── apps/
    ├── api/src/modules/exchanges/
    │   └── account-capability-health.spec.ts  # NEW — Jest: freshness window, stale/unknown, no secret leakage
    └── web/src/
        ├── app/exchanges/[id]/
        │   └── page.tsx                       # EDIT — mount AccountCapabilityHealth
        └── features/exchanges/
            └── account-capability-health.tsx  # NEW — AccountCapabilityHealth: verified canTrade/canRead/canWithdraw with verifiedAt; stale => UNKNOWN; never shows credentials
```

Done when: Capability health carries verifiedAt; stale = UNKNOWN; never claim fresh verification without a provider probe.

#### GAP-74 — Exchange API-key rotation workflow  ·  scanner 2/4  ·  weight 5

Unresolved criteria: `customer-rotation-workflow`, `rotation-regression-assertions`

```text
whitelabel-copytrade/
└── apps/
    ├── api/src/modules/exchanges/
    │   └── api-key-rotation.spec.ts       # NEW — Jest: rotation validates provider permission, secret-store write/read verify, audit event, old key revoked, rollback on failure
    └── web/src/
        ├── app/exchanges/[id]/
        │   └── page.tsx                   # EDIT — mount ApiKeyRotationPage entry (behind step-up)
        └── features/exchanges/
            └── api-key-rotation-page.tsx  # NEW — ApiKeyRotationPage: rotate via existing POST /accounts/:id/rotate with provider validation + step-up (GAP-77); no parallel credential store
```

Done when: Reuse existing rotation endpoint + secret store; verify write/read; audit; protected by step-up (GAP-77).

#### GAP-75 — Read-only versus trade permission verification  ·  scanner 2/4  ·  weight 4

Unresolved criteria: `customer-permission-badge`, `permission-regression-assertions`

```text
whitelabel-copytrade/
└── apps/
    ├── api/src/modules/exchanges/
    │   └── permission-verification.spec.ts        # NEW — Jest: per-venue permission normalization, freshness, withdraw-enabled policy
    └── web/src/
        ├── app/exchanges/[id]/
        │   └── page.tsx                           # EDIT — mount PermissionVerificationBadge
        └── features/exchanges/
            └── permission-verification-badge.tsx  # NEW — PermissionVerificationBadge: READ_ONLY | TRADE_ENABLED | UNKNOWN from last verified permissions (not key labels); warns when withdraw is enabled
```

Done when: Badge derives from last verified permissions, not key labels; warns if withdraw permission is enabled.

#### GAP-76 — Withdrawal destination whitelist and policy  ·  scanner 1/4  ·  weight 5

Unresolved criteria: `tenant-user-destination-allowlist`, `customer-and-admin-destination-surfaces`, `destination-policy-regression-assertions`

```text
whitelabel-copytrade/
└── apps/
    ├── admin-web/src/
    │   ├── app/(console)/withdrawal-destinations/
    │   │   └── page.tsx                                  # NEW — console route mounting WithdrawalDestinationAudit
    │   └── features/funding/
    │       └── withdrawal-destination-audit.tsx          # NEW — WithdrawalDestinationAudit: reviewer queue + immutable audit trail
    ├── api/
    │   ├── prisma/
    │   │   ├── migrations/<STAMP>_withdrawal_destination/
    │   │   │   └── migration.sql                         # NEW — additive table migration + indexes + tenant-scoped idempotency composite; then run scripts/gen_part11_rls.py for the additive RLS migration and refresh prisma/rls/rls_coverage.json
    │   │   └── schema.prisma                             # EDIT — add model WithdrawalDestination: tenantId, userId, network, address, label, status PENDING/VERIFIED/REVOKED, verifiedAt, cooldownUntil
    │   └── src/modules/custody/
    │       ├── custody.module.ts                         # EDIT — provide WithdrawalDestinationPolicyService
    │       ├── withdrawal-destination-policy.service.ts  # NEW — WithdrawalDestinationPolicyService: tenant+user allowlist, network validation, cooldown, ownership attestation; withdrawal authorization fails closed until VERIFIED
    │       ├── withdrawal-destination-policy.spec.ts     # NEW — Jest: unverified destination blocks withdrawal, cooldown, network mismatch, cross-tenant
    │       └── withdrawal-orchestration.service.ts       # EDIT — deny authorization unless the destination is VERIFIED and past cooldown
    └── web/src/
        ├── app/funding/destinations/
        │   └── page.tsx                                  # NEW — Next route mounting WithdrawalDestinationManager
        └── features/funding/
            └── withdrawal-destination-manager.tsx        # NEW — WithdrawalDestinationManager: add/confirm/remove destinations behind step-up
```

Done when: Allowlist per tenant + user, network-specific validation, cooldown, auditable confirmation; withdrawal authorization fails closed until VERIFIED.

#### GAP-77 — Step-up authentication for sensitive operations  ·  scanner 1/4  ·  weight 5

Unresolved criteria: `action-bound-step-up-service`, `step-up-api-and-dialog`, `step-up-replay-regression-assertions`

```text
whitelabel-copytrade/
└── apps/
    ├── api/src/modules/
    │   ├── auth/
    │   │   ├── auth.module.ts              # EDIT — register StepUpAuthService + controller
    │   │   ├── step-up-auth.controller.ts  # NEW — StepUpAuthController: POST /auth/step-up/challenge and /verify; permission-decorated
    │   │   ├── step-up-auth.service.ts     # NEW — StepUpAuthService: action-bound TOTP challenge (action hash + expiry + single use) with audit; no reusable bearer proof
    │   │   └── step-up-auth.spec.ts        # NEW — Jest: replay rejected, wrong action rejected, expiry, lockout
    │   ├── custody/
    │   │   └── custody.controller.ts       # EDIT — require a valid step-up proof on withdrawal request
    │   └── exchanges/
    │       └── exchanges.controller.ts     # EDIT — require a valid step-up proof on credential rotation
    └── web/src/features/security/
        └── step-up-auth-dialog.tsx         # NEW — StepUpAuthDialog: reusable wrapper for sensitive actions (withdraw, rotate key, change destination)
```

Done when: Action-bound, single-use, expiring proof; replay and cross-action reuse rejected; wired into withdrawals, key rotation, destination changes.

#### GAP-79 — Suspicious-login and device-anomaly alerts  ·  scanner 1/4  ·  weight 4

Unresolved criteria: `customer-notification-dispatch`, `customer-login-alert-surface`, `login-alert-regression-assertions`

```text
whitelabel-copytrade/
└── apps/
    ├── api/src/modules/
    │   ├── auth/
    │   │   └── login-anomaly.spec.ts                        # NEW — Jest: detector -> notification mapping, dedupe, tenant scope
    │   ├── notifications/
    │   │   ├── processors/
    │   │   │   └── login-anomaly-notification.processor.ts  # NEW — Processor: security events from the suspicious-login detector -> customer notification (no invented geo/device data)
    │   │   └── notifications.module.ts                      # EDIT — register the login-anomaly processor
    │   └── security/
    │       └── suspicious-login.detector.ts                 # EDIT — emit a security event consumed by the new processor
    └── web/src/
        ├── app/security/login-alerts/
        │   └── page.tsx                                     # NEW — Next route mounting LoginAlerts
        └── features/security/
            └── login-alerts.tsx                             # NEW — LoginAlerts: recent anomalous logins with "this was me" / "secure my account" actions
```

Done when: Alerts come only from recorded security events (no invented location/device); dedupe; customer surface.

#### GAP-80 — Account recovery and backup security controls  ·  scanner 1/4  ·  weight 5

Unresolved criteria: `single-use-recovery-token-workflow`, `customer-recovery-surface-and-api`, `recovery-security-regression-assertions`

```text
whitelabel-copytrade/
└── apps/
    ├── api/
    │   ├── prisma/
    │   │   ├── migrations/<STAMP>_account_recovery_token/
    │   │   │   └── migration.sql               # NEW — additive table migration + indexes + tenant-scoped idempotency composite; then run scripts/gen_part11_rls.py for the additive RLS migration and refresh prisma/rls/rls_coverage.json
    │   │   └── schema.prisma                   # EDIT — add model AccountRecoveryToken: tenantId, userId, tokenHash, expiresAt, consumedAt, requestIpHash
    │   └── src/modules/auth/
    │       ├── account-recovery.controller.ts  # NEW — AccountRecoveryController: request/verify/complete (public, throttled, no user enumeration)
    │       ├── account-recovery.service.ts     # NEW — AccountRecoveryService: hashed single-use tokens, expiry, rate limit, MFA-reset policy; success only after token consumption
    │       ├── account-recovery.spec.ts        # NEW — Jest: token single-use, expiry, enumeration-safe responses, brute-force throttle
    │       └── auth.module.ts                  # EDIT — register AccountRecoveryService + controller
    └── web/src/
        ├── app/recover/
        │   └── page.tsx                        # NEW — public Next route mounting AccountRecoveryPage
        └── features/security/
            └── account-recovery-page.tsx       # NEW — AccountRecoveryPage: request -> verify -> reset flow UI
```

Done when: Single-use hashed tokens, expiry, throttling, enumeration-safe responses; success only after token consumption; delivery needs a configured provider.

#### GAP-81 — Full audit export with filters  ·  scanner 2/4  ·  weight 5

Unresolved criteria: `operator-export-panel`, `export-authorization-and-integrity-tests`

```text
whitelabel-copytrade/
└── apps/
    ├── admin-web/src/
    │   ├── app/(console)/audit-logs/
    │   │   └── page.tsx                # EDIT — mount AuditExportPanel
    │   └── features/audit/
    │       └── audit-export-panel.tsx  # NEW — AuditExportPanel: filters (actor/action/time/tenant), request export, show integrity hash
    └── api/src/modules/audit/
        └── audit-export.spec.ts        # NEW — Jest: authorization, tenant scoping, filter correctness, hash integrity
```

Done when: Filtered export panel; authorization, tenant/time-range and integrity-hash tests.

#### GAP-82 — Data retention and privacy control center  ·  scanner 3/4  ·  weight 5

Unresolved criteria: `admin-retention-control-center`

```text
whitelabel-copytrade/
└── apps/admin-web/src/
    ├── app/(console)/data-retention/
    │   └── page.tsx                    # NEW — console route mounting DataRetentionConsole
    └── features/privacy/
        └── data-retention-console.tsx  # NEW — DataRetentionConsole: policies, legal holds, purge candidates, dry-run, approvals over the existing retention engine
```

Done when: Console over the existing retention engine + legal holds; dry-run before purge; legal-hold precedence stays tested.

#### GAP-83 — Customer data access and export request workflow  ·  scanner 2/4  ·  weight 5

Unresolved criteria: `actionable-customer-request-ui`, `data-access-security-regression-assertions`

```text
whitelabel-copytrade/
└── apps/
    ├── api/src/modules/privacy/
    │   └── data-access-request.spec.ts  # NEW — Jest: eligibility, identity verification, legal-hold precedence, tenant scope
    └── web/src/
        ├── app/security/data-export/
        │   └── page.tsx                 # NEW — Next route mounting DataExportPage
        └── features/security/
            └── data-export-page.tsx     # NEW — DataExportPage: request my data / deletion, identity-verification step, status tracking
```

Done when: Actionable customer request UI; identity verification; eligibility and legal-hold precedence tests.

#### GAP-84 — Public fee schedule and pricing transparency  ·  scanner 1/4  ·  weight 5

Unresolved criteria: `effective-public-fee-schedule-api`, `customer-fee-schedule-surface`, `fee-schedule-regression-assertions`

```text
whitelabel-copytrade/
└── apps/
    ├── api/src/modules/billing/
    │   ├── billing.module.ts           # EDIT — provide FeeScheduleService + controller
    │   ├── fee-schedule.controller.ts  # NEW — FeeScheduleController: public GET /billing/fee-schedule (cacheable, tenant-resolved)
    │   ├── fee-schedule.service.ts     # NEW — FeeScheduleService: effective-dated public fee schedule from FeePolicyService; business-approved rates only, nothing hardcoded
    │   └── fee-schedule.spec.ts        # NEW — Jest: effective-date selection, no hardcoded rates, tenant override
    └── web/src/
        ├── app/fees/
        │   └── page.tsx                # NEW — public Next route mounting FeeSchedulePage
        └── features/billing/
            └── fee-schedule-page.tsx   # NEW — FeeSchedulePage: transparent fee table with effective dates, currency/region
```

Done when: Schedule comes from FeePolicyService effective-dated rows; no hardcoded rates; business-approved values only.

#### GAP-85 — Profit-share and fee statement calculation  ·  scanner 1/4  ·  weight 5

Unresolved criteria: `profit-share-from-posted-ledger`, `customer-profit-share-statement-surface`, `statement-calculation-regression-assertions`

```text
whitelabel-copytrade/
└── apps/
    ├── api/src/modules/billing/
    │   ├── profit-share-statement.service.ts    # NEW — ProfitShareStatementService: read model from POSTED fee ledger/accruals only (never unrealized PnL); exact decimals; HWM carry-forward
    │   └── profit-share-statement.spec.ts       # NEW — Jest: exact calculation, HWM carry-forward, unposted excluded, currency buckets
    └── web/src/
        ├── app/statements/profit-share/
        │   └── page.tsx                         # NEW — Next route mounting ProfitShareStatementPage
        └── features/billing/
            └── profit-share-statement-page.tsx  # NEW — ProfitShareStatementPage: statement list/detail with CSV/PDF export
```

Done when: Statement from POSTED ledger/accruals only; unrealized PnL is never payable; exact decimals; HWM carry-forward.

#### GAP-88 — White-label tenant branding and theme configuration  ·  scanner 1/4  ·  weight 5

Unresolved criteria: `admin-brand-editor`, `customer-runtime-theme-provider`, `tenant-isolation-regression-assertions`

```text
whitelabel-copytrade/
└── apps/
    ├── admin-web/src/
    │   ├── app/(console)/branding/
    │   │   └── page.tsx                       # EDIT — replace the read-only notice with TenantBrandingEditor
    │   └── features/branding/
    │       └── tenant-branding-editor.tsx     # NEW — TenantBrandingEditor: logo/colors/fonts/legal names with sanitization preview + audit; writes via existing TenantBrandingService
    ├── api/src/modules/tenants/
    │   └── tenant-branding.spec.ts            # NEW — Jest: sanitization (no CSS/JS injection), tenant isolation, audit
    └── web/src/
        ├── app/
        │   └── layout.tsx                     # EDIT — wrap the app in RuntimeBrandingProvider
        └── features/branding/
            └── runtime-branding-provider.tsx  # NEW — RuntimeBrandingProvider: tenant public config -> CSS variables/theme/logo with safe defaults
```

Done when: Editor writes through the existing sanitized, audited TenantBrandingService; provider reads public tenant config; isolation spec.

#### GAP-90 — Tenant feature-flag and entitlement admin console  ·  scanner 1/3  ·  weight 4

Unresolved criteria: `dedicated-admin-flag-route-and-surface`, `flag-authorization-regression-assertions`

```text
whitelabel-copytrade/
└── apps/
    ├── admin-web/src/
    │   ├── app/(console)/feature-flags/
    │   │   └── page.tsx                  # NEW — Next route: tenant feature-flag console (server component, permission gated)
    │   └── features/settings/
    │       └── tenant-feature-flags.tsx  # NEW — TenantFeatureFlags: list/toggle flags; plan entitlements stay authoritative (locked, read-only)
    └── api/src/modules/tenants/
        └── tenant-feature-flag.spec.ts   # NEW — Jest: authorization, entitlement precedence, audit
```

Done when: Console uses the existing FeatureFlagsService; plan entitlements stay authoritative; authorization spec.

#### GAP-91 — Localization, currency, and date-time preferences  ·  scanner 1/4  ·  weight 3

Unresolved criteria: `persisted-tenant-user-preferences-api`, `customer-locale-and-exact-financial-formatting`, `preference-isolation-regression-assertions`

```text
whitelabel-copytrade/
└── apps/
    ├── api/src/modules/users/
    │   ├── user-preferences.service.ts         # NEW — UserPreferencesService: persisted locale/timezone/preferred currency on existing UserProfile (tenant+user scoped)
    │   ├── user-preferences.spec.ts            # NEW — Jest: isolation, validation against tenant-supported locales/currencies
    │   └── users.module.ts                     # EDIT — provide UserPreferencesService (+ controller route)
    └── web/src/
        ├── app/settings/localization/
        │   └── page.tsx                        # NEW — Next route mounting LocalizationSettingsPage
        ├── features/settings/
        │   └── localization-settings-page.tsx  # NEW — LocalizationSettingsPage: language, timezone, display currency (display only; no client-side FX)
        └── lib/i18n/
            └── locale-number-format.ts         # NEW — Exact decimal-string formatter by locale (no floats) + date/time helpers
```

Done when: Persist on existing UserProfile fields; tenant-supported locales/currencies only; formatting uses exact decimal strings; no client FX.

#### GAP-92 — Accessibility compliance surface  ·  scanner 1/3  ·  weight 4

Unresolved criteria: `route-and-focus-announcement-helper`, `web-and-admin-accessibility-smoke-tests`

```text
whitelabel-copytrade/
└── apps/
    ├── admin-web/src/
    │   ├── app/
    │   │   └── layout.tsx                    # EDIT — mount FocusAnnouncer
    │   └── tests/
    │       └── accessibility-smoke.test.tsx  # NEW — jest-axe smoke across console pages
    └── web/src/
        ├── app/
        │   └── layout.tsx                    # EDIT — mount FocusAnnouncer
        ├── components/ui/
        │   └── focus-announcer.tsx           # NEW — FocusAnnouncer: route-change focus management + aria-live announcements
        └── tests/
            └── accessibility-smoke.test.tsx  # NEW — jest-axe smoke across key customer pages
```

Done when: Focus/route announcements + jest-axe smoke for web and admin (manual WCAG audit stays separate).

#### GAP-93 — Marketplace SEO metadata and indexing controls  ·  scanner 1/4  ·  weight 4

Unresolved criteria: `public-marketplace-route-metadata`, `crawler-policy-and-sitemap`, `seo-regression-assertions`

```text
whitelabel-copytrade/
└── apps/web/src/
    ├── app/
    │   ├── strategies/
    │   │   └── layout.tsx                  # NEW — generateMetadata for public strategies
    │   ├── traders/
    │   │   └── layout.tsx                  # NEW — generateMetadata for the public trader marketplace (canonical, OG); noindex for private sub-routes
    │   ├── robots.ts                       # NEW — Next MetadataRoute.Robots: allow public marketplace only; disallow authenticated and tenant-private routes
    │   └── sitemap.ts                      # NEW — Next MetadataRoute.Sitemap from public traders/strategies (tenant-aware)
    └── tests/
        └── seo-public-marketplace.test.ts  # NEW — Jest: robots/sitemap exclude private routes; metadata canonical
```

Done when: Only the public marketplace is indexable. Also resolves the failing reference-integrity test (F11).

#### GAP-94 — Shareable public trader and strategy links  ·  scanner 1/4  ·  weight 4

Unresolved criteria: `signed-expiring-public-share-token`, `customer-share-and-metadata-surface`, `share-security-regression-assertions`

```text
whitelabel-copytrade/
└── apps/
    ├── api/
    │   ├── prisma/
    │   │   ├── migrations/<STAMP>_public_share_revocation/
    │   │   │   └── migration.sql         # NEW — additive table migration + indexes + tenant-scoped idempotency composite; then run scripts/gen_part11_rls.py for the additive RLS migration and refresh prisma/rls/rls_coverage.json
    │   │   └── schema.prisma             # EDIT — add model PublicShareRevocation: tenantId, tokenId, revokedAt, revokedBy
    │   └── src/modules/copy-trading/
    │       ├── copy-trading.module.ts    # EDIT — provide PublicShareService
    │       ├── public-share.service.ts   # NEW — PublicShareService: signed expiring read-only share tokens (HMAC), revocation, fail closed without signing key, no private fields
    │       └── public-share.spec.ts      # NEW — Jest: expiry, tamper, revocation, no private fields
    └── web/src/
        ├── app/share/[token]/
        │   └── page.tsx                  # NEW — public read-only Next route resolving a signed token
        └── features/trading/
            ├── public-share-metadata.ts  # NEW — OpenGraph/Twitter metadata builder for shared trader/strategy pages
            ├── share-trader-dialog.tsx   # NEW — ShareTraderDialog: create / copy / revoke public link
            └── trader-detail-page.tsx    # EDIT — mount ShareTraderDialog (owner only)
```

Done when: Signed, expiring, revocable read-only tokens; fail closed without a signing key; no account/execution secrets in the payload.

#### GAP-95 — Risk disclosure and consent versioning  ·  scanner 1/4  ·  weight 5

Unresolved criteria: `customer-risk-disclosure-consent-ui`

```text
whitelabel-copytrade/
└── apps/web/src/features/
    ├── compliance/
    │   └── risk-disclosure-consent.tsx  # NEW — RiskDisclosureConsent: versioned disclosure acceptance before LIVE copy; records document version + hash
    └── trading/
        └── copy-settings-page.tsx       # EDIT — require RiskDisclosureConsent before enabling LIVE mode
```

Done when: Risk-disclosure consent UI stores document version + hash (service wire-in edits are in 6.B).

#### GAP-96 — Terms and policy acceptance versioning  ·  scanner 1/4  ·  weight 5

Unresolved criteria: `action-bound-policy-acceptance-service`, `explicit-customer-policy-acceptance-ui`, `policy-acceptance-regression-assertions`

```text
whitelabel-copytrade/
└── apps/
    ├── api/src/modules/compliance/
    │   ├── policy-acceptance.service.ts    # NEW — PolicyAcceptanceService: action-bound terms/privacy acceptance stored on ConsentRecord with version + hash
    │   └── policy-acceptance.spec.ts       # NEW — Jest: version bump forces re-accept, audit, tenant scope
    └── web/src/
        ├── app/legal/accept/
        │   └── page.tsx                    # NEW — Next route mounting PolicyAcceptancePage
        └── features/legal/
            └── policy-acceptance-page.tsx  # NEW — PolicyAcceptancePage: explicit accept action (a page view is not acceptance)
```

Done when: Acceptance is an explicit action recorded with version + hash; a page view is not acceptance.

#### GAP-97 — Affiliate attribution integrity  ·  scanner 1/4  ·  weight 5

Unresolved criteria: `partner-attribution-reporting-surface`

```text
whitelabel-copytrade/
└── apps/web/src/features/partner/
    ├── affiliate-attribution-panel.tsx  # NEW — AffiliateAttributionPanel: immutable attribution report for the partner
    └── partner-dashboard.tsx            # EDIT — mount AffiliateAttributionPanel
```

Done when: Partner-facing immutable attribution panel (engine wire-in edits are in 6.B).

#### GAP-98 — Referral abuse and self-referral controls  ·  scanner 1/3  ·  weight 5

Unresolved criteria: `deterministic-abuse-rules-and-review-queue`, `abuse-rules-regression-assertions`

```text
whitelabel-copytrade/
└── apps/
    ├── admin-web/src/
    │   ├── app/(console)/referral-abuse/
    │   │   └── page.tsx                   # NEW — console route mounting ReferralAbuseQueue
    │   └── features/partners/
    │       └── referral-abuse-queue.tsx   # NEW — ReferralAbuseQueue: reviewer decisions with rationale + audit
    └── api/
        ├── prisma/
        │   ├── migrations/<STAMP>_referral_abuse_flag/
        │   │   └── migration.sql          # NEW — additive table migration + indexes + tenant-scoped idempotency composite; then run scripts/gen_part11_rls.py for the additive RLS migration and refresh prisma/rls/rls_coverage.json
        │   └── schema.prisma              # EDIT — add model ReferralAbuseFlag: tenantId, partnerId, referralId, rule, score, status OPEN/DISMISSED/CONFIRMED, reviewedBy, rationale
        └── src/modules/partner/
            ├── partner.module.ts          # EDIT — provide ReferralAbuseService
            ├── referral-abuse.service.ts  # NEW — ReferralAbuseService: deterministic rules (self-referral, velocity, shared device/IP/payment) producing review flags, not conclusions
            └── referral-abuse.spec.ts     # NEW — Jest: rule matrix, thresholds, no auto-ban
```

Done when: Rules produce review signals, not fraud conclusions; thresholds approved by the business; queue decisions audited.

#### GAP-99 — Business and operator KPI dashboard  ·  scanner 1/4  ·  weight 5

Unresolved criteria: `unified-copy-trading-business-kpi-service`, `authorized-admin-kpi-surface`, `currency-and-freshness-regression-assertions`

```text
whitelabel-copytrade/
└── apps/
    ├── admin-web/src/
    │   ├── app/(console)/kpi/
    │   │   └── page.tsx                    # NEW — console route mounting BusinessKpiDashboard
    │   └── features/analytics/
    │       └── business-kpi-dashboard.tsx  # NEW — BusinessKpiDashboard: KPI cards + freshness badges
    └── api/src/
        ├── modules/analytics/
        │   ├── analytics.module.ts         # NEW — AnalyticsModule: provides BusinessKpiService + controller
        │   ├── business-kpi.controller.ts  # NEW — BusinessKpiController: admin-authorized KPI endpoints
        │   ├── business-kpi.service.ts     # NEW — BusinessKpiService: MRR/ARR, copiers, AUM, leader count, fee revenue; separate currency buckets; freshness stamps
        │   └── business-kpi.spec.ts        # NEW — Jest: currency buckets, stale marking, tenant scope
        └── app.module.ts                   # EDIT — import AnalyticsModule
```

Done when: Metrics defined in code with currency buckets + freshness; admin-only; no FX guessing.

#### GAP-100 — Commercial readiness and buyer handover evidence  ·  scanner 3/4  ·  weight 5

Unresolved criteria: `readiness-admin-dashboard-and-api`

```text
whitelabel-copytrade/
└── apps/
    ├── admin-web/src/
    │   ├── app/(console)/readiness/
    │   │   └── page.tsx                            # NEW — console route mounting CommercialReadinessDashboard
    │   └── features/analytics/
    │       └── commercial-readiness-dashboard.tsx  # NEW — CommercialReadinessDashboard: readiness rules, evidence, prerequisites
    └── api/src/modules/ops/
        └── commercial-readiness.service.ts         # NEW — CommercialReadinessService: machine-readable readiness rules (scanner output + live health probes) with buyer-facing limits/prerequisites
```

Done when: Readiness rules are machine-readable and consistent with the tree (see GAP-106 drift check); live health probes; shows limits and prerequisites.

### 6.B Wire-in repairs (files EXIST, the claimed integration is MISSING in this tree)

These are the 18 scanner entries (14 distinct files) where the report says done but the tree disagrees. Do these FIRST (Block 0). Each edit must flip its scanner criterion key and ship with a test that fails if the call is removed.

```text
whitelabel-copytrade/
└── apps/
    ├── api/src/modules/
    │   ├── copy-trading/
    │   │   ├── allocation-rebalance.controller.ts  # EDIT — GAP-60 `persisted-portfolio-valuation-input`: load owner-scoped reconciled valuations instead of client-supplied current values; keep `executable:false`; missing price => null target/delta
    │   │   ├── copy-execution.service.ts           # EDIT — GAP-66 `no-substituted-follower-fill-price`: when follower fill evidence is missing record slippage as null; never substitute the leader price
    │   │   ├── copy-policy.service.ts              # EDIT — GAP-63 `policy-intersection-and-validation`: effective policy = strategy allow/deny INTERSECT follower allow/deny, normalized symbols, malformed policy fails closed. GAP-66 `exact-adverse-slippage-enforcement`: exact-decimal adverse slippage check before dispatch
    │   │   ├── copy-trading.module.ts              # EDIT — import RiskModule; provide PerformanceCalculationService (GAP-55)
    │   │   ├── trader-performance.service.ts       # EDIT — GAP-55 `canonical-calculation-integration`: replace inline math with PerformanceCalculationService (provide it in the module); incomplete periods return null/UNAVAILABLE
    │   │   └── trader-profile.service.ts           # EDIT — GAP-51 `verified-aum-or-activity-provenance`: AUM/activity carry {source, asOf, coverage}, derived from persisted ACTIVE-subscription valuations; otherwise UNAVAILABLE. GAP-57 `canonical-data-api-integration`: inject TraderRiskScoreService and serialize score + per-factor freshness (today the service is an orphan)
    │   ├── exchanges/
    │   │   ├── exchange-rate-limit.service.ts      # EDIT — GAP-71 `atomic-tenant-budget-reservation`: atomic weighted reservation in Redis (Lua/script), per tenant+venue+account; fail closed if Redis unavailable
    │   │   └── exchange-routing.service.ts         # EDIT — GAP-71 `routing-denies-unavailable-budget`: deny the route (typed error, no silent fallback) when no budget is available
    │   ├── governance/
    │   │   └── consent.service.ts                  # EDIT — GAP-95 `versioned-durable-consent-ledger-and-audit` + `persistence-failure-does-not-report-success`: DELETE the in-memory fallback; durable tenant-scoped write; persistence failure throws; audit event on capture/withdraw
    │   ├── partners/
    │   │   └── partner-attribution.service.ts      # EDIT — GAP-97 `durable-idempotent-attribution-engine` + `fail-closed-storage-and-conflict-check`: tenant-scoped idempotent upsert, conflicting attribution rejected, storage failure fails closed
    │   ├── risk-management/
    │   │   ├── concentration-risk.service.ts       # EDIT — GAP-59 `measured-or-stale-risk-evidence`: include as-of + freshness verdict (`marketDataMaxAgeMs`); stale/unknown withheld, never zero-filled
    │   │   └── risk.controller.ts                  # EDIT — GAP-64 `service-connected-to-authoritative-risk-api`: expose leverage/margin-mode policy read+update through the authoritative risk controller, bounded by server ceilings
    │   └── risk/
    │       └── risk.module.ts                      # EDIT — export TraderRiskScoreService (GAP-57) so CopyTradingModule can inject it; add a wiring test that fails if it is removed
    └── web/src/features/trading/
        ├── copy-settings-page.tsx                  # EDIT — GAP-63 `customer-settings-and-contract-link`: allow/deny symbol inputs mapped to the server contract + effective-policy preview
        ├── trader-ranking-controls.tsx             # EDIT — GAP-54 `explicit-timeframe-control`: 7d/30d/90d selector bound to the `periodReturn` sort + API timeframe param; selected methodology shown
        └── traders-page.tsx                        # EDIT — GAP-54: pass timeframe through query state; test asserts request params
```

Navigation wiring for every new route above:

```text
whitelabel-copytrade/
└── apps/
    ├── admin-web/src/components/
    │   └── sidebar.tsx  # EDIT — add a nav entry for each new console route (venues, withdrawal-destinations, data-retention, feature-flags, referral-abuse, kpi, readiness)
    └── web/src/config/
        └── routes.tsx   # EDIT — add a nav/route entry for each new customer route (budget, destinations, login-alerts, recover, data-export, fees, statements/profit-share, settings/localization, legal/accept, share/[token])
```

---

## 7. NEW GAPs: GAP-101-GAP-150

Priority: P0 = blocks a credible sale · P1 = expected by a diligent buyer · P2 = differentiator. Each gap: what is wrong now -> tree with `#` comments -> done-when. `<STAMP>` as defined in section 6. NEW / EDIT / DELETE tags were computed against the audited tree.

### 7.0 Register

| ID | Pri | Gap | Evidence now |
|---|---|---|---|
| GAP-101 | P0 | API typecheck green | (R) `tsc` OOM at 1.15 GB heap; zero diagnostics ever produced |
| GAP-102 | P0 | Nest production build emits dist | (R) build OOM; `apps/api/dist` absent |
| GAP-103 | P0 | API lint zero-warning gate | (R) 0 errors / 6,437 warnings against `--max-warnings=0` |
| GAP-104 | P0 | Real browser E2E | No `@playwright/test` dependency; "E2E" = `renderToStaticMarkup` Jest tests |
| GAP-105 | P0 | Staging proof | (R) migrations never applied outside the workspace; RLS enable is manual. Scaffolding exists (`scripts/staging/*`, `infrastructure/staging/docker-compose.staging.yml`, `scripts/smoke-test.sh`) but no recorded run |
| GAP-106 | P0 | Wiring-integrity scanner + report-vs-tree drift check | F1-F3: orphans and drift pass every current scanner |
| GAP-107 | P0 | Remove duplicate / shim implementations | F4-F5: shims and parallel copies |
| GAP-108 | P0 | Reference-integrity test green | F11: 1 failing test in 1,767 |
| GAP-109 | P1 | Env surface rationalized | `.env.example` is 73 KB / 426 variables |
| GAP-110 | P0 | CI placement + real security gates | F10: nested workflows never run; security.yml promises scans it does not perform |
| GAP-111 | P1 | SBOM + license gate + manifest | No SBOM; (R) manifest regeneration deferred |
| GAP-112 | P0 | Single canonical order path | F6: two placement stacks (NestJS adapters vs Python engine); okx adapter spot-only with no-op symbol replace |
| GAP-113 | P0 | Bybit V5 live execution (spot + linear) | read-side only (`venues/bybit.provider.ts`: "places no orders") |
| GAP-114 | P0 | OKX V5 live execution | read-side + spot-only `tdMode:cash` adapter |
| GAP-115 | P1 | Kraken spot live execution | read-side only |
| GAP-116 | P1 | Coinbase Advanced Trade live execution | read-side only |
| GAP-117 | P0 | Bitget (new venue; major copy-trading venue) | absent |
| GAP-118 | P2 | KuCoin (new venue) | absent |
| GAP-119 | P0 | Perps semantics in the venue-agnostic order model | policy-level only; adapters spot-only |
| GAP-120 | P0 | Venue contract harness + testnet smoke evidence | only the opt-in `scripts/live_execution_smoke_test.py` exists; no per-venue evidence |
| GAP-121 | P0 | Leader signal ingestion by stream (not 5 s DB polling) | F13: `COPY_LEADER_INGESTION_INTERVAL_MS` default 5000, stale cutoff 30000 |
| GAP-122 | P1 | Fan-out load evidence | F13: no load tests |
| GAP-123 | P1 | Smart vs Advanced copy modes (Bybit-style) | 3 sizing modes only (PROPORTIONAL, FIXED, PERCENTAGE_BALANCE) |
| GAP-124 | P1 | Venue-side TP / SL / trailing | policy bps + UI only; no evidence the venue enforces them |
| GAP-125 | P1 | Demo (paper) copy onboarding | paper adapter exists in the engine; no customer onboarding |
| GAP-126 | P0 | Leader profit-share settlement (HWM -> accrual -> ledger -> payout) | F8: `leader-fee.service.ts` creates no accruals, no ledger entries, no payouts |
| GAP-127 | P1 | Follower statement export (CSV + PDF) | none |
| GAP-128 | P1 | Sumsub KYC adapter | F7: generic `KYC_PROVIDER_BASE_URL/v1/verifications` |
| GAP-129 | P2 | Persona KYC adapter | F7: generic adapter only |
| GAP-130 | P1 | Chainalysis KYT adapter | F7: generic AML adapter |
| GAP-131 | P1 | Fireblocks custody adapter | F7: generic custody adapter |
| GAP-132 | P1 | Notification vendor adapters (email / SMS / push) | generic `notification.adapter.ts` |
| GAP-133 | P2 | Telegram + Discord alert channels | none (verified: no telegram/discord code in notifications) |
| GAP-134 | P1 | Mobile trader discovery + leaderboard + compare | absent (only strategies_screen.dart) |
| GAP-135 | P1 | Mobile trader profile + performance + risk | absent |
| GAP-136 | P1 | Mobile follow wizard + copy settings | one `copy_trading_screen.dart` |
| GAP-137 | P1 | Mobile copied positions / orders + stop-copy | absent |
| GAP-138 | P1 | Mobile push notifications + device registration | F12: no firebase_messaging |
| GAP-139 | P2 | Mobile biometric app lock | F12: no local_auth |
| GAP-140 | P0 | Mobile platform scaffolding + build CI + test depth | F15: no `android/` or `ios/` folders; CI = analyze + test; 3 test files |
| GAP-141 | P1 | Admin-web test depth | 3 test files for 29 admin pages |
| GAP-142 | P1 | DAST baseline | none |
| GAP-143 | P1 | DR drill executed | tooling only (`dr-rehearsal.mjs`, `dr-manifest.mjs`); no recorded drill |
| GAP-144 | P1 | Failure-injection suite | (R) Redis failure / rate limits / DB failover not exercised |
| GAP-145 | P2 | Dashboards-as-code + alert validation | Prometheus rules (`wlct.rules.yml`) + `metrics-catalog.json` exist; no Grafana dashboards |
| GAP-146 | P1 | One-command tenant provisioning + demo tenant | `prisma/seed.ts` demo data only |
| GAP-147 | P2 | Capacity + cost-per-tenant model | none |
| GAP-148 | P1 | IP / licence pack | proprietary LICENSE in the owner name; no assignment pack |
| GAP-149 | P1 | Demo environment + data room | none |
| GAP-150 | P0 | Final honest regression + report | F1-F3: scanners are static; reports drift |

### 7.A Block A: Release gates, integrity, CI (GAP-101-111)

#### GAP-101 - API typecheck green  ·  P0

Now: (R) `tsc` OOM at 1.15 GB heap; zero diagnostics ever produced

```text
White-Label01-Crypto-Copy-Trading-App/
├── .github/workflows/
│   └── ci.yml                       # EDIT — add job api-typecheck (ubuntu-latest, NODE_OPTIONS=--max-old-space-size=6144, npm run typecheck:ci --workspace=@wlct/api); mark as required check
└── whitelabel-copytrade/
    ├── apps/api/
    │   ├── package.json             # EDIT — scripts: add typecheck:ci (tsc -p tsconfig.typecheck.json --noEmit); keep existing scripts
    │   ├── tsconfig.json            # EDIT — enable incremental; keep strict flags; fix real errors instead of adding ignores
    │   └── tsconfig.typecheck.json  # NEW — typecheck project: extends tsconfig.json, incremental + tsBuildInfoFile, includes src + test, excludes dist; strictness NOT relaxed
    └── docs/evidence/
        └── api-typecheck.md         # NEW — command, runner size, exit code, duration, error count before/after
```

Done when: `npm run typecheck:ci --workspace=@wlct/api` exits 0 in CI; real type errors fixed (no blanket `any`, no new `@ts-ignore`); ts-jest diagnostics ON for copy/oms/risk/custody suites. If the runner cannot hold the heap, mark BLOCKED with numbers - never PASS.

#### GAP-102 - Nest production build emits dist  ·  P0

Now: (R) build OOM; `apps/api/dist` absent

```text
White-Label01-Crypto-Copy-Trading-App/
├── .github/workflows/
│   └── ci.yml                  # EDIT — add job api-build (npm run build --workspace=@wlct/api; upload dist artifact)
└── whitelabel-copytrade/
    ├── docs/evidence/
    │   └── api-build.md        # NEW — build summary + boot-check result
    ├── infrastructure/docker/
    │   └── api.Dockerfile      # EDIT — builder stage sets NODE_OPTIONS heap + runs nest build; runtime stage copies dist only
    └── scripts/
        └── api-boot-check.mjs  # NEW — boots node dist/main.js against compose Postgres/Redis, polls /health, exits non-zero on failure
```

Done when: `npm run build --workspace=@wlct/api` exits 0 in CI and inside `api.Dockerfile`; `node dist/main.js` boots against the compose stack and `/health` is green.

#### GAP-103 - API lint zero-warning gate  ·  P0

Now: (R) 0 errors / 6,437 warnings against `--max-warnings=0`

```text
White-Label01-Crypto-Copy-Trading-App/
├── .github/workflows/
│   └── ci.yml                      # EDIT — api-lint job: npm run lint --workspace=@wlct/api (max-warnings=0)
└── whitelabel-copytrade/
    ├── apps/api/
    │   └── .eslintrc.cjs           # EDIT — strictness unchanged; per-file overrides only with a written reason
    ├── docs/
    │   ├── evidence/
    │   │   └── lint-baseline.json  # NEW — per-rule warning counts (starts at 6,437, ends at 0)
    │   └── LINT_BURNDOWN.md        # NEW — burn-down log per rule + codemods used
    └── scripts/
        └── lint-burndown.mjs       # NEW — runs eslint JSON formatter, counts warnings per rule, compares with docs/evidence/lint-baseline.json, fails on any increase, prints top rules
```

Done when: API lint exits 0 with `--max-warnings=0`; per-rule burn-down log committed; rules not weakened.

#### GAP-104 - Real browser E2E  ·  P0

Now: No `@playwright/test` dependency; "E2E" = `renderToStaticMarkup` Jest tests

```text
White-Label01-Crypto-Copy-Trading-App/
├── .github/workflows/
│   └── ci.yml                                      # EDIT — add job browser-e2e (compose stack), upload traces on failure
└── whitelabel-copytrade/
    ├── tests/
    │   ├── browser/
    │   │   ├── fixtures/
    │   │   │   └── stack.ts                        # NEW — global setup: compose up, wait healthy, migrate + seed, create tenant/users; teardown
    │   │   ├── admin-compliance.browser.spec.ts    # NEW — case queue -> decision rationale -> audit timeline
    │   │   ├── auth-2fa.browser.spec.ts            # NEW — login + TOTP enrolment + refresh rotation + lockout
    │   │   ├── billing-plans.browser.spec.ts       # NEW — plan change + entitlement enforcement
    │   │   ├── branding-tenant.browser.spec.ts     # NEW — branding edit shows on tenant host; second tenant unaffected
    │   │   ├── copy-lifecycle.browser.spec.ts      # NEW — discover trader -> follow -> copy settings -> leader fill (paper adapter) -> follower order -> stop copy
    │   │   ├── funding-withdrawal.browser.spec.ts  # NEW — deposit confirmation; destination + step-up + dual-control approval
    │   │   ├── mobile-viewport.browser.spec.ts     # NEW — key pages at 390 px: no horizontal scroll, navigation usable
    │   │   ├── partner-payout.browser.spec.ts      # NEW — referral link -> attribution -> commission ledger -> payout request
    │   │   └── risk-controls.browser.spec.ts       # NEW — guardrails; admin kill-switch blocks new copy orders
    │   └── smoke/
    │       └── README.md                           # NEW — `git mv tests/e2e tests/smoke` (and fix jest config paths): these are server-render smoke tests, not browser E2E
    ├── package.json                                # EDIT — devDependency @playwright/test; scripts test:browser + test:smoke
    └── playwright.config.ts                        # EDIT — real chromium project, webServer = docker compose stack, baseURL, trace on first retry, tenant-host mapping
```

Done when: >= 12 browser flows pass in CI against the compose stack; traces uploaded on failure; the old Jest server-render suites live in `tests/smoke` and are never called E2E.

#### GAP-105 - Staging proof  ·  P0

Now: (R) migrations never applied outside the workspace; RLS enable is manual. Scaffolding exists (`scripts/staging/*`, `infrastructure/staging/docker-compose.staging.yml`, `scripts/smoke-test.sh`) but no recorded run

```text
White-Label01-Crypto-Copy-Trading-App/
├── .github/workflows/
│   └── staging-proof.yml               # NEW — runs scripts/staging-proof.sh on service containers; uploads evidence artifact; required before release
└── whitelabel-copytrade/
    ├── docs/evidence/
    │   └── staging-proof.json          # NEW — generated: migration count, RLS policies enabled, smoke results, timings, commit SHA
    ├── infrastructure/staging/
    │   └── docker-compose.staging.yml  # EDIT — add execution-engine + redis + postgres healthchecks used by the proof
    └── scripts/
        ├── staging/
        │   └── staging_rehearsal.py    # EDIT — emit machine-readable JSON consumed by staging-proof.sh
        └── staging-proof.sh            # NEW — orchestrates: compose up -> prisma migrate deploy on an empty DB -> rls-enablement.mjs -> seed -> smoke-test.sh -> staging/staging_rehearsal.py -> writes evidence JSON
```

Done when: One CI job applies ALL migrations to an empty Postgres 16, enables RLS, seeds, runs `smoke-test.sh` + `staging_rehearsal.py`, and publishes `docs/evidence/staging-proof.json` (migration count, RLS policy count, results, commit SHA).

#### GAP-106 - Wiring-integrity scanner + report-vs-tree drift check  ·  P0

Now: F1-F3: orphans and drift pass every current scanner

```text
White-Label01-Crypto-Copy-Trading-App/
├── .github/workflows/
│   └── ci.yml                                  # EDIT — run both checks in the repository-validators step
└── whitelabel-copytrade/
    ├── ops/
    │   ├── gap-parity-scanner.js               # EDIT — add behaviour-signal criteria (not only existence) and a re-export-shim detector; keep the 3 forbidden strings
    │   ├── report-vs-tree-drift-check.js       # NEW — re-runs the scanners and compares the numbers quoted in docs/*FINAL_REPORT.md and NEXT.md; fails on mismatch
    │   ├── report-vs-tree-drift-check.test.js  # NEW — a fixture report with wrong numbers must fail
    │   ├── wiring-integrity-scan.js            # NEW — static import-graph scan: every non-spec @Injectable is provided in a module AND referenced by another provider/controller (allowlist needs a written reason); every controller registered; every route permission-decorated; every UI component mounted by a route/parent and linked in navigation; exit 1 on orphan
    │   └── wiring-integrity-scan.test.js       # NEW — fixtures proving it catches TraderRiskScoreService-style orphans and unmounted components
    └── package.json                            # EDIT — scripts check:wiring + check:report-drift
```

Done when: Both checks run in CI; they FAIL on the current tree for the orphans in F2 until the 6.B wire-in repairs land, then pass.

#### GAP-107 - Remove duplicate / shim implementations  ·  P0

Now: F4-F5: shims and parallel copies

```text
White-Label01-Crypto-Copy-Trading-App/
└── whitelabel-copytrade/
    ├── apps/
    │   ├── admin-web/src/
    │   │   ├── lib/
    │   │   │   └── api-error.ts                          # DELETE — byte-identical duplicate; delete and import from @wlct/utils
    │   │   └── modules/
    │   │       ├── compliance/
    │   │       │   ├── aml-screening-panel.tsx           # DELETE — duplicate of features/compliance/; keep the one pages import (target list names features/), re-point imports, delete the other
    │   │       │   ├── compliance-audit-timeline.tsx     # DELETE — duplicate of features/compliance/; same rule
    │   │       │   ├── compliance-case-detail.tsx        # DELETE — duplicate of features/compliance/; same rule
    │   │       │   └── compliance-case-queue.tsx         # DELETE — duplicate of features/compliance/; same rule
    │   │       ├── execution/
    │   │       │   └── execution-incident-table.tsx      # DELETE — duplicate of features/execution/; same rule
    │   │       ├── funding/
    │   │       │   └── funding-reconciliation-table.tsx  # DELETE — duplicate of features/funding/; same rule
    │   │       └── partners/
    │   │           └── partner-admin-table.tsx           # DELETE — duplicate of features/partners/; same rule
    │   ├── api/src/modules/
    │   │   ├── exchanges/
    │   │   │   ├── providers/
    │   │   │   │   ├── bybit.provider.ts                 # EDIT — canonical implementation: git mv from exchanges/venues/bybit.provider.ts over this shim
    │   │   │   │   ├── coinbase.provider.ts              # EDIT — canonical implementation: git mv from exchanges/venues/coinbase.provider.ts over this shim
    │   │   │   │   ├── kraken.provider.ts                # EDIT — canonical implementation: git mv from exchanges/venues/kraken.provider.ts over this shim
    │   │   │   │   └── okx.provider.ts                   # EDIT — canonical implementation: git mv from exchanges/venues/okx.provider.ts over this shim
    │   │   │   └── venues/
    │   │   │       ├── bybit.provider.ts                 # DELETE — moved to providers/; delete
    │   │   │       ├── coinbase.provider.ts              # DELETE — moved to providers/; delete
    │   │   │       ├── kraken.provider.ts                # DELETE — moved to providers/; delete
    │   │   │       ├── okx.provider.ts                   # DELETE — moved to providers/; delete
    │   │   │       └── venue-providers.spec.ts           # DELETE — duplicate of exchanges/venue-providers.spec.ts; merge any unique cases into that one, then delete
    │   │   └── providers/adapters/
    │   │       ├── custody/
    │   │       │   └── custody.adapter.ts                # DELETE — moved up; delete
    │   │       ├── payment/
    │   │       │   └── payment.adapter.ts                # DELETE — merged up; delete
    │   │       ├── custody.adapter.ts                    # EDIT — canonical implementation: move code up from adapters/custody/custody.adapter.ts
    │   │       └── payment.adapter.ts                    # EDIT — canonical normalizer/contract: merge adapters/payment/payment.adapter.ts into it
    │   └── web/src/lib/
    │       └── api-error.ts                              # DELETE — byte-identical duplicate; delete and import from @wlct/utils
    ├── packages/utils/src/
    │   └── api-error.ts                                  # NEW — single ApiError helper consumed by web and admin-web
    └── services/execution-engine/app/
        ├── exchanges/
        │   └── credentials.py                            # EDIT — canonical implementation moved here from app/credentials.py
        ├── orders/
        │   ├── placement.py                              # EDIT — canonical implementation moved here from app/placement.py; update imports in app/, routers/, tests/
        │   └── submission.py                             # EDIT — canonical implementation moved here from app/submission.py
        ├── security/
        │   └── secret_fetcher.py                         # EDIT — canonical implementation moved here from app/secret_fetcher.py
        ├── credentials.py                                # DELETE — moved to app/exchanges/credentials.py; delete
        ├── placement.py                                  # DELETE — moved to app/orders/placement.py; delete
        ├── secret_fetcher.py                             # DELETE — moved to app/security/secret_fetcher.py; delete
        └── submission.py                                 # DELETE — moved to app/orders/submission.py; delete
```

Done when: Each concern has exactly one implementation at the path named by the target list; shims deleted; imports and scanner paths updated; every moved file keeps its tests green. Do not leave re-exports behind.

#### GAP-108 - Reference-integrity test green  ·  P0

Now: F11: 1 failing test in 1,767

```text
White-Label01-Crypto-Copy-Trading-App/
└── whitelabel-copytrade/
    ├── docs/
    │   ├── FINAL_RELEASE_HANDOVER.md     # EDIT — line 8 names a file that does not resolve; fix the reference
    │   └── NEXT_51_100_INITIAL_AUDIT.md  # EDIT — line 51 names robots.ts / sitemap.ts: resolves after GAP-93; until then reword as planned, not existing
    └── scripts/
        └── generate-release-manifest.ts  # EDIT — line 41 names RELEASE_PACKAGE_CHECK.md; point at the real path (outer repo root) or generate it so the reference resolves
```

Done when: `pytest libs/trading-core` is 100% green with NO allowlist additions.

#### GAP-109 - Env surface rationalized  ·  P1

Now: `.env.example` is 73 KB / 426 variables

```text
White-Label01-Crypto-Copy-Trading-App/
└── whitelabel-copytrade/
    ├── apps/api/src/config/
    │   └── env-example-coverage.spec.ts  # EDIT — also assert .env.minimal.example passes env validation
    ├── docs/
    │   └── ENV_MATRIX.md                 # NEW — generated; CI fails if stale
    ├── scripts/
    │   └── gen-env-matrix.mjs            # NEW — reads packages/config/src/env.schema.ts + apps/api/src/config/app-config.service.ts; emits docs/ENV_MATRIX.md (name, type, required-in dev/staging/prod, default, secret?, owner service); --check mode for CI
    ├── .env.example                      # EDIT — grouped by service with section headers; full list; no behaviour change
    └── .env.minimal.example              # NEW — <= 40 variables sufficient to boot API + web + admin in dev with paper trading
```

Done when: `node scripts/gen-env-matrix.mjs --check` passes in CI; the minimal env boots API + web + admin with paper trading.

#### GAP-110 - CI placement + real security gates  ·  P0

Now: F10: nested workflows never run; security.yml promises scans it does not perform

```text
White-Label01-Crypto-Copy-Trading-App/
├── .github/workflows/
│   ├── release.yml                             # NEW — tag -> build digest-pinned images -> attach SBOM + manifest to the release (feeds production-release.yml)
│   └── security.yml                            # NEW — root-level: npm audit --omit=dev --audit-level=high; pip-audit (execution-engine, market-data, trading-engine, trading-core); cargo audit (low-latency-gateway, sdk-rust); gitleaks; CodeQL (javascript-typescript, python); trivy image scan; weekly schedule
└── whitelabel-copytrade/
    ├── .github/workflows/
    │   ├── ci.yml                              # DELETE — nested copy GitHub never runs; delete (root ci.yml is canonical)
    │   ├── production-release.yml              # DELETE — nested copy; delete
    │   ├── release.yml                         # DELETE — nested copy; delete (replaced by root release.yml)
    │   └── security.yml                        # DELETE — nested copy; delete (replaced by root security.yml)
    └── ops/
        └── production-validation-50-checks.js  # EDIT — update checks that reference the nested workflow paths
```

Done when: Workflows exist only at the repo root; a PR that adds a high-severity vulnerable dependency or a committed secret fails; weekly schedule runs.

#### GAP-111 - SBOM + license gate + manifest  ·  P1

Now: No SBOM; (R) manifest regeneration deferred

```text
White-Label01-Crypto-Copy-Trading-App/
├── .github/workflows/
│   └── release.yml                       # NEW — created in GAP-110; extend it with SBOM generation + license-gate steps and attach the artifacts
└── whitelabel-copytrade/
    ├── docs/
    │   └── THIRD_PARTY_LICENSES.md       # NEW — generated from the SBOM; consumed by GAP-148
    ├── scripts/
    │   ├── generate-release-manifest.ts  # EDIT — include SBOM hashes; never hand-edit the manifest
    │   ├── generate-sbom.mjs             # NEW — CycloneDX JSON for npm workspaces, python projects, cargo crates, flutter pubspec.lock -> docs/sbom/
    │   └── license-gate.mjs              # NEW — reads SBOMs; denies GPL/AGPL/SSPL in shipped deps unless allowlisted with a reason in docs/sale/LICENSE_ALLOWLIST.md
    └── RELEASE_MANIFEST.json             # EDIT — regenerated by the generator after all gates are green
```

Done when: SBOMs committed per release; license gate green; `RELEASE_MANIFEST.json` regenerated only after Block A is green.

### 7.B Block B: Execution, venues, copy engine (GAP-112-125)

#### GAP-112 - Single canonical order path  ·  P0

Now: F6: two placement stacks (NestJS adapters vs Python engine); okx adapter spot-only with no-op symbol replace

```text
White-Label01-Crypto-Copy-Trading-App/
└── whitelabel-copytrade/
    ├── apps/api/src/modules/
    │   ├── execution/
    │   │   └── single-order-path.spec.ts           # NEW — static + runtime test: only ExecutionOrdersService -> engine client can transmit; adapter classes have no order methods; kill-switch and live gate precede it
    │   ├── providers/adapters/exchange/
    │   │   ├── binance.adapter.ts                  # EDIT — remove createOrder/cancelOrder and the ORDER_CREATE/ORDER_CANCEL capabilities; keep read operations
    │   │   ├── bybit.adapter.ts                    # EDIT — remove createOrder/cancelOrder and the ORDER_CREATE/ORDER_CANCEL capabilities; keep read operations
    │   │   ├── coinbase.adapter.ts                 # EDIT — remove createOrder/cancelOrder and the ORDER_CREATE/ORDER_CANCEL capabilities; keep read operations
    │   │   ├── exchange-adapters.contract.spec.ts  # EDIT — assert no adapter exposes order transmission
    │   │   ├── kraken.adapter.ts                   # EDIT — remove createOrder/cancelOrder and the ORDER_CREATE/ORDER_CANCEL capabilities; keep read operations
    │   │   └── okx.adapter.ts                      # EDIT — remove createOrder/cancelOrder and the ORDER_CREATE/ORDER_CANCEL capabilities; keep read operations
    │   └── worker/
    │       └── trade-execution.processor.ts        # EDIT — route through the single path only
    └── docs/
        └── ADR-0001-single-order-path.md           # NEW — decision: the Python execution engine is the only order transmitter; NestJS provider adapters are read-only
```

Done when: ADR merged; the five NestJS adapters expose no order methods; `single-order-path.spec.ts` fails if any other path can transmit an order; double-submit impossible by construction (kill-switch + live gate precede the only path).

#### GAP-113 - Bybit V5 live execution (spot + linear)  ·  P0

Now: read-side only (`venues/bybit.provider.ts`: "places no orders")

```text
White-Label01-Crypto-Copy-Trading-App/
└── whitelabel-copytrade/
    ├── libs/trading-core/
    │   ├── tests/
    │   │   ├── fixtures/bybit/
    │   │   │   ├── execution_partial.json  # NEW — recorded Bybit stream message: partial fill
    │   │   │   ├── order_created.json      # NEW — recorded Bybit response: order accepted
    │   │   │   └── order_rejected.json     # NEW — recorded Bybit response: venue rejection
    │   │   ├── test_bybit_parsers.py       # NEW — pytest: Bybit parsers on recorded fixtures incl. rejects and partial fills
    │   │   ├── test_bybit_signing.py       # NEW — pytest: Bybit signing vectors, header builder, secret never appears in logs
    │   │   ├── test_bybit_trading.py       # NEW — pytest: Bybit place/cancel idempotency, precision + min-notional, fail-closed on unknown error code
    │   │   └── test_bybit_userstream.py    # NEW — pytest: Bybit stream auth, ping, reconnect with backoff, sequence-gap detection
    │   └── wlct_trading/exchanges/
    │       ├── bybit/
    │       │   ├── __init__.py             # NEW — Bybit package exports + registry hook
    │       │   ├── adapter.py              # NEW — BybitAdapter implements the shared venue adapter interface used by the execution engine (place/cancel/amend, balances, positions, stream)
    │       │   ├── attestation.py          # NEW — Bybit attestation: proves signing + request shaping against recorded vectors before live enablement (mirror of binance/attestation.py)
    │       │   ├── capabilities.py         # NEW — static Bybit capability matrix (spot, perps, hedge mode, reduce-only, trigger orders) read by the shared capability registry; unsupported = rejected, never guessed
    │       │   ├── parsers.py              # NEW — Bybit wire -> normalized order/fill/position/balance parsers; exact decimals; venue error-code classification (retryable vs fatal)
    │       │   ├── signing.py              # NEW — V5 signing: HMAC-SHA256 over timestamp + apiKey + recvWindow + payload; X-BAPI-* header builder; recvWindow bound to the clock-sync offset
    │       │   ├── trading.py              # NEW — spot + linear (USDT/USDC) place/cancel/amend/batch; orderLinkId idempotency; hedge vs one-way; reduce-only; precision/min-notional; retCode classification; fail-closed on unknown code
    │       │   └── userstream.py           # NEW — private WS topics order/execution/position/wallet; auth expiry handling; 20 s ping; reconnect with backoff; gap detection
    │       ├── __init__.py                 # EDIT — export the venue package
    │       └── registry.py                 # EDIT — register the venue + capability matrix
    └── services/execution-engine/app/
        └── composition.py                  # EDIT — wire the venue adapter into engine composition; credentials only via the vault/KMS fetcher
```

Done when: Shared contract suite (GAP-120) green for the venue; `scripts/live_execution_smoke_test.py --venue bybit --testnet` evidence JSON recorded; clock-drift refusal, withdraw-permission refusal, idempotent retry and partial-fill accounting proven; unsupported capability is rejected, not guessed.

#### GAP-114 - OKX V5 live execution  ·  P0

Now: read-side + spot-only `tdMode:cash` adapter

```text
White-Label01-Crypto-Copy-Trading-App/
└── whitelabel-copytrade/
    ├── libs/trading-core/
    │   ├── tests/
    │   │   ├── fixtures/okx/
    │   │   │   ├── execution_partial.json  # NEW — recorded OKX stream message: partial fill
    │   │   │   ├── order_created.json      # NEW — recorded OKX response: order accepted
    │   │   │   └── order_rejected.json     # NEW — recorded OKX response: venue rejection
    │   │   ├── test_okx_parsers.py         # NEW — pytest: OKX parsers on recorded fixtures incl. rejects and partial fills
    │   │   ├── test_okx_signing.py         # NEW — pytest: OKX signing vectors, header builder, secret never appears in logs
    │   │   ├── test_okx_trading.py         # NEW — pytest: OKX place/cancel idempotency, precision + min-notional, fail-closed on unknown error code
    │   │   └── test_okx_userstream.py      # NEW — pytest: OKX stream auth, ping, reconnect with backoff, sequence-gap detection
    │   └── wlct_trading/exchanges/
    │       ├── okx/
    │       │   ├── __init__.py             # NEW — OKX package exports + registry hook
    │       │   ├── adapter.py              # NEW — OKXAdapter implements the shared venue adapter interface used by the execution engine (place/cancel/amend, balances, positions, stream)
    │       │   ├── attestation.py          # NEW — OKX attestation: proves signing + request shaping against recorded vectors before live enablement (mirror of binance/attestation.py)
    │       │   ├── capabilities.py         # NEW — static OKX capability matrix (spot, perps, hedge mode, reduce-only, trigger orders) read by the shared capability registry; unsupported = rejected, never guessed
    │       │   ├── parsers.py              # NEW — OKX wire -> normalized order/fill/position/balance parsers; exact decimals; venue error-code classification (retryable vs fatal)
    │       │   ├── signing.py              # NEW — HMAC-SHA256 base64 over timestamp + method + path + body; OK-ACCESS-KEY/SIGN/TIMESTAMP/PASSPHRASE headers; x-simulated-trading for demo
    │       │   ├── trading.py              # NEW — SPOT/SWAP/FUTURES; tdMode cash/cross/isolated; posSide long/short/net; clOrdId idempotency; sCode/code classification; reduce-only
    │       │   └── userstream.py           # NEW — private WS login + orders/positions/account channels; demo endpoint support; reconnect + resubscribe
    │       ├── __init__.py                 # EDIT — export the venue package
    │       └── registry.py                 # EDIT — register the venue + capability matrix
    └── services/execution-engine/app/
        └── composition.py                  # EDIT — wire the venue adapter into engine composition; credentials only via the vault/KMS fetcher
```

Done when: Shared contract suite (GAP-120) green for the venue; `scripts/live_execution_smoke_test.py --venue okx --testnet` evidence JSON recorded; clock-drift refusal, withdraw-permission refusal, idempotent retry and partial-fill accounting proven; unsupported capability is rejected, not guessed.

#### GAP-115 - Kraken spot live execution  ·  P1

Now: read-side only

```text
White-Label01-Crypto-Copy-Trading-App/
└── whitelabel-copytrade/
    ├── libs/trading-core/
    │   ├── tests/
    │   │   ├── fixtures/kraken/
    │   │   │   ├── execution_partial.json  # NEW — recorded Kraken stream message: partial fill
    │   │   │   ├── order_created.json      # NEW — recorded Kraken response: order accepted
    │   │   │   └── order_rejected.json     # NEW — recorded Kraken response: venue rejection
    │   │   ├── test_kraken_parsers.py      # NEW — pytest: Kraken parsers on recorded fixtures incl. rejects and partial fills
    │   │   ├── test_kraken_signing.py      # NEW — pytest: Kraken signing vectors, header builder, secret never appears in logs
    │   │   ├── test_kraken_trading.py      # NEW — pytest: Kraken place/cancel idempotency, precision + min-notional, fail-closed on unknown error code
    │   │   └── test_kraken_userstream.py   # NEW — pytest: Kraken stream auth, ping, reconnect with backoff, sequence-gap detection
    │   └── wlct_trading/exchanges/
    │       ├── kraken/
    │       │   ├── __init__.py             # NEW — Kraken package exports + registry hook
    │       │   ├── adapter.py              # NEW — KrakenAdapter implements the shared venue adapter interface used by the execution engine (place/cancel/amend, balances, positions, stream)
    │       │   ├── attestation.py          # NEW — Kraken attestation: proves signing + request shaping against recorded vectors before live enablement (mirror of binance/attestation.py)
    │       │   ├── capabilities.py         # NEW — static Kraken capability matrix (spot, perps, hedge mode, reduce-only, trigger orders) read by the shared capability registry; unsupported = rejected, never guessed
    │       │   ├── parsers.py              # NEW — Kraken wire -> normalized order/fill/position/balance parsers; exact decimals; venue error-code classification (retryable vs fatal)
    │       │   ├── signing.py              # NEW — API-Sign = HMAC-SHA512(base64 secret, path + SHA256(nonce + postdata)); strictly increasing nonce store (Redis) shared across workers
    │       │   ├── trading.py              # NEW — spot AddOrder/CancelOrder/EditOrder; userref idempotency; validate flag; precision rules; error-array classification
    │       │   └── userstream.py           # NEW — WS v2 token via GetWebSocketsToken; executions + balances channels; token refresh
    │       ├── __init__.py                 # EDIT — export the venue package
    │       └── registry.py                 # EDIT — register the venue + capability matrix
    └── services/execution-engine/app/
        └── composition.py                  # EDIT — wire the venue adapter into engine composition; credentials only via the vault/KMS fetcher
```

Done when: Shared contract suite (GAP-120) green for the venue; `scripts/live_execution_smoke_test.py --venue kraken --testnet` evidence JSON recorded; clock-drift refusal, withdraw-permission refusal, idempotent retry and partial-fill accounting proven; unsupported capability is rejected, not guessed.

#### GAP-116 - Coinbase Advanced Trade live execution  ·  P1

Now: read-side only

```text
White-Label01-Crypto-Copy-Trading-App/
└── whitelabel-copytrade/
    ├── libs/trading-core/
    │   ├── tests/
    │   │   ├── fixtures/coinbase/
    │   │   │   ├── execution_partial.json   # NEW — recorded Coinbase stream message: partial fill
    │   │   │   ├── order_created.json       # NEW — recorded Coinbase response: order accepted
    │   │   │   └── order_rejected.json      # NEW — recorded Coinbase response: venue rejection
    │   │   ├── test_coinbase_parsers.py     # NEW — pytest: Coinbase parsers on recorded fixtures incl. rejects and partial fills
    │   │   ├── test_coinbase_signing.py     # NEW — pytest: Coinbase signing vectors, header builder, secret never appears in logs
    │   │   ├── test_coinbase_trading.py     # NEW — pytest: Coinbase place/cancel idempotency, precision + min-notional, fail-closed on unknown error code
    │   │   └── test_coinbase_userstream.py  # NEW — pytest: Coinbase stream auth, ping, reconnect with backoff, sequence-gap detection
    │   └── wlct_trading/exchanges/
    │       ├── coinbase/
    │       │   ├── __init__.py              # NEW — Coinbase package exports + registry hook
    │       │   ├── adapter.py               # NEW — CoinbaseAdapter implements the shared venue adapter interface used by the execution engine (place/cancel/amend, balances, positions, stream)
    │       │   ├── attestation.py           # NEW — Coinbase attestation: proves signing + request shaping against recorded vectors before live enablement (mirror of binance/attestation.py)
    │       │   ├── capabilities.py          # NEW — static Coinbase capability matrix (spot, perps, hedge mode, reduce-only, trigger orders) read by the shared capability registry; unsupported = rejected, never guessed
    │       │   ├── parsers.py               # NEW — Coinbase wire -> normalized order/fill/position/balance parsers; exact decimals; venue error-code classification (retryable vs fatal)
    │       │   ├── signing.py               # NEW — ES256 JWT per request (CDP API keys) with uri claim; no legacy HMAC; short expiry; key id never logged
    │       │   ├── trading.py               # NEW — Advanced Trade create/cancel/edit; client_order_id idempotency; spot only (documented capability limit); failure_reason classification
    │       │   └── userstream.py            # NEW — WS user channel with JWT; heartbeats; reconnect + snapshot reconciliation
    │       ├── __init__.py                  # EDIT — export the venue package
    │       └── registry.py                  # EDIT — register the venue + capability matrix
    └── services/execution-engine/app/
        └── composition.py                   # EDIT — wire the venue adapter into engine composition; credentials only via the vault/KMS fetcher
```

Done when: Shared contract suite (GAP-120) green for the venue; `scripts/live_execution_smoke_test.py --venue coinbase --testnet` evidence JSON recorded; clock-drift refusal, withdraw-permission refusal, idempotent retry and partial-fill accounting proven; unsupported capability is rejected, not guessed.

#### GAP-117 - Bitget (new venue; major copy-trading venue)  ·  P0

Now: absent

```text
White-Label01-Crypto-Copy-Trading-App/
└── whitelabel-copytrade/
    ├── apps/
    │   ├── api/
    │   │   ├── prisma/migrations/<STAMP>_add_bitget_venue/
    │   │   │   └── migration.sql           # NEW — additive: ALTER TYPE ... ADD VALUE if the venue is a DB enum
    │   │   └── src/modules/exchanges/
    │   │       ├── providers/
    │   │       │   └── bitget.provider.ts  # NEW — read-side provider (server time, key permissions, balances, positions, open orders, symbols) following the BaseExchangeProvider pattern; places no orders
    │   │       └── exchange.types.ts       # EDIT — add ExchangeVenue.BITGET + capability matrix
    │   └── web/src/features/exchanges/
    │       └── exchange-capabilities.tsx   # EDIT — venue list comes from the capability matrix (no hardcoded venue names)
    ├── libs/trading-core/
    │   ├── tests/
    │   │   ├── fixtures/bitget/
    │   │   │   ├── execution_partial.json  # NEW — recorded Bitget stream message: partial fill
    │   │   │   ├── order_created.json      # NEW — recorded Bitget response: order accepted
    │   │   │   └── order_rejected.json     # NEW — recorded Bitget response: venue rejection
    │   │   ├── test_bitget_parsers.py      # NEW — pytest: Bitget parsers on recorded fixtures incl. rejects and partial fills
    │   │   ├── test_bitget_signing.py      # NEW — pytest: Bitget signing vectors, header builder, secret never appears in logs
    │   │   ├── test_bitget_trading.py      # NEW — pytest: Bitget place/cancel idempotency, precision + min-notional, fail-closed on unknown error code
    │   │   └── test_bitget_userstream.py   # NEW — pytest: Bitget stream auth, ping, reconnect with backoff, sequence-gap detection
    │   └── wlct_trading/exchanges/
    │       ├── bitget/
    │       │   ├── __init__.py             # NEW — Bitget package exports + registry hook
    │       │   ├── adapter.py              # NEW — BitgetAdapter implements the shared venue adapter interface used by the execution engine (place/cancel/amend, balances, positions, stream)
    │       │   ├── attestation.py          # NEW — Bitget attestation: proves signing + request shaping against recorded vectors before live enablement (mirror of binance/attestation.py)
    │       │   ├── capabilities.py         # NEW — static Bitget capability matrix (spot, perps, hedge mode, reduce-only, trigger orders) read by the shared capability registry; unsupported = rejected, never guessed
    │       │   ├── parsers.py              # NEW — Bitget wire -> normalized order/fill/position/balance parsers; exact decimals; venue error-code classification (retryable vs fatal)
    │       │   ├── signing.py              # NEW — ACCESS-SIGN = base64 HMAC-SHA256 over timestamp + method + path + body; ACCESS-KEY/TIMESTAMP/PASSPHRASE headers
    │       │   ├── trading.py              # NEW — spot + USDT-M mix; clientOid idempotency; marginMode + posMode; reduce-only; one-way/hedge; code classification
    │       │   └── userstream.py           # NEW — private WS login + orders/positions/account channels; reconnect + resubscribe
    │       ├── __init__.py                 # EDIT — export the venue package
    │       └── registry.py                 # EDIT — register the venue + capability matrix
    └── services/execution-engine/app/
        └── composition.py                  # EDIT — wire the venue adapter into engine composition; credentials only via the vault/KMS fetcher
```

Done when: Shared contract suite (GAP-120) green for the venue; `scripts/live_execution_smoke_test.py --venue bitget --testnet` evidence JSON recorded; clock-drift refusal, withdraw-permission refusal, idempotent retry and partial-fill accounting proven; unsupported capability is rejected, not guessed.

#### GAP-118 - KuCoin (new venue)  ·  P2

Now: absent

```text
White-Label01-Crypto-Copy-Trading-App/
└── whitelabel-copytrade/
    ├── apps/api/
    │   ├── prisma/migrations/<STAMP>_add_kucoin_venue/
    │   │   └── migration.sql               # NEW — additive venue enum value
    │   └── src/modules/exchanges/providers/
    │       └── kucoin.provider.ts          # NEW — read-side provider (server time, permissions, balances, positions, open orders, symbols); places no orders
    ├── libs/trading-core/
    │   ├── tests/
    │   │   ├── fixtures/kucoin/
    │   │   │   ├── execution_partial.json  # NEW — recorded KuCoin stream message: partial fill
    │   │   │   ├── order_created.json      # NEW — recorded KuCoin response: order accepted
    │   │   │   └── order_rejected.json     # NEW — recorded KuCoin response: venue rejection
    │   │   ├── test_kucoin_parsers.py      # NEW — pytest: KuCoin parsers on recorded fixtures incl. rejects and partial fills
    │   │   ├── test_kucoin_signing.py      # NEW — pytest: KuCoin signing vectors, header builder, secret never appears in logs
    │   │   ├── test_kucoin_trading.py      # NEW — pytest: KuCoin place/cancel idempotency, precision + min-notional, fail-closed on unknown error code
    │   │   └── test_kucoin_userstream.py   # NEW — pytest: KuCoin stream auth, ping, reconnect with backoff, sequence-gap detection
    │   └── wlct_trading/exchanges/
    │       ├── kucoin/
    │       │   ├── __init__.py             # NEW — KuCoin package exports + registry hook
    │       │   ├── adapter.py              # NEW — KuCoinAdapter implements the shared venue adapter interface used by the execution engine (place/cancel/amend, balances, positions, stream)
    │       │   ├── attestation.py          # NEW — KuCoin attestation: proves signing + request shaping against recorded vectors before live enablement (mirror of binance/attestation.py)
    │       │   ├── capabilities.py         # NEW — static KuCoin capability matrix (spot, perps, hedge mode, reduce-only, trigger orders) read by the shared capability registry; unsupported = rejected, never guessed
    │       │   ├── parsers.py              # NEW — KuCoin wire -> normalized order/fill/position/balance parsers; exact decimals; venue error-code classification (retryable vs fatal)
    │       │   ├── signing.py              # NEW — KC-API-SIGN base64 HMAC-SHA256 + KC-API-PASSPHRASE (HMAC-signed, key version 2) + KC-API-TIMESTAMP
    │       │   ├── trading.py              # NEW — spot + futures (separate hosts); clientOid idempotency; stp; precision rules; code classification
    │       │   └── userstream.py           # NEW — token via bullet-private; spot + futures order topics; ping; reconnect
    │       ├── __init__.py                 # EDIT — export the venue package
    │       └── registry.py                 # EDIT — register the venue + capability matrix
    └── services/execution-engine/app/
        └── composition.py                  # EDIT — wire the venue adapter into engine composition; credentials only via the vault/KMS fetcher
```

Done when: Shared contract suite (GAP-120) green for the venue; `scripts/live_execution_smoke_test.py --venue kucoin --testnet` evidence JSON recorded; clock-drift refusal, withdraw-permission refusal, idempotent retry and partial-fill accounting proven; unsupported capability is rejected, not guessed.

#### GAP-119 - Perps semantics in the venue-agnostic order model  ·  P0

Now: policy-level only; adapters spot-only

```text
White-Label01-Crypto-Copy-Trading-App/
└── whitelabel-copytrade/
    ├── apps/api/src/modules/copy-trading/
    │   ├── copy-order-mapper.perps.spec.ts  # NEW — hedge vs one-way, reduce-only close, leverage cap, unsupported capability rejected
    │   └── copy-order-mapper.service.ts     # EDIT — map leader perp fills incl. leverage/margin/position side to follower intent within caps
    ├── libs/trading-core/
    │   ├── tests/
    │   │   └── test_perp_semantics.py       # NEW — validators, illegal combinations rejected, venue capability gating
    │   └── wlct_trading/
    │       ├── exchanges/
    │       │   └── capabilities.py          # EDIT — add flags HEDGE_MODE, ISOLATED_MARGIN, CROSS_MARGIN, TRIGGER_ORDERS, TRAILING_STOP, REDUCE_ONLY
    │       └── execution/
    │           └── perp_semantics.py        # NEW — MarginMode, PositionMode, LeverageSetting, ReduceOnly, ProtectiveOrder(kind TP/SL/TRAILING) dataclasses + validators (exact decimals)
    └── services/execution-engine/app/
        └── schemas.py                       # EDIT — order-intent schema carries perp fields (backward compatible)
```

Done when: Leader perp fills map to follower intents with margin/position/leverage semantics within follower caps; an unsupported capability is rejected with a typed reason, never guessed.

#### GAP-120 - Venue contract harness + testnet smoke evidence  ·  P0

Now: only the opt-in `scripts/live_execution_smoke_test.py` exists; no per-venue evidence

```text
White-Label01-Crypto-Copy-Trading-App/
├── .github/workflows/
│   └── testnet-smoke.yml                 # NEW — manual dispatch only; per-venue secrets; places a min-notional order then cancels; uploads evidence JSON
└── whitelabel-copytrade/
    ├── docs/evidence/venue-testnet/
    │   └── README.md                     # NEW — how to read the evidence JSON; table venue -> last verified date + commit (filled by the workflow)
    ├── libs/trading-core/tests/venue_contract/
    │   ├── __init__.py                   # NEW — package marker
    │   ├── contract_suite.py             # NEW — shared behaviours every venue must pass: signing vectors, clock-skew refusal, place/cancel, idempotent retry, partial fills, 429 backoff, 5xx classification, WS reconnect + gap handling
    │   ├── test_binance_contract.py      # NEW — binds the shared contract suite to the binance adapter using recorded fixtures
    │   ├── test_bitget_contract.py       # NEW — binds the shared contract suite to the bitget adapter using recorded fixtures
    │   ├── test_bybit_contract.py        # NEW — binds the shared contract suite to the bybit adapter using recorded fixtures
    │   ├── test_coinbase_contract.py     # NEW — binds the shared contract suite to the coinbase adapter using recorded fixtures
    │   ├── test_kraken_contract.py       # NEW — binds the shared contract suite to the kraken adapter using recorded fixtures
    │   ├── test_kucoin_contract.py       # NEW — binds the shared contract suite to the kucoin adapter using recorded fixtures
    │   └── test_okx_contract.py          # NEW — binds the shared contract suite to the okx adapter using recorded fixtures
    └── scripts/
        └── live_execution_smoke_test.py  # EDIT — add --venue {binance,bybit,okx,kraken,coinbase,bitget,kucoin} and --testnet; keep the double opt-in; refuse a key with withdraw permission; write evidence JSON
```

Done when: Every venue passes the same contract suite; evidence JSON per venue is produced by the workflow; the evidence README table shows a verified date + commit per venue.

#### GAP-121 - Leader signal ingestion by stream (not 5 s DB polling)  ·  P0

Now: F13: `COPY_LEADER_INGESTION_INTERVAL_MS` default 5000, stale cutoff 30000

```text
White-Label01-Crypto-Copy-Trading-App/
└── whitelabel-copytrade/
    ├── apps/api/src/
    │   ├── infrastructure/metrics/
    │   │   └── metrics.registry.ts                # EDIT — register the new metrics
    │   └── modules/copy-trading/
    │       ├── copy-latency.metrics.ts            # NEW — histogram copy_leader_to_follower_submit_seconds + counters by venue/outcome
    │       ├── leader-event-ingestion.service.ts  # EDIT — keep as reconciliation safety net: default interval 60 s, same idempotency key, never double-copies
    │       ├── leader-event-stream.service.ts     # NEW — Redis Streams consumer group: XREADGROUP, ack only after the CopyExecution row is durable, retry with backoff, DLQ stream, staleness cutoff retained
    │       └── leader-event-stream.spec.ts        # NEW — duplicate delivery, crash-before-ack redelivery, DLQ, stale drop, tenant isolation
    ├── infrastructure/observability/
    │   ├── prometheus/rules/
    │   │   └── wlct.rules.yml                     # EDIT — alerts: p95 copy latency over SLO for 10 min; stream consumer lag; DLQ depth
    │   └── metrics-catalog.json                   # EDIT — document the new metrics
    └── services/execution-engine/
        ├── app/
        │   └── leader_fill_publisher.py           # NEW — publishes normalized leader fills from the user-stream to Redis Stream leader.fills with idempotency id fill:<venueFillId>
        └── tests/
            └── test_leader_fill_publisher.py      # NEW — dedupe, ordering, backpressure
```

Done when: Kill the API mid-stream: no lost and no double copy after restart; p95 leader->submit latency measured and alert-wired; DB poll interval >= 60 s.

#### GAP-122 - Fan-out load evidence  ·  P1

Now: F13: no load tests

```text
White-Label01-Crypto-Copy-Trading-App/
└── whitelabel-copytrade/
    ├── apps/api/src/infrastructure/coordination/
    │   └── partitions.ts        # EDIT — tune partition count/concurrency only if results demand it; keep its tests
    ├── docs/evidence/load/
    │   └── RESULTS.md           # NEW — recorded runs: date, commit, machine, N, p50/p95/p99, error rate, bottleneck notes
    └── tests/load/
        ├── k6/
        │   ├── api-baseline.js  # NEW — read-heavy endpoints (traders list, profile, positions) at target RPS
        │   └── copy-fanout.js   # NEW — 1 leader fill -> N followers (100 / 1,000) through the paper adapter; asserts p95 leader->submit latency and zero duplicate executions
        └── README.md            # NEW — how to run on the compose stack; machine spec to record
```

Done when: RESULTS.md holds real numbers for N=100 and N=1,000 followers; zero duplicate executions; bottleneck and fix recorded.

#### GAP-123 - Smart vs Advanced copy modes (Bybit-style)  ·  P1

Now: 3 sizing modes only (PROPORTIONAL, FIXED, PERCENTAGE_BALANCE)

```text
White-Label01-Crypto-Copy-Trading-App/
└── whitelabel-copytrade/apps/
    ├── api/
    │   ├── prisma/
    │   │   ├── migrations/<STAMP>_copy_mode/
    │   │   │   └── migration.sql            # NEW — additive enum + column (default SMART)
    │   │   └── schema.prisma                # EDIT — enum CopyMode + CopySubscription.copyMode
    │   └── src/modules/copy-trading/
    │       ├── dto/
    │       │   └── copy-policy.dto.ts       # EDIT — add copyMode + advanced fields with validation
    │       ├── copy-mode.service.ts         # NEW — CopyModeService: SMART follows leader leverage/margin mode within follower caps; ADVANCED sets own leverage, fixed margin per order, per-contract max margin; resolves effective parameters
    │       └── copy-mode.spec.ts            # NEW — mode resolution matrix, caps never loosened, unsupported capability rejected
    └── web/src/
        ├── features/trading/
        │   ├── copy-mode-selector.tsx       # NEW — SMART/ADVANCED selector with explanation + effective-parameter preview
        │   └── copy-settings-page.tsx       # EDIT — mount the selector
        └── tests/
            └── copy-mode-selector.test.tsx  # NEW — render + validation
```

Done when: SMART/ADVANCED resolve deterministically; follower caps are never loosened by leader leverage; migration is additive with default SMART.

#### GAP-124 - Venue-side TP / SL / trailing  ·  P1

Now: policy bps + UI only; no evidence the venue enforces them

```text
White-Label01-Crypto-Copy-Trading-App/
└── whitelabel-copytrade/
    ├── apps/api/src/modules/copy-trading/
    │   ├── copy-protection.service.ts     # NEW — converts bps policy to absolute trigger prices from the follower fill price; never from the leader price
    │   └── copy-protection.spec.ts        # NEW — bps -> price exactness, side handling, missing fill => no trigger + visible warning
    └── services/execution-engine/
        ├── app/
        │   └── protective_orders.py       # NEW — places venue trigger orders (TP/SL/trailing) or engine-managed triggers when the venue lacks them; idempotent; reconciles on reconnect
        └── tests/
            └── test_protective_orders.py  # NEW — trigger placement, cancel on position close, restart reconciliation
```

Done when: Protective orders are placed from the FOLLOWER fill price and reconciled after restart; tests cover trigger placement and cancel-on-close.

#### GAP-125 - Demo (paper) copy onboarding  ·  P1

Now: paper adapter exists in the engine; no customer onboarding

```text
White-Label01-Crypto-Copy-Trading-App/
└── whitelabel-copytrade/apps/
    ├── api/src/modules/copy-trading/
    │   ├── demo-copy.service.ts               # NEW — DemoCopyService: paper-adapter subscription with virtual balance on real leader signals; flagged non-live end to end
    │   └── demo-copy.spec.ts                  # NEW — never reaches a live venue; upgrade path requires live gate + consent
    └── web/src/
        ├── features/trading/
        │   └── demo-copy-onboarding.tsx       # NEW — no-API-key onboarding flow with a persistent DEMO banner
        └── tests/
            └── demo-copy-onboarding.test.tsx  # NEW — render + banner + upgrade path
```

Done when: A demo subscription can never reach a live venue (a test proves it); upgrade requires the live gate + disclosure consent.

### 7.C Block C: Monetization, compliance vendors, channels (GAP-126-133)

#### GAP-126 - Leader profit-share settlement (HWM -> accrual -> ledger -> payout)  ·  P0

Now: F8: `leader-fee.service.ts` creates no accruals, no ledger entries, no payouts

```text
White-Label01-Crypto-Copy-Trading-App/
└── whitelabel-copytrade/apps/
    ├── admin-web/src/
    │   ├── app/(console)/leader-profit-share/
    │   │   └── page.tsx                                   # NEW — console route mounting the ledger view (+ sidebar entry)
    │   └── features/funding/
    │       └── leader-profit-share-ledger.tsx             # NEW — operator view of crystallizations, accruals, payouts, exceptions
    └── api/
        ├── prisma/
        │   ├── migrations/<STAMP>_leader_profit_share_crystallization/
        │   │   └── migration.sql                          # NEW — additive migration + tenant-scoped idempotency composite; then run scripts/gen_part11_rls.py for the additive RLS migration and refresh prisma/rls/rls_coverage.json
        │   └── schema.prisma                              # EDIT — add model LeaderProfitShareCrystallization: tenantId, subscriptionId, period, openingNav, closingNav, hwmBefore, hwmAfter, feeAmount, currency, status, idempotencyKey
        └── src/modules/copy-trading/
            ├── leader-fee.service.ts                      # EDIT — disclosure reflects the connected settlement; drop the "not connected" reason only when the source is verified
            ├── leader-profit-share-settlement.service.ts  # NEW — HWM crystallization per follower subscription each period; NAV adjusted for deposits/withdrawals; creates accrual via FeeAccrualService, posts via FeeLedgerService, payout via PayoutService; idempotent per (subscription, period)
            ├── leader-profit-share-settlement.spec.ts     # NEW — HWM never decreases, loss periods carry forward, deposits/withdrawals, double-run idempotency, rounding exactness
            └── leader-profit-share.processor.ts           # NEW — BullMQ cron (period from policy) calling the settlement service; fail closed without a verified source
```

Done when: Running twice for the same period gives the same result (idempotent); HWM never decreases; an unverified follower-profit source means no accrual (fail closed); GAP-85 statements read the same ledger.

#### GAP-127 - Follower statement export (CSV + PDF)  ·  P1

Now: none

```text
White-Label01-Crypto-Copy-Trading-App/
└── whitelabel-copytrade/apps/
    ├── api/src/modules/billing/
    │   ├── statement-export.service.ts           # NEW — CSV + PDF export of profit-share statements; exact decimals; tenant/user scoped
    │   └── statement-export.spec.ts              # NEW — format, CSV-injection escaping, scope
    └── web/src/
        ├── features/billing/
        │   └── statement-export-button.tsx       # NEW — download CSV/PDF button
        └── tests/
            └── statement-export-button.test.tsx  # NEW — render + request
```

Done when: CSV is injection-safe; PDF totals equal ledger totals.

#### GAP-128 - Sumsub KYC adapter  ·  P1

Now: F7: generic `KYC_PROVIDER_BASE_URL/v1/verifications`

```text
White-Label01-Crypto-Copy-Trading-App/
└── whitelabel-copytrade/apps/
    ├── api/src/modules/providers/adapters/kyc/
    │   ├── kyc.adapter.ts                  # EDIT — KycProvider strategy interface; the generic REST variant stays only as an explicit "custom" provider
    │   ├── sumsub-webhook.verifier.ts      # NEW — verifies X-Payload-Digest HMAC, replay window, idempotency by event id
    │   ├── sumsub.adapter.ts               # NEW — SumsubKycAdapter: signed requests (X-App-Token, X-App-Access-Sig, X-App-Access-Ts), create applicant, WebSDK access token, status fetch, mapping to internal KYC states
    │   └── sumsub.contract.spec.ts         # NEW — recorded fixtures: GREEN / RED / RETRY / PENDING, bad signature, replay
    └── web/src/
        ├── features/onboarding/
        │   └── kyc-sumsub-widget.tsx       # NEW — loads the Sumsub WebSDK with a short-lived access token; handles expiry/refresh
        └── tests/
            └── kyc-sumsub-widget.test.tsx  # NEW — token refresh + failure states
```

Done when: Contract spec passes on recorded fixtures; a webhook with a bad signature is rejected; no raw PII in logs.

#### GAP-129 - Persona KYC adapter  ·  P2

Now: F7: generic adapter only

```text
White-Label01-Crypto-Copy-Trading-App/
└── whitelabel-copytrade/apps/
    ├── api/src/modules/providers/adapters/kyc/
    │   ├── persona-webhook.verifier.ts  # NEW — Persona-Signature HMAC verification + timestamp tolerance
    │   ├── persona.adapter.ts           # NEW — PersonaKycAdapter: create inquiry, resume token, fetch status, map to internal KYC states
    │   └── persona.contract.spec.ts     # NEW — fixtures + signature failures
    └── web/src/features/onboarding/
        └── kyc-persona-widget.tsx       # NEW — embedded flow launcher
```

Done when: Contract spec passes; signature + replay tests pass.

#### GAP-130 - Chainalysis KYT adapter  ·  P1

Now: F7: generic AML adapter

```text
White-Label01-Crypto-Copy-Trading-App/
└── whitelabel-copytrade/apps/api/src/modules/
    ├── compliance/
    │   └── transaction-monitoring.service.ts  # EDIT — consume vendor alerts; explicit severity mapping table
    └── providers/adapters/aml/
        ├── aml.adapter.ts                     # EDIT — AmlProvider strategy interface
        ├── chainalysis-kyt.adapter.ts         # NEW — ChainalysisKytAdapter: Token header auth, register transfer/withdrawal address, fetch alerts + exposure, map severity to internal risk
        └── chainalysis.contract.spec.ts       # NEW — fixtures: no alert / HIGH alert / provider outage => ON_HOLD
```

Done when: Vendor outage => account ON_HOLD (fail closed); alerts map to compliance cases.

#### GAP-131 - Fireblocks custody adapter  ·  P1

Now: F7: generic custody adapter

```text
White-Label01-Crypto-Copy-Trading-App/
└── whitelabel-copytrade/apps/api/src/modules/providers/adapters/
    ├── custody/
    │   ├── fireblocks-webhook.verifier.ts  # NEW — RSA signature verification of the webhook body with the Fireblocks public key; replay protection
    │   ├── fireblocks.adapter.ts           # NEW — FireblocksCustodyAdapter: RS256 JWT request signing (uri + body hash + nonce), vault accounts, deposit addresses, create transaction, status, whitelisted-address check
    │   └── fireblocks.contract.spec.ts     # NEW — fixtures: pending/confirmed/failed, bad signature, signer unavailable => fail closed
    └── custody.adapter.ts                  # EDIT — CustodyProvider strategy interface; provider selected by tenant config (after GAP-107 this path holds the canonical code)
```

Done when: Signer/vault unavailable => fails closed BEFORE broadcast; webhook signature verified; contract spec green.

#### GAP-132 - Notification vendor adapters (email / SMS / push)  ·  P1

Now: generic `notification.adapter.ts`

```text
White-Label01-Crypto-Copy-Trading-App/
└── whitelabel-copytrade/apps/api/src/modules/providers/adapters/notification/
    ├── fcm-push.adapter.ts                     # NEW — FCM HTTP v1 (OAuth2 service account); token/topic send; invalid-token pruning
    ├── notification-adapters.contract.spec.ts  # NEW — fixtures: success, throttling, invalid token, bounce
    ├── notification.adapter.ts                 # EDIT — NotificationChannelProvider strategy interface
    ├── ses-email.adapter.ts                    # NEW — SES v2 SendEmail via SigV4; bounce/complaint webhook (SNS) handling; suppression list
    └── twilio-sms.adapter.ts                   # NEW — Twilio Messages API; status-callback signature verification
```

Done when: Bounce/complaint suppresses future sends; invalid push tokens are pruned.

#### GAP-133 - Telegram + Discord alert channels  ·  P2

Now: none (verified: no telegram/discord code in notifications)

```text
White-Label01-Crypto-Copy-Trading-App/
└── whitelabel-copytrade/apps/
    ├── api/
    │   ├── prisma/
    │   │   ├── migrations/<STAMP>_notification_channel_binding/
    │   │   │   └── migration.sql           # NEW — additive migration + tenant-scoped idempotency composite; then run scripts/gen_part11_rls.py for the additive RLS migration and refresh prisma/rls/rls_coverage.json
    │   │   └── schema.prisma               # EDIT — add model NotificationChannelBinding: tenantId, userId, channel, externalId (encrypted), status, linkedAt
    │   └── src/modules/notifications/channels/
    │       ├── discord-webhook.channel.ts  # NEW — DiscordWebhookChannel: per-user webhook URL (validated https discord.com/api/webhooks), embeds, rate-limit headers respected
    │       ├── telegram-discord.spec.ts    # NEW — link flow, rate limits, failure handling, no PII in logs
    │       └── telegram.channel.ts         # NEW — TelegramChannel: per-tenant bot token, /start link flow with one-time code, chat binding, rate limiting, template rendering, delivery receipts
    └── web/src/
        ├── features/notifications/
        │   └── channel-settings.tsx        # NEW — connect/disconnect Telegram/Discord; per-event toggles
        └── tests/
            └── channel-settings.test.tsx   # NEW — render + link flow
```

Done when: Link code is single-use + expiring; per-chat rate limit honoured; no tokens in logs.

### 7.D Block D: Clients: mobile parity + test depth (GAP-134-141)

#### GAP-134 - Mobile trader discovery + leaderboard + compare  ·  P1

Now: absent (only strategies_screen.dart)

```text
White-Label01-Crypto-Copy-Trading-App/
└── whitelabel-copytrade/apps/mobile/
    ├── lib/
    │   ├── core/
    │   │   ├── network/
    │   │   │   └── api_endpoints.dart          # EDIT — endpoint constants
    │   │   └── router/
    │   │       ├── app_router.dart             # EDIT — add routes /traders and /traders/compare
    │   │       └── route_paths.dart            # EDIT — route constants
    │   └── features/traders/
    │       ├── data/
    │       │   └── trader_repository.dart      # NEW — dio calls to /v1/copy-trading/traders (+ compare); maps ApiException; no float money math
    │       ├── domain/
    │       │   └── trader_models.dart          # NEW — TraderSummary, TraderMetrics (null = unavailable), TraderFilters; fromJson with exact-decimal strings
    │       └── presentation/
    │           ├── trader_compare_screen.dart  # NEW — side-by-side compare up to 3 traders
    │           ├── traders_controller.dart     # NEW — Riverpod AsyncNotifier: filters, sort, timeframe, pagination
    │           └── traders_screen.dart         # NEW — leaderboard list with timeframe + methodology selector, verification badge, "Not available" for null metrics
    └── test/features/traders/
        ├── trader_repository_test.dart         # NEW — mapping + error tests with a fake dio adapter
        └── traders_screen_test.dart            # NEW — widget test: loading / empty / error / unavailable-metric states
```

Done when: Screens reachable from navigation; every unavailable metric renders "Not available" (never 0); widget tests pass; `node scripts/check-web-api-contract.js` covers the mobile calls.

#### GAP-135 - Mobile trader profile + performance + risk  ·  P1

Now: absent

```text
White-Label01-Crypto-Copy-Trading-App/
└── whitelabel-copytrade/apps/mobile/
    ├── lib/features/traders/presentation/
    │   ├── widgets/
    │   │   └── performance_chart.dart       # NEW — equity/drawdown chart with benchmark overlay and unavailable states
    │   ├── trader_profile_controller.dart   # NEW — loads profile + performance + risk
    │   └── trader_profile_screen.dart       # NEW — profile header, verification, AUM/followers with provenance, risk score + factor freshness, exposure panel
    └── test/features/traders/
        └── trader_profile_screen_test.dart  # NEW — states + null metrics
```

Done when: Screens reachable from navigation; every unavailable metric renders "Not available" (never 0); widget tests pass; `node scripts/check-web-api-contract.js` covers the mobile calls.

#### GAP-136 - Mobile follow wizard + copy settings  ·  P1

Now: one `copy_trading_screen.dart`

```text
White-Label01-Crypto-Copy-Trading-App/
└── whitelabel-copytrade/apps/mobile/
    ├── lib/features/copy_trading/
    │   ├── data/
    │   │   └── copy_trading_repository.dart  # EDIT — subscribe + update-policy calls
    │   ├── domain/
    │   │   └── copy_policy_models.dart       # NEW — CopyPolicy DTO with exact decimals
    │   └── presentation/
    │       ├── copy_settings_screen.dart     # NEW — edit policy: sizing, slippage, TP/SL/trailing, symbol allow/deny, budget
    │       ├── copy_wizard_controller.dart   # NEW — wizard state + validation mirroring server rules
    │       └── follow_wizard_screen.dart     # NEW — multi-step: account -> mode (SMART/ADVANCED/DEMO) -> sizing -> risk guardrails -> disclosure consent -> confirm
    └── test/features/copy_trading/
        └── follow_wizard_test.dart           # NEW — validation + step flow
```

Done when: Screens reachable from navigation; every unavailable metric renders "Not available" (never 0); widget tests pass; `node scripts/check-web-api-contract.js` covers the mobile calls.

#### GAP-137 - Mobile copied positions / orders + stop-copy  ·  P1

Now: absent

```text
White-Label01-Crypto-Copy-Trading-App/
└── whitelabel-copytrade/apps/mobile/
    ├── lib/features/copy_trading/presentation/
    │   ├── copied_orders_screen.dart     # NEW — orders history with filters + cursor pagination
    │   ├── copied_positions_screen.dart  # NEW — positions list with manual close (reduce-only intent)
    │   ├── copy_trading_screen.dart      # EDIT — navigate to the new screens
    │   └── stop_copy_sheet.dart          # NEW — bottom sheet: stop policy (keep positions / market close all) with confirmation + step-up
    └── test/features/copy_trading/
        └── copied_positions_test.dart    # NEW — list, close, stop-policy flows
```

Done when: Screens reachable from navigation; every unavailable metric renders "Not available" (never 0); widget tests pass; `node scripts/check-web-api-contract.js` covers the mobile calls.

#### GAP-138 - Mobile push notifications + device registration  ·  P1

Now: F12: no firebase_messaging

```text
White-Label01-Crypto-Copy-Trading-App/
└── whitelabel-copytrade/apps/
    ├── api/
    │   ├── prisma/
    │   │   ├── migrations/<STAMP>_device_token/
    │   │   │   └── migration.sql                    # NEW — additive migration + tenant-scoped idempotency composite; then run scripts/gen_part11_rls.py for the additive RLS migration and refresh prisma/rls/rls_coverage.json
    │   │   └── schema.prisma                        # EDIT — add model DeviceToken: tenantId, userId, platform, tokenHash, tokenCiphertext, deviceId, lastSeenAt
    │   └── src/modules/notifications/
    │       ├── device-token.controller.ts           # NEW — register/unregister device tokens (tenant + user scoped, permission-decorated)
    │       ├── device-token.service.ts              # NEW — persist tokens, prune invalid, per-user cap
    │       └── device-token.spec.ts                 # NEW — isolation, cap, prune
    └── mobile/
        ├── lib/features/notifications/data/
        │   ├── device_registration_repository.dart  # NEW — POST /v1/notifications/devices (register/unregister) using device_identity.dart
        │   └── push_service.dart                    # NEW — FCM init, permission request, token refresh, foreground/background handlers
        ├── test/features/notifications/
        │   └── push_service_test.dart               # NEW — token refresh + registration with a fake messaging layer
        └── pubspec.yaml                             # EDIT — add firebase_core, firebase_messaging, flutter_local_notifications
```

Done when: Token refresh re-registers the device; invalid tokens are pruned server-side; tenant/user isolation proven.

#### GAP-139 - Mobile biometric app lock  ·  P2

Now: F12: no local_auth

```text
White-Label01-Crypto-Copy-Trading-App/
└── whitelabel-copytrade/apps/mobile/
    ├── lib/
    │   ├── core/security/
    │   │   ├── app_lock_controller.dart   # NEW — locks app after inactivity/backgrounding; secure-storage flag
    │   │   └── biometric_gate.dart        # NEW — BiometricGate: availability check, authenticate, fail closed when lock is on but biometrics are unavailable
    │   └── features/settings/
    │       └── security_screen.dart       # EDIT — toggle biometric lock
    ├── test/core/security/
    │   └── app_lock_controller_test.dart  # NEW — lock/unlock flows
    └── pubspec.yaml                       # EDIT — add local_auth
```

Done when: Lock engages on background/inactivity; unavailable biometrics with lock enabled fails closed.

#### GAP-140 - Mobile platform scaffolding + build CI + test depth  ·  P0

Now: F15: no `android/` or `ios/` folders; CI = analyze + test; 3 test files

```text
White-Label01-Crypto-Copy-Trading-App/
├── .github/workflows/
│   └── ci.yml                           # EDIT — mobile job adds flutter build apk --debug; iOS --no-codesign build on a macOS job (tag/schedule)
└── whitelabel-copytrade/
    ├── apps/mobile/
    │   ├── android/app/
    │   │   ├── src/main/
    │   │   │   └── AndroidManifest.xml  # NEW — permissions minimal (INTERNET, POST_NOTIFICATIONS); deep-link config
    │   │   └── build.gradle             # NEW — applicationId from --dart-define / flavor per tenant; no keystore committed
    │   ├── ios/
    │   │   ├── Runner.xcodeproj/
    │   │   │   └── project.pbxproj      # NEW — generated Xcode project; signing left to the tenant build pipeline
    │   │   └── Runner/
    │   │       └── Info.plist           # NEW — bundle id/name from build config; FaceID usage string; no ATS exceptions
    │   ├── store/
    │   │   └── README.md                # NEW — store listing checklist (screenshots, privacy labels, data-safety form) - metadata only
    │   ├── test/core/network/
    │   │   └── api_client_test.dart     # NEW — auth interceptor refresh/rotation + error mapping
    │   └── .metadata                    # NEW — generated by flutter create --platforms=android,ios . (commit it)
    └── scripts/
        └── mobile-tenant-build.mjs      # NEW — injects tenant bundle id/name/icons/API base URL via --dart-define and flavors; no secrets
```

Done when: `flutter build apk --debug` succeeds in CI; iOS no-codesign build succeeds on the macOS job; >= 30 tests pass; no secrets in the repo.

#### GAP-141 - Admin-web test depth  ·  P1

Now: 3 test files for 29 admin pages

```text
White-Label01-Crypto-Copy-Trading-App/
└── whitelabel-copytrade/apps/admin-web/
    ├── src/tests/
    │   ├── billing-plans.test.tsx           # NEW — plan catalog management validations
    │   ├── branding-editor.test.tsx         # NEW — sanitization + preview (after GAP-88)
    │   ├── compliance-case-detail.test.tsx  # NEW — decision requires rationale >= 10 chars; audit timeline order
    │   ├── observability-slo.test.tsx       # NEW — SLO + alert controls
    │   ├── partners-admin.test.tsx          # NEW — lifecycle transitions + invalid-transition rejection
    │   ├── risk-kill-switch.test.tsx        # NEW — kill switch requires reason + confirmation; error state shows fail-closed banner
    │   ├── roles-permissions.test.tsx       # NEW — role matrix rendering + permission gating
    │   └── settings-page.test.tsx           # NEW — tenant settings validation
    └── package.json                         # EDIT — jest coverageThreshold (lines >= 60) + test:coverage script
```

Done when: Coverage >= 60% lines and every console route group has at least one behavioural test.

### 7.E Block E: Evidence and ops (GAP-142-147)

#### GAP-142 - DAST baseline  ·  P1

Now: none

```text
White-Label01-Crypto-Copy-Trading-App/
├── .github/workflows/
│   └── dast.yml           # NEW — OWASP ZAP baseline against the staging-proof stack (API + web + admin); uploads HTML/JSON report; fails on HIGH
└── whitelabel-copytrade/
    ├── docs/evidence/dast/
    │   └── REPORT.md      # NEW — run date, commit, findings, fixes/acceptances
    └── ops/zap/
        └── baseline.conf  # NEW — rule tuning with a written justification per ignored rule
```

Done when: Zero HIGH findings, or a documented acceptance signed by the owner.

#### GAP-143 - DR drill executed  ·  P1

Now: tooling only (`dr-rehearsal.mjs`, `dr-manifest.mjs`); no recorded drill

```text
White-Label01-Crypto-Copy-Trading-App/
├── .github/workflows/
│   └── dr-drill.yml            # NEW — monthly scheduled drill on ephemeral Postgres; uploads evidence
└── whitelabel-copytrade/
    ├── docs/evidence/dr/
    │   └── DR_DRILL_RESULT.md  # NEW — measured RTO/RPO, steps, failures, fixes; date + commit
    └── scripts/
        ├── dr-drill.sh         # NEW — pg_dump -> restore into a scratch DB -> RLS verification + row counts + migration state -> RTO timing; wraps scripts/dr-rehearsal.mjs
        └── dr-rehearsal.mjs    # EDIT — emit JSON consumed by dr-drill.sh
```

Done when: Measured RTO/RPO recorded; restore verified with RLS checks + row counts.

#### GAP-144 - Failure-injection suite  ·  P1

Now: (R) Redis failure / rate limits / DB failover not exercised

```text
White-Label01-Crypto-Copy-Trading-App/
├── .github/workflows/
│   └── ci.yml                  # EDIT — nightly chaos job
└── whitelabel-copytrade/tests/chaos/
    ├── db-failover.spec.ts     # NEW — DB connection drop mid-transaction: no partial ledger entry, idempotent retry
    ├── engine-timeout.spec.ts  # NEW — engine slow/unreachable: OMS state consistent, kill-switch honoured
    ├── jest.config.js          # NEW — separate config; excluded from default npm test
    ├── README.md               # NEW — how to run locally and in the nightly job
    ├── redis-down.spec.ts      # NEW — API + worker with Redis cut: rate limiter, idempotency, queue fail closed; no order sent
    ├── toxiproxy.compose.yml   # NEW — Toxiproxy in front of Redis, Postgres and a venue mock
    └── venue-5xx-429.spec.ts   # NEW — venue mock returns 5xx/429: backoff, no duplicate order, incident created
```

Done when: All four chaos specs pass; each asserts fail-closed behaviour (no order transmitted when state is uncertain).

#### GAP-145 - Dashboards-as-code + alert validation  ·  P2

Now: Prometheus rules (`wlct.rules.yml`) + `metrics-catalog.json` exist; no Grafana dashboards

```text
White-Label01-Crypto-Copy-Trading-App/
├── .github/workflows/
│   └── ci.yml                            # EDIT — validate-observability step
└── whitelabel-copytrade/
    ├── infrastructure/observability/grafana/
    │   ├── dashboards/
    │   │   ├── copy-latency.json         # NEW — leader->follower latency p50/p95/p99, stream lag, DLQ depth
    │   │   ├── execution-venues.json     # NEW — order success/reject by venue, rate-limit budget, clock drift, stream health
    │   │   └── tenant-business.json      # NEW — tenants, copiers, AUM freshness, fee accrual status
    │   └── provisioning/
    │       ├── dashboards.yml            # NEW — file provider config
    │       └── datasources.yml           # NEW — Prometheus datasource
    ├── scripts/
    │   └── validate-observability.sh     # NEW — promtool check rules + jq schema check of dashboards + catalog cross-check
    └── docker-compose.observability.yml  # EDIT — add grafana service with provisioning mounts
```

Done when: `scripts/validate-observability.sh` is green in CI; every alert references a metric that exists in the catalog.

#### GAP-146 - One-command tenant provisioning + demo tenant  ·  P1

Now: `prisma/seed.ts` demo data only

```text
White-Label01-Crypto-Copy-Trading-App/
└── whitelabel-copytrade/
    ├── apps/api/prisma/
    │   ├── seed/
    │   │   └── demo-tenant.ts        # NEW — demo tenant with leaders, followers, paper-trading history, a partner, sample compliance cases - deterministic
    │   └── seed.ts                   # EDIT — call the demo seed only when SEED_DEMO=true
    ├── docs/
    │   └── PROVISION_TENANT.md       # NEW — runbook
    └── scripts/
        ├── provision-tenant.test.ts  # NEW — idempotency, validation, rollback on failure
        └── provision-tenant.ts       # NEW — CLI: --name --slug --admin-email --plan --domain; idempotent; creates tenant, admin, plan assignment, default branding, domain DNS challenge; no secrets in logs
```

Done when: Running the CLI twice yields one tenant; a CI test covers failure rollback; the demo seed is deterministic.

#### GAP-147 - Capacity + cost-per-tenant model  ·  P2

Now: none

```text
White-Label01-Crypto-Copy-Trading-App/
└── whitelabel-copytrade/docs/
    ├── CAPACITY_MODEL.md   # NEW — tenants/followers per node derived from docs/evidence/load results; scaling levers
    └── COST_PER_TENANT.md  # NEW — infra cost model from infra/production/terraform sizes + vendor fees; assumptions explicit
```

Done when: Every number in the docs traces to an evidence file or an explicit assumption.

### 7.F Block F: Sale pack and final regression (GAP-148-150)

#### GAP-148 - IP / licence pack  ·  P1

Now: proprietary LICENSE in the owner name; no assignment pack

```text
White-Label01-Crypto-Copy-Trading-App/
└── whitelabel-copytrade/
    ├── docs/sale/
    │   ├── templates/
    │   │   ├── commercial-source-license.md  # NEW — template - for counsel review, not legal advice
    │   │   └── ip-assignment.md              # NEW — template - for counsel review, not legal advice
    │   ├── IP_ASSIGNMENT_CHECKLIST.md        # NEW — who authored what, contributor agreements, third-party code, trademark/domain, repository ownership transfer steps (checklist for counsel)
    │   ├── LICENSE_ALLOWLIST.md              # NEW — reasoned allowlist consumed by scripts/license-gate.mjs
    │   └── THIRD_PARTY_IP_INVENTORY.md       # NEW — generated from the SBOM + manual review of vendored assets, fonts, icons
    └── LICENSE                               # EDIT — keep proprietary until transfer; wording consistent with the chosen sale structure
```

Done when: Counsel-review-ready pack; nothing in it claims legal effect.

#### GAP-149 - Demo environment + data room  ·  P1

Now: none

```text
White-Label01-Crypto-Copy-Trading-App/
└── whitelabel-copytrade/
    ├── docs/sale/
    │   ├── DATA_ROOM_INDEX.md    # NEW — index: architecture, evidence/*, test reports, security, DR, runbooks, SBOM, cost model, roadmap
    │   ├── DEMO_SCRIPT.md        # NEW — 10-minute walkthrough: tenant branding -> trader discovery -> follow -> leader fill -> copy -> kill-switch -> compliance case -> partner payout
    │   └── KNOWN_LIMITATIONS.md  # NEW — honest list: unproven venues, pending vendor integrations, no production traffic, manual steps (RLS enable)
    ├── scripts/
    │   └── demo-up.sh            # NEW — build + migrate + seed demo + print URLs and demo-only credentials
    └── docker-compose.demo.yml   # NEW — one-command demo: api, web, admin, engine in PAPER mode, seeded demo tenant, mail catcher
```

Done when: A stranger can run `scripts/demo-up.sh` and follow DEMO_SCRIPT end to end in <= 15 minutes.

#### GAP-150 - Final honest regression + report  ·  P0

Now: F1-F3: scanners are static; reports drift

```text
White-Label01-Crypto-Copy-Trading-App/
├── whitelabel-copytrade/
│   ├── docs/
│   │   └── GAP_101_150_FINAL_REPORT.md         # NEW — per GAP: status word, files, commands + exit codes + counts, BLOCKED reasons; scorecard before/after
│   ├── ops/
│   │   ├── gap-parity-scanner-101-150.js       # NEW — declarative rubric; criteria are BEHAVIOUR + WIRING signals (named tests that must exist and pass, module registration, route mounted), never file presence; weights; no hard-coded statuses
│   │   └── gap-parity-scanner-101-150.test.js  # NEW — regression: rejects file-presence-only evidence, shims, orphan services
│   ├── NEXT.md                                 # EDIT — inner copy; keep byte-identical to the outer one (script copies it)
│   └── RELEASE_MANIFEST.json                   # EDIT — regenerate with scripts/generate-release-manifest.ts after every gate is green
├── NEXT.md                                     # EDIT — append a GAP-101-150 section; never delete GAP-01-100 history (outer copy)
└── RELEASE_PACKAGE_CHECK.md                    # EDIT — refresh counts after regeneration
```

Done when: Scanner 101-150 passes on behaviour signals; the report matches the tree (drift check green); NEXT.md appended; manifest regenerated; the §1 scorecard is re-scored honestly (do not round up).

---

## 8. Acceptance gates (run from `whitelabel-copytrade/`; record command, exit code, counts)

A script named below that does not exist yet is created by the GAP in brackets. Do not invent substitutes; use the `npm run` names that really exist in `package.json`.

| # | Gate | Command | Must be |
|---|---|---|---|
| 1 | Install | `npm ci` | exit 0 |
| 2 | Prisma | `npx prisma validate --schema apps/api/prisma/schema.prisma` then `npx prisma generate --schema apps/api/prisma/schema.prisma` | exit 0 (engine download needed: if the network denies it, mark BLOCKED with the cause) |
| 3 | API typecheck [GAP-101] | `NODE_OPTIONS=--max-old-space-size=6144 npm run typecheck:ci --workspace=@wlct/api` | exit 0 |
| 4 | API build [GAP-102] | `npm run build --workspace=@wlct/api` | exit 0 and `dist/main.js` exists |
| 5 | API lint [GAP-103] | `npm run lint --workspace=@wlct/api` | exit 0 with `--max-warnings=0` |
| 6 | API tests | `npm test --workspace=@wlct/api` | all pass, ts-jest diagnostics ON; record suites and tests |
| 7 | Web + admin | `npm run typecheck`, `npm test`, `npm run lint` in `apps/web` and `apps/admin-web` | exit 0 |
| 8 | Python | `python -m pytest -q` in `libs/trading-core`, `services/execution-engine`, `services/market-data`, `services/trading-engine`, `services/notification-service` (install optional deps first, e.g. `httpx`) | 0 failed |
| 9 | Rust | `cargo test` in `services/low-latency-gateway` and `packages/sdk-rust` | exit 0 |
| 10 | Mobile [GAP-140] | `flutter analyze && flutter test`, then `flutter build apk --debug` in `apps/mobile` | exit 0 |
| 11 | Validators | `npm run check:route-authorization` · `node ops/gap-parity-scanner.js` · `node ops/gap-parity-scanner-51-100.js` · `node ops/gap-parity-scanner-101-150.js` [GAP-150] · `npm run check:wiring` [GAP-106] · `npm run check:report-drift` [GAP-106] | exit 0; the 51–100 scanner shows 0 PARTIAL |
| 12 | Staging proof [GAP-105] | `bash scripts/staging-proof.sh` | exit 0; `docs/evidence/staging-proof.json` written |
| 13 | Browser E2E [GAP-104] | `npx playwright test` | all pass |
| 14 | Security [GAP-110, 111] | root `security.yml` green; `node scripts/generate-sbom.mjs && node scripts/license-gate.mjs` | exit 0 |
| 15 | Venue evidence [GAP-120] | `docs/evidence/venue-testnet/*.json` | one per venue, dated, with commit SHA |
| 16 | Load, DR, chaos [GAP-122, 143, 144] | evidence files + `npx jest -c tests/chaos/jest.config.js` | recorded numbers; 4 chaos specs pass |

---

## 9. Final report format (`docs/GAP_101_150_FINAL_REPORT.md`)

1. One table row per GAP (101–150) and per carry-over item (51–100): `GAP | status word | files changed | tests added (names) | commands + exit codes + counts | BLOCKED reason | evidence file`.
2. A "Not run" section: every gate in section 8 that could not run, with the cause (OOM, no network, missing credentials).
3. Scorecard before/after using the SAME rubric and weights as section 1. Do not round up. Explain every changed percentage with a file or test name.
4. Owner decisions still open: venue testnet keys, vendor credentials (Sumsub, Chainalysis, Fireblocks, SES, Twilio, FCM), legal review of the IP pack, branding assets, domain/DNS.
5. Never mark `VERIFIED_RUNTIME` when the only evidence is file existence, a scanner string match, or a test that does not call the code under test.

---

## 10. Sources (read 2026-10-08; vendor and listing claims, not independently validated)

- Bybit, Copy Mode and Parameter Settings (Classic): https://www.bybit.com/en/help-center/article/Copy-Trading-Copy-Mode-and-Parameters-Settings
- Bitget, Futures copy trading (Smart Copy, SL/TP ratio, slippage limit): https://www.bitget.com/support/articles/12560603826748
- copy.cc, packages and pricing: https://copy.cc/
- B2COPY (B2Broker): https://b2broker.com/products/b2copy/white-label/ · fee types: https://b2broker.com/products/b2copy/knowledge-base/concepts/fee-list/ · product site: https://b2copy.b2broker.com/
- Zignaly, directory listings: https://www.quicknode.com/builders-guide/tools/zignaly-by-zignaly · https://www.trustradius.com/products/zignaly/details
- Finestel, G2 pricing listing: https://www.g2.com/products/finestel-white-label-crypto-copy-trading/pricing
- Low-end self-hosted listings: https://nixvano.gumroad.com/l/vanoai · https://vopospark.gumroad.com/l/jlqhn
- Not re-checked in this audit: Binance and OKX copy-trading documentation (cited in the repo's own `docs/NEXT_51_100_FINAL_REPORT.md` section 7).

End of file.
