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
        "circuit_breaker_records",
        "compliance_policy_records",
        "institutional_risk_policies",
        "kill_switches",
        "legal_holds",
        "mobile_reconciliation_findings",
        "mobile_release_audits",
        "operational_actions",
        "operational_audit_logs",
        "operational_dependency_checks",
        "operational_incident_events",
        "operational_incidents",
        "operational_maintenance_windows",
        "operational_readiness_checks",
        "operational_reconciliation_runs",
        "operational_recovery_runs",
        "operational_service_degradations",
        "ops_alerts",
        "ops_incidents",
        "partner_attributions",
        "partner_audits",
        "partner_commissions",
        "partner_tenant_relationships",
        "plans",
        "roles",
        "security_events",
        "security_policies",
        "subscription_plans",
        "webhook_events",
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
