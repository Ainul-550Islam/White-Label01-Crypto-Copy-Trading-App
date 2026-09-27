"""The exposition registry: semantics, cardinality cap, timing honesty, and
the Prometheus text format pinned to exact vectors.

Format vectors matter: two implementations (Python here, TypeScript in the
API) must render byte-identical output for identical inputs, and the only
way to hold that without running Prometheus is to pin exact expected text in
both test suites, generated from one source (see
``libs/trading-core/scripts/gen_observability_fixtures.py``).
"""

from __future__ import annotations

import re

import pytest

from wlct_trading.metrics import LatencyHistogram
from wlct_trading.observability.labels import CardinalityError
from wlct_trading.observability.metrics import (
    DEFAULT_MICROS_BUCKETS,
    PIPELINE_STAGES,
    ObservabilityRegistry,
    PipelineSpan,
    observe_latency_histogram,
    render_prometheus,
    sample_process,
)


def make_registry(max_series_per_family: int = 4_096) -> ObservabilityRegistry:
    return ObservabilityRegistry(
        service="test-svc", max_series_per_family=max_series_per_family
    )


def test_counter_is_monotonic_and_refuses_negative() -> None:
    registry = make_registry()
    registry.register_counter("wlct_risk_decisions_total", "Decisions evaluated.", "result")
    registry.inc("wlct_risk_decisions_total", {"result": "approved"}, 3)
    registry.inc("wlct_risk_decisions_total", {"result": "approved"})
    with pytest.raises(CardinalityError, match="never decrease"):
        registry.inc("wlct_risk_decisions_total", {"result": "approved"}, -1)

    snap = registry.snapshot()["wlct_risk_decisions_total"]["series"]
    assert snap == [{"labels": {"result": "approved"}, "value": 4.0}]


def test_unregistered_metric_is_a_programming_error() -> None:
    registry = make_registry()
    with pytest.raises(CardinalityError, match="not registered"):
        registry.inc("wlct_never_registered", {})


def test_duplicate_registration_refused() -> None:
    registry = make_registry()
    registry.register_counter("wlct_a_total", "one", "result")
    with pytest.raises(CardinalityError, match="registered twice"):
        registry.register_counter("wlct_a_total", "two", "result")


def test_gauge_moves_both_ways() -> None:
    registry = make_registry()
    registry.register_gauge("wlct_orders_open", "Open orders.", "exchange")
    registry.set_gauge("wlct_orders_open", {"exchange": "binance"}, 5)
    registry.add_to_gauge("wlct_orders_open", {"exchange": "binance"}, -2)
    series = registry.snapshot()["wlct_orders_open"]["series"]
    assert series[0]["value"] == 3.0


def test_histogram_bucket_semantics_and_negative_observation() -> None:
    registry = make_registry()
    registry.register_histogram(
        "wlct_risk_decision_micros",
        "Decision path duration.",
        ("result",),
        buckets=(100, 1_000),
    )
    registry.observe_micros("wlct_risk_decision_micros", {"result": "approved"}, 50)
    registry.observe_micros("wlct_risk_decision_micros", {"result": "approved"}, 900)
    registry.observe_micros("wlct_risk_decision_micros", {"result": "approved"}, 5_000)
    registry.observe_micros("wlct_risk_decision_micros", {"result": "approved"}, -7)

    text = render_prometheus(registry)
    # Buckets are cumulative at "<= le"; -7 falls in <=100 like 50 does;
    # 5_000 lands only in +Inf. Sum is real arithmetic, never clamped.
    assert 'wlct_risk_decision_micros_bucket{le="100",result="approved",service="test-svc"} 2' in text
    assert 'wlct_risk_decision_micros_bucket{le="1000",result="approved",service="test-svc"} 3' in text
    assert 'wlct_risk_decision_micros_bucket{le="+Inf",result="approved",service="test-svc"} 4' in text
    assert "wlct_risk_decision_micros_sum{result=\"approved\",service=\"test-svc\"} 5943" in text
    assert "wlct_risk_decision_micros_count{result=\"approved\",service=\"test-svc\"} 4" in text


def test_observe_on_non_histogram_family_is_rejected() -> None:
    registry = make_registry()
    registry.register_counter("wlct_c_total", "c", "result")
    with pytest.raises(CardinalityError, match="not a histogram"):
        registry.observe_micros("wlct_c_total", {"result": "ok"}, 5)


def test_series_cap_refuses_new_series_not_new_data() -> None:
    registry = make_registry(max_series_per_family=2)
    registry.register_counter("wlct_capped_total", "cap test", "symbol")
    registry.inc("wlct_capped_total", {"symbol": "BTCUSDT"})
    registry.inc("wlct_capped_total", {"symbol": "ETHUSDT"})
    registry.inc("wlct_capped_total", {"symbol": "SOLUSDT"})  # refused
    registry.inc("wlct_capped_total", {"symbol": "BTCUSDT"})  # existing still records

    snap = registry.snapshot()["wlct_capped_total"]["series"]
    assert len(snap) == 2
    assert snap[0]["value"] == 2.0
    assert registry.overflow_total == 1
    text = render_prometheus(registry)
    assert "wlct_registry_series_overflow_total{service=\"test-svc\"} 1" in text


def test_zero_cap_rejected() -> None:
    with pytest.raises(CardinalityError):
        ObservabilityRegistry(service="x", max_series_per_family=0)


def test_histogram_requires_strictly_increasing_buckets() -> None:
    registry = make_registry()
    with pytest.raises(CardinalityError, match="strictly increasing"):
        registry.register_histogram(
            "wlct_bad_buckets", "no", ("result",), buckets=(1_000, 100)
        )


def test_pipeline_span_uses_monotonic_stamps_and_no_fabricated_zeros() -> None:
    span = PipelineSpan()
    span.mark("market_event_received", at_nanos=1_000_000)
    span.mark("risk_finished", at_nanos=3_500_000)
    assert span.duration_micros("market_event_received", "risk_finished") == pytest.approx(2_500.0)
    # No stamp for fill_received: absence stays absence.
    assert span.duration_micros("risk_finished", "fill_received") is None


def test_pipeline_span_rejects_unknown_stage() -> None:
    span = PipelineSpan()
    with pytest.raises(CardinalityError, match="unknown pipeline stage"):
        span.mark("lunch_break")


def test_pipeline_span_first_mark_wins() -> None:
    span = PipelineSpan()
    span.mark("risk_started", at_nanos=10_000)
    span.mark("risk_started", at_nanos=9_000_000)
    span.mark("risk_finished", at_nanos=20_000)
    assert span.duration_micros("risk_started", "risk_finished") == pytest.approx(10.0)


def test_record_into_counts_completed_transitions_only() -> None:
    registry = make_registry()
    registry.register_histogram(
        "wlct_pipeline_transition_micros",
        "Pipeline transitions.",
        ("stage", "simulation", "exchange"),
        buckets=DEFAULT_MICROS_BUCKETS,
    )
    span = PipelineSpan()
    span.mark("market_event_received", at_nanos=1_000_000)
    span.mark("market_event_processed", at_nanos=2_000_000)
    recorded = span.record_into(registry, simulation="simulated", exchange="binance")
    # Only the one completed adjacent pair; the two aggregates need stamps
    # that do not exist.
    assert recorded == 1
    snap = registry.snapshot()["wlct_pipeline_transition_micros"]["series"]
    assert snap[0]["labels"] == {
        "stage": "market_event_received__market_event_processed",
        "simulation": "simulated",
        "exchange": "binance",
    }


def test_the_engines_observed_stages_are_declared_and_placement_review_is_live() -> None:
    """The vocabulary in :mod:`wlct_trading.metrics` and the call sites must not drift.

    Two directions, treated differently on purpose.

    * Every stage the engine records must be DECLARED. Unconditional, and it is
      the one that catches a real bug: an observed name that is not in
      ``EXECUTION_STAGES`` creates no histogram, so the sample is computed,
      thrown away, and the dashboards quietly under-report a stage nobody
      declared.
    * ``placement_review`` - the stage Part 16 added - must be both declared and
      recorded, with the call site located in the engine's own source rather
      than assumed from the constructor argument.

    What this test does NOT assert is that every declared name has a call site.
    Eight of the thirteen still do not, and that vocabulary came from Part 9. A
    rule that fails on somebody else's unfinished work gets one of two outcomes
    in practice: ignored, or satisfied by deleting the name - which destroys the
    only record that the measurement was ever intended. The number is pinned here
    instead, with a message that tells the next part to update this file and
    docs/PART16_PLACEMENT_REVIEW.md section 6 together, because the document
    quotes it and a document that quotes a stale measurement is the failure mode
    this repository keeps paying for.

    Part 18 moved that number from twelve to eight by timing the four spans the
    engine actually contains (``validation``, ``safety_gates``, ``risk``,
    ``total_submit``). The eight that remain are the ones the engine calls across
    a boundary - signing, network and the venue ack inside the trading adapter,
    ``first_fill`` and ``private_stream_delivery`` inside the stream,
    ``reconciliation_pass`` inside three separate service entry points, and
    ``persistence`` spread over six store writes - each recorded by the layer
    that owns it or not at all, which is the distinction this pin preserves.
    """
    import re
    from pathlib import Path as _Path

    from wlct_trading.metrics import EXECUTION_STAGES

    engine_src = (_Path(__file__).resolve().parents[1] / "wlct_trading" / "execution" / "engine.py").read_text(
        encoding="utf-8"
    )
    observed = set(re.findall(r'observe\w*\(\s*"([a-z_]+)"', engine_src))

    assert observed, "the engine records no stage at all - the vocabulary has no caller"
    undeclared = sorted(observed - set(EXECUTION_STAGES))
    assert undeclared == [], f"observed but not in EXECUTION_STAGES: {undeclared}"

    assert "placement_review" in EXECUTION_STAGES
    assert "placement_review" in observed, (
        "the review is timed in the engine; if that call moved file, update this test to look where it lives"
    )

    unrecorded = sorted(set(EXECUTION_STAGES) - observed)
    assert len(EXECUTION_STAGES) == 13, (
        f"the vocabulary changed size ({len(EXECUTION_STAGES)}); the doc and this test both quote 13"
    )
    assert len(unrecorded) == 8, (
        f"{len(unrecorded)} declared stages have no call site (was 12 before Part 18, "
        "8 after it instrumented the four spans the engine contains). A number BELOW 8 "
        "means somebody wired another stage: update docs/PART16_PLACEMENT_REVIEW.md "
        "sec. 6 and this pin together. A number ABOVE 8 means a call site was deleted "
        "while the vocabulary stayed - that is the regression, and it is why this "
        "count is asserted rather than reported."
    )
    # The four Part 18 stages are named individually, because "four more" would
    # pass with any four: the claim is that THESE spans are timed by THIS file.
    assert {"validation", "safety_gates", "risk", "total_submit"} <= observed


def test_stage_names_are_the_documented_observation_points() -> None:
    assert PIPELINE_STAGES == (
        "market_event_received",
        "market_event_processed",
        "strategy_started",
        "strategy_finished",
        "signal_generated",
        "risk_started",
        "risk_finished",
        "execution_started",
        "exchange_request_sent",
        "exchange_response_received",
        "fill_received",
    )


def test_render_output_line_shape_and_escaping() -> None:
    registry = make_registry()
    registry.register_counter("wlct_events_total", 'help with "quotes"\nand newline', "result")
    registry.inc("wlct_events_total", {"result": "ok"})
    text = render_prometheus(registry)
    # HELP text escapes backslashes and newlines (a real newline must not
    # split the line); double quotes are legal inside HELP per the format.
    assert '# HELP wlct_events_total help with "quotes"\\nand newline' in text
    assert re.search(r"^wlct_events_total\{result=\"ok\",service=\"test-svc\"\} 1$", text, re.M)
    for line in text.splitlines():
        assert line == line.rstrip(), "no trailing whitespace in exposition"
    assert text.endswith("\n")


def test_render_is_deterministic_sorted() -> None:
    registry = make_registry()
    registry.register_counter("wlct_m_total", "m", "result")
    for result in ("rejected", "approved", "stale"):
        registry.inc("wlct_m_total", {"result": result})
    first = render_prometheus(registry)
    second = render_prometheus(registry)
    assert first == second
    rows = [
        line for line in first.splitlines() if line.startswith("wlct_m_total{")
    ]
    assert rows == sorted(rows)


def test_render_float_formatting() -> None:
    registry = make_registry()
    registry.register_gauge("wlct_ratio", "ratio", "result")
    registry.set_gauge("wlct_ratio", {"result": "a"}, 1.5)
    registry.set_gauge("wlct_ratio", {"result": "b"}, float("nan"))
    text = render_prometheus(registry)
    assert 'wlct_ratio{result="a",service="test-svc"} 1.5' in text
    assert 'wlct_ratio{result="b",service="test-svc"} NaN' in text


def test_empty_families_are_omitted() -> None:
    registry = make_registry()
    registry.register_counter("wlct_never_used_total", "no series yet", "result")
    text = render_prometheus(registry)
    assert "wlct_never_used_total" not in text
    # ...but the registry still counts it in its snapshot for the dashboard.
    assert "wlct_never_used_total" in registry.snapshot()


def test_adapter_folds_internal_histogram_and_refuses_mismatched_edges() -> None:
    source = LatencyHistogram(bounds=(100, 1_000))
    source.observe(50)
    source.observe(700)
    source.observe(9_000)

    registry = make_registry()
    registry.register_histogram(
        "wlct_market_feed_lag_micros",
        "Feed lag.",
        ("result",),
        buckets=(100, 1_000),
    )
    ok = observe_latency_histogram(
        registry, "wlct_market_feed_lag_micros", {"result": "ok"}, source
    )
    assert ok is True
    series = registry.snapshot()["wlct_market_feed_lag_micros"]["series"][0]
    assert series["count"] == 3
    # PER-bucket, not cumulative: the third sample (9_000) is overflow, so both
    # declared buckets hold one observation each and the running total is the
    # renderer's job. This assertion read {"100": 1, "1000": 2} for nine parts
    # because the adapter was accumulating here AND the renderer was accumulating
    # again on the way out - the text was wrong and the state looked right. The
    # lines below are the part of this test that would have caught it.
    assert series["buckets"] == {"100": 1, "1000": 1}

    rendered = render_prometheus(registry)
    lines = {
        line.split(" ")[0]: line.split(" ")[1]
        for line in rendered.splitlines()
        if line.startswith("wlct_market_feed_lag_micros_bucket")
    }
    prefix = "wlct_market_feed_lag_micros_bucket{"
    tail = ',result="ok",service="test-svc"}'
    assert lines[prefix + 'le="100"' + tail] == "1", lines
    assert lines[prefix + 'le="1000"' + tail] == "2", lines
    # +Inf is the source's TOTAL (3), which is the sentence the whole fix is
    # about: one sample overflowed both buckets, and before the correction the
    # renderer's cumulative pass turned "1 then 1" into "1 then 3".
    assert lines[prefix + 'le="+Inf"' + tail] == "3", lines

    mismatched = make_registry()
    mismatched.register_histogram(
        "wlct_market_feed_lag_micros", "Feed lag.", ("result",), buckets=(100,)
    )
    with pytest.raises(CardinalityError, match="must match the source histogram"):
        observe_latency_histogram(
            mismatched, "wlct_market_feed_lag_micros", {"result": "ok"}, source
        )

    class Junk:
        pass

    with pytest.raises(TypeError, match="snapshot_buckets"):
        observe_latency_histogram(registry, "wlct_market_feed_lag_micros", {"result": "ok"}, Junk())


def test_sample_process_populates_conservative_series() -> None:
    import time

    registry = make_registry()
    for gauge in (
        "wlct_process_uptime_seconds",
        "wlct_process_memory_rss_bytes",
        "wlct_process_cpu_seconds_total",
        "wlct_process_open_file_descriptors",
        "wlct_process_file_descriptor_limit",
    ):
        registry.register_gauge(gauge, "process", "service")
    sample_process(registry, started_at_mono=time.monotonic() - 5.0)
    snap = registry.snapshot()
    uptime = snap["wlct_process_uptime_seconds"]["series"][0]["value"]
    assert uptime >= 5.0
    assert snap["wlct_process_memory_rss_bytes"]["series"][0]["value"] > 0
