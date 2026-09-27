"""Prometheus-compatible exposition on top of the existing in-process registries.

Relationship to :mod:`wlct_trading.metrics` (Parts 2-8)
-------------------------------------------------------
That module owns *what is measured*: histograms and counters attached to the
transport, execution, strategy, dataset and risk paths, scraped in-process by
their owners. This module owns *how the platform publishes*: a small registry
of standard COUNTER / GAUGE / HISTOGRAM families with the label policy from
:mod:`.labels` enforced at the boundary, plus a renderer for the Prometheus
text exposition format. The two are adapters, not rivals -
:func:`observe_latency_histogram` folds a completed
:class:`wlct_trading.metrics.LatencyHistogram` into an exposed family without
either side knowing the other's storage, and :func:`render_health_metrics`
projects the health registry into gauges.

Semantics are Prometheus's, deliberately un-inventive:

* COUNTER - monotonic; ``inc`` refuses negatives rather than lying;
* GAUGE - settable up and down;
* HISTOGRAM - cumulative bucket counts at ``<= le``, plus ``+Inf``, plus
  ``_sum`` and ``_count``, exactly as Prometheus computes quantiles from
  them. Bucket edges are fixed at registration; that is the cardinality and
  memory promise.

The cap
-------
Each family accepts a bounded number of distinct label sets (default 4,096).
Past the cap, *new* series are refused - the refusal is counted in
``wlct_registry_series_overflow_total`` - while existing series keep
recording. Refusal is the fail-closed option: an unbounded scrape is the
failure mode that takes the monitoring down together with the thing it is
monitoring.

No claim of any kind is made about achievable latency, throughput or uptime;
every figure here is an observation a process made about itself.
"""

from __future__ import annotations

import math
import os
import resource
import threading
import time
from collections.abc import Iterable
from contextlib import contextmanager
from dataclasses import dataclass
from enum import Enum
from typing import Any, Iterator

from wlct_trading.clock import epoch_micros, monotonic_nanos

from .labels import CardinalityError, LabelPolicy

__all__ = [
    "MetricType",
    "ObservabilityRegistry",
    "PipelineSpan",
    "PIPELINE_STAGES",
    "PIPELINE_TRANSITIONS",
    "DEFAULT_MICROS_BUCKETS",
    "observe_latency_histogram",
    "render_prometheus",
    "render_health_metrics",
    "ensure_health_families",
    "ensure_process_families",
    "sample_process",
]

#: Upper bounds in microseconds for latency histograms published through this
#: registry. Mirrors the internal default bounds in ``wlct_trading.metrics``
#: so an operator sees the same edges in both views; kept local (rather than
#: importing a private constant) so the two may diverge deliberately.
DEFAULT_MICROS_BUCKETS: tuple[int, ...] = (
    100,
    250,
    500,
    1_000,
    2_500,
    5_000,
    10_000,
    25_000,
    50_000,
    100_000,
    250_000,
    500_000,
    1_000_000,
    2_500_000,
    5_000_000,
    10_000_000,
)

#: The named observation points of the hot pipeline, in expected order.
#: These are *stamps*, not stages: durations come from the pairs listed in
#: :data:`PIPELINE_TRANSITIONS`, measured on the monotonic clock only.
PIPELINE_STAGES: tuple[str, ...] = (
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

#: Transitions measured as durations: adjacent pairs first (the per-hop
#: view), then the two aggregates an operator actually reads during an
#: incident (venue-to-decision and venue-to-fill).
PIPELINE_TRANSITIONS: tuple[tuple[str, str], ...] = (
    ("market_event_received", "market_event_processed"),
    ("market_event_processed", "strategy_started"),
    ("strategy_started", "strategy_finished"),
    ("strategy_finished", "signal_generated"),
    ("signal_generated", "risk_started"),
    ("risk_started", "risk_finished"),
    ("risk_finished", "execution_started"),
    ("execution_started", "exchange_request_sent"),
    ("exchange_request_sent", "exchange_response_received"),
    ("exchange_response_received", "fill_received"),
    ("market_event_received", "risk_finished"),
    ("market_event_received", "fill_received"),
)

#: Encodes component health as a gauge value. The numbers sort by severity so
#: ``max_over_time`` answers "what was the worst state" without arithmetic.
HEALTH_STATUS_VALUES: dict[str, int] = {
    "HEALTHY": 0,
    "DEGRADED": 1,
    "UNHEALTHY": 2,
    "STOPPED": 3,
    "UNKNOWN": 4,
}


def _format_value(value: float) -> str:
    """Canonical float form for the text exposition format."""
    if math.isnan(value):
        return "NaN"
    if math.isinf(value):
        return "+Inf" if value > 0 else "-Inf"
    if value == int(value) and abs(value) < 1e15:
        return str(int(value))
    return repr(value)


def _escape_help(text: str) -> str:
    return text.replace("\\", "\\\\").replace("\n", "\\n")


def _escape_label_value(value: str) -> str:
    return value.replace("\\", "\\\\").replace("\n", "\\n").replace('"', '\\"')


class MetricType(str, Enum):
    COUNTER = "counter"
    GAUGE = "gauge"
    HISTOGRAM = "histogram"


class _Series:
    """Storage for one concrete label set of one family."""

    __slots__ = ("labels", "value", "buckets", "sum", "count")

    def __init__(self, labels: tuple[tuple[str, str], ...], *, bucket_count: int = 0) -> None:
        self.labels = labels
        self.value = 0.0
        self.buckets: list[int] = [0] * bucket_count
        self.sum = 0.0
        self.count = 0


@dataclass(frozen=True)
class _Family:
    name: str
    metric_type: MetricType
    help_text: str
    policy: LabelPolicy
    bucket_bounds: tuple[int, ...]


class ObservabilityRegistry:
    """Single-process metric store with policy enforcement at the boundary.

    One instance per service process. Families are registered at startup; the
    recording paths then do one dict lookup per label set beyond the policy
    check - no allocation while a series exists, no network, no I/O. A lock
    guards only the rare paths (series creation, rendering) because the
    trading engine's executor threads share a registry, while the hot single
    ``+=`` stays outside it.
    """

    def __init__(self, *, service: str, max_series_per_family: int = 4_096) -> None:
        if max_series_per_family <= 0:
            raise CardinalityError("max_series_per_family must be positive")
        self._service = service
        self._max_series = max_series_per_family
        self._families: dict[str, _Family] = {}
        self._series: dict[str, dict[tuple[tuple[str, str], ...], _Series]] = {}
        self._overflow_total = 0
        self._lock = threading.Lock()

    # ------------------------------------------------------------------
    # registration
    # ------------------------------------------------------------------
    def register_counter(
        self,
        name: str,
        help_text: str,
        *labels: str,
        bounds: dict[str, frozenset[str]] | None = None,
    ) -> None:
        self._register(name, MetricType.COUNTER, help_text, labels, (), bounds)

    def register_gauge(
        self,
        name: str,
        help_text: str,
        *labels: str,
        bounds: dict[str, frozenset[str]] | None = None,
    ) -> None:
        self._register(name, MetricType.GAUGE, help_text, labels, (), bounds)

    def register_histogram(
        self,
        name: str,
        help_text: str,
        labels: tuple[str, ...],
        buckets: tuple[int, ...] = DEFAULT_MICROS_BUCKETS,
        bounds: dict[str, frozenset[str]] | None = None,
    ) -> None:
        if not buckets or list(buckets) != sorted(buckets) or len(set(buckets)) != len(buckets):
            raise CardinalityError(
                f"histogram {name} needs strictly increasing bucket bounds"
            )
        self._register(name, MetricType.HISTOGRAM, help_text, labels, tuple(buckets), bounds)

    def _register(
        self,
        name: str,
        metric_type: MetricType,
        help_text: str,
        labels: tuple[str, ...],
        buckets: tuple[int, ...],
        caller_bounds: dict[str, frozenset[str]] | None,
    ) -> None:
        merged = dict(self._bounds_for(labels))
        for key, domain in (caller_bounds or {}).items():
            if key in merged:
                raise CardinalityError(
                    f"bounds for {key!r} on {name} are owned by the platform policy"
                )
            merged[key] = domain
        policy = LabelPolicy(name=name, label_names=labels, bounds=merged)
        with self._lock:
            if name in self._families:
                raise CardinalityError(f"metric {name} registered twice")
            self._families[name] = _Family(
                name=name,
                metric_type=metric_type,
                help_text=help_text,
                policy=policy,
                bucket_bounds=buckets,
            )
            self._series[name] = {}

    def _bounds_for(self, labels: tuple[str, ...]) -> dict[str, frozenset[str]]:
        """Pin closed-value labels to their declared domains, in code.

        Anything with an open domain (``stage``, ``component``, ``route``)
        relies on the wire-token pattern plus the series cap; anything with a
        *known small* domain is enumerated so a typo cannot mint a thousand
        one-off series.
        """
        bounds: dict[str, frozenset[str]] = {}
        if "service" in labels:
            bounds["service"] = frozenset({self._service})
        if "simulation" in labels:
            bounds["simulation"] = frozenset({"simulated", "live"})
        if "alert_state" in labels:
            bounds["alert_state"] = frozenset({"open", "acknowledged", "resolved"})
        if "status" in labels:
            raise CardinalityError("'status' is not a label name on this platform")
        return bounds

    # ------------------------------------------------------------------
    # recording
    # ------------------------------------------------------------------
    def _series_for(self, name: str, labels: dict[str, str]) -> tuple[_Series | None, _Family]:
        family = self._families.get(name)
        if family is None:
            raise CardinalityError(f"metric {name} is not registered")
        key = family.policy.validate(labels)
        store = self._series[name]
        series = store.get(key)
        if series is not None:
            return series, family
        with self._lock:
            # Re-check under the lock: a concurrent recorder may have won.
            series = store.get(key)
            if series is not None:
                return series, family
            if len(store) >= self._max_series:
                self._overflow_total += 1
                return None, family
            series = _Series(
                key,
                bucket_count=len(family.bucket_bounds)
                if family.metric_type is MetricType.HISTOGRAM
                else 0,
            )
            store[key] = series
        return series, family

    def inc(self, name: str, labels: dict[str, str], amount: float = 1.0) -> None:
        """Add to a counter series. ``amount`` must be non-negative."""
        if amount < 0:
            raise CardinalityError(f"counters never decrease: refused {amount} on {name}")
        series, _family = self._series_for(name, labels)
        if series is not None:
            series.value += amount

    def set_gauge(self, name: str, labels: dict[str, str], value: float) -> None:
        series, _family = self._series_for(name, labels)
        if series is not None:
            series.value = float(value)

    def add_to_gauge(self, name: str, labels: dict[str, str], amount: float) -> None:
        series, _family = self._series_for(name, labels)
        if series is not None:
            series.value += amount

    def observe_micros(self, name: str, labels: dict[str, str], micros: int) -> None:
        """Record one histogram observation in microseconds.

        Negative observations are recorded, not clamped - a negative derived
        figure (feed lag under clock skew, for example) is data *about a
        problem*, and clamping it would hide the problem.
        """
        series, family = self._series_for(name, labels)
        if family.metric_type is not MetricType.HISTOGRAM:
            raise CardinalityError(f"{name} is not a histogram")
        if series is None:
            return
        value = float(micros)
        series.sum += value
        series.count += 1
        for index, bound in enumerate(family.bucket_bounds):
            if value <= float(bound):
                series.buckets[index] += 1
                return

    # ------------------------------------------------------------------
    # views
    # ------------------------------------------------------------------
    @property
    def service(self) -> str:
        return self._service

    @property
    def overflow_total(self) -> int:
        return self._overflow_total

    def family_names(self) -> tuple[str, ...]:
        return tuple(sorted(self._families))

    def snapshot(self) -> dict[str, dict[str, object]]:
        """A JSON-friendly dump used by the dashboard builder, not by scrapes."""
        out: dict[str, dict[str, object]] = {}
        for name in self.family_names():
            family = self._families[name]
            rows: list[dict[str, object]] = []
            for key, series in sorted(self._series[name].items()):
                row: dict[str, object] = {"labels": dict(key)}
                if family.metric_type is MetricType.HISTOGRAM:
                    row.update(
                        {
                            "count": series.count,
                            "sumMicros": series.sum,
                            "buckets": {
                                str(bound): count
                                for bound, count in zip(family.bucket_bounds, series.buckets)
                            },
                        }
                    )
                else:
                    row["value"] = series.value
                rows.append(row)
            out[name] = {"type": family.metric_type.value, "series": rows}
        return out


# ----------------------------------------------------------------------
# pipeline timing
# ----------------------------------------------------------------------
class PipelineSpan:
    """Stamp the hot pipeline's observation points on one event's journey.

    Durations come only from :func:`wlct_trading.clock.monotonic_nanos` - the
    same discipline as :class:`wlct_trading.clock.LatencySpan`. Wall-clock
    stamps may be recorded alongside for *correlation*, but no duration is
    ever taken from them here, because wall clocks step and NTP corrects.

    A missing earlier or later stamp yields ``None`` (no observation) - never
    a fabricated zero.
    """

    __slots__ = ("_stamps",)

    def __init__(self) -> None:
        self._stamps: dict[str, int] = {}

    def mark(self, stage: str, *, at_nanos: int | None = None) -> None:
        if stage not in PIPELINE_STAGES:
            raise CardinalityError(f"unknown pipeline stage {stage!r}")
        if stage in self._stamps:
            # First mark wins: a re-mark would silently shift every duration
            # that uses this stamp as its start.
            return
        self._stamps[stage] = monotonic_nanos() if at_nanos is None else at_nanos

    def duration_micros(self, earlier: str, later: str) -> float | None:
        start = self._stamps.get(earlier)
        end = self._stamps.get(later)
        if start is None or end is None:
            return None
        return (end - start) / 1_000.0

    def record_into(
        self,
        registry: ObservabilityRegistry,
        *,
        simulation: str,
        exchange: str = "none",
    ) -> int:
        """Observe every completed transition; return the count recorded.

        ``exchange`` defaults to ``"none"`` meaning "not tied to a venue
        connection" (a local replay, a config path) - an explicit value, not
        a guess. Series growth is bounded by ``transitions x exchanges x
        simulation``, all small declared sets.
        """
        recorded = 0
        for earlier, later in PIPELINE_TRANSITIONS:
            micros = self.duration_micros(earlier, later)
            if micros is None:
                continue
            registry.observe_micros(
                "wlct_pipeline_transition_micros",
                {"stage": f"{earlier}__{later}", "simulation": simulation, "exchange": exchange},
                int(micros),
            )
            recorded += 1
        return recorded


@contextmanager
def pipeline_stage(
    registry: ObservabilityRegistry,
    *,
    name: str,
    labels: dict[str, str],
) -> Iterator[None]:
    """Time one ``with``-block into a registered histogram (micros).

    The observation happens on exit even if the block raised - a failing
    stage is exactly the stage an operator needs to see in the histogram.
    """
    start = monotonic_nanos()
    try:
        yield
    finally:
        elapsed = (monotonic_nanos() - start) // 1_000
        registry.observe_micros(name, labels, elapsed)


# ----------------------------------------------------------------------
# adapter: existing LatencyHistograms -> exposed families
# ----------------------------------------------------------------------
def observe_latency_histogram(
    registry: ObservabilityRegistry,
    family_name: str,
    labels: dict[str, str],
    histogram: object,
) -> bool:
    """Copy one completed :class:`~wlct_trading.metrics.LatencyHistogram` into an
    exposed histogram series, bucket for bucket.

    The service's scrape handler calls this per scrape; the source histogram
    is untouched, and the copy is whole (buckets, sum, count) rather than
    incremental, so an expose can never disagree with its source. Returns
    ``False`` when the series was refused by the cap - visible through the
    overflow counter, never silently.

    The store is per-bucket because the renderer owns the cumulative sum; see the
    comment on the copy loop, which is the story of how this function shipped
    wrong for nine parts without a failing test.
    """
    snapshot = getattr(histogram, "snapshot_buckets", None)
    if not callable(snapshot):
        raise TypeError(
            "histogram must expose snapshot_buckets() - the adapter exists for "
            "wlct_trading.metrics.LatencyHistogram and nothing else"
        )
    bounds, bucket_counts, count, total = snapshot()
    series, family = registry._series_for(family_name, labels)
    if family.metric_type is not MetricType.HISTOGRAM:
        raise CardinalityError(f"{family_name} is not a histogram")
    if series is None:
        return False
    if tuple(family.bucket_bounds) != tuple(bounds):
        raise CardinalityError(
            f"{family_name} exposed buckets must match the source histogram edges"
        )
    # PER-bucket counts, not cumulative - and the distinction is the whole
    # function. ``_Series.buckets`` is the same store ``observe_micros`` writes a
    # single increment into, and ``render_prometheus`` runs the cumulative sum on
    # its way out (its docstring says so). Copying a cumulative array in here made
    # the renderer sum a second time, so every ``le`` line above the first bucket
    # reported more observations than existed: with one sample in each of two
    # buckets the exposition said "1" and then "3". Nothing in the platform
    # rendered an adapter-filled histogram until Part 18 wired the execution
    # engine's scrape, which is why the original test - which read the SERIES
    # state and never the text - could pin the wrong contract with a straight
    # face. The fix is on this side because this is the side that invented the
    # cumulative copy; the renderer's accumulation is what every other histogram
    # in both languages depends on.
    for index, value in enumerate(bucket_counts):
        series.buckets[index] = int(value)
    series.sum = float(total)
    series.count = count
    return True


# ----------------------------------------------------------------------
# process sampling
# ----------------------------------------------------------------------
def ensure_process_families(registry: ObservabilityRegistry) -> None:
    """Register the standard process gauges if missing (idempotent, same
    reasoning as :func:`ensure_health_families`)."""
    if "wlct_process_uptime_seconds" not in registry.family_names():
        registry.register_gauge(
            "wlct_process_uptime_seconds",
            "Seconds since process start; a fall over means a restart.",
            "service",
        )
    for name, help_text in (
        (
            "wlct_process_memory_rss_bytes",
            "Peak resident set size in bytes (ru_maxrss), an observation of this process.",
        ),
        (
            "wlct_process_cpu_seconds_total",
            "Process CPU seconds consumed (user + system).",
        ),
        (
            "wlct_process_open_file_descriptors",
            "Open file descriptors (-1 where not observable).",
        ),
        (
            "wlct_process_file_descriptor_limit",
            "Soft RLIMIT_NOFILE.",
        ),
    ):
        if name not in registry.family_names():
            registry.register_gauge(name, help_text, "service")


def sample_process(registry: ObservabilityRegistry, *, started_at_mono: float) -> None:
    """Refresh the small set of process-level series. Call from a timer.

    Families are ensured here because the sampling set is fixed by the
    platform, not chosen per service: a service that calls ``sample_process``
    gets exactly the documented five gauges, and nothing else.

    Deliberately conservative: only things the platform can measure honestly
    from inside itself are published. "Process restarts" is *not* among them
    - a restart resets every series, so the truthful signal is the uptime
    gauge falling over, which a scrape history can see. Inventing an in-
    process restart counter would be fiction, and fiction in an operations
    panel is worse than a gap.
    """
    ensure_process_families(registry)
    registry.set_gauge(
        "wlct_process_uptime_seconds",
        {"service": registry.service},
        max(0.0, time.monotonic() - started_at_mono),
    )
    usage = resource.getrusage(resource.RUSAGE_SELF)
    # ru_maxrss is KiB on Linux.
    registry.set_gauge(
        "wlct_process_memory_rss_bytes",
        {"service": registry.service},
        float(usage.ru_maxrss) * 1024.0,
    )
    registry.set_gauge(
        "wlct_process_cpu_seconds_total",
        {"service": registry.service},
        usage.ru_utime + usage.ru_stime,
    )
    try:
        open_fds = len(os.listdir("/proc/self/fd"))
    except OSError:
        open_fds = -1
    registry.set_gauge(
        "wlct_process_open_file_descriptors",
        {"service": registry.service},
        float(open_fds),
    )
    soft, _hard = resource.getrlimit(resource.RLIMIT_NOFILE)
    registry.set_gauge(
        "wlct_process_file_descriptor_limit",
        {"service": registry.service},
        float(soft),
    )


# ----------------------------------------------------------------------
# rendering
# ----------------------------------------------------------------------
_OVERFLOW_NAME = "wlct_registry_series_overflow_total"


def render_prometheus(registry: ObservabilityRegistry) -> str:
    """Prometheus 0.0.4 text exposition for one registry.

    Output is deterministic - families sorted, series sorted by their label
    tuple, the fixed service label always rendered - so tests can pin exact
    vectors across both languages. Histograms render cumulative ``le`` lines
    plus ``+Inf``/``_sum``/``_count``; nothing else about the format is
    improvised.
    """
    lines: list[str] = []
    lines.append(
        "# HELP wlct_registry_series_overflow_total New label sets refused by "
        "the per-family series cap."
    )
    lines.append("# TYPE wlct_registry_series_overflow_total counter")
    lines.append(
        f'{_OVERFLOW_NAME}{{service="{registry.service}"}} {registry.overflow_total}'
    )

    for name in registry.family_names():
        family: _Family = registry._families[name]
        store = registry._series[name]
        if not store:
            continue
        lines.append(f"# HELP {name} {_escape_help(family.help_text)}")
        lines.append(f"# TYPE {name} {family.metric_type.value}")
        for key, series in sorted(store.items()):
            rendered = {**dict(key), "service": registry.service}
            label_text = ",".join(
                f'{label}="{_escape_label_value(value)}"'
                for label, value in sorted(rendered.items())
            )
            suffix = f"{{{label_text}}}"
            if family.metric_type is MetricType.HISTOGRAM:
                cumulative = 0
                for index, bound in enumerate(family.bucket_bounds):
                    cumulative += series.buckets[index]
                    lines.append(
                        f'{name}_bucket{{le="{bound}",{label_text}}} {cumulative}'
                    )
                lines.append(
                    f'{name}_bucket{{le="+Inf",{label_text}}} {series.count}'
                )
                lines.append(f"{name}_sum{suffix} {_format_value(series.sum)}")
                lines.append(f"{name}_count{suffix} {series.count}")
            else:
                lines.append(f"{name}{suffix} {_format_value(series.value)}")
    return "\n".join(lines) + "\n"


def ensure_health_families(registry: ObservabilityRegistry) -> None:
    """Register the two standard health gauges if this registry lacks them.

    Idempotent: health exposition is so cross-cutting that making every
    service remember to pre-register both families would produce exactly one
    class of 3am bug - a scrape raising where a panel should be.
    """
    if "wlct_component_health" not in registry.family_names():
        registry.register_gauge(
            "wlct_component_health",
            "Component health status (0 HEALTHY, 1 DEGRADED, 2 UNHEALTHY, 3 STOPPED, 4 UNKNOWN).",
            "component",
        )
    if "wlct_component_health_age_seconds" not in registry.family_names():
        registry.register_gauge(
            "wlct_component_health_age_seconds",
            "Age in seconds of each component's most recent observation.",
            "component",
        )


def render_health_metrics(
    registry: ObservabilityRegistry, results: Iterable[Any]
) -> None:
    """Project a health probe result set into gauges.

    ``results`` is the list-like returned by
    :meth:`wlct_trading.observability.health.HealthRegistry.check_all`. The
    exposed health is *this scrape's* probe; ages derive from the captured
    instants inside, not from scrape timing.
    """
    ensure_health_families(registry)
    for result in results:
        registry.set_gauge(
            "wlct_component_health",
            {"component": result.component},
            float(HEALTH_STATUS_VALUES[result.status.value]),
        )
        age = result.age_micros(now_micros=epoch_micros())
        registry.set_gauge(
            "wlct_component_health_age_seconds",
            {"component": result.component},
            (age / 1_000_000.0) if age is not None else float("nan"),
        )
