# Release Package Check

Package: `White-Label01-Crypto-Copy-Trading-App-FINAL-COMPLETE.zip`
Top-level directory: `White-Label01-Crypto-Copy-Trading-App/`
Repository: https://github.com/Ainul-550Islam/White-Label01-Crypto-Copy-Trading-App
Hashed source commit: `e0e179b` (recorded in `RELEASE_MANIFEST.json` as `source_commit`)
Self-tested archive: built with `git archive` from `104cc5a` (= `e0e179b` + `RELEASE_MANIFEST.json`)
Final archive: the self-tested content plus this file; re-verified with the same script after this
file was committed (missing / unexpected / hash-mismatch must again be 0).
Previous package: round 8 (`9873356`). Round 8 (`b2a66c8` .. `df640d3`) and round 8b
(`73a0343` .. `e0e179b`) are described in section 9.

Sandbox reset during packaging: after the first round-8 archive had passed its self-test, a
sandbox reset rolled the repository's `.git` back to a round-7 commit and dropped two working-tree
changes (the CI `docker` job and the regenerated `docs/source`). The history was rebuilt on the
round-7 head `6172866` from the working tree, the CI edit was re-applied, and `docs/source` was
regenerated. Before committing the manifest, every one of the 2010 files at `df640d3` was
compared with the SHA-256 recorded in the pre-reset manifest (source `7233bdd`): **0 extra,
0 missing, 0 different**.

Second sandbox reset (round 8b), after the round-8 package had been delivered: `.git` was again
rolled back to round 7, the same working-tree files were reverted (CI `docker` job,
`docs/source`, the exec bits of three scripts), and Docker and `node_modules` were removed. The
history was restored from the round-8 bundle (`9873356`) and the working tree from that commit;
all 2010 files then matched the round-8 manifest. Docker was reinstalled and the stack was
built and run again **from the extracted round-8 package** (section 6, "Round 8b re-run"). That
run found one more defect - the seed accepted a super-administrator password the API itself
would reject - fixed in `73a0343`.

What was executed when:

* After the second reset (round 8b): the Docker build of all 9 images with an empty cache, the
  stack run, `scripts/smoke-test.sh`, the seed, the worker negative test, `node --test scripts/`,
  and the checks touched by the seed change (section 5), plus the packaging and the self-test.
* Before the first reset, on content proven identical by SHA-256: the full API and web Jest runs,
  the admin-web build and lint, the embedded-PostgreSQL runs and the clean install of section 4.
  Round 8b changed no file those runs read: it changed `apps/api/prisma/seed.ts` (outside the API
  Jest `rootDir` `src/` and imported by no suite), one new script test, `.env.example` comments
  (re-checked by `env-example-coverage.spec`), two documentation files and `docs/source`.

```
MISSING REQUIRED FILES: 0
UNEXPECTED FILES: 0
HASH MISMATCHES: 0
PRIVATE KEYS IN PACKAGE: 0
```

---

## 1. File counts

| | Count |
| --- | --- |
| Files tracked by git at `e0e179b` (excluding the two release files) | 2011 |
| Files hashed in `RELEASE_MANIFEST.json` | 2011 |
| Self-referential release files (not hashed) | 2 (`RELEASE_MANIFEST.json`, `RELEASE_PACKAGE_CHECK.md`) |
| Files in the final package | 2013 |
| Source / test / doc / config-or-asset (hashed) | 1582 / 255 / 90 / 84 |
| Total size of hashed files | 69,997,963 bytes |
| Files extracted from the self-tested archive | 2013 (2011 hashed + the two release files) |
| Missing (in manifest, not in archive) | **0** |
| Unexpected (in archive, not in manifest) | **0** |
| SHA-256 mismatches | **0** |

The package content rule is "exactly what git tracks", so nothing can be silently dropped or
added: the archive is produced by `git archive` from the release commit, and the self-test
compares every extracted file with the manifest written from `git ls-files`.

## 2. Excluded content

Excluded by construction (not tracked): `.git/`, `node_modules/`, `.next/`, `dist/`, `build/`,
`coverage/`, `.dart_tool/`, `target/`, `__pycache__/`, `*.pyc`, `.venv/`, `.pytest_cache/`,
`.terraform/`, `*.log`, `.DS_Store`, `.env` and `.env.*` (templates `*.example` are included),
`apps/api/.generated/` (SSO test keys), `apps/api/tsconfig.probe.json` (local scratch file),
nested archives. At packaging time the working tree held 6 excluded entries (the local `.env`,
two `tsconfig.tsbuildinfo`, `.dart_tool`, two `egg-info`); they are listed in
`RELEASE_MANIFEST.json -> excluded.working_tree_entries_excluded`. The generated SSO test keys
(`apps/api/.generated/`, re-created by the round-8b Jest run of `fail-soft-reads.spec`) and the
Python caches of the round-8b `pytest` run were deleted before the manifest was written.

Archive structure checks: one top-level directory, 0 members outside it, 0 absolute or `..`
member names, 0 symlinks, 0 nested archives, 0 forbidden paths (the patterns above plus
`*.key`, `*.pem`, `*.p12`, `*.pfx`, `*.jks`).

## 3. Secret scan

Run over every tracked file and again over the extracted archive.

| Check | Result |
| --- | --- |
| `*.pem` / `*.key` / `*.p12` / `*.pfx` / `*.jks` files in the package | 0 |
| PEM private-key bodies (BEGIN marker followed by base64) in any file | 0 |
| Files containing the literal BEGIN marker | 16 - scanner patterns and redaction tests (`billing-no-fake-success.spec.ts`, `apps/web/src/api/api-errors.ts`, `test_observability_redaction.py`, `dr-manifest.test.mjs`, `low-latency-gateway/src/tracing.rs`) and the handover / source dumps that contain them; none is followed by key material |
| AWS access key ids | only `AKIAIOSFODNN7EXAMPLE` (AWS's documented example id), 31 occurrences in redaction tests, fixtures and their doc dumps |
| `sk_live_` strings | `sk_live_0123456789abcdefghij` (sequential canary, 17 occurrences); `sk_live_abcdefghij` (18, a redaction assertion in `services/execution-engine/tests/test_part16_placement.py` and its dumps) and `sk_live_51H8xYzabcd` (4, a redaction case in `services/low-latency-gateway/src/tracing.rs` and its dump). All three are test fixtures present since the initial commit; the last two are shorter than the self-test's 20-character pattern and were not listed in earlier package checks |
| GitHub / Slack / Google API tokens, service-account JSON keys | 0 |
| Secrets generated for the Docker runs (13 values written by `generate-keys.mjs --write` into each local, git-ignored `.env`: the repository's and, in round 8b, the extracted package's - 26 values) appearing in any tracked file | 0 |
| The seed administrator passwords used in the Docker smoke tests (round 8 and round 8b) appearing in any tracked file | 0 |
| Password literals in the new `scripts/seed-password-policy.test.mjs` | test inputs for the policy (`My_P4ss`, `onlylowercaseletters`, the `.env.example` placeholder, two made-up strong/e-mail-containing values); never used as credentials anywhere |

The self-test's `secret_hits: 48` are exactly the 31 example AWS ids plus the 17 canary
`sk_live_` strings above.

SSO test keys: the three SAML key pairs (IdP, attacker, expired) are not committed. The API
Jest `globalSetup` (`apps/api/test/sso-test-keys.global-setup.js`) runs
`scripts/generate-test-sso-keys.mjs`, which uses OpenSSL to write them into the git-ignored
`apps/api/.generated/sso-test-keys/`. In the clean install below they were generated afresh
inside the extracted copy and the SAML/SSO suites passed against them. Without OpenSSL the run
stops at `globalSetup` with a clear message; nothing is skipped. The git history of the source
repository still contains the old keys in commit `3941110`; the package contains no `.git`.

Absolute paths: no runtime file contains a machine path. `/home/user` appears in 28 files, all
non-runtime: the historical handover generators `scripts/gen_part{8,9,11..22}_handover.py`
(fallback used only when `__file__` is undefined), the generated handover dumps
`docs/PART*_HANDOVER_FULL_SOURCE.md` and `docs/source/11-infrastructure.md`.

## 4. Clean install from the extracted archive

The self-tested pre-reset archive (content identical to this package, see the header) was
extracted to a fresh directory outside the repository. Every step below ran inside that copy. Afterwards all 2010 hashed files were re-hashed: **0 modified,
0 missing**. Every new path the steps created (`node_modules`, `dist`, `.generated`, the
`.env` for the Docker build, ...) is covered by the package's own `.gitignore` files: **0**
non-ignored paths beyond the package.

| Step (run inside the extracted copy) | Result |
| --- | --- |
| `npm ci --no-audit --no-fund` | ok, 1265 packages, lockfile honoured |
| `npm run build:packages` | ok |
| `prisma generate` (low-memory two-step wrapper for this sandbox) | ok |
| `check:route-authorization` / `check:prisma-literals` / `check:web-api-contract` | OK 846 routes in 46 controllers / OK 883 files / OK 205 calls vs 846 routes |
| `check:api-di` (now two roots) | DI_OK AppModule 74 modules, 911 providers; DI_OK WorkerModule 29 modules, 209 providers |
| `node --test scripts/` | 153/153 |
| API suites changed in round 8, run in the copy: fail-soft-reads, SAML single logout, SLO configuration, encrypted assertions, saml-provider, sso-login, sso-identity, sso-logout, sso-transaction, the five worker suites (incl. both engine-status suites) | **14 suites, 270/270** (SSO test keys generated afresh by `globalSetup`) |
| `docker compose -f docker-compose.yml build` for all 9 services | 9/9 rc 0. Every layer came from the build cache of the run in section 6, which shows the copy's build context is byte-identical to the one that was built and run |

Round 8b, after the second reset: the delivered round-8 package
(`sha256 6287f668...a00c3`) was extracted again to a fresh directory, and every step ran inside it:
`cp .env.example .env` + `generate-keys.mjs --write .env` (13 secrets, 3 connection URLs);
`docker compose -f docker-compose.yml build` one service at a time with an **empty build cache**:
9/9 (`nest build` and `next build` ran, not cached); `up -d` and the checks of section 6;
`npm ci --no-audit --no-fund --ignore-scripts`, `build:packages`, `prisma generate` for the
host-side seed. Afterwards the 2010 files of that package's manifest were re-hashed: **0 modified,
0 missing**; every new path (`node_modules`, `dist`, `.env`, ...) is covered by the package's
`.gitignore` files. That package differs from this one only by the round-8b commits.

## 5. Checks on the source repository

Run against the working repository before packaging (same file content as `df640d3`).

| Check | Result |
| --- | --- |
| API Jest, every `*.spec.ts` under `src` (the configured `rootDir`), one suite per process | **107 suites, 1840/1840**, 0 failed, 0 skipped, 0 todo |
| API full-graph type check | `nest build` (tsc builder, `tsconfig.build.json`: every non-spec file including `app.module.ts` and `main.ts`) inside the Docker image build: 0 errors. Earlier packages could not run this here (memory); spec files are type-checked by ts-jest in the run above |
| Web Jest | 7 suites, 92/92 |
| admin-web | `tsc --noEmit` 0 errors; `next build` ok (24 pages); lint 0 warnings, 0 errors |
| `node --test scripts/` | round 8b: **160/160** (7 new in `seed-password-policy.test.mjs`); round 8: 153/153 (3 new for `generate-keys --write`) |
| Round 8b checks touched by the seed change | `seed.ts` type-checked with the API compiler options (`tsc --noEmit`, it lies outside the API `tsconfig` include): 0 errors; `env-example-coverage.spec` 6/6 after the `.env.example` comment edit; `fail-soft-reads.spec` 23/23; `check:prisma-literals` OK (883 files); trading-core `test_repo_reference_integrity.py` 4/4 after the documentation edits |
| Round 8b mutation checks | `seed-password-policy.test.mjs` against the previous seed: 5/7 fail; against the fixed seed with the pre-write check removed (policy only inside `seedSuperAdmin`, after the writes): 5/7 fail. The two that pass in both are the positive controls (accepted and unset password) |
| `check:route-authorization` / `check:prisma-literals` / `check:web-api-contract` / `check:api-di` | 846 routes / 883 files / 205 calls vs 846 routes / DI_OK AppModule + WorkerModule |
| trading-core `tests/test_repo_reference_integrity.py` after the docs / compose / Terraform edits | 4/4 |
| Terraform (1.9.8 locally; CI pins 1.8.5) after the ElastiCache parameter group change | `fmt -check` ok, `validate` Success (run on a copy outside the repository) |
| `.github/workflows/ci.yml` after adding the `docker` job | parses as YAML; 7 jobs; not run on GitHub (see limitations) |
| Mutation checks recorded in round 8 | fail-soft guard 4/4 caught; SAML SLO 17/18 caught (the survivor swaps SHA-256 for SHA-1, which the verifier rejects anyway because it pins SHA-256/512); engine posture contract: restoring the invented `fencingEnabled` key fails 4 tests; `generate-keys` URL step disabled: 2 tests fail |
| SAML SLO services against a real database | embedded PostgreSQL 17.5: 13/13; a negative control reproduced the CHECK violation (23514) that migration `20261002020000_saml_single_logout` fixes |

Projects round 8 did not touch (billing-lib, TypeScript and Python SDKs, trading-core full suite,
execution-engine, market-data, trading-engine, Flutter, Rust) were not rerun; their round-7
results are carried in `RELEASE_MANIFEST.json -> test_results`, each marked as carried.

How the API suite was run here: this sandbox has about 2 GB of RAM (plus 6 GB swap in round 8),
and ts-jest type-checks with the whole API program loaded, so every suite ran in its own Jest
process with the transform cache on disk. The set of suites, the test files and the
configuration are unchanged; `npm test` runs them in one process on a normal machine.

## 6. Docker

First real build and run of the stack (Docker 26.1.5, Compose 2.26.1, overlay2, cgroup v2,
from `whitelabel-copytrade/`, `docker compose -f docker-compose.yml ...`):

| Check | Result |
| --- | --- |
| Images built | 9/9: api 486 MB, worker 486 MB (api Dockerfile), migrate 783 MB (build target), web 231 MB, admin-web 230 MB, notification-service 282 MB, market-data 294 MB, trading-engine 306 MB, execution-engine 218 MB |
| `migrate` | applied 20/20 migrations to the `postgres:16.4` container, exit 0; a rerun reports no pending migrations |
| Services | api, web, admin-web, execution-engine, trading-engine, market-data, notification-service, postgres, redis: `healthy`. worker: running, 0 restarts (no healthcheck by design) |
| Worker | logged `execution engine compatible: mode=simulated` and `worker worker-1 online: partitions=8`; `GET /api/v1/observability/worker-coordination`: 8/8 partitions claimed by `worker-1`, 0 misaligned |
| Negative test | a one-off worker with a wrong engine token logged `execution engine gate failed: ... [UNAUTHORIZED]` and exited 1; the running worker was unaffected |
| HTTP smoke | `GET /health` 200, `GET /health/ready` 200; web `/login` 200, admin `/login` 200 |
| Seed and login | `npm run db:seed` from the host into the container database: 119 permissions, 7 role templates, platform tenant, 12 feature flags, 3 plans, super administrator. `POST /api/v1/auth/login` 200 with the seeded administrator, 401 with a wrong password; `GET /api/v1/auth/me` 200 |
| Logs | 0 error-level lines across the 8 application containers; no BullMQ eviction warning |
| Redis | `CONFIG GET maxmemory-policy` -> `noeviction` |

Defects found by this run and fixed in round 8 (each now fails a check if it returns):

| Defect | Fix | Check |
| --- | --- | --- |
| API image: `nest build` out of heap | `NODE_BUILD_HEAP_MB` build argument (6144) | CI `docker` job |
| API image: runtime `COPY apps/api/node_modules` had no source (workspaces hoist) | directory created after prune | CI `docker` job |
| trading-engine and execution-engine images: invalid `pip --require-hashes=false` | plain `pip install -r requirements.txt` | CI `docker` job |
| `.dockerignore` gaps | local env files, caches and build outputs excluded | - |
| `migrate` (then api and worker) used the host-side `DIRECT_DATABASE_URL` from `.env` and failed P1001 | overridden in compose and the staging overlay | Docker run |
| Redis `volatile-lru`, which BullMQ rejects (also in production Terraform) | `noeviction` in compose, staging and a new ElastiCache parameter group; `docs/SECURITY.md` section 12 | Terraform validate |
| worker command pointed at a non-existent path | `apps/api/dist/worker.js` | Docker run |
| worker DI graph did not resolve: the worker had never started | WorkerModule imports LoggerModule.forRoot(), ObservabilityModule, PrismaModule, AuditModule | `check:api-di` resolves WorkerModule |
| engine compatibility gate refused every real engine: the TS `/status` mirror required keys the engine never sends (`distributedLockWiring`, `venueAttestation`, `credentialRegistry`) | views mirror the Python `describe()` bodies | parity spec reads the Python source; contract spec parses the captured real reply |
| worker refusal reasons never written (buffered logs never flushed) | `useLogger` + `flushLogs` | Docker negative test |
| a refusing worker kept running instead of exiting | bounded close then `process.exit(1)` | Docker negative test |
| worker inherited the API's HTTP healthcheck (always unhealthy) | disabled for the worker, with the reason | Docker run |
| API lacked the fleet declaration, so the coordination panel reported healthy claims as misaligned | same `WORKER_MEMBERSHIP` / partition defaults as the worker | Docker run |
| `generate-keys --write` left the placeholder password in `DATABASE_URL` / `DIRECT_DATABASE_URL` and none in `REDIS_URL` | URLs follow the generated passwords (placeholders only) | 3 node tests |

### Round 8b re-run (after the second sandbox reset)

Docker 26.1.5 and Compose 2.26.1 reinstalled; ~2 GB RAM + 6 GB swap. Everything ran from a
fresh extraction of the delivered round-8 package (section 4), `docker compose -f
docker-compose.yml ...`.

| Check | Result |
| --- | --- |
| Images built (empty cache, one service at a time) | 9/9: api 486 MB, worker 486 MB, migrate 832 MB, web 231 MB, admin-web 230 MB, notification-service 282 MB, market-data 294 MB, trading-engine 306 MB, execution-engine 218 MB. The build logs show `nest build` and `next build` (42 pages) executing |
| `migrate` | 20/20 migrations applied to a fresh `postgres:16.4` volume, exit 0 |
| Services | api, web, admin-web, execution-engine, trading-engine, market-data, notification-service, postgres, redis: `healthy`; worker running, 0 restarts |
| Worker | `execution engine compatible: mode=simulated instance=execution-engine-1`, `TRADE_EXECUTION consumer online`, `worker worker-1 online: partitions=8 membership=1`; `GET /api/v1/observability/worker-coordination`: all 8 partitions held by `worker-1`, `holderMatchesExpectation: true` for each |
| Negative test | one-off worker with a wrong engine token: `execution engine gate failed: execution engine call failed [UNAUTHORIZED] Invalid internal service credentials.`, exit 1; the running worker stayed up |
| HTTP | `/health`, `/health/ready` (PostgreSQL up, Redis up), `/health/startup` 200; web `/login` and admin `/login` 200 |
| Seed and login | seed from the host (section 7); `POST /api/v1/auth/login` 200 with the seeded administrator, 401 with a wrong password; `GET /api/v1/auth/me` 200 |
| `scripts/smoke-test.sh` | **36 passed, 0 failed**: health probes, login, authorisation, error envelope, refresh-token rotation and reuse detection, global session revocation, security headers. (Two earlier attempts stopped with exit 3 "rate limited" after manual logins; the script reports that state on purpose. The run counted here started after the throttle window.) |
| Logs | error-level lines: 0 in worker, web, admin-web and the four Python services; 4 in api, all of them the refresh-token-reuse security events the smoke test provokes on purpose |
| Redis | `CONFIG GET maxmemory-policy` -> `noeviction` |

Defect found by this run and fixed in round 8b:

| Defect | Fix | Check |
| --- | --- | --- |
| The seed accepted any non-placeholder `SEED_SUPER_ADMIN_PASSWORD`. With an unquoted `#` in `.env` (the trap `.env.example` documents), dotenv-cli truncated the value to 6 characters, the seed hashed it, and the first login was a 401 | `seed.ts` applies the API's password policy (`evaluatePassword`, `DEFAULT_PASSWORD_POLICY`, minimum length from `PASSWORD_MIN_LENGTH`, e-mail context) - the policy registration and password change already enforce - and checks the credentials before the first write; the error names each failed rule and the quoting fix | `seed-password-policy.test.mjs` (7 tests, mutation-checked); Docker re-run: the truncated value, a single-class value, the placeholder and a password containing the e-mail local part were each rejected before any write; a compliant password seeded and logged in |

## 7. Database

| Check | Result |
| --- | --- |
| Migration directories | 20 (round 8 added `20261002020000_saml_single_logout`), strictly increasing timestamps, no duplicate ids, each with `migration.sql`; historical migrations unmodified |
| Fresh deploy + drift | embedded PostgreSQL 17.5: 20/20 applied, `migrate diff` empty; Docker `postgres:16.4`: 20/20 applied by the `migrate` job |
| RLS coverage | 186 `tenant_isolation` policies (round 8 added no tenant table); verified by `rls-coverage.spec` in the API run |
| Seed | round 8: ran against the Docker database (section 6). Round 8b: from the host into the re-run's database - rejections (truncated, single-class, placeholder, e-mail-containing) stopped before the first write ("permissions" never printed); a compliant password created 119 permissions, 7 role templates, the platform tenant, 12 feature flags, 3 plans and the super administrator |

## 8. References and configuration

* Dockerfile `COPY` sources: all present, now proven by building every image.
* Compose: every `${VAR}` interpolated by the root compose files has an assignment line in
  `.env.example` (asserted by `env-example-coverage.spec.ts`, part of the API run). Round 8
  added no new interpolated variable without a default.
* `docs/source/` regenerated in round 8b from a clean `git archive` of `73a0343`: 14 sections,
  1969 files, 848,249 lines; the `FILE:` list equals `git ls-files` minus the documented
  exclusions (migrations, lockfiles, `docs/source` itself) - 1969 = 1969, 0 missing, 0 extra;
  two consecutive runs are byte-identical. (Round 8: from `d933424`, 1968 files, 848,035 lines.)
* `docs/GETTING_STARTED.md` claimed the seed creates "a demo tenant and its admin from
  `SEED_TENANT_ADMIN_*`". Nothing reads those variables and the seed creates no demo tenant; the
  text now says so (the variables stay in `.env.example`, marked as unused by the seed).
* `docs/PART*_HANDOVER_FULL_SOURCE.md` are historical records and were not regenerated.
* Manifests (no dependency was upgraded): npm workspaces with `package-lock.json`; Python
  `pyproject.toml` + pinned `requirements*.txt`; Flutter `pubspec.lock`; Rust `Cargo.lock`;
  Terraform `.terraform.lock.hcl`.

## 9. Changes in round 8

| Commit | Change |
| --- | --- |
| `b2a66c8` | I2: the four admin-console `react-hooks/exhaustive-deps` warnings fixed (lint clean) |
| `c16f143` | I1: a failed database read is an error, not an empty answer. Of 358 catch-and-answer-empty sites: 266 wrappers removed, 9 log and rethrow, 26 narrowed to "row not found" only, 57 kept with a reason each in `fail-soft-reads.spec.ts`. Fail-open security reads (restriction, period close, session revocation, SSO enforcement, revoke-all) now fail closed; reconciliation reports FAILED and health UNKNOWN when they cannot read. I3: SAML Single Logout, SP- and IdP-initiated (HTTP-Redirect binding; signed, issuer / destination / freshness / replay checked; only the subject's sessions revoked; migration `20261002020000_saml_single_logout`); SSO origin kept through 2FA; web SSO no longer hardcodes OIDC. (I1 and I3 were separate commits before the reset; they share files, so the rebuilt history keeps them together) |
| `9a3bf39` | Docker: image, compose, staging, Redis policy and Terraform fixes (section 6) |
| `2c4ccf0` | Worker: DI graph, engine status contract, log flushing, exit on refusal |
| `0692c41` | `generate-keys --write` keeps the connection URLs in step |
| `d933424` | CI `docker` job; root README sections 4, 5, 8 and 10 |
| `df640d3` | `docs/source` regenerated |
| `7e30b3f` | `RELEASE_MANIFEST.json` |
| `9873356` | `RELEASE_PACKAGE_CHECK.md` (round-8 package) |
| `73a0343` | Round 8b: the seed holds `SEED_SUPER_ADMIN_PASSWORD` to the API password policy before any write; `seed-password-policy.test.mjs`; `GETTING_STARTED.md`, `.env.example` comments and the root README corrected |
| `e0e179b` | `docs/source` regenerated |
| `104cc5a` | `RELEASE_MANIFEST.json` (round 8b) |
| (this commit) | `RELEASE_PACKAGE_CHECK.md` (round 8b) |

## 10. Limitations of this verification

* **After the sandbox resets**: the Docker build and run, the smoke test, the seed, the script
  tests and the seed-related checks were re-run after the second reset (round 8b). The full API
  and web Jest runs, the admin-web build and lint, the embedded-PostgreSQL runs and the
  `npm ci`-based clean install of section 4 were obtained before the first reset on content
  proven identical by SHA-256, and were not re-run (round 8b changed no file they read; header).
* **CI on GitHub**: the new `docker` job and the rest of the workflow were not run on GitHub
  Actions (no runner here). The same image builds ran locally with Docker.
* **actionlint** was not available in this round; `ci.yml` was checked as YAML only.
* **Projects round 8 did not touch** carry their round-7 results (section 5).
* **Live integrations** (exchanges, payment / payout / KYC / AML / push / SMS providers, custody,
  `terraform apply`, a real SAML / OIDC IdP) are gated off or need operator accounts and were
  not exercised.
* **Seed inside a container**: the images hold production dependencies only, so the TypeScript
  seed ran from the host against the Postgres that compose publishes on `127.0.0.1:5432`.
* **Docker image sizes**: the `migrate` image (build target) measured 783 MB in round 8 and
  832 MB in the round-8b empty-cache build of identical Dockerfiles; the other eight sizes
  matched. The cause was not investigated.

## 11. Known gaps

* Live order routing, custody, licensing, provider-dependent payouts, tax filing and
  `terraform apply` are buyer/operator dependencies and stay gated (fail-closed defaults).
* SSO: IdP-initiated SAML **login** is refused by design; SAML Single Logout supports the
  HTTP-Redirect binding only (no SOAP / HTTP-POST logout); interoperability against a real IdP
  is the operator's to test.
* 57 deliberately kept `catch` blocks (not fail-soft storage reads), each listed with a count
  and reason in `apps/api/src/common/fail-soft-reads.spec.ts`.
* The TypeScript seed runs from the host, not inside a container (section 10).
* `docs/PART*_HANDOVER_FULL_SOURCE.md` are point-in-time records and are not regenerated.

This ZIP contains the current complete consolidated codebase. It does not claim that intentionally gated buyer/operator integrations are complete.
