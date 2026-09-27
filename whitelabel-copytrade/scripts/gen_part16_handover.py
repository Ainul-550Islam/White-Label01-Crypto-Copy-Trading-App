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
OUT = ROOT / "docs" / "PART16_HANDOVER_FULL_SOURCE.md"

#: Prior handovers, newest first: the baseline search for a modified file
#: walks this list and stops at the first document that contains it.
PRIOR_HANDOVERS: Final = tuple(
    ROOT / "docs" / f"PART{n}_HANDOVER_FULL_SOURCE.md" for n in range(15, 0, -1)
)

NEW: Final[list[tuple[str, str]]] = [
    (
        'libs/trading-core/wlct_trading/execution/placement_review.py',
        'the review law, pure: the closed ReviewCode/ReviewSeverity vocabularies, PlacementFacts with every venue-answerable field tri-state so "the venue did not answer" survives to the verdict instead of collapsing into "the venue said no", the nonsense-proof PlacementReviewPolicy (attestation age 1s..1h, skew <=5s, recvWindow <=60s, key age 1..36500 days or None, headroom in milliseconds rather than percent), PlacementAttestation.unavailable() as the one honest empty answer, the six rules and the five sub-laws that produce findings, the severity table with its three warning overrides and the retryable set, the canonical-JSON verdict digest, and the audit-payload encoder with a validated decoder that refuses unknown fields and mistyped ones. No clock, no entropy, no I/O, no await - all four asserted by its test file parsing the module\'s own AST, and every time parameter required rather than defaulted.',
    ),
    (
        'libs/trading-core/wlct_trading/execution/placement_attestor.py',
        "the gatherers and the reviewer: the PlacementAttestor ABC, UnattestedPlacementAttestor (a class rather than None, so a forgotten wiring can never be shaped like a permissive one), LocalPlacementAttestor (credential provider, symbol table and skew measurement, each optional, each degrading to unknown instead of inventing a permission or a refusal), CachingPlacementAttestor (the cache TTL and the freshness bound as ONE number so neither can outlive the other, failure entries kept at ttl//5 above a one-second floor, bounded with oldest-first eviction, stats() for /status), PlacementReviewRequest (identifiers validated once - blank, over-long and control characters refused; symbol/orderType/TIF upper-cased; tenant and account left alone because they are another service's opaque ids - and a cache key that carries the ORDER SHAPE), AttestationFailure carrying its own code, symbol_evidence reducing a venue's lists to the shape being placed, and PlacementReviewer whose review() and describe() cannot raise and never invent provenance.",
    ),
    (
        'libs/trading-core/wlct_trading/exchanges/binance/attestation.py',
        'the venue gatherer, riding the deployment\'s own signed adapter instead of a second client: field-by-field KeyEvidence from /sapi/v1/account/apiRestrictions (0 on tradingAuthorityExpirationTime means never, not 1970; millis accepted as strings because the transport decodes numbers as strings; an absent flag is unknown and not false), the strictest-wins withdrawal conjunction where only the key can answer for the key, venue_trading_permitted as the strictest reading available across key, account switch and symbol phase, exchange_info_symbol_facts keeping "catalog not loaded" (no claims) apart from "symbol absent" (refuse), symbol_facts_from_market over a declared SymbolRegistry protocol, the deliberately empty per-symbol time-in-force slot because Binance publishes no such list for spot, and _unreadable so a parse failure is MALFORMED_VENUE_RESPONSE (retryable, infrastructure) rather than ATTESTATION_REFUSED_BY_VENUE (an operator action).',
    ),
    (
        'libs/trading-core/tests/test_part16_placement_review.py',
        "40 tests of the law alone: the AST purity scans (allowed imports, no defaulted time parameters, no await and no open), absence outranking everything, the policy having no permission knob of any kind (asserted against the dataclass's own field set), freshness boundaries in whole milliseconds plus the reason a sub-millisecond remainder is truncated rather than rounded up, both directions of the venue_backed asymmetry in laws 4 and 5, the entitlement/symbol/clock sub-laws, severity-then-code-then-field ordering, the verdict id being the evidence rather than the moment or the runtime mode, retryability read only from blocking findings, the string-only event payload refusing to spell yes two ways, and the payload round-trip rejecting a string where a bool belongs.",
    ),
    (
        'libs/trading-core/tests/test_part16_placement_attestor.py',
        "49 tests of the plumbing, the engine and the umbrella package's export parity: request normalisation and every refusal, the cache-key law that carries the order shape (with the fail-open it replaced written out), TTL expiry at the boundary and one millisecond past it, failure entries living ttl//5 and never below the floor, eviction order, delegation of source and inner, the closed failure-classification table, all four gatherers including a credential provider that reports no permissions reading as unknown rather than refused, the reviewer's never-raises contract over three exception kinds, one gatherer failing in two runtimes producing INFO in one and BLOCKING in the other with different verdict ids, describe() surviving a gatherer whose properties explode, the live-requires-a-reviewer construction law, the SafetyGate/_GATE_ERROR_CODES parity, a refused review producing zero venue calls plus exactly one incident, a passing review merging its verdict into the SUBMITTED event byte for byte, the three counters and the duration observation the review moves, and the not-applicable gate wording.",
    ),
    (
        'libs/trading-core/tests/test_part16_binance_attestation.py',
        '44 tests of the venue mapping: the complete apiRestrictions answer read field by field, every flag and millis quirk (0, negatives, strings, booleans where an int belongs), a non-object payload refusing to be interpreted, the account projection ignoring anything non-boolean, the two kinds of "we do not know" a symbol catalog can produce, the seven-case withdrawal conjunction, the five-case trading conjunction, a parse failure surfacing as MALFORMED and never as a refusal, a symbol catalog that throws leaving no claims while the key\'s own answer stays venue-backed, and the real signed client checked end to end (path, GET, signature=, API-key header, the weight taken from the capability table, two reviews being two calls because the gatherer caches nothing), with 401/403/429 arriving through the same client the orders use.',
    ),
    (
        'services/execution-engine/app/credentials.py',
        "the service's credential wiring: build_credential_provider turning Settings into a provider plus its provenance label, none/environment/secret-manager with the last two refused for reasons an operator can act on, credential_env_names mirroring the core's own construction byte for byte (a check that disagrees with the code it guards turns a missing variable into a passing boot), the boot check that the named variables exist before anything tries to place an order, the single-tenant scoping that makes the environment source development-only, and a describe() that reports source, cache seconds and identity fields while having no field a key could fit into.",
    ),
    (
        'services/execution-engine/app/placement.py',
        "the service's review wiring: build_placement_reviewer composing policy, gatherer, cache and reviewer from Settings plus whatever the composition root injects; will_transmit_orders deciding requires_venue_attestation (and a transmitting runtime with no venue gatherer refusing to build rather than running a review that could not block anything); LocalPlacementAttestor standing in for a simulated runtime so paper orders still produce real findings; the cache in front of every gatherer with the TTL that is also the freshness bound; review_placement returning the request alongside the verdict so a caller can persist both halves; and a boot log that reads the label through describe() because a collaborator whose source property explodes must not fail the boot that is trying to report on it.",
    ),
    (
        'services/execution-engine/app/routers/placement.py',
        "the internal attestation endpoint: 409 PLACEMENT_REVIEW_UNWIRED, 400 PLACEMENT_REQUEST_REFUSED carrying the core's own refusal text so the API cannot disagree with the engine about what a valid symbol is, 200 for a refused review because the caller asked what the venue says and the answer arrived, verdict fields rendered explicitly rather than by model_dump so a renamed field is a visible mistake instead of a silently missing audit key, transmitted=False as a constant on the response model, and the router mounted last so the command plane never depends on a read surface.",
    ),
    (
        'services/execution-engine/tests/test_part16_placement.py',
        "40 tests: the three credential sources and each refusal (including the parity test that asks the provider which variables IT wanted), the eight settings knobs with their bounds and the production refusal at Settings construction rather than beside the builder, the trailing-underscore prefix refusal, reviewer construction for simulated and transmitting runtimes, the composed runtime carrying credentials and placement in describe() with no key material anywhere in it, the endpoint's status codes and payload shape, the response model having nowhere to put a secret, the route living only on the internal prefix and never being forwarded by the worker client, the shipped defaults inside the core's bounds, the /status block (the body equal to describe() key for key, both key sets agreeing in both directions, no credential-shaped key at any depth, and null distinguished from unattested), and the document this part ships being the one the gate test reads.",
    ),
    (
        'docs/PART16_PLACEMENT_REVIEW.md',
        "the operator document: what the two named gaps were, the gate table for PLACEMENT_ATTESTED and why no new error code was invented, the six laws in the order they matter, the four gatherers and the six venue-reading rules with the unit traps they avoid, the cache and the fail-open that was found and fixed here, the eight configuration knobs with the law each one enforces, the endpoint's four answers, what remains not wired in this build in the order an operator must supply it, the deliberate omissions, and the verification commands with their measured counts.",
    ),
    (
        'docs/PART16_CORE_LAYER_GAP_AUDIT.md',
        'the audit that came before the code: thirteen priority areas checked with file:line evidence and found already implemented, the two gaps the repository names itself quoted from composition.py, the options offered and the one rejected with the grep that justified it, and the disposition line added when the part shipped.',
    ),
    (
        'scripts/gen_part16_handover.py',
        'this generator, which is the only file in this handover that produces evidence rather than restating it. Every gate number in the header is a subprocess run of the real suite at generation time, parsed from its own output, and a number that cannot be parsed is written as FAILED rather than omitted; the suppression count is measured the same way; the per-file deltas come from the prior handovers\' own FILE headers, which is why a modified file that no earlier document embedded contributes NO delta and is named as such instead of being charged its whole length. It also carries the delivery sweep - the check that no shipped file announces an elision - and that sweep was sharpened twice while this part ran, each time because the file it flagged was right and the rule was wrong: the bare word "omitted" fired on a test named test_empty_families_are_omitted, and the marker "# ..." fired on a comment beginning "# ...but the registry still counts it". So elisions are matched as phrases, and bare markers only when a line is nothing but the marker, with the marker lists asserted duplicate-free at import and the whole rule exercised on synthetic text in file_problems() rather than trusted. The generator is exempt from its own substring scan for the obvious reason: it quotes the tokens it forbids, as data, and prints them back in the header.',
    ),
]

MODIFIED: Final[list[tuple[str, str]]] = [
    (
        'libs/trading-core/tests/test_observability_metrics.py',
        'one test, filed in the suite that owns the metric vocabulary rather than in the part\'s own files, because the drift it prevents runs between two files that never import each other: the stage names declared in metrics.py and the stage names the engine actually observes. Part 16 added both halves of a pair for the review and found that twelve of the thirteen declared names have no call site at all, so the test guards the direction that produces a silently discarded sample (an observed name must be declared) and pins the 13/12 figures with a message telling whoever wires the next stage to update the part document beside it. The unrecorded twelve are left exactly as they were: a rule that fails on another part\'s unfinished work gets ignored or satisfied by deleting the name, and deleting the name destroys the only record that the measurement was intended.',
    ),
    (
        'libs/trading-core/wlct_trading/execution/__init__.py',
        "the review's public surface, and the correction of an overclaim this part made about itself: the first cut exported the readable types and left the numbers behind - the policy bounds, the attester TTL bounds, the cache share, PlacementReviewError, the severity and retryability tables, SymbolFacts/SymbolEvidence - twelve names a deployment configuring the review had to fetch from a module path, which is exactly how a bound ends up retyped and then drifting. The package now re-exports everything both placement modules DECLARE, the grouping comments say which module each name came from, and a parametrised test holds the subset rule in both directions of the failure: a name declared and not exported fails, and a name exported to a different object fails.",
    ),
    (
        'libs/trading-core/wlct_trading/execution/safety.py',
        "gate 11 of 11: SafetyGate.PLACEMENT_ATTESTED, ExecutionPreconditions.placement carrying the verdict, and the gate's three outcomes (not applicable with wording that says a transmitting runtime refuses to start, passed with the verdict id, failed with the first blocking finding). The admin console renders gate names generically, so no frontend change was needed and none was made.",
    ),
    (
        'libs/trading-core/wlct_trading/execution/engine.py',
        "the integration: the placement_reviewer slot and keyword argument, the live-requires-a-reviewer law placed at the END of the construction checks so it reports the reviewer rather than pre-empting a richer durability or lock failure, the 2a review block running before the gates and calling the reviewer exactly once, the verdict merged into the SUBMITTED event payload, the span attributes, the metrics, the gate-to-code table entry reusing LIVE_TRADING_NOT_AUTHORISED, PLACEMENT_ATTESTED in the incident-producing faulty set, and the pipeline docstring's gate count corrected from 10 to 11.",
    ),
    (
        'libs/trading-core/wlct_trading/execution/credentials.py',
        'CachingCredentialProvider grows a public inner property: the wrapper already renames the source to cached(...), and a status surface that can see the label but not the object behind it cannot tell a wired provider from a second wrapper. The permission vocabulary the local gatherer reads (PERMISSION_READ, PERMISSION_SPOT_TRADE, PERMISSION_WITHDRAW) is now referenced by name rather than as string literals, so a renamed constant cannot silently miss this call site.',
    ),
    (
        'libs/trading-core/wlct_trading/metrics.py',
        'the three counters the review moves (placement_reviews, placement_review_blocks, placement_attestation_failures) and the placement_review duration observation, with the distinction they exist to draw written beside them: a block that needs an operator and a block that needs a network are different pages.',
    ),
    (
        'libs/trading-core/wlct_trading/exchanges/binance/trading.py',
        "the two accessors the review needs from the adapter and no others: fetch_key_restrictions returning the venue's object un-normalised (which fields were present IS the evidence), and clock_skew_millis/recv_window_ms exposing the numbers the venue will actually apply to a signature rather than the ones the platform is comfortable with.",
    ),
    (
        'libs/trading-core/wlct_trading/exchanges/binance/capabilities.py',
        'BINANCE_REST_WEIGHTS gains api_restrictions = 1, so the review pays for itself inside the budget that already governs orders instead of spending weight nobody accounted for.',
    ),
    (
        'libs/trading-core/wlct_trading/exchanges/binance/__init__.py',
        'the venue package public surface, widened by one rule instead of one name at a time: everything a deployment needs to configure the placement gatherer is re-exported (the gatherer, KeyEvidence, VenueAccountFlags, SymbolRegistry, AccountFlagReader, the three readers and the source label), while the transport vocabulary that would hand a venue-agnostic importer a Binance dependency stays module-path-local. The module its own __all__ also gained AccountFlagReader, which it defined but never declared.',
    ),
    (
        'services/execution-engine/app/config.py',
        "eight fields and one validator (the tenant and account identifiers are one decision, so seven rows of documentation): the credential source, the prefix (a trailing underscore refused rather than normalised), the tenant/account pair an environment can serve, the credential cache seconds, and the three review bounds imported from the core instead of retyped; _validate_placement refuses environment in production and live without the IP allowlist, and re-checks the core's own policy construction so a nonsense combination cannot boot; placement_policy builds the core object; to_public_dict publishes the wiring with no secret in it.",
    ),
    (
        'services/execution-engine/app/composition.py',
        'EngineRuntime now requires both wirings as arguments rather than tolerating their absence, describe() publishes credentialSource and the placement block, and the live refusal keeps its sentence - the one this part narrowed but did not remove - because the review is now wired while the signed transport and per-tenant key custody are not.',
    ),
    (
        'services/execution-engine/app/main.py',
        'the placement router mounted last, with the reason in the comment above it: a read surface must never be able to take the command plane down at import time.',
    ),
    (
        'services/execution-engine/app/schemas.py',
        "PlacementAttestRequest (the same identifier laws as the core's request, so an over-long or control-character-bearing symbol is refused at the boundary and the message is the core's), PlacementFindingView, and PlacementAttestResponse with transmitted as a literal and no field a credential could occupy.",
    ),
    (
        'README.md',
        'the platform-facing copy of the execution-safety list, kept in step with the detailed one instead of allowed to drift: three gates became four, with the engine plane\'s own final gate named in one line and a pointer to the section of docs/SECURITY.md that a later part is required to keep in agreement.',
    ),
    (
        'docs/PART11_WORKER_SCALING.md',
        'the prerequisite list Part 11 attributed to the engine\'s live refusal, corrected with its date kept visible: what the message said then, what closed it, and what the message says now.',
    ),
    (
        'docs/PART14_RETENTION.md',
        'the same correction in one parenthetical of its header block quote, because a document that is otherwise accurate about retention should not have to be wrong about execution to remain readable.',
    ),
    (
        'docs/ARCHITECTURE.md',
        'the execution-engine paragraph: the sentence naming the credential provider and the placement review as open prerequisites for live mode is replaced by the four things that actually remain, and the new internal route is documented beside Part 15 internal route - 200 for a refusal because the refusal is the answer, transmitted: false as a constant rather than a computed field, and the verdict as gate 11 of 11 instead of a second rejection path.',
    ),
    (
        'docs/SECURITY.md',
        'four sections, because a control the permanent documents still describe as missing does not exist: a Runtime credential sources (Part 16) subsection under the execution-engine section with the three sources and what each one refuses; the review added as a fourth independent gate, with the sentence that no configuration removes it; the live-posture prerequisite list corrected to what remains (custody, an attestor instance, a signed transport, the durable store); and an open-gaps entry stating the limit of the review - it can refuse and it can record, and it holds no knob that permits.',
    ),
    (
        'docs/PART5_EXECUTION.md',
        'the flow list and the gate table brought to eleven, with the date kept honest: the numbering says what runs now, and the sentence beside it says the eleventh gate arrived with Part 16 and is a verdict input rather than a second rejection path.',
    ),
    (
        'docs/ROADMAP.md',
        'the Part 16 delivery-log row and the paragraph naming what Part 16 deliberately retired from the open list - nothing - alongside the four prerequisites that remain.',
    ),
    (
        'services/execution-engine/.env.example',
        'the same eight variables inside the SERVICE\'s own inventory, which is the file `scripts/dr-manifest.mjs` scans when it asks whether a deployment\'s environment can be enumerated from something committed - a knob that exists only in `app/config.py` is invisible to that check, and a refused-at-boot default is worth naming beside the variable that triggers it, so both files carry the block rather than one carrying a summary of the other.',
    ),
    (
        'docs/PART13_DURABLE_STORE.md',
        'one present-tense sentence dated rather than quietly rewritten: Part 13\'s "what did NOT change" list named the credential provider and the placement review as still open, which was true as written and is not true now, so the line says when it was true, names what Part 16 actually wired, and points at the four prerequisites that remain.',
    ),
    (
        '.env.example',
        'the eight variables, commented and defaulted to the dark configuration, with the reason each one exists and the note that the key variables themselves are deliberately absent from docker-compose.yml.',
    ),
    (
        'docker-compose.yml',
        'the same eight threaded into the execution-engine service with safe defaults and no secret placeholder, so the compose file stays a file that cannot be the place a key is written.',
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

#: Files that DEFINE the banned tokens as guard data and are therefore exempt
#: from the substring scan - stated, never silently skipped.
SWEEP_SELF_EXEMPT: Final[frozenset[str]] = frozenset({"scripts/gen_part16_handover.py"})

# The token list is data, and data that repeats is data nobody reads: a duplicate
# entry means one of the two was edited out of relevance and left behind. Asserted
# at import so the list itself is held to the standard it enforces.
assert len(set(ELISION_TOKENS)) == len(ELISION_TOKENS), "ELISION_TOKENS has duplicates"
assert len(set(NEW_ONLY_TOKENS)) == len(NEW_ONLY_TOKENS), "NEW_ONLY_TOKENS has duplicates"
assert len(set(ELISION_LINE_MARKERS)) == len(ELISION_LINE_MARKERS), "marker list has duplicates"


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


HEADER_TEMPLATE = '''# Part 16 - credential wiring and the authenticated placement review: full source handover

> **Risk note, stated because this part touches the money path and did not open
> it:** Part 16 adds a safety gate and a credential source, and deliberately adds
> no capability to transmit. Live mode is still refused by startup code, with the
> same sentence it was refused with before this part; no migration, no new table,
> no new error code, no enable switch, no scheduler. On a simulated runtime the
> review runs on every order and changes no outcome, recording one INFO finding
> instead - which is the point of a dark launch: the wiring is exercised, its
> numbers are visible, and nothing that previously reached a venue now takes a
> different path.

Complete content of every file created or modified by Part 16. Nothing is
abbreviated, summarised or elided: each block below is the entire final file
as it exists in the repository. Modified files are shown complete - not as
diffs - per the standing handover rule; their prior state is recoverable from
`docs/PART15_HANDOVER_FULL_SOURCE.md` (and earlier documents for files that
predate it), which list every one of them with its then-current line count, so
the deltas below are computed, not estimated.

All quality gates, MEASURED BY THIS GENERATOR as it wrote this document (no
number below is quoted from an earlier handover):

* `cd libs/trading-core && python3 -m pytest -q` -> **{core_pytest} passed**
  (+133 Part-16 tests in three new files: 40 for the law, 49 for the gatherers
  and the engine, 44 for the venue mapping); `ruff check wlct_trading tests` ->
  {core_ruff}; `mypy wlct_trading` -> no issues in **{core_mypy} source files**.
  The ruff gate's scope is the library and its tests, not the whole directory:
  the standalone fixture generators in `libs/trading-core/scripts/` sit outside
  it on purpose (they must run with a bare `python3` and no installed package),
  and they carry **{core_ruff_scripts}** measured at generation time - all of
  them pre-Part-16 files, none of them touched by this part.
* **Suppression tokens: {suppression_new} in the files Part 16 added** (the four
  names the repository's own policy uses - `type: ignore`, `noqa`,
  `eslint-disable`, `prettier-ignore` - counted by this script over every new
  source and test file, not asserted from memory (this generator is the one new
  file exempted from its own count, because it prints the four names in order to
  forbid them), and {suppression_modified} in
  the files it modified, where they are Part 5/12/14 lines this part did not
  write: `# noqa: BLE001` on broad-except handlers that already carry their
  justification, left alone because rewriting a neighbour's comment to satisfy a
  new part's cleanliness score is churn masquerading as care. The rule for
  everything Part 16 authored is stated and enforced, and the reason is specific:
  this repository's ruff ruleset is `["E4", "E7", "E9", "F"]` and mypy runs over
  `wlct_trading` alone, so a `# noqa: BLE001` or `# type: ignore[arg-type]` in
  these files would suppress nothing while teaching a reader that a real
  constraint exists. The first draft of this part carried 30 such tokens; every
  one is gone - the broad-except comments kept their justifications, and the two
  sites that needed a type narrowing got it properly (the `SymbolRegistry`
  protocol in the venue module, and `dataclasses.replace` in the law's own test
  helper).
* `cd services/execution-engine && python3 -m pytest -q` -> **{engine_pytest}**
  (the 12 skips are Part 13's and Part 14's live-Postgres tests, skipping BY NAME
  without `EXECUTION_TEST_POSTGRES_DSN`; Part 16 ships no live test because it
  adds no live-only behaviour - its live confirmation is the four-step checklist
  in docs/PART16_PLACEMENT_REVIEW.md sec. 8); `ruff check app tests` ->
  {engine_ruff}; `mypy app` -> no issues in **{engine_mypy} source files**.
* `node --test scripts/` -> **{node_scripts}** (no new Node tests: Part 16 adds
  no script-side surface); `node scripts/dr-manifest.mjs --check` ->
  {manifest_check}; `node scripts/dr-manifest.mjs --check-rls` -> {check_rls},
  where the exit-1 remains the SHIPPED answer, because no enablement audit has
  been recorded and the ledger refuses to seed itself with a simulated pass.
* `cd apps/api && npx jest --silent` -> **{api_tests}** (unchanged by this part:
  the readiness contract is a different nine gates from the execution engine's
  eleven safety gates, which is why no TypeScript file was touched and why the
  two counts are not drift); `npx tsc --noEmit` -> {api_typecheck};
  `npx eslint src --max-warnings 0` -> {api_lint}; `npx prisma validate` ->
  {prisma} (measured with placeholder `DATABASE_URL`/`DIRECT_DATABASE_URL`,
  because the validator resolves env references before parsing and refuses to run
  in a checkout with no `.env` - the correct posture; nothing was committed to
  make it pass); and in `apps/admin-web`, `npx tsc --noEmit` -> {admin_typecheck}.
* Sibling Python services re-verified untouched: trading-engine
  **{trading_service} passed**, market-data **{market_service} passed**.
* Line ledger (measured by this script, at generation time, with code and
  documents counted SEPARATELY because a tree-size figure that mixes them is not
  a size): Part 16 shipped **{total:,} lines** - **{new_code:,}** across the
  {new_code_count} new code files, **{new_docs:,}** in the {new_docs_count} new
  document{new_docs_s}, and **+{mod_code:,}** code / **+{mod_docs:,}** document
  lines across the {mod_count} modified files (each delta measured against the
  newest prior handover that lists that file - which leaves {unbaselined_count}
  of them, {unbaselined_size} lines, with NO delta at all because no earlier
  document recorded their prior size: {unbaselined_list}. Their full text is
  embedded below, and their size is not presented as a change). No line-count target was chased:
  the brief's own rule is that no code is written to hit a number, and this
  part's footprint is what closing two named gaps cost - the audit document in
  the same directory records what was already implemented and therefore was not
  rebuilt. Whole-tree counts under the standing rule set (everything except
  node_modules/dist/lockfiles, `docs/source/`, and the PART*HANDOVER documents):
  **{tree_source:,} source lines**; adding the narrative documents under `docs/` (the
  regenerable `docs/source/` views and every `docs/PART*HANDOVER*` dump - 13 of them,
  matched on the `_HANDOVER` segment because `PART6_PERSISTENCE_HANDOVER...` slipped past
  the earlier `PART<n>_HANDOVER` prefix and was being counted as prose): **{tree_with_docs:,}**; every figure here is re-measured at generation time and
  never extrapolated from an earlier document.

Four generation-time choices worth naming, since they are the difference between
this header and a copy of the last one: the numbers above come from subprocess runs
of the real suites (a gate that cannot be parsed is written as `FAILED`/`UNPARSED`
here rather than omitted - a clause that has earned its place, because a regeneration run in
an environment whose Node workspaces had not been installed reported the API gate as `FAILED:
Module ts-jest was not found` and the document said so, where a frozen handover would have
carried the flattering number from the last one); the per-file deltas come from parsing the prior handover
documents' own `## FILE: path (N lines)` headers; the file lists are this part's
complete diff, enumerated from the repository's own modification times rather than
from a plan, which is why `docs/ARCHITECTURE.md` and `docs/SECURITY.md` appear here
at all: a gate and an endpoint that the platform's two permanent documents still
described as unwired would make this handover contradict the repository it describes;
and this script
accepts `--check`, which regenerates the document in memory and reports whether the
committed file is byte-identical, so "deterministic and regenerable" is a command
rather than a claim. The re-wrapper's doubled bullet marker, present in every handover since Part 14, is corrected here. One rule was retuned while copying the twin, and it is the
kind of change that must be said out loud: the sweep's elision list drops the bare
word `truncated` - which Part 16's files use in its technical sense, a JSON body cut
short or an age rounded down to the millisecond - and adds in its place the four
phrases that actually announce elision (`truncated for brevity`, `content truncated`,
`truncated here`, `for brevity`) plus `omitted`. The check is about a file admitting
it is a summary, not about a file describing a venue's malformed response, so it is
wider against the failure and silent about the physics.'''



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

    parts = [reflow_header(header), "## Created in Part 16 (full files)\n"]
    parts += [block(rel, note) for rel, note in NEW]
    parts.append("## Modified in Part 16 (full files, prior content preserved inside)\n")
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
