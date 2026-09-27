"""Part 10 tracing wiring on the market-data side.

Same rules as the trading engine's twin suite, scoped to what this process
does: config discipline (no production injection, http(s)-only endpoints),
build-time no-ops when tracing is off, and an export loop that counts
dropped spans without ever feeding back into quote freshness - the staleness
budget is computed identically whether or not a collector is reachable.
"""

from __future__ import annotations

import asyncio
from typing import Any

from app.config import Settings
from app.tracing import build_injector, build_tracer

BASE: dict[str, str] = {
    "DATABASE_URL": "postgresql://x:y@localhost:5432/db",
    "REDIS_HOST": "localhost",
    "INTERNAL_SERVICE_TOKEN": "test-internal-service-token-value-0123456789abcdef",
}


def settings(**overrides: object) -> Settings:
    return Settings(**{**BASE, **overrides})  # type: ignore[arg-type]


class TestConfigDiscipline:
    def test_production_refuses_armed_injection(self) -> None:
        import pytest
        from pydantic import ValidationError

        with pytest.raises(ValidationError, match="test-harness switch"):
            settings(NODE_ENV="production", FAILURE_INJECTION_ENABLED=True)

    def test_grpc_endpoints_are_refused(self) -> None:
        import pytest
        from pydantic import ValidationError

        with pytest.raises(ValidationError, match="OTLP/HTTP"):
            settings(OTEL_ENDPOINT="grpc://collector:4317")


class TestBuilders:
    def test_defaults_build_no_tracer_and_a_disabled_injector(self) -> None:
        config = settings()
        assert build_tracer(config) is None
        assert build_injector(config).enabled is False
        assert build_injector(config).consume("trace_export_unavailable") is False

    def test_enabled_tracer_samples_all_at_ratio_one(self) -> None:
        tracer = build_tracer(
            settings(OTEL_ENABLED=True, OTEL_SAMPLE_RATIO=1.0)
        )
        assert tracer is not None
        assert tracer.enabled is True
        tracer.start_span("http.server").end()
        (span,) = tracer.drain()
        assert span.name == "http.server"
        assert span.resource["service.name"] == "market-data"


class TestHubTelemetry:
    def test_flush_counts_and_never_raises_without_a_tracer(self) -> None:
        from app.observability import MarketDataObservability

        hub = MarketDataObservability(settings(), _NoopRedis())  # type: ignore[arg-type]
        # Tracing off: the tick is a no-op and the view says so honestly.
        asyncio.run(hub._flush_traces())
        view = hub.telemetry_view
        assert view["tracingEnabled"] is False
        assert view["exportConsecutiveFailures"] == 0

    def test_dropped_spans_are_counted_without_an_endpoint(self) -> None:
        from app.observability import MarketDataObservability

        hub = MarketDataObservability(
            settings(  # type: ignore[arg-type]
                OTEL_ENABLED=True, OTEL_SAMPLE_RATIO=1.0, OTEL_ENDPOINT=None
            ),
            _NoopRedis(),  # type: ignore[arg-type]
        )
        assert hub.tracer is not None
        for _ in range(2):
            hub.tracer.start_span("http.server").end()
            asyncio.run(hub._flush_traces())
        assert hub._export_failures == 2
        assert hub.telemetry_view["exportConsecutiveFailures"] == 2
        from wlct_trading.observability import render_prometheus

        text = render_prometheus(hub.registry)
        assert 'wlct_tracing_export_outcomes_total{result="skipped"' in text


class _NoopRedis:
    """MirrorRedis stand-in: the export path must not need Redis at all."""

    async def get(self, key: str) -> str | None:
        return None

    async def ping(self) -> bool:
        return True

    def pipeline(self, *, transaction: bool = True) -> Any:
        raise AssertionError("unused by the export path")
