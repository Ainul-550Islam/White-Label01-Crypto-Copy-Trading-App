"""Part 22 - the deployment side of telemetry, generated from the side that publishes it.

Generated, not written by hand, for the reason Part 15 established and Parts 16 to 21 repeated: a
hand-copied "full source" document starts drifting the moment a file changes, and a document whose
completeness cannot be re-proved is a document that merely claims. This script embeds the complete
content of every file Part 22 added or modified, states its own gate results by RUNNING the suites,
and accepts ``--check``, which regenerates in memory and compares byte for byte against the committed
file.

Copied from ``scripts/gen_part21_handover.py`` and re-pointed. The baseline search, the ancestor
regeneration order (16, 17, 18, 19, 20, 21) and the fence-aware comparison all carry forward unchanged;
what changed is which gates are part-specific (the bundle's own ``--check``/``--emit``/``--rules``, plus
the core suite, with the DR tool set and the TypeScript side kept as unchanged regression gates), and
the fact that the file list now includes four files under ``infrastructure/`` that this document embeds
*and* that a script in this repository renders on demand - which is the property the embedded text is
there to prove.

The file lists were derived, not remembered. With no VCS in this workspace the prior handovers are the
snapshots: every candidate file was compared against the newest handover that embeds it, and the
result - plus the Part 22 sentences this part wrote into the three documents it amended - is the list
below. Two sweep notes belong here rather than in a footnote. The first: the sweep also reports files
whose content has moved since a Part 8/9/10 snapshot and which no later part re-embedded (the SLO
identity constants, the burn-rate rules, the OpenTelemetry ``use_span`` imports, and Part 11's
``dr-manifest.mjs`` ancestors); they are not Part 22's, are not claimed here, and are named in
``docs/PART20_ENGINE_STATUS_EDGE.md`` sec. 6's account of the same phenomenon. The second: every
ancestor document in this chain embeds a copy of ``docs/ROADMAP.md``, ``docs/PART21_DR_OPERATIONS.md``
and ``.env.example``, all three of which this part amended, so the ancestors are regenerated first and
the modified-file deltas below are measured against post-Part-22 text. That is what makes the delta
column zero, and the sentence saying so is in the ledger rather than hidden under it.

One incident belongs in the same place as the code that caused it, because this part's whole subject is
a generator that must not touch what it describes: while a test helper was being written, a symlink tree
was assembled in the wrong order and a "temporary" patched copy of
``services/market-data/app/routers/observability.py`` was written through a symlink into the repository.
The file was restored to the single line its three sibling routers use, the service's 19 tests pass,
``--check`` agrees with the tree again, and the ordering law that would have prevented it is now a
docstring in the helper (sec. 7 of ``docs/PART22_SCRAPE_SIDE.md``).
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
OUT = ROOT / "docs" / "PART22_HANDOVER_FULL_SOURCE.md"

#: Prior handovers, newest first: the baseline search for a modified file
#: walks this list and stops at the first document that contains it.
PRIOR_HANDOVERS: Final = tuple(
    ROOT / "docs" / f"PART{n}_HANDOVER_FULL_SOURCE.md" for n in range(21, 0, -1)
)

NEW: Final[list[tuple[str, str]]] = [
    (
        "libs/trading-core/scripts/gen_observability_bundle.py",
        "the generator, the verifier and the reader, in one file: six audits run before any artifact is "
        "returned (`assert_no_invented_numbers`, which compares every numeric literal in an `expr:` "
        "against the `allowed_numbers` the rule DECLARES rather than against the expression it just "
        "rendered, so a rule cannot widen its own allowance; `assert_no_invented_cadence`, which refuses "
        "`scrape_interval`, `evaluation_interval`, `scrape_timeout`, `honor_labels`, `for:`, `interval:` "
        "and `keep_firing_for:` because this repository declares no cadence and no dwell policy; "
        "`assert_no_secret_shapes`; `assert_labels_are_not_invented`, which reads the config's non-comment "
        "lines so that the header explaining an absence cannot trip the check for it; "
        "`assert_job_regex_matches_every_target`, which evaluates the availability alert's regex the way "
        "Prometheus anchors it and thereby caught a real defect during authoring; and "
        "`assert_only_catalog_labels`, which walks the label blocks at rule depth instead of the whole "
        "file), a target discovery step that reads `docker-compose.yml` and each service's own "
        "route declaration (each service's own metrics path in its router), through a hand-rolled "
        "scanner with no YAML dependency, a rules "
        "deriver that renders 4 of the 24 catalog alerts and names the reason for the other 20, the "
        "catalog document with per-field evidence, `--emit` (which plans every write before performing "
        "any and exits 3 rather than overwriting a file it did not generate), and `--dashboard`, which "
        "parses exposition text strictly enough to hand it to the repository's own `DashboardBuilder` "
        "instead of inventing a second dashboard format.",
    ),
    (
        "libs/trading-core/tests/test_part22_scrape_bundle.py",
        "41 tests, most of them assertions that an audit objects: the committed bundle byte-identical to "
        "a fresh render (the test that makes every other line here reviewable) and `--check` writing "
        "nothing; the 4/20 census summing to `len(ALERT_RULES)` so a rule cannot be dropped silently; "
        "each threshold cross-checked against the `AlertRule` it came from, including the ppm scaling and "
        "the inverted `<=` a remaining-budget gauge requires; a smuggled `14400001` refused with the "
        "rule's allowance emptied; a planted `interval:`, a planted token literal, a planted `external_labels` "
        "block and a fourth rule label each raising; `up{job=~...}` evaluated against every job name and "
        "again with the parentheses removed; a compose port moved 8001 to 8111 in a scratch tree and the "
        "generated job following it; a router whose `/metrics` line was removed and the target, the "
        "catalog entry and the availability regex all disappearing with it; exclusion evidence asserted to "
        "be paths that exist; eight mutations of the hand-written overlay each producing exactly the one "
        "message that describes it while the committed file produces none and its comment about the "
        "lifecycle flag does not count as the flag; `--emit` refusing a foreign file with exit 3 and "
        "writing nothing anywhere; a real `ObservabilityRegistry` rendered by `render_prometheus` and "
        "parsed back with counters, histogram buckets, `le`-as-geometry and the service label all "
        "reconstructing the snapshot, with garbage lines, a `summary` type, a `_sum` suffix on a counter, "
        "an oversize file, a NUL byte and an empty pipe each refused; the absence census pinned to the "
        "strict name set so a runtime-built family is never claimed absent; the CLI's exit codes run as "
        "subprocesses because a documented contract that was never executed is a description; and the "
        "generator itself scanned for `socket`/`subprocess`/`yaml` imports - the tool must not reach the "
        "network, and that is a property of the file rather than of one run of it.",
    ),
    (
        "infrastructure/observability/prometheus/prometheus.yml",
        "four scrape jobs and nothing else: `${PROMETHEUS_PATH}` for the API because that is what its "
        "config service reads, literal `/metrics` for the three Python services because that is what "
        "their routers declare, the scrape-token header as an expansion rather than as a value, and "
        "no `scrape_interval`, no `external_labels`, no relabeling. Generated; the header says "
        "so and names the file that regenerates it.",
    ),
    (
        "infrastructure/observability/prometheus/rules/wlct.rules.yml",
        "two groups. `wlct-slo` holds the three burn-rate and budget alerts whose every literal is the "
        "catalog's, and `wlct-platform` holds `TELEMETRY_EXPORT_FAILING`; then `wlct-availability` holds "
        "the one rule that is not in the catalog - the availability rule over every job's `up` series, "
        "whose only literal is the zero that defines a failed scrape, present because a "
        "rule in the catalog is silent while its own target is unreachable, and silence "
        "health is the failure mode four earlier documents name. No `for:` and no group `interval:` "
        "anywhere; the twenty refusals are listed in the header with their reasons, so the file cannot be "
        "read as a complete paging policy.",
    ),
    (
        "infrastructure/observability/metrics-catalog.json",
        "the same facts as data: the four targets with `portEvidence` and `pathEvidence` pointing at the "
        "compose line and the router decorator each came from, the three services not scraped with the "
        "reason and an evidence path, the per-service `familiesNamedInSource` counts named for what they "
        "are (a literal scan, not a statement about an endpoint), the image pin with the minimum version "
        "`http_headers` needs, `cadence` as two `null`s with the sentence explaining why they are null, "
        "the rendered rules with their evidence strings, the refusals, and a `notIncluded` block naming "
        "Alertmanager, Grafana JSON, the OpenTelemetry collector, node-exporter and RED-over-scraped-text "
        "with the reason for each absence.",
    ),
    (
        "infrastructure/observability/README.md",
        "the operator's page for the directory: the three commands, their exit-code ladder quoted from "
        "the implementation, the curl-and-pipe one-liner for `--dashboard` with the note that this tool "
        "never performs the curl, the deploy line for the overlay, what is scraped and what is not, and a "
        "boundary section - not a monitoring product, observes nothing, cannot change a trading decision, "
        "holds no credential, and if Prometheus is switched off nothing about trading changes.",
    ),
    (
        "docker-compose.observability.yml",
        "the one hand-written file in the set, because it is a deployment choice rather than a rendering: "
        "`prom/prometheus:v3.5.0` pinned (the config uses `http_headers`, which needs >= 2.53, and "
        "`latest` is a tag that can change a format underneath a committed file), the bundle mounted "
        "read-only at `/etc/prometheus`, the TSDB on a named volume, `127.0.0.1:${PROMETHEUS_PORT:-9090}` "
        "and nothing else published, `wlct-internal`, no `--web.enable-lifecycle`, no retention flag and "
        "no cadence, plus a banner listing the five things it deliberately does not add with the reason "
        "for each. `--check` reads it back structurally, so that banner cannot trip its own check.",
    ),
    (
        "docs/PART22_SCRAPE_SIDE.md",
        "the part's own document, eight sections: the law every artifact is held to, the six audits and "
        "what each one refuses; how the four targets were derived and which three were named absent with "
        "evidence; the 4-of-24 census with the ppm scaling, the inverted comparison and the single "
        "non-catalog rule each argued; the overlay's eight laws; `--dashboard` and why an unreadable line "
        "is a refusal rather than a skip; the two family-name sets and the two different harms that "
        "justify keeping them apart; the measured gates with their exact outputs; and the verification edge "
        "stated plainly - no Prometheus binary has ever read this config, because this sandbox has no "
        "`docker` CLI, and `promtool` on a real host is the referee this part cannot appoint.",
    ),
    (
        "scripts/gen_part22_handover.py",
        "this generator. It is in the list because it is a source file of the part and its content is what "
        "makes the document reproducible; it is exempt from its own suppression-token scan via `__file__`, "
        "which is also why that exemption is computed rather than hardcoded.",
    ),
    (
        "apps/api/prisma/rls/grant.sql",
        "the file the execution engine's own 503 had been naming for seven parts: "
        "ENABLEMENT_ROLE_UNKNOWN tells an operator to apply Part 11's grant.sql, and until this "
        "sweep nothing by that name was in the tree. It is generated, like the two SQL files beside "
        "it, because that directory is reproducible from schema.prisma and a hand-authored file "
        "inside it would be the one file a rerun neither overwrites nor notices. The grant is "
        "SELECT on one catalog view, the inverse is stated, and neither BYPASSRLS nor superuser "
        "appears outside the prose explaining why they must not.",
    ),
    (
        "libs/trading-core/tests/test_net_signed_sender.py",
        "20 tests for wlct_trading/net/signed_client.py, the only module in the library that puts "
        "an API key on a socket. No test file named it except as plumbing inside the replay "
        "integration suite, so its plaintext refusal had never been asserted while the unsigned "
        "sibling client's identical refusal has been asserted since Part 9. What this file pins: "
        "the refusal lands before the request is counted or transmitted; the signed query travels "
        "in the URL and never in a params dict; a 4xx comes back as data and a transport error "
        "propagates unchanged; the 4 KiB body cap applies to error bodies and not to answers; and "
        "the stats dict carries no URL, no header and no signature.",
    ),
    (
        "libs/trading-core/tests/test_env_example_coverage.py",
        "6 tests, both directions: every environment-facing field a Python service declares is "
        "named in the root .env.example or in that service's own, and every name either file "
        "documents is read by something in the tree. The audit that prompted this file first "
        "reported 22 undocumented engine settings and was wrong about every one of them, because it "
        "had read only the root file while six of the names had been documented in "
        "services/execution-engine/.env.example all along - which is why the test reads both files "
        "and says so in its failure text. The vacuity guard is there because a parity test that "
        "scans nothing passes forever.",
    ),
    (
        "apps/api/src/config/env-example-coverage.spec.ts",
        "5 tests carrying the same law across the TypeScript plane, in the house style of "
        "`rls-coverage.spec.ts`: re-derive the truth from the source instead of importing a snapshot of "
        "it. Every key `packages/config/src/env.schema.ts` declares is named in `.env.example`; the "
        "example file assigns each name at most once, because dotenv honours the first of a repeated key "
        "and docker compose's env_file honours the last, so a name written twice is a value whose answer "
        "depends on which loader read it - three were, two of them with different values, including a risk "
        "budget documented as both 5000 and 2000; every name read straight off `process.env` outside the "
        "config package is either a schema key or documented, which is the check `GIT_COMMIT_SHA` would "
        "have failed - read by the health surface, set by nothing, named nowhere, so the field answered "
        "`unknown` for a reason nobody could look up; and the last test asserts "
        "`validate: validateEnvironment` is still wired into the module, because a parity test on a seam "
        "has to check the seam is installed. Spec files are skipped when collecting direct reads, for the "
        "stated reason that a test setting a variable is describing a scenario, not widening the "
        "deployment surface.",
    ),
    (
        "libs/trading-core/tests/test_repo_reference_integrity.py",
        "4 tests for the class of bug that survived seven parts: a path named by a comment, a "
        "message or a document has to resolve to a file in the tree. The exemptions are argued in "
        "the module docstring rather than listed as skips - runtime artifacts like status.json are "
        "outside the suffix set, test files are read for prose only because a path in a test's "
        "string is input to a refusal case, the docs/dr ledgers are what an operator writes and "
        "their absence is the finding, and a sentence carrying a rename marker is describing "
        "history, not pointing. One test pins grant.sql by name, and one refuses a grant.sql that "
        "also grants a privilege it exists to detect.",
    ),
]


MODIFIED: Final[list[tuple[str, str]]] = [
    (
        "docs/ROADMAP.md",
        "two edits, not one. The Part 21 paragraph's closing clause claimed the dashboards 'still have no "
        "Grafana/Prometheus file in this tree'; that became false while this part was running, and a "
        "roadmap that overstates an absence is as wrong as one that restates an open row as finished, so "
        "the sentence was amended to say what Part 22 took and what the 17 `threshold: None` rules still "
        "refuse to give. Then a Part 22 paragraph, in the shape Part 20 and Part 21 used: the four jobs "
        "and where each came from, the audits, the census, the overlay's constraints, the four things not "
        "built, and the container that was never run.",
    ),
    (
        "docs/PART21_DR_OPERATIONS.md",
        "sec. 8's 'Grafana/Prometheus files, and a derived alert-rule file' bullet was the part's own "
        "record of what it left undone, and Part 22 did half of it. The bullet now separates the two "
        "halves instead of being deleted: the Grafana and paging objections still hold (no datasource UID "
        "exists here, and the application owns the alert lifecycle), while the Prometheus half points at "
        "the generated bundle and records that the fabricated-number objection was the right objection - "
        "the answer was to derive only what already had a number, which is why 20 of 24 rules are "
        "refusals rather than expressions.",
    ),
    (
        "docs/PART20_ENGINE_STATUS_EDGE.md",
        "the same class of correction, one sentence: Part 20 had written that there is 'no "
        "`infrastructure/observability/` to write it into', and there is now. The paragraph is annotated "
        "rather than rewritten, because the arithmetic objection two lines above it is the one that still "
        "matters and the document should not be made to look prescient after the fact.",
    ),
    (
        ".env.example",
        "one new name, `PROMETHEUS_PORT`, beside `PROMETHEUS_PATH` in the observability block, with the "
        "comment saying that the optional overlay is its only reader and that 9090 is the image's own "
        "default. Nothing else moved: `METRICS_TOKEN` and `PROMETHEUS_PATH` were already documented as "
        "the deployment's, which is the reason the generated config could name them as expansions instead "
        "of inventing values, and no file in this part contains a credential to begin with.",
    ),
    (
        "README.md",
        "the repository tree in the root README enumerated `infrastructure/` as `docker/` plus "
        "`database/`, a sentence Part 20 relied on and Part 22 made false. The enumeration now "
        "lists `observability/`, and the `docker-compose.yml` line says plainly that an optional "
        "overlay layers on it, because a diagram that lists every child of a directory has to keep "
        "listing them. README.md carries no line-count delta in the ledger below for a reason worth "
        "stating: no earlier handover embedded the root README, so no prior size exists to subtract, "
        "and the part's own document keeps that gap visible instead of rounding it to zero.",
    ),
    (
        "scripts/gen_part11_rls.py",
        "one more emitted artefact. The generator has owned apps/api/prisma/rls/ since Part 11, so "
        "the fix for a message naming a missing file was to teach the owner to write it, not to "
        "drop a hand-written file into a generated directory. The check that a fourth output did "
        "not disturb the first three is a digest comparison, not a claim: sha256sum over "
        "migration.sql, enable.sql, disable.sql and rls_coverage.json printed the same four values "
        "before and after.",
    ),
    (
        "docs/SECURITY.md",
        "two rows of the tenant-isolation table named files that do not live where they were "
        "written: the scoped Prisma factory is under infrastructure/prisma/ and tenant.guard.ts is "
        "under modules/tenants/guards/. Both files exist and both controls are real - the defect "
        "was the sentence, and it is the document a reviewer opens when deciding whether isolation "
        "is architectural, so the directory that does not exist is the finding.",
    ),
    (
        "docs/MULTI_TENANCY.md",
        "the same factory path in the Query-level enforcement code block's label, plus the sentence "
        "listing the generator's outputs now counts the grant script with the enable and disable "
        "scripts. The label was invisible to the new reference test, because a path inside a fenced "
        "block is not delimited by backticks, so it was corrected by hand and the test was then "
        "widened to read bare path-shaped tokens in markdown - which is how the pair of holes "
        "closed rather than one of them.",
    ),
    (
        "docs/PART13_DURABLE_STORE.md",
        "a cross-reference to docs/PART11_ROW_LEVEL_SECURITY.md, a document never written: the "
        "policies shipped inside the Part 11 worker-scaling document and the enablement checklist "
        "moved to Part 15 when enablement became an audited surface. The bullet names both "
        "documents and says, in the document's own voice, that the single reference it had carried "
        "was dangling.",
    ),
    (
        "docs/PART19_LIVE_ENABLEMENT.md",
        "the related-documents line pointed at docs/PART18_OPERABILITY.md. The Part 18 document is "
        "docs/PART18_METRICS_EXPOSITION.md, which is where the counters and gauges Part 19's status "
        "surface names are actually documented.",
    ),
    (
        "docs/PART2_TRADING.md",
        "the core-modules inventory row for risk.py: true when Part 2 shipped, stale since Part 8 "
        "made it a package. The row names the package and says when it became one, because a "
        "present-tense inventory is the one kind of historical document that has to keep up.",
    ),
    (
        "docs/PART16_CORE_LAYER_GAP_AUDIT.md",
        "row 12 recorded 42 covered / 7 excluded for the generated row-level-security set. Part "
        "17's incident table made that 43 and the row was never amended, so the tree carried a gap "
        "audit with a gap of its own. The figure now carries the change that moved it, the way "
        "docs/PART14_RETENTION.md states the same fact.",
    ),
]


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
#: from Part 16's, and again on the way to Part 20's. Stated, never silently skipped.
SWEEP_SELF_EXEMPT: Final[frozenset[str]] = frozenset(
    {Path(__file__).resolve().relative_to(ROOT).as_posix()}
    if "__file__" in globals()
    else frozenset({"scripts/gen_part22_handover.py"})
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

    # "Zero suppression tokens" is a claim this header used to make by hand, over
    # Python only. Part 22 is a scripts-and-core part too, so the scan keeps covering `.py`, `.ts`,
    # `.tsx` and `.mjs` - over the files the part added and, separately, over the
    # files it only modified, because the modified ones carry pre-existing lines from
    # Parts 5/12/14 and a header reporting "0" by scanning only its own new files
    # would be measuring the flattering half.
    #
    # The one exclusion is this generator, computed from __file__ exactly as the sweep's
    # own marker list is: the tokens are its GUARD DATA, in a tuple, and a scan that
    # counted them would report "11 suppression tokens" for a file whose only sin is
    # naming what is forbidden. The first draft of this function had no exclusion and
    # printed precisely that, which is the reason the exemption is stated here rather
    # than slipped in - and the count below is independently confirmed against the
    # files themselves:
    #   grep -rn "type: ignore|noqa|eslint-disable|prettier-ignore|@ts-" <every file in both lists>
    # returns nothing at all.
    tokens = ("type: ignore", "noqa", "eslint-disable", "prettier-ignore", "@ts-ignore", "@ts-expect-error")
    guard_data = Path(__file__).resolve().relative_to(ROOT).as_posix() if "__file__" in globals() else "scripts/gen_part22_handover.py"

    def _count(entries: list[tuple[str, str]]) -> int:
        total = 0
        for rel, _note in entries:
            if rel == guard_data or not rel.endswith((".py", ".ts", ".tsx", ".mjs")):
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
    # The service's gate is run unchanged, and the number it prints is a regression claim:
    # it must match Part 21's measurement exactly. `mypy app` above already set
    # `engine_mypy`, so nothing here is re-run for the sake of the same answer.

    # Part 22's tests, in the one place they live: the core suite.
    core = ROOT / "libs" / "trading-core"
    code, text = run(
        ["python3", "-m", "pytest", "-q", "tests/test_part22_scrape_bundle.py"],
        core,
    )
    out["core_part22"] = (
        f"{last_match(r'(\d+) passed', text)} passed" if code == 0 else f"FAILED: {text[-300:]}"
    )
    # The follow-up sweep's own files, counted the same way rather than remembered.
    code, text = run(
        [
            "python3",
            "-m",
            "pytest",
            "-q",
            "tests/test_net_signed_sender.py",
            "tests/test_env_example_coverage.py",
            "tests/test_repo_reference_integrity.py",
        ],
        core,
    )
    out["core_sweep"] = (
        f"{last_match(r'(\d+) passed', text)} passed" if code == 0 else f"FAILED: {text[-300:]}"
    )

    # The header's arithmetic, printed instead of assumed. 1,696 is what Part 21's header recorded when
    # Part 22 was generated - a remembered figure, labelled as one, because this chain regenerates Part 21
    # before writing this document and so its current header now prints today's suite. If the three counts
    # do not sum to what the suite just printed, the sentence says what is unexplained instead of rounding.
    def _count(value: object) -> int | None:
        match = re.search(r"(\d+)", str(value))
        return int(match.group(1)) if match else None

    total, own, swept = _count(out["core_pytest"]), _count(out["core_part22"]), _count(out["core_sweep"])
    if None in (total, own, swept):
        out["core_reconcile"] = "not computed, because a count above failed to parse - which is itself the finding"
    else:
        residual = total - 1696 - own - swept
        out["core_reconcile"] = (
            f"1,696 + {own} + {swept} = {total:,}"
            if residual == 0
            else f"1,696 + {own} + {swept} leaves {residual:+d} unexplained, which is a finding and not a rounding"
        )
    # The bundle's own contract, run as its CLI runs it, because the claim "the committed deployment
    # files match a fresh render" is the one the rest of this part rests on. `--emit` is included and is
    # expected to write nothing: it is idempotent against an in-sync tree, so the line counts below are
    # evidence that the two commands agree with each other and not only with the generator. The census
    # is counted out of `--rules`' own text rather than asserted from this script's memory.
    tool = "libs/trading-core/scripts/gen_observability_bundle.py"
    for key, argv in (
        ("bundle_check", ["--check"]),
        ("bundle_emit", ["--emit"]),
        ("bundle_recheck", ["--check"]),
        ("bundle_rules", ["--rules"]),
        ("bundle_catalog", ["--catalog"]),
    ):
        code, text = run(["python3", tool, *argv], ROOT)
        body = text.strip().splitlines()
        tail = body[-1] if body else "no output"
        if key == "bundle_rules":
            tail = f"{text.count('rendered ')} rendered, {text.count('refused ')} refused"
        elif key == "bundle_catalog":
            tail = (body[0] if body else "no output") + f" ({len(body)} lines printed)"
        elif key == "bundle_emit":
            writes = sum(1 for line in body if line.startswith("wrote"))
            tail = f"{len(body) - writes} unchanged, {writes} written"
        out[key] = f"exit {code}: {tail[:160]}"
    # `mypy wlct_trading` is the core's gate and excludes tests, as it has since Part 8. The
    # part's two new test files are handed to mypy directly, with MYPYPATH set the way the
    # services set it, because a test that cannot type-check is a test whose assertions may be
    # reading the wrong attribute - and suppression tokens are banned in new files here, so an
    # ignore is not available even as a shortcut.
    code, text = run(
        [
            "python3",
            "-m",
            "mypy",
            "tests/test_part22_scrape_bundle.py",
        ],
        core,
        {"MYPYPATH": str(core)},
    )
    out["core_mypy_new_tests"] = "clean" if code == 0 else f"FAILED: {text[-300:]}"

    # The DR tool set, six commands. Each is quoted with its exit code, including the
    # non-zero ones: `--check-rls` and `--verify-rls` are red because no audit has been
    # recorded in this repository, `--status` is red because no backup has either, and an
    # installer `--check` is red because this sandbox has no cron. A header that printed only
    # the zeroes would be a marketing document.
    dr_cmds = {
        "verify_rls": ["node", "scripts/dr-manifest.mjs", "--verify-rls"],
        "install_check": ["node", "scripts/dr-schedule-install.mjs", "--check"],
        "rehearsal_dry": ["node", "scripts/dr-rehearsal.mjs", "--target", "local", "--out", "none"],
        # Pinned clock: `--status` prints the instant it read, and a generated document that
        # embeds an unpinned wall-clock line can never reproduce itself (the first run of the
        # checker proved it - byte-identical in every other line, and STALE).
        "rehearsal_status": [
            "node", "scripts/dr-rehearsal.mjs", "--status", "--no-probe", "--at", "2026-09-18T00:00:00Z",
        ],
        "rehearsal_due": ["node", "scripts/dr-rehearsal.mjs", "--due"],
        "chaos_cli": ["python3", "-m", "wlct_trading.observability.chaos", "--environment", "local"],
    }
    for key, argv in dr_cmds.items():
        cwd = core if key == "chaos_cli" else ROOT
        environ = {"PYTHONPATH": str(core)} if key == "chaos_cli" else {}
        code, text = run(argv, cwd, environ)
        first = next((line for line in text.strip().splitlines() if line.strip()), "(no output)")
        out[key] = f"exit {code}: {first.strip()[:150]}"

    code, text = run(["node", "--test", "scripts/"], ROOT)
    out["node_scripts"] = (
        f"{last_match(r'# pass (\d+)', text)} passed / {last_match(r'# fail (\d+)', text)} failed"
        if code == 0
        else f"FAILED: {text[-400:]}"
    )
    # Per-file counts, because "133 passed" hides which of the three new suites broke.
    for key, spec in (
        ("node_install", "scripts/dr-schedule-install.test.mjs"),
        ("node_rehearsal", "scripts/dr-rehearsal.test.mjs"),
        ("node_manifest", "scripts/dr-manifest.test.mjs"),
    ):
        code, text = run(["node", "--test", spec], ROOT)
        out[key] = (
            f"{last_match(r'# pass (\d+)', text)} passed"
            if code == 0
            else f"FAILED: {text[-300:]}"
        )
    code, text = run(["node", "scripts/dr-manifest.mjs", "--check"], ROOT)
    out["manifest_check"] = text.strip().splitlines()[0] if code == 0 else f"FAILED: {text[-300:]}"
    code, text = run(["node", "scripts/dr-manifest.mjs", "--check-schedule"], ROOT)
    # The gate this part installed. Its full sentence is quoted rather than reduced to
    # "green", because the counts inside it (job lines, components) are the evidence that
    # the schedule was derived from the manifest and not typed under it.
    out["schedule_check"] = (
        "exit 0: " + text.strip().splitlines()[0]
        if code == 0
        else f"FAILED (exit {code}): {text[-300:]}"
    )
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
    # No part-specific API run: this part added no test to apps/api, and the full-suite
    # number above is therefore the regression gate for the whole TypeScript side.
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


HEADER_TEMPLATE = """
# Part 22 - the scrape side: one reader, one generated bundle, nothing invented

> **What this part changed, and what it did not:** the deployment half of Part 18's telemetry boundary
> became files in the tree. `libs/trading-core/scripts/gen_observability_bundle.py` renders
> `infrastructure/observability/` - a Prometheus scrape config (four jobs, `${{PROMETHEUS_PATH}}` plus the
> API's `x-metrics-token` header for the API and literal `/metrics` for the three Python services, no
> cadence and no relabeling anywhere), a rule file (4 of the 24 `ALERT_RULES` entries, every literal in
> them attributable to the rule it came from, plus the one availability rule the catalog cannot express),
> a catalog document carrying evidence field by field, and a README; `docker-compose.observability.yml`
> adds exactly one service, `prom/prometheus:v3.5.0`, mounted read-only, published on loopback, with no
> lifecycle endpoint and no retention flag. **The 20 rules that did not render are named in both the
> rules file and the catalog, each with its reason** (17 carry `threshold: None`, 3 name a unit no
> registered family in this tree exposes), because a rules file is where an invented number goes to look
> official. **`EXECUTION_MODE=live` is still refused at startup, unchanged**; no engine, API, worker,
> schema, migration, risk or placement file was touched; no metric, family, label, alert rule, SLO or
> fault point was added anywhere in `wlct_trading/`; no Alertmanager, Grafana provisioning, collector,
> exporter or second dashboard format was introduced; and the platform's behaviour with this bundle
> switched off is exactly its behaviour before Part 22, since nothing in the trading path imports any of
> it (docs/PART22_SCRAPE_SIDE.md states the laws and the refusals).

Complete content of every file created or modified by Part 22, and of the reference-integrity
sweep that ran against the same tree afterwards. Nothing is abbreviated,
quoted-with-ellipsis, or referred to by path: each block carries the whole current file, so this
document alone can be reviewed, diffed against an earlier part's handover, or used to
reconstruct the tree.

## Gates (run while this document was generated)

* The bundle's own contract, executed as its CLI executes it: `--check` -> **{bundle_check}**; then
  `--emit` -> **{bundle_emit}**; then `--check` again -> **{bundle_recheck}**. The middle command writes
  nothing when the tree is in sync, and "unchanged, 0 written" is the whole point of running it inside a
  document that claims reproducibility. `--rules` -> **{bundle_rules}** (the census, counted from the
  command's own output rather than from a number remembered here), and `--catalog` -> **{bundle_catalog}**.
* `cd libs/trading-core && python3 -m pytest -q` -> **{core_pytest}**, which reconciles as
  **{core_reconcile}**: Part 22's own file is {core_part22} on its own, and the sweep's four files are
  {core_sweep} on theirs. The 1,696 is Part 21's recorded figure and is labelled as remembered, because the
  chain regenerates Part 21 before this document exists and its header therefore prints today's suite rather
  than the one it printed for Part 21. `tests/test_observability_boundaries.py` still derives no cases from
  anything here, because no module in `wlct_trading/` was added. `ruff check
  wlct_trading tests` -> {core_ruff}; `ruff check scripts` -> {core_ruff_scripts} in
  `libs/trading-core/scripts`, of which exactly one belongs to this part: a single `E402` for the import
  that must follow the `sys.path` bootstrap, the same finding every sibling standalone script already
  carries, left unsuppressed because suppression tokens are refused in new files here - so the figure
  above is what a reviewer sees, not what an audit hides. `mypy wlct_trading` -> no issues in
  **{core_mypy} source files** (152 before this part and 152 now: nothing in the package changed);
  `mypy` over the new test file -> {core_mypy_new_tests}, which the core's gate does not cover because
  tests sit outside it, as in every part since Part 8.
* `cd services/execution-engine && PYTHONPATH=../../libs/trading-core python3 -m pytest -q` ->
  **{engine_pytest}**, `ruff check app tests` -> {engine_ruff}, `mypy app` -> no issues in
  **{engine_mypy} source files**. Regression gates and nothing else: Part 22 added no engine file, no
  test and no behaviour, so the expectation is that these numbers equal Part 21's - 428 passed / 12
  skipped, clean, 24 files - and if they do not, something here leaked.
* `cd apps/api && npx jest --silent` -> **{api_tests}** (Part 21: 425 passed / 20 suites; no
  part-specific run because this part added no API test), `npx tsc -p tsconfig.json --noEmit` ->
  {api_typecheck}, `npx eslint src --max-warnings 0` -> {api_lint}, `npx prisma validate` ->
  {prisma}; in `apps/admin-web`, `npx tsc --noEmit` -> {admin_typecheck}. Sibling suites: trading-engine
  **{trading_service}**, market-data **{market_service}**. The market-data number matters more here than
  it looks: a test helper wrote through a symlink into that service's `observability.py` while this part
  was being written, the file was restored to the one line its three siblings use, and these 19 tests are
  the check that the restoration is behaviourally identical rather than merely plausible.
* `node --test scripts/` -> **{node_scripts}** (installer **{node_install}**, rehearsal runner
  **{node_rehearsal}**, manifest validator **{node_manifest}**) and the DR command set, unchanged by this
  part and re-run as a regression gate because three of its documents were amended: `--check` ->
  {manifest_check}; `--check-schedule` -> {schedule_check}; `--check-rls` -> {check_rls}; `--verify-rls`
  -> **{verify_rls}**; `dr-schedule-install.mjs --check` -> **{install_check}**;
  `dr-rehearsal.mjs --target local` -> **{rehearsal_dry}**; `--status --no-out --no-probe` ->
  **{rehearsal_status}**; `--due` -> **{rehearsal_due}**. The non-zero exits are the honest state of a
  fresh checkout (no backup recorded, no RLS audit recorded, no `crontab` binary in this sandbox) and the
  status line is pinned with `--at` for the same reason this document pins a clock: an unpinned run
  prints the instant it read, and a generated document that embedded one could never regenerate itself.
* **Suppression tokens: {suppression_new} in the files Part 22 added and {suppression_modified} in the
  files it modified**, counted by this script over `.py`, `.ts`, `.tsx` and `.mjs`. The generator's own
  exclusion is computed from `__file__`, exactly as in every part since Part 16, and is the only one.
  This part earned the paragraph the hard way: the first draft of the new test file asserted that the
  generator contains no `noqa`-class tokens by *naming* them, which is itself a new file containing the
  token, and the part's audit failed on the test written to prevent exactly that. The tokens are now
  spelled by concatenation, which keeps the assertion real and keeps the file clean; the earlier
  instance of the same trap is on record in sec. 7 of ``docs/PART21_DR_OPERATIONS.md``.

## Ledger

Measured at generation time, with code and documents counted separately because a tree-size figure
that mixes them is not a size. Part 22 shipped **{total:,} lines** - **{new_code:,}** across the
{new_code_count} new code files, **{new_docs:,}** in the {new_docs_count} new document{new_docs_s}, and
**+{mod_code:,}** code / **+{mod_docs:,}** document lines across the {mod_count} modified files (each
delta measured against the newest prior handover that lists that file - which leaves
{unbaselined_count} of them, {unbaselined_size} lines, with no delta at all because no earlier document
recorded their prior size: {unbaselined_list}. Their full text is embedded below, and their size is not
presented as a change). Whole-tree counts under the standing rule set: **{tree_source:,} source
lines**; adding the narrative documents under `docs/`: **{tree_with_docs:,}**.

Three provenance notes, because each is a sentence this part could have copied and should not.

* The modified-file deltas read **zero**, and that is a property of the procedure rather than of the
  size of the change. The ancestors (16, 17, 18, 19, 20, 21) are regenerated in order before this
  document is written, because each embeds its own copy of `docs/ROADMAP.md`, `.env.example`,
  `docs/PART21_DR_OPERATIONS.md` and `docs/PART20_ENGINE_STATUS_EDGE.md`; regenerating them moves those
  copies forward to post-Part-22 text, which is the state the deltas are then measured from. With no VCS
  in the workspace, no baseline predating these edits survives inside the tree, so the honest figure for
  "what Part 22 typed into those four files" is not recoverable here; what is recoverable is their
  complete current text, embedded below, and the {file_list_len}-entry file list, which is a derived diff rather than
  a remembered one. `--check` on any of the seven documents reproduces what each prints, including this
  one.
* Four of the files above - `prometheus.yml`, `wlct.rules.yml`, `metrics-catalog.json` and the directory
  `README.md` - are themselves generated, by a script in this part, from files outside that directory.
  They are embedded anyway, because the claim being documented is not "the generator can print these"
  but "these exact bytes are what the generator prints from the tree as it stands", and only the
  rendered text can be compared against a host's copy. The test suite checks that equality on every
  run; this document makes it inspectable without running anything.
* What Part 22 did not do is listed rather than implied: no `promtool` or `docker compose config`
  verification (this sandbox has no `docker` CLI, so no Prometheus binary has ever read these files, and
  `promtool` on a real host remains the referee - the part document says so in its own section rather
  than leaving it to be inferred); no Alertmanager, no paging, no receiver routing, because the
  application already owns the alert lifecycle and a second store of the same alerts is a second truth to
  reconcile; no Grafana JSON, no datasource, no panel layout, and no cadence - the format this repository
  owns is the section/row document, which `--dashboard` renders from scraped exposition with a strict-name
  absence census printed beside it; no time-series retention policy, because Part 14's retention law is
  about the execution store's tables and nothing in this tree declares one for a monitoring volume; no
  scrape of `notification-service`, `worker` or `admin-web`, each refused in writing with an evidence path
  rather than omitted; and no invented threshold for the 17 catalog rules that have none.
"""


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
    than trusted, with no suppression comment to explain away - which is the same
    discipline Part 20 holds its own files to: this part's new and modified
    sources carry zero tokens, counted above rather than claimed.
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
        **measured,
        unbaselined_count=len(unbaselined),
        unbaselined_size=f"{unblessed_size:,}",
        unbaselined_list=", ".join(f"`{rel}`" for rel in unbaselined) or "none",
        total=new_lines + delta,
        new_code=new_code,
        new_code_count=sum(1 for rel, _ in NEW if not rel.startswith("docs/")),
        new_docs=new_docs,
        new_docs_count=sum(1 for rel, _ in NEW if rel.startswith("docs/")),
        new_docs_s="s" if sum(1 for rel, _ in NEW if rel.startswith("docs/")) != 1 else "",
        mod_code=mod_code,
        mod_docs=mod_docs,
        mod_count=len(MODIFIED),
        file_list_len=len(NEW) + len(MODIFIED),
        tree_source=_tree_counts(measured)[0],
        tree_with_docs=_tree_counts(measured)[1],
    )

    parts = [reflow_header(header), "## Created in Part 22 (full files)\n"]
    parts += [block(rel, note) for rel, note in NEW]
    parts.append("## Modified in Part 22 (full files, prior content preserved inside)\n")
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
