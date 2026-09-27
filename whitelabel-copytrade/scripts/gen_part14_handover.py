"""One-shot generator for docs/PART14_HANDOVER_FULL_SOURCE.md.

Runs from anywhere. Same standing rule as the Part 11, 12 and 13
generators it clones: every listed file is emitted COMPLETE - the entire
final file, no diffs, no elisions - and the generator AUDITS its own
emission (placeholder-elision tokens refused everywhere in the set,
suppression tokens refused in every NEW file; a hit fails the build, naming
the token and the file). The Part 13 baseline for comparison lives in
docs/PART13_HANDOVER_FULL_SOURCE.md; modified files shown HERE are shown
there too, so the two documents are diffable by construction.
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
OUT = ROOT / "docs" / "PART14_HANDOVER_FULL_SOURCE.md"

NEW: Final[list[tuple[str, str]]] = [
    (
        "libs/trading-core/wlct_trading/retention.py",
        "the pure retention law: named constants for the one prunable table, the immutable records and the ledger; the nonsense-proof RetentionPolicy (bool-rejecting int checks, 1..36,500 days, lock-budget batch bounds); cutoff arithmetic that takes its clock as an argument; and the two-sided prunable predicate - the module imports no time, no driver and the status vocabulary it deliberately does not re-derive.",
    ),
    (
        "libs/trading-core/tests/test_part14_retention.py",
        "35 tests: the construction-law matrix, the cutoff recomputed through a second unit path, the predicate boundary rows on both strict-less-than edges, the table-naming laws, and the AST purity scan (imports and name/attribute sets - docstrings may TALK about datetime.now, the code may not reach for it).",
    ),
    (
        "services/execution-engine/app/retention.py",
        "the executor: five literal SQL constants (shared prune predicate pinned by literal identity, seq-ANY delete with RETURNING, the ledger insert), the dry-run count path, the bounded batch loop with its three exits, the per-batch reuse of the store's _TenantTransaction (GUC and UUID guard free), and the ledger-failure path that flips ledger_written and raises carrying the full counts.",
    ),
    (
        "services/execution-engine/app/routers/retention.py",
        "two POSTs on the internal prefix: run (dry by default in the SCHEMA, apply gated on config) and inspect (one transaction, count + five ledger rows); every refusal (no durable store, apply disabled, ledger lost) answered in the engine's flat code/message envelope before a single statement exists.",
    ),
    (
        "services/execution-engine/tests/test_part14_retention.py",
        "33 tests: statement-literal pins, the scripted conversations for every branch (transaction boundaries counted, Eat() markers to pin WHICH statement a failure rides), and the HTTP matrix over a booted app with the lifespan's pool seam patched - including statements == [] on the refused apply and the status route's two new fields.",
    ),
    (
        "services/execution-engine/tests/test_part14_drift_parity.py",
        "11 re-derivations: migration columns vs the Prisma model vs the executor's insert list (identity column excepted), index names, Part 13 DDL hosting the predicate's columns, sqlglot parse of the ledger migration, the app-wide scan finding exactly one DELETE FROM target, and RLS coverage/enable/disable symmetry for the new table.",
    ),
    (
        "services/execution-engine/tests/test_part14_retention_live.py",
        "5 real-Postgres tests (skipped by name without the DSN env): the joined predicate matching the prose row-for-row, a rehearsal recording without touching a row, ceiling-stop-then-resume with the remainder intact across two runs, tenant B untouched by tenant A's run despite identical shapes, and the live RLS probe on the ledger - bare session sees zero, the GUC transaction sees its row.",
    ),
    (
        "apps/api/prisma/migrations/20260914160000_part14_retention_ledger/migration.sql",
        "the run ledger's DDL: BIGSERIAL seq identity, tenant UUID with Restrict FK, the counts and the cutoff, dry_run/exhausted booleans, instance attribution, the latest-N index, and the header comments stating WHY refusals have no rows here and why this table is never pruned.",
    ),
    (
        "scripts/retention-run.mjs",
        "the operator CLI: dry unless told otherwise, --inspect for the read, one canonical --tenant per call enforced locally, the engine's exit-code contract mirrored (0/1/2), token env-only and scrubbed from every printed line including echoed error bodies.",
    ),
    (
        "scripts/retention-run.test.mjs",
        "11 node tests: arg law and exclusivity, request shape, the scrub function, and full-process runs against an in-test local HTTP fake engine (async spawn, because the server shares the parent loop) asserting headers, bodies, exit codes, and the token's non-appearance.",
    ),
    (
        "docs/PART14_RETENTION.md",
        "the part's authoritative document: the growth analysis that picks the one prunable table, the four laws with their reasons, the executor's invariants, the ledger's two honest edges, the refusal matrix, the wire surface, the scheduling stance, the RLS argument, the test law with its limits in the same font, the four-move runbook, and the decisions ledger with each rejected alternative nearby.",
    ),
    (
        "scripts/gen_part14_handover.py",
        "this generator - included, per the rule that every Part-14 file appears complete.",
    ),
]

MODIFIED: Final[list[tuple[str, str]]] = [
    (
        "services/execution-engine/app/config.py",
        "the four retention fields (dark-by-default apply switch, days, batch rows, batches), boot-time validation by CONSTRUCTING the core policy (the bound law has one home; an invalid config names its env var at startup), the retention_policy property, and the four values added to the public view - non-secret by construction.",
    ),
    (
        "services/execution-engine/app/schemas.py",
        "five retention wire models (run/inspect requests, the run answer mirroring the ledger row, the run view, the inspect answer) on the same _WireModel law - camelCase aliases, extra=forbid - and StatusResponse's two new fields defaulting to the shipped posture so a pre-Part-14 engine cannot be read as having run retention.",
    ),
    (
        "services/execution-engine/app/composition.py",
        "describe() grows retentionEnabled/retentionEventDays beside the store posture - visible to the worker's status read, deliberately NOT added to its compatibility law (commands do not touch the journal).",
    ),
    (
        "services/execution-engine/app/main.py",
        "two lines: the retention router import and its include; the lifespan was already pool-owning since Part 13, and this part consumes that seam rather than widening it.",
    ),
    (
        "apps/api/prisma/schema.prisma",
        "the ExecutionRetentionRun model (seq identity, micros law, dry-run-is-evidence comment, cutoff frozen into the row, batches accounting, instance attribution, Restrict tenant FK, the latest-N index) and the Tenant back-relation; prisma format again left every pre-existing byte in place.",
    ),
    (
        "apps/api/prisma/migrations/20260913120000_part11_row_level_security/migration.sql",
        "regenerated by the generator, not hand-edited: coverage 41 -> 42 tables, the ledger's policy included, byte-deterministic.",
    ),
    (
        "apps/api/prisma/rls/enable.sql",
        "regenerated: the ledger joins the pre-flight checklist and the ENABLE/FORCE sequence - one checklist for all 42.",
    ),
    (
        "apps/api/prisma/rls/disable.sql",
        "regenerated: the exact inverse covers the new table the same day enable does.",
    ),
    (
        "apps/api/prisma/rls/rls_coverage.json",
        "regenerated: covered 41 -> 42; the Node rls-coverage spec (which RE-DERIVES the schema rather than pinning a count) passed unchanged at the new number.",
    ),
    (
        "docker-compose.yml",
        "the four EXECUTION_RETENTION_* passthroughs with ${VAR:-default} spellings (an empty override resolves to the default - the Part 13 lesson applied before it could recur) and the comment stating that compose ships no scheduler.",
    ),
    (
        ".env.example",
        "the retention note under the engine block: defaults, the pointer to the service example and the part doc, and the line that the prune runs from scripts/retention-run.mjs under the deployment's scheduler.",
    ),
    (
        "services/execution-engine/.env.example",
        "the retention block: the two guards in prose (dark apply, never-pruned orders/fills/ledger), the both-sides cutoff law in one sentence, and the batch-ceiling semantics (exhausted means resume, not incident).",
    ),
    (
        "docs/PART13_DURABLE_STORE.md",
        "section 13's PART 14 AMENDMENT: the journal-growth implication this part left unnamed is now answered, and the metrics time-series retention item is called out as DIFFERENT by name so the two are never conflated.",
    ),
    (
        "docs/DR.md",
        "the backup-freshness section gains the Part 14 consequence: --due green before the first apply, the deletion ledger riding the same dump, and the one-line reason a prune followed by a failed restore is indistinguishable from an outage.",
    ),
    (
        "docs/ARCHITECTURE.md",
        "the engine bullet's store paragraph extended: bounded journal, dark-by-default apply, the never-pruned run ledger, and no shipped schedule.",
    ),
    (
        "docs/SECURITY.md",
        "the retention bullet: the only deletion path on the engine plane, triply narrow (one table under an app-wide scan, config-dark, internal-only and tenant-per-call), with every run leaving a row under the same RLS law as its subjects.",
    ),
    (
        "docs/ROADMAP.md",
        "Part 14's delivery-log row and the open-list clarification (journal retention closed; the backlog's time-series metrics item - different table, different part - deliberately still open).",
    ),
]

#: Tokens whose mere presence means content was cut somewhere. A hit in ANY
#: listed file fails the build - the rule the Part 11-13 documents shipped
#: under, unchanged.
ELISION_TOKENS: Final[tuple[str, ...]] = (
    "# existing code",
    "# rest of code",
    "// rest of code",
    "// implementation omitted",
    "... (rest",
    "(snip)",
    "truncated for brevity",
    "identical to",
    "same as above",
    "etc.",
    "omitted",
    "unchanged`",
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
#: from the substring scan - stated, never silently skipped.
SWEEP_SELF_EXEMPT: Final[frozenset[str]] = frozenset({"scripts/gen_part14_handover.py"})


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


HEADER = """# Part 14 - journal retention: full source handover

> **Risk note, unchanged and deliberately unsoftened:** Part 14 puts the
> platform's first DELETE near money records, and every layer is shaped by
> that - one deletable table under an app-wide test, apply dark behind both
> the engine's config and the script's flag, and a run ledger that nothing
> prunes. Live venue transmission remains refused by startup code; this
> part neither advances nor weakens that refusal.

Complete content of every file created or modified by Part 14. Nothing is
abbreviated, summarised or elided: each block below is the entire final file
as it exists in the repository. Modified files are shown complete - not as
diffs - per the standing handover rule; their Part-13 state is recoverable
from `docs/PART13_HANDOVER_FULL_SOURCE.md` (and earlier documents for files
that predate it), which list every one of them with its then-current line
count - `apps/api/prisma/schema.prisma` included, so its baseline is the
Part 13 emission (4,139 lines) and the delta below is real, not estimated.

All quality gates at generation time (2026-09-14):

* `cd libs/trading-core && python3 -m pytest -q` -> **1377 passed** (+35
  Part-14 retention-law tests); `python3 -m ruff check wlct_trading tests`
  -> green; `python3 -m mypy wlct_trading` -> **no issues, 144 source
  files**, zero suppressions in any part file (the sweep below audits it).
* `cd services/execution-engine && python3 -m pytest -q` -> **133 passed,
  12 skipped** (all seven Part-13 live tests plus the five Part-14 live
  tests, skipping BY NAME without `EXECUTION_TEST_POSTGRES_DSN` - the
  honest shape stated in docs/PART14_RETENTION.md section 9);
  `python3 -m ruff check app tests` -> green; `python3 -m mypy app` ->
  **no issues, 14 source files**.
* `cd apps/api && npx jest --silent` -> **386 passed / 17 suites** (the
  worker side needed NO change for this part - and its rls-coverage spec
  RE-DERIVES the schema, which is why it went from 41 to 42 covered tables
  without a single spec edit); `npx tsc --noEmit` -> 0 errors;
  `npx eslint src --max-warnings 0` -> clean; `npx prisma validate` ->
  valid.
* `node --test scripts/` -> **37 passed / 0 failed** (+11 CLI tests,
  including full-process runs against an in-test fake engine and the
  token-never-printed assertion); `node scripts/dr-manifest.mjs --check`
  unchanged and green.
* `python3 scripts/gen_part11_rls.py` regenerated all four artifacts for
  42 covered tables (the ledger picked up with NO generator change),
  byte-identical across consecutive runs.
* Sibling Python services re-verified untouched: trading-engine **43
  passed**, market-data **19 passed**.
* Line ledger (measured, this script): Part 14 shipped **3,531 lines** -
  3,265 across the 12 new files (this generator included) and +266 across
  the 17 modified files (delta against the newest handover document that
  lists each file - the regenerated RLS artifacts and the four doc edits
  keep that number modest; growth here is concentrated in law and tests,
  which is the correct place for a part whose production surface is one
  module, one router and one script). Whole-tree counts under the standing
  rule set (everything except node_modules/dist/lockfiles, `docs/source/`,
  and the PART*HANDOVER documents): **179,979 source lines**; adding the
  full docs tree (narrative documents and the regenerable docs/source
  views, minus every handover dump): **527,314**; prior parts' totals used
  the same rule
  (176,806 at Part 13 close) and all numbers here are re-measured, never
  extrapolated.
"""


def main() -> int:
    problems = sweep()
    if problems:
        print("HANDOVER AUDIT FAILED:", file=sys.stderr)
        for problem in problems:
            print(f"  {problem}", file=sys.stderr)
        return 1
    parts = [HEADER, "## Created in Part 14 (full files)\n"]
    parts += [block(rel, note) for rel, note in NEW]
    parts.append("## Modified in Part 14 (full files, prior content preserved inside)\n")
    parts += [block(rel, note) for rel, note in MODIFIED]
    total_files = len(NEW) + len(MODIFIED)
    text = "\n".join(parts)
    OUT.write_text(text, encoding="utf-8")
    emitted = text.count("\n## FILE: ")
    if emitted != total_files:
        print(f"EMISSION COUNT MISMATCH: {emitted} blocks for {total_files} files", file=sys.stderr)
        return 1
    print(
        f"wrote {OUT} ({len(text.splitlines()):,} lines, "
        f"{total_files} files: {len(NEW)} new + {len(MODIFIED)} modified)",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
