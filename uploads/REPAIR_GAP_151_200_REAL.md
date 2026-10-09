# REPAIR_GAP_151_200_REAL.md — White-Label Crypto Copy-Trading: market-parity, monetization and platform depth (batch after GAP-101–150)

# Responsibility: copy-paste prompt for a coding agent. Every item was checked as ABSENT or PARTIAL in the audited tree (zip `White-Label01-Crypto-Copy-Trading-App-main`, audit date 2026-10-08) with a grep/inventory command you can re-run. Nothing from `REPAIR_GAP_101_150_REAL.md` or the 41 carry-over GAP-51–100 items is repeated here.

> Prepared BEFORE GAP-101–150 is executed, so it was built from the same tree. Re-run each `Verify:` first (rule 12). Priorities: P1 first, P3 last or skip.
> Auditor limits: static scan + greps + Prisma model inventory (251 models) + targeted file reads. Node suites and Prisma generate were NOT run by the auditor. Competitor claims are vendor/listing pages read on 2026-10-08, not independently validated (URLs in section 6).

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
11. Work in the batch order of §5. Commit per GAP. At the end write `docs/GAP_151_200_FINAL_REPORT.md` and append (do not rewrite) a new section to root `NEXT.md`.
12. **Re-verify before building.** Every gap below has a `Verify:` command. Run it first. If it now shows the feature exists (for example because GAP-101–150 or another change added it), record `VERIFIED_STATIC` (or `VERIFIED_RUNTIME` with a test run) and do NOT rebuild it.
13. **Order matters.** This batch assumes the GAP-101–150 gates are green (at least Blocks A and B). If a gate it depends on is red, mark the dependent gap `BLOCKED` with the cause instead of building on a broken base.

---

## 1. What this batch is and where the evidence comes from

GAP-101–150 closes release gates, venue execution, vendor rails and clients. This batch adds the features and platform depth a diligent buyer compares against, verified missing in the tree.

| Capability | Competitor evidence (public pages) | GAPs |
|---|---|---|
| Fee types: performance with high-water mark, management, subscription, volume, joining, lock-in; accrued fee debt; partners share in every fee type | B2COPY fee list + copy-trading page | 166–172 |
| Reverse copy | B2COPY copy-trading feature list | 151 |
| Strategies run as TradingView bots, other bots or manual trades; pricing with subscription + management + performance fees | Finestel listing (AlternativeTo) | 161, 166, 167 |
| Embeddable iframe widget with SSO; REST + gRPC API | B2COPY | 175, 178, 179 |
| Beginner-friendly Smart Copy; automatic parameter setting; limits on simultaneous orders and price deviation | Bybit help page (Spanish version) · Jivestor listing | 153 |
| High-water-mark success fee | Zignaly directory listing | 166, 171 |
| Native branded mobile apps; KYC/KYT/WaaS bundled | copy.cc | 192, 196 |

Evidence that is repo-internal (verified by commands): the leader fee policy has performance/HWM only; the webhook catalog has two copy events; `tradingview` appears nowhere; no OpenAPI/Postman file; SDKs are hand-written; no outbox; no OpenTelemetry; no passkey implementation (enum value only); no tenant offboarding; no TLS issuance tooling; the Rust gateway has no Dockerfile, compose service or CI job; two placeholder files declare they exist only to satisfy a structure check.

---

## 2. Execution order and dependencies

| Step | Gaps | Needs from the previous batch |
|---|---|---|
| 1 | GAP-177 (outbox) then GAP-176 (event catalog); GAP-178 (OpenAPI) then GAP-179 (SDKs) | none |
| 2 | P1 copy depth: 151, 152, 156, 157, 161 | GAP-119 (perps semantics), GAP-113–118 (venues) for 156/157, GAP-121 (stream ingestion) for 152 |
| 3 | P1 money: 166, 167, 171, 172 | GAP-126 (profit-share settlement) and GAP-85 (statements) |
| 4 | P1 platform + security: 175, 184, 187, 188, 192, 193, 194 | GAP-105/146 for 188; carry-over GAP-77 for 184; GAP-106 for 194 |
| 5 | All P2 | per gap |
| 6 | All P3 | per gap; do last or skip |
| 7 | GAP-200 | everything above |

---


---

## 3. GAP-151–GAP-200

Priority: P0 blocks a credible sale · P1 expected by a diligent buyer · P2 differentiator · P3 optional (do last, or skip if it is not part of the sales story). Each gap: what is wrong now -> `Verify:` command (re-run it first) -> tree with `#` comments -> done-when. `<STAMP>` = next free `YYYYMMDDHHMMSS` after the newest folder in `apps/api/prisma/migrations/`. Tags: NEW / EDIT / DELETE were computed against the audited tree; EXTEND = file created by an earlier GAP in the previous batch.

### 3.0 Register

| ID | Pri | Gap | Evidence now |
|---|---|---|---|
| GAP-151 | P1 | Reverse copy (inverse direction) | copy policy has sizing modes only (PROPORTIONAL, FIXED, PERCENTAGE_BALANCE); no direction option. B2COPY lists "Reverse Copy" among its copy features |
| GAP-152 | P1 | Initial position sync on follow (opt-in, tolerance-bounded) | followers copy only NEW leader events after subscribing; no snapshot of the leader open positions, so a new follower starts out of sync with the leader |
| GAP-153 | P2 | Copy presets (beginner auto-settings) | no preset concept in copy settings; a competitor listing advertises "automatic parameter setting" for beginners and Bybit recommends Smart Copy for beginners |
| GAP-154 | P2 | Leader open-position disclosure delay | profile visibility rules exist (`trader-profile-visibility.spec.ts`) but no configurable delay for publicly shown open positions; copiers-of-copiers can front-run |
| GAP-155 | P3 | Waitlist when a leader is at capacity | `maxFollowersPerTrader` is enforced in `follower-subscription.service.ts`; a follower at capacity just gets an error, no waitlist |
| GAP-156 | P1 | Cross-venue symbol / contract mapping + instrument master | no venue-to-venue mapping in the copy mapper (leader on one venue, follower on another); tick/step/min-notional rules exist only in research/paper code and in the Python Binance client |
| GAP-157 | P1 | Funding-rate / funding-payment accounting for perps | no funding handling anywhere in API or Python code; portfolio accounting has lots, cost basis and PnL but no funding events, so perp PnL is overstated or understated |
| GAP-158 | P2 | Leader -> follower announcements (moderated) | no announcement model among the 251 Prisma models and no broadcast code (the only "broadcast" hits are custody transactions) |
| GAP-159 | P3 | Trader watchlist + activity alerts | no watchlist/favorite model or code (no model among the 251; the only "watchlist" hit is an AML provider interface) |
| GAP-160 | P2 | Leaderboard eligibility + anti-gaming signals | `trader-ranking.service.ts` ranks without a minimum-history / minimum-trades / minimum-activity gate |
| GAP-161 | P1 | TradingView / webhook signal-provider strategies | the string "tradingview" appears nowhere in the repo; strategies can only follow a leader venue account. Finestel advertises strategies executed as TradingView bots, other bots or manual trades |
| GAP-162 | P2 | Trader / strategy tags, categories and faceted search | `TraderProfile` / `TraderStrategy` carry riskProfile and supported symbols/venues but no tags, category or style fields; no facet endpoint |
| GAP-163 | P2 | Copy fidelity / tracking-error report | no tracking-error or copy-fidelity computation anywhere (the OMS has execution-quality tables, but nothing compares a follower with the leader) |
| GAP-164 | P2 | Leaderboard precompute / cache | `trader-ranking.service.ts` has no cache/TTL and no materialized snapshot; ranking is computed per request |
| GAP-165 | P3 | Trader reviews (moderated) | no review/rating model or code (the "rating" hits are AML/KYC risk ratings) |
| GAP-166 | P1 | Management fee (AUM-based accrual) | leader fee policy supports performance fee with HWM only; no management fee (B2COPY and Finestel both offer one) |
| GAP-167 | P1 | Subscription fee (fixed recurring fee to follow a leader) | no subscription-fee type in leader fees (Finestel lists subscription fee among its pricing options; B2COPY has it too) |
| GAP-168 | P2 | Joining fee (one-time entry fee) | no joining/entry fee in leader fees (B2COPY lists a joining fee) |
| GAP-169 | P2 | Volume fee (per traded volume) | no volume-based fee (B2COPY lists a volume fee) |
| GAP-170 | P2 | Lock-in / early-exit fee | no lock-in or early-exit fee (B2COPY lists a lock-in fee as an early-exit penalty) |
| GAP-171 | P1 | Accrued fee debt + recovery for profit-share | fee-debt terms appear only in platform billing types; leader profit-share has no tracking when a fee cannot be collected (B2COPY tracks accrued fee debt) |
| GAP-172 | P1 | Partner revenue-share on leader fees | partner commissions are sourced from payment / invoice / subscription / fee ids; leader fees are not a commission source (B2COPY says partners share in every fee type) |
| GAP-173 | P2 | Promo codes / coupons for platform subscriptions | no coupon/promo model or code |
| GAP-174 | P2 | Follower realized-gain / tax export (not tax advice) | `cost-basis.service.ts` and `report-export.service.ts` exist (not audited line by line); no follower-facing realized-gain page/route was found, and funding payments are not modeled (GAP-157) |
| GAP-175 | P1 | Embeddable widget (iframe / loader) + signed SSO handoff | both Next apps deny framing today (`X-Frame-Options: DENY` in `apps/web/next.config.mjs:15` and `apps/admin-web/next.config.mjs:19`, plus `frame-ancestors 'none'` in the admin middleware) and there is no embed route, loader or SSO handoff. B2COPY ships an iframe widget with SSO |
| GAP-176 | P1 | Developer webhook catalog: complete the copy-trading lifecycle | the event catalog covers customer / subscription / payment / invoice / funding / withdrawal events, but only `copy.subscription.created` and `copy.subscription.cancelled` for copy trading |
| GAP-177 | P1 | Transactional outbox for domain events | no outbox pattern in the API or schema; events are emitted directly from services, so a crash between commit and publish can lose or duplicate an event |
| GAP-178 | P1 | Committed OpenAPI spec + Postman collection + drift check | no `openapi*.json/yaml` or Postman file anywhere in the repo (find returned nothing); buyers and SDK consumers have no machine-readable contract |
| GAP-179 | P1 | SDK generation from the spec + publish pipeline | TypeScript SDK is hand-written (`packages/sdk-typescript/src/client.ts`), the Rust SDK is a single `lib.rs`; no generator, no publish config, no changelog/versioning policy |
| GAP-180 | P2 | Helpdesk integration (Zendesk / Intercom) + support context | no helpdesk references and no ticket model; the web app has a support page but nothing behind it |
| GAP-181 | P2 | Tenant-editable notification templates | `notification-template.service.ts` resolves code templates with a locale override only; no tenant override model or editor |
| GAP-182 | P2 | Notification quiet hours + digest | `NotificationPreference` has only category / channel / enabled |
| GAP-183 | P2 | Web + admin i18n (next-intl; en, bn, ar with RTL, es, tr) | no i18n library in `apps/web` or `apps/admin-web` package.json and no translation calls; the API has locale bundles and the mobile app has `l10n.yaml`, so only the web UIs are English-only |
| GAP-184 | P1 | Passkeys / WebAuthn | `security.types.ts` contains only the enum value `WEBAUTHN`; no registration or assertion endpoints exist |
| GAP-185 | P2 | Consumer social login (Google / Apple), per tenant | `auth.service.ts` and `sso-login.service.ts` contain no Google/Apple login (SSO is enterprise SAML/OIDC only) |
| GAP-186 | P2 | Support "view-as" (read-only impersonation) | no impersonation feature (the 3 grep hits are comments) |
| GAP-187 | P1 | Tenant offboarding + export + deletion | no tenant offboarding/export/purge code (the only privacy export is per user: `PrivacyExport`) |
| GAP-188 | P1 | Automated TLS for custom domains | `TenantDomain` stores a verification token and `certificateExpiry`, but there is no issuance tooling anywhere (no caddy / certbot / cert-manager / letsencrypt reference) |
| GAP-189 | P2 | Distributed tracing (OpenTelemetry) API -> engine -> venue | no `@opentelemetry` dependency anywhere; only the Rust gateway has a `tracing.rs`; metrics exist but a copy order cannot be followed across services |
| GAP-190 | P3 | Travel-rule data capture for withdrawals (jurisdiction-dependent) | no travel-rule / FATF / VASP handling anywhere in the API or docs |
| GAP-191 | P3 | Bulk admin operations | no bulk/batch actions in admin-web or the RBAC/users modules |
| GAP-192 | P1 | Rust low-latency gateway: make it deployable or retire it | `services/low-latency-gateway` (Rust, ~10k LOC) has no Dockerfile in `infrastructure/docker`, no compose service, and the CI `rust` job only covers `packages/sdk-rust` |
| GAP-193 | P1 | Property-based tests for money math and sizing | no hypothesis / fast-check / proptest anywhere, although exact-decimal math, sizing, fees and HWM carry real money |
| GAP-194 | P1 | Remove structure-check placeholder files | two files declare that they exist only "to satisfy the required file structure check": `apps/web/src/main.tsx` (non-Next bootstrap) and `apps/web/vite.config.ts` ("NOT USED"); `apps/web` is a Next.js app |
| GAP-195 | P2 | Web performance budgets (Lighthouse CI + bundle limits) | no lighthouse / lhci / size-limit anywhere (the only hits are eslint configs) |
| GAP-196 | P2 | Mobile deep / universal links | no applinks / assetlinks / app_links handling in `apps/mobile` |
| GAP-197 | P2 | Partitioning + retention for high-volume tables | no `PARTITION BY` and no materialized views in any migration; high-volume tables: CopyExecution, fills, AuditLog, MarketDataRecord, Notification, WebhookDeliveryAttempt |
| GAP-198 | P3 | Additional venues: Hyperliquid (DEX perps), Gate, MEXC | none of the three exists in the repo; venue breadth stays at the GAP-113–118 set |
| GAP-199 | P3 | Web push / PWA | no service worker, manifest or web-push code in `apps/web` |
| GAP-200 | P0 | Final regression + honest report for GAP-151–200 | scanners are static; reports drift (F1–F3 of the previous batch) |

### 3.G Block G: Copy-product depth (parity with Bybit / Bitget / B2COPY)

#### GAP-151 - Reverse copy (inverse direction)  ·  P1

Now: copy policy has sizing modes only (PROPORTIONAL, FIXED, PERCENTAGE_BALANCE); no direction option. B2COPY lists "Reverse Copy" among its copy features

Verify (from `whitelabel-copytrade/`): `grep -rIliE 'reverse.?copy|inverse.?copy|invertSide|copyDirection' apps/api/src apps/web/src`

```text
White-Label01-Crypto-Copy-Trading-App/
└── whitelabel-copytrade/apps/
    ├── api/src/modules/copy-trading/
    │   ├── dto/
    │   │   └── copy-policy.dto.ts            # EDIT — add copyDirection SAME | REVERSE (default SAME) with validation
    │   ├── copy-order-mapper.service.ts      # EDIT — invert side (BUY<->SELL), swap TP/SL semantics, never exceed follower caps, reduce-only on closes
    │   ├── copy-reverse.spec.ts              # NEW — mapping matrix: open/close/partial, TP/SL swap, spot rejection, hedge vs one-way, caps unchanged
    │   └── copy-trading.types.ts             # EDIT — CopyDirection enum + EffectiveCopyPolicy.direction
    └── web/src/
        ├── features/trading/
        │   └── copy-settings-page.tsx        # EDIT — direction toggle with plain-language warning + disclosure consent gate
        └── tests/
            └── copy-reverse-toggle.test.tsx  # NEW — render, warning text, consent gate
```

Done when: REVERSE maps every open/close/partial correctly (side inverted, TP/SL semantics swapped, caps unchanged); rejected on venues/accounts that cannot short; explicit loss-amplification warning + consent before enabling.

#### GAP-152 - Initial position sync on follow (opt-in, tolerance-bounded)  ·  P1

Now: followers copy only NEW leader events after subscribing; no snapshot of the leader open positions, so a new follower starts out of sync with the leader

Verify (from `whitelabel-copytrade/`): `grep -rIliE 'syncExisting|copyExisting|existingPositions|initialSync|copyOpenPositions' apps/api/src`

```text
White-Label01-Crypto-Copy-Trading-App/
└── whitelabel-copytrade/apps/
    ├── api/src/modules/copy-trading/
    │   ├── dto/
    │   │   └── copy-policy.dto.ts                 # EDIT — initialSyncMode NONE | SYNC_WITHIN_TOLERANCE + toleranceBps (bounded by tenant ceiling)
    │   ├── copy-initial-sync.service.ts           # NEW — CopyInitialSyncService: opt-in snapshot of venue-verified leader open positions at ACTIVE transition; scales to follower caps; refuses stale snapshot or price beyond tolerance
    │   ├── copy-initial-sync.spec.ts              # NEW — tolerance edge cases, stale snapshot refusal, scaling, caps, idempotent per subscription
    │   └── follower-subscription.service.ts       # EDIT — invoke initial sync exactly once after the ACTIVE transition
    └── web/src/
        ├── features/trading/
        │   └── copy-settings-page.tsx             # EDIT — initial-sync option with cost/slippage explanation
        └── tests/
            └── copy-initial-sync-option.test.tsx  # NEW — render + validation
```

Done when: Default stays NEW_ONLY. SYNC_WITHIN_TOLERANCE copies an open leader position only when current price is within the tolerance of the leader entry and the snapshot is fresh; never chases the market; idempotent per subscription.

#### GAP-153 - Copy presets (beginner auto-settings)  ·  P2

Now: no preset concept in copy settings; a competitor listing advertises "automatic parameter setting" for beginners and Bybit recommends Smart Copy for beginners

Verify (from `whitelabel-copytrade/`): `grep -rIliE 'recommendedSettings|autoSettings|copyPreset|suggestedSettings' apps/api/src apps/web/src`

```text
White-Label01-Crypto-Copy-Trading-App/
└── whitelabel-copytrade/apps/
    ├── api/src/modules/copy-trading/
    │   ├── copy-presets.service.ts           # NEW — CopyPresetsService: preset -> sizing, slippage, SL/TP, caps from leader risk profile within tenant ceilings
    │   ├── copy-presets.spec.ts              # NEW — preset resolution matrix, ceiling enforcement, unavailable risk profile
    │   └── copy-trading.controller.ts        # EDIT — GET /copy-trading/presets (tenant-aware, permission-decorated)
    └── web/src/
        ├── features/trading/
        │   ├── copy-presets-picker.tsx       # NEW — preset chooser with diff preview against custom settings
        │   └── copy-settings-page.tsx        # EDIT — mount the picker
        └── tests/
            └── copy-presets-picker.test.tsx  # NEW — render + unavailable state
```

Done when: Conservative / Balanced / Aggressive presets resolve to server-validated policy values derived from the leader risk profile; presets never exceed tenant ceilings; unavailable when the leader risk profile is UNAVAILABLE.

#### GAP-154 - Leader open-position disclosure delay  ·  P2

Now: profile visibility rules exist (`trader-profile-visibility.spec.ts`) but no configurable delay for publicly shown open positions; copiers-of-copiers can front-run

Verify (from `whitelabel-copytrade/`): `grep -rIliE 'disclosureDelay|positionVisibility|hideOpen|delayedDisclosure' apps/api/src`

```text
White-Label01-Crypto-Copy-Trading-App/
└── whitelabel-copytrade/apps/
    ├── api/src/modules/copy-trading/
    │   ├── dto/
    │   │   └── trader-disclosure.dto.ts         # NEW — DTO: disclosureDelayMinutes with min/max validation
    │   ├── trader-disclosure-policy.service.ts  # NEW — TraderDisclosurePolicyService: per-strategy disclosure delay for public open positions/trades; bounds from tenant settings
    │   ├── trader-disclosure-policy.spec.ts     # NEW — public vs follower view, delay boundaries, bounds enforcement
    │   └── trader-profile.service.ts            # EDIT — apply the disclosure policy to public position/trade lists
    └── web/src/features/trading/
        └── trader-disclosure-settings.tsx       # NEW — leader-facing setting with explanation of the trade-off
```

Done when: Public views hide or delay open positions by the leader-chosen minutes (within tenant bounds); followers always see their own copied positions in real time; closed trades appear after the delay.

#### GAP-155 - Waitlist when a leader is at capacity  ·  P3

Now: `maxFollowersPerTrader` is enforced in `follower-subscription.service.ts`; a follower at capacity just gets an error, no waitlist

Verify (from `whitelabel-copytrade/`): `grep -rIliE 'waitlist|waitingList' apps/api/src apps/web/src`

```text
White-Label01-Crypto-Copy-Trading-App/
└── whitelabel-copytrade/apps/
    ├── api/
    │   ├── prisma/
    │   │   ├── migrations/<STAMP>_copy_waitlist_entry/
    │   │   │   └── migration.sql                 # NEW — additive migration + tenant-scoped idempotency composite; then run scripts/gen_part11_rls.py for the additive RLS migration and refresh prisma/rls/rls_coverage.json
    │   │   └── schema.prisma                     # EDIT — add model CopyWaitlistEntry: tenantId, traderId, strategyId, followerId, position, status WAITING/CLAIMABLE/CLAIMED/EXPIRED, claimExpiresAt
    │   └── src/modules/copy-trading/
    │       ├── copy-waitlist.service.ts          # NEW — CopyWaitlistService: ordered queue, claim window, promotion on slot release, idempotent join/leave
    │       ├── copy-waitlist.spec.ts             # NEW — ordering, claim expiry, concurrent promotion, tenant isolation
    │       └── follower-subscription.service.ts  # EDIT — on capacity: offer waitlist; on slot release: promote
    └── web/src/features/trading/
        └── copy-waitlist-button.tsx              # NEW — join/leave waitlist + position display
```

Done when: Full leader offers a waitlist; a freed slot notifies the next entry in order with an expiring claim; no queue-jumping; tenant-scoped.

#### GAP-156 - Cross-venue symbol / contract mapping + instrument master  ·  P1

Now: no venue-to-venue mapping in the copy mapper (leader on one venue, follower on another); tick/step/min-notional rules exist only in research/paper code and in the Python Binance client

Verify (from `whitelabel-copytrade/`): `grep -rIliE 'crossVenue|targetVenue|venueMap|instrumentMaster|symbolMapping' apps/api/src`

```text
White-Label01-Crypto-Copy-Trading-App/
└── whitelabel-copytrade/apps/api/
    ├── prisma/
    │   ├── migrations/<STAMP>_trading_symbol_contract_fields/
    │   │   └── migration.sql                 # NEW — additive columns on trading_symbols
    │   └── schema.prisma                     # EDIT — extend existing TradingSymbol with contract/tick/step/minNotional/settle fields (additive)
    └── src/modules/
        ├── copy-trading/
        │   └── copy-order-mapper.service.ts  # EDIT — use InstrumentMaster + SymbolMapping; round to follower step; reject below min notional
        └── exchanges/
            ├── instrument-master.service.ts  # NEW — InstrumentMasterService: canonical instrument per venue (base/quote/settle, contract size, tick, step, min notional, leverage tiers) with as-of; stale => UNAVAILABLE
            ├── instrument-master.spec.ts     # NEW — refresh, staleness, per-venue parsing fixtures
            ├── symbol-mapping.service.ts     # NEW — maps leader venue symbol -> follower venue symbol incl. contract multiplier and quote differences
            └── symbol-mapping.spec.ts        # NEW — spot/perp/inverse mappings, unmappable cases, multiplier math (exact decimals)
```

Done when: A leader fill on venue A maps to the correct follower instrument on venue B (symbol, contract multiplier, quote asset), quantity rounded to the follower step, min-notional respected; unmappable => skipped with a typed reason, never guessed.

#### GAP-157 - Funding-rate / funding-payment accounting for perps  ·  P1

Now: no funding handling anywhere in API or Python code; portfolio accounting has lots, cost basis and PnL but no funding events, so perp PnL is overstated or understated

Verify (from `whitelabel-copytrade/`): `grep -rIliE 'fundingRate|fundingFee|funding_payment|fundingPayment' apps libs services`

```text
White-Label01-Crypto-Copy-Trading-App/
└── whitelabel-copytrade/
    ├── apps/
    │   ├── api/src/modules/portfolio-accounting/
    │   │   ├── funding-payment.service.ts     # NEW — FundingPaymentService: ingest venue funding payments (or estimate from rate x notional at funding timestamps, flagged ESTIMATED); posts accounting events
    │   │   ├── funding-payment.spec.ts        # NEW — sign conventions, schedule edge cases, duplicate ingestion, ESTIMATED flag
    │   │   ├── pnl.service.ts                 # EDIT — include funding as its own realized/unrealized line item
    │   │   └── portfolio-accounting.types.ts  # EDIT — event type FUNDING_PAYMENT
    │   └── web/src/features/portfolio/
    │       └── funding-breakdown.tsx          # NEW — PnL breakdown card: trading PnL, fees, funding (ACTUAL vs ESTIMATED labels)
    └── libs/trading-core/
        ├── tests/
        │   └── test_funding.py                # NEW — parser fixtures per venue, schedule math, sign conventions
        └── wlct_trading/exchanges/
            └── funding.py                     # NEW — venue-neutral funding payment parser + schedule helper (8h/1h) used by engine user-streams
```

Done when: Funding payments appear as separate PnL line items (ACTUAL from venue data, ESTIMATED flag when computed from rates); exact decimals; statements and tax export include them.

#### GAP-158 - Leader -> follower announcements (moderated)  ·  P2

Now: no announcement model among the 251 Prisma models and no broadcast code (the only "broadcast" hits are custody transactions)

Verify (from `whitelabel-copytrade/`): `grep -rIliE 'LeaderAnnouncement|announcement' apps/api/src apps/api/prisma/schema.prisma`

```text
White-Label01-Crypto-Copy-Trading-App/
└── whitelabel-copytrade/apps/
    ├── admin-web/src/
    │   ├── app/(console)/moderation/
    │   │   └── page.tsx                           # NEW — console route mounting the moderation queue (+ sidebar entry)
    │   └── features/moderation/
    │       └── announcement-moderation-queue.tsx  # NEW — takedown queue with rationale + audit
    ├── api/
    │   ├── prisma/
    │   │   ├── migrations/<STAMP>_leader_announcement/
    │   │   │   └── migration.sql                  # NEW — additive migration + tenant-scoped idempotency composite; then run scripts/gen_part11_rls.py for the additive RLS migration and refresh prisma/rls/rls_coverage.json
    │   │   └── schema.prisma                      # EDIT — add model LeaderAnnouncement: tenantId, traderId, strategyId, body, state PUBLISHED/RETRACTED/TAKEN_DOWN, takedownReason, createdAt
    │   └── src/modules/copy-trading/
    │       ├── leader-announcement.controller.ts  # NEW — REST endpoints (leader create, follower read), permission-decorated
    │       ├── leader-announcement.service.ts     # NEW — LeaderAnnouncementService: create/list/retract; rate limit per leader; moderation rules; fan-out through the notification pipeline
    │       └── leader-announcement.spec.ts        # NEW — rate limit, moderation, retraction, tenant/follower scope
    └── web/src/features/trading/
        └── leader-announcements-panel.tsx         # NEW — leader compose box + follower feed
```

Done when: Leaders can post short announcements to their followers; tenant moderation rules (links, length, banned terms) apply; admin takedown is audited; fan-out respects notification preferences.

#### GAP-159 - Trader watchlist + activity alerts  ·  P3

Now: no watchlist/favorite model or code (no model among the 251; the only "watchlist" hit is an AML provider interface)

Verify (from `whitelabel-copytrade/`): `grep -rIliE 'TraderWatch|watchlist|favoriteTrader' apps/api/src apps/web/src apps/api/prisma/schema.prisma`

```text
White-Label01-Crypto-Copy-Trading-App/
└── whitelabel-copytrade/apps/
    ├── api/
    │   ├── prisma/
    │   │   ├── migrations/<STAMP>_trader_watch/
    │   │   │   └── migration.sql        # NEW — additive migration + tenant-scoped idempotency composite; then run scripts/gen_part11_rls.py for the additive RLS migration and refresh prisma/rls/rls_coverage.json
    │   │   └── schema.prisma            # EDIT — add model TraderWatch: tenantId, userId, traderId, createdAt
    │   └── src/modules/copy-trading/
    │       ├── trader-watch.service.ts  # NEW — TraderWatchService: watch/unwatch, cap per user, alert triggers from leader events
    │       └── trader-watch.spec.ts     # NEW — cap, idempotent watch, alert dedupe, tenant scope
    └── web/src/
        ├── app/watchlist/
        │   └── page.tsx                 # NEW — Next route mounting WatchlistPage (+ nav link)
        └── features/trading/
            ├── watch-trader-button.tsx  # NEW — watch toggle on trader cards/profile
            └── watchlist-page.tsx       # NEW — list of watched traders with latest metrics (UNAVAILABLE when missing)
```

Done when: A user can watch a trader without copying; alerts on closed trades / drawdown breach follow notification preferences; max watch count enforced.

#### GAP-160 - Leaderboard eligibility + anti-gaming signals  ·  P2

Now: `trader-ranking.service.ts` ranks without a minimum-history / minimum-trades / minimum-activity gate

Verify (from `whitelabel-copytrade/`): `grep -nE 'minTrad|minHistory|minimumHistory|eligib|trackRecord' apps/api/src/modules/copy-trading/trader-ranking.service.ts`

```text
White-Label01-Crypto-Copy-Trading-App/
└── whitelabel-copytrade/apps/
    ├── admin-web/src/
    │   ├── app/(console)/trader-integrity/
    │   │   └── page.tsx                    # NEW — console route mounting the queue (+ sidebar entry)
    │   └── features/risk/
    │       └── trader-integrity-queue.tsx  # NEW — review queue for integrity flags with decisions + audit
    ├── api/src/modules/copy-trading/
    │   ├── trader-eligibility.service.ts   # NEW — TraderEligibilityService: per-tenant rules (min active days, min closed trades, min verified activity, max single-trade PnL share) -> eligible/ineligible + reasons
    │   ├── trader-eligibility.spec.ts      # NEW — rule matrix, boundaries, missing data => UNAVAILABLE not eligible
    │   ├── trader-ranking.service.ts       # EDIT — rank only ELIGIBLE by default; expose reasons for the rest
    │   ├── wash-trade-signals.service.ts   # NEW — deterministic signals (self-crossing fills across linked accounts, abnormal churn, thin-symbol concentration) producing review flags
    │   └── wash-trade-signals.spec.ts      # NEW — signal fixtures, false-positive guards, no auto-penalty
    └── web/src/features/trading/
        └── trader-ranking-controls.tsx     # EDIT — show eligibility filter + reasons
```

Done when: Ranking uses ELIGIBLE traders by default; ineligible traders show reasons instead of silently disappearing; wash-trade/self-crossing signals create review flags only (no automatic penalties).

#### GAP-161 - TradingView / webhook signal-provider strategies  ·  P1

Now: the string "tradingview" appears nowhere in the repo; strategies can only follow a leader venue account. Finestel advertises strategies executed as TradingView bots, other bots or manual trades

Verify (from `whitelabel-copytrade/`): `grep -rIli 'tradingview' apps libs services packages`

```text
White-Label01-Crypto-Copy-Trading-App/
└── whitelabel-copytrade/
    ├── apps/
    │   ├── api/
    │   │   ├── prisma/
    │   │   │   ├── migrations/<STAMP>_signal_source_key/
    │   │   │   │   └── migration.sql                  # NEW — additive migration + tenant-scoped idempotency composite; then run scripts/gen_part11_rls.py for the additive RLS migration and refresh prisma/rls/rls_coverage.json
    │   │   │   └── schema.prisma                      # EDIT — add model SignalSourceKey: tenantId, strategyId, secretHash, secretMasked, ipAllowlist, rotatedAt, revokedAt
    │   │   └── src/modules/copy-trading/
    │   │       ├── signal-source/
    │   │       │   ├── signal-source.controller.ts    # NEW — POST /v1/signals/:strategyId (public, HMAC-authenticated, throttled)
    │   │       │   ├── signal-source.dto.ts           # NEW — payload DTO with strict validation; no follower-level parameters accepted
    │   │       │   ├── signal-source.service.ts       # NEW — SignalSourceService: per-strategy HMAC secret (hashed at rest) + optional IP allowlist; normalizes {action,symbol,side,qty|pct,tp,sl,id} to LeaderEvent; replay window + idempotency
    │   │       │   └── signal-source.spec.ts          # NEW — signature, replay, duplicate id, malformed, rate limit, tenant isolation
    │   │       └── leader-event-ingestion.service.ts  # EDIT — accept SignalSourceService events next to venue fills; mark source=SIGNAL
    │   └── web/src/features/trading/
    │       └── signal-strategy-setup.tsx              # NEW — leader setup: webhook URL, secret shown once, TradingView alert JSON template, test-fire
    └── docs/
        └── SIGNAL_PROVIDER_GUIDE.md                   # NEW — payload spec, TradingView alert template, security notes, limits
```

Done when: A leader can publish a SIGNAL strategy fed by an HMAC-authenticated webhook; replayed, stale, duplicate or malformed alerts are rejected; signals become LeaderEvents with source=SIGNAL; follower caps and risk gates apply unchanged.

#### GAP-162 - Trader / strategy tags, categories and faceted search  ·  P2

Now: `TraderProfile` / `TraderStrategy` carry riskProfile and supported symbols/venues but no tags, category or style fields; no facet endpoint

Verify (from `whitelabel-copytrade/`): `grep -nE 'tags|category|style' apps/api/src/modules/copy-trading/dto/*.ts`

```text
White-Label01-Crypto-Copy-Trading-App/
└── whitelabel-copytrade/apps/
    ├── api/
    │   ├── prisma/
    │   │   ├── migrations/<STAMP>_trader_strategy_tags/
    │   │   │   └── migration.sql         # NEW — additive columns + GIN index on tags
    │   │   └── schema.prisma             # EDIT — TraderStrategy: category, style, tags (additive columns)
    │   └── src/modules/copy-trading/
    │       ├── trader-search.service.ts  # NEW — TraderSearchService: filters, facets with counts, text search, pagination; tenant scope
    │       └── trader-search.spec.ts     # NEW — facet counts, filter combinations, vocabulary validation
    └── web/src/features/trading/
        ├── trader-filters-panel.tsx      # NEW — facet UI (category, style, venue, risk, timeframe)
        └── traders-page.tsx              # EDIT — mount the filters panel; query-state wiring
```

Done when: Leaders tag strategies (bounded vocabulary per tenant); discovery supports facets with counts + text search; results keep UNAVAILABLE semantics for missing metrics.

#### GAP-163 - Copy fidelity / tracking-error report  ·  P2

Now: no tracking-error or copy-fidelity computation anywhere (the OMS has execution-quality tables, but nothing compares a follower with the leader)

Verify (from `whitelabel-copytrade/`): `grep -rIliE 'trackingError|tracking_error|copyFidelity' apps/api/src apps/web/src`

```text
White-Label01-Crypto-Copy-Trading-App/
└── whitelabel-copytrade/apps/
    ├── api/src/modules/copy-trading/
    │   ├── copy-fidelity.service.ts           # NEW — CopyFidelityService: per-subscription fidelity metrics from CopyExecution rows; exact decimals; no substituted prices
    │   ├── copy-fidelity.spec.ts              # NEW — metric math, missing evidence => null, tenant/owner scope
    │   └── copy-trading.controller.ts         # EDIT — GET /copy-trading/subscriptions/:id/fidelity
    └── web/src/features/trading/
        ├── copy-fidelity-card.tsx             # NEW — fidelity card with methodology tooltip
        └── copy-subscription-detail-page.tsx  # EDIT — mount the card
```

Done when: For each subscription: slippage vs the leader fill, latency, fill ratio, skipped-trade reasons and tracking error vs the leader return, all from persisted executions (UNAVAILABLE when evidence is missing).

#### GAP-164 - Leaderboard precompute / cache  ·  P2

Now: `trader-ranking.service.ts` has no cache/TTL and no materialized snapshot; ranking is computed per request

Verify (from `whitelabel-copytrade/`): `grep -nE 'cache|Cache|ttl|TTL' apps/api/src/modules/copy-trading/trader-ranking.service.ts`

```text
White-Label01-Crypto-Copy-Trading-App/
└── whitelabel-copytrade/
    ├── apps/api/
    │   ├── prisma/
    │   │   ├── migrations/<STAMP>_trader_ranking_snapshot/
    │   │   │   └── migration.sql                     # NEW — additive migration + tenant-scoped idempotency composite; then run scripts/gen_part11_rls.py for the additive RLS migration and refresh prisma/rls/rls_coverage.json
    │   │   └── schema.prisma                         # EDIT — add model TraderRankingSnapshot: tenantId, timeframe, methodology, rows (JSON), asOf
    │   └── src/modules/copy-trading/
    │       ├── trader-ranking-snapshot.processor.ts  # NEW — BullMQ job running the snapshot (staggered per tenant)
    │       ├── trader-ranking-snapshot.service.ts    # NEW — TraderRankingSnapshotService: periodic snapshot per tenant/timeframe/methodology with asOf; guarded recompute on stale
    │       ├── trader-ranking-snapshot.spec.ts       # NEW — freshness, concurrent recompute guard, tenant isolation
    │       └── trader-ranking.service.ts             # EDIT — serve from snapshot; expose asOf
    └── tests/load/k6/
        └── api-baseline.js                           # EXTEND — (created in GAP-122) add leaderboard scenario before/after
```

Done when: Ranking is served from a snapshot with asOf + methodology; stale snapshots trigger a guarded recompute; GAP-122 load results show p95 improvement.

#### GAP-165 - Trader reviews (moderated)  ·  P3

Now: no review/rating model or code (the "rating" hits are AML/KYC risk ratings)

Verify (from `whitelabel-copytrade/`): `grep -rIliE 'TraderReview|traderReview' apps/api/src apps/api/prisma/schema.prisma`

```text
White-Label01-Crypto-Copy-Trading-App/
└── whitelabel-copytrade/apps/
    ├── admin-web/src/features/moderation/
    │   └── announcement-moderation-queue.tsx  # EXTEND — (created in GAP-158) also lists pending reviews
    ├── api/
    │   ├── prisma/
    │   │   ├── migrations/<STAMP>_trader_review/
    │   │   │   └── migration.sql              # NEW — additive migration + tenant-scoped idempotency composite; then run scripts/gen_part11_rls.py for the additive RLS migration and refresh prisma/rls/rls_coverage.json
    │   │   └── schema.prisma                  # EDIT — add model TraderReview: tenantId, traderId, followerId, rating, body, state PENDING/PUBLISHED/REJECTED
    │   └── src/modules/copy-trading/
    │       ├── trader-review.service.ts       # NEW — TraderReviewService: eligibility (min copy days), one review per follower per trader, moderation state
    │       └── trader-review.spec.ts          # NEW — eligibility, duplicates, moderation transitions, tenant scope
    └── web/src/features/trading/
        └── trader-reviews.tsx                 # NEW — reviews list + submit form
```

Done when: Only followers with >= N days of real copying can review; moderation queue shared with GAP-158; no rating influences ranking unless a tenant explicitly enables it.

### 3.H Block H: Monetization breadth (B2COPY / Finestel fee types)

#### GAP-166 - Management fee (AUM-based accrual)  ·  P1

Now: leader fee policy supports performance fee with HWM only; no management fee (B2COPY and Finestel both offer one)

Verify (from `whitelabel-copytrade/`): `grep -rIliE 'management.?fee|managementFee' apps/api/src`

```text
White-Label01-Crypto-Copy-Trading-App/
└── whitelabel-copytrade/apps/
    ├── api/src/modules/copy-trading/
    │   ├── dto/
    │   │   └── leader-fee.dto.ts                      # EDIT — add managementFeeBps (annual, bounded by tenant ceiling) + day-count convention
    │   ├── leader-fee.service.ts                      # EDIT — validation + disclosure text for the management fee
    │   ├── leader-management-fee.processor.ts         # NEW — BullMQ daily job
    │   ├── leader-management-fee.service.ts           # NEW — daily accrual on verified follower NAV (explicit day-count), posted via FeeAccrual; no accrual when NAV is unverified
    │   ├── leader-management-fee.spec.ts              # NEW — day-count, NAV gaps, deposits/withdrawals, idempotent replays, rounding
    │   └── leader-profit-share-settlement.service.ts  # EXTEND — (created in GAP-126) include management-fee accruals in the settlement run
    └── web/src/features/trading/
        └── trader-detail-page.tsx                     # EDIT — show the management fee in the fee disclosure
```

Done when: Accrual is exact-decimal, idempotent per period, posted through the existing fee ledger, disclosed before the follower subscribes, and fails closed when the NAV/source is unverified.

#### GAP-167 - Subscription fee (fixed recurring fee to follow a leader)  ·  P1

Now: no subscription-fee type in leader fees (Finestel lists subscription fee among its pricing options; B2COPY has it too)

Verify (from `whitelabel-copytrade/`): `grep -rIliE 'subscription.?fee|subscriptionFee' apps/api/src/modules/copy-trading`

```text
White-Label01-Crypto-Copy-Trading-App/
└── whitelabel-copytrade/apps/api/
    ├── prisma/
    │   ├── migrations/<STAMP>_leader_subscription_fee_charge/
    │   │   └── migration.sql                     # NEW — additive migration + tenant-scoped idempotency composite; then run scripts/gen_part11_rls.py for the additive RLS migration and refresh prisma/rls/rls_coverage.json
    │   └── schema.prisma                         # EDIT — add model LeaderSubscriptionFeeCharge: tenantId, subscriptionId, period, amount, currency, status, idempotencyKey
    └── src/modules/copy-trading/
        ├── dto/
        │   └── leader-fee.dto.ts                 # EDIT — add subscriptionFee {amount, currency, interval}
        ├── leader-subscription-fee.processor.ts  # NEW — BullMQ cron for due charges
        ├── leader-subscription-fee.service.ts    # NEW — recurring charge per active subscription through the existing fee ledger/payout path; grace + suspension rules; refund on failed activation
        └── leader-subscription-fee.spec.ts       # NEW — interval math, failed charge handling, proration on stop, idempotency
```

Done when: Accrual is exact-decimal, idempotent per period, posted through the existing fee ledger, disclosed before the follower subscribes, and fails closed when the NAV/source is unverified.

#### GAP-168 - Joining fee (one-time entry fee)  ·  P2

Now: no joining/entry fee in leader fees (B2COPY lists a joining fee)

Verify (from `whitelabel-copytrade/`): `grep -rIliE 'joining.?fee|joiningFee|entryFee' apps/api/src`

```text
White-Label01-Crypto-Copy-Trading-App/
└── whitelabel-copytrade/apps/
    ├── api/src/modules/copy-trading/
    │   ├── dto/
    │   │   └── leader-fee.dto.ts          # EDIT — add joiningFee {amount, currency}
    │   ├── leader-joining-fee.service.ts  # NEW — charge once at ACTIVE transition; refund when activation fails; never double-charge on re-subscribe within the policy window
    │   └── leader-joining-fee.spec.ts     # NEW — charge/refund paths, re-subscribe window, idempotency
    └── web/src/features/trading/
        └── copy-settings-page.tsx         # EDIT — show the joining fee before confirming
```

Done when: Accrual is exact-decimal, idempotent per period, posted through the existing fee ledger, disclosed before the follower subscribes, and fails closed when the NAV/source is unverified.

#### GAP-169 - Volume fee (per traded volume)  ·  P2

Now: no volume-based fee (B2COPY lists a volume fee)

Verify (from `whitelabel-copytrade/`): `grep -rIliE 'volume.?fee|volumeFee' apps/api/src`

```text
White-Label01-Crypto-Copy-Trading-App/
└── whitelabel-copytrade/apps/api/src/modules/copy-trading/
    ├── dto/
    │   └── leader-fee.dto.ts         # EDIT — add volumeFeeBps on copied notional
    ├── copy-execution.service.ts     # EDIT — hook accrual on terminal FILLED state
    ├── leader-volume-fee.service.ts  # NEW — accrue on FILLED copy executions from persisted notional; exact decimals
    └── leader-volume-fee.spec.ts     # NEW — partial fills, cancels, rounding, idempotent per fill
```

Done when: Accrual is exact-decimal, idempotent per period, posted through the existing fee ledger, disclosed before the follower subscribes, and fails closed when the NAV/source is unverified.

#### GAP-170 - Lock-in / early-exit fee  ·  P2

Now: no lock-in or early-exit fee (B2COPY lists a lock-in fee as an early-exit penalty)

Verify (from `whitelabel-copytrade/`): `grep -rIliE 'lockInFee|lock_in_fee|earlyExitFee|lockDays' apps/api/src`

```text
White-Label01-Crypto-Copy-Trading-App/
└── whitelabel-copytrade/apps/
    ├── api/src/modules/copy-trading/
    │   ├── dto/
    │   │   └── leader-fee.dto.ts              # EDIT — add lockDays + earlyExitFeeBps
    │   ├── follower-subscription.service.ts   # EDIT — apply the lock-in check on stop/cancel
    │   ├── leader-lock-in.service.ts          # NEW — evaluates the early-exit fee on stop/cancel; exact decimals; audit
    │   └── leader-lock-in.spec.ts             # NEW — window boundaries, fee math, confirmation required, idempotent charge
    └── web/src/features/trading/
        └── copy-subscription-detail-page.tsx  # EDIT — stop dialog shows the fee and requires confirmation
```

Done when: Lock window and fee are disclosed up front; stopping inside the window requires explicit confirmation of the fee; the fee never exceeds the tenant ceiling.

#### GAP-171 - Accrued fee debt + recovery for profit-share  ·  P1

Now: fee-debt terms appear only in platform billing types; leader profit-share has no tracking when a fee cannot be collected (B2COPY tracks accrued fee debt)

Verify (from `whitelabel-copytrade/`): `grep -rIliE 'fee.?debt|accruedFeeDebt' apps/api/src/modules/copy-trading`

```text
White-Label01-Crypto-Copy-Trading-App/
└── whitelabel-copytrade/apps/
    ├── admin-web/src/
    │   ├── app/(console)/leader-profit-share/
    │   │   └── page.tsx                                   # EXTEND — (created in GAP-126) mount the debt table
    │   └── features/funding/
    │       └── leader-fee-debt-table.tsx                  # NEW — operator view of open debts + write-off action behind permission
    └── api/
        ├── prisma/
        │   ├── migrations/<STAMP>_leader_fee_debt/
        │   │   └── migration.sql                          # NEW — additive migration + tenant-scoped idempotency composite; then run scripts/gen_part11_rls.py for the additive RLS migration and refresh prisma/rls/rls_coverage.json
        │   └── schema.prisma                              # EDIT — add model LeaderFeeDebt: tenantId, subscriptionId, amount, currency, status OPEN/RECOVERING/RECOVERED/WRITTEN_OFF, openedAt
        └── src/modules/copy-trading/
            ├── leader-fee-debt.service.ts                 # NEW — LeaderFeeDebtService: record, recover from future profits/free balance within caps, write-off only with an audited admin action
            ├── leader-fee-debt.spec.ts                    # NEW — record/recover/cap logic, partial recovery, audit, idempotency
            └── leader-profit-share-settlement.service.ts  # EXTEND — (created in GAP-126) route uncollectable amounts to debt
```

Done when: Uncollectable fees become explicit debt with a recovery policy (from future profits / free balance within caps); no silent write-off; the follower sees the debt before it is collected.

#### GAP-172 - Partner revenue-share on leader fees  ·  P1

Now: partner commissions are sourced from payment / invoice / subscription / fee ids; leader fees are not a commission source (B2COPY says partners share in every fee type)

Verify (from `whitelabel-copytrade/`): `grep -nE 'source[A-Z][A-Za-z]+Id' apps/api/src/modules/partners/partner-commission.service.ts`

```text
White-Label01-Crypto-Copy-Trading-App/
└── whitelabel-copytrade/apps/
    ├── api/src/modules/partners/
    │   ├── partner-commission-ledger.service.ts  # EDIT — ledger line items for leader-fee shares + reversals
    │   ├── partner-commission.service.ts         # EDIT — add source kind LEADER_FEE (sourceLeaderFeeId) + share policy/caps
    │   └── partner-leader-fee-share.spec.ts      # NEW — share math, caps, reversal on refund, idempotency, tenant scope
    └── web/src/features/partner/
        └── partner-dashboard.tsx                 # EDIT — show leader-fee commission line items
```

Done when: A partner earns the contracted share of settled leader fees (all fee types) with caps; ledger lines trace to the leader-fee settlement; reversals follow refunds.

#### GAP-173 - Promo codes / coupons for platform subscriptions  ·  P2

Now: no coupon/promo model or code

Verify (from `whitelabel-copytrade/`): `grep -rIliE 'coupon|promoCode|PromoCode' apps/api/src apps/api/prisma/schema.prisma`

```text
White-Label01-Crypto-Copy-Trading-App/
└── whitelabel-copytrade/apps/
    ├── admin-web/src/
    │   ├── app/(console)/promo-codes/
    │   │   └── page.tsx                  # NEW — console route (+ sidebar entry)
    │   └── features/billing/
    │       └── promo-codes.tsx           # NEW — admin management table
    ├── api/
    │   ├── prisma/
    │   │   ├── migrations/<STAMP>_promo_code/
    │   │   │   └── migration.sql         # NEW — additive migration + tenant-scoped idempotency composite; then run scripts/gen_part11_rls.py for the additive RLS migration and refresh prisma/rls/rls_coverage.json
    │   │   └── schema.prisma             # EDIT — add model PromoCode: tenantId, code, percentOff, amountOff, currency, maxRedemptions, redeemedCount, expiresAt, status
    │   └── src/modules/billing/
    │       ├── billing.module.ts         # EDIT — register service + controller
    │       ├── promo-code.controller.ts  # NEW — admin CRUD + customer redeem endpoint
    │       ├── promo-code.service.ts     # NEW — PromoCodeService: create, validate, redeem (atomic), expire; rate-limited lookups
    │       └── promo-code.spec.ts        # NEW — caps, expiry, concurrent redemption, guess throttling, tenant isolation
    └── web/src/features/billing/
        └── promo-code-input.tsx          # NEW — code input on checkout / plan change
```

Done when: Codes are tenant-scoped, single/multi-use with caps and expiry; applied once per eligible invoice; usage is audited; abuse limits throttle guessing.

#### GAP-174 - Follower realized-gain / tax export (not tax advice)  ·  P2

Now: `cost-basis.service.ts` and `report-export.service.ts` exist (not audited line by line); no follower-facing realized-gain page/route was found, and funding payments are not modeled (GAP-157)

Verify (from `whitelabel-copytrade/`): `grep -rIliE 'realized.?gain|taxReport|realizedGainReport' apps/web/src apps/api/src`

```text
White-Label01-Crypto-Copy-Trading-App/
└── whitelabel-copytrade/apps/
    ├── api/src/modules/portfolio-accounting/
    │   ├── portfolio-accounting.controller.ts  # EDIT — GET report + export endpoints (owner scoped)
    │   ├── realized-gain-report.service.ts     # NEW — per-lot realized gain/loss with selectable method, fees and funding; exact decimals
    │   ├── realized-gain-report.spec.ts        # NEW — FIFO/LIFO/average, partial closes, fees/funding, reconciliation to ledger
    │   └── report-export.service.ts            # EDIT — CSV (injection-safe) + PDF renderers for the new report
    └── web/src/
        ├── app/statements/realized-gains/
        │   └── page.tsx                        # NEW — Next route mounting the page (+ nav link)
        └── features/statements/
            └── realized-gain-report-page.tsx   # NEW — report page with method selector + export buttons + disclaimer
```

Done when: Per-lot realized gain/loss (configurable FIFO/LIFO/average), fees and funding included, CSV + PDF, clearly labelled as informational (not tax advice); totals reconcile with the ledger.

### 3.I Block I: Integration + developer platform

#### GAP-175 - Embeddable widget (iframe / loader) + signed SSO handoff  ·  P1

Now: both Next apps deny framing today (`X-Frame-Options: DENY` in `apps/web/next.config.mjs:15` and `apps/admin-web/next.config.mjs:19`, plus `frame-ancestors 'none'` in the admin middleware) and there is no embed route, loader or SSO handoff. B2COPY ships an iframe widget with SSO

Verify (from `whitelabel-copytrade/`): `grep -rIliE 'frame-ancestors|X-Frame-Options|embed' apps/web/src apps/web/next.config.mjs`

```text
White-Label01-Crypto-Copy-Trading-App/
└── whitelabel-copytrade/
    ├── apps/
    │   ├── admin-web/src/
    │   │   ├── app/(console)/embed/
    │   │   │   └── page.tsx                    # NEW — console route (+ sidebar entry)
    │   │   └── features/settings/
    │   │       └── embed-settings.tsx          # NEW — allowlist editor + snippet generator
    │   ├── api/src/modules/
    │   │   ├── auth/
    │   │   │   ├── embed-sso.controller.ts     # NEW — POST /auth/embed/handoff, POST /auth/embed/exchange
    │   │   │   ├── embed-sso.service.ts        # NEW — mint (server-to-server with tenant API key) and exchange short-lived single-use SSO handoff tokens for a scoped session
    │   │   │   └── embed-sso.spec.ts           # NEW — replay rejected, expiry, wrong tenant, origin allowlist, scope limited
    │   │   └── tenants/
    │   │       └── tenant-settings.service.ts  # EDIT — embed origin allowlist setting (https only, no wildcards)
    │   └── web/
    │       ├── public/
    │       │   └── embed.js                    # NEW — < 3 KB loader: creates the iframe, handles resize + events, versioned URL
    │       ├── src/
    │       │   ├── app/embed/
    │       │   │   ├── leaderboard/
    │       │   │   │   └── page.tsx            # NEW — embeddable leaderboard
    │       │   │   ├── trader/[id]/
    │       │   │   │   └── page.tsx            # NEW — embeddable trader card/profile
    │       │   │   └── layout.tsx              # NEW — embed shell: minimal chrome, tenant theming, no navigation
    │       │   ├── lib/embed/
    │       │   │   └── embed-bridge.ts         # NEW — postMessage protocol (resize, auth-required, copy-started) with strict origin check against the tenant allowlist
    │       │   └── middleware.ts               # NEW — per-request CSP: frame-ancestors from the tenant embed allowlist on /embed/*, deny everywhere else
    │       └── next.config.mjs                 # EDIT — sets X-Frame-Options: DENY on every route today (line 15): exclude /embed/* from that header, because it would override the CSP frame-ancestors allowlist
    ├── docs/
    │   └── EMBED_GUIDE.md                      # NEW — integration guide: snippet, events, SSO flow, security model
    └── tests/browser/
        └── embed-widget.browser.spec.ts        # NEW — (uses the GAP-104 harness) host page embeds the widget; disallowed origin is blocked
```

Done when: A tenant site embeds leaderboard / trader cards via one script tag; the iframe talks to the host only through an origin-checked postMessage protocol; SSO handoff tokens are server-minted, <= 60 s, single-use, scope-limited (no withdraw, no key management).

#### GAP-176 - Developer webhook catalog: complete the copy-trading lifecycle  ·  P1

Now: the event catalog covers customer / subscription / payment / invoice / funding / withdrawal events, but only `copy.subscription.created` and `copy.subscription.cancelled` for copy trading

Verify (from `whitelabel-copytrade/`): `grep -nE "eventType: '(copy|risk|kill|trader|fee|payout)" apps/api/src/modules/developer-platform/developer.types.ts`

```text
White-Label01-Crypto-Copy-Trading-App/
└── whitelabel-copytrade/
    ├── apps/api/src/modules/developer-platform/
    │   ├── event-schemas/
    │   │   ├── copy-events.schema.ts        # NEW — JSON schemas for copy.* events
    │   │   ├── fee-events.schema.ts         # NEW — JSON schemas for fee.* and payout.* events
    │   │   └── risk-events.schema.ts        # NEW — JSON schemas for risk.* and kill_switch.* events
    │   ├── developer-event-catalog.spec.ts  # NEW — every event has schema + emitter + delivery test; catalog snapshot
    │   ├── developer.types.ts               # EDIT — add copy.subscription.paused|resumed|stopped, copy.execution.filled|failed|skipped, risk.stop_triggered, kill_switch.activated|released, trader.verified, fee.accrued|settled, payout.completed (v1)
    │   └── event-subscription.service.ts    # EDIT — validate subscribed event types against the catalog
    ├── docs/
    │   └── WEBHOOK_EVENTS.md                # NEW — generated
    └── scripts/
        └── gen-webhook-docs.mjs             # NEW — generates docs/WEBHOOK_EVENTS.md from the catalog; --check mode for CI
```

Done when: Every catalog event has a versioned JSON schema, a real emitter (via the outbox, GAP-177), and a delivery test; `docs/WEBHOOK_EVENTS.md` is generated from the catalog; subscribing to an unknown event is rejected.

#### GAP-177 - Transactional outbox for domain events  ·  P1

Now: no outbox pattern in the API or schema; events are emitted directly from services, so a crash between commit and publish can lose or duplicate an event

Verify (from `whitelabel-copytrade/`): `grep -rIli 'outbox' apps/api/src apps/api/prisma/schema.prisma`

```text
White-Label01-Crypto-Copy-Trading-App/
└── whitelabel-copytrade/
    ├── apps/api/
    │   ├── prisma/
    │   │   ├── migrations/<STAMP>_outbox_event/
    │   │   │   └── migration.sql                     # NEW — additive migration + tenant-scoped idempotency composite; then run scripts/gen_part11_rls.py for the additive RLS migration and refresh prisma/rls/rls_coverage.json
    │   │   └── schema.prisma                         # EDIT — add model OutboxEvent: tenantId, aggregateType, aggregateId, eventType, payload, status PENDING/PUBLISHED/DEAD, attempts, availableAt, publishedAt, idempotencyKey
    │   └── src/
    │       ├── infrastructure/
    │       │   ├── metrics/
    │       │   │   └── metrics.registry.ts           # EDIT — outbox_lag_seconds gauge + published/failed counters
    │       │   └── outbox/
    │       │       ├── outbox-relay.processor.ts     # NEW — claim batches (FOR UPDATE SKIP LOCKED), publish to webhook delivery + notification fan-out, retry with backoff, dead-letter
    │       │       ├── outbox.module.ts              # NEW — module wiring
    │       │       ├── outbox.service.ts             # NEW — write events inside the caller transaction (Prisma $transaction helper)
    │       │       └── outbox.spec.ts                # NEW — crash between commit and publish, ordering per aggregate, DLQ, idempotent publish
    │       ├── modules/copy-trading/
    │       │   ├── copy-execution.service.ts         # EDIT — emit copy.execution.* through the outbox inside the transaction
    │       │   └── follower-subscription.service.ts  # EDIT — emit copy.subscription.* through the outbox
    │       └── app.module.ts                         # EDIT — import OutboxModule
    └── infrastructure/observability/prometheus/rules/
        └── wlct.rules.yml                            # EDIT — alert: outbox lag over threshold
```

Done when: State change + event are written in ONE transaction; a relay publishes with at-least-once delivery and idempotency keys; a crash between commit and publish still delivers exactly one effective event; lag is a metric with an alert.

#### GAP-178 - Committed OpenAPI spec + Postman collection + drift check  ·  P1

Now: no `openapi*.json/yaml` or Postman file anywhere in the repo (find returned nothing); buyers and SDK consumers have no machine-readable contract

Verify (from `whitelabel-copytrade/`): `find . -path ./node_modules -prune -o \( -iname 'openapi*' -o -iname '*.postman_collection.json' \) -print | grep -v node_modules`

```text
White-Label01-Crypto-Copy-Trading-App/
├── .github/workflows/
│   └── ci.yml                            # EDIT — openapi drift step
└── whitelabel-copytrade/
    ├── apps/api/
    │   ├── scripts/
    │   │   └── export-openapi.ts         # NEW — boots Nest in test mode, builds the Swagger document, writes docs/openapi/openapi.json with sorted keys (deterministic)
    │   └── package.json                  # EDIT — scripts: openapi:export
    ├── docs/openapi/
    │   ├── openapi.json                  # NEW — generated; committed
    │   └── wlct.postman_collection.json  # NEW — generated from the spec with baseUrl/tenant/token variables
    ├── scripts/
    │   └── check-openapi-drift.mjs       # NEW — regenerate + diff; exit 1 on drift
    └── package.json                      # EDIT — scripts: check:openapi-drift
```

Done when: `docs/openapi/openapi.json` is generated deterministically and committed; CI fails when the spec drifts from the code; a Postman collection is generated from it.

#### GAP-179 - SDK generation from the spec + publish pipeline  ·  P1

Now: TypeScript SDK is hand-written (`packages/sdk-typescript/src/client.ts`), the Rust SDK is a single `lib.rs`; no generator, no publish config, no changelog/versioning policy

Verify (from `whitelabel-copytrade/`): `grep -rIlE 'publishConfig|npm publish|twine upload|cargo publish|changesets' packages .github ../.github scripts`

```text
White-Label01-Crypto-Copy-Trading-App/
├── .github/workflows/
│   └── sdk-publish.yml                     # NEW — tag sdk-v*: build, test, dry-run publish for npm/PyPI/crates; real publish only in an approved environment with secrets
└── whitelabel-copytrade/
    ├── docs/
    │   └── SDK_RELEASING.md                # NEW — semver + deprecation policy, compatibility matrix with API versions (api-version.service.ts)
    └── packages/
        ├── sdk-python/
        │   ├── scripts/
        │   │   └── generate.py             # NEW — generate pydantic models from the spec (datamodel-code-generator)
        │   └── pyproject.toml              # EDIT — version, classifiers, build backend metadata
        ├── sdk-rust/
        │   └── Cargo.toml                  # EDIT — package metadata (license, repository, description); publish=false until a registry is configured
        └── sdk-typescript/
            ├── scripts/
            │   └── generate.mjs            # NEW — generate typed models from docs/openapi/openapi.json (openapi-typescript) into src/generated
            ├── src/
            │   ├── __tests__/
            │   │   └── spec-drift.test.ts  # NEW — fails when generated types are stale against the spec
            │   └── generated/
            │       └── schema.d.ts         # NEW — generated types; never hand-edit
            ├── CHANGELOG.md                # NEW — keep-a-changelog format, starts at the current version
            └── package.json                # EDIT — version, files, exports, publishConfig, prepublishOnly (build + test + drift)
```

Done when: SDK types are generated from the committed spec (never hand-edited); version + changelog policy documented; a tag-triggered workflow dry-runs npm/PyPI/crates publishing and requires an approved environment for the real publish.

#### GAP-180 - Helpdesk integration (Zendesk / Intercom) + support context  ·  P2

Now: no helpdesk references and no ticket model; the web app has a support page but nothing behind it

Verify (from `whitelabel-copytrade/`): `grep -rIliE 'zendesk|intercom|freshdesk|helpscout|crisp' apps packages docs`

```text
White-Label01-Crypto-Copy-Trading-App/
└── whitelabel-copytrade/apps/
    ├── api/src/modules/providers/
    │   ├── adapters/support/
    │   │   ├── intercom.adapter.ts                # NEW — create conversations/tickets via Intercom API, identity verification (HMAC user hash)
    │   │   ├── support-adapters.contract.spec.ts  # NEW — recorded fixtures, outage fallback, signature checks
    │   │   ├── support.adapter.ts                 # NEW — SupportProvider strategy interface + selector by tenant config
    │   │   └── zendesk.adapter.ts                 # NEW — create/list tickets via Zendesk API (token auth), webhook verification
    │   ├── support-context.service.ts             # NEW — builds the minimal, redacted context payload attached to tickets
    │   └── support.controller.ts                  # NEW — POST/GET own tickets (permission-decorated, tenant-scoped, throttled)
    └── web/src/
        ├── app/support/
        │   └── page.tsx                           # EDIT — mount the form
        └── features/support/
            └── support-ticket-form.tsx            # NEW — ticket form + own-ticket list
```

Done when: A customer can open and list their own tickets from the app; ticket context carries tenant/plan/recent error ids but no secrets or unnecessary PII; provider outage degrades to an email fallback.

#### GAP-181 - Tenant-editable notification templates  ·  P2

Now: `notification-template.service.ts` resolves code templates with a locale override only; no tenant override model or editor

Verify (from `whitelabel-copytrade/`): `grep -rIliE 'NotificationTemplateOverride|templateOverride' apps/api/src apps/api/prisma/schema.prisma`

```text
White-Label01-Crypto-Copy-Trading-App/
└── whitelabel-copytrade/apps/
    ├── admin-web/src/
    │   ├── app/(console)/notification-templates/
    │   │   └── page.tsx                                   # NEW — console route (+ sidebar entry)
    │   └── features/settings/
    │       └── notification-template-editor.tsx           # NEW — editor with live preview + diff + rollback
    └── api/
        ├── prisma/
        │   ├── migrations/<STAMP>_notification_template_override/
        │   │   └── migration.sql                          # NEW — additive migration + tenant-scoped idempotency composite; then run scripts/gen_part11_rls.py for the additive RLS migration and refresh prisma/rls/rls_coverage.json
        │   └── schema.prisma                              # EDIT — add model NotificationTemplateOverride: tenantId, key, locale, subject, bodyHtml, bodyText, version, state
        └── src/modules/billing/notifications/
            ├── notification-template-override.service.ts  # NEW — sanitize HTML (allowlist), variable allowlist, preview render, versioning + rollback, audit
            ├── notification-template-override.spec.ts     # NEW — XSS payloads, unknown variables, mandatory-content guard, rollback
            └── notification-template.service.ts           # EDIT — resolution order: tenant override > locale > default
```

Done when: Tenant admins edit templates per key + locale with an allowlisted variable set, sanitized HTML, preview with sample data, versioning and rollback; security-critical templates cannot drop mandatory content.

#### GAP-182 - Notification quiet hours + digest  ·  P2

Now: `NotificationPreference` has only category / channel / enabled

Verify (from `whitelabel-copytrade/`): `grep -rIliE 'quietHours|quiet_hours|digestFrequency|dailyDigest' apps/api`

```text
White-Label01-Crypto-Copy-Trading-App/
└── whitelabel-copytrade/apps/
    ├── api/
    │   ├── prisma/
    │   │   ├── migrations/<STAMP>_notification_quiet_hours/
    │   │   │   └── migration.sql                        # NEW — additive columns
    │   │   └── schema.prisma                            # EDIT — NotificationPreference: quietStart, quietEnd, timezone, digestFrequency (additive)
    │   └── src/modules/notifications/
    │       ├── processors/
    │       │   └── digest.processor.ts                  # NEW — BullMQ digest assembly + send
    │       ├── notification-delivery-policy.service.ts  # NEW — defer/suppress non-critical during quiet hours; CRITICAL always immediate; digest batching rules
    │       └── notification-delivery-policy.spec.ts     # NEW — timezone/DST boundaries, CRITICAL bypass, digest grouping
    └── web/src/features/notifications/
        └── quiet-hours-settings.tsx                     # NEW — quiet hours + digest settings UI
```

Done when: Non-critical notifications are deferred inside quiet hours and can be batched into a digest; CRITICAL categories (security, liquidation risk, kill switch) always deliver immediately.

#### GAP-183 - Web + admin i18n (next-intl; en, bn, ar with RTL, es, tr)  ·  P2

Now: no i18n library in `apps/web` or `apps/admin-web` package.json and no translation calls; the API has locale bundles and the mobile app has `l10n.yaml`, so only the web UIs are English-only

Verify (from `whitelabel-copytrade/`): `grep -lE 'next-intl|i18next|react-intl|lingui' apps/web/package.json apps/admin-web/package.json`

```text
White-Label01-Crypto-Copy-Trading-App/
└── whitelabel-copytrade/
    ├── apps/
    │   ├── admin-web/messages/
    │   │   ├── bn.json                            # NEW — admin Bengali strings
    │   │   └── en.json                            # NEW — admin source strings
    │   └── web/
    │       ├── messages/
    │       │   ├── ar.json                        # NEW — Arabic strings (complete or fails the check)
    │       │   ├── bn.json                        # NEW — Bengali strings (complete or fails the check)
    │       │   ├── en.json                        # NEW — source strings (complete)
    │       │   ├── es.json                        # NEW — Spanish strings
    │       │   └── tr.json                        # NEW — Turkish strings
    │       ├── src/
    │       │   ├── app/
    │       │   │   └── layout.tsx                 # EDIT — set lang/dir from the resolved locale
    │       │   ├── i18n/
    │       │   │   └── request.ts                 # NEW — locale resolution (user preference > tenant default > Accept-Language)
    │       │   └── tests/
    │       │       └── i18n-completeness.test.ts  # NEW — runs the completeness check in Jest
    │       ├── next.config.mjs                    # EDIT — next-intl plugin
    │       └── package.json                       # EDIT — add next-intl
    └── scripts/
        └── check-i18n-completeness.mjs            # NEW — fails when any locale lacks a key or has an unused key; RTL class smoke
```

Done when: Web renders in the selected locale with correct `lang`/`dir`; missing keys fail the completeness check; numbers/dates use the exact-decimal formatter (GAP-91); RTL smoke test passes.

### 3.J Block J: Security + tenant lifecycle

#### GAP-184 - Passkeys / WebAuthn  ·  P1

Now: `security.types.ts` contains only the enum value `WEBAUTHN`; no registration or assertion endpoints exist

Verify (from `whitelabel-copytrade/`): `grep -rIliE 'webauthn|passkey' apps/api/src apps/web/src`

```text
White-Label01-Crypto-Copy-Trading-App/
└── whitelabel-copytrade/apps/
    ├── api/
    │   ├── prisma/
    │   │   ├── migrations/<STAMP>_web_authn_credential/
    │   │   │   └── migration.sql        # NEW — additive migration + tenant-scoped idempotency composite; then run scripts/gen_part11_rls.py for the additive RLS migration and refresh prisma/rls/rls_coverage.json
    │   │   └── schema.prisma            # EDIT — add model WebAuthnCredential: tenantId, userId, credentialId, publicKey, signCount, transports, label, createdAt, lastUsedAt, revokedAt
    │   └── src/modules/auth/
    │       ├── auth.module.ts           # EDIT — register WebAuthnService + controller
    │       ├── step-up-auth.service.ts  # EXTEND — (created in carry-over GAP-77) accept a passkey assertion as a step-up factor
    │       ├── webauthn.controller.ts   # NEW — options/verify endpoints for register + login
    │       ├── webauthn.service.ts      # NEW — registration + authentication ceremonies (@simplewebauthn/server); challenge store with TTL; counter/clone detection; RP ID from the tenant domain
    │       └── webauthn.spec.ts         # NEW — replay, counter regression, wrong origin, expired challenge, tenant isolation
    └── web/src/features/security/
        ├── passkeys-page.tsx            # NEW — manage/register/remove passkeys
        └── security-page.tsx            # EDIT — link to the passkeys page
```

Done when: Users register and sign in with passkeys (per-tenant RP ID); challenges are single-use with TTL; signature-counter regression and wrong-origin assertions are rejected; passkey counts as a step-up factor.

#### GAP-185 - Consumer social login (Google / Apple), per tenant  ·  P2

Now: `auth.service.ts` and `sso-login.service.ts` contain no Google/Apple login (SSO is enterprise SAML/OIDC only)

Verify (from `whitelabel-copytrade/`): `grep -niE 'google|apple' apps/api/src/modules/auth/auth.service.ts apps/api/src/modules/auth/sso/sso-login.service.ts`

```text
White-Label01-Crypto-Copy-Trading-App/
└── whitelabel-copytrade/apps/
    ├── api/src/modules/auth/
    │   ├── social-login.controller.ts  # NEW — start/callback endpoints
    │   ├── social-login.service.ts     # NEW — OIDC code flow with PKCE for Google and Apple; per-tenant enable flag; link-only-after-verification rule
    │   └── social-login.spec.ts        # NEW — state/nonce checks, unverified email, account-link policy, tenant disabled
    └── web/src/features/login/
        └── social-login-buttons.tsx    # NEW — buttons rendered only when enabled by the tenant
```

Done when: Tenants can enable Google/Apple sign-in (authorization code + PKCE); an existing account is linked only after verified email + step-up; never auto-merged; disabled by default.

#### GAP-186 - Support "view-as" (read-only impersonation)  ·  P2

Now: no impersonation feature (the 3 grep hits are comments)

Verify (from `whitelabel-copytrade/`): `grep -rIliE 'impersonat|viewAs|view_as' apps packages`

```text
White-Label01-Crypto-Copy-Trading-App/
└── whitelabel-copytrade/apps/
    ├── admin-web/src/
    │   ├── app/(console)/view-as/
    │   │   └── page.tsx                    # NEW — console route (+ sidebar entry)
    │   └── features/support/
    │       └── view-as-launcher.tsx        # NEW — launcher requiring ticket id + reason
    ├── api/
    │   ├── prisma/
    │   │   ├── migrations/<STAMP>_view_as_session/
    │   │   │   └── migration.sql           # NEW — additive migration + tenant-scoped idempotency composite; then run scripts/gen_part11_rls.py for the additive RLS migration and refresh prisma/rls/rls_coverage.json
    │   │   └── schema.prisma               # EDIT — add model ViewAsSession: tenantId, agentUserId, subjectUserId, ticketId, consentRecordId, expiresAt, endedAt
    │   └── src/modules/rbac/
    │       ├── view-as-session.service.ts  # NEW — ViewAsSessionService: create/expire sessions with ticket id + consent record or break-glass dual approval; read-only scope token
    │       ├── view-as.guard.ts            # NEW — blocks every non-GET request and sensitive reads (keys, withdrawal destinations)
    │       └── view-as.spec.ts             # NEW — mutations blocked, expiry, consent, audit, cross-tenant denied
    └── web/src/components/
        └── view-as-banner.tsx              # NEW — persistent banner while a view-as session is active
```

Done when: Time-boxed (<= 30 min), read-only; every mutating request is blocked by a guard; requires a ticket id plus user consent or dual-approved break-glass; every request is audited; a visible banner is shown to the support agent.

#### GAP-187 - Tenant offboarding + export + deletion  ·  P1

Now: no tenant offboarding/export/purge code (the only privacy export is per user: `PrivacyExport`)

Verify (from `whitelabel-copytrade/`): `grep -rIliE 'offboard|tenantExport|tenantPurge|decommission' apps scripts docs`

```text
White-Label01-Crypto-Copy-Trading-App/
└── whitelabel-copytrade/
    ├── apps/
    │   ├── admin-web/src/
    │   │   ├── app/(console)/tenant-offboarding/
    │   │   │   └── page.tsx                          # NEW — console route (+ sidebar entry)
    │   │   └── features/tenants/
    │   │       └── tenant-offboarding-console.tsx    # NEW — operator console for the lifecycle
    │   └── api/
    │       ├── prisma/
    │       │   ├── migrations/<STAMP>_tenant_offboarding/
    │       │   │   └── migration.sql                 # NEW — additive migration + tenant-scoped idempotency composite; then run scripts/gen_part11_rls.py for the additive RLS migration and refresh prisma/rls/rls_coverage.json
    │       │   └── schema.prisma                     # EDIT — add model TenantOffboarding: tenantId, state, noticeAt, readOnlyAt, exportedAt, exportHash, purgeScheduledAt, purgedAt
    │       └── src/modules/tenants/
    │           ├── tenant-export.service.ts          # NEW — tenant-scoped export to an encrypted, signed archive; excludes secrets
    │           ├── tenant-offboarding.controller.ts  # NEW — platform-admin endpoints (permission-decorated, audited)
    │           ├── tenant-offboarding.service.ts     # NEW — state machine + side effects (stop copying, pause billing, revoke API keys), legal-hold aware
    │           └── tenant-offboarding.spec.ts        # NEW — transitions, legal hold, export completeness, no cross-tenant data
    ├── docs/
    │   └── TENANT_OFFBOARDING.md                     # NEW — runbook: notice periods, export handover, purge verification
    └── scripts/
        └── tenant-purge.ts                           # NEW — purge after retention + legal-hold check; dry-run default; verifies export hash first
```

Done when: A tenant moves ACTIVE -> NOTICE -> READ_ONLY -> EXPORTING -> PURGE_SCHEDULED -> PURGED; copy activity stops, billing pauses, keys are revoked; legal holds block purge; export is encrypted, signed and excludes secrets; purge defaults to dry-run.

#### GAP-188 - Automated TLS for custom domains  ·  P1

Now: `TenantDomain` stores a verification token and `certificateExpiry`, but there is no issuance tooling anywhere (no caddy / certbot / cert-manager / letsencrypt reference)

Verify (from `whitelabel-copytrade/`): `grep -rIliE 'caddy|certbot|cert-manager|letsencrypt|lets-encrypt' apps infrastructure scripts docs`

```text
White-Label01-Crypto-Copy-Trading-App/
└── whitelabel-copytrade/
    ├── apps/api/src/modules/tenants/
    │   ├── tenant-domain-cert-monitor.service.ts  # NEW — probes certificates, updates certificateExpiry, raises alerts under 14 days
    │   ├── tenant-domain-tls.controller.ts        # NEW — internal GET /internal/tls/allow?domain= -> 200 only for VERIFIED tenant domains (internal auth)
    │   └── tenant-domain-tls.spec.ts              # NEW — verified vs unverified vs unknown, internal auth required, no enumeration
    ├── docs/
    │   └── CUSTOM_DOMAINS_TLS.md                  # NEW — how it works, DNS steps, alternative (CDN-managed certificates), failure modes
    ├── infrastructure/edge/
    │   └── Caddyfile                              # NEW — on-demand TLS with an `ask` endpoint; reverse proxy to web/admin; sane timeouts + headers
    ├── scripts/
    │   └── verify-domain-tls.mjs                  # NEW — smoke: resolves a domain, checks chain + expiry
    └── docker-compose.yml                         # EDIT — add the edge service (profile: edge) wired to web/admin/api
```

Done when: A verified tenant domain gets a certificate automatically on first request (on-demand TLS gated by the API), renewal is monitored, certificates expiring in < 14 days alert; unverified domains never get a certificate.

#### GAP-189 - Distributed tracing (OpenTelemetry) API -> engine -> venue  ·  P2

Now: no `@opentelemetry` dependency anywhere; only the Rust gateway has a `tracing.rs`; metrics exist but a copy order cannot be followed across services

Verify (from `whitelabel-copytrade/`): `grep -lE '@opentelemetry|opentelemetry-' package.json apps/api/package.json libs/trading-core/pyproject.toml services/*/requirements*.txt`

```text
White-Label01-Crypto-Copy-Trading-App/
└── whitelabel-copytrade/
    ├── apps/api/src/
    │   ├── infrastructure/tracing/
    │   │   ├── otel-propagation.spec.ts      # NEW — context propagation through queue + HTTP; no secret attributes
    │   │   ├── otel.ts                       # NEW — SDK init (OTLP exporter, sampler, resource attributes); hashed tenant attribute only
    │   │   └── trace-context.interceptor.ts  # NEW — propagates traceparent to engine HTTP calls and queue jobs
    │   └── main.ts                           # EDIT — initialize tracing before app creation
    ├── infrastructure/observability/
    │   └── otel-collector.yml                # NEW — collector config (OTLP in, Tempo/Jaeger out)
    ├── services/execution-engine/app/
    │   └── tracing.py                        # NEW — FastAPI instrumentation + context extraction; spans around venue calls
    └── docker-compose.observability.yml      # EDIT — add collector + trace backend
```

Done when: One trace follows leader event -> copy decision -> engine -> venue call with W3C trace context; secrets and raw tenant ids never appear in attributes; sampling configurable.

#### GAP-190 - Travel-rule data capture for withdrawals (jurisdiction-dependent)  ·  P3

Now: no travel-rule / FATF / VASP handling anywhere in the API or docs

Verify (from `whitelabel-copytrade/`): `grep -rIliE 'travel.?rule|fatf|vasp' apps/api/src docs`

```text
White-Label01-Crypto-Copy-Trading-App/
└── whitelabel-copytrade/apps/api/
    ├── prisma/
    │   ├── migrations/<STAMP>_travel_rule_record/
    │   │   └── migration.sql                        # NEW — additive migration + tenant-scoped idempotency composite; then run scripts/gen_part11_rls.py for the additive RLS migration and refresh prisma/rls/rls_coverage.json
    │   └── schema.prisma                            # EDIT — add model TravelRuleRecord: tenantId, withdrawalId, originator (encrypted), beneficiary (encrypted), vaspRef, status
    └── src/modules/
        ├── compliance/
        │   ├── travel-rule.service.ts               # NEW — threshold + jurisdiction policy, data collection, vendor-neutral interface; missing data => HOLD
        │   └── travel-rule.spec.ts                  # NEW — threshold boundaries, missing data, jurisdiction toggle
        └── custody/
            └── withdrawal-orchestration.service.ts  # EDIT — call the travel-rule check before authorization
```

Done when: When a tenant jurisdiction requires it, withdrawals above the threshold collect originator/beneficiary data and fail closed to HOLD when it is missing; a vendor adapter interface is defined; legal review is recorded.

#### GAP-191 - Bulk admin operations  ·  P3

Now: no bulk/batch actions in admin-web or the RBAC/users modules

Verify (from `whitelabel-copytrade/`): `grep -rIliE 'bulk|batchApprove|csvImport' apps/admin-web/src apps/api/src/modules/rbac apps/api/src/modules/users`

```text
White-Label01-Crypto-Copy-Trading-App/
└── whitelabel-copytrade/apps/
    ├── admin-web/src/components/
    │   └── bulk-action-bar.tsx         # NEW — selection bar with confirmation + result summary
    └── api/src/modules/rbac/
        ├── bulk-operations.service.ts  # NEW — idempotent batch executor with max size, per-item results, audit per item
        └── bulk-operations.spec.ts     # NEW — partial failure, idempotency, caps, permission per item
```

Done when: Batch actions are idempotent, capped, return per-item results and are audited per item.

### 3.K Block K: Platform, quality, final regression

#### GAP-192 - Rust low-latency gateway: make it deployable or retire it  ·  P1

Now: `services/low-latency-gateway` (Rust, ~10k LOC) has no Dockerfile in `infrastructure/docker`, no compose service, and the CI `rust` job only covers `packages/sdk-rust`

Verify (from `whitelabel-copytrade/`): `grep -rIlE 'low-latency-gateway' infrastructure docker-compose*.yml ../.github`

```text
White-Label01-Crypto-Copy-Trading-App/
├── .github/workflows/
│   └── ci.yml                                # EDIT — rust job extends to services/low-latency-gateway: fmt --check, clippy -D warnings, test --locked, cargo audit
└── whitelabel-copytrade/
    ├── docs/
    │   ├── adr/
    │   │   └── ADR-0002-gateway-decision.md  # NEW — integrate vs retire decision with measured evidence
    │   └── evidence/
    │       └── gateway-bench.md              # NEW — recorded benchmark numbers with machine + commit
    ├── infrastructure/docker/
    │   └── low-latency-gateway.Dockerfile    # NEW — multi-stage cargo build --release --locked, minimal runtime, non-root, healthcheck
    ├── services/low-latency-gateway/
    │   ├── benches/
    │   │   └── latency.rs                    # NEW — criterion benchmark: parse -> book update -> publish
    │   └── README.md                         # NEW — what it does today, how it plugs in, measured numbers (or a RETIRED notice)
    └── docker-compose.yml                    # EDIT — add the gateway service (profile: lowlatency) with healthcheck
```

Done when: ADR-0002 records the decision with benchmark evidence. INTEGRATE: image builds, runs in compose, CI runs fmt/clippy/test/audit. RETIRE: moved out of the shipped tree and all README claims removed. Either way the README matches reality.

#### GAP-193 - Property-based tests for money math and sizing  ·  P1

Now: no hypothesis / fast-check / proptest anywhere, although exact-decimal math, sizing, fees and HWM carry real money

Verify (from `whitelabel-copytrade/`): `grep -rIlE 'hypothesis|fast-check|proptest' package.json apps/api/package.json libs/trading-core/pyproject.toml services/low-latency-gateway/Cargo.toml`

```text
White-Label01-Crypto-Copy-Trading-App/
└── whitelabel-copytrade/
    ├── apps/api/
    │   ├── src/
    │   │   ├── common/
    │   │   │   └── decimal-string.property.spec.ts  # NEW — add/sub inverse, parse/format round trip, rounding never increases exposure, comparison is a total order
    │   │   └── modules/copy-trading/
    │   │       ├── copy-sizing.property.spec.ts     # NEW — sizing never exceeds caps for any input; proportional monotonic; step rounding never exceeds budget
    │   │       └── leader-fee.property.spec.ts      # NEW — HWM monotonic; fee never exceeds profit above HWM; period replay idempotent
    │   └── package.json                             # EDIT — devDependency fast-check
    ├── libs/trading-core/
    │   ├── tests/
    │   │   ├── test_money_properties.py             # NEW — decimal helpers + precision rounding properties
    │   │   └── test_sizing_properties.py            # NEW — engine-side sizing properties
    │   └── pyproject.toml                           # EDIT — dev dependency hypothesis
    └── services/low-latency-gateway/
        ├── integration/
        │   └── order_book_props.rs                  # NEW — book never crosses; sequence guard rejects gaps/duplicates
        └── Cargo.toml                               # EDIT — dev-dependency proptest
```

Done when: Properties run in CI with fixed seeds + a counterexample corpus; any failing example is committed as a regression test.

#### GAP-194 - Remove structure-check placeholder files  ·  P1

Now: two files declare that they exist only "to satisfy the required file structure check": `apps/web/src/main.tsx` (non-Next bootstrap) and `apps/web/vite.config.ts` ("NOT USED"); `apps/web` is a Next.js app

Verify (from `whitelabel-copytrade/`): `grep -rIlE 'satisfy the required file structure|exists to satisfy|NOT USED|Placeholder - ' apps services libs packages ops scripts --exclude-dir=node_modules`

```text
White-Label01-Crypto-Copy-Trading-App/
├── .github/workflows/
│   └── ci.yml                         # EDIT — run placeholder-guard in the repository-validators step
└── whitelabel-copytrade/
    ├── apps/web/
    │   ├── src/
    │   │   └── main.tsx               # DELETE — non-Next bootstrap that nothing uses; delete
    │   └── vite.config.ts             # DELETE — declares itself NOT USED; delete
    └── ops/
        ├── gap-parity-scanner.js      # EDIT — drop these two paths from the required-target list
        ├── placeholder-guard.js       # NEW — fails when a source file contains placeholder/"exists to satisfy" markers or is unreachable from the import graph
        └── placeholder-guard.test.js  # NEW — fixtures: marker detected, clean file passes
```

Done when: No source file declares itself a placeholder; scanners and target lists no longer require these paths; a CI guard prevents new ones.

#### GAP-195 - Web performance budgets (Lighthouse CI + bundle limits)  ·  P2

Now: no lighthouse / lhci / size-limit anywhere (the only hits are eslint configs)

Verify (from `whitelabel-copytrade/`): `grep -rIliE 'lighthouse|lhci|size-limit' apps .github ../.github scripts ops package.json`

```text
White-Label01-Crypto-Copy-Trading-App/
├── .github/workflows/
│   └── web-perf.yml          # NEW — build web, run lhci against the staging-proof stack, upload reports
└── whitelabel-copytrade/
    ├── apps/web/
    │   ├── .size-limit.json  # NEW — per-route JS budgets
    │   └── package.json      # EDIT — size-limit dev dependency + script
    ├── docs/evidence/
    │   └── web-perf.md       # NEW — recorded baseline + date + commit
    └── .lighthouserc.json    # NEW — assertions: performance >= 0.8, accessibility >= 0.95, LCP < 2.5 s (mobile profile) on /, /traders, /traders/[id], /login
```

Done when: CI fails when performance / accessibility / LCP budgets or per-route bundle limits regress on key pages.

#### GAP-196 - Mobile deep / universal links  ·  P2

Now: no applinks / assetlinks / app_links handling in `apps/mobile`

Verify (from `whitelabel-copytrade/`): `grep -rIliE 'applinks|assetlinks|app_links|uni_links|deepLink' apps/mobile`

```text
White-Label01-Crypto-Copy-Trading-App/
└── whitelabel-copytrade/apps/
    ├── mobile/
    │   ├── lib/
    │   │   ├── core/router/
    │   │   │   └── deep_link_handler.dart   # NEW — maps https://<tenant-domain>/traders/:id, /copy/:id, /notifications to routes; auth-gated; no actions from links
    │   │   └── features/notifications/data/
    │   │       └── push_service.dart        # EXTEND — (created in GAP-138) route push payload deep links through the handler
    │   ├── test/core/router/
    │   │   └── deep_link_handler_test.dart  # NEW — mapping, unauthenticated redirect, malformed links ignored
    │   └── pubspec.yaml                     # EDIT — add app_links
    └── web/public/.well-known/
        ├── apple-app-site-association       # NEW — template; generated per tenant
        └── assetlinks.json                  # NEW — template; generated per tenant by scripts/mobile-tenant-build.mjs (GAP-140)
```

Done when: Links to traders / subscriptions / notifications open the right screen after authentication; links never execute actions; verification files are generated per tenant.

#### GAP-197 - Partitioning + retention for high-volume tables  ·  P2

Now: no `PARTITION BY` and no materialized views in any migration; high-volume tables: CopyExecution, fills, AuditLog, MarketDataRecord, Notification, WebhookDeliveryAttempt

Verify (from `whitelabel-copytrade/`): `grep -rIlE 'PARTITION BY|MATERIALIZED VIEW' apps/api/prisma/migrations`

```text
White-Label01-Crypto-Copy-Trading-App/
└── whitelabel-copytrade/
    ├── apps/api/
    │   ├── prisma/migrations/<STAMP>_partition_high_volume_tables/
    │   │   └── migration.sql                       # NEW — declarative partitioning for new data by month (attach/detach strategy; old tables read-only until archived)
    │   └── src/modules/ops/
    │       ├── partition-maintenance.processor.ts  # NEW — scheduled maintenance job with metrics + alerts
    │       └── partition-maintenance.spec.ts       # NEW — partition naming, retention, legal-hold skip, dry-run
    ├── docs/
    │   ├── evidence/
    │   │   └── partition-bench.md                  # NEW — query plans before/after on a 10M-row dataset
    │   └── DATA_LIFECYCLE.md                       # NEW — retention per table, archive target, legal-hold interplay
    └── scripts/
        └── partition-maintenance.mjs               # NEW — creates next N partitions, detaches/archives past retention; dry-run default
```

Done when: Do this only if GAP-122 load results show the need. Monthly partitions for chosen tables, automated creation/detach/archive, retention per table documented and legal-hold aware, query plans before/after recorded.

#### GAP-198 - Additional venues: Hyperliquid (DEX perps), Gate, MEXC  ·  P3

Now: none of the three exists in the repo; venue breadth stays at the GAP-113–118 set

Verify (from `whitelabel-copytrade/`): `grep -rIliE 'hyperliquid|gate\.io|mexc' apps libs services`

```text
White-Label01-Crypto-Copy-Trading-App/
└── whitelabel-copytrade/
    ├── apps/api/
    │   ├── prisma/migrations/<STAMP>_add_hyperliquid_gate_mexc_venues/
    │   │   └── migration.sql                     # NEW — additive venue enum values
    │   └── src/modules/exchanges/
    │       ├── providers/
    │       │   ├── gate.provider.ts              # NEW — read-side provider; places no orders
    │       │   ├── hyperliquid.provider.ts       # NEW — read-side provider; places no orders
    │       │   └── mexc.provider.ts              # NEW — read-side provider; places no orders
    │       └── exchange.types.ts                 # EDIT — add venues + capability matrix entries
    ├── libs/trading-core/
    │   ├── tests/
    │   │   ├── venue_contract/
    │   │   │   ├── test_gate_contract.py         # NEW — binds the shared GAP-120 contract suite to the gate adapter
    │   │   │   ├── test_hyperliquid_contract.py  # NEW — binds the shared GAP-120 contract suite to the hyperliquid adapter
    │   │   │   └── test_mexc_contract.py         # NEW — binds the shared GAP-120 contract suite to the mexc adapter
    │   │   ├── test_gate_signing.py              # NEW — pytest: Gate signing vectors
    │   │   ├── test_gate_trading.py              # NEW — pytest: Gate place/cancel idempotency, precision, fail-closed on unknown error
    │   │   ├── test_hyperliquid_signing.py       # NEW — pytest: Hyperliquid signing vectors
    │   │   ├── test_hyperliquid_trading.py       # NEW — pytest: Hyperliquid place/cancel idempotency, precision, fail-closed on unknown error
    │   │   ├── test_mexc_signing.py              # NEW — pytest: MEXC signing vectors
    │   │   └── test_mexc_trading.py              # NEW — pytest: MEXC place/cancel idempotency, precision, fail-closed on unknown error
    │   └── wlct_trading/exchanges/
    │       ├── gate/
    │       │   ├── __init__.py                   # NEW — Gate package exports + registry hook
    │       │   ├── adapter.py                    # NEW — GateAdapter implements the shared venue adapter interface
    │       │   ├── attestation.py                # NEW — Gate attestation against recorded vectors before live enablement
    │       │   ├── capabilities.py               # NEW — static Gate capability matrix; unsupported = rejected, never guessed
    │       │   ├── parsers.py                    # NEW — Gate wire -> normalized order/fill/position/balance parsers; exact decimals; error-code classification
    │       │   ├── signing.py                    # NEW — APIv4: HMAC-SHA512 over method + path + query + SHA512(body) + timestamp (KEY / Timestamp / SIGN headers)
    │       │   ├── trading.py                    # NEW — spot + USDT futures; custom order text id for idempotency; label classification
    │       │   └── userstream.py                 # NEW — WS v4 auth with a signed channel payload; ping; reconnect
    │       ├── hyperliquid/
    │       │   ├── __init__.py                   # NEW — Hyperliquid package exports + registry hook
    │       │   ├── adapter.py                    # NEW — HyperliquidAdapter implements the shared venue adapter interface
    │       │   ├── attestation.py                # NEW — Hyperliquid attestation against recorded vectors before live enablement
    │       │   ├── capabilities.py               # NEW — static Hyperliquid capability matrix; unsupported = rejected, never guessed
    │       │   ├── parsers.py                    # NEW — Hyperliquid wire -> normalized order/fill/position/balance parsers; exact decimals; error-code classification
    │       │   ├── signing.py                    # NEW — EIP-712 typed-data signature by an API (agent) wallet; nonce = ms timestamp; the main wallet private key is never accepted
    │       │   ├── trading.py                    # NEW — perps only; cloid idempotency; reduce-only; TP/SL as trigger orders; exchange error classification
    │       │   └── userstream.py                 # NEW — WS user events (order updates, user fills) with reconnect + snapshot reconciliation
    │       ├── mexc/
    │       │   ├── __init__.py                   # NEW — MEXC package exports + registry hook
    │       │   ├── adapter.py                    # NEW — MEXCAdapter implements the shared venue adapter interface
    │       │   ├── attestation.py                # NEW — MEXC attestation against recorded vectors before live enablement
    │       │   ├── capabilities.py               # NEW — static MEXC capability matrix; unsupported = rejected, never guessed
    │       │   ├── parsers.py                    # NEW — MEXC wire -> normalized order/fill/position/balance parsers; exact decimals; error-code classification
    │       │   ├── signing.py                    # NEW — spot v3: HMAC-SHA256 query-string signature with the X-MEXC-APIKEY header; futures use a separate scheme
    │       │   ├── trading.py                    # NEW — spot + contract; newClientOrderId idempotency; code classification
    │       │   └── userstream.py                 # NEW — listenKey user-data stream with keepalive; reconnect
    │       └── registry.py                       # EDIT — register hyperliquid, gate, mexc + capability matrices
    └── services/execution-engine/app/
        └── composition.py                        # EDIT — wire the three adapters (credentials only via the vault/KMS fetcher)
```

Done when: Each venue passes the shared contract suite (GAP-120) and has testnet/evidence where the venue offers one; do this only after GAP-113–120 are green.

#### GAP-199 - Web push / PWA  ·  P3

Now: no service worker, manifest or web-push code in `apps/web`

Verify (from `whitelabel-copytrade/`): `grep -rIliE 'serviceWorker|web-push|manifest.webmanifest' apps/web/src apps/web/public`

```text
White-Label01-Crypto-Copy-Trading-App/
└── whitelabel-copytrade/apps/
    ├── api/src/modules/notifications/
    │   ├── web-push.controller.ts         # NEW — register/unregister endpoints (tenant + user scoped)
    │   ├── web-push.service.ts            # NEW — VAPID send, prune gone subscriptions, reuse DeviceToken with platform=WEB
    │   └── web-push.spec.ts               # NEW — registration, pruning, isolation
    └── web/
        ├── public/
        │   └── sw.js                      # NEW — push handler + static-asset cache only; never caches authenticated responses
        └── src/
            ├── app/
            │   └── manifest.ts            # NEW — Next MetadataRoute.Manifest per tenant (name, icons, theme from branding)
            ├── features/notifications/
            │   └── web-push-settings.tsx  # NEW — opt-in toggle
            └── lib/push/
                └── web-push-client.ts     # NEW — subscribe/unsubscribe with permission flow
```

Done when: Installable per-tenant manifest; push via VAPID with user opt-in; the service worker never caches authenticated API responses.

#### GAP-200 - Final regression + honest report for GAP-151–200  ·  P0

Now: scanners are static; reports drift (F1–F3 of the previous batch)

Verify (from `whitelabel-copytrade/`): `node ops/report-vs-tree-drift-check.js`

```text
White-Label01-Crypto-Copy-Trading-App/
├── whitelabel-copytrade/
│   ├── docs/
│   │   └── GAP_151_200_FINAL_REPORT.md         # NEW — per GAP: status word, files, commands + exit codes + counts, BLOCKED reasons; scorecard before/after
│   ├── ops/
│   │   ├── gap-parity-scanner-151-200.js       # NEW — declarative rubric with BEHAVIOUR + WIRING signals (named tests that must pass, module registration, route mounted), never file presence
│   │   └── gap-parity-scanner-151-200.test.js  # NEW — regression: rejects file-presence-only evidence, shims, orphans, placeholder markers
│   ├── NEXT.md                                 # EDIT — inner copy; keep byte-identical to the outer one
│   └── RELEASE_MANIFEST.json                   # EDIT — regenerate after every gate is green
├── NEXT.md                                     # EDIT — append a GAP-151-200 section (outer copy); never delete history
└── RELEASE_PACKAGE_CHECK.md                    # EDIT — refresh counts
```

Done when: Scanner 151-200 passes on behaviour + wiring signals; drift check green; NEXT.md appended; manifest regenerated; scorecard re-scored with the same rubric (no rounding up).

---

## 4. Acceptance gates (delta on top of section 8 of `REPAIR_GAP_101_150_REAL.md`)

Run the previous batch gates again, then:

| # | Gate | Command | Must be |
|---|---|---|---|
| 1 | OpenAPI drift [GAP-178] | `node scripts/check-openapi-drift.mjs` | exit 0 |
| 2 | Webhook docs [GAP-176] | `node scripts/gen-webhook-docs.mjs --check` | exit 0 |
| 3 | SDKs [GAP-179] | `npm run build && npm test` in `packages/sdk-typescript`; `python -m pytest` in `packages/sdk-python` | exit 0 |
| 4 | i18n [GAP-183] | `node scripts/check-i18n-completeness.mjs` | exit 0 |
| 5 | Placeholder guard [GAP-194] | `node ops/placeholder-guard.js` | exit 0 |
| 6 | Property tests [GAP-193] | API property specs + `python -m pytest -k properties` in `libs/trading-core` + `cargo test` in the gateway | pass, fixed seeds |
| 7 | Outbox [GAP-177] | outbox spec incl. crash-between-commit-and-publish | pass |
| 8 | Web perf [GAP-195] | `npx lhci autorun` | budgets met |
| 9 | Custom-domain TLS [GAP-188] | `node scripts/verify-domain-tls.mjs` against the staging-proof stack | exit 0 |
| 10 | Scanner [GAP-200] | `node ops/gap-parity-scanner-151-200.js` and `node ops/report-vs-tree-drift-check.js` | exit 0 |

## 5. Final report format

Same as section 9 of `REPAIR_GAP_101_150_REAL.md`, written to `docs/GAP_151_200_FINAL_REPORT.md`: one row per GAP with status word, files, commands + exit codes + counts, BLOCKED reason, evidence file; a "Not run" section; scorecard before/after with the SAME rubric; open owner decisions (vendor credentials, legal review, domain/DNS). Never mark `VERIFIED_RUNTIME` on file existence alone.

---

## 6. Sources (read 2026-10-08; vendor and listing claims, not independently validated)

- B2COPY (B2Broker): fee list https://b2broker.com/products/b2copy/knowledge-base/concepts/fee-list/ · copy trading features https://b2broker.com/products/b2copy/copy-trading/ · product site https://b2copy.b2broker.com/ · white label https://b2broker.com/products/b2copy/white-label/
- Finestel listing (strategy execution types, pricing options): https://alternativeto.net/browse/all/?tag=kucoin · https://alternativeto.net/software/finestel/about
- Bybit, Copy Mode and Parameter Settings (English and Spanish versions): https://www.bybit.com/en/help-center/article/Copy-Trading-Copy-Mode-and-Parameters-Settings · https://www.bybit.com/es-ES/help-center/article/Copy-Trading-Copy-Mode-and-Parameters-Settings
- Bitget futures copy trading: https://www.bitget.com/support/articles/12560603826748
- Jivestor social trading listing: https://jivestor.atas.net/
- Zignaly directory listing: https://www.quicknode.com/builders-guide/tools/zignaly-by-zignaly
- copy.cc packages: https://copy.cc/

End of file.
