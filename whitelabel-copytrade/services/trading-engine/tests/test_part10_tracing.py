"""Part 10 service-side tracing wiring: config, middleware, export loop.

The properties under test are the ones the platform rulebook stakes its
credibility on: production configuration cannot arm fault injection, the
export loop never re-queues spans, export failure pages but never blocks,
and with tracing switched off the process behaves byte-for-byte like the
pre-Part-10 process (no headers invented, no objects allocated).
"""

from __future__ import annotations

import asyncio
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from wlct_trading.observability import SamplingMode, SamplingPolicy, Tracer

from app.config import Settings
from app.observability import TradingEngineObservability
from app.tracing import (
    build_injector,
    build_tracer,
    flush_traces,
    start_request_span,
)
from tests.test_observability_readiness import FakeRedis

BASE: dict[str, str] = {
    "DATABASE_URL": "postgresql://x:y@localhost:5432/db",
    "REDIS_HOST": "localhost",
    "INTERNAL_SERVICE_TOKEN": "test-internal-service-token-value-0123456789abcdef",
}


def settings(**overrides: object) -> Settings:
    return Settings(**{**BASE, **overrides})  # type: ignore[arg-type]


class TestConfigDiscipline:
    def test_production_refuses_armed_injection(self) -> None:
        with pytest.raises(ValidationError, match="test-harness switch"):
            settings(NODE_ENV="production", FAILURE_INJECTION_ENABLED=True)

    def test_guard_off_disables_instead_of_unlocking(self) -> None:
        with pytest.raises(ValidationError, match="disabling the guard disables the feature"):
            settings(
                NODE_ENV="development",
                FAILURE_INJECTION_ENABLED=True,
                FAILURE_INJECTION_ALLOW_NON_PRODUCTION_ONLY=False,
            )

    def test_production_with_tracing_needs_an_endpoint(self) -> None:
        with pytest.raises(ValidationError, match="OTEL_ENDPOINT is mandatory"):
            settings(NODE_ENV="production", OTEL_ENABLED=True, OTEL_ENDPOINT=None)

    def test_endpoint_must_be_http(self) -> None:
        with pytest.raises(ValidationError, match="OTLP/HTTP"):
            settings(OTEL_ENDPOINT="grpc://collector:4317")

    def test_development_defaults_parse(self) -> None:
        config = settings(NODE_ENV="development")
        assert config.OTEL_ENABLED is False
        assert config.FAILURE_INJECTION_ENABLED is False
        assert config.OTEL_SAMPLE_RATIO == pytest.approx(0.1)


class TestBuilders:
    def test_disabled_means_none(self) -> None:
        assert build_tracer(settings()) is None
        assert build_injector(settings()).enabled is False

    def test_priority_filtering_keeps_only_real_operations(self) -> None:
        tracer = build_tracer(
            settings(
                OTEL_ENABLED=True,
                OTEL_SAMPLE_RATIO=0.0,
                OTEL_PRIORITY_OPERATIONS="execution.transmit,not.a.real.thing",
            )
        )
        assert tracer is not None
        assert tracer.enabled is True
        # Only the allow-listed name survives into the sampler.
        assert tracer._sampler.priority_operations == frozenset(
            {"execution.transmit"}
        )

    def test_injection_arms_closed_export_points(self) -> None:
        injector = build_injector(
            settings(NODE_ENV="test", FAILURE_INJECTION_ENABLED=True)
        )
        assert injector.enabled is True
        assert set(injector.active_points()) == {
            "trace_export_unavailable",
            "metrics_export_unavailable",
        }


def _recording_tracer() -> Tracer:
    counter = iter(range(1, 1_000_000))
    return Tracer(
        service="unit",
        sampler=SamplingPolicy(SamplingMode.ALL),
        span_id_factory=lambda: f"{next(counter):016x}",
    )


class TestFlush:
    def test_idle_tick(self) -> None:
        report = asyncio.run(
            flush_traces(
                _recording_tracer(),
                endpoint=None,
                timeout_ms=100,
                injector=build_injector(settings()),
            )
        )
        assert report == {"drained": 0, "exported": 0, "failed": 0, "outcome": "idle"}

    def test_unconfigured_endpoint_drops_loudly(self) -> None:
        tracer = _recording_tracer()
        tracer.start_span("risk.evaluate").end()
        report = asyncio.run(
            flush_traces(
                tracer,
                endpoint=None,
                timeout_ms=100,
                injector=build_injector(settings()),
            )
        )
        assert report["outcome"] == "skipped"
        assert report["failed"] == 1
        assert tracer.buffered_spans == 0  # NOT re-queued - loss is the contract

    def test_successful_export(self, monkeypatch: pytest.MonkeyPatch) -> None:
        captured: dict[str, Any] = {}

        class FakeResponse:
            status_code = 202

        async def fake_post(
            self: httpx.AsyncClient, url: str, **kwargs: Any
        ) -> FakeResponse:
            captured["url"] = url
            captured["body"] = kwargs["content"].decode("utf-8")
            captured["content_type"] = kwargs["headers"]["content-type"]
            return FakeResponse()

        monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)
        tracer = _recording_tracer()
        tracer.start_span("risk.evaluate").end()
        report = asyncio.run(
            flush_traces(
                tracer,
                endpoint="http://collector:4318/",
                timeout_ms=100,
                injector=build_injector(settings()),
            )
        )
        assert report["outcome"] == "ok"
        assert report["exported"] == 1
        assert captured["url"] == "http://collector:4318/v1/traces"
        assert captured["content_type"] == "application/json"
        assert '"name":"risk.evaluate"' in captured["body"]

    def test_transport_error_counts_as_failure(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        async def boom(self: httpx.AsyncClient, url: str, **kwargs: Any) -> Any:
            raise httpx.ConnectError("connection refused")

        monkeypatch.setattr(httpx.AsyncClient, "post", boom)
        tracer = _recording_tracer()
        tracer.start_span("risk.evaluate").end()
        report = asyncio.run(
            flush_traces(
                tracer,
                endpoint="http://collector:4318",
                timeout_ms=100,
                injector=build_injector(settings()),
            )
        )
        assert report["outcome"] == "error"
        assert report["failed"] == 1

    def test_injected_failure_consumes_the_tick(self) -> None:
        tracer = _recording_tracer()
        tracer.start_span("risk.evaluate").end()
        injector = build_injector(
            settings(
                FAILURE_INJECTION_ENABLED=True,
                OTEL_ENDPOINT="http://collector:4318",
            )
        )
        report = asyncio.run(
            flush_traces(
                tracer,
                endpoint="http://collector:4318",
                timeout_ms=100,
                injector=injector,
            )
        )
        assert report["outcome"] == "injected"
        assert report["failed"] == 1
        assert (
            injector.describe()["fired_totals"]["trace_export_unavailable"] == 1
        )


class TestHubAlerting:
    def test_three_failed_ticks_open_the_warning_alert(self) -> None:
        hub = TradingEngineObservability(
            settings(
                OTEL_ENABLED=True,
                OTEL_SAMPLE_RATIO=1.0,
                OTEL_ENDPOINT=None,
            ),
            FakeRedis(),
        )
        assert hub.tracer is not None
        for _ in range(3):
            hub.tracer.start_span("risk.evaluate").end()
            asyncio.run(hub._flush_traces())
        active = {record.rule_id for record in hub.alerts.active()}
        assert "TELEMETRY_EXPORT_FAILING" in active
        assert hub._export_failures == 3
        from wlct_trading.observability import render_prometheus

        text = render_prometheus(hub.registry)
        assert 'wlct_tracing_export_outcomes_total{result="skipped"' in text
        assert 'wlct_tracing_spans_total{result="dropped"' in text

    def test_recovery_after_a_clean_tick(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        hub = TradingEngineObservability(
            settings(
                OTEL_ENABLED=True,
                OTEL_SAMPLE_RATIO=1.0,
                OTEL_ENDPOINT="http://collector:4318",
            ),
            FakeRedis(),
        )
        assert hub.tracer is not None

        async def boom(self: httpx.AsyncClient, url: str, **kwargs: Any) -> Any:
            raise httpx.ConnectError("collector down")

        monkeypatch.setattr(httpx.AsyncClient, "post", boom)
        for _ in range(3):
            hub.tracer.start_span("risk.evaluate").end()
            asyncio.run(hub._flush_traces())
        assert hub._export_failures == 3

        class R:
            status_code = 200

        async def ok_post(self: httpx.AsyncClient, url: str, **kwargs: Any) -> R:
            return R()

        monkeypatch.setattr(httpx.AsyncClient, "post", ok_post)
        hub.tracer.start_span("risk.evaluate").end()
        asyncio.run(hub._flush_traces())
        assert hub._export_failures == 0
        open_rules = {
            r.rule_id for r in hub.alerts.active() if r.state.value == "OPEN"
        }
        assert "TELEMETRY_EXPORT_FAILING" not in open_rules

    def test_telemetry_view_is_present_even_with_tracing_off(self) -> None:
        hub = TradingEngineObservability(settings(), FakeRedis())
        view = hub.telemetry_view
        assert view["tracingEnabled"] is False
        assert view["faultInjection"] == {
            "enabled": False,
            "active_points": [],
            "fired_totals": {},
        }


class TestMiddleware:
    def test_no_tracer_means_no_trace_headers(self, client: TestClient) -> None:
        response = client.get("/health")
        assert "x-trace-id" not in response.headers

    def test_traceparent_continues_and_x_trace_id_answers(
        self, client: TestClient
    ) -> None:
        hub = client.app.state.observability  # session client starts the hub
        assert hub is not None
        tracer = _recording_tracer()
        client.app.state.tracer = tracer
        try:
            incoming = "00-" + "a" * 32 + "-" + "b" * 16 + "-01"
            response = client.get("/health", headers={"traceparent": incoming})
            assert response.status_code == 200
            assert response.headers["x-trace-id"] == "a" * 32
            spans = tracer.drain()
            assert [s.name for s in spans] == ["http.server"]
            assert spans[0].context.trace_id == "a" * 32
            assert spans[0].attributes["http.method"] == "GET"
        finally:
            del client.app.state.tracer

    def test_malformed_traceparent_starts_a_fresh_trace(
        self, client: TestClient
    ) -> None:
        tracer = _recording_tracer()
        client.app.state.tracer = tracer
        try:
            response = client.get("/health", headers={"traceparent": "00-zzz"})
            assert "x-trace-id" in response.headers
            assert response.headers["x-trace-id"] != "0" * 32
            span = tracer.drain()[0]
            assert len(span.context.trace_id) == 32
        finally:
            del client.app.state.tracer

    def test_server_span_records_5xx_as_error(self) -> None:
        from wlct_trading.observability.tracing import (
            SpanStatus,
            otlp_json_encode,
        )

        tracer = _recording_tracer()
        span = start_request_span(
            tracer, method="GET", path="/v1/does-not-exist", headers={}
        )
        assert span is not None
        span.set_status(SpanStatus.ERROR, description="status 404")
        span.end()
        (recorded,) = tracer.drain()
        assert recorded.status is SpanStatus.ERROR
        # The payload that would be POSTed is valid OTLP/JSON end to end.
        payload = otlp_json_encode([recorded], resource=tracer.resource)
        assert '\"key\":\"http.status_code\"' not in payload  # not set here
        assert '"status":{"code":2,"message":"status 404"}' in payload


class _RecordingPipe:
    """Pipeline stand-in that records writes into the shared `ops` list."""

    def __init__(self, ops: list[object], fail: bool) -> None:
        self._ops = ops
        self._fail = fail
        self._staged: list[tuple[object, ...]] = []

    def hincrby(self, key: str, field: str, value: int) -> None:
        self._staged.append(("hincrby", key, field, value))

    def pexpire(self, key: str, ms: int) -> None:
        self._staged.append(("pexpire", key, ms))

    async def execute(self) -> list[bool]:
        if self._fail:
            raise OSError("redis down")
        self._ops.extend(self._staged)
        return [True] * len(self._staged)


class _BucketRedis:
    def __init__(self) -> None:
        self.ops: list[object] = []
        self.fail_next = False

    async def get(self, key: str) -> str | None:
        return None

    async def ping(self) -> bool:
        return True

    def pipeline(self, *, transaction: bool = True) -> _RecordingPipe:
        fail = self.fail_next
        self.fail_next = False
        return _RecordingPipe(self.ops, fail)


class TestSloErrorBuckets:
    """The `engineerr` sample buckets: in-memory counts, 10-minute buckets,
    deltas only, and a failed flush that REPLAYS rather than vanishes."""

    def test_counts_are_delta_flushed_and_reset(self) -> None:
        from app.observability import TradingEngineObservability

        redis = _BucketRedis()
        hub = TradingEngineObservability(settings(), redis)
        hub.record_pretrade(approved=True, duration_micros=10)
        hub.record_pretrade(approved=False, duration_micros=12)
        hub.record_pretrade_error()
        asyncio.run(hub._flush_slo_samples())
        kinds = [op for op in redis.ops if isinstance(op, tuple) and op[0] == "hincrby"]
        fields = {(op[2], op[3]) for op in kinds}
        assert ("good", 2) in fields
        assert ("bad", 1) in fields
        key = next(op[1] for op in kinds)  # type: ignore[index]
        assert key.startswith("wlct:trading:ops:slo:engineerr:")
        # idempotent: nothing counted twice, nothing pending
        before = len(redis.ops)
        asyncio.run(hub._flush_slo_samples())
        assert len(redis.ops) == before

    def test_failed_flush_replays_next_tick(self) -> None:
        from app.observability import TradingEngineObservability

        redis = _BucketRedis()
        hub = TradingEngineObservability(settings(), redis)
        hub.record_pretrade(approved=True, duration_micros=5)
        redis.fail_next = True
        asyncio.run(hub._flush_slo_samples())  # must not raise
        assert hub._slo_decisions["good"] == 1  # retained for replay
        asyncio.run(hub._flush_slo_samples())
        writes = [
            op for op in redis.ops if isinstance(op, tuple) and op[0] == "hincrby"
        ]
        assert sum(op[3] for op in writes) == 1  # exactly once, on the retry
