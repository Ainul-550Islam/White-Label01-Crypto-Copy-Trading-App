# Part 7 — Historical market-data infrastructure

> **BACKTEST PERFORMANCE IS NOT INDICATIVE OF FUTURE PERFORMANCE.**
> **PAPER PERFORMANCE IS NOT INDICATIVE OF LIVE PERFORMANCE.**
> **SIMULATION DOES NOT GUARANTEE REAL EXECUTION QUALITY.**
>
> A dataset being VALID says its bytes are internally consistent and
> verifiable. It says nothing about whether anything recorded in them will
> ever happen again.

Part 7 gives the Part 6 backtest engine a *provenance*. Before this part a
backtest consumed a caller-supplied, in-memory event list with an optional
descriptor; from here, a run can be bound to a persisted, checksummed,
validated, versioned dataset — and the result carries exactly which one.

---

## 1. Parts 1–6 architecture summary (what Part 7 plugs into)

| Part | Delivered | Part 7's dependency on it |
|---|---|---|
| 1 | Monorepo, NestJS API, Prisma/Postgres, Redis queues, RBAC multi-tenancy, FastAPI skeletons | Registry tables, permissions, audit, queue jobs |
| 2 | Canonical models: `MarketEvent` inputs (`Ticker`, `PublicTrade`, `OrderBookSnapshot`, `OrderBookDelta`, `Candle`), Decimal discipline, enums | The dataset format *is* these models — no parallel event types |
| 3 | Connectivity: feed lag, order-book sync, `EVENT_KIND_ORDER` semantics | Provenance vocabulary only; the historical path imports no networking code |
| 4 | Live transport (optional extra), signed client (execution-only) | Deliberately not imported — a machine-checked test asserts it |
| 5 | Execution boundary: risk → OMS → venue, five live gates | Untouched. No Part 7 file can reach it; no route was added near it |
| 6 | Strategy layer, `ReplayEngine`, `HistoricalDataset`, `DatasetDescriptor`, config-hash reproducibility, simulated execution, paper sessions | The authoritative consumer: Part 7 *produces* `HistoricalDataset`s and does not fork replay |

## 2. What Part 7 adds

`libs/trading-core/wlct_trading/datasets/` — a new package, eleven modules:

* `schema.py` — the canonical line format (versioned JSON Lines), strict both
  directions, floats refused structurally;
* `identity.py` — the derived dataset key: a SHA-256 of the dataset's
  **contract**, never a random UUID;
* `manifest.py` — the manifest: identity, window, counts, per-file receipts,
  validation summary, schema versions; byte-canonical and self-verifying;
* `validation.py` — the streaming validator: 19 rules, four severities,
  policy-hashed, **zero repair**;
* `quality.py` — the twelve-figure quality report every version carries;
* `storage/base.py`, `storage/local.py` — the storage abstraction and the
  local backend (path safety, staging, atomic finalisation, no symlink
  traversal, 0o600 files);
* `readers/streaming.py` — the bounded reader: chunked gzip with a bomb
  ceiling, manifest-driven partition selection, deterministic k-way merge;
* `ingestion/` — `base.py` (source ABC: plan/stream/describe), `binance.py`
  (public vision archive: aggTrades + 1m klines), `local.py` (offline
  JSONL source), `pipeline.py` (staging → write → validate → atomic publish
  → resume-safe);
* `registry.py` — the file-side registry: versions, coverage, integrity
  re-verification, status transitions;
* `replay/source.py` — the bridge: dataset version → Part 6
  `HistoricalDataset`, with the validity gate and the full-window checksum
  recheck;
* `cli.py` — operator commands: `ingest-local`, `ingest-binance` (explicit
  network flag), `list`, `info`, `validate`, `coverage`, `replay`,
  `backtest`, `quarantine`, `archive`, `--emit-registration`.

Plus: five test suites (124 new Python tests), Prisma registry tables +
migration, the `datasets` API module (registry reads, job dispatch,
lifecycle commands, guarded metadata registration), environment
configuration with strict validation, the read-only admin console page, and
an operator-only live smoke script.

## 3. Exact integration points

1. **Canonical events.** `wlct_trading.datasets` reuses
   `backtest.dataset.MarketEvent` and the `market_data` payloads. There is
   no `DatasetEvent` class. The replay ordering is Part 6's
   `ordering_key`, extended by exactly two documented tie-breakers
   (`merge_sort_key`: symbol, then manifest partition position).
2. **Replay.** `replay/source.py::load_for_backtest` materialises a window
   into `HistoricalDataset.from_events(...)` — the same constructor the in-
   memory tests call. `BacktestEngine(strategy, dataset, config)` runs it
   unchanged. The bridge refuses (never repairs) on: non-VALID status,
   symbol/exchange scope, window disagreement with the manifest, caller
   checksum disagreement, and any full-window materialisation whose
   recomputed checksum differs from the manifest's.
3. **Reproducibility.** `DatasetDescriptor.dataset_id` becomes
   `hst-<key>@v<version>` and `checksum` becomes the manifest content
   checksum — both already flow into `compute_configuration_hash` through
   `canonical_form()`. **The Part 6 hash function is unchanged**; feeding it
   registry-backed descriptors is all it needed. `BacktestResult.dataset.to_dict()`
   now carries `versionId` end-to-end.
4. **API.** `SubmitBacktestDto` gains `datasetVersionId` (UUID);
   `BacktestService.submit()` resolves it against the registry (must exist,
   must be `VALID`, venue/symbol must match, caller-supplied checksum/id
   must agree) and, with `BACKTEST_DATASET_REQUIRED=true` (the default),
   *refuses* submissions that omit it. The run row stores
   `datasetVersionId` and the canonical `datasetId`; the job payload carries
   the pin so the worker re-verifies.
5. **Queues.** New `dataset-control` queue (jobs `ingest-historical-dataset`,
   `validate-dataset-version`, `sync-dataset-status`) — separate from
   `strategy-control` so a backfill cannot delay a strategy command, and
   from `trade-execution` because it must never be able to delay, or
   resemble, anything that can move money.
6. **What meets nothing:** the paper session constructor takes a
   `TradingAdapter`; a dataset bundle is not one and cannot become one (no
   `is_simulated`, no submit, no import edge — all three are tested).

## 4. Dataset lifecycle

```
CREATED ── ingest job ──▶ INGESTING ── write done ──▶ VALIDATING
   VALIDATING ─ verdict clean ──▶ VALID            (immutable payload from here)
   VALIDATING ─ verdict ERROR/FATAL ──▶ INVALID    (evidence preserved in staging)
   VALID ── operator ──▶ QUARANTINED ── operator ──▶ ARCHIVED
   INVALID ── operator ──▶ QUARANTINED
   ARCHIVED is terminal.
```

The API-side transition table (`datasets.constants`) is asserted — by the
jest spec — to be a **subset of** the Python registry's table, parsed from
its source. The API can offer *less* than the file layer, never more; a
transition the file layer refuses can never be initiated through HTTP.

A **validated version's payload never changes**: the storage class has no
method that rewrites a published file, `finalize_staging` refuses an existing
version unless it is QUARANTINED *and* `replace=True` *and* the evidence copy
is preserved, and the registry's registration upsert 409s on
same-(key,version)-different-checksum.

## 5. Ingestion lifecycle

```
plan(source.discover) → stage per file: stream → normalise → bounded gzip
  → per-part sha256 → .done marker            (resume checkpoint)
→ merge pass: re-read staging in REPLAY ORDER
  → content checksum = events_digest(checksum_source lines)
  → validator.observe each event (findings, never mutations)
→ manifest + report + quality written INTO STAGING
→ verdict VALID?  ── no ─▶ quarantine staging (failure.json kept) ─▶ raise
              yes ▼
finalize_staging = one atomic directory rename into the visible tree
→ registry registration (metadata only) → status rollup
```

Failed ingestion **cannot** mark anything VALID: the version directory does
not exist until the rename, and the rename only happens on a VALID verdict.
Crash mid-write leaves a staging area with a `.done` marker per completed
partition; resume re-verifies every marker's recorded part digests before
reusing them — a truncated part is rewritten from the source, and the
finalised dataset is then byte-identical to an uninterrupted run (tested).
Raw venue text is retained only with `retain_raw`, beside the canonical tree
and excluded from every checksum.

## 6. Validation lifecycle

One pass, one stream: the exact order a reader would produce. The 19 rules
(`VALIDATION_RULES`, public, enumerated by the admin surface):

| Class | Rules | Default severity |
|---|---|---|
| ordering | `TIMESTAMP_NOT_MONOTONIC` | ERROR |
| duplication | `DUPLICATE_EVENT` (adjacency + bounded global trade-id set), `DUPLICATE_SCAN_TRUNCATED` | ERROR / INFO |
| values | `NEGATIVE_PRICE`, `NEGATIVE_QUANTITY`, `ZERO_QUANTITY_PRINT`, `CANDLE_RANGE_INCONSISTENT` | ERROR |
| book integrity | `BOOK_SEQUENCE_GAP` (FATAL: the chain, not the kind, defines continuity), `BOOK_SEQUENCE_REPLAY`, `CROSSED_BOOK`, `LOCKED_BOOK`, `BOOK_LEVELS_UNORDERED`, `UNRELIABLE_RANGE` | FATAL / WARN / ERROR / WARN / WARN / WARN |
| scope | `SYMBOL_MISMATCH`, `EXCHANGE_MISMATCH`, `EVENT_KIND_UNDECLARED`, `FORMAT_ERROR` | FATAL |
| gaps | `TIMESTAMP_GAP` (per-kind policy; absent policy = no cadence assumption), `DATE_GAP` (interior holes in the claimed calendar) | WARNING |

`ValidationPolicy` overrides severities per rule, sets `reject_at`
(WARNING/ERROR/FATAL — the default ERROR means warnings never block), caps
retained findings (counts stay exact — a capped report never understates the
dataset), and bounds duplicate memory with an explicit truncation finding.
The policy is hashed (`policyDigest`) into the manifest: "validated under a
lenient policy" and "validated under the default" can never share a
fingerprint. A dataset whose book chain went FATAL has its affected range
marked `UNRELIABLE_RANGE` (open until the next snapshot) — it is reported,
not rebuilt, because a book with a hole in the middle has exactly one
correct recovery: the next real snapshot.

## 7. Storage architecture

```
<DATASET_LOCAL_ROOT>/
  hst-<32hex>/                       ← derived key only; pattern-validated
    v1/
      manifest.json                  ← written last in staging, lands via rename
      status.json                    ← quarantine/archive stamps (never rewrites payload)
      report.json · quality.json
      data/<SYMBOL>/<KIND>/<DATE>/part0000.jsonl.gz
      raw/<SYMBOL>/<KIND>/<DATE>.txt.gz        (retain_raw only; never checksummed)
<DATASET_TEMP_ROOT>/
  <job-key>/                          ← disjoint from the root, same filesystem
    .done/<SYMBOL>/<KIND>/<DATE>.json ← resume receipts (digests per part)
    failure.json                      ← quarantine evidence
```

Path safety is three-layered and tested: the key must match
`^hst-[0-9a-f]{32}$`; relative paths are component-checked (no `..`, `""`,
`.`, `\`, control chars, absolute); every join passes a containment check
that rejects **any symlinked component** mid-chain — `O_NOFOLLOW` alone
guards only the final segment, and the test suite plants a symlink to prove
the gap is closed. Writes are `O_EXCL` 0o600 with fsync; the manifest is the
visibility switch; `st_dev` is compared before the rename — cross-device
staging is a startup refusal, not a silent copy. An `OBJECT_STORAGE` backend
implements the same abstract class; no other module needs to know.

## 8. Replay architecture (ordering, windows, no look-ahead)

* **Selection**: manifest entries sorted by `(symbol, kind, first ts, path)`
  — the manifest defines partition order, never the filesystem; a scan
  proves re-reading the same manifest on any machine merges identically.
* **Windows**: partitions entirely outside `[start, end]` are never opened
  (stats prove the skip); inside them, events outside the window are never
  yielded — and a partition retired past its end is **still drained and
  digest-checked** when `verify_checksums` is on, because a flag that
  silently means "only at EOF" is a flag that lies.
* **Memory**: one chunk per partition inflight, a `zlib` decompressobj with
  an expansion ceiling of 64× the recorded size, one event per partition
  retained in the heap. A 4 GiB dataset replays on a laptop.
* **Deterministic multi-symbol**: `merge_sort_key = (ts, EVENT_KIND_ORDER,
  sequence, symbol, position)` — the first three are Part 6's total order,
  reused verbatim (one definition of replay order exists in this repository);
  ties resolve by symbol then manifest position, exactly as documented and
  pinned by test.
* **No look-ahead**: the generator materialises only the next line of each
  partition; `ReplayCursor`'s clock filter (Part 6) plus the bridge's
  refusal to hand out the raw list mean a consumer cannot observe an event
  earlier than it is delivered. The integration test asserts the merged
  stream's monotonicity and the cursor's look-ahead refusal.
* **Validity gate**: `load_for_backtest` refuses non-VALID versions unless
  `override_reason` is a written string; the reason — and the version's
  status — are stamped into `descriptor.notes`, which every stored result
  echoes. `version=None` resolves "latest VALID" *at submission time* and
  the resolved `key@vN` is what the run stores and hashes: latest is a
  query, never a foreign key.

## 9. Backtest integration

`POST /strategies/backtests` accepts `datasetVersionId`. The service:

1. requires it when `BACKTEST_DATASET_REQUIRED` (default true);
2. loads the version, requires status `VALID`, venue and symbol match;
3. cross-checks `datasetChecksum` against the version's content checksum and
   `datasetId` against the canonical `key@vN` — disagreement is refused, not
   corrected;
4. stores `datasetVersionId` on the run (+ index), derives the dataset label
   and checksum from the registry row, marks `isReproducible` from the
   registry's checksum rather than the client's claim;
5. passes the pin in the job payload so the worker re-loads *that version*
   through `load_for_backtest(expected_checksum=...)` and re-verifies the
   full-window checksum equality before running.

Results already serialise `dataset` — Part 7 widens `BacktestDatasetView`
with `versionId`; `BacktestResult` gained no new field and lost none, so
Part 6 result handling is byte-compatible.

## 10. Dataset immutability model

Immutability is architectural, not advisory, at four independent levels:

* **files** — published version directories are rewritten by nothing: the
  storage class exposes writes only to staging and to `status.json`;
* **metadata** — registration is insert-or-idempotent-409; a lifecycle
  action updates status columns only;
* **identity** — the key is recomputed from the stored identity block on
  every parse; an edited manifest fails its own parse ("re-derived key does
  not match");
* **replay** — checksum re-verification (manifest vs disk at finalisation,
  recorded vs recomputed at materialisation) means even out-of-band
  tampering — the failure mode all the above assume away — is caught before
  a result is produced, and the catch message tells the operator to
  quarantine the version.

The content checksum is deliberately Part 6's *event-level* semantics, not
file bytes: re-gzipping a dataset (new compression level, different chunk
boundary) leaves the identity — and every backtest result citing it —
untouched, because the market data is the dataset, not its container.

## 11. Updated directory tree (Part 7 additions only)

```
libs/trading-core/wlct_trading/datasets/
├── __init__.py            package surface; importable, never re-exported by wlct_trading
├── schema.py              CANONICAL_SCHEMA_VERSION, line codec, DatasetFormatError
├── identity.py            DatasetIdentity, build_dataset_key, events_digest
├── manifest.py            DatasetManifest + DatasetFileEntry + ManifestValidationSummary
├── validation.py          DatasetValidator, ValidationPolicy, 19 rules
├── quality.py             QualityReport
├── registry.py            DatasetRegistry (file side), status transitions
├── cli.py                 operator CLI (offline by default)
├── storage/ __init__ · base.py · local.py
├── readers/ __init__ · streaming.py
├── ingestion/ __init__ · base.py · binance.py · local.py · pipeline.py
└── replay/    __init__ · source.py
apps/api/src/modules/datasets/
├── datasets.types.ts · datasets.constants.ts · datasets.mapper.ts
├── dto/datasets.dto.ts
├── dataset-registry.service.ts · dataset-ingestion.service.ts · dataset-lifecycle.service.ts
├── datasets.controller.ts · datasets.module.ts
└── datasets-safety.spec.ts   (24 tests)
apps/api/prisma/migrations/20260911120000_part7_historical_datasets/
scripts/live_historical_ingestion_smoke.py
tests/  test_datasets_manifest.py · test_datasets_validation.py ·
        test_datasets_storage_reader.py · test_datasets_pipeline.py ·
        test_datasets_replay_integration.py
```

## 12. New files

Python (24): `datasets` package as above (14 modules), 5 test files, 1
smoke script. TypeScript (9): the `datasets` module. Admin (1): the
datasets page. Prisma (2): migration directory + SQL. Docs (2): this file,
the full-source handover.

## 13. Modified files

* `wlct_trading/enums.py` — five Part 7 enums appended (`DatasetStatus`
  etc.) with the usual wire-value contract; no existing member changed;
* `wlct_trading/metrics.py` — `DATASET_STAGES`, `DatasetCounters`,
  `DatasetMetrics`; the same "observations, not guarantees" note;
* `libs/trading-core/pyproject.toml` — nothing added to dependencies:
  the datasets package is **stdlib-only**, matching the library's founding
  constraint (parquet was evaluated and rejected; see the schema docstring);
* `packages/shared-types/src/rbac.ts` / `audit.ts` — 5 permissions
  (`dataset:read|ingest|validate|quarantine|archive`; ingest + archive are
  non-wildcard; quarantine deliberately is not), 5 audit actions;
* `packages/config/src/constants.ts` — `DATASET_CONTROL` queue + 3 jobs;
* `packages/config/src/env.schema.ts` — 11 validated keys + superRefines
  (root disjointness, production absoluteness, sizing bounds);
* `apps/api/src/config/app-config.service.ts` — dataset getters +
  `datasetSafetySummary`;
* `apps/api/prisma/schema.prisma` — 6 enums, 5 models, `BacktestRun` gains
  nullable `datasetVersionId` + index + FK;
* `apps/api/src/modules/strategy/{backtest.service.ts, strategy.mapper.ts,
  strategy.types.ts, dto/strategy.dto.ts, strategy-safety.spec.ts}` — the
  version pin (Section 9);
* `apps/api/src/app.module.ts` — `DatasetsModule` (not global, exports
  nothing, like every sibling module);
* `apps/admin-web/src/components/sidebar.tsx` — one nav entry (usability
  filter only);
* `.env.example` — the documented Part 7 section.

Mobile: **nothing.** The spec is honoured literally — datasets are not
exposed to mobile at all; the read-only strategies screen continues to show
backtest metadata including the new `versionId` field as part of the
existing dataset view it already renders. No new mobile capability.

## 14. Database changes

Migration `20260911120000_part7_historical_datasets` — **additive only**
(six `CREATE TYPE` families, five `CREATE TABLE`s, one `ADD COLUMN`, one
index, four `ADD CONSTRAINT`s; verified zero `DROP/TRUNCATE/UPDATE`).
Tables: `historical_datasets` (derived-key-unique, contract fields),
`historical_dataset_versions` (`(dataset_id, version)` unique;
content/manifest checksums indexed; manifest JSON),
`historical_dataset_files` (`(version_id, partition_path)` unique; per-file
digests + windows), `historical_dataset_validations`,
`dataset_ingestion_runs` (unique `staging_key`). Indexes on venue/market/
status, windows, checksums and versions. **No tenantId column** — with the
reason in the schema comment: this is public market data, and a column
implying isolation the data does not have is worse than none; access is
gated by permission, every mutation is audited with the actor's tenant.
Postgres holds no event rows, ever — stated in the section header so the
next contributor does not "helpfully" add an `events` table.

## 15. Configuration changes

Eleven keys (defaults and validation summarized above; full comments in
`.env.example`): `DATASET_STORAGE_BACKEND=local` (only accepted value),
`DATASET_LOCAL_ROOT`, `DATASET_TEMP_ROOT` (disjoint, production-absolute),
`DATASET_MAX_PARTITION_BYTES` (1 MiB–4 GiB), `DATASET_READER_BUFFER_SIZE`
(4 KiB–64 MiB), `DATASET_VALIDATION_ENABLED=true`,
`DATASET_MAX_GAP_WARNINGS`, `DATASET_MAX_EVENTS_PER_PARTITION`,
`DATASET_RETENTION_POLICY=retain|purge_staging_only` (staging only — never
evidence), `HISTORICAL_INGESTION_ENABLED=false`,
`BACKTEST_DATASET_REQUIRED=true`. **Historical ingestion is never silently
on**: the default is off, and no combination of the other ten turns it on.

## 16. Test plan → suites

| # | Mandated case | Where |
|---|---|---|
| 1 | manifest generation | `test_datasets_manifest.py` (byte-stable, round-trip, internal-agreement) |
| 2 | dataset-id determinism | same file: same-inputs, every-distinguishing-input, sorted symbols |
| 3 | checksum calculation | same file + storage-reader suite (digest vs tamper) |
| 4 | version immutability | `test_datasets_pipeline.py` (re-finalise refused; new-version; replace-guard) |
| 5 | timestamp validation | `test_datasets_validation.py` (backwards, equal-ts legality) |
| 6 | duplicate detection | same file (adjacent, global, bounded-memory truncation, no repair) |
| 7, 8 | invalid prices/quantities | same file |
| 9 | sequence-gap detection | same file (FATAL + unreliable range open→snapshot-closed) |
| 10 | crossed book | same file (snapshot + post-delta + locked warning level) |
| 11 | symbol/exchange/kind mismatch | same file |
| 12 | status transitions | `test_datasets_pipeline.py` + jest parity test (Python table parsed from source) |
| 13 | quarantine behaviour | `test_datasets_pipeline.py` (evidence kept; manifest-bound status) |
| 14 | local storage path safety | `test_datasets_storage_reader.py` (traversal shapes, symlink mid-chain, modes, key/version shapes) |
| 15 | streaming reader | same file (small-buffer equality, memory bound, tamper) |
| 16 | range filtering | same file (partition skip + line-level window) |
| 17 | multi-symbol ordering | same file |
| 18 | equal-timestamp deterministic ordering | same file (symbol before position) |
| 19 | replay integration with Part 6 | `test_datasets_replay_integration.py` (engine accepts; persisted run matches in-memory trade-for-trade) |
| 20 | no look-ahead | same file (cursor monotonicity + refusal) |
| 21 | checksum preserved in result | same file (`result.dataset.checksum == manifest`, `@v1` id, config-hash inclusion) |
| 22 | failed ingestion never VALID | `test_datasets_pipeline.py` (crash mid-stream publishes nothing) |
| 23 | resume after failure | same file (reuse + re-verification + checksum equality with uninterrupted run) |
| 24 | atomic finalization | same file (no manifest ⇒ no version; finalize refuses manifestless staging) |
| 25 | invalid dataset blocked from normal backtest | `test_datasets_replay_integration.py` (quarantine gate, override requires reason, checksum refusal, tamper recheck) |
| 26 | paper cannot consume datasets as live source | same file (`PaperTradingSession` refuses a bundle; datasets package imports no execution/adapter/transport module — source-verified both in Python and jest) |
| 27 | Parts 1–6 still pass | the gates below (758 Python incl. all prior 634; 71 jest incl. all prior 47; lint/typecheck/mypy/prisma/flutter) |

Additional beyond the list: decompression-bomb ceiling, gzip determinism
(`mtime=0` — a byte-identical re-ingest reproduces the same file digest),
credential-shape refusal at identity/manifest/DTO/constraint levels,
transition-table parity, request-credential scan before the queue, window
sanity ceiling (year-2100), 366-day span bound, in-flight-rollup race
refusal.

---

## Commands

### OFFLINE SAFE TESTS — no network, no credentials, no orders

```bash
# Dependencies
npm install
cd libs/trading-core && python3 -m pip install -e ".[dev]" && cd -

# Shared packages and the Prisma client (typecheck depends on the client)
npm run build:packages
./node_modules/.bin/prisma generate --schema apps/api/prisma/schema.prisma

# Lint and type gates
npm run lint
npm run lint --workspace=@wlct/admin-web
npm run typecheck
cd libs/trading-core && python3 -m ruff check wlct_trading tests && cd -
cd libs/trading-core && python3 -m mypy wlct_trading && cd -

# Everything
cd libs/trading-core && python3 -m pytest tests/ -q          # 758 passed
npm test                                                       # 71 passed

# Part 7 by area
cd libs/trading-core && python3 -m pytest tests/test_datasets_manifest.py -q
cd libs/trading-core && python3 -m pytest tests/test_datasets_validation.py -q
cd libs/trading-core && python3 -m pytest tests/test_datasets_storage_reader.py -q
cd libs/trading-core && python3 -m pytest tests/test_datasets_pipeline.py -q
cd libs/trading-core && python3 -m pytest tests/test_datasets_replay_integration.py -q

# The two Part 7 crown-jewel cases by name
cd libs/trading-core && python3 -m pytest -q tests/test_datasets_replay_integration.py::TestReplayIntegration::test_bridged_run_matches_the_in_memory_run
cd libs/trading-core && python3 -m pytest -q tests/test_datasets_pipeline.py::TestResumeAndAtomicity
cd libs/trading-core && python3 -m pytest -q tests/test_datasets_replay_integration.py::TestPaperAndLiveIsolation

# Mobile gates (no Part 7 change; proven green as part of the release)
cd apps/mobile && flutter pub get && flutter analyze && flutter test && cd -
```

### DATABASE

```bash
# Inspect first: additive only, one nullable column on backtest_runs.
grep -E "^DROP|^ALTER TABLE .* (DROP|RENAME)" \
  apps/api/prisma/migrations/20260911120000_part7_historical_datasets/migration.sql \
  || echo 'additive only'

./node_modules/.bin/prisma migrate deploy --schema apps/api/prisma/schema.prisma
./node_modules/.bin/prisma validate --schema apps/api/prisma/schema.prisma
./node_modules/.bin/prisma migrate status --schema apps/api/prisma/schema.prisma
```

### DATASET OPERATIONS (offline: local source)

```bash
cd libs/trading-core

# Ingest a directory of canonical JSONL into the registry layout
python3 -m wlct_trading.datasets.cli \
  --datasets-root ./data/datasets --staging-root ./data/staging \
  ingest-local --input ./fixtures/coins \
  --name "BTC trades" --symbol BTC-USDT --kind TRADE \
  --job-key operator-1 --start 1700000000000000 --end 1700086400000000 \
  --emit-registration ./registration.json

# List, inspect, re-validate (re-hashes files, re-runs the validator)
python3 -m wlct_trading.datasets.cli list
python3 -m wlct_trading.datasets.cli info hst-<key> 1
python3 -m wlct_trading.datasets.cli validate hst-<key> 1
python3 -m wlct_trading.datasets.cli coverage --symbol BTC-USDT

# Replay a window (reader stats, no strategy) and run a backtest over it.
# `backtest` runs the engine TWICE and fails (exit 1) unless the results are
# byte-identical: reproducibility is asserted before numbers are printed.
python3 -m wlct_trading.datasets.cli replay hst-<key> --symbol BTC-USDT \
  --start 1700000000000000 --end 1700086400000000
python3 -m wlct_trading.datasets.cli backtest hst-<key> --symbol BTC-USDT

# Withdraw / archive (typed confirmation; never deletes payload)
python3 -m wlct_trading.datasets.cli quarantine hst-<key> 1 --reason "suspected venue gap"
python3 -m wlct_trading.datasets.cli archive hst-<key> 1 --reason "evidence exported" \
  --confirm "ARCHIVE DATASET VERSION"
```

### PAPER / LIVE MARKET DATA — real public archive download, still no orders

```bash
# Operator-only live smoke (explicit flag; public data; no credentials exist
# for this path; refuses to run otherwise; NEVER places an order):
python3 scripts/live_historical_ingestion_smoke.py --i-understand-this-downloads --days-back 4

# CLI network ingestion requires the same named confirmation:
python3 -m wlct_trading.datasets.cli --datasets-root /srv/wlct/datasets \
  --staging-root /srv/wlct/staging ingest-binance --name "BTC jan" \
  --symbol BTC-USDT --kind TRADE --job-key ops-2026-09-11 \
  --start 2026-01-05T00:00:00Z --end 2026-01-06T00:00:00Z --yes-network

# Paper trading remains exactly the Part 6 command; historical data plays no
# part in it, by construction:
STRATEGY_ENGINE_ENABLED=true PAPER_TRADING_ENABLED=true PAPER_TRADING=true \
LIVE_TRADING_ENABLED=false npm run dev:trading-engine
```

### LIVE EXECUTION — this section enables nothing

```bash
# Part 7 adds no live-execution surface. Verify that claim from the repo:

# 1. No dataset module imports any execution/adapter/transport module.
cd libs/trading-core && python3 - <<'PY'
import pathlib
bad = []
for path in pathlib.Path("wlct_trading/datasets").rglob("*.py"):
    for line in path.read_text().splitlines():
        if line.startswith(("import ", "from ")) and any(
            token in line for token in ("wlct_trading.net", "wlct_trading.execution",
                                        "wlct_trading.adapters", "wlct_trading.exchanges")
        ):
            bad.append(f"{path}: {line}")
print("live-path imports in datasets:", bad or "NONE")
raise SystemExit(1 if bad else 0)
PY
cd -

# 2. The API datasets module references neither execution module nor its queue.
grep -rnE "modules/execution|TRADE_EXECUTION|placeOrder|submit_order" \
  apps/api/src/modules/datasets/ && echo FOUND || echo "NONE - boundary holds"

# 3. The live harness still refuses unarmed execution (Part 5 contract intact).
python3 scripts/live_execution_smoke_test.py --testnet ; echo "exit=$?  (expect 2)"
```

---

## What Part 7 deliberately does not include

* object-storage *implementation* (the abstraction is here; S3/MinIO/GCS/Azure
  is a new module with its own review);
* order-book archives from Binance (they do not exist — the adapter says so
  instead of faking books from candles; book datasets arrive via stream
  capture);
* automatic retention sweeps; the retention policy never deletes evidence;
* backtest *optimisation*;
* a mobile dataset surface, and any way for anything user-facing to fetch a
  payload through the API;
* resumable *object-store multipart* semantics for ingestion (the resume
  story is per-partition file writes, which is what the local backend needs
  and what the pipeline's design does not preclude extending).
