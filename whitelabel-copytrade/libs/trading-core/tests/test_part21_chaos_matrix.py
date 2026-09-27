"""Tests for the chaos / failover probe matrix (Part 21).

These tests are mostly *negative* by design, and that is the point: the property worth defending in
a chaos tool is not "it can report a pass" but "it cannot report a pass it did not earn". So the
bulk of this file asserts refusals, the unverified grade, the absence of a clock, and the boundary
that keeps the module off the trading path.
"""

from __future__ import annotations

import json
import subprocess
import sys
from collections.abc import Callable, Iterable, Mapping
from pathlib import Path

import pytest

from wlct_trading.observability.chaos import (
    CHAOS_GRADES,
    CHAOS_MATRIX,
    INFRASTRUCTURE,
    MATRIX_ORDER,
    ChaosRefusedError,
    main,
    render_text,
    run_matrix,
)
from wlct_trading.observability.chaos import MatrixReport
from wlct_trading.observability.faults import FAULT_POINTS, FailureInjector, FaultSpec

CORE_ROOT = Path(__file__).resolve().parents[1]
CHAOS_SOURCE = (CORE_ROOT / "wlct_trading" / "observability" / "chaos.py").read_text(encoding="utf-8")


def _run(
    *,
    environment: str = "test",
    generated_at: str = "2026-09-18T00:00:00+00:00",
    availability: Iterable[str] = (),
    checks: Mapping[str, Callable[[], bool]] | None = None,
    injector: FailureInjector | None = None,
) -> MatrixReport:
    # A typed pass-through rather than a dict of objects: the only way to keep a test helper honest
    # about the signature it is calling is to spell the signature out.
    return run_matrix(
        environment=environment,
        generated_at=generated_at,
        availability=availability,
        checks=checks,
        injector=injector,
    )


def test_the_matrix_is_the_ten_documented_scenarios_in_drill_order() -> None:
    assert MATRIX_ORDER == (
        "exchange_outage",
        "redis_failover",
        "postgres_failover",
        "worker_kill",
        "restart_mid_flight",
        "membership_change",
        "transport_timeout",
        "engine_restart",
        "stale_coordination",
        "redelivery",
    )
    assert len(CHAOS_MATRIX) == 10
    # The letters are how the runbook refers to them; losing one in a refactor would silently
    # decouple the code from the document it claims to implement.
    assert [probe.title[0] for probe in CHAOS_MATRIX] == list("ABCDEFGHIJ")


def test_every_probe_carries_all_eight_fields_and_a_bounded_timeout() -> None:
    for probe in CHAOS_MATRIX:
        for field in (
            "setup",
            "injection",
            "expected_invariant",
            "observation",
            "recovery",
            "cleanup",
        ):
            value = getattr(probe, field)
            assert isinstance(value, str) and len(value.split()) >= 4, f"{probe.probe_id}: {field} is filler"
        assert 5 <= probe.timeout_seconds <= 900, probe.probe_id
        assert probe.requires, probe.probe_id
        assert probe.requires <= INFRASTRUCTURE, probe.probe_id
        assert set(probe.fault_points) <= FAULT_POINTS, probe.probe_id


def test_the_fault_universe_is_not_extended_through_the_back_door() -> None:
    # The matrix reuses the closed set; if it ever needed a new point, the new point has to be
    # argued in faults.py with a test and a reason the trading path cannot key off it.
    used = {point for probe in CHAOS_MATRIX for point in probe.fault_points}
    assert used <= set(FAULT_POINTS)
    assert len(used) >= 6
    with pytest.raises(ValueError, match="outside the closed universe"):
        _build_bad_probe(fault_points=("orders_suppress_risk_check",))


def _build_bad_probe(*, fault_points: tuple[str, ...]) -> object:
    from wlct_trading.observability.chaos import ChaosProbe

    return ChaosProbe(
        probe_id="bad_probe",
        title="Z - an invented fault point",
        requires=frozenset({"worker_process"}),
        fault_points=fault_points,
        setup="a setup sentence long enough",
        injection="an injection sentence",
        expected_invariant="an invariant sentence here",
        observation="an observation sentence",
        recovery="a recovery sentence",
        cleanup="a cleanup sentence",
        timeout_seconds=60,
    )


def test_unknown_infrastructure_and_bad_timeout_are_construction_errors() -> None:
    from wlct_trading.observability.chaos import ChaosProbe

    with pytest.raises(ValueError, match="infrastructure vocabulary"):
        ChaosProbe(
            probe_id="needs_kubernetes",
            title="Z",
            requires=frozenset({"kubernetes"}),
            fault_points=(),
            setup="a",
            injection="b",
            expected_invariant="c",
            observation="d",
            recovery="e",
            cleanup="f",
            timeout_seconds=60,
        )
    with pytest.raises(ValueError, match="timeout_seconds"):
        ChaosProbe(
            probe_id="forever",
            title="Z",
            requires=frozenset({"worker_process"}),
            fault_points=(),
            setup="a",
            injection="b",
            expected_invariant="c",
            observation="d",
            recovery="e",
            cleanup="f",
            timeout_seconds=100_000,
        )


def test_production_is_refused_before_anything_is_read() -> None:
    for environment in ("production", "prod", "PRODUCTION "):
        with pytest.raises(ChaosRefusedError, match="refuses to run in production"):
            _run(environment=environment)


def test_an_unnamed_environment_is_refused_too() -> None:
    # The set is closed for the same reason the injector's fault points are: an environment the tool
    # cannot name is an environment it cannot refuse correctly.
    with pytest.raises(ChaosRefusedError, match="unknown environment"):
        _run(environment="prod-ish")
    with pytest.raises(ChaosRefusedError, match="outside the infrastructure vocabulary"):
        _run(availability=("postgres_primary", "cloud"))
    with pytest.raises(ChaosRefusedError, match="unknown probes"):
        _run(checks={"not_a_probe": lambda: True})


def test_no_infrastructure_means_every_probe_is_unverified_and_never_pass() -> None:
    report = _run()
    assert report.grade == "unverified"
    assert len(report.outcomes) == 10
    for outcome in report.outcomes:
        assert outcome.grade == "unverified", outcome.probe_id
        assert outcome.source == "none"
        assert outcome.checks_run == 0
        assert outcome.reason.startswith("required infrastructure not available:")
    counts = report.counts
    assert counts["unverified"] == 10
    assert counts["pass"] == 0


def test_availability_without_a_check_is_a_plan_not_a_result() -> None:
    everything = frozenset(INFRASTRUCTURE)
    report = _run(availability=everything)
    assert {outcome.grade for outcome in report.outcomes} == {"planned"}
    assert report.grade == "planned"
    assert "specified" in report.outcomes[0].reason
    # A plan is not a failure either: the exit code for planned is 0 with an explicit sentence.
    assert "not armed" in report.outcomes[0].reason


def test_a_harness_pass_is_marked_as_a_harness_pass() -> None:
    everything = frozenset(INFRASTRUCTURE)
    report = _run(availability=everything, checks={"redis_failover": lambda: True})
    by_id = {outcome.probe_id: outcome for outcome in report.outcomes}
    assert by_id["redis_failover"].grade == "pass"
    assert by_id["redis_failover"].source == "harness"
    assert by_id["redis_failover"].checks_run == 1
    # …and one green cell cannot be averaged into a green matrix: the others are still plans.
    assert report.grade == "planned"
    assert report.counts["pass"] == 1
    assert report.counts["planned"] == 9


def test_a_failing_or_raising_check_fails_loudly_and_keeps_its_evidence() -> None:
    everything = frozenset(INFRASTRUCTURE)

    def boom() -> bool:
        msg = "the coordination view showed two owners"
        raise RuntimeError(msg)

    report = _run(
        availability=everything,
        checks={"membership_change": lambda: False, "redelivery": boom},
    )
    by_id = {outcome.probe_id: outcome for outcome in report.outcomes}
    assert by_id["membership_change"].grade == "fail"
    assert by_id["membership_change"].reason == "harness check returned false"
    assert by_id["redelivery"].grade == "fail"
    assert "RuntimeError" in by_id["redelivery"].reason
    assert by_id["redelivery"].evidence["cleanup"]
    assert report.grade == "fail"


def test_a_refusal_from_a_check_is_not_a_result() -> None:
    def refuse() -> bool:
        msg = "no"
        raise ChaosRefusedError(msg)

    with pytest.raises(ChaosRefusedError, match="no"):
        _run(availability=frozenset({"worker_process"}), checks={"worker_kill": refuse})


def test_the_report_is_deterministic_and_carries_no_implicit_now() -> None:
    first = _run(availability=frozenset(INFRASTRUCTURE), checks={"engine_restart": lambda: True}).to_dict()
    second = _run(availability=frozenset(INFRASTRUCTURE), checks={"engine_restart": lambda: True}).to_dict()
    assert first == second
    assert first["generated_at"] == "2026-09-18T00:00:00+00:00"
    assert json.dumps(first, sort_keys=True) == json.dumps(second, sort_keys=True)


def test_the_module_keeps_the_injectors_bluntness_laws() -> None:
    # No clock, no threads, no subprocess, no sockets: the matrix declares timeout budgets for the
    # operator to enforce, and a module that imported time would be a module that sleeps in CI.
    for forbidden in ("import time", "import threading", "import asyncio", "import subprocess", "import socket", "import datetime"):
        assert forbidden not in CHAOS_SOURCE, f"chaos.py must not {forbidden}"
    for capability in (".arm(", "os.kill", "system(", "popen"):
        assert capability not in CHAOS_SOURCE.lower(), f"chaos.py must not {capability}"
    # And it is read-only about injection state: it may ask, never set.
    assert "is_armed" in CHAOS_SOURCE
    assert "consume(" not in CHAOS_SOURCE


def test_the_injector_is_read_as_configured_state() -> None:
    injector = FailureInjector.from_settings(
        enabled=True,
        specs={"redis_health_probe_unavailable": FaultSpec(enabled=True, times=-1)},
    )
    report = _run(injector=injector, availability=frozenset(INFRASTRUCTURE))
    assert report.injector_enabled is True
    assert report.armed_points == ("redis_health_probe_unavailable",)
    by_id = {outcome.probe_id: outcome for outcome in report.outcomes}
    assert "armed" in by_id["redis_failover"].reason
    assert "not armed" in by_id["worker_kill"].reason


def test_grades_are_the_closed_vocabulary() -> None:
    assert CHAOS_GRADES == ("pass", "fail", "unverified", "planned", "skipped")
    for report_environment in ("test", "ci"):
        report = _run(environment=report_environment, availability=frozenset(INFRASTRUCTURE))
        for outcome in report.outcomes:
            assert outcome.grade in CHAOS_GRADES


def test_text_rendering_restates_the_reading_law() -> None:
    text = render_text(_run())
    assert "chaos matrix" in text
    assert "[UNVER]" in text
    assert "never pass" in text
    assert "unverified means this run had no way to know" not in text  # that sentence is for JSON


def test_the_json_document_is_what_a_machine_needs() -> None:
    report = _run(availability=frozenset(INFRASTRUCTURE))
    document = report.to_dict()
    assert document["schema"] == "wlct.chaos.matrix/1"
    assert "unverified means this run had no way to know" in str(document["reading"])
    probes = document["probes"]
    assert isinstance(probes, list) and len(probes) == 10
    first = probes[0]
    assert isinstance(first, dict)
    assert set(first) == {"probe_id", "grade", "reason", "source", "checks_run", "evidence"}
    assert set(first["evidence"]) == {
        "title",
        "setup",
        "injection",
        "expected_invariant",
        "observation",
        "recovery",
        "cleanup",
        "timeout_seconds",
        "requires",
        "fault_points",
    }


def test_cli_exit_codes_follow_the_operational_convention() -> None:
    assert main(["--list"]) == 0
    assert main(["--environment", "test"]) == 2, "no infrastructure -> unverified -> exit 2"
    assert main(["--environment", "test", "--json"]) == 2
    assert main(["--environment", "production"]) == 3
    assert main(["--environment", "prod", "--json"]) == 3
    assert main(["--environment", "staging", "--availability", "exchange"]) == 2


def test_cli_json_output_parses_and_says_what_a_run_cannot_claim(
    capsys: pytest.CaptureFixture[str],
) -> None:
    main(["--environment", "test", "--json", "--at", "2026-09-18T00:00:00+00:00"])
    document = json.loads(capsys.readouterr().out)
    assert document["grade"] == "unverified"
    assert document["generated_at"] == "2026-09-18T00:00:00+00:00"
    assert document["counts"]["pass"] == 0
    assert document["availability_declared"] == []


def test_cli_without_a_timestamp_marks_the_fact_instead_of_inventing_one(
    capsys: pytest.CaptureFixture[str],
) -> None:
    main(["--environment", "test", "--json"])
    document = json.loads(capsys.readouterr().out)
    assert document["generated_at"] == "not-supplied"


def test_no_trading_path_module_imports_the_matrix() -> None:
    """The boundary law, checked against the tree rather than asserted in prose.

    A chaos module that could be imported by placement or risk code is a chaos module that can be
    *depended on* by placement or risk code, which is the failure the injector docstring forbids.
    """

    offenders: list[str] = []
    for path in (CORE_ROOT / "wlct_trading").rglob("*.py"):
        if "observability" in path.parts:
            continue
        text = path.read_text(encoding="utf-8")
        if "chaos" in text:
            offenders.append(str(path.relative_to(CORE_ROOT)))
    assert offenders == []


def test_the_module_runs_as_a_real_subprocess_for_the_staging_harness() -> None:
    # The CLI is documented as the entry point a CI job would call; that claim is only worth what a
    # run of it is worth, so run it - in the same interpreter, from the same source, no fixtures.
    # Fixed argv, no shell, no interpolation: the point is to run the real entry point.
    completed = subprocess.run(
        [sys.executable, "-m", "wlct_trading.observability.chaos", "--environment", "ci", "--json"],
        cwd=CORE_ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    assert completed.returncode == 2, completed.stderr
    document = json.loads(completed.stdout)
    assert document["schema"] == "wlct.chaos.matrix/1"
    assert document["environment"] == "ci"
