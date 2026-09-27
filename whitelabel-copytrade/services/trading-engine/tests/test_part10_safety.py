"""Part 10 engine-side safety laws: the trading decision path must not read
telemetry, and telemetry must not be able to bite the path that writes it.

These are the enforceable form of the rulebook sentences: "observe, never
authorise" and "a failed flush retains, never raises". Half the file reads
the router as TEXT (a law about what a module does NOT mention is a law for
grep, or it is a law that silently rots), half runs the hub's real code
against stand-in Redis to pin the bucket contract the API evaluator reads.
The API-side twin of this suite is
apps/api/src/modules/observability/part10-safety.spec.ts.
"""

from __future__ import annotations

import asyncio
import inspect
import pathlib
import re
from typing import Any

from app.observability import TradingEngineObservability
from tests.test_part10_tracing import _BucketRedis, settings

_MODULE_DIR = pathlib.Path(__file__).resolve().parents[1]
ROUTER_SOURCE = (_MODULE_DIR / "app" / "routers" / "engine.py").read_text(encoding="utf-8")
HUB_SOURCE = (_MODULE_DIR / "app" / "observability.py").read_text(encoding="utf-8")


class TestTradingPathIgnoresTelemetry:
    def test_router_never_consults_the_injector_or_the_tracer(self) -> None:
        # The evaluate route may COUNT decisions and record errors; it must
        # never ask the fault injector, the tracer, or the sampler what to
        # do. Those tokens appearing anywhere in the module is the smell of
        # a decision that started reading its own dashboard.
        lowered = ROUTER_SOURCE.lower()
        for banned in ("injector", "consume_fault", "tracer.", "should_sample", "sampler"):
            assert banned not in lowered, f"router references telemetry control surface: {banned}"

    def test_recording_happens_after_the_decision_and_reraises_untouched(self) -> None:
        # Ordering law: the verdict is computed first; the hub is touched
        # only on the far side of that call. And the except-path records a
        # bad sample and then RE-RAISES - no swallowing, no substitution.
        evaluate_at = ROUTER_SOURCE.index("risk_engine.evaluate(")
        record_at = ROUTER_SOURCE.index("record_pretrade(")
        error_at = ROUTER_SOURCE.index("record_pretrade_error()")
        assert evaluate_at < record_at
        assert evaluate_at < error_at
        assert re.search(r"record_pretrade_error\(\)\n\s+raise\b", ROUTER_SOURCE), (
            "the except-path must record the error and re-raise it unchanged"
        )

    def test_hub_recorders_return_none_cannot_answer_anything(self) -> None:
        # Both recorders are annotated `-> None` in the real module (not in
        # a test copy): observation-shaped by signature, so a caller cannot
        # even accidentally branch on them.
        for name in ("record_pretrade", "record_pretrade_error"):
            source = inspect.getsource(getattr(TradingEngineObservability, name))
            assert "-> None" in source


class TestMirrorLoopLaws:
    def test_samples_flush_after_traces_in_the_same_loop(self) -> None:
        match = re.search(
            r"async def _mirror_loop[\s\S]*?(?=\n    (?:async )?def )", HUB_SOURCE
        )
        assert match is not None, "_mirror_loop not found on disk - the scan is broken"
        body = match.group(0)
        traces_at = body.index("_flush_traces()")
        samples_at = body.index("_flush_slo_samples()")
        assert traces_at < samples_at, (
            "the trace export runs FIRST so a slow collector cannot delay "
            "sample flushes; ordering here is the whole of that defence"
        )

    def test_bucket_contract_matches_the_api_evaluator(self) -> None:
        # The API evaluator reads `wlct:trading:ops:slo:engineerr:<t/600>`
        # as an EVENT-SHAPED source: fields good/bad only, no ticks, delta
        # semantics, TTL 14 days. Pin the writer to that exact contract.
        hub: Any = TradingEngineObservability(settings(), _BucketRedis())
        hub.record_pretrade(approved=True, duration_micros=1)
        hub.record_pretrade(approved=False, duration_micros=1)
        hub.record_pretrade_error()
        asyncio.run(hub._flush_slo_samples())
        writes = [op for op in hub._redis.ops if op[0] == "hincrby"]  # type: ignore[attr-defined]
        fields = {op[2] for op in writes}
        assert fields == {"good", "bad"}
        key = writes[0][1]  # type: ignore[attr-defined]
        assert re.fullmatch(r"wlct:trading:ops:slo:engineerr:\d+", key)
        expires = [op for op in hub._redis.ops if op[0] == "pexpire"]  # type: ignore[attr-defined]
        assert expires and expires[0][2] == 14 * 86_400_000

    def test_flush_is_independent_of_the_tracing_switch(self) -> None:
        # OTEL off means no tracer, no spans, no export - and STILL working
        # error-rate SLO samples, because those are metrics-shaped, not
        # trace-shaped. A platform that stops measuring its own error rate
        # when the collector is disabled has confused the pipe with the
        # measurement.
        hub: Any = TradingEngineObservability(
            settings(OTEL_ENABLED=False, OTEL_ENDPOINT=None),
            _BucketRedis(),
        )
        assert hub.tracer is None
        hub.record_pretrade(approved=True, duration_micros=2)
        assert hub._slo_decisions["good"] == 1
        asyncio.run(hub._flush_slo_samples())
        writes = [op for op in hub._redis.ops if op[0] == "hincrby"]  # type: ignore[attr-defined]
        assert writes and writes[0][2] == "good"
