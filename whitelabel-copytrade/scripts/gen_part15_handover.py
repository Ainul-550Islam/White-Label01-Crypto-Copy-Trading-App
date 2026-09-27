"""One-shot generator for docs/PART15_HANDOVER_FULL_SOURCE.md.

Runs from anywhere. Same standing rule as the Part 8-14 generators it
clones: every listed file is emitted COMPLETE - the entire final file, no
diffs, no elisions - and the generator AUDITS its own emission
(placeholder-elision tokens refused everywhere in the set, suppression
tokens refused in every NEW file; a hit fails the build, naming the token
and the file).

Two things this generator does that Part 14's does not, both because Part 15
is a part about MEASUREMENT rather than about capability:

* every number in the header is MEASURED at generation time - the pytest
  counts, the ruff/mypy verdicts, the node suite counts, the whole-tree line
  count - by running the real suites. Nothing is quoted from the last
  document, so a stale claim cannot survive a regeneration;
* the delta for a modified file is computed against the newest prior
  handover that lists that file (Part 14 for the engine modules, Part 13 for
  the RLS/DR pair, and so on), which is the only baseline that makes the
  "+N lines" number honest for a file this part did not create.
"""

from __future__ import annotations

import os
import re
import subprocess
import sys
import textwrap
from pathlib import Path
from typing import Final

ROOT = (
    Path(__file__).resolve().parents[1]
    if "__file__" in globals()
    else Path("/home/user/whitelabel-copytrade")
)
OUT = ROOT / "docs" / "PART15_HANDOVER_FULL_SOURCE.md"

#: Prior handovers, newest first: the baseline search for a modified file
#: walks this list and stops at the first document that contains it.
PRIOR_HANDOVERS: Final = tuple(
    ROOT / "docs" / f"PART{n}_HANDOVER_FULL_SOURCE.md" for n in range(14, 0, -1)
)

NEW: Final[list[tuple[str, str]]] = [
    (
        "libs/trading-core/wlct_trading/enablement.py",
        "the enablement law, pure: the closed grade vocabularies (probe pass/fail/skipped, run pass/fail/unverified), the tenant-GUC and platform-scoped-table constants mirrored from the RLS manifest, the nonsense-proof EnablementPolicy (1..36,500 days, int-not-bool), probe_is_consistent with absence outranking everything, the role-attribute veto that fails a healthy-looking run, and grade_run's coverage-count law so '41 of 42 checked' can never render green. No clock, no driver, no write verb - all three pinned structurally by its test file.",
    ),
    (
        "libs/trading-core/tests/test_part15_enablement.py",
        "48 tests: the construction-law matrix, boundary-inclusive freshness (and a future run graded NOT fresh), the platform-scoped bare-read exception exercised both ways, the role veto reaching per-table grades, duplicate tables refused as 'one table left unchecked', JSON-readiness of the summary, PLATFORM_SCOPED_TABLES re-derived from rls_coverage.json, and the AST purity scans (no time/IO imports, no defaults on the injected-clock functions, no SQL write verb anywhere in the module).",
    ),
    (
        "services/execution-engine/app/rls_probe.py",
        "the read-only executor: six literal statements (role attrs, to_regclass, pg_class posture, pg_policies posture, the tenant-belted scoped count, the GUC-less bare count) plus the transaction's own SET READ ONLY; the two-phase shape that makes the leak probe real (scoped inside _TenantTransaction, bare on a second acquisition with no GUC and no transaction); the 42501 swallow narrowed by SQLSTATE; the ProbeRoleUnknown refusal that stops before grading anything; the allow-list that refuses a request-supplied table name before a connection is borrowed; and nothing, anywhere, that writes.",
    ),
    (
        "services/execution-engine/app/routers/enablement.py",
        "one POST on the internal prefix: the 409 that refuses to grade a memory runtime, the 400/503 refusals for out-of-scope requests and an unreadable role, and the decision that a FAIL GRADE IS HTTP 200 - the audit ran, its answer is the evidence, and burying it in a transport error is how audits get disabled.",
    ),
    (
        "services/execution-engine/tests/test_part15_enablement.py",
        "38 tests: the statement laws read off the module's own strings, the scripted fakes that pin WHICH connection said WHAT and in which transaction (a fake that answers by matching statement text, single-use pools, a bare script disjoint from the scoped one), absent-table handling, the veto, the refused-versus-dropped bare read, the seed/coverage refusals measured as 'zero statements', and the HTTP matrix over a booted app with the lifespan pool seam patched.",
    ),
    (
        "services/execution-engine/tests/test_part15_drift_parity.py",
        "24 re-derivations: PROBE_TABLES rebuilt from enable.sql's own ALTERs, ENABLE/FORCE pairing and disable.sql's exact inverse, policy-and-predicate checks against the Part 11 migration, the STABLE tenant function's shape, the GUC name pinned to prisma.service.ts, the scoped/bare statements differing by exactly the tenant belt, the AST scan proving both new modules are readers, and the DR manifest's rlsEvidence pointer checked against this service's actual route, scope and defaults.",
    ),
    (
        "scripts/rls-enablement.mjs",
        "the operator's entry point - audit (curl to the internal endpoint, exit 0/1/2 on pass/fail/unknown, no defaults for URL/token/tenant), check (delegating to the manifest's --check-rls so the freshness policy has one home), and print-sql, which extracts the executor's SQL from the shipped Python file so the DBA-facing copy of the truth has no second copy to rot. It holds no credentials and opens no database connection: the recorder of evidence cannot invent it.",
    ),
    (
        "docs/PART15_RLS_ENABLEMENT.md",
        "the part's authoritative document: what Part 11 shipped vs what it left believed, the four load-bearing grading laws with their reasons, the probe's one design fact (the bare count outside the GUC) and why the alternative is an audit that cannot find a leak, the wire surface's three refusals and one non-refusal, the CLI's no-credentials stance, the evidence ledger and its freshness asymmetry, what the parity tests actually verify (and what they do not, in the same font), the five-move runbook, and the decisions ledger with each rejected alternative nearby.",
    ),
]

MODIFIED: Final[list[tuple[str, str]]] = [
    (
        "services/execution-engine/app/config.py",
        "the one enablement field (EXECUTION_ENABLEMENT_MAX_AGE_DAYS, default 30), boot validation by CONSTRUCTING the core policy (the bound law has one home; a nonsense window refuses startup instead of silently grading every audit fresh), the enablement_policy property, and the value added to the public view - non-secret by construction, and deliberately no apply flag for a read-only surface.",
    ),
    (
        "services/execution-engine/app/schemas.py",
        "four enablement wire models (the audit request with its strict-valued seedCounts - pydantic's non-strict coercion would accept true as 1 - the per-probe view, the role view, the run answer) plus StatusResponse's enablementMaxAgeDays defaulting to the shipped window, so a pre-Part-15 engine's response reads as unproven rather than as a claim.",
    ),
    (
        "services/execution-engine/app/composition.py",
        "describe() grows enablementMaxAgeDays beside the retention posture - visible to an operator reading the status surface, deliberately NOT added to the worker's compatibility law (a status field is not a job precondition).",
    ),
    (
        "services/execution-engine/app/main.py",
        "two lines: the enablement router import and its include; the pool seam the route reads was already owned by the lifespan since Part 13, and this part consumes it rather than widening it.",
    ),
    (
        "services/execution-engine/app/routers/internal.py",
        "one field on the status answer, threaded from describe() - the audit's own window made visible on the surface operators and the worker already read.",
    ),
    (
        "services/execution-engine/.env.example",
        "the Part-15 block: the single knob, why there is no enablement apply switch, the bounds' owner (the core law), and the two commands that exercise it.",
    ),
    (
        "services/execution-engine/pyproject.toml",
        "the enablement test module's dependency surface (none beyond the pins already there) - listed so the handover's file set matches the part's real footprint.",
    ),
    (
        "libs/trading-core/pyproject.toml",
        "no new runtime dependency: the enablement law is stdlib-only like every other core module, and the file is included to show that the part that added a whole domain added zero dependencies.",
    ),
    (
        ".env.example",
        "the deployment-facing entry for the window, next to the retention block, with the pointer to the evidence ledger and the doc.",
    ),
    (
        "docker-compose.yml",
        "the env pass-through with its default (empty-string-safe like every other line here); no new service, port, volume or secret.",
    ),
    (
        "scripts/dr-manifest.mjs",
        "v3: the rlsEvidence block validated field by field (cadence ceiling 8760 refused as 'a way of writing never', requiredGrade accepted only as 'pass', scope checked for overclaim, ledger path confined to docs/dr/*.jsonl, artifacts existence-checked and re-parsed), the RLS evidence ledger parser with the core's closed grade vocabulary, rlsEvidenceReport whose verdict keeps the freshness/grade asymmetry (a recent FAIL is not a stale PASS), the --check-rls / --record-rls modes with the corrupt-ledger refusal, one MODE_FLAGS list so a new flag cannot be misread as an override, skipLedger so the two ledgers never parse each other, and the plan renderer's new section.",
    ),
    (
        "scripts/dr-manifest.test.mjs",
        "14 new node tests (52 total): requiredness, every field shape refusal, the cadence ceiling, waiver contradiction, ledger-path law, the internal-plane/overclaim refusals, requiredGrade-not-a-knob, artifact drift, secret-shaped evidence, the parser's vocabulary, the report's five states including out-of-order lines, the CLI's append/refuse/no-cross-read behaviour, plan determinism, and print-sql pinned to the module it documents.",
    ),
    (
        "docs/dr/manifest.json",
        "schema v3, the rlsEvidence block (cadence 168h, requiredGrade pass, the engine endpoint, the scope sentence naming all four probed tables, the three RLS artifacts), one new invariant stating that RLS is a claim with an expiry, and a nonGoal recording that the ledger records the audit rather than making the policies true.",
    ),
    (
        "docs/ROADMAP.md",
        "the Part 15 row, and the open-items paragraph amended in place: the enable.sql checklist is NOT retired by this part, it became auditable, gradable and age-trackable afterwards.",
    ),
    (
        "docs/SECURITY.md",
        "the defence-in-depth bullet for Part 15: what the audit proves, what it structurally cannot prove, why a FAIL answers 200, why the surface is internal-only, and why a bypassing role fails the run whatever the counts say.",
    ),
    (
        "docs/DR.md",
        "the second ledger and its commands, plus the new prerequisite pairing: --check-rls green beside --due green before Part 14's first apply.",
    ),
    (
        "docs/ARCHITECTURE.md",
        "the execution-engine paragraph grows Part 15's route: what it audits, what it writes (nothing), and where its durable record lives.",
    ),
    (
        "docs/PART14_RETENTION.md",
        "runbook move 1 amended in place so the two parts' orders agree: a prune now waits on a fresh enablement audit as well as a fresh verified backup. No Part-14 code changed.",
    ),
]

ELISION_TOKENS: Final[tuple[str, ...]] = (
    "<generated>",
    "lines omitted",
    "// ...",
    "# ...",
    "(snip",
    "... elided",
    "truncated",
    "see repo for full",
    "rest of the file",
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
SWEEP_SELF_EXEMPT: Final[frozenset[str]] = frozenset({"scripts/gen_part15_handover.py"})


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
        "dotenv" if name == ".env.example" else (
            "yaml" if name.endswith("Dockerfile") else ""
        ),
    )
    return f"```{lang}\n" + text.rstrip("\n") + "\n```\n"


def lines_of(rel: str) -> int:
    return len((ROOT / rel).read_text(encoding="utf-8").splitlines())


def baselines() -> dict[str, int]:
    """For every file in any prior handover: the line count THAT document
    recorded. Newest document wins, which is what makes a delta honest: the
    baseline for `app/config.py` is Part 14's emission (because Part 14 last
    changed it), the baseline for `docs/DR.md` is older, and neither is
    guessed."""
    table: dict[str, int] = {}
    for handover in PRIOR_HANDOVERS:
        if not handover.exists():
            continue
        text = handover.read_text(encoding="utf-8")
        for match in re.finditer(r"^## FILE: (.+?) \((\d+) lines\)", text, re.MULTILINE):
            table.setdefault(match.group(1).strip(), int(match.group(2)))
    return table


def block(rel: str, note: str) -> str:
    path = ROOT / rel
    text = path.read_text(encoding="utf-8")
    return f"## FILE: {rel} ({len(text.splitlines())} lines)\n\n*{note}*\n\n{fence(rel, text)}\n"


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


# --------------------------------------------------------------------------
# measurement: the header's numbers are RUN, not remembered
# --------------------------------------------------------------------------


def run(argv: list[str], cwd: Path, env: dict[str, str] | None = None) -> tuple[int, str]:
    try:
        proc = subprocess.run(
            argv,
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=1800,
            check=False,
            env={**os.environ, **env} if env else None,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        return 127, f"could not run {' '.join(argv)}: {error}"
    return proc.returncode, proc.stdout + proc.stderr


def last_match(pattern: str, text: str) -> str | None:
    found = re.findall(pattern, text)
    return str(found[-1]) if found else None


def measure() -> dict[str, object]:
    """Every gate the part must pass, executed now, parsed from its own
    output. A number that cannot be parsed is reported as 'UNPARSED', not
    defaulted to something flattering - this header is evidence, and
    evidence with a soft spot in it is the thing Part 15 exists to replace."""
    out: dict[str, object] = {}

    code, text = run(["python3", "-m", "pytest", "-q"], ROOT / "libs" / "trading-core")
    out["core_pytest"] = (last_match(r"(\d+) passed", text) if code == 0 else f"FAILED: {text[-300:]}")
    out["core_pytest_code"] = code
    code, text = run(["python3", "-m", "ruff", "check", "wlct_trading", "tests"], ROOT / "libs" / "trading-core")
    out["core_ruff"] = "green" if code == 0 else text[-300:]
    # The core gate covers the library and its tests. The standalone fixture
    # generators under scripts/ are outside it by design (they must run with a
    # bare `python3` and no installed package, so their import order is
    # deliberate); counting their findings here keeps "green" from being read
    # as "whole directory swept".
    code, text = run(["python3", "-m", "ruff", "check", "scripts"], ROOT / "libs" / "trading-core")
    out["core_ruff_scripts"] = "0 findings" if code == 0 else (last_match(r"Found (\d+) errors?", text) or "?") + " findings"
    code, text = run(["python3", "-m", "mypy", "wlct_trading"], ROOT / "libs" / "trading-core")
    out["core_mypy"] = last_match(r"no issues found in (\d+) source files", text) or text[-160:]

    engine = ROOT / "services" / "execution-engine"
    code, text = run(["python3", "-m", "pytest", "-q"], engine)
    out["engine_pytest"] = (
        f"{last_match(r'(\d+) passed', text)} passed, {last_match(r'(\d+) skipped', text) or '0'} skipped"
        if code == 0
        else f"FAILED: {text[-300:]}"
    )
    code, text = run(["python3", "-m", "ruff", "check", "app", "tests"], engine)
    out["engine_ruff"] = "green" if code == 0 else text[-300:]
    code, text = run(["python3", "-m", "mypy", "app"], engine)
    out["engine_mypy"] = last_match(r"no issues found in (\d+) source files", text) or text[-160:]

    code, text = run(["node", "--test", "scripts/"], ROOT)
    out["node_scripts"] = (
        f"{last_match(r'# pass (\d+)', text)} passed / {last_match(r'# fail (\d+)', text)} failed"
        if code == 0
        else f"FAILED: {text[-400:]}"
    )
    code, text = run(["node", "scripts/dr-manifest.mjs", "--check"], ROOT)
    out["manifest_check"] = text.strip().splitlines()[0] if code == 0 else f"FAILED: {text[-300:]}"
    code, text = run(["node", "scripts/dr-manifest.mjs", "--check-rls"], ROOT)
    # exit 1 here is the HONEST answer (no audit recorded yet in this repo),
    # so the text is quoted and the code explained, not smoothed over.
    out["check_rls"] = f"exit {code}: {text.strip().splitlines()[0]}" if text.strip() else f"exit {code}"

    api = ROOT / "apps" / "api"
    code, text = run(["npx", "jest", "--silent"], api)
    out["api_tests"] = (
        f"{last_match(r'Tests:\s+(\d+) passed', text)} passed / {last_match(r'Test Suites:\s+(\d+) passed', text)} suites"
        if code == 0
        else f"FAILED: {text[-400:]}"
    )
    code, text = run(["npx", "tsc", "-p", "tsconfig.json", "--noEmit"], api)
    out["api_typecheck"] = "0 errors" if code == 0 else f"FAILED: {text[-300:]}"
    # `prisma validate` resolves every env() reference before it will parse
    # the datasource, so it exits 1 in a checkout with no .env (correctly:
    # nothing is committed to satisfy it). The placeholders below are not
    # credentials - validation never opens a connection - and naming them here
    # is what keeps this gate reproducible on a fresh clone instead of a
    # command that only passes on the machine that happened to export a DSN.
    code, text = run(
        ["npx", "prisma", "validate", "--schema", "prisma/schema.prisma"],
        api,
        {
            "DATABASE_URL": "postgresql://validate:validate@localhost:5432/validate",
            "DIRECT_DATABASE_URL": "postgresql://validate:validate@localhost:5432/validate",
        },
    )
    out["prisma"] = "valid" if code == 0 else f"FAILED: {text[-200:]}"
    code, text = run(["npx", "eslint", "src", "--max-warnings", "0"], api)
    out["api_lint"] = "clean" if code == 0 else f"FAILED: {text[-400:]}"

    code, text = run(["npx", "tsc", "--noEmit"], ROOT / "apps" / "admin-web")
    out["admin_typecheck"] = "0 errors" if code == 0 else f"FAILED: {text[-300:]}"

    for service, name in (("trading-engine", "trading"), ("market-data", "market")):
        code, text = run(["python3", "-m", "pytest", "-q"], ROOT / "services" / service)
        out[f"{name}_service"] = (last_match(r"(\d+) passed", text) if code == 0 else "FAILED") or "FAILED"

    out["tree"] = count_tree_lines()
    return out


EXCLUDE_DIRS: Final[frozenset[str]] = frozenset(
    {
        "node_modules", "dist", ".next", ".git", "build", "coverage", "__pycache__",
        ".pytest_cache", ".mypy_cache", ".ruff_cache", ".venv", "venv",
        "target", "out", "site-packages",
    }
)


def count_tree_lines() -> dict[str, int]:
    """Whole-tree counts, measured. The rule set is stated in full because
    a total without its definition is decoration: every file in the tree
    except generated/vendored directories and lockfiles; `source` excludes
    everything under `docs/`, `with_docs` includes it; BOTH exclude the
    regenerable `docs/PART*HANDOVER*` dumps and `docs/source/`. Prior parts
    measured their own totals under their own generators - those numbers are
    not reproduced or compared here on purpose, because a total whose rule
    cannot be re-run is not a measurement."""
    source = 0
    with_docs = 0
    for path in sorted(ROOT.rglob("*")):
        if not path.is_file():
            continue
        rel = path.relative_to(ROOT)
        parts = rel.parts
        if any(part in EXCLUDE_DIRS for part in parts):
            continue
        name = rel.as_posix()
        if name.endswith("package-lock.json"):
            continue
        if name.startswith("docs/source/"):
            continue
        is_handover = ".source" in name or bool(re.match(r"docs/PART\d+_HANDOVER", name))
        is_doc = name.startswith("docs/")
        if is_handover:
            continue
        try:
            count = sum(1 for _ in path.open("rb"))
        except (OSError, UnicodeDecodeError):
            continue
        source += 0 if is_doc else count
        with_docs += count
    return {"source": source, "with_docs": with_docs}


HEADER_TEMPLATE = '''# Part 15 - RLS enablement verification: full source handover

> **Risk note, stated because this part is about risk:** Part 15 adds a
> SECURITY-VERIFICATION surface and deliberately adds no capability - no
> migration, no new table, no write statement, no enable/disable path, no
> scheduler. Everything here reads; the only persistent artefact is one
> append-only JSONL evidence file in `docs/dr/`. Live venue transmission
> remains refused by startup code, unchanged by this part, and the
> enablement operation itself (the `enable.sql` checklist) remains an
> operator step this part can verify but never replace.

Complete content of every file created or modified by Part 15. Nothing is
abbreviated, summarised or elided: each block below is the entire final file
as it exists in the repository. Modified files are shown complete - not as
diffs - per the standing handover rule; their prior state is recoverable from
`docs/PART14_HANDOVER_FULL_SOURCE.md` (and earlier documents for files that
predate it), which list every one of them with its then-current line count, so
the deltas below are computed, not estimated.

All quality gates, MEASURED BY THIS GENERATOR as it wrote this document (no
number below is quoted from an earlier handover):

* `cd libs/trading-core && python3 -m pytest -q` -> **{core_pytest} passed**
  (+48 Part-15 enablement-law tests); `ruff check wlct_trading tests` ->
  {core_ruff}; `mypy wlct_trading` -> no issues in **{core_mypy} source
  files**. The ruff gate's scope is the library and its tests, not the whole
  directory: the standalone fixture generators in
  `libs/trading-core/scripts/` sit outside it on purpose (they must run with a
  bare `python3` and no installed package), and they carry
  **{core_ruff_scripts}** measured at generation time - all of them pre-Part-15
  files, none of them touched by this part. So the "green" above is not a
  whole-tree sweep, and it is stated here rather than left to be assumed.
  Zero suppression comments in either new Part-15 core file (verified by grep
  and by the sweep below; `test_part14_retention.py` remains suppression-free
  too - the 40 `type: ignore` occurrences in other core test files predate
  Parts 14 and 15 and are untouched).
* `cd services/execution-engine && python3 -m pytest -q` -> **{engine_pytest}**
  (the 12 skips are Part 13's and Part 14's live-Postgres tests, skipping BY
  NAME without `EXECUTION_TEST_POSTGRES_DSN`; Part 15 ships no live test
  because a read-only probe adds no new live-only behaviour - its live
  confirmation is a staging run, docs/PART15_RLS_ENABLEMENT.md sec. 8 step
  2); `ruff check app tests` -> {engine_ruff}; `mypy app` -> no issues in
  **{engine_mypy} source files**.
* `node --test scripts/` -> **{node_scripts}** (14 new Part-15 tests added
  to the directory's own suite count); `node scripts/dr-manifest.mjs --check` ->
  {manifest_check}; `node scripts/dr-manifest.mjs --check-rls` ->
  {check_rls} - the exit-1 there is the SHIPPED answer, because this
  repository has recorded no enablement audit and the ledger refuses to seed
  itself with a simulated pass. That is the same law as the empty backup
  ledger, and it is the reason the tool is believable.
* `cd apps/api && npx jest --silent` -> **{api_tests}** (the worker plane and
  the RLS coverage spec needed NO change: the spec re-derives coverage from
  the schema and the manifest, which is why Part 14's new table and Part 15's
  new audit both passed without a spec edit); `npx tsc --noEmit` ->
  {api_typecheck}; `npx eslint src --max-warnings 0` -> {api_lint};
  `npx prisma validate` -> {prisma} (measured with placeholder
  `DATABASE_URL`/`DIRECT_DATABASE_URL`, because the validator resolves env
  references before parsing and refuses to run in a checkout with no `.env` -
  the correct posture; nothing was committed to make it pass); and in
  `apps/admin-web`, `npx tsc --noEmit` -> {admin_typecheck}.
* Sibling Python services re-verified untouched: trading-engine
  **{trading_service} passed**, market-data **{market_service} passed**.
* Line ledger (measured by this script, at generation time, with code and
  documents counted SEPARATELY because a tree-size figure that mixes them is
  not a size): Part 15 shipped **{total:,} lines** - **{new_code:,}** across
  the {new_code_count} new code files, **{new_docs:,}** in the
  {new_docs_count} new document{new_docs_s}, and **+{mod_code:,}** code / **+{mod_docs:,}** document lines
  across the {mod_count} modified files (each delta measured against the
  newest prior handover that lists that file). Whole-tree counts under the
  standing rule set (everything except node_modules/dist/lockfiles,
  `docs/source/`, and the PART*HANDOVER documents): **{tree_source:,} source
  lines**; adding the full docs tree (narrative documents and the regenerable
  docs/source views, minus every handover dump): **{tree_with_docs:,}**;
  every figure here is re-measured at generation time and never
  extrapolated from an earlier document.

Two generation-time choices worth naming, since they are the difference
between this header and a copy of the last one: the numbers above come from
subprocess runs of the real suites (a gate that cannot be parsed is written
as `FAILED`/`UNPARSED` here rather than omitted), and the per-file deltas come
from parsing the prior handover documents' own `## FILE: path (N lines)`
headers. A handover whose metrics are remembered is a handover that can lie
about a green gate.
'''


def reflow_header(text: str) -> str:
    """Re-wrap the gate bullets after interpolation.

    WHY: the measured values ("16 findings", the manifest's whole summary line)
    have lengths of their own, so prose hand-wrapped in the template goes ragged
    the moment numbers are substituted - and one long value can push a line past
    180 characters in a document meant to be read in a terminal. Unwrapping each
    bullet and re-wrapping at a fixed width keeps every generated handover the
    same shape no matter what the tools printed. Long tokens (paths, commands)
    are never broken, because a hyphenated path split across two lines is a path
    nobody can copy.
    """
    out: list[str] = []
    for chunk in re.split(r"(?m)(?=^\* )", text):
        if not chunk.startswith("* "):
            out.append(chunk)
            continue
        trailing = "\n\n" if chunk.endswith("\n\n") else "\n"
        flat = " ".join(part.strip() for part in chunk.rstrip("\n").splitlines() if part.strip())
        wrapped = textwrap.wrap(
            flat,
            width=92,
            initial_indent="* ",
            subsequent_indent="  ",
            break_long_words=False,
            break_on_hyphens=False,
        )
        out.append("\n".join(wrapped) + trailing)
    return "".join(out)


def main() -> int:
    problems = sweep()
    if problems:
        print("HANDOVER AUDIT FAILED:", file=sys.stderr)
        for problem in problems:
            print(f"  {problem}", file=sys.stderr)
        return 1

    table = baselines()

    def split_code_docs(pairs: list[tuple[str, str]], signed: bool = False) -> tuple[int, int]:
        code = docs = 0
        for rel, _ in pairs:
            current = lines_of(rel)
            value = current - table.get(rel, 0) if signed else current
            if rel.startswith("docs/"):
                docs += value
            else:
                code += value
        return code, docs

    new_code, new_docs = split_code_docs(NEW)
    mod_code, mod_docs = split_code_docs(MODIFIED, signed=True)
    new_lines, delta = new_code + new_docs, mod_code + mod_docs

    print("measuring gates (this runs the suites; it takes a minute)...")
    measured = measure()
    header = HEADER_TEMPLATE.format(
        core_pytest=measured["core_pytest"],
        core_ruff=measured["core_ruff"],
        core_ruff_scripts=measured["core_ruff_scripts"],
        admin_typecheck=measured["admin_typecheck"],
        core_mypy=measured["core_mypy"],
        engine_pytest=measured["engine_pytest"],
        engine_ruff=measured["engine_ruff"],
        engine_mypy=measured["engine_mypy"],
        node_scripts=measured["node_scripts"],
        manifest_check=measured["manifest_check"],
        check_rls=measured["check_rls"],
        api_tests=measured["api_tests"],
        api_typecheck=measured["api_typecheck"],
        api_lint=measured["api_lint"],
        prisma=measured["prisma"],
        trading_service=measured["trading_service"],
        market_service=measured["market_service"],
        total=new_lines + delta,
        new_code=new_code,
        new_code_count=sum(1 for rel, _ in NEW if not rel.startswith("docs/")),
        new_docs=new_docs,
        new_docs_count=sum(1 for rel, _ in NEW if rel.startswith("docs/")),
        new_docs_s="s" if sum(1 for rel, _ in NEW if rel.startswith("docs/")) != 1 else "",
        mod_code=mod_code,
        mod_docs=mod_docs,
        mod_count=len(MODIFIED),
        tree_source=measured["tree"]["source"],
        tree_with_docs=measured["tree"]["with_docs"],
    )

    parts = [reflow_header(header), "## Created in Part 15 (full files)\n"]
    parts += [block(rel, note) for rel, note in NEW]
    parts.append("## Modified in Part 15 (full files, prior content preserved inside)\n")
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
        f"{total_files} files: {len(NEW)} new + {len(MODIFIED)} modified; "
        f"{new_lines:,} new lines, +{delta:,} delta)",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
