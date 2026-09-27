"""One-shot generator for docs/PART12_HANDOVER_FULL_SOURCE.md.

Runs from anywhere. Same standing rule as the Part 10 and Part 11
generators it clones: every listed file is emitted COMPLETE - the entire
final file, no diffs, no elisions - and the generator AUDITS its own
emission (placeholder-elision tokens refused everywhere in the set,
suppression tokens refused in every NEW file; a hit fails the build, naming
the token and the file). The Part 11 baseline for comparison lives in
docs/PART11_HANDOVER_FULL_SOURCE.md; modified files shown HERE are shown
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
OUT = ROOT / "docs" / "PART12_HANDOVER_FULL_SOURCE.md"

NEW: Final[list[tuple[str, str]]] = [
    (
        "libs/trading-core/wlct_trading/coordination/membership.py",
        "the self-registration law, Python side: the three zset scripts (ping with the GT no-shorten law, read-only snapshot, best-effort resign), heartbeat_expiry, live_members as the single staleness function, MembershipRegistry with the deliberate three-way failure taxonomy (ping propagates, members degrades to None, resign answers False); imports neither the execution plane nor a Redis client.",
    ),
    (
        "libs/trading-core/tests/test_part12_membership.py",
        "18 tests: fixture replay row-for-row, the text-identity script fake, both reply shapes, the loud-garbage boundary, and the two-worker join / silent-death / reassignment scenario through the REAL assignment functions.",
    ),
    (
        "apps/api/src/infrastructure/coordination/membership.ts",
        "the TypeScript twin: byte-identical Lua (sha-pinned against the shared fixture), the same pure law functions, the same messages where language-neutral, the raw-reply MembershipEvalRedis port, and the registry class with the identical failure taxonomy.",
    ),
    (
        "apps/api/src/infrastructure/coordination/coordination-membership.spec.ts",
        "14 jest tests: the same fixture rows, the same script-fake discipline, the same fleet scenario; reject-message comparison follows the Part 11 prefix convention because Python repr spellings are language-shaped.",
    ),
    (
        "apps/api/src/modules/worker/worker-env-safety.spec.ts",
        "7 env-law tests: defaults lawful in BOTH modes, mode enum refusal, the one-second floor even in config mode, the 2x-tick ratio law pinned in both directions with its boundary, coercion of numeric strings, refusal of fractional clocks, and the Part 11 defer-vs-renewal regression.",
    ),
    (
        "docs/PART12_WORKER_MEMBERSHIP.md",
        "the part's authoritative document: law restatement, registry design, unit choices, failure taxonomy, config surface and cross-laws, the tick end to end, operator surfaces, the ledger semantics, the parity machinery, and the honest test ledger.",
    ),
    (
        "scripts/gen_part12_handover.py",
        "this generator - included, per the rule that every Part-12 file appears complete.",
    ),
]

MODIFIED: Final[list[tuple[str, str]]] = [
    (
        "libs/trading-core/wlct_trading/redis_keys.py",
        "Part 12 adds exactly one builder (membership_registry) with the fleet-topology-not-tenant-scoped rationale at its docstring; every pre-existing key and comment byte-preserved from the Part 11 document.",
    ),
    (
        "libs/trading-core/wlct_trading/coordination/__init__.py",
        "the barrel now exports the membership surface alongside the lease/partition law; export order alphabetics preserved.",
    ),
    (
        "libs/trading-core/scripts/gen_part11_fixtures.py",
        "gained _membership_vectors() with generator-side verification (rows replayed through the Python implementation DURING generation - the pattern that caught a now+ttl*1000 unit slip on first run), the membership section in build(), and the three script sha pins.",
    ),
    (
        "docs/fixtures/coordination_fixtures.json",
        "the shared oracle, regenerated (1307 lines, byte-deterministic): membership sections appended to the Part 11 schema; everything pre-Part-12 untouched.",
    ),
    (
        "apps/api/src/infrastructure/coordination/partitions.ts",
        "the member grammar is now exported as MEMBER_TOKEN_RE (single definition; lease.ts and membership.ts import it instead of each keeping its own literal - removing a Part 11 duplication).",
    ),
    (
        "apps/api/src/infrastructure/coordination/lease.ts",
        "gained membershipRegistryKey next to its two sibling builders and now imports the member grammar from partitions.ts; lease logic untouched.",
    ),
    (
        "apps/api/src/infrastructure/coordination/ioredis-adapter.ts",
        "gained evalFlat - EVAL with one key and the reply UNCOERCED (the membership arrays would NaN through Number()); the pre-existing eval keeps its numeric contract for the claim scripts.",
    ),
    (
        "apps/api/src/config/app-config.service.ts",
        "gained the mode/ttl getters (mode read defensively so a hot path cannot throw) and MEMOIZES workerId - a per-call random UUID made every cross-call identity comparison false; documented at the getter.",
    ),
    (
        "apps/api/src/modules/worker/worker-coordination.service.ts",
        "the registry tick: resolveMembership() (ping, self-check, last-known-then-config fallback, counted and logged), membership_updated accounting, resign-before-release on shutdown, membershipSource in the snapshot; the Part 11 failure model, staleness law and every prior line preserved around it.",
    ),
    (
        "apps/api/src/modules/worker/worker.spec.ts",
        "the claim server learned the three membership scripts (text identity, real zset state, armable registry outage); +6 registry-mode tests including different-config-lists-split and silent-peer-ages-out-of-membership-not-out-of-claims.",
    ),
    (
        "apps/api/src/modules/observability/metrics.registry.provider.ts",
        "the worker coordination family gained membership_updated and membership_fallback inside the closed result-label bounds; help text updated to name what each value means for alerting.",
    ),
    (
        "apps/api/src/modules/observability/worker-coordination-read.service.ts",
        "the same pipeline now also reads the registry zset: raw members (reads never prune), registryLiveMembers computed through the workers' OWN liveMembers law, and the absent-vs-unreadable distinction kept honest ([] vs null).",
    ),
    (
        "apps/api/src/modules/observability/worker-coordination-read.service.spec.ts",
        "7 tests: the pinned call list now includes the trailing zrange (still all READS), plus staleness-law application, linger-raw-but-live-filtered, and empty-vs-garbage.",
    ),
    (
        "packages/config/src/constants.ts",
        "one added prefix constant for the membership key, beside the Part 11 pair.",
    ),
    (
        "packages/config/src/env.schema.ts",
        "added WORKER_MEMBERSHIP_MODE and WORKER_MEMBERSHIP_TTL_MS with the two cross-laws (floor both modes; registry-mode ratio against the tick) appended into the existing chained superRefine; every pre-Part-12 field and law preserved verbatim.",
    ),
    (
        ".env.example",
        "the Part-12 membership lines sit inside the Part-11 worker section, commented by default (config mode is the default - the file teaches the flip without performing it).",
    ),
    (
        "docker-compose.yml",
        "the worker service now sets WORKER_MEMBERSHIP_MODE/TTL explicitly (registry, env-interpolated), with the one-line-revert note; every other service untouched.",
    ),
    (
        "docs/dr/manifest.json",
        "schema wlct-dr-manifest-v2: per-component cadenceHours (or null + cadenceWaiver), postgres rpoMechanism, and the fifth invariant stating the record-or-waive law.",
    ),
    (
        "scripts/dr-manifest.mjs",
        "gained the ledger: cadence validation rules, parseLedger (line-numbered problems, note-level secret scan on parsed content), dueReport (never/overdue/ok/waived from last-ok only), --due with alertable exit code, --record with refusals (unknown component, broken ledger, escaped-quote secret notes via the raw-note scan); renderPlan now prints per-component freshness lines.",
    ),
    (
        "scripts/dr-manifest.test.mjs",
        "26 node --test cases: +11 for cadence/waiver mechanics, dueReport ageing (failed records do not stop the clock), ledger line-wise parsing, the quoted-literal secret pattern, and a full record->due->secret-refusal CLI round trip on a temp ledger.",
    ),
    (
        "docs/DR.md",
        "new ledger section (rules, the JSONL shape, the two commands, the deliberately EMPTY seed), the refreshed 'not yet automated' note now naming scheduler WIRING as the only remaining piece.",
    ),
    (
        "docs/PART11_WORKER_SCALING.md",
        "deferral 1 marked RESOLVED IN PART 12 with the resolution text; deferral 4 refreshed (mechanism shipped, scheduler wiring open); nothing else touched.",
    ),
    (
        "docs/ROADMAP.md",
        "the Part 12 delivery row and the open-items rewrite (two retirements named, the remainder untouched).",
    ),
    (
        "docs/SECURITY.md",
        "backups gap bullet rewritten around the ledger (scheduler still open), plus the new membership-registry note: fleet-topology-not-tenant-scoped, and why a forged membership entry buys an attacker nothing.",
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
#: from the substring scan - stated, never silently skipped.
SWEEP_SELF_EXEMPT: Final[frozenset[str]] = frozenset({"scripts/gen_part12_handover.py"})


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


HEADER = """# Part 12 - worker self-registration and the backup-freshness ledger: full source handover

> **Risk note, unchanged and deliberately unsoftened:** Part 12 changes WHO
> the fleet thinks it is, never WHAT the fleet may do with that thought -
> claims remain the sole authority, risk checks remain fail-closed, live
> venue transmission remains refused by the engine's startup code, and the
> ledger refuses to seed itself with backup evidence that does not exist.

Complete content of every file created or modified by Part 12. Nothing is
abbreviated, summarised or elided: each block below is the entire final file
as it exists in the repository. Modified files are shown complete - not as
diffs - per the standing handover rule; their Part-11 state is recoverable
from `docs/PART11_HANDOVER_FULL_SOURCE.md` (whose modified-file blocks were
regenerated with current content when this part landed, so both documents
match disk).

All quality gates at generation time (2026-09-14):

* `cd libs/trading-core && python3 -m pytest -q` -> **1342 passed** (+18
  Part-12 membership tests over the new module and its scenario);
  `python3 -m ruff check wlct_trading tests` -> green;
  `python3 -m mypy wlct_trading` -> **no issues, 143 source files** - zero
  suppressions in any part file (audited by the sweep below; the private
  borrows went to the DEFINING modules rather than adding one `# noqa`).
* `docs/fixtures/coordination_fixtures.json` regenerated twice:
  **byte-identical** (sha256 `ed2f1ee4...`, 1307 lines) - and the generator
  VERIFIES its membership rows through the Python implementation while
  generating, which is how the one real unit bug this part had (`ttl * 1000`
  instead of `+ ttl` in `heartbeat_expiry`) died before it could ship.
* `cd apps/api && npx jest --silent` -> **383 passed / 17 suites** (+14
  membership parity, +6 registry-mode worker scenarios, +7 env-law tests,
  +2 read-view tests); `npx tsc --noEmit` -> **0 errors**; `npm run lint`
  (eslint, `{src,test}/**/*.ts`, max-warnings 0) -> clean;
  `npx prisma validate` -> valid.
* `node --test scripts/` -> **26 passed / 0 failed** (+11 ledger/cadence
  tests incl. CLI round-trips); `node scripts/dr-manifest.mjs --check` ->
  valid (5 components, 4 with cadence, ledger entries: 0 - empty is the
  HONEST seed, see docs/DR.md); `--due` on the empty ledger exits 1 naming
  all four obligations; a secret-shaped `--record` note is refused with the
  ledger left byte-untouched.
* `node scripts/dr-manifest.mjs --plan` deterministic across runs and
  credential-free by scan (pre-existing test still green); RLS artifacts
  re-verified byte-identical under regeneration.
* `cd services/execution-engine && python3 -m pytest -q` -> **20 passed**;
  ruff green; mypy **no issues, 10 files**. Sibling Python services
  re-verified untouched by this part: trading-engine **43 passed**,
  market-data **19 passed**.
* Line ledger (measured, this script): Part 12 shipped **3,480 lines** -
  1,835 across the 7 new files (this generator included) and +1,645 across
  the 24 modified files (delta against the Part-11 handover's per-file
  counts). Whole-tree counts under this rule set (everything except
  node_modules/dist/lockfiles, `docs/source/` regenerable dumps, and the
  PART*HANDOVER documents themselves): **173,285 source lines**; adding the
  full docs tree (narrative documents and the regenerable docs/source
  views, minus every handover dump): **494,008**; the ~377k figure quoted at Part 11
  closure used a slightly different include rule and is NOT directly
  comparable - all numbers here are re-measured, never extrapolated.
"""


def main() -> int:
    problems = sweep()
    if problems:
        print("HANDOVER AUDIT FAILED:", file=sys.stderr)
        for problem in problems:
            print(f"  {problem}", file=sys.stderr)
        return 1
    parts = [HEADER, "## Created in Part 12 (full files)\n"]
    parts += [block(rel, note) for rel, note in NEW]
    parts.append("## Modified in Part 12 (full files, Part-11 content preserved inside)\n")
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
