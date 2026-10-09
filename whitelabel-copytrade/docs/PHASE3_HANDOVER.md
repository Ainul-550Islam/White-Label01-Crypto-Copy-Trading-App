# Phase 3 handover: gap-audit remediation (2026-09-28)

This document records what the gap-audit pass changed, how each change was
verified, what is still not production-ready, and what a buyer or operator must
do before real money flows. It is the current source of truth for readiness;
older `PART*` documents describe history.

---

## 1. Audit items and their status

| # | Audit item | Status | Where |
| --- | --- | --- | --- |
| 1 | Wire CopyExecution to real execution, prove end to end in sandbox | **Done (paper)**: leader event -> sizing -> risk -> OMS intent -> BullMQ `SUBMIT_ORDER` -> worker -> engine `POST /internal/v1/orders/submit` -> result listener updates Order and CopyExecution | `apps/api/src/modules/copy-trading/copy-execution.service.ts`, `apps/api/src/modules/oms/order-routing.service.ts`, `apps/api/src/modules/oms/order-submission-result.service.ts`, `apps/api/src/modules/worker/trade-execution.processor.ts`, `services/execution-engine/app/orders/submission.py` |
| 2 | Full Bybit / OKX / Kraken / Coinbase adapters | **Done** (REST: auth/signing, balances, positions, orders, cancel, symbol rules, health) | `apps/api/src/modules/exchanges/providers/` |
| 3 | Activate orphan modules | **Done** in Phase 1-2 (module imports, DI, migrations); Phase 3 removed remaining fake paths (custody sha256 addresses, recovery "success" stubs, billing single-tenant placeholders) | `apps/api/src/modules/custody/`, `apps/api/src/modules/operations/recovery-plan.service.ts`, `apps/api/src/modules/billing/finance/tenant-iteration.ts` |
| 4 | Binance `isAvailable` and capability declarations | **Done** | `apps/api/src/modules/exchanges/base-exchange-provider.ts` |
| 5 | Risk calculations + deterministic tests | **Done** | `apps/api/src/modules/risk-management/day-start-equity.ts`, `apps/api/src/modules/risk-management/risk-calculations.spec.ts` |
| 6 | Leader-event ingestion + missing-copy reconciliation | **Done** | `apps/api/src/modules/copy-trading/leader-event-source.service.ts`, `apps/api/src/modules/copy-trading/leader-event-ingestion.service.ts`, `apps/api/src/modules/copy-trading/copy-reconciliation.service.ts` |
| 7 | Secret-manager integration | **Done** (Vault KV v2, AWS Secrets Manager) | `apps/api/src/modules/exchanges/secret-store.ts` |
| 8 | Flutter parity: exchange / copy / funding / portfolio / notifications | **Done** | `apps/mobile/lib/features/` |
| 9 | CI, reproducible build, LICENSE / handover docs, README state | **Done** | `../.github/workflows/ci.yml`, `LICENSE`, `README.md`, this file |

---

## 2. Verification performed

| Suite | Result |
| --- | --- |
| API jest (all 50 suites) | 1079 passed, 0 failed |
| New/changed API specs, `tsc --noEmit` per spec | clean (copy-trading specs checked with a Prisma type stub because the full graph exceeds the build box's memory; CI runs the real type-checked jest) |
| execution-engine pytest incl. live Postgres under a NOSUPERUSER role | 534 passed |
| trading-core / market-data / trading-engine / sdk-python pytest | 1767 / 19 / 43 / 6 passed |
| Flutter 3.47.5 `flutter analyze` | 0 errors, 0 warnings |
| Flutter `flutter test` | 35 passed |
| GitHub workflows (actionlint) | clean |
| `packages/sdk-rust` `cargo test --locked` | 3 passed |
| Terraform 1.8.5 `fmt -check` + `validate` (no backend) | valid |
| `scripts/check-terraform-api-env.mjs` (Terraform API task env through the production env schema) | valid: 12 plain + 13 secret variables |
| DR manifest, ops 50/60/50/50 checks, web 50 checks | all pass |
| AWS SigV4 signer vs botocore reference vectors | identical signatures (with and without session token) |

---

## 3. Behaviour a buyer must know

### Execution

* Submission is **PAPER only**. The engine route returns 409 for any adapter
  that is not simulated; `EXECUTION_ENABLED=false` remains the platform-wide
  gate. Going live is a deliberate, reviewed change per
  `docs/PART19_LIVE_ENABLEMENT.md`, not a flag flip.
* Copy environment: a follower account with `isSandbox === false` resolves to
  LIVE and is refused downstream; everything else is PAPER.
* OMS `clientOrderId` format is `oms` + 32 hex chars (engine limit 36 chars,
  BullMQ job ids cannot contain `:`); job id `oms-submit-<clientOrderId>`.
* Worker treats engine 401/403/404/409/422/501 as terminal (no retry).

### Leader events

* Source: FILL rows on the strategy owner's exchange accounts (or
  `strategyConfig.leaderAccountId`), event id `fill:<fillId>`, MARKET follow.
  Copy fills, dry-run fills and unsupported symbols/venues are excluded.
* Poll every `COPY_LEADER_INGESTION_INTERVAL_MS` (5 s); fills older than
  `COPY_LEADER_EVENT_MAX_AGE_MS` (30 s) expire and are never replayed.
* Idempotent on (tenant, leaderEventId, subscription).
* Trader gate before any copy: the strategy's TraderProfile must exist in the
  tenant and not be SUSPENDED/REJECTED, and no BLOCK compliance case may be
  open on the trader's *user*; a failed lookup blocks too. The manual
  `POST /copy-trading/executions/leader-event` endpoint takes the trader from
  the strategy and rejects a mismatching `traderId`.
* Reconciliation: MISSING_COPY is HIGH after a 60 s grace; SKIPPED and FAILED
  copies are flagged.

### Risk

* Daily loss and intraday drawdown are UNKNOWN until the first day-start
  equity snapshot exists; UNKNOWN is never reported as zero.
* Stress model: market/gap/correlated shocks on signed net exposure;
  spread/slippage on gross; liquidity = gross x impact x multiplier;
  vol-expansion needs `initialMarginRatePercent`; outage reports venue gross
  with PnL null.

### Credentials

* `ENVELOPE_DB` (default) or `SECRET_MANAGER` (Vault KV v2 path
  `secret/data/wlct/{tenant}/{account}/{exchange}`, the same path the
  execution engine reads; or AWS Secrets Manager with static/env credentials,
  no IRSA). Path segments reject `.`/`..`. An UNKNOWN environment is accepted
  only for non-LIVE accounts. Secret deletion on account removal is
  best-effort.

### Billing

* Platform jobs iterate ACTIVE and SUSPENDED tenants (default 1000, max
  10000); a failing tenant is reported, not fatal.
* Platform analytics are single currency (USD, minor units).
* TRADER payouts require a same-tenant TraderProfile and refuse non-UUID,
  SUSPENDED or REJECTED beneficiaries.
* No billing path reports a success it did not get
  (`apps/api/src/modules/billing/billing-no-fake-success.spec.ts`):
  * payment records: a missing Payment table or delegate throws
    (`payments/payment.repository.ts`); no unpersisted "fallback" record.
  * push: real FCM send through `firebase-admin` when `PUSH_ENABLED=true`,
    a device token is present and a Firebase app can be initialised;
    otherwise an explicit failure code. `firebase-admin` (^13.10, Node 18+)
    is an `apps/api` optionalDependency, loaded lazily; credentials come from
    `FIREBASE_PROJECT_ID` / `FIREBASE_CLIENT_EMAIL` /
    `FIREBASE_PRIVATE_KEY_BASE64` when all three are set, otherwise
    application default credentials.
  * SMS: `SMS_PROVIDER=twilio` selects the Twilio REST adapter
    (`notifications/twilio-sms.provider.ts`), returned only when account SID,
    auth token or API key, and Messaging Service or E.164 From number are all
    set. The recipient must be E.164 (`recipient.phone` / `userPhone`);
    "accepted" means Twilio queued it (message sid), 429/5xx are retryable,
    other 4xx permanent. Anything else fails closed. The outbound webhook
    channel reports unavailable here (webhook jobs are routed by the delivery
    service itself).
  * in-app notifications are persisted and published over the realtime
    gateway (`notification.created`); a realtime failure does not lose the row.
  * payouts: `STRIPE` = Stripe Connect Transfers
    (`fees/stripe-connect-payout.provider.ts`) to the beneficiary's connected
    account (`stripe_account` destination, `acct_...`), with the payout
    idempotency key as Stripe's `Idempotency-Key` and exact decimal-to-minor
    unit conversion (zero- and three-decimal currencies included). Without an
    `sk_`/`rk_` key it fails closed. A transfer is SUCCEEDED once Stripe
    returns it (REVERSED if reversed); the connected account's own payout to
    its bank is Stripe's schedule. `INTERNAL` remains a ledger-only provider
    that marks the payout settled by the operator. Bank and crypto payouts
    have no adapter and fail closed.
  * usage export status is not tracked: the endpoint helper returns 404
    rather than a fabricated COMPLETED.
  * churn: gross revenue retention = 100 - revenue churn %; net revenue
    retention is `null` because expansion MRR is not measured.
  * plan delete is scoped to the caller's tenant.
* Tax rates: built-in defaults overlaid by `TAX_RATES_JSON` (`"CC"` or
  `"CC-REGION"` keys, basis points; invalid JSON fails the boot), and
  `TAX_UNKNOWN_COUNTRY=reject` makes a country without a rate fail the invoice
  instead of charging 0% (`finance/tax-rates.config.ts`).
* Invoices use the tenant's tax profile (`countryCode`, and `metadata`
  billingRegion / vatNumber / taxId / isBusinessCustomer / isTaxExempt).
  Previously the country was read from a query that never selected it, so
  every invoice was taxed as `US` (0%) and exemptions / reverse charge never
  applied (`finance/tax-reverse-charge.spec.ts`).
* EU B2B reverse charge needs evidence for the VAT number
  (`finance/vies-vat.client.ts`): `TAX_VAT_VALIDATION=format` (default,
  per-member-state format), `vies` (confirmed by the EU VIES REST service;
  if VIES cannot answer, VAT is charged) or `none`. `TAX_SUPPLIER_COUNTRY`
  keeps same-country customers on domestic VAT; `TAX_VIES_REQUESTER_VAT`
  makes VIES return a consultation number, stored in the invoice metadata
  (`vatCheck`) with the result. Rates and rules are still the operator's
  responsibility: have `TAX_RATES_JSON` reviewed by an accountant.
* Plans, entitlements and limits (root `tests/billing`, `npm run
  test:billing-lib`, 181 tests, in CI): plan update and limit get/update/delete
  are tenant-scoped; the entitlement resolver refuses another tenant's data;
  unlimited entitlements are checked before reset windows; downgrade checks
  count only limits in use; RATE/BURST limits are enforced (they never were);
  zero thresholds are honoured (`??` instead of `||`). The `billing/catalog`
  plan templates differ from `FEATURE_DEFINITIONS` (e.g. basic has
  `real_time_data`, lacks `market_data` / `two_factor_auth`); the catalog is
  not used by application code, the differences are pinned in
  `plan_catalog.spec.ts` for a product decision.

### Tenancy

* Tenant scope comes only from the verified JWT (`tid`); platform-wide access
  only from the server-side `isPlatformUser` flag
  (`apps/api/src/common/guards/request-principal.ts`). No controller reads an
  `x-tenant-id` header any more; a token without a tenant gets 403.

### Custody

* Only the `internal-ledger` evidence provider ships. It reads recorded
  transactions, reports `isHealthy=false` and cannot issue addresses, so
  deposit-address generation and sweeps **fail closed** until a real
  custodian/chain adapter is added in
  `apps/api/src/modules/custody/blockchain-provider.factory.ts`.
* The custody controller takes tenant and scope only from the authenticated
  user (cross-tenant access is 403; header-supplied scope is ignored).

### Recovery

* Recovery checks are real read-only checks (Redis ping, `SELECT 1`, unsynced
  orders, filled-without-fills, open discrepancies, kill switches, compliance
  blocks, credentials) and fail when unclean. Queue retry, execution reconnect
  and compliance review raise `RECOVERY_MANUAL_ACTION_REQUIRED`.

### Mobile

* Not on mobile by design: enabling LIVE trading, key rotation/revocation, IP
  allow-lists, withdrawals.
* Exchange secrets are sent once, never stored or logged; subscribe requires
  a risk acknowledgement and uses a per-form idempotency key; portfolio shows
  API facts only with partial-panel degradation.
* `intl` was raised to `^0.20.2` and `http` declared explicitly so the
  client resolves on current Flutter stable; the previously uncompilable
  `lib/features/billing/` module (not routed) now compiles against the real
  `ApiClient` and the versioned base path.

---

## 4. Known limits and open items

1. **Live trading is not wired.** Adapters exist, but the engine's submit path
   is paper-only by design until a venue passes live review.
2. **No external custody adapter.** Deposits and sweeps fail closed.
3. **Terraform** now matches the API env schema (checked in CI by
   `scripts/check-terraform-api-env.mjs` and `terraform validate`), but it has
   never been applied: the operator must populate the Secrets Manager JSON
   keys (`encryption`: masterKeyBase64 / keyId / blindIndexKeyBase64;
   `service`: internalServiceToken / exchangeWebhookSigningSecret /
   metricsToken) and review sizing before the first `plan`.
4. **Billing providers still not included:** bank and crypto payouts and an
   external tax engine (Avalara, Stripe Tax, …). Payouts fail closed; tax
   uses the configurable internal rules (section 3, Billing).
5. The whole-program API `tsc` cannot finish on the 2 GB build box (killed at
   1.7 GB heap after 26 min); CI's `npm run typecheck` is the authority. Every
   changed file was type-checked on its own.
6. The existing TypeScript sources are not Prettier-formatted to
   `apps/api/.prettierrc`, and lint is not a CI gate; new files are formatted.
   Reformatting everything is one mechanical commit the owner should schedule
   (it touches most files and would bury real changes in review).

Resolved in this phase (previously listed here): `x-tenant-id` header
fallbacks removed; Terraform env names aligned (plus REDIS_HOST, dataset
roots, Swagger off, and an invalid `deployment_configuration` block that made
`terraform validate` fail); billing placeholders that faked success fixed;
`packages/sdk-rust` tested in CI; operations dependency-health checks the
variables the API really requires. Later: root `tests/` rewritten against the
current billing library (181 tests, in CI, 7 source bugs fixed); `isAdmin` in
copy-trading/research now matches the real `SUPER_ADMIN`/`TENANT_ADMIN` keys
(admins were locked out of trader verification, reconciliation and promotion
approval); leader-event compliance now checks the trader's *user* (it queried
the profile id, so a compliance-blocked trader was still copied), blocks
unknown / SUSPENDED / REJECTED traders, and the endpoint takes the trader from
the strategy (a caller-supplied `traderId` could name a clean trader);
Stripe Connect payouts, Twilio SMS, `firebase-admin`, `TAX_RATES_JSON`,
invoice tax profile (every invoice was 0%), VIES / VAT-format evidence for
reverse charge; Redis
AUTH token in Terraform (`REDIS_PASSWORD` from the `redis-auth` secret), so
the `ops/production` policy and the deployed topology agree.

---

## 5. Buyer / operator checklist before production

- [ ] Run CI green on the target commit (node, database, python, mobile, rust, terraform jobs).
- [ ] Generate per-environment keys: `node scripts/generate-keys.mjs --write <file>`.
- [ ] Choose a credential store; for Vault/AWS set the variables documented in `.env.example`.
- [ ] Populate the Terraform-managed secrets (section 4, item 3). The `redis` secret's `url` must carry the generated AUTH token from `<prefix>/redis-auth` (`rediss://:<password>@<endpoint>:6379`).
- [ ] Billing providers: `PAYOUT_PROVIDER=stripe` + `STRIPE_SECRET_KEY` (connected accounts onboarded), `SMS_PROVIDER=twilio` + `TWILIO_*`, Firebase service account for push, `TAX_RATES_JSON` reviewed by an accountant.
- [ ] Decide custody: keep fail-closed, or implement a real adapter.
- [ ] Exercise the copy chain end to end against exchange testnets (PAPER).
- [ ] Complete the live-enablement review per venue before any LIVE key.
- [ ] Legal: licences for copy trading / custody in the operating jurisdiction; replace the copyright line in `LICENSE` on assignment.
