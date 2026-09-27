"""Part 19 - live enablement: the credential fetcher, the operator confirmation, the
counting axis, and the graded report. The full-source handover.

Generated, not written by hand, for the reason Part 15 established and Parts 16, 17 and 18
repeated: a hand-copied "full source" document starts drifting the moment a file changes, and
a document whose completeness cannot be re-proved is a document that merely claims. This script
embeds the complete content of every file Part 19 added or modified, states its own gate results
by RUNNING the suites, and accepts ``--check``, which regenerates in memory and compares byte for
byte against the committed file.

Copied from ``scripts/gen_part18_handover.py`` and re-pointed, which is the honest description of
the relationship: the gate list, the tree rule, the sweep and the emission-count guard are that
part's machinery. What changed is the header, the file lists, the baseline search (now starting at
Part 18, newest first), and one addition to the machinery itself - this part has FIVE new test
files split across two suites, so the part-specific gate runs are two numbers rather than one, and
both are parsed from their own output.

The file lists were derived rather than remembered. There is no VCS in this workspace, so the
prior handovers ARE the snapshots: comparing every candidate file against the newest handover
that embeds it yields the real change set since the last recorded state. That sweep named 27
files whose content had moved; 23 of them carry Part 19 markers and are listed below, and the
last four had moved for reasons that are not this part's - and the comparison has to be
fence-aware, because a three-backtick parser reports an untouched markdown document as wholly
rewritten. The audit script is ``/home/user/audit_part19_diff.py`` in the session workspace;
its result, not its existence, is what this paragraph asserts.
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
OUT = ROOT / "docs" / "PART19_HANDOVER_FULL_SOURCE.md"

#: Prior handovers, newest first: the baseline search for a modified file
#: walks this list and stops at the first document that contains it.
PRIOR_HANDOVERS: Final = tuple(
    ROOT / "docs" / f"PART{n}_HANDOVER_FULL_SOURCE.md" for n in range(18, 0, -1)
)

NEW: Final[list[tuple[str, str]]] = [
    (
        "libs/trading-core/wlct_trading/execution/live_confirmation.py",
        "the operator's decision as a type: LiveOperatorConfirmation (canonical-JSON canonicalisation with sorted keys, HMAC-SHA256 digest, a 90-day ceiling expressed in MILLISECONDS against microsecond stamps, MIN_NONCE_LENGTH 16, empty scope rendered as the SCOPE_UNBOUNDED marker rather than as nothing), ConfirmationVerifier.assess for one order and assess_deployment for a boot report that must not invent a symbol, constant-time verification, a public_summary() whose fingerprint is 12 hex characters, and the rule that a required confirmation without a key cannot be constructed at all.",
    ),
    (
        "libs/trading-core/wlct_trading/execution/live_enablement.py",
        "the sentence live refuses with, computed: eight LivePrerequisite members, one evaluate_live_enablement over the wiring the composition root just built, LIVE_* reason codes spelled FROM the enum so the two vocabularies cannot drift, to_public_dict() for machines, render_refusal() for humans, and HARD_BLOCKERS naming the absence no configuration in this build reaches - stated as a constant so that the day it stops being true is a reviewed change to it rather than a boolean that started meaning something else.",
    ),
    (
        "services/execution-engine/app/secret_fetcher.py",
        "the interface's first implementation, and the reason `secret-manager` stopped being a refusal: Vault KV v2 over httpx, https-only with an embedded-credential authority refused even over TLS, mount and path template validated at boot, identifiers matched against [A-Za-z0-9._-]{1,64} BEFORE a request is built, the rendered path bounded at 512 characters and the response at 1 KiB..4 MiB and refused without being consumed, every non-200 one CredentialNotFound that keeps the status and drops the body, and no log line, repr or describe() that can render the token it read.",
    ),
    (
        "libs/trading-core/tests/test_part19_live_confirmation.py",
        "47 tests over the record type and the verifier: canonical bytes recomputed rather than trusted, the window ceiling asserted on BOTH edges (one millisecond past the bound refused, exactly the bound allowed, because the units differ inside one dataclass), forgery, replay-proof nonces, scope on every axis, expiry enforced per order and not at boot, the fingerprint's length, and the construction refusals a deployment would otherwise discover as 100% order failures.",
    ),
    (
        "libs/trading-core/tests/test_part19_review_areas.py",
        "23 tests over the new axis on the existing gate: every code mapped, `blocking_areas` in declaration order, area counts versus order counts as the two denominators they are, the seven counter fields and the seven areas equal in BOTH directions, and Part 16's harness reused (LiveAdapter, CountingAttestor, attested()) so that a live-refusal regression is re-run rather than re-described - including the pin that a passing unrequired confirmation leaves the verdict bytes untouched.",
    ),
    (
        "libs/trading-core/tests/test_part19_live_enablement.py",
        "15 tests over the report: each prerequisite graded in both directions from the six inputs, HARD_BLOCKERS membership, the strip-once law that a whitespace-padded source cannot be simultaneously configured and unusable (the test that found the gap in the code, not in itself), reason codes derived from the enum, and the refusal sentence quoting what is missing rather than a fixed paragraph.",
    ),
    (
        "services/execution-engine/tests/test_part19_vault_fetcher.py",
        "53 tests with httpx.MockTransport injected: every boot refusal quoted from the real message, the request shape asserted (the /data/ segment and the .data.data envelope), camelCase and snake_case spellings accepted and DISAGREEING spellings refused, absent permissions meaning no claim rather than a permissive default, the unsafe-identifier case asserting the transport was never called, every non-200 parametrised, selection and no-fallback, the boot log read THROUGH a live RedactionFilter, and the token's safety argued structurally - there is no Settings field that could hold it.",
    ),
    (
        "services/execution-engine/tests/test_part19_live_wiring.py",
        "36 tests over the service's half of the confirmation: the configuration refusals (two sources for one ceremony, required with nothing to require, a record minted for another instance, malformed or over-wide JSON), the verifier's construction rules, describe() and the boot log, the graded live refusal in its strongest available form (a valid, in-scope, in-window confirmation and STILL refused because signed transport wired is missing), /status and /health/ready carrying the new block with a secret-shape scan, and the two new wiring gauges read out of the rendered text rather than the registry.",
    ),
    (
        "docs/PART19_LIVE_ENABLEMENT.md",
        "the operational document: the audit result item by item, the two vocabularies and why there are exactly two, the selection table with its no-fallback laws, the fetcher's refusal list, the minting ceremony with the exact bytes and a runnable example (sec. 5, the one .env.example points at), the state table an operator reads when an order is refused, where every fact is published, the two kinds of absence that both read as `false`, the order in which to turn the pieces on, and the refusal catalogue.",
    ),
    (
        "scripts/gen_part19_handover.py",
        "this generator. It embeds itself, which is the point of a document that can be rebuilt: the file that proves the enumeration is complete is inside the enumeration, and the sweep that forbids elision markers exempts exactly this path by computing it from __file__ rather than naming an ancestor's file and failing on itself.",
    ),
]

MODIFIED: Final[list[tuple[str, str]]] = [
    (
        "libs/trading-core/wlct_trading/execution/placement_review.py",
        "the axis and the group: ReviewArea with its seven members, REVIEW_AREA_BY_CODE and review_area_of, PlacementFacts gaining confirmation and confirmation_detail OUTSIDE ATTESTATION_WIRE_FIELDS, the policy's require_operator_confirmation (both policy booleans type-validated, because \"false\" from a JSON file is truthy in Python and a permissive default arrived by that road elsewhere in this repository), MAX_CONFIRMATION_DETAIL_LENGTH, and _confirmation_findings as the sixth group of the one existing law - not a second gate beside it.",
    ),
    (
        "libs/trading-core/wlct_trading/execution/placement_attestor.py",
        "PlacementReviewer gains the verifier as a constructor argument, refuses to be built when the policy asks for a check nothing can perform, keeps review() total by turning a raising verifier into a blocking UNVERIFIED that names the exception TYPE and not its message, and reports the confirmation in describe() as public_summary() - which is what makes it safe for an unauthenticated route to print.",
    ),
    (
        "libs/trading-core/wlct_trading/execution/__init__.py",
        "the umbrella re-exports both new modules' public names, because the package's own purity test reads __all__ as a contract and a name exported by a module and omitted here is a build failure rather than a style note.",
    ),
    (
        "libs/trading-core/wlct_trading/metrics.py",
        "seven placement_blocks_{area} ints on ExecutionCounters (29 -> 36) so the area axis is countable at the same moment it becomes a verdict field, and nothing else - the exposition derives from these fields, which is why no exporter file appears in this list.",
    ),
    (
        "libs/trading-core/wlct_trading/execution/engine.py",
        "_record_placement_review now maps each blocking area to its counter through a hasattr-guarded lookup, so a finding counted here cannot be forgotten by the metrics module and a future area added to the enum without a counter is a gap a test sees rather than a missing line in a dashboard.",
    ),
    (
        "libs/trading-core/tests/test_part16_placement_review.py",
        "the 41 existing law tests, updated only where Part 19 legitimately extended a shape they pinned: the policy field set (with its justification paragraph, because the test that forbids a permission knob is the test that must be told a new field is not one) and the facts' new fields.",
    ),
    (
        "libs/trading-core/tests/test_part16_placement_attestor.py",
        "the constructor-refusal tests and the describe() shape this part widened - the test file that proves the reviewer still never raises, now including a verifier that throws.",
    ),
    (
        "services/execution-engine/app/config.py",
        "thirteen settings, two validators (_validate_placement then _validate_live_wiring), the vault_config and operator_confirmation properties that build the core's own types, and to_public_dict() publishing names and presence: the fetcher selector, the mount, the template, the token VARIABLE's name, whether TLS is verified - never an address, never a value, and structurally unable to hold either.",
    ),
    (
        "services/execution-engine/app/credentials.py",
        "build_credential_provider takes the fetcher selection from configuration instead of only from an injected argument, exposes fetcher_source as the one bit the enablement report needs, refuses a fetcher named for a source that will never call it, and moves its boot-log keys to providerSource / providerFetcher / providerVariableNames - because RedactionFilter scrubs any credential-SHAPED KEY, and a boot line whose interesting field prints [REDACTED] is a boot line nobody can debug from.",
    ),
    (
        "services/execution-engine/app/placement.py",
        "build_confirmation_verifier (key from the environment, minimum length enforced, the same refusal whether the check is required or merely available) and build_placement_reviewer wiring the verifier in, with the boot event carrying requireOperatorConfirmation and operatorConfirmationConfigured and no material.",
    ),
    (
        "services/execution-engine/app/composition.py",
        "the graded live refusal: evaluate_live_enablement over the wiring this function just built, _confirmation_grading reading the deployment-level assessment rather than a symbol invented for the purpose, the report on EngineRuntime and in describe(), and the refusal raised at the END of the build so that it can say what is missing here - with the sentence still refusing live, and the extra clause naming the transport, the plumbing, the store, the review and the confirmation.",
    ),
    (
        "services/execution-engine/app/schemas.py",
        "LiveEnablementView, PlacementStatusView's two new fields and StatusResponse's three, on the typed boundary whose base model is extra=\"forbid\": a describe() key with no schema field is a 500 on both routes, which is the loud failure this design chose over a quietly partial status page.",
    ),
    (
        "services/execution-engine/app/routers/internal.py",
        "the status alias table, extended in the same edit as the schema so the two sides of the parity test can be written at once.",
    ),
    (
        "services/execution-engine/app/observability.py",
        "_WIRING_SOURCES gains live_credential_fetcher and operator_confirmation (7 -> 9 rows), read from describe() rather than from settings so that a renamed key publishes 0 instead of a guess - Part 18's rule, inherited by these two without an exception.",
    ),
    (
        "services/execution-engine/tests/test_part16_placement.py",
        "the Part 16 pins this part legitimately moved: the graded-report data the refusal now prints, and the describe() parity assertions the new keys had to be added to. The live-refusal tests keep their original assertions and pass unchanged, which is the outcome that matters.",
    ),
    (
        "services/execution-engine/tests/test_part18_observability.py",
        "the wiring-gauge component literal, 7 -> 9. Part 18 fixed that set as a literal on purpose, so an added component has to be declared here and cannot slide in as a derived value nobody reviewed.",
    ),
    (
        "services/execution-engine/.env.example",
        "the thirteen variables with their dark defaults, the reason the two key variables are absent from docker-compose.yml, the pointer to docs/PART19_LIVE_ENABLEMENT.md sec. 5 for the minting bytes, and the re-pointed predecessor note naming the Part 16 document as a snapshot rather than as the current list.",
    ),
    (
        "services/execution-engine/requirements.txt",
        "httpx==0.27.2 added as a runtime pin - the fetcher cannot be optional code with an optional dependency, because an ImportError at the first credential lookup is a worse failure than a locked file.",
    ),
    (
        "services/execution-engine/requirements-dev.txt",
        "the duplicate httpx pin removed and the removal explained in place: a pin repeated in two files is two pins, one of which will be upgraded while the other is not.",
    ),
    (
        "docs/ROADMAP.md",
        "the Part 19 row and the narrative correction: two of the five gaps were already shipped, the live-prerequisite list is now computed at boot instead of asserted in prose, and DISTRIBUTED_LOCKS_WIRED is unsatisfied for a different reason than SIGNED_TRANSPORT_WIRED.",
    ),
    (
        "docs/ARCHITECTURE.md",
        "Part 19 as the third instance of the describe()/schema decision, including why an unauthenticated probe could only receive a fingerprint, and the log-key rename that the redaction filter made necessary. Also removes a stray double full stop left by Part 18's sentence.",
    ),
    (
        "docs/SECURITY.md",
        "the credential-source table's secret-manager row (a fetcher is now selectable by configuration, not only injected), the fetcher's refusals, the confirmation record's custody and its 90-day/nonce/scope bounds, why a key rotation invalidates every record signed with the previous key, control 4 now naming the confirmation codes, and the open-prerequisite paragraph rewritten to point at the computed report instead of restating a list.",
    ),
    (
        "docs/GETTING_STARTED.md",
        "the thirteen knobs, what a first deployment should set (nothing here), why the confirmation is the last piece rather than the first, and which sections of the part document answer which operational question.",
    ),
    (
        "docs/PART18_METRICS_EXPOSITION.md",
        "the two figures this part invalidated in a neighbouring document, corrected in place with the reason attached rather than left for a reader to trip over: the counter families are 36 not 29 and the idle render is 29 lines not 27, because the review-area axis and the two wiring components arrived without any exporter file being edited. The byte count that paragraph quoted is removed rather than restated, because a number that varies with how many digits the process uptime printed is not a property of the design - and the sentence now says that out loud instead of silently dropping the claim.",
    ),
    (
        "docs/PART11_WORKER_SCALING.md",
        "one run instruction that could never have worked: the bring-up recipe named uvicorn's app.main:app target for this service, which is the exact defect Part 18 found in the images and fixed there, left standing in the runbook. Now --factory app.main:create_app, with a line naming the reason so the next reader does not re-derive it.",
    ),
    (
        "docs/PART16_CORE_LAYER_GAP_AUDIT.md",
        "the audit's forward-looking option list, which still offered 'complete the live-enablement pair' as future work: a dated note records that Part 19 closed it, that live remains refused at boot, and that the event-plane option keeps its stated condition - without a named consumer it is a second fan-out over engine_order_events and the BullMQ worker.",
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
#: from Part 16's. Stated, never silently skipped.
SWEEP_SELF_EXEMPT: Final[frozenset[str]] = frozenset(
    {Path(__file__).resolve().relative_to(ROOT).as_posix()}
    if "__file__" in globals()
    else frozenset({"scripts/gen_part19_handover.py"})
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
    # This part's five test files live in two suites, so they are run and reported
    # twice rather than once: a single number would hide which half regressed.
    code, text = run(
        [
            "python3",
            "-m",
            "pytest",
            "-q",
            "tests/test_part19_live_confirmation.py",
            "tests/test_part19_review_areas.py",
            "tests/test_part19_live_enablement.py",
        ],
        ROOT / "libs" / "trading-core",
    )
    out["core_part19"] = (
        f"{last_match(r'(\d+) passed', text)} passed"
        if code == 0
        else f"FAILED: {text[-300:]}"
    )
    code, text = run(
        [
            "python3",
            "-m",
            "pytest",
            "-q",
            "tests/test_part19_vault_fetcher.py",
            "tests/test_part19_live_wiring.py",
        ],
        engine,
        {"PYTHONPATH": str(ROOT / "libs" / "trading-core")},
    )
    out["engine_part19"] = (
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


HEADER_TEMPLATE = """
# Part 19 - live enablement: the fetcher, the confirmation, the axis, the report

> **What this part changed, and what it did not:** `secret-manager` stopped being a
> refusal and became a Vault KV v2 read; the gate can now require a signed, scoped,
> expiring operator decision and grades one per order; a refusal is countable by which
> part of enablement it came from; and the live startup refusal prints the list of what
> this process actually lacks, computed from its own wiring, instead of reciting it.
> **`EXECUTION_MODE=live` is still refused at startup, by code** - narrowed to say what is
> missing, never widened to allow anything. No order path changed its outcome for a
> deployment that set none of the thirteen new variables, no table was added, no
> TypeScript file was touched, and no paper credential was ever read from a live path.

Complete content of every file created or modified by Part 19. Nothing is abbreviated,
quoted-with-ellipsis, or referred to by path: each block carries the whole current file, so
this document alone can be reviewed, diffed against an earlier part's handover, or used to
reconstruct the tree.

## Gates (run while this document was generated)

* `cd services/execution-engine && PYTHONPATH=../../libs/trading-core python3 -m pytest -q`
  -> **{engine_pytest}**. The 12 skips are Parts 13-15's live-Postgres suites, skipping BY
  NAME without `EXECUTION_TEST_POSTGRES_DSN`, unchanged from Parts 16-18 - this part adds no
  live test, because a fetcher that reached a real Vault and a confirmation that reached a
  real ceremony would both be tests of somebody else's infrastructure. This part's two
  service files on their own -> **{engine_part19}**. `ruff check app tests` -> {engine_ruff};
  `mypy app` -> no issues in **{engine_mypy} source files** - the same 24 Part 18 measured,
  because the fetcher replaced no module and extended `app/` in place.
* `cd libs/trading-core && python3 -m pytest -q` -> **{core_pytest}**, which is Part 18's
  figure plus the 85 tests this part added; the two Part 16 files it had to update moved a
  pinned shape each and changed no count. This part's three files on their own ->
  **{core_part19}**. `ruff check wlct_trading tests` ->
  {core_ruff} ({core_ruff_scripts} in `libs/trading-core/scripts`, standalone by design);
  `mypy wlct_trading` -> no issues in **{core_mypy} source files**, two more modules than
  Part 18 counted - the two new files this part added, and no new package. Tests sit outside that gate, here as in both services, so this part's five
  test files were also handed to mypy directly: the two service files and both of the new core
  files that could be checked without touching anyone else's are clean, and every remaining
  finding in `test_part19_review_areas.py` belongs to the Part 16 harness it imports -
  `CountingAttestor` and `LiveAdapter` are stand-ins that were never declared as the ports they
  stand in for. Retyping a neighbour's double to improve this part's line is the churn Part 16's
  own comment policy refuses, so they are left as written and stated here instead. Nothing in
  this part is silenced: four suppression comments that an earlier draft of these files carried
  were removed by narrowing the annotation (a typed `dict[str, Any]` where the value IS the
  thing under test, an `isinstance` where a view is indexed), which is a fix rather than a
  quieter failure.
* Sibling suites: trading-engine **{trading_service}**, market-data **{market_service}**.
  Both untouched by Part 19 - which these two numbers are here to confirm rather than assert,
  since the core modules they exercise gained a re-exported pair of names and seven counter
  fields, and a derived exporter that had been hand-listed somewhere would have broken here.
* **Suppression tokens: {suppression_new} in the files Part 19 added**, counted by this
  script over every new source and test file rather than asserted from memory. The
  {suppression_modified} tokens in the modified files are Part 5/12/13/16/18 lines, left
  alone for the reason Part 16 stated: rewriting a neighbour's justified comment to improve a
  new part's score is churn wearing care's clothing.
* `node --test scripts/` -> **{node_scripts}**; `node scripts/dr-manifest.mjs --check` ->
  {manifest_check}; `node scripts/dr-manifest.mjs --check-rls` -> {check_rls}. Unchanged by
  this part, and correct: no table was added, so RLS coverage stays at 43 and `PROBE_TABLES`
  at 5, and the enablement audit remains owed by the operator rather than by this document.
* `cd apps/api && npx jest --silent` -> **{api_tests}**; `npx tsc -p tsconfig.json --noEmit`
  -> {api_typecheck}; `npx eslint src --max-warnings 0` -> {api_lint}; `npx prisma validate`
  -> {prisma}. In `apps/admin-web`, `npx tsc --noEmit` -> {admin_typecheck}. No console or
  worker code changed: the confirmation and the fetcher are engine-plane configuration, and
  the only new field a worker could observe is on `/internal/v1/status`, which it already
  forwards verbatim and does not interpret.

## Ledger

Measured at generation time, with code and documents counted separately because a tree-size
figure that mixes them is not a size. Part 19 shipped **{total:,} lines** - **{new_code:,}**
across the {new_code_count} new code files, **{new_docs:,}** in the {new_docs_count} new
document{new_docs_s}, and **+{mod_code:,}** code / **+{mod_docs:,}** document lines across the
{mod_count} modified files (each delta measured against the newest prior handover that lists
that file - which leaves {unbaselined_count} of them, {unbaselined_size} lines, with no delta
at all because no earlier document recorded their prior size: {unbaselined_list}. Their full
text is embedded below, and their size is not presented as a change). Whole-tree counts under
the standing rule set: **{tree_source:,} source lines**; adding the narrative documents under
`docs/` (the regenerable `docs/source/` views and every handover dump are out of both
figures): **{tree_with_docs:,}**.

Three provenance notes, because each is a sentence this part could have copied and should not.

* The file lists are a derived diff, not a remembered one. With no VCS in the workspace, the
  prior handovers are the snapshots: every candidate file was compared against the newest handover
  embedding it, and that comparison must be fence-aware, because an embedded markdown document is
  fenced with four backticks and a three-backtick parser reports nine untouched documents as
  wholly rewritten. 27 files had moved since their last recorded state; the 23 listed below are
  the ones carrying Part 19 markers. The other four - `docs/fixtures/observability_fixtures.json`,
  `wlct_trading/observability/alerts.py`, `wlct_trading/backtest/engine.py` and
  `wlct_trading/risk/evaluator.py` - differ from a Part 8 or Part 9 snapshot in exactly the shape
  Part 10 left them (the optional `tracer` argument, the SLO burn-rate rules and their fixtures),
  were never re-embedded by the part that changed them, and are neither claimed nor repaired
  here.
* The verdict-id digest moved. `PlacementFacts` gained two fields, and they are deliberately
  OUTSIDE `ATTESTATION_WIRED_FIELDS` so a deployment that did not ask for Part 19 produces
  byte-identical verdicts (pinned by a test, not by this sentence). But `_canonical` includes
  `policy.to_public_dict()`, so a verdict id computed from Part 19 onward covers
  `requireOperatorConfirmation`. That is intended - two deployments with different policies
  must not collide on one id - and it means ids recorded before this part are not comparable
  with ids recorded after it. Anyone reconciling an audit trail across the boundary should
  read docs/PART19_LIVE_ENABLEMENT.md sec. 6 before writing the query.
* Two log keys were RENAMED, in log records only: `credentialSource` -> `providerSource` and
  `credentialFetcher` -> `providerFetcher` (plus `credentialVariableNames` ->
  `providerVariableNames`). Not cosmetics: the platform's `RedactionFilter` replaces the value
  of any record key whose NAME is credential-shaped, so the boot line that answers "which
  mechanism did I get" was printing `[REDACTED]`. `/status` and `/health/ready` keep the old
  names, because they never pass through that filter and Part 16 published them; the split is
  deliberate and is pinned by a test that installs the real filter so the property holds in
  any test order.

The ledger also repeats a hazard Part 17 named and Parts 18 and this one prove again: the
baseline for a modified file is the newest prior handover that lists it, and regenerating an
ancestor (which this part must, because its rule is to embed current content) moves the copies
inside it forward to post-Part-19 text. Parts 16, 17 and 18 were regenerated in that order
before this document was written, and `--check` on any of the four reproduces what it prints.
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
        engine_part19=measured["engine_part19"],
        core_part19=measured["core_part19"],
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

    parts = [reflow_header(header), "## Created in Part 19 (full files)\n"]
    parts += [block(rel, note) for rel, note in NEW]
    parts.append("## Modified in Part 19 (full files, prior content preserved inside)\n")
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
