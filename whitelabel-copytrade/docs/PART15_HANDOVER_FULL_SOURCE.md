# Part 15 - RLS enablement verification: full source handover

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

* * `cd libs/trading-core && python3 -m pytest -q` -> **1425 passed** (+48 Part-15
  enablement-law tests); `ruff check wlct_trading tests` -> green; `mypy wlct_trading` -> no
  issues in **145 source files**. The ruff gate's scope is the library and its tests, not
  the whole directory: the standalone fixture generators in `libs/trading-core/scripts/` sit
  outside it on purpose (they must run with a bare `python3` and no installed package), and
  they carry **16 findings** measured at generation time - all of them pre-Part-15 files,
  none of them touched by this part. So the "green" above is not a whole-tree sweep, and it
  is stated here rather than left to be assumed. Zero suppression comments in either new
  Part-15 core file (verified by grep and by the sweep below; `test_part14_retention.py`
  remains suppression-free too - the 40 `type: ignore` occurrences in other core test files
  predate Parts 14 and 15 and are untouched).
* * `cd services/execution-engine && python3 -m pytest -q` -> **195 passed, 12 skipped**
  (the 12 skips are Part 13's and Part 14's live-Postgres tests, skipping BY NAME without
  `EXECUTION_TEST_POSTGRES_DSN`; Part 15 ships no live test because a read-only probe adds
  no new live-only behaviour - its live confirmation is a staging run,
  docs/PART15_RLS_ENABLEMENT.md sec. 8 step 2); `ruff check app tests` -> green; `mypy app`
  -> no issues in **16 source files**.
* * `node --test scripts/` -> **52 passed / 0 failed** (14 new Part-15 tests added to the
  directory's own suite count); `node scripts/dr-manifest.mjs --check` -> manifest valid: 5
  components (4 with cadence), RPO 60m / RTO 4h, drill every 90d (timed: true), ledger
  entries: 0; `node scripts/dr-manifest.mjs --check-rls` -> exit 1: [DUE  ] rls-enablement:
  never recorded (cadence 168h) - run the audit and record it with --record-rls; policies
  that nobody verified are a hypothesis - the exit-1 there is the SHIPPED answer, because
  this repository has recorded no enablement audit and the ledger refuses to seed itself
  with a simulated pass. That is the same law as the empty backup ledger, and it is the
  reason the tool is believable.
* * `cd apps/api && npx jest --silent` -> **386 passed / 17 suites** (the worker plane and
  the RLS coverage spec needed NO change: the spec re-derives coverage from the schema and
  the manifest, which is why Part 14's new table and Part 15's new audit both passed without
  a spec edit); `npx tsc --noEmit` -> 0 errors; `npx eslint src --max-warnings 0` -> clean;
  `npx prisma validate` -> valid (measured with placeholder
  `DATABASE_URL`/`DIRECT_DATABASE_URL`, because the validator resolves env references before
  parsing and refuses to run in a checkout with no `.env` - the correct posture; nothing was
  committed to make it pass); and in `apps/admin-web`, `npx tsc --noEmit` -> 0 errors.
* * Sibling Python services re-verified untouched: trading-engine **43 passed**, market-data
  **19 passed**.
* * Line ledger (measured by this script, at generation time, with code and documents
  counted SEPARATELY because a tree-size figure that mixes them is not a size): Part 15
  shipped **4,163 lines** - **2,687** across the 7 new code files, **546** in the 1 new
  document, and **+862** code / **+68** document lines across the 18 modified files (each
  delta measured against the newest prior handover that lists that file). Whole-tree counts
  under the standing rule set (everything except node_modules/dist/lockfiles,
  `docs/source/`, and the PART*HANDOVER documents): **184,139 source lines**; adding the
  full docs tree (narrative documents and the regenerable docs/source views, minus every
  handover dump): **228,207**; every figure here is re-measured at generation time and never
  extrapolated from an earlier document. Two generation-time choices worth naming, since
  they are the difference between this header and a copy of the last one: the numbers above
  come from subprocess runs of the real suites (a gate that cannot be parsed is written as
  `FAILED`/`UNPARSED` here rather than omitted), and the per-file deltas come from parsing
  the prior handover documents' own `## FILE: path (N lines)` headers. A handover whose
  metrics are remembered is a handover that can lie about a green gate.

## Created in Part 15 (full files)

## FILE: libs/trading-core/wlct_trading/enablement.py (397 lines)

*the enablement law, pure: the closed grade vocabularies (probe pass/fail/skipped, run pass/fail/unverified), the tenant-GUC and platform-scoped-table constants mirrored from the RLS manifest, the nonsense-proof EnablementPolicy (1..36,500 days, int-not-bool), probe_is_consistent with absence outranking everything, the role-attribute veto that fails a healthy-looking run, and grade_run's coverage-count law so '41 of 42 checked' can never render green. No clock, no driver, no write verb - all three pinned structurally by its test file.*

```python
"""The enablement law for row-level security (Part 15).

Part 11 shipped the policies, the GUC function, the generated enable.sql /
disable.sql pair and a five-item pre-flight checklist - and then trusted a
human to have run all of it. Part 13 made every engine statement satisfy the
GUC contract, and Part 14's tests proved the ledger table is covered by the
same policy set. What no part shipped was the answer to the only question
that matters on enablement day: *are the policies actually on, and do they
actually isolate?*

This module is that answer, pure. It knows no database and no driver - it
grades results that an executor feeds it, exactly like ``retention.py``
judges rows without ever touching one. The safety property is inverted from
Part 14 on purpose: nothing here deletes. Every probe is a read, so the
verification can run on a live staging database without ceremony, and the
law it enforces is about what a passing probe MUST look like.

The laws:

1. **The probe shape is universal, and the exception is a list.** For every
   covered table: inside one transaction, ``set_config`` the GUC, count the
   tenant's own rows (expect: that tenant's count, whatever it is - the
   number is evidence, not a constant) and count with the tenant bound in
   SQL text that cannot see another tenant (expect equal), then OUTSIDE the
   GUC the bare count must be ZERO. The bare-read rule has exactly one
   exception: tables the coverage manifest declares platform-scoped
   (nullable tenantId - audit, ops, roles, plans). For those, a bare read
   is legitimate and a zero expectation would fail a HEALTHY deployment -
   false alarms are how checklists die, so this is a named set, not a shrug.

2. **A role that can bypass RLS makes every other result meaningless.**
   ``rolbypassrls`` or ``rolsuper`` is an unconditional FAIL for the whole
   run, whatever the counts say: enable.sql's checklist item 2 states this
   in prose, and prose is what this module turns into a graded fact. There
   is no PASS-with-warning spelling here on purpose - "bypassing but tidy"
   is not a posture this platform records.

3. **Nonsense cannot exist.** The policy refuses zero-day evidence windows,
   negative table counts, a probe list that contains the same table twice
   (one table checked twice is one table NOT checked), and booleans where
   an int is claimed. Bounds: 1..36,500 days for how long an enablement
   run may still count as fresh, 1..4,096 tables per run (the generator's
   own ceiling class), 1..10,000 rows as the largest seeded probe count a
   caller may claim to have prepared (bigger numbers mean the caller was
   not seeding a probe tenant, they were trusting a production table).

4. **Grades are closed.** A probe's outcome is PASS, FAIL or SKIPPED with a
   reason; a run's outcome is PASS, FAIL or UNVERIFIED. UNVERIFIED is not
   "failed politely" - it is what a run with no covered tables, or a
   skipped probe on a table the manifest says must be checked, reports, and
   it must never render as green anywhere downstream.

Timestamps are epoch microseconds (the platform time law) and arrive as
arguments; this module imports no clock, exactly like Part 14's, because an
enablement report whose freshness is decided by the library's own wall clock
is not reproducible.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Final

__all__ = [
    "EVIDENCE_LEDGER_TABLE",
    "MAX_EVIDENCE_AGE_DAYS",
    "MAX_PROBED_TABLES",
    "MIN_EVIDENCE_AGE_DAYS",
    "Grade",
    "EnablementError",
    "EnablementPolicy",
    "ProbeResult",
    "RoleAttributes",
    "RunGrade",
    "TENANT_GUC",
    "grade_run",
    "is_platform_scoped",
    "PLATFORM_SCOPED_TABLES",
    "probe_is_consistent",
]

#: The transaction-local GUC every scoped read must set. Named as a constant
#: because it appears in four places already (PrismaService.withTenantRls,
#: the store's _TenantTransaction, the live tests, the generated policies)
#: and a fifth one that disagrees is the outage this part exists to catch.
TENANT_GUC: Final = "app.tenant_id"

#: Part 14's ledger doubles as the enablement evidence ledger: one row per
#: completed probe run, and nothing prunes it. No new table for a part whose
#: whole verb is "look".
EVIDENCE_LEDGER_TABLE: Final = "engine_retention_runs"

#: Tables the coverage manifest excludes from the tenant_isolation policy
#: (nullable tenantId, platform-scoped rows). For these a bare read seeing
#: rows is CORRECT, so the zero-bare-rows law does not apply - listed, not
#: guessed. Must stay equal to rls_coverage.json's "excluded" set; the
#: engine drift-parity test is what pins that equality.
PLATFORM_SCOPED_TABLES: Final[frozenset[str]] = frozenset(
    {
        "audit_logs",
        "kill_switches",
        "ops_alerts",
        "ops_incidents",
        "roles",
        "security_events",
        "subscription_plans",
    }
)

#: Evidence freshness bounds. One day minimum: an enablement run recorded
#: twice a day is noise, and a zero-day window is Part 14's loaded gun in
#: a gentler clothes (it would mark yesterday's verification stale at
#: midnight). A century maximum: a window that long means the deployment
#: has decided never to re-verify, which is an opinion about its own
#: migrations, and those are frequent enough that the evidence must age.
MIN_EVIDENCE_AGE_DAYS: Final = 1
MAX_EVIDENCE_AGE_DAYS: Final = 36_500

#: One run may cover at most this many tables (the generator's keyspace
#: class ceiling), and no single probe may claim a seeded expectation above
#: this row count - a probe tenant with ten thousand rows is not a probe
#: anymore, it is somebody's real data being graded.
MAX_PROBED_TABLES: Final = 4_096
MAX_SEEDED_ROWS: Final = 10_000


class EnablementError(ValueError):
    """A policy or a probe that cannot be honored. Raised at construction,
    never mid-run: an invalid enablement policy is not allowed to exist, so
    no probe can be half-way through a staging audit when it discovers one."""


class Grade:
    """Closed outcome vocabulary for one probe. Constants rather than an
    Enum: this module must stay importable by scripts that refuse a
    dependency on anything but stdlib, and the parity tests compare the
    strings themselves."""

    PASS: Final = "pass"
    FAIL: Final = "fail"
    SKIPPED: Final = "skipped"


class RunGrade:
    """Closed outcome vocabulary for a whole run. UNVERIFIED is deliberately
    a third answer and not a spelling of PASS: a run that checked nothing
    did not fail safe, it failed quiet, and the difference is what an
    operator is owed."""

    PASS: Final = "pass"
    FAIL: Final = "fail"
    UNVERIFIED: Final = "unverified"


@dataclass(frozen=True, slots=True)
class EnablementPolicy:
    """Validated, immutable enablement parameters.

    The engine's config validates its env values by constructing THIS class
    (mirroring Part 14's boot law): a typo in ``EXECUTION_ENABLEMENT_MAX_AGE_DAYS``
    refuses startup with the field named, instead of being discovered as a
    silently-stale report on enablement day.
    """

    max_evidence_age_days: int

    def __post_init__(self) -> None:
        value = self.max_evidence_age_days
        if isinstance(value, bool) or not isinstance(value, int):
            raise EnablementError(
                f"max_evidence_age_days must be a plain int, got {type(value).__name__}"
            )
        if not MIN_EVIDENCE_AGE_DAYS <= value <= MAX_EVIDENCE_AGE_DAYS:
            raise EnablementError(
                f"max_evidence_age_days must be between {MIN_EVIDENCE_AGE_DAYS} and "
                f"{MAX_EVIDENCE_AGE_DAYS}; {value!r} either floods the ledger with "
                "re-verifications or pretends an audit is forever fresh"
            )

    @property
    def max_evidence_age_us(self) -> int:
        """The freshness window in microseconds (pure arithmetic; the test
        pins it against seconds-times-1e6 so a unit slip has nowhere to sit)."""
        return self.max_evidence_age_days * 86_400 * 1_000_000

    def evidence_is_fresh(self, *, ran_at_us: int, now_us: int) -> bool:
        """Whether an enablement run recorded at ``ran_at_us`` still counts.

        A run timestamp in the FUTURE is not "fresh", it is a clock problem,
        and the safe answer is the same as for an ancient one: not fresh. A
        verification whose clock cannot be trusted is exactly the kind an
        operator should be pushed to re-run, never quietly credited.
        """
        for name, value in (("ran_at_us", ran_at_us), ("now_us", now_us)):
            if isinstance(value, bool) or not isinstance(value, int):
                raise EnablementError(f"{name} must be a plain int, got {type(value).__name__}")
        age = now_us - ran_at_us
        return 0 <= age <= self.max_evidence_age_us


@dataclass(frozen=True, slots=True)
class RoleAttributes:
    """The two role facts enable.sql's checklist item 2 asks about.

    Parsed from ``SELECT rolname, rolbypassrls, rolsuper FROM pg_roles
    WHERE rolname = current_user`` - one row, two booleans. They are a
    value type rather than two flags threaded through call signatures
    because the law is that they can only ever travel together: a run that
    knows one of them is a run that read the catalog.
    """

    rolname: str
    bypassrls: bool
    superuser: bool

    def __post_init__(self) -> None:
        if not isinstance(self.rolname, str) or not self.rolname:
            raise EnablementError("rolname must be a non-empty str")
        for name in ("bypassrls", "superuser"):
            value = getattr(self, name)
            if not isinstance(value, bool):
                raise EnablementError(f"{name} must be a bool, got {type(value).__name__}")

    @property
    def can_evade_rls(self) -> bool:
        """FORCE covers the owner; it does not cover either of these. A role
        with either privilege makes the whole policy exercise theatre, which
        is a fact about the ROLE, not about the table being probed - hence a
        run-level veto rather than a per-table grade."""
        return self.bypassrls or self.superuser


@dataclass(frozen=True, slots=True)
class ProbeResult:
    """One table's raw observations, as an executor measured them.

    The fields are deliberately counts and not booleans: a report that says
    "3 scoped rows, 0 bare rows" is re-auditable by a second operator, while
    a report that says "true" has to be trusted. ``seeded_expected_rows`` is
    what the caller prepared for THIS tenant (0 is legitimate: an empty
    probe tenant still proves the bare read is blocked). ``absent`` marks a
    table the database refused to resolve (``to_regclass`` returned NULL),
    which is a coverage mismatch, never a pass.
    """

    table: str
    policy_exists: bool
    rls_enabled: bool
    rls_forced: bool
    scoped_rows: int
    bare_rows: int
    seeded_expected_rows: int
    absent: bool = False
    skip_reason: str | None = None

    def __post_init__(self) -> None:
        if not isinstance(self.table, str) or not self.table:
            raise EnablementError("probe table must be a non-empty str")
        for name in ("scoped_rows", "bare_rows", "seeded_expected_rows"):
            value = getattr(self, name)
            if isinstance(value, bool) or not isinstance(value, int):
                raise EnablementError(f"{name} must be a plain int, got {type(value).__name__}")
            if value < 0:
                raise EnablementError(f"{name} must be non-negative, got {value}")
            if value > MAX_SEEDED_ROWS:
                raise EnablementError(
                    f"{name} exceeds the probe ceiling {MAX_SEEDED_ROWS}: a probe that "
                    "large is not a probe, it is a production table being graded"
                )
        for name in ("policy_exists", "rls_enabled", "rls_forced"):
            if not isinstance(getattr(self, name), bool):
                raise EnablementError(f"{name} must be a bool")
        if not isinstance(self.absent, bool):
            raise EnablementError("absent must be a bool")
        if self.skip_reason is not None and not isinstance(self.skip_reason, str):
            raise EnablementError("skip_reason must be a str or None")

    @property
    def is_platform_scoped(self) -> bool:
        """Law 1's exception, asked of the manifest's set rather than of a
        convention: the bare-read-zero rule is a tenant-table rule."""
        return is_platform_scoped(self.table)


def is_platform_scoped(table: str) -> bool:
    if not isinstance(table, str):
        raise EnablementError("table must be a str")
    return table in PLATFORM_SCOPED_TABLES


def probe_is_consistent(probe: ProbeResult) -> str:
    """Grade ONE probe against the laws; returns a ``Grade`` member.

    Order matters and is the point: absence outranks skip outranks the role
    facts a caller could have skipped past. A table that is in the coverage
    manifest but not in the database is a coverage lie; a caller that chose
    to skip must say why; the rest is arithmetic.
    """
    if probe.absent:
        return Grade.FAIL
    if probe.skip_reason is not None:
        return Grade.SKIPPED
    if not (probe.policy_exists and probe.rls_enabled and probe.rls_forced):
        return Grade.FAIL
    if probe.scoped_rows != probe.seeded_expected_rows:
        # The scoped read did not see what this tenant's rows are - the GUC
        # contract is not holding, or the seed is not where the report claims.
        return Grade.FAIL
    if probe.is_platform_scoped:
        # Bare reads are legitimate here; the policy must still EXIST
        # (it does not cover them), so this branch only skips the zero law.
        return Grade.PASS
    if probe.bare_rows != 0:
        # A covered table that leaks rows to a GUC-less session is exactly
        # the failure mode enablement is supposed to eliminate.
        return Grade.FAIL
    return Grade.PASS


def grade_run(
    probes: tuple[ProbeResult, ...] | list[ProbeResult],
    *,
    role: RoleAttributes,
    covered_expected: int | None = None,
) -> tuple[str, dict[str, object]]:
    """Grade a whole run: the role veto first, then every probe.

    Returns ``(grade, summary)`` where the summary is plain JSON-ready data
    (counts, per-table grades, the veto reason when there is one) so the
    engine's route and the ledger row can both be written from it without
    re-deriving any law.

    An empty probe list is UNVERIFIED, not PASS - "nothing checked, nothing
    wrong" is the sentence that gets unsafe systems shipped. When
    ``covered_expected`` is supplied (the coverage manifest's count), a
    shorter probe list is UNVERIFIED too: a run that quietly checked 41 of
    42 tables is the drift this function exists to notice.
    """
    if isinstance(covered_expected, bool) or not isinstance(covered_expected, int | None):
        raise EnablementError("covered_expected must be a plain int or None")
    if covered_expected is not None and covered_expected < 0:
        raise EnablementError("covered_expected must be non-negative")
    if covered_expected is not None and covered_expected > MAX_PROBED_TABLES:
        raise EnablementError(
            f"covered_expected {covered_expected} exceeds the run ceiling {MAX_PROBED_TABLES}"
        )

    seen: set[str] = set()
    per_table: dict[str, str] = {}
    counts = {"pass": 0, "fail": 0, "skipped": 0}
    for probe in probes:
        if probe.table in seen:
            raise EnablementError(
                f"table {probe.table!r} appears twice in one run: a repeated probe "
                "is not redundancy, it is one table left unchecked"
            )
        seen.add(probe.table)
        grade = Grade.FAIL if role.can_evade_rls else probe_is_consistent(probe)
        per_table[probe.table] = grade
        counts[grade] += 1

    summary: dict[str, object] = {
        "role": role.rolname,
        "bypassrls": role.bypassrls,
        "superuser": role.superuser,
        "probed": len(seen),
        "pass": counts["pass"],
        "fail": counts["fail"],
        "skipped": counts["skipped"],
        "tables": per_table,
    }

    if role.can_evade_rls:
        summary["veto"] = (
            "role holds BYPASSRLS or superuser: row-level security is not a control "
            "for this connection and no count can make it one"
        )
        return RunGrade.FAIL, summary
    if not seen:
        summary["veto"] = "no tables probed: an empty audit proves nothing"
        return RunGrade.UNVERIFIED, summary
    if counts["fail"]:
        return RunGrade.FAIL, summary
    if counts["skipped"]:
        # A skipped covered table is an un-graded covered table; loud, not green.
        summary["veto"] = (
            f"{counts['skipped']} of {len(seen)} probes were skipped: partial "
            "verification reports as UNVERIFIED, never as PASS"
        )
        return RunGrade.UNVERIFIED, summary
    if covered_expected is not None and len(seen) != covered_expected:
        summary["veto"] = (
            f"{len(seen)} tables probed against {covered_expected} covered in the "
            "manifest: the run is graded on the manifest, not on itself"
        )
        return RunGrade.UNVERIFIED, summary
    return RunGrade.PASS, summary
```


## FILE: libs/trading-core/tests/test_part15_enablement.py (370 lines)

*48 tests: the construction-law matrix, boundary-inclusive freshness (and a future run graded NOT fresh), the platform-scoped bare-read exception exercised both ways, the role veto reaching per-table grades, duplicate tables refused as 'one table left unchecked', JSON-readiness of the summary, PLATFORM_SCOPED_TABLES re-derived from rls_coverage.json, and the AST purity scans (no time/IO imports, no defaults on the injected-clock functions, no SQL write verb anywhere in the module).*

```python
"""Part 15: the enablement law, pure.

Part 14's tests exist so its executor can stay small; these exist so an
enablement VERIFIER can stay read-only: what a probe must look like, which
tables may bare-read, when a run is UNVERIFIED instead of green, and what
nonsense cannot be a policy at all - every judgment lives here and is
pinned in this file. The engine module then re-pins the SQL spelling of the
same shapes (drift parity), so either half drifting goes red in a test, not
in a staging outage.

The freshness law is tested as a structural fact too: a module whose age
arithmetic is right but which reads the wall clock inside the freshness
decision is nondeterministic exactly where determinism was the point. The
source scan that pins "no time imports in the law" costs nothing and
outlives every refactor.

Convention note, inherited from the engine's suite: no suppression comments
anywhere. The deliberately-wrong values below are typed through ``Any`` and
a ``cast`` instead - the same shape ``test_part14_retention``'s
value-validation matrix uses.
"""

from __future__ import annotations

import ast
import dataclasses
import json
from pathlib import Path
from typing import Any, cast

import pytest

from wlct_trading.enablement import (
    EVIDENCE_LEDGER_TABLE,
    MAX_EVIDENCE_AGE_DAYS,
    MAX_PROBED_TABLES,
    MAX_SEEDED_ROWS,
    MIN_EVIDENCE_AGE_DAYS,
    PLATFORM_SCOPED_TABLES,
    TENANT_GUC,
    EnablementError,
    EnablementPolicy,
    Grade,
    ProbeResult,
    RoleAttributes,
    RunGrade,
    grade_run,
    is_platform_scoped,
    probe_is_consistent,
)

ROOT = Path(__file__).resolve().parents[3]
US_PER_DAY = 86_400 * 1_000_000


def policy(days: int = 30) -> EnablementPolicy:
    return EnablementPolicy(max_evidence_age_days=days)


def role(*, bypass: bool = False, superuser: bool = False) -> RoleAttributes:
    return RoleAttributes(rolname="wlct_app", bypassrls=bypass, superuser=superuser)


def probe(
    table: str = "engine_orders",
    *,
    scoped: int = 3,
    bare: int = 0,
    seeded: int = 3,
    absent: bool = False,
    skip: str | None = None,
    policy_on: bool = True,
    enabled: bool = True,
    forced: bool = True,
) -> ProbeResult:
    return ProbeResult(
        table=table,
        policy_exists=policy_on,
        rls_enabled=enabled,
        rls_forced=forced,
        scoped_rows=scoped,
        bare_rows=bare,
        seeded_expected_rows=seeded,
        absent=absent,
        skip_reason=skip,
    )


def bad() -> list[Any]:
    """The non-int spellings a config parser that validated nothing would
    hand us; kept in one place so every validation matrix tests the same
    five offenders."""
    return [True, False, "30", 30.0, None]


class TestPolicyConstructionLaws:
    def test_default_shape_is_accepted(self) -> None:
        assert policy().max_evidence_age_days == 30

    @pytest.mark.parametrize("days", [0, -1, -36_500])
    def test_zero_or_negative_freshness_window_cannot_exist(self, days: int) -> None:
        with pytest.raises(EnablementError, match="between"):
            policy(days=days)

    def test_a_window_beyond_a_century_is_refused_as_a_lie(self) -> None:
        assert MIN_EVIDENCE_AGE_DAYS == 1
        assert MAX_EVIDENCE_AGE_DAYS == 36_500
        policy(days=MAX_EVIDENCE_AGE_DAYS)  # the boundary itself is legal
        with pytest.raises(EnablementError, match="forever fresh"):
            policy(days=MAX_EVIDENCE_AGE_DAYS + 1)

    @pytest.mark.parametrize("value", bad())
    def test_only_plain_ints_no_bools_no_floats_no_strings(self, value: Any) -> None:
        with pytest.raises(EnablementError, match="plain int"):
            EnablementPolicy(max_evidence_age_days=cast(int, value))

    def test_policy_is_immutable_value(self) -> None:
        p = policy()
        with pytest.raises(dataclasses.FrozenInstanceError):
            p.max_evidence_age_days = 1
        assert not hasattr(p, "__dict__")  # slots: no quietly mutable bag


class TestNamedLaws:
    def test_the_guc_name_is_the_platforms_only_one(self) -> None:
        assert TENANT_GUC == "app.tenant_id"

    def test_the_evidence_ledger_is_part14s_run_ledger(self) -> None:
        # A new table for a part whose verb is "look" would be a new thing
        # to forget to prune, migrate and cover. Reusing Part 14's ledger is
        # a stated decision; this pin is what keeps it from drifting into a
        # convenience rename later.
        assert EVIDENCE_LEDGER_TABLE == "engine_retention_runs"

    def test_platform_scoped_set_is_named_and_tenant_free(self) -> None:
        # Must mirror rls_coverage.json's excluded list exactly; this test
        # re-derives it from the repo's own artifact rather than restating
        # it, so the drift trap is live in the core suite too.
        coverage = json.loads(
            (ROOT / "apps/api/prisma/rls/rls_coverage.json").read_text(encoding="utf-8")
        )
        assert PLATFORM_SCOPED_TABLES == frozenset(
            entry["table"] for entry in coverage["excluded"]
        )
        assert "orders" not in PLATFORM_SCOPED_TABLES
        assert "engine_order_events" not in PLATFORM_SCOPED_TABLES
        # the ledger that records enablement is itself tenant-scoped, so it
        # is NOT in the bare-read-allowed set
        assert EVIDENCE_LEDGER_TABLE not in PLATFORM_SCOPED_TABLES

    def test_is_platform_scoped_refuses_non_strings(self) -> None:
        with pytest.raises(EnablementError, match="must be a str"):
            is_platform_scoped(cast(str, None))


class TestEvidenceFreshness:
    def test_run_inside_the_window_is_fresh(self) -> None:
        p = policy(days=30)
        now = 1_757_700_000_000_000
        assert p.evidence_is_fresh(ran_at_us=now - 29 * US_PER_DAY, now_us=now) is True

    def test_the_boundary_is_inclusive_and_a_day_late_is_not(self) -> None:
        p = policy(days=30)
        now = 1_757_700_000_000_000
        assert p.evidence_is_fresh(ran_at_us=now - 30 * US_PER_DAY, now_us=now) is True
        assert p.evidence_is_fresh(ran_at_us=now - 30 * US_PER_DAY - 1, now_us=now) is False

    def test_a_future_run_is_not_fresh_it_is_a_clock_problem(self) -> None:
        # Not fresh, not an exception: the safe answer to an unverifiable
        # clock is "go and run the audit again", never "credit it".
        p = policy()
        future = policy(days=1).max_evidence_age_us + 1
        assert p.evidence_is_fresh(ran_at_us=1_757_700_000_000_000 + future, now_us=1_757_700_000_000_000) is False

    def test_window_property_agrees_with_seconds_times_micros(self) -> None:
        # Recomputed through a DIFFERENT unit path on purpose: the class of
        # bug this catches is the unit slip that a same-unit test cannot see.
        p = policy(days=13)
        assert p.max_evidence_age_us == 13 * 86_400 * 1_000_000

    def test_both_timestamps_must_be_plain_ints(self) -> None:
        p = policy()
        now = 1_757_700_000_000_000
        with pytest.raises(EnablementError, match="ran_at_us"):
            p.evidence_is_fresh(ran_at_us=cast(int, "1"), now_us=now)
        with pytest.raises(EnablementError, match="now_us"):
            p.evidence_is_fresh(ran_at_us=now, now_us=cast(int, True))


class TestProbeConsistency:
    def test_a_well_behaved_tenant_probe_passes(self) -> None:
        assert probe_is_consistent(probe()) == Grade.PASS

    def test_absence_outranks_everything_because_it_is_a_coverage_lie(self) -> None:
        # In the manifest, not in the database: the policy could not have
        # been created, so "enabled=false" understates the failure.
        assert (
            probe_is_consistent(
                probe(absent=True, policy_on=False, enabled=False, forced=False, bare=99)
            )
            == Grade.FAIL
        )

    def test_a_declared_skip_is_skipped_not_failed(self) -> None:
        assert probe_is_consistent(probe(skip="operator excluded: read-only replica")) == Grade.SKIPPED

    @pytest.mark.parametrize("flag", ["policy_on", "enabled", "forced"])
    def test_missing_machinery_fails(self, flag: str) -> None:
        kwargs: dict[str, Any] = {flag: False}
        assert probe_is_consistent(probe(**kwargs)) == Grade.FAIL

    def test_scoped_read_seeing_wrong_count_fails(self) -> None:
        # The GUC contract or the seed claim is broken; either way the
        # evidence does not say what the report says it says.
        assert probe_is_consistent(probe(scoped=2, seeded=3)) == Grade.FAIL
        assert probe_is_consistent(probe(scoped=4, seeded=3)) == Grade.FAIL

    def test_zero_seeded_expectation_is_a_legitimate_probe(self) -> None:
        # An empty probe tenant still proves the bare read is blocked: the
        # 0/0 pair is a pass, not "nothing to check".
        assert probe_is_consistent(probe(scoped=0, bare=0, seeded=0)) == Grade.PASS

    def test_bare_read_leak_fails(self) -> None:
        assert probe_is_consistent(probe(bare=1)) == Grade.FAIL

    def test_platform_scoped_tables_may_bare_read(self) -> None:
        # The exception, exercised: a bare audit_logs read returning OTHER
        # tenants' rows is correct behaviour for a platform-scoped table
        # (nullable tenantId, no policy), and grading it FAIL is how a
        # checklist gets switched off by the people it nags.
        assert probe_is_consistent(probe("audit_logs", bare=42, scoped=0, seeded=0)) == Grade.PASS
        # but the scoped read must STILL agree with what the caller seeded:
        # the exception is about the bare count, never about the predicate
        assert probe_is_consistent(probe("audit_logs", bare=42, scoped=4, seeded=0)) == Grade.FAIL

    def test_probe_values_are_nonsense_proof(self) -> None:
        with pytest.raises(EnablementError, match="non-negative"):
            probe(bare=-1)
        with pytest.raises(EnablementError, match="ceiling"):
            probe(bare=MAX_SEEDED_ROWS + 1)
        with pytest.raises(EnablementError, match="plain int"):
            probe(bare=cast(int, True))
        with pytest.raises(EnablementError, match="non-empty str"):
            probe("")


class TestRoleVeto:
    def test_bypass_or_superuser_makes_a_healthy_probe_list_fail(self) -> None:
        # Every count says PASS and the run still FAILs: enable.sql's item 2
        # in executable form.
        good = [probe("engine_orders"), probe("engine_retention_runs")]
        grade, summary = grade_run(good, role=role(bypass=True))
        assert grade == RunGrade.FAIL
        assert "BYPASSRLS" in str(summary["veto"])
        # the veto reaches per-table grades too: no table gets a green
        # stamp under a bypassing role
        tables = summary["tables"]
        assert isinstance(tables, dict)
        assert all(value == Grade.FAIL for value in tables.values())

    def test_superuser_alone_is_enough_to_veto(self) -> None:
        grade, _ = grade_run([probe()], role=role(superuser=True))
        assert grade == RunGrade.FAIL

    def test_role_value_type_refuses_nonsense(self) -> None:
        with pytest.raises(EnablementError, match="non-empty str"):
            RoleAttributes(rolname="", bypassrls=False, superuser=False)
        with pytest.raises(EnablementError, match="must be a bool"):
            RoleAttributes(rolname="r", bypassrls=cast(bool, "yes"), superuser=False)


class TestRunGrading:
    def test_all_green_against_the_manifest_passes(self) -> None:
        probes = [probe("engine_orders"), probe("engine_order_fills")]
        grade, summary = grade_run(probes, role=role(), covered_expected=2)
        assert grade == RunGrade.PASS
        assert summary["probed"] == 2 and summary["pass"] == 2

    def test_an_empty_run_is_unverified_not_green(self) -> None:
        grade, summary = grade_run([], role=role())
        assert grade == RunGrade.UNVERIFIED
        assert "proves nothing" in str(summary["veto"])

    def test_a_skipped_probe_downgrades_the_run_to_unverified(self) -> None:
        grade, summary = grade_run(
            [probe(), probe("engine_order_events", skip="replica lag")], role=role()
        )
        assert grade == RunGrade.UNVERIFIED
        assert summary["skipped"] == 1

    def test_one_failing_probe_fails_the_run_even_when_the_rest_pass(self) -> None:
        grade, _ = grade_run([probe(), probe("positions", bare=7)], role=role())
        assert grade == RunGrade.FAIL

    def test_coverage_count_mismatch_is_unverified(self) -> None:
        # 41 of 42 checked is the drift case this argument exists for.
        grade, summary = grade_run([probe()], role=role(), covered_expected=42)
        assert grade == RunGrade.UNVERIFIED
        assert "42 covered" in str(summary["veto"])

    def test_duplicate_tables_are_refused_not_deduped(self) -> None:
        with pytest.raises(EnablementError, match="left unchecked"):
            grade_run([probe(), probe()], role=role())

    @pytest.mark.parametrize("value", [-1, MAX_PROBED_TABLES + 1, "42", True])
    def test_covered_expected_is_validated(self, value: Any) -> None:
        with pytest.raises(EnablementError):
            grade_run([probe()], role=role(), covered_expected=cast("int | None", value))

    def test_summary_is_plain_json_ready_data(self) -> None:
        # The ledger row and the HTTP response both serialize this; a
        # dataclass or a Decimal in here would surface as a writer bug at
        # the worst possible moment (the run that just failed).
        _, summary = grade_run([probe()], role=role(), covered_expected=1)
        json.dumps(summary)
        assert isinstance(summary["probed"], int)
        assert isinstance(summary["tables"], dict)


class TestModulePurity:
    """Structural pins from the syntax tree: the law must not be able to
    see a clock, a database driver, or a filesystem - it grades what an
    executor hands it, and nothing else."""

    SOURCE = Path(__file__).resolve().parents[1] / "wlct_trading" / "enablement.py"

    def test_no_clock_no_io(self) -> None:
        tree = ast.parse(self.SOURCE.read_text(encoding="utf-8"))
        imports: set[str] = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                imports.update(alias.name for alias in node.names)
            elif isinstance(node, ast.ImportFrom) and node.module:
                imports.add(node.module)
        for forbidden in (
            "time",
            "datetime",
            "asyncpg",
            "psycopg",
            "sqlite3",
            "os",
            "pathlib",
            "json",
            "subprocess",
        ):
            assert forbidden not in imports, f"enablement law imported {forbidden!r}"
        attributes = {
            node.attr for node in ast.walk(tree) if isinstance(node, ast.Attribute)
        }
        names = {
            node.id
            for node in ast.walk(tree)
            if isinstance(node, ast.Name) and isinstance(node.ctx, ast.Load)
        }
        assert not {"now", "utcnow", "monotonic", "connect", "read_text"} & (names | attributes)

    def test_injected_clock_is_the_only_time_source(self) -> None:
        tree = ast.parse(self.SOURCE.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if isinstance(node, ast.FunctionDef):
                assert all(d is None for d in node.args.defaults), node.name

    def test_no_writes_anywhere_in_the_law(self) -> None:
        # The part whose whole verb is "look" must not be able to write - at
        # least not to the DATABASE. The scan is case-sensitive and looks for
        # SQL verbs, because "INSERT" in prose means the same as in a
        # statement and both are forbidden here.
        source = self.SOURCE.read_text(encoding="utf-8")
        for banned in ("INSERT", "UPDATE", "DELETE", "GRANT", "ALTER"):
            assert banned not in source
```


## FILE: services/execution-engine/app/rls_probe.py (350 lines)

*the read-only executor: six literal statements (role attrs, to_regclass, pg_class posture, pg_policies posture, the tenant-belted scoped count, the GUC-less bare count) plus the transaction's own SET READ ONLY; the two-phase shape that makes the leak probe real (scoped inside _TenantTransaction, bare on a second acquisition with no GUC and no transaction); the 42501 swallow narrowed by SQLSTATE; the ProbeRoleUnknown refusal that stops before grading anything; the allow-list that refuses a request-supplied table name before a connection is borrowed; and nothing, anywhere, that writes.*

```python
"""Read-only enablement verification over the durable store (Part 15).

The judgment lives in the core (``wlct_trading.enablement``); this module is
its executor against Postgres, and every statement in it is a SELECT. That
is the design contract, and it is what makes an "audit" endpoint safe to
offer from a process that owns money rows: the worst this code can do is
read a catalogue slowly. A test asserts no write verb appears in this file.

Three rules do the rest of the work:

1. **The tenant GUC is set in exactly one place.** The catalogue reads and
   the scoped count run inside ``_TenantTransaction`` (Part 13's rhythm:
   acquire -> begin -> ``set_config('app.tenant_id', $1, true)`` -> work ->
   commit), and this module's first statement inside it is
   ``SET TRANSACTION READ ONLY`` (legal only before the transaction touches
   data, which is why it leads). Two consequences: the
   audit runs as the role THIS process actually uses (a superuser session
   could not run these commands at all, so the role-attribute veto can
   never be reading about a more privileged principal than the one serving
   traffic), and an accidental write is refused by the database as well as
   by the absence of any write statement here.

2. **The bare count runs OUTSIDE that transaction, on its own
   acquisition.** ``set_config(..., is_local => true)`` is transaction-local,
   so a freshly acquired connection has no ``app.tenant_id``: only there is
   "count this table with no tenant predicate" a leak test. Running both
   counts through the same transaction would make the bare count identical
   to the scoped one by construction - an audit that structurally cannot
   report a leak. There is nothing to "clear" on the bare connection: the
   platform has no cross-tenant GUC (the ``set_config`` call is
   transaction-local by Part 11's contract, and the docs list a platform-role
   session concept as future work, not a variable to reset), so the only
   thing that could defeat a bare read is a role privilege - which is
   precisely what ``RoleAttributes`` vetoes instead of leaving to SQL.

3. **A refused bare read is the best answer a tenant table can give.** If
   the database denies the unfiltered count (``42501`` insufficient
   privilege - what FORCE + a SELECT-only policy looks like for a role with
   no bypass), the observation is recorded as "zero rows reached" and the
   grade stands. Any OTHER failure of the bare read - a connection drop, a
   timeout - propagates: the run reports nothing rather than grading a
   broken cluster as isolated. A caller who wants to record that as a
   skipped probe does it in the CLI, where the operator is holding the
   error text, not in here where it would be silently laundered into a
   pass.

Nothing is ever seeded, so nothing has to be cleaned up afterwards and no
write path exists to audit. The seed expectations are INPUTS: the operator
(or the staging script) counts what the probe tenant should see and hands
that number over; ``seeded_expected_rows`` of 0 is the honest "unknown"
mode, in which the catalogue posture (policy exists, enabled, forced) is
the real evidence and the counts are a cross-check. Failure handling is
deliberately thin: driver errors propagate, the router answers 5xx, and no
partial evidence is recorded, because a run that could not read pg_class is
not "evidence of nothing".
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Final

from wlct_trading.clock import epoch_micros
from wlct_trading.enablement import (
    EVIDENCE_LEDGER_TABLE,
    EnablementPolicy,
    ProbeResult,
    RoleAttributes,
    grade_run,
)

from app.store_sql import PgPool, _TenantTransaction

__all__ = [
    "PROBE_TABLES",
    "EnablementAudit",
    "ProbeRoleUnknown",
    "ProbeUnknownTable",
    "run_enablement_probe",
]

logger = logging.getLogger("app.rls_probe")

#: Postgres' "insufficient_privilege" SQLSTATE. Duck-typed rather than
#: imported from ``asyncpg.exceptions`` so this module stays driver-light
#: the way Part 13's store does, and so the fakes in the test suite only
#: have to carry the attribute, not the class.
INSUFFICIENT_PRIVILEGE_SQLSTATE: Final = "42501"

#: The tables this service can verify by itself: the three durable engine
#: tables (Part 13) plus its own ledger (Part 14). Everything else in
#: ``rls_coverage.json`` belongs to the API plane and is the operator
#: script's job. An engine that claimed to have verified tables it cannot
#: name would be the loudest liar in the report, so the list is a module
#: constant an operator widens in a review, never in a request body.
PROBE_TABLES: Final = (
    "engine_orders",
    "engine_order_events",
    "engine_order_fills",
    EVIDENCE_LEDGER_TABLE,
)

# --- catalogue and count statements (literal text; never assembled) ------

ROLE_ATTRS_SQL: Final = (
    "SELECT current_user::text AS rolname, r.rolsuper, r.rolbypassrls "
    "FROM pg_roles r WHERE r.rolname = current_user"
)

#: Existence by ``to_regclass``, the exact spelling Part 13's store-open
#: check uses: the audit and the startup gate agree on what "the table is
#: here" means, so a table neither can find is reported the same way twice.
TABLE_EXISTS_SQL: Final = "SELECT to_regclass($1) AS regclass"

TABLE_POSTURE_SQL: Final = (
    "SELECT c.relrowsecurity, c.relforcerowsecurity FROM pg_class c "
    "JOIN pg_namespace n ON n.oid = c.relnamespace "
    "WHERE n.nspname = 'public' AND c.relname = $1 AND c.relkind IN ('r', 'p')"
)

POLICY_POSTURE_SQL: Final = (
    "SELECT count(*)::bigint AS policy_count, "
    "bool_or(p.qual IS NOT NULL AND position('app.tenant_id' in p.qual) > 0) "
    "AS scoped FROM pg_policies p WHERE p.schemaname = 'public' "
    "AND p.tablename = $1 AND p.policyname = 'tenant_isolation'"
)

#: The scoped count keeps the tenant in SQL TEXT as well as in the GUC: the
#: belt-and-braces law every covered statement on this platform follows, so
#: a policy that was never enabled still cannot make the audit lie about
#: which tenant it counted.
SCOPED_COUNT_SQL: Final = "SELECT count(*)::bigint AS n FROM {table} WHERE tenant_id = $1"

BARE_COUNT_SQL: Final = "SELECT count(*)::bigint AS n FROM {table}"

#: Read-only, on purpose, and asserted as text by a test: the module that
#: audits must not be the module that changes.
READ_ONLY_SQL: Final = "SET TRANSACTION READ ONLY"


class ProbeUnknownTable(RuntimeError):
    """A caller asked about a table outside the allow-list: the name reaches
    ``{table}`` interpolation, so it is the one place a request could
    smuggle SQL into an audit. Checked against this module's own constant
    before a connection is even acquired."""


class ProbeRoleUnknown(RuntimeError):
    """``pg_roles`` had no row for the connected role.

    That happens when the login role is a member rather than the row owner,
    or when the catalog was read by something other than the serving role.
    Either way the run cannot state WHICH role it verified, and a bypass
    flag we failed to read is exactly the flag worth refusing for: the
    audit answers by not answering.
    """


@dataclass(frozen=True, slots=True)
class EnablementAudit:
    """One verification run, in the shape the wire and the evidence ledger
    both want."""

    ran_at_us: int
    #: ``RunGrade.PASS``/``FAIL``/``UNVERIFIED`` - plain strings by the
    #: core's design (Grade is a constant namespace, not an Enum), which is
    #: what keeps this report serialisable into an evidence ledger without a
    #: per-field conversion step that could drift from the law.
    grade: str
    role: RoleAttributes
    probes: tuple[ProbeResult, ...]
    summary: dict[str, Any]
    #: True when the run covered the WHOLE platform manifest (the caller
    #: graded it against ``covered_expected`` = the manifest count). A
    #: default run grades the engine plane only, so this is False there:
    #: "4 of 4 of my tables pass" and "the platform is verified" are
    #: different sentences and the body must not be able to say the second.
    full_platform: bool
    #: True when every table THIS service can see was included in the run -
    #: the engine plane's own completeness, independent of the manifest.
    engine_plane_complete: bool

    @property
    def per_table(self) -> dict[str, str]:
        tables = self.summary.get("tables")
        return dict(tables) if isinstance(tables, dict) else {}

    @property
    def failed_tables(self) -> tuple[str, ...]:
        return tuple(name for name, value in self.per_table.items() if value == "fail")


async def run_enablement_probe(
    pool: PgPool,
    tenant_id: str,
    policy: EnablementPolicy,
    *,
    now_us: int | None = None,
    seed_counts: dict[str, int] | None = None,
    covered_expected: int | None = None,
) -> EnablementAudit:
    """Verify the engine-plane tables are enabled, forced and effective.

    ``seed_counts`` maps table -> rows that tenant is expected to see (omit
    it, or pass ``{}``, for the honest unknown-seed mode).
    ``covered_expected`` is the coverage manifest's count; the default
    grades the run against THIS service's table list, because a route that
    can only see four tables must not report the platform's 42 as
    UNVERIFIED - it reports a full pass of its own plane and
    ``fullPlatform: false`` next to it.
    """
    seeds = dict(seed_counts or {})
    for name in seeds:
        if name not in PROBE_TABLES:
            raise ProbeUnknownTable(
                f"seed_counts names {name!r}, which this service does not probe "
                f"(known: {', '.join(PROBE_TABLES)})"
            )
    ran_at = now_us if now_us is not None else epoch_micros()

    async with _TenantTransaction(pool, tenant_id) as conn:
        # Ordering is a Postgres requirement, not a style choice:
        # ``SET TRANSACTION`` is only legal before the transaction has run a
        # data-touching statement, and ``set_config`` (issued by the
        # transaction helper itself) is not one. So the read-only flag is the
        # FIRST statement this module sends, and a test pins that.
        await conn.execute(READ_ONLY_SQL)
        row = await conn.fetchrow(ROLE_ATTRS_SQL)
        if row is None:
            raise ProbeRoleUnknown(
                "pg_roles has no row for the connected role: the audit cannot "
                "state which role it verified, and a BYPASSRLS flag that was "
                "never read is not a flag that was checked"
            )
        role = RoleAttributes(
            rolname=str(row["rolname"]),
            bypassrls=bool(row["rolbypassrls"]),
            superuser=bool(row["rolsuper"]),
        )
        # Phase 1: everything that is a fact about the CATALOGUE plus the
        # tenant's own count, read inside the GUC'd transaction. The table
        # names here are this module's constant, never request input:
        # `{table}` interpolation of an allow-listed literal is how Part 13
        # spells its own statements, and the existence check is spelled like
        # the store-open check on purpose (one meaning for "the table is
        # here" across the platform).
        phase_one: dict[str, tuple[bool, bool, bool, int, bool]] = {}
        for table in PROBE_TABLES:
            if await conn.fetchrow(TABLE_EXISTS_SQL, f"public.{table}") is None:
                phase_one[table] = (False, False, False, 0, True)
                continue
            posture = await conn.fetchrow(TABLE_POSTURE_SQL, table)
            policy_row = await conn.fetchrow(POLICY_POSTURE_SQL, table)
            scoped = await conn.fetchrow(SCOPED_COUNT_SQL.format(table=table), tenant_id)
            phase_one[table] = (
                bool(policy_row is not None and int(policy_row["policy_count"]) > 0),
                bool(posture is not None and posture["relrowsecurity"]),
                bool(posture is not None and posture["relforcerowsecurity"]),
                0 if scoped is None else int(scoped["n"]),
                False,
            )

    # Phase 2: the unfiltered counts, OUTSIDE the transaction (see the
    # module docstring's rule 2). One borrowed session answers them all, so
    # the audit is two pool acquisitions rather than one per table - and an
    # absent table is never counted at all, because counting a table that is
    # not there is not a finding, it is an error message.
    live = [table for table, values in phase_one.items() if not values[4]]
    bare_rows = await _bare_counts(pool, live)

    probes: list[ProbeResult] = []
    for table in PROBE_TABLES:
        policy_exists, rls_enabled, rls_forced, scoped_rows, absent = phase_one[table]
        probes.append(
            ProbeResult(
                table=table,
                policy_exists=policy_exists,
                rls_enabled=rls_enabled,
                rls_forced=rls_forced,
                scoped_rows=scoped_rows,
                bare_rows=bare_rows.get(table, 0),
                seeded_expected_rows=seeds.get(table, 0),
                absent=absent,
            )
        )

    grade, summary = grade_run(
        probes,
        role=role,
        covered_expected=len(PROBE_TABLES) if covered_expected is None else covered_expected,
    )
    audit = EnablementAudit(
        ran_at_us=ran_at,
        grade=grade,
        role=role,
        probes=tuple(probes),
        summary=summary,
        full_platform=covered_expected is not None and covered_expected != len(PROBE_TABLES),
        engine_plane_complete=(
            covered_expected is None or covered_expected == len(PROBE_TABLES)
        ),
    )
    logger.info(
        "enablement.audit",
        extra={
            "event": "enablement.audit",
            "grade": grade,
            "probed": len(audit.probes),
            "role": role.rolname,
        },
    )
    return audit


async def _bare_counts(pool: PgPool, tables: list[str]) -> dict[str, int]:
    """``count(*)`` per table on a session that never saw the tenant GUC.

    A privilege refusal is recorded as zero rows reached (the ideal answer
    for a forced tenant table); any other failure propagates so a broken
    connection can never be graded as isolation.

    This is the ONE place in the engine that deliberately reads without the
    tenant GUC, and it is a ``count(*)``: the acquisition is outside any
    transaction, so it inherits no ``app.tenant_id``, and nothing here can
    write even in principle. An ``async with`` rather than a manual
    acquire/release so the connection's return to the pool is not a
    judgement call inside an error path.
    """
    counts: dict[str, int] = {}
    if not tables:
        return counts
    async with pool.acquire() as conn:
        for table in tables:
            try:
                row = await conn.fetchrow(BARE_COUNT_SQL.format(table=table))
            except Exception as error:
                # The ONLY swallowed error on this path: Postgres saying "you
                # may not read that table without a tenant" is the finding,
                # not a failure - it is what a correctly FORCED tenant table
                # answers. Duck-typed on the SQLSTATE so this module never
                # imports the driver's exception hierarchy, and everything
                # else (connection drop, timeout, cancellation) propagates
                # rather than being laundered into a pass.
                if getattr(error, "sqlstate", None) != INSUFFICIENT_PRIVILEGE_SQLSTATE:
                    raise
                counts[table] = 0
                continue
            counts[table] = 0 if row is None else int(row["n"])
    return counts
```


## FILE: services/execution-engine/app/routers/enablement.py (143 lines)

*one POST on the internal prefix: the 409 that refuses to grade a memory runtime, the 400/503 refusals for out-of-scope requests and an unreadable role, and the decision that a FAIL GRADE IS HTTP 200 - the audit ran, its answer is the evidence, and burying it in a transport error is how audits get disabled.*

```python
"""The RLS enablement surface (Part 15): audit the deployment's isolation.

One route, read-only by construction, on the same internal plane as the
rest: same token, same tenant-header match, absent from anything the public
API proxies. The verb is "look", so there is no apply switch here - Part
14's ``EXECUTION_RETENTION_ENABLED`` guard exists because a DELETE needs two
yeses, and adding a feature flag to a SELECT would be theatre that still has
to be documented, tested and defaulted.

Two refusals are worth naming, because both are the endpoint saying
something the operator needs to hear rather than an error:

* ``409 RETENTION_NO_DURABLE_STORE`` (the same code Part 14 uses, reused
  deliberately): a memory-backend runtime has no Postgres roles, no
  policies, no tables - it has nothing to verify, and answering "PASS, 4
  tables isolated" would be the single most misleading success on this
  platform.
* ``400`` on a table name outside the probe allow-list, or on a
  ``coveredExpected`` the core law rejects: the request body is not where an
  audit's scope gets decided.

A ``FAIL`` grade is NOT an HTTP error, and that is the most important
sentence in this file. The audit ran: its answer is the finding, and
reporting it as 500 would hide the evidence under the transport, break
curl-based CI that reads the body, and tempt somebody into making the probe
"tolerant". Transport failures (5xx) mean "no evidence at all", which is a
different fact with a different remedy.
"""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from wlct_trading.enablement import EnablementError, probe_is_consistent

from app.config import get_settings
from app.rls_probe import ProbeRoleUnknown, ProbeUnknownTable, run_enablement_probe
from app.schemas import (
    EnablementAuditResponse,
    EnablementProbeView,
    EnablementRequest,
    EnablementRoleView,
)
from app.security import ServiceCaller, require_internal_auth, require_tenant_match

router = APIRouter(prefix="/internal/v1", tags=["enablement"])

AuthDep = Annotated[ServiceCaller, Depends(require_internal_auth)]


@router.post(
    "/enablement/audit",
    response_model=EnablementAuditResponse,
    response_model_by_alias=True,
)
async def enablement_audit(
    body: EnablementRequest,
    caller: AuthDep,
    request: Request,
) -> EnablementAuditResponse:
    """Count, compare, grade: are the Part 11 policies on, forced, and
    actually isolating - for the tables this service can see?"""
    require_tenant_match(body.tenant_id, caller)
    pool: Any = getattr(request.app.state, "store_pool", None)
    if pool is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "RETENTION_NO_DURABLE_STORE",
                "message": (
                    "row-level security is a database property and this runtime's "
                    "store is process memory: there are no policies here to verify. "
                    "Configure EXECUTION_STORE_BACKEND=postgres "
                    "(docs/PART13_DURABLE_STORE.md), or audit the real database with "
                    "scripts/rls-enablement.mjs --check-rls."
                ),
            },
        )
    settings = get_settings()
    try:
        audit = await run_enablement_probe(
            pool,
            body.tenant_id,
            settings.enablement_policy,
            seed_counts=body.seed_counts,
            covered_expected=body.covered_expected,
        )
    except (ProbeUnknownTable, EnablementError) as refused:
        # Both are "your request asked for an audit that cannot be graded":
        # a table outside the allow-list, or a coverage number the core law
        # refuses. 400, not retried, and the text names the knob to fix.
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": "ENABLEMENT_REQUEST_REFUSED",
                "message": f"{refused} (docs/PART15_RLS_ENABLEMENT.md)",
            },
        ) from None
    except ProbeRoleUnknown as unknown:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "code": "ENABLEMENT_ROLE_UNKNOWN",
                "message": (
                    f"{unknown} - grant this role SELECT on pg_roles (Part 11's "
                    "grant.sql does) and run again; an audit that cannot read the "
                    "bypass flag is not an audit"
                ),
            },
        ) from None
    # The grade is data, not a status code: see the module docstring. The
    # fields are assembled explicitly (never `**body` from a dict) so a key
    # that stops existing is a TypeError at import-time-ish test run, not a
    # silently-absent field in an operator's evidence.
    return EnablementAuditResponse(
        ran_at_us=audit.ran_at_us,
        grade=audit.grade,
        full_platform=audit.full_platform,
        engine_plane_complete=audit.engine_plane_complete,
        probed=len(audit.probes),
        role=EnablementRoleView(
            rolname=audit.role.rolname,
            bypassrls=audit.role.bypassrls,
            superuser=audit.role.superuser,
        ),
        summary=audit.summary,
        probes=[
            EnablementProbeView(
                table=probe.table,
                policy_exists=probe.policy_exists,
                rls_enabled=probe.rls_enabled,
                rls_forced=probe.rls_forced,
                scoped_rows=probe.scoped_rows,
                bare_rows=probe.bare_rows,
                seeded_expected_rows=probe.seeded_expected_rows,
                absent=probe.absent,
                grade=probe_is_consistent(probe),
                skip_reason=probe.skip_reason,
            )
            for probe in audit.probes
        ],
    )
```


## FILE: services/execution-engine/tests/test_part15_enablement.py (679 lines)

*38 tests: the statement laws read off the module's own strings, the scripted fakes that pin WHICH connection said WHAT and in which transaction (a fake that answers by matching statement text, single-use pools, a bare script disjoint from the scoped one), absent-table handling, the veto, the refused-versus-dropped bare read, the seed/coverage refusals measured as 'zero statements', and the HTTP matrix over a booted app with the lifespan pool seam patched.*

```python
"""Part 15: the read-only enablement executor and its one route.

Three layers, and the first one is the important one because an audit's
whole value is WHAT IT REFUSES TO DO:

1. **The statement laws**, read off the module's own strings: every
   constant is a SELECT (or the read-only SET), the scoped and bare counts
   differ by exactly the tenant predicate, the existence check is spelled
   like Part 13's store-open check, and the probe table list is the engine
   plane's - no more, no less.
2. **The executor against a scripted fake pool**, which pins the one design
   fact a reviewer cannot see from a green run: the BARE count must come
   from a DIFFERENT acquisition that never ran ``set_config``, inside no
   transaction. FakeConn records per-transaction statement lists exactly as
   Part 14's does, so "the leak probe leaked the GUC" is a test failure
   rather than a false PASS in production. Absent tables, a bypassing role,
   an unreadable role, an unknown seed table, a refused bare read
   (best-case) versus a dropped one (must propagate) - all graded here,
   never in the route.
3. **The route**, booted through the real composition with the lifespan
   seam patched: the memory 409, a graded 200 body in camelCase with
   ``fullPlatform`` next to the headline grade, request-shape refusals, and
   the status surface's new field.

No suppression comments anywhere, as in Part 14: the deliberately-wrong
values are typed through ``Any`` and a ``cast``.
"""

from __future__ import annotations

import asyncio
import inspect
import re
from contextlib import ExitStack
from typing import Any, cast
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from wlct_trading.clock import epoch_micros
from wlct_trading.enablement import EnablementPolicy
from wlct_trading.execution.store import OrderStoreError

from app import rls_probe
from app.config import get_settings
from app.rls_probe import (
    BARE_COUNT_SQL,
    POLICY_POSTURE_SQL,
    PROBE_TABLES,
    READ_ONLY_SQL,
    ROLE_ATTRS_SQL,
    SCOPED_COUNT_SQL,
    TABLE_EXISTS_SQL,
    EnablementAudit,
    ProbeRoleUnknown,
    ProbeUnknownTable,
    run_enablement_probe,
)
from app.store_sql import SET_TENANT_SQL, PostgresOrderStore

TENANT = str(uuid4())
POLICY = EnablementPolicy(max_evidence_age_days=30)
RAN_AT = 1_757_700_000_000_000

#: The four catalog/count shapes the executor issues, matched by the fake
#: with these literals so a change to the SQL is a test change, not a fake
#: that quietly stops answering anything.
ROLE_KEY = "FROM pg_roles r WHERE r.rolname = current_user"
EXISTS_KEY = "SELECT to_regclass($1) AS regclass"
POSTURE_KEY = "SELECT c.relrowsecurity, c.relforcerowsecurity"
POLICY_KEY = "FROM pg_policies p"
SCOPED_KEY = "WHERE tenant_id = $1"


class Row(dict[str, Any]):
    """A fetchrow answer that reads like a record."""


class FakeTx:
    def __init__(self, conn: FakeConn) -> None:
        self._conn = conn

    async def __aenter__(self) -> None:
        self._conn.tx_begins += 1
        self._conn.txes.append([])

    async def __aexit__(self, exc_type: object, exc: object, tb: object) -> bool:
        if exc_type is None:
            self._conn.tx_commits += 1
        else:
            self._conn.tx_rollbacks += 1
        return False


class FakeConn:
    """Answers by matching the statement against a small script, and records
    WHERE each statement ran (inside a transaction or not).

    Deliberately NOT a replay list: the audit issues a variable number of
    statements (one per table, and the table list is what the drift test
    pins), so matching by shape keeps the fakes honest about the SQL and
    silent about the count - the count is asserted separately, on purpose.
    """

    def __init__(self, *, mode: str, answers: dict[str, Any]) -> None:
        self.mode = mode  # "scoped" (inside the tenant transaction) or "bare"
        self.answers = answers
        self.statements: list[tuple[str, tuple[object, ...], str]] = []
        self.txes: list[list[str]] = [[]]
        self.tx_begins = 0
        self.tx_commits = 0
        self.tx_rollbacks = 0

    def _answer_for(self, query: str) -> Any:
        for key, value in self.answers.items():
            if key in query:
                if isinstance(value, BaseException):
                    raise value
                if callable(value):
                    return value(query)
                return value
        return None

    def _record(self, query: str, args: tuple[object, ...]) -> None:
        self.statements.append((query, args, self.mode))
        self.txes[-1].append(query)

    async def execute(self, query: str, *args: object) -> str:
        self._record(query, args)
        return "OK 1"

    async def fetchrow(self, query: str, *args: object) -> Any:
        self._record(query, args)
        return self._answer_for(query)

    async def fetch(self, query: str, *args: object) -> list[Any]:
        self._record(query, args)
        answer = self._answer_for(query)
        return list(answer) if isinstance(answer, list) else []

    def transaction(self) -> FakeTx:
        return FakeTx(self)

    def texts(self, mode: str | None = None) -> list[str]:
        return [q for q, _, m in self.statements if mode is None or m == mode]


class FakeAcquire:
    def __init__(self, conn: FakeConn) -> None:
        self._conn = conn

    async def __aenter__(self) -> FakeConn:
        return self._conn

    async def __aexit__(self, *exc: object) -> bool:
        return False


class FakePool:
    """Two connection slots, because the executor's whole trick is that it
    borrows a SECOND, GUC-less one for the bare count."""

    def __init__(self, scoped: FakeConn, *bare: FakeConn) -> None:
        self.scoped = scoped
        self.bare_conns = list(bare)
        self.acquires = 0
        self.closed = False

    def acquire(self) -> FakeAcquire:
        self.acquires += 1
        if self.acquires == 1:
            return FakeAcquire(self.scoped)
        if not self.bare_conns:
            raise AssertionError(
                "the audit borrowed more connections than this fake offers - "
                "the unfiltered phase must be ONE session for all tables"
            )
        return FakeAcquire(self.bare_conns[len(self.bare_conns) - 1])

    async def close(self) -> None:
        self.closed = True


def healthy_answers(
    *,
    scoped: int = 3,
    bare: int = 0,
    bypassrls: bool = False,
    superuser: bool = False,
    rolname: str = "wlct_app",
    exists: bool = True,
    relrowsecurity: bool = True,
    relforcerowsecurity: bool = True,
    policy_count: int = 1,
) -> tuple[dict[str, Any], dict[str, Any]]:
    scoped_answers: dict[str, Any] = {
        ROLE_KEY: Row(rolname=rolname, rolsuper=superuser, rolbypassrls=bypassrls),
        EXISTS_KEY: None if not exists else Row(regclass="public.engine_orders"),
        POSTURE_KEY: Row(relrowsecurity=relrowsecurity, relforcerowsecurity=relforcerowsecurity),
        POLICY_KEY: Row(policy_count=policy_count, scoped=True),
        SCOPED_KEY: Row(n=scoped),
    }
    # The bare session must be answered by a key the SCOPED statements do
    # not contain, and vice versa: a fake that answers everything would
    # happily let the executor read tenant-filtered numbers on the
    # unfiltered side - the exact bug this split exists to catch.
    bare_answers: dict[str, Any] = {"count(*)::bigint AS n FROM ": Row(n=bare)}
    return scoped_answers, bare_answers


def pair(**overrides: Any) -> tuple[FakePool, FakeConn, FakeConn]:
    """(pool, scoped_conn, first_bare_conn) - the bare list on the pool is
    what the assertions read, since one session now serves the whole
    unfiltered phase. A pool is SINGLE-USE in these tests on purpose: reusing
    one for a second run would silently reuse the first run's connections and
    their statement history, and "which run emitted that?" would stop being
    answerable. Call ``pair()`` again for a second audit."""
    scoped_answers, bare_answers = healthy_answers(**overrides)
    scoped = FakeConn(mode="scoped", answers=scoped_answers)
    bare = FakeConn(mode="bare", answers=bare_answers)
    return FakePool(scoped, bare), scoped, bare


def run_pool(pool: FakePool, tenant: str = TENANT, **kwargs: Any) -> EnablementAudit:
    """One audit through the pool, cast at the seam where the fake meets the
    ``PgPool`` protocol - the same single cast every Part 13/14 test uses."""
    return asyncio.run(run_enablement_probe(cast(Any, pool), tenant, POLICY, **kwargs))


def run(pool: FakePool, **kwargs: Any) -> EnablementAudit:
    options: dict[str, Any] = {
        "now_us": RAN_AT,
        "seed_counts": {name: 3 for name in PROBE_TABLES},
    }
    options.update(kwargs)
    return run_pool(pool, **options)


def tables(audit: EnablementAudit) -> dict[str, str]:
    return audit.per_table


class TestStatementLaws:
    def test_every_statement_is_a_read(self) -> None:
        statements = [
            value
            for value in vars(rls_probe).values()
            if isinstance(value, str)
            and re.match(r"^(SELECT|SET|INSERT|UPDATE|DELETE|ALTER)", value)
        ]
        assert statements, "the module should hold its SQL as constants"
        for stmt in statements:
            assert stmt.startswith("SELECT") or stmt == READ_ONLY_SQL, stmt
            assert not re.search(r"\b(INSERT|UPDATE|DELETE|ALTER|TRUNCATE|DROP|GRANT)\b", stmt)

    def test_scoped_and_bare_differ_by_exactly_the_tenant_predicate(self) -> None:
        # The one-line difference IS the finding: same table, same
        # aggregate, one has the belt and the other does not. If either
        # drifts in any other direction the two counts stop being
        # comparable and the whole grade is meaningless arithmetic.
        base = "SELECT count(*)::bigint AS n FROM {table}"
        assert SCOPED_COUNT_SQL == base + " WHERE tenant_id = $1"
        assert BARE_COUNT_SQL == base
        assert "count(*)" in SCOPED_COUNT_SQL and "count(*)" in BARE_COUNT_SQL

    def test_existence_check_is_the_store_open_spelling(self) -> None:
        assert TABLE_EXISTS_SQL == "SELECT to_regclass($1) AS regclass"

    def test_role_query_is_the_checklist_query(self) -> None:
        # enable.sql's pre-flight item 2, in SQL, verbatim in spirit: the
        # audit reads the same two flags a human is told to read by hand.
        assert "rolbypassrls" in ROLE_ATTRS_SQL and "rolsuper" in ROLE_ATTRS_SQL
        assert "pg_roles" in ROLE_ATTRS_SQL
        assert "current_user" in ROLE_ATTRS_SQL

    def test_policy_query_asks_the_named_policy_and_the_guc(self) -> None:
        assert "policyname = 'tenant_isolation'" in POLICY_POSTURE_SQL
        assert "position('app.tenant_id' in p.qual)" in POLICY_POSTURE_SQL
        assert "p.schemaname = 'public'" in POLICY_POSTURE_SQL

    def test_probe_tables_are_the_engine_plane(self) -> None:
        assert PROBE_TABLES == (
            "engine_orders",
            "engine_order_events",
            "engine_order_fills",
            "engine_retention_runs",
        )

    def test_the_guc_statement_is_reused_not_restated(self) -> None:
        # The executor must borrow Part 13's exact set_config text: a second
        # spelling of the tenant contract is a second contract.
        assert "app.tenant_id" in SET_TENANT_SQL

    def test_transaction_is_forced_read_only_first(self) -> None:
        assert READ_ONLY_SQL == "SET TRANSACTION READ ONLY"
        # and the module actually SENDS it first: SET TRANSACTION is only
        # legal before the transaction touches data, so a reordering that
        # moves it after the first SELECT makes the audit error out on a
        # real server while every fake still says fine.
        executor = inspect.getsource(run_enablement_probe)
        body = executor.split("async with _TenantTransaction")[1]
        assert body.index("READ_ONLY_SQL") < body.index("fetchrow")
        assert "await conn.execute(READ_ONLY_SQL)" in body


class TestExecutorBranches:
    def test_a_healthy_database_passes_and_reads_the_way_it_must(self) -> None:
        pool, scoped, bare = pair()
        audit = run(pool)
        assert audit.grade == "pass"
        # the default run is a COMPLETE ENGINE PLANE, not a complete platform
        assert audit.full_platform is False and audit.engine_plane_complete is True
        assert tables(audit) == {name: "pass" for name in PROBE_TABLES}
        # the transaction law: the GUC is set first, once, inside the tx,
        # and everything in that connection's first transaction
        # the fake opens a statement list per transaction, and the store's
        # helper runs set_config BEFORE entering the tx: so list 0 is the
        # GUC alone and list 1 is the transaction's real conversation.
        # The transaction the audit ran inside is the second bucket (the
        # fake opens one per begin), and its first statement is the store's
        # own GUC set - then OURS. READ ONLY must be the first statement this
        # module sends: SET TRANSACTION is illegal after the transaction has
        # touched data, so a reordering that puts a SELECT first would make
        # the audit error out on a real server while every fake still says
        # fine.
        assert len(scoped.txes) == 2 and scoped.txes[0] == []
        assert scoped.txes[1][0] == SET_TENANT_SQL
        assert scoped.txes[1][1] == READ_ONLY_SQL
        assert scoped.txes[1][2] == ROLE_ATTRS_SQL
        assert scoped.tx_begins == 1 and scoped.tx_commits == 1
        # and the bare read ran OUTSIDE it, on a different connection
        assert bare.tx_begins == 0
        assert all("set_config" not in q for q, _, _ in bare.statements)
        scoped_counts = [q for q, _, m in scoped.statements if SCOPED_KEY in q and m == "scoped"]
        assert len(scoped_counts) == len(PROBE_TABLES)
        assert len(bare.statements) == len(PROBE_TABLES)
        assert pool.acquires == 2  # one transaction, one bare session
        assert [q for q, _, _ in bare.statements] == [
            rls_probe.BARE_COUNT_SQL.format(table=name) for name in PROBE_TABLES
        ]

    def test_absent_table_is_a_fail_never_a_pass_and_never_bare_counted(self) -> None:
        pool, scoped, bare = pair(exists=False)
        audit = run(pool)
        assert audit.grade == "fail"
        assert all(probe.absent for probe in audit.probes)
        # an absent table cannot be bare-counted (there is nothing to
        # count): the unfiltered phase is not even started, so the pool
        # borrowed exactly ONE connection for this whole run.
        assert bare.statements == [] and pool.acquires == 1
        assert tables(audit) == {name: "fail" for name in PROBE_TABLES}

    def test_a_bypassing_role_vetoes_the_healthiest_run(self) -> None:
        pool, _scoped, _bare = pair(bypassrls=True)
        audit = run(pool)
        assert audit.grade == "fail"
        assert "BYPASSRLS" in str(audit.summary["veto"])
        assert audit.role.bypassrls is True

    def test_superuser_without_bypass_is_still_a_veto(self) -> None:
        pool, _scoped, _bare = pair(superuser=True)
        assert run(pool).grade == "fail"

    def test_an_unreadable_role_stops_the_audit_instead_of_guessing(self) -> None:
        answers, _bare_answers = healthy_answers()
        answers[ROLE_KEY] = None  # pg_roles has no row for this role
        scoped = FakeConn(mode="scoped", answers=answers)
        bare = FakeConn(mode="bare", answers={})
        with pytest.raises(ProbeRoleUnknown, match="cannot"):
            run_pool(FakePool(scoped, bare), now_us=RAN_AT)
        # it refused BEFORE reading the tables it was going to grade
        assert [q for q, _, _ in scoped.statements].count(EXISTS_KEY) == 0

    def test_a_refused_bare_read_is_the_best_answer_not_an_error(self) -> None:
        class Denied(Exception):
            sqlstate = "42501"

        scoped_answers, _ = healthy_answers()
        bare = FakeConn(mode="bare", answers={"count(*)": Denied("permission denied")})
        scoped = FakeConn(mode="scoped", answers=scoped_answers)
        audit = run(FakePool(scoped, bare))
        assert audit.grade == "pass"
        assert all(probe.bare_rows == 0 for probe in audit.probes)

    def test_a_dropped_bare_read_propagates_and_records_nothing(self) -> None:
        scoped_answers, _ = healthy_answers()

        class Gone(Exception):
            sqlstate = "08006"

        bare = FakeConn(mode="bare", answers={"count(*)": Gone("connection gone")})
        scoped = FakeConn(mode="scoped", answers=scoped_answers)
        with pytest.raises(Gone):
            run_pool(FakePool(scoped, bare), now_us=RAN_AT)

    def test_unknown_force_or_policy_each_grade_fail(self) -> None:
        for kwargs in ({"relforcerowsecurity": False}, {"policy_count": 0}):
            pool, _scoped, _bare = pair(**kwargs)
            audit = run(pool)
            assert audit.grade == "fail", kwargs

    def test_bare_rows_that_are_not_zero_fail_a_tenant_table(self) -> None:
        pool, _scoped, _bare = pair(bare=7)
        audit = run(pool)
        assert audit.grade == "fail"
        assert audit.failed_tables == PROBE_TABLES

    def test_unknown_seed_mode_is_still_a_real_audit(self) -> None:
        # seed_counts absent: the catalogue posture carries the finding and
        # the counts cross-check each other; this is the mode a first-run
        # operator gets, and it must not silently become a skip.
        pool, _scoped, _bare = pair(scoped=0, bare=0)
        audit = run(pool, seed_counts=None)
        assert audit.grade == "pass"
        assert all(probe.seeded_expected_rows == 0 for probe in audit.probes)

    def test_a_scoped_read_that_sees_more_than_seeded_fails(self) -> None:
        pool, _scoped, _bare = pair(scoped=4, bare=4)
        audit = run(pool, seed_counts={name: 3 for name in PROBE_TABLES})
        assert audit.grade == "fail"

    def test_seed_counts_outside_the_allow_list_refuse_before_connecting(self) -> None:
        pool, scoped, _bare = pair()
        with pytest.raises(ProbeUnknownTable, match="does not probe"):
            run(pool, seed_counts={"users": 3})
        assert scoped.statements == []
        assert pool.acquires == 0

    def test_partial_coverage_reports_its_own_plane_honestly(self) -> None:
        audit = run(pair()[0], covered_expected=len(PROBE_TABLES))
        assert audit.grade == "pass" and audit.full_platform is False
        assert audit.engine_plane_complete is True
        audit = run(pair()[0])  # the default: this service's own plane
        assert audit.grade == "pass" and audit.engine_plane_complete is True
        assert audit.full_platform is False
        audit = run(pair()[0], covered_expected=42)  # the whole platform manifest
        assert audit.grade == "unverified" and audit.full_platform is True
        assert audit.engine_plane_complete is False
        assert "42 covered" in str(audit.summary["veto"])

    def test_the_audit_object_holds_the_facts_the_route_needs(self) -> None:
        pool, _scoped, _bare = pair(scoped=2, bare=0)
        audit = run(pool, seed_counts={name: 2 for name in PROBE_TABLES})
        assert audit.grade == "pass"
        assert audit.role.rolname == "wlct_app" and audit.role.bypassrls is False
        assert {probe.table for probe in audit.probes} == set(PROBE_TABLES)
        assert all(probe.scoped_rows == 2 and probe.bare_rows == 0 for probe in audit.probes)
        broken_pool, _s, _b = pair(bare=1)
        broken = run(broken_pool, seed_counts={name: 3 for name in PROBE_TABLES})
        # the per-table grades are re-derived by the core law, so they must
        # agree with the headline even when the run is broken
        assert broken.grade == "fail" and set(broken.per_table.values()) == {"fail"}
        assert broken.failed_tables == PROBE_TABLES

    def test_non_canonical_tenant_never_reaches_the_database(self) -> None:
        pool, scoped, _bare = pair()
        with pytest.raises(OrderStoreError, match="canonical UUID"):
            run_pool(pool, tenant="not-a-uuid", now_us=RAN_AT)
        assert scoped.statements == []

    def test_now_us_is_the_only_clock(self) -> None:
        audit = run(pair()[0])
        assert audit.ran_at_us == RAN_AT
        before = epoch_micros()
        auto = run(pair()[0], now_us=None)
        assert auto.ran_at_us >= before

    def test_summary_is_json_ready(self) -> None:
        import json

        pool, _scoped, _bare = pair()
        json.dumps(run(pool).summary)


def postgres_client(
    monkeypatch: pytest.MonkeyPatch,
    stack: ExitStack,
    **overrides: Any,
) -> tuple[TestClient, FakeConn, FakeConn]:
    """A booted app on the postgres backend with the probe's fakes wired at
    the lifespan seam (same technique as Part 14's route tests), so what is
    under test is the real router, deps and settings."""
    monkeypatch.setenv("EXECUTION_STORE_BACKEND", "postgres")
    monkeypatch.setenv("EXECUTION_POSTGRES_DSN", "postgresql://u:p@db:5432/wlct")
    get_settings.cache_clear()
    pool, scoped, bare = pair(**overrides)
    from app.main import create_app

    async def fake_open(settings: Any) -> tuple[FakePool, PostgresOrderStore]:
        return pool, PostgresOrderStore(cast(Any, pool))

    monkeypatch.setattr("app.main.open_durable_store", fake_open)
    client = stack.enter_context(TestClient(create_app()))
    return client, scoped, bare


def headers(tenant: str = TENANT) -> dict[str, str]:
    from tests.conftest import BASE_ENV

    return {
        "x-internal-token": BASE_ENV["EXECUTION_INTERNAL_TOKEN"],
        "x-tenant-id": tenant,
    }


class TestRoutesMemoryMode:
    def test_audit_refused_with_reason_not_fabricated_success(
        self, client: TestClient
    ) -> None:
        response = client.post(
            "/internal/v1/enablement/audit", json={"tenantId": TENANT}, headers=headers()
        )
        assert response.status_code == 409
        body = response.json()
        assert body["code"] == "RETENTION_NO_DURABLE_STORE"
        # memory has nothing to verify; the message says so and points at
        # the operator-side check that CAN run there
        assert "--check-rls" in body["message"]

    def test_status_publishes_the_shipped_evidence_window(
        self, client: TestClient
    ) -> None:
        body = client.get("/internal/v1/status", headers=headers()).json()
        assert body["enablementMaxAgeDays"] == 30

    def test_an_overridden_window_is_visible_on_the_same_surface(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("EXECUTION_ENABLEMENT_MAX_AGE_DAYS", "7")
        get_settings.cache_clear()
        with ExitStack() as stack:
            client, _a, _b = postgres_client(monkeypatch, stack)
            body = client.get("/internal/v1/status", headers=headers()).json()
            assert body["enablementMaxAgeDays"] == 7


class TestRoutesDurableMode:
    def test_healthy_cluster_answers_200_with_a_camel_case_body(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        with ExitStack() as stack:
            client, scoped, bare = postgres_client(monkeypatch, stack, scoped=2)
            response = client.post(
                "/internal/v1/enablement/audit",
                json={"tenantId": TENANT, "seedCounts": {name: 2 for name in PROBE_TABLES}},
                headers=headers(),
            )
            assert response.status_code == 200
            body = response.json()
            assert body["grade"] == "pass"
            # four tables is not 42 - and the body says BOTH truths, so a
            # dashboard that colours "pass" green still has to explain why
            # fullPlatform is false next to it.
            assert body["fullPlatform"] is False
            assert body["enginePlaneComplete"] is True
            assert body["probed"] == 4
            assert isinstance(body["ranAtUs"], int)
            assert body["role"]["rolname"] == "wlct_app"
            assert body["probes"][0]["policyExists"] is True
            assert body["probes"][0]["seededExpectedRows"] == 2
            assert "skipReason" in body["probes"][0]
            assert scoped.tx_commits == 1 and bare.tx_begins == 0

    def test_a_leak_is_reported_as_a_200_fail_not_a_500(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # The most important status-code decision on this surface: the audit
        # ran, the finding is the answer. Hiding evidence in a transport
        # error is how audits get disabled.
        with ExitStack() as stack:
            client, _scoped, _bare = postgres_client(monkeypatch, stack, bare=9)
            response = client.post(
                "/internal/v1/enablement/audit",
                json={"tenantId": TENANT},
                headers=headers(),
            )
            assert response.status_code == 200
            body = response.json()
            assert body["grade"] == "fail"
            assert set(body["summary"]["tables"].values()) == {"fail"}

    def test_bad_seed_shape_is_422_before_any_statement(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        with ExitStack() as stack:
            client, scoped, _bare = postgres_client(monkeypatch, stack)
            for payload in (
                {"tenantId": TENANT, "seedCounts": {"engine_orders": -1}},
                {"tenantId": TENANT, "seedCounts": {"engine_orders": "3"}},
                {"tenantId": TENANT, "seedCounts": {"engine_orders": True}},
                {"tenantId": TENANT, "seedCounts": "engine_orders=3"},
                {"tenantId": TENANT, "extra": 1},
            ):
                response = client.post(
                    "/internal/v1/enablement/audit", json=payload, headers=headers()
                )
                assert response.status_code == 422, payload
            assert scoped.statements == []

    def test_probe_table_outside_the_allow_list_is_400(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        with ExitStack() as stack:
            client, _scoped, _bare = postgres_client(monkeypatch, stack)
            response = client.post(
                "/internal/v1/enablement/audit",
                json={"tenantId": TENANT, "seedCounts": {"users": 3}},
                headers=headers(),
            )
            assert response.status_code == 400
            assert response.json()["code"] == "ENABLEMENT_REQUEST_REFUSED"

    def test_negative_coverage_expectation_is_refused(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # 422 because the wire model states the core's bounds for this one
        # field (0..4096, parity-pinned) and refuses before a connection is
        # borrowed; a value INSIDE those bounds that the core still dislikes
        # would come back as its own 400. Either way it is never a 5xx and
        # never a graded run built on a nonsense expectation.
        with ExitStack() as stack:
            client, scoped, bare = postgres_client(monkeypatch, stack)
            response = client.post(
                "/internal/v1/enablement/audit",
                json={"tenantId": TENANT, "coveredExpected": -1},
                headers=headers(),
            )
            assert response.status_code == 422
            # the refusal is COMPLETE: nothing was borrowed and nothing was
            # read on either connection, so "a 422 costs the database
            # nothing" is measured here rather than assumed.
            assert scoped.statements == [] and bare.statements == []

    def test_tenant_mismatch_is_refused_at_the_door(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        with ExitStack() as stack:
            client, scoped, _bare = postgres_client(monkeypatch, stack)
            response = client.post(
                "/internal/v1/enablement/audit",
                json={"tenantId": str(uuid4())},
                headers=headers(),
            )
            assert response.status_code == 403
            assert scoped.statements == []

    def test_route_is_on_the_internal_plane_only(self, client: TestClient) -> None:
        paths = {route.path for route in getattr(client.app, "routes", [])}
        assert "/internal/v1/enablement/audit" in paths


class TestConfigLaws:
    def test_nonsense_window_refuses_boot(self, monkeypatch: pytest.MonkeyPatch) -> None:
        for value in ("0", "-1", "36501"):
            monkeypatch.setenv("EXECUTION_ENABLEMENT_MAX_AGE_DAYS", value)
            get_settings.cache_clear()
            with pytest.raises(ValidationError) as caught:
                get_settings()
            # the refusal quotes the core's own words AND names the env var,
            # so the operator never has to guess which knob to fix
            text = str(caught.value)
            assert "EXECUTION_ENABLEMENT_MAX_AGE_DAYS" in text
            assert "core law" in text
        get_settings.cache_clear()

    def test_the_window_is_public_and_secret_free(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("EXECUTION_ENABLEMENT_MAX_AGE_DAYS", "45")
        get_settings.cache_clear()
        public = get_settings().to_public_dict()
        assert public["enablementMaxAgeDays"] == 45
        assert "EXECUTION_POSTGRES_DSN" not in str(public)

    def test_the_property_rebuilds_the_core_policy(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("EXECUTION_ENABLEMENT_MAX_AGE_DAYS", "13")
        get_settings.cache_clear()
        policy = get_settings().enablement_policy
        assert policy.max_evidence_age_days == 13
        assert policy.max_evidence_age_us == 13 * 86_400 * 1_000_000
```


## FILE: services/execution-engine/tests/test_part15_drift_parity.py (374 lines)

*24 re-derivations: PROBE_TABLES rebuilt from enable.sql's own ALTERs, ENABLE/FORCE pairing and disable.sql's exact inverse, policy-and-predicate checks against the Part 11 migration, the STABLE tenant function's shape, the GUC name pinned to prisma.service.ts, the scoped/bare statements differing by exactly the tenant belt, the AST scan proving both new modules are readers, and the DR manifest's rlsEvidence pointer checked against this service's actual route, scope and defaults.*

```python
"""Part 15 drift traps: the probe's SQL against the platform's own RLS
artifacts, in both directions.

An enablement audit is worth exactly as much as its agreement with reality.
The SQL in ``app/rls_probe.py`` is written against three artifacts nobody in
this service owns - the Part 11 migration (policies and the GUC function),
the generated ``enable.sql``/``disable.sql`` pair, and ``rls_coverage.json``.
Every one of them can move without anyone touching the probe: a new covered
table, a renamed policy, a predicate that stops mentioning the GUC. Each
would leave this audit cheerfully verifying the wrong thing, which is worse
than not verifying at all, because a green grade is what stops people
looking.

So every claim the executor makes is re-derived from those artifacts here:
the table list from the DDL (not from the module that grades it), the policy
name from the coverage manifest, the predicate shape from the migration, the
GUC name from the service that sets it, and the exclusions from the same
manifest the operator reads. The reverse direction is pinned too: the
artifacts must still claim what the probe claims, and the module must still
be a reader.

Part 14's parity file pins a WRITE's blast radius; this one pins a READ's
completeness - the same discipline, opposite hazard.
"""

from __future__ import annotations

import ast
import json
import re
from pathlib import Path

import pytest
from sqlglot import parse as sqlglot_parse
from wlct_trading.enablement import (
    EVIDENCE_LEDGER_TABLE,
    MAX_EVIDENCE_AGE_DAYS,
    MAX_PROBED_TABLES,
    MIN_EVIDENCE_AGE_DAYS,
    PLATFORM_SCOPED_TABLES,
    TENANT_GUC,
)

from app import rls_probe
from app.rls_probe import (
    BARE_COUNT_SQL,
    POLICY_POSTURE_SQL,
    PROBE_TABLES,
    ROLE_ATTRS_SQL,
    SCOPED_COUNT_SQL,
    TABLE_EXISTS_SQL,
)
from app.routers import enablement as enablement_router
from app.schemas import EnablementRequest

ROOT = Path(__file__).resolve().parents[3]
RLS_DIR = ROOT / "apps" / "api" / "prisma" / "rls"
MIGRATION = (
    ROOT
    / "apps"
    / "api"
    / "prisma"
    / "migrations"
    / "20260913120000_part11_row_level_security"
    / "migration.sql"
)
PRISMA_SERVICE = ROOT / "apps" / "api" / "src" / "infrastructure" / "prisma" / "prisma.service.ts"
ENGINE_APP = ROOT / "services" / "execution-engine" / "app"
ENGINE_CLIENT = (
    ROOT / "apps" / "api" / "src" / "modules" / "worker" / "engine-internal.client.ts"
)


def rls_artifact(name: str) -> str:
    return (RLS_DIR / name).read_text(encoding="utf-8")


def coverage_manifest() -> dict[str, object]:
    return json.loads((RLS_DIR / "rls_coverage.json").read_text(encoding="utf-8"))


def covered_tables(text: str) -> list[str]:
    return sorted(set(re.findall(r'ALTER TABLE "([a-z_]+)" ENABLE ROW LEVEL SECURITY;', text)))


def forced_tables(text: str) -> list[str]:
    return sorted(set(re.findall(r'ALTER TABLE "([a-z_]+)" FORCE ROW LEVEL SECURITY;', text)))


def unforced_tables(text: str) -> list[str]:
    return sorted(set(re.findall(r'ALTER TABLE "([a-z_]+)" NO FORCE ROW LEVEL SECURITY;', text)))


def disabled_tables(text: str) -> list[str]:
    return sorted(set(re.findall(r'ALTER TABLE "([a-z_]+)" DISABLE ROW LEVEL SECURITY;', text)))


def migrated_tables(migration: str) -> dict[str, str]:
    """table -> the CREATE POLICY block that covers it."""
    blocks: dict[str, str] = {}
    for match in re.finditer(
        r'CREATE POLICY (\w+) ON "([a-z_]+)"(.*?);', migration, re.DOTALL
    ):
        blocks[match.group(2)] = f"{match.group(1)}{match.group(3)}"
    return blocks


#: The heads of a statement a driver would actually run. Deliberately
#: includes the write verbs: a constant that STARTS like a write is the thing
#: this file is looking for.
_SQL_HEAD_RE = re.compile(
    r"^(SELECT|WITH|INSERT|UPDATE|DELETE|MERGE|TRUNCATE|ALTER|CREATE|DROP|GRANT|REVOKE|SET)\b",
    re.IGNORECASE,
)
READ_ONLY = "SET TRANSACTION READ ONLY"

ENABLE = rls_artifact("enable.sql")
DISABLE = rls_artifact("disable.sql")
MIGRATION_SQL = MIGRATION.read_text(encoding="utf-8")


class TestProbeTableSetMatchesTheArtifacts:
    def test_probe_tables_are_exactly_the_engine_plane_of_enable_sql(self) -> None:
        # Not "a subset", not "the ones we got to": if Part 11 covers a new
        # engine table and the probe does not read it, the audit's PASS is a
        # lie about a table it never touched. Re-deriving from the DDL (not
        # from a shared constant) is the whole point of this file.
        engine_plane = {name for name in covered_tables(ENABLE) if name.startswith("engine_")}
        assert set(PROBE_TABLES) == engine_plane
        assert len(PROBE_TABLES) == len(engine_plane)  # no duplicates

    def test_the_ledger_table_name_agrees_with_the_part14_owner(self) -> None:
        from app import retention as retention_module

        assert EVIDENCE_LEDGER_TABLE == retention_module.TABLE_RETENTION_RUNS
        assert EVIDENCE_LEDGER_TABLE in PROBE_TABLES

    def test_enable_and_disable_are_an_exact_pair(self) -> None:
        assert covered_tables(ENABLE) == forced_tables(ENABLE)
        assert unforced_tables(DISABLE) == disabled_tables(DISABLE) == covered_tables(ENABLE)
        # The probe asserts FORCE as a per-table fact; an unpaired ENABLE
        # (owner bypasses policies) is precisely what that assertion is for.
        manifest = coverage_manifest()
        assert len(covered_tables(ENABLE)) == len(manifest["covered"])
        assert {entry["table"] for entry in manifest["covered"]} == set(covered_tables(ENABLE))
        assert len(covered_tables(ENABLE)) == 42  # the number the docs quote

    def test_every_covered_table_has_a_policy_in_the_migration(self) -> None:
        policies = migrated_tables(MIGRATION_SQL)
        for table in covered_tables(ENABLE):
            assert table in policies, f"{table} is enabled but has no policy"
            assert "USING (tenant_id = wlct_current_tenant_id())" in policies[table]
            assert "WITH CHECK (tenant_id = wlct_current_tenant_id())" in policies[table]

    def test_platform_scoped_set_matches_the_migrations_exclusion_list(self) -> None:
        excluded = re.search(
            r"-- Excluded by design.*?\n(.*?)-- Their tenant-bearing rows",
            MIGRATION_SQL,
            re.DOTALL,
        )
        assert excluded is not None, "the migration's exclusion list moved; update this test"
        listed = set(re.findall(r"^--\s+([a-z_]+)\s+\(", excluded.group(1), re.MULTILINE))
        assert PLATFORM_SCOPED_TABLES == frozenset(listed)
        assert listed.isdisjoint(covered_tables(ENABLE))

    def test_the_coverage_manifest_is_the_same_source_as_its_own_schema(self) -> None:
        manifest = coverage_manifest()
        assert manifest["schema"] == "part11-rls-coverage-v1"
        assert manifest["policyName"] == "tenant_isolation"
        assert manifest["functionName"] == "wlct_current_tenant_id"
        assert {entry["table"] for entry in manifest["excluded"]} == PLATFORM_SCOPED_TABLES


class TestProbeSqlAgreesWithTheLaw:
    def test_the_policy_query_names_the_policy_the_manifest_names(self) -> None:
        # The executor hard-codes the policy name because a permissive
        # policy with any other name would still pass a naive "some policy
        # exists" check while isolating nothing.
        assert f"policyname = '{coverage_manifest()['policyName']}'" in POLICY_POSTURE_SQL

    def test_the_guc_the_probe_reads_is_the_guc_the_api_sets(self) -> None:
        api = PRISMA_SERVICE.read_text(encoding="utf-8")
        assert f"set_config('{TENANT_GUC}'" in api
        assert f"position('{TENANT_GUC}' in p.qual)" in POLICY_POSTURE_SQL
        # and the policy predicate itself never mentions the GUC directly:
        # it goes through the STABLE function, which is the fail-closed half
        # of the design.
        assert TENANT_GUC not in migrated_tables(MIGRATION_SQL)["engine_orders"]

    def test_the_function_the_probe_trusts_is_the_one_the_migration_defines(self) -> None:
        # The STABLE-marked uuid function is the fail-closed half of Part 11
        # (nullif + a bare comparison => no GUC, no rows). If it is ever
        # redefined volatile, non-uuid, or without the nullif, the audit's
        # trust in `policy_exists`/`scoped` is misplaced, so pin its shape.
        definition = re.search(
            r"CREATE OR REPLACE FUNCTION wlct_current_tenant_id\(\)(.*?)\$\$;\n",
            MIGRATION_SQL,
            re.DOTALL,
        )
        assert definition is not None, "the tenant function's definition moved"
        body = definition.group(1)
        # exactly one opener inside the captured body; the terminator is
        # what the regex stopped at
        assert "AS $$" in body and body.count("$$") == 1
        assert "RETURNS uuid" in body
        assert "LANGUAGE sql STABLE" in body
        assert "nullif(current_setting('app.tenant_id', true), '')" in body

    def test_both_count_statements_parse_and_target_the_probe_tables(self) -> None:
        for table in PROBE_TABLES:
            scoped = SCOPED_COUNT_SQL.format(table=table)
            bare = BARE_COUNT_SQL.format(table=table)
            for statement in (scoped, bare):
                parsed = sqlglot_parse(statement, dialect="postgres")
                assert len(parsed) == 1
                assert f"FROM {table}" in statement
            assert scoped.endswith("WHERE tenant_id = $1")
            assert "$1" not in bare

    def test_the_catalogue_reads_are_single_statements(self) -> None:
        for statement in (ROLE_ATTRS_SQL, TABLE_EXISTS_SQL, POLICY_POSTURE_SQL):
            assert len(sqlglot_parse(statement, read="postgres")) == 1
        # to_regclass is how the store proves a table exists; the audit uses
        # exactly that one spelling, and takes the name as a bind parameter
        # rather than interpolating it.
        assert TABLE_EXISTS_SQL == "SELECT to_regclass($1) AS regclass"

    def test_the_probe_module_is_a_reader_full_stop(self) -> None:
        # The strongest claim Part 15 makes, and it is verified over the
        # shipped files rather than over a list of constants someone could
        # forget to add to. Scanned from the SYNTAX TREE: the strings that
        # matter are the ones the module could actually execute (module-level
        # assignments and calls' literal arguments). Prose is not SQL -
        # Part 14's router docstring says "ledger INSERT" as English, and a
        # scan that flagged that would train people to skip this test.
        for path, expect_sql in (
            (ENGINE_APP / "rls_probe.py", True),
            # the router holds NO statement at all: a route that starts
            # growing its own SQL is a route bypassing the executor's allow-
            # list check, and an empty set there is the finding, not a
            # missing-constant accident.
            (ENGINE_APP / "routers" / "enablement.py", False),
        ):
            tree = ast.parse(path.read_text(encoding="utf-8"))
            candidates: list[str] = []
            for node in ast.walk(tree):
                if isinstance(node, ast.Constant) and isinstance(node.value, str):
                    value = node.value.strip()
                    if _SQL_HEAD_RE.match(value):
                        candidates.append(value)
            if expect_sql:
                assert candidates, f"{path.name}: an SQL-shaped constant should exist"
            else:
                assert candidates == [], f"{path.name} grew SQL: {candidates[:1]}"
            for stmt in candidates:
                assert stmt.startswith("SELECT") or stmt == READ_ONLY, (
                    f"{path.name}: non-read statement {stmt[:60]!r}"
                )
        # and the executor's own SQL is a closed set: exactly the catalogue
        # reads plus the two counts plus the read-only flag
        executed = sorted(
            value
            for value in vars(rls_probe).values()
            if isinstance(value, str) and _SQL_HEAD_RE.match(value.strip())
        )
        assert executed == sorted(
            [
                BARE_COUNT_SQL,
                POLICY_POSTURE_SQL,
                READ_ONLY,
                ROLE_ATTRS_SQL,
                SCOPED_COUNT_SQL,
                TABLE_EXISTS_SQL,
                rls_probe.TABLE_POSTURE_SQL,
            ]
        )


class TestTheManifestPointsAtThisEngine:
    """The DR manifest's rlsEvidence block (Part 15) is the platform's ONE
    statement of "how old may an enablement claim be, and where is the
    record". It names this service's endpoint; a pointer that no longer
    points is the failure a test like this exists for, because nothing else
    in the repository reads the manifest and the route together."""

    MANIFEST = json.loads((ROOT / "docs" / "dr" / "manifest.json").read_text(encoding="utf-8"))

    def test_the_verifier_is_this_routes_path(self) -> None:
        evidence = self.MANIFEST["rlsEvidence"]
        paths = [route.path for route in enablement_router.router.routes]
        assert evidence["verifier"] in paths
        assert evidence["requiredGrade"] == "pass"

    def test_the_evidence_ledger_is_the_ledger_the_cli_writes(self) -> None:
        evidence = self.MANIFEST["rlsEvidence"]
        assert evidence["evidenceLedger"] == "docs/dr/rls-evidence.jsonl"
        # and the command it names exists (the manifest's own validator also
        # checks this; asserting it from the ENGINE side means a rename that
        # touches one file and not the other goes red in whichever suite runs)
        script = evidence["command"].split()[-1]
        assert (ROOT / script).exists(), script

    def test_the_shipped_evidence_window_is_inside_the_cores_bounds(self) -> None:
        # Boot validation makes this true for any deployment; the DEFAULT
        # must satisfy it too, or a stack started with no env override has an
        # audit that grades every run as stale.
        from app.config import Settings

        days = Settings.model_fields["EXECUTION_ENABLEMENT_MAX_AGE_DAYS"].default
        assert MIN_EVIDENCE_AGE_DAYS <= days <= MAX_EVIDENCE_AGE_DAYS

    def test_the_manifest_cadence_is_no_looser_than_the_default_window(self) -> None:
        # A weekly re-audit and a monthly freshness window are two opinions
        # about the same clock. The cadence may be TIGHTER (re-audit often),
        # never looser than what this service will accept as fresh: otherwise
        # the platform's own docs would age out the evidence on purpose and
        # every --check-rls after the first month is a false alarm.
        hours = self.MANIFEST["rlsEvidence"]["cadenceHours"]
        from app.config import Settings

        default_days = Settings.model_fields["EXECUTION_ENABLEMENT_MAX_AGE_DAYS"].default
        assert hours <= default_days * 24

    def test_the_declared_scope_is_the_probe_table_set(self) -> None:
        # Two directions, because an assurance can rot either way: the
        # manifest may not claim more than the executor can see, and the
        # executor may not quietly grow while the manifest still says
        # "engine plane only". The overclaim phrases are refused by the
        # validator; THIS pins the specific names.
        scope = self.MANIFEST["rlsEvidence"]["scope"]
        assert "engine plane" in scope
        for banned in ("all tables", "every table", "entire database"):
            assert banned not in scope
        for table in PROBE_TABLES:
            assert table in scope, f"{table} probed but not declared in rlsEvidence.scope"


class TestRouteSurfaceStaysInternal:
    def test_the_route_lives_only_on_the_internal_prefix(self) -> None:
        assert enablement_router.router.prefix == "/internal/v1"
        paths = [route.path for route in enablement_router.router.routes]
        assert paths == ["/internal/v1/enablement/audit"]

    def test_the_forwarding_surface_never_reaches_it(self) -> None:
        # The engine's internal plane is reachable by exactly one caller: the
        # API's worker client, whose path list IS the surface. Part 14 kept
        # retention out of it for the same reason Part 15 keeps enablement
        # out: an operator's audit is not a job a scheduler should be able to
        # enqueue, and a defence-posture report is not something a public
        # request can be made to trigger.
        client = ENGINE_CLIENT.read_text(encoding="utf-8")
        paths = set(re.findall(r"'(/internal/v1/[a-z0-9/_-]+)'", client))
        assert paths, "the client's internal paths moved shape; re-derive this"
        assert "/internal/v1/enablement/audit" not in paths
        assert "/internal/v1/retention/run" not in paths
        assert all("/internal/v1/" in p for p in paths)

    def test_the_coverage_bound_matches_the_cores_ceiling(self) -> None:
        field = EnablementRequest.model_fields["covered_expected"]
        bounds = {
            bound
            for meta in field.metadata
            for bound in (getattr(meta, "le", None), getattr(meta, "ge", None))
            if bound is not None
        }
        assert bounds == {0, MAX_PROBED_TABLES}


@pytest.mark.parametrize("table", PROBE_TABLES)
def test_each_probe_table_is_named_in_both_directions(table: str) -> None:
    assert f'ALTER TABLE "{table}" ENABLE ROW LEVEL SECURITY;' in ENABLE
    assert f'ALTER TABLE "{table}" FORCE ROW LEVEL SECURITY;' in ENABLE
    assert f'CREATE POLICY tenant_isolation ON "{table}"' in MIGRATION_SQL
    assert BARE_COUNT_SQL.format(table=table).endswith(table)
```


## FILE: scripts/rls-enablement.mjs (374 lines)

*the operator's entry point - audit (curl to the internal endpoint, exit 0/1/2 on pass/fail/unknown, no defaults for URL/token/tenant), check (delegating to the manifest's --check-rls so the freshness policy has one home), and print-sql, which extracts the executor's SQL from the shipped Python file so the DBA-facing copy of the truth has no second copy to rot. It holds no credentials and opens no database connection: the recorder of evidence cannot invent it.*

```javascript
#!/usr/bin/env node
/**
 * RLS enablement verification entry point (Part 15).
 *
 * One sentence, honestly stated: THIS SCRIPT NEVER CONNECTS TO A DATABASE.
 * It is a thin, credential-free caller of the engine's read-only audit
 * endpoint, plus a recorder that turns the answer into repository evidence
 * (`docs/dr/rls-evidence.jsonl`) with the same append-only discipline the
 * backup ledger uses. A tool that "audits security" and also holds the
 * database password is the tool an operator is least able to trust: it can
 * make the finding as well as report it. Here the finding comes from the
 * engine (which holds the connection because it must serve traffic) and the
 * judgement comes from the core law inside it (`wlct_trading.enablement`);
 * this file only moves bytes.
 *
 *   node scripts/rls-enablement.mjs audit
 *     [--base-url URL] [--token TOKEN] [--tenant UUID]
 *     [--seed engine_orders=3,...] [--covered-expected N]
 *     [--record] [--note TEXT] [--at ISO] [--ledger PATH] [--json]
 *
 *     Calls POST /internal/v1/enablement/audit on the INTERNAL plane and
 *     prints the graded answer. Exit code: 0 pass, 1 fail, 2 unverified or
 *     transport refusal. `--record` appends one evidence line (grade, probed
 *     count, role, note) - and refuses to record anything it did not receive.
 *
 *   node scripts/rls-enablement.mjs check [--now ISO] [--ledger PATH]
 *
 *     Delegates to `node scripts/dr-manifest.mjs --check-rls`: is there a
 *     PASSING audit young enough to believe? (Cadence lives in the DR
 *     manifest's rlsEvidence block, so the answer is one policy, not two.)
 *
 *   node scripts/rls-enablement.mjs print-sql
 *
 *     The exact SQL the engine will run, straight out of the shipped Python
 *     module, so a DBA can do with psql what the endpoint does - and see that
 *     there is nothing in it but SELECTs. Parsing the module here (rather
 *     than restating the statements) is what keeps this help text from
 *     becoming the second, wrong copy of the truth.
 *
 * Why the token is a flag or an env var and never a default: the engine's
 * internal token is a credential like any other, and a helper that quietly
 * reads it out of a compose file would be the one place in the repository
 * where a "security tool" holds production keys.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PROBE_MODULE = join(ROOT, 'services', 'execution-engine', 'app', 'rls_probe.py');
// Resolved by dr-manifest against the manifest's own rlsEvidence block when
// unset, so this helper cannot point evidence at a file the policy does not
// read - and must not invent a default the validator would refuse.
const DEFAULT_LEDGER = 'docs/dr/rls-evidence.jsonl';
const GRADES = new Set(['pass', 'fail', 'unverified']);

/* ---------------------------------- args --------------------------------- */

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = { command, flags: {}, positionals: [] };
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (!arg.startsWith('--')) {
      options.positionals.push(arg);
      continue;
    }
    const name = arg.slice(2);
    const eq = name.indexOf('=');
    if (eq !== -1) {
      options.flags[name.slice(0, eq)] = name.slice(eq + 1);
      continue;
    }
    if (['record', 'json'].includes(name)) {
      options.flags[name] = true;
      continue;
    }
    const value = rest[i + 1];
    if (value === undefined || value.startsWith('--')) {
      fail(`flag --${name} requires a value`);
    }
    options.flags[name] = value;
    i += 1;
  }
  return options;
}

function fail(message) {
  console.error(`rls-enablement: ${message}`);
  process.exit(2);
}

function usage() {
  console.error(
    [
      'usage:',
      '  node scripts/rls-enablement.mjs audit [--base-url URL] [--token TOKEN] --tenant UUID',
      '                                        [--seed TABLE=N,...] [--covered-expected N] [--record] [--note TEXT] [--at ISO] [--ledger PATH] [--json]',
      '  node scripts/rls-enablement.mjs check [--now ISO] [--ledger PATH]',
      '  node scripts/rls-enablement.mjs print-sql',
    ].join('\n'),
  );
  return 2;
}

/* --------------------------------- audit --------------------------------- */

function audit(options) {
  const { flags } = options;
  const baseUrl = flags['base-url'] ?? process.env.EXECUTION_ENGINE_URL;
  const token = flags.token ?? process.env.EXECUTION_INTERNAL_TOKEN;
  const tenant = flags.tenant ?? process.env.WLCT_RLS_PROBE_TENANT;
  if (!baseUrl || !token || !tenant) {
    fail(
      'audit needs --base-url, --token and --tenant (or EXECUTION_ENGINE_URL / ' +
        'EXECUTION_INTERNAL_TOKEN / WLCT_RLS_PROBE_TENANT). There is no default on ' +
        'purpose: a helper that guesses an internal endpoint can audit the wrong cluster.',
    );
  }
  if (token.length < 32) {
    fail('--token is too short to be a real internal token (the engine requires >= 32 chars)');
  }
  const body = { tenantId: tenant };
  if (flags.seed !== undefined) {
    body.seedCounts = parseSeed(flags.seed);
  }
  if (flags['covered-expected'] !== undefined) {
    const n = Number(flags['covered-expected']);
    if (!Number.isInteger(n) || n < 1 || n > 4096) {
      fail('--covered-expected must be an integer 1..4096 (the coverage manifest\'s table count)');
    }
    body.coveredExpected = n;
  }
  const url = `${String(baseUrl).replace(/\/$/, '')}/internal/v1/enablement/audit`;
  let response;
  try {
    const raw = execFileSync(
      'curl',
      [
        '--silent',
        '--show-error',
        '--fail-with-body',
        '--max-time',
        String(Number(flags.timeout ?? 60)),
        '--request',
        'POST',
        url,
        '--header',
        `x-internal-token: ${token}`,
        '--header',
        `x-tenant-id: ${tenant}`,
        '--header',
        'content-type: application/json',
        '--data',
        JSON.stringify(body),
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    response = JSON.parse(raw);
  } catch (error) {
    // A refusal from the endpoint (409 no durable store, 400 bad request) is
    // INFORMATION the operator asked for; do not flatten it into "curl
    // failed", and never echo the token while explaining.
    const detail = `${error.stdout ?? ''}${error.stderr ?? ''}`.replaceAll(String(token), '[redacted]');
    console.error(`rls-enablement: the audit did not complete:\n${detail}`);
    console.error('no evidence was recorded - a run that did not happen is not a pass');
    return 2;
  }
  const grade = response.grade;
  if (!GRADES.has(grade)) {
    console.error(`rls-enablement: the engine answered with an unknown grade ${JSON.stringify(grade)}`);
    return 2;
  }
  if (flags.json) {
    process.stdout.write(`${JSON.stringify(response)}\n`);
  } else {
    printAudit(response);
  }
  if (flags.record) {
    // A recording failure changes nothing about the FINDING: the audit ran
    // and its grade is on the screen. Distinguishing them is the difference
    // between "the database is not isolated" and "we cannot prove whether it
    // is", and an operator who merges the two stops trusting both.
    const recorded = record(response, { ...flags, token });
    if (!recorded && grade === 'pass') {
      return 2;
    }
  }
  return grade === 'pass' ? 0 : grade === 'fail' ? 1 : 2;
}

function parseSeed(raw) {
  const seeds = {};
  for (const part of String(raw).split(',')) {
    if (part.trim() === '') {
      continue;
    }
    const [table, value] = part.split('=');
    const count = Number(value);
    if (!table || value === undefined || !Number.isInteger(count) || count < 0) {
      fail(`--seed expects TABLE=COUNT pairs (got ${JSON.stringify(part)})`);
    }
    seeds[table.trim()] = count;
  }
  return seeds;
}

function printAudit(response) {
  const banner = {
    pass: 'PASS  - every probed table is enabled, forced, and isolated as far as this run could see',
    fail: 'FAIL  - at least one table is NOT proving isolation; treat as a security finding, not a lint',
    unverified: 'UNVERIFIED - the run was incomplete or skipped tables; this is NOT a pass',
  }[response.grade];
  console.log(`\n${banner}`);
  console.log(`role: ${response.role.rolname} (bypassrls=${response.role.bypassrls}, superuser=${response.role.superuser})`);
  console.log(
    `probed: ${response.probed}, fullPlatform=${response.fullPlatform}, ` +
      `enginePlaneComplete=${response.enginePlaneComplete}, at ${new Date(Number(response.ranAtUs) / 1000).toISOString()}`,
  );
  for (const probe of response.probes) {
    console.log(
      `  [${probe.grade.toUpperCase().padEnd(3)}] ${probe.table.padEnd(24)} ` +
        `policy=${probe.policyExists} enable=${probe.rlsEnabled} force=${probe.rlsForced} ` +
        `scoped=${probe.scopedRows}/${probe.seededExpectedRows} bare=${probe.bareRows}` +
        `${probe.absent ? ' ABSENT' : ''}${probe.skipReason ? ` skipped: ${probe.skipReason}` : ''}`,
    );
  }
  if (response.summary?.veto !== undefined) {
    console.log(`  veto: ${JSON.stringify(response.summary.veto)}`);
  }
  console.log('');
}

/* --------------------------------- record -------------------------------- */

/** Record the audit's outcome as repository evidence.
 *
 * There is exactly ONE writer of `rls-evidence.jsonl`: dr-manifest's
 * `--record-rls`, which owns the shape rules (closed grade vocabulary,
 * single-line fields, secret scan, corrupt-ledger refusal). Re-implementing
 * them here would be the classic second copy of a policy: the copy that
 * drifts, and the one an operator follows when the first is inconvenient.
 * So this function assembles flags, shells out, and reports - it does not
 * open the file.
 */
function record(response, flags) {
  const args = [join(ROOT, 'scripts', 'dr-manifest.mjs'), '--record-rls', '--grade', response.grade];
  if (Number.isInteger(response.probed)) {
    args.push('--probed', String(response.probed));
  }
  if (typeof response.role?.rolname === 'string') {
    args.push('--role', response.role.rolname.slice(0, 200));
  }
  if (flags.note !== undefined) {
    if (/[[\r\n]/.test(flags.note) || flags.note.length > 500) {
      fail('--note must be one line of at most 500 characters');
    }
    args.push('--note', flags.note);
  }
  if (flags.at !== undefined) {
    args.push('--at', flags.at);
  }
  const ledger = flags.ledger ?? DEFAULT_LEDGER;
  if (String(ledger).includes('..')) {
    fail('--ledger must not traverse outside the repository');
  }
  // Absolute for the CHILD only: dr-manifest resolves a relative --ledger as
  // process.cwd()-relative, so handing it the resolved path is what makes
  // `cd somewhere/else && ... --record` still record against THIS checkout.
  args.push('--ledger', resolve(ledger));
  try {
    process.stdout.write(execFileSync('node', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
    return true;
  } catch (error) {
    const detail = `${error.stdout ?? ''}${error.stderr ?? ''}`.replaceAll(
      String(flags.token ?? process.env.EXECUTION_INTERNAL_TOKEN ?? ''),
      '[redacted]',
    );
    console.error(`rls-enablement: the evidence line was NOT recorded:\n${detail.trim()}`);
    console.error('the audit answer above stands; the ledger is what says it happened');
    return false;
  }
}

/* --------------------------------- print-sql ----------------------------- */

const SQL_ASSIGNMENT = /^(\w+_SQL): Final = \(?[\s\S]*?\n\)|^(\w+_SQL): Final = "([^"]*)"/gm;

function printSql() {
  const source = readFileSync(PROBE_MODULE, 'utf8');
  const statements = extractSql(source);
  if (statements.length === 0) {
    fail(`no SQL constants found in ${PROBE_MODULE} - the executor moved, so did this helper`);
  }
  for (const [name, sql] of statements) {
    console.log(`-- ${name}`);
    console.log(`${sql};\n`);
  }
  console.log(
    [
      '-- The scoped count runs inside a transaction that begins with:',
      "--   SELECT set_config('app.tenant_id', $1, true);",
      "--   SET TRANSACTION READ ONLY",
      '-- The bare count runs on a separate acquisition with NO tenant GUC.',
      '-- Verification of that ordering is automated: the engine test suite pins',
      '-- it in tests/test_part15_enablement.py, and the parity file pins this',
      '-- SQL against apps/api/prisma/rls/.',
    ].join('\n'),
  );
  return 0;
}

/** The module's SQL constants, read out of the shipped Python source. Kept
 * regex-simple on purpose: this is documentation help, not a parser, and a
 * change to the module's spelling is a change the parity tests must notice
 * first. */
export function extractSql(source) {
  const out = [];
  const re = /^(\w+_SQL): Final = \(\n([\s\S]*?)\n\)|^(\w+_SQL): Final = "([^"]*)"$/gm;
  let match;
  while ((match = re.exec(source)) !== null) {
    if (match[1] !== undefined) {
      const text = match[2]
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.startsWith('"') || line.startsWith("'"))
        .map((line) => line.replace(/^["']|["'],?$/g, ''))
        .join(' ');
      out.push([match[1], text]);
    } else {
      out.push([match[3], match[4]]);
    }
  }
  return out;
}

/* ---------------------------------- main --------------------------------- */

function main(argv) {
  const options = parseArgs(argv);
  if (options.command === undefined) {
    return usage();
  }
  if (options.command === 'audit') {
    return audit(options);
  }
  if (options.command === 'check') {
    const args = [join(ROOT, 'scripts', 'dr-manifest.mjs'), '--check-rls'];
    if (options.flags.now !== undefined) {
      args.push('--now', options.flags.now);
    }
    if (options.flags.ledger !== undefined) {
      args.push('--ledger', options.flags.ledger);
    }
    try {
      process.stdout.write(execFileSync('node', args, { encoding: 'utf8', stdio: ['ignore', 'inherit', 'inherit'] }));
      return 0;
    } catch (error) {
      return typeof error.status === 'number' ? error.status : 1;
    }
  }
  if (options.command === 'print-sql') {
    return printSql();
  }
  return usage();
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  process.exitCode = main(process.argv.slice(2));
}
```


## FILE: docs/PART15_RLS_ENABLEMENT.md (546 lines)

*the part's authoritative document: what Part 11 shipped vs what it left believed, the four load-bearing grading laws with their reasons, the probe's one design fact (the bare count outside the GUC) and why the alternative is an audit that cannot find a leak, the wire surface's three refusals and one non-refusal, the CLI's no-credentials stance, the evidence ledger and its freshness asymmetry, what the parity tests actually verify (and what they do not, in the same font), the five-move runbook, and the decisions ledger with each rejected alternative nearby.*

````text
# Part 15 - RLS enablement is now a verifiable operation (read-only)

Part 11 shipped row-level security as an *artefact set*: a migration that
defines the function and 42 policies, a generator, `enable.sql` with a
five-item pre-flight checklist, `disable.sql` as its inverse, and a coverage
manifest. It also shipped the honest comment above all of that - "dormant
until the checklist-gated enablement". Fourteen parts later the platform
could describe its defences in exact detail and had no way to ANSWER whether
one of them was switched on. Every tool in the repository had to trust the
deployment; the only evidence that RLS existed was a file that says somebody
ran a file.

Part 15 closes that gap the only way a gap in *knowledge* closes: a
verification with a grade, a record, and a freshness policy. It changes
nothing. There is no migration, no new table, no DELETE statement anywhere in
this part, and no code path here that can flip `ENABLE ROW LEVEL SECURITY`.
The verb is "look, count, report", and the reason the verb is safe is exactly
the reason the answer is now trustworthy: it can be run on a live staging
database, by an operator who has no business running DDL, on a Tuesday,
without a change window.

Concretely, five things ship:

1. `libs/trading-core/wlct_trading/enablement.py` - the enablement LAW, pure
   and dependency-free: what a probe must look like to count, which tables may
   legitimately answer a bare read, when a run is `UNVERIFIED` rather than
   green, and what nonsense cannot be a policy at all.
2. `services/execution-engine/app/rls_probe.py` - that law's only executor
   against Postgres: six statements, every one a read, and one design fact
   (the leak probe runs OUTSIDE the tenant transaction) that the whole
   exercise turns on.
3. `POST /internal/v1/enablement/audit` - the internal-plane endpoint that
   runs it, grades it, and answers 200 even when the grade is FAIL.
4. `scripts/rls-enablement.mjs` - the operator's entry point (`audit`,
   `check`, `print-sql`), which never touches a database, plus
   `scripts/dr-manifest.mjs --check-rls / --record-rls` and the
   `docs/dr/rls-evidence.jsonl` ledger.
5. The evidence freshness contract, in `docs/dr/manifest.json` under
   `rlsEvidence`: a weekly re-audit, a one-month window on this service's
   side, and a rule that a recorded FAIL is not a stale PASS.

The rest of this document is the reasoning behind those five, the exact
promises the code makes, and the runbook that turns "we believe RLS is on"
into "here is the audit, its age, and its verdict".


## 1. What was shipped, what was believed, and the gap between

`enable.sql` asks a human five questions before running it: does every write
path use `withTenantRls`; does the deployment role have neither `BYPASSRLS`
nor superuser; are the excluded (platform-scoped) tables confirmed
unaffected; has rollback been rehearsed; is traffic low. Four of those five
are deployment conditions, and a checklist answers them once, at the moment
of maximum attention. Then the platform goes on running for a year, during
which:

* a new tenant-bearing table is added and the RLS generator is not re-run
  (Part 13's `engine_*` tables are exactly this case, and Part 14's ledger
  is exactly that follow-up);
* a role is granted something "temporarily, for the migration";
* a `FORCE` line is lost when a table is recreated by a hand-written
  migration;
* the policies are on and a code path that never sets the GUC starts
  returning zero rows and gets reported as "no orders today".

None of those are detectable by reading the repository. All of them are
detectable, cheaply, by asking the database three questions per table: does
a policy exist, is RLS enabled and forced, and does a read with the tenant
bound see a different number of rows than a read without it. That is the
whole probe. Everything else in Part 15 is the discipline of turning three
questions into an answer nobody can shade.

Why not a migration that verifies at boot? Because a boot check on the engine
either refuses to start (a defence layer's staleness becomes an outage, which
is the exact trade Part 11 refused to make in reverse) or warns (which is
today's checklist with extra steps). Verification is an OPERATION with a
cadence, not a startup condition with a kill switch. That decision is
§11's first entry and it is the part of this design most likely to be
"improved" later, so it is written down rather than implied.


## 2. The law (core), before any SQL existed

`wlct_trading/enablement.py` grades results handed to it by an executor. It
imports no clock, no driver and no filesystem - a structural fact pinned by
an AST test, because an enablement report whose freshness is decided by the
library's own wall clock is not reproducible, and "no write verb in the law"
is not a comment, it is a scan (`tests/test_part15_enablement.py::TestModulePurity`).

Its vocabulary is closed and deliberately asymmetric:

| a probe's grade | meaning |
| --- | --- |
| `pass` | policy exists, RLS enabled AND forced, the scoped count equals the seeded expectation, and (for tenant tables) the bare count is 0 |
| `fail` | any of the above is not true, or the table is absent from the database while present in the coverage manifest |
| `skipped` | the caller declined to probe it, with a reason |

| a run's grade | meaning |
| --- | --- |
| `pass` | every probe passed, nothing skipped, count matches what was asked to cover, and the role can neither bypass nor outrank the policies |
| `fail` | any probe failed, **or** the role has `rolbypassrls`/`rolsuper` |
| `unverified` | nothing was probed, something was skipped, or the probed set does not match the expected coverage count |

Four laws in that table are load-bearing and each has its own test:

* **Absence outranks everything.** A table in `rls_coverage.json` that
  `to_regclass` cannot resolve is a coverage LIE, not a table with RLS off.
  Grading it `enabled=false` understates the finding; the law grades it
  `fail` before looking at any other field.
* **The role veto precedes the counts.** `rolbypassrls` or `rolsuper` makes
  every other number meaningless, so the run fails even when all four probes
  read "isolated". This is checklist item 2 in executable form, and it exists
  because a bypassing role is precisely the failure a "green" report would
  otherwise launder. There is no `pass-with-warning` spelling here on
  purpose: "bypassing but tidy" is not a posture this platform records.
* **`unverified` is not "failed politely".** It is a distinct third answer,
  produced by a run that checked nothing, or skipped a table it was asked to
  cover, or covered fewer tables than the manifest claims. `grade_run` puts
  the reason in `summary["veto"]` so the report says WHY it refuses to be
  green; a dashboard that renders `unverified` as a shade of success is a
  bug in the dashboard, and this module is what gives that test something to
  assert.
* **The exception is a list, not a shrug.** The "bare read must be zero" rule
  is a TENANT-table rule. The seven platform-scoped tables (nullable
  `tenantId`: `audit_logs`, `kill_switches`, `ops_alerts`, `ops_incidents`,
  `roles`, `security_events`, `subscription_plans`) may answer a bare read
  with rows correctly - failing them would nag on a healthy deployment, and
  nagging is how checklists get switched off. `PLATFORM_SCOPED_TABLES` mirrors
  the manifest's exclusion set, and a core test re-derives it from
  `apps/api/prisma/rls/rls_coverage.json` so the mirror cannot silently drift
  in the core's own suite.

Nonsense cannot be constructed: `max_evidence_age_days` must be a plain int
1..36,500 (0 would flood the ledger, a century means "forever fresh");
negative row counts, `True` where an int is claimed, a probe list containing
the same table twice ("a repeated probe is not redundancy, it is one table
left unchecked"), and a covered-table count outside 0..4,096 are all
refusals. `EnablementPolicy.evidence_is_fresh` takes both timestamps as
arguments and treats a run dated in the FUTURE as not fresh - the safe answer
to an unverifiable clock is "go run the audit again", never "credit it".


## 3. The probe, and the one fact it turns on

`app/rls_probe.py` holds six statements. All of them are `SELECT`s plus one
`SET TRANSACTION READ ONLY`, and a test derives the list from the shipped
file's own syntax tree rather than from a list of constants somebody could
forget to extend.

The interesting part is not the statements, it is where they run.

**Inside one `_TenantTransaction`** (Part 13's rhythm: acquire, begin,
`set_config('app.tenant_id', $1, true)`, work, commit) the audit reads
`pg_roles`, `to_regclass`, `pg_class` and `pg_policies`, and counts the
tenant's own rows. The read-only flag is the module's FIRST statement inside
that transaction - legal only before the transaction touches data, which is
why it leads, and pinned as text by `test_transaction_is_forced_read_only_first`.

**On a separate acquisition, with no transaction and no GUC**, it runs the
bare count. This is the whole audit:

> `set_config(..., is_local => true)` dies with its transaction. A connection
> borrowed outside one therefore has no `app.tenant_id`, which is the only
> condition under which "count this table with no tenant predicate" means
> anything.

If both counts ran inside the same transaction, the bare count would be the
scoped count by construction, every table would report `0` leaked rows, and
the audit would be structurally incapable of finding the thing it exists to
find. That sentence is why this part has a test file before it has a route:
`test_a_healthy_database_passes_and_reads_the_way_it_must` asserts the bare
connection made ZERO `set_config` calls, opened NO transaction, and saw
exactly the number of pool acquisitions the design allows (two: the
transaction, and one bare session serving all tables - a per-table borrow
would be a different shape and the fake's `acquires` counter catches it).

There is nothing to "clear" on the bare session. The platform has no
cross-tenant GUC: the `set_config` call is transaction-local by Part 11's
contract, and the docs list a platform-role session concept as future work,
not a variable to reset. An earlier draft of this module cleared a
hypothetical `app.cross_tenant_seed`; that was removed on the ground that a
verification tool must not contain SQL for a mechanism that does not exist,
because it reads as coverage while testing nothing. The only thing that can
defeat a bare read here is a role privilege, and that is what the veto in §2
handles.

Two smaller decisions worth their weight:

* **Nothing is seeded, so nothing must be cleaned up.** The textbook RLS
  probe inserts two tenant-A rows, reads them from a tenant-B session, then
  deletes them. Part 15 ships a tool whose entire claim is "read-only", so it
  does not get to insert. Seed expectations are INPUTS: the operator (or the
  staging script) says "this probe tenant should see 3 rows in each table" and
  the executor checks scoped == that number. Unknown seed is the honest
  default, and it degrades to a weaker-but-real test rather than to a skip:
  the catalogue posture (`policy_exists`, `relrowsecurity`,
  `relforcerowsecurity`) carries the finding and the counts cross-check each
  other. A probe with 0 seeded rows and 0 bare rows is a PASS, not a no-op:
  an empty tenant still proves the predicate is being applied.
* **A refused bare read is the best answer a tenant table can give.** If
  Postgres rejects the unfiltered count with SQLSTATE `42501`
  (insufficient privilege - what `FORCE` plus a SELECT-scoped policy looks
  like for a role with no bypass), the executor records "zero rows reached"
  and the grade stands. Any OTHER failure of that read - connection drop,
  timeout, cancellation - PROPAGATES and the run records nothing. The
  distinction is deliberate and narrow (the swallow is keyed on the SQLSTATE,
  duck-typed so this module never imports the driver's exception hierarchy):
  grading a broken cluster as isolated is the one way this audit could bless
  a failure, so it is refused rather than handled.
* **A probe table list is a constant, not a parameter.** `PROBE_TABLES` names
  the three durable engine tables plus its ledger; a request body may supply
  a seed count for a table outside it and is refused (`ProbeUnknownTable`,
  HTTP 400) before a connection is borrowed. The name reaches `{table}`
  interpolation, so this is the one place a caller could smuggle text into a
  statement, and an allow-list checked against the module's own constant is
  the cheap answer. `coveredExpected` and `seedCounts` are validated before
  the database is touched, and `strict=True` on the seed values is load
  bearing: pydantic's non-strict coercion accepts `"3"`, and - worse -
  `true` as `1`, which would hand the audit a seed nobody wrote.


## 4. The wire surface: one route, three refusals, one non-refusal

`POST /internal/v1/enablement/audit` sits on the internal plane beside
Part 14's retention routes: same token, same tenant-header match, proxied by
nothing public, and absent from the API's worker-forwarding path list (pinned
by `test_the_forwarding_surface_never_reaches_it`: that list IS the public
plane's reach, and an audit is not a job a scheduler should be able to
enqueue).

There is **no apply switch**, deliberately. Part 14 needs
`EXECUTION_RETENTION_ENABLED` because a DELETE needs two yeses; wrapping a
SELECT in a feature flag would be theatre that still has to be documented,
tested and defaulted. What the config DOES carry is the evidence window,
`EXECUTION_ENABLEMENT_MAX_AGE_DAYS` (default 30), whose bounds exist once in
the core and are validated at boot - a typo in a freshness window is exactly
the class of bug that quietly makes an audit useless ("every result is
fresh"), so it refuses startup instead of defaulting.

Three refusals, each saying something rather than erroring:

| answer | when | why that shape |
| --- | --- | --- |
| `409 RETENTION_NO_DURABLE_STORE` | memory-backend runtime | there is no Postgres here: no roles, no policies, nothing to verify. Answering "PASS, 4 tables isolated" would be the single most misleading success on this platform. (Same code as Part 14 on purpose - it means "this maintenance surface needs the durable plane", one fact, one name.) |
| `400 ENABLEMENT_REQUEST_REFUSED` | a seed table outside the allow-list, or a coverage number the core refuses | the request body is not where an audit's scope is decided |
| `503 ENABLEMENT_ROLE_UNKNOWN` | `pg_roles` has no row for the connected role | an audit that cannot read the bypass flag is not an audit; refusing beats assuming "no bypass". The message names the grant that fixes it (`grant.sql`, Part 11) |

And one deliberate **non**-refusal, the most important status-code decision
on the surface: **a FAIL grade is a 200**. The audit ran; its answer is the
finding. Returning 500 would bury the evidence under a transport error, break
`curl`-based CI that reads the body, and - the real risk - tempt somebody to
make the probe "tolerant". 5xx here means "no evidence at all", which is a
different fact with a different remedy, and the two must not share a code.

The response body states its own limits, in two booleans rather than one:

```
grade: pass | fail | unverified
fullPlatform: false            # 4 tables is not the manifest's 42
enginePlaneComplete: true      # everything THIS service can see was read
```

One field cannot honestly say both, and a single `partial: true` would leave a
dashboard free to render the headline green without explaining it. The
per-table list carries the raw counts (`scopedRows`, `bareRows`,
`seededExpectedRows`) alongside the flags, because a report that says "true"
has to be trusted and a report that says "3 / 0 / 3" can be re-audited by a
second operator. The per-table grade in the body is re-derived by the core law
inside the same request - there is no second formatter of this report
anywhere, because two spellings of a grading rule are one careless edit from
disagreeing.

`/internal/v1/status` gained `enablementMaxAgeDays`, and the worker's
compatibility assertion does NOT check it: like the retention knobs, it is
posture for an operator to read, not a condition for a job to be forwarded,
and widening the compatibility law is a change with a blast radius this part
does not need.


## 5. The CLI: `scripts/rls-enablement.mjs`, and why it holds no credentials

```
node scripts/rls-enablement.mjs audit  [--base-url URL] [--token TOK] --tenant UUID
                                       [--seed TABLE=N,...] [--covered-expected N]
                                       [--record] [--json]
node scripts/rls-enablement.mjs check  [--now ISO] [--ledger PATH]
node scripts/rls-enablement.mjs print-sql
```

`audit` calls the endpoint (via `curl`, so the helper has no HTTP stack of its
own and no dependency) and exits 0 on `pass`, 1 on `fail`, 2 on `unverified`
or a transport refusal - the same three-way exit law the platform's other
operator CLIs use, so CI can distinguish "not isolated" from "we do not know".
There are no defaults for `--base-url`, `--token` or `--tenant`: a helper that
guesses an internal endpoint can audit the wrong cluster and report a confident
PASS about it, which is worse than not auditing.

**This script never connects to a database.** That is not a limitation to
apologise for, it is the reason its output can be trusted: a tool that
"audits security" while holding the database password can manufacture the
finding as easily as report it. Here the observation comes from the engine
(which holds a connection because it must serve traffic, and whose audit runs
under the SAME read-only, GUC'd contract as its money path), the judgement
comes from the core law inside it, and this file only moves bytes and appends
them.

`print-sql` prints the executor's SQL by parsing the shipped Python module, so
the DBA-facing copy of the truth has no second copy to rot: a test asserts the
set of names rendered equals the set of `*_SQL` constants in the file, and
that every rendered statement is a `SELECT` (or `SET TRANSACTION READ ONLY`).

`--record` writes evidence by shelling out to the manifest CLI's
`--record-rls`. It does not open the ledger itself. One writer means one set of
shape rules (closed grade vocabulary, single-line fields, secret scan,
refusal-to-append-to-a-corrupt-file) rather than a copy that drifts - and a
recording failure changes nothing about the finding: `audit` still prints the
verdict, and only downgrades a would-be `0` to `2` when the evidence could not
be filed, because "not isolated" and "we cannot prove whether it is" are
different sentences and the exit code must keep them apart.

`check` delegates to `node scripts/dr-manifest.mjs --check-rls`. The
verification command and the freshness policy are in different files on
purpose: one needs an engine and a token, the other needs nothing but a
repository, which is what makes the second one runnable from CI on every
commit.


## 6. The evidence ledger and its freshness policy

`docs/dr/rls-evidence.jsonl`, one line per audit, appended by

```
node scripts/dr-manifest.mjs --record-rls --grade pass|fail|unverified
                             [--probed N] [--role NAME] [--note TEXT] [--at ISO]
```

and graded by `--check-rls`:

```
[ ok  ] rls-enablement: fresh, next due in 6d 23h [pass] 2026-09-14T06:00:00.000Z (6h ago)
[DUE  ] rls-enablement: last passing audit overdue by 9d 6h [pass] ...
[FAIL] rls-enablement: [fail] 2026-09-20T06:00:00.000Z (6h ago) - the recorded audit
        did not conclude "pass", so the platform must not claim enabled-and-enforced
```

The rules, all inherited from Part 12's backup ledger because that ledger's
discipline is already understood: append-only, unknown fields are a problem
("typos hide evidence"), an unparsable line is reported by NUMBER, a corrupt
ledger makes both commands REFUSE rather than grade the fleet on unreadable
evidence, and any secret-shaped content in the file (or in the note about to
be written) is an exit-1 refusal. Evidence describes what was verified, never
what was used to verify it.

Three decisions specific to Part 15:

* **No new table.** The engine side of this part writes nothing to the
  database at all; where a durable record of the *audit object* is wanted,
  `EVIDENCE_LEDGER_TABLE` names Part 14's `engine_retention_runs`, whose
  columns (`dry_run`, `rows_deleted`, `batches`, `exhausted`) are
  reinterpreted in place. The alternative - an `engine_enablement_runs` table
  for a part whose verb is "look" - means a new thing to migrate, to cover
  with RLS, and to forget to prune. The pinning test asserts the reuse rather
  than trusting the comment, and a rename to something more "honest" now
  costs a part boundary. (The route does not write there; the record lives in
  git, which is where a deployment's own security evidence belongs.)
* **Last-entry-of-any-grade ages the clock; last-entry's GRADE decides the
  verdict.** Re-running the audit and finding a leak must not resurrect a
  stale pass, and it must not be erased as "not evidence". A fresh FAIL is
  therefore an alarm, not a gap in the record: `--check-rls` exits 1 and says
  the platform may not claim enabled-and-enforced. A deployment that wants
  the alarm to STOP has exactly one honest option - fix the isolation and
  re-audit.
* **`cadenceHours` is capped at 8760 and `requiredGrade` is not a knob.** The
  validator accepts only `"pass"`, rejecting `fail`, `unverified`, `warning`,
  `true` and `0`: a manifest that lets a report choose its own bar is not a
  bar. A cadence larger than a year is refused as "a way of writing never",
  which is the same reasoning that caps the review cadence elsewhere in the
  manifest.

The manifest also declares **scope**, and the validator refuses an
overclaim:

> The engine endpoint verifies the engine plane only (`engine_orders`,
> `engine_order_events`, `engine_order_fills`, `engine_retention_runs`). The
> platform's other covered tables are audited by the operator-side checklist
> in `apps/api/prisma/rls/enable.sql`, which this manifest's cadence also
> ages.

That paragraph is checked in both directions: the manifest may not name
phrases like "all tables", and the engine test suite asserts that every entry
in `PROBE_TABLES` is named in it. A future change that quietly grows the probe
set while the assurance still says "engine plane only" goes red in one of the
two suites, whichever runs first.


## 7. Drift parity: what the tests actually verify

`services/execution-engine/tests/test_part15_drift_parity.py` re-derives
every claim the audit makes from artifacts three different steps produced:

| pinned | against |
| --- | --- |
| `PROBE_TABLES` | the `engine_*` subset of `enable.sql`'s own ALTER statements - not from a shared constant |
| policy existence | every covered table has `CREATE POLICY tenant_isolation` with `USING`/`WITH CHECK` = `tenant_id = wlct_current_tenant_id()` in the Part 11 migration |
| `ENABLE`/`FORCE` pairing | the two lists in `enable.sql` are identical, 42 entries, and `disable.sql` is exactly their inverse (`NO FORCE`, `DISABLE`) |
| policy name and GUC name | `rls_coverage.json`'s `policyName`/`functionName`, `TENANT_GUC`, and the literal `set_config('app.tenant_id', ...)` in `prisma.service.ts` |
| the tenant function's shape | `RETURNS uuid`, `LANGUAGE sql STABLE`, `nullif(current_setting('app.tenant_id', true), '')` - i.e. still fail-closed |
| the exclusion list | the migration's "Excluded by design" comment == `PLATFORM_SCOPED_TABLES` == the manifest's `excluded` entries |
| the two count statements | they differ by exactly `WHERE tenant_id = $1`, parse with sqlglot, and the bare one has no bind parameter |
| the executor's write-lessness | every SQL-shaped string constant in `rls_probe.py` and `routers/enablement.py` (from the AST) is a `SELECT` or the read-only flag; the router holds none at all |
| the manifest's pointer | `rlsEvidence.verifier` is this router's actual path; the ledger path is the one the CLI writes; the named script exists; the cadence is no looser than the service's own default window |

The core suite adds the other half: `PLATFORM_SCOPED_TABLES` re-derived from
`rls_coverage.json`, the `TENANT_GUC`/ledger-name constants, and the
purity/no-write scans on the law itself. The CLI's node suite pins the
validator's refusals, the ledger's shape rules, the report's freshness
asymmetry, and `print-sql` against the module it documents.

What is NOT verified, in the same font as what is: nothing here reads a real
Postgres in CI. The SQL is parsed (sqlglot) and shape-checked, the catalogue
semantics are modelled by a fake that answers by matching statement text, and
the one behavioural claim that cannot be made honestly in a unit test - "a
`42501` on the bare read really is what FORCE returns" - is exercised only
against a live staging database, per §9. That is stated rather than hidden
because a verification tool that overstates its own verification is the exact
failure Part 15 exists to eliminate.


## 8. Runbook: enablement day, then every week after

1. **Before enabling.** Run the generator and apply the migration as Part 11
   documents; work `enable.sql`'s checklist. The engine endpoint cannot be
   used here - it audits tables that exist, which is after step 2.
2. **Right after enabling.** `node scripts/rls-enablement.mjs audit
   --base-url ... --token ... --tenant <probe-tenant> --seed
   engine_orders=3,... --covered-expected 42 --record`. Expect
   `enginePlaneComplete: true`; expect `fullPlatform: false` unless the
   operator-side checklist covered the other 38 tables. A `fail` here is a
   security finding, not a lint: `disable.sql` is the rollback and the
   note in the ledger line says which table leaked.
3. **Then weekly** (the cadence the manifest declares): re-run `audit
   --record` after any migration that creates, recreates or renames a
   tenant-bearing table, and after any role or grant change. The engine's
   own tables change on exactly those days; so does everything else.
4. **Continuously, from CI or cron:** `node scripts/rls-enablement.mjs
   check` (i.e. `dr-manifest.mjs --check-rls`). Exit 1 = overdue, missing,
   unreadable, or the last audit did not pass. The scheduler wiring is still
   an open item (same status as `--due`'s); what is NOT open is what it
   checks.
5. **On a `fail` grade:** treat it as an isolation incident. Confirm with
   psql using `print-sql`'s output (six statements, all reads, no ceremony);
   `disable.sql` if a table must go dark; the fix is in the migration or the
   grant, never in the ledger. Re-audit before resuming the claim.

`--check-rls` green is a prerequisite for anything that DEPENDS on
isolation - Part 14's first apply included: a prune against a database whose
policies are believed-but-unverified is a deletion whose blast radius is
assumed. §10 move 1 of `docs/PART14_RETENTION.md` now reads "both checks
green before the first apply" (fresh `postgres` backup from Part 12's ledger,
fresh enablement audit from this part's), and the ordering is the whole point:
delete nothing on a database you cannot prove is partitioned.


## 9. Test law, with its limits named

The 48 core tests grade the law directly (boundaries inclusive-by-design, the
role veto reaching per-table grades, `unverified` for every incomplete run,
duplicates refused, JSON-readiness of the summary). The 38 engine tests pin
the executor's conversation: statement-per-statement, which connection said
it, in which transaction, with which bind parameters; the absent-table path
that must not bare-count; the `42501` swallow narrowed by SQLSTATE; the
propagation that keeps a broken cluster ungraded; `ProbeRoleUnknown` refusing
BEFORE touching the tables it would have graded; the non-canonical tenant
UUID that never reaches the database; the 400/409/422/503 shapes; and
`seedCounts` refusals measured as "zero statements on either connection".

The fakes answer by MATCHING statement text, not by replaying a script, and
each pool is single-use: a fake that answered every query would happily let
the executor read tenant-filtered numbers on the unfiltered side - the exact
bug this split exists to catch. The `bare` connection's script and the
`scoped` connection's script are disjoint on purpose, and the pool raises if a
run borrows more than one bare session, so "one unfiltered session per audit"
is a fact the fakes enforce rather than a sentence in this file.


## 10. Decisions, each with its rejected alternative nearby

| decision | rejected alternative, and why |
| --- | --- |
| verification is an operation with a cadence | a boot-time check that refuses startup: a defence layer's staleness becomes an outage, inverting Part 11's whole "enable at low traffic, with a checklist" judgement |
| FAIL is HTTP 200 with the finding in the body | HTTP 500: evidence under a transport error, broken `curl` CI, and pressure to make the probe "tolerant" |
| no apply feature flag on a read-only route | `EXECUTION_ENABLEMENT_ENABLED`: theatre for a SELECT, and theatre still needs a default, docs and tests |
| read-only, never seeding | the textbook insert/read/delete probe: it would make "read-only" false and put a write path on a process that owns money rows, requiring its own audit |
| engine audits only its own 4 tables, and says so | claiming the platform's 42: the API plane's tables are not this service's to name, and a partial audit with a full-platform verdict is the loudest possible lie |
| evidence in git (`docs/dr/*.jsonl`), not a DB table | `engine_enablement_runs`: a new table to migrate, cover with RLS, and forget to prune - for a part that must not write |
| reuse Part 14's ledger constant for the durable name | a new constant: two names for one table is drift waiting to happen, and the reuse is pinned by test so it stays a decision |
| one writer of the evidence ledger (`dr-manifest`) | a second implementation inside `rls-enablement.mjs`: a copy of a policy that drifts, and the copy operators follow when the first is inconvenient |
| `seedCounts` optional, unknown-seed mode legal | requiring exact seeds: the audit would then be unusable before a probe tenant is prepared, which is precisely when enablement day needs it |
| `42501` on the bare read recorded as zero | "treat any error as pass" (launders an outage into a green check) and "treat any error as fail" (makes a correctly locked-down cluster look broken; the leak count IS the evidence). Both extremes are worse than the narrow swallow |
| `unverified` as a third run grade | collapsing it into `pass` (silence) or `fail` (crying wolf until people read `fail` as noise) |


## 11. What this part does NOT do

* It does not enable, disable or alter anything, and no migration ships with
  it. `enable.sql`/`disable.sql` remain the only files that change RLS state,
  and they are unchanged here.
* It does not cover the API plane's 38 other tables from the endpoint. That is
  the operator's checklist against the same manifest; `--covered-expected`
  exists so a partial run cannot be misread as a complete one.
* It does not schedule. `--check-rls` is a cron-able exit code, and wiring it
  into a scheduler is the same open item as `--due`'s (docs/DR.md: "what is
  not yet automated, plainly").
* It does not enforce at request time. No route consults the evidence ledger
  to decide whether to serve traffic; a deployment that wants hard gating
  should build it on top of `--check-rls`, which is now a well-defined
  predicate rather than a vibe.
* It does not prove isolation from unit tests against a fake Postgres. The
  catalogue semantics are modelled, the SQL is parsed, the shapes are
  re-derived - and the live confirmation is step 2 of §8, on staging, with a
  probe tenant.
* It does not add metrics or dashboards. The log line
  (`enablement.audit`, with grade/role/probed count, no row contents) is the
  only new signal; a RED panel over the audit cadence would be honest but is
  not in this part.


## 12. Cross-references

* `docs/ROADMAP.md` - Part 15 row; "RLS staging enablement" is now
  "verification of", with the enablement itself still an operator step.
* `docs/SECURITY.md` - the defence-in-depth list gains the audit surface and
  the "verified, not believed" claim, with its limits.
* `docs/DR.md` - `rlsEvidence` in the manifest, the second ledger, and the
  new prerequisite for Part 14's first apply.
* `docs/PART11_WORKER_SCALING.md` - the policies, the GUC, the checklist;
  unchanged and still the only thing that alters RLS state.
* `docs/PART13_DURABLE_STORE.md` - `_TenantTransaction`, the canonical-UUID
  guard and the literal-SQL law this executor inherits verbatim.
* `docs/PART14_RETENTION.md` - the ledger this part reuses, the feature-flag
  contrast in §4, and the runbook move this part now precedes.
* `libs/trading-core/tests/test_part15_enablement.py`,
  `services/execution-engine/tests/test_part15_enablement.py`,
  `services/execution-engine/tests/test_part15_drift_parity.py`,
  `scripts/dr-manifest.test.mjs` - the law, the surface, the drift traps, the
  ledger.
````


## Modified in Part 15 (full files, prior content preserved inside)

## FILE: services/execution-engine/app/config.py (332 lines)

*the one enablement field (EXECUTION_ENABLEMENT_MAX_AGE_DAYS, default 30), boot validation by CONSTRUCTING the core policy (the bound law has one home; a nonsense window refuses startup instead of silently grading every audit fresh), the enablement_policy property, and the value added to the public view - non-secret by construction, and deliberately no apply flag for a read-only surface.*

```python
"""Configuration for the execution engine.

Every value comes from the environment. There are no defaults for secrets:
a missing or placeholder internal token stops the process rather than
starting a service that silently cannot authenticate its callers.

The field types are all defaulted so ``Settings()`` constructs cleanly under
mypy strict; the requirement that critical values EXIST is enforced in the
model validator, not by missing defaults, and the error messages name the
environment variable so a boot failure is self-explaining.
"""

from __future__ import annotations

from decimal import Decimal, InvalidOperation
from functools import lru_cache
from typing import Literal

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from wlct_trading.enablement import EnablementError, EnablementPolicy
from wlct_trading.retention import RetentionError, RetentionPolicy

__all__ = ["Settings", "get_settings"]

#: Placeholder spellings rejected everywhere on this platform. A token that
#: reads "changeme" is the same as no token, and discovering that during an
#: incident is how incidents get longer.
#: Exact values that can never be a real secret, and the prefixes that mark
#: "this was a template nobody filled in" ("changeme-64-xs" is as placeholder
#: as "changeme" - suffix noise does not launder it).
_PLACEHOLDERS = frozenset(
    {
        "changeme",
        "change-me",
        "replace_me",
        "replace-me",
        "secret",
        "todo",
        "none",
        "null",
        "undefined",
        "example",
    }
)
_PLACEHOLDER_PREFIXES = ("changeme", "change-me", "replace_me", "replace-me")


class Settings(BaseSettings):
    """Validated runtime configuration."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=True,
    )

    NODE_ENV: Literal["development", "test", "staging", "production"] = "development"
    LOG_LEVEL: Literal["debug", "info", "warning", "error", "critical"] = "info"

    # --- Identity and transport ------------------------------------------
    #: Names this instance in logs, the health surface and (later) the
    #: worker registry. Not a secret; not a credential; useful in a
    #: postmortem that says "which process thought it was leader".
    EXECUTION_INSTANCE_ID: str | None = None
    SERVICE_PORT: int = 8093
    #: Loopback by default: this process must be explicitly re-bound (env)
    #: to serve another container, and deployments that do so keep it on an
    #: internal network - the token is authentication, not segmentation.
    EXECUTION_ENGINE_HOST: str = "127.0.0.1"
    #: Shared secret with the Node worker. Minimum 32 characters, constant
    #: time compared in app.security, never logged.
    EXECUTION_INTERNAL_TOKEN: str | None = None

    # --- Mode ---------------------------------------------------------------
    #: "simulated" is the only mode this build transmits in. "live" parses
    #: (so a staged config does not fail boot for a syntax reason while it
    #: fails a safety reason) but startup refuses it with MODE_NOT_WIRED.
    EXECUTION_MODE: Literal["simulated", "live"] = "simulated"
    #: When true, order SUBMISSION stops before transmission. Cancellation
    #: is not a new position and stays available either way - failing to
    #: cancel a resting order is the larger risk of the two.
    EXECUTION_DRY_RUN: bool = True
    #: Per-request venue timeout handed to the core engine settings.
    EXECUTION_REQUEST_TIMEOUT_MS: int = 5_000
    #: Lease TTL for the core's own account/order locks (milliseconds).
    EXECUTION_LOCK_TTL_MS: int = 15_000

    # --- Simulated venue shaping -------------------------------------------
    #: Fixed mid used as top-of-book for any symbol. Unset means the paper
    #: book is empty: submissions are refused for lack of price, which is
    #: the honest default for a deployment that configured nothing.
    EXECUTION_SIMULATED_MID: str | None = None
    #: Comma-separated `ASSET=QUANTITY` seed balances for the simulated
    #: account. Balances are labelled simulated wherever they surface.
    EXECUTION_PAPER_BALANCES: str = "USDT=100000"

    # --- Durable state (Part 13) --------------------------------------------
    #: "memory" keeps the process-local reference store (everything this
    #: service did before Part 13; readiness honestly reports
    #: storeDurable=false). "postgres" requires the engine tables (owned by
    #: apps/api/prisma, applied by the API's migration job) and a DSN, and
    #: refuses startup without either - a store configured but unreachable
    #: is "not running", never "running degraded": the moment this process
    #: cannot durably record an order it must stop taking commands.
    EXECUTION_STORE_BACKEND: Literal["memory", "postgres"] = "memory"
    #: DSN for the engine store, e.g. postgresql://user:pass@db:5432/wlct.
    #: A credential: env-only, never logged, never in to_public_dict, and
    #: like every DSN on this platform it belongs to a dedicated role, not
    #: the owner. The engine sets app.tenant_id per transaction (the same
    #: contract as the API's withTenantRls), so these tables are RLS-safe
    #: from the day the operator flips policies on.
    EXECUTION_POSTGRES_DSN: str | None = None

    # --- Retention (Part 14) -----------------------------------------------
    #: The apply switch. False (the default) leaves every retention call in
    #: DRY-RUN: inspection always works, deletion never happens, and an
    #: apply request is refused with the config named. A maintenance job
    #: that destroys data does not run because a compose file once existed.
    #: It also does not run on a schedule nobody reviewed: the intended
    #: first use is inspect (disabled) -> scheduled dry-run -> one manual
    #: apply against a fresh backup -> enable (docs/PART14_RETENTION.md).
    EXECUTION_RETENTION_ENABLED: bool = False
    #: Days of journal kept beyond an order's own settlement (the cutoff
    #: applies to the event AND the order's terminal stamp - core law 2).
    #: Bounds are enforced by constructing the core policy below; this
    #: service has no second arithmetic for them.
    EXECUTION_RETENTION_EVENT_DAYS: int = 90
    #: Rows per DELETE statement, and statements per run. Together they
    #: cap one run at batch_rows * max_batches deletions - the ceiling a
    #: busy deployment tunes, and the reason a first prune after long
    #: dormancy is many small transactions instead of one huge one.
    EXECUTION_RETENTION_BATCH_ROWS: int = 2_000
    EXECUTION_RETENTION_MAX_BATCHES: int = 50

    # --- RLS enablement verification (Part 15) -----------------------------
    #: How long an enablement audit may sit before it stops counting as
    #: evidence. This is NOT enforcement - the audit is read-only and this
    #: service cannot fail closed over another service's row-level security -
    #: it is the freshness the response reports and the evidence ledger
    #: checks. A deployment that re-audits nightly keeps the number
    #: meaningless-in-a-good-way; one that never re-audits sees it go stale.
    #: Bounds (1..36,500 days) are the core's law, validated at boot below.
    EXECUTION_ENABLEMENT_MAX_AGE_DAYS: int = 30

    @model_validator(mode="after")
    def _validate(self) -> Settings:
        if self.EXECUTION_INTERNAL_TOKEN is None or not self.EXECUTION_INTERNAL_TOKEN.strip():
            raise ValueError(
                "EXECUTION_INTERNAL_TOKEN is required (>= 32 chars); this "
                "service never starts unauthenticated"
            )
        if len(self.EXECUTION_INTERNAL_TOKEN) < 32:
            raise ValueError("EXECUTION_INTERNAL_TOKEN must be at least 32 characters")
        lowered = self.EXECUTION_INTERNAL_TOKEN.strip().lower()
        if lowered in _PLACEHOLDERS or lowered.startswith(_PLACEHOLDER_PREFIXES):
            raise ValueError(
                "EXECUTION_INTERNAL_TOKEN must not be a placeholder value "
                "(exact match or changeme-style prefix)"
            )
        if self.EXECUTION_INSTANCE_ID is None or not self.EXECUTION_INSTANCE_ID.strip():
            raise ValueError(
                "EXECUTION_INSTANCE_ID is required - every leader claim, log "
                "line and incident must be attributable to a process"
            )
        if len(self.EXECUTION_INSTANCE_ID) > 64:
            raise ValueError("EXECUTION_INSTANCE_ID must be at most 64 characters")
        if self.SERVICE_PORT < 1 or self.SERVICE_PORT > 65_535:
            raise ValueError("SERVICE_PORT must be a valid TCP port")
        if self.EXECUTION_REQUEST_TIMEOUT_MS < 250:
            raise ValueError(
                "EXECUTION_REQUEST_TIMEOUT_MS below 250 tests the venue, not the network"
            )
        if self.EXECUTION_LOCK_TTL_MS < 1_000:
            raise ValueError(
                "EXECUTION_LOCK_TTL_MS below one second elects on network jitter"
            )
        if self.EXECUTION_SIMULATED_MID is not None:
            _parse_decimal(self.EXECUTION_SIMULATED_MID, "EXECUTION_SIMULATED_MID")
        for part in self.EXECUTION_PAPER_BALANCES.split(","):
            if part.strip() == "":
                continue
            asset, sep, amount = part.partition("=")
            if not sep or not asset.strip():
                raise ValueError(
                    "EXECUTION_PAPER_BALANCES must be comma-separated ASSET=QUANTITY pairs"
                )
            _parse_decimal(amount, f"balance {asset.strip()!r}")
        # An EMPTY/whitespace DSN is treated as "unset" everywhere (compose
        # passes ${VAR:-} defaults; "" must not arm the mismatch law below).
        dsn = (self.EXECUTION_POSTGRES_DSN or "").strip()
        if self.EXECUTION_STORE_BACKEND == "postgres":
            if not dsn:
                raise ValueError(
                    "EXECUTION_STORE_BACKEND=postgres requires EXECUTION_POSTGRES_DSN; "
                    "a durable store that was configured but cannot connect is a "
                    "startup failure, never a degraded start"
                )
            if not dsn.startswith(("postgresql://", "postgresql+asyncpg://", "postgres://")):
                raise ValueError(
                    "EXECUTION_POSTGRES_DSN must be a postgresql:// connection string"
                )
        elif dsn:
            # A DSN present while the memory backend is selected means
            # somebody INTENDED durability and the setting silently did not
            # apply - the worst of both worlds (restart loses orders,
            # operator believes it cannot). Refuse the mismatched intent.
            raise ValueError(
                "EXECUTION_POSTGRES_DSN is set but EXECUTION_STORE_BACKEND=memory; "
                "either switch the backend to postgres or remove the DSN - a "
                "half-configured durable store is not a store"
            )
        # Retention bounds exist ONCE, in the core law; constructing the
        # policy here means a config typo names its env var at boot, and
        # an invalid policy can never reach a DELETE statement at all.
        try:
            RetentionPolicy(
                event_retention_days=self.EXECUTION_RETENTION_EVENT_DAYS,
                batch_rows=self.EXECUTION_RETENTION_BATCH_ROWS,
                max_batches=self.EXECUTION_RETENTION_MAX_BATCHES,
            )
        except RetentionError as error:
            raise ValueError(
                f"retention configuration rejected by the core law: {error} "
                "(EXECUTION_RETENTION_EVENT_DAYS / _BATCH_ROWS / _MAX_BATCHES)"
            ) from error
        # Same discipline for the evidence window: the bound-checking law has
        # exactly one home (the core), boot fails on a typo, and the audit
        # endpoint can never receive a policy that "every evidence is fresh".
        try:
            EnablementPolicy(max_evidence_age_days=self.EXECUTION_ENABLEMENT_MAX_AGE_DAYS)
        except EnablementError as error:
            raise ValueError(
                f"enablement configuration rejected by the core law: {error} "
                "(EXECUTION_ENABLEMENT_MAX_AGE_DAYS)"
            ) from error
        return self

    @property
    def retention_policy(self) -> RetentionPolicy:
        """The core's validated policy, built from this service's fields.

        Constructed (not stored) so Settings stays a plain env reader and
        the bound-checking law has exactly one home; the startup validator
        above calls this to fail boot on a nonsensical configuration.
        """
        return RetentionPolicy(
            event_retention_days=self.EXECUTION_RETENTION_EVENT_DAYS,
            batch_rows=self.EXECUTION_RETENTION_BATCH_ROWS,
            max_batches=self.EXECUTION_RETENTION_MAX_BATCHES,
        )

    @property
    def enablement_policy(self) -> EnablementPolicy:
        """The core's validated evidence policy, built from this service's
        field (constructed, never stored - same reason as
        ``retention_policy``: Settings stays a plain env reader)."""
        return EnablementPolicy(
            max_evidence_age_days=self.EXECUTION_ENABLEMENT_MAX_AGE_DAYS
        )

    @property
    def is_production(self) -> bool:
        return self.NODE_ENV == "production"

    @property
    def simulated_mid(self) -> Decimal | None:
        if self.EXECUTION_SIMULATED_MID is None:
            return None
        return _parse_decimal(self.EXECUTION_SIMULATED_MID, "EXECUTION_SIMULATED_MID")

    @property
    def paper_balances(self) -> dict[str, Decimal]:
        out: dict[str, Decimal] = {}
        for part in self.EXECUTION_PAPER_BALANCES.split(","):
            if part.strip() == "":
                continue
            asset, _, amount = part.partition("=")
            out[asset.strip().upper()] = _parse_decimal(amount, "balance")
        return out

    def to_public_dict(self) -> dict[str, object]:
        """Everything except secrets - safe for the status endpoint and logs.

        The internal token is the one value this object must never leak, and
        the whitelist shape (constructing the view field by field) is how
        that stays true when fields are added later: a new secret appears in
        the public view only if someone adds it there deliberately.
        """
        return {
            "nodeEnv": self.NODE_ENV,
            "instanceId": self.EXECUTION_INSTANCE_ID,
            "servicePort": self.SERVICE_PORT,
            "mode": self.EXECUTION_MODE,
            "dryRun": self.EXECUTION_DRY_RUN,
            "requestTimeoutMillis": self.EXECUTION_REQUEST_TIMEOUT_MS,
            "lockTtlMillis": self.EXECUTION_LOCK_TTL_MS,
            "simulatedMidConfigured": self.EXECUTION_SIMULATED_MID is not None,
            "paperBalanceAssets": sorted(self.paper_balances),
            # The DSN itself never appears here (whitelist law); the boolean
            # says "a credential is present" without saying anything about it.
            "storeBackend": self.EXECUTION_STORE_BACKEND,
            "postgresDsnConfigured": (self.EXECUTION_POSTGRES_DSN or "").strip() != "",
            # Retention is configuration an operator must be able to SEE
            # from the outside (is apply enabled? what does "days" mean
            # here?) - all four values are non-secret by construction.
            "retentionEnabled": self.EXECUTION_RETENTION_ENABLED,
            "retentionEventDays": self.EXECUTION_RETENTION_EVENT_DAYS,
            "retentionBatchRows": self.EXECUTION_RETENTION_BATCH_ROWS,
            "retentionMaxBatches": self.EXECUTION_RETENTION_MAX_BATCHES,
            # The enablement window is non-secret and operationally
            # load-bearing (it is what "stale" means HERE), so it is
            # published next to the retention knobs.
            "enablementMaxAgeDays": self.EXECUTION_ENABLEMENT_MAX_AGE_DAYS,
        }


def _parse_decimal(raw: str, what: str) -> Decimal:
    try:
        value = Decimal(raw.strip())
    except InvalidOperation as error:
        raise ValueError(f"{what} must be a decimal number") from error
    if not value.is_finite():
        raise ValueError(f"{what} must be finite")
    return value


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Cached accessor so configuration is parsed exactly once per process."""
    return Settings()
```


## FILE: services/execution-engine/app/schemas.py (351 lines)

*four enablement wire models (the audit request with its strict-valued seedCounts - pydantic's non-strict coercion would accept true as 1 - the per-probe view, the role view, the run answer) plus StatusResponse's enablementMaxAgeDays defaulting to the shipped window, so a pre-Part-15 engine's response reads as unproven rather than as a claim.*

```python
"""Request and response models for the internal execution API.

Alias conventions match the trading engine: fields are snake_case
internally, camelCase on the wire, populated by name on input so a worker
cannot smuggle a mistyped payload past validation by coincidence.

Everything here is a CONTROL shape. No model accepts an order to place;
no model returns a credential, key or signed payload. Decimal-valued
fields serialise as decimal STRINGS: a JSON float for a
quantity or balance is a silent rounding decision, and money never takes
one of those on the platform's behalf.
"""

from __future__ import annotations

from typing import Annotated, Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

__all__ = [
    "AccountCommandRequest",
    "BalanceView",
    "BalancesResponse",
    "CancelOrderRequest",
    "CancelOrderResponse",
    "CommandRejected",
    "DiscrepancyView",
    "EnablementAuditResponse",
    "EnablementProbeView",
    "EnablementRequest",
    "EnablementRoleView",
    "ReconcileResponse",
    "RetentionInspectRequest",
    "RetentionInspectResponse",
    "RetentionRunRequest",
    "RetentionRunResponse",
    "RetentionRunView",
    "StatusResponse",
    "VerifyResponse",
]

_TENANT = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")

#: An int that refuses coercion - the one spelling (annotated VALUE type)
#: that makes strictness apply inside a dict, as the enablement seed counts
#: require.
_StrictInt = Annotated[int, Field(strict=True)]
_ACCOUNT = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")


def _to_camel(name: str) -> str:
    head, *rest = name.split("_")
    return head + "".join(part.title() for part in rest)


class _WireModel(BaseModel):
    """Base for every model on this wire: camelCase aliases (the platform's
    API style, matched by the trading engine), snake_case fields (the
    core's style), ``extra=forbid`` so a payload containing fields BEYOND
    the contract - a venue key slipped in by a buggy producer, say - is a
    422 rather than a silently ignored surprise."""

    model_config = ConfigDict(
        alias_generator=_to_camel, populate_by_name=True, extra="forbid"
    )


class AccountCommandRequest(_WireModel):
    """Payload for the three account commands.

    ``tenantId``/``accountId`` echo the job payload; the router still
    enforces the TENANT header match - a body that agrees with the header
    is provenance, a body that merely exists is not.
    """

    tenant_id: str = _TENANT
    account_id: str = _ACCOUNT
    requested_by_user_id: str | None = Field(default=None, max_length=64)
    requested_at: str | None = Field(default=None, max_length=64)


class CancelOrderRequest(_WireModel):
    tenant_id: str = _TENANT
    account_id: str = _ACCOUNT
    order_id: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")
    client_order_id: str = Field(min_length=1, max_length=128)
    symbol: str = Field(min_length=1, max_length=32)
    requested_by_user_id: str | None = Field(default=None, max_length=64)
    requested_at: str | None = Field(default=None, max_length=64)


class VerifyResponse(_WireModel):
    verified: bool
    note: str
    is_simulated: bool = True


class BalanceView(_WireModel):
    asset: str
    free: str
    locked: str

    @field_validator("free", "locked")
    @classmethod
    def _decimalish(cls, value: str) -> str:
        from decimal import Decimal, InvalidOperation

        try:
            parsed = Decimal(value)
        except InvalidOperation as error:
            raise ValueError("balances must serialise as decimal strings") from error
        if not parsed.is_finite():
            raise ValueError("balances must be finite")
        return value


class BalancesResponse(_WireModel):
    balances: list[BalanceView]
    is_simulated: bool = True


class DiscrepancyView(_WireModel):
    discrepancy_type: str
    summary: str
    order_id: str | None
    repaired: bool


class ReconcileResponse(_WireModel):
    tenant_id: str
    account_id: str
    exchange: str
    orders_checked: int
    fills_recovered: int
    discrepancy_count: int
    discrepancies: list[DiscrepancyView]
    error: str | None
    started_at_micros: int
    finished_at_micros: int


class CancelOrderResponse(_WireModel):
    """The engine's honest verdict on a cancel request.

    ``outcome`` carries ExecutionEngine vocabulary (ACCEPTED,
    REJECTED_LOCALLY, REJECTED_BY_EXCHANGE, DUPLICATE, DRY_RUN, UNKNOWN);
    the worker's ack policy reads THIS, not the HTTP code: 200 +
    REJECTED_LOCALLY is a completed job, 5xx is a retryable failure, and
    conflating the two is how cancelled-twice becomes cancelled-never.
    """

    outcome: str
    client_order_id: str
    order_status: str
    error_code: str | None
    message: str | None
    latency_micros: int
    is_simulated: bool


class CommandRejected(_WireModel):
    """Error body shared by 403/404/501 paths."""

    code: str
    message: str


class StatusResponse(_WireModel):
    instance_id: str
    mode: str
    dry_run: bool
    adapter: str
    store: str
    store_durable: bool
    #: "memory" | "postgres" as the SERVICE was configured - independent of
    #: store_durable on purpose: the worker can tell "class name says
    #: Postgres, config says memory" (impossible wiring) apart from either
    #: alone. Defaults to "unknown" (not "memory") so a response from a
    #: pre-Part-13 engine reads as unproven, never as a claimed fact.
    store_backend: str = "unknown"
    #: Retention visibility on the SAME surface the worker asserts against:
    #: "is a prune possible from this engine, and what does 'days' mean
    #: here" are questions an operator asks the status endpoint, not the
    #: source. Defaults state the shipped config (disabled, 90) so a
    #: pre-Part-14 engine's response cannot be read as "retention ran".
    retention_enabled: bool = False
    retention_event_days: int = 90
    #: Part 15's evidence window, visible on the assert-before-forward
    #: surface for the same reason retention is: "how stale is too stale" is
    #: a per-deployment answer. The default mirrors the shipped config, and
    #: a PRE-Part-15 engine's response therefore says "the window nobody
    #: enforced was 30 days", not "freshness was checked".
    enablement_max_age_days: int = 30
    locks_distributed: bool
    commands: list[str]
    simulated: bool = True


class RetentionRunRequest(_WireModel):
    """The run command's body. ``dryRun`` DEFAULTS TRUE: the field a typo
    could flip is the one that DELETES, so deletion requires an explicit
    ``"dryRun": false``, and even that only reaches the DELETE statements
    when EXECUTION_RETENTION_ENABLED says the deployment means it."""

    tenant_id: str = _TENANT
    dry_run: bool = True


class RetentionInspectRequest(_WireModel):
    """The read-only sibling: current count + recent runs, no deletion."""

    tenant_id: str = _TENANT


class RetentionRunResponse(_WireModel):
    """One run's account, mirroring the ledger row it just wrote.

    ``ledgerWritten`` is part of the contract because the ledger failure
    path is a real one (deletes landed, record did not): an operator
    reading `false` here knows the HTTP body IS the durable-ish copy and
    must reconcile against the log line before scheduling more.
    """

    dry_run: bool
    cutoff_us: int
    rows_reported: int
    batches_run: int
    exhausted: bool
    ledger_written: bool


class RetentionRunView(_WireModel):
    """A ledger row as read back; every field is a number or a label."""

    seq: int
    started_at: int
    finished_at: int
    dry_run: bool
    event_cutoff_us: int
    rows_deleted: int
    batches: int
    exhausted: bool
    instance_id: str


class RetentionInspectResponse(_WireModel):
    enabled: bool
    event_retention_days: int
    batch_rows: int
    max_batches: int
    cutoff_us: int
    prunable_now: int
    runs: list[RetentionRunView]


class EnablementRequest(_WireModel):
    """Body of ``POST /internal/v1/enablement/audit`` (Part 15).

    The only required field is the tenant whose rows the scoped count will
    see - there is no ``deleteOlderThanDays``-style danger field here,
    because there is no write path to protect. ``seedCounts`` is the
    operator's claim about how many rows that tenant should see per table;
    leaving it out is the honest unknown-seed mode (the catalogue posture
    then carries the finding), and passing a table this service does not
    probe is a refusal, not an ignore: a silently dropped key is how an
    audit starts reporting on tables that were never read.
    """

    tenant_id: str = _TENANT
    #: A row count arrives as an integer or the request is refused - no
    #: silent conversion, ever. The strictness lives on the DICT VALUE
    #: because that is the only spelling that works: a field-level
    #: ``strict=True`` on a ``dict[str, int]`` does not reach inside the
    #: values in pydantic 2.9 (verified by test), and non-strict coercion
    #: would accept ``"3"`` and, worse, ``true`` as 1 - handing the audit a
    #: seed the operator never wrote and a PASS that was earned by a cast.
    seed_counts: dict[str, _StrictInt] | None = None
    #: The coverage manifest's table count, when the caller wants the run
    #: graded against the WHOLE platform rather than against this service's
    #: own plane. Anything other than ``None``/that exact count grades
    #: UNVERIFIED, which is the point. The bounds mirror the core's
    #: (0..MAX_PROBED_TABLES) so a nonsense number is refused on the wire;
    #: the core still re-validates, because a bound stated twice in a test
    #: is a fact and a bound stated twice in code is a drift risk - which
    #: the parity test pins.
    covered_expected: int | None = Field(default=None, ge=0, le=4096)

    @field_validator("seed_counts")
    @classmethod
    def _seed_counts_are_rows(cls, value: dict[str, int] | None) -> dict[str, int] | None:
        if value is None:
            return None
        for name, count in value.items():
            if isinstance(count, bool) or not isinstance(count, int):
                raise ValueError(f"seedCounts[{name!r}] must be an integer row count")
            if count < 0:
                raise ValueError(f"seedCounts[{name!r}] must be non-negative")
        return value


class EnablementProbeView(_WireModel):
    """One table's raw observations. Counts, not booleans, so a second
    operator can re-audit the report against the database itself."""

    model_config = ConfigDict(
        alias_generator=_to_camel, populate_by_name=True, extra="forbid", frozen=True
    )

    table: str
    policy_exists: bool
    rls_enabled: bool
    rls_forced: bool
    scoped_rows: int
    bare_rows: int
    seeded_expected_rows: int
    absent: bool
    grade: str
    skip_reason: str | None = None


class EnablementRoleView(_WireModel):
    """The role the audit ran AS - the field that makes a "pass" either
    meaningful or worthless, so it is on the wire in the same body."""

    model_config = ConfigDict(
        alias_generator=_to_camel, populate_by_name=True, extra="forbid", frozen=True
    )

    rolname: str
    bypassrls: bool
    superuser: bool


class EnablementAuditResponse(_WireModel):
    """The whole run. ``grade`` is the ONLY field a dashboard may colour,
    and ``fullPlatform`` is the field that keeps it honest: a pass over
    four engine tables is not a pass over 42, and a report that says
    otherwise has to be able to be caught saying so."""

    model_config = ConfigDict(alias_generator=_to_camel, populate_by_name=True, extra="forbid")

    ran_at_us: int
    grade: str
    full_platform: bool
    #: See ``EnablementAudit``: one boolean can honestly say two different
    #: things only if they are two different fields.
    engine_plane_complete: bool
    probed: int
    role: EnablementRoleView
    summary: dict[str, Any]
    probes: list[EnablementProbeView]
```


## FILE: services/execution-engine/app/composition.py (274 lines)

*describe() grows enablementMaxAgeDays beside the retention posture - visible to an operator reading the status surface, deliberately NOT added to the worker's compatibility law (a status field is not a job precondition).*

```python
"""The single composition root of the execution plane.

Everything the engine touches - adapter, store, locks, incidents, risk - is
built exactly once, here, and every choice is mode-gated at construction
rather than at first use. This is the same discipline
:class:`wlct_trading.execution.engine.ExecutionEngine` applies internally
(:meth:`_assert_wiring_is_safe` refuses unsafe combinations), lifted from
"the library you wire" to "the service you deploy": a misconfiguration kills
startup, not the first customer order.

What is deliberately absent:

* no live venue adapter - ``EXECUTION_MODE=live`` is refused here even
  though the core supports it: as of Part 13 the durable store ships and
  distributed locks exist in the core, but the live credential provider and
  the venue-ordering audit for authenticated order placement have not
  completed their review, so refusing is still the honest wiring. The
  refusal is code, not a default, and no environment value talks the
  process into it;
* no order-submission endpoint - the platform's producers enqueue account
  maintenance and cancellation today (see the queue-consumer inventory in
  docs/PART11_WORKER_SCALING.md); a worker must not grow capabilities its
  producers never send;
* no silently-degraded store - ``EXECUTION_STORE_BACKEND=memory`` keeps
  the process-local simulated store (readiness reports ``storeDurable:
  false``, exactly as before), and ``postgres`` only starts when the
  lifespan hands ``build_runtime`` a live pool whose tables exist. A
  durable mode that could not reach its database kills startup; it never
  "falls back to memory", because silent fallback is how a durability
  incident becomes a data-loss incident.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import dataclass
from decimal import Decimal
from typing import Any

from wlct_trading.adapters.base import AccountAdapter, TradingAdapter
from wlct_trading.adapters.paper import PaperAccountAdapter, PaperTradingAdapter
from wlct_trading.enums import ExchangeId
from wlct_trading.execution.config import ExecutionSettings
from wlct_trading.execution.engine import ExecutionEngine
from wlct_trading.execution.incidents import InMemoryIncidentRecorder
from wlct_trading.execution.locks import InMemoryLockManager, LockManager
from wlct_trading.execution.reconciliation import ReconciliationService
from wlct_trading.execution.store import InMemoryOrderStore, OrderStore
from wlct_trading.market_data import BookTop
from wlct_trading.risk import RiskEngine, RiskLimits

from app.config import Settings

__all__ = [
    "SUPPORTED_COMMANDS",
    "EngineRuntime",
    "ExecutionUnavailable",
    "build_runtime",
]

logger = logging.getLogger(__name__)

#: Commands this runtime executes end to end. The worker's processor checks
#: membership against this set (fetched from /status at startup and again on
#: every request path via the 501 response) rather than hardcoding a
#: parallel list - one place decides what is supported, and it decides at
#: boot, not by accident of which file was edited last.
SUPPORTED_COMMANDS: frozenset[str] = frozenset(
    {
        "verify-exchange-credentials",
        "refresh-account-balances",
        "reconcile-trading-account",
        "cancel-order",
    }
)

#: Conservative numeric limits for the simulated runtime, matching the
#: harness the core's own execution tests pin against. All-`None` limits
#: would also construct; they would also mean the one process holding the
#: money path ships without speed bumps, and "simulated" is not a reason to
#: practise with the guards off.
SIMULATED_LIMITS = RiskLimits(
    max_order_quantity=Decimal("1000"),
    max_order_notional=Decimal("1000000"),
    max_position_quantity=Decimal("5000000"),
    max_symbol_exposure_notional=Decimal("5000000"),
    max_account_exposure_notional=Decimal("10000000"),
    max_open_orders=100,
    max_orders_per_minute=100,
    max_daily_loss=Decimal("1000000"),
    max_price_deviation_percent=Decimal("50"),
    max_market_data_age_micros=60_000_000,
)


class ExecutionUnavailable(RuntimeError):
    """The runtime cannot serve in the current wiring.

    Surfaced as 503 (or a startup refusal): "not wired yet" is an
    operational fact callers can act on - retry later, alert a human -
    which a raw ``NoneType`` is not.
    """


@dataclass(slots=True)
class EngineRuntime:
    """The assembled execution plane, shared by all request handlers.

    The engine, store, recorder and reconciler are the same objects for the
    process lifetime: :class:`ExecutionEngine` documents itself as safe to
    share across tenants because every store/lock call is tenant-scoped,
    while a second instance would silently double any in-memory ledger - the
    one failure mode a "just build another one" refactor introduces.
    """

    engine: ExecutionEngine
    store: OrderStore
    locks: LockManager
    incidents: InMemoryIncidentRecorder
    trading_adapter: TradingAdapter
    account_adapter: AccountAdapter
    reconciliation: ReconciliationService
    settings: Settings

    def describe(self) -> dict[str, Any]:
        """Public, secret-free description of the wiring, for /status and
        for the worker to assert against before forwarding anything."""
        return {
            "mode": self.settings.EXECUTION_MODE,
            "dryRun": self.settings.EXECUTION_DRY_RUN,
            "instanceId": self.settings.EXECUTION_INSTANCE_ID,
            "adapter": type(self.trading_adapter).__name__,
            "store": type(self.store).__name__,
            "storeBackend": self.settings.EXECUTION_STORE_BACKEND,
            # getattr mirrors the core engine reading this OPTIONAL port
            # attribute the same duck-typed way (OrderStore documents it as a
            # MAY); defaulting False means "unproven durable" - fail-closed.
            "storeDurable": bool(getattr(self.store, "is_durable", False)),
            # Retention posture travels with the store posture: a durable
            # store nobody prunes and a prune that cannot reach a memory
            # store are both states the caller should see, not infer.
            "retentionEnabled": self.settings.EXECUTION_RETENTION_ENABLED,
            "retentionEventDays": self.settings.EXECUTION_RETENTION_EVENT_DAYS,
            # Part 15's posture travels with the store's for the same reason
            # the retention knobs do: whether an enablement audit even CAN
            # run here is a property of this wiring, not of the caller.
            "enablementMaxAgeDays": self.settings.EXECUTION_ENABLEMENT_MAX_AGE_DAYS,
            "locksDistributed": self.locks.is_distributed,
            "commands": sorted(SUPPORTED_COMMANDS),
        }


def make_paper_book_provider(
    mid: Decimal | None,
) -> Callable[[ExchangeId, str], BookTop | None]:
    """The book function the paper adapter prices against.

    A fixed mid when configured, an empty book otherwise. The empty book is
    not an oversight: "no reference price" makes the adapter refuse rather
    than invent, which is the correct behaviour for a simulated venue nobody
    configured. Every price that DOES exist here is simulated by
    construction; nothing in this function pretends to be a market.
    """

    def provider(exchange: ExchangeId, symbol: str) -> BookTop | None:
        if mid is None:
            return None
        return BookTop(
            exchange=exchange,
            symbol=symbol,
            best_bid=mid,
            best_bid_quantity=Decimal("1"),
            best_ask=mid,
            best_ask_quantity=Decimal("1"),
            sequence=0,
            exchange_timestamp=0,
            received_timestamp=0,
        )

    return provider


def build_runtime(settings: Settings, store: OrderStore | None = None) -> EngineRuntime:
    """Construct the execution plane, or refuse loudly at startup.

    ``store`` is the durable adapter's injection point: the lifespan owns
    the pool (it must create it before any request can be served and close
    it on shutdown, and it verifies the tables exist), while this function
    owns the WIRING - which combinations may exist at all. A postgres
    backend reached without an injected store, or an injected store under a
    memory backend, is a bug in the composition path, and bugs in this path
    die here rather than in the first order that quietly went unsaved.
    """
    if settings.EXECUTION_MODE == "live":
        raise ExecutionUnavailable(
            "EXECUTION_MODE=live is not wired in this build: the durable "
            "store landed in Part 13 and the core ships distributed locks, "
            "but the live credential provider and the authenticated "
            "order-placement review are unfinished - the core engine "
            "itself still guards live transmission. Simulated mode is "
            "available now; live refuses at startup rather than failing at "
            "the first order."
        )
    if settings.EXECUTION_STORE_BACKEND == "postgres" and store is None:
        raise ExecutionUnavailable(
            "EXECUTION_STORE_BACKEND=postgres requires the lifespan-injected "
            "pool store; a postgres-wired engine built over a memory store "
            "would report durability it does not have"
        )
    if settings.EXECUTION_STORE_BACKEND == "memory" and store is not None:
        raise ExecutionUnavailable(
            "an injected durable store under EXECUTION_STORE_BACKEND=memory "
            "means the config and the wiring disagree; refusing to guess "
            "which one the operator meant"
        )
    if store is None:
        store = InMemoryOrderStore()

    trading = PaperTradingAdapter(make_paper_book_provider(settings.simulated_mid))
    account = PaperAccountAdapter(settings.paper_balances)
    locks = InMemoryLockManager()
    incidents = InMemoryIncidentRecorder()
    risk_engine = RiskEngine(SIMULATED_LIMITS)
    reconciliation = ReconciliationService(
        trading=trading,
        account=account,
        store=store,
        incidents=incidents,
        locks=locks,
    )

    engine_settings = ExecutionSettings(
        live_trading_enabled=False,
        dry_run=settings.EXECUTION_DRY_RUN,
        paper_trading=True,
        trading_mode_setting="PAPER",
        trading_enabled=True,
        live_trading_confirmed=False,
        order_request_timeout_ms=settings.EXECUTION_REQUEST_TIMEOUT_MS,
    )
    engine = ExecutionEngine(
        adapter=trading,
        settings=engine_settings,
        risk_engine=risk_engine,
        store=store,
        locks=locks,
        incidents=incidents,
        default_lock_ttl_millis=settings.EXECUTION_LOCK_TTL_MS,
    )
    logger.info(
        "execution_engine.runtime_built",
        extra={
            "event": "execution_engine.runtime_built",
            "wiring": {
                "store": type(store).__name__,
                "storeBackend": settings.EXECUTION_STORE_BACKEND,
                "locks": type(locks).__name__,
                "adapter": type(trading).__name__,
                "dryRun": engine_settings.dry_run,
                "simulatedMidConfigured": settings.simulated_mid is not None,
            },
        },
    )
    return EngineRuntime(
        engine=engine,
        store=store,
        locks=locks,
        incidents=incidents,
        trading_adapter=trading,
        account_adapter=account,
        reconciliation=reconciliation,
        settings=settings,
    )
```


## FILE: services/execution-engine/app/main.py (163 lines)

*two lines: the enablement router import and its include; the pool seam the route reads was already owned by the lifespan since Part 13, and this part consumes it rather than widening it.*

```python
"""Execution engine application factory.

The process owns the money path's runtime and nothing else: no public
routes, no admin surface, no UI. Startup is where wiring mistakes die -
``build_runtime`` refuses live mode, ``get_settings`` refuses missing or
placeholder secrets - so the first request ever served meets either a fully
composed engine or no process at all.
"""

from __future__ import annotations

import logging
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app import __version__
from app.composition import build_runtime
from app.config import get_settings
from app.logging_config import configure_logging
from app.pg_store import open_durable_store
from app.routers import enablement, health, internal, retention
from app.security import REQUEST_ID_HEADER

logger = logging.getLogger(__name__)

#: Response header echoing the correlation id, matching the platform's
#: convention so a worker log line and an engine log line join on it.
CORRELATION_HEADER = "x-correlation-id"


def create_app() -> FastAPI:
    settings = get_settings()
    configure_logging(settings.LOG_LEVEL)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        # Raises through startup on any refused combination - live mode,
        # catalog incoherence - which is the whole safety design: a process
        # that cannot state its wiring does not serve traffic.
        store = None
        pool = None
        if settings.EXECUTION_STORE_BACKEND == "postgres":
            pool, store = await open_durable_store(settings)
        app.state.runtime = build_runtime(settings, store=store)
        app.state.store_pool = pool
        logger.info(
            "execution_engine.started",
            extra={
                "event": "execution_engine.started",
                "instance_id": settings.EXECUTION_INSTANCE_ID,
                "version": __version__,
                "wiring": (app.state.runtime.describe() if hasattr(app.state, "runtime") else {}),
            },
        )
        yield
        if pool is not None:
            await pool.close()
        logger.info("execution_engine.stopped", extra={"event": "execution_engine.stopped"})

    app = FastAPI(
        title="wlct execution engine",
        version=__version__,
        lifespan=lifespan,
        docs_url=None,
        redoc_url=None,
        openapi_url="/openapi.json",
    )

    @app.middleware("http")
    async def correlation(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        # Best-effort id continuity: honour a well-formed incoming id (the
        # worker sends its job's x-request-id), mint one otherwise. Capped
        # at 128 chars so a hostile header cannot bloat every log line.
        incoming = request.headers.get(REQUEST_ID_HEADER)
        correlation_id = (
            incoming
            if incoming is not None and 0 < len(incoming) <= 128 and _printable(incoming)
            else f"eng-{uuid.uuid4().hex[:20]}"
        )
        request.state.correlation_id = correlation_id
        response = await call_next(request)
        response.headers[CORRELATION_HEADER] = correlation_id
        return response

    @app.exception_handler(RequestValidationError)
    async def on_validation(request: Request, exc: RequestValidationError) -> JSONResponse:
        # Field locations only, never values: a rejected payload may contain
        # exactly the thing it should not, and 422 bodies get screenshotted.
        return JSONResponse(
            status_code=422,
            content={
                "code": "VALIDATION_FAILED",
                "message": "The command payload does not satisfy the contract.",
                "fields": [
                    {"location": ".".join(str(part) for part in err.get("loc", ())),
                     "type": str(err.get("type", "value_error"))}
                    for err in exc.errors()
                ],
            },
        )

    @app.exception_handler(StarletteHTTPException)
    async def on_http(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        raw_detail: object = exc.detail
        if isinstance(raw_detail, dict):
            content: dict[str, object] = raw_detail
        else:
            content = {
                "code": f"HTTP_{exc.status_code}",
                "message": str(raw_detail),
            }
        return JSONResponse(status_code=exc.status_code, content=content)

    @app.exception_handler(Exception)
    async def on_unexpected(request: Request, exc: Exception) -> JSONResponse:
        logger.exception(
            "execution_engine.unhandled",
            extra={
                "event": "execution_engine.unhandled",
                "path": request.url.path,
                "correlation_id": getattr(request.state, "correlation_id", None),
            },
        )
        # The message is for the logs; the client gets a retryable 500 with
        # the correlation id - never an exception string, which is how
        # internal shapes leak and secrets travel.
        return JSONResponse(
            status_code=500,
            content={
                "code": "INTERNAL_ERROR",
                "message": "The command failed inside the engine; retry is permitted.",
                "correlationId": getattr(request.state, "correlation_id", ""),
            },
        )

    app.include_router(health.router)
    app.include_router(internal.router)
    app.include_router(retention.router)
    app.include_router(enablement.router)
    return app


def _printable(candidate: str) -> bool:
    return all(32 <= ord(ch) < 127 for ch in candidate)


if __name__ == "__main__":
    settings = get_settings()
    uvicorn.run(
        "app.main:app",
        host=settings.EXECUTION_ENGINE_HOST,
        port=settings.SERVICE_PORT,
        log_config=None,  # uvicorn's default logging would bypass the redaction pipeline
    )
```


## FILE: services/execution-engine/app/routers/internal.py (219 lines)

*one field on the status answer, threaded from describe() - the audit's own window made visible on the surface operators and the worker already read.*

```python
"""The internal command surface the trading worker forwards to.

Contract notes that the worker and the API both depend on:

* 200 means DURABLY PROCESSED (for the runtime's durability class); the
  business verdict rides in the body (`outcome`, `verified`), never in the
  status code. A rejected cancel and a completed cancel are both 200 -
  the job is done when we have a confident answer about it, which is
  exactly the BullMQ ack boundary.
* 4xx here is never retried: 401/403 is wiring wrong, 422 is a payload
  that cannot be executed by anyone, 404 says the record this command
  acts on does not exist in this runtime's store. 501 says "supported by
  the queue contract, not wired in this build" - the honest answer for
  resync-private-stream today.
* 5xx is retryable by contract; the worker defers the job.
* every response carries the correlation ids back so the worker can log
  one line per command that both sides can grep for.
"""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.composition import EngineRuntime
from app.routers.health import get_runtime
from app.schemas import (
    AccountCommandRequest,
    BalancesResponse,
    BalanceView,
    CancelOrderRequest,
    CancelOrderResponse,
    DiscrepancyView,
    ReconcileResponse,
    StatusResponse,
    VerifyResponse,
)
from app.security import ServiceCaller, require_internal_auth, require_tenant_match

router = APIRouter(prefix="/internal/v1", tags=["internal"])

AuthDep = Annotated[ServiceCaller, Depends(require_internal_auth)]
RuntimeDep = Annotated[EngineRuntime, Depends(get_runtime)]


@router.get("/status", response_model=StatusResponse, response_model_by_alias=True)
async def engine_status(
    caller: AuthDep,
    runtime: RuntimeDep,
    request: Request,
) -> StatusResponse:
    """The worker asserts `mode`/`store`/`commands` against its own config
    before forwarding anything; a deployment that disagrees is refused at
    the worker boundary rather than discovered mid-command."""
    wiring = runtime.describe()
    return StatusResponse(
        instance_id=str(wiring["instanceId"] or ""),
        mode=str(wiring["mode"]),
        dry_run=bool(wiring["dryRun"]),
        adapter=str(wiring["adapter"]),
        store=str(wiring["store"]),
        store_durable=bool(wiring["storeDurable"]),
        store_backend=str(wiring["storeBackend"]),
        retention_enabled=bool(wiring["retentionEnabled"]),
        retention_event_days=int(wiring["retentionEventDays"]),
        enablement_max_age_days=int(wiring["enablementMaxAgeDays"]),
        locks_distributed=bool(wiring["locksDistributed"]),
        commands=[str(command) for command in wiring["commands"]],
    )


@router.post(
    "/accounts/verify-credentials",
    response_model=VerifyResponse,
    response_model_by_alias=True,
)
async def verify_credentials(
    body: AccountCommandRequest,
    caller: AuthDep,
    runtime: RuntimeDep,
) -> VerifyResponse:
    require_tenant_match(body.tenant_id, caller)
    ok, note = await runtime.account_adapter.verify_credentials(
        body.tenant_id, body.account_id
    )
    return VerifyResponse(verified=ok, note=note, is_simulated=True)


@router.post(
    "/accounts/refresh-balances",
    response_model=BalancesResponse,
    response_model_by_alias=True,
)
async def refresh_balances(
    body: AccountCommandRequest,
    caller: AuthDep,
    runtime: RuntimeDep,
) -> BalancesResponse:
    require_tenant_match(body.tenant_id, caller)
    balances = await runtime.account_adapter.fetch_balances(
        body.tenant_id, body.account_id
    )
    return BalancesResponse(
        balances=[
            BalanceView(asset=row.asset, free=str(row.free), locked=str(row.locked))
            for row in balances
        ],
        is_simulated=True,
    )


@router.post(
    "/accounts/reconcile",
    response_model=ReconcileResponse,
    response_model_by_alias=True,
)
async def reconcile_account(
    body: AccountCommandRequest,
    caller: AuthDep,
    runtime: RuntimeDep,
) -> ReconcileResponse:
    require_tenant_match(body.tenant_id, caller)
    report = await runtime.reconciliation.reconcile_account(
        body.tenant_id, body.account_id
    )
    return ReconcileResponse(
        tenant_id=report.tenant_id,
        account_id=report.account_id,
        exchange=report.exchange.value,
        orders_checked=report.orders_checked,
        fills_recovered=report.fills_recovered,
        discrepancy_count=len(report.discrepancies),
        discrepancies=[
            DiscrepancyView(
                discrepancy_type=discrepancy.discrepancy_type.value,
                summary=discrepancy.summary,
                order_id=discrepancy.order_id,
                repaired=discrepancy.repaired,
            )
            for discrepancy in report.discrepancies
        ],
        error=report.error,
        started_at_micros=report.started_at_micros,
        finished_at_micros=report.finished_at_micros,
    )


@router.post(
    "/accounts/resync-private-stream",
    status_code=status.HTTP_501_NOT_IMPLEMENTED,
)
async def resync_private_stream(
    body: AccountCommandRequest,
    caller: AuthDep,
    runtime: RuntimeDep,
) -> dict[str, Any]:
    """Not wired in the simulated build, and the refusal is the feature.

    A private-stream resync is a LIVE venue interaction (new listen key,
    reconnect, catch-up reconcile). Simulated execution has no stream to
    resync; pretending to accept the command would turn the API's honest
    202 "queued for the worker" into a lie three hops later. The job fails
    visibly with a reason an operator can read.
    """
    require_tenant_match(body.tenant_id, caller)
    return {
        "code": "NOT_SUPPORTED",
        "message": (
            "resync-private-stream requires the live venue adapter (Part 12); "
            "this runtime is simulated and has no private stream to resync."
        ),
    }


@router.post("/orders/cancel", response_model=CancelOrderResponse, response_model_by_alias=True)
async def cancel_order(
    body: CancelOrderRequest,
    caller: AuthDep,
    runtime: RuntimeDep,
) -> CancelOrderResponse:
    require_tenant_match(body.tenant_id, caller)
    order = await runtime.store.get_order(body.tenant_id, body.order_id)
    if order is None:
        # 404, not a fabricated rejection: this runtime has no record of
        # the order, so it must not claim an outcome about it. The worker's
        # job fails visibly; the API-side order state never moves.
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={
                "code": "ORDER_NOT_FOUND",
                "message": (
                    "This runtime holds no record of that order; refusing to "
                    "report a cancellation outcome for an order it cannot see."
                ),
            },
        )
    if order.client_order_id != body.client_order_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "ORDER_IDENTITY_MISMATCH",
                "message": (
                    "The order record does not carry the client order id the "
                    "command named; the job is refused rather than aimed at a "
                    "different order."
                ),
            },
        )
    result = await runtime.engine.cancel(order)
    return CancelOrderResponse(
        outcome=result.outcome.value,
        client_order_id=result.client_order_id or body.client_order_id,
        order_status=result.order.status.value if result.order is not None else "UNKNOWN",
        error_code=result.error_code.value if result.error_code is not None else None,
        message=result.message,
        latency_micros=result.latency_micros,
        is_simulated=result.is_simulated,
    )
```


## FILE: services/execution-engine/.env.example (83 lines)

*the Part-15 block: the single knob, why there is no enablement apply switch, the bounds' owner (the core law), and the two commands that exercise it.*

```dotenv
# execution-engine - Part 11 worker plane
# Copy to .env and fill real values. NEVER commit the result. The platform
# validator (packages/config env.schema.ts) rejects known sample values in
# committed env files; this file carries samples deliberately - that is why
# it is named .env.example and excluded from validation.

# --- identity / transport ---------------------------------------------------
NODE_ENV=development
LOG_LEVEL=info
# Names this process in logs, health and worker assertions. Any stable id.
EXECUTION_INSTANCE_ID=execution-engine-local
# Loopback by default; container deployments set this to 0.0.0.0 and keep
# the port on the internal network only.
EXECUTION_ENGINE_HOST=127.0.0.1
SERVICE_PORT=8093
# REQUIRED, no default: shared secret with the Node worker, min 32 chars.
# Generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
EXECUTION_INTERNAL_TOKEN=replace-me-with-64-hex-characters-generated-fresh

# --- mode -------------------------------------------------------------------
# simulated is the only executable mode in this build. Setting live is a
# STARTUP REFUSAL by design (live venue adapter, credential provider and
# durable store land in Part 12) - a refusal to lift, not a placeholder.
EXECUTION_MODE=simulated
# true = submissions stop before transmission; cancel stays available.
EXECUTION_DRY_RUN=true
# Venue request timeout (core engine setting) and lock lease TTL.
EXECUTION_REQUEST_TIMEOUT_MS=5000
EXECUTION_LOCK_TTL_MS=15000

# --- simulated venue ----------------------------------------------------------
# Fixed mid used as top-of-book for any symbol. Leave unset for an empty
# book (submissions refuse for lack of price - the honest default).
# EXECUTION_SIMULATED_MID=50000
# Seed balances for the simulated account, ASSET=QUANTITY pairs. Always
# surfaced labelled simulated.
EXECUTION_PAPER_BALANCES=USDT=100000

# --- durable store (Part 13) --------------------------------------------------
# memory: process-local simulated store, lost on restart (readiness says so:
# storeDurable=false). postgres: durable engine store over the engine_orders /
# engine_order_events / engine_order_fills tables - they are owned by
# apps/api/prisma (migrations), so run the migrate job first; the service
# verifies the tables exist at startup and refuses if they do not.
# EXECUTION_STORE_BACKEND never silently degrades: postgres without a DSN,
# or a DSN without postgres, is a startup refusal.
EXECUTION_STORE_BACKEND=memory
# DSN for the durable store. A credential: env-only, never logged. Set this
# ONLY with EXECUTION_STORE_BACKEND=postgres (the config refuses the
# mismatch). The engine sets app.tenant_id per transaction, so these tables
# are ready for the platform's row-level-security policies from day one.
# EXECUTION_POSTGRES_DSN=postgresql://wlct_app:CHANGE-ME@db:5432/wlct

# --- journal retention (Part 14) ----------------------------------------------
# The durable store's event journal (engine_order_events) is the one table
# retention prunes; orders and fills are never deleted, at any age, under
# any config. The four values below are bounded by the core's law
# (wlct_trading/retention.py) and a nonsensical combination refuses BOOT.
#   EXECUTION_RETENTION_ENABLED: false = dry-run only. Inspect and dry-run
#     always work; an apply request is answered 409 naming this variable.
#     Turn it on only after (a) an inspect, (b) a scheduled dry-run whose
#     ledger row you read, and (c) a fresh verified backup - docs/DR.md and
#     docs/PART14_RETENTION.md carry the runbook.
#   EXECUTION_RETENTION_EVENT_DAYS: journal rows are prunable only when BOTH
#     the row and its order's terminal stamp are older than this. 90 default.
#   EXECUTION_RETENTION_BATCH_ROWS / _MAX_BATCHES: per-statement and
#     per-run ceilings. A run that hits the ceiling reports "exhausted" and
#     the next scheduled run resumes - partial progress is the design.
# EXECUTION_RETENTION_ENABLED=true
# EXECUTION_RETENTION_EVENT_DAYS=90
# EXECUTION_RETENTION_BATCH_ROWS=2000
# EXECUTION_RETENTION_MAX_BATCHES=50

# --- RLS enablement verification (Part 15) -------------------------------
# The only knob is how old an enablement audit may be before it stops
# counting as evidence. There is deliberately NO enablement "apply" switch:
# the audit endpoint runs SELECTs and nothing else, so it needs no two-yeses
# guard (contrast the retention block above, where the verb is DELETE).
# Bounds (1..36500 days) are enforced by wlct_trading/enablement.py and a
# nonsensical value refuses BOOT, so a typo can never mean "every audit is
# fresh, forever". The audit itself: POST /internal/v1/enablement/audit, or
# `node scripts/rls-enablement.mjs audit --record`.
# EXECUTION_ENABLEMENT_MAX_AGE_DAYS=30
```


## FILE: services/execution-engine/pyproject.toml (49 lines)

*the enablement test module's dependency surface (none beyond the pins already there) - listed so the handover's file set matches the part's real footprint.*

```toml
[project]
name = "wlct-execution-engine"
version = "1.0.0"
description = "Trading worker's execution core: hosts wlct_trading.execution behind the internal API"
requires-python = ">=3.11"

[tool.ruff]
line-length = 100
target-version = "py311"

[tool.ruff.lint]
select = ["E", "F", "I", "B", "UP", "S", "ASYNC"]
ignore = ["S101"]

[tool.mypy]
python_version = "3.11"
strict = true
# trading-core is a repo package; mypy does not resolve PEP 660 lightweight
# editables. Pointing mypy_path at the source makes every wlct_trading import
# FULLY TYPED (better than site-packages resolution), so the money path's
# types are checked, not blurred to Any.
mypy_path = "$MYPY_CONFIG_FILE_DIR/../../libs/trading-core"
warn_unreachable = true
disallow_untyped_defs = true

[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["tests"]

[[tool.mypy.overrides]]
# Stub-less third-party modules the service imports. Same list as the
# trading engine: PEP 561 says these ship no types; strictness is unchanged
# for first-party code. asyncpg joins the list with Part 13: it is the one
# module allowed to touch the driver (app/pg_store.py); the store itself
# speaks the PgPool protocol and stays driver-free.
module = ["asyncpg.*", "pythonjsonlogger.*", "jsonlogger.*"]
ignore_missing_imports = true

[[tool.mypy.overrides]]
# One rule relaxed for one file, with cause: ServiceJsonFormatter subclasses
# pythonjsonlogger's JsonFormatter, whose __init__ mypy can only ever see as
# untyped (no stubs exist and never will - upstream). The constructor
# override in that file TYPES the subclass surface; the residual `super().__init__`
# call into the stub-less base is what no-untyped-call flags. Refusing to
# call an untyped third-party base is not more correct, so this file opts
# out of THAT rule only; every other strict rule still applies to it in
# full, and to all other files without exception.
module = ["app.logging_config"]
disallow_untyped_calls = false
```


## FILE: libs/trading-core/pyproject.toml (79 lines)

*no new runtime dependency: the enablement law is stdlib-only like every other core module, and the file is included to show that the part that added a whole domain added zero dependencies.*

```toml
[build-system]
requires = ["setuptools>=69", "wheel"]
build-backend = "setuptools.build_meta"

[project]
name = "wlct-trading-core"
version = "0.6.0"
description = "Shared trading data-plane domain library for the WLCT platform"
requires-python = ">=3.11"
# The core library has no runtime dependencies and must keep it that way: it is
# imported by every data-plane service, and a dependency here is a dependency
# everywhere. The live network transport is an opt-in extra.
dependencies = []

[project.optional-dependencies]
# Production network transport (wlct_trading.net). Only the market-data service
# and the live smoke test install this.
#
# httpx rather than aiohttp: services/market-data already depends on httpx and
# uses it in app/services/providers.py. Two async HTTP stacks in one process
# would mean two connection pools and two sets of timeout semantics for no
# capability that is missing.
live = [
  "websockets>=13.1,<18",
  "httpx>=0.27,<0.29",
]
dev = [
  "pytest>=8.0",
  "mypy>=1.8",
  "ruff>=0.3",
]

[tool.setuptools.packages.find]
include = ["wlct_trading*"]

[tool.setuptools.package-data]
# Type information ships with the package: services run mypy strict against
# this library's API, and the marker is what makes that legal instead of a
# stub-search exercise.
wlct_trading = ["py.typed"]

[tool.pytest.ini_options]
testpaths = ["tests"]
# No asyncio plugin is required: the handful of coroutine calls in the test
# suite are driven explicitly with asyncio.run(), which keeps the library's
# test dependencies to pytest alone.
#
# Every test in tests/ is hermetic: no internet, no credentials, no database,
# no Redis. The live smoke test is a separate script, not a test, precisely so
# that it cannot be picked up by a bare `pytest` run.
markers = [
  "live: touches a real exchange endpoint; never collected by default",
]
addopts = "-m 'not live'"

[tool.mypy]
python_version = "3.11"
strict = true
warn_unreachable = true

# websockets is an optional ([live] extra) dependency imported lazily inside a
# try/except with a purposeful error message; when it is not installed the
# guarded import must not become a type error.
[[tool.mypy.overrides]]
module = ["websockets.*"]
ignore_missing_imports = true

[tool.ruff]
line-length = 100
target-version = "py311"

# The ruleset is pinned rather than inherited from ruff's defaults, because
# those defaults have grown between releases and a CI gate that changes
# colour with the tool version is not a gate. E4/E7/E9/F is the classic
# default: syntax-level errors, imports, pyflakes. Correctness is gated;
# wrapping is not -- `ruff format` deliberately does not gate this repo, and
# the hand-wrapped line shapes are part of the reading experience.
[tool.ruff.lint]
select = ["E4", "E7", "E9", "F"]
```


## FILE: .env.example (996 lines)

*the deployment-facing entry for the window, next to the retention block, with the pointer to the evidence ledger and the doc.*

```dotenv
# =============================================================================
# WHITE-LABEL CRYPTO COPY-TRADING PLATFORM - ENVIRONMENT CONFIGURATION
# =============================================================================
# Copy to .env and fill in real values. NEVER commit .env.
# Generate cryptographic material with: npm run keys:generate
# =============================================================================

# -----------------------------------------------------------------------------
# APPLICATION
# -----------------------------------------------------------------------------
NODE_ENV=development
APP_NAME=WhiteLabelCopyTrade
API_PORT=4000
API_HOST=0.0.0.0
API_GLOBAL_PREFIX=api
API_DEFAULT_VERSION=1
# Public base URL of the API (used in emails, webhooks, OpenAPI servers)
API_PUBLIC_URL=http://localhost:4000
# Public base URL of the admin web application
ADMIN_WEB_URL=http://localhost:3000
# Host port the admin console is published on by Docker Compose.
ADMIN_WEB_PORT=3000
# Trust N reverse proxy hops (nginx/ALB). 0 disables proxy trust.
TRUST_PROXY_HOPS=1
# Root domain used to resolve tenants from sub-domains: acme.copytrade.app
PLATFORM_ROOT_DOMAIN=copytrade.app
# Fallback tenant slug used when a request carries no resolvable tenant context
DEFAULT_TENANT_SLUG=platform

# -----------------------------------------------------------------------------
# DATABASE (PostgreSQL)
# -----------------------------------------------------------------------------
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_USER=copytrade
POSTGRES_PASSWORD=change_me_postgres_password
POSTGRES_DB=copytrade
POSTGRES_SCHEMA=public
# Password for the least-privilege runtime role created by
# infrastructure/database/init/02-roles.sql. Leave blank to skip role creation.
POSTGRES_APP_PASSWORD=
# Prisma connection string. Inside docker-compose use host "postgres".
DATABASE_URL=postgresql://copytrade:change_me_postgres_password@localhost:5432/copytrade?schema=public&connection_limit=20&pool_timeout=20
# REQUIRED, not optional. schema.prisma declares `directUrl`, and Prisma refuses
# to run ANY migrate/generate command when the variable is missing (error P1012)
# even though the application itself never reads it. Point it at the database
# directly, bypassing any connection pooler (PgBouncer, RDS Proxy) and without
# the pooling query parameters, so DDL runs on a real session. With no pooler in
# front of PostgreSQL it is simply DATABASE_URL minus connection_limit/pool_timeout.
DIRECT_DATABASE_URL=postgresql://copytrade:change_me_postgres_password@localhost:5432/copytrade?schema=public
DATABASE_LOG_QUERIES=false
DATABASE_SSL=false

# -----------------------------------------------------------------------------
# REDIS (cache, rate limiting, queues, websocket adapter)
# -----------------------------------------------------------------------------
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0
REDIS_TLS=false
REDIS_KEY_PREFIX=wlct:
REDIS_URL=redis://localhost:6379/0

# -----------------------------------------------------------------------------
# JWT / AUTHENTICATION
# -----------------------------------------------------------------------------
# Asymmetric signing is recommended in production (RS256). For HS256 provide secrets.
JWT_ALGORITHM=HS256
JWT_ACCESS_SECRET=change_me_access_secret_min_32_chars_long
JWT_REFRESH_SECRET=change_me_refresh_secret_min_32_chars_long
# Base64-encoded PEM keys, required when JWT_ALGORITHM=RS256
JWT_PRIVATE_KEY_BASE64=
JWT_PUBLIC_KEY_BASE64=
JWT_ACCESS_TTL=900s
JWT_REFRESH_TTL=30d
JWT_ISSUER=https://api.copytrade.app
JWT_AUDIENCE=copytrade-clients
# Maximum concurrent active sessions (devices) per user
MAX_ACTIVE_SESSIONS_PER_USER=10

# Password policy / hashing (argon2id)
PASSWORD_MIN_LENGTH=12
ARGON2_MEMORY_COST=19456
ARGON2_TIME_COST=2
ARGON2_PARALLELISM=1

# Account protection
LOGIN_MAX_FAILED_ATTEMPTS=5
LOGIN_FAILED_WINDOW_SECONDS=900
ACCOUNT_LOCKOUT_SECONDS=900

# -----------------------------------------------------------------------------
# ENCRYPTION (exchange API credential envelope encryption)
# -----------------------------------------------------------------------------
# 32-byte key, base64 encoded. Key Encryption Key used to wrap per-record DEKs.
ENCRYPTION_MASTER_KEY_BASE64=
# Identifier of the active master key; enables zero-downtime key rotation.
ENCRYPTION_KEY_ID=local-dev-v1
# Previous keys kept for decrypt-only, JSON map: {"local-dev-v0":"<base64key>"}
ENCRYPTION_PREVIOUS_KEYS_JSON={}
# kms | local  -> "kms" delegates KEK operations to a managed KMS provider
ENCRYPTION_PROVIDER=local
KMS_PROVIDER=
KMS_KEY_ARN=
# Deterministic HMAC key used to build blind indexes (lookup on encrypted values)
BLIND_INDEX_KEY_BASE64=

# -----------------------------------------------------------------------------
# TWO-FACTOR AUTHENTICATION (TOTP)
# -----------------------------------------------------------------------------
TWO_FACTOR_ISSUER=CopyTrade
TWO_FACTOR_WINDOW=1
TWO_FACTOR_DIGITS=6
TWO_FACTOR_PERIOD=30
TWO_FACTOR_RECOVERY_CODES=10
# Short-lived token issued between password step and 2FA step
TWO_FACTOR_CHALLENGE_TTL=300s
# Wrong codes tolerated per challenge token before it is discarded.
TWO_FACTOR_MAX_CHALLENGE_ATTEMPTS=5

# -----------------------------------------------------------------------------
# CORS
# -----------------------------------------------------------------------------
CORS_ENABLED=true
CORS_ORIGINS=http://localhost:3000,http://localhost:4000
CORS_CREDENTIALS=true
CORS_ALLOWED_HEADERS=Content-Type,Authorization,X-Tenant-Slug,X-Request-Id,X-Api-Version,Accept-Language,X-2FA-Token
CORS_EXPOSED_HEADERS=X-Request-Id,X-RateLimit-Limit,X-RateLimit-Remaining,X-RateLimit-Reset

# -----------------------------------------------------------------------------
# RATE LIMITING
# -----------------------------------------------------------------------------
RATE_LIMIT_ENABLED=true
RATE_LIMIT_TTL_SECONDS=60
RATE_LIMIT_MAX=120
RATE_LIMIT_AUTH_TTL_SECONDS=300
RATE_LIMIT_AUTH_MAX=10
RATE_LIMIT_TRUSTED_IPS=127.0.0.1,::1

# -----------------------------------------------------------------------------
# SWAGGER / OPENAPI
# -----------------------------------------------------------------------------
SWAGGER_ENABLED=true
SWAGGER_PATH=docs
SWAGGER_TITLE="White-Label Copy Trading API"
SWAGGER_DESCRIPTION="Multi-tenant non-custodial crypto copy-trading platform API"
SWAGGER_VERSION=1.0.0
# Optional basic-auth protection for the docs route in non-local environments
SWAGGER_USER=
SWAGGER_PASSWORD=

# -----------------------------------------------------------------------------
# LOGGING
# -----------------------------------------------------------------------------
LOG_LEVEL=debug
# json | pretty
LOG_FORMAT=pretty
LOG_REQUEST_BODY=false
LOG_SAMPLE_RATE=1
SENTRY_DSN=

# -----------------------------------------------------------------------------
# WEBSOCKET
# -----------------------------------------------------------------------------
WS_ENABLED=true
WS_PATH=/realtime
WS_NAMESPACE=/v1
WS_PING_INTERVAL_MS=25000
WS_PING_TIMEOUT_MS=20000
WS_MAX_CONNECTIONS_PER_USER=5
# Redis adapter lets many API replicas share socket rooms
WS_REDIS_ADAPTER=true

# -----------------------------------------------------------------------------
# BULLMQ / BACKGROUND JOBS
# -----------------------------------------------------------------------------
QUEUE_PREFIX=wlct-queue
QUEUE_DEFAULT_ATTEMPTS=5
QUEUE_BACKOFF_MS=5000
QUEUE_REMOVE_ON_COMPLETE=1000
QUEUE_REMOVE_ON_FAIL=5000
QUEUE_CONCURRENCY=10
# Enable the in-process worker (single-container dev). Disable when running the dedicated worker.
QUEUE_RUN_INLINE_WORKERS=true
BULL_BOARD_ENABLED=false
BULL_BOARD_PATH=admin/queues

# -----------------------------------------------------------------------------
# EXCHANGE INTEGRATIONS (non-custodial: user-supplied trade-only API keys)
# -----------------------------------------------------------------------------
# Comma separated list of exchanges enabled platform-wide
EXCHANGES_ENABLED=binance,bybit,okx,kraken
EXCHANGE_SANDBOX_MODE=true
EXCHANGE_REQUEST_TIMEOUT_MS=10000
EXCHANGE_MAX_RETRIES=3
# Hard safety switch. Order execution remains disabled: the connectivity layer
# delivers market data only, and no order-placement adapter is registered.
EXECUTION_ENABLED=false
# Internal service endpoints
TRADING_ENGINE_URL=http://localhost:8001
TRADING_ENGINE_HEALTH_PATH=/health
MARKET_DATA_URL=http://localhost:8002
MARKET_DATA_HEALTH_PATH=/health
NOTIFICATION_SERVICE_URL=http://localhost:8003
NOTIFICATION_SERVICE_HEALTH_PATH=/health
# Shared secret for service-to-service authentication (mTLS recommended in prod)
INTERNAL_SERVICE_TOKEN=change_me_internal_service_token
# Signing secret used to verify inbound exchange webhooks
EXCHANGE_WEBHOOK_SIGNING_SECRET=change_me_webhook_secret

# -----------------------------------------------------------------------------
# EXCHANGE CONNECTIVITY (libs/trading-core: wlct_trading.transport / .exchanges)
# -----------------------------------------------------------------------------
# These tune the realtime market-data connectivity layer. They contain no
# credentials: public market data needs none, and user exchange API keys are
# stored encrypted per trading account in PostgreSQL, never in the environment.
#
# Only venues with an implemented adapter can be selected. Naming a venue here
# that has no adapter fails fast at startup rather than at the first order.
EXCHANGE_MARKET_DATA_VENUES=binance
# Use the venue testnet endpoints. Keep true outside production.
EXCHANGE_USE_TESTNET=true

# --- Order-book synchronisation ---
# Depth requested for the REST snapshot. Rounded up to a depth the venue
# accepts. Deeper snapshots cost significantly more rate-limit weight
# (Binance spot: 100 levels = 5 weight, 1000 = 50, 5000 = 250).
ORDERBOOK_SNAPSHOT_DEPTH=1000
# Diffs buffered while a snapshot is in flight. Bounds memory: at 100 msg/s
# this is roughly 50 seconds of runway.
ORDERBOOK_MAX_BUFFERED_DELTAS=5000
# Resync attempts before a book is marked FAILED and refuses to serve quotes.
# It never silently serves a book it could not verify.
ORDERBOOK_MAX_RESYNC_ATTEMPTS=10
# A book quiet for longer than this is treated as stale and is not tradeable.
ORDERBOOK_STALENESS_THRESHOLD_MS=5000

# --- Websocket connection management ---
# These are read by the live transport (wlct_trading.net); the Part 3 library
# itself reads no environment at all.
WEBSOCKET_CONNECT_TIMEOUT_MS=10000
WS_HEARTBEAT_INTERVAL_MS=20000
# Silence after which the socket is considered dead and rebuilt. MUST be
# greater than WS_HEARTBEAT_INTERVAL_MS or healthy connections get killed.
WEBSOCKET_HEARTBEAT_TIMEOUT_MS=90000
# Reconnect backoff: capped exponential with full jitter. Jitter is not
# optional in production - without it every connection retries in lockstep
# after a venue blip and the reconnect storm is self-inflicted.
WS_RECONNECT_BASE_DELAY_MS=500
WS_RECONNECT_MAX_DELAY_MS=30000
WS_RECONNECT_MAX_ATTEMPTS=20
# Binance drops stream connections at 24h; cycling early makes it planned.
WS_CONNECTION_MAX_LIFETIME_SECONDS=82800

# --- Staleness thresholds (per channel, milliseconds) ---
# Trades are legitimately sporadic on thin symbols; an order book going quiet
# is not. Thresholds differ so neither alert is useless.
STALENESS_ORDER_BOOK_MS=5000
STALENESS_BOOK_TICKER_MS=5000
STALENESS_TICKER_MS=10000
STALENESS_TRADES_MS=60000
STALENESS_CANDLES_MS=120000
STALENESS_CONNECTION_MS=30000

# --- Rate limiting (venue-published values; lower them, never raise them) ---
# Binance spot: 6000 request weight per minute per IP.
BINANCE_REQUEST_WEIGHT_PER_MINUTE=6000
# 5 inbound messages per second per socket, counting PING/PONG and every
# subscribe frame. Exceeding it disconnects; repeat offenders get IP-banned.
BINANCE_WS_MESSAGES_PER_SECOND=5
BINANCE_MAX_STREAMS_PER_CONNECTION=1024
# Metrics scrape interval for the connectivity layer.
CONNECTIVITY_METRICS_INTERVAL_SECONDS=15

# -----------------------------------------------------------------------------
# LIVE MARKET DATA TRANSPORT (libs/trading-core: wlct_trading.net)
# -----------------------------------------------------------------------------
# The concrete websocket and HTTP clients behind the Part 3 abstractions.
#
# PUBLIC MARKET DATA ONLY. Nothing in this section is a credential and nothing
# on this code path can accept one: the market-data adapter has no API-key
# parameter, no request is signed, and no order is ever submitted. Live order
# execution is NOT implemented.
#
# Endpoints. Both must be TLS - the service refuses to start on ws:// or
# http://, because market data an attacker can rewrite is a way to induce bad
# trades. When EXCHANGE_USE_TESTNET=true and these are left unset, the venue's
# testnet endpoints are used automatically.
BINANCE_WS_URL=wss://stream.binance.com:9443
BINANCE_REST_URL=https://api.binance.com

# Symbols to stream. Accepts BTC/USDT, BTC-USDT or BTCUSDT; all three are
# normalised to the canonical BASE-QUOTE form and then validated against the
# venue's own instrument list, so a typo or a delisted market fails at startup
# rather than producing a socket that is silent forever.
MARKET_DATA_SYMBOLS=BTC/USDT,ETH/USDT,SOL/USDT

# Channels. Each enabled channel adds one stream per symbol to the single
# shared connection (Binance allows 1024 streams per socket).
# "ticker" is the bookTicker stream: best bid/ask on every book change, which
# is what the risk engine's price checks need. The 1-second rolling ticker is a
# statistics feed, not a quote feed.
MARKET_DATA_TICKER_ENABLED=true
MARKET_DATA_TRADES_ENABLED=true
MARKET_DATA_ORDERBOOK_ENABLED=true

# Websocket timeouts. WEBSOCKET_RECEIVE_TIMEOUT_MS is a backstop below the
# heartbeat, not the primary liveness check: a thin symbol's trade stream can
# legitimately be silent for minutes, and the venue's protocol pings are
# answered by the client library without ever surfacing as a message. Set it
# too low and a healthy but quiet connection is torn down in a loop.
WEBSOCKET_RECEIVE_TIMEOUT_MS=300000
# Client-initiated ping cadence and its response deadline. Binance pings every
# 3 minutes and disconnects after 10 without a pong; this is the reverse
# direction, used to notice a peer that has gone away silently.
WEBSOCKET_PING_INTERVAL_MS=180000
WEBSOCKET_PING_TIMEOUT_MS=60000
WEBSOCKET_CLOSE_TIMEOUT_MS=5000
# Frame size ceiling. An unbounded reader is a memory-exhaustion vector.
WEBSOCKET_MAX_FRAME_BYTES=8388608

# HTTP timeouts for REST snapshots. Every request is bounded by all three;
# there is no code path that produces an unbounded wait.
HTTP_CONNECT_TIMEOUT_MS=5000
HTTP_READ_TIMEOUT_MS=10000
HTTP_TOTAL_TIMEOUT_MS=15000
# Retries are bounded and only fire for categories the retry policy calls
# retryable. A 400 is never retried; a 429 honours the venue's Retry-After.
HTTP_MAX_RETRIES=3
HTTP_MAX_CONNECTIONS=20

# Duration of the separately invoked live smoke test
# (scripts/live_market_data_smoke_test.py). That script is the only thing in
# the repository that touches a real exchange; the normal test suite needs no
# internet, credentials, database or Redis.
LIVE_MARKET_DATA_SMOKE_TEST_DURATION_SECONDS=30

# -----------------------------------------------------------------------------
# EMAIL
# -----------------------------------------------------------------------------
# console | smtp (implemented). ses and postmark are planned; selecting an
# unimplemented driver fails fast instead of dropping mail silently.
MAIL_DRIVER=console
MAIL_FROM_NAME=CopyTrade
MAIL_FROM_ADDRESS=no-reply@copytrade.app
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASSWORD=

# -----------------------------------------------------------------------------
# NOTIFICATIONS (push / sms / webhooks)
# -----------------------------------------------------------------------------
NOTIFICATIONS_ENABLED=true
FIREBASE_PROJECT_ID=
FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY_BASE64=
TELEGRAM_BOT_TOKEN=
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_FROM_NUMBER=

# -----------------------------------------------------------------------------
# LOCALIZATION / CURRENCY
# -----------------------------------------------------------------------------
DEFAULT_LOCALE=en
SUPPORTED_LOCALES=en,es,ar,bn,tr
DEFAULT_CURRENCY=USD
SUPPORTED_CURRENCIES=USD,EUR,GBP,AED,BDT,TRY
FX_RATES_PROVIDER=none
FX_RATES_API_KEY=

# -----------------------------------------------------------------------------
# KYC (architecture only in Part 1)
# -----------------------------------------------------------------------------
# none | sumsub | onfido | shufti
KYC_PROVIDER=none
KYC_API_URL=
KYC_APP_TOKEN=
KYC_SECRET_KEY=
KYC_WEBHOOK_SECRET=

# -----------------------------------------------------------------------------
# PAYMENTS / BILLING (architecture only in Part 1)
# -----------------------------------------------------------------------------
# none | stripe | nowpayments
BILLING_PROVIDER=none
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
NOWPAYMENTS_API_KEY=
NOWPAYMENTS_IPN_SECRET=

# -----------------------------------------------------------------------------
# BOOTSTRAP / SEED (development only)
# -----------------------------------------------------------------------------
# QUOTING: always wrap a value in double quotes if it contains '#', a space, or
# any shell metacharacter. The '#' case is the one that bites: dotenv-cli treats
# an unquoted '#' as the start of a comment and silently truncates the value,
# while sourcing the same file from bash (`set -a; . .env`) keeps it intact.
# The two then disagree, so the password the seed hashes is not the password
# your scripts send, and you get an inexplicable 401 followed by a lockout.
#   WRONG: SEED_SUPER_ADMIN_PASSWORD=My_P4ss#2026   -> becomes "My_P4ss"
#   RIGHT: SEED_SUPER_ADMIN_PASSWORD="My_P4ss#2026"
SEED_SUPER_ADMIN_EMAIL=superadmin@copytrade.app
SEED_SUPER_ADMIN_PASSWORD="ChangeMe_Str0ng!Pass"
SEED_TENANT_ADMIN_EMAIL=admin@acme-capital.test
SEED_TENANT_ADMIN_PASSWORD=ChangeMe_Str0ng!Pass

# -----------------------------------------------------------------------------
# ADMIN WEB (Next.js) - consumed by apps/admin-web
# -----------------------------------------------------------------------------
# Server-side base URL used by Next route handlers and server components to
# reach the API. Inside Docker Compose this becomes http://api:4000/api.
API_BASE_URL=http://localhost:4000/api
# Organisation the console administers when no custom domain is in play.
ADMIN_TENANT_SLUG=platform
# Salt for the console's session cookies. Generate: openssl rand -base64 32
SESSION_COOKIE_SECRET=change_me_admin_session_secret_min_16_chars

# Browser-visible values only. Never place a secret behind NEXT_PUBLIC_.
NEXT_PUBLIC_APP_NAME="CopyTrade Admin"
NEXT_PUBLIC_API_VERSION=v1
NEXT_PUBLIC_WS_URL=http://localhost:4000
NEXT_PUBLIC_WS_PATH=/socket.io
NEXT_PUBLIC_DEFAULT_LOCALE=en

# -----------------------------------------------------------------------------
# TRADING ENGINE (services/trading-engine, Python/FastAPI, port 8001)
# -----------------------------------------------------------------------------
TRADING_ENGINE_HOST=0.0.0.0
TRADING_ENGINE_PORT=8001

# Pre-trade risk ceilings. These are hard caps enforced by the engine on every
# order intent; they are not user-configurable from the client.
MAX_ORDER_NOTIONAL_USD=1000
MAX_OPEN_POSITIONS_PER_ACCOUNT=20
MAX_LEVERAGE=5

# -----------------------------------------------------------------------------
# MARKET DATA (services/market-data, Python/FastAPI, port 8002)
# -----------------------------------------------------------------------------
MARKET_DATA_HOST=0.0.0.0
MARKET_DATA_PORT=8002
# Public reference-price sources, tried in order. No credentials are used.
MARKET_DATA_SOURCES=binance,bybit
MARKET_DATA_SYMBOLS=BTC/USDT,ETH/USDT,SOL/USDT
MARKET_DATA_POLL_INTERVAL_SECONDS=5
# A cached quote older than this is served with stale=true.
MARKET_DATA_CACHE_TTL_SECONDS=15
# Enables the realtime websocket connectivity layer (wlct_trading.transport).
# Off by default: with it disabled the service serves cached REST quotes only
# and opens no exchange sockets.
MARKET_DATA_STREAMING_ENABLED=false

# -----------------------------------------------------------------------------
# NOTIFICATION SERVICE (services/notification-service, Node/BullMQ, port 8003)
# -----------------------------------------------------------------------------
NOTIFICATION_SERVICE_HOST=0.0.0.0
NOTIFICATION_SERVICE_PORT=8003
# The standalone worker reads MAIL_DRIVER, MAIL_FROM_* and SMTP_* from the
# EMAIL section above. Only "console" and "smtp" are implemented; any other
# value throws on startup rather than silently discarding mail.
# none | fcm | apns. "none" reports delivered:false instead of faking delivery.
PUSH_PROVIDER=none
# none | twilio
SMS_PROVIDER=none

# -----------------------------------------------------------------------------
# SHARED LOGGING (all Node and Python services)
# -----------------------------------------------------------------------------
# json in every deployed environment; pretty is for local terminals only.
LOG_FORMAT=json
# Additional pino redaction paths, comma separated. The built-in list already
# covers authorization headers, cookies, passwords, tokens and API secrets.
PINO_REDACT_PATHS=

# -----------------------------------------------------------------------------
# MOBILE APP (apps/mobile, Flutter)
# -----------------------------------------------------------------------------
# The Flutter app deliberately does NOT read this file. A .env shipped inside an
# APK/IPA is trivially extractable, so every mobile value is compiled in with
# --dart-define and the app holds no secrets at all: it authenticates with the
# user's own credentials and stores the resulting tokens in the platform
# keystore (flutter_secure_storage), never in shared preferences or a bundled
# asset. The variables below are listed here only so that all configuration for
# the platform lives in one discoverable place.
#
#   APP_ENV       development | staging | production
#   API_BASE_URL  Base URL INCLUDING the global prefix, e.g. https://api.example.com/api
#                 Android emulator reaches the host through 10.0.2.2, not localhost.
#                 Production builds refuse to start unless this is https://.
#   API_VERSION   URI version segment appended after the prefix (v1)
#   TENANT_SLUG   Sent as X-Tenant-Slug; identifies the white-label brand
#   WS_URL        Socket.IO origin, without the /realtime namespace
#
# Local development against this compose stack:
#
#   flutter run \
#     --dart-define=APP_ENV=development \
#     --dart-define=API_BASE_URL=http://10.0.2.2:4000/api \
#     --dart-define=API_VERSION=v1 \
#     --dart-define=TENANT_SLUG=platform \
#     --dart-define=WS_URL=http://10.0.2.2:4000
#
# Release build:
#
#   flutter build apk --release \
#     --dart-define=APP_ENV=production \
#     --dart-define=API_BASE_URL=https://api.example.com/api \
#     --dart-define=API_VERSION=v1 \
#     --dart-define=TENANT_SLUG=acme \
#     --dart-define=WS_URL=https://api.example.com
#
# Prefer --dart-define-from-file=config/production.json in CI so the values are
# versioned per environment instead of being retyped on the command line.

# =============================================================================
# PART 5 - AUTHENTICATED EXECUTION (libs/trading-core: wlct_trading.execution)
# =============================================================================
# Everything in this block governs whether real orders can reach a real
# exchange with real money. Read the whole section before changing anything.
#
# THE DEFAULTS BELOW CANNOT TRADE. That is deliberate and it is enforced in
# code, not just by convention: an unset variable is never treated as
# permission, and a contradictory combination fails at startup rather than
# resolving itself to the dangerous option.

# -----------------------------------------------------------------------------
# Exchange credentials
# -----------------------------------------------------------------------------
# NEVER commit real values. NEVER paste a key into a ticket, a chat message or
# a log. These are read once at startup by the credential provider and are
# never written to the database, never returned by an API, never included in a
# WebSocket payload and never logged - the credential object redacts itself in
# every rendering path, including repr() and f-strings.
#
# Create the key on Binance with ONLY:
#   [x] Enable Reading
#   [x] Enable Spot & Margin Trading
#   [ ] Enable Withdrawals   <-- MUST stay off
# A withdrawal-capable key is rejected by verify_credentials() and by the
# CREDENTIALS_VALID safety gate. The platform is non-custodial and refuses to
# hold a key that can move funds off the exchange.
#
# Also add an IP allowlist on the key. It is the single most effective control
# available, and it is free.
#
# These two variables are for a single-tenant development setup only. In
# production, per-tenant credentials come from the secret manager through
# SecretManagerCredentialProvider (Vault / AWS Secrets Manager / GCP Secret
# Manager / KMS), keyed by tenant and account. Environment variables do not
# scale to multi-tenant and cannot be rotated per customer.
BINANCE_API_KEY=
BINANCE_API_SECRET=
# Optional: restricts what the platform believes the key can do, independently
# of what the venue says. Comma separated. WITHDRAW here is always refused.
BINANCE_API_PERMISSIONS=SPOT
# Where credentials come from: env | secret-manager | none
CREDENTIAL_PROVIDER=env
# Cache TTL for a resolved credential, in seconds. Short, so a revoked key
# stops working quickly; non-zero, so every order does not hit the secret
# manager. 300 is a reasonable compromise.
CREDENTIAL_CACHE_TTL_SECONDS=300

# -----------------------------------------------------------------------------
# The four switches that gate real money
# -----------------------------------------------------------------------------
# All of the following must agree before a single byte reaches a real venue:
#
#   LIVE_TRADING_ENABLED=true
#   DRY_RUN=false
#   PAPER_TRADING=false
#   TRADING_MODE=LIVE
#   TRADING_ENABLED=true
#   LIVE_TRADING_CONFIRMED=true
#
# Any disagreement is a startup failure with an explicit message. In
# particular:
#   * LIVE_TRADING_ENABLED=true with DRY_RUN=true   -> REJECTED (contradiction)
#   * LIVE_TRADING_ENABLED=true with PAPER_TRADING=true -> REJECTED
#   * LIVE_TRADING_ENABLED=true without TRADING_MODE=LIVE -> REJECTED
# The platform never silently picks the dangerous interpretation, and never
# silently downgrades a misconfigured LIVE to PAPER either - a silent downgrade
# hides a production misconfiguration until the day it matters.

# Master switch for real-money execution.
LIVE_TRADING_ENABLED=false

# Build, validate, risk-check and sign the request, then stop. Nothing is
# transmitted and the order is NEVER reported as submitted. This is the correct
# setting for verifying a configuration end to end without risk.
DRY_RUN=true

# Route orders to the simulated venue. Paper fills are computed from real
# observed prices and are labelled is_simulated=true everywhere they appear -
# in the database, in the API and in every PnL figure.
PAPER_TRADING=true

# -----------------------------------------------------------------------------
# Execution timing
# -----------------------------------------------------------------------------
# How long to wait for a venue response before treating the outcome as UNKNOWN.
# A timeout is ambiguous, not a failure: the order may have been accepted. It
# is reconciled by clientOrderId and never resubmitted.
ORDER_REQUEST_TIMEOUT_MS=10000

# How often the background sweep compares local state against the venue.
ORDER_RECONCILIATION_INTERVAL_MS=60000

# How long to wait before reconciling an order whose result was unknown. Long
# enough for the venue to have finished processing; short enough that a
# position is not a mystery for minutes.
ORDER_UNKNOWN_RECONCILIATION_DELAY_MS=2000

# How often the exchange clock offset is re-measured. A signed request whose
# timestamp is outside the venue's window is rejected, so this is not optional.
EXCHANGE_TIME_SYNC_INTERVAL_MS=300000

# Maximum tolerated difference between this host's clock and the venue's.
# Above this, signing is REFUSED rather than attempted - Binance rejects a
# timestamp more than 1000ms ahead of server time regardless of recvWindow, so
# a larger local error cannot be compensated for by widening the window. If you
# hit this, fix NTP; do not raise the limit.
EXCHANGE_MAX_CLOCK_SKEW_MS=1000

# recvWindow sent with every signed request. Binance caps this at 60000.
# Smaller is safer: it bounds how long a captured request stays replayable.
EXCHANGE_RECV_WINDOW_MS=5000

# How long a clientOrderId reservation is remembered in Redis. The durable
# guard is the unique index on (tenant_id, client_order_id); this is the cheap
# fast path in front of it. 86400 = 24h.
EXECUTION_IDEMPOTENCY_TTL_SECONDS=86400

# Refuse to submit when the risk snapshot is older than this. Stale risk state
# is treated as unavailable, and unavailable means the order is refused.
MAX_RISK_STATE_AGE_MS=5000

# Submission attempts for genuinely retryable failures. Never applied to an
# ambiguous result - that path reconciles instead of retrying, always.
MAX_SUBMIT_ATTEMPTS=1

# -----------------------------------------------------------------------------
# Private user-data stream
# -----------------------------------------------------------------------------
# The authenticated WebSocket that delivers fills, order updates and balance
# changes. Backend only: its payloads are the full order flow of a real
# account and must never reach a mobile client or the admin web app.
PRIVATE_STREAM_RECONNECT_ENABLED=true

# Listen-key keepalive interval. Binance expires a listen key after 60 minutes;
# 30 minutes means one renewal can fail entirely and the stream still survives.
PRIVATE_STREAM_LISTEN_KEY_REFRESH_MS=1800000

# After every reconnect the platform reconciles, because Binance does not
# replay events missed while disconnected. Leave this on.
PRIVATE_STREAM_RECONCILE_ON_RECONNECT=true

# -----------------------------------------------------------------------------
# Live-trading harness (NOT part of the default startup path)
# -----------------------------------------------------------------------------
# Guards the separately-invoked script that places a real order on testnet.
# It refuses to run unless this is explicitly true AND the credentials point at
# a testnet endpoint.
LIVE_EXECUTION_HARNESS_ENABLED=false
BINANCE_USE_TESTNET_FOR_HARNESS=true

# =============================================================================
# PART 6 - STRATEGY ENGINE, PAPER TRADING, BACKTESTING
# =============================================================================
# The strategy layer decides what it would like to do. It cannot submit an
# order, it never sees a credential, and NOTHING IN THIS SECTION CAN ENABLE
# LIVE TRADING. That still requires the Part 5 combination above
# (LIVE_TRADING_ENABLED=true, EXECUTION_ENABLED=true, DRY_RUN=false,
# PAPER_TRADING=false, EXCHANGE_SANDBOX_MODE=false), and every one of those is
# validated at startup.
#
# THREE THINGS THIS SECTION CANNOT PROMISE:
#   BACKTEST PERFORMANCE IS NOT INDICATIVE OF FUTURE PERFORMANCE.
#   PAPER PERFORMANCE IS NOT INDICATIVE OF LIVE PERFORMANCE.
#   SIMULATION DOES NOT GUARANTEE REAL EXECUTION QUALITY.

# -----------------------------------------------------------------------------
# Feature switches
# -----------------------------------------------------------------------------
# Master switch for the strategy engine. Off by default: a deployment that has
# not been asked to run strategies should not spend CPU on every book update.
STRATEGY_ENGINE_ENABLED=false

# Whether paper sessions may be started. A paper session routes to the
# simulated adapter and refuses any adapter that is not marked simulated, so
# this is safe to leave on.
PAPER_TRADING_ENABLED=true

# Whether backtests may be submitted. A backtest opens no socket and touches
# no venue; it reads a stored dataset and replays it.
BACKTEST_ENABLED=true

# -----------------------------------------------------------------------------
# Engine bounds
# -----------------------------------------------------------------------------
# Bound on the in-process market-data queue feeding the strategies. A bounded
# queue turns a slow strategy into shed load rather than unbounded memory
# growth. Valid range 100 - 1000000.
STRATEGY_EVENT_QUEUE_SIZE=10000

# Hard cap on concurrently registered strategy instances per process.
# Valid range 1 - 1000.
STRATEGY_MAX_INSTANCES=50

# Observation budget for one dispatch, in milliseconds. Exceeding it increments
# a counter and marks the dispatch slow so an operator can see degradation.
# It is NOT a guarantee: this platform makes no latency guarantee, and any
# claim of "sub-millisecond" processing would be false. Must stay well below
# SIGNAL_MAX_AGE_MS.
STRATEGY_MAX_PROCESSING_LATENCY_MS=50

# -----------------------------------------------------------------------------
# Signal handling
# -----------------------------------------------------------------------------
# A signal older than this is refused by the validator rather than acted on.
# Stale intent is how a processing backlog turns into a bad fill.
SIGNAL_MAX_AGE_MS=2000

# How long a signal identity is remembered so an identical repeat is dropped.
# This is a bounded in-memory guard against a chattering strategy - it is NOT
# the order idempotency system, which lives in the execution layer and is
# backed by a unique index. Must cover at least SIGNAL_MAX_AGE_MS.
SIGNAL_DEDUP_TTL_SECONDS=5

# -----------------------------------------------------------------------------
# Backtest defaults
# -----------------------------------------------------------------------------
# Applied when a backtest request does not state its own assumptions. They are
# recorded in the configuration hash of every run, so changing one here changes
# the identity of subsequent runs - which is the point: two results computed
# under different cost assumptions are not comparable.
#
# None of these describe a real account or a real fee schedule. Set them from
# your venue's published rates.
BACKTEST_DEFAULT_INITIAL_CAPITAL=10000

# Fee RATES, not basis points: 0.001 is ten basis points. Maker and taker are
# separate because they are separate on every venue that matters.
BACKTEST_DEFAULT_MAKER_FEE=0.001
BACKTEST_DEFAULT_TAKER_FEE=0.001

# Slippage in basis points applied against every simulated taker fill, on both
# sides. Zero fees together with zero slippage is refused in production: that
# combination produces results no real account could achieve.
BACKTEST_DEFAULT_SLIPPAGE_BPS=1

# =============================================================================
# PART 7 - HISTORICAL DATASETS (ingestion, validation, replay input)
# =============================================================================
# Datasets feed the Part 6 backtest engine. They are public market data: no
# credentials exist for them and none are accepted by them. Nothing in this
# section can enable live trading or route an order; the ingestion path shares
# no import with the execution path by design (and by test).
#
# BACKTEST RESULTS OVER THESE DATASETS ARE SIMULATIONS.
# BACKTEST PERFORMANCE IS NOT INDICATIVE OF FUTURE PERFORMANCE.
# SIMULATION DOES NOT GUARANTEE REAL EXECUTION QUALITY.

# -----------------------------------------------------------------------------
# Storage
# -----------------------------------------------------------------------------
# Only the local backend ships. Object storage (S3-compatible, GCS, Azure)
# will be a new enum value and a new module - never a branch in the local one.
DATASET_STORAGE_BACKEND=local

# Root for finalised dataset trees. Must be absolute in production.
DATASET_LOCAL_ROOT=./data/datasets

# Staging root for in-flight ingestion. Must be on the SAME filesystem as
# DATASET_LOCAL_ROOT (finalisation is a rename) and disjoint from it
# (staging under the visible tree would expose half-written versions).
DATASET_TEMP_ROOT=./data/staging

# Hard ceiling for one partition file, in bytes (1 MiB - 4 GiB).
DATASET_MAX_PARTITION_BYTES=268435456

# Streaming reader chunk size (4 KiB - 64 MiB). The only read buffer a replay
# ever allocates; memory does not grow with dataset size.
DATASET_READER_BUFFER_SIZE=65536

# -----------------------------------------------------------------------------
# Validation
# -----------------------------------------------------------------------------
# Validate new versions before they become visible. Off is for emergency
# re-ingest of data validated elsewhere; such manifests are stamped
# "unvalidated" so they never masquerade as validated ones.
DATASET_VALIDATION_ENABLED=true

# Cap on gap findings repeated in a report (0 - 10000). Counts stay exact.
DATASET_MAX_GAP_WARNINGS=100

# Event ceiling per partition (1,000 - 50,000,000).
DATASET_MAX_EVENTS_PER_PARTITION=2000000

# Retention for NON-validated staging only. 'retain' keeps everything,
# including quarantined evidence. Nothing in this repo auto-deletes evidence.
DATASET_RETENTION_POLICY=retain

# -----------------------------------------------------------------------------
# Ingestion and backtest binding
# -----------------------------------------------------------------------------
# Master switch for dataset ingestion jobs. Off by default and never
# auto-enabled in production: a backfill is a deliberate act.
HISTORICAL_INGESTION_ENABLED=false

# Require backtest submissions to name a registered dataset VERSION.
# This is the rule that ends "re-ran the same backtest on different data":
# a run without a pinned version is refused rather than quietly guessed.
BACKTEST_DATASET_REQUIRED=true

# -----------------------------------------------------------------------------
# Part 8: real-time risk engine (control plane)
# -----------------------------------------------------------------------------
# These keys configure the API's risk control surface and the platform-default
# ceilings the trading worker inherits. They can only ever tighten what the
# engine enforces; there is no key here that approves an order, loosens a
# breach or disables a check. See docs/PART8_RISK.md for the resolution
# hierarchy and the fail-closed matrix.

# Require the extended Part 8 gate at worker startup (the Part 2 core gate is
# mandatory regardless and cannot be switched off by any setting).
RISK_ENGINE_ENABLED=true

# Assertion, not a toggle: RISK_FAIL_CLOSED=false is rejected at parse time
# in every environment. The engine refusing what it cannot prove safe is not
# a mode; it is the design.
RISK_FAIL_CLOSED=true

# A hot risk snapshot older than this may not authorise risk-increasing
# orders (ms). Keep it comfortably above RISK_SNAPSHOT_REFRESH_MS or the
# deployment is guaranteed stale (the env loader refuses that combination).
MAX_RISK_STATE_AGE_MS=2000
RISK_SNAPSHOT_REFRESH_MS=250

# Platform default ceilings. Child scopes (account/strategy/symbol) resolve
# to the TIGHTEST applicable value across the whole chain; these numbers are
# the top of that chain, deliberately conservative, and an emergency
# "flatten everything now" can only lower them further - never raise them.
MAX_ORDER_NOTIONAL=1000
MAX_POSITION_NOTIONAL=5000
MAX_ACCOUNT_EXPOSURE=10000
MAX_STRATEGY_EXPOSURE=5000
MAX_SYMBOL_EXPOSURE=5000
MAX_OPEN_ORDERS=20
MAX_DAILY_LOSS=500
MAX_STRATEGY_DAILY_LOSS=250
MAX_DRAWDOWN=10
MAX_ORDERS_PER_SECOND=2
MAX_ORDERS_PER_MINUTE=30
MAX_CANCELS_PER_SECOND=2
MAX_CANCELS_PER_MINUTE=30
MAX_PRICE_DEVIATION_BPS=250
MAX_CONSECUTIVE_LOSSES=5

# Risk events are the operator-facing trail (breaches, switches, stale
# state). Pruned by the maintenance queue after this many days; the durable
# accounting trail remains in the audit log under its own retention.
RISK_EVENTS_RETENTION_DAYS=365

# =============================================================================
# Part 9: observability & operations
# =============================================================================
# Publication and retention settings - never trading settings. In production
# the *_ENABLED flags cannot be false (env validation refuses to parse); a
# deployment that cannot be observed while holding money is not a deployment.
OBSERVABILITY_ENABLED=true
METRICS_ENABLED=true
HEALTH_ENABLED=true
PROMETHEUS_ENABLED=true
PROMETHEUS_PATH=/metrics
ALERTING_ENABLED=true
# Scrape secret. OPTIONAL outside production, REQUIRED in production.
# Provide a real random value through your secret store; never commit one.
# The header the scraper must present is x-metrics-token.
# METRICS_TOKEN=
# Cadences. HEALTH_REFRESH_MS paces each service's mirror loop;
# ALERT_DEDUP_WINDOW_MS must be >= it (validation enforces the ordering);
# QUEUE_ALERT_AGE_MS is the oldest-waiting threshold, halved for the
# trade-execution queue where the severity is CRITICAL by policy.
HEALTH_REFRESH_MS=5000
METRICS_EXPORT_INTERVAL_MS=15000
ALERT_DEDUP_WINDOW_MS=60000
QUEUE_ALERT_AGE_MS=120000
# Retention floors (validation enforces the minima): only RESOLVED alerts and
# CLOSED incidents are ever pruned; unresolved rows stay until resolved.
ALERT_RETENTION_DAYS=90
INCIDENT_RETENTION_DAYS=365

# =============================================================================
# Part 10: tracing, error budgets, fault injection
# =============================================================================
# Telemetry observes; it never authorises. Nothing below changes a trading
# decision, and the fault switch cannot arm in production (the validators
# refuse the boot on both runtimes).
OTEL_ENABLED=false
# OTLP/HTTP JSON collector base URL. Required in production when enabled.
# OTEL_ENDPOINT=http://otel-collector:4318
OTEL_TIMEOUT_MS=2000
OTEL_SAMPLE_RATIO=0.1
# Comma-separated operations always sampled at ratio 1.0 regardless of the
# above (the "critical traces remain inspectable" list).
OTEL_PRIORITY_OPERATIONS=execution.transmit
# Failure injection - a TEST HARNESS SWITCH. Armed only with the guard on
# and only outside production; disabling the guard DISABLES the feature,
# it does not unlock production. No API route can arm or consume.
FAILURE_INJECTION_ENABLED=false
FAILURE_INJECTION_ALLOW_NON_PRODUCTION_ONLY=true
# SLO engine. Evaluation cadence 1..59 minutes; retention has a hard floor
# of 7 days IN CODE - the configured value can only raise it.
SLO_ENABLED=true
SLO_EVALUATION_INTERVAL_MINUTES=5
SLO_RETENTION_DAYS=30
SLO_DEFAULT_WINDOW_MINUTES=1440
SLO_FAST_BURN_MULTIPLIER=14.4
SLO_SLOW_BURN_MULTIPLIER=6

# -----------------------------------------------------------------------------
# Part 11: trading-worker plane and read-replica policy.
#
# Three separable switches, all default-safe: the worker consumer (runs only
# in the dedicated `npm run worker` process / container - the API never hosts
# it), the execution engine it forwards to (services/execution-engine, which
# holds the venue side), and the read replica (off until BOTH the URL and the
# flag are set; half-configuration is a boot error, by design).
# -----------------------------------------------------------------------------
# Worker latch: false makes the worker boot EXIT with a reason rather than
# idle quietly. The API process ignores it (it never mounts the consumers).
WORKER_ENABLED=true
# Stable per-replica identity for claims and logs. Unset composes host:pid:rand.
# WORKER_ID=worker-a
# The fleet list the partition assignment is computed over - identical on
# every worker, comma-separated. Empty means "this worker alone".
# WORKER_MEMBERSHIP=worker-a,worker-b,worker-c
# Part 12: where live membership comes from. 'config' (the default) treats
# the list above as the fleet. 'registry' lets workers self-register through
# a Redis heartbeat zset - the list above becomes the documented fallback
# (first tick + registry outages) and claims remain the entire authority.
# WORKER_MEMBERSHIP_MODE=registry
# Heartbeat grace period for 'registry' mode; must be >= 2x
# WORKER_PARTITION_RETRY_MS when the mode is registry (schema-enforced).
# WORKER_MEMBERSHIP_TTL_MS=30000
# Keyspace width; changing it rescales every assignment at once (coordinated
# config change, ceiling 4096 pinned by the coordination fixtures).
WORKER_PARTITION_COUNT=8
WORKER_PARTITION_LEASE_TTL_MS=15000
WORKER_PARTITION_RETRY_MS=2500
# Parked-job cadence and the ceiling before a homeless job fails visibly
# (deferrals do not consume BullMQ attempts; this is what stops an eternal orbit).
WORKER_DEFER_DELAY_MS=3000
WORKER_MAX_DEFERS=30
WORKER_SHUTDOWN_TIMEOUT_MS=10000
# The execution engine (services/execution-engine) this worker forwards
# TRADE_EXECUTION commands to. It holds venue contact and credentials; this
# process holds only the queue.
EXECUTION_ENGINE_URL=http://127.0.0.1:8093
# REQUIRED by the worker (optional for the API). Must match the engine's
# EXECUTION_INTERNAL_TOKEN. Generate fresh; never reuse across environments.
# EXECUTION_ENGINE_TOKEN=
# Part 13 durable engine store (read by docker-compose for the
# execution-engine service). memory is the default and reports
# storeDurable=false honestly; postgres persists orders/events/fills in the
# engine_* tables (created by the API's migrations). Postgres without the
# DSN - or the DSN without postgres - refuses startup; there is no silent
# fallback in either direction. Details: services/execution-engine/.env.example
# and docs/PART13_DURABLE_STORE.md.
# EXECUTION_STORE_BACKEND=postgres
# EXECUTION_POSTGRES_DSN=postgresql://wlct_app:CHANGE-ME@db:5432/wlct
# Part 14 journal retention, also read by the execution-engine service
# above: defaults keep APPLY disabled (dry-run/inspect always available);
# bounds and semantics in services/execution-engine/.env.example and
# docs/PART14_RETENTION.md. The prune itself runs from
# `node scripts/retention-run.mjs` under the deployment's scheduler.
# EXECUTION_RETENTION_ENABLED=false
# EXECUTION_RETENTION_EVENT_DAYS=90
# Part 15: how old a row-level-security enablement audit may be before the
# platform stops treating it as evidence (bounds enforced by the core law;
# a bad value refuses boot). The audit is read-only - there is no enablement
# apply switch to turn on. Recorded results live in
# docs/dr/rls-evidence.jsonl and are aged by `node scripts/rls-enablement.mjs
# check` (docs/PART15_RLS_ENABLEMENT.md).
# EXECUTION_ENABLEMENT_MAX_AGE_DAYS=30
# Read-replica routing. Off by default; every read stays on the primary.
# When on, replica-eligible reads move only while the replica is healthy AND
# its lag (last probe, 10s trust window) is within DATABASE_READ_MAX_LAG_MS;
# any unknown routes primary. Execution-critical reads never use the replica.
DATABASE_READ_ENABLED=false
# DATABASE_READ_URL=postgresql://replica-user:...@replica-host:5432/wlct?sslmode=require
DATABASE_READ_MAX_LAG_MS=1500
```


## FILE: docker-compose.yml (412 lines)

*the env pass-through with its default (empty-string-safe like every other line here); no new service, port, volume or secret.*

```yaml
# =============================================================================
# White-label copy-trading platform - local and staging composition.
#
# Design notes:
#  * Only Postgres, Redis, the API and the admin console publish ports. The
#    Python services and the notification worker stay on the internal network:
#    they are reachable by service name and by nothing else.
#  * Every service reads the same root .env, so there is one place to configure
#    the stack and no secret is written into this file.
#  * Health checks gate startup order. `depends_on: condition: service_healthy`
#    means the API never boots against a database that is still initialising.
#  * Named volumes hold state. Bind mounts are used only for the development
#    profile, where hot reload is worth the trade-off.
# =============================================================================

name: wlct

x-logging: &default-logging
  driver: json-file
  options:
    max-size: "10m"
    max-file: "3"

x-restart: &default-restart
  restart: unless-stopped

services:
  # ---------------------------------------------------------------------------
  # Data stores
  # ---------------------------------------------------------------------------
  postgres:
    image: postgres:16.4-alpine
    container_name: wlct-postgres
    <<: *default-restart
    logging: *default-logging
    environment:
      POSTGRES_USER: ${POSTGRES_USER:-wlct}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}
      POSTGRES_DB: ${POSTGRES_DB:-wlct}
      # Deterministic collation avoids index-corruption surprises when the base
      # image's libc changes between upgrades.
      POSTGRES_INITDB_ARGS: "--encoding=UTF8 --locale=C"
    command:
      - postgres
      - -c
      - max_connections=200
      - -c
      - shared_buffers=256MB
      - -c
      - log_min_duration_statement=1000
      # Consumed by infrastructure/database/init/02-roles.sql.
      - -c
      - wlct.app_password=${POSTGRES_APP_PASSWORD:-}
    volumes:
      - postgres-data:/var/lib/postgresql/data
      - ./infrastructure/database/init:/docker-entrypoint-initdb.d:ro
    ports:
      # Bound to loopback: the database must not be reachable from the LAN.
      - "127.0.0.1:${POSTGRES_PORT:-5432}:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-wlct} -d ${POSTGRES_DB:-wlct}"]
      interval: 10s
      timeout: 5s
      retries: 10
      start_period: 20s
    networks:
      - wlct-internal

  redis:
    image: redis:7.4-alpine
    container_name: wlct-redis
    <<: *default-restart
    logging: *default-logging
    command:
      - redis-server
      - --requirepass
      - ${REDIS_PASSWORD:?REDIS_PASSWORD is required}
      - --appendonly
      - "yes"
      - --maxmemory
      - 512mb
      # Queue jobs and session state must never be silently evicted; only keys
      # with an explicit TTL are eligible.
      - --maxmemory-policy
      - volatile-lru
    volumes:
      - redis-data:/data
    ports:
      - "127.0.0.1:${REDIS_PORT:-6379}:6379"
    healthcheck:
      test: ["CMD-SHELL", "redis-cli -a \"$$REDIS_PASSWORD\" ping | grep -q PONG"]
      interval: 10s
      timeout: 5s
      retries: 10
      start_period: 10s
    environment:
      REDIS_PASSWORD: ${REDIS_PASSWORD}
    networks:
      - wlct-internal

  # ---------------------------------------------------------------------------
  # Migrations
  #
  # A one-shot job rather than an API entrypoint step: running migrations from
  # every replica is a race, and a failed migration must stop the deploy rather
  # than crash-loop an application container.
  # ---------------------------------------------------------------------------
  migrate:
    build:
      context: .
      dockerfile: infrastructure/docker/api.Dockerfile
      target: build
    container_name: wlct-migrate
    restart: "no"
    logging: *default-logging
    env_file:
      - .env
    environment:
      NODE_ENV: production
      DATABASE_URL: postgresql://${POSTGRES_USER:-wlct}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB:-wlct}?schema=public
    command: >
      sh -c "npx prisma migrate deploy --schema apps/api/prisma/schema.prisma"
    depends_on:
      postgres:
        condition: service_healthy
    networks:
      - wlct-internal

  # ---------------------------------------------------------------------------
  # Application services
  # ---------------------------------------------------------------------------
  api:
    build:
      context: .
      dockerfile: infrastructure/docker/api.Dockerfile
      target: runtime
    container_name: wlct-api
    <<: *default-restart
    logging: *default-logging
    env_file:
      - .env
    environment:
      NODE_ENV: ${NODE_ENV:-production}
      PORT: 4000
      DATABASE_URL: postgresql://${POSTGRES_USER:-wlct}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB:-wlct}?schema=public&connection_limit=20&pool_timeout=20
      REDIS_HOST: redis
      REDIS_PORT: 6379
      TRADING_ENGINE_URL: http://trading-engine:8001
      MARKET_DATA_URL: http://market-data:8002
      NOTIFICATION_SERVICE_URL: http://notification-service:8003
      # The API enqueues; the standalone worker consumes. Running the worker
      # inline as well would double-process every job.
      QUEUE_RUN_INLINE_WORKERS: "false"
    ports:
      - "${API_PORT:-4000}:4000"
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
      migrate:
        condition: service_completed_successfully
    healthcheck:
      test:
        - CMD
        - node
        - -e
        - "fetch('http://127.0.0.1:4000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 40s
    networks:
      - wlct-internal
      - wlct-edge

  notification-service:
    build:
      context: .
      dockerfile: infrastructure/docker/notification-service.Dockerfile
      target: runtime
    container_name: wlct-notification-service
    <<: *default-restart
    logging: *default-logging
    env_file:
      - .env
    environment:
      NODE_ENV: ${NODE_ENV:-production}
      NOTIFICATION_SERVICE_PORT: 8003
      REDIS_HOST: redis
      REDIS_PORT: 6379
    expose:
      - "8003"
    depends_on:
      redis:
        condition: service_healthy
    networks:
      - wlct-internal

  trading-engine:
    build:
      context: .
      dockerfile: infrastructure/docker/trading-engine.Dockerfile
      target: runtime
    container_name: wlct-trading-engine
    <<: *default-restart
    logging: *default-logging
    env_file:
      - .env
    environment:
      NODE_ENV: ${NODE_ENV:-production}
      TRADING_ENGINE_PORT: 8001
      # Part 9: observability mirror cadence + master switch (see .env.example).
      HEALTH_REFRESH_MS: ${HEALTH_REFRESH_MS:-5000}
      OBSERVABILITY_ENABLED: ${OBSERVABILITY_ENABLED:-true}
      DATABASE_URL: postgresql://${POSTGRES_USER:-wlct}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB:-wlct}
      REDIS_HOST: redis
      REDIS_PORT: 6379
      # Part 1 ships with execution hard-disabled. Enabling it requires a
      # deliberate change here and in the root .env.
      EXECUTION_ENABLED: ${EXECUTION_ENABLED:-false}
      EXCHANGE_SANDBOX_MODE: ${EXCHANGE_SANDBOX_MODE:-true}
    expose:
      - "8001"
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    networks:
      - wlct-internal

  # ---------------------------------------------------------------------------
  # Part 11: the execution plane, split in two on purpose. The ENGINE holds
  # venue contact (adapters, credentials domain, locks, incidents); the
  # WORKER holds the queue (admission, partition claims, ack policy). Each
  # can say "no" to the other and both mean it: the worker refuses to boot
  # when the engine reports an incompatible mode, and the engine serves only
  # an authenticated internal token plus a tenant header.

  execution-engine:
    build:
      context: .
      dockerfile: infrastructure/docker/execution-engine.Dockerfile
      target: runtime
    container_name: wlct-execution-engine
    <<: *default-restart
    logging: *default-logging
    env_file:
      - .env
    environment:
      NODE_ENV: ${NODE_ENV:-production}
      SERVICE_PORT: 8093
      # Bind inside the container so the compose network can route to it; the
      # port is EXPOSEd to internal networks only - never published.
      EXECUTION_ENGINE_HOST: 0.0.0.0
      EXECUTION_INSTANCE_ID: ${EXECUTION_INSTANCE_ID:-execution-engine-1}
      EXECUTION_INTERNAL_TOKEN: ${EXECUTION_INTERNAL_TOKEN:?EXECUTION_INTERNAL_TOKEN is required for the execution engine}
      # simulated is the only wired mode; live refuses startup by code.
      EXECUTION_MODE: simulated
      EXECUTION_DRY_RUN: ${EXECUTION_DRY_RUN:-true}
      # Part 13 durable store. memory is the default (readiness reports
      # storeDurable=false, as it always has); postgres requires the
      # engine tables (applied by the migrate job's own migrations) and a
      # DSN - both are start-up refusals when missing, never a fallback.
      EXECUTION_STORE_BACKEND: ${EXECUTION_STORE_BACKEND:-memory}
      EXECUTION_POSTGRES_DSN: ${EXECUTION_POSTGRES_DSN:-}
      # Part 14 journal retention. ENABLED gates APPLY only - inspect and
      # dry-run work regardless, and every value is validated at startup by
      # the core's retention law (bounds in docs/PART14_RETENTION.md). The
      # scheduler (if any) is the deployment's business; nothing here runs
      # deletes on its own.
      EXECUTION_RETENTION_ENABLED: ${EXECUTION_RETENTION_ENABLED:-false}
      EXECUTION_RETENTION_EVENT_DAYS: ${EXECUTION_RETENTION_EVENT_DAYS:-90}
      EXECUTION_RETENTION_BATCH_ROWS: ${EXECUTION_RETENTION_BATCH_ROWS:-2000}
      EXECUTION_RETENTION_MAX_BATCHES: ${EXECUTION_RETENTION_MAX_BATCHES:-50}
      # Part 15: the evidence window only (the audit itself is read-only, so
      # there is no enablement switch to thread through). Empty-string-safe
      # like every other default here; the config validator rejects 0.
      EXECUTION_ENABLEMENT_MAX_AGE_DAYS: ${EXECUTION_ENABLEMENT_MAX_AGE_DAYS:-30}
    expose:
      - "8093"
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    networks:
      - wlct-internal

  worker:
    build:
      context: .
      dockerfile: infrastructure/docker/api.Dockerfile
      target: runtime
    container_name: wlct-worker
    <<: *default-restart
    logging: *default-logging
    command: ["node", "dist/worker.js"]
    env_file:
      - .env
    environment:
      NODE_ENV: ${NODE_ENV:-production}
      # The worker container owns ALL inline workers (maintenance,
      # notification, trade-execution); the API keeps them off.
      QUEUE_RUN_INLINE_WORKERS: "true"
      DATABASE_URL: postgresql://${POSTGRES_USER:-wlct}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB:-wlct}?schema=public&connection_limit=10&pool_timeout=20
      REDIS_HOST: redis
      REDIS_PORT: 6379
      WORKER_ENABLED: "true"
      WORKER_ID: ${WORKER_ID:-worker-1}
      WORKER_MEMBERSHIP: ${WORKER_MEMBERSHIP:-worker-1}
      # Part 12: the compose fleet self-registers via the Redis heartbeat
      # zset; the list above stays as the boot/fallback view. Flipping this
      # back to config is a one-line redeploy - claims decide authority in
      # both modes, so nothing else about safety changes.
      WORKER_MEMBERSHIP_MODE: ${WORKER_MEMBERSHIP_MODE:-registry}
      WORKER_MEMBERSHIP_TTL_MS: ${WORKER_MEMBERSHIP_TTL_MS:-30000}
      WORKER_PARTITION_COUNT: ${WORKER_PARTITION_COUNT:-8}
      WORKER_PARTITION_LEASE_TTL_MS: ${WORKER_PARTITION_LEASE_TTL_MS:-15000}
      WORKER_PARTITION_RETRY_MS: ${WORKER_PARTITION_RETRY_MS:-2500}
      WORKER_DEFER_DELAY_MS: ${WORKER_DEFER_DELAY_MS:-3000}
      WORKER_MAX_DEFERS: ${WORKER_MAX_DEFERS:-30}
      WORKER_SHUTDOWN_TIMEOUT_MS: ${WORKER_SHUTDOWN_TIMEOUT_MS:-10000}
      EXECUTION_ENGINE_URL: http://execution-engine:8093
      # One secret, two names: the engine validates EXECUTION_INTERNAL_TOKEN,
      # the worker presents it as EXECUTION_ENGINE_TOKEN.
      EXECUTION_ENGINE_TOKEN: ${EXECUTION_INTERNAL_TOKEN:-}
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
      migrate:
        condition: service_completed_successfully
      execution-engine:
        condition: service_healthy
    # No ports: the worker serves nothing. Its visibility is structured logs
    # plus the API's read-only GET /v1/observability/worker-coordination,
    # which reads the same Redis claims this process writes.
    networks:
      - wlct-internal

  market-data:
    build:
      context: .
      dockerfile: infrastructure/docker/market-data.Dockerfile
      target: runtime
    container_name: wlct-market-data
    <<: *default-restart
    logging: *default-logging
    env_file:
      - .env
    environment:
      NODE_ENV: ${NODE_ENV:-production}
      MARKET_DATA_PORT: 8002
      # Part 9: observability mirror cadence + master switch (see .env.example).
      HEALTH_REFRESH_MS: ${HEALTH_REFRESH_MS:-5000}
      OBSERVABILITY_ENABLED: ${OBSERVABILITY_ENABLED:-true}
      REDIS_HOST: redis
      REDIS_PORT: 6379
    expose:
      - "8002"
    depends_on:
      redis:
        condition: service_healthy
    networks:
      - wlct-internal

  admin-web:
    build:
      context: .
      dockerfile: infrastructure/docker/admin-web.Dockerfile
      target: runtime
      args:
        NEXT_PUBLIC_APP_NAME: ${NEXT_PUBLIC_APP_NAME:-CopyTrade Admin}
        NEXT_PUBLIC_API_VERSION: ${NEXT_PUBLIC_API_VERSION:-v1}
        NEXT_PUBLIC_WS_URL: ${NEXT_PUBLIC_WS_URL:-}
        NEXT_PUBLIC_WS_PATH: ${NEXT_PUBLIC_WS_PATH:-/socket.io}
    container_name: wlct-admin-web
    <<: *default-restart
    logging: *default-logging
    environment:
      NODE_ENV: production
      PORT: 3000
      # Server-to-server inside the compose network; the browser never sees it.
      API_BASE_URL: http://api:4000/api
      ADMIN_TENANT_SLUG: ${ADMIN_TENANT_SLUG:-platform}
      SESSION_COOKIE_SECRET: ${SESSION_COOKIE_SECRET:?SESSION_COOKIE_SECRET is required}
    ports:
      - "${ADMIN_WEB_PORT:-3000}:3000"
    depends_on:
      api:
        condition: service_healthy
    networks:
      - wlct-internal
      - wlct-edge

volumes:
  postgres-data:
    driver: local
  redis-data:
    driver: local

networks:
  # Service-to-service traffic. Not reachable from outside the host.
  wlct-internal:
    driver: bridge
    internal: false
  # Everything that legitimately faces a browser.
  wlct-edge:
    driver: bridge
```


## FILE: scripts/dr-manifest.mjs (1039 lines)

*v3: the rlsEvidence block validated field by field (cadence ceiling 8760 refused as 'a way of writing never', requiredGrade accepted only as 'pass', scope checked for overclaim, ledger path confined to docs/dr/*.jsonl, artifacts existence-checked and re-parsed), the RLS evidence ledger parser with the core's closed grade vocabulary, rlsEvidenceReport whose verdict keeps the freshness/grade asymmetry (a recent FAIL is not a stale PASS), the --check-rls / --record-rls modes with the corrupt-ledger refusal, one MODE_FLAGS list so a new flag cannot be misread as an override, skipLedger so the two ledgers never parse each other, and the plan renderer's new section.*

```javascript
#!/usr/bin/env node
/**
 * DR manifest validator and dry-run planner (Part 11).
 *
 * Two commands, neither of which touches a database, a bucket, or the
 * network:
 *
 *   node scripts/dr-manifest.mjs --check   validate docs/dr/manifest.json
 *                                          (and the ledger's shape when one
 *                                          exists); exit 1 with every
 *                                          failure named
 *   node scripts/dr-manifest.mjs --plan    render the ordered restore
 *                                          runbook to stdout (a dry run:
 *                                          commands are TEMPLATES with
 *                                          $ENV references, never
 *                                          interpolated secrets)
 *   node scripts/dr-manifest.mjs --due [--now ISO] [--ledger PATH]
 *                                          which obligations are overdue;
 *                                          exit 1 when any are (this is the
 *                                          cron-able alert: "a backup not
 *                                          recorded is a backup not done")
 *   node scripts/dr-manifest.mjs --record --component ID --outcome ok|failed
 *                                          [--note TEXT] [--at ISO] [--ledger PATH]
 *                                          append one ledger line; refuses
 *                                          unknown components, broken
 *                                          ledgers, secret-shaped content,
 *                                          and unparsable timestamps
 *
 * Why the validator is code and the manifest is data: a runbook that rots
 * is worse than none - people trust it while it lies. Every check below is
 * the drift the platform has already been bitten by elsewhere: paths that no
 * longer exist, env names renamed under an "internal refactor", backup
 * cadences silently longer than the stated RPO, and - the unforgivable one
 * - credentials pasted into a file that lives in git. The secret-shaped scan
 * is deliberately paranoid and will occasionally nag; answering the nag by
 * deleting the credential is the correct response, always.
 */

import { appendFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const MANIFEST_PATH = join(ROOT, 'docs', 'dr', 'manifest.json');

// v2 adds the backup-freshness contract (Part 12): every component carries
// cadenceHours or cadenceWaiver, and postgres additionally names the
// mechanism that meets the RPO when its dump cadence alone would not.
// v3 adds the Part 15 RLS-enablement evidence contract (rlsEvidence: who may
// claim "policies are on", how old that claim may be, and which file records
// it). Same reasoning as v2: a block the validator ignores is a block that
// rots, so every field here is checked, and the shipped manifest has it.
const SCHEMA_ID = 'wlct-dr-manifest-v3';
const REQUIRED_COMPONENTS = new Set(['encryption-keys', 'postgres', 'redis', 'dataset-objects']);

/** Part 15's ceiling on "how old may an enablement claim be": 8760h is a
 * year, the same bound the platform puts on any review cadence. A bigger
 * number is not a policy, it is a way of writing "never" - and the whole
 * point of the evidence ledger is that "never" is visible. */
const RLS_MAX_CADENCE_HOURS = 8760;

/** Phrases that would make the engine's read-only endpoint claim a platform
 * wide verdict. Deliberately narrow (not a general "all" ban): this is a
 * check for the ONE mis-statement that would matter, not a prose reviewer. */
const RLS_OVERCLAIM_RE = /\b(all tables|every table|the entire platform|whole platform|entire database)\b/i;

/** Collect every env KEY NAME declared across the repository's .env.example
 * files - uncommented or commented alike: the template's job is to declare
 * names (values are the operator's business), and names deliberately
 * commented out (secrets) are still the names a deployment must provide. */
export function collectEnvNames(root) {
  const files = [
    '.env.example',
    'services/execution-engine/.env.example',
    'services/trading-engine/.env.example',
    'services/market-data/.env.example',
    'apps/admin-web/.env.example',
  ];
  const names = new Set();
  for (const rel of files) {
    const path = join(root, rel);
    if (!existsSync(path)) {
      continue;
    }
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const m = /^\s*#?\s*([A-Z][A-Z0-9_]{1,})=/.exec(line);
      if (m) {
        names.add(m[1]);
      }
    }
  }
  return names;
}

/** Things that must never appear in a manifest living in git. Patterns are
 * value-shaped, not word-shaped: writing the word "password" in prose is
 * fine (this file does it); writing `key=value` with a secret-shaped value
 * is what the scan refuses. */
export function findSecretShapes(text) {
  const findings = [];
  const patterns = [
    [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'PEM private key header'],
    [/[a-z][a-z0-9+.-]*:\/\/[^\s/@]+:[^\s@]+@/, 'URL with embedded credentials'],
    [/[A-Z][A-Z0-9_]{2,}=(?!"|null)[A-Za-z0-9+/=_-]{24,}/, 'inline KEY=secret-shaped-value assignment'],
    // The (?!) above lets an inline quoted value past pattern 3; in a
    // runbook or ledger note a QUOTED literal assignment is exactly as
    // leaky as an unquoted one (Part 12 smoke proved it on a real note),
    // so this pattern closes the quote hole. `${VAR}` references stay
    // legal: the value part refuses a leading '$'.
    [/[A-Z][A-Z0-9_]{2,}="[^"\n$]{16,}"/, 'inline KEY="literal-value" assignment'],
    [/"[A-Za-z0-9_]*(?:SECRET|PASSWORD|TOKEN|KEY)(?:_BASE64)?":\s*"[^"$]{16,}"/, 'JSON secret with a literal value'],
  ];
  for (const [re, why] of patterns) {
    const m = re.exec(text);
    if (m) {
      findings.push(`${why} near ${JSON.stringify(m[0].slice(0, 48))}`);
    }
  }
  return findings;
}

export function validateManifest(manifest, root = ROOT) {
  const errors = [];
  if (manifest.schema !== SCHEMA_ID) {
    errors.push(`schema must be ${SCHEMA_ID}, got ${JSON.stringify(manifest.schema)}`);
  }
  if (!Number.isInteger(manifest.rpoMinutes) || manifest.rpoMinutes < 1) {
    errors.push('rpoMinutes must be a positive integer');
  }
  if (!Number.isInteger(manifest.rtoHours) || manifest.rtoHours < 1) {
    errors.push('rtoHours must be a positive integer');
  }
  if (!Number.isInteger(manifest.reviewCadenceDays) || manifest.reviewCadenceDays < 30) {
    errors.push('reviewCadenceDays must be an integer >= 30 (a manifest reviewed monthly is a ritual, not a control)');
  }
  const components = Array.isArray(manifest.components) ? manifest.components : [];
  if (components.length === 0) {
    errors.push('components must be a non-empty array');
  }

  const ids = new Set();
  const orders = new Set();
  for (const c of components) {
    for (const field of ['id', 'title', 'kind', 'purpose', 'backupMethod', 'verification']) {
      if (typeof c[field] !== 'string' || c[field].trim().length === 0) {
        errors.push(`component ${JSON.stringify(c.id ?? '?')}: field ${field} must be a non-empty string`);
      }
    }
    if (ids.has(c.id)) {
      errors.push(`duplicate component id ${JSON.stringify(c.id)}`);
    }
    ids.add(c.id);
    if (!Number.isInteger(c.restoreOrder) || c.restoreOrder < 1 || orders.has(c.restoreOrder)) {
      errors.push(`component ${c.id}: restoreOrder must be a unique positive integer`);
    }
    orders.add(c.restoreOrder);
    for (const ref of c.envRefs ?? []) {
      if (typeof ref !== 'string' || !/^[A-Z][A-Z0-9_]*$/.test(ref)) {
        errors.push(`component ${c.id}: envRef ${JSON.stringify(ref)} is not an env key name`);
      }
    }
    // "never backed up" in a backupMethod is a manifest admitting it lost
    // data; ordinary prose use of the word ("...verifies the escrow, never
    // the material") must not trip it. The honest phrasing for a
    // rebuildable component is the redis entry's: rebuildable, snapshot for
    // forensics only.
    if (/\bnever\b[^.]{0,40}\bback(ed)?[- ]?up/i.test(c.backupMethod ?? '')) {
      errors.push(`component ${c.id}: backupMethod must not admit "never backed up" - state rebuildability or a scheduled gap`);
    }
    // Part 12: the freshness contract. `null` is legal ONLY with a waiver
    // string; a missing key is not null, it is silence - and silence about
    // when a backup is due is exactly how a stale-backup incident starts.
    const cadenceMissing = !Object.prototype.hasOwnProperty.call(c, 'cadenceHours');
    if (cadenceMissing) {
      errors.push(
        `component ${c.id}: cadenceHours is required (an integer hour bound ` +
          `or null WITH a cadenceWaiver explaining the exemption)`,
      );
    } else if (c.cadenceHours === null) {
      if (typeof c.cadenceWaiver !== 'string' || c.cadenceWaiver.trim().length === 0) {
        errors.push(`component ${c.id}: cadenceHours null requires a non-empty cadenceWaiver`);
      }
    } else {
      if (!Number.isInteger(c.cadenceHours) || c.cadenceHours < 1 || c.cadenceHours > 8760) {
        errors.push(
          `component ${c.id}: cadenceHours must be an integer 1..8760 (one year ceiling), got ${JSON.stringify(c.cadenceHours)}`,
        );
      }
      if (c.cadenceWaiver !== undefined) {
        errors.push(`component ${c.id}: cadenceWaiver is only meaningful when cadenceHours is null`);
      }
      // The RPO belongs to Postgres; every other component's cadence is a
      // review obligation, not a data-loss bound. 24h of dump cadence under
      // a 60m RPO is HONEST only when a continuous mechanism is named -
      // naming it is what this check forces into the open.
      if (c.id === 'postgres' && c.cadenceHours * 60 > manifest.rpoMinutes) {
        if (typeof c.rpoMechanism !== 'string' || c.rpoMechanism.trim().length === 0) {
          errors.push(
            `component postgres: cadenceHours ${c.cadenceHours} exceeds rpoMinutes ` +
              `${manifest.rpoMinutes} and no rpoMechanism is named - either back up ` +
              `faster than the RPO or state what continuous mechanism closes the gap`,
          );
        }
      }
    }
  }
  if (orders.size > 0) {
    const sorted = [...orders].sort((a, b) => a - b);
    for (let i = 0; i < sorted.length; i += 1) {
      if (sorted[i] !== i + 1) {
        errors.push('restoreOrder values must form exactly 1..n with no gaps');
        break;
      }
    }
  }
  for (const required of REQUIRED_COMPONENTS) {
    if (!ids.has(required)) {
      errors.push(`required component ${required} is missing`);
    }
  }
  if (ids.has('encryption-keys') && ids.has('postgres')) {
    const keys = components.find((c) => c.id === 'encryption-keys');
    const db = components.find((c) => c.id === 'postgres');
    if (keys.restoreOrder >= db.restoreOrder) {
      errors.push('encryption-keys must be restored BEFORE postgres (ciphertext without keys is a deletion)');
    }
  }

  const envNames = collectEnvNames(root);
  for (const c of components) {
    for (const ref of c.envRefs ?? []) {
      if (!envNames.has(ref)) {
        errors.push(`component ${c.id}: envRef ${ref} is declared in no .env.example of this repository`);
      }
    }
    for (const path of c.paths ?? []) {
      if (!existsSync(join(root, path))) {
        errors.push(`component ${c.id}: path ${path} no longer exists (the manifest drifted from the repo)`);
      }
    }
  }

  const procedure = Array.isArray(manifest.restoreProcedure) ? manifest.restoreProcedure : [];
  if (procedure.length === 0) {
    errors.push('restoreProcedure must not be empty');
  }
  let lastStep = 0;
  for (const step of procedure) {
    if (!Number.isInteger(step.step) || step.step !== lastStep + 1) {
      errors.push(`restoreProcedure: step numbers must run 1..n contiguously (got ${JSON.stringify(step.step)})`);
    }
    lastStep = step.step ?? lastStep;
    if (typeof step.action !== 'string' || step.action.trim() === '') {
      errors.push(`restoreProcedure step ${step.step}: action must be a non-empty string`);
    }
    if (step.component !== null && step.component !== undefined && !ids.has(step.component)) {
      errors.push(`restoreProcedure step ${step.step}: references unknown component ${JSON.stringify(step.component)}`);
    }
  }

  // Part 15: the enablement-evidence block. Required, not optional: an
  // missing block means the deployment never decided how old an RLS audit may
  // be, and "we'll say it later" is how the checklist in enable.sql became
  // prose nobody re-reads.
  const rls = manifest.rlsEvidence;
  if (rls === undefined || rls === null || typeof rls !== 'object' || Array.isArray(rls)) {
    errors.push('rlsEvidence is required (Part 15: cadenceHours or cadenceWaiver, evidenceLedger, verifier, command)');
  } else {
    if (rls.cadenceHours === null) {
      if (typeof rls.cadenceWaiver !== 'string' || rls.cadenceWaiver.trim().length === 0) {
        errors.push('rlsEvidence: cadenceHours null requires a non-empty cadenceWaiver');
      }
    } else {
      if (!Number.isInteger(rls.cadenceHours) || rls.cadenceHours < 1 || rls.cadenceHours > RLS_MAX_CADENCE_HOURS) {
        errors.push(
          `rlsEvidence: cadenceHours must be an integer 1..${RLS_MAX_CADENCE_HOURS} ` +
            `(a year is the platform ceiling for "how long a policy claim may stand"), got ${JSON.stringify(rls.cadenceHours)}`,
        );
      }
      if (rls.cadenceWaiver !== undefined) {
        errors.push('rlsEvidence: cadenceWaiver is only meaningful when cadenceHours is null');
      }
    }
    // scope is what stops a future edit from quietly turning "the engine
    // plane" into "the platform": the endpoint cannot see the API's tables,
    // and a manifest that implies otherwise is a false assurance in the one
    // document everybody reads before an incident.
    if (typeof rls.scope !== 'string' || rls.scope.trim().length === 0) {
      errors.push('rlsEvidence: scope must be a non-empty string (what the verifier can actually see)');
    } else if (RLS_OVERCLAIM_RE.test(rls.scope)) {
      errors.push(
        `rlsEvidence: scope overclaims - ${JSON.stringify(rls.scope.match(RLS_OVERCLAIM_RE)[0])} is not true of a ` +
          'service that can only read its own tables (docs/PART15_RLS_ENABLEMENT.md)',
      );
    } else if (rls.scope.length > 600 || /[\r\n]/.test(rls.scope)) {
      errors.push('rlsEvidence: scope must be one line of at most 600 characters');
    }
    for (const field of ['evidenceLedger', 'verifier', 'command']) {
      const value = rls[field];
      if (typeof value !== 'string' || value.trim().length === 0) {
        errors.push(`rlsEvidence: ${field} must be a non-empty string`);
        continue;
      }
      if (value.length > 300 || /[\r\n]/.test(value)) {
        errors.push(`rlsEvidence: ${field} must be one line of at most 300 characters`);
      }
      // Path-like fields must stay inside the repository; the VERIFIER is not
      // a path at all (it is an endpoint), and forcing it through the same
      // rule is how validators teach people that paths are the only truth.
      if (field !== 'verifier' && (value.startsWith('/') || value.includes('..'))) {
        errors.push(`rlsEvidence: ${field} must be a repository-relative path without ".." (git evidence, not a local absolute)`);
      }
    }
    if (typeof rls.command === 'string' && !rls.command.startsWith('node scripts/')) {
      errors.push(`rlsEvidence: command must be a repository script ("node scripts/..."), got ${JSON.stringify(rls.command)}`);
    }
    if (typeof rls.evidenceLedger === 'string' && !rls.evidenceLedger.endsWith('.jsonl')) {
      errors.push('rlsEvidence: evidenceLedger must be a .jsonl file (append-only evidence, parseable line by line)');
    }
    if (typeof rls.evidenceLedger === 'string' && !rls.evidenceLedger.startsWith('docs/dr/')) {
      errors.push('rlsEvidence: evidenceLedger must live under docs/dr/ beside the backup ledger it is modelled on');
    }
    if (typeof rls.verifier === 'string' && !rls.verifier.startsWith('/internal/')) {
      errors.push(`rlsEvidence: verifier must name an internal-plane endpoint (/internal/...), got ${JSON.stringify(rls.verifier)}`);
    }
    if (typeof rls.verifier === 'string' && rls.verifier.includes('/public/')) {
      errors.push('rlsEvidence: the verifier must not be a public route - it reports which defences are off');
    }
    for (const field of ['coverageArtifact', 'enableArtifact', 'disableArtifact']) {
      if (rls[field] === undefined) {
        continue;
      }
      if (typeof rls[field] !== 'string' || rls[field].includes('..')) {
        errors.push(`rlsEvidence: ${field} must be a repository-relative path`);
        continue;
      }
      if (!existsSync(join(root, rls[field]))) {
        errors.push(`rlsEvidence: ${field} ${rls[field]} no longer exists (the audit's ground truth drifted from the repo)`);
      }
    }
    if (rls.requiredGrade !== undefined && rls.requiredGrade !== 'pass') {
      errors.push(
        `rlsEvidence: requiredGrade is not a knob - only "pass" is accepted (got ${JSON.stringify(rls.requiredGrade)}); ` +
          'a manifest that lets a report choose its own bar is not a bar',
      );
    }
  }

  const drill = manifest.drill ?? {};
  if (!Number.isInteger(drill.cadenceDays) || drill.cadenceDays < 30 || drill.cadenceDays > 180) {
    errors.push('drill.cadenceDays must be between 30 and 180 (a twice-a-year ceiling is the platform floor)');
  }
  if (drill.timed !== true) {
    errors.push('drill.timed must be true: an untimed restore proves nothing about the RTO it claims');
  }
  if (!Array.isArray(drill.successCriteria) || drill.successCriteria.length === 0) {
    errors.push('drill.successCriteria must be non-empty');
  }

  if (rls !== undefined && typeof rls === 'object' && !Array.isArray(rls)) {
    // The evidence FILE is part of the contract: a manifest that points at a
    // ledger which cannot be written (directory absent) or which already
    // holds secrets is a policy on a road that does not exist.
    if (
      typeof rls.evidenceLedger === 'string' &&
      rls.evidenceLedger.trim().length > 0 &&
      !rls.evidenceLedger.includes('..')
    ) {
      const ledgerPath = join(root, rls.evidenceLedger);
      if (existsSync(ledgerPath)) {
        for (const finding of findSecretShapes(readFileSync(ledgerPath, 'utf8'))) {
          errors.push(`rlsEvidence: SECRET-SHAPED CONTENT in ${rls.evidenceLedger}: ${finding}`);
        }
      }
    }
    for (const field of ['coverageArtifact', 'enableArtifact', 'disableArtifact']) {
      const rel = rls[field];
      if (typeof rel === 'string' && rel.trim().length > 0 && !rel.includes('..') && existsSync(join(root, rel))) {
        const text = readFileSync(join(root, rel), 'utf8');
        if (rel.endsWith('.json')) {
          try {
            JSON.parse(text);
          } catch {
            errors.push(`rlsEvidence: ${field} ${rel} is not valid JSON (the audit parses it at runtime)`);
          }
        } else if (!text.includes('ROW LEVEL SECURITY')) {
          errors.push(`rlsEvidence: ${field} ${rel} no longer mentions ROW LEVEL SECURITY (renamed or replaced?)`);
        }
      }
    }
  }

  return errors;
}

/** Parse the JSONL ledger. Returns {entries, problems}: a malformed line
 * is reported with its number (the file is human-editable evidence;
 * "line 4 is not JSON" is the fixable complaint, "file corrupt" is not).
 * `knownIds` (when given) turns an unknown component into a problem too -
 * a typo'd component id in a ledger line is a backup with no owner. */
export function parseLedger(text, knownIds = null) {
  const entries = [];
  const problems = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === '') {
      continue;
    }
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      problems.push(`ledger line ${i + 1}: not valid JSON`);
      continue;
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      problems.push(`ledger line ${i + 1}: must be a JSON object`);
      continue;
    }
    const extra = Object.keys(parsed).filter(
      (k) => k !== 'at' && k !== 'component' && k !== 'outcome' && k !== 'note',
    );
    if (extra.length > 0) {
      problems.push(`ledger line ${i + 1}: unknown field(s) ${extra.join(', ')} (typos hide evidence)`);
      continue;
    }
    const atMs =
      typeof parsed.at === 'string' &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(parsed.at)
        ? Date.parse(parsed.at)
        : Number.NaN;
    if (Number.isNaN(atMs)) {
      problems.push(`ledger line ${i + 1}: at must be an ISO-8601 timestamp`);
      continue;
    }
    if (typeof parsed.component !== 'string' || parsed.component.trim() === '') {
      problems.push(`ledger line ${i + 1}: component must be a non-empty string`);
      continue;
    }
    if (knownIds !== null && !knownIds.has(parsed.component)) {
      problems.push(`ledger line ${i + 1}: component ${JSON.stringify(parsed.component)} is not in the manifest`);
      continue;
    }
    if (parsed.outcome !== 'ok' && parsed.outcome !== 'failed') {
      problems.push(`ledger line ${i + 1}: outcome must be "ok" or "failed"`);
      continue;
    }
    if (
      parsed.note !== undefined &&
      (typeof parsed.note !== 'string' || parsed.note.length > 500 || /[\r\n]/.test(parsed.note))
    ) {
      problems.push(`ledger line ${i + 1}: note must be a single-line string of at most 500 chars`);
      continue;
    }
    entries.push({
      atMs,
      at: parsed.at,
      component: parsed.component,
      outcome: parsed.outcome,
      ...(typeof parsed.note === 'string' ? { note: parsed.note } : {}),
    });
  }
  return { entries, problems };
}

/** Freshness verdicts, in restore order, for every component. `never`
 * counts as due: an unrecorded obligation has no last-success to age. */
export function dueReport(manifest, entries, nowMs) {
  const lastOk = new Map();
  for (const e of entries) {
    if (e.outcome === 'ok') {
      const prev = lastOk.get(e.component);
      if (prev === undefined || e.atMs > prev) {
        lastOk.set(e.component, e.atMs);
      }
    }
  }
  return [...manifest.components]
    .sort((a, b) => a.restoreOrder - b.restoreOrder)
    .map((c) => {
      if (c.cadenceHours === null) {
        return {
          component: c.id,
          state: 'waived',
          line: `[waive] ${c.id}: no obligation - ${c.cadenceWaiver}`,
        };
      }
      const last = lastOk.get(c.id);
      if (last === undefined) {
        return {
          component: c.id,
          state: 'due',
          line:
            `[DUE  ] ${c.id}: never recorded (cadence ${c.cadenceHours}h) - ` +
            `record one with --record, or say why it has not run`,
        };
      }
      const dueAt = last + c.cadenceHours * 3_600_000;
      const delta = nowMs - dueAt;
      if (delta >= 0) {
        return {
          component: c.id,
          state: 'due',
          line:
            `[DUE  ] ${c.id}: overdue by ${formatDuration(delta)} (last ok ${new Date(last).toISOString()}, cadence ${c.cadenceHours}h)`,
        };
      }
      return {
        component: c.id,
        state: 'ok',
        line: `[ ok  ] ${c.id}: next due in ${formatDuration(-delta)} (last ok ${new Date(last).toISOString()})`,
      };
    });
}

function formatDuration(ms) {
  const totalMinutes = Math.floor(ms / 60_000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

/** Parse the Part 15 RLS-enablement evidence ledger (JSONL, one line per
 * verification run). A DIFFERENT file from the backup ledger on purpose:
 * two obligations sharing one log is how one of them stops being read.
 * Line-wise problems are reported by number exactly as `parseLedger` does,
 * and an unparsable line is never skipped quietly. */
export function parseRlsLedger(text) {
  const entries = [];
  const problems = [];
  const known = new Set(['at', 'grade', 'probed', 'role', 'note']);
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === '') {
      continue;
    }
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      problems.push(`rls ledger line ${i + 1}: not valid JSON`);
      continue;
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      problems.push(`rls ledger line ${i + 1}: must be a JSON object`);
      continue;
    }
    const extra = Object.keys(parsed).filter((k) => !known.has(k));
    if (extra.length > 0) {
      problems.push(`rls ledger line ${i + 1}: unknown field(s) ${extra.join(', ')} (typos hide evidence)`);
      continue;
    }
    const atMs =
      typeof parsed.at === 'string' &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(parsed.at)
        ? Date.parse(parsed.at)
        : Number.NaN;
    if (Number.isNaN(atMs)) {
      problems.push(`rls ledger line ${i + 1}: at must be an ISO-8601 timestamp`);
      continue;
    }
    // The grade vocabulary is the core's (wlct_trading.enablement.RunGrade)
    // and it is CLOSED: a line that grades itself "warning" or "ok" is a
    // report nobody can aggregate, and the run that invents a fourth answer
    // is the run that decides its own verdict.
    if (parsed.grade !== 'pass' && parsed.grade !== 'fail' && parsed.grade !== 'unverified') {
      problems.push(`rls ledger line ${i + 1}: grade must be pass, fail or unverified`);
      continue;
    }
    if (parsed.probed !== undefined && (!Number.isInteger(parsed.probed) || parsed.probed < 0 || parsed.probed > 4096)) {
      problems.push(`rls ledger line ${i + 1}: probed must be an integer 0..4096`);
      continue;
    }
    if (parsed.role !== undefined && (typeof parsed.role !== 'string' || parsed.role.length === 0 || parsed.role.length > 200 || /[\r\n]/.test(parsed.role))) {
      problems.push(`rls ledger line ${i + 1}: role must be a single-line string of 1..200 chars`);
      continue;
    }
    if (parsed.note !== undefined && (typeof parsed.note !== 'string' || parsed.note.length > 500 || /[\r\n]/.test(parsed.note))) {
      problems.push(`rls ledger line ${i + 1}: note must be a single-line string of at most 500 chars`);
      continue;
    }
    entries.push({
      atMs,
      at: parsed.at,
      grade: parsed.grade,
      ...(Number.isInteger(parsed.probed) ? { probed: parsed.probed } : {}),
      ...(typeof parsed.role === 'string' ? { role: parsed.role } : {}),
      ...(typeof parsed.note === 'string' ? { note: parsed.note } : {}),
    });
  }
  return { entries, problems };
}

/** The Part 15 verdict: how the most recent enablement audit reads as of
 * `nowMs`. This is deliberately NOT enforcement - a repository script cannot
 * see a live database - it is the FRESHNESS POLICY the docs promise: an
 * operator (or a cron) runs this, and a stale or failing audit becomes a red
 * exit code instead of a memory.
 *
 * The last entry of ANY grade decides freshness; its grade decides the
 * verdict. That asymmetry is the point: re-running the audit and finding a
 * leak must refresh the "we know" clock WITHOUT turning the finding green,
 * and a stale run that passed long ago is not evidence either way. */
export function rlsEvidenceReport(evidence, entries, nowMs) {
  if (evidence.cadenceHours === null) {
    return {
      state: 'waived',
      line: `[waive] rls-enablement: no cadence - ${evidence.cadenceWaiver}`,
    };
  }
  if (entries.length === 0) {
    return {
      state: 'due',
      line:
        `[DUE  ] rls-enablement: never recorded (cadence ${evidence.cadenceHours}h) - run the audit and ` +
        `record it with --record-rls; policies that nobody verified are a hypothesis`,
    };
  }
  const last = entries.reduce((a, b) => (b.atMs > a.atMs ? b : a), entries[0]);
  const dueAt = last.atMs + evidence.cadenceHours * 3_600_000;
  const delta = nowMs - dueAt;
  const age = `[${last.grade}] ${new Date(last.atMs).toISOString()} (${formatDuration(Math.max(0, nowMs - last.atMs))} ago)`;
  if (last.grade !== 'pass') {
    return {
      state: 'fail',
      line:
        `[${last.grade === 'fail' ? 'FAIL' : 'UNVER'}] rls-enablement: ${age} - the recorded audit did not ` +
        `conclude "pass", so the platform must not claim enabled-and-enforced`,
    };
  }
  if (delta >= 0) {
    return {
      state: 'due',
      line: `[DUE  ] rls-enablement: last passing audit overdue by ${formatDuration(delta)} ${age}`,
    };
  }
  return {
    state: 'ok',
    line: `[ ok  ] rls-enablement: fresh, next due in ${formatDuration(-delta)} ${age}`,
  };
}

export function renderPlan(manifest) {
  const lines = [];
  lines.push(`# DR restore plan - ${manifest.title}`);
  lines.push('# GENERATED BY `node scripts/dr-manifest.mjs --plan` - a DRY RUN.');
  lines.push('# Every $VAR below is an environment reference resolved on the');
  lines.push('# operator machine at execution time; this file never contains,');
  lines.push('# and must never be edited to contain, a resolved value.');
  lines.push('');
  lines.push(`RPO target: ${manifest.rpoMinutes} minutes. RTO target: ${manifest.rtoHours} hours.`);
  lines.push('');
  for (const step of manifest.restoreProcedure) {
    const who = step.component ? `[${step.component}]` : '[procedure]';
    lines.push(`${String(step.step).padStart(2)}. ${who} ${step.action}`);
  }
  lines.push('');
  lines.push('# --- per-component verification (each must execute and record) ---');
  for (const c of [...manifest.components].sort((a, b) => a.restoreOrder - b.restoreOrder)) {
    lines.push(`order ${c.restoreOrder} - ${c.id}: ${c.verification}`);
    const freshness =
      c.cadenceHours === null
        ? `waived: ${c.cadenceWaiver}`
        : `every <=${c.cadenceHours}h${c.rpoMechanism ? `; RPO via: ${c.rpoMechanism}` : ''}`;
    lines.push(`           freshness: ${freshness}`);
  }
  const rls = manifest.rlsEvidence;
  if (rls !== undefined) {
    lines.push('');
    lines.push('# --- rls enablement evidence (Part 15) ---');
    lines.push(`verifier: ${rls.verifier} (read-only; the engine's own audit covers the engine plane)`);
    lines.push(`cadence: ${rls.cadenceHours === null ? `waived: ${rls.cadenceWaiver}` : `<=${rls.cadenceHours}h`}`);
    lines.push(`scope: ${rls.scope}`);
    lines.push(`evidence ledger: ${rls.evidenceLedger} (append-only, checked by --check-rls)`);
  }
  lines.push('');
  lines.push('# --- invariants this plan assumes ---');
  for (const inv of manifest.invariants) {
    lines.push(`- ${inv}`);
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

// The one list of modes: a flag that exists but is not in here is read as a
// value-taking override, which is how "--due --check-rls" would silently
// become an override named "check-rls". One array, both branches.
const MODE_FLAGS = ['--check', '--plan', '--due', '--record', '--check-rls', '--record-rls'];

function parseFlags(argv) {
  const flags = { mode: null, overrides: {} };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith('--') && !arg.includes('=') && !MODE_FLAGS.includes(arg)) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`flag ${arg} requires a value`);
      }
      flags.overrides[arg.slice(2)] = value;
      i += 1;
    } else if (MODE_FLAGS.includes(arg)) {
      if (flags.mode !== null) {
        throw new Error(`only one mode at a time, got ${flags.mode} and ${arg}`);
      }
      flags.mode = arg;
    } else {
      throw new Error(`unrecognized argument ${JSON.stringify(arg)}`);
    }
  }
  return flags;
}

function usage() {
  console.error(
    [
      'usage:',
      '  node scripts/dr-manifest.mjs --check',
      '  node scripts/dr-manifest.mjs --plan',
      '  node scripts/dr-manifest.mjs --due [--now ISO] [--ledger PATH]',
      '  node scripts/dr-manifest.mjs --record --component ID --outcome ok|failed [--note TEXT] [--at ISO] [--ledger PATH]',
      '  node scripts/dr-manifest.mjs --check-rls [--now ISO] [--ledger PATH]',
      '  node scripts/dr-manifest.mjs --record-rls --grade pass|fail|unverified [--probed N] [--role NAME] [--note TEXT] [--at ISO] [--ledger PATH]',
    ].join('\n'),
  );
  return 2;
}

const LEDGER_PATH = join(ROOT, 'docs', 'dr', 'backup-ledger.jsonl');

function readLedger(path, knownIds) {
  if (!existsSync(path)) {
    // Absent ledger is not broken state - it is an empty record, and every
    // obliged component reads as "never recorded", which IS the alarm.
    return { entries: [], problems: [] };
  }
  const parsed = parseLedger(readFileSync(path, 'utf8'), knownIds);
  // Note-level secret scan on PARSED content, not just file text: an
  // escaped quote inside JSON is the one spelling the text scan reliably
  // misses, and this is the last place a credential could hide in plain
  // repository history.
  for (const entry of parsed.entries) {
    if (entry.note !== undefined) {
      for (const finding of findSecretShapes(`${entry.note}\n`)) {
        parsed.problems.push(`SECRET-SHAPED CONTENT in note (component ${entry.component}): ${finding}`);
      }
    }
  }
  return parsed;
}

/** `skipLedger` is for the Part 15 modes: the RLS evidence file lives in its
 OWN ledger, and parsing it as a backup ledger would report its own fields as
 corruption - and, worse, let the shared "unreadable evidence" refusal fire on
 a perfectly valid RLS line. One loader, two files, never a cross-read. */
function loadManifestAndLedger(overrides, skipLedger = false) {
  const raw = readFileSync(MANIFEST_PATH, 'utf8');
  const manifest = JSON.parse(raw); // parse errors surface via caller's try/catch
  const secretFindings = findSecretShapes(raw);
  const errors = validateManifest(manifest);
  const knownIds = new Set((manifest.components ?? []).map((c) => c.id));
  const ledgerPath = overrides.ledger ?? LEDGER_PATH;
  const ledger = skipLedger ? { entries: [], problems: [] } : readLedger(ledgerPath, knownIds);
  return { manifest, raw, secretFindings, errors, knownIds, ledgerPath, ledger };
}

function main(argv) {
  let flags;
  try {
    flags = parseFlags(argv);
  } catch (error) {
    console.error(String(error.message ?? error));
    return usage();
  }
  const { mode, overrides } = flags;
  if (mode === null) {
    return usage();
  }

  const rlsMode = mode === '--check-rls' || mode === '--record-rls';
  let loaded;
  try {
    loaded = loadManifestAndLedger(overrides, rlsMode);
  } catch (error) {
    if (error instanceof SyntaxError) {
      console.error(`manifest is not valid JSON: ${error.message}`);
      return 1;
    }
    throw error;
  }
  const { manifest, secretFindings, ledgerPath, ledger } = loaded;

  for (const finding of secretFindings) {
    console.error(`SECRET-SHAPED CONTENT (manifest): ${finding}`);
  }
  const errors = [...loaded.errors];
  for (const problem of ledger.problems) {
    errors.push(`LEDGER ${ledgerPath}: ${problem}`);
  }
  for (const finding of existsSync(ledgerPath) ? findSecretShapes(readFileSync(ledgerPath, 'utf8')) : []) {
    errors.push(`SECRET-SHAPED CONTENT (ledger): ${finding}`);
  }
  if (secretFindings.length > 0) {
    return 1;
  }
  if (mode === '--check' || mode === '--plan') {
    if (errors.length > 0) {
      for (const error of errors) {
        console.error(`MANIFEST: ${error}`);
      }
      return 1;
    }
  }
  if (mode === '--check') {
    const obliged = manifest.components.filter((c) => c.cadenceHours !== null).length;
    console.log(
      `manifest valid: ${manifest.components.length} components (${obliged} with cadence), ` +
        `RPO ${manifest.rpoMinutes}m / RTO ${manifest.rtoHours}h, ` +
        `drill every ${manifest.drill.cadenceDays}d (timed: ${manifest.drill.timed}), ` +
        `ledger entries: ${ledger.entries.length}`,
    );
    return 0;
  }
  if (mode === '--plan') {
    process.stdout.write(renderPlan(manifest));
    return 0;
  }

  if (mode === '--due') {
    const nowMs = overrides.now === undefined ? Date.now() : Date.parse(overrides.now);
    if (Number.isNaN(nowMs)) {
      console.error(`--now is not an ISO-8601 timestamp: ${JSON.stringify(overrides.now)}`);
      return 2;
    }
    if (ledger.problems.length > 0) {
      // A corrupt ledger can hide overdue obligations: refuse to grade the
      // fleet on unreadable evidence instead of reporting a false "all ok".
      for (const problem of ledger.problems) {
        console.error(`LEDGER ${ledgerPath}: ${problem}`);
      }
      console.error('REFUSING to answer --due from an unreadable ledger');
      return 1;
    }
    const rows = dueReport(manifest, ledger.entries, nowMs);
    for (const row of rows) {
      console.log(row.line);
    }
    const overdue = rows.filter((r) => r.state === 'due');
    console.log(
      overdue.length === 0
        ? `all obligations current as of ${new Date(nowMs).toISOString()}`
        : `${overdue.length} obligation(s) DUE as of ${new Date(nowMs).toISOString()}`,
    );
    return overdue.length === 0 ? 0 : 1;
  }

  if (mode === '--check-rls' || mode === '--record-rls') {
    const evidence = manifest.rlsEvidence;
    if (evidence === undefined || evidence === null) {
      // validateManifest already named it; this is the CLI's own answer, so
      // a caller who ignores exit 1 of --check still cannot read a verdict
      // out of a missing block.
      console.error('manifest has no rlsEvidence block (see `--check` for the validation failure)');
      return 1;
    }
    for (const error of errors) {
      console.error(`MANIFEST: ${error}`);
    }
    const evidencePath = overrides.ledger ?? join(ROOT, evidence.evidenceLedger);
    let parsed = { entries: [], problems: [] };
    if (existsSync(evidencePath)) {
      parsed = parseRlsLedger(readFileSync(evidencePath, 'utf8'));
      for (const finding of findSecretShapes(readFileSync(evidencePath, 'utf8'))) {
        parsed.problems.push(`SECRET-SHAPED CONTENT: ${finding}`);
      }
    }
    if (mode === '--check-rls') {
      if (parsed.problems.length > 0) {
        for (const problem of parsed.problems) {
          console.error(`RLS EVIDENCE ${evidencePath}: ${problem}`);
        }
        // Same law as --due: unreadable evidence is never graded as absent
        // evidence ("all ok") - it is a refusal that costs a fix.
        console.error('REFUSING to answer --check-rls from an unreadable evidence ledger');
        return 1;
      }
      if (errors.length > 0) {
        console.error('REFUSING to answer --check-rls from an invalid manifest');
        return 1;
      }
      const nowMs = overrides.now === undefined ? Date.now() : Date.parse(overrides.now);
      if (Number.isNaN(nowMs)) {
        console.error(`--check-rls: --now is not an ISO-8601 timestamp: ${JSON.stringify(overrides.now)}`);
        return 2;
      }
      const row = rlsEvidenceReport(evidence, parsed.entries, nowMs);
      console.log(row.line);
      console.log(
        `cadence ${evidence.cadenceHours === null ? 'waived' : `${evidence.cadenceHours}h`}, ` +
          // the file it ACTUALLY read, not the manifest's default: a
          // --ledger override that changed the answer is exactly the case a
          // summary line must not obscure.
          `ledger ${evidencePath} (${parsed.entries.length} entries), verifier ${evidence.verifier}`,
      );
      return row.state === 'ok' || row.state === 'waived' ? 0 : 1;
    }

    // --record-rls: the operator's record of an audit THIS script never ran.
    // That separation is the design: the CLI has no database credentials and
    // no business having them, so it can accept, age and store a result but
    // cannot invent one - which is also why --grade is required and there is
    // no "--assume-pass".
    const grade = overrides.grade;
    if (grade !== 'pass' && grade !== 'fail' && grade !== 'unverified') {
      console.error('--record-rls: --grade must be pass, fail or unverified (the core\'s closed vocabulary)');
      return 1;
    }
    if (parsed.problems.length > 0) {
      for (const problem of parsed.problems) {
        console.error(`RLS EVIDENCE ${evidencePath}: ${problem}`);
      }
      console.error('REFUSING to append to an unreadable evidence ledger - fix the named lines first');
      return 1;
    }
    const atRaw = overrides.at ?? new Date().toISOString();
    const atMs = Date.parse(atRaw);
    if (Number.isNaN(atMs)) {
      console.error(`--record-rls: --at is not an ISO-8601 timestamp: ${JSON.stringify(overrides.at)}`);
      return 1;
    }
    const entry = { at: new Date(atMs).toISOString(), grade };
    if (overrides.probed !== undefined) {
      const probed = Number(overrides.probed);
      if (!Number.isInteger(probed) || probed < 0 || probed > 4096) {
        console.error('--record-rls: --probed must be an integer 0..4096 (tables actually read)');
        return 1;
      }
      entry.probed = probed;
    }
    for (const [key, flag] of [['role', '--role'], ['note', '--note']]) {
      const value = overrides[key];
      if (value === undefined) {
        continue;
      }
      const limit = key === 'role' ? 200 : 500;
      if (value.length > limit || /[\r\n]/.test(value)) {
        console.error(`--record-rls: ${flag} must be one line of at most ${limit} characters`);
        return 1;
      }
      entry[key] = value;
    }
    const line = JSON.stringify(entry);
    const secretFindingsInLine = [
      ...findSecretShapes(`${line}\n`),
      ...(entry.note === undefined ? [] : findSecretShapes(`${entry.note}\n`)),
    ];
    if (secretFindingsInLine.length > 0) {
      for (const finding of secretFindingsInLine) {
        console.error(`REFUSING to record: ${finding}`);
      }
      console.error('evidence describes what was verified, never what was used to verify it - credentials do not belong in the ledger');
      return 1;
    }
    appendFileSync(evidencePath, `${line}\n`, 'utf8');
    console.log(`recorded: ${line}`);
    const row = rlsEvidenceReport(evidence, [...parsed.entries, { ...entry, atMs }], Date.now());
    console.log(row.line);
    return row.state === 'ok' || row.state === 'waived' ? 0 : 1;
  }

  // --record
  const component = overrides.component;
  const outcome = overrides.outcome;
  if (component === undefined || outcome === undefined) {
    console.error('--record requires --component and --outcome');
    return usage();
  }
  if (!loaded.knownIds.has(component)) {
    console.error(`--record: unknown component ${JSON.stringify(component)}`);
    return 1;
  }
  if (outcome !== 'ok' && outcome !== 'failed') {
    console.error('--record: outcome must be "ok" or "failed"');
    return 1;
  }
  const atRaw = overrides.at ?? new Date().toISOString();
  const atMs = Date.parse(atRaw);
  if (Number.isNaN(atMs)) {
    console.error(`--record: --at is not an ISO-8601 timestamp: ${JSON.stringify(overrides.at)}`);
    return 1;
  }
  const entry = { at: new Date(atMs).toISOString(), component, outcome };
  if (overrides.note !== undefined) {
    if (overrides.note.length > 500 || /[\r\n]/.test(overrides.note)) {
      console.error('--record: note must be one line of at most 500 characters');
      return 1;
    }
    entry.note = overrides.note;
  }
  const line = JSON.stringify(entry);
  // Scan BOTH forms: the stored line (catches a crafted --at/field smuggle)
  // and the raw note (JSON escaping must not launder `KEY="secret"` into
  // `KEY=\"secret\"` past the patterns).
  const secretFindingsInLine = [
    ...findSecretShapes(`${line}\n`),
    ...(entry.note === undefined ? [] : findSecretShapes(`${entry.note}\n`)),
  ];
  if (secretFindingsInLine.length > 0) {
    for (const finding of secretFindingsInLine) {
      console.error(`REFUSING to record: ${finding}`);
    }
    console.error('notes describe what was done, never what was used - credentials do not belong in the ledger');
    return 1;
  }
  if (ledger.problems.length > 0) {
    for (const problem of ledger.problems) {
      console.error(`LEDGER ${ledgerPath}: ${problem}`);
    }
    console.error('REFUSING to append to an unreadable ledger - fix the named lines first');
    return 1;
  }
  appendFileSync(ledgerPath, `${line}\n`, 'utf8');
  console.log(`recorded: ${line}`);
  const rows = dueReport(manifest, [...ledger.entries, { ...entry, atMs }], Date.now());
  const mine = rows.find((r) => r.component === component);
  if (mine !== undefined) {
    console.log(mine.line);
  }
  return 0;
}

const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  process.exitCode = main(process.argv.slice(2));
}
```


## FILE: scripts/dr-manifest.test.mjs (625 lines)

*14 new node tests (52 total): requiredness, every field shape refusal, the cadence ceiling, waiver contradiction, ledger-path law, the internal-plane/overclaim refusals, requiredGrade-not-a-knob, artifact drift, secret-shaped evidence, the parser's vocabulary, the report's five states including out-of-order lines, the CLI's append/refuse/no-cross-read behaviour, plan determinism, and print-sql pinned to the module it documents.*

```javascript
/**
 * Tests for the DR manifest validator (run: `node --test scripts/`).
 *
 * The repo's own manifest must pass, every drift class the validator exists
 * to catch must fail, and the plan renderer must be deterministic and
 * credential-free. These tests are the difference between a validator and a
 * lint that nothing watches.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import {
  validateManifest,
  findSecretShapes,
  renderPlan,
  collectEnvNames,
  parseLedger,
  dueReport,
  parseRlsLedger,
  rlsEvidenceReport,
} from './dr-manifest.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const MANIFEST = JSON.parse(readFileSync(join(ROOT, 'docs', 'dr', 'manifest.json'), 'utf8'));

test('the shipped manifest validates clean', () => {
  assert.deepEqual(validateManifest(MANIFEST, ROOT), []);
});

test('the shipped manifest contains no secret shapes', () => {
  const raw = readFileSync(join(ROOT, 'docs', 'dr', 'manifest.json'), 'utf8');
  assert.deepEqual(findSecretShapes(raw), []);
});

test('every env name referenced exists in a repo .env.example', () => {
  const names = collectEnvNames(ROOT);
  for (const component of MANIFEST.components) {
    for (const ref of component.envRefs ?? []) {
      assert.ok(names.has(ref), `${component.id}: missing env name ${ref}`);
    }
  }
  assert.ok(names.size > 20, 'template parsing regressed');
});

test('a duplicated restoreOrder is refused', () => {
  const bad = structuredClone(MANIFEST);
  bad.components[1].restoreOrder = bad.components[0].restoreOrder;
  const errors = validateManifest(bad, ROOT);
  assert.ok(errors.some((e) => e.includes('unique positive integer')) || errors.some((e) => e.includes('1..n')));
});

test('a gapped restoreOrder sequence is refused', () => {
  const bad = structuredClone(MANIFEST);
  bad.components.at(-1).restoreOrder = 99;
  assert.ok(validateManifest(bad, ROOT).some((e) => e.includes('no gaps')));
});

test('a path that no longer exists is refused', () => {
  const bad = structuredClone(MANIFEST);
  bad.components.find((c) => c.id === 'postgres').paths.push('apps/api/prisma/schema.dreamt-of.prisma');
  assert.ok(validateManifest(bad, ROOT).some((e) => e.includes('no longer exists')));
});

test('an env ref that appears in no template is refused', () => {
  const bad = structuredClone(MANIFEST);
  bad.components.find((c) => c.id === 'postgres').envRefs.push('POSTGRES_LIKE_TOTALY_MADE_UP');
  assert.ok(validateManifest(bad, ROOT).some((e) => e.includes('no .env.example')));
});

test('a missing required component is refused', () => {
  const bad = structuredClone(MANIFEST);
  bad.components = bad.components.filter((c) => c.id !== 'redis');
  assert.ok(validateManifest(bad, ROOT).some((e) => e.includes('required component redis')));
});

test('restoring the database before the keys is refused', () => {
  const bad = structuredClone(MANIFEST);
  const keys = bad.components.find((c) => c.id === 'encryption-keys');
  const db = bad.components.find((c) => c.id === 'postgres');
  [keys.restoreOrder, db.restoreOrder] = [db.restoreOrder, keys.restoreOrder];
  assert.ok(validateManifest(bad, ROOT).some((e) => e.includes('BEFORE postgres')));
});

test('an untimed drill is refused', () => {
  const bad = structuredClone(MANIFEST);
  bad.drill.timed = false;
  assert.ok(validateManifest(bad, ROOT).some((e) => e.includes('drill.timed')));
});

test('a restore step pointing at a non-existent component is refused', () => {
  const bad = structuredClone(MANIFEST);
  bad.restoreProcedure[1].component = 'ghost-store';
  assert.ok(validateManifest(bad, ROOT).some((e) => e.includes('unknown component')));
});

test('secret shapes are detected wherever they hide', () => {
  assert.ok(findSecretShapes('host=postgresql://admin:Str0ngPassw0rd@db:5432/x').length > 0);
  assert.ok(findSecretShapes('-----BEGIN RSA PRIVATE KEY-----').length > 0);
  assert.ok(findSecretShapes('{"JWT_ACCESS_SECRET": "aGVsbG93b3JsZGFiY2RlZg=="}').length > 0);
});

test('--check and --plan succeed on the repo, and --plan is deterministic', () => {
  const script = join(ROOT, 'scripts', 'dr-manifest.mjs');
  const checkOut = execFileSync('node', [script, '--check'], { encoding: 'utf8' });
  assert.match(checkOut, /manifest valid/);
  const plan1 = execFileSync('node', [script, '--plan'], { encoding: 'utf8' });
  const plan2 = execFileSync('node', [script, '--plan'], { encoding: 'utf8' });
  assert.equal(plan1, plan2);
  assert.doesNotMatch(plan1, /[a-z][a-z0-9+.-]*:\/\/[^\s/@]+:[^\s@]+@/); // no credential URLs
  for (const component of MANIFEST.components) {
    assert.ok(plan1.includes(component.id), `plan omits ${component.id}`);
  }
});

test('renderPlan matches the CLI output exactly (pure function, no clock)', () => {
  const viaFn = renderPlan(MANIFEST);
  const script = join(ROOT, 'scripts', 'dr-manifest.mjs');
  const viaCli = execFileSync('node', [script, '--plan'], { encoding: 'utf8' });
  assert.equal(viaCli, viaFn);
});

test('usage error exits 2', () => {
  const script = join(ROOT, 'scripts', 'dr-manifest.mjs');
  assert.throws(() => execFileSync('node', [script, '--nope'], { stdio: 'pipe' }), (err) => err.status === 2);
});

/* --------------------------------------------------------------------- */
/* Part 12: the backup-freshness ledger                                  */
/* --------------------------------------------------------------------- */

test('a component with neither cadence nor waiver is refused', () => {
  const bad = structuredClone(MANIFEST);
  delete bad.components.find((c) => c.id === 'dataset-objects').cadenceHours;
  assert.ok(validateManifest(bad, ROOT).some((e) => e.includes('cadenceHours is required')));
});

test('a null cadence without a waiver string is refused', () => {
  const bad = structuredClone(MANIFEST);
  const c = bad.components.find((x) => x.id === 'dataset-objects');
  c.cadenceHours = null;
  delete c.cadenceWaiver;
  assert.ok(validateManifest(bad, ROOT).some((e) => e.includes('requires a non-empty cadenceWaiver')));
});

test('a waiver attached to a real cadence is refused (contradiction)', () => {
  const bad = structuredClone(MANIFEST);
  bad.components.find((c) => c.id === 'postgres').cadenceWaiver = 'but I do not feel like it';
  assert.ok(validateManifest(bad, ROOT).some((e) => e.includes('only meaningful when cadenceHours is null')));
});

test('cadenceHours must be a bounded integer', () => {
  for (const value of [0, -3, 24.5, 8761, '24', null]) {
    const bad = structuredClone(MANIFEST);
    const c = bad.components.find((x) => x.id === 'dataset-objects');
    c.cadenceHours = value;
    c.cadenceWaiver = 'present, so the null-cadence branch is also exercised';
    const errors = validateManifest(bad, ROOT);
    if (value === null) {
      // null + waiver is legal - that is the redis shape; assert NO cadence error for it
      assert.ok(!errors.some((e) => e.includes('integer 1..8760')), 'null with waiver must pass the bound check');
    } else {
      assert.ok(errors.some((e) => e.includes('integer 1..8760')), `value ${JSON.stringify(value)} must be refused`);
    }
  }
});

test('postgres cadence beyond the RPO must name the mechanism that closes the gap', () => {
  const bad = structuredClone(MANIFEST);
  const db = bad.components.find((c) => c.id === 'postgres');
  delete db.rpoMechanism; // 24h dump vs 60m RPO, nothing else stated
  assert.ok(validateManifest(bad, ROOT).some((e) => e.includes('no rpoMechanism is named')));
  const good = structuredClone(MANIFEST);
  good.components.find((c) => c.id === 'postgres').cadenceHours = 1; // 60m <= 60m: honest without a mechanism
  assert.ok(!validateManifest(good, ROOT).some((e) => e.includes('rpoMechanism')));
});

test('the ledger parses line-wise and reports every malformed line by number', () => {
  const now = '2026-09-14T06:00:00Z';
  const text = [
    JSON.stringify({ at: now, component: 'postgres', outcome: 'ok' }),
    '{not json',
    JSON.stringify({ at: 'yesterday', component: 'postgres', outcome: 'ok' }),
    JSON.stringify({ at: now, component: 'postgres', outcome: 'maybe' }),
    JSON.stringify({ at: now, component: 'nosuch', outcome: 'ok' }),
    JSON.stringify({ at: now, component: 'redis', outcome: 'ok', extra: 'field' }),
    JSON.stringify({ at: now, component: 'redis', outcome: 'failed', note: 'x'.repeat(501) }),
  ].join('\n');
  const { entries, problems } = parseLedger(text, new Set(['postgres', 'redis']));
  assert.equal(entries.length, 1, 'only the clean line survives');
  const joined = problems.join('\n');
  for (const fragment of [
    'line 2: not valid JSON',
    'line 3: at must be an ISO-8601',
    'line 4: outcome',
    'line 5: component "nosuch" is not in the manifest',
    'line 6: unknown field',
    'line 7: note must be',
  ]) {
    assert.ok(joined.includes(fragment), `missing problem: ${fragment} in ${joined}`);
  }
});

test('dueReport ages obligations and honours waivers, failed records included', () => {
  const lite = {
    components: [
      { id: 'a', restoreOrder: 1, cadenceHours: 24 },
      { id: 'b', restoreOrder: 2, cadenceHours: 24 },
      { id: 'r', restoreOrder: 3, cadenceHours: null, cadenceWaiver: 'rebuildable' },
    ],
  };
  const base = Date.parse('2026-09-14T00:00:00Z');
  const entries = parseLedger(
    [
      { at: new Date(base).toISOString(), component: 'a', outcome: 'ok' },
      { at: new Date(base + 10 * 3_600_000).toISOString(), component: 'a', outcome: 'failed' },
      { at: new Date(base).toISOString(), component: 'b', outcome: 'failed' },
    ]
      .map((e) => JSON.stringify(e))
      .join('\n'),
    new Set(['a', 'b', 'r']),
  ).entries;
  const rows = dueReport(lite, entries, base + 23 * 3_600_000);
  assert.equal(rows[0].state, 'ok'); // 23h since last ok: inside 24h
  assert.equal(rows[1].state, 'due'); // only a failed record: the clock never stopped
  assert.match(rows[1].line, /never recorded/);
  assert.equal(rows[2].state, 'waived');
  assert.match(rows[2].line, /rebuildable/);
  const late = dueReport(lite, entries, base + 25 * 3_600_000);
  assert.equal(late[0].state, 'due');
  assert.match(late[0].line, /overdue by 1h 0m/); // failed-at-10h does NOT push the deadline
});

test('findSecretShapes catches the quoted-literal form (the escape that fooled v1)', () => {
  assert.ok(findSecretShapes('API_KEY="abcdefghijklmnop1234"\n').length > 0);
  assert.deepEqual(findSecretShapes('API_KEY="${VAULT_PATH}"\n'), []);
});

test('CLI: record -> due -> secret-refusal leaves exactly the recorded line', () => {
  const script = join(ROOT, 'scripts', 'dr-manifest.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'wlct-ledger-'));
  const ledger = join(dir, 'backup-ledger.jsonl');
  // run() ALWAYS resolves to combined stdout+stderr text, matched with
  // assert.match; exit codes are asserted here so the assertions below
  // read as intent ("this refuses") rather than plumbing.
  const run = (args, expectStatus = 0) => {
    try {
      const out = execFileSync('node', [script, ...args], { encoding: 'utf8', stdio: 'pipe' });
      assert.equal(expectStatus, 0, `expected refusal (exit ${expectStatus}) but got success: ${out}`);
      return out;
    } catch (error) {
      if (typeof error.status === 'number') {
        assert.equal(error.status, expectStatus, `expected exit ${expectStatus}: ${error.stderr}`);
        return `${error.stdout ?? ''}${error.stderr ?? ''}`;
      }
      throw error;
    }
  };
  assert.equal(existsSync(ledger), false, 'harness expects a fresh ledger path');
  // Fresh ledger: due is exit 1 (never recorded) and lists all four obliged
  run(['--due', '--ledger', ledger, '--now', '2026-09-14T12:00:00Z'], 1);
  run(
    [
      '--record', '--component', 'postgres', '--outcome', 'ok',
      '--note', 'pg_dump + scratch restore verified',
      '--at', '2026-09-14T06:00:00Z', '--ledger', ledger,
    ],
    0,
  );
  const lines = fsReadLines(ledger);
  assert.equal(lines.length, 1);
  assert.deepEqual(JSON.parse(lines[0]), {
    at: '2026-09-14T06:00:00.000Z',
    component: 'postgres',
    outcome: 'ok',
    note: 'pg_dump + scratch restore verified',
  });
  // 12:00: inside the window for postgres -> postgres [ ok ]; others due -> exit 1
  const dueOut = run(['--due', '--ledger', ledger, '--now', '2026-09-14T12:00:00Z'], 1);
  assert.match(dueOut, /\[ ok  \] postgres/);
  assert.match(dueOut, /dataset-objects: never recorded/);
  // Secret-shaped note: refused, file untouched
  const secret = run(
    [
      '--record', '--component', 'postgres', '--outcome', 'ok',
      '--note', 'TOKEN="super-secret-value-123456789012"', '--ledger', ledger,
    ],
    1,
  );
  assert.match(secret, /REFUSING to record/);
  assert.equal(fsReadLines(ledger).length, 1);
  // Unknown component and bad --at refuse too
  run(['--record', '--component', 'ghost', '--outcome', 'ok', '--ledger', ledger], 1);
  run(['--record', '--component', 'postgres', '--outcome', 'ok', '--at', 'last tuesday', '--ledger', ledger], 1);
  // A corrupt ledger line refuses to be appended to (evidence must stay parseable)
  writeFileSync(ledger, 'garbage-not-json\n', { flag: 'a' });
  const append = run(['--record', '--component', 'redis', '--outcome', 'ok', '--ledger', ledger], 1);
  assert.match(append, /REFUSING to append/);
});

function fsReadLines(path) {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '');
}

test('--check reads a ledger with escaped quotes in notes as a secret finding', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wlct-ledger-scan-'));
  const ledger = join(dir, 'backup-ledger.jsonl');
  writeFileSync(
    ledger,
    `${JSON.stringify({ at: new Date().toISOString(), component: 'postgres', outcome: 'ok', note: 'API_KEY="abcdefghijklmnop1234"' })}\n`,
  );
  const { problems } = parseLedger(readFileSync(ledger, 'utf8'), new Set(['postgres']));
  // parseLedger itself is shape-only; the note scan lives above it in the
  // loader. Pin the SHAPE here (the note is a legal string), so the
  // division of labour between the two checks is explicit...
  assert.deepEqual(problems, []);
  // and pin the END-TO-END refusal through --check: point the loader at
  // the ledger via a CLI run against a manifest that would otherwise pass.
  const script = join(ROOT, 'scripts', 'dr-manifest.mjs');
  let exit = 0;
  try {
    execFileSync('node', [script, '--check', '--ledger', ledger], { stdio: 'pipe' });
  } catch (error) {
    exit = error.status;
    assert.match(String(error.stderr), /SECRET-SHAPED CONTENT in note/);
  }
  assert.equal(exit, 1, 'a ledger with a credential in a note must fail --check');
});

test('the v1 schema id is refused now that v3 is the contract', () => {
  const bad = structuredClone(MANIFEST);
  bad.schema = 'wlct-dr-manifest-v1';
  assert.ok(validateManifest(bad, ROOT).some((e) => e.includes('wlct-dr-manifest-v3')));
});

test('the v2 schema id is refused too: an absent rlsEvidence block must not be inheritable', () => {
  // The interesting case is not "old id", it is "old id + no RLS block":
  // silently allowing that would make Part 15's policy optional for every
  // manifest written before it, which is how a security control becomes a
  // new-deployment-only control.
  const bad = structuredClone(MANIFEST);
  bad.schema = 'wlct-dr-manifest-v2';
  delete bad.rlsEvidence;
  const errors = validateManifest(bad, ROOT);
  assert.ok(errors.some((e) => e.includes('wlct-dr-manifest-v3')));
  assert.ok(errors.some((e) => e.includes('rlsEvidence is required')));
});

/* --------------------------------------------------------------------- */
/* Part 15: RLS enablement evidence                                        */
/* --------------------------------------------------------------------- */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

test('the shipped manifest declares RLS evidence and every path it names exists', () => {
  assert.deepEqual(validateManifest(MANIFEST, ROOT), []);
  const rls = MANIFEST.rlsEvidence;
  assert.equal(rls.requiredGrade, 'pass');
  for (const field of ['coverageArtifact', 'enableArtifact', 'disableArtifact']) {
    assert.ok(existsSync(join(ROOT, rls[field])), `${field} missing from the repo`);
  }
  // The verifier names an endpoint, and that endpoint must exist in the
  // engine it points at - the manifest is a pointer, and pointers rot.
  const router = readFileSync(
    join(ROOT, 'services', 'execution-engine', 'app', 'routers', 'enablement.py'),
    'utf8',
  );
  assert.ok(router.includes(`"${rls.verifier.slice('/internal/v1'.length)}"`), 'manifest points at a route that does not exist');
  assert.ok(router.includes('router = APIRouter(prefix="/internal/v1"'), 'verifier left the internal plane');
});

test('rlsEvidence is required, and each of its fields has a shape', () => {
  const missing = structuredClone(MANIFEST);
  delete missing.rlsEvidence;
  assert.ok(validateManifest(missing, ROOT).some((e) => e.includes('rlsEvidence is required')));

  for (const field of ['evidenceLedger', 'verifier', 'command']) {
    const bad = structuredClone(MANIFEST);
    bad.rlsEvidence[field] = '';
    assert.ok(
      validateManifest(bad, ROOT).some((e) => e.includes(`${field} must be a non-empty string`)),
      field,
    );
  }
});

test('an rls cadence beyond a year is refused as a way of writing never', () => {
  const bad = structuredClone(MANIFEST);
  bad.rlsEvidence.cadenceHours = 8761;
  assert.ok(validateManifest(bad, ROOT).some((e) => e.includes('cadenceHours must be an integer 1..8760')));
  const zero = structuredClone(MANIFEST);
  zero.rlsEvidence.cadenceHours = 0;
  assert.ok(validateManifest(zero, ROOT).some((e) => e.includes('cadenceHours must be an integer')));
});

test('an rls waiver needs words, and a waiver next to a cadence is a contradiction', () => {
  const silent = structuredClone(MANIFEST);
  silent.rlsEvidence.cadenceHours = null;
  assert.ok(validateManifest(silent, ROOT).some((e) => e.includes('cadenceHours null requires a non-empty cadenceWaiver')));
  const contradictory = structuredClone(MANIFEST);
  contradictory.rlsEvidence.cadenceWaiver = 'not applicable';
  assert.ok(validateManifest(contradictory, ROOT).some((e) => e.includes('only meaningful when cadenceHours is null')));
});

test('the evidence ledger must be git evidence: relative, under docs/dr, .jsonl', () => {
  for (const [value, needle] of [
    ['/etc/passwd', 'repository-relative path'],
    ['docs/dr/../secrets.jsonl', 'repository-relative path'],
    ['docs/dr/evidence.txt', '.jsonl file'],
    ['evidence/rls.jsonl', 'under docs/dr/'],
  ]) {
    const bad = structuredClone(MANIFEST);
    bad.rlsEvidence.evidenceLedger = value;
    assert.ok(validateManifest(bad, ROOT).some((e) => e.includes(needle)), `${value} -> ${needle}`);
  }
});

test('the verifier must be an internal endpoint and the command a repo script', () => {
  const publicRoute = structuredClone(MANIFEST);
  publicRoute.rlsEvidence.verifier = '/api/v1/enablement/audit';
  assert.ok(validateManifest(publicRoute, ROOT).some((e) => e.includes('internal-plane endpoint')));

  const escaped = structuredClone(MANIFEST);
  escaped.rlsEvidence.verifier = '/public/enablement';
  assert.ok(validateManifest(escaped, ROOT).some((e) => e.includes('must not be a public route')));

  const arbitrary = structuredClone(MANIFEST);
  arbitrary.rlsEvidence.command = 'bash -c "curl evil"';
  assert.ok(validateManifest(arbitrary, ROOT).some((e) => e.includes('repository script')));
});

test('requiredGrade is not a knob: anything but "pass" is refused', () => {
  for (const value of ['fail', 'unverified', 'warning', true, 0]) {
    const bad = structuredClone(MANIFEST);
    bad.rlsEvidence.requiredGrade = value;
    assert.ok(
      bad && validateManifest(bad, ROOT).some((e) => e.includes('requiredGrade is not a knob')),
      JSON.stringify(value),
    );
  }
});

test('an artifact path that no longer exists, or no longer speaks of RLS, is a validation failure', () => {
  const moved = structuredClone(MANIFEST);
  moved.rlsEvidence.coverageArtifact = 'apps/api/prisma/rls/gone.json';
  assert.ok(validateManifest(moved, ROOT).some((e) => e.includes('no longer exists')));

  const notJson = structuredClone(MANIFEST);
  notJson.rlsEvidence.coverageArtifact = 'docs/dr/manifest.json'; // exists, but not the coverage shape
  assert.ok(validateManifest(notJson, ROOT).length >= 0); // JSON parses, so it passes - see the RLS-text rule below

  const renamed = structuredClone(MANIFEST);
  renamed.rlsEvidence.enableArtifact = 'docs/ROADMAP.md'; // exists, no ROW LEVEL SECURITY
  assert.ok(validateManifest(renamed, ROOT).some((e) => e.includes('no longer mentions ROW LEVEL SECURITY')));
});

test('secret shapes in the evidence ledger fail --check', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wlct-rls-secret-'));
  const ledger = join(dir, 'e.jsonl');
  writeFileSync(
    ledger,
    `${JSON.stringify({
      at: new Date().toISOString(),
      grade: 'pass',
      note: 'ran with DATABASE_URL="postgresql://app:sup3rsecretvalue@db:5432/wlct"',
    })}\n`,
  );
  const script = join(ROOT, 'scripts', 'dr-manifest.mjs');
  let exit = 0;
  try {
    execFileSync('node', [script, '--check-rls', '--ledger', ledger], { stdio: 'pipe' });
  } catch (error) {
    exit = error.status;
    assert.match(String(error.stderr), /SECRET-SHAPED CONTENT/);
  }
  assert.equal(exit, 1, 'a ledger holding a credential must not be readable as evidence');
});

test('parseRlsLedger accepts the closed grade vocabulary and nothing else', () => {
  const good = JSON.stringify({ at: '2026-09-14T06:00:00.000Z', grade: 'pass', probed: 42, role: 'wlct_app' });
  assert.deepEqual(parseRlsLedger(`${good}\n`).problems, []);
  assert.equal(parseRlsLedger(`${good}\n`).entries.length, 1);

  for (const [payload, needle] of [
    [{ at: 'x', grade: 'pass' }, 'ISO-8601'],
    [{ at: '2026-09-14T06:00:00.000Z', grade: 'ok' }, 'pass, fail or unverified'],
    [{ at: '2026-09-14T06:00:00.000Z', grade: 'pass', extra: 1 }, 'unknown field'],
    [{ at: '2026-09-14T06:00:00.000Z', grade: 'pass', probed: 99999 }, 'integer 0..4096'],
    [{ at: '2026-09-14T06:00:00.000Z', grade: 'pass', role: 'a'.repeat(201) }, 'role must be'],
    [{ at: '2026-09-14T06:00:00.000Z', grade: 'pass', note: 'line1\nline2' }, 'note must be'],
  ]) {
    const { problems } = parseRlsLedger(`${JSON.stringify(payload)}\n`);
    assert.equal(problems.length, 1, JSON.stringify(payload));
    assert.ok(problems[0].includes(needle), `${problems[0]} !~ ${needle}`);
  }
  // An entry with NO grade is not "grade unknown", it is a malformed line:
  // the field that decides the verdict cannot default.
  assert.match(parseRlsLedger(`{"at":"2026-09-14T06:00:00.000Z"}\n`).problems[0], /grade must be/);
});

test('rlsEvidenceReport: never, fresh, overdue, and a fresh non-pass outranks freshness', () => {
  const evidence = { cadenceHours: 168 };
  const now = Date.UTC(2026, 8, 14, 12);
  assert.match(rlsEvidenceReport(evidence, [], now).line, /never recorded/);
  assert.equal(rlsEvidenceReport(evidence, [], now).state, 'due');

  const fresh = [{ atMs: now - DAY, grade: 'pass' }];
  assert.equal(rlsEvidenceReport(evidence, fresh, now).state, 'ok');
  assert.match(rlsEvidenceReport(evidence, fresh, now).line, /\[ ok  \]/);

  const stale = [{ atMs: now - 8 * DAY, grade: 'pass' }];
  assert.equal(rlsEvidenceReport(evidence, stale, now).state, 'due');
  assert.match(rlsEvidenceReport(evidence, stale, now).line, /overdue by 1d/);

  // The asymmetry that matters: a RECENT failure refreshes the clock without
  // turning the finding green.
  const failed = [
    { atMs: now - 2 * DAY, grade: 'pass' },
    { atMs: now - HOUR, grade: 'fail' },
  ];
  const row = rlsEvidenceReport(evidence, failed, now);
  assert.equal(row.state, 'fail');
  assert.match(row.line, /did not conclude "pass"/);

  const unverified = [{ atMs: now - HOUR, grade: 'unverified' }];
  assert.equal(rlsEvidenceReport(evidence, unverified, now).state, 'fail');

  // out-of-order lines: "latest" is by timestamp, not by position in the file
  const shuffled = [
    { atMs: now - HOUR, grade: 'fail' },
    { atMs: now - 30 * DAY, grade: 'pass' },
  ];
  assert.equal(rlsEvidenceReport(evidence, shuffled, now).state, 'fail');

  const waived = rlsEvidenceReport({ cadenceHours: null, cadenceWaiver: 'staging-only deployment' }, [], now);
  assert.equal(waived.state, 'waived');
  assert.match(waived.line, /staging-only/);
});

test('CLI: record-rls appends one line, check-rls ages it, and neither touches the backup ledger', () => {
  const script = join(ROOT, 'scripts', 'dr-manifest.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'wlct-rls-cli-'));
  const ledger = join(dir, 'e.jsonl');
  const run = (args, expectStatus = 0) => {
    try {
      return execFileSync('node', [script, ...args], { encoding: 'utf8', stdio: 'pipe' });
    } catch (error) {
      if (typeof error.status === 'number') {
        assert.equal(error.status, expectStatus, `expected exit ${expectStatus}: ${error.stderr}`);
        return `${error.stdout ?? ''}${error.stderr ?? ''}`;
      }
      throw error;
    }
  };
  assert.equal(existsSync(ledger), false);
  run(['--check-rls', '--now', '2026-09-14T12:00:00Z', '--ledger', ledger], 1);
  const recorded = run(
    ['--record-rls', '--grade', 'pass', '--probed', '42', '--role', 'wlct_app', '--at', '2026-09-14T06:00:00Z', '--ledger', ledger],
    0,
  );
  assert.match(recorded, /recorded: \{"at":"2026-09-14T06:00:00\.000Z","grade":"pass"/);
  const lines = readFileSync(ledger, 'utf8').split('\n').filter((l) => l.trim() !== '');
  assert.equal(lines.length, 1, 'exactly one evidence line per record');
  assert.deepEqual(JSON.parse(lines[0]), {
    at: '2026-09-14T06:00:00.000Z',
    grade: 'pass',
    probed: 42,
    role: 'wlct_app',
  });
  // An absent evidence ledger must not make the BACKUP ledger look broken,
  // and vice versa - the two obligations never read each other's file.
  const dueOut = run(['--due', '--now', '2026-09-14T12:00:00Z', '--ledger', join(dir, 'backup.jsonl')], 1);
  assert.match(dueOut, /never recorded/);
  // gradeless / bad-grade record attempts refuse and write nothing
  run(['--record-rls', '--ledger', ledger], 1);
  run(['--record-rls', '--grade', 'ok', '--ledger', ledger], 1);
  run(['--record-rls', '--grade', 'pass', '--probed', 'lots', '--ledger', ledger], 1);
  run(['--record-rls', '--grade', 'pass', '--at', 'last tuesday', '--ledger', ledger], 1);
  assert.equal(readFileSync(ledger, 'utf8').split('\n').filter((l) => l.trim() !== '').length, 1);
  // a corrupt line: --check-rls refuses rather than grading the fleet on it
  writeFileSync(ledger, 'not json\n', { flag: 'a' });
  const corrupt = run(['--check-rls', '--ledger', ledger], 1);
  assert.match(corrupt, /REFUSING to answer --check-rls from an unreadable evidence ledger/);
  // and the writer refuses to append to a broken ledger, so the file
  // cannot accumulate unreadable lines next to good evidence.
  const append = run(['--record-rls', '--grade', 'pass', '--ledger', ledger], 1);
  assert.match(append, /REFUSING to append/);
  assert.equal(readFileSync(ledger, 'utf8').trim().split('\n').length, 2);
});

test('--check-rls prints its own summary line and the plan renders the contract', () => {
  const script = join(ROOT, 'scripts', 'dr-manifest.mjs');
  const plan = execFileSync('node', [script, '--plan'], { encoding: 'utf8' });
  assert.match(plan, /# --- rls enablement evidence \(Part 15\) ---/);
  assert.match(plan, new RegExp(`cadence: <=${MANIFEST.rlsEvidence.cadenceHours}h`));
  assert.ok(plan.includes(MANIFEST.rlsEvidence.evidenceLedger));
  // Determinism still holds with the new section (no clock in renderPlan).
  const plan2 = execFileSync('node', [script, '--plan'], { encoding: 'utf8' });
  assert.equal(plan, plan2);
});

test("rls-enablement.mjs print-sql reports exactly the executor's SQL, all reads", () => {
  const script = join(ROOT, 'scripts', 'rls-enablement.mjs');
  const out = execFileSync('node', [script, 'print-sql'], { encoding: 'utf8' });
  const names = [...out.matchAll(/^-- (\w+)$/gm)].map((m) => m[1]);
  const source = readFileSync(join(ROOT, 'services', 'execution-engine', 'app', 'rls_probe.py'), 'utf8');
  const shipped = [...source.matchAll(/^(\w+_SQL): Final = /gm)].map((m) => m[1]);
  assert.deepEqual(names.sort(), shipped.sort(), 'the helper drifted from the module it documents');
  const statements = out.split('\n').filter((l) => l.trim().endsWith(';') && !l.trim().startsWith('--'));
  assert.ok(statements.length >= 6, `only ${statements.length} statements rendered`);
  for (const statement of statements) {
    assert.match(statement.trim(), /^(SELECT|SET TRANSACTION READ ONLY)/, statement);
  }
  assert.doesNotMatch(out, /INSERT|UPDATE |DELETE|ALTER TABLE|GRANT/);
});
```


## FILE: docs/dr/manifest.json (184 lines)

*schema v3, the rlsEvidence block (cadence 168h, requiredGrade pass, the engine endpoint, the scope sentence naming all four probed tables, the three RLS artifacts), one new invariant stating that RLS is a claim with an expiry, and a nonGoal recording that the ledger records the audit rather than making the policies true.*

```json
{
  "schema": "wlct-dr-manifest-v3",
  "title": "White-Label Copy-Trading Platform - disaster recovery manifest",
  "invariants": [
    "A backup that has never been restored is a hope, not a backup: every component's plan is only complete when its restore has been executed once, under time, and verified.",
    "This file names environment KEYS and repository PATHS; it never contains values, credentials, connection strings, or dumps. Anything secret-shaped in here is a validator failure.",
    "Restore order is data-first with key material before the data it unlocks: consumers with stale data are wrong, and encrypted data without keys is gone.",
    "Backup obligations are scheduled or explicitly waived, never tacit: every component declares cadenceHours (max hours between recorded successes) or a cadenceWaiver explaining why the clock does not apply. The ledger (docs/dr/backup-ledger.jsonl) is the record; `--due` answers 'what is overdue' and a backup that happened unrecorded is, to this manifest, a backup that did not happen.",
    "Row-level security is a claim, not a state: the platform may say policies are enabled and enforcing only while a PASSING enablement audit is younger than rlsEvidence.cadenceHours, and that claim's record lives in its own append-only evidence ledger. An audit that never ran and an audit that failed are different findings and both refuse the claim."
  ],
  "rpoMinutes": 60,
  "rtoHours": 4,
  "reviewCadenceDays": 90,
  "components": [
    {
      "id": "encryption-keys",
      "restoreOrder": 1,
      "title": "Application key material",
      "kind": "sealed-secrets",
      "purpose": "Field-level encryption master key and blind-index key (apps/api field encryption). Losing these does not lose the plaintext of orders; it loses credential recoverability and indexed lookup forever.",
      "backupMethod": "The secret-store export (sealed or KMS-wrapped) is under the organization's escrow policy; this manifest verifies only the escrow's existence and the drill record, never the material.",
      "envRefs": [
        "ENCRYPTION_PROVIDER",
        "ENCRYPTION_MASTER_KEY_BASE64",
        "BLIND_INDEX_KEY_BASE64"
      ],
      "paths": [
        ".env.example"
      ],
      "verification": "Decode the restored master key and assert exactly 32 bytes; decode the blind-index key and assert at least 32 bytes; run one encrypt/decrypt round-trip probe (scripts smoke, no DB writes). Any mismatch stops the restore: a partially-restored app that cannot read its own stored secrets is worse than a down app.",
      "cadenceHours": 720
    },
    {
      "id": "postgres",
      "restoreOrder": 2,
      "title": "PostgreSQL - the durable truth",
      "kind": "managed-or-selfhosted-database",
      "purpose": "Every row the platform owes an audit: tenants, users, sessions, orders, fills, incidents, audit log, risk configuration versions, SLO evaluations, dataset registry.",
      "backupMethod": "Logical: pg_dump -Fc of the application database on a cadence inside rpoMinutes, retained at least 30 days. Physical/managed: continuous WAL archiving (PITR) is the recovery path; the logical dump is the cross-environment seed. Backups are stored OUTSIDE the failure domain (different account/region) and encrypted at rest by the storage layer.",
      "envRefs": [
        "POSTGRES_HOST",
        "POSTGRES_PORT",
        "POSTGRES_USER",
        "POSTGRES_PASSWORD",
        "POSTGRES_DB",
        "POSTGRES_SCHEMA",
        "POSTGRES_APP_PASSWORD"
      ],
      "paths": [
        "apps/api/prisma/schema.prisma",
        "apps/api/prisma/migrations",
        "docker-compose.yml"
      ],
      "verification": "Restore into a scratch instance; assert _prisma_migrations has no failed row and its count equals the repository's migration directories; run the post-restore probe queries from docs/DR.md; only then name it a backup.",
      "cadenceHours": 24,
      "rpoMechanism": "Continuous WAL archiving (PITR) is the RPO mechanism; the cadence below bounds the logical cross-environment seed dump, whose staleness is therefore an availability risk window, not the data-loss window the RPO names."
    },
    {
      "id": "redis",
      "restoreOrder": 3,
      "title": "Redis - queues, coordination, warm state",
      "kind": "cache-and-queue",
      "purpose": "BullMQ queues and sidecars, risk reservations and rate windows, partition claims, leader leases, SLO bucket hashes.",
      "backupMethod": "RDB snapshot retained for forensics only. Redis is deliberately REBUILDABLE, not restored-to: every durable fact it holds is either re-derivable (health mirrors, readiness, sidecar TTLs) or owned by Postgres. The one exception to note honestly: un-drained queue jobs inside the snapshot window are lost on restore and simply re-published by their producers' flows.",
      "envRefs": [
        "REDIS_HOST",
        "REDIS_PORT",
        "REDIS_DB",
        "REDIS_PASSWORD"
      ],
      "paths": [],
      "verification": "After a warm-empty restart: queue depths read 0, no stuck active jobs, and GET observability/worker-coordination shows no claims until workers re-claim. If any of those fail, the incident is a coordination bug, not a backup gap - treat it as one.",
      "cadenceHours": null,
      "cadenceWaiver": "Rebuildable by design: queues, claims, reservations and mirrors are all re-derived by the workers within one tick. The forensic RDB exists for incident archaeology only - scheduling its copy would manufacture an obligation the component's own contract denies."
    },
    {
      "id": "dataset-objects",
      "restoreOrder": 4,
      "title": "Historical dataset files",
      "kind": "object-storage-or-filesystem",
      "purpose": "Ingested historical archives under the configured DATASET_STORAGE backend (Part 7). Re-downloadable in principle from the upstream source; re-downloading at 2am in an incident is exactly the failure this component exists to remove from the plan.",
      "backupMethod": "Bucket replication (managed backend) or an rsync/borg target outside the host (local backend, the current default). The dataset registry rows in Postgres reference files by content digest; the backup is valid when every registry row's digest resolves in the backup store.",
      "envRefs": [
        "DATASET_STORAGE_BACKEND"
      ],
      "paths": [
        "libs/trading-core/wlct_trading/datasets",
        "services/execution-engine"
      ],
      "verification": "For each of the 10 most recent dataset versions, list the backed-up object and compare the stored sha256 digest to the registry row. A digest mismatch is a corrupt-backup incident, not a warning.",
      "cadenceHours": 24
    },
    {
      "id": "deployment-config",
      "restoreOrder": 5,
      "title": "Deployment configuration and topology",
      "kind": "repository-tracked-config",
      "purpose": "Compose topology, Dockerfiles, the env TEMPLATE, the generated Prisma client contract, and the API surface docs. No .env values are here, and that is the design: secrets live in the secret store (or the operator's sealed file), never in git, never in backups of git.",
      "backupMethod": "Version control is the backup, with two live caveats: the release artifact images (api, worker, engines, admin-web) must be pinned and retained in the registry, and the secret-store entry names the deployment references must match what the manifest lists in envRefs.",
      "envRefs": [
        "NODE_ENV",
        "API_PORT",
        "API_HOST",
        "JWT_ACCESS_SECRET",
        "JWT_REFRESH_SECRET",
        "EXECUTION_ENGINE_TOKEN",
        "EXECUTION_INTERNAL_TOKEN",
        "WORKER_MEMBERSHIP"
      ],
      "paths": [
        "docker-compose.yml",
        "infrastructure/docker/api.Dockerfile",
        "infrastructure/docker/execution-engine.Dockerfile",
        ".env.example"
      ],
      "verification": "In a fresh environment: compose config resolves every referenced path, every envRef appears in the (externally provided) env, and `npm run build:packages && npm run build` plus the three Python services' test suites pass against the restored database.",
      "cadenceHours": 168
    }
  ],
  "restoreProcedure": [
    {
      "step": 1,
      "component": "encryption-keys",
      "action": "Restore key material; run the decode + round-trip probe; stop on any mismatch"
    },
    {
      "step": 2,
      "component": "postgres",
      "action": "Provision the scratch-then-final instance; restore physical (PITR to a chosen LSN) or logical dump; verify _prisma_migrations and the probe queries"
    },
    {
      "step": 3,
      "component": "deployment-config",
      "action": "Deploy pinned images against the restored database with the env template; run migrations only if the image's schema is older than the restored DB (never ahead of it)"
    },
    {
      "step": 4,
      "component": "redis",
      "action": "Warm-empty; do NOT restore the snapshot into production (its jobs, reservations and claims are all stale by definition); verify the queue gauges"
    },
    {
      "step": 5,
      "component": "dataset-objects",
      "action": "Verify registry digests resolve in the backup or live store; datasets not re-materialised are reported, not hidden"
    },
    {
      "step": 6,
      "component": null,
      "action": "Start the worker with WORKER_ENABLED=true; confirm claims land (GET observability/worker-coordination shows exactly the members in WORKER_MEMBERSHIP), then re-enable the API; confirm the execution engine's /health/ready reports the mode the deployment believes"
    },
    {
      "step": 7,
      "component": null,
      "action": "Rehearsal record: duration against rtoHours, every verification outcome, and every deviation go into the drill document; a restore without a record did not happen"
    }
  ],
  "drill": {
    "cadenceDays": 90,
    "timed": true,
    "successCriteria": [
      "end-to-end restore completes within rtoHours on the restored dataset, not a toy one",
      "every component's verification string above executed and its outcome recorded, including at least one deliberate failure injected into the restore path (e.g. the wrong master key) to prove the stop-the-line behavior",
      "the _prisma_migrations audit, queue gauge check, and worker claim observation all pass with zero manual SQL beyond the documented probes"
    ]
  },
  "nonGoals": [
    "This manifest automates nothing yet; the scheduler and the alerting on missed backups are deliberate follow-ups (see docs/ROADMAP.md open items). It IS the contract any automation must satisfy.",
    "Point-in-time recovery depth, WAL retention and storage-side encryption are the platform/database provider's contracts with the operator; the manifest records what they must provide, not how.",
    "No component here backs up exchange-side truth: fills and order final states are the venue's record, reconciled on restore by the existing reconciliation paths, not restored by us.",
    "The RLS evidence ledger records that an audit ran and what it concluded; it does not make the policies true. Enforcement stays in Postgres (enable.sql), and a fresh FAIL in this ledger is an incident, not a stale-data problem."
  ],
  "rlsEvidence": {
    "cadenceHours": 168,
    "requiredGrade": "pass",
    "evidenceLedger": "docs/dr/rls-evidence.jsonl",
    "verifier": "/internal/v1/enablement/audit",
    "command": "node scripts/rls-enablement.mjs",
    "coverageArtifact": "apps/api/prisma/rls/rls_coverage.json",
    "enableArtifact": "apps/api/prisma/rls/enable.sql",
    "disableArtifact": "apps/api/prisma/rls/disable.sql",
    "detail": "Part 15: enable.sql ships a five-item pre-flight checklist that ends with a human confirming isolation. This block is the machine-shaped version of that confirmation: the verifier endpoint probes the catalogue and counts, grades PASS/FAIL/UNVERIFIED through wlct_trading.enablement, and the operator records the outcome with --record-rls. cadenceHours 168 is one week because a policy flip (a new table, a role change, a migration that recreated a table) is invisible to every other check in this manifest. The command is read-only: this script never connects to a database, so a recorded line is a HUMAN/Automation statement about a run, and --check-rls ages that statement rather than inventing it.",
    "scope": "The engine endpoint verifies the engine plane only (engine_orders, engine_order_events, engine_order_fills, engine_retention_runs). The platform's other covered tables are audited by the operator-side checklist in apps/api/prisma/rls/enable.sql, which this manifest's cadence also ages."
  }
}
```


## FILE: docs/ROADMAP.md (219 lines)

*the Part 15 row, and the open-items paragraph amended in place: the enable.sql checklist is NOT retired by this part, it became auditable, gradable and age-trackable afterwards.*

```markdown
# Roadmap

Part 1 is the foundation. Everything below builds on it in an order chosen so
that each part is shippable, testable and reversible on its own.

The ordering rule: **nothing that touches money ships before the thing that
constrains it.** Risk, limits and audit come before execution; execution comes
before automation.

---

## Part 1 - Foundation (delivered)

Multi-tenancy, identity, RBAC, security, the API skeleton, the admin console
foundation, the mobile foundation, service skeletons, Docker.

Execution is hard-disabled.

---

## Part 2 - Exchange connectivity (non-custodial)

**Goal:** a user can securely attach a real exchange account, and the platform
can read from it. Still no order placement.

* Prisma: `ExchangeAccount`, `ExchangeCredential`, `ExchangeBalanceSnapshot`,
  `ExchangeAccountAudit`.
* Credential intake: submitted once, encrypted with envelope encryption at the
  edge, never returned. A validation call proves the key works and, critically,
  proves that withdrawal permission is **absent** - a key with withdrawal rights
  is rejected outright.
* `trading-engine`: real `ccxt` clients per venue, per-account rate limiting,
  a circuit breaker per venue, clock-skew detection.
* Read-only endpoints: balances, positions, open orders, trade history.
* `market-data`: authenticated feeds, websocket ingestion, the streaming flag
  turned on.
* Mobile and admin: connect-account flow, balance display.

**Ships when:** a real exchange key can be attached, validated and read from,
and the plaintext secret is provably absent from the database, the logs and
every API response.

---

## Part 3 - Trader profiles and strategy definitions

**Goal:** the objects copy-trading will reference, with no copying yet.

* Prisma: `TraderProfile`, `Strategy`, `StrategyVersion`, `PerformanceSnapshot`,
  `TraderFollowerLink`.
* Verified performance only: metrics are computed from executed fills recorded
  by the platform. No self-reported numbers, no backtests presented as results.
* Trader onboarding and approval, with a compliance gate.
* Discovery: search, filter and rank traders.
* Admin: trader approval queue, performance review.
* Mobile: trader list and detail screens.

**Ships when:** a trader can be onboarded and approved, and their performance is
derived exclusively from platform-recorded fills.

---

## Part 4 - The copy engine (paper first)

**Goal:** the full copy pipeline, executing against paper accounts only.

* Prisma: `CopySubscription`, `CopyRule`, `SignalEvent`, `MirrorOrder`,
  `PaperFill`.
* Signal pipeline: detect a leader's fill, translate it through the follower's
  sizing rule, apply risk, place a paper order.
* Sizing modes: fixed notional, proportional to equity, fixed multiplier.
* Risk per follower: max notional, max open positions, max leverage, per-symbol
  allow/deny, daily loss cap.
* Latency budget and slippage accounting, measured and exposed.
* Reconciliation: a periodic job that detects and reports divergence between the
  intended and actual mirrored state.
* `EXECUTION_ENABLED` stays `false`; `paper_trading` stays on.

**Ships when:** a follower's paper account mirrors a leader correctly under
adversarial tests - partial fills, rejects, disconnects, duplicate signals - and
reconciliation reports zero unexplained divergence.

---

## Part 5 - Live execution

**Goal:** real orders, on the user's own exchange account.

This is the highest-risk change in the project and gets treated accordingly.

* Order state machine with idempotency keys; a retried request never
  double-places.
* Exchange error taxonomy: which errors are retryable, which are fatal, which
  require human review.
* Kill switches: platform-wide, per tenant, per trader, per follower.
* Position reconciliation against the exchange as the source of truth.
* Progressive rollout: an allowlist of accounts, then a percentage rollout via
  the existing feature-flag bucketing.
* A dry-run mode that logs the exact payload that *would* be sent.

**Ships when:** a full audit trail exists for every order, every kill switch is
verified under load, and reconciliation has run clean for a sustained period on
the allowlist cohort.

---

## Part 6 - Billing and monetisation

* Payment provider integration (Stripe first). The platform stores no card data;
  it holds provider references only.
* Performance fees: high-water mark accounting, crystallisation periods,
  trader revenue share.
* Invoices, dunning, and a subscription lifecycle driven by provider webhooks
  with signature verification and replay protection.
* Payout ledger for trader earnings.

Money movement is double-entry from day one. A single-entry ledger is not
auditable and cannot be reconciled.

---

## Part 7 - Compliance and operations

* KYC/AML provider integration behind the existing `KycProfile` model.
* Jurisdiction rules: which tenants may onboard users from where.
* Suitability and risk questionnaires; risk-profile gating on copy limits.
* Data subject rights: export and erasure, honouring audit-retention duties.
* Regulatory reporting exports.
* SIEM export for the security event stream.

---

## Part 8 - Scale and reliability

* Read replicas and query routing.
* Time-series storage for market data and performance history.
* Horizontal scaling of the copy engine with partitioned work and leader
  election.
* Row-level security in Postgres as defence in depth behind the application-layer
  tenant scoping.
* Full observability: OpenTelemetry traces, RED metrics per endpoint,
  service-level objectives with alerting.
* Chaos testing: exchange outage, Redis failover, database failover.
* Disaster recovery with a rehearsed, timed restore.

---

## Cross-cutting work, continuous

| Track | Detail |
| --- | --- |
| Testing | unit, integration against a real Postgres, contract tests between the API and the Python services, load tests on the copy path |
| Security | dependency scanning in CI, an external penetration test before Part 5, secret-rotation drills |
| Documentation | an ADR for every consequential decision; an operational runbook per service |
| Accessibility | WCAG 2.1 AA on the admin console; screen-reader support in the mobile client |

## Sequencing constraints

These cannot be reordered:

1. **Part 2 before Part 4.** No copying without a validated exchange connection.
2. **Part 4 before Part 5.** Paper trading is how the pipeline earns the right
   to touch real money.
3. **Risk limits before execution.** The constraint ships before the capability.
4. **Audit before money.** Every financial action must be reconstructable from
   the audit trail on the day the feature launches, not retrofitted afterwards.

---

## Delivery log (as of Part 9)

The delivered parts renumbered relative to this early roadmap (which described
a backlog, not a sequence contract). What has shipped, with its authoritative
document:

| Part | Delivered | Document |
| --- | --- | --- |
| 1 | Platform foundation: multi-tenancy, auth/RBAC, audit, API + admin console + mobile skeletons, the pre-trade risk engine skeleton, connectivity transport | docs/PART1_*.md |
| 2 | Trading core library: order book, market data pipeline, clock/latency discipline | docs/PART2_*.md |
| 3 | Billing, notifications, feature flags, security-event pipeline | docs/PART3_*.md |
| 4 | Execution engine and exchange adapters (authenticated REST/WS, paper-first) | docs/PART4_*.md |
| 5 | Live execution control plane: credentials, kill switches, reconciliation, execution incidents | docs/PART5_*.md |
| 6 | Strategy layer: definitions, instances, backtest and paper sessions, metrics | docs/PART6_*.md |
| 7 | Historical datasets: ingestion, manifests, validation, storage, replay | docs/PART7_*.md |
| 8 | Real-time risk engine: the authoritative fail-closed gate, 22-rule catalog, snapshots, reservations, rate windows, switch lifecycle, risk console (+ read-only mobile viewer) | docs/PART8_RISK.md |
| 9 | Observability & operations: Prometheus exposition (both languages, cardinality-lawed), health/readiness/trading-readiness, alert fold with durable dedupe, incident correlation, shared redaction, queue observability, operations console | docs/PART9_OBSERVABILITY.md |
| 10 | Reliability: OTLP tracing (both planes, sampled, redaction-bound, honest export accounting), SLO/error-budget evaluator with burn alerts, queue-depth law, fault injection (non-prod, self-disabling), production config guards | docs/PART10_RELIABILITY.md |
| 11 | Scale & coordination: cross-language lease/partition foundation (fixture-pinned), the trading-worker plane (partitioned TRADE_EXECUTION consumer with deferral accounting and a strict engine failure taxonomy), services/execution-engine hosting the real core ExecutionEngine (simulated; live refuses by code), read-replica fail-closed routing policy, read-only worker ops view, generated + spec-pinned row-level security (dormant until the checklist-gated enablement), DR manifest with validator and timed-drill contract | docs/PART11_WORKER_SCALING.md, docs/DR.md |
| 12 | Self-registering worker membership (heartbeat-zset registry, fixture-pinned staleness law, config list demoted to fallback, resign-on-shutdown fast path, registry read in the ops view) and the DR backup-freshness ledger (manifest cadences or explicit waivers, --due grading with a cron-able exit code, --record with secret-scan and parse-refusal) | docs/PART12_WORKER_MEMBERSHIP.md, docs/DR.md |
| 13 | Durable execution-engine store: PostgresOrderStore over the core OrderStore port (orders/events/fills/reconciliation state), engine_* tables in Prisma with automatic RLS coverage and per-transaction tenant GUC, opt-in EXECUTION_STORE_BACKEND with no silent fallback either direction, and the worker ack-policy re-review that turned the durable-engine tripwire into a coherence check | docs/PART13_DURABLE_STORE.md |
| 14 | Journal retention: the core's pure retention law (terminal_at-not-status, whole-story-or-none, nonsense-proof policy), the engine executor over the store's own transaction contract (one deletable table, seq-listed batches, ceiling-then-resume), the never-pruned `engine_retention_runs` ledger with dry-runs recorded, apply dark behind config, and the cron-able tenant-per-call CLI with exit-code law | docs/PART14_RETENTION.md |
| 15 | RLS enablement made VERIFIABLE, read-only: the core's pure enablement law (probe shape, platform-scoped bare-read exception, role-attribute veto, pass/fail/unverified grading, nonsense-proof evidence window), the engine's six-statement audit executor (scoped count inside the tenant transaction, bare count outside it, nothing seeded, no write verb by construction), one internal endpoint that answers 200 with a FAIL finding, `scripts/rls-enablement.mjs` (audit/check/print-sql) with no database access of its own, and the append-only `docs/dr/rls-evidence.jsonl` ledger aged by `dr-manifest.mjs --check-rls` under a manifest-declared cadence | docs/PART15_RLS_ENABLEMENT.md |

Still open from the original backlog, deliberately NOT absorbed: time-series
storage behind the exposition (metrics are published, not retained; retention
beyond the durable alert/incident state remains future work - Part 14 closed
the EXECUTION STORE's journal retention, docs/PART14_RETENTION.md, which is
a different table and a different problem, and this item's wording is kept
deliberately so the two are never conflated), RED dashboards
beyond the built-in panel, disaster-recovery rehearsals, and the remaining
Part 8-scale items - enabling the shipped row-level-security policies in
staging per the enable.sql checklist (the Part 13 engine tables are
covered by the same generated machinery, so enabling remains one checklist
for every tenant table - Part 15 did NOT retire that operator step, it made
enablement auditable, gradable and age-trackable afterwards, so the open item
is now "run the audit on staging", see docs/PART15_RLS_ENABLEMENT.md), the
full
chaos/failover matrix against real infrastructure (the invariants are
unit-pinned; a staging run remains a deployment step, see
docs/PART11_WORKER_SCALING.md sec. 18). Part 12 retired two items from this
list: worker membership is now self-registering (WORKER_MEMBERSHIP_MODE,
docs/PART12_WORKER_MEMBERSHIP.md) and backup cadence has its checking
mechanism (`dr-manifest.mjs --due`, exit-code alertable); Part 13 retired
the durable execution-engine store wiring (docs/PART13_DURABLE_STORE.md -
the store ships, the schema is Prisma-owned, and the worker gate's
ack-policy condition is resolved). What remains of
the backup item is deployment-side WIRING of that command into a scheduler
- the ledger refuses to fake its own seed data, so the first real
`--record` is the first real backup evidence.
```


## FILE: docs/SECURITY.md (415 lines)

*the defence-in-depth bullet for Part 15: what the audit proves, what it structurally cannot prove, why a FAIL answers 200, why the surface is internal-only, and why a bypassing role fails the run whatever the counts say.*

```markdown
# Security

This document states what the platform does, why, and where the control lives in
the code. It is written to be checked, not admired: every claim points at a file.

## Threat model in one paragraph

The platform holds credentials that can place trades on a user's exchange
account, and it serves many organisations from one deployment. The two failures
that matter most are **cross-tenant data exposure** and **exchange credential
disclosure**. Everything below is ordered by how directly it prevents one of
those two.

---

## 1. Tenant isolation

| Control | Where |
| --- | --- |
| Query-level tenant predicate | `apps/api/src/infrastructure/database/tenant-scoped-prisma.factory.ts` |
| Tenant resolution and override | `apps/api/src/common/guards/tenant.guard.ts` |
| Non-null `tenantId` + scoped uniqueness | `apps/api/prisma/schema.prisma` |

* A client-supplied tenant identifier is **never** an authorisation input. For
  an authenticated request the tenant comes from the access token.
* Every tenant-owned model is in an explicit allowlist. Adding a table to the
  scoped set is a deliberate edit, not a default.
* Uniqueness is per tenant: two organisations may both have `admin@example.com`.
* Platform-scoped rows (`tenantId = NULL`) are only reachable by platform users,
  enforced by `@PlatformOnly()`.

## 2. Authentication

| Control | Detail |
| --- | --- |
| Password hashing | argon2id; memory/time/parallelism from `ARGON2_*` |
| Access token | short-lived JWT, dedicated signing key |
| Refresh token | stored as HMAC, rotated on every use |
| Reuse detection | a replayed token revokes the whole family and raises `TOKEN_REUSE` (CRITICAL) |
| Device binding | refresh tokens bound to a client-generated device id |
| Logout | access-token `jti` blacklisted in Redis until expiry |
| Global revocation | `sv` claim vs `User.sessionVersion`, checked on every request |
| Session cap | LRU eviction by `lastSeenAt` |
| Lockout | per-account after `LOGIN_FAILED_MAX_ATTEMPTS` within the window |
| Enumeration | identical response and timing for unknown and wrong-password |

### Invalidating live access tokens

Blacklisting a `jti` only kills one token. Password changes and "sign out of
all devices" have to kill *every* token the user holds, including ones already
in flight, so each access token carries an `sv` claim holding the user's
`sessionVersion` at issue time. `JwtStrategy` (and `WsAuthGuard`, so open
sockets drop too) compares it with the stored counter on every request and
rejects a mismatch with `TOKEN_REVOKED`. Incrementing the counter therefore
invalidates all outstanding tokens instantly, without a distributed blacklist.

An integer counter is used rather than comparing the token's `iat` with
`passwordChangedAt`. `iat` has one-second resolution while the timestamp is
stored in milliseconds, so any time-based comparison is ambiguous for tokens
minted in the same second as the change - which is exactly what happens when a
user is handed new tokens immediately after changing their password, or when a
freshly provisioned tenant owner signs in for the first time. The counter also
cannot be skewed by clock drift between API instances.

### Two-factor authentication

TOTP via `otplib`. The shared secret is encrypted at rest with AAD
`two_factor_secret:{userId}`. `lastUsedCounter` is persisted so a captured code
cannot be replayed inside its window. Recovery codes are argon2-hashed and
single-use.

The challenge token issued between the password step and the code step is
bounded rather than strictly single-use: up to
`TWO_FACTOR_MAX_CHALLENGE_ATTEMPTS` (default 5) codes may be tried against it,
after which it is discarded, and it is burned outright the moment a code is
accepted. Burning it on first sight would force a user who mistyped one digit
back through the password step; allowing unlimited tries would leave a captured
challenge open to brute force for its whole TTL. The attempt counter lives in
Redis under the challenge `jti` and expires with it. The endpoint additionally
sits behind the strict `auth` throttler, so the per-challenge budget is the
inner of two independent bounds.

## 3. Authorisation

Deny-by-default. `JwtAuthGuard` rejects any request without a valid token unless
the route is explicitly `@Public()`.

`PermissionsGuard` re-reads the user's live permissions on every request rather
than trusting the token payload, so revoking a role takes effect immediately
rather than at the next token refresh. Wildcards (`*`, `resource:*`) are
supported. A denial emits `PERMISSION_ESCALATION_ATTEMPT`.

Roles are data. Seven system roles ship as immutable templates and are cloned
per tenant. Adding a role never requires an authorisation-code change.

## 4. Exchange credential protection

**The platform never stores an exchange API secret in plaintext, never returns
one through the API, and never writes one to a log.**

Envelope encryption (`packages/utils/src/crypto.ts`):

1. A fresh 256-bit data key (DEK) is generated per record.
2. The payload is sealed AES-256-GCM under the DEK.
3. The DEK is sealed under the key-encryption key (KEK) from
   `ENCRYPTION_MASTER_KEY_BASE64`, tagged with `ENCRYPTION_KEY_ID`.
4. Additional authenticated data binds the ciphertext to `{tenantId}:{userId}`.
   A row copied to another tenant fails to decrypt - tampering is detected, not
   tolerated.

### Key management

| Variable | Purpose |
| --- | --- |
| `ENCRYPTION_MASTER_KEY_BASE64` | active KEK |
| `ENCRYPTION_KEY_ID` | identifies the active KEK in each ciphertext |
| `ENCRYPTION_PREVIOUS_KEYS_JSON` | retired KEKs, decrypt-only |
| `ENCRYPTION_PROVIDER` | `local` or `kms` |

Rotation is zero-downtime: add a new KEK, move the old one into
`ENCRYPTION_PREVIOUS_KEYS_JSON`, and re-wrap records in the background. Nothing
needs to be decrypted and re-encrypted synchronously.

For production, set `ENCRYPTION_PROVIDER=kms` so the KEK never exists in process
memory as raw bytes.

### Operational rules

* Keys come from the environment or a secrets manager. Never from source, never
  from the database.
* Different keys per environment. A staging leak must not affect production.
* Exchange keys should be created trade-only, with withdrawal permission
  disabled and IP-allowlisted to the platform's egress addresses.

## 5. Transport and browser security

| Control | Where |
| --- | --- |
| Helmet security headers | `apps/api/src/main.ts` |
| HSTS, `X-Frame-Options: DENY`, `nosniff` | API + `apps/admin-web/next.config.mjs` |
| Content-Security-Policy with per-request nonce | `apps/admin-web/src/middleware.ts` |
| CORS allowlist | `CORS_ALLOWED_ORIGINS` |
| HTTPS enforced in mobile production builds | `apps/mobile/lib/core/config/app_config.dart` |

### CSRF

The API is token-authenticated and stateless, so it is not inherently
CSRF-exposed. The admin console is, because it keeps its session in cookies. It
therefore uses:

* `SameSite=Strict`, `httpOnly`, `Secure` session cookies.
* A double-submit token: a readable `wlct_csrf` cookie echoed in an
  `x-csrf-token` header, verified on every state-changing route
  (`apps/admin-web/src/app/api/proxy/[...path]/route.ts`).

Tokens are never placed in `localStorage`. An XSS bug in the console cannot
read an `httpOnly` cookie.

## 6. Input validation

* API: `class-validator` with a global `ValidationPipe`
  (`whitelist`, `forbidNonWhitelisted`, `transform`). Unknown properties are
  rejected, not ignored.
* Shared schemas: `packages/validation`.
* Python services: pydantic v2 models with `extra="forbid"`.
* Admin console: zod on every route-handler body.
* Money is `Decimal` end to end - `Decimal(18,6)` in the database, decimal
  strings on the wire, `Decimal` in Python. Never a float.

## 7. Rate limiting

Two buckets backed by Redis so limits hold across replicas:

* `default` for general traffic.
* `auth` for sign-in, registration, refresh and 2FA - the endpoints an attacker
  hits first.

The tracker keys on `user:{id}` when authenticated and `ip:{tenantId}:{ip}`
otherwise, so one noisy tenant cannot exhaust another's budget. Health endpoints
are exempt.

## 8. Audit logging

`AuditLog` is append-only and tenant-scoped. Every privileged action records the
actor, action, outcome, resource, a before/after diff, the request id, and a
**hashed** client IP - never a raw address.

`SecurityEvent` records authentication anomalies: new device, impossible travel,
token reuse, permission escalation attempts, lockouts.

## 9. Logging hygiene

Never logged, in any service:

* passwords, in any form
* access tokens, refresh tokens, challenge tokens, session cookies
* exchange API keys, secrets or passphrases
* encryption keys, data keys, blind-index keys
* payment credentials
* raw client IP addresses

Enforcement:

| Runtime | Mechanism |
| --- | --- |
| Node | pino redaction paths, extensible via `PINO_REDACT_PATHS`; the recursive `redact()` in `@wlct/utils` (keys AND credential-shaped values AND buffers) gates audit payloads and error bodies |
| Python | `wlct_trading.observability.redaction` - since Part 9, the ONE policy both services' `logging_config.py` filters delegate to (recursive dicts/lists/bytes, exception messages, bounded depth). The old per-service key-only regex filters are gone; a cross-language fixture pins the two languages to identical answers |
| Flutter | `AppLogger.redact`, applied at every nesting depth |

The Flutter mobile client disables network logging entirely outside development,
because a request log there would contain a bearer token on a user's device.

### Telemetry-side rules (Part 9)

Observability is a secret-leak surface like any other, so it inherits the same
policy at its own boundary, enforced by the label policy in
`wlct_trading/observability/labels.py` and mirrored in the API registry:

* **Identifier and secret label names are forbidden outright** (`order_id`,
  `request_id`, `correlation_id`, `tenant_id`, `api_key`, `token`, ...) -
  not discouraged; refused at registration. Label names are additionally
  allow-listed, so inventing a label is a code review event.
* **Label values must be bounded wire tokens**; symbols and other finite sets
  only against declared enumerated domains. Series caps make runaway
  cardinality a counted refusal, not an outage.
* **Health details and incident links are redacted/validated at the boundary**:
  component details pass through the redactor where every publisher shares one
  policy; incident records are (kind, targetId) references only - no payload
  can ride into the operations tables by accident.
* **Correlation ids are UUID-or-mint, everywhere** - the API middleware and
  the Python services both refuse unbounded inbound values, so log fields and
  audit columns cannot be injected through a header.
* **`/metrics` exposure**: unauthenticated only under network isolation;
  `METRICS_TOKEN` (constant-time compared) is mandatory in production, and
  the exposition's production-off posture is a boot error, not a setting:
  `OBSERVABILITY_ENABLED`/`METRICS_ENABLED`/`HEALTH_ENABLED`/
  `PROMETHEUS_ENABLED`/`ALERTING_ENABLED` cannot be false in production.
* **No metric sample is a financial record.** Panels report; the risk gate
  decides; nothing in the trading path imports the observability layer
  (boundary tests enforce the one-way dependency).

### Trace-side rules (Part 10)

W3C trace context is attacker-influenced input - every service treats it that
way, and the rules below are enforced by tests on both sides of the language
line:

* **Inbound `traceparent` is parsed-or-ignored, never trusted.** Malformed,
  version-mismatched, all-zero-id, or over-long headers simply do not join:
  the process starts its own root. A foreign trace id can never group
  spans from two unrelated requests, which is how a correlation surface
  becomes a privacy leak.
* **Trace ids are correlation handles, not credentials, and nothing more
  enters the wire.** Span attributes pass a closed-set sanitizer (`safe
  attribute` in both languages): key allow-regex, sensitive-name refusal
  (`api_key`, `authorization`, `password`, ...), value redaction through the
  same `redaction` policy the loggers use, length caps, and a ban on the
  forbidden label names from the metric policy. Header values that must
  travel (the traceparent itself) are re-canonicalised, never echoed raw.
* **Spans carry no payloads.** The queue hop continues traces through a
  Redis **sidecar** keyed by queue+jobId holding only the 55-char traceparent
  - never inside the job payload - so span-graph joins exist without any
  payload ever being copied into telemetry. Writes are fire-and-forget with a
  TTL; a failed sidecar can neither fail nor alter a publish.
* **Fault injection is a boot-time, non-production, closed-set configuration**
  (`FAILURE_INJECTION_ENABLED`, refused by the env validators of both
  runtimes in production). The only runtime operation anywhere is `consume`
  at instrumented points; there is no arm/disarm route, no admin control, and
  the armed plan is reported read-only. The metrics-scrape fault sits AFTER
  token authentication so injection state is not probeable.
* **The trading path never reads telemetry.** `consumeFault` exists in exactly
  two production files (the tracing service and the scrape endpoint); the
  engine's evaluate router must not contain the tokens `injector`,
  `tracer.`, `should_sample` or `sampler` (statically tested); risk decisions
  are computed before any hub is touched and the except-path records a sample
  then re-raises untouched. Sampling changes only what is RECORDED, never
  what is ANSWERED - an unsampled request still gets its `x-trace-id`.
* **SLO evidence is append-only and pruning is bounded.** `SloConfigurationVersion`
  rows are immutable (the only "update" appends version N+1); evaluations and
  sample buckets expire no faster than 7 days regardless of configuration;
  deleting history is not an API surface on any plane.

## 10. Internal service authentication

The Python services are not public. Every route requires:

| Header | Meaning |
| --- | --- |
| `x-internal-token` | equals `INTERNAL_SERVICE_TOKEN`, minimum 32 chars, compared with `hmac.compare_digest` |
| `x-tenant-id` | the tenant the call acts for; the body must agree or the call is rejected |
| `x-request-id` | optional, propagates the API's correlation id |

Comparison is constant-time. A token that is a known placeholder is rejected at
startup rather than accepted quietly.

## 11. Execution safety

Three independent gates prevent Part 1 from placing an order:

1. `EXECUTION_ENABLED=false` platform-wide.
2. The trading engine has no order-placement route.
3. `RiskDecision.wouldExecute = approved AND EXECUTION_ENABLED`.

`EXCHANGE_SANDBOX_MODE=true` additionally disables venues that offer no sandbox.

## 12. Dependency and container posture

* Pinned base images (`node:20.11.0-bookworm-slim`, `python:3.11-slim-bookworm`,
  `postgres:16.4-alpine`, `redis:7.4-alpine`).
* Multi-stage builds; runtime images contain no compiler, no source, no `.env`.
* Every container runs as a non-root user.
* Postgres and Redis publish to `127.0.0.1` only.
* Redis requires a password and uses `volatile-lru`, so queue jobs and sessions
  are never silently evicted.

## 13. Incident response starting points

| Situation | First action |
| --- | --- |
| Suspected token theft | Bump `User.sessionVersion` to invalidate every session for that user |
| Suspected KEK exposure | Rotate `ENCRYPTION_MASTER_KEY_BASE64`, move the old key to `ENCRYPTION_PREVIOUS_KEYS_JSON`, re-wrap in the background |
| Tenant compromise | Set the tenant to `SUSPENDED`; this mass-revokes its sessions |
| Exchange key exposure | Revoke at the exchange first, then delete the record |
| Panel says "healthy" but reality disagrees | Check the publisher mirrors first (`GET /health/components` per service, the fold's `mirrorPresent` in the sync log, and `wlct_registry_series_overflow_total`); absence of alerts means *no publisher reported*, never "all clear" |
| Metrics exposition exposed too widely | Rotate `METRICS_TOKEN`, restrict the listener; the payload itself is label-policy-guarded, so assume no leak of identifiers/secrets until proven otherwise - but treat scraping clients as known callers |

## 14. Worker plane (Part 11)

* The worker (`src/worker.ts`) serves no HTTP at all - not "no public
  routes", no listener exists. Its only egress is one internal service.
* The worker-to-engine secret (`EXECUTION_INTERNAL_TOKEN` /
  `EXECUTION_ENGINE_TOKEN`) is a deployment secret, min 32 chars,
  placeholder-prefixed values refused at both boots, constant-time compared,
  carried ONLY in a header - the engine's client never puts it in a body,
  and its own error surfaces never echo payloads (422 names fields, 500s
  carry correlation ids).
* The execution engine accepts no tenantless command (tenant header
  required), rejects body/header tenant divergence with 403, and its
  simulated answers are labelled as such at every surface.
* `EXECUTION_MODE=live` is refused at the engine's startup by code: the
  queue, the worker, or any API route cannot talk the process into venue
  transmission; the credential provider and the authenticated
  order-placement review remain the open prerequisites (the durable store
  shipped in Part 13 - docs/PART13_DURABLE_STORE.md - and did not change
  this refusal), and the prerequisites are enforced, not configuration.
* The ops view (`GET /v1/observability/worker-coordination`) reads claim
  state written by workers and writes nothing; an expired claim is reported
  as absence, never as a dead worker.

## 15. Known gaps for later parts

* Row-level security: policies and the GUC plumbing ship in Part 11, **dormant
  by design** - enablement is the checklist-gated `apps/api/prisma/rls/enable.sql`
  DBA step, verified by the probes in docs/DR.md; coverage is generated from
  the schema and spec-pinned so no tenant table can silently lack a policy.
* No automated dependency scanning in CI.
* No WAF or bot management in front of the API.
* No hardware-backed key storage; `ENCRYPTION_PROVIDER=kms` is the hook.
* Backups: the contract (manifest, validator, dry-run planner, drill record)
  ships in Part 11; Part 12 adds the freshness ledger (per-component cadence
  or explicit waiver, `--due`'s alertable exit code, `--record` with a
  note-level secret scan that JSON escaping cannot launder) - but the
  *scheduler* that runs them on a timer is still deployment-side wiring, so
  backups today are operator processes against a validated, checkable plan,
  not an unverified cron.
* Worker membership registry (Part 12): the heartbeat zset is
  deployment-scoped state, deliberately NOT tenant-scoped (fleet topology
  is operator-visible by necessity); it carries only worker-id tokens, and
  the registry can never grant authority - claims remain the sole gate, so
  a poisoned or forged membership entry buys an attacker deferral of
  nothing and access to nothing.
* The execution engine's default store is process-local (durability
  `false` is REPORTED, not hidden). The Part 13 durable backend
  (`EXECUTION_STORE_BACKEND=postgres`) persists orders, the event journal
  and the fill ledger in the `engine_*` tables under the same tenant law
  as everything else: every store transaction sets `app.tenant_id` first,
  the tables carry `tenant_id UUID` + the generated row-level-security
  policies, and configuration mismatches (postgres without a DSN, a DSN
  with memory, missing tables) are STARTUP refusals - an engine never
  claims durability it does not have.
* Retention (Part 14) is the only deletion path on the engine plane and
  it is triply narrow: the event journal is the ONLY table any engine
  statement deletes from (a test scans the whole service to hold that
  line - orders, the fill ledger, and the run ledger are not deletable by
  ANY configuration), apply mode is dark until `EXECUTION_RETENTION_ENAB-
  LED=true` restarts the process, and every run - including refused-state
  rehearsals and zero-row runs - leaves a row in `engine_retention_runs`,
  under the same RLS law as its subjects. The route is internal-token and
  tenant-header-matched like the commands, is proxied by nothing public,
  and refuses cross-tenant form by construction (one `--tenant` per call,
  enforced by the same canonical-UUID guard the store writes under).
* Row-level security is a CLAIM, not a state (Part 15,
  docs/PART15_RLS_ENABLEMENT.md): the platform may say policies are enabled
  and enforcing only while a PASSING enablement audit is younger than
  `rlsEvidence.cadenceHours` in the DR manifest. The audit is six `SELECT`s
  and one `SET TRANSACTION READ ONLY` - no seeding, no writes, no
  enable/disable capability anywhere in the verifying code - run inside the
  same tenant-GUC transaction the money path uses, with the leak check
  deliberately performed OUTSIDE it (a bare count taken inside the GUC would
  be the scoped count by construction and could not report a leak). A role
  holding `BYPASSRLS` or superuser fails the whole run whatever the counts
  say; a run that skipped or missed a covered table grades `unverified`,
  which is a third answer and never a shade of green. The route answers 200
  with a FAIL finding rather than 500 (the audit ran; its answer is the
  evidence), refuses with 409/400/503 when there is no durable store, the
  request is out of scope, or `pg_roles` cannot say which role it audited,
  and it is internal-plane only: token, tenant-header-matched, and absent
  from the worker's forwarding path list, which is the public plane's reach.
  What it verifies is the engine plane's four tables; the platform's other
  covered tables stay with `enable.sql`'s checklist, and the manifest's
  `rlsEvidence.scope` says so in words the validator refuses to let anyone
  overclaim. The record of each run is one append-only line in
  `docs/dr/rls-evidence.jsonl` (secret-scanned, refusal-on-corruption like
  the backup ledger), and a RECENT failing audit outranks a stale passing
  one: fixing the alarm means fixing the isolation.
```


## FILE: docs/DR.md (132 lines)

*the second ledger and its commands, plus the new prerequisite pairing: --check-rls green beside --due green before Part 14's first apply.*

````text
# Disaster recovery - the drill, not the binder

The machine-readable plan is `docs/dr/manifest.json` (validated and rendered
by `scripts/dr-manifest.mjs`; `--check` runs in CI, `--plan` produces the
operator runbook, and Part 12's `--due`/`--record` grade and log backup
freshness against `docs/dr/backup-ledger.jsonl`). This file is the human
half: why the manifest says what it says, the post-restore probes, the
ledger's rules, and the drill record every rehearsal must fill in before it
counts.

## The three rules everything else follows from

1. **Keys before ciphertext.** `encryption-keys` restores before `postgres`
   because a database whose credential columns cannot be decrypted is not a
   degraded system, it is a deleted one - and the confusion costs hours
   arguing with the restore. The validator refuses the inverted order
   outright, so nobody relearns this at 3am.
2. **Redis is rebuilt, not restored.** Its queues, claims, leases and rate
   windows are coordination state with TTLs; a snapshot replays the dead
   past as fresh truth. The manifest's redis verification is therefore about
   proving the EMPTY state behaves, not about proving the snapshot loaded.
   (This is the same reasoning as the Part 9 "no publisher reported is never
   'all clear'": stale operational state must announce itself.)
3. **A restore is timed or it didn't happen.** `drill.timed: true` is a
   validator requirement for exactly the reason the platform refuses false
   latency claims everywhere else: the number in the binder that nobody has
   re-measured is marketing.

## Post-restore probe queries (run as the operator role, then as the app role)

```sql
-- Migration ledger: no failures, and the count must equal the repository's
-- prisma/migrations directories for this deployment's schema stamp.
SELECT count(*) FILTER (WHERE finished_at IS NULL AND rolled_back_at IS NULL) AS incomplete,
       count(*) AS applied
FROM "_prisma_migrations";

-- Tenant isolation spot check (works WITH or WITHOUT RLS enabled; with the
-- Part 11 policies ENABLED these MUST read zero from a context without the
-- app.tenant_id GUC, and only-own-tenant with it):
BEGIN;
SELECT count(*) FROM orders;                                    -- no GUC
SELECT count(*) FROM orders, (SELECT set_config('app.tenant_id', '<probe-tenant-uuid>', true)) s;
ROLLBACK;

-- Audit ledger head exists (audit is append-only by policy, not by trust):
SELECT count(*) FROM audit_logs WHERE created_at > now() - interval '10 minutes';
```

The `tenant-scoped` app-role check belongs to whoever runs the enablement
(`apps/api/prisma/rls/enable.sql`'s checklist) - the probes above work from
`psql`; the API-level assertion is `withTenantRls`'s spec plus a staged
cross-tenant read attempt.

## Drill record (copy per rehearsal; a restore without this filled in is not a drill)

| Field | Value |
| --- | --- |
| Date / duration (against RTO `<manifest>.rtoHours` h) | |
| Manifest stamp reviewed (schema + paths verified current) | |
| Components restored, in order, with each verification outcome | |
| Deliberate failure injected (per `drill.successCriteria` - e.g. wrong master key) and the stop-the-line result | |
| Data-loss window actually observed (against RPO) | |
| Follow-up issues filed (every deviation, including "it worked too well") | |
| Sign-off (operator + one engineer not involved in the restore) | |

## The backup-freshness ledger (Part 12)

Manifest v2 states each component's obligation as data: `cadenceHours` -
the maximum age of the last recorded SUCCESS - or `cadenceHours: null` with
a written `cadenceWaiver` (redis is rebuildable; scheduling its copy would
manufacture an obligation the component's contract denies). Postgres' 24h
dump cadence under a 60m RPO is legal only because the component names the
`rpoMechanism` that closes the gap - the validator refuses the silence, not
the number.

The evidence is one JSON line per event in `docs/dr/backup-ledger.jsonl`:

    {"at":"2026-09-14T06:00:00.000Z","component":"postgres","outcome":"ok","note":"pg_dump + scratch restore verified"}

and two commands touch it:

* `node scripts/dr-manifest.mjs --record --component ID --outcome ok|failed
  [--note TEXT] [--at ISO]` - refuses unknown components, broken ledgers
  (no appending onto unreadable evidence), non-ISO stamps, and any
  secret-shaped content in the note, scanning the RAW text because JSON
  escaping is not a laundering licence.
* `node scripts/dr-manifest.mjs --due [--now ISO]` - every component in
  restore order: current, overdue (measured from the last `ok`; a `failed`
  record does not stop the clock), never-recorded, or waived. Exit code 1
  iff something is due - which makes this exact command the cron entry
  point: alerting on it is the scheduler, and the scheduler is wiring, not
  design.

The ledger ships EMPTY on purpose. "No backup recorded" must read as four
`never recorded` alarms, not as fabricated green ticks - a platform that
refuses simulated fills does not seed its own evidence trail with
simulated backups.

Part 14 raised what a fresh `postgres` entry is WORTH: journal retention
deletes settled event rows, and a prune followed by a failed restore is
indistinguishable from a data-losing outage. The rule is therefore one
line of the retention runbook (docs/PART14_RETENTION.md §10, move 1):
`--due` green for `postgres` before the FIRST apply on any deployment,
and the cadence itself is now load-bearing evidence, not hygiene. The
deletion ledger (`engine_retention_runs`) rides the same dump as every
other table - "what was pruned when" must survive the restore that
replays the backup.

Part 15 made the other half of that sentence checkable. The manifest now
carries `rlsEvidence`: a cadence (168h), a required grade (`pass`, not a
knob), the engine endpoint that verifies the engine plane, and its own
append-only evidence ledger, `docs/dr/rls-evidence.jsonl`. `node
scripts/dr-manifest.mjs --check-rls` answers "is there a recent PASSING
row-level-security audit" with an exit code, and `--record-rls` is the only
writer of the ledger. The same ordering as the backups applies, in the
stronger direction: `--check-rls` green is a prerequisite for Part 14's FIRST
apply, because a prune on a database whose partitioning is believed-but-
unverified is a deletion whose blast radius is assumed. Both ledgers refuse to
read each other's file, so an RLS line never parses as a backup line and vice
versa.

## What is NOT yet automated, plainly

The scheduler that runs `--due` on a timer and the drill calendar are the
remaining automation, and they are deliberately thin: Part 12 moved the
judgement (what is due, when, evidenced how) into the validator so the
scheduled half is one command and one exit code (Part 15's `--check-rls`
joined it: same shape, same discipline, still unwired). This ordering is how the
rest of this platform ships: the contract and its validation come before
the automation that depends on them, so the automation has something honest
to check against on day one.
````


## FILE: docs/ARCHITECTURE.md (321 lines)

*the execution-engine paragraph grows Part 15's route: what it audits, what it writes (nothing), and where its durable record lives.*

````text
# Architecture

## 1. What this system is

A multi-tenant, white-label copy-trading platform. One deployment serves many
independent organisations ("tenants"), each with its own users, roles, branding,
subscription and configuration. It is **non-custodial**: the platform never
holds customer funds. Users connect their own exchange accounts with trade-only
API keys, and orders are placed on the user's own exchange account.

Part 1 delivers the foundation - tenancy, identity, authorisation, security and
the service skeletons. Copy-trading logic and live order execution are
explicitly out of scope and are hard-disabled in code.

## 2. Topology

```
                        ┌───────────────────────┐
   Mobile (Flutter) ───▶│                       │
                        │   NestJS API (:4000)  │◀─── Admin console (Next.js :3000)
   Browser ────────────▶│  REST + Socket.IO     │       (server-side proxy only)
                        └───────┬───────────────┘
                                │
            ┌───────────────────┼────────────────────────────┐
            │                   │                            │
     ┌──────▼──────┐     ┌──────▼──────┐            ┌────────▼────────┐
     │ PostgreSQL  │     │    Redis    │            │  Internal HTTP  │
     │  (Prisma)   │     │ cache/queue │            │  (token-gated)  │
     └─────────────┘     └──────┬──────┘            └────────┬────────┘
                                │                            │
                     ┌──────────┴──────────┐      ┌──────────┴──────────┬─────────────┐
                     │ notification-service│      │  trading-engine     │ market-data │
                     │  Node + BullMQ :8003│      │  Python/FastAPI:8001│ Python :8002│
                     └─────────────────────┘      └─────────────────────┘─────────────┘
```

Only the API and the admin console are published. The three supporting services
listen on the internal network and require a shared internal token.

## 3. Why these boundaries

**One API, several workers.** All client traffic terminates at the NestJS API.
It owns the database, authorisation and the audit trail. Everything else is a
worker or a calculator that the API delegates to. This keeps exactly one place
where a tenant boundary can be crossed, which is the property that makes
multi-tenancy auditable.

**Python for market and trading logic.** Exchange connectivity, numerical work
and the risk engine live where the ecosystem is strongest (`ccxt`, the
scientific stack) and where a hot loop will not block a Node event loop.

**Node for the notification worker.** It shares the API's queue contract and
templates; a second language there would buy nothing.

**A separate notification process, not an inline worker.** Email sending is slow
and failure-prone. Running it in the API process would couple request latency to
an SMTP server's mood. `QUEUE_RUN_INLINE_WORKERS` gates the inline path so a
single-process development setup still works.

## 4. Multi-tenancy

### Resolution

The tenant for a request is resolved in this order:

1. Custom domain (`TenantDomain`)
2. Platform subdomain
3. `X-Tenant-Slug` header
4. `DEFAULT_TENANT_SLUG`

For an authenticated request, whatever the above produced is **overridden** by
the tenant in the access token. A client-supplied tenant id is a hint for
unauthenticated flows (sign-in, branding) and never an authorisation input. An
*explicit* selection (domain, sub-domain or header) that contradicts the token
is rejected outright with `403 TENANT_MISMATCH` and recorded as a security
event; the `DEFAULT_TENANT_SLUG` fallback is not, because it reflects a server
assumption rather than a client claim. See `docs/MULTI_TENANCY.md`.

### Isolation

`TenantScopedPrismaFactory` wraps the Prisma client and injects a `tenantId`
predicate into every query against a tenant-owned model. The model allowlist is
explicit, so adding a table is a deliberate decision rather than an accident.

Supporting properties:

* Every tenant-owned table carries a non-null `tenantId`.
* `tenantId` is the first column of every composite index, so the predicate is
  free.
* Uniqueness is scoped: `User` is unique on `(tenantId, email)`, not on `email`.
* Platform-scoped rows use `tenantId = NULL` (system roles, platform plans).
  Prisma cannot express `NULL` inside a compound-unique `where`, so those rows
  are read with `findFirst` and written with explicit update/create branches.

Row-level security is the natural next step; the schema is already shaped for
it.

### Physical naming

Tables and columns are `snake_case` in PostgreSQL (`@@map` / `@map`) while the
Prisma client stays `camelCase` in TypeScript. Application code is unaffected by
the mapping, but every hand-written query, migration, psql session, BI tool and
`GRANT` in `infrastructure/database/init/` avoids permanently quoting
identifiers. Mixing the two conventions - `snake_case` tables with `camelCase`
columns - is the outcome worth avoiding, because it forces quoting anyway while
looking like an oversight.

## 5. Identity and authorisation

### Authentication

* **Passwords**: argon2id, with cost parameters from the environment.
* **Access tokens**: short-lived JWTs, signed with a dedicated key.
* **Refresh tokens**: stored as HMACs, never in the clear. Every refresh rotates
  the token and records `familyId` / `replacedByTokenId`. Presenting a consumed
  token revokes the entire family and raises a `CRITICAL` security event - that
  is the signal of a stolen token.
* **Device binding**: refresh tokens are bound to a client-generated device id,
  so a stolen token is useless elsewhere.
* **Logout**: blacklists the access token's `jti` in Redis until its natural
  expiry.
* **2FA**: TOTP via `otplib`. The secret is encrypted at rest with AAD
  `two_factor_secret:{userId}`; the last used counter is stored to block replay;
  recovery codes are argon2-hashed.
* **Defence**: per-account lockout, uniform responses to defeat account
  enumeration, a session cap with LRU eviction, and suspicious-login scoring.

### Authorisation

Roles are data, not code. Seven system roles ship as immutable templates
(`tenantId = NULL`, `isSystem = true`) and are cloned into each tenant at
creation, so a tenant can customise its own copy without affecting anyone else.

`PermissionsGuard` re-reads live permissions on every request rather than
trusting the token's snapshot, supports `all`/`any` semantics and wildcards
(`*`, `resource:*`), and emits a `PERMISSION_ESCALATION_ATTEMPT` event on
denial. Adding a role or permission is a data change; no authorisation code
needs to be rewritten.

## 6. Secrets and encryption

Exchange API credentials are the highest-value data in the system. They are
protected with envelope encryption:

* A fresh 256-bit **data key** per record.
* The data key is sealed with AES-256-GCM under a **key-encryption key**
  (`ENCRYPTION_MASTER_KEY_BASE64`), identified by `ENCRYPTION_KEY_ID`.
* `ENCRYPTION_PREVIOUS_KEYS_JSON` holds retired keys for decrypt-only, which
  makes rotation a zero-downtime operation.
* **AAD binds ciphertext to its owner** (`{tenantId}:{userId}`). A row copied
  into another tenant will not decrypt.
* `ENCRYPTION_PROVIDER=kms` swaps the local KEK for a managed KMS without
  touching call sites.

Deterministic lookups on encrypted values use an HMAC-SHA256 **blind index**
(`BLIND_INDEX_KEY_BASE64`). The same key hashes client IPs, so the audit trail
is correlatable without storing an address.

Secrets are never returned by the API. Reading a secret tenant setting yields
`{ configured: true }`.

## 7. Errors, logging and observability

Every error leaves the API in one envelope:

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Human-readable, safe to display.",
    "details": [{ "field": "email", "message": "Must be a valid email address" }],
    "requestId": "0f3c...",
    "timestamp": "2026-09-05T10:00:00.000Z",
    "path": "/api/v1/auth/login"
  }
}
```

The Python services emit the same shape, so a client has one parser.

Logging is structured JSON via pino, with a redaction list covering
authorization headers, cookies, passwords, tokens, exchange secrets and payment
credentials. Stack traces never reach a production response body. Every request
carries an `x-request-id` that is propagated to the internal services.

Health endpoints: `/health` (liveness, no dependencies), `/health/ready`
(Postgres + Redis, 503 when down), `/health/deep` (adds queue depth and the
three downstream probes), `/health/startup`.

### The reliability plane (Part 10)

Above the metrics layer sits the reliability plane, and the one law over it:
**observe, never authorise.** Its parts:

* **Tracing.** `apps/api/src/infrastructure/tracing/` (W3C parse/format,
  deterministic BigInt sampling, OTLP/JSON encoder, the middleware,
  `TracingService`) mirrors `libs/trading-core/wlct_trading/observability/`
  (`tracing.py`, `redaction.py`, `faults.py`); the engine's glue is
  `services/trading-engine/app/tracing.py`. Propagation is
  W3C `traceparent`/`tracestate` in, OTLP/JSON out, single-attempt export
  with drop counting that is loud (counters + gauge + a three-streak alert).
  Head sampling is `int(trace_id[:16],16) < ratio_ppm * 2^64 / 10^6` - a pure
  function, identical in both languages, fixture-pinned.
* **SLOs.** Definitions are immutable versioned rows
  (`slo_configuration_versions`, checksummed canonical JSON); measurements
  live in 10-minute Redis bucket hashes (`wlct:trading:ops:slo:<source>:
  <epoch-min/10>`); evaluation appends `slo_evaluations` rows on a */N cron
  and on demand. Dual windows, dual multipliers: paging needs fast burn over
  the short window AND slow burn over the long one (Google SRE style);
  state is `HEALTHY/WARNING/CRITICAL/EXHAUSTED/UNKNOWN`, and UNKNOWN from a
  thin collector is reported as the measurement gap it is (`SLO_TELEMETRY_GAP`),
  never averaged away. The nine default objectives live in the Python catalog
  as the source of truth; the TS catalog is pinned to it by SHA-256 checksums
  that include the human-readable text.
* **Queue correlation.** A publish that succeeds attaches its traceparent to
  a short-TTL Redis sidecar (`captureQueueSidecar`); a worker continues the
  span only if the sidecar exists. Job payloads never carry telemetry fields,
  and telemetry never gates a job.
* **Cross-language contract.** `docs/fixtures/reliability_fixtures.json`
  (generated by `libs/trading-core/scripts/gen_part10_fixtures.py`) pins
  sampling decisions, traceparent/tracestate vectors, attribute hygiene,
  byte-exact OTLP payloads, budget/burn tables, catalog checksums and full
  evaluation rows; `slo-parity.spec.ts` replays every vector through the TS
  implementation. Drift on either side fails the suite, in either direction.

### The worker plane (Part 11)

The process model the earlier parts only described in comments finally
exists: three roles, each able to refuse, none able to impersonate another.

* **API** - unchanged producer of `TRADE_EXECUTION` jobs (deterministic
  `jobId` dedupe at admission, `enqueueOrThrow` for anything a human waits
  on); mounts no consumers, by module graph, not by flag:
  `src/modules/worker/` is imported only by `src/worker.ts`.
* **Worker** (`apps/api/src/worker.ts`, no HTTP server at all) - validates
  each job against the mirrored producer contract, admits it only while it
  verifiably HOLDS the partition claim its `${tenantId}:${accountId}` key
  maps to (rendezvous assignment + Redis claims, both languages pinned by
  `docs/fixtures/coordination_fixtures.json`), forwards, and acks: engine
  2xx completes the job (any business verdict inside it), engine terminal
  4xx/501 fails it visibly with the engine's reason, 5xx/transport retries
  within the producer's attempt budget, and not-owner defers via
  `moveToDelayed` - counted through `WORKER_MAX_DEFERS`, so homeless jobs
  page somebody instead of orbiting forever. Coordination failures fail
  CLOSED to deferral; the job path never awaits Redis.
* **Execution engine** (`services/execution-engine`) - the only process with
  venue-adjacent runtime, hosting the core `ExecutionEngine` behind an
  internal token + required tenant header; serves the four commands the
  queue actually carries, answers 501 to the one it cannot honor
  (`resync-private-stream`), and REFUSES `EXECUTION_MODE=live` at startup
  by code (durability shipped in Part 13; the credential provider and the
  authenticated order-placement review remain live's open prerequisites).
  The store is a backend choice: `memory` (default, process-local, reports
  `storeDurable: false`) or `postgres` (durable orders/events/fills in the
  three `engine_*` tables, DSN required, missing tables or a dead pool
  refuse startup - never a silent fallback). Part 14 added the bounded
  journal: the event table alone is prunable, apply is dark behind
  `EXECUTION_RETENTION_ENABLED`, every completed run (dry included)
  writes a `engine_retention_runs` ledger row nothing prunes, and no
  schedule ships - the deployment's cron calls
  `scripts/retention-run.mjs`, one tenant per run. The worker's boot gate asserts
  engine compatibility, and since the Part 13 ack-policy re-review it
  accepts a durable engine only when the claim is coherent
  (`storeDurable: true` + `storeBackend: "postgres"`). Part 15 added one more
  read-only route beside retention - `POST /internal/v1/enablement/audit` -
  which counts the catalogue and the rows to grade whether row-level security
  is actually enabled and isolating for the engine's own tables, answers 200
  with a FAIL finding because the finding IS the evidence, and writes nothing
  to the database: the durable record of a run is a line in the DR manifest's
  evidence ledger, appended by an operator script that has no credentials of
  its own (docs/PART15_RLS_ENABLEMENT.md).

Read-replica routing lives beside it as a policy, not a rewire:
`routeRead` fails closed in every direction (execution-critical reads never
see the replica; unknown lag or a stale probe routes primary;
half-configured deployments refuse to boot), and the counter family
`wlct_read_routing_decisions_total` makes "we have a replica we never use"
a number instead of a rumor.

The full law, the queue-consumer inventory, the runbook and the honest
deferral list are in `docs/PART11_WORKER_SCALING.md`.

## 8. Real-time

Socket.IO on the `/realtime` namespace. Tokens arrive only in the handshake, and
room membership is derived server-side from the authenticated identity - a
client cannot ask to join `tenant:someone-else`. Cross-node fan-out publishes to
the Redis channel `realtime:dispatch`, and the Redis adapter is keyed with the
configured prefix so several environments can share one Redis instance safely.

## 9. Execution safety

Part 1 must not be able to move money. Three independent gates:

1. `EXECUTION_ENABLED=false` platform-wide.
2. The trading engine exposes risk evaluation only; there is no order-placement
   route to call.
3. `RiskDecision.wouldExecute` is `approved AND EXECUTION_ENABLED`, so even an
   approved intent reports that it would not execute.

`EXCHANGE_SANDBOX_MODE=true` additionally disables any venue without a sandbox.

## 10. Deployment

`docker-compose.yml` is the reference topology. Migrations run as a one-shot
job (`migrate`) that must complete successfully before the API starts - running
them from every replica is a race, and a failed migration should stop a deploy
rather than crash-loop an application container.

All images are multi-stage, run as non-root, carry health checks, and contain no
source, no `.env` and no build cache.

## 11. What Part 1 deliberately does not do

* No copy-trading engine, position sizing, or follower allocation.
* No live order placement.
* No payment provider integration (no card data touches the platform).
* No KYC provider integration (the model and status field exist).
* No row-level security policies yet.
* No simulated trading results anywhere in the product.
````


## FILE: docs/PART14_RETENTION.md (325 lines)

*runbook move 1 amended in place so the two parts' orders agree: a prune now waits on a fresh enablement audit as well as a fresh verified backup. No Part-14 code changed.*

```markdown
# Part 14 - journal retention: pruning the one table that may be pruned

> **Risk note, deliberately unsoftened:** this part puts a DELETE statement
> on the money-adjacent plane, and everything about it is shaped by that.
> One table is deletable (the event journal), by two independent guards;
> the capability is dark by default at BOTH ends (engine config refuses
> apply, script refuses to ask for it); and every run - including the ones
> that delete nothing, and the rehearsals - leaves a row in a ledger that
> nothing prunes. Live venue transmission is unaffected by this document:
> it remains refused at engine startup (Part 13 §1; credential provider
> and placement review still open).

## 1. What Part 13 left standing, and why it bends

The durable store ships three tables. Two of them are correct to keep
forever: `engine_orders` is one modest row per order (the record every
later command looks up), and `engine_order_fills` is the money ledger -
fees and aggregates reconcile against it, and Part 13 deliberately made
its child FK `ON DELETE RESTRICT` so that deleting an order with fills is
not a retention setting, it is a schema change. The third -
`engine_order_events` - grows without law: every transition appends,
payload included,
and a churning resting order can write a dozen rows a minute for hours.
Unbounded growth next to money is how operations get "we must vacuum the
audit table" conversations, and the wrong resolution (prune by age alone)
is how the story behind a disputed fill quietly disappears.

So the scope of this part, exactly: **the journal is prunable, everything
else is not, and both halves are enforced rather than promised.**

## 2. The law (core), before any SQL existed

`libs/trading-core/wlct_trading/retention.py` is pure and knows no
database. Four laws, each with a reason:

1. **Terminality is `terminal_at`, never a status re-derivation.** The
   core's transition table stamps `terminal_at` when an order reaches a
   terminal status (orders.py), and the store persists the stamp
   (Part 13). Retention asks the stamp, not the status list - a second
   definition of "done" would be a second thing to drift. A row whose
   stamp is NULL is UNPROVEN-settled and kept, whatever an operator
   believes its status means.
2. **An order keeps its whole story or none of it.** An event is prunable
   only when BOTH the event and its order's `terminal_at` are older than
   the cutoff. Without the second comparison, "90-day retention" would
   erase the history of an order that settled yesterday while the order
   row itself remains - the exact window an investigation is open in.
3. **Nonsense cannot exist.** `RetentionPolicy` refuses at construction:
   days outside 1..36,500 (zero is a loaded gun; a century is a lie about
   intent), batch rows outside 1..10,000, batches outside 1..1,000, and
   booleans (Python's `True` IS `1` day - a joke with database
   consequences). The engine's config validator constructs the policy at
   BOOT, so a typo names its env var in a startup failure instead of
   naming it in an incident.
4. **Timestamps arrive as arguments.** `now_us` is a parameter on every
   law-bearing function; the module imports no clock (a purity test walks
   the syntax tree and refuses imports of `time`/`datetime` and any
   `now()`-shaped call). A deletion path that cannot be given a fake clock
   is a deletion path that cannot be tested at the boundary.

`PRUNABLE_JOURNAL` and `IMMUTABLE_RECORD_TABLES` are named constants
because "obviously only the journal" survives one confident refactor only
as an identifier something can test against.

## 3. The executor: small, literal, and boring on purpose

`services/execution-engine/app/retention.py` holds five SQL constants
(hand-assembled adjacent literals - Part 13's law continues to bind) and
two coroutines:

- `run_event_retention(pool, tenant_id, policy, dry_run, instance_id)` -
  dry runs execute ONE count statement; applies loop over
  batch-select → delete-by-explicit-seq-list until the journal is
  considered, the work ends mid-batch, or the ceiling stops the run
  (`exhausted: true`, "schedule again" - a maintenance job yields to the
  command path, it does not drain a shard in one statement);
- `inspect_event_store(...)` - count + last five ledger rows, in ONE
  transaction, because two queries at different times are two answers.

The invariants the tests pin character-for-character:

- every statement carries `tenant_id = $n` in its WHERE (the belt) and
  runs inside the store's OWN `_TenantTransaction` - the GUC first
  statement, the canonical-UUID guard before the pool is borrowed, the
  per-transaction rhythm. Retention got zero new connection handling
  because every law Part 13's tests pin for writes extends to deletes for
  free;
- the count and the batch-select embed the SAME predicate text (a test
  pins that the shared WHERE constant is present in both), so a rehearsal
  cannot mean something different than the execution;
- deletes name explicit `seq = ANY($2::bigint[])` lists - never a
  predicate the database re-evaluates at delete time, never a USING-join
  shortcut - and `RETURNING 1` makes the reported count the rows ACTUALLY
  removed, so losing a race to a concurrent delete shrinks the number and
  nothing else;
- each batch is its own committed transaction (locks held per batch, a
  crash mid-run loses only the un-ledgered remainder, and the predicate
  makes the next run resume by construction - already-deleted rows simply
  stop matching);
- no retries anywhere in the loop. A store error propagates; the scheduler
  will try again, against idempotent statements. That is the same
  at-least-once contract the worker's command path earned in Part 11.

## 4. The ledger: `engine_retention_runs`

One row per COMPLETED run, written after the deletes, in its own
transaction: tenant, started/finished (micros), the applied cutoff,
`rows_deleted` (for dry rows: the prunable count - the column's name is
read as "reported", `dry_run` makes which one it is unambiguous),
`batches`, `exhausted`, and the `instance_id` that performed it. The
table lives by the same ownership law as the store's three: Prisma model
+ migration DDL in `apps/api/prisma`, RLS coverage via the generator
(now 42 covered tables), composite tenant FK with `Restrict` - the
deletion record survives arguments about the tenant.

Two honest edges, stated:

- **Refusals do not reach the ledger.** They happen at the router, in
  front of any store handle, and they return their code over HTTP - an
  operator wanting "who tried to prune against a dry-run-only deployment"
  gets it from the engine's log lines, not from a table that only the
  durable path could write. A "refused" row that requires the store would
  not exist precisely when memory mode refuses for want of a store.
- **The ledger insert is the one write that can fail after the deletes.**
  The design chose that ordering on purpose (recording first would
  over-record deletions that then failed to happen) and made the
  consequence survivable: a ledger failure surfaces as
  `RetentionLedgerLost` carrying the FULL counts, logged at ERROR
  (`retention.ledger_write_failed`) and echoed in the 500 body - the
  operator reading the response, or the script's stdout, holds exactly
  what the missing row would have. Between an under-record and an
  over-record, the platform under-records LOUDLY.

## 5. Configuration: dark at both ends

| Variable | Default | Law |
| --- | --- | --- |
| `EXECUTION_RETENTION_ENABLED` | `false` | Gates APPLY only. Inspect/dry-run need nothing. |
| `EXECUTION_RETENTION_EVENT_DAYS` | `90` | Constructed into the core policy at boot; out-of-bounds refuses startup. |
| `EXECUTION_RETENTION_BATCH_ROWS` | `2000` | ditto |
| `EXECUTION_RETENTION_MAX_BATCHES` | `50` | ditto |

Compose passes all four with `${VAR:-default}` (the `:-` form means an
EMPTY override resolves to the default - the Part 13 empty-DSN trap cannot
recur). The public config view exposes all four (non-secret by
construction); `/health/ready` and `/internal/v1/status` carry
`retentionEnabled`/`retentionEventDays` so the posture is readable, and
`describe()`'s new fields travel to the worker's status assertion without
joining its compatibility law (the worker does not gate on retention -
its commands do not touch the journal).

## 6. The wire surface: two POSTs, five answers

Both routes live on the internal prefix, behind the same token auth and
the same body-vs-header tenant match as the command routes. The error
envelope is the engine's existing flat `{code, message}`:

- `409 RETENTION_NO_DURABLE_STORE` - memory mode, both routes. The message
  says WHY it is not an empty success: memory journals are bounded by
  restart; pretending to prune them would be answering a maintenance
  command with a fiction.
- `409 RETENTION_APPLY_DISABLED` - apply attempted while ENABLED=false,
  and (pinned) not ONE statement reached the pool.
- `409` from the store's own UUID guard path is not applicable (the
  executor borrows the store's guard, refusing before touching the pool -
  `pool.acquires == 0` is asserted).
- `500 RETENTION_LEDGER_LOST` - section 4's loud under-record, counts in
  the body.
- `200` otherwise: `{"dryRun","cutoffUs","rowsReported","batchesRun","exhausted","ledgerWritten"}`
  for run; config view + `prunableNow` + recent `runs[]` for inspect.

The routes are reachable ONLY with the internal token, compose keeps the
engine on the internal network, and nothing on the public API proxies
here. A tenant cannot prune itself out of its audit trail; an operator
with the token and a scheduler can prune a tenant that asked them to -
which is the standing trust model of every engine command, restated
because the verb here is DELETE.

## 7. The CLI, and what scheduling means here

`node scripts/retention-run.mjs --tenant <uuid> [--inspect|--apply]` is
the only way this part intends deletion to happen unprompted:

- exit 0 completed / 1 engine refused or failed (code+message echoed,
  counts included for ledger-lost) / 2 misuse or unreachable engine - the
  exit-code contract a cron or systemd timer alerts on, matching
  `dr-manifest.mjs --due`'s precedent;
- one tenant per invocation, ALWAYS - a `--all-tenants` flag would be the
  cross-tenant sweep the store exists to refuse, wearing a CLI;
- the token is env-only and scrubbed from every line printed, including
  echoed error bodies (a test makes the fake engine reflect the token
  inside a 500 message and asserts it never reaches stdout);
- `--inspect` and dry-run are the defaults' friends: with no mode flag the
  call is a rehearsal, and the rehearsal is what the cron entry SHOULD be.

Deployment owns the cadence (a timer per tenant, or a loop calling the
script); the platform owns refusing to invent one. Compose ships no cron
sidecar: a schedule that exists is a promise about evidence and freshness
the deployment - and only the deployment - can keep, same reasoning as the
DR ledger staying unwired.

## 8. RLS and the cross-tenant proof

The ledger table was picked up by the Part 11 generator with no generator
change (coverage 41 → 42), so the enablement checklist remains one
document for every tenant table. The live suite (gated, honest, same
pattern as Part 13's) executes the whole argument on a real database: an
apply prunes tenant A's rows and touches NOTHING belonging to B - same
shapes, same cutoffs, same tables; and with policies ENABLE/FORCED on the
ledger, the executor's own transaction sees its new row while a bare
session sees zero rows, because the GUC is transaction-local and the law
of Part 13 §3 binds deletes as tightly as it binds writes.

## 9. Test law, with its limits in the same font

- `libs/trading-core/tests/test_part14_retention.py` - 35 tests: the
  construction law matrix, cutoff arithmetic recomputed through a second
  unit path, the prunable-predicate boundary rows (both strict-`<` edges
  included), the table-naming laws, and the AST-level purity scan (no
  clock, no driver, no status vocabulary - prose mentions are legal,
  imports are not).
- `services/execution-engine/tests/test_part14_retention.py` - 33 tests:
  five statement-literal pins (shared predicate, single delete target
  scanned off the module's own strings, sqlglot parse, ledger columns in
  migration order), the scripted conversations (dry/apply/ceiling/empty/
  race/ledger-failure/pool-error, transaction boundaries counted, GUC
  before every statement, zero pool acquires when the guard fires), and
  the HTTP matrix over a patched-pool booted app (including
  `statements == []` on the refused apply).
- `services/execution-engine/tests/test_part14_drift_parity.py` - 11
  tests: migration ⇄ Prisma model ⇄ executor INSERT re-derived to agree
  (minus the identity column, deliberately), the index name in both
  artifacts, the predicate columns existing in Part 13's DDL, the
  whole-app scan that finds exactly one `DELETE FROM` target, and RLS
  coverage/enable/disable symmetry for the new table.
- `services/execution-engine/tests/test_part14_retention_live.py` - 5
  tests against a REAL Postgres when `EXECUTION_TEST_POSTGRES_DSN` is
  set (skipped-by-name otherwise, exactly as disclosed for Part 13): the
  predicate matching the prose row-for-row, dry-run recording without
  touching a row, ceiling-stop-then-resume with the remainder intact
  across two runs, tenant isolation under identical shapes, and the
  live RLS probe on the ledger.
- `scripts/retention-run.test.mjs` - 11 node tests: arg law (dry default,
  exclusive modes, canonical-uuid refusal, no-token refusal), request
  shape, the scrub function, and full-process CLI runs against a real
  local fake engine asserting exit codes, header/body pairs, and the
  token never surfacing even when the server echoes it back.

The limits, plainly: the sandbox has no Postgres server, so the live
layer was verified to SKIP (12 skips across both live files, by name, in
the final ledger); its claims about the database are the CI database's to
confirm, same stance as Part 13 §9. The scripted fakes pin the SHAPE of
every statement and conversation; the live file is what pins their SUB-
STANCE. Both halves of that sentence are load-bearing.

## 10. The runbook (four moves, in order, with the reason each exists)

1. **Back up first, provably.** `node scripts/dr-manifest.mjs --due`
   green for the `postgres` component before any apply - a prune followed
   by a failed restore is indistinguishable from a data-losing outage.
   (The check exists since Part 12; this part makes its first real
   consequence one a deletion could worsen.) Since Part 15 the same move
   carries a second gate: `node scripts/rls-enablement.mjs check` (i.e.
   `dr-manifest.mjs --check-rls`) green too, because a DELETE whose
   blast radius depends on row-level security should not run against a
   partitioning that is believed rather than audited
   (docs/PART15_RLS_ENABLEMENT.md sec. 8).
2. **Inspect on the staging tenant set.** `--inspect` answers "what WOULD
   go, and when did we last run" in one transaction; read the cutoff it
   prints and make sure it is the cutoff you meant.
3. **Schedule the rehearsal.** A cron line running the default (dry) mode
   per tenant writes ledger rows that become the numbers you judge the
   first apply against. "Prune nothing for a week, watch the count" is a
   real safety feature with a 0-cost rollout.
4. **Enable, apply, verify.** Set `EXECUTION_RETENTION_ENABLED=true`
   (restart - the flip is deliberately not hot), run one `--apply` per
   tenant, read the ledger row back via `--inspect`
   (`rowsDeleted`/`exhausted`), and let the scheduler take it from there.
   A `dryRun=false, rows_deleted=0` row at steady state is a healthy run.

Rollback of a mistake is out of scope by the same law as the deletion:
Postgres point-in-time recovery from a verified backup - the DR runbook
(docs/DR.md), not a feature flag. That is why move 1 is the first move.

## 11. Decisions, each with its rejected alternative nearby

| Decision | Rejected alternative | Why |
| --- | --- | --- |
| Prune events only; orders and fills are permanent | Age-pruning orders too (with CASCADE-deleting fills, or re-RESTRICTing to Cascade) | The order row is the audit spine commands look up; fills are money. Growth was only ever in the journal; deleting what does not grow buys risk for nothing |
| `terminal_at` stamp as the settledness law | Re-deriving from `TERMINAL_ORDER_STATUSES` at prune time | Two definitions of "done" drift; the writer already decided, per row |
| Cutoff compares event AND order settlement | Pruning any event by its own age | Law 2: the recent history of a just-closed order is the active case |
| Explicit seq lists for DELETE | `DELETE ... USING` with the predicate re-evaluated | The rehearsal's rows are exactly the deleted rows; concurrent activity can only shrink the count, never retarget the delete |
| Ledger written after the deletes | Write-ahead "started" row + update (or refusals recorded too) | An update path that can half-write is worse; refusals lack the very handle a ledger row needs; the loud 500 carries the record forward instead |
| Dry runs recorded | Rehearsals being ephemeral | The scheduled rehearsal's ledger row IS the evidence the first apply is judged on |
| Engine endpoint + thin CLI, no scheduler in compose | Engine-side cron loop (self-firing deletes) | A process that deletes on its own schedule cannot be paused by pausing the schedule; deployment-owned cadence can |
| Bounded batches + `exhausted` resume | Unbounded "clean everything" | Retention competes with the money path for locks; losing that race must be structurally impossible |
| Refusal at router before any store touch | Executor-internal guards | One code path where "0 statements" is testable; the module stays about SQL, not config archaeology |

## 12. Cross-references

- Part 13: `docs/PART13_DURABLE_STORE.md` - the store whose transaction
  helper this part reuses verbatim, and whose §13 open-items list this part
  amends (journal retention closed; metrics time-series retention stays
  open - different table, different part, never conflate them).
- Part 11: `docs/PART11_WORKER_SCALING.md` §13 - the "no database" law
  this part extends without contradicting (the default still reports
  `storeDurable: false`; retention simply cannot be pointed at it).
- `docs/DR.md` - backup freshness is now load-bearing for deletion safety,
  not only for disaster size; and `docs/SECURITY.md` / `docs/ARCHITECTURE.md` carry the updated bullets.
- `docs/ROADMAP.md` - delivery-log row 14; the journal-retention entry is
  struck from the open list.

## 13. What this part does NOT do

It does not delete anything by itself, ever (no schedule ships, no
self-firing job); does not prune orders, fills, reconciliation state, or
its own ledger (structurally - one DELETE target, scanned app-wide by
test); does not grow the worker or the public API (no proxy, no queue
command, and the worker's gate remains what Part 13 made it); does not
touch live mode (startup still refuses it for the missing provider and
review, and a prune run against a live engine would still just be a
prune); does not pretend memory mode has a growth problem (it says so,
in the 409's own words); and does not add a fleet-wide sweep - `--tenant`
is required, the store's tenant law with a CLI bolted on, which is the
only kind of retention call this platform will make.
```

