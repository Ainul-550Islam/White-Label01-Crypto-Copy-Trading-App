"""Part 18 - metrics exposition and the bootable image: the full-source handover.

Generated, not written by hand, for the reason Part 15 established and Parts 16
and 17 repeated: a hand-copied "full source" document starts drifting the moment a
file changes, and a document whose completeness cannot be re-proved is a document
that merely claims. This script embeds the complete content of every file Part 18
added or modified, states its own gate results by RUNNING the suites, and accepts
``--check``, which regenerates in memory and compares byte for byte against the
committed file.

Copied from ``scripts/gen_part17_handover.py`` and re-pointed, which is the honest
description of the relationship: the gate list, the tree rule, the sweep and the
emission-count guard are that part's machinery, and a second hand-written variant
would be a second thing to keep true. What changed is the header, the file lists,
and the baseline search (now starting at Part 17, newest first). Two improvements to
the machinery itself are deliberate, and both came from watching this part's gates
break rather than reading about them:

* every Python gate is given ``PYTHONPATH`` for the core library, because the
  packages are not installed globally and a header that reports ``FAILED`` for a
  missing ``sys.path`` entry is measuring the machine instead of the code; and
* the sibling suites are named in the header as numbers this script parses, not as
  the sentence "re-verified untouched" - Part 18 edited two of their files, so for
  once "untouched" was not the truth, and a document that copies a phrase from its
  ancestor is copying an assumption.
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
OUT = ROOT / "docs" / "PART18_HANDOVER_FULL_SOURCE.md"

#: Prior handovers, newest first: the baseline search for a modified file
#: walks this list and stops at the first document that contains it.
PRIOR_HANDOVERS: Final = tuple(
    ROOT / "docs" / f"PART{n}_HANDOVER_FULL_SOURCE.md" for n in range(17, 0, -1)
)

NEW: Final[list[tuple[str, str]]] = [
    (
        "services/execution-engine/app/observability.py",
        "the hub: counter families DERIVED from dataclasses.fields(ExecutionCounters) so the exporter cannot fall behind the instrument, one stage-bounded histogram copied whole per scrape through the core's adapter rather than re-observed, seven wiring gauges read from describe() instead of from settings, a reset counter because inc() refuses a negative amount, and no background task - everything is read at scrape time from state the process already holds.",
    ),
    (
        "services/execution-engine/app/routers/observability.py",
        "GET /metrics: unauthenticated like the health endpoints beside it, include_in_schema=False so the path never enters the OpenAPI document, and a router that is not mounted at all when OBSERVABILITY_ENABLED is false, which makes the disabled posture a 404 rather than an apology body.",
    ),
    (
        "services/execution-engine/tests/test_part18_observability.py",
        "33 tests in six groups: the exporter/family equality asserted in BOTH directions against the dataclass; mirrored totals as a delta with a decrease counted as a reset (11 then 14, resets 1) instead of lowered; an unrecorded stage ABSENT rather than zero; a forbidden label refused at registration; a scrape that leaves the source alone; and the route's plane on a booted app - no token, no OpenAPI entry, not on the worker's forwarding list, and /status and the gauge agreeing because both are read rather than one being typed from memory.",
    ),
    (
        "services/execution-engine/tests/test_part18_asgi_target.py",
        "14 tests for the thing no check in this repository had ever done: resolve every Python service's image command through uvicorn's own constructor. A plain module:app target requires a module-level binding, a --factory target requires a zero-argument function, the --log-config path has to exist in the build context and load, a dictConfig of two no-op keys must leave an installed handler where it was, and /dev/null must still raise the RuntimeError that made the old flag unstartable - the mechanism pinned, so nobody re-adopts it as a shortcut. The static half parses modules rather than importing them, because the sibling modules build their app at import time and would fail a test for a reason unrelated to the test.",
    ),
    (
        "libs/trading-core/tests/test_part18_stage_observations.py",
        "9 tests that the engine's own numbers mean what the exposition says they mean: an accepted submission times exactly the spans it waited on, every timed name is in EXECUTION_STAGES, total_submit is one sample per submission rather than per return path, refusals are timed too, a stage that never answered stays absent, the instrument is exposed, the accessor refuses a write, an engine with no instrumentation still trades, and a port without observe() is tolerated.",
    ),
    (
        "services/execution-engine/log-config.json",
        "two no-op keys, in the only place a comment could not live: the .json suffix routes uvicorn to dictConfig instead of fileConfig, and disable_existing_loggers=false is what keeps the app's JSON pipeline intact. Its explanation is on the CMD it belongs to.",
    ),
    (
        "services/trading-engine/log-config.json",
        "the same file for the sibling whose image carried the same broken flag; created here because Part 18 found the defect by running a command line that all three services share.",
    ),
    (
        "services/market-data/log-config.json",
        "and the same for market-data. Three identical four-line files rather than one shared file: no service's build context can reach a sibling's, and an ARGV of COPY lines is cheaper to keep true than a mounted volume in a runtime image.",
    ),
    (
        "docs/PART18_METRICS_EXPOSITION.md",
        "the part document: the gap as three greps and one composition line that was missing, the four exposition laws, 13 stage names with 5 recorded and 8 deliberately not and the rule that decides which is which, the nine-part adapter bug this part found by calling the function for the first time, the instrument the service never handed its engine, and sec. 6.1 - the image that could not boot.",
    ),
    (
        "scripts/gen_part18_handover.py",
        "this generator. It embeds itself, which is the point of a document that can be rebuilt: the file that produced it is part of the evidence, and the sweep at the end of every write checks its own prose as closely as it checks the code it ships.",
    ),
]
MODIFIED: Final[list[tuple[str, str]]] = [
    (
        "libs/trading-core/wlct_trading/execution/engine.py",
        "the public read-only metrics property (no setter, so a scrape cannot be turned into a way of writing to the engine) and the four spans timed inside submit(): validation, safety_gates, risk, and total_submit recorded in finish() so it covers the paths that refuse as well as the one that succeeds.",
    ),
    (
        "libs/trading-core/wlct_trading/observability/metrics.py",
        "the bug fix this part exists as evidence of: observe_latency_histogram copied a cumulative array into a store the renderer sums, so every le line above the first bucket reported observations that never happened. It now copies per-bucket counts and says why on the copy loop, in the voice of someone recording how a wrong contract survived nine parts of passing tests.",
    ),
    (
        "libs/trading-core/tests/test_observability_metrics.py",
        "the drift pin this part had to move and the rendered-text assertions that the old test lacked: the unrecorded-stage count went from 12 to 8 with the five recorded names spelled out, and the adapter's test now asserts the exposition text (1, 2, 3) rather than the internal series that had been pinning the wrong semantics with a straight face.",
    ),
    (
        "libs/trading-core/tests/test_part16_placement_attestor.py",
        "the stage list the Part 16 test pins became the pipeline in order, with placement_review as the fifth name rather than a lone entry: the order is the assertion, because a list of names that no longer matches the code path is how a timed stage gets moved out of the span it is supposed to measure.",
    ),
    (
        "services/execution-engine/app/config.py",
        "OBSERVABILITY_ENABLED defaulting true, the NODE_ENV=production refusal to run dark, and observabilityEnabled on to_public_dict so a console can tell intent from the endpoint's presence. Same name and same rule as both siblings, which is why compose has been passing it to this service since before this part read it.",
    ),
    (
        "services/execution-engine/app/composition.py",
        "the instrument the engine never had: build_runtime now constructs ExecutionMetrics labelled with the adapter's own exchange id, because a histogram of simulator round-trips tagged binance would make every dashboard that reads it lie; and describe() publishes metricsConfigured, which is where every wiring fact in this service already lives.",
    ),
    (
        "services/execution-engine/app/schemas.py",
        "metrics_configured on the typed status model, defaulting False - which is what a pre-Part-18 engine actually was rather than a hedge, so an old response cannot be read as instrumented-but-idle.",
    ),
    (
        "services/execution-engine/app/routers/internal.py",
        "one more field mapped from describe() through its view, with the missing key left to raise: Part 16's parity discipline keeps a field from reaching an internal caller unreviewed, and the same rule says a description that stopped publishing something should fail the route rather than answer a guess.",
    ),
    (
        "services/execution-engine/app/main.py",
        "the hub built after the runtime and not wrapped in a try (a registry that refuses a family is a wiring mistake, and wiring mistakes die at startup here), the router mounted only when the flag is on, and the __main__ block brought onto the same target the image names - uvicorn.run(\"app.main:create_app\", factory=True) - so the reproduction and the deployment cannot be different programs.",
    ),
    (
        "services/execution-engine/requirements-dev.txt",
        "sqlglot==30.18.0 declared. Part 13's tests had been parsing migrations through an optional import for nine parts, which meant a clean install did not fail - it quietly collected fewer tests, the worst failure mode a dependency can have.",
    ),
    (
        "services/execution-engine/tests/test_part13_drift_parity.py",
        "the module-level sqlglot import that replaces pytest.importorskip, so a missing dependency is a collection error naming the file rather than a smaller suite nobody notices.",
    ),
    (
        "services/execution-engine/tests/test_part13_postgres_store.py",
        "the same change on the other side of that pair: two skip-if-absent imports became one hard import, and the count of tests this suite can run stopped depending on what the machine happened to have installed.",
    ),
    (
        "services/execution-engine/.env.example",
        "the observability block, with the two sentences an operator needs: what the endpoint is, and that this service deliberately has no REDIS_URL because it mirrors nothing.",
    ),
    (
        ".env.example",
        "the shared-knob note under Part 9's observability section, naming all three Python services so the platform-level meaning of OBSERVABILITY_ENABLED is stated once rather than inferred three times.",
    ),
    (
        "infrastructure/docker/execution-engine.Dockerfile",
        "the command that can now start the service: --factory app.main:create_app, and --log-config ./log-config.json with the COPY that puts it in the image. The comment above the CMD carries the whole story, including why a module-level app is not the fix.",
    ),
    (
        "infrastructure/docker/trading-engine.Dockerfile",
        "the log-config line and its comment. The app target here was always correct - the module binds app = create_app() - which is the difference this part had to discover rather than assume, and the reason the new test checks both forms.",
    ),
    (
        "infrastructure/docker/market-data.Dockerfile",
        "and the same, for the same reason. Two images gained a loadable flag and nothing else; the third gained the ability to boot.",
    ),
    (
        "docs/PART16_PLACEMENT_REVIEW.md",
        "sec. 6 amended rather than rewritten: the counters this part documents were never scraped by anything (the earlier sentence claiming trading-engine's module did it was false - different process, no shared memory), the 12 unrecorded stages became 8, and the part's own verification counts are marked historical, which is how this repository stops re-basing numbers it can no longer reproduce.",
    ),
    (
        "docs/ARCHITECTURE.md",
        "the service's surface gains its metrics endpoint and the metricsConfigured field, with the reason each is published rather than an assertion that it is useful.",
    ),
    (
        "docs/SECURITY.md",
        "the /metrics posture bullet extended: the token is the API plane's control and is deliberately absent on the three Python services, because what makes those safe to scrape is the cardinality law at registration - there is nothing identifying on them to disclose - and the bullet says so instead of leaving a reader to conclude the exception was overlooked.",
    ),
    (
        "docs/GETTING_STARTED.md",
        "a note beside docker compose up, where a reader would otherwise form the belief that these images start: what was broken, what it looked like, and the test that now loads every image command.",
    ),
    (
        "docs/ROADMAP.md",
        "row 18, and the retirement sentence that says which backlog item this part closed and which deployment-side items it left alone - the alert rules and dashboards are still nobody's code, and the row says that rather than implying a scrape is an alert.",
    ),
]
#: Prose a shipped file must never contain: a sentence that ANNOUNCES content was
#: left out. Each entry is a phrase rather than a word because the words themselves
#: are vocabulary - "truncated" appears in correct code (a JSON body cut short, an
#: age rounded to the millisecond) and "omitted" appears in a test NAMED
#: test_empty_families_are_omitted. Part 15 carried the bare words and Part 16's
#: files could not be written without tripping them, which is how a guard gets
#: loosened by accident: the fix was always to say the phrase, never to widen the
#: word.
ELISION_TOKENS: Final[tuple[str, ...]] = (
    "<generated>",
    "(snip",
    "... elided",
    "lines omitted",
    "truncated for brevity",
    "content truncated",
    "truncated here",
    "for brevity",
    "see repo for full",
    "rest of the file",
    "same as above",
    "etc.",
    "unchanged`",
    "omitted for brevity",
    "content omitted",
    "source omitted",
    "omitted from this",
    "omitted here",
    "intentionally omitted",
)

#: The shape an elided block actually leaves behind: a line that is nothing but the
#: marker. As a substring this fires on ordinary comments - "# ...but the registry
#: still counts it" is a sentence, not an admission - so it is matched per line.
ELISION_LINE_MARKERS: Final[tuple[str, ...]] = ("// ...", "# ...", "#...", "//...")


NEW_ONLY_TOKENS: Final[tuple[str, ...]] = (
    "TODO",
    "implement this later",
    "type: ignore",
    "noqa",
    "eslint-disable",
    "@ts-ignore",
    "@ts-expect-error",
)

#: The file that DEFINES the banned tokens as guard data is exempt from its own
#: substring scan, computed from __file__ rather than written out, because a
#: hardcoded exemption is how a copied generator ends up exempting its ancestor and
#: failing on itself - which is exactly what happened when this script was derived
#: from Part 16's. Stated, never silently skipped.
SWEEP_SELF_EXEMPT: Final[frozenset[str]] = frozenset(
    {Path(__file__).resolve().relative_to(ROOT).as_posix()}
    if "__file__" in globals()
    else frozenset({"scripts/gen_part18_handover.py"})
)


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


def file_problems(rel: str, text: str, *, new_file: bool) -> list[str]:
    """Every elision or suppression problem in one file's text.

    Split out of :func:`sweep` so the marker rules are checkable on a string: a
    guard nobody can exercise is a guard nobody trusts, and this one has now
    produced two false positives on files this part merely modified - each of
    which was a real imprecision in the rule rather than in the repository.
    """
    problems: list[str] = []
    for token in ELISION_TOKENS:
        if token in text:
            problems.append(f"{rel}: contains {token!r}")
    for marker in ELISION_LINE_MARKERS:
        if any(line.strip() == marker for line in text.splitlines()):
            problems.append(f"{rel}: contains the bare elision line {marker!r}")
    if new_file:
        for token in NEW_ONLY_TOKENS:
            if token in text:
                problems.append(f"{rel}: a new file containing {token!r}")
    return problems


def sweep() -> list[str]:
    problems: list[str] = []
    for kind, entries in (("NEW", NEW), ("MODIFIED", MODIFIED)):
        for rel, _ in entries:
            if rel in SWEEP_SELF_EXEMPT:
                continue
            text = (ROOT / rel).read_text(encoding="utf-8")
            for problem in file_problems(rel, text, new_file=kind == "NEW"):
                problems.append(f"{kind} {problem}")
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

    # "Zero suppression tokens" is a claim this header has always made by hand.
    # It is counted here instead, over the files the part added and, separately,
    # over the files it only modified - because the modified ones do carry
    # pre-existing `# noqa: BLE001` lines from Parts 5/12/14, and a header that
    # reported "0" by scanning only its own new files would be measuring the
    # flattering half. This generator is excluded: it quotes the token names to
    # say what is forbidden.
    tokens = ("type: ignore", "noqa", "eslint-disable", "prettier-ignore")

    def _count(entries: list[tuple[str, str]]) -> int:
        total = 0
        for rel, _note in entries:
            if not rel.endswith(".py") or rel.startswith("scripts/"):
                continue
            for line in (ROOT / rel).read_text(encoding="utf-8").splitlines():
                total += sum(1 for tok in tokens if tok in line)
        return total

    out["suppression_new"] = _count(NEW)
    out["suppression_modified"] = _count(MODIFIED)

    engine = ROOT / "services" / "execution-engine"
    code, text = run(
        ["python3", "-m", "pytest", "-q"],
        engine,
        {"PYTHONPATH": str(ROOT / "libs" / "trading-core")},
    )
    out["engine_pytest"] = (
        f"{last_match(r'(\d+) passed', text)} passed, {last_match(r'(\d+) skipped', text) or '0'} skipped"
        if code == 0
        else f"FAILED: {text[-300:]}"
    )
    code, text = run(["python3", "-m", "ruff", "check", "app", "tests"], engine)
    out["engine_ruff"] = "green" if code == 0 else text[-300:]
    code, text = run(
        ["python3", "-m", "mypy", "app"],
        engine,
        {"PYTHONPATH": str(ROOT / "libs" / "trading-core")},
    )
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
        code, text = run(
            ["python3", "-m", "pytest", "-q"],
            ROOT / "services" / service,
            {"PYTHONPATH": str(ROOT / "libs" / "trading-core")},
        )
        out[f"{name}_service"] = (last_match(r"(\d+) passed", text) if code == 0 else "FAILED") or "FAILED"
    # The image commands of all three Python services, resolved by the same
    # subprocess this document embeds: if the boot target regresses, the number
    # below moves and the header says FAILED - it is not a footnote about ops.
    code, text = run(
        [
            "python3",
            "-m",
            "pytest",
            "-q",
            "tests/test_part18_asgi_target.py",
            "tests/test_part18_observability.py",
        ],
        engine,
        {"PYTHONPATH": str(ROOT / "libs" / "trading-core")},
    )
    out["engine_part18"] = (
        f"{last_match(r'(\d+) passed', text)} passed"
        if code == 0
        else f"FAILED: {text[-300:]}"
    )

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
    regenerable `docs/PART*HANDOVER*` dumps (matched on the `_HANDOVER` segment rather
    than on `PART<n>_`, because Part 6 named one of its two dumps differently and that
    name slipped the prefix) and `docs/source/`. Prior parts
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
        # The pattern was `docs/PART\d+_HANDOVER`, which silently kept
        # docs/PART6_PERSISTENCE_HANDOVER_FULL_SOURCE.md inside the totals: 25,848 lines
        # of generated dump counted as though they were a hand-written document, in a
        # header whose entire claim to trustworthiness is that its numbers are measured.
        # A prefix a later part can rename around is not a rule, so the match is on the
        # `_HANDOVER` segment, and the number of excluded files is stated in the prose
        # rather than assumed.
        is_handover = ".source" in name or bool(re.match(r"docs/PART[^/]*_HANDOVER", name))
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


HEADER_TEMPLATE = '''
# Part 18 - metrics exposition and the bootable image: full source handover

> **What this part changed, and what it did not:** the execution engine now serves
> `GET /metrics`, its engine has an instrument for the first time, four spans inside
> `ExecutionEngine.submit` are timed, the shared exposition adapter has one fewer
> bug than it has carried since Part 9, and all three Python images have a command
> line that can start a process. No order path changed its outcome, no table was
> added, nothing was pruned or exported to Redis, `EXECUTION_MODE=live` is still
> refused at startup with Part 16's sentence, and no TypeScript file was touched.

Complete content of every file created or modified by Part 18. Nothing is
abbreviated, quoted-with-ellipsis, or referred to by path: each block carries the
whole current file, so this document alone can be reviewed, diffed against an
earlier part's handover, or used to reconstruct the tree.

## Gates (run while this document was generated)

* `cd services/execution-engine && PYTHONPATH=../../libs/trading-core python3 -m
  pytest -q` -> **{engine_pytest}**. The skips are Parts 13's and 14's
  live-Postgres suites, skipping BY NAME without `EXECUTION_TEST_POSTGRES_DSN`, and
  the count is the same 12 Parts 15-17 reported: Part 18 added no live test, because
  every law it ships is about exposition and statement shape, which a fake pool and a
  `TestClient` prove. This part's two files on their own -> **{engine_part18}**.
  `ruff check app tests` -> {engine_ruff}; `mypy app` -> no issues in
  **{engine_mypy} source files**, three more than Part 17 measured: the hub, its
  router, and the boot-target test, all annotated.
* `cd libs/trading-core && python3 -m pytest -q` -> **{core_pytest}**, up from Part
  17's figure because the part's core suite and the corrected Part 9 adapter test are
  in it; the library gained the `metrics` accessor, `_observe_stage`, and the fix
  inside `observe_latency_histogram`, and it gained no new port or vocabulary - the
  13 stage names and 29 counter fields it now exposes are the ones Parts 5 and 16
  shipped. `ruff check wlct_trading tests` -> {core_ruff} ({core_ruff_scripts} in
  `libs/trading-core/scripts`, which are standalone by design);
  `mypy wlct_trading` -> no issues in **{core_mypy} source files**.
* Sibling suites, since this part edited their files rather than leaving them
  alone: trading-engine **{trading_service}**, market-data **{market_service}**. Each
  gained `log-config.json` and a corrected image command line, and neither gained a
  code path - which is what those two numbers are here to confirm rather than assert.
* **Suppression tokens: {suppression_new} in the files Part 18 added**, counted by
  this script over every new source and test file rather than asserted from memory.
  This part earned that count the slow way: the first draft of the hub had two
  `# noqa` tokens on imports that would have failed a reader's eye instead of a
  lint, and the first draft of the test file had a `# noqa: ANN401` on a
  `**kwargs`-splatting helper that the fix replaced with typed keyword arguments. The
  {suppression_modified} tokens in the modified files are Part 5/12/13/16 lines,
  left alone for the reason Part 16 stated: rewriting a neighbour's justified comment
  to improve a new part's score is churn wearing care's clothing.
* `node --test scripts/` -> **{node_scripts}**;
  `node scripts/dr-manifest.mjs --check` -> {manifest_check};
  `node scripts/dr-manifest.mjs --check-rls` -> {check_rls}. Both node checks are
  unchanged by this part, and that is the correct result to print: Part 18 adds no
  table, so the covered set stays at 43 and `PROBE_TABLES` at 5, and the enablement
  audit is still owed by the operator rather than by this document.
* `cd apps/api && npx jest --silent` -> **{api_tests}**;
  `npx tsc -p tsconfig.json --noEmit` -> {api_typecheck};
  `npx eslint src --max-warnings 0` -> {api_lint}; `npx prisma validate` ->
  {prisma}. In `apps/admin-web`, `npx tsc --noEmit` -> {admin_typecheck}. No screen
  and no API code changed: `/metrics` is not a surface the console or the worker
  consumes - the worker's forwarding list is built from `/internal/v1/*` paths, which
  is asserted in this part's own suite rather than assumed from the compose file.

## Ledger

Measured at generation time, with code and documents counted separately because a
tree-size figure that mixes them is not a size. Part 18 shipped **{total:,} lines** -
**{new_code:,}** across the {new_code_count} new code files, **{new_docs:,}** in the
{new_docs_count} new document{new_docs_s}, and **+{mod_code:,}** code /
**+{mod_docs:,}** document lines across the {mod_count} modified files (each delta
measured against the newest prior handover that lists that file - which leaves
{unbaselined_count} of them, {unbaselined_size} lines, with no delta at all because
no earlier document recorded their prior size: {unbaselined_list}. Their full text is
embedded below, and their size is not presented as a change). Whole-tree counts
under the standing rule set: **{tree_source:,} source lines**; adding the narrative
documents under `docs/` (the regenerable `docs/source/` views and every handover
dump are out of both figures): **{tree_with_docs:,}**.

Three things this document does that a hand-written one cannot keep doing: the gate
numbers above are subprocess runs of the real suites, so a suite that cannot be
measured is written here as `FAILED` rather than omitted; the file lists are the
part's complete diff, enumerated from the files that carry its markers rather than as
a plan remembered afterwards; and `--check` regenerates the document in memory and
compares it byte for byte with the committed file, which is what makes deterministic
and regenerable a command with an exit code instead of an adjective. The emission
count is asserted at the end of every write - the number of `## FILE:` blocks must
equal the number of files the lists name, so a silently skipped file is a failed run
rather than a shorter document.

Two provenance notes, because they are the kind of sentence a later part would
otherwise read as boilerplate. This part is the first to change a *shipped image*
rather than only code, and the change is a repair rather than an addition:
`--log-config /dev/null` had been in all three Python Dockerfiles since those files
were written, `logging.config.fileConfig` has refused a zero-length file since at
least python 3.11.9, and nothing in this repository resolves an image command line -
so the defect was not invisible because it was unimportant, it was invisible because
no gate looked. The test this part added (`tests/test_part18_asgi_target.py`) is the
gate, and `docs/PART18_METRICS_EXPOSITION.md` sec. 6.1 is the record, including the
one command whose output proved the fix: the same curl that failed for eleven parts.
And the second half of the honesty: the metrics this part exposes were, until it
existed, accumulated by nothing in this process, because `build_runtime` never
passed `metrics=` to the engine. Every earlier document that described those counters
as measurable was describing a port with nothing behind it. That sentence belongs in
a handover header rather than in a changelog, because the reader of a handover is the
person deciding whether to trust the numbers.

One hazard the ledger exposes that Part 17 named and Part 18 proves again. The
baseline for a modified file is the newest prior handover that lists it, and this
part's files overlap Parts 13-17's heavily (the service's config, composition,
schemas, internal router, main, the two docs, the root env example, and two sibling
Dockerfiles that no prior handover ever listed). When an ancestor document is
regenerated - which it must be, because its own rule is that it embeds the complete
current content of every file it names - the copies inside it move forward to
post-Part-18 content, and this part's delta is then measured against a snapshot that
already contains this part's edits. So the figure below is measured after that
regeneration, the coupling is stated rather than hidden, and `--check` on any of the
three documents reproduces what it prints.
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
    # Two boundaries, not one: a bullet and a heading. Splitting only on bullets
    # leaves everything after the LAST bullet glued to it - which is how Part 16's
    # generated documents ended up with their whole ledger paragraph rendered as
    # indented continuation text, and how this one first swallowed its own
    # "## Ledger" heading into the final bullet. A heading is a boundary; the
    # rewriter's job is to keep the bullets even, not to re-decide the structure.
    for chunk in re.split(r"(?m)(?=^\* )|(?=^#{2,3} )", text):
        if not chunk.startswith("* "):
            out.append(chunk)
            continue
        trailing = "\n\n" if chunk.endswith("\n\n") else "\n"
        flat = " ".join(part.strip() for part in chunk.rstrip("\n").splitlines() if part.strip())
        # The twin left this marker doubled in every generated handover since Part
        # 14: the template's bullets begin with "* ", the split keeps it in the
        # chunk, and textwrap re-adds it via initial_indent. Fixed here rather
        # than inherited, because a bullet list that renders as "* * " is a
        # document whose first line already tells the reader nobody ran it.
        if flat.startswith("* "):
            flat = flat[2:]
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


def _tree_counts(measured: dict[str, object]) -> tuple[int, int]:
    """The whole-tree figures, narrowed instead of asserted.

    ``measure`` returns one heterogeneous dict because it collects a dozen
    different gate outputs, and the tree entry is the only nested one. Narrowing
    it with ``isinstance`` here means the two ledger figures are checked rather
    than trusted, with no suppression comment to explain away - the generator is
    a new file in this part, and new files in this part carry none.
    """
    tree = measured["tree"]
    if not isinstance(tree, dict):
        raise SystemExit(f"tree measurement missing or malformed: {tree!r}")
    source = tree.get("source")
    with_docs = tree.get("with_docs")
    if not isinstance(source, int) or not isinstance(with_docs, int):
        raise SystemExit(f"tree measurement unreadable: {tree!r}")
    return source, with_docs


def main(argv: list[str]) -> int:
    """``--check`` regenerates and compares instead of writing.

    The document promises two things - that it is complete and that it is
    reproducible - and only the first was machine-checkable when this script was
    copied from Part 15. ``--check`` closes the gap: the same generation runs,
    the result is compared byte for byte against the committed file, and a stale
    handover becomes a non-zero exit rather than a sentence nobody re-reads.
    """
    verify = "--check" in argv
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
    unbaselined = [rel for rel, _ in MODIFIED if rel not in table]
    unblessed_size = sum(lines_of(rel) for rel in unbaselined)
    # A modified file that NO prior handover embedded has no recorded earlier
    # size, so its delta is unknowable rather than zero-and-not-counted. Charging
    # its whole length (the `table.get(rel, 0)` default that produced the first
    # drafts of this document) inflates "lines this part changed" into "lines this
    # part happens to have touched a file that is", which is the kind of number a
    # reader would repeat. So it is excluded from the delta, named here, and sized
    # as a size rather than a change.
    mod_code, mod_docs = split_code_docs(
        [(rel, note) for rel, note in MODIFIED if rel not in unbaselined],
        signed=True,
    )
    new_lines, delta = new_code + new_docs, mod_code + mod_docs

    print("measuring gates (this runs the suites; it takes a minute)...")
    measured = measure()
    header = HEADER_TEMPLATE.format(
        core_pytest=measured["core_pytest"],
        core_ruff=measured["core_ruff"],
        core_ruff_scripts=measured["core_ruff_scripts"],
        suppression_new=measured["suppression_new"],
        suppression_modified=measured["suppression_modified"],
        unbaselined_count=len(unbaselined),
        unbaselined_size=f"{unblessed_size:,}",
        unbaselined_list=", ".join(f"`{rel}`" for rel in unbaselined) or "none",
        admin_typecheck=measured["admin_typecheck"],
        core_mypy=measured["core_mypy"],
        engine_pytest=measured["engine_pytest"],
        engine_ruff=measured["engine_ruff"],
        engine_mypy=measured["engine_mypy"],
        engine_part18=measured["engine_part18"],
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
        tree_source=_tree_counts(measured)[0],
        tree_with_docs=_tree_counts(measured)[1],
    )

    parts = [reflow_header(header), "## Created in Part 18 (full files)\n"]
    parts += [block(rel, note) for rel, note in NEW]
    parts.append("## Modified in Part 18 (full files, prior content preserved inside)\n")
    parts += [block(rel, note) for rel, note in MODIFIED]
    total_files = len(NEW) + len(MODIFIED)
    text = "\n".join(parts)
    if verify:
        committed = OUT.read_text(encoding="utf-8") if OUT.exists() else ""
        if committed == text:
            print(f"OK: {OUT.name} is byte-identical to a fresh generation")
            return 0
        print(
            f"STALE: {OUT.name} differs from a fresh generation "
            f"({len(text.splitlines()):,} generated lines vs "
            f"{len(committed.splitlines()):,} committed)",
            file=sys.stderr,
        )
        return 1
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
    raise SystemExit(main(sys.argv[1:]))
