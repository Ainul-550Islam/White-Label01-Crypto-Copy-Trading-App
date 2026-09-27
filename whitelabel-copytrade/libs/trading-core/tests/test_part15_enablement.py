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
