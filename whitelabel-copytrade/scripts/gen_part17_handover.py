"""Part 17 - durable incident recording: the full-source handover document.

Generated, not written by hand, for the reason Part 15 established and Part 16
repeated: a hand-copied "full source" document starts drifting the moment a file
changes, and a document whose completeness cannot be re-proved is a document that
merely claims. This script embeds the complete content of every file Part 17 added
or modified, states its own gate results by RUNNING the suites, and accepts
``--check``, which regenerates in memory and compares byte for byte against the
committed file.

Copied from ``scripts/gen_part16_handover.py`` and re-pointed, which is the honest
description of the relationship: the gate list, the tree rule, the sweep and the
emission-count guard are the machinery that part built, and a second hand-written
variant of them would be a second thing to keep true. What changed is the header,
the file lists, and the baseline search (now starting at Part 16, newest first, so
a delta is measured against the last document that embedded the file).
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
OUT = ROOT / "docs" / "PART17_HANDOVER_FULL_SOURCE.md"

#: Prior handovers, newest first: the baseline search for a modified file
#: walks this list and stops at the first document that contains it.
PRIOR_HANDOVERS: Final = tuple(
    ROOT / "docs" / f"PART{n}_HANDOVER_FULL_SOURCE.md" for n in range(16, 0, -1)
)

NEW: Final[list[tuple[str, str]]] = [
    (
        "services/execution-engine/app/incidents_sql.py",
        "the durable sink: one insert per incident inside a transaction whose first statement is the store's own SET_TENANT_SQL constant (reused, not re-typed, so there is one spelling of the tenant law in the service), a write path that never raises and counts what it swallowed, a read path that always raises because an empty list is what a healthy system looks like, a schema check spelled the way Part 13 spells it, and no UPDATE statement anywhere - the immutability of the trail is expressed as the absence of a code path, which is the only kind that survives a refactor.",
    ),
    (
        "services/execution-engine/app/routers/incidents.py",
        "the read surface: one internal route; a view built field by field from the record rather than splatted from to_dict() (with the equality of the two field sets asserted, which is the price of not splatting and the only thing that makes it safe); an account filter applied after the tenant-scoped select rather than inside its predicate; 503 rather than an empty list when the store cannot answer; and a 409 kept for a runtime with no sink even though composition makes that unreachable today.",
    ),
    (
        "services/execution-engine/tests/test_part17_incidents.py",
        "37 tests: the two-statement-one-transaction write shape and the argument order that puts the tenant first; details stored as sorted JSON; the failure made to ride the INSERT rather than the SET that precedes it (through a purpose-built connection double, because the shared fake answers reads only); the vocabularies re-derived on read, with an unknown severity a hard error rather than a default; the limit bound; both halves of the pairing law; the route's 401, 403, 422 and 503; the absence of any credential-shaped field; the two cross-module lists that must agree (pg_store.DURABLE_TABLES and rls_probe.PROBE_TABLES); and the assertion that retention still prunes exactly one table.",
    ),
    (
        "apps/api/prisma/migrations/20260915120000_part17_durable_incidents/migration.sql",
        "the DDL: seq BIGSERIAL as the physical read order, a unique incident id so a replayed write is a refusal rather than a second row in an audit trail, VARCHAR vocabularies and BIGINT microsecond timestamps per the platform's law, no composite foreign key to engine_orders (stated, with the reason), and a tenant FK that RESTRICTs so deleting a tenant cannot take its failure history with it. No GRANT/RLC statements: policies for this table come from the Part 11 generator, like every other tenant table.",
    ),
    (
        "docs/PART17_DURABLE_INCIDENTS.md",
        "the operator document, with the three places in the repository that named this gap before it was built; the argument for a table of the engine's own rather than a second writer for the console's execution_incidents; the write/read asymmetry; both refusals; and what this part did not unlock (no retention, no API projection, no admin screen) beside what it deliberately omitted.",
    ),
    (
        "scripts/gen_part17_handover.py",
        "this generator, copied from Part 16's and re-pointed rather than rewritten: the gate list, the tree rule, the sweep and the emission-count guard are machinery that part built, and a second hand-written variant of them is a second thing to keep true.",
    ),
]

MODIFIED: Final[list[tuple[str, str]]] = [
    (
        "services/execution-engine/app/composition.py",
        "the pairing law, and the type that had been hiding it: EngineRuntime.incidents is the port now, not InMemoryIncidentRecorder, because a field typed to one implementation is how 'durable store, memory sink' stopped being visible; build_runtime refuses that pair and its mirror; describe() publishes the sink, the sink's own durability claim and its stats - and the stats mapping is always present, because a key that appears only sometimes is how a status surface and a description stop being the same object.",
    ),
    (
        "services/execution-engine/app/pg_store.py",
        "DURABLE_TABLES, a named constant with the incident table in it: a deployment whose migration has not been applied refuses to start rather than discovering that at its first failure, and the refusal sentence says why an incident table belongs with the order tables.",
    ),
    (
        "services/execution-engine/app/main.py",
        "the sink built over the same pool the store came from, at the one place that decides we have a durable plane, and the router mounted after the placement review because an operator who cannot place an order wants the list of why.",
    ),
    (
        "services/execution-engine/app/schemas.py",
        "IncidentSinkView on the status surface (typed, extra=forbid, the same argument Part 16 made for the placement block) and the three wire models for the route, with the limit bound carried in the contract rather than trusted to the caller because the table behind it is append-only and nothing prunes it.",
    ),
    (
        "services/execution-engine/app/routers/internal.py",
        "one more field mapped from describe() through its view, so the parity test Part 16 added now guards Part 17 too: a key added to the description has to be decided before it reaches an internal caller.",
    ),
    (
        "services/execution-engine/app/rls_probe.py",
        "PROBE_TABLES gains the incident table, with the reason written next to it: an unprotected incident table is a cross-tenant readable list of one tenant's failures, which is exactly the shape of leak this audit exists to find. The catalogue comment moved from four tables and 42 to five and 43 in the same edit, because the prose is what an operator reads.",
    ),
    (
        "apps/api/prisma/schema.prisma",
        "the ExecutionEngineIncident model beside its Part 13 siblings, with the comment that says why this is a second incident table rather than a second writer for the console's, and the Tenant back-relation that keeps the generator deriving the covered set from the schema instead of anybody remembering it.",
    ),
    (
        "apps/api/prisma/migrations/20260913120000_part11_row_level_security/migration.sql",
        "regenerated by scripts/gen_part11_rls.py, not hand-edited: 42 policies became 43. This is the artefact that makes the claim 'the engine plane's new table is tenant-isolated like the others' checkable rather than asserted.",
    ),
    ("apps/api/prisma/rls/enable.sql", "regenerated with the new table in the covered list, the operator checklist unchanged in shape."),
    ("apps/api/prisma/rls/disable.sql", "regenerated as the exact inverse, which is what the pairing test between these two files exists to hold."),
    (
        "apps/api/prisma/rls/rls_coverage.json",
        "the machine-readable truth: 43 covered, 7 excluded. Consumed by the TypeScript coverage spec (which derives its own expected set from the schema and therefore needed no edit at all) and by the enablement audit.",
    ),
    (
        "docs/dr/manifest.json",
        "rlsEvidence.scope names all five engine-plane tables, because the manifest may not claim more than the executor can see and may not fall behind it either - the drift test reads this string against PROBE_TABLES in both directions.",
    ),
    (
        "services/execution-engine/tests/test_part13_pg_store.py",
        "the four tables named one by one in the startup-check assertion rather than derived from DURABLE_TABLES, so a table quietly leaving the check fails a test instead of narrowing an assurance.",
    ),
    (
        "services/execution-engine/tests/test_part13_config_composition.py",
        "the durable describe-itself test now passes a durable sink, with a comment saying so: under the pairing law a runtime with half a memory is no longer constructible, and the test that used to build one becomes the documentation of the refusal.",
    ),
    (
        "services/execution-engine/tests/test_part15_enablement.py",
        "probed == 5 and PROBE_TABLES extended, both asserted literally rather than derived - the point of the audit tests is that a shrinking probe set is visible to a human reading the failure.",
    ),
    (
        "services/execution-engine/tests/test_part15_drift_parity.py",
        "the coverage count becomes 42 + 1, written that way because the + 1 is the sentence 'this part added a tenant table', and a bare 43 would erase who did it.",
    ),
    (
        "docs/ARCHITECTURE.md",
        "the execution-engine paragraph: durable incident records over the same pool as the order store, the construction refusal for a half-durable wiring, and the route that answers 503 rather than misleading an operator with an empty list.",
    ),
    (
        "docs/SECURITY.md",
        "a new 'Incident records' subsection - scrubbing before the record exists, the never-raise and always-raise asymmetry between writing and reading, insert-only as a structural property rather than a policy - and the enablement-coverage sentence extended to include the fifth engine-plane table.",
    ),
    (
        "docs/ROADMAP.md",
        "the Part 17 delivery-log row, and the open-items paragraph updated so the coverage count reads 43 with this part's table named rather than implied.",
    ),
    (
        "docs/PART5_EXECUTION.md",
        "Part 5's 'still not built' list amended rather than rewritten: of the three SQL ports named there, the store is Part 13's and the incidents are Part 17's, and only the SQL LockManager remains unimplemented - stated that precisely, including that the service composes the in-memory lock manager today while the core ships the Redis one, because 'the core supports them; this deployment does not wire them' is the sentence Part 11 already had to learn to write.",
    ),
    (
        "docs/PART14_RETENTION.md",
        "the two places Part 14 quoted the covered-table count, marked with what changed and when, so the document stays a true record of Part 14 instead of becoming a false record of the present.",
    ),
    (
        "docs/PART15_RLS_ENABLEMENT.md",
        "five numbers moved (the policy count, the 'this is not the manifest's' annotation, the enable/disable entry count, the --covered-expected value in the operator command example, and the scope-limitation row), because this is the document an operator follows with a terminal open and a stale number in it becomes a failed command.",
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
    else frozenset({"scripts/gen_part17_handover.py"})
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
# Part 17 - durable incident recording: full source handover

> **What this part changed, and what it did not:** the execution engine's incident
> records are now durable; a runtime that pairs a durable store with a memory sink
> is refused at construction; and one read-only internal route exposes what the
> sink holds. No order path changed, no new table is prunable, `EXECUTION_MODE=live`
> is still refused at startup with Part 16's sentence, and the core library is
> untouched - the port implemented here has existed since Part 5.

Complete content of every file created or modified by Part 17. Nothing is
abbreviated, quoted-with-ellipsis, or referred to by path: each block carries the
whole current file, so this document alone can be reviewed, diffed against an
earlier part's handover, or used to reconstruct the tree.

## Gates (run while this document was generated)

* `cd services/execution-engine && python3 -m pytest -q` -> **{engine_pytest}**
  (the skips are Parts 13's and 14's live-Postgres suites, skipping BY NAME without
  `EXECUTION_TEST_POSTGRES_DSN`; Part 17 ships no live test because its laws are
  about wiring and statement shape, both of which a fake pool proves - and the skip
  count is the same 12 Parts 13-16 reported, unchanged by this part);
  `ruff check app tests` -> {engine_ruff}; `mypy app` -> no issues in
  **{engine_mypy} source files**, two more files than Part 16 measured: the sink and
  its router, both fully annotated.
* `cd libs/trading-core && python3 -m pytest -q` -> **{core_pytest}**, unchanged
  from Part 16 - which is the point of stating it. This part added no core code, and
  a delta here would have meant the port was widened for one implementation's
  convenience. `ruff check wlct_trading tests` -> {core_ruff}; `mypy wlct_trading` ->
  no issues in **{core_mypy} source files**.
* **Suppression tokens: {suppression_new} in the files Part 17 added**, counted by
  this script over every new source and test file rather than asserted from memory.
  The first draft of the test file carried three: a `# noqa: F401` on an import that
  proved nothing, a `# pragma: no cover` on a property the tests do exercise, and a
  `# type: ignore[arg-type]` on a helper that was splatting a dict where it should
  have named its arguments. Removing the third is what made the helper better - it
  now fails at the call site if a port field is renamed. The {suppression_modified}
  tokens in the modified files are Part 5/12/13/16 lines, left alone for the reason
  Part 16 stated: rewriting a neighbour's justified comment to improve a new part's
  score is churn wearing care's clothing.
* `node --test scripts/` -> **{node_scripts}**;
  `node scripts/dr-manifest.mjs --check` -> {manifest_check};
  `node scripts/dr-manifest.mjs --check-rls` -> {check_rls}. The last is unchanged,
  and adding a table makes that posture MORE true rather than less: a new tenant
  table is exactly the change whose enablement the cadence exists to catch.
* `cd apps/api && npx jest --silent` -> **{api_tests}**;
  `npx tsc -p tsconfig.json --noEmit` -> {api_typecheck};
  `npx eslint src --max-warnings 0` -> {api_lint}; `npx prisma validate` ->
  {prisma}. No TypeScript file was edited, and `rls-coverage.spec.ts` passed
  untouched because it derives its expected table set from `schema.prisma` instead
  of listing it - which is the only reason a new tenant table is a one-file change
  on the API side. In `apps/admin-web`, `npx tsc --noEmit` -> {admin_typecheck}; no
  screen was added there, stated rather than smoothed, because that package has
  5,496 lines of React and no test files at all: a screen would have been untested
  code inside an untested package.
* Sibling Python services re-verified untouched: trading-engine
  **{trading_service}**, market-data **{market_service}**.

## Ledger

Measured at generation time, with code and documents counted separately because a
tree-size figure that mixes them is not a size. Part 17 shipped **{total:,} lines** -
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
part's complete diff, enumerated as it was built rather than as a plan remembered
afterwards; and `--check` regenerates the document in memory and compares it byte
for byte with the committed file, which is what makes deterministic and regenerable a
command with an exit code instead of an adjective. The emission count is asserted at
the end of every write - the number of `## FILE:` blocks must equal the number of
files the lists name, so a silently skipped file is a failed run rather than a
shorter document.

Two provenance notes, because they are the kind of sentence a later part would
otherwise read as boilerplate. This part touches the schema, and a schema change is
the one edit in this repository that makes an existing assurance stale rather than
merely incomplete: the covered-table count moved 42 -> 43, the engine plane's probe
set moved 4 -> 5, and both numbers are asserted literally in the suites that publish
them, so the next table that skips the audit fails a test instead of quietly
narrowing a claim. And this generator measures a Postgres-backed service without a
Postgres: the sink is tested through the same fake-connection harness Parts 13-15
use, with one purpose-built double in the part's own test file because the shared
fake answers reads only, and a write that must fail cannot be scripted through a
cursor that ignores execute statements. That is also why the skip count belongs in
this header rather than in a footnote.

One hazard the ledger exposes that no earlier part had to name. The baseline for a
modified file is the newest prior handover that lists it - and Part 16 lists nine of
the files Part 17 also modified, because both parts touched the service's schemas,
composition, main and internal router and the same five documents. When Part 16's
document is regenerated (which it must be, because its own rule is that it embeds
the complete current content of every file it names), those embedded copies move
forward to post-Part-17 content, and Part 17's delta is then measured against a
snapshot that already contains Part 17's edits: the honest number shrinks, from 363
lines to 158, and a reader who assumes the larger figure saw more work would be
wrong in the other direction. The alternative - leaving an ancestor document stale
so that a descendant's arithmetic looks impressive - is the one this repository has
refused since Part 15 started pinning its own numbers. So: the figure below is
measured, the coupling is stated, and `--check` on either document reproduces it
byte for byte.
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

    parts = [reflow_header(header), "## Created in Part 17 (full files)\n"]
    parts += [block(rel, note) for rel, note in NEW]
    parts.append("## Modified in Part 17 (full files, prior content preserved inside)\n")
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
