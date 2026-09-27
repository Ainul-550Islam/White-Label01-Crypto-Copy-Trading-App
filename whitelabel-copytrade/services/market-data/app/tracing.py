"""Part 10 trace wiring for the market-data process.

Three rules govern everything in this file, and they are the Part 10 rules
restated where they are actually implemented:

* **Observe, never authorise.** The tracer is built here, spans are started
  around HTTP requests, and finished spans leave this process. This service
  publishes market data; telemetry failure does not change what is fresh
  and what is not - the staleness budget is computed the same way with or
  without a collector.
* **Dropped is loud.** The exporter contract inherited from
  :meth:`wlct_trading.observability.Tracer.drain`: one delivery attempt per
  span, failures counted, spans NOT re-queued. A retry queue behind a dead
  collector converts an observability outage into an availability outage;
  this platform has real orders on the line and will not trade that
  trade-off. Consecutive failures surface as the TELEMETRY_EXPORT_FAILING
  alert (WARNING - the platform is darker, not wrong).
* **Faults are config-armed, closed-set, and consumed once per plan.**
  :mod:`wlct_trading.observability.faults` owns the universe; production
  refuses to start with injection armed; the only runtime operation is
  ``consume``. Market-data consumes the same ``metrics_export_unavailable``
  / ``trace_export_unavailable`` pair as its sibling services.

The endpoint contract is OTLP/HTTP JSON (``POST <endpoint>/v1/traces``),
matching ``otlp_json_encode``'s payload. A protobuf collector that wants
these bytes would front a translating collector; this service deliberately
carries no protobuf dependency.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

import httpx
from wlct_trading.observability import (
    FailureInjector,
    FaultSpec,
    SamplingMode,
    SamplingPolicy,
    Tracer,
    disabled_injector,
)
from wlct_trading.observability.faults import FAULT_POINTS
from wlct_trading.observability.tracing import (
    TRACED_OPERATIONS,
    SpanKind,
    SpanStatus,
    format_traceparent,
    otlp_json_encode,
    parse_traceparent,
    parse_tracestate,
)

if TYPE_CHECKING:  # pragma: no cover - typing only
    from app.config import Settings

logger = logging.getLogger(__name__)

TRACEPARENT_HEADER = "traceparent"
TRACESTATE_HEADER = "tracestate"
TRACE_ID_RESPONSE_HEADER = "x-trace-id"
EXPORT_PATH = "/v1/traces"

#: Consecutive export failures before the alert opens. One retry blip is a
#: blip; three mirror-loop ticks of darkness is an incident worth a page.
FAILURE_ALERT_THRESHOLD = 3


def build_tracer(settings: Settings) -> Tracer | None:
    """Construct the process tracer, or ``None`` when tracing is off.

    ``None`` is not a courtesy: every instrumented constructor treats the
    absence of a tracer as a literal zero-cost passthrough (no span objects,
    no buffers, no counters), so a deployment with ``OTEL_ENABLED=false``
    runs the exact code it ran the day before tracing existed.
    """
    if not settings.OTEL_ENABLED:
        return None
    priority = tuple(
        item.strip()
        for item in settings.OTEL_PRIORITY_OPERATIONS.split(",")
        if item.strip()
    )
    unknown = [name for name in priority if name not in TRACED_OPERATIONS]
    if unknown:
        # Loud but non-fatal: a typo in a priority operation costs coverage,
        # not uptime. The name is recorded so the log explains why nothing
        # is being sampled for it.
        logger.warning(
            "tracing.priority_operations_unknown",
            extra={"event": "tracing.priority_operations_unknown", "unknown": list(unknown)},
        )
        priority = tuple(name for name in priority if name in TRACED_OPERATIONS)
    sampler = SamplingPolicy(
        SamplingMode.RATIO,
        ratio=settings.OTEL_SAMPLE_RATIO,
        priority_operations=priority,
    )
    return Tracer(
        service="market-data",
        environment=settings.NODE_ENV,
        version="1.0.0",
        instance="local",
        sampler=sampler,
    )


def build_injector(settings: Settings) -> FailureInjector:
    """Config-armed fault plan. No runtime lever exists (or is added)."""
    if not settings.FAILURE_INJECTION_ENABLED:
        return disabled_injector()
    specs: dict[str, FaultSpec] = {
        name: FaultSpec(times=-1)
        for name in ("trace_export_unavailable", "metrics_export_unavailable")
        if name in FAULT_POINTS
    }
    return FailureInjector.from_settings(enabled=True, specs=specs)


def start_request_span(
    tracer: Tracer | None,
    *,
    method: str,
    path: str,
    headers: dict[str, str],
) -> Any:
    """Server span for one inbound request, honouring an upstream context.

    A malformed ``traceparent`` is not an error: ``parse_traceparent``
    returns ``None`` and the service starts a fresh root. A foreign trace
    id is never joined on trust - corrupted grouping headers are how a
    dashboard learns to lie.
    """
    if tracer is None:
        return None
    parent = parse_traceparent(headers.get(TRACEPARENT_HEADER))
    tracestate = parse_tracestate(headers.get(TRACESTATE_HEADER))
    span = tracer.start_span(
        "http.server",
        kind=SpanKind.SERVER,
        parent=parent,
        attributes={
            "http.method": method,
            "http.path": path[:128],
        },
    )
    if tracestate:
        # Member COUNT, never content: tracestate values are vendor
        # territory and can carry anything, including secrets the vendor
        # round-trips. The count answers "did context survive the hop?".
        span.set_attribute("http.tracestate_members", len(tracestate))
    return span


def response_trace_header(span: Any) -> str | None:
    """The ``x-trace-id`` value for a started span (``None`` when untraced)."""
    context = getattr(span, "context", None)
    if context is None:
        return None
    trace_id = getattr(context, "trace_id", None)
    return trace_id if isinstance(trace_id, str) else None


def finish_request_span(
    span: Any,
    *,
    status_code: int,
) -> None:
    if span is None:
        return
    span.set_attribute("http.status_code", status_code)
    if status_code >= 500:
        span.set_status(SpanStatus.ERROR, description=f"status {status_code}")
    else:
        span.set_status(SpanStatus.OK)
    span.end()


async def flush_traces(
    tracer: Tracer,
    *,
    endpoint: str | None,
    timeout_ms: int,
    injector: FailureInjector,
) -> dict[str, int | str]:
    """One export tick: drain, deliver once, account for everything.

    The returned report is what the hub turns into counters and (on repeated
    failure) into the TELEMETRY_EXPORT_FAILING alert. Outcomes:

    * ``idle`` - nothing buffered;
    * ``skipped`` - spans exist but no endpoint is configured (they are
      lost; the config is the bug and the counter is the evidence);
    * ``injected`` - the armed fault point consumed this tick;
    * ``ok`` / ``error`` - delivered / delivery failed.
    """
    spans = tracer.drain()
    report: dict[str, int | str] = {"drained": len(spans), "exported": 0, "failed": 0}
    if not spans:
        report["outcome"] = "idle"
        return report
    if injector.consume("trace_export_unavailable"):
        report["failed"] = len(spans)
        report["outcome"] = "injected"
        return report
    if not endpoint:
        report["failed"] = len(spans)
        report["outcome"] = "skipped"
        return report
    payload = otlp_json_encode(spans, resource=tracer.resource)
    url = endpoint.rstrip("/") + EXPORT_PATH
    try:
        async with httpx.AsyncClient(timeout=timeout_ms / 1000.0) as client:
            response = await client.post(
                url,
                content=payload.encode("utf-8"),
                headers={"content-type": "application/json"},
            )
        if response.status_code < 300:
            report["exported"] = len(spans)
            report["outcome"] = "ok"
        else:
            report["failed"] = len(spans)
            report["outcome"] = "error"
            report["status"] = response.status_code
    except httpx.HTTPError:
        # The exception type name only: HTTPError message text can carry the
        # full URL (userinfo included on some transports), and telemetry
        # error paths are exactly where redaction discipline matters.
        report["failed"] = len(spans)
        report["outcome"] = "error"
        report["error"] = "httpx.HTTPError"
    return report


__all__ = [
    "FAILURE_ALERT_THRESHOLD",
    "TRACEPARENT_HEADER",
    "TRACE_ID_RESPONSE_HEADER",
    "TRACESTATE_HEADER",
    "EXPORT_PATH",
    "build_injector",
    "build_tracer",
    "finish_request_span",
    "flush_traces",
    "format_traceparent",
    "response_trace_header",
    "start_request_span",
]
