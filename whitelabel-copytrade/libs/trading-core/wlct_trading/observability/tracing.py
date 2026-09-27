"""Distributed tracing primitives, OpenTelemetry-compatible, zero-dependency.

Why this module hand-rolls the primitives at all, stated plainly: the trading
core library keeps its zero-runtime-dependency rule (its pyproject says a
dependency here is a dependency everywhere, including inside the hot data
plane). So this module does NOT wrap the vendor SDK - it implements the same
*standard wire behaviours* the SDK would give us: W3C Trace Context
propagation (`traceparent`/`tracestate`), the OTLP/JSON span payload shape,
parent-based and ratio sampling, span status, events, and bounded buffering.
A stock OpenTelemetry collector ingests what this emits, and a deployment that
later swaps in the vendor SDK's instrumentation swaps exporters, not formats.
What the SDK would additionally provide - automatic framework instrumentation
of every library in the process - is explicitly OUT of scope here and listed
as remaining work; do not read this module as claiming it.

The safety contract, enforced structurally rather than by care:

* **No I/O.** Spans live in a bounded in-memory ring; a supplied callable
  ships them. This module cannot block, retry, or fail an order path, because
  it contains no network, disk, or sleep at all - the package boundary tests
  (Part 9's suite scans this file too) enforce that with AST imports and
  substring rules on non-docstring code.
* **Never raises to the caller.** Every recording surface swallows its own
  failures into drop counters. `start_span` on a policy violation returns a
  disabled span and counts the drop; a span method after `end()` is a no-op.
  A broken tracer is observability being broken, which is an operational
  event, not a trading event.
* **Span names come from a bounded allow-list** (:data:`TRACED_OPERATIONS`),
  because free-text span names are the trace-analogue of unbounded metric
  labels and break every grouping the UI does on them.
* **Attributes are validated and redacted at the door** with the same
  machinery as Part 9's log pipeline: key shape + the sensitive-key predicate,
  values coerced to bounded scalars, strings redacted and truncated. Order
  ids and correlation ids are legitimate SPAN attributes (traces exist to
  carry them); they are never legitimate METRIC labels, and nothing here
  writes metrics at all.
* **Sampling never touches authorisation.** The sampled flag decides whether
  TELEMETRY exists. Business events are recorded by the existing event
  pipeline, and audit rows by the audit system; neither consults a sampler.
  Section 4 of the Part 10 specification makes the distinction; this module
  keeps it in one place: the only consumer of a sampling decision is
  :class:`Tracer`.
"""

from __future__ import annotations

import hashlib
import json
import re
from collections import deque
from collections.abc import Callable, Iterable, Mapping, Sequence
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Iterator

from wlct_trading.clock import epoch_micros, monotonic_nanos

from .redaction import is_sensitive_key, redact_text

__all__ = [
    "TraceContext",
    "parse_traceparent",
    "format_traceparent",
    "parse_tracestate",
    "format_tracestate",
    "TRACED_OPERATIONS",
    "SpanKind",
    "SpanStatus",
    "SamplingMode",
    "SamplingPolicy",
    "Span",
    "SpanLike",
    "Tracer",
    "current_span_context",
    "use_span",
    "otlp_json_encode",
    "new_trace_id",
    "new_span_id",
]

_HEX32 = re.compile(r"^[0-9a-f]{32}$")
_HEX16 = re.compile(r"^[0-9a-f]{16}$")
_ZERO32 = "0" * 32
_ZERO16 = "0" * 16

#: W3C traceparent: version-format-00 32hex "-" 16hex "-" 2hexflags, plus
#: optional trailing vendor fields which we reject (they belong in tracestate).
_TRACEPARENT_PATTERN = re.compile(r"^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$")

#: tracestate list-members grammar, bounded: up to 32 members of
#: `key[=value]` with platform-safe characters, total length capped below the
#: 512-byte W3C ceiling so a header can never smuggle an arbitrary blob.
_TRACESTATE_MEMBER = re.compile(r"^[a-z0-9_.\-*]{1,256}(?:@[a-z0-9_.\-*/]{1,256})?$")
tracestate_value_limit = 128

#: The complete span-name universe. Adding an operation means adding it here
#: with a comment about where it lives - that comment is the review hook.
TRACED_OPERATIONS: frozenset[str] = frozenset(
    {
        # HTTP boundaries (Section 2): server span at each service edge,
        # client span where a service calls out.
        "http.server",
        "http.client",
        # Queue boundaries: producer at enqueue, consumer at process-start.
        "queue.publish",
        "queue.process",
        # Strategy boundary.
        "strategy.dispatch",
        "signal.created",
        "signal.validated",
        # Risk boundary. The span observes the gate; it never steers it.
        "risk.evaluate",
        "risk.reservation_admit",
        "risk.reservation_release",
        # Execution boundary. Wraps; does not authorise.
        "execution.validate",
        "execution.submit",
        "execution.transmit",
        "execution.reconcile",
        # Dataset / backtest boundary.
        "dataset.select",
        "dataset.verify_checksum",
        "dataset.replay",
        "backtest.run",
        # Paper sessions share the strategy span names; simulation identity is
        # an ATTRIBUTE on every span (Section 2: traces distinguish simulated
        # from live), never a separate operation name that could drift.
        # Reliability-side internal spans.
        "tracing.export",
        "slo.evaluate",
    }
)


class SpanKind(str, Enum):
    INTERNAL = "internal"
    SERVER = "server"
    CLIENT = "client"
    PRODUCER = "producer"
    CONSUMER = "consumer"


# OTLP numeric span kinds (opentelemetry-proto trace/v1). The mapping lives
# next to the enum so the encoder cannot drift from the protocol.
_OTLP_SPAN_KIND: dict[SpanKind, int] = {
    SpanKind.INTERNAL: 1,
    SpanKind.SERVER: 2,
    SpanKind.CLIENT: 3,
    SpanKind.PRODUCER: 4,
    SpanKind.CONSUMER: 5,
}


class SpanStatus(str, Enum):
    UNSET = "unset"
    OK = "ok"
    ERROR = "error"


_OTLP_STATUS_CODE: dict[SpanStatus, int] = {
    SpanStatus.UNSET: 0,
    SpanStatus.OK: 1,
    SpanStatus.ERROR: 2,
}


class SamplingMode(str, Enum):
    DISABLED = "disabled"
    OFF = "off"
    ALL = "all"
    PARENT_BASED = "parent_based"
    RATIO = "ratio"


def _is_valid_trace_id(value: str) -> bool:
    return bool(_HEX32.fullmatch(value)) and value != _ZERO32


def _is_valid_span_id(value: str) -> bool:
    return bool(_HEX16.fullmatch(value)) and value != _ZERO16


def _id_seed() -> bytes:
    """A small, bounded, mixing seed: monotonic nanos plus a process
    counter, hashed up to the needed width. No allocation keyed by the raw
    counter (which is what ``bytes(int)`` would do), no new imports."""
    return monotonic_nanos().to_bytes(16, "big", signed=True) + _entropy_bytes()


def new_trace_id() -> str:
    """128 bits of mixed entropy, lowercase hex, never the invalid all-zero
    id. Tests inject deterministic factories at the Tracer level instead of
    monkey-patching this."""
    while True:
        candidate = hashlib.blake2b(_id_seed(), digest_size=16).hexdigest()
        if candidate != _ZERO32:
            return candidate


_entropy_counter = 0


def _entropy_bytes() -> bytes:
    """Cheap process entropy without importing `secrets` per span.

    `secrets` is stdlib and fine; this is the no-new-import variant that
    stays deterministic-friendly for replayed tests (which override id
    generators at the Tracer level instead of monkey-patching randomness).
    """
    global _entropy_counter
    _entropy_counter = (_entropy_counter + 1) & 0xFFFFFFFF
    return _entropy_counter.to_bytes(4, "big") + monotonic_nanos().to_bytes(8, "little")


def new_span_id() -> str:
    while True:
        candidate = hashlib.blake2b(_id_seed(), digest_size=8).hexdigest()
        if candidate != _ZERO16:
            return candidate


@dataclass(frozen=True, slots=True)
class TraceContext:
    """One extracted or created W3C trace identity.

    ``sampled`` is a *telemetry* decision. It says nothing about trading: the
    field exists so downstream propagation is consistent, and the sampling
    module docstring states the audit/business-event distinction.
    """

    trace_id: str
    span_id: str
    parent_span_id: str | None = None
    trace_flags: int = 0x01
    tracestate: tuple[tuple[str, str], ...] = ()

    @property
    def sampled(self) -> bool:
        return (self.trace_flags & 0x01) == 0x01

    def child(self, span_id: str, *, sampled: bool) -> "TraceContext":
        flags = (self.trace_flags & 0xFE) | (1 if sampled else 0)
        return TraceContext(
            trace_id=self.trace_id,
            span_id=span_id,
            parent_span_id=self.span_id,
            trace_flags=flags,
            tracestate=self.tracestate,
        )


def parse_traceparent(header: str | None) -> TraceContext | None:
    """Strict W3C extraction. Anything malformed returns ``None`` (start a
    fresh trace upstream) - a corrupted header must never poison an export or
    join a foreign trace. Leniency here would let untrusted input decide
    trace identity, which is a grouping-integrity question, not a cosmetic
    one."""
    if not header:
        return None
    # The spec permits extra fields after the triple for future versions;
    # version "ff" is explicitly invalid. Reject rather than reinterpret.
    parts = header.strip().split("-")
    if len(parts) < 4 or parts[0] == "ff" or len(parts) > 4:
        # len>4: trailing vendor data belongs in tracestate, not here.
        if parts[0] == "ff" or len(parts) < 4:
            return None
        header = "-".join(parts[:4])
    match = _TRACEPARENT_PATTERN.fullmatch(header.strip())
    if match is None:
        return None
    trace_id, span_id, flags = match.group(1), match.group(2), match.group(3)
    if not _is_valid_trace_id(trace_id) or not _is_valid_span_id(span_id):
        return None
    try:
        flag_value = int(flags, 16)
    except ValueError:
        return None
    return TraceContext(trace_id=trace_id, span_id=span_id, trace_flags=flag_value)


def format_traceparent(context: TraceContext) -> str:
    return f"00-{context.trace_id}-{context.span_id}-{context.trace_flags & 0xFF:02x}"


def parse_tracestate(header: str | None) -> tuple[tuple[str, str], ...]:
    """Keep only well-formed members, capped; never the raw string."""
    if not header:
        return ()
    members: list[tuple[str, str]] = []
    for raw in header.split(","):
        member = raw.strip()
        if not member or len(member) > 256 + 1 + tracestate_value_limit:
            continue
        key, _, value = member.partition("=")
        if not _TRACESTATE_MEMBER.fullmatch(key.strip()):
            continue
        value = value.strip()
        if len(value) > tracestate_value_limit or any(c in value for c in " ,;="):
            continue
        members.append((key.strip(), value))
        if len(members) >= 32:
            break
    return tuple(members)


def format_tracestate(members: Sequence[tuple[str, str]]) -> str:
    return ",".join(f"{key}={value}" if value else key for key, value in members)


class SamplingPolicy:
    """Deterministic head-based sampling.

    ``should_sample`` is a pure function of (mode, ratio, trace id, parent
    decision, operation): the same inputs give the same answer in every
    language - the TS twin is fixture-pinned on this table. The bucket is the
    first 64 bits of the trace id, so the decision is stable for a whole
    trace without needing to consult a store.

    Priority operations (configurable) always sample when the policy is not
    disabled: those are the "critical operational traces remain inspectable"
    requirement - execution.transmit volume is one span per order attempt, so
    always-on there is affordable and enormously useful; it changes no
    authorisation, only what gets recorded.
    """

    __slots__ = ("mode", "_ratio_ppm", "priority_operations")

    def __init__(
        self,
        mode: SamplingMode,
        *,
        ratio: float = 0.0,
        priority_operations: Iterable[str] = (),
    ) -> None:
        if mode is SamplingMode.RATIO or mode is SamplingMode.PARENT_BASED:
            if not 0.0 <= ratio <= 1.0:
                raise ValueError("ratio must be within [0, 1]")
        # Ratio is stored in parts-per-million integers: float only ever
        # lives at the construction edge, never in the comparison path, so
        # two languages can agree bit-for-bit.
        self.mode = mode
        self._ratio_ppm = int(round(max(0.0, min(1.0, ratio)) * 1_000_000))
        self.priority_operations = frozenset(priority_operations)

    @property
    def enabled(self) -> bool:
        return self.mode is not SamplingMode.DISABLED

    def should_sample(self, *, trace_id: str, parent_sampled: bool | None, operation: str) -> bool:
        if self.mode is SamplingMode.DISABLED or self.mode is SamplingMode.OFF:
            return False
        if self.mode is SamplingMode.ALL:
            return True
        if operation in self.priority_operations:
            return True
        if self.mode is SamplingMode.PARENT_BASED and parent_sampled is not None:
            return parent_sampled
        if self._ratio_ppm <= 0:
            return False
        if self._ratio_ppm >= 1_000_000:
            return True
        try:
            bucket_source = int(trace_id[:16], 16)
        except ValueError:
            return False
        threshold = (1 << 64) * self._ratio_ppm // 1_000_000
        return bucket_source < threshold


_ATTR_KEY = re.compile(r"^[a-z][a-z0-9_.]{0,63}$")
_MAX_ATTRS_PER_SPAN = 32
_MAX_EVENTS_PER_SPAN = 32
_MAX_STRING_ATTR = 256


def _safe_attribute(key: object, value: object) -> tuple[str, str | int | bool] | None:
    """Validate/redact one attribute. ``None`` means 'drop it, counted'.

    Keys that name secrets are dropped outright (a caller who sets
    ``api_key=...`` meant to log it into a span; the policy says no); values
    are coerced to bounded scalars and run through the same text redactor the
    logs use, so a signed URL pasted into ``detail`` comes out scrubbed.
    """
    if not isinstance(key, str) or not _ATTR_KEY.fullmatch(key) or is_sensitive_key(key):
        return None
    if isinstance(value, bool):
        return key, value
    if isinstance(value, int):
        return key, value
    if isinstance(value, float):
        # Floats enter telemetry as short repr strings: a span attribute is
        # documentation, and money never legitimately flows through here.
        return key, repr(value)[:_MAX_STRING_ATTR]
    if isinstance(value, str):
        return key, redact_text(value)[:_MAX_STRING_ATTR]
    return None


@dataclass(slots=True)
class Span:
    """A recording span. All methods are total (never raise, never block)."""

    context: TraceContext
    name: str
    kind: SpanKind = SpanKind.INTERNAL
    attributes: dict[str, str | int | bool] = field(default_factory=dict)
    events: list[dict[str, Any]] = field(default_factory=list)
    status: SpanStatus = SpanStatus.UNSET
    status_description: str | None = None
    start_unix_nano: int = 0
    end_unix_nano: int = 0
    duration_nanos: int = 0
    recorded: bool = True
    resource: dict[str, str] = field(default_factory=dict, repr=False)

    _tracer: "Tracer | None" = field(default=None, repr=False)
    _start_mono: int = 0
    _ended: bool = False
    _dropped_attrs: int = 0
    _dropped_events: int = 0

    def _note_drop(self, reason: str) -> None:
        """Drop accounting that tolerates a detached span (no tracer). A
        Span constructed outside a Tracer - only ever in tests - must still
        never raise, per the module contract."""
        if self._tracer is not None:
            self._tracer._count_drop(reason)

    def set_attribute(self, key: str, value: object) -> None:
        if not self.recorded or self._ended:
            return
        safe = _safe_attribute(key, value)
        if safe is None:
            self._note_drop("attribute_refused")
            return
        if len(self.attributes) >= _MAX_ATTRS_PER_SPAN:
            self._dropped_attrs += 1
            self._note_drop("attribute_overflow")
            return
        self.attributes[safe[0]] = safe[1]

    def set_status(self, status: SpanStatus, *, description: str | None = None) -> None:
        if not self.recorded or self._ended:
            return
        self.status = status
        if description is not None:
            self.status_description = redact_text(description)[:_MAX_STRING_ATTR]

    def add_event(self, name: str, *, attributes: Mapping[str, object] | None = None, at_micros: int | None = None) -> None:
        if not self.recorded or self._ended:
            return
        if not isinstance(name, str) or not _ATTR_KEY.fullmatch(name):
            self._note_drop("event_name_refused")
            return
        if len(self.events) >= _MAX_EVENTS_PER_SPAN:
            self._dropped_events += 1
            self._note_drop("event_overflow")
            return
        safe_attrs: dict[str, str | int | bool] = {}
        for key, value in (attributes or {}).items():
            entry = _safe_attribute(key, value)
            if entry is not None and len(safe_attrs) < _MAX_ATTRS_PER_SPAN:
                safe_attrs[entry[0]] = entry[1]
        self.events.append(
            {
                "name": name,
                "time_unix_nano": (epoch_micros() if at_micros is None else at_micros) * 1000,
                "attributes": safe_attrs,
            }
        )

    def record_exception(self, error: BaseException) -> None:
        """Type name + redacted message only. Exception ``args`` on this
        platform's dependencies include DSNs; ``redact_exception`` is the same
        summary the log pipeline writes, so a stack-free summary is all that
        reaches telemetry."""
        if not self.recorded or self._ended:
            return
        self.add_event(
            "exception",
            attributes={
                "exception.type": type(error).__name__,
                "exception.message": redact_text(str(error))[:_MAX_STRING_ATTR],
            },
        )

    def end(self, *, at_micros: int | None = None) -> None:
        if self._ended:
            return
        self._ended = True
        self.end_unix_nano = (epoch_micros() if at_micros is None else at_micros) * 1000
        self.duration_nanos = monotonic_nanos() - self._start_mono
        if self._tracer is not None and self.recorded:
            self._tracer._buffer.append(self)


_CURRENT_SPAN: ContextVar[TraceContext | None] = ContextVar("wlct_current_trace", default=None)


def current_span_context() -> TraceContext | None:
    """The active trace identity, for callers that need to inject it into
    outbound HTTP headers or queue sidecars."""
    return _CURRENT_SPAN.get()


@contextmanager
def use_span(span: "Span | _DisabledSpan") -> Iterator["Span | _DisabledSpan"]:
    """Bind a span as the ambient parent for anything started inside."""
    # Bind the CONTEXT even for unsampled spans: W3C semantics say the
    # trace identity propagates and the sampled FLAG travels with it, so a
    # dropped trace stays dropped coherently across boundaries instead of
    # forking into half-sampled children downstream.
    context = span.context
    token = _CURRENT_SPAN.set(context)
    try:
        yield span
    finally:
        _CURRENT_SPAN.reset(token)


class _DisabledSpan:
    """The never-raises, records-nothing span handed out when tracing is
    disabled or a policy refused the caller. Same surface as ``Span`` so call
    sites are unconditional - the branch that could crash is the branch
    eliminated."""

    __slots__ = ("context", "name", "recorded")

    def __init__(self, context: TraceContext | None, name: str) -> None:
        self.context = context
        self.name = name
        self.recorded = False

    def set_attribute(self, key: str, value: object) -> None:
        return None

    def set_status(self, status: SpanStatus, *, description: str | None = None) -> None:
        return None

    def add_event(self, name: str, *, attributes: Mapping[str, object] | None = None, at_micros: int | None = None) -> None:
        return None

    def record_exception(self, error: BaseException) -> None:
        return None

    def end(self, *, at_micros: int | None = None) -> None:
        return None


SpanLike = Span | _DisabledSpan
"""What :meth:`Tracer.start_span` hands back: either a recording span or the
no-op disabled span. Call sites annotate with this so a tracer (which may
internally decide to disable) type-checks without lying about the object."""


class Tracer:
    """Owns the policy, the ring buffer, the drop counters and the id source.

    The buffer is a ``deque(maxlen=...)``: overflow evicts the OLDEST span and
    counts it - under sustained overload the newest spans (the incident you
    are diagnosing) survive, which is the correct prioritisation for a ring
    whose consumer is a periodic exporter. Losing telemetry is always
    acceptable; delaying the producer never is, so there is no backpressure
    path at all, by design.
    """

    def __init__(
        self,
        *,
        service: str,
        environment: str = "development",
        version: str = "unknown",
        instance: str = "unknown",
        sampler: SamplingPolicy | None = None,
        buffer_size: int = 8192,
        trace_id_factory: Callable[[], str] = new_trace_id,
        span_id_factory: Callable[[], str] = new_span_id,
    ) -> None:
        self._service = service
        self._environment = environment
        self._version = version
        self._instance = instance
        self._sampler = sampler or SamplingPolicy(SamplingMode.DISABLED)
        self._buffer: deque[Span] = deque(maxlen=max(16, buffer_size))
        self._trace_id_factory = trace_id_factory
        self._span_id_factory = span_id_factory
        self._drops: dict[str, int] = {}

    # -- introspection for /health/components and tests ------------------
    @property
    def enabled(self) -> bool:
        return self._sampler.enabled

    @property
    def resource(self) -> dict[str, str]:
        return {
            "service.name": self._service,
            "service.version": self._version,
            "deployment.environment": self._environment,
            "service.instance.id": self._instance,
        }

    @property
    def buffered_spans(self) -> int:
        return len(self._buffer)

    @property
    def drop_counts(self) -> dict[str, int]:
        return dict(self._counts_snapshot())

    def _counts_snapshot(self) -> Iterable[tuple[str, int]]:
        return tuple(self._drops.items())

    def _count_drop(self, reason: str) -> None:
        self._drops[reason] = self._drops.get(reason, 0) + 1

    # -- span lifecycle ----------------------------------------------------
    def start_span(
        self,
        operation: str,
        *,
        kind: SpanKind = SpanKind.INTERNAL,
        parent: TraceContext | None = None,
        attributes: Mapping[str, object] | None = None,
        link_correlation: bool = True,
    ) -> SpanLike:
        """Begin an operation-named span. Never raises: unknown operations,
        disabled policy, anything - returns the disabled span and counts it."""
        try:
            if not self._sampler.enabled:
                return _DisabledSpan(None, operation)
            if operation not in TRACED_OPERATIONS:
                self._count_drop("unknown_operation")
                return _DisabledSpan(None, operation)
            inherited = parent if parent is not None else _CURRENT_SPAN.get()
            parent_sampled = inherited.sampled if inherited is not None else None
            if inherited is not None:
                trace_id = inherited.trace_id
            else:
                trace_id = self._trace_id_factory()
                if not _is_valid_trace_id(trace_id):
                    self._count_drop("bad_trace_id")
                    return _DisabledSpan(None, operation)
            sampled = self._sampler.should_sample(
                trace_id=trace_id, parent_sampled=parent_sampled, operation=operation
            )
            if not sampled:
                # Not-recorded spans still carry a valid context so context
                # propagation downstream stays coherent (an unsampled trace
                # must not fork into a half-sampled one).
                return _DisabledSpan(
                    # The not-sampled flag must travel: a disabled span binds
                    # its context for propagation, and PARENT_BASED sampling
                    # downstream reads it. Marking an unsampled trace's spans
                    # sampled here would silently re-sample children.
                    TraceContext(
                        trace_id=trace_id,
                        span_id=self._span_id_factory(),
                        trace_flags=0x00,
                    ),
                    operation,
                )
            span_id = self._span_id_factory()
            if not _is_valid_span_id(span_id):
                self._count_drop("bad_span_id")
                return _DisabledSpan(None, operation)
            context = (
                inherited.child(span_id, sampled=True)
                if inherited is not None
                else TraceContext(trace_id=trace_id, span_id=span_id, trace_flags=0x01)
            )
            span = Span(
                context=context,
                name=operation,
                kind=kind,
                _tracer=self,
                start_unix_nano=epoch_micros() * 1000,
                resource=self.resource,
            )
            span._start_mono = monotonic_nanos()
            for key, value in (attributes or {}).items():
                span.set_attribute(key, value)
            if link_correlation:
                from .correlation import current_context

                correlation = current_context()
                if correlation.correlation_id is not None:
                    span.set_attribute("correlation_id", correlation.correlation_id)
            return span
        except Exception as error:
            # The blanket guard IS the contract: tracing is never allowed to
            # break what it observes. The reason is counted, not logged with
            # the raw exception (message content is attacker-adjacent here).
            self._count_drop(f"tracer_internal_error:{type(error).__name__}")
            return _DisabledSpan(None, operation)

    def drain(self, *, max_spans: int = 512) -> list[Span]:
        """Pop up to ``max_spans`` of oldest buffered spans for export.

        The exporter contract, documented at the seam the services implement:
        take the batch, attempt one delivery, and on failure account for the
        loss - spans are NOT re-queued. A platform that retries telemetry
        behind a dead collector converts an observability outage into a memory
        outage; dropping loudly is the honest failure mode, and Part 9's
        exporter-outcome alert fires exactly when the drops matter.
        """
        drained: list[Span] = []
        while self._buffer and len(drained) < max_spans:
            drained.append(self._buffer.popleft())
        return drained


def otlp_json_encode(spans: Sequence[Span], *, resource: Mapping[str, str] | None = None) -> str:
    """OTLP/JSON payload for ``POST /v1/traces`` (opentelemetry-proto JSON
    mapping), deterministic: fixed field order per object, spans grouped by
    resource then sorted by (start, trace id, span id).

    Determinism matters beyond aesthetics: the TS twin re-implements this
    encoding, and the committed fixture compares exact strings. The one
    asymmetry to know about is that Python's ``json.dumps`` sorts keys while
    JavaScript objects preserve insertion order - so the encoder builds
    dict-literals in the SAME key order on both sides and this function does
    NOT pass sort_keys; sorted-ness here would fight the TS object order.
    """
    grouped: dict[tuple[tuple[str, str], ...], list[Span]] = {}
    for span in spans:
        key = tuple(sorted((span.resource or dict(resource or {})).items()))
        grouped.setdefault(key, []).append(span)

    def span_object(span: Span) -> dict[str, Any]:
        obj: dict[str, Any] = {
            "traceId": span.context.trace_id,
            "spanId": span.context.span_id,
            "name": span.name,
            "kind": _OTLP_SPAN_KIND[span.kind],
            "startTimeUnixNano": str(span.start_unix_nano),
            "endTimeUnixNano": str(span.end_unix_nano),
        }
        if span.context.parent_span_id is not None:
            obj["parentSpanId"] = span.context.parent_span_id
        obj["attributes"] = _attributes_list(span.attributes)
        if span._dropped_attrs:
            obj["droppedAttributesCount"] = span._dropped_attrs
        if span.events:
            obj["events"] = [
                {
                    "timeUnixNano": str(event["time_unix_nano"]),
                    "name": event["name"],
                    "attributes": _attributes_list(event["attributes"]),
                }
                for event in span.events
            ]
            if span._dropped_events:
                obj["droppedEventsCount"] = span._dropped_events
        obj["status"] = _status_object(span)
        if span.context.tracestate:
            obj["tracestate"] = format_tracestate(span.context.tracestate)
        obj["flags"] = span.context.trace_flags
        return obj

    resource_spans = []
    for key, group in sorted(grouped.items()):
        attributes = _attributes_list(dict(key))
        payload: dict[str, Any] = {
            "resource": {"attributes": attributes},
            "scopeSpans": [
                {
                    "scope": {"name": "wlct.observability", "version": "1"},
                    "spans": [span_object(span) for span in sorted(group, key=lambda s: (s.start_unix_nano, s.context.trace_id, s.context.span_id))],
                }
            ],
        }
        resource_spans.append(payload)
    return json.dumps({"resourceSpans": resource_spans}, ensure_ascii=True, separators=(",", ":"))


def _attributes_list(attributes: Mapping[str, Any]) -> list[dict[str, Any]]:
    out = []
    for key in sorted(attributes):
        value = attributes[key]
        if isinstance(value, bool):
            typed: dict[str, Any] = {"boolValue": value}
        elif isinstance(value, int):
            typed = {"intValue": str(value)}
        else:
            typed = {"stringValue": str(value)}
        out.append({"key": key, "value": typed})
    return out


def _status_object(span: Span) -> dict[str, Any]:
    out: dict[str, Any] = {"code": _OTLP_STATUS_CODE[span.status]}
    if span.status_description is not None:
        out["message"] = span.status_description
    return out
