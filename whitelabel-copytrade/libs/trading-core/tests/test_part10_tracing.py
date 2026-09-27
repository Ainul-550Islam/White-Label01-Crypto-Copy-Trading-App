"""Part 10 tracing primitives: context, sampling, spans, OTLP/JSON, glue.

Three contracts run through every test here:

* the W3C surface is strict - a malformed header never joins a trace;
* sampling is deterministic integer arithmetic - the TS twin must reproduce
  the same answers from the same inputs (fixture-pinned in
  ``docs/fixtures/reliability_fixtures.json``);
* the tracer only observes - recording a decision, mutating it never
  (``TestDecisionEquivalence`` below is the load-bearing proof of that).
"""

from __future__ import annotations

import json

import pytest

from test_risk_gate import (  # deliberate reuse of the Part 8 harness
    BASELINE,
    NOW,
    config_with,
    intent,
    state_from,
)
from wlct_trading.enums import TradingMode
from wlct_trading.observability import (
    SamplingMode,
    SamplingPolicy,
    Span,
    TraceContext,
    Tracer,
    TRACED_OPERATIONS,
    current_span_context,
    format_traceparent,
    format_tracestate,
    new_span_id,
    new_trace_id,
    otlp_json_encode,
    parse_traceparent,
    parse_tracestate,
    use_span,
)
from wlct_trading.observability.tracing import SpanKind, SpanStatus
from wlct_trading.risk.events import InMemoryRiskEventSink
from wlct_trading.risk.freshness import FreshnessBudget
from wlct_trading.risk.protections import KillSwitchLedger
from wlct_trading.risk import RiskGate

VALID_TID = "0af7651916cd43dd8448eb211c80319c"
VALID_SID = "b7ad6b7169203331"


def _tracer(
    mode: SamplingMode = SamplingMode.ALL,
    *,
    ratio: float = 0.0,
    priority: tuple[str, ...] = (),
    buffer_size: int = 8192,
) -> Tracer:
    counter = iter(range(1, 1_000_000))

    def span_id() -> str:
        return f"{next(counter):016x}"

    return Tracer(
        service="unit-test",
        environment="test",
        version="0.0.0",
        instance="node-1",
        sampler=SamplingPolicy(mode, ratio=ratio, priority_operations=priority),
        buffer_size=buffer_size,
        trace_id_factory=lambda: VALID_TID,
        span_id_factory=span_id,
    )


class TestTraceparent:
    def test_valid_sampled_round_trip(self) -> None:
        context = parse_traceparent(f"00-{VALID_TID}-{VALID_SID}-01")
        assert context is not None
        assert context.trace_id == VALID_TID
        assert context.span_id == VALID_SID
        assert context.sampled is True
        assert format_traceparent(context) == f"00-{VALID_TID}-{VALID_SID}-01"

    def test_unsampled_flag_propagates(self) -> None:
        context = parse_traceparent(f"00-{VALID_TID}-{VALID_SID}-00")
        assert context is not None
        assert context.sampled is False
        assert format_traceparent(context).endswith("-00")

    @pytest.mark.parametrize(
        "header",
        [
            None,
            "",
            "garbage",
            "00-nothex-nothex-01",
            f"00-{VALID_TID.upper()}-{VALID_SID}-01",  # uppercase: rejected
            f"00-{'0' * 32}-{VALID_SID}-01",  # all-zero trace id: invalid
            f"00-{VALID_TID}-{'0' * 16}-01",  # all-zero span id: invalid
            "01-" + VALID_TID + "-" + VALID_SID + "-01",  # only v00 exists here
            "ff-" + VALID_TID + "-" + VALID_SID + "-ff",  # ff is never valid
            f"00-{VALID_TID}-01",  # missing field
            f"00-{VALID_TID}-{VALID_SID}",  # missing flags
        ],
    )
    def test_malformed_is_none_never_partial(self, header: str | None) -> None:
        assert parse_traceparent(header) is None

    def test_future_version_extra_field_truncated_to_four(self) -> None:
        header = f"00-{VALID_TID}-{VALID_SID}-01-future-field"
        context = parse_traceparent(header)
        assert context is not None
        assert context.trace_id == VALID_TID

    def test_three_fields_rejected_even_if_rest_would_match(self) -> None:
        assert parse_traceparent(f"00-{VALID_TID}-{VALID_SID}") is None

    def test_child_keeps_trace_and_marks_parentage(self) -> None:
        parent = parse_traceparent(f"00-{VALID_TID}-{VALID_SID}-01")
        assert parent is not None
        child = parent.child("0102030405060708", sampled=True)
        assert child.trace_id == VALID_TID
        assert child.parent_span_id == VALID_SID
        assert child.span_id == "0102030405060708"
        assert child.sampled is True
        demoted = parent.child("0102030405060709", sampled=False)
        assert demoted.sampled is False

    def test_generated_ids_are_valid_and_distinct(self) -> None:
        traces = {new_trace_id() for _ in range(8)}
        spans = {new_span_id() for _ in range(8)}
        assert len(traces) == 8 and len(spans) == 8
        for tid in traces:
            assert parse_traceparent(f"00-{tid}-{VALID_SID}-01") is not None


class TestTracestate:
    def test_members_kept_only_if_wellformed(self) -> None:
        parsed = parse_tracestate("foo=bar,baz,ROGUE=x,nosign@ok=v")
        assert ("foo", "bar") in parsed
        assert ("baz", "") in parsed
        assert all(key != "ROGUE" for key, _ in parsed)

    def test_capped_at_32_members(self) -> None:
        header = ",".join(f"k{i}=v{i}" for i in range(50))
        assert len(parse_tracestate(header)) == 32

    def test_overlong_value_dropped(self) -> None:
        parsed = parse_tracestate("a=" + "z" * 200 + ",b=ok")
        assert parsed == (("b", "ok"),)

    def test_format_round_trip(self) -> None:
        rendered = format_tracestate([("foo", "bar"), ("only-key", "")])
        assert rendered == "foo=bar,only-key"
        assert parse_tracestate(rendered) == (("foo", "bar"), ("only-key", ""))


class TestSampling:
    def test_mode_table(self) -> None:
        assert SamplingPolicy(SamplingMode.DISABLED).should_sample(
            trace_id=VALID_TID, parent_sampled=None, operation="risk.evaluate"
        ) is False
        assert SamplingPolicy(SamplingMode.OFF).should_sample(
            trace_id=VALID_TID, parent_sampled=None, operation="risk.evaluate"
        ) is False
        assert SamplingPolicy(SamplingMode.ALL).should_sample(
            trace_id=VALID_TID, parent_sampled=None, operation="risk.evaluate"
        ) is True

    def test_priority_operations_survive_ratio_zero(self) -> None:
        policy = SamplingPolicy(
            SamplingMode.RATIO, ratio=0.0, priority_operations=("execution.transmit",)
        )
        assert policy.should_sample(
            trace_id=VALID_TID, parent_sampled=None, operation="execution.transmit"
        ) is True
        assert policy.should_sample(
            trace_id=VALID_TID, parent_sampled=None, operation="risk.evaluate"
        ) is False

    def test_parent_based_follows_parent_only(self) -> None:
        policy = SamplingPolicy(SamplingMode.PARENT_BASED)
        assert policy.should_sample(
            trace_id=VALID_TID, parent_sampled=True, operation="risk.evaluate"
        ) is True
        assert policy.should_sample(
            trace_id=VALID_TID, parent_sampled=False, operation="risk.evaluate"
        ) is False
        assert policy.should_sample(
            trace_id=VALID_TID, parent_sampled=None, operation="risk.evaluate"
        ) is False

    def test_ratio_boundary_is_integer_ppm_arithmetic(self) -> None:
        # 50%: the first 64 bits decide. 0x7fff.. is below the half-space
        # threshold, 0x8000.. is not. Exact integer floor, no float compare.
        policy = SamplingPolicy(SamplingMode.RATIO, ratio=0.5)
        low = "7" + "f" * 15 + "0af7651916cd43dd"
        high = "8" + "0" * 15 + "0af7651916cd43dd"
        assert policy.should_sample(
            trace_id=low, parent_sampled=None, operation="risk.evaluate"
        ) is True
        assert policy.should_sample(
            trace_id=high, parent_sampled=None, operation="risk.evaluate"
        ) is False

    def test_minuscule_ratio_still_decides_exactly(self) -> None:
        # 0.000001 -> 1 ppm -> threshold = (2^64 * 1) // 1e6 = 18446744073709.
        policy = SamplingPolicy(SamplingMode.RATIO, ratio=0.000001)
        threshold = 18_446_744_073_709
        under = f"{threshold - 1:016x}" + "0af7651916cd43dd"
        at = f"{threshold:016x}" + "0af7651916cd43dd"
        assert policy.should_sample(
            trace_id=under, parent_sampled=None, operation="risk.evaluate"
        ) is True
        assert policy.should_sample(
            trace_id=at, parent_sampled=None, operation="risk.evaluate"
        ) is False

    def test_ratio_bounds_rejected(self) -> None:
        with pytest.raises(ValueError):
            SamplingPolicy(SamplingMode.RATIO, ratio=1.5)
        with pytest.raises(ValueError):
            SamplingPolicy(SamplingMode.RATIO, ratio=-0.1)


class TestTracerMechanics:
    def test_disabled_tracer_yields_noop(self) -> None:
        tracer = _tracer(SamplingMode.DISABLED)
        span = tracer.start_span("risk.evaluate")
        span.set_attribute("approved", "false")
        span.end()
        assert tracer.drain() == []
        assert tracer.buffered_spans == 0
        assert tracer.enabled is False

    def test_unknown_operation_is_dropped_and_counted(self) -> None:
        tracer = _tracer(SamplingMode.OFF)
        span = tracer.start_span("not.a.real.operation")
        assert span.context is None  # type: ignore[union-attr] - disabled span carries no context
        assert tracer.drop_counts["unknown_operation"] == 1
        assert "not.a.real.operation" not in TRACED_OPERATIONS

    def test_bad_trace_id_factory_is_counted_not_raised(self) -> None:
        tracer = Tracer(
            service="unit",
            sampler=SamplingPolicy(SamplingMode.ALL),
            trace_id_factory=lambda: "0" * 32,
        )
        tracer.start_span("risk.evaluate").end()
        assert tracer.drop_counts["bad_trace_id"] == 1

    def test_unsampled_child_of_unsampled_parent_stays_unsampled(self) -> None:
        # The regression this exists for: a disabled span must bind an
        # *unsampled* context, or PARENT_BASED children would fork the trace
        # back into existence downstream.
        parent_tracer = _tracer(SamplingMode.PARENT_BASED)
        child_tracer = _tracer(SamplingMode.PARENT_BASED)
        root = parent_tracer.start_span("risk.evaluate")
        assert root.context is not None
        with use_span(root):
            child = child_tracer.start_span("risk.evaluate")
        assert child.context is not None
        assert child.context.sampled is False
        assert child.context.trace_id == root.context.trace_id
        assert child_tracer.drain() == []

    def test_recording_span_lifecycle(self) -> None:
        tracer = _tracer()
        span = tracer.start_span(
            "risk.evaluate",
            kind=SpanKind.INTERNAL,
            attributes={"trade.symbol": "BTCUSDT", "risk.simulated": "true"},
        )
        span.set_attribute("approved", True)
        span.set_attribute("risk.event_count", 3)
        span.add_event("transmit_started")
        span.set_status(SpanStatus.OK)
        started_at = span.start_unix_nano
        span.end(at_micros=NOW + 1)
        assert span.end_unix_nano == (NOW + 1) * 1000
        assert span.start_unix_nano == started_at
        assert span.duration_nanos >= 0
        second_end = span.end_unix_nano
        span.end(at_micros=NOW + 9_999)
        assert span.end_unix_nano == second_end  # idempotent
        span.set_attribute("after", "end")  # no-op by contract
        assert "after" not in span.attributes
        drained = tracer.drain()
        assert [s.name for s in drained] == ["risk.evaluate"]
        assert tracer.drain() == []

    def test_attribute_hygiene(self) -> None:
        tracer = _tracer()
        span = tracer.start_span("risk.evaluate")
        span.set_attribute("api_key", "secret")  # sensitive key: refused
        span.set_attribute("UPPER", "x")  # invalid key: refused
        span.set_attribute("detail", "postgres://u:hunter2@db:5432 down")
        span.set_attribute("long", "x" * 400)
        span.set_attribute("weird", {"not": "a scalar"})
        span.set_attribute("pi", 3.5)
        assert "api_key" not in span.attributes
        assert "UPPER" not in span.attributes
        assert "hunter2" not in str(span.attributes["detail"])
        assert "[REDACTED]" in str(span.attributes["detail"])
        assert len(str(span.attributes["long"])) == 256
        assert "weird" not in span.attributes
        assert span.attributes["pi"] == "3.5"  # floats stringify, money never
        assert tracer.drop_counts["attribute_refused"] == 3

    def test_attribute_and_event_caps_overflow_not_crash(self) -> None:
        tracer = _tracer()
        span = tracer.start_span("risk.evaluate")
        for i in range(40):
            span.set_attribute(f"attr{i}", i)
        assert len(span.attributes) == 32
        assert tracer.drop_counts["attribute_overflow"] == 8
        for i in range(40):
            span.add_event(f"event_{i}")
        assert len(span.events) == 32
        assert tracer.drop_counts["event_overflow"] == 8

    def test_exception_summary_is_type_and_redacted_message(self) -> None:
        tracer = _tracer()
        span = tracer.start_span("risk.evaluate")
        try:
            raise ValueError(
                "auth failed: bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefGHIJKLmnop"
            )
        except ValueError as exc:
            span.record_exception(exc)
        assert len(span.events) == 1
        event = span.events[0]
        assert event["name"] == "exception"
        assert event["attributes"]["exception.type"] == "ValueError"
        message = str(event["attributes"]["exception.message"])
        assert "eyJ" not in message  # JWT redacted
        assert "auth failed" in message
        span.end()

    def test_ring_buffer_evicts_oldest_and_drain_is_fifo_capped(self) -> None:
        tracer = _tracer(buffer_size=16)
        for _ in range(20):
            tracer.start_span("risk.evaluate").end()
        assert tracer.buffered_spans == 16
        first_batch = tracer.drain(max_spans=4)
        assert len(first_batch) == 4
        assert tracer.buffered_spans == 12

    def test_use_span_binds_and_unbinds_context(self) -> None:
        tracer = _tracer()
        assert current_span_context() is None
        with use_span(tracer.start_span("http.server", kind=SpanKind.SERVER)) as parent:
            ambient = current_span_context()
            assert ambient is not None
            assert ambient.trace_id == parent.context.trace_id
            child = tracer.start_span("risk.evaluate")
            assert child.context.parent_span_id == parent.context.span_id
            assert child.context.trace_id == parent.context.trace_id
        assert current_span_context() is None

    def test_correlation_context_is_attached_when_present(self) -> None:
        from wlct_trading.observability.correlation import bind

        tracer = _tracer()
        with bind(correlation_id="corr-42"):
            span = tracer.start_span("risk.evaluate")
        assert span.attributes.get("correlation_id") == "corr-42"


class TestOtlpJsonEncode:
    def _span(self, *, trace: str, span: str, parent: str | None, start: int) -> Span:
        context = TraceContext(
            trace_id=trace,
            span_id=span,
            parent_span_id=parent,
            trace_flags=1,
            tracestate=(("vendor", "v1"),),
        )
        record = Span(
            context=context,
            name="risk.evaluate",
            kind=SpanKind.INTERNAL,
            attributes={"b_key": "two", "a_key": 1, "flag": True},
            events=[
                {
                    "name": "milestone",
                    "time_unix_nano": start + 5,
                    "attributes": {"detail": "ok"},
                }
            ],
            status=SpanStatus.ERROR,
            status_description="denied",
            start_unix_nano=start,
            end_unix_nano=start + 10,
            duration_nanos=10,
            resource={"service.name": "svc", "deployment.environment": "test"},
        )
        record._ended = True
        return record

    def test_payload_shape_and_determinism(self) -> None:
        older = self._span(trace="a" * 32, span="b" * 16, parent=None, start=1_700_000_000_000_000_000)
        newer = self._span(trace="c" * 32, span="d" * 16, parent="b" * 16, start=1_700_000_001_000_000_000)
        first = otlp_json_encode([newer, older])
        second = otlp_json_encode([newer, older])
        assert first == second  # byte-identical for identical input
        payload = json.loads(first)
        assert set(payload) == {"resourceSpans"}
        group = payload["resourceSpans"][0]
        assert list(group) == ["resource", "scopeSpans"]
        assert [a["key"] for a in group["resource"]["attributes"]] == [
            "deployment.environment",
            "service.name",
        ]
        scope = group["scopeSpans"][0]
        assert list(scope) == ["scope", "spans"]
        assert scope["scope"] == {"name": "wlct.observability", "version": "1"}
        spans = scope["spans"]
        assert [s["startTimeUnixNano"] for s in spans] == sorted(
            s["startTimeUnixNano"] for s in spans
        )
        head = spans[0]
        assert list(head) == [
            "traceId",
            "spanId",
            "name",
            "kind",
            "startTimeUnixNano",
            "endTimeUnixNano",
            "attributes",
            "events",
            "status",
            "tracestate",
            "flags",
        ]
        assert head["kind"] == 1
        assert head["attributes"] == [
            {"key": "a_key", "value": {"intValue": "1"}},
            {"key": "b_key", "value": {"stringValue": "two"}},
            {"key": "flag", "value": {"boolValue": True}},
        ]
        assert head["status"] == {"code": 2, "message": "denied"}
        assert head["events"][0]["timeUnixNano"] == str(1_700_000_000_000_000_005)
        assert "parentSpanId" not in head
        assert spans[1]["parentSpanId"] == "b" * 16
        assert " " not in first  # compact separators

    def test_empty_input_is_empty_payload(self) -> None:
        assert json.loads(otlp_json_encode([])) == {"resourceSpans": []}


class TestDecisionEquivalence:
    """The tracer observes; it never authorises.

    Every scenario runs twice: once with no tracer (Part 8's world, unchanged)
    and once with a recording tracer, and the complete decision evidence is
    compared - verdict, code, violations, reservation, protection proposals,
    event count, and every scalar on the decision object. A span attribute is
    allowed to disagree with nothing because the decision is byte-for-byte the
    same object graph on both paths.
    """

    @staticmethod
    def _gate(tracer: Tracer | None) -> tuple[RiskGate, object]:
        config = config_with(*BASELINE)
        gate = RiskGate(
            configuration=config,
            simulated=True,
            events=InMemoryRiskEventSink(),
            kill_switches=KillSwitchLedger(),
            freshness=FreshnessBudget(max_snapshot_age_micros=5_000_000),
            tracer=tracer,
        )
        return gate, config

    @staticmethod
    def _facts(outcome: object) -> tuple[object, ...]:
        decision = outcome.decision  # type: ignore[attr-defined]
        return (
            decision.approved,
            decision.code.value,
            decision.would_route,
            decision.evaluated_at,
            tuple(decision.violations),
            decision.kill_switch_scope,
            decision.snapshot_version,
            decision.decision_id,
            len(outcome.outcomes),  # type: ignore[attr-defined]
            len(outcome.events),  # type: ignore[attr-defined]
            len(outcome.proposed_protections),  # type: ignore[attr-defined]
            outcome.reservation is not None,  # type: ignore[attr-defined]
        )

    def _run_both(self, *, quantity: str, state_present: bool) -> tuple[object, object, object]:
        plain_gate, config = self._gate(None)
        traced_gate, _ = self._gate(_tracer())
        state = state_from(config) if state_present else None  # type: ignore[arg-type]
        order = intent(quantity=quantity)
        common = dict(
            state=state,
            request_id="req-equivalence",
            trading_mode=TradingMode.PAPER,
            now_micros=NOW,
            decision_id="decision-equivalence",
        )
        plain = plain_gate.evaluate(order, **common)  # type: ignore[arg-type]
        traced = traced_gate.evaluate(order, **common)  # type: ignore[arg-type]
        assert plain.decision.evaluated_at == traced.decision.evaluated_at
        return plain, traced, traced_gate

    def test_approved_decision_identical_with_and_without_tracer(self) -> None:
        plain, traced, traced_gate = self._run_both(quantity="1", state_present=True)
        assert plain.decision.approved is True
        assert self._facts(plain) == self._facts(traced)
        spans = traced_gate._tracer.drain()  # type: ignore[attr-defined]
        assert len(spans) == 1
        assert spans[0].name == "risk.evaluate"
        assert spans[0].attributes["approved"] == "true"
        assert spans[0].attributes["outcome"] == "approved"
        assert spans[0].status is SpanStatus.OK

    def test_denied_decision_identical_with_and_without_tracer(self) -> None:
        plain, traced, traced_gate = self._run_both(
            quantity="999999999", state_present=True
        )
        assert plain.decision.approved is False
        assert self._facts(plain) == self._facts(traced)
        spans = traced_gate._tracer.drain()  # type: ignore[attr-defined]
        assert spans[0].attributes["outcome"] == "denied"
        assert spans[0].attributes["risk.decision_code"] == traced.decision.code.value

    def test_missing_state_denied_and_span_says_so(self) -> None:
        plain, traced, traced_gate = self._run_both(quantity="1", state_present=False)
        assert plain.decision.approved is False
        assert self._facts(plain) == self._facts(traced)
        spans = traced_gate._tracer.drain()  # type: ignore[attr-defined]
        assert spans[0].attributes["risk.state_present"] == "false"

    def test_tracer_none_path_allocates_no_spans(self) -> None:
        plain_gate, config = self._gate(None)
        state = state_from(config)
        plain_gate.evaluate(
            intent(),
            state=state,
            request_id="req-quiet",
            trading_mode=TradingMode.PAPER,
            now_micros=NOW,
        )
        # No tracer object exists at all; nothing to drain, nothing dropped.
        assert plain_gate._tracer is None  # type: ignore[attr-defined]
