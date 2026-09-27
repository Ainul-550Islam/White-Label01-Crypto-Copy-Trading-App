"""The execution engine's metrics exposition (Part 18).

Part 9 built the socket and nobody plugged anything into it: the core has exposed
``observe_latency_histogram(...)`` ever since, with a docstring that says "the
service's scrape handler calls this per scrape", and the execution engine - the one
process on this platform that measures an authenticated order path - has never had a
scrape handler at all. Parts 16 and 17 then made that gap sharp from both sides: the
placement review became a counted and timed stage, and incident records became
durable. Measurable, and until this module, unreadable from outside the process that
measured it.

What is exported, and why each piece takes that shape:

* **One counter per ``ExecutionCounters`` field, derived from the dataclass.** No
  hand-written list of metric names lives here, so the exporter cannot fall behind
  the instrument: a counter added in the core reaches the scrape in the same commit
  that added it, and a test asserts the two sets are equal in BOTH directions. A
  curated list would have been the fourth hand-maintained enumeration in this
  repository, and every one of the first three was found because the list and the
  module it described had quietly parted.
* **Each recorded ``EXECUTION_STAGES`` histogram, copied whole** through the core's
  adapter rather than re-observed: the adapter takes ``(bounds, per-bucket counts,
  count, sum)`` from ``LatencyHistogram.snapshot_buckets()`` and leaves the
  cumulative sum to ``render_prometheus``, which owns it. That is the only faithful
  mirror of a source that keeps a rolling window: re-observing sample values would
  double-count against the previous scrape, and re-observing derived percentiles
  would present a rolling window as an all-time histogram. A whole-copy cannot
  disagree with its source, and the core's "observations, not guarantees" caveat is
  inherited into the help text instead of being restated as a promise. Wiring this
  copy into a live process is also how a nine-part-old bug in that adapter died: it
  had been writing a cumulative array into a store the renderer sums, so every ``le``
  line above the first bucket reported observations that never happened. See
  ``docs/PART18_METRICS_EXPOSITION.md``.
* **Wiring gauges.** "Zero placement reviews" means something different when no
  reviewer is wired from what it means when one is wired and nobody has submitted an
  order; without these the dashboard has to guess, and a guess about a safety
  control is the kind that gets automated into an alert.

What is deliberately not here:

* **No tenant, account, order or client-order label.** ``FORBIDDEN_LABEL_NAMES`` in
  the core refuses those at registration and this module does not route around the
  refusal with a rename: the values that make a per-tenant dashboard useful are the
  values that make a scraped endpoint a disclosure channel. Per-tenant numbers live
  in the durable tables, which are row-level-security scoped, and the API plane
  queries them.
* **No Redis mirror and no alert engine.** Both sibling services publish an evidence
  mirror for the API to persist. This service's evidence is its durable store, its
  incident table (Part 17) and its ``/internal/v1/status`` document; a third copy of
  the same facts in Redis would be a third thing to keep in step, and paging belongs
  to the layers that already own ``AlertEngine``.
* **No background task.** Everything is read at scrape time from state the process
  already holds, so there is no loop to stall, no interval to tune, and no staleness
  that is not also the engine's own.
"""

from __future__ import annotations

import logging
import time
from dataclasses import fields
from typing import Final

from wlct_trading.metrics import (
    EXECUTION_STAGES,
    ExecutionCounters,
    ExecutionMetrics,
    LatencyHistogram,
)
from wlct_trading.observability.metrics import (
    ObservabilityRegistry,
    ensure_process_families,
    observe_latency_histogram,
    render_prometheus,
    sample_process,
)

from app.composition import EngineRuntime

logger = logging.getLogger(__name__)

__all__ = [
    "COUNTER_FAMILIES",
    "LATENCY_FAMILY",
    "RESETS_FAMILY",
    "WIRING_GAUGE",
    "ExecutionEngineObservability",
    "counter_families",
]

_SERVICE: Final = "execution-engine"

#: One histogram family for every stage, because the bucket edges are the same for
#: all of them (the core's fixed set): thirteen families of sixteen buckets would be
#: a scrape a human has to name by hand in PromQL, for no extra information.
LATENCY_FAMILY: Final = "wlct_execution_stage_latency_micros"
WIRING_GAUGE: Final = "wlct_execution_wiring"
RESETS_FAMILY: Final = "wlct_execution_metrics_resets_total"


def counter_families() -> tuple[str, ...]:
    """``wlct_execution_<field>_total`` for every field on ``ExecutionCounters``."""
    return tuple(f"wlct_execution_{field.name}_total" for field in fields(ExecutionCounters))


#: Public so the test can assert equality against it instead of restating it - a
#: second list of names would be a second source of truth, which is the bug.
COUNTER_FAMILIES: Final[tuple[str, ...]] = counter_families()

#: (label, source of truth) for each wiring gauge. The label is the metric's
#: ``component`` value; the source is a key in the runtime's own description, so
#: the gauge reports what ``/status`` reports rather than a second opinion.
_WIRING_SOURCES: Final[tuple[tuple[str, str, str], ...]] = (
    ("durable_store", "storeDurable", ""),
    ("durable_incidents", "incidents", "durable"),
    ("placement_review", "placement", "label"),
    ("venue_attestation", "placement", "requiresVenueAttestation"),
    ("distributed_locks", "locksDistributed", ""),
    ("journal_retention", "retentionEnabled", ""),
    # Part 19's two live-enablement components, from the same description. They are
    # here rather than in a new family because the question they answer - "which half
    # of the live path does this deployment not have" - is a wiring question, and the
    # gauge is the only wiring surface this hub owns. A dashboard that can see
    # placement_review=1 next to live_credential_fetcher=0 is looking at a deployment
    # that reviews orders it has no way to sign, which is exactly the state Part 16
    # left open and Part 19 made countable.
    ("live_credential_fetcher", "credentialFetcher", ""),
    ("operator_confirmation", "operatorConfirmation", ""),
    # Part 18's own posture, from the same description the status route renders.
    # It is here because the whole module would otherwise report zeros that cannot
    # be told apart: this service shipped an engine with no instrument for thirteen
    # parts, and "nothing happened" and "nothing was measured" look identical in
    # every other family.
    ("engine_instrumented", "metricsConfigured", ""),
)


class ExecutionEngineObservability:
    """Registry, families, and the one method anything else calls: ``scrape``.

    Built once per process in the lifespan, after the runtime exists, and strictly
    read-only towards the engine: it never calls ``reset()`` and never mutates a
    histogram. An exposition that could clear the numbers it reports would make a
    restart and a deliberate ``metrics.reset()`` indistinguishable on a dashboard -
    which is the moment an operator is reading one hardest.
    """

    def __init__(self, runtime: EngineRuntime) -> None:
        self._runtime = runtime
        self._started_mono = time.monotonic()
        self.registry = ObservabilityRegistry(service=_SERVICE)
        self._last_counters: dict[str, int] = {}
        self._resets = 0
        ensure_process_families(self.registry)
        self._register_families()

    # ------------------------------------------------------------------
    # registration
    # ------------------------------------------------------------------
    def _register_families(self) -> None:
        registered = self.registry.family_names()
        for family in COUNTER_FAMILIES:
            if family in registered:
                continue
            source = family.removeprefix("wlct_execution_").removesuffix("_total")
            self.registry.register_counter(
                family,
                f"Execution path '{source}'; cumulative over this process's lifetime.",
            )
        self.registry.register_histogram(
            LATENCY_FAMILY,
            "Engine stage durations in microseconds. Observations of this process "
            "and its network path; never a latency guarantee.",
            ("stage",),
            bounds={"stage": frozenset(EXECUTION_STAGES)},
        )
        self.registry.register_gauge(
            WIRING_GAUGE,
            "Wiring facts (1=yes) needed to read a zero correctly.",
            "component",
            bounds={"component": frozenset(label for label, *_ in _WIRING_SOURCES)},
        )
        self.registry.register_counter(
            RESETS_FAMILY,
            "Times the source counters moved backwards between scrapes (a reset or "
            "a restart) and this hub re-baselined rather than reporting a negative rate.",
        )

    # ------------------------------------------------------------------
    # the mirror
    # ------------------------------------------------------------------
    def _metrics(self) -> ExecutionMetrics | None:
        """The engine's own instrument, or None when it was built without one.

        ``None`` renders as "no families added", not as zeros: zero orders and
        unmeasured orders are different facts, and a scrape that invented the first
        would be the exposition layer making a claim the engine never made.
        """
        return getattr(self._runtime.engine, "metrics", None)

    def _mirror_counters(self, source: ExecutionCounters) -> None:
        """Delta-mirror the cumulative counters into the registry.

        The registry may only ever ADD to a counter (``inc`` refuses a negative
        amount, and that law is the platform's, not this file's) and the source is
        cumulative, so the honest bridge is a delta per scrape. A decrease is not a
        negative rate: it is ``reset()`` or a process restart, and the answer is to
        re-baseline the mirror and COUNT the event, because a counter that silently
        resumes from zero after a reset draws a cliff exactly where an operator is
        looking for a trend.
        """
        for field in fields(ExecutionCounters):
            value = int(getattr(source, field.name, 0) or 0)
            family = f"wlct_execution_{field.name}_total"
            previous = self._last_counters.get(field.name)
            self._last_counters[field.name] = value
            if previous is None:
                if value:
                    self.registry.inc(family, {}, float(value))
                continue
            if value < previous:
                self._resets += 1
                self.registry.inc(RESETS_FAMILY, {})
                if value:
                    self.registry.inc(family, {}, float(value))
                continue
            delta = value - previous
            if delta:
                self.registry.inc(family, {}, float(delta))

    def _mirror_stages(self, source: ExecutionMetrics) -> None:
        """Copy each recorded stage's cumulative histogram state, whole."""
        stage_getter = getattr(source, "stage", None)
        if not callable(stage_getter):
            return
        for stage in EXECUTION_STAGES:
            histogram: LatencyHistogram | None = stage_getter(stage)
            if histogram is None or histogram.count == 0:
                # An unrecorded stage is ABSENT from the exposition rather than a
                # histogram of zeros: "nobody measured this" and "everything was
                # instantaneous" are different statements, and rendering the second
                # one is the specific lie this loop exists to avoid.
                continue
            observe_latency_histogram(
                self.registry,
                LATENCY_FAMILY,
                {"stage": stage},
                histogram,
            )

    def _publish_wiring(self) -> None:
        described = self._runtime.describe()
        for label, key, subkey in _WIRING_SOURCES:
            raw: object = described.get(key)
            if subkey:
                raw = raw.get(subkey) if isinstance(raw, dict) else None
            value = 1.0 if _truthy(raw) else 0.0
            self.registry.set_gauge(WIRING_GAUGE, {"component": label}, value)

    # ------------------------------------------------------------------
    # the one public entry point
    # ------------------------------------------------------------------
    def scrape(self) -> str:
        """Render this process's metrics, fresh, from state already held."""
        source = self._metrics()
        if source is not None:
            counters = getattr(source, "counters", None)
            if counters is not None:
                self._mirror_counters(counters)
            self._mirror_stages(source)
        self._publish_wiring()
        sample_process(self.registry, started_at_mono=self._started_mono)
        return render_prometheus(self.registry)

    @property
    def family_names(self) -> tuple[str, ...]:
        """The families this hub owns, for the test that pins them.

        The registry exposes this as a method; the property exists so a reader of
        this module sees the hub's surface, not the registry's plumbing.
        """
        return self.registry.family_names()

    @property
    def reset_count(self) -> int:
        """How many times the mirror had to re-baseline, for the log line."""
        return self._resets


def _truthy(raw: object) -> bool:
    """The one reading of "is this wired" that does not invent a default.

    ``True``/``False`` pass through, a non-empty string counts (the placement block's
    ``label`` is a gatherer name, whose absence is the empty case), and a missing
    key counts as not-wired rather than as zero - so a renamed describe() key
    publishes 0 and gets noticed, instead of publishing a confident answer nobody
    checked.
    """
    if isinstance(raw, bool):
        return raw
    if isinstance(raw, str):
        return bool(raw) and raw not in {"unavailable", "none", "unattested"}
    if raw is None:
        return False
    return bool(raw)
