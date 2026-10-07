# API Build and Typecheck Retry Report

# Responsibility: records the API validation retry evidence, source/configuration repairs, security and tenant-scope impact, exact validation outcomes, blockers, and Git state.

**Initial retry date:** 2026-10-05; **validation follow-up:** 2026-10-06 (Asia/Dhaka local dates)
**Repository:** `/home/user/White-Label01-Crypto-Copy-Trading-App/whitelabel-copytrade`
**Current overall status:** **PARTIAL / BLOCKED / FAIL — API Jest passes; full typecheck/build are blocked by V8 heap OOM; API lint exits 1 on 6,436 warnings**
**Scope:** the original 2026-10-05 API validation retry plus 2026-10-06 follow-up fixes for fail-soft classification, live tenant idempotency count, additive RLS coverage, and the validation/report refresh. The API production validation gates remain unresolved.

## 1. Executive outcome — initial 2026-10-05 retry (historical; latest status is in §9)

- Corrected the customer activity audit controller to use the canonical authenticated actor field, `actor.userId`, instead of the nonexistent `actor.id`. Added a deterministic regression asserting that caller-supplied `actorId` and `tenantId` filters cannot override the authenticated actor and request tenant.
- Corrected an objectively incomplete production TypeScript exclusion: the old `**/*.spec.ts` pattern missed hyphenated `*-spec.ts` fixture files. The API production TypeScript project now has `types: ["node"]` and excludes `**/*spec.ts`. The API spec project continues to supply Node and Jest types. **No API runtime source was excluded and strict checking was not weakened.**
- Verified the final production project file inventory: **2,218 total files; 914 API runtime TypeScript source files; 0 spec/fixture files; 117 `@types` files**. An earlier 919-file source count included the five hyphenated fixture-spec files before the corrected exclusion; that earlier source/fixture split was inaccurate. The inventory check is not itself a successful typecheck.
- Passed a focused, strict TypeScript check of the changed audit controller and regression spec and passed the focused regression test (**1 suite / 1 test**).
- Passed the complete API Jest runtime suite (**126 suites / 2,023 tests**) using `ts-jest` with diagnostics disabled. This is not a TypeScript check.
- **Did not complete** the full API typecheck or the Nest production build. The latest typecheck retry was stopped after about 13 minutes at approximately 1.26 GiB RSS with system memory nearly exhausted and no diagnostics; an earlier retry also exceeded 11 minutes at approximately 1.41 GiB RSS. The Nest build was stopped after 14:35 at approximately 1.42 GiB RSS without useful completion output; partial `apps/api/dist` output was removed.
- Investigated and fixed an objectively unnecessary ESLint parser project configuration: the active ESLint rules have **zero** type-information requirements, but `parserOptions.project` forced loading the full API TypeScript program and caused OOM. Removed that parser option without changing any lint rule or lint file scope. The full lint now completes without OOM, but **fails** the unchanged zero-warning gate with **6,520 problems (58 errors, 6,462 warnings)**. The focused audit controller and spec lint cleanly.
- Fresh contract, authorization, schema-consistency, GAP-51–100 scanner/regression, and whitespace checks passed. The release-manifest generator was intentionally deferred because required API gates are still incomplete. No commit was created.

A focused pass and a passing Jest runtime suite do not turn the three incomplete API validation gates into passes. No claim of API production readiness is made.

## 2. Initial failures and investigation

### 2.1 First real source diagnostic

The known compiler error in `apps/api/src/modules/audit/audit.controller.ts` was:

```text
TS2339: Property 'id' does not exist on type 'AuthenticatedActor'.
```

`AuthenticatedActor` is defined in `packages/shared-types/src/auth.ts`; its canonical identity property is `userId`. The same canonical property is used by API auth/session controllers, guards, and audit helpers. `AuditController.listMyActivity` now sets `actorId: actor.userId`. Its tenant parameter remains sourced from `@TenantId()`, and the method still uses its existing authenticated-access decorator and DTO validation.

### 2.2 Dependency/setup failures encountered before the final attempts

The workspace initially lacked installed dependencies and generated package artifacts. An early `npx tsc` invocation before the workspace toolchain was available invoked the unrelated `tsc@2.0.4` npm shim rather than the repository TypeScript compiler; that invocation is not counted as a typecheck. After installing dependencies, early compile attempts also reported unresolved workspace package declarations and an incomplete Prisma Client declaration, with a reported **762 diagnostics**. Those setup-state diagnostics were not treated as proof of 762 API source defects.

The workspace was prepared with `npm ci --prefer-offline`, `npm run build:packages`, and Prisma Client generation from `apps/api/prisma/schema.prisma` (Prisma Client v5.22.0). Generated client declaration output was **29,709,279 bytes**. `package.json` and lockfiles were not modified by dependency installation. The later typecheck/build attempts described below ran after workspace package builds and Prisma Client generation.

### 2.3 TypeScript scope review and remaining resource block

Inspected `apps/api/tsconfig.json`, `apps/api/tsconfig.build.json`, `apps/api/tsconfig.spec.json`, `apps/api/nest-cli.json`, the root TypeScript base configuration, the workspace package scripts, and the API ESLint configuration. The production config includes `src/**/*.ts`; Nest uses `tsconfig.build.json`; there are no recursive project references or monorepo-wide include patterns. The previous `**/*.spec.ts` exclusion missed five hyphenated spec/fixture files in the production program. That objectively incorrect exclusion was corrected to `**/*spec.ts`, and production ambient types were scoped to Node. The inherited strict settings remain enabled. The spec config still explicitly uses `types: ["node", "jest"]`.

The final `npx tsc -p tsconfig.json --listFilesOnly` inventory shows **2,218 total files, 914 API runtime TypeScript source files, zero spec/fixture files, and 117 `@types` files**. The test-project list separately contains all five hyphenated fixtures. An earlier inventory entry counted 919 API source files; that count included these five `*-spec.ts` fixtures before the production exclusion was corrected, so its source/fixture split was inaccurate. No runtime module (including auth, audit, tenant, billing, copy-trading, execution, OMS, risk, funding, custody, compliance, partner, exchange, notification, or security source) is excluded.

The full production typecheck has not returned diagnostics or a completion result. A 1,200 MiB heap attempt reached V8's heap limit. The preceding 1,400 MiB attempt ran for more than 11 minutes at approximately 1.41 GiB RSS without diagnostics before it was stopped. A fresh 2026-10-05 retry of `NODE_OPTIONS='--max-old-space-size=1400' npx tsc -p tsconfig.json --noEmit --pretty false` then ran for approximately 13 minutes, remained silent, showed approximately 1.26 GiB RSS with only about 31 MiB system memory available, and was stopped. This remains a **resource-blocked/incomplete check**, not a source-level pass and not proof that no further compiler errors exist. The 29.7 MB generated Prisma declaration and the 914-file production source graph are observed scope facts; the specific dominant memory consumer was not conclusively profiled.

### 2.4 Nest production build

`apps/api/nest-cli.json` points to `tsconfig.build.json`, has `sourceRoot: "src"`, and enables `deleteOutDir`. The production build includes the API runtime source and its Swagger plugin; no build-config change was made to suppress compiler diagnostics or omit source.

A prior 900 MiB build attempt in the existing validation record ended in a V8 heap OOM at approximately 899 MiB. In this retry, the production Nest build was run with a 1,600 MiB V8 heap. It remained active for **14:35**, reached approximately **1.42 GiB RSS**, emitted no useful completion output, and had produced partial output under `apps/api/dist`. It was manually stopped; the partial `dist` directory was removed and verified absent. No final Nest build exit code or build success was obtained. The current build result is **BLOCKED / INCOMPLETE**, not a compiler pass.

### 2.5 ESLint investigation and remaining block

The API lint command remains scoped to `"{src,test}/**/*.ts"`; the test tree currently has no TypeScript files, and all `src/**/*.ts` files are in the lint set. The initial `.eslintrc.cjs` configured `parserOptions.project` for both full API TypeScript projects. Inspection of the active `plugin:@typescript-eslint/recommended` rules and `eslint --print-config` found **zero enabled rules with `requiresTypeChecking`**. The project option was therefore unnecessary for the configured rules and forced the parser to build a very large TypeScript Program without adding type-aware lint coverage. Removed only `parserOptions.project`/`tsconfigRootDir`; all lint rules, the `{src,test}` file scope, and `--max-warnings=0` remain unchanged. Separate TypeScript compiler diagnostics remain enabled in the real `tsc` commands.

Before that correction, both the full command `NODE_OPTIONS='--max-old-space-size=1200' npm run lint -- --no-cache` and the focused command `NODE_OPTIONS='--max-old-space-size=1200' npx eslint --no-cache src/modules/audit/audit.controller.ts src/modules/audit/audit.controller.spec.ts` hit `FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory`; the focused attempt exited 134. A production-project-only isolation attempt also timed out after 30 minutes at approximately 1.27 GiB RSS. These were diagnostic attempts, not final lint passes. After removing the unnecessary parser project, the unchanged full lint glob completed and surfaced the actual error/warning counts below.

With the corrected ESLint configuration, `NODE_OPTIONS='--max-old-space-size=1200' npm run lint -- --no-cache` completed in about 21.3 seconds without OOM, but **failed** the zero-warning gate with **6,520 problems: 58 errors and 6,462 warnings**. The error rules were 36 `@typescript-eslint/no-var-requires`, 20 `prefer-const`, 1 `@typescript-eslint/ban-ts-comment`, and 1 `@typescript-eslint/no-this-alias`. The warnings were 5,942 `@typescript-eslint/no-explicit-any` and 520 `@typescript-eslint/no-unused-vars`. The lint command did not fix or suppress these findings; they remain blockers. The two changed audit files pass focused lint with the corrected configuration.

`apps/api/tsconfig.spec.json` was aligned with the production exclusion by including dot-specs, the five hyphenated fixture-spec files, and `test/**/*.ts` in its separate no-emit Jest/Node type project. It does not reintroduce tests or fixtures into Nest's production build.

## 3. Files changed in this retry and impact

All paths below are relative to `/home/user/White-Label01-Crypto-Copy-Trading-App/whitelabel-copytrade`.

| File | Reason and implementation impact | Security / tenant impact |
|---|---|---|
| `apps/api/src/modules/audit/audit.controller.ts` | Replaced the invalid audit actor reference `actor.id` with the declared and repository-canonical `actor.userId` in `listMyActivity`. | Keeps the activity query bound to the authenticated user. The `@AllowAnyAuthenticated()` decorator, `@TenantId()` tenant argument, response type, and audit service call remain. Caller filters are spread first; authenticated tenant and actor values are then assigned last. |
| `apps/api/src/modules/audit/audit.controller.spec.ts` | Added a focused regression with a caller-provided actor and tenant, then verifies the audit service receives the authenticated actor ID and request tenant. | Protects against caller-controlled cross-user/cross-tenant widening on the customer activity route. The spec does not alter runtime authorization. |
| `apps/api/tsconfig.json` | Added `types: ["node"]`; changed the production exclude from `**/*.spec.ts` to `**/*spec.ts`; added a nearby responsibility comment. | Build configuration only. Does not exclude runtime source or weaken inherited `strict` settings. |
| `apps/api/tsconfig.spec.json` | Kept dot-specs, the five hyphenated fixture-spec files, and any `test/**/*.ts` in a dedicated no-emit test project with Node/Jest ambient types. | Test configuration only; test fixtures remain in the test project rather than production build output. |
| `apps/api/.eslintrc.cjs` | Removed the unnecessary `parserOptions.project` and `tsconfigRootDir` settings after confirming zero enabled rules require type information. | All ESLint rules and source/test file globs remain unchanged. The separate TypeScript compiler still performs type diagnostics; no production source was excluded. |
| `NEXT.md` | Added a dated API retry status addendum and links to the full retry evidence. | Documentation only; explicitly records API gates as partial/blocked and defers the manifest. |
| `docs/NEXT_51_100_FINAL_REPORT.md` | Added a post-assessment API retry update without changing GAP evidence scores/statuses. | Documentation only; differentiates runtime Jest evidence from typecheck/build evidence. |
| `docs/COMMERCIAL_READINESS_GAP_51_100.md` | Replaced the stale API blocker summary with the latest retry results and report link. | Documentation only; no production/commercial readiness claim added. |
| `docs/API_BUILD_TYPECHECK_RETRY_REPORT.md` | Added this complete retry record. | Documentation only; includes exact evidence boundaries and Git state. |

`npm ci --prefer-offline`, workspace package builds, and Prisma generation wrote generated/dependency artifacts only. `node_modules` and the API's partial `dist` output are not deliverable source changes; partial `apps/api/dist` was removed. Lockfiles were not changed. No exchange/provider, trading, billing, risk, authorization, or unrelated GAP runtime behavior was changed in this retry.

## 4. Exact validation results

All commands below were run on 2026-10-05 unless explicitly described as a preceding/setup-state result. Unless stated otherwise, commands run from the repository root; API package commands run from `apps/api`.

| Gate / command | Result | Boundary |
|---|---|---|
| `NODE_OPTIONS='--max-old-space-size=1000' npx tsc -p /tmp/api-audit-target-tsconfig.json --pretty false` | **PASS; exit 0, zero diagnostics, about 8.6 seconds** | Focused TypeScript check for the changed audit controller/spec using a temporary targeted config. It is not the full API project typecheck; the temporary config is outside the repository. |
| `NODE_OPTIONS='--max-old-space-size=800' npm test -- --runInBand --runTestsByPath src/modules/audit/audit.controller.spec.ts --forceExit --globals='{"ts-jest":{"diagnostics":false,"isolatedModules":true}}'` | **PASS; 1 suite / 1 test, about 2.1 seconds test time on the final rerun** | Focused runtime regression. `ts-jest` diagnostics are disabled; this is not a TypeScript check. |
| `NODE_OPTIONS='--max-old-space-size=1200' npm test -- --runInBand --forceExit --globals='{"ts-jest":{"diagnostics":false,"isolatedModules":true}}'` | **PASS; 126/126 suites and 2,023/2,023 tests, about 65 seconds on the final rerun** | Full API Jest runtime suite. The command disables `ts-jest` diagnostics; it is not the required full API TypeScript check. Jest emitted deprecation warnings for the existing `globals`/`isolatedModules` configuration. |
| `npx tsc -p tsconfig.json --listFilesOnly` | **PASS as a scope inventory only: 2,218 total files, 914 API runtime TypeScript source files, 0 spec/fixture files, 117 `@types` files** | Confirms intended production-source inclusion, not type correctness. |
| `NODE_OPTIONS='--max-old-space-size=900' npx tsc -p tsconfig.spec.json --listFilesOnly` | **PASS as a test-project scope inventory: 1,929 total files; 735 API source TS files; 131 dot/hyphen specs and fixtures; all 5 hyphen fixtures included** | Confirms tests/fixtures are in the test project, not production. There are currently 0 TypeScript files under `apps/api/test/`. |
| `NODE_OPTIONS='--max-old-space-size=1400' npx tsc -p tsconfig.json --noEmit --pretty false` | **BLOCKED / INCOMPLETE; final retry ran about 13 minutes at approximately 1.26 GiB RSS, system memory fell to ~31 MiB available, and it was stopped without diagnostics** | Final post-fix full API typecheck. No completion status was obtained. |
| `npm run typecheck --workspace=@wlct/api -- --pretty false` | **Earlier recorded attempt timed out at 600 seconds without diagnostics** | Historical timeout from the GAP validation record. The later 1,200 MiB full-project attempt OOMed; a prior run stopped after >11 minutes at ~1.41 GiB RSS, and the latest run stopped after ~13 minutes at ~1.26 GiB RSS with system memory nearly exhausted. None is a pass. |
| `NODE_OPTIONS='--max-old-space-size=1200' npx tsc -p tsconfig.json --noEmit --pretty false` | **BLOCKED by V8 heap OOM** | Earlier full-project attempt after dependency preparation. Terminal error: `FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory`. |
| `NODE_OPTIONS='--max-old-space-size=1600' npm run build` | **BLOCKED / INCOMPLETE; Nest build stopped after 14:35 at approximately 1.42 GiB RSS** | Actual `nest build` against production `tsconfig.build.json` did not report completion. Partial `apps/api/dist` was removed. |
| `NODE_OPTIONS='--max-old-space-size=1200' npm run lint -- --no-cache` | **FAIL; exit 1 after about 21.3 seconds; 6,520 problems (58 errors, 6,462 warnings); no OOM** | Full configured `src,test` TypeScript glob completed under the corrected parser config. The exact rule breakdown is in §2.5; all findings remain unsuppressed. |
| `NODE_OPTIONS='--max-old-space-size=1100' npx eslint --no-cache src/modules/audit/audit.controller.ts` | **PASS; exit 0, no messages** | Focused production controller lint with the final config. |
| `NODE_OPTIONS='--max-old-space-size=1100' npx eslint --no-cache src/modules/audit/audit.controller.spec.ts` | **PASS; exit 0, no messages** | Focused typed syntax lint for the regression spec with the final config. |
| `node scripts/check-web-api-contract.js` | **PASS: 272 client calls match 857 API routes; query keys checked on 66; 18 dynamic paths not checked** | Static web/API contract check; the unchecked dynamic paths remain an explicit boundary. |
| `node apps/api/scripts/check-route-authorization.js` | **PASS: 857 routes in 49 controllers; 91 undecorated, all in reviewed controllers** | Route authorization inventory. Does not establish live deployment authorization. |
| `node scripts/verify-schema-consistency.test.js` | **PASS: 251 Prisma models verified** | Local schema/migration consistency check only; no database migration was applied. |
| `node ops/gap-parity-scanner-51-100.test.js` | **PASS: 50 gaps scanned; 98/199 static evidence criteria present; weighted score 49.29%** | Scanner regression; static evidence only. |
| `node ops/gap-parity-scanner-51-100.js` | **PASS as a static scan: 98/199 criteria; 5 fully evidenced; 45 partial; 0 with no evidence; weighted score 49.29%; production-critical score 53.28%; cumulative proxies 74.63% product / 76.64% production / 74.64% commercial** | Does not execute tests, validate providers, or certify parity/readiness. GAP statuses were not changed by API build/typecheck results. |
| `git diff --check` | **PASS after the source and documentation updates** | Whitespace/conflict-marker check for tracked changes. Newly created report text was also checked for trailing whitespace and placeholder lines. |
| `npx ts-node --compiler-options '{"module":"CommonJS"}' scripts/generate-release-manifest.ts` | **NOT RUN — intentionally deferred** | The retry prompt permits manifest generation only after source fixes and all validation are final. Full API typecheck, Nest build, and lint remain incomplete. No hashes were manually edited. The existing tracked `RELEASE_MANIFEST.json` was not changed. |

### Dependency preparation outcomes

- `npm ci --prefer-offline`: completed and installed 1,265 packages; npm reported 84 audit findings (**3 low, 27 moderate, 53 high, 1 critical**). No dependency remediation was attempted in this API retry, and lockfiles are unchanged.
- `npm run build:packages`: passed for `@wlct/shared-types`, `@wlct/config`, `@wlct/utils`, and `@wlct/validation`.
- Prisma Client generation completed for Prisma Client v5.22.0. No database connection, migration deployment, or provider operation was performed.

## 5. Root-cause classification and honesty boundaries

| Issue | Classification | Finding |
|---|---|---|
| `actor.id` TypeScript error | **Source type error — fixed** | The actual authenticated actor contract uses `userId`; updated the controller and added a tenant/actor override regression. |
| Five hyphenated test/fixture files in production program | **Incorrect TypeScript exclusion — fixed** | `**/*.spec.ts` did not exclude every `*-spec.ts` file. Updated to `**/*spec.ts`; production scope inventory now has zero specs/fixtures. |
| Workspace TypeScript and Prisma declarations missing/incomplete in early attempts | **Environment/setup issue — addressed for later attempts** | Installed workspace dependencies, built internal packages, and generated Prisma Client before the final blocked checks. Early 762-error output is not treated as a current production source diagnostic list. |
| Full production TypeScript check | **Memory/resource limitation — unresolved** | V8 OOM at a 1,200 MiB heap, a prior run stopped after >11 minutes at ~1.41 GiB RSS, and the latest was stopped after ~13 minutes at ~1.26 GiB RSS with system memory nearly exhausted; no diagnostics were produced. No source-level completion result. |
| Nest production build | **Memory/resource/performance limitation — unresolved** | Actual Nest build reached ~1.42 GiB RSS and did not complete in 14:35. No useful compiler diagnostics were available; not classified as a confirmed source failure or success. |
| API ESLint | **Unnecessary parser project configuration — fixed; lint still FAILS on existing findings** | None of the active ESLint rules requires TypeScript type information, but `parserOptions.project` built large API programs and caused OOM. Removing only this unnecessary parser option allowed the unchanged full lint scope/rules to complete. Final result: 58 errors and 6,462 warnings; no rule or file was suppressed. |
| Release manifest | **Intentionally deferred** | Required by the retry prompt to run only after all source fixes and validation are final; the API gates are not final. |

The full TypeScript and build outcomes are inconclusive rather than green. A resource limit is not recorded as a source repair. No claim is made that the production API currently compiles or that the remaining sources are free of type/lint errors.

## 6. Shortcut, regression, authorization, and safety review

- Scanned the API retry changes for `@ts-ignore`, `@ts-expect-error`, `as any`, `TODO`, `FIXME`, literal placeholder ellipses, `Rest of the code here`, and `same as above`; none were introduced. The controller's object spread (`...query`) is normal runtime code, not an omitted-source placeholder.
- No strictness flag was disabled, no production API source was excluded to improve memory, no lint rule was disabled, no fake implementation or fake validation result was added, and no existing test assertion was weakened.
- `listMyActivity` retains its authenticated-route decorator, request DTO, tenant decorator, service call, and response contract. The regression verifies last-write-wins scoping for authenticated `actor.userId` and tenant ID against attacker-supplied query values.
- The route authorization check passed for all 857 current API routes. No route or permission metadata was changed by this retry.
- No live trading was enabled, no order was submitted, no credentials/provider success was fabricated, and no financial value, audit record, or API response shape was fabricated.

## 7. Remaining blockers and next action

1. Run the full production-source API typecheck to completion in an environment with sufficient memory/time; resolve every diagnostic without suppressions or production-source exclusions.
2. Complete the actual Nest production build against the full runtime source; verify clean output and emitted artifacts.
3. Complete full API lint, remediate all actual errors and disallowed warnings, and obtain a final zero-warning result without lint-rule suppression or source exclusions.
4. Rerun the relevant focused tests and full API Jest suite after any further source changes. Keep Jest runtime testing distinct from TypeScript diagnostics.
5. Only after the above gates are final, run and verify the repository release-manifest generator. Until then, keep the existing manifest unchanged.

The static cross-system checks currently pass, but they do not remove these API blockers. API validation remains **PARTIAL / BLOCKED / FAIL**: typecheck and build are incomplete, and full lint fails on the findings listed above.

## 8. Git state

- **HEAD at final review:** `da0090bf8536652f37d830beda8598013b84f2ec`.
- **Commit created for this retry:** no.
- **Working tree:** dirty. It contains pre-existing/uncommitted GAP-51–100 work in addition to the focused API retry and documentation updates. This report does not attribute every dirty path to the API retry.
- The complete final `git status --short` output is reproduced in the Git-state appendix below.

### Appendix: exact `git status --short` output

```text
 M NEXT.md
 M apps/api/.eslintrc.cjs
 M apps/api/prisma/schema.prisma
 M apps/api/src/infrastructure/redis/cache.service.ts
 M apps/api/src/modules/audit/audit.controller.ts
 M apps/api/src/modules/copy-trading/copy-execution.service.ts
 M apps/api/src/modules/copy-trading/copy-policy.service.spec.ts
 M apps/api/src/modules/copy-trading/copy-policy.service.ts
 M apps/api/src/modules/copy-trading/copy-trading-authorization.spec.ts
 M apps/api/src/modules/copy-trading/copy-trading.module.ts
 M apps/api/src/modules/copy-trading/follower-risk.service.spec.ts
 M apps/api/src/modules/copy-trading/follower-risk.service.ts
 M apps/api/src/modules/exchanges/exchange-rate-limit.service.ts
 M apps/api/src/modules/exchanges/exchange-routing.service.ts
 M apps/api/src/modules/exchanges/exchanges.controller.ts
 M apps/api/src/modules/governance/consent.service.ts
 M apps/api/src/modules/partners/partner-attribution.service.ts
 M apps/api/tsconfig.json
 M apps/api/tsconfig.spec.json
 M apps/web/src/api/realtime-api.ts
 M apps/web/src/api/trading-api.ts
 M apps/web/src/app/traders/[id]/performance/page.tsx
 M apps/web/src/app/traders/compare/page.tsx
 M apps/web/src/config/feature-config.ts
 M apps/web/src/features/exchanges/exchange-capabilities.tsx
 M apps/web/src/features/support/support-page.tsx
 M apps/web/src/features/trading/copied-orders-page.tsx
 M apps/web/src/features/trading/copied-positions-page.tsx
 M apps/web/src/features/trading/copy-execution-detail.tsx
 M apps/web/src/features/trading/copy-reconciliation-status.tsx
 M apps/web/src/features/trading/copy-risk-guardrails.tsx
 M apps/web/src/features/trading/copy-settings-page.tsx
 M apps/web/src/features/trading/copy-subscription-detail-page.tsx
 M apps/web/src/features/trading/leaderboard-page.tsx
 M apps/web/src/features/trading/strategies-page.tsx
 M apps/web/src/features/trading/strategy-detail-page.tsx
 M apps/web/src/features/trading/trader-performance-page.tsx
 M apps/web/src/features/trading/traders-page.tsx
 M apps/web/src/tests/copied-orders-page.test.tsx
 M apps/web/src/tests/copied-positions-page.test.tsx
 M apps/web/src/tests/copy-execution-detail.test.tsx
 M apps/web/src/tests/copy-reconciliation-status.test.tsx
 M apps/web/src/tests/copy-risk-guardrails.test.tsx
 M apps/web/src/tests/copy-settings-page.test.tsx
 M apps/web/src/tests/copy-subscription-detail-page.test.tsx
 M apps/web/src/tests/strategy-detail-page.test.tsx
 M apps/web/src/tests/trader-performance-page.test.tsx
 M apps/web/src/tests/trading-api.test.ts
 M apps/web/src/tests/use-copy-execution-events.test.ts
 M ops/governance-validation-50-checks.js
?? apps/api/prisma/migrations/20261004000000_partner_attribution_tenant_idempotency/
?? apps/api/src/common/decimal-string.spec.ts
?? apps/api/src/common/decimal-string.ts
?? apps/api/src/modules/audit/audit.controller.spec.ts
?? apps/api/src/modules/auth/services/session.service.spec.ts
?? apps/api/src/modules/copy-trading/allocation-rebalance.controller.ts
?? apps/api/src/modules/copy-trading/allocation-rebalance.service.ts
?? apps/api/src/modules/copy-trading/allocation-rebalance.spec.ts
?? apps/api/src/modules/copy-trading/dto/allocation-rebalance.dto.ts
?? apps/api/src/modules/copy-trading/performance-benchmark.controller.ts
?? apps/api/src/modules/copy-trading/performance-benchmark.service.ts
?? apps/api/src/modules/copy-trading/performance-benchmark.spec.ts
?? apps/api/src/modules/copy-trading/performance-calculation.service.ts
?? apps/api/src/modules/copy-trading/performance-calculation.spec.ts
?? apps/api/src/modules/exchanges/exchange-rate-limit.service.spec.ts
?? apps/api/src/modules/governance/consent.service.spec.ts
?? apps/api/src/modules/partners/partner-attribution.service.spec.ts
?? apps/api/src/modules/risk/leverage-policy.service.ts
?? apps/api/src/modules/risk/leverage-policy.spec.ts
?? apps/api/src/modules/risk/trader-risk-score.service.ts
?? apps/api/src/modules/risk/trader-risk-score.spec.ts
?? apps/web/src/features/trading/allocation-rebalance-page.tsx
?? apps/web/src/features/trading/leverage-policy-panel.tsx
?? apps/web/src/features/trading/performance-benchmark-chart.tsx
?? apps/web/src/features/trading/performance-methodology.tsx
?? apps/web/src/features/trading/trader-risk-score.tsx
?? apps/web/src/tests/allocation-rebalance-page.test.tsx
?? apps/web/src/tests/performance-benchmark-chart.test.tsx
?? apps/web/src/tests/trading-api-account-scope.test.ts
?? docs/API_BUILD_TYPECHECK_RETRY_REPORT.md
?? docs/COMMERCIAL_READINESS_GAP_51_100.md
?? docs/NEXT_51_100_FINAL_REPORT.md
?? docs/NEXT_51_100_INITIAL_AUDIT.md
?? ops/gap-parity-scanner-51-100.js
?? ops/gap-parity-scanner-51-100.test.js
```

## 9. Validation and safety follow-up — 2026-10-06

This section is the current result and supersedes older full-suite, lint, typecheck, build, schema, and scanner counts in §§1–8. The earlier evidence remains as a historical record of the 2026-10-05 retry.

### Follow-up fixes

- `apps/api/src/common/fail-soft-reads.spec.ts` now allowlists exactly one `compoundReturnSeries` catch in `performance-calculation.service.ts`. It handles invalid exact-decimal/compounding input by returning `null` (unavailable); it does not catch a storage read failure. The API's existing failure rules remain intact.
- `apps/api/src/common/idempotency-tenant-scope.spec.ts` now expects 70 current schema tenant/idempotency composite keys. The original migration and its 68-index assertions were left unchanged; `LeadTraderApplication` and `LeaderFeePolicy` receive their scoped unique keys in later table migrations.
- `scripts/gen_part11_rls.py` now supports `--incremental-from-stamp`, rejects migration-folder overwrite, requires the latest existing RLS stamp, refuses stale removed-table policies, and emits only policies for newly covered tables. It generated `apps/api/prisma/migrations/20261006120000_part11_row_level_security/migration.sql` with two additive policies for `lead_trader_applications` and `leader_fee_policies`. The RLS coverage spec now reads the ordered migration chain and still asserts exactly one policy for every current covered table, no policy for nullable exclusions, and no destructive or RLS-enabling SQL. Existing applied migrations were not rewritten.
- The customer-risk exposure implementation is in the authenticated `/risk-management/my-exposure` API and `/risk/exposure` customer page. The scanner rubric still requires separate trader-profile UI/test paths; no wrapper or scanner rule change was made to disguise that distinction.

### Exact 2026-10-06 validation

| Command | Result |
|---|---|
| `NODE_OPTIONS='--max-old-space-size=1200' npm test -- --runInBand --forceExit --globals='{"ts-jest":{"diagnostics":false,"isolatedModules":true}}'` from `apps/api` | **PASS; 134/134 suites and 2,091/2,091 tests**. Jest transpilation diagnostics were disabled; this is not a TypeScript check. |
| Focused `fail-soft-reads.spec.ts`, `idempotency-tenant-scope.spec.ts`, `rls-coverage.spec.ts` | **PASS; 3/3 suites and 58/58 tests**. |
| `NODE_OPTIONS='--max-old-space-size=1200' npx tsc -p tsconfig.json --noEmit --pretty false` from `apps/api` | **BLOCKED by V8 heap OOM after about 26 seconds; no TypeScript diagnostics were produced**. |
| `NODE_OPTIONS='--max-old-space-size=1200' npm run build` from `apps/api` | **BLOCKED by V8 heap OOM after about 22 seconds; no production build completion**. `apps/api/dist` is absent after the failed run. |
| `NODE_OPTIONS='--max-old-space-size=1200' npm run lint -- --no-cache` from `apps/api` | **FAIL; 0 errors and 6,436 warnings; exits 1 under the unchanged `--max-warnings=0` threshold**. No warning rule was suppressed. |
| `node ops/gap-parity-scanner-51-100.js` / `node ops/gap-parity-scanner-51-100.test.js` | **112/199 criteria; 11 fully evidenced; 39 partial; 0 with no evidence; weighted 55.63%; production-critical 54.57%; regression PASS**. The scanner checks static evidence only. |
| `node scripts/verify-schema-consistency.test.js` | **PASS; 253 Prisma models verified**. |
| `DATABASE_URL='postgresql://test:test@localhost:5432/test' DIRECT_DATABASE_URL='postgresql://test:test@localhost:5432/test' npx prisma validate --schema apps/api/prisma/schema.prisma` | **PASS; schema valid; no database was contacted**. |
| `node apps/api/scripts/check-route-authorization.js` | **PASS; 866 routes in 51 controllers; 91 undecorated routes are in reviewed controllers**. |
| `node scripts/check-web-api-contract.js` | **PASS; 281 client calls match 866 API routes; 70 query-key sets checked; 18 dynamic paths unchecked**. |
| `NODE_OPTIONS='--max-old-space-size=800' npm test --workspace=@wlct/web` | **PASS; 35 suites and 155 tests**. Web typecheck had 0 diagnostics, lint had no warnings/errors, and production build generated 54/54 static pages. |
| `NODE_OPTIONS='--max-old-space-size=800' npm test --workspace=@wlct/admin-web` | **PASS; 3 suites and 4 tests**. Admin typecheck had 0 diagnostics, lint had no warnings/errors, and production build generated 29/29 static pages. |
| `NODE_OPTIONS='--max-old-space-size=800' npx jest --config tests/e2e/jest.config.js --runInBand` | **PASS; 4 suites and 4 deterministic React server-render smoke tests**. This is not browser-driven or provider E2E. |
| `git diff --check` | **PASS on 2026-10-06**. |

### Current release boundary

The API runtime Jest suite and static contract/schema/security checks pass, but the full API TypeScript project and production Nest build do not complete in the approximately 2 GiB validation environment, and API lint still exits 1 on the repository's existing 6,436 warning findings. **API validation is not green and the product is not certified production-ready.** The release-manifest generator was not run because the API gates are unresolved; hashes were not manually changed. Final Git check: branch `main`, HEAD commit `da0090bf8536652f37d830beda8598013b84f2ec`, 0 staged paths, 125 modified tracked paths and 73 untracked paths; no commit was created. `RELEASE_MANIFEST.json` remains unchanged, `apps/api/dist` is absent, and `git diff --check` passed after the documentation refresh. The working tree is intentionally dirty with the broader GAP-51–GAP-100 source/report updates plus the 2026-10-06 follow-up.
