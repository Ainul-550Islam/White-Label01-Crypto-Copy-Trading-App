"""Tests for the RED view (Part 21): four states, no invented thresholds, no new metric system.

The properties that matter here are the ones a dashboard cannot show later: that "nobody registered
it" and "nothing happened" are different rows, that a verdict requires a budget someone else owns,
and that the numbers come from the platform's own registry rather than a parallel one.
"""

from __future__ import annotations

import json
from typing import Any, cast

import pytest

from wlct_trading.observability.dashboard import DashboardRow
from wlct_trading.observability.metrics import ObservabilityRegistry, render_prometheus
from wlct_trading.observability.red import (
    RED_STATES,
    RED_TONES,
    RedBudget,
    RedSurface,
    red_document,
    red_observations,
    red_rows,
    validate_surfaces,
)

ENGINE_RISK = RedSurface(
    surface_id="engine_risk_decision",
    title="Pre-trade risk evaluation",
    request_family="wlct_risk_decisions_total",
    error_values=frozenset({"blocked", "refused", "error"}),
    duration_family="wlct_risk_decision_micros",
)


def _snapshot(requests: dict[str, float], durations: dict[str, int] | None = None) -> dict[str, Any]:
    families: dict[str, Any] = {
        "wlct_risk_decisions_total": {
            "type": "counter",
            "series": [{"labels": {"result": result}, "value": value} for result, value in requests.items()],
        }
    }
    if durations is not None:
        families["wlct_risk_decision_micros"] = {
            "type": "histogram",
            "series": [
                {"labels": {"result": result}, "count": count, "sumMicros": count * 1_000, "buckets": {}}
                for result, count in durations.items()
            ],
        }
    return families


def test_the_state_vocabulary_is_closed_and_tones_are_the_dashboards_own() -> None:
    assert RED_STATES == ("no-data", "zero-traffic", "measured", "healthy", "over-budget")
    snapshot: dict[str, Any] = {}
    for state, fams in (
        ("no-data", snapshot),
        ("zero-traffic", _snapshot({"allowed": 0.0})),
        ("measured", _snapshot({"allowed": 9.0, "blocked": 1.0})),
    ):
        (observation,) = red_observations(fams, surfaces=[ENGINE_RISK])
        assert observation.state == state
    for row in red_rows(red_observations(_snapshot({"allowed": 1.0}), surfaces=[ENGINE_RISK])):
        assert row.tone in RED_TONES


def test_no_data_is_not_zero_traffic_and_neither_is_green() -> None:
    empty = red_observations({}, surfaces=[ENGINE_RISK])[0]
    idle = red_observations(_snapshot({"allowed": 0.0}), surfaces=[ENGINE_RISK])[0]
    assert (empty.state, idle.state) == ("no-data", "zero-traffic")
    assert empty.reason.startswith("wlct_risk_decisions_total is not registered")
    assert idle.requests == 0.0
    # Tones: a missing family is a warning, idleness is neutral, and neither is "ok".
    tones = [row.tone for row in red_rows([empty, idle])]
    assert "warn" in tones and "ok" not in tones


def test_a_verdict_requires_a_budget_and_the_budget_requires_a_source() -> None:
    measured = red_observations(_snapshot({"allowed": 90.0, "blocked": 10.0}), surfaces=[ENGINE_RISK])[0]
    assert measured.state == "measured"
    assert measured.error_ratio == pytest.approx(0.1)
    assert "no budget supplied" in measured.reason
    assert measured.budget_source is None

    judged = red_observations(
        _snapshot({"allowed": 90.0, "blocked": 10.0}),
        surfaces=[ENGINE_RISK],
        budgets={"engine_risk_decision": RedBudget(max_error_ratio=0.05, source="docs/ALERTING.md slo: availability")},
    )[0]
    assert judged.state == "over-budget"
    assert "0.1000 exceeds 0.0500" in judged.reason
    source = judged.budget_source
    assert source is not None and source.startswith("docs/ALERTING.md")

    with pytest.raises(ValueError, match="name its source"):
        RedBudget(max_error_ratio=0.05)
    with pytest.raises(ValueError, match="within 0..1"):
        RedBudget(max_error_ratio=5.0, source="x")


def test_error_values_cannot_be_guessed_and_families_must_be_registered_ones() -> None:
    # Four refusals, four explicit constructor calls. A dict of overrides typed loosely
    # enough to hold all four would have made this test about `dict.get` and its
    # defaults rather than about what `RedSurface` rejects, and it does not type-check:
    # the values come back as a union of everything the dict could hold.
    with pytest.raises(ValueError):
        RedSurface(surface_id="s", title="t", request_family="wlct_x_total", error_values=frozenset())
    with pytest.raises(ValueError):
        RedSurface(surface_id="s", title="t", request_family="wlct_x_total", error_values=frozenset({""}))
    with pytest.raises(ValueError):
        RedSurface(surface_id="s", title="t", request_family="http_requests_total", error_values=frozenset({"error"}))
    with pytest.raises(ValueError):
        RedSurface(
            surface_id="s",
            title="t",
            request_family="wlct_x_total",
            error_values=frozenset({"error"}),
            duration_family="latency",
        )
    with pytest.raises(ValueError, match="distinct from the request family"):
        RedSurface(
            surface_id="s",
            title="t",
            request_family="wlct_x_total",
            error_values=frozenset({"error"}),
            duration_family="wlct_x_total",
        )
    with pytest.raises(ValueError, match="non-empty frozenset"):
        RedSurface(surface_id="s", title="t", request_family="wlct_x_total", error_values=frozenset())


def test_two_surfaces_over_one_family_are_refused() -> None:
    twin = RedSurface(
        surface_id="engine_risk_twin",
        title="Same family again",
        request_family=ENGINE_RISK.request_family,
        error_values=ENGINE_RISK.error_values,
    )
    assert validate_surfaces([ENGINE_RISK]) == ()
    problems = validate_surfaces([ENGINE_RISK, twin])
    assert len(problems) == 1 and "re-declares" in problems[0]


def test_the_view_reads_a_real_registry_not_a_private_copy_of_one() -> None:
    """The reuse law, checked against the exposition path itself.

    A RED implementation that passed against a hand-written dict but could not read what
    ``ObservabilityRegistry.snapshot()`` actually produces would be a parallel metrics system with
    the names of the real one. So: register the engine's real families, drive them through the real
    API, and read the result.
    """

    registry = ObservabilityRegistry(service="execution-engine")
    registry.register_counter("wlct_risk_decisions_total", "Pre-trade decisions.", "result")
    registry.register_histogram(
        "wlct_risk_decision_micros",
        "Pre-trade evaluation duration.",
        ("result",),
        buckets=(100, 1_000, 10_000, 100_000, 1_000_000),
    )
    for _ in range(4):
        registry.inc("wlct_risk_decisions_total", {"result": "allowed"})
    registry.inc("wlct_risk_decisions_total", {"result": "blocked"})
    registry.observe_micros("wlct_risk_decision_micros", {"result": "allowed"}, 800)
    registry.observe_micros("wlct_risk_decision_micros", {"result": "blocked"}, 40_000)

    snapshot = registry.snapshot()
    (before_budget,) = red_observations(snapshot, surfaces=[ENGINE_RISK])
    assert before_budget.state == "measured"
    assert before_budget.requests == 5.0
    assert before_budget.errors == 1.0
    assert before_budget.error_ratio == pytest.approx(0.2)
    assert before_budget.duration_count == 2

    judged = red_observations(
        snapshot,
        surfaces=[ENGINE_RISK],
        budgets={"engine_risk_decision": RedBudget(max_error_ratio=0.5, max_p99_micros=1e9, source="test")},
    )[0]
    assert judged.state == "healthy"

    # The same families are on the exposition path, which is the only place the numbers come from.
    exposition = render_prometheus(registry)
    assert "wlct_risk_decisions_total" in exposition
    assert "wlct_risk_decision_micros" in exposition


def test_an_empty_registry_reads_as_no_data_rather_than_a_healthy_zero() -> None:
    registry = ObservabilityRegistry(service="execution-engine")
    observations = red_observations(registry.snapshot(), surfaces=[ENGINE_RISK])
    assert observations[0].state == "no-data"
    assert red_document(registry.snapshot(), surfaces=[ENGINE_RISK])["state"] == "no-data"


def test_identifying_labels_never_reach_a_row() -> None:
    """The cardinality law, asserted on the output rather than promised in a docstring."""

    snapshot = {
        "wlct_risk_decisions_total": {
            "type": "counter",
            "series": [
                {"labels": {"result": "allowed", "tenant_id": "t-9999", "order_id": "o-1", "symbol": "BTCUSDT"}, "value": 7.0},
                {"labels": {"result": "blocked", "account_id": "a-1"}, "value": 1.0},
            ],
        }
    }
    document = json.loads(json.dumps(red_document(snapshot, surfaces=[ENGINE_RISK])))
    for forbidden in ("t-9999", "o-1", "BTCUSDT", "a-1", "tenant_id", "account_id", "symbol"):
        assert forbidden not in document, f"a RED row carried {forbidden}"
    assert document["counts"]["measured"] == 1


def test_the_document_carries_its_own_reading_and_only_known_states() -> None:
    document = red_document(_snapshot({"allowed": 3.0, "blocked": 1.0}, durations={"allowed": 3, "blocked": 1}), surfaces=[ENGINE_RISK])
    assert document["schema"] == "wlct.observability.red/1"
    reading = document["reading"]
    surfaces = document["surfaces"]
    counts = document["counts"]
    rows = document["rows"]
    # Narrowing by assertion, not by annotation: the document is typed
    # `Mapping[str, object]` because that is what a JSON document is, and an assertion
    # that reads a level of it has to say which level it means.
    assert isinstance(reading, str) and "no-data = not registered" in reading
    assert isinstance(surfaces, list) and surfaces == ["engine_risk_decision"]
    assert isinstance(counts, dict) and set(counts) == set(RED_STATES)
    assert isinstance(rows, list) and len(rows) == 3  # one rate / errors / duration triple
    assert all(isinstance(row, dict) for row in rows)
    entries = cast("list[dict[str, object]]", rows)
    assert {str(row["tone"]) for row in entries} <= set(RED_TONES)
    assert all(isinstance(row["label"], str) and isinstance(row["value"], str) for row in entries)
    for row in entries:
        assert str(row["label"]).startswith("engine_risk_decision ")


def test_rows_are_dashboard_rows_so_no_second_render_format_is_introduced() -> None:
    rows = red_rows(red_observations(_snapshot({"allowed": 1.0}), surfaces=[ENGINE_RISK]))
    assert rows and all(isinstance(row, DashboardRow) for row in rows)
    assert [row.label for row in rows] == [
        "engine_risk_decision rate",
        "engine_risk_decision errors",
        "engine_risk_decision duration",
    ]
    # A histogram mean is labelled as a mean: claiming a percentile from buckets this view does not
    # read would be the one lie a duration row could tell.
    detail = rows[2].detail
    assert detail is not None and "percentile" in detail


def test_budgets_for_an_absent_surface_are_refused() -> None:
    with pytest.raises(ValueError, match="not in play"):
        red_observations({}, surfaces=[ENGINE_RISK], budgets={"someone_elses_surface": RedBudget(max_error_ratio=0.1, source="x")})


def test_the_module_imports_no_clock_no_network_and_no_registry_write() -> None:
    from pathlib import Path

    source = (Path(__file__).resolve().parents[1] / "wlct_trading" / "observability" / "red.py").read_text(encoding="utf-8")
    for forbidden in ("import time", "import datetime", "asyncio", "threading", "socket", "httpx", ".inc(", ".observe_", ".set_gauge"):
        assert forbidden not in source, f"red.py must not {forbidden}"
    assert "snapshot" in source
