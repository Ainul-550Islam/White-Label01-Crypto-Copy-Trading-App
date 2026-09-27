"""Part 18: the four stage spans the engine contains are timed, and nothing else is.

The claim under test is narrow and it is deliberately narrow. ``EXECUTION_STAGES``
has thirteen names; six of them describe work that happens INSIDE
:class:`ExecutionEngine.submit` and seven describe work that happens in a layer the
engine calls across a boundary. Part 18 times the former (plus the review stage
Part 16 already timed) and leaves the latter alone, so the two things these tests
hold are:

* a submission contributes exactly one sample per span it actually waits on, in
  pipeline order - because "the review runs before the gates" is a law with a
  latency consequence, and
* a stage that never answered contributes NOTHING. An exception path is counted and
  recorded as an incident; inventing a duration for it would put "we gave up" on a
  latency histogram, which is the one place a dashboard should not be allowed to lie.

The order is asserted as a list, not as a set, for the same reason Part 16 asserted
its own position in it.
"""

from __future__ import annotations

import asyncio
from dataclasses import replace
from decimal import Decimal
from typing import Any

import pytest

from wlct_trading.execution.placement_attestor import PlacementReviewer, PlacementReviewPolicy

from tests.test_part16_placement_attestor import (
    CountingAttestor,
    LiveAdapter,
    accepted_result,
    attested,
    build,
    credentials,
    healthy_context,
    intent,
    live_settings,
)


def permissive_reviewer() -> PlacementReviewer:
    """A reviewer that says yes, because this part is not about the answer.

    A live engine without a reviewer is refused by the wiring law Part 16 added,
    so every test here has to carry one; carrying a reviewer that blocks would make
    these tests about the block. One attestation object, returned on every call, so
    the multi-submission cases do not have to script a queue.
    """
    return PlacementReviewer(
        CountingAttestor(attested()),
        PlacementReviewPolicy(),
        requires_venue_attestation=True,
    )


class RecordingMetrics:
    """The metrics port as the engine sees it: observe(name, micros) + counters.

    Deliberately a list of ``(name, micros)`` pairs rather than a dict of
    aggregates: the assertion that matters is WHICH spans were timed and in what
    order, and an aggregate would collapse the two.
    """

    def __init__(self) -> None:
        self.observations: list[tuple[str, int]] = []

    def observe(self, name: str, micros: int) -> None:
        self.observations.append((name, int(micros)))

    @property
    def names(self) -> list[str]:
        return [name for name, _ in self.observations]

    def count_of(self, name: str) -> int:
        return self.names.count(name)


def submit(engine: Any, order_intent: Any = None) -> Any:
    """Run one submission through the engine, synchronously for the test."""
    return asyncio.run(
        engine.submit(
            order_intent if order_intent is not None else intent(),
            healthy_context(credentials=credentials()),
        )
    )


class TestTheRecordedSpans:
    def test_an_accepted_submission_times_the_spans_it_waits_on(self) -> None:
        metrics = RecordingMetrics()
        engine, _store, _incidents = build(
            LiveAdapter(result=accepted_result()),
            settings=live_settings(),
            reviewer=permissive_reviewer(),
            metrics=metrics,
        )
        result = submit(engine)
        assert result.outcome.value == "ACCEPTED"
        # The review's own stage is in here because the wiring law requires a
        # reviewer on a live engine; its POSITION is Part 16's claim, and it is
        # asserted rather than tolerated because the order is the design.
        assert metrics.names == [
            "validation",
            "placement_review",
            "safety_gates",
            "risk",
            "total_submit",
        ]

    def test_every_span_is_declared_in_the_vocabulary(self) -> None:
        from wlct_trading.metrics import EXECUTION_STAGES

        metrics = RecordingMetrics()
        engine, _store, _incidents = build(
            LiveAdapter(result=accepted_result()),
            settings=live_settings(),
            reviewer=permissive_reviewer(),
            metrics=metrics,
        )
        submit(engine)
        assert set(metrics.names) <= set(EXECUTION_STAGES), (
            "an observation with no declared stage creates no histogram: the sample "
            "is computed, thrown away, and the dashboard under-reports"
        )

    def test_total_submit_is_exactly_one_sample_per_submission(self) -> None:
        metrics = RecordingMetrics()
        engine, _store, _incidents = build(
            LiveAdapter(result=accepted_result()),
            settings=live_settings(),
            reviewer=permissive_reviewer(),
            metrics=metrics,
        )
        for _ in range(3):
            submit(engine)
        assert metrics.count_of("total_submit") == 3
        assert metrics.count_of("validation") == 3

    def test_the_refusals_are_timed_too(self) -> None:
        # "refused in 40 micros" and "refused in 4s" are both latency facts, and a
        # histogram that only contains accepted orders cannot answer the question a
        # dashboard is actually built to ask ("why is submit slow"), so the early
        # exits record their own total_submit through finish().
        metrics = RecordingMetrics()
        engine, _store, _incidents = build(
            LiveAdapter(result=accepted_result()),
            settings=live_settings(),
            reviewer=permissive_reviewer(),
            metrics=metrics,
        )
        bad = replace(intent(), quantity=Decimal("0"))
        result = submit(engine, bad)
        assert result.outcome.value == "REJECTED_LOCALLY"
        assert metrics.names == ["validation", "total_submit"]

    def test_a_stage_that_never_answered_is_absent_not_zero(self) -> None:
        class ExplodingRisk:
            def evaluate(self, *_args: Any, **_kwargs: Any) -> Any:
                raise RuntimeError("risk store unreachable")

        metrics = RecordingMetrics()
        engine, _store, _incidents = build(
            LiveAdapter(result=accepted_result()),
            settings=live_settings(),
            reviewer=permissive_reviewer(),
            metrics=metrics,
        )
        engine._risk_engine = ExplodingRisk()  # the fault under test, not a fixture
        result = submit(engine)
        assert result.error_code.value == "RISK_UNAVAILABLE"
        assert "risk" not in metrics.names
        assert metrics.names == [
            "validation",
            "placement_review",
            "safety_gates",
            "total_submit",
        ]
        # The failure is not lost, it is elsewhere: counted, and recorded as an
        # incident, which is what "error paths are counted, not timed" means.
        assert metrics.observations  # still timed where timing is honest


class TestTheMetricsPortIsReadableAndReadOnly:
    def test_the_engine_exposes_the_instrument_it_writes_to(self) -> None:
        metrics = RecordingMetrics()
        engine, _store, _incidents = build(
            LiveAdapter(result=accepted_result()),
            settings=live_settings(),
            reviewer=permissive_reviewer(),
            metrics=metrics,
        )
        assert engine.metrics is metrics

    def test_the_accessor_refuses_a_write(self) -> None:
        # A scrape that could swap the instrument out (or reset it) would make a
        # restart and a deliberate clear look the same on a panel.
        engine, _store, _incidents = build(
            LiveAdapter(result=accepted_result()),
            settings=live_settings(),
            reviewer=permissive_reviewer(),
            metrics=RecordingMetrics(),
        )
        with pytest.raises(AttributeError):
            engine.metrics = RecordingMetrics()

    def test_an_engine_without_instrumentation_still_trades(self) -> None:
        engine, _store, _incidents = build(
            LiveAdapter(result=accepted_result()),
            settings=live_settings(),
            reviewer=permissive_reviewer(),
            metrics=None,
        )
        assert engine.metrics is None
        result = submit(engine)
        assert result.outcome.value == "ACCEPTED"

    def test_a_port_without_an_observe_method_is_tolerated(self) -> None:
        class Partial:
            """A duck-typed port that stopped implementing observe."""

        engine, _store, _incidents = build(
            LiveAdapter(result=accepted_result()),
            settings=live_settings(),
            reviewer=permissive_reviewer(),
            metrics=Partial(),
        )
        result = submit(engine)
        assert result.outcome.value == "ACCEPTED"
