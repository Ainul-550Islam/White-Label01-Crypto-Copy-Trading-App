"""One-shot generator for docs/PART11_HANDOVER_FULL_SOURCE.md.

Runs from anywhere. Every path listed below is emitted COMPLETE - the entire
final file, no diffs, no elisions - because the standing handover rule says a
reader must be able to reconstruct the repository from the document. The
Part 10 baseline for comparison lives in docs/PART10_HANDOVER_FULL_SOURCE.md.

The generator additionally AUDITS its own emission: placeholder-elision
tokens are refused in every file, and suppression tokens are refused in every
NEW file (modified files may legitimately carry pre-existing, justified
suppressions - e.g. services' `# noqa: BLE001` probe guards, preserved
verbatim). A file that fails the audit fails the build, loudly, naming the
token and the file.
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Final

ROOT = (
    Path(__file__).resolve().parents[1]
    if "__file__" in globals()
    else Path("/home/user/whitelabel-copytrade")
)
OUT = ROOT / "docs" / "PART11_HANDOVER_FULL_SOURCE.md"

NEW: Final[list[tuple[str, str]]] = [
    # --- coordination foundation: Python ---------------------------------
    (
        "libs/trading-core/wlct_trading/coordination/__init__.py",
        "package barrel: the pure coordination law exported for both the engine and the worker plane.",
    ),
    (
        "libs/trading-core/wlct_trading/coordination/partitions.py",
        "rendezvous hashing over crc32: partition_for, partition_owner, assignment, owns, moved_by_membership; member grammar, duplicate refusal, the 4096 ceiling, order-insensitivity.",
    ),
    (
        "libs/trading-core/wlct_trading/coordination/lease.py",
        "the renewal law (renew_due_micros, fixture-pinned arm by arm), LeaderElector (half-TTL, renew_if_due, demotion accounting), PartitionClaims and the compare-and-renew/release Lua scripts.",
    ),
    (
        "libs/trading-core/tests/test_part11_coordination.py",
        "the foundation suite: 64 tests - timing-law branches, the elector loss/theft/re-promotion matrix, RedisLockManager coverage, the authorization-boundary AST scan, the committed CRC tie-break pair.",
    ),
    (
        "libs/trading-core/tests/test_part11_observe_only.py",
        "the money-path observe-only invariant: cancel verdicts, store state, events and incident counts identical with the publisher absent, present, or exploding; the exploding-tracer tripwire.",
    ),
    (
        "libs/trading-core/scripts/gen_part11_fixtures.py",
        "deterministic fixture generator for the cross-language oracle (including the generator-side verification of the committed tie-break pair).",
    ),
    (
        "docs/fixtures/coordination_fixtures.json",
        "the shared oracle consumed by BOTH suites: crc32 vectors, partition assignments and rejects, the renew-due truth table and its rejects, script texts + sha256, verbatim error strings, defaults.",
    ),
    # --- coordination foundation: TypeScript mirror -----------------------
    (
        "apps/api/src/infrastructure/coordination/crc32.ts",
        "IEEE crc32 (table-driven) over UTF-8 bytes - the exact numeric twin of zlib.crc32 the fixtures pin.",
    ),
    (
        "apps/api/src/infrastructure/coordination/partitions.ts",
        "the TypeScript mirror of the partition math: same grammar, same refusals, verbatim error strings.",
    ),
    (
        "apps/api/src/infrastructure/coordination/lease.ts",
        "renewDueMicros (bigint micros, same eight arms), LeaderElector with renewIfDue and forced/resigned step-down accounting, PartitionClaims, the byte-identical Lua constants, transport failure as recorded deferral - never a throw from the job path.",
    ),
    (
        "apps/api/src/infrastructure/coordination/ioredis-adapter.ts",
        "the production CoordinationRedis port over ioredis: SET arg order, one-key EVAL contract, nothing else - a three-lines-per-method lie detector.",
    ),
    (
        "apps/api/src/infrastructure/coordination/coordination.spec.ts",
        "24 jest tests: fixture replay (rows, rejects, script hashes, error strings), the tie-break law both orders, renewIfDue zero-Redis-traffic-before-due, resign-is-not-a-demotion.",
    ),
    # --- worker runtime ----------------------------------------------------
    (
        "apps/api/src/modules/worker/worker.types.ts",
        "the consumer's mirror of the producer contract: validation guards for the five TRADE_EXECUTION commands; unknown names and malformed payloads refused.",
    ),
    (
        "apps/api/src/modules/worker/engine-internal.client.ts",
        "the HTTP hop to services/execution-engine: token + tenant + correlation headers only, the retryable/terminal taxonomy, the startup compatibility gate (mode, store durability tripwire).",
    ),
    (
        "apps/api/src/modules/worker/worker-coordination.service.ts",
        "membership-as-intent, claims-as-authority: the reconcile tick, fail-closed staleness, graceful release, the bounded metric folds.",
    ),
    (
        "apps/api/src/modules/worker/trade-execution.processor.ts",
        "the TRADE_EXECUTION consumer: validate, admit by claim, serialise per account in-process, forward, ack-policy by engine answer class; deferral accounting with a visible ceiling; the queueproc SLO fold.",
    ),
    (
        "apps/api/src/modules/worker/worker.module.ts",
        "the worker module the public API never imports - the boundary is structural, not configured.",
    ),
    (
        "apps/api/src/modules/worker/worker.spec.ts",
        "21 tests over the real client and a faithful claim server: split tables, deferral (not completion) for non-owners, ceilings, terminal vs retryable, in-flight serialization, the metric families rendering.",
    ),
    (
        "apps/api/src/worker.ts",
        "the worker bootstrap: no HTTP server exists to disable; config gate, WORKER_ENABLED exit, engine gate, bounded graceful drain with the TTL fallback named honestly.",
    ),
    # --- read-replica policy ----------------------------------------------
    (
        "apps/api/src/infrastructure/database/read-policy.ts",
        "the routing law as one pure function: execution-critical never replicas, every unknown (disabled, unconfigured, unhealthy, lag null/NaN/negative, maxLag 0) fails closed to the primary or the stale-fallback arm; boundary documented at lag == max.",
    ),
    (
        "apps/api/src/infrastructure/database/read-policy.spec.ts",
        "11 tests - every arm of the table, the metric-label universe, and the log-safety of reason strings.",
    ),
    # --- ops visibility ------------------------------------------------------
    (
        "apps/api/src/modules/observability/worker-coordination-read.service.ts",
        "the read-only fleet view: one pipelined read of the claim keys (who holds each partition, TTL left, whether that matches the configured membership); an absent claim is reported as absence, never as a dead worker.",
    ),
    (
        "apps/api/src/modules/observability/worker-coordination-read.service.spec.ts",
        "5 tests: exact key composition in partition order, misalignment flagging, absent-claim honesty, null-pipeline degradation, empty-membership.",
    ),
    # --- the execution engine service --------------------------------------
    (
        "services/execution-engine/pyproject.toml",
        "tool config: ruff/mypy/pytest settings mirroring the sibling services (mypy_path resolves the core as typed source; one per-file rule relaxation for the stub-less logging base, documented in-file).",
    ),
    ("services/execution-engine/requirements.txt", "runtime pins, matching the sibling services."),
    (
        "services/execution-engine/requirements-dev.txt",
        "dev pins plus the editable core install - tests and local runs resolve wlct_trading from source.",
    ),
    (
        "services/execution-engine/.env.example",
        "the sample: required token, mode refusal, simulated venue shaping - each refusal annotated as refusal.",
    ),
    (
        "services/execution-engine/app/__init__.py",
        "the service identity and its one-paragraph law: this process holds the money path's runtime and refuses what it has not wired.",
    ),
    (
        "services/execution-engine/app/config.py",
        "validated settings: placeholder-prefixed secrets refused, the public view whitelist, decimal-shaped sim inputs checked at boot.",
    ),
    (
        "services/execution-engine/app/logging_config.py",
        "structured logging through the shared Part 9 redactor and correlation filter - the same one place policy every service delegates to.",
    ),
    (
        "services/execution-engine/app/security.py",
        "internal token (constant-time) + required tenant header + body/header divergence refused at the router boundary.",
    ),
    (
        "services/execution-engine/app/schemas.py",
        "the wire shapes: camel aliases, snake fields, extra=forbid, decimals as strings - control shapes only, no order-submission model exists.",
    ),
    (
        "services/execution-engine/app/composition.py",
        "the single composition root: real PaperTradingAdapter/PaperAccountAdapter/ReconciliationService/ExecutionEngine wired through the core's own safety assertions; live mode refused by code; SUPPORTED_COMMANDS as the one source of truth.",
    ),
    (
        "services/execution-engine/app/main.py",
        "the app factory: lifespan-built runtime (boot dies on refused wiring), correlation middleware, validation handler that names fields and never values, exception surfaces without payload leakage.",
    ),
    ("services/execution-engine/app/routers/__init__.py", "package marker."),
    (
        "services/execution-engine/app/routers/health.py",
        "liveness and a readiness document that REPORTS durability and distribution honestly (storeDurable: false is a property of the mode, not a defect to hide).",
    ),
    (
        "services/execution-engine/app/routers/internal.py",
        "the command surface: four wired commands executed against the real core (verify, balances, reconcile, cancel-through-ExecutionEngine), resync refused 501 with a reason, status for the worker's boot gate; 2xx-vs-4xx-vs-5xx as the durable-answer contract.",
    ),
    ("services/execution-engine/tests/__init__.py", "package marker."),
    (
        "services/execution-engine/tests/conftest.py",
        "environment fixtures: every test boots the real composition root; auth helpers.",
    ),
    (
        "services/execution-engine/tests/test_execution_engine.py",
        "20 tests: boot refusals, the auth boundary, validation silence on values, all four commands plus the 501, the full cancel path through the real engine into the shared store, wiring properties.",
    ),
    (
        "infrastructure/docker/execution-engine.Dockerfile",
        "the deployment image: venv build stage, non-root, loopback-default bind, healthcheck on /health, no access log (the JSON app log owns records).",
    ),
    (
        "scripts/gen_part11_rls.py",
        "the RLS artefact generator: tenant-table truth is parsed from schema.prisma (38 covered, 7 reasoned exclusions); refuses to emit on implausible parses and un-uuid tenant columns.",
    ),
    (
        "apps/api/prisma/migrations/20260913120000_part11_row_level_security/migration.sql",
        "the additive policies migration: one GUC function, one policy per covered table, ENABLE explicitly NOT here - the flip is the checklist-gated DBA step.",
    ),
    ("apps/api/prisma/rls/enable.sql", "ENABLE + FORCE per table with the pre-flight checklist (BYPASSRLS/OWNER facts) and post-enable verification queries."),
    ("apps/api/prisma/rls/disable.sql", "the exact inverse of enable.sql; rollback rehearses one file, not folklore."),
    ("apps/api/prisma/rls/rls_coverage.json", "the machine-readable covered/excluded split the drift-trap spec pins against the live schema."),
    (
        "apps/api/src/infrastructure/prisma/rls-coverage.spec.ts",
        "8 tests: schema re-derivation (a tenant model added without rerunning the generator goes red), policy-shape equality, GUC-name cross-reference between SQL and service, no-destructive-statement and not-enabled-yet checks, and the withTenantRls contract (validated UUID, SET LOCAL, bind parameter, statement order).",
    ),
    (
        "docs/dr/manifest.json",
        "the disaster-recovery plan as data: five components with keys-before-ciphertext ordering the validator enforces, per-component verification, env-name (never value) references, timed-drill criteria.",
    ),
    (
        "scripts/dr-manifest.mjs",
        "the validator/planner: path existence, env-template membership, contiguous restore orders, required components, cadence coherence and a secret-shaped-content refusal; --plan renders a deterministic, credential-free dry run.",
    ),
    (
        "scripts/dr-manifest.test.mjs",
        "node --test suite (15): the repo manifest passes, every drift class fails, plan output is deterministic and free of embedded credentials.",
    ),
    (
        "docs/DR.md",
        "the human half: the three rules, the post-restore probe SQL (doubling as RLS enablement verification), and the drill-record template a rehearsal must fill in.",
    ),
    (
        "docs/PART11_WORKER_SCALING.md",
        "the part's authoritative document: inventory, laws, ack policy, RLS and DR sections, runbook, and the gate ledger.",
    ),
    (
        "scripts/gen_part11_handover.py",
        "this generator - included, per the rule that every Part-11 file appears complete.",
    ),
]

MODIFIED: Final[list[tuple[str, str]]] = [
    (
        "libs/trading-core/wlct_trading/redis_keys.py",
        "Part 11 added the coordination key builders (leader lease + partition claim) to the platform key module; everything pre-existing is preserved verbatim.",
    ),
    (
        "packages/config/src/constants.ts",
        "added the coordination key prefixes and WORKER_COORDINATION_GROUP (named to satisfy the observability source-scan law, documented at the constant).",
    ),
    (
        "packages/config/src/env.schema.ts",
        "added the Part-11 worker/replica fields and the chained cross-field coherence superRefine (defer cadence vs renewal cadence, lease floors, the half-configured replica refusal).",
    ),
    (
        "apps/api/src/config/app-config.service.ts",
        "added the worker-plane and replica getters (plus the composed worker identity); every pre-existing getter untouched.",
    ),
    (
        "apps/api/src/infrastructure/prisma/prisma.service.ts",
        "added the replica client lifecycle, the lag probe with its 10s trust window, and routeRead - the decision function lives in read-policy.ts; Prisma only composes. Pre-existing query-logging and health behaviour preserved.",
    ),
    (
        "apps/api/src/modules/observability/metrics.registry.provider.ts",
        "added three bounded Part-11 families on the CLOSED label universe (result); the safety spec's source scan is honored, not worked around.",
    ),
    (
        "apps/api/src/modules/observability/observability.module.ts",
        "provides/exports WorkerCoordinationReadService and imports RedisModule for reading claim state only.",
    ),
    (
        "apps/api/src/modules/observability/observability.controller.ts",
        "added GET observability/worker-coordination under OPERATIONS_READ - read-only, writes nothing anywhere.",
    ),
    ("apps/api/package.json", "added the worker and worker:dev scripts."),
    (
        ".env.example",
        "appended the Part-11 section (worker plane, engine hop, replica policy) with the same refusal-annotated style.",
    ),
    (
        "docker-compose.yml",
        "added the execution-engine and worker services - no published ports on either, one token mapped to both names, dependency gates on health; every pre-existing service untouched.",
    ),
    (
        "docs/ARCHITECTURE.md",
        "added the worker-plane section (process model, ack law, replica policy) to the reliability narrative it extends.",
    ),
    (
        "docs/MULTI_TENANCY.md",
        "added the database-enforced isolation section (generation, exclusion rationale, the enable step's separation of concerns) and the sixth isolation test item; all prior sections preserved.",
    ),
    (
        "docs/ROADMAP.md",
        "delivery log rows for parts 10 and 11 and the refreshed open-items note (Part 10's row had been missed at its own delivery; corrected here).",
    ),
    (
        "docs/SECURITY.md",
        "added the Part-11 worker-plane security section and the simulated-store gap note.",
    ),
]


ELISION_TOKENS: Final[tuple[str, ...]] = (
    "# existing code",
    "// existing code",
    "... existing code",
    "rest of code",
    "implementation omitted",
    "same as above",
    "remaining code omitted",
    "add your existing code here",
    "rest of file unchanged",
    "keep existing code",
    "insert this into your existing file",
)

NEW_ONLY_TOKENS: Final[tuple[str, ...]] = (
    "TODO",
    "implement this later",
    "type: ignore",
    "noqa",
    "eslint-disable",
    "@ts-ignore",
    "@ts-expect-error",
)

#: Files that DEFINE the banned tokens as guard data and are therefore exempt
#: from the substring scan - stated, never silently skipped. This generator
#: carries the token tuples; the worker spec exercises suppressed-fake
#: scenarios by typing, not quoting. Add here only with that justification.
SWEEP_SELF_EXEMPT: Final[frozenset[str]] = frozenset({"scripts/gen_part11_handover.py"})


def fence(rel_path: str, text: str) -> str:
    if "```" in text:
        return "````text\n" + text.rstrip("\n") + "\n````\n"
    name = rel_path.rsplit("/", 1)[-1]
    lang = {
        ".py": "python",
        ".ts": "typescript",
        ".tsx": "tsx",
        ".sql": "sql",
        ".json": "json",
        ".prisma": "prisma",
        ".toml": "toml",
        ".yml": "yaml",
        ".yaml": "yaml",
        ".mjs": "javascript",
        ".txt": "text",
        ".md": "markdown",
    }.get(
        "." + name.rsplit(".", 1)[-1] if "." in name else "",
        "dotenv" if name == ".env.example" else ("dockerfile" if name.endswith("Dockerfile") else ""),
    )
    return f"```{lang}\n" + text.rstrip("\n") + "\n```\n"


def block(rel: str, note: str) -> str:
    path = ROOT / rel
    text = path.read_text(encoding="utf-8")
    lines = len(text.splitlines())
    return f"## FILE: {rel} ({lines} lines)\n\n*{note}*\n\n{fence(rel, text)}\n"


def sweep() -> list[str]:
    problems: list[str] = []
    for rel, _ in NEW:
        if rel in SWEEP_SELF_EXEMPT:
            continue
        text = (ROOT / rel).read_text(encoding="utf-8")
        for token in ELISION_TOKENS + NEW_ONLY_TOKENS:
            if token in text:
                problems.append(f"NEW {rel}: contains {token!r}")
    for rel, _ in MODIFIED:
        if rel in SWEEP_SELF_EXEMPT:
            continue
        text = (ROOT / rel).read_text(encoding="utf-8")
        for token in ELISION_TOKENS:
            if token in text:
                problems.append(f"MODIFIED {rel}: contains {token!r}")
    return problems


HEADER = """# Part 11 - Scale & coordination: worker plane, partitioned execution, read-replica policy - full source handover

> **Risk note, unchanged and deliberately unsoftened:** this part scales the
> plumbing around the money path; it does not make the money path itself
> bolder. Live venue transmission remains refused at the engine's startup by
> code, risk checks remain fail-closed, and the simulated store's durability
> (or lack of it) is REPORTED at every surface that could hide it.

Complete content of every file created or modified by Part 11. Nothing is
abbreviated, summarised or elided: each block below is the entire final file
as it exists in the repository. Modified files are shown complete - not as
diffs - per the standing handover rule; their pre-Part-11 content is
preserved inside them and comparable against
`docs/PART10_HANDOVER_FULL_SOURCE.md`.

All quality gates at generation time (2026-09-13). **Refreshed
2026-09-14** by Part 12: the modified files listed below were re-emitted
from disk (Part-11 content preserved inside them, now carrying Part-12
additions), so every block here matches the current repository; the gate
ledger keeps its Part-11 numbers as the historical record, and Part 12's
gates are stated in `docs/PART12_HANDOVER_FULL_SOURCE.md`.

* `cd libs/trading-core && python3 -m pytest tests -q` -> **1324 passed**
  (64 coordination-foundation + 4 observe-only invariants new in this part);
  `python3 -m ruff check wlct_trading tests` -> green;
  `python3 -m mypy wlct_trading` -> **no issues, 142 source files**
  (zero suppressions added anywhere in the part's new files - the generator
  below audits that claim on every run).
* `docs/fixtures/coordination_fixtures.json` regenerated twice and compared:
  **byte-identical** (determinism is a fixture property, not a wish).
* `cd services/execution-engine && python3 -m pytest tests -q` ->
  **20 passed**; `ruff check app tests` -> green; `mypy app` -> **no issues,
  10 source files** (strict; the single documented per-file rule relaxation
  for the stub-less third-party logging base is config in pyproject,
  explained in-file - no inline suppressions).
* `cd apps/api && npx jest --silent` -> **354 passed / 15 suites** (309
  pre-existing + 21 worker + 11 read-policy + 5 ops-view + 8 RLS-coverage);
  `npx tsc --noEmit` -> **0 errors**; `npx eslint src --max-warnings=0` ->
  clean; `npx prisma validate` -> valid; `npm run build` emits
  `dist/worker.js` (the compose command target).
* RLS generation determinism: `python3 scripts/gen_part11_rls.py` rerun over
  the shipped migration/enable/disable/coverage files -> all four
  **byte-identical**. Live-Postgres policy behaviour is the enablement
  checklist's probes (`docs/DR.md`), not a sandbox claim: this sandbox has
  no PostgreSQL and no way to install one.
* DR tooling: `node --test scripts/` -> **15 passed / 0 failed**;
  `node scripts/dr-manifest.mjs --check` -> valid; `--plan` deterministic
  and credential-free by scan.
* Sibling Python services re-verified untouched by this part:
  trading-engine **43 passed**, market-data **19 passed**.
* The root `.env.example` parses through `validateEnv` with every Part-11
  default resolved; `docker-compose.yml` loads with the two new services
  publishing no ports.
* **Not run here, stated plainly:** the compose stack itself and the
  real-infrastructure chaos/failover runs (no Docker in this environment);
  the coordination protocol is exercised against a faithful claim-server
  fake that speaks raw ioredis replies and interprets the two shipped Lua
  scripts by exact text identity - Sections 14, 16, 17 and 18 of
  `docs/PART11_WORKER_SCALING.md` keep the staging checklist open.

"""


def main() -> int:
    problems = sweep()
    if problems:
        for problem in problems:
            print(f"SWEEP FAILURE: {problem}", file=sys.stderr)
        return 1

    missing = [rel for rel, _ in NEW + MODIFIED if not (ROOT / rel).is_file()]
    if missing:
        for rel in missing:
            print(f"MISSING FILE: {rel}", file=sys.stderr)
        return 1

    header = HEADER + "### New files\n\n"
    for rel, _ in NEW:
        n = len((ROOT / rel).read_text(encoding="utf-8").splitlines())
        header += f"* `{rel}` - {n} lines\n"
    header += "\n### Modified files (shown complete)\n\n"
    for rel, _ in MODIFIED:
        n = len((ROOT / rel).read_text(encoding="utf-8").splitlines())
        header += f"* `{rel}` - {n} lines\n"
    header += "\n---\n\n"

    parts = [header, "## New files\n"]
    parts += [block(rel, note) for rel, note in NEW]
    parts += ["\n## Modified files (complete final content)\n"]
    parts += [block(rel, note) for rel, note in MODIFIED]
    parts += [
        "---\n\n*End of Part 11 handover. Every file above is complete as "
        "written; line counts in the contents list match the blocks. The "
        "sweep that certifies 'no elisions, no added suppressions' runs on "
        "every generation - rerun `python3 scripts/gen_part11_handover.py` "
        "after any change.*\n"
    ]

    OUT.write_text("\n".join(parts), encoding="utf-8")
    total = len(OUT.read_text(encoding="utf-8").splitlines())
    print(f"wrote {OUT} ({total} lines, {len(NEW) + len(MODIFIED)} files)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
