"""Platform observability: metrics exposition, health, readiness, alerts,
incidents, correlation and redaction - one package, no competing systems.

What belongs here
-----------------
The *publication* layer over measurements that already exist in
:mod:`wlct_trading.metrics` (transport, execution, strategy, dataset and
risk registries from Parts 2-8). This package renders them, guards their
cardinality, attaches them to the health model, folds operational faults
into alerts, and ties incidents to the correlation context.

What deliberately does NOT belong here
-------------------------------------
Enforcement of anything. The authority on whether an order may proceed is
the risk gate (``wlct_trading.risk``); the authority on credentials and
orders is the execution path. No module in this package may import those -
a package-boundary test enforces it, because an "observability" component
that can reach the trading path is a bypass discovered during an outage
instead of before one. Health and readiness *describe*; the gate *decides*.

The pieces:

* :mod:`~wlct_trading.observability.labels` - the metric label policy;
* :mod:`~wlct_trading.observability.metrics` - the exposition registry,
  pipeline stage timing, process sampling, Prometheus text rendering;
* :mod:`~wlct_trading.observability.health` - component statuses and probes;
* :mod:`~wlct_trading.observability.readiness` - the trading-readiness
  verdict, distinct from API readiness, fail-closed on missing evidence;
* :mod:`~wlct_trading.observability.correlation` - the ids that must travel;
* :mod:`~wlct_trading.observability.alerts` - the rule catalog, dedupe
  engine and state machine;
* :mod:`~wlct_trading.observability.incidents` - grouping correlated
  evidence without owning it;
* :mod:`~wlct_trading.observability.redaction` - the platform redactor;
* :mod:`~wlct_trading.observability.dashboard` - the derived panel document;
* :mod:`~wlct_trading.observability.faults` - the closed-universe failure
  injector for reliability tests (Part 10);
* :mod:`~wlct_trading.observability.tracing` - W3C/OTLP-compatible tracing
  primitives, sampling policy and the bounded span buffer (Part 10).
"""

from __future__ import annotations

from .alerts import (
    ALERT_RULES,
    AlertEngine,
    AlertObservation,
    AlertRecord,
    AlertRule,
    AlertSeverity,
    AlertState,
    rule_for,
)
from .correlation import (
    CORRELATION_FIELDS,
    CorrelationContext,
    LoggingCorrelationFilter,
    bind,
    current_context,
    from_queue_payload,
    to_log_fields,
)
from .dashboard import SECTIONS, DashboardBuilder, DashboardRow
from .health import (
    ComponentHealth,
    ComponentStatus,
    HealthProvider,
    HealthRegistry,
    worst_status,
)
from .incidents import (
    IncidentContext,
    IncidentLink,
    IncidentLinkKind,
    IncidentStatus,
    build_incident,
    links_from_events,
)
from .labels import (
    ALLOWED_LABEL_NAMES,
    FORBIDDEN_LABEL_NAMES,
    CardinalityError,
    LabelPolicy,
    label_value_ok,
    metric_name_ok,
)
from .metrics import (
    DEFAULT_MICROS_BUCKETS,
    PIPELINE_STAGES,
    PIPELINE_TRANSITIONS,
    MetricType,
    ObservabilityRegistry,
    PipelineSpan,
    observe_latency_histogram,
    pipeline_stage,
    render_health_metrics,
    render_prometheus,
    sample_process,
)
from .readiness import (
    TRADING_GATES,
    GateEvidence,
    GateVerdict,
    TradingReadinessVerdict,
    evaluate_trading_readiness,
)
from .redaction import (
    REDACTED,
    is_sensitive_key,
    redact_exception,
    redact_mapping,
    redact_text,
    redact_value,
)
from .faults import FAULT_POINTS, FailureInjector, FaultSpec, disabled_injector
from .tracing import (
    TRACED_OPERATIONS,
    SamplingMode,
    SamplingPolicy,
    Span,
    SpanKind,
    SpanStatus,
    TraceContext,
    Tracer,
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

__all__ = [
    # labels
    "ALLOWED_LABEL_NAMES",
    "FORBIDDEN_LABEL_NAMES",
    "CardinalityError",
    "LabelPolicy",
    "label_value_ok",
    "metric_name_ok",
    # metrics
    "DEFAULT_MICROS_BUCKETS",
    "PIPELINE_STAGES",
    "PIPELINE_TRANSITIONS",
    "MetricType",
    "ObservabilityRegistry",
    "PipelineSpan",
    "observe_latency_histogram",
    "pipeline_stage",
    "render_health_metrics",
    "render_prometheus",
    "sample_process",
    # health
    "ComponentHealth",
    "ComponentStatus",
    "HealthProvider",
    "HealthRegistry",
    "worst_status",
    # readiness
    "TRADING_GATES",
    "GateEvidence",
    "GateVerdict",
    "TradingReadinessVerdict",
    "evaluate_trading_readiness",
    # correlation
    "CORRELATION_FIELDS",
    "CorrelationContext",
    "LoggingCorrelationFilter",
    "bind",
    "current_context",
    "from_queue_payload",
    "to_log_fields",
    # alerts
    "ALERT_RULES",
    "AlertEngine",
    "AlertObservation",
    "AlertRecord",
    "AlertRule",
    "AlertSeverity",
    "AlertState",
    "rule_for",
    # incidents
    "IncidentContext",
    "IncidentLink",
    "IncidentLinkKind",
    "IncidentStatus",
    "build_incident",
    "links_from_events",
    # redaction
    "REDACTED",
    "is_sensitive_key",
    "redact_exception",
    "redact_mapping",
    "redact_text",
    "redact_value",
    # dashboard
    "SECTIONS",
    "DashboardBuilder",
    "DashboardRow",
    # faults (Part 10)
    "FAULT_POINTS",
    "FailureInjector",
    "FaultSpec",
    "disabled_injector",
    # tracing (Part 10)
    "TRACED_OPERATIONS",
    "SamplingMode",
    "SamplingPolicy",
    "Span",
    "SpanKind",
    "SpanStatus",
    "TraceContext",
    "Tracer",
    "current_span_context",
    "format_traceparent",
    "format_tracestate",
    "new_span_id",
    "new_trace_id",
    "otlp_json_encode",
    "parse_traceparent",
    "parse_tracestate",
    "use_span",
]
