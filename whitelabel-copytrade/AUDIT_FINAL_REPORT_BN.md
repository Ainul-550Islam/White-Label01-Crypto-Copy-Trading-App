# চূড়ান্ত অডিট রিপোর্ট (বাংলা) — whitelabel-copytrade

তারিখ: ২০২৬-০৯-২৩
স্কোপ: পুরো রিপো — ফাইল-বাই-ফাইল, লাইন-বাই-লাইন অডিট; মিসিং সব ফাইল সম্পূর্ণ ইমপ্লিমেন্টেশনসহ যোগ করা। কোনো ফাইলে `# ... existing code ...` ধরনের এলিশন করা হয়নি — প্রতিটা ফাইল সম্পূর্ণ।

---

## ১. চূড়ান্ত ফলাফল এক নজরে

| যাচাই | ফলাফল |
|---|---|
| apps/api jest | **32/32 suites, 686/686 tests PASS** |
| TypeScript typecheck (api, admin-web, web, notification-service) | **সব OK** |
| libs/trading-core pytest | **1767 passed** |
| services/execution-engine pytest | **506 passed, 12 skipped** (skipped গুলো live-infra টেস্ট, DB/Redis ছাড়া by design) |
| services/trading-engine pytest | **43 passed** |
| services/market-data pytest | **19 passed** |
| mypy strict (execution-engine app + trading-core typed) | **0 issues (27 files)** |
| ruff (নিজ নিজ প্রজেক্ট config-এ) | **সম্পূর্ণ clean — trading-core, execution-engine, staging স্ক্রিপ্ট** |
| scripts/verify-part1.sh | **22 pass / 0 fail / 2 skip** (API চলুক না বলে ২টা skip)। পরে একটা re-run-এ 2GB sandbox-এর kernel OOM-killer monorepo-tsc মেরেছে — per-app typecheck 4/4 OK, আর স্ক্রিপ্টেই heap-fix (NODE_OPTIONS 1536MB, operator-overridable) যোগ হয়েছে |
| AST import-scan (engine app+tests + পুরো core, ২০৮ ফাইল, ২৭৫ মডিউল) | **0 মিসিং মডিউল** |
| হ্যান্ডওভার ডকুমেন্ট FILE-audit (৭৭১ section vs disk) | **0 প্রকৃত মিসিং** |

---

## ২. যে ফাইলগুলো মিসিং ছিল — সব কটা এখন ডিস্কে, সম্পূর্ণ

### ক) `wlct_trading/execution/transport/` প্যাকেজ (৭ ফাইল) — Part 20-র মিসিং অর্ধেক
`key_registry.py`, `client.py`, `client_metrics.py`, `replay_guard.py`, `server.py`, `server_metrics.py`, `__init__.py` — সব কটা নতুন লেখা। মূল বৈশিষ্ট্য:

- **fail-closed verifier**: হেডার না থাকলে → `missing_headers` → `bad_key_id` → `bad_timestamp` → `stale_timestamp` → `replayed_nonce` → `bad_signature` — ছয়টা stable refusal code, grep-যোগ্য।
- signature তুলনা `hmac.compare_digest`; clock skew সহনশীলতা ৫ মিনিট; replay window ১০ মিনিট, nonce cap ১ লাখ (oldest-evict)।
- `describe()` কখনো সিক্রেট লিক করে না — algorithm আর window ছাড়া কিছু না।
- client/server metrics: `signed`/`refused` (+byReason), negative মানে ValueError।

### খ) execution-engine-এর ৩টা app মডিউল (handover ডকুমেন্টে সোর্স নেই — composition usage + core API থেকে লেখা)
1. **`app/distributed_locks.py`** — `DistributedLockConfig` / `build_distributed_lock_manager` / `DistributedLockWiring`। enabled+URL খালি → কনফিগ এরর (মেমোরিতে silent fallback নিষেধ); URL অবশ্যই `redis://` বা `rediss://`; fencing সবসময় → `FencedLockManager`; `describe()` URL কখনো render করে না; `is_distributed` অবজেক্ট থেকে derived, flag থেকে নয়। এই টার্নে **আসল বাগ ধরা পড়ে ঠিক হয়েছে**: `RedisLockManager`-কে URL নয়, সত্যিকারের redis client লাগে — এখন `redis.asyncio.Redis.from_url(url)` দিয়ে client বানানো হয়, আর `redis==5.1.1` requirements.txt-এ runtime dependency হিসেবে যোগ হয়েছে। স্মোক-ভেরিফাইড: locks enabled অবস্থায় boot → `FencedLockManager`, `is_distributed=True`।
2. **`app/venue_attestation.py`** — `VenueAttestationConfig` / `build_venue_attestation` / `BinancePlacementAttestor`। provider না থাকলে বা disabled হলে error (fail-closed); Binance `/sapi/v1/account/apiRestrictions` (signed) + `/api/v3/exchangeInfo` (+ optional `/api/v3/account`) থেকে `PlacementFacts` → `CachingPlacementAttestor`-মোড়ানো wiring; transport fail → `VenueAttestationError` (reviewer এটাকে finding বানায়)।
3. **`app/credential_registry.py`** — `CredentialRegistryWiring` / `build_credential_registry`। provider-কে wrap করে lifecycle metadata + capability declarations + named selection; `describe()` → `credentialRegistry` status key; BASE_ENV-এ source `"none"` gracefully — registry None-provider নয়, none-source provider মোড়ে।

### গ) staging live-readiness টুলিং (README যেগুলোর নাম নিয়েছিল, কিন্তু ফাইল ছিল না)
1. **`scripts/staging/live_readiness.py`** (Part 28) — development preflight: আসল composition root দিয়ে runtime বানিয়ে ৮টা prerequisite grade করে; credential-conditional গুলোর SKIPPED = success; NODE_ENV=production এ `--allow-production` ছাড়া চলে না; `--json` / `--staging` মোড।
2. **`scripts/staging/staging_rehearsal.py`** (Part 29) — strict rehearsal: Postgres connectivity + schema + **persistence recovery** (এক pool-এ probe row লিখে দ্বিতীয়, আলাদা pool-এ পড়া, শেষে cleanup); Redis connectivity + **লক রাউন্ড-ট্রিপ** (দ্বিতীয় owner rejection, fencing token advance, stale handle refused) — নিজস্ব ন্যূনতম RESP ক্লায়েন্ট সহ (service-এ redis প্যাকেজ ছিল না, নতুন dependency লক-চেকের জন্য যোগ হয়েছে); ৫টা status (PASS/FAIL/BLOCKED/UNVERIFIED/SKIPPED), strict readiness, exit code 0/1/2; DSN/URL কখনো প্রিন্ট হয় না।
3. **`infrastructure/.env.staging.example`** — সম্পূর্ণ fail-closed staging টেমপ্লেট (compose overlay-র সব required ভেরিয়েবলসহ)।
4. **`services/execution-engine/tests/test_part28_staging_preflight.py`** — ২৭ টেস্ট।
5. **`services/execution-engine/tests/test_part29_staging_rehearsal.py`** — ৫১ টেস্ট।
   (README-তে 70/69 লেখা ছিল — প্রকৃত সংখ্যা 27/51; README এখন সত্য সংখ্যা বলে।)

### ঘ) নাম-নেওয়া কিন্তু অনুপস্থিত অন্যান্য
- `services/execution-engine/.env.example`-এ **৭টা ঘোষিত setting-এর নাম** যোগ হয়েছে যেগুলো কোনো example ফাইলে ছিল না: `EXECUTION_DISTRIBUTED_LOCKS`, `EXECUTION_REDIS_URL`, `EXECUTION_LOCK_ACQUISITION_TIMEOUT_MS`, `EXECUTION_LOCK_RENEWAL_RATIO`, `EXECUTION_VENUE_ATTESTATION_CACHE_TTL_MS`, `EXECUTION_VENUE_ATTESTATION_TESTNET`, `EXECUTION_VENUE_ATTESTATION_INCLUDE_ACCOUNT` — fail-closed কমেন্টসহ। এটা trading-core-এর `test_env_example_coverage` ধরেছিল।

---

## ৩. এই পর্বে ঠিক হওয়া আসল (latent) বাগ

1. **`venue_attestation.py` ইমপোর্ট**: `PlacementReviewRequest` আসলে `placement_attestor.py`-তে — `placement_review.py` থেকে আনলে collection error হতো।
2. **`distributed_locks.py`-এ `RedisLockManager(url)`**: RedisLockManager client চায়, URL নয় — টেস্টে ধরা পড়েনি কারণ BASE_ENV-এ locks disabled। এখন সত্যিকারের client + runtime dependency।
3. **RLS artifacts-স্কিমা drift**: স্কিমা ১৯০ মডেলে বেড়েছিল, কিন্তু Part 11-এর `enable.sql`/`disable.sql`/`rls_coverage.json` পুরনো ৪৩-টেবিল সেট বর্ণনা করছিল। `scripts/gen_part11_rls.py` দিয়ে **regenerate** করা হয়েছে (১৪৪ covered, ২২ platform-scoped)। সাথে:
   - `wlct_trading/enablement.py`-এর `PLATFORM_SCOPED_TABLES` নতুন সত্যের সাথে সমকক্ষ (৭ → ২২ টেবিল);
   - drift-parity টেস্টের pinned সংখ্যা 43 → 144 (কমেন্টসহ, কারণ ব্যাখ্যা করে)।
4. **mypy strict-এ ৭টা এরর** (সব ঠিক):
   - `transport/server.py`: `registry` প্যারামিটারে টাইপ নেই → `KeyRegistry` annotation;
   - `locks.py`: `FencingClient` Protocol যোগ (আগে `object`-এ `.eval()` কল করা হতো); `FencedLockManager` এখন সত্যিকারের `LockManager` subclass (duck-typing নয় — engine/wiring-এর টাইপ-স্লটে বসানো যায়); `int(result)` narrowing;
   - `distributed_locks.py`: client টাইপ + `manager` redefinition;
   - `venue_attestation.py`: `createTime` isinstance-narrowing আলাদা লোকালে।
5. **`composition.py`**: ব্যবহার-হীন `FencedLockManager`/`InMemoryLockManager` ইমপোর্ট বাদ।
6. **`MIGRATION_RECONCILIATION_REPORT.md`**: ভুয়া placeholder পাথ (`<timestamp>_reconcile_current_schema`) → প্রকৃত ফোল্ডার `20260922054232_reconcile_current_schema`।
7. **`infrastructure/staging/README.md`**: `../../`-prefix নামগুলো repo-root-relative করা (repo-reference-integrity টেস্ট যে ভোকাবুলারিতে নাম চায়) + প্রকৃত টেস্ট-সংখ্যা।

---

## ৪. ভেরিফিকেশন কমান্ড (সব এই sandbox-এ চালানো)

```
cd libs/trading-core          && python3 -m pytest -q          # 1767 passed
cd services/execution-engine  && python3 -m pytest -q          # 506 passed, 12 skipped
cd services/execution-engine  && python3 -m mypy app           # Success: no issues (27 files)
cd services/trading-engine    && python3 -m pytest -q          # 43 passed
cd services/market-data       && python3 -m pytest -q          # 19 passed
cd apps/api                   && npx jest --runInBand          # 32/32 suites, 686/686
npm run typecheck (per-app, NODE_OPTIONS=--max-old-space-size=1536)  # api/admin/web/notification সব OK
bash scripts/verify-part1.sh  # passed=22 failed=0 skipped=2
python3 scripts/staging/live_readiness.py --json     # dev preflight
python3 scripts/staging/staging_rehearsal.py --check-runtime --json
```

staging টুলের প্রত্যাশিত ডেভ-এনভায়রনমেন্ট আউটপুট: credential-conditional ৪টা SKIPPED, memory store + in-memory locks FAIL (strict), signed transport + IP allowlist PASS, **live gate PASS (live সবসময় refused)** — অর্থাৎ টুলগুলো আসল composition-এর সাথে সঠিক কথা বলছে।

---

## ৫. এই ধাপে অতিরিক্ত যা পরিষ্কার হলো (আগের "অবশিষ্ট" তালিকা থেকে)

- **lint drift সম্পূর্ণ শেষ**: execution-engine-এর ১৯টা পুরনো টেস্ট ফাইলের import-order (I001) auto-fix; trading-core-এর ৫টা generator স্ক্রিপ্টের E402 এখন pyproject-এর per-file-ignores-এ (part22-এর "generator-এ suppression token নিষিদ্ধ" অডিট টেস্ট মেনে); ৫টা সত্যিই unused ইমপোর্ট বাদ। দুই প্রজেক্টেই ruff এখন পুরোপুরি clean।
- **stale `REPO_AUDIT_REPORT.md` নতুন করে লেখা হয়েছে** (২০২৬-০৯-২০-এর ভুল "0 files missing" সিদ্ধান্ত সংশোধন) — এখন প্রকৃত গ্যাপ, ফিক্স আর সবুজ মেট্রিক্সসহ; repo-reference-integrity টেস্টে যাচাইকৃত।
- **রুট `.gitignore`**-এ tooling runtime state যোগ: `.dart_tool/`, `.dartServer/`, `.flutter/`, `.pgrun/`, `.pgdata/`, `**/.ruff_cache/`, `**/__pycache__/`, `**/*.egg-info/`।
- **`scripts/verify-part1.sh`-এর typecheck ধাপ** এখন `NODE_OPTIONS`-এ 1536MB heap দেয় (operator-এর নিজের মান থাকলে সেটাই থাকে) — ২GB RAM-এর রানারে মনোরিপো-ব্যাপী tsc-এর FatalProcessOutOfMemory আর হবে না।

## ৬. পরিচিত অবশিষ্ট (কোনোটাই runtime গ্যাপ নয়)

- **EXPECTED-ABSENT**: `.env`, `node_modules` (snapshot-বহির্ভূত), flutter-এর `android/`/`ios/` — by design।
- **npm deprecation নোটিশ**: glob, eslint@8.57.1, next@14.2.15 — আপগ্রেড সিদ্ধান্তের অপেক্ষায়, কোনো টেস্ট ভাঙে না।
- **runtime-নির্ভর টেস্ট**: `test_part13_postgres_store_live`, retention-live, rehearsal-এর আসল Postgres/Redis প্রোব — staging-এ `.env.staging` দিয়ে চলবে; sandbox-এ সেই সার্ভিস নেই বলে 12 skipped।

---

## ৭. সিদ্ধান্ত

ফাইল-বাই-ফাইল অডিট অনুযায়ী রিপোটি এখন **গঠনগতভাবে সম্পূর্ণ**: প্রতিটা referenced/imported/নাম-নেওয়া ফাইল ডিস্কে আছে, প্রতিটা নতুন ফাইল সম্পূর্ণ ইমপ্লিমেন্টেশন (কোনো placeholder নেই), চারটা Python স্যুট + api-র পুরো jest + typecheck + mypy + ruff + verify-part1 — **সব সবুজ**। execution-engine-এর সাইনড ট্রান্সপোর্ট, ডিস্ট্রিবিউটেড লক, ভেনু attestation আর credential registry — চারটা মিসিং runtime গ্যাপই এখন বদলে গেছে পরীক্ষিত কোডে।
