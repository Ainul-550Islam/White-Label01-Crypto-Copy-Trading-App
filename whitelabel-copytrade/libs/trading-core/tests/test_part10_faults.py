"""Part 10 failure injection: a closed set of points, armed by config only.

The design contract these tests pin: the injector has NO enable method at
runtime (there is nothing for a compromised process or a panicked operator to
reach for), the universe of fault points is closed and verified to exclude
anything that could touch trading decisions, and consumption is deterministic
one-shot accounting - not randomness, not timers, not threads.
"""

from __future__ import annotations

import dataclasses
import re

import pytest

from wlct_trading.observability import (
    FAULT_POINTS,
    FailureInjector,
    FaultSpec,
    disabled_injector,
)


class TestClosedUniverse:
    def test_exact_set(self) -> None:
        assert FAULT_POINTS == frozenset(
            {
                "metrics_export_unavailable",
                "trace_export_unavailable",
                "redis_health_probe_unavailable",
                "postgres_health_probe_unavailable",
                "queue_observed_delay",
                "queue_observed_failure",
                "market_data_stale_simulated",
                "risk_snapshot_stale_simulated",
                "reconciliation_delay_simulated",
                "alert_persistence_failure",
            }
        )

    def test_no_point_names_a_trading_decision_boundary(self) -> None:
        # The deliberate red line: injection may darken observability and
        # simulate freshness/failure CONDITIONS, but no point is named like a
        # lever on orders, execution, or risk authorisation.
        forbidden = re.compile(
            r"order|execution|credential|kill|reserve|cancel|submit",
            re.IGNORECASE,
        )
        offenders = {name for name in FAULT_POINTS if forbidden.search(name)}
        assert offenders == set()
        # "risk_snapshot_stale_simulated" is allowed and is a FRESHNESS
        # condition the gate already enforces - it cannot make a bad order
        # look good; it makes good orders be refused, which is fail-closed.
        assert "risk_snapshot_stale_simulated" in FAULT_POINTS

    def test_unknown_points_are_refused_at_construction(self) -> None:
        with pytest.raises(ValueError, match="universe is closed"):
            FailureInjector(
                _enabled=True,
                _specs={"engage_kill_switch": FaultSpec()},
            )

    def test_specs_are_frozen_copies(self) -> None:
        specs = {"trace_export_unavailable": FaultSpec(times=2)}
        injector = FailureInjector(_enabled=True, _specs=specs)
        specs["trace_export_unavailable"] = FaultSpec(times=99)
        assert injector.is_armed("trace_export_unavailable") is True
        injector.consume("trace_export_unavailable")
        assert injector.consume("trace_export_unavailable") is True
        assert injector.consume("trace_export_unavailable") is False
        with pytest.raises(TypeError):
            injector._specs["queue_observed_failure"] = FaultSpec()


class TestArming:
    def test_disabled_by_default_everything_answers_neutral(self) -> None:
        injector = disabled_injector()
        assert injector.enabled is False
        assert injector.active_points() == ()
        assert injector.consume("trace_export_unavailable") is False
        assert injector.observed_delay_ms("queue_observed_delay") == 0
        assert injector.describe() == {
            "enabled": False,
            "active_points": [],
            "fired_totals": {},
        }

    def test_from_settings_selective(self) -> None:
        injector = FailureInjector.from_settings(
            enabled=True,
            specs={
                "metrics_export_unavailable": FaultSpec(),
                "alert_persistence_failure": FaultSpec(enabled=False),
            },
        )
        assert injector.active_points() == ("metrics_export_unavailable",)
        assert injector.is_armed("alert_persistence_failure") is False

    def test_unknown_consume_is_false_not_exception(self) -> None:
        injector = FailureInjector.from_settings(enabled=True, specs={})
        assert injector.consume("no_such_point") is False
        assert injector.is_armed("no_such_point") is False

    def test_one_shot_and_persistent(self) -> None:
        injector = FailureInjector.from_settings(
            enabled=True,
            specs={
                "queue_observed_failure": FaultSpec(times=1),
                "trace_export_unavailable": FaultSpec(times=-1),
            },
        )
        assert injector.consume("queue_observed_failure") is True
        assert injector.consume("queue_observed_failure") is False
        for _ in range(5):
            assert injector.consume("trace_export_unavailable") is True
        assert injector.describe()["fired_totals"] == {
            "queue_observed_failure": 1,
            "trace_export_unavailable": 5,
        }

    def test_disable_neutralizes_live_specs(self) -> None:
        injector = FailureInjector(
            _enabled=True, _specs={"queue_observed_delay": FaultSpec(delay_ms=250)}
        )
        assert injector.observed_delay_ms("queue_observed_delay") == 250
        disabled = FailureInjector(
            _enabled=False, _specs={"queue_observed_delay": FaultSpec(delay_ms=250)}
        )
        assert disabled.is_armed("queue_observed_delay") is False
        assert disabled.observed_delay_ms("queue_observed_delay") == 0

    def test_delay_counts_only_while_armed(self) -> None:
        injector = FailureInjector(
            _enabled=True,
            _specs={"queue_observed_delay": FaultSpec(times=1, delay_ms=500)},
        )
        assert injector.observed_delay_ms("queue_observed_delay") == 500
        assert injector.consume("queue_observed_delay") is True
        assert injector.observed_delay_ms("queue_observed_delay") == 0


class TestSpecValidation:
    @pytest.mark.parametrize(
        "kwargs",
        [
            {"times": -2},
            {"delay_ms": -1},
            {"delay_ms": 600_001},
        ],
    )
    def test_bad_specs_rejected(self, kwargs: dict[str, int]) -> None:
        with pytest.raises(ValueError):
            FaultSpec(**kwargs)  # type: ignore[arg-type]

    def test_explicit_zero_times_is_allowed_but_never_arms(self) -> None:
        spec = FaultSpec(times=0)
        injector = FailureInjector(
            _enabled=True, _specs={"queue_observed_failure": spec}
        )
        assert injector.is_armed("queue_observed_failure") is False
        assert injector.consume("queue_observed_failure") is False
        assert injector.active_points() == ("queue_observed_failure",)


class TestNoRuntimeLevers:
    def test_no_enable_disable_or_mutation_api(self) -> None:
        injector = disabled_injector()
        for name in ("enable", "disable", "activate", "arm", "disarm", "reset"):
            assert not hasattr(injector, name), name
        # The only mutator is consume(), and it can only burn shots down.
        methods = {
            field.name
            for field in dataclasses.fields(FailureInjector)
        }
        assert methods == {"_enabled", "_specs", "_fired"}

    def test_injector_never_imports_time_or_sleeps(self) -> None:
        import ast
        import inspect

        import wlct_trading.observability.faults as faults_module

        # AST-scoped so the docstring sentence that DENIES sleeping cannot
        # trip the scan it documents.
        tree = ast.parse(inspect.getsource(faults_module))
        imported: set[str] = set()
        called: set[str] = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                imported.update(alias.name.split(".")[0] for alias in node.names)
            elif isinstance(node, ast.ImportFrom) and node.module and node.level == 0:
                imported.add(node.module.split(".")[0])
            elif isinstance(node, ast.Call):
                if isinstance(node.func, ast.Attribute):
                    called.add(node.func.attr)
                elif isinstance(node.func, ast.Name):
                    called.add(node.func.id)
        assert not imported & {"time", "threading", "asyncio", "datetime", "random"}
        assert "sleep" not in called
