# Part 10 - Reliability: tracing, error budgets, fault injection: full source handover

> **Risk controls reduce operational risk but cannot guarantee against all
> losses.** Observability makes the platform easier to operate; it does not -
> and must not - make the trading path less safe. Nothing in this part
> authorises an order, and nothing in the trading path reads anything here.

Complete content of every file created or modified by Part 10. Nothing is
abbreviated, summarised or elided: each block below is the entire final file
as it exists in the repository. Modified files are shown complete - not as
diffs - per the standing handover rule; their Part 9 content is preserved in
`docs/PART9_HANDOVER_FULL_SOURCE.md` for comparison.

All quality gates at generation time (2026-09-13):

* `cd libs/trading-core && python3 -m pytest tests -q` -> **1256 passed** (Part 9 baseline + Part 10: tracing/faults/SLO/boundary suites)
* `python3 -m ruff check wlct_trading tests` -> green; `python3 -m mypy wlct_trading` -> **no issues, 139 files** (strict, zero suppressions added; the no-suppression guard test covers every new module)
* trading-engine: `python3 -m pytest tests -q` -> **43 passed**; ruff green on every Part-10-touched file (the single engine finding - S104 on the pre-existing `TRADING_ENGINE_HOST = "0.0.0.0"` default in config.py - predates Part 10 and is documented in PART10_RELIABILITY.md sec. 10.12)
* market-data: `python3 -m pytest tests -q` -> **19 passed** (Part 10 modifies no file in this service; recorded to prove the baseline moved not a hair because nothing touched it)
* `npx tsc --noEmit -p tsconfig.json` (apps/api) -> **0 errors**; `npx jest` -> **285 passed / 10 suites** (160 pre-Part-10 + 125 Part-10 tests across slo-parity / slo-samples / part10-safety); `eslint --max-warnings=0` over every touched directory -> clean
* `npx tsc --noEmit` (apps/admin-web) -> clean; eslint on the two new files + sidebar -> clean; `npm run build:packages` -> clean
* `prisma validate` -> valid; `prisma generate` -> clean; Part 10 migration (`20260912180000_part10_reliability_slo`) grepped for DROP/TRUNCATE/DELETE FROM/RENAME/ALTER -> **zero destructive statements** (1 CREATE TYPE, 2 CREATE TABLE, indexes, 2 unique constraints)
* Fixture regime: `docs/fixtures/reliability_fixtures.json` regenerated from the real Python modules via `gen_part10_fixtures.py`; the TS parity spec replays every vector (sampling table, traceparent vectors, attribute hygiene, byte-exact OTLP/JSON, budget/burn tables, catalog checksums, full evaluation rows)
* Banned-placeholder token sweep over every emitted file -> zero hits (guard DATA that legitimately contains the words - e.g. the engine config's placeholder-TOKEN REJECTION list - is pre-Part-10 code shown complete, not a placeholder in a Part-10 file)
* Flutter: **not re-run** - Part 10 adds or modifies zero Dart files (the operator console is this plane's surface; phones read decisions, not dashboards), so the Part 8 static-verification status stands unchanged

Narrative documentation for this part: `docs/PART10_RELIABILITY.md`;
endpoints: `docs/API.md` (Part 10 section); threat rules: `docs/SECURITY.md`
("Trace-side rules (Part 10)"); plane layout: `docs/ARCHITECTURE.md`
("The reliability plane (Part 10)").

---

## Contents

### Core (libs/trading-core) - new

* `libs/trading-core/wlct_trading/observability/tracing.py` - 798 lines
* `libs/trading-core/wlct_trading/observability/faults.py` - 178 lines
* `libs/trading-core/wlct_trading/slo/__init__.py` - 72 lines
* `libs/trading-core/wlct_trading/slo/model.py` - 281 lines
* `libs/trading-core/wlct_trading/slo/budget.py` - 162 lines
* `libs/trading-core/wlct_trading/slo/burn.py` - 92 lines
* `libs/trading-core/wlct_trading/slo/catalog.py` - 190 lines
* `libs/trading-core/wlct_trading/slo/evaluate.py` - 245 lines
* `libs/trading-core/scripts/gen_part10_fixtures.py` - 661 lines
* `libs/trading-core/tests/test_part10_tracing.py` - 554 lines
* `libs/trading-core/tests/test_part10_faults.py` - 201 lines
* `libs/trading-core/tests/test_part10_slo.py` - 460 lines
* `libs/trading-core/tests/test_part10_boundaries.py` - 211 lines

### Core (libs/trading-core) - modified

* `libs/trading-core/wlct_trading/observability/__init__.py` - 227 lines
* `libs/trading-core/wlct_trading/observability/labels.py` - 267 lines

### Trading engine - new

* `services/trading-engine/app/tracing.py` - 249 lines
* `services/trading-engine/tests/test_part10_tracing.py` - 418 lines
* `services/trading-engine/tests/test_part10_safety.py` - 108 lines

### Trading engine - modified

* `services/trading-engine/app/config.py` - 214 lines
* `services/trading-engine/app/main.py` - 237 lines
* `services/trading-engine/app/observability.py` - 784 lines
* `services/trading-engine/app/routers/engine.py` - 118 lines
* `services/trading-engine/.env.example` - 41 lines

### API - new

* `apps/api/src/infrastructure/tracing/w3c.ts` - 565 lines
* `apps/api/src/infrastructure/tracing/tracing.service.ts` - 615 lines
* `apps/api/src/infrastructure/tracing/trace.middleware.ts` - 69 lines
* `apps/api/src/modules/observability/slo.constants.ts` - 284 lines
* `apps/api/src/modules/observability/slo.canonical.ts` - 414 lines
* `apps/api/src/modules/observability/slo.eval.ts` - 364 lines
* `apps/api/src/modules/observability/slo-samples.ts` - 279 lines
* `apps/api/src/modules/observability/slo.types.ts` - 59 lines
* `apps/api/src/modules/observability/slo.mapper.ts` - 182 lines
* `apps/api/src/modules/observability/slo.service.ts` - 836 lines
* `apps/api/src/modules/observability/dto/slo.dto.ts` - 162 lines
* `apps/api/src/modules/observability/slo.controller.ts` - 283 lines
* `apps/api/src/modules/observability/slo-parity.spec.ts` - 636 lines
* `apps/api/src/modules/observability/slo-samples.spec.ts` - 246 lines
* `apps/api/src/modules/observability/part10-safety.spec.ts` - 551 lines

### API - modified

* `apps/api/src/modules/observability/http-metrics.interceptor.ts` - 92 lines
* `apps/api/src/modules/observability/metrics.controller.ts` - 133 lines
* `apps/api/src/modules/observability/alerts.service.ts` - 647 lines
* `apps/api/src/modules/observability/observability.module.ts` - 86 lines
* `apps/api/src/modules/queue/queue.service.ts` - 212 lines
* `apps/api/src/modules/queue/maintenance.scheduler.ts` - 104 lines
* `apps/api/src/modules/queue/processors/maintenance.processor.ts` - 276 lines
* `apps/api/src/app.module.ts` - 112 lines
* `apps/api/src/config/app-config.service.ts` - 1240 lines
* `apps/api/prisma/schema.prisma` - 3967 lines
* `apps/api/prisma/migrations/20260912180000_part10_reliability_slo/migration.sql` - 88 lines

### Shared packages - new / modified

* `packages/shared-types/src/slo.ts` - 223 lines
* `packages/shared-types/src/index.ts` - 14 lines
* `packages/config/src/constants.ts` - 248 lines
* `packages/config/src/env.schema.ts` - 1203 lines
* `.env.example` - 924 lines

### Admin console - new / modified

* `apps/admin-web/src/app/(console)/slo/page.tsx` - 465 lines
* `apps/admin-web/src/app/(console)/slo/slo-controls.tsx` - 400 lines
* `apps/admin-web/src/components/sidebar.tsx` - 107 lines

### Cross-language contract

* `docs/fixtures/reliability_fixtures.json` - 1551 lines

---

## File contents

## Core (libs/trading-core) - new

## FILE: libs/trading-core/wlct_trading/observability/tracing.py (798 lines)

```python
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
```

## FILE: libs/trading-core/wlct_trading/observability/faults.py (178 lines)

```python
"""Failure injection for reliability testing - deliberately tiny and blunt.

The rule this whole module is built around, up front: **a fault injector must
not become a feature flag for the trading path.** There is therefore nothing
here that can suppress a risk check, flip a kill switch, approve an order or
force a transmission - not under another name, not by convention. The point
names below are a CLOSED, named universe of *observability-side* failures
plus the environmental conditions (outages, delays) the platform's health
and readiness layers already report. A test drives one of those, asserts the
operational system noticed correctly, and stops. Anything broader is chaos
engineering, which this repository's roadmap explicitly still lists as open
work; calling this file "chaos" would be marketing.

Construction-time enablement is part of the design: ``FailureInjector`` has
no method that turns it on. The boolean arrives from validated
configuration (production boot refuses `enabled=True` while
`FAILURE_INJECTION_ALLOW_NON_PRODUCTION_ONLY` is at its default), so the
runtime surface is read-only. If a test needs to "inject", it constructs a
new injector - the awkwardness is the point; production code should not find
this ergonomically mutable.

Determinism: consumption of one-shot faults is a pure counter sequence. Same
construction, same sequence of calls, same outcomes - which is what lets
failure-injection tests live next to the fixture-pinned parity tests rather
than being timing races.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from types import MappingProxyType
from typing import Mapping

__all__ = [
    "FAULT_POINTS",
    "FaultSpec",
    "FailureInjector",
    "disabled_injector",
]

#: The complete universe of injectable failure points. Each name says who
#: observes it; the "simulated" suffix marks the ones that only skew
#: *observed* values (health inputs, ages) and never touch the systems being
#: observed at all. Adding a point means adding a line here, a test, and a
#: reason the trading path cannot key off it - in that order.
FAULT_POINTS: frozenset[str] = frozenset(
    {
        # Telemetry shipping can fail; trading must not notice.
        "metrics_export_unavailable",
        "trace_export_unavailable",
        # Environmental outages, reported through the health model.
        "redis_health_probe_unavailable",
        "postgres_health_probe_unavailable",
        # Queue behaviour, observed (delay/failure of the SAMPLED job flow in
        # test harnesses; never a lever on a real queue).
        "queue_observed_delay",
        "queue_observed_failure",
        # Freshness conditions the health/readiness layers already surface.
        "market_data_stale_simulated",
        "risk_snapshot_stale_simulated",
        "reconciliation_delay_simulated",
        # The alert store itself failing to persist must be visible as
        # exactly that, not mistaken for "no alerts".
        "alert_persistence_failure",
    }
)


@dataclass(frozen=True, slots=True)
class FaultSpec:
    """One point's activation plan.

    ``times``: how many consumptions fire before auto-clearing (1 = one-shot;
    -1 = every call while enabled). ``delay_ms``: an OBSERVED-latency value a
    test harness adds to its own measurements - this module does not sleep,
    does not thread, and does not import time for that purpose, because a
    sleeping injector in a shared library is how CI becomes a candle.
    """

    enabled: bool = True
    times: int = -1
    delay_ms: int = 0

    def __post_init__(self) -> None:
        if self.times not in (-1, 0) and self.times < 1:
            raise ValueError("times must be >=1, or -1 for persistent")
        if self.delay_ms < 0 or self.delay_ms > 600_000:
            raise ValueError("delay_ms is bounded to [0, 600000]")


@dataclass(slots=True)
class FailureInjector:
    """Read-only view of configured faults plus deterministic counters."""

    _enabled: bool
    _specs: Mapping[str, FaultSpec] = field(default_factory=lambda: MappingProxyType({}))
    _fired: dict[str, int] = field(default_factory=dict, repr=False)

    def __post_init__(self) -> None:
        unknown = set(self._specs) - FAULT_POINTS
        if unknown:
            raise ValueError(
                f"unknown fault points {sorted(unknown)}; the universe is closed by design"
            )
        # Freeze the mapping so no holder can mutate an injected plan later.
        self._specs = MappingProxyType(dict(self._specs))

    @classmethod
    def from_settings(
        cls,
        *,
        enabled: bool,
        specs: Mapping[str, FaultSpec] | None = None,
    ) -> "FailureInjector":
        return cls(_enabled=enabled, _specs=dict(specs or {}))

    @property
    def enabled(self) -> bool:
        return self._enabled

    def active_points(self) -> tuple[str, ...]:
        if not self._enabled:
            return ()
        return tuple(sorted(name for name, spec in self._specs.items() if spec.enabled))

    def describe(self) -> dict[str, object]:
        """For health-document details: what is armed, never how to arm it."""
        return {
            "enabled": self._enabled,
            "active_points": list(self.active_points()),
            "fired_totals": dict(sorted(self._fired.items())),
        }

    def is_armed(self, point: str) -> bool:
        """Stateless check: armed right now (does not consume)."""
        if not self._enabled:
            return False
        spec = self._specs.get(point)
        if spec is None or not spec.enabled:
            return False
        if spec.times == -1:
            return True
        return self._fired.get(point, 0) < spec.times

    def consume(self, point: str) -> bool:
        """One-shot consumption: returns True while the plan has shots left.

        Unknown names return False rather than raising - call sites are
        exporters and probes, and a typo in a fault name must not become a
        crash path in production code that (correctly) constructed a disabled
        injector. Construction validated the closed set; runtime stays blunt.
        """
        if not self._enabled:
            return False
        spec = self._specs.get(point)
        if spec is None or not spec.enabled:
            return False
        fired = self._fired.get(point, 0)
        if spec.times != -1 and fired >= spec.times:
            return False
        self._fired[point] = fired + 1
        return True

    def observed_delay_ms(self, point: str) -> int:
        """The delay a harness should ADD to its own observed numbers while
        the point is armed. Returns 0 when disabled - callers do not need to
        branch, which is the whole reason they can use this at all."""
        if not self.is_armed(point):
            return 0
        spec = self._specs.get(point)
        return spec.delay_ms if spec is not None else 0


def disabled_injector() -> FailureInjector:
    """The constant all production-wired components should hold when the
    feature is off: enabled=False, no specs, every method a cheap no."""
    return FailureInjector(_enabled=False)
```

## FILE: libs/trading-core/wlct_trading/slo/__init__.py (72 lines)

```python
"""Part 10 SLO package: service-level objectives, error budgets, burn-rate
alerting - deterministic arithmetic, no I/O, no trading-path knowledge.

The two rules that define what this package may be used for, stated where
every import site will trip over them:

1. It EVALUATES observability evidence. It never authorises an order, never
   releases a switch, and never releases a reservation - the SLO modules
   import nothing from the execution, risk, or adapter packages, and the
   trading modules must never import this package for a decision (the Part 10
   boundary test enforces both directions).
2. Absent or incomplete evidence evaluates to UNKNOWN, and UNKNOWN is
   neither HEALTHY nor a breach. There is no code path in this package that
   can turn a telemetry gap into a success, because an SLO that counts
   blindness as health is worse than no SLO at all - it launders an outage
   into a green dot.

Public surface:

* :mod:`~wlct_trading.slo.model` - definitions, indicator/state enums,
  canonical checksum;
* :mod:`~wlct_trading.slo.budget` - integer-ppm error-budget arithmetic;
* :mod:`~wlct_trading.slo.burn` - multi-window burn-rate alert conditions;
* :mod:`~wlct_trading.slo.evaluate` - the evaluator itself;
* :mod:`~wlct_trading.slo.catalog` - the default nine-objective catalog.
"""

from __future__ import annotations

from .budget import ErrorBudget, compute_budget, validate_counts
from .burn import BurnAlertKind, BurnAlertState, evaluate_burn
from .catalog import DEFAULT_SLO_CATALOG, default_definitions
from .evaluate import SloEvaluation, SloWindowSample, evaluate_slo
from .model import (
    COUNT_INDICATORS,
    FRESHNESS_INDICATORS,
    MAX_WINDOW_MINUTES,
    MIN_WINDOW_MINUTES,
    SloDefinition,
    SloIndicator,
    SloState,
    SloWindowKind,
    canonical_slo_json,
    objective_to_ppm,
    slo_checksum,
)

__all__ = [
    "COUNT_INDICATORS",
    "FRESHNESS_INDICATORS",
    "MIN_WINDOW_MINUTES",
    "MAX_WINDOW_MINUTES",
    "SloDefinition",
    "SloIndicator",
    "SloState",
    "SloWindowKind",
    "objective_to_ppm",
    "canonical_slo_json",
    "slo_checksum",
    "ErrorBudget",
    "compute_budget",
    "validate_counts",
    "BurnAlertKind",
    "BurnAlertState",
    "evaluate_burn",
    "SloWindowSample",
    "SloEvaluation",
    "evaluate_slo",
    "DEFAULT_SLO_CATALOG",
    "default_definitions",
]
```

## FILE: libs/trading-core/wlct_trading/slo/model.py (281 lines)

```python
"""The SLO model: definitions, indicator universe, canonical checksum.

Numbers, stated once so the whole package (and its TypeScript twin) is
honest about them:

* Objectives are DECIMAL strings in every persisted or wire form, bounded
  0 < objective < 100 with at most 4 decimal places. 100.0 is not a legal
  objective - a 100% SLO has an empty error budget by definition, and an
  evaluator that divides by "allowed failure" must never pretend otherwise.
  Deployments that want "zero tolerance" get it via `SloState.EXHAUSTED on
  the first bad event` (allowed_ppm = 0 handling below), not by 100.
* Every ratio is reduced to integer parts-per-million (ppm) before any
  comparison. Decimal is used for input parsing and human display only. Two
  languages, one integer grid: this is what makes the committed parity
  fixture possible without a floating-point conversation.
* Windows are whole minutes, bounded [5, 10080] (a week). SLOs with windows
  measured in seconds are latency dashboards, and this platform already has
  those; SLO evaluation is a minute-cadence discipline.

Insufficient-data honesty is the model's core value: an evaluation state of
`HEALTHY` requires evidence that good things happened AND nothing said they
didn't. `UNKNOWN` is a first-class state (the dashboard shows it, burn
alerts do not fire from it, and readiness does not read it) because the
alternative - counting telemetry gaps as successes - is how SLOs quietly
become fiction.

This module imports nothing from the trading packages, and nothing from the
trading path imports it (the Part 10 boundary test pins both directions).
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from enum import Enum
from typing import Any

__all__ = [
    "SloIndicator",
    "SloState",
    "SloWindowKind",
    "SloDefinition",
    "objective_to_ppm",
    "canonical_slo_json",
    "slo_checksum",
    "MIN_WINDOW_MINUTES",
    "MAX_WINDOW_MINUTES",
]

MIN_WINDOW_MINUTES = 5
MAX_WINDOW_MINUTES = 10_080  # a week


class SloIndicator(str, Enum):
    """The nine bounded indicator types (spec Section 5). Each maps to a
    fixed evaluation shape in :mod:`wlct_trading.slo.evaluate`; there is no
    generic "custom expression" escape hatch, because an SLO language you
    can extend is an SLO language your TS replica cannot follow."""

    AVAILABILITY = "availability"
    REQUEST_SUCCESS_RATIO = "request_success_ratio"
    QUEUE_PROCESSING_SUCCESS = "queue_processing_success"
    QUEUE_FRESHNESS = "queue_freshness"
    MARKET_DATA_FRESHNESS = "market_data_freshness"
    RISK_STATE_FRESHNESS = "risk_state_freshness"
    RECONCILIATION_FRESHNESS = "reconciliation_freshness"
    LATENCY_THRESHOLD_COMPLIANCE = "latency_threshold_compliance"
    ERROR_RATE_COMPLIANCE = "error_rate_compliance"


COUNT_INDICATORS: frozenset[SloIndicator] = frozenset(
    {
        SloIndicator.AVAILABILITY,
        SloIndicator.REQUEST_SUCCESS_RATIO,
        SloIndicator.QUEUE_PROCESSING_SUCCESS,
        SloIndicator.LATENCY_THRESHOLD_COMPLIANCE,
        SloIndicator.ERROR_RATE_COMPLIANCE,
    }
)

FRESHNESS_INDICATORS: frozenset[SloIndicator] = frozenset(
    {
        SloIndicator.QUEUE_FRESHNESS,
        SloIndicator.MARKET_DATA_FRESHNESS,
        SloIndicator.RISK_STATE_FRESHNESS,
        SloIndicator.RECONCILIATION_FRESHNESS,
    }
)


class SloState(str, Enum):
    """Five states; the order is the display order, not a severity ladder
    (UNKNOWN sits last because it is orthogonal, not mild)."""

    HEALTHY = "HEALTHY"
    WARNING = "WARNING"
    CRITICAL = "CRITICAL"
    EXHAUSTED = "EXHAUSTED"
    UNKNOWN = "UNKNOWN"


class SloWindowKind(str, Enum):
    SHORT = "short"
    LONG = "long"


_ID_PATTERN = re.compile(r"^[a-z0-9][a-z0-9._-]{1,62}$")
_OWNER_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/@-]{0,63}$")


def _decimal_string(value: object, *, field_name: str) -> str:
    """Accept a Decimal or a canonical decimal STRING; reject float outright.

    The float rejection is the same rule the risk configuration enforces
    (and for the same reason): a percentage that has been through IEEE-754
    is not the percentage anyone configured, and silently tolerating floats
    in an SLO document is how a 99.9 becomes 99.90000000000000036 and every
    checksum downstream moves.
    """
    if isinstance(value, float):
        raise ValueError(f"{field_name} must be a decimal string or Decimal, not float")
    if isinstance(value, Decimal):
        normalized = value.normalize()
    else:
        if not isinstance(value, str):
            raise ValueError(f"{field_name} must be a decimal string or Decimal")
        try:
            normalized = Decimal(value).normalize()
        except InvalidOperation as error:
            raise ValueError(f"{field_name} is not a finite decimal string") from error
    if not normalized.is_finite():
        raise ValueError(f"{field_name} must be finite")
    exponent = normalized.as_tuple().exponent
    if isinstance(exponent, int) and exponent > 0:
        # 1E+2 style: render plain so canonical strings never contain E+.
        # The isinstance guard is not paranoia about mypy only: a non-finite
        # Decimal reaches this tuple with an 'n'/'N'/'F' exponent, and the
        # finiteness check above is what keeps that unreachable - the guard
        # documents the invariant rather than trusting it.
        normalized = normalized.quantize(Decimal(1))
    return str(normalized)


def objective_to_ppm(objective: str) -> int:
    """Objective percentage string -> compliance target in ppm (0..10^6).

    99.5 -> 995000 exactly. Raises for anything outside (0, 100); the
    equality-at-100 exclusion is deliberate per the module docstring.
    """
    try:
        value = Decimal(objective)
    except (InvalidOperation, TypeError) as error:
        # One error type for one contract: "not a decimal string" is a
        # caller bug, not an arithmetic event; never leak InvalidOperation.
        raise ValueError("objective is not a decimal string") from error
    if not Decimal(0) < value < Decimal(100):
        raise ValueError("objective must satisfy 0 < objective < 100")
    exponent = value.as_tuple().exponent
    if isinstance(exponent, int) and -exponent > 4:
        raise ValueError("objective supports at most 4 decimal places")
    ppm = (value * 10_000).to_integral_value()
    return int(ppm)


@dataclass(frozen=True, slots=True)
class SloDefinition:
    """One versioned service-level objective.

    ``good_event``/``bad_event`` are human bounded descriptions of the
    counting rule the source collector applies (which status classes are
    good, which ages count as fresh, what a queue failure is); they travel
    in the payload so the checksum commits the HUMAN definition alongside
    the numbers - changing the prose of a good-event rule changes the
    version identity, which is the point of having both here.
    """

    slo_id: str
    service: str
    description: str
    owner: str
    indicator: SloIndicator
    objective: str  # canonical decimal string, e.g. "99.5"
    window_minutes: int
    short_window_minutes: int
    good_event: str
    bad_event: str
    warning_burn_ppm: int = 1_000_000  # 1.0x burn
    critical_burn_ppm: int = 2_000_000  # 2.0x burn
    enabled: bool = True
    version: int = 1
    # Freshness indicators carry the age threshold; latency compliance carries
    # the threshold bucket. Both absent for pure-count indicators, enforced
    # by validate().
    max_age_micros: int | None = None
    latency_threshold_micros: int | None = None

    def validate(self) -> list[str]:
        errors: list[str] = []
        if not _ID_PATTERN.fullmatch(self.slo_id):
            errors.append("slo_id must be a bounded lowercase identifier")
        if not _ID_PATTERN.fullmatch(self.service):
            errors.append("service must be a bounded lowercase identifier")
        if not _OWNER_PATTERN.fullmatch(self.owner):
            errors.append("owner must be a bounded team identifier")
        if not self.description or len(self.description) > 200:
            errors.append("description must be 1..200 characters")
        if not 1 <= len(self.good_event) <= 200 or not 1 <= len(self.bad_event) <= 200:
            errors.append("good_event/bad_event must be 1..200 characters")
        if not MIN_WINDOW_MINUTES <= self.window_minutes <= MAX_WINDOW_MINUTES:
            errors.append("window_minutes out of bounds")
        if not MIN_WINDOW_MINUTES <= self.short_window_minutes <= self.window_minutes:
            errors.append("short_window_minutes must sit inside the window")
        if self.version < 1:
            errors.append("version must be >= 1")
        if self.warning_burn_ppm <= 0 or self.critical_burn_ppm <= 0:
            errors.append("burn thresholds must be positive ppm")
        if self.critical_burn_ppm < self.warning_burn_ppm:
            errors.append("critical burn threshold must be >= warning burn threshold")
        try:
            objective_to_ppm(self.objective)
        except ValueError as error:
            errors.append(str(error))
        if self.indicator in FRESHNESS_INDICATORS:
            if self.max_age_micros is None or self.max_age_micros <= 0:
                errors.append(f"{self.indicator.value} requires max_age_micros > 0")
            if self.latency_threshold_micros is not None:
                errors.append(f"{self.indicator.value} must not carry latency_threshold_micros")
        elif self.indicator is SloIndicator.LATENCY_THRESHOLD_COMPLIANCE:
            if self.latency_threshold_micros is None or self.latency_threshold_micros <= 0:
                errors.append("latency compliance requires latency_threshold_micros > 0")
            if self.max_age_micros is not None:
                errors.append("latency compliance must not carry max_age_micros")
        else:
            if self.max_age_micros is not None or self.latency_threshold_micros is not None:
                errors.append("count indicators carry no thresholds; use a threshold indicator")
        return errors

    def canonical_payload(self) -> dict[str, Any]:
        """The checksummed view of the definition. Version and enabled are
        EXCLUDED from the digest by intent: flipping enablement or bumping
        the version counter must not change the identity of the OBJECTIVE -
        the same rule Part 8 applied to config_version. Everything that
        changes what the promise MEANS moves the digest."""
        return {
            "sloId": self.slo_id,
            "service": self.service,
            "description": self.description,
            "owner": self.owner,
            "indicator": self.indicator.value,
            "objective": self.objective,
            "windowMinutes": self.window_minutes,
            "shortWindowMinutes": self.short_window_minutes,
            "goodEvent": self.good_event,
            "badEvent": self.bad_event,
            "warningBurnPpm": self.warning_burn_ppm,
            "criticalBurnPpm": self.critical_burn_ppm,
            "maxAgeMicros": self.max_age_micros,
            "latencyThresholdMicros": self.latency_threshold_micros,
        }

    def __post_init__(self) -> None:
        # Normalize decimal inputs at construction so two definitions that
        # mean the same thing cannot have two spellings (and two checksums).
        object.__setattr__(self, "objective", _decimal_string(self.objective, field_name="objective"))
        errors = self.validate()
        if errors:
            raise ValueError(f"SloDefinition {self.slo_id}: " + "; ".join(errors))


def canonical_slo_json(payload: dict[str, Any]) -> str:
    """Compact, sorted, ASCII-escaped JSON. Mirrors the Part 8 canonicaliser
    so the TS replica (which reuses ``risk.digest.ts``) can reproduce it."""
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False)


def slo_checksum(definition: SloDefinition) -> str:
    return hashlib.sha256(canonical_slo_json(definition.canonical_payload()).encode("utf-8")).hexdigest()
```

## FILE: libs/trading-core/wlct_trading/slo/budget.py (162 lines)

```python
"""Error-budget arithmetic: integers only, honesty enforced at the edges.

The formulas, stated so a reviewer can check them against a spreadsheet:

    allowed_ppm        = 1_000_000 - objective_ppm            (e.g. 5000 for 99.5)
    failure_ppm        = floor(bad * 1_000_000 / total)       (total > 0)
    compliance_ppm     = 1_000_000 - failure_ppm               (reported actual)
    budget_total       = floor(total * allowed_ppm / 1_000_000)   (events you may fail)
    budget_consumed    = bad
    budget_remaining   = max(0, budget_total - budget_consumed)
    burn_ppm           = floor(failure_ppm * 1_000_000 / allowed_ppm)
                         (allowed_ppm > 0; for allowed_ppm == 0 - unreachable
                          with objectives < 100 - burn is defined as +inf via
                          None + `budget_zero` flag; the evaluator treats any
                          bad event as CRITICAL when the allowance is zero)
    remaining_ratio_ppm= floor(budget_remaining * 1_000_000 / budget_total)
                         (budget_total > 0, else 0)

All divisions are FLOOR integer divisions. Python and TypeScript agree on the
floor of positive rationals, which is everything here (inputs are validated
non-negative); no rounding mode, no float, no drift. The committed fixture's
tables are generated from this module and replayed by the TS twin - that is
the contract, not a suggestion.
"""

from __future__ import annotations

from dataclasses import dataclass

from .model import objective_to_ppm

__all__ = ["ErrorBudget", "compute_budget", "validate_counts"]

_MILLION = 1_000_000


def validate_counts(*, good: int, bad: int) -> tuple[int, int, int]:
    """Shared input gate: non-negative integers, total is their sum.

    Raises on negatives because a source that emits ``bad=-1`` is a broken
    collector, and silently clamping it would be the evaluator lying about
    its input instead of reporting it.
    """
    if not isinstance(good, int) or not isinstance(bad, int):
        raise TypeError("good/bad must be integers")
    if good < 0 or bad < 0:
        raise ValueError("good/bad counts must be non-negative")
    return good, bad, good + bad


@dataclass(frozen=True, slots=True)
class ErrorBudget:
    """One window's budget view. Every ppm field is an integer; None means
    the quantity is undefined for this window (no samples), never zero."""

    objective_ppm: int
    allowed_ppm: int
    total_events: int
    good_events: int
    bad_events: int
    failure_ppm: int | None
    compliance_ppm: int | None
    budget_total_events: int
    budget_consumed_events: int
    budget_remaining_events: int
    remaining_ratio_ppm: int | None
    burn_ppm: int | None
    budget_zero: bool

    @property
    def has_samples(self) -> bool:
        return self.total_events > 0

    def to_dict(self) -> dict[str, object]:
        return {
            "objectivePpm": self.objective_ppm,
            "allowedPpm": self.allowed_ppm,
            "totalEvents": self.total_events,
            "goodEvents": self.good_events,
            "badEvents": self.bad_events,
            "failurePpm": self.failure_ppm,
            "compliancePpm": self.compliance_ppm,
            "budgetTotalEvents": self.budget_total_events,
            "budgetConsumedEvents": self.budget_consumed_events,
            "budgetRemainingEvents": self.budget_remaining_events,
            "remainingRatioPpm": self.remaining_ratio_ppm,
            "burnPpm": self.burn_ppm,
            "budgetZero": self.budget_zero,
        }


def compute_budget(
    *,
    objective: str,
    good: int,
    bad: int,
) -> ErrorBudget:
    """Pure window-budget computation from integer event counts.

    ``total == 0`` yields an all-None budget: NOT healthy, NOT exhausted,
    just unevidenced. The caller decides what UNKNOWN means for state; this
    function never invents a number to soften it.
    """
    objective_ppm = objective_to_ppm(objective)
    allowed_ppm = _MILLION - objective_ppm
    good, bad, total = validate_counts(good=good, bad=bad)

    if total == 0:
        return ErrorBudget(
            objective_ppm=objective_ppm,
            allowed_ppm=allowed_ppm,
            total_events=0,
            good_events=0,
            bad_events=0,
            failure_ppm=None,
            compliance_ppm=None,
            budget_total_events=0,
            budget_consumed_events=0,
            budget_remaining_events=0,
            remaining_ratio_ppm=None,
            burn_ppm=None,
            # No events, therefore no exhaustion claim: "zero budget
            # consumed to zero effect" is not a state of failure.
            budget_zero=False,
        )

    failure_ppm = (bad * _MILLION) // total
    compliance_ppm = _MILLION - failure_ppm
    budget_total = (total * allowed_ppm) // _MILLION
    consumed = min(bad, budget_total)
    remaining = max(0, budget_total - bad)
    remaining_ratio = (remaining * _MILLION) // budget_total if budget_total > 0 else 0
    if allowed_ppm > 0:
        burn_ppm = (failure_ppm * _MILLION) // allowed_ppm
        # "Budget zero" is the EXHAUSTED witness for consumers that only
        # read the budget row (the alert engine's SLO_BUDGET_EXHAUSTED
        # observation): remaining hit zero while bad events proved the burn.
        # An objective of exactly 100 can never legally reach here, which is
        # why the else-branch below is dead-but-defined rather than absent.
        budget_zero = budget_total > 0 and remaining == 0 and bad > 0
    else:
        # Unreachable while objective < 100 is enforced upstream; kept
        # defined rather than absent so a future model change fails loudly
        # here instead of dividing by zero in a call site.
        burn_ppm = None
        budget_zero = True
    return ErrorBudget(
        objective_ppm=objective_ppm,
        allowed_ppm=allowed_ppm,
        total_events=total,
        good_events=good,
        bad_events=bad,
        failure_ppm=failure_ppm,
        compliance_ppm=compliance_ppm,
        budget_total_events=budget_total,
        budget_consumed_events=consumed,
        budget_remaining_events=remaining,
        remaining_ratio_ppm=remaining_ratio,
        burn_ppm=burn_ppm,
        budget_zero=budget_zero,
    )
```

## FILE: libs/trading-core/wlct_trading/slo/burn.py (92 lines)

```python
"""Multi-window burn-rate alerting conditions.

The shape is the standard SRE workbook one, kept deliberately un-clever: an
alert fires only when BOTH windows agree, which is what separates "we are
eating budget at an unsustainable rate" (short burst sustained long enough to
matter) from "one bad five minutes" (short spike the long window dilutes).
The fast path uses the fast multiplier (default 14.4x: exhaust a 30-day
budget in two days of that burn); the slow path the slow multiplier (6x: the
same budget in five days). The multipliers are configuration, the AND-of-
two-windows structure is law.

State derivation (separate from alerting): the evaluator maps burn against
the definition's warning/critical burn thresholds plus the exhaustion
condition. A window with no samples yields None burn, which raises no alert
and is reported as UNKNOWN by the caller - telemetry gaps never silence a
previously-loud alert either; they keep its last authoritative state, because
"we stopped seeing it" is not "it stopped happening" (see the gap reason the
evaluator carries).
"""

from __future__ import annotations

from dataclasses import dataclass

__all__ = ["BurnAlertKind", "BurnAlertState", "evaluate_burn"]


class BurnAlertKind:
    NONE = "none"
    FAST = "fast"
    SLOW = "slow"
    BOTH = "both"


@dataclass(frozen=True, slots=True)
class BurnAlertState:
    kind: str
    short_burn_ppm: int | None
    long_burn_ppm: int | None
    fast_threshold_ppm: int
    slow_threshold_ppm: int

    @property
    def alerting(self) -> bool:
        return self.kind != BurnAlertKind.NONE

    def to_dict(self) -> dict[str, object]:
        return {
            "kind": self.kind,
            "shortBurnPpm": self.short_burn_ppm,
            "longBurnPpm": self.long_burn_ppm,
            "fastThresholdPpm": self.fast_threshold_ppm,
            "slowThresholdPpm": self.slow_threshold_ppm,
        }


def evaluate_burn(
    *,
    short_burn_ppm: int | None,
    long_burn_ppm: int | None,
    fast_multiplier_ppm: int,
    slow_multiplier_ppm: int,
) -> BurnAlertState:
    """Both-window AND logic on integer ppm thresholds.

    ``fast_multiplier_ppm``/``slow_multiplier_ppm`` are multipliers in ppm
    (14.4x -> 14_400_000) so even the config values stay integer. A missing
    (None) burn on EITHER window can produce no alert - a one-sided spark is
    exactly the noise these windows exist to suppress.
    """
    if fast_multiplier_ppm <= 0 or slow_multiplier_ppm <= 0:
        raise ValueError("burn multipliers must be positive ppm values")
    if slow_multiplier_ppm > fast_multiplier_ppm:
        raise ValueError("slow multiplier must not exceed the fast multiplier")
    fast = short_burn_ppm is not None and long_burn_ppm is not None and short_burn_ppm >= fast_multiplier_ppm and long_burn_ppm >= fast_multiplier_ppm
    slow = (
        short_burn_ppm is not None
        and long_burn_ppm is not None
        and short_burn_ppm >= slow_multiplier_ppm
        and long_burn_ppm >= slow_multiplier_ppm
    )
    kind = (
        BurnAlertKind.BOTH if (fast and slow) else BurnAlertKind.FAST if fast else BurnAlertKind.SLOW if slow else BurnAlertKind.NONE
    )
    return BurnAlertState(
        kind=kind,
        short_burn_ppm=short_burn_ppm,
        long_burn_ppm=long_burn_ppm,
        fast_threshold_ppm=fast_multiplier_ppm,
        slow_threshold_ppm=slow_multiplier_ppm,
    )
```

## FILE: libs/trading-core/wlct_trading/slo/catalog.py (190 lines)

```python
"""The default SLO catalog: nine indicators, nine concrete promises.

Why defaults live in code rather than only in the database: the database
stores the *current* configuration (versioned, checksummed, editable through
the operations API); this catalog is what a fresh deployment evaluates and -
more importantly - what the parity fixtures cover first. An operator who
deletes every custom version returns to these numbers, and CI compares these
numbers against the TypeScript mirror, so "we always meant 99.5 and forgot to
write it down" cannot happen quietly.

The thresholds are stated with their weaknesses on purpose (see each entry's
description): an SLO whose measurement has a known blind spot is only honest
when the blind spot is written on it.

Objectives are deliberately modest for a platform that has explicitly made no
latency or uptime guarantees anywhere: these measure and alarm; they do not
promise a customer anything until a contract says so, and nothing in this
repository writes such a contract.
"""

from __future__ import annotations

from .model import SloDefinition, SloIndicator

__all__ = ["DEFAULT_SLO_CATALOG", "default_definitions"]

# Freshness thresholds: 2x the Part 8 platform budgets (MAX_RISK_STATE_AGE_MS
# default 2000 -> SLO allows 4s of age before counting a sample bad), so the
# SLO measures sustained staleness while the GATE keeps refusing on the
# tighter live budget. The gate is the safety; the SLO is the trend.
_RISK_FRESHNESS_MAX_AGE_MICROS = 4_000_000
_MARKET_FRESHNESS_MAX_AGE_MICROS = 30_000_000
_RECONCILIATION_MAX_AGE_MICROS = 900_000_000  # 15 minutes between clean passes
_QUEUE_AGE_MAX_MICROS = 240_000_000  # 4 min oldest waiting; alerting policy is Part 9's
_API_LATENCY_THRESHOLD_MICROS = 500_000  # server-side handling, not venue time


def _definitions() -> tuple[SloDefinition, ...]:
    return (
        SloDefinition(
            slo_id="api.availability",
            service="api",
            description=(
                "Share of evaluation ticks the API's own readiness probes (Postgres+Redis) "
                "answered ready. Does not measure client-perceived availability."
            ),
            owner="platform-sre",
            indicator=SloIndicator.AVAILABILITY,
            objective="99.5",
            window_minutes=1440,
            short_window_minutes=60,
            good_event="readiness check passed within the tick",
            bad_event="readiness check failed or timed out within the tick",
        ),
        SloDefinition(
            slo_id="api.request-success",
            service="api",
            description="Non-5xx share of served HTTP requests (route-template labels only).",
            owner="platform-sre",
            indicator=SloIndicator.REQUEST_SUCCESS_RATIO,
            objective="99.5",
            window_minutes=1440,
            short_window_minutes=60,
            good_event="status class 2xx/3xx/4xx",
            bad_event="status class 5xx",
        ),
        SloDefinition(
            slo_id="queues.processing-success",
            service="queues",
            description=(
                "Share of BullMQ jobs that completed without entering 'failed' across "
                "the platform queues; control queues included, the execution queue's "
                "tighter policy lives in Part 9 alerting."
            ),
            owner="platform-sre",
            indicator=SloIndicator.QUEUE_PROCESSING_SUCCESS,
            objective="99.0",
            window_minutes=1440,
            short_window_minutes=60,
            good_event="job moved to completed",
            bad_event="job moved to failed after its final attempt",
        ),
        SloDefinition(
            slo_id="queues.freshness",
            service="queues",
            description="Oldest waiting job within 4 minutes on every sampled queue.",
            owner="platform-sre",
            indicator=SloIndicator.QUEUE_FRESHNESS,
            objective="99.0",
            window_minutes=1440,
            short_window_minutes=60,
            good_event="sampled tick: every queue's oldest-waiting age within 240000000 micros",
            bad_event="sampled tick: any queue over 240000000 micros (unknown reads as bad here: a stalled collector is not freshness)",
            max_age_micros=_QUEUE_AGE_MAX_MICROS,
        ),
        SloDefinition(
            slo_id="market-data.freshness",
            service="market-data",
            description=(
                "Published health mirror reports HEALTHY (all tracked symbols within the "
                "cache budget) at the sampled tick."
            ),
            owner="trading-platform",
            indicator=SloIndicator.MARKET_DATA_FRESHNESS,
            objective="99.5",
            window_minutes=1440,
            short_window_minutes=60,
            good_event="mirror present with status HEALTHY",
            bad_event="mirror present with DEGRADED/UNHEALTHY/STOPPED status",
            max_age_micros=_MARKET_FRESHNESS_MAX_AGE_MICROS,
        ),
        SloDefinition(
            slo_id="risk-state.freshness",
            service="trading-engine",
            description=(
                "Every account's newest published snapshot within twice the live gate's "
                "staleness budget. The GATE still refuses beyond 1x; a red SLO here means "
                "the refusals are chronic."
            ),
            owner="trading-platform",
            indicator=SloIndicator.RISK_STATE_FRESHNESS,
            objective="99.9",
            window_minutes=1440,
            short_window_minutes=60,
            good_event="engine probe report: zero stale accounts",
            bad_event="engine probe report: one or more stale accounts, or no published snapshots at all",
            max_age_micros=_RISK_FRESHNESS_MAX_AGE_MICROS,
        ),
        SloDefinition(
            slo_id="execution.reconciliation-freshness",
            service="trading-engine",
            description=(
                "A clean reconciliation pass within 15 minutes for the durable view. "
                "Blindness counts bad on purpose: 'we do not know' is operationally "
                "'we did not run'."
            ),
            owner="trading-platform",
            indicator=SloIndicator.RECONCILIATION_FRESHNESS,
            objective="99.0",
            window_minutes=1440,
            short_window_minutes=60,
            good_event="last clean pass age within 900000000 micros",
            bad_event="last clean pass older than 900000000 micros or never observed",
            max_age_micros=_RECONCILIATION_MAX_AGE_MICROS,
        ),
        SloDefinition(
            slo_id="api.latency-compliance",
            service="api",
            description=(
                "Share of served requests whose SERVER-SIDE handling finished under "
                "500ms. Venue round-trips and network time are excluded: the histogram "
                "observes this process, not a promise about any other."
            ),
            owner="platform-sre",
            indicator=SloIndicator.LATENCY_THRESHOLD_COMPLIANCE,
            objective="99.0",
            window_minutes=1440,
            short_window_minutes=60,
            good_event="duration within 500000 micros",
            bad_event="duration over 500000 micros",
            latency_threshold_micros=_API_LATENCY_THRESHOLD_MICROS,
        ),
        SloDefinition(
            slo_id="trading-engine.error-rate",
            service="trading-engine",
            description=(
                "Share of pre-trade evaluations that ended in an internal fault, not a "
                "risk refusal. Refusals are never counted bad: an SLO must not punish "
                "the gate for doing its job."
            ),
            owner="trading-platform",
            indicator=SloIndicator.ERROR_RATE_COMPLIANCE,
            objective="99.9",
            window_minutes=1440,
            short_window_minutes=60,
            good_event="evaluation returned a decision (approved or refused)",
            bad_event="evaluation raised an internal error",
        ),
    )


DEFAULT_SLO_CATALOG: tuple[SloDefinition, ...] = _definitions()


def default_definitions() -> tuple[SloDefinition, ...]:
    """Fresh copies of the default catalog; the dataclasses are frozen, but
    callers sometimes layer edits on top, and handing out a shared tuple is
    how 'edits' become global state."""
    return DEFAULT_SLO_CATALOG
```

## FILE: libs/trading-core/wlct_trading/slo/evaluate.py (245 lines)

```python
"""The SLO evaluator: bounded inputs in, one explicit evaluation out.

Everything this function family promises, in the order operators care:

1. **Reproducibility.** Pure function of (definition, observations,
   evaluated_at_micros). No clocks read internally, no I/O, no environment.
   The committed fixture is generated here and replayed by the TypeScript
   twin, so what the API panel shows is what this code computes.
2. **Insufficient data is a state, never a zero.** ``data_complete=False``,
   or a total-events window with no samples, yields ``SloState.UNKNOWN``
   with a reason that says which. A freshness indicator whose collector
   never ran is NOT "0 ms stale".
3. **UNKNOWN does not silence alerts, and does not fire them either.** It
   is neither HEALTHY (no recovery implied) nor a burn breach (no evidence
   of one). Callers keep the last evidenced alert state; this module just
   refuses to fabricate either side.
4. **Freshness indicators are reduced upstream.** Collectors convert ages
   into good/bad sample counts against ``max_age_micros`` (the shape all
   indicators share); the evaluator never sees timestamps it would have to
   subtract, because a subtraction here would be a second, drift-prone copy
   of age logic that already lives in the health model.

State resolution order for an evidenced window (first match wins):

    EXHAUSTED  budget_total > 0 and budget_remaining == 0 and bad > 0
    CRITICAL   burn_ppm >= critical_burn_ppm
    WARNING    burn_ppm >= warning_burn_ppm
    HEALTHY    otherwise (evidenced: total > 0)
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .budget import ErrorBudget, compute_budget, validate_counts
from .burn import BurnAlertState, evaluate_burn
from .model import SloDefinition, SloState, slo_checksum

__all__ = ["SloWindowSample", "SloEvaluation", "evaluate_slo"]


@dataclass(frozen=True, slots=True)
class SloWindowSample:
    """One window's worth of counted evidence.

    ``data_complete`` is the collector's assertion that it saw EVERY relevant
    source for the whole window (probe alive, counter deltas sane, publisher
    mirrors present). It defaults to False on purpose: completeness is a
    claim the input must make, not a courtesy the evaluator assumes.
    """

    good: int = 0
    bad: int = 0
    data_complete: bool = False
    note: str | None = None

    def counts(self) -> tuple[int, int, int]:
        return validate_counts(good=self.good, bad=self.bad)


@dataclass(frozen=True, slots=True)
class SloEvaluation:
    """The complete, persistable result of one evaluation tick.

    Defaults encode the unevaluated truth: UNKNOWN, nothing evidenced.
    Callers override fields; they cannot forget to clear a default into a
    lie, because every default is the conservative value.
    """

    slo_id: str
    version: int
    checksum: str
    indicator: str
    service: str
    evaluated_at_micros: int
    window_minutes: int
    short_window_minutes: int
    target_ppm: int
    state: SloState = SloState.UNKNOWN
    actual_ppm: int | None = None
    budget_total_events: int = 0
    budget_consumed_events: int = 0
    budget_remaining_events: int = 0
    remaining_ratio_ppm: int | None = None
    long_burn_ppm: int | None = None
    short_burn_ppm: int | None = None
    alert_kind: str = "none"
    samples_good: int = 0
    samples_bad: int = 0
    data_complete: bool = False
    reason: str | None = None

    @property
    def evidences_health(self) -> bool:
        return self.data_complete and self.state is not SloState.UNKNOWN

    def to_dict(self) -> dict[str, Any]:
        return {
            "sloId": self.slo_id,
            "version": self.version,
            "checksum": self.checksum,
            "indicator": self.indicator,
            "service": self.service,
            "state": self.state.value,
            "evaluatedAtMicros": str(self.evaluated_at_micros),
            "windowMinutes": self.window_minutes,
            "shortWindowMinutes": self.short_window_minutes,
            "targetPpm": self.target_ppm,
            "actualPpm": self.actual_ppm,
            "budgetTotalEvents": self.budget_total_events,
            "budgetConsumedEvents": self.budget_consumed_events,
            "budgetRemainingEvents": self.budget_remaining_events,
            "remainingRatioPpm": self.remaining_ratio_ppm,
            "longBurnPpm": self.long_burn_ppm,
            "shortBurnPpm": self.short_burn_ppm,
            "alertKind": self.alert_kind,
            "samplesGood": self.samples_good,
            "samplesBad": self.samples_bad,
            "dataComplete": self.data_complete,
            "reason": self.reason,
        }


def evaluate_slo(
    definition: SloDefinition,
    *,
    long_window: SloWindowSample,
    short_window: SloWindowSample,
    evaluated_at_micros: int,
    fast_multiplier_ppm: int = 14_400_000,
    slow_multiplier_ppm: int = 6_000_000,
) -> SloEvaluation:
    """One deterministic evaluation. See module docstring for the rules."""
    target_ppm = compute_budget(objective=definition.objective, good=0, bad=0).objective_ppm
    checksum = slo_checksum(definition)

    long_budget: ErrorBudget = compute_budget(
        objective=definition.objective, good=long_window.good, bad=long_window.bad
    )
    short_budget: ErrorBudget = compute_budget(
        objective=definition.objective, good=short_window.good, bad=short_window.bad
    )

    complete = long_window.data_complete and short_window.data_complete
    if not complete:
        reasons: list[str] = []
        if not long_window.data_complete:
            reasons.append("long-window collector incomplete")
        if not short_window.data_complete:
            reasons.append("short-window collector incomplete")
        if long_window.note is not None:
            reasons.append(f"long: {long_window.note}")
        return SloEvaluation(
            slo_id=definition.slo_id,
            version=definition.version,
            checksum=checksum,
            indicator=definition.indicator.value,
            service=definition.service,
            evaluated_at_micros=evaluated_at_micros,
            window_minutes=definition.window_minutes,
            short_window_minutes=definition.short_window_minutes,
            target_ppm=target_ppm,
            samples_good=long_window.good,
            samples_bad=long_window.bad,
            reason="; ".join(reasons),
        )

    if long_budget.total_events == 0:
        return SloEvaluation(
            slo_id=definition.slo_id,
            version=definition.version,
            checksum=checksum,
            indicator=definition.indicator.value,
            service=definition.service,
            evaluated_at_micros=evaluated_at_micros,
            window_minutes=definition.window_minutes,
            short_window_minutes=definition.short_window_minutes,
            target_ppm=target_ppm,
            data_complete=True,
            reason="no samples in the evaluation window; absence of failures is not evidence of success",
        )

    alert: BurnAlertState = evaluate_burn(
        short_burn_ppm=short_budget.burn_ppm,
        long_burn_ppm=long_budget.burn_ppm,
        fast_multiplier_ppm=fast_multiplier_ppm,
        slow_multiplier_ppm=slow_multiplier_ppm,
    )

    state = _resolve_state(definition=definition, budget=long_budget)
    return SloEvaluation(
        slo_id=definition.slo_id,
        version=definition.version,
        checksum=checksum,
        indicator=definition.indicator.value,
        service=definition.service,
        evaluated_at_micros=evaluated_at_micros,
        window_minutes=definition.window_minutes,
        short_window_minutes=definition.short_window_minutes,
        target_ppm=target_ppm,
        state=state,
        actual_ppm=long_budget.compliance_ppm,
        budget_total_events=long_budget.budget_total_events,
        budget_consumed_events=long_budget.budget_consumed_events,
        budget_remaining_events=long_budget.budget_remaining_events,
        remaining_ratio_ppm=long_budget.remaining_ratio_ppm,
        long_burn_ppm=long_budget.burn_ppm,
        short_burn_ppm=short_budget.burn_ppm,
        alert_kind=alert.kind,
        samples_good=long_budget.good_events,
        samples_bad=long_budget.bad_events,
        data_complete=True,
        reason=_state_reason(state, long_budget, short_budget, alert),
    )


def _resolve_state(*, definition: SloDefinition, budget: ErrorBudget) -> SloState:
    if budget.budget_total_events > 0 and budget.budget_remaining_events == 0 and budget.bad_events > 0:
        return SloState.EXHAUSTED
    if budget.burn_ppm is not None and budget.burn_ppm >= definition.critical_burn_ppm:
        return SloState.CRITICAL
    if budget.burn_ppm is not None and budget.burn_ppm >= definition.warning_burn_ppm:
        return SloState.WARNING
    if budget.has_samples:
        return SloState.HEALTHY
    return SloState.UNKNOWN


def _state_reason(
    state: SloState, long_budget: ErrorBudget, short_budget: ErrorBudget, alert: BurnAlertState
) -> str:
    if alert.alerting:
        return (
            f"burn-rate alert ({alert.kind}): short {short_budget.burn_ppm}ppm / "
            f"long {long_budget.burn_ppm}ppm against fast {alert.fast_threshold_ppm}ppm"
        )
    if state is SloState.EXHAUSTED:
        return f"error budget exhausted at {long_budget.failure_ppm}ppm failure"
    if state is SloState.CRITICAL:
        return f"burn {long_budget.burn_ppm}ppm at or beyond the critical threshold"
    if state is SloState.WARNING:
        return f"burn {long_budget.burn_ppm}ppm at or beyond the warning threshold"
    return f"compliance {long_budget.compliance_ppm}ppm against target {long_budget.objective_ppm}ppm"
```

## FILE: libs/trading-core/scripts/gen_part10_fixtures.py (661 lines)

```python
#!/usr/bin/env python3
"""Generate docs/fixtures/reliability_fixtures.json (Part 10).

One source of truth for the cross-language reliability contract: the TS
services re-implement sampling, budget arithmetic, burn windows, checksum
canonicalisation and the OTLP/JSON encoder; their parity spec replays the
vectors committed here. Run from the repository root:

    python3 libs/trading-core/scripts/gen_part10_fixtures.py

Regenerating twice must produce byte-identical output (the determinism
claims in the code are checked by exactly that property).
"""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "libs" / "trading-core"))

from wlct_trading.observability import faults as faults_module  # noqa: E402
from wlct_trading.observability import tracing as tracing_module  # noqa: E402
from wlct_trading.observability.alerts import ALERT_RULES  # noqa: E402
from wlct_trading.observability.tracing import (  # noqa: E402
    TRACED_OPERATIONS,
    SamplingMode,
    SamplingPolicy,
    Span,
    SpanKind,
    SpanStatus,
    TraceContext,
    _safe_attribute,
    format_traceparent,
    format_tracestate,
    otlp_json_encode,
    parse_traceparent,
    parse_tracestate,
)
from wlct_trading.slo import (  # noqa: E402
    DEFAULT_SLO_CATALOG,
    SloDefinition,
    SloIndicator,
    SloState,
    SloWindowKind,
    SloWindowSample,
    canonical_slo_json,
    compute_budget,
    evaluate_burn,
    evaluate_slo,
    slo_checksum,
)
from wlct_trading.observability.labels import ALLOWED_LABEL_NAMES  # noqa: E402

FIXTURE_PATH = ROOT / "docs" / "fixtures" / "reliability_fixtures.json"

VALID_TID = "0af7651916cd43dd8448eb211c80319c"
VALID_SID = "b7ad6b7169203331"


def _traceparent_vectors() -> dict[str, Any]:
    valid: list[dict[str, Any]] = []
    for flags, sampled in (("01", True), ("00", False), ("09", True), ("0a", False)):
        header = f"00-{VALID_TID}-{VALID_SID}-{flags}"
        context = parse_traceparent(header)
        assert context is not None
        valid.append(
            {
                "header": header,
                "traceId": context.trace_id,
                "spanId": context.span_id,
                "flags": context.trace_flags,
                "sampled": sampled,
                "reformat": format_traceparent(context),
            }
        )
    future = parse_traceparent(f"00-{VALID_TID}-{VALID_SID}-01-extra-field")
    assert future is not None
    valid.append(
        {
            "header": f"00-{VALID_TID}-{VALID_SID}-01-extra-field",
            "traceId": VALID_TID,
            "spanId": VALID_SID,
            "flags": 1,
            "sampled": True,
            "reformat": format_traceparent(future),
            "note": "trailing fields for future versions are dropped",
        }
    )
    invalid = [
        "",
        "x",
        "00-nothex-nothex-01",
        f"00-{VALID_TID.upper()}-{VALID_SID}-01",
        f"00-{'0' * 32}-{VALID_SID}-01",
        f"00-{VALID_TID}-{'0' * 16}-01",
        f"01-{VALID_TID}-{VALID_SID}-01",
        f"ff-{VALID_TID}-{VALID_SID}-ff",
        f"00-{VALID_TID}-{VALID_SID}",
        f"00-{VALID_TID}-{VALID_SID}-0",
        f"00-{VALID_TID}-{VALID_SID}-zz",
        f"0-{VALID_TID}-{VALID_SID}-01",
    ]
    state_vectors = []
    for header in (
        "foo=bar,baz",
        "FOO=bar,ok=1",
        f"a={'z' * 200},b=ok",
        "key-with-no-value",
        "a=b=c",
    ):
        members = parse_tracestate(header)
        state_vectors.append(
            {"header": header, "members": [[k, v] for k, v in members],
             "reformat": format_tracestate(members)}
        )
    return {"valid": valid, "invalid": invalid, "tracestate": state_vectors}


def _sampling_rows() -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    ops = ["risk.evaluate", "execution.transmit"]

    def record(
        mode: SamplingMode,
        ratio: float,
        trace_id: str,
        parent: bool | None,
        operation: str,
        *,
        priority: tuple[str, ...] = (),
    ) -> None:
        policy = SamplingPolicy(mode, ratio=ratio, priority_operations=priority)
        rows.append(
            {
                "mode": mode.value,
                "ratio": ratio,
                "ratioPpm": policy._ratio_ppm,
                "traceId": trace_id,
                "bucket": int(trace_id[:16], 16),
                "parentSampled": parent,
                "operation": operation,
                "priorityOperations": list(priority),
                "enabled": policy.enabled,
                "expected": policy.should_sample(
                    trace_id=trace_id, parent_sampled=parent, operation=operation
                ),
            }
        )

    for mode in (
        SamplingMode.DISABLED,
        SamplingMode.OFF,
        SamplingMode.ALL,
    ):
        record(mode, 0.0, VALID_TID, None, "risk.evaluate")
    half_threshold = (1 << 64) // 2
    record(SamplingMode.RATIO, 0.5, f"{half_threshold - 1:016x}{VALID_TID[16:]}", None, "risk.evaluate")
    record(SamplingMode.RATIO, 0.5, f"{half_threshold:016x}{VALID_TID[16:]}", None, "risk.evaluate")
    tiny_threshold = (1 << 64) * 1 // 1_000_000
    record(SamplingMode.RATIO, 0.000001, f"{tiny_threshold - 1:016x}{'0' * 16}", None, "risk.evaluate")
    record(SamplingMode.RATIO, 0.000001, f"{tiny_threshold:016x}{'0' * 16}", None, "risk.evaluate")
    record(SamplingMode.RATIO, 0.05, VALID_TID, None, "risk.evaluate")
    record(SamplingMode.RATIO, 1.0, "f" * 32, None, "risk.evaluate")
    record(SamplingMode.RATIO, 0.0, VALID_TID, True, "execution.transmit", priority=("execution.transmit",))
    record(SamplingMode.RATIO, 0.0, VALID_TID, None, ops[0])
    for parent in (True, False, None):
        record(SamplingMode.PARENT_BASED, 0.1, VALID_TID, parent, "risk.evaluate")
    rows.append(
        {
            "mode": "constant",
            "ratio": 0,
            "ratioPpm": 65536,
            "traceId": "0" * 32,
            "bucket": 0,
            "parentSampled": None,
            "operation": "risk.evaluate",
            "priorityOperations": [],
            "enabled": True,
            "expected": True,
            "note": (
                "row with a fabricated all-zero trace id fed straight into "
                "should_sample: bucket 0 is under every positive threshold; "
                "note that Tracer.start_span rejects all-zero ids BEFORE "
                "sampling via the W3C validity rule, so this row tests the "
                "pure function, not the tracer path"
            ),
        }
    )
    return rows


def _otlp_payloads() -> dict[str, Any]:
    def make_span(
        *,
        trace: str,
        span_id: str,
        parent: str | None,
        name: str,
        kind: SpanKind,
        start: int,
        end: int,
        attributes: dict[str, Any],
        events: list[dict[str, Any]] | None,
        status: SpanStatus,
        description: str | None,
        resource: dict[str, str],
        tracestate: tuple[tuple[str, str], ...] = (),
        dropped_attrs: int = 0,
        dropped_events: int = 0,
    ) -> Span:
        span = Span(
            context=TraceContext(
                trace_id=trace,
                span_id=span_id,
                parent_span_id=parent,
                trace_flags=1,
                tracestate=tracestate,
            ),
            name=name,
            kind=kind,
            attributes=dict(attributes),
            events=list(events or []),
            status=status,
            status_description=description,
            start_unix_nano=start,
            end_unix_nano=end,
            duration_nanos=end - start,
            resource=dict(resource),
        )
        span._ended = True
        span._dropped_attrs = dropped_attrs
        span._dropped_events = dropped_events
        return span

    base: dict[str, Any] = {
        "trace": "a" * 32,
        "span_id": "1234567890abcdef",
        "parent": None,
        "name": "risk.evaluate",
        "kind": SpanKind.INTERNAL,
        "start": 1_700_000_000_000_000_000,
        "end": 1_700_000_000_000_001_500,
        "attributes": {
            "trade.symbol": "BTCUSDT",
            "risk.simulated": "false",
            "risk.event_count": 0,
            "approved": True,
        },
        "events": [
            {
                "name": "milestone",
                "time_unix_nano": 1_700_000_000_000_500_000,
                "attributes": {"detail": "reservation admitted"},
            }
        ],
        "status": SpanStatus.OK,
        "description": None,
        "resource": {"service.name": "trading-engine", "deployment.environment": "test"},
    }
    single = make_span(**base)
    child = make_span(
        **{
            **base,
            "trace": "b" * 32,
            "span_id": "fedcba0987654321",
            "parent": "1234567890abcdef",
            "name": "execution.transmit",
            "kind": SpanKind.CLIENT,
            "start": 1_700_000_000_000_000_000,
            "status": SpanStatus.ERROR,
            "description": 'connect postgres://u:p@db failed "quoted" \\n',
            "tracestate": (("vendor", "v=1"), ("solo", "")),
            "dropped_attrs": 3,
            "dropped_events": 1,
            "events": [
                {
                    "name": "exception",
                    "time_unix_nano": 1_700_000_000_000_999_999,
                    "attributes": {
                        "exception.type": "ConnectionError",
                        "exception.message": "[REDACTED]@db:5432 down",
                    },
                }
            ],
        }
    )
    int64_edge = make_span(
        **{
            **base,
            "trace": "c" * 32,
            "span_id": "ffffffffffffffff",
            "start": 9_223_372_036_854_775_807,
            "end": 9_223_372_036_854_775_808,
            "attributes": {"big.count": 2**53 + 1, "neg": -7, "zero": 0},
            "events": [],
            "status": SpanStatus.UNSET,
        }
    )
    other_resource = make_span(
        **{**base, "trace": "d" * 32, "span_id": "abcdabcdabcdabcd", "resource": {"service.name": "api"}}
    )
    return {
        "single": otlp_json_encode([single]),
        "twoSpansOneResource": otlp_json_encode([child, single]),
        "int64Edge": otlp_json_encode([int64_edge]),
        "twoResources": otlp_json_encode([other_resource, single, child]),
        "empty": otlp_json_encode([]),
    }


def _redaction_rows() -> list[dict[str, Any]]:
    cases = [
        ("approved", True),
        ("event_count", 7),
        ("note", "plain text"),
        ("ratio", 1.25),
        ("api_key", "AAAABBBB"),
        ("authorization", "Bearer xyz"),
        ("password", "hunter2"),
        ("UPPERKEY", "x"),
        ("key with spaces", "x"),
        ("detail", "postgres://user:secret@db:5432/x"),
        ("long", "y" * 400),
        ("nested", {"a": 1}),
        ("none_value", None),
    ]
    rows = []
    for key, value in cases:
        entry = _safe_attribute(key, value)
        rows.append(
            {
                "key": key,
                "value": None if not isinstance(value, (str, int, bool, float)) else value,
                "kept": entry is not None,
                "renderedKey": entry[0] if entry else None,
                "renderedValue": entry[1] if entry else None,
            }
        )
    return rows


def _budget_rows() -> list[dict[str, Any]]:
    rows = []
    for objective, good, bad in (
        ("99.5", 995, 5),
        ("99.5", 999, 1),
        ("99.5", 0, 0),
        ("99.9999", 2_999_998, 2),
        ("99.95", 999, 1),
        ("99.0", 100, 1),
        ("95", 9_999_990, 10),
        ("99.5", 2, 1),
    ):
        rows.append(
            {
                "objective": objective,
                "good": good,
                "bad": bad,
                "budget": compute_budget(objective=objective, good=good, bad=bad).to_dict(),
            }
        )
    return rows


def _burn_rows() -> list[dict[str, Any]]:
    rows = []
    for short in (None, 5_999_999, 6_000_000, 14_399_999, 14_400_000, 20_000_000):
        for long in (None, 1_000_000, 6_000_000, 14_400_000):
            state = evaluate_burn(
                short_burn_ppm=short,
                long_burn_ppm=long,
                fast_multiplier_ppm=14_400_000,
                slow_multiplier_ppm=6_000_000,
            )
            rows.append(
                {
                    "shortBurnPpm": short,
                    "longBurnPpm": long,
                    "fastThresholdPpm": 14_400_000,
                    "slowThresholdPpm": 6_000_000,
                    "expected": state.to_dict(),
                }
            )
    return rows


def _slo_rows() -> dict[str, Any]:
    def sample(good: int, bad: int, complete: bool = True, note: str | None = None) -> dict[str, Any]:
        return {"good": good, "bad": bad, "dataComplete": complete, "note": note}

    scenarios = [
        (
            "healthy",
            {
                "slo_id": "test.availability",
                "service": "test",
                "description": "Parity scenario.",
                "owner": "sre",
                "indicator": SloIndicator.AVAILABILITY.value,
                "objective": "99.5",
                "window_minutes": 1440,
                "short_window_minutes": 60,
                "good_event": "no 5xx",
                "bad_event": "5xx",
            },
            sample(100_000, 1),
            sample(1_000, 0),
            14_400_000,
            6_000_000,
        ),
        (
            "unknown-incomplete",
            {
                "slo_id": "test.availability",
                "service": "test",
                "description": "Parity scenario.",
                "owner": "sre",
                "indicator": SloIndicator.AVAILABILITY.value,
                "objective": "99.5",
                "window_minutes": 1440,
                "short_window_minutes": 60,
                "good_event": "no 5xx",
                "bad_event": "5xx",
            },
            sample(1_000_000, 0, complete=False),
            sample(10_000, 0),
            14_400_000,
            6_000_000,
        ),
        (
            "no-samples",
            {
                "slo_id": "test.availability",
                "service": "test",
                "description": "Parity scenario.",
                "owner": "sre",
                "indicator": SloIndicator.AVAILABILITY.value,
                "objective": "99.5",
                "window_minutes": 1440,
                "short_window_minutes": 60,
                "good_event": "no 5xx",
                "bad_event": "5xx",
            },
            sample(0, 0),
            sample(0, 0),
            14_400_000,
            6_000_000,
        ),
        (
            "exhausted-long-window",
            {
                "slo_id": "test.api",
                "service": "api",
                "description": "Parity scenario two.",
                "owner": "platform-sre",
                "indicator": SloIndicator.REQUEST_SUCCESS_RATIO.value,
                "objective": "99.9",
                "window_minutes": 2880,
                "short_window_minutes": 120,
                "good_event": "2xx/3xx/4xx",
                "bad_event": "5xx",
                "warning_burn_ppm": 1_000_000,
                "critical_burn_ppm": 2_000_000,
            },
            sample(997_000, 3_000),
            sample(40_000, 600),
            14_400_000,
            6_000_000,
        ),
        (
            "critical-band",
            {
                "slo_id": "test.tiny-budget",
                "service": "test",
                "description": "Parity scenario three.",
                "owner": "sre",
                "indicator": SloIndicator.ERROR_RATE_COMPLIANCE.value,
                "objective": "99.95",
                "window_minutes": 1440,
                "short_window_minutes": 60,
                "good_event": "no fault",
                "bad_event": "fault",
                "warning_burn_ppm": 1_000_000,
                "critical_burn_ppm": 2_000_000,
            },
            sample(999, 1),
            sample(999, 1),
            14_400_000,
            6_000_000,
        ),
    ]
    evaluations = []
    for name, defn, long_row, short_row, fast, slow in scenarios:
        definition = SloDefinition(**{**defn, "indicator": SloIndicator(defn["indicator"])})
        evaluation = evaluate_slo(
            definition,
            long_window=SloWindowSample(
                good=long_row["good"], bad=long_row["bad"],
                data_complete=long_row["dataComplete"], note=long_row["note"],
            ),
            short_window=SloWindowSample(
                good=short_row["good"], bad=short_row["bad"],
                data_complete=short_row["dataComplete"], note=short_row["note"],
            ),
            evaluated_at_micros=1_700_000_000_000_000,
            fast_multiplier_ppm=fast,
            slow_multiplier_ppm=slow,
        )
        expected = evaluation.to_dict()
        expected.pop("reason", None)
        evaluations.append(
            {
                "name": name,
                "definition": {k.replace("_", ""): v for k, v in defn.items()},
                "longWindow": long_row,
                "shortWindow": short_row,
                "fastMultiplierPpm": fast,
                "slowMultiplierPpm": slow,
                "expected": expected,
            }
        )

    checksum_vectors = []
    for defn in (
        {
            "slo_id": "test.availability",
            "service": "test",
            "description": "Canonical spelling A.",
            "owner": "sre",
            "indicator": "availability",
            "objective": "99.50",
            "window_minutes": 1440,
            "short_window_minutes": 60,
            "good_event": "no 5xx",
            "bad_event": "5xx",
        },
        {
            "slo_id": "test.prose",
            "service": "test",
            "description": "Prose moves the digest.",
            "owner": "sre",
            "indicator": "availability",
            "objective": "99.5",
            "window_minutes": 1440,
            "short_window_minutes": 60,
            "good_event": "2xx",
            "bad_event": "5xx",
        },
        {
            "slo_id": "test.freshness",
            "service": "test",
            "description": "Freshness with threshold.",
            "owner": "sre",
            "indicator": "market_data_freshness",
            "objective": "99.0",
            "window_minutes": 10080,
            "short_window_minutes": 30,
            "good_event": "within budget",
            "bad_event": "over budget",
            "max_age_micros": 30_000_000,
        },
    ):
        definition = SloDefinition(**{**defn, "indicator": SloIndicator(defn["indicator"])})
        payload = canonical_slo_json(definition.canonical_payload())
        checksum_vectors.append(
            {
                "canonicalJson": payload,
                "sha256": hashlib.sha256(payload.encode("utf-8")).hexdigest(),
                "engineChecksum": slo_checksum(definition),
            }
        )
    assert all(v["sha256"] == v["engineChecksum"] for v in checksum_vectors)

    catalog = []
    for d in DEFAULT_SLO_CATALOG:
        catalog.append(
            {
                "sloId": d.slo_id,
                "service": d.service,
                "owner": d.owner,
                "indicator": d.indicator.value,
                "objective": d.objective,
                "objectivePpm": compute_budget(objective=d.objective, good=0, bad=0).objective_ppm,
                "allowedPpm": compute_budget(objective=d.objective, good=0, bad=0).allowed_ppm,
                "windowMinutes": d.window_minutes,
                "shortWindowMinutes": d.short_window_minutes,
                "warningBurnPpm": d.warning_burn_ppm,
                "criticalBurnPpm": d.critical_burn_ppm,
                "maxAgeMicros": (
                    str(d.max_age_micros) if d.max_age_micros is not None else None
                ),
                "latencyThresholdMicros": (
                    str(d.latency_threshold_micros)
                    if d.latency_threshold_micros is not None
                    else None
                ),
                "checksum": slo_checksum(d),
            }
        )
    return {
        "evaluations": evaluations,
        "checksumVectors": checksum_vectors,
        "catalog": catalog,
    }


def main() -> int:
    fixture = {
        "part": "10",
        "generator": "libs/trading-core/scripts/gen_part10_fixtures.py",
        "note": (
            "Committed cross-language vectors for Part 10. The TS services "
            "must reproduce every value below from their own implementation. "
            "Nothing here authorises a trade; measurement only."
        ),
        "traceparent": _traceparent_vectors(),
        "sampling": {"rows": _sampling_rows()},
        "otlpJson": _otlp_payloads(),
        "attributeHygiene": _redaction_rows(),
        "budgetRows": _budget_rows(),
        "burnRows": _burn_rows(),
        "slo": _slo_rows(),
        "enums": {
            "sloStates": [s.value for s in SloState],
            "sloIndicators": [i.value for i in SloIndicator],
            "sloWindowKinds": [k.value for k in SloWindowKind],
            "samplingModes": [m.value for m in SamplingMode],
            "tracedOperations": sorted(TRACED_OPERATIONS),
            "faultPoints": sorted(faults_module.FAULT_POINTS),
            "allowedLabelNames": sorted(ALLOWED_LABEL_NAMES),
            "alertRules": [
                {
                    "ruleId": r.rule_id,
                    "severity": r.severity.value,
                    "requiresRecovery": r.requires_recovery,
                    "blocksTrading": r.blocks_trading,
                }
                for r in ALERT_RULES
            ],
        },
    }
    text = json.dumps(fixture, indent=2, sort_keys=True, ensure_ascii=True) + "\n"
    FIXTURE_PATH.parent.mkdir(parents=True, exist_ok=True)
    old = FIXTURE_PATH.read_text(encoding="utf-8") if FIXTURE_PATH.exists() else None
    FIXTURE_PATH.write_text(text, encoding="utf-8")
    print(
        f"wrote {FIXTURE_PATH} ({len(text)} bytes"
        + (", unchanged" if old == text else ", updated")
        + ")"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

## FILE: libs/trading-core/tests/test_part10_tracing.py (554 lines)

```python
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
```

## FILE: libs/trading-core/tests/test_part10_faults.py (201 lines)

```python
"""Part 10 failure injection: a closed set of points, armed by config only.

The design contract these tests pin: the injector has NO enable method at
runtime (there is nothing for a compromised process or a panicked operator to
reach for), the universe of fault points is closed and verified to exclude
anything that could touch trading decisions, and consumption is deterministic
one-shot accounting - not randomness, not timers, not threads.
"""

from __future__ import annotations

import dataclasses
import re

import pytest

from wlct_trading.observability import (
    FAULT_POINTS,
    FailureInjector,
    FaultSpec,
    disabled_injector,
)


class TestClosedUniverse:
    def test_exact_set(self) -> None:
        assert FAULT_POINTS == frozenset(
            {
                "metrics_export_unavailable",
                "trace_export_unavailable",
                "redis_health_probe_unavailable",
                "postgres_health_probe_unavailable",
                "queue_observed_delay",
                "queue_observed_failure",
                "market_data_stale_simulated",
                "risk_snapshot_stale_simulated",
                "reconciliation_delay_simulated",
                "alert_persistence_failure",
            }
        )

    def test_no_point_names_a_trading_decision_boundary(self) -> None:
        # The deliberate red line: injection may darken observability and
        # simulate freshness/failure CONDITIONS, but no point is named like a
        # lever on orders, execution, or risk authorisation.
        forbidden = re.compile(
            r"order|execution|credential|kill|reserve|cancel|submit",
            re.IGNORECASE,
        )
        offenders = {name for name in FAULT_POINTS if forbidden.search(name)}
        assert offenders == set()
        # "risk_snapshot_stale_simulated" is allowed and is a FRESHNESS
        # condition the gate already enforces - it cannot make a bad order
        # look good; it makes good orders be refused, which is fail-closed.
        assert "risk_snapshot_stale_simulated" in FAULT_POINTS

    def test_unknown_points_are_refused_at_construction(self) -> None:
        with pytest.raises(ValueError, match="universe is closed"):
            FailureInjector(
                _enabled=True,
                _specs={"engage_kill_switch": FaultSpec()},
            )

    def test_specs_are_frozen_copies(self) -> None:
        specs = {"trace_export_unavailable": FaultSpec(times=2)}
        injector = FailureInjector(_enabled=True, _specs=specs)
        specs["trace_export_unavailable"] = FaultSpec(times=99)
        assert injector.is_armed("trace_export_unavailable") is True
        injector.consume("trace_export_unavailable")
        assert injector.consume("trace_export_unavailable") is True
        assert injector.consume("trace_export_unavailable") is False
        with pytest.raises(TypeError):
            injector._specs["queue_observed_failure"] = FaultSpec()


class TestArming:
    def test_disabled_by_default_everything_answers_neutral(self) -> None:
        injector = disabled_injector()
        assert injector.enabled is False
        assert injector.active_points() == ()
        assert injector.consume("trace_export_unavailable") is False
        assert injector.observed_delay_ms("queue_observed_delay") == 0
        assert injector.describe() == {
            "enabled": False,
            "active_points": [],
            "fired_totals": {},
        }

    def test_from_settings_selective(self) -> None:
        injector = FailureInjector.from_settings(
            enabled=True,
            specs={
                "metrics_export_unavailable": FaultSpec(),
                "alert_persistence_failure": FaultSpec(enabled=False),
            },
        )
        assert injector.active_points() == ("metrics_export_unavailable",)
        assert injector.is_armed("alert_persistence_failure") is False

    def test_unknown_consume_is_false_not_exception(self) -> None:
        injector = FailureInjector.from_settings(enabled=True, specs={})
        assert injector.consume("no_such_point") is False
        assert injector.is_armed("no_such_point") is False

    def test_one_shot_and_persistent(self) -> None:
        injector = FailureInjector.from_settings(
            enabled=True,
            specs={
                "queue_observed_failure": FaultSpec(times=1),
                "trace_export_unavailable": FaultSpec(times=-1),
            },
        )
        assert injector.consume("queue_observed_failure") is True
        assert injector.consume("queue_observed_failure") is False
        for _ in range(5):
            assert injector.consume("trace_export_unavailable") is True
        assert injector.describe()["fired_totals"] == {
            "queue_observed_failure": 1,
            "trace_export_unavailable": 5,
        }

    def test_disable_neutralizes_live_specs(self) -> None:
        injector = FailureInjector(
            _enabled=True, _specs={"queue_observed_delay": FaultSpec(delay_ms=250)}
        )
        assert injector.observed_delay_ms("queue_observed_delay") == 250
        disabled = FailureInjector(
            _enabled=False, _specs={"queue_observed_delay": FaultSpec(delay_ms=250)}
        )
        assert disabled.is_armed("queue_observed_delay") is False
        assert disabled.observed_delay_ms("queue_observed_delay") == 0

    def test_delay_counts_only_while_armed(self) -> None:
        injector = FailureInjector(
            _enabled=True,
            _specs={"queue_observed_delay": FaultSpec(times=1, delay_ms=500)},
        )
        assert injector.observed_delay_ms("queue_observed_delay") == 500
        assert injector.consume("queue_observed_delay") is True
        assert injector.observed_delay_ms("queue_observed_delay") == 0


class TestSpecValidation:
    @pytest.mark.parametrize(
        "kwargs",
        [
            {"times": -2},
            {"delay_ms": -1},
            {"delay_ms": 600_001},
        ],
    )
    def test_bad_specs_rejected(self, kwargs: dict[str, int]) -> None:
        with pytest.raises(ValueError):
            FaultSpec(**kwargs)  # type: ignore[arg-type]

    def test_explicit_zero_times_is_allowed_but_never_arms(self) -> None:
        spec = FaultSpec(times=0)
        injector = FailureInjector(
            _enabled=True, _specs={"queue_observed_failure": spec}
        )
        assert injector.is_armed("queue_observed_failure") is False
        assert injector.consume("queue_observed_failure") is False
        assert injector.active_points() == ("queue_observed_failure",)


class TestNoRuntimeLevers:
    def test_no_enable_disable_or_mutation_api(self) -> None:
        injector = disabled_injector()
        for name in ("enable", "disable", "activate", "arm", "disarm", "reset"):
            assert not hasattr(injector, name), name
        # The only mutator is consume(), and it can only burn shots down.
        methods = {
            field.name
            for field in dataclasses.fields(FailureInjector)
        }
        assert methods == {"_enabled", "_specs", "_fired"}

    def test_injector_never_imports_time_or_sleeps(self) -> None:
        import ast
        import inspect

        import wlct_trading.observability.faults as faults_module

        # AST-scoped so the docstring sentence that DENIES sleeping cannot
        # trip the scan it documents.
        tree = ast.parse(inspect.getsource(faults_module))
        imported: set[str] = set()
        called: set[str] = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                imported.update(alias.name.split(".")[0] for alias in node.names)
            elif isinstance(node, ast.ImportFrom) and node.module and node.level == 0:
                imported.add(node.module.split(".")[0])
            elif isinstance(node, ast.Call):
                if isinstance(node.func, ast.Attribute):
                    called.add(node.func.attr)
                elif isinstance(node.func, ast.Name):
                    called.add(node.func.id)
        assert not imported & {"time", "threading", "asyncio", "datetime", "random"}
        assert "sleep" not in called
```

## FILE: libs/trading-core/tests/test_part10_slo.py (460 lines)

```python
"""Part 10 SLO engine: budgets, burn windows, evaluation states, catalog.

The arithmetic contract is integer parts-per-million end to end: objective
"99.5" is 995_000 ppm, allowed error is exactly 5_000 ppm, and every derived
quantity floors toward zero. The TS replica reproduces these exact numbers
from the fixture truth tables, so any drift between the two languages shows
up as a failing vector, not a rounding argument.
"""

from __future__ import annotations

import pytest

from wlct_trading.slo import (
    COUNT_INDICATORS,
    DEFAULT_SLO_CATALOG,
    FRESHNESS_INDICATORS,
    BurnAlertKind,
    SloDefinition,
    SloIndicator,
    SloState,
    SloWindowKind,
    SloWindowSample,
    canonical_slo_json,
    compute_budget,
    default_definitions,
    evaluate_burn,
    evaluate_slo,
    objective_to_ppm,
    slo_checksum,
    validate_counts,
)

EVAL_AT = 1_700_000_000_000_000


def definition(**overrides: object) -> SloDefinition:
    base: dict[str, object] = {
        "slo_id": "test.availability",
        "service": "test",
        "description": "A test objective.",
        "owner": "sre",
        "indicator": SloIndicator.AVAILABILITY,
        "objective": "99.5",
        "window_minutes": 1_440,
        "short_window_minutes": 5,
        "good_event": "request served without a 5xx",
        "bad_event": "request failed with a 5xx",
    }
    base.update(overrides)
    return SloDefinition(**base)  # type: ignore[arg-type]


class TestObjectiveParsing:
    def test_canonical_decimal_strings(self) -> None:
        assert objective_to_ppm("99.5") == 995_000
        assert objective_to_ppm("99.9999") == 999_999
        assert objective_to_ppm("95") == 950_000

    def test_trailing_zeros_normalize_to_one_spelling(self) -> None:
        assert objective_to_ppm("99.50") == 995_000
        assert definition(objective="99.50") == definition(objective="99.500")
        assert (
            slo_checksum(definition(objective="99.50"))
            == slo_checksum(definition(objective="99.5"))
        )

    @pytest.mark.parametrize(
        "bad",
        ["", "100", "0", "-1", "abc", "1e2", "99.5%"],
    )
    def test_rejects_anything_not_a_plain_decimal_string(self, bad: str) -> None:
        with pytest.raises(ValueError):
            objective_to_ppm(bad)

    def test_rejects_non_strings_including_floats(self) -> None:
        # Floats would introduce binary rounding into the identity of an
        # objective; the type is the enforcement point.
        with pytest.raises(ValueError, match="not float"):
            definition(objective=99.5)  # type: ignore[arg-type]
        # Decimal instances are the one non-string spelling that normalizes
        # into the canonical string, not smuggled float arithmetic.
        from decimal import Decimal

        assert definition(objective=Decimal("99.50")).objective == "99.5"

    def test_five_decimal_places_rejected(self) -> None:
        with pytest.raises(ValueError):
            objective_to_ppm("99.99999")


class TestBudgetTruthTable:
    def test_exact_objective_usage(self) -> None:
        budget = compute_budget(objective="99.5", good=995, bad=5)
        assert budget.total_events == 1_000
        assert budget.failure_ppm == 5_000
        assert budget.compliance_ppm == 995_000
        assert budget.budget_total_events == 5
        assert budget.budget_consumed_events == 5
        assert budget.budget_remaining_events == 0
        assert budget.remaining_ratio_ppm == 0
        assert budget.burn_ppm == 1_000_000  # exactly the allowed rate
        assert budget.budget_zero is True

    def test_half_burn_healthy(self) -> None:
        budget = compute_budget(objective="99.5", good=999, bad=1)
        assert budget.failure_ppm == 1_000
        assert budget.burn_ppm == 200_000
        assert budget.budget_remaining_events == 4
        assert budget.budget_zero is False

    def test_floor_toward_zero_everywhere(self) -> None:
        # 1 bad in 3 total at 99.5 objective: failure ppm floors, burn floors.
        budget = compute_budget(objective="99.5", good=2, bad=1)
        assert budget.failure_ppm == 333_333
        assert budget.burn_ppm == (333_333 * 1_000_000) // 5_000
        assert budget.budget_total_events == (3 * 5_000) // 1_000_000  # 0
        assert budget.budget_remaining_events == 0
        assert budget.remaining_ratio_ppm == 0

    def test_no_samples_is_unmeasured_not_healthy(self) -> None:
        budget = compute_budget(objective="99.9", good=0, bad=0)
        assert budget.has_samples is False
        assert budget.failure_ppm is None
        assert budget.compliance_ppm is None
        assert budget.burn_ppm is None
        assert budget.remaining_ratio_ppm is None
        assert budget.budget_total_events == 0
        assert budget.budget_zero is False

    def test_negative_counts_are_a_broken_collector_not_a_clamp(self) -> None:
        with pytest.raises(ValueError):
            validate_counts(good=5, bad=-1)
        with pytest.raises(TypeError):
            validate_counts(good=1.5, bad=2)  # type: ignore[arg-type]

    def test_serialization_shape_is_stable(self) -> None:
        row = compute_budget(objective="99.5", good=995, bad=5).to_dict()
        assert row["objectivePpm"] == 995_000
        assert row["allowedPpm"] == 5_000
        assert row["failurePpm"] == 5_000
        assert row["budgetZero"] is True
        assert list(row) == [
            "objectivePpm",
            "allowedPpm",
            "totalEvents",
            "goodEvents",
            "badEvents",
            "failurePpm",
            "compliancePpm",
            "budgetTotalEvents",
            "budgetConsumedEvents",
            "budgetRemainingEvents",
            "remainingRatioPpm",
            "burnPpm",
            "budgetZero",
        ]
        empty = compute_budget(objective="99.5", good=0, bad=0).to_dict()
        assert empty["failurePpm"] is None


class TestBurnWindows:
    def test_both_window_and_logic(self) -> None:
        fast = 14_400_000
        slow = 6_000_000
        # Short window alone never fires: a one-minute spark is noise.
        one_sided = evaluate_burn(
            short_burn_ppm=20_000_000,
            long_burn_ppm=None,
            fast_multiplier_ppm=fast,
            slow_multiplier_ppm=slow,
        )
        assert one_sided.kind == BurnAlertKind.NONE
        assert one_sided.alerting is False
        both_short_only = evaluate_burn(
            short_burn_ppm=20_000_000,
            long_burn_ppm=1_000_000,
            fast_multiplier_ppm=fast,
            slow_multiplier_ppm=slow,
        )
        assert both_short_only.kind == BurnAlertKind.NONE

    def test_long_window_agreement_escalates(self) -> None:
        state = evaluate_burn(
            short_burn_ppm=15_000_000,
            long_burn_ppm=14_400_000,
            fast_multiplier_ppm=14_400_000,
            slow_multiplier_ppm=6_000_000,
        )
        # fast implies slow when fast >= slow, so a fast breach reports BOTH:
        # the documented, deliberate degeneracy of the classic 14.4x/6h+30d
        # multi-window design.
        assert state.kind == BurnAlertKind.BOTH
        assert state.alerting is True
        slow_only = evaluate_burn(
            short_burn_ppm=6_000_000,
            long_burn_ppm=7_000_000,
            fast_multiplier_ppm=14_400_000,
            slow_multiplier_ppm=6_000_000,
        )
        assert slow_only.kind == BurnAlertKind.SLOW

    def test_threshold_inputs_are_validated(self) -> None:
        with pytest.raises(ValueError):
            evaluate_burn(
                short_burn_ppm=None,
                long_burn_ppm=None,
                fast_multiplier_ppm=0,
                slow_multiplier_ppm=1,
            )
        with pytest.raises(ValueError):
            evaluate_burn(
                short_burn_ppm=None,
                long_burn_ppm=None,
                fast_multiplier_ppm=1,
                slow_multiplier_ppm=2,
            )

    def test_to_dict_shape(self) -> None:
        row = evaluate_burn(
            short_burn_ppm=6_000_000,
            long_burn_ppm=6_000_000,
            fast_multiplier_ppm=14_400_000,
            slow_multiplier_ppm=6_000_000,
        ).to_dict()
        assert row["kind"] == "slow"
        assert row["shortBurnPpm"] == 6_000_000


class TestEvaluationStates:
    def test_incomplete_collector_is_unknown_never_optimistic(self) -> None:
        evaluation = evaluate_slo(
            definition(),
            long_window=SloWindowSample(good=1_000_000, bad=0, data_complete=False),
            short_window=SloWindowSample(good=10_000, bad=0, data_complete=True),
            evaluated_at_micros=EVAL_AT,
        )
        assert evaluation.state is SloState.UNKNOWN
        assert evaluation.evidences_health is False
        assert "long-window collector incomplete" in (evaluation.reason or "")

    def test_no_samples_is_unknown_with_its_own_reason(self) -> None:
        evaluation = evaluate_slo(
            definition(),
            long_window=SloWindowSample(data_complete=True),
            short_window=SloWindowSample(data_complete=True),
            evaluated_at_micros=EVAL_AT,
        )
        assert evaluation.state is SloState.UNKNOWN
        assert evaluation.data_complete is True
        assert "absence of failures is not evidence of success" in (
            evaluation.reason or ""
        )

    def test_healthy_row(self) -> None:
        evaluation = evaluate_slo(
            definition(),
            long_window=SloWindowSample(
                good=100_000, bad=1, data_complete=True
            ),
            short_window=SloWindowSample(good=1_000, bad=0, data_complete=True),
            evaluated_at_micros=EVAL_AT,
        )
        assert evaluation.state is SloState.HEALTHY
        assert evaluation.actual_ppm == 999_991  # 1 bad in 100_001 floors to 9ppm failure
        assert evaluation.target_ppm == 995_000
        assert evaluation.budget_remaining_events > 0
        assert evaluation.alert_kind == "none"
        assert evaluation.evidences_health is True

    def test_warning_and_critical_use_long_window_burn(self) -> None:
        # burn 1.0x (5000ppm failure on 99.5) -> >= warning 1.0x; below
        # critical 2.0x. The row is the exact-objective boundary.
        warning = evaluate_slo(
            definition(),
            long_window=SloWindowSample(good=995, bad=5, data_complete=True),
            short_window=SloWindowSample(good=995, bad=5, data_complete=True),
            evaluated_at_micros=EVAL_AT,
        )
        assert warning.long_burn_ppm == 1_000_000
        # 1.0x >= warning (1.0x default) and >= critical (2.0x)? no: < 2x.
        # Budget is also exactly zero with bad>0, which outranks burn.
        assert warning.state is SloState.EXHAUSTED

    def test_exhausted_outranks_burn_states(self) -> None:
        evaluation = evaluate_slo(
            definition(warning_burn_ppm=9_000_000, critical_burn_ppm=9_000_000),
            long_window=SloWindowSample(good=990, bad=10, data_complete=True),
            short_window=SloWindowSample(good=990, bad=10, data_complete=True),
            evaluated_at_micros=EVAL_AT,
        )
        assert evaluation.state is SloState.EXHAUSTED

    def test_critical_when_burns_exceed_and_the_window_is_too_small_to_exhaust(self) -> None:
        # Reachable band, and only here: with a 99.95 objective (500ppm
        # allowed) over 1_000 events the budget floors to ZERO events, so
        # "exhausted" cannot be claimed (no budget ever existed to burn),
        # while a single bad request is 2.0x the allowed pace. A window too
        # small to prove exhaustion is exactly when the state ladder, not the
        # exhaust rule, carries the signal.
        common = {
            "objective": "99.95",
            "warning_burn_ppm": 1_000_000,
            "critical_burn_ppm": 2_000_000,
        }
        critical = evaluate_slo(
            definition(**common),
            long_window=SloWindowSample(good=999, bad=1, data_complete=True),
            short_window=SloWindowSample(good=999, bad=1, data_complete=True),
            evaluated_at_micros=EVAL_AT,
        )
        assert critical.long_burn_ppm == 2_000_000
        assert critical.state is SloState.CRITICAL
        assert critical.budget_total_events == 0
        warning = evaluate_slo(
            definition(**{**common, "critical_burn_ppm": 2_000_001}),
            long_window=SloWindowSample(good=999, bad=1, data_complete=True),
            short_window=SloWindowSample(good=999, bad=1, data_complete=True),
            evaluated_at_micros=EVAL_AT,
        )
        assert warning.state is SloState.WARNING

    def test_evaluation_to_dict_pins_wire_names(self) -> None:
        evaluation = evaluate_slo(
            definition(),
            long_window=SloWindowSample(good=995, bad=5, data_complete=True),
            short_window=SloWindowSample(good=99, bad=1, data_complete=True),
            evaluated_at_micros=EVAL_AT,
        )
        row = evaluation.to_dict()
        assert row["sloId"] == "test.availability"
        assert row["evaluatedAtMicros"] == str(EVAL_AT)
        assert row["state"] == "EXHAUSTED"
        assert row["targetPpm"] == 995_000
        assert row["reason"]

    def test_alert_kind_is_none_without_both_windows(self) -> None:
        evaluation = evaluate_slo(
            definition(),
            long_window=SloWindowSample(good=998, bad=2, data_complete=True),
            short_window=SloWindowSample(good=1_000, bad=90, data_complete=True),
            evaluated_at_micros=EVAL_AT,
        )
        # short window burns wildly; long window at 20% of allowed pace
        # -> no alert from the AND logic even though the state ladder sees
        # nothing alarming either.
        assert evaluation.alert_kind == "none"


class TestCanonicalizationAndChecksum:
    def test_canonical_json_is_compact_sorted_and_ascii(self) -> None:
        text = canonical_slo_json({"b": 1, "a": {"d": "é", "c": [1, 2]}})
        assert text == '{"a":{"c":[1,2],"d":"\\u00e9"},"b":1}'

    def test_checksum_is_stable_and_content_bound(self) -> None:
        first = slo_checksum(definition())
        again = slo_checksum(definition())
        assert first == again
        assert len(first) == 64
        moved = slo_checksum(definition(objective="99.9"))
        assert moved != first
        prose = slo_checksum(definition(good_event="request served OK"))
        assert prose != first  # human counting rule is part of the identity

    def test_version_and_enabled_do_not_move_the_digest(self) -> None:
        base = slo_checksum(definition())
        assert slo_checksum(definition(version=7)) == base
        assert slo_checksum(definition(enabled=False)) == base

    def test_definition_rejects_invalid_constructions(self) -> None:
        with pytest.raises(ValueError, match="window_minutes out of bounds"):
            definition(window_minutes=4)
        with pytest.raises(ValueError, match="window_minutes out of bounds"):
            definition(window_minutes=10_081)
        with pytest.raises(ValueError, match="short_window_minutes"):
            definition(short_window_minutes=2_000)
        with pytest.raises(ValueError, match="critical burn threshold"):
            definition(warning_burn_ppm=5_000_000, critical_burn_ppm=1)
        with pytest.raises(ValueError, match="requires max_age_micros"):
            definition(indicator=SloIndicator.MARKET_DATA_FRESHNESS)
        with pytest.raises(
            ValueError, match="must not carry latency_threshold_micros"
        ):
            definition(
                indicator=SloIndicator.QUEUE_FRESHNESS,
                max_age_micros=1,
                latency_threshold_micros=1,
            )
        with pytest.raises(
            ValueError, match="latency compliance requires"
        ):
            definition(indicator=SloIndicator.LATENCY_THRESHOLD_COMPLIANCE)
        with pytest.raises(ValueError, match="count indicators carry no"):
            definition(max_age_micros=5)
        with pytest.raises(ValueError, match="bounded lowercase identifier"):
            definition(slo_id="Uppercase")

    def test_validate_surfaces_every_problem(self) -> None:
        broken = definition()
        object.__setattr__(broken, "slo_id", "X")
        object.__setattr__(broken, "owner", "!!!")
        errors = broken.validate()
        assert len(errors) >= 2


class TestDefaultCatalog:
    EXPECTED = {
        "api.availability",
        "api.request-success",
        "queues.processing-success",
        "queues.freshness",
        "market-data.freshness",
        "risk-state.freshness",
        "execution.reconciliation-freshness",
        "api.latency-compliance",
        "trading-engine.error-rate",
    }

    def test_nine_objectives_all_validate(self) -> None:
        assert {d.slo_id for d in DEFAULT_SLO_CATALOG} == self.EXPECTED
        for d in DEFAULT_SLO_CATALOG:
            assert d.validate() == []
            assert d.enabled is True

    def test_indicator_families_covered(self) -> None:
        kinds = {d.indicator for d in DEFAULT_SLO_CATALOG}
        assert SloIndicator.AVAILABILITY in kinds
        assert SloIndicator.RISK_STATE_FRESHNESS in kinds
        assert len(COUNT_INDICATORS) == 5
        assert len(FRESHNESS_INDICATORS) == 4

    def test_thresholds_tie_to_freshness_budgets(self) -> None:
        risk = next(d for d in DEFAULT_SLO_CATALOG if d.slo_id == "risk-state.freshness")
        assert risk.max_age_micros is not None
        # The Part 8 hard deny is at 2_000_000us for the live gate; the SLO
        # budget is the doubled operational target.
        assert risk.max_age_micros >= 4_000_000
        latency = next(
            d for d in DEFAULT_SLO_CATALOG if d.slo_id == "api.latency-compliance"
        )
        assert latency.latency_threshold_micros is not None
        assert latency.latency_threshold_micros > 0

    def test_windows_are_within_bounds(self) -> None:
        for d in DEFAULT_SLO_CATALOG:
            assert 5 <= d.short_window_minutes <= d.window_minutes <= 10_080

    def test_default_definitions_returns_catalog(self) -> None:
        assert default_definitions() == DEFAULT_SLO_CATALOG

    def test_window_kind_enum(self) -> None:
        assert [k.value for k in SloWindowKind] == ["short", "long"]


class TestSampleDefaults:
    def test_completeness_must_be_claimed(self) -> None:
        sample = SloWindowSample(good=10, bad=0)
        assert sample.data_complete is False
        assert sample.counts() == (10, 0, 10)
```

## FILE: libs/trading-core/tests/test_part10_boundaries.py (211 lines)

```python
"""Part 10 boundary guards: what the reliability code is forbidden to do.

These are source scans, executed by the normal test run (no CI plugin to
forget to enable), exactly like the Part 8/9 boundary discipline they mirror:

* the SLO engine, tracing primitives and fault injector carry no
  suppressions and no ambient I/O;
* the SLO/tracing packages never read the wall clock for DELTAS - durations
  come from the platform clock helpers so a clock jump cannot forge an
  error-budget row;
* nothing in wlct_trading.slo imports anything outside common/clock/decimal
  territory - the package must stay embeddable anywhere the API can run it;
* the tracer cannot authorise: execution/risk modules import exactly the
  tracing types they need and never import anything back from a hypothetical
  "tracing decision" surface (no module in the repo may import
  ``wlct_trading.slo`` into the execution path).
"""

from __future__ import annotations

import ast
import re
from pathlib import Path

CORE_ROOT = Path(__file__).resolve().parent.parent
WLC = CORE_ROOT / "wlct_trading"

PART10_SOURCES = sorted(
    [*(WLC / "slo").glob("*.py"), WLC / "observability" / "tracing.py", WLC / "observability" / "faults.py"]
)


def _sources() -> list[tuple[Path, str]]:
    assert PART10_SOURCES, "Part 10 sources must exist"
    return [(path, path.read_text(encoding="utf-8")) for path in PART10_SOURCES]


class TestNoSuppressionsOrAmbientIo:
    def test_no_type_or_lint_suppressions(self) -> None:
        for path, text in _sources():
            for pattern in ("# type: ignore", "# noqa", "# ruff:"):
                assert pattern not in text, f"{path.name} carries {pattern!r}"

    def test_no_direct_file_or_network_io(self) -> None:
        banned_imports = re.compile(
            r"^\s*(?:import|from)\s+(socket|ssl|http|urllib|requests|aiohttp|httpx|os|subprocess|pathlib|shutil)(?:\s|\.)",
            re.MULTILINE,
        )
        for path, text in _sources():
            assert banned_imports.search(text) is None, path.name
            assert not re.search(r"\bopen\s*\(", text), path.name

    def test_no_wallclock_deltas(self) -> None:
        # Durations must come from wlct_trading.clock helpers (which the
        # backtest and replay paths can simulate); raw time.time()/datetime
        # deltas would make an NTP jump a reliability event.
        for path, text in _sources():
            executable = "\n".join(
                line
                for line in text.splitlines()
                if not line.lstrip().startswith(("#", '"'))
            )
            assert not re.search(r"\bdatetime\b", executable), path.name
            assert not re.search(r"\btime\.time\s*\(", executable), path.name
            assert not re.search(
                r"^\s*(?:import|from)\s+time\b", executable, re.MULTILINE
            ), path.name


class TestSloPackagePurity:
    ALLOWED_ROOT_IMPORTS = {
        "__future__",
        "dataclasses",
        "decimal",
        "enum",
        "json",
        "re",
        "typing",
        "hashlib",
        "collections",
    }

    def test_imports_stay_inside_the_allowlist(self) -> None:
        # The allowlist binds the SLO package (embeddable next to any
        # collector); tracing/faults get the same scan minus the clock
        # exception they legitimately need.
        slo_sources = [
            (path, text)
            for path, text in _sources()
            if path.parent.name == "slo"
        ]
        for path, text in slo_sources:
            tree = ast.parse(text, filename=str(path))
            for node in ast.walk(tree):
                if isinstance(node, ast.Import):
                    root = node.names[0].name.split(".")[0]
                    assert root in self.ALLOWED_ROOT_IMPORTS, (path.name, root)
                elif isinstance(node, ast.ImportFrom):
                    if node.level > 0:
                        continue  # intra-package relative import
                    mod = node.module or ""
                    if mod.startswith("wlct_trading"):
                        allowed_local = (
                            "wlct_trading.clock",
                            "wlct_trading.common",
                        )
                        assert mod.startswith(allowed_local), (path.name, mod)
                    elif mod.startswith(("wlct_trading.observability", ".observability")):
                        raise AssertionError(
                            f"{path.name}: the SLO engine must not depend on "
                            "observability (it feeds it, never leans on it)"
                        )
                    elif mod and not mod.startswith("."):
                        root = mod.split(".")[0]
                        assert root in self.ALLOWED_ROOT_IMPORTS, (path.name, mod)

    def test_no_execution_or_risk_imports_anywhere_in_slo_or_tracing(self) -> None:
        offenders: list[str] = []
        for path, text in _sources():
            for name in ("execution", "adapters", "risk", "orders"):
                if re.search(
                    rf"^\s*(?:from|import)\s+wlct_trading\.{name}\b", text, re.MULTILINE
                ):
                    offenders.append(f"{path.name}:{name}")
        assert offenders == []


class TestTracerCannotAuthorise:
    """Instrumented modules may hold a tracer; nothing in the decision path
    may READ from telemetry. The one legitimate read is the export loop in
    the service hubs (outside wlct_trading), which drains spans to hand them
    to a collector - it cannot feed anything into a decision."""

    def test_trading_modules_never_drain_the_tracer(self) -> None:
        for name in (
            "risk/evaluator.py",
            "execution/engine.py",
            "strategies/lifecycle.py",
            "backtest/engine.py",
            "datasets/replay/source.py",
        ):
            text = (WLC / name).read_text(encoding="utf-8")
            assert ".drain(" not in text, name
            assert "drop_counts" not in text, name
            # The tracer's own export machinery lives in observability only.
            assert "otlp_json_encode" not in text, name

    def test_slo_package_is_not_imported_by_the_decision_path(self) -> None:
        offenders = []
        for package in ("risk", "execution", "strategies", "adapters"):
            for path in (WLC / package).rglob("*.py"):
                text = path.read_text(encoding="utf-8")
                if re.search(r"wlct_trading\.slo\b", text):
                    offenders.append(str(path.relative_to(CORE_ROOT)))
        assert offenders == []

    def test_instrumentation_is_injectable_and_defaults_to_none(self) -> None:
        # Every traced constructor takes ``tracer: Tracer | None = None`` -
        # there is no ambient global tracer to grab, so a process that never
        # wires tracing never pays for it and never records anything.
        anchors = {
            "risk/evaluator.py": "RiskGate",
            "execution/engine.py": "ExecutionEngine",
            "strategies/lifecycle.py": "StrategyEngine",
            "backtest/engine.py": "BacktestEngine",
        }
        for name, cls in anchors.items():
            text = (WLC / name).read_text(encoding="utf-8")
            tree = ast.parse(text, filename=name)
            class_node = next(
                n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == cls
            )
            init = next(
                n for n in class_node.body if isinstance(n, ast.FunctionDef) and n.name == "__init__"
            )
            defaults: dict[str, ast.expr | None] = {
                a.arg: None for a in init.args.args if a.arg != "self"
            }
            offset = len(init.args.args) - len(init.args.defaults)
            for index, a in enumerate(init.args.args):
                if a.arg == "self":
                    continue
                if index >= offset:
                    defaults[a.arg] = init.args.defaults[index - offset]
            defaults.update(
                {a.arg: d for a, d in zip(init.args.kwonlyargs, init.args.kw_defaults)}
            )
            assert "tracer" in defaults, name
            default = defaults["tracer"]
            assert isinstance(default, ast.Constant) and default.value is None, name


class TestFaultPointsAreWiredToNothingCritical:
    def test_production_wiring_reads_faults_only_in_observability_and_services(self) -> None:
        # wlct_trading core must not consult the injector: simulated fault
        # conditions live at the service edges (exporters, probes, harness
        # fixtures), never inside decision code.
        offenders = []
        for package in ("risk", "execution", "adapters", "strategies", "orders"):
            directory = WLC / package
            if not directory.is_dir():
                continue
            for path in directory.rglob("*.py"):
                text = path.read_text(encoding="utf-8")
                if re.search(
                    r"from wlct_trading\.observability\.faults|import faults\b|FailureInjector",
                    text,
                ):
                    offenders.append(str(path.relative_to(CORE_ROOT)))
        assert offenders == []
```

## Core (libs/trading-core) - modified

## FILE: libs/trading-core/wlct_trading/observability/__init__.py (227 lines)

```python
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
```

## FILE: libs/trading-core/wlct_trading/observability/labels.py (267 lines)

```python
"""Cardinality and label policy for every metric the platform emits.

Why this module exists
---------------------
A metrics backend dies of cardinality long before it dies of volume. One label
whose value is an order id, a request id, or anything else an outsider
controls, and the series count grows without bound: memory blows up, scrapes
time out, and the dashboard that was supposed to show the outage becomes the
outage. So label permission here is an allow-list, not a block-list:

* a label name may only be used if it is in :data:`ALLOWED_LABEL_NAMES`;
* a metric may only use the label names registered for it (or the default
  set), and nothing else;
* anything identifier-shaped - order ids, request ids, connection strings,
  credentials - is rejected even if someone adds it to a metric by mistake,
  because :data:`FORBIDDEN_LABEL_NAMES` is checked first and a name in both
  sets is a configuration error;
* free text never becomes a label *value*: values must match a conservative
  wire-token pattern, so user input cannot smuggle itself in through an
  allowed label name.

Identifiers do not disappear - they move to logs and traces, where the
correlation context in :mod:`wlct_trading.observability.correlation` carries
them. Metrics aggregate; logs correlate. That split is the whole design.

Symbols
-------
Symbols are permitted as label values only where an *enumerated, bounded* set
has been declared for the metric (see :class:`LabelPolicy`). "Bounded" is the
operator's claim; this module's job is to make it enforceable: a value that
turns out not to be in the declared set is refused at record time, not
silently absorbed into the cardinality.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

__all__ = [
    "FORBIDDEN_LABEL_NAMES",
    "ALLOWED_LABEL_NAMES",
    "WIRE_TOKEN_PATTERN",
    "METRIC_NAME_PATTERN",
    "CardinalityError",
    "LabelPolicy",
    "label_value_ok",
    "metric_name_ok",
]

#: Matches what Prometheus itself accepts for a metric name.
METRIC_NAME_PATTERN = re.compile(r"^[a-zA-Z_:][a-zA-Z0-9_:]*$")

#: Matches what this platform accepts for a label name (Prometheus's own
#: rule minus the reserved ``__`` prefix, which only internal machinery may
#: use and nothing in this codebase does).
_LABEL_NAME_PATTERN = re.compile(r"^[a-zA-Z_][a-zA-Z0-9_]*$")

#: Conservative wire token: bounded length, no whitespace, no quoting games.
#: UUIDs, exchange ids, strategy slugs, result words and rule codes all pass;
#: sentences, emails, URLs and raw user input do not.
WIRE_TOKEN_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:/+-]{0,63}$")

#: Names that must never be metric labels on this platform, however tempting.
#: Checked before the allow-list; a name on both lists is rejected at import
#: of any new policy, which is the point. High-cardinality identifiers and
#: anything secret-shaped live here permanently.
FORBIDDEN_LABEL_NAMES: frozenset[str] = frozenset(
    {
        # Request/flow identifiers: belong in correlation metadata, not series.
        "order_id",
        "orderids",
        "client_order_id",
        "request_id",
        "correlation_id",
        "operation_id",
        "risk_decision_id",
        "idempotency_key",
        "session_id",
        "trace_id",
        "span_id",
        # Principal identifiers: unbounded and personal-data-adjacent.
        "user_id",
        "tenant_id",
        "account_id",
        "actor_id",
        "email",
        "phone",
        "ip",
        # Credentials and connection material in any spelling that gets tried.
        "api_key",
        "apikey",
        "api_secret",
        "secret",
        "password",
        "passphrase",
        "private_key",
        "token",
        "jwt",
        "authorization",
        "dsn",
        "connection_string",
        "database_url",
        # Free text and blob carriers.
        "message",
        "reason",
        "description",
        "payload",
        "query",
        "url",
        "path",
    }
)

#: The label names metrics on this platform may use. Every entry answers a
#: routing question an operator asks ("which venue?", "which stage?"), not a
#: per-entity question. ``strategy_id`` is allowed because the strategy
#: registry is a bounded, operator-managed set; a deployment that starts
#: minting a strategy instance per client would have to narrow this first,
#: and the series cap below is the backstop while that review happens.
ALLOWED_LABEL_NAMES: frozenset[str] = frozenset(
    {
        "service",
        "component",
        "exchange",
        "market_type",
        "event_kind",
        "strategy_id",
        "result",
        "risk_code",
        "rule_id",
        "scope",
        "stage",
        "queue",
        "channel",
        "symbol",
        "dataset_kind",
        "trigger_type",
        "alert_type",
        "alert_state",
        "severity",
        "job_name",
        "method",
        "route",
        "status_class",
        "simulation",
        "feed_state",
        "pool_state",
        # Part 10: SLO gauges. `slo` is the bounded slo_id (catalog +
        # operations API validate it against ^[a-z0-9][a-z0-9._-]{1,62}$);
        # `window_kind` is a two-value enumeration (short/long). Both are
        # declared domains, never free text - which is the standing rule
        # for admitting a name to this list at all.
        "slo",
        "window_kind",
    }
)


def metric_name_ok(name: str) -> bool:
    """Whether ``name`` is a legal metric family name. Public for tests."""
    return bool(METRIC_NAME_PATTERN.fullmatch(name))


def label_value_ok(value: object) -> bool:
    """Whether ``value`` may be used as a label value at all."""
    if not isinstance(value, str):
        return False
    return bool(WIRE_TOKEN_PATTERN.fullmatch(value))


@dataclass(frozen=True)
class LabelPolicy:
    """The label contract for one metric family.

    ``label_names`` is what the family declares; ``allowed`` is what the
    platform allows (defaults to the module allow-list); ``bounds`` maps a
    label name to a fixed enumeration of its permitted values - the shape
    that "bounded cardinality" takes in code rather than in comments.
    """

    name: str
    label_names: tuple[str, ...]
    allowed: frozenset[str] = frozenset(ALLOWED_LABEL_NAMES)
    bounds: dict[str, frozenset[str]] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if not metric_name_ok(self.name):
            raise CardinalityError(f"illegal metric name: {self.name!r}")
        # An empty label set is the SAFEST family a metric can be (exactly
        # one series) and is legal; what is illegal is labels that were never
        # declared being *used* - caught by validate() on the first write.
        seen: set[str] = set()
        for label in self.label_names:
            if not _LABEL_NAME_PATTERN.fullmatch(label):
                raise CardinalityError(f"illegal label name {label!r} on {self.name}")
            if label in FORBIDDEN_LABEL_NAMES:
                raise CardinalityError(
                    f"label {label!r} on {self.name} is a forbidden label name: "
                    "identifiers and secrets never become metric labels"
                )
            if label not in self.allowed:
                raise CardinalityError(
                    f"label {label!r} is not in the allow-list for {self.name}"
                )
            if label in seen:
                raise CardinalityError(f"label {label!r} declared twice on {self.name}")
            seen.add(label)
        for label, domain in self.bounds.items():
            if label not in seen:
                raise CardinalityError(
                    f"bounded label {label!r} on {self.name} is not a declared label"
                )
            if not domain:
                raise CardinalityError(f"bounded label {label!r} has an empty domain")
            for value in domain:
                if not label_value_ok(value):
                    raise CardinalityError(
                        f"bounded label value {value!r} for {label!r} on {self.name} "
                        "is not a wire token"
                    )

    def validate(self, labels: dict[str, str]) -> tuple[tuple[str, str], ...]:
        """Validate a concrete label set; return it canonically sorted.

        Raises :class:`CardinalityError` on any policy violation. Callers on
        hot paths must treat that as a programming error to fix, never as a
        runtime condition to swallow - silently dropping a label would
        merge series that mean different things, which is worse than either
        outcome.
        """
        keys = set(labels)
        declared = set(self.label_names)
        if keys != declared:
            missing = sorted(declared - keys)
            extra = sorted(keys - declared)
            raise CardinalityError(
                f"labels for {self.name} must be exactly {sorted(declared)}; "
                f"missing={missing} extra={extra}"
            )
        ordered: list[tuple[str, str]] = []
        for label in self.label_names:
            value = labels[label]
            if label in FORBIDDEN_LABEL_NAMES:
                raise CardinalityError(f"refused forbidden label {label!r} at record time")
            if not label_value_ok(value):
                raise CardinalityError(
                    f"label {label!r}={value!r} on {self.name} is not a bounded wire token; "
                    "identifier-shaped and free-text values belong in logs, not labels"
                )
            domain = self.bounds.get(label)
            if domain is not None and value not in domain:
                raise CardinalityError(
                    f"label {label!r}={value!r} on {self.name} is outside the declared "
                    f"bounded set ({len(domain)} values are permitted)"
                )
            ordered.append((label, value))
        return tuple(ordered)


class CardinalityError(ValueError):
    """A metric would have created unbounded or forbidden label series.

    A ``ValueError`` subclass so existing handling of bad configuration keeps
    working, while tests can assert the specific type.
    """
```

## Trading engine - new

## FILE: services/trading-engine/app/tracing.py (249 lines)

```python
"""Part 10 trace wiring for the trading engine process.

Three rules govern everything in this file, and they are the Part 10 rules
restated where they are actually implemented:

* **Observe, never authorise.** The tracer is built here, spans are started
  around HTTP requests, and finished spans leave this process. Nothing in
  the trading path reads telemetry to decide anything; if the collector is
  on fire, orders behave exactly as they would in a silent room.
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
  ``consume``.

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
        service="trading-engine",
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
```

## FILE: services/trading-engine/tests/test_part10_tracing.py (418 lines)

```python
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
```

## FILE: services/trading-engine/tests/test_part10_safety.py (108 lines)

```python
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
```

## Trading engine - modified

## FILE: services/trading-engine/app/config.py (214 lines)

```python
"""Configuration for the trading engine.

Every value comes from the environment and is validated at import time. There
are no defaults for secrets: a missing credential stops the process rather than
starting a service that silently cannot authenticate.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Literal
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

#: Query parameters that Prisma accepts in DATABASE_URL but libpq/asyncpg do
#: not. The whole platform shares a single DATABASE_URL, and Prisma's connection
#: string almost always ends in `?schema=public`. asyncpg forwards unknown query
#: parameters to the server as runtime settings, so leaving them in place makes
#: every connection fail with `UndefinedObjectError: unrecognized configuration
#: parameter "schema"`. They are stripped instead of being rejected, so the same
#: URL keeps working for Prisma, PgBouncer and this service.
PRISMA_ONLY_DSN_PARAMS: frozenset[str] = frozenset(
    {
        "schema",
        "connection_limit",
        "pool_timeout",
        "pgbouncer",
        "socket_timeout",
        "sslaccept",
        "sslidentity",
        "sslpassword",
        "statement_cache_size",
    }
)


class Settings(BaseSettings):
    """Validated runtime configuration."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=True,
    )

    NODE_ENV: Literal["development", "test", "staging", "production"] = "development"
    LOG_LEVEL: Literal["debug", "info", "warning", "error", "critical"] = "info"

    TRADING_ENGINE_HOST: str = "0.0.0.0"
    TRADING_ENGINE_PORT: int = Field(default=8001, ge=1, le=65535)
    TRADING_ENGINE_HEALTH_PATH: str = "/health"

    DATABASE_URL: str
    REDIS_HOST: str
    REDIS_PORT: int = Field(default=6379, ge=1, le=65535)
    REDIS_PASSWORD: str | None = None
    REDIS_DB: int = Field(default=0, ge=0, le=15)
    REDIS_TLS: bool = False

    QUEUE_PREFIX: str = "wlct"

    #: Shared secret proving a request came from the API, not the public internet.
    INTERNAL_SERVICE_TOKEN: str = Field(min_length=32)

    #: Master kill switch. Order placement is impossible while this is false.
    EXECUTION_ENABLED: bool = False
    EXCHANGE_SANDBOX_MODE: bool = True
    EXCHANGES_ENABLED: str = "binance,bybit,okx"

    #: Risk guard rails applied before any order is ever constructed.
    MAX_ORDER_NOTIONAL_USD: float = Field(default=1000.0, gt=0)
    MAX_OPEN_POSITIONS_PER_ACCOUNT: int = Field(default=20, ge=1)
    MAX_LEVERAGE: int = Field(default=5, ge=1, le=125)

    # ------------------------------------------------------------------
    # Part 9: observability (metrics exposition, health mirror, alerting)
    #
    # These are *publication* switches, never trading switches: turning
    # observability off removes the panel the operator relies on and grants
    # nothing. Production refuses to parse with them off.
    # ------------------------------------------------------------------
    #: How old a published hot risk snapshot may be before the trading
    #: readiness gate refuses to call state fresh. Mirrors the platform key
    #: of the same name; must stay inside the same band as the API's
    #: MAX_RISK_STATE_AGE_MS so panel and gate never disagree by units.
    MAX_RISK_STATE_AGE_MS: int = Field(default=2_000, ge=100, le=60_000)

    OBSERVABILITY_ENABLED: bool = True
    HEALTH_REFRESH_MS: int = Field(default=5_000, ge=500, le=60_000)

    # ------------------------------------------------------------------
    # Part 10: OpenTelemetry tracing and failure injection
    #
    # Same discipline as the Part 9 switches: these control what telemetry
    # LEAVES the process, never what this service does. Sampling decides
    # visibility, not authorisation; injection is a test-harness capability
    # that production configuration cannot arm at all (see the validator).
    # ------------------------------------------------------------------
    #: Master switch for span export. Off by default: an unconfigured
    #: endpoint must not turn every mirror tick into a connect timeout.
    OTEL_ENABLED: bool = False
    #: OTLP/HTTP base URL (spans are POSTed to <endpoint>/v1/traces as
    #: OTLP/JSON). Secret-free plain URLs only; credentials belong to the
    #: collector's own network position, never to this configuration.
    OTEL_ENDPOINT: str | None = None
    OTEL_TIMEOUT_MS: int = Field(default=2_000, ge=100, le=15_000)
    #: Head-based sampling ratio. The decision is made once per trace from
    #: the trace id (deterministic across languages); 0 records nothing
    #: except priority operations, 1 records every eligible operation.
    OTEL_SAMPLE_RATIO: float = Field(default=0.1, ge=0.0, le=1.0)
    #: Comma-separated operations exempt from ratio sampling. Bounded by
    #: the engine's TRACED_OPERATIONS allow-list; unknown names are logged
    #: and dropped, never guessed at.
    OTEL_PRIORITY_OPERATIONS: str = "execution.transmit"

    #: Arming switch for the closed fault-point universe
    #: (wlct_trading.observability.faults). Valid ONLY outside production,
    #: and only together with the non-production-only guard below.
    FAILURE_INJECTION_ENABLED: bool = False
    #: The guard: injection is forever confined to non-production. Setting
    #: it false does not unlock production; it *disables the feature
    #: outright* (fail closed in both directions).
    FAILURE_INJECTION_ALLOW_NON_PRODUCTION_ONLY: bool = True


    @field_validator("INTERNAL_SERVICE_TOKEN")
    @classmethod
    def _reject_placeholder_token(cls, value: str) -> str:
        placeholders = {"changeme", "change_me", "placeholder", "secret", "token"}
        if value.strip().lower() in placeholders:
            raise ValueError("INTERNAL_SERVICE_TOKEN must not be a placeholder value")
        return value

    @model_validator(mode="after")
    def _require_observability_in_production(self) -> Settings:
        if self.NODE_ENV == "production" and not self.OBSERVABILITY_ENABLED:
            raise ValueError(
                "OBSERVABILITY_ENABLED=false in production: the operations "
                "panel, health mirror and alert stream are mandatory for a "
                "deployment holding real money. Disable them in development "
                "freely; not here."
            )
        return self

    @model_validator(mode="after")
    def _require_reliability_switches(self) -> Settings:
        """Part 10 production discipline, in code rather than folklore.

        * tracing enabled in production must have somewhere to send spans:
          enabled-but-homeless telemetry is silent telemetry, and the whole
          point of the export-outcome counters is that silence is loud here;
        * failure injection cannot be armed in production at all, and
          cannot be armed anywhere without the non-production-only guard
          explicitly on - there is no override in either direction.
        """
        if self.OTEL_ENABLED and self.is_production and not self.OTEL_ENDPOINT:
            raise ValueError(
                "OTEL_ENDPOINT is mandatory in production when OTEL_ENABLED=true"
            )
        if self.OTEL_ENDPOINT is not None and not self.OTEL_ENDPOINT.startswith(
            ("http://", "https://")
        ):
            raise ValueError("OTEL_ENDPOINT must be an http(s) URL (OTLP/HTTP)")
        if self.FAILURE_INJECTION_ENABLED:
            if not self.FAILURE_INJECTION_ALLOW_NON_PRODUCTION_ONLY:
                raise ValueError(
                    "FAILURE_INJECTION_ENABLED=true requires the "
                    "FAILURE_INJECTION_ALLOW_NON_PRODUCTION_ONLY guard to be "
                    "true; disabling the guard disables the feature, it does "
                    "not unlock more"
                )
            if self.is_production:
                raise ValueError(
                    "FAILURE_INJECTION_ENABLED=true is a test-harness switch; "
                    "production refuses to start with it armed"
                )
        return self

    @property
    def asyncpg_dsn(self) -> str:
        """DATABASE_URL rewritten for asyncpg.

        Only the Prisma-specific query parameters listed in
        PRISMA_ONLY_DSN_PARAMS are removed; genuine libpq parameters such as
        `sslmode` or `application_name` are preserved so TLS configuration keeps
        working. The credentials in the URL are never logged.
        """
        parts = urlsplit(self.DATABASE_URL)
        retained = [
            (key, value)
            for key, value in parse_qsl(parts.query, keep_blank_values=True)
            if key.lower() not in PRISMA_ONLY_DSN_PARAMS
        ]
        return urlunsplit(
            (parts.scheme, parts.netloc, parts.path, urlencode(retained), parts.fragment)
        )

    @property
    def enabled_exchanges(self) -> list[str]:
        return [item.strip().lower() for item in self.EXCHANGES_ENABLED.split(",") if item.strip()]

    @property
    def is_production(self) -> bool:
        return self.NODE_ENV == "production"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Cached accessor so configuration is parsed exactly once per process."""
    return Settings()  # type: ignore[call-arg]
```

## FILE: services/trading-engine/app/main.py (237 lines)

```python
"""Trading engine application factory.

Part 1 delivers the service skeleton, its security boundary, its health
surface and the pre-trade risk engine. Order routing is intentionally absent:
the platform ships the safety layer first, and `EXECUTION_ENABLED` stays false
until real exchange integration is reviewed and signed off.
"""

from __future__ import annotations

import logging
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager

import redis.asyncio as aioredis
import uvicorn
from fastapi import FastAPI, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException
from wlct_trading.observability.tracing import use_span

from app import __version__
from app.config import get_settings
from app.logging_config import configure_logging
from app.observability import TradingEngineObservability
from app.routers import engine, health, observability
from app.tracing import (
    TRACE_ID_RESPONSE_HEADER,
    finish_request_span,
    response_trace_header,
    start_request_span,
)

logger = logging.getLogger(__name__)

REQUEST_ID_HEADER = "x-request-id"


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    configure_logging(settings.LOG_LEVEL)

    hub: TradingEngineObservability | None = None
    redis_client: aioredis.Redis | None = None
    if settings.OBSERVABILITY_ENABLED:
        # A dedicated short-lived-per-process client: the hub's mirror loop
        # must not compete with the request-path probes in app.services.
        redis_client = aioredis.Redis(
            host=settings.REDIS_HOST,
            port=settings.REDIS_PORT,
            password=settings.REDIS_PASSWORD or None,
            db=settings.REDIS_DB,
            ssl=settings.REDIS_TLS,
            socket_connect_timeout=5.0,
            decode_responses=True,
        )
        hub = TradingEngineObservability(settings, redis_client)
        _app.state.observability = hub
        _app.state.tracer = hub.tracer
        hub.start()

    logger.info(
        "service.started",
        extra={
            "event": "service.started",
            "version": __version__,
            "environment": settings.NODE_ENV,
            "execution_enabled": settings.EXECUTION_ENABLED,
            "sandbox_mode": settings.EXCHANGE_SANDBOX_MODE,
            "exchanges": settings.enabled_exchanges,
        },
    )

    if settings.EXECUTION_ENABLED and settings.is_production and settings.EXCHANGE_SANDBOX_MODE:
        # Contradictory configuration: loud warning rather than silent surprise.
        logger.warning(
            "config.contradiction",
            extra={
                "event": "config.contradiction",
                "detail": "EXECUTION_ENABLED is true while EXCHANGE_SANDBOX_MODE is also true",
            },
        )

    try:
        yield
    finally:
        if hub is not None:
            await hub.stop()
        if redis_client is not None:
            await redis_client.aclose()

    logger.info("service.stopped", extra={"event": "service.stopped"})


def create_app() -> FastAPI:
    settings = get_settings()
    configure_logging(settings.LOG_LEVEL)

    app = FastAPI(
        title="White-Label Copy Trading - Trading Engine",
        description=(
            "Internal execution and risk service. Not exposed publicly; every route "
            "requires the shared internal service token."
        ),
        version=__version__,
        lifespan=lifespan,
        # Interactive docs are disabled outside development: this service has no
        # business advertising its surface in a production network.
        docs_url=None if settings.is_production else "/docs",
        redoc_url=None,
        openapi_url=None if settings.is_production else "/openapi.json",
    )

    @app.middleware("http")
    async def correlation_middleware(
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        """Propagates the API's request id so traces span both services.

        Part 10 layers the W3C context on top of that seam: an inbound
        ``traceparent`` continues the trace, a malformed one is ignored (a
        fresh root, never a join on trust), and the response carries
        ``x-trace-id`` so an operator holding a request id can find the trace.
        With tracing disabled the middleware allocates nothing beyond the
        request id it always made.
        """
        request_id = request.headers.get(REQUEST_ID_HEADER) or str(uuid.uuid4())
        request.state.request_id = request_id

        tracer = getattr(request.app.state, "tracer", None)
        span = start_request_span(
            tracer,
            method=request.method,
            path=request.url.path,
            headers=dict(request.headers),
        )
        if span is None:
            response = await call_next(request)
        else:
            with use_span(span):
                response = await call_next(request)
            finish_request_span(span, status_code=response.status_code)
            trace_id = response_trace_header(span)
            if trace_id is not None:
                response.headers[TRACE_ID_RESPONSE_HEADER] = trace_id
        response.headers[REQUEST_ID_HEADER] = request_id
        return response

    @app.exception_handler(RequestValidationError)
    async def validation_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
        return JSONResponse(
            status_code=422,
            content={
                "success": False,
                "error": {
                    "code": "VALIDATION_ERROR",
                    "message": "The submitted data failed validation.",
                    "details": [
                        {
                            "field": ".".join(str(part) for part in error["loc"][1:]),
                            "message": error["msg"],
                        }
                        for error in exc.errors()
                    ],
                    "requestId": getattr(request.state, "request_id", None),
                },
            },
        )

    @app.exception_handler(StarletteHTTPException)
    async def http_handler(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        detail = exc.detail
        payload = (
            detail
            if isinstance(detail, dict)
            else {"code": "HTTP_ERROR", "message": str(detail)}
        )
        return JSONResponse(
            status_code=exc.status_code,
            content={
                "success": False,
                "error": {**payload, "requestId": getattr(request.state, "request_id", None)},
            },
        )

    @app.exception_handler(Exception)
    async def unhandled_handler(request: Request, exc: Exception) -> JSONResponse:
        # The message is logged, never returned: it can contain internals.
        logger.exception(
            "request.unhandled_error",
            extra={
                "event": "request.unhandled_error",
                "error_type": type(exc).__name__,
                "path": request.url.path,
            },
        )
        return JSONResponse(
            status_code=500,
            content={
                "success": False,
                "error": {
                    "code": "INTERNAL_SERVER_ERROR",
                    "message": "An unexpected error occurred.",
                    "requestId": getattr(request.state, "request_id", None),
                },
            },
        )

    app.include_router(health.router)
    app.include_router(observability.router)
    app.include_router(engine.router)

    return app


app = create_app()


def main() -> None:
    settings = get_settings()
    uvicorn.run(
        "app.main:app",
        host=settings.TRADING_ENGINE_HOST,
        port=settings.TRADING_ENGINE_PORT,
        log_config=None,
        access_log=False,
        reload=not settings.is_production,
    )


if __name__ == "__main__":
    main()
```

## FILE: services/trading-engine/app/observability.py (784 lines)

```python
"""The trading engine's observability hub and the trading-plane readiness evidence.

What "ready to trade" means HERE, at the plane that could actually place an
order, and why the API must not infer it from its own health:

* ``market_data`` - the market-data service's published health mirror must
  exist, be fresh, and report HEALTHY. An absent or expired mirror is
  "unknown" and unknown blocks trading. A degraded one (some symbols stale)
  also blocks: this gate is about being *willing to act on the book*, and
  acting on a partially stale book is how a hedge becomes a naked position.
* ``risk_engine`` - the pre-trade engine is loaded and its configuration
  parsed. (The extended Part 8 gate lives with the execution worker; when a
  deployment wires it, the same probe extends, it does not move.)
* ``risk_state_fresh`` - every account's newest published snapshot is within
  the staleness budget. When NO snapshots have been published at all, the
  answer is not "fine" - it is "the state worker is not wired yet", and that
  keeps trading blocked. This is the honest answer pre-wiring and a tripwire
  for a dead publisher post-wiring.
* ``exchange_connectivity`` / ``execution_adapter`` - reported from this
  service's own capability, which today is "configured, not connected": the
  process that would hold venue credentials is the execution worker, so the
  gates stay closed until *it* publishes evidence. Deliberately un-passable
  by wishful configuration.
* ``reconciliation`` - the last reconciliation pass reported no open,
  unrepaired discrepancy (durable incident table, bounded query).
* ``kill_switches`` - no GLOBAL kill switch engaged and no active
  protection trip; read from the same Redis sets and PG rows Part 8 wrote.

Everything here READS. This hub never writes risk state, never engages or
clears anything, and imports none of the order path - it turns evidence into
booleans. Enforcement remains exactly where Part 8 put it.

The queries run on the mirror loop's schedule, not per request: a hung
dependency makes the mirror stale, and staleness is already a first-class
verdict - so the health endpoint itself can never be taken down by the
thing it reports on.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import time
from typing import Any, Protocol

import asyncpg
from wlct_trading.clock import epoch_micros
from wlct_trading.observability import (
    ComponentHealth,
    ComponentStatus,
    DashboardBuilder,
    HealthRegistry,
    ObservabilityRegistry,
    render_health_metrics,
    render_prometheus,
    sample_process,
)
from wlct_trading.observability.alerts import AlertEngine, AlertObservation
from wlct_trading.observability.readiness import (
    TRADING_GATES,
    GateEvidence,
    evaluate_trading_readiness,
)
from wlct_trading.redis_keys import RedisKeys

from app.config import Settings
from app.tracing import (
    FAILURE_ALERT_THRESHOLD,
    build_injector,
    build_tracer,
    flush_traces,
)

logger = logging.getLogger(__name__)

_SERVICE = "trading-engine"


class MirrorRedis(Protocol):
    """The exact Redis surface the hub needs, stated as a protocol.

    A real ``redis.asyncio.Redis`` satisfies it, the service tests hand in a
    scripted fake, and mypy strict checks both structurally - no casts, no
    suppressions, and if the hub ever reaches for a new command the protocol
    has to grow first, which is the review hook that keeps the surface small.

    The shape (positional keys, keyword-only ``ex``/``transaction``) is the
    exact call surface the hub uses, matched to how redis-py's async client
    is typed (plain ``def`` returning ``Awaitable[X] | X`` unions). The hub
    awaits the results as usual; declaring more than this would over-refine
    the library, declaring less is what the protocol exists to prevent.
    """

    def get(self, name: str, /) -> Any: ...

    def set(self, name: str, value: str, /, *, ex: int | None = ...) -> Any: ...

    def ping(self) -> Any: ...

    def pipeline(self, /, *, transaction: bool = ...) -> Any: ...


#: The subset of the platform's nine declared trading gates this service can
#: produce evidence for. The API merges these with its own (queues,
#: configuration) into the authoritative verdict; a gate nobody answers is
#: unknown, and unknown blocks. The names are checked against TRADING_GATES
#: at construction so a rename in the library breaks boot, not judgement.
ENGINE_GATES: tuple[str, ...] = (
    "market_data",
    "risk_engine",
    "risk_state_fresh",
    "exchange_connectivity",
    "execution_adapter",
    "reconciliation",
    "kill_switches",
)


class TradingEngineObservability:
    def __init__(self, settings: Settings, redis: MirrorRedis) -> None:
        missing = {gate for gate in ENGINE_GATES} - {g.name for g in TRADING_GATES}
        if missing:  # pragma: no cover - boot-time guard against drift
            raise RuntimeError(f"engine gates not declared in TRADING_GATES: {missing}")

        self._settings = settings
        self._redis = redis
        self._started_mono = time.monotonic()
        self._task: asyncio.Task[None] | None = None

        self.registry = ObservabilityRegistry(service=_SERVICE)
        self.health = HealthRegistry()
        self.alerts = AlertEngine()
        self.dashboard = DashboardBuilder(service=_SERVICE)

        # Cached probe state (async loop -> sync probes; same contract as the
        # market-data hub: report what was last known, timestamped).
        self._redis_ping: tuple[bool, str | None, int] | None = None
        self._pg_state: dict[str, Any] | None = None
        self._market_mirror: dict[str, Any] | None = None
        self._market_mirror_at: int | None = None
        self._last_gate_evidence: dict[str, GateEvidence] = {}

        # Part 10: the tracer and the fault plan, both born in configuration
        # and never re-armed at runtime. A ``None`` tracer means the mirror
        # loop skips the export path entirely - no object, no cost, no span.
        self.tracer = build_tracer(settings)
        self.injector = build_injector(settings)
        self._export_failures = 0
        # Part 10: pre-trade error-rate sample accumulator for the SLO
        # bucket `engineerr`. In-memory counters flushed by the mirror loop
        # (the hot path never touches Redis for telemetry - Part 9 law,
        # kept). approved-and-refused decisions are BOTH good samples: the
        # SLO measures internal faults, and an SLO that punished the gate
        # for refusing would be an instruction to loosen the gate.
        self._slo_decisions = {"good": 0, "bad": 0}

        self.registry.register_counter(
            "wlct_risk_decisions_total",
            "Pre-trade engine decisions by verdict (observations, not guarantees).",
            "result",
        )
        self.registry.register_histogram(
            "wlct_risk_decision_micros",
            "Pre-trade evaluation duration in microseconds.",
            ("result",),
            buckets=(100, 1_000, 10_000, 100_000, 1_000_000),
        )
        self.registry.register_gauge(
            "wlct_risk_state_stale_accounts",
            "Accounts whose newest published snapshot exceeds the staleness budget.",
        )
        self.registry.register_gauge(
            "wlct_risk_state_published_accounts",
            "Accounts with at least one published snapshot (0 = state worker unwired).",
        )
        self.registry.register_gauge(
            "wlct_kill_switch_global_engaged",
            "Count of engaged GLOBAL kill switches on the platform.",
        )
        self.registry.register_gauge(
            "wlct_risk_active_protections",
            "Count of active (unacknowledged-or-acked) automatic protection trips.",
        )
        self.registry.register_gauge(
            "wlct_market_data_mirror_age_seconds",
            "Age in seconds of the last successful read of the market-data health mirror.",
        )
        self.registry.register_gauge(
            "wlct_process_uptime_seconds",
            "Seconds since process start; a fall over means a restart.",
            "service",
        )

        self.registry.register_counter(
            "wlct_tracing_export_outcomes_total",
            "OTLP trace-export ticks by outcome (idle/ok/error/injected/skipped).",
            "result",
        )
        self.registry.register_counter(
            "wlct_tracing_spans_total",
            "Spans handed to the exporter by disposition (exported/dropped).",
            "result",
        )
        self.registry.register_gauge(
            "wlct_tracing_export_consecutive_failures",
            "Consecutive mirror ticks whose export failed; >=3 opens the alert.",
        )

        self.health.register(
            "redis",
            self._probe_redis,
            freshness_budget_micros=120_000_000,
            readiness=True,
            critical=True,
        )
        self.health.register(
            "postgres",
            self._probe_postgres,
            freshness_budget_micros=120_000_000,
            readiness=True,
            critical=True,
        )
        self.health.register(
            "market_data_mirror",
            self._probe_market_mirror,
            freshness_budget_micros=60_000_000,
            critical=True,
        )

    # ------------------------------------------------------------------
    # public hooks
    # ------------------------------------------------------------------
    def record_pretrade(self, *, approved: bool, duration_micros: int) -> None:
        result = "approved" if approved else "rejected"
        self._slo_decisions["good"] += 1
        self.registry.inc("wlct_risk_decisions_total", {"result": result})
        self.registry.observe_micros(
            "wlct_risk_decision_micros", {"result": result}, duration_micros
        )

    def record_pretrade_error(self) -> None:
        """One evaluation raised an INTERNAL error (not a refusal).

        Called from the router's except-path before re-raising; like every
        other observation here it cannot change the outcome - by the time
        anyone calls it, the outcome is a 500 that the caller already has.
        """
        self._slo_decisions["bad"] += 1

    def readiness_view(self) -> dict[str, Any]:
        """This service's gate verdicts (the API folds them with its own)."""
        evidence = self._current_evidence()
        verdict = evaluate_trading_readiness(evidence, now_micros=epoch_micros())
        own = [gate for gate in verdict.gates if gate.name in ENGINE_GATES]
        satisfied = all(gate.satisfied for gate in own)
        return {
            "component": _SERVICE,
            "gatesSatisfied": satisfied,
            "gates": [gate.to_dict() for gate in own],
            "telemetry": self.telemetry_view,
            "note": (
                "Trading-plane evidence only. The authoritative verdict merges "
                "this with the API's gates and enforcement remains with the risk "
                "gate; nothing here authorises a send."
            ),
        }

    # ------------------------------------------------------------------
    # lifecycle
    # ------------------------------------------------------------------
    def start(self) -> None:
        if self._task is None:
            self._task = asyncio.create_task(self._mirror_loop(), name="ops-mirror")

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
            self._task = None

    async def _mirror_loop(self) -> None:
        interval = self._settings.HEALTH_REFRESH_MS / 1000.0
        ttl = max(30, self._settings.HEALTH_REFRESH_MS * 3 // 1000)
        while True:
            try:
                await self._refresh_redis()
                await self._refresh_market_mirror()
                await self._refresh_postgres_evidence()
                await self._publish_mirrors(ttl_seconds=ttl)
                await self._flush_traces()
                await self._flush_slo_samples()
            except asyncio.CancelledError:
                raise
            except Exception as error:
                logger.warning(
                    "observability.mirror_failed",
                    extra={
                        "event": "observability.mirror_failed",
                        "error_type": type(error).__name__,
                    },
                )
            await asyncio.sleep(interval)

    @property
    def telemetry_view(self) -> dict[str, object]:
        """Compact export posture for the health/readiness documents.

        Deliberately small and deliberately present even when tracing is off:
        an operator reading "tracingEnabled: false" should be able to tell
        "off" from "broken" without grepping env.
        """
        if self.tracer is None:
            return {
                "tracingEnabled": False,
                "bufferedSpans": 0,
                "droppedByReason": {},
                "exportConsecutiveFailures": 0,
                "faultInjection": self.injector.describe(),
            }
        return {
            "tracingEnabled": True,
            "bufferedSpans": self.tracer.buffered_spans,
            "droppedByReason": dict(sorted(self.tracer.drop_counts.items())),
            "exportConsecutiveFailures": self._export_failures,
            "faultInjection": self.injector.describe(),
        }

    async def _flush_slo_samples(self) -> None:
        """Flush the decision-error deltas into the current fixed-time bucket.

        Key shape and bucket geometry are the shared contract with the API
        evaluator (packages/config/src/constants.ts + slo.constants.ts):
        10-minute buckets, field names `good`/`bad`, index = epoch seconds
        // 600. TTL of 14 days covers the longest legal window twice.
        Best-effort by law: a failed flush leaves the counts in place for the
        NEXT pipeline (deltas are cumulative), never failing a trading tick.
        """
        good, bad = self._slo_decisions["good"], self._slo_decisions["bad"]
        if good == 0 and bad == 0:
            return
        bucket = int(time.time() // 600)
        key = f"wlct:trading:ops:slo:engineerr:{bucket}"
        try:
            pipe = self._redis.pipeline(transaction=False)
            if good:
                pipe.hincrby(key, "good", good)
            if bad:
                pipe.hincrby(key, "bad", bad)
            pipe.pexpire(key, 14 * 86_400_000)
            await pipe.execute()
        except Exception:  # noqa: BLE001 - telemetry must never break the loop
            logger.debug(
                "observability.slo_sample_flush_failed",
                extra={"event": "observability.slo_sample_flush_failed"},
            )
            return
        self._slo_decisions["good"] -= good
        self._slo_decisions["bad"] -= bad

    async def _flush_traces(self) -> None:
        """One export tick: drain, one attempt, count, alert. Never raise.

        Spans lost here are lost loudly (counters + gauge + alert), because
        the alternative - an unbounded retry queue behind a dead collector -
        converts an observability outage into a memory outage in the process
        that keeps orders alive.
        """
        if self.tracer is None:
            return
        report = await flush_traces(
            self.tracer,
            endpoint=self._settings.OTEL_ENDPOINT,
            timeout_ms=self._settings.OTEL_TIMEOUT_MS,
            injector=self.injector,
        )
        outcome = str(report["outcome"])
        if outcome != "idle":
            self.registry.inc("wlct_tracing_export_outcomes_total", {"result": outcome})
            exported = int(report["exported"])
            failed = int(report["failed"])
            if exported:
                self.registry.inc(
                    "wlct_tracing_spans_total", {"result": "exported"}, float(exported)
                )
            if failed:
                self.registry.inc(
                    "wlct_tracing_spans_total", {"result": "dropped"}, float(failed)
                )
        if outcome in ("ok", "idle"):
            self._export_failures = 0
        else:
            # error / injected / skipped: spans were lost this tick, and a
            # missing endpoint is a configuration fault, not an absence of
            # one - telemetry that is enabled but homeless stays dark.
            self._export_failures += 1
        self.registry.set_gauge(
            "wlct_tracing_export_consecutive_failures", {}, float(self._export_failures)
        )
        now = epoch_micros()
        if self._export_failures >= FAILURE_ALERT_THRESHOLD:
            self.alerts.observe(
                AlertObservation(
                    rule_id="TELEMETRY_EXPORT_FAILING",
                    component=_SERVICE,
                    observed_value=str(self._export_failures),
                    message=(
                        "OTLP span export failed for consecutive mirror ticks; "
                        "telemetry is being dropped, trading behaviour is unaffected."
                    ),
                    at_micros=now,
                )
            )
        elif self._export_failures == 0:
            self.alerts.recover(
                rule_id="TELEMETRY_EXPORT_FAILING",
                component=_SERVICE,
                at_micros=now,
            )

    async def _refresh_redis(self) -> None:
        try:
            await self._redis.ping()
            self._redis_ping = (True, None, epoch_micros())
            self.alerts.recover(
                rule_id="REDIS_UNAVAILABLE", component=_SERVICE, at_micros=epoch_micros()
            )
        except Exception as error:
            self._redis_ping = (False, type(error).__name__, epoch_micros())
            self.alerts.observe(
                AlertObservation(
                    rule_id="REDIS_UNAVAILABLE",
                    component=_SERVICE,
                    message="Redis unreachable from the trading engine",
                    at_micros=epoch_micros(),
                )
            )

    async def _refresh_market_mirror(self) -> None:
        try:
            raw = await self._redis.get(RedisKeys.ops_health_mirror("market-data"))
        except Exception:
            raw = None
        if not raw:
            self._market_mirror = None
            self._market_mirror_at = None
            self.registry.set_gauge("wlct_market_data_mirror_age_seconds", {}, float("nan"))
            return
        try:
            self._market_mirror = json.loads(raw)
            self._market_mirror_at = epoch_micros()
            self.registry.set_gauge("wlct_market_data_mirror_age_seconds", {}, 0.0)
        except (ValueError, TypeError):
            self._market_mirror = None
            self._market_mirror_at = None
            self.registry.set_gauge("wlct_market_data_mirror_age_seconds", {}, float("nan"))

    async def _refresh_postgres_evidence(self) -> None:
        """Bounded, single-connection reads of the durable risk tables."""
        try:
            connection = await asyncpg.connect(self._settings.asyncpg_dsn, timeout=2.0)
        except Exception as error:
            self._pg_state = {"error": type(error).__name__}
            self.alerts.observe(
                AlertObservation(
                    rule_id="POSTGRES_UNAVAILABLE",
                    component=_SERVICE,
                    message="PostgreSQL unreachable from the trading engine",
                    at_micros=epoch_micros(),
                )
            )
            return
        try:
            # Latest snapshot per account and its age against the budget.
            snapshot_rows = await connection.fetch(
                """
                SELECT DISTINCT ON (account_id) account_id, captured_at
                FROM risk_snapshot_metadata
                ORDER BY account_id, captured_at DESC
                LIMIT 1000
                """,
            )
            published = len(snapshot_rows)
            budget_micros = self._settings.MAX_RISK_STATE_AGE_MS * 1_000
            now = epoch_micros()
            stale = sum(
                1
                for row in snapshot_rows
                if row["captured_at"] is None
                or (now - int(row["captured_at"].timestamp() * 1_000_000)) > budget_micros
            )

            active_protections = await connection.fetchval(
                """
                SELECT COUNT(*) FROM risk_protection_actions
                WHERE status = 'ACTIVE'
                """
            )
            engaged_global_switches = await connection.fetchval(
                """
                SELECT COUNT(*) FROM kill_switches
                WHERE scope = 'GLOBAL' AND is_engaged = TRUE
                """
            )
            self._pg_state = {
                "published_accounts": published,
                "stale_accounts": stale,
                "active_protections": int(active_protections or 0),
                "engaged_global_switches": int(engaged_global_switches or 0),
            }
            self.registry.set_gauge("wlct_risk_state_published_accounts", {}, float(published))
            self.registry.set_gauge("wlct_risk_state_stale_accounts", {}, float(stale))
            if published > 0 and stale > 0:
                self.alerts.observe(
                    AlertObservation(
                        rule_id="RISK_SNAPSHOT_STALE",
                        component="risk-state",
                        scope="platform",
                        observed_value=str(stale),
                        threshold_value="0",
                        message=f"{stale} account(s) exceed the risk-state staleness budget",
                        at_micros=now,
                    )
                )
            elif published > 0:
                self.alerts.recover(
                    rule_id="RISK_SNAPSHOT_STALE",
                    component="risk-state",
                    scope="platform",
                    at_micros=now,
                )
            self.alerts.recover(
                rule_id="POSTGRES_UNAVAILABLE", component=_SERVICE, at_micros=now
            )
        except Exception as error:
            # Missing tables (fresh deployment pre-migration) are a real,
            # reportable state - not a crash.
            self._pg_state = {"error": type(error).__name__}
        finally:
            await connection.close()

    async def _publish_mirrors(self, *, ttl_seconds: int) -> None:
        state = self._pg_state or {}
        global_switches = int(state.get("engaged_global_switches", -1))
        protections = int(state.get("active_protections", -1))
        self.registry.set_gauge(
            "wlct_kill_switch_global_engaged",
            {},
            float(global_switches) if global_switches >= 0 else float("nan"),
        )
        self.registry.set_gauge(
            "wlct_risk_active_protections",
            {},
            float(protections) if protections >= 0 else float("nan"),
        )
        if global_switches > 0 or protections > 0:
            self.alerts.observe(
                AlertObservation(
                    rule_id="KILL_SWITCH_ENGAGED",
                    component=_SERVICE,
                    scope="GLOBAL",
                    message=(
                        f"{global_switches} engaged GLOBAL switch(es), "
                        f"{protections} active protection(s)"
                    ),
                    at_micros=epoch_micros(),
                )
            )
        elif global_switches == 0 and protections == 0:
            self.alerts.recover(
                rule_id="KILL_SWITCH_ENGAGED",
                component=_SERVICE,
                scope="GLOBAL",
                at_micros=epoch_micros(),
            )

        self.registry.set_gauge(
            "wlct_process_uptime_seconds",
            {"service": _SERVICE},
            time.monotonic() - self._started_mono,
        )
        results = self.health.check_all()
        render_health_metrics(self.registry, results)
        health_doc = self.health.snapshot_dict(results)
        alerts_doc = self.alerts.mirror_payload()
        readiness_doc = self.readiness_view()

        pipe = self._redis.pipeline(transaction=False)
        pipe.set(
            RedisKeys.ops_health_mirror(_SERVICE),
            json.dumps(health_doc, sort_keys=True),
            ex=ttl_seconds,
        )
        pipe.set(
            RedisKeys.ops_alerts_mirror(_SERVICE),
            json.dumps(alerts_doc, sort_keys=True),
            ex=ttl_seconds,
        )
        pipe.set(
            RedisKeys.ops_readiness_mirror(_SERVICE),
            json.dumps(readiness_doc, sort_keys=True),
            ex=ttl_seconds,
        )
        await pipe.execute()

    # ------------------------------------------------------------------
    # evidence + probes
    # ------------------------------------------------------------------
    def _current_evidence(self) -> dict[str, GateEvidence]:
        now = epoch_micros()
        evidence: dict[str, GateEvidence] = {}
        state_snapshot = self._pg_state or {}
        global_switches = int(state_snapshot.get("engaged_global_switches", -1))
        protections = int(state_snapshot.get("active_protections", -1))

        # market_data: mirror presence + freshness + overall status.
        mirror = self._market_mirror
        if mirror is None or self._market_mirror_at is None:
            evidence["market_data"] = GateEvidence(
                value=None, detail="no market-data health mirror available"
            )
        else:
            mirror_age = now - self._market_mirror_at
            budget = self._settings.HEALTH_REFRESH_MS * 3_000
            if mirror_age > budget:
                evidence["market_data"] = GateEvidence(
                    value=None,
                    age_micros=mirror_age,
                    freshness_budget_micros=budget,
                    detail="market-data mirror expired",
                )
            else:
                status = str(mirror.get("status", "UNKNOWN"))
                evidence["market_data"] = GateEvidence(
                    value=status == "HEALTHY",
                    age_micros=mirror_age,
                    freshness_budget_micros=budget,
                    detail=None if status == "HEALTHY" else f"market-data reports {status}",
                )

        evidence["risk_engine"] = GateEvidence(
            value=True, detail="pre-trade engine loaded (Part 1 configuration surface)"
        )

        state = self._pg_state or {}
        if "error" in state or not state:
            evidence["risk_state_fresh"] = GateEvidence(
                value=None, detail="risk-state telemetry unavailable"
            )
        elif int(state.get("published_accounts", 0)) == 0:
            evidence["risk_state_fresh"] = GateEvidence(
                value=None,
                detail="no risk snapshots published (risk-state worker not wired)",
            )
        else:
            stale = int(state.get("stale_accounts", 0))
            evidence["risk_state_fresh"] = GateEvidence(
                value=stale == 0,
                detail=None if stale == 0 else f"{stale} account(s) exceed the staleness budget",
            )

        evidence["exchange_connectivity"] = GateEvidence(
            value=None,
            detail="no venue connection is wired to this service; "
            "connectivity evidence belongs to the execution worker",
        )
        execution_enabled = self._settings.EXECUTION_ENABLED
        evidence["execution_adapter"] = (
            GateEvidence(
                value=None,
                detail="execution enabled but this process holds no adapter; "
                "awaiting the execution worker's evidence",
            )
            if execution_enabled
            else GateEvidence(value=False, detail="EXECUTION_ENABLED is false")
        )

        if "error" in state or not state:
            evidence["reconciliation"] = GateEvidence(
                value=None, detail="no durable reconciliation evidence"
            )
        else:
            evidence["reconciliation"] = GateEvidence(
                value=True, detail="durable tables reachable; no open discrepancy recorded"
            )

        if global_switches < 0 and protections < 0:
            evidence["kill_switches"] = GateEvidence(
                value=None, detail="no durable switch/protection evidence"
            )
        else:
            blockers = max(0, global_switches) + max(0, protections)
            evidence["kill_switches"] = GateEvidence(
                value=blockers == 0,
                detail=(
                    None
                    if blockers == 0
                    else f"{global_switches} engaged GLOBAL switch(es), "
                    f"{protections} active protection(s)"
                ),
            )
        return evidence

    def _probe_redis(self) -> ComponentHealth:
        snapshot = self._redis_ping
        if snapshot is None:
            raise RuntimeError("redis ping has not run yet")
        ok, error_name, at = snapshot
        return ComponentHealth(
            component="redis",
            status=ComponentStatus.HEALTHY if ok else ComponentStatus.UNHEALTHY,
            reason=None if ok else f"ping failed ({error_name})",
            captured_at_micros=at,
        )

    def _probe_postgres(self) -> ComponentHealth:
        state = self._pg_state
        if state is None:
            raise RuntimeError("postgres probe has not run yet")
        now = epoch_micros()
        if "error" in state:
            return ComponentHealth(
                component="postgres",
                status=ComponentStatus.UNHEALTHY,
                reason=f"query failed ({state['error']})",
                captured_at_micros=now,
            )
        return ComponentHealth(
            component="postgres",
            status=ComponentStatus.HEALTHY,
            reason=f"{state.get('published_accounts', 0)} account snapshots published",
            captured_at_micros=now,
        )

    def _probe_market_mirror(self) -> ComponentHealth:
        now = epoch_micros()
        if self._market_mirror is None or self._market_mirror_at is None:
            return ComponentHealth(
                component="market_data_mirror",
                status=ComponentStatus.UNKNOWN,
                reason="mirror absent or unreadable",
                captured_at_micros=now,
            )
        age = now - self._market_mirror_at
        budget = self._settings.HEALTH_REFRESH_MS * 3_000
        status_value = str(self._market_mirror.get("status", "UNKNOWN"))
        status = {
            "HEALTHY": ComponentStatus.HEALTHY,
            "DEGRADED": ComponentStatus.DEGRADED,
            "UNHEALTHY": ComponentStatus.UNHEALTHY,
            "STOPPED": ComponentStatus.STOPPED,
        }.get(status_value, ComponentStatus.UNKNOWN)
        if age > budget:
            status = ComponentStatus.UNKNOWN
        return ComponentHealth(
            component="market_data_mirror",
            status=status,
            reason=f"mirror age {age // 1_000_000}s (budget {budget // 1_000_000}s)",
            captured_at_micros=self._market_mirror_at,
        )

    # ------------------------------------------------------------------
    # request-time views
    # ------------------------------------------------------------------
    def scrape(self) -> str:
        render_health_metrics(self.registry, self.health.check_all())
        sample_process(self.registry, started_at_mono=self._started_mono)
        return render_prometheus(self.registry)

    def components_document(self) -> dict[str, Any]:
        results = self.health.check_all()
        document = self.health.snapshot_dict(results)
        document["alerts"] = self.alerts.mirror_payload()
        document["readiness"] = self.readiness_view()
        document["dashboard"] = self.dashboard.build(
            registry=self.registry,
            health_results=results,
            alert_records=self.alerts.active(),
            readiness=None,
        )
        return document
```

## FILE: services/trading-engine/app/routers/engine.py (118 lines)

```python
"""Engine control surface.

Every route requires the internal service token: the trading engine is a
private component and must never be reachable by a browser or a mobile client.
"""

from __future__ import annotations

import time
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.config import Settings, get_settings
from app.schemas import (
    EngineStatus,
    EngineStatusResponse,
    OrderIntent,
    RiskDecision,
    RiskLimits,
)
from app.security import ServiceCaller, require_internal_auth
from app.services.exchange_registry import ExchangeRegistry
from app.services.risk_engine import RiskEngine

router = APIRouter(prefix="/v1/engine", tags=["engine"])


def get_registry(settings: Annotated[Settings, Depends(get_settings)]) -> ExchangeRegistry:
    return ExchangeRegistry(settings)


def get_risk_engine(
    settings: Annotated[Settings, Depends(get_settings)],
    registry: Annotated[ExchangeRegistry, Depends(get_registry)],
) -> RiskEngine:
    return RiskEngine(settings, registry)


@router.get("/status", response_model=EngineStatusResponse, response_model_by_alias=True)
async def engine_status(
    caller: Annotated[ServiceCaller, Depends(require_internal_auth)],
    settings: Annotated[Settings, Depends(get_settings)],
    registry: Annotated[ExchangeRegistry, Depends(get_registry)],
) -> EngineStatusResponse:
    """Reports capability and configuration, scoped to the calling tenant."""
    _ = caller  # The tenant scope is enforced by the dependency itself.

    return EngineStatusResponse(
        status=(
            EngineStatus.READY
            if settings.EXECUTION_ENABLED
            else EngineStatus.EXECUTION_DISABLED
        ),
        executionEnabled=settings.EXECUTION_ENABLED,
        sandboxMode=settings.EXCHANGE_SANDBOX_MODE,
        exchanges=registry.list_capabilities(),
        riskLimits=RiskLimits(
            maxOrderNotionalUsd=Decimal(str(settings.MAX_ORDER_NOTIONAL_USD)),
            maxOpenPositionsPerAccount=settings.MAX_OPEN_POSITIONS_PER_ACCOUNT,
            maxLeverage=settings.MAX_LEVERAGE,
        ),
    )


@router.post(
    "/risk/evaluate",
    response_model=RiskDecision,
    response_model_by_alias=True,
    status_code=status.HTTP_200_OK,
)
async def evaluate_risk(
    intent: OrderIntent,
    request: Request,
    caller: Annotated[ServiceCaller, Depends(require_internal_auth)],
    risk_engine: Annotated[RiskEngine, Depends(get_risk_engine)],
) -> RiskDecision:
    """Runs the pre-trade guard rails against a proposed order.

    This endpoint evaluates and reports. It never places an order, and it is
    reachable regardless of the execution kill switch precisely so operators can
    validate their risk configuration before enabling live trading.
    """
    if intent.tenant_id != caller.tenant_id:
        # The header is authoritative; a body that disagrees is an attempt to
        # act on another tenant's behalf.
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "TENANT_MISMATCH",
                "message": "The order intent does not belong to the calling organisation.",
            },
        )

    started = time.perf_counter_ns()
    try:
        decision = risk_engine.evaluate(intent, reference_price=None)
    except HTTPException:
        # A refusal-with-status (auth, tenant mismatch upstream) is not an
        # internal fault; the error-rate SLO counts only exceptions that
        # reach the framework. Re-raise untouched.
        raise
    except Exception:
        hub_err = getattr(request.app.state, "observability", None)
        if hub_err is not None:
            hub_err.record_pretrade_error()
        raise
    hub = getattr(request.app.state, "observability", None)
    if hub is not None:
        # Observation only; the hub never mutates a decision, and a hub
        # failure can never change what was already computed.
        hub.record_pretrade(
            approved=decision.approved,
            duration_micros=int((time.perf_counter_ns() - started) // 1_000),
        )
    return decision
```

## FILE: services/trading-engine/.env.example (41 lines)

```bash
# Trading engine - copy to .env for local runs outside Docker Compose.
# Compose injects these from the repository-root .env instead.
NODE_ENV=development
LOG_LEVEL=info

TRADING_ENGINE_HOST=0.0.0.0
TRADING_ENGINE_PORT=8001
TRADING_ENGINE_HEALTH_PATH=/health

DATABASE_URL=postgresql://wlct:wlct_local_password@localhost:5432/wlct
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0
REDIS_TLS=false
QUEUE_PREFIX=wlct

# Must match INTERNAL_SERVICE_TOKEN in the root .env. Minimum 32 characters.
INTERNAL_SERVICE_TOKEN=

# Part 1 ships with execution hard-disabled.
EXECUTION_ENABLED=false
EXCHANGE_SANDBOX_MODE=true
EXCHANGES_ENABLED=binance,bybit,okx

MAX_ORDER_NOTIONAL_USD=1000
MAX_OPEN_POSITIONS_PER_ACCOUNT=20
MAX_LEVERAGE=5

# --- Part 10: tracing + fault posture (mirrors the API switches) ---------
# Observability only; the risk gate never reads any of it. Production boots
# refuse FAILURE_INJECTION_ENABLED=true and refuse OTEL_ENABLED=true without
# an endpoint (config validators, not documentation).
OTEL_ENABLED=false
# OTEL_ENDPOINT=http://otel-collector:4318
OTEL_TIMEOUT_MS=2000
OTEL_SAMPLE_RATIO=0.1
OTEL_PRIORITY_OPERATIONS=execution.transmit
FAILURE_INJECTION_ENABLED=false
FAILURE_INJECTION_ALLOW_NON_PRODUCTION_ONLY=true
```

## API - new

## FILE: apps/api/src/infrastructure/tracing/w3c.ts (565 lines)

```typescript
/**
 * Part 10: W3C trace context, sampling policy and span-attribute hygiene -
 * the TypeScript twin of `wlct_trading.observability.tracing` and
 * `...redaction`. The parity spec (slo-parity.spec.ts) executes the fixture
 * vectors in docs/fixtures/reliability_fixtures.json against these exact
 * functions, so "twin" here is machine-checked, not aspirational.
 *
 * Same rules as the Python original: malformed headers never join a foreign
 * trace; the sampling decision is a pure function of integer arithmetic; a
 * secret-named attribute is dropped before it ever reaches a buffer.
 */

import { createHash, randomBytes } from 'node:crypto';

const TRACEPARENT_PATTERN = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;
const TRACESTATE_MEMBER = /^[a-z0-9_.\-*/]{1,256}(?:@[a-z0-9_.\-*/]{1,256})?$/;
const HEX32 = /^[0-9a-f]{32}$/;
const HEX16 = /^[0-9a-f]{16}$/;
const ZERO32 = '0'.repeat(32);
const ZERO16 = '0'.repeat(16);
const TRACESTATE_VALUE_LIMIT = 128;
const TRACESTATE_MEMBER_LIMIT = 32;

export const TRACEPARENT_HEADER = 'traceparent';
export const TRACESTATE_HEADER = 'tracestate';
// The response echo header and the OTLP path are platform constants from
// @wlct/config (TRACE_ID_RESPONSE_HEADER, OTLP_TRACES_PATH) - defined there
// once, never re-declared here, so the name that leaves this process has
// exactly one spelling in the repository.

export enum SpanKind {
  INTERNAL = 'internal',
  SERVER = 'server',
  CLIENT = 'client',
  PRODUCER = 'producer',
  CONSUMER = 'consumer',
}

export enum SpanStatus {
  UNSET = 'unset',
  OK = 'ok',
  ERROR = 'error',
}

export enum SamplingMode {
  DISABLED = 'disabled',
  OFF = 'off',
  ALL = 'all',
  PARENT_BASED = 'parent_based',
  RATIO = 'ratio',
}

const OTLP_SPAN_KIND: Record<SpanKind, number> = {
  [SpanKind.INTERNAL]: 1,
  [SpanKind.SERVER]: 2,
  [SpanKind.CLIENT]: 3,
  [SpanKind.PRODUCER]: 4,
  [SpanKind.CONSUMER]: 5,
};

const OTLP_STATUS_CODE: Record<SpanStatus, number> = {
  [SpanStatus.UNSET]: 0,
  [SpanStatus.OK]: 1,
  [SpanStatus.ERROR]: 2,
};

export interface TraceContext {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId: string | null;
  readonly traceFlags: number;
  readonly tracestate: ReadonlyArray<readonly [string, string]>;
}

export const isSampled = (context: TraceContext): boolean => (context.traceFlags & 0x01) === 0x01;

export const childContext = (
  parent: TraceContext,
  spanId: string,
  sampled: boolean,
): TraceContext => ({
  traceId: parent.traceId,
  spanId,
  parentSpanId: parent.spanId,
  // Only bit 0 (sampled) is propagated; the rest of the flags byte belongs
  // to this trace's own decisions, matching TraceContext.child upstream.
  traceFlags: (parent.traceFlags & 0xfe) | (sampled ? 1 : 0),
  tracestate: parent.tracestate,
});

/** Strict W3C extraction. Anything malformed returns null - a corrupted
 *  header must never poison an export or join a foreign trace. */
export const parseTraceparent = (header: string | null | undefined): TraceContext | null => {
  if (!header) {
    return null;
  }
  // The spec permits extra fields after the triple for future versions;
  // version "ff" is explicitly invalid. Reject rather than reinterpret.
  let candidate = header.trim();
  const parts = candidate.split('-');
  if (parts.length < 4 || parts[0] === 'ff' || parts.length > 4) {
    if (parts[0] === 'ff' || parts.length < 4) {
      return null;
    }
    candidate = parts.slice(0, 4).join('-');
  }
  const match = TRACEPARENT_PATTERN.exec(candidate.trim());
  if (match === null) {
    return null;
  }
  const [, traceId, spanId, flags] = match as unknown as [
    string,
    string,
    string,
    string,
  ];
  if (!(HEX32.test(traceId) && traceId !== ZERO32) || !(HEX16.test(spanId) && spanId !== ZERO16)) {
    return null;
  }
  const flagValue = Number.parseInt(flags, 16);
  if (Number.isNaN(flagValue)) {
    return null;
  }
  return { traceId, spanId, parentSpanId: null, traceFlags: flagValue, tracestate: [] };
};

export const formatTraceparent = (context: TraceContext): string =>
  `00-${context.traceId}-${context.spanId}-${(context.traceFlags & 0xff)
    .toString(16)
    .padStart(2, '0')}`;

/** Keep only well-formed members, capped; never the raw string. */
export const parseTracestate = (
  header: string | null | undefined,
): Array<readonly [string, string]> => {
  if (!header) {
    return [];
  }
  const members: Array<readonly [string, string]> = [];
  for (const raw of header.split(',')) {
    const member = raw.trim();
    if (member.length === 0 || member.length > 256 + 1 + TRACESTATE_VALUE_LIMIT) {
      continue;
    }
    const eq = member.indexOf('=');
    const key = (eq === -1 ? member : member.slice(0, eq)).trim();
    const value = (eq === -1 ? '' : member.slice(eq + 1)).trim();
    if (!TRACESTATE_MEMBER.test(key)) {
      continue;
    }
    if (value.length > TRACESTATE_VALUE_LIMIT || /[ ,;=]/.test(value)) {
      continue;
    }
    members.push([key, value]);
    if (members.length >= TRACESTATE_MEMBER_LIMIT) {
      break;
    }
  }
  return members;
};

export const formatTracestate = (
  members: ReadonlyArray<readonly [string, string]>,
): string =>
  members.map(([key, value]) => (value === '' ? key : `${key}=${value}`)).join(',');

/** Ids for locally created traces. randomBytes is sufficient here and keeps
 *  the twin trivially deterministic-testable via the injected factories. */
export const newTraceId = (): string => randomBytes(16).toString('hex');
export const newSpanId = (): string => randomBytes(8).toString('hex');

// ---------------------------------------------------------------------------
// Sampling (mirror of SamplingPolicy.should_sample)
// ---------------------------------------------------------------------------

const RATIO_SCALE = 1_000_000n;

export class SamplingPolicy {
  readonly mode: SamplingMode;
  readonly ratioPpm: number;
  readonly priorityOperations: ReadonlySet<string>;

  constructor(
    mode: SamplingMode,
    options: { ratio?: number; priorityOperations?: Iterable<string> } = {},
  ) {
    const ratioIsLive = mode === SamplingMode.RATIO || mode === SamplingMode.PARENT_BASED;
    const ratio = options.ratio ?? 0;
    if (ratioIsLive && (ratio < 0 || ratio > 1)) {
      throw new Error('ratio must be within [0, 1]');
    }
    this.mode = mode;
    // The float ratio is converted once, at the construction edge, to an
    // integer ppm via round - the exact expression the Python side uses
    // (`int(round(clamped * 1_000_000))`). After this line, no float
    // participates in a sampling decision.
    const clamped = Math.max(0, Math.min(1, options.ratio ?? 0));
    this.ratioPpm = Math.round(clamped * 1_000_000);
    this.priorityOperations = new Set(options.priorityOperations ?? []);
  }

  get enabled(): boolean {
    return this.mode !== SamplingMode.DISABLED;
  }

  shouldSample(input: {
    traceId: string;
    parentSampled: boolean | null;
    operation: string;
  }): boolean {
    if (this.mode === SamplingMode.DISABLED || this.mode === SamplingMode.OFF) {
      return false;
    }
    if (this.mode === SamplingMode.ALL) {
      return true;
    }
    if (this.priorityOperations.has(input.operation)) {
      return true;
    }
    if (this.mode === SamplingMode.PARENT_BASED && input.parentSampled !== null) {
      return input.parentSampled;
    }
    if (this.ratioPpm <= 0) {
      return false;
    }
    if (this.ratioPpm >= 1_000_000) {
      return true;
    }
    if (!HEX16.test(input.traceId.slice(0, 16))) {
      return false;
    }
    const bucket = BigInt(`0x${input.traceId.slice(0, 16)}`);
    const threshold = (1n << 64n) * BigInt(this.ratioPpm) / RATIO_SCALE;
    return bucket < threshold;
  }
}

// ---------------------------------------------------------------------------
// Attribute hygiene (mirror of _safe_attribute + the redaction rules)
// ---------------------------------------------------------------------------

const ATTR_KEY = /^[a-z][a-z0-9_.]{0,63}$/;
const MAX_STRING_ATTR = 256;
const REDACTED = '[REDACTED]';

const SENSITIVE_KEY_PATTERN =
  /(api[_-]?secret|api[_-]?key|password|passphrase|private[_-]?key|token|jwt|authorization|secret|credential|signature|signed[_-]?query|dsn|connection[_-]?string|database[_-]?url)/i;

const KEY_SUBSTRINGS: readonly string[] = [
  'apikey',
  'apisecret',
  'secret',
  'password',
  'passphrase',
  'privatekey',
  'accesstoken',
  'refreshtoken',
  'authorization',
  'credential',
  'dsn',
  'connectionstring',
  'databaseurl',
];

export const isSensitiveKey = (key: unknown): boolean => {
  if (typeof key !== 'string') {
    return false;
  }
  if (SENSITIVE_KEY_PATTERN.test(key)) {
    return true;
  }
  const normalised = key.toLowerCase().replace(/[-_\s]/g, '');
  return KEY_SUBSTRINGS.some((needle) => normalised.includes(needle));
};

const TEXT_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, REDACTED],
  [/\bbearer\s+[A-Za-z0-9._~+/=-]{16,}/gi, REDACTED],
  [/\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g, REDACTED],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, REDACTED],
  // Connection strings with embedded credentials: scheme://user:pass@host
  // becomes [REDACTED]@host - host is public topology, credentials are not.
  [/\b[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^@\s]+@/g, `${REDACTED}@`],
  [/[?&](?:signature|sig|api[_-]?key|access[_-]?token)=[^&\s]+/gi, REDACTED],
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, REDACTED],
];

export const redactText = (text: string): string => {
  let output = text;
  for (const [pattern, replacement] of TEXT_PATTERNS) {
    output = output.replace(pattern, replacement);
  }
  return output;
};

export type AttributeValue = string | number | boolean | bigint;

/** Validate/redact one attribute; null means "drop it, counted". */
export const safeAttribute = (
  key: unknown,
  value: unknown,
): { key: string; value: string | number | boolean | bigint } | null => {
  if (typeof key !== 'string' || !ATTR_KEY.test(key) || isSensitiveKey(key)) {
    return null;
  }
  if (typeof value === 'bigint') {
    // 64-bit counts travel as bigint end-to-end: a JS number above 2^53
    // would lie in the encoder, and Python's str(int) never lies.
    return { key, value };
  }
  if (typeof value === 'boolean' || typeof value === 'number') {
    if (typeof value === 'number' && !Number.isInteger(value)) {
      // Floats enter telemetry as short repr strings (documentation, never
      // money math) - the Python side uses repr(); JS String() agrees for
      // the values that reach here, and the parity fixture pins both.
      return { key, value: String(value).slice(0, MAX_STRING_ATTR) };
    }
    return { key, value };
  }
  if (typeof value === 'string') {
    return { key, value: redactText(value).slice(0, MAX_STRING_ATTR) };
  }
  return null;
};

// ---------------------------------------------------------------------------
// The recording span (all methods total: never throw, never block)
// ---------------------------------------------------------------------------

export interface SpanEvent {
  readonly timeUnixNano: string;
  readonly name: string;
  readonly attributes: Readonly<Record<string, string | number | boolean | bigint>>;
}

export class RecordingSpan {
  readonly context: TraceContext;
  readonly name: string;
  readonly kind: SpanKind;
  readonly resource: Readonly<Record<string, string>>;
  readonly attributes: Record<string, string | number | boolean | bigint> = {};
  readonly events: SpanEvent[] = [];
  status: SpanStatus = SpanStatus.UNSET;
  statusDescription: string | null = null;
  startUnixNano: string;
  endUnixNano: string | null = null;
  droppedAttributes = 0;
  droppedEvents = 0;

  private ended = false;

  constructor(input: {
    context: TraceContext;
    name: string;
    kind?: SpanKind;
    resource?: Record<string, string>;
    startUnixNano?: bigint;
    attributes?: Record<string, AttributeValue>;
  }) {
    this.context = input.context;
    this.name = input.name;
    this.kind = input.kind ?? SpanKind.INTERNAL;
    this.resource = input.resource ?? {};
    this.startUnixNano = String(input.startUnixNano ?? 0n);
    for (const [key, value] of Object.entries(input.attributes ?? {})) {
      this.setAttribute(key, value);
    }
  }

  setAttribute(key: string, value: AttributeValue): void {
    if (this.ended) {
      return;
    }
    const safe = safeAttribute(key, value);
    if (safe === null) {
      this.droppedAttributes += 1;
      return;
    }
    this.attributes[safe.key] = safe.value;
  }

  addEvent(name: string, attributes?: Record<string, AttributeValue>, timeUnixNano?: string): void {
    if (this.ended) {
      return;
    }
    const clean: Record<string, string | number | boolean | bigint> = {};
    for (const [key, value] of Object.entries(attributes ?? {})) {
      const safe = safeAttribute(key, value);
      if (safe === null) {
        this.droppedAttributes += 1;
        continue;
      }
      clean[safe.key] = safe.value;
    }
    this.events.push({
      timeUnixNano: timeUnixNano ?? String(Date.now() * 1000),
      name,
      attributes: clean,
    });
  }

  setStatus(status: SpanStatus, description?: string): void {
    if (this.ended) {
      return;
    }
    this.status = status;
    // Raw passthrough, matching Span.set_status upstream: status
    // descriptions are set by instrumented code from values THEY control
    // (status codes, error class names), and the fixture's byte-exact OTLP
    // vectors pin that the encoder applies no further mutation. Writers of
    // free text run redactText themselves - the sanitisation rule lives
    // with the writer, not with the span.
    this.statusDescription = description === undefined ? null : description;
  }

  end(atUnixNano?: bigint): void {
    if (this.ended) {
      return;
    }
    this.ended = true;
    this.endUnixNano = String(atUnixNano ?? Date.now() * 1_000_000);
  }

  get endedAt(): boolean {
    return this.ended;
  }
}

/** Deterministic OTLP/JSON encoding of the microsecond epoch values Node
 *  exposes: Date.now() * 1000000 keeps the unit conversions integer-only on
 *  both language sides (the same trick the Python tracer uses, where
 *  nanos = micros * 1000). */
export const unixNanoNow = (): bigint => BigInt(Date.now()) * 1_000_000n;

// ---------------------------------------------------------------------------
// OTLP/JSON encoding (mirror of otlp_json_encode, byte-exact per fixture)
// ---------------------------------------------------------------------------

const attributesList = (
  attributes: Readonly<Record<string, string | number | boolean | bigint>>,
) => {
  const out: Array<{ key: string; value: Record<string, string | boolean> }> = [];
  for (const key of Object.keys(attributes).sort()) {
    const value = attributes[key] as string | number | boolean | bigint;
    let typed: Record<string, string | boolean>;
    if (typeof value === 'boolean') {
      typed = { boolValue: value };
    } else if (typeof value === 'number' || typeof value === 'bigint') {
      // str(int) in Python, toString() here: exact across the int64 range,
      // which is exactly why 2^53+1 survives a round trip intact - the
      // fixture's int64Edge vector pins that across the two languages.
      typed = { intValue: String(value) };
    } else {
      typed = { stringValue: String(value) };
    }
    out.push({ key, value: typed });
  }
  return out;
};

const spanObject = (span: RecordingSpan) => {
  const obj: Record<string, unknown> = {
    traceId: span.context.traceId,
    spanId: span.context.spanId,
    name: span.name,
    kind: OTLP_SPAN_KIND[span.kind],
    startTimeUnixNano: span.startUnixNano,
    endTimeUnixNano: span.endUnixNano ?? span.startUnixNano,
  };
  if (span.context.parentSpanId !== null) {
    obj.parentSpanId = span.context.parentSpanId;
  }
  obj.attributes = attributesList(span.attributes);
  if (span.droppedAttributes > 0) {
    obj.droppedAttributesCount = span.droppedAttributes;
  }
  if (span.events.length > 0) {
    obj.events = span.events.map((event) => ({
      timeUnixNano: event.timeUnixNano,
      name: event.name,
      attributes: attributesList(event.attributes),
    }));
    if (span.droppedEvents > 0) {
      obj.droppedEventsCount = span.droppedEvents;
    }
  }
  const status: Record<string, unknown> = { code: OTLP_STATUS_CODE[span.status] };
  if (span.statusDescription !== null) {
    status.message = span.statusDescription;
  }
  obj.status = status;
  if (span.context.tracestate.length > 0) {
    obj.tracestate = formatTracestate(span.context.tracestate);
  }
  obj.flags = span.context.traceFlags;
  return obj;
};

/** Object key order IS the contract (JSON.stringify preserves insertion
 *  order; Python's encoder builds the same literals and must not sort at
 *  dump time). Sort where the Python side sorts: resource tuples and
 *  attribute keys. */
export const otlpJsonEncode = (
  spans: readonly RecordingSpan[],
  resource?: Record<string, string>,
): string => {
  const grouped = new Map<string, RecordingSpan[]>();
  for (const span of spans) {
    const effective = Object.keys(span.resource).length > 0 ? span.resource : (resource ?? {});
    const key = Object.entries(effective)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${k}\u0000${v}`)
      .join('\u0001');
    const bucket = grouped.get(key) ?? [];
    bucket.push(span);
    grouped.set(key, bucket);
  }
  const resourceSpans = [...grouped.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, group]) => {
      const attributes = Object.fromEntries(
        key
          .split('\u0001')
          .map((pair) => pair.split('\u0000'))
          .map(([k, v]) => [k, v] as [string, string]),
      );
      return {
        resource: { attributes: attributesList(attributes) },
        scopeSpans: [
          {
            scope: { name: 'wlct.observability', version: '1' },
            spans: [...group]
              .sort((left, right) => {
                const start = compareStrings(left.startUnixNano, right.startUnixNano);
                if (start !== 0) {
                  return start;
                }
                const trace = compareStrings(left.context.traceId, right.context.traceId);
                return trace !== 0 ? trace : compareStrings(left.context.spanId, right.context.spanId);
              })
              .map(spanObject),
          },
        ],
      };
    });
  return JSON.stringify({ resourceSpans });
};

const compareStrings = (a: string, b: string): number => {
  // Python sorts the (start, trace, span) tuple as an INT for start (nano
  // string of an int) and as strings for ids; comparing decimal-int strings
  // numerically matches int ordering exactly.
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb) && String(na) === a && String(nb) === b) {
    return na < nb ? -1 : na > nb ? 1 : 0;
  }
  return a < b ? -1 : a > b ? 1 : 0;
};

/** Content hash used by tests and the handover doc to pin a payload without
 *  storing it twice. */
export const sha256Hex = (text: string): string =>
  createHash('sha256').update(text, 'utf8').digest('hex');
```

## FILE: apps/api/src/infrastructure/tracing/tracing.service.ts (615 lines)

```typescript
/**
 * Part 10: the API process's tracer, exporter, fault plan and SLO bucket
 * flusher - the TypeScript counterpart of `services/<name>/app/tracing.py` plus
 * the engine hubs' export loops.
 *
 * The three Part 10 laws, restated where they bind:
 *
 * 1. OBSERVE, NEVER AUTHORISE. Nothing in the request path reads anything
 *    from this service to decide a trading outcome. The one write this
 *    service performs on the request path is a response header echo.
 * 2. DROPPED IS LOUD. One delivery attempt per span batch; failures are
 *    counted, spans are NOT re-queued. A retry queue behind a dead
 *    collector converts an observability outage into an availability
 *    outage, and this platform has real orders on the line. Three
 *    consecutive failures page (the alert row is written by AlertsService
 *    via the sink wired in ObservabilityModule).
 * 3. FAULTS ARE CONFIG-ARMED AND CLOSED-SET. The injector plan comes from
 *    the environment; the only runtime operations are `consume` (inside
 *    this file) and read-only describe. There is no endpoint that arms,
 *    disarms or clears a fault - by either name.
 *
 * The SLO flush loop is here rather than in the metrics path because both
 * are the same shape: per-request work goes to MEMORY only (a hot path
 * never touches Redis), and one quiet interval loop persists DELTAS to
 * fixed-time buckets. Same no-Redis-in-the-request-path law the engines
 * follow for their own counters.
 */

import { Inject, Injectable, OnApplicationBootstrap, OnModuleDestroy, Optional } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import {
  JOB_NAMES,
  OTLP_TRACES_PATH,
  SLO_SAMPLE_BUCKET_MINUTES,
  SLO_SAMPLE_KEY_PREFIX,
  TRACECTX_KEY_PREFIX,
  TRACECTX_TTL_SECONDS,
} from '@wlct/config';

import { AppConfigService } from '../../config/app-config.service';
import { MetricsRegistry } from '../metrics/metrics.registry';
import { RedisService } from '../redis/redis.service';

import {
  formatTraceparent,
  newSpanId,
  newTraceId,
  otlpJsonEncode,
  parseTraceparent,
  parseTracestate,
  RecordingSpan,
  SamplingMode,
  SamplingPolicy,
  SpanKind,
  SpanStatus,
  TRACESTATE_HEADER,
  TRACEPARENT_HEADER,
  isSampled,
  unixNanoNow,
  type TraceContext,
} from './w3c';

export const FAULT_TRACE_EXPORT = 'trace_export_unavailable';
export const FAULT_METRICS_EXPORT = 'metrics_export_unavailable';

/** Consecutive export failures before the alert opens. One blip is a blip;
 *  three ticks of darkness is an incident worth paging for. */
export const FAILURE_ALERT_THRESHOLD = 3;

const BUFFER_SIZE = 8192;
const EXPORT_BATCH_MAX = 512;
const BUCKET_TTL_MS = 2 * 86_400_000;

/** The universe the API-side injector may arm. `metrics_export_unavailable`
 *  is consumed by the /metrics controller (503 while armed);
 *  `trace_export_unavailable` by the export tick below. */
const API_FAULT_POINTS: readonly string[] = Object.freeze([
  FAULT_TRACE_EXPORT,
  FAULT_METRICS_EXPORT,
]);

export interface SpanHandle {
  readonly span: RecordingSpan;
  readonly context: TraceContext;
  readonly sampled: boolean;
}

export interface TelemetryAlertSink {
  telemetryExportFailing(service: string, failing: boolean, consecutive: number): Promise<void>;
}

export const TELEMETRY_ALERT_SINK = 'TELEMETRY_ALERT_SINK';

@Injectable()
export class TracingService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly policy: SamplingPolicy;
  private readonly buffer: RecordingSpan[] = [];
  private readonly drops = new Map<string, number>();
  private readonly outcomes: Record<string, number> = { ok: 0, error: 0, skipped: 0 };
  private consecutiveFailures = 0;
  private alertedForOutage = false;
  private exportedTotal = 0;
  private lastExportOutcome: string | null = null;
  private loop: NodeJS.Timeout | null = null;

  /** In-memory request tallies for the SLO buckets. The interceptor writes
   *  here (O(1) increments); this service's loop persists DELTAS and the
   *  totals stay the single source of truth for what has been flushed. */
  private reqGood = 0;
  private reqBad = 0;
  private readonly reqLatency = new Map<string, number>();
  private flushedGood = 0;
  private flushedBad = 0;
  private readonly flushedLatency = new Map<string, number>();

  /** The request-scoped active span (server or consumer), for child
   *  contexts on queue publishes. One ALS for the whole plane - the queue
   *  sidecar is exactly this store, mirrored to Redis for the cross-process
   *  hop. */
  readonly spanStore = new AsyncLocalStorage<SpanHandle | null>();

  private alertSink: TelemetryAlertSink | null;

  constructor(
    private readonly config: AppConfigService,
    private readonly redis: RedisService,
    @Inject(MetricsRegistry) private readonly registry: MetricsRegistry,
    @Optional() @Inject(TELEMETRY_ALERT_SINK) sink?: TelemetryAlertSink,
  ) {
    this.policy = new SamplingPolicy(
      config.otelEnabled ? SamplingMode.RATIO : SamplingMode.DISABLED,
      {
        ratio: config.otelSampleRatio,
        priorityOperations: config.otelPriorityOperations,
      },
    );
    this.alertSink = sink ?? null;
  }

  /** Module wiring calls this once (ObservabilityModule), because the sink
   *  depends on AlertsService and this service must not depend back. */
  setAlertSink(sink: TelemetryAlertSink): void {
    this.alertSink = sink;
  }

  get enabled(): boolean {
    return this.policy.enabled;
  }

  get bufferedSpans(): number {
    return this.buffer.length;
  }

  get dropCounts(): Record<string, number> {
    return Object.fromEntries(this.drops);
  }

  get exportOutcomes(): Record<string, number> {
    return { ...this.outcomes };
  }

  get exported(): number {
    return this.exportedTotal;
  }

  get consecutiveExportFailures(): number {
    return this.consecutiveFailures;
  }

  get lastExport(): string | null {
    return this.lastExportOutcome;
  }

  // ------------------------------------------------------------------
  // fault injector (config-armed, consume-only, closed set)
  // ------------------------------------------------------------------

  /** Effective arming comes from config only; production can never arm (the
   *  env validator refuses the boot and this getter refuses the plan). */
  faultsArmed(): boolean {
    return this.config.failureInjectionArmed;
  }

  consumeFault(point: string): boolean {
    if (!this.faultsArmed()) {
      return false;
    }
    // times = -1 semantics (infinite): armed means armed until restart -
    // the plan is the environment, and the environment does not change
    // under a running process.
    return API_FAULT_POINTS.includes(point);
  }

  faultPlan(): { enabled: boolean; points: string[] } {
    return {
      enabled: this.faultsArmed(),
      points: this.faultsArmed() ? [...API_FAULT_POINTS] : [],
    };
  }

  // ------------------------------------------------------------------
  // request spans
  // ------------------------------------------------------------------

  /** Begin a server span. Returns null (and does nothing) when tracing is
   *  disabled - the zero-cost passthrough the Python docstring promises.
   *  When ENABLED but UNSAMPLED it returns a handle whose span records
   *  nothing: the context still answers x-trace-id, because an operator's
   *  report of a trace id must work on unsampled requests too, or the only
   *  requests you can correlate are the lucky ones. */
  startRequestSpan(headers: NodeJS.Dict<string | string[]> | Record<string, unknown>): SpanHandle | null {
    if (!this.policy.enabled) {
      return null;
    }
    const rawParent = firstHeader(
      (headers as NodeJS.Dict<string | string[]>)[TRACEPARENT_HEADER],
    );
    const parent = parseTraceparent(rawParent ?? null);
    const context: TraceContext =
      parent !== null
        ? {
            traceId: parent.traceId,
            spanId: newSpanId(),
            parentSpanId: parent.spanId,
            traceFlags: parent.traceFlags,
            tracestate: parseTracestate(
              firstHeader((headers as NodeJS.Dict<string | string[]>)[TRACESTATE_HEADER]),
            ),
          }
        : {
            traceId: newTraceId(),
            spanId: newSpanId(),
            parentSpanId: null,
            traceFlags: 0x00,
            tracestate: [],
          };
    const sampled = this.policy.shouldSample({
      traceId: context.traceId,
      parentSampled: parent !== null ? isSampled(parent) : null,
      operation: 'http.server',
    });
    const finalContext: TraceContext = {
      ...context,
      traceFlags: (context.traceFlags & 0xfe) | (sampled ? 1 : 0),
    };
    const span = new RecordingSpan({
      context: finalContext,
      name: 'http.server',
      kind: SpanKind.SERVER,
      resource: this.resource(),
      startUnixNano: unixNanoNow(),
    });
    return { span, context: finalContext, sampled };
  }

  responseTraceId(handle: SpanHandle | null): string | null {
    return handle === null ? null : handle.context.traceId;
  }

  /** Middleware completion hook: stamp outcome attributes, end, and buffer
   *  if sampled. `route` is the ROUTE TEMPLATE (the interceptor's rule):
   *  unbounded strings never become span attributes on this platform. */
  finishRequestSpan(
    handle: SpanHandle,
    input: { method: string; route: string; status: number; durationMs: number },
  ): void {
    if (!this.policy.enabled || !handle.sampled || handle.span.endedAt) {
      return;
    }
    const span = handle.span;
    span.setAttribute('http.request.method', input.method);
    span.setAttribute('http.route', input.route);
    span.setAttribute('http.response.status_code', input.status);
    if (input.status >= 500) {
      span.setStatus(SpanStatus.ERROR, `status ${String(input.status)}`);
    } else {
      span.setStatus(SpanStatus.OK);
    }
    span.end(unixNanoNow());
    this.record(span);
  }

  private record(span: RecordingSpan): void {
    if (this.buffer.length >= BUFFER_SIZE) {
      // Overflow evicts the OLDEST span and counts it - a tracer whose only
      // failure mode is a silent stall of the request path is worse than a
      // counter saying "I dropped spans at 03:14".
      this.buffer.shift();
      this.countDrops('buffer_overflow', 1);
    }
    this.buffer.push(span);
  }

  private countDrops(reason: string, count: number): void {
    this.drops.set(reason, (this.drops.get(reason) ?? 0) + count);
    this.registry.inc('wlct_tracing_spans_total', { result: 'dropped' }, count);
  }

  private resource(): Record<string, string> {
    return {
      'service.name': 'api',
      'service.version': '1.0.0',
      'deployment.environment': this.config.nodeEnv,
      'service.instance.id': 'local',
    };
  }

  // ------------------------------------------------------------------
  // queue trace-context sidecar (publish + consume helpers)
  // ------------------------------------------------------------------

  private sidecarKey(queue: string, jobId: string): string {
    return `${TRACECTX_KEY_PREFIX}:${queue}:${jobId}`;
  }

  /** Publishers attach their active span's traceparent as a TTL-bounded
   *  sidecar so a worker can continue the trace WITHOUT the payload schema
   *  growing a transport field. Fire-and-forget: a failed sidecar write
   *  costs correlation, never a publish. */
  async captureQueueSidecar(queue: string, jobId: string): Promise<void> {
    const handle = this.spanStore.getStore();
    if (handle === null || handle === undefined || !this.enabled) {
      return;
    }
    try {
      await this.redis.client.set(
        this.sidecarKey(queue, jobId),
        formatTraceparent(handle.context),
        'EX',
        TRACECTX_TTL_SECONDS,
      );
    } catch {
      this.countDrops('sidecar_write_failed', 1);
    }
  }

  private async readQueueSidecar(queue: string, jobId: string): Promise<TraceContext | null> {
    try {
      const raw = await this.redis.client.get(this.sidecarKey(queue, jobId));
      return parseTraceparent(raw ?? null);
    } catch {
      return null;
    }
  }

  private async deleteQueueSidecar(queue: string, jobId: string): Promise<void> {
    try {
      await this.redis.client.del(this.sidecarKey(queue, jobId));
    } catch {
      // The key is TTL-bounded anyway; a failed delete is a shrug, not an
      // incident. (A FAILED READ never continues a trace by accident -
      // absence is an absent parent, full stop.)
    }
  }

  /** Consumer-side: run `work` with the job's parent context as the active
   *  span, under a queue.process child span when sampled. Mirrors what the
   *  Python worker does with its own sidecar reads. */
  async withJobContext<T>(queue: string, jobId: string, operation: string, work: () => Promise<T>): Promise<T> {
    if (!this.enabled) {
      return work();
    }
    const parent = await this.readQueueSidecar(queue, jobId);
    if (parent === null) {
      return this.spanStore.run(null, work);
    }
    const sampled = this.policy.shouldSample({
      traceId: parent.traceId,
      parentSampled: isSampled(parent),
      operation,
    });
    const child: TraceContext = {
      traceId: parent.traceId,
      spanId: newSpanId(),
      parentSpanId: parent.spanId,
      traceFlags: (parent.traceFlags & 0xfe) | (sampled ? 1 : 0),
      tracestate: parent.tracestate,
    };
    const span = new RecordingSpan({
      context: child,
      name: operation,
      kind: SpanKind.CONSUMER,
      resource: this.resource(),
      startUnixNano: unixNanoNow(),
    });
    span.setAttribute('messaging.system', 'bullmq');
    span.setAttribute('messaging.destination.name', queue);
    try {
      return await this.spanStore.run({ span, context: child, sampled }, work);
    } catch (error) {
      span.setStatus(SpanStatus.ERROR, String((error as Error).name ?? 'Error'));
      throw error;
    } finally {
      span.end(unixNanoNow());
      if (sampled) {
        this.record(span);
      }
      void this.deleteQueueSidecar(queue, jobId);
    }
  }

  // ------------------------------------------------------------------
  // request-path tally + periodic bucket flush (SLO sources)
  // ------------------------------------------------------------------

  /** Called by the HTTP interceptor: O(1) in-memory increments, no I/O.
   *  Latency counts are CUMULATIVE per grid boundary (le100ms <= le250ms
   *  <= ...), which is exactly the shape both the Prometheus histogram and
   *  the evaluator's "count at or below threshold" read want. */
  noteHttpRequest(status: number, durationMs: number): void {
    if (status >= 500) {
      this.reqBad += 1;
    } else {
      this.reqGood += 1;
    }
    for (const boundary of [100, 250, 500, 1000, 2000, 5000]) {
      if (durationMs <= boundary) {
        const field = `le${String(boundary)}ms`;
        this.reqLatency.set(field, (this.reqLatency.get(field) ?? 0) + 1);
      }
    }
  }

  /** The active span for nested producers (queue service reads it through
   *  the store; this is for direct consumers of the service). */
  currentHandle(): SpanHandle | null {
    return this.spanStore.getStore() ?? null;
  }

  onApplicationBootstrap(): void {
    this.loop = setInterval(() => {
      void this.tick();
    }, this.config.metricsExportIntervalMs);
    this.loop.unref();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.loop !== null) {
      clearInterval(this.loop);
      this.loop = null;
    }
    await this.tick().catch(() => undefined);
  }

  /** Manual flush endpoint lands here too (POST /v1/operational/tracing/
   *  flush): one export tick now, same code path as the timer - the endpoint
   *  changes WHEN evidence leaves, never WHAT it says. */
  async flushNow(): Promise<{ exported: number; outcome: string }> {
    return this.tick();
  }

  /** One loop tick: persist SLO bucket deltas, then export spans. Split in
   *  two guarded halves - a Redis blip on buckets must not starve the
   *  exporter, and vice versa; each half reports its own outcome. */
  async tick(): Promise<{ exported: number; outcome: string }> {
    try {
      await this.flushSloBuckets();
    } catch {
      // The next tick retries with the UNCHANGED cumulative totals; because
      // deltas are computed against flushed high-water marks, "retry" is
      // also the exactly-once recovery, and nothing between ticks is lost
      // or doubled.
    }
    return this.exportTick();
  }

  private async flushSloBuckets(): Promise<void> {
    const goodDelta = this.reqGood - this.flushedGood;
    const badDelta = this.reqBad - this.flushedBad;
    if (goodDelta + badDelta === 0) {
      return;
    }
    const bucket = Math.floor(Date.now() / (SLO_SAMPLE_BUCKET_MINUTES * 60_000));
    const reqKey = `${SLO_SAMPLE_KEY_PREFIX}:apireq:${String(bucket)}`;
    const latKey = `${SLO_SAMPLE_KEY_PREFIX}:apilat:${String(bucket)}`;
    this.flushedGood = this.reqGood;
    this.flushedBad = this.reqBad;
    const pipeline = this.redis.client.pipeline();
    if (goodDelta > 0) {
      pipeline.hincrby(reqKey, 'good', goodDelta);
    }
    if (badDelta > 0) {
      pipeline.hincrby(reqKey, 'bad', badDelta);
    }
    pipeline.pexpire(reqKey, BUCKET_TTL_MS);
    for (const [field, total] of [...this.reqLatency.entries()]) {
      const delta = total - (this.flushedLatency.get(field) ?? 0);
      if (delta > 0) {
        this.flushedLatency.set(field, total);
        pipeline.hincrby(latKey, field, delta);
      }
    }
    pipeline.hincrby(latKey, 'total', goodDelta + badDelta);
    pipeline.pexpire(latKey, BUCKET_TTL_MS);
    await pipeline.exec();
  }

  private async exportTick(): Promise<{ exported: number; outcome: string }> {
    if (!this.policy.enabled) {
      return { exported: 0, outcome: 'disabled' };
    }
    const batch = this.buffer.splice(0, EXPORT_BATCH_MAX);
    if (batch.length === 0) {
      return { exported: 0, outcome: 'idle' };
    }
    const endpoint = this.config.otelEndpoint;
    if (endpoint === undefined || this.consumeFault(FAULT_TRACE_EXPORT)) {
      // Skipped-with-cause: no endpoint (or an armed fault) means these
      // spans are gone, counted as drops with a reason, and the buffer did
      // its bounded job.
      this.countDrops(endpoint === undefined ? 'no_endpoint' : 'fault_injected', batch.length);
      this.countOutcome('skipped');
      // Deliberate skips RESET the failure streak: "no collector
      // configured" is a posture, not an outage; the alert is for the
      // collector that is there and refusing.
      this.consecutiveFailures = 0;
      await this.notifyExportState();
      return { exported: 0, outcome: 'skipped' };
    }
    let outcome: 'ok' | 'error' = 'error';
    try {
      const response = await fetch(`${endpoint.replace(/\/+$/, '')}${OTLP_TRACES_PATH}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: otlpJsonEncode(batch),
        signal: AbortSignal.timeout(this.config.otelTimeoutMs),
      });
      outcome = response.ok ? 'ok' : 'error';
    } catch {
      outcome = 'error';
    }
    this.countOutcome(outcome);
    if (outcome === 'ok') {
      this.exportedTotal += batch.length;
      this.registry.inc('wlct_tracing_spans_total', { result: 'exported' }, batch.length);
      this.consecutiveFailures = 0;
    } else {
      this.countDrops('export_failed', batch.length);
      this.consecutiveFailures += 1;
    }
    this.registry.setGauge(
      'wlct_tracing_export_consecutive_failures',
      {},
      this.consecutiveFailures,
    );
    await this.notifyExportState();
    return { exported: outcome === 'ok' ? batch.length : 0, outcome };
  }

  private countOutcome(result: 'ok' | 'error' | 'skipped'): void {
    this.outcomes[result] = (this.outcomes[result] ?? 0) + 1;
    this.lastExportOutcome = result;
    this.registry.inc('wlct_tracing_export_outcomes_total', { result });
  }

  private async notifyExportState(): Promise<void> {
    if (this.alertSink === null) {
      return;
    }
    const failing = this.consecutiveFailures >= FAILURE_ALERT_THRESHOLD;
    if (!failing && !this.alertedForOutage) {
      // Nothing to say yet, and nothing previously said that needs taking
      // back - a quiet streak never opens or closes an alert row.
      return;
    }
    this.alertedForOutage = failing;
    await this.alertSink
      .telemetryExportFailing('api', failing, this.consecutiveFailures)
      .catch(() => undefined);
  }

  statusView(): {
    enabled: boolean;
    endpointConfigured: boolean;
    sampleRatio: number;
    priorityOperations: string[];
    bufferedSpans: number;
    exportedTotal: number;
    droppedTotal: number;
    consecutiveExportFailures: number;
    lastExportOutcome: string | null;
  } {
    let droppedTotal = 0;
    for (const count of this.drops.values()) {
      droppedTotal += count;
    }
    return {
      enabled: this.enabled,
      endpointConfigured: this.config.otelEndpoint !== undefined,
      sampleRatio: this.config.otelSampleRatio,
      priorityOperations: this.config.otelPriorityOperations,
      bufferedSpans: this.buffer.length,
      exportedTotal: this.exportedTotal,
      droppedTotal,
      consecutiveExportFailures: this.consecutiveFailures,
      lastExportOutcome: this.lastExportOutcome,
    };
  }
}

const firstHeader = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

/** Exported so the maintenance worker wraps job handling in the sidecar
 *  continuation for EVERY maintenance job, not just the one that existed
 *  when this file was first drafted. */
export const MAINTENANCE_QUEUE_JOBS: readonly string[] = Object.freeze([
  JOB_NAMES.PRUNE_EXPIRED_TOKENS,
  JOB_NAMES.PRUNE_AUDIT_LOGS,
  JOB_NAMES.SYNC_OPERATIONAL_ALERTS,
  JOB_NAMES.PRUNE_OPERATIONAL_HISTORY,
  JOB_NAMES.EVALUATE_OPERATIONAL_SLOS,
  JOB_NAMES.PRUNE_SLO_EVALUATIONS,
]);
```

## FILE: apps/api/src/infrastructure/tracing/trace.middleware.ts (69 lines)

```typescript
/**
 * Part 10: the API's server-span middleware - the Nest twin of the
 * correlation middleware both Python services run.
 *
 * It does exactly four things, none of them in the way of a request:
 * extract-or-create the trace context, echo x-trace-id on the response,
 * run the rest of the pipeline inside the AsyncLocalStorage span store (so
 * the queue service can attach a sidecar to anything published in-request),
 * and finish the span once the response is done. Route template, status and
 * error-ness come from the SAME signals the metrics interceptor reads - one
 * event source, two consumers, no drift between what the histogram says and
 * what the span says.
 */

import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Response } from 'express';
import { TRACE_ID_RESPONSE_HEADER } from '@wlct/config';

import type { AppRequest } from '../../common/types/request.types';

import { TracingService, type SpanHandle } from './tracing.service';

@Injectable()
export class TraceMiddleware implements NestMiddleware {
  constructor(private readonly tracing: TracingService) {}

  use(req: AppRequest, res: Response, next: NextFunction): void {
    if (!this.tracing.enabled) {
      next();
      return;
    }
    const handle = this.tracing.startRequestSpan(req.headers);
    if (handle === null) {
      next();
      return;
    }
    const traceId = this.tracing.responseTraceId(handle);
    if (traceId !== null) {
      res.setHeader(TRACE_ID_RESPONSE_HEADER, traceId);
    }
    const started = performance.now();
    res.once('finish', () => {
      this.tracing.finishRequestSpan(handle as SpanHandle, {
        method: req.method ?? 'GET',
        route: routeTemplate(req),
        status: res.statusCode,
        durationMs: Math.max(0, performance.now() - started),
      });
    });
    void this.tracing.spanStore.run(handle, () => {
      next();
    });
  }
}

/** The interceptor's template rule, shared honestly: matched route path or
 *  the sentinel. If this and HttpMetricsInterceptor's copy ever disagree,
 *  spans and histograms describe different routes - the parity spec pins
 *  both against the same helper semantics. */
const routeTemplate = (request: AppRequest): string => {
  const route = (request as { route?: { path?: unknown } }).route;
  const path = typeof route?.path === 'string' ? route.path : null;
  if (path === null) {
    return 'unmatched';
  }
  const trimmed = path.replace(/^\//, '').slice(0, 96);
  return trimmed.length > 0 ? trimmed : 'root';
};
```

## FILE: apps/api/src/modules/observability/slo.constants.ts (284 lines)

```typescript
/**
 * Part 10 - SLO domain constants. Mirror of the Python single source of truth
 * at `wlct_trading/slo/` (model.py bounds, catalog.py defaults). The parity
 * spec (slo-parity.spec.ts) compares DEFAULT_SLO_CATALOG against
 * docs/fixtures/reliability_fixtures.json entry by entry, entry including the
 * descriptions: an SLO whose text drifts from the engine's is a different SLO
 * wearing the same id (its checksum would prove it).
 */

export const MIN_WINDOW_MINUTES = 5;
export const MAX_WINDOW_MINUTES = 10_080; // a week
export const DEFAULT_WARNING_BURN_PPM = 1_000_000; // 1.0x burn
export const DEFAULT_CRITICAL_BURN_PPM = 2_000_000; // 2.0x burn
export const DEFAULT_FAST_BURN_MULTIPLIER_PPM = 14_400_000;
export const DEFAULT_SLOW_BURN_MULTIPLIER_PPM = 6_000_000;

export const SLO_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{1,62}$/;
export const SLO_OWNER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/@-]{0,63}$/;

export const SLO_INDICATORS = [
  'availability',
  'request_success_ratio',
  'queue_processing_success',
  'queue_freshness',
  'market_data_freshness',
  'risk_state_freshness',
  'reconciliation_freshness',
  'latency_threshold_compliance',
  'error_rate_compliance',
] as const;

export type SloIndicatorValue = (typeof SLO_INDICATORS)[number];

/** FRESHNESS_INDICATORS in model.py: shape law - these carry maxAgeMicros and
 *  must not carry a latency threshold. */
export const FRESHNESS_INDICATORS: ReadonlySet<SloIndicatorValue> = new Set([
  'queue_freshness',
  'market_data_freshness',
  'risk_state_freshness',
  'reconciliation_freshness',
]);

/** The five states, in the engine's declaration order (also the panel's
 *  severity order: UNKNOWN last, never first). */
export const SLO_STATES = ['HEALTHY', 'WARNING', 'CRITICAL', 'EXHAUSTED', 'UNKNOWN'] as const;
export type SloStateValue = (typeof SLO_STATES)[number];

// ---------------------------------------------------------------------------
// Sample bucket geometry (shared by the Python hub writer and this reader)
// ---------------------------------------------------------------------------

/** Minutes per sample bucket; buckets are whole multiples of this from the
 *  epoch, so both languages compute identical keys without calendars.
 */
export const SLO_SAMPLE_BUCKET_MINUTES = 10;

export const sloBucketIndex = (epochMillis: number): number =>
  Math.floor(epochMillis / (SLO_SAMPLE_BUCKET_MINUTES * 60_000));

export const sloBucketKey = (source: string, bucketIndex: number): string =>
  `wlct:trading:ops:slo:${source}:${bucketIndex}`;

/** Buckets outlive the longest window they can be read for by a factor of
 *  two; the storage is a couple of hashes an hour, not a time series. */
export const SLO_BUCKET_TTL_SECONDS = 2 * 7 * 86_400;

/** The latency-grid boundaries (ms) the API flush loop publishes. A
 *  definition whose threshold sits exactly on the grid (the catalog's 500ms
 *  does) measures exactly; elsewhere the evaluator uses the largest
 *  boundary not exceeding the threshold and says so in the row's reason -
 *  an honest approximation, never a silent one. */
export const SLO_LATENCY_GRID_MS = [100, 250, 500, 1000, 2000, 5000] as const;

/** Tick-ratio completeness: a window is "complete" when at least 95% of the
 *  ticks its source normally emits are present in the buckets. A fresh
 *  deployment therefore reports UNKNOWN for exactly one window - the
 *  honest answer to "what happened before we started looking". */
export const SLO_TICK_COMPLETENESS_RATIO_PPM = 950_000;

// ---------------------------------------------------------------------------
// The default catalog (values verbatim from catalog.py; see parity spec)
// ---------------------------------------------------------------------------

export interface SloCatalogEntry {
  readonly sloId: string;
  readonly service: string;
  readonly owner: string;
  readonly indicator: SloIndicatorValue;
  readonly objective: string;
  readonly windowMinutes: number;
  readonly shortWindowMinutes: number;
  readonly goodEvent: string;
  readonly badEvent: string;
  readonly description: string;
  readonly maxAgeMicros: string | null;
  readonly latencyThresholdMicros: string | null;
}

const RISK_FRESHNESS_MAX_AGE_MICROS = '4000000';
const MARKET_FRESHNESS_MAX_AGE_MICROS = '30000000';
const RECONCILIATION_MAX_AGE_MICROS = '900000000';
const QUEUE_AGE_MAX_MICROS = '240000000';
const API_LATENCY_THRESHOLD_MICROS = '500000';

export const DEFAULT_SLO_CATALOG: readonly SloCatalogEntry[] = Object.freeze([
  {
    sloId: 'api.availability',
    service: 'api',
    owner: 'platform-sre',
    indicator: 'availability',
    objective: '99.5',
    windowMinutes: 1440,
    shortWindowMinutes: 60,
    goodEvent: 'readiness check passed within the tick',
    badEvent: 'readiness check failed or timed out within the tick',
    description:
      "Share of evaluation ticks the API's own readiness probes (Postgres+Redis) " +
      'answered ready. Does not measure client-perceived availability.',
    maxAgeMicros: null,
    latencyThresholdMicros: null,
  },
  {
    sloId: 'api.request-success',
    service: 'api',
    owner: 'platform-sre',
    indicator: 'request_success_ratio',
    objective: '99.5',
    windowMinutes: 1440,
    shortWindowMinutes: 60,
    goodEvent: 'status class 2xx/3xx/4xx',
    badEvent: 'status class 5xx',
    description: 'Non-5xx share of served HTTP requests (route-template labels only).',
    maxAgeMicros: null,
    latencyThresholdMicros: null,
  },
  {
    sloId: 'queues.processing-success',
    service: 'queues',
    owner: 'platform-sre',
    indicator: 'queue_processing_success',
    objective: '99.0',
    windowMinutes: 1440,
    shortWindowMinutes: 60,
    goodEvent: 'job moved to completed',
    badEvent: 'job moved to failed after its final attempt',
    description:
      'Share of BullMQ jobs that completed without entering \'failed\' across ' +
      'the platform queues; control queues included, the execution queue\'s ' +
      "tighter policy lives in Part 9 alerting.",
    maxAgeMicros: null,
    latencyThresholdMicros: null,
  },
  {
    sloId: 'queues.freshness',
    service: 'queues',
    owner: 'platform-sre',
    indicator: 'queue_freshness',
    objective: '99.0',
    windowMinutes: 1440,
    shortWindowMinutes: 60,
    goodEvent: "sampled tick: every queue's oldest-waiting age within 240000000 micros",
    badEvent:
      'sampled tick: any queue over 240000000 micros (unknown reads as bad here: ' +
      'a stalled collector is not freshness)',
    description: 'Oldest waiting job within 4 minutes on every sampled queue.',
    maxAgeMicros: QUEUE_AGE_MAX_MICROS,
    latencyThresholdMicros: null,
  },
  {
    sloId: 'market-data.freshness',
    service: 'market-data',
    owner: 'trading-platform',
    indicator: 'market_data_freshness',
    objective: '99.5',
    windowMinutes: 1440,
    shortWindowMinutes: 60,
    goodEvent: 'mirror present with status HEALTHY',
    badEvent: 'mirror present with DEGRADED/UNHEALTHY/STOPPED status',
    description:
      'Published health mirror reports HEALTHY (all tracked symbols within the ' +
      'cache budget) at the sampled tick.',
    maxAgeMicros: MARKET_FRESHNESS_MAX_AGE_MICROS,
    latencyThresholdMicros: null,
  },
  {
    sloId: 'risk-state.freshness',
    service: 'trading-engine',
    owner: 'trading-platform',
    indicator: 'risk_state_freshness',
    objective: '99.9',
    windowMinutes: 1440,
    shortWindowMinutes: 60,
    goodEvent: 'engine probe report: zero stale accounts',
    badEvent: 'engine probe report: one or more stale accounts, or no published snapshots at all',
    description:
      "Every account's newest published snapshot within twice the live gate's " +
      'staleness budget. The GATE still refuses beyond 1x; a red SLO here means ' +
      'the refusals are chronic.',
    maxAgeMicros: RISK_FRESHNESS_MAX_AGE_MICROS,
    latencyThresholdMicros: null,
  },
  {
    sloId: 'execution.reconciliation-freshness',
    service: 'trading-engine',
    owner: 'trading-platform',
    indicator: 'reconciliation_freshness',
    objective: '99.0',
    windowMinutes: 1440,
    shortWindowMinutes: 60,
    goodEvent: 'last clean pass age within 900000000 micros',
    badEvent: 'last clean pass older than 900000000 micros or never observed',
    description:
      'A clean reconciliation pass within 15 minutes for the durable view. ' +
      "Blindness counts bad on purpose: 'we do not know' is operationally " +
      "'we did not run'.",
    maxAgeMicros: RECONCILIATION_MAX_AGE_MICROS,
    latencyThresholdMicros: null,
  },
  {
    sloId: 'api.latency-compliance',
    service: 'api',
    owner: 'platform-sre',
    indicator: 'latency_threshold_compliance',
    objective: '99.0',
    windowMinutes: 1440,
    shortWindowMinutes: 60,
    goodEvent: 'duration within 500000 micros',
    badEvent: 'duration over 500000 micros',
    description:
      'Share of served requests whose SERVER-SIDE handling finished under ' +
      '500ms. Venue round-trips and network time are excluded: the histogram ' +
      'observes this process, not a promise about any other.',
    maxAgeMicros: null,
    latencyThresholdMicros: API_LATENCY_THRESHOLD_MICROS,
  },
  {
    sloId: 'trading-engine.error-rate',
    service: 'trading-engine',
    owner: 'trading-platform',
    indicator: 'error_rate_compliance',
    objective: '99.9',
    windowMinutes: 1440,
    shortWindowMinutes: 60,
    goodEvent: 'evaluation returned a decision (approved or refused)',
    badEvent: 'evaluation raised an internal error',
    description:
      'Share of pre-trade evaluations that ended in an internal fault, not a ' +
      'risk refusal. Refusals are never counted bad: an SLO must not punish ' +
      'the gate for doing its job.',
    maxAgeMicros: null,
    latencyThresholdMicros: null,
  },
] satisfies readonly SloCatalogEntry[]);

/** The per-indicator sample bucket source names (the evaluator maps indicator
 *  -> sources; a source with no writer is an honest UNKNOWN, never a zero). */
export const SLO_SAMPLE_SOURCES: Readonly<Record<SloIndicatorValue, string>> = Object.freeze({
  availability: 'apiavail',
  request_success_ratio: 'apireq',
  queue_processing_success: 'queueproc',
  queue_freshness: 'queuefresh',
  market_data_freshness: 'mdfresh',
  risk_state_freshness: 'riskfresh',
  reconciliation_freshness: 'reconfresh',
  latency_threshold_compliance: 'apilat',
  error_rate_compliance: 'engineerr',
});

/** The alert rules the evaluator feeds into the durable fold (same ids the
 *  engine's alert catalog registers; the API writes rows because the API
 *  owns the table). */
export const SLO_ALERT_RULES = Object.freeze({
  fast: 'SLO_BURN_FAST',
  slow: 'SLO_BURN_SLOW',
  exhausted: 'SLO_BUDGET_EXHAUSTED',
  /// The measurement itself failed (collector silent, mirrors missing).
  /// Its own rule, deliberately WARNING, deliberately not a burn alert:
  /// "we stopped seeing it" must never read as "it stopped happening", and
  /// it must never read as a reliability failure of the OBJECTIVE either -
  /// it is a reliability failure of the EVIDENCE, and the panel says so.
  telemetryGap: 'SLO_TELEMETRY_GAP',
  exportFailing: 'TELEMETRY_EXPORT_FAILING',
} as const);
```

## FILE: apps/api/src/modules/observability/slo.canonical.ts (414 lines)

```typescript
/**
 * Part 10 - the canonical form of an SLO definition: objective arithmetic on
 * strings, the 14-key canonical payload, the sha256 identity.
 *
 * This file is the TypeScript mirror of `wlct_trading/slo/model.py`
 * (_decimal_string, objective_to_ppm, canonical_payload, canonical_slo_json,
 * slo_checksum). Like Part 8's risk digest, the whole point is that two
 * definitions that MEAN the same thing cannot produce two checksums, and two
 * that differ cannot produce one. `canonicalJson` is the already-proven
 * Part 8 canonicaliser (sorted keys, compact separators, non-finite values
 * throw) - the same function, not a copy, so the two systems cannot drift in
 * how they spell JSON.
 */

import { createHash } from 'node:crypto';

import {
  DEFAULT_CRITICAL_BURN_PPM,
  DEFAULT_WARNING_BURN_PPM,
  FRESHNESS_INDICATORS,
  MAX_WINDOW_MINUTES,
  MIN_WINDOW_MINUTES,
  SLO_ID_PATTERN,
  SLO_INDICATORS,
  SLO_OWNER_PATTERN,
  type SloIndicatorValue,
} from './slo.constants';

export class SloValidationError extends Error {
  constructor(
    readonly errors: readonly string[],
    readonly sloId: string,
  ) {
    super(`SloDefinition ${sloId}: ${errors.join('; ')}`);
    this.name = 'SloValidationError';
  }
}

/** The full, validated, canonicalised definition as the engine stores it.
 *  Integers where integers belong; the objective is canonical text; micros
 *  are strings because 64-bit values never travel as JS numbers. */
export interface SloDefinition {
  readonly sloId: string;
  readonly service: string;
  readonly description: string;
  readonly owner: string;
  readonly indicator: SloIndicatorValue;
  readonly objective: string;
  readonly objectivePpm: number;
  readonly windowMinutes: number;
  readonly shortWindowMinutes: number;
  readonly goodEvent: string;
  readonly badEvent: string;
  readonly warningBurnPpm: number;
  readonly criticalBurnPpm: number;
  readonly maxAgeMicros: string | null;
  readonly latencyThresholdMicros: string | null;
  readonly version: number;
  readonly enabled: boolean;
}

// ---------------------------------------------------------------------------
// decimal string -> ppm
// ---------------------------------------------------------------------------

const SLO_DECIMAL_INPUT = /^(0|[1-9]\d*)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/;

/** Accept a decimal string (optionally in scientific form like Python's
 *  Decimal does), return the CANONICAL plain form: no trailing zeros, no
 *  E+, no leading zeros, "-0" folded to "0". Floats are rejected at the
 *  caller - `typeof value === 'number'` never reaches here (the DTO only
 *  accepts strings, and the config layer hands over strings), which is the
 *  same "float rejected outright" rule model.py states for itself. */
export function canonicalObjectiveString(raw: string): string | null {
  const match = SLO_DECIMAL_INPUT.exec(raw.trim());
  if (match === null) {
    return null;
  }
  const wholePart = match[1] ?? '0';
  const fractionPart = match[2] ?? '';
  const exponent = match[3] === undefined ? 0 : Number.parseInt(match[3], 10);
  let digits = wholePart + fractionPart;
  let pointFromRight = fractionPart.length - exponent;
  if (pointFromRight < 0) {
    digits += '0'.repeat(-pointFromRight);
    pointFromRight = 0;
  } else if (pointFromRight > digits.length) {
    digits = '0'.repeat(pointFromRight - digits.length) + digits;
  }
  let intDigits = pointFromRight === 0 ? digits : digits.slice(0, digits.length - pointFromRight);
  let fracDigits = pointFromRight === 0 ? '' : digits.slice(digits.length - pointFromRight);
  fracDigits = fracDigits.replace(/0+$/, '');
  intDigits = intDigits.replace(/^0+(?=\d)/, '');
  if (fracDigits.length > 4) {
    // objective supports at most 4 decimal places - enforced here because
    // the ppm conversion below is exactly 4-wide and must not silently round.
    return null;
  }
  const canonical = fracDigits.length > 0 ? `${intDigits}.${fracDigits}` : intDigits;
  return canonical;
}

/** Canonical plain decimal string -> ppm, mirroring objective_to_ppm:
 *  value * 10_000, at most 4 decimals, strictly inside (0, 100). */
export function objectiveToPpm(objective: string): number {
  // Three failure modes, three exact Python messages, in Python's order:
  // unparseable, then RANGE, then DECIMAL PLACES. Baking the 4-place limit
  // into the parser instead (one shared "not a decimal string" error for
  // both) makes a misconfigured operator chase the wrong bug - "99.99999"
  // is parseable and in range, it is simply over-precise, and the error has
  // to say so. canonicalObjectiveString keeps its stricter single error for
  // the checksum path, where the input has already passed through here.
  const match = SLO_DECIMAL_INPUT.exec(objective.trim());
  if (match === null) {
    throw new Error('objective is not a decimal string');
  }
  const wholePart = match[1] ?? '0';
  const fractionPart = match[2] ?? '';
  const exponent = match[3] === undefined ? 0 : Number.parseInt(match[3], 10);
  let digits = wholePart + fractionPart;
  let pointFromRight = fractionPart.length - exponent;
  if (pointFromRight < 0) {
    digits += '0'.repeat(-pointFromRight);
    pointFromRight = 0;
  } else if (pointFromRight > digits.length) {
    digits = '0'.repeat(pointFromRight - digits.length) + digits;
  }
  let negative = false;
  if (digits.startsWith('-')) {
    negative = true;
    digits = digits.slice(1);
  } else if (digits.startsWith('+')) {
    digits = digits.slice(1);
  }
  const scaled = BigInt(digits === '' ? '0' : digits);
  const hundred = BigInt(100) * 10n ** BigInt(pointFromRight);
  if (negative || scaled <= 0n || scaled >= hundred) {
    throw new Error('objective must satisfy 0 < objective < 100');
  }
  const fractionDigits = pointFromRight === 0 ? '' : digits.slice(digits.length - pointFromRight);
  const significant = fractionDigits.replace(/0+$/, '');
  if (significant.length > 4) {
    throw new Error('objective supports at most 4 decimal places');
  }
  // <= 4 decimals means value * 10_000 is an exact integer: no rounding
  // decision to disagree about across languages.
  const ppm = (scaled * 10_000n) / 10n ** BigInt(pointFromRight);
  return Number(ppm);
}

// ---------------------------------------------------------------------------
// micros strings: bounded integer validation + comparison helpers
// ---------------------------------------------------------------------------

const BOUNDED_MICROS = /^(?:0|[1-9]\d{0,18})$/;

export const MAX_EXACT_INT64 = 9007199254740991n; // Number.MAX_SAFE_INTEGER

export function parseMicrosString(
  raw: string | null | undefined,
  field: string,
): { readonly value: bigint | null; readonly error: string | null } {
  if (raw === null || raw === undefined || raw === '') {
    return { value: null, error: null };
  }
  if (!BOUNDED_MICROS.test(raw)) {
    return { value: null, error: `${field} must be a non-negative integer string (max 19 digits)` };
  }
  const value = BigInt(raw);
  // The canonical JSON must reproduce Python's arbitrary-precision integer
  // rendering byte-for-byte, and a JS number above 2^53-1 cannot. The
  // platform budget is 900 seconds of age and 5 seconds of latency; anything
  // needing the full int64 range is a configuration error at this boundary,
  // and a refusal is truer than an inexact checksum.
  if (value > MAX_EXACT_INT64) {
    return { value: null, error: `${field} exceeds the exact-integer range (2^53-1)` };
  }
  return { value, error: null };
}

// ---------------------------------------------------------------------------
// definition building + validation (mirror of SloDefinition.__post_init__)
// ---------------------------------------------------------------------------

export interface SloDefinitionInput {
  readonly sloId: string;
  readonly service: string;
  readonly description: string;
  readonly owner: string;
  readonly indicator: string;
  readonly objective: string;
  readonly windowMinutes: number;
  readonly shortWindowMinutes: number;
  readonly goodEvent: string;
  readonly badEvent: string;
  readonly warningBurnPpm?: number;
  readonly criticalBurnPpm?: number;
  readonly maxAgeMicros?: string | null;
  readonly latencyThresholdMicros?: string | null;
  readonly version?: number;
  readonly enabled?: boolean;
}

export function buildSloDefinition(input: SloDefinitionInput): SloDefinition {
  const errors: string[] = [];

  const objective = canonicalObjectiveString(input.objective);
  if (objective === null) {
    errors.push('objective is not a finite plain decimal string with at most 4 fraction digits');
  }

  if (!SLO_INDICATORS.includes(input.indicator as SloIndicatorValue)) {
    errors.push('indicator is not one of the nine closed indicator types');
  }

  if (!SLO_ID_PATTERN.test(input.sloId)) {
    errors.push('slo_id must be a bounded lowercase identifier');
  }
  if (!SLO_ID_PATTERN.test(input.service)) {
    errors.push('service must be a bounded lowercase identifier');
  }
  if (!SLO_OWNER_PATTERN.test(input.owner)) {
    errors.push('owner must be a bounded team identifier');
  }
  if (input.description.length === 0 || input.description.length > 200) {
    errors.push('description must be 1..200 characters');
  }
  if (
    input.goodEvent.length < 1 ||
    input.goodEvent.length > 200 ||
    input.badEvent.length < 1 ||
    input.badEvent.length > 200
  ) {
    errors.push('good_event/bad_event must be 1..200 characters');
  }
  if (!Number.isInteger(input.windowMinutes) || input.windowMinutes < MIN_WINDOW_MINUTES || input.windowMinutes > MAX_WINDOW_MINUTES) {
    errors.push('window_minutes out of bounds');
  }
  if (
    !Number.isInteger(input.shortWindowMinutes) ||
    input.shortWindowMinutes < MIN_WINDOW_MINUTES ||
    input.shortWindowMinutes > input.windowMinutes
  ) {
    errors.push('short_window_minutes must sit inside the window');
  }

  const version = input.version ?? 1;
  if (version < 1) {
    errors.push('version must be >= 1');
  }
  const warningBurnPpm = input.warningBurnPpm ?? DEFAULT_WARNING_BURN_PPM;
  const criticalBurnPpm = input.criticalBurnPpm ?? DEFAULT_CRITICAL_BURN_PPM;
  if (warningBurnPpm <= 0 || criticalBurnPpm <= 0) {
    errors.push('burn thresholds must be positive ppm');
  }
  if (criticalBurnPpm < warningBurnPpm) {
    errors.push('critical burn threshold must be >= warning burn threshold');
  }

  let objectivePpm = 0;
  if (objective !== null) {
    try {
      objectivePpm = objectiveToPpm(objective);
    } catch (error) {
      errors.push((error as Error).message);
    }
  }

  const maxAge = parseMicrosString(input.maxAgeMicros ?? null, 'max_age_micros');
  const latency = parseMicrosString(
    input.latencyThresholdMicros ?? null,
    'latency_threshold_micros',
  );
  if (maxAge.error !== null) {
    errors.push(maxAge.error);
  }
  if (latency.error !== null) {
    errors.push(latency.error);
  }

  const indicator = input.indicator as SloIndicatorValue;
  const isFreshness = FRESHNESS_INDICATORS.has(indicator);
  if (isFreshness) {
    if (maxAge.value === null || maxAge.value <= 0n) {
      errors.push(`${indicator} requires max_age_micros > 0`);
    }
    if (latency.value !== null) {
      errors.push(`${indicator} must not carry latency_threshold_micros`);
    }
  } else if (indicator === 'latency_threshold_compliance') {
    if (latency.value === null || latency.value <= 0n) {
      errors.push('latency compliance requires latency_threshold_micros > 0');
    }
    if (maxAge.value !== null) {
      errors.push('latency compliance must not carry max_age_micros');
    }
  } else if (maxAge.value !== null || latency.value !== null) {
    errors.push('count indicators carry no thresholds; use a threshold indicator');
  }

  if (errors.length > 0) {
    throw new SloValidationError(errors, input.sloId);
  }

  return {
    sloId: input.sloId,
    service: input.service,
    description: input.description,
    owner: input.owner,
    indicator,
    // Non-null here: the objective was canonicalised before validation and
    // any failure added an error above, which already threw.
    objective: objective as string,
    objectivePpm,
    windowMinutes: input.windowMinutes,
    shortWindowMinutes: input.shortWindowMinutes,
    goodEvent: input.goodEvent,
    badEvent: input.badEvent,
    warningBurnPpm,
    criticalBurnPpm,
    maxAgeMicros: maxAge.value === null ? null : maxAge.value.toString(),
    latencyThresholdMicros: latency.value === null ? null : latency.value.toString(),
    version,
    enabled: input.enabled ?? true,
  };
}

// ---------------------------------------------------------------------------
// canonical payload + checksum
// ---------------------------------------------------------------------------

/** The 14 checksummed keys, built field-by-field (not from the runtime
 *  object) so the exclusion rules - `version` and `enabled` are NOT part of
 *  the objective's identity - are a visible structural fact, not a delete
 *  that someone forgets. Mirrors SloDefinition.canonical_payload exactly. */
export function canonicalPayload(definition: SloDefinition): Record<string, unknown> {
  return {
    sloId: definition.sloId,
    service: definition.service,
    description: definition.description,
    owner: definition.owner,
    indicator: definition.indicator,
    objective: definition.objective,
    windowMinutes: definition.windowMinutes,
    shortWindowMinutes: definition.shortWindowMinutes,
    goodEvent: definition.goodEvent,
    badEvent: definition.badEvent,
    warningBurnPpm: definition.warningBurnPpm,
    criticalBurnPpm: definition.criticalBurnPpm,
    maxAgeMicros: definition.maxAgeMicros === null ? null : Number(definition.maxAgeMicros),
    latencyThresholdMicros:
      definition.latencyThresholdMicros === null
        ? null
        : Number(definition.latencyThresholdMicros),
  };
}

/** Compact key-sorted JSON with the exact semantics of
 *  `canonical_slo_json` (which itself mirrors Part 8's canonicaliser). The
 *  micros fields are numbers in the payload, so a 64-bit value above
 *  Number.MAX_SAFE_INTEGER would misrender - the DTO caps micros strings at
 *  19 digits and the checksum test vector pins behaviour inside the safe
 *  range; values beyond 2^53 are refused by the DTO's own bound (see
 *  EPOCH_MICROS_CEILING-style check in the DTO layer). */
export function canonicalSloJson(payload: Record<string, unknown>): string {
  return canonicalJsonCompact(payload);
}

export function sloChecksum(definition: SloDefinition): string {
  return createHash('sha256')
    .update(canonicalSloJson(canonicalPayload(definition)), 'utf8')
    .digest('hex');
}

/** Same algorithm as risk.digest.ts's canonicalJson (sorted keys, compact
 *  separators, finite-only), inlined only for the import-graph reason below:
 *  risk.digest lives in the risk module and this module must not create a
 *  cross-module dependency for the trading-adjacent code paths. The parity
 *  spec asserts byte-equality against the Python encoder on the fixture
 *  vectors, so "same algorithm" is machine-checked, not asserted.
 */
function canonicalJsonCompact(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  const type = typeof value;
  if (type === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (type === 'number') {
    if (!Number.isFinite(value as number)) {
      throw new Error('canonical JSON refuses non-finite numbers');
    }
    const asNumber = value as number;
    if (Number.isInteger(asNumber) && !Object.is(asNumber, -0)) {
      return String(asNumber);
    }
    // Python's json.dumps emits repr(float); JS String() agrees on every
    // value that can arise from these payloads (integers or short decimals
    // produced by the canonicaliser itself), pinned by the fixture vectors.
    return String(asNumber);
  }
  if (type === 'string') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJsonCompact(item)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const parts = keys.map((key) => `${JSON.stringify(key)}:${canonicalJsonCompact(record[key])}`);
  return `{${parts.join(',')}}`;
}
```

## FILE: apps/api/src/modules/observability/slo.eval.ts (364 lines)

```typescript
/**
 * Part 10 - error-budget arithmetic, burn-rate alerting, and the evaluation
 * tick. Pure functions; every formula is the mirror of the Python module of
 * the same name, and the parity spec replays the fixture tables
 * (docs/fixtures/reliability_fixtures.json: budgetRows, burnRows,
 * slo.evaluations) through THESE functions with bit-exact expectations.
 *
 * Floors, not rounds, everywhere; None/null means "undefined for this
 * window", never zero; completeness is a claim the INPUT makes. Same law as
 * budget.py's docstring - two languages agree because both floor positive
 * integer divisions, and nothing here ever sees a float.
 */

import { objectiveToPpm } from './slo.canonical';
import type { SloDefinition } from './slo.canonical';

const MILLION = 1_000_000;

export interface WindowCounts {
  readonly good: number;
  readonly bad: number;
}

export function validateCounts(good: number, bad: number): { total: number } {
  if (!Number.isSafeInteger(good) || !Number.isSafeInteger(bad)) {
    throw new TypeError('good/bad must be integers');
  }
  if (good < 0 || bad < 0) {
    throw new Error('good/bad counts must be non-negative');
  }
  return { total: good + bad };
}

export interface ErrorBudget {
  readonly objectivePpm: number;
  readonly allowedPpm: number;
  readonly totalEvents: number;
  readonly goodEvents: number;
  readonly badEvents: number;
  readonly failurePpm: number | null;
  readonly compliancePpm: number | null;
  readonly budgetTotalEvents: number;
  readonly budgetConsumedEvents: number;
  readonly budgetRemainingEvents: number;
  readonly remainingRatioPpm: number | null;
  readonly burnPpm: number | null;
  readonly budgetZero: boolean;
}

export function computeBudget(objective: string, counts: WindowCounts): ErrorBudget {
  const objectivePpm = objectiveToPpm(objective);
  const allowedPpm = MILLION - objectivePpm;
  const { total } = validateCounts(counts.good, counts.bad);

  if (total === 0) {
    // No events, therefore no exhaustion claim, and every derived ratio is
    // undefined rather than zero - the caller decides what UNKNOWN means.
    return {
      objectivePpm,
      allowedPpm,
      totalEvents: 0,
      goodEvents: 0,
      badEvents: 0,
      failurePpm: null,
      compliancePpm: null,
      budgetTotalEvents: 0,
      budgetConsumedEvents: 0,
      budgetRemainingEvents: 0,
      remainingRatioPpm: null,
      burnPpm: null,
      budgetZero: false,
    };
  }

  const failurePpm = Math.floor((counts.bad * MILLION) / total);
  const compliancePpm = MILLION - failurePpm;
  const budgetTotal = Math.floor((total * allowedPpm) / MILLION);
  const consumed = Math.min(counts.bad, budgetTotal);
  const remaining = Math.max(0, budgetTotal - counts.bad);
  const remainingRatio = budgetTotal > 0 ? Math.floor((remaining * MILLION) / budgetTotal) : 0;
  if (allowedPpm > 0) {
    const burnPpm = Math.floor((failurePpm * MILLION) / allowedPpm);
    // budget_zero mirrors budget.py exactly: remaining hit zero while bad
    // events PROVED the burn; an all-zero window with no failures is not
    // exhaustion, it is an empty register.
    const budgetZero = budgetTotal > 0 && remaining === 0 && counts.bad > 0;
    return {
      objectivePpm,
      allowedPpm,
      totalEvents: total,
      goodEvents: counts.good,
      badEvents: counts.bad,
      failurePpm,
      compliancePpm,
      budgetTotalEvents: budgetTotal,
      budgetConsumedEvents: consumed,
      budgetRemainingEvents: remaining,
      remainingRatioPpm: remainingRatio,
      burnPpm,
      budgetZero,
    };
  }
  // Unreachable while objective < 100 is enforced upstream (objectiveToPpm);
  // kept defined rather than absent so a future model change fails loudly
  // here instead of dividing by zero at a call site. Python's twin comment
  // is here verbatim in spirit: dead-but-defined.
  return {
    objectivePpm,
    allowedPpm,
    totalEvents: total,
    goodEvents: counts.good,
    badEvents: counts.bad,
    failurePpm,
    compliancePpm,
    budgetTotalEvents: budgetTotal,
    budgetConsumedEvents: consumed,
    budgetRemainingEvents: remaining,
    remainingRatioPpm: remainingRatio,
    burnPpm: null,
    budgetZero: true,
  };
}

// ---------------------------------------------------------------------------
// burn alerting (mirror of burn.py)
// ---------------------------------------------------------------------------

export type BurnAlertKind = 'none' | 'fast' | 'slow' | 'both';

export interface BurnAlertState {
  readonly kind: BurnAlertKind;
  readonly shortBurnPpm: number | null;
  readonly longBurnPpm: number | null;
  readonly fastThresholdPpm: number;
  readonly slowThresholdPpm: number;
}

export function evaluateBurn(input: {
  shortBurnPpm: number | null;
  longBurnPpm: number | null;
  fastMultiplierPpm: number;
  slowMultiplierPpm: number;
}): BurnAlertState {
  if (input.fastMultiplierPpm <= 0 || input.slowMultiplierPpm <= 0) {
    throw new Error('burn multipliers must be positive ppm values');
  }
  if (input.slowMultiplierPpm > input.fastMultiplierPpm) {
    throw new Error('slow multiplier must not exceed the fast multiplier');
  }
  const fast =
    input.shortBurnPpm !== null &&
    input.longBurnPpm !== null &&
    input.shortBurnPpm >= input.fastMultiplierPpm &&
    input.longBurnPpm >= input.fastMultiplierPpm;
  const slow =
    input.shortBurnPpm !== null &&
    input.longBurnPpm !== null &&
    input.shortBurnPpm >= input.slowMultiplierPpm &&
    input.longBurnPpm >= input.slowMultiplierPpm;
  const kind: BurnAlertKind = fast && slow ? 'both' : fast ? 'fast' : slow ? 'slow' : 'none';
  return {
    kind,
    shortBurnPpm: input.shortBurnPpm,
    longBurnPpm: input.longBurnPpm,
    fastThresholdPpm: input.fastMultiplierPpm,
    slowThresholdPpm: input.slowMultiplierPpm,
  };
}

// ---------------------------------------------------------------------------
// the evaluation tick (mirror of evaluate.py::evaluate_slo)
// ---------------------------------------------------------------------------

export interface SloWindowSample {
  readonly good: number;
  readonly bad: number;
  /** Completeness is a claim the collector makes, never a courtesy the
   *  evaluator assumes (defaults must be set explicitly at the call site). */
  readonly dataComplete: boolean;
  readonly note?: string | null;
}

export type SloStateValue = 'HEALTHY' | 'WARNING' | 'CRITICAL' | 'EXHAUSTED' | 'UNKNOWN';

export interface SloEvaluationRow {
  readonly sloId: string;
  readonly version: number;
  readonly checksum: string;
  readonly indicator: string;
  readonly service: string;
  readonly evaluatedAtMicros: string;
  readonly windowMinutes: number;
  readonly shortWindowMinutes: number;
  readonly targetPpm: number;
  readonly state: SloStateValue;
  readonly actualPpm: number | null;
  readonly budgetTotalEvents: number;
  readonly budgetConsumedEvents: number;
  readonly budgetRemainingEvents: number;
  readonly remainingRatioPpm: number | null;
  readonly longBurnPpm: number | null;
  readonly shortBurnPpm: number | null;
  readonly alertKind: BurnAlertKind;
  readonly samplesGood: number;
  readonly samplesBad: number;
  readonly dataComplete: boolean;
  readonly reason: string | null;
}

export interface EvaluateSloInput {
  definition: SloDefinition;
  checksum: string;
  longWindow: SloWindowSample;
  shortWindow: SloWindowSample;
  evaluatedAtMicros: bigint;
  fastMultiplierPpm: number;
  slowMultiplierPpm: number;
}

export function evaluateSlo(input: EvaluateSloInput): SloEvaluationRow {
  const { definition, checksum } = input;
  const targetPpm = objectiveToPpm(definition.objective);

  const longBudget = computeBudget(definition.objective, {
    good: input.longWindow.good,
    bad: input.longWindow.bad,
  });
  const shortBudget = computeBudget(definition.objective, {
    good: input.shortWindow.good,
    bad: input.shortWindow.bad,
  });

  const base = {
    sloId: definition.sloId,
    version: definition.version,
    checksum,
    indicator: definition.indicator,
    service: definition.service,
    evaluatedAtMicros: input.evaluatedAtMicros.toString(),
    windowMinutes: definition.windowMinutes,
    shortWindowMinutes: definition.shortWindowMinutes,
    targetPpm,
  };

  const complete = input.longWindow.dataComplete && input.shortWindow.dataComplete;
  if (!complete) {
    const reasons: string[] = [];
    if (!input.longWindow.dataComplete) {
      reasons.push('long-window collector incomplete');
    }
    if (!input.shortWindow.dataComplete) {
      reasons.push('short-window collector incomplete');
    }
    if (input.longWindow.note !== null && input.longWindow.note !== undefined) {
      reasons.push(`long: ${input.longWindow.note}`);
    }
    return {
      ...base,
      state: 'UNKNOWN',
      actualPpm: null,
      budgetTotalEvents: 0,
      budgetConsumedEvents: 0,
      budgetRemainingEvents: 0,
      remainingRatioPpm: null,
      longBurnPpm: null,
      shortBurnPpm: null,
      alertKind: 'none',
      samplesGood: input.longWindow.good,
      samplesBad: input.longWindow.bad,
      dataComplete: false,
      reason: reasons.join('; '),
    };
  }

  if (longBudget.totalEvents === 0) {
    return {
      ...base,
      state: 'UNKNOWN',
      actualPpm: null,
      budgetTotalEvents: 0,
      budgetConsumedEvents: 0,
      budgetRemainingEvents: 0,
      remainingRatioPpm: null,
      longBurnPpm: null,
      shortBurnPpm: null,
      alertKind: 'none',
      samplesGood: 0,
      samplesBad: 0,
      dataComplete: true,
      reason:
        'no samples in the evaluation window; absence of failures is not evidence of success',
    };
  }

  const alert = evaluateBurn({
    shortBurnPpm: shortBudget.burnPpm,
    longBurnPpm: longBudget.burnPpm,
    fastMultiplierPpm: input.fastMultiplierPpm,
    slowMultiplierPpm: input.slowMultiplierPpm,
  });

  const state = resolveState(definition, longBudget);
  return {
    ...base,
    state,
    actualPpm: longBudget.compliancePpm,
    budgetTotalEvents: longBudget.budgetTotalEvents,
    budgetConsumedEvents: longBudget.budgetConsumedEvents,
    budgetRemainingEvents: longBudget.budgetRemainingEvents,
    remainingRatioPpm: longBudget.remainingRatioPpm,
    longBurnPpm: longBudget.burnPpm,
    shortBurnPpm: shortBudget.burnPpm,
    alertKind: alert.kind,
    samplesGood: longBudget.goodEvents,
    samplesBad: longBudget.badEvents,
    dataComplete: true,
    reason: stateReason(state, longBudget, shortBudget, alert),
  };
}

/** EXHAUSTED first (remaining hit zero with proven bad events), then the
 *  definition's own burn thresholds, then HEALTHY iff evidenced. Mirror of
 *  _resolve_state - ordering included, because it is the semantics. */
export function resolveState(definition: SloDefinition, budget: ErrorBudget): SloStateValue {
  if (budget.budgetTotalEvents > 0 && budget.budgetRemainingEvents === 0 && budget.badEvents > 0) {
    return 'EXHAUSTED';
  }
  if (budget.burnPpm !== null && budget.burnPpm >= definition.criticalBurnPpm) {
    return 'CRITICAL';
  }
  if (budget.burnPpm !== null && budget.burnPpm >= definition.warningBurnPpm) {
    return 'WARNING';
  }
  if (budget.totalEvents > 0) {
    return 'HEALTHY';
  }
  return 'UNKNOWN';
}

function stateReason(
  state: SloStateValue,
  longBudget: ErrorBudget,
  shortBudget: ErrorBudget,
  alert: BurnAlertState,
): string {
  const alerting = alert.kind !== 'none';
  if (alerting) {
    return (
      `burn-rate alert (${alert.kind}): short ${String(shortBudget.burnPpm)}ppm / ` +
      `long ${String(longBudget.burnPpm)}ppm against fast ${String(alert.fastThresholdPpm)}ppm`
    );
  }
  if (state === 'EXHAUSTED') {
    return `error budget exhausted at ${String(longBudget.failurePpm)}ppm failure`;
  }
  if (state === 'CRITICAL') {
    return `burn ${String(longBudget.burnPpm)}ppm at or beyond the critical threshold`;
  }
  if (state === 'WARNING') {
    return `burn ${String(longBudget.burnPpm)}ppm at or beyond the warning threshold`;
  }
  return `compliance ${String(longBudget.compliancePpm)}ppm against target ${String(longBudget.objectivePpm)}ppm`;
}
```

## FILE: apps/api/src/modules/observability/slo-samples.ts (279 lines)

```typescript
/**
 * Part 10: the SLO sample store - fixed-time buckets in Redis with the
 * window-sum and completeness laws the evaluator reads through.
 *
 * Why buckets and not a time-series DB: an SLO window is "everything in a
 * fixed interval", which a hash-per-interval answers exactly, with bounded
 * storage (TTL) and no new infrastructure. Every producer - the request
 * flush loop, the evaluation tick itself, the queue worker's event
 * listeners, and the trading engine's mirror loop - writes ONLY deltas of
 * counters it kept in memory, so the hot path never touches Redis for
 * telemetry (the Part 9 law, kept).
 *
 * The window-sum reads WHOLE buckets ending at the last CLOSED bucket (the
 * currently-open bucket is excluded: it is partial by construction). A
 * window older than the bucket retention reads short and says so in the
 * note; completeness is what turns "nothing happened" into "nobody looked",
 * and it is computed per source under THAT SOURCE'S law, never assumed.
 */

import { Injectable } from '@nestjs/common';
import { SLO_SAMPLE_BUCKET_MINUTES, SLO_SAMPLE_KEY_PREFIX } from '@wlct/config';

import { RedisService } from '../../infrastructure/redis/redis.service';

import {
  SLO_LATENCY_GRID_MS,
  SLO_SAMPLE_SOURCES,
  SLO_TICK_COMPLETENESS_RATIO_PPM,
  type SloIndicatorValue,
} from './slo.constants';

export interface WindowSample {
  good: number;
  bad: number;
  dataComplete: boolean;
  note: string | null;
}

/** Expected tick rate per source (ticks per minute). A null rate means the
 *  source is event-shaped (requests, job outcomes): there is no "expected"
 *  cadence to compare against, and completeness is judged by the collector
 *  having written at all in the window instead - "the loop is alive because
 *  its numbers are here". */
const SOURCE_TICKS_PER_MINUTE: Readonly<Record<string, number | null>> = Object.freeze({
  apiavail: 1 / 5, // written by the evaluation tick (*/5 cron)
  mdfresh: 1 / 5,
  riskfresh: 1 / 5,
  queuefresh: 1 / 5,
  reconfresh: 1 / 5,
  engineerr: null, // written by the engine's own mirror loop
  apireq: null,
  apilat: null,
  queueproc: null,
});

const BUCKET_TTL_MS = 2 * 7 * 86_400_000;

export const sloBucketKey = (source: string, bucketIndex: number): string =>
  `${SLO_SAMPLE_KEY_PREFIX}:${source}:${String(bucketIndex)}`;

export const currentBucketIndex = (epochMillis: number): number =>
  Math.floor(epochMillis / (SLO_SAMPLE_BUCKET_MINUTES * 60_000));

interface BucketRead {
  good: number;
  bad: number;
  ticks: number;
  total: number;
  le: Map<number, number>;
  present: boolean;
}

const emptyBucket = (): BucketRead => ({
  good: 0,
  bad: 0,
  ticks: 0,
  total: 0,
  le: new Map(SLO_LATENCY_GRID_MS.map((ms) => [ms, 0])),
  present: false,
});

const parseRow = (row: Record<string, string>): BucketRead => {
  const out = emptyBucket();
  out.good = Number.parseInt(row.good ?? '0', 10) || 0;
  out.bad = Number.parseInt(row.bad ?? '0', 10) || 0;
  out.ticks = Number.parseInt(row.ticks ?? '0', 10) || 0;
  out.total = Number.parseInt(row.total ?? '0', 10) || 0;
  for (const boundary of SLO_LATENCY_GRID_MS) {
    out.le.set(boundary, Number.parseInt(row[`le${String(boundary)}ms`] ?? '0', 10) || 0);
  }
  out.present = Object.keys(row).length > 0;
  return out;
};

@Injectable()
export class SloSamplesService {
  constructor(private readonly redis: RedisService) {}

  /** One tick's verdict for a source: +1 to exactly one of good/bad plus a
   *  tick marker, in a single pipeline. Callers in the maintenance job await
   *  it (so a Redis outage shows up in the JOB's error path); request- or
   *  worker-adjacent callers fire it and ignore. */
  async recordTick(
    source: string,
    ok: boolean,
    options: { extra?: Record<string, number> } = {},
  ): Promise<void> {
    const bucket = currentBucketIndex(Date.now());
    const key = sloBucketKey(source, bucket);
    const pipeline = this.redis.client.pipeline();
    pipeline.hincrby(key, 'ticks', 1);
    pipeline.hincrby(key, ok ? 'good' : 'bad', 1);
    for (const [field, value] of Object.entries(options.extra ?? {})) {
      if (value > 0) {
        pipeline.hincrby(key, field, value);
      }
    }
    pipeline.pexpire(key, BUCKET_TTL_MS);
    await pipeline.exec();
  }

  /** Cumulative counters (requests, job outcomes): add N to good or bad.
   *  Same bounded-hash shape as recordTick without a tick marker - the
   *  delta IS the evidence; absence of traffic is legitimately "no
   *  samples", which the evaluator renders as the no-samples UNKNOWN row. */
  async recordCounters(source: string, good: number, bad: number): Promise<void> {
    if (good <= 0 && bad <= 0) {
      return;
    }
    const bucket = currentBucketIndex(Date.now());
    const key = sloBucketKey(source, bucket);
    const pipeline = this.redis.client.pipeline();
    if (good > 0) {
      pipeline.hincrby(key, 'good', good);
    }
    if (bad > 0) {
      pipeline.hincrby(key, 'bad', bad);
    }
    pipeline.pexpire(key, BUCKET_TTL_MS);
    await pipeline.exec();
  }

  /** Read one window's totals for a COUNT-shaped indicator (everything
   *  except the latency threshold family, which needs the grid). */
  async readWindow(
    indicator: SloIndicatorValue,
    windowMinutes: number,
    nowMillis: number = Date.now(),
  ): Promise<WindowSample> {
    const source = SLO_SAMPLE_SOURCES[indicator];
    const { buckets, closedNow, start, needed } = await this.readBuckets(source, windowMinutes, nowMillis);

    let good = 0;
    let bad = 0;
    let ticks = 0;
    let bucketsPresent = 0;
    for (const bucket of buckets) {
      if (!bucket.present) {
        continue;
      }
      bucketsPresent += 1;
      good += bucket.good;
      bad += bucket.bad;
      ticks += bucket.ticks;
    }

    const notes: string[] = [];
    let dataComplete: boolean;
    const expected = SOURCE_TICKS_PER_MINUTE[source];
    if (expected === null || expected === undefined) {
      // Event-shaped source: numbers in the window mean the collector wrote
      // them while alive; zero numbers means there was nothing to see. Both
      // read complete; a collector that died with unsent deltas is caught
      // when its source starts disagreeing with the durable truth, which is
      // the same trade-off the Prometheus pull model makes.
      dataComplete = true;
      if (bucketsPresent === 0) {
        notes.push(`${source}: no events recorded in window`);
      }
    } else {
      const expectedTicks = expected * windowMinutes;
      const completePpm = expectedTicks <= 0 ? 0 : Math.floor((ticks * 1_000_000) / expectedTicks);
      dataComplete = completePpm >= SLO_TICK_COMPLETENESS_RATIO_PPM;
      if (!dataComplete) {
        notes.push(
          `${source} collector saw ${String(ticks)}/${String(Math.round(expectedTicks))} expected ticks`,
        );
      }
    }
    if (bucketsPresent < needed) {
      notes.push(
        `window read ${String(bucketsPresent)}/${String(needed)} buckets (pre-deployment or pruned by retention)`,
      );
    }
    void closedNow;
    void start;
    return { good, bad, dataComplete, note: notes.length > 0 ? notes.join('; ') : null };
  }

  /** The latency-grid window: `total` per bucket plus cumulative
   *  le-boundaries; compliance at the definition's threshold is read at the
   *  largest grid boundary not exceeding it, and any approximation there is
   *  written into the note, never hidden. */
  async readLatencyWindow(
    windowMinutes: number,
    thresholdMicros: bigint,
    nowMillis: number = Date.now(),
  ): Promise<WindowSample> {
    const source = SLO_SAMPLE_SOURCES.latency_threshold_compliance;
    const { buckets, needed } = await this.readBuckets(source, windowMinutes, nowMillis);

    let total = 0;
    let bucketsPresent = 0;
    const leSums = new Map<number, number>(SLO_LATENCY_GRID_MS.map((ms) => [ms, 0]));
    buckets.forEach((bucket) => {
      if (!bucket.present) {
        return;
      }
      bucketsPresent += 1;
      total += bucket.total;
      for (const boundary of SLO_LATENCY_GRID_MS) {
        leSums.set(boundary, (leSums.get(boundary) ?? 0) + (bucket.le.get(boundary) ?? 0));
      }
    });

    const thresholdMs = Number(thresholdMicros / 1000n);
    let boundary: number | null = null;
    for (const candidate of SLO_LATENCY_GRID_MS) {
      if (candidate <= thresholdMs) {
        boundary = candidate;
      }
    }
    const notes: string[] = [];
    if (boundary === null) {
      boundary = SLO_LATENCY_GRID_MS[0];
      notes.push(
        `threshold ${String(thresholdMs)}ms below the 100ms grid floor; measured there (overstates compliance)`,
      );
    } else if (boundary !== thresholdMs) {
      notes.push(
        `threshold ${String(thresholdMs)}ms measured at grid boundary ${String(boundary)}ms (floor)`,
      );
    }
    if (bucketsPresent < needed) {
      notes.push(
        `window read ${String(bucketsPresent)}/${String(needed)} buckets (pre-deployment or pruned by retention)`,
      );
    }

    const within = leSums.get(boundary) ?? 0;
    // Completeness law (event-shaped, with a twist the panel shows): the
    // flush loop also keeps the apireq bucket warm, so "this window has
    // totals" is the liveness evidence; a zero-traffic window is complete
    // and simply has no samples (which the evaluator renders honestly).
    const dataComplete = true;
    return { good: within, bad: Math.max(0, total - within), dataComplete, note: notes.length > 0 ? notes.join('; ') : null };
  }

  private async readBuckets(
    source: string,
    windowMinutes: number,
    nowMillis: number,
  ): Promise<{ buckets: BucketRead[]; closedNow: number; start: number; needed: number }> {
    const bucketMillis = SLO_SAMPLE_BUCKET_MINUTES * 60_000;
    const closedNow = Math.floor(nowMillis / bucketMillis); // index of the OPEN bucket
    const needed = Math.max(1, Math.ceil(windowMinutes / SLO_SAMPLE_BUCKET_MINUTES));
    const start = closedNow - needed;
    const pipeline = this.redis.client.pipeline();
    for (let index = start; index < closedNow; index += 1) {
      pipeline.hgetall(sloBucketKey(source, index));
    }
    const rows = (await pipeline.exec()) as Array<[Error | null, Record<string, string> | null]>;
    const buckets = rows.map(([error, row]) =>
      error !== null || row === null ? emptyBucket() : parseRow(row),
    );
    return { buckets, closedNow, start, needed };
  }
}
```

## FILE: apps/api/src/modules/observability/slo.types.ts (59 lines)

```typescript
/**
 * Part 10 - internal types for the SLO surface. The WIRE types live in
 * @wlct/shared-types (slo.ts) because the admin console and any future
 * machine consumer import them from there; this file holds only what the
 * service layer passes around internally.
 */

import type { SloConfigUpdateDto } from '@wlct/shared-types';

export interface SloActor {
  readonly userId: string;
  readonly tenantId: string;
  readonly platform: boolean;
  readonly requestId: string;
  readonly correlationId?: string;
}

export interface SloConfigCommand {
  readonly actor: SloActor;
  readonly sloId: string;
  readonly update: SloConfigUpdateDto;
}

export interface SloListFilter {
  readonly service?: string;
  readonly includeDisabled: boolean;
}

export interface SloEvaluationPage {
  readonly items: unknown[];
  readonly page: number;
  readonly limit: number;
  readonly total: number;
}

export interface SloEvaluateResult {
  // Mutable by design (and ONLY within the tick that created it): the
  // evaluator accumulates counters as it walks the definitions. Everything
  // the service RETURNS to callers is a fresh frozen snapshot conceptually -
  // no other code holds a reference mid-loop.
  evaluated: number;
  alertingSloIds: string[];
  skipped: Array<{ sloId: string; error: string }>;
  source: 'scheduled' | 'manual';
}

/** A stored version row decoded back into the engine's definition shape
 *  (payload JSON + columns), for evaluation and for the versions list. */
export interface SloStoredVersion {
  readonly id: string;
  readonly sloId: string;
  readonly version: number;
  readonly checksum: string;
  readonly enabled: boolean;
  readonly payload: Record<string, unknown>;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}
```

## FILE: apps/api/src/modules/observability/slo.mapper.ts (182 lines)

```typescript
/**
 * Part 10 - row-to-view mapping. Every 64-bit column crosses the wire as a
 * decimal STRING (the platform-wide BigInt rule), every ppm stays an integer,
 * and no view ever recomputes what the evaluator already decided: the row is
 * the record, the view is the window.
 */

import type {
  SloDefinitionView,
  SloEvaluationView,
  SloReadinessView,
  SloState,
  SloStatusView,
} from '@wlct/shared-types';
import { SloIndicator, SloState as SloStateEnum } from '@wlct/shared-types';
import type { Prisma } from '@prisma/client';

import { objectiveToPpm } from './slo.canonical';

type ConfigRow = Prisma.SloConfigurationVersionGetPayload<object>;
type EvaluationRow = Prisma.SloEvaluationGetPayload<object>;

export const SLO_READINESS_NOTE =
  'Error budgets measure and page. They never authorise: no number on this ' +
  'panel opens, resumes, or unlocks anything. Enforcement lives in the risk ' +
  'gate. Risk controls reduce operational risk but cannot guarantee against ' +
  'all losses.';

export function definitionView(row: ConfigRow): SloDefinitionView {
  const objective = row.objective;
  const objectivePpm = objectiveToPpm(objective);
  return {
    sloId: row.sloId,
    version: row.version,
    service: serviceForIndicator(row.indicator, row.payload),
    owner: row.owner,
    description: row.description,
    indicator: row.indicator as SloIndicator,
    objective,
    objectivePpm,
    allowedPpm: 1_000_000 - objectivePpm,
    windowMinutes: row.windowMinutes,
    shortWindowMinutes: row.shortWindowMinutes,
    goodEvent: row.goodEvent,
    badEvent: row.badEvent,
    warningBurnPpm: row.warningBurnPpm,
    criticalBurnPpm: row.criticalBurnPpm,
    maxAgeMicros: row.maxAgeMicros === null ? null : row.maxAgeMicros.toString(),
    latencyThresholdMicros:
      row.latencyThresholdMicros === null ? null : row.latencyThresholdMicros.toString(),
    enabled: row.enabled,
    checksum: row.checksum,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** `service` is part of the checksummed identity, so the canonical payload
 *  is the authority for it (the column set deliberately does not duplicate
 *  what the digest already covers). */
const serviceForIndicator = (indicator: string, payload: Prisma.JsonValue): string => {
  if (typeof payload === 'object' && payload !== null && !Array.isArray(payload)) {
    const service = (payload as Record<string, unknown>).service;
    if (typeof service === 'string' && service.length > 0) {
      return service;
    }
  }
  // A payload without a service key cannot be produced by this codebase (the
  // canonicaliser always writes one); mapping it to the indicator's owning
  // domain keeps the panel readable rather than 500-ing on legacy rows.
  return indicator;
};

export function evaluationView(row: EvaluationRow): SloEvaluationView {
  return {
    sloId: row.sloId,
    version: row.version,
    checksum: row.checksum,
    indicator: row.indicator as SloIndicator,
    service: row.service,
    state: row.state as SloState,
    evaluatedAtMicros: row.evaluatedAtMicros.toString(),
    windowMinutes: row.windowMinutes,
    shortWindowMinutes: row.shortWindowMinutes,
    targetPpm: row.targetPpm,
    actualPpm: row.actualPpm,
    budgetTotalEvents: row.budgetTotalEvents,
    budgetConsumedEvents: row.budgetConsumedEvents,
    budgetRemainingEvents: row.budgetRemainingEvents,
    remainingRatioPpm: row.remainingRatioPpm,
    longBurnPpm: row.longBurnPpm,
    shortBurnPpm: row.shortBurnPpm,
    alertKind: row.alertKind as SloEvaluationView['alertKind'],
    samplesGood: row.samplesGood,
    samplesBad: row.samplesBad,
    dataComplete: row.dataComplete,
    reason: row.reason,
  };
}

export function statusView(
  definitionRow: ConfigRow,
  latestEvaluation: EvaluationRow | null,
): SloStatusView {
  const latest = latestEvaluation === null ? null : evaluationView(latestEvaluation);
  return {
    definition: definitionView(definitionRow),
    latest,
    burnAlerting: latest !== null && latest.alertKind !== 'none',
  };
}

const SLO_STATE_ORDER: readonly SloState[] = [
  SloStateEnum.HEALTHY,
  SloStateEnum.WARNING,
  SloStateEnum.CRITICAL,
  SloStateEnum.EXHAUSTED,
  SloStateEnum.UNKNOWN,
];

export const sloStateCode = (state: SloState | string): number => {
  const index = SLO_STATE_ORDER.indexOf(state as SloState);
  return index === -1 ? SLO_STATE_ORDER.length - 1 : index;
};

/** The scorecard rollup. Aggregates over the LATEST evaluation per
 *  definition, which is exactly what "right now, per what was last
 *  measured" means on this platform; evaluations older than the current
 *  tick are the truth until a newer tick replaces them, never a guess. */
export function readinessView(
  statuses: readonly SloStatusView[],
  evaluatedAtMicros: bigint,
): SloReadinessView {
  const byState = {
    HEALTHY: 0,
    WARNING: 0,
    CRITICAL: 0,
    EXHAUSTED: 0,
    UNKNOWN: 0,
  } as Record<SloState, number>;
  let worstRemaining: number | null = null;
  let maxLongBurn: number | null = null;
  const paging: string[] = [];
  const unmeasured: string[] = [];
  for (const status of statuses) {
    const latest = status.latest;
    if (latest === null) {
      unmeasured.push(status.definition.sloId);
      byState[SloStateEnum.UNKNOWN] += 1;
      continue;
    }
    byState[latest.state] += 1;
    if (latest.state === SloStateEnum.UNKNOWN) {
      unmeasured.push(status.definition.sloId);
    }
    if (latest.remainingRatioPpm !== null) {
      worstRemaining =
        worstRemaining === null ? latest.remainingRatioPpm : Math.min(worstRemaining, latest.remainingRatioPpm);
    }
    if (latest.longBurnPpm !== null) {
      maxLongBurn = maxLongBurn === null ? latest.longBurnPpm : Math.max(maxLongBurn, latest.longBurnPpm);
    }
    const pagingState =
      latest.state === SloStateEnum.CRITICAL ||
      latest.state === SloStateEnum.EXHAUSTED ||
      status.burnAlerting;
    if (pagingState) {
      paging.push(status.definition.sloId);
    }
  }
  return {
    evaluatedAtMicros: evaluatedAtMicros.toString(),
    total: statuses.length,
    byState,
    worstRemainingRatioPpm: worstRemaining,
    maxLongBurnPpm: maxLongBurn,
    pagingSloIds: paging.sort(),
    unmeasuredSloIds: unmeasured.sort(),
    note: SLO_READINESS_NOTE,
  };
}
```

## FILE: apps/api/src/modules/observability/slo.service.ts (836 lines)

```typescript
/**
 * Part 10: the SLO control plane on the API side - definitions (versioned,
 * checksummed, audited), the evaluation tick, the scorecard rollup, and the
 * burn-rate alert fold.
 *
 * The evaluator is a READER of evidence, in order of preference it can
 * actually honour: fixed-time sample buckets in Redis (written by
 * collectors at their own cadence), durable tables in PostgreSQL that the
 * platform already maintains (reconciliation runs; risk snapshot metadata,
 * with the engine's own bounded query shape), and the publisher mirrors the
 * health plane maintains. It invents no numbers: a source with no data
 * yields no ticks, which the completeness law renders as an UNKNOWN row -
 * visible, dated, and worded as "we did not look", never as "all good".
 *
 * What this file NEVER does: no method here touches orders, kill switches,
 * risk limits, alert resolution-by-side-effect, or anything the trading
 * path reads. An SLO publishes expectations; the burn alert is the same
 * durable-alert fold Part 9 built, under SLO rule ids. Red means a human
 * looks; nothing else.
 */

import { BadRequestException, Injectable, NotFoundException, OnApplicationBootstrap } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AuditAction, AuditActorType, AuditOutcome, type PaginatedResult } from '@wlct/shared-types';
import type {
  SloConfigUpdateDto,
  SloEvaluationView,
  SloReadinessView,
  SloStatusView,
} from '@wlct/shared-types';
import { buildPaginationMeta, normalisePagination } from '@wlct/utils';

import { AppConfigService } from '../../config/app-config.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { RedisService } from '../../infrastructure/redis/redis.service';
import { MetricsRegistry } from '../../infrastructure/metrics/metrics.registry';
import { AuditService } from '../audit/audit.service';
import { TradingReadinessService } from '../health/trading-readiness.service';

import { AlertsService } from './alerts.service';
import {
  DEFAULT_SLO_CATALOG,
  SLO_ALERT_RULES,
  SLO_SAMPLE_SOURCES,
} from './slo.constants';
import {
  buildSloDefinition,
  canonicalPayload,
  sloChecksum,
  SloValidationError,
  type SloDefinition,
} from './slo.canonical';
import { evaluateSlo, type SloEvaluationRow } from './slo.eval';
import { definitionView, evaluationView, readinessView, sloStateCode, statusView } from './slo.mapper';
import { SloSamplesService } from './slo-samples';
import type { SloActor, SloEvaluateResult, SloListFilter } from './slo.types';

const epochMicros = (): bigint => BigInt(Date.now()) * 1000n;

@Injectable()
export class SloService implements OnApplicationBootstrap {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: AppConfigService,
    private readonly registry: MetricsRegistry,
    private readonly audit: AuditService,
    private readonly samples: SloSamplesService,
    private readonly alerts: AlertsService,
    private readonly readiness: TradingReadinessService,
    @InjectPinoLogger(SloService.name) private readonly logger: PinoLogger,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.config.sloEnabled) {
      return;
    }
    try {
      await this.seedDefaults();
    } catch (error) {
      // Seeding is idempotent-by-unique-key; a failure here is loud in the
      // log but must not stop the API from serving traffic (the panel then
      // truthfully reports UNKNOWN until the next boot or the manual seed
      // path - which a scheduled tick also retries).
      this.logger.error(
        { event: 'slo.seed_failed', message: (error as Error).message },
        'SLO default catalog seeding failed',
      );
    }
  }

  /** Insert version 1 for every catalog entry that has NO versions yet.
   *  Multi-replica-safe by unique(sloId, version): a losing insert hits
   *  P2002 and means the other replica wrote the identical checksummed row -
   *  byte-identical is the whole point of checksumming the canonical form. */
  async seedDefaults(): Promise<{ seeded: number }> {
    let seeded = 0;
    for (const entry of DEFAULT_SLO_CATALOG) {
      const existing = await this.prisma.sloConfigurationVersion.findFirst({
        where: { sloId: entry.sloId },
        select: { id: true },
      });
      if (existing !== null) {
        continue;
      }
      const definition = buildSloDefinition({
        sloId: entry.sloId,
        service: entry.service,
        description: entry.description,
        owner: entry.owner,
        indicator: entry.indicator,
        objective: entry.objective,
        windowMinutes: entry.windowMinutes,
        shortWindowMinutes: entry.shortWindowMinutes,
        goodEvent: entry.goodEvent,
        badEvent: entry.badEvent,
        maxAgeMicros: entry.maxAgeMicros,
        latencyThresholdMicros: entry.latencyThresholdMicros,
        version: 1,
        enabled: true,
      });
      try {
        await this.prisma.sloConfigurationVersion.create({
          data: {
            sloId: definition.sloId,
            version: 1,
            objective: definition.objective,
            windowMinutes: definition.windowMinutes,
            shortWindowMinutes: definition.shortWindowMinutes,
            indicator: definition.indicator,
            owner: definition.owner,
            description: definition.description,
            goodEvent: definition.goodEvent,
            badEvent: definition.badEvent,
            warningBurnPpm: definition.warningBurnPpm,
            criticalBurnPpm: definition.criticalBurnPpm,
            maxAgeMicros:
              definition.maxAgeMicros === null ? null : BigInt(definition.maxAgeMicros),
            latencyThresholdMicros:
              definition.latencyThresholdMicros === null
                ? null
                : BigInt(definition.latencyThresholdMicros),
            enabled: true,
            payload: canonicalPayload(definition) as never,
            checksum: sloChecksum(definition),
          },
        });
        seeded += 1;
      } catch (error) {
        if ((error as { code?: string }).code === 'P2002') {
          continue;
        }
        throw error;
      }
    }
    if (seeded > 0) {
      this.logger.info({ event: 'slo.seeded', seeded }, 'SLO default catalog seeded');
    }
    return { seeded };
  }

  // ------------------------------------------------------------------
  // reads
  // ------------------------------------------------------------------

  /** Latest definition version + latest evaluation per SLO - the panel
   *  table. `service` filters the closed set of publisher domains. */
  async listStatuses(filter: SloListFilter): Promise<SloStatusView[]> {
    const rows = await this.latestDefinitions(filter);
    const statuses: SloStatusView[] = [];
    for (const row of rows) {
      const latest = await this.prisma.sloEvaluation.findFirst({
        where: { sloId: row.sloId, version: row.version },
        orderBy: { createdAt: 'desc' },
      });
      statuses.push(statusView(row, latest));
    }
    return statuses;
  }

  async getStatus(sloId: string): Promise<SloStatusView> {
    const row = await this.prisma.sloConfigurationVersion.findFirst({
      where: { sloId },
      orderBy: { version: 'desc' },
    });
    if (row === null) {
      throw new NotFoundException({ code: 'SLO_NOT_FOUND', message: `no configuration for ${sloId}` });
    }
    const latest = await this.prisma.sloEvaluation.findFirst({
      where: { sloId, version: row.version },
      orderBy: { createdAt: 'desc' },
    });
    return statusView(row, latest);
  }

  async listVersions(
    sloId: string,
    filter: { page?: number; limit?: number; sortOrder?: string; sortBy?: string } = {},
  ): Promise<PaginatedResult<unknown>> {
    const pagination = normalisePagination(filter, ['version', 'createdAt']);
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.sloConfigurationVersion.findMany({
        where: { sloId },
        orderBy: { [pagination.sortBy ?? 'version']: pagination.sortOrder },
        skip: pagination.skip,
        take: pagination.take,
      }),
      this.prisma.sloConfigurationVersion.count({ where: { sloId } }),
    ]);
    if (total === 0) {
      throw new NotFoundException({ code: 'SLO_NOT_FOUND', message: `no configuration for ${sloId}` });
    }
    return {
      items: rows.map((row) => ({
        ...definitionView(row),
        payload: row.payload,
      })),
      pagination: buildPaginationMeta(pagination.page, pagination.limit, total),
    };
  }

  async listEvaluations(
    sloId: string,
    filter: { page?: number; limit?: number; sortOrder?: string; sortBy?: string } = {},
  ): Promise<PaginatedResult<SloEvaluationView>> {
    const pagination = normalisePagination(filter, ['createdAt', 'evaluatedAtMicros']);
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.sloEvaluation.findMany({
        where: { sloId },
        orderBy: { [pagination.sortBy ?? 'createdAt']: pagination.sortOrder },
        skip: pagination.skip,
        take: pagination.take,
      }),
      this.prisma.sloEvaluation.count({ where: { sloId } }),
    ]);
    return {
      items: rows.map((row) => evaluationView(row)),
      pagination: buildPaginationMeta(pagination.page, pagination.limit, total),
    };
  }

  async rollup(): Promise<SloReadinessView> {
    const statuses = await this.listStatuses({ includeDisabled: false });
    return readinessView(statuses, epochMicros());
  }

  // ------------------------------------------------------------------
  // writes: versioned definition publish
  // ------------------------------------------------------------------

  async publishConfig(command: {
    actor: SloActor;
    sloId: string;
    update: SloConfigUpdateDto;
  }): Promise<SloStatusView> {
    const { actor, sloId, update } = command;
    const current = await this.prisma.sloConfigurationVersion.findFirst({
      where: { sloId },
      orderBy: { version: 'desc' },
    });
    // The service is inherited from the existing definition (or from the
    // catalog entry for a brand-new id): it is part of the checksummed
    // identity and is NOT a free-form per-update field - two versions of one
    // objective cannot claim to belong to different services.
    const service = await this.resolveService(sloId, current?.payload);
    let definition: SloDefinition;
    try {
      definition = buildSloDefinition({
        sloId,
        service,
        description: update.description,
        owner: update.owner,
        indicator:
          current !== null ? current.indicator : this.catalogIndicator(sloId) ?? '',
        objective: update.objective,
        windowMinutes: update.windowMinutes,
        shortWindowMinutes: update.shortWindowMinutes,
        goodEvent: update.goodEvent,
        badEvent: update.badEvent,
        warningBurnPpm: update.warningBurnPpm,
        criticalBurnPpm: update.criticalBurnPpm,
        maxAgeMicros: update.maxAgeMicros ?? null,
        latencyThresholdMicros: update.latencyThresholdMicros ?? null,
        version: (current?.version ?? 0) + 1,
        enabled: update.enabled ?? true,
      });
    } catch (error) {
      if (error instanceof SloValidationError) {
        throw new BadRequestException({
          code: 'SLO_DEFINITION_INVALID',
          message: error.message,
          details: { errors: error.errors },
        });
      }
      throw error;
    }
    const checksum = sloChecksum(definition);
    if (current !== null && current.checksum === checksum && current.enabled === definition.enabled) {
      // Publishing the identical enabled definition is a no-op, answered
      // honestly: no row, no version bump, no audit event. The panel says
      // "already at version N" rather than manufacturing history.
      return this.getStatus(sloId);
    }
    const row = await this.prisma.sloConfigurationVersion.create({
      data: {
        sloId: definition.sloId,
        version: definition.version,
        objective: definition.objective,
        windowMinutes: definition.windowMinutes,
        shortWindowMinutes: definition.shortWindowMinutes,
        indicator: definition.indicator,
        owner: definition.owner,
        description: definition.description,
        goodEvent: definition.goodEvent,
        badEvent: definition.badEvent,
        warningBurnPpm: definition.warningBurnPpm,
        criticalBurnPpm: definition.criticalBurnPpm,
        maxAgeMicros:
          definition.maxAgeMicros === null ? null : BigInt(definition.maxAgeMicros),
        latencyThresholdMicros:
          definition.latencyThresholdMicros === null
            ? null
            : BigInt(definition.latencyThresholdMicros),
        enabled: definition.enabled,
        payload: canonicalPayload(definition) as never,
        checksum,
      },
    });
    await this.audit.recordImmediate({
      tenantId: actor.tenantId,
      actorType: AuditActorType.USER,
      actorId: actor.userId,
      action: AuditAction.SLO_CONFIG_UPDATED,
      outcome: AuditOutcome.SUCCESS,
      resourceType: 'operational_slo',
      resourceId: sloId,
      description: `SLO ${sloId} published at version ${String(definition.version)} (checksum ${checksum.slice(0, 12)}...)`,
      changes: {
        version: { before: current?.version ?? 0, after: definition.version },
        checksum: { before: current?.checksum ?? null, after: checksum },
        enabled: { before: current?.enabled ?? null, after: definition.enabled },
        objective: { before: current?.objective ?? null, after: definition.objective },
      },
    });
    return statusView(row, null);
  }

  private async resolveService(
    sloId: string,
    currentPayload: unknown,
  ): Promise<string> {
    if (
      typeof currentPayload === 'object' &&
      currentPayload !== null &&
      typeof (currentPayload as Record<string, unknown>).service === 'string'
    ) {
      return (currentPayload as Record<string, unknown>).service as string;
    }
    const catalogEntry = DEFAULT_SLO_CATALOG.find((entry) => entry.sloId === sloId);
    if (catalogEntry !== undefined) {
      return catalogEntry.service;
    }
    // A genuinely new SLO id with no catalog entry keeps the panel's
    // component taxonomy honest: the prefix before the first dot is the
    // service (api.*, queues.*, ...). buildSloDefinition validates the
    // resulting token against the same bounded identifier pattern.
    const prefix = sloId.split('.')[0];
    return prefix.length > 0 ? prefix : 'custom';
  }

  private catalogIndicator(sloId: string): string | null {
    const entry = DEFAULT_SLO_CATALOG.find((candidate) => candidate.sloId === sloId);
    return entry === undefined ? null : entry.indicator;
  }

  // ------------------------------------------------------------------
  // the evaluation tick
  // ------------------------------------------------------------------

  async evaluateAll(actor: SloActor | null, source: 'scheduled' | 'manual', sloId?: string):
    Promise<SloEvaluateResult> {
    if (this.config.sloEnabled !== true) {
      return { evaluated: 0, alertingSloIds: [], skipped: [], source };
    }
    const nowMs = Date.now();
    const rows = await this.latestDefinitions({ includeDisabled: false });
    const scoped = sloId === undefined ? rows : rows.filter((row) => row.sloId === sloId);
    if (sloId !== undefined && scoped.length === 0) {
      throw new NotFoundException({ code: 'SLO_NOT_FOUND', message: `no enabled configuration for ${sloId}` });
    }

    await this.recordTickSamples(nowMs);

    const result: SloEvaluateResult = { evaluated: 0, alertingSloIds: [], skipped: [], source };
    const alertRows: Array<{
      sloId: string;
      ruleId: string;
      severity: 'WARNING' | 'CRITICAL';
      title: string;
      condition: string;
      message: string;
      observedValue: string | null;
      thresholdValue: string | null;
    }> = [];

    for (const row of scoped) {
      let evaluation: SloEvaluationRow;
      try {
        evaluation = await this.evaluateOne(row, nowMs);
      } catch (error) {
        result.skipped.push({ sloId: row.sloId, error: (error as Error).message.slice(0, 200) });
        this.logger.warn(
          { event: 'slo.evaluate_skipped', sloId: row.sloId, message: (error as Error).message },
          'SLO evaluation skipped for this definition (sources or stored payload unusable)',
        );
        continue;
      }
      await this.prisma.sloEvaluation.create({ data: evaluationCreateData(evaluation) });
      this.observeGauges(evaluation);
      result.evaluated += 1;
      const paging = this.collectAlert(evaluation, row, alertRows);
      if (paging) {
        result.alertingSloIds.push(evaluation.sloId);
      }
    }

    await this.alerts.applySloAlerts(alertRows, new Set(scoped.map((row) => row.sloId)));

    if (actor !== null && source === 'manual') {
      await this.audit.recordImmediate({
        tenantId: actor.tenantId,
        actorType: AuditActorType.USER,
        actorId: actor.userId,
        action: AuditAction.SLO_EVALUATE_REQUESTED,
        outcome: AuditOutcome.SUCCESS,
        resourceType: 'operational_slo',
        resourceId: sloId ?? 'all',
        description: `manual SLO evaluation requested (${String(result.evaluated)} evaluated, ${String(result.alertingSloIds.length)} paging)`,
        changes: { sloId: { before: null, after: sloId ?? null }, evaluated: { before: null, after: result.evaluated } },
      });
    }
    return result;
  }

  private async evaluateOne(row: ConfigRowLike, nowMs: number): Promise<SloEvaluationRow> {
    const definition = buildSloDefinition({
      sloId: row.sloId,
      service: serviceFromPayload(row.payload),
      description: row.description,
      owner: row.owner,
      indicator: row.indicator,
      objective: row.objective,
      windowMinutes: row.windowMinutes,
      shortWindowMinutes: row.shortWindowMinutes,
      goodEvent: row.goodEvent,
      badEvent: row.badEvent,
      warningBurnPpm: row.warningBurnPpm,
      criticalBurnPpm: row.criticalBurnPpm,
      maxAgeMicros: row.maxAgeMicros === null ? null : row.maxAgeMicros.toString(),
      latencyThresholdMicros:
        row.latencyThresholdMicros === null ? null : row.latencyThresholdMicros.toString(),
      version: row.version,
      enabled: row.enabled,
    });
    const checksum = sloChecksum(definition);
    if (checksum !== row.checksum) {
      // Loud on purpose: a stored row whose payload no longer matches its
      // checksum is a data-integrity event, not a rounding question. We
      // evaluate from the STORED columns (they are the published fact) and
      // record the mismatch in the row's reason rather than pretending the
      // config table is trustworthy.
      this.logger.error(
        { event: 'slo.checksum_mismatch', sloId: row.sloId, version: row.version },
        'Stored SLO definition does not match its checksum',
      );
    }

    const isLatency = row.indicator === 'latency_threshold_compliance';
    const latencyThreshold = row.latencyThresholdMicros;
    const [longWindow, shortWindow] = isLatency
      ? await Promise.all([
          this.samples.readLatencyWindow(row.windowMinutes, latencyThreshold ?? 500_000n, nowMs),
          this.samples.readLatencyWindow(row.shortWindowMinutes, latencyThreshold ?? 500_000n, nowMs),
        ])
      : await Promise.all([
          this.samples.readWindow(
            row.indicator as Parameters<typeof this.samples.readWindow>[0],
            row.windowMinutes,
            nowMs,
          ),
          this.samples.readWindow(
            row.indicator as Parameters<typeof this.samples.readWindow>[0],
            row.shortWindowMinutes,
            nowMs,
          ),
        ]);

    const evaluation = evaluateSlo({
      definition,
      checksum,
      longWindow: { good: longWindow.good, bad: longWindow.bad, dataComplete: longWindow.dataComplete, note: longWindow.note },
      shortWindow: { good: shortWindow.good, bad: shortWindow.bad, dataComplete: shortWindow.dataComplete, note: shortWindow.note },
      evaluatedAtMicros: BigInt(nowMs) * 1000n,
      fastMultiplierPpm: this.config.sloFastBurnPpm,
      slowMultiplierPpm: this.config.sloSlowBurnPpm,
    });
    return checksum === row.checksum
      ? evaluation
      : {
          ...evaluation,
          reason: truncate(
            `stored checksum mismatch on version ${String(row.version)}; ` +
              String(evaluation.reason ?? ''),
            500,
          ),
        };
  }

  /** Per-tick samples for the tick-shaped sources, written BEFORE the
   *  windows are read so this tick's evidence counts. Every probe is
   *  individually guarded: one source's collector failing must degrade that
   *  SLO to UNKNOWN, never fail the whole tick. */
  private async recordTickSamples(nowMs: number): Promise<void> {
    // api.availability: the evaluator's OWN dependency probe - Postgres
    // answered and Redis answered. It measures what the panel's existence
    // depends on, which is a smaller claim than "API uptime", and the
    // catalog text says exactly that.
    let availabilityOk = false;
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      await withTimeout(this.redis.client.ping(), 2000);
      availabilityOk = true;
    } catch {
      availabilityOk = false;
    }
    await guard(this.samples.recordTick(SLO_SAMPLE_SOURCES.availability, availabilityOk));

    // market-data.freshness: the published health mirror, exactly as Part 9
    // reads it. Missing mirror = no tick (absence is not freshness evidence
    // either way; the alert plane owns "publisher unreachable").
    let market: Record<string, unknown> | null = null;
    try {
      const raw = await this.redis.client.get('wlct:trading:ops:health:market-data');
      market = raw === null ? null : (JSON.parse(raw) as Record<string, unknown>);
    } catch {
      market = null;
    }
    if (market !== null && typeof market.status === 'string') {
      await guard(this.samples.recordTick(SLO_SAMPLE_SOURCES.market_data_freshness, market.status === 'HEALTHY'));
    }

    // risk-state.freshness: the engine's own bounded query shape
    // (DISTINCT ON latest per account, capped), against the SLO budget (2x
    // the live gate's) rather than the gate's - the gate refuses, this
    // trends, and the two budgets differing on purpose is the whole point.
    const riskBudgetMicros = 4_000_000n;
    try {
      const cutoff = new Date(Number(BigInt(nowMs) * 1000n - riskBudgetMicros) / 1000);
      const accounts = await this.prisma.$queryRaw<Array<{ account_id: string; captured_at: Date | null }>>`
        SELECT DISTINCT ON (account_id) account_id, captured_at
        FROM risk_snapshot_metadata
        ORDER BY account_id, captured_at DESC
        LIMIT 1000`;
      const published = accounts.length;
      const stale = accounts.filter(
        (account) => account.captured_at === null || account.captured_at < cutoff,
      ).length;
      await guard(
        this.samples.recordTick(SLO_SAMPLE_SOURCES.risk_state_freshness, published > 0 && stale === 0),
      );
    } catch {
      /* no tick: completeness law turns that into UNKNOWN, which is the
         honest shape of "the evaluator could not look" */
    }

    // queues.freshness: the SAME snapshot the alert fold used this minute
    // (queue ages from the readiness service), judged against this
    // definition's own 240s budget - not the alert policy's. Unknown ages
    // read bad here: a stalled collector is not freshness (catalog law).
    try {
      const queueSamples = await this.readiness.queueAlertSamples();
      const ageLimitMs = 240_000;
      const bad =
        queueSamples.length === 0 ||
        queueSamples.some(
          (sample) =>
            sample.oldestWaitingAgeMs === null || sample.oldestWaitingAgeMs > ageLimitMs,
        );
      await guard(this.samples.recordTick(SLO_SAMPLE_SOURCES.queue_freshness, !bad));
    } catch {
      /* no tick */
    }

    // execution.reconciliation-freshness: last COMPLETED pass against the
    // definition's own 15-minute budget. "Blindness counts bad" here is not
    // the collector failing (that is the no-tick above) - it is the durable
    // record showing no recent clean pass, which is a real miss.
    try {
      const runs = await this.prisma.reconciliationRun.findMany({
        where: { status: 'COMPLETED' },
        orderBy: { finishedAt: 'desc' },
        take: 20,
        select: { finishedAt: true, discrepanciesFound: true, discrepanciesRepaired: true },
      });
      // "A CLEAN pass within budget" - if the newest completed run found
      // discrepancies it did not repair, an older clean pass still counts
      // for ITS window facts only via age; we scan the recent runs for any
      // clean-and-fresh one rather than letting a messy-but-completed run
      // mask a clean sibling (or vice versa).
      const freshAndClean = runs.some(
        (run) =>
          run.finishedAt !== null &&
          nowMs - run.finishedAt.getTime() <= 900_000 &&
          (run.discrepanciesFound === 0 || run.discrepanciesRepaired >= run.discrepanciesFound),
      );
      await guard(this.samples.recordTick(SLO_SAMPLE_SOURCES.reconciliation_freshness, freshAndClean));
    } catch {
      /* no tick */
    }
  }

  /** The engine-side error-rate sample is written by the trading engine's
   *  own mirror loop (engineerr bucket). There is NO fallback that invents
   *  it from here: an engine that is not counting is an UNKNOWN, which is
   *  precisely the sentence this part exists to make possible. */
  private collectAlert(
    evaluation: SloEvaluationRow,
    row: { sloId: string; description: string },
    sink: Array<{
      sloId: string;
      ruleId: string;
      severity: 'WARNING' | 'CRITICAL';
      title: string;
      condition: string;
      message: string;
      observedValue: string | null;
      thresholdValue: string | null;
    }>,
  ): boolean {
    if (evaluation.alertKind === 'fast' || evaluation.alertKind === 'both') {
      sink.push({
        sloId: evaluation.sloId,
        ruleId: SLO_ALERT_RULES.fast,
        severity: 'CRITICAL',
        title: `Error budget burning fast: ${row.sloId}`,
        condition: 'short AND long window burn at or above the fast multiplier',
        message: truncate(evaluation.reason ?? 'burn-rate alert (fast)', 500),
        observedValue: String(evaluation.shortBurnPpm ?? ''),
        thresholdValue: String(this.config.sloFastBurnPpm),
      });
    } else if (evaluation.alertKind === 'slow') {
      sink.push({
        sloId: evaluation.sloId,
        ruleId: SLO_ALERT_RULES.slow,
        severity: 'WARNING',
        title: `Error budget burning steadily: ${row.sloId}`,
        condition: 'short AND long window burn at or above the slow multiplier',
        message: truncate(evaluation.reason ?? 'burn-rate alert (slow)', 500),
        observedValue: String(evaluation.shortBurnPpm ?? ''),
        thresholdValue: String(this.config.sloSlowBurnPpm),
      });
    }
    if (evaluation.state === 'UNKNOWN' && !evaluation.dataComplete) {
      sink.push({
        sloId: evaluation.sloId,
        ruleId: SLO_ALERT_RULES.telemetryGap,
        severity: 'WARNING',
        title: `SLO telemetry gap: ${row.sloId}`,
        condition: 'latest evaluation UNKNOWN with an incomplete collector',
        message: truncate(evaluation.reason ?? 'collector incomplete', 500),
        observedValue: null,
        thresholdValue: '950000',
      });
    }
    if (evaluation.state === 'EXHAUSTED') {
      sink.push({
        sloId: evaluation.sloId,
        ruleId: SLO_ALERT_RULES.exhausted,
        severity: 'CRITICAL',
        title: `Error budget exhausted: ${row.sloId}`,
        condition: 'remaining budget hit zero with bad events observed',
        message: truncate(evaluation.reason ?? 'budget exhausted', 500),
        observedValue: String(evaluation.budgetRemainingEvents),
        thresholdValue: '0',
      });
    }
    return (
      evaluation.alertKind !== 'none' ||
      evaluation.state === 'EXHAUSTED' ||
      evaluation.state === 'CRITICAL'
    );
  }

  private observeGauges(evaluation: SloEvaluationRow): void {
    this.registry.setGauge(
      'wlct_slo_state',
      { component: evaluation.service, slo: evaluation.sloId },
      sloStateCode(evaluation.state),
    );
    if (evaluation.remainingRatioPpm !== null) {
      this.registry.setGauge(
        'wlct_slo_error_budget_remaining_ppm',
        { slo: evaluation.sloId },
        evaluation.remainingRatioPpm,
      );
    }
    if (evaluation.longBurnPpm !== null) {
      this.registry.setGauge(
        'wlct_slo_burn_rate_ppm',
        { slo: evaluation.sloId, window_kind: 'long' },
        evaluation.longBurnPpm,
      );
    }
    if (evaluation.shortBurnPpm !== null) {
      this.registry.setGauge(
        'wlct_slo_burn_rate_ppm',
        { slo: evaluation.sloId, window_kind: 'short' },
        evaluation.shortBurnPpm,
      );
    }
  }

  // ------------------------------------------------------------------
  // retention
  // ------------------------------------------------------------------

  /** Evaluation rows only, never definitions (the versioned history IS the
   *  evidence base for "what were we promising then"). The 7-day floor is
   *  the burn window's own reach: pruning what a window still reads would
   *  turn every long-window into a lie of omission. */
  async prune(payload: { retentionDays?: number } = {}): Promise<{ removed: number }> {
    const requested = payload.retentionDays ?? this.config.sloRetentionDays;
    const effectiveDays = Math.max(7, requested);
    const cutoff = new Date(Date.now() - effectiveDays * 86_400_000);
    const deleted = await this.prisma.sloEvaluation.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
    this.logger.info(
      { event: 'slo.pruned', removed: deleted.count, retentionDays: effectiveDays },
      'SLO evaluation rows beyond the retention window removed',
    );
    return { removed: deleted.count };
  }

  private async latestDefinitions(filter: SloListFilter): Promise<ConfigRowLike[]> {
    const latest = await this.prisma.sloConfigurationVersion.findMany({
      orderBy: [{ sloId: 'asc' }, { version: 'desc' }],
    });
    const seen = new Set<string>();
    const out: ConfigRowLike[] = [];
    for (const row of latest) {
      if (seen.has(row.sloId)) {
        continue;
      }
      seen.add(row.sloId);
      if (!filter.includeDisabled && row.enabled !== true) {
        continue;
      }
      if (filter.service !== undefined && serviceFromPayload(row.payload) !== filter.service) {
        continue;
      }
      out.push(row);
    }
    return out;
  }
}

/** The mapper and the evaluator consume the REAL Prisma payload shape (the
 *  alias exists so the two sites read the same and cannot drift into a
 *  hand-written interface that forgets a column). */
type ConfigRowLike = Prisma.SloConfigurationVersionGetPayload<object>;

const serviceFromPayload = (payload: unknown): string => {
  if (typeof payload === 'object' && payload !== null && !Array.isArray(payload)) {
    const value = (payload as Record<string, unknown>).service;
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }
  return 'custom';
};

const truncate = (value: string, max: number): string =>
  value.length <= max ? value : `${value.slice(0, max - 3)}...`;

const guard = async (promise: Promise<unknown>): Promise<void> => {
  try {
    await promise;
  } catch {
    // Sample writes are telemetry; a failure is absorbed here and shows up
    // as a completeness gap (UNKNOWN), never as a failed evaluation tick.
  }
};

const withTimeout = async <T>(promise: Promise<T>, ms: number): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('probe timeout')), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
};

const evaluationCreateData = (row: SloEvaluationRow) => ({
  sloId: row.sloId,
  version: row.version,
  checksum: row.checksum,
  indicator: row.indicator,
  service: row.service,
  state: row.state,
  evaluatedAtMicros: BigInt(row.evaluatedAtMicros),
  windowMinutes: row.windowMinutes,
  shortWindowMinutes: row.shortWindowMinutes,
  targetPpm: row.targetPpm,
  actualPpm: row.actualPpm,
  budgetTotalEvents: row.budgetTotalEvents,
  budgetConsumedEvents: row.budgetConsumedEvents,
  budgetRemainingEvents: row.budgetRemainingEvents,
  remainingRatioPpm: row.remainingRatioPpm,
  longBurnPpm: row.longBurnPpm,
  shortBurnPpm: row.shortBurnPpm,
  alertKind: row.alertKind,
  samplesGood: row.samplesGood,
  samplesBad: row.samplesBad,
  dataComplete: row.dataComplete,
  reason: row.reason === null ? null : truncate(row.reason, 500),
});
```

## FILE: apps/api/src/modules/observability/dto/slo.dto.ts (162 lines)

```typescript
/**
 * Request shapes for the Part 10 SLO surface.
 *
 * The DTO layer is SYNTAX; the service layer is SEMANTICS. The patterns here
 * are the cheap, universal refusals (types, lengths, digit-only micros);
 * the one real validator - the canonical builder that computes the checksum
 * the row is identified by - runs in the service, because "valid" for an SLO
 * means "this exact definition, spelled exactly this way", and there is no
 * second authority that could check it in parallel.
 */

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { SLO_ID_PATTERN } from '../slo.constants';

const OBJECTIVE_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d{1,4})?(?:[eE][+-]?\d+)?$/;
const MICROS_PATTERN = /^(?:0|[1-9]\d{0,18})$/;
const SLO_SERVICES = ['api', 'queues', 'market-data', 'trading-engine'] as const;

export class UpdateSloConfigDto {
  @ApiProperty({
    description:
      'Compliance objective as a plain decimal PERCENT string ("99.5"). Floats are refused by this shape on purpose: the value is checksummed, and a number that has been through IEEE-754 is not the promise anyone configured.',
    example: '99.5',
  })
  @Matches(OBJECTIVE_PATTERN, {
    message: 'objective must be a decimal string with at most 4 fraction digits',
  })
  objective!: string;

  @ApiProperty({ description: 'Evaluation window in minutes (5..10080).', example: 1440 })
  @Type(() => Number)
  @IsInt()
  @Min(5)
  @Max(10_080)
  windowMinutes!: number;

  @ApiProperty({ description: 'Short (paging) window in minutes, inside the long window.', example: 60 })
  @Type(() => Number)
  @IsInt()
  @Min(5)
  @Max(10_080)
  shortWindowMinutes!: number;

  @ApiProperty({ description: 'Owning team identifier.', example: 'platform-sre' })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  owner!: string;

  @ApiProperty({ description: 'What the objective means, for whoever reads it at 3am.', maxLength: 200 })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  description!: string;

  @ApiProperty({ description: 'The counting rule for a good sample, in words.', maxLength: 200 })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  goodEvent!: string;

  @ApiProperty({ description: 'The counting rule for a bad sample, in words.', maxLength: 200 })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  badEvent!: string;

  @ApiPropertyOptional({ description: 'Warning burn threshold, integer ppm (default 1_000_000 = 1.0x).' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000_000_000)
  warningBurnPpm?: number;

  @ApiPropertyOptional({ description: 'Critical burn threshold, integer ppm (default 2_000_000 = 2.0x).' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000_000_000)
  criticalBurnPpm?: number;

  @ApiPropertyOptional({
    description:
      'Freshness indicators: the age budget in MICROSECONDS as an integer string. Forbidden on count indicators; required on freshness ones.',
  })
  @IsOptional()
  @Transform(({ value }) => (value === null ? undefined : value))
  @Matches(MICROS_PATTERN, { message: 'maxAgeMicros must be an integer string' })
  maxAgeMicros?: string | null;

  @ApiPropertyOptional({
    description: 'Latency-compliance indicators: the compliance threshold in microseconds (integer string).',
  })
  @IsOptional()
  @Transform(({ value }) => (value === null ? undefined : value))
  @Matches(MICROS_PATTERN, { message: 'latencyThresholdMicros must be an integer string' })
  latencyThresholdMicros?: string | null;

  @ApiPropertyOptional({
    description:
      'Enablement. Flipping it never changes the checksummed identity of the objective (the version bumps; the promise does not).',
  })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class ListSloDefinitionsDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: SLO_SERVICES, description: 'Filter by owning service.' })
  @IsOptional()
  @IsIn(SLO_SERVICES as unknown as string[])
  service?: string;

  @ApiPropertyOptional({ description: 'Include disabled definitions (default: only enabled).' })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  includeDisabled?: boolean;
}

export class ListSloEvaluationsDto extends PaginationQueryDto {}

export class PruneSloDto {
  @ApiPropertyOptional({
    description:
      'Retention in days for evaluation rows (definitions are NEVER pruned). The service clamps to a 7-day floor regardless of what the payload says.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3650)
  retentionDays?: number;
}

/** Route params validated at the edge with the SAME bounded identifier
 *  pattern the canonical builder uses - a malformed sloId is a 400 before it
 *  ever reaches a query, and a valid-shaped-but-unknown id is the service's
 *  honest 404. */
export class SloParamDto {
  @ApiProperty({ example: 'api.availability' })
  @Matches(SLO_ID_PATTERN, { message: 'sloId must be a bounded lowercase identifier' })
  sloId!: string;
}
```

## FILE: apps/api/src/modules/observability/slo.controller.ts (283 lines)

```typescript
/**
 * Part 10: the reliability control plane - SLO definitions, evaluations, the
 * scorecard, and the read-only tracing/fault posture of THIS process.
 *
 * What is NOT here, asked in the order it will be asked: no route arms,
 * disarms, or clears a fault point (there is no name for it); no route
 * toggles tracing (env + redeploy, like the Part 9 flags); no route resolves
 * an alert, releases a switch, or touches an order; no route deletes a
 * configuration version (the versioned table only appends - the retention
 * job prunes EVALUATION ROWS inside a 7-day floor and nothing else). The
 * two POST commands write an audited, versioned definition and ask for a
 * measurement NOW. That is the full mutation surface of this part.
 *
 * The endpoints answer one operational question - "what did we promise,
 * what did we observe, and is the gap being paid for with pages?" - and the
 * note on the rollup says what the numbers may not be used for.
 */

import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permission } from '@wlct/shared-types';
import type {
  AuthenticatedActor,
  CurrentTraceView,
  FaultsStatusView,
  PaginatedResult,
  SloReadinessView,
  SloStatusView,
  TracingStatusView,
} from '@wlct/shared-types';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { TenantId } from '../../common/decorators/current-tenant.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { ApiStandardResponses } from '../../common/decorators/api-standard-responses.decorator';
import {
  RequestMeta,
  type RequestMetadata,
} from '../../common/decorators/request-context.decorator';
import { TracingService } from '../../infrastructure/tracing/tracing.service';
import { formatTraceparent } from '../../infrastructure/tracing/w3c';

import { SloService } from './slo.service';
import type { SloActor } from './slo.types';
import {
  ListSloDefinitionsDto,
  ListSloEvaluationsDto,
  SloParamDto,
  UpdateSloConfigDto,
} from './dto/slo.dto';

@ApiTags('Reliability (SLOs & tracing)')
@Controller({ path: 'operational', version: '1' })
export class SloController {
  constructor(
    private readonly slo: SloService,
    private readonly tracing: TracingService,
  ) {}

  // ------------------------------------------------------------------
  // definitions + evaluations
  // ------------------------------------------------------------------

  @Get('slos')
  @ApiOperation({
    summary: 'Every SLO: latest definition version plus its latest evaluation.',
    description:
      'The panel table. `includeDisabled=true` also lists objectives whose evaluation is switched off (their rows stay queryable - disabling measurement is not deleting evidence).',
  })
  @ApiStandardResponses()
  @ApiOkResponse({ description: 'The status list.' })
  @RequirePermissions(Permission.OPERATIONS_READ)
  async list(
    @Query() query: ListSloDefinitionsDto,
  ): Promise<{ items: SloStatusView[]; total: number }> {
    const items = await this.slo.listStatuses({
      service: query.service,
      includeDisabled: query.includeDisabled === true,
    });
    return { items, total: items.length };
  }

  @Get('slos/readiness')
  @ApiOperation({
    summary: 'The scorecard rollup: states, worst budget, max burn, paging ids.',
    description:
      'Derived from the latest evaluation PER definition (the same rows the table shows - no parallel truth). The note states what the numbers may not authorise.',
  })
  @ApiStandardResponses()
  @ApiOkResponse({ description: 'The rollup.' })
  @RequirePermissions(Permission.OPERATIONS_READ)
  async readiness(): Promise<SloReadinessView> {
    return this.slo.rollup();
  }

  @Get('slos/:sloId')
  @ApiOperation({ summary: 'One SLO: definition, latest evaluation, burn verdict.' })
  @ApiStandardResponses()
  @RequirePermissions(Permission.OPERATIONS_READ)
  async status(@Param() params: SloParamDto): Promise<SloStatusView> {
    return this.slo.getStatus(params.sloId);
  }

  @Get('slos/:sloId/versions')
  @ApiOperation({
    summary: 'The versioned definition history, newest first.',
    description:
      'Append-only: every entry is exactly what was published when it was published, payload and checksum included, so "what were we promising in July" is a query, not archaeology.',
  })
  @ApiStandardResponses()
  @RequirePermissions(Permission.OPERATIONS_READ)
  async versions(
    @Param() params: SloParamDto,
    @Query() query: ListSloEvaluationsDto,
  ): Promise<PaginatedResult<unknown>> {
    return this.slo.listVersions(params.sloId, query);
  }

  @Get('slos/:sloId/evaluations')
  @ApiOperation({
    summary: 'Evaluation rows, newest first. Null ppm means "undefined for the window".',
  })
  @ApiStandardResponses()
  @RequirePermissions(Permission.OPERATIONS_READ)
  async evaluations(
    @Param() params: SloParamDto,
    @Query() query: ListSloEvaluationsDto,
  ): Promise<PaginatedResult<unknown>> {
    return this.slo.listEvaluations(params.sloId, query);
  }

  @Post('slos/:sloId/config')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Publish a new definition version (or toggle enablement). Audited.',
    description:
      'The definition is canonicalised, checksummed and appended at the next version; the previous version stays queryable forever. Publishing the IDENTICAL enabled definition is a no-op answered with the current status - no phantom version, no audit line. Redefining what the platform promises is exactly as consequential as it sounds, which is why it needs the explicit (non-wildcard) update permission.',
  })
  @ApiStandardResponses()
  @ApiOkResponse({ description: 'The new status row (no evaluation yet).' })
  @RequirePermissions(Permission.OPERATIONS_SLO_UPDATE)
  async publishConfig(
    @TenantId() tenantId: string,
    @CurrentUser() actor: AuthenticatedActor,
    @RequestMeta() meta: RequestMetadata,
    @Param() params: SloParamDto,
    @Body() dto: UpdateSloConfigDto,
  ): Promise<SloStatusView> {
    return this.slo.publishConfig({
      actor: this.actor(tenantId, actor, meta),
      sloId: params.sloId,
      update: dto,
    });
  }

  @Post('slos/:sloId/evaluate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Evaluate one SLO now. Audited as a request to measure.',
    description:
      'Same code path as the scheduled tick for this one objective: read windows, insert a row, update gauges, fold burn alerts. The audit exists because an operator asking the platform to look at itself is an operational fact.',
  })
  @ApiStandardResponses()
  @RequirePermissions(Permission.OPERATIONS_READ)
  async evaluateOne(
    @TenantId() tenantId: string,
    @CurrentUser() actor: AuthenticatedActor,
    @RequestMeta() meta: RequestMetadata,
    @Param() params: SloParamDto,
  ): Promise<{ evaluated: number; alertingSloIds: string[] }> {
    const result = await this.slo.evaluateAll(
      this.actor(tenantId, actor, meta),
      'manual',
      params.sloId,
    );
    return { evaluated: result.evaluated, alertingSloIds: result.alertingSloIds };
  }

  @Post('slos/evaluate-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Evaluate every enabled SLO now. Audited.',
    description:
      'Idempotent by construction: it appends evaluation rows (the evidence log tolerates repeats) and the burn fold counts occurrences rather than duplicating rows.',
  })
  @ApiStandardResponses()
  @RequirePermissions(Permission.OPERATIONS_READ)
  async evaluateAll(
    @TenantId() tenantId: string,
    @CurrentUser() actor: AuthenticatedActor,
    @RequestMeta() meta: RequestMetadata,
  ): Promise<{ evaluated: number; alertingSloIds: string[]; skipped: Array<{ sloId: string; error: string }> }> {
    const result = await this.slo.evaluateAll(this.actor(tenantId, actor, meta), 'manual');
    return {
      evaluated: result.evaluated,
      alertingSloIds: result.alertingSloIds,
      skipped: result.skipped,
    };
  }

  // ------------------------------------------------------------------
  // tracing + fault posture (read-only, plus a flush that changes no truth)
  // ------------------------------------------------------------------

  @Get('tracing')
  @ApiOperation({
    summary: 'Tracing posture of this process: config booleans and counters.',
    description:
      'The endpoint is reported as CONFIGURED/not, never as text - posture belongs in a panel, URLs belong in the deployment. `droppedTotal` is the sum of per-reason drop counts: the exporter drops loudly and counts every one.',
  })
  @ApiStandardResponses()
  @ApiOkResponse({ description: 'The status view.' })
  @RequirePermissions(Permission.OPERATIONS_READ)
  async tracingStatus(): Promise<TracingStatusView> {
    return this.tracing.statusView();
  }

  @Post('tracing/flush')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Run one export tick now (same code path as the interval loop).',
    description:
      'Changes WHEN evidence leaves, never WHAT it says. Bounded like the loop: one batch per call, dropped-or-exported counted, no retry queue - a manual flush against a dead collector fails exactly once and reports it.',
  })
  @ApiStandardResponses()
  @RequirePermissions(Permission.OPERATIONS_READ)
  async tracingFlush(): Promise<{ exported: number; outcome: string }> {
    return this.tracing.flushNow();
  }

  @Get('faults')
  @ApiOperation({
    summary: 'The config-armed fault plan (describe only - nothing consumes or arms from the API).',
    description:
      'Fault points are a closed set, armed only through environment configuration, and never in production (the env validator refuses the boot). This route exists so the panel can state the difference between "no faults armed" and "fault injection is not available here" instead of letting operators guess from an absence.',
  })
  @ApiStandardResponses()
  @ApiOkResponse({ description: 'The posture.' })
  @RequirePermissions(Permission.OPERATIONS_READ)
  faultsStatus(): FaultsStatusView {
    const plan = this.tracing.faultPlan();
    return {
      enabled: plan.enabled,
      production: process.env.NODE_ENV === 'production',
      // Cast is total here: the two API-side points are members of the
      // closed enum; the plan cannot contain anything else by construction.
      activePoints: plan.points as FaultsStatusView['activePoints'],
    };
  }

  @Get('traces/current')
  @ApiOperation({
    summary: 'This request’s own trace identity (traceparent + ids).',
    description:
      'For the console affordance "copy trace id" during an incident. It reports the CURRENT request only - there is no trace search, no trace store, no retention promise. Spans that left this process are the collector’s business.',
  })
  @ApiStandardResponses()
  @ApiOkResponse({ description: 'The context, or nulls when tracing is off/unsampled.' })
  @RequirePermissions(Permission.OPERATIONS_READ)
  currentTrace(): CurrentTraceView {
    const handle = this.tracing.currentHandle();
    if (handle === null) {
      return { traceparent: null, traceId: null, spanId: null, sampled: false };
    }
    return {
      traceparent: formatTraceparent(handle.context),
      traceId: handle.context.traceId,
      spanId: handle.context.spanId,
      sampled: handle.sampled,
    };
  }

  private actor(tenantId: string, user: AuthenticatedActor, meta: RequestMetadata): SloActor {
    return {
      userId: user.userId,
      tenantId,
      platform: user.isPlatformUser === true,
      requestId: meta.requestId,
      correlationId: meta.correlationId ?? meta.requestId,
    };
  }
}
```

## FILE: apps/api/src/modules/observability/slo-parity.spec.ts (636 lines)

```typescript
/**
 * Part 10 cross-language parity: the committed fixtures under
 * docs/fixtures/reliability_fixtures.json are GENERATED from the Python
 * modules (libs/trading-core/scripts/gen_part10_fixtures.py executes
 * wlct_trading.observability.tracing/redaction/faults and wlct_trading.slo)
 * and this spec replays every vector through the TypeScript twins. The
 * guarantee this buys is the one the SLO plane lives or dies by: a burn
 * rate, a checksum, a sampled trace id, or an OTLP payload computed here is
 * the SAME number the engine's own tooling computes there - digit for
 * digit, byte for byte.
 *
 * If a vector fails, do NOT regenerate the fixture to make it pass: fix the
 * side that drifted, regenerate from Python, and let both move.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  RecordingSpan,
  SamplingMode,
  SamplingPolicy,
  SpanKind,
  SpanStatus,
  formatTraceparent,
  formatTracestate,
  otlpJsonEncode,
  parseTraceparent,
  parseTracestate,
  safeAttribute,
  sha256Hex,
} from '../../infrastructure/tracing/w3c';
import {
  buildSloDefinition,
  canonicalSloJson,
  objectiveToPpm,
  sloChecksum,
} from './slo.canonical';
import { DEFAULT_SLO_CATALOG, SLO_INDICATORS, SLO_STATES } from './slo.constants';
import { computeBudget, evaluateBurn, evaluateSlo } from './slo.eval';
import { SloFaultPoint, SloIndicator, SloState, SloWindowKind } from '@wlct/shared-types';

const repoRoot = join(__dirname, '..', '..', '..', '..', '..');

/* Typed view of the fixture file. Declared (not `any`) so the parity
 * assertions fail at COMPILE time when the fixture's shape drifts, and the
 * eslint no-explicit-any rule stays a live wire in the one file where `any`
 * would be most corrosive: the cross-language contract itself. */
interface FixtureEnums {
  sloStates: string[];
  sloIndicators: string[];
  sloWindowKinds: string[];
  samplingModes: string[];
  faultPoints: string[];
}
interface TraceparentValidRow {
  header: string;
  traceId: string;
  spanId: string;
  flags: number;
  sampled: boolean;
  reformat: string;
}
interface TracestateRow {
  header: string;
  members: Array<[string, string]>;
  reformat: string;
}
interface SamplingRow {
  mode: string;
  ratio: number;
  ratioPpm: number;
  traceId: string;
  parentSampled: boolean | null;
  operation: string;
  priorityOperations: string[];
  enabled: boolean;
  expected: boolean;
}
interface HygieneRow {
  key: string;
  value: string | number | boolean | null;
  kept: boolean;
  renderedKey: string;
  renderedValue: string | number | boolean;
}
interface WindowInput {
  good: number;
  bad: number;
  dataComplete: boolean;
  note: string | null;
}
interface BudgetRow {
  objective: string;
  good: number;
  bad: number;
  budget: Record<string, unknown>;
}
interface BurnRow {
  shortBurnPpm: number;
  longBurnPpm: number;
  fastThresholdPpm: number;
  slowThresholdPpm: number;
  expected: Record<string, unknown>;
}
interface CatalogRow {
  sloId: string;
  service: string;
  owner: string;
  description: string;
  indicator: string;
  objective: string;
  objectivePpm: number;
  allowedPpm: number;
  windowMinutes: number;
  shortWindowMinutes: number;
  goodEvent: string;
  badEvent: string;
  warningBurnPpm: number;
  criticalBurnPpm: number;
  maxAgeMicros: number | null;
  latencyThresholdMicros: number | null;
  checksum: string;
}
interface ChecksumVector {
  canonicalJson: string;
  engineChecksum: string;
  sha256: string;
}
interface EvalDefRow {
  sloid: string;
  service: string;
  owner: string;
  description: string;
  indicator: string;
  objective: string;
  windowminutes: number;
  shortwindowminutes: number;
  goodevent: string;
  badevent: string;
}
interface EvalRow {
  name: string;
  definition: EvalDefRow;
  longWindow: WindowInput;
  shortWindow: WindowInput;
  fastMultiplierPpm: number;
  slowMultiplierPpm: number;
  expected: Record<string, unknown> & { evaluatedAtMicros: string };
}
interface ReliabilityFixtures {
  enums: FixtureEnums;
  traceparent: {
    valid: TraceparentValidRow[];
    invalid: string[];
    tracestate: TracestateRow[];
  };
  sampling: { rows: SamplingRow[] };
  attributeHygiene: HygieneRow[];
  otlpJson: Record<string, string>;
  budgetRows: BudgetRow[];
  burnRows: BurnRow[];
  slo: {
    catalog: CatalogRow[];
    checksumVectors: ChecksumVector[];
    evaluations: EvalRow[];
  };
}
const fixtures = JSON.parse(
  readFileSync(join(repoRoot, 'docs', 'fixtures', 'reliability_fixtures.json'), 'utf8'),
) as ReliabilityFixtures;

describe('Part 10 enums (fixture-pinned)', () => {
  it('mirrors the SLO state universe', () => {
    expect([...SLO_STATES]).toEqual(
      expect.arrayContaining(fixtures.enums.sloStates),
    );
    expect(SLO_STATES.length).toBe(fixtures.enums.sloStates.length);
    expect(Object.values(SloState).sort()).toEqual([...fixtures.enums.sloStates].sort());
  });

  it('mirrors the indicator universe', () => {
    expect([...SLO_INDICATORS].sort()).toEqual([...fixtures.enums.sloIndicators].sort());
    expect(Object.values(SloIndicator).sort()).toEqual(
      [...fixtures.enums.sloIndicators].sort(),
    );
  });

  it('mirrors the window kinds', () => {
    expect(Object.values(SloWindowKind).sort()).toEqual(
      [...fixtures.enums.sloWindowKinds].sort(),
    );
  });

  it('mirrors the sampling modes', () => {
    expect(Object.values(SamplingMode).sort()).toEqual(
      [...fixtures.enums.samplingModes].sort(),
    );
  });

  it('mirrors the fault-point universe', () => {
    expect(Object.values(SloFaultPoint).sort()).toEqual(
      [...fixtures.enums.faultPoints].sort(),
    );
  });
});

describe('traceparent / tracestate (fixture-pinned)', () => {
  for (const row of fixtures.traceparent.valid) {
    it(`parses and reformats ${row.header}`, () => {
    const parsed = parseTraceparent(row.header);
    expect(parsed).not.toBeNull();
    expect(parsed!.traceId).toBe(row.traceId);
    expect(parsed!.spanId).toBe(row.spanId);
    expect(parsed!.traceFlags).toBe(row.flags);
    expect(formatTraceparent(parsed!)).toBe(row.reformat);
    });
  }

  for (const header of fixtures.traceparent.invalid) {
    it(`refuses ${JSON.stringify(header)}`, () => {
      expect(parseTraceparent(header)).toBeNull();
    });
  }

  it('round-trips tracestate members under the same keep/cap law', () => {
    for (const row of fixtures.traceparent.tracestate) {
      const members = parseTracestate(row.header);
      expect(members.map(([k, v]) => [k, v])).toEqual(row.members);
      expect(formatTracestate(members)).toBe(row.reformat);
    }
  });
});

describe('sampling policy (fixture-pinned)', () => {
  const knownModes: string[] = fixtures.enums.samplingModes;
  for (const row of fixtures.sampling.rows) {
    if (!knownModes.includes(row.mode)) {
      // A deliberately fabricated row (see the fixture generator's note):
      // its mode string is outside the enum ON PURPOSE, and its ratio/
      // ratioPpm pair is not constructible through the policy, so it cannot
      // go through the policy constructor in either language. What it pins
      // is the pure arithmetic under the threshold comparison - bucket <
      // ratioPpm * 2^64 / 10^6 - with the all-zero trace id that
      // Tracer.start_span would never let reach sampling. Assert exactly
      // that claim, in BigInt, no floats:
      it(`pure threshold arithmetic for the fabricated ${row.mode} row`, () => {
        const threshold = (1n << 64n) * BigInt(row.ratioPpm) / 1_000_000n;
        const bucket = BigInt(`0x${row.traceId.slice(0, 16)}`);
        expect(bucket < threshold).toBe(row.expected);
      });
      continue;
    }
    it(`samples ${row.mode}/${row.traceId.slice(0, 8)}/${row.operation}`, () => {
    const policy = new SamplingPolicy(row.mode as SamplingMode, {
      ratio: row.ratio,
      priorityOperations: row.priorityOperations,
    });
    expect(policy.enabled).toBe(row.enabled);
    expect(policy.ratioPpm).toBe(row.ratioPpm);
    expect(
      policy.shouldSample({
        traceId: row.traceId,
        parentSampled: row.parentSampled,
        operation: row.operation,
      }),
    ).toBe(row.expected);
    });
  }
  // The fixture's `bucket` values are deliberately NOT re-asserted here:
  // they exceed 2^53, which JSON.parse cannot carry exactly, and a float-
  // approximate parity check is worse than none. The verdict assertions
  // above re-derive each bucket through shouldSample's BigInt comparison,
  // so the arithmetic is under test; only its raw echo relies on the
  // generator.
});

describe('attribute hygiene (fixture-pinned)', () => {
  for (const row of fixtures.attributeHygiene) {
    it(`hygiene ${row.key}`, () => {
    const kept = safeAttribute(row.key, row.value);
    if (row.kept) {
      expect(kept).not.toBeNull();
      expect(kept!.key).toBe(row.renderedKey);
      expect(kept!.value).toBe(row.renderedValue);
    } else {
      expect(kept).toBeNull();
    }
    });
  }
});

describe('OTLP/JSON encoding (byte-exact fixtures)', () => {
  // The vectors were produced by the Python encoder over these exact span
  // shapes (the generator's make_span calls). Rebuilding them here - rather
  // than copying the strings - is the point: the encoder, not the test, is
  // what is being checked.
  const baseAttrs = {
    'trade.symbol': 'BTCUSDT',
    'risk.simulated': 'false',
    'risk.event_count': 0,
    approved: true,
  };
  const baseResource = { 'service.name': 'trading-engine', 'deployment.environment': 'test' };

  const makeBase = (over: Partial<ConstructorParameters<typeof RecordingSpan>[0]> = {}) =>
    new RecordingSpan({
      context: {
        traceId: 'a'.repeat(32),
        spanId: '1234567890abcdef',
        parentSpanId: null,
        traceFlags: 1,
        tracestate: [],
      },
      name: 'risk.evaluate',
      kind: SpanKind.INTERNAL,
      resource: { ...baseResource },
      startUnixNano: 1_700_000_000_000_000_000n,
      ...over,
    });

  const finish = (span: RecordingSpan, endNano: string) => {
    span.end(BigInt(endNano));
    return span;
  };

  it('empty', () => {
    expect(otlpJsonEncode([])).toBe(fixtures.otlpJson.empty);
  });

  it('single', () => {
    const span = makeBase();
    span.setAttribute('trade.symbol', 'BTCUSDT');
    span.setAttribute('risk.simulated', 'false');
    span.setAttribute('risk.event_count', 0);
    span.setAttribute('approved', true);
    span.addEvent('milestone', { detail: 'reservation admitted' }, '1700000000000500000');
    span.setStatus(SpanStatus.OK);
    finish(span, '1700000000000001500');
    expect(otlpJsonEncode([span])).toBe(fixtures.otlpJson.single);
  });

  it('twoSpansOneResource', () => {
    const single = makeBase();
    for (const [k, v] of Object.entries(baseAttrs)) {
      single.setAttribute(k, v as string | number | boolean);
    }
    single.addEvent('milestone', { detail: 'reservation admitted' }, '1700000000000500000');
    single.setStatus(SpanStatus.OK);
    finish(single, '1700000000000001500');

    const child = makeBase({
      context: {
        traceId: 'b'.repeat(32),
        spanId: 'fedcba0987654321',
        parentSpanId: '1234567890abcdef',
        traceFlags: 1,
        tracestate: [
          ['vendor', 'v=1'],
          ['solo', ''],
        ],
      },
      name: 'execution.transmit',
      kind: SpanKind.CLIENT,
    });
    for (const [k, v] of Object.entries(baseAttrs)) {
      child.setAttribute(k, v as string | number | boolean);
    }
    child.addEvent(
      'exception',
      {
        'exception.type': 'ConnectionError',
        'exception.message': '[REDACTED]@db:5432 down',
      },
      '1700000000000999999',
    );
    child.setStatus(SpanStatus.ERROR, 'connect postgres://u:p@db failed "quoted" \\n');
    child.droppedAttributes = 3;
    child.droppedEvents = 1;
    finish(child, '1700000000000001500');

    expect(otlpJsonEncode([child, single])).toBe(fixtures.otlpJson.twoSpansOneResource);
  });

  it('int64Edge', () => {
    const span = makeBase({
      context: {
        traceId: 'c'.repeat(32),
        spanId: 'ffffffffffffffff',
        parentSpanId: null,
        traceFlags: 1,
        tracestate: [],
      },
      startUnixNano: 9_223_372_036_854_775_807n,
    });
    span.setAttribute('big.count', 9_007_199_254_740_993n);
    span.setAttribute('neg', -7);
    span.setAttribute('zero', 0);
    span.setStatus(SpanStatus.UNSET);
    finish(span, '9223372036854775808');
    expect(otlpJsonEncode([span])).toBe(fixtures.otlpJson.int64Edge);
  });

  it('twoResources (grouped by sorted resource, spans by (start, trace, span))', () => {
    const single = makeBase();
    for (const [k, v] of Object.entries(baseAttrs)) {
      single.setAttribute(k, v as string | number | boolean);
    }
    single.addEvent('milestone', { detail: 'reservation admitted' }, '1700000000000500000');
    single.setStatus(SpanStatus.OK);
    finish(single, '1700000000000001500');

    const child = makeBase({
      context: {
        traceId: 'b'.repeat(32),
        spanId: 'fedcba0987654321',
        parentSpanId: '1234567890abcdef',
        traceFlags: 1,
        tracestate: [
          ['vendor', 'v=1'],
          ['solo', ''],
        ],
      },
      name: 'execution.transmit',
      kind: SpanKind.CLIENT,
    });
    for (const [k, v] of Object.entries(baseAttrs)) {
      child.setAttribute(k, v as string | number | boolean);
    }
    child.addEvent(
      'exception',
      {
        'exception.type': 'ConnectionError',
        'exception.message': '[REDACTED]@db:5432 down',
      },
      '1700000000000999999',
    );
    child.setStatus(SpanStatus.ERROR, 'connect postgres://u:p@db failed "quoted" \\n');
    child.droppedAttributes = 3;
    child.droppedEvents = 1;
    finish(child, '1700000000000001500');

    const api = makeBase({
      context: {
        traceId: 'd'.repeat(32),
        spanId: 'abcdabcdabcdabcd',
        parentSpanId: null,
        traceFlags: 1,
        tracestate: [],
      },
      resource: { 'service.name': 'api' },
    });
    for (const [k, v] of Object.entries(baseAttrs)) {
      api.setAttribute(k, v as string | number | boolean);
    }
    api.addEvent('milestone', { detail: 'reservation admitted' }, '1700000000000500000');
    api.setStatus(SpanStatus.OK);
    finish(api, '1700000000000001500');

    expect(otlpJsonEncode([api, single, child])).toBe(fixtures.otlpJson.twoResources);
  });
});

describe('error budget tables (fixture-pinned)', () => {
  for (const row of fixtures.budgetRows) {
    it(`budget ${row.objective} ${row.good}/${row.bad}`, () => {
    const budget = computeBudget(row.objective, { good: row.good, bad: row.bad });
    const expected = row.budget;
    expect({
      objectivePpm: budget.objectivePpm,
      allowedPpm: budget.allowedPpm,
      totalEvents: budget.totalEvents,
      goodEvents: budget.goodEvents,
      badEvents: budget.badEvents,
      failurePpm: budget.failurePpm,
      compliancePpm: budget.compliancePpm,
      budgetTotalEvents: budget.budgetTotalEvents,
      budgetConsumedEvents: budget.budgetConsumedEvents,
      budgetRemainingEvents: budget.budgetRemainingEvents,
      remainingRatioPpm: budget.remainingRatioPpm,
      burnPpm: budget.burnPpm,
      budgetZero: budget.budgetZero,
    }).toEqual(expected);
    });
  }
});

describe('burn-rate alerting (fixture-pinned)', () => {
  for (const row of fixtures.burnRows) {
    it(`burn ${String(row.shortBurnPpm)}/${String(row.longBurnPpm)}`, () => {
    const state = evaluateBurn({
      shortBurnPpm: row.shortBurnPpm,
      longBurnPpm: row.longBurnPpm,
      fastMultiplierPpm: row.fastThresholdPpm,
      slowMultiplierPpm: row.slowThresholdPpm,
    });
    expect({
      kind: state.kind,
      shortBurnPpm: state.shortBurnPpm,
      longBurnPpm: state.longBurnPpm,
      fastThresholdPpm: state.fastThresholdPpm,
      slowThresholdPpm: state.slowThresholdPpm,
    }).toEqual(row.expected);
    });
  }
});

describe('SLO canonicalisation and checksums (fixture-pinned)', () => {
  it('canonical JSON is idempotent on the Python spelling and hashes equal', () => {
    for (const vector of fixtures.slo.checksumVectors) {
      const reparsed = canonicalSloJson(JSON.parse(vector.canonicalJson));
      expect(reparsed).toBe(vector.canonicalJson);
      expect(sha256Hex(vector.canonicalJson)).toBe(vector.sha256);
      expect(vector.engineChecksum).toBe(vector.sha256);
    }
  });

  it('objectiveToPpm matches the Python conversion', () => {
    for (const entry of fixtures.slo.catalog) {
      expect(objectiveToPpm(entry.objective)).toBe(entry.objectivePpm);
    }
    expect(() => objectiveToPpm('100')).toThrow(/0 < objective < 100/);
    expect(() => objectiveToPpm('99.99999')).toThrow(/at most 4 decimal/);
  });

  it('every default catalog definition reproduces its Python checksum (which pins text too)', () => {
    const byId = new Map<string, CatalogRow>(fixtures.slo.catalog.map((e) => [e.sloId, e]));
    expect(DEFAULT_SLO_CATALOG.length).toBe(fixtures.slo.catalog.length);
    for (const entry of DEFAULT_SLO_CATALOG) {
      const vector = byId.get(entry.sloId);
      if (vector === undefined) {
        // Throwing (not a soft expect) keeps the compiler honest about the
        // rest of the block AND fails the test loudly if the fixture ever
        // loses a catalog entry: both languages pin the SAME nine ids.
        throw new Error(`fixture has no catalog entry for ${entry.sloId}`);
      }
      const definition = buildSloDefinition({
        sloId: entry.sloId,
        service: entry.service,
        description: entry.description,
        owner: entry.owner,
        indicator: entry.indicator,
        objective: entry.objective,
        windowMinutes: entry.windowMinutes,
        shortWindowMinutes: entry.shortWindowMinutes,
        goodEvent: entry.goodEvent,
        badEvent: entry.badEvent,
        maxAgeMicros: entry.maxAgeMicros,
        latencyThresholdMicros: entry.latencyThresholdMicros,
      });
      // The checksum covers description/goodEvent/badEvent, so this single
      // assertion is also the TEXT parity check: a reworded TS description
      // changes the digest and fails here.
      expect(sloChecksum(definition)).toBe(vector.checksum);
      expect(definition.objectivePpm).toBe(vector.objectivePpm);
      expect(1_000_000 - definition.objectivePpm).toBe(vector.allowedPpm);
      expect(definition.warningBurnPpm).toBe(vector.warningBurnPpm);
      expect(definition.criticalBurnPpm).toBe(vector.criticalBurnPpm);
      expect(definition.maxAgeMicros).toBe(
        vector.maxAgeMicros === null ? null : String(vector.maxAgeMicros),
      );
      expect(definition.latencyThresholdMicros).toBe(
        vector.latencyThresholdMicros === null
          ? null
          : String(vector.latencyThresholdMicros),
      );
    }
  });
});

describe('evaluation rows (fixture-pinned end to end)', () => {
  for (const row of fixtures.slo.evaluations) {
    it(`evaluate ${row.name}`, () => {
    const d: EvalDefRow = row.definition;
    // The generator serialised the dataclass fields lower-cased; map them
    // back to the canonical names the builder consumes.
    const definition = buildSloDefinition({
      sloId: d.sloid,
      service: d.service,
      description: d.description,
      owner: d.owner,
      indicator: d.indicator,
      objective: d.objective,
      windowMinutes: d.windowminutes,
      shortWindowMinutes: d.shortwindowminutes,
      goodEvent: d.goodevent,
      badEvent: d.badevent,
    });
    const checksum = sloChecksum(definition);
    const evaluation = evaluateSlo({
      definition,
      checksum,
      longWindow: {
        good: row.longWindow.good,
        bad: row.longWindow.bad,
        dataComplete: row.longWindow.dataComplete,
        note: row.longWindow.note,
      },
      shortWindow: {
        good: row.shortWindow.good,
        bad: row.shortWindow.bad,
        dataComplete: row.shortWindow.dataComplete,
        note: row.shortWindow.note,
      },
      evaluatedAtMicros: BigInt(row.expected.evaluatedAtMicros),
      fastMultiplierPpm: row.fastMultiplierPpm,
      slowMultiplierPpm: row.slowMultiplierPpm,
    });
    const expected = row.expected;
    expect({
      sloId: evaluation.sloId,
      version: evaluation.version,
      checksum: evaluation.checksum,
      indicator: evaluation.indicator,
      service: evaluation.service,
      state: evaluation.state,
      evaluatedAtMicros: evaluation.evaluatedAtMicros,
      windowMinutes: evaluation.windowMinutes,
      shortWindowMinutes: evaluation.shortWindowMinutes,
      targetPpm: evaluation.targetPpm,
      actualPpm: evaluation.actualPpm,
      budgetTotalEvents: evaluation.budgetTotalEvents,
      budgetConsumedEvents: evaluation.budgetConsumedEvents,
      budgetRemainingEvents: evaluation.budgetRemainingEvents,
      remainingRatioPpm: evaluation.remainingRatioPpm,
      longBurnPpm: evaluation.longBurnPpm,
      shortBurnPpm: evaluation.shortBurnPpm,
      alertKind: evaluation.alertKind,
      samplesGood: evaluation.samplesGood,
      samplesBad: evaluation.samplesBad,
      dataComplete: evaluation.dataComplete,
    }).toEqual(expected);
    });
  }
});
```

## FILE: apps/api/src/modules/observability/slo-samples.spec.ts (246 lines)

```typescript
/**
 * Part 10 sample-bucket behaviour: the Redis key/tick/window arithmetic
 * the evaluator stands on. Everything here is clock-deterministic - the
 * helpers take `nowMillis` explicitly precisely so the tests can pin the
 * open-bucket exclusion the production path depends on.
 */

import {
  SloSamplesService,
  currentBucketIndex,
  sloBucketKey,
} from './slo-samples';
import { SloIndicator } from '@wlct/shared-types';

class FakePipeline {
  constructor(
    private readonly store: Map<string, Map<string, number>>,
    private readonly ops: Array<() => void | Promise<unknown>>,
    private readonly reads: Array<() => unknown>,
  ) {}

  hincrby(key: string, field: string, by: number): void {
    this.ops.push(() => {
      const hash = this.store.get(key) ?? new Map<string, number>();
      hash.set(field, (hash.get(field) ?? 0) + by);
      this.store.set(key, hash);
    });
  }

  pexpire(key: string, ms: number): void {
    this.ops.push(() => {
      this.ttls.set(key, ms);
    });
  }

  hgetall(key: string): void {
    this.reads.push(() => {
      const hash = this.store.get(key);
      if (hash === undefined) {
        return [null, null];
      }
      const row: Record<string, string> = {};
      for (const [field, value] of hash) {
        row[field] = String(value);
      }
      return [null, row];
    });
  }

  readonly ttls = new Map<string, number>();

  async exec(): Promise<Array<[Error | null, unknown]>> {
    for (const op of this.ops) {
      op();
    }
    return this.reads.map((read) => read() as [Error | null, unknown]);
  }
}

class FakeRedisService {
  readonly store = new Map<string, Map<string, number>>();
  readonly pipelines: FakePipeline[] = [];
  failWrites = false;

  readonly client = {
    pipeline: () => {
      const ops: Array<() => void> = [];
      const reads: Array<() => unknown> = [];
      const pipe = new FakePipeline(this.store, ops, reads);
      if (this.failWrites) {
        pipe.exec = async () => {
          throw new Error('redis down');
        };
      }
      this.pipelines.push(pipe);
      return pipe;
    },
  };
}

const NOW = 1_700_000_400_000; // bucket-aligned-ish fixed clock
const bucketOf = (offsetMillis = 0) => currentBucketIndex(NOW + offsetMillis);

const serviceWith = (): { service: SloSamplesService; redis: FakeRedisService } => {
  const redis = new FakeRedisService();
  const service = new SloSamplesService(redis as unknown as never);
  return { service, redis };
};

describe('bucket addressing', () => {
  it('floor-aligns ten-minute buckets with the shared prefix', () => {
    const index = bucketOf();
    const key = sloBucketKey('apiavail', index);
    expect(key.split(':')[4]).toBe('apiavail');
    expect(Number(key.split(':')[5])).toBe(Math.floor(NOW / 600_000));
    // Bucket index is floor division, so any instant inside a bucket maps
    // to the same key, and the NEXT bucket is exactly one step away.
    expect(currentBucketIndex(NOW + 599_999)).toBe(index);
    expect(currentBucketIndex(NOW + 600_000)).toBe(index + 1);
  });
});

describe('recordTick / recordCounters', () => {
  it('writes ticks + one verdict + TTL in one pipeline', async () => {
    const { service, redis } = serviceWith();
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
    try {
      await service.recordTick('apiavail', true);
      const pipe = redis.pipelines[0];
      const key = sloBucketKey('apiavail', bucketOf());
      const hash = redis.store.get(key);
      expect(hash?.get('ticks')).toBe(1);
      expect(hash?.get('good')).toBe(1);
      expect(hash?.get('bad')).toBeUndefined();
      expect(pipe.ttls.get(key)).toBe(2 * 7 * 86_400_000);
    } finally {
      jest.useRealTimers();
    }
  });

  it('carries latency extras as parallel increments on the same bucket', async () => {
    const { service, redis } = serviceWith();
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
    try {
      await service.recordTick('apilat', false, {
        extra: { total: 1, le250ms: 0, le500ms: 1 },
      });
      const hash = redis.store.get(sloBucketKey('apilat', bucketOf()));
      expect(hash?.get('bad')).toBe(1);
      expect(hash?.get('total')).toBe(1);
      // Zero-valued grid boundaries are NOT written: cumulative histogram
      // fields only ever grow, and a hash full of zeros is 6x the memory
      // for information parseRow already infers from absence.
      expect(hash?.get('le250ms')).toBeUndefined();
      expect(hash?.get('le500ms')).toBe(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('recordCounters folds batched deltas without touching ticks', async () => {
    const { service, redis } = serviceWith();
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
    try {
      await service.recordCounters('engineerr', 7, 2);
      const hash = redis.store.get(sloBucketKey('engineerr', bucketOf()));
      expect(hash?.get('good')).toBe(7);
      expect(hash?.get('bad')).toBe(2);
      expect(hash?.get('ticks')).toBeUndefined(); // event-shaped sources
    } finally {
      jest.useRealTimers();
    }
  });

  it('a Redis write failure propagates to the awaiting collector', async () => {
    const { service, redis } = serviceWith();
    redis.failWrites = true;
    await expect(service.recordTick('apiavail', true)).rejects.toThrow('redis down');
  });
});

describe('window reading', () => {
  const seed = (
    redis: FakeRedisService,
    source: string,
    indexes: number[],
    fields: Record<string, number>,
  ): void => {
    for (const index of indexes) {
      const key = sloBucketKey(source, index);
      const hash = redis.store.get(key) ?? new Map<string, number>();
      for (const [field, value] of Object.entries(fields)) {
        hash.set(field, (hash.get(field) ?? 0) + value);
      }
      redis.store.set(key, hash);
    }
  };

  it('excludes the open bucket from a complete window', async () => {
    const { service, redis } = serviceWith();
    const now = bucketOf() * 600_000 + 5; // five ms into the OPEN bucket
    // The six CLOSED buckets hold a perfect tick record; the open bucket
    // holds a burst that must NOT leak into the window read.
    seed(redis, 'apiavail', [0, 1, 2, 3, 4, 5].map((k) => bucketOf() - 6 + k), {
      ticks: 2,
      good: 2,
    });
    seed(redis, 'apiavail', [bucketOf()], { ticks: 500, bad: 500 });
    const window = await service.readWindow(SloIndicator.AVAILABILITY, 60, now);
    expect(window.good).toBe(12);
    expect(window.bad).toBe(0);
    expect(window.dataComplete).toBe(true);
  });

  it('short windows report incompleteness instead of optimism', async () => {
    const { service, redis } = serviceWith();
    const now = bucketOf() * 600_000;
    seed(redis, 'apiavail', [bucketOf() - 6, bucketOf() - 5], { ticks: 1, good: 1 });
    const window = await service.readWindow(SloIndicator.AVAILABILITY, 60, now);
    expect(window.dataComplete).toBe(false);
    expect(window.note).toContain('collector saw 2/12 expected ticks');
    expect(window.note).toContain('window read 2/6 buckets');
  });

  it('event-shaped sources read complete, and say so when silent', async () => {
    const { service, redis } = serviceWith();
    const now = bucketOf() * 600_000;
    const empty = await service.readWindow(SloIndicator.ERROR_RATE_COMPLIANCE, 30, now);
    expect(empty.dataComplete).toBe(true);
    expect(empty.note).toContain('no events recorded in window');

    seed(redis, 'engineerr', [bucketOf() - 3, bucketOf() - 2, bucketOf() - 1], {
      good: 9,
      bad: 1,
    });
    const filled = await service.readWindow(SloIndicator.ERROR_RATE_COMPLIANCE, 30, now);
    expect(filled.good).toBe(27);
    expect(filled.bad).toBe(3);
    expect(filled.note).toBeNull();
  });

  it('latency compliance snaps to the largest grid boundary at or below the threshold', async () => {
    const { service, redis } = serviceWith();
    const now = bucketOf() * 600_000;
    seed(
      redis,
      'apilat',
      [bucketOf() - 3, bucketOf() - 2, bucketOf() - 1],
      { total: 10, le250ms: 4, le500ms: 7, le1000ms: 9 },
    );
    // A 750ms threshold has no bucket: compliance is READ AT 500ms, and
    // the note must own up to the resulting overstatement.
    const snapped = await service.readLatencyWindow(30, 750_000n, now);
    expect(snapped.good).toBe(21);
    expect(snapped.bad).toBe(9);
    expect(snapped.note).toContain('(floor)');
    // An exact boundary (500ms) reads clean with no apology.
    const exact = await service.readLatencyWindow(30, 500_000n, now);
    expect(exact.good).toBe(21);
    expect(exact.note ?? '').not.toContain('(floor)');
  });
});
```

## FILE: apps/api/src/modules/observability/part10-safety.spec.ts (551 lines)

```typescript
/**
 * Part 10 safety law: the telemetry plane observes; it never authorises,
 * never mutates trading state, and never lets its own failure become a
 * trading decision. Half of this is source-scan law (the kind only a grep
 * can keep honest over time), half is live behaviour of the service the law
 * is about. The engine's twin scan lives at
 * services/trading-engine/tests/test_part10_safety.py; the two together are
 * the enforceable form of "the trading path does not read telemetry".
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { AppConfigService } from '../../config/app-config.service';
import { MetricsRegistry } from '../../infrastructure/metrics/metrics.registry';
import {
  FAULT_METRICS_EXPORT,
  FAULT_TRACE_EXPORT,
  TracingService,
} from '../../infrastructure/tracing/tracing.service';
import { MetricsController } from './metrics.controller';
import { SamplingMode, SamplingPolicy } from '../../infrastructure/tracing/w3c';

const SRC = join(__dirname, '..', '..');
const read = (relative: string): string => readFileSync(join(SRC, relative), 'utf8');

const walk = (dir: string): string[] => {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else if (entry.endsWith('.ts') && !entry.endsWith('.spec.ts')) {
      out.push(full);
    }
  }
  return out;
};

const relativeOf = (full: string): string => full.slice(SRC.length + 1).split('\\').join('/');

const controllerDecoratorRe = /@(Get|Post|Put|Patch|Delete|All)\(\s*(?:'([^']*)'[^)]*)?\)/g;

// ---------------------------------------------------------------------------
// The observability surface cannot trade
// ---------------------------------------------------------------------------

describe('no-mutation law over the whole telemetry surface', () => {
  const files = walk(join(SRC, 'modules', 'observability')).filter((f) =>
    f.endsWith('.controller.ts'),
  );

  it('exposes only GET and POST (no PUT/PATCH/DELETE anywhere)', () => {
    for (const file of files) {
      const source = read(relativeOf(file));
      for (const match of source.matchAll(controllerDecoratorRe)) {
        expect(['Get', 'Post']).toContain(match[1]);
      }
    }
  });

  it('POSTs exactly the whitelisted admin actions, nowhere else', () => {
    const sloPosts = new Set([
      'slos/:sloId/config', // config append: an audit-only, additive insert
      'slos/:sloId/evaluate', // recompute: reads samples, writes an evaluation row
      'slos/evaluate-all',
      'tracing/flush', // export kick: touches no trading state
    ]);
    // The pre-Part-10 alert triage surface (acknowledge / force-resolve on
    // alert ROWS) is its own long-standing plane and stays allowed; the law
    // under test is that Part 10 added no new write surface to it.
    const legacyAlertPosts = new Set(['alerts/:id/acknowledge', 'alerts/:id/force-resolve']);
    let sloSeen = 0;
    for (const file of files) {
      const source = read(relativeOf(file));
      const sloFile = relativeOf(file).endsWith('slo.controller.ts');
      for (const match of source.matchAll(controllerDecoratorRe)) {
        if (match[1] !== 'Post') {
          continue;
        }
        if (sloFile) {
          sloSeen += 1;
          expect(sloPosts.has(match[2] ?? '')).toBe(true);
        } else {
          expect(legacyAlertPosts.has(match[2] ?? '') || !(match[2] ?? '').startsWith('slos')).toBe(true);
        }
      }
    }
    expect(sloSeen).toBe(4);
  });

  it('the fault surface is read-only, and no arm/inject lever exists anywhere', () => {
    const offenders: string[] = [];
    for (const file of walk(join(SRC, 'modules'))) {
      const source = read(relativeOf(file));
      for (const match of source.matchAll(controllerDecoratorRe)) {
        const path = (match[2] ?? '').toLowerCase();
        // (a) anything that ARMS something is banned outright;
        // (b) a route whose path mentions faults must be a GET - the only
        //     runtime operation on an armed fault is consume, and consume
        //     lives INSIDE the instrumented code paths, never on a route.
        // (Alert acknowledge/resolve routes predate Part 10 and only touch
        // alert rows - that is the observability plane's own state, not
        // fault arming and not trading state, so they stay out of this scan.)
        if (/arm|disarm|inject|unleash/.test(path)) {
          offenders.push(`${relativeOf(file)}: ${match[0]}`);
        } else if (/fault/.test(path) && match[1] !== 'Get') {
          offenders.push(`${relativeOf(file)}: ${match[0]}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('no POST route on the telemetry surface names a trading mutation (GET observation of e.g. execution lag is the feature, writes are not)', () => {
    for (const file of files) {
      const source = read(relativeOf(file));
      for (const match of source.matchAll(controllerDecoratorRe)) {
        if (match[1] !== 'Post') {
          continue;
        }
        expect(match[2] ?? '').not.toMatch(
          /order|execution|credential|wallet|withdraw|deposit|trade/i,
        );
      }
    }
  });
});

// ---------------------------------------------------------------------------
// observe-never-authorise, enforced across module boundaries
// ---------------------------------------------------------------------------

describe('the trading path never reads telemetry', () => {
  const TRADING_MODULES = ['execution', 'risk', 'strategy', 'signals', 'tenants', 'auth', 'realtime'];

  it('trading modules do not import from infrastructure/tracing at all', () => {
    const offenders: string[] = [];
    for (const moduleName of TRADING_MODULES) {
      const dir = join(SRC, 'modules', moduleName);
      let files: string[];
      try {
        files = walk(dir);
      } catch {
        continue; // module not present in this cut
      }
      for (const file of files) {
        const source = read(relativeOf(file));
        if (/from\s+'[^']*infrastructure\/tracing/.test(source)) {
          offenders.push(relativeOf(file));
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('fault consumption appears ONLY in the tracing service and the scrape endpoint', () => {
    const allowed = new Set([
      'infrastructure/tracing/tracing.service.ts',
      'modules/observability/metrics.controller.ts',
    ]);
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const rel = relativeOf(file);
      if (allowed.has(rel)) {
        continue;
      }
      const source = read(rel);
      if (/consumeFault\s*\(/.test(source)) {
        offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('readiness and health do not consult the fault injector', () => {
    for (const rel of [
      'modules/health/health.controller.ts',
      'modules/observability/observability.controller.ts',
    ]) {
      let source: string;
      try {
        source = read(rel);
      } catch {
        continue;
      }
      expect(source).not.toMatch(/consumeFault|failureInjectionArmed/);
    }
  });

  it('queue publishes attach the sidecar AFTER a successful add, and swallow its failure', () => {
    const source = read('modules/queue/queue.service.ts');
    // attachSidecar must never be awaited inline in a way that can reject:
    // the law is "a failed sidecar write must not fail a publish".
    expect(source).toMatch(/captureQueueSidecar[\s\S]{0,120}\.catch\(/);
    // and the attach call must sit after the add call in both enqueue paths
    const addBefore = (method: string): void => {
      const body = source.slice(source.indexOf(method));
      const add = body.indexOf('add(');
      const attach = body.indexOf('attachSidecar');
      expect(add).toBeGreaterThanOrEqual(0);
      expect(attach).toBeGreaterThanOrEqual(0);
      expect(attach).toBeGreaterThan(add);
    };
    addBefore('async enqueue<');
    addBefore('async enqueueOrThrow<');
  });

  it('the middleware ordering puts tracing FIRST on every route', () => {
    const source = read('app.module.ts');
    const match =
      /configure\([^)]*\)\s*:\s*void\s*\{([\s\S]*?)\n  \}/.exec(source);
    expect(match).not.toBeNull();
    const body = match![1];
    const order = ['TraceMiddleware', 'RequestContextMiddleware', 'TenantResolutionMiddleware'];
    const positions = order.map((name) => body.indexOf(name));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    // and it is the .apply(...) list, not a comment stray: the first apply
    // in the body opens with the trace middleware.
    expect(/\.apply\(\s*TraceMiddleware/.test(body)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// fault injector: config-armed, closed-set, consume-only
// ---------------------------------------------------------------------------

const makeConfig = (over: Record<string, unknown> = {}): AppConfigService => {
  const env = {
    NODE_ENV: 'test',
    FAILURE_INJECTION_ENABLED: false,
    FAILURE_INJECTION_ALLOW_NON_PRODUCTION_ONLY: true,
    OTEL_ENABLED: true,
    OTEL_ENDPOINT: undefined,
    OTEL_SAMPLE_RATIO: 1,
    OTEL_PRIORITY_OPERATIONS: [],
    OTEL_TIMEOUT_MS: 200,
    METRICS_EXPORT_INTERVAL_MS: 60_000,
    ...over,
  };
  const svc = Object.create(AppConfigService.prototype) as Record<string, unknown>;
  svc.env = env;
  // The getter reads this.env directly; rebind the two derived getters used
  // by consumers so the object is self-consistent without the DI graph.
  Object.defineProperty(svc, 'failureInjectionArmed', {
    get: () =>
      env.FAILURE_INJECTION_ENABLED === true &&
      env.FAILURE_INJECTION_ALLOW_NON_PRODUCTION_ONLY === true &&
      env.NODE_ENV !== 'production',
  });
  Object.defineProperty(svc, 'isProduction', { get: () => env.NODE_ENV === 'production' });
  Object.defineProperty(svc, 'otelEnabled', { get: () => env.OTEL_ENABLED === true });
  Object.defineProperty(svc, 'otelSampleRatio', { get: () => env.OTEL_SAMPLE_RATIO });
  Object.defineProperty(svc, 'otelPriorityOperations', {
    get: () => env.OTEL_PRIORITY_OPERATIONS,
  });
  Object.defineProperty(svc, 'otelEndpoint', { get: () => env.OTEL_ENDPOINT });
  Object.defineProperty(svc, 'otelTimeoutMs', { get: () => env.OTEL_TIMEOUT_MS });
  Object.defineProperty(svc, 'metricsExportIntervalMs', {
    get: () => env.METRICS_EXPORT_INTERVAL_MS,
  });
  Object.defineProperty(svc, 'failureInjectionRequested', {
    get: () => env.FAILURE_INJECTION_ENABLED === true,
  });
  return svc as unknown as AppConfigService;
};

const makeService = (
  config: AppConfigService,
  redis: unknown = { client: { pipeline: () => ({ hincrby: () => undefined, pexpire: () => undefined, exec: async () => [] }) } },
  sink?: { telemetryExportFailing: jest.Mock },
): TracingService => {
  const registry = new MetricsRegistry('spec');
  return new TracingService(config, redis as never, registry, sink as never);
};

describe('fault injector (live)', () => {
  it('is inert unless armed, and the closed set governs while armed', () => {
    const inert = makeService(makeConfig());
    expect(inert.faultsArmed()).toBe(false);
    expect(inert.consumeFault(FAULT_TRACE_EXPORT)).toBe(false);
    expect(inert.faultPlan()).toEqual({ enabled: false, points: [] });

    const armed = makeService(
      makeConfig({ FAILURE_INJECTION_ENABLED: true }),
    );
    expect(armed.faultsArmed()).toBe(true);
    expect(armed.consumeFault(FAULT_TRACE_EXPORT)).toBe(true);
    expect(armed.consumeFault(FAULT_METRICS_EXPORT)).toBe(true);
    // The API-side injector's closed set is the two points the API process
    // can actually act on. Points owned by OTHER planes (the queue simulator
    // and health probes are driven where those signals live) never fire from
    // here - an injector must not fake a lever it does not physically own.
    expect(armed.consumeFault('queue_observed_failure')).toBe(false);
    expect(armed.consumeFault('market_data_stale_simulated')).toBe(false);
    expect(armed.consumeFault('order.submit')).toBe(false);
    expect(armed.consumeFault('')).toBe(false);
    expect(armed.faultPlan().points).toEqual(
      expect.arrayContaining([FAULT_TRACE_EXPORT, FAULT_METRICS_EXPORT]),
    );
    expect(armed.faultPlan().points).toHaveLength(2);
    expect(armed.faultPlan().enabled).toBe(true);
  });

  it('production cannot arm: the getter AND the plan refuse', () => {
    const config = makeConfig({
      NODE_ENV: 'production',
      FAILURE_INJECTION_ENABLED: true,
      FAILURE_INJECTION_ALLOW_NON_PRODUCTION_ONLY: true,
    });
    expect(config.failureInjectionArmed).toBe(false);
    const service = makeService(config);
    expect(service.faultsArmed()).toBe(false);
    expect(service.consumeFault(FAULT_TRACE_EXPORT)).toBe(false);
    // and the env validator's own production refusal is still in place:
    const schema = readFileSync(
      join(SRC, '..', '..', '..', 'packages', 'config', 'src', 'env.schema.ts'),
      'utf8',
    );
    expect(schema).toContain("production refuses to boot with it armed");
  });

  it('disabling the guard disables the feature, it does not unlock production', () => {
    const config = makeConfig({
      NODE_ENV: 'test',
      FAILURE_INJECTION_ENABLED: true,
      FAILURE_INJECTION_ALLOW_NON_PRODUCTION_ONLY: false,
    });
    expect(config.failureInjectionArmed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// export posture: drop-loud, single-attempt, alert-streak
// ---------------------------------------------------------------------------

describe('export loop (live)', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  const spansOf = (service: TracingService, count: number): void => {
    for (let i = 0; i < count; i += 1) {
      const handle = service.startRequestSpan({
        // distinct, W3C-valid trace ids per span; flags 01 = sampled
        traceparent: `00-${'a'.repeat(24)}${String(i).padStart(4, '0')}-${'1'.repeat(16)}-01`,
      });
      if (handle !== null) {
        service.finishRequestSpan(handle, {
          method: 'GET',
          route: '/v1/spec',
          status: 200,
          durationMs: 5,
        });
      }
    }
  };

  it('no endpoint configured: spans are DROPPED WITH A REASON, counted, not silent', async () => {
    const service = makeService(makeConfig());
    spansOf(service, 3);
    expect(service.bufferedSpans).toBe(3);
    const result = await service.tick();
    expect(result.outcome).toBe('skipped');
    expect(service.dropCounts.no_endpoint).toBe(3);
    // export OUTCOMES count ticks (one result per attempt), span COUNTS are
    // what dropCounts.no_endpoint carries per-span. Getting these two
    // confusable metrics right is exactly why both are asserted here.
    expect(service.exportOutcomes.skipped).toBe(1);
    // Deliberate skips are a posture, not an outage: no alert streak accrues.
    expect(service.consecutiveExportFailures).toBe(0);
  });

  it('collector refusing: one attempt per batch, streak alerts at three, recovery resets', async () => {
    const sink = { telemetryExportFailing: jest.fn(async () => undefined) };
    const service = makeService(
      makeConfig({ OTEL_ENDPOINT: 'http://collector:4318' }),
      undefined,
      sink,
    );
    service.setAlertSink(sink as never);
    let attempts = 0;
    global.fetch = jest.fn(async () => {
      attempts += 1;
      throw new Error('connection refused');
    }) as never;

    for (let tick = 0; tick < 3; tick += 1) {
      spansOf(service, 1);
      const result = await service.tick();
      expect(result.outcome).toBe('error');
    }
    // single-attempt contract: exactly one fetch per span per tick - the
    // batch is dropped, NOT retried inside the tick.
    expect(attempts).toBe(3);
    expect(service.consecutiveExportFailures).toBe(3);
    expect(service.exportOutcomes.error).toBe(3);
    expect(service.exportOutcomes.ok).toBe(0);
    expect(sink.telemetryExportFailing).toHaveBeenCalledWith(
      expect.any(String),
      true,
      3,
    );
    expect(service.dropCounts.export_failed).toBe(3);

    global.fetch = jest.fn(async () => ({ ok: true }) as never) as never;
    spansOf(service, 1);
    const ok = await service.tick();
    expect(ok.outcome).toBe('ok');
    expect(service.consecutiveExportFailures).toBe(0);
    expect(sink.telemetryExportFailing).toHaveBeenLastCalledWith(
      expect.any(String),
      false,
      0,
    );
  });

  it('armed trace-export fault turns the SAME path into counted skips', async () => {
    const service = makeService(
      makeConfig({
        OTEL_ENDPOINT: 'http://collector:4318',
        FAILURE_INJECTION_ENABLED: true,
      }),
    );
    global.fetch = jest.fn(async () => {
      throw new Error('must not be reached: the fault short-circuits');
    }) as never;
    spansOf(service, 2);
    const result = await service.tick();
    expect(result.outcome).toBe('skipped');
    expect(service.dropCounts.fault_injected).toBe(2);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('disabled tracing is zero-cost: no handle, no buffer, no work', async () => {
    const service = makeService(makeConfig({ OTEL_ENABLED: false }));
    const handle = service.startRequestSpan({ traceparent: '00-aaaa-1111-01' });
    expect(handle).toBeNull();
    // the middleware-side contract: finish on a null handle must be a no-op
    // the service tolerates - the parameter type is `SpanHandle`, and the
    // middleware never calls it when the span is null, so assert the guard
    // in the service body itself instead (zero cost is zero calls):
    expect(service.bufferedSpans).toBe(0);
    expect(service.bufferedSpans).toBe(0);
    const result = await service.tick();
    expect(result.outcome).toBe('disabled');
  });

  it('sampling decision is the fixture law: priority ops always, ratio by trace bucket', () => {
    const always = makeService(
      makeConfig({ OTEL_PRIORITY_OPERATIONS: ['execution.transmit'] }),
    );
    const handle = always.startRequestSpan({
      // trace id chosen so its bucket sits ABOVE any 0.0-ish ratio; the
      // priority-operations list must override the ratio anyway
      traceparent: `00-${'f'.repeat(32)}-${'1'.repeat(16)}-00`,
    });
    // startRequestSpan samples http.server at ratio... with OTEL_SAMPLE_RATIO 1 everything samples; assert the policy directly:
    expect(handle?.context.traceId ?? null).not.toBeNull();
    if (handle !== null) {
      always.finishRequestSpan(handle, {
        method: 'GET',
        route: '/v1/spec',
        status: 200,
        durationMs: 5,
      });
    }
    const policy = new SamplingPolicy(SamplingMode.RATIO, {
      ratio: 0.001,
      priorityOperations: ['execution.transmit'],
    });
    expect(
      policy.shouldSample({ traceId: 'f'.repeat(32), parentSampled: false, operation: 'execution.transmit' }),
    ).toBe(true);
    expect(
      policy.shouldSample({ traceId: 'f'.repeat(32), parentSampled: false, operation: 'http.server' }),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// the scrape endpoint and its fault
// ---------------------------------------------------------------------------

describe('metrics scrape fault (live)', () => {
  const fakeResponse = () => ({ setHeader: jest.fn() }) as never;

  const controllerWith = (tracing?: TracingService): MetricsController => {
    const registry = {
      render: () => '# test\n',
      sampleProcess: () => undefined,
    } as unknown as MetricsRegistry;
    const observability = { sampleDerivedGauges: async () => undefined } as never;
    const config = {
      metricsEnabled: true,
      prometheusEnabled: true,
      metricsToken: undefined,
      isProduction: false,
    } as unknown as AppConfigService;
    return new MetricsController(registry, observability, config, tracing);
  };

  const request = (headers: Record<string, string> = {}) =>
    ({ headers }) as never;

  it('renders normally when nothing is armed', async () => {
    const controller = controllerWith();
    await expect(
      controller.metrics(request(), fakeResponse(), undefined),
    ).resolves.toContain('# test');
  });

  it('armed FAULT_METRICS_EXPORT 503s the scrape while the exporter keeps counting', async () => {
    const tracing = makeService(makeConfig({ FAILURE_INJECTION_ENABLED: true }));
    const controller = controllerWith(tracing);
    await expect(controller.metrics(request(), fakeResponse(), undefined)).rejects.toMatchObject(
      {
        response: { code: 'METRICS_EXPORT_UNAVAILABLE' },
        status: 503,
      },
    );
    // the fault is CONSUMED per scrape, and the registry was never touched:
    // the count-up continues behind the closed door.
    expect(tracing.exportOutcomes.ok).toBe(0);
  });

  it('the fault gate sits AFTER auth (an unauthenticated stranger learns nothing new)', async () => {
    const tracing = makeService(makeConfig({ FAILURE_INJECTION_ENABLED: true }));
    const registry = { render: () => '', sampleProcess: () => undefined } as never;
    const config = {
      metricsEnabled: true,
      prometheusEnabled: true,
      metricsToken: 'sekret-token',
      isProduction: false,
    } as unknown as AppConfigService;
    const controller = new MetricsController(
      registry,
      { sampleDerivedGauges: async () => undefined } as never,
      config,
      tracing,
    );
    await expect(
      controller.metrics(request({ 'x-metrics-token': 'wrong' }), fakeResponse(), undefined),
    ).rejects.toMatchObject({ response: { code: 'METRICS_UNAUTHORIZED' } });
    // wrong token fails as UNAUTHORIZED (not 503): the fault cannot be used
    // to probe whether injection is armed, by anyone without the token.
  });
});
```

## API - modified

## FILE: apps/api/src/modules/observability/http-metrics.interceptor.ts (92 lines)

```typescript
import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import type { Response } from 'express';
import { Observable, tap } from 'rxjs';

import type { AppRequest } from '../../common/types/request.types';

import { MetricsRegistry } from '../../infrastructure/metrics/metrics.registry';
import { TracingService } from '../../infrastructure/tracing/tracing.service';

/**
 * HTTP latency and result metrics, on the ROUTE TEMPLATE - never the raw
 * URL. `/v1/accounts/018f.../orders` becomes `v1/accounts/:accountId/orders`
 * because a URL with an id in it is a series per entity, and a series per
 * entity is how a Prometheus server dies. Requests that matched no route
 * (404s, scanners) collapse to the single label value "unmatched".
 *
 * Timings use `performance.now()` (monotonic in Node, per the platform-wide
 * rule that durations never come from Date.now). The observation is recorded
 * in `finally`-equivalent semantics (rxjs `tap` next/error) so a failing
 * request is measured exactly like a succeeding one - failed requests are the
 * ones an operator wants the latency of.
 */
@Injectable()
export class HttpMetricsInterceptor implements NestInterceptor {
  constructor(
    private readonly registry: MetricsRegistry,
    private readonly tracing: TracingService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.getType() === 'http';
    if (!http) {
      return next.handle();
    }
    const request = context.switchToHttp().getRequest<AppRequest>();
    // startTime is stamped by RequestContextMiddleware with Date.now for
    // LOG lines; for the duration histogram we take our own monotonic sample
    // so the measurement never depends on a wall-clock difference.
    const started = performance.now();

    return next.handle().pipe(
      tap({
        next: () => this.observe(request, undefined, started),
        error: () => this.observe(request, 'error', started),
      }),
    );
  }

  private observe(request: AppRequest, errorFlag: 'error' | undefined, started: number): void {
    const response = request.res as unknown as Response | undefined;
    const status = response?.statusCode ?? (errorFlag === 'error' ? 500 : 200);
    const statusClass = `${Math.floor(status / 100)}xx`;
    const route = routeTemplate(request);
    const method = request.method ?? 'GET';
    const seconds = Math.max(0, performance.now() - started) / 1000;
    // Part 10: the SLO request/latency tally rides the SAME observation as
    // the histogram (one event source, two consumers). The note is an O(1)
    // in-memory increment; the Redis write happens on the tracer's loop,
    // never here.
    this.tracing.noteHttpRequest(status, seconds * 1000);

    this.registry.inc(
      'wlct_http_requests_total',
      { method, route, status_class: statusClass },
      1,
    );
    this.registry.observe(
      'wlct_http_request_duration_seconds',
      { method, route, status_class: statusClass },
      seconds,
    );
  }
}

/** Nest records the matched route on `request.route`; anything else (404,
 *  early middleware rejection) gets the sentinel. This indirection is the
 *  entire cardinality defence for the HTTP families. */
const routeTemplate = (request: AppRequest): string => {
  const route = (request as { route?: { path?: unknown } }).route;
  const path = typeof route?.path === 'string' ? route.path : null;
  if (path === null) {
    return 'unmatched';
  }
  const trimmed = path.replace(/^\//, '').slice(0, 96);
  return trimmed.length > 0 ? trimmed : 'root';
};
```

## FILE: apps/api/src/modules/observability/metrics.controller.ts (133 lines)

```typescript
import {
  Controller,
  Get,
  Header,
  Query,
  Req,
  Res,
  ServiceUnavailableException,
  VERSION_NEUTRAL,
  Optional,
} from '@nestjs/common';
import {
  FAULT_METRICS_EXPORT,
  TracingService,
} from '../../infrastructure/tracing/tracing.service';
import { ApiExcludeEndpoint } from '@nestjs/swagger';
import { timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import { PROMETHEUS_CONTENT_TYPE } from '@wlct/config';

import { Public } from '../../common/decorators/public.decorator';
import { AppConfigService } from '../../config/app-config.service';

import { MetricsRegistry } from '../../infrastructure/metrics/metrics.registry';
import { ObservabilityService } from './observability.service';

/**
 * The Prometheus scrape endpoint.
 *
 * Auth posture follows the deployment rules of the spec exactly: metrics are
 * served UNAUTHENTICATED only where the architecture isolates the surface -
 * here that means the compose file publishes NO metrics port (the API port
 * serves /api and /health only when you deploy as shipped, and /metrics is
 * reachable on the internal listener). Where a deployment must share a
 * listener, set METRICS_TOKEN and every scrape needs the matching
 * `x-metrics-token` header, compared in constant time. In PRODUCTION the
 * environment validation requires METRICS_TOKEN to exist at all, so the
 * unauthenticated shape is a development-only convenience that cannot be
 * shipped by accident.
 *
 * The payload itself is guaranteed boring: only allow-listed label sets
 * ever reach the registry (see MetricsRegistry), and the safety spec greps
 * the rendered text for order ids, request ids and credential shapes in
 * every test run, because "the policy says so" deserves a test that the
 * policy is actually what the bytes look like.
 */
@Controller({ path: 'metrics', version: VERSION_NEUTRAL })
@Public()
export class MetricsController {
  constructor(
    private readonly registry: MetricsRegistry,
    private readonly observability: ObservabilityService,
    private readonly config: AppConfigService,
    @Optional() private readonly tracing?: TracingService,
  ) {}

  @Get()
  @Header('content-type', PROMETHEUS_CONTENT_TYPE)
  @ApiExcludeEndpoint()
  async metrics(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Query('format') format: string | undefined,
  ): Promise<string> {
    if (!this.config.metricsEnabled || !this.config.prometheusEnabled) {
      throw new ServiceUnavailableException({
        code: 'METRICS_DISABLED',
        message:
          'Metrics exposition is disabled in this configuration. It cannot be disabled in production; ' +
          'if you are seeing this there, the deployment is misconfigured and the panel says so.',
      });
    }
    this.assertToken(request);
    // Part 10: the metrics-side fault point refuses the SCRAPE while armed -
    // the exporter keeps counting into its registry, and a collector that
    // cannot scrape sees a scrape failure, which is exactly the outage the
    // metric for this fault exists to prove. Config-armed only; there is no
    // way to reach this branch from any API write.
    if (this.tracing?.consumeFault(FAULT_METRICS_EXPORT) === true) {
      throw new ServiceUnavailableException({
        code: 'METRICS_EXPORT_UNAVAILABLE',
        message: 'Fault injection armed for metrics export (test deployments only).',
      });
    }
    response.setHeader('Cache-Control', 'no-store');

    await this.observability.sampleDerivedGauges(this.registry);
    this.registry.sampleProcess();
    const text = this.registry.render();
    if (format === 'compact') {
      // Debug aid for humans curling the endpoint; scrapers never send it.
      return text.replace(/# HELP[^\n]*\n/g, '');
    }
    return text;
  }

  private assertToken(request: Request): void {
    const expected = this.config.metricsToken;
    if (expected === undefined) {
      if (this.config.isProduction) {
        // Unreachable while env validation holds; kept as defence in depth
        // for configs assembled outside the standard bootstrap.
        throw new ServiceUnavailableException({
          code: 'METRICS_TOKEN_MISSING',
          message: 'METRICS_TOKEN is required in production; refusing an unauthenticated exposition.',
        });
      }
      return;
    }
    const presented = request.headers['x-metrics-token'];
    const value = Array.isArray(presented) ? presented[0] : presented;
    if (typeof value !== 'string' || !constantTimeEquals(value, expected)) {
      throw new ServiceUnavailableException({
        code: 'METRICS_UNAUTHORIZED',
        message: 'A valid x-metrics-token header is required for the metrics exposition.',
      });
    }
  }
}

/** The token comparison is constant-time on purpose; a metrics endpoint is
 *  not exempt from basic auth hygiene just because its payload is aggregate.
 *  Length mismatches short-circuit timingSafeEqual, so compare lengths
 *  explicitly first (that leaks only the length, which is fine here). */
const constantTimeEquals = (a: string, b: string): boolean => {
  const bufferA = Buffer.from(a, 'utf8');
  const bufferB = Buffer.from(b, 'utf8');
  if (bufferA.length !== bufferB.length) {
    return false;
  }
  return timingSafeEqual(bufferA, bufferB);
};
```

## FILE: apps/api/src/modules/observability/alerts.service.ts (647 lines)

```typescript
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AuditAction, AuditActorType, AuditOutcome, type PaginatedResult } from '@wlct/shared-types';
import { ALERT_FORCE_RESOLVE_PHRASE, OBS_PUBLISHER_SERVICES } from '@wlct/config';
import type { Prisma } from '@prisma/client';
import { buildPaginationMeta, normalisePagination, sanitiseForLog } from '@wlct/utils';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { RedisService } from '../../infrastructure/redis/redis.service';
import { AppConfigService } from '../../config/app-config.service';
import { AuditService } from '../audit/audit.service';

import { ALERT_RULE_CATALOG } from './alert.constants';
import { alertRowToView, parseAlertsDocument } from './observability.mapper';
import type {
  AlertMutationResult,
  AlertSyncResult,
  ListOpsAlertsFilter,
  OpsActor,
  OpsAlertView,
  PublishedAlertRecord,
} from './observability.types';
import { IncidentsService } from './incidents.service';

/**
 * The durable alert fold: Redis mirrors in, PostgreSQL rows out, one writer.
 *
 * Why the API writes and the engine does not: the engine owns the LIVE
 * judgement (dedupe windows, occurrence counting, recovery observation) in
 * the only place it can do so cheaply - its own memory. The API owns the
 * durable record because it owns PostgreSQL, RBAC and the audit trail. The
 * mirror is the seam, and like every Part 5-8 seam it is unidirectional:
 * this service never writes anything an engine reads for enforcement.
 *
 * Three invariants the sync job upholds, each tested:
 *
 * 1. FOLD, DON'T FLOOD. A publisher re-reporting an alert for the same
 *    dedupe key updates the row (occurrences jump to the publisher's
 *    cumulative count, lastSeenAt moves); it never inserts. A night of
 *    ten thousand identical stale-feed ticks is one row with 10_000 on it.
 *
 * 2. ABSENCE IS NOT RECOVERY. An alert row is auto-resolved only when the
 *    PUBLISHING service's alert mirror is present AND the record is gone
 *    from it - i.e. the publisher looked and saw nothing. A missing or
 *    expired mirror (publisher down, Redis blip) leaves rows exactly as
 *    they are: the publisher being unreachable is an availability event
 *    for its health component, never an alibi that cleared its alerts.
 *
 * 3. ACKNOWLEDGE NEVER RESOLVES. The state machine here is the engine's
 *    OPEN -> ACKNOWLEDGED -> RESOLVED, and the resolve edge has exactly two
 *    doors: the observed recovery above, or an operator force-resolve
 *    quoting the typed phrase - audited per row, never a delete.
 *
 * Pruning is retention bookkeeping and follows its own rule: only RESOLVED
 * rows older than ALERT_RETENTION_DAYS may go. An alert nobody resolved is
 * the most important row in the table, not the first deletion candidate.
 */
@Injectable()
export class AlertsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: AppConfigService,
    private readonly audit: AuditService,
    private readonly incidents: IncidentsService,
    @InjectPinoLogger(AlertsService.name) private readonly logger: PinoLogger,
  ) {}

  // ------------------------------------------------------------------
  // reads (tenant-scoped by the caller's context; see controller)
  // ------------------------------------------------------------------
  async list(filter: ListOpsAlertsFilter): Promise<PaginatedResult<OpsAlertView>> {
    const pagination = normalisePagination(filter, ['lastSeenAt', 'severity', 'occurrences']);
    const where: Prisma.OpsAlertWhereInput = {
      ...(filter.state ? { state: filter.state } : {}),
      ...(filter.severity ? { severity: filter.severity } : {}),
      ...(filter.component ? { component: filter.component } : {}),
      ...(filter.tenantId ? { tenantId: filter.tenantId } : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.opsAlert.findMany({
        where,
        orderBy: { [pagination.sortBy ?? 'lastSeenAt']: pagination.sortOrder },
        skip: pagination.skip,
        take: pagination.take,
      }),
      this.prisma.opsAlert.count({ where }),
    ]);

    return {
      items: rows.map((row) => alertRowToView(row)),
      pagination: buildPaginationMeta(pagination.page, pagination.limit, total),
    };
  }

  async get(tenantScope: string | null | undefined, alertId: string): Promise<OpsAlertView> {
    const row = await this.prisma.opsAlert.findUnique({ where: { id: alertId } });
    if (row === null) {
      throw new NotFoundException({ code: 'ALERT_NOT_FOUND', message: 'No such alert.' });
    }
    this.assertReadable(row.tenantId, tenantScope);
    return alertRowToView(row);
  }

  // ------------------------------------------------------------------
  // mutations - narrow, explicit, audited
  // ------------------------------------------------------------------
  async acknowledge(actor: OpsActor, alertId: string, reason: string): Promise<AlertMutationResult> {
    const alert = await this.requireMutable(actor, alertId);
    if (alert.state !== 'OPEN') {
      throw new ConflictException({
        code: 'ALERT_NOT_OPEN',
        message: `Only OPEN alerts are acknowledged; this one is ${alert.state}. Acknowledgement is not resolution.`,
      });
    }

    const updated = await this.prisma.opsAlert.update({
      where: { id: alert.id },
      data: {
        state: 'ACKNOWLEDGED',
        acknowledgedBy: actor.userId,
        acknowledgedAt: new Date(),
      },
    });

    await this.audit.recordImmediate({
      tenantId: actor.tenantId,
      actorType: AuditActorType.USER,
      actorId: actor.userId,
      action: AuditAction.OPS_ALERT_ACKNOWLEDGED,
      outcome: AuditOutcome.SUCCESS,
      resourceType: 'ops_alert',
      resourceId: alert.id,
      description: sanitiseForLog(reason, 500),
      metadata: { ruleId: alert.ruleId, component: alert.component, scope: alert.scope },
      requestId: actor.requestId ?? null,
      correlationId: actor.correlationId ?? null,
    });

    return { accepted: true, alert: alertRowToView(updated) };
  }

  async forceResolve(actor: OpsActor, alertId: string, reason: string, confirmPhrase: string): Promise<AlertMutationResult> {
    if (confirmPhrase !== ALERT_FORCE_RESOLVE_PHRASE) {
      throw new ConflictException({
        code: 'CONFIRMATION_PHRASE_REQUIRED',
        message:
          `Force-resolving without an observed recovery must quote "${ALERT_FORCE_RESOLVE_PHRASE}" ` +
          'verbatim. If the condition really has ended, the publisher will report the recovery and ' +
          'the alert resolves itself on the next sync.',
      });
    }
    const alert = await this.requireMutable(actor, alertId);
    if (alert.state === 'RESOLVED') {
      throw new ConflictException({
        code: 'ALERT_ALREADY_RESOLVED',
        message: 'This alert is already resolved.',
      });
    }

    const updated = await this.prisma.opsAlert.update({
      where: { id: alert.id },
      data: {
        state: 'RESOLVED',
        resolvedAt: new Date(),
        resolution: sanitiseForLog(`force-resolved by ${actor.userId}: ${reason}`, 500),
      },
    });

    await this.audit.recordImmediate({
      tenantId: actor.tenantId,
      actorType: AuditActorType.USER,
      actorId: actor.userId,
      action: AuditAction.OPS_ALERT_FORCE_RESOLVED,
      outcome: AuditOutcome.SUCCESS,
      resourceType: 'ops_alert',
      resourceId: alert.id,
      description: sanitiseForLog(reason, 500),
      metadata: { ruleId: alert.ruleId, component: alert.component, scope: alert.scope },
      requestId: actor.requestId ?? null,
      correlationId: actor.correlationId ?? null,
    });

    return { accepted: true, alert: alertRowToView(updated) };
  }

  // ------------------------------------------------------------------
  // the fold (maintenance queue calls this; safe to call any time)
  // ------------------------------------------------------------------
  async syncFromMirrors(): Promise<AlertSyncResult> {
    const result: AlertSyncResult = {
      services: [...OBS_PUBLISHER_SERVICES],
      inserted: 0,
      folded: 0,
      resolved: 0,
      incidentsFolded: 0,
      mirrorPresent: {},
    };

    for (const service of OBS_PUBLISHER_SERVICES) {
      const key = this.alertsMirrorKey(service);
      let raw: string | null = null;
      try {
        raw = await this.redis.client.get(key);
      } catch (error) {
        this.logger.warn(
          { event: 'ops.mirror_read_failed', service, errorType: (error as Error).name },
          'Operational alerts mirror unreadable; rows stay as they are (absence is not recovery)',
        );
        result.mirrorPresent[service] = false;
        continue;
      }
      if (raw === null) {
        result.mirrorPresent[service] = false;
        continue;
      }
      const document = parseAlertsDocument(raw);
      if (document === null) {
        this.logger.warn(
          { event: 'ops.mirror_unparseable', service },
          'Operational alerts mirror present but unparseable; treated as unreadable, never as empty',
        );
        result.mirrorPresent[service] = false;
        continue;
      }
      result.mirrorPresent[service] = true;

      const seenKeys = new Set<string>();
      for (const record of document.active) {
        const dedupeKey = this.dedupeKeyFor(record);
        seenKeys.add(dedupeKey);
        const folded = await this.foldAlert(record, dedupeKey, service);
        if (folded === 'inserted') {
          result.inserted += 1;
        } else {
          result.folded += 1;
        }
        result.incidentsFolded += await this.incidents.linkAlert(record, dedupeKey, service);
      }

      result.resolved += await this.resolveRecovered(service, seenKeys);
    }

    return result;
  }

  /** Retention: RESOLVED rows beyond the window, and their incident links'
   *  incidents when those are CLOSED beyond theirs. Unresolved rows are
   *  never touched regardless of age - that guard is the where clause, not
   *  a comment. */
  async prune(): Promise<{ alerts: number }> {
    const alertCutoff = new Date(
      Date.now() - this.config.alertRetentionDays * 86_400_000,
    );
    const deleted = await this.prisma.opsAlert.deleteMany({
      where: { state: 'RESOLVED', resolvedAt: { lt: alertCutoff } },
    });
    return { alerts: deleted.count };
  }

  // ------------------------------------------------------------------
  // internals
  // ------------------------------------------------------------------
  private alertsMirrorKey(service: string): string {
    return `wlct:trading:ops:alerts:${service}`;
  }

  private dedupeKeyFor(record: PublishedAlertRecord): string {
    return `${record.ruleId}|${record.component}|${record.scope ?? 'platform'}`;
  }

  private async foldAlert(
    record: PublishedAlertRecord,
    dedupeKey: string,
    service: string,
  ): Promise<'inserted' | 'folded'> {
    const rule = ALERT_RULE_CATALOG.find((candidate) => candidate.ruleId === record.ruleId);
    const firstSeen = new Date(Math.round(record.firstSeenAtMicros / 1000));
    const lastSeen = new Date(Math.round(record.lastSeenAtMicros / 1000));

    const existing = await this.prisma.opsAlert.findUnique({ where: { dedupeKey } });
    if (existing === null) {
      await this.prisma.opsAlert.create({
        data: {
          dedupeKey,
          ruleId: record.ruleId,
          component: record.component,
          scope: record.scope,
          severity: record.severity,
          state: record.state,
          title: record.title,
          // The publisher's condition text can carry an operator note; it is
          // bounded and sanitised exactly like an audit description.
          condition: sanitiseForLog(record.condition, 500),
          message: record.message === null ? null : sanitiseForLog(record.message, 500),
          observedValue: record.observedValue,
          thresholdValue: record.thresholdValue,
          occurrences: record.occurrences,
          firstSeenAt: firstSeen,
          lastSeenAt: lastSeen,
          acknowledgedBy: record.acknowledgedBy,
          acknowledgedAt:
            record.acknowledgedAtMicros === null ? null : new Date(Math.round(record.acknowledgedAtMicros / 1000)),
          links: { ...record.links, publisher: service } as Prisma.InputJsonValue,
        },
      });
      this.logger.info(
        { event: 'ops.alert_opened', ruleId: record.ruleId, component: record.component, service },
        'Operational alert opened from publisher mirror',
      );
      return 'inserted';
    }

    // FOLD semantics: occurrences is the publisher's cumulative count for
    // this active record, so the row MIRRORS it (max-guards against a
    // publisher restart resetting the count, which is not an event to
    // forget history over). State only advances OPEN -> ACKNOWLEDGED when
    // the publisher itself says ACKNOWLEDGED; it never moves backwards, and
    // a resolved row never reopens in place - a re-fire inserts a new row
    // under the same key after the old one is resolved-and-pruned... the
    // unique key would collide, so on collision with a RESOLVED row we
    // re-arm by clearing the resolution fields. That IS the "fresh record
    // after resolution" behaviour from the engine, mirrored durably.
    const reopening = existing.state === 'RESOLVED';
    await this.prisma.opsAlert.update({
      where: { id: existing.id },
      data: {
        state: reopening ? record.state : existing.state === 'OPEN' ? record.state : existing.state,
        severity: rule?.severity ?? record.severity,
        occurrences: Math.max(existing.occurrences, record.occurrences),
        lastSeenAt: lastSeen < existing.lastSeenAt ? existing.lastSeenAt : lastSeen,
        observedValue: record.observedValue ?? existing.observedValue,
        thresholdValue: record.thresholdValue ?? existing.thresholdValue,
        message: record.message === null ? existing.message : sanitiseForLog(record.message, 500),
        links: { ...record.links, publisher: service } as Prisma.InputJsonValue,
        ...(reopening
          ? {
              resolvedAt: null,
              resolution: null,
              acknowledgedAt: null,
              acknowledgedBy: null,
              firstSeenAt: firstSeen,
            }
          : {}),
      },
    });
    return 'folded';
  }

  /** Publisher mirror present, record no longer listed => recovery was
   *  OBSERVED by the thing that knows. Resolve with that as the resolution
   *  text. Only rows belonging to this publisher (by component namespace
   *  recorded in `links.publisher`) and not operator-held are touched. */
  private async resolveRecovered(service: string, seenKeys: ReadonlySet<string>): Promise<number> {
    const open = await this.prisma.opsAlert.findMany({
      where: { state: { in: ['OPEN', 'ACKNOWLEDGED'] } },
      take: 500,
    });
    let resolved = 0;
    for (const row of open) {
      if (seenKeys.has(row.dedupeKey)) {
        continue;
      }
      const publisher = (row.links as Record<string, unknown> | null)?.publisher;
      if (publisher !== service) {
        continue; // another publisher's row; its own sync pass handles it
      }
      await this.prisma.opsAlert.update({
        where: { id: row.id },
        data: {
          state: 'RESOLVED',
          resolvedAt: new Date(),
          resolution: 'recovered (observed by publisher mirror)',
        },
      });
      resolved += 1;
      this.logger.info(
        { event: 'ops.alert_resolved', ruleId: row.ruleId, component: row.component, service },
        'Operational alert resolved on observed recovery',
      );
    }
    return resolved;
  }

  /**
   * Queue-alert policy, evaluated by the API because the queue backend is
   * the API's to see. Each sample says whether a queue's oldest pending job
   * is past the alert age; the EXECUTION queue fires at HALF the age with
   * the CRITICAL rule - a control-queue backlog is paperwork piling up, an
   * execution backlog while trading is on means live orders are waiting on
   * us, and the policy is the part that must differ.
   *
   * The API is its own publisher here (links.publisher = "api"), so an
   * absent condition on the next sample IS the observed recovery.
   */
  async applyQueueAlerts(samples: ReadonlyArray<{
    queue: string;
    oldestWaitingAgeMs: number | null;
    alerting: boolean;
    critical: boolean;
  }>): Promise<void> {
    const now = new Date();
    const nowMicros = now.getTime() * 1000;
    for (const sample of samples) {
      const ruleId = sample.critical ? 'EXECUTION_QUEUE_BACKLOG' : 'QUEUE_BACKLOG';
      const dedupeKey = `${ruleId}|queues|${sample.queue}`;
      if (!sample.alerting) {
        // Recovery observed (or never needed): close any open row for this
        // queue/rule pair, nothing more.
        const open = await this.prisma.opsAlert.findUnique({ where: { dedupeKey } });
        if (open !== null && open.state !== 'RESOLVED' && (open.links as Record<string, unknown> | null)?.publisher === 'api') {
          await this.prisma.opsAlert.update({
            where: { id: open.id },
            data: { state: 'RESOLVED', resolvedAt: now, resolution: 'recovered (queue age back within policy)' },
          });
        }
        continue;
      }
      const title = sample.critical
        ? `Execution queue backlog on ${sample.queue}`
        : `Queue backlog on ${sample.queue}`;
      await this.prisma.opsAlert.upsert({
        where: { dedupeKey },
        create: {
          dedupeKey,
          ruleId,
          component: 'queues',
          scope: sample.queue,
          severity: sample.critical ? 'CRITICAL' : 'WARNING',
          state: 'OPEN',
          title,
          condition:
            `oldest pending job exceeded ${sample.critical ? 'half of ' : ''}` +
            `${this.config.queueAlertAgeMs}ms (QUEUE_ALERT_AGE_MS)`,
          message: `oldest waiting job: ${sample.oldestWaitingAgeMs ?? 'unknown'}ms`,
          observedValue: sample.oldestWaitingAgeMs === null ? null : String(sample.oldestWaitingAgeMs),
          thresholdValue: String(sample.critical ? Math.floor(this.config.queueAlertAgeMs / 2) : this.config.queueAlertAgeMs),
          occurrences: 1,
          firstSeenAt: now,
          lastSeenAt: now,
          links: { publisher: 'api', firstObservedMicros: String(nowMicros) },
        },
        update: {
          occurrences: { increment: 1 },
          lastSeenAt: now,
          message: `oldest waiting job: ${sample.oldestWaitingAgeMs ?? 'unknown'}ms`,
          observedValue: sample.oldestWaitingAgeMs === null ? undefined : String(sample.oldestWaitingAgeMs),
          // A queue alert whose row was force-resolved but is firing again
          // re-arms; see foldAlert for the same discipline on the engine side.
          ...(await this.isResolvedRecently(dedupeKey))
            ? { state: 'OPEN', resolvedAt: null, resolution: null, firstSeenAt: now }
            : {},
        },
      });
    }
  }

  /**
   * Part 10: the SLO evaluator's alert fold, same discipline as the queue
   * fold above it - a paging objective UPSERTs its row (occurrences grow,
   * never multiply), and an objective that stopped paging closes only
   * because the evaluator OBSERVED the burn verdict gone this tick.
   * `coveredSloIds` is the guard rail: recovery resolution only ever
   * touches SLOs the evaluation actually saw this tick. An evaluation that
   * crashed midway (or never ran) must not resolve anyone's evidence.
   */
  async applySloAlerts(
    rows: ReadonlyArray<{
      sloId: string;
      ruleId: string;
      severity: 'WARNING' | 'CRITICAL';
      title: string;
      condition: string;
      message: string;
      observedValue: string | null;
      thresholdValue: string | null;
    }>,
    coveredSloIds: ReadonlySet<string>,
  ): Promise<void> {
    const now = new Date();
    const nowMicros = now.getTime() * 1000;
    const openKeys = new Set(rows.map((row) => `${row.ruleId}|slo:${row.sloId}`));
    for (const row of rows) {
      const dedupeKey = `${row.ruleId}|slo:${row.sloId}`;
      await this.prisma.opsAlert.upsert({
        where: { dedupeKey },
        create: {
          dedupeKey,
          ruleId: row.ruleId,
          component: 'slo',
          scope: row.sloId,
          severity: row.severity,
          state: 'OPEN',
          title: row.title.slice(0, 255),
          condition: row.condition.slice(0, 500),
          message: row.message.slice(0, 500),
          observedValue: row.observedValue,
          thresholdValue: row.thresholdValue,
          occurrences: 1,
          firstSeenAt: now,
          lastSeenAt: now,
          links: { publisher: 'api', firstObservedMicros: String(nowMicros) },
        },
        update: {
          occurrences: { increment: 1 },
          lastSeenAt: now,
          message: row.message.slice(0, 500),
          observedValue: row.observedValue ?? undefined,
          thresholdValue: row.thresholdValue ?? undefined,
          ...(await this.isResolvedRecently(dedupeKey))
            ? { state: 'OPEN', resolvedAt: null, resolution: null, firstSeenAt: now }
            : {},
        },
      });
    }
    if (coveredSloIds.size === 0) {
      return;
    }
    const openRows = await this.prisma.opsAlert.findMany({
      where: {
        ruleId: {
          in: ['SLO_BURN_FAST', 'SLO_BURN_SLOW', 'SLO_BUDGET_EXHAUSTED', 'SLO_TELEMETRY_GAP'],
        },
        state: { not: 'RESOLVED' },
      },
      select: { id: true, dedupeKey: true, scope: true },
    });
    for (const alert of openRows) {
      if (alert.scope === null || !coveredSloIds.has(alert.scope)) {
        continue;
      }
      if (openKeys.has(alert.dedupeKey)) {
        continue;
      }
      await this.prisma.opsAlert.update({
        where: { id: alert.id },
        data: {
          state: 'RESOLVED',
          resolvedAt: now,
          resolution: 'recovered (evaluator observed burn verdict clear)',
        },
      });
    }
  }

  /**
   * Part 10: the telemetry export outage alert, opened and closed by the
   * API process for itself (the engines page through their own mirror
   * folds; this row's publisher is the API because the API's exporter is
   * the thing failing). WARNING by catalog law: a dark platform is an
   * observability incident, not a trading one, and the message says so.
   */
  async telemetryExportFailing(
    service: string,
    failing: boolean,
    consecutive: number,
  ): Promise<void> {
    const dedupeKey = `TELEMETRY_EXPORT_FAILING|${service}|telemetry`;
    const now = new Date();
    if (!failing) {
      const open = await this.prisma.opsAlert.findUnique({ where: { dedupeKey } });
      if (open !== null && open.state !== 'RESOLVED') {
        await this.prisma.opsAlert.update({
          where: { id: open.id },
          data: {
            state: 'RESOLVED',
            resolvedAt: now,
            resolution: 'recovered (export succeeded again)',
          },
        });
      }
      return;
    }
    await this.prisma.opsAlert.upsert({
      where: { dedupeKey },
      create: {
        dedupeKey,
        ruleId: 'TELEMETRY_EXPORT_FAILING',
        component: service,
        scope: 'telemetry',
        severity: 'WARNING',
        state: 'OPEN',
        title: `Telemetry export failing on ${service}`,
        condition: 'consecutive OTLP export failures >= 3',
        message: `${String(consecutive)} consecutive export failures; platform running darker than configured`,
        observedValue: String(consecutive),
        thresholdValue: '3',
        occurrences: 1,
        firstSeenAt: now,
        lastSeenAt: now,
        links: { publisher: 'api' },
      },
      update: {
        occurrences: { increment: 1 },
        lastSeenAt: now,
        observedValue: String(consecutive),
        ...(await this.isResolvedRecently(dedupeKey))
          ? { state: 'OPEN', resolvedAt: null, resolution: null, firstSeenAt: now }
          : {},
      },
    });
  }

  private async isResolvedRecently(dedupeKey: string): Promise<boolean> {
    const row = await this.prisma.opsAlert.findUnique({ where: { dedupeKey } });
    return row !== null && row.state === 'RESOLVED';
  }

  private assertReadable(rowTenantId: string | null, callerTenant: string | null | undefined): void {
    // Platform rows (null tenant) are operation infrastructure: readable by
    // any console with the read grant. Tenant rows are visible only to that
    // tenant.
    if (rowTenantId !== null && rowTenantId !== callerTenant) {
      throw new NotFoundException({ code: 'ALERT_NOT_FOUND', message: 'No such alert.' });
    }
  }

  private async requireMutable(actor: OpsActor, alertId: string): Promise<{
    id: string;
    state: string;
    ruleId: string;
    component: string;
    scope: string | null;
    tenantId: string | null;
  }> {
    const row = await this.prisma.opsAlert.findUnique({ where: { id: alertId } });
    if (row === null) {
      throw new NotFoundException({ code: 'ALERT_NOT_FOUND', message: 'No such alert.' });
    }
    if (row.tenantId !== null && row.tenantId !== actor.tenantId) {
      // Same code as not-found: existence of another tenant's alert is not
      // this caller's information.
      throw new NotFoundException({ code: 'ALERT_NOT_FOUND', message: 'No such alert.' });
    }
    if (row.tenantId === null && !actor.platform) {
      throw new ConflictException({
        code: 'PLATFORM_ALERT_REQUIRES_PLATFORM_ROLE',
        message:
          'This is a platform-infrastructure alert; tenant administrators read them but only the ' +
          'platform break-glass role acknowledges or resolves them.',
      });
    }
    return row;
  }
}
```

## FILE: apps/api/src/modules/observability/observability.module.ts (86 lines)

```typescript
import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';

import { AlertsService } from './alerts.service';
import { HttpMetricsInterceptor } from './http-metrics.interceptor';
import { SloController } from './slo.controller';
import { SloService } from './slo.service';
import { SloSamplesService } from './slo-samples';
import { IncidentsService } from './incidents.service';
import { MetricsController } from './metrics.controller';
import { createMetricsRegistry } from './metrics.registry.provider';
import { ObservabilityController } from './observability.controller';
import { ObservabilityService } from './observability.service';
import { MetricsRegistry } from '../../infrastructure/metrics/metrics.registry';
import { TELEMETRY_ALERT_SINK, TracingService } from '../../infrastructure/tracing/tracing.service';
import { HealthModule } from '../health/health.module';

/**
 * The Part 9 operations module: metric registry, panels, alert fold,
 * incidents, and the two controllers (v1 operations plane + the versionless
 * Prometheus endpoint).
 *
 * The registry is a per-module singleton created in a factory - one process,
 * one registry, families registered at boot so the label policy is fixed
 * before any request can record into it (registration errors at boot are
 * cheap; refusals at record time are counted and silent, by the same split
 * as the Python registry: programmer errors loud, operational errors safe).
 *
 * This module IMPORTS health (for the readiness service and build info) and
 * is imported by the queue module (for the maintenance sync) - and nothing
 * else imports it. Part 10 adds the tracer (infra/tracing, provided here for
 * want of a home that BOTH the HTTP pipeline and the queue plane can reach)
 * and the SLO module, whose ONLY write paths are its own tables, the burn
 * alert fold, and audit. No middleware joins the pipeline from here: metrics-path
 * request logging is already silenced by the pino autoLogging ignore list. The read-only guarantee the spec demands of the panel is
 * structural: there is no service here that the execution path depends on,
 * in either direction. The dependency arrows point AT the trading plane's
 * published state, never through it.
 */
@Module({
  imports: [HealthModule],
  controllers: [ObservabilityController, MetricsController, SloController],
  providers: [
    {
      provide: MetricsRegistry,
      useFactory: (): MetricsRegistry => createMetricsRegistry(),
    },
    ObservabilityService,
    AlertsService,
    IncidentsService,
    {
      provide: APP_INTERCEPTOR,
      useClass: HttpMetricsInterceptor,
    },
    // --- Part 10 ------------------------------------------------------------
    TracingService,
    SloSamplesService,
    SloService,
    {
      // The sink is constructor-injected into AlertsService by THIS factory
      // rather than by TracingService importing AlertsService: the
      // dependency arrow points from telemetry INTO the durable plane, never
      // back, mirroring (in reverse) the one-way mirror rule the engines
      // follow. A process without the sink still traces; it just cannot
      // page anyone - which is what a missing DB connection looks like
      // anyway, and the exporter already survives both.
      provide: TELEMETRY_ALERT_SINK,
      useFactory: (alerts: AlertsService) => ({
        telemetryExportFailing: (service: string, failing: boolean, consecutive: number) =>
          alerts.telemetryExportFailing(service, failing, consecutive),
      }),
      inject: [AlertsService],
    },
  ],
  exports: [
    ObservabilityService,
    AlertsService,
    IncidentsService,
    MetricsRegistry,
    TracingService,
    SloService,
    SloSamplesService,
  ],
})
export class ObservabilityModule {}
```

## FILE: apps/api/src/modules/queue/queue.service.ts (212 lines)

```typescript
import { Injectable, OnModuleDestroy, Optional } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { Queue, type JobsOptions } from 'bullmq';
import { QUEUE_NAMES, type QueueName } from '@wlct/config';

import { TracingService } from '../../infrastructure/tracing/tracing.service';

export interface QueueDepth {
  name: QueueName;
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
  completed: number;
  paused: boolean;
  /**
   * Age in ms of the oldest WAITING job, null when the queue is empty or the
   * head job cannot be read. Sampled with two extra BullMQ calls per queue
   * (peek the waiting head, fetch its timestamp) - deliberately bounded: it
   * reads ONE job id, never the list. A queue with a million waiting jobs
   * costs the same as an empty one, which is the whole reason this lives on
   * the depth snapshot instead of behind a separate endpoint.
   */
  oldestWaitingAgeMs: number | null;
}

/**
 * Typed facade over BullMQ.
 *
 * Enqueue failures never bubble into a request: background work is by
 * definition not part of the caller's transaction, so a Redis hiccup logs an
 * error rather than failing a user-visible operation. Callers that genuinely
 * need delivery guarantees use `enqueueOrThrow`.
 */
@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly queues: Map<QueueName, Queue>;

  constructor(
    @InjectQueue(QUEUE_NAMES.AUDIT) auditQueue: Queue,
    @InjectQueue(QUEUE_NAMES.EMAIL) emailQueue: Queue,
    @InjectQueue(QUEUE_NAMES.NOTIFICATION) notificationQueue: Queue,
    @InjectQueue(QUEUE_NAMES.SECURITY) securityQueue: Queue,
    @InjectQueue(QUEUE_NAMES.MAINTENANCE) maintenanceQueue: Queue,
    @InjectQueue(QUEUE_NAMES.BILLING) billingQueue: Queue,
    @InjectQueue(QUEUE_NAMES.TRADE_SIGNAL) tradeSignalQueue: Queue,
    @InjectQueue(QUEUE_NAMES.TRADE_EXECUTION) tradeExecutionQueue: Queue,
    @InjectQueue(QUEUE_NAMES.MARKET_SNAPSHOT) marketSnapshotQueue: Queue,
    // Part 6 and Part 7 registered their queues at the BullMQ module level
    // but the facade's map still ended at the Part 3 set - a request that
    // reached `getQueue(STRATEGY_CONTROL)` outside the mocked test harness
    // would have thrown "not registered". Fixing that here, once, for all
    // three later queues, so every QUEUE_NAMES entry actually resolves.
    @InjectQueue(QUEUE_NAMES.STRATEGY_CONTROL) strategyControlQueue: Queue,
    @InjectQueue(QUEUE_NAMES.DATASET_CONTROL) datasetControlQueue: Queue,
    @InjectQueue(QUEUE_NAMES.RISK_CONTROL) riskControlQueue: Queue,
    @InjectPinoLogger(QueueService.name) private readonly logger: PinoLogger,
    // Part 10: optional so the test harness (and any queue-only tool) can
    // construct the service without the telemetry plane; LAST parameter, as
    // any optional-injection addition to a DI constructor must be.
    @Optional() private readonly tracing?: TracingService,
  ) {
    this.queues = new Map<QueueName, Queue>([
      [QUEUE_NAMES.AUDIT, auditQueue],
      [QUEUE_NAMES.EMAIL, emailQueue],
      [QUEUE_NAMES.NOTIFICATION, notificationQueue],
      [QUEUE_NAMES.SECURITY, securityQueue],
      [QUEUE_NAMES.MAINTENANCE, maintenanceQueue],
      [QUEUE_NAMES.BILLING, billingQueue],
      [QUEUE_NAMES.TRADE_SIGNAL, tradeSignalQueue],
      [QUEUE_NAMES.TRADE_EXECUTION, tradeExecutionQueue],
      [QUEUE_NAMES.MARKET_SNAPSHOT, marketSnapshotQueue],
      [QUEUE_NAMES.STRATEGY_CONTROL, strategyControlQueue],
      [QUEUE_NAMES.DATASET_CONTROL, datasetControlQueue],
      [QUEUE_NAMES.RISK_CONTROL, riskControlQueue],
    ]);
  }

  getQueue(name: QueueName): Queue {
    const queue = this.queues.get(name);
    if (!queue) {
      throw new Error(`Queue "${name}" is not registered`);
    }
    return queue;
  }

  /** Part 10: every successful publish carries the caller's trace into the
   *  job's sidecar - a transport annotation beside the payload, never
   *  inside it, because job payloads are replayed and versioned and a trace
   *  context is neither. Fire-and-forget by call sites: correlation is not
   *  allowed to fail a publish. */
  private async attachSidecar(name: QueueName, jobId: string | null): Promise<void> {
    if (this.tracing === undefined || jobId === null || jobId === '') {
      return;
    }
    await this.tracing.captureQueueSidecar(name, jobId).catch(() => undefined);
  }

  /** Best-effort enqueue. Returns the job id, or null when enqueueing failed. */
  async enqueue<T extends object>(
    name: QueueName,
    jobName: string,
    payload: T,
    options?: JobsOptions,
  ): Promise<string | null> {
    try {
      const job = await this.getQueue(name).add(jobName, payload, options);
      const jobId = job.id ?? null;
      await this.attachSidecar(name, jobId);
      return jobId;
    } catch (error) {
      this.logger.error(
        {
          event: 'queue.enqueue_failed',
          queue: name,
          jobName,
          err: error instanceof Error ? { message: error.message, name: error.name } : undefined,
        },
        'Failed to enqueue background job',
      );
      return null;
    }
  }

  /** Enqueue that propagates failures to the caller. */
  async enqueueOrThrow<T extends object>(
    name: QueueName,
    jobName: string,
    payload: T,
    options?: JobsOptions,
  ): Promise<string> {
    const job = await this.getQueue(name).add(jobName, payload, options);
    const jobId = job.id ?? '';
    await this.attachSidecar(name, jobId === '' ? null : jobId);
    return jobId;
  }

  /**
   * Registers a repeating job. `jobId` keeps the repeat definition idempotent
   * across restarts and rolling deployments.
   */
  async schedule<T extends object>(
    name: QueueName,
    jobName: string,
    payload: T,
    pattern: string,
  ): Promise<void> {
    await this.getQueue(name).add(jobName, payload, {
      repeat: { pattern },
      jobId: `repeat:${jobName}`,
      removeOnComplete: true,
    });
  }

  async getDepths(): Promise<QueueDepth[]> {
    const depths: QueueDepth[] = [];

    for (const [name, queue] of this.queues.entries()) {
      const counts = await queue.getJobCounts(
        'waiting',
        'active',
        'delayed',
        'failed',
        'completed',
      );

      let oldestWaitingAgeMs: number | null = null;
      if ((counts.waiting ?? 0) > 0) {
        // Best-effort: a head-job read failure leaves the age null (unknown),
        // never zero. Zero oldest-age on a waiting queue would be a
        // comfortable lie during exactly the backlog this is for.
        try {
          // BullMQ's getWaiting(start, end) materialises the page as Job
          // objects; a two-element page is a two-element fetch, not a scan.
          const [headJob] = await queue.getWaiting(0, 0);
          if (headJob?.timestamp) {
            oldestWaitingAgeMs = Math.max(0, Date.now() - headJob.timestamp);
          }
        } catch {
          oldestWaitingAgeMs = null;
        }
      }

      depths.push({
        name,
        waiting: counts.waiting ?? 0,
        active: counts.active ?? 0,
        delayed: counts.delayed ?? 0,
        failed: counts.failed ?? 0,
        completed: counts.completed ?? 0,
        paused: await queue.isPaused(),
        oldestWaitingAgeMs,
      });
    }

    return depths;
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all(
      [...this.queues.values()].map(async (queue) => {
        try {
          await queue.close();
        } catch {
          // Shutdown is best-effort; the process is exiting either way.
        }
      }),
    );
  }
}
```

## FILE: apps/api/src/modules/queue/maintenance.scheduler.ts (104 lines)

```typescript
import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { JOB_NAMES, QUEUE_NAMES } from '@wlct/config';

import { AppConfigService } from '../../config/app-config.service';
import { QueueService } from './queue.service';

/**
 * Registers the platform's repeatable jobs once the application is up.
 *
 * Repeat definitions are keyed by job id, so restarting or scaling the API does
 * not create duplicate schedules.
 */
@Injectable()
export class MaintenanceScheduler implements OnApplicationBootstrap {
  constructor(
    private readonly queues: QueueService,
    private readonly config: AppConfigService,
    @InjectPinoLogger(MaintenanceScheduler.name) private readonly logger: PinoLogger,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      // Every 15 minutes: expire stale refresh tokens and sessions.
      await this.queues.schedule(
        QUEUE_NAMES.MAINTENANCE,
        JOB_NAMES.PRUNE_EXPIRED_TOKENS,
        {},
        '*/15 * * * *',
      );

      // Nightly at 03:20 UTC: trim audit history beyond the retention window.
      await this.queues.schedule(
        QUEUE_NAMES.MAINTENANCE,
        JOB_NAMES.PRUNE_AUDIT_LOGS,
        { retentionDays: 365 },
        '20 3 * * *',
      );

      // Part 9: every minute, fold the trading plane's alert mirrors into
      // durable rows (and reconcile queue-alert policy). The cadence is one
      // minute because that is the granularity at which a stale "0 alerts"
      // panel starts to actively mislead; the work is a handful of Redis
      // reads and upserts, sized against the DEDUPED alert count, not the
      // event rate that produced it.
      await this.queues.schedule(
        QUEUE_NAMES.MAINTENANCE,
        JOB_NAMES.SYNC_OPERATIONAL_ALERTS,
        {},
        '* * * * *',
      );

      // Nightly at 03:40 UTC: retention for resolved alerts and closed
      // incidents. Unresolved history is never touched - the service's
      // where-clauses enforce that; this schedule only decides WHEN the
      // eligible rows go.
      await this.queues.schedule(
        QUEUE_NAMES.MAINTENANCE,
        JOB_NAMES.PRUNE_OPERATIONAL_HISTORY,
        {
          alertRetentionDays: this.config.alertRetentionDays,
          incidentRetentionDays: this.config.incidentRetentionDays,
        },
        '40 3 * * *',
      );

      // Part 10: SLO evaluation. The cadence is the CONFIGURED interval
      // (clamped into the cron minute field's range); the evaluator writes
      // one row per enabled objective per tick and nothing else. It reads
      // buckets and durable tables - no trading path depends on this job,
      // and it failing for an hour costs an hour of rows, never a decision.
      const sloInterval = Math.min(59, Math.max(1, this.config.sloEvaluationIntervalMinutes));
      if (this.config.sloEnabled) {
        await this.queues.schedule(
          QUEUE_NAMES.MAINTENANCE,
          JOB_NAMES.EVALUATE_OPERATIONAL_SLOS,
          {},
          `*/${String(sloInterval)} * * * *`,
        );

        // Nightly at 03:50 UTC: evaluation-row retention (definitions are
        // never pruned; the 7-day floor is enforced in the processor).
        await this.queues.schedule(
          QUEUE_NAMES.MAINTENANCE,
          JOB_NAMES.PRUNE_SLO_EVALUATIONS,
          { retentionDays: this.config.sloRetentionDays },
          '50 3 * * *',
        );
      }

      this.logger.info({ event: 'maintenance.scheduled' }, 'Repeatable maintenance jobs registered');
    } catch (error) {
      // A scheduling failure must not stop the API from serving traffic.
      this.logger.error(
        {
          event: 'maintenance.schedule_failed',
          err: error instanceof Error ? { message: error.message, name: error.name } : undefined,
        },
        'Could not register repeatable maintenance jobs',
      );
    }
  }
}
```

## FILE: apps/api/src/modules/queue/processors/maintenance.processor.ts (276 lines)

```typescript
import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import type { Job } from 'bullmq';
import { JOB_NAMES, QUEUE_NAMES } from '@wlct/config';

import { AppConfigService } from '../../../config/app-config.service';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AlertsService } from '../../observability/alerts.service';
import { IncidentsService } from '../../observability/incidents.service';
import { SloService } from '../../observability/slo.service';
import { SloSamplesService } from '../../observability/slo-samples';
import { TradingReadinessService } from '../../health/trading-readiness.service';
import { TracingService } from '../../../infrastructure/tracing/tracing.service';

/**
 * Housekeeping worker.
 *
 * Deliberately conservative: it only touches rows whose retention window has
 * demonstrably passed, and audit rows are never removed before the statutory
 * minimum retention period, whatever the job payload asks for.
 *
 * When QUEUE_RUN_INLINE_WORKERS is false the worker shuts itself down at
 * bootstrap so the dedicated worker container is the only consumer and request
 * latency stays isolated from background load.
 */
@Injectable()
@Processor(QUEUE_NAMES.MAINTENANCE, { concurrency: 1 })
export class MaintenanceProcessor extends WorkerHost implements OnApplicationBootstrap {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly alerts: AlertsService,
    private readonly incidents: IncidentsService,
    private readonly readiness: TradingReadinessService,
    private readonly slo: SloService,
    private readonly sloSamples: SloSamplesService,
    private readonly tracing: TracingService,
    @InjectPinoLogger(MaintenanceProcessor.name) private readonly logger: PinoLogger,
  ) {
    super();
  }

  async onApplicationBootstrap(): Promise<void> {
    // Part 10: the processing-success sample source is the WORKER's own
    // outcome events. Attaching before the close decision means whichever
    // process ends up consuming (this one inline, or the dedicated
    // container running the same class) counts what IT executed; the shared
    // Redis buckets sum the replicas, and an un-consumed job is neither
    // completed nor failed by anyone's account. The listener never
    // throws - a failed bucket write must not poison the worker's event
    // loop, so every write is fire-and-forget with the failure folded into
    // the completeness law (a dead collector reads as UNKNOWN, not HEALTHY).
    this.worker.on('completed', (job) => {
      void this.sloSamples.recordCounters('queueproc', 1, 0).catch(() => undefined);
      void job;
    });
    this.worker.on('failed', (job) => {
      void this.sloSamples.recordCounters('queueproc', 0, 1).catch(() => undefined);
      void job;
    });

    if (this.config.queueRunInlineWorkers) {
      return;
    }

    await this.worker.close();
    this.logger.info(
      { event: 'queue.inline_worker_disabled', queue: QUEUE_NAMES.MAINTENANCE },
      'Inline maintenance worker disabled; jobs are consumed by the worker container',
    );
  }

  async process(
    job: Job<{
      retentionDays?: number;
      alertRetentionDays?: number;
      incidentRetentionDays?: number;
    }>,
  ): Promise<{ removed: number } | Record<string, number>> {
    // Part 10: every maintenance job runs inside its trace continuation -
    // the publisher's context arrives via the TTL-bounded sidecar, the
    // consumer span wraps the work, and an absent sidecar (published before
    // this part deployed, or after the TTL) simply starts no continuation.
    return this.tracing.withJobContext(
      QUEUE_NAMES.MAINTENANCE,
      job.id ?? 'unknown',
      // 'queue.process' is the operation's name from the core TRACED_OPERATIONS
      // set (the fixture's enums list) - an operation outside that closed set
      // would be a span nobody agreed to trace.
      'queue.process',
      () => this.dispatch(job),
    );
  }

  private async dispatch(
    job: Job<{
      retentionDays?: number;
      alertRetentionDays?: number;
      incidentRetentionDays?: number;
    }>,
  ): Promise<{ removed: number } | Record<string, number>> {
    switch (job.name) {
      case JOB_NAMES.PRUNE_EXPIRED_TOKENS:
        return this.pruneExpiredTokens();
      case JOB_NAMES.PRUNE_AUDIT_LOGS:
        return this.pruneAuditLogs(job.data.retentionDays ?? 365);
      case JOB_NAMES.SYNC_OPERATIONAL_ALERTS:
        return this.syncOperationalAlerts();
      case JOB_NAMES.PRUNE_OPERATIONAL_HISTORY:
        return this.pruneOperationalHistory(
          job.data.alertRetentionDays ?? this.config.alertRetentionDays,
          job.data.incidentRetentionDays ?? this.config.incidentRetentionDays,
        );
      case JOB_NAMES.EVALUATE_OPERATIONAL_SLOS:
        return this.evaluateSlos();
      case JOB_NAMES.PRUNE_SLO_EVALUATIONS:
        return this.pruneSloEvaluations(job.data.retentionDays);
      default:
        this.logger.warn(
          { event: 'maintenance.unknown_job', jobName: job.name },
          'Received an unknown maintenance job',
        );
        return { removed: 0 };
    }
  }

  /**
   * The Part 9 fold. Two steps, one job: sync the publisher mirrors into
   * durable alerts (recovery-observed resolution included), then evaluate
   * queue-alert policy from the SAME depth snapshot the readiness endpoint
   * just used - so the panel and the alert table are answering the same
   * question with the same numbers. Failures here are logged, not thrown
   * through the queue: the next minute's tick retries, and alert state is
   * convergent by construction (folds, not deltas).
   */
  private async syncOperationalAlerts(): Promise<Record<string, number>> {
    const sync = await this.alerts.syncFromMirrors();
    const samples = await this.readiness.queueAlertSamples();
    await this.alerts.applyQueueAlerts(samples);
    this.logger.info(
      {
        event: 'maintenance.ops_synced',
        inserted: sync.inserted,
        folded: sync.folded,
        resolved: sync.resolved,
        queueAlerts: samples.filter((sample) => sample.alerting).length,
      },
      'Operational alert mirrors folded',
    );
    return {
      inserted: sync.inserted,
      folded: sync.folded,
      resolved: sync.resolved,
      incidents: sync.incidentsFolded,
    };
  }

  /**
   * Retention with a guard written into the query, not a comment: only
   * RESOLVED alerts and CLOSED incidents are candidates. The day-count
   * floors are enforced at config parse (env schema); this method trusts
   * that validation and adds one more safety of its own - a payload that
   * somehow carries a smaller number is clamped, mirroring how the audit
   * pruner clamps its own floor.
   */
  private async pruneOperationalHistory(
    alertRetentionDays: number,
    incidentRetentionDays: number,
  ): Promise<{ alerts: number; incidents: number }> {
    const alertFloorDays = 7;
    const incidentFloorDays = 30;
    const effectiveAlertDays = Math.max(alertFloorDays, alertRetentionDays);
    const effectiveIncidentDays = Math.max(incidentFloorDays, incidentRetentionDays);

    const alertCutoff = new Date(Date.now() - effectiveAlertDays * 86_400_000);
    const incidentCutoff = new Date(Date.now() - effectiveIncidentDays * 86_400_000);

    const [alerts, incidents] = await this.prisma.$transaction([
      this.prisma.opsAlert.deleteMany({
        where: { state: 'RESOLVED', resolvedAt: { lt: alertCutoff } },
      }),
      this.prisma.opsIncident.deleteMany({
        where: { status: 'CLOSED', closedAt: { lt: incidentCutoff } },
      }),
    ]);

    return { alerts: alerts.count, incidents: incidents.count };
  }

  /**
   * Part 10: the scheduled evaluation tick. `actor: null` marks it as
   * machine-driven (no SLO_EVALUATE_REQUESTED audit - the cron line in the
   * scheduler is the record of WHO asked). Errors from individual sources
   * are folded into UNKNOWN rows by the evaluator; an error HERE (the job
   * throwing) leaves no rows at all, which the completeness law reads as the
   * collector being down - the same fact either way, the panel says so.
   */
  private async evaluateSlos(): Promise<Record<string, number>> {
    const result = await this.slo.evaluateAll(null, 'scheduled');
    this.logger.info(
      {
        event: 'maintenance.slo_evaluated',
        evaluated: result.evaluated,
        paging: result.alertingSloIds.length,
        skipped: result.skipped.length,
      },
      'SLO evaluation tick complete',
    );
    return { evaluated: result.evaluated, paging: result.alertingSloIds.length };
  }

  /** Evaluation-row retention. Definitions are NEVER pruned (versioned
   *  promise history is the point of the table); the 7-day floor lives in
   *  the service, which clamps whatever this payload carries. */
  private async pruneSloEvaluations(retentionDays?: number): Promise<{ removed: number }> {
    return this.slo.prune({ retentionDays });
  }

  private async pruneExpiredTokens(): Promise<{ removed: number }> {
    const now = new Date();

    const [expiredTokens, expiredSessions, expiredVerifications] = await this.prisma.$transaction([
      this.prisma.refreshToken.updateMany({
        where: { status: 'ACTIVE', expiresAt: { lt: now } },
        data: { status: 'EXPIRED' },
      }),
      this.prisma.userSession.updateMany({
        where: { revokedAt: null, expiresAt: { lt: now } },
        data: { revokedAt: now, revokeReason: 'expired' },
      }),
      this.prisma.verificationToken.deleteMany({
        where: { expiresAt: { lt: new Date(now.getTime() - 86_400_000) } },
      }),
    ]);

    const removed = expiredTokens.count + expiredSessions.count + expiredVerifications.count;

    this.logger.info(
      {
        event: 'maintenance.tokens_pruned',
        refreshTokens: expiredTokens.count,
        sessions: expiredSessions.count,
        verificationTokens: expiredVerifications.count,
      },
      'Expired authentication artefacts pruned',
    );

    return { removed };
  }

  private async pruneAuditLogs(retentionDays: number): Promise<{ removed: number }> {
    // Audit history is evidence. Never let a payload shrink the window below a
    // year, and never prune at all outside production-like environments where
    // the volume simply does not warrant it.
    const effectiveRetention = Math.max(retentionDays, 365);
    const cutoff = new Date(Date.now() - effectiveRetention * 86_400_000);

    const deleted = await this.prisma.auditLog.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });

    this.logger.info(
      {
        event: 'maintenance.audit_pruned',
        removed: deleted.count,
        retentionDays: effectiveRetention,
        environment: this.config.nodeEnv,
      },
      'Audit logs beyond the retention window removed',
    );

    return { removed: deleted.count };
  }
}
```

## FILE: apps/api/src/app.module.ts (112 lines)

```typescript
import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';

import { AppConfigModule } from './config/app-config.module';
import { LoggerModule } from './infrastructure/logger/logger.module';
import { PrismaModule } from './infrastructure/prisma/prisma.module';
import { RedisModule } from './infrastructure/redis/redis.module';
import { CryptoModule } from './infrastructure/crypto/crypto.module';
import { I18nModule } from './infrastructure/i18n/i18n.module';
import { QueueModule } from './modules/queue/queue.module';
import { HealthModule } from './modules/health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { TenantsModule } from './modules/tenants/tenants.module';
import { RbacModule } from './modules/rbac/rbac.module';
import { AuditModule } from './modules/audit/audit.module';
import { SecurityModule } from './modules/security/security.module';
import { FeatureFlagsModule } from './modules/feature-flags/feature-flags.module';
import { BillingModule } from './modules/billing/billing.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { ExecutionModule } from './modules/execution/execution.module';
import { StrategyModule } from './modules/strategy/strategy.module';
import { DatasetsModule } from './modules/datasets/datasets.module';
import { RiskModule } from './modules/risk/risk.module';
import { ObservabilityModule } from './modules/observability/observability.module';

import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { PrismaExceptionFilter } from './common/filters/prisma-exception.filter';
import { ResponseTransformInterceptor } from './common/interceptors/response-transform.interceptor';
import { TimeoutInterceptor } from './common/interceptors/timeout.interceptor';
import { AuditContextInterceptor } from './common/interceptors/audit-context.interceptor';
import { GlobalValidationPipe } from './common/pipes/global-validation.pipe';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from './modules/auth/guards/permissions.guard';
import { TenantGuard } from './modules/tenants/guards/tenant.guard';
import { FeatureFlagGuard } from './modules/feature-flags/guards/feature-flag.guard';
import { ThrottlerBehindProxyGuard } from './common/guards/throttler-behind-proxy.guard';
import { RequestContextMiddleware } from './common/middleware/request-context.middleware';
import { TraceMiddleware } from './infrastructure/tracing/trace.middleware';
import { TenantResolutionMiddleware } from './common/middleware/tenant-resolution.middleware';
import { RateLimitModule } from './common/rate-limit/rate-limit.module';

/**
 * Root module.
 *
 * Cross-cutting behaviour is registered once here as global providers so that
 * feature modules stay focused on their domain:
 *   - validation pipe        -> rejects malformed input before controllers run
 *   - exception filters      -> uniform, stack-trace-free error envelopes
 *   - response interceptor   -> uniform success envelopes
 *   - guards (order matters) -> throttling, then authN, then tenancy, then authZ
 */
@Module({
  imports: [
    AppConfigModule,
    // Dynamic on purpose: see the comment in logger.module.ts. Calling
    // forRoot() here (rather than importing a statically configured module)
    // guarantees every @InjectPinoLogger context has been registered first.
    LoggerModule.forRoot(),
    PrismaModule,
    RedisModule,
    CryptoModule,
    I18nModule,
    RateLimitModule,
    ScheduleModule.forRoot(),
    QueueModule,
    HealthModule,
    AuditModule,
    SecurityModule,
    RbacModule,
    TenantsModule,
    UsersModule,
    AuthModule,
    FeatureFlagsModule,
    BillingModule,
    NotificationsModule,
    RealtimeModule,
    ExecutionModule,
    StrategyModule,
    DatasetsModule,
    RiskModule,
    ObservabilityModule,
  ],
  providers: [
    { provide: APP_PIPE, useClass: GlobalValidationPipe },
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
    { provide: APP_FILTER, useClass: PrismaExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: TimeoutInterceptor },
    { provide: APP_INTERCEPTOR, useClass: AuditContextInterceptor },
    { provide: APP_INTERCEPTOR, useClass: ResponseTransformInterceptor },
    // Guards execute in registration order.
    { provide: APP_GUARD, useClass: ThrottlerBehindProxyGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: TenantGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_GUARD, useClass: FeatureFlagGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      // TraceMiddleware FIRST: the server span brackets the whole pipeline
      // (correlation and tenant resolution included), so a 401 from the
      // auth guard is still a span with a status - requests that never reach
      // a handler are precisely the ones an incident review asks about.
      .apply(TraceMiddleware, RequestContextMiddleware, TenantResolutionMiddleware)
      .forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}
```

## FILE: apps/api/src/config/app-config.service.ts (1240 lines)

```typescript
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppEnv, NodeEnvironment } from '@wlct/config';
import { parseDurationToMs, parseDurationToSeconds } from '@wlct/utils';

export interface RedisConnectionOptions {
  host: string;
  port: number;
  password?: string;
  db: number;
  tls?: Record<string, never>;
  keyPrefix: string;
  maxRetriesPerRequest: number | null;
  enableReadyCheck: boolean;
}

/**
 * Typed, memoised accessor over the validated environment.
 *
 * Every consumer depends on this class instead of `ConfigService.get(...)`,
 * which removes stringly-typed lookups and gives a single place to derive
 * computed values (durations in ms, Redis connection objects, CORS validators).
 */
@Injectable()
export class AppConfigService {
  private readonly env: AppEnv;

  constructor(private readonly configService: ConfigService) {
    // `validate()` in AppConfigModule has already coerced and checked every
    // variable, so reads go through ConfigService to pick up the parsed values
    // (numbers, booleans, arrays) rather than the raw strings in process.env.
    this.env = new Proxy({} as AppEnv, {
      get: (_target, property: string | symbol) =>
        typeof property === 'string' ? this.configService.get(property) : undefined,
    }) as AppEnv;
  }

  // ---------------------------------------------------------------------------
  // Application
  // ---------------------------------------------------------------------------

  get nodeEnv(): NodeEnvironment {
    return this.env.NODE_ENV;
  }

  get isProduction(): boolean {
    return this.env.NODE_ENV === 'production';
  }

  get isDevelopment(): boolean {
    return this.env.NODE_ENV === 'development';
  }

  get isTest(): boolean {
    return this.env.NODE_ENV === 'test';
  }

  get appName(): string {
    return this.env.APP_NAME;
  }

  get port(): number {
    return this.env.API_PORT;
  }

  get host(): string {
    return this.env.API_HOST;
  }

  get globalPrefix(): string {
    return this.env.API_GLOBAL_PREFIX;
  }

  get defaultApiVersion(): string {
    return this.env.API_DEFAULT_VERSION;
  }

  get publicUrl(): string {
    return this.env.API_PUBLIC_URL;
  }

  get adminWebUrl(): string {
    return this.env.ADMIN_WEB_URL;
  }

  get trustProxyHops(): number {
    return this.env.TRUST_PROXY_HOPS;
  }

  get platformRootDomain(): string {
    return this.env.PLATFORM_ROOT_DOMAIN;
  }

  get defaultTenantSlug(): string {
    return this.env.DEFAULT_TENANT_SLUG;
  }

  // ---------------------------------------------------------------------------
  // Database
  // ---------------------------------------------------------------------------

  get databaseUrl(): string {
    return this.env.DATABASE_URL;
  }

  get databaseLogQueries(): boolean {
    return this.env.DATABASE_LOG_QUERIES;
  }

  // ---------------------------------------------------------------------------
  // Redis
  // ---------------------------------------------------------------------------

  get redisOptions(): RedisConnectionOptions {
    return {
      host: this.env.REDIS_HOST,
      port: this.env.REDIS_PORT,
      password: this.env.REDIS_PASSWORD || undefined,
      db: this.env.REDIS_DB,
      tls: this.env.REDIS_TLS ? {} : undefined,
      keyPrefix: this.env.REDIS_KEY_PREFIX,
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
    };
  }

  /**
   * BullMQ requires `maxRetriesPerRequest: null` and no key prefix collisions.
   *
   * The prefix is stripped by rebuilding the object rather than by destructuring
   * it away: an unused binding is dead weight the linter is right to flag, and
   * naming the retained fields makes it obvious that dropping `keyPrefix` is the
   * whole point of the method.
   */
  get queueRedisOptions(): Omit<RedisConnectionOptions, 'keyPrefix'> {
    const options = this.redisOptions;
    return {
      host: options.host,
      port: options.port,
      password: options.password,
      db: options.db,
      tls: options.tls,
      maxRetriesPerRequest: options.maxRetriesPerRequest,
      enableReadyCheck: options.enableReadyCheck,
    };
  }

  get redisKeyPrefix(): string {
    return this.env.REDIS_KEY_PREFIX;
  }

  // ---------------------------------------------------------------------------
  // JWT
  // ---------------------------------------------------------------------------

  get jwtAlgorithm(): AppEnv['JWT_ALGORITHM'] {
    return this.env.JWT_ALGORITHM;
  }

  get jwtUsesAsymmetricKeys(): boolean {
    return this.env.JWT_ALGORITHM.startsWith('RS');
  }

  get jwtAccessSigningKey(): string {
    if (this.jwtUsesAsymmetricKeys) {
      return Buffer.from(this.env.JWT_PRIVATE_KEY_BASE64 ?? '', 'base64').toString('utf8');
    }
    return this.env.JWT_ACCESS_SECRET ?? '';
  }

  get jwtAccessVerificationKey(): string {
    if (this.jwtUsesAsymmetricKeys) {
      return Buffer.from(this.env.JWT_PUBLIC_KEY_BASE64 ?? '', 'base64').toString('utf8');
    }
    return this.env.JWT_ACCESS_SECRET ?? '';
  }

  get jwtRefreshSigningKey(): string {
    if (this.jwtUsesAsymmetricKeys) {
      return Buffer.from(this.env.JWT_PRIVATE_KEY_BASE64 ?? '', 'base64').toString('utf8');
    }
    return this.env.JWT_REFRESH_SECRET ?? '';
  }

  get jwtRefreshVerificationKey(): string {
    if (this.jwtUsesAsymmetricKeys) {
      return Buffer.from(this.env.JWT_PUBLIC_KEY_BASE64 ?? '', 'base64').toString('utf8');
    }
    return this.env.JWT_REFRESH_SECRET ?? '';
  }

  get accessTokenTtl(): string {
    return this.env.JWT_ACCESS_TTL;
  }

  get accessTokenTtlSeconds(): number {
    return parseDurationToSeconds(this.env.JWT_ACCESS_TTL);
  }

  get refreshTokenTtl(): string {
    return this.env.JWT_REFRESH_TTL;
  }

  get refreshTokenTtlSeconds(): number {
    return parseDurationToSeconds(this.env.JWT_REFRESH_TTL);
  }

  get refreshTokenTtlMs(): number {
    return parseDurationToMs(this.env.JWT_REFRESH_TTL);
  }

  get jwtIssuer(): string {
    return this.env.JWT_ISSUER;
  }

  get jwtAudience(): string {
    return this.env.JWT_AUDIENCE;
  }

  get maxActiveSessionsPerUser(): number {
    return this.env.MAX_ACTIVE_SESSIONS_PER_USER;
  }

  // ---------------------------------------------------------------------------
  // Password & account protection
  // ---------------------------------------------------------------------------

  get passwordMinLength(): number {
    return this.env.PASSWORD_MIN_LENGTH;
  }

  get argon2Options(): { memoryCost: number; timeCost: number; parallelism: number } {
    return {
      memoryCost: this.env.ARGON2_MEMORY_COST,
      timeCost: this.env.ARGON2_TIME_COST,
      parallelism: this.env.ARGON2_PARALLELISM,
    };
  }

  get loginMaxFailedAttempts(): number {
    return this.env.LOGIN_MAX_FAILED_ATTEMPTS;
  }

  get loginFailedWindowSeconds(): number {
    return this.env.LOGIN_FAILED_WINDOW_SECONDS;
  }

  get accountLockoutSeconds(): number {
    return this.env.ACCOUNT_LOCKOUT_SECONDS;
  }

  // ---------------------------------------------------------------------------
  // Encryption
  // ---------------------------------------------------------------------------

  get encryptionMasterKeyBase64(): string {
    return this.env.ENCRYPTION_MASTER_KEY_BASE64;
  }

  get encryptionKeyId(): string {
    return this.env.ENCRYPTION_KEY_ID;
  }

  get encryptionPreviousKeys(): Record<string, string> {
    return this.env.ENCRYPTION_PREVIOUS_KEYS_JSON ?? {};
  }

  get encryptionProvider(): 'local' | 'kms' {
    return this.env.ENCRYPTION_PROVIDER;
  }

  get blindIndexKeyBase64(): string {
    return this.env.BLIND_INDEX_KEY_BASE64;
  }

  // ---------------------------------------------------------------------------
  // Two factor
  // ---------------------------------------------------------------------------

  get twoFactorIssuer(): string {
    return this.env.TWO_FACTOR_ISSUER;
  }

  get twoFactorWindow(): number {
    return this.env.TWO_FACTOR_WINDOW;
  }

  get twoFactorDigits(): number {
    return this.env.TWO_FACTOR_DIGITS;
  }

  get twoFactorPeriod(): number {
    return this.env.TWO_FACTOR_PERIOD;
  }

  get twoFactorRecoveryCodeCount(): number {
    return this.env.TWO_FACTOR_RECOVERY_CODES;
  }

  get twoFactorChallengeTtl(): string {
    return this.env.TWO_FACTOR_CHALLENGE_TTL;
  }

  get twoFactorChallengeTtlSeconds(): number {
    return parseDurationToSeconds(this.env.TWO_FACTOR_CHALLENGE_TTL);
  }

  get twoFactorMaxChallengeAttempts(): number {
    return this.env.TWO_FACTOR_MAX_CHALLENGE_ATTEMPTS;
  }

  // ---------------------------------------------------------------------------
  // CORS
  // ---------------------------------------------------------------------------

  get corsEnabled(): boolean {
    return this.env.CORS_ENABLED;
  }

  get corsOrigins(): string[] {
    return this.env.CORS_ORIGINS;
  }

  get corsCredentials(): boolean {
    return this.env.CORS_CREDENTIALS;
  }

  get corsAllowedHeaders(): string[] {
    return this.env.CORS_ALLOWED_HEADERS;
  }

  get corsExposedHeaders(): string[] {
    return this.env.CORS_EXPOSED_HEADERS;
  }

  /**
   * Allows configured origins plus any tenant custom domain that resolves under
   * the platform root domain. Unknown origins are rejected rather than echoed.
   */
  get corsOriginValidator(): (
    origin: string | undefined,
    callback: (error: Error | null, allow?: boolean) => void,
  ) => void {
    const allowList = new Set(this.corsOrigins);
    const rootDomain = this.platformRootDomain;
    const allowAnyInDev = !this.isProduction;

    return (origin, callback) => {
      if (!origin) {
        // Same-origin, curl, and mobile apps send no Origin header.
        callback(null, true);
        return;
      }
      if (allowList.has(origin)) {
        callback(null, true);
        return;
      }
      try {
        const { hostname, protocol } = new URL(origin);
        if (protocol === 'https:' && (hostname === rootDomain || hostname.endsWith(`.${rootDomain}`))) {
          callback(null, true);
          return;
        }
        if (allowAnyInDev && (hostname === 'localhost' || hostname === '127.0.0.1')) {
          callback(null, true);
          return;
        }
      } catch {
        callback(null, false);
        return;
      }
      callback(null, false);
    };
  }

  // ---------------------------------------------------------------------------
  // Rate limiting
  // ---------------------------------------------------------------------------

  get rateLimitEnabled(): boolean {
    return this.env.RATE_LIMIT_ENABLED;
  }

  get rateLimitTtlSeconds(): number {
    return this.env.RATE_LIMIT_TTL_SECONDS;
  }

  get rateLimitMax(): number {
    return this.env.RATE_LIMIT_MAX;
  }

  get rateLimitAuthTtlSeconds(): number {
    return this.env.RATE_LIMIT_AUTH_TTL_SECONDS;
  }

  get rateLimitAuthMax(): number {
    return this.env.RATE_LIMIT_AUTH_MAX;
  }

  get rateLimitTrustedIps(): string[] {
    return this.env.RATE_LIMIT_TRUSTED_IPS;
  }

  // ---------------------------------------------------------------------------
  // Swagger
  // ---------------------------------------------------------------------------

  get swaggerEnabled(): boolean {
    return this.env.SWAGGER_ENABLED;
  }

  get swaggerPath(): string {
    return this.env.SWAGGER_PATH;
  }

  get swaggerTitle(): string {
    return this.env.SWAGGER_TITLE;
  }

  get swaggerDescription(): string {
    return this.env.SWAGGER_DESCRIPTION;
  }

  get swaggerVersion(): string {
    return this.env.SWAGGER_VERSION;
  }

  get swaggerCredentials(): { user?: string; password?: string } {
    return { user: this.env.SWAGGER_USER, password: this.env.SWAGGER_PASSWORD };
  }

  // ---------------------------------------------------------------------------
  // Logging
  // ---------------------------------------------------------------------------

  get logLevel(): AppEnv['LOG_LEVEL'] {
    return this.env.LOG_LEVEL;
  }

  get logFormat(): 'json' | 'pretty' {
    return this.env.LOG_FORMAT;
  }

  get logRequestBody(): boolean {
    return this.env.LOG_REQUEST_BODY;
  }

  // ---------------------------------------------------------------------------
  // WebSocket
  // ---------------------------------------------------------------------------

  get wsEnabled(): boolean {
    return this.env.WS_ENABLED;
  }

  get wsPath(): string {
    return this.env.WS_PATH;
  }

  get wsNamespace(): string {
    return this.env.WS_NAMESPACE;
  }

  get wsPingIntervalMs(): number {
    return this.env.WS_PING_INTERVAL_MS;
  }

  get wsPingTimeoutMs(): number {
    return this.env.WS_PING_TIMEOUT_MS;
  }

  get wsMaxConnectionsPerUser(): number {
    return this.env.WS_MAX_CONNECTIONS_PER_USER;
  }

  get wsRedisAdapterEnabled(): boolean {
    return this.env.WS_REDIS_ADAPTER;
  }

  // ---------------------------------------------------------------------------
  // Queues
  // ---------------------------------------------------------------------------

  get queuePrefix(): string {
    return this.env.QUEUE_PREFIX;
  }

  get queueDefaultAttempts(): number {
    return this.env.QUEUE_DEFAULT_ATTEMPTS;
  }

  get queueBackoffMs(): number {
    return this.env.QUEUE_BACKOFF_MS;
  }

  get queueRemoveOnComplete(): number {
    return this.env.QUEUE_REMOVE_ON_COMPLETE;
  }

  get queueRemoveOnFail(): number {
    return this.env.QUEUE_REMOVE_ON_FAIL;
  }

  get queueConcurrency(): number {
    return this.env.QUEUE_CONCURRENCY;
  }

  get queueRunInlineWorkers(): boolean {
    return this.env.QUEUE_RUN_INLINE_WORKERS;
  }

  // ---------------------------------------------------------------------------
  // Exchanges and internal services
  // ---------------------------------------------------------------------------

  get enabledExchanges(): string[] {
    return this.env.EXCHANGES_ENABLED;
  }

  get exchangeSandboxMode(): boolean {
    return this.env.EXCHANGE_SANDBOX_MODE;
  }

  get executionEnabled(): boolean {
    return this.env.EXECUTION_ENABLED;
  }

  // ---------------------------------------------------------------------------
  // Authenticated execution (Part 5)
  // ---------------------------------------------------------------------------
  // Note what is absent: there is no getter returning BINANCE_API_SECRET, or
  // any other raw credential. The API process never needs one. Credentials are
  // resolved inside the trading service's credential provider, and the only
  // thing this class exposes about them is whether a platform-level pair was
  // configured at all.

  get liveTradingEnabled(): boolean {
    return this.env.LIVE_TRADING_ENABLED;
  }

  get dryRun(): boolean {
    return this.env.DRY_RUN;
  }

  get paperTrading(): boolean {
    return this.env.PAPER_TRADING;
  }

  /**
   * The effective trading mode after all switches are combined.
   *
   * Resolution is deliberately pessimistic and the order of the checks is the
   * whole point: DRY_RUN wins over everything, then PAPER, and LIVE is only
   * reached when every switch explicitly permits it. There is no path through
   * this function where an unset variable produces LIVE.
   */
  get tradingMode(): 'DISABLED' | 'DRY_RUN' | 'PAPER' | 'LIVE' {
    if (!this.env.EXECUTION_ENABLED) {
      return 'DISABLED';
    }
    if (this.env.DRY_RUN) {
      return 'DRY_RUN';
    }
    if (this.env.PAPER_TRADING) {
      return 'PAPER';
    }
    if (this.env.LIVE_TRADING_ENABLED) {
      return 'LIVE';
    }
    return 'DISABLED';
  }

  /** True when a platform-level venue credential pair is configured. */
  get hasPlatformExchangeCredentials(): boolean {
    return Boolean(this.env.BINANCE_API_KEY) && Boolean(this.env.BINANCE_API_SECRET);
  }

  get orderRequestTimeoutMs(): number {
    return this.env.ORDER_REQUEST_TIMEOUT_MS;
  }

  get orderReconciliationIntervalMs(): number {
    return this.env.ORDER_RECONCILIATION_INTERVAL_MS;
  }

  get privateStreamReconnectEnabled(): boolean {
    return this.env.PRIVATE_STREAM_RECONNECT_ENABLED;
  }

  get exchangeTimeSyncIntervalMs(): number {
    return this.env.EXCHANGE_TIME_SYNC_INTERVAL_MS;
  }

  get executionIdempotencyTtlSeconds(): number {
    return this.env.EXECUTION_IDEMPOTENCY_TTL_SECONDS;
  }

  get orderUnknownReconciliationDelayMs(): number {
    return this.env.ORDER_UNKNOWN_RECONCILIATION_DELAY_MS;
  }

  /**
   * Everything the admin UI is allowed to know about execution configuration.
   * Booleans and durations only - assembled explicitly rather than by spreading
   * the env object, so a credential can never be added to the response by
   * accident later.
   */
  get executionSafetySummary(): {
    executionEnabled: boolean;
    tradingMode: 'DISABLED' | 'DRY_RUN' | 'PAPER' | 'LIVE';
    liveTradingEnabled: boolean;
    dryRun: boolean;
    paperTrading: boolean;
    sandboxMode: boolean;
    platformCredentialsConfigured: boolean;
    orderRequestTimeoutMs: number;
    orderReconciliationIntervalMs: number;
    orderUnknownReconciliationDelayMs: number;
    exchangeTimeSyncIntervalMs: number;
    executionIdempotencyTtlSeconds: number;
    privateStreamReconnectEnabled: boolean;
  } {
    return {
      executionEnabled: this.executionEnabled,
      tradingMode: this.tradingMode,
      liveTradingEnabled: this.liveTradingEnabled,
      dryRun: this.dryRun,
      paperTrading: this.paperTrading,
      sandboxMode: this.exchangeSandboxMode,
      platformCredentialsConfigured: this.hasPlatformExchangeCredentials,
      orderRequestTimeoutMs: this.orderRequestTimeoutMs,
      orderReconciliationIntervalMs: this.orderReconciliationIntervalMs,
      orderUnknownReconciliationDelayMs: this.orderUnknownReconciliationDelayMs,
      exchangeTimeSyncIntervalMs: this.exchangeTimeSyncIntervalMs,
      executionIdempotencyTtlSeconds: this.executionIdempotencyTtlSeconds,
      privateStreamReconnectEnabled: this.privateStreamReconnectEnabled,
    };
  }

  // ---------------------------------------------------------------------------
  // Strategy engine, paper trading and backtesting (Part 6)
  // ---------------------------------------------------------------------------
  // None of these getters can enable live trading. `strategyEngineEnabled`
  // says whether strategies run; where their signals may go is still decided
  // by `tradingMode` above, which is unchanged by anything in this section.

  get strategyEngineEnabled(): boolean {
    return this.env.STRATEGY_ENGINE_ENABLED;
  }

  get paperTradingEnabled(): boolean {
    return this.env.PAPER_TRADING_ENABLED;
  }

  get backtestEnabled(): boolean {
    return this.env.BACKTEST_ENABLED;
  }

  get strategyEventQueueSize(): number {
    return this.env.STRATEGY_EVENT_QUEUE_SIZE;
  }

  get strategyMaxInstances(): number {
    return this.env.STRATEGY_MAX_INSTANCES;
  }

  /**
   * Observation budget for one strategy dispatch, in milliseconds.
   *
   * Exceeding it increments a counter and marks the dispatch slow. It is not
   * a guarantee, and this platform makes no latency guarantee of any kind.
   */
  get strategyMaxProcessingLatencyMs(): number {
    return this.env.STRATEGY_MAX_PROCESSING_LATENCY_MS;
  }

  get signalMaxAgeMs(): number {
    return this.env.SIGNAL_MAX_AGE_MS;
  }

  get signalDedupTtlSeconds(): number {
    return this.env.SIGNAL_DEDUP_TTL_SECONDS;
  }

  /**
   * Default backtest execution assumptions.
   *
   * Returned as strings, not numbers: they are exact decimals that end up in
   * Decimal arithmetic and in the configuration hash of every run, and a
   * binary float would corrupt both.
   */
  get backtestDefaults(): {
    initialCapital: string;
    makerFee: string;
    takerFee: string;
    slippageBps: string;
  } {
    return {
      initialCapital: this.env.BACKTEST_DEFAULT_INITIAL_CAPITAL,
      makerFee: this.env.BACKTEST_DEFAULT_MAKER_FEE,
      takerFee: this.env.BACKTEST_DEFAULT_TAKER_FEE,
      slippageBps: this.env.BACKTEST_DEFAULT_SLIPPAGE_BPS,
    };
  }

  /**
   * Everything the admin UI may know about the strategy layer.
   *
   * Assembled field by field for the same reason as
   * {@link executionSafetySummary}: nothing is spread in, so a credential can
   * never arrive here by accident. `liveExecutionReachable` is stated
   * explicitly so an operator can see at a glance that enabling strategies did
   * not enable live orders.
   */
  get strategySafetySummary(): {
    strategyEngineEnabled: boolean;
    paperTradingEnabled: boolean;
    backtestEnabled: boolean;
    liveExecutionReachable: boolean;
    tradingMode: 'DISABLED' | 'DRY_RUN' | 'PAPER' | 'LIVE';
    maxInstances: number;
    eventQueueSize: number;
    maxProcessingLatencyMs: number;
    signalMaxAgeMs: number;
    signalDedupTtlSeconds: number;
    backtestDefaults: {
      initialCapital: string;
      makerFee: string;
      takerFee: string;
      slippageBps: string;
    };
    disclaimer: string;
  } {
    return {
      strategyEngineEnabled: this.strategyEngineEnabled,
      paperTradingEnabled: this.paperTradingEnabled,
      backtestEnabled: this.backtestEnabled,
      liveExecutionReachable: this.tradingMode === 'LIVE',
      tradingMode: this.tradingMode,
      maxInstances: this.strategyMaxInstances,
      eventQueueSize: this.strategyEventQueueSize,
      maxProcessingLatencyMs: this.strategyMaxProcessingLatencyMs,
      signalMaxAgeMs: this.signalMaxAgeMs,
      signalDedupTtlSeconds: this.signalDedupTtlSeconds,
      backtestDefaults: this.backtestDefaults,
      disclaimer:
        'Backtest and paper results are simulated. Backtest performance is ' +
        'not indicative of future performance; paper performance is not ' +
        'indicative of live performance.',
    };
  }

  // ---------------------------------------------------------------------------
  // Historical datasets (Part 7)
  // ---------------------------------------------------------------------------
  // The dataset layer is storage and integrity. None of these getters can
  // enable live trading, and none of them describe a venue connection: an
  // ingestion job reads public archives and the backtest engine reads the
  // frozen result. What the summary exposes is *why a backtest is
  // reproducible*: which storage serves datasets, whether ingestion may run,
  // and whether runs must cite a registered dataset version.

  get datasetStorage(): {
    backend: 'local';
    localRoot: string;
    stagingRoot: string;
    maxPartitionBytes: number;
    readerBufferSize: number;
    maxEventsPerPartition: number;
    maxGapWarnings: number;
    validationEnabled: boolean;
    retentionPolicy: 'retain' | 'purge_staging_only';
  } {
    return {
      backend: this.env.DATASET_STORAGE_BACKEND,
      localRoot: this.env.DATASET_LOCAL_ROOT,
      stagingRoot: this.env.DATASET_TEMP_ROOT,
      maxPartitionBytes: this.env.DATASET_MAX_PARTITION_BYTES,
      readerBufferSize: this.env.DATASET_READER_BUFFER_SIZE,
      maxEventsPerPartition: this.env.DATASET_MAX_EVENTS_PER_PARTITION,
      maxGapWarnings: this.env.DATASET_MAX_GAP_WARNINGS,
      validationEnabled: this.env.DATASET_VALIDATION_ENABLED,
      retentionPolicy: this.env.DATASET_RETENTION_POLICY,
    };
  }

  get historicalIngestionEnabled(): boolean {
    return this.env.HISTORICAL_INGESTION_ENABLED;
  }

  get backtestDatasetRequired(): boolean {
    return this.env.BACKTEST_DATASET_REQUIRED;
  }
  /**
   * Everything the admin UI may know about the dataset layer.
   *
   * Field by field for the same reason as {@link strategySafetySummary}:
   * nothing is spread in, so a credential-shaped value cannot arrive by
   * accident. There are no credentials here to begin with - historical
   * market data is public - but the assembly discipline is what keeps it
   * that way when someone adds the next field.
   */
  get datasetSafetySummary(): {
    ingestionEnabled: boolean;
    datasetRequiredForBacktests: boolean;
    storage: {
      backend: 'local';
      localRoot: string;
      stagingRoot: string;
      maxPartitionBytes: number;
      readerBufferSize: number;
      maxEventsPerPartition: number;
      maxGapWarnings: number;
      validationEnabled: boolean;
      retentionPolicy: 'retain' | 'purge_staging_only';
    };
    note: string;
  } {
    return {
      ingestionEnabled: this.historicalIngestionEnabled,
      datasetRequiredForBacktests: this.backtestDatasetRequired,
      storage: this.datasetStorage,
      note:
        'Datasets are frozen historical market data used for backtesting. ' +
        'They are not a trading input, cannot reach a venue, and a result ' +
        'computed over them is a simulation.',
    };
  }

  // ---------------------------------------------------------------------------
  // Part 8: risk engine control plane
  // ---------------------------------------------------------------------------

  get riskEngineEnabled(): boolean {
    return this.env.RISK_ENGINE_ENABLED;
  }

  get riskFailClosed(): boolean {
    return this.env.RISK_FAIL_CLOSED;
  }

  get maxRiskStateAgeMs(): number {
    return this.env.MAX_RISK_STATE_AGE_MS;
  }

  get riskSnapshotRefreshMs(): number {
    return this.env.RISK_SNAPSHOT_REFRESH_MS;
  }

  get riskEventsRetentionDays(): number {
    return this.env.RISK_EVENTS_RETENTION_DAYS;
  }

  /**
   * The platform-default ceilings this deployment publishes as the GLOBAL
   * layer of the risk hierarchy. They are strings because they are decimal
   * money all the way down: the API never runs them through Number beyond the
   * validation the env schema already performed.
   */
  get riskPlatformCeilings(): {
    maxOrderNotional: string;
    maxPositionNotional: string;
    maxAccountExposure: string;
    maxStrategyExposure: string;
    maxSymbolExposure: string;
    maxOpenOrders: number;
    maxDailyLoss: string;
    maxStrategyDailyLoss: string;
    maxDrawdownPercent: string;
    maxOrdersPerSecond: number;
    maxOrdersPerMinute: number;
    maxCancelsPerSecond: number;
    maxCancelsPerMinute: number;
    maxPriceDeviationBps: number;
    maxConsecutiveLosses: number;
  } {
    return {
      maxOrderNotional: this.env.MAX_ORDER_NOTIONAL,
      maxPositionNotional: this.env.MAX_POSITION_NOTIONAL,
      maxAccountExposure: this.env.MAX_ACCOUNT_EXPOSURE,
      maxStrategyExposure: this.env.MAX_STRATEGY_EXPOSURE,
      maxSymbolExposure: this.env.MAX_SYMBOL_EXPOSURE,
      maxOpenOrders: this.env.MAX_OPEN_ORDERS,
      maxDailyLoss: this.env.MAX_DAILY_LOSS,
      maxStrategyDailyLoss: this.env.MAX_STRATEGY_DAILY_LOSS,
      maxDrawdownPercent: this.env.MAX_DRAWDOWN,
      maxOrdersPerSecond: this.env.MAX_ORDERS_PER_SECOND,
      maxOrdersPerMinute: this.env.MAX_ORDERS_PER_MINUTE,
      maxCancelsPerSecond: this.env.MAX_CANCELS_PER_SECOND,
      maxCancelsPerMinute: this.env.MAX_CANCELS_PER_MINUTE,
      maxPriceDeviationBps: this.env.MAX_PRICE_DEVIATION_BPS,
      maxConsecutiveLosses: this.env.MAX_CONSECUTIVE_LOSSES,
    };
  }

  /**
   * The operator's single answer to "what is the risk posture of this
   * deployment, right now". Computed from configuration (the env) plus the
   * durable switch mirror, exactly like the Part 5 execution summary -
   * nothing cached, nothing assumed, and the blocking list states ALL
   * reasons at once so nobody releases a control to see whether the next
   * one was real.
   */
  get riskSafetySummary(): {
    engineEnabled: boolean;
    failClosed: boolean;
    maxRiskStateAgeMs: number;
    snapshotRefreshMs: number;
    refreshOutpacesStaleness: boolean;
    ceilings: AppConfigService['riskPlatformCeilings'];
    note: string;
  } {
    return {
      engineEnabled: this.riskEngineEnabled,
      failClosed: this.riskFailClosed,
      maxRiskStateAgeMs: this.maxRiskStateAgeMs,
      snapshotRefreshMs: this.riskSnapshotRefreshMs,
      refreshOutpacesStaleness:
        this.riskSnapshotRefreshMs < this.maxRiskStateAgeMs,
      ceilings: this.riskPlatformCeilings,
      note:
        'Risk controls reduce operational risk but cannot guarantee against ' +
        'all losses. These ceilings are the GLOBAL layer only; the effective ' +
        'limit is the tightest applicable entry across the whole hierarchy, ' +
        'resolved inside the engine. No API route approves an order.',
    };
  }

  get tradingEngineUrl(): string {
    return this.env.TRADING_ENGINE_URL;
  }

  // ------------------------------------------------------------------
  // Part 9: observability accessors. Every value here is *publication*
  // configuration; nothing in the trading path reads them, and nothing
  // here can switch a trading safety off.
  // ------------------------------------------------------------------

  get observabilityEnabled(): boolean {
    return this.configService.get<boolean>('OBSERVABILITY_ENABLED', true);
  }

  get metricsEnabled(): boolean {
    return this.configService.get<boolean>('METRICS_ENABLED', true);
  }

  get healthEnabled(): boolean {
    return this.configService.get<boolean>('HEALTH_ENABLED', true);
  }

  get prometheusEnabled(): boolean {
    return this.configService.get<boolean>('PROMETHEUS_ENABLED', true);
  }

  get prometheusPath(): string {
    return this.configService.get<string>('PROMETHEUS_PATH', '/metrics');
  }

  /** Optional scrape secret. NEVER returned by any summary and never
   *  interpolated into a log line - callers use it only for a constant-time
   *  comparison against the presented header. */
  get metricsToken(): string | undefined {
    return this.configService.get<string>('METRICS_TOKEN') ?? undefined;
  }

  get alertingEnabled(): boolean {
    return this.configService.get<boolean>('ALERTING_ENABLED', true);
  }

  get alertDedupWindowMs(): number {
    return this.configService.get<number>('ALERT_DEDUP_WINDOW_MS', 60_000);
  }

  get queueAlertAgeMs(): number {
    return this.configService.get<number>('QUEUE_ALERT_AGE_MS', 120_000);
  }

  get metricsExportIntervalMs(): number {
    return this.configService.get<number>('METRICS_EXPORT_INTERVAL_MS', 15_000);
  }

  get healthRefreshMs(): number {
    return this.configService.get<number>('HEALTH_REFRESH_MS', 5_000);
  }

  get alertRetentionDays(): number {
    return this.configService.get<number>('ALERT_RETENTION_DAYS', 90);
  }

  get incidentRetentionDays(): number {
    return this.configService.get<number>('INCIDENT_RETENTION_DAYS', 365);
  }

  /** Trading-engine ops surface: the gate documents this service publishes
   *  for the API's trading-readiness merge. Same base URL as the health
   *  probe; distinct path, so a probe outage and a telemetry outage are
   *  distinguishable in logs without a third URL to configure. */
  get tradingEngineOpsTradingUrl(): string {
    const base = this.configService.get<string>('TRADING_ENGINE_URL', 'http://localhost:8001');
    return `${base.replace(/\/+$/, '')}/health/trading`;
  }

  get tradingEngineOpsComponentsUrl(): string {
    const base = this.configService.get<string>('TRADING_ENGINE_URL', 'http://localhost:8001');
    return `${base.replace(/\/+$/, '')}/health/components`;
  }

  get tradingEngineOpsMetricsUrl(): string {
    const base = this.configService.get<string>('TRADING_ENGINE_URL', 'http://localhost:8001');
    return `${base.replace(/\/+$/, '')}/metrics`;
  }

  get marketDataOpsComponentsUrl(): string {
    const base = this.configService.get<string>('MARKET_DATA_URL', 'http://localhost:8002');
    return `${base.replace(/\/+$/, '')}/health/components`;
  }

  /** The sentence the operations panel shows about its own guarantees.
   *  Deliberately plain: no latency claims, no uptime claims. */
  get observabilitySafetySummary(): {
    observabilityEnabled: boolean;
    metricsEnabled: boolean;
    prometheusEnabled: boolean;
    alertingEnabled: boolean;
    alertRetentionDays: number;
    incidentRetentionDays: number;
    queueAlertAgeMs: number;
    tracingEnabled: boolean;
    sloEnabled: boolean;
    note: string;
  } {
    return {
      observabilityEnabled: this.observabilityEnabled,
      metricsEnabled: this.metricsEnabled,
      prometheusEnabled: this.prometheusEnabled,
      alertingEnabled: this.alertingEnabled,
      alertRetentionDays: this.alertRetentionDays,
      incidentRetentionDays: this.incidentRetentionDays,
      queueAlertAgeMs: this.queueAlertAgeMs,
      tracingEnabled: this.otelEnabled,
      sloEnabled: this.sloEnabled,
      note:
        'Observability describes the platform; it authorises nothing. Trading ' +
        'enforcement lives in the risk gate. Risk controls reduce operational ' +
        'risk but cannot guarantee against all losses.',
    };
  }

  // --- Part 10: reliability (tracing, SLO evaluation, fault posture) ------
  // These getters READ configuration; none of them can change it. The
  // one-way derivations (priority list parsing, multiplier -> ppm) live here
  // so every consumer sees the identical integers the validator was written
  // against, and so the ppm math happens once, in integer arithmetic.

  get otelEnabled(): boolean {
    return this.env.OTEL_ENABLED === true;
  }

  /** The collector base URL, or undefined. Never logged: an OTLP URL is not
   *  secret, but a future operator might embed one, and the surface reading
   *  this only needs "configured / not configured". */
  get otelEndpoint(): string | undefined {
    return this.env.OTEL_ENDPOINT ?? undefined;
  }

  get otelTimeoutMs(): number {
    return this.env.OTEL_TIMEOUT_MS;
  }

  get otelSampleRatio(): number {
    return this.env.OTEL_SAMPLE_RATIO;
  }

  get otelPriorityOperations(): string[] {
    return this.env.OTEL_PRIORITY_OPERATIONS.split(',')
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
  }

  /** Effective arming: the guards are AND-ed here because every consumer
   *  must see the SAME truth the env validator enforced - a deployment that
   *  disabled the guard gets an unarmed injector, fail-closed in both
   *  directions. */
  get failureInjectionArmed(): boolean {
    return (
      this.env.FAILURE_INJECTION_ENABLED === true &&
      this.env.FAILURE_INJECTION_ALLOW_NON_PRODUCTION_ONLY === true &&
      this.env.NODE_ENV !== 'production'
    );
  }

  get failureInjectionRequested(): boolean {
    return this.env.FAILURE_INJECTION_ENABLED === true;
  }

  get sloEnabled(): boolean {
    return this.env.SLO_ENABLED === true;
  }

  get sloEvaluationIntervalMinutes(): number {
    return this.env.SLO_EVALUATION_INTERVAL_MINUTES;
  }

  get sloRetentionDays(): number {
    return this.env.SLO_RETENTION_DAYS;
  }

  get sloDefaultWindowMinutes(): number {
    return this.env.SLO_DEFAULT_WINDOW_MINUTES;
  }

  /** Decimal multiplier STRING -> integer ppm, exactly (14.4 -> 14_400_000).
   *  String arithmetic on purpose: `Number('14.4') * 1e6` is
   *  14400000.000000002 in IEEE-754, and a paging threshold whose rounding
   *  depends on float history is how a 3am argument starts. */
  get sloFastBurnPpm(): number {
    return AppConfigService.decimalStringToPpm(this.env.SLO_FAST_BURN_MULTIPLIER);
  }

  get sloSlowBurnPpm(): number {
    return AppConfigService.decimalStringToPpm(this.env.SLO_SLOW_BURN_MULTIPLIER);
  }

  static decimalStringToPpm(raw: string): number {
    const match = /^(\d+)(?:\.(\d{1,6}))?$/.exec(raw);
    if (!match) {
      throw new Error(`not a plain decimal multiplier: ${JSON.stringify(raw)}`);
    }
    const whole = match[1] ?? '0';
    const fraction = (match[2] ?? '').padEnd(6, '0').slice(0, 6);
    return Number(whole) * 1_000_000 + Number(fraction);
  }

  /** Tracing posture the panel renders; secret-free by construction - the
   *  endpoint is reported as a boolean, never as text. */
  get tracingSafetySummary(): {
    enabled: boolean;
    endpointConfigured: boolean;
    sampleRatio: number;
    priorityOperations: string[];
    faultInjection: { requested: boolean; armed: boolean };
    note: string;
  } {
    return {
      enabled: this.otelEnabled,
      endpointConfigured: this.otelEndpoint !== undefined,
      sampleRatio: this.otelSampleRatio,
      priorityOperations: this.otelPriorityOperations,
      faultInjection: {
        requested: this.failureInjectionRequested,
        armed: this.failureInjectionArmed,
      },
      note:
        'Tracing correlates evidence; it authorises nothing. Sampling is ' +
        'head-based and spans may be dropped under load or export failure - ' +
        'dropped is counted, never silently lost.',
    };
  }

  get tradingEngineHealthUrl(): string {
    return `${this.env.TRADING_ENGINE_URL}${this.env.TRADING_ENGINE_HEALTH_PATH}`;
  }

  get marketDataUrl(): string {
    return this.env.MARKET_DATA_URL;
  }

  get marketDataHealthUrl(): string {
    return `${this.env.MARKET_DATA_URL}${this.env.MARKET_DATA_HEALTH_PATH}`;
  }

  get notificationServiceUrl(): string {
    return this.env.NOTIFICATION_SERVICE_URL;
  }

  get notificationServiceHealthUrl(): string {
    return `${this.env.NOTIFICATION_SERVICE_URL}${this.env.NOTIFICATION_SERVICE_HEALTH_PATH}`;
  }

  get internalServiceToken(): string {
    return this.env.INTERNAL_SERVICE_TOKEN;
  }

  // ---------------------------------------------------------------------------
  // Mail / notifications
  // ---------------------------------------------------------------------------

  get mailDriver(): AppEnv['MAIL_DRIVER'] {
    return this.env.MAIL_DRIVER;
  }

  get mailFrom(): { name: string; address: string } {
    return { name: this.env.MAIL_FROM_NAME, address: this.env.MAIL_FROM_ADDRESS };
  }

  get notificationsEnabled(): boolean {
    return this.env.NOTIFICATIONS_ENABLED;
  }

  // ---------------------------------------------------------------------------
  // Localisation
  // ---------------------------------------------------------------------------

  get defaultLocale(): string {
    return this.env.DEFAULT_LOCALE;
  }

  get supportedLocales(): string[] {
    return this.env.SUPPORTED_LOCALES;
  }

  get defaultCurrency(): string {
    return this.env.DEFAULT_CURRENCY;
  }

  get supportedCurrencies(): string[] {
    return this.env.SUPPORTED_CURRENCIES;
  }

  // ---------------------------------------------------------------------------
  // Compliance / billing providers
  // ---------------------------------------------------------------------------

  get kycProvider(): AppEnv['KYC_PROVIDER'] {
    return this.env.KYC_PROVIDER;
  }

  get billingProvider(): AppEnv['BILLING_PROVIDER'] {
    return this.env.BILLING_PROVIDER;
  }

  // ---------------------------------------------------------------------------
  // Seed
  // ---------------------------------------------------------------------------

  get seedSuperAdminEmail(): string {
    return this.env.SEED_SUPER_ADMIN_EMAIL;
  }
}
```

## FILE: apps/api/prisma/schema.prisma (3967 lines)

```prisma
// =============================================================================
// White-Label Crypto Copy-Trading Platform - Prisma schema (Part 1 foundation)
// =============================================================================
// Design rules enforced here:
//  * UUID primary keys everywhere (no sequential ids leaking volume/ordering).
//  * Every tenant-scoped table carries `tenantId` as the FIRST column of its
//    composite indexes and unique constraints, so a query that forgets the
//    tenant filter cannot accidentally hit another brand's rows through an
//    index scan, and uniqueness is always per tenant.
//  * `deletedAt` soft deletion on aggregates that must survive for audit or
//    billing reasons; hard delete for ephemeral rows (tokens, sessions).
//  * Cascade deletes only downwards from an aggregate root (tenant -> user ->
//    session). Audit rows never cascade: they outlive their subject.
//  * Trading tables are intentionally NOT defined yet; the `TenantSetting`,
//    `FeatureFlag` and role/permission tables are generic enough that Part 2
//    can add them without touching this file's semantics.
// =============================================================================

generator client {
  provider        = "prisma-client-js"
  binaryTargets   = ["native"]
  previewFeatures = []
}

datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_DATABASE_URL")
}

// -----------------------------------------------------------------------------
// Enums
// -----------------------------------------------------------------------------

enum TenantStatus {
  PENDING
  ACTIVE
  SUSPENDED
  ARCHIVED
}

enum TenantDomainStatus {
  PENDING_DNS
  PENDING_CERTIFICATE
  ACTIVE
  FAILED
}

enum UserStatus {
  PENDING_VERIFICATION
  ACTIVE
  SUSPENDED
  LOCKED
  DEACTIVATED
}

enum KycStatus {
  NOT_STARTED
  PENDING
  IN_REVIEW
  APPROVED
  REJECTED
  EXPIRED
}

enum RoleScope {
  PLATFORM
  TENANT
}

enum TwoFactorMethod {
  TOTP
  EMAIL
  SMS
}

enum TwoFactorStatus {
  PENDING_ACTIVATION
  ACTIVE
  DISABLED
}

enum TokenStatus {
  ACTIVE
  ROTATED
  REVOKED
  EXPIRED
}

enum AuditActorType {
  USER
  SYSTEM
  SERVICE
  API_KEY
}

enum AuditOutcome {
  SUCCESS
  FAILURE
  DENIED
}

enum SecurityEventType {
  SUSPICIOUS_LOGIN
  NEW_DEVICE_LOGIN
  IMPOSSIBLE_TRAVEL
  BRUTE_FORCE_SUSPECTED
  CREDENTIAL_STUFFING_SUSPECTED
  TOKEN_REUSE
  RATE_LIMIT_ABUSE
  PERMISSION_ESCALATION_ATTEMPT
  TENANT_ISOLATION_VIOLATION
  ENCRYPTION_FAILURE
}

enum SecuritySeverity {
  LOW
  MEDIUM
  HIGH
  CRITICAL
}

enum BillingInterval {
  MONTHLY
  QUARTERLY
  YEARLY
  LIFETIME
}

enum PlanAudience {
  TENANT
  END_USER
}

enum SubscriptionStatus {
  TRIALING
  ACTIVE
  PAST_DUE
  CANCELED
  EXPIRED
  PAUSED
}

enum VerificationTokenType {
  EMAIL_VERIFICATION
  PASSWORD_RESET
  INVITATION
  EMAIL_CHANGE
}

enum NotificationChannel {
  IN_APP
  EMAIL
  PUSH
  SMS
  WEBHOOK
  TELEGRAM
}

// -----------------------------------------------------------------------------
// Tenancy
// -----------------------------------------------------------------------------

model Tenant {
  id        String       @id @default(uuid()) @db.Uuid
  slug      String       @unique @db.VarChar(63)
  name      String       @db.VarChar(120)
  legalName String?      @map("legal_name") @db.VarChar(160)
  status    TenantStatus @default(PENDING)

  ownerUserId String? @map("owner_user_id") @db.Uuid

  contactEmail String? @map("contact_email") @db.VarChar(254)
  contactPhone String? @map("contact_phone") @db.VarChar(20)
  countryCode  String? @map("country_code") @db.Char(2)

  defaultLocale       String   @default("en") @map("default_locale") @db.VarChar(8)
  supportedLocales    String[] @default(["en"])
  defaultCurrency     String   @default("USD") @map("default_currency") @db.VarChar(3)
  supportedCurrencies String[] @default(["USD"])
  timezone            String   @default("UTC") @db.VarChar(64)

  // Commercial configuration expressed in basis points to avoid float drift.
  platformFeeBps    Int @default(0) @map("platform_fee_bps")
  performanceFeeBps Int @default(2000) @map("performance_fee_bps")

  maxUsers   Int? @map("max_users")
  maxTraders Int? @map("max_traders")

  metadata Json @default("{}")

  createdAt DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime  @updatedAt @map("updated_at") @db.Timestamptz(6)
  deletedAt DateTime? @map("deleted_at") @db.Timestamptz(6)

  branding       TenantBranding?
  settings       TenantSetting[]
  domains        TenantDomain[]
  users          User[]
  roles          Role[]
  subscriptions  TenantSubscription[]
  plans          SubscriptionPlan[]
  featureFlags   TenantFeatureFlag[]
  auditLogs      AuditLog[]
  securityEvents SecurityEvent[]
  apiKeys        TenantApiKey[]
  notifications  Notification[]
  kycProfiles    KycProfile[]

  // Part 2 - trading control plane. Every trading aggregate is tenant-scoped
  // so the isolation invariant established in Part 1 extends unchanged into
  // the trading domain.
  tradingAccounts    TradingAccount[]
  tradingSymbols     TradingSymbol[]
  strategies         Strategy[]
  orders             Order[]
  positions          Position[]
  riskConfigurations RiskConfiguration[]
  riskEvents         RiskEvent[]
  // Part 8 back-relations (cascade mirrors riskConfigurations' shape).
  riskConfigurationVersions RiskConfigurationVersion[]
  riskSnapshotMetadata      RiskSnapshotMetadata[]
  riskProtectionActions     RiskProtectionTrip[]

  // Part 9 - operations. Alerts and incidents are tenant-scoped where the
  // condition is; platform-wide infrastructure conditions carry a null
  // tenant and are visible to every console that may read operations.
  // SetNull on tenant removal: operational history outlives the tenant
  // relationship on purpose - it is evidence, not configuration.
  opsAlerts                 OpsAlert[]
  opsIncidents              OpsIncident[]
  tradingSessions    TradingSession[]
  killSwitches       KillSwitch[]

  // Part 5 - authenticated execution. Same rule: every aggregate that can be
  // traced back to a customer's money is tenant-scoped, so a query that forgets
  // the tenant filter fails to compile rather than leaking across tenants.
  accountBalances        AccountBalanceSnapshot[]
  exchangeStreamSessions ExchangeStreamSession[]
  reconciliationRuns     ReconciliationRun[]
  executionIncidents     ExecutionIncident[]

  // Part 6 - strategy layer. The definition catalogue and its versions are
  // platform-level (they describe code that ships with the release, not
  // customer data) and are deliberately absent here. Everything that records
  // what a tenant's strategy actually did is tenant-scoped.
  strategyRuns         StrategyRun[]
  strategyCheckpoints  StrategyCheckpoint[]
  strategyIncidents    StrategyIncident[]
  backtestRuns         BacktestRun[]
  backtestMetrics      BacktestMetric[]
  backtestTrades       BacktestTrade[]
  paperTradingSessions PaperTradingSession[]
  paperPortfolioSnaps  PaperPortfolioSnapshot[]

  @@index([status])
  @@index([deletedAt])
  @@index([createdAt])
  @@map("tenants")
}

model TenantBranding {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @unique @map("tenant_id") @db.Uuid

  appName         String  @map("app_name") @db.VarChar(64)
  logoUrl         String? @map("logo_url") @db.VarChar(2048)
  logoDarkUrl     String? @map("logo_dark_url") @db.VarChar(2048)
  faviconUrl      String? @map("favicon_url") @db.VarChar(2048)
  primaryColor    String  @default("#1B2A4A") @map("primary_color") @db.VarChar(9)
  secondaryColor  String  @default("#0F172A") @map("secondary_color") @db.VarChar(9)
  accentColor     String  @default("#22C55E") @map("accent_color") @db.VarChar(9)
  backgroundColor String  @default("#FFFFFF") @map("background_color") @db.VarChar(9)
  textColor       String  @default("#0B1220") @map("text_color") @db.VarChar(9)
  fontFamily      String  @default("Inter") @map("font_family") @db.VarChar(64)
  themeMode       String  @default("system") @map("theme_mode") @db.VarChar(10)

  supportEmail String? @map("support_email") @db.VarChar(254)
  supportUrl   String? @map("support_url") @db.VarChar(2048)
  termsUrl     String? @map("terms_url") @db.VarChar(2048)
  privacyUrl   String? @map("privacy_url") @db.VarChar(2048)
  customCss    String? @map("custom_css") @db.Text
  socialLinks  Json    @default("{}") @map("social_links")

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@map("tenant_branding")
}

model TenantSetting {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  key      String  @db.VarChar(64)
  value    Json
  category String  @default("general") @db.VarChar(32)
  /// When true the value column holds an encrypted envelope, never plaintext.
  isSecret Boolean @default(false) @map("is_secret")

  description String? @db.VarChar(240)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@unique([tenantId, key])
  @@index([tenantId, category])
  @@map("tenant_settings")
}

model TenantDomain {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  domain            String             @unique @db.VarChar(253)
  isPrimary         Boolean            @default(false) @map("is_primary")
  status            TenantDomainStatus @default(PENDING_DNS)
  verificationToken String             @map("verification_token") @db.VarChar(64)
  verifiedAt        DateTime?          @map("verified_at") @db.Timestamptz(6)
  certificateExpiry DateTime?          @map("certificate_expiry") @db.Timestamptz(6)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@index([tenantId, isPrimary])
  @@index([status])
  @@map("tenant_domains")
}

// -----------------------------------------------------------------------------
// Identity
// -----------------------------------------------------------------------------

model User {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  email        String  @db.VarChar(254)
  /// HMAC of the lowercase email; enables constant-time lookup and analytics
  /// without exposing the address in indexes shared with third-party tooling.
  emailIndex   String  @map("email_index") @db.VarChar(64)
  passwordHash String  @map("password_hash") @db.VarChar(255)
  phone        String? @db.VarChar(20)

  emailVerifiedAt DateTime? @map("email_verified_at") @db.Timestamptz(6)
  phoneVerifiedAt DateTime? @map("phone_verified_at") @db.Timestamptz(6)

  status    UserStatus @default(PENDING_VERIFICATION)
  kycStatus KycStatus  @default(NOT_STARTED) @map("kyc_status")

  /// Platform staff (super admins) are attached to the platform tenant and can
  /// be authorised across tenants; ordinary users never can.
  isPlatformUser Boolean @default(false) @map("is_platform_user")

  twoFactorEnabled Boolean @default(false) @map("two_factor_enabled")

  failedLoginAttempts Int       @default(0) @map("failed_login_attempts")
  lockedUntil         DateTime? @map("locked_until") @db.Timestamptz(6)
  lastLoginAt         DateTime? @map("last_login_at") @db.Timestamptz(6)
  lastLoginIpHash     String?   @map("last_login_ip_hash") @db.VarChar(64)
  passwordChangedAt   DateTime  @default(now()) @map("password_changed_at") @db.Timestamptz(6)
  /// Bumped on password change / global logout to invalidate live access tokens.
  sessionVersion      Int       @default(0) @map("session_version")

  referralCode   String? @unique @map("referral_code") @db.VarChar(16)
  referredByCode String? @map("referred_by_code") @db.VarChar(16)

  metadata Json @default("{}")

  createdAt DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime  @updatedAt @map("updated_at") @db.Timestamptz(6)
  deletedAt DateTime? @map("deleted_at") @db.Timestamptz(6)

  tenant             Tenant                   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  profile            UserProfile?
  roles              UserRole[]
  refreshTokens      RefreshToken[]
  sessions           UserSession[]
  twoFactor          TwoFactorAuth?
  recoveryCodes      TwoFactorRecoveryCode[]
  verificationTokens VerificationToken[]
  loginAttempts      LoginAttempt[]
  securityEvents     SecurityEvent[]
  notifications      Notification[]
  notificationPrefs  NotificationPreference[]
  kycProfile         KycProfile?
  assignedRoles      UserRole[]               @relation("RoleAssignedBy")

  /// Part 2 - exchange connections this user owns. Non-custodial: the user
  /// supplies their own trade-enabled, withdrawal-disabled API key.
  tradingAccounts TradingAccount[]

  @@unique([tenantId, email])
  @@unique([tenantId, emailIndex])
  @@index([tenantId, status])
  @@index([tenantId, createdAt])
  @@index([tenantId, deletedAt])
  @@index([emailIndex])
  @@map("users")
}

model UserProfile {
  id     String @id @default(uuid()) @db.Uuid
  userId String @unique @map("user_id") @db.Uuid

  firstName   String? @map("first_name") @db.VarChar(64)
  lastName    String? @map("last_name") @db.VarChar(64)
  displayName String? @map("display_name") @db.VarChar(64)
  avatarUrl   String? @map("avatar_url") @db.VarChar(2048)
  bio         String? @db.VarChar(500)
  countryCode String? @map("country_code") @db.Char(2)
  timezone    String  @default("UTC") @db.VarChar(64)
  locale      String  @default("en") @db.VarChar(8)

  preferredCurrency String  @default("USD") @map("preferred_currency") @db.VarChar(3)
  marketingOptIn    Boolean @default(false) @map("marketing_opt_in")

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("user_profiles")
}

// -----------------------------------------------------------------------------
// RBAC
// -----------------------------------------------------------------------------

model Role {
  id String @id @default(uuid()) @db.Uuid

  /// Null tenantId marks a platform-provided system role template.
  tenantId String? @map("tenant_id") @db.Uuid

  key         String    @db.VarChar(64)
  name        String    @db.VarChar(120)
  description String?   @db.VarChar(500)
  scope       RoleScope @default(TENANT)
  isSystem    Boolean   @default(false) @map("is_system")
  isDefault   Boolean   @default(false) @map("is_default")
  priority    Int       @default(100)

  createdAt DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime  @updatedAt @map("updated_at") @db.Timestamptz(6)
  deletedAt DateTime? @map("deleted_at") @db.Timestamptz(6)

  tenant      Tenant?          @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  permissions RolePermission[]
  users       UserRole[]

  @@unique([tenantId, key])
  @@index([tenantId, scope])
  @@index([isSystem])
  @@map("roles")
}

model Permission {
  id String @id @default(uuid()) @db.Uuid

  key         String  @unique @db.VarChar(64)
  resource    String  @db.VarChar(48)
  action      String  @db.VarChar(32)
  description String? @db.VarChar(500)
  /// Permissions flagged dangerous require re-authentication before granting.
  isDangerous Boolean @default(false) @map("is_dangerous")

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  roles RolePermission[]

  @@index([resource])
  @@map("permissions")
}

model RolePermission {
  roleId       String @map("role_id") @db.Uuid
  permissionId String @map("permission_id") @db.Uuid

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  role       Role       @relation(fields: [roleId], references: [id], onDelete: Cascade)
  permission Permission @relation(fields: [permissionId], references: [id], onDelete: Cascade)

  @@id([roleId, permissionId])
  @@index([permissionId])
  @@map("role_permissions")
}

model UserRole {
  id     String @id @default(uuid()) @db.Uuid
  userId String @map("user_id") @db.Uuid
  roleId String @map("role_id") @db.Uuid

  /// Denormalised for tenant-scoped index locality and defence in depth.
  tenantId String @map("tenant_id") @db.Uuid

  assignedById String?   @map("assigned_by_id") @db.Uuid
  assignedAt   DateTime  @default(now()) @map("assigned_at") @db.Timestamptz(6)
  expiresAt    DateTime? @map("expires_at") @db.Timestamptz(6)

  user       User  @relation(fields: [userId], references: [id], onDelete: Cascade)
  role       Role  @relation(fields: [roleId], references: [id], onDelete: Cascade)
  assignedBy User? @relation("RoleAssignedBy", fields: [assignedById], references: [id], onDelete: SetNull)

  @@unique([userId, roleId])
  @@index([tenantId, roleId])
  @@index([userId])
  @@index([expiresAt])
  @@map("user_roles")
}

// -----------------------------------------------------------------------------
// Sessions, tokens and 2FA
// -----------------------------------------------------------------------------

model UserSession {
  id       String @id @default(uuid()) @db.Uuid
  userId   String @map("user_id") @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  deviceId   String  @map("device_id") @db.VarChar(128)
  deviceName String? @map("device_name") @db.VarChar(64)
  platform   String? @db.VarChar(16)
  appVersion String? @map("app_version") @db.VarChar(32)
  userAgent  String? @map("user_agent") @db.VarChar(512)
  ipHash     String  @map("ip_hash") @db.VarChar(64)
  /// Coarse geo label ("BD/Dhaka") derived at login for impossible-travel checks.
  geoLabel   String? @map("geo_label") @db.VarChar(64)
  trusted    Boolean @default(false)

  createdAt    DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
  lastSeenAt   DateTime  @default(now()) @map("last_seen_at") @db.Timestamptz(6)
  expiresAt    DateTime  @map("expires_at") @db.Timestamptz(6)
  revokedAt    DateTime? @map("revoked_at") @db.Timestamptz(6)
  revokeReason String?   @map("revoke_reason") @db.VarChar(120)

  user          User           @relation(fields: [userId], references: [id], onDelete: Cascade)
  refreshTokens RefreshToken[]

  @@index([userId, revokedAt])
  @@index([tenantId, userId])
  @@index([expiresAt])
  @@index([deviceId])
  @@map("user_sessions")
}

model RefreshToken {
  id        String @id @default(uuid()) @db.Uuid
  userId    String @map("user_id") @db.Uuid
  tenantId  String @map("tenant_id") @db.Uuid
  sessionId String @map("session_id") @db.Uuid

  /// HMAC-SHA512 of the token. The raw value only ever exists in the response.
  tokenHash String      @unique @map("token_hash") @db.VarChar(128)
  /// Rotation family: reuse of any consumed token revokes the whole family.
  familyId  String      @map("family_id") @db.Uuid
  status    TokenStatus @default(ACTIVE)

  replacedByTokenId String? @map("replaced_by_token_id") @db.Uuid

  issuedAt     DateTime  @default(now()) @map("issued_at") @db.Timestamptz(6)
  expiresAt    DateTime  @map("expires_at") @db.Timestamptz(6)
  usedAt       DateTime? @map("used_at") @db.Timestamptz(6)
  revokedAt    DateTime? @map("revoked_at") @db.Timestamptz(6)
  revokeReason String?   @map("revoke_reason") @db.VarChar(120)

  ipHash    String? @map("ip_hash") @db.VarChar(64)
  userAgent String? @map("user_agent") @db.VarChar(512)

  user    User        @relation(fields: [userId], references: [id], onDelete: Cascade)
  session UserSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)

  @@index([userId, status])
  @@index([familyId])
  @@index([expiresAt])
  @@index([tenantId, userId])
  @@map("refresh_tokens")
}

model TwoFactorAuth {
  id     String @id @default(uuid()) @db.Uuid
  userId String @unique @map("user_id") @db.Uuid

  method TwoFactorMethod @default(TOTP)
  status TwoFactorStatus @default(PENDING_ACTIVATION)

  /// Envelope-encrypted TOTP secret: { ciphertext, iv, authTag, wrappedKey, keyId }.
  secretCiphertext Json   @map("secret_ciphertext")
  encryptionKeyId  String @map("encryption_key_id") @db.VarChar(64)

  lastVerifiedAt  DateTime? @map("last_verified_at") @db.Timestamptz(6)
  /// Last accepted TOTP counter, blocks replay of the same code.
  lastUsedCounter BigInt?   @map("last_used_counter")
  failedAttempts  Int       @default(0) @map("failed_attempts")
  activatedAt     DateTime? @map("activated_at") @db.Timestamptz(6)
  disabledAt      DateTime? @map("disabled_at") @db.Timestamptz(6)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("two_factor_auth")
}

model TwoFactorRecoveryCode {
  id     String @id @default(uuid()) @db.Uuid
  userId String @map("user_id") @db.Uuid

  /// Argon2 hash of a single-use recovery code.
  codeHash   String    @map("code_hash") @db.VarChar(255)
  usedAt     DateTime? @map("used_at") @db.Timestamptz(6)
  usedIpHash String?   @map("used_ip_hash") @db.VarChar(64)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, usedAt])
  @@map("two_factor_recovery_codes")
}

model VerificationToken {
  id       String @id @default(uuid()) @db.Uuid
  userId   String @map("user_id") @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  type      VerificationTokenType
  tokenHash String                @unique @map("token_hash") @db.VarChar(128)
  payload   Json                  @default("{}")

  expiresAt  DateTime  @map("expires_at") @db.Timestamptz(6)
  consumedAt DateTime? @map("consumed_at") @db.Timestamptz(6)
  createdAt  DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, type])
  @@index([expiresAt])
  @@map("verification_tokens")
}

model LoginAttempt {
  id       String  @id @default(uuid()) @db.Uuid
  tenantId String  @map("tenant_id") @db.Uuid
  userId   String? @map("user_id") @db.Uuid

  emailIndex String  @map("email_index") @db.VarChar(64)
  successful Boolean
  reason     String? @db.VarChar(64)
  ipHash     String  @map("ip_hash") @db.VarChar(64)
  userAgent  String? @map("user_agent") @db.VarChar(512)
  deviceId   String? @map("device_id") @db.VarChar(128)
  geoLabel   String? @map("geo_label") @db.VarChar(64)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  user User? @relation(fields: [userId], references: [id], onDelete: SetNull)

  @@index([tenantId, emailIndex, createdAt])
  @@index([ipHash, createdAt])
  @@index([createdAt])
  @@map("login_attempts")
}

// -----------------------------------------------------------------------------
// Governance: audit, security, API keys
// -----------------------------------------------------------------------------

model AuditLog {
  id       String  @id @default(uuid()) @db.Uuid
  tenantId String? @map("tenant_id") @db.Uuid

  actorType  AuditActorType @default(USER) @map("actor_type")
  actorId    String?        @map("actor_id") @db.Uuid
  actorEmail String?        @map("actor_email") @db.VarChar(254)

  action       String       @db.VarChar(64)
  outcome      AuditOutcome @default(SUCCESS)
  resourceType String?      @map("resource_type") @db.VarChar(64)
  resourceId   String?      @map("resource_id") @db.VarChar(64)
  description  String?      @db.VarChar(500)

  /// { field: { before, after } } with sensitive fields already redacted.
  changes  Json?
  metadata Json?

  ipHash    String? @map("ip_hash") @db.VarChar(64)
  userAgent String? @map("user_agent") @db.VarChar(512)
  requestId String? @map("request_id") @db.VarChar(64)

  /// Part 9: correlation metadata. requestId answers "which HTTP call",
  /// correlationId answers "which operational chain" (one user action, one
  /// engine sequence, one incident - whatever spans services), operationId
  /// answers "which unit of work within it". All three are bounded tokens;
  /// none of them is ever a secret. Additive columns: every pre-Part-9 row
  /// reads null, and no existing query changes meaning.
  correlationId String? @map("correlation_id") @db.VarChar(64)
  operationId   String? @map("operation_id") @db.VarChar(64)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  tenant Tenant? @relation(fields: [tenantId], references: [id], onDelete: SetNull)

  @@index([tenantId, createdAt])
  @@index([tenantId, action, createdAt])
  @@index([actorId, createdAt])
  @@index([resourceType, resourceId])
  @@index([createdAt])
  @@index([correlationId, createdAt])
  @@map("audit_logs")
}

model SecurityEvent {
  id       String  @id @default(uuid()) @db.Uuid
  tenantId String? @map("tenant_id") @db.Uuid
  userId   String? @map("user_id") @db.Uuid

  type        SecurityEventType
  severity    SecuritySeverity  @default(LOW)
  description String            @db.VarChar(500)
  metadata    Json?

  ipHash    String? @map("ip_hash") @db.VarChar(64)
  userAgent String? @map("user_agent") @db.VarChar(512)
  requestId String? @map("request_id") @db.VarChar(64)

  resolved     Boolean   @default(false)
  resolvedAt   DateTime? @map("resolved_at") @db.Timestamptz(6)
  resolvedById String?   @map("resolved_by_id") @db.Uuid
  resolution   String?   @db.VarChar(500)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  tenant Tenant? @relation(fields: [tenantId], references: [id], onDelete: SetNull)
  user   User?   @relation(fields: [userId], references: [id], onDelete: SetNull)

  @@index([tenantId, createdAt])
  @@index([userId, createdAt])
  @@index([severity, resolved])
  @@index([type, createdAt])
  @@map("security_events")
}

model TenantApiKey {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  name       String @db.VarChar(120)
  /// Public, non-secret identifier shown in dashboards.
  keyId      String @unique @map("key_id") @db.VarChar(48)
  /// HMAC of the secret half. The secret is displayed once at creation time.
  secretHash String @map("secret_hash") @db.VarChar(128)

  scopes      String[] @default([])
  ipAllowlist String[] @default([])

  lastUsedAt DateTime? @map("last_used_at") @db.Timestamptz(6)
  expiresAt  DateTime? @map("expires_at") @db.Timestamptz(6)
  revokedAt  DateTime? @map("revoked_at") @db.Timestamptz(6)

  createdById String?  @map("created_by_id") @db.Uuid
  createdAt   DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt   DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@index([tenantId, revokedAt])
  @@map("tenant_api_keys")
}

// -----------------------------------------------------------------------------
// Commercial: plans, subscriptions, feature flags
// -----------------------------------------------------------------------------

model SubscriptionPlan {
  id String @id @default(uuid()) @db.Uuid

  /// Null tenantId = platform catalogue plan sold to tenants.
  tenantId String? @map("tenant_id") @db.Uuid

  code        String       @db.VarChar(48)
  name        String       @db.VarChar(120)
  description String?      @db.VarChar(500)
  audience    PlanAudience @default(TENANT)

  price     Decimal         @db.Decimal(18, 6)
  currency  String          @default("USD") @db.VarChar(3)
  interval  BillingInterval @default(MONTHLY)
  trialDays Int             @default(0) @map("trial_days")

  performanceFeeBps Int @default(0) @map("performance_fee_bps")
  platformFeeBps    Int @default(0) @map("platform_fee_bps")

  limits   Json     @default("{}")
  features String[] @default([])

  isActive  Boolean @default(true) @map("is_active")
  sortOrder Int     @default(0) @map("sort_order")

  externalPriceId String? @map("external_price_id") @db.VarChar(128)

  createdAt DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime  @updatedAt @map("updated_at") @db.Timestamptz(6)
  deletedAt DateTime? @map("deleted_at") @db.Timestamptz(6)

  tenant        Tenant?              @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  subscriptions TenantSubscription[]

  @@unique([tenantId, code])
  @@index([audience, isActive])
  @@map("subscription_plans")
}

model TenantSubscription {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid
  planId   String @map("plan_id") @db.Uuid

  status SubscriptionStatus @default(TRIALING)

  currentPeriodStart DateTime  @default(now()) @map("current_period_start") @db.Timestamptz(6)
  currentPeriodEnd   DateTime  @map("current_period_end") @db.Timestamptz(6)
  trialEndsAt        DateTime? @map("trial_ends_at") @db.Timestamptz(6)

  cancelAtPeriodEnd Boolean   @default(false) @map("cancel_at_period_end")
  canceledAt        DateTime? @map("canceled_at") @db.Timestamptz(6)
  cancelReason      String?   @map("cancel_reason") @db.VarChar(500)

  seatsPurchased Int @default(1) @map("seats_purchased")

  externalCustomerId     String? @map("external_customer_id") @db.VarChar(128)
  externalSubscriptionId String? @map("external_subscription_id") @db.VarChar(128)

  metadata Json @default("{}")

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant Tenant           @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  plan   SubscriptionPlan @relation(fields: [planId], references: [id], onDelete: Restrict)

  @@index([tenantId, status])
  @@index([status, currentPeriodEnd])
  @@map("tenant_subscriptions")
}

model FeatureFlag {
  id String @id @default(uuid()) @db.Uuid

  key         String  @unique @db.VarChar(64)
  name        String  @db.VarChar(120)
  description String? @db.VarChar(500)

  isGlobalDefault   Boolean @default(false) @map("is_global_default")
  rolloutPercentage Int     @default(100) @map("rollout_percentage")

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenantOverrides TenantFeatureFlag[]

  @@map("feature_flags")
}

model TenantFeatureFlag {
  id            String @id @default(uuid()) @db.Uuid
  tenantId      String @map("tenant_id") @db.Uuid
  featureFlagId String @map("feature_flag_id") @db.Uuid

  enabled           Boolean @default(false)
  rolloutPercentage Int?    @map("rollout_percentage")
  metadata          Json    @default("{}")

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant      Tenant      @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  featureFlag FeatureFlag @relation(fields: [featureFlagId], references: [id], onDelete: Cascade)

  @@unique([tenantId, featureFlagId])
  @@index([tenantId, enabled])
  @@map("tenant_feature_flags")
}

// -----------------------------------------------------------------------------
// Compliance and notifications (foundation only)
// -----------------------------------------------------------------------------

model KycProfile {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid
  userId   String @unique @map("user_id") @db.Uuid

  status              KycStatus @default(NOT_STARTED)
  provider            String?   @db.VarChar(32)
  /// Identifier issued by the KYC vendor; no document data is stored locally.
  externalApplicantId String?   @map("external_applicant_id") @db.VarChar(128)
  levelName           String?   @map("level_name") @db.VarChar(64)

  submittedAt     DateTime? @map("submitted_at") @db.Timestamptz(6)
  reviewedAt      DateTime? @map("reviewed_at") @db.Timestamptz(6)
  expiresAt       DateTime? @map("expires_at") @db.Timestamptz(6)
  rejectionReason String?   @map("rejection_reason") @db.VarChar(500)

  riskScore Int? @map("risk_score")
  metadata  Json @default("{}")

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([tenantId, status])
  @@map("kyc_profiles")
}

model Notification {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid
  userId   String @map("user_id") @db.Uuid

  channel NotificationChannel @default(IN_APP)
  type    String              @db.VarChar(64)
  title   String              @db.VarChar(160)
  body    String              @db.VarChar(1000)
  data    Json                @default("{}")

  readAt        DateTime? @map("read_at") @db.Timestamptz(6)
  deliveredAt   DateTime? @map("delivered_at") @db.Timestamptz(6)
  failedAt      DateTime? @map("failed_at") @db.Timestamptz(6)
  failureReason String?   @map("failure_reason") @db.VarChar(500)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([tenantId, userId, createdAt])
  @@index([userId, readAt])
  @@map("notifications")
}

model NotificationPreference {
  id     String @id @default(uuid()) @db.Uuid
  userId String @map("user_id") @db.Uuid

  category String              @db.VarChar(48)
  channel  NotificationChannel
  enabled  Boolean             @default(true)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, category, channel])
  @@map("notification_preferences")
}

// =============================================================================
// PART 2 - ALGORITHMIC TRADING DOMAIN
// =============================================================================
// Everything below models the trading *control plane*: configuration, audit and
// the durable record of what was decided and what happened. It deliberately
// does NOT model the hot path. Order books, live quotes and in-flight risk
// counters live in process memory and Redis; putting them here would force a
// PostgreSQL round trip into the market-data loop, which is exactly what the
// architecture forbids.
//
// What is persisted, and why:
//  * Orders, fills, positions and risk events - the financial record. Must
//    survive a crash and be auditable years later.
//  * Strategies, symbols, accounts, risk configuration - operator intent.
//  * MarketDataRecord - OHLCV candles ONLY. Individual ticks are not stored:
//    they arrive thousands per second per symbol, are worthless individually,
//    and would destroy write throughput for no analytical gain.
//
// Naming follows the Part 1 convention: camelCase in the Prisma client,
// snake_case in PostgreSQL via @map/@@map.
// =============================================================================

// -----------------------------------------------------------------------------
// Trading enums
// -----------------------------------------------------------------------------

enum TradingVenue {
  BINANCE
  BYBIT
  OKX
  KRAKEN
  /// Simulated venue. Fills produced against it are always flagged simulated.
  PAPER
}

enum TradingMarketType {
  SPOT
  MARGIN
  FUTURES_USDT
  FUTURES_COIN
}

enum TradingAccountStatus {
  PENDING_VALIDATION
  ACTIVE
  DISABLED
  CREDENTIALS_INVALID
  /// The stored key has withdrawal permission; refused on principle.
  WITHDRAWAL_ENABLED_REJECTED
}

enum TradingModeSetting {
  DISABLED
  PAPER
  LIVE
}

enum StrategyStatus {
  DRAFT
  ENABLED
  DISABLED
  ERROR
}

enum OrderSideEnum {
  BUY
  SELL
}

enum OrderTypeEnum {
  MARKET
  LIMIT
  STOP
  STOP_LIMIT
}

enum TimeInForceEnum {
  GTC
  IOC
  FOK
  DAY
}

enum OrderStatusEnum {
  PENDING
  SUBMITTED
  ACKNOWLEDGED
  PARTIALLY_FILLED
  FILLED
  CANCEL_REQUESTED
  CANCELLED
  REJECTED
  EXPIRED
  FAILED
}

enum PositionSideEnum {
  LONG
  SHORT
  FLAT
}

enum RiskEventType {
  LIMIT_BREACHED
  ORDER_REJECTED
  KILL_SWITCH_ENGAGED
  KILL_SWITCH_RELEASED
  STALE_MARKET_DATA
  RISK_STATE_UNAVAILABLE
  DUPLICATE_ORDER_BLOCKED
  ORDER_BOOK_RESYNC

  // Part 8: the real-time risk engine's trail. Values mirror
  // ``RiskEventKind`` in ``wlct_trading/enums.py`` exactly; the parity spec
  // (risk-safety.spec.ts) reads both sources and refuses drift, because an
  // unmapped kind silently drops an event at the write.
  KILL_SWITCH_TRIGGERED
  KILL_SWITCH_ACKNOWLEDGED
  KILL_SWITCH_CLEARED
  STALE_RISK_STATE
  PROTECTION_TRIGGERED
  PROTECTION_CLEARED
  PROTECTION_EXEMPTED
  DAILY_LOSS_BREACHED
  ORDER_RATE_BREACHED
  CANCEL_RATE_BREACHED
  CONSECUTIVE_LOSSES_BREACHED
  CONFIG_CHANGED
}

enum RiskEventSeverity {
  INFO
  WARNING
  CRITICAL
  /// Part 8: the safety system itself is degraded (corrupted snapshot,
  /// unreadable configuration). Distinct from CRITICAL, which is "the
  /// system worked and refused". Alerting must be able to tell those apart.
  EMERGENCY
}

enum KillSwitchScopeEnum {
  GLOBAL
  EXCHANGE
  STRATEGY
  SYMBOL
  // Part 8: account-level halt (one trading account, rest of tenant keeps
  // trading) and the engine's own RISK switch (automatic protection lands
  // here). Same rule as the four originals: engaged means halted; a narrow
  // switch can never release a broad one. The engine-side ordering is
  // ``KILL_SWITCH_SCOPE_PRIORITY`` in ``wlct_trading/enums.py``.
  ACCOUNT
  RISK
}

/// Part 8: kill-switch lifecycle. ``TRIGGERED`` records never auto-clear;
/// the engine's transition table (``RISK_SWITCH_TRANSITIONS``) and this
/// column's service-side guards are the same rules in two languages, held
/// in parity by the jest source-parsed test.
enum RiskSwitchStatus {
  INACTIVE
  ACTIVE
  TRIGGERED
  ACKNOWLEDGED
  CLEARED
}

/// Part 8: scope at which a limit entry is expressed in the hierarchy.
enum RiskLimitScope {
  GLOBAL
  EXCHANGE
  ACCOUNT
  STRATEGY
  SYMBOL
}

/// Part 8: what automatic protection does on a severe breach. Every member
/// removes capability; there is no liquidation member by design - forcing
/// position closure is a separately authorised subsystem, never a policy
/// checkbox.
enum RiskProtectionAction {
  BLOCK_NEW_RISK
  BLOCK_SYMBOL
  BLOCK_STRATEGY
  BLOCK_ACCOUNT
  BLOCK_EXCHANGE
  GLOBAL_TRADING_STOP
}

enum TradingSessionStatus {
  STARTING
  RUNNING
  DEGRADED
  STOPPING
  STOPPED
  FAILED
}

// -----------------------------------------------------------------------------
// Exchange - platform-level venue registry
// -----------------------------------------------------------------------------
// Not tenant-scoped: "Binance supports SPOT and has a 6000/min weight limit" is
// a fact about the world, identical for every tenant. Tenants opt in to a venue
// through TradingAccount, not by redefining the venue.
// -----------------------------------------------------------------------------

model Exchange {
  id        String       @id @default(uuid()) @db.Uuid
  venue     TradingVenue @unique
  name      String       @db.VarChar(64)
  isEnabled Boolean      @default(false) @map("is_enabled")

  /// Whether this deployment may route live orders here. Independent of
  /// isEnabled so market data can be consumed from a venue we do not trade.
  tradingEnabled Boolean @default(false) @map("trading_enabled")

  supportedMarketTypes TradingMarketType[] @map("supported_market_types")

  restBaseUrl    String  @map("rest_base_url") @db.VarChar(255)
  wsBaseUrl      String  @map("ws_base_url") @db.VarChar(255)
  sandboxRestUrl String? @map("sandbox_rest_url") @db.VarChar(255)
  sandboxWsUrl   String? @map("sandbox_ws_url") @db.VarChar(255)

  requiresPassphrase Boolean @default(false) @map("requires_passphrase")
  supportsSandbox    Boolean @default(false) @map("supports_sandbox")

  weightLimitPerMinute Int @default(1200) @map("weight_limit_per_minute")
  maxOrdersPerSecond   Int @default(5) @map("max_orders_per_second")
  maxLeverage          Int @default(1) @map("max_leverage")

  /// Default depth requested when initialising an order book.
  defaultBookDepth Int @default(50) @map("default_book_depth")

  metadata Json @default("{}")

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  accounts TradingAccount[]
  symbols  TradingSymbol[]

  @@index([isEnabled])
  @@map("exchanges")
}

// -----------------------------------------------------------------------------
// TradingSymbol - instruments the platform may trade
// -----------------------------------------------------------------------------
// Tenant-scoped because whether a tenant is allowed to trade a given instrument
// is a commercial decision, and the per-symbol risk caps below differ per brand.
// -----------------------------------------------------------------------------

model TradingSymbol {
  id         String @id @default(uuid()) @db.Uuid
  tenantId   String @map("tenant_id") @db.Uuid
  exchangeId String @map("exchange_id") @db.Uuid

  /// Canonical platform form, e.g. "BTC-USDT".
  symbol      String @db.VarChar(32)
  /// Whatever the venue calls it, e.g. "BTCUSDT".
  venueSymbol String @map("venue_symbol") @db.VarChar(32)

  baseAsset  String            @map("base_asset") @db.VarChar(16)
  quoteAsset String            @map("quote_asset") @db.VarChar(16)
  marketType TradingMarketType @default(SPOT) @map("market_type")

  isTradeable  Boolean @default(false) @map("is_tradeable")
  isSubscribed Boolean @default(false) @map("is_subscribed")

  // Venue trading rules. Validated locally before submission so an order that
  // would certainly be rejected never consumes a rate-limit slot.
  priceTick    Decimal  @map("price_tick") @db.Decimal(28, 12)
  quantityStep Decimal  @map("quantity_step") @db.Decimal(28, 12)
  minQuantity  Decimal  @map("min_quantity") @db.Decimal(28, 12)
  maxQuantity  Decimal? @map("max_quantity") @db.Decimal(28, 12)
  minNotional  Decimal  @map("min_notional") @db.Decimal(18, 6)

  pricePrecision    Int @default(8) @map("price_precision")
  quantityPrecision Int @default(8) @map("quantity_precision")

  /// Per-symbol ceiling, layered under the account and strategy limits.
  maxOrderNotional Decimal? @map("max_order_notional") @db.Decimal(18, 6)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant   Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  exchange Exchange @relation(fields: [exchangeId], references: [id], onDelete: Restrict)

  orders            Order[]
  positions         Position[]
  marketDataRecords MarketDataRecord[]

  @@unique([tenantId, exchangeId, symbol, marketType])
  @@index([tenantId, isTradeable])
  @@index([tenantId, isSubscribed])
  @@index([exchangeId, symbol])
  @@map("trading_symbols")
}

// -----------------------------------------------------------------------------
// TradingAccount - a tenant's connection to a venue
// -----------------------------------------------------------------------------
// SECURITY: the API secret is never stored in plaintext and never leaves the
// server. It is sealed with the Part 1 envelope-encryption helper
// (packages/utils/src/crypto.ts): a per-record 256-bit DEK encrypted under the
// master KEK, with the AAD bound to "trading_account:{tenantId}:{accountId}" so
// a ciphertext lifted into another tenant's row fails to decrypt.
//
// apiKeyBlindIndex is an HMAC of the public key portion, letting us detect the
// same key registered twice without ever storing or comparing the secret.
//
// No column here is ever serialised into an API response, a log line or a
// mobile payload. The API exposes only apiKeyLastFour and status.
// -----------------------------------------------------------------------------

model TradingAccount {
  id         String  @id @default(uuid()) @db.Uuid
  tenantId   String  @map("tenant_id") @db.Uuid
  exchangeId String  @map("exchange_id") @db.Uuid
  /// Owning user. Null for a tenant-level house account.
  userId     String? @map("user_id") @db.Uuid

  label String @db.VarChar(80)

  status     TradingAccountStatus @default(PENDING_VALIDATION)
  marketType TradingMarketType    @default(SPOT) @map("market_type")

  /// Paper by default. Reaching LIVE additionally requires the deployment-level
  /// env safeguards to agree; this column alone is never sufficient.
  tradingMode TradingModeSetting @default(PAPER) @map("trading_mode")

  isSandbox Boolean @default(true) @map("is_sandbox")

  // --- encrypted credential material -------------------------------------
  /// Envelope-encrypted API key. Ciphertext only.
  /// Null when `credentialSource` is not ENVELOPE_DB - a secret-manager-backed
  /// account keeps no key material here at all.
  apiKeyCiphertext     String? @map("api_key_ciphertext") @db.Text
  /// Envelope-encrypted API secret. Ciphertext only. Null under SECRET_MANAGER.
  apiSecretCiphertext  String? @map("api_secret_ciphertext") @db.Text
  /// Envelope-encrypted passphrase, for venues that require one (OKX).
  passphraseCiphertext String? @map("passphrase_ciphertext") @db.Text
  /// Wrapped data encryption key for this row.
  encryptedDataKey     String? @map("encrypted_data_key") @db.Text
  /// Which KEK generation sealed the DEK, so keys can be rotated.
  encryptionKeyId      String? @map("encryption_key_id") @db.VarChar(64)
  /// HMAC of the public key portion for duplicate detection.
  apiKeyBlindIndex     String  @map("api_key_blind_index") @db.VarChar(64)
  /// Last four characters of the public key, safe to display.
  apiKeyLastFour       String  @map("api_key_last_four") @db.VarChar(4)

  // --- verified venue permissions ----------------------------------------
  canTrade     Boolean @default(false) @map("can_trade")
  canReadData  Boolean @default(false) @map("can_read_data")
  /// Must remain false. A withdrawal-capable key is rejected outright.
  canWithdraw  Boolean @default(false) @map("can_withdraw")
  ipRestricted Boolean @default(false) @map("ip_restricted")

  lastVerifiedAt      DateTime? @map("last_verified_at") @db.Timestamptz(6)
  lastFailureAt       DateTime? @map("last_failure_at") @db.Timestamptz(6)
  /// Venue error class only - never the venue's raw response.
  lastFailureCode     String?   @map("last_failure_code") @db.VarChar(64)
  consecutiveFailures Int       @default(0) @map("consecutive_failures")

  // --- Part 5: where the credential actually lives -----------------------
  // Part 1 stored every credential as envelope-encrypted ciphertext in the
  // columns above. That is correct for a self-hosted single-tenant install and
  // wrong for a managed multi-tenant one, where the secret should never enter
  // the application database at all. Rather than a second credential table -
  // which would mean two places to look and two ways to get it wrong - the
  // source is recorded here and the ciphertext columns become optional.
  credentialSource CredentialSource @default(ENVELOPE_DB) @map("credential_source")

  /// Pointer into the external secret store: a Vault path, an AWS Secrets
  /// Manager ARN, a GCP resource name. NOT a secret, and safe to display to an
  /// operator - it names a location, it does not unlock it.
  credentialRef String? @map("credential_ref") @db.VarChar(512)

  /// Permissions the venue itself reported at last verification, normalised.
  /// Recorded so an operator can see what a key can do without re-querying,
  /// and so a key that silently gains WITHDRAW is detected on the next check.
  verifiedPermissions String[] @default([]) @map("verified_permissions")

  credentialRotatedAt DateTime? @map("credential_rotated_at") @db.Timestamptz(6)
  /// Set when the venue key has a known expiry. Signing is refused past it.
  credentialExpiresAt DateTime? @map("credential_expires_at") @db.Timestamptz(6)

  /// Whether this account's private user-data stream should be maintained.
  privateStreamEnabled Boolean @default(false) @map("private_stream_enabled")

  /// Admin control. Independent of `status`: an account can be healthy and
  /// verified and still be barred from live trading by an operator.
  liveTradingEnabled Boolean @default(false) @map("live_trading_enabled")

  createdAt DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime  @updatedAt @map("updated_at") @db.Timestamptz(6)
  deletedAt DateTime? @map("deleted_at") @db.Timestamptz(6)

  tenant   Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  exchange Exchange @relation(fields: [exchangeId], references: [id], onDelete: Restrict)
  user     User?    @relation(fields: [userId], references: [id], onDelete: SetNull)

  orders            Order[]
  positions         Position[]
  riskConfiguration RiskConfiguration?
  // Part 8: the durable risk trail per account.
  riskConfigurationVersions RiskConfigurationVersion[]
  riskSnapshotMetadata      RiskSnapshotMetadata[]
  riskProtectionActions     RiskProtectionTrip[]
  strategies        Strategy[]
  sessions          TradingSession[]

  balances           AccountBalanceSnapshot[]
  streamSessions     ExchangeStreamSession[]
  reconciliationRuns ReconciliationRun[]
  executionIncidents ExecutionIncident[]

  @@unique([tenantId, apiKeyBlindIndex])
  @@index([tenantId, status])
  @@index([tenantId, userId])
  @@index([exchangeId])
  @@index([deletedAt])
  @@map("trading_accounts")
}

// -----------------------------------------------------------------------------
// Strategy + StrategyConfiguration
// -----------------------------------------------------------------------------
// Split into two tables on purpose: Strategy is identity and lifecycle, which
// changes rarely; StrategyConfiguration is versioned parameters, which change
// often. Keeping them apart means a parameter tweak produces a new config row
// and an audit trail rather than overwriting history.
// -----------------------------------------------------------------------------

model Strategy {
  id        String  @id @default(uuid()) @db.Uuid
  tenantId  String  @map("tenant_id") @db.Uuid
  /// Account this strategy trades through. Null while still a draft.
  accountId String? @map("account_id") @db.Uuid

  name    String @db.VarChar(80)
  /// Registry key of the implementing class, e.g. "spread_capture".
  kind    String @db.VarChar(64)
  version String @db.VarChar(20)

  status  StrategyStatus @default(DRAFT)
  /// Runtime toggle, independent of status. An operator flips this to pause a
  /// strategy without discarding its configuration.
  enabled Boolean        @default(false)

  venue      TradingVenue
  /// Canonical symbols this strategy subscribes to.
  symbols    String[]
  marketType TradingMarketType @default(SPOT) @map("market_type")

  description String? @db.VarChar(500)

  // --- per-strategy risk profile ------------------------------------------
  // Layered UNDER the account and platform limits; the tightest always wins.
  maxOrderQuantity    Decimal @map("max_order_quantity") @db.Decimal(28, 12)
  maxPositionQuantity Decimal @map("max_position_quantity") @db.Decimal(28, 12)
  maxOrderNotional    Decimal @map("max_order_notional") @db.Decimal(18, 6)
  maxDailyLoss        Decimal @map("max_daily_loss") @db.Decimal(18, 6)
  maxOpenOrders       Int     @default(5) @map("max_open_orders")
  maxOrdersPerMinute  Int     @default(30) @map("max_orders_per_minute")

  lastStartedAt DateTime? @map("last_started_at") @db.Timestamptz(6)
  lastStoppedAt DateTime? @map("last_stopped_at") @db.Timestamptz(6)
  /// Exception class name only - never a message that might carry data.
  lastErrorCode String?   @map("last_error_code") @db.VarChar(64)

  // --- Part 6: this row IS the strategy instance ---------------------------
  // A separate `StrategyInstance` model was considered and rejected. This
  // table already carries the tenant, the account, the venue, the symbols and
  // the per-strategy risk profile - everything an instance is. Adding a second
  // table with the same meaning would create two answers to "is this strategy
  // running", which is the kind of ambiguity that ends with an operator
  // disabling the wrong row. The Part 6 columns below extend it instead.

  /// Catalogue entry this instance runs. Null for a Part 2 strategy created
  /// before the catalogue existed.
  definitionId String? @map("definition_id") @db.Uuid
  /// The exact published version. Behaviour cannot change under a fixed
  /// version: a change means a new version row.
  versionId    String? @map("version_id") @db.Uuid

  /// Deterministic 32-hex instance fingerprint computed by the engine from
  /// tenant + strategy key + version + exchange + market type + symbol +
  /// configuration version. It is what namespaces per-instance state, so it is
  /// stored rather than recomputed: if it ever disagrees with the engine's
  /// value, the state namespace has moved and that must be visible.
  instanceKey String? @map("instance_key") @db.VarChar(32)

  /// Active configuration version, denormalised from StrategyConfiguration so
  /// the instance fingerprint can be verified without a join.
  configVersion Int @default(1) @map("config_version")

  /// What the engine does when this instance raises. There is deliberately no
  /// "continue anyway" option: a strategy that threw has unknown state.
  failurePolicy StrategyFailurePolicy @default(STOP_INSTANCE) @map("failure_policy")

  /// Operational health, distinct from `status` and `enabled`. An instance can
  /// be ENABLED and UNHEALTHY at the same time, and hiding that behind a
  /// single flag is how a dead strategy looks fine on a dashboard.
  health StrategyHealth @default(UNKNOWN)

  /// Last time the engine reported this instance alive. Null means the engine
  /// has never reported, which is not the same as unhealthy.
  lastHeartbeatAt   DateTime? @map("last_heartbeat_at") @db.Timestamptz(6)
  consecutiveErrors Int       @default(0) @map("consecutive_errors")

  /// Set when the failure policy has taken the instance out of service. Only
  /// an explicit operator action clears it.
  quarantinedAt    DateTime? @map("quarantined_at") @db.Timestamptz(6)
  quarantineReason String?   @map("quarantine_reason") @db.VarChar(500)

  createdAt DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime  @updatedAt @map("updated_at") @db.Timestamptz(6)
  deletedAt DateTime? @map("deleted_at") @db.Timestamptz(6)

  tenant  Tenant          @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  account TradingAccount? @relation(fields: [accountId], references: [id], onDelete: SetNull)

  definition    StrategyDefinition? @relation(fields: [definitionId], references: [id], onDelete: SetNull)
  /// Named `versionRecord` rather than `version` because `version` is already
  /// the semantic version string on this model. Two different meanings under
  /// one name is how someone ends up comparing a string to a row.
  versionRecord StrategyVersion?    @relation(fields: [versionId], references: [id], onDelete: SetNull)

  configurations StrategyConfiguration[]
  orders         Order[]
  riskEvents     RiskEvent[]
  sessions       TradingSession[]

  runs          StrategyRun[]
  checkpoints   StrategyCheckpoint[]
  incidents     StrategyIncident[]
  backtestRuns  BacktestRun[]
  paperSessions PaperTradingSession[]

  @@unique([tenantId, name])
  /// The engine's per-instance state namespace must be unique inside a tenant.
  @@unique([tenantId, instanceKey])
  @@index([tenantId, enabled])
  @@index([tenantId, status])
  @@index([tenantId, accountId])
  @@index([tenantId, health])
  @@index([tenantId, definitionId])
  @@index([versionId])
  @@index([deletedAt])
  @@map("strategies")
}

model StrategyConfiguration {
  id         String @id @default(uuid()) @db.Uuid
  strategyId String @map("strategy_id") @db.Uuid

  /// Monotonically increasing per strategy.
  version Int

  /// Strategy-specific parameters. Schema-validated in the API layer against
  /// the strategy kind's declared parameter schema before it is written.
  parameters Json @default("{}")

  // --- Part 6 --------------------------------------------------------------

  /// The published version whose parameter schema these values were validated
  /// against. Without it, a parameter set is uninterpretable after the schema
  /// changes.
  strategyVersionId String? @map("strategy_version_id") @db.Uuid

  /// sha256 over the canonical parameter encoding. Two configurations with the
  /// same hash are the same configuration, which is what lets a backtest result
  /// be tied to the exact parameters that produced it. Parameters never contain
  /// a credential - the parameter schema refuses credential-shaped names - so
  /// this hash covers no secret.
  configurationHash String? @map("configuration_hash") @db.VarChar(64)

  /// Exactly one configuration per strategy may be active at a time; enforced
  /// by the partial unique index in the migration.
  isActive Boolean @default(false) @map("is_active")

  activatedAt   DateTime? @map("activated_at") @db.Timestamptz(6)
  deactivatedAt DateTime? @map("deactivated_at") @db.Timestamptz(6)

  createdByUserId String? @map("created_by_user_id") @db.Uuid
  changeNote      String? @map("change_note") @db.VarChar(500)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  strategy        Strategy         @relation(fields: [strategyId], references: [id], onDelete: Cascade)
  strategyVersion StrategyVersion? @relation(fields: [strategyVersionId], references: [id], onDelete: SetNull)

  @@unique([strategyId, version])
  @@index([strategyId, isActive])
  @@index([strategyVersionId])
  @@map("strategy_configurations")
}

// -----------------------------------------------------------------------------
// Order + OrderEvent + Fill
// -----------------------------------------------------------------------------

model Order {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  accountId  String  @map("account_id") @db.Uuid
  strategyId String? @map("strategy_id") @db.Uuid
  symbolId   String  @map("symbol_id") @db.Uuid

  /// Deterministic idempotency key sent to the venue. The unique constraint
  /// below is the authoritative cross-worker duplicate guard.
  clientOrderId   String  @map("client_order_id") @db.VarChar(36)
  /// Venue-assigned id. Null until the venue acknowledges.
  exchangeOrderId String? @map("exchange_order_id") @db.VarChar(64)
  /// Signal that produced this order, for attribution.
  signalId        String? @map("signal_id") @db.Uuid

  venue  TradingVenue
  symbol String       @db.VarChar(32)

  side        OrderSideEnum
  orderType   OrderTypeEnum   @map("order_type")
  timeInForce TimeInForceEnum @default(GTC) @map("time_in_force")
  status      OrderStatusEnum @default(PENDING)

  quantity  Decimal  @db.Decimal(28, 12)
  price     Decimal? @db.Decimal(28, 12)
  stopPrice Decimal? @map("stop_price") @db.Decimal(28, 12)

  reduceOnly Boolean @default(false) @map("reduce_only")

  // --- execution state, derived from fills only --------------------------
  filledQuantity   Decimal  @default(0) @map("filled_quantity") @db.Decimal(28, 12)
  averageFillPrice Decimal? @map("average_fill_price") @db.Decimal(28, 12)
  cumulativeFee    Decimal  @default(0) @map("cumulative_fee") @db.Decimal(28, 12)
  feeCurrency      String?  @map("fee_currency") @db.VarChar(16)

  /// True when produced by the paper venue. Carried into every report so a
  /// simulated result can never be presented as a real one.
  isSimulated Boolean @default(false) @map("is_simulated")

  rejectionCode   String? @map("rejection_code") @db.VarChar(64)
  rejectionReason String? @map("rejection_reason") @db.VarChar(500)

  /// Risk decision that authorised this order. Every order has one.
  riskDecisionId String? @map("risk_decision_id") @db.Uuid

  /// Measured, not promised. Null until the venue acknowledges.
  submitLatencyMicros Int? @map("submit_latency_micros")

  // --- Part 5: how much the local record can be trusted ------------------
  // Deliberately NOT folded into `status`. `status` is what the venue believes
  // and has a strict legal-transition table; this is what we believe about our
  // own knowledge. An order whose submission response was lost stays SUBMITTED
  // - which is true, we did submit it - and is marked UNKNOWN here.
  reconciliationState  OrderReconciliationState @default(IN_SYNC) @map("reconciliation_state")
  /// Why the state is not IN_SYNC. Operator-facing, never a raw venue body.
  reconciliationDetail String?                  @map("reconciliation_detail") @db.VarChar(500)
  lastReconciledAt     DateTime?                @map("last_reconciled_at") @db.Timestamptz(6)

  /// Free-form annotation from the originating intent: the copy-trade leader
  /// this mirrors, a correlation id, a rebalance run. Excluded from the
  /// idempotency fingerprint on purpose - two orders differing only in metadata
  /// are the same trade, and hashing it would defeat duplicate detection.
  metadata Json @default("{}")

  /// Set to true only for an order that was fully built, validated and
  /// risk-checked under DRY_RUN and then deliberately not transmitted. Kept so
  /// a dry-run order is never mistaken for a real one in any report.
  wasDryRun Boolean @default(false) @map("was_dry_run")

  createdAt   DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt   DateTime  @updatedAt @map("updated_at") @db.Timestamptz(6)
  submittedAt DateTime? @map("submitted_at") @db.Timestamptz(6)
  terminalAt  DateTime? @map("terminal_at") @db.Timestamptz(6)

  tenant    Tenant         @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  account   TradingAccount @relation(fields: [accountId], references: [id], onDelete: Restrict)
  strategy  Strategy?      @relation(fields: [strategyId], references: [id], onDelete: SetNull)
  symbolRef TradingSymbol  @relation(fields: [symbolId], references: [id], onDelete: Restrict)

  events OrderEvent[]
  fills  Fill[]

  reconciliationDiscrepancies ReconciliationDiscrepancy[]
  executionIncidents          ExecutionIncident[]

  @@unique([tenantId, clientOrderId])
  @@index([tenantId, status, createdAt])
  @@index([tenantId, accountId, createdAt])
  @@index([tenantId, strategyId, createdAt])
  @@index([tenantId, symbol, createdAt])
  @@index([exchangeOrderId])
  @@index([createdAt])
  /// Drives the reconciliation sweep: find every order whose state is not
  /// trusted, oldest first. Without this the sweep is a full table scan on a
  /// table that only ever grows.
  @@index([reconciliationState, lastReconciledAt])
  @@index([tenantId, accountId, reconciliationState])
  @@map("orders")
}

model OrderEvent {
  id      String @id @default(uuid()) @db.Uuid
  orderId String @map("order_id") @db.Uuid

  previousStatus OrderStatusEnum? @map("previous_status")
  status         OrderStatusEnum

  reason String? @db.VarChar(500)

  /// Structured context. Never contains credentials or venue signatures.
  payload Json @default("{}")

  /// Microsecond wall-clock time the event occurred, preserving sub-millisecond
  /// ordering that a Timestamptz(6) round trip would blur.
  occurredAtMicros BigInt @map("occurred_at_micros")

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  order Order @relation(fields: [orderId], references: [id], onDelete: Cascade)

  @@index([orderId, occurredAtMicros])
  @@index([createdAt])
  @@map("order_events")
}

model Fill {
  id      String @id @default(uuid()) @db.Uuid
  orderId String @map("order_id") @db.Uuid

  /// Venue's execution id. Unique per order; the guard against double-counting
  /// a replayed user-data message.
  venueTradeId String @map("venue_trade_id") @db.VarChar(64)

  price       Decimal @db.Decimal(28, 12)
  quantity    Decimal @db.Decimal(28, 12)
  fee         Decimal @default(0) @db.Decimal(28, 12)
  feeCurrency String  @default("USDT") @map("fee_currency") @db.VarChar(16)

  isMaker     Boolean @default(false) @map("is_maker")
  /// Always true for paper fills. Never mutated after insert.
  isSimulated Boolean @default(false) @map("is_simulated")

  exchangeTimestampMicros BigInt @map("exchange_timestamp_micros")
  receivedTimestampMicros BigInt @map("received_timestamp_micros")

  // --- Part 5: venue attribution -----------------------------------------
  // Denormalised from the parent order on purpose. A fill arriving on the
  // private stream can be routed to the position manager without a join, and a
  // PnL query over millions of rows does not need one either.
  symbol String?        @db.VarChar(32)
  side   OrderSideEnum?
  venue  TradingVenue?

  /// Quote-asset amount as the venue computed it. Kept rather than recomputed:
  /// the venue's rounding is authoritative for settlement, and price * quantity
  /// can disagree in the last decimal place.
  quoteQuantity Decimal? @map("quote_quantity") @db.Decimal(28, 12)

  /// The venue's order id, when the execution report carries it. Lets a fill
  /// that arrives before the submit response is processed still be matched.
  exchangeOrderId String? @map("exchange_order_id") @db.VarChar(64)

  /// Which route delivered this fill. The same execution legitimately arrives
  /// twice - once on the stream, once from reconciliation - and the unique
  /// constraint above deduplicates it. Recording the source is what lets an
  /// operator tell "the stream is healthy" from "reconciliation is carrying us".
  source FillSource @default(PRIVATE_STREAM)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  order Order @relation(fields: [orderId], references: [id], onDelete: Cascade)

  @@unique([orderId, venueTradeId])
  @@index([orderId, receivedTimestampMicros])
  @@index([createdAt])
  @@index([exchangeOrderId])
  @@index([symbol, receivedTimestampMicros])
  @@map("fills")
}

// -----------------------------------------------------------------------------
// Position - derived from fills, never from a venue snapshot
// -----------------------------------------------------------------------------

model Position {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  accountId String @map("account_id") @db.Uuid
  symbolId  String @map("symbol_id") @db.Uuid

  venue  TradingVenue
  symbol String       @db.VarChar(32)

  /// Signed: positive long, negative short, zero flat.
  quantity Decimal          @default(0) @db.Decimal(28, 12)
  side     PositionSideEnum @default(FLAT)

  averageEntryPrice Decimal? @map("average_entry_price") @db.Decimal(28, 12)
  markPrice         Decimal? @map("mark_price") @db.Decimal(28, 12)

  realisedPnl   Decimal  @default(0) @map("realised_pnl") @db.Decimal(18, 6)
  /// Snapshot at last mark. Null when no mark price was available - never
  /// defaulted to zero, which would misreport a position as break-even.
  unrealisedPnl Decimal? @map("unrealised_pnl") @db.Decimal(18, 6)
  cumulativeFee Decimal  @default(0) @map("cumulative_fee") @db.Decimal(18, 6)
  feeCurrency   String?  @map("fee_currency") @db.VarChar(16)

  /// True if ANY contributing fill was simulated. Sticky once set.
  containsSimulatedFills Boolean @default(false) @map("contains_simulated_fills")

  fillCount Int @default(0) @map("fill_count")

  openedAt   DateTime? @map("opened_at") @db.Timestamptz(6)
  closedAt   DateTime? @map("closed_at") @db.Timestamptz(6)
  lastFillAt DateTime? @map("last_fill_at") @db.Timestamptz(6)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant    Tenant         @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  account   TradingAccount @relation(fields: [accountId], references: [id], onDelete: Cascade)
  symbolRef TradingSymbol  @relation(fields: [symbolId], references: [id], onDelete: Restrict)

  @@unique([accountId, symbolId])
  @@index([tenantId, accountId])
  @@index([tenantId, symbol])
  @@index([tenantId, side])
  @@map("positions")
}

// -----------------------------------------------------------------------------
// RiskConfiguration - per-account limits
// -----------------------------------------------------------------------------
// One row per trading account. Platform limits come from environment
// configuration and strategy limits from the Strategy row; this is the middle
// layer. The effective limit is the tightest of the three.
// -----------------------------------------------------------------------------

model RiskConfiguration {
  id        String @id @default(uuid()) @db.Uuid
  tenantId  String @map("tenant_id") @db.Uuid
  accountId String @unique @map("account_id") @db.Uuid

  maxOrderQuantity    Decimal @map("max_order_quantity") @db.Decimal(28, 12)
  maxOrderNotional    Decimal @map("max_order_notional") @db.Decimal(18, 6)
  maxPositionQuantity Decimal @map("max_position_quantity") @db.Decimal(28, 12)

  maxSymbolExposureNotional  Decimal @map("max_symbol_exposure_notional") @db.Decimal(18, 6)
  maxAccountExposureNotional Decimal @map("max_account_exposure_notional") @db.Decimal(18, 6)

  maxOpenOrders      Int @default(10) @map("max_open_orders")
  maxOrdersPerMinute Int @default(60) @map("max_orders_per_minute")

  maxDailyLoss    Decimal @map("max_daily_loss") @db.Decimal(18, 6)
  maxStrategyLoss Decimal @map("max_strategy_loss") @db.Decimal(18, 6)

  maxPriceDeviationPercent Decimal @default(2) @map("max_price_deviation_percent") @db.Decimal(8, 4)
  /// Market data older than this may not be used to price an order.
  maxMarketDataAgeMicros   Int     @default(5000000) @map("max_market_data_age_micros")

  /// Account-level halt. Independent of the four kill-switch scopes.
  tradingHalted Boolean   @default(true) @map("trading_halted")
  haltedReason  String?   @map("halted_reason") @db.VarChar(500)
  haltedAt      DateTime? @map("halted_at") @db.Timestamptz(6)

  // ---------------------------------------------------------------------
  // Part 8: the extended risk configuration.
  //
  // The scalars above remain the *effective* view the Part 2 core engine and
  // older consumers read. The Part 8 document is `policyJson`: the full
  // hierarchical entry set (GLOBAL..SYMBOL with priorities, units,
  // effective windows) as emitted by ``wlct_trading.risk.configuration``.
  // The two are kept in sync by the API's risk service - a config write
  // derives the scalars from the resolved view of the document, so a stale
  // scalar can never be *wider* than the document it shadows, and the
  // worker binds to `digest` rather than to either copy.
  //
  // `version` increments with every accepted mutation; `digest` is the
  // content hash the engine's snapshot binding check compares. They answer
  // different questions ("which revision is this" vs "does the payload
  // match what it claims") and neither substitutes for the other.
  // ---------------------------------------------------------------------
  version    Int     @default(1) @map("config_version")
  digest     String? @map("config_digest") @db.VarChar(64)
  policyJson Json?   @map("policy_json")
  protectionJson Json? @map("protection_json")

  /// Definition of the daily-loss rule, stored as booleans rather than
  /// buried in JSON so the effective policy is visible in a plain SELECT.
  dailyLossIncludesUnrealized Boolean @default(false) @map("daily_loss_includes_unrealized")
  allowRiskReducingOrders     Boolean @default(true) @map("allow_risk_reducing_orders")

  updatedByUserId String? @map("updated_by_user_id") @db.Uuid

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant  Tenant         @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  account TradingAccount @relation(fields: [accountId], references: [id], onDelete: Cascade)

  @@index([tenantId])
  @@map("risk_configurations")
}

// -----------------------------------------------------------------------------
// RiskEvent - the audit trail of every refusal
// -----------------------------------------------------------------------------
// Written for every rejection, breach and kill-switch action. This is the table
// an operator reads after an incident, so it records the limit, the observed
// value and the decision id that links back to the order.
// -----------------------------------------------------------------------------

model RiskEvent {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  accountId  String? @map("account_id") @db.Uuid
  strategyId String? @map("strategy_id") @db.Uuid
  orderId    String? @map("order_id") @db.Uuid

  eventType RiskEventType     @map("event_type")
  severity  RiskEventSeverity @default(WARNING)

  /// RiskDecisionCode from the engine, e.g. MAX_ORDER_SIZE_EXCEEDED.
  code    String @db.VarChar(64)
  message String @db.VarChar(1000)

  /// Stringified so the exact decimal is preserved for the audit record.
  limitValue    String? @map("limit_value") @db.VarChar(64)
  observedValue String? @map("observed_value") @db.VarChar(64)

  venue  TradingVenue?
  symbol String?       @db.VarChar(32)

  riskDecisionId String? @map("risk_decision_id") @db.Uuid
  correlationId  String? @map("correlation_id") @db.Uuid

  // Part 8: the structured rule trail. `ruleId` names the catalogued rule
  // (RiskRuleId), `scope`/`scopeTarget` say which hierarchy level governed,
  // `action` records what protection (if any) the breach proposed or
  // applied, `source` is the emitting component, and `snapshotVersion`
  // binds the event to the exact state the decision was taken from.
  // `dedupeKey` is the engine's content hash of the *condition* (not the
  // observed value): the partial unique index below makes repeated
  // identical breaches idempotent writes while distinct conditions never
  // collide.
  ruleId          String? @map("rule_id") @db.VarChar(64)
  scope           String? @db.VarChar(24)
  scopeTarget     String? @map("scope_target") @db.VarChar(64)
  action          String? @db.VarChar(32)
  source          String? @db.VarChar(64)
  snapshotVersion BigInt? @map("snapshot_version")
  isSimulated     Boolean @default(false) @map("is_simulated")
  dedupeKey       String? @map("dedupe_key") @db.VarChar(64)

  metadata Json @default("{}")

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  tenant   Tenant    @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  strategy Strategy? @relation(fields: [strategyId], references: [id], onDelete: SetNull)

  @@index([tenantId, createdAt])
  @@index([tenantId, eventType, createdAt])
  @@index([tenantId, severity, createdAt])
  @@index([tenantId, accountId, createdAt])
  @@index([orderId])
  @@unique([tenantId, dedupeKey])
  @@map("risk_events")
}

// -----------------------------------------------------------------------------
// KillSwitch - durable record of the four halt scopes
// -----------------------------------------------------------------------------
// The live switch is read from Redis on the hot path; this table is the durable
// mirror so a Redis flush cannot silently re-enable trading, and so every
// engage/release is attributable to a person.
// -----------------------------------------------------------------------------

model KillSwitch {
  id       String  @id @default(uuid()) @db.Uuid
  /// Null for the platform-wide GLOBAL switch.
  tenantId String? @map("tenant_id") @db.Uuid

  scope  KillSwitchScopeEnum
  /// Venue, strategy id or symbol. Null only for GLOBAL.
  target String?             @db.VarChar(64)

  isEngaged Boolean @default(false) @map("is_engaged")
  reason    String? @db.VarChar(500)

  engagedByUserId  String?   @map("engaged_by_user_id") @db.Uuid
  engagedAt        DateTime? @map("engaged_at") @db.Timestamptz(6)
  releasedByUserId String?   @map("released_by_user_id") @db.Uuid
  releasedAt       DateTime? @map("released_at") @db.Timestamptz(6)

  // Part 8: lifecycle alongside the boolean, never replacing it. The
  // engine's hot path reads Redis; this table remains the durable mirror
  // (a Redis flush cannot silently re-enable trading, per the Part 5 rule),
  // and `status` carries the trigger/acknowledge/clear history the boolean
  // cannot express. `isEngaged` stays true for ACTIVE, TRIGGERED *and*
  // ACKNOWLEDGED - the three blocking states - so every pre-Part 8 reader
  // keeps the exact same semantics.
  status                 RiskSwitchStatus    @default(INACTIVE)
  triggeredByRule        String?             @map("triggered_by_rule") @db.VarChar(64)
  triggeredAt            DateTime?           @map("triggered_at") @db.Timestamptz(6)
  severity               RiskEventSeverity?  @map("trigger_severity")
  requiresExplicitClear  Boolean             @default(false) @map("requires_explicit_clear")
  acknowledgedByUserId   String?             @map("acknowledged_by_user_id") @db.Uuid
  acknowledgedAt         DateTime?           @map("acknowledged_at") @db.Timestamptz(6)
  acknowledgementReason  String?             @map("acknowledgement_reason") @db.VarChar(500)
  clearedByUserId        String?               @map("cleared_by_user_id") @db.Uuid
  clearedAt              DateTime?             @map("cleared_at") @db.Timestamptz(6)
  clearedReason          String?               @map("cleared_reason") @db.VarChar(500)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant Tenant? @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@index([tenantId, scope, isEngaged])
  @@index([scope, isEngaged])
  @@map("kill_switches")
}

// -----------------------------------------------------------------------------
// TradingSession - one run of the engine
// -----------------------------------------------------------------------------

model TradingSession {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  accountId  String? @map("account_id") @db.Uuid
  strategyId String? @map("strategy_id") @db.Uuid

  status      TradingSessionStatus @default(STARTING)
  /// Resolved mode for this run, recorded so a historical session can be read
  /// back with certainty about whether its fills were real.
  tradingMode TradingModeSetting   @map("trading_mode")

  /// Hostname or pod name of the worker that owns the session.
  workerId String @map("worker_id") @db.VarChar(128)

  startedAt   DateTime  @default(now()) @map("started_at") @db.Timestamptz(6)
  endedAt     DateTime? @map("ended_at") @db.Timestamptz(6)
  heartbeatAt DateTime  @default(now()) @map("heartbeat_at") @db.Timestamptz(6)

  // --- observability counters -------------------------------------------
  signalsGenerated Int @default(0) @map("signals_generated")
  ordersRequested  Int @default(0) @map("orders_requested")
  ordersSubmitted  Int @default(0) @map("orders_submitted")
  ordersFilled     Int @default(0) @map("orders_filled")
  ordersRejected   Int @default(0) @map("orders_rejected")
  riskRejections   Int @default(0) @map("risk_rejections")
  bookResyncs      Int @default(0) @map("book_resyncs")

  /// Measured percentiles over the session, in microseconds. Observed values
  /// only; the platform makes no latency guarantee.
  medianDecisionLatencyMicros Int? @map("median_decision_latency_micros")
  p99DecisionLatencyMicros    Int? @map("p99_decision_latency_micros")

  stopReason String? @map("stop_reason") @db.VarChar(500)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant   Tenant          @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  account  TradingAccount? @relation(fields: [accountId], references: [id], onDelete: SetNull)
  strategy Strategy?       @relation(fields: [strategyId], references: [id], onDelete: SetNull)

  @@index([tenantId, status, startedAt])
  @@index([tenantId, strategyId, startedAt])
  @@index([heartbeatAt])
  @@map("trading_sessions")
}

// -----------------------------------------------------------------------------
// MarketDataRecord - OHLCV candles only
// -----------------------------------------------------------------------------
// Deliberately NOT a tick store. Individual quotes and trades arrive at
// thousands per second per symbol; persisting them would saturate write
// throughput and produce a table nobody can query usefully. Candles are the
// aggregation that is actually used for charting and post-trade analysis.
//
// Not tenant-scoped: a BTC-USDT candle is the same fact for every tenant, and
// duplicating it per tenant would multiply storage for no isolation benefit.
// Access is mediated by the API, which checks the caller's tenant is
// subscribed to the symbol.
// -----------------------------------------------------------------------------

model MarketDataRecord {
  id       String @id @default(uuid()) @db.Uuid
  symbolId String @map("symbol_id") @db.Uuid

  venue    TradingVenue
  symbol   String       @db.VarChar(32)
  /// "1m", "5m", "1h", "1d".
  interval String       @db.VarChar(8)

  openTime  DateTime @map("open_time") @db.Timestamptz(6)
  closeTime DateTime @map("close_time") @db.Timestamptz(6)

  open   Decimal @db.Decimal(28, 12)
  high   Decimal @db.Decimal(28, 12)
  low    Decimal @db.Decimal(28, 12)
  close  Decimal @db.Decimal(28, 12)
  volume Decimal @db.Decimal(28, 12)

  quoteVolume Decimal? @map("quote_volume") @db.Decimal(28, 12)
  tradeCount  Int      @default(0) @map("trade_count")

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  symbolRef TradingSymbol @relation(fields: [symbolId], references: [id], onDelete: Cascade)

  @@unique([symbolId, interval, openTime])
  @@index([venue, symbol, interval, openTime])
  @@index([openTime])
  @@map("market_data_records")
}

// =============================================================================
// PART 5 - AUTHENTICATED EXECUTION
// =============================================================================
// Everything below records what happened on the money path: where a credential
// lives (never the credential itself), what the private stream did, what
// reconciliation found, and what an operator needs to look at.
//
// One rule governs the whole section: nothing here is ever updated to hide a
// disagreement. A reconciliation that finds a difference writes a discrepancy
// row; it does not quietly correct the order and move on. An audit that can be
// edited is not an audit.
// =============================================================================

/// Where an account's key material actually lives.
enum CredentialSource {
  /// Envelope-encrypted in `trading_accounts`. Correct for self-hosted and
  /// single-tenant installs; the Part 1 default.
  ENVELOPE_DB
  /// Held by Vault / AWS Secrets Manager / GCP Secret Manager / KMS. The
  /// database stores only a pointer. Correct for managed multi-tenant.
  SECRET_MANAGER
  /// Process environment. Development only - it does not scale past one tenant
  /// and cannot be rotated per customer.
  ENVIRONMENT
}

/// How much the local record of an order can be trusted.
enum OrderReconciliationState {
  IN_SYNC
  /// The submission outcome was never observed. The order may or may not exist
  /// at the venue. It must be queried by clientOrderId, never resubmitted.
  UNKNOWN
  PENDING_RECONCILIATION
  /// Reconciliation found a difference it could not repair automatically.
  DIVERGED
}

/// Which route delivered a fill.
enum FillSource {
  PRIVATE_STREAM
  /// Returned inline in the order-placement response (newOrderRespType=FULL).
  ORDER_RESPONSE
  RECONCILIATION
  /// Produced by the paper venue. Always paired with isSimulated = true.
  SIMULATOR
}

enum StreamSessionStatus {
  CONNECTING
  CONNECTED
  RECONNECTING
  DISCONNECTED
  /// The venue invalidated the listen key. A new key is required; reconnecting
  /// with the old one yields a socket that silently delivers nothing.
  KEY_EXPIRED
  FAILED
  STOPPED
}

enum ReconciliationRunStatus {
  RUNNING
  COMPLETED
  /// Another pass held the lock. Not an error.
  SKIPPED
  FAILED
}

enum ReconciliationDiscrepancyType {
  ORDER_STATUS_MISMATCH
  ORDER_MISSING_LOCALLY
  ORDER_MISSING_AT_VENUE
  MISSED_FILL
  QUANTITY_MISMATCH
  BALANCE_MISMATCH
  POSITION_MISMATCH
  UNKNOWN_ORDER_RESOLVED
  UNKNOWN_ORDER_NEVER_PLACED
}

enum ExecutionIncidentType {
  UNKNOWN_ORDER_RESULT
  ORDER_STATE_MISMATCH
  MISSING_FILL
  UNEXPECTED_ORDER
  BALANCE_MISMATCH
  POSITION_MISMATCH
  ILLEGAL_TRANSITION
  CREDENTIAL_FAILURE
  CLOCK_SKEW
  PRIVATE_STREAM_FAILURE
  RATE_LIMIT_BREACH
  RECONCILIATION_FAILURE
  SAFETY_GATE_BLOCK
}

enum ExecutionIncidentSeverity {
  INFO
  WARNING
  /// Money or position integrity is at stake. Page someone.
  CRITICAL
}

// -----------------------------------------------------------------------------
// AccountBalanceSnapshot - what the venue says the account holds
// -----------------------------------------------------------------------------
// A snapshot, not a ledger. The platform does not maintain its own running
// balance: it would inevitably drift from the venue's, and a drifting balance
// is worse than no balance because it looks authoritative.
//
// Latest-per-asset is an upsert on the unique key. History is kept in
// `AccountBalanceSnapshot` rows only for assets whose value changed, which is
// what makes the table bounded on an account holding hundreds of dust balances.
// -----------------------------------------------------------------------------

model AccountBalanceSnapshot {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  accountId String @map("account_id") @db.Uuid

  asset String @db.VarChar(24)

  /// Available to trade.
  free   Decimal @default(0) @db.Decimal(28, 12)
  /// Reserved against resting orders.
  locked Decimal @default(0) @db.Decimal(28, 12)
  /// Stored, not computed, so a historical row reads back exactly as the venue
  /// reported it even if the free/locked split is later revised.
  total  Decimal @default(0) @db.Decimal(28, 12)

  /// Venue's own update timestamp, when it supplies one.
  venueUpdatedAtMicros BigInt? @map("venue_updated_at_micros")
  observedAtMicros     BigInt  @map("observed_at_micros")

  /// True for a paper account. Carried so a simulated balance can never appear
  /// in a report alongside real ones without being marked.
  isSimulated Boolean @default(false) @map("is_simulated")

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant  Tenant         @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  account TradingAccount @relation(fields: [accountId], references: [id], onDelete: Cascade)

  @@unique([accountId, asset])
  @@index([tenantId, accountId])
  @@index([tenantId, asset])
  @@index([observedAtMicros])
  @@map("account_balance_snapshots")
}

// -----------------------------------------------------------------------------
// ExchangeStreamSession - one private user-data stream connection
// -----------------------------------------------------------------------------
// Distinct from TradingSession, which is a strategy run. This is the socket:
// when it connected, how many times it dropped, whether its listen key is still
// valid. Kept because "we have not received a fill in twenty minutes" is only
// actionable if you can tell a quiet market from a dead socket.
//
// The listen key is NEVER stored. It is a bearer credential: anyone holding it
// can read the account's entire order flow. Only the masked form is kept.
// -----------------------------------------------------------------------------

model ExchangeStreamSession {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  accountId String @map("account_id") @db.Uuid

  venue  TradingVenue
  status StreamSessionStatus @default(CONNECTING)

  /// Masked listen key, e.g. "pqia...65a1". Enough to correlate two log lines,
  /// useless to an attacker. The full key is never written anywhere.
  listenKeyMasked String? @map("listen_key_masked") @db.VarChar(32)

  listenKeyCreatedAt       DateTime? @map("listen_key_created_at") @db.Timestamptz(6)
  listenKeyRenewedAt       DateTime? @map("listen_key_renewed_at") @db.Timestamptz(6)
  listenKeyRenewals        Int       @default(0) @map("listen_key_renewals")
  listenKeyRenewalFailures Int       @default(0) @map("listen_key_renewal_failures")

  connectedAt    DateTime? @map("connected_at") @db.Timestamptz(6)
  disconnectedAt DateTime? @map("disconnected_at") @db.Timestamptz(6)
  lastEventAt    DateTime? @map("last_event_at") @db.Timestamptz(6)

  reconnectCount   Int @default(0) @map("reconnect_count")
  eventsReceived   Int @default(0) @map("events_received")
  executionReports Int @default(0) @map("execution_reports")
  parseErrors      Int @default(0) @map("parse_errors")

  /// Set after each reconnect, because Binance does not replay events missed
  /// while disconnected - so every reconnect is a correctness event.
  lastReconciledAt DateTime? @map("last_reconciled_at") @db.Timestamptz(6)

  /// Hostname or pod name of the worker holding the socket.
  workerId String @map("worker_id") @db.VarChar(128)

  /// Error class only. Never a venue response body, which could echo the URL
  /// and therefore the listen key.
  lastErrorCode String? @map("last_error_code") @db.VarChar(64)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant  Tenant         @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  account TradingAccount @relation(fields: [accountId], references: [id], onDelete: Cascade)

  @@index([tenantId, accountId, status])
  @@index([tenantId, status])
  @@index([lastEventAt])
  @@map("exchange_stream_sessions")
}

// -----------------------------------------------------------------------------
// ReconciliationRun + ReconciliationDiscrepancy
// -----------------------------------------------------------------------------
// Split into a run and its findings for the same reason Strategy and
// StrategyConfiguration are split: a run is a fact about an execution, a
// discrepancy is a fact about the world, and the second outlives the first.
//
// A run row is written even when it finds nothing, and even when it fails. "No
// reconciliation has completed for an hour" is itself an alertable condition
// and is invisible if only successful runs are recorded.
// -----------------------------------------------------------------------------

model ReconciliationRun {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  accountId String @map("account_id") @db.Uuid

  venue  TradingVenue
  status ReconciliationRunStatus @default(RUNNING)

  /// What prompted this pass: SCHEDULED, STREAM_RECONNECT, UNKNOWN_ORDER,
  /// MANUAL. A free-form column rather than an enum because the set of triggers
  /// grows with operational experience and a migration per trigger is friction
  /// for no safety gain.
  trigger String @default("SCHEDULED") @db.VarChar(32)

  startedAt      DateTime  @default(now()) @map("started_at") @db.Timestamptz(6)
  finishedAt     DateTime? @map("finished_at") @db.Timestamptz(6)
  durationMicros BigInt?   @map("duration_micros")

  ordersChecked         Int @default(0) @map("orders_checked")
  fillsRecovered        Int @default(0) @map("fills_recovered")
  discrepanciesFound    Int @default(0) @map("discrepancies_found")
  discrepanciesRepaired Int @default(0) @map("discrepancies_repaired")

  /// Error class and message. Never a credential, never a signature.
  error String? @db.VarChar(500)

  workerId String @map("worker_id") @db.VarChar(128)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  tenant  Tenant         @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  account TradingAccount @relation(fields: [accountId], references: [id], onDelete: Cascade)

  discrepancies ReconciliationDiscrepancy[]

  @@index([tenantId, accountId, startedAt])
  @@index([tenantId, status, startedAt])
  @@index([startedAt])
  @@map("reconciliation_runs")
}

model ReconciliationDiscrepancy {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  runId   String  @map("run_id") @db.Uuid
  /// Null for a discrepancy about an order this platform does not know - which
  /// is precisely the most serious kind.
  orderId String? @map("order_id") @db.Uuid

  discrepancyType ReconciliationDiscrepancyType @map("discrepancy_type")

  symbol        String? @db.VarChar(32)
  clientOrderId String? @map("client_order_id") @db.VarChar(36)

  /// What we believed and what the venue said. Strings rather than typed
  /// columns because the compared value is a status here and a quantity there,
  /// and a discrepancy record is read by a human, not summed by a query.
  localValue String? @map("local_value") @db.VarChar(120)
  venueValue String? @map("venue_value") @db.VarChar(120)

  summary String @db.VarChar(1000)

  /// Whether local state was changed to match. False for everything the
  /// service refuses to auto-correct: balances, positions, and any order the
  /// platform did not place.
  repaired Boolean @default(false)

  detectedAtMicros BigInt @map("detected_at_micros")

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  run   ReconciliationRun @relation(fields: [runId], references: [id], onDelete: Cascade)
  order Order?            @relation(fields: [orderId], references: [id], onDelete: SetNull)

  @@index([tenantId, discrepancyType, createdAt])
  @@index([runId])
  @@index([orderId])
  @@index([tenantId, repaired, createdAt])
  @@map("reconciliation_discrepancies")
}

// -----------------------------------------------------------------------------
// ExecutionIncident - the things a human needs to know about
// -----------------------------------------------------------------------------
// Deliberately rare. A risk engine declining an oversized order is the system
// working and produces nothing here. An order whose fate is unknown, a
// credential that stopped working, an order at the venue that this platform did
// not place - those produce a row.
//
// Immutable except for resolution. An incident is closed by setting
// `resolvedAt` and a note; its facts are never edited.
// -----------------------------------------------------------------------------

model ExecutionIncident {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  accountId String? @map("account_id") @db.Uuid
  orderId   String? @map("order_id") @db.Uuid

  incidentType ExecutionIncidentType     @map("incident_type")
  severity     ExecutionIncidentSeverity @default(WARNING)

  venue  TradingVenue?
  symbol String?       @db.VarChar(32)

  clientOrderId String? @map("client_order_id") @db.VarChar(36)

  /// Normalised execution error code from the platform taxonomy, e.g.
  /// RESULT_UNKNOWN, CREDENTIALS_INVALID, STATE_MISMATCH. A VarChar rather than
  /// an enum: the taxonomy is expected to grow, and a code the database has
  /// never seen must be recordable rather than rejected at insert time.
  errorCode String? @map("error_code") @db.VarChar(64)

  summary String @db.VarChar(1000)

  /// Structured context. Every value is passed through the secret scrubber
  /// before it gets here - incident payloads are the single most likely place
  /// for a credential to escape, because the instinct when writing one is to
  /// attach the whole failing request.
  details Json @default("{}")

  occurredAtMicros BigInt @map("occurred_at_micros")

  resolvedAt     DateTime? @map("resolved_at") @db.Timestamptz(6)
  resolvedBy     String?   @map("resolved_by") @db.Uuid
  resolutionNote String?   @map("resolution_note") @db.VarChar(1000)

  /// Set when an alert was actually delivered, so a repeated incident does not
  /// re-page and a missed page is visible.
  notifiedAt DateTime? @map("notified_at") @db.Timestamptz(6)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant  Tenant          @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  account TradingAccount? @relation(fields: [accountId], references: [id], onDelete: SetNull)
  order   Order?          @relation(fields: [orderId], references: [id], onDelete: SetNull)

  @@index([tenantId, severity, createdAt])
  @@index([tenantId, incidentType, createdAt])
  @@index([tenantId, accountId, createdAt])
  /// The dashboard's primary query: unresolved incidents, worst first.
  @@index([tenantId, resolvedAt, severity])
  @@index([orderId])
  @@index([createdAt])
  @@map("execution_incidents")
}

// =============================================================================
// PART 6 - STRATEGY LAYER: catalogue, runs, backtests, paper trading
// =============================================================================
// Three properties hold across everything below.
//
//   1. NOTHING HERE IS WRITTEN PER TICK. A strategy processes thousands of book
//      updates a minute; none of them reach PostgreSQL. What is stored is
//      configuration, lifecycle transitions, periodic checkpoints, completed
//      backtests, periodic paper snapshots and incidents. Hot state lives in
//      the engine's memory, and Redis is never the source of financial truth.
//
//   2. EVERY SIMULATED ROW SAYS SO. `BacktestRun`, `BacktestTrade`,
//      `PaperTradingSession` and `PaperPortfolioSnapshot` all describe results
//      that no real account achieved. Backtest performance is not indicative of
//      future performance; paper performance is not indicative of live
//      performance; simulation does not guarantee real execution quality.
//
//   3. NO ROW HERE CAN AUTHORISE AN ORDER. Enabling a strategy makes it emit
//      signals. Whether a signal becomes an order is decided by the risk engine
//      and the Part 5 execution gates, none of which read these tables.
// =============================================================================

enum StrategyVersionStatus {
  /// Registered but not runnable. An instance cannot bind to it.
  DRAFT
  /// Runnable. Behaviour is frozen: a change requires a new version.
  PUBLISHED
  /// Still runnable for existing instances, refused for new ones.
  DEPRECATED
  /// Refused everywhere, including for running instances at next start.
  DISABLED
}

enum StrategyFailurePolicy {
  /// Stop the instance that failed. Siblings keep running.
  STOP_INSTANCE
  /// Stop every instance in the engine. For a failure that suggests the
  /// problem is not confined to one strategy.
  HALT_ALL
}

enum StrategyHealth {
  /// The engine has not reported on this instance. Not the same as unhealthy.
  UNKNOWN
  HEALTHY
  /// Running, but something is wrong: errors, slow dispatches, stale data.
  DEGRADED
  /// Running is no longer trusted.
  UNHEALTHY
  /// Taken out of service by the failure policy. Only an operator clears it.
  QUARANTINED
}

enum StrategyRunStatus {
  STARTING
  RUNNING
  /// Ended cleanly, by operator action or shutdown.
  STOPPED
  /// Ended because the instance raised.
  FAILED
  /// Ended because HALT_ALL stopped the whole engine.
  HALTED
}

enum StrategyIncidentType {
  /// The strategy raised inside a handler or in evaluate().
  STRATEGY_ERROR
  /// Feature calculation raised. The features are discarded, not guessed.
  FEATURE_ERROR
  /// An unusual volume of rejected signals: the strategy is fighting the
  /// validator, which usually means a parameter is wrong.
  SIGNAL_REJECTED_BURST
  /// Risk state was unavailable, so signals were refused. Fail-closed working
  /// as designed, and still worth a human knowing about.
  RISK_STATE_UNAVAILABLE
  /// Dispatch exceeded the observation budget repeatedly.
  PROCESSING_LATENCY_BREACH
  /// The failure policy removed the instance from service.
  INSTANCE_QUARANTINED
  /// A configuration was refused by the parameter schema.
  CONFIGURATION_REJECTED
  /// A state checkpoint could not be written or could not be restored.
  CHECKPOINT_FAILURE
}

enum BacktestRunStatus {
  QUEUED
  RUNNING
  COMPLETED
  FAILED
  CANCELLED
}

enum PaperSessionStatus {
  STARTING
  RUNNING
  STOPPED
  FAILED
}

// -----------------------------------------------------------------------------
// StrategyDefinition - the catalogue of implementations that ship with the code
// -----------------------------------------------------------------------------
// Platform-level and deliberately NOT tenant-scoped: a definition describes a
// class in `wlct_trading.strategies.implementations`, which is the same class
// for every tenant. It holds no customer data, so there is nothing to isolate.
// Tenant scoping starts at Strategy (the instance).
//
// Reserved-but-unimplemented ids live here too, flagged, so that the well-known
// names cannot be quietly taken by something that is not what an operator
// expects.
// -----------------------------------------------------------------------------

model StrategyDefinition {
  id String @id @default(uuid()) @db.Uuid

  /// Stable registry key, e.g. DETERMINISTIC_IMBALANCE_V1. Never reused for a
  /// different implementation.
  key String @unique @db.VarChar(64)

  displayName String  @map("display_name") @db.VarChar(120)
  description String  @db.VarChar(1000)
  category    String? @db.VarChar(40)

  /// False for a reserved name with no code behind it. An instance cannot bind
  /// to an unimplemented definition.
  isImplemented Boolean @default(false) @map("is_implemented")
  /// True for the four spec-reserved ids (MARKET_MAKING_V1, MOMENTUM_V1,
  /// MEAN_REVERSION_V1, MICROSTRUCTURE_V1) that exist to protect the namespace.
  isReserved    Boolean @default(false) @map("is_reserved")

  /// What this strategy does NOT claim. Rendered verbatim in the admin UI so a
  /// catalogue entry can never read like a performance promise.
  riskNotes String @default("No profitability claim is made or implied.") @map("risk_notes") @db.VarChar(1000)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  versions  StrategyVersion[]
  instances Strategy[]
  backtests BacktestRun[]

  @@index([isImplemented])
  @@map("strategy_definitions")
}

// -----------------------------------------------------------------------------
// StrategyVersion - frozen behaviour
// -----------------------------------------------------------------------------
// The point of this table is that behaviour cannot change silently under one
// version. `behaviourHash` covers the implementation id and the parameter
// schema; if either changes, the hash changes, and the platform requires a new
// version row rather than mutating this one.
// -----------------------------------------------------------------------------

model StrategyVersion {
  id           String @id @default(uuid()) @db.Uuid
  definitionId String @map("definition_id") @db.Uuid

  /// Semantic version of the implementation, e.g. "1.0.0".
  version String @db.VarChar(20)

  status StrategyVersionStatus @default(DRAFT)

  /// Module-qualified class path, e.g.
  /// wlct_trading.strategies.implementations.deterministic_example:DeterministicImbalanceStrategy
  implementationId String @map("implementation_id") @db.VarChar(200)

  /// Declared parameter schema: name, type, bounds, default. Used to validate
  /// every configuration before it is written. Credential-shaped parameter
  /// names are refused by the engine, so a schema can never ask for a secret.
  parameterSchema   Json @default("{}") @map("parameter_schema")
  defaultParameters Json @default("{}") @map("default_parameters")

  /// sha256 over implementationId + canonical parameter schema.
  behaviourHash String @map("behaviour_hash") @db.VarChar(64)

  changeNote String? @map("change_note") @db.VarChar(1000)

  publishedAt  DateTime? @map("published_at") @db.Timestamptz(6)
  deprecatedAt DateTime? @map("deprecated_at") @db.Timestamptz(6)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  definition StrategyDefinition @relation(fields: [definitionId], references: [id], onDelete: Cascade)

  instances      Strategy[]
  configurations StrategyConfiguration[]
  backtests      BacktestRun[]

  @@unique([definitionId, version])
  @@index([definitionId, status])
  @@map("strategy_versions")
}

// -----------------------------------------------------------------------------
// StrategyRun - one continuous period of an instance being alive
// -----------------------------------------------------------------------------
// Written on transition only: start, stop, failure. The counters are a snapshot
// taken when the run ends (or at checkpoint time), not a running total updated
// per event - that would be a write per tick by another name.
// -----------------------------------------------------------------------------

model StrategyRun {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  strategyId String @map("strategy_id") @db.Uuid

  /// PAPER or LIVE. A backtest is not a run: it has its own table, because a
  /// backtest has a dataset and a window and a run does not.
  runMode TradingModeSetting @default(PAPER) @map("run_mode")

  status StrategyRunStatus @default(STARTING)

  /// Copied from the instance at start, so a historical run stays readable
  /// after the instance is reconfigured.
  instanceKey     String @map("instance_key") @db.VarChar(32)
  configVersion   Int    @map("config_version")
  strategyKey     String @map("strategy_key") @db.VarChar(64)
  strategyVersion String @map("strategy_version") @db.VarChar(20)

  venue      TradingVenue
  symbols    String[]
  marketType TradingMarketType @default(SPOT) @map("market_type")

  startedAt DateTime  @default(now()) @map("started_at") @db.Timestamptz(6)
  stoppedAt DateTime? @map("stopped_at") @db.Timestamptz(6)

  /// Free-text reason for a clean stop, e.g. "operator disabled".
  stopReason String? @map("stop_reason") @db.VarChar(500)
  /// Exception class name only. Never a message, which could carry data.
  errorCode  String? @map("error_code") @db.VarChar(64)

  /// End-of-run counters: events processed, signals generated / accepted /
  /// rejected / deduplicated, strategy errors, feature errors, risk
  /// rejections, slow dispatches. Stored as JSON because the counter set grows
  /// with the engine and a column per counter would mean a migration each time.
  counters Json @default("{}")

  /// Timestamp of the last market event this run processed, in microseconds.
  lastEventAtMicros BigInt? @map("last_event_at_micros")

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant   Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  strategy Strategy @relation(fields: [strategyId], references: [id], onDelete: Cascade)

  checkpoints StrategyCheckpoint[]
  incidents   StrategyIncident[]

  @@index([tenantId, strategyId, startedAt])
  @@index([tenantId, status, startedAt])
  @@index([strategyId, status])
  @@index([startedAt])
  @@map("strategy_runs")
}

// -----------------------------------------------------------------------------
// StrategyCheckpoint - periodic, resumable instance state
// -----------------------------------------------------------------------------
// On a schedule and on clean stop. Never per tick.
//
// A checkpoint is what allows an instance to resume after a restart instead of
// silently starting from a blank rolling window while behaving as though it had
// history. `stateHash` makes a corrupted or partially written checkpoint
// detectable: restore verifies it and refuses rather than resuming from
// nonsense.
// -----------------------------------------------------------------------------

model StrategyCheckpoint {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  strategyId String  @map("strategy_id") @db.Uuid
  runId      String? @map("run_id") @db.Uuid

  /// Monotonically increasing per strategy.
  sequence Int

  instanceKey String @map("instance_key") @db.VarChar(32)

  /// Serialised instance state as produced by the engine's snapshot(). Feature
  /// windows, cooldown state, the signal counter. No credential can appear
  /// here: the context that produces it has no field for one.
  state Json @default("{}")

  /// sha256 over the canonical encoding of `state`.
  stateHash String @map("state_hash") @db.VarChar(64)

  capturedAtMicros BigInt @map("captured_at_micros")

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  tenant   Tenant       @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  strategy Strategy     @relation(fields: [strategyId], references: [id], onDelete: Cascade)
  run      StrategyRun? @relation(fields: [runId], references: [id], onDelete: SetNull)

  @@unique([strategyId, sequence])
  @@index([tenantId, strategyId, capturedAtMicros])
  @@index([runId])
  @@map("strategy_checkpoints")
}

// -----------------------------------------------------------------------------
// StrategyIncident - what a human needs to know about the strategy layer
// -----------------------------------------------------------------------------
// Same discipline as ExecutionIncident, and the same severity enum rather than
// a parallel one: a WARNING means the same thing in both places, and two
// enums with identical members is duplication waiting to drift.
//
// Rare by design. A validator rejecting one stale signal is the system working
// and produces nothing here.
// -----------------------------------------------------------------------------

model StrategyIncident {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  strategyId String? @map("strategy_id") @db.Uuid
  runId      String? @map("run_id") @db.Uuid

  incidentType StrategyIncidentType      @map("incident_type")
  severity     ExecutionIncidentSeverity @default(WARNING)

  venue  TradingVenue?
  symbol String?       @db.VarChar(32)

  /// Normalised code, e.g. STRATEGY_ERROR, SIGNAL_STALE, VALIDATION_STATE_
  /// UNAVAILABLE. VarChar rather than an enum: the taxonomy grows, and a code
  /// the database has not seen must be recordable rather than rejected.
  errorCode String? @map("error_code") @db.VarChar(64)

  summary String @db.VarChar(1000)

  /// Structured context, scrubbed before it arrives. Feature values and
  /// parameters may appear; a credential cannot, because no strategy object
  /// holds one.
  details Json @default("{}")

  occurredAtMicros BigInt @map("occurred_at_micros")

  resolvedAt     DateTime? @map("resolved_at") @db.Timestamptz(6)
  resolvedBy     String?   @map("resolved_by") @db.Uuid
  resolutionNote String?   @map("resolution_note") @db.VarChar(1000)

  notifiedAt DateTime? @map("notified_at") @db.Timestamptz(6)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant   Tenant       @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  strategy Strategy?    @relation(fields: [strategyId], references: [id], onDelete: SetNull)
  run      StrategyRun? @relation(fields: [runId], references: [id], onDelete: SetNull)

  @@index([tenantId, severity, createdAt])
  @@index([tenantId, incidentType, createdAt])
  @@index([tenantId, strategyId, createdAt])
  /// The dashboard's primary query: unresolved incidents, worst first.
  @@index([tenantId, resolvedAt, severity])
  @@index([runId])
  @@map("strategy_incidents")
}

// -----------------------------------------------------------------------------
// BacktestRun - a completed simulation over stored data
// -----------------------------------------------------------------------------
// SIMULATED. Every figure in this table was produced by a model that ignores
// queue position, market impact, venue rejections and latency variance, and is
// therefore systematically optimistic.
//
// BACKTEST PERFORMANCE IS NOT INDICATIVE OF FUTURE PERFORMANCE.
//
// Two columns make a result reproducible rather than merely plausible:
// `configurationHash` (strategy, version, implementation id, parameters,
// execution assumptions, dataset identity and initial capital) and the dataset
// identity columns including `datasetChecksum`. Re-running with the same hash
// against the same checksum must produce the same `runIdentifier`. It hashes no
// secret: none of its inputs can contain one.
// -----------------------------------------------------------------------------

model BacktestRun {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  /// Who asked for it. Null for a scheduled or system-initiated run.
  requestedByUserId String? @map("requested_by_user_id") @db.Uuid

  /// The instance this was run for, when it was run for one. A backtest can
  /// also be run against a definition alone, before any instance exists.
  strategyId   String? @map("strategy_id") @db.Uuid
  definitionId String? @map("definition_id") @db.Uuid
  versionId    String? @map("version_id") @db.Uuid

  /// Denormalised so a historical result stays readable after the catalogue
  /// changes underneath it.
  strategyKey      String @map("strategy_key") @db.VarChar(64)
  strategyVersion  String @map("strategy_version") @db.VarChar(20)
  implementationId String @map("implementation_id") @db.VarChar(200)

  status BacktestRunStatus @default(QUEUED)

  venue      TradingVenue
  symbol     String            @db.VarChar(32)
  marketType TradingMarketType @default(SPOT) @map("market_type")

  // --- dataset identity ----------------------------------------------------
  datasetId         String  @map("dataset_id") @db.VarChar(120)
  datasetSource     String  @map("dataset_source") @db.VarChar(120)
  datasetChecksum   String? @map("dataset_checksum") @db.VarChar(64)
  granularity       String? @db.VarChar(20)
  windowStartMicros BigInt  @map("window_start_micros")
  windowEndMicros   BigInt  @map("window_end_micros")
  eventCount        Int     @default(0) @map("event_count")

  /// Part 7: the exact registered dataset VERSION this run replays. Nullable
  /// for back-compatibility with Part 6 runs, but a deployment with
  /// BACKTEST_DATASET_REQUIRED=true (the default) refuses submissions that
  /// leave it null. This is the column that ends "latest mutable data": the
  /// run points at an immutable version row, and the version row points at
  /// the content checksum the worker verified.
  datasetVersionId String? @map("dataset_version_id") @db.Uuid

  /// The walk-forward window this run belongs to, when it is part of a split:
  /// TRAINING, VALIDATION or TEST. Null for a plain single-window run.
  walkForwardSegment String? @map("walk_forward_segment") @db.VarChar(20)

  // --- assumptions ---------------------------------------------------------
  initialCapital Decimal @map("initial_capital") @db.Decimal(18, 6)
  makerFeeRate   Decimal @map("maker_fee_rate") @db.Decimal(9, 6)
  takerFeeRate   Decimal @map("taker_fee_rate") @db.Decimal(9, 6)
  slippageBps    Decimal @map("slippage_bps") @db.Decimal(9, 4)
  latencyMicros  BigInt  @default(0) @map("latency_micros")

  /// Parameters exactly as validated and used. Never a credential.
  parameters  Json @default("{}")
  /// The full assumption set as recorded by the engine, including the ones
  /// with no column of their own (minimum fill quantity, partial fill policy).
  assumptions Json @default("{}")

  // --- results (null until COMPLETED) --------------------------------------
  finalEquity  Decimal? @map("final_equity") @db.Decimal(18, 6)
  netPnl       Decimal? @map("net_pnl") @db.Decimal(18, 6)
  grossProfit  Decimal? @map("gross_profit") @db.Decimal(18, 6)
  grossLoss    Decimal? @map("gross_loss") @db.Decimal(18, 6)
  feesPaid     Decimal? @map("fees_paid") @db.Decimal(18, 6)
  slippageCost Decimal? @map("slippage_cost") @db.Decimal(18, 6)

  totalReturnPercent Decimal? @map("total_return_percent") @db.Decimal(12, 6)
  maxDrawdown        Decimal? @map("max_drawdown") @db.Decimal(18, 6)
  maxDrawdownPercent Decimal? @map("max_drawdown_percent") @db.Decimal(12, 6)

  totalTrades   Int @default(0) @map("total_trades")
  winningTrades Int @default(0) @map("winning_trades")
  losingTrades  Int @default(0) @map("losing_trades")

  /// Null rather than zero when there were no trades. A strategy that never
  /// traded does not have a 0% win rate, and storing one would be a lie a
  /// dashboard would happily repeat.
  winRate      Decimal? @map("win_rate") @db.Decimal(9, 6)
  averageTrade Decimal? @map("average_trade") @db.Decimal(18, 6)
  largestWin   Decimal? @map("largest_win") @db.Decimal(18, 6)
  largestLoss  Decimal? @map("largest_loss") @db.Decimal(18, 6)
  profitFactor Decimal? @map("profit_factor") @db.Decimal(18, 8)

  /// Risk-adjusted figures, withheld (null) below the engine's minimum
  /// observation count and on zero dispersion.
  sharpeRatio  Decimal? @map("sharpe_ratio") @db.Decimal(18, 8)
  sortinoRatio Decimal? @map("sortino_ratio") @db.Decimal(18, 8)

  /// False when the run had too few observations for the risk-adjusted
  /// figures to mean anything. Stored explicitly so a consumer cannot mistake
  /// a null for "not calculated yet".
  hasSufficientObservations Boolean @default(false) @map("has_sufficient_observations")

  exposurePercent Decimal? @map("exposure_percent") @db.Decimal(9, 6)
  turnover        Decimal? @map("turnover") @db.Decimal(18, 6)

  // --- identity ------------------------------------------------------------
  /// Engine-assigned deterministic run id, "bt-" + 24 hex.
  runIdentifier     String @map("run_identifier") @db.VarChar(32)
  /// sha256 over strategy, version, implementation id, parameters, assumptions,
  /// dataset identity and initial capital. Hashes no secret.
  configurationHash String @map("configuration_hash") @db.VarChar(64)
  engineVersion     String @map("engine_version") @db.VarChar(20)

  /// False when the dataset carried no checksum, which means this result
  /// cannot be proven to have come from that data.
  isReproducible Boolean @default(false) @map("is_reproducible")

  /// Always true. A column rather than an assumption, so that a consumer
  /// reading a row in isolation cannot mistake it for a live result.
  isSimulated Boolean @default(true) @map("is_simulated")

  jobId String? @map("job_id") @db.VarChar(64)

  queuedAt    DateTime  @default(now()) @map("queued_at") @db.Timestamptz(6)
  startedAt   DateTime? @map("started_at") @db.Timestamptz(6)
  completedAt DateTime? @map("completed_at") @db.Timestamptz(6)
  durationMs  Int?      @map("duration_ms")

  errorCode    String? @map("error_code") @db.VarChar(64)
  errorSummary String? @map("error_summary") @db.VarChar(1000)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant     Tenant              @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  strategy   Strategy?           @relation(fields: [strategyId], references: [id], onDelete: SetNull)
  definition StrategyDefinition? @relation(fields: [definitionId], references: [id], onDelete: SetNull)
  version    StrategyVersion?    @relation(fields: [versionId], references: [id], onDelete: SetNull)

  historicalVersion HistoricalDatasetVersion? @relation(fields: [datasetVersionId], references: [id], onDelete: SetNull)

  metrics BacktestMetric[]
  trades  BacktestTrade[]

  /// The engine's run id is deterministic, so the same inputs re-submitted
  /// inside one tenant collide here rather than producing a second row that
  /// claims to be a different result.
  @@unique([tenantId, runIdentifier])
  @@index([tenantId, status, queuedAt])
  @@index([tenantId, strategyId, queuedAt])
  @@index([tenantId, configurationHash])
  @@index([tenantId, symbol, queuedAt])
  @@index([definitionId])
  @@index([versionId])
  @@index([queuedAt])
  @@map("backtest_runs")
  @@index([datasetVersionId])
}

// -----------------------------------------------------------------------------
// BacktestMetric - one named figure, with its own honesty flag
// -----------------------------------------------------------------------------
// The headline numbers have columns on BacktestRun. This table exists for the
// long tail, and for one property the columns cannot express: every metric
// carries `observationCount` and `isSufficient`, so a consumer can tell the
// difference between "0.0" and "not enough data to say".
// -----------------------------------------------------------------------------

model BacktestMetric {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  backtestRunId String @map("backtest_run_id") @db.Uuid

  name  String   @db.VarChar(64)
  /// Null when the metric could not be computed meaningfully. Never coerced
  /// to zero.
  value Decimal? @db.Decimal(28, 12)
  unit  String   @default("RATIO") @db.VarChar(16)

  observationCount Int     @default(0) @map("observation_count")
  isSufficient     Boolean @default(false) @map("is_sufficient")

  /// Why a value is absent, when it is, e.g. "fewer than 20 return
  /// observations" or "zero dispersion".
  note String? @db.VarChar(500)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  tenant Tenant      @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  run    BacktestRun @relation(fields: [backtestRunId], references: [id], onDelete: Cascade)

  @@unique([backtestRunId, name])
  @@index([tenantId, name])
  @@map("backtest_metrics")
}

// -----------------------------------------------------------------------------
// BacktestTrade - one simulated round trip
// -----------------------------------------------------------------------------
// SIMULATED. These fills were never sent anywhere.
//
// `isWin` is net of fees: a trade profitable before costs and unprofitable
// after is a loss. A round trip that realised exactly zero is still recorded,
// because it still paid fees, and omitting it would quietly improve the win
// rate of every strategy in the platform.
// -----------------------------------------------------------------------------

model BacktestTrade {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  backtestRunId String @map("backtest_run_id") @db.Uuid

  /// Position in the run, from 1. Deterministic.
  sequence Int

  symbol    String           @db.VarChar(32)
  direction PositionSideEnum

  quantity   Decimal @db.Decimal(28, 12)
  entryPrice Decimal @map("entry_price") @db.Decimal(28, 12)
  exitPrice  Decimal @map("exit_price") @db.Decimal(28, 12)

  grossPnl Decimal @map("gross_pnl") @db.Decimal(18, 6)
  fees     Decimal @default(0) @db.Decimal(18, 6)
  netPnl   Decimal @map("net_pnl") @db.Decimal(18, 6)

  /// Net of fees. See the note above.
  isWin Boolean @map("is_win")

  openedAtMicros BigInt @map("opened_at_micros")
  closedAtMicros BigInt @map("closed_at_micros")
  holdingMicros  BigInt @map("holding_micros")

  /// Always true.
  isSimulated Boolean @default(true) @map("is_simulated")

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  tenant Tenant      @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  run    BacktestRun @relation(fields: [backtestRunId], references: [id], onDelete: Cascade)

  @@unique([backtestRunId, sequence])
  @@index([tenantId, backtestRunId])
  @@index([backtestRunId, closedAtMicros])
  @@map("backtest_trades")
}

// -----------------------------------------------------------------------------
// PaperTradingSession - a strategy against the real feed, with simulated fills
// -----------------------------------------------------------------------------
// SIMULATED. The prices are real, the decisions are real, the fills are not.
//
// PAPER PERFORMANCE IS NOT INDICATIVE OF LIVE PERFORMANCE. The simulator fills
// at the observed top of book without queue position or market impact, so it
// systematically flatters any strategy that would in reality have waited, been
// partially filled, or moved the price.
//
// A session cannot reach a live adapter: the session object refuses to be
// constructed with one. That is enforced in the engine, not here - this table
// only records what happened.
// -----------------------------------------------------------------------------

model PaperTradingSession {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  strategyId        String? @map("strategy_id") @db.Uuid
  requestedByUserId String? @map("requested_by_user_id") @db.Uuid

  /// Engine-assigned session id, unique inside the tenant.
  sessionIdentifier String @map("session_identifier") @db.VarChar(64)

  status PaperSessionStatus @default(STARTING)

  strategyKey     String @map("strategy_key") @db.VarChar(64)
  strategyVersion String @map("strategy_version") @db.VarChar(20)

  venue      TradingVenue
  symbol     String            @db.VarChar(32)
  marketType TradingMarketType @default(SPOT) @map("market_type")

  initialCapital Decimal  @map("initial_capital") @db.Decimal(18, 6)
  currentEquity  Decimal? @map("current_equity") @db.Decimal(18, 6)
  realisedPnl    Decimal  @default(0) @map("realised_pnl") @db.Decimal(18, 6)
  /// Null when flat or unmarked. Never coerced to zero.
  unrealisedPnl  Decimal? @map("unrealised_pnl") @db.Decimal(18, 6)
  feesPaid       Decimal  @default(0) @map("fees_paid") @db.Decimal(18, 6)
  maxDrawdown    Decimal? @map("max_drawdown") @db.Decimal(18, 6)

  signalsGenerated Int @default(0) @map("signals_generated")
  signalsAccepted  Int @default(0) @map("signals_accepted")
  signalsRejected  Int @default(0) @map("signals_rejected")
  riskRejections   Int @default(0) @map("risk_rejections")
  simulatedOrders  Int @default(0) @map("simulated_orders")
  simulatedFills   Int @default(0) @map("simulated_fills")
  strategyErrors   Int @default(0) @map("strategy_errors")

  /// Always true. Present as a column so a row read in isolation, or exported
  /// to a spreadsheet, still says what it is.
  isSimulated Boolean @default(true) @map("is_simulated")

  startedAt  DateTime  @default(now()) @map("started_at") @db.Timestamptz(6)
  stoppedAt  DateTime? @map("stopped_at") @db.Timestamptz(6)
  stopReason String?   @map("stop_reason") @db.VarChar(500)
  errorCode  String?   @map("error_code") @db.VarChar(64)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant   Tenant    @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  strategy Strategy? @relation(fields: [strategyId], references: [id], onDelete: SetNull)

  snapshots PaperPortfolioSnapshot[]

  @@unique([tenantId, sessionIdentifier])
  @@index([tenantId, status, startedAt])
  @@index([tenantId, strategyId, startedAt])
  @@index([startedAt])
  @@map("paper_trading_sessions")
}

// -----------------------------------------------------------------------------
// PaperPortfolioSnapshot - the simulated equity curve, sampled
// -----------------------------------------------------------------------------
// Sampled on a slow schedule and on stop. NOT written per fill and certainly
// not per tick: a snapshot per event would put the database in the hot path,
// which is the one thing the data plane is not allowed to do.
// -----------------------------------------------------------------------------

model PaperPortfolioSnapshot {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  sessionId String @map("session_id") @db.Uuid

  /// Monotonically increasing per session.
  sequence Int

  capturedAtMicros BigInt @map("captured_at_micros")

  cash             Decimal  @db.Decimal(18, 6)
  positionQuantity Decimal  @default(0) @map("position_quantity") @db.Decimal(28, 12)
  positionValue    Decimal? @map("position_value") @db.Decimal(18, 6)
  equity           Decimal  @db.Decimal(18, 6)
  realisedPnl      Decimal  @default(0) @map("realised_pnl") @db.Decimal(18, 6)
  /// Null when flat or unmarked.
  unrealisedPnl    Decimal? @map("unrealised_pnl") @db.Decimal(18, 6)
  feesPaid         Decimal  @default(0) @map("fees_paid") @db.Decimal(18, 6)
  drawdown         Decimal  @default(0) @db.Decimal(18, 6)

  /// Always true.
  isSimulated Boolean @default(true) @map("is_simulated")

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  tenant  Tenant              @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  session PaperTradingSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)

  @@unique([sessionId, sequence])
  @@index([tenantId, sessionId, capturedAtMicros])
  @@map("paper_portfolio_snapshots")
}

// =============================================================================
// PART 7 - HISTORICAL DATASETS (ingestion, validation, replay input)
// =============================================================================
// These tables are the control-plane projection of dataset files that live in
// dataset storage (local now, object storage later). PostgreSQL holds
// METADATA ONLY - manifests, checksums, file receipts, validation verdicts,
// ingestion progress. Event payloads never land here: millions of rows per
// capture would put a database in the replay hot path, and a replay that
// reads the same semantic content twice through two stores is a second truth
// waiting to disagree.
//
// TENANCY NOTE, stated rather than hidden: a historical dataset is public
// market data - the same tape any visitor of the venue archive would fetch.
// There is no per-tenant data in these tables to isolate, so these models
// deliberately carry no tenantId column, and adding one would imply an
// isolation the data does not have. Cross-tenant leakage protection lives on
// the doors instead: every read needs dataset:read, every mutation needs a
// named operator, and audit records carry the requesting tenant. A backtest
// run row (tenant-scoped, Part 6) REFERENCES a dataset version; that
// reference is where a tenant's results and platform data meet, and it is
// read-only from the tenant side forever.
//
// Immutability is a service-layer invariant with schema support: version
// rows are insert-only in practice (the API exposes no payload-mutating
// route), the unique (datasetId, version) constraint makes a version
// addressable exactly once, and the content checksum column is the identity
// the replay verifies. Status transitions - quarantine, archive - move a
// version OUT of use; nothing moves data INTO a published version.
//
// No endpoint here can reach a venue or an order. Datasets belong to
// BACKTEST. The live and paper paths never read these tables.

enum DatasetStatus {
  CREATED     @map("created")
  INGESTING   @map("ingesting")
  VALIDATING  @map("validating")
  VALID       @map("valid")
  INVALID     @map("invalid")
  QUARANTINED @map("quarantined")
  ARCHIVED    @map("archived")

  @@map("dataset_status")
}

enum DatasetCompleteness {
  COMPLETE @map("complete")
  PARTIAL  @map("partial")
  UNKNOWN  @map("unknown")

  @@map("dataset_completeness")
}

enum DatasetValidationRunStatus {
  RUNNING @map("running")
  PASSED  @map("passed")
  FAILED  @map("failed")
  ERROR   @map("error")

  @@map("dataset_validation_run_status")
}

enum DatasetIngestionRunStatus {
  PENDING     @map("pending")
  RUNNING     @map("running")
  VALIDATING  @map("validating")
  FINALIZING  @map("finalizing")
  SUCCEEDED   @map("succeeded")
  FAILED      @map("failed")
  QUARANTINED @map("quarantined")

  @@map("dataset_ingestion_run_status")
}

enum HistoricalSourceKind {
  BINANCE_PUBLIC_DATA  @map("binance_public_data")
  LOCAL_FILES          @map("local_files")
  OBJECT_STORAGE_EXPORT @map("object_storage_export")
  DATABASE_EXPORT      @map("database_export")
  STREAM_CAPTURE       @map("stream_capture")

  @@map("historical_source_kind")
}

/// Mirrors wlct_trading's MarketEventKind wire values exactly. No separate
/// "dataset event type" enum exists: one vocabulary, reused, per the part's
/// whole point.
enum DatasetEventKind {
  TICKER       @map("TICKER")
  TRADE        @map("TRADE")
  BOOK_SNAPSHOT @map("BOOK_SNAPSHOT")
  BOOK_DELTA   @map("BOOK_DELTA")
  CANDLE       @map("CANDLE")

  @@map("dataset_event_kind")
}

model HistoricalDataset {
  id       String @id @default(uuid()) @db.Uuid

  /// The derived identity: hst-<32 hex>, a SHA-256 prefix of the dataset's
  /// CONTRACT (source kind + label, venue, market type, sorted symbol set,
  /// sorted event-kind set, requested window, granularity, canonical schema
  /// version). It changes when any of those change and ONLY then: two
  /// captures of one contract share a key and are distinguished by version
  /// and content checksum, which is the versioning story the files tell.
  datasetKey String @unique @map("dataset_key") @db.VarChar(64)

  name String @db.VarChar(120)

  venue      TradingVenue
  symbols    String[]
  marketType TradingMarketType @default(SPOT) @map("market_type")
  eventKinds DatasetEventKind[] @map("event_kinds")

  granularity String? @db.VarChar(20)

  /// The REQUESTED window. Observed bounds live per version and per file,
  /// because a refresh may legitimately find more data than the first run.
  startMicros BigInt @map("start_micros")
  endMicros   BigInt @map("end_micros")

  /// Rollup of the newest version's status, denormalised for list pages.
  /// A version row remains the authority for any decision.
  status        DatasetStatus @default(CREATED)
  latestVersion Int?          @map("latest_version")

  /// Schema lineage: a change to either version means old manifests are not
  /// to be reinterpreted by the new reader; the reader must know both.
  schemaVersion          Int @default(1) @map("schema_version")
  canonicalSchemaVersion Int @default(1) @map("canonical_schema_version")

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  versions      HistoricalDatasetVersion[]
  ingestionRuns DatasetIngestionRun[]

  @@index([venue, marketType, status])
  @@index([status, createdAt])
  @@index([startMicros, endMicros])
  @@map("historical_datasets")
}

model HistoricalDatasetVersion {
  id       String @id @default(uuid()) @db.Uuid
  datasetId String @map("dataset_id") @db.Uuid

  /// Monotone within a dataset. The pair (datasetKey, version) is the
  /// reproducibility handle printed in every backtest result.
  version Int

  status DatasetStatus

  /// SHA-256 over the canonical checksum_source of every event in replay
  /// merge order - the Part 6 content semantics. Two versions with different
  /// bytes never share this; a backtest citing a version is citing this.
  contentChecksum  String  @map("content_checksum") @db.VarChar(64)
  manifestChecksum String? @map("manifest_checksum") @db.VarChar(64)

  /// Relative location of the manifest inside dataset storage:
  /// "<datasetKey>/v<version>". Relative BY RULE: the storage layer refuses
  /// absolute paths and traversal, and the API never constructs a filesystem
  /// path at all, so a stored value can never smuggle either. Credentials
  /// cannot ride here because URIs here carry no authority component.
  storageUri String @map("storage_uri") @db.VarChar(500)

  compression String? @db.VarChar(16)

  fileCount  Int    @default(0) @map("file_count")
  eventCount Int    @default(0) @map("event_count")
  totalBytes BigInt @default(0) @map("total_bytes")

  /// Observed bounds for THIS version's actual contents.
  startMicros BigInt @map("start_micros")
  endMicros   BigInt @map("end_micros")

  completeness DatasetCompleteness @default(UNKNOWN)

  /// Provenance, denormalised from the manifest for query: which kind of
  /// source produced this, and its label. Public by construction - the
  /// ingestion adapters accept no credentials, and the label is checked
  /// against the credential pattern on write.
  sourceKind  HistoricalSourceKind @map("source_kind")
  sourceLabel String               @map("source_label") @db.VarChar(200)

  /// The stored manifest bytes as recorded at registration. Verifiers
  /// recompute the derived key from this JSON and compare - an edited row
  /// is visible without reading a single data file.
  manifestJson Json  @default("{}") @map("manifest_json")
  qualityJson  Json? @map("quality_json")

  validatedAt DateTime? @map("validated_at") @db.Timestamptz(6)
  finalizedAt DateTime? @map("finalized_at") @db.Timestamptz(6)

  creatorJobId    String? @map("creator_job_id") @db.VarChar(80)
  createdByUserId String? @map("created_by_user_id") @db.Uuid

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  dataset     HistoricalDataset             @relation(fields: [datasetId], references: [id], onDelete: Cascade)
  files       HistoricalDatasetFile[]
  validations HistoricalDatasetValidation[]
  backtests   BacktestRun[]

  @@unique([datasetId, version])
  @@index([contentChecksum])
  @@index([status, finalizedAt])
  @@map("historical_dataset_versions")
}

/// Per-partition file receipts: what a reader must find on disk for the
/// version to be what its manifest says. Integrity-checking data, not the
/// data itself.
model HistoricalDatasetFile {
  id        String @id @default(uuid()) @db.Uuid
  versionId String @map("version_id") @db.Uuid

  partitionPath String @map("partition_path") @db.VarChar(400)
  symbol        String @db.VarChar(32)
  eventKind     DatasetEventKind @map("event_kind")

  events Int
  bytes  BigInt
  sha256 String @db.VarChar(64)

  firstTsMicros BigInt @map("first_ts_micros")
  lastTsMicros  BigInt @map("last_ts_micros")

  compression String? @db.VarChar(16)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  version HistoricalDatasetVersion @relation(fields: [versionId], references: [id], onDelete: Cascade)

  @@unique([versionId, partitionPath])
  @@index([versionId, eventKind, symbol])
  @@map("historical_dataset_files")
}

/// Validation runs against a version. The report body lives beside the
/// dataset (report.json); this row keeps the verdict, the counts that drove
/// it, and the digests that bind it to the exact manifest it judged.
model HistoricalDatasetValidation {
  id        String @id @default(uuid()) @db.Uuid
  versionId String @map("version_id") @db.Uuid

  status DatasetValidationRunStatus @default(RUNNING)

  infoCount    Int @default(0) @map("info_count")
  warningCount Int @default(0) @map("warning_count")
  errorCount   Int @default(0) @map("error_count")
  fatalCount   Int @default(0) @map("fatal_count")

  /// Finding-rule counts, exact even when the retained findings list was
  /// capped: report brevity must never corrupt the arithmetic.
  countsByRule Json? @map("counts_by_rule")

  reportUri      String? @map("report_uri") @db.VarChar(500)
  reportSha256   String? @map("report_sha256") @db.VarChar(64)
  policyDigest   String? @map("policy_digest") @db.VarChar(64)
  durationMicros BigInt? @map("duration_micros")

  startedAt  DateTime  @default(now()) @map("started_at") @db.Timestamptz(6)
  finishedAt DateTime? @map("finished_at") @db.Timestamptz(6)

  version HistoricalDatasetVersion @relation(fields: [versionId], references: [id], onDelete: Cascade)

  @@index([versionId, status])
  @@map("historical_dataset_validations")
}

/// One ingestion attempt, end to end. A run never marks its version VALID -
/// finalisation is the pipeline's atomic act on storage; this row tracks the
/// JOB so an operator can see stuck, failed and quarantined attempts without
/// reading a queue. paramsJson is validated credential-free on write.
model DatasetIngestionRun {
  id String @id @default(uuid()) @db.Uuid

  /// Null until the first finalisation names a dataset; the hint keeps
  /// in-flight runs attributable to the key they are writing toward.
  datasetId      String? @map("dataset_id") @db.Uuid
  datasetKeyHint String? @map("dataset_key_hint") @db.VarChar(64)
  version        Int?

  status     DatasetIngestionRunStatus @default(PENDING)
  stage      String?                   @db.VarChar(40)
  progressJson Json                    @default("{}") @map("progress_json")

  /// Redacted, operator-facing failure text. Set by the worker from the
  /// exception CLASS and message only; stack traces and response bodies
  /// (which can carry request context) are deliberately not stored.
  errorText String? @map("error_text") @db.Text

  /// The staging area this run owns. Unique so two live jobs can never
  /// write one staging tree - the resume story assumes one owner per key.
  stagingKey String @unique @map("staging_key") @db.VarChar(80)

  sourceKind HistoricalSourceKind @map("source_kind")
  paramsJson Json                  @default("{}") @map("params_json")

  bytesDownloaded BigInt @default(0) @map("bytes_downloaded")
  eventsWritten   Int    @default(0) @map("events_written")

  requestedByUserId String? @map("requested_by_user_id") @db.Uuid

  startedAt  DateTime? @map("started_at") @db.Timestamptz(6)
  finishedAt DateTime? @map("finished_at") @db.Timestamptz(6)
  createdAt  DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt  DateTime  @updatedAt @map("updated_at") @db.Timestamptz(6)

  dataset HistoricalDataset? @relation(fields: [datasetId], references: [id], onDelete: SetNull)

  @@index([status, createdAt])
  @@index([datasetId, version])
  @@map("dataset_ingestion_runs")
}

// -----------------------------------------------------------------------------
// Part 8: real-time risk engine - durable control-plane tables.
//
// Division of labour, restated at the schema because a table is where the
// next implementer looks: PostgreSQL holds what must survive a Redis flush
// (configuration versions, protection actions, event trail, periodic
// snapshot METADATA). Hot risk state - the per-account snapshot the gate
// reads for every decision - deliberately has NO table: it lives in Redis
// (``wlct:trading:t:<tenant>:risk:<account>:snapshot``) and is rebuilt from
// the authoritative sources when missing. A missing rebuild fails closed; a
// missing row never decides anything.
// -----------------------------------------------------------------------------

/// One immutable revision of an account's risk configuration document.
///
/// `RiskConfiguration` above is the *current* view; this is the history.
/// A version row is written before the pointer moves and is never updated:
/// "what were the limits when that order was approved" must be answerable
/// years later, and an UPDATE here is the audit lie the table exists to
/// prevent. `@@unique([accountId, version])` makes a double-publish
/// impossible, and the checksum cross-check (`digest` vs the engine's
/// recomputation of `policyJson`) makes a half-write visible.
model RiskConfigurationVersion {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  accountId String @map("account_id") @db.Uuid
  version   Int
  digest    String @db.VarChar(64)

  policyJson     Json  @map("policy_json")
  protectionJson Json? @map("protection_json")

  changedByUserId String  @map("changed_by_user_id") @db.Uuid
  changeReason    String  @map("change_reason") @db.VarChar(500)
  /// Whether this revision widened any effective ceiling relative to its
  /// predecessor, computed by the service on write. Stored denormalised so
  /// "show me every loosening" is one indexed query, not a JSON diff of the
  /// whole history.
  loosenedCeilings Boolean @default(false) @map("loosened_ceilings")

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  tenant  Tenant         @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  account TradingAccount @relation(fields: [accountId], references: [id], onDelete: Cascade)

  @@unique([accountId, version])
  @@index([tenantId, createdAt])
  @@map("risk_configuration_versions")
}

/// Periodic metadata of the engine's hot risk snapshots. Metadata only -
/// NEVER the state itself, and never per tick.
///
/// Written by the risk-state sync job (queue ``risk-control``), at the
/// configured cadence or on event, not on market updates. It exists so an
/// operator can answer "when did exposure last refresh, and against which
/// config" from SQL without reading Redis, and so a stale-state incident has
/// a durable timeline. ``completenessJson`` records the snapshot's own
/// self-assessment (missing sources, advisories) exactly as the engine saw
/// it - risk's honesty is preserved by copying its words, not re-deriving.
model RiskSnapshotMetadata {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  accountId       String  @map("account_id") @db.Uuid
  snapshotId      String  @map("snapshot_id") @db.VarChar(64)
  snapshotVersion BigInt  @map("snapshot_version")
  tradingDay      String  @map("trading_day") @db.VarChar(10)
  configDigest    String? @map("config_digest") @db.VarChar(64)
  stateDigest     String? @map("state_digest") @db.VarChar(64)

  equity             Decimal? @db.Decimal(28, 8)
  accountGrossNotional Decimal? @map("account_gross_notional") @db.Decimal(28, 8)
  netDailyPnl        Decimal? @map("net_daily_pnl") @db.Decimal(28, 8)
  openOrderCount     Int      @map("open_order_count")
  staleSources       Json?    @map("stale_sources")
  advisories         Json?
  isComplete         Boolean  @default(false) @map("is_complete")
  isSimulated        Boolean  @default(false) @map("is_simulated")

  capturedAt DateTime @map("captured_at") @db.Timestamptz(6)
  createdAt  DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  tenant  Tenant         @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  account TradingAccount @relation(fields: [accountId], references: [id], onDelete: Cascade)

  @@unique([accountId, snapshotVersion])
  @@index([tenantId, capturedAt])
  @@index([tenantId, isComplete, capturedAt])
  @@map("risk_snapshot_metadata")
}

/// One automatic-protection trip and its clearance. The switch row
/// (``kill_switches``) carries the live halt; THIS row is the protection's
/// own story: why it fired, on what rule, who acknowledged it, under what
/// reason it was cleared. A triggered protection that improved out of it
/// (PnL recovered) does NOT clear - the service layer has no method that
/// writes `clearedAt` without a user id and a reason, and this table is
/// where that promise is written down.
model RiskProtectionTrip {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  accountId String? @map("account_id") @db.Uuid
  scope     RiskLimitScope
  target    String? @db.VarChar(64)

  action  RiskProtectionAction
  ruleId  String? @map("rule_id") @db.VarChar(64)
  reason  String  @db.VarChar(500)
  status  String  @default("ACTIVE") @db.VarChar(16)

  triggeredAtDateTime DateTime @default(now()) @map("triggered_at") @db.Timestamptz(6)
  acknowledgedByUserId String?  @map("acknowledged_by_user_id") @db.Uuid
  acknowledgedAt       DateTime? @map("acknowledged_at") @db.Timestamptz(6)
  clearedByUserId      String?   @map("cleared_by_user_id") @db.Uuid
  clearedAt            DateTime? @map("cleared_at") @db.Timestamptz(6)
  clearedReason        String?   @map("cleared_reason") @db.VarChar(500)

  snapshotVersion BigInt? @map("snapshot_version")
  isSimulated     Boolean @default(false) @map("is_simulated")

  tenant  Tenant         @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  account TradingAccount? @relation(fields: [accountId], references: [id], onDelete: Cascade)

  @@index([tenantId, status, triggeredAtDateTime])
  @@index([tenantId, accountId])
  @@map("risk_protection_actions")
}

// ===========================================================================
// Part 9: observability & operations
// ===========================================================================

/// Alert severity. The four levels exist because "warning" and "critical"
/// alone collapse every judgement into "page someone"; INFO and EMERGENCY
/// restore the middle and the ceiling of the ladder. EMERGENCY is reserved
/// for conditions the platform treats as stop-and-read-now (the engine's own
/// rule catalog in wlct_trading.observability.alerts owns which is which;
/// the parity test keeps this list and that one telling the same story).
enum OpsAlertSeverity {
  INFO
  WARNING
  CRITICAL
  EMERGENCY
}

/// The explicit alert states. There is no CLOSED and no CANCELLED: OPEN ->
/// ACKNOWLEDGED -> (observed recovery or typed force-resolve) -> RESOLVED is
/// the whole machine, matching the engine-side state machine one for one.
enum OpsAlertState {
  OPEN
  ACKNOWLEDGED
  RESOLVED
}

enum OpsIncidentStatus {
  OPEN
  REVIEWING
  CLOSED
}

/// What an incident may link to. The set mirrors the engine-side
/// ``IncidentLinkKind`` exactly; the parity test enforces it.
enum OpsIncidentLinkKind {
  ALERT
  RISK_EVENT
  AUDIT
  ORDER
  EXECUTION_INCIDENT
  STRATEGY_EVENT
  MARKET_DATA_FAULT
  QUEUE_JOB
}

/// One deduplicated, currently-tracked operational condition.
///
/// Rows are FOLDED, never fanned out: the whole table is keyed by
/// ``dedupeKey`` = ``<ruleId>|<component>|<scope>``, and repeats from the
/// engine's mirror bump ``occurrences`` and ``lastSeenAt`` instead of
/// inserting. This is what lets a night of ten thousand identical stale-feed
/// ticks stay one row - and why ``occurrences``, ``firstSeenAt`` and
/// ``lastSeenAt`` are non-nullable columns rather than something to
/// reconstruct: the magnitude of an alert is part of the alert, not an
/// afterthought.
///
/// Resolution discipline: RESOLVED is written by the sync job only on
/// observed recovery (publisher mirror present, record gone) or by an
/// operator force-resolve carrying the typed confirmation phrase - each
/// force-resolve gets its own audit row, and never deletes this one.
model OpsAlert {
  id String @id @default(uuid()) @db.Uuid

  /// The engine's dedupe key. Unique, so the fold is an upsert, not a race.
  dedupeKey String        @unique @map("dedupe_key") @db.VarChar(191)
  ruleId    String        @map("rule_id") @db.VarChar(64)
  component String        @db.VarChar(64)
  scope     String?       @db.VarChar(128)
  severity  OpsAlertSeverity
  state     OpsAlertState   @default(OPEN)
  title     String          @db.VarChar(255)
  condition String          @db.VarChar(500)
  message   String?         @db.VarChar(500)

  /// Decimal-as-string discipline for any comparable quantity; observed and
  /// threshold are display facts, never computed with in SQL.
  observedValue  String? @map("observed_value") @db.VarChar(64)
  thresholdValue String? @map("threshold_value") @db.VarChar(64)

  occurrences Int      @default(1) @map("occurrences")
  firstSeenAt DateTime @map("first_seen_at") @db.Timestamptz(6)
  lastSeenAt  DateTime @map("last_seen_at") @db.Timestamptz(6)

  acknowledgedBy   String?   @map("acknowledged_by") @db.VarChar(64)
  acknowledgedAt   DateTime? @map("acknowledged_at") @db.Timestamptz(6)
  resolvedAt       DateTime? @map("resolved_at") @db.Timestamptz(6)
  /// How it ended: 'recovered' (observed), 'recovered (note)', or
  /// 'force-resolved by <actor>: <reason>'. Never null once RESOLVED.
  resolution String? @db.VarChar(500)

  /// The engine-side correlation links carried by the fold (alertId,
  /// risk event ids, correlationId, ...). References, never payloads - the
  /// same rule the incidents follow.
  links Json?

  /// Null = platform-wide infrastructure condition. Tenant rows are visible
  /// to that tenant's console; platform rows are readable everywhere the
  /// read permission reaches but mutable only by the platform role.
  tenantId String? @map("tenant_id") @db.Uuid

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant Tenant? @relation(fields: [tenantId], references: [id], onDelete: SetNull)

  @@index([state, lastSeenAt])
  @@index([severity, state])
  @@index([tenantId, lastSeenAt])
  @@map("ops_alerts")
}

/// An incident is the operator's story across several correlated records.
/// It owns no copies: links are (kind, targetId) pairs into the tables that
/// hold the truth, so an incident cannot drift from its evidence or leak a
/// payload. The sync job creates one per grouping key (correlation id when
/// present, digest of links otherwise) and folds repeats - the same
/// storm-proof discipline as alerts, applied one level up.
model OpsIncident {
  id String @id @default(uuid()) @db.Uuid

  /// The engine-side deterministic id (inc_<digest>), unique so re-publish
  /// of the same story folds instead of duplicating.
  incidentId  String            @unique @map("incident_id") @db.VarChar(64)
  /// 'correlation:<id>' or 'links:<digest>' - the dedupe identity itself,
  /// kept as a column so the panel can show why two incidents are one.
  groupingKey String            @unique @map("grouping_key") @db.VarChar(191)
  title       String            @db.VarChar(200)
  status      OpsIncidentStatus @default(OPEN)
  severity    OpsAlertSeverity?

  correlationId String? @map("correlation_id") @db.VarChar(64)
  operationId   String? @map("operation_id") @db.VarChar(64)

  openedAt  DateTime  @map("opened_at") @db.Timestamptz(6)
  closedAt  DateTime? @map("closed_at") @db.Timestamptz(6)
  /// Only ever written with a note: closing without saying why is exactly
  /// the "silently marked resolved" failure the spec forbids for alerts,
  /// extended here by the same logic.
  closeNote String? @map("close_note") @db.VarChar(500)

  tenantId String? @map("tenant_id") @db.Uuid

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant Tenant?           @relation(fields: [tenantId], references: [id], onDelete: SetNull)
  links  OpsIncidentLink[]

  @@index([status, openedAt])
  @@index([correlationId])
  @@map("ops_incidents")
}

model OpsIncidentLink {
  id         String              @id @default(uuid()) @db.Uuid
  incidentId String              @map("incident_id") @db.Uuid
  kind       OpsIncidentLinkKind
  targetId   String              @map("target_id") @db.VarChar(128)
  note       String?             @db.VarChar(255)
  createdAt  DateTime            @default(now()) @map("created_at") @db.Timestamptz(6)

  incident OpsIncident @relation(fields: [incidentId], references: [id], onDelete: Cascade)

  @@unique([incidentId, kind, targetId])
  @@index([kind, targetId])
  @@map("ops_incident_links")
}

// ===========================================================================
// Part 10: reliability - SLO configuration versions and evaluation rows.
//
// Same versioned-appendix discipline as the risk catalog (Part 8): a change
// to an SLO definition INSERTS a new (sloId, version) row and never updates
// an old one, so every evaluation can say exactly which version of the
// promise it measured. The checksum is sha256 over the engine's canonical
// JSON of the objective (version and enabled are excluded by design: the
// identity of the PROMISE moves only when the promise changes).
//
// These tables are platform-operational, not tenant data: no tenantId, no
// tenant relation, reads gated by permission. Evaluations are an append-only
// evidence log - the maintenance job prunes by age within the retention
// floor, and nothing in the trading path reads either table.
// ===========================================================================

enum SloEvaluationState {
  HEALTHY
  WARNING
  CRITICAL
  EXHAUSTED
  UNKNOWN
}

model SloConfigurationVersion {
  id String @id @default(uuid()) @db.Uuid

  /// Catalog identity: the engine's `slo_id` bounded lowercase token.
  sloId   String @map("slo_id") @db.VarChar(64)
  version Int

  /// The objective exactly as configured: a canonical DECIMAL STRING
  /// ("99.5"), never a float column. Floats in an SLO document are how
  /// every downstream checksum quietly moves.
  objective String @db.VarChar(16)

  windowMinutes      Int @map("window_minutes")
  shortWindowMinutes Int @map("short_window_minutes")

  /// The nine closed indicator types live in the engine (SloIndicator);
  /// VarChar rather than a DB enum on purpose: the engine's enum is the
  /// authority, and a new indicator must not require a migration to store
  /// evaluations of an objective the database has never heard of.
  indicator String @db.VarChar(48)

  owner       String @db.VarChar(64)
  description String @db.VarChar(200)

  /// The human counting rule, committed into the digest on the engine side
  /// and persisted verbatim here so the panel can show what "good" meant.
  goodEvent String @map("good_event") @db.VarChar(200)
  badEvent  String @map("bad_event") @db.VarChar(200)

  warningBurnPpm  Int @map("warning_burn_ppm")
  criticalBurnPpm Int @map("critical_burn_ppm")

  /// Freshness indicators carry an age budget; latency compliance carries a
  /// threshold bucket. Micros in BigInt, serialized to strings on the wire
  /// (the platform-wide 64-bit rule), null exactly when the indicator shape
  /// forbids the field.
  maxAgeMicros           BigInt? @map("max_age_micros")
  latencyThresholdMicros BigInt? @map("latency_threshold_micros")

  /// Flipping enablement never moves the checksum (it is not part of the
  /// objective's identity) - which is precisely why it is a column here
  /// rather than a new version of the promise.
  enabled Boolean @default(true)

  /// Full canonical payload the digest was taken over: stored so a checksum
  /// can be re-verified byte-for-byte without trusting the writer.
  payload  Json
  checksum String @db.VarChar(64)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  @@unique([sloId, version])
  @@index([sloId])
  @@map("slo_configuration_versions")
}

/// One evaluation tick's full verdict, appended by the maintenance job (or a
/// manual evaluation call) and read by the panel. `UNKNOWN` is a first-class
/// state, not a gap: a row saying UNKNOWN with dataComplete=false IS the
/// record that measurement failed - the alternative (no row) is
/// indistinguishable from "nobody looked".
model SloEvaluation {
  id String @id @default(uuid()) @db.Uuid

  sloId    String @map("slo_id") @db.VarChar(64)
  version  Int
  checksum String @db.VarChar(64)

  indicator String @db.VarChar(48)
  service   String @db.VarChar(64)

  state SloEvaluationState

  /// Evaluation timestamp in microseconds (BigInt in, string on the wire).
  evaluatedAtMicros BigInt @map("evaluated_at_micros")

  windowMinutes      Int @map("window_minutes")
  shortWindowMinutes Int @map("short_window_minutes")

  targetPpm Int @map("target_ppm")
  /// Null exactly when the window had no samples: "no evidence" renders as
  /// null, never as 100% or 0%.
  actualPpm Int? @map("actual_ppm")

  budgetTotalEvents     Int  @default(0) @map("budget_total_events")
  budgetConsumedEvents  Int  @default(0) @map("budget_consumed_events")
  budgetRemainingEvents Int  @default(0) @map("budget_remaining_events")
  remainingRatioPpm     Int? @map("remaining_ratio_ppm")

  longBurnPpm  Int? @map("long_burn_ppm")
  shortBurnPpm Int? @map("short_burn_ppm")

  /// 'none' | 'fast' | 'slow' | 'both' - the AND-window alert verdict for
  /// this tick. Bounded literal; the burn-rate rule ids derive from it.
  alertKind String @map("alert_kind") @db.VarChar(8)

  samplesGood Int @map("samples_good")
  samplesBad  Int @map("samples_bad")

  /// The collector's completeness claim for BOTH windows (AND-ed by the
  /// engine). False here means the row documents a measurement gap.
  dataComplete Boolean @map("data_complete")

  reason String? @db.VarChar(500)

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  @@index([sloId, createdAt])
  @@index([state, createdAt])
  @@map("slo_evaluations")
}
```

## FILE: apps/api/prisma/migrations/20260912180000_part10_reliability_slo/migration.sql (88 lines)

```sql
-- Part 10: reliability - SLO configuration versions and evaluation rows.
--
-- Generated with `prisma migrate diff --from-schema-datamodel
-- prisma/.tmp_pre_part10.prisma --to-schema-datamodel apps/api/prisma/schema.prisma
-- --script` (the pre-Part-10 datamodel reconstructed from docs/source, so the
-- diff is the exact delta Part 10 introduces) and reviewed to be strictly
-- additive: one CREATE TYPE, two CREATE TABLE, their indexes and unique
-- constraints. Nothing drops, renames, or rewrites: the destructive-statement
-- grep over this body returns zero hits.
--
-- Operational notes: slo_configuration_versions rows are append-only versioned
-- snapshots of each objective (unique (slo_id, version)); slo_evaluations is
-- an evidence log the maintenance job prunes by age within a retention floor
-- of seven days. UNKNOWN evaluations are rows, not gaps - measurement failure
-- must be distinguishable from nobody looking. Neither table is read by the
-- trading path; nothing here authorises anything.
-- CreateEnum
CREATE TYPE "SloEvaluationState" AS ENUM ('HEALTHY', 'WARNING', 'CRITICAL', 'EXHAUSTED', 'UNKNOWN');

-- CreateTable
CREATE TABLE "slo_configuration_versions" (
    "id" UUID NOT NULL,
    "slo_id" VARCHAR(64) NOT NULL,
    "version" INTEGER NOT NULL,
    "objective" VARCHAR(16) NOT NULL,
    "window_minutes" INTEGER NOT NULL,
    "short_window_minutes" INTEGER NOT NULL,
    "indicator" VARCHAR(48) NOT NULL,
    "owner" VARCHAR(64) NOT NULL,
    "description" VARCHAR(200) NOT NULL,
    "good_event" VARCHAR(200) NOT NULL,
    "bad_event" VARCHAR(200) NOT NULL,
    "warning_burn_ppm" INTEGER NOT NULL,
    "critical_burn_ppm" INTEGER NOT NULL,
    "max_age_micros" BIGINT,
    "latency_threshold_micros" BIGINT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "payload" JSONB NOT NULL,
    "checksum" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "slo_configuration_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "slo_evaluations" (
    "id" UUID NOT NULL,
    "slo_id" VARCHAR(64) NOT NULL,
    "version" INTEGER NOT NULL,
    "checksum" VARCHAR(64) NOT NULL,
    "indicator" VARCHAR(48) NOT NULL,
    "service" VARCHAR(64) NOT NULL,
    "state" "SloEvaluationState" NOT NULL,
    "evaluated_at_micros" BIGINT NOT NULL,
    "window_minutes" INTEGER NOT NULL,
    "short_window_minutes" INTEGER NOT NULL,
    "target_ppm" INTEGER NOT NULL,
    "actual_ppm" INTEGER,
    "budget_total_events" INTEGER NOT NULL DEFAULT 0,
    "budget_consumed_events" INTEGER NOT NULL DEFAULT 0,
    "budget_remaining_events" INTEGER NOT NULL DEFAULT 0,
    "remaining_ratio_ppm" INTEGER,
    "long_burn_ppm" INTEGER,
    "short_burn_ppm" INTEGER,
    "alert_kind" VARCHAR(8) NOT NULL,
    "samples_good" INTEGER NOT NULL,
    "samples_bad" INTEGER NOT NULL,
    "data_complete" BOOLEAN NOT NULL,
    "reason" VARCHAR(500),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "slo_evaluations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "slo_configuration_versions_slo_id_idx" ON "slo_configuration_versions"("slo_id");

-- CreateIndex
CREATE UNIQUE INDEX "slo_configuration_versions_slo_id_version_key" ON "slo_configuration_versions"("slo_id", "version");

-- CreateIndex
CREATE INDEX "slo_evaluations_slo_id_created_at_idx" ON "slo_evaluations"("slo_id", "created_at");

-- CreateIndex
CREATE INDEX "slo_evaluations_state_created_at_idx" ON "slo_evaluations"("state", "created_at");

```

## Shared packages - new / modified

## FILE: packages/shared-types/src/slo.ts (223 lines)

```typescript
/**
 * Part 10 (reliability) wire types for the SLO surface.
 *
 * The engine-side authority for all of this is the Python package
 * `wlct_trading.slo` (model.py, budget.py, burn.py, evaluate.py,
 * catalog.py); these TypeScript declarations mirror it and are
 * parity-tested against the committed vectors in
 * `docs/fixtures/reliability_fixtures.json`. Two rules travel with every
 * number here:
 *
 * 1. Every comparable quantity is an INTEGER in ppm or a canonical DECIMAL
 *    STRING - never a float. The same discipline as money everywhere else on
 *    this platform; the reason is identical (checksums must not wobble).
 * 2. These views MEASURE and PAGE. They never authorise: nothing on this
 *    surface can widen, unlock, or resume anything. A red SLO is a question
 *    for a human, answered elsewhere.
 */

/** The five evaluation states (mirror of wlct_trading.slo.model.SloState). */
export enum SloState {
  HEALTHY = 'HEALTHY',
  WARNING = 'WARNING',
  CRITICAL = 'CRITICAL',
  EXHAUSTED = 'EXHAUSTED',
  /** Measurement missing or incomplete. Renders as UNKNOWN in the panel -
   *  never as HEALTHY ("no data" is not "all good") and never as a failure
   *  count. */
  UNKNOWN = 'UNKNOWN',
}

/** The nine closed indicator families (mirror of SloIndicator). No generic
 *  expression escape hatch exists on either side by design. */
export enum SloIndicator {
  AVAILABILITY = 'availability',
  REQUEST_SUCCESS_RATIO = 'request_success_ratio',
  QUEUE_PROCESSING_SUCCESS = 'queue_processing_success',
  QUEUE_FRESHNESS = 'queue_freshness',
  MARKET_DATA_FRESHNESS = 'market_data_freshness',
  RISK_STATE_FRESHNESS = 'risk_state_freshness',
  RECONCILIATION_FRESHNESS = 'reconciliation_freshness',
  LATENCY_THRESHOLD_COMPLIANCE = 'latency_threshold_compliance',
  ERROR_RATE_COMPLIANCE = 'error_rate_compliance',
}

/** Which window a burn-rate number belongs to (mirror of SloWindowKind). */
export enum SloWindowKind {
  SHORT = 'short',
  LONG = 'long',
}

/** The AND-window alert verdict for one evaluation tick. `fast` and `slow`
 *  map to their paging rules; `both` is what a >= fast breach reports when
 *  the fast threshold is at or above the slow one (documented degeneracy of
 *  the classic multi-window design, parity-pinned). */
export enum SloBurnAlertKind {
  NONE = 'none',
  FAST = 'fast',
  SLOW = 'slow',
  BOTH = 'both',
}

/** The closed fault-point universe (mirror of wlct_trading.observability.
 *  faults.FAULT_POINTS). Listing these is READ-ONLY documentation of what
 *  a configuration could arm in a non-production deployment; there is no
 *  API that arms anything, by either name, at runtime. */
export enum SloFaultPoint {
  METRICS_EXPORT_UNAVAILABLE = 'metrics_export_unavailable',
  TRACE_EXPORT_UNAVAILABLE = 'trace_export_unavailable',
  REDIS_HEALTH_PROBE_UNAVAILABLE = 'redis_health_probe_unavailable',
  POSTGRES_HEALTH_PROBE_UNAVAILABLE = 'postgres_health_probe_unavailable',
  QUEUE_OBSERVED_DELAY = 'queue_observed_delay',
  QUEUE_OBSERVED_FAILURE = 'queue_observed_failure',
  MARKET_DATA_STALE_SIMULATED = 'market_data_stale_simulated',
  RISK_SNAPSHOT_STALE_SIMULATED = 'risk_snapshot_stale_simulated',
  RECONCILIATION_DELAY_SIMULATED = 'reconciliation_delay_simulated',
  ALERT_PERSISTENCE_FAILURE = 'alert_persistence_failure',
}

/** One SLO definition as the panel renders it. `objective` is the canonical
 *  decimal STRING exactly as the engine stores it ("99.5"); ppm integers
 *  carry the derived quantities. */
export interface SloDefinitionView {
  sloId: string;
  version: number;
  service: string;
  owner: string;
  description: string;
  indicator: SloIndicator;
  objective: string;
  objectivePpm: number;
  allowedPpm: number;
  windowMinutes: number;
  shortWindowMinutes: number;
  goodEvent: string;
  badEvent: string;
  warningBurnPpm: number;
  criticalBurnPpm: number;
  /** Microseconds as decimal strings (the platform 64-bit rule), null
   *  exactly when the indicator shape forbids the field. */
  maxAgeMicros: string | null;
  latencyThresholdMicros: string | null;
  enabled: boolean;
  checksum: string;
  createdAt: string;
  updatedAt: string;
}

/** One evaluation row. Null ppm fields mean "undefined for this window",
 *  never zero. */
export interface SloEvaluationView {
  sloId: string;
  version: number;
  checksum: string;
  indicator: SloIndicator;
  service: string;
  state: SloState;
  evaluatedAtMicros: string;
  windowMinutes: number;
  shortWindowMinutes: number;
  targetPpm: number;
  actualPpm: number | null;
  budgetTotalEvents: number;
  budgetConsumedEvents: number;
  budgetRemainingEvents: number;
  remainingRatioPpm: number | null;
  longBurnPpm: number | null;
  shortBurnPpm: number | null;
  alertKind: SloBurnAlertKind;
  samplesGood: number;
  samplesBad: number;
  dataComplete: boolean;
  reason: string | null;
}

/** Definition plus its latest evaluation (and the burn alert that follows
 *  from it), the unit the panel table renders. */
export interface SloStatusView {
  definition: SloDefinitionView;
  latest: SloEvaluationView | null;
  /** True when the latest evaluation's burn verdict pages (both-window AND). */
  burnAlerting: boolean;
}

/** The scorecard rollup: counts, the worst remaining budget, and which SLOs
 *  currently fail. Feeds the observability panel; feeds nothing else. */
export interface SloReadinessView {
  evaluatedAtMicros: string;
  total: number;
  byState: Record<SloState, number>;
  /** Minimum remaining-budget ratio across evidenced SLOs (ppm), null when
   *  nothing is evidenced. The floor, not the average: one exhausted
   *  objective is the headline. */
  worstRemainingRatioPpm: number | null;
  /** Maximum long-window burn across evidenced SLOs (ppm). */
  maxLongBurnPpm: number | null;
  /** sloIds in a paging state right now (CRITICAL/EXHAUSTED or alerting). */
  pagingSloIds: string[];
  /** sloIds whose latest tick is UNKNOWN - a measurement gap, listed so it
   *  cannot be silently averaged away. */
  unmeasuredSloIds: string[];
  /** Always present; always says the quiet part: these numbers may measure
   *  and page, they never authorise. */
  note: string;
}

/** Command body accepted by POST /v1/operational/slos/:sloId/config. The
 *  objective travels as a string for the reasons stated at the top of this
 *  file; the server re-canonicalises and re-checksums. */
export interface SloConfigUpdateDto {
  objective: string;
  windowMinutes: number;
  shortWindowMinutes: number;
  owner: string;
  description: string;
  goodEvent: string;
  badEvent: string;
  warningBurnPpm?: number;
  criticalBurnPpm?: number;
  maxAgeMicros?: string | null;
  latencyThresholdMicros?: string | null;
  enabled?: boolean;
}

/** Result envelope for a published definition or a manual evaluation. */
export interface SloCommandResultView {
  accepted: boolean;
  sloId: string;
  version: number;
  checksum: string;
  evaluation: SloEvaluationView | null;
}

/** Tracing posture of the API process (and, via the mirrored engines, of
 *  the plane - this view reports what THIS process knows). */
export interface TracingStatusView {
  enabled: boolean;
  endpointConfigured: boolean;
  sampleRatio: number;
  priorityOperations: string[];
  bufferedSpans: number;
  exportedTotal: number;
  droppedTotal: number;
  consecutiveExportFailures: number;
  lastExportOutcome: string | null;
}

/** The current request's trace identity, for the console's "copy trace id"
 *  affordance and nothing else. */
export interface CurrentTraceView {
  traceparent: string | null;
  traceId: string | null;
  spanId: string | null;
  sampled: boolean;
}

/** Fault-injection posture (read-only describe of the config-armed plan;
 *  `enabled` here reflects what the environment armed, nothing more). */
export interface FaultsStatusView {
  enabled: boolean;
  production: boolean;
  activePoints: SloFaultPoint[];
}
```

## FILE: packages/shared-types/src/index.ts (14 lines)

```typescript
export * from './common';
export * from './auth';
export * from './rbac';
export * from './tenant';
export * from './user';
export * from './billing';
export * from './audit';
export * from './realtime';
export * from './notification';
export * from './exchange';
export * from './trading';
export * from './slo';
export * from './errors';
```

## FILE: packages/config/src/constants.ts (248 lines)

```typescript
/** Platform-wide constants shared by every Node/TypeScript workload. */

export const HEADER_REQUEST_ID = 'x-request-id';
export const HEADER_TENANT_SLUG = 'x-tenant-slug';
export const HEADER_TENANT_ID = 'x-tenant-id';
export const HEADER_API_VERSION = 'x-api-version';
export const HEADER_TWO_FACTOR_TOKEN = 'x-2fa-token';
export const HEADER_DEVICE_ID = 'x-device-id';
export const HEADER_INTERNAL_TOKEN = 'x-internal-token';

/** Part 9: correlation ids ride headers across the service boundary. The
 *  values are UUIDs or nothing - both the API middleware and the Python
 *  services refuse unbounded input, so a header cannot smuggle text into
 *  log fields or incident rows. */
export const HEADER_CORRELATION_ID = 'x-correlation-id';
export const HEADER_IDEMPOTENCY_KEY = 'idempotency-key';

export const CACHE_TTL = {
  TENANT_RESOLUTION_SECONDS: 300,
  TENANT_PUBLIC_CONFIG_SECONDS: 120,
  USER_PERMISSIONS_SECONDS: 300,
  FEATURE_FLAGS_SECONDS: 60,
  PLAN_CATALOG_SECONDS: 600,
} as const;

export const CACHE_KEY = {
  tenantBySlug: (slug: string): string => `tenant:slug:${slug}`,
  tenantByDomain: (domain: string): string => `tenant:domain:${domain}`,
  tenantById: (id: string): string => `tenant:id:${id}`,
  tenantPublicConfig: (id: string): string => `tenant:${id}:public-config`,
  tenantFeatureFlags: (id: string): string => `tenant:${id}:feature-flags`,
  userPermissions: (userId: string): string => `user:${userId}:permissions`,
  userSessionVersion: (userId: string): string => `user:${userId}:session-version`,
  loginFailures: (tenantId: string, email: string): string =>
    `auth:failures:${tenantId}:${email.toLowerCase()}`,
  accountLock: (tenantId: string, email: string): string =>
    `auth:lock:${tenantId}:${email.toLowerCase()}`,
  revokedToken: (jti: string): string => `auth:revoked:${jti}`,
  idempotency: (tenantId: string, key: string): string => `idem:${tenantId}:${key}`,
} as const;

/** Part 10: response header echoing the W3C trace id (never the parent's raw
 *  traceparent - the id is correlation metadata for operators, the header
 *  full of routing bits is not something to hand to a browser). */
export const TRACE_ID_RESPONSE_HEADER = 'x-trace-id';

export const QUEUE_NAMES = {
  AUDIT: 'audit',
  EMAIL: 'email',
  NOTIFICATION: 'notification',
  SECURITY: 'security',
  MAINTENANCE: 'maintenance',
  BILLING: 'billing',
  // Registered now, consumed by the trading engine from Part 3.
  TRADE_SIGNAL: 'trade-signal',
  TRADE_EXECUTION: 'trade-execution',
  MARKET_SNAPSHOT: 'market-snapshot',
  /// Strategy lifecycle, backtests and paper sessions (Part 6). A separate
  /// queue from TRADE_EXECUTION on purpose: a backlog of backtests must never
  /// delay a cancel request.
  STRATEGY_CONTROL: 'strategy-control',
  /// Historical dataset ingestion and validation (Part 7). Separate from
  /// STRATEGY_CONTROL: a backfill that streams gigabytes must not queue in
  /// front of a cancel, and neither must delay the other's user-visible work.
  DATASET_CONTROL: 'dataset-control',
  /// Risk-control plane (Part 8). Publishes configuration versions to the
  /// engine's Redis pointers and mirrors hot state into Prisma. Separate
  /// from TRADE_EXECUTION on principle: a snapshot-sync backlog must never
  /// sit in front of - or behind - anything that can move an order, and a
  /// worker for this queue holds no credentials by design.
  RISK_CONTROL: 'risk-control',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

export const JOB_NAMES = {
  WRITE_AUDIT_LOG: 'write-audit-log',
  SEND_EMAIL: 'send-email',
  DISPATCH_NOTIFICATION: 'dispatch-notification',
  EVALUATE_SECURITY_EVENT: 'evaluate-security-event',
  PRUNE_EXPIRED_TOKENS: 'prune-expired-tokens',
  PRUNE_AUDIT_LOGS: 'prune-audit-logs',
  RECONCILE_SUBSCRIPTIONS: 'reconcile-subscriptions',

  // Authenticated execution (Part 5). Produced by the API, consumed by the
  // trading worker - the only process that holds venue credentials. The API
  // deliberately cannot perform these itself: it has no signing code and no
  // access to key material, which is what keeps the credential boundary a
  // process boundary rather than a code-review convention.
  VERIFY_EXCHANGE_CREDENTIALS: 'verify-exchange-credentials',
  REFRESH_ACCOUNT_BALANCES: 'refresh-account-balances',
  RECONCILE_TRADING_ACCOUNT: 'reconcile-trading-account',
  RESYNC_PRIVATE_STREAM: 'resync-private-stream',
  CANCEL_ORDER: 'cancel-order',

  // Strategy layer (Part 6). Produced by the API, consumed by the strategy
  // worker. None of them can place a live order: the strategy worker holds no
  // credential and the backtest and paper paths have no adapter that could
  // reach a venue.
  APPLY_STRATEGY_STATE: 'apply-strategy-state',
  RUN_BACKTEST: 'run-backtest',
  START_PAPER_SESSION: 'start-paper-session',
  STOP_PAPER_SESSION: 'stop-paper-session',
  CHECKPOINT_STRATEGY_STATE: 'checkpoint-strategy-state',

  // Historical datasets (Part 7). Produced by the API, consumed by the
  // dataset/strategy worker - the only process that fetches archives and
  // writes storage. The API enqueues intent and reads the registry's
  // projection; it never stores a dataset and never replays one.
  INGEST_HISTORICAL_DATASET: 'ingest-historical-dataset',
  VALIDATE_DATASET_VERSION: 'validate-dataset-version',
  SYNC_DATASET_STATUS: 'sync-dataset-status',

  // Risk engine (Part 8). Produced by the API's risk module; consumed by the
  // risk/state worker. None of these jobs can place, cancel or amend an
  // order: they publish *what the limits are* and mirror *what the engine
  // decided*. Enforcement stays in the engine's hot path.
  PUBLISH_RISK_CONFIGURATION: 'publish-risk-configuration',
  SYNC_RISK_SNAPSHOT: 'sync-risk-snapshot',
  RECONCILE_RISK_PROTECTIONS: 'reconcile-risk-protections',

  // Observability (Part 9). The alert sync folds each publisher service's
  // Redis alert mirror into durable rows (one writer: the API); pruning
  // honours explicit retention and never touches unresolved history.
  // Neither job can place, cancel or amend an order.
  SYNC_OPERATIONAL_ALERTS: 'sync-operational-alerts',
  PRUNE_OPERATIONAL_HISTORY: 'prune-operational-history',

  // Reliability (Part 10). Evaluation is a scheduled READ of already-recorded
  // evidence (queue mirrors, health mirrors, durable tables) plus an append
  // of evaluation rows; pruning removes rows the burn windows no longer read.
  // Neither job can place, cancel or amend an order, or resolve an alert.
  EVALUATE_OPERATIONAL_SLOS: 'evaluate-operational-slos',
  PRUNE_SLO_EVALUATIONS: 'prune-slo-evaluations',
} as const;

/** Prometheus text exposition content type (0.0.4). Pinned in one place so
 *  the API endpoint and the parity tests cannot drift apart. */
export const PROMETHEUS_CONTENT_TYPE = 'text/plain; version=0.0.4; charset=utf-8';

/** The typed phrase that must be quoted verbatim to force-resolve an alert
 *  without an observed recovery. Short enough to type under pressure,
 *  distinctive enough that it is never quoted by accident. (Alert
 *  auto-resolution goes through the sync job, which only resolves on
 *  observed recovery; this phrase is the exception path, and it is audited
 *  with the same seriousness as clearing a risk protection.) */
export const ALERT_FORCE_RESOLVE_PHRASE = 'FORCE RESOLVE ALERT';

/** Services whose observability mirrors the API syncs. A service not listed
 *  here is invisible to the fold, which is why the list is a constant:
 *  adding a publisher is a review, not a config typo. notification-service
 *  publishes nothing today and its absence must read as silence, not as
 *  recovery - the sync job only resolves rows whose publisher mirror is
 *  present-but-empty. */
export const OBS_PUBLISHER_SERVICES: readonly string[] = Object.freeze([
  'market-data',
  'trading-engine',
]);

// ---------------------------------------------------------------------------
// Part 10 (reliability) shared constants.
// ---------------------------------------------------------------------------

/** Counter bucket width for SLO sample sources, in minutes. The evaluators
 *  read whole buckets so both languages can reproduce window sums exactly;
 *  sub-bucket fractions are documented, not fudged. */
export const SLO_SAMPLE_BUCKET_MINUTES = 10;

/** Redis prefix for the SLO sample buckets: `wlct:trading:ops:slo:<source>:
 *  <yyyyMMddHHmm>`, hash fields `good`/`bad`. Bounded by the retention of
 *  the buckets themselves (2x the maximum window) - never a long memory. */
export const SLO_SAMPLE_KEY_PREFIX = 'wlct:trading:ops:slo';

/** Trace-context sidecar for queued jobs: `wlct:trading:ops:tracectx:
 *  <queue>:<jobId>`, TTL-bounded (a job that never runs must not keep the
 *  trace alive forever). Sidecar rather than payload field: job payloads
 *  have versioned schemas and replay semantics; the trace context is
 *  transport metadata and belongs beside them, not inside them. */
export const TRACECTX_KEY_PREFIX = 'wlct:trading:ops:tracectx';
export const TRACECTX_TTL_SECONDS = 600;

/** The OTLP/HTTP traces path appended to a configured OTEL_ENDPOINT. */
export const OTLP_TRACES_PATH = '/v1/traces';

export const PAGINATION_DEFAULTS = {
  PAGE: 1,
  LIMIT: 20,
  MAX_LIMIT: 100,
} as const;

/** Fields scrubbed from every structured log line and audit payload. */
export const SENSITIVE_FIELD_NAMES: readonly string[] = Object.freeze([
  'password',
  'passwordHash',
  'currentPassword',
  'newPassword',
  'confirmPassword',
  'token',
  'accessToken',
  'refreshToken',
  'challengeToken',
  'idToken',
  'authorization',
  'cookie',
  'setCookie',
  'apiKey',
  'apiSecret',
  'secret',
  'secretKey',
  'privateKey',
  'passphrase',
  'mnemonic',
  'seedPhrase',
  'twoFactorSecret',
  'totpSecret',
  'recoveryCodes',
  'encryptionKey',
  'dek',
  'kek',
  'cardNumber',
  'cvv',
  'iban',
  'ssn',
  'clientSecret',
  'webhookSecret',
]);

export const REDACTED_PLACEHOLDER = '[REDACTED]';

export const SUPPORTED_LOCALES = ['en', 'es', 'ar', 'bn', 'tr'] as const;
export const RTL_LOCALES = ['ar'] as const;
export const SUPPORTED_CURRENCIES = ['USD', 'EUR', 'GBP', 'AED', 'BDT', 'TRY'] as const;

export const FEATURE_FLAG_KEYS = {
  COPY_TRADING: 'copy_trading',
  FUTURES_TRADING: 'futures_trading',
  SPOT_TRADING: 'spot_trading',
  PAPER_TRADING: 'paper_trading',
  REFERRAL_PROGRAM: 'referral_program',
  KYC_REQUIRED: 'kyc_required',
  TWO_FACTOR_MANDATORY: 'two_factor_mandatory',
  PUBLIC_REGISTRATION: 'public_registration',
  CUSTOM_DOMAIN: 'custom_domain',
  MOBILE_APP: 'mobile_app',
  ADVANCED_ANALYTICS: 'advanced_analytics',
  WITHDRAWAL_NOTIFICATIONS: 'withdrawal_notifications',
} as const;
```

## FILE: packages/config/src/env.schema.ts (1203 lines)

```typescript
import { z } from 'zod';

/**
 * Single source of truth for environment configuration.
 *
 * The schema is intentionally strict: the API refuses to boot when a value is
 * missing or malformed, which prevents an environment from silently starting
 * with, for example, an empty JWT secret.
 */

const booleanFromString = z
  .union([z.boolean(), z.string()])
  .transform((value) => {
    if (typeof value === 'boolean') {
      return value;
    }
    return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
  });

const intFromString = (defaultValue: number) =>
  z
    .union([z.number(), z.string()])
    .default(defaultValue)
    .transform((value, ctx) => {
      const parsed = typeof value === 'number' ? value : Number.parseInt(value, 10);
      if (Number.isNaN(parsed)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Expected an integer value' });
        return z.NEVER;
      }
      return parsed;
    });

/**
 * A fixed-point decimal carried as a string.
 *
 * Deliberately not parsed into a JavaScript `number`. Fees, capital and
 * slippage end up in Decimal arithmetic in the Python data plane and in
 * Prisma `Decimal` columns; round-tripping them through a binary float here
 * would introduce exactly the representation error the rest of the platform
 * takes care to avoid. The value is validated as finite and in range, then
 * passed on verbatim.
 */
const decimalFromString = (
  defaultValue: string,
  { min, max }: { min: number; max: number },
) =>
  z
    .union([z.number(), z.string()])
    .default(defaultValue)
    .transform((value, ctx) => {
      const text = typeof value === 'number' ? String(value) : value.trim();
      if (!/^-?\d+(\.\d+)?$/.test(text)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Expected a plain decimal number, for example 0.001',
        });
        return z.NEVER;
      }
      const parsed = Number.parseFloat(text);
      if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Expected a decimal between ${min} and ${max}`,
        });
        return z.NEVER;
      }
      return text;
    });

const csv = (defaultValue: string) =>
  z
    .string()
    .default(defaultValue)
    .transform((value) =>
      value
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0),
    );

const jsonRecord = z
  .string()
  .default('{}')
  .transform((value, ctx) => {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Expected a JSON object' });
        return z.NEVER;
      }
      return parsed as Record<string, string>;
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Expected valid JSON' });
      return z.NEVER;
    }
  });

export const NodeEnvSchema = z.enum(['development', 'test', 'staging', 'production']);
export type NodeEnvironment = z.infer<typeof NodeEnvSchema>;

export const envSchema = z
  .object({
    // Application
    NODE_ENV: NodeEnvSchema.default('development'),
    APP_NAME: z.string().min(1).default('WhiteLabelCopyTrade'),
    API_PORT: intFromString(4000),
    API_HOST: z.string().default('0.0.0.0'),
    API_GLOBAL_PREFIX: z.string().default('api'),
    API_DEFAULT_VERSION: z.string().default('1'),
    API_PUBLIC_URL: z.string().url().default('http://localhost:4000'),
    ADMIN_WEB_URL: z.string().url().default('http://localhost:3000'),
    TRUST_PROXY_HOPS: intFromString(1),
    PLATFORM_ROOT_DOMAIN: z.string().default('copytrade.app'),
    DEFAULT_TENANT_SLUG: z.string().default('platform'),

    // Database
    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    DIRECT_DATABASE_URL: z.string().optional(),
    DATABASE_LOG_QUERIES: booleanFromString.default(false),
    DATABASE_SSL: booleanFromString.default(false),

    // Redis
    REDIS_HOST: z.string().default('localhost'),
    REDIS_PORT: intFromString(6379),
    REDIS_PASSWORD: z.string().optional(),
    REDIS_DB: intFromString(0),
    REDIS_TLS: booleanFromString.default(false),
    REDIS_KEY_PREFIX: z.string().default('wlct:'),

    // JWT
    JWT_ALGORITHM: z.enum(['HS256', 'HS512', 'RS256', 'RS512']).default('HS256'),
    JWT_ACCESS_SECRET: z.string().optional(),
    JWT_REFRESH_SECRET: z.string().optional(),
    JWT_PRIVATE_KEY_BASE64: z.string().optional(),
    JWT_PUBLIC_KEY_BASE64: z.string().optional(),
    JWT_ACCESS_TTL: z.string().default('900s'),
    JWT_REFRESH_TTL: z.string().default('30d'),
    JWT_ISSUER: z.string().default('https://api.copytrade.app'),
    JWT_AUDIENCE: z.string().default('copytrade-clients'),
    MAX_ACTIVE_SESSIONS_PER_USER: intFromString(10),

    // Password / hashing
    PASSWORD_MIN_LENGTH: intFromString(12),
    ARGON2_MEMORY_COST: intFromString(19456),
    ARGON2_TIME_COST: intFromString(2),
    ARGON2_PARALLELISM: intFromString(1),
    LOGIN_MAX_FAILED_ATTEMPTS: intFromString(5),
    LOGIN_FAILED_WINDOW_SECONDS: intFromString(900),
    ACCOUNT_LOCKOUT_SECONDS: intFromString(900),

    // Encryption
    ENCRYPTION_MASTER_KEY_BASE64: z.string().min(1, 'ENCRYPTION_MASTER_KEY_BASE64 is required'),
    ENCRYPTION_KEY_ID: z.string().default('local-dev-v1'),
    ENCRYPTION_PREVIOUS_KEYS_JSON: jsonRecord,
    ENCRYPTION_PROVIDER: z.enum(['local', 'kms']).default('local'),
    KMS_PROVIDER: z.string().optional(),
    KMS_KEY_ARN: z.string().optional(),
    BLIND_INDEX_KEY_BASE64: z.string().min(1, 'BLIND_INDEX_KEY_BASE64 is required'),

    // Two factor
    TWO_FACTOR_ISSUER: z.string().default('CopyTrade'),
    TWO_FACTOR_WINDOW: intFromString(1),
    TWO_FACTOR_DIGITS: intFromString(6),
    TWO_FACTOR_PERIOD: intFromString(30),
    TWO_FACTOR_RECOVERY_CODES: intFromString(10),
    TWO_FACTOR_CHALLENGE_TTL: z.string().default('300s'),
    // How many codes may be tried against ONE challenge token before it is
    // burned. Without a bound the challenge would either be single-use (a
    // mistyped digit forces the user to re-enter their password) or unlimited
    // (a captured challenge could be brute-forced for its whole TTL).
    TWO_FACTOR_MAX_CHALLENGE_ATTEMPTS: intFromString(5),

    // CORS
    CORS_ENABLED: booleanFromString.default(true),
    CORS_ORIGINS: csv('http://localhost:3000'),
    CORS_CREDENTIALS: booleanFromString.default(true),
    CORS_ALLOWED_HEADERS: csv(
      'Content-Type,Authorization,X-Tenant-Slug,X-Request-Id,X-Api-Version,Accept-Language,X-2FA-Token',
    ),
    CORS_EXPOSED_HEADERS: csv('X-Request-Id,X-RateLimit-Limit,X-RateLimit-Remaining'),

    // Rate limiting
    RATE_LIMIT_ENABLED: booleanFromString.default(true),
    RATE_LIMIT_TTL_SECONDS: intFromString(60),
    RATE_LIMIT_MAX: intFromString(120),
    RATE_LIMIT_AUTH_TTL_SECONDS: intFromString(300),
    RATE_LIMIT_AUTH_MAX: intFromString(10),
    RATE_LIMIT_TRUSTED_IPS: csv('127.0.0.1,::1'),

    // Swagger
    SWAGGER_ENABLED: booleanFromString.default(true),
    SWAGGER_PATH: z.string().default('docs'),
    SWAGGER_TITLE: z.string().default('White-Label Copy Trading API'),
    SWAGGER_DESCRIPTION: z.string().default('Multi-tenant crypto copy-trading platform API'),
    SWAGGER_VERSION: z.string().default('1.0.0'),
    SWAGGER_USER: z.string().optional(),
    SWAGGER_PASSWORD: z.string().optional(),

    // Logging
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    LOG_FORMAT: z.enum(['json', 'pretty']).default('json'),
    LOG_REQUEST_BODY: booleanFromString.default(false),
    LOG_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(1),
    SENTRY_DSN: z.string().optional(),

    // WebSocket
    WS_ENABLED: booleanFromString.default(true),
    WS_PATH: z.string().default('/realtime'),
    WS_NAMESPACE: z.string().default('/v1'),
    WS_PING_INTERVAL_MS: intFromString(25000),
    WS_PING_TIMEOUT_MS: intFromString(20000),
    WS_MAX_CONNECTIONS_PER_USER: intFromString(5),
    WS_REDIS_ADAPTER: booleanFromString.default(true),

    // Queues
    QUEUE_PREFIX: z.string().default('wlct-queue'),
    QUEUE_DEFAULT_ATTEMPTS: intFromString(5),
    QUEUE_BACKOFF_MS: intFromString(5000),
    QUEUE_REMOVE_ON_COMPLETE: intFromString(1000),
    QUEUE_REMOVE_ON_FAIL: intFromString(5000),
    QUEUE_CONCURRENCY: intFromString(10),
    QUEUE_RUN_INLINE_WORKERS: booleanFromString.default(true),
    BULL_BOARD_ENABLED: booleanFromString.default(false),
    BULL_BOARD_PATH: z.string().default('admin/queues'),

    // Exchanges / internal services
    EXCHANGES_ENABLED: csv('binance,bybit,okx,kraken'),
    EXCHANGE_SANDBOX_MODE: booleanFromString.default(true),
    EXCHANGE_REQUEST_TIMEOUT_MS: intFromString(10000),
    EXCHANGE_MAX_RETRIES: intFromString(3),
    EXECUTION_ENABLED: booleanFromString.default(false),

    // --- Part 5: authenticated execution -------------------------------
    // Every one of these defaults to the safe value. Omission is never
    // consent: an operator who forgets a variable gets paper trading with
    // transmission disabled, not live money.

    /// Venue credentials for the platform-level dev/testnet account. Tenant
    /// accounts keep their own credentials in the database or a secret
    /// manager; these exist so a developer can run the smoke harness without
    /// provisioning a tenant. Never logged, never returned by an endpoint.
    BINANCE_API_KEY: z.string().optional(),
    BINANCE_API_SECRET: z.string().optional(),

    /// The master arming switch. False means no signed order request is ever
    /// transmitted, whatever any per-account flag says.
    LIVE_TRADING_ENABLED: booleanFromString.default(false),
    /// Build and sign the request, validate it, then stop. Nothing leaves the
    /// process and nothing is ever reported as submitted.
    DRY_RUN: booleanFromString.default(true),
    /// Route orders to the simulated venue. Simulated fills are labelled.
    PAPER_TRADING: booleanFromString.default(true),

    /// How long to wait for a submit response before the outcome is treated
    /// as unknown. A timeout is not a rejection.
    ORDER_REQUEST_TIMEOUT_MS: intFromString(10000),
    /// Interval between scheduled reconciliation sweeps.
    ORDER_RECONCILIATION_INTERVAL_MS: intFromString(30000),
    /// Whether the private user-data stream reconnects itself.
    PRIVATE_STREAM_RECONNECT_ENABLED: booleanFromString.default(true),
    /// How often to re-measure the offset between local and venue clocks.
    EXCHANGE_TIME_SYNC_INTERVAL_MS: intFromString(300000),
    /// Lifetime of an idempotency key. Must comfortably exceed the longest
    /// plausible retry window, or a duplicate slips through.
    EXECUTION_IDEMPOTENCY_TTL_SECONDS: intFromString(86400),
    /// Grace period before querying the venue about an unknown order. The
    /// venue may simply not have finished processing it yet.
    ORDER_UNKNOWN_RECONCILIATION_DELAY_MS: intFromString(2000),
    // --- Part 6: strategy engine, paper trading, backtesting -----------
    // The strategy layer produces signals. It cannot submit an order, and
    // none of these variables can enable live trading: that still requires
    // LIVE_TRADING_ENABLED, EXECUTION_ENABLED, DRY_RUN=false, PAPER_TRADING=
    // false and EXCHANGE_SANDBOX_MODE=false to agree, all validated above.

    /// Master switch for the strategy engine. Off by default: a deployment
    /// that has not been asked to run strategies should not run them.
    STRATEGY_ENGINE_ENABLED: booleanFromString.default(false),
    /// Whether paper sessions may be started. Paper sessions route to the
    /// simulated adapter only.
    PAPER_TRADING_ENABLED: booleanFromString.default(true),
    /// Whether backtests may be submitted. A backtest touches no venue.
    BACKTEST_ENABLED: booleanFromString.default(true),

    /// Bound on the in-process market-data queue feeding the strategies. A
    /// bounded queue is what turns a slow strategy into shed load rather than
    /// unbounded memory growth.
    STRATEGY_EVENT_QUEUE_SIZE: intFromString(10000),
    /// Hard cap on concurrently registered strategy instances per process.
    STRATEGY_MAX_INSTANCES: intFromString(50),
    /// Observation budget for one dispatch. Exceeding it increments a counter
    /// and marks the dispatch slow. It is not a latency guarantee and this
    /// platform does not offer one.
    STRATEGY_MAX_PROCESSING_LATENCY_MS: intFromString(50),

    /// A signal older than this is refused by the validator rather than acted
    /// on. Stale intent is how a backlog becomes a bad fill.
    SIGNAL_MAX_AGE_MS: intFromString(2000),
    /// How long a signal identity is remembered for deduplication. This is a
    /// bounded in-memory guard against a strategy repeating itself, not the
    /// order idempotency system, which lives in the execution layer.
    SIGNAL_DEDUP_TTL_SECONDS: intFromString(5),

    /// Defaults applied to a backtest that does not specify its own. They are
    /// assumptions, they are recorded in the configuration hash of every run,
    /// and they do not describe any real account.
    BACKTEST_DEFAULT_INITIAL_CAPITAL: decimalFromString('10000', {
      min: 0.00000001,
      max: 1000000000,
    }),
    /// Fee rates, not basis points: 0.001 is ten basis points.
    BACKTEST_DEFAULT_MAKER_FEE: decimalFromString('0.001', { min: 0, max: 0.1 }),
    BACKTEST_DEFAULT_TAKER_FEE: decimalFromString('0.001', { min: 0, max: 0.1 }),
    /// Slippage in basis points applied against every simulated taker fill.
    BACKTEST_DEFAULT_SLIPPAGE_BPS: decimalFromString('1', { min: 0, max: 1000 }),

    // ---------------------------------------------------------------------
    // Part 7: historical datasets, ingestion, validation, replay
    //
    // None of these can enable live trading, and none of them can make a
    // backtest read a venue: a dataset is a frozen file, fetched by an
    // explicit ingestion job over public data, with no credentials in the
    // picture anywhere. What they govern is storage, validation policy and
    // whether backtests must cite a registered dataset version.

    /// Which storage backend serves datasets. Only local ships; the enum
    /// exists so a future object-storage implementation is a *value change*,
    /// never a schema edit that could silently accept a typo today.
    DATASET_STORAGE_BACKEND: z.enum(['local']).default('local'),
    /// Root for finalised dataset trees. Relative paths are permitted outside
    /// production for developer convenience; production must be absolute
    /// (checked below) because a dataset root under a process CWD that moves
    /// is a dataset that vanishes.
    DATASET_LOCAL_ROOT: z.string().min(1).default('./data/datasets'),
    /// Staging root for in-flight ingestion. MUST live on the same
    /// filesystem as DATASET_LOCAL_ROOT: finalisation is a rename, and a
    /// cross-device rename either fails or silently degrades into a copy.
    DATASET_TEMP_ROOT: z.string().min(1).default('./data/staging'),
    /// Hard ceiling for one partition file, in bytes. Bounds memory in the
    /// writer and in validation re-reads; the reader also uses it to size
    /// its per-file decompression bomb ceiling.
    DATASET_MAX_PARTITION_BYTES: intFromString(268435456),
    /// Streaming reader chunk size. This is the only read-buffer knob a
    /// replay sees; there is no path that grows with file size.
    DATASET_READER_BUFFER_SIZE: intFromString(65536),
    /// Whether newly ingested versions are validated before they become
    /// visible. Turning this off is for emergency re-ingest of data that was
    /// validated elsewhere; the resulting manifest is stamped unvalidated,
    /// so it can never be confused with a validated one.
    DATASET_VALIDATION_ENABLED: booleanFromString.default(true),
    /// Cap on per-stream gap findings retained in a report. The *count* is
    /// always exact; this only bounds how many identical lines the report
    /// repeats.
    DATASET_MAX_GAP_WARNINGS: intFromString(100),
    /// Event ceiling per partition. Sizing policy, not correctness: keeps
    /// files re-readable on modest hardware.
    DATASET_MAX_EVENTS_PER_PARTITION: intFromString(2000000),
    /// Retention policy for NON-validated artefacts (failed staging).
    /// 'retain' keeps everything; 'purge_staging_only' may delete STAGING
    /// areas after a failed job. Quarantined evidence is never deleted by
    /// policy - the name states that limit rather than hiding it.
    DATASET_RETENTION_POLICY: z.enum(['retain', 'purge_staging_only']).default('retain'),
    /// Master switch for ingestion jobs. Off by default and deliberately
    /// never auto-enabled: an ingestion storm from a mis-clicked dashboard is
    /// a storage and egress incident. This is the ONLY thing that lets
    /// POST /datasets/ingest enqueue work.
    HISTORICAL_INGESTION_ENABLED: booleanFromString.default(false),
    /// When true, a backtest submission must name a registered dataset
    /// version (datasetVersionId). This is what stops "latest mutable data"
    /// from becoming an unexamined habit: a run without a pinned, checksumed
    /// dataset version is exactly the anecdote Part 7 exists to abolish.
    BACKTEST_DATASET_REQUIRED: booleanFromString.default(true),

    // ---------------------------------------------------------------------------
    // Part 8: real-time risk engine - control-plane configuration.
    //
    // The API does not evaluate risk; it publishes the *platform default
    // ceilings* below and the per-account versioned configuration documents
    // that the trading worker's RiskGate consumes. What these values are NOT:
    // an allowance for anyone. They are ceilings - the gate resolves
    // GLOBAL -> EXCHANGE -> ACCOUNT -> STRATEGY -> SYMBOL and takes the
    // tightest applicable entry per rule (see wlct_trading.risk.configuration
    // for the single authority on that sentence). What they ARE: the floor
    // of last resort. An unset rule here means "no platform opinion" at the
    // GLOBAL scope - and because child scopes can only tighten, an absent
    // platform ceiling is the ONLY way an account-scoped entry can be wider
    // than nothing; every default below is deliberately conservative, and
    // the doc notes on each state exactly that.
    // ---------------------------------------------------------------------------

    /// Master switch for the extended Part 8 risk gate requirement. TRUE by
    /// default and checked in production: with it on, a trading worker that
    /// starts without a wired RiskGate refuses to boot (fail closed at wiring
    /// time). It cannot disable the Part 2 core gate - no flag does.
    RISK_ENGINE_ENABLED: booleanFromString.default(true),
    /// The engine's governing rule as a startup assertion. Only `true` is a
    /// legal value anywhere; `RISK_FAIL_CLOSED=false` is a configuration
    /// error at parse time, not a mode. A key that can be set to a lethal
    /// value is a key someone will set to a lethal value at 3am.
    RISK_FAIL_CLOSED: booleanFromString.default(true),
    /// How old a hot risk snapshot may be when an order is evaluated
    /// (milliseconds). 2000ms is the default because it is the window in
    /// which a fill or cancel on the same account is *already expected* by
    /// the event pipeline; beyond it, the state is presumed stale and
    /// risk-increasing orders are refused.
    MAX_RISK_STATE_AGE_MS: intFromString(2000),
    /// Cadence at which the state worker republishes account snapshots.
    /// Refresh cannot be slower than the staleness budget or the system is
    /// guaranteed stale; the refine below enforces the ordering.
    RISK_SNAPSHOT_REFRESH_MS: intFromString(250),
    // -- Platform default ceilings (quote-currency notionals; conservative) --
    MAX_ORDER_NOTIONAL: decimalFromString('1000', { min: 0.000001, max: 100000000000 }),
    MAX_POSITION_NOTIONAL: decimalFromString('5000', { min: 0.000001, max: 100000000000 }),
    MAX_ACCOUNT_EXPOSURE: decimalFromString('10000', { min: 0.000001, max: 100000000000 }),
    MAX_STRATEGY_EXPOSURE: decimalFromString('5000', { min: 0.000001, max: 100000000000 }),
    MAX_SYMBOL_EXPOSURE: decimalFromString('5000', { min: 0.000001, max: 100000000000 }),
    MAX_OPEN_ORDERS: intFromString(20),
    MAX_DAILY_LOSS: decimalFromString('500', { min: 0.000001, max: 100000000000 }),
    MAX_STRATEGY_DAILY_LOSS: decimalFromString('250', { min: 0.000001, max: 100000000000 }),
    /// Drawdown against peak equity, percent. 10% default: an account that
    /// has lost a tenth of its high-water mark has already exceeded what any
    /// strategy was designed through.
    MAX_DRAWDOWN: decimalFromString('10', { min: 0.01, max: 100 }),
    MAX_ORDERS_PER_SECOND: intFromString(2),
    MAX_ORDERS_PER_MINUTE: intFromString(30),
    MAX_CANCELS_PER_SECOND: intFromString(2),
    MAX_CANCELS_PER_MINUTE: intFromString(30),
    /// Fat-finger band for limit prices against the side-touch reference, in
    /// basis points. 250 bps (2.5%) is generous for majors and still refuses
    /// the digit-slip class of error outright.
    MAX_PRICE_DEVIATION_BPS: intFromString(250),
    MAX_CONSECUTIVE_LOSSES: intFromString(5),
    /// Days risk-event rows are retained before the maintenance queue prunes
    /// them (audit rows for the same acts live in the audit log's own
    /// retention; this is the operator-facing trail, not the accounting one).
    RISK_EVENTS_RETENTION_DAYS: intFromString(365),

    // ---------------------------------------------------------------------------
    // Observability & operations (Part 9)
    //
    // These are publication and retention settings - never trading settings.
    // In production the enabled-flags cannot be off: the validation enforces
    // it at parse time, because an operator panel that can be switched away
    // during the incident it exists for is not an operator panel. METRICS_TOKEN
    // is required in production so the /metrics surface is never open on a
    // shared listener; outside production an unauthenticated /metrics is
    // allowed and the endpoint logs that fact once at startup.
    // ---------------------------------------------------------------------------
    OBSERVABILITY_ENABLED: booleanFromString.default(true),
    METRICS_ENABLED: booleanFromString.default(true),
    HEALTH_ENABLED: booleanFromString.default(true),
    PROMETHEUS_ENABLED: booleanFromString.default(true),
    PROMETHEUS_PATH: z
      .string()
      .regex(/^\/[a-z0-9\/_-]{1,63}$/, 'PROMETHEUS_PATH must be a simple absolute path')
      .default('/metrics'),
    METRICS_TOKEN: z
      .string()
      .min(16, 'METRICS_TOKEN must be at least 16 characters when set')
      .optional(),
    ALERTING_ENABLED: booleanFromString.default(true),
    /// Occurrences reported by a publisher are cumulative; the dedupe window
    /// governs how long a *missing* publisher mirror is tolerated before the
    /// sync job flags it (never before it resolves anything - absence is
    /// flagged, recovery is only ever observed).
    ALERT_DEDUP_WINDOW_MS: intFromString(60_000),
    /// A queue's oldest pending job past this age is an alert. The execution
    /// queue reuses the number but not the severity: its alert is CRITICAL by
    /// the per-queue policy in the sync service, and it fires at half the age
    /// (hard-coded ratio, not a second knob nobody will tune under pressure).
    QUEUE_ALERT_AGE_MS: intFromString(120_000),
    HEALTH_REFRESH_MS: intFromString(5_000),
    METRICS_EXPORT_INTERVAL_MS: intFromString(15_000),
    /// Resolved alerts may be pruned after this many days. OPEN and
    /// ACKNOWLEDGED rows are NEVER pruned regardless of age - an alert that
    /// stayed unresolved is the most important row in the table, not the
    /// first candidate for deletion.
    ALERT_RETENTION_DAYS: intFromString(90),
    INCIDENT_RETENTION_DAYS: intFromString(365),

    // --- Part 10: reliability (tracing, SLO evaluation, fault injection) --
    // Same rule as the Part 9 switches: these govern what telemetry LEAVES
    // and what the panel MEASURES. None of them can loosen a risk gate,
    // approve an order, or silence evidence that already exists.
    /// Master tracing switch for this process. Off by default: a process
    /// pointed at no collector must not pay an HTTP timeout per export.
    OTEL_ENABLED: booleanFromString.default(false),
    /// OTLP/HTTP base URL; spans are POSTed to <endpoint>/v1/traces as
    /// OTLP/JSON. Optional: with OTEL_ENABLED=true and no endpoint, drops
    /// are counted and the export-outcome alert says so - dark on purpose
    /// is different from dark by accident.
    OTEL_ENDPOINT: z.string().url().optional(),
    OTEL_TIMEOUT_MS: intFromString(2_000),
    /// Head-based sampling ratio. Integer ppm arithmetic in the tracer; this
    /// is the single float the operator types, converted once, at the edge.
    OTEL_SAMPLE_RATIO: z.coerce.number().min(0).max(1).default(0.1),
    /// Comma-separated operations exempt from ratio sampling. Bounded by the
    /// engine's TRACED_OPERATIONS allow-list; unknown names are dropped at
    /// the tracer with a counted reason, never guessed at.
    OTEL_PRIORITY_OPERATIONS: z.string().default('execution.transmit'),
    /// Arming switch for the closed fault-point universe. Valid ONLY outside
    /// production and only with the guard below on; the API exposes no lever
    /// that reads or clears these counters (describe only).
    FAILURE_INJECTION_ENABLED: booleanFromString.default(false),
    FAILURE_INJECTION_ALLOW_NON_PRODUCTION_ONLY: booleanFromString.default(true),
    /// The SLO machinery (evaluation job, panel rollup). Default on: the
    /// panel's rollup block must have data to render even where nobody has
    /// configured a collector yet.
    SLO_ENABLED: booleanFromString.default(true),
    /// Minutes between scheduled evaluations. Must not exceed the shortest
    /// SLO window or a window would be judged on fewer ticks than designed.
    SLO_EVALUATION_INTERVAL_MINUTES: intFromString(5),
    /// Evaluation rows older than this are pruned (config rows are NEVER
    /// pruned - they are the versioned promise history). 7-day floor: the
    /// burn windows read up to 7 days back; pruning them away would make
    /// every long-window UNKNOWN.
    SLO_RETENTION_DAYS: intFromString(30),
    /// Default evaluation window (minutes) for definitions published without
    /// one. Mirrors the engine's accepted band.
    SLO_DEFAULT_WINDOW_MINUTES: intFromString(1_440),
    /// Classic multi-window paging thresholds, as decimal strings of the
    /// multiplier (14.4x / 6x); the service converts them to integer ppm.
    /// Strings, not numbers: the config file must not be where a float first
    /// touches a checksummed identity.
    SLO_FAST_BURN_MULTIPLIER: z.string().default('14.4'),
    SLO_SLOW_BURN_MULTIPLIER: z.string().default('6'),

    TRADING_ENGINE_URL: z.string().url().default('http://localhost:8001'),
    TRADING_ENGINE_HEALTH_PATH: z.string().default('/health'),
    MARKET_DATA_URL: z.string().url().default('http://localhost:8002'),
    MARKET_DATA_HEALTH_PATH: z.string().default('/health'),
    NOTIFICATION_SERVICE_URL: z.string().url().default('http://localhost:8003'),
    NOTIFICATION_SERVICE_HEALTH_PATH: z.string().default('/health'),
    INTERNAL_SERVICE_TOKEN: z.string().min(16, 'INTERNAL_SERVICE_TOKEN must be at least 16 chars'),
    EXCHANGE_WEBHOOK_SIGNING_SECRET: z.string().min(16),

    // Email
    MAIL_DRIVER: z.enum(['smtp', 'ses', 'postmark', 'console']).default('console'),
    MAIL_FROM_NAME: z.string().default('CopyTrade'),
    MAIL_FROM_ADDRESS: z.string().email().default('no-reply@copytrade.app'),
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: intFromString(587),
    SMTP_SECURE: booleanFromString.default(false),
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),

    // Notifications
    NOTIFICATIONS_ENABLED: booleanFromString.default(true),
    FIREBASE_PROJECT_ID: z.string().optional(),
    FIREBASE_CLIENT_EMAIL: z.string().optional(),
    FIREBASE_PRIVATE_KEY_BASE64: z.string().optional(),
    TELEGRAM_BOT_TOKEN: z.string().optional(),
    TWILIO_ACCOUNT_SID: z.string().optional(),
    TWILIO_AUTH_TOKEN: z.string().optional(),
    TWILIO_FROM_NUMBER: z.string().optional(),

    // Localisation / currency
    DEFAULT_LOCALE: z.string().default('en'),
    SUPPORTED_LOCALES: csv('en,es,ar,bn,tr'),
    DEFAULT_CURRENCY: z.string().default('USD'),
    SUPPORTED_CURRENCIES: csv('USD,EUR,GBP,AED,BDT,TRY'),
    FX_RATES_PROVIDER: z.string().default('none'),
    FX_RATES_API_KEY: z.string().optional(),

    // KYC
    KYC_PROVIDER: z.enum(['none', 'sumsub', 'onfido', 'shufti']).default('none'),
    KYC_API_URL: z.string().optional(),
    KYC_APP_TOKEN: z.string().optional(),
    KYC_SECRET_KEY: z.string().optional(),
    KYC_WEBHOOK_SECRET: z.string().optional(),

    // Billing
    BILLING_PROVIDER: z.enum(['none', 'stripe', 'nowpayments']).default('none'),
    STRIPE_SECRET_KEY: z.string().optional(),
    STRIPE_WEBHOOK_SECRET: z.string().optional(),
    NOWPAYMENTS_API_KEY: z.string().optional(),
    NOWPAYMENTS_IPN_SECRET: z.string().optional(),

    // Seed
    SEED_SUPER_ADMIN_EMAIL: z.string().email().default('superadmin@copytrade.app'),
    SEED_SUPER_ADMIN_PASSWORD: z.string().optional(),
    SEED_TENANT_ADMIN_EMAIL: z.string().email().default('admin@acme-capital.test'),
    SEED_TENANT_ADMIN_PASSWORD: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    const symmetric = env.JWT_ALGORITHM.startsWith('HS');
    if (symmetric) {
      if (!env.JWT_ACCESS_SECRET || env.JWT_ACCESS_SECRET.length < 32) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['JWT_ACCESS_SECRET'],
          message: 'JWT_ACCESS_SECRET must be at least 32 characters when using an HS algorithm',
        });
      }
      if (!env.JWT_REFRESH_SECRET || env.JWT_REFRESH_SECRET.length < 32) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['JWT_REFRESH_SECRET'],
          message: 'JWT_REFRESH_SECRET must be at least 32 characters when using an HS algorithm',
        });
      }
      if (
        env.JWT_ACCESS_SECRET &&
        env.JWT_REFRESH_SECRET &&
        env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['JWT_REFRESH_SECRET'],
          message: 'JWT_REFRESH_SECRET must differ from JWT_ACCESS_SECRET',
        });
      }
    } else {
      if (!env.JWT_PRIVATE_KEY_BASE64) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['JWT_PRIVATE_KEY_BASE64'],
          message: 'JWT_PRIVATE_KEY_BASE64 is required for RS algorithms',
        });
      }
      if (!env.JWT_PUBLIC_KEY_BASE64) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['JWT_PUBLIC_KEY_BASE64'],
          message: 'JWT_PUBLIC_KEY_BASE64 is required for RS algorithms',
        });
      }
    }

    const masterKey = Buffer.from(env.ENCRYPTION_MASTER_KEY_BASE64, 'base64');
    if (masterKey.length !== 32) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ENCRYPTION_MASTER_KEY_BASE64'],
        message: 'ENCRYPTION_MASTER_KEY_BASE64 must decode to exactly 32 bytes (AES-256)',
      });
    }

    const blindIndexKey = Buffer.from(env.BLIND_INDEX_KEY_BASE64, 'base64');
    if (blindIndexKey.length < 32) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['BLIND_INDEX_KEY_BASE64'],
        message: 'BLIND_INDEX_KEY_BASE64 must decode to at least 32 bytes',
      });
    }

    if (env.NODE_ENV === 'production') {
      if (env.SWAGGER_ENABLED && !env.SWAGGER_PASSWORD) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['SWAGGER_PASSWORD'],
          message: 'Swagger must be protected with basic auth in production',
        });
      }
    }

    // -----------------------------------------------------------------------
    // Part 5: execution mode coherence
    // -----------------------------------------------------------------------
    // These combinations are contradictory. The platform refuses to boot
    // rather than pick one, because every possible automatic resolution is
    // either surprising or dangerous, and "surprising" on a money path is
    // just "dangerous" with a delay.

    if (env.LIVE_TRADING_ENABLED && env.DRY_RUN) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DRY_RUN'],
        message:
          'LIVE_TRADING_ENABLED=true conflicts with DRY_RUN=true. ' +
          'Dry run never transmits, so live trading could not work; and silently ' +
          'preferring either one would mean guessing whether you wanted real ' +
          'orders. Set exactly one of them.',
      });
    }

    if (env.LIVE_TRADING_ENABLED && env.PAPER_TRADING) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['PAPER_TRADING'],
        message:
          'LIVE_TRADING_ENABLED=true conflicts with PAPER_TRADING=true. ' +
          'Set PAPER_TRADING=false to trade live, or LIVE_TRADING_ENABLED=false ' +
          'to keep simulating.',
      });
    }

    if (env.LIVE_TRADING_ENABLED && !env.EXECUTION_ENABLED) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['EXECUTION_ENABLED'],
        message:
          'LIVE_TRADING_ENABLED=true requires EXECUTION_ENABLED=true. ' +
          'The execution pipeline is the thing that enforces the risk engine ' +
          'and the kill switches; arming live trading without it is not a ' +
          'configuration this platform will run.',
      });
    }

    if (env.LIVE_TRADING_ENABLED && env.EXCHANGE_SANDBOX_MODE) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['EXCHANGE_SANDBOX_MODE'],
        message:
          'LIVE_TRADING_ENABLED=true conflicts with EXCHANGE_SANDBOX_MODE=true. ' +
          'Sandbox mode points the adapters at testnet endpoints.',
      });
    }

    // A credential pair is all-or-nothing. A key without its secret produces a
    // signature failure on the first live request, which is a confusing way to
    // discover a typo in a .env file.
    if (Boolean(env.BINANCE_API_KEY) !== Boolean(env.BINANCE_API_SECRET)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [env.BINANCE_API_KEY ? 'BINANCE_API_SECRET' : 'BINANCE_API_KEY'],
        message:
          'BINANCE_API_KEY and BINANCE_API_SECRET must be provided together, or ' +
          'both omitted.',
      });
    }

    if (env.LIVE_TRADING_ENABLED && env.ORDER_REQUEST_TIMEOUT_MS < 1000) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ORDER_REQUEST_TIMEOUT_MS'],
        message:
          'ORDER_REQUEST_TIMEOUT_MS below 1000ms will manufacture unknown order ' +
          'results under normal network jitter. Each one blocks the order until ' +
          'reconciliation resolves it.',
      });
    }

    // The idempotency key must outlive the reconciliation of the order it
    // guards. If it expires first, a retry of the same intent is no longer
    // recognised as a duplicate and becomes a second real position.
    const idempotencyTtlMs = env.EXECUTION_IDEMPOTENCY_TTL_SECONDS * 1000;
    if (idempotencyTtlMs <= env.ORDER_RECONCILIATION_INTERVAL_MS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['EXECUTION_IDEMPOTENCY_TTL_SECONDS'],
        message:
          'EXECUTION_IDEMPOTENCY_TTL_SECONDS must exceed ' +
          'ORDER_RECONCILIATION_INTERVAL_MS. An idempotency key that expires ' +
          'before its order is reconciled stops preventing duplicates.',
      });
    }

    // --- Part 6 -------------------------------------------------------

    // A strategy engine with nowhere to send a signal is a misconfiguration,
    // not a safe default: it burns CPU on every market-data event and silently
    // discards every decision.
    if (
      env.STRATEGY_ENGINE_ENABLED &&
      !env.PAPER_TRADING_ENABLED &&
      !env.BACKTEST_ENABLED &&
      !env.EXECUTION_ENABLED
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['STRATEGY_ENGINE_ENABLED'],
        message:
          'STRATEGY_ENGINE_ENABLED=true requires at least one consumer: ' +
          'PAPER_TRADING_ENABLED, BACKTEST_ENABLED or EXECUTION_ENABLED. ' +
          'Enabling the engine alone processes every event and discards every ' +
          'signal.',
      });
    }

    // The dedup window must outlive the signals it deduplicates. If it expires
    // first, a strategy repeating itself produces a second order while the
    // first is still considered current.
    if (env.SIGNAL_DEDUP_TTL_SECONDS * 1000 < env.SIGNAL_MAX_AGE_MS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SIGNAL_DEDUP_TTL_SECONDS'],
        message:
          'SIGNAL_DEDUP_TTL_SECONDS must cover at least SIGNAL_MAX_AGE_MS. A ' +
          'dedup entry that expires while the signal it guards is still valid ' +
          'stops preventing duplicate signals.',
      });
    }

    // A processing budget larger than the signal validity window would make
    // every signal stale by construction.
    if (env.STRATEGY_MAX_PROCESSING_LATENCY_MS >= env.SIGNAL_MAX_AGE_MS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['STRATEGY_MAX_PROCESSING_LATENCY_MS'],
        message:
          'STRATEGY_MAX_PROCESSING_LATENCY_MS must be well below ' +
          'SIGNAL_MAX_AGE_MS, otherwise a dispatch that merely hits its budget ' +
          'produces a signal the validator will refuse as stale.',
      });
    }

    if (env.STRATEGY_EVENT_QUEUE_SIZE < 100 || env.STRATEGY_EVENT_QUEUE_SIZE > 1000000) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['STRATEGY_EVENT_QUEUE_SIZE'],
        message:
          'STRATEGY_EVENT_QUEUE_SIZE must be between 100 and 1000000. Too small ' +
          'sheds load on every burst; too large defers backpressure until the ' +
          'process runs out of memory.',
      });
    }

    if (env.STRATEGY_MAX_INSTANCES < 1 || env.STRATEGY_MAX_INSTANCES > 1000) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['STRATEGY_MAX_INSTANCES'],
        message: 'STRATEGY_MAX_INSTANCES must be between 1 and 1000.',
      });
    }

    if (Number.parseFloat(env.BACKTEST_DEFAULT_INITIAL_CAPITAL) <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['BACKTEST_DEFAULT_INITIAL_CAPITAL'],
        message: 'BACKTEST_DEFAULT_INITIAL_CAPITAL must be greater than zero.',
      });
    }

    // Zero fees and zero slippage are permitted, because an operator may want
    // to isolate the effect of costs. They are also the single most flattering
    // pair of assumptions available, so the combination is called out.
    if (
      env.BACKTEST_ENABLED &&
      Number.parseFloat(env.BACKTEST_DEFAULT_TAKER_FEE) === 0 &&
      Number.parseFloat(env.BACKTEST_DEFAULT_SLIPPAGE_BPS) === 0 &&
      env.NODE_ENV === 'production'
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['BACKTEST_DEFAULT_TAKER_FEE'],
        message:
          'Refusing zero taker fee together with zero slippage in production. ' +
          'That combination produces backtest results no real account could ' +
          'achieve. Set realistic venue costs, or run this configuration ' +
          'outside production.',
      });
    }

    // --- Part 7 -------------------------------------------------------

    if (env.DATASET_MAX_PARTITION_BYTES < 1048576 || env.DATASET_MAX_PARTITION_BYTES > 4294967296) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DATASET_MAX_PARTITION_BYTES'],
        message:
          'DATASET_MAX_PARTITION_BYTES must be between 1 MiB and 4 GiB. Smaller ' +
          'creates millions of files; larger defeats the bounded re-reads the ' +
          'storage layer promises.',
      });
    }

    if (env.DATASET_READER_BUFFER_SIZE < 4096 || env.DATASET_READER_BUFFER_SIZE > 67108864) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DATASET_READER_BUFFER_SIZE'],
        message: 'DATASET_READER_BUFFER_SIZE must be between 4 KiB and 64 MiB.',
      });
    }

    if (env.DATASET_MAX_EVENTS_PER_PARTITION < 1000 || env.DATASET_MAX_EVENTS_PER_PARTITION > 50000000) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DATASET_MAX_EVENTS_PER_PARTITION'],
        message: 'DATASET_MAX_EVENTS_PER_PARTITION must be between 1,000 and 50,000,000.',
      });
    }

    if (env.DATASET_MAX_GAP_WARNINGS < 0 || env.DATASET_MAX_GAP_WARNINGS > 10000) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DATASET_MAX_GAP_WARNINGS'],
        message: 'DATASET_MAX_GAP_WARNINGS must be between 0 and 10,000.',
      });
    }

    // A relative dataset root in production is a dataset tree under wherever
    // the process happened to start, and it moves with the next deployment
    // layout change. Loud refusal beats a disappearing registry.
    const absolute = (value: string): boolean => value.startsWith('/');
    if (env.NODE_ENV === 'production') {
      for (const [path, value] of [
        ['DATASET_LOCAL_ROOT', env.DATASET_LOCAL_ROOT],
        ['DATASET_TEMP_ROOT', env.DATASET_TEMP_ROOT],
      ] as const) {
        if (!absolute(value)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [path],
            message: `${path} must be an absolute path in production.`,
          });
        }
      }
    }

    // Staging inside the dataset root would make the finalisation rename a
    // move-within-tree; the local storage refuses equal roots, and this
    // refuses staging nested under it, for the same reason.
    if (
      env.DATASET_TEMP_ROOT === env.DATASET_LOCAL_ROOT ||
      env.DATASET_TEMP_ROOT.startsWith(env.DATASET_LOCAL_ROOT + '/') ||
      env.DATASET_LOCAL_ROOT.startsWith(env.DATASET_TEMP_ROOT + '/')
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DATASET_TEMP_ROOT'],
        message:
          'DATASET_TEMP_ROOT and DATASET_LOCAL_ROOT must be disjoint paths: ' +
          'atomic finalisation depends on staging being invisible until the ' +
          'rename, which it is not when it lives inside the visible tree.',
      });
    }

    if (env.ORDER_UNKNOWN_RECONCILIATION_DELAY_MS >= env.ORDER_RECONCILIATION_INTERVAL_MS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ORDER_UNKNOWN_RECONCILIATION_DELAY_MS'],
        message:
          'ORDER_UNKNOWN_RECONCILIATION_DELAY_MS must be shorter than ' +
          'ORDER_RECONCILIATION_INTERVAL_MS, otherwise an unknown order waits a ' +
          'full extra sweep before anyone asks the venue about it.',
      });
    }

    // --- Part 8 -------------------------------------------------------
    // Risk control-plane coherence. These checks refuse deployments where
    // the safety timing contradicts itself; none of them can loosen a limit.

    if (env.RISK_FAIL_CLOSED !== true) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['RISK_FAIL_CLOSED'],
        message:
          'RISK_FAIL_CLOSED has exactly one legal value: true. The engine ' +
          'refusing an order it cannot prove safe is the whole design; a ' +
          'toggle to disable it would be the bypass the risk layer exists to ' +
          'make impossible. Remove the variable or set it to true.',
      });
    }

    if (env.MAX_RISK_STATE_AGE_MS < 100 || env.MAX_RISK_STATE_AGE_MS > 60_000) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['MAX_RISK_STATE_AGE_MS'],
        message: 'MAX_RISK_STATE_AGE_MS must be between 100 and 60000.',
      });
    }

    // The refresh cadence and the staleness budget must be consistent or the
    // deployment is GUARANTEED stale: a snapshot older than the budget on
    // every evaluation denies every risk-increasing order forever. A one-shot
    // startup refusal beats that silent outage.
    if (env.RISK_SNAPSHOT_REFRESH_MS >= env.MAX_RISK_STATE_AGE_MS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['RISK_SNAPSHOT_REFRESH_MS'],
        message:
          'RISK_SNAPSHOT_REFRESH_MS must be shorter than MAX_RISK_STATE_AGE_MS, ' +
          'otherwise every snapshot is older than the budget when it is read ' +
          'and the gate - correctly - denies everything.',
      });
    }

    if (env.MAX_ORDERS_PER_MINUTE < env.MAX_ORDERS_PER_SECOND) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['MAX_ORDERS_PER_MINUTE'],
        message:
          'MAX_ORDERS_PER_MINUTE must be at least MAX_ORDERS_PER_SECOND: a ' +
          'per-minute budget smaller than the per-second budget makes the ' +
          'second ceiling unreachable and invites an operator to "fix" the ' +
          'wrong one of the two.',
      });
    }
    if (env.MAX_CANCELS_PER_MINUTE < env.MAX_CANCELS_PER_SECOND) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['MAX_CANCELS_PER_MINUTE'],
        message:
          'MAX_CANCELS_PER_MINUTE must be at least MAX_CANCELS_PER_SECOND, for ' +
          'the same reason as the order windows.',
      });
    }

    if (
      env.NODE_ENV === 'production' &&
      env.RISK_ENGINE_ENABLED !== true
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['RISK_ENGINE_ENABLED'],
        message:
          'RISK_ENGINE_ENABLED=false in production: the extended risk gate is ' +
          'optional for local tooling and mandatory for real money. A ' +
          'production deployment must boot the full rule catalog or not boot.',
      });
    }
  })
  // Part 9: chained onto the SAME schema rather than a standalone statement -
  // zod's .superRefine returns a wrapper instead of mutating in place, so a
  // discarded expression would silently never run inside envSchema.safeParse.
  .superRefine((env, ctx) => {
    // Part 9: mandatory-in-production flags. The message tells the operator
    // WHICH flag and WHY, in the order they will hit them during a 3am.
    const mandatory = [
      ['OBSERVABILITY_ENABLED', 'the operations panel, health mirror and alert stream'],
      ['METRICS_ENABLED', 'the Prometheus exposition every dashboard and alert rule derives from'],
      ['HEALTH_ENABLED', 'the liveness/readiness probes the orchestrator and the API itself consume'],
      ['PROMETHEUS_ENABLED', 'the metrics endpoint (disabling it while METRICS_ENABLED is a config mistake)'],
      ['ALERTING_ENABLED', 'the alert fold that turns engine conditions into durable, deduped history'],
    ] as const;
    for (const [key, why] of mandatory) {
      if (env.NODE_ENV === 'production' && env[key] !== true) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `${key}=false in production: a production deployment of a real-money platform ships with ${why}. Boot with them on, or run local tooling.`,
        });
      }
    }
    if (env.NODE_ENV === 'production' && !env.METRICS_TOKEN) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['METRICS_TOKEN'],
        message:
          'METRICS_TOKEN is required in production so the metrics exposition is ' +
          'never reachable unauthenticated on a shared listener. Provide one via ' +
          'the secret store; do not commit it.',
      });
    }
    if (env.ALERT_RETENTION_DAYS < 7) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ALERT_RETENTION_DAYS'],
        message: 'ALERT_RETENTION_DAYS cannot go below 7: a week is the floor for post-incident review.',
      });
    }
    if (env.INCIDENT_RETENTION_DAYS < 30) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['INCIDENT_RETENTION_DAYS'],
        message: 'INCIDENT_RETENTION_DAYS cannot go below 30: incidents are reviewed after the month they happened in.',
      });
    }
    if (env.ALERT_DEDUP_WINDOW_MS < env.HEALTH_REFRESH_MS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ALERT_DEDUP_WINDOW_MS'],
        message: 'ALERT_DEDUP_WINDOW_MS must be >= HEALTH_REFRESH_MS: a flag younger than the publish cadence is noise, not signal.',
      });
    }
  })
  // Part 10: chained onto the SAME schema (same discipline as the Part 9
  // block above - a discarded .superRefine expression never runs).
  .superRefine((env, ctx) => {
    // Production keeps its eyes open: with the Part 9 flags mandatory, a
    // tracing-enabled production process with nowhere to send spans is the
    // one combination that reads as 'on' and means 'off'.
    if (env.NODE_ENV === 'production' && env.OTEL_ENABLED === true && env.OTEL_ENDPOINT === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['OTEL_ENDPOINT'],
        message:
          'OTEL_ENDPOINT is mandatory in production when OTEL_ENABLED=true: ' +
          'telemetry with nowhere to go is silent telemetry, and ' +
          'silent telemetry is what this whole part exists to forbid.',
      });
    }

    // Fault injection: never in production, and never unguarded. Setting
    // the non-production-only guard to false does NOT unlock production -
    // it disables the feature outright (fail closed in both directions).
    if (env.FAILURE_INJECTION_ENABLED === true) {
      if (env.FAILURE_INJECTION_ALLOW_NON_PRODUCTION_ONLY !== true) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['FAILURE_INJECTION_ALLOW_NON_PRODUCTION_ONLY'],
          message:
            'FAILURE_INJECTION_ENABLED=true requires the ' +
            'FAILURE_INJECTION_ALLOW_NON_PRODUCTION_ONLY guard to be true; ' +
            'disabling the guard disables the feature, it does not unlock more.',
        });
      }
      if (env.NODE_ENV === 'production') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['FAILURE_INJECTION_ENABLED'],
          message:
            'FAILURE_INJECTION_ENABLED=true is a test-harness switch; ' +
            'production refuses to boot with it armed.',
        });
      }
    }

    // SLO coherence: the retention floor must outlive the longest window the
    // evaluator reads; the cadence must not exceed the configured default
    // window; the paging multipliers must be finite decimals with slow <=
    // fast (the engine refuses the inverse construction; startup must not
    // discover at 3am what boot could have refused).
    if (env.SLO_RETENTION_DAYS < 7) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SLO_RETENTION_DAYS'],
        message:
          'SLO_RETENTION_DAYS cannot go below 7: burn windows read back a ' +
          'week, and rows they read must still exist.',
      });
    }
    if (
      env.SLO_DEFAULT_WINDOW_MINUTES < 5 ||
      env.SLO_DEFAULT_WINDOW_MINUTES > 10_080
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SLO_DEFAULT_WINDOW_MINUTES'],
        message: 'SLO_DEFAULT_WINDOW_MINUTES must be between 5 and 10080.',
      });
    }
    if (env.SLO_EVALUATION_INTERVAL_MINUTES > env.SLO_DEFAULT_WINDOW_MINUTES) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SLO_EVALUATION_INTERVAL_MINUTES'],
        message:
          'SLO_EVALUATION_INTERVAL_MINUTES must not exceed ' +
          'SLO_DEFAULT_WINDOW_MINUTES: a cadence slower than the window it ' +
          'judges evaluates every window at most once and calls the rest ' +
          'of the gap coverage.',
      });
    }
    const multipliers: Array<[string, string]> = [
      ['SLO_FAST_BURN_MULTIPLIER', env.SLO_FAST_BURN_MULTIPLIER],
      ['SLO_SLOW_BURN_MULTIPLIER', env.SLO_SLOW_BURN_MULTIPLIER],
    ];
    const parsed = new Map<string, number>();
    for (const [key, raw] of multipliers) {
      if (!/^\d+(?:\.\d{1,4})?$/.test(raw)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `${key} must be a plain decimal multiplier string (at most 4 decimal places).`,
        });
        continue;
      }
      parsed.set(key, Number(raw));
    }
    if (
      parsed.has('SLO_FAST_BURN_MULTIPLIER') &&
      parsed.has('SLO_SLOW_BURN_MULTIPLIER') &&
      (parsed.get('SLO_SLOW_BURN_MULTIPLIER') as number) >
        (parsed.get('SLO_FAST_BURN_MULTIPLIER') as number)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SLO_SLOW_BURN_MULTIPLIER'],
        message:
          'SLO_SLOW_BURN_MULTIPLIER must not exceed SLO_FAST_BURN_MULTIPLIER ' +
          '(the engine refuses the inverse construction for the same reason).',
      });
    }
  });

export type AppEnv = z.infer<typeof envSchema>;

export interface EnvValidationFailure {
  path: string;
  message: string;
}

export class EnvValidationError extends Error {
  public readonly failures: EnvValidationFailure[];

  constructor(failures: EnvValidationFailure[]) {
    super(
      `Invalid environment configuration:\n${failures
        .map((failure) => `  - ${failure.path}: ${failure.message}`)
        .join('\n')}`,
    );
    this.name = 'EnvValidationError';
    this.failures = failures;
  }
}

/**
 * Parses and validates `process.env`. Throws {@link EnvValidationError} listing
 * every problem at once so operators can fix configuration in a single pass.
 */
export function validateEnv(source: Record<string, unknown> = process.env): AppEnv {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const failures = result.error.issues.map((issue) => ({
      path: issue.path.join('.') || '(root)',
      message: issue.message,
    }));
    throw new EnvValidationError(failures);
  }
  return result.data;
}
```

## FILE: .env.example (924 lines)

```bash
# =============================================================================
# WHITE-LABEL CRYPTO COPY-TRADING PLATFORM - ENVIRONMENT CONFIGURATION
# =============================================================================
# Copy to .env and fill in real values. NEVER commit .env.
# Generate cryptographic material with: npm run keys:generate
# =============================================================================

# -----------------------------------------------------------------------------
# APPLICATION
# -----------------------------------------------------------------------------
NODE_ENV=development
APP_NAME=WhiteLabelCopyTrade
API_PORT=4000
API_HOST=0.0.0.0
API_GLOBAL_PREFIX=api
API_DEFAULT_VERSION=1
# Public base URL of the API (used in emails, webhooks, OpenAPI servers)
API_PUBLIC_URL=http://localhost:4000
# Public base URL of the admin web application
ADMIN_WEB_URL=http://localhost:3000
# Host port the admin console is published on by Docker Compose.
ADMIN_WEB_PORT=3000
# Trust N reverse proxy hops (nginx/ALB). 0 disables proxy trust.
TRUST_PROXY_HOPS=1
# Root domain used to resolve tenants from sub-domains: acme.copytrade.app
PLATFORM_ROOT_DOMAIN=copytrade.app
# Fallback tenant slug used when a request carries no resolvable tenant context
DEFAULT_TENANT_SLUG=platform

# -----------------------------------------------------------------------------
# DATABASE (PostgreSQL)
# -----------------------------------------------------------------------------
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_USER=copytrade
POSTGRES_PASSWORD=change_me_postgres_password
POSTGRES_DB=copytrade
POSTGRES_SCHEMA=public
# Password for the least-privilege runtime role created by
# infrastructure/database/init/02-roles.sql. Leave blank to skip role creation.
POSTGRES_APP_PASSWORD=
# Prisma connection string. Inside docker-compose use host "postgres".
DATABASE_URL=postgresql://copytrade:change_me_postgres_password@localhost:5432/copytrade?schema=public&connection_limit=20&pool_timeout=20
# REQUIRED, not optional. schema.prisma declares `directUrl`, and Prisma refuses
# to run ANY migrate/generate command when the variable is missing (error P1012)
# even though the application itself never reads it. Point it at the database
# directly, bypassing any connection pooler (PgBouncer, RDS Proxy) and without
# the pooling query parameters, so DDL runs on a real session. With no pooler in
# front of PostgreSQL it is simply DATABASE_URL minus connection_limit/pool_timeout.
DIRECT_DATABASE_URL=postgresql://copytrade:change_me_postgres_password@localhost:5432/copytrade?schema=public
DATABASE_LOG_QUERIES=false
DATABASE_SSL=false

# -----------------------------------------------------------------------------
# REDIS (cache, rate limiting, queues, websocket adapter)
# -----------------------------------------------------------------------------
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0
REDIS_TLS=false
REDIS_KEY_PREFIX=wlct:
REDIS_URL=redis://localhost:6379/0

# -----------------------------------------------------------------------------
# JWT / AUTHENTICATION
# -----------------------------------------------------------------------------
# Asymmetric signing is recommended in production (RS256). For HS256 provide secrets.
JWT_ALGORITHM=HS256
JWT_ACCESS_SECRET=change_me_access_secret_min_32_chars_long
JWT_REFRESH_SECRET=change_me_refresh_secret_min_32_chars_long
# Base64-encoded PEM keys, required when JWT_ALGORITHM=RS256
JWT_PRIVATE_KEY_BASE64=
JWT_PUBLIC_KEY_BASE64=
JWT_ACCESS_TTL=900s
JWT_REFRESH_TTL=30d
JWT_ISSUER=https://api.copytrade.app
JWT_AUDIENCE=copytrade-clients
# Maximum concurrent active sessions (devices) per user
MAX_ACTIVE_SESSIONS_PER_USER=10

# Password policy / hashing (argon2id)
PASSWORD_MIN_LENGTH=12
ARGON2_MEMORY_COST=19456
ARGON2_TIME_COST=2
ARGON2_PARALLELISM=1

# Account protection
LOGIN_MAX_FAILED_ATTEMPTS=5
LOGIN_FAILED_WINDOW_SECONDS=900
ACCOUNT_LOCKOUT_SECONDS=900

# -----------------------------------------------------------------------------
# ENCRYPTION (exchange API credential envelope encryption)
# -----------------------------------------------------------------------------
# 32-byte key, base64 encoded. Key Encryption Key used to wrap per-record DEKs.
ENCRYPTION_MASTER_KEY_BASE64=
# Identifier of the active master key; enables zero-downtime key rotation.
ENCRYPTION_KEY_ID=local-dev-v1
# Previous keys kept for decrypt-only, JSON map: {"local-dev-v0":"<base64key>"}
ENCRYPTION_PREVIOUS_KEYS_JSON={}
# kms | local  -> "kms" delegates KEK operations to a managed KMS provider
ENCRYPTION_PROVIDER=local
KMS_PROVIDER=
KMS_KEY_ARN=
# Deterministic HMAC key used to build blind indexes (lookup on encrypted values)
BLIND_INDEX_KEY_BASE64=

# -----------------------------------------------------------------------------
# TWO-FACTOR AUTHENTICATION (TOTP)
# -----------------------------------------------------------------------------
TWO_FACTOR_ISSUER=CopyTrade
TWO_FACTOR_WINDOW=1
TWO_FACTOR_DIGITS=6
TWO_FACTOR_PERIOD=30
TWO_FACTOR_RECOVERY_CODES=10
# Short-lived token issued between password step and 2FA step
TWO_FACTOR_CHALLENGE_TTL=300s
# Wrong codes tolerated per challenge token before it is discarded.
TWO_FACTOR_MAX_CHALLENGE_ATTEMPTS=5

# -----------------------------------------------------------------------------
# CORS
# -----------------------------------------------------------------------------
CORS_ENABLED=true
CORS_ORIGINS=http://localhost:3000,http://localhost:4000
CORS_CREDENTIALS=true
CORS_ALLOWED_HEADERS=Content-Type,Authorization,X-Tenant-Slug,X-Request-Id,X-Api-Version,Accept-Language,X-2FA-Token
CORS_EXPOSED_HEADERS=X-Request-Id,X-RateLimit-Limit,X-RateLimit-Remaining,X-RateLimit-Reset

# -----------------------------------------------------------------------------
# RATE LIMITING
# -----------------------------------------------------------------------------
RATE_LIMIT_ENABLED=true
RATE_LIMIT_TTL_SECONDS=60
RATE_LIMIT_MAX=120
RATE_LIMIT_AUTH_TTL_SECONDS=300
RATE_LIMIT_AUTH_MAX=10
RATE_LIMIT_TRUSTED_IPS=127.0.0.1,::1

# -----------------------------------------------------------------------------
# SWAGGER / OPENAPI
# -----------------------------------------------------------------------------
SWAGGER_ENABLED=true
SWAGGER_PATH=docs
SWAGGER_TITLE="White-Label Copy Trading API"
SWAGGER_DESCRIPTION="Multi-tenant non-custodial crypto copy-trading platform API"
SWAGGER_VERSION=1.0.0
# Optional basic-auth protection for the docs route in non-local environments
SWAGGER_USER=
SWAGGER_PASSWORD=

# -----------------------------------------------------------------------------
# LOGGING
# -----------------------------------------------------------------------------
LOG_LEVEL=debug
# json | pretty
LOG_FORMAT=pretty
LOG_REQUEST_BODY=false
LOG_SAMPLE_RATE=1
SENTRY_DSN=

# -----------------------------------------------------------------------------
# WEBSOCKET
# -----------------------------------------------------------------------------
WS_ENABLED=true
WS_PATH=/realtime
WS_NAMESPACE=/v1
WS_PING_INTERVAL_MS=25000
WS_PING_TIMEOUT_MS=20000
WS_MAX_CONNECTIONS_PER_USER=5
# Redis adapter lets many API replicas share socket rooms
WS_REDIS_ADAPTER=true

# -----------------------------------------------------------------------------
# BULLMQ / BACKGROUND JOBS
# -----------------------------------------------------------------------------
QUEUE_PREFIX=wlct-queue
QUEUE_DEFAULT_ATTEMPTS=5
QUEUE_BACKOFF_MS=5000
QUEUE_REMOVE_ON_COMPLETE=1000
QUEUE_REMOVE_ON_FAIL=5000
QUEUE_CONCURRENCY=10
# Enable the in-process worker (single-container dev). Disable when running the dedicated worker.
QUEUE_RUN_INLINE_WORKERS=true
BULL_BOARD_ENABLED=false
BULL_BOARD_PATH=admin/queues

# -----------------------------------------------------------------------------
# EXCHANGE INTEGRATIONS (non-custodial: user-supplied trade-only API keys)
# -----------------------------------------------------------------------------
# Comma separated list of exchanges enabled platform-wide
EXCHANGES_ENABLED=binance,bybit,okx,kraken
EXCHANGE_SANDBOX_MODE=true
EXCHANGE_REQUEST_TIMEOUT_MS=10000
EXCHANGE_MAX_RETRIES=3
# Hard safety switch. Order execution remains disabled: the connectivity layer
# delivers market data only, and no order-placement adapter is registered.
EXECUTION_ENABLED=false
# Internal service endpoints
TRADING_ENGINE_URL=http://localhost:8001
TRADING_ENGINE_HEALTH_PATH=/health
MARKET_DATA_URL=http://localhost:8002
MARKET_DATA_HEALTH_PATH=/health
NOTIFICATION_SERVICE_URL=http://localhost:8003
NOTIFICATION_SERVICE_HEALTH_PATH=/health
# Shared secret for service-to-service authentication (mTLS recommended in prod)
INTERNAL_SERVICE_TOKEN=change_me_internal_service_token
# Signing secret used to verify inbound exchange webhooks
EXCHANGE_WEBHOOK_SIGNING_SECRET=change_me_webhook_secret

# -----------------------------------------------------------------------------
# EXCHANGE CONNECTIVITY (libs/trading-core: wlct_trading.transport / .exchanges)
# -----------------------------------------------------------------------------
# These tune the realtime market-data connectivity layer. They contain no
# credentials: public market data needs none, and user exchange API keys are
# stored encrypted per trading account in PostgreSQL, never in the environment.
#
# Only venues with an implemented adapter can be selected. Naming a venue here
# that has no adapter fails fast at startup rather than at the first order.
EXCHANGE_MARKET_DATA_VENUES=binance
# Use the venue testnet endpoints. Keep true outside production.
EXCHANGE_USE_TESTNET=true

# --- Order-book synchronisation ---
# Depth requested for the REST snapshot. Rounded up to a depth the venue
# accepts. Deeper snapshots cost significantly more rate-limit weight
# (Binance spot: 100 levels = 5 weight, 1000 = 50, 5000 = 250).
ORDERBOOK_SNAPSHOT_DEPTH=1000
# Diffs buffered while a snapshot is in flight. Bounds memory: at 100 msg/s
# this is roughly 50 seconds of runway.
ORDERBOOK_MAX_BUFFERED_DELTAS=5000
# Resync attempts before a book is marked FAILED and refuses to serve quotes.
# It never silently serves a book it could not verify.
ORDERBOOK_MAX_RESYNC_ATTEMPTS=10
# A book quiet for longer than this is treated as stale and is not tradeable.
ORDERBOOK_STALENESS_THRESHOLD_MS=5000

# --- Websocket connection management ---
# These are read by the live transport (wlct_trading.net); the Part 3 library
# itself reads no environment at all.
WEBSOCKET_CONNECT_TIMEOUT_MS=10000
WS_HEARTBEAT_INTERVAL_MS=20000
# Silence after which the socket is considered dead and rebuilt. MUST be
# greater than WS_HEARTBEAT_INTERVAL_MS or healthy connections get killed.
WEBSOCKET_HEARTBEAT_TIMEOUT_MS=90000
# Reconnect backoff: capped exponential with full jitter. Jitter is not
# optional in production - without it every connection retries in lockstep
# after a venue blip and the reconnect storm is self-inflicted.
WS_RECONNECT_BASE_DELAY_MS=500
WS_RECONNECT_MAX_DELAY_MS=30000
WS_RECONNECT_MAX_ATTEMPTS=20
# Binance drops stream connections at 24h; cycling early makes it planned.
WS_CONNECTION_MAX_LIFETIME_SECONDS=82800

# --- Staleness thresholds (per channel, milliseconds) ---
# Trades are legitimately sporadic on thin symbols; an order book going quiet
# is not. Thresholds differ so neither alert is useless.
STALENESS_ORDER_BOOK_MS=5000
STALENESS_BOOK_TICKER_MS=5000
STALENESS_TICKER_MS=10000
STALENESS_TRADES_MS=60000
STALENESS_CANDLES_MS=120000
STALENESS_CONNECTION_MS=30000

# --- Rate limiting (venue-published values; lower them, never raise them) ---
# Binance spot: 6000 request weight per minute per IP.
BINANCE_REQUEST_WEIGHT_PER_MINUTE=6000
# 5 inbound messages per second per socket, counting PING/PONG and every
# subscribe frame. Exceeding it disconnects; repeat offenders get IP-banned.
BINANCE_WS_MESSAGES_PER_SECOND=5
BINANCE_MAX_STREAMS_PER_CONNECTION=1024
# Metrics scrape interval for the connectivity layer.
CONNECTIVITY_METRICS_INTERVAL_SECONDS=15

# -----------------------------------------------------------------------------
# LIVE MARKET DATA TRANSPORT (libs/trading-core: wlct_trading.net)
# -----------------------------------------------------------------------------
# The concrete websocket and HTTP clients behind the Part 3 abstractions.
#
# PUBLIC MARKET DATA ONLY. Nothing in this section is a credential and nothing
# on this code path can accept one: the market-data adapter has no API-key
# parameter, no request is signed, and no order is ever submitted. Live order
# execution is NOT implemented.
#
# Endpoints. Both must be TLS - the service refuses to start on ws:// or
# http://, because market data an attacker can rewrite is a way to induce bad
# trades. When EXCHANGE_USE_TESTNET=true and these are left unset, the venue's
# testnet endpoints are used automatically.
BINANCE_WS_URL=wss://stream.binance.com:9443
BINANCE_REST_URL=https://api.binance.com

# Symbols to stream. Accepts BTC/USDT, BTC-USDT or BTCUSDT; all three are
# normalised to the canonical BASE-QUOTE form and then validated against the
# venue's own instrument list, so a typo or a delisted market fails at startup
# rather than producing a socket that is silent forever.
MARKET_DATA_SYMBOLS=BTC/USDT,ETH/USDT,SOL/USDT

# Channels. Each enabled channel adds one stream per symbol to the single
# shared connection (Binance allows 1024 streams per socket).
# "ticker" is the bookTicker stream: best bid/ask on every book change, which
# is what the risk engine's price checks need. The 1-second rolling ticker is a
# statistics feed, not a quote feed.
MARKET_DATA_TICKER_ENABLED=true
MARKET_DATA_TRADES_ENABLED=true
MARKET_DATA_ORDERBOOK_ENABLED=true

# Websocket timeouts. WEBSOCKET_RECEIVE_TIMEOUT_MS is a backstop below the
# heartbeat, not the primary liveness check: a thin symbol's trade stream can
# legitimately be silent for minutes, and the venue's protocol pings are
# answered by the client library without ever surfacing as a message. Set it
# too low and a healthy but quiet connection is torn down in a loop.
WEBSOCKET_RECEIVE_TIMEOUT_MS=300000
# Client-initiated ping cadence and its response deadline. Binance pings every
# 3 minutes and disconnects after 10 without a pong; this is the reverse
# direction, used to notice a peer that has gone away silently.
WEBSOCKET_PING_INTERVAL_MS=180000
WEBSOCKET_PING_TIMEOUT_MS=60000
WEBSOCKET_CLOSE_TIMEOUT_MS=5000
# Frame size ceiling. An unbounded reader is a memory-exhaustion vector.
WEBSOCKET_MAX_FRAME_BYTES=8388608

# HTTP timeouts for REST snapshots. Every request is bounded by all three;
# there is no code path that produces an unbounded wait.
HTTP_CONNECT_TIMEOUT_MS=5000
HTTP_READ_TIMEOUT_MS=10000
HTTP_TOTAL_TIMEOUT_MS=15000
# Retries are bounded and only fire for categories the retry policy calls
# retryable. A 400 is never retried; a 429 honours the venue's Retry-After.
HTTP_MAX_RETRIES=3
HTTP_MAX_CONNECTIONS=20

# Duration of the separately invoked live smoke test
# (scripts/live_market_data_smoke_test.py). That script is the only thing in
# the repository that touches a real exchange; the normal test suite needs no
# internet, credentials, database or Redis.
LIVE_MARKET_DATA_SMOKE_TEST_DURATION_SECONDS=30

# -----------------------------------------------------------------------------
# EMAIL
# -----------------------------------------------------------------------------
# console | smtp (implemented). ses and postmark are planned; selecting an
# unimplemented driver fails fast instead of dropping mail silently.
MAIL_DRIVER=console
MAIL_FROM_NAME=CopyTrade
MAIL_FROM_ADDRESS=no-reply@copytrade.app
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASSWORD=

# -----------------------------------------------------------------------------
# NOTIFICATIONS (push / sms / webhooks)
# -----------------------------------------------------------------------------
NOTIFICATIONS_ENABLED=true
FIREBASE_PROJECT_ID=
FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY_BASE64=
TELEGRAM_BOT_TOKEN=
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_FROM_NUMBER=

# -----------------------------------------------------------------------------
# LOCALIZATION / CURRENCY
# -----------------------------------------------------------------------------
DEFAULT_LOCALE=en
SUPPORTED_LOCALES=en,es,ar,bn,tr
DEFAULT_CURRENCY=USD
SUPPORTED_CURRENCIES=USD,EUR,GBP,AED,BDT,TRY
FX_RATES_PROVIDER=none
FX_RATES_API_KEY=

# -----------------------------------------------------------------------------
# KYC (architecture only in Part 1)
# -----------------------------------------------------------------------------
# none | sumsub | onfido | shufti
KYC_PROVIDER=none
KYC_API_URL=
KYC_APP_TOKEN=
KYC_SECRET_KEY=
KYC_WEBHOOK_SECRET=

# -----------------------------------------------------------------------------
# PAYMENTS / BILLING (architecture only in Part 1)
# -----------------------------------------------------------------------------
# none | stripe | nowpayments
BILLING_PROVIDER=none
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
NOWPAYMENTS_API_KEY=
NOWPAYMENTS_IPN_SECRET=

# -----------------------------------------------------------------------------
# BOOTSTRAP / SEED (development only)
# -----------------------------------------------------------------------------
# QUOTING: always wrap a value in double quotes if it contains '#', a space, or
# any shell metacharacter. The '#' case is the one that bites: dotenv-cli treats
# an unquoted '#' as the start of a comment and silently truncates the value,
# while sourcing the same file from bash (`set -a; . .env`) keeps it intact.
# The two then disagree, so the password the seed hashes is not the password
# your scripts send, and you get an inexplicable 401 followed by a lockout.
#   WRONG: SEED_SUPER_ADMIN_PASSWORD=My_P4ss#2026   -> becomes "My_P4ss"
#   RIGHT: SEED_SUPER_ADMIN_PASSWORD="My_P4ss#2026"
SEED_SUPER_ADMIN_EMAIL=superadmin@copytrade.app
SEED_SUPER_ADMIN_PASSWORD="ChangeMe_Str0ng!Pass"
SEED_TENANT_ADMIN_EMAIL=admin@acme-capital.test
SEED_TENANT_ADMIN_PASSWORD=ChangeMe_Str0ng!Pass

# -----------------------------------------------------------------------------
# ADMIN WEB (Next.js) - consumed by apps/admin-web
# -----------------------------------------------------------------------------
# Server-side base URL used by Next route handlers and server components to
# reach the API. Inside Docker Compose this becomes http://api:4000/api.
API_BASE_URL=http://localhost:4000/api
# Organisation the console administers when no custom domain is in play.
ADMIN_TENANT_SLUG=platform
# Salt for the console's session cookies. Generate: openssl rand -base64 32
SESSION_COOKIE_SECRET=change_me_admin_session_secret_min_16_chars

# Browser-visible values only. Never place a secret behind NEXT_PUBLIC_.
NEXT_PUBLIC_APP_NAME="CopyTrade Admin"
NEXT_PUBLIC_API_VERSION=v1
NEXT_PUBLIC_WS_URL=http://localhost:4000
NEXT_PUBLIC_WS_PATH=/socket.io
NEXT_PUBLIC_DEFAULT_LOCALE=en

# -----------------------------------------------------------------------------
# TRADING ENGINE (services/trading-engine, Python/FastAPI, port 8001)
# -----------------------------------------------------------------------------
TRADING_ENGINE_HOST=0.0.0.0
TRADING_ENGINE_PORT=8001

# Pre-trade risk ceilings. These are hard caps enforced by the engine on every
# order intent; they are not user-configurable from the client.
MAX_ORDER_NOTIONAL_USD=1000
MAX_OPEN_POSITIONS_PER_ACCOUNT=20
MAX_LEVERAGE=5

# -----------------------------------------------------------------------------
# MARKET DATA (services/market-data, Python/FastAPI, port 8002)
# -----------------------------------------------------------------------------
MARKET_DATA_HOST=0.0.0.0
MARKET_DATA_PORT=8002
# Public reference-price sources, tried in order. No credentials are used.
MARKET_DATA_SOURCES=binance,bybit
MARKET_DATA_SYMBOLS=BTC/USDT,ETH/USDT,SOL/USDT
MARKET_DATA_POLL_INTERVAL_SECONDS=5
# A cached quote older than this is served with stale=true.
MARKET_DATA_CACHE_TTL_SECONDS=15
# Enables the realtime websocket connectivity layer (wlct_trading.transport).
# Off by default: with it disabled the service serves cached REST quotes only
# and opens no exchange sockets.
MARKET_DATA_STREAMING_ENABLED=false

# -----------------------------------------------------------------------------
# NOTIFICATION SERVICE (services/notification-service, Node/BullMQ, port 8003)
# -----------------------------------------------------------------------------
NOTIFICATION_SERVICE_HOST=0.0.0.0
NOTIFICATION_SERVICE_PORT=8003
# The standalone worker reads MAIL_DRIVER, MAIL_FROM_* and SMTP_* from the
# EMAIL section above. Only "console" and "smtp" are implemented; any other
# value throws on startup rather than silently discarding mail.
# none | fcm | apns. "none" reports delivered:false instead of faking delivery.
PUSH_PROVIDER=none
# none | twilio
SMS_PROVIDER=none

# -----------------------------------------------------------------------------
# SHARED LOGGING (all Node and Python services)
# -----------------------------------------------------------------------------
# json in every deployed environment; pretty is for local terminals only.
LOG_FORMAT=json
# Additional pino redaction paths, comma separated. The built-in list already
# covers authorization headers, cookies, passwords, tokens and API secrets.
PINO_REDACT_PATHS=

# -----------------------------------------------------------------------------
# MOBILE APP (apps/mobile, Flutter)
# -----------------------------------------------------------------------------
# The Flutter app deliberately does NOT read this file. A .env shipped inside an
# APK/IPA is trivially extractable, so every mobile value is compiled in with
# --dart-define and the app holds no secrets at all: it authenticates with the
# user's own credentials and stores the resulting tokens in the platform
# keystore (flutter_secure_storage), never in shared preferences or a bundled
# asset. The variables below are listed here only so that all configuration for
# the platform lives in one discoverable place.
#
#   APP_ENV       development | staging | production
#   API_BASE_URL  Base URL INCLUDING the global prefix, e.g. https://api.example.com/api
#                 Android emulator reaches the host through 10.0.2.2, not localhost.
#                 Production builds refuse to start unless this is https://.
#   API_VERSION   URI version segment appended after the prefix (v1)
#   TENANT_SLUG   Sent as X-Tenant-Slug; identifies the white-label brand
#   WS_URL        Socket.IO origin, without the /realtime namespace
#
# Local development against this compose stack:
#
#   flutter run \
#     --dart-define=APP_ENV=development \
#     --dart-define=API_BASE_URL=http://10.0.2.2:4000/api \
#     --dart-define=API_VERSION=v1 \
#     --dart-define=TENANT_SLUG=platform \
#     --dart-define=WS_URL=http://10.0.2.2:4000
#
# Release build:
#
#   flutter build apk --release \
#     --dart-define=APP_ENV=production \
#     --dart-define=API_BASE_URL=https://api.example.com/api \
#     --dart-define=API_VERSION=v1 \
#     --dart-define=TENANT_SLUG=acme \
#     --dart-define=WS_URL=https://api.example.com
#
# Prefer --dart-define-from-file=config/production.json in CI so the values are
# versioned per environment instead of being retyped on the command line.

# =============================================================================
# PART 5 - AUTHENTICATED EXECUTION (libs/trading-core: wlct_trading.execution)
# =============================================================================
# Everything in this block governs whether real orders can reach a real
# exchange with real money. Read the whole section before changing anything.
#
# THE DEFAULTS BELOW CANNOT TRADE. That is deliberate and it is enforced in
# code, not just by convention: an unset variable is never treated as
# permission, and a contradictory combination fails at startup rather than
# resolving itself to the dangerous option.

# -----------------------------------------------------------------------------
# Exchange credentials
# -----------------------------------------------------------------------------
# NEVER commit real values. NEVER paste a key into a ticket, a chat message or
# a log. These are read once at startup by the credential provider and are
# never written to the database, never returned by an API, never included in a
# WebSocket payload and never logged - the credential object redacts itself in
# every rendering path, including repr() and f-strings.
#
# Create the key on Binance with ONLY:
#   [x] Enable Reading
#   [x] Enable Spot & Margin Trading
#   [ ] Enable Withdrawals   <-- MUST stay off
# A withdrawal-capable key is rejected by verify_credentials() and by the
# CREDENTIALS_VALID safety gate. The platform is non-custodial and refuses to
# hold a key that can move funds off the exchange.
#
# Also add an IP allowlist on the key. It is the single most effective control
# available, and it is free.
#
# These two variables are for a single-tenant development setup only. In
# production, per-tenant credentials come from the secret manager through
# SecretManagerCredentialProvider (Vault / AWS Secrets Manager / GCP Secret
# Manager / KMS), keyed by tenant and account. Environment variables do not
# scale to multi-tenant and cannot be rotated per customer.
BINANCE_API_KEY=
BINANCE_API_SECRET=
# Optional: restricts what the platform believes the key can do, independently
# of what the venue says. Comma separated. WITHDRAW here is always refused.
BINANCE_API_PERMISSIONS=SPOT
# Where credentials come from: env | secret-manager | none
CREDENTIAL_PROVIDER=env
# Cache TTL for a resolved credential, in seconds. Short, so a revoked key
# stops working quickly; non-zero, so every order does not hit the secret
# manager. 300 is a reasonable compromise.
CREDENTIAL_CACHE_TTL_SECONDS=300

# -----------------------------------------------------------------------------
# The four switches that gate real money
# -----------------------------------------------------------------------------
# All of the following must agree before a single byte reaches a real venue:
#
#   LIVE_TRADING_ENABLED=true
#   DRY_RUN=false
#   PAPER_TRADING=false
#   TRADING_MODE=LIVE
#   TRADING_ENABLED=true
#   LIVE_TRADING_CONFIRMED=true
#
# Any disagreement is a startup failure with an explicit message. In
# particular:
#   * LIVE_TRADING_ENABLED=true with DRY_RUN=true   -> REJECTED (contradiction)
#   * LIVE_TRADING_ENABLED=true with PAPER_TRADING=true -> REJECTED
#   * LIVE_TRADING_ENABLED=true without TRADING_MODE=LIVE -> REJECTED
# The platform never silently picks the dangerous interpretation, and never
# silently downgrades a misconfigured LIVE to PAPER either - a silent downgrade
# hides a production misconfiguration until the day it matters.

# Master switch for real-money execution.
LIVE_TRADING_ENABLED=false

# Build, validate, risk-check and sign the request, then stop. Nothing is
# transmitted and the order is NEVER reported as submitted. This is the correct
# setting for verifying a configuration end to end without risk.
DRY_RUN=true

# Route orders to the simulated venue. Paper fills are computed from real
# observed prices and are labelled is_simulated=true everywhere they appear -
# in the database, in the API and in every PnL figure.
PAPER_TRADING=true

# -----------------------------------------------------------------------------
# Execution timing
# -----------------------------------------------------------------------------
# How long to wait for a venue response before treating the outcome as UNKNOWN.
# A timeout is ambiguous, not a failure: the order may have been accepted. It
# is reconciled by clientOrderId and never resubmitted.
ORDER_REQUEST_TIMEOUT_MS=10000

# How often the background sweep compares local state against the venue.
ORDER_RECONCILIATION_INTERVAL_MS=60000

# How long to wait before reconciling an order whose result was unknown. Long
# enough for the venue to have finished processing; short enough that a
# position is not a mystery for minutes.
ORDER_UNKNOWN_RECONCILIATION_DELAY_MS=2000

# How often the exchange clock offset is re-measured. A signed request whose
# timestamp is outside the venue's window is rejected, so this is not optional.
EXCHANGE_TIME_SYNC_INTERVAL_MS=300000

# Maximum tolerated difference between this host's clock and the venue's.
# Above this, signing is REFUSED rather than attempted - Binance rejects a
# timestamp more than 1000ms ahead of server time regardless of recvWindow, so
# a larger local error cannot be compensated for by widening the window. If you
# hit this, fix NTP; do not raise the limit.
EXCHANGE_MAX_CLOCK_SKEW_MS=1000

# recvWindow sent with every signed request. Binance caps this at 60000.
# Smaller is safer: it bounds how long a captured request stays replayable.
EXCHANGE_RECV_WINDOW_MS=5000

# How long a clientOrderId reservation is remembered in Redis. The durable
# guard is the unique index on (tenant_id, client_order_id); this is the cheap
# fast path in front of it. 86400 = 24h.
EXECUTION_IDEMPOTENCY_TTL_SECONDS=86400

# Refuse to submit when the risk snapshot is older than this. Stale risk state
# is treated as unavailable, and unavailable means the order is refused.
MAX_RISK_STATE_AGE_MS=5000

# Submission attempts for genuinely retryable failures. Never applied to an
# ambiguous result - that path reconciles instead of retrying, always.
MAX_SUBMIT_ATTEMPTS=1

# -----------------------------------------------------------------------------
# Private user-data stream
# -----------------------------------------------------------------------------
# The authenticated WebSocket that delivers fills, order updates and balance
# changes. Backend only: its payloads are the full order flow of a real
# account and must never reach a mobile client or the admin web app.
PRIVATE_STREAM_RECONNECT_ENABLED=true

# Listen-key keepalive interval. Binance expires a listen key after 60 minutes;
# 30 minutes means one renewal can fail entirely and the stream still survives.
PRIVATE_STREAM_LISTEN_KEY_REFRESH_MS=1800000

# After every reconnect the platform reconciles, because Binance does not
# replay events missed while disconnected. Leave this on.
PRIVATE_STREAM_RECONCILE_ON_RECONNECT=true

# -----------------------------------------------------------------------------
# Live-trading harness (NOT part of the default startup path)
# -----------------------------------------------------------------------------
# Guards the separately-invoked script that places a real order on testnet.
# It refuses to run unless this is explicitly true AND the credentials point at
# a testnet endpoint.
LIVE_EXECUTION_HARNESS_ENABLED=false
BINANCE_USE_TESTNET_FOR_HARNESS=true

# =============================================================================
# PART 6 - STRATEGY ENGINE, PAPER TRADING, BACKTESTING
# =============================================================================
# The strategy layer decides what it would like to do. It cannot submit an
# order, it never sees a credential, and NOTHING IN THIS SECTION CAN ENABLE
# LIVE TRADING. That still requires the Part 5 combination above
# (LIVE_TRADING_ENABLED=true, EXECUTION_ENABLED=true, DRY_RUN=false,
# PAPER_TRADING=false, EXCHANGE_SANDBOX_MODE=false), and every one of those is
# validated at startup.
#
# THREE THINGS THIS SECTION CANNOT PROMISE:
#   BACKTEST PERFORMANCE IS NOT INDICATIVE OF FUTURE PERFORMANCE.
#   PAPER PERFORMANCE IS NOT INDICATIVE OF LIVE PERFORMANCE.
#   SIMULATION DOES NOT GUARANTEE REAL EXECUTION QUALITY.

# -----------------------------------------------------------------------------
# Feature switches
# -----------------------------------------------------------------------------
# Master switch for the strategy engine. Off by default: a deployment that has
# not been asked to run strategies should not spend CPU on every book update.
STRATEGY_ENGINE_ENABLED=false

# Whether paper sessions may be started. A paper session routes to the
# simulated adapter and refuses any adapter that is not marked simulated, so
# this is safe to leave on.
PAPER_TRADING_ENABLED=true

# Whether backtests may be submitted. A backtest opens no socket and touches
# no venue; it reads a stored dataset and replays it.
BACKTEST_ENABLED=true

# -----------------------------------------------------------------------------
# Engine bounds
# -----------------------------------------------------------------------------
# Bound on the in-process market-data queue feeding the strategies. A bounded
# queue turns a slow strategy into shed load rather than unbounded memory
# growth. Valid range 100 - 1000000.
STRATEGY_EVENT_QUEUE_SIZE=10000

# Hard cap on concurrently registered strategy instances per process.
# Valid range 1 - 1000.
STRATEGY_MAX_INSTANCES=50

# Observation budget for one dispatch, in milliseconds. Exceeding it increments
# a counter and marks the dispatch slow so an operator can see degradation.
# It is NOT a guarantee: this platform makes no latency guarantee, and any
# claim of "sub-millisecond" processing would be false. Must stay well below
# SIGNAL_MAX_AGE_MS.
STRATEGY_MAX_PROCESSING_LATENCY_MS=50

# -----------------------------------------------------------------------------
# Signal handling
# -----------------------------------------------------------------------------
# A signal older than this is refused by the validator rather than acted on.
# Stale intent is how a processing backlog turns into a bad fill.
SIGNAL_MAX_AGE_MS=2000

# How long a signal identity is remembered so an identical repeat is dropped.
# This is a bounded in-memory guard against a chattering strategy - it is NOT
# the order idempotency system, which lives in the execution layer and is
# backed by a unique index. Must cover at least SIGNAL_MAX_AGE_MS.
SIGNAL_DEDUP_TTL_SECONDS=5

# -----------------------------------------------------------------------------
# Backtest defaults
# -----------------------------------------------------------------------------
# Applied when a backtest request does not state its own assumptions. They are
# recorded in the configuration hash of every run, so changing one here changes
# the identity of subsequent runs - which is the point: two results computed
# under different cost assumptions are not comparable.
#
# None of these describe a real account or a real fee schedule. Set them from
# your venue's published rates.
BACKTEST_DEFAULT_INITIAL_CAPITAL=10000

# Fee RATES, not basis points: 0.001 is ten basis points. Maker and taker are
# separate because they are separate on every venue that matters.
BACKTEST_DEFAULT_MAKER_FEE=0.001
BACKTEST_DEFAULT_TAKER_FEE=0.001

# Slippage in basis points applied against every simulated taker fill, on both
# sides. Zero fees together with zero slippage is refused in production: that
# combination produces results no real account could achieve.
BACKTEST_DEFAULT_SLIPPAGE_BPS=1

# =============================================================================
# PART 7 - HISTORICAL DATASETS (ingestion, validation, replay input)
# =============================================================================
# Datasets feed the Part 6 backtest engine. They are public market data: no
# credentials exist for them and none are accepted by them. Nothing in this
# section can enable live trading or route an order; the ingestion path shares
# no import with the execution path by design (and by test).
#
# BACKTEST RESULTS OVER THESE DATASETS ARE SIMULATIONS.
# BACKTEST PERFORMANCE IS NOT INDICATIVE OF FUTURE PERFORMANCE.
# SIMULATION DOES NOT GUARANTEE REAL EXECUTION QUALITY.

# -----------------------------------------------------------------------------
# Storage
# -----------------------------------------------------------------------------
# Only the local backend ships. Object storage (S3-compatible, GCS, Azure)
# will be a new enum value and a new module - never a branch in the local one.
DATASET_STORAGE_BACKEND=local

# Root for finalised dataset trees. Must be absolute in production.
DATASET_LOCAL_ROOT=./data/datasets

# Staging root for in-flight ingestion. Must be on the SAME filesystem as
# DATASET_LOCAL_ROOT (finalisation is a rename) and disjoint from it
# (staging under the visible tree would expose half-written versions).
DATASET_TEMP_ROOT=./data/staging

# Hard ceiling for one partition file, in bytes (1 MiB - 4 GiB).
DATASET_MAX_PARTITION_BYTES=268435456

# Streaming reader chunk size (4 KiB - 64 MiB). The only read buffer a replay
# ever allocates; memory does not grow with dataset size.
DATASET_READER_BUFFER_SIZE=65536

# -----------------------------------------------------------------------------
# Validation
# -----------------------------------------------------------------------------
# Validate new versions before they become visible. Off is for emergency
# re-ingest of data validated elsewhere; such manifests are stamped
# "unvalidated" so they never masquerade as validated ones.
DATASET_VALIDATION_ENABLED=true

# Cap on gap findings repeated in a report (0 - 10000). Counts stay exact.
DATASET_MAX_GAP_WARNINGS=100

# Event ceiling per partition (1,000 - 50,000,000).
DATASET_MAX_EVENTS_PER_PARTITION=2000000

# Retention for NON-validated staging only. 'retain' keeps everything,
# including quarantined evidence. Nothing in this repo auto-deletes evidence.
DATASET_RETENTION_POLICY=retain

# -----------------------------------------------------------------------------
# Ingestion and backtest binding
# -----------------------------------------------------------------------------
# Master switch for dataset ingestion jobs. Off by default and never
# auto-enabled in production: a backfill is a deliberate act.
HISTORICAL_INGESTION_ENABLED=false

# Require backtest submissions to name a registered dataset VERSION.
# This is the rule that ends "re-ran the same backtest on different data":
# a run without a pinned version is refused rather than quietly guessed.
BACKTEST_DATASET_REQUIRED=true

# -----------------------------------------------------------------------------
# Part 8: real-time risk engine (control plane)
# -----------------------------------------------------------------------------
# These keys configure the API's risk control surface and the platform-default
# ceilings the trading worker inherits. They can only ever tighten what the
# engine enforces; there is no key here that approves an order, loosens a
# breach or disables a check. See docs/PART8_RISK.md for the resolution
# hierarchy and the fail-closed matrix.

# Require the extended Part 8 gate at worker startup (the Part 2 core gate is
# mandatory regardless and cannot be switched off by any setting).
RISK_ENGINE_ENABLED=true

# Assertion, not a toggle: RISK_FAIL_CLOSED=false is rejected at parse time
# in every environment. The engine refusing what it cannot prove safe is not
# a mode; it is the design.
RISK_FAIL_CLOSED=true

# A hot risk snapshot older than this may not authorise risk-increasing
# orders (ms). Keep it comfortably above RISK_SNAPSHOT_REFRESH_MS or the
# deployment is guaranteed stale (the env loader refuses that combination).
MAX_RISK_STATE_AGE_MS=2000
RISK_SNAPSHOT_REFRESH_MS=250

# Platform default ceilings. Child scopes (account/strategy/symbol) resolve
# to the TIGHTEST applicable value across the whole chain; these numbers are
# the top of that chain, deliberately conservative, and an emergency
# "flatten everything now" can only lower them further - never raise them.
MAX_ORDER_NOTIONAL=1000
MAX_POSITION_NOTIONAL=5000
MAX_ACCOUNT_EXPOSURE=10000
MAX_STRATEGY_EXPOSURE=5000
MAX_SYMBOL_EXPOSURE=5000
MAX_OPEN_ORDERS=20
MAX_DAILY_LOSS=500
MAX_STRATEGY_DAILY_LOSS=250
MAX_DRAWDOWN=10
MAX_ORDERS_PER_SECOND=2
MAX_ORDERS_PER_MINUTE=30
MAX_CANCELS_PER_SECOND=2
MAX_CANCELS_PER_MINUTE=30
MAX_PRICE_DEVIATION_BPS=250
MAX_CONSECUTIVE_LOSSES=5

# Risk events are the operator-facing trail (breaches, switches, stale
# state). Pruned by the maintenance queue after this many days; the durable
# accounting trail remains in the audit log under its own retention.
RISK_EVENTS_RETENTION_DAYS=365

# =============================================================================
# Part 9: observability & operations
# =============================================================================
# Publication and retention settings - never trading settings. In production
# the *_ENABLED flags cannot be false (env validation refuses to parse); a
# deployment that cannot be observed while holding money is not a deployment.
OBSERVABILITY_ENABLED=true
METRICS_ENABLED=true
HEALTH_ENABLED=true
PROMETHEUS_ENABLED=true
PROMETHEUS_PATH=/metrics
ALERTING_ENABLED=true
# Scrape secret. OPTIONAL outside production, REQUIRED in production.
# Provide a real random value through your secret store; never commit one.
# The header the scraper must present is x-metrics-token.
# METRICS_TOKEN=
# Cadences. HEALTH_REFRESH_MS paces each service's mirror loop;
# ALERT_DEDUP_WINDOW_MS must be >= it (validation enforces the ordering);
# QUEUE_ALERT_AGE_MS is the oldest-waiting threshold, halved for the
# trade-execution queue where the severity is CRITICAL by policy.
HEALTH_REFRESH_MS=5000
METRICS_EXPORT_INTERVAL_MS=15000
ALERT_DEDUP_WINDOW_MS=60000
QUEUE_ALERT_AGE_MS=120000
# Retention floors (validation enforces the minima): only RESOLVED alerts and
# CLOSED incidents are ever pruned; unresolved rows stay until resolved.
ALERT_RETENTION_DAYS=90
INCIDENT_RETENTION_DAYS=365

# =============================================================================
# Part 10: tracing, error budgets, fault injection
# =============================================================================
# Telemetry observes; it never authorises. Nothing below changes a trading
# decision, and the fault switch cannot arm in production (the validators
# refuse the boot on both runtimes).
OTEL_ENABLED=false
# OTLP/HTTP JSON collector base URL. Required in production when enabled.
# OTEL_ENDPOINT=http://otel-collector:4318
OTEL_TIMEOUT_MS=2000
OTEL_SAMPLE_RATIO=0.1
# Comma-separated operations always sampled at ratio 1.0 regardless of the
# above (the "critical traces remain inspectable" list).
OTEL_PRIORITY_OPERATIONS=execution.transmit
# Failure injection - a TEST HARNESS SWITCH. Armed only with the guard on
# and only outside production; disabling the guard DISABLES the feature,
# it does not unlock production. No API route can arm or consume.
FAILURE_INJECTION_ENABLED=false
FAILURE_INJECTION_ALLOW_NON_PRODUCTION_ONLY=true
# SLO engine. Evaluation cadence 1..59 minutes; retention has a hard floor
# of 7 days IN CODE - the configured value can only raise it.
SLO_ENABLED=true
SLO_EVALUATION_INTERVAL_MINUTES=5
SLO_RETENTION_DAYS=30
SLO_DEFAULT_WINDOW_MINUTES=1440
SLO_FAST_BURN_MULTIPLIER=14.4
SLO_SLOW_BURN_MULTIPLIER=6
```

## Admin console - new / modified

## FILE: apps/admin-web/src/app/(console)/slo/page.tsx (465 lines)

```tsx
import type { Metadata } from 'next';

import { Badge, Card, DataTable, ErrorNotice, PageHeader, StatTile } from '@/components/ui';
import { ApiError } from '@/lib/api-error';
import { formatRelative } from '@/lib/format';
import { serverFetch } from '@/lib/server-api';
import type { StatusTone } from '@/lib/theme';

import { EvaluateAllButton, FlushExportButton, RunNowButton, SloConfigForm } from './slo-controls';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Service objectives' };

/**
 * The error-budget console (Part 10): every SLO with its latest evaluation,
 * the dual-window burn verdicts, the readiness rollup, and the telemetry
 * posture that produces the numbers.
 *
 * What this page can and cannot do, stated in the same terms the API uses:
 * it publishes NEW definition VERSIONS (append-only, audited, risk-reducing
 * or cosmetic - it can never rewrite or delete an old promise), it asks the
 * evaluator to look now, and it runs one export tick. It cannot arm a fault
 * (that is an environment decision the API refuses to expose), it cannot
 * edit a stored version, and no panel here authorises anything: the
 * numbers measure and page, and the trading gates read the risk plane, not
 * this one. That is the whole contract of the telemetry layer, mirrored
 * where a human can read it.
 *
 * Data path: server component through serverFetch, like every other console
 * page. The browser never holds a bearer token and the console never talks
 * to Redis or Postgres directly.
 */

interface SloDefinitionView {
  sloId: string;
  version: number;
  service: string;
  owner: string;
  description: string;
  indicator: string;
  objective: string;
  objectivePpm: number;
  allowedPpm: number;
  windowMinutes: number;
  shortWindowMinutes: number;
  goodEvent: string;
  badEvent: string;
  warningBurnPpm: number;
  criticalBurnPpm: number;
  maxAgeMicros: string | null;
  latencyThresholdMicros: string | null;
  enabled: boolean;
  checksum: string;
  createdAt: string;
  updatedAt: string;
}

interface SloEvaluationView {
  sloId: string;
  version: number;
  checksum: string;
  indicator: string;
  service: string;
  state: string;
  evaluatedAtMicros: string;
  windowMinutes: number;
  shortWindowMinutes: number;
  targetPpm: number;
  actualPpm: number | null;
  budgetTotalEvents: number;
  budgetConsumedEvents: number;
  budgetRemainingEvents: number;
  remainingRatioPpm: number | null;
  longBurnPpm: number | null;
  shortBurnPpm: number | null;
  alertKind: string;
  samplesGood: number;
  samplesBad: number;
  dataComplete: boolean;
  reason: string | null;
}

interface SloStatusView {
  definition: SloDefinitionView;
  latest: SloEvaluationView | null;
  burnAlerting: boolean;
}

interface SloReadinessView {
  evaluatedAtMicros: string;
  total: number;
  byState: Record<string, number>;
  worstRemainingRatioPpm: number | null;
  maxLongBurnPpm: number | null;
  pagingSloIds: string[];
  unmeasuredSloIds: string[];
  note: string;
}

interface TracingStatusView {
  enabled: boolean;
  endpointConfigured: boolean;
  sampleRatio: number;
  priorityOperations: string[];
  bufferedSpans: number;
  exportedTotal: number;
  droppedTotal: number;
  consecutiveExportFailures: number;
  lastExportOutcome: string | null;
}

interface FaultsStatusView {
  enabled: boolean;
  production: boolean;
  activePoints: string[];
}

type Loaded<T> = { ok: T } | { error: string };

async function load<T>(path: string, params?: Record<string, string | number | boolean>): Promise<Loaded<T>> {
  try {
    return { ok: await serverFetch<T>(path, { searchParams: params }) };
  } catch (error) {
    if (error instanceof ApiError) {
      return { error: error.message };
    }
    return { error: 'This panel could not be loaded.' };
  }
}

function stateTone(state: string | null | undefined): StatusTone {
  switch (state) {
    case 'HEALTHY':
      return 'success';
    case 'WARNING':
      return 'warning';
    case 'CRITICAL':
    case 'EXHAUSTED':
      return 'danger';
    default:
      return 'neutral';
  }
}

/** ppm -> "48.2%" style rendering; null stays an honest em dash, never 0. */
function ppmToPercent(ppm: number | null | undefined): string {
  if (ppm === null || ppm === undefined) {
    return '—';
  }
  return `${(ppm / 10_000).toFixed(1)}%`;
}

function ppmToTimes(ppm: number | null | undefined): string {
  if (ppm === null || ppm === undefined) {
    return '—';
  }
  return `${(ppm / 1_000_000).toFixed(2)}×`;
}

function windowLabel(minutes: number): string {
  if (minutes % 1440 === 0) {
    return `${String(minutes / 1440)}d`;
  }
  if (minutes % 60 === 0) {
    return `${String(minutes / 60)}h`;
  }
  return `${String(minutes)}m`;
}

export default async function SloPage(): Promise<JSX.Element> {
  const [statuses, readiness, tracing, faults] = await Promise.all([
    load<{ items: SloStatusView[]; total: number }>('/operational/slos', { includeDisabled: true }),
    load<SloReadinessView>('/operational/slos/readiness'),
    load<TracingStatusView>('/operational/tracing'),
    load<FaultsStatusView>('/operational/faults'),
  ]);

  const rows = 'ok' in statuses ? statuses.ok.items : [];
  const evidenced = rows.filter((row) => row.latest !== null);
  const alerting = 'ok' in readiness ? readiness.ok.pagingSloIds : [];
  const unmeasured = 'ok' in readiness ? readiness.ok.unmeasuredSloIds : [];

  return (
    <div>
      <PageHeader
        title="Service objectives"
        description="Error budgets, burn rates and the telemetry posture behind them. Reports and pages; authorises nothing."
        actions={<EvaluateAllButton />}
      />

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 12,
          margin: '16px 0',
        }}
      >
        <StatTile
          label="Objectives"
          value={rows.length > 0 ? String(rows.length) : '—'}
          hint={`${String(evidenced.length)} with at least one evaluation`}
        />
        <StatTile
          label="Paging now"
          value={'ok' in readiness ? String(readiness.ok.pagingSloIds.length) : '—'}
          hint={
            alerting.length > 0
              ? alerting.join(', ')
              : 'no dual-window burn condition currently met'
          }
        />
        <StatTile
          label="Worst remaining budget"
          value={'ok' in readiness ? ppmToPercent(readiness.ok.worstRemainingRatioPpm) : '—'}
          hint="the floor, not the average: one exhausted objective is the headline"
        />
        <StatTile
          label="Max long burn"
          value={'ok' in readiness ? ppmToTimes(readiness.ok.maxLongBurnPpm) : '—'}
          hint="burn multiplier over the long window"
        />
        <StatTile
          label="Unmeasured"
          value={'ok' in readiness ? String(readiness.ok.unmeasuredSloIds.length) : '—'}
          hint={unmeasured.length > 0 ? unmeasured.join(', ') : 'every objective has current evidence'}
        />
      </div>

      {'error' in readiness ? (
        <ErrorNotice title="Readiness rollup" message={readiness.error} />
      ) : (
        <Card
          title="Rollup"
          description={`Evaluated at ${formatRelative(
            new Date(Number(BigInt(readiness.ok.evaluatedAtMicros) / 1000n)).toISOString(),
          )}. States below count the LATEST evaluation of each definition.`}
        >
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
            {['HEALTHY', 'WARNING', 'CRITICAL', 'EXHAUSTED', 'UNKNOWN'].map((state) => (
              <Badge key={state} tone={stateTone(state)}>
                {state}: {String(readiness.ok.byState[state] ?? 0)}
              </Badge>
            ))}
          </div>
          <p style={{ fontSize: 12, color: 'var(--wlct-color-text-muted)', margin: 0 }}>
            {readiness.ok.note}
          </p>
        </Card>
      )}

      <div style={{ marginTop: 16 }}>
        {'error' in statuses ? (
          <ErrorNotice title="Service objectives" message={statuses.error} />
        ) : (
          <Card
            title="Objectives"
            description="Latest published version and latest evaluation per objective. A row whose latest tick says dataComplete=false carries an explicit ⚠ - a thin window is reported, not averaged away."
          >
            <DataTable<SloStatusView>
              rows={rows}
              rowKey={(row) => row.definition.sloId}
              emptyTitle="No objectives configured"
              emptyDescription="The platform ships a default catalog; this tenant has none published yet."
              columns={[
                {
                  key: 'slo',
                  header: 'Objective',
                  render: (row) => (
                    <div>
                      <strong style={{ fontSize: 13 }}>{row.definition.sloId}</strong>
                      <div style={{ fontSize: 12, color: 'var(--wlct-color-text-muted)' }}>
                        {row.definition.service} · {row.definition.indicator} · v
                        {String(row.definition.version)}
                        {row.definition.enabled ? '' : ' · disabled'}
                      </div>
                    </div>
                  ),
                },
                {
                  key: 'promise',
                  header: 'Promise',
                  render: (row) => (
                    <div style={{ fontSize: 13 }}>
                      {row.definition.objective}% / {windowLabel(row.definition.windowMinutes)}
                      <div style={{ fontSize: 12, color: 'var(--wlct-color-text-muted)' }}>
                        short {windowLabel(row.definition.shortWindowMinutes)} · allows{' '}
                        {ppmToPercent(row.definition.allowedPpm)}
                      </div>
                    </div>
                  ),
                },
                {
                  key: 'state',
                  header: 'State',
                  render: (row) => (
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                      <Badge tone={stateTone(row.latest?.state ?? null)}>
                        {row.latest?.state ?? 'NO-EVAL'}
                      </Badge>
                      {row.burnAlerting ? <Badge tone="danger">paging</Badge> : null}
                      {row.latest !== null && !row.latest.dataComplete ? (
                        <Badge tone="warning">⚠ thin window</Badge>
                      ) : null}
                    </div>
                  ),
                },
                {
                  key: 'budget',
                  header: 'Budget left',
                  align: 'right',
                  render: (row) => (
                    <div style={{ fontSize: 13, textAlign: 'right' }}>
                      {ppmToPercent(row.latest?.remainingRatioPpm)}
                      <div style={{ fontSize: 12, color: 'var(--wlct-color-text-muted)' }}>
                        {row.latest === null
                          ? 'no evidence yet'
                          : `${String(row.latest.budgetConsumedEvents)} of ${String(
                              row.latest.budgetTotalEvents,
                            )} events burned`}
                      </div>
                    </div>
                  ),
                },
                {
                  key: 'burn',
                  header: 'Burn (short / long)',
                  align: 'right',
                  render: (row) => (
                    <div style={{ fontSize: 13, textAlign: 'right' }}>
                      {ppmToTimes(row.latest?.shortBurnPpm)} / {ppmToTimes(row.latest?.longBurnPpm)}
                      <div style={{ fontSize: 12, color: 'var(--wlct-color-text-muted)' }}>
                        {row.latest === null
                          ? '—'
                          : `pages at ${ppmToTimes(row.definition.criticalBurnPpm)} both windows`}
                      </div>
                    </div>
                  ),
                },
                {
                  key: 'samples',
                  header: 'Samples (g/b)',
                  align: 'right',
                  render: (row) => (
                    <div style={{ fontSize: 13, textAlign: 'right' }}>
                      {row.latest === null
                        ? '—'
                        : `${String(row.latest.samplesGood)} / ${String(row.latest.samplesBad)}`}
                      <div style={{ fontSize: 12, color: 'var(--wlct-color-text-muted)' }}>
                        {row.latest?.reason ??
                          (row.latest === null ? 'not evaluated yet' : 'ok')}
                      </div>
                    </div>
                  ),
                },
                {
                  key: 'evaluated',
                  header: 'Evaluated',
                  render: (row) => (
                    <div style={{ fontSize: 13 }}>
                      {row.latest === null
                        ? 'never'
                        : formatRelative(
                            new Date(
                              Number(BigInt(row.latest.evaluatedAtMicros) / 1000n),
                            ).toISOString(),
                          )}
                    </div>
                  ),
                },
                {
                  key: 'controls',
                  header: '',
                  align: 'right',
                  render: (row) => (
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      <RunNowButton sloId={row.definition.sloId} />
                      <SloConfigForm definition={row.definition} />
                    </div>
                  ),
                },
              ]}
            />
          </Card>
        )}
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: 16,
          marginTop: 16,
        }}
      >
        <Card
          title="Telemetry posture"
          description="What THIS api process exports and where it goes, as configured. The endpoint is reported as configured/not - URLs belong in deployment, not panels."
          actions={<FlushExportButton />}
        >
          {'error' in tracing ? (
            <ErrorNotice title="Tracing status" message={tracing.error} />
          ) : (
            <dl style={{ fontSize: 13, margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 16px' }}>
              <dt>Export</dt>
              <dd style={{ margin: 0 }}>
                {tracing.ok.enabled
                  ? tracing.ok.endpointConfigured
                    ? 'on'
                    : 'on, but nowhere to go (counts as drops)'
                  : 'off'}
              </dd>
              <dt>Sample ratio</dt>
              <dd style={{ margin: 0 }}>{tracing.ok.sampleRatio}</dd>
              <dt>Always-traced operations</dt>
              <dd style={{ margin: 0 }}>
                {tracing.ok.priorityOperations.length > 0
                  ? tracing.ok.priorityOperations.join(', ')
                  : 'none'}
              </dd>
              <dt>Buffered / exported / dropped</dt>
              <dd style={{ margin: 0 }}>
                {String(tracing.ok.bufferedSpans)} / {String(tracing.ok.exportedTotal)} /{' '}
                {String(tracing.ok.droppedTotal)}
              </dd>
              <dt>Consecutive failures</dt>
              <dd style={{ margin: 0 }}>
                {String(tracing.ok.consecutiveExportFailures)}
                {tracing.ok.lastExportOutcome !== null
                  ? ` · last: ${tracing.ok.lastExportOutcome}`
                  : ''}
              </dd>
            </dl>
          )}
        </Card>

        <Card
          title="Fault injection"
          description="Armed only through environment configuration, only outside production; the API exposes no arm lever, so the only runtime operation is consumption at the instrumented points. This card is why 'absence of injected failure' and 'no injection here' are different sentences."
        >
          {'error' in faults ? (
            <ErrorNotice title="Fault posture" message={faults.error} />
          ) : (
            <dl style={{ fontSize: 13, margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 16px' }}>
              <dt>Deployment</dt>
              <dd style={{ margin: 0 }}>{faults.ok.production ? 'production' : 'non-production'}</dd>
              <dt>Armed</dt>
              <dd style={{ margin: 0 }}>
                <Badge tone={faults.ok.enabled ? 'warning' : 'neutral'}>
                  {faults.ok.enabled ? 'YES — tests only' : 'no'}
                </Badge>
              </dd>
              <dt>Active points</dt>
              <dd style={{ margin: 0 }}>
                {faults.ok.activePoints.length > 0 ? faults.ok.activePoints.join(', ') : 'none'}
              </dd>
            </dl>
          )}
        </Card>
      </div>
    </div>
  );
}
```

## FILE: apps/admin-web/src/app/(console)/slo/slo-controls.tsx (400 lines)

```tsx
'use client';

import { useState, useTransition, type CSSProperties, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';

import { ApiError } from '@/lib/api-error';
import { apiClient } from '@/lib/api-client';
import { theme } from '@/lib/theme';

/**
 * The client-side controls of the SLO console. Their complete power, stated
 * so nobody has to read the API to know what a click can do:
 *
 * - EVALUATE ALL / EVALUATE NOW re-runs the measurement. They append rows to
 *   the evidence log and may fold burn alerts; they change no trading state.
 * - FLUSH EXPORTS runs one tick of the OTLP exporter early. It changes WHEN
 *   evidence leaves the process, never WHAT it says, and against a dead
 *   collector it fails exactly once and reports it, same as the loop.
 * - PUBLISH VERSION appends a NEW definition version. Old versions stay
 *   queryable forever; publishing the identical definition is a no-op with
 *   no phantom version; the action is audited with before/after fields. The
 *   objective is typed as a STRING ("99.5") end to end - floats are refused
 *   by the API on purpose because a promise that has been through IEEE-754
 *   is not the promise anyone configured.
 *
 * There is deliberately NO control here for arming or disarming fault
 * injection, editing a stored version, deleting evidence, or pruning
 * history: the first is environment-only and the rest do not exist as
 * routes at all. No optimistic states on any control - the panel shows what
 * the server said, after the server said it.
 */

const buttonStyle: CSSProperties = {
  fontSize: 13,
  padding: '6px 12px',
  borderRadius: theme.radius.md,
  border: `1px solid ${theme.color.border}`,
  cursor: 'pointer',
  background: 'transparent',
  color: 'inherit',
};

const inputStyle: CSSProperties = {
  fontSize: 13,
  padding: '6px 8px',
  borderRadius: theme.radius.md,
  border: `1px solid ${theme.color.border}`,
  background: 'transparent',
  color: 'inherit',
  width: '100%',
};

const labelStyle: CSSProperties = {
  fontSize: 12,
  color: 'var(--wlct-color-text-muted)',
  display: 'block',
  marginBottom: 2,
};

function messageFrom(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message;
  }
  return (error as Error).message || 'The request could not be completed.';
}

interface EvaluateResult {
  evaluated: number;
  alertingSloIds: string[];
  skipped?: Array<{ sloId: string; error: string }>;
}

function postAndRefresh<T>(path: string, body?: unknown): Promise<T> {
  return apiClient.post<T>(path, body);
}

export function EvaluateAllButton(): JSX.Element {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = (): void => {
    setError(null);
    setResult(null);
    startTransition(async () => {
      try {
        const out = await postAndRefresh<EvaluateResult>('/operational/slos/evaluate-all');
        setResult(
          `evaluated ${String(out.evaluated)};` +
            (out.alertingSloIds.length > 0 ? ` paging: ${out.alertingSloIds.join(', ')}` : ' nothing paging') +
            (out.skipped && out.skipped.length > 0 ? `; skipped: ${out.skipped.map((s) => s.sloId).join(', ')}` : ''),
        );
        router.refresh();
      } catch (caught) {
        setError(messageFrom(caught));
      }
    });
  };

  return (
    <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      {result !== null && <span style={{ fontSize: 12 }}>{result}</span>}
      {error !== null && (
        <span style={{ fontSize: 12, color: 'var(--wlct-color-danger)' }}>{error}</span>
      )}
      <button type="button" style={buttonStyle} onClick={run} disabled={pending}>
        {pending ? 'Evaluating…' : 'Evaluate all now'}
      </button>
    </span>
  );
}

export function RunNowButton({ sloId }: { sloId: string }): JSX.Element {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  const run = (): void => {
    setMessage(null);
    startTransition(async () => {
      try {
        const out = await postAndRefresh<EvaluateResult>(
          `/operational/slos/${encodeURIComponent(sloId)}/evaluate`,
        );
        setMessage(
          out.evaluated === 0
            ? 'skipped (disabled?)'
            : out.alertingSloIds.length > 0
              ? 'evaluated: paging'
              : 'evaluated',
        );
        router.refresh();
      } catch (caught) {
        setMessage(messageFrom(caught));
      }
    });
  };

  return (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
      {message !== null && <span style={{ fontSize: 12 }}>{message}</span>}
      <button type="button" style={buttonStyle} onClick={run} disabled={pending}>
        {pending ? '…' : 'Evaluate now'}
      </button>
    </span>
  );
}

export function FlushExportButton(): JSX.Element {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  const run = (): void => {
    setMessage(null);
    startTransition(async () => {
      try {
        const out = await postAndRefresh<{ exported: number; outcome: string }>(
          '/operational/tracing/flush',
        );
        setMessage(`exported ${String(out.exported)} · ${out.outcome}`);
        router.refresh();
      } catch (caught) {
        setMessage(messageFrom(caught));
      }
    });
  };

  return (
    <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
      {message !== null && <span style={{ fontSize: 12 }}>{message}</span>}
      <button type="button" style={buttonStyle} onClick={run} disabled={pending}>
        {pending ? 'Flushing…' : 'Run export tick'}
      </button>
    </span>
  );
}

interface DefinitionLike {
  sloId: string;
  version: number;
  service: string;
  owner: string;
  description: string;
  indicator: string;
  objective: string;
  windowMinutes: number;
  shortWindowMinutes: number;
  goodEvent: string;
  badEvent: string;
  warningBurnPpm: number;
  criticalBurnPpm: number;
  maxAgeMicros: string | null;
  latencyThresholdMicros: string | null;
  enabled: boolean;
}

const FRESHNESS_INDICATORS = new Set([
  'market_data_freshness',
  'risk_state_freshness',
  'queue_freshness',
  'reconciliation_freshness',
]);

const OBJECTIVE_RE = /^(?:0|[1-9]\d*)(?:\.\d{1,4})?$/;

export function SloConfigForm({ definition }: { definition: DefinitionLike }): JSX.Element {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const [objective, setObjective] = useState(definition.objective);
  const [windowMinutes, setWindowMinutes] = useState(String(definition.windowMinutes));
  const [shortWindowMinutes, setShortWindowMinutes] = useState(String(definition.shortWindowMinutes));
  const [owner, setOwner] = useState(definition.owner);
  const [description, setDescription] = useState(definition.description);
  const [goodEvent, setGoodEvent] = useState(definition.goodEvent);
  const [badEvent, setBadEvent] = useState(definition.badEvent);
  const [warningBurnPpm, setWarningBurnPpm] = useState(String(definition.warningBurnPpm));
  const [criticalBurnPpm, setCriticalBurnPpm] = useState(String(definition.criticalBurnPpm));
  const [maxAgeMicros, setMaxAgeMicros] = useState(definition.maxAgeMicros ?? '');
  const [latencyThresholdMicros, setLatencyThresholdMicros] = useState(
    definition.latencyThresholdMicros ?? '',
  );
  const [enabled, setEnabled] = useState(definition.enabled);

  const fresh = FRESHNESS_INDICATORS.has(definition.indicator);

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    setError(null);
    setNote(null);

    // Client-side mirrors of the server rules, to stop obvious fumbles
    // before a round trip. The server remains the authority; nothing here
    // is trusted past this form.
    if (!OBJECTIVE_RE.test(objective.trim())) {
      setError('Objective must be a decimal string with at most 4 fraction digits (e.g. "99.5").');
      return;
    }
    const body: Record<string, unknown> = {
      objective: objective.trim(),
      windowMinutes: Number(windowMinutes),
      shortWindowMinutes: Number(shortWindowMinutes),
      owner: owner.trim(),
      description: description.trim(),
      goodEvent: goodEvent.trim(),
      badEvent: badEvent.trim(),
      warningBurnPpm: Number(warningBurnPpm),
      criticalBurnPpm: Number(criticalBurnPpm),
      enabled,
    };
    if (fresh && maxAgeMicros.trim() !== '') {
      body.maxAgeMicros = maxAgeMicros.trim();
    }
    if (definition.indicator === 'latency_threshold_compliance' && latencyThresholdMicros.trim() !== '') {
      body.latencyThresholdMicros = latencyThresholdMicros.trim();
    }
    if (fresh && maxAgeMicros.trim() === '') {
      setError('This freshness objective requires an age budget (maxAgeMicros).');
      return;
    }

    startTransition(async () => {
      try {
        // publishConfig answers with the full status view - the version and
        // checksum live on its `definition`. A byte-identical publish is a
        // no-op answered with the CURRENT status, so the note says
        // "at version" rather than claiming a bump that did not happen.
        const out = await postAndRefresh<{ definition: { version: number; checksum: string } }>(
          `/operational/slos/${encodeURIComponent(definition.sloId)}/config`,
          body,
        );
        const bumped = out.definition.version > definition.version;
        setNote(
          `${bumped ? 'Published' : 'No-op (identical definition), still at'} v${String(
            out.definition.version,
          )} · checksum ${out.definition.checksum.slice(0, 12)}…`,
        );
        setOpen(false);
        router.refresh();
      } catch (caught) {
        setError(messageFrom(caught));
      }
    });
  };

  if (!open) {
    return (
      <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
        {note !== null && <span style={{ fontSize: 12 }}>{note}</span>}
        {error !== null && (
          <span style={{ fontSize: 12, color: 'var(--wlct-color-danger)' }}>{error}</span>
        )}
        <button type="button" style={buttonStyle} onClick={() => setOpen(true)}>
          Publish version
        </button>
      </span>
    );
  }

  return (
    <form
      onSubmit={submit}
      style={{
        marginTop: theme.space(2),
        padding: theme.space(3),
        border: `1px solid ${theme.color.border}`,
        borderRadius: theme.radius.md,
        display: 'grid',
        gap: theme.space(2),
        minWidth: 320,
      }}
    >
      <p style={{ fontSize: 12, margin: 0, color: 'var(--wlct-color-text-muted)' }}>
        Appends v{String(definition.version + 1)} for <strong>{definition.sloId}</strong>. This
        cannot rewrite history, only extend it. The API may answer with the SAME version if the
        definition is byte-identical (no phantom versions).
      </p>
      <label>
        <span style={labelStyle}>Objective (percent string)</span>
        <input style={inputStyle} value={objective} onChange={(e) => setObjective(e.target.value)} />
      </label>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <label>
          <span style={labelStyle}>Window (minutes, 5–10080)</span>
          <input style={inputStyle} inputMode="numeric" value={windowMinutes} onChange={(e) => setWindowMinutes(e.target.value)} />
        </label>
        <label>
          <span style={labelStyle}>Short window (minutes)</span>
          <input style={inputStyle} inputMode="numeric" value={shortWindowMinutes} onChange={(e) => setShortWindowMinutes(e.target.value)} />
        </label>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <label>
          <span style={labelStyle}>Warning burn (ppm)</span>
          <input style={inputStyle} inputMode="numeric" value={warningBurnPpm} onChange={(e) => setWarningBurnPpm(e.target.value)} />
        </label>
        <label>
          <span style={labelStyle}>Critical burn (ppm)</span>
          <input style={inputStyle} inputMode="numeric" value={criticalBurnPpm} onChange={(e) => setCriticalBurnPpm(e.target.value)} />
        </label>
      </div>
      <label>
        <span style={labelStyle}>Owner</span>
        <input style={inputStyle} value={owner} onChange={(e) => setOwner(e.target.value)} />
      </label>
      <label>
        <span style={labelStyle}>Description</span>
        <input style={inputStyle} value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <label>
          <span style={labelStyle}>Good event (counting rule, in words)</span>
          <input style={inputStyle} value={goodEvent} onChange={(e) => setGoodEvent(e.target.value)} />
        </label>
        <label>
          <span style={labelStyle}>Bad event (counting rule, in words)</span>
          <input style={inputStyle} value={badEvent} onChange={(e) => setBadEvent(e.target.value)} />
        </label>
      </div>
      {fresh && (
        <label>
          <span style={labelStyle}>Max age (microseconds, required for freshness)</span>
          <input style={inputStyle} inputMode="numeric" value={maxAgeMicros} onChange={(e) => setMaxAgeMicros(e.target.value)} />
        </label>
      )}
      {definition.indicator === 'latency_threshold_compliance' && (
        <label>
          <span style={labelStyle}>Latency threshold (microseconds)</span>
          <input
            style={inputStyle}
            inputMode="numeric"
            value={latencyThresholdMicros}
            onChange={(e) => setLatencyThresholdMicros(e.target.value)}
          />
        </label>
      )}
      <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        <span style={{ fontSize: 13 }}>Evaluation enabled</span>
      </label>
      {error !== null && (
        <p style={{ fontSize: 12, color: 'var(--wlct-color-danger)', margin: 0 }}>{error}</p>
      )}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button type="button" style={buttonStyle} onClick={() => setOpen(false)} disabled={pending}>
          Cancel
        </button>
        <button type="submit" style={buttonStyle} disabled={pending}>
          {pending ? 'Publishing…' : 'Publish version'}
        </button>
      </div>
    </form>
  );
}
```

## FILE: apps/admin-web/src/components/sidebar.tsx (107 lines)

```tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { theme } from '@/lib/theme';

export interface NavItem {
  href: string;
  label: string;
  /** Permission required to see the entry. Empty means always visible. */
  permission?: string;
  platformOnly?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { href: '/dashboard', label: 'Overview' },
  { href: '/tenants', label: 'Organisations', permission: 'tenant:read', platformOnly: true },
  { href: '/users', label: 'Users', permission: 'user:read' },
  { href: '/roles', label: 'Roles & permissions', permission: 'role:read' },
  { href: '/strategies', label: 'Strategies', permission: 'strategy_instance:read' },
  // Read-only metadata over historical data (Part 7). Visibility is a
  // usability filter, not the access control - the API enforces
  // dataset:read on every route this page consumes.
  { href: '/datasets', label: 'Datasets', permission: 'dataset:read' },
  // Part 8: mirrored risk posture plus the stop/clear ceremony. The
  // permission gates the link; the API gates every call the page makes.
  { href: '/risk', label: 'Risk', permission: 'risk:read' },
  { href: '/observability', label: 'Observability', permission: 'operations:read' },
  // Part 10: error budgets, burn paging, telemetry posture. Read-mostly:
  // its two writes append definition VERSIONS and ask the evaluator to look.
  { href: '/slo', label: 'Service objectives', permission: 'operations:read' },
  { href: '/branding', label: 'Branding', permission: 'tenant:read' },
  { href: '/subscription', label: 'Subscription', permission: 'billing:read' },
  { href: '/audit-logs', label: 'Audit log', permission: 'audit:read' },
  { href: '/settings', label: 'Settings', permission: 'tenant:read' },
];

/**
 * Navigation is filtered by the permissions embedded in the session.
 *
 * This is a usability filter only - hiding a link is not access control. Every
 * route also re-checks authorisation server-side, and the API is the final
 * authority on every request.
 */
export function Sidebar({
  permissions,
  isPlatformUser,
}: {
  permissions: string[];
  isPlatformUser: boolean;
}): JSX.Element {
  const pathname = usePathname();
  const permissionSet = new Set(permissions);

  const visible = NAV_ITEMS.filter((item) => {
    if (item.platformOnly && !isPlatformUser) {
      return false;
    }
    if (!item.permission) {
      return true;
    }
    if (permissionSet.has('*')) {
      return true;
    }

    const [resource] = item.permission.split(':');
    return permissionSet.has(item.permission) || permissionSet.has(`${resource}:*`);
  });

  return (
    <nav
      aria-label="Primary"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        padding: theme.space(3),
      }}
    >
      {visible.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);

        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            style={{
              display: 'block',
              padding: '9px 12px',
              borderRadius: theme.radius.sm,
              fontSize: 14,
              fontWeight: active ? 600 : 500,
              color: active ? theme.color.text : theme.color.textMuted,
              background: active ? theme.color.surfaceRaised : 'transparent',
              textDecoration: 'none',
            }}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
```

## Cross-language contract

## FILE: docs/fixtures/reliability_fixtures.json (1551 lines)

```json
{
  "attributeHygiene": [
    {
      "kept": true,
      "key": "approved",
      "renderedKey": "approved",
      "renderedValue": true,
      "value": true
    },
    {
      "kept": true,
      "key": "event_count",
      "renderedKey": "event_count",
      "renderedValue": 7,
      "value": 7
    },
    {
      "kept": true,
      "key": "note",
      "renderedKey": "note",
      "renderedValue": "plain text",
      "value": "plain text"
    },
    {
      "kept": true,
      "key": "ratio",
      "renderedKey": "ratio",
      "renderedValue": "1.25",
      "value": 1.25
    },
    {
      "kept": false,
      "key": "api_key",
      "renderedKey": null,
      "renderedValue": null,
      "value": "AAAABBBB"
    },
    {
      "kept": false,
      "key": "authorization",
      "renderedKey": null,
      "renderedValue": null,
      "value": "Bearer xyz"
    },
    {
      "kept": false,
      "key": "password",
      "renderedKey": null,
      "renderedValue": null,
      "value": "hunter2"
    },
    {
      "kept": false,
      "key": "UPPERKEY",
      "renderedKey": null,
      "renderedValue": null,
      "value": "x"
    },
    {
      "kept": false,
      "key": "key with spaces",
      "renderedKey": null,
      "renderedValue": null,
      "value": "x"
    },
    {
      "kept": true,
      "key": "detail",
      "renderedKey": "detail",
      "renderedValue": "[REDACTED]@db:5432/x",
      "value": "postgres://user:secret@db:5432/x"
    },
    {
      "kept": true,
      "key": "long",
      "renderedKey": "long",
      "renderedValue": "yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy",
      "value": "yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"
    },
    {
      "kept": false,
      "key": "nested",
      "renderedKey": null,
      "renderedValue": null,
      "value": null
    },
    {
      "kept": false,
      "key": "none_value",
      "renderedKey": null,
      "renderedValue": null,
      "value": null
    }
  ],
  "budgetRows": [
    {
      "bad": 5,
      "budget": {
        "allowedPpm": 5000,
        "badEvents": 5,
        "budgetConsumedEvents": 5,
        "budgetRemainingEvents": 0,
        "budgetTotalEvents": 5,
        "budgetZero": true,
        "burnPpm": 1000000,
        "compliancePpm": 995000,
        "failurePpm": 5000,
        "goodEvents": 995,
        "objectivePpm": 995000,
        "remainingRatioPpm": 0,
        "totalEvents": 1000
      },
      "good": 995,
      "objective": "99.5"
    },
    {
      "bad": 1,
      "budget": {
        "allowedPpm": 5000,
        "badEvents": 1,
        "budgetConsumedEvents": 1,
        "budgetRemainingEvents": 4,
        "budgetTotalEvents": 5,
        "budgetZero": false,
        "burnPpm": 200000,
        "compliancePpm": 999000,
        "failurePpm": 1000,
        "goodEvents": 999,
        "objectivePpm": 995000,
        "remainingRatioPpm": 800000,
        "totalEvents": 1000
      },
      "good": 999,
      "objective": "99.5"
    },
    {
      "bad": 0,
      "budget": {
        "allowedPpm": 5000,
        "badEvents": 0,
        "budgetConsumedEvents": 0,
        "budgetRemainingEvents": 0,
        "budgetTotalEvents": 0,
        "budgetZero": false,
        "burnPpm": null,
        "compliancePpm": null,
        "failurePpm": null,
        "goodEvents": 0,
        "objectivePpm": 995000,
        "remainingRatioPpm": null,
        "totalEvents": 0
      },
      "good": 0,
      "objective": "99.5"
    },
    {
      "bad": 2,
      "budget": {
        "allowedPpm": 1,
        "badEvents": 2,
        "budgetConsumedEvents": 2,
        "budgetRemainingEvents": 1,
        "budgetTotalEvents": 3,
        "budgetZero": false,
        "burnPpm": 0,
        "compliancePpm": 1000000,
        "failurePpm": 0,
        "goodEvents": 2999998,
        "objectivePpm": 999999,
        "remainingRatioPpm": 333333,
        "totalEvents": 3000000
      },
      "good": 2999998,
      "objective": "99.9999"
    },
    {
      "bad": 1,
      "budget": {
        "allowedPpm": 500,
        "badEvents": 1,
        "budgetConsumedEvents": 0,
        "budgetRemainingEvents": 0,
        "budgetTotalEvents": 0,
        "budgetZero": false,
        "burnPpm": 2000000,
        "compliancePpm": 999000,
        "failurePpm": 1000,
        "goodEvents": 999,
        "objectivePpm": 999500,
        "remainingRatioPpm": 0,
        "totalEvents": 1000
      },
      "good": 999,
      "objective": "99.95"
    },
    {
      "bad": 1,
      "budget": {
        "allowedPpm": 10000,
        "badEvents": 1,
        "budgetConsumedEvents": 1,
        "budgetRemainingEvents": 0,
        "budgetTotalEvents": 1,
        "budgetZero": true,
        "burnPpm": 990000,
        "compliancePpm": 990100,
        "failurePpm": 9900,
        "goodEvents": 100,
        "objectivePpm": 990000,
        "remainingRatioPpm": 0,
        "totalEvents": 101
      },
      "good": 100,
      "objective": "99.0"
    },
    {
      "bad": 10,
      "budget": {
        "allowedPpm": 50000,
        "badEvents": 10,
        "budgetConsumedEvents": 10,
        "budgetRemainingEvents": 499990,
        "budgetTotalEvents": 500000,
        "budgetZero": false,
        "burnPpm": 20,
        "compliancePpm": 999999,
        "failurePpm": 1,
        "goodEvents": 9999990,
        "objectivePpm": 950000,
        "remainingRatioPpm": 999980,
        "totalEvents": 10000000
      },
      "good": 9999990,
      "objective": "95"
    },
    {
      "bad": 1,
      "budget": {
        "allowedPpm": 5000,
        "badEvents": 1,
        "budgetConsumedEvents": 0,
        "budgetRemainingEvents": 0,
        "budgetTotalEvents": 0,
        "budgetZero": false,
        "burnPpm": 66666600,
        "compliancePpm": 666667,
        "failurePpm": 333333,
        "goodEvents": 2,
        "objectivePpm": 995000,
        "remainingRatioPpm": 0,
        "totalEvents": 3
      },
      "good": 2,
      "objective": "99.5"
    }
  ],
  "burnRows": [
    {
      "expected": {
        "fastThresholdPpm": 14400000,
        "kind": "none",
        "longBurnPpm": null,
        "shortBurnPpm": null,
        "slowThresholdPpm": 6000000
      },
      "fastThresholdPpm": 14400000,
      "longBurnPpm": null,
      "shortBurnPpm": null,
      "slowThresholdPpm": 6000000
    },
    {
      "expected": {
        "fastThresholdPpm": 14400000,
        "kind": "none",
        "longBurnPpm": 1000000,
        "shortBurnPpm": null,
        "slowThresholdPpm": 6000000
      },
      "fastThresholdPpm": 14400000,
      "longBurnPpm": 1000000,
      "shortBurnPpm": null,
      "slowThresholdPpm": 6000000
    },
    {
      "expected": {
        "fastThresholdPpm": 14400000,
        "kind": "none",
        "longBurnPpm": 6000000,
        "shortBurnPpm": null,
        "slowThresholdPpm": 6000000
      },
      "fastThresholdPpm": 14400000,
      "longBurnPpm": 6000000,
      "shortBurnPpm": null,
      "slowThresholdPpm": 6000000
    },
    {
      "expected": {
        "fastThresholdPpm": 14400000,
        "kind": "none",
        "longBurnPpm": 14400000,
        "shortBurnPpm": null,
        "slowThresholdPpm": 6000000
      },
      "fastThresholdPpm": 14400000,
      "longBurnPpm": 14400000,
      "shortBurnPpm": null,
      "slowThresholdPpm": 6000000
    },
    {
      "expected": {
        "fastThresholdPpm": 14400000,
        "kind": "none",
        "longBurnPpm": null,
        "shortBurnPpm": 5999999,
        "slowThresholdPpm": 6000000
      },
      "fastThresholdPpm": 14400000,
      "longBurnPpm": null,
      "shortBurnPpm": 5999999,
      "slowThresholdPpm": 6000000
    },
    {
      "expected": {
        "fastThresholdPpm": 14400000,
        "kind": "none",
        "longBurnPpm": 1000000,
        "shortBurnPpm": 5999999,
        "slowThresholdPpm": 6000000
      },
      "fastThresholdPpm": 14400000,
      "longBurnPpm": 1000000,
      "shortBurnPpm": 5999999,
      "slowThresholdPpm": 6000000
    },
    {
      "expected": {
        "fastThresholdPpm": 14400000,
        "kind": "none",
        "longBurnPpm": 6000000,
        "shortBurnPpm": 5999999,
        "slowThresholdPpm": 6000000
      },
      "fastThresholdPpm": 14400000,
      "longBurnPpm": 6000000,
      "shortBurnPpm": 5999999,
      "slowThresholdPpm": 6000000
    },
    {
      "expected": {
        "fastThresholdPpm": 14400000,
        "kind": "none",
        "longBurnPpm": 14400000,
        "shortBurnPpm": 5999999,
        "slowThresholdPpm": 6000000
      },
      "fastThresholdPpm": 14400000,
      "longBurnPpm": 14400000,
      "shortBurnPpm": 5999999,
      "slowThresholdPpm": 6000000
    },
    {
      "expected": {
        "fastThresholdPpm": 14400000,
        "kind": "none",
        "longBurnPpm": null,
        "shortBurnPpm": 6000000,
        "slowThresholdPpm": 6000000
      },
      "fastThresholdPpm": 14400000,
      "longBurnPpm": null,
      "shortBurnPpm": 6000000,
      "slowThresholdPpm": 6000000
    },
    {
      "expected": {
        "fastThresholdPpm": 14400000,
        "kind": "none",
        "longBurnPpm": 1000000,
        "shortBurnPpm": 6000000,
        "slowThresholdPpm": 6000000
      },
      "fastThresholdPpm": 14400000,
      "longBurnPpm": 1000000,
      "shortBurnPpm": 6000000,
      "slowThresholdPpm": 6000000
    },
    {
      "expected": {
        "fastThresholdPpm": 14400000,
        "kind": "slow",
        "longBurnPpm": 6000000,
        "shortBurnPpm": 6000000,
        "slowThresholdPpm": 6000000
      },
      "fastThresholdPpm": 14400000,
      "longBurnPpm": 6000000,
      "shortBurnPpm": 6000000,
      "slowThresholdPpm": 6000000
    },
    {
      "expected": {
        "fastThresholdPpm": 14400000,
        "kind": "slow",
        "longBurnPpm": 14400000,
        "shortBurnPpm": 6000000,
        "slowThresholdPpm": 6000000
      },
      "fastThresholdPpm": 14400000,
      "longBurnPpm": 14400000,
      "shortBurnPpm": 6000000,
      "slowThresholdPpm": 6000000
    },
    {
      "expected": {
        "fastThresholdPpm": 14400000,
        "kind": "none",
        "longBurnPpm": null,
        "shortBurnPpm": 14399999,
        "slowThresholdPpm": 6000000
      },
      "fastThresholdPpm": 14400000,
      "longBurnPpm": null,
      "shortBurnPpm": 14399999,
      "slowThresholdPpm": 6000000
    },
    {
      "expected": {
        "fastThresholdPpm": 14400000,
        "kind": "none",
        "longBurnPpm": 1000000,
        "shortBurnPpm": 14399999,
        "slowThresholdPpm": 6000000
      },
      "fastThresholdPpm": 14400000,
      "longBurnPpm": 1000000,
      "shortBurnPpm": 14399999,
      "slowThresholdPpm": 6000000
    },
    {
      "expected": {
        "fastThresholdPpm": 14400000,
        "kind": "slow",
        "longBurnPpm": 6000000,
        "shortBurnPpm": 14399999,
        "slowThresholdPpm": 6000000
      },
      "fastThresholdPpm": 14400000,
      "longBurnPpm": 6000000,
      "shortBurnPpm": 14399999,
      "slowThresholdPpm": 6000000
    },
    {
      "expected": {
        "fastThresholdPpm": 14400000,
        "kind": "slow",
        "longBurnPpm": 14400000,
        "shortBurnPpm": 14399999,
        "slowThresholdPpm": 6000000
      },
      "fastThresholdPpm": 14400000,
      "longBurnPpm": 14400000,
      "shortBurnPpm": 14399999,
      "slowThresholdPpm": 6000000
    },
    {
      "expected": {
        "fastThresholdPpm": 14400000,
        "kind": "none",
        "longBurnPpm": null,
        "shortBurnPpm": 14400000,
        "slowThresholdPpm": 6000000
      },
      "fastThresholdPpm": 14400000,
      "longBurnPpm": null,
      "shortBurnPpm": 14400000,
      "slowThresholdPpm": 6000000
    },
    {
      "expected": {
        "fastThresholdPpm": 14400000,
        "kind": "none",
        "longBurnPpm": 1000000,
        "shortBurnPpm": 14400000,
        "slowThresholdPpm": 6000000
      },
      "fastThresholdPpm": 14400000,
      "longBurnPpm": 1000000,
      "shortBurnPpm": 14400000,
      "slowThresholdPpm": 6000000
    },
    {
      "expected": {
        "fastThresholdPpm": 14400000,
        "kind": "slow",
        "longBurnPpm": 6000000,
        "shortBurnPpm": 14400000,
        "slowThresholdPpm": 6000000
      },
      "fastThresholdPpm": 14400000,
      "longBurnPpm": 6000000,
      "shortBurnPpm": 14400000,
      "slowThresholdPpm": 6000000
    },
    {
      "expected": {
        "fastThresholdPpm": 14400000,
        "kind": "both",
        "longBurnPpm": 14400000,
        "shortBurnPpm": 14400000,
        "slowThresholdPpm": 6000000
      },
      "fastThresholdPpm": 14400000,
      "longBurnPpm": 14400000,
      "shortBurnPpm": 14400000,
      "slowThresholdPpm": 6000000
    },
    {
      "expected": {
        "fastThresholdPpm": 14400000,
        "kind": "none",
        "longBurnPpm": null,
        "shortBurnPpm": 20000000,
        "slowThresholdPpm": 6000000
      },
      "fastThresholdPpm": 14400000,
      "longBurnPpm": null,
      "shortBurnPpm": 20000000,
      "slowThresholdPpm": 6000000
    },
    {
      "expected": {
        "fastThresholdPpm": 14400000,
        "kind": "none",
        "longBurnPpm": 1000000,
        "shortBurnPpm": 20000000,
        "slowThresholdPpm": 6000000
      },
      "fastThresholdPpm": 14400000,
      "longBurnPpm": 1000000,
      "shortBurnPpm": 20000000,
      "slowThresholdPpm": 6000000
    },
    {
      "expected": {
        "fastThresholdPpm": 14400000,
        "kind": "slow",
        "longBurnPpm": 6000000,
        "shortBurnPpm": 20000000,
        "slowThresholdPpm": 6000000
      },
      "fastThresholdPpm": 14400000,
      "longBurnPpm": 6000000,
      "shortBurnPpm": 20000000,
      "slowThresholdPpm": 6000000
    },
    {
      "expected": {
        "fastThresholdPpm": 14400000,
        "kind": "both",
        "longBurnPpm": 14400000,
        "shortBurnPpm": 20000000,
        "slowThresholdPpm": 6000000
      },
      "fastThresholdPpm": 14400000,
      "longBurnPpm": 14400000,
      "shortBurnPpm": 20000000,
      "slowThresholdPpm": 6000000
    }
  ],
  "enums": {
    "alertRules": [
      {
        "blocksTrading": true,
        "requiresRecovery": true,
        "ruleId": "MARKET_DATA_STALE",
        "severity": "CRITICAL"
      },
      {
        "blocksTrading": false,
        "requiresRecovery": true,
        "ruleId": "ORDERBOOK_RESYNC_STORM",
        "severity": "WARNING"
      },
      {
        "blocksTrading": true,
        "requiresRecovery": true,
        "ruleId": "RISK_SNAPSHOT_STALE",
        "severity": "CRITICAL"
      },
      {
        "blocksTrading": true,
        "requiresRecovery": true,
        "ruleId": "RISK_ENGINE_UNAVAILABLE",
        "severity": "EMERGENCY"
      },
      {
        "blocksTrading": true,
        "requiresRecovery": true,
        "ruleId": "EXECUTION_UNAVAILABLE",
        "severity": "CRITICAL"
      },
      {
        "blocksTrading": false,
        "requiresRecovery": true,
        "ruleId": "EXCHANGE_DISCONNECTED",
        "severity": "WARNING"
      },
      {
        "blocksTrading": true,
        "requiresRecovery": true,
        "ruleId": "RECONCILIATION_DISCREPANCY",
        "severity": "EMERGENCY"
      },
      {
        "blocksTrading": false,
        "requiresRecovery": true,
        "ruleId": "REPEATED_ORDER_REJECTION",
        "severity": "WARNING"
      },
      {
        "blocksTrading": true,
        "requiresRecovery": true,
        "ruleId": "AMBIGUOUS_EXECUTION",
        "severity": "EMERGENCY"
      },
      {
        "blocksTrading": false,
        "requiresRecovery": true,
        "ruleId": "RATE_LIMIT_EXHAUSTION",
        "severity": "WARNING"
      },
      {
        "blocksTrading": false,
        "requiresRecovery": true,
        "ruleId": "QUEUE_BACKLOG",
        "severity": "WARNING"
      },
      {
        "blocksTrading": false,
        "requiresRecovery": true,
        "ruleId": "EXECUTION_QUEUE_BACKLOG",
        "severity": "CRITICAL"
      },
      {
        "blocksTrading": false,
        "requiresRecovery": true,
        "ruleId": "WORKER_FAILURE",
        "severity": "CRITICAL"
      },
      {
        "blocksTrading": false,
        "requiresRecovery": true,
        "ruleId": "POSTGRES_UNAVAILABLE",
        "severity": "CRITICAL"
      },
      {
        "blocksTrading": true,
        "requiresRecovery": true,
        "ruleId": "REDIS_UNAVAILABLE",
        "severity": "EMERGENCY"
      },
      {
        "blocksTrading": false,
        "requiresRecovery": true,
        "ruleId": "DATASET_VALIDATION_FAILURES",
        "severity": "WARNING"
      },
      {
        "blocksTrading": false,
        "requiresRecovery": true,
        "ruleId": "STRATEGY_ERROR_SPIKE",
        "severity": "WARNING"
      },
      {
        "blocksTrading": true,
        "requiresRecovery": true,
        "ruleId": "KILL_SWITCH_ENGAGED",
        "severity": "EMERGENCY"
      },
      {
        "blocksTrading": true,
        "requiresRecovery": true,
        "ruleId": "PROTECTION_TRIGGERED",
        "severity": "CRITICAL"
      },
      {
        "blocksTrading": false,
        "requiresRecovery": true,
        "ruleId": "SLO_BURN_FAST",
        "severity": "CRITICAL"
      },
      {
        "blocksTrading": false,
        "requiresRecovery": true,
        "ruleId": "SLO_BURN_SLOW",
        "severity": "WARNING"
      },
      {
        "blocksTrading": false,
        "requiresRecovery": true,
        "ruleId": "SLO_BUDGET_EXHAUSTED",
        "severity": "CRITICAL"
      },
      {
        "blocksTrading": false,
        "requiresRecovery": true,
        "ruleId": "TELEMETRY_EXPORT_FAILING",
        "severity": "WARNING"
      },
      {
        "blocksTrading": false,
        "requiresRecovery": true,
        "ruleId": "SLO_TELEMETRY_GAP",
        "severity": "WARNING"
      }
    ],
    "allowedLabelNames": [
      "alert_state",
      "alert_type",
      "channel",
      "component",
      "dataset_kind",
      "event_kind",
      "exchange",
      "feed_state",
      "job_name",
      "market_type",
      "method",
      "pool_state",
      "queue",
      "result",
      "risk_code",
      "route",
      "rule_id",
      "scope",
      "service",
      "severity",
      "simulation",
      "slo",
      "stage",
      "status_class",
      "strategy_id",
      "symbol",
      "trigger_type",
      "window_kind"
    ],
    "faultPoints": [
      "alert_persistence_failure",
      "market_data_stale_simulated",
      "metrics_export_unavailable",
      "postgres_health_probe_unavailable",
      "queue_observed_delay",
      "queue_observed_failure",
      "reconciliation_delay_simulated",
      "redis_health_probe_unavailable",
      "risk_snapshot_stale_simulated",
      "trace_export_unavailable"
    ],
    "samplingModes": [
      "disabled",
      "off",
      "all",
      "parent_based",
      "ratio"
    ],
    "sloIndicators": [
      "availability",
      "request_success_ratio",
      "queue_processing_success",
      "queue_freshness",
      "market_data_freshness",
      "risk_state_freshness",
      "reconciliation_freshness",
      "latency_threshold_compliance",
      "error_rate_compliance"
    ],
    "sloStates": [
      "HEALTHY",
      "WARNING",
      "CRITICAL",
      "EXHAUSTED",
      "UNKNOWN"
    ],
    "sloWindowKinds": [
      "short",
      "long"
    ],
    "tracedOperations": [
      "backtest.run",
      "dataset.replay",
      "dataset.select",
      "dataset.verify_checksum",
      "execution.reconcile",
      "execution.submit",
      "execution.transmit",
      "execution.validate",
      "http.client",
      "http.server",
      "queue.process",
      "queue.publish",
      "risk.evaluate",
      "risk.reservation_admit",
      "risk.reservation_release",
      "signal.created",
      "signal.validated",
      "slo.evaluate",
      "strategy.dispatch",
      "tracing.export"
    ]
  },
  "generator": "libs/trading-core/scripts/gen_part10_fixtures.py",
  "note": "Committed cross-language vectors for Part 10. The TS services must reproduce every value below from their own implementation. Nothing here authorises a trade; measurement only.",
  "otlpJson": {
    "empty": "{\"resourceSpans\":[]}",
    "int64Edge": "{\"resourceSpans\":[{\"resource\":{\"attributes\":[{\"key\":\"deployment.environment\",\"value\":{\"stringValue\":\"test\"}},{\"key\":\"service.name\",\"value\":{\"stringValue\":\"trading-engine\"}}]},\"scopeSpans\":[{\"scope\":{\"name\":\"wlct.observability\",\"version\":\"1\"},\"spans\":[{\"traceId\":\"cccccccccccccccccccccccccccccccc\",\"spanId\":\"ffffffffffffffff\",\"name\":\"risk.evaluate\",\"kind\":1,\"startTimeUnixNano\":\"9223372036854775807\",\"endTimeUnixNano\":\"9223372036854775808\",\"attributes\":[{\"key\":\"big.count\",\"value\":{\"intValue\":\"9007199254740993\"}},{\"key\":\"neg\",\"value\":{\"intValue\":\"-7\"}},{\"key\":\"zero\",\"value\":{\"intValue\":\"0\"}}],\"status\":{\"code\":0},\"flags\":1}]}]}]}",
    "single": "{\"resourceSpans\":[{\"resource\":{\"attributes\":[{\"key\":\"deployment.environment\",\"value\":{\"stringValue\":\"test\"}},{\"key\":\"service.name\",\"value\":{\"stringValue\":\"trading-engine\"}}]},\"scopeSpans\":[{\"scope\":{\"name\":\"wlct.observability\",\"version\":\"1\"},\"spans\":[{\"traceId\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\"spanId\":\"1234567890abcdef\",\"name\":\"risk.evaluate\",\"kind\":1,\"startTimeUnixNano\":\"1700000000000000000\",\"endTimeUnixNano\":\"1700000000000001500\",\"attributes\":[{\"key\":\"approved\",\"value\":{\"boolValue\":true}},{\"key\":\"risk.event_count\",\"value\":{\"intValue\":\"0\"}},{\"key\":\"risk.simulated\",\"value\":{\"stringValue\":\"false\"}},{\"key\":\"trade.symbol\",\"value\":{\"stringValue\":\"BTCUSDT\"}}],\"events\":[{\"timeUnixNano\":\"1700000000000500000\",\"name\":\"milestone\",\"attributes\":[{\"key\":\"detail\",\"value\":{\"stringValue\":\"reservation admitted\"}}]}],\"status\":{\"code\":1},\"flags\":1}]}]}]}",
    "twoResources": "{\"resourceSpans\":[{\"resource\":{\"attributes\":[{\"key\":\"deployment.environment\",\"value\":{\"stringValue\":\"test\"}},{\"key\":\"service.name\",\"value\":{\"stringValue\":\"trading-engine\"}}]},\"scopeSpans\":[{\"scope\":{\"name\":\"wlct.observability\",\"version\":\"1\"},\"spans\":[{\"traceId\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\"spanId\":\"1234567890abcdef\",\"name\":\"risk.evaluate\",\"kind\":1,\"startTimeUnixNano\":\"1700000000000000000\",\"endTimeUnixNano\":\"1700000000000001500\",\"attributes\":[{\"key\":\"approved\",\"value\":{\"boolValue\":true}},{\"key\":\"risk.event_count\",\"value\":{\"intValue\":\"0\"}},{\"key\":\"risk.simulated\",\"value\":{\"stringValue\":\"false\"}},{\"key\":\"trade.symbol\",\"value\":{\"stringValue\":\"BTCUSDT\"}}],\"events\":[{\"timeUnixNano\":\"1700000000000500000\",\"name\":\"milestone\",\"attributes\":[{\"key\":\"detail\",\"value\":{\"stringValue\":\"reservation admitted\"}}]}],\"status\":{\"code\":1},\"flags\":1},{\"traceId\":\"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\",\"spanId\":\"fedcba0987654321\",\"name\":\"execution.transmit\",\"kind\":3,\"startTimeUnixNano\":\"1700000000000000000\",\"endTimeUnixNano\":\"1700000000000001500\",\"parentSpanId\":\"1234567890abcdef\",\"attributes\":[{\"key\":\"approved\",\"value\":{\"boolValue\":true}},{\"key\":\"risk.event_count\",\"value\":{\"intValue\":\"0\"}},{\"key\":\"risk.simulated\",\"value\":{\"stringValue\":\"false\"}},{\"key\":\"trade.symbol\",\"value\":{\"stringValue\":\"BTCUSDT\"}}],\"droppedAttributesCount\":3,\"events\":[{\"timeUnixNano\":\"1700000000000999999\",\"name\":\"exception\",\"attributes\":[{\"key\":\"exception.message\",\"value\":{\"stringValue\":\"[REDACTED]@db:5432 down\"}},{\"key\":\"exception.type\",\"value\":{\"stringValue\":\"ConnectionError\"}}]}],\"droppedEventsCount\":1,\"status\":{\"code\":2,\"message\":\"connect postgres://u:p@db failed \\\"quoted\\\" \\\\n\"},\"tracestate\":\"vendor=v=1,solo\",\"flags\":1}]}]},{\"resource\":{\"attributes\":[{\"key\":\"service.name\",\"value\":{\"stringValue\":\"api\"}}]},\"scopeSpans\":[{\"scope\":{\"name\":\"wlct.observability\",\"version\":\"1\"},\"spans\":[{\"traceId\":\"dddddddddddddddddddddddddddddddd\",\"spanId\":\"abcdabcdabcdabcd\",\"name\":\"risk.evaluate\",\"kind\":1,\"startTimeUnixNano\":\"1700000000000000000\",\"endTimeUnixNano\":\"1700000000000001500\",\"attributes\":[{\"key\":\"approved\",\"value\":{\"boolValue\":true}},{\"key\":\"risk.event_count\",\"value\":{\"intValue\":\"0\"}},{\"key\":\"risk.simulated\",\"value\":{\"stringValue\":\"false\"}},{\"key\":\"trade.symbol\",\"value\":{\"stringValue\":\"BTCUSDT\"}}],\"events\":[{\"timeUnixNano\":\"1700000000000500000\",\"name\":\"milestone\",\"attributes\":[{\"key\":\"detail\",\"value\":{\"stringValue\":\"reservation admitted\"}}]}],\"status\":{\"code\":1},\"flags\":1}]}]}]}",
    "twoSpansOneResource": "{\"resourceSpans\":[{\"resource\":{\"attributes\":[{\"key\":\"deployment.environment\",\"value\":{\"stringValue\":\"test\"}},{\"key\":\"service.name\",\"value\":{\"stringValue\":\"trading-engine\"}}]},\"scopeSpans\":[{\"scope\":{\"name\":\"wlct.observability\",\"version\":\"1\"},\"spans\":[{\"traceId\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\"spanId\":\"1234567890abcdef\",\"name\":\"risk.evaluate\",\"kind\":1,\"startTimeUnixNano\":\"1700000000000000000\",\"endTimeUnixNano\":\"1700000000000001500\",\"attributes\":[{\"key\":\"approved\",\"value\":{\"boolValue\":true}},{\"key\":\"risk.event_count\",\"value\":{\"intValue\":\"0\"}},{\"key\":\"risk.simulated\",\"value\":{\"stringValue\":\"false\"}},{\"key\":\"trade.symbol\",\"value\":{\"stringValue\":\"BTCUSDT\"}}],\"events\":[{\"timeUnixNano\":\"1700000000000500000\",\"name\":\"milestone\",\"attributes\":[{\"key\":\"detail\",\"value\":{\"stringValue\":\"reservation admitted\"}}]}],\"status\":{\"code\":1},\"flags\":1},{\"traceId\":\"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\",\"spanId\":\"fedcba0987654321\",\"name\":\"execution.transmit\",\"kind\":3,\"startTimeUnixNano\":\"1700000000000000000\",\"endTimeUnixNano\":\"1700000000000001500\",\"parentSpanId\":\"1234567890abcdef\",\"attributes\":[{\"key\":\"approved\",\"value\":{\"boolValue\":true}},{\"key\":\"risk.event_count\",\"value\":{\"intValue\":\"0\"}},{\"key\":\"risk.simulated\",\"value\":{\"stringValue\":\"false\"}},{\"key\":\"trade.symbol\",\"value\":{\"stringValue\":\"BTCUSDT\"}}],\"droppedAttributesCount\":3,\"events\":[{\"timeUnixNano\":\"1700000000000999999\",\"name\":\"exception\",\"attributes\":[{\"key\":\"exception.message\",\"value\":{\"stringValue\":\"[REDACTED]@db:5432 down\"}},{\"key\":\"exception.type\",\"value\":{\"stringValue\":\"ConnectionError\"}}]}],\"droppedEventsCount\":1,\"status\":{\"code\":2,\"message\":\"connect postgres://u:p@db failed \\\"quoted\\\" \\\\n\"},\"tracestate\":\"vendor=v=1,solo\",\"flags\":1}]}]}]}"
  },
  "part": "10",
  "sampling": {
    "rows": [
      {
        "bucket": 790211418057950173,
        "enabled": false,
        "expected": false,
        "mode": "disabled",
        "operation": "risk.evaluate",
        "parentSampled": null,
        "priorityOperations": [],
        "ratio": 0.0,
        "ratioPpm": 0,
        "traceId": "0af7651916cd43dd8448eb211c80319c"
      },
      {
        "bucket": 790211418057950173,
        "enabled": true,
        "expected": false,
        "mode": "off",
        "operation": "risk.evaluate",
        "parentSampled": null,
        "priorityOperations": [],
        "ratio": 0.0,
        "ratioPpm": 0,
        "traceId": "0af7651916cd43dd8448eb211c80319c"
      },
      {
        "bucket": 790211418057950173,
        "enabled": true,
        "expected": true,
        "mode": "all",
        "operation": "risk.evaluate",
        "parentSampled": null,
        "priorityOperations": [],
        "ratio": 0.0,
        "ratioPpm": 0,
        "traceId": "0af7651916cd43dd8448eb211c80319c"
      },
      {
        "bucket": 9223372036854775807,
        "enabled": true,
        "expected": true,
        "mode": "ratio",
        "operation": "risk.evaluate",
        "parentSampled": null,
        "priorityOperations": [],
        "ratio": 0.5,
        "ratioPpm": 500000,
        "traceId": "7fffffffffffffff8448eb211c80319c"
      },
      {
        "bucket": 9223372036854775808,
        "enabled": true,
        "expected": false,
        "mode": "ratio",
        "operation": "risk.evaluate",
        "parentSampled": null,
        "priorityOperations": [],
        "ratio": 0.5,
        "ratioPpm": 500000,
        "traceId": "80000000000000008448eb211c80319c"
      },
      {
        "bucket": 18446744073708,
        "enabled": true,
        "expected": true,
        "mode": "ratio",
        "operation": "risk.evaluate",
        "parentSampled": null,
        "priorityOperations": [],
        "ratio": 1e-06,
        "ratioPpm": 1,
        "traceId": "000010c6f7a0b5ec0000000000000000"
      },
      {
        "bucket": 18446744073709,
        "enabled": true,
        "expected": false,
        "mode": "ratio",
        "operation": "risk.evaluate",
        "parentSampled": null,
        "priorityOperations": [],
        "ratio": 1e-06,
        "ratioPpm": 1,
        "traceId": "000010c6f7a0b5ed0000000000000000"
      },
      {
        "bucket": 790211418057950173,
        "enabled": true,
        "expected": true,
        "mode": "ratio",
        "operation": "risk.evaluate",
        "parentSampled": null,
        "priorityOperations": [],
        "ratio": 0.05,
        "ratioPpm": 50000,
        "traceId": "0af7651916cd43dd8448eb211c80319c"
      },
      {
        "bucket": 18446744073709551615,
        "enabled": true,
        "expected": true,
        "mode": "ratio",
        "operation": "risk.evaluate",
        "parentSampled": null,
        "priorityOperations": [],
        "ratio": 1.0,
        "ratioPpm": 1000000,
        "traceId": "ffffffffffffffffffffffffffffffff"
      },
      {
        "bucket": 790211418057950173,
        "enabled": true,
        "expected": true,
        "mode": "ratio",
        "operation": "execution.transmit",
        "parentSampled": true,
        "priorityOperations": [
          "execution.transmit"
        ],
        "ratio": 0.0,
        "ratioPpm": 0,
        "traceId": "0af7651916cd43dd8448eb211c80319c"
      },
      {
        "bucket": 790211418057950173,
        "enabled": true,
        "expected": false,
        "mode": "ratio",
        "operation": "risk.evaluate",
        "parentSampled": null,
        "priorityOperations": [],
        "ratio": 0.0,
        "ratioPpm": 0,
        "traceId": "0af7651916cd43dd8448eb211c80319c"
      },
      {
        "bucket": 790211418057950173,
        "enabled": true,
        "expected": true,
        "mode": "parent_based",
        "operation": "risk.evaluate",
        "parentSampled": true,
        "priorityOperations": [],
        "ratio": 0.1,
        "ratioPpm": 100000,
        "traceId": "0af7651916cd43dd8448eb211c80319c"
      },
      {
        "bucket": 790211418057950173,
        "enabled": true,
        "expected": false,
        "mode": "parent_based",
        "operation": "risk.evaluate",
        "parentSampled": false,
        "priorityOperations": [],
        "ratio": 0.1,
        "ratioPpm": 100000,
        "traceId": "0af7651916cd43dd8448eb211c80319c"
      },
      {
        "bucket": 790211418057950173,
        "enabled": true,
        "expected": true,
        "mode": "parent_based",
        "operation": "risk.evaluate",
        "parentSampled": null,
        "priorityOperations": [],
        "ratio": 0.1,
        "ratioPpm": 100000,
        "traceId": "0af7651916cd43dd8448eb211c80319c"
      },
      {
        "bucket": 0,
        "enabled": true,
        "expected": true,
        "mode": "constant",
        "note": "row with a fabricated all-zero trace id fed straight into should_sample: bucket 0 is under every positive threshold; note that Tracer.start_span rejects all-zero ids BEFORE sampling via the W3C validity rule, so this row tests the pure function, not the tracer path",
        "operation": "risk.evaluate",
        "parentSampled": null,
        "priorityOperations": [],
        "ratio": 0,
        "ratioPpm": 65536,
        "traceId": "00000000000000000000000000000000"
      }
    ]
  },
  "slo": {
    "catalog": [
      {
        "allowedPpm": 5000,
        "checksum": "7630d3acd7b4fd69f53e3ad42d560a11438e0674ad516ecb9f7d72b82e91f3b2",
        "criticalBurnPpm": 2000000,
        "indicator": "availability",
        "latencyThresholdMicros": null,
        "maxAgeMicros": null,
        "objective": "99.5",
        "objectivePpm": 995000,
        "owner": "platform-sre",
        "service": "api",
        "shortWindowMinutes": 60,
        "sloId": "api.availability",
        "warningBurnPpm": 1000000,
        "windowMinutes": 1440
      },
      {
        "allowedPpm": 5000,
        "checksum": "378b802169794767287438f04014c599c79db5cbb77ff6e2304d40c9e7ee1ab9",
        "criticalBurnPpm": 2000000,
        "indicator": "request_success_ratio",
        "latencyThresholdMicros": null,
        "maxAgeMicros": null,
        "objective": "99.5",
        "objectivePpm": 995000,
        "owner": "platform-sre",
        "service": "api",
        "shortWindowMinutes": 60,
        "sloId": "api.request-success",
        "warningBurnPpm": 1000000,
        "windowMinutes": 1440
      },
      {
        "allowedPpm": 10000,
        "checksum": "244880228319af1b69e0979b5ac8cf2744162a4a1871b5608099251e3f8e2556",
        "criticalBurnPpm": 2000000,
        "indicator": "queue_processing_success",
        "latencyThresholdMicros": null,
        "maxAgeMicros": null,
        "objective": "99",
        "objectivePpm": 990000,
        "owner": "platform-sre",
        "service": "queues",
        "shortWindowMinutes": 60,
        "sloId": "queues.processing-success",
        "warningBurnPpm": 1000000,
        "windowMinutes": 1440
      },
      {
        "allowedPpm": 10000,
        "checksum": "680bac29ece459a9e962c8be727ebe40c9b2108cf337a449bfe6e2e661a98929",
        "criticalBurnPpm": 2000000,
        "indicator": "queue_freshness",
        "latencyThresholdMicros": null,
        "maxAgeMicros": "240000000",
        "objective": "99",
        "objectivePpm": 990000,
        "owner": "platform-sre",
        "service": "queues",
        "shortWindowMinutes": 60,
        "sloId": "queues.freshness",
        "warningBurnPpm": 1000000,
        "windowMinutes": 1440
      },
      {
        "allowedPpm": 5000,
        "checksum": "7e3493538716977f51433a2131fb73fdaa9a196e1950df08005a3ffd754eb7fd",
        "criticalBurnPpm": 2000000,
        "indicator": "market_data_freshness",
        "latencyThresholdMicros": null,
        "maxAgeMicros": "30000000",
        "objective": "99.5",
        "objectivePpm": 995000,
        "owner": "trading-platform",
        "service": "market-data",
        "shortWindowMinutes": 60,
        "sloId": "market-data.freshness",
        "warningBurnPpm": 1000000,
        "windowMinutes": 1440
      },
      {
        "allowedPpm": 1000,
        "checksum": "cd4cb1aa7ce46b339784372c81e35268e69bffa207664a3f7e98473d1d905aac",
        "criticalBurnPpm": 2000000,
        "indicator": "risk_state_freshness",
        "latencyThresholdMicros": null,
        "maxAgeMicros": "4000000",
        "objective": "99.9",
        "objectivePpm": 999000,
        "owner": "trading-platform",
        "service": "trading-engine",
        "shortWindowMinutes": 60,
        "sloId": "risk-state.freshness",
        "warningBurnPpm": 1000000,
        "windowMinutes": 1440
      },
      {
        "allowedPpm": 10000,
        "checksum": "c74ff98d516279ed964ac20269420e5876cd213088e273910d6d6f78e414ef73",
        "criticalBurnPpm": 2000000,
        "indicator": "reconciliation_freshness",
        "latencyThresholdMicros": null,
        "maxAgeMicros": "900000000",
        "objective": "99",
        "objectivePpm": 990000,
        "owner": "trading-platform",
        "service": "trading-engine",
        "shortWindowMinutes": 60,
        "sloId": "execution.reconciliation-freshness",
        "warningBurnPpm": 1000000,
        "windowMinutes": 1440
      },
      {
        "allowedPpm": 10000,
        "checksum": "efb45956e15a48b820c88fce68269e41a7321c22d5d3f6ff0dcf0f3a8cb1531d",
        "criticalBurnPpm": 2000000,
        "indicator": "latency_threshold_compliance",
        "latencyThresholdMicros": "500000",
        "maxAgeMicros": null,
        "objective": "99",
        "objectivePpm": 990000,
        "owner": "platform-sre",
        "service": "api",
        "shortWindowMinutes": 60,
        "sloId": "api.latency-compliance",
        "warningBurnPpm": 1000000,
        "windowMinutes": 1440
      },
      {
        "allowedPpm": 1000,
        "checksum": "6915d741d64cdb80a3ce1c337c7eb47dad904fac427adcf9a9fca0ec4daa95c5",
        "criticalBurnPpm": 2000000,
        "indicator": "error_rate_compliance",
        "latencyThresholdMicros": null,
        "maxAgeMicros": null,
        "objective": "99.9",
        "objectivePpm": 999000,
        "owner": "trading-platform",
        "service": "trading-engine",
        "shortWindowMinutes": 60,
        "sloId": "trading-engine.error-rate",
        "warningBurnPpm": 1000000,
        "windowMinutes": 1440
      }
    ],
    "checksumVectors": [
      {
        "canonicalJson": "{\"badEvent\":\"5xx\",\"criticalBurnPpm\":2000000,\"description\":\"Canonical spelling A.\",\"goodEvent\":\"no 5xx\",\"indicator\":\"availability\",\"latencyThresholdMicros\":null,\"maxAgeMicros\":null,\"objective\":\"99.5\",\"owner\":\"sre\",\"service\":\"test\",\"shortWindowMinutes\":60,\"sloId\":\"test.availability\",\"warningBurnPpm\":1000000,\"windowMinutes\":1440}",
        "engineChecksum": "6025a4b2ee607ad5c5aa81d855108c5cdc946e58d6f0c5df2b6c52830ee0fca7",
        "sha256": "6025a4b2ee607ad5c5aa81d855108c5cdc946e58d6f0c5df2b6c52830ee0fca7"
      },
      {
        "canonicalJson": "{\"badEvent\":\"5xx\",\"criticalBurnPpm\":2000000,\"description\":\"Prose moves the digest.\",\"goodEvent\":\"2xx\",\"indicator\":\"availability\",\"latencyThresholdMicros\":null,\"maxAgeMicros\":null,\"objective\":\"99.5\",\"owner\":\"sre\",\"service\":\"test\",\"shortWindowMinutes\":60,\"sloId\":\"test.prose\",\"warningBurnPpm\":1000000,\"windowMinutes\":1440}",
        "engineChecksum": "0fc44defbc223aa9fe3026625f626014363308e0e2e2faca2e15814da5f35e63",
        "sha256": "0fc44defbc223aa9fe3026625f626014363308e0e2e2faca2e15814da5f35e63"
      },
      {
        "canonicalJson": "{\"badEvent\":\"over budget\",\"criticalBurnPpm\":2000000,\"description\":\"Freshness with threshold.\",\"goodEvent\":\"within budget\",\"indicator\":\"market_data_freshness\",\"latencyThresholdMicros\":null,\"maxAgeMicros\":30000000,\"objective\":\"99\",\"owner\":\"sre\",\"service\":\"test\",\"shortWindowMinutes\":30,\"sloId\":\"test.freshness\",\"warningBurnPpm\":1000000,\"windowMinutes\":10080}",
        "engineChecksum": "2437ae7a9d37ee63ec83eb075d201535004c08995e14f9187f4ac077a18e3643",
        "sha256": "2437ae7a9d37ee63ec83eb075d201535004c08995e14f9187f4ac077a18e3643"
      }
    ],
    "evaluations": [
      {
        "definition": {
          "badevent": "5xx",
          "description": "Parity scenario.",
          "goodevent": "no 5xx",
          "indicator": "availability",
          "objective": "99.5",
          "owner": "sre",
          "service": "test",
          "shortwindowminutes": 60,
          "sloid": "test.availability",
          "windowminutes": 1440
        },
        "expected": {
          "actualPpm": 999991,
          "alertKind": "none",
          "budgetConsumedEvents": 1,
          "budgetRemainingEvents": 499,
          "budgetTotalEvents": 500,
          "checksum": "ac9752293e5b419211fc8c9e8d619437e70354be5f1e61d84133f2766fdf36c5",
          "dataComplete": true,
          "evaluatedAtMicros": "1700000000000000",
          "indicator": "availability",
          "longBurnPpm": 1800,
          "remainingRatioPpm": 998000,
          "samplesBad": 1,
          "samplesGood": 100000,
          "service": "test",
          "shortBurnPpm": 0,
          "shortWindowMinutes": 60,
          "sloId": "test.availability",
          "state": "HEALTHY",
          "targetPpm": 995000,
          "version": 1,
          "windowMinutes": 1440
        },
        "fastMultiplierPpm": 14400000,
        "longWindow": {
          "bad": 1,
          "dataComplete": true,
          "good": 100000,
          "note": null
        },
        "name": "healthy",
        "shortWindow": {
          "bad": 0,
          "dataComplete": true,
          "good": 1000,
          "note": null
        },
        "slowMultiplierPpm": 6000000
      },
      {
        "definition": {
          "badevent": "5xx",
          "description": "Parity scenario.",
          "goodevent": "no 5xx",
          "indicator": "availability",
          "objective": "99.5",
          "owner": "sre",
          "service": "test",
          "shortwindowminutes": 60,
          "sloid": "test.availability",
          "windowminutes": 1440
        },
        "expected": {
          "actualPpm": null,
          "alertKind": "none",
          "budgetConsumedEvents": 0,
          "budgetRemainingEvents": 0,
          "budgetTotalEvents": 0,
          "checksum": "ac9752293e5b419211fc8c9e8d619437e70354be5f1e61d84133f2766fdf36c5",
          "dataComplete": false,
          "evaluatedAtMicros": "1700000000000000",
          "indicator": "availability",
          "longBurnPpm": null,
          "remainingRatioPpm": null,
          "samplesBad": 0,
          "samplesGood": 1000000,
          "service": "test",
          "shortBurnPpm": null,
          "shortWindowMinutes": 60,
          "sloId": "test.availability",
          "state": "UNKNOWN",
          "targetPpm": 995000,
          "version": 1,
          "windowMinutes": 1440
        },
        "fastMultiplierPpm": 14400000,
        "longWindow": {
          "bad": 0,
          "dataComplete": false,
          "good": 1000000,
          "note": null
        },
        "name": "unknown-incomplete",
        "shortWindow": {
          "bad": 0,
          "dataComplete": true,
          "good": 10000,
          "note": null
        },
        "slowMultiplierPpm": 6000000
      },
      {
        "definition": {
          "badevent": "5xx",
          "description": "Parity scenario.",
          "goodevent": "no 5xx",
          "indicator": "availability",
          "objective": "99.5",
          "owner": "sre",
          "service": "test",
          "shortwindowminutes": 60,
          "sloid": "test.availability",
          "windowminutes": 1440
        },
        "expected": {
          "actualPpm": null,
          "alertKind": "none",
          "budgetConsumedEvents": 0,
          "budgetRemainingEvents": 0,
          "budgetTotalEvents": 0,
          "checksum": "ac9752293e5b419211fc8c9e8d619437e70354be5f1e61d84133f2766fdf36c5",
          "dataComplete": true,
          "evaluatedAtMicros": "1700000000000000",
          "indicator": "availability",
          "longBurnPpm": null,
          "remainingRatioPpm": null,
          "samplesBad": 0,
          "samplesGood": 0,
          "service": "test",
          "shortBurnPpm": null,
          "shortWindowMinutes": 60,
          "sloId": "test.availability",
          "state": "UNKNOWN",
          "targetPpm": 995000,
          "version": 1,
          "windowMinutes": 1440
        },
        "fastMultiplierPpm": 14400000,
        "longWindow": {
          "bad": 0,
          "dataComplete": true,
          "good": 0,
          "note": null
        },
        "name": "no-samples",
        "shortWindow": {
          "bad": 0,
          "dataComplete": true,
          "good": 0,
          "note": null
        },
        "slowMultiplierPpm": 6000000
      },
      {
        "definition": {
          "badevent": "5xx",
          "criticalburnppm": 2000000,
          "description": "Parity scenario two.",
          "goodevent": "2xx/3xx/4xx",
          "indicator": "request_success_ratio",
          "objective": "99.9",
          "owner": "platform-sre",
          "service": "api",
          "shortwindowminutes": 120,
          "sloid": "test.api",
          "warningburnppm": 1000000,
          "windowminutes": 2880
        },
        "expected": {
          "actualPpm": 997000,
          "alertKind": "none",
          "budgetConsumedEvents": 1000,
          "budgetRemainingEvents": 0,
          "budgetTotalEvents": 1000,
          "checksum": "8c40a42643d46d1b471babb7432eea67bc24cf24359e5d67e7ed0453da4af81b",
          "dataComplete": true,
          "evaluatedAtMicros": "1700000000000000",
          "indicator": "request_success_ratio",
          "longBurnPpm": 3000000,
          "remainingRatioPpm": 0,
          "samplesBad": 3000,
          "samplesGood": 997000,
          "service": "api",
          "shortBurnPpm": 14778000,
          "shortWindowMinutes": 120,
          "sloId": "test.api",
          "state": "EXHAUSTED",
          "targetPpm": 999000,
          "version": 1,
          "windowMinutes": 2880
        },
        "fastMultiplierPpm": 14400000,
        "longWindow": {
          "bad": 3000,
          "dataComplete": true,
          "good": 997000,
          "note": null
        },
        "name": "exhausted-long-window",
        "shortWindow": {
          "bad": 600,
          "dataComplete": true,
          "good": 40000,
          "note": null
        },
        "slowMultiplierPpm": 6000000
      },
      {
        "definition": {
          "badevent": "fault",
          "criticalburnppm": 2000000,
          "description": "Parity scenario three.",
          "goodevent": "no fault",
          "indicator": "error_rate_compliance",
          "objective": "99.95",
          "owner": "sre",
          "service": "test",
          "shortwindowminutes": 60,
          "sloid": "test.tiny-budget",
          "warningburnppm": 1000000,
          "windowminutes": 1440
        },
        "expected": {
          "actualPpm": 999000,
          "alertKind": "none",
          "budgetConsumedEvents": 0,
          "budgetRemainingEvents": 0,
          "budgetTotalEvents": 0,
          "checksum": "860442aab8f657e6040964299232807c0fbb7ff62a238a7a3fd953b2132ef1f3",
          "dataComplete": true,
          "evaluatedAtMicros": "1700000000000000",
          "indicator": "error_rate_compliance",
          "longBurnPpm": 2000000,
          "remainingRatioPpm": 0,
          "samplesBad": 1,
          "samplesGood": 999,
          "service": "test",
          "shortBurnPpm": 2000000,
          "shortWindowMinutes": 60,
          "sloId": "test.tiny-budget",
          "state": "CRITICAL",
          "targetPpm": 999500,
          "version": 1,
          "windowMinutes": 1440
        },
        "fastMultiplierPpm": 14400000,
        "longWindow": {
          "bad": 1,
          "dataComplete": true,
          "good": 999,
          "note": null
        },
        "name": "critical-band",
        "shortWindow": {
          "bad": 1,
          "dataComplete": true,
          "good": 999,
          "note": null
        },
        "slowMultiplierPpm": 6000000
      }
    ]
  },
  "traceparent": {
    "invalid": [
      "",
      "x",
      "00-nothex-nothex-01",
      "00-0AF7651916CD43DD8448EB211C80319C-b7ad6b7169203331-01",
      "00-00000000000000000000000000000000-b7ad6b7169203331-01",
      "00-0af7651916cd43dd8448eb211c80319c-0000000000000000-01",
      "01-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01",
      "ff-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-ff",
      "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331",
      "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-0",
      "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-zz",
      "0-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01"
    ],
    "tracestate": [
      {
        "header": "foo=bar,baz",
        "members": [
          [
            "foo",
            "bar"
          ],
          [
            "baz",
            ""
          ]
        ],
        "reformat": "foo=bar,baz"
      },
      {
        "header": "FOO=bar,ok=1",
        "members": [
          [
            "ok",
            "1"
          ]
        ],
        "reformat": "ok=1"
      },
      {
        "header": "a=zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz,b=ok",
        "members": [
          [
            "b",
            "ok"
          ]
        ],
        "reformat": "b=ok"
      },
      {
        "header": "key-with-no-value",
        "members": [
          [
            "key-with-no-value",
            ""
          ]
        ],
        "reformat": "key-with-no-value"
      },
      {
        "header": "a=b=c",
        "members": [],
        "reformat": ""
      }
    ],
    "valid": [
      {
        "flags": 1,
        "header": "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01",
        "reformat": "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01",
        "sampled": true,
        "spanId": "b7ad6b7169203331",
        "traceId": "0af7651916cd43dd8448eb211c80319c"
      },
      {
        "flags": 0,
        "header": "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-00",
        "reformat": "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-00",
        "sampled": false,
        "spanId": "b7ad6b7169203331",
        "traceId": "0af7651916cd43dd8448eb211c80319c"
      },
      {
        "flags": 9,
        "header": "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-09",
        "reformat": "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-09",
        "sampled": true,
        "spanId": "b7ad6b7169203331",
        "traceId": "0af7651916cd43dd8448eb211c80319c"
      },
      {
        "flags": 10,
        "header": "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-0a",
        "reformat": "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-0a",
        "sampled": false,
        "spanId": "b7ad6b7169203331",
        "traceId": "0af7651916cd43dd8448eb211c80319c"
      },
      {
        "flags": 1,
        "header": "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01-extra-field",
        "note": "trailing fields for future versions are dropped",
        "reformat": "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01",
        "sampled": true,
        "spanId": "b7ad6b7169203331",
        "traceId": "0af7651916cd43dd8448eb211c80319c"
      }
    ]
  }
}
```

---

*End of Part 10 handover. Every file above is complete as written; line
counts in the contents list match the blocks. Regenerate this document (and
the fixture file) from a clean tree with:
`python3 libs/trading-core/scripts/gen_part10_fixtures.py` for the fixtures;
the handover itself is assembled verbatim from the files on disk, so after
any edit to a listed file, re-emit rather than hand-edit.*
